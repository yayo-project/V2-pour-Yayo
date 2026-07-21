// YAYO — Website Import, extraction engine (step 3). Two stateless phases so
// each call stays inside the serverless time budget (Netlify ~10s):
//
//   A) DISCOVER — POST { url } (or { url, phase:"discover" })
//        → { method:"jsonld", cars:[…] }              small site, done in one shot
//        → { method:"details", total, urls:[…] }      client extracts in batches
//        → { spa:true } | { empty:true } | { error } | { unavailable:true }
//   B) EXTRACT — POST { phase:"extract", urls:[…≤12] }
//        → { cars:[…] }                               one batch of detail pages
//
// A candidate: { name, make, model, year, price_usd|null, price_original|null,
//   currency, currency_guessed, price_missing, mileage, photos[], source_url,
//   fingerprint, import_method }
// READS ONLY — never writes, never publishes. Publishing (photo re-hosting +
// dedupe against the dealer's existing listings, price entry for price-less
// cars) happens in step 4 through the review screen + Vérifié flow.
//
// Goal: ANY dealer site, any technology, "paste the URL → your cars appear".
// A car is NEVER dropped just for a missing price — many Dubai export dealers
// hide prices; the dealer sets it on the review screen.
//   1. JSON-LD / schema.org Car|Vehicle|Product on the entry/paginated pages.
//   2. Discovery crawl: product-detail links harvested from the page anchors,
//      its category/inventory pages, and sitemap(s). Detail pages are fetched
//      in EXTRACT batches: photos + name deterministically (og:image, gallery,
//      JS image arrays, <h1>), specs/price via Groq on the page text.
//   3. Whole-page Groq extraction as a last resort.
// Truly empty / JS-only with nothing readable → { spa:true } (add manually).

const AED_PER_USD = 3.6725;
const MAX_INDEX_PAGES = 10;   // category/inventory pages crawled during DISCOVER
const MAX_DETAIL_URLS = 400;  // detail URLs collected before we stop discovering
const MAX_EXTRACT = 12;       // detail pages accepted per EXTRACT call
const MAX_CARS_LD = 60;       // cap for the pure JSON-LD fast path
const MAX_HTML = 2500000;
const FETCH_TIMEOUT = 6500;
// Serverless calls are killed at ~10s. Everything below watches this deadline
// and returns whatever it has rather than being cut off (a slow dealer site
// used to produce a gateway timeout, which the dashboard showed as a failure).
const TOTAL_BUDGET = 8200;
let DEADLINE = 0;
function budgetLeft() { return DEADLINE ? Math.max(0, DEADLINE - Date.now()) : FETCH_TIMEOUT; }

// A URL segment that talks about cars ("used-cars", "listings", "vehicules"…)
const CAR_SEG = /(listing|vehicle|vehicule|voiture|annonce|inventory|inventaire|stock|product|item|car|auto|used|occasion|preowned|pre-owned)/i;
// …but these are SERVICE / content pages, never a car ("car-care", "car-wash")
const SERVICE_SEG = /(care|wash|detail(ing)?|service|repair|maintenance|warrant|insurance|finance|loan|lease|rental|rent|hire|part|accessor|blog|news|tip|guide|about|contact|team|career|job|privacy|terms|polic|faq|valuation|sell|trade|export|import|shipping|showroom|branch|location)/i;
// A query that identifies ONE car, e.g. product.php?product=slug, ?vid=123.
const DETAIL_QUERY = /[?&](product|car|vehicle|listing|item|vid|pid|carid|stockid|auto|ref)=[a-z0-9][\w%-]{2,}/i;
const INDEX_QUERY = /[?&](category|make|brand|browse|type|page|paged|serie|model|body|fuel)=/i;
// Never treat these as cars.
const JUNK = /(cart|login|signin|signup|register|account|wishlist|favou?rite|checkout|compare|\.(?:jpg|jpeg|png|webp|gif|svg|css|js|pdf|xml)(?:\?|$))/i;

// A segment that looks like ONE specific car: has a number (id/year), or
// several words joined by hyphens, or is simply long. "suv" / "sedan" don't.
function sluggy(seg) {
  const s = decodeURIComponent(seg || "");
  return /\d/.test(s) || (s.match(/-/g) || []).length >= 2 || s.length >= 14;
}
// Classify a path: one car page, an inventory page worth crawling, or neither.
// Works for /listings/toyota-x/, /used-cars/1234-Aston-Martin/, /voitures/…
function pathKind(pathname) {
  const segs = decodeURIComponent(pathname).split("/").filter(Boolean);
  for (let i = 0; i < segs.length; i++) {
    if (!CAR_SEG.test(segs[i]) || SERVICE_SEG.test(segs[i])) continue;
    const next = segs[i + 1];
    if (next && !SERVICE_SEG.test(next) && sluggy(next)) return "detail";
    return "index";
  }
  return null;
}

