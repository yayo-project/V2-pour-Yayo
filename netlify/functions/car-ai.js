// YAYO — car pricing AI (Groq, key stays server-side).
// POST { task:"verdict", lang, cars:[{id,name,year,mileage,price}] }  (max 25)
// →    { verdicts: { id: { v:"good"|"fair"|"high", why } } }
// POST { task:"estimate", lang, car:{name,year,mileage,condition} }
// →    { low, high, why }
// No key / any failure → { unavailable:true } (client hides the feature).
const LANG_NAMES = { fr: "French", en: "English", ar: "Arabic" };

async function groq(key, system, user) {
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user }
      ]
    })
  });
  if (!res.ok) throw new Error("groq " + res.status);
  const data = await res.json();
  return JSON.parse(data.choices[0].message.content);
}

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

  const lang = LANG_NAMES[body.lang] || "French";
  const key = process.env.GROQ_API_KEY;
  if (!key) return { statusCode: 200, headers, body: '{"unavailable":true}' };

  try {
    if (body.task === "verdict") {
      let cars = Array.isArray(body.cars) ? body.cars.slice(0, 25) : [];
      cars = cars.filter(c => c && c.id != null && c.name && c.price > 0).map(c => ({
        id: String(c.id).slice(0, 60),
        name: String(c.name).slice(0, 80),
        year: parseInt(c.year, 10) || null,
        mileage: parseInt(c.mileage, 10) || null,
        price: Math.round(c.price)
      }));
      if (!cars.length) return { statusCode: 400, headers, body: '{"error":"cars[] required"}' };
      const out = await groq(key,
        `You are a used-car price appraiser for the Dubai export market (cars shipped to Africa). Prices are in USD, asking prices in Dubai. For EACH car judge the asking price against typical Dubai market value for that model, year and mileage: "good" = clearly at or below market, "fair" = around market, "high" = above market. Be conservative: when unsure, say "fair". "why" = one short factual reason in ${lang}, max 10 words, no hype. Reply ONLY with JSON: {"verdicts":{"<id>":{"v":"good|fair|high","why":"..."}}} — one entry per input id.`,
        JSON.stringify({ cars }));
      const verdicts = {};
      cars.forEach(c => {
        const v = out.verdicts && out.verdicts[c.id];
        if (v && ["good", "fair", "high"].includes(v.v)) {
          verdicts[c.id] = { v: v.v, why: String(v.why || "").slice(0, 120) };
        }
      });
      return { statusCode: 200, headers, body: JSON.stringify({ verdicts }) };
    }

    if (body.task === "estimate") {
      const c = body.car || {};
      if (!c.name) return { statusCode: 400, headers, body: '{"error":"car.name required"}' };
      const out = await groq(key,
        `You are a used-car price appraiser for the Dubai export market. Estimate a realistic ASKING price range in USD for this car on the Dubai market (year, mileage and condition matter). Be honest and conservative. "why" = one short sentence in ${lang} explaining the range, max 18 words. Reply ONLY with JSON: {"low":<number>,"high":<number>,"why":"..."}`,
        JSON.stringify({ name: String(c.name).slice(0, 80), year: parseInt(c.year, 10) || null, mileage: parseInt(c.mileage, 10) || null, condition: String(c.condition || "").slice(0, 40) }));
      const low = Math.round(out.low), high = Math.round(out.high);
      if (!(low > 0 && high >= low)) throw new Error("bad range");
      return { statusCode: 200, headers, body: JSON.stringify({ low, high, why: String(out.why || "").slice(0, 200) }) };
    }

    return { statusCode: 400, headers, body: '{"error":"task verdict|estimate required"}' };
  } catch (e) {
    return { statusCode: 200, headers, body: '{"unavailable":true}' };
  }
};
