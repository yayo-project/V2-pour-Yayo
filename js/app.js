// ═══════════════════════════════════════════════
// YAYO — Landing app
// Loads real listings from Supabase; falls back to
// demo cars while dealers upload their inventory.
// ═══════════════════════════════════════════════

const sb = yayoSB();
const DEST = YAYO_CONFIG.DESTINATIONS;
let CUR = YAYO_CONFIG.DEFAULT_DEST;
let CARS = [];

// Demo cars shown until real listings exist (shared list in js/demo.js)
const DEMO_CARS = window.YAYO_DEMO.slice(0, 6);

function fmt(n) {
  return "$" + Math.round(n).toLocaleString("fr-FR").replace(/\u202f/g, " ");
}

function landedTotal(price, destKey) {
  const d = DEST[destKey];
  if (!d || destKey === "dubai") return price;
  return price + d.ship + price * d.duty + d.fees;
}

// ── Load real listings from Supabase ──
async function loadCars() {
  try {
    const { data, error } = await sb
      .from("listings")
      .select("*, dealers(name, verified, city)")
      .eq("active", true)
      .eq("sold", false)
      .order("created_at", { ascending: false })
      .limit(YAYO_CONFIG.FEATURED_LIMIT);

    if (!error && data && data.length > 0) {
      CARS = data.map(l => ({
        id: l.id,
        car_name: l.car_name,
        mileage: l.mileage,
        fuel: l.fuel || "",
        condition: l.condition || "",
        price: l.price,
        ai: "good", // AI verdict wired in the next stage
        photo_url: l.photo_url,
        dealer: { name: (l.dealers && l.dealers.name) || "Dealer Yayo", verified: !!(l.dealers && l.dealers.verified) }
      }));
      // If fewer than 3 real cars, pad with demo so the grid never looks empty
      if (CARS.length < 3) CARS = CARS.concat(DEMO_CARS.slice(0, 6 - CARS.length));
    } else {
      CARS = DEMO_CARS;
    }
  } catch (e) {
    CARS = DEMO_CARS;
  }
  renderCars();
}

function renderCars() {
  const g = document.getElementById("car-grid");
  if (!g) return;
  const dst = DEST[CUR];
  g.innerHTML = CARS.map(c => `
  <div class="car-card" onclick="openCar('${c.id || ""}')">
    <div class="car-img">
      <img src="${c.photo_url || ""}" alt="${escapeHtml(c.car_name)}" loading="lazy" onerror="this.parentNode.classList.add('noimg');this.remove()">
      <span class="ai-badge ${c.ai === "good" ? "ai-good" : "ai-nego"}">${c.ai === "good" ? t("badge_good") : t("badge_nego")}</span>
      <button class="fav" onclick="event.stopPropagation()" aria-label="Sauvegarder">♥</button>
    </div>
    <div class="car-body">
      <div class="car-title">${escapeHtml(c.car_name)}</div>
      <div class="car-meta">${c.mileage ? c.mileage.toLocaleString("fr-FR") + " km" : ""}${c.fuel ? " · " + escapeHtml(tFuel(c.fuel)) : (c.condition ? " · " + escapeHtml(c.condition) : "")}</div>
      <div class="car-price-row">
        <span class="car-price">${fmt(c.price)}</span>
        <span class="car-price-lbl">${t("a_dubai")}</span>
      </div>
      ${CUR === "dubai" ? "" : `
      <div class="landed">
        <span class="landed-lbl">🚢 ${t("rendu")} ${dst.name}</span>
        <span class="landed-val">≈ ${fmt(landedTotal(c.price, CUR))}</span>
      </div>`}
      <div class="car-dealer">
        ${c.dealer.verified ? '<span class="vcheck"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="4"><path d="M20 6L9 17l-5-5"/></svg></span>' : ""}
        ${escapeHtml(c.dealer.name)} · Dubai
      </div>
    </div>
  </div>`).join("");
}

function setDest(el) {
  document.querySelectorAll(".dpill").forEach(p => p.classList.remove("on"));
  el.classList.add("on");
  CUR = el.dataset.city;
  renderCars();
  updateCostCard();
}

function updateCostCard() {
  const key = CUR === "dubai" ? "kinshasa" : CUR;
  const d = DEST[key];
  const basePrice = 38500;
  setText("cost-city", d.name);
  setText("cost-ship", fmt(d.ship));
  setText("cost-duty", fmt(basePrice * d.duty));
  setText("cost-total", fmt(basePrice + d.ship + basePrice * d.duty + 420 + 650));
}

function setText(id, v) { const e = document.getElementById(id); if (e) e.textContent = v; }
function escapeHtml(s) { return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }

function toggleMenu() { document.getElementById("mmenu").classList.toggle("open"); }

function doSearch() {
  const q = document.getElementById("hero-search").value.trim();
  location.href = q ? "acheter.html?q=" + encodeURIComponent(q) : "acheter.html";
}
function quickSearch(q) { location.href = "acheter.html?q=" + encodeURIComponent(q); }
function openCar(id) { location.href = "voiture.html?id=" + encodeURIComponent(id); }
function soon(e, msg) { e.preventDefault(); e.stopPropagation(); alert(msg); }

// Re-render dynamic content when the language changes
window.onLangChange = () => { renderCars(); updateCostCard(); };

// ── Init ──
loadCars();
updateCostCard();
