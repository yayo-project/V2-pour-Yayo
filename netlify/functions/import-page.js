// ═══════════════════════════════════════════════
// YAYO — Server-rendered import guides (SEO)
//
// There are about a hundred pages of the form
// /importer-<make>-dubai-<city>.html, and on paper they are a good idea: the
// exact question a buyer types into Google, answered with real stock and the
// real customs structure of that country.
//
// Measured against each other, they were 87–93% identical. Not because the
// content strategy was wrong, but because every part that DIFFERS is drawn by
// JavaScript after the page loads: the cost breakdown, the live listings of
// that make, the "starting at" sentence. All of it sits behind an empty <div>
// and a hidden <h2>. The HTML Google downloads is the same boilerplate on all
// hundred pages, with the make and the city swapped.
//
// Google does render JavaScript. It also decides how much rendering a site is
// worth, and a hundred near-identical documents is exactly the signal that
// makes it stop bothering. Worse, that pattern has a name in Google's own
// guidelines — doorway pages — and the penalty is not limited to the pages
// that earned it.
//
// So this does for the guides what car-page.js already does for cars: serves
// the same shell with the distinguishing content already in the HTML. The
// page's own JavaScript still runs and re-renders it, so there is one source
// of truth and no second code path to keep in step.
//
// Wired in netlify.toml:  /importer-* -> this function
// ═══════════════════════════════════════════════
const fs = require("fs");
const path = require("path");
const { DEST, customs, landedTotal, money } = require("./_dest");

const SB_URL = "https://wkjxdkeqffsjarjxlsyh.supabase.co";
const SB_ANON = "sb_publishable_-mDN0Rd9q8q2SJuJPsn_qw_ieHvuSB8";

const esc = s => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const HEADERS = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=300" };

// The page files ship with the function bundle. Nothing outside this pattern
// is ever opened: the filename comes from the URL, so it is treated as hostile.
function readShell(file) {
  if (!/^importer-[a-z0-9-]+\.html$/.test(file)) return null;
  for (const p of [
    path.join(__dirname, file),
    path.join(process.env.LAMBDA_TASK_ROOT || ".", file),
    path.join(__dirname, "..", "..", file)
  ]) {
    try { return fs.readFileSync(p, "utf8"); } catch (e) { /* try next */ }
  }
  return null;
}

// The page already declares what it is about, at the bottom of its own script.
// Reading those three constants is exact, where guessing the make back out of
// the filename would turn "mercedes-benz" into "Mercedes Benz" and
// "mitsubishi-fuso" into something that matches no listing at all.
function readConst(shell, name) {
  const m = new RegExp("const\\s+" + name + "\\s*=\\s*\"([^\"]*)\"").exec(shell);
  return m ? m[1] : "";
}

function slugify(s) {
  return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}
function carHref(l) {
  const make = /^\d{4}$/.test(String(l.make || "").trim()) ? "" : (l.make || "");
  const title = [make, l.model].filter(Boolean).join(" ") || l.car_name || "voiture";
  return "/voiture/" + [slugify(title), l.year ? String(l.year) : "", l.id].filter(Boolean).join("-");
}

// The same stock the page's own script asks for: live listings of this make,
// from a business an admin actually let trade.
async function fetchCars(key, make) {
  const cols = "id,car_name,make,model,price,year,mileage,photo_url,dealers!inner(name,verified,approved,suspended)";
  const base = SB_URL + "/rest/v1/listings?select=" + encodeURIComponent(cols) +
    "&active=eq.true&sold=eq.false&hidden=eq.false" +
    "&dealers.suspended=eq.false&order=created_at.desc&limit=8";
  const makeFilter = make ? "&make=ilike." + encodeURIComponent(make) : "";
  // "approved" is the newer gate; fall back to "verified" exactly as the
  // client does, so an older row never empties the page
  for (const gate of ["&dealers.approved=eq.true", "&dealers.verified=eq.true"]) {
    try {
      const r = await fetch(base + makeFilter + gate, {
        headers: { apikey: key, Authorization: "Bearer " + key }
      });
      if (!r.ok) continue;
      const rows = await r.json();
      if (Array.isArray(rows) && rows.length) return rows;
    } catch (e) { /* try the other gate */ }
  }
  return [];
}

