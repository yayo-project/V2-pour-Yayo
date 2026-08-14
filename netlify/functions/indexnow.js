// ═══════════════════════════════════════════════
// YAYO — IndexNow ping
//
// Google finds pages on its own schedule. Bing, Yandex and Seznam accept a
// direct "these URLs changed" signal through IndexNow, free and without any
// account: they fetch the key file at the site root to prove we own the
// domain, then crawl what we listed.
//
// Reads the live sitemap so it always submits exactly what is public — the
// brand guides and every car currently for sale.
//
// GET /.netlify/functions/indexnow           → submit everything
// It is also safe to call repeatedly; IndexNow expects repeat submissions
// when content changes.
// ═══════════════════════════════════════════════
const SITE = "yayo.digital";
const KEY = "9e385d942c553dea82e91905bff263fe";

exports.handler = async () => {
  let urls = [];
  try {
    const r = await fetch(`https://${SITE}/sitemap.xml`, { headers: { "user-agent": "yayo-indexnow" } });
    if (r.ok) {
      const xml = await r.text();
      urls = (xml.match(/<loc>([^<]+)<\/loc>/g) || [])
        .map(m => m.replace(/<\/?loc>/g, "").trim())
        .filter(Boolean);
    }
  } catch (e) { /* reported below */ }

  if (!urls.length) {
    return { statusCode: 502, body: JSON.stringify({ ok: false, error: "sitemap unreadable" }) };
  }

  // IndexNow accepts up to 10 000 URLs per call
  const batch = urls.slice(0, 10000);
  let status = 0, text = "";
  try {
    const res = await fetch("https://api.indexnow.org/indexnow", {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        host: SITE,
        key: KEY,
        keyLocation: `https://${SITE}/${KEY}.txt`,
        urlList: batch
      })
    });
    status = res.status;
    text = (await res.text()).slice(0, 200);
  } catch (e) {
    return { statusCode: 502, body: JSON.stringify({ ok: false, error: String(e.message || e) }) };
  }

  // 200 = accepted, 202 = accepted and pending validation of the key file
  return {
    statusCode: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ok: status === 200 || status === 202, submitted: batch.length, status, text })
  };
};
