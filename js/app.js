// ═══════════════════════════════════════════════
// YAYO — Landing app
// Loads real listings from Supabase; falls back to
// demo cars while dealers upload their inventory.
// ═══════════════════════════════════════════════

const sb = yayoSB();
const DEST = YAYO_CONFIG.DESTINATIONS;
let CUR = YAYO_CONFIG.DEFAULT_DEST;
let CARS = [];      // featured grid (6 newest)
let ARRIVALS = [];  // horizontal "Arrivées récentes" strip (the next newest)
let ALL_CARS = [];  // full visible inventory — feeds the budget explorer

// Demo cars shown until real listings exist (shared list in js/demo.js)
const DEMO_ALL = window.YAYO_DEMO;

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
  let list = [];
  try {
    let { data, error } = await sb
      .from("listings")
      .select("*, dealers(*)")
      .eq("active", true)
      .eq("sold", false)
      .order("created_at", { ascending: false })
      .limit(200);

    if (!error && data && data.length > 0) {
      // buyers only ever see listings from ADMIN-VERIFIED dealers
      // (pending/suspended dealers prepare in their dashboard, invisible here)
      // dormant = asleep because the dealer's plan shrank (§32) — not for buyers
      data = data.filter(l => !l.hidden && !l.dormant && l.dealers && l.dealers.verified && !l.dealers.suspended);
      list = data.map(l => ({
        id: l.id,
        car_name: l.car_name,
        mileage: l.mileage,
        fuel: l.fuel || "",
        condition: l.condition || "",
        year: l.year,
        price: l.price,
        photo_url: l.photo_url,
        photos: yayoPhotoList(l.photos),
        created_at: l.created_at,
        dealer: { name: (l.dealers && l.dealers.name) || "Dealer Yayo", verified: !!(l.dealers && l.dealers.verified), logo_url: (l.dealers && l.dealers.logo_url) || null }
      }));
      // While real inventory is small, pad with demo cars so the featured
      // grid, the arrivals strip AND the budget explorer never look empty.
      if (list.length < 16) list = list.concat(DEMO_ALL.slice(0, 16 - list.length));
    } else {
      list = DEMO_ALL;
    }
  } catch (e) {
    list = DEMO_ALL;
  }
  ALL_CARS = list;
  CARS = list.slice(0, YAYO_CONFIG.FEATURED_LIMIT);
  ARRIVALS = list.slice(YAYO_CONFIG.FEATURED_LIMIT, YAYO_CONFIG.FEATURED_LIMIT + 10);
  renderCars();
  renderArrivals();
  renderBudget();
  yayoLoadVerdicts(CARS, renderCars); // real AI price verdicts, badge appears when ready
}

// ── Arrivées récentes: horizontal swipe strip of the next-newest cars ──
function renderArrivals() {
  const sec = document.getElementById("arrivees");
  const strip = document.getElementById("arr-strip");
  if (!sec || !strip) return;
  if (!ARRIVALS.length) { sec.hidden = true; return; }
  sec.hidden = false;
  const dst = DEST[CUR];
  const now = Date.now();
  strip.innerHTML = ARRIVALS.map(c => {
    const isNew = c.created_at && (now - new Date(c.created_at).getTime()) < 14 * 864e5;
    return `
    <div class="arr-card" onclick="openCar('${c.id || ""}')">
      <div class="arr-img">
        <img src="${c.photo_url || ""}" alt="${escapeHtml(c.car_name)}" loading="lazy" onerror="this.parentNode.classList.add('noimg');this.remove()">
        ${isNew ? `<span class="arr-new">${t("arr_new")}</span>` : ""}
      </div>
      <div class="arr-body">
        <div class="arr-title">${escapeHtml(c.car_name)}</div>
        <div class="car-chips">${c.year ? `<span>${c.year}</span>` : ""}${c.mileage ? `<span>${Number(c.mileage).toLocaleString("fr-FR")} km</span>` : ""}</div>
        <div class="arr-price">${fmt(c.price)} <span>${t("a_dubai")}</span></div>
        ${CUR === "dubai" ? "" : `<div class="arr-landed">≈ ${fmt(landedTotal(c.price, CUR))} ${escapeHtml(dst.name)}</div>`}
      </div>
    </div>`;
  }).join("");
}

