// YAYO — "une voiture correspond à votre recherche" (Brevo, keys server-side).
// POST { dealer_id } — called fire-and-forget right after a dealer publishes
// (one car, or a whole website import). Looks at that dealer's just-published
// cars, finds the open car_requests they match, and emails those buyers ONCE.
//
// Two guards so a 400-car import can never spam anyone:
//   • car_requests.last_notified_at → at most one email per request per day
//   • car_request_matches           → the same car is never announced twice
// Only cars a buyer could actually see are announced (dealer verified and not
// suspended; listing active, not sold/hidden/dormant).
// Env vars required: BREVO_API_KEY, SUPABASE_SERVICE_KEY. Needs setup.sql §33+§34.
const SB_URL = "https://wkjxdkeqffsjarjxlsyh.supabase.co";
const SITE = "https://yayo.digital";
const THROTTLE_HOURS = 24;
const FRESH_MIN = 30;        // "just published" window
const MAX_LISTINGS = 400;    // a full import in one go

// Does this listing satisfy what the buyer asked for?
// Make and model are matched loosely (a request is a wish, not a filter);
// budget is a hard ceiling — never tease someone with a car above their money.
function matches(req, l) {
  const hay = [l.car_name, l.make, l.model].filter(Boolean).join(" ").toLowerCase();
  if (!hay) return false;
  if (req.make) {
    const mk = String(req.make).toLowerCase().split(/[-\s]/)[0];
    if (mk && !hay.includes(mk)) return false;
  }
  if (req.model) {
    // ignore a year token ("Prado 2021"): the year is a preference, not a filter
    const words = String(req.model).toLowerCase().split(/\s+/)
      .filter(w => w.length > 2 && !/^(19|20)\d{2}$/.test(w));
    if (words.length && !words.some(w => hay.includes(w))) return false;
  }
  // Dubai price vs the buyer's stated budget. Freight/customs are added on the
  // car page (labelled estimates) — we never invent them here.
  if (req.budget_usd && Number(l.price) > Number(req.budget_usd)) return false;
  return true;
}

