// ═══════════════════════════════════════════════
// YAYO — Marketplace (acheter.html)
// Loads listings from Supabase; falls back to demo.
// Client-side filter, sort, URL-param sync.
// ═══════════════════════════════════════════════

const sb = yayoSB();
const DEST = YAYO_CONFIG.DESTINATIONS;
const BRANDS = ["Toyota","Kia","Hyundai","Nissan","Mercedes","Honda","Mitsubishi","Lexus"];
let CUR = YAYO_CONFIG.DEFAULT_DEST;
let ALL = [];
let FILTERED = [];

const DEMO_CARS = window.YAYO_DEMO;

// Body type from name keywords — used for real listings (no body column in schema yet)
const BODY_HINTS = [
  ["Pick-up", ["hilux", "pick-up", "pickup", "ranger", "navara", "l200", "triton", "tundra", "f-150"]],
  ["Minibus", ["hiace", "minibus", "quantum", "coaster", "urvan", "h1 "]],
  ["Berline", ["corolla", "camry", "c200", "c300", "e200", "accent", "elantra", "sonata", "cerato", "altima", "sunny", "civic", "accord", "yaris", "berline"]]
];
function bodyOf(c) {
  if (c.body) return c.body;
  const n = (c.car_name || "").toLowerCase();
  for (const [type, words] of BODY_HINTS) if (words.some(w => n.includes(w))) return type;
  return "SUV";
}

