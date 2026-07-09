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
const DEMO = DEMO_PARAM === "1";           // dealer demo
const DEMO_AG = DEMO_PARAM === "agency";   // agency demo
const DEMO_ADMIN = DEMO_PARAM === "admin"; // admin demo
let USER = null;      // Supabase auth user (null in demo)
let DEALER = null;    // dealers row (or demo object)
let AGENCY = null;    // shipping_agencies row (or demo object)
let AG_META = {};     // agency profile v2 (description, offices…)
let ROUTES = [];      // agency routes [{city, price, days, promise}]
let LISTINGS = [];
let CONVOS = [];
let CUR_CONVO = null;
let UNREAD = {};      // conversation_id → unread count (for the badge)
let PHOTOS = [];      // listing form photos: {url} saved | {file, preview} new
// Profile media — same item shape as PHOTOS
let D_LOGO = null, D_GAL = [];   // dealer logo + showroom photos
let A_LOGO = null, A_GAL = [];   // agency logo + operation photos

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
function demoAgConvos() {
  return [
    { id: "ac-1", car_name: "transport · Toyota Prado 2021", buyer: "Acheteur · Kinshasa", msgs: [
      { me: false, text: "Bonjour, vous pouvez livrer un Prado à Kinshasa ? Quel délai ?" }
    ]},
    { id: "ac-2", car_name: "transport", buyer: "Acheteur · Dakar", msgs: [
      { me: false, text: "Est-ce que l'assurance est incluse dans votre prix vers Dakar ?" },
      { me: true,  text: "Bonjour ! Oui, l'assurance de base est incluse. Comptez 30 jours port à port." }
    ]}
  ];
}
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
    LISTINGS = window.YAYO_DEMO.slice(0, 6).map((c, i) => ({ ...c, active: true, sold: false, views: [412, 300, 255, 190, 122, 80][i] }));
    LISTINGS[4].sold = true; LISTINGS[5].active = false;
    CONVOS = demoConvos();
    CONVOS.forEach((c, i) => { c.created_at = new Date(Date.now() - (i * 5 + 2) * 86400000).toISOString(); });
    UNREAD = { "dc-1": 2 };
    show("dash-demo");
    document.getElementById("dash-logout").style.display = "none"; // .btn display overrides [hidden]
    enterDealer();
    return;
  }
  if (DEMO_AG) {
    AGENCY = { ...DEMO_AGENCY };
    AG_META = JSON.parse(JSON.stringify(DEMO_AG_META));
    ROUTES = JSON.parse(JSON.stringify(DEMO_AG_ROUTES));
    CONVOS = demoAgConvos();
    CONVOS.forEach((c, i) => { c.created_at = new Date(Date.now() - (i * 7 + 3) * 86400000).toISOString(); });
    UNREAD = { "ac-1": 1 };
    show("dash-demo");
    document.getElementById("ag-logout").style.display = "none";
    enterAgency();
    return;
  }
  if (DEMO_ADMIN) {
    adminDemoData();
    show("dash-demo");
    hide("dash-loading");
    show("dash-admin");
    document.getElementById("ad-logout").style.display = "none";
    adminEnter();
    return;
  }

  USER = await yayoUser();
  if (!USER) { location.href = "connexion.html?next=" + encodeURIComponent("dashboard.html"); return; }
  const role = (USER.user_metadata && USER.user_metadata.role) || "";

  hide("dash-loading");
  // Admin? The admin_users table is the source of truth; the old
  // user_metadata "admin" flag still works as super admin (pre-SQL fallback).
  let adRole = null;
  try { const { data } = await yayoSB().rpc("yayo_admin_role"); adRole = data || null; } catch (e) { adRole = null; }
  if (!adRole && role === "admin") adRole = "super_admin";
  if (adRole) { AD_ROLE = adRole; show("dash-admin"); await adminInit(); adminEnter(); return; }
  if (role === "agency") { await agencyInit(); return; }

  // Dealer row is linked STRICTLY by email. (The old company-name fallback was
  // a security hole: anyone could type an existing dealer's name at signup and
  // land in that dealer's dashboard.)
  try {
    const sb = yayoSB();
    let { data } = await sb.from("dealers").select("*").eq("email", USER.email).maybeSingle();
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
  D_LOGO = DEALER.logo_url ? { url: DEALER.logo_url } : null;
  D_GAL = yayoPhotoList(DEALER.photos).map(u => ({ url: u }));
  logoView(D_LOGO, "pf-logo-view", DEALER.name);
  galThumbs(D_GAL, "pf-thumbs", "rmDealerPic");
  licenseState("dealer");
  renderBadge();
  renderPendingBanner("dealer");
  renderStats();
  renderOverview();
  renderDealerCharts();
  renderListings();
  renderConvoList();
  renderChips();
  document.getElementById("msg-suggest").hidden = false; // Assistant Yayo = dealer tool
  openRequestedTab(false);
}

function renderBadge() {
  const b = document.getElementById("dash-badge");
  b.className = DEALER.verified ? "vpill" : "dash-badge wait";
  b.innerHTML = DEALER.verified ? "<b>" + t("d_verified") + "</b>" + yayoVBadge() : t("d_not_verified");
}

// "En cours de vérification" banner — pending businesses can prepare their
// profile/listings, but nothing is public until an admin approves.
function renderPendingBanner(kind) {
  const biz = kind === "dealer" ? DEALER : AGENCY;
  const box = document.getElementById(kind === "dealer" ? "d-pending" : "ag-pending");
  const p = document.getElementById(kind === "dealer" ? "d-pending-p" : "ag-pending-p");
  if (!box) return;
  box.hidden = !!biz.verified;
  if (biz.verified) return;
  let txt = t("pend_p");
  if (biz.license_path) txt = t("pend_lic_ok") + " " + t("pend_p");
  if (biz.rejected_reason) txt = t("pend_rejected") + " « " + biz.rejected_reason + " ». " + t("pend_reapply");
  p.textContent = txt;
}

