// ═══════════════════════════════════════════════
// YAYO — reading a document a seller sent, and deciding what to do
//
// Three outcomes, never two (setup.sql §55):
//
//   MATCHES        delivered, marked verified
//   UNREADABLE     DELIVERED anyway, marked unverifiable, admin told
//   OTHER COMPANY  held, seller and admin both told
//
// The middle one is the whole design. Blocking on "I could not read it"
// would stop honest sales every day: a phone photo in a dim showroom is
// usually unreadable, and a UAE trading name differs from the legal name on
// the licence almost always. Only a DIFFERENT COMPANY's name on the paper is
// worth stopping, because that is the shape of the fraud this exists to
// catch — an invoice from a company the buyer never agreed to pay.
//
// POST { message_id }
// The verdict is written with the service key through yayo_set_doc_status,
// so a seller cannot mark his own document verified from a console.
// ═══════════════════════════════════════════════
const MODELS = require("./_models");

const SB_URL = "https://wkjxdkeqffsjarjxlsyh.supabase.co";
const GROQ = "https://api.groq.com/openai/v1/chat/completions";

const H = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json"
};

// Comparing company names needs to be generous, because reality is.
// "CGM AUTO LLC", "C.G.M Auto Trading L.L.C" and "CGM AUTO" are one company.
// Legal suffixes, punctuation and case carry no meaning here and are dropped
// before anything is compared.
const NOISE = /\b(l\.?l\.?c|llc|fze|fzco|fzc|dmcc|est|establishment|trading|general|used|cars?|auto(?:mobile|motive)?s?|motors?|company|co|ltd|limited|group|international|intl|the|and|for)\b/gi;
function norm(s) {
  return String(s || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    // Dots and apostrophes are REMOVED, not turned into spaces: a letterhead
    // reading "C.G.M Auto Trading L.L.C" must normalise to "cgm", not to
    // "c g m l l c", where every piece is too short to compare and an honest
    // dealer's invoice gets held. Other punctuation becomes a space, so
    // "Auto-Trading" stays two words instead of becoming one.
    .replace(/[.'’`]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(NOISE, " ")
    .replace(/\s+/g, " ")
    .trim();
}
// Do these two names share their distinctive words? "cgm" against "cgm" is a
// match; "cgm" against "alfahad" is not.
function sameCompany(a, b) {
  let A = norm(a), B = norm(b);
  // A name made entirely of words this strips ("Used Cars Trading LLC") comes
  // back empty. Comparing nothing to nothing would hold an honest document,
  // so fall back to the raw text rather than to a verdict.
  if (!A || !B) {
    A = String(a || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    B = String(b || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    return !!A && !!B && (A === B || A.includes(B) || B.includes(A));
  }
  if (A === B || A.includes(B) || B.includes(A)) return true;
  // Four letters or more, so two unrelated firms sharing "gulf" or "star"
  // are not declared the same company. Short distinctive names like "cgm"
  // still match, through the containment test above.
  const wa = A.split(" ").filter(w => w.length > 3);
  const wb = B.split(" ").filter(w => w.length > 3);
  return wa.some(w => wb.indexOf(w) > -1);
}

async function sb(path, key, init) {
  const r = await fetch(SB_URL + "/rest/v1/" + path, {
    ...(init || {}),
    headers: { apikey: key, Authorization: "Bearer " + key, "Content-Type": "application/json",
               ...((init || {}).headers || {}) }
  });
  if (!r.ok) throw new Error("supabase " + r.status + " " + (await r.text()).slice(0, 200));
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}

async function setStatus(key, id, status, company, note) {
  await fetch(SB_URL + "/rest/v1/rpc/yayo_set_doc_status", {
    method: "POST",
    headers: { apikey: key, Authorization: "Bearer " + key, "Content-Type": "application/json" },
    body: JSON.stringify({ p_message: id, p_status: status, p_company: company || null, p_note: note || null })
  });
}

// Only an image can be read by the vision model. A PDF or a Word file is not
// a failure and not a fraud — it is simply something this cannot check, and
// it is delivered and flagged for a human exactly like a blurry photo.
const READABLE = /\.(jpe?g|png|webp|heic|heif)(\?|$)/i;

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: H };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers: H, body: '{"error":"POST only"}' };

  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!key) return { statusCode: 200, headers: H, body: '{"skipped":"no service key"}' };

  let id;
  try { id = JSON.parse(event.body || "{}").message_id; } catch (e) {}
  if (!id) return { statusCode: 400, headers: H, body: '{"error":"message_id required"}' };

  try {
    const rows = await sb("messages?select=id,file_url,file_name,sender_id,conversation_id&id=eq." +
                          encodeURIComponent(id), key);
    const msg = rows && rows[0];
    if (!msg || !msg.file_url) return { statusCode: 200, headers: H, body: '{"skipped":"not a document"}' };

    // Who is this conversation with, and what did an admin verify them as?
    const convo = (await sb("conversations?select=dealer_id,agency_id,user_id&id=eq." +
                            encodeURIComponent(msg.conversation_id), key))[0];
    if (!convo) return { statusCode: 200, headers: H, body: '{"skipped":"no conversation"}' };
    // A document from the BUYER is not checked. This exists to protect the
    // buyer from a seller's paperwork, not the other way round.
    if (String(msg.sender_id) === String(convo.user_id)) {
      return { statusCode: 200, headers: H, body: '{"skipped":"sent by the buyer"}' };
    }

    const table = convo.dealer_id ? "dealers" : "shipping_agencies";
    const bizId = convo.dealer_id || convo.agency_id;
    if (!bizId) return { statusCode: 200, headers: H, body: '{"skipped":"no seller"}' };
    const biz = (await sb(table + "?select=name,legal_name,trading_name&id=eq." +
                          encodeURIComponent(bizId), key))[0] || {};
    const known = [biz.trading_name, biz.legal_name, biz.name].filter(Boolean);

    await setStatus(key, id, "checking");

    if (!READABLE.test(msg.file_url)) {
      await setStatus(key, id, "unverifiable", null, "Format non lisible automatiquement (" + (msg.file_name || "fichier") + ")");
      return { statusCode: 200, headers: H, body: '{"outcome":"unverifiable","reason":"format"}' };
    }

    const groq = process.env.GROQ_API_KEY;
    if (!groq) {
      await setStatus(key, id, "unverifiable", null, "Lecture automatique indisponible");
      return { statusCode: 200, headers: H, body: '{"outcome":"unverifiable","reason":"no ai"}' };
    }

    // Read the paper. The model is asked only what is printed on it — never
    // to judge, never to guess a name it cannot see.
    const r = await fetch(GROQ, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + groq },
      body: JSON.stringify({
        model: MODELS.VISION, temperature: 0, max_tokens: 700,
        messages: [{ role: "user", content: [
          { type: "text", text:
            'This is a business document photographed or scanned by a car dealer. ' +
            'Reply ONLY with JSON: {"readable":true|false,"companies":["..."],"doc_type":"invoice|quotation|purchase agreement|export document|licence|other|unknown"}. ' +
            '"companies" = every business name PRINTED on the document, copied exactly as written, letterheads and stamps included. ' +
            'If the image is too blurry, too dark, cropped or otherwise unreadable, set readable to false and leave companies empty. ' +
            'Never guess a company name that is not visible. Never invent.' },
          { type: "image_url", image_url: { url: msg.file_url } }
        ] }]
      })
    });

    if (!r.ok) {
      await setStatus(key, id, "unverifiable", null, "Lecture impossible (service " + r.status + ")");
      return { statusCode: 200, headers: H, body: '{"outcome":"unverifiable","reason":"vision error"}' };
    }

    let out = {};
    try {
      let txt = (await r.json()).choices[0].message.content || "";
      const end = txt.lastIndexOf("</think>");           // the model reasons out loud
      if (end !== -1) txt = txt.slice(end + 8);
      const j = txt.indexOf("{"), k = txt.lastIndexOf("}");
      out = JSON.parse(txt.slice(j, k + 1));
    } catch (e) {
      await setStatus(key, id, "unverifiable", null, "Réponse illisible du service de lecture");
      return { statusCode: 200, headers: H, body: '{"outcome":"unverifiable","reason":"bad json"}' };
    }

    const found = Array.isArray(out.companies) ? out.companies.filter(Boolean).map(String) : [];
    if (out.readable === false || !found.length) {
      await setStatus(key, id, "unverifiable", found[0] || null,
        "Document illisible ou sans nom d'entreprise visible");
      return { statusCode: 200, headers: H, body: '{"outcome":"unverifiable","reason":"unreadable"}' };
    }

    const match = found.some(f => known.some(k2 => sameCompany(f, k2)));
    if (match) {
      await setStatus(key, id, "verified", found.join(" · ").slice(0, 200),
        "Nom conforme à l'entreprise vérifiée");
      return { statusCode: 200, headers: H, body: '{"outcome":"verified"}' };
    }

    // A different company. This is the one that stops.
    await setStatus(key, id, "held", found.join(" · ").slice(0, 200),
      "Le document porte « " + found.join(" · ").slice(0, 120) + " », pas « " + (known[0] || "?") + " »");
    try {
      await fetch(new URL("/.netlify/functions/notify-admin", process.env.URL || "https://yayo.digital").href, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: "Document retenu — société différente",
          text: "Un document envoyé par " + (known[0] || "un vendeur") + " porte le nom « " +
                found.join(" · ") + " ». Il n'a pas été remis à l'acheteur. Onglet Signalements / documents."
        })
      });
    } catch (e) { /* the hold already happened; the e-mail is a courtesy */ }

    return { statusCode: 200, headers: H, body: '{"outcome":"held"}' };
  } catch (e) {
    // Never let a checker failure block a document. Silence here means the
    // paper is delivered unmarked, which is what happened before this existed.
    return { statusCode: 200, headers: H, body: JSON.stringify({ error: String(e.message || e).slice(0, 200) }) };
  }
};
