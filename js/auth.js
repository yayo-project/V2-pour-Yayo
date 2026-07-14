// ═══════════════════════════════════════════════
// YAYO — Auth (Supabase) shared by all pages
// Singleton client + topbar account state.
// ═══════════════════════════════════════════════
function yayoSB() {
  if (!window.__yayoSB) window.__yayoSB = window.supabase.createClient(YAYO_CONFIG.SUPABASE_URL, YAYO_CONFIG.SUPABASE_KEY, {
    // Session survives tab close / reload / navigation. Only an explicit
    // logout (or a truly expired refresh token) ends it.
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storage: window.localStorage }
  });
  return window.__yayoSB;
}

async function yayoUser() {
  // Read the session saved in the browser (no network round-trip). The old
  // getUser() pinged Supabase on every page load — one slow/failed request
  // and the whole site painted "logged out" even though the session was fine.
  try { const { data } = await yayoSB().auth.getSession(); return (data.session && data.session.user) || null; }
  catch (e) { return null; }
}

// Always send auth emails/OAuth back to the site the user is on right now
// (deploy preview, yayo.digital, localhost) — never a hardcoded domain.
function yayoRedirectUrl(page) {
  return location.origin + location.pathname.replace(/[^/]*$/, "") + (page || "index.html");
}

async function yayoSignInGoogle(next) {
  const { error } = await yayoSB().auth.signInWithOAuth({ provider: "google", options: { redirectTo: yayoRedirectUrl(next) } });
  return error;
}

async function yayoSignInEmail(email, password) {
  const { error } = await yayoSB().auth.signInWithPassword({ email, password });
  return error;
}

async function yayoSignUpEmail(email, password, meta) {
  const { data, error } = await yayoSB().auth.signUp({
    email, password,
    options: { data: meta || {}, emailRedirectTo: yayoRedirectUrl("connexion.html") }
  });
  return { data, error };
}

// Pull a human-readable message out of any Supabase/fetch error.
// Some failures arrive as an object whose default string form is "{}" —
// dig for the real text so the user (and console) never see an empty error.
function yayoErrMsg(e) {
  if (!e) return "";
  if (typeof e === "string") return e;
  const m = e.message || e.error_description || e.error || e.msg || e.details || "";
  if (m && m !== "{}") return String(m) + (e.status ? " (code " + e.status + ")" : "");
  if (e.name || e.status) return (e.name || "error") + (e.status ? " (HTTP " + e.status + ")" : "");
  try {
    const s = JSON.stringify(e, Object.getOwnPropertyNames(e));
    if (s && s !== "{}") return s;
  } catch (x) { /* circular */ }
  return "network error";
}

// Direct call to the recover endpoint: supabase-js swallows the server's
// error body on 5xx (we saw message "{}"), so read the real msg ourselves.
async function yayoResetPassword(email) {
  const redirectTo = yayoRedirectUrl("connexion.html");
  try {
    const r = await fetch(YAYO_CONFIG.SUPABASE_URL + "/auth/v1/recover?redirect_to=" + encodeURIComponent(redirectTo), {
      method: "POST",
      headers: { apikey: YAYO_CONFIG.SUPABASE_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ email })
    });
    if (r.ok) return null;
    let body = {};
    try { body = await r.json(); } catch (x) { /* non-JSON body */ }
    const msg = body.msg || body.message || body.error_description || body.error || ("HTTP " + r.status);
    console.error("[Yayo] resetPasswordForEmail failed:", r.status, body, "redirectTo:", redirectTo);
    return { message: msg, status: r.status, error_id: body.error_id };
  } catch (e) {
    console.error("[Yayo] resetPasswordForEmail threw:", e, "redirectTo:", redirectTo);
    return e;
  }
}

// ── Phone login (SMS one-time code, no password) ──
// Needs an SMS provider configured in Supabase (Auth → Providers → Phone).
async function yayoSendSmsCode(phone) {
  const { error } = await yayoSB().auth.signInWithOtp({ phone });
  return error;
}
async function yayoVerifySmsCode(phone, code) {
  const { data, error } = await yayoSB().auth.verifyOtp({ phone, token: code, type: "sms" });
  return { data, error };
}

// Where "home" is after login: dealers/agencies/admins land on their dashboard
function yayoHomeFor(user) {
  const role = (user && user.user_metadata && user.user_metadata.role) || "";
  return (role === "dealer" || role === "agency" || role === "admin") ? "dashboard.html" : "index.html";
}

async function yayoSignOut() {
  try { await yayoSB().auth.signOut(); } catch (e) { /* clear locally anyway */ }
  location.href = "index.html";
}

