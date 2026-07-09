// ═══════════════════════════════════════════════
// YAYO — Tiny chart helpers (no library)
// Inline SVG in the navy/turquoise design system.
// Used by the dealer, agency and admin dashboards.
// ═══════════════════════════════════════════════

// Line/area trend over the last `days` days.
// series: [{d: "2026-07-01", n: 3}, …] (missing days = 0)
function yayoLineChart(series, days) {
  days = days || 30;
  const byDay = {};
  (series || []).forEach(p => { byDay[String(p.d).slice(0, 10)] = Number(p.n) || 0; });
  const labels = [], vals = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000);
    const key = d.toISOString().slice(0, 10);
    labels.push(key.slice(8, 10) + "/" + key.slice(5, 7));
    vals.push(byDay[key] || 0);
  }
  const max = Math.max(1, ...vals);
  const W = 560, H = 150, P = 10, PB = 22, PL = 24;
  const x = i => PL + i * (W - PL - P) / (days - 1);
  const y = n => P + (H - P - PB) * (1 - n / max);
  const pts = vals.map((n, i) => `${x(i).toFixed(1)},${y(n).toFixed(1)}`).join(" ");
  // 3 horizontal gridlines + y labels (0, mid, max)
  const grid = [0, 0.5, 1].map(f => {
    const gy = y(max * f).toFixed(1);
    return `<line class="yy-grid" x1="${PL}" y1="${gy}" x2="${W - P}" y2="${gy}"/>
            <text class="yy-axis" x="${PL - 4}" y="${+gy + 3}" text-anchor="end">${Math.round(max * f)}</text>`;
  }).join("");
  // x labels: first, middle, last day
  const xl = [0, Math.floor((days - 1) / 2), days - 1].map(i =>
    `<text class="yy-axis" x="${x(i).toFixed(1)}" y="${H - 6}" text-anchor="middle">${labels[i]}</text>`).join("");
  const dots = vals.map((n, i) => n > 0
    ? `<circle cx="${x(i).toFixed(1)}" cy="${y(n).toFixed(1)}" r="2.4" fill="#17b3a6"/>` : "").join("");
  return `<div class="yy-chart"><svg viewBox="0 0 ${W} ${H}" role="img">
    ${grid}
    <polygon points="${x(0)},${y(0)} ${pts} ${x(days - 1)},${y(0)}" fill="#1FD8C9" opacity="0.13"/>
    <polyline points="${pts}" fill="none" stroke="#17b3a6" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>
    ${dots}${xl}
  </svg></div>`;
}

// Horizontal bars: items [{label, value, hint?}] — top N, longest first look
function yayoBarChart(items, unit) {
  const list = (items || []).filter(i => Number(i.value) > 0);
  if (!list.length) return `<p class="yy-empty">${t("ch_none")}</p>`;
  const max = Math.max(...list.map(i => Number(i.value)));
  const esc = s => (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return list.map(i => `
    <div class="yy-bar-row">
      <span class="yy-bar-lbl" title="${esc(i.label)}">${esc(i.label)}</span>
      <span class="yy-bar-track"><span class="yy-bar-fill" style="width:${Math.max(3, 100 * i.value / max)}%"></span></span>
      <span class="yy-bar-val">${Number(i.value).toLocaleString("fr-FR")}${unit ? " " + unit : ""}</span>
    </div>`).join("");
}

// Group ISO timestamps into a per-day series for yayoLineChart
function yayoDailySeries(dates) {
  const byDay = {};
  (dates || []).forEach(s => {
    if (!s) return;
    const k = String(s).slice(0, 10);
    byDay[k] = (byDay[k] || 0) + 1;
  });
  return Object.keys(byDay).map(d => ({ d, n: byDay[d] }));
}
