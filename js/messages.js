// ═══════════════════════════════════════════════
// YAYO — Buyer inbox (messages.html)
// All conversations of the logged-in buyer with
// dealers and agencies. Two-way translation:
// replies always arrive in the buyer's language.
// Unread badges clear when a conversation opens.
// ═══════════════════════════════════════════════

let MX_USER = null;
let MX_CONVOS = [];
let MX_UNREAD = {};
let MX_CUR = null;

function toggleMenu() { document.getElementById("mmenu").classList.toggle("open"); }
function mxEsc(s) { return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }

async function mxInit() {
  MX_USER = await yayoUser();
  document.getElementById("mx-loading").hidden = true;
  if (!MX_USER) { document.getElementById("mx-login").hidden = false; return; }
  try {
    // WhatsApp model: last message + time live ON the conversation (trigger-
    // maintained), so the inbox is one query sorted by activity.
    const base = "id, car_name, dealer_id, agency_id, created_at, dealers(name, logo_url), shipping_agencies(name, logo_url)";
    let r = await yayoSB().from("conversations")
      .select(base + ", last_message, last_message_at, last_sender")
      .eq("user_id", MX_USER.id)
      .order("last_message_at", { ascending: false, nullsFirst: false }).limit(100);
    if (r.error) r = await yayoSB().from("conversations").select(base)
      .eq("user_id", MX_USER.id).order("created_at", { ascending: false }).limit(100);
    MX_CONVOS = (r.data || []).map(c => ({
      id: c.id,
      car_name: c.car_name || "—",
      who: (c.dealers && c.dealers.name) || (c.shipping_agencies && c.shipping_agencies.name) || "Yayo",
      logo: (c.dealers && c.dealers.logo_url) || (c.shipping_agencies && c.shipping_agencies.logo_url) || null,
      last: c.last_message || "",
      lastAt: c.last_message_at || c.created_at,
      lastMine: c.last_sender === MX_USER.id,
      msgs: null
    }));
  } catch (e) { MX_CONVOS = []; }
  try {
    const { data } = await yayoSB().rpc("yayo_unread_counts");
    (data || []).forEach(r => { MX_UNREAD[r.conversation_id] = Number(r.unread || 0); });
  } catch (e) { /* setup.sql §12 not run yet */ }

  if (!MX_CONVOS.length) { document.getElementById("mx-empty").hidden = false; return; }
  document.getElementById("mx-app").hidden = false;
  mxRenderList();
  mxShipLink();
}

// "🚢 Suivi de vos expéditions" button appears once the buyer has a shipment
async function mxShipLink() {
  try {
    const { data } = await yayoSB().from("shipments").select("id").eq("user_id", MX_USER.id).limit(1);
    if (!data || !data.length || document.getElementById("mx-ship-link")) return;
    const a = document.createElement("a");
    a.id = "mx-ship-link";
    a.href = "suivi.html";
    a.className = "btn btn-ghost-dark";
    a.style.cssText = "display:inline-block;margin-bottom:14px";
    a.textContent = "🚢 " + t("sv_h").replace("🚢 ", "");
    const app = document.getElementById("mx-app");
    app.parentNode.insertBefore(a, app);
  } catch (e) { /* table not created yet */ }
}

// "14:32" today, "12/07" before — like every messaging app
function mxTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toDateString() === new Date().toDateString()
    ? d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" });
}
function mxPreview(c) {
  if (!c.last) return "";
  const txt = c.last === "📷" ? t("chat_photo_lbl") : c.last;
  return (c.lastMine ? t("convo_you") + " " : "") + txt;
}
function mxRenderList() {
  document.getElementById("mx-list").innerHTML = MX_CONVOS.map(c => {
    const n = MX_UNREAD[c.id] || 0;
    return `
    <button class="dash-convo${MX_CUR && MX_CUR.id === c.id ? " on" : ""}${n ? " unread" : ""}" onclick="mxOpen('${c.id}')">
      <b>${mxEsc(c.who)} <em class="convo-time">${mxTime(c.lastAt)}</em></b>
      <span>${mxEsc(c.car_name)}</span>
      ${c.last ? `<span class="convo-prev">${mxEsc(mxPreview(c)).slice(0, 70)}</span>` : ""}
      ${n ? `<i class="unread-dot">${n}</i>` : ""}
    </button>`;
  }).join("");
}