// Overview charts: conversations per day + views per listing (top 8)
function renderDealerCharts() {
  const convEl = document.getElementById("ov-chart-convos");
  const viewEl = document.getElementById("ov-chart-views");
  if (!convEl || !viewEl) return;
  const series = yayoDailySeries(CONVOS.map(c => c.created_at));
  convEl.innerHTML = series.length ? yayoLineChart(series, 30) : `<p class="yy-empty">${t("ch_none")}</p>`;
  viewEl.innerHTML = yayoBarChart(
    LISTINGS.slice().sort((a, b) => (b.views || 0) - (a.views || 0)).slice(0, 8)
      .map(l => ({ label: l.car_name, value: l.views || 0 })));
}

// ── Data ──
async function loadListings() {
  try {
    const { data } = await yayoSB().from("listings").select("*")
      .eq("dealer_id", DEALER.id).order("created_at", { ascending: false }).limit(200);
    LISTINGS = data || [];
  } catch (e) { LISTINGS = []; }
}

// Works for BOTH dashboards: dealer convos or agency convos
async function loadConvos() {
  try {
    const field = DEALER ? "dealer_id" : "agency_id";
    const bizId = DEALER ? DEALER.id : AGENCY.id;
    const { data } = await yayoSB().from("conversations")
      .select("id, car_name, user_id, created_at")
      .eq(field, bizId).order("created_at", { ascending: false }).limit(50);
    CONVOS = (data || []).map(c => ({
      id: c.id,
      car_name: c.car_name || "—",
      buyer: t("d_buyer"),
      created_at: c.created_at, // for the 30-day trend chart
      msgs: null // loaded on open
    }));
  } catch (e) { CONVOS = []; }
  await loadUnread();
}

// Unread counts per conversation (SQL §12) — badge in the list + stat card
async function loadUnread() {
  UNREAD = {};
  if (DEMO || DEMO_AG) { if (CONVOS[0]) UNREAD[CONVOS[0].id] = 2; return; }
  try {
    const { data } = await yayoSB().rpc("yayo_unread_counts");
    (data || []).forEach(r => { UNREAD[r.conversation_id] = Number(r.unread || 0); });
  } catch (e) { /* setup.sql §12 not run yet — badges just stay hidden */ }
}

// ── Tabs ──
function showTab(name) {
  ["overview", "listings", "messages", "profile"].forEach(tb => {
    document.getElementById("tab-" + tb).hidden = tb !== name;
  });
  document.querySelectorAll("#dash-dealer .dash-tabs button").forEach(b => b.classList.toggle("on", b.dataset.tab === name));
}

// Deep link from the header ✉ icon: dashboard.html?tab=messages
function openRequestedTab(isAgency) {
  if (new URLSearchParams(location.search).get("tab") !== "messages") return;
  if (isAgency) showAgTab("ag-messages"); else showTab("messages");
}

