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
        model: "meta-llama/llama-4-scout-17b-16e-instruct",
        temperature: 0.2,
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
    const report = data.choices && data.choices[0] && data.choices[0].message.content;
    if (!report) throw new Error("empty");
    return { statusCode: 200, headers, body: JSON.stringify({ report: String(report).trim().slice(0, 1200) }) };
  } catch (e) {
    return { statusCode: 200, headers, body: '{"unavailable":true}' };
  }
};
