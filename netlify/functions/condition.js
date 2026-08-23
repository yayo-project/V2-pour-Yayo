const MODELS = require("./_models");
// YAYO — AI condition report from a car photo (Groq vision).
// The DEALER triggers it on his own listing photo; the text lands in the
// description field for him to review and edit before saving (Mode 2 rule).
// POST { image:"data:image/jpeg;base64,...", lang }
// →    { report }   |   { unavailable:true } on any failure
const LANG_NAMES = { fr: "French", en: "English", ar: "Arabic" };

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json"
  };
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers, body: '{"error":"POST only"}' };

  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch (e) { return { statusCode: 400, headers, body: '{"error":"bad json"}' }; }

  const img = body.image;
  if (typeof img !== "string" || !img.startsWith("data:image/") || img.length > 4000000) {
    return { statusCode: 400, headers, body: '{"error":"image data URL required (max ~3MB)"}' };
  }
  const lang = LANG_NAMES[body.lang] || "French";

  const key = process.env.GROQ_API_KEY;
  if (!key) return { statusCode: 200, headers, body: '{"unavailable":true}' };

  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
      body: JSON.stringify({
        model: MODELS.VISION,
        temperature: 0.2,
        // Room to think AND answer. This is the only function that asks for
        // plain text instead of JSON, so nothing here suppresses the model's
        // reasoning — cut it short and the note never arrives at all.
        max_tokens: 1600,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text:
`Look at this car photo and write a short, honest visible-condition note in ${lang} for a marketplace listing. 3 to 5 short lines: body/paint, wheels/tires, glass/lights, anything visibly worn or damaged. Only what is actually VISIBLE in the photo — no guesses about the engine or interior you cannot see, no marketing language, no guarantees. If the photo is not a car, say so in one line. Plain text, one line per point, no markdown.` },
              { type: "image_url", image_url: { url: img } }
            ]
          }
        ]
      })
    });
    if (!res.ok) throw new Error("groq " + res.status);
    const data = await res.json();
    const raw = data.choices && data.choices[0] && data.choices[0].message.content;
    if (!raw) throw new Error("empty");
    const report = stripThinking(raw);
    // Nothing left means the model spent the whole budget reasoning and never
    // reached its answer. Say "unavailable" — never hand a dealer the monologue.
    if (!report) throw new Error("reasoning only");
    return { statusCode: 200, headers, body: JSON.stringify({ report: report.slice(0, 1200) }) };
  } catch (e) {
    console.error("[yayo] condition failed:", String(e.message || e).slice(0, 300));
    return { statusCode: 200, headers, body: '{"unavailable":true}' };
  }
};

// The model reasons out loud before answering. That monologue is not a
// condition report — a dealer who photographed a car was being shown
// "The user wants a short, honest condition note… Wait, looking closer…"
// and nothing else, because the reasoning alone filled the reply.
// Everything before the final </think> goes; an unclosed one takes the
// rest of the string with it, since the answer never came.
function stripThinking(s) {
  let out = String(s);
  const end = out.lastIndexOf("</think>");
  if (end !== -1) out = out.slice(end + 8);
  const open = out.search(/<think>|<\|channel\|>analysis/i);
  if (open !== -1) out = out.slice(0, open);
  return out.replace(/<\/?think>/gi, "").trim();
}
