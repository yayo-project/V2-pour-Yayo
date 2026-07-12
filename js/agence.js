// ═══════════════════════════════════════════════
// YAYO — Agency public profile (agence.html?id=X)
// Fiverr-style page: about, real addresses, routes
// with promises, buyer reviews, in-app chat with
// two-way translation. No phone numbers shown.
// ═══════════════════════════════════════════════

const P = new URLSearchParams(location.search);
const AG_ID = P.get("id") || "";
const FROM_CAR = P.get("car") || "";
let AG = null;
let CONVO = null;

function fmt(n) { return "$" + Math.round(n).toLocaleString("fr-FR").replace(/ /g, " "); }
function escapeHtml(s) { return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
function toggleMenu() { document.getElementById("mmenu").classList.toggle("open"); }
const isDemo = () => AG_ID.startsWith("ag-demo");

async function loadAgency() {
  if (isDemo()) {
    AG = (window.YAYO_DEMO_AGENCIES || []).find(a => a.id === AG_ID) || null;
  } else {
    try {
      let { data } = await yayoSB().from("shipping_agencies")
        .select("*").eq("id", AG_ID).maybeSingle();
      // pending/suspended agencies are not public until admin approval
      if (data && (!data.verified || data.suspended)) data = null;
      if (data) {
        let d = data.routes;
        if (typeof d === "string") { try { d = JSON.parse(d); } catch (e) { d = null; } }
        AG = {
          id: data.id, name: data.name, verified: data.verified, country: data.country,
          logo_url: data.logo_url || null,
          photos: yayoPhotoList(data.photos),
          routes: Array.isArray(d) ? d : (d && Array.isArray(d.routes) ? d.routes : []),
          meta: (d && !Array.isArray(d) && typeof d === "object") ? d : {}
        };
      }
    } catch (e) { AG = null; }
  }
  render();
}

async function render() {
  document.getElementById("ap-loading").hidden = true;
  if (!AG) { document.getElementById("ap-notfound").hidden = false; return; }
  document.getElementById("ap-content").hidden = false;
  document.title = AG.name + " — Yayo";
  const m = AG.meta || {};

  document.getElementById("ap-name").textContent = AG.name;
  document.getElementById("ap-logo").innerHTML = yayoAvatarHtml(AG.name, AG.logo_url, true);
  // Operation photos (trucks, warehouse, loading…) — honest placeholder if none yet
  const pics = AG.photos || [];
  document.getElementById("ap-gallery").innerHTML = pics.length
    ? `<div class="gal-row">${pics.map(u => `<img src="${escapeHtml(u)}" alt="" loading="lazy" onerror="this.remove()">`).join("")}</div>`
    : `<div class="gal-empty" data-i18n="ap_gallery_empty">${t("ap_gallery_empty")}</div>`;
  const b = document.getElementById("ap-badge");
  b.className = AG.verified ? "vpill" : "dash-badge wait";
  b.innerHTML = AG.verified ? "<b>" + t("ag_verified") + "</b>" + yayoVBadge() : t("d_not_verified");
  // Full-width "Vérifié par Yayo" band on the contact card + above the chat
  document.getElementById("ap-trust").innerHTML = AG.verified ? yayoVBand(t("vband_a")) : "";
  const trust = document.getElementById("ap-chat-trust");
  if (trust) trust.innerHTML = AG.verified
    ? yayoVBand(escapeHtml(AG.name) + " — " + t("vband_chat"))
    : "";

  const meta = [];
  if (m.years) meta.push(m.years + " " + t("ap_years"));
  if (m.languages) meta.push(t("ap_langs") + " : " + m.languages);
  if (AG.country) meta.push("🇦🇪 " + AG.country);
  document.getElementById("ap-meta").innerHTML = meta.map(x => `<span>${escapeHtml(x)}</span>`).join("");

  document.getElementById("ap-desc").textContent = m.description || t("desc_fallback");
  document.getElementById("ap-pickup").textContent = m.pickup || "—";

  const offices = m.offices || {};
  document.getElementById("ap-offices").innerHTML = Object.keys(offices).length
    ? Object.keys(offices).map(c => {
        const d = YAYO_CONFIG.DESTINATIONS[c];
        return `<div class="ap-addr"><b>${d ? d.flag + " " + d.name : escapeHtml(c)}</b>${escapeHtml(offices[c])}</div>`;
      }).join("")
    : `<p class="rv-none">—</p>`;

  document.getElementById("ap-routes").innerHTML = (AG.routes || []).filter(r => r.price > 0).map(r => {
    const d = YAYO_CONFIG.DESTINATIONS[r.city];
    return `
    <div class="ap-route">
      <div>
        <b>${d ? d.flag + " Dubai → " + d.name : escapeHtml(r.city)}</b>
        ${r.promise ? `<div class="ap-promise">« ${escapeHtml(r.promise)} »</div>` : ""}
      </div>
      <b>${fmt(r.price)}${r.days ? ` · ${r.days} ${t("ct_days")}` : ""}</b>
    </div>`;
  }).join("") || `<p class="rv-none">—</p>`;

  // rating summary in the header + full reviews widget
  if (!isDemo()) {
    const rv = await yayoReviews("agency", AG.id);
    document.getElementById("ap-rv-mini").innerHTML = reviewSummaryHtml(rv);
  } else {
    document.getElementById("ap-rv-mini").innerHTML = `<span class="rv-mini rv-mini-none">${t("rv_none_short")}</span>`;
  }
  renderReviewsWidget("ap-reviews", "agency", AG.id);
}

// ── In-app chat with the agency (same two-way translation as dealers) ──
async function openAgChat() {
  const user = await yayoUser();
  if (!user) {
    location.href = "connexion.html?next=" + encodeURIComponent("agence.html" + location.search);
    return;
  }
  const panel = document.getElementById("ap-chat");
  panel.hidden = false;
  document.getElementById("ap-contact").style.display = "none";

  if (isDemo()) {
    addBubble("yayo", t("ag_chat_demo"));
    return;
  }
  try {
    const sb = yayoSB();
    await yayoEnsureUserRow(user);
    let { data: convo } = await sb.from("conversations")
      .select("id").eq("agency_id", AG.id).eq("user_id", user.id).maybeSingle();
    if (!convo) {
      const ins = await sb.from("conversations")
        .insert({ agency_id: AG.id, user_id: user.id, car_name: FROM_CAR ? ("transport · " + FROM_CAR) : "transport", status: "open" })
        .select("id").single();
      convo = ins.data;
    }
    CONVO = convo;
    if (!CONVO) throw new Error("no convo");
    const list = await yayoLoadMessages(CONVO.id, 100);
    const theirs = list.filter(m => m.sender_id !== user.id && !m.image_url);
    if (theirs.length) {
      const tr = await yayoTranslate(theirs.map(m => m.content), YAYO_LANG);
      theirs.forEach((m, i) => { m.display = tr[i]; });
    }
    list.forEach(m => addBubble(m.sender_id === user.id ? "me" : "them", m.display || m.content, m.image_url));
    if (!list.length) addBubble("yayo", t("chat_start"));
    // Live: the agency's replies appear instantly, translated
    if (window.__agLiveOff) window.__agLiveOff();
    window.__agLiveOff = yayoLiveMessages(CONVO.id, user.id, async m => {
      if (m.image_url) { addBubble("them", "", m.image_url); return; }
      const tr = await yayoTranslate([m.content], YAYO_LANG);
      addBubble("them", tr[0] || m.content);
    });
  } catch (e) {
    console.error("[Yayo] openAgChat failed:", e);
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

// 📷 send a photo in the agency chat
async function sendChatPhoto(files) {
  const f = files && files[0];
  document.getElementById("chat-photo").value = "";
  if (!f) return;
  if (isDemo() || !CONVO) {
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
  if (isDemo()) {
    setTimeout(() => addBubble("yayo", t("chat_demo_reply")), 600);
    return false;
  }
  // Real agency: a failed message must never look sent.
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

window.onLangChange = () => { if (AG) render(); };

loadAgency();
