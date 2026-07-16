// ═══════════════════════════════════════════════
// YAYO — Car detail (voiture.html)
// Loads one listing (Supabase or demo), landed cost
// per city, dealer card, in-app chat.
// ═══════════════════════════════════════════════

const DEST = YAYO_CONFIG.DESTINATIONS;
let CUR = YAYO_CONFIG.DEFAULT_DEST;
let CAR = null;
let CONVO = null;
let AGENCIES = [];   // verified agencies with parsed routes
let CHOSEN = null;   // agency picked by the buyer for shipping
const CAR_ID = new URLSearchParams(location.search).get("id") || "";

// Demo agencies (shared in js/demo.js) — only shown on demo listings
const DEMO_AGENCIES = window.YAYO_DEMO_AGENCIES;
let AG_RV = {}; // agency id → {avg, count} from real reviews

function fmt(n) { return "$" + Math.round(n).toLocaleString("fr-FR").replace(/ /g, " "); }
function escapeHtml(s) { return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
function toggleMenu() { document.getElementById("mmenu").classList.toggle("open"); }

async function loadCar() {
  if (CAR_ID.startsWith("demo-") || CAR_ID === "") {
    CAR = window.YAYO_DEMO.find(c => c.id === CAR_ID) || null;
    if (!CAR && CAR_ID === "") CAR = window.YAYO_DEMO[0];
  } else {
    try {
      let { data, error } = await yayoSB()
        .from("listings")
        .select("*, dealers(*)")
        .eq("id", CAR_ID).maybeSingle();
      if (data && data.hidden) data = null; // hidden by admin — not shown to buyers
      // pending/suspended dealer = listing not public yet (admin approval first)
      if (data && !(data.dealers && data.dealers.verified && !data.dealers.suspended)) data = null;
      if (!error && data) {
        // view counter (best effort) + traffic funnel event
        try { yayoSB().rpc("yayo_view", { lid: CAR_ID }).then(() => {}, () => {}); } catch (e2) {}
        if (typeof yayoTrack === "function") yayoTrack("car_view", { car: data.car_name });
        CAR = {
          id: data.id,
          dealer_id: data.dealer_id,
          car_name: data.car_name,
          year: data.year,
          mileage: data.mileage,
          fuel: data.fuel || "",
          condition: data.condition || "",
          color: data.color || "",
          body: data.body || "",
          price: Number(data.price) || 0,
          photo_url: data.photo_url,
          photos: yayoPhotoList(data.photos),
          description: data.description || "",
          dealer: {
            name: (data.dealers && data.dealers.name) || "Dealer Yayo",
            verified: !!(data.dealers && data.dealers.verified),
            logo_url: (data.dealers && data.dealers.logo_url) || null,
            photos: yayoPhotoList(data.dealers && data.dealers.photos)
          }
        };
      }
    } catch (e) { CAR = null; }
  }
  render();
}

function render() {
  document.getElementById("vd-loading").hidden = true;
  if (!CAR) { document.getElementById("vd-notfound").hidden = false; return; }
  document.getElementById("vd-content").hidden = false;
  document.title = CAR.car_name + " — Yayo";

  document.getElementById("crumb-name").textContent = CAR.car_name;
  document.getElementById("vd-title").textContent = CAR.car_name;
  document.getElementById("vd-meta").textContent =
    [CAR.mileage ? CAR.mileage.toLocaleString("fr-FR") + " km" : "", CAR.fuel].filter(Boolean).join(" · ");
  document.getElementById("vd-price").textContent = fmt(CAR.price);

  renderGallery();

  updateAiBadge();

  const specs = [
    [t("sp_year"), CAR.year], [t("sp_km"), CAR.mileage ? CAR.mileage.toLocaleString("fr-FR") + " km" : ""],
    [t("sp_fuel"), tFuel(CAR.fuel)], [t("sp_body"), CAR.body],
    [t("sp_color"), CAR.color], [t("sp_cond"), CAR.condition]
  ].filter(s => s[1]);
  document.getElementById("vd-specs").innerHTML =
    specs.map(s => `<div class="vd-spec"><span>${s[0]}</span><b>${escapeHtml(String(s[1]))}</b></div>`).join("");

  document.getElementById("vd-desc").textContent = CAR.description || t("desc_fallback");

  const d = CAR.dealer;
  const av = document.getElementById("vd-dealer-av");
  if (d.logo_url) av.innerHTML = `<img src="${escapeHtml(d.logo_url)}" alt="" onerror="this.remove()">`;
  else av.textContent = d.name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
  document.getElementById("vd-dealer-name").textContent = d.name;
  // Showroom photos build trust — shown only if the dealer uploaded some
  const gal = document.getElementById("vd-dealer-gal");
  const pics = (d.photos || []).slice(0, 3);
  gal.hidden = !pics.length;
  gal.innerHTML = pics.map(u => `<img src="${escapeHtml(u)}" alt="" loading="lazy" onerror="this.remove()">`).join("");
  // The trust pill next to the dealer name — big, blue, unmissable
  document.getElementById("vd-dealer-badge").innerHTML = d.verified
    ? yayoVPill(t("d_verified")) + " · Dubai"
    : "Dubai";
  // Full-width "Vérifié par Yayo" band on the seller card…
  document.getElementById("vd-trust").innerHTML = d.verified ? yayoVBand(t("vband_d")) : "";
  // …and again above the chat, so the buyer sees WHO they are talking to
  const trust = document.getElementById("chat-trust");
  if (trust) trust.innerHTML = d.verified
    ? yayoVBand(escapeHtml(d.name) + " — " + t("vband_chat"))
    : "";
  renderDealerReviews();

  renderCities();
  renderBreakdown();
  renderTransport();
  loadSimilar();

  // Sticky mobile bar: price + contact always within thumb's reach
  const sticky = document.getElementById("vd-sticky");
  if (sticky) {
    document.getElementById("vd-sticky-price").textContent = fmt(CAR.price);
    sticky.hidden = false;
  }
}

// ── Photo gallery: all photos browsable big (arrows + swipe + thumbnails) ──
let GAL = [];
let GAL_I = 0;
function renderGallery() {
  GAL = (CAR.photos && CAR.photos.length) ? CAR.photos : (CAR.photo_url ? [CAR.photo_url] : []);
  GAL_I = 0;
  const img = document.getElementById("vd-img");
  img.alt = CAR.car_name;
  img.onerror = function () { this.parentNode.classList.add("noimg"); this.style.display = "none"; };
  galShow(0);

  const multi = GAL.length > 1;
  document.getElementById("vd-prev").hidden = !multi;
  document.getElementById("vd-next").hidden = !multi;
  document.getElementById("vd-count").hidden = !multi;
  const th = document.getElementById("vd-thumbs");
  th.hidden = !multi;
  if (multi) {
    th.innerHTML = GAL.map((u, i) =>
      `<button type="button" class="${i === 0 ? "on" : ""}" data-i="${i}"><img src="${escapeHtml(u)}" alt="" loading="lazy" onerror="this.parentNode.remove()"></button>`).join("");
    th.querySelectorAll("button").forEach(b => b.addEventListener("click", () => galShow(+b.dataset.i)));
    document.getElementById("vd-prev").onclick = () => galShow(GAL_I - 1);
    document.getElementById("vd-next").onclick = () => galShow(GAL_I + 1);
    // swipe on mobile
    let x0 = null;
    const zone = document.getElementById("vd-photo");
    zone.ontouchstart = e => { x0 = e.touches[0].clientX; };
    zone.ontouchend = e => {
      if (x0 === null) return;
      const dx = e.changedTouches[0].clientX - x0;
      if (Math.abs(dx) > 40) galShow(GAL_I + (dx < 0 ? 1 : -1));
      x0 = null;
    };
  }
}
function galShow(i) {
  if (!GAL.length) return;
  GAL_I = (i + GAL.length) % GAL.length;
  const img = document.getElementById("vd-img");
  img.style.display = "";
  img.src = GAL[GAL_I];
  document.getElementById("vd-count").textContent = (GAL_I + 1) + " / " + GAL.length;
  document.querySelectorAll("#vd-thumbs button").forEach((b, j) => b.classList.toggle("on", j === GAL_I));
}

// Demo cars keep their preset demo badge; a real car only shows a badge
// once a REAL verdict arrives from the AI (no fake verdicts — honesty rule).
function updateAiBadge() {
  const ai = document.getElementById("vd-ai");
  if (String(CAR.id).startsWith("demo")) {
    ai.hidden = false;
    ai.className = "ai-badge " + (CAR.ai === "good" ? "ai-good" : "ai-nego");
    ai.textContent = CAR.ai === "good" ? t("badge_good") : t("badge_nego");
    return;
  }
  const v = window.__YAYO_VD && window.__YAYO_VD[CAR.id];
  ai.hidden = !v;
  if (!v) return;
  ai.className = "ai-badge " + (v.v === "good" ? "ai-good" : v.v === "fair" ? "ai-fair" : "ai-nego");
  ai.textContent = v.v === "good" ? t("badge_good") : v.v === "fair" ? t("badge_fair") : t("badge_nego");
  ai.title = v.why || "";
}

function renderCities() {
  const el = document.getElementById("vd-cities");
  el.innerHTML = Object.keys(DEST).map(k =>
    `<button type="button" class="${k === CUR ? "on" : ""}" data-k="${k}">${DEST[k].flag} ${DEST[k].name}</button>`).join("");
  el.querySelectorAll("button").forEach(b => b.addEventListener("click", () => {
    CUR = b.dataset.k;
    el.querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b));
    if (CHOSEN && !routeFor(CHOSEN, CUR)) CHOSEN = null;
    renderBreakdown();
    renderTransport();
  }));
}

