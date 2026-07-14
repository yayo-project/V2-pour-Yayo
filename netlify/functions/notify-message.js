// YAYO — "un acheteur vous a écrit" notification email (Brevo, keys server-side).
// POST { conversation_id } — called fire-and-forget after a chat message is sent.
// Finds who should be notified (the party who did NOT write the last message),
// throttles to one email per conversation per 30 minutes, and sends a short
// trilingual (FR/EN/AR) notification with NO message content — just a link.
// Env vars required: BREVO_API_KEY, SUPABASE_SERVICE_KEY.
const webpush = require("web-push");
const SB_URL = "https://wkjxdkeqffsjarjxlsyh.supabase.co";
const SITE = "https://yayo.digital";
const THROTTLE_MIN = 30;

// Buzz every device the recipient enabled notifications on. No message content
// in the payload — just "you have a new message" and where to open it.
// Dead subscriptions (uninstalled app, expired) are cleaned up automatically.
async function sendPush(sb, toEmail, car, link) {
  const pub = process.env.VAPID_PUBLIC;
  const priv = process.env.VAPID_PRIVATE;
  if (!pub || !priv) return 0;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:contact@yayo.digital", pub, priv);

  let subs = [];
  try {
    subs = await sb(`/rest/v1/push_subscriptions?email=eq.${encodeURIComponent(toEmail)}&select=endpoint,p256dh,auth`);
  } catch (e) { return 0; }
  if (!subs || !subs.length) return 0;

  const payload = JSON.stringify({
    title: "Yayo 💬",
    body: car ? `Nouveau message — ${car}` : "Vous avez un nouveau message",
    url: link,
    tag: "yayo-msg"
  });

  let sent = 0;
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        payload
      );
      sent++;
    } catch (err) {
      // 404/410 = the device unsubscribed or the app was removed → drop the row
      if (err && (err.statusCode === 404 || err.statusCode === 410)) {
        try { await sb(`/rest/v1/push_subscriptions?endpoint=eq.${encodeURIComponent(s.endpoint)}`, { method: "DELETE" }); } catch (e) {}
      }
    }
  }));
  return sent;
}

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json"
  };
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers, body: '{"error":"POST only"}' };

  let convoId;
  try { convoId = String(JSON.parse(event.body || "{}").conversation_id || ""); }
  catch (e) { return { statusCode: 400, headers, body: '{"error":"bad json"}' }; }
  if (!/^[0-9a-f-]{20,40}$/i.test(convoId)) {
    return { statusCode: 400, headers, body: '{"error":"conversation_id required"}' };
  }

  const svc = process.env.SUPABASE_SERVICE_KEY;
  const brevo = process.env.BREVO_API_KEY;
  // The service key is required to look anything up. Brevo is optional:
  // without it push still fires, only the email is skipped.
  if (!svc) return { statusCode: 200, headers, body: '{"skipped":"SUPABASE_SERVICE_KEY not set"}' };

  const sbHeaders = { apikey: svc, Authorization: "Bearer " + svc, "Content-Type": "application/json" };
  const sb = async (path, opts) => {
    const r = await fetch(SB_URL + path, { headers: sbHeaders, ...opts });
    if (!r.ok) throw new Error("supabase " + r.status + " on " + path.split("?")[0]);
    return r.status === 204 ? null : r.json();
  };

  try {
    // 1. Conversation + throttle
    const convos = await sb(`/rest/v1/conversations?id=eq.${convoId}&select=id,user_id,dealer_id,agency_id,car_name,last_notified_at`);
    const c = convos && convos[0];
    if (!c) return { statusCode: 200, headers, body: '{"skipped":"no conversation"}' };
    // Push is instant on EVERY message. Only the email is throttled, so a fast
    // back-and-forth buzzes the phone but never floods the inbox.
    const emailAllowed = !(c.last_notified_at &&
      Date.now() - new Date(c.last_notified_at).getTime() < THROTTLE_MIN * 60000);

    // 2. Who wrote last → notify the OTHER party
    const msgs = await sb(`/rest/v1/messages?conversation_id=eq.${convoId}&select=sender_id&order=created_at.desc&limit=1`);
    const lastSender = msgs && msgs[0] && msgs[0].sender_id;
    if (!lastSender) return { statusCode: 200, headers, body: '{"skipped":"no messages"}' };

    let toEmail = null, link = SITE + "/messages.html";
    if (String(lastSender) === String(c.user_id)) {
      // buyer wrote → notify the business
      const table = c.dealer_id ? "dealers" : "shipping_agencies";
      const bizId = c.dealer_id || c.agency_id;
      if (!bizId) return { statusCode: 200, headers, body: '{"skipped":"no business"}' };
      const biz = await sb(`/rest/v1/${table}?id=eq.${bizId}&select=email`);
      toEmail = biz && biz[0] && biz[0].email;
      link = SITE + "/dashboard.html?tab=messages";
    } else {
      // business wrote → notify the buyer (email lives in auth)
      const r = await fetch(SB_URL + "/auth/v1/admin/users/" + c.user_id, { headers: sbHeaders });
      if (r.ok) { const u = await r.json(); toEmail = u && u.email; }
    }
    if (!toEmail) return { statusCode: 200, headers, body: '{"skipped":"no recipient email"}' };

    const car = (c.car_name || "").slice(0, 60);
    const pushed = await sendPush(sb, toEmail, car, link);

    // Email only (push already went out): stop here if throttled or no Brevo key
    if (!emailAllowed || !brevo) {
      return { statusCode: 200, headers, body: JSON.stringify({ pushed, email: !brevo ? "no BREVO_API_KEY" : "throttled" }) };
    }

    // Mark notified BEFORE sending (a crash can miss one email, never spam)
    await sb(`/rest/v1/conversations?id=eq.${convoId}`, {
      method: "PATCH",
      body: JSON.stringify({ last_notified_at: new Date().toISOString() })
    });

    // Short trilingual notification — no message content, just the link
    const btn = (label) =>
      `<p style="text-align:center;margin:0 0 20px"><a href="${link}" style="display:inline-block;background:#1FD8C9;color:#0A2540;font-weight:800;font-size:15px;padding:12px 30px;border-radius:12px;text-decoration:none">${label}</a></p>`;
    const html = `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F7FB;padding:28px 12px;font-family:Arial,Helvetica,sans-serif">
  <tr><td align="center">
    <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#fff;border-radius:14px;overflow:hidden;border:1px solid #DFE6EE">
      <tr><td style="background:#0A2540;padding:24px 32px;text-align:center">
        <span style="font-size:24px;font-weight:800;color:#1FD8C9;letter-spacing:1px">YAYO</span>
      </td></tr>
      <tr><td style="padding:28px 32px 6px">
        <h1 style="margin:0 0 10px;font-size:18px;color:#0A2540">Nouveau message sur Yayo 💬</h1>
        <p style="margin:0 0 16px;font-size:14.5px;line-height:1.6;color:#3F5473">
          Quelqu'un vous a écrit${car ? " au sujet de « " + car + " »" : ""}. Connectez-vous pour lire et répondre.
        </p>
        ${btn("Lire le message")}
      </td></tr>
      <tr><td style="padding:0 32px"><hr style="border:0;border-top:1px solid #DFE6EE;margin:4px 0 14px"></td></tr>
      <tr><td style="padding:0 32px 6px">
        <p style="margin:0 0 12px;font-size:13px;line-height:1.6;color:#3F5473">
          <b>New message on Yayo</b> — someone wrote to you${car ? " about “" + car + "”" : ""}. Sign in to read and reply.
        </p>
      </td></tr>
      <tr><td style="padding:0 32px 22px" dir="rtl">
        <p style="margin:0;font-size:13px;line-height:1.7;color:#3F5473">
          <b>رسالة جديدة على يايو</b> — كتب لك أحدهم${car ? " بخصوص «" + car + "»" : ""}. سجّل الدخول للقراءة والرد.
        </p>
      </td></tr>
      <tr><td style="background:#071B33;padding:16px 32px;text-align:center">
        <span style="color:#7A8CA5;font-size:11.5px">© 2026 Yayo · yayo.digital</span>
      </td></tr>
    </table>
  </td></tr>
</table>`;

    const send = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": brevo, "Content-Type": "application/json" },
      body: JSON.stringify({
        sender: { name: "Yayo", email: "contact@yayo.digital" },
        to: [{ email: toEmail }],
        subject: "Nouveau message sur Yayo 💬 · New message · رسالة جديدة",
        htmlContent: html
      })
    });
    if (!send.ok) throw new Error("brevo " + send.status);
    return { statusCode: 200, headers, body: JSON.stringify({ email: "sent", pushed }) };
  } catch (e) {
    // Notifications must never break the chat — report softly
    return { statusCode: 200, headers, body: JSON.stringify({ skipped: String(e.message || e) }) };
  }
};