// ── tiny helpers ──────────────────────────────────────────────
function absUrl(u, base) { try { return new URL(u, base).href; } catch (e) { return null; } }
function isPublicHttp(u) {
  let p; try { p = new URL(u); } catch (e) { return false; }
  if (p.protocol !== "http:" && p.protocol !== "https:") return false;
  const h = p.hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal")) return false;
  if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(h)) return false;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return false;
  if (h === "[::1]" || h === "::1") return false;
  return true;
}
// Real-browser headers — cheap shared hosts often throttle or block requests
// that look like bots. A second UA is tried on retry.
const UAS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"
];
async function fetchPage(url, attempt) {
  const left = budgetLeft();
  if (left < 400) throw new Error("no time left");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), Math.min(FETCH_TIMEOUT, left));
  try {
    let ref; try { ref = new URL(url).origin + "/"; } catch (e) { ref = undefined; }
    const res = await fetch(url, {
      signal: ctrl.signal, redirect: "follow",
      headers: {
        "User-Agent": UAS[(attempt || 0) % UAS.length],
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9,fr;q=0.8,ar;q=0.7",
        "Referer": ref
      }
    });
    if (!res.ok) throw new Error("http " + res.status);
    const text = await res.text();
    return text.length > MAX_HTML ? text.slice(0, MAX_HTML) : text;
  } finally { clearTimeout(timer); }
}
// Flaky origins (datacenter IP throttling) need a few tries with backoff.
async function fetchRetry(url, tries) {
  let err;
  const n = tries || 3;
  for (let i = 0; i < n; i++) {
    try { return await fetchPage(url, i); } catch (e) { err = e; }
    // only retry while there is real time left for another attempt
    if (i < n - 1 && budgetLeft() > 2500) await new Promise(r => setTimeout(r, 250));
    else break;
  }
  throw err;
}
function toInt(x) { if (x == null) return null; const n = parseInt(String(x).replace(/[^\d]/g, ""), 10); return isNaN(n) ? null : n; }
function unsizeImg(u) { return u.replace(/-\d{2,4}x\d{2,4}(\.(?:jpe?g|png|webp))/i, "$1"); }
function sameHost(a, b) { try { return new URL(a).host === new URL(b).host; } catch (e) { return false; } }
function stripHtml(html) {
  return html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ").replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&amp;|&quot;|&#\d+;/g, " ").replace(/\s+/g, " ").trim();
}
// derive make/model/year from a car title when the AI is unavailable
const KNOWN_MAKES = "toyota|lexus|nissan|mitsubishi|honda|kia|hyundai|suzuki|mazda|mercedes|mercedes-benz|bmw|audi|volkswagen|vw|ford|chevrolet|jeep|land rover|range rover|jetour|mg|byd|chery|peugeot|renault|citroen|isuzu|hino|mini|porsche|bentley|rolls royce|ferrari|lamborghini|cadillac|gmc|dodge|ram|tesla|tank|changan|geely|haval|jac|foton|man|volvo|scania|daf|iveco".split("|");
function deriveMakeModelYear(name) {
  const low = (name || "").toLowerCase();
  const yr = (low.match(/\b(19[89]\d|20[0-3]\d)\b/) || [])[1] || null;
  let make = null;
  for (const m of KNOWN_MAKES) if (low.includes(m)) { make = m; break; }
  let model = null;
  if (make) {
    const idx = low.indexOf(make) + make.length;
    model = (name || "").slice(idx).replace(/^[\s\-:]+/, "").split(/[\s\-]/).slice(0, 2).join(" ").trim() || null;
    make = make.split(" ").map(w => w[0].toUpperCase() + w.slice(1)).join(" ");
  }
  return { make, model: model || null, year: yr ? parseInt(yr, 10) : null };
}

// ── JSON-LD extraction ────────────────────────────────────────
function jsonLdBlocks(html) {
  const out = [];
  const re = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m; while ((m = re.exec(html))) { try { out.push(JSON.parse(m[1].trim())); } catch (e) {} }
  return out;
}
function flattenLd(node, acc) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) { node.forEach(n => flattenLd(n, acc)); return; }
  if (node["@graph"]) flattenLd(node["@graph"], acc);
  if (node.itemListElement) flattenLd(node.itemListElement, acc);
  if (node.item) flattenLd(node.item, acc);
  const type = [].concat(node["@type"] || []).map(String);
  if (type.some(t => /^(Car|Vehicle|Product|Motorcycle)$/i.test(t)) && (node.name || node.model)) acc.push(node);
}
function imagesOf(node, base) {
  let imgs = node.image || (node.offers && node.offers.image) || [];
  imgs = [].concat(imgs).map(i => (typeof i === "string" ? i : (i && (i.url || i.contentUrl)) || null));
  return imgs.map(u => u && absUrl(u, base)).filter(Boolean).map(unsizeImg);
}
function carsFromJsonLd(html, pageUrl) {
  const acc = []; jsonLdBlocks(html).forEach(b => flattenLd(b, acc));
  return acc.map(n => {
    const offers = [].concat(n.offers || [])[0] || {};
    const brand = n.brand ? (typeof n.brand === "string" ? n.brand : n.brand.name) : null;
    const mileage = n.mileageFromOdometer ? (typeof n.mileageFromOdometer === "object" ? n.mileageFromOdometer.value : n.mileageFromOdometer) : null;
    const year = n.vehicleModelDate || n.productionDate || n.releaseDate || n.modelDate || null;
    const price = toInt(offers.price != null ? offers.price : n.price);
    return {
      name: String(n.name || "").trim().slice(0, 120) || null,
      make: brand ? String(brand).trim().slice(0, 40) : null,
      model: n.model ? String(typeof n.model === "string" ? n.model : n.model.name || "").trim().slice(0, 80) : null,
      year: toInt(String(year || "").slice(0, 4)),
      price_original: price || null,
      currency: String(offers.priceCurrency || n.priceCurrency || "").toUpperCase() || null,
      mileage: toInt(mileage),
      photos: imagesOf(n, pageUrl).slice(0, 15),
      source_url: n.url ? absUrl(typeof n.url === "string" ? n.url : n.url["@id"] || "", pageUrl) : pageUrl,
      import_method: "jsonld"
    };
  }).filter(c => c.name); // price NOT required
}

