// ═══════════════════════════════════════════════════════════════
// YAYO — offers and orders (setup.sql §52)
//
// An order is created by an ACCEPTED PRICED OFFER. The seller names a price
// and a deadline, the buyer accepts, and that acceptance is what makes the
// deal exist. There is deliberately no buyer-side "I want to buy" button: a
// dealer would just tell the buyer to press it, and the price — the one
// thing a dispute later turns on — would never be written down.
//
// An offer travels as an ordinary message, so it inherits the inbox preview,
// the unread badge, live arrival and the e-mail notification without any of
// that being rebuilt. yayoFillBubble hands any message carrying an offer_id
// to yayoRenderOffer, which is why all four chat surfaces show offers
// identically and none of them repeat this code.
// ═══════════════════════════════════════════════════════════════

const YO = { offers: new Map(), me: null };

function yoEsc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function yoMoney(n, cur) {
  const v = "$" + Math.round(Number(n) || 0).toLocaleString("fr-FR").replace(/[ ]/g, " ");
  return (cur && cur !== "USD") ? (Math.round(Number(n) || 0) + " " + cur) : v;
}
// "il reste 3 jours" / "expire aujourd'hui" — a deadline nobody can read is
// not a deadline.
function yoLeft(iso) {
  if (!iso) return "";
  const ms = new Date(iso) - new Date();
  if (ms <= 0) return t("off_expired");
  const days = Math.floor(ms / 86400000);
  if (days >= 1) return t("off_left").replace("{n}", days);
  const hours = Math.max(1, Math.floor(ms / 3600000));
  return t("off_left_h").replace("{n}", hours);
}

async function yoMe() {
  if (!YO.me) YO.me = await yayoUser();
  return YO.me;
}

async function yoFetch(id, force) {
  if (!force && YO.offers.has(id)) return YO.offers.get(id);
  try {
    const { data, error } = await yayoSB().from("offers").select("*").eq("id", id).maybeSingle();
    if (error || !data) return null;
    YO.offers.set(id, data);
    return data;
  } catch (e) { return null; }
}

// ── The card in the thread ─────────────────────────────────────────
async function yayoRenderOffer(el, offerId) {
  el.innerHTML = `<div class="yo-card yo-load"><span class="yo-skel"></span></div>`;
  const [o, me] = await Promise.all([yoFetch(offerId), yoMe()]);
  if (!o) { el.textContent = t("off_gone"); return; }
  const mine = me && String(o.sender_id) === String(me.id);   // I am the seller
  if (o.status === "accepted") yayoMarkUnlocked(o.conversation_id);
  el.innerHTML = yoCard(o, mine);
}

function yoCard(o, mine) {
  const expired = o.status === "pending" && o.valid_until && new Date(o.valid_until) < new Date();
  const state = expired ? "expired" : o.status;
  const kind = t("off_kind_" + (o.kind || "car")) || "";
  const actions = (!mine && state === "pending")
    ? `<div class="yo-acts">
         <button class="yo-no"  onclick="yayoAnswerOffer('${o.id}',false,this)">${t("off_decline")}</button>
         <button class="yo-yes" onclick="yayoAnswerOffer('${o.id}',true,this)">${t("off_accept")}</button>
       </div>`
    : "";
  const foot = state === "accepted"
    ? `<a class="yo-done" href="commandes.html">${t("off_accepted")} ›</a>`
    : state === "declined" ? `<span class="yo-state">${t("off_declined")}</span>`
    : state === "expired"  ? `<span class="yo-state">${t("off_expired")}</span>`
    : state === "cancelled" ? `<span class="yo-state">${t("off_replaced")}</span>`
    : `<span class="yo-state">${yoLeft(o.valid_until)}</span>`;

  return `
    <div class="yo-card yo-${state}">
      <div class="yo-top">
        <span class="yo-tag">${yoEsc(kind)}</span>
        ${mine ? `<span class="yo-mine">${t("off_yours")}</span>` : ""}
      </div>
      <div class="yo-price">${yoMoney(o.amount, o.currency)}</div>
      ${o.label ? `<div class="yo-what">${yoEsc(o.label)}</div>` : ""}
      ${o.note ? `<div class="yo-note">${yoEsc(o.note)}</div>` : ""}
      <div class="yo-foot">${foot}</div>
      ${actions}
    </div>`;
}

