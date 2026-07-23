// ═══════════════════════════════════════════════
// YAYO — Car requests ("Demande de voiture")
// A buyer searches for a car that isn't on Yayo yet. Instead of
// losing them, we capture what they want and tell them when a
// match appears. The founder gets a live map of demand.
//   • openRequest(prefill)   — the modal (shared, injected once)
//   • reqParsePrefill(query) — turn a search into make/model/budget/city
//   • initMyRequests()       — "Mes demandes" on messages.html
// Loaded on acheter.html (search results) and messages.html.
// ═══════════════════════════════════════════════

// Makes seen in the Dubai → Africa corridor (kept in sync with the listing form).
const REQ_MAKES = ["Toyota", "Lexus", "Nissan", "Mitsubishi", "Honda", "Hyundai", "Kia",
  "Mercedes-Benz", "BMW", "Audi", "Volkswagen", "Porsche", "Land Rover", "Jaguar", "Jeep",
  "Ford", "Chevrolet", "GMC", "Dodge", "Cadillac", "Mazda", "Suzuki", "Isuzu", "Subaru",
  "Peugeot", "Renault", "Ferrari", "Lamborghini", "Bentley", "Rolls-Royce", "Maserati",
  "Tesla", "BYD", "Changan", "Chery", "Geely", "Haval", "MG"];

let REQ_USER = null;      // resolved when the modal opens
let MY_REQS = [];         // the logged-in buyer's own requests

