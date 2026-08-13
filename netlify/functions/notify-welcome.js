// YAYO — the email a seller gets when he joins.
// Until now a dealer who registered received a confirmation link and then
// nothing, at the exact moment he was most willing to act. This tells him the
// one thing that matters: paste your website link and your stock is online.
//
// POST { token, subject:"dealer"|"agency", sid, kind:"welcome"|"login", password? }
//   → { sent:true } | { skipped:"already welcomed" } | { error:"…" }
//
// Security: the caller is verified against Supabase. An admin may send for any
// business; anyone else only for their own. The recipient address and the
// business name are read from the database with the service key — never taken
// from the client — so this can never mail an arbitrary person.
// "login" (credentials for an account an admin opened) is admin-only.
// Env: SUPABASE_SERVICE_KEY, BREVO_API_KEY.
const SB_URL = "https://wkjxdkeqffsjarjxlsyh.supabase.co";
const ANON = "sb_publishable_-mDN0Rd9q8q2SJuJPsn_qw_ieHvuSB8";
const SITE = "https://yayo.digital";

function esc(s) { return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

// English first, then Arabic, then French: these are Dubai businesses.
function html(kind, name, isAgency, creds) {
  // the button lives in its own row: a bare <p> between <tr>s is invalid and
  // every mail client hoists it out of the table, above the letterhead
  const btn = (href, label) => `<tr><td style="padding:6px 32px 24px;text-align:center">
      <a href="${href}" style="display:inline-block;background:#1FD8C9;color:#0A2540;font-weight:800;font-size:15px;padding:13px 30px;border-radius:12px;text-decoration:none">${label}</a></td></tr>`;
  const block = (title, body, rtl) =>
    `<tr><td style="padding:0 32px 16px"${rtl ? ' dir="rtl"' : ""}>
       <p style="margin:0 0 7px;font-size:15.5px;font-weight:700;color:#0A2540">${title}</p>
       <p style="margin:0;font-size:13.5px;line-height:1.65;color:#3F5473">${body}</p></td></tr>`;

  const box = creds ? `
    <tr><td style="padding:0 32px 18px">
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#F4F7FB;border:1px solid #DFE6EE;border-radius:12px">
        <tr><td style="padding:14px 18px;font-size:14px;color:#0A2540;line-height:1.7">
          <b>Email:</b> ${esc(creds.email)}<br>
          <b>Password:</b> ${esc(creds.password)}
        </td></tr>
      </table>
      <p style="margin:8px 0 0;font-size:12px;color:#7A8CA5">Please change this password after your first sign-in.</p>
    </td></tr>` : "";

  const what = isAgency
    ? ["Your agency is on Yayo",
       "Buyers in Africa who have just bought a car in Dubai come to Yayo to find an agency to ship it. Add your routes, your transit times and your own prices — they contact you directly, and their messages reach you in your language."]
    : ["Your stock online in 3 minutes",
       "Paste the address of your website in your dashboard and Yayo reads your cars — model, year, price and every photo — and puts them in front of African buyers. You type nothing. No website? Add a car in about a minute."];

  // The licence ask. It has to answer "why" in one breath, because the honest
  // answer is also the selling point: the badge is what makes a buyer 5 000 km
  // away write to you instead of to someone else.
  const lic = [
    "One step left: your Verified badge",
    "Your cars are live on Yayo. To put the blue <b>Verified</b> badge next to your name, we need to see your trade licence — one photo is enough.<br><br>Why we ask: our buyers are in Africa, sending money to a company they have never visited. The badge tells them Yayo has seen your papers and that you are a real registered business in Dubai. Verified sellers are the ones buyers write to.<br><br>Open your dashboard → <b>Profil</b> → upload the licence. We review it the same day."
  ];

  const en = kind === "login"
    ? ["Your Yayo account is ready", "We opened your seller account. Sign in with the details below, then paste your website address and your cars go online."]
    : kind === "licence" ? lic : what;
  const ar = kind === "login"
    ? ["حسابك على يايو جاهز", "أنشأنا لك حساب البائع. سجّل الدخول بالبيانات أدناه، ثم الصق رابط موقعك لتظهر سياراتك."]
    : kind === "licence"
    ? ["خطوة أخيرة: شارة التوثيق",
       "سياراتك ظاهرة على يايو. لوضع شارة <b>التوثيق</b> الزرقاء بجانب اسمك، نحتاج أن نرى رخصتك التجارية — صورة واحدة تكفي.<br><br>لماذا نطلبها؟ لأن مشترينا في إفريقيا يحوّلون أموالهم إلى شركة لم يزوروها قط. الشارة تخبرهم أن يايو اطّلع على أوراقك وأنك شركة مسجّلة فعلاً في دبي. والبائع الموثّق هو من يراسله المشترون.<br><br>افتح لوحة التحكم ← <b>الملف</b> ← ارفع الرخصة. نراجعها في نفس اليوم."]
    : (isAgency
      ? ["شركتك الآن على يايو", "المشترون في إفريقيا الذين اشتروا سياراتهم من دبي يبحثون على يايو عن شركة شحن. أضف خطوطك ومددك وأسعارك — ويتواصلون معك مباشرة، وتصلك رسائلهم بلغتك."]
      : ["مخزونك على الإنترنت خلال 3 دقائق", "الصق رابط موقعك في لوحة التحكم، ويقرأ يايو سياراتك — الطراز والسنة والسعر وكل الصور — ويعرضها على المشترين الأفارقة. لا تكتب أي شيء. لا يوجد موقع؟ أضف سيارة في دقيقة تقريباً."]);
  const fr = kind === "login"
    ? ["Votre compte Yayo est prêt", "Nous avons créé votre compte vendeur. Connectez-vous avec les identifiants ci-dessus, puis collez l'adresse de votre site : vos voitures partent en ligne."]
    : kind === "licence"
    ? ["Dernière étape : votre badge Vérifié",
       "Vos voitures sont en ligne sur Yayo. Pour afficher le badge <b>Vérifié</b> à côté de votre nom, nous devons voir votre licence commerciale — une photo suffit.<br><br>Pourquoi : nos acheteurs sont en Afrique et envoient de l'argent à une société qu'ils n'ont jamais visitée. Le badge leur dit que Yayo a vu vos papiers et que vous êtes une entreprise réellement enregistrée à Dubai. Ce sont les vendeurs vérifiés que les acheteurs contactent.<br><br>Tableau de bord → <b>Profil</b> → envoyez la licence. Nous la vérifions le jour même."]
    : (isAgency
      ? ["Votre agence est sur Yayo", "Les acheteurs africains qui viennent d'acheter une voiture à Dubai cherchent une agence sur Yayo. Ajoutez vos routes, vos délais et vos propres tarifs — ils vous contactent directement."]
      : ["Votre stock en ligne en 3 minutes", "Collez l'adresse de votre site dans votre tableau de bord : Yayo lit vos voitures — modèle, année, prix et toutes les photos — et les présente aux acheteurs africains. Vous ne tapez rien."]);

  // …already the whole subject of a licence letter, so it is not repeated there
  const badge = kind === "licence" ? null : [
    "Get the Verified badge",
    "Send your trade licence from the Profile tab. Verified businesses are the ones buyers write to."
  ];

  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F7FB;padding:28px 12px;font-family:Arial,Helvetica,sans-serif">
  <tr><td align="center">
    <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#fff;border-radius:14px;overflow:hidden;border:1px solid #DFE6EE">
      <tr><td style="background:#0A2540;padding:24px 32px;text-align:center">
        <span style="font-size:24px;font-weight:800;color:#1FD8C9;letter-spacing:1px">YAYO</span>
        <p style="margin:6px 0 0;color:#7A8CA5;font-size:12px">Dubai → Africa</p>
      </td></tr>
      <tr><td style="padding:26px 32px 8px">
        <p style="margin:0 0 14px;font-size:14px;color:#7A8CA5">${esc(name)}</p>
      </td></tr>
      ${block(en[0], en[1], false)}
      ${box}
      ${btn(SITE + "/dashboard.html", kind === "login" ? "Sign in" : kind === "licence" ? "Upload my licence" : "Open my dashboard")}
      ${badge ? block(badge[0], badge[1], false) : ""}
      <tr><td style="padding:0 32px"><hr style="border:0;border-top:1px solid #DFE6EE;margin:0 0 16px"></td></tr>
      ${block(ar[0], ar[1], true)}
      ${block(fr[0], fr[1], false)}
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

  let body; try { body = JSON.parse(event.body || "{}"); } catch (e) {
    return { statusCode: 400, headers, body: '{"error":"bad json"}' };
  }
  const token = String(body.token || "");
  const subject = body.subject === "agency" ? "agency" : "dealer";
  const sid = String(body.sid || "");
  const kind = ["login", "licence"].includes(body.kind) ? body.kind : "welcome";
  const password = String(body.password || "");
  if (!token || !/^[0-9a-f-]{20,40}$/i.test(sid)) {
    return { statusCode: 400, headers, body: '{"error":"token and sid required"}' };
  }

  const svc = { apikey: SERVICE, Authorization: "Bearer " + SERVICE, "Content-Type": "application/json" };

  // 1. who is calling?
  let callerEmail;
  try {
    const u = await fetch(SB_URL + "/auth/v1/user", { headers: { apikey: ANON, Authorization: "Bearer " + token } });
    if (!u.ok) throw new Error("auth");
    callerEmail = (await u.json()).email;
  } catch (e) { return { statusCode: 401, headers, body: '{"error":"not signed in"}' }; }
  if (!callerEmail) return { statusCode: 401, headers, body: '{"error":"no email"}' };

  let isAdmin = false;
  try {
    const a = await fetch(SB_URL + "/rest/v1/admin_users?email=eq." + encodeURIComponent(callerEmail) + "&select=role&limit=1", { headers: svc });
    const rows = await a.json();
    isAdmin = !!(rows && rows.length);
  } catch (e) { /* treated as not admin */ }

  // 2. the recipient comes from the database, never from the caller
  const table = subject === "agency" ? "shipping_agencies" : "dealers";
  let biz;
  try {
    const r = await fetch(SB_URL + `/rest/v1/${table}?id=eq.${sid}&select=name,email,welcomed_at,licence_asked_at,license_path&limit=1`, { headers: svc });
    biz = (await r.json())[0];
  } catch (e) { /* fall through */ }
  if (!biz || !biz.email) return { statusCode: 200, headers, body: '{"skipped":"no recipient"}' };

  // a business may only welcome itself; an admin may welcome anyone
  if (!isAdmin && String(biz.email).toLowerCase() !== String(callerEmail).toLowerCase()) {
    return { statusCode: 403, headers, body: '{"error":"not your account"}' };
  }
  if (kind !== "welcome" && !isAdmin) return { statusCode: 403, headers, body: '{"error":"admin only"}' };
  // one welcome per business, ever
  if (kind === "welcome" && biz.welcomed_at) {
    return { statusCode: 200, headers, body: '{"skipped":"already welcomed"}' };
  }
  if (kind === "licence") {
    // never chase a licence that has already arrived
    if (biz.license_path) return { statusCode: 200, headers, body: '{"skipped":"licence already sent"}' };
    // and never twice in a week — a reminder that nags stops being read
    const asked = biz.licence_asked_at ? Date.parse(biz.licence_asked_at) : 0;
    if (!body.force && asked && Date.now() - asked < 7 * 864e5) {
      return { statusCode: 200, headers, body: '{"skipped":"asked recently"}' };
    }
  }
  if (!BREVO) return { statusCode: 200, headers, body: '{"skipped":"no BREVO_API_KEY"}' };

  // 3. stamp BEFORE sending: a retry after a half-failed send must not mail twice
  if (kind !== "login") {
    const stamp = kind === "licence"
      ? { licence_asked_at: new Date().toISOString() }
      : { welcomed_at: new Date().toISOString() };
    try {
      await fetch(SB_URL + `/rest/v1/${table}?id=eq.${sid}`, {
        method: "PATCH", headers: svc, body: JSON.stringify(stamp)
      });
    } catch (e) { /* column missing (§42/§43 not run) → send anyway, no dedupe */ }
  }

  const creds = kind === "login" && password ? { email: biz.email, password } : null;
  try {
    const r = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": BREVO, "Content-Type": "application/json" },
      body: JSON.stringify({
        sender: { name: "Yayo", email: "contact@yayo.digital" },
        to: [{ email: biz.email }],
        subject: kind === "login"
          ? "Your Yayo account is ready · حسابك جاهز · Votre compte Yayo est prêt"
          : kind === "licence"
          ? "One step left: your Verified badge · شارة التوثيق · Votre badge Vérifié"
          : "Your stock online in 3 minutes · مخزونك على يايو · Votre stock sur Yayo",
        htmlContent: html(kind, biz.name, subject === "agency", creds)
      })
    });
    if (!r.ok) throw new Error("brevo " + r.status);
    return { statusCode: 200, headers, body: '{"sent":true}' };
  } catch (e) {
    return { statusCode: 200, headers, body: JSON.stringify({ error: String(e.message || e) }) };
  }
};
