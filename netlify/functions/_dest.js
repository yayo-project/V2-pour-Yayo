// YAYO — destinations and the landed-cost formula, for server-rendered pages.
//
// These numbers MUST match js/config.js DESTINATIONS exactly. A server-rendered
// page is re-rendered by the same page's JavaScript a moment later, so if the
// two disagree the visitor watches the price change in front of them, and
// Google indexes a number the site does not actually show.
//
// Freight is an estimate until a real agency price is chosen. Customs comes
// from each country's published structure. Both are labelled "estimation"
// everywhere they are displayed, and neither is ever presented as final.
const DEST = {
  kinshasa: { name: "Kinshasa", ship: 1700, fees: 900, customs: { duty: 0.20, extra: 0.03,  vat: 0.16   } },
  douala:   { name: "Douala",   ship: 1450, fees: 520, customs: { duty: 0.30, extra: 0.00,  vat: 0.1925 } },
  abidjan:  { name: "Abidjan",  ship: 1550, fees: 520, customs: { duty: 0.20, extra: 0.025, vat: 0.18   } },
  dakar:    { name: "Dakar",    ship: 1500, fees: 500, customs: { duty: 0.20, extra: 0.024, vat: 0.18   } }
};

// Customs are computed on CIF (car + freight), the base a customs office
// actually uses, and VAT applies on top of the duty rather than beside it.
function customs(price, destKey) {
  const d = DEST[destKey];
  if (!d) return null;
  price = Number(price) || 0;
  const cif = price + d.ship;
  const duty = cif * d.customs.duty;
  const extra = cif * d.customs.extra;
  const vat = (cif + duty + extra) * d.customs.vat;
  return { cif, duty, extra, vat, ship: d.ship, fees: d.fees };
}

function landedTotal(price, destKey) {
  const c = customs(price, destKey);
  if (!c) return Number(price) || 0;
  return Math.round((Number(price) || 0) + c.ship + c.duty + c.extra + c.vat + c.fees);
}

// The site writes money with a non-breaking space so "$3 200" never wraps
const money = n => "$" + Math.round(Number(n) || 0).toLocaleString("en-US").replace(/,/g, " ");

module.exports = { DEST, customs, landedTotal, money };
