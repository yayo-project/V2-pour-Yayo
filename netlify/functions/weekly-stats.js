// YAYO — weekly founder digest (runs every Monday 08:00 UTC, see netlify.toml).
// Counts the platform's vital signs straight from the database and emails
// them to the founder. Requires SUPABASE_SERVICE_KEY + BREVO_API_KEY.
const ADMIN_EMAIL = "yayoapp20@gmail.com";
const SB_URL = "https://wkjxdkeqffsjarjxlsyh.supabase.co";

exports.handler = async () => {
  const svc = process.env.SUPABASE_SERVICE_KEY;
  const brevo = process.env.BREVO_API_KEY;
  if (!svc || !brevo) return { statusCode: 200, body: '{"skipped":"keys missing"}' };
  const h = { apikey: svc, Authorization: "Bearer " + svc, Prefer: "count=exact" };
  const since = new Date(Date.now() - 7 * 86400000).toISOString();

  // count(*) via a HEAD request — Content-Range carries the total
  const count = async (path) => {
    try {
      const r = await fetch(SB_URL + path, { method: "HEAD", headers: h });
      const cr = r.headers.get("content-range") || "";
      return parseInt(cr.split("/")[1], 10) || 0;
    } catch (e) { return 0; }
  };

  const [dealers, agencies, listings, users, msgs7, convos7, reports, signups7] = await Promise.all([
    count("/rest/v1/dealers?select=id"),
    count("/rest/v1/shipping_agencies?select=id"),
    count("/rest/v1/listings?select=id&active=eq.true&hidden=eq.false"),
    count("/rest/v1/users?select=id"),
    count(`/rest/v1/messages?select=id&created_at=gte.${since}`),
    count(`/rest/v1/conversations?select=id&created_at=gte.${since}`),
    count("/rest/v1/reports?select=id&status=neq.resolu"),
    count(`/rest/v1/users?select=id&created_at=gte.${since}`)
  ]);

  const row = (l, v) => `<tr><td style="padding:8px 0;font-size:14px;color:#3F5473;border-bottom:1px solid #EEF2F7">${l}</td><td style="text-align:right;font-weight:800;font-size:15px;color:#0A2540;border-bottom:1px solid #EEF2F7">${v}</td></tr>`;
  const html = `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F7FB;padding:24px 12px;font-family:Arial,Helvetica,sans-serif">
  <tr><td align="center">
    <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;background:#fff;border-radius:14px;overflow:hidden;border:1px solid #DFE6EE">
      <tr><td style="background:#0A2540;padding:20px 28px;text-align:center">
        <span style="font-size:20px;font-weight:800;color:#1FD8C9;letter-spacing:1px">YAYO · SEMAINE</span>
      </td></tr>
      <tr><td style="padding:24px 28px">
        <h1 style="margin:0 0 14px;font-size:17px;color:#0A2540">📊 Votre semaine sur Yayo</h1>
        <table width="100%" cellpadding="0" cellspacing="0">
          ${row("Nouveaux inscrits (7 jours)", signups7)}
          ${row("Nouvelles conversations (7 jours)", convos7)}
          ${row("Messages envoyés (7 jours)", msgs7)}
          ${row("Annonces en ligne", listings)}
          ${row("Dealers", dealers)}
          ${row("Agences", agencies)}
          ${row("Utilisateurs au total", users)}
          ${row("Signalements à traiter", reports)}
        </table>
        <p style="text-align:center;margin:18px 0 4px">
          <a href="https://yayo.digital/dashboard.html" style="display:inline-block;background:#1FD8C9;color:#0A2540;font-weight:800;font-size:14px;padding:11px 26px;border-radius:12px;text-decoration:none">Voir le dashboard</a>
        </p>
      </td></tr>
    </table>
  </td></tr>
</table>`;

  try {
    const r = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": brevo, "Content-Type": "application/json" },
      body: JSON.stringify({
        sender: { name: "Yayo", email: "contact@yayo.digital" },
        to: [{ email: ADMIN_EMAIL }],
        subject: "📊 Yayo — votre résumé de la semaine",
        htmlContent: html
      })
    });
    return { statusCode: 200, body: JSON.stringify({ sent: r.ok }) };
  } catch (e) {
    return { statusCode: 200, body: JSON.stringify({ skipped: String(e.message || e) }) };
  }
};
