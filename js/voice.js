// ═══════════════════════════════════════════════════════════
// YAYO — voice notes, documents, and the review step
// Shared by all four chat surfaces (car, agency, buyer inbox, dashboard).
//
// The rule that makes voice work here: THE SENDER READS THE TRANSCRIPT
// BEFORE IT LEAVES. A dealer speaking approximate English and a buyer
// speaking French are the normal case, and the only person who can tell
// whether the machine understood is the one who spoke. Correcting on the
// receiving side is guessing; correcting on the sending side is knowing.
//
// The original audio always travels with the transcript, so the other side
// can listen to the real voice whenever the words look wrong.
// ═══════════════════════════════════════════════════════════

const YV = {
  rec: null, chunks: [], stream: null, started: 0, timer: null,
  blob: null, url: null, waveform: "", duration: 0, transcript: "",
  convoId: null, onSent: null, analyser: null, raf: 0
};

// ── Is recording even possible here ──────────────────────────────────
function yayoCanRecord() {
  return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
}
function yvMime() {
  const want = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
  for (const m of want) if (window.MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m)) return m;
  return "";
}

// ── Start / stop ─────────────────────────────────────────────────────
async function yayoVoiceStart(convoId, onSent) {
  if (!yayoCanRecord()) { alert(t("v_no_mic")); return; }
  try {
    YV.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    });
  } catch (e) {
    yvBar(false);
    alert(t("v_denied"));
    return;
  }
  YV.convoId = convoId; YV.onSent = onSent;
  YV.chunks = []; YV.started = Date.now();
  const type = yvMime();
  YV.rec = new MediaRecorder(YV.stream, type ? { mimeType: type } : undefined);
  YV.rec.ondataavailable = e => { if (e.data && e.data.size) YV.chunks.push(e.data); };
  YV.rec.onstop = yvFinish;
  YV.rec.start();
  yvBar(true);
  yvLiveMeter();
  YV.timer = setInterval(yvTick, 200);
}
function yayoVoiceStop() {
  if (YV.rec && YV.rec.state === "recording") YV.rec.stop();
}
function yayoVoiceCancel() {
  YV.cancelled = true;
  if (YV.rec && YV.rec.state === "recording") YV.rec.stop();
  else yvCleanup();
  yvBar(false);
}
function yvCleanup() {
  clearInterval(YV.timer); YV.timer = null;
  cancelAnimationFrame(YV.raf); YV.raf = 0;
  if (YV.stream) YV.stream.getTracks().forEach(tr => tr.stop());
  YV.stream = null; YV.rec = null; YV.analyser = null;
}
function yvTick() {
  const el = document.getElementById("yv-time");
  if (el) el.textContent = yayoDur(Date.now() - YV.started);
}
function yayoDur(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
}

// ── The recording bar, in place of the composer ──────────────────────
function yvBar(on) {
  const bar = document.getElementById("yv-bar");
  if (!bar) return;
  bar.hidden = !on;
  if (on) {
    bar.innerHTML = `
      <button type="button" class="yv-x" onclick="yayoVoiceCancel()" aria-label="${t("v_cancel")}">✕</button>
      <span class="yv-dot" aria-hidden="true"></span>
      <span class="yv-live" id="yv-live"></span>
      <span class="yv-t" id="yv-time">0:00</span>
      <button type="button" class="yv-stop" onclick="yayoVoiceStop()">${t("v_stop")}</button>`;
  } else {
    bar.innerHTML = "";
  }
}
// A live meter, because a recorder with no feedback feels broken.
function yvLiveMeter() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const src = ctx.createMediaStreamSource(YV.stream);
    const an = ctx.createAnalyser();
    an.fftSize = 256;
    src.connect(an);
    YV.analyser = an;
    const data = new Uint8Array(an.frequencyBinCount);
    const bars = 24;
    const draw = () => {
      const host = document.getElementById("yv-live");
      if (!host || !YV.analyser) return;
      an.getByteTimeDomainData(data);
      let peak = 0;
      for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i] - 128) / 128);
      const h = Math.max(0.12, Math.min(1, peak * 2.4));
      if (!host.children.length) {
        host.innerHTML = Array.from({ length: bars }, () => "<i></i>").join("");
      }
      const kids = host.children;
      for (let i = 0; i < kids.length - 1; i++) kids[i].style.height = kids[i + 1].style.height || "12%";
      kids[kids.length - 1].style.height = (h * 100).toFixed(0) + "%";
      YV.raf = requestAnimationFrame(draw);
    };
    draw();
  } catch (e) { /* the meter is decoration; recording still works */ }
}

