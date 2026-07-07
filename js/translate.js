// ═══════════════════════════════════════════════
// YAYO — client helper for two-way chat translation.
// Calls the Netlify Function (Groq key stays hidden).
// Always safe: on any failure the original text is shown.
// ═══════════════════════════════════════════════
const __trCache = {}; // "lang|text" → translated

async function yayoTranslate(texts, target) {
  const lang = target || (typeof YAYO_LANG !== "undefined" ? YAYO_LANG : "fr");
  const out = texts.slice();
  const todo = [];
  texts.forEach((txt, i) => {
    const key = lang + "|" + txt;
    if (__trCache[key] !== undefined) out[i] = __trCache[key];
    else if (txt && txt.trim()) todo.push(i);
  });
  if (!todo.length) return out;
  try {
    const res = await fetch("/.netlify/functions/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ texts: todo.map(i => texts[i]), target: lang })
    });
    if (!res.ok) return out;
    const data = await res.json();
    if (data.untranslated || !Array.isArray(data.texts)) return out;
    todo.forEach((origIdx, j) => {
      out[origIdx] = data.texts[j];
      __trCache[lang + "|" + texts[origIdx]] = data.texts[j];
    });
  } catch (e) { /* offline / local preview: show original */ }
  return out;
}
