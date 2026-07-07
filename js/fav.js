// ═══════════════════════════════════════════════
// YAYO — Favorites (heart icon on car cards)
// Saved to the favorites table: type='car',
// market = listing id, car_name = display name.
// ═══════════════════════════════════════════════
let __favUser = null;
let __favMap = {};   // listing id → favorites row id
let __favReady = false;

async function initFavs() {
  try {
    __favUser = await yayoUser();
    if (!__favUser) { __favReady = true; return; }
    const { data } = await yayoSB().from("favorites")
      .select("id, market").eq("user_id", __favUser.id).eq("type", "car").limit(500);
    __favMap = {};
    (data || []).forEach(r => { if (r.market) __favMap[r.market] = r.id; });
  } catch (e) { /* table unreachable: hearts stay interactive but unsaved */ }
  __favReady = true;
  markFavHearts(document);
}

function yayoIsFav(id) { return !!__favMap[id]; }

function markFavHearts(root) {
  (root || document).querySelectorAll(".fav[data-fav-id]").forEach(b => {
    b.classList.toggle("on", yayoIsFav(b.dataset.favId));
  });
}

async function favClick(e, id, name) {
  e.preventDefault();
  e.stopPropagation();
  if (!__favUser) {
    location.href = "connexion.html?next=" + encodeURIComponent(location.pathname.split("/").pop() + location.search);
    return;
  }
  const btn = e.currentTarget;
  try {
    if (__favMap[id]) {
      const rowId = __favMap[id];
      delete __favMap[id];
      btn.classList.remove("on");
      await yayoSB().from("favorites").delete().eq("id", rowId).eq("user_id", __favUser.id);
    } else {
      __favMap[id] = "pending";
      btn.classList.add("on");
      await yayoEnsureUserRow(__favUser);
      const { data, error } = await yayoSB().from("favorites")
        .insert({ user_id: __favUser.id, type: "car", car_name: name || "", market: String(id) })
        .select("id").single();
      if (error) throw error;
      __favMap[id] = data.id;
    }
  } catch (err) {
    // revert on failure
    if (__favMap[id] === "pending") { delete __favMap[id]; btn.classList.remove("on"); }
  }
}

// Heart button HTML for car cards (shared by all renderers)
function favBtn(id, name) {
  return `<button class="fav" data-fav-id="${id}" onclick="favClick(event, '${id}', '${(name || "").replace(/'/g, "\\'").replace(/"/g, "&quot;")}')" aria-label="Sauvegarder">♥</button>`;
}

document.addEventListener("DOMContentLoaded", initFavs);
