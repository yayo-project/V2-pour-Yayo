// ═══════════════════════════════════════════════
// YAYO — Configuration
// Supabase publishable key (safe for client use).
// AI keys live in Netlify Functions, never here.
// ═══════════════════════════════════════════════
const YAYO_CONFIG = {
  SUPABASE_URL: "https://wkjxdkeqffsjarjxlsyh.supabase.co",
  SUPABASE_KEY: "sb_publishable_-mDN0Rd9q8q2SJuJPsn_qw_ieHvuSB8",

  // Destinations: shipping (USD) + duty factor (estimation, refined per country)
  DESTINATIONS: {
    kinshasa: { name: "Kinshasa", flag: "🇨🇩", ship: 3200, duty: 0.45, fees: 1070 },
    douala:   { name: "Douala",   flag: "🇨🇲", ship: 2800, duty: 0.50, fees: 1070 },
    abidjan:  { name: "Abidjan",  flag: "🇨🇮", ship: 3500, duty: 0.44, fees: 1070 },
    dakar:    { name: "Dakar",    flag: "🇸🇳", ship: 3300, duty: 0.48, fees: 1070 },
    dubai:    { name: "Dubai",    flag: "🇦🇪", ship: 0,    duty: 0,    fees: 0 }
  },
  DEFAULT_DEST: "kinshasa",
  FEATURED_LIMIT: 6,

  // Google Analytics 4 — the gtag snippet in each page's <head> uses this same ID.
  GA4_ID: "G-NR2LTEVKET"
};

// Business avatar: logo image if uploaded, otherwise clean initials circle.
// Used for dealers (car cards, detail page) and agencies (profile).
function yayoAvatarHtml(name, logoUrl, lg) {
  const esc = s => (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const cls = "b-logo" + (lg ? " b-logo-lg" : "");
  if (logoUrl) return `<img class="${cls}" src="${esc(logoUrl)}" alt="" loading="lazy" onerror="this.remove()">`;
  const init = (name || "?").trim().split(/\s+/).map(w => w[0]).join("").slice(0, 2).toUpperCase();
  return `<span class="${cls} b-logo-txt">${esc(init)}</span>`;
}

// photos column arrives as jsonb array, or as a JSON string — normalize
function yayoPhotoList(x) {
  if (Array.isArray(x)) return x.filter(u => typeof u === "string");
  if (typeof x === "string") { try { const a = JSON.parse(x); return Array.isArray(a) ? a.filter(u => typeof u === "string") : []; } catch (e) { return []; } }
  return [];
}

// PWA: register the service worker (config.js is loaded on every page)
if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1")) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}
