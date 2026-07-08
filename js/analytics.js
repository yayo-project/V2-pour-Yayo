// ═══════════════════════════════════════════════
// YAYO — Website analytics (Google Analytics 4)
// Loads only when YAYO_CONFIG.GA4_ID is set (js/config.js).
// yayoTrack(event, params) is always safe to call.
// ═══════════════════════════════════════════════
(function () {
  var id = window.YAYO_CONFIG && YAYO_CONFIG.GA4_ID;
  if (!id) return;
  var s = document.createElement("script");
  s.async = true;
  s.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(id);
  document.head.appendChild(s);
  window.dataLayer = window.dataLayer || [];
  window.gtag = function () { dataLayer.push(arguments); };
  gtag("js", new Date());
  gtag("config", id);
})();

// Funnel events (car_view, contact_dealer, sign_up…) — no-op when GA is off
function yayoTrack(event, params) {
  try { if (window.gtag) gtag("event", event, params || {}); } catch (e) {}
}
