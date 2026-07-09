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

// Premium verified badge (X/Twitter style): filled trust-blue seal with a
// white check. THE trust symbol — used everywhere a verified business appears.
// cls: "" (inline 16px) | "lg" (22px) | "xl" (28px)
function yayoVBadge(cls) {
  return `<svg class="vseal${cls ? " vseal-" + cls : ""}" viewBox="0 0 24 24" role="img" aria-label="Vérifié par Yayo">
    <title>Vérifié par Yayo</title>
    <defs><linearGradient id="yayoVsg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#53BCF9"/><stop offset="1" stop-color="#1D9BF0"/>
    </linearGradient></defs>
    <path fill="url(#yayoVsg)" d="M22.25 12c0-1.43-.88-2.67-2.19-3.34.46-1.39.2-2.9-.81-3.91s-2.52-1.27-3.91-.81c-.66-1.31-1.91-2.19-3.34-2.19s-2.67.88-3.33 2.19c-1.4-.46-2.91-.2-3.92.81s-1.26 2.52-.8 3.91c-1.31.67-2.2 1.91-2.2 3.34s.89 2.67 2.2 3.34c-.46 1.39-.21 2.9.8 3.91s2.52 1.26 3.91.81c.67 1.31 1.91 2.19 3.34 2.19s2.68-.88 3.34-2.19c1.39.45 2.9.2 3.91-.81s1.27-2.52.81-3.91c1.31-.67 2.19-1.91 2.19-3.34z"/>
    <path fill="none" stroke="#fff" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" d="M8.3 12.2l2.5 2.5 4.9-5.1"/>
    <path fill="none" stroke="rgba(255,255,255,.35)" stroke-width=".6" d="M20.9 12c0-1.15-.71-2.15-1.76-2.69.37-1.12.16-2.33-.65-3.14s-2.03-1.02-3.15-.65C14.8 4.46 13.8 3.75 12.65 3.75"/>
  </svg>`;
}

// Verified pill: the seal + its label ("Vérifié Yayo" / "Partenaire transport
// vérifié") in a blue trust chip. Use wherever the badge must be UNMISSABLE:
// dealer card, chat headers, agency profile, transport compare.
function yayoVPill(label, sm) {
  return `<span class="vpill${sm ? " vpill-sm" : ""}">${yayoVBadge()}<b>${label || "Vérifié Yayo"}</b></span>`;
}

// BIG trust band: a full-width blue "Vérifié par Yayo" strip with the seal.
// Shown on the "Vendu par" card, agency contact card and above every chat —
// the moments where the buyer decides whether to trust.
function yayoVBand(sub) {
  return `<div class="vband">${yayoVBadge("xl")}<div class="vband-tx"><b>${t("vband_t")}</b><span>${sub || ""}</span></div></div>`;
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
