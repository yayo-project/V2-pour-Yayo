// ═══════════════════════════════════════════════
// YAYO — Auth (Supabase) shared by all pages
// Singleton client + topbar account state.
// ═══════════════════════════════════════════════
function yayoSB() {
  if (!window.__yayoSB) window.__yayoSB = window.supabase.createClient(YAYO_CONFIG.SUPABASE_URL, YAYO_CONFIG.SUPABASE_KEY);
  return window.__yayoSB;
}

async function yayoUser() {
  try { const { data } = await yayoSB().auth.getUser(); return data.user || null; }
  catch (e) { return null; }
}

async function yayoSignInGoogle(next) {
  const redirectTo = location.origin + location.pathname.replace(/[^/]*$/, "") + (next || "index.html");
  const { error } = await yayoSB().auth.signInWithOAuth({ provider: "google", options: { redirectTo } });
  return error;
}

async function yayoSignInEmail(email, password) {
  const { error } = await yayoSB().auth.signInWithPassword({ email, password });
  return error;
}

async function yayoSignUpEmail(email, password, meta) {
  const { data, error } = await yayoSB().auth.signUp({ email, password, options: { data: meta || {} } });
  return { data, error };
}

async function yayoSignOut() {
  await yayoSB().auth.signOut();
  location.reload();
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
  });
}
document.addEventListener("DOMContentLoaded", initAuthNav);
