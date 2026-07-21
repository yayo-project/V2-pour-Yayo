// YAYO — Website Import step 4: re-host photos onto Yayo storage.
// The browser cannot download a photo from another website (cross-origin), so
// this runs server-side: fetch each image, upload it into the dealer's own
// car-photos folder, return the permanent Yayo URLs. Listings then never break
// even if the dealer's site changes.
// POST { token, urls:[…] }  (token = the logged-in dealer's Supabase access token)
//   → { photos:[yayoUrl…] }   (order preserved; failed/oversized images skipped)
// The dealer folder is derived from the VERIFIED user — a caller can only ever
// write into their own dealer's storage.
// Env: SUPABASE_SERVICE_KEY.
const SB_URL = "https://wkjxdkeqffsjarjxlsyh.supabase.co";
const ANON = "sb_publishable_-mDN0Rd9q8q2SJuJPsn_qw_ieHvuSB8";
const MAX_PER_CALL = 10;
const MAX_BYTES = 8 * 1024 * 1024;
const FETCH_TIMEOUT = 9000;

const EXT_BY_MIME = { "image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };

async function timedFetch(url, opts) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT);
  try { return await fetch(url, { ...opts, signal: ctrl.signal }); }
  finally { clearTimeout(timer); }
}

exports.handler = async (event) => {
  const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, Authorization", "Content-Type": "application/json" };
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers, body: '{"error":"POST only"}' };

  const SERVICE = process.env.SUPABASE_SERVICE_KEY;
  if (!SERVICE) return { statusCode: 200, headers, body: '{"error":"server not configured"}' };

  let body; try { body = JSON.parse(event.body || "{}"); } catch (e) { return { statusCode: 400, headers, body: '{"error":"bad json"}' }; }
  const token = String(body.token || "");
  const urls = (Array.isArray(body.urls) ? body.urls : []).filter(u => typeof u === "string" && /^https?:\/\//i.test(u)).slice(0, MAX_PER_CALL);
  if (!token || !urls.length) return { statusCode: 400, headers, body: '{"error":"token and urls[] required"}' };

  // verify the caller and derive THEIR dealer folder (never trust a client id)
  let email;
  try {
    const u = await timedFetch(SB_URL + "/auth/v1/user", { headers: { apikey: ANON, Authorization: "Bearer " + token } });
    if (!u.ok) throw new Error("auth");
    email = (await u.json()).email;
  } catch (e) { return { statusCode: 401, headers, body: '{"error":"not signed in"}' }; }
  if (!email) return { statusCode: 401, headers, body: '{"error":"no email"}' };

  let dealerId;
  try {
    const d = await timedFetch(SB_URL + "/rest/v1/dealers?email=eq." + encodeURIComponent(email) + "&select=id&limit=1", { headers: { apikey: SERVICE, Authorization: "Bearer " + SERVICE } });
    const rows = await d.json();
    dealerId = rows && rows[0] && rows[0].id;
  } catch (e) { /* fall through */ }
  if (!dealerId) return { statusCode: 403, headers, body: '{"error":"no dealer for this account"}' };

  // re-host in small parallel groups; keep input order, drop failures
  const out = new Array(urls.length).fill(null);
  const rehostOne = async (srcUrl, i) => {
    try {
      const r = await timedFetch(srcUrl, { headers: { "User-Agent": "Mozilla/5.0 YayoImportBot/1.0", "Accept": "image/*" } });
      if (!r.ok) return;
      const mime = (r.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
      if (mime && !mime.startsWith("image/")) return;
      const buf = Buffer.from(await r.arrayBuffer());
      if (!buf.length || buf.length > MAX_BYTES) return;
      let ext = EXT_BY_MIME[mime];
      if (!ext) { const m = srcUrl.split("?")[0].match(/\.(jpe?g|png|webp|gif)$/i); ext = m ? m[1].toLowerCase().replace("jpeg", "jpg") : "jpg"; }
      const path = dealerId + "/imported/" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8) + "." + ext;
      const up = await timedFetch(SB_URL + "/storage/v1/object/car-photos/" + path, {
        method: "POST",
        headers: { apikey: SERVICE, Authorization: "Bearer " + SERVICE, "Content-Type": mime || "image/jpeg", "x-upsert": "true" },
        body: buf
      });
      if (!up.ok) return;
      out[i] = SB_URL + "/storage/v1/object/public/car-photos/" + path;
    } catch (e) { /* skip this image */ }
  };
  for (let i = 0; i < urls.length; i += 4) {
    await Promise.all(urls.slice(i, i + 4).map((u, j) => rehostOne(u, i + j)));
  }
  return { statusCode: 200, headers, body: JSON.stringify({ photos: out.filter(Boolean) }) };
};
