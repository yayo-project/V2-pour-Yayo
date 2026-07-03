// ═══════════════════════════════════════════════
// YAYO — Car detail (voiture.html)
// Loads one listing (Supabase or demo), landed cost
// per city, dealer card, in-app chat.
// ═══════════════════════════════════════════════

const DEST = YAYO_CONFIG.DESTINATIONS;
let CUR = YAYO_CONFIG.DEFAULT_DEST;
let CAR = null;
let CONVO = null;
const CAR_ID = new URLSearchParams(location.search).get("id") || "";

function fmt(n) { return "$" + Math.round(n).toLocaleString("fr-FR").replace(/ /g, " "); }
function escapeHtml(s) { return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
function toggleMenu() { document.getElementById("mmenu").classList.toggle("open"); }

async function loadCar() {
  if (CAR_ID.startsWith("demo-") || CAR_ID === "") {
    CAR = window.YAYO_DEMO.find(c => c.id === CAR_ID) || null;
    if (!CAR && CAR_ID === "") CAR = window.YAYO_DEMO[0];
  } else {
    try {
      const { data, error } = await yayoSB()
        .from("listings")
        .select("*, dealers(id, name, verified, city)")
        .eq("id", CAR_ID).maybeSingle();
      if (!error && data) {
        CAR = {
          id: data.id,
          dealer_id: data.dealer_id,
          car_name: data.car_name,
          year: data.year,
          mileage: data.mileage,
          fuel: data.fuel || "",
          condition: data.condition || "",
          color: data.color || "",
          body: data.body || "",
          price: data.price,
          ai: "good",
          photo_url: data.photo_url,
          description: data.description || "",
          dealer: { name: (data.dealers && data.dealers.name) || "Dealer Yayo", verified: !!(data.dealers && data.dealers.verified) }
        };
      }
    } catch (e) { CAR = null; }
  }
  render();
}

function render() {
  document.getElementById("vd-loading").hidden = true;
  if (!CAR) { document.getElementById("vd-notfound").hidden = false; return; }
  document.getElementById("vd-content").hidden = false;
  document.title = CAR.car_name + " — Yayo";

  document.getElementById("crumb-name").textContent = CAR.car_name;
  document.getElementById("vd-title").textContent = CAR.car_name;
  document.getElementById("vd-meta").textContent =
    [CAR.mileage ? CAR.mileage.toLocaleString("fr-FR") + " km" : "", CAR.fuel].filter(Boolean).join(" · ");
  document.getElementById("vd-price").textContent = fmt(CAR.price);

  const img = document.getElementById("vd-img");
  img.alt = CAR.car_name;
  img.onerror = function () { this.parentNode.classList.add("noimg"); this.remove(); };
  img.src = CAR.photo_url || "";

  const ai = document.getElementById("vd-ai");
  ai.className = "ai-badge " + (CAR.ai === "good" ? "ai-good" : "ai-nego");
  ai.textContent = CAR.ai === "good" ? "✓ Bon prix" : "~ Négociable";

  const specs = [
    ["Année", CAR.year], ["Kilométrage", CAR.mileage ? CAR.mileage.toLocaleString("fr-FR") + " km" : ""],
    ["Carburant", CAR.fuel], ["Carrosserie", CAR.body],
    ["Couleur", CAR.color], ["État", CAR.condition]
  ].filter(s => s[1]);
  document.getElementById("vd-specs").innerHTML =
    specs.map(s => `<div class="vd-spec"><span>${s[0]}</span><b>${escapeHtml(String(s[1]))}</b></div>`).join("");

  document.getElementById("vd-desc").textContent = CAR.description || "Contactez le dealer pour plus de détails sur ce véhicule.";

  const d = CAR.dealer;
  document.getElementById("vd-dealer-av").textContent = d.name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
  document.getElementById("vd-dealer-name").textContent = d.name;
  document.getElementById("vd-dealer-badge").innerHTML = d.verified
    ? '<span class="vcheck"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="4"><path d="M20 6L9 17l-5-5"/></svg></span> Vérifié Yayo · Dubai'
    : "Dubai";

  renderCities();
  renderBreakdown();
  renderSimilar();
}

function renderCities() {
  const el = document.getElementById("vd-cities");
  el.innerHTML = Object.keys(DEST).map(k =>
    `<button type="button" class="${k === CUR ? "on" : ""}" data-k="${k}">${DEST[k].flag} ${DEST[k].name}</button>`).join("");
  el.querySelectorAll("button").forEach(b => b.addEventListener("click", () => {
    CUR = b.dataset.k;
    el.querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b));
    renderBreakdown();
  }));
}

