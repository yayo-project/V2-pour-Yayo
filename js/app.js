// ═══════════════════════════════════════════════
// YAYO — Landing app
// Loads real listings from Supabase; falls back to
// demo cars while dealers upload their inventory.
// ═══════════════════════════════════════════════

const sb = window.supabase.createClient(YAYO_CONFIG.SUPABASE_URL, YAYO_CONFIG.SUPABASE_KEY);
const DEST = YAYO_CONFIG.DESTINATIONS;
let CUR = YAYO_CONFIG.DEFAULT_DEST;
let CARS = [];

// Demo cars shown until real listings exist (marked visually identical)
const DEMO_CARS = [
  { car_name: "Toyota Land Cruiser GXR 2021", mileage: 78000, fuel: "Essence",  price: 38500, ai: "good", photo_url: "https://images.unsplash.com/photo-1594502184342-2e12f877aa73?w=640&q=70", dealer: { name: "Mukoma Auto", verified: true } },
  { car_name: "Toyota RAV4 Hybrid 2022",      mileage: 41000, fuel: "Hybride",  price: 27900, ai: "nego", photo_url: "https://images.unsplash.com/photo-1633708392839-895ecc4e5d13?w=640&q=70", dealer: { name: "Kabeya Auto", verified: true } },
  { car_name: "Toyota Hilux 4x4 2020",        mileage: 96000, fuel: "Diesel",   price: 31200, ai: "good", photo_url: "https://images.unsplash.com/photo-1559416523-140ddc3d238c?w=640&q=70", dealer: { name: "Mukoma Auto", verified: true } },
  { car_name: "Kia Sportage 2023",            mileage: 22000, fuel: "Essence",  price: 24800, ai: "good", photo_url: "https://images.unsplash.com/photo-1617469767053-d3b523a0b982?w=640&q=70", dealer: { name: "Kabeya Auto", verified: true } },
  { car_name: "Hyundai Tucson 2022",          mileage: 35000, fuel: "Essence",  price: 23500, ai: "nego", photo_url: "https://images.unsplash.com/photo-1606664515524-ed2f786a0bd6?w=640&q=70", dealer: { name: "Mukoma Auto", verified: true } },
  { car_name: "Mercedes GLE 400 2021",        mileage: 55000, fuel: "Essence",  price: 52000, ai: "good", photo_url: "https://images.unsplash.com/photo-1563720223185-11003d516935?w=640&q=70", dealer: { name: "Kabeya Auto", verified: true } }
];

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
        fuel: l.condition || "",
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
      <span class="ai-badge ${c.ai === "good" ? "ai-good" : "ai-nego"}">${c.ai === "good" ? "✓ Bon prix" : "~ Négociable"}</span>
      <button class="fav" onclick="event.stopPropagation()" aria-label="Sauvegarder">♥</button>
    </div>
    <div class="car-body">
      <div class="car-title">${escapeHtml(c.car_name)}</div>
      <div class="car-meta">${c.mileage ? c.mileage.toLocaleString("fr-FR") + " km" : ""}${c.fuel ? " · " + escapeHtml(c.fuel) : ""}</div>
      <div class="car-price-row">
        <span class="car-price">${fmt(c.price)}</span>
        <span class="car-price-lbl">à Dubai</span>
      </div>
      ${CUR === "dubai" ? "" : `
      <div class="landed">
        <span class="landed-lbl">🚢 Rendu ${dst.name}</span>
        <span class="landed-val">${fmt(landedTotal(c.price, CUR))}</span>
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
function openCar(id) { alert("Page voiture détaillée — étape suivante de construction"); }
function soon(e, msg) { e.preventDefault(); e.stopPropagation(); alert(msg); }

// ── Init ──
loadCars();
updateCostCard();
