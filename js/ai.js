// ═══════════════════════════════════════════════
// YAYO — client helpers for the AI features
// (Groq key lives in Netlify Functions, never here).
// Every helper degrades silently: on failure it returns
// null/{} and the page simply hides the AI element —
// never a fake verdict (honesty rule).
// ═══════════════════════════════════════════════

// ── Price verdicts (badges) — cached per car+price for the session ──
function __vdCache() {
  try { return JSON.parse(sessionStorage.getItem("yayo_verdicts") || "{}"); }
  catch (e) { return {}; }
}
function __vdSave(cache) {
  try { sessionStorage.setItem("yayo_verdicts", JSON.stringify(cache)); } catch (e) {}
}

// cars: [{id, car_name, year, mileage, price}] (real listings only)
// → { id: {v:"good"|"fair"|"high", why} } — missing ids = no verdict, hide badge
async function yayoVerdicts(cars) {
  const cache = __vdCache();
  const out = {};
  const todo = [];
  cars.forEach(c => {
    const key = c.id + "|" + c.price;
    if (cache[key]) out[c.id] = cache[key];
    else todo.push(c);
  });
  if (!todo.length) return out;
  try {
    const res = await fetch("/.netlify/functions/car-ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        task: "verdict",
        lang: typeof YAYO_LANG !== "undefined" ? YAYO_LANG : "fr",
        cars: todo.slice(0, 25).map(c => ({ id: c.id, name: c.car_name, year: c.year, mileage: c.mileage, price: c.price }))
      })
    });
    if (!res.ok) return out;
    const data = await res.json();
    if (data.unavailable || !data.verdicts) return out;
    todo.forEach(c => {
      const v = data.verdicts[c.id];
      if (v) { out[c.id] = v; cache[c.id + "|" + c.price] = v; }
    });
    __vdSave(cache);
  } catch (e) { /* offline / no key: no badge */ }
  return out;
}

function verdictBadgeHtml(v) {
  if (!v) return "";
  const cls = v.v === "good" ? "ai-good" : (v.v === "fair" ? "ai-fair" : "ai-nego");
  const lbl = v.v === "good" ? t("badge_good") : (v.v === "fair" ? t("badge_fair") : t("badge_nego"));
  const why = (v.why || "").replace(/"/g, "&quot;");
  return `<span class="ai-badge ${cls}" title="${why}">${lbl}</span>`;
}

// Card badge: demo cars keep their preset demo badge; real cars only get a
// badge once a REAL verdict arrives (no fake verdicts — honesty rule).
window.__YAYO_VD = window.__YAYO_VD || {};
function carBadge(c) {
  if (String(c.id || "").startsWith("demo")) {
    return `<span class="ai-badge ${c.ai === "good" ? "ai-good" : "ai-nego"}">${c.ai === "good" ? t("badge_good") : t("badge_nego")}</span>`;
  }
  return verdictBadgeHtml(window.__YAYO_VD[c.id]);
}

// Fetch verdicts for the real listings in a list, then re-render the page
async function yayoLoadVerdicts(cars, rerender) {
  const real = cars.filter(c => c.id && !String(c.id).startsWith("demo") && c.price > 0);
  if (!real.length) return;
  const v = await yayoVerdicts(real);
  Object.assign(window.__YAYO_VD, v);
  if (Object.keys(v).length && rerender) rerender();
}

// ── Price estimate (dealer tool in the listing form) ──
async function yayoEstimate(car) {
  try {
    const res = await fetch("/.netlify/functions/car-ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task: "estimate", lang: typeof YAYO_LANG !== "undefined" ? YAYO_LANG : "fr", car })
    });
    if (!res.ok) return null;
    const data = await res.json();
    return (data.unavailable || !data.low) ? null : data;
  } catch (e) { return null; }
}

// ── Assistant Yayo suggested reply (Mode 2: dealer reviews, then sends) ──
async function yayoAssist(messages, car, style) {
  try {
    const res = await fetch("/.netlify/functions/assistant", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages, car, style, lang: typeof YAYO_LANG !== "undefined" ? YAYO_LANG : "fr" })
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.reply || null;
  } catch (e) { return null; }
}

// ── AI condition report from a photo (dealer tool) ──
// file → downscaled JPEG data URL → short visible-condition text (or null)
function yayoShrinkPhoto(file) {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const max = 900;
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const cv = document.createElement("canvas");
      cv.width = Math.round(img.width * scale);
      cv.height = Math.round(img.height * scale);
      cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
      URL.revokeObjectURL(url);
      resolve(cv.toDataURL("image/jpeg", 0.8));
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    img.src = url;
  });
}

async function yayoCondition(dataUrl) {
  if (!dataUrl) return null;
  try {
    const res = await fetch("/.netlify/functions/condition", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: dataUrl, lang: typeof YAYO_LANG !== "undefined" ? YAYO_LANG : "fr" })
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.report || null;
  } catch (e) { return null; }
}
