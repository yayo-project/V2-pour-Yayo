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
const FETCH_TIMEOUT = 9000;

// A path that looks like ONE car's page (segment keyword + a slug after it).
const DETAIL_PATH = /\/(listings?|vehicles?|cars?|voitures?|annonces?|autos?|stock|product|item|details?|inventory)[\/-][a-z0-9][\w%-]{2,}/i;
// A query that identifies ONE car, e.g. product.php?product=slug, ?vid=123.
const DETAIL_QUERY = /[?&](product|car|vehicle|listing|item|vid|pid|carid|stockid|auto|ref)=[a-z0-9][\w%-]{2,}/i;
// An index/inventory page worth crawling for more detail links.
const INDEX_HINT = /[?&](category|make|brand|browse|type|page|paged|serie|model|body|fuel)=|\/(category|categories|inventory|browse|shop|stock|listings?|vehicles?|cars?|collection)(\/|\.php|$|\?)/i;
// Never treat these as cars.
const JUNK = /(cart|login|signin|signup|register|account|wishlist|favou?rite|contact|about|blog|news|video|privacy|terms|policy|faq|checkout|compare|\.(?:jpg|jpeg|png|webp|gif|svg|css|js|pdf|xml)(?:\?|$))/i;

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
async function fetchPage(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal, redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36 YayoImportBot/1.0",
        "Accept": "text/html,application/xhtml+xml,application/xml"
      }
    });
    if (!res.ok) throw new Error("http " + res.status);
    const text = await res.text();
    return text.length > MAX_HTML ? text.slice(0, MAX_HTML) : text;
  } finally { clearTimeout(timer); }
}
async function fetchRetry(url, tries) {
  let err;
  for (let i = 0; i < (tries || 2); i++) {
    try { return await fetchPage(url); } catch (e) { err = e; }
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
    if (DETAIL_QUERY.test(query) || DETAIL_PATH.test(path)) details.add(u);
    else if (INDEX_HINT.test(query + " " + path)) indexes.add(u);
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
        try { const p = new URL(u); if (DETAIL_QUERY.test(p.search) || DETAIL_PATH.test(p.pathname)) details.add(u.split("#")[0]); } catch (e) {}
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
  const push = u => { if (!u) return; const a = absUrl(u, pageUrl); if (!a) return; if (/logo|icon|avatar|placeholder|banner|sprite|design|flag|whatsapp|payment/i.test(a)) return; if (!/\.(jpe?g|png|webp)(\?|$)/i.test(a)) return; set.add(unsizeImg(a)); };
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
  const docs = (await inBatches(clean, 6, async (u) => {
    try {
      const html = await fetchRetry(u, 2);
      const text = stripHtml(html);
      return { url: u, name: pickName(html), photos: detailPhotos(html, u), priceText: priceSnippet(text), aed: /\bAED\b|د\.إ|dirham/i.test(html) };
    } catch (e) { return null; }
  })).filter(Boolean).filter(d => d.name || d.photos.length);

  // one Groq call per 4 pages for make/model/year/price; key missing or a call
  // failing is non-fatal — name+photos survive, specs get derived from the name.
  let specs = {};
  if (key && docs.length) {
    const indexed = docs.map((d, i) => ({ ...d, i }));
    for (let i = 0; i < indexed.length; i += 4) {
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

    let entryHtml; try { entryHtml = await fetchRetry(url, 2); } catch (e) { return { statusCode: 200, headers, body: JSON.stringify({ error: "unreachable" }) }; }
    const aedHint = /\bAED\b|د\.إ|dirham/i.test(entryHtml);

    // layer 1: JSON-LD — if the entry (and a few next pages) already list the
    // cars with structured data, return them directly; no batching needed.
    let ld = carsFromJsonLd(entryHtml, url);
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

    // layer 2: discover the detail-page URLs (client extracts them in batches)
    const detailUrls = await collectDetailUrls(url, entryHtml);
    if (detailUrls.length) {
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