function renderBreakdown() {
  const box = document.getElementById("vd-breakdown");
  const d = DEST[CUR];
  if (CUR === "dubai") {
    box.innerHTML = `<div class="cost-total"><span>${t("bd_onsite")}</span><span class="val">${fmt(CAR.price)}</span></div>`;
    updateTeasers(0, "");
    return;
  }
  const route = CHOSEN && routeFor(CHOSEN, CUR);
  const ship = Number(route ? route.price : d.ship) || 0;
  const shipLbl = route
    ? `${t("ct_price_lbl")}<span class="ct-src">${escapeHtml(CHOSEN.name)}</span>`
    : t("bd_ship2");
  // Published customs formula on CIF (car + freight) — every line "estimation"
  const cx = yayoCustoms(CAR.price, ship, CUR);
  const total = CAR.price + ship + cx.total + d.fees;
  const pct = r => (r * 100).toLocaleString("fr-FR", { maximumFractionDigits: 2 }) + " %";
  const icoCar = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px"><path d="M5 11l1.6-4.2A2 2 0 018.5 5.5h7a2 2 0 011.9 1.3L19 11M4 11h16a1 1 0 011 1v4a1 1 0 01-1 1h-1M4 11a1 1 0 00-1 1v4a1 1 0 001 1h1M9.3 17h5.4"/><circle cx="7.5" cy="17" r="1.8"/><circle cx="16.5" cy="17" r="1.8"/></svg>';
  const icoShip = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px"><path d="M3 14l1.5 4.5A2 2 0 006.4 20h11.2a2 2 0 001.9-1.5L21 14M3 14h18M12 3v3M7 9h10l1 5H6z"/></svg>';
  // Two clearly separated blocks so no buyer ever thinks the TOTAL goes to the
  // dealer: (1) car price = the only money for the seller, (2) fees paid
  // separately to the agency / government / port.
  box.innerHTML = `
    <div class="pay-block pay-dealer">
      <div class="pay-head">${icoCar} ${t("bd_pay_dealer")}</div>
      <div class="cost-line"><span>${t("bd_pay_dealer_line")}</span><b>${fmt(CAR.price)}</b></div>
      <div class="pay-sub">${t("bd_pay_dealer_note")}</div>
    </div>
    <div class="pay-block">
      <div class="pay-head">${icoShip} ${t("bd_fees_h")}</div>
      <div class="cost-line"><span>${shipLbl}</span><b>${fmt(ship)}</b></div>
      <div class="cost-line"><span>${t("bd_duty3")} (${pct(cx.c.duty)})</span><b>${fmt(cx.duty)}</b></div>
      ${cx.extra ? `<div class="cost-line"><span>${t("bd_levies")} (${pct(cx.c.extra)})</span><b>${fmt(cx.extra)}</b></div>` : ""}
      <div class="cost-line"><span>${t("bd_vat")} (${pct(cx.c.vat)})</span><b>${fmt(cx.vat)}</b></div>
      <div class="cost-line"><span>${t("bd_fees2")}</span><b>${fmt(d.fees)}</b></div>
      <div class="pay-sub">${t("bd_customs_note")}</div>
    </div>
    <div class="cost-total"><span>${t("bd_total2")} — ${d.name}</span><span class="val">≈ ${fmt(total)}</span></div>
    <p class="pay-explain">${t("bd_explain")}</p>`;
  updateTeasers(total, d.name);
}

