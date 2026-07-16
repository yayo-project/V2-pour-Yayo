// ═══════════════════════════════════════════════
// YAYO — Configuration
// Supabase publishable key (safe for client use).
// AI keys live in Netlify Functions, never here.
// ═══════════════════════════════════════════════
const YAYO_CONFIG = {
  SUPABASE_URL: "https://wkjxdkeqffsjarjxlsyh.supabase.co",
  SUPABASE_KEY: "sb_publishable_-mDN0Rd9q8q2SJuJPsn_qw_ieHvuSB8",

  // Destinations: shipping (USD, replaced by the chosen agency's REAL price)
  // + published customs structure per country — ALWAYS shown as "estimation".
  // Customs are computed on CIF (car price + freight), the real base used by
  // customs offices, not on the car price alone.
  //   duty  = import duty (DRC: tarif douanier ~10% vehicles; CEMAC TEC 30%;
  //           UEMOA TEC 20% for CI/Sénégal)
  //   extra = excise/levies (DRC droits de consommation ~10%; CI/SN
  //           prélèvements communautaires + redevance statistique ~2-2.5%)
  //   vat   = TVA applied on (CIF + duty + extra): DRC 16%, CM 19.25%, CI/SN 18%
  // legacy `duty` kept as the flat effective fallback for any old code path.
  DESTINATIONS: {
    kinshasa: { name: "Kinshasa", flag: "🇨🇩", ship: 3200, fees: 1070, duty: 0.45,
                customs: { duty: 0.10, extra: 0.10, vat: 0.16 } },
    douala:   { name: "Douala",   flag: "🇨🇲", ship: 2800, fees: 1070, duty: 0.50,
                customs: { duty: 0.30, extra: 0.00, vat: 0.1925 } },
    abidjan:  { name: "Abidjan",  flag: "🇨🇮", ship: 3500, fees: 1070, duty: 0.44,
                customs: { duty: 0.20, extra: 0.025, vat: 0.18 } },
    dakar:    { name: "Dakar",    flag: "🇸🇳", ship: 3300, fees: 1070, duty: 0.48,
                customs: { duty: 0.20, extra: 0.024, vat: 0.18 } },
    dubai:    { name: "Dubai",    flag: "🇦🇪", ship: 0, fees: 0, duty: 0, customs: null }
  },
  DEFAULT_DEST: "kinshasa",
  FEATURED_LIMIT: 6,

  // Real Al Aweer market photos for the landing hero. Empty = hero stays
  // text-only. Drop files in assets/hero/ then list them here, e.g.
  // ["assets/hero/aweer-1.jpg", "assets/hero/aweer-2.jpg", "assets/hero/aweer-3.jpg"]
  HERO_PHOTOS: [],

  // Phone login (SMS one-time code). OFF until SMS credits are funded
  // (Brevo SMS hook — queue item #5). Flip to true to bring the phone
  // tab back on connexion.html; all the code stays in place.
  SMS_LOGIN: false,

  // Web Push (PWA notifications). Public half of the VAPID key pair — safe
  // in client code; the private half lives only in Netlify env vars.
  VAPID_PUBLIC: "BHsW9an46eaujKERDv9B2532rlE17WYtoXt13qlxHhNYWUjhzVlEcrI2Jta3qxOKB7XOHLaboe8LGgpTjamXBaI",

  // Google Analytics 4 — the gtag snippet in each page's <head> uses this same ID.
  GA4_ID: "G-NR2LTEVKET"
};

// Shared money formatter. The thousands separator is a NON-BREAKING space
// ( ) so "$3 200" can never wrap into "$3" / "200" on a narrow phone.
function yayoFmt(n) {
  return "$" + Math.round(Number(n) || 0).toLocaleString("fr-FR").replace(/[   ]/g, " ");
}

// ── Customs estimation (published formulas, per country) ──
// Returns every line of the estimate so pages can show a real breakdown.
// base = CIF (car price + freight) — what customs offices actually tax.
function yayoCustoms(price, ship, destKey) {
  const d = YAYO_CONFIG.DESTINATIONS[destKey];
  if (!d || !d.customs) return { duty: 0, extra: 0, vat: 0, total: 0, c: null };
  const c = d.customs;
  // numeric DB columns arrive as strings — "6000" + 3200 would glue digits
  // ("60003200") instead of adding. Force real numbers, always.
  price = Number(price) || 0;
  ship = Number(ship) || 0;
  const cif = price + ship;
  const duty = cif * c.duty;
  const extra = cif * c.extra;
  const vat = (cif + duty + extra) * c.vat;
  return { duty, extra, vat, total: duty + extra + vat, c };
}

// Full landed total for a destination (optionally with a real agency price)
function yayoLandedTotal(price, destKey, shipOverride) {
  const d = YAYO_CONFIG.DESTINATIONS[destKey];
  price = Number(price) || 0;
  if (!d || destKey === "dubai") return price;
  const ship = Number((shipOverride != null) ? shipOverride : d.ship) || 0;
  return price + ship + yayoCustoms(price, ship, destKey).total + d.fees;
}

