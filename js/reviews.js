// ═══════════════════════════════════════════════
// YAYO — Reviews for dealers AND agencies.
// Real reviews only (honesty rule): written by
// logged-in buyers, empty until real buyers write.
// Table: reviews(subject_type, subject_id, user_id,
//   author, rating, comment, created_at)
// ═══════════════════════════════════════════════

function starsHtml(avg) {
  let h = "";
  for (let i = 1; i <= 5; i++) h += `<span class="star${i <= Math.round(avg) ? " on" : ""}">★</span>`;
  return `<span class="stars">${h}</span>`;
}

async function yayoReviews(type, id) {
  try {
    const { data, error } = await yayoSB().from("reviews")
      .select("author, rating, comment, created_at")
      .eq("subject_type", type).eq("subject_id", id)
      .order("created_at", { ascending: false }).limit(50);
    if (error) return { list: [], avg: 0, count: 0 };
    const list = data || [];
    const count = list.length;
    const avg = count ? list.reduce((s, r) => s + r.rating, 0) / count : 0;
    return { list, avg, count };
  } catch (e) { return { list: [], avg: 0, count: 0 }; }
}

// Compact "★ 4.8 (12 avis)" inline summary, or "no reviews yet"
function reviewSummaryHtml(rv) {
  if (!rv.count) return `<span class="rv-mini rv-mini-none">${t("rv_none_short")}</span>`;
  return `<span class="rv-mini">${starsHtml(rv.avg)} <b>${rv.avg.toFixed(1)}</b> (${rv.count} ${t("rv_count")})</span>`;
}

// Full widget: summary + list + form (logged-in buyers only)
async function renderReviewsWidget(elId, type, id) {
  const el = document.getElementById(elId);
  if (!el) return;
  const isDemo = String(id).startsWith("demo") || String(id).startsWith("ag-demo");
  const rv = isDemo ? { list: [], avg: 0, count: 0 } : await yayoReviews(type, id);
  const user = await yayoUser();

  const listHtml = rv.count
    ? rv.list.map(r => `
      <div class="rv-item">
        <div class="rv-item-head">${starsHtml(r.rating)}<b>${(r.author || t("rv_anon")).replace(/</g, "&lt;")}</b>
          <span>${new Date(r.created_at).toLocaleDateString("fr-FR")}</span></div>
        ${r.comment ? `<p>${r.comment.replace(/</g, "&lt;")}</p>` : ""}
      </div>`).join("")
    : `<p class="rv-none">${t("rv_none")}</p>`;

  const formHtml = (user && !isDemo) ? `
    <form class="rv-form" onsubmit="return submitReview(event, '${type}', '${id}', '${elId}')">
      <div class="rv-pick" id="${elId}-stars">
        ${[1, 2, 3, 4, 5].map(n => `<button type="button" data-n="${n}" onclick="pickStar('${elId}', ${n})">★</button>`).join("")}
      </div>
      <textarea id="${elId}-comment" rows="2" maxlength="500" placeholder="${t("rv_ph")}"></textarea>
      <button type="submit" class="btn btn-solid">${t("rv_send")}</button>
      <p class="auth-error" id="${elId}-err" hidden></p>
    </form>`
    : (isDemo ? "" : `<p class="rv-login">${t("rv_login")}</p>`);

  el.innerHTML = `
    <div class="rv-summary">${rv.count ? `${starsHtml(rv.avg)} <b>${rv.avg.toFixed(1)}</b> · ${rv.count} ${t("rv_count")}` : t("rv_none_short")}</div>
    <div class="rv-list">${listHtml}</div>
    ${formHtml}`;
}

const __rvPick = {};
function pickStar(elId, n) {
  __rvPick[elId] = n;
  document.querySelectorAll(`#${elId}-stars button`).forEach(b => b.classList.toggle("on", +b.dataset.n <= n));
}

async function submitReview(e, type, id, elId) {
  e.preventDefault();
  const err = document.getElementById(elId + "-err");
  err.hidden = true;
  const rating = __rvPick[elId];
  if (!rating) { err.hidden = false; err.textContent = t("rv_pick_err"); return false; }
  try {
    const user = await yayoUser();
    if (!user) throw new Error(t("rv_login"));
    await yayoEnsureUserRow(user);
    const author = (user.user_metadata && user.user_metadata.full_name) || user.email.split("@")[0];
    const { error } = await yayoSB().from("reviews").insert({
      subject_type: type, subject_id: id, user_id: user.id, author,
      rating, comment: document.getElementById(elId + "-comment").value.trim() || null
    });
    if (error) throw error;
    renderReviewsWidget(elId, type, id);
  } catch (e2) {
    err.hidden = false;
    err.textContent = t("rv_err");
  }
  return false;
}