// The Dubai price is what goes to the dealer; the landed total lives in its
// own card lower down. These two tappable teasers (under the price + in the
// sticky bar) carry the buyer straight to the breakdown so the numbers are
// never confused — and the breakdown is where the agencies are chosen.
function updateTeasers(total, cityName) {
  const tz = document.getElementById("vd-teaser");
  const st = document.getElementById("vd-sticky-landed");
  if (CUR === "dubai" || !total) {
    if (tz) tz.hidden = true;
    if (st) st.hidden = true;
    return;
  }
  const html = `${t("rendu2")} ${cityName} <b>≈ ${fmt(total)}</b> · <u>${t("bd_see")}</u>`;
  if (tz) { tz.hidden = false; tz.innerHTML = html; }
  if (st) { st.hidden = false; st.innerHTML = `≈ ${fmt(total)} ${escapeHtml(cityName)}`; }
}

function goBreakdown() {
  const el = document.getElementById("vd-breakdown");
  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
}

// ── Choisir le transport (phase 8) ──
function routeFor(agency, city) {
  return (agency.routes || []).find(r => r.city === city && r.price > 0);
}

async function loadAgencies() {
  if (String(CAR_ID).startsWith("demo") || CAR_ID === "") { AGENCIES = DEMO_AGENCIES; renderTransport(); return; }
  try {
    const { data } = await yayoSB().from("shipping_agencies")
      .select("*")
      .eq("verified", true).limit(30);
    AGENCIES = (data || []).filter(a => !a.suspended).map(a => {
      let d = a.routes;
      if (typeof d === "string") { try { d = JSON.parse(d); } catch (e) { d = null; } }
      const routes = Array.isArray(d) ? d : (d && Array.isArray(d.routes) ? d.routes : []);
      const meta = (d && !Array.isArray(d) && typeof d === "object") ? d : {};
      return { id: a.id, name: a.name, verified: a.verified, routes, meta };
    }).filter(a => a.routes.length);
    // real average ratings for these agencies, one query
    if (AGENCIES.length) {
      const { data: rv } = await yayoSB().from("reviews")
        .select("subject_id, rating").eq("subject_type", "agency")
        .in("subject_id", AGENCIES.map(a => a.id));
      AG_RV = {};
      (rv || []).forEach(r => {
        const s = AG_RV[r.subject_id] || { sum: 0, count: 0 };
        s.sum += r.rating; s.count++;
        AG_RV[r.subject_id] = s;
      });
      Object.keys(AG_RV).forEach(k => { AG_RV[k] = { avg: AG_RV[k].sum / AG_RV[k].count, count: AG_RV[k].count }; });
    }
  } catch (e) { AGENCIES = []; }
  renderTransport();
}