async function mxOpen(id) {
  MX_CUR = MX_CONVOS.find(c => String(c.id) === String(id));
  if (!MX_CUR) return;
  if (MX_UNREAD[id]) {
    MX_UNREAD[id] = 0;
    try { yayoSB().rpc("yayo_mark_read", { cid: id }).then(() => { if (window.yayoRefreshUnread) window.yayoRefreshUnread(); }, () => {}); } catch (e) {}
  }
  mxRenderList();
  document.getElementById("mx-pick").hidden = true;
  document.getElementById("mx-thread").hidden = false;
  document.getElementById("mx-title").textContent = MX_CUR.who + " · " + MX_CUR.car_name;
  const box = document.getElementById("mx-box");
  box.innerHTML = "";

  if (MX_CUR.msgs === null) {
    try {
      const data = await yayoLoadMessages(MX_CUR.id, 200);
      MX_CUR.msgs = data.map(m => ({ me: m.sender_id === MX_USER.id, text: m.content, img: m.image_url }));
    } catch (e) { MX_CUR.msgs = []; }
    // Replies arrive in the buyer's language — it is simply the business replying
    const theirs = MX_CUR.msgs.filter(m => !m.me && !m.img);
    if (theirs.length) {
      const tr = await yayoTranslate(theirs.map(m => m.text), YAYO_LANG);
      theirs.forEach((m, i) => { m.display = tr[i]; });
    }
  }
  MX_CUR.msgs.forEach(m => mxBubble(m.me, m.me ? m.text : (m.display || m.text), m.img));
  if (!MX_CUR.msgs.length) mxBubble(false, t("chat_start"));

  // Live: new replies pop in instantly (translated), no refresh needed
  if (window.__mxLiveOff) window.__mxLiveOff();
  window.__mxLiveOff = yayoLiveMessages(MX_CUR.id, MX_USER.id, async m => {
    let text = m.content;
    if (!m.image_url) {
      const tr = await yayoTranslate([m.content], YAYO_LANG);
      text = tr[0] || m.content;
    }
    MX_CUR.msgs.push({ me: false, text: m.content, display: text, img: m.image_url });
    mxBubble(false, text, m.image_url);
    try { yayoSB().rpc("yayo_mark_read", { cid: MX_CUR.id }).then(() => {}, () => {}); } catch (e) {}
  });
}

function mxBubble(me, text, img) {
  const box = document.getElementById("mx-box");
  const b = document.createElement("div");
  b.className = "chat-b " + (me ? "chat-me" : "chat-them");
  yayoFillBubble(b, text, img);
  box.appendChild(b);
  box.scrollTop = box.scrollHeight;
  return b;
}

// 📷 buyer sends a photo in the conversation
async function mxSendPhoto(files) {
  const f = files && files[0];
  document.getElementById("mx-photo").value = "";
  if (!f || !MX_CUR) return;
  const b = mxBubble(true, t("chat_photo_sending"));
  try {
    const url = await yayoSendChatPhoto(MX_CUR.id, f);
    yayoFillBubble(b, "", url);
    MX_CUR.msgs.push({ me: true, text: "📷", img: url });
  } catch (e) {
    yayoFillBubble(b, t("chat_photo_fail"));
  }
}

async function mxSend(e) {
  e.preventDefault();
  const input = document.getElementById("mx-input");
  const text = input.value.trim();
  if (!text || !MX_CUR) return false;
  input.value = "";
  const bubble = mxBubble(true, text);
  MX_CUR.msgs.push({ me: true, text });
  try {
    const { error } = await yayoSB().from("messages").insert({ conversation_id: MX_CUR.id, sender_id: MX_USER.id, content: text });
    if (error) throw error;
    yayoNotifyMessage(MX_CUR.id);
  } catch (err) {
    bubble.classList.add("chat-failed");
    mxBubble(false, t("chat_send_fail") + " (" + yayoErrMsg(err) + ")");
    console.error("[Yayo] message send failed:", err);
  }
  return false;
}

// LIVE: a message in another conversation bumps its badge instantly; a brand
// new conversation makes the whole list rebuild — no refresh needed.
window.yayoOnNewMessage = (m) => {
  const c = MX_CONVOS.find(x => String(x.id) === String(m.conversation_id));
  if (c) {
    c.last = m.image_url ? "📷" : (m.content || "");
    c.lastAt = m.created_at;
    c.lastMine = false;
    MX_CONVOS.sort((a, b) => new Date(b.lastAt || 0) - new Date(a.lastAt || 0));
    if (!(MX_CUR && String(MX_CUR.id) === String(m.conversation_id))) {
      MX_UNREAD[c.id] = (MX_UNREAD[c.id] || 0) + 1; // open thread paints + reads itself
    }
    mxRenderList();
  } else mxInit(); // brand-new conversation → rebuild the list
};

window.onLangChange = () => { mxRenderList(); };
mxInit();
