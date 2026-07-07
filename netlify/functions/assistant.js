// YAYO — Assistant Yayo, Mode 2: SUGGESTED replies only.
// Drafts a reply for the DEALER to review, edit and send himself.
// Nothing is ever sent to the buyer by this function.
// POST { messages:[{me:bool,text}], car:{name,price}, style, lang }
// →    { reply }   |   { unavailable:true } on any failure (client falls back to preset chips)
const LANG_NAMES = { fr: "French", en: "English", ar: "Arabic" };
const STYLES = {
  pro: "professional and courteous",
  friendly: "warm, friendly and personal",
  luxury: "refined and premium, like a luxury concierge",
  fast: "short, direct and efficient (2 sentences max)"
};

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

  const msgs = Array.isArray(body.messages) ? body.messages.slice(-12) : [];
  if (!msgs.length) return { statusCode: 400, headers, body: '{"error":"messages[] required"}' };
  const lang = LANG_NAMES[body.lang] || "French";
  const style = STYLES[body.style] || STYLES.pro;
  const car = body.car || {};

  const key = process.env.GROQ_API_KEY;
  if (!key) return { statusCode: 200, headers, body: '{"unavailable":true}' };

  const convo = msgs.map(m =>
    (m.me ? "DEALER: " : "BUYER: ") + String(m.text || "").slice(0, 600)).join("\n");

  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        temperature: 0.5,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content:
`You draft a reply FOR a car dealer on Yayo, a Dubai → Africa car marketplace. The dealer will review and send it himself. Write AS the dealer, first person.
Car discussed: ${String(car.name || "unknown").slice(0, 80)}${car.price ? ", asking price $" + Math.round(car.price) : ""}.
Tone: ${style}. Language: write the reply in ${lang}.
Hard rules:
- Never invent facts (availability dates, discounts, extra options, delivery times). If the buyer asks something the conversation does not answer, propose to check and confirm.
- Never offer contact outside Yayo (no phone, WhatsApp, email). The conversation stays on Yayo.
- Never mention AI, an assistant, or that this message was drafted.
- Payments are arranged between buyer and dealer; shipping goes through Yayo-verified agencies shown on the listing.
- Max 60 words, no emoji spam (one emoji allowed).
Reply ONLY with JSON: {"reply":"..."}` },
          { role: "user", content: convo }
        ]
      })
    });
    if (!res.ok) throw new Error("groq " + res.status);
    const data = await res.json();
    const out = JSON.parse(data.choices[0].message.content);
    if (!out.reply || typeof out.reply !== "string") throw new Error("bad shape");
    return { statusCode: 200, headers, body: JSON.stringify({ reply: out.reply.slice(0, 900) }) };
  } catch (e) {
    return { statusCode: 200, headers, body: '{"unavailable":true}' };
  }
};