function toggleTransport() {
  const p = document.getElementById("ct-panel");
  p.hidden = !p.hidden;
}

function renderTransport() {
  const zone = document.getElementById("ct-zone");
  if (!CAR || CUR === "dubai") { zone.hidden = true; return; }
  zone.hidden = false;
  const list = document.getElementById("ct-list");
  const avail = AGENCIES.filter(a => routeFor(a, CUR));
  if (!avail.length) {
    list.innerHTML = `<p class="ct-none">${t("ct_none")}</p>`;
    return;
  }
  list.innerHTML = avail.map(a => {
    const r = routeFor(a, CUR);
    const on = CHOSEN && CHOSEN.id === a.id;
    const rv = AG_RV[a.id];
    const office = a.meta && a.meta.offices && a.meta.offices[CUR];
    return `
    <div class="ct-agency${on ? " on" : ""}">
      <div class="ct-agency-top">
        <div class="ct-agency-info">
          <b>${escapeHtml(a.name)}</b>
          ${yayoVPill(t("ag_verified"), true)}
        </div>
        ${rv ? `<span class="rv-mini">${starsHtml(rv.avg)} <b>${rv.avg.toFixed(1)}</b> (${rv.count})</span>` : `<span class="rv-mini rv-mini-none">${t("rv_none_short")}</span>`}
      </div>
      ${r.promise ? `<p class="ct-promise">« ${escapeHtml(r.promise)} »</p>` : ""}
      <p class="ct-meta"><b>${fmt(r.price)}</b>${r.days ? " · " + r.days + " " + t("ct_days") : ""}${office ? " · 📍 " + escapeHtml(office) : ""}</p>
      <div class="ct-actions">
        <a class="btn btn-ghost-dark" href="agence.html?id=${encodeURIComponent(a.id)}&car=${encodeURIComponent(CAR_ID)}&city=${CUR}">${t("ct_profile")}</a>
        <button type="button" class="btn ${on ? "btn-solid" : "btn-ghost-dark"}" onclick="chooseAgency('${a.id}')">${on ? t("ct_chosen") : t("ct_choose")}</button>
      </div>
    </div>`;
  }).join("") + (CHOSEN ? `<button type="button" class="ct-clear" onclick="clearAgency()">${t("ct_est")}</button>` : "");
}

