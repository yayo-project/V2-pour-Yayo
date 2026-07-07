// ═══════════════════════════════════════════════
// YAYO — Dashboard (dashboard.html)
// Dealer: stats, inventory CRUD (photo upload to
// Supabase Storage), messages with two-way
// translation + Assistant Yayo suggested replies
// (Mode 2: dealer reviews before sending).
// Agency Phase 1: profile, offices, routes with
// price + transit promise per served city.
// ?demo=1 dealer demo · ?demo=agency agency demo
// ═══════════════════════════════════════════════

const DEMO_PARAM = new URLSearchParams(location.search).get("demo");
const DEMO = DEMO_PARAM === "1";          // dealer demo
const DEMO_AG = DEMO_PARAM === "agency";  // agency demo
let USER = null;      // Supabase auth user (null in demo)
let DEALER = null;    // dealers row (or demo object)
let AGENCY = null;    // shipping_agencies row (or demo object)
let AG_META = {};     // agency profile v2 (description, offices…)
let ROUTES = [];      // agency routes [{city, price, days, promise}]
let LISTINGS = [];
let CONVOS = [];
let CUR_CONVO = null;
let PHOTOS = [];      // listing form photos: {url} saved | {file, preview} new

function fmt(n) { return "$" + Math.round(n).toLocaleString("fr-FR").replace(/ /g, " "); }
function escapeHtml(s) { return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
function toggleMenu() { document.getElementById("mmenu").classList.toggle("open"); }
function show(id) { document.getElementById(id).hidden = false; }
function hide(id) { document.getElementById(id).hidden = true; }

// ── Demo data ──
const DEMO_DEALER = { id: "demo-dealer", name: "Mukoma Auto", verified: true };
function demoConvos() {
  return [
    { id: "dc-1", car_name: "Toyota Land Cruiser GXR 2021", buyer: "Acheteur · Kinshasa", msgs: [
      { me: false, text: "Bonjour, la Land Cruiser est toujours disponible ? Je suis à Kinshasa." },
      { me: false, text: "Et le prix est négociable si je paie rapidement ?" }
    ]},
    { id: "dc-2", car_name: "Toyota Hilux 4x4 2020", buyer: "Acheteur · Douala", msgs: [
      { me: false, text: "Le Hilux peut arriver à Douala avant fin du mois ?" },
      { me: true,  text: "Bonjour ! Oui, avec une agence certifiée Yayo le délai est de 3 à 4 semaines." }
    ]}
  ];
}
const DEMO_AGENCY = {
  id: "demo-agency", name: "TransAfrica Cargo", verified: true, country: "Dubai UAE"
};
const DEMO_AG_META = {
  description: "Spécialiste du transport de véhicules Dubai → Afrique centrale et de l'Ouest depuis 2017. RoRo et conteneur, dédouanement assisté.",
  years: 8, languages: "Français, English, العربية",
  pickup: "Warehouse 12, Ras Al Khor Industrial 2, Dubai",
  offices: {
    kinshasa: "12 Av. du Commerce, Gombe, Kinshasa",
    douala: "Rue Joffre, Akwa, Douala",
    dakar: "Km 4, Route de Rufisque, Dakar"
  }
};
const DEMO_AG_ROUTES = [
  { city: "kinshasa", price: 3150, days: 32, promise: "Je livre votre voiture à Kinshasa en 32 jours" },
  { city: "douala", price: 2750, days: 27, promise: "Douala en 27 jours, port-à-port" },
  { city: "dakar", price: 3250, days: 30, promise: "Dakar en 30 jours, assurance incluse" }
];

// ── Init: who is this? ──
async function init() {
  if (DEMO) {
    DEALER = DEMO_DEALER;
    LISTINGS = window.YAYO_DEMO.slice(0, 6).map(c => ({ ...c, active: true, sold: false }));
    LISTINGS[4].sold = true; LISTINGS[5].active = false;
    CONVOS = demoConvos();
    show("dash-demo");
    document.getElementById("dash-logout").style.display = "none"; // .btn display overrides [hidden]
    enterDealer();
    return;
  }
  if (DEMO_AG) {
    AGENCY = { ...DEMO_AGENCY };
    AG_META = JSON.parse(JSON.stringify(DEMO_AG_META));
    ROUTES = JSON.parse(JSON.stringify(DEMO_AG_ROUTES));
    show("dash-demo");
    document.getElementById("ag-logout").style.display = "none";
    enterAgency();
    return;
  }

  USER = await yayoUser();
  if (!USER) { location.href = "connexion.html?next=" + encodeURIComponent("dashboard.html"); return; }
  const role = (USER.user_metadata && USER.user_metadata.role) || "";

  hide("dash-loading");
  if (role === "admin") { show("dash-admin"); return; }
  if (role === "agency") { await agencyInit(); return; }

  // Dealer row is linked by email (fallback: company name from signup)
  try {
    const sb = yayoSB();
    let { data } = await sb.from("dealers").select("*").eq("email", USER.email).maybeSingle();
    if (!data && USER.user_metadata && USER.user_metadata.company) {
      const r = await sb.from("dealers").select("*").ilike("name", USER.user_metadata.company).limit(1);
      data = r.data && r.data[0];
    }
    if (!data && role === "dealer") {
      // Registered dealer without a profile row yet — create it (admin activates later)
      const ins = await sb.from("dealers").insert({
        name: (USER.user_metadata && USER.user_metadata.company) || USER.email.split("@")[0],
        email: USER.email,
        whatsapp: (USER.user_metadata && USER.user_metadata.phone) || null,
        city: "Dubai", verified: false
      }).select("*").single();
      data = ins.data;
    }
    DEALER = data || null;
  } catch (e) { DEALER = null; }

  if (!DEALER) { show("dash-buyer"); return; }

  await Promise.all([loadListings(), loadConvos()]);
  enterDealer();
}

function enterDealer() {
  hide("dash-loading");
  show("dash-dealer");
  document.getElementById("dash-name").textContent = DEALER.name;
  renderBadge();
  renderStats();
  renderOverview();
  renderListings();
  renderConvoList();
  renderChips();
}

function renderBadge() {
  const b = document.getElementById("dash-badge");
  b.className = "dash-badge " + (DEALER.verified ? "ok" : "wait");
  b.textContent = DEALER.verified ? "✓ " + t("d_verified") : t("d_not_verified");
}

// ── Data ──
async function loadListings() {
  try {
    const { data } = await yayoSB().from("listings").select("*")
      .eq("dealer_id", DEALER.id).order("created_at", { ascending: false }).limit(200);
    LISTINGS = data || [];
  } catch (e) { LISTINGS = []; }
}

async function loadConvos() {
  try {
    const { data } = await yayoSB().from("conversations")
      .select("id, car_name, user_id, created_at")
      .eq("dealer_id", DEALER.id).order("created_at", { ascending: false }).limit(50);
    CONVOS = (data || []).map(c => ({
      id: c.id,
      car_name: c.car_name || "—",
      buyer: t("d_buyer"),
      msgs: null // loaded on open
    }));
  } catch (e) { CONVOS = []; }
}

// ── Tabs ──
function showTab(name) {
  ["overview", "listings", "messages"].forEach(tb => {
    document.getElementById("tab-" + tb).hidden = tb !== name;
  });
  document.querySelectorAll("#dash-dealer .dash-tabs button").forEach(b => b.classList.toggle("on", b.dataset.tab === name));
}

// ── Overview ──
function renderStats() {
  document.getElementById("stat-active").textContent = LISTINGS.filter(l => l.active && !l.sold).length;
  document.getElementById("stat-sold").textContent = LISTINGS.filter(l => l.sold).length;
  document.getElementById("stat-convos").textContent = CONVOS.length;
}

function renderOverview() {
  const el = document.getElementById("ov-convos");
  if (!CONVOS.length) { el.innerHTML = `<p class="dash-empty">${t("d_no_convos")}</p>`; return; }
  el.innerHTML = CONVOS.slice(0, 5).map(c => `
    <div class="dash-convo-line">
      <div><b>${escapeHtml(c.car_name)}</b><span>${escapeHtml(c.buyer)}</span></div>
      <button class="btn btn-ghost-dark" onclick="showTab('messages');openConvo('${c.id}')">${t("d_open")}</button>
    </div>`).join("");
}

// ── Listings CRUD ──
function statusOf(l) {
  if (l.sold) return ["sold", t("d_st_sold")];
  if (!l.active) return ["off", t("d_st_off")];
  return ["active", t("d_st_active")];
}

function renderListings() {
  const rows = document.getElementById("lst-rows");
  const empty = document.getElementById("lst-empty");
  empty.hidden = LISTINGS.length > 0;
  rows.innerHTML = LISTINGS.map(l => {
    const [cls, lbl] = statusOf(l);
    return `
    <tr>
      <td class="dash-td-car">
        <span class="dash-thumb${l.photo_url ? "" : " noimg"}">${l.photo_url ? `<img src="${escapeHtml(l.photo_url)}" alt="" loading="lazy" onerror="this.parentNode.classList.add('noimg');this.remove()">` : ""}</span>
        <b>${escapeHtml(l.car_name)}</b>
      </td>
      <td>${fmt(l.price)}</td>
      <td>${l.year || "—"}</td>
      <td><span class="dash-st ${cls}">${lbl}</span></td>
      <td class="dash-td-actions">
        <button onclick="editListing('${l.id}')">${t("d_edit")}</button>
        ${l.sold ? "" : `<button onclick="markSold('${l.id}')">${t("d_sold_btn")}</button>`}
        ${l.sold ? "" : `<button onclick="toggleActive('${l.id}')">${l.active ? t("d_off_btn") : t("d_on_btn")}</button>`}
        <button class="danger" onclick="delListing('${l.id}')">${t("d_del")}</button>
      </td>
    </tr>`;
  }).join("");
}

// ── Listing photos (upload from device — never a URL field) ──
function addPhotos(files) {
  [...files].forEach(f => {
    if (!f.type.startsWith("image/") || PHOTOS.length >= 8) return;
    PHOTOS.push({ file: f, preview: URL.createObjectURL(f) });
  });
  renderThumbs();
  document.getElementById("lf-files").value = "";
}
function removePhoto(i) { PHOTOS.splice(i, 1); renderThumbs(); }
function renderThumbs() {
  document.getElementById("up-thumbs").innerHTML = PHOTOS.map((p, i) => `
    <div class="up-thumb"><img src="${p.url || p.preview}" alt=""><button type="button" onclick="removePhoto(${i})" aria-label="Retirer">✕</button></div>`).join("");
}

async function uploadPhotos() {
  // Returns the main photo URL (first photo). Uploads any new files to Storage.
  const out = [];
  for (const p of PHOTOS) {
    if (p.url) { out.push(p.url); continue; }
    if (DEMO) { out.push(p.preview); continue; } // demo: local preview only
    const ext = (p.file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
    const path = DEALER.id + "/" + Date.now() + "-" + Math.random().toString(36).slice(2, 7) + "." + ext;
    const { error } = await yayoSB().storage.from("car-photos").upload(path, p.file, { contentType: p.file.type });
    if (error) throw error;
    const { data } = yayoSB().storage.from("car-photos").getPublicUrl(path);
    out.push(data.publicUrl);
  }
  return out;
}

let EDIT_ID = null;
function openForm(l) {
  EDIT_ID = l ? l.id : null;
  document.getElementById("lst-form-title").textContent = t(l ? "d_form_edit" : "d_form_add");
  document.getElementById("lf-name").value = l ? l.car_name : "";
  document.getElementById("lf-price").value = l ? l.price : "";
  document.getElementById("lf-year").value = l ? (l.year || "") : "";
  document.getElementById("lf-km").value = l ? (l.mileage || "") : "";
  document.getElementById("lf-cond").value = (l && l.condition) || "Très bon état";
  document.getElementById("lf-color").value = l ? (l.color || "") : "";
  document.getElementById("lf-desc").value = l ? (l.description || "") : "";
  PHOTOS = (l && l.photo_url) ? [{ url: l.photo_url }] : [];
  renderThumbs();
  hide("lst-err");
  show("lst-form");
  document.getElementById("lf-name").focus();
}
function closeForm() { hide("lst-form"); EDIT_ID = null; }
function findListing(id) { return LISTINGS.find(l => String(l.id) === String(id)); }
function editListing(id) { const l = findListing(id); if (l) openForm(l); }

async function saveListing(e) {
  e.preventDefault();
  const err = document.getElementById("lst-err");
  err.hidden = true;
  if (!PHOTOS.length) { err.hidden = false; err.textContent = t("up_min_err"); return false; }

  const btn = e.target && e.target.querySelector ? e.target.querySelector("button[type=submit]") : null;
  if (btn) { btn.disabled = true; btn.textContent = t("up_uploading"); }
  let photoUrls;
  try { photoUrls = await uploadPhotos(); }
  catch (upErr) {
    if (btn) { btn.disabled = false; btn.textContent = t("d_save"); }
    err.hidden = false; err.textContent = t("up_fail") + " (" + (upErr.message || upErr) + ")";
    return false;
  }
  if (btn) { btn.disabled = false; btn.textContent = t("d_save"); }

  const payload = {
    car_name: document.getElementById("lf-name").value.trim(),
    price: parseInt(document.getElementById("lf-price").value, 10),
    year: parseInt(document.getElementById("lf-year").value, 10) || null,
    mileage: parseInt(document.getElementById("lf-km").value, 10) || null,
    condition: document.getElementById("lf-cond").value,
    color: document.getElementById("lf-color").value.trim() || null,
    photo_url: photoUrls[0],
    description: document.getElementById("lf-desc").value.trim() || null
  };
  if (DEMO) {
    if (EDIT_ID) Object.assign(findListing(EDIT_ID), payload);
    else LISTINGS.unshift({ ...payload, id: "demo-new-" + Date.now(), active: true, sold: false, dealer: { name: DEALER.name } });
    closeForm(); renderListings(); renderStats();
    return false;
  }
  try {
    const sb = yayoSB();
    if (EDIT_ID) {
      const { error } = await sb.from("listings").update(payload).eq("id", EDIT_ID).eq("dealer_id", DEALER.id);
      if (error) throw error;
    } else {
      const { error } = await sb.from("listings").insert({
        ...payload, dealer_id: DEALER.id, city: "Dubai", export_africa: true, active: true, sold: false
      });
      if (error) throw error;
    }
    await loadListings();
    closeForm(); renderListings(); renderStats();
  } catch (err2) {
    err.hidden = false; err.textContent = t("au_err_generic") + (err2.message || err2);
  }
  return false;
}

async function patchListing(id, patch) {
  const l = findListing(id);
  if (!l) return;
  if (DEMO) { Object.assign(l, patch); renderListings(); renderStats(); return; }
  try {
    const { error } = await yayoSB().from("listings").update(patch).eq("id", id).eq("dealer_id", DEALER.id);
    if (error) throw error;
    Object.assign(l, patch); renderListings(); renderStats();
  } catch (e) { alert(t("au_err_generic") + (e.message || e)); }
}
function markSold(id) { patchListing(id, { sold: true, active: false }); }
function toggleActive(id) { const l = findListing(id); if (l) patchListing(id, { active: !l.active }); }

async function delListing(id) {
  if (!confirm(t("d_del_confirm"))) return;
  if (DEMO) { LISTINGS = LISTINGS.filter(l => String(l.id) !== String(id)); renderListings(); renderStats(); return; }
  try {
    const { error } = await yayoSB().from("listings").delete().eq("id", id).eq("dealer_id", DEALER.id);
    if (error) throw error;
    LISTINGS = LISTINGS.filter(l => String(l.id) !== String(id));
    renderListings(); renderStats();
  } catch (e) { alert(t("au_err_generic") + (e.message || e)); }
}

// ── Messages (dealer reads the buyer in HIS language) ──
function renderConvoList() {
  const el = document.getElementById("msg-list");
  if (!CONVOS.length) { el.innerHTML = `<p class="dash-empty">${t("d_no_convos")}</p>`; return; }
  el.innerHTML = CONVOS.map(c => `
    <button class="dash-convo${CUR_CONVO && CUR_CONVO.id === c.id ? " on" : ""}" onclick="openConvo('${c.id}')">
      <b>${escapeHtml(c.car_name)}</b><span>${escapeHtml(c.buyer)}</span>
    </button>`).join("");
}

// Suggested replies — Assistant Yayo Mode 2: dealer reviews, then sends.
// Dealer controls: on/off + style, saved locally per dealer.
function assistSettings() {
  try { return JSON.parse(localStorage.getItem("yayo_assist_" + (DEALER ? DEALER.id : "")) || "{}"); }
  catch (e) { return {}; }
}
function assistToggle() {
  const on = document.getElementById("as-on").checked;
  const style = document.getElementById("as-style").value;
  try { localStorage.setItem("yayo_assist_" + (DEALER ? DEALER.id : ""), JSON.stringify({ on, style })); } catch (e) {}
  document.getElementById("as-zone").hidden = !on;
  document.getElementById("as-style").disabled = !on;
}
function renderChips() {
  const s = assistSettings();
  document.getElementById("as-on").checked = s.on !== false; // default: on
  document.getElementById("as-style").value = s.style || "pro";
  document.getElementById("as-zone").hidden = s.on === false;
  document.getElementById("as-style").disabled = s.on === false;
  document.getElementById("msg-chips").innerHTML = ["as_avail", "as_nego", "as_photo", "as_ship"]
    .map(k => `<button type="button" onclick="useChip('${k}')">${t(k)}</button>`).join("");
}
function useChip(key) {
  const input = document.getElementById("msg-input");
  input.value = t(key);
  input.focus();
}

// ✨ Draft a full reply from the real conversation (never sent automatically)
async function assistSuggest() {
  if (!CUR_CONVO || !CUR_CONVO.msgs || !CUR_CONVO.msgs.length) return;
  const btn = document.getElementById("as-write");
  btn.disabled = true;
  const label = btn.textContent;
  btn.textContent = t("d_as_wait");
  const listing = LISTINGS.find(l => l.car_name === CUR_CONVO.car_name);
  const reply = await yayoAssist(
    CUR_CONVO.msgs.slice(-12).map(m => ({ me: m.me, text: m.text })),
    { name: CUR_CONVO.car_name, price: listing ? listing.price : null },
    document.getElementById("as-style").value
  );
  btn.disabled = false;
  btn.textContent = label;
  if (reply) {
    const input = document.getElementById("msg-input");
    input.value = reply;
    input.focus();
  } else {
    alert(t("d_as_unavail")); // key not configured yet or offline — chips still work
  }
}

// 💡 Suggested price range for the listing form (dealer tool)
async function estimatePrice() {
  const name = document.getElementById("lf-name").value.trim();
  const out = document.getElementById("est-out");
  if (!name) { out.hidden = false; out.textContent = t("d_est_need_name"); return; }
  const btn = document.getElementById("est-btn");
  btn.disabled = true;
  out.hidden = false;
  out.textContent = t("d_as_wait");
  const est = await yayoEstimate({
    name,
    year: document.getElementById("lf-year").value,
    mileage: document.getElementById("lf-km").value,
    condition: document.getElementById("lf-cond").value
  });
  btn.disabled = false;
  out.textContent = est
    ? `${t("d_est_range")} ${fmt(est.low)} – ${fmt(est.high)}. ${est.why || ""}`
    : t("d_as_unavail");
}

// 📋 Visible-condition note from the first photo → description (dealer edits it)
async function conditionReport() {
  const out = document.getElementById("cr-out");
  const p = PHOTOS[0];
  if (!p) { out.hidden = false; out.textContent = t("up_min_err"); return; }
  const btn = document.getElementById("cr-btn");
  btn.disabled = true;
  out.hidden = false;
  out.textContent = t("d_cr_wait");
  let dataUrl = null;
  if (p.file) dataUrl = await yayoShrinkPhoto(p.file);
  else if (p.url) {
    try {
      const blob = await (await fetch(p.url)).blob();
      dataUrl = await yayoShrinkPhoto(blob);
    } catch (e) { dataUrl = null; }
  }
  const report = dataUrl ? await yayoCondition(dataUrl) : null;
  btn.disabled = false;
  if (report) {
    const desc = document.getElementById("lf-desc");
    desc.value = (desc.value ? desc.value.trim() + "\n\n" : "") + report;
    out.textContent = t("d_cr_done");
  } else {
    out.textContent = t("d_as_unavail");
  }
}

async function openConvo(id) {
  CUR_CONVO = CONVOS.find(c => String(c.id) === String(id));
  if (!CUR_CONVO) return;
  renderConvoList();
  hide("msg-empty"); show("msg-thread");
  document.getElementById("msg-title").textContent = CUR_CONVO.car_name;
  const box = document.getElementById("msg-box");
  box.innerHTML = "";

  if (CUR_CONVO.msgs === null) {
    try {
      const { data } = await yayoSB().from("messages")
        .select("sender_id, content, created_at")
        .eq("conversation_id", CUR_CONVO.id).order("created_at", { ascending: true }).limit(200);
      CUR_CONVO.msgs = (data || []).map(m => ({ me: USER && m.sender_id === USER.id, text: m.content }));
    } catch (e) { CUR_CONVO.msgs = []; }
  }
  // Two-way translation: incoming buyer messages shown in the dealer's language
  const incoming = CUR_CONVO.msgs.filter(m => !m.me);
  if (incoming.length) {
    const translated = await yayoTranslate(incoming.map(m => m.text), YAYO_LANG);
    incoming.forEach((m, i) => { m.display = translated[i]; });
  }
  CUR_CONVO.msgs.forEach(m => addMsg(m.me, m.me ? m.text : (m.display || m.text)));
}

function addMsg(me, text) {
  const box = document.getElementById("msg-box");
  const b = document.createElement("div");
  b.className = "chat-b " + (me ? "chat-me" : "chat-them");
  b.textContent = text;
  box.appendChild(b);
  box.scrollTop = box.scrollHeight;
}

async function dashSend(e) {
  e.preventDefault();
  const input = document.getElementById("msg-input");
  const text = input.value.trim();
  if (!text || !CUR_CONVO) return false;
  input.value = "";
  addMsg(true, text);
  CUR_CONVO.msgs.push({ me: true, text });
  if (!DEMO) {
    try {
      await yayoSB().from("messages").insert({ conversation_id: CUR_CONVO.id, sender_id: USER.id, content: text });
    } catch (err) { /* shown locally; will sync on next load */ }
  }
  return false;
}

async function dashLogout() {
  if (confirm(t("logout_confirm"))) { await yayoSB().auth.signOut(); location.href = "index.html"; }
}

// ── Agency dashboard (Phase 1: profile + offices + routes with promise) ──
// Everything beyond the base columns is stored as JSON in the routes column:
// { v:2, description, years, languages, pickup, offices:{city:addr}, routes:[…] }
function parseAgencyData(raw) {
  let d = raw;
  if (typeof d === "string") { try { d = JSON.parse(d); } catch (e) { d = null; } }
  if (Array.isArray(d)) return { meta: {}, routes: d };          // legacy: plain array
  if (d && typeof d === "object") return { meta: d, routes: Array.isArray(d.routes) ? d.routes : [] };
  return { meta: {}, routes: [] };
}
function buildAgencyPayload() {
  return JSON.stringify({
    v: 2,
    description: AG_META.description || null,
    years: AG_META.years || null,
    languages: AG_META.languages || null,
    pickup: AG_META.pickup || null,
    offices: AG_META.offices || {},
    routes: ROUTES
  });
}

async function agencyInit() {
  try {
    const sb = yayoSB();
    let { data } = await sb.from("shipping_agencies").select("*").eq("email", USER.email).maybeSingle();
    if (!data && USER.user_metadata && USER.user_metadata.company) {
      const r = await sb.from("shipping_agencies").select("*").ilike("name", USER.user_metadata.company).limit(1);
      data = r.data && r.data[0];
    }
    if (!data) {
      const ins = await sb.from("shipping_agencies").insert({
        name: (USER.user_metadata && USER.user_metadata.company) || USER.email.split("@")[0],
        email: USER.email,
        whatsapp: (USER.user_metadata && USER.user_metadata.phone) || null,
        country: "Dubai UAE", verified: false
      }).select("*").single();
      data = ins.data;
    }
    AGENCY = data || null;
  } catch (e) { AGENCY = null; }
  if (!AGENCY) { show("dash-buyer"); return; }
  const parsed = parseAgencyData(AGENCY.routes);
  AG_META = parsed.meta;
  ROUTES = parsed.routes;
  enterAgency();
}

function enterAgency() {
  hide("dash-loading");
  show("dash-agency-app");
  document.getElementById("ag-name").textContent = AGENCY.name;
  const b = document.getElementById("ag-badge");
  b.className = "dash-badge " + (AGENCY.verified ? "ok" : "wait");
  b.textContent = AGENCY.verified ? "✓ " + t("ag_verified") : t("d_not_verified");
  document.getElementById("agf-name").value = AGENCY.name || "";
  document.getElementById("agf-country").value = AGENCY.country || "";
  document.getElementById("agf-years").value = AG_META.years || "";
  document.getElementById("agf-langs").value = AG_META.languages || "";
  document.getElementById("agf-pickup").value = AG_META.pickup || "";
  document.getElementById("agf-desc").value = AG_META.description || "";
  renderRoutes();
  renderOffices();
}

function showAgTab(name) {
  ["ag-routes", "ag-profile"].forEach(tb => {
    document.getElementById("tab-" + tb).hidden = tb !== name;
  });
  document.querySelectorAll("#dash-agency-app .dash-tabs button").forEach(b => b.classList.toggle("on", b.dataset.tab === name));
}

function cityOptions(sel) {
  return Object.keys(YAYO_CONFIG.DESTINATIONS).filter(k => k !== "dubai")
    .map(k => { const d = YAYO_CONFIG.DESTINATIONS[k]; return `<option value="${k}"${k === sel ? " selected" : ""}>${d.flag} ${d.name}</option>`; }).join("");
}

function renderRoutes() {
  const el = document.getElementById("ag-routes");
  document.getElementById("ag-no-routes").hidden = ROUTES.length > 0;
  el.innerHTML = ROUTES.map((r, i) => `
    <div class="ag-route" data-i="${i}">
      <div class="field"><label>${t("ag_route_dest")}</label><select class="agr-city" onchange="renderOffices(true)">${cityOptions(r.city)}</select></div>
      <div class="field"><label>${t("ag_route_price")}</label><input class="agr-price" type="number" min="100" max="50000" inputmode="numeric" value="${r.price || ""}"></div>
      <div class="field"><label>${t("ag_route_days")}</label><input class="agr-days" type="number" min="1" max="120" inputmode="numeric" value="${r.days || ""}"></div>
      <button type="button" class="ag-route-del" onclick="delRoute(${i})" aria-label="Supprimer">✕</button>
      <div class="field field-wide"><label>${t("ag_route_promise")}</label><input class="agr-promise" type="text" maxlength="120" placeholder="${t("ag_route_promise_ph")}" value="${escapeHtml(r.promise || "")}"></div>
    </div>`).join("");
}

function renderOffices(syncFirst) {
  if (syncFirst) syncRoutesFromDOM();
  const cities = [...new Set(ROUTES.map(r => r.city))];
  const el = document.getElementById("ag-offices");
  AG_META.offices = AG_META.offices || {};
  el.innerHTML = cities.map(c => {
    const d = YAYO_CONFIG.DESTINATIONS[c];
    return `
    <div class="field field-wide">
      <label>${t("ag_office_lbl")} ${d ? d.flag + " " + d.name : c}</label>
      <input class="ag-office" data-city="${c}" type="text" maxlength="160" value="${escapeHtml(AG_META.offices[c] || "")}">
    </div>`;
  }).join("");
}

function syncRoutesFromDOM() {
  ROUTES = [...document.querySelectorAll(".ag-route")].map(row => ({
    city: row.querySelector(".agr-city").value,
    price: parseInt(row.querySelector(".agr-price").value, 10) || 0,
    days: parseInt(row.querySelector(".agr-days").value, 10) || null,
    promise: row.querySelector(".agr-promise").value.trim() || null
  }));
}
function syncOfficesFromDOM() {
  const offices = {};
  document.querySelectorAll(".ag-office").forEach(inp => {
    if (inp.value.trim()) offices[inp.dataset.city] = inp.value.trim();
  });
  AG_META.offices = offices;
}

function addRoute() {
  syncRoutesFromDOM();
  ROUTES.push({ city: "kinshasa", price: "", days: "", promise: "" });
  renderRoutes();
  renderOffices();
}

function delRoute(i) {
  syncRoutesFromDOM();
  ROUTES.splice(i, 1);
  renderRoutes();
  renderOffices();
}

function flashSaved(id) {
  const el = document.getElementById(id);
  el.hidden = false;
  setTimeout(() => { el.hidden = true; }, 2500);
}

async function saveRoutes() {
  syncRoutesFromDOM();
  syncOfficesFromDOM();
  ROUTES = ROUTES.filter(r => r.price > 0);
  renderRoutes();
  renderOffices();
  const err = document.getElementById("ag-routes-err");
  err.hidden = true;
  if (DEMO_AG) { flashSaved("ag-routes-saved"); return; }
  try {
    const { error } = await yayoSB().from("shipping_agencies")
      .update({ routes: buildAgencyPayload() }).eq("id", AGENCY.id);
    if (error) throw error;
    flashSaved("ag-routes-saved");
  } catch (e) { err.hidden = false; err.textContent = t("au_err_generic") + (e.message || e); }
}

async function saveAgProfile(e) {
  e.preventDefault();
  syncOfficesFromDOM();
  AG_META.description = document.getElementById("agf-desc").value.trim() || null;
  AG_META.years = parseInt(document.getElementById("agf-years").value, 10) || null;
  AG_META.languages = document.getElementById("agf-langs").value.trim() || null;
  AG_META.pickup = document.getElementById("agf-pickup").value.trim() || null;
  const patch = {
    name: document.getElementById("agf-name").value.trim(),
    country: document.getElementById("agf-country").value.trim() || null,
    routes: buildAgencyPayload()
  };
  const err = document.getElementById("ag-prof-err");
  err.hidden = true;
  if (DEMO_AG) { AGENCY.name = patch.name; document.getElementById("ag-name").textContent = AGENCY.name; flashSaved("ag-prof-saved"); return false; }
  try {
    const { error } = await yayoSB().from("shipping_agencies").update(patch).eq("id", AGENCY.id);
    if (error) throw error;
    AGENCY.name = patch.name; AGENCY.country = patch.country;
    document.getElementById("ag-name").textContent = AGENCY.name;
    flashSaved("ag-prof-saved");
  } catch (e2) { err.hidden = false; err.textContent = t("au_err_generic") + (e2.message || e2); }
  return false;
}

// Re-render translated content when the language changes
window.onLangChange = () => {
  if (!document.getElementById("dash-dealer").hidden) {
    renderBadge(); renderOverview(); renderListings(); renderConvoList(); renderChips();
  }
  if (!document.getElementById("dash-agency-app").hidden) {
    syncRoutesFromDOM(); syncOfficesFromDOM(); enterAgency();
  }
};

init();
