// YAYO — tell a dealership/agency that their application was decided.
// Without this they only discover a rejection by chance, next time they happen
// to open their dashboard.
// POST { token, subject:"dealer"|"agency", sid }   (token = the ADMIN's access token)
//   → { sent:true } | { skipped:"…" }
//
// Security: the client sends no email address and no wording. The caller is
// verified, checked against admin_users, and the recipient + decision + reason
// are read from the database with the service key. So this can never be used to
// mail an arbitrary person arbitrary text.
// Env: SUPABASE_SERVICE_KEY, BREVO_API_KEY.
const SB_URL = "https://wkjxdkeqffsjarjxlsyh.supabase.co";
const ANON = "sb_publishable_-mDN0Rd9q8q2SJuJPsn_qw_ieHvuSB8";
const SITE = "https://yayo.digital";

function esc(s) { return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

// FR + EN + AR stacked: Supabase/Brevo don't know the recipient's language,
// and a business in Dubai may read any of the three.
function html(approved, name, reason) {
  const btn = `<p style="text-align:center;margin:6px 0 20px">
      <a href="${SITE}/dashboard.html" style="display:inline-block;background:#1FD8C9;color:#0A2540;font-weight:800;font-size:15px;padding:12px 30px;border-radius:12px;text-decoration:none">Yayo</a></p>`;
  const block = (title, body, dir) =>
    `<tr><td style="padding:0 32px 14px"${dir ? ' dir="rtl"' : ""}>
       <p style="margin:0 0 6px;font-size:15px;font-weight:700;color:#0A2540">${title}</p>
       <p style="margin:0;font-size:13.5px;line-height:1.6;color:#3F5473">${body}</p></td></tr>`;

  const why = reason ? esc(reason) : "";
  const fr = approved
    ? ["Votre compte est vérifié ✅", "Félicitations — votre entreprise est maintenant visible par les acheteurs sur Yayo, avec le badge Vérifié."]
    : ["Votre demande n'a pas été validée", `Motif : « ${why} ».<br>Corrigez ce point puis renvoyez votre licence commerciale depuis l'onglet Profil de votre tableau de bord — nous réexaminerons votre dossier.`];
  const en = approved
    ? ["Your account is verified ✅", "Congratulations — your business is now visible to buyers on Yayo, with the Verified badge."]
    : ["Your application was not approved", `Reason: “${why}”.<br>Please fix this, then re-upload your trade licence from the Profile tab of your dashboard — we will review it again.`];
  const ar = approved
    ? ["تم توثيق حسابك ✅", "تهانينا — أصبح نشاطك ظاهراً للمشترين على يايو مع شارة التوثيق."]
    : ["لم تتم الموافقة على طلبك", `السبب: «${why}».<br>يرجى تصحيح ذلك ثم إعادة رفع الرخصة التجارية من تبويب الملف في لوحة التحكم — وسنراجع طلبك مجدداً.`];

  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F7FB;padding:28px 12px;font-family:Arial,Helvetica,sans-serif">
  <tr><td align="center">
    <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#fff;border-radius:14px;overflow:hidden;border:1px solid #DFE6EE">
      <tr><td style="background:#0A2540;padding:24px 32px;text-align:center">
        <span style="font-size:24px;font-weight:800;color:#1FD8C9;letter-spacing:1px">YAYO</span>
      </td></tr>
      <tr><td style="padding:26px 32px 6px">
        <p style="margin:0 0 16px;font-size:14px;color:#7A8CA5">${esc(name)}</p>
      </td></tr>
      ${block(fr[0], fr[1], false)}
      ${btn}
      <tr><td style="padding:0 32px"><hr style="border:0;border-top:1px solid #DFE6EE;margin:0 0 14px"></td></tr>
      ${block(en[0], en[1], false)}
      ${block(ar[0], ar[1], true)}
      <tr><td style="background:#071B33;padding:16px 32px;text-align:center">
        <span style="color:#7A8CA5;font-size:11.5px">© 2026 Yayo · yayo.digital</span>
      </td></tr>
    </table>
  </td></tr>
</table>`;
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
  const BREVO = process.env.BREVO_API_KEY;
  if (!SERVICE) return { statusCode: 200, headers, body: '{"skipped":"no SUPABASE_SERVICE_KEY"}' };

  let body; try { body = JSON.parse(event.body || "{}"); } catch (e) { return { statusCode: 400, headers, body: '{"error":"bad json"}' }; }
  const token = String(body.token || "");
  const subject = body.subject === "agency" ? "agency" : "dealer";
  const sid = String(body.sid || "");
  if (!token || !/^[0-9a-f-]{20,40}$/i.test(sid)) {
    return { statusCode: 400, headers, body: '{"error":"token and sid required"}' };
  }

  const svc = { apikey: SERVICE, Authorization: "Bearer " + SERVICE, "Content-Type": "application/json" };

  // 1. who is calling?
  let adminEmail;
  try {
    const u = await fetch(SB_URL + "/auth/v1/user", { headers: { apikey: ANON, Authorization: "Bearer " + token } });
    if (!u.ok) throw new Error("auth");
    adminEmail = (await u.json()).email;
  } catch (e) { return { statusCode: 401, headers, body: '{"error":"not signed in"}' }; }
  if (!adminEmail) return { statusCode: 401, headers, body: '{"error":"no email"}' };

  // 2. are they actually an admin? (only admins may trigger this mail)
  try {
    const a = await fetch(SB_URL + "/rest/v1/admin_users?email=eq." + encodeURIComponent(adminEmail) + "&select=email&limit=1", { headers: svc });
    const rows = await a.json();
    if (!rows || !rows.length) return { statusCode: 403, headers, body: '{"error":"not an admin"}' };
  } catch (e) { return { statusCode: 403, headers, body: '{"error":"admin check failed"}' }; }

  // 3. read the decision from the DB — never from the client
  const table = subject === "agency" ? "shipping_agencies" : "dealers";
  let biz;
  try {
    const r = await fetch(SB_URL + `/rest/v1/${table}?id=eq.${sid}&select=name,email,verified,rejected_reason&limit=1`, { headers: svc });
    biz = (await r.json())[0];
  } catch (e) { /* fall through */ }
  if (!biz || !biz.email) return { statusCode: 200, headers, body: '{"skipped":"no recipient"}' };

  const approved = !!biz.verified;
  if (!approved && !biz.rejected_reason) return { statusCode: 200, headers, body: '{"skipped":"nothing decided"}' };
  if (!BREVO) return { statusCode: 200, headers, body: '{"skipped":"no BREVO_API_KEY"}' };

  try {
    const r = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": BREVO, "Content-Type": "application/json" },
      body: JSON.stringify({
        sender: { name: "Yayo", email: "contact@yayo.digital" },
        to: [{ email: biz.email }],
        subject: approved
          ? "Votre compte Yayo est vérifié ✅ · Your account is verified · تم توثيق حسابك"
          : "Votre demande Yayo · Your Yayo application · طلبك على يايو",
        htmlContent: html(approved, biz.name, biz.rejected_reason)
      })
    });
    if (!r.ok) throw new Error("brevo " + r.status);
    return { statusCode: 200, headers, body: '{"sent":true}' };
  } catch (e) {
    return { statusCode: 200, headers, body: JSON.stringify({ skipped: String(e.message || e) }) };
  }
};