function chooseAgency(id) {
  CHOSEN = AGENCIES.find(a => String(a.id) === String(id)) || null;
  renderBreakdown();
  renderTransport();
}
function clearAgency() { CHOSEN = null; renderBreakdown(); renderTransport(); }

// ── Dealer rating + reviews (real reviews only) ──
async function renderDealerReviews() {
  const mini = document.getElementById("vd-dealer-rv");
  if (mini) {
    if (CAR.dealer_id) {
      const rv = await yayoReviews("dealer", CAR.dealer_id);
      mini.innerHTML = reviewSummaryHtml(rv);
    } else {
      mini.innerHTML = `<span class="rv-mini rv-mini-none">${t("rv_none_short")}</span>`;
    }
  }
  renderReviewsWidget("vd-reviews", "dealer", CAR.dealer_id || CAR.id);
}

// "Voitures similaires" — real listings first (same make preferred, verified
// dealers only); the demo pool is only the pre-launch fallback.
async function loadSimilar() {
  let pool = [];
  if (!String(CAR.id).startsWith("demo")) {
    try {
      const { data } = await yayoSB().from("listings")
        .select("id, car_name, price, mileage, fuel, year, photo_url, photos, make, dealers!inner(verified, suspended)")
        .eq("active", true).eq("hidden", false)
        .eq("dealers.verified", true).eq("dealers.suspended", false)
        .neq("id", CAR.id).limit(9);
      const firstWord = (CAR.car_name || "").split(" ")[0].toLowerCase();
      pool = (data || [])
        .map(l => ({
          id: l.id, car_name: l.car_name, price: Number(l.price) || 0,
          mileage: l.mileage, fuel: l.fuel || "", year: l.year,
          photo_url: l.photo_url, photos: yayoPhotoList(l.photos), verified: true
        }))
        .sort((a, b) => {
          const am = a.car_name.toLowerCase().startsWith(firstWord) ? 0 : 1;
          const bm = b.car_name.toLowerCase().startsWith(firstWord) ? 0 : 1;
          return am - bm;
        })
        .slice(0, 3);
    } catch (e) { pool = []; }
  }
  if (!pool.length) {
    pool = window.YAYO_DEMO.filter(c => c.id !== CAR.id && (c.body === CAR.body || c.car_name.split(" ")[0] === CAR.car_name.split(" ")[0])).slice(0, 3);
  }
  if (!pool.length) return;
  document.getElementById("vd-similar-sec").hidden = false;
  document.getElementById("vd-similar").innerHTML = pool.map(c => `
  <div class="car-card" onclick="location.href='voiture.html?id=${c.id}'">
    <div class="car-img">
      <img src="${escapeHtml(c.photo_url || "")}" alt="${escapeHtml(c.car_name)}" loading="lazy" onerror="this.parentNode.classList.add('noimg');this.remove()">
      ${c.verified ? `<span class="card-vseal">${yayoVBadge()}</span>` : ""}
      ${c.photos && c.photos.length > 1 ? `<span class="card-pcount"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg> ${c.photos.length}</span>` : ""}
      ${c.ai ? `<span class="ai-badge ${c.ai === "good" ? "ai-good" : "ai-nego"}">${c.ai === "good" ? t("badge_good") : t("badge_nego")}</span>` : ""}
    </div>
    <div class="car-body">
      <div class="car-title">${escapeHtml(c.car_name)}</div>
      <div class="car-chips">${c.year ? `<span>${c.year}</span>` : ""}${c.mileage ? `<span>${Number(c.mileage).toLocaleString("fr-FR")} km</span>` : ""}${c.fuel ? `<span>${escapeHtml(tFuel(c.fuel))}</span>` : ""}</div>
      <div class="car-price-row"><span class="car-price">${fmt(c.price)}</span><span class="car-price-lbl">${t("a_dubai")}</span></div>
    </div>
  </div>`).join("");
}

