// ═══════════════════════════════════════════════
// YAYO — Dynamic sitemap
// Static pages + every LIVE listing (active, unsold, not hidden, approved
// dealer) so Google indexes each real car as its own result. Served at
// /sitemap.xml via a redirect in netlify.toml.
//
// Cars use their pretty URL (/voiture/toyota-camry-2024-<uuid>) — the same
// address car-page.js declares as canonical, so nothing competes with itself.
// Static pages also declare their FR / EN / AR versions via hreflang, which
// is what lets the English pages rank in the Gulf, Nigeria and the diaspora
// markets instead of only the French ones ranking in Africa.
// ═══════════════════════════════════════════════
const SUPABASE_URL = "https://wkjxdkeqffsjarjxlsyh.supabase.co";
const SB_ANON = "sb_publishable_-mDN0Rd9q8q2SJuJPsn_qw_ieHvuSB8";
const SITE = "https://yayo.digital";

// [path, priority, translated?] — pages the buyer sees exist in all three
// languages; seller/legal pages are indexed once.
const STATIC = [
  ["", "1.0", true],
  ["acheter.html", "0.9", true],
  // The crawlable index of every car. It is the only page on the site whose
  // HTML actually links to a car page, so it is the route by which the 685
  // car URLs stop being orphans. It is not translated: it is a list of links.
  ["voitures", "0.9", false],
  ["importer-voiture-dubai-kinshasa.html", "0.8", true],
  ["importer-voiture-dubai-douala.html", "0.8", true],
  ["importer-voiture-dubai-abidjan.html", "0.8", true],
  ["importer-voiture-dubai-dakar.html", "0.8", true],
  ["a-propos.html", "0.8", true],
  ["comment.html", "0.7", true],
  ["vendre.html", "0.7", true],
  ["expedier.html", "0.7", true],
  ["agences.html", "0.5", true],
  ["conditions.html", "0.3", false]
];

// Brand-by-city guides ("Importer une Toyota de Dubai à Kinshasa"). These are
// real files in the repo, one per make per city, generated only for makes with
// enough cars in stock — so the list is fixed here rather than derived from
// live inventory, which could otherwise point the sitemap at a 404.
const BRAND_SLUGS = [
  "toyota", "mitsubishi", "isuzu", "suzuki", "hino", "nissan", "mercedes-benz",
  "bmw", "mitsubishi-fuso", "honda", "peugeot", "mg", "hyundai", "ford",
  "jetour", "daihatsu", "jeep", "land-rover", "cadillac", "mazda", "man"
];
const BRAND_CITIES = ["kinshasa", "douala", "abidjan", "dakar"];

const esc = s => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&apos;");

function slugify(s) {
  return String(s || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "").slice(0, 60);
}

function carSlug(l) {
  const make = /^\d{4}$/.test(String(l.make || "").trim()) ? "" : (l.make || "");
  const title = [make, l.model].filter(Boolean).join(" ") || l.car_name || "voiture";
  return [slugify(title), l.year ? String(l.year) : "", l.id].filter(Boolean).join("-");
}

function altLinks(pathname) {
  const u = l => `${SITE}/${pathname}${pathname.includes("?") ? "&" : "?"}lang=${l}`.replace(/\?lang=fr$/, "");
  return [
    `    <xhtml:link rel="alternate" hreflang="fr" href="${esc(SITE + "/" + pathname)}"/>`,
    `    <xhtml:link rel="alternate" hreflang="en" href="${esc(u("en"))}"/>`,
    `    <xhtml:link rel="alternate" hreflang="ar" href="${esc(u("ar"))}"/>`,
    `    <xhtml:link rel="alternate" hreflang="x-default" href="${esc(SITE + "/" + pathname)}"/>`
  ].join("\n");
}

exports.handler = async () => {
  const key = process.env.SUPABASE_SERVICE_KEY || SB_ANON;
  let cars = [];
  try {
    const r = await fetch(
      // approved = allowed to trade (the badge is a separate thing, §38)
      `${SUPABASE_URL}/rest/v1/listings?select=id,car_name,make,model,year,photo_url,created_at,hidden,dormant,dealers!inner(approved,suspended)&active=eq.true&sold=eq.false&dealers.approved=eq.true&dealers.suspended=eq.false&order=created_at.desc&limit=5000`,
      { headers: { apikey: key, authorization: `Bearer ${key}` } }
    );
    if (r.ok) cars = (await r.json()).filter(l => !l.hidden && !l.dormant);
  } catch (e) { /* static part still serves */ }

  const urls = [];

  for (const [p, pr, translated] of STATIC) {
    urls.push(
      `  <url>\n    <loc>${esc(SITE + "/" + p)}</loc>\n` +
      (translated ? altLinks(p) + "\n" : "") +
      `    <priority>${pr}</priority>\n  </url>`
    );
  }

  for (const mk of BRAND_SLUGS) {
    for (const city of BRAND_CITIES) {
      const p = `importer-${mk}-dubai-${city}.html`;
      urls.push(
        `  <url>\n    <loc>${esc(SITE + "/" + p)}</loc>\n` +
        altLinks(p) + `\n    <priority>0.6</priority>\n  </url>`
      );
    }
  }

  for (const l of cars) {
    const loc = `${SITE}/voiture/${carSlug(l)}`;
    const img = l.photo_url
      ? `\n    <image:image><image:loc>${esc(l.photo_url)}</image:loc></image:image>`
      : "";
    urls.push(
      `  <url>\n    <loc>${esc(loc)}</loc>\n` +
      `    <lastmod>${(l.created_at || "").slice(0, 10)}</lastmod>${img}\n` +
      `    <priority>0.7</priority>\n  </url>`
    );
  }

  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"` +
    ` xmlns:xhtml="http://www.w3.org/1999/xhtml"` +
    ` xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n` +
    urls.join("\n") + `\n</urlset>\n`;

  return {
    statusCode: 200,
    headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=3600" },
    body: xml
  };
};
