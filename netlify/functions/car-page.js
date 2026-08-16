// ═══════════════════════════════════════════════
// YAYO — Server-rendered car page (SEO + link previews)
//
// voiture.html is an empty shell that JavaScript fills in after a Supabase
// call. Google can *sometimes* wait for that. WhatsApp, Facebook and X never
// do — so every car link a dealer or buyer shared showed the generic Yayo
// logo instead of the car, its price and its city.
//
// This function serves the SAME voiture.html but with the <head> already
// filled in: real title, description, canonical, Open Graph photo and
// Vehicle/Offer structured data, straight in the HTML. The page's own JS
// still runs and hydrates everything else, so there is one code path, not two.
//
// Wired in netlify.toml:
//   /voiture/*        -> this function (the pretty, keyword-bearing URL)
//   /voiture.html?id= -> still works, canonical points at the pretty URL
// ═══════════════════════════════════════════════
const fs = require("fs");
const path = require("path");

const SB_URL = "https://wkjxdkeqffsjarjxlsyh.supabase.co";
const SB_ANON = "sb_publishable_-mDN0Rd9q8q2SJuJPsn_qw_ieHvuSB8";
const SITE = "https://yayo.digital";

// Same customs structure as js/config.js. Freight and duty are ESTIMATES and
// are labelled as such everywhere they appear — never presented as final.
const DEST = {
  kinshasa: { name: "Kinshasa", ship: 3200, fees: 1070, duty: 0.10, extra: 0.10, vat: 0.16 },
  douala:   { name: "Douala",   ship: 2800, fees: 1070, duty: 0.30, extra: 0.00, vat: 0.1925 },
  abidjan:  { name: "Abidjan",  ship: 3500, fees: 1070, duty: 0.20, extra: 0.025, vat: 0.18 },
  dakar:    { name: "Dakar",    ship: 3300, fees: 1070, duty: 0.20, extra: 0.024, vat: 0.18 }
};

function landed(price, key) {
  const d = DEST[key];
  if (!d) return null;
  const cif = Number(price) + d.ship;
  const duty = cif * d.duty;
  const extra = cif * d.extra;
  const vat = (cif + duty + extra) * d.vat;
  return Math.round(cif + duty + extra + vat + d.fees);
}

const esc = s => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const money = n => "$" + Math.round(Number(n) || 0).toLocaleString("en-US").replace(/,/g, " ");

// A car's URL slug: keywords first, uuid last so the lookup is exact.
// "Toyota Land Cruiser", 2021 -> toyota-land-cruiser-2021-<uuid>
function slugify(s) {
  return String(s || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "").slice(0, 60);
}

function carSlug(l) {
  const title = [l.make, l.model].filter(Boolean).join(" ") || l.car_name;
  const bits = [slugify(title), l.year ? String(l.year) : "", l.id].filter(Boolean);
  return bits.join("-");
}

// The uuid is always the last 36 characters of the slug.
function idFromSlug(slug) {
  const m = String(slug || "").match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  return m ? m[0] : null;
}

// Human title for a listing. The import wrote some rows badly (a year landing
// in the make column, an empty model), so fall back through what we have and
// never emit a title that is only a year or the word "New".
function carTitle(l) {
  const make = /^\d{4}$/.test(String(l.make || "").trim()) ? "" : (l.make || "");
  const parts = [make, l.model].filter(Boolean).join(" ").trim();
  const name = parts || String(l.car_name || "").trim();
  if (!name || /^(new|used|\d{4})$/i.test(name)) return "Voiture d'occasion à Dubai";
  return name;
}

// The plain shell, still anchored to the root. Every branch needs this: a
// sold car reached from an old WhatsApp link is served from /voiture/<slug>
// too, and without the base tag its scripts 404 and the buyer watches a
// spinner forever instead of being told the car is gone.
function plainShell(base) {
  return base
    .replace(/<head([^>]*)>/i, `<head$1>\n<base href="/">`)
    .replace(/<\/head>/i, '<meta name="robots" content="noindex">\n</head>');
}

let SHELL = null;
function shell() {
  if (SHELL) return SHELL;
  for (const p of [
    path.join(__dirname, "voiture.html"),
    path.join(process.env.LAMBDA_TASK_ROOT || ".", "voiture.html"),
    path.join(__dirname, "..", "..", "voiture.html")
  ]) {
    try { SHELL = fs.readFileSync(p, "utf8"); return SHELL; } catch (e) { /* try next */ }
  }
  return null;
}

