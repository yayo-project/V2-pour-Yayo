// YAYO — two-way chat translation (Groq, key stays server-side).
// POST { texts: ["..."], target: "fr" | "en" | "ar" }
// →    { texts: ["..."] }  (same order; unchanged if already in target)
const LANG_NAMES = { fr: "French", en: "English", ar: "Arabic" };

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json"
  };
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers, body: '{"error":"POST only"}' };

  let texts, target;
  try {
    const body = JSON.parse(event.body || "{}");
    texts = body.texts;
    target = body.target;
  } catch (e) { return { statusCode: 400, headers, body: '{"error":"bad json"}' }; }

  if (!Array.isArray(texts) || !texts.length || texts.length > 50 || !LANG_NAMES[target]) {
    return { statusCode: 400, headers, body: '{"error":"texts[] (max 50) and target fr|en|ar required"}' };
  }
  texts = texts.map(t => String(t).slice(0, 1500));

  const key = process.env.GROQ_API_KEY;
  if (!key) return { statusCode: 200, headers, body: JSON.stringify({ texts, untranslated: true }) };

  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
      body: JSON.stringify({
        model: "llama-3.1-8b-instant",
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: `You translate marketplace chat messages into ${LANG_NAMES[target]}. Rules: keep numbers, prices, currencies and car names exactly as written; keep the tone natural and conversational; if a message is already in ${LANG_NAMES[target]}, return it unchanged. Reply ONLY with JSON: {"texts": ["...", ...]} with exactly one translation per input, same order.` },
          { role: "user", content: JSON.stringify({ texts }) }
        ]
      })
    });
    if (!res.ok) throw new Error("groq " + res.status);
    const data = await res.json();
    const out = JSON.parse(data.choices[0].message.content);
    if (!Array.isArray(out.texts) || out.texts.length !== texts.length) throw new Error("bad shape");
    return { statusCode: 200, headers, body: JSON.stringify({ texts: out.texts.map(String) }) };
  } catch (e) {
    // Never break the chat: fall back to original text
    return { statusCode: 200, headers, body: JSON.stringify({ texts, untranslated: true }) };
  }
};
