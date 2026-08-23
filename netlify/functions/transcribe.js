const MODELS = require("./_models");
// YAYO — turn a voice note into text the SENDER checks before it is sent.
//
// The sender reads it first ("Yayo a compris ceci — c'est bien ce que vous
// avez dit ?"). That single step is what makes voice safe in this corridor:
// the correction happens with the person who knows what he meant, not with
// the one guessing. A dealer speaking approximate English and a buyer
// speaking French with Lingala mixed in are the normal case here, not the
// edge case.
//
// Two rules the model does not get to break:
//   · numbers are copied exactly — a price or a chassis number that gets
//     "tidied" in a car deal is a catastrophe, not an imprecision;
//   · a passage that cannot be made out is marked, never invented.
//
// POST multipart/form-data: audio + lang → { text, lang }
// Env: GROQ_API_KEY.
const GROQ = "https://api.groq.com/openai/v1/audio/transcriptions";
const MAX_BYTES = 8 * 1024 * 1024;   // ~4 minutes of opus; longer is a phone call

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json"
};

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers: CORS, body: '{"error":"POST only"}' };

  const key = process.env.GROQ_API_KEY;
  if (!key) return { statusCode: 200, headers: CORS, body: '{"error":"no_key"}' };

  const ct = event.headers["content-type"] || event.headers["Content-Type"] || "";
  if (!/multipart\/form-data/i.test(ct)) {
    return { statusCode: 400, headers: CORS, body: '{"error":"multipart required"}' };
  }

  const raw = Buffer.from(event.body || "", event.isBase64Encoded ? "base64" : "utf8");
  if (!raw.length) return { statusCode: 400, headers: CORS, body: '{"error":"empty"}' };
  if (raw.length > MAX_BYTES) return { statusCode: 200, headers: CORS, body: '{"error":"too_long"}' };

  // Pull the audio part out of the multipart body without a parser library.
  const boundary = (ct.match(/boundary=(?:"([^"]+)"|([^;]+))/) || [])[1] ||
                   (ct.match(/boundary=(?:"([^"]+)"|([^;]+))/) || [])[2];
  if (!boundary) return { statusCode: 400, headers: CORS, body: '{"error":"no boundary"}' };

  const parts = splitParts(raw, "--" + boundary.trim());
  const audio = parts.find(p => /name="audio"/i.test(p.head));
  const langPart = parts.find(p => /name="lang"/i.test(p.head));
  if (!audio) return { statusCode: 400, headers: CORS, body: '{"error":"audio part missing"}' };

  // The sender's own language is a strong prior: guessing it per message is
  // exactly what goes wrong for someone mixing French and Lingala.
  const lang = (langPart ? langPart.body.toString("utf8").trim() : "").slice(0, 5).toLowerCase();
  const mime = (audio.head.match(/Content-Type:\s*([^\r\n;]+)/i) || [])[1] || "audio/webm";
  const ext = /ogg/.test(mime) ? "ogg" : /mp4|m4a/.test(mime) ? "m4a" : /mpeg|mp3/.test(mime) ? "mp3" : "webm";

  try {
    const fd = new FormData();
    fd.append("file", new Blob([audio.body], { type: mime }), "voice." + ext);
    fd.append("model", MODELS.VOICE);
    fd.append("response_format", "json");
    fd.append("temperature", "0");                       // no creative guessing
    if (["fr", "en", "ar"].indexOf(lang) > -1) fd.append("language", lang);
    fd.append("prompt",
      "Conversation between a car dealer in Dubai and a buyer in Africa. " +
      "Transcribe exactly what is said. Keep every number, price, year, " +
      "mileage and chassis reference verbatim. Do not translate. Do not " +
      "complete or correct sentences. If a passage is unintelligible write " +
      "[inaudible] rather than guessing.");

    const r = await fetch(GROQ, { method: "POST", headers: { Authorization: "Bearer " + key }, body: fd });
    if (!r.ok) {
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ error: "groq_" + r.status }) };
    }
    const out = await r.json();
    let text = String(out.text || "").trim();

    // Whisper fills silence with whatever it half-heard; a note that comes
    // back empty or as a lone marker is better shown as nothing understood.
    if (!text || /^\[?\s*(inaudible|silence|musique|music|\.)\s*\]?\.?$/i.test(text)) {
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ text: "", empty: true }) };
    }
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ text, lang: out.language || lang || null }) };
  } catch (e) {
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ error: String(e.message || e).slice(0, 120) }) };
  }
};

// Minimal multipart splitter: enough for one file and one short field.
function splitParts(buf, boundary) {
  const out = [];
  const b = Buffer.from(boundary);
  let i = buf.indexOf(b);
  while (i !== -1) {
    const start = i + b.length;
    const next = buf.indexOf(b, start);
    if (next === -1) break;
    const chunk = buf.slice(start, next);
    const sep = chunk.indexOf("\r\n\r\n");
    if (sep !== -1) {
      out.push({
        head: chunk.slice(0, sep).toString("utf8"),
        // drop the CRLF that belongs to the boundary, not to the data
        body: chunk.slice(sep + 4, chunk.length - 2)
      });
    }
    i = next;
  }
  return out;
}
