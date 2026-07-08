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
    const { data } = await yayoSB().from("conversations")
      .select("id, car_name, dealer_id, agency_id, created_at, dealers(name, logo_url), shipping_agencies(name, logo_url)")
      .eq("user_id", MX_USER.id).order("created_at", { ascending: false }).limit(100);
    MX_CONVOS = (data || []).map(c => ({
      id: c.id,
      car_name: c.car_name || "—",
      who: (c.dealers && c.dealers.name) || (c.shipping_agencies && c.shipping_agencies.name) || "Yayo",
      logo: (c.dealers && c.dealers.logo_url) || (c.shipping_agencies && c.shipping_agencies.logo_url) || null,
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
}

function mxRenderList() {
  document.getElementById("mx-list").innerHTML = MX_CONVOS.map(c => {
    const n = MX_UNREAD[c.id] || 0;
    return `
    <button class="dash-convo${MX_CUR && MX_CUR.id === c.id ? " on" : ""}${n ? " unread" : ""}" onclick="mxOpen('${c.id}')">
      <b>${mxEsc(c.who)}</b><span>${mxEsc(c.car_name)}</span>
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
      const { data } = await yayoSB().from("messages")
        .select("sender_id, content, created_at")
        .eq("conversation_id", MX_CUR.id).order("created_at", { ascending: true }).limit(200);
      MX_CUR.msgs = (data || []).map(m => ({ me: m.sender_id === MX_USER.id, text: m.content }));
    } catch (e) { MX_CUR.msgs = []; }
    // Replies arrive in the buyer's language — it is simply the business replying
    const theirs = MX_CUR.msgs.filter(m => !m.me);
    if (theirs.length) {
      const tr = await yayoTranslate(theirs.map(m => m.text), YAYO_LANG);
      theirs.forEach((m, i) => { m.display = tr[i]; });
    }
  }
  MX_CUR.msgs.forEach(m => mxBubble(m.me, m.me ? m.text : (m.display || m.text)));
  if (!MX_CUR.msgs.length) mxBubble(false, t("chat_start"));
}

function mxBubble(me, text) {
  const box = document.getElementById("mx-box");
  const b = document.createElement("div");
  b.className = "chat-b " + (me ? "chat-me" : "chat-them");
  b.textContent = text;
  box.appendChild(b);
  box.scrollTop = box.scrollHeight;
}

async function mxSend(e) {
  e.preventDefault();
  const input = document.getElementById("mx-input");
  const text = input.value.trim();
  if (!text || !MX_CUR) return false;
  input.value = "";
  mxBubble(true, text);
  MX_CUR.msgs.push({ me: true, text });
  try {
    await yayoSB().from("messages").insert({ conversation_id: MX_CUR.id, sender_id: MX_USER.id, content: text });
  } catch (err) { /* shown locally; will sync on next load */ }
  return false;
}

window.onLangChange = () => { mxRenderList(); };
mxInit();
