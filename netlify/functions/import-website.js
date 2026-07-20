// YAYO — Website Import, step 3 (extraction engine).
// POST { url, skip? } → { method, pages?, total?, skip?, next_skip?, more?, cars:[candidate…] }
// A candidate: { name, make, model, year, price_usd, price_original,
//   currency, currency_guessed, mileage, photos[], source_url,
//   fingerprint, import_method }
// READS ONLY — publishes nothing, writes nothing. Publishing (photo
// re-hosting into Supabase storage + dedupe against the dealer's existing
// listings) happens in step 4 through the Vérifié flow.
//
// Three extraction layers, most reliable first:
//   1. JSON-LD / schema.org on the entry page (Car/Vehicle/Product).
//   2. Detail-page discovery — listing links found on the page AND in the
//      site's sitemap(s) (/listings/, /vehicle/, /cars/…), fetched in
//      parallel batches of 12 per run (skip → next batch), photos taken
//      deterministically (og:image + gallery, WP size suffix stripped),
//      Groq extracts name/price/specs from the page TEXT only.
//   3. Whole-page Groq extraction as the last resort.
// True SPA with nothing readable → { spa:true }.

const AED_PER_USD = 3.6725;
const MAX_PAGES = 5;         // entry page + paginated inventory pages
const MAX_CARS = 60;         // hard cap per run
const DETAIL_BATCH = 12;     // detail pages fetched per run (skip continues)
const MAX_HTML = 2500000;
const FETCH_TIMEOUT = 12000;
const LISTING_PATH = /\/(listings?|vehicles?|cars?|inventory|voitures?|annonces?|stock|product)\/[^"'\s]{3,}/i;

// ── tiny helpers ──────────────────────────────────────────────
function absUrl(u, base) {
  try { return new URL(u, base).href; } catch (e) { return null; }
}
function isPublicHttp(u) {
  let p;
  try { p = new URL(u); } catch (e) { return false; }
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
      signal: ctrl.signal,
      redirect: "follow",
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
function toInt(x) {
  if (x == null) return null;
  const n = parseInt(String(x).replace(/[^\d]/g, ""), 10);
  return isNaN(n) ? null : n;
}
function fingerprintOf(c) {
  if (c.source_url) return "u:" + c.source_url;
  return "f:" + [c.make, c.model, c.year, c.price_original].map(x => String(x || "").toLowerCase().trim()).join("|");
}
// WP serves resized copies (…-798x466.jpeg) — the original has no suffix
function unsizeImg(u) { return u.replace(/-\d{2,4}x\d{2,4}(\.(?:jpe?g|png|webp))/i, "$1"); }

// ── layer 1: JSON-LD extraction ───────────────────────────────
function jsonLdBlocks(html) {
  const out = [];
  const re = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    try { out.push(JSON.parse(m[1].trim())); } catch (e) { /* tolerate broken blocks */ }
  }
  return out;
}
function flattenLd(node, acc) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) { node.forEach(n => flattenLd(n, acc)); return; }
  if (node["@graph"]) flattenLd(node["@graph"], acc);
  if (node.itemListElement) flattenLd(node.itemListElement, acc);
  if (node.item) flattenLd(node.item, acc);
  const type = [].concat(node["@type"] || []).map(String);
  if (type.some(t => /^(Car|Vehicle|Product|Motorcycle)$/i.test(t))) acc.push(node);
}
function imagesOf(node, base) {
  let imgs = node.image || (node.offers && node.offers.image) || [];
  imgs = [].concat(imgs).map(i => (typeof i === "string" ? i : (i && (i.url || i.contentUrl)) || null));
  return imgs.map(u => u && absUrl(u, base)).filter(Boolean).map(unsizeImg);
}
function carsFromJsonLd(html, pageUrl) {
  const acc = [];
  jsonLdBlocks(html).forEach(b => flattenLd(b, acc));
  return acc.map(n => {
    const offers = [].concat(n.offers || [])[0] || {};
    const brand = n.brand ? (typeof n.brand === "string" ? n.brand : n.brand.name) : null;
    const mileage = n.mileageFromOdometer
      ? (typeof n.mileageFromOdometer === "object" ? n.mileageFromOdometer.value : n.mileageFromOdometer)
      : null;
    const year = n.vehicleModelDate || n.productionDate || n.releaseDate || n.modelDate || null;
    return {
      name: String(n.name || "").trim().slice(0, 120) || null,
      make: brand ? String(brand).trim().slice(0, 40) : null,
      model: n.model ? String(typeof n.model === "string" ? n.model : n.model.name || "").trim().slice(0, 80) : null,
      year: toInt(String(year || "").slice(0, 4)),
      price_original: toInt(offers.price != null ? offers.price : n.price),
      currency: String(offers.priceCurrency || n.priceCurrency || "").toUpperCase() || null,
      mileage: toInt(mileage),
      photos: imagesOf(n, pageUrl).slice(0, 15),
      source_url: n.url ? absUrl(typeof n.url === "string" ? n.url : n.url["@id"] || "", pageUrl) : null,
      import_method: "jsonld"
    };
  }).filter(c => c.name && c.price_original);
}