function cardsHtml(cars, cityKey, cityName) {
  return cars.map(l => `
    <a class="car-card" href="${carHref(l)}" style="text-decoration:none;color:inherit">
      <div class="car-img"><img src="${esc(l.photo_url || "")}" alt="${esc(l.car_name)} d'occasion à vendre à Dubai, livrable à ${esc(cityName)}" loading="lazy"></div>
      <div class="car-body">
        <div class="car-title">${esc(l.car_name)}</div>
        <div class="car-chips">${l.year ? `<span>${l.year}</span>` : ""}${l.mileage ? `<span>${Number(l.mileage).toLocaleString("fr-FR")} km</span>` : ""}</div>
        <div class="car-price-row"><span class="car-price">${money(l.price)}</span><span class="car-price-lbl">à Dubai</span></div>
        <div class="landed"><span class="landed-lbl">Coût total livré ${esc(cityName)}</span><span class="landed-val">≈ ${money(landedTotal(l.price, cityKey))}</span></div>
      </div>
    </a>`).join("");
}

function breakdownHtml(price, cityKey, cityName, make) {
  const c = customs(price, cityKey);
  if (!c) return "";
  const line = (label, val) => `<div class="cost-line"><span>${esc(label)}</span><b>${money(val)}</b></div>`;
  return line((make || "Voiture") + " — payée au vendeur", price)
    + line("Transport maritime → agence (estimation)", c.ship)
    + line("Droits de douane → gouvernement (estimation)", c.duty)
    + (c.extra ? line("Taxes & prélèvements (estimation)", c.extra) : "")
    + line("TVA (estimation)", c.vat)
    + line("Frais port & dossier (estimation)", c.fees)
    + `<div class="cost-total"><span>Coût total du projet — ${esc(cityName)}</span><span class="val">≈ ${money(landedTotal(price, cityKey))}</span></div>`;
}

