// ═══════════════════════════════════════════════
// YAYO — Marketplace (acheter.html)
// Loads listings from Supabase; falls back to demo.
// Client-side filter, sort, URL-param sync.
// ═══════════════════════════════════════════════

const sb = window.supabase.createClient(YAYO_CONFIG.SUPABASE_URL, YAYO_CONFIG.SUPABASE_KEY);
const DEST = YAYO_CONFIG.DESTINATIONS;
const BRANDS = ["Toyota","Kia","Hyundai","Nissan","Mercedes","Honda","Mitsubishi","Lexus"];
let CUR = YAYO_CONFIG.DEFAULT_DEST;
let ALL = [];
let FILTERED = [];

const DEMO_CARS = [
  { car_name: "Toyota Land Cruiser GXR 2021", year: 2021, mileage: 78000, fuel: "Essence",  body: "SUV",     price: 38500, ai: "good", photo_url: "https://images.unsplash.com/photo-1594502184342-2e12f877aa73?w=640&q=70", dealer: { name: "Mukoma Auto", verified: true } },
  { car_name: "Toyota RAV4 Hybrid 2022",      year: 2022, mileage: 41000, fuel: "Hybride",  body: "SUV",     price: 27900, ai: "nego", photo_url: "https://images.unsplash.com/photo-1706509234538-9831b1b33d66?w=640&q=70", dealer: { name: "Kabeya Auto", verified: true } },
  { car_name: "Toyota Hilux 4x4 2020",        year: 2020, mileage: 96000, fuel: "Diesel",   body: "Pick-up", price: 31200, ai: "good", photo_url: "https://images.unsplash.com/photo-1559416523-140ddc3d238c?w=640&q=70", dealer: { name: "Mukoma Auto", verified: true } },
  { car_name: "Kia Sportage 2023",            year: 2023, mileage: 22000, fuel: "Essence",  body: "SUV",     price: 24800, ai: "good", photo_url: "https://images.unsplash.com/photo-1617469767053-d3b523a0b982?w=640&q=70", dealer: { name: "Kabeya Auto", verified: true } },
  { car_name: "Hyundai Tucson 2022",          year: 2022, mileage: 35000, fuel: "Essence",  body: "SUV",     price: 23500, ai: "nego", photo_url: "https://images.unsplash.com/photo-1606664515524-ed2f786a0bd6?w=640&q=70", dealer: { name: "Mukoma Auto", verified: true } },
  { car_name: "Mercedes GLE 400 2021",        year: 2021, mileage: 55000, fuel: "Essence",  body: "SUV",     price: 52000, ai: "good", photo_url: "https://images.unsplash.com/photo-1563720223185-11003d516935?w=640&q=70", dealer: { name: "Kabeya Auto", verified: true } },
  { car_name: "Nissan Patrol Platinum 2022",  year: 2022, mileage: 46000, fuel: "Essence",  body: "SUV",     price: 61500, ai: "nego", photo_url: "https://images.unsplash.com/photo-1552519507-da3b142c6e3d?w=640&q=70", dealer: { name: "Al Manara Motors", verified: true } },
  { car_name: "Toyota Prado 2019",            year: 2019, mileage: 105000, fuel: "Diesel",  body: "SUV",     price: 29800, ai: "good", photo_url: "https://images.unsplash.com/photo-1580414057403-c5f451f30e1c?w=640&q=70", dealer: { name: "Mukoma Auto", verified: true } },
  { car_name: "Honda CR-V 2021",              year: 2021, mileage: 62000, fuel: "Essence",  body: "SUV",     price: 22400, ai: "good", photo_url: "https://images.unsplash.com/photo-1568844293986-8d0400bd4745?w=640&q=70", dealer: { name: "Kabeya Auto", verified: true } },
  { car_name: "Mitsubishi Pajero 2018",       year: 2018, mileage: 128000, fuel: "Diesel",  body: "SUV",     price: 18900, ai: "nego", photo_url: "https://images.unsplash.com/photo-1502877338535-766e1452684a?w=640&q=70", dealer: { name: "Mukoma Auto", verified: true } },
  { car_name: "Lexus RX 350 2020",            year: 2020, mileage: 71000, fuel: "Essence",  body: "SUV",     price: 42000, ai: "good", photo_url: "https://images.unsplash.com/photo-1606611013016-969c19ba27bb?w=640&q=70", dealer: { name: "Al Manara Motors", verified: true } },
  { car_name: "Hyundai Kona Électrique 2023", year: 2023, mileage: 12000, fuel: "Électrique", body: "SUV",   price: 26900, ai: "good", photo_url: "https://images.unsplash.com/photo-1554223090-7e482851df45?w=640&q=70", dealer: { name: "Kabeya Auto", verified: true } },
  { car_name: "Toyota Corolla 2022",          year: 2022, mileage: 38000, fuel: "Essence",  body: "Berline", price: 17800, ai: "good", photo_url: "https://images.unsplash.com/photo-1623869675781-80aa31012a5a?w=640&q=70", dealer: { name: "Kabeya Auto", verified: true } },
  { car_name: "Mercedes C200 2021",           year: 2021, mileage: 49000, fuel: "Essence",  body: "Berline", price: 33500, ai: "nego", photo_url: "https://images.unsplash.com/photo-1625690096555-a0a4d190901c?w=640&q=70", dealer: { name: "Al Manara Motors", verified: true } },
  { car_name: "Toyota Hiace 2021",            year: 2021, mileage: 88000, fuel: "Diesel",   body: "Minibus", price: 25400, ai: "good", photo_url: "https://images.unsplash.com/photo-1650807486050-a142ea418b19?w=640&q=70", dealer: { name: "Mukoma Auto", verified: true } }
];

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

