// YAYO — nightly trade-licence watch (see netlify.toml schedule, §50).
//
// A Vérifié badge stands on a licence somebody actually read. When that
// licence expires the badge is no longer telling the truth, so it comes off
// by itself — the badge only, never the listings: a dealer late on paperwork
// should not lose his shop over it.
//
// Before that, two reminders, because almost every expiry is an oversight
// rather than a fraud. Bands are 60, 30 and 7 days; which band a business was
// last warned in is worked out from licence_warned_at against the same expiry
// date, so nobody needs a column to remember it and nobody gets the same
// reminder twice.
//
// Env: SUPABASE_SERVICE_KEY (required), BREVO_API_KEY (optional — without it
// the badge still falls, only the e-mails are skipped).
const SB_URL = "https://wkjxdkeqffsjarjxlsyh.supabase.co";
const SITE = "https://yayo.digital";
const BANDS = [60, 30, 7];

function esc(s) { return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function bandOf(days) {
  for (let i = BANDS.length - 1; i >= 0; i--) if (days <= BANDS[i]) return BANDS[i];
  return null;                      // further away than the widest band
}
function daysBetween(a, b) { return Math.round((a - b) / 86400000); }

// FR + EN + AR stacked in one mail: we do not know which of the three a
// business in Dubai reads, and guessing wrong is worse than showing all three.
function html(name, days, expiry, expired) {
  const block = (title, body, rtl) =>
    `<tr><td style="padding:0 32px 14px"${rtl ? ' dir="rtl"' : ""}>
       <p style="margin:0 0 6px;font-size:15px;font-weight:700;color:#0A2540">${title}</p>
       <p style="margin:0;font-size:13.5px;line-height:1.6;color:#3F5473">${body}</p></td></tr>`;
  const fr = expired
    ? ["Votre licence a expiré", `Le badge <b>Vérifié</b> de ${esc(name)} est retiré jusqu'à réception de votre nouvelle licence. Vos voitures restent en ligne. Envoyez la licence à jour depuis l'onglet Profil et le badge revient.`]
    : ["Votre licence expire bientôt", `La licence de ${esc(name)} expire le ${esc(expiry)}, dans ${days} jours. Envoyez la nouvelle depuis l'onglet Profil pour garder votre badge <b>Vérifié</b>.`];
  const en = expired
    ? ["Your licence has expired", `The <b>Verified</b> badge for ${esc(name)} is removed until we receive your new licence. Your cars stay online. Upload the current licence from the Profile tab and the badge comes back.`]
    : ["Your licence expires soon", `${esc(name)}'s trade licence expires on ${esc(expiry)}, in ${days} days. Upload the new one from the Profile tab to keep your <b>Verified</b> badge.`];
  const ar = expired
    ? ["انتهت صلاحية رخصتك", `شارة <b>موثَّق</b> الخاصة بـ ${esc(name)} مُعلَّقة حتى استلام الرخصة الجديدة. سياراتك تبقى منشورة. ارفع الرخصة السارية من تبويب الملف الشخصي وتعود الشارة.`]
    : ["رخصتك على وشك الانتهاء", `تنتهي رخصة ${esc(name)} في ${esc(expiry)}، خلال ${days} يوماً. ارفع الرخصة الجديدة من تبويب الملف الشخصي للحفاظ على شارة <b>موثَّق</b>.`];

  return `<table width="100%" cellpadding="0" cellspacing="0" style="background:#F4F7FB;padding:24px 0;font-family:'DM Sans',Arial,sans-serif">
    <tr><td align="center">
      <table width="100%" style="max-width:560px;background:#fff;border-radius:16px;overflow:hidden">
        <tr><td style="background:#071B33;padding:22px 32px">
          <p style="margin:0;font-size:19px;font-weight:800;color:#fff">Yayo</p></td></tr>
        <tr><td style="padding:24px 32px 8px"></td></tr>
        ${block(fr[0], fr[1])}
        ${block(en[0], en[1])}
        ${block(ar[0], ar[1], true)}
        <tr><td style="padding:6px 32px 26px" align="center">
          <a href="${SITE}/dashboard.html" style="display:inline-block;background:#1FD8C9;color:#0A2540;font-weight:800;font-size:15px;padding:12px 30px;border-radius:12px;text-decoration:none">Yayo</a></td></tr>
      </table>
    </td></tr></table>`;
}

exports.handler = async () => {
  const svc = process.env.SUPABASE_SERVICE_KEY;
  if (!svc) return { statusCode: 200, body: '{"skipped":"no service key"}' };
  const brevo = process.env.BREVO_API_KEY;
  const H = { apikey: svc, Authorization: "Bearer " + svc, "Content-Type": "application/json" };

  const sb = async (path, opts) => {
    const r = await fetch(SB_URL + "/rest/v1" + path, { headers: H, ...(opts || {}) });
    if (!r.ok) throw new Error("supabase " + r.status + " " + (await r.text()).slice(0, 120));
    return r.status === 204 ? null : r.json();
  };
  const log = (action, kind, id, detail) =>
    sb("/admin_audit_log", {
      method: "POST",
      headers: { ...H, Prefer: "return=minimal" },
      body: JSON.stringify({ admin_email: "system@yayo", action, subject_type: kind, subject_id: String(id), detail })
    }).catch(() => {});

  const out = { warned: 0, expired: 0, mailed: 0, errors: [] };
  const today = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z");
  const cols = "id,name,email,verified,licence_expiry,licence_warned_at,licence_expired_at";

  for (const kind of ["dealer", "agency"]) {
    const table = kind === "dealer" ? "dealers" : "shipping_agencies";
    let rows;
    try { rows = await sb(`/${table}?select=${cols}&licence_expiry=not.is.null`); }
    catch (e) { out.errors.push(table + ": " + e.message); continue; }

    for (const x of rows || []) {
      const exp = new Date(x.licence_expiry + "T00:00:00Z");
      if (isNaN(exp)) continue;
      const days = daysBetween(exp, today);

      // ── expired: the badge stops telling the truth ──
      if (days < 0) {
        if (x.licence_expired_at) continue;          // already handled
        try {
          await sb(`/${table}?id=eq.${x.id}`, {
            method: "PATCH",
            headers: { ...H, Prefer: "return=minimal" },
            body: JSON.stringify({ verified: false, licence_expired_at: new Date().toISOString() })
          });
          out.expired++;
          await log("licence_expired", kind, x.id, x.name + " · " + x.licence_expiry);
          if (brevo && x.email) {
            await mail(brevo, x.email, x.name, 0, x.licence_expiry, true);
            out.mailed++;
          }
        } catch (e) { out.errors.push(x.name + ": " + e.message); }
        continue;
      }

      // ── still valid: one reminder per band, never the same one twice ──
      const band = bandOf(days);
      if (band === null) continue;
      if (x.licence_warned_at) {
        const warnedDays = daysBetween(exp, new Date(x.licence_warned_at));
        const warnedBand = bandOf(warnedDays);
        if (warnedBand !== null && band >= warnedBand) continue;   // same or wider band
      }
      try {
        await sb(`/${table}?id=eq.${x.id}`, {
          method: "PATCH",
          headers: { ...H, Prefer: "return=minimal" },
          body: JSON.stringify({ licence_warned_at: new Date().toISOString() })
        });
        out.warned++;
        if (brevo && x.email) {
          await mail(brevo, x.email, x.name, days, x.licence_expiry, false);
          out.mailed++;
        }
      } catch (e) { out.errors.push(x.name + ": " + e.message); }
    }
  }
  return { statusCode: 200, body: JSON.stringify(out) };
};

async function mail(key, to, name, days, expiry, expired) {
  await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({
      sender: { name: "Yayo", email: "contact@yayo.digital" },
      to: [{ email: to }],
      subject: expired ? "Yayo — licence expirée / licence expired" : "Yayo — licence bientôt expirée / licence expiring",
      htmlContent: html(name, days, expiry, expired)
    })
  }).catch(() => {});
}