// Header logout used on every page (confirm first, then out + home)
async function yayoNavLogout() {
  if (confirm(t("logout_confirm"))) await yayoSignOut();
}

// Make sure the logged-in auth user has a row in the users table
// (conversations/favorites point there via foreign keys). The RPC also takes
// over an old-Yayo row holding the same email/phone — without it, returning
// users could NEVER chat (identifier conflict → no row → FK failure).
async function yayoEnsureUserRow(user) {
  try {
    const { error } = await yayoSB().rpc("yayo_ensure_user");
    if (!error) return;
  } catch (e) { /* RPC not deployed yet — fall through */ }
  try {
    await yayoSB().from("users").upsert(
      { id: user.id, identifier: user.email, login_type: "supabase", role: "user" },
      { onConflict: "id", ignoreDuplicates: true }
    );
  } catch (e) { /* row may already exist */ }
}

// Swap "Connexion" links for the account chip when logged in.
// The chip opens the dashboard; sign-out lives inside the dashboard.
async function initAuthNav() {
  const user = await yayoUser();
  if (!user) return;
  const name = (user.user_metadata && (user.user_metadata.company || user.user_metadata.full_name)) || (user.email || user.phone || "").split("@")[0];
  // Remember who this is so the login page can greet them and prefill
  // their method next time (never stores a password).
  try {
    localStorage.setItem("yayo-last-login", JSON.stringify({
      name,
      method: (user.app_metadata && user.app_metadata.provider) || "email",
      email: user.email || "",
      phone: user.phone || ""
    }));
  } catch (e) { /* private mode */ }
  // Old-Yayo accounts: first login with the same email/number re-attaches
  // their favorites & conversations (yayo_claim_legacy RPC — setup.sql §19).
  // Fire-and-forget, once per account per device.
  try {
    const ck = "yayo-claimed-" + user.id;
    if (!localStorage.getItem(ck)) {
      localStorage.setItem(ck, "1");
      yayoSB().rpc("yayo_claim_legacy").then(() => {}, () => {});
    }
  } catch (e) { /* non-blocking */ }
  // Buyers have no dashboard — their account chip opens their messages.
  // Only dealers, agencies and admins get dashboard.html.
  const role = (user.user_metadata && user.user_metadata.role) || "";
  const isBiz = role === "dealer" || role === "agency" || role === "admin";
  const accountHome = isBiz ? "dashboard.html" : "messages.html";
  document.querySelectorAll("[data-auth='login']").forEach(el => {
    el.textContent = name.length > 14 ? name.slice(0, 13) + "…" : name;
    el.href = accountHome;
    // "Mes favoris" heart next to the account chip
    if (!el.parentNode.querySelector(".fav-link")) {
      const a = document.createElement("a");
      a.href = "favoris.html";
      a.className = "fav-link";
      a.textContent = "♥";
      a.title = t("nav_fav");
      a.setAttribute("data-i18n-title", "nav_fav");
      el.parentNode.insertBefore(a, el);
    }
    // "Déconnexion" right after the account chip — on every page
    if (!el.parentNode.querySelector(".logout-link")) {
      const o = document.createElement("a");
      o.href = "#";
      o.className = "logout-link";
      o.title = t("logout");
      o.setAttribute("data-i18n-title", "logout");
      o.setAttribute("aria-label", t("logout"));
      o.innerHTML = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg>';
      o.addEventListener("click", (ev) => { ev.preventDefault(); yayoNavLogout(); });
      el.parentNode.insertBefore(o, el.nextSibling);
    }
  });
  document.querySelectorAll("[data-auth='login-mobile']").forEach(el => {
    // data-i18n on every injected label so the language switch re-translates
    // them like the rest of the menu (they used to stay in French).
    const chipKey = isBiz ? "d_title" : "acct_title";
    el.innerHTML = "<b data-i18n='" + chipKey + "'>" + t(chipKey) + "</b> <span>" + name.replace(/</g, "&lt;") + "</span>";
    el.href = accountHome;
    if (!el.parentNode.querySelector("[data-fav-nav]")) {
      const a = document.createElement("a");
      a.href = "favoris.html";
      a.setAttribute("data-fav-nav", "1");
      a.innerHTML = "<b>♥ <span data-i18n='nav_fav'>" + t("nav_fav") + "</span></b> <span data-i18n='fav_p'>" + t("fav_p") + "</span>";
      el.parentNode.insertBefore(a, el);
    }
    // "Déconnexion" entry at the end of the mobile menu
    if (!el.parentNode.querySelector("[data-logout-nav]")) {
      const o = document.createElement("a");
      o.href = "#";
      o.setAttribute("data-logout-nav", "1");
      o.innerHTML = "<b data-i18n='logout'>" + t("logout") + "</b> <span data-i18n='logout_sub'>" + t("logout_sub") + "</span>";
      o.addEventListener("click", (ev) => { ev.preventDefault(); yayoNavLogout(); });
      el.parentNode.insertBefore(o, el.nextSibling);
    }
  });
}
document.addEventListener("DOMContentLoaded", initAuthNav);