function fmt(n) { return yayoFmt(n); }
function landedTotal(price, key) { return yayoLandedTotal(price, key); }
function escapeHtml(s) { return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
function brandOf(c) { const w = (c.car_name || "").split(" ")[0]; return BRANDS.find(b => b.toLowerCase() === w.toLowerCase()) || w; }

async function loadCars() {
  // skeleton shimmer while listings load
  const g0 = document.getElementById("car-grid");
  if (g0 && !g0.children.length) g0.innerHTML = yayoSkelCards(6);
  try {
    let { data, error } = await sb
      .from("listings")
      .select("*, dealers(*)")
      .eq("active", true).eq("sold", false)
      .order("created_at", { ascending: false })
      .limit(200);
    if (!error && data && data.length > 0) {
      // buyers only ever see listings from ADMIN-VERIFIED dealers
      data = data.filter(l => !l.hidden && l.dealers && l.dealers.verified && !l.dealers.suspended);
      ALL = data.map(l => ({
        id: l.id,
        car_name: l.car_name,
        year: l.year,
        mileage: l.mileage,
        fuel: l.fuel || "",
        condition: l.condition || "",
        body: l.body || "",
        price: l.price,
        photo_url: l.photo_url,
        photos: yayoPhotoList(l.photos),
        dealer: { name: (l.dealers && l.dealers.name) || "Dealer Yayo", verified: !!(l.dealers && l.dealers.verified), logo_url: (l.dealers && l.dealers.logo_url) || null }
      }));
      // same demo padding as the landing page (16) so budget-row counts match
      if (ALL.length < 16) ALL = ALL.concat(DEMO_CARS.slice(0, 16 - ALL.length));
    } else {
      ALL = DEMO_CARS;
    }
  } catch (e) {
    ALL = DEMO_CARS;
  }
  applyFilters();
  yayoLoadVerdicts(ALL, render); // real AI price verdicts, badge appears when ready
}

function readParams() {
  const p = new URLSearchParams(location.search);
  document.getElementById("mkt-q").value = p.get("q") || "";
  document.getElementById("f-min").value = p.get("min") || "";
  document.getElementById("f-max").value = p.get("max") || "";
  document.getElementById("f-year").value = p.get("year") || "";
  document.getElementById("mkt-sort").value = p.get("sort") || "recent";
  const brands = (p.get("brand") || "").split(",").filter(Boolean);
  document.querySelectorAll("#f-brand button").forEach(b => b.classList.toggle("on", brands.includes(b.dataset.v)));
  const fuels = (p.get("fuel") || "").split(",").filter(Boolean);
  document.querySelectorAll("#f-fuel button").forEach(b => b.classList.toggle("on", fuels.includes(b.dataset.v)));
  const bodies = (p.get("body") || "").split(",").filter(Boolean);
  document.querySelectorAll("#f-body button").forEach(b => b.classList.toggle("on", bodies.includes(b.dataset.v)));
}

function writeParams() {
  const p = new URLSearchParams();
  const q = document.getElementById("mkt-q").value.trim();
  const min = document.getElementById("f-min").value;
  const max = document.getElementById("f-max").value;
  const year = document.getElementById("f-year").value;
  const sort = document.getElementById("mkt-sort").value;
  const brands = [...document.querySelectorAll("#f-brand button.on")].map(b => b.dataset.v);
  const fuels = [...document.querySelectorAll("#f-fuel button.on")].map(b => b.dataset.v);
  const bodies = [...document.querySelectorAll("#f-body button.on")].map(b => b.dataset.v);
  if (q) p.set("q", q);
  if (min) p.set("min", min);
  if (max) p.set("max", max);
  if (year) p.set("year", year);
  if (sort && sort !== "recent") p.set("sort", sort);
  if (brands.length) p.set("brand", brands.join(","));
  if (fuels.length) p.set("fuel", fuels.join(","));
  if (bodies.length) p.set("body", bodies.join(","));
  const s = p.toString();
  history.replaceState(null, "", s ? "?" + s : location.pathname);
}

// Budget search: "$18 000, Kinshasa" → cars whose LANDED cost fits
let BUDGET = null;
function parseBudget(q) {
  const m = q.match(/\$?\s*(\d{1,3}(?:[ .,  ]\d{3})+|\d{4,7})\s*\$?/);
  if (!m) return null;
  const amount = parseInt(m[1].replace(/[^\d]/g, ""), 10);
  if (!(amount >= 3000 && amount <= 2000000)) return null;
  // words left besides the amount must be a known city (or nothing) — else it's a model search like "RAV4 2022"
  const rest = q.replace(m[0], " ").toLowerCase();
  let city = null;
  for (const k of Object.keys(DEST)) if (rest.includes(k)) city = k;
  const leftover = rest.replace(/kinshasa|douala|abidjan|dakar|dubai/g, "").replace(/[^a-zÀ-ɏ]/g, "");
  if (leftover.length > 2 && !city) return null;
  return { amount, city };
}

function setDestKey(k) {
  CUR = k;
  document.querySelectorAll(".dpill").forEach(p => p.classList.toggle("on", p.dataset.city === k));
}

function applyFilters() {
  writeParams();
  const qRaw = document.getElementById("mkt-q").value.trim();
  const q = qRaw.toLowerCase();
  const min = parseInt(document.getElementById("f-min").value, 10);
  const max = parseInt(document.getElementById("f-max").value, 10);
  const year = parseInt(document.getElementById("f-year").value, 10);
  const brands = [...document.querySelectorAll("#f-brand button.on")].map(b => b.dataset.v);
  const fuels = [...document.querySelectorAll("#f-fuel button.on")].map(b => b.dataset.v);
  const bodies = [...document.querySelectorAll("#f-body button.on")].map(b => b.dataset.v);
  const sort = document.getElementById("mkt-sort").value;

  BUDGET = qRaw ? parseBudget(qRaw) : null;
  if (BUDGET && BUDGET.city && BUDGET.city !== CUR) setDestKey(BUDGET.city);

  FILTERED = ALL.filter(c => {
    if (BUDGET) {
      if (landedTotal(c.price, CUR) > BUDGET.amount) return false;
    } else if (q) {
      const name = (c.car_name || "").toLowerCase();
      if (!q.split(/\s+/).every(w => name.includes(w))) return false;
    }
    if (!isNaN(min) && c.price < min) return false;
    if (!isNaN(max) && c.price > max) return false;
    if (!isNaN(year) && (c.year || 0) < year) return false;
    if (brands.length && !brands.includes(brandOf(c))) return false;
    if (fuels.length && !fuels.includes(c.fuel)) return false;
    if (bodies.length && !bodies.includes(bodyOf(c))) return false;
    return true;
  });
  if (BUDGET) FILTERED.sort((a, b) => landedTotal(b.price, CUR) - landedTotal(a.price, CUR));

  if (sort === "price-asc") FILTERED.sort((a, b) => a.price - b.price);
  else if (sort === "price-desc") FILTERED.sort((a, b) => b.price - a.price);
  else if (sort === "year-desc") FILTERED.sort((a, b) => (b.year || 0) - (a.year || 0));
  else if (sort === "km-asc") FILTERED.sort((a, b) => (a.mileage || 0) - (b.mileage || 0));

  render();
}

function render() {
  const g = document.getElementById("car-grid");
  const empty = document.getElementById("mkt-empty");
  const count = document.getElementById("mkt-count");
  const dst = DEST[CUR];

  const base = FILTERED.length === 0
    ? t("count_none")
    : `${FILTERED.length} ${FILTERED.length > 1 ? t("count_cars") : t("count_car")} · ${CUR === "dubai" ? t("a_dubai") : t("count_rendu") + " " + dst.name}`;
  count.textContent = BUDGET ? `${base} · ${t("bud_lbl")} ≤ ${fmt(BUDGET.amount)}` : base;

  if (FILTERED.length === 0) { g.innerHTML = ""; empty.hidden = false; return; }
  empty.hidden = true;

  g.innerHTML = FILTERED.map(c => `
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
  trackDest(CUR);
  render();
}

// Top-destinations counter (admin stats) + traffic event — always best effort
function trackDest(city) {
  try { sb.rpc("yayo_dest", { c: city }).then(() => {}, () => {}); } catch (e) {}
  if (typeof yayoTrack === "function") yayoTrack("choose_destination", { city });
}

function clearFilters() {
  document.getElementById("mkt-q").value = "";
  document.getElementById("f-min").value = "";
  document.getElementById("f-max").value = "";
  document.getElementById("f-year").value = "";
  document.querySelectorAll("#f-brand button, #f-fuel button, #f-body button").forEach(b => b.classList.remove("on"));
  document.getElementById("mkt-sort").value = "recent";
  applyFilters();
}

function toggleFilters() {
  document.getElementById("mkt-filters").classList.toggle("open");
  document.getElementById("mkt-backdrop").classList.toggle("on");
  document.body.classList.toggle("no-scroll");
}

function closeFiltersIfMobile() {
  if (document.getElementById("mkt-filters").classList.contains("open")) toggleFilters();
}

function toggleMenu() { document.getElementById("mmenu").classList.toggle("open"); }
function openCar(id) { location.href = "voiture.html?id=" + encodeURIComponent(id); }
function soon(e, msg) { e.preventDefault(); e.stopPropagation(); alert(msg); }

function buildBrandFilter() {
  const el = document.getElementById("f-brand");
  el.innerHTML = BRANDS.map(b => `<button type="button" data-v="${b}">${b}</button>`).join("");
  el.querySelectorAll("button").forEach(b => b.addEventListener("click", () => { b.classList.toggle("on"); applyFilters(); }));
  document.querySelectorAll("#f-fuel button, #f-body button").forEach(b => b.addEventListener("click", () => { b.classList.toggle("on"); applyFilters(); }));
}

let searchTimer;
function initSearch() {
  const q = document.getElementById("mkt-q");
  q.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(applyFilters, 220);
  });
  q.addEventListener("keydown", e => {
    if (e.key === "Enter") { clearTimeout(searchTimer); applyFilters(); }
  });
  ["f-min", "f-max", "f-year"].forEach(id => {
    document.getElementById(id).addEventListener("change", applyFilters);
  });
}

// Re-render results when the language changes (skip until first load is done)
window.onLangChange = () => { if (ALL.length) render(); };

buildBrandFilter();
initSearch();
readParams();
loadCars();
