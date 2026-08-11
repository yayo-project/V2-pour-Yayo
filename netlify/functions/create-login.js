// YAYO — an admin opens a login for a dealer met in person.
// A showroom owner at Al Aweer will not fill a form: the founder takes his
// card, opens the account on the spot, and hands him the login. Creating an
// auth user needs the service key, which can never live in the browser — so
// it happens here.
//
// POST { token, email, password, name, phone, city }   (token = the ADMIN's access token)
//   → { created:true } | { exists:true } | { error:"…" }
//
// Security: the caller is verified against Supabase, then checked against
// admin_users — and only super_admin / admin_dealers may open accounts. The
// seller RECORD is not created here; the browser calls the audited
// admin_create_dealer RPC (§36) so the action lands in the admin log like
// every other one.
// Env: SUPABASE_SERVICE_KEY.
const SB_URL = "https://wkjxdkeqffsjarjxlsyh.supabase.co";
const ANON = "sb_publishable_-mDN0Rd9q8q2SJuJPsn_qw_ieHvuSB8";

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Content-Type": "application/json; charset=utf-8"
  };
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers, body: '{"error":"POST only"}' };

  const SERVICE = process.env.SUPABASE_SERVICE_KEY;
  if (!SERVICE) return { statusCode: 200, headers, body: '{"error":"no SUPABASE_SERVICE_KEY"}' };

  let body; try { body = JSON.parse(event.body || "{}"); } catch (e) {
    return { statusCode: 400, headers, body: '{"error":"bad json"}' };
  }
  const token = String(body.token || "");
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  const name = String(body.name || "").trim();
  const phone = String(body.phone || "").trim();
  const city = String(body.city || "Dubai").trim();
  // a seller or a shipping agency — nothing else can be created this way
  const role = body.role === "agency" ? "agency" : "dealer";

  if (!token) return { statusCode: 401, headers, body: '{"error":"not signed in"}' };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { statusCode: 400, headers, body: '{"error":"bad email"}' };
  if (password.length < 6) return { statusCode: 400, headers, body: '{"error":"password too short"}' };

  const svc = { apikey: SERVICE, Authorization: "Bearer " + SERVICE, "Content-Type": "application/json" };

  // 1. who is calling?
  let adminEmail;
  try {
    const u = await fetch(SB_URL + "/auth/v1/user", { headers: { apikey: ANON, Authorization: "Bearer " + token } });
    if (!u.ok) throw new Error("auth");
    adminEmail = (await u.json()).email;
  } catch (e) { return { statusCode: 401, headers, body: '{"error":"not signed in"}' }; }
  if (!adminEmail) return { statusCode: 401, headers, body: '{"error":"no email"}' };

  // 2. are they an admin allowed to handle sellers?
  try {
    const a = await fetch(SB_URL + "/rest/v1/admin_users?email=eq." + encodeURIComponent(adminEmail) + "&select=role&limit=1", { headers: svc });
    const rows = await a.json();
    const role = rows && rows[0] && rows[0].role;
    if (!role || (role !== "super_admin" && role !== "admin_dealers")) {
      return { statusCode: 403, headers, body: '{"error":"not allowed"}' };
    }
  } catch (e) { return { statusCode: 403, headers, body: '{"error":"admin check failed"}' }; }

  // 3. create the login — already confirmed, so he can sign in immediately
  //    (he never receives a confirmation mail he would have to hunt for)
  try {
    const r = await fetch(SB_URL + "/auth/v1/admin/users", {
      method: "POST",
      headers: svc,
      body: JSON.stringify({
        email,
        password,
        email_confirm: true,
        user_metadata: { role, company: name, phone, city }
      })
    });
    const txt = await r.text();
    if (r.ok) return { statusCode: 200, headers, body: '{"created":true}' };
    // already has a Yayo account (he registered himself, or this was run twice)
    if (/already been registered|already exists|duplicate/i.test(txt)) {
      return { statusCode: 200, headers, body: '{"exists":true}' };
    }
    let msg = txt;
    try { const j = JSON.parse(txt); msg = j.msg || j.message || j.error_description || txt; } catch (e) {}
    return { statusCode: 200, headers, body: JSON.stringify({ error: String(msg).slice(0, 200) }) };
  } catch (e) {
    return { statusCode: 200, headers, body: JSON.stringify({ error: String(e.message || e) }) };
  }
};