// ── Show/hide password toggle (eye) on every password field ──
function initPasswordEyes() {
  document.querySelectorAll("input[type='password']").forEach(input => {
    if (input.dataset.eye) return;
    input.dataset.eye = "1";
    const wrap = document.createElement("span");
    wrap.className = "pw-wrap";
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pw-eye";
    btn.setAttribute("aria-label", t("au_show_pw"));
    btn.innerHTML = "👁";
    btn.addEventListener("click", () => {
      const showing = input.type === "text";
      input.type = showing ? "password" : "text";
      btn.classList.toggle("off", !showing);
      btn.setAttribute("aria-label", t(showing ? "au_show_pw" : "au_hide_pw"));
      input.focus();
    });
    wrap.appendChild(btn);
  });
}
document.addEventListener("DOMContentLoaded", initPasswordEyes);

// ── "Signaler un problème" — discreet link in every footer → reports table ──
function initReportLink() {
  const foot = document.querySelector(".footer-bottom");
  if (!foot || foot.querySelector(".report-link")) return;
  // Conditions & Confidentialité — founder-approved, linked on every page
  if (!/conditions\.html/.test(location.pathname)) {
    const c = document.createElement("a");
    c.href = "conditions.html";
    c.className = "report-link";
    c.textContent = t("f_terms");
    foot.appendChild(c);
  }
  const a = document.createElement("a");
  a.href = "#";
  a.className = "report-link";
  a.textContent = "⚑ " + t("rp_link");
  a.addEventListener("click", ev => { ev.preventDefault(); openReportModal(); });
  foot.appendChild(a);
}
document.addEventListener("DOMContentLoaded", initReportLink);

function openReportModal() {
  let ov = document.getElementById("rp-overlay");
  if (!ov) {
    ov = document.createElement("div");
    ov.id = "rp-overlay";
    ov.className = "rp-overlay";
    ov.innerHTML = `
      <div class="rp-modal" role="dialog" aria-modal="true">
        <button type="button" class="rp-close" aria-label="Fermer" onclick="closeReportModal()">✕</button>
        <h3>${t("rp_h")}</h3>
        <p class="rp-sub">${t("rp_p")}</p>
        <form onsubmit="return sendReport(event)">
          <label>${t("rp_kind")}</label>
          <select id="rp-kind">
            <option value="bug">${t("rp_k_bug")}</option>
            <option value="listing">${t("rp_k_listing")}</option>
            <option value="business">${t("rp_k_business")}</option>
            <option value="other">${t("rp_k_other")}</option>
          </select>
          <label for="rp-msg">${t("rp_msg")}</label>
          <textarea id="rp-msg" rows="4" required maxlength="1500" placeholder="${t("rp_msg_ph")}"></textarea>
          <label for="rp-contact">${t("rp_contact")}</label>
          <input id="rp-contact" type="email" maxlength="120" placeholder="${t("rp_contact_ph")}">
          <p class="auth-error" id="rp-err" hidden></p>
          <div class="rp-actions">
            <button type="submit" class="btn btn-solid" id="rp-send">${t("rp_send")}</button>
            <button type="button" class="btn btn-ghost-dark" onclick="closeReportModal()">${t("d_cancel")}</button>
          </div>
        </form>
        <p class="rp-done" id="rp-done" hidden>✓ ${t("rp_done")}</p>
      </div>`;
    ov.addEventListener("click", ev => { if (ev.target === ov) closeReportModal(); });
    document.body.appendChild(ov);
  }
  ov.classList.add("open");
}
function closeReportModal() {
  const ov = document.getElementById("rp-overlay");
  if (ov) ov.classList.remove("open");
}
async function sendReport(e) {
  e.preventDefault();
  const err = document.getElementById("rp-err");
  err.hidden = true;
  const btn = document.getElementById("rp-send");
  btn.disabled = true;
  try {
    const user = await yayoUser();
    const { error } = await yayoSB().from("reports").insert({
      url: location.href.slice(0, 400),
      kind: document.getElementById("rp-kind").value,
      message: document.getElementById("rp-msg").value.trim(),
      contact: document.getElementById("rp-contact").value.trim() || (user && user.email) || null,
      user_id: user ? user.id : null
    });
    if (error) throw error;
    yayoNotifyAdmin("new_report", document.getElementById("rp-kind").value,
      document.getElementById("rp-msg").value.trim().slice(0, 120));
    document.querySelector("#rp-overlay form").hidden = true;
    document.getElementById("rp-done").hidden = false;
    setTimeout(closeReportModal, 2500);
  } catch (ex) {
    err.hidden = false;
    err.textContent = t("au_err_generic") + yayoErrMsg(ex);
  }
  btn.disabled = false;
  return false;
}

