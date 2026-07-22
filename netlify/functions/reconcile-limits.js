// YAYO — nightly listing-limit sweep (see netlify.toml schedule).
// When a dealer's launch promo ends, their extra cars are put to sleep
// (dormant = hidden from buyers, NEVER deleted) and they wake up again
// automatically as soon as the dealer makes room. All the logic lives in
// the database (yayo_reconcile_all, setup.sql §32) — this just triggers it.
// Requires SUPABASE_SERVICE_KEY.
const SB_URL = "https://wkjxdkeqffsjarjxlsyh.supabase.co";

exports.handler = async () => {
  const svc = process.env.SUPABASE_SERVICE_KEY;
  if (!svc) return { statusCode: 200, body: '{"skipped":"no service key"}' };
  try {
    const res = await fetch(SB_URL + "/rest/v1/rpc/yayo_reconcile_all", {
      method: "POST",
      headers: { apikey: svc, Authorization: "Bearer " + svc, "Content-Type": "application/json" },
      body: "{}"
    });
    const txt = await res.text();
    if (!res.ok) return { statusCode: 200, body: JSON.stringify({ error: txt.slice(0, 200) }) };
    return { statusCode: 200, body: JSON.stringify({ changed: Number(txt) || 0 }) };
  } catch (e) {
    return { statusCode: 200, body: JSON.stringify({ error: String(e.message || e).slice(0, 200) }) };
  }
};
