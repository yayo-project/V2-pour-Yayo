// ═══════════════════════════════════════════════
// YAYO — Dashboard (dashboard.html)
// Dealer first: stats, inventory CRUD, messages
// with Assistant Yayo suggested replies (Mode 2:
// the dealer always reviews before sending).
// ?demo=1 shows the dealer space with fake data.
// ═══════════════════════════════════════════════

const DEMO = new URLSearchParams(location.search).get("demo") === "1";
let USER = null;      // Supabase auth user (null in demo)
let DEALER = null;    // dealers row (or demo object)
let LISTINGS = [];
let CONVOS = [];
let CUR_CONVO = null;

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

  USER = await yayoUser();
  if (!USER) { location.href = "connexion.html?next=" + encodeURIComponent("dashboard.html"); return; }
  const role = (USER.user_metadata && USER.user_metadata.role) || "";

  hide("dash-loading");
  if (role === "admin") { show("dash-admin"); return; }
  if (role === "agency") { show("dash-agency"); return; }

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
      .select("id, listing_id, buyer_id, created_at, listings(car_name)")
      .eq("dealer_id", DEALER.id).order("created_at", { ascending: false }).limit(50);
    CONVOS = (data || []).map(c => ({
      id: c.id,
      car_name: (c.listings && c.listings.car_name) || "—",
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
  document.querySelectorAll(".dash-tabs button").forEach(b => b.classList.toggle("on", b.dataset.tab === name));
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
  document.getElementById("lf-photo").value = l ? (l.photo_url || "") : "";
  document.getElementById("lf-desc").value = l ? (l.description || "") : "";
  hide("lst-err");
  show("lst-form");
  document.getElementById("lf-name").focus();
}
function closeForm() { hide("lst-form"); EDIT_ID = null; }
function findListing(id) { return LISTINGS.find(l => String(l.id) === String(id)); }
function editListing(id) { const l = findListing(id); if (l) openForm(l); }

async function saveListing(e) {
  e.preventDefault();
  const payload = {
    car_name: document.getElementById("lf-name").value.trim(),
    price: parseInt(document.getElementById("lf-price").value, 10),
    year: parseInt(document.getElementById("lf-year").value, 10) || null,
    mileage: parseInt(document.getElementById("lf-km").value, 10) || null,
    condition: document.getElementById("lf-cond").value,
    color: document.getElementById("lf-color").value.trim() || null,
    photo_url: document.getElementById("lf-photo").value.trim() || null,
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
  } catch (err) {
    const el = document.getElementById("lst-err");
    el.hidden = false; el.textContent = t("au_err_generic") + (err.message || err);
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

// ── Messages ──
function renderConvoList() {
  const el = document.getElementById("msg-list");
  if (!CONVOS.length) { el.innerHTML = `<p class="dash-empty">${t("d_no_convos")}</p>`; return; }
  el.innerHTML = CONVOS.map(c => `
    <button class="dash-convo${CUR_CONVO && CUR_CONVO.id === c.id ? " on" : ""}" onclick="openConvo('${c.id}')">
      <b>${escapeHtml(c.car_name)}</b><span>${escapeHtml(c.buyer)}</span>
    </button>`).join("");
}

// Suggested replies — Assistant Yayo Mode 2: dealer reviews, then sends
function renderChips() {
  document.getElementById("msg-chips").innerHTML = ["as_avail", "as_nego", "as_photo", "as_ship"]
    .map(k => `<button type="button" onclick="useChip('${k}')">${t(k)}</button>`).join("");
}
function useChip(key) {
  const input = document.getElementById("msg-input");
  input.value = t(key);
  input.focus();
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
  CUR_CONVO.msgs.forEach(m => addMsg(m.me, m.text));
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

// Re-render translated content when the language changes
window.onLangChange = () => {
  if (document.getElementById("dash-dealer").hidden) return;
  renderBadge(); renderOverview(); renderListings(); renderConvoList(); renderChips();
};

init();