function renderBreakdown() {
  const box = document.getElementById("vd-breakdown");
  const d = DEST[CUR];
  if (CUR === "dubai") {
    box.innerHTML = `<div class="cost-total"><span>Sur place à Dubai</span><span class="val">${fmt(CAR.price)}</span></div>`;
    return;
  }
  const duty = CAR.price * d.duty;
  const total = CAR.price + d.ship + duty + d.fees;
  box.innerHTML = `
    <div class="cost-line"><span>Prix voiture (Dubai)</span><b>${fmt(CAR.price)}</b></div>
    <div class="cost-line"><span>Transport maritime</span><b>${fmt(d.ship)}</b></div>
    <div class="cost-line"><span>Douane &amp; taxes (est.)</span><b>${fmt(duty)}</b></div>
    <div class="cost-line"><span>Frais port &amp; dossier</span><b>${fmt(d.fees)}</b></div>
    <div class="cost-total"><span>Rendu ${d.name}</span><span class="val">${fmt(total)}</span></div>`;
}

function renderSimilar() {
  const pool = window.YAYO_DEMO.filter(c => c.id !== CAR.id && (c.body === CAR.body || c.car_name.split(" ")[0] === CAR.car_name.split(" ")[0])).slice(0, 3);
  if (!pool.length) return;
  document.getElementById("vd-similar-sec").hidden = false;
  const dst = DEST[YAYO_CONFIG.DEFAULT_DEST];
  document.getElementById("vd-similar").innerHTML = pool.map(c => `
  <div class="car-card" onclick="location.href='voiture.html?id=${c.id}'">
    <div class="car-img">
      <img src="${c.photo_url}" alt="${escapeHtml(c.car_name)}" loading="lazy" onerror="this.parentNode.classList.add('noimg');this.remove()">
      <span class="ai-badge ${c.ai === "good" ? "ai-good" : "ai-nego"}">${c.ai === "good" ? "✓ Bon prix" : "~ Négociable"}</span>
    </div>
    <div class="car-body">
      <div class="car-title">${escapeHtml(c.car_name)}</div>
      <div class="car-meta">${c.mileage.toLocaleString("fr-FR")} km · ${escapeHtml(c.fuel)}</div>
      <div class="car-price-row"><span class="car-price">${fmt(c.price)}</span><span class="car-price-lbl">à Dubai</span></div>
    </div>
  </div>`).join("");
}

// ── In-app chat (phase 5) ──
async function openChat() {
  const user = await yayoUser();
  if (!user) {
    location.href = "connexion.html?next=" + encodeURIComponent("voiture.html?id=" + CAR_ID);
    return;
  }
  const panel = document.getElementById("vd-chat");
  panel.hidden = false;
  document.getElementById("vd-contact").style.display = "none";
  panel.scrollIntoView({ behavior: "smooth", block: "center" });

  if (String(CAR.id).startsWith("demo")) {
    addBubble("yayo", "Ceci est une annonce de démonstration — le chat sera actif avec les vrais dealers. Explorez librement !");
    return;
  }
  try {
    const sb = yayoSB();
    let { data: convo } = await sb.from("conversations")
      .select("id").eq("listing_id", CAR.id).eq("buyer_id", user.id).maybeSingle();
    if (!convo) {
      const ins = await sb.from("conversations")
        .insert({ listing_id: CAR.id, buyer_id: user.id, dealer_id: CAR.dealer_id })
        .select("id").single();
      convo = ins.data;
    }
    CONVO = convo;
    if (!CONVO) throw new Error("no convo");
    const { data: msgs } = await sb.from("messages")
      .select("sender_id, content, created_at")
      .eq("conversation_id", CONVO.id).order("created_at", { ascending: true }).limit(100);
    (msgs || []).forEach(m => addBubble(m.sender_id === user.id ? "me" : "them", m.content));
    if (!msgs || !msgs.length) addBubble("yayo", "Posez votre question au dealer — il vous répond ici, sur Yayo.");
  } catch (e) {
    addBubble("yayo", "Le chat s'active dès que le dealer confirme son compte. Réessayez un peu plus tard.");
  }
}

function addBubble(who, text) {
  const box = document.getElementById("chat-box");
  const b = document.createElement("div");
  b.className = "chat-b chat-" + who;
  b.textContent = text;
  box.appendChild(b);
  box.scrollTop = box.scrollHeight;
}

async function sendMsg(e) {
  e.preventDefault();
  const input = document.getElementById("chat-input");
  const text = input.value.trim();
  if (!text) return false;
  input.value = "";
  addBubble("me", text);
  if (String(CAR.id).startsWith("demo") || !CONVO) {
    setTimeout(() => addBubble("yayo", "Message bien reçu ! Sur une vraie annonce, le dealer vous répond directement ici."), 600);
    return false;
  }
  try {
    const user = await yayoUser();
    await yayoSB().from("messages").insert({ conversation_id: CONVO.id, sender_id: user.id, content: text });
  } catch (err) { /* bubble already shown; sync will retry next load */ }
  return false;
}

loadCar();
