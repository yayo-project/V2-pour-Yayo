// ═══════════════════════════════════════════════
// YAYO — Pricing (vendre.html + expedier.html)
// Monthly / Yearly toggle. Yearly = 10 × monthly
// (2 months free, ~17% off). Amounts live in
// data-m / data-y on each .price-amt.
// ═══════════════════════════════════════════════

let YAYO_BILL = "m";

function fmtPrice(n) {
  return "$" + Math.round(n).toLocaleString("fr-FR").replace(/ /g, " ");
}

function renderPrices() {
  document.querySelectorAll(".price-amt[data-m]").forEach(el => {
    const amount = YAYO_BILL === "m" ? +el.dataset.m : +el.dataset.y;
    const unit = YAYO_BILL === "m" ? t("v_mo") : t("pr_yr");
    el.innerHTML = fmtPrice(amount) + "<span>" + unit + "</span>";
  });
  document.querySelectorAll(".price-save").forEach(el => {
    el.hidden = YAYO_BILL === "m";
    el.textContent = t("pr_save");
  });
  document.querySelectorAll(".bill-toggle button").forEach(b =>
    b.classList.toggle("on", b.dataset.bill === YAYO_BILL));
}

document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll(".bill-toggle button").forEach(b =>
    b.addEventListener("click", () => { YAYO_BILL = b.dataset.bill; renderPrices(); }));
  renderPrices();
  window.onLangChange = renderPrices;
});