// Skeleton shimmer cards shown while real listings load (premium loading feel)
function yayoSkelCards(n) {
  return Array.from({ length: n }, () => `
  <div class="skel-card"><div class="skel skel-img"></div><div class="skel-body">
    <div class="skel skel-line" style="width:72%"></div>
    <div class="skel skel-line" style="width:46%"></div>
    <div class="skel skel-line" style="width:58%;margin-bottom:0"></div>
  </div></div>`).join("");
}

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
  // Solid trust-blue fill (no gradient reference — renders on every browser)
  return `<svg class="vseal${cls ? " vseal-" + cls : ""}" viewBox="0 0 24 24" role="img" aria-label="Vérifié par Yayo">
    <title>Vérifié par Yayo</title>
    <path fill="#1D9BF0" d="M22.25 12c0-1.43-.88-2.67-2.19-3.34.46-1.39.2-2.9-.81-3.91s-2.52-1.27-3.91-.81c-.66-1.31-1.91-2.19-3.34-2.19s-2.67.88-3.33 2.19c-1.4-.46-2.91-.2-3.92.81s-1.26 2.52-.8 3.91c-1.31.67-2.2 1.91-2.2 3.34s.89 2.67 2.2 3.34c-.46 1.39-.21 2.9.8 3.91s2.52 1.26 3.91.81c.67 1.31 1.91 2.19 3.34 2.19s2.68-.88 3.34-2.19c1.39.45 2.9.2 3.91-.81s1.27-2.52.81-3.91c1.31-.67 2.19-1.91 2.19-3.34z"/>
    <path fill="none" stroke="#fff" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" d="M8.3 12.2l2.5 2.5 4.9-5.1"/>
    <path fill="none" stroke="rgba(255,255,255,.4)" stroke-width=".7" d="M20.9 12c0-1.15-.71-2.15-1.76-2.69.37-1.12.16-2.33-.65-3.14s-2.03-1.02-3.15-.65C14.8 4.46 13.8 3.75 12.65 3.75"/>
  </svg>`;
}

// Verified pill: the seal + its label ("Vérifié Yayo" / "Partenaire transport
// vérifié") in a blue trust chip. Use wherever the badge must be UNMISSABLE:
// dealer card, chat headers, agency profile, transport compare.
// X-style: the text first, the blue seal ON THE RIGHT of it.
function yayoVPill(label, sm) {
  return `<span class="vpill${sm ? " vpill-sm" : ""}"><b>${label || "Vérifié Yayo"}</b>${yayoVBadge()}</span>`;
}

// BIG trust band: a full-width blue "Vérifié par Yayo" strip with the seal.
// Shown on the "Vendu par" card, agency contact card and above every chat —
// the moments where the buyer decides whether to trust.
function yayoVBand(sub) {
  return `<div class="vband"><div class="vband-tx"><b>${t("vband_t")} ${yayoVBadge()}</b><span>${sub || ""}</span></div>${yayoVBadge("xl")}</div>`;
}

// ── Demo conversations (pre-launch): chats on demo cars live on this device
// so the buyer inbox behaves exactly like the real thing — you see who you
// contacted and can follow up, even before real dealers reply. ──
function yayoDemoConvos() {
  try { return JSON.parse(localStorage.getItem("yayo-demo-convos") || "[]"); } catch (e) { return []; }
}
function yayoDemoConvo(carId) {
  return yayoDemoConvos().find(c => c.carId === carId) || null;
}
function yayoDemoConvoPush(car, msg) {
  const all = yayoDemoConvos();
  let c = all.find(x => x.carId === car.id);
  if (!c) {
    c = { id: "demo-convo-" + car.id, carId: car.id, car_name: car.car_name,
          who: (car.dealer && car.dealer.name) || "Dealer Yayo", msgs: [] };
    all.push(c);
  }
  c.msgs.push({ me: !!msg.me, text: msg.text, at: new Date().toISOString() });
  c.lastAt = new Date().toISOString();
  try { localStorage.setItem("yayo-demo-convos", JSON.stringify(all.slice(-20))); } catch (e) {}
}

// photos column arrives as jsonb array, or as a JSON string — normalize
function yayoPhotoList(x) {
  if (Array.isArray(x)) return x.filter(u => typeof u === "string");
  if (typeof x === "string") { try { const a = JSON.parse(x); return Array.isArray(a) ? a.filter(u => typeof u === "string") : []; } catch (e) { return []; } }
  return [];
}

// Boot screen: config.js is the first script at the end of body, so by the
// time it runs, the page's CSS is loaded — fade the navy splash away.
(function () {
  const b = document.getElementById("yayo-boot");
  if (!b) return;
  b.classList.add("off");
  setTimeout(() => b.remove(), 450);
})();

// PWA: register the service worker (config.js is loaded on every page)
if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1")) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}
