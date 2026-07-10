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

async function yayoResetPassword(email) {
  const { error } = await yayoSB().auth.resetPasswordForEmail(email, { redirectTo: yayoRedirectUrl("connexion.html") });
  return error;
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

// Make sure the logged-in auth user has a row in the legacy users table
// (conversations/favorites point there via foreign keys).
async function yayoEnsureUserRow(user) {
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
  const name = (user.user_metadata && (user.user_metadata.company || user.user_metadata.full_name)) || user.email.split("@")[0];
  document.querySelectorAll("[data-auth='login']").forEach(el => {
    el.textContent = name.length > 14 ? name.slice(0, 13) + "…" : name;
    el.href = "dashboard.html";
    // "Mes favoris" heart next to the account chip
    if (!el.parentNode.querySelector(".fav-link")) {
      const a = document.createElement("a");
      a.href = "favoris.html";
      a.className = "fav-link";
      a.textContent = "♥";
      a.title = t("nav_fav");
      el.parentNode.insertBefore(a, el);
    }
    // "Déconnexion" right after the account chip — on every page
    if (!el.parentNode.querySelector(".logout-link")) {
      const o = document.createElement("a");
      o.href = "#";
      o.className = "logout-link";
      o.title = t("logout");
      o.setAttribute("aria-label", t("logout"));
      o.innerHTML = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg>';
      o.addEventListener("click", (ev) => { ev.preventDefault(); yayoNavLogout(); });
      el.parentNode.insertBefore(o, el.nextSibling);
    }
  });
  document.querySelectorAll("[data-auth='login-mobile']").forEach(el => {
    el.innerHTML = "<b>" + t("d_title") + "</b> <span>" + name.replace(/</g, "&lt;") + "</span>";
    el.href = "dashboard.html";
    if (!el.parentNode.querySelector("[data-fav-nav]")) {
      const a = document.createElement("a");
      a.href = "favoris.html";
      a.setAttribute("data-fav-nav", "1");
      a.innerHTML = "<b>♥ " + t("nav_fav") + "</b> <span>" + t("fav_p") + "</span>";
      el.parentNode.insertBefore(a, el);
    }
    // "Déconnexion" entry at the end of the mobile menu
    if (!el.parentNode.querySelector("[data-logout-nav]")) {
      const o = document.createElement("a");
      o.href = "#";
      o.setAttribute("data-logout-nav", "1");
      o.innerHTML = "<b>" + t("logout") + "</b> <span>" + t("logout_sub") + "</span>";
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
}
document.addEventListener("DOMContentLoaded", initUnreadBadge);