// ── The buyer answers ──────────────────────────────────────────────
async function yayoAnswerOffer(id, accept, btn) {
  const card = btn.closest(".yo-card");
  if (card) card.classList.add("yo-busy");
  [...(card ? card.querySelectorAll("button") : [])].forEach(b => b.disabled = true);
  try {
    const { data, error } = await yayoSB().rpc("yayo_respond_offer", { oid: id, accept: !!accept });
    if (error) throw error;
    const o = await yoFetch(id, true);
    if (accept) {
      yayoMarkUnlocked(o ? o.conversation_id : null);
      if (window.yayoOnOrderCreated) window.yayoOnOrderCreated(data);
    }
    if (card) card.outerHTML = yoCard(o || { id, status: accept ? "accepted" : "declined" }, false);
  } catch (e) {
    if (card) card.classList.remove("yo-busy");
    [...(card ? card.querySelectorAll("button") : [])].forEach(b => b.disabled = false);
    alert(t("off_failed") + " " + (e && e.message ? e.message : ""));
  }
}

// ── The seller makes one ───────────────────────────────────────────
// A price and a deadline, nothing else required. The note is where a dealer
// explains what the price includes — that is his sentence to write, not ours.
function yayoOfferSheet(convoId, opts) {
  const o = opts || {};
  const sheet = document.createElement("div");
  sheet.className = "yo-sheet";
  sheet.id = "yo-sheet";
  sheet.innerHTML = `
    <div class="yo-panel" role="dialog" aria-modal="true">
      <h3>${t("off_new_h")}</h3>
      <p class="yo-sub">${t("off_new_p")}</p>
      ${o.carName ? `<div class="yo-for">${yoEsc(o.carName)}</div>` : ""}
      <label class="yo-lbl" for="yo-amount">${t("off_price")}</label>
      <div class="yo-amt"><span>$</span><input id="yo-amount" type="number" inputmode="decimal"
        min="1" step="1" placeholder="0"></div>
      <label class="yo-lbl" for="yo-days">${t("off_valid")}</label>
      <select id="yo-days">
        <option value="3">${t("off_d3")}</option>
        <option value="7" selected>${t("off_d7")}</option>
        <option value="14">${t("off_d14")}</option>
        <option value="30">${t("off_d30")}</option>
      </select>
      <label class="yo-lbl" for="yo-note">${t("off_note")}</label>
      <textarea id="yo-note" rows="2" maxlength="300" placeholder="${t("off_note_ph")}"></textarea>
      <p class="yo-warn" id="yo-warn" hidden></p>
      <div class="yo-btns">
        <button class="yo-cancel" onclick="yayoOfferClose()">${t("off_cancel")}</button>
        <button class="yo-send" id="yo-send">${t("off_send")}</button>
      </div>
    </div>`;
  document.body.appendChild(sheet);
  const amount = sheet.querySelector("#yo-amount");
  setTimeout(() => amount.focus(), 60);
  sheet.addEventListener("click", e => { if (e.target === sheet) yayoOfferClose(); });
  sheet.querySelector("#yo-send").onclick = () => yoSend(convoId, o.onSent);
}
function yayoOfferClose() {
  const s = document.getElementById("yo-sheet");
  if (s) s.remove();
}
async function yoSend(convoId, onSent) {
  const sheet = document.getElementById("yo-sheet");
  if (!sheet) return;
  const warn = sheet.querySelector("#yo-warn");
  const amount = Number(sheet.querySelector("#yo-amount").value);
  const days = Number(sheet.querySelector("#yo-days").value) || 7;
  const note = sheet.querySelector("#yo-note").value.trim();
  const show = msg => { warn.textContent = msg; warn.hidden = false; };

  if (!amount || amount <= 0) return show(t("off_need_price"));
  // The note goes into the thread, so it obeys the same rule as every other
  // message: no phone numbers before there is an order (§49).
  if (note && yayoFindContacts(note).length) return show(t("chat_no_contact"));

  const btn = sheet.querySelector("#yo-send");
  btn.disabled = true; btn.textContent = t("off_sending");
  try {
    const { error } = await yayoSB().rpc("yayo_make_offer", {
      cid: convoId, p_amount: amount, p_kind: "car",
      p_listing: null, p_valid_days: days, p_note: note || null, p_label: null
    });
    if (error) throw error;
    yayoOfferClose();
    if (onSent) onSent();
  } catch (e) {
    btn.disabled = false; btn.textContent = t("off_send");
    show(t("off_failed") + " " + (e && e.message ? e.message : ""));
  }
}