// WhatsApp share — the viral channel in this market. Prefilled message with
// the car, its Dubai price and the landed price for the selected city.
function shareCar() {
  if (!CAR) return;
  const key = CUR === "dubai" ? YAYO_CONFIG.DEFAULT_DEST : CUR;
  const text = t("share_txt")
    .replace("{car}", CAR.car_name)
    .replace("{price}", fmt(CAR.price))
    .replace("{city}", DEST[key].name)
    .replace("{landed}", fmt(yayoLandedTotal(CAR.price, key)));
  const url = "https://yayo.digital/voiture.html?id=" + encodeURIComponent(CAR.id);
  const full = text + " " + url;
  if (navigator.share) { navigator.share({ text: full }).catch(() => {}); return; }
  window.open("https://wa.me/?text=" + encodeURIComponent(full), "_blank", "noopener");
}

// ── In-app chat (phase 5) ──
async function openChat() {
  const user = await yayoUser();
  if (!user) {
    location.href = "connexion.html?next=" + encodeURIComponent("voiture.html?id=" + CAR_ID);
    return;
  }
  const panel = document.getElementById("vd-chat");
  panel.hidden = false;
  document.getElementById("vd-contact").style.display = "none";
  const sticky = document.getElementById("vd-sticky");
  if (sticky) sticky.hidden = true; // chat open = the bar has done its job
  panel.scrollIntoView({ behavior: "smooth", block: "center" });
  if (typeof yayoTrack === "function") yayoTrack("contact_dealer", { car: CAR && CAR.car_name });

  if (String(CAR.id).startsWith("demo")) {
    // Demo cars: the conversation lives on this device (localStorage) so the
    // inbox behaves like the real thing — the buyer sees who they contacted
    // and can send follow-ups, exactly like on a real listing.
    const dc = yayoDemoConvo(CAR.id);
    if (dc && dc.msgs.length) dc.msgs.forEach(m => addBubble(m.me ? "me" : "them", m.text));
    addBubble("yayo", t("chat_demo"));
    return;
  }
  try {
    const sb = yayoSB();
    await yayoEnsureUserRow(user);
    let { data: convo } = await sb.from("conversations")
      .select("id").eq("dealer_id", CAR.dealer_id).eq("user_id", user.id)
      .eq("car_name", CAR.car_name).maybeSingle();
    if (!convo) {
      const ins = await sb.from("conversations")
        .insert({ dealer_id: CAR.dealer_id, user_id: user.id, car_name: CAR.car_name, status: "open" })
        .select("id").single();
      convo = ins.data;
    }
    CONVO = convo;
    if (!CONVO) throw new Error("no convo");
    const list = await yayoLoadMessages(CONVO.id, 100);
    // Two-way translation: the dealer's replies arrive in the buyer's language.
    // From the buyer's side it is simply the dealer replying. (Photos pass as-is.)
    const theirs = list.filter(m => m.sender_id !== user.id && !m.image_url);
    if (theirs.length) {
      const tr = await yayoTranslate(theirs.map(m => m.content), YAYO_LANG);
      theirs.forEach((m, i) => { m.display = tr[i]; });
    }
    list.forEach(m => addBubble(m.sender_id === user.id ? "me" : "them", m.display || m.content, m.image_url));
    if (!list.length) addBubble("yayo", t("chat_start"));
    // Live: the dealer's replies appear instantly, translated, no refresh
    if (window.__vdLiveOff) window.__vdLiveOff();
    window.__vdLiveOff = yayoLiveMessages(CONVO.id, user.id, async m => {
      if (m.image_url) { addBubble("them", "", m.image_url); return; }
      const tr = await yayoTranslate([m.content], YAYO_LANG);
      addBubble("them", tr[0] || m.content);
    });
  } catch (e) {
    console.error("[Yayo] openChat failed:", e);
    addBubble("yayo", t("chat_soon") + " (" + yayoErrMsg(e) + ")");
  }
}

