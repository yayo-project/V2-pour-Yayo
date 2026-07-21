// ═══════════════════════════════════════════════
// YAYO — Service worker (PWA, phase 12)
// Everything same-origin: network first (always fresh after a deploy),
// cache fallback when offline. Never touches Supabase or Netlify Functions.
// ═══════════════════════════════════════════════
const CACHE = "yayo-v34";
const CORE = [
  "index.html", "acheter.html", "voiture.html", "comment.html", "agence.html", "agences.html",
  "vendre.html", "expedier.html", "connexion.html", "favoris.html", "messages.html",
  "css/style.css", "js/config.js", "js/analytics.js", "js/i18n.js", "js/demo.js", "js/auth.js",
  "js/app.js", "js/marketplace.js", "js/voiture.js", "js/agence.js", "js/charts.js",
  "js/ai.js", "js/fav.js", "js/reviews.js", "js/messages.js", "js/pricing.js", "js/translate.js",
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

// ── PUSH NOTIFICATIONS (installed PWA) ──
// The phone buzzes and rings even when Yayo is closed. The payload carries
// no message content — just "you have a new message" + where to open it.
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = {}; }
  const title = d.title || "Yayo";
  const opts = {
    body: d.body || "Nouveau message sur Yayo",
    icon: "assets/icon-192.png",
    badge: "assets/icon-192.png",
    vibrate: [200, 100, 200],          // buzz pattern (Android)
    tag: d.tag || "yayo-message",      // a 2nd message replaces, never spams
    renotify: true,                    // …but still buzzes again
    requireInteraction: false,
    data: { url: d.url || "messages.html" }
  };
  e.waitUntil(self.registration.showNotification(title, opts));
});

// Tapping the notification opens the conversation (focus the tab if already open)
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const target = (e.notification.data && e.notification.data.url) || "messages.html";
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if (c.url.includes(target) && "focus" in c) return c.focus();
      }
      return self.clients.openWindow(target);
    })
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  if (url.origin !== location.origin) return;              // Supabase, fonts, CDN: browser handles
  if (url.pathname.includes("/.netlify/")) return;          // live AI/translation, never cached

  // Network first: after a deploy everyone gets the fresh file right away.
  // The cache only serves when the connection is down.
  e.respondWith(
    fetch(e.request).then((res) => {
      if (res && res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
      }
      return res;
    }).catch(() =>
      caches.match(e.request).then((hit) =>
        hit || (e.request.mode === "navigate" ? caches.match("index.html") : Response.error())
      )
    )
  );
});