// ── Budget explorer: tiers computed from the REAL visible inventory ──
// Thresholds adapt to what's actually for sale (never an empty result page),
// amounts are LANDED cost for the selected city (core Yayo promise).
function renderBudget() {
  const g = document.getElementById("bud-grid");
  if (!g) return;
  const cars = ALL_CARS.length ? ALL_CARS : DEMO_ALL;
  const landed = cars.map(c => landedTotal(c.price, CUR)).sort((a, b) => a - b);
  if (!landed.length) { g.innerHTML = ""; return; }
  const pick = p => landed[Math.min(landed.length - 1, Math.floor(landed.length * p))];
  // round UP to a clean $1000 so every shown amount really includes its cars
  const rnd = v => Math.ceil(v / 1000) * 1000;
  const t1 = rnd(pick(0.30)), t2 = rnd(pick(0.55)), t3 = rnd(pick(0.80));
  const cnt = max => landed.filter(v => v <= max).length;
  const dst = DEST[CUR];
  const sub = CUR === "dubai" ? t("bud_dubai_sub") : `${t("bud_sub")} ${dst.name}`;
  const link = max => CUR === "dubai"
    ? `acheter.html?max=${max}`
    : `acheter.html?q=${encodeURIComponent("$" + max + " " + CUR)}`;
  const tiers = [
    { lbl: t("bud_t1"), max: t1 },
    { lbl: t("bud_t2"), max: t2 },
    { lbl: t("bud_t3"), max: t3 }
  ];
  const seen = new Set();
  const rows = tiers.filter(x => { if (seen.has(x.max)) return false; seen.add(x.max); return true; })
    .map(x => {
      const n = cnt(x.max);
      return `
    <a class="bud-card" href="${link(x.max)}">
      <span class="bud-tier">${x.lbl}</span>
      <span class="bud-amount">${t("bud_under")} ${fmt(x.max)}</span>
      <span class="bud-sub">${n} ${n > 1 ? t("bud_cars") : t("bud_car")} · ${sub}</span>
      <svg class="bud-arrow" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
    </a>`;
    });
  rows.push(`
    <a class="bud-card bud-prem" href="acheter.html?sort=price-desc">
      <span class="bud-tier">${t("bud_t4")}</span>
      <span class="bud-amount">${fmt(t3)} +</span>
      <span class="bud-sub">${t("bud_prem_sub")}</span>
      <svg class="bud-arrow" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
    </a>`);
  g.innerHTML = rows.join("");
}

// ── Hero photos (real Al Aweer market shots) — activates the moment
// YAYO_CONFIG.HERO_PHOTOS lists filenames; invisible until then. ──
function renderHeroShots() {
  const files = (YAYO_CONFIG.HERO_PHOTOS || []);
  if (!files.length) return;
  const hero = document.querySelector(".hero .hero-in");
  if (!hero || document.querySelector(".hero-shots")) return;
  const div = document.createElement("div");
  div.className = "hero-shots";
  div.innerHTML = files.slice(0, 3).map((f, i) =>
    `<img src="${f}" alt="Marché automobile Al Aweer, Dubai" class="hs-${i}" loading="${i ? "lazy" : "eager"}" onerror="this.remove()">`
  ).join("");
  hero.appendChild(div);
  document.querySelector(".hero").classList.add("hero-has-photos");
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
  renderArrivals();
  renderBudget();
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
window.onLangChange = () => { renderCars(); renderArrivals(); renderBudget(); updateCostCard(); };

// ── Init ──
loadCars();
updateCostCard();
renderHeroShots();
