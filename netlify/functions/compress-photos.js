// YAYO — one-time (and repeatable) shrink of photos ALREADY in Storage.
//
// Why: the 664 imported cars were re-hosted at whatever size the dealer's own
// website served — often 4 000 px and 3-4 MB each. Yayo never displays a photo
// larger than ~1 600 px, so every one of those extra megabytes is paid twice:
// once in storage, and again in bandwidth every time a buyer opens the car.
//
// How: each object is passed through Netlify's own Image CDN (free, already
// part of the site) and written back OVER THE SAME PATH. Nothing in the
// database changes — every photo_url keeps working, no listing is touched.
//
// Safety rules, in order of importance:
//   • Only JPEG/WebP are touched. PNG is skipped, because logos use PNG
//     transparency and JPEG would turn it black.
//   • The rewrite only happens if the new file is genuinely smaller.
//   • Objects already below MIN_BYTES are skipped, which makes the whole job
//     idempotent: run it twice and the second run finds almost nothing to do.
//   • Never touches the private "licenses" bucket — a trade licence must stay
//     exactly as the dealer uploaded it.
//
// Stateless and resumable: the caller passes the walk state back each time, so
// the admin dashboard can drive it with a progress bar and stop at any point.
//
// POST { token, bucket, state? } → { done, state, stats }
// Env: SUPABASE_SERVICE_KEY.

const SB_URL = "https://wkjxdkeqffsjarjxlsyh.supabase.co";
const ANON = "sb_publishable_-mDN0Rd9q8q2SJuJPsn_qw_ieHvuSB8";

const ALLOWED_BUCKETS = ["car-photos", "agency-photos"];
const PAGE = 24;                    // objects listed per page
const PARALLEL = 4;                 // images processed at once
const MIN_BYTES = 300 * 1024;       // below this, not worth rewriting
const MAX_BYTES = 25 * 1024 * 1024; // above this, something is wrong — skip
const WIDTH = 1600;                 // longest edge Yayo ever displays
const QUALITY = 78;
const BUDGET_MS = 7500;             // leave room inside Netlify's 10s limit
const FETCH_TIMEOUT = 8000;

