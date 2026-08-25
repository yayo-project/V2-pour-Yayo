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
const MODELS = require("./_models");
const GROQ = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = MODELS.FAST;                 // the same one the chat translates with

const H = {
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "application/json",
  "Cache-Control": "no-store"
};

// Every model Yayo depends on, and the feature that dies with it. The old
// check tested the translation model only, so when llama-4-scout was retired
// in July the photo report was dead for a month with the panel showing green.
// Groq answers 404 for a model that no longer exists, which is the whole
// question — and asking costs no tokens, so all four can be checked at once.
const USED = [
  { role: "translation", model: MODELS.FAST,   feature: "chat_translation" },
  { role: "reasoning",   model: MODELS.BIG,    feature: "verdicts_assistant_import" },
  { role: "vision",      model: MODELS.VISION, feature: "photo_condition_report" },
  { role: "voice",       model: MODELS.VOICE,  feature: "voice_notes" }
];

async function modelAlive(key, m) {
  const t = Date.now();
  try {
    // NOT encodeURIComponent: a model id is a PATH, and "openai/gpt-oss-20b"
    // percent-encoded becomes "openai%2Fgpt-oss-20b", which Groq answers 404
    // to — so the panel reported three live models as retired. Twice in one
    // day this check has accused a working model. Model ids are [a-z0-9./-];
    // anything else is not a model id and has no business in a URL.
    const id = String(m.model).replace(/[^A-Za-z0-9._\/-]/g, "");
    const r = await fetch("https://api.groq.com/openai/v1/models/" + id, {
      headers: { Authorization: "Bearer " + key.trim() }
    });
    const ms = Date.now() - t;
    if (r.ok) return { ...m, ok: true, status: r.status, ms };
    let msg = (await r.text()).slice(0, 200);
    try { const j = JSON.parse(msg); msg = (j.error && (j.error.message || j.error.type)) || msg; } catch (e) {}
    // 404 here means one thing only: Groq has retired this model.
    return { ...m, ok: false, status: r.status, ms, retired: r.status === 404, error: String(msg).slice(0, 200) };
  } catch (e) {
    return { ...m, ok: false, status: 0, ms: Date.now() - t, error: String(e.message || e).slice(0, 150) };
  }
}

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
    models: [],
    brevo: { present: !!process.env.BREVO_API_KEY },
    supabase: { present: !!process.env.SUPABASE_SERVICE_KEY }
  };
  if (!key) return { statusCode: 200, headers: H, body: JSON.stringify(out) };

  // All four asked at once — the slowest answer sets the pace, not the sum
  const models = await Promise.all(USED.map(m => modelAlive(key, m)));
  out.models = models;

  const t0 = Date.now();
  try {
    const r = await fetch(GROQ, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + key.trim() },
      // JSON mode is tested, not assumed: translate, car-ai, assistant and
      // import all depend on response_format, so a model that lacks it would
      // fail exactly like a dead model — the failure we just spent a day on.
      // max_tokens has to cover the model THINKING before it answers, not just
      // the answer. The first version allowed 30, which the current model spent
      // on reasoning — so the probe returned "Failed to validate JSON" and this
      // panel reported the AI dead while translation was working perfectly.
      // A health check that cries wolf is worse than no health check.
      body: JSON.stringify({
        model: MODEL, temperature: 0, max_tokens: 512,
        response_format: { type: "json_object" },
        messages: [{ role: "user", content: 'Reply only with JSON: {"ok":true}' }]
      })
    });
    const ms = Date.now() - t0;
    const text = await r.text();
    if (r.ok) {
      let reply = "", json_mode = false;
      try {
        reply = JSON.parse(text).choices[0].message.content.trim().slice(0, 40);
        JSON.parse(reply); json_mode = true;
      } catch (e) {}
      out.ok = true;
      out.groq = { status: r.status, ms, reply, json_mode };
    } else {
      // Groq's own words — this is the sentence that was missing
      let msg = text.slice(0, 300);
      try { const j = JSON.parse(text); msg = (j.error && (j.error.message || j.error.type)) || msg; } catch (e) {}
      out.groq = { status: r.status, ms, error: String(msg).slice(0, 300) };
    }
  } catch (e) {
    out.groq = { status: 0, ms: Date.now() - t0, error: String(e.message || e).slice(0, 200) };
  }

  // Green means every feature that leans on Groq can actually run. A working
  // translation model while the vision model is gone is not "ok" — that is
  // exactly the state nobody noticed for a month.
  const dead = out.models.filter(m => !m.ok);
  out.ok = out.ok && dead.length === 0;
  out.retired = out.models.filter(m => m.retired).map(m => m.model);
  return { statusCode: 200, headers: H, body: JSON.stringify(out) };
};
