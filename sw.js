// ═══════════════════════════════════════════════
// YAYO — Service worker (PWA, phase 12)
// Pages: network first (always fresh), cache fallback offline.
// Static files (css/js/images): cache first, refreshed in background.
// Never touches Supabase or Netlify Function calls.
// ═══════════════════════════════════════════════
const CACHE = "yayo-v1";
const CORE = [
  "index.html", "acheter.html", "voiture.html", "comment.html",
  "vendre.html", "expedier.html", "connexion.html", "favoris.html",
  "css/style.css", "js/config.js", "js/i18n.js", "js/demo.js", "js/auth.js",
  "js/app.js", "js/marketplace.js", "js/ai.js", "js/fav.js", "js/reviews.js",
  "assets/logo-teal.png", "assets/favicon.png", "assets/icon-192.png",
  "manifest.webmanifest"
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(CORE)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  if (url.origin !== location.origin) return;              // Supabase, fonts, CDN: browser handles
  if (url.pathname.includes("/.netlify/")) return;          // live AI/translation, never cached

  if (e.request.mode === "navigate") {
    // Pages: network first so prices are always fresh; cache if offline
    e.respondWith(
      fetch(e.request).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      }).catch(() =>
        caches.match(e.request).then((hit) => hit || caches.match("index.html"))
      )
    );
    return;
  }

  // Static: cache first, refresh in background
  e.respondWith(
    caches.match(e.request).then((hit) => {
      const refresh = fetch(e.request).then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      }).catch(() => hit);
      return hit || refresh;
    })
  );
});
