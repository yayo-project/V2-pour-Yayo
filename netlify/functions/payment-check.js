// YAYO — does the name on these payment details match the verified company?
//
// The buyer's browser must never receive the seller's registered name: that
// would publish the very data §50 keeps private. So the comparison happens
// here and only a verdict travels back — match, mismatch, or unknown.
//
// Yayo holds no bank details and asks for none (it has no company yet). It
// reads what the seller himself typed into the conversation, compares one
// name, and says whether it lines up. A warning, never a block: a group can
// legitimately invoice through another entity, and stopping an honest
// transfer costs more than the fraud it would prevent.
//
// POST { conversation_id, text } → { status, name }   name = what was found
// in the message, never what is on file.
// Env: SUPABASE_SERVICE_KEY.
const SB_URL = "https://wkjxdkeqffsjarjxlsyh.supabase.co";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json"
};

// Legal wrappers differ between the licence and the bank without meaning a
// different company: IBITISAM MOTORS FZCO and Ibtisam Motors are one firm.
const SUFFIX = /\b(fze|fzco|fz|llc|l\.?l\.?c|dmcc|dwc|est|establishment|trading|general|co|company|ltd|limited|inc|group|international|intl|automobiles?|auto|motors?|cars?)\b/gi;

function norm(s) {
  return String(s || "")
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function tokens(s) {
  return norm(s).replace(SUFFIX, " ").replace(/\s+/g, " ").trim().split(" ").filter(w => w.length > 2);
}
// Cheap edit distance — a dealer's own spelling of his name drifts
// ("IBITISAM" on the licence, "Ibtisam" on the invoice) and that is not fraud.
function close(a, b) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 2) return false;
  const m = a.length, n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n] <= Math.max(1, Math.floor(Math.max(m, n) * 0.2));
}

// The account holder as the seller wrote it: an explicit label first, then
// the line above an IBAN, which is where banks print it.
function accountName(text) {
  const s = String(text || "");
  const labelled = s.match(/(?:account\s*(?:holder|name)?|a\/c\s*name|beneficiary|benificiary|titulaire|b[ée]n[ée]ficiaire|nom\s+du\s+compte|company\s*name|اسم\s*الحساب|المستفيد)\s*[:\-–]\s*([^\n,;|]{3,60})/i);
  if (labelled) return labelled[1].trim();
  const lines = s.split(/\n+/).map(l => l.trim()).filter(Boolean);
  const ibanAt = lines.findIndex(l => /\b[A-Z]{2}\d{2}[A-Z0-9]{9,30}\b/i.test(l));
  if (ibanAt > 0) {
    const above = lines[ibanAt - 1].replace(/^[•\-*]\s*/, "");
    // a line that is mostly digits is another account number, not a name
    if (/[A-Za-z]{3,}/.test(above) && above.replace(/\D/g, "").length < 6) return above.slice(0, 60);
  }
  return null;
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers: CORS, body: '{"error":"POST only"}' };

  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch (e) { return { statusCode: 400, headers: CORS, body: '{"error":"bad json"}' }; }

  const cid = String(body.conversation_id || "");
  const text = String(body.text || "").slice(0, 4000);
  if (!/^[0-9a-f-]{20,40}$/i.test(cid)) return { statusCode: 400, headers: CORS, body: '{"error":"conversation_id required"}' };

  const found = accountName(text);
  if (!found) return { statusCode: 200, headers: CORS, body: '{"status":"unknown"}' };

  const svc = process.env.SUPABASE_SERVICE_KEY;
  if (!svc) return { statusCode: 200, headers: CORS, body: '{"status":"unknown"}' };
  const H = { apikey: svc, Authorization: "Bearer " + svc };
  const get = async p => {
    const r = await fetch(SB_URL + "/rest/v1" + p, { headers: H });
    if (!r.ok) throw new Error("supabase " + r.status);
    return r.json();
  };

  try {
    const convo = (await get(`/conversations?id=eq.${cid}&select=dealer_id,agency_id`))[0];
    if (!convo) return { statusCode: 200, headers: CORS, body: '{"status":"unknown"}' };

    const table = convo.dealer_id ? "dealers" : "shipping_agencies";
    const id = convo.dealer_id || convo.agency_id;
    if (!id) return { statusCode: 200, headers: CORS, body: '{"status":"unknown"}' };

    const biz = (await get(`/${table}?id=eq.${id}&select=name,legal_name,trading_name`))[0];
    if (!biz) return { statusCode: 200, headers: CORS, body: '{"status":"unknown"}' };

    // Nothing on file to compare against yet — say so rather than guess.
    const known = [biz.legal_name, biz.trading_name].filter(Boolean);
    if (!known.length) return { statusCode: 200, headers: CORS, body: '{"status":"unknown","reason":"no licence recorded"}' };
    known.push(biz.name);

    const want = tokens(found);
    const match = known.some(k => {
      const have = tokens(k);
      if (!have.length || !want.length) return false;
      const hit = want.filter(w => have.some(h => close(w, h))).length;
      // one strong word is enough when the name is one word ("Naz"),
      // otherwise two must line up
      return hit >= Math.min(2, Math.min(want.length, have.length));
    });

    return {
      statusCode: 200, headers: CORS,
      body: JSON.stringify({ status: match ? "match" : "mismatch", name: found })
    };
  } catch (e) {
    return { statusCode: 200, headers: CORS, body: '{"status":"unknown"}' };
  }
};
