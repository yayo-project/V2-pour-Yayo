// YAYO — shipment update notification: the buyer's phone buzzes and they get
// a short email when their car moves a step. No sensitive content — status only.
// POST { shipment_id }  ·  Env: SUPABASE_SERVICE_KEY (+ BREVO_API_KEY, VAPID_*)
const webpush = require("web-push");
const SB_URL = "https://wkjxdkeqffsjarjxlsyh.supabase.co";
const SITE = "https://yayo.digital";

const STATUS_FR = {
  picked_up: "Voiture récupérée à Dubai", container: "Chargée dans le conteneur",
  departed: "Navire parti de Dubai", at_sea: "En mer", arrived: "Arrivée au port",
  customs: "Dédouanement en cours", ready: "Prête à récupérer ✓"
};
const STATUS_EN = {
  picked_up: "Picked up in Dubai", container: "Loaded in container",
  departed: "Vessel departed Dubai", at_sea: "At sea", arrived: "Arrived at port",
  customs: "Customs clearance", ready: "Ready for collection ✓"
};

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json"
  };
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers, body: '{"error":"POST only"}' };

  let shipId;
  try { shipId = String(JSON.parse(event.body || "{}").shipment_id || ""); }
  catch (e) { return { statusCode: 400, headers, body: '{"error":"bad json"}' }; }
  if (!/^[0-9a-f-]{20,40}$/i.test(shipId)) return { statusCode: 400, headers, body: '{"error":"shipment_id required"}' };

  const svc = process.env.SUPABASE_SERVICE_KEY;
  if (!svc) return { statusCode: 200, headers, body: '{"skipped":"no service key"}' };
  const sbHeaders = { apikey: svc, Authorization: "Bearer " + svc, "Content-Type": "application/json" };
  const sb = async (path, opts) => {
    const r = await fetch(SB_URL + path, { headers: sbHeaders, ...opts });
    if (!r.ok) throw new Error("supabase " + r.status);
    return r.status === 204 ? null : r.json();
  };

  try {
    const ships = await sb(`/rest/v1/shipments?id=eq.${shipId}&select=id,user_id,car_name,status,eta`);
    const s = ships && ships[0];
    if (!s) return { statusCode: 200, headers, body: '{"skipped":"no shipment"}' };

    // buyer email (auth)
    let toEmail = null;
    const r = await fetch(SB_URL + "/auth/v1/admin/users/" + s.user_id, { headers: sbHeaders });
    if (r.ok) { const u = await r.json(); toEmail = u && u.email; }
    if (!toEmail) return { statusCode: 200, headers, body: '{"skipped":"no email"}' };

    const car = (s.car_name || "votre voiture").slice(0, 60);
    const stFr = STATUS_FR[s.status] || s.status;
    const stEn = STATUS_EN[s.status] || s.status;
    const link = SITE + "/suivi.html";

    // 1. push (instant buzz)
    let pushed = 0;
    const pub = process.env.VAPID_PUBLIC, priv = process.env.VAPID_PRIVATE;
    if (pub && priv) {
      webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:contact@yayo.digital", pub, priv);
      let subs = [];
      try { subs = await sb(`/rest/v1/push_subscriptions?email=eq.${encodeURIComponent(toEmail)}&select=endpoint,p256dh,auth`); } catch (e) {}
      const payload = JSON.stringify({ title: "Yayo 🚢", body: `${car} — ${stFr}`, url: link, tag: "yayo-ship" });
      await Promise.all((subs || []).map(async (x) => {
        try {
          await webpush.sendNotification({ endpoint: x.endpoint, keys: { p256dh: x.p256dh, auth: x.auth } }, payload);
          pushed++;
        } catch (err) {
          if (err && (err.statusCode === 404 || err.statusCode === 410)) {
            try { await sb(`/rest/v1/push_subscriptions?endpoint=eq.${encodeURIComponent(x.endpoint)}`, { method: "DELETE" }); } catch (e) {}
          }
        }
      }));
    }

    // 2. email (every step is a rare, wanted event — no throttle needed)
    const brevo = process.env.BREVO_API_KEY;
    let emailed = false;
    if (brevo) {
      const esc = t => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      const html = `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F7FB;padding:24px 12px;font-family:Arial,Helvetica,sans-serif">
  <tr><td align="center">
    <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;background:#fff;border-radius:14px;overflow:hidden;border:1px solid #DFE6EE">
      <tr><td style="background:#0A2540;padding:20px 28px;text-align:center">
        <span style="font-size:20px;font-weight:800;color:#1FD8C9;letter-spacing:1px">YAYO</span>
      </td></tr>
      <tr><td style="padding:24px 28px">
        <h1 style="margin:0 0 8px;font-size:18px;color:#0A2540">🚢 Votre voiture a avancé !</h1>
        <p style="margin:0 0 4px;font-size:15px;color:#0A2540"><b>${esc(car)}</b></p>
        <p style="margin:0 0 14px;font-size:14.5px;color:#3F5473">Nouvelle étape : <b style="color:#0A2540">${esc(stFr)}</b><br>
        <span style="font-size:12.5px;color:#7A8CA5">New step: ${esc(stEn)}</span></p>
        <p style="text-align:center;margin:14px 0 4px">
          <a href="${link}" style="display:inline-block;background:#1FD8C9;color:#0A2540;font-weight:800;font-size:14px;padding:11px 26px;border-radius:12px;text-decoration:none">Suivre mon expédition</a>
        </p>
      </td></tr>
      <tr><td style="background:#071B33;padding:14px 28px;text-align:center">
        <span style="color:#7A8CA5;font-size:11.5px">© 2026 Yayo · yayo.digital</span>
      </td></tr>
    </table>
  </td></tr>
</table>`;
      const br = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: { "api-key": brevo, "Content-Type": "application/json" },
        body: JSON.stringify({
          sender: { name: "Yayo", email: "contact@yayo.digital" },
          to: [{ email: toEmail }],
          subject: `🚢 ${car} — ${stFr}`,
          htmlContent: html
        })
      });
      emailed = br.ok;
    }
    return { statusCode: 200, headers, body: JSON.stringify({ pushed, emailed }) };
  } catch (e) {
    return { statusCode: 200, headers, body: JSON.stringify({ skipped: String(e.message || e) }) };
  }
};