exports.handler = async (event) => {
  const file = (event.path || "").split("/").pop().split("?")[0] || "";
  const name = /\.html$/.test(file) ? file : file + ".html";
  const shell = readShell(name);
  if (!shell) return { statusCode: 404, headers: HEADERS, body: "Not found" };

  // From here on, every failure returns the page exactly as it is today.
  // A guide that renders its content in the browser is worth far more than a
  // guide that does not render at all.
  try {
    const make = readConst(shell, "BP_MAKE");
    // The per-brand guides declare BP_CITY. The four general ones
    // (importer-voiture-dubai-<city>) do not: they name the city inside their
    // calculator as a local `key`. The filename always carries it, in both
    // shapes, so that is what decides.
    const fromFile = (/^importer-.*-dubai-([a-z]+)\.html$/.exec(name) || [])[1] || "";
    const cityKey = DEST[readConst(shell, "BP_CITY")] ? readConst(shell, "BP_CITY") : fromFile;
    const cityName = readConst(shell, "BP_CITY_NAME") || (DEST[cityKey] || {}).name || "";
    if (!DEST[cityKey]) return { statusCode: 200, headers: HEADERS, body: shell };

    const key = process.env.SUPABASE_SERVICE_KEY || SB_ANON;
    const cars = await fetchCars(key, make);
    if (!cars.length) return { statusCode: 200, headers: HEADERS, body: shell };

    const prices = cars.map(l => Number(l.price)).filter(p => p > 0);
    const min = prices.length ? Math.min.apply(null, prices) : 0;
    let out = shell;

    // 1. The stock, in the HTML. This is the part that makes one guide
    //    different from the ninety-nine others.
    out = out.replace(/(<div class="car-grid" id="seo-cars"[^>]*>)\s*<\/div>/,
      "$1" + cardsHtml(cars, cityKey, cityName) + "</div>");
    out = out.replace(/(<h2 id="seo-cars-h")\s+hidden/, "$1");
    out = out.replace(/(<p id="seo-cars-p"[^>]*?)\s+hidden/, "$1");
    out = out.replace(/(<p id="seo-cars-more"[^>]*?)\s+hidden/, "$1");

    // 2. Open the calculator on a price this make actually sells for, instead
    //    of the same $3 400 on every page, and show the sum already worked out.
    if (min > 0) {
      out = out.replace(/(<input id="seo-price"[^>]*?)value="\d+"/, `$1value="${Math.round(min)}"`);
      out = out.replace(/(<div id="seo-breakdown">)\s*<\/div>/,
        "$1" + breakdownHtml(min, cityKey, cityName, make) + "</div>");
      // 3. The same sentence the script adds, but present before it runs.
      out = out.replace(/(<p id="bp-lead">[\s\S]*?)(<\/p>)/,
        `$1 <b>En ce moment sur Yayo, les ${esc(make || "voitures")} démarrent à ${money(min)} à Dubai, soit environ ${money(landedTotal(min, cityKey))} rendues à ${esc(cityName)} (estimation).</b>$2`);
    }

    // 4. The stock as structured data. An ItemList of real offers is what
    //    separates a page that has inventory from a page that talks about it.
    const ld = {
      "@context": "https://schema.org",
      "@type": "ItemList",
      name: (make ? make + " " : "Voitures ") + "à importer de Dubai à " + cityName,
      numberOfItems: cars.length,
      itemListElement: cars.map((l, i) => ({
        "@type": "ListItem", position: i + 1,
        item: {
          "@type": "Car", name: l.car_name,
          url: "https://yayo.digital" + carHref(l),
          image: l.photo_url || undefined,
          offers: { "@type": "Offer", price: Number(l.price) || undefined, priceCurrency: "USD",
                    availability: "https://schema.org/InStock" }
        }
      }))
    };
    // 5. The three questions this page exists to answer, as FAQ data, with
    //    this page's own figures in the answers. Every number here is either
    //    the country's published structure or the stock actually on the site,
    //    so nothing is claimed that the page does not already show.
    // Two decimals, trailing zeros dropped. Cameroon's VAT is 19,25 % and
    // rounding it to 19,3 % on a page whose whole argument is that the real
    // numbers are shown would be a strange place to be approximate.
    const pct = n => String(Math.round(n * 10000) / 100).replace(".", ",") + " %";
    const d = DEST[cityKey];
    const thing = make || "voiture";
    const faq = min > 0 ? {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: [
        {
          "@type": "Question",
          name: `Combien coûte l'importation d'une ${thing} de Dubai à ${cityName} ?`,
          acceptedAnswer: { "@type": "Answer", text:
            `En ce moment, les ${thing} disponibles à Dubai sur Yayo démarrent à ${money(min)}. ` +
            `Rendue à ${cityName}, cette voiture revient à environ ${money(landedTotal(min, cityKey))}, ` +
            `transport maritime, droits de douane, TVA et frais de port compris. Il s'agit d'une estimation : ` +
            `le transport est facturé par l'agence que vous choisissez et la douane par le gouvernement.` }
        },
        {
          "@type": "Question",
          name: `Quels sont les droits de douane sur une voiture importée à ${cityName} ?`,
          acceptedAnswer: { "@type": "Answer", text:
            `Environ ${pct(d.customs.duty)} de droits de douane` +
            (d.customs.extra ? `, ${pct(d.customs.extra)} de taxes et prélèvements` : "") +
            `, puis ${pct(d.customs.vat)} de TVA. Tout se calcule sur la valeur CIF, c'est-à-dire le prix de la ` +
            `voiture plus le transport, et non sur le prix affiché seul. La TVA s'applique après les droits, pas à côté.` }
        },
        {
          "@type": "Question",
          name: `Faut-il payer le montant total au vendeur ?`,
          acceptedAnswer: { "@type": "Answer", text:
            `Non. Le prix de la voiture va au vendeur à Dubai, le transport à l'agence maritime, ` +
            `et les droits et la TVA au gouvernement. Ce sont trois paiements distincts, à des moments différents. ` +
            `Le total affiché est le coût complet du projet, pas une somme à virer à une seule personne.` }
        }
      ]
    } : null;

    const blocks = [`<script type="application/ld+json" id="bp-stock-ld">${JSON.stringify(ld).replace(/</g, "\\u003c")}</script>`];
    if (faq) blocks.push(`<script type="application/ld+json" id="bp-faq-ld">${JSON.stringify(faq).replace(/</g, "\\u003c")}</script>`);
    out = out.replace(/<\/head>/i, blocks.join("\n") + "\n</head>");

    return { statusCode: 200, headers: HEADERS, body: out };
  } catch (e) {
    return { statusCode: 200, headers: HEADERS, body: shell };
  }
};