function fmt(n) { return "$" + Math.round(n).toLocaleString("fr-FR").replace(/ /g, " "); }
function landedTotal(price, key) { const d = DEST[key]; if (!d || key === "dubai") return price; return price + d.ship + price * d.duty + d.fees; }
function escapeHtml(s) { return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
function brandOf(c) { const w = (c.car_name || "").split(" ")[0]; return BRANDS.find(b => b.toLowerCase() === w.toLowerCase()) || w; }

async function loadCars() {
  try {
    const { data, error } = await sb
      .from("listings")
      .select("*, dealers(name, verified, city)")
      .eq("active", true).eq("sold", false)
      .order("created_at", { ascending: false })
      .limit(200);
    if (!error && data && data.length > 0) {
      ALL = data.map(l => ({
        id: l.id,
        car_name: l.car_name,
        year: l.year,
        mileage: l.mileage,
        fuel: l.condition || l.fuel || "",
        price: l.price,
        ai: "good",
        photo_url: l.photo_url,
        dealer: { name: (l.dealers && l.dealers.name) || "Dealer Yayo", verified: !!(l.dealers && l.dealers.verified) }
      }));
      if (ALL.length < 6) ALL = ALL.concat(DEMO_CARS.slice(0, 12 - ALL.length));
    } else {
      ALL = DEMO_CARS;
    }
  } catch (e) {
    ALL = DEMO_CARS;
  }
  applyFilters();
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

function applyFilters() {
  writeParams();
  const q = document.getElementById("mkt-q").value.trim().toLowerCase();
  const min = parseInt(document.getElementById("f-min").value, 10);
  const max = parseInt(document.getElementById("f-max").value, 10);
  const year = parseInt(document.getElementById("f-year").value, 10);
  const brands = [...document.querySelectorAll("#f-brand button.on")].map(b => b.dataset.v);
  const fuels = [...document.querySelectorAll("#f-fuel button.on")].map(b => b.dataset.v);
  const bodies = [...document.querySelectorAll("#f-body button.on")].map(b => b.dataset.v);
  const sort = document.getElementById("mkt-sort").value;

  FILTERED = ALL.filter(c => {
    if (q && !(c.car_name || "").toLowerCase().includes(q)) return false;
    if (!isNaN(min) && c.price < min) return false;
    if (!isNaN(max) && c.price > max) return false;
    if (!isNaN(year) && (c.year || 0) < year) return false;
    if (brands.length && !brands.includes(brandOf(c))) return false;
    if (fuels.length && !fuels.includes(c.fuel)) return false;
    if (bodies.length && !bodies.includes(bodyOf(c))) return false;
    return true;
  });

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

  count.textContent = FILTERED.length === 0
    ? "Aucune voiture trouvée"
    : `${FILTERED.length} voiture${FILTERED.length > 1 ? "s" : ""} · ${CUR === "dubai" ? "à Dubai" : "rendu " + dst.name}`;

  if (FILTERED.length === 0) { g.innerHTML = ""; empty.hidden = false; return; }
  empty.hidden = true;

  g.innerHTML = FILTERED.map(c => `
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
  render();
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
function openCar(id) { alert("Page voiture détaillée — étape suivante de construction"); }
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

buildBrandFilter();
initSearch();
readParams();
loadCars();