async function timedFetch(url, opts) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT);
  try { return await fetch(url, { ...(opts || {}), signal: ctrl.signal }); }
  finally { clearTimeout(timer); }
}

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Content-Type": "application/json; charset=utf-8"
  };
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers, body: '{"error":"POST only"}' };

  const SERVICE = process.env.SUPABASE_SERVICE_KEY;
  if (!SERVICE) return { statusCode: 200, headers, body: '{"error":"server not configured"}' };
  const SITE = (process.env.URL || process.env.DEPLOY_PRIME_URL || "").replace(/\/$/, "");
  if (!SITE) return { statusCode: 200, headers, body: '{"error":"no site url"}' };

  let body; try { body = JSON.parse(event.body || "{}"); }
  catch (e) { return { statusCode: 400, headers, body: '{"error":"bad json"}' }; }

  const token = String(body.token || "");
  const bucket = ALLOWED_BUCKETS.includes(body.bucket) ? body.bucket : ALLOWED_BUCKETS[0];
  if (!token) return { statusCode: 400, headers, body: '{"error":"token required"}' };

  // ── only a super admin may rewrite stored files ──
  let email;
  try {
    const u = await timedFetch(SB_URL + "/auth/v1/user", { headers: { apikey: ANON, Authorization: "Bearer " + token } });
    if (!u.ok) throw new Error("auth");
    email = (await u.json()).email;
  } catch (e) { return { statusCode: 401, headers, body: '{"error":"not signed in"}' }; }
  if (!email) return { statusCode: 401, headers, body: '{"error":"no email"}' };

  const svc = { apikey: SERVICE, Authorization: "Bearer " + SERVICE };
  try {
    const a = await timedFetch(SB_URL + "/rest/v1/admin_users?email=eq." + encodeURIComponent(email) + "&select=role&limit=1", { headers: svc });
    const rows = await a.json();
    if (!rows || !rows[0] || rows[0].role !== "super_admin") {
      return { statusCode: 403, headers, body: '{"error":"super admin only"}' };
    }
  } catch (e) { return { statusCode: 403, headers, body: '{"error":"cannot check admin"}' }; }

  // ── walk state, handed back and forth with the browser ──
  const inState = body.state && typeof body.state === "object" ? body.state : {};
  const queue = Array.isArray(inState.queue) ? inState.queue.slice(0, 400) : [""];
  let offset = Number(inState.offset) || 0;
  const stats = {
    listed: Number((inState.stats || {}).listed) || 0,
    rewritten: Number((inState.stats || {}).rewritten) || 0,
    skipped: Number((inState.stats || {}).skipped) || 0,
    failed: Number((inState.stats || {}).failed) || 0,
    savedBytes: Number((inState.stats || {}).savedBytes) || 0
  };

  const started = Date.now();
  const left = () => BUDGET_MS - (Date.now() - started);

  async function listPage(prefix) {
    const r = await timedFetch(SB_URL + "/storage/v1/object/list/" + bucket, {
      method: "POST",
      headers: { ...svc, "Content-Type": "application/json" },
      body: JSON.stringify({ prefix, limit: PAGE, offset, sortBy: { column: "name", order: "asc" } })
    });
    if (!r.ok) throw new Error("list " + r.status);
    return await r.json();
  }

  // Fetch through Netlify's Image CDN, write back over the same key.
  async function shrink(prefix, entry) {
    const path = prefix + entry.name;
    const size = Number((entry.metadata || {}).size) || 0;
    const mime = String((entry.metadata || {}).mimetype || "").toLowerCase();
    if (size < MIN_BYTES || size > MAX_BYTES) { stats.skipped++; return; }
    if (mime !== "image/jpeg" && mime !== "image/jpg" && mime !== "image/webp") { stats.skipped++; return; }
    try {
      const publicUrl = SB_URL + "/storage/v1/object/public/" + bucket + "/" + path.split("/").map(encodeURIComponent).join("/");
      const cdn = SITE + "/.netlify/images?url=" + encodeURIComponent(publicUrl) + "&w=" + WIDTH + "&fm=jpg&q=" + QUALITY;
      const img = await timedFetch(cdn, { headers: { Accept: "image/jpeg" } });
      if (!img.ok) { stats.failed++; return; }
      const buf = Buffer.from(await img.arrayBuffer());
      // only rewrite on a real gain — a 5% win is not worth touching the file
      if (!buf.length || buf.length > size * 0.95) { stats.skipped++; return; }
      const up = await timedFetch(SB_URL + "/storage/v1/object/" + bucket + "/" + path.split("/").map(encodeURIComponent).join("/"), {
        method: "POST",
        headers: { ...svc, "Content-Type": "image/jpeg", "x-upsert": "true", "Cache-Control": "public, max-age=31536000" },
        body: buf
      });
      if (!up.ok) { stats.failed++; return; }
      stats.rewritten++;
      stats.savedBytes += size - buf.length;
    } catch (e) { stats.failed++; }
  }

  try {
    while (queue.length && left() > 2200) {
      const prefix = queue[0];
      const page = await listPage(prefix);
      if (!Array.isArray(page) || !page.length) { queue.shift(); offset = 0; continue; }

      const files = [];
      for (const e of page) {
        if (!e || !e.name) continue;
        // Supabase returns folders as rows with a null id and no metadata
        if (!e.id) { if (queue.length < 400) queue.push(prefix + e.name + "/"); continue; }
        files.push(e);
      }
      stats.listed += files.length;

      for (let i = 0; i < files.length && left() > 900; i += PARALLEL) {
        await Promise.all(files.slice(i, i + PARALLEL).map(f => shrink(prefix, f)));
      }

      if (page.length < PAGE) { queue.shift(); offset = 0; } else { offset += PAGE; }
    }
  } catch (e) {
    return { statusCode: 200, headers, body: JSON.stringify({ error: e.message || String(e), state: { queue, offset, stats }, stats, done: false }) };
  }

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ done: queue.length === 0, state: { queue, offset, stats }, stats })
  };
};