function reqEsc(s) { return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
function reqCityName(k) { const d = (YAYO_CONFIG.DESTINATIONS || {})[k]; return (d && d.name) || k || ""; }
function reqCityKeys() { return Object.keys(YAYO_CONFIG.DESTINATIONS || {}).filter(k => k !== "dubai"); }

// Turn a raw search ("Prado", "Land Cruiser 2020", "$18000 kinshasa") into a
// best-guess prefill. Never blocks — anything it can't read stays empty.
function reqParsePrefill(query) {
  const out = { q: query || "" };
  let rest = (query || "").trim();

  // budget: a $-tagged or thousands-separated number, or a plain 5–7 digit number.
  // A bare 4-digit number (e.g. 2020) is a model YEAR, not a budget — leave it in the model.
  const m = rest.match(/\$\s*([\d .,]{3,10}\d)|\b(\d{1,3}(?:[ .,]\d{3})+)\b|\b(\d{5,7})\b/);
  if (m) {
    const amount = parseInt((m[1] || m[2] || m[3]).replace(/[^\d]/g, ""), 10);
    if (amount >= 3000 && amount <= 2000000) { out.budget = amount; rest = rest.replace(m[0], " "); }
  }
  // destination city
  for (const k of reqCityKeys()) {
    const re = new RegExp("\\b" + k + "\\b", "ig");
    if (re.test(rest)) { out.city = k; rest = rest.replace(re, " "); }
  }
  // make (first known make found)
  const low = " " + rest.toLowerCase() + " ";
  const make = REQ_MAKES.find(mk => low.includes(" " + mk.toLowerCase() + " ") || low.includes(" " + mk.toLowerCase().split(/[-\s]/)[0] + " "));
  if (make) { out.make = make; rest = rest.replace(new RegExp(make.split(/[-\s]/)[0], "i"), " "); }
  // whatever's left is the model (keeps a year like 2020)
  const model = rest.replace(/\s{2,}/g, " ").trim();
  if (model && model.length <= 50) out.model = model;
  return out;
}

function reqMakeOptions(current) {
  const list = REQ_MAKES.slice();
  if (current && !list.some(mk => mk.toLowerCase() === current.toLowerCase())) list.unshift(current);
  return `<option value="">${t("req_make_ph")}</option>`
    + list.map(mk => `<option${current && mk.toLowerCase() === current.toLowerCase() ? " selected" : ""}>${reqEsc(mk)}</option>`).join("")
    + `<option value="__other">${t("req_make_other")}</option>`;
}
function reqCityOptions(current) {
  return `<option value="">${t("req_city_ph")}</option>`
    + reqCityKeys().map(k => `<option value="${k}"${current === k ? " selected" : ""}>${reqEsc(reqCityName(k))}</option>`).join("");
}

async function openRequest(prefill) {
  prefill = prefill || {};
  let ov = document.getElementById("req-overlay");
  if (!ov) {
    ov = document.createElement("div");
    ov.id = "req-overlay";
    ov.className = "rp-overlay";
    ov.innerHTML = `
      <div class="rp-modal" role="dialog" aria-modal="true">
        <button type="button" class="rp-close" aria-label="✕" onclick="closeRequest()">✕</button>
        <h3>${t("req_h")}</h3>
        <p class="rp-sub">${t("req_p")}</p>
        <form onsubmit="return submitRequest(event)">
          <div class="req-row">
            <div><label for="req-make">${t("req_make")}</label><select id="req-make"></select></div>
            <div><label for="req-model">${t("req_model")}</label><input id="req-model" type="text" maxlength="60" placeholder="${t("req_model_ph")}"></div>
          </div>
          <div id="req-other-row" hidden><label for="req-make-other">${t("req_make")}</label><input id="req-make-other" type="text" maxlength="40" placeholder="${t("req_make_other_ph")}"></div>
          <div class="req-row">
            <div><label for="req-budget">${t("req_budget")}</label><input id="req-budget" type="text" inputmode="numeric" maxlength="12" placeholder="${t("req_budget_ph")}"></div>
            <div><label for="req-city">${t("req_city")}</label><select id="req-city"></select></div>
          </div>
          <label for="req-note">${t("req_note")}</label>
          <textarea id="req-note" rows="2" maxlength="500" placeholder="${t("req_note_ph")}"></textarea>
          <div id="req-contact-row" hidden>
            <label for="req-contact">${t("req_contact")}</label>
            <input id="req-contact" type="text" maxlength="120" placeholder="${t("req_contact_ph")}">
          </div>
          <input id="req-source" type="hidden">
          <p class="auth-error" id="req-err" hidden></p>
          <div class="rp-actions">
            <button type="submit" class="btn btn-solid" id="req-send">${t("req_send")}</button>
            <button type="button" class="btn btn-ghost-dark" onclick="closeRequest()">${t("d_cancel")}</button>
          </div>
        </form>
        <p class="rp-done" id="req-done" hidden>✓ ${t("req_done")}</p>
      </div>`;
    ov.addEventListener("click", ev => { if (ev.target === ov) closeRequest(); });
    document.body.appendChild(ov);
    // reveal the free-text make field when "Autre" is chosen
    ov.addEventListener("change", ev => {
      if (ev.target && ev.target.id === "req-make")
        document.getElementById("req-other-row").hidden = ev.target.value !== "__other";
    });
  }
  // (re)fill from the prefill each open
  document.getElementById("req-make").innerHTML = reqMakeOptions(prefill.make);
  document.getElementById("req-city").innerHTML = reqCityOptions(prefill.city);
  document.getElementById("req-other-row").hidden = true;
  document.getElementById("req-make-other").value = "";
  document.getElementById("req-model").value = prefill.model || "";
  document.getElementById("req-budget").value = prefill.budget ? String(prefill.budget) : "";
  document.getElementById("req-note").value = "";
  document.getElementById("req-source").value = prefill.q || "";
  document.getElementById("req-err").hidden = true;
  document.querySelector("#req-overlay form").hidden = false;
  document.getElementById("req-done").hidden = true;
  document.getElementById("req-send").disabled = false;
  ov.classList.add("open");

  // logged-in buyers don't need to type a contact — we already have them
  REQ_USER = await yayoUser();
  document.getElementById("req-contact-row").hidden = !!REQ_USER;
}

function closeRequest() {
  const ov = document.getElementById("req-overlay");
  if (ov) ov.classList.remove("open");
}

async function submitRequest(e) {
  e.preventDefault();
  const err = document.getElementById("req-err");
  err.hidden = true;
  const btn = document.getElementById("req-send");

  let make = document.getElementById("req-make").value;
  if (make === "__other") make = document.getElementById("req-make-other").value.trim();
  const model = document.getElementById("req-model").value.trim();
  const budget = parseInt((document.getElementById("req-budget").value || "").replace(/[^\d]/g, ""), 10);
  const city = document.getElementById("req-city").value || null;
  const note = document.getElementById("req-note").value.trim();
  const source_q = document.getElementById("req-source").value || null;

  if (!make && !model) { err.hidden = false; err.textContent = t("req_err_empty"); return false; }

  const user = REQ_USER || await yayoUser();
  let contact = user ? (user.email || user.phone || null) : document.getElementById("req-contact").value.trim();
  if (!user && !contact) { err.hidden = false; err.textContent = t("req_err_contact"); return false; }

  btn.disabled = true;
  try {
    const { error } = await yayoSB().from("car_requests").insert({
      user_id: user ? user.id : null,
      make: make || null,
      model: model || null,
      budget_usd: isNaN(budget) ? null : budget,
      city: city,
      note: note || null,
      contact: contact || null,
      source_q: source_q
    });
    if (error) throw error;
    if (typeof yayoNotifyAdmin === "function")
      yayoNotifyAdmin("car_request", [make, model].filter(Boolean).join(" "),
        [isNaN(budget) ? null : "≤ $" + budget, city ? reqCityName(city) : null].filter(Boolean).join(" · "));
    document.querySelector("#req-overlay form").hidden = true;
    document.getElementById("req-done").hidden = false;
    if (typeof yayoTrack === "function") yayoTrack("car_request", { city: city || "" });
    setTimeout(closeRequest, 2600);
    if (typeof initMyRequests === "function" && document.getElementById("mreq-list")) initMyRequests();
  } catch (ex) {
    err.hidden = false;
    err.textContent = t("au_err_generic") + (typeof yayoErrMsg === "function" ? yayoErrMsg(ex) : (ex.message || ex));
    btn.disabled = false;
  }
  return false;
}

// ── "Mes demandes" — the buyer's own list on messages.html ──
async function initMyRequests() {
  const wrap = document.getElementById("mx-requests");
  if (!wrap) return;
  const user = await yayoUser();
  if (!user) { wrap.hidden = true; return; }
  try {
    const { data, error } = await yayoSB().from("car_requests")
      .select("*").eq("user_id", user.id).order("created_at", { ascending: false });
    if (error) throw error;
    MY_REQS = data || [];
  } catch (e) { MY_REQS = []; }
  renderMyRequests();
}

function renderMyRequests() {
  const wrap = document.getElementById("mx-requests");
  const list = document.getElementById("mreq-list");
  if (!wrap || !list) return;
  if (!MY_REQS.length) { wrap.hidden = true; return; }
  wrap.hidden = false;
  list.innerHTML = MY_REQS.map(r => {
    const found = r.status === "satisfait";
    const pill = found ? ["active", t("myreq_st_found")] : ["sold", t("myreq_st_open")];
    const title = [r.make, r.model].filter(Boolean).join(" ") || t("myreq_any");
    const bits = [r.budget_usd ? "≤ " + yayoFmt(r.budget_usd) : null, r.city ? reqCityName(r.city) : null].filter(Boolean).join(" · ");
    return `
    <div class="mreq-card">
      <div class="mreq-main">
        <b>${reqEsc(title)}</b>
        ${bits ? `<span class="mreq-bits">${reqEsc(bits)}</span>` : ""}
      </div>
      <span class="status ${pill[0]}">${pill[1]}</span>
      <button class="mreq-del" onclick="delMyRequest('${r.id}')" aria-label="${t("myreq_del")}" title="${t("myreq_del")}">✕</button>
    </div>`;
  }).join("");
}

async function delMyRequest(id) {
  if (!confirm(t("myreq_del_confirm"))) return;
  MY_REQS = MY_REQS.filter(r => String(r.id) !== String(id));
  renderMyRequests();
  try { await yayoSB().from("car_requests").delete().eq("id", id); } catch (e) { /* re-appears on next load if it failed */ }
}

// entry point for messages.html "＋ Nouvelle demande"
function newRequest() { openRequest({}); }

document.addEventListener("DOMContentLoaded", () => { if (document.getElementById("mreq-list")) initMyRequests(); });