// ── "Mes commandes" ────────────────────────────────────────────────
async function yayoMyOrders() {
  try {
    const { data, error } = await yayoSB().rpc("yayo_my_orders");
    if (error) throw error;
    return Array.isArray(data) ? data : [];
  } catch (e) { return []; }
}

// The menu entry appears only once an order exists. An empty "Mes commandes"
// teaches a buyer that Yayo has a page where nothing ever happens.
async function yayoOrdersMenu() {
  const links = document.querySelectorAll('[data-orders-link]');
  if (!links.length) return;
  const user = await yayoUser();
  if (!user) return;
  const orders = await yayoMyOrders();
  if (!orders.length) return;
  links.forEach(a => { a.hidden = false; });
}

// ── The page (commandes.html) ──────────────────────────────────────
async function yayoOrdersPage() {
  const wrap = document.getElementById("ord-app");
  if (!wrap) return;
  const show = id => { const e = document.getElementById(id); if (e) e.hidden = false; };
  const hide = id => { const e = document.getElementById(id); if (e) e.hidden = true; };

  const user = await yayoUser();
  hide("ord-loading");
  if (!user) return show("ord-login");

  const orders = await yayoMyOrders();
  if (!orders.length) return show("ord-empty");
  show("ord-app");
  wrap.innerHTML = orders.map(yoOrderCard).join("");
  orders.forEach(o => (o.lines || []).forEach(l => yoFillIdentity(l)));
}

// Stage 1 of contact: the accepted offer is what entitles the buyer to know
// who he is dealing with. It arrives here rather than in the chat because
// this is the page he comes back to — and it carries the warning with it,
// because a name and an address are not a reason to send money.
async function yoFillIdentity(line) {
  if (!line.conversation_id) return;
  const box = document.getElementById("ord-id-" + line.id);
  if (!box) return;
  try {
    const { data } = await yayoSB().rpc("yayo_seller_identity", { cid: line.conversation_id });
    if (!data || !data.name) return;
    const row = (label, val) => val ? `<div class="ord-id-row"><span>${yoEsc(label)}</span><b>${yoEsc(val)}</b></div>` : "";
    box.innerHTML = `
      <div class="ord-id">
        <div class="ord-id-h">${t("ord_identity_h")}</div>
        ${row(t("ord_id_name"), data.name)}
        ${row(t("ord_id_legal"), data.legal_name)}
        ${row(t("ord_id_addr"), data.address)}
        ${row(t("ord_id_phone"), data.phone)}
        ${row(t("ord_id_email"), data.email)}
        <p class="ord-id-warn">${t("ord_identity_p")}</p>
      </div>`;
    box.hidden = false;
  } catch (e) { /* §52 not run yet, or nothing to show */ }
}