function addBubble(who, text, img) {
  const box = document.getElementById("chat-box");
  const b = document.createElement("div");
  b.className = "chat-b chat-" + who;
  yayoFillBubble(b, text, img);
  box.appendChild(b);
  box.scrollTop = box.scrollHeight;
  return b;
}

// 📷 send a photo in the chat (e.g. buyer asks for more pictures)
async function sendChatPhoto(files) {
  const f = files && files[0];
  document.getElementById("chat-photo").value = "";
  if (!f) return;
  if (String(CAR.id).startsWith("demo") || !CONVO) {
    setTimeout(() => addBubble("yayo", t("chat_demo_reply")), 600);
    return;
  }
  const b = addBubble("me", t("chat_photo_sending"));
  try {
    const url = await yayoSendChatPhoto(CONVO.id, f);
    yayoFillBubble(b, "", url);
  } catch (e) {
    yayoFillBubble(b, t("chat_photo_fail"));
  }
}

async function sendMsg(e) {
  e.preventDefault();
  const input = document.getElementById("chat-input");
  const text = input.value.trim();
  if (!text) return false;
  input.value = "";
  const bubble = addBubble("me", text);
  if (String(CAR.id).startsWith("demo")) {
    yayoDemoConvoPush(CAR, { me: true, text });
    setTimeout(() => {
      addBubble("yayo", t("chat_demo_reply"));
      yayoDemoConvoPush(CAR, { me: false, text: t("chat_demo_reply") });
    }, 600);
    return false;
  }
  // Real car: NEVER pretend a failed message was sent — say it clearly.
  try {
    if (!CONVO) throw new Error("no conversation");
    const user = await yayoUser();
    const { error } = await yayoSB().from("messages").insert({ conversation_id: CONVO.id, sender_id: user.id, content: text });
    if (error) throw error;
    yayoNotifyMessage(CONVO.id);
  } catch (err) {
    bubble.classList.add("chat-failed");
    addBubble("yayo", t("chat_send_fail") + " (" + yayoErrMsg(err) + ")");
    console.error("[Yayo] message send failed:", err);
  }
  return false;
}

// Re-render the page when the language changes (skip until the car is loaded)
window.onLangChange = () => { if (CAR) render(); };

loadCar().then(async () => {
  loadAgencies();
  if (CAR) yayoLoadVerdicts([CAR], updateAiBadge);
  // &chat=1 (e.g. "Contacter" from Mes favoris): open the chat directly,
  // but only for signed-in users — never bounce a visitor to login unasked.
  if (CAR && new URLSearchParams(location.search).get("chat") === "1") {
    const u = await yayoUser();
    if (u) openChat();
  }
});
