// ═══════════════════════════════════════════════
// YAYO — "Combien pour l'expédier ?" (shipping quote request)
// Agencies set their own prices, and a real price depends on the CAR
// (a Land Cruiser costs more than a sedan), its year, and whether the
// buyer wants a full container or a shared one. So the buyer never types
// a brief: they tap one button and Yayo sends the agency the car itself
// — its PHOTO plus make/model/year, the destination and the container
// choice — as a normal chat message.
//
// What the agency deliberately never receives: Yayo's estimated landed
// total. If an agency saw the buyer's total budget it could price up to
// it. They quote on the car, nothing else.
//
//   yayoQuoteOpen({ car, city, agencies })   — one agency or many
// Used by voiture.html (ask everyone serving the city), agences.html and
// agence.html (ask this one).
// ═══════════════════════════════════════════════

let QUOTE = { car: null, city: "", agencies: [], busy: false };

function qEsc(s) { return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
function qCityName(k) { const d = (YAYO_CONFIG.DESTINATIONS || {})[k]; return (d && d.name) || k || ""; }
function qIsDemo(x) { return String(x || "").startsWith("demo") || String(x || "").startsWith("ag-demo"); }

// The car in words, for the message: "Toyota Land Cruiser GXR 2021"
function qCarLabel(car) {
  if (!car) return "";
  const name = car.car_name || [car.make, car.model].filter(Boolean).join(" ") || "";
  const y = car.year && !new RegExp("\\b" + car.year + "\\b").test(name) ? " " + car.year : "";
  return (name + y).trim();
}

function yayoQuoteOpen(opts) {
  opts = opts || {};
  QUOTE.car = opts.car || null;
  QUOTE.city = opts.city || "";
  QUOTE.agencies = (opts.agencies || []).filter(Boolean);
  if (!QUOTE.agencies.length) { yayoToast(t("q_none")); return; }

  let ov = document.getElementById("q-overlay");
  if (!ov) {
    ov = document.createElement("div");
    ov.id = "q-overlay";
    ov.className = "rp-overlay";
    ov.innerHTML = `
      <div class="rp-modal" role="dialog" aria-modal="true">
        <button type="button" class="rp-close" aria-label="✕" onclick="yayoQuoteClose()">✕</button>
        <h3 id="q-h"></h3>
        <p class="rp-sub" id="q-sub"></p>
        <div class="q-car" id="q-car"></div>
        <label class="q-lbl">${t("q_container")}</label>
        <div class="q-opts" id="q-opts"></div>
        <p class="q-privacy" id="q-privacy"></p>
        <p class="auth-error" id="q-err" hidden></p>
        <div class="rp-actions">
          <button type="button" class="btn btn-solid" id="q-send" onclick="yayoQuoteSend()"></button>
          <button type="button" class="btn btn-ghost-dark" onclick="yayoQuoteClose()">${t("d_cancel")}</button>
        </div>
        <div class="q-done" id="q-done" hidden></div>
      </div>`;
    ov.addEventListener("click", ev => { if (ev.target === ov) yayoQuoteClose(); });
    document.body.appendChild(ov);
    // container choice = plain radio pills
    ov.addEventListener("click", ev => {
      const b = ev.target.closest(".q-opt");
      if (!b) return;
      ov.querySelectorAll(".q-opt").forEach(x => x.classList.toggle("on", x === b));
    });
  }

  const n = QUOTE.agencies.length;
  document.getElementById("q-h").textContent = t("q_h").replace("{city}", qCityName(QUOTE.city));
  document.getElementById("q-sub").textContent = n > 1
    ? t("q_sub_many").replace("{n}", n)
    : t("q_sub_one").replace("{name}", QUOTE.agencies[0].name || "");

  // the car, exactly as the agency will see it
  const photo = QUOTE.car && (QUOTE.car.photo_url || (QUOTE.car.photos || [])[0]);
  document.getElementById("q-car").innerHTML = `
    ${photo ? `<img src="${qEsc(photo)}" alt="" referrerpolicy="no-referrer">` : ""}
    <div class="q-car-txt">
      <b>${qEsc(qCarLabel(QUOTE.car))}</b>
      <span>Dubai → ${qEsc(qCityName(QUOTE.city))}</span>
    </div>`;

  document.getElementById("q-opts").innerHTML = [
    ["unsure", t("q_unsure")], ["shared", t("q_shared")], ["full", t("q_full")]
  ].map(([v, lbl], i) =>
    `<button type="button" class="q-opt${i === 0 ? " on" : ""}" data-v="${v}">${qEsc(lbl)}</button>`).join("");

  document.getElementById("q-privacy").textContent = t("q_privacy");
  document.getElementById("q-send").textContent = n > 1 ? t("q_send_many").replace("{n}", n) : t("q_send_one");
  document.getElementById("q-err").hidden = true;
  document.getElementById("q-done").hidden = true;
  document.querySelector("#q-overlay .rp-actions").hidden = false;
  document.getElementById("q-opts").hidden = false;
  document.getElementById("q-car").hidden = false;
  document.querySelector("#q-overlay .q-lbl").hidden = false;
  QUOTE.busy = false;
  ov.classList.add("open");
}

function yayoQuoteClose() {
  if (QUOTE.busy) return;
  const ov = document.getElementById("q-overlay");
  if (ov) ov.classList.remove("open");
}

async function yayoQuoteSend() {
  if (QUOTE.busy) return;
  const err = document.getElementById("q-err");
  err.hidden = true;
  const btn = document.getElementById("q-send");

  // Signing in is what lets the agency answer you — send them back here after.
  const user = await yayoUser();
  if (!user) {
    location.href = "connexion.html?next=" + encodeURIComponent(location.pathname.replace(/^\//, "") + location.search);
    return;
  }

  const pick = document.querySelector("#q-opts .q-opt.on");
  const container = pick ? pick.dataset.v : "unsure";
  const carLabel = qCarLabel(QUOTE.car);
  const photo = QUOTE.car && (QUOTE.car.photo_url || (QUOTE.car.photos || [])[0]);
  // Written in the buyer's own language — the agency reads it translated.
  // Deliberately contains NO total and no budget.
  const text = t("q_msg")
    .replace("{car}", carLabel)
    .replace("{city}", qCityName(QUOTE.city))
    .replace("{container}", t("q_msg_" + container));

  QUOTE.busy = true;
  btn.disabled = true;
  btn.textContent = t("q_sending");

  // Demo agencies (or a demo car) can't hold a real conversation.
  if (qIsDemo(QUOTE.car && QUOTE.car.id) || QUOTE.agencies.every(a => qIsDemo(a.id))) {
    setTimeout(() => { QUOTE.busy = false; quoteDone(QUOTE.agencies.length, true); }, 700);
    return;
  }

  let ok = 0;
  try {
    await yayoEnsureUserRow(user);
    const sb = yayoSB();
    for (const ag of QUOTE.agencies) {
      if (qIsDemo(ag.id)) continue;
      try {
        // one conversation per buyer↔agency, reused if it already exists
        let { data: convo } = await sb.from("conversations")
          .select("id").eq("agency_id", ag.id).eq("user_id", user.id).maybeSingle();
        if (!convo) {
          const ins = await sb.from("conversations")
            .insert({ agency_id: ag.id, user_id: user.id, car_name: "transport · " + carLabel, status: "open", dest: QUOTE.city || null })
            .select("id").single();
          convo = ins.data;
        }
        if (!convo) continue;
        // The photo goes FIRST, as its own message: a bubble shows either a
        // picture or text, never both — and the agency prices what it sees.
        if (photo) {
          await sb.from("messages").insert({ conversation_id: convo.id, sender_id: user.id, content: "📷", image_url: photo });
        }
        const { error } = await sb.from("messages")
          .insert({ conversation_id: convo.id, sender_id: user.id, content: text });
        if (error) throw error;
        yayoNotifyMessage(convo.id);
        ok++;
      } catch (e) { /* one agency failing must not stop the others */ }
    }
    if (!ok) throw new Error(t("q_err_none"));
    if (typeof yayoTrack === "function") yayoTrack("quote_request", { city: QUOTE.city, agencies: ok });
    QUOTE.busy = false;
    quoteDone(ok, false);
  } catch (e) {
    QUOTE.busy = false;
    btn.disabled = false;
    btn.textContent = QUOTE.agencies.length > 1 ? t("q_send_many").replace("{n}", QUOTE.agencies.length) : t("q_send_one");
    err.hidden = false;
    err.textContent = t("au_err_generic") + (typeof yayoErrMsg === "function" ? yayoErrMsg(e) : (e.message || e));
  }
}

function quoteDone(n, demo) {
  document.querySelector("#q-overlay .rp-actions").hidden = true;
  document.getElementById("q-opts").hidden = true;
  document.getElementById("q-car").hidden = true;
  document.querySelector("#q-overlay .q-lbl").hidden = true;
  document.getElementById("q-sub").textContent = "";
  const done = document.getElementById("q-done");
  done.hidden = false;
  done.innerHTML = `
    <div class="q-done-ico">✓</div>
    <b>${qEsc(t(demo ? "q_done_demo" : (n > 1 ? "q_done_many" : "q_done_one")).replace("{n}", n))}</b>
    <p>${qEsc(t("q_done_p"))}</p>
    ${demo ? "" : `<a class="btn btn-solid" href="messages.html">${qEsc(t("q_done_btn"))}</a>`}`;
}
