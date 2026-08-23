// YAYO — is the AI actually working, and if not, what did Groq say?
//
// Written because translation was dead for weeks and nothing anywhere said
// so. Every Groq function catches its errors and quietly falls back, which
// is right for a buyer mid-conversation and useless for the person trying
// to find out why nothing is being translated.
//
// This makes one deliberately tiny call and reports exactly what came back.
// It never returns the key, or any part of it — only whether one is present,
// how long it is, and the status and message Groq answered with.
//
// GET /.netlify/functions/ai-health
// → { ok, key: {present, length, prefix_ok}, groq: {status, ms, error}, model }
const GROQ = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = "llama-3.1-8b-instant";      // the cheapest one the site uses

const H = {
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "application/json",
  "Cache-Control": "no-store"
};

exports.handler = async () => {
  const key = process.env.GROQ_API_KEY || "";
  const out = {
    ok: false,
    model: MODEL,
    key: {
      present: !!key,
      length: key.length,                       // a pasted-wrong key is usually the wrong length
      prefix_ok: key.slice(0, 4) === "gsk_",    // never the key itself
      whitespace: key !== key.trim()            // the invisible classic
    },
    groq: null,
    brevo: { present: !!process.env.BREVO_API_KEY },
    supabase: { present: !!process.env.SUPABASE_SERVICE_KEY }
  };
  if (!key) return { statusCode: 200, headers: H, body: JSON.stringify(out) };

  const t0 = Date.now();
  try {
    const r = await fetch(GROQ, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + key.trim() },
      body: JSON.stringify({
        model: MODEL, temperature: 0, max_tokens: 5,
        messages: [{ role: "user", content: "Reply with the single word: ok" }]
      })
    });
    const ms = Date.now() - t0;
    const text = await r.text();
    if (r.ok) {
      let reply = "";
      try { reply = JSON.parse(text).choices[0].message.content.trim().slice(0, 20); } catch (e) {}
      out.ok = true;
      out.groq = { status: r.status, ms, reply };
    } else {
      // Groq's own words — this is the sentence that was missing
      let msg = text.slice(0, 300);
      try { const j = JSON.parse(text); msg = (j.error && (j.error.message || j.error.type)) || msg; } catch (e) {}
      out.groq = { status: r.status, ms, error: String(msg).slice(0, 300) };
    }
  } catch (e) {
    out.groq = { status: 0, ms: Date.now() - t0, error: String(e.message || e).slice(0, 200) };
  }
  return { statusCode: 200, headers: H, body: JSON.stringify(out) };
};