// ── Stopped: shape, upload, transcribe, then ASK ─────────────────────
async function yvFinish() {
  const cancelled = YV.cancelled;
  YV.cancelled = false;
  const type = (YV.rec && YV.rec.mimeType) || "audio/webm";
  const blob = new Blob(YV.chunks, { type });
  YV.duration = Date.now() - YV.started;
  yvCleanup();
  yvBar(false);
  if (cancelled) return;
  if (!blob.size || YV.duration < 700) { alert(t("v_too_short")); return; }

  YV.blob = blob;
  YV.waveform = await yvWaveform(blob);
  yvSheet("loading");
  const text = await yvTranscribe(blob, YAYO_LANG);
  YV.transcript = text;
  yvSheet(text === null ? "failed" : text === "" ? "empty" : "ready");
}

// 40 values, 0-9: drawn the instant a bubble appears, long before the
// audio itself has been fetched.
async function yvWaveform(blob) {
  try {
    const buf = await blob.arrayBuffer();
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const audio = await ctx.decodeAudioData(buf.slice(0));
    const raw = audio.getChannelData(0);
    const N = 40, step = Math.floor(raw.length / N) || 1;
    const peaks = [];
    for (let i = 0; i < N; i++) {
      let p = 0;
      for (let j = 0; j < step; j += 16) p = Math.max(p, Math.abs(raw[i * step + j] || 0));
      peaks.push(p);
    }
    ctx.close && ctx.close();
    const max = Math.max(0.01, ...peaks);
    return peaks.map(p => Math.max(1, Math.round((p / max) * 9))).join("");
  } catch (e) {
    return "5".repeat(40);         // a flat shape is better than none
  }
}

async function yvTranscribe(blob, lang) {
  try {
    const fd = new FormData();
    fd.append("audio", blob, "voice.webm");
    fd.append("lang", lang || "fr");
    const r = await fetch("/.netlify/functions/transcribe", { method: "POST", body: fd });
    if (!r.ok) return null;
    const out = await r.json();
    if (out.error) return null;
    return String(out.text || "");
  } catch (e) { return null; }
}

// ── The review sheet — the whole point of the feature ────────────────
function yvSheet(state) {
  document.getElementById("yv-sheet") && document.getElementById("yv-sheet").remove();
  const d = document.createElement("div");
  d.id = "yv-sheet";
  d.className = "yv-sheet";
  d.innerHTML = `<div class="yv-box" role="dialog" aria-modal="true">${yvSheetBody(state)}</div>`;
  document.body.appendChild(d);
  d.addEventListener("click", e => { if (e.target === d) yvClose(); });
}
function yvSheetBody(state) {
  const wave = yayoWaveHtml(YV.waveform, "yv-preview-wave");
  const head = `
    <div class="yv-head">
      <b>${t("v_review_h")}</b>
      <button type="button" class="yv-x" onclick="yvClose()" aria-label="${t("v_cancel")}">✕</button>
    </div>
    <div class="yv-player" id="yv-preview" onclick="yvPreviewToggle()">
      <span class="yv-play" id="yv-preview-btn" aria-hidden="true">▶</span>
      ${wave}
      <span class="yv-len">${yayoDur(YV.duration)}</span>
    </div>`;
  if (state === "loading") {
    return head + `<p class="yv-wait">${t("v_reading")}</p>` + yvActions(true);
  }
  if (state === "failed" || state === "empty") {
    return head + `
      <p class="yv-warn">${t(state === "empty" ? "v_empty" : "v_failed")}</p>
      <p class="yv-sub">${t("v_send_anyway_p")}</p>` + yvActions(false);
  }
  return head + `
    <p class="yv-ask">${t("v_ask")}</p>
    <div class="yv-tr">${yvHighlight(YV.transcript)}</div>` + yvActions(false);
}
function yvActions(busy) {
  return `
    <div class="yv-acts">
      <button type="button" class="yv-again" onclick="yvClose()">${t("v_again")}</button>
      <button type="button" class="yv-send" id="yv-send" ${busy ? "disabled" : ""} onclick="yvSend()">${t("v_send")}</button>
    </div>`;
}
// Numbers are what a car deal turns on, so they are shown as themselves.
function yvHighlight(s) {
  const esc = String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return esc
    .replace(/\[(inaudible|passage inaudible|silence)\]/gi, '<em class="yv-gap">[$1]</em>')
    .replace(/(\d[\d\s.,]{2,}\d|\b\d{2,}\b)/g, '<b class="yv-num">$1</b>');
}
function yvClose() {
  const s = document.getElementById("yv-sheet");
  if (s) s.remove();
  yvStopPreview();
  if (YV.url) { URL.revokeObjectURL(YV.url); YV.url = null; }
  YV.blob = null;
}