// ══════════════════════════════════════════════════════════════
// DATA-FEED LAYER — read the site's OWN data instead of scraping.
// Nearly every "JavaScript inventory app" fetches its cars from a
// JSON feed (Shopify /products.json, a WordPress REST route, or an
// app-data blob embedded in the page). Reading that feed gives us
// cleaner data than any HTML scrape — and it's how we cover SPA
// sites that have no readable car HTML at all.
// ══════════════════════════════════════════════════════════════
function fieldLike(o, re) { for (const k of Object.keys(o)) if (re.test(k)) { const v = o[k]; if (v != null && v !== "" && typeof v !== "object") return v; } return null; }
function collectJsonImages(o, base) {
  const out = [];
  const push = x => {
    if (!x) return;
    if (typeof x === "string") { const a = absUrl(x, base); if (a && /\.(jpe?g|png|webp)(\?|$)/i.test(a) && !/logo|icon|sprite|placeholder/i.test(a)) out.push(unsizeImg(a)); }
    else if (typeof x === "object") { const s = x.src || x.url || x.large || x.original || x.image || x.full || x.path; if (s) push(s); }
  };
  for (const k of Object.keys(o)) {
    if (!/image|img|photo|picture|thumb|gallery|media|cover|banner/i.test(k)) continue;
    const v = o[k]; if (Array.isArray(v)) v.forEach(push); else push(v);
  }
  return [...new Set(out)].slice(0, 15);
}
function jsonPrice(o) {
  // direct price field, else a Shopify-style variants[0].price, else nested price object
  let p = fieldLike(o, /^(price|amount|cost|sale_?price|regular_?price|listing_?price|value)$/i);
  if (p == null && Array.isArray(o.variants) && o.variants[0]) p = o.variants[0].price != null ? o.variants[0].price : (o.variants[0].amount);
  if (p == null && o.price && typeof o.price === "object") p = o.price.amount || o.price.value;
  return toInt(p);
}
function looksLikeCar(o) {
  if (!o || typeof o !== "object" || Array.isArray(o)) return false;
  const keys = Object.keys(o).map(k => k.toLowerCase());
  const hasName = keys.some(k => /^(name|title|product_?name|model_?name|heading|handle)$/.test(k)) || (fieldLike(o, /make|brand|manufacturer|vendor/i) && fieldLike(o, /^model$/i));
  // a STRONG car signal — a bare title+image (blog post, menu item) must NOT
  // qualify, so image/photo alone are deliberately excluded here
  const hasSignal = keys.some(k => /(price|amount|year|mileage|odometer|make|brand|vendor|vin|variant|fuel|transmission|engine|body_?type|drivetrain)/.test(k));
  return hasName && hasSignal;
}
function jsonCarToCandidate(o, base) {
  const make = fieldLike(o, /^(make|brand|manufacturer|vendor)$/i);
  const model = fieldLike(o, /^(model|model_?name)$/i);
  const year = toInt(String(fieldLike(o, /^(year|model_?year|manufacture_?year|reg_?year)$/i) || "").slice(0, 4));
  let name = fieldLike(o, /^(name|title|product_?name|heading|label)$/i);
  if (!name) name = [make, model, year].filter(Boolean).join(" ") || null;
  if (!name) return null;
  const urlField = fieldLike(o, /^(url|link|permalink|href|handle|slug)$/i);
  let source_url = null;
  if (urlField) source_url = /^https?:/i.test(urlField) ? urlField : absUrl((String(urlField).startsWith("/") ? "" : "/") + urlField, base);
  return {
    name: String(name).trim().slice(0, 120),
    make: make ? String(make).trim().slice(0, 40) : null,
    model: model ? String(model).trim().slice(0, 80) : null,
    year: year || null,
    price_original: jsonPrice(o),
    currency: (fieldLike(o, /currency|priceCurrency/i) ? String(fieldLike(o, /currency|priceCurrency/i)).toUpperCase().slice(0, 3) : null),
    mileage: toInt(fieldLike(o, /mileage|odometer|kilometer|^km$/i)),
    photos: collectJsonImages(o, base),
    source_url,
    import_method: "api"
  };
}
// deep-search ANY parsed JSON for arrays of car-like objects
function deepFindCars(root, base) {
  const cars = []; let nodes = 0;
  (function walk(node, depth) {
    if (depth > 9 || nodes > 60000 || node == null || typeof node !== "object") return;
    nodes++;
    if (Array.isArray(node)) {
      const carItems = node.filter(looksLikeCar);
      if (carItems.length >= 2) carItems.forEach(it => { const c = jsonCarToCandidate(it, base); if (c) cars.push(c); });
      node.forEach(n => walk(n, depth + 1));
    } else {
      for (const k in node) walk(node[k], depth + 1);
    }
  })(root, 0);
  return cars;
}
async function fetchJson(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT);
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: "follow", headers: { "User-Agent": UAS[0], "Accept": "application/json,*/*" } });
    if (!res.ok) throw new Error("http " + res.status);
    const t = await res.text();
    if (t.length > MAX_HTML) throw new Error("too big");
    return JSON.parse(t);
  } finally { clearTimeout(timer); }
}
// app-data embedded in the page (Next.js, Nuxt, Redux, or a JSON <script>)
function carsFromHydration(html, base) {
  const cars = [];
  const grab = re => { const m = html.match(re); if (m) { try { deepFindCars(JSON.parse(m[1]), base).forEach(c => cars.push(c)); } catch (e) {} } };
  grab(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  grab(/window\.__NUXT__\s*=\s*(\{[\s\S]*?\})\s*<\/script>/i);
  grab(/window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\})\s*;?\s*<\/script>/i);
  grab(/window\.__APOLLO_STATE__\s*=\s*(\{[\s\S]*?\})\s*;?\s*<\/script>/i);
  // any application/json <script> that holds an array of car-like objects
  const re = /<script[^>]*type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m, n = 0;
  while ((m = re.exec(html)) && n < 8) { n++; try { deepFindCars(JSON.parse(m[1].trim()), base).forEach(c => cars.push(c)); } catch (e) {} }
  return cars;
}
// Shopify: every store exposes a public /products.json feed
async function carsFromShopify(origin) {
  const cars = [];
  for (let page = 1; page <= 3; page++) {
    let data; try { data = await fetchJson(origin + "/products.json?limit=250&page=" + page); } catch (e) { break; }
    const items = data && Array.isArray(data.products) ? data.products : null;
    if (!items || !items.length) break;
    items.forEach(p => {
      const variant = (p.variants && p.variants[0]) || {};
      const imgs = (p.images || []).map(im => im && (im.src || im)).filter(Boolean).map(u => unsizeImg(u)).slice(0, 15);
      const name = p.title || [p.vendor, p.product_type].filter(Boolean).join(" ");
      if (!name) return;
      cars.push({
        name: String(name).slice(0, 120), make: p.vendor || null, model: null,
        year: toInt(String(name).match(/\b(19[89]\d|20[0-3]\d)\b/) ? RegExp.$1 : ""),
        price_original: toInt(variant.price), currency: null, mileage: null, photos: imgs,
        source_url: p.handle ? origin + "/products/" + p.handle : null, import_method: "api"
      });
    });
    if (items.length < 250) break;
  }
  return cars;
}
// WordPress REST: discover a car/vehicle/listing/product route and read it
async function carsFromWpRest(origin) {
  const cars = [];
  const tryRoute = async (path) => { try { const d = await fetchJson(origin + path); deepFindCars(d, origin).forEach(c => cars.push(c)); } catch (e) {} };
  // discover custom routes
  try {
    const root = await fetchJson(origin + "/wp-json/");
    const routes = root && root.routes ? Object.keys(root.routes) : [];
    const carRoutes = routes.filter(r => /(vehicle|listing|car|inventory|stock|auto|product|search)/i.test(r) && !/\{|revision|autosave/i.test(r)).slice(0, 4);
    for (const r of carRoutes) await tryRoute(r + (r.includes("?") ? "&" : "?") + "per_page=100");
  } catch (e) {}
  // common fixed routes (WooCommerce store API + posts of vehicle types)
  if (cars.length < 2) for (const p of ["/wp-json/wc/store/products?per_page=100", "/wp-json/wp/v2/vehicle?per_page=100", "/wp-json/wp/v2/listing?per_page=100", "/wp-json/wp/v2/car?per_page=100"]) { if (cars.length < 2) await tryRoute(p); }
  return cars;
}
// generic: data endpoints referenced in the page HTML (…/api/…, .json, ?rest_route=)
async function carsFromDiscoveredApi(html, base) {
  const origin = new URL(base).origin;
  const cands = new Set();
  const re = /["'`]([^"'`\s]*(?:\/api\/|\/wp-json\/|rest_route=|\/graphql|\/ajax\/|search|inventory|listings?|vehicles?|products?)[^"'`\s]*\.?(?:json)?[^"'`\s]*)["'`]/gi;
  let m, n = 0;
  while ((m = re.exec(html)) && n < 40) {
    n++; let u = m[1];
    if (/\.(js|css|png|jpe?g|svg|woff|gif|webp)(\?|$)/i.test(u)) continue;
    if (u.startsWith("//")) u = "https:" + u; else if (u.startsWith("/")) u = origin + u; else if (!/^https?:/i.test(u)) continue;
    if (!sameHost(u, base)) continue;
    cands.add(u.replace(/\\\//g, "/"));
  }
  const cars = [];
  for (const u of [...cands].slice(0, 6)) {
    if (cars.length >= 2) break;
    try { deepFindCars(await fetchJson(u), base).forEach(c => cars.push(c)); } catch (e) {}
  }
  return cars;
}
// try every data feed in order of reliability; first that yields ≥2 cars wins
async function carsFromDataFeeds(entryHtml, url) {
  const origin = new URL(url).origin;
  let cars = carsFromHydration(entryHtml, url);   // free: already-downloaded HTML
  if (cars.length < 2 && budgetLeft() > 4000) { try { cars = cars.concat(await carsFromShopify(origin)); } catch (e) {} }
  if (cars.length < 2 && budgetLeft() > 3500) { try { cars = cars.concat(await carsFromWpRest(origin)); } catch (e) {} }
  if (cars.length < 2 && budgetLeft() > 3000) { try { cars = cars.concat(await carsFromDiscoveredApi(entryHtml, url)); } catch (e) {} }
  return cars;
}

// ── link classification & discovery crawl ─────────────────────
function classifyLinks(html, baseUrl) {
  const details = new Set(), indexes = new Set();
  const host = new URL(baseUrl).host;
  const re = /<a[^>]*href\s*=\s*["']([^"'\s]+)["']/gi;
  let m;
  while ((m = re.exec(html))) {
    const raw = m[1].split("#")[0];
    if (!raw || raw.startsWith("javascript:") || raw.startsWith("mailto:") || raw.startsWith("tel:")) continue;
    const u = absUrl(raw, baseUrl);
    if (!u || !sameHost(u, baseUrl) || JUNK.test(u)) continue;
    let path, query;
    try { const p = new URL(u); path = p.pathname; query = p.search; } catch (e) { continue; }
    const kind = pathKind(path);
    if (DETAIL_QUERY.test(query) || kind === "detail") details.add(u);
    else if (kind === "index" || INDEX_QUERY.test(query)) indexes.add(u);
  }
  return { details: [...details], indexes: [...indexes], host };
}
function urlsFromXml(xml) { const o = []; const re = /<loc>\s*([^<\s]+)\s*<\/loc>/gi; let m; while ((m = re.exec(xml))) o.push(m[1]); return o; }
async function sitemapDetailUrls(origin) {
  const roots = ["/sitemap.xml", "/sitemap_index.xml", "/wp-sitemap.xml"];
  let queue = [];
  for (const p of roots) { try { queue.push(await fetchPage(origin + p)); break; } catch (e) {} }
  const details = new Set(); let hops = 0;
  while (queue.length && hops < 10 && details.size < MAX_DETAIL_URLS) {
    const xml = queue.shift(); hops++;
    for (const u of urlsFromXml(xml)) {
      if (/\.xml(\?|$)/i.test(u)) {
        if (/listing|vehicle|car|product|post|item/i.test(u) && queue.length < 8) { try { queue.push(await fetchPage(u)); } catch (e) {} }
      } else if (!JUNK.test(u)) {
        try { const p = new URL(u); if (DETAIL_QUERY.test(p.search) || pathKind(p.pathname) === "detail") details.add(u.split("#")[0]); } catch (e) {}
      }
    }
  }
  return [...details];
}
// entry page + its index/category pages + sitemap → all detail URLs.
// Sitemap and category pages are fetched in parallel to stay inside budget.
async function collectDetailUrls(entryUrl, entryHtml) {
  const details = new Set();
  const { details: d0, indexes } = classifyLinks(entryHtml, entryUrl);
  d0.forEach(u => details.add(u));
  // the entry page alone may already be enough; only dig deeper if there is time
  if (budgetLeft() < 2500) return [...details].slice(0, MAX_DETAIL_URLS);
  const [sitemap, ...idxHtmls] = await Promise.all([
    sitemapDetailUrls(new URL(entryUrl).origin).catch(() => []),
    ...indexes.slice(0, MAX_INDEX_PAGES).map(u => fetchPage(u).then(h => ({ u, h })).catch(() => null))
  ]);
  (sitemap || []).forEach(u => details.add(u));
  idxHtmls.forEach(x => { if (x && x.h) classifyLinks(x.h, x.u).details.forEach(u => details.add(u)); });
  return [...details].slice(0, MAX_DETAIL_URLS);
}

// ── per-detail-page deterministic extraction (photos + name) ──
function pickName(html) {
  const h1 = (html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1];
  if (h1) { const t = stripHtml(h1); if (t.length > 2 && t.length < 130) return t; }
  const og = (html.match(/property\s*=\s*["']og:title["'][^>]*content\s*=\s*["']([^"']+)["']/i)
    || html.match(/content\s*=\s*["']([^"']+)["'][^>]*property\s*=\s*["']og:title["']/i) || [])[1];
  if (og && !/^[\w .]*(motors?|fze|export|trading|automobiles?)\b/i.test(og)) return og.slice(0, 120);
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1];
  return title ? stripHtml(title).split(/[|\-–]/)[0].trim().slice(0, 120) : null;
}
function detailPhotos(html, pageUrl) {
  // drop "similar / related cars" tail — its photos belong to other cars
  const cut = html.search(/similar\s+(listing|car|vehicle|product)|related\s+(cars|vehicles|listings|products)|you\s+may\s+also|voitures?\s+similaires|most\s+viewed/i);
  if (cut > 400) html = html.slice(0, cut);
  const set = new Set();
  const push = u => { if (!u) return; const a = absUrl(u, pageUrl); if (!a) return; if (/logo|icon|avatar|placeholder|banner|sprite|design|flag|whatsapp|payment|preload|print-|header|footer|loader|spinner|blank|default|no-image|noimage|watermark/i.test(a)) return; if (!/\.(jpe?g|png|webp)(\?|$)/i.test(a)) return; set.add(unsizeImg(a)); };
  // og:image first (usually the cover)
  const og = (html.match(/property\s*=\s*["']og:image["'][^>]*content\s*=\s*["']([^"']+)["']/i)
    || html.match(/content\s*=\s*["']([^"']+)["'][^>]*property\s*=\s*["']og:image["']/i) || [])[1];
  if (og && !/logo/i.test(og)) push(og);
  // JS image arrays the client hydrates from (e.g. let productImages = [...])
  const arrRe = /(?:productimages|images|gallery|photos|slides)\s*[:=]\s*(\[[^\]]{5,4000}\])/gi;
  let a;
  while ((a = arrRe.exec(html))) {
    try { JSON.parse(a[1].replace(/'/g, '"')).forEach(x => push(typeof x === "string" ? x : (x && (x.url || x.src || x.image)))); } catch (e) {
      (a[1].match(/["']([^"']+\.(?:jpe?g|png|webp)[^"']*)["']/gi) || []).forEach(s => push(s.replace(/["']/g, "")));
    }
  }
  // plain <img> in the (trimmed) main content
  const imgRe = /<img[^>]*?(?:data-src|data-lazy|data-original|src)\s*=\s*["']([^"'\s]+\.(?:jpe?g|png|webp)[^"'\s]*)["']/gi;
  let m; while ((m = imgRe.exec(html)) && set.size < 20) push(m[1]);
  return [...set].slice(0, 15);
}
// a compact price-region snippet so Groq parses little text, not the whole DOM
function priceSnippet(text) {
  const idx = text.search(/AED|USD|\$|درهم|price|prix|السعر/i);
  return idx < 0 ? "" : text.slice(Math.max(0, idx - 40), idx + 160);
}

// ── Groq (specs/price parsing only; photos are deterministic) ─
async function groqJson(key, system, user) {
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
    body: JSON.stringify({ model: "llama-3.3-70b-versatile", temperature: 0, response_format: { type: "json_object" }, messages: [{ role: "system", content: system }, { role: "user", content: user }] })
  });
  if (!res.ok) throw new Error("groq " + res.status);
  return JSON.parse((await res.json()).choices[0].message.content);
}
// given [{i,name,priceText,text}] → make/model/year/price/currency/mileage
async function groqSpecs(key, docs) {
  const out = await groqJson(key,
    `For each car listing, return specs. Reply ONLY JSON: {"cars":[{"i":<index>,"make":"...","model":"...","year":2026,"price":90000,"currency":"AED|USD|null","mileage":0}]} — one per input index. "price" = the amount a buyer PAYS NOW (if an old price is crossed out and a sale/offer price shown, use the sale price; ignore 0 or "0.00" which means price hidden → null). Parse make/model/year from the name. Unknown = null. Never invent values.`,
    JSON.stringify(docs.map(d => ({ i: d.i, name: d.name, price: d.priceText || null }))));
  const map = {};
  (Array.isArray(out.cars) ? out.cars : []).forEach(c => { if (c && c.i != null) map[c.i] = c; });
  return map;
}
function cleanForLlm(html, base) {
  let text = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<img[^>]*?(?:src|data-src)\s*=\s*["']([^"']+)["'][^>]*>/gi, " [IMG $1] ")
    .replace(/<[^>]+>/g, " ").replace(/&nbsp;|&amp;|&quot;|&#\d+;/g, " ").replace(/\s+/g, " ").trim();
  return text.slice(0, 20000);
}
async function groqWholePage(key, text, pageUrl) {
  const out = await groqJson(key,
    `Extract cars for sale from dealer-website text with [IMG url] markers. Reply ONLY JSON: {"cars":[{"name":"...","make":"...","model":"...","year":2021,"price":84500,"currency":"AED|USD|null","mileage":45000,"photos":["url"],"url":"listing url or null"}]}. One entry per DISTINCT car for sale (ignore nav, brand lists, service pages). price: amount paid now, 0/hidden → null. photos: the [IMG] urls for that car, max 10. Unknown = null. Never invent.`,
    "Page: " + pageUrl + "\n\n" + text);
  return (Array.isArray(out.cars) ? out.cars : []).map(c => ({
    name: String(c.name || "").trim().slice(0, 120) || null,
    make: c.make ? String(c.make).trim().slice(0, 40) : null,
    model: c.model ? String(c.model).trim().slice(0, 80) : null,
    year: toInt(c.year), price_original: toInt(c.price) || null,
    currency: c.currency ? String(c.currency).toUpperCase() : null,
    mileage: toInt(c.mileage),
    photos: [].concat(c.photos || []).map(u => absUrl(u, pageUrl)).filter(Boolean).map(unsizeImg).slice(0, 15),
    source_url: c.url ? absUrl(c.url, pageUrl) : pageUrl, import_method: "llm"
  })).filter(c => c.name);
}

// ── normalize: currency → USD (price optional), fingerprint, dedupe ──
function normalize(cars, aedHintGlobal) {
  const seen = new Set(); const out = [];
  for (const c of cars) {
    if (!c.name) continue;
    let currency = c.currency, guessed = false, missing = false;
    let price = c.price_original;
    if (price != null && price <= 0) price = null;
    if (price == null) { missing = true; currency = currency || null; }
    else if (!currency) { currency = (c.aedHint || aedHintGlobal) ? "AED" : "USD"; guessed = true; }
    const usd = price == null ? null : currency === "AED" ? Math.round(price / AED_PER_USD) : currency === "USD" ? price : null;
    const cand = {
      name: c.name, make: c.make || null, model: c.model || null, year: c.year || null,
      mileage: c.mileage || null, photos: (c.photos || []).slice(0, 15),
      price_original: price, currency: currency, currency_guessed: guessed,
      price_missing: missing, price_usd: usd,
      source_url: c.source_url || null, import_method: c.import_method || "llm"
    };
    // fill make/model/year from the name when still empty
    if (!cand.make || !cand.year) { const d = deriveMakeModelYear(cand.name); cand.make = cand.make || d.make; cand.model = cand.model || d.model; cand.year = cand.year || d.year; }
    cand.fingerprint = cand.source_url ? "u:" + cand.source_url : "f:" + [cand.make, cand.model, cand.year, cand.price_original].join("|").toLowerCase();
    if (seen.has(cand.fingerprint)) continue;
    seen.add(cand.fingerprint); out.push(cand);
  }
  return out;
}
async function inBatches(items, size, fn) {
  const r = []; for (let i = 0; i < items.length; i += size) r.push(...await Promise.all(items.slice(i, i + size).map(fn))); return r;
}

// ── EXTRACT one batch of detail URLs → candidates ──
async function extractBatch(urls, key) {
  const clean = urls.filter(u => isPublicHttp(u) && !JUNK.test(u)).slice(0, MAX_EXTRACT);
  // concurrency 4 (not 6) — hammering a shared host in parallel gets us throttled
  let docs = (await inBatches(clean, 4, async (u) => {
    if (budgetLeft() < 1200) return null;   // return what we have, never time out
    try {
      const html = await fetchRetry(u, 2);
      const text = stripHtml(html);
      return { url: u, name: pickName(html), photos: detailPhotos(html, u), priceText: priceSnippet(text), aed: /\bAED\b|د\.إ|dirham/i.test(html) };
    } catch (e) { return null; }
  // A real car listing ALWAYS has at least one photo. Requiring one keeps
  // category/marketing pages ("SUV under 3k a month") out of the review
  // screen — and a photo-less car could not be published anyway.
  })).filter(Boolean).filter(d => d.name && d.photos.length);

  // Site chrome (banners, "latest offers" carousel, logos) repeats across many
  // car pages; a real car photo is unique to its page. Drop any image that
  // shows up on 2+ different pages in this batch → clean per-car galleries.
  if (docs.length > 2) {
    const freq = {};
    docs.forEach(d => new Set(d.photos).forEach(p => { freq[p] = (freq[p] || 0) + 1; }));
    docs.forEach(d => { d.photos = d.photos.filter(p => freq[p] < 2); });
    // Re-check AFTER the dedup: pages that only carried shared chrome are left
    // with no photo of their own — those are category/marketing pages, not cars.
    docs = docs.filter(d => d.photos.length);
  }

  // one Groq call per 4 pages for make/model/year/price; key missing or a call
  // failing is non-fatal — name+photos survive, specs get derived from the name.
  let specs = {};
  if (key && docs.length) {
    const indexed = docs.map((d, i) => ({ ...d, i }));
    for (let i = 0; i < indexed.length; i += 4) {
      if (budgetLeft() < 1500) break;   // names + photos already extracted; specs are a bonus
      try { Object.assign(specs, await groqSpecs(key, indexed.slice(i, i + 4))); } catch (e) {}
    }
  }
  return normalize(docs.map((d, i) => {
    const s = specs[i] || {};
    return { name: d.name, make: s.make, model: s.model, year: s.year, mileage: s.mileage, price_original: toInt(s.price), currency: s.currency ? String(s.currency).toUpperCase() : null, photos: d.photos, source_url: d.url, import_method: "details", aedHint: d.aed };
  }), false);
}

exports.handler = async (event) => {
  const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, Authorization", "Content-Type": "application/json" };
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers, body: '{"error":"POST only"}' };
  let body; try { body = JSON.parse(event.body || "{}"); } catch (e) { return { statusCode: 400, headers, body: '{"error":"bad json"}' }; }
  const key = process.env.GROQ_API_KEY;
  const T0 = Date.now();
  const TRACE = [];
  const mark = (label) => { if (body.debug) TRACE.push(label + ":" + (Date.now() - T0)); };
  DEADLINE = Date.now() + TOTAL_BUDGET;   // always answer before the gateway kills us

  try {
    // ── PHASE B: EXTRACT a batch of detail URLs (no crawl, bounded work) ──
    if (body.phase === "extract") {
      const urls = Array.isArray(body.urls) ? body.urls : [];
      if (!urls.length) return { statusCode: 400, headers, body: '{"error":"urls[] required"}' };
      const cars = await extractBatch(urls, key);
      return { statusCode: 200, headers, body: JSON.stringify({ count: cars.length, cars }) };
    }

    // ── PHASE A: DISCOVER ──
    let url = String(body.url || "").trim();
    if (url && !/^https?:\/\//i.test(url)) url = "https://" + url;
    url = url.split("#")[0];
    if (!url || !isPublicHttp(url)) return { statusCode: 400, headers, body: '{"error":"valid public http(s) url required"}' };

    let entryHtml; try { entryHtml = await fetchRetry(url, 2); } catch (e) { return { statusCode: 200, headers, body: JSON.stringify({ error: "unreachable", trace: TRACE }) }; }
    mark("entry(" + Math.round(entryHtml.length / 1024) + "kb)");
    const aedHint = /\bAED\b|د\.إ|dirham/i.test(entryHtml);
    mark("aed");

    // layer 1: JSON-LD — if the entry (and a few next pages) already list the
    // cars with structured data, return them directly; no batching needed.
    let ld = carsFromJsonLd(entryHtml, url);
    mark("jsonld(" + ld.length + ")");
    if (ld.length >= 2) {
      let next = (entryHtml.match(/rel\s*=\s*["']next["'][^>]*href\s*=\s*["']([^"']+)["']/i) || [])[1];
      let guard = 0;
      while (next && ld.length < MAX_CARS_LD && guard < 4) {
        const nu = absUrl(next, url); if (!nu || !sameHost(nu, url)) break;
        let h; try { h = await fetchPage(nu); } catch (e) { break; }
        ld = ld.concat(carsFromJsonLd(h, nu));
        next = (h.match(/rel\s*=\s*["']next["'][^>]*href\s*=\s*["']([^"']+)["']/i) || [])[1]; guard++;
      }
      const cars = normalize(ld, aedHint);
      return { statusCode: 200, headers, body: JSON.stringify({ method: "jsonld", count: cars.length, cars }) };
    }

    // layer 1.5: the site's OWN data feed (Shopify/WordPress/app-data JSON) —
    // what makes JavaScript-only inventory apps work, cleaner than scraping.
    const feed = normalize(await carsFromDataFeeds(entryHtml, url), aedHint);
    mark("feeds(" + feed.length + ")");
    // a big, clean catalog wins outright (no crawl needed)
    if (feed.length >= 12) {
      return { statusCode: 200, headers, body: JSON.stringify({ method: "feed", count: feed.length, cars: feed }) };
    }

    // layer 2: discover the detail-page URLs (client extracts them in batches).
    // The crawl often finds far more cars than a partial feed (e.g. a "most
    // viewed" widget), so a small feed must NOT short-circuit a rich crawl.
    const detailUrls = await collectDetailUrls(url, entryHtml);
    mark("crawl(" + detailUrls.length + ")");
    if (detailUrls.length >= 2 && detailUrls.length >= feed.length) {
      return { statusCode: 200, headers, body: JSON.stringify({ method: "details", total: detailUrls.length, batch: MAX_EXTRACT, urls: detailUrls, trace: TRACE }) };
    }
    // otherwise a usable feed (2–11 cars, richer than the crawl) still works
    if (feed.length >= 2) {
      return { statusCode: 200, headers, body: JSON.stringify({ method: "feed", count: feed.length, cars: feed }) };
    }
    if (detailUrls.length >= 1) {
      return { statusCode: 200, headers, body: JSON.stringify({ method: "details", total: detailUrls.length, batch: MAX_EXTRACT, urls: detailUrls }) };
    }

    // layer 3: whole-page Groq (last resort, single small site)
    const text = cleanForLlm(entryHtml, url);
    if (text.length < 800) return { statusCode: 200, headers, body: JSON.stringify({ spa: true }) };
    if (!key) return { statusCode: 200, headers, body: '{"unavailable":true}' };
    const cars = normalize(await groqWholePage(key, text, url), aedHint);
    if (!cars.length) return { statusCode: 200, headers, body: JSON.stringify({ empty: true }) };
    return { statusCode: 200, headers, body: JSON.stringify({ method: "llm", count: cars.length, cars }) };
  } catch (e) {
    return { statusCode: 200, headers, body: JSON.stringify({ error: String(e.message || e).slice(0, 200) }) };
  }
};