// ── pagination discovery on the entry page ────────────────────
function nextPages(html, pageUrl) {
  const urls = new Set();
  const rel = html.match(/<a[^>]*rel\s*=\s*["']next["'][^>]*href\s*=\s*["']([^"']+)["']/i)
    || html.match(/<link[^>]*rel\s*=\s*["']next["'][^>]*href\s*=\s*["']([^"']+)["']/i);
  if (rel) { const u = absUrl(rel[1], pageUrl); if (u) urls.add(u); }
  const re = /<a[^>]*href\s*=\s*["']([^"']*(?:[?&]page=|\/page\/|[?&]paged=)[^"']*)["']/gi;
  let m;
  while ((m = re.exec(html))) {
    const u = absUrl(m[1], pageUrl);
    if (u && new URL(u).host === new URL(pageUrl).host) urls.add(u);
  }
  return [...urls];
}

// ── layer 2: detail-page discovery (anchors + sitemaps) ───────
function listingLinksFrom(html, baseUrl) {
  const urls = new Set();
  const host = new URL(baseUrl).host;
  const re = /<a[^>]*href\s*=\s*["']([^"'#\s]+)["']/gi;
  let m;
  while ((m = re.exec(html))) {
    const u = absUrl(m[1], baseUrl);
    if (u && new URL(u).host === host && LISTING_PATH.test(new URL(u).pathname)) urls.add(u.split("#")[0]);
  }
  return [...urls];
}
function urlsFromSitemapXml(xml) {
  const out = [];
  const re = /<loc>\s*([^<\s]+)\s*<\/loc>/gi;
  let m;
  while ((m = re.exec(xml))) out.push(m[1]);
  return out;
}
async function sitemapListingUrls(origin) {
  const tried = ["/sitemap.xml", "/sitemap_index.xml", "/wp-sitemap.xml"];
  let queue = [];
  for (const p of tried) {
    try { queue.push({ url: origin + p, xml: await fetchPage(origin + p) }); break; } catch (e) { /* next */ }
  }
  const listings = new Set();
  let hops = 0;
  while (queue.length && hops < 8 && listings.size < 400) {
    const { xml } = queue.shift();
    hops++;
    const locs = urlsFromSitemapXml(xml);
    for (const u of locs) {
      if (/\.xml(\?|$)/i.test(u)) {
        // follow sub-sitemaps that look like they hold posts/listings
        if (/listing|vehicle|car|product|post/i.test(u) && queue.length < 6) {
          try { queue.push({ url: u, xml: await fetchPage(u) }); } catch (e) { /* skip */ }
        }
      } else if (LISTING_PATH.test(new URL(u).pathname || "")) {
        listings.add(u.split("#")[0]);
      }
    }
  }
  return [...listings];
}
// og: meta + gallery photos from a detail page (deterministic — no AI)
function detailPhotos(html, pageUrl) {
  const set = new Set();
  const og = html.match(/<meta[^>]*property\s*=\s*["']og:image["'][^>]*content\s*=\s*["']([^"']+)["']/i)
    || html.match(/<meta[^>]*content\s*=\s*["']([^"']+)["'][^>]*property\s*=\s*["']og:image["']/i);
  if (og) { const u = absUrl(og[1], pageUrl); if (u) set.add(unsizeImg(u)); }
  const re = /<img[^>]*?(?:src|data-src|data-lazy|data-original)\s*=\s*["']([^"'\s]+\.(?:jpe?g|png|webp)[^"'\s]*)["']/gi;
  let m;
  while ((m = re.exec(html))) {
    const u = absUrl(m[1], pageUrl);
    if (!u) continue;
    if (/logo|icon|avatar|placeholder|banner|sprite|design/i.test(u)) continue;
    set.add(unsizeImg(u));
    if (set.size >= 15) break;
  }
  return [...set];
}
function detailText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&amp;|&quot;|&#\d+;/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 2600);
}

// ── Groq calls ────────────────────────────────────────────────
async function groqJson(key, system, user) {
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [{ role: "system", content: system }, { role: "user", content: user }]
    })
  });
  if (!res.ok) throw new Error("groq " + res.status);
  const data = await res.json();
  return JSON.parse(data.choices[0].message.content);
}
// extract specs from SEVERAL detail-page texts in one call (cheap + fast)
async function groqDetails(key, docs) {
  const out = await groqJson(key,
    `You extract ONE used/new car from each dealer listing page text. Return ONLY JSON: {"cars":[{"i":<index>,"name":"...","make":"...","model":"...","year":2026,"price":90000,"currency":"AED|USD|null","mileage":0}]} — one entry per input index. Rules: "price" = the price a buyer pays NOW (if there is an old price and a sale/discounted price, use the sale price). If no price is visible use null. Never invent values; unknown = null. name = short car title (max 90 chars).`,
    JSON.stringify(docs.map((d, i) => ({ i, url: d.url, text: d.text }))));
  const map = {};
  (Array.isArray(out.cars) ? out.cars : []).forEach(c => { if (c && c.i != null) map[c.i] = c; });
  return map;
}
// last-resort whole-page extraction (layer 3)
function cleanForLlm(html, base) {
  const imgs = new Set();
  const imgRe = /<img[^>]*?(?:src|data-src|data-lazy|data-original)\s*=\s*["']([^"'\s]+)["']/gi;
  let m;
  while ((m = imgRe.exec(html))) {
    const u = absUrl(m[1].split(" ")[0], base);
    if (u && /^https?:/.test(u) && !/\.(svg|gif|ico)(\?|$)/i.test(u)) imgs.add(u);
  }
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<img[^>]*?(?:src|data-src)\s*=\s*["']([^"']+)["'][^>]*>/gi, " [IMG $1] ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&amp;|&quot;|&#\d+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return { text: text.slice(0, 20000), imgs: [...imgs].slice(0, 200) };
}
async function groqWholePage(key, cleaned, pageUrl) {
  const out = await groqJson(key,
    `You extract used-car listings from dealer-website text. The text contains [IMG url] markers where photos appeared. Return ONLY JSON: {"cars":[{"name":"...","make":"...","model":"...","year":2021,"price":84500,"currency":"AED|USD|null","mileage":45000,"photos":["url"],"url":"listing url or null"}]}. One entry per DISTINCT car actually for sale (ignore navigation, brand lists, service pages). photos = the [IMG] urls clearly belonging to that car, max 10. Unknown = null. Never invent cars, prices or photos.`,
    "Page: " + pageUrl + "\n\n" + cleaned.text);
  return (Array.isArray(out.cars) ? out.cars : []).map(c => ({
    name: String(c.name || "").trim().slice(0, 120) || null,
    make: c.make ? String(c.make).trim().slice(0, 40) : null,
    model: c.model ? String(c.model).trim().slice(0, 80) : null,
    year: toInt(c.year),
    price_original: toInt(c.price),
    currency: c.currency ? String(c.currency).toUpperCase() : null,
    mileage: toInt(c.mileage),
    photos: [].concat(c.photos || []).map(u => absUrl(u, pageUrl)).filter(Boolean).map(unsizeImg).slice(0, 15),
    source_url: c.url ? absUrl(c.url, pageUrl) : null,
    import_method: "llm"
  })).filter(c => c.name && c.price_original);
}

// ── normalize: currency → USD, fingerprint, in-run dedupe ─────
function normalize(cars, htmlHint) {
  const pageMentionsAed = /\bAED\b|د\.إ|dirham/i.test(htmlHint || "");
  const seen = new Set();
  const out = [];
  for (const c of cars) {
    let currency = c.currency;
    let guessed = false;
    if (!currency) {
      if (pageMentionsAed || c.aedHint) { currency = "AED"; guessed = true; }
      else { currency = "USD"; guessed = true; }
    }
    const usd = currency === "AED" ? Math.round(c.price_original / AED_PER_USD)
      : currency === "USD" ? c.price_original : null;
    const cand = { ...c, currency, currency_guessed: guessed, price_usd: usd };
    delete cand.aedHint;
    cand.fingerprint = fingerprintOf(cand);
    if (seen.has(cand.fingerprint)) continue;
    seen.add(cand.fingerprint);
    out.push(cand);
    if (out.length >= MAX_CARS) break;
  }
  return out;
}

async function inBatches(items, size, fn) {
  const results = [];
  for (let i = 0; i < items.length; i += size) {
    const part = await Promise.all(items.slice(i, i + size).map(fn));
    results.push(...part);
  }
  return results;
}

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Content-Type": "application/json"
  };
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers, body: '{"error":"POST only"}' };

  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch (e) { return { statusCode: 400, headers, body: '{"error":"bad json"}' }; }

  let url = String(body.url || "").trim();
  const skip = Math.max(0, parseInt(body.skip, 10) || 0);
  if (url && !/^https?:\/\//i.test(url)) url = "https://" + url;
  url = url.split("#")[0];
  if (!url || !isPublicHttp(url)) return { statusCode: 400, headers, body: '{"error":"valid public http(s) url required"}' };

  try {
    // ── layer 1: entry page(s) + JSON-LD ──
    const pagesRead = [];
    let allCars = [];
    let firstHtml = "";
    let queue = [url];
    const done = new Set();
    while (queue.length && pagesRead.length < MAX_PAGES && allCars.length < MAX_CARS) {
      const pageUrl = queue.shift();
      if (done.has(pageUrl)) continue;
      done.add(pageUrl);
      let html;
      try { html = await fetchPage(pageUrl); } catch (e) { continue; }
      if (!firstHtml) firstHtml = html;
      pagesRead.push(pageUrl);
      allCars = allCars.concat(carsFromJsonLd(html, pageUrl));
      if (allCars.length) nextPages(html, pageUrl).forEach(u => { if (!done.has(u)) queue.push(u); });
    }
    if (!pagesRead.length) return { statusCode: 200, headers, body: JSON.stringify({ error: "unreachable" }) };
    if (allCars.length >= 2) {
      const cars = normalize(allCars, firstHtml);
      return { statusCode: 200, headers, body: JSON.stringify({ method: "jsonld", pages: pagesRead, count: cars.length, cars }) };
    }

    const key = process.env.GROQ_API_KEY;

    // ── layer 2: detail pages from anchors + sitemap ──
    let detailUrls = listingLinksFrom(firstHtml, url);
    if (detailUrls.length < 3) {
      const fromMap = await sitemapListingUrls(new URL(url).origin);
      const set = new Set(detailUrls);
      fromMap.forEach(u => set.add(u));
      detailUrls = [...set];
    }
    if (detailUrls.length) {
      const total = detailUrls.length;
      const batch = detailUrls.slice(skip, skip + DETAIL_BATCH);
      const docs = (await inBatches(batch, 6, async (u) => {
        try {
          const html = await fetchPage(u);
          return { url: u, text: detailText(html), photos: detailPhotos(html, u), aed: /\bAED\b|د\.إ|dirham/i.test(html) };
        } catch (e) { return null; }
      })).filter(Boolean);
      if (docs.length) {
        if (!key) return { statusCode: 200, headers, body: '{"unavailable":true}' };
        // 4 pages per model call → 12 pages = 3 calls, well inside limits
        let cars = [];
        for (let i = 0; i < docs.length; i += 4) {
          const chunk = docs.slice(i, i + 4);
          try {
            const map = await groqDetails(key, chunk);
            chunk.forEach((d, j) => {
              const c = map[j];
              if (!c || !c.name || c.price == null) return;
              cars.push({
                name: String(c.name).trim().slice(0, 120),
                make: c.make ? String(c.make).trim().slice(0, 40) : null,
                model: c.model ? String(c.model).trim().slice(0, 80) : null,
                year: toInt(c.year),
                price_original: toInt(c.price),
                currency: c.currency ? String(c.currency).toUpperCase() : null,
                mileage: toInt(c.mileage),
                photos: d.photos,
                source_url: d.url,
                import_method: "llm",
                aedHint: d.aed
              });
            });
          } catch (e) { /* chunk failed — keep going */ }
        }
        cars = normalize(cars.filter(c => c.price_original), firstHtml);
        const next = skip + DETAIL_BATCH;
        return {
          statusCode: 200, headers, body: JSON.stringify({
            method: "details", pages: pagesRead, total, skip,
            next_skip: next < total ? next : null, more: next < total,
            count: cars.length, cars
          })
        };
      }
    }

    // ── layer 3: whole-page LLM ──
    const cleaned = cleanForLlm(firstHtml, url);
    if (cleaned.text.length < 800) {
      return { statusCode: 200, headers, body: JSON.stringify({ spa: true, pages: pagesRead }) };
    }
    if (!key) return { statusCode: 200, headers, body: '{"unavailable":true}' };
    const llmCars = normalize(await groqWholePage(key, cleaned, url), firstHtml);
    if (!llmCars.length) return { statusCode: 200, headers, body: JSON.stringify({ empty: true, pages: pagesRead }) };
    return { statusCode: 200, headers, body: JSON.stringify({ method: "llm", pages: pagesRead, count: llmCars.length, cars: llmCars }) };
  } catch (e) {
    return { statusCode: 200, headers, body: JSON.stringify({ error: String(e.message || e).slice(0, 200) }) };
  }
};