// Replace what the shell already declares, rather than appending duplicates —
// two <title> tags or two canonicals is worse than none.
function injectHead(html, tags, carId) {
  let out = html;
  // voiture.html lives at the site root and asks for "js/voiture.js" and
  // "css/style.css". Served from /voiture/<slug> those resolve one folder
  // deep — /voiture/js/voiture.js — and 404, so no stylesheet and no script
  // ever load and the page spins forever. This anchors every relative URL on
  // the page to the root: assets, the menu links, and the addresses the
  // scripts build at runtime (connexion.html?next=…). It must sit before the
  // first relative URL in the head to apply to it.
  out = out.replace(/<head([^>]*)>/i, `<head$1>\n<base href="/">`);
  out = out.replace(/<title>[\s\S]*?<\/title>/i, `<title>${tags.title}</title>`);
  out = out.replace(/<meta name="description" content="[^"]*">/i,
    `<meta name="description" content="${tags.desc}">`);
  // the canonical names THIS language version; the alternates below name the
  // whole set. If the English page canonicalised to the French one, Google
  // would merge them and drop every alternate.
  out = out.replace(/<link rel="canonical"[^>]*>/i,
    `<link rel="canonical" id="vd-canonical" href="${tags.self}">`);
  out = out.replace(/<meta property="og:title" content="[^"]*">/i,
    `<meta property="og:title" content="${tags.ogTitle}">`);
  out = out.replace(/<meta property="og:description" content="[^"]*">/i,
    `<meta property="og:description" content="${tags.desc}">`);
  out = out.replace(/<meta property="og:image" content="[^"]*">/i,
    `<meta property="og:image" content="${tags.image}">`);
  out = out.replace(/<meta property="og:type" content="[^"]*">/i,
    `<meta property="og:type" content="product">`);

  const extra = [
    // the car pages are the biggest group on the site; without these the
    // English and Arabic versions of a car do not exist as far as Google is
    // concerned, and only the French one can ever rank
    `<link rel="alternate" hreflang="fr" href="${tags.url}">`,
    `<link rel="alternate" hreflang="en" href="${tags.url}?lang=en">`,
    `<link rel="alternate" hreflang="ar" href="${tags.url}?lang=ar">`,
    `<link rel="alternate" hreflang="x-default" href="${tags.url}">`,
    `<meta property="og:url" content="${tags.self}">`,
    `<meta name="twitter:title" content="${tags.ogTitle}">`,
    `<meta name="twitter:description" content="${tags.desc}">`,
    `<meta name="twitter:image" content="${tags.image}">`,
    `<script type="application/ld+json" id="vd-ldjson">${tags.ld}</script>`,
    `<script>window.__CAR_ID=${JSON.stringify(carId)};window.__CAR_URL=${JSON.stringify(tags.url)};</script>`
  ].join("\n");
  return out.replace(/<\/head>/i, extra + "\n</head>");
}

