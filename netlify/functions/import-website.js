// YAYO — Website Import, step 3 (extraction engine).
// POST { url } → { method:"jsonld"|"llm", pages:[urls], cars:[candidate…] }
// A candidate: { name, make, model, year, price_usd, price_original,
//   currency, currency_guessed, mileage, photos[], source_url,
//   fingerprint, import_method }
// READS ONLY — publishes nothing, writes nothing. Publishing (with photo
// re-hosting into Supabase storage + fingerprint dedupe against the
// dealer's existing listings) happens in step 4 through the Vérifié flow.
// SPA sites (no readable HTML) → { spa:true } so the dashboard can say
// "couldn't read this site, please add manually".

const AED_PER_USD = 3.6725;
const MAX_PAGES = 5;        // first page + up to 4 paginated inventory pages
const MAX_CARS = 60;        // hard cap per import run
const MAX_HTML = 2500000;   // 2.5 MB per page
const FETCH_TIMEOUT = 15000;

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
  // block obvious private/loopback IPs (SSRF guard)
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
        "Accept": "text/html,application/xhtml+xml"
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

// ── JSON-LD extraction (structured data first — most reliable) ──
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
  if (node.itemListElement) {
    flattenLd(node.itemListElement, acc);
  }
  if (node.item) flattenLd(node.item, acc);
  const type = [].concat(node["@type"] || []).map(String);
  if (type.some(t => /^(Car|Vehicle|Product|MotorizedBicycle|Motorcycle)$/i.test(t))) acc.push(node);
}
function imagesOf(node, base) {
  let imgs = node.image || (node.offers && node.offers.image) || [];
  imgs = [].concat(imgs).map(i => (typeof i === "string" ? i : (i && (i.url || i.contentUrl)) || null));
  return imgs.map(u => u && absUrl(u, base)).filter(Boolean);
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

// ── pagination discovery (rel=next + page= links on the same host) ──
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

// ── LLM fallback (Groq) when a site has no usable structured data ──
function cleanForLlm(html, base) {
  // keep image URLs (src + lazy attrs + noscript) — they matter as much as text
  const imgs = new Set();
  const imgRe = /<img[^>]*?(?:src|data-src|data-lazy|data-original|data-srcset)\s*=\s*["']([^"'\s]+)["']/gi;
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
async function groqExtract(key, cleaned, pageUrl) {
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: `You extract used-car listings from dealer-website text. The text contains [IMG url] markers where photos appeared. Return ONLY JSON: {"cars":[{"name":"...","make":"...","model":"...","year":2021,"price":84500,"currency":"AED|USD|null","mileage":45000,"photos":["url",...],"url":"listing url or null"}]}. Rules: one entry per DISTINCT car actually for sale (ignore navigation, brands lists, service pages). photos = the [IMG] urls that clearly belong to that car, in order, max 10. If a value is unknown use null. Never invent cars, prices or photos.` },
        { role: "user", content: "Page: " + pageUrl + "\n\n" + cleaned.text }
      ]
    })
  });
  if (!res.ok) throw new Error("groq " + res.status);
  const data = await res.json();
  const out = JSON.parse(data.choices[0].message.content);
  return (Array.isArray(out.cars) ? out.cars : []).map(c => ({
    name: String(c.name || "").trim().slice(0, 120) || null,
    make: c.make ? String(c.make).trim().slice(0, 40) : null,
    model: c.model ? String(c.model).trim().slice(0, 80) : null,
    year: toInt(c.year),
    price_original: toInt(c.price),
    currency: c.currency ? String(c.currency).toUpperCase() : null,
    mileage: toInt(c.mileage),
    photos: [].concat(c.photos || []).map(u => absUrl(u, pageUrl)).filter(Boolean).slice(0, 15),
    source_url: c.url ? absUrl(c.url, pageUrl) : null,
    import_method: "llm"
  })).filter(c => c.name && c.price_original);
}

// ── normalize: currency → USD, fingerprint, in-run dedupe ──
function normalize(cars, html) {
  const pageMentionsAed = /\bAED\b|د\.إ|dirham/i.test(html);
  const seen = new Set();
  const out = [];
  for (const c of cars) {
    let currency = c.currency;
    let guessed = false;
    if (!currency) {
      // Dubai dealer sites are overwhelmingly AED; a $260,000 "Hilux" is a
      // dirham price. Guess only when the page itself talks dirhams.
      if (pageMentionsAed) { currency = "AED"; guessed = true; }
      else { currency = "USD"; guessed = true; }
    }
    const usd = currency === "AED" ? Math.round(c.price_original / AED_PER_USD)
      : currency === "USD" ? c.price_original : null;
    const cand = { ...c, currency, currency_guessed: guessed, price_usd: usd };
    cand.fingerprint = fingerprintOf(cand);
    if (seen.has(cand.fingerprint)) continue;
    seen.add(cand.fingerprint);
    out.push(cand);
    if (out.length >= MAX_CARS) break;
  }
  return out;
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
  if (url && !/^https?:\/\//i.test(url)) url = "https://" + url;
  url = url.split("#")[0]; // #inventory etc. is client-side only
  if (!url || !isPublicHttp(url)) return { statusCode: 400, headers, body: '{"error":"valid public http(s) url required"}' };

  try {
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
      nextPages(html, pageUrl).forEach(u => { if (!done.has(u)) queue.push(u); });
    }
    if (!pagesRead.length) return { statusCode: 200, headers, body: JSON.stringify({ error: "unreachable" }) };

    let method = "jsonld";
    if (allCars.length < 2) {
      // little/no structured data → let the model read the page itself
      const cleaned = cleanForLlm(firstHtml, url);
      if (cleaned.text.length < 800) {
        return { statusCode: 200, headers, body: JSON.stringify({ spa: true, pages: pagesRead }) };
      }
      const key = process.env.GROQ_API_KEY;
      if (!key) return { statusCode: 200, headers, body: '{"unavailable":true}' };
      const llmCars = await groqExtract(key, cleaned, url);
      if (llmCars.length > allCars.length) { allCars = llmCars; method = "llm"; }
    }

    const cars = normalize(allCars, firstHtml);
    if (!cars.length) return { statusCode: 200, headers, body: JSON.stringify({ empty: true, method, pages: pagesRead }) };
    return { statusCode: 200, headers, body: JSON.stringify({ method, pages: pagesRead, count: cars.length, cars }) };
  } catch (e) {
    return { statusCode: 200, headers, body: JSON.stringify({ error: String(e.message || e).slice(0, 200) }) };
  }
};