function yoOrderCard(o) {
  const lines = o.lines || [];
  const wait = yayoOrderWaiting(o);
  const total = lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);
  const when = o.created_at
    ? new Date(o.created_at).toLocaleDateString(
        YAYO_LANG === "ar" ? "ar" : YAYO_LANG === "en" ? "en-GB" : "fr-FR",
        { day: "numeric", month: "long", year: "numeric" })
    : "";
  return `
    <article class="ord-card">
      <div class="ord-head">
        <div>
          <div class="ord-code">${yoEsc(o.code)}</div>
          <div class="ord-date">${yoEsc(when)}</div>
        </div>
        <span class="ord-wait${wait.you ? " ord-you" : ""}">${wait.you ? t("ord_you") + " · " : ""}${yoEsc(wait.txt)}</span>
      </div>
      ${lines.map(l => `
        <div class="ord-line">
          <span class="ord-line-k">${yoEsc(t("off_kind_" + l.kind) || l.kind)}</span>
          <span class="ord-line-t">
            <b>${yoEsc(l.label || "—")}</b>
            <span>${yoEsc(l.seller || "")}</span>
          </span>
          <span class="ord-line-a">${yoMoney(l.amount, l.currency)}</span>
        </div>
        ${yoShipHtml(l)}
        <div class="ord-id-box" id="ord-id-${yoEsc(l.id)}" hidden></div>`).join("")}
      <div class="ord-foot">
        <span class="ord-total">${t("ord_total")}<b>${yoMoney(total, "USD")}</b></span>
        ${lines[0] && lines[0].conversation_id
          ? `<a class="btn btn-ghost-dark btn-sm" href="messages.html">${t("ord_open")}</a>` : ""}
      </div>
    </article>`;
}

// The seven steps the agency reports, in order (§26).
const YO_SHIP_STEPS = ["picked_up", "container", "departed", "at_sea", "arrived", "customs", "ready"];
// Customs is not Yayo's step and not the agency's: it is cleared by the buyer
// or his broker, with the government. Saying so is the difference between a
// tracker and a promise nobody made.
const YO_SHIP_OUTSIDE = ["customs"];

// The step names already exist for suivi.html and the agency dashboard.
// Reusing them means the buyer reads the same words in both places.
function yoShipLabel(status) {
  return t("sh_st_" + status) || status || "";
}

// Where the car is, drawn from the shipment attached to the transport line.
function yoShipHtml(line) {
  if (!line.shipment_id || !line.ship_status) return "";
  const i = YO_SHIP_STEPS.indexOf(line.ship_status);
  const pct = i < 0 ? 0 : Math.round(((i + 1) / YO_SHIP_STEPS.length) * 100);
  const outside = YO_SHIP_OUTSIDE.indexOf(line.ship_status) > -1;
  const eta = line.ship_eta
    ? new Date(line.ship_eta).toLocaleDateString(
        YAYO_LANG === "ar" ? "ar" : YAYO_LANG === "en" ? "en-GB" : "fr-FR",
        { day: "numeric", month: "long" })
    : "";
  return `
    <div class="ord-ship${outside ? " ord-ship-outside" : ""}">
      <div class="ord-ship-top">
        <b>${yoEsc(yoShipLabel(line.ship_status))}</b>
        ${eta ? `<span>${t("ord_eta")} ${yoEsc(eta)}</span>` : ""}
      </div>
      <div class="ord-ship-bar"><i style="width:${pct}%"></i></div>
      ${outside ? `<div class="ord-ship-note">${t("ord_ship_outside")}</div>` : ""}
      ${line.ship_last_note ? `<div class="ord-ship-note">${yoEsc(line.ship_last_note)}</div>` : ""}
      <a class="ord-ship-link" href="suivi.html">${t("ord_ship_all")} ›</a>
    </div>`;
}

// What is this order waiting for, in one honest sentence.
function yayoOrderWaiting(order) {
  const lines = order.lines || [];
  const hasCar = lines.some(l => l.kind === "car");
  const transport = lines.find(l => l.kind === "transport");
  // Once the car is actually moving, that is the answer — a progress line
  // beats a generic "waiting for the agency" every time.
  if (transport && transport.ship_status) {
    if (transport.ship_status === "ready") return { txt: t("ord_ship_ready"), you: true };
    if (transport.ship_status === "customs") return { txt: t("ord_ship_customs"), you: true };
    return { txt: yoShipLabel(transport.ship_status), you: false };
  }
  if (hasCar && !transport) return { txt: t("ord_wait_transport"), you: true };
  if (transport && !hasCar) return { txt: t("ord_wait_car_optional"), you: false };
  if (hasCar && transport) return { txt: t("ord_wait_agency"), you: false };
  return { txt: t("ord_wait_none"), you: false };
}