function emailHtml(lang, car, price, link) {
  const L = {
    fr: { h: "Une voiture correspond à votre recherche 🚗", p: `<b>${car}</b>${price ? " — " + price + " à Dubai" : ""}. Voyez les photos et le coût total livré chez vous.`, b: "Voir la voiture", s: "Vous recevez cet email car vous avez enregistré une demande sur Yayo. Pour ne plus être prévenu, supprimez-la dans « Mes demandes »." },
    en: { h: "A car matches your search 🚗", p: `<b>${car}</b>${price ? " — " + price + " in Dubai" : ""}. See the photos and the full delivered cost to your city.`, b: "View the car", s: "You get this email because you saved a request on Yayo. To stop, delete it in “My requests”." },
    ar: { h: "سيارة تطابق بحثك 🚗", p: `<b>${car}</b>${price ? " — " + price + " في دبي" : ""}. شاهد الصور والتكلفة الكاملة للتسليم في مدينتك.`, b: "عرض السيارة", s: "تصلك هذه الرسالة لأنك سجّلت طلباً على يايو. لإيقاف التنبيهات، احذفه من «طلباتي»." }
  };
  const x = L[lang] || L.fr;
  const rtl = lang === "ar" ? ' dir="rtl"' : "";
  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F7FB;padding:28px 12px;font-family:Arial,Helvetica,sans-serif">
  <tr><td align="center">
    <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#fff;border-radius:14px;overflow:hidden;border:1px solid #DFE6EE">
      <tr><td style="background:#0A2540;padding:24px 32px;text-align:center">
        <span style="font-size:24px;font-weight:800;color:#1FD8C9;letter-spacing:1px">YAYO</span>
      </td></tr>
      <tr><td style="padding:28px 32px 6px"${rtl}>
        <h1 style="margin:0 0 10px;font-size:18px;color:#0A2540">${x.h}</h1>
        <p style="margin:0 0 18px;font-size:14.5px;line-height:1.6;color:#3F5473">${x.p}</p>
        <p style="text-align:center;margin:0 0 20px">
          <a href="${link}" style="display:inline-block;background:#1FD8C9;color:#0A2540;font-weight:800;font-size:15px;padding:12px 30px;border-radius:12px;text-decoration:none">${x.b}</a>
        </p>
      </td></tr>
      <tr><td style="padding:0 32px 22px"${rtl}>
        <p style="margin:0;font-size:11.5px;line-height:1.6;color:#7A8CA5">${x.s}</p>
      </td></tr>
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
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json; charset=utf-8"
  };
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers, body: '{"error":"POST only"}' };

  let dealerId, debug = false;
  try {
    const b = JSON.parse(event.body || "{}");
    dealerId = String(b.dealer_id || "");
    debug = !!b.debug;
  } catch (e) { return { statusCode: 400, headers, body: '{"error":"bad json"}' }; }
  if (!/^[0-9a-f-]{20,40}$/i.test(dealerId)) {
    return { statusCode: 400, headers, body: '{"error":"dealer_id required"}' };
  }

  const svc = process.env.SUPABASE_SERVICE_KEY;
  const brevo = process.env.BREVO_API_KEY;
  if (!svc) return { statusCode: 200, headers, body: '{"skipped":"SUPABASE_SERVICE_KEY not set"}' };

  const sbHeaders = { apikey: svc, Authorization: "Bearer " + svc, "Content-Type": "application/json" };
  const sb = async (path, opts) => {
    const r = await fetch(SB_URL + path, { headers: sbHeaders, ...opts });
    if (!r.ok) throw new Error("supabase " + r.status + " on " + path.split("?")[0]);
    return r.status === 204 ? null : r.json();
  };

  try {
    // 1. The dealer must be live for buyers, or nothing gets announced
    const dealers = await sb(`/rest/v1/dealers?id=eq.${dealerId}&select=id,name,verified,suspended`);
    const d = dealers && dealers[0];
    if (!d) return { statusCode: 200, headers, body: '{"skipped":"no dealer"}' };
    if (!d.verified || d.suspended) return { statusCode: 200, headers, body: '{"skipped":"dealer not live"}' };

    // 2. What this dealer just published (and a buyer can actually see)
    const since = new Date(Date.now() - FRESH_MIN * 60000).toISOString();
    const base = `/rest/v1/listings?dealer_id=eq.${dealerId}&created_at=gte.${since}` +
      `&active=is.true&sold=is.false&order=created_at.desc&limit=${MAX_LISTINGS}&select=`;
    let fresh;
    try {
      // hidden (admin) and dormant (§32) must never be announced to buyers
      fresh = await sb(base + "id,car_name,make,model,price,hidden,dormant");
    } catch (e) {
      // older schema without those columns — the rest still works
      fresh = await sb(base + "id,car_name,price");
    }
    const live = (fresh || []).filter(l => !l.hidden && !l.dormant);
    if (!live.length) return { statusCode: 200, headers, body: '{"skipped":"no fresh listings"}' };

    // 3. Open requests with a usable email
    const cutoff = new Date(Date.now() - THROTTLE_HOURS * 3600000).toISOString();
    const reqs = await sb(`/rest/v1/car_requests?status=neq.satisfait` +
      `&select=id,make,model,budget_usd,city,contact,lang,last_notified_at&limit=2000`);
    const open = (reqs || []).filter(r =>
      r.contact && r.contact.includes("@") &&
      !(r.last_notified_at && r.last_notified_at > cutoff));
    if (!open.length) return { statusCode: 200, headers, body: '{"skipped":"no open requests"}' };

    // 4. Match, skipping any car already announced to that buyer
    let sent = 0, considered = 0;
    for (const r of open) {
      const hits = live.filter(l => matches(r, l));
      if (!hits.length) continue;
      considered++;
      let already = [];
      try {
        already = await sb(`/rest/v1/car_request_matches?request_id=eq.${r.id}&select=listing_id&limit=1000`);
      } catch (e) { already = []; }
      const seen = new Set((already || []).map(m => String(m.listing_id)));
      const fresh1 = hits.filter(l => !seen.has(String(l.id)));
      if (!fresh1.length) continue;

      const best = fresh1[0];
      // Stamp BEFORE sending: a crash can miss one email, but never spam.
      await sb(`/rest/v1/car_requests?id=eq.${r.id}`, {
        method: "PATCH",
        body: JSON.stringify({ last_notified_at: new Date().toISOString() })
      });
      try {
        await sb(`/rest/v1/car_request_matches`, {
          method: "POST",
          headers: { ...sbHeaders, Prefer: "resolution=ignore-duplicates" },
          body: JSON.stringify(fresh1.map(l => ({ request_id: r.id, listing_id: l.id })))
        });
      } catch (e) { /* dedupe is best-effort; the daily throttle still holds */ }

      if (!brevo) continue;
      const lang = ["fr", "en", "ar"].includes(r.lang) ? r.lang : "fr";
      const price = best.price ? "$" + Number(best.price).toLocaleString("en-US") : "";
      const link = SITE + "/voiture.html?id=" + encodeURIComponent(best.id);
      const subj = { fr: "Une voiture correspond à votre recherche 🚗", en: "A car matches your search 🚗", ar: "سيارة تطابق بحثك 🚗" }[lang];
      const send = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: { "api-key": brevo, "Content-Type": "application/json" },
        body: JSON.stringify({
          sender: { name: "Yayo", email: "contact@yayo.digital" },
          to: [{ email: r.contact.trim() }],
          subject: subj,
          htmlContent: emailHtml(lang, (best.car_name || "").slice(0, 70), price, link)
        })
      });
      if (send.ok) sent++;
    }

    const out = { listings: live.length, requests: open.length, matched: considered, sent };
    if (!brevo) out.email = "no BREVO_API_KEY";
    return { statusCode: 200, headers, body: JSON.stringify(debug ? { ...out, dealer: d.name } : out) };
  } catch (e) {
    // Notifications must never break publishing — report softly
    return { statusCode: 200, headers, body: JSON.stringify({ skipped: String(e.message || e) }) };
  }
};
