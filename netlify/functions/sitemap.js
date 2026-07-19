// ═══════════════════════════════════════════════
// YAYO — Dynamic sitemap
// Static pages + every LIVE listing (active, unsold,
// not hidden, verified dealer) so Google indexes each
// real car as its own result. Served at /sitemap.xml
// via a redirect in netlify.toml.
// ═══════════════════════════════════════════════
const SUPABASE_URL = "https://wkjxdkeqffsjarjxlsyh.supabase.co";

const STATIC = [
  ["", "1.0"],
  ["acheter.html", "0.9"],
  ["importer-voiture-dubai-kinshasa.html", "0.8"],
  ["importer-voiture-dubai-douala.html", "0.8"],
  ["importer-voiture-dubai-abidjan.html", "0.8"],
  ["importer-voiture-dubai-dakar.html", "0.8"],
  ["comment.html", "0.7"],
  ["vendre.html", "0.7"],
  ["expedier.html", "0.7"],
  ["agences.html", "0.5"],
  ["conditions.html", "0.3"]
];

exports.handler = async () => {
  const key = process.env.SUPABASE_SERVICE_KEY;
  let cars = [];
  if (key) {
    try {
      // service role: join dealers to only expose listings buyers can see
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/listings?select=id,created_at,hidden,dealers!inner(verified,suspended)&active=eq.true&sold=eq.false&dealers.verified=eq.true&dealers.suspended=eq.false&order=created_at.desc&limit=1000`,
        { headers: { apikey: key, authorization: `Bearer ${key}` } }
      );
      if (r.ok) cars = (await r.json()).filter(l => !l.hidden);
    } catch (e) { /* static part still serves */ }
  }

  const urls = STATIC.map(([p, pr]) =>
    `  <url><loc>https://yayo.digital/${p}</loc><priority>${pr}</priority></url>`
  ).concat(cars.map(l =>
    `  <url><loc>https://yayo.digital/voiture.html?id=${l.id}</loc><lastmod>${(l.created_at || "").slice(0, 10)}</lastmod><priority>0.7</priority></url>`
  ));

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`;
  return {
    statusCode: 200,
    headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=3600" },
    body: xml
  };
};