// listen back before sending
let YV_AUDIO = null;
function yvPreviewToggle() {
  if (!YV.blob) return;
  const btn = document.getElementById("yv-preview-btn");
  if (YV_AUDIO && !YV_AUDIO.paused) { yvStopPreview(); return; }
  if (!YV.url) YV.url = URL.createObjectURL(YV.blob);
  YV_AUDIO = new Audio(YV.url);
  YV_AUDIO.onended = yvStopPreview;
  YV_AUDIO.ontimeupdate = () => {
    const pct = YV_AUDIO.duration ? (YV_AUDIO.currentTime / YV_AUDIO.duration) * 100 : 0;
    yvFill("yv-preview-wave", pct);
  };
  YV_AUDIO.play().catch(() => {});
  if (btn) btn.textContent = "❚❚";
}
function yvStopPreview() {
  if (YV_AUDIO) { YV_AUDIO.pause(); YV_AUDIO = null; }
  const btn = document.getElementById("yv-preview-btn");
  if (btn) btn.textContent = "▶";
  yvFill("yv-preview-wave", 0);
}
function yvFill(id, pct) {
  const host = document.getElementById(id);
  if (!host) return;
  const bars = host.children, n = bars.length;
  for (let i = 0; i < n; i++) bars[i].classList.toggle("on", (i / n) * 100 <= pct);
}

// ── Send ─────────────────────────────────────────────────────────────
async function yvSend() {
  const btn = document.getElementById("yv-send");
  if (btn) { btn.disabled = true; btn.textContent = t("v_sending"); }

  // A number said out loud is a number said (§49). The transcript goes
  // through exactly the same filter as a typed message — this is why the
  // transcript is kept rather than thrown away after translation.
  if (YV.transcript && typeof yayoContactsIn === "function" && yayoContactsIn(YV.convoId, YV.transcript).length) {
    const box = document.querySelector(".yv-box");
    if (box) {
      box.innerHTML = `
        <div class="yv-head"><b>${t("v_blocked_h")}</b>
          <button type="button" class="yv-x" onclick="yvClose()">✕</button></div>
        <p class="yv-warn">${t("chat_no_contact")}</p>
        <div class="yv-acts"><button type="button" class="yv-send" onclick="yvClose()">${t("v_again")}</button></div>`;
    }
    if (typeof yayoFlagContact === "function") yayoFlagContact(YV.convoId);
    return;
  }

  try {
    const user = await yayoUser();
    if (!user) throw new Error("not signed in");
    const ext = /mp4/.test(YV.blob.type) ? "m4a" : /ogg/.test(YV.blob.type) ? "ogg" : "webm";
    const path = "voice/" + YV.convoId + "/" + Date.now() + "-" + Math.random().toString(36).slice(2, 6) + "." + ext;
    const up = await yayoSB().storage.from("car-photos").upload(path, YV.blob, { contentType: YV.blob.type });
    if (up.error) throw up.error;
    const url = yayoSB().storage.from("car-photos").getPublicUrl(path).data.publicUrl;

    const row = {
      conversation_id: YV.convoId, sender_id: user.id,
      content: YV.transcript || "🎤",
      audio_url: url, transcript: YV.transcript || null,
      duration_ms: YV.duration, waveform: YV.waveform
    };
    let { error } = await yayoSB().from("messages").insert(row);
    if (error) {   // before setup.sql §51 has been run
      const plain = { conversation_id: row.conversation_id, sender_id: row.sender_id, content: row.content };
      const again = await yayoSB().from("messages").insert(plain);
      if (again.error) throw again.error;
    }
    yayoNotifyMessage(YV.convoId);
    const sent = { audio_url: url, transcript: YV.transcript, duration_ms: YV.duration, waveform: YV.waveform };
    yvClose();
    if (YV.onSent) YV.onSent(sent);
  } catch (e) {
    const box = document.querySelector(".yv-box");
    if (box) box.innerHTML = `<p class="yv-warn">${t("chat_send_fail")}</p>
      <div class="yv-acts"><button type="button" class="yv-send" onclick="yvClose()">${t("d_cancel")}</button></div>`;
  }
}