// ── "Vous avez un nouveau message" email (Brevo via Netlify Function) ──
// Fire-and-forget after sending a chat message: the function decides who to
// notify, throttles (30 min/convo) and never blocks or breaks the chat.
function yayoNotifyMessage(convoId) {
  try {
    fetch("/.netlify/functions/notify-message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversation_id: convoId })
    }).catch(() => {});
  } catch (e) { /* offline/local — chat works regardless */ }
}

// ── Founder alert (fire-and-forget) — "a dealer just registered" etc. ──
function yayoNotifyAdmin(kind, name, detail) {
  try {
    fetch("/.netlify/functions/notify-admin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, name: name || "", detail: detail || "" })
    }).catch(() => {});
  } catch (e) { /* never blocks the user */ }
}

// ── Photos in chat (shared by all 4 chat surfaces) ──
// Upload the picked photo to Storage, then post it as a chat message.
async function yayoSendChatPhoto(convoId, file) {
  if (!file || !file.type.startsWith("image/")) throw new Error("image only");
  const user = await yayoUser();
  if (!user) throw new Error("not signed in");
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  const path = "chat/" + convoId + "/" + Date.now() + "-" + Math.random().toString(36).slice(2, 6) + "." + ext;
  const { error } = await yayoSB().storage.from("car-photos").upload(path, file, { contentType: file.type });
  if (error) throw error;
  const url = yayoSB().storage.from("car-photos").getPublicUrl(path).data.publicUrl;
  const { error: e2 } = await yayoSB().from("messages")
    .insert({ conversation_id: convoId, sender_id: user.id, content: "📷", image_url: url });
  if (e2) throw e2;
  yayoNotifyMessage(convoId);
  return url;
}

// Load a conversation's messages incl. photos; falls back gracefully while
// the image_url column (setup.sql §21) isn't created yet.
async function yayoLoadMessages(convoId, limit) {
  const sb = yayoSB();
  const q = cols => sb.from("messages").select(cols)
    .eq("conversation_id", convoId).order("created_at", { ascending: true }).limit(limit || 200);
  let r = await q("sender_id, content, created_at, image_url");
  if (r.error) r = await q("sender_id, content, created_at");
  return r.data || [];
}

// Fill a chat bubble: photo (clickable, opens full size) or plain text.
function yayoFillBubble(el, text, img) {
  if (img) {
    el.textContent = "";
    const a = document.createElement("a");
    a.href = img; a.target = "_blank"; a.rel = "noopener";
    const im = document.createElement("img");
    im.src = img; im.className = "chat-img"; im.loading = "lazy"; im.alt = "photo";
    a.appendChild(im);
    el.appendChild(a);
  } else {
    el.textContent = text;
  }
}

// ── PWA push notifications (bell in the topbar) ──
// The buyer/dealer installs Yayo, taps the bell once, and from then on their
// phone buzzes on every new message — even with the app closed.
function b64ToUint8(base64) {
  const pad = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

function pushSupported() {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

// Small toast at the bottom of the screen — clear feedback on every bell tap
// (alerts get blocked or lost inside installed PWAs; this never does).
function yayoToast(msg) {
  let el = document.getElementById("yayo-toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "yayo-toast";
    el.className = "yayo-toast";
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove("show"), 4000);
}

async function yayoEnablePush(silent) {
  if (!pushSupported() || !YAYO_CONFIG.VAPID_PUBLIC) return false;
  const user = await yayoUser();
  if (!user) return false;
  try {
    let perm = Notification.permission;
    if (perm === "default" && !silent) perm = await Notification.requestPermission();
    if (perm !== "granted") return false;

    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      if (silent) return false; // never prompt/subscribe silently
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: b64ToUint8(YAYO_CONFIG.VAPID_PUBLIC)
      });
    }
    const j = sub.toJSON();
    await yayoSB().from("push_subscriptions").upsert({
      user_id: user.id,
      email: user.email || null,
      endpoint: j.endpoint,
      p256dh: j.keys.p256dh,
      auth: j.keys.auth
    }, { onConflict: "endpoint" });
    return true;
  } catch (e) {
    console.error("[Yayo] push enable failed:", e);
    return false;
  }
}

