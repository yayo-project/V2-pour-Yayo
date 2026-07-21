// YAYO — founder alert: "a dealer/agency just registered / uploaded a licence".
// Fired (fire-and-forget) by the client after key supply-side events, so the
// founder never misses his first real dealer. No secrets exposed: only kind +
// name are accepted; everything else is looked up or ignored.
// POST { kind: "dealer_signup" | "agency_signup" | "license_upload" | "new_report" | "import", name?, detail? }
const ADMIN_EMAIL = "yayoapp20@gmail.com";

const KINDS = {
  dealer_signup: { emoji: "🏪", title: "Nouveau dealer inscrit" },
  agency_signup: { emoji: "🚢", title: "Nouvelle agence inscrite" },
  license_upload: { emoji: "📄", title: "Licence commerciale envoyée — à vérifier" },
  new_report: { emoji: "⚑", title: "Nouveau signalement" },
  import: { emoji: "🌐", title: "Import site web — vérifiez la propriété" }
};

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json"
  };
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers, body: '{"error":"POST only"}' };

  let kind, name, detail;
  try {
    const b = JSON.parse(event.body || "{}");
    kind = String(b.kind || "");
    name = String(b.name || "").slice(0, 120);
    detail = String(b.detail || "").slice(0, 300);
  } catch (e) { return { statusCode: 400, headers, body: '{"error":"bad json"}' }; }

  const k = KINDS[kind];
  if (!k) return { statusCode: 400, headers, body: '{"error":"unknown kind"}' };
  const brevo = process.env.BREVO_API_KEY;
  if (!brevo) return { statusCode: 200, headers, body: '{"skipped":"no BREVO_API_KEY"}' };

  const esc = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const html = `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F7FB;padding:24px 12px;font-family:Arial,Helvetica,sans-serif">
  <tr><td align="center">
    <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;background:#fff;border-radius:14px;overflow:hidden;border:1px solid #DFE6EE">
      <tr><td style="background:#0A2540;padding:20px 28px;text-align:center">
        <span style="font-size:20px;font-weight:800;color:#1FD8C9;letter-spacing:1px">YAYO · ADMIN</span>
      </td></tr>
      <tr><td style="padding:26px 28px">
        <h1 style="margin:0 0 10px;font-size:18px;color:#0A2540">${k.emoji} ${k.title}</h1>
        ${name ? `<p style="margin:0 0 6px;font-size:15px;color:#0A2540"><b>${esc(name)}</b></p>` : ""}
        ${detail ? `<p style="margin:0 0 14px;font-size:13.5px;color:#3F5473">${esc(detail)}</p>` : ""}
        <p style="text-align:center;margin:14px 0 4px">
          <a href="https://yayo.digital/dashboard.html" style="display:inline-block;background:#1FD8C9;color:#0A2540;font-weight:800;font-size:14px;padding:11px 26px;border-radius:12px;text-decoration:none">Ouvrir le dashboard admin</a>
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
        sender: { name: "Yayo Admin", email: "contact@yayo.digital" },
        to: [{ email: ADMIN_EMAIL }],
        subject: `${k.emoji} ${k.title}${name ? " — " + name : ""}`,
        htmlContent: html
      })
    });
    if (!r.ok) throw new Error("brevo " + r.status);
    return { statusCode: 200, headers, body: '{"sent":true}' };
  } catch (e) {
    return { statusCode: 200, headers, body: JSON.stringify({ skipped: String(e.message || e) }) };
  }
};