exports.handler = async (event) => {
  const key = process.env.SUPABASE_SERVICE_KEY || SB_ANON;
  const slug = (event.path || "").replace(/^\/voiture\//, "").replace(/\/$/, "");
  const id = idFromSlug(slug) || (event.queryStringParameters || {}).id;
  const base = shell();

  // Without the shell we cannot render anything useful; send the buyer to the
  // working page rather than showing a broken one.
  if (!base) return { statusCode: 302, headers: { location: "/acheter.html" }, body: "" };

  // Demo cars are fictional and must never be indexed, but the demo tour has
  // to keep working — serve the shell and let the page's own JS run.
  if (id && String(id).startsWith("demo")) {
    return {
      statusCode: 200,
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
      body: plainShell(base)
    };
  }

  if (!id) {
    return {
      statusCode: 404,
      headers: { "content-type": "text/html; charset=utf-8" },
      body: plainShell(base)
    };
  }

  let l = null;
  try {
    const q = `${SB_URL}/rest/v1/listings?select=id,car_name,make,model,year,price,mileage,color,condition,description,photo_url,photos,city,created_at,hidden,dormant,active,sold,dealers!inner(name,verified,approved,suspended)&id=eq.${encodeURIComponent(id)}&active=eq.true&sold=eq.false&dealers.approved=eq.true&dealers.suspended=eq.false&limit=1`;
    const r = await fetch(q, { headers: { apikey: key, authorization: `Bearer ${key}` } });
    if (r.ok) {
      const rows = await r.json();
      l = rows && rows[0] && !rows[0].hidden && !rows[0].dormant ? rows[0] : null;
    }
  } catch (e) { l = null; }

  // Sold, hidden or unknown: still serve the page (the client shows "not
  // found"), but never let it into the index.
  if (!l) {
    return {
      statusCode: 404,
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
      body: plainShell(base)
    };
  }

  const canonical = `${SITE}/voiture/${carSlug(l)}`;
  // The pretty URL is the one address for this car. Anything else pointing at
  // the same listing redirects here, so ranking signals never split.
  if (event.path && event.path.startsWith("/voiture/") && event.path !== `/voiture/${carSlug(l)}`) {
    return { statusCode: 301, headers: { location: `/voiture/${carSlug(l)}` }, body: "" };
  }

  const name = carTitle(l);
  const year = l.year ? ` ${l.year}` : "";
  const kin = landed(l.price, "kinshasa");
  const photos = (Array.isArray(l.photos) ? l.photos : []).filter(Boolean);
  const image = photos[0] || l.photo_url || `${SITE}/assets/og-image.png`;

  // The title is what Google ranks and shows. Serving the French one on the
  // English URL makes the page read as French however much of the body the
  // browser translates afterwards.
  const lang = ((event.queryStringParameters || {}).lang || "fr").toLowerCase();
  const seller = (l.dealers && l.dealers.name) || null;
  const T = {
    fr: {
      title: `${name}${year} à Dubai — ${money(l.price)} | prix livré Kinshasa, Douala, Abidjan, Dakar`,
      desc: `${name}${year} à vendre à Dubai chez ${seller || "un vendeur vérifié"} : ${money(l.price)}.`
        + (kin ? ` Coût total estimé livré à Kinshasa ≈ ${money(kin)} (transport + douane, estimation).` : "")
        + ` Photos réelles, vendeur vérifié, discussion directe sur Yayo. Gratuit pour les acheteurs.`,
      og: `${name}${year} — ${money(l.price)} à Dubai`
    },
    en: {
      title: `${name}${year} for sale in Dubai — ${money(l.price)} | landed price Kinshasa, Douala, Abidjan, Dakar`,
      desc: `${name}${year} for sale in Dubai from ${seller || "a verified seller"}: ${money(l.price)}.`
        + (kin ? ` Estimated total landed cost to Kinshasa ≈ ${money(kin)} (shipping + customs, estimate).` : "")
        + ` Real photos, verified seller, message them directly on Yayo. Free for buyers.`,
      og: `${name}${year} — ${money(l.price)} in Dubai`
    },
    ar: {
      title: `${name}${year} للبيع في دبي — ${money(l.price)} | السعر شاملاً التوصيل إلى كينشاسا ودوالا وأبيدجان وداكار`,
      desc: `${name}${year} للبيع في دبي لدى ${seller || "بائع موثوق"}: ${money(l.price)}.`
        + (kin ? ` التكلفة الإجمالية التقديرية حتى كينشاسا ≈ ${money(kin)} (الشحن والجمارك، تقديري).` : "")
        + ` صور حقيقية، بائع موثوق، تواصل مباشر عبر Yayo. مجاني للمشترين.`,
      og: `${name}${year} — ${money(l.price)} في دبي`
    }
  };
  const M = T[lang] || T.fr;
  const title = M.title;
  const desc = M.desc;

  const ld = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Car",
        "name": `${name}${year}`.trim(),
        "url": canonical,
        "image": photos.length ? photos : [image],
        "description": l.description || desc,
        "brand": { "@type": "Brand", "name": /^\d{4}$/.test(String(l.make || "")) ? name.split(" ")[0] : (l.make || name.split(" ")[0]) },
        "model": l.model || undefined,
        "vehicleModelDate": l.year || undefined,
        "color": l.color || undefined,
        "itemCondition": "https://schema.org/UsedCondition",
        "mileageFromOdometer": l.mileage ? { "@type": "QuantitativeValue", "value": l.mileage, "unitCode": "KMT" } : undefined,
        "offers": {
          "@type": "Offer",
          "price": Math.round(l.price),
          "priceCurrency": "USD",
          "availability": "https://schema.org/InStock",
          "url": canonical,
          "itemCondition": "https://schema.org/UsedCondition",
          "seller": {
            "@type": "AutoDealer",
            "name": (l.dealers && l.dealers.name) || "Vendeur vérifié Yayo",
            "areaServed": ["CD", "CM", "CI", "SN", "AE"]
          }
        }
      },
      {
        "@type": "BreadcrumbList",
        "itemListElement": [
          { "@type": "ListItem", "position": 1, "name": "Accueil", "item": SITE + "/" },
          { "@type": "ListItem", "position": 2, "name": "Voitures à Dubai", "item": SITE + "/acheter.html" },
          { "@type": "ListItem", "position": 3, "name": `${name}${year}`.trim(), "item": canonical }
        ]
      }
    ]
  };

  const selfUrl = lang !== "fr" && T[lang] ? `${canonical}?lang=${lang}` : canonical;

  const body = injectHead(base, {
    title: esc(title),
    desc: esc(desc),
    url: esc(canonical),
    self: esc(selfUrl),
    ogTitle: esc(M.og),
    image: esc(image),
    ld: JSON.stringify(ld).replace(/</g, "\\u003c")
  }, l.id);

  return {
    statusCode: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      // Short cache: a car can sell at any moment, and a sold car must drop
      // out of the index quickly.
      "cache-control": "public, max-age=300, stale-while-revalidate=3600"
    },
    body
  };
};