// ── Profile media (dealer + agency): pick from device → Supabase Storage ──
function pickImages(files, max) {
  return [...files].filter(f => f.type.startsWith("image/")).slice(0, max)
    .map(f => ({ file: f, preview: URL.createObjectURL(f) }));
}
function galThumbs(list, elId, removeFn) {
  document.getElementById(elId).innerHTML = list.map((p, i) => `
    <div class="up-thumb"><img src="${p.url || p.preview}" alt=""><button type="button" onclick="${removeFn}(${i})" aria-label="Retirer">✕</button></div>`).join("");
}
function logoView(item, elId, name) {
  const el = document.getElementById(elId);
  if (item) { el.innerHTML = `<img class="pf-logo" src="${item.url || item.preview}" alt="">`; return; }
  const init = (name || "?").trim().split(/\s+/).map(w => w[0]).join("").slice(0, 2).toUpperCase();
  el.innerHTML = `<span class="pf-logo-empty">${escapeHtml(init)}</span>`;
}
// Upload one media item to Storage (demo mode: keep the local preview)
async function uploadMedia(bucket, folder, item, prefix) {
  if (!item) return null;
  if (item.url) return item.url;
  if (DEMO || DEMO_AG) return item.preview;
  const ext = (item.file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  const path = folder + "/" + prefix + "-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7) + "." + ext;
  const { error } = await yayoSB().storage.from(bucket).upload(path, item.file, { contentType: item.file.type });
  if (error) throw error;
  return yayoSB().storage.from(bucket).getPublicUrl(path).data.publicUrl;
}

// Dealer profile tab
function setDealerLogo(files) {
  const picked = pickImages(files, 1);
  if (picked.length) { D_LOGO = picked[0]; logoView(D_LOGO, "pf-logo-view", DEALER.name); }
  document.getElementById("pf-logo-file").value = "";
}
function addDealerPics(files) {
  D_GAL = D_GAL.concat(pickImages(files, 8 - D_GAL.length));
  galThumbs(D_GAL, "pf-thumbs", "rmDealerPic");
  document.getElementById("pf-files").value = "";
}
function rmDealerPic(i) { D_GAL.splice(i, 1); galThumbs(D_GAL, "pf-thumbs", "rmDealerPic"); }

async function saveDealerProfile() {
  const err = document.getElementById("pf-err");
  err.hidden = true;
  try {
    const logoUrl = await uploadMedia("car-photos", DEALER.id, D_LOGO, "logo");
    const photoUrls = [];
    for (const p of D_GAL) photoUrls.push(await uploadMedia("car-photos", DEALER.id, p, "gallery"));
    if (!DEMO) {
      const { error } = await yayoSB().from("dealers")
        .update({ logo_url: logoUrl, photos: photoUrls }).eq("id", DEALER.id);
      if (error) throw error;
    }
    DEALER.logo_url = logoUrl; DEALER.photos = photoUrls;
    D_LOGO = logoUrl ? { url: logoUrl } : null;
    D_GAL = photoUrls.map(u => ({ url: u }));
    logoView(D_LOGO, "pf-logo-view", DEALER.name);
    galThumbs(D_GAL, "pf-thumbs", "rmDealerPic");
    flashSaved("pf-saved");
  } catch (e) {
    err.hidden = false;
    err.textContent = /column|schema/i.test(e.message || "") ? t("pf_sql_hint") : t("au_err_generic") + (e.message || e);
  }
}

// Agency profile media (saved with the agency profile form)
function setAgencyLogo(files) {
  const picked = pickImages(files, 1);
  if (picked.length) { A_LOGO = picked[0]; logoView(A_LOGO, "agl-view", AGENCY.name); }
  document.getElementById("agl-file").value = "";
}
function addAgencyPics(files) {
  A_GAL = A_GAL.concat(pickImages(files, 8 - A_GAL.length));
  galThumbs(A_GAL, "agg-thumbs", "rmAgencyPic");
  document.getElementById("agg-files").value = "";
}
function rmAgencyPic(i) { A_GAL.splice(i, 1); galThumbs(A_GAL, "agg-thumbs", "rmAgencyPic"); }

// ── Overview ──
function renderStats() {
  document.getElementById("stat-active").textContent = LISTINGS.filter(l => l.active && !l.sold).length;
  document.getElementById("stat-sold").textContent = LISTINGS.filter(l => l.sold).length;
  document.getElementById("stat-convos").textContent = CONVOS.length;
  document.getElementById("stat-unread").textContent = Object.values(UNREAD).reduce((s, n) => s + n, 0);
  document.getElementById("stat-views").textContent = LISTINGS.reduce((s, l) => s + (l.views || 0), 0);
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
      <td>${l.views || 0}</td>
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
  el.innerHTML = CONVOS.map(c => {
    const n = UNREAD[c.id] || 0;
    return `
    <button class="dash-convo${CUR_CONVO && CUR_CONVO.id === c.id ? " on" : ""}${n ? " unread" : ""}" onclick="openConvo('${c.id}')">
      <b>${escapeHtml(c.car_name)}</b><span>${escapeHtml(c.buyer)}</span>
      ${n ? `<i class="unread-dot">${n}</i>` : ""}
    </button>`;
  }).join("");
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
  // Opening = reading: clear the unread badge on both the list and the header
  if (UNREAD[id]) {
    UNREAD[id] = 0;
    if (!DEMO && !DEMO_AG) {
      try { yayoSB().rpc("yayo_mark_read", { cid: id }).then(() => { if (window.yayoRefreshUnread) window.yayoRefreshUnread(); }, () => {}); } catch (e) {}
    }
    renderStats();
  }
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
  if (!DEMO && !DEMO_AG) {
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
    // Agency row linked STRICTLY by email (no name matching — see dealer note)
    let { data } = await sb.from("shipping_agencies").select("*").eq("email", USER.email).maybeSingle();
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
  await loadConvos();
  enterAgency();
}

function enterAgency() {
  hide("dash-loading");
  show("dash-agency-app");
  document.getElementById("ag-name").textContent = AGENCY.name;
  const b = document.getElementById("ag-badge");
  b.className = AGENCY.verified ? "vpill" : "dash-badge wait";
  b.innerHTML = AGENCY.verified ? "<b>" + t("ag_verified") + "</b>" + yayoVBadge() : t("d_not_verified");
  renderPendingBanner("agency");
  renderAgencyOverview();
  A_LOGO = AGENCY.logo_url ? { url: AGENCY.logo_url } : null;
  A_GAL = yayoPhotoList(AGENCY.photos).map(u => ({ url: u }));
  logoView(A_LOGO, "agl-view", AGENCY.name);
  galThumbs(A_GAL, "agg-thumbs", "rmAgencyPic");
  licenseState("agency");
  document.getElementById("agf-name").value = AGENCY.name || "";
  document.getElementById("agf-country").value = AGENCY.country || "";
  document.getElementById("agf-years").value = AG_META.years || "";
  document.getElementById("agf-langs").value = AG_META.languages || "";
  document.getElementById("agf-pickup").value = AG_META.pickup || "";
  document.getElementById("agf-desc").value = AG_META.description || "";
  renderRoutes();
  renderOffices();
  renderConvoList();
  document.getElementById("msg-suggest").hidden = true; // Assistant Yayo for agencies comes later
  openRequestedTab(true);
}

// Agency overview: stat cards + 30-day conversations trend + rates per city
function renderAgencyOverview() {
  const el = document.getElementById("ag-stat-routes");
  if (!el) return;
  const active = ROUTES.filter(r => r.price > 0);
  el.textContent = active.length;
  document.getElementById("ag-stat-convos").textContent = CONVOS.length;
  document.getElementById("ag-stat-unread").textContent = Object.values(UNREAD).reduce((s, n) => s + n, 0);
  const series = yayoDailySeries(CONVOS.map(c => c.created_at));
  document.getElementById("ag-chart-convos").innerHTML =
    series.length ? yayoLineChart(series, 30) : `<p class="yy-empty">${t("ch_none")}</p>`;
  document.getElementById("ag-chart-routes").innerHTML = yayoBarChart(
    active.map(r => {
      const d = YAYO_CONFIG.DESTINATIONS[r.city];
      return { label: d ? d.flag + " " + d.name : r.city, value: r.price };
    }), "$");
}

function showAgTab(name) {
  ["ag-overview", "ag-routes", "ag-profile"].forEach(tb => {
    document.getElementById("tab-" + tb).hidden = tb !== name;
  });
  // The messages panel is shared with the dealer dashboard
  document.getElementById("tab-messages").hidden = name !== "ag-messages";
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
  renderAgencyOverview();
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
  const err = document.getElementById("ag-prof-err");
  err.hidden = true;
  let logoUrl = null, photoUrls = [];
  try {
    logoUrl = await uploadMedia("agency-photos", AGENCY.id, A_LOGO, "logo");
    for (const p of A_GAL) photoUrls.push(await uploadMedia("agency-photos", AGENCY.id, p, "gallery"));
  } catch (upErr) {
    err.hidden = false; err.textContent = t("up_fail") + " (" + (upErr.message || upErr) + ")";
    return false;
  }
  const patch = {
    name: document.getElementById("agf-name").value.trim(),
    country: document.getElementById("agf-country").value.trim() || null,
    routes: buildAgencyPayload(),
    logo_url: logoUrl,
    photos: photoUrls
  };
  if (DEMO_AG) { AGENCY.name = patch.name; document.getElementById("ag-name").textContent = AGENCY.name; flashSaved("ag-prof-saved"); return false; }
  try {
    const { error } = await yayoSB().from("shipping_agencies").update(patch).eq("id", AGENCY.id);
    if (error) throw error;
    AGENCY.name = patch.name; AGENCY.country = patch.country;
    AGENCY.logo_url = logoUrl; AGENCY.photos = photoUrls;
    A_LOGO = logoUrl ? { url: logoUrl } : null;
    A_GAL = photoUrls.map(u => ({ url: u }));
    logoView(A_LOGO, "agl-view", AGENCY.name);
    galThumbs(A_GAL, "agg-thumbs", "rmAgencyPic");
    document.getElementById("ag-name").textContent = AGENCY.name;
    flashSaved("ag-prof-saved");
  } catch (e2) {
    err.hidden = false;
    err.textContent = /column|schema/i.test(e2.message || "") ? t("pf_sql_hint") : t("au_err_generic") + (e2.message || e2);
  }
  return false;
}

// ═══════════════════════════════════════════════
// ADMIN — the control room.
// All mutations go through security-definer RPCs
// (supabase/setup.sql §11) which check the caller's
// role and write the audit log. Roles:
// super_admin > admin_dealers / admin_support / admin_stats
// ═══════════════════════════════════════════════
let AD_ROLE = null;
let AD_DEALERS = [], AD_AGS = [], AD_LISTINGS = [], AD_USERS = [], AD_TEAM = [], AD_LOG = [], AD_STATS = null;

const AD_PERMS = {
  super_admin:   ["stats", "dealers", "agencies", "listings", "users", "team", "log"],
  admin_dealers: ["dealers", "agencies"],
  admin_support: ["listings", "users"],
  admin_stats:   ["stats"]
};
function adCan(section) { return (AD_PERMS[AD_ROLE] || []).includes(section); }

function adminDemoData() {
  AD_ROLE = "super_admin";
  const day = 86400000, now = Date.now();
  const iso = d => new Date(now - d * day).toISOString();
  AD_DEALERS = [
    { id: "adm-d1", name: "Mukoma Auto", email: "contact@mukoma-auto.ae", whatsapp: "+971 50 000 0000", city: "Dubai", verified: true, suspended: false, license_path: "adm-d1/license-demo.pdf", created_at: iso(90) },
    { id: "adm-d2", name: "Kabeya Auto", email: "kabeya@example.com", whatsapp: "+971 55 111 1111", city: "Dubai", verified: false, suspended: false, license_path: "adm-d2/license-demo.jpg", created_at: iso(12) },
    { id: "adm-d3", name: "Al Aweer Motors", email: "sales@alaweer.example", whatsapp: null, city: "Dubai", verified: false, suspended: true, license_path: null, rejected_reason: "Licence illisible", created_at: iso(30) }
  ];
  AD_AGS = [
    { id: "adm-a1", name: "TransAfrica Cargo", email: "ops@transafrica.example", whatsapp: "+971 52 222 2222", country: "Dubai UAE", verified: true, suspended: false, license_path: "adm-a1/license-demo.pdf", created_at: iso(60) },
    { id: "adm-a2", name: "Gulf-Africa Shipping", email: "info@gulfafrica.example", whatsapp: null, country: "Dubai UAE", verified: false, suspended: false, license_path: null, created_at: iso(5) }
  ];
  AD_LISTINGS = window.YAYO_DEMO.slice(0, 8).map((c, i) => ({
    id: c.id, car_name: c.car_name, price: c.price, views: [412, 300, 255, 190, 122, 80, 34, 12][i],
    active: i !== 6, sold: i === 5, hidden: i === 7, dealer_id: i % 2 ? "adm-d2" : "adm-d1",
    dealers: { name: i % 2 ? "Kabeya Auto" : "Mukoma Auto" }
  }));
  AD_USERS = [
    { id: "u1", email: "acheteur.kin@example.com", created_at: iso(2), last_sign_in_at: iso(0), banned: false },
    { id: "u2", email: "marie.douala@example.com", created_at: iso(9), last_sign_in_at: iso(3), banned: false },
    { id: "u4", email: null, phone: "+243812345678", created_at: iso(200), last_sign_in_at: iso(45), banned: false },
    { id: "u3", email: "spam.account@example.com", created_at: iso(20), last_sign_in_at: iso(18), banned: true }
  ];
  AD_TEAM = [
    { email: "yayoapp20@gmail.com", role: "super_admin", created_at: iso(90) },
    { email: "assistant@example.com", role: "admin_dealers", created_at: iso(10) }
  ];
  AD_LOG = [
    { admin_email: "yayoapp20@gmail.com", action: "verify", subject_type: "dealer", detail: null, created_at: iso(1) },
    { admin_email: "assistant@example.com", action: "hide_listing", subject_type: "listing", detail: null, created_at: iso(2) },
    { admin_email: "yayoapp20@gmail.com", action: "ban_user", subject_type: "user", detail: null, created_at: iso(3) }
  ];
  AD_STATS = {
    users_total: 148, signups_today: 4, signups_7d: 23, signups_30d: 61, active_7d: 37, active_30d: 84,
    dealers: 3, dealers_verified: 1, agencies: 2, agencies_verified: 1,
    listings_total: 8, listings_active: 6, listings_new_7d: 3, sold: 1,
    messages: 212, conversations: 39, favorites: 57, reviews: 4,
    signups_by_day: Array.from({ length: 30 }, (_, i) => ({ d: new Date(now - (29 - i) * day).toISOString().slice(0, 10), n: Math.max(0, Math.round(2 + 2 * Math.sin(i / 3)) + (i % 7 === 0 ? 2 : 0)) })),
    top_cars: AD_LISTINGS.slice(0, 5).map(l => ({ id: l.id, car_name: l.car_name, views: l.views })),
    top_destinations: [{ city: "kinshasa", picks: 96 }, { city: "douala", picks: 41 }, { city: "abidjan", picks: 28 }, { city: "dakar", picks: 17 }]
  };
}

// Real data — each section loads independently so one failure never blanks the rest
async function adminInit() {
  const sb = yayoSB();
  const jobs = [];
  if (adCan("dealers")) jobs.push(
    sb.from("dealers").select("*").order("created_at", { ascending: false }).limit(500).then(r => { AD_DEALERS = r.data || []; }),
    sb.from("shipping_agencies").select("*").order("created_at", { ascending: false }).limit(500).then(r => { AD_AGS = r.data || []; })
  );
  if (adCan("dealers") || adCan("listings")) jobs.push(
    sb.from("listings").select("id, car_name, price, views, active, sold, hidden, dealer_id, dealers(name)")
      .order("created_at", { ascending: false }).limit(1000).then(r => { AD_LISTINGS = r.data || []; })
  );
  if (adCan("team")) jobs.push(sb.from("admin_users").select("*").order("created_at").then(r => { AD_TEAM = r.data || []; }));
  if (adCan("log")) jobs.push(sb.from("admin_audit_log").select("*").order("created_at", { ascending: false }).limit(100).then(r => { AD_LOG = r.data || []; }));
  if (adCan("stats")) jobs.push(sb.rpc("admin_stats").then(r => { AD_STATS = r.data || null; adSqlHint(r.error); }));
  if (adCan("users")) jobs.push(adLoadUsers());
  try { await Promise.all(jobs); } catch (e) { adSqlHint(e); }
}

// Missing table/function = setup.sql not run yet → one clear banner
function adSqlHint(e) {
  if (!e) return;
  const m = (e.message || String(e)).toLowerCase();
  if (/could not find|does not exist|schema cache|function/.test(m)) {
    const el = document.getElementById("ad-sql-hint");
    el.hidden = false;
    el.textContent = t("ad_sql_hint");
  }
}

function adminEnter() {
  const tabs = (AD_PERMS[AD_ROLE] || []);
  document.getElementById("ad-tabs").innerHTML = tabs.map((s, i) =>
    `<button class="${i === 0 ? "on" : ""}" data-tab="ad-${s === "stats" ? "stats" : s}" onclick="showAdTab('ad-${s}')" >${t("ad_tab_" + (s === "stats" ? "stats" : s))}</button>`).join("");
  renderAdmin();
  if (tabs.length) showAdTab("ad-" + tabs[0]);
}

function showAdTab(name) {
  ["ad-stats", "ad-dealers", "ad-agencies", "ad-listings", "ad-users", "ad-team", "ad-log"].forEach(tb => {
    const el = document.getElementById("tab-" + tb);
    if (el) el.hidden = tb !== name;
  });
  document.querySelectorAll("#dash-admin .dash-tabs button").forEach(b => b.classList.toggle("on", b.dataset.tab === name));
}

function renderAdmin() {
  if (adCan("dealers")) { adRenderBiz("dealer"); adRenderBiz("agency"); }
  if (adCan("listings")) adRenderListings();
  if (adCan("users")) adRenderUsers();
  if (adCan("team")) adRenderTeam();
  if (adCan("log")) adRenderLog();
  if (adCan("stats")) adRenderStats();
}

function adDate(s) {
  if (!s) return "—";
  try { return new Date(s).toLocaleDateString(YAYO_LANG === "ar" ? "ar" : YAYO_LANG === "en" ? "en-GB" : "fr-FR"); } catch (e) { return "—"; }
}
function adConfirm(key, name) { return confirm(t(key).replace("{name}", name || "")); }
async function adRpc(fn, args) {
  const { error } = await yayoSB().rpc(fn, args);
  if (error) throw error;
}
function adFail(errId, e) {
  adSqlHint(e);
  const el = document.getElementById(errId);
  el.hidden = false;
  el.textContent = t("au_err_generic") + (e.message || e);
}

// ── Dealers & agencies ──
function bizList(type) { return type === "dealer" ? AD_DEALERS : AD_AGS; }
function bizStatus(x) {
  if (x.suspended) return ["off", t("ad_st_suspended")];
  if (x.verified) return ["active", t("ad_st_verified") + " " + yayoVBadge()];
  return ["sold", t("ad_st_pending")];
}
function bizActionsHtml(type, x) {
  return `
    <button onclick="adOpenBiz('${type}','${x.id}')">${t("ad_act_profile")}</button>
    <button onclick="adLicense('${type}','${x.id}')">${t("ad_act_license")}</button>
    <button onclick="adVerify('${type}','${x.id}',${x.verified ? "false" : "true"})">${x.verified ? t("ad_unverify") : t("ad_verify")}</button>
    ${x.verified ? "" : `<button onclick="adReject('${type}','${x.id}')">${t("ad_act_reject")}</button>`}
    <button onclick="adSuspend('${type}','${x.id}',${x.suspended ? "false" : "true"})">${x.suspended ? t("ad_act_unsuspend") : t("ad_act_suspend")}</button>
    <button class="danger" onclick="adDeleteBiz('${type}','${x.id}')">${t("ad_act_delete")}</button>`;
}

function adRenderBiz(type) {
  const p = type === "dealer" ? "d" : "a";
  const q = (document.getElementById(`ad-${p}-search`).value || "").toLowerCase();
  const f = document.getElementById(`ad-${p}-filter`).value;
  const rows = bizList(type).filter(x => {
    if (q && !((x.name || "") + " " + (x.email || "")).toLowerCase().includes(q)) return false;
    if (f === "verified") return x.verified && !x.suspended;
    if (f === "pending") return !x.verified && !x.suspended;
    if (f === "suspended") return !!x.suspended;
    return true;
  });
  const nListings = id => AD_LISTINGS.filter(l => String(l.dealer_id) === String(id)).length;
  document.getElementById(type === "dealer" ? "ad-dealer-rows" : "ad-ag-rows").innerHTML = rows.map(x => {
    const [cls, lbl] = bizStatus(x);
    const contact = [x.email, x.whatsapp].filter(Boolean).map(escapeHtml).join("<br>") || "—";
    const place = escapeHtml(x.city || x.country || "");
    const extra = type === "dealer" ? ` · ${nListings(x.id)} ${t("ad_d_listings")}` : "";
    return `
    <tr>
      <td class="dash-td-car">${yayoAvatarHtml(x.name, x.logo_url)} <b>${escapeHtml(x.name)}</b><span class="ad-place">${place}${extra}</span></td>
      <td class="ad-contact">${contact}</td>
      <td><span class="dash-st ${cls}">${lbl}</span></td>
      <td class="dash-td-actions">${bizActionsHtml(type, x)}</td>
    </tr>`;
  }).join("");
  document.getElementById(type === "dealer" ? "ad-dealers-empty" : "ad-ag-empty").hidden = rows.length > 0;
}

// Full profile panel — review everything before deciding
function adOpenBiz(type, id) {
  const x = bizList(type).find(r => String(r.id) === String(id));
  const box = document.getElementById(type === "dealer" ? "ad-d-detail" : "ad-a-detail");
  if (!x) { box.innerHTML = ""; return; }
  const meta = type === "agency" ? parseAgencyData(x.routes).meta : {};
  const gal = yayoPhotoList(x.photos);
  const nL = AD_LISTINGS.filter(l => String(l.dealer_id) === String(x.id)).length;
  const line = (lbl, val) => val ? `<p class="ad-dl"><b>${t(lbl)}</b> ${escapeHtml(String(val))}</p>` : "";
  box.innerHTML = `
  <div class="vd-card ad-detail">
    <div class="ad-detail-head">
      ${yayoAvatarHtml(x.name, x.logo_url, true)}
      <div>
        <h3>${escapeHtml(x.name)} <span class="dash-st ${bizStatus(x)[0]}">${bizStatus(x)[1]}</span></h3>
        <p class="ad-place">${escapeHtml(x.email || "")} ${x.whatsapp ? "· " + escapeHtml(x.whatsapp) : ""} · ${t("ad_d_created")} ${adDate(x.created_at)}</p>
      </div>
      <button class="btn btn-ghost-dark" onclick="document.getElementById('${type === "dealer" ? "ad-d-detail" : "ad-a-detail"}').innerHTML=''">${t("ad_act_close")}</button>
    </div>
    ${line("ad_d_desc", meta.description)}
    ${line("ad_d_pickup", meta.pickup)}
    ${line("ad_d_langs", meta.languages)}
    ${line("ad_d_years", meta.years)}
    ${x.rejected_reason ? `<p class="ad-dl ad-reason"><b>${t("ad_d_reason")}</b> ${escapeHtml(x.rejected_reason)}</p>` : ""}
    ${type === "dealer" ? `<p class="ad-dl"><b>${nL}</b> ${t("ad_d_listings")}</p>` : ""}
    ${gal.length ? `<div class="up-thumbs">${gal.slice(0, 6).map(u => `<div class="up-thumb"><img src="${escapeHtml(u)}" alt=""></div>`).join("")}</div>` : ""}
    <div class="dash-td-actions ad-detail-actions">${bizActionsHtml(type, x)}</div>
  </div>`;
  box.scrollIntoView({ behavior: "smooth", block: "start" });
}

// The trust gate: open the uploaded trade license (private bucket, signed URL)
async function adLicense(type, id) {
  const x = bizList(type).find(r => String(r.id) === String(id));
  if (!x || !x.license_path) { alert(t("ad_no_license")); return; }
  if (DEMO_ADMIN) { alert(t("d_demo_banner")); return; }
  try {
    const { data, error } = await yayoSB().storage.from("licenses").createSignedUrl(x.license_path, 600);
    if (error) throw error;
    window.open(data.signedUrl, "_blank", "noopener");
  } catch (e) { alert(t("ad_license_fail") + (e.message || e)); }
}

async function adBizAction(type, id, doRpc, apply) {
  const errId = type === "dealer" ? "ad-dealers-err" : "ad-ag-err";
  document.getElementById(errId).hidden = true;
  const x = bizList(type).find(r => String(r.id) === String(id));
  if (!x) return;
  try {
    if (!DEMO_ADMIN) await doRpc(x);
    apply(x);
    adRenderBiz(type);
    document.getElementById(type === "dealer" ? "ad-d-detail" : "ad-a-detail").innerHTML = "";
  } catch (e) { adFail(errId, e); }
}

function adVerify(type, id, val) {
  adBizAction(type, id,
    () => adRpc("admin_set_verified", { subject: type, sid: id, val }),
    x => { x.verified = val; if (val) x.rejected_reason = null; });
}
function adReject(type, id) {
  const x = bizList(type).find(r => String(r.id) === String(id));
  const reason = prompt(t("ad_reject_reason"), x && x.rejected_reason || "");
  if (reason === null) return;
  adBizAction(type, id,
    () => adRpc("admin_reject", { subject: type, sid: id, reason }),
    y => { y.verified = false; y.rejected_reason = reason; });
}
function adSuspend(type, id, val) {
  const x = bizList(type).find(r => String(r.id) === String(id));
  if (!x || !adConfirm(val ? "ad_c_suspend" : "ad_c_unsuspend", x.name)) return;
  adBizAction(type, id,
    () => adRpc("admin_set_suspended", { subject: type, sid: id, val }),
    y => {
      y.suspended = val;
      if (type === "dealer") AD_LISTINGS.forEach(l => { if (String(l.dealer_id) === String(id)) l.hidden = val; });
      if (adCan("listings")) adRenderListings();
    });
}
function adDeleteBiz(type, id) {
  const x = bizList(type).find(r => String(r.id) === String(id));
  if (!x || !adConfirm("ad_c_delete_biz", x.name)) return;
  adBizAction(type, id,
    () => adRpc("admin_delete_business", { subject: type, sid: id }),
    () => {
      if (type === "dealer") {
        AD_DEALERS = AD_DEALERS.filter(r => String(r.id) !== String(id));
        AD_LISTINGS = AD_LISTINGS.filter(l => String(l.dealer_id) !== String(id));
        if (adCan("listings")) adRenderListings();
      } else AD_AGS = AD_AGS.filter(r => String(r.id) !== String(id));
    });
}

// ── Listings (all cars on the platform) ──
function adRenderListings() {
  const q = (document.getElementById("ad-l-search").value || "").toLowerCase();
  const rows = AD_LISTINGS.filter(l => !q || ((l.car_name || "") + " " + ((l.dealers && l.dealers.name) || "")).toLowerCase().includes(q));
  document.getElementById("ad-lst-rows").innerHTML = rows.map(l => {
    const st = l.hidden ? ["off", t("ad_st_hidden")] : l.sold ? ["sold", t("d_st_sold")] : l.active ? ["active", t("d_st_active")] : ["sold", t("d_st_off")];
    return `
    <tr>
      <td class="dash-td-car"><b>${escapeHtml(l.car_name)}</b></td>
      <td>${escapeHtml((l.dealers && l.dealers.name) || "—")}</td>
      <td>${fmt(l.price || 0)}</td>
      <td>${l.views || 0}</td>
      <td><span class="dash-st ${st[0]}">${st[1]}</span></td>
      <td class="dash-td-actions">
        <button onclick="adHideListing('${l.id}',${l.hidden ? "false" : "true"})">${l.hidden ? t("ad_act_show") : t("ad_act_hide")}</button>
        <button class="danger" onclick="adDeleteListing('${l.id}')">${t("ad_act_delete")}</button>
      </td>
    </tr>`;
  }).join("");
  document.getElementById("ad-lst-empty").hidden = rows.length > 0;
}
async function adHideListing(id, val) {
  const l = AD_LISTINGS.find(x => String(x.id) === String(id));
  if (!l) return;
  if (val && !adConfirm("ad_c_hide_listing", l.car_name)) return;
  document.getElementById("ad-lst-err").hidden = true;
  try {
    if (!DEMO_ADMIN) await adRpc("admin_set_listing_hidden", { lid: id, val });
    l.hidden = val;
    adRenderListings();
  } catch (e) { adFail("ad-lst-err", e); }
}
async function adDeleteListing(id) {
  const l = AD_LISTINGS.find(x => String(x.id) === String(id));
  if (!l || !adConfirm("ad_c_delete_listing", l.car_name)) return;
  document.getElementById("ad-lst-err").hidden = true;
  try {
    if (!DEMO_ADMIN) await adRpc("admin_delete_listing", { lid: id });
    AD_LISTINGS = AD_LISTINGS.filter(x => String(x.id) !== String(id));
    adRenderListings();
  } catch (e) { adFail("ad-lst-err", e); }
}

// ── Users (buyers) ──
async function adLoadUsers() {
  if (DEMO_ADMIN) { adRenderUsers(); return; }
  document.getElementById("ad-users-err").hidden = true;
  try {
    const q = (document.getElementById("ad-u-search").value || "").trim();
    const { data, error } = await yayoSB().rpc("admin_list_users", { q: q || null });
    if (error) throw error;
    AD_USERS = data || [];
    adRenderUsers();
  } catch (e) { adFail("ad-users-err", e); }
}
function adRenderUsers() {
  // Count line: proves phone-only (old WhatsApp/SMS) accounts are included
  const note = document.getElementById("ad-users-note");
  if (note) {
    const phones = AD_USERS.filter(u => u.phone && !u.email).length;
    note.hidden = !AD_USERS.length;
    note.textContent = t("ad_users_note").replace("{n}", AD_USERS.length).replace("{p}", phones);
  }
  document.getElementById("ad-user-rows").innerHTML = AD_USERS.map(u => `
    <tr>
      <td class="ad-contact">${escapeHtml(u.email || u.phone || "—")}${u.email && u.phone ? `<br>📱 ${escapeHtml(u.phone)}` : ""}${!u.email && u.phone ? ` <span class="dash-st sold">📱 SMS</span>` : ""}</td>
      <td>${adDate(u.created_at)}</td>
      <td>${adDate(u.last_sign_in_at)}</td>
      <td><span class="dash-st ${u.banned ? "off" : "active"}">${u.banned ? t("ad_st_banned") : t("ad_st_ok")}</span></td>
      <td class="dash-td-actions">
        <button onclick="adBanUser('${u.id}',${u.banned ? "false" : "true"})">${u.banned ? t("ad_act_unban") : t("ad_act_ban")}</button>
        <button class="danger" onclick="adDeleteUser('${u.id}')">${t("ad_act_delete")}</button>
      </td>
    </tr>`).join("");
  document.getElementById("ad-users-empty").hidden = AD_USERS.length > 0;
}
async function adBanUser(id, val) {
  const u = AD_USERS.find(x => String(x.id) === String(id));
  if (!u || !adConfirm(val ? "ad_c_ban" : "ad_c_unban", u.email)) return;
  document.getElementById("ad-users-err").hidden = true;
  try {
    if (!DEMO_ADMIN) await adRpc("admin_ban_user", { uid: id, val });
    u.banned = val;
    adRenderUsers();
  } catch (e) { adFail("ad-users-err", e); }
}
async function adDeleteUser(id) {
  const u = AD_USERS.find(x => String(x.id) === String(id));
  if (!u || !adConfirm("ad_c_delete_user", u.email)) return;
  document.getElementById("ad-users-err").hidden = true;
  try {
    if (!DEMO_ADMIN) await adRpc("admin_delete_user", { uid: id });
    AD_USERS = AD_USERS.filter(x => String(x.id) !== String(id));
    adRenderUsers();
  } catch (e) { adFail("ad-users-err", e); }
}

// ── Admin team (super_admin only) ──
function adRoleLabel(r) {
  return t(r === "super_admin" ? "ad_r_super" : r === "admin_dealers" ? "ad_r_dealers" : r === "admin_support" ? "ad_r_support" : "ad_r_stats");
}
function adRenderTeam() {
  const me = (USER && USER.email || "").toLowerCase();
  document.getElementById("ad-team-rows").innerHTML = AD_TEAM.map(a => `
    <tr>
      <td class="ad-contact">${escapeHtml(a.email)}${a.email.toLowerCase() === me ? ` <span class="dash-st active">${t("ad_self_note")}</span>` : ""}</td>
      <td>${adRoleLabel(a.role)}</td>
      <td>${adDate(a.created_at)}</td>
      <td class="dash-td-actions">${a.email.toLowerCase() === me ? "" : `<button class="danger" onclick="adRemoveAdmin('${escapeHtml(a.email)}')">${t("ad_remove")}</button>`}</td>
    </tr>`).join("");
}
async function adAddAdmin() {
  const email = (document.getElementById("ad-t-email").value || "").trim().toLowerCase();
  const role = document.getElementById("ad-t-role").value;
  const errEl = document.getElementById("ad-team-err");
  errEl.hidden = true;
  if (!email || !email.includes("@")) return;
  try {
    if (!DEMO_ADMIN) {
      const { error } = await yayoSB().from("admin_users").upsert({ email, role, added_by: USER.email }, { onConflict: "email" });
      if (error) throw error;
      yayoSB().rpc("_yayo_log", { a: "add_admin", st: "admin", sid: email, d: role }).then(() => {}, () => {});
    }
    AD_TEAM = AD_TEAM.filter(a => a.email !== email).concat([{ email, role, created_at: new Date().toISOString() }]);
    document.getElementById("ad-t-email").value = "";
    adRenderTeam();
    flashSaved("ad-team-saved");
  } catch (e) { adFail("ad-team-err", e); }
}
async function adRemoveAdmin(email) {
  if (!adConfirm("ad_c_remove_admin", email)) return;
  const errEl = document.getElementById("ad-team-err");
  errEl.hidden = true;
  try {
    if (!DEMO_ADMIN) {
      const { error } = await yayoSB().from("admin_users").delete().eq("email", email);
      if (error) throw error;
      yayoSB().rpc("_yayo_log", { a: "remove_admin", st: "admin", sid: email, d: null }).then(() => {}, () => {});
    }
    AD_TEAM = AD_TEAM.filter(a => a.email !== email);
    adRenderTeam();
  } catch (e) { adFail("ad-team-err", e); }
}

// ── Audit log ──
function adRenderLog() {
  const rows = AD_LOG;
  document.getElementById("ad-log-rows").innerHTML = rows.map(r => `
    <div class="ad-log-line">
      <span class="ad-log-when">${adDate(r.created_at)}</span>
      <b>${escapeHtml(r.admin_email)}</b>
      <span class="dash-st sold">${escapeHtml(r.action)}</span>
      <span class="ad-log-what">${escapeHtml([r.subject_type, r.detail].filter(Boolean).join(" · "))}</span>
    </div>`).join("");
  document.getElementById("ad-log-empty").hidden = rows.length > 0;
}

// ── Statistics ──
function adRenderStats() {
  const s = AD_STATS;
  const gaEl = document.getElementById("ad-ga-status");
  gaEl.textContent = YAYO_CONFIG.GA4_ID ? t("ad_ga_set") + YAYO_CONFIG.GA4_ID : t("ad_ga_not_set");
  if (!s) { document.getElementById("ad-stats").innerHTML = `<p class="dash-empty">${t("ad_none_yet")}</p>`; return; }
  const cards = [
    ["ad_stat_users", s.users_total], ["ad_stat_today", s.signups_today], ["ad_stat_7d", s.signups_7d], ["ad_stat_30d", s.signups_30d],
    ["ad_stat_active7", s.active_7d], ["ad_stat_active30", s.active_30d],
    ["ad_stat_dealers", s.dealers], ["ad_stat_dealers_v", s.dealers_verified],
    ["ad_stat_ags", s.agencies], ["ad_stat_ags_v", s.agencies_verified],
    ["ad_stat_listings", s.listings_active], ["ad_stat_new7", s.listings_new_7d],
    ["ad_stat_total_listings", s.listings_total], ["ad_stat_sold", s.sold],
    ["ad_stat_msgs", s.messages], ["ad_stat_convos", s.conversations],
    ["ad_stat_favs", s.favorites], ["ad_stat_reviews", s.reviews]
  ];
  document.getElementById("ad-stats").innerHTML = cards.map(([k, v]) =>
    `<div class="dash-stat"><span class="num">${v === null || v === undefined ? "—" : v}</span><span class="lbl">${t(k)}</span></div>`).join("");
  document.getElementById("ad-spark").innerHTML = yayoLineChart(s.signups_by_day || [], 30);
  document.getElementById("ad-top-cars").innerHTML = yayoBarChart(
    (s.top_cars || []).map(c => ({ label: c.car_name, value: c.views })));
  document.getElementById("ad-top-dest").innerHTML = yayoBarChart(
    (s.top_destinations || []).map(d => {
      const cfg = YAYO_CONFIG.DESTINATIONS[d.city];
      return { label: cfg ? cfg.flag + " " + cfg.name : d.city, value: d.picks };
    }));
}

// ── Trade license upload (dealer + agency profile tabs) ──
function licenseState(kind) {
  const biz = kind === "dealer" ? DEALER : AGENCY;
  const el = document.getElementById(kind === "dealer" ? "pf-lic-state" : "agf-lic-state");
  const btn = document.getElementById(kind === "dealer" ? "pf-lic-btn" : "agf-lic-btn");
  if (!el || !btn) return;
  if (biz && biz.license_path) {
    el.textContent = biz.verified ? t("lic_have_v") : t("lic_have");
    btn.textContent = t("lic_replace");
  } else {
    el.textContent = t("lic_hint");
    btn.textContent = t("lic_btn");
  }
}
async function uploadLicense(kind, files) {
  const biz = kind === "dealer" ? DEALER : AGENCY;
  const el = document.getElementById(kind === "dealer" ? "pf-lic-state" : "agf-lic-state");
  const input = document.getElementById(kind === "dealer" ? "pf-lic-file" : "agf-lic-file");
  const f = files && files[0];
  if (!f || !biz) return;
  input.value = "";
  if (DEMO || DEMO_AG) { biz.license_path = "demo"; licenseState(kind); el.textContent = t("lic_saved"); return; }
  el.textContent = t("up_uploading");
  try {
    const ext = (f.name.split(".").pop() || "pdf").toLowerCase().replace(/[^a-z0-9]/g, "") || "pdf";
    const path = biz.id + "/license-" + Date.now() + "." + ext;
    const { error } = await yayoSB().storage.from("licenses").upload(path, f, { contentType: f.type });
    if (error) throw error;
    const table = kind === "dealer" ? "dealers" : "shipping_agencies";
    const { error: e2 } = await yayoSB().from(table).update({ license_path: path }).eq("id", biz.id);
    if (e2) throw e2;
    biz.license_path = path;
    licenseState(kind);
    renderPendingBanner(kind);
    el.textContent = t("lic_saved");
  } catch (e) {
    el.textContent = /column|schema|bucket|not found/i.test(e.message || "") ? t("pf_sql_hint") : t("up_fail") + " (" + (e.message || e) + ")";
  }
}

// Re-render translated content when the language changes
window.onLangChange = () => {
  if (!document.getElementById("dash-dealer").hidden) {
    renderBadge(); renderPendingBanner("dealer"); renderOverview(); renderDealerCharts(); renderListings(); renderConvoList(); renderChips();
  }
  if (!document.getElementById("dash-agency-app").hidden) {
    syncRoutesFromDOM(); syncOfficesFromDOM(); enterAgency();
  }
  if (!document.getElementById("dash-admin").hidden) adminEnter();
};

init();
