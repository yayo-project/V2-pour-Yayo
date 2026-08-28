// ═══════════════════════════════════════════════
// YAYO — the crawlable index of every car
//
// Search Console reported 431 URLs as "Discovered – currently not indexed".
// The cause was not authority. It was that nothing on the site linked to
// them. The homepage renders its cars with JavaScript, the marketplace
// renders its 685 with JavaScript, so the HTML Google downloads from either
// contains ZERO links to a car page. The only place those URLs existed was
// the sitemap.
//
// A sitemap says "these URLs exist". Internal links say "these URLs matter".
// Google treats the second as the real signal, and a URL with no inbound
// link from anywhere on the site looks like it is not really part of it —
// which is precisely what discovered-and-skipped means.
//
// This page is the missing link, literally. Plain anchors to every car on
// sale, paginated so no single page is enormous, each page linking to the
// next so a crawler can walk the whole set from one entry point.
//
// Wired in netlify.toml:  /voitures        -> page 1
//                         /voitures/page-2 -> page 2, and so on
// ═══════════════════════════════════════════════
const SB_URL = "https://wkjxdkeqffsjarjxlsyh.supabase.co";
const SB_ANON = "sb_publishable_-mDN0Rd9q8q2SJuJPsn_qw_ieHvuSB8";
const SITE = "https://yayo.digital";
const PER_PAGE = 120;

const { money } = require("./_dest");

const esc = s => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

function slugify(s) {
  return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}
function carHref(l) {
  const make = /^\d{4}$/.test(String(l.make || "").trim()) ? "" : (l.make || "");
  const title = [make, l.model].filter(Boolean).join(" ") || l.car_name || "voiture";
  return "/voiture/" + [slugify(title), l.year ? String(l.year) : "", l.id].filter(Boolean).join("-");
}

exports.handler = async (event) => {
  const key = process.env.SUPABASE_SERVICE_KEY || SB_ANON;
  const m = /page-(\d+)/.exec(event.path || "");
  const page = Math.max(1, Math.min(50, m ? parseInt(m[1], 10) : 1));

  let cars = [];
  try {
    // hidden and dormant have to be SELECTED to be filtered on below —
    // without them the filter reads undefined and quietly lets every car
    // through, including ones an admin hid.
    const url = SB_URL + "/rest/v1/listings?select=id,car_name,make,model,year,price,city,hidden,dormant,dealers!inner(approved,suspended)" +
      "&active=eq.true&sold=eq.false&dealers.approved=eq.true&dealers.suspended=eq.false" +
      "&order=created_at.desc&limit=5000";
    const r = await fetch(url, { headers: { apikey: key, Authorization: "Bearer " + key } });
    if (r.ok) cars = (await r.json()).filter(c => !c.hidden && !c.dormant);
  } catch (e) { cars = []; }

  const pages = Math.max(1, Math.ceil(cars.length / PER_PAGE));
  const slice = cars.slice((page - 1) * PER_PAGE, page * PER_PAGE);
  const self = SITE + (page === 1 ? "/voitures" : "/voitures/page-" + page);

  const rows = slice.map(c => {
    const name = [c.car_name, c.year].filter(Boolean).join(" ");
    return `<li><a href="${carHref(c)}">${esc(name)}</a>` +
      (c.price ? ` <span>${money(c.price)} à Dubai</span>` : "") + `</li>`;
  }).join("\n");

  // prev/next so a crawler can walk every page from this one
  const nav = [];
  if (page > 1) nav.push(`<a rel="prev" href="${page === 2 ? "/voitures" : "/voitures/page-" + (page - 1)}">← Page ${page - 1}</a>`);
  if (page < pages) nav.push(`<a rel="next" href="/voitures/page-${page + 1}">Page ${page + 1} →</a>`);
  // every page number too, so no car is more than two clicks from here
  const all = [];
  for (let i = 1; i <= pages; i++) {
    all.push(i === page ? `<b>${i}</b>` : `<a href="${i === 1 ? "/voitures" : "/voitures/page-" + i}">${i}</a>`);
  }

  const title = pages > 1 && page > 1
    ? `Toutes les voitures à Dubai — page ${page} sur ${pages} | Yayo`
    : `Toutes les voitures disponibles à Dubai — ${cars.length} annonces vérifiées | Yayo`;

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<meta name="description" content="La liste complète des ${cars.length} voitures vérifiées à Dubai sur Yayo, livrables à Kinshasa, Douala, Abidjan et Dakar. Prix affiché à Dubai, coût total livré sur chaque annonce.">
<link rel="canonical" href="${self}">
${page > 1 ? `<link rel="prev" href="${page === 2 ? SITE + "/voitures" : SITE + "/voitures/page-" + (page - 1)}">` : ""}
${page < pages ? `<link rel="next" href="${SITE}/voitures/page-${page + 1}">` : ""}
<link rel="icon" type="image/png" href="/assets/favicon.png">
<link rel="stylesheet" href="/css/style.css">
</head>
<body>
<header class="topbar">
  <div class="wrap topbar-in">
    <a href="/" class="logo" aria-label="Yayo"><img src="/assets/logo-teal.png" alt="Yayo" class="logo-img"></a>
    <nav class="nav">
      <a href="/acheter.html">Acheter</a>
      <a href="/vendre.html">Vendre</a>
      <a href="/expedier.html">Expédier</a>
      <a href="/comment.html">Comment ça marche</a>
    </nav>
  </div>
</header>
<main class="wrap" style="padding:34px 0 44px;max-width:900px">
  <h1 style="font-size:clamp(20px,3vw,26px);font-weight:800;letter-spacing:-.7px;margin-bottom:6px">
    Toutes les voitures disponibles à Dubai</h1>
  <p style="font-size:13.5px;color:var(--ink-2);margin-bottom:8px">
    ${cars.length} annonces de vendeurs vérifiés${pages > 1 ? ` · page ${page} sur ${pages}` : ""}.
    Chaque voiture affiche son coût total livré à Kinshasa, Douala, Abidjan ou Dakar.</p>
  <p style="font-size:13px;margin-bottom:18px"><a href="/acheter.html">Filtrer par marque, prix et ville →</a></p>
  <ul class="cars-index">
${rows}
  </ul>
  <nav class="cars-pages">${nav.join(" · ")}</nav>
  <nav class="cars-pages" style="margin-top:8px">${all.join(" ")}</nav>
  <p style="font-size:13px;margin-top:26px">
    Guides par ville :
    <a href="/importer-voiture-dubai-kinshasa.html">Kinshasa</a> ·
    <a href="/importer-voiture-dubai-douala.html">Douala</a> ·
    <a href="/importer-voiture-dubai-abidjan.html">Abidjan</a> ·
    <a href="/importer-voiture-dubai-dakar.html">Dakar</a>
  </p>
</main>
<footer class="footer">
  <div class="wrap footer-bottom" style="border-top:none">
    <span>© 2026 Yayo · yayo.digital</span><span>Dubai 🇦🇪 → Afrique 🌍</span>
  </div>
</footer>
</body>
</html>`;

  return {
    statusCode: 200,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=900" },
    body: html
  };
};