// ── Rendering a voice message in the thread ──────────────────────────
function yayoWaveHtml(waveform, id) {
  const w = String(waveform || "5".repeat(40)).slice(0, 40);
  const bars = w.split("").map(ch => {
    const h = Math.max(8, (parseInt(ch, 10) || 1) * 11);
    return `<i style="height:${h}%"></i>`;
  }).join("");
  return `<span class="yv-wave"${id ? ` id="${id}"` : ""}>${bars}</span>`;
}
let YV_PLAYING = null;
function yayoPlayVoice(btnId, waveId, url) {
  if (YV_PLAYING && YV_PLAYING.url === url) { yvStopThread(); return; }
  yvStopThread();
  const a = new Audio(url);
  YV_PLAYING = { audio: a, url, btnId, waveId };
  a.onended = yvStopThread;
  a.ontimeupdate = () => yvFill(waveId, a.duration ? (a.currentTime / a.duration) * 100 : 0);
  a.play().catch(() => {});
  const b = document.getElementById(btnId);
  if (b) b.textContent = "❚❚";
}
function yvStopThread() {
  if (!YV_PLAYING) return;
  YV_PLAYING.audio.pause();
  const b = document.getElementById(YV_PLAYING.btnId);
  if (b) b.textContent = "▶";
  yvFill(YV_PLAYING.waveId, 0);
  YV_PLAYING = null;
}
// text = what the reader should see (translated for the other side)
function yayoVoiceHtml(m, text) {
  const uid = "v" + Math.random().toString(36).slice(2, 8);
  const esc = s => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `
    <span class="yv-player thread" onclick="yayoPlayVoice('${uid}b','${uid}w','${esc(m.audio_url)}')">
      <span class="yv-play" id="${uid}b" aria-hidden="true">▶</span>
      ${yayoWaveHtml(m.waveform, uid + "w")}
      <span class="yv-len">${yayoDur(m.duration_ms || 0)}</span>
    </span>
    ${text ? `<span class="yv-said">${yvHighlight(text)}</span>` : ""}`;
}

// ── Documents ────────────────────────────────────────────────────────
const YV_DOC_MAX = 10 * 1024 * 1024;
const YV_DOC_OK = /\.(pdf|docx?|xlsx?|jpe?g|png|webp|heic)$/i;
async function yayoSendDoc(convoId, file, onSent) {
  if (!file) return;
  if (!YV_DOC_OK.test(file.name)) { alert(t("v_doc_type")); return; }
  if (file.size > YV_DOC_MAX) { alert(t("v_doc_big")); return; }
  const user = await yayoUser();
  if (!user) return;
  const safe = file.name.replace(/[^A-Za-z0-9._-]/g, "_").slice(-60);
  const path = "docs/" + convoId + "/" + Date.now() + "-" + safe;
  const up = await yayoSB().storage.from("car-photos").upload(path, file, { contentType: file.type || "application/octet-stream" });
  if (up.error) throw up.error;
  const url = yayoSB().storage.from("car-photos").getPublicUrl(path).data.publicUrl;
  const row = {
    conversation_id: convoId, sender_id: user.id, content: "📎 " + file.name,
    file_url: url, file_name: file.name.slice(0, 120), file_size: file.size
  };
  let { error } = await yayoSB().from("messages").insert(row);
  if (error) {
    const again = await yayoSB().from("messages")
      .insert({ conversation_id: convoId, sender_id: user.id, content: row.content });
    if (again.error) throw again.error;
  }
  yayoNotifyMessage(convoId);
  if (onSent) onSent({ file_url: url, file_name: file.name, file_size: file.size });
  return url;
}
function yayoDocHtml(m) {
  const esc = s => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const kb = m.file_size ? (m.file_size > 1048576
    ? (m.file_size / 1048576).toFixed(1) + " MB"
    : Math.max(1, Math.round(m.file_size / 1024)) + " KB") : "";
  const ext = (String(m.file_name || "").split(".").pop() || "").toUpperCase().slice(0, 4);
  return `<a class="yv-doc" href="${esc(m.file_url)}" target="_blank" rel="noopener">
    <span class="yv-doc-i">${esc(ext)}</span>
    <span class="yv-doc-t"><b>${esc(m.file_name || "document")}</b><span>${kb}</span></span>
  </a>`;
}
