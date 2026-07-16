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
  return yayoLandedTotal(price, destKey);
}

// ── Load real listings from Supabase ──
async function loadCars() {
  // skeleton shimmer while the real cards load — never a blank grid
  const g0 = document.getElementById("car-grid");
  if (g0 && !g0.children.length) g0.innerHTML = yayoSkelCards(6);
  try {
    let { data, error } = await sb
      .from("listings")
      .select("*, dealers(*)")
      .eq("active", true)
      .eq("sold", false)
      .order("created_at", { ascending: false })
      .limit(YAYO_CONFIG.FEATURED_LIMIT);

    if (!error && data && data.length > 0) {
      // buyers only ever see listings from ADMIN-VERIFIED dealers
      // (pending/suspended dealers prepare in their dashboard, invisible here)
      data = data.filter(l => !l.hidden && l.dealers && l.dealers.verified && !l.dealers.suspended);
      CARS = data.map(l => ({
        id: l.id,
        car_name: l.car_name,
        mileage: l.mileage,
        fuel: l.fuel || "",
        condition: l.condition || "",
        year: l.year,
        price: l.price,
        photo_url: l.photo_url,
        photos: yayoPhotoList(l.photos),
        dealer: { name: (l.dealers && l.dealers.name) || "Dealer Yayo", verified: !!(l.dealers && l.dealers.verified), logo_url: (l.dealers && l.dealers.logo_url) || null }
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
  yayoLoadVerdicts(CARS, renderCars); // real AI price verdicts, badge appears when ready
}

function renderCars() {
  const g = document.getElementById("car-grid");
  if (!g) return;
  const dst = DEST[CUR];
  g.innerHTML = CARS.map(c => `
  <div class="car-card" onclick="openCar('${c.id || ""}')">
    <div class="car-img">
      <img src="${c.photo_url || ""}" alt="${escapeHtml(c.car_name)}" loading="lazy" onerror="this.parentNode.classList.add('noimg');this.remove()">
      ${carBadge(c)}
      ${favBtn(c.id, c.car_name)}
      ${c.photos && c.photos.length > 1 ? `<span class="card-pcount"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg> ${c.photos.length}</span>` : ""}
    </div>
    <div class="car-body">
      <div class="car-title">${escapeHtml(c.car_name)}</div>
      <div class="car-chips">${c.year ? `<span>${c.year}</span>` : ""}${c.mileage ? `<span>${Number(c.mileage).toLocaleString("fr-FR")} km</span>` : ""}${c.fuel ? `<span>${escapeHtml(tFuel(c.fuel))}</span>` : (c.condition ? `<span>${escapeHtml(c.condition)}</span>` : "")}</div>
      <div class="car-price-row">
        <span class="car-price">${fmt(c.price)}</span>
        <span class="car-price-lbl">${t("a_dubai")}</span>
      </div>
      ${CUR === "dubai" ? "" : `
      <div class="landed">
        <span class="landed-lbl">${t("rendu2")} ${dst.name}</span>
        <span class="landed-val">≈ ${fmt(landedTotal(c.price, CUR))}</span>
      </div>`}
      <div class="car-dealer">
        ${yayoAvatarHtml(c.dealer.name, c.dealer.logo_url)}
        ${escapeHtml(c.dealer.name)}${c.dealer.verified ? " " + yayoVBadge() : ""} · Dubai
      </div>
    </div>
  </div>`).join("");
  markFavHearts(g);
}

function setDest(el) {
  document.querySelectorAll(".dpill").forEach(p => p.classList.remove("on"));
  el.classList.add("on");
  CUR = el.dataset.city;
  // top-destinations counter (admin stats) + traffic event — best effort
  try { sb.rpc("yayo_dest", { c: CUR }).then(() => {}, () => {}); } catch (e) {}
  if (typeof yayoTrack === "function") yayoTrack("choose_destination", { city: CUR });
  renderCars();
  updateCostCard();
}

function updateCostCard() {
  const key = CUR === "dubai" ? "kinshasa" : CUR;
  const d = DEST[key];
  const basePrice = 38500;
  setText("cost-city", d.name);
  setText("cost-ship", fmt(d.ship));
  setText("cost-duty", fmt(yayoCustoms(basePrice, d.ship, key).total));
  setText("cost-total", fmt(yayoLandedTotal(basePrice, key)));
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
