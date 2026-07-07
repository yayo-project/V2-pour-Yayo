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

// Swap "Connexion" links for the account chip when logged in.
// The chip opens the dashboard; sign-out lives inside the dashboard.
async function initAuthNav() {
  const user = await yayoUser();
  if (!user) return;
  const name = (user.user_metadata && (user.user_metadata.company || user.user_metadata.full_name)) || user.email.split("@")[0];
  document.querySelectorAll("[data-auth='login']").forEach(el => {
    el.textContent = name.length > 14 ? name.slice(0, 13) + "…" : name;
    el.href = "dashboard.html";
  });
  document.querySelectorAll("[data-auth='login-mobile']").forEach(el => {
    el.innerHTML = "<b>" + t("d_title") + "</b> <span>" + name.replace(/</g, "&lt;") + "</span>";
    el.href = "dashboard.html";
  });
}
document.addEventListener("DOMContentLoaded", initAuthNav);