function paintBell(on) {
  document.querySelectorAll(".bell-link").forEach(b => {
    b.classList.toggle("on", !!on);
    b.title = t(on ? "push_on" : "push_off");
  });
}

async function initPushBell() {
  const user = await yayoUser();
  if (!user || !pushSupported() || !YAYO_CONFIG.VAPID_PUBLIC) return;
  document.querySelectorAll("[data-auth='login']").forEach(el => {
    if (el.parentNode.querySelector(".bell-link")) return;
    const b = document.createElement("button");
    b.type = "button";
    b.className = "bell-link";
    b.title = t("push_off");
    b.innerHTML = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 01-3.4 0"/></svg>';
    b.addEventListener("click", async () => {
      if (Notification.permission === "denied") { yayoToast(t("push_blocked")); return; }
      // already active on this device? say so instead of doing nothing
      if (b.classList.contains("on")) { yayoToast(t("push_already")); return; }
      yayoToast(t("push_wait"));
      const ok = await yayoEnablePush(false);
      paintBell(ok);
      yayoToast(t(ok ? "push_done" : "push_fail"));
    });
    el.parentNode.insertBefore(b, el.parentNode.querySelector(".msg-link") || el);
  });
  // already enabled on this device? light the bell + refresh the stored sub
  if (Notification.permission === "granted") {
    const ok = await yayoEnablePush(true);
    paintBell(ok);
  }
}
document.addEventListener("DOMContentLoaded", initPushBell);

// ── Real-time chat (Supabase Realtime) ──
// Subscribe to new messages in ONE conversation. Returns an unsubscribe fn.
// onMsg receives the raw message row (only messages from OTHER people —
// your own sends are already painted locally).
function yayoLiveMessages(convoId, myId, onMsg) {
  try {
    const ch = yayoSB().channel("live-msgs-" + convoId)
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: "conversation_id=eq." + convoId },
        payload => {
          const m = payload.new;
          if (!m || m.sender_id === myId) return;
          onMsg(m);
        })
      .subscribe();
    return () => { try { yayoSB().removeChannel(ch); } catch (e) {} };
  } catch (e) { return () => {}; }
}

// ── Unread messages badge (both sides: buyer + dealer + agency) ──
// A ✉ icon appears in the topbar with the number of unread messages.
async function yayoUnreadTotal() {
  try {
    const { data, error } = await yayoSB().rpc("yayo_unread_counts");
    if (error || !Array.isArray(data)) return 0;
    return data.reduce((s, r) => s + Number(r.unread || 0), 0);
  } catch (e) { return 0; }
}

async function initUnreadBadge() {
  const user = await yayoUser();
  if (!user) return;
  const role = (user.user_metadata && user.user_metadata.role) || "";
  const target = (role === "dealer" || role === "agency") ? "dashboard.html?tab=messages" : "messages.html";
  const paint = n => {
    document.querySelectorAll("[data-auth='login']").forEach(el => {
      let a = el.parentNode.querySelector(".msg-link");
      if (!a) {
        a = document.createElement("a");
        a.className = "msg-link";
        a.href = target;
        a.title = t("msgs_h");
        a.setAttribute("data-i18n-title", "msgs_h");
        a.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z"/></svg><b class="msg-count" hidden></b>';
        el.parentNode.insertBefore(a, el.parentNode.querySelector(".fav-link") || el);
      }
      const c = a.querySelector(".msg-count");
      c.hidden = !n;
      c.textContent = n > 99 ? "99+" : n;
    });
  };
  const refresh = async () => paint(await yayoUnreadTotal());
  await refresh();
  setInterval(refresh, 60000);
  window.yayoRefreshUnread = refresh;

  // LIVE: any new message in one of MY conversations (RLS filters server-side)
  // updates the ✉ badge instantly on every page — no refresh needed. Pages
  // with an inbox can also hook window.yayoOnNewMessage to update their list.
  try {
    yayoSB().channel("live-unread")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, payload => {
        const m = payload.new;
        if (!m || m.sender_id === user.id) return;
        refresh();
        if (typeof window.yayoOnNewMessage === "function") window.yayoOnNewMessage(m);
      })
      .subscribe();
  } catch (e) { /* badge still refreshes every 60s */ }
}
document.addEventListener("DOMContentLoaded", initUnreadBadge);
