// ═══════════════════════════════════════════════════════════════
// YAYO — "Signaler un problème"
//
// The reports table, its policies, the admin tab with its
// nouveau → en cours → résolu workflow, and every string in three
// languages were all built. The button was not, so in practice a visitor
// who spotted a fake listing or a dealer behaving badly had nowhere to say
// so, and the admin tab has been sitting empty because nothing could reach
// it.
//
// This is the missing half. A discreet link in the footer of every page,
// and a sharper one on a car page where the thing being reported usually
// is. Anyone can send one, logged in or not — a buyer who has just been
// asked for money outside Yayo is exactly the person least likely to have
// an account, and requiring one would lose the report that matters most.
// ═══════════════════════════════════════════════════════════════

function yayoReportOpen(context) {
  if (document.getElementById("rp-sheet")) return;
  const ctx = context || {};
  const esc = s => String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  const sheet = document.createElement("div");
  sheet.className = "rp-sheet";
  sheet.id = "rp-sheet";
  sheet.innerHTML = `
    <div class="rp-panel" role="dialog" aria-modal="true" aria-labelledby="rp-title">
      <button type="button" class="rp-x" onclick="yayoReportClose()" aria-label="${esc(t("off_cancel"))}">✕</button>
      <h3 id="rp-title">${esc(t("rp_h"))}</h3>
      <p class="rp-sub">${esc(t("rp_p"))}</p>
      ${ctx.about ? `<div class="rp-about">${esc(ctx.about)}</div>` : ""}

      <label class="rp-lbl" for="rp-kind">${esc(t("rp_kind"))}</label>
      <select id="rp-kind">
        <option value="listing">${esc(t("rp_k_listing"))}</option>
        <option value="business">${esc(t("rp_k_business"))}</option>
        <option value="bug">${esc(t("rp_k_bug"))}</option>
        <option value="other">${esc(t("rp_k_other"))}</option>
      </select>

      <label class="rp-lbl" for="rp-msg">${esc(t("rp_msg"))}</label>
      <textarea id="rp-msg" rows="4" maxlength="1500" placeholder="${esc(t("rp_msg_ph"))}"></textarea>

      <label class="rp-lbl" for="rp-contact">${esc(t("rp_contact"))}</label>
      <input id="rp-contact" type="email" maxlength="150" placeholder="${esc(t("rp_contact_ph"))}" autocomplete="email">

      <p class="rp-warn" id="rp-warn" hidden></p>
      <div class="rp-btns">
        <button type="button" class="rp-cancel" onclick="yayoReportClose()">${esc(t("off_cancel"))}</button>
        <button type="button" class="rp-send" id="rp-send">${esc(t("rp_send"))}</button>
      </div>
    </div>`;
  document.body.appendChild(sheet);

  // a car page opens straight on the reason it was opened from
  if (ctx.kind) {
    const sel = sheet.querySelector("#rp-kind");
    if ([...sel.options].some(o => o.value === ctx.kind)) sel.value = ctx.kind;
  }
  setTimeout(() => sheet.querySelector("#rp-msg").focus(), 60);
  sheet.addEventListener("click", e => { if (e.target === sheet) yayoReportClose(); });
  document.addEventListener("keydown", yayoReportEsc);
  sheet.querySelector("#rp-send").onclick = () => yayoReportSend(ctx);
}

function yayoReportEsc(e) { if (e.key === "Escape") yayoReportClose(); }
function yayoReportClose() {
  const s = document.getElementById("rp-sheet");
  if (s) s.remove();
  document.removeEventListener("keydown", yayoReportEsc);
}

async function yayoReportSend(ctx) {
  const sheet = document.getElementById("rp-sheet");
  if (!sheet) return;
  const warn = sheet.querySelector("#rp-warn");
  const show = m => { warn.textContent = m; warn.hidden = false; };
  const msg = sheet.querySelector("#rp-msg").value.trim();
  if (msg.length < 10) return show(t("rp_msg"));

  const btn = sheet.querySelector("#rp-send");
  btn.disabled = true;
  btn.textContent = t("off_sending");

  // The reporter's own contact details are the one place on Yayo where a
  // phone number is welcome: it is how the admin answers them. The §49
  // filter deliberately does not apply here.
  const row = {
    url: (ctx.url || location.href).slice(0, 500),
    kind: sheet.querySelector("#rp-kind").value,
    message: msg.slice(0, 1500),
    contact: sheet.querySelector("#rp-contact").value.trim().slice(0, 150) || null
  };
  try {
    const user = await yayoUser();
    if (user) row.user_id = user.id;
  } catch (e) { /* reporting never requires an account */ }

  try {
    const { error } = await yayoSB().from("reports").insert(row);
    if (error) throw error;
    sheet.querySelector(".rp-panel").innerHTML =
      `<div class="rp-done"><span class="rp-tick">✓</span><p>${t("rp_done")}</p>
       <button type="button" class="rp-send" onclick="yayoReportClose()">${t("off_cancel")}</button></div>`;
    setTimeout(yayoReportClose, 4000);
  } catch (e) {
    btn.disabled = false;
    btn.textContent = t("rp_send");
    show((e && e.message) ? e.message : t("chat_send_fail"));
  }
}

// ── The link, on every page that loads this file ────────────────
// Added to the footer rather than written into thirty HTML files, so a page
// that gets built tomorrow gets it too without anyone remembering.
function yayoReportLink() {
  document.querySelectorAll(".footer-bottom").forEach(f => {
    if (f.querySelector("[data-report-link]")) return;
    const a = document.createElement("a");
    a.href = "#";
    a.className = "rp-link";
    a.setAttribute("data-report-link", "1");
    a.setAttribute("data-i18n", "rp_link");
    a.textContent = t("rp_link");
    a.addEventListener("click", e => { e.preventDefault(); yayoReportOpen({}); });
    f.appendChild(a);
  });
}
document.addEventListener("DOMContentLoaded", yayoReportLink);
