/* DJ Doktor v2 — arayüz (bağımlılık yok). */
"use strict";

const TOKEN = window.DJD_TOKEN;
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtN = (n) => (n || 0).toLocaleString("tr-TR");
const fold = (s) => String(s || "").toLocaleLowerCase("tr-TR").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ı/g, "i");
function fmtDur(s) {
  if (!s && s !== 0) return "";
  s = Math.round(s);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}` : `${m}:${String(x).padStart(2, "0")}`;
}
function fmtLong(s) {
  s = Math.round(s || 0);
  const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60);
  return h ? `${h} sa ${m} dk` : `${m} dk`;
}

const S = {
  st: null, tab: localStorage.getItem("djd.tab") || "music", view: "all",
  ov: null, rows: [], sel: new Set(), lastSel: null, q: "", dupes: null, musicKey: null,
  lists: null, cur: null, items: null, open: JSON.parse(localStorage.getItem("djd.open") || "{}"),
  pick: { q: "", gid: null, res: [] }, inbox: null,
  setup: null, setupData: null, setupFilter: "", stamp: null, busy: false, drag: null, editing: false,
};

// ---------------------------------------------------------------------------
// Sunucu
// ---------------------------------------------------------------------------
async function api(path, body) {
  const opt = { headers: { "X-DJD-Token": TOKEN } };
  if (body !== undefined) {
    opt.method = "POST";
    opt.headers["Content-Type"] = "application/json";
    opt.body = JSON.stringify(body);
  }
  const r = await fetch(path, opt);
  let data = null;
  try { data = await r.json(); } catch (e) { data = null; }
  if (!r.ok) {
    const err = new Error((data && data.error) || ("Sunucu hatası " + r.status));
    err.code = data && data.code;
    throw err;
  }
  return data;
}

async function task(path, body, opts = {}) {
  let res;
  try {
    res = await api(path, body);
  } catch (e) { toast(e.message, "err"); throw e; }
  if (!res || !res.task) return res;
  S.busy = true;
  const bar = $("#taskbar");
  try {
    for (;;) {
      const t = await api("/api/task/" + res.task);
      bar.innerHTML = `<div class="task"><div class="tt"><span>${esc(t.title)}</span><span class="muted">${Math.round(t.progress * 100)}%</span></div>
        <div class="msg">${esc(t.message || "")}</div><div class="prog"><i style="width:${Math.round(t.progress * 100)}%"></i></div></div>`;
      if (t.status === "bitti") { bar.innerHTML = ""; S.busy = false; return t.result; }
      if (t.status === "hata" || t.status === "iptal") {
        bar.innerHTML = ""; S.busy = false;
        if (t.code === "needs_force" && !opts.noForce) {
          const ok = await confirmBox("Emin misin?", t.error, "Yine de geri al", true);
          if (ok) return task(path, Object.assign({}, body, { force: true }), { noForce: true });
          throw new Error("vazgeçildi");
        }
        toast(t.error || "İşlem tamamlanamadı", "err");
        const e = new Error(t.error); e.code = t.code; throw e;
      }
      await sleep(t.status === "sirada" ? 300 : 450);
    }
  } finally { S.busy = false; }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function act(path, body, okMsg) {
  try {
    const r = await api(path, body);
    if (okMsg) toast(okMsg, "ok");
    await refresh();
    return r;
  } catch (e) {
    toast(e.message, "err");
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Küçük arayüz parçaları
// ---------------------------------------------------------------------------
function toast(msg, kind) {
  const el = document.createElement("div");
  el.className = "toast " + (kind || "");
  el.innerHTML = `<div>${esc(msg)}</div><button aria-label="Kapat">✕</button>`;
  $("#toasts").appendChild(el);
  const kill = () => el.remove();
  el.querySelector("button").onclick = kill;
  setTimeout(kill, kind === "err" ? 9000 : 4500);
}

function modal(html, cls = "") {
  const root = $("#modal");
  root.innerHTML = `<div class="overlay"><div class="dialog ${cls}">${html}</div></div>`;
  const ov = root.firstElementChild;
  const close = () => { root.innerHTML = ""; };
  ov.addEventListener("mousedown", (e) => { if (e.target === ov) close(); });
  const f = ov.querySelector("input:not([type=radio]):not([type=checkbox]), select, textarea");
  if (f) setTimeout(() => f.focus(), 30);
  return { el: ov, close };
}
function closeModal() { $("#modal").innerHTML = ""; }

function confirmBox(title, text, okLabel = "Tamam", danger = false) {
  return new Promise((resolve) => {
    const m = modal(`<div class="dh">${esc(title)}</div><div class="db">${esc(text)}</div>
      <div class="df"><button class="btn" data-x="no">Vazgeç</button><button class="btn ${danger ? "danger" : "primary"}" data-x="yes">${esc(okLabel)}</button></div>`);
    m.el.addEventListener("click", (e) => {
      const b = e.target.closest("[data-x]");
      if (!b) return;
      m.close(); resolve(b.dataset.x === "yes");
    });
  });
}

function promptBox(title, label, value = "", okLabel = "Kaydet", hint = "") {
  return new Promise((resolve) => {
    const m = modal(`<div class="dh">${esc(title)}</div><div class="db">
      <label class="field"><span>${esc(label)}</span><input id="pv" value="${esc(value)}"></label>${hint ? `<div class="muted small">${hint}</div>` : ""}</div>
      <div class="df"><button class="btn" data-x="no">Vazgeç</button><button class="btn primary" data-x="yes">${esc(okLabel)}</button></div>`);
    const inp = $("#pv", m.el);
    setTimeout(() => { inp.focus(); inp.select(); }, 40);
    const done = (ok) => { const v = inp.value.trim(); m.close(); resolve(ok && v ? v : null); };
    inp.addEventListener("keydown", (e) => { if (e.key === "Enter") done(true); if (e.key === "Escape") done(false); });
    m.el.addEventListener("click", (e) => { const b = e.target.closest("[data-x]"); if (b) done(b.dataset.x === "yes"); });
  });
}

function menu(ev, items) {
  ev.preventDefault();
  ev.stopPropagation();
  const root = $("#menu");
  const html = items.map((it, i) => {
    if (it === "-") return "<hr>";
    if (it.label && it.head) return `<div class="lab">${esc(it.label)}</div>`;
    return `<button data-i="${i}">${it.color ? `<span class="gdot" style="background:${esc(it.color)}"></span>` : `<span>${it.icon || ""}</span>`}${esc(it.label)}</button>`;
  }).join("");
  root.innerHTML = `<div class="menu">${html}</div>`;
  const m = root.firstElementChild;
  const anchor = ev.target && ev.target.closest ? ev.target.closest("button, .folder-chip, .chip, .nav-item, .gchip") : null;
  const r = anchor ? anchor.getBoundingClientRect() : { left: ev.clientX, bottom: ev.clientY, top: ev.clientY };
  let x = r.left, y = r.bottom + 4;
  m.style.left = "0px"; m.style.top = "0px";
  const w = m.offsetWidth, h = m.offsetHeight;
  if (x + w > innerWidth - 8) x = innerWidth - w - 8;
  if (y + h > innerHeight - 8) y = Math.max(8, (r.top || y) - h - 4);
  m.style.left = x + "px"; m.style.top = y + "px";
  m.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-i]");
    if (!b) return;
    root.innerHTML = "";
    const it = items[+b.dataset.i];
    if (it && it.fn) it.fn();
  });
}
document.addEventListener("mousedown", (e) => { if (!e.target.closest(".menu")) $("#menu").innerHTML = ""; });
document.addEventListener("focusin", (e) => { if (e.target.matches("input, textarea, select")) S.editing = true; });
document.addEventListener("focusout", (e) => { if (e.target.matches("input, textarea, select")) S.editing = false; });

function dotHtml(d, title) {
  const t = { ready: "Hazır: Engine'de, analiz edildi", pending: "Engine'de, analiz bekliyor", none: "Engine'de değil", problem: "Sorun var" }[d] || "";
  return `<span class="dot ${d || "none"}" title="${esc(title || t)}"></span>`;
}

function genreById(id) { return ((S.ov && S.ov.genres) || []).find((g) => g.id === +id); }

// ---------------------------------------------------------------------------
// Ana çerçeve
// ---------------------------------------------------------------------------
function applyPrefs(p) {
  document.documentElement.dataset.theme = p.theme === "dark" ? "dark" : "light";
  document.documentElement.dataset.size = p.text_size === "large" ? "large" : "normal";
}

function renderTop() {
  const st = S.st || {};
  const ready = st.active && st.active.setup_done;
  const ov = S.ov || {};
  const attn = (ov.unsorted || 0) + (ov.dupes || 0);
  const inb = st.inbox_wait || 0;
  $("#tabs").innerHTML = ready ? [
    ["music", "Müzikler", attn ? `<span class="badge">${attn}</span>` : ""],
    ["lists", "Listeler", ""],
    ["inbox", "Gelen", inb ? `<span class="badge">${inb}</span>` : ""],
  ].map(([k, l, b]) => `<button class="tab ${S.tab === k ? "on" : ""}" data-tab="${k}">${l}${b}</button>`).join("") : "";
  let html = "";
  if (st.active) {
    if (!st.has_engine) html += `<span class="pill" title="Bu SSD'de Engine kütüphanesi yok">Engine kütüphanesi yok</span>`;
    else html += st.engine_open ? `<span class="pill lock" title="Engine DJ açıkken listeler ve taşımalar kilitli"><span class="d"></span>Engine DJ açık · kilitli</span>`
      : `<span class="pill" title="Engine DJ kapalı: program Engine kütüphanesine doğrudan yazabilir"><span class="d"></span>Engine</span>`;
    if (st.active.has_serato) html += st.serato_open ? `<span class="pill lock"><span class="d"></span>Serato açık</span>` : `<span class="pill"><span class="d"></span>Serato</span>`;
    const u = st.undo;
    html += `<button class="btn undo" id="undo" ${u ? "" : "disabled"} title="${esc(u ? "Geri al: " + u.title + "  (Ctrl+Z)" : "Geri alınacak işlem yok")}">↶ Geri al ${u ? `<span class="t">${esc(u.title)}</span>` : ""}</button>`;
  }
  html += `<button class="icon-btn" id="settings" title="Ayarlar">⚙</button>`;
  $("#status").innerHTML = html;
}

document.addEventListener("click", async (e) => {
  const t = e.target.closest("[data-tab]");
  if (t) {
    S.tab = t.dataset.tab; localStorage.setItem("djd.tab", S.tab);
    await refresh(true);
    return;
  }
  if (e.target.closest("#undo")) { await undo(); return; }
  if (e.target.closest("#settings")) { settingsDialog(); }
});

async function undo() {
  if (!S.st || !S.st.undo) return;
  try {
    const r = await task("/api/undo", {});
    toast("Geri alındı: " + r.title, "ok");
    (r.notes || []).forEach((n) => toast(n));
  } catch (e) { /* bildirildi */ }
  await refresh(true);
}

document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "z") {
    if (e.target.closest("input, textarea, select")) return;
    e.preventDefault();
    undo();
  }
  if (e.key === "Escape") { $("#menu").innerHTML = ""; }
});

async function refresh(force) {
  try {
    S.st = await api("/api/state");
  } catch (e) { toast(e.message, "err"); return; }
  applyPrefs(S.st.prefs || {});
  S.stamp = S.st.stamp;
  const v = $("#view");
  if (!S.st.active) {
    S.ov = null;
    renderTop();
    if (S.st.missing_root) return renderMissing(v);
    return renderNoLib(v);
  }
  if (!S.st.active.setup_done) {
    renderTop();
    return loadSetup(force);
  }
  try {
    if (S.tab === "lists") await loadLists();
    else if (S.tab === "inbox") await loadInbox();
    else await loadMusic();
  } catch (e) { toast(e.message, "err"); }
  renderTop();
}

async function poll() {
  for (;;) {
    await sleep(4000);
    if (document.visibilityState !== "visible" || S.busy || S.drag || S.editing) continue;
    if ($("#modal").innerHTML || $("#menu").innerHTML) continue;
    try {
      const st = await api("/api/state");
      (st.events || []).forEach((ev) => { if (ev.ts > (S.lastEv || 0)) { S.lastEv = ev.ts; toast(ev.text, "ok"); } });
      const changed = st.stamp !== S.stamp || st.engine_open !== (S.st && S.st.engine_open) || st.serato_open !== (S.st && S.st.serato_open);
      S.st = st;
      if (changed) await refresh(); else renderTop();
    } catch (e) { /* sunucu kapalı olabilir */ }
  }
}

// ---------------------------------------------------------------------------
// SSD seçimi
// ---------------------------------------------------------------------------
async function renderNoLib(v) {
  v.innerHTML = `<div class="setup"><h1>Merhaba 👋</h1><p class="muted">Müziklerinin durduğu SSD'yi seç. Program önce yalnızca okur; hiçbir şeyi sen onaylamadan taşımaz.</p><div id="drives">Sürücüler aranıyor…</div>
    <p class="muted small">Listede yoksa <a href="#" id="browse">klasörü elle seç</a>.</p></div>`;
  drivesInto($("#drives"), null);
  $("#browse").onclick = (e) => { e.preventDefault(); browseDialog(null); };
}

async function renderMissing(v) {
  const r = S.st.missing_root;
  v.innerHTML = `<div class="setup"><h1>SSD takılı değil</h1><p class="muted">“${esc(r.name)}” (${esc(r.root)}) bulunamadı. SSD'yi tak; başka bir sürücü harfiyle takıldıysa aşağıdan seç.</p><div id="drives">Sürücüler aranıyor…</div>
    <p><button class="btn" id="retry">Yeniden dene</button> <a href="#" id="browse">klasörü elle seç</a></p></div>`;
  drivesInto($("#drives"), r.id);
  $("#retry").onclick = () => refresh(true);
  $("#browse").onclick = (e) => { e.preventDefault(); browseDialog(r.id); };
}

async function drivesInto(el, relocateId) {
  let ds = [];
  try { ds = await api("/api/drives"); } catch (e) { el.textContent = e.message; return; }
  ds = ds.filter((d) => d.serato || d.engine || d.djd || /^[A-Z]:\\$/.test(d.path) || d.path.startsWith("/Volumes/"));
  ds.sort((a, b) => (b.serato + b.engine + b.djd) - (a.serato + a.engine + a.djd));
  el.innerHTML = ds.map((d) => `<div class="drive" data-root="${esc(d.path)}"><span class="ic">💽</span><div><b>${esc(d.label)}</b><div class="muted small">${esc(d.path)}
    ${d.serato ? ' · <span class="tag blue">Serato</span>' : ""}${d.engine ? ' <span class="tag blue">Engine</span>' : ""}${d.djd ? ' <span class="tag ok">DJ Doktor</span>' : ""}</div></div>
    <button class="btn primary right">Bu SSD</button></div>`).join("") || `<div class="muted">Sürücü bulunamadı.</div>`;
  el.onclick = (e) => {
    const d = e.target.closest(".drive");
    if (d) chooseRoot(d.dataset.root, relocateId);
  };
}

async function chooseRoot(root, relocateId) {
  try {
    await task("/api/library/add", { root, relocate: relocateId || undefined });
  } catch (e) { return; }
  closeModal();
  await refresh(true);
}

async function browseDialog(relocateId, path = "") {
  let d;
  try { d = await api("/api/browse?path=" + encodeURIComponent(path || "")); } catch (e) { toast(e.message, "err"); return; }
  const m = modal(`<div class="dh">Klasör seç</div><div class="db"><div class="muted small">${esc(d.path || "Konumlar")}</div>
    <div style="margin-top:8px">${d.parent !== null && d.path ? `<div class="nav-item" data-p="${esc(d.parent)}">⬆ Üst klasör</div>` : ""}
    ${d.dirs.map((x) => `<div class="nav-item" data-p="${esc(x.path)}">📁 ${esc(x.label)}</div>`).join("")}</div></div>
    <div class="df"><button class="btn" data-x="no">Vazgeç</button>${d.path ? `<button class="btn primary" data-x="yes">Bu klasör</button>` : ""}</div>`, "wide");
  m.el.addEventListener("click", (e) => {
    const it = e.target.closest("[data-p]");
    if (it) { browseDialog(relocateId, it.dataset.p); return; }
    const b = e.target.closest("[data-x]");
    if (b) { if (b.dataset.x === "yes") chooseRoot(d.path, relocateId); else m.close(); }
  });
}

// ---------------------------------------------------------------------------
// İlk kurulum
// ---------------------------------------------------------------------------
const CANON = ["Halay", "Kürtçe Halay", "Horon", "Ankara", "Oyun Havası", "Roman - Mezdeke", "Oryantal - Arabic", "Türkçe Pop",
  "Yabancı Pop", "Dans - Club", "Slow - Çift Dans", "Enstrümantal - Fon", "Kına", "Sallama", "Matine", "Giriş - Pasta - Özel", "Türküler"];
const COLORS = { "Kürtçe Halay": "#c2410c", "Halay": "#dc2626", "Horon": "#0e7490", "Ankara": "#7c3aed", "Roman - Mezdeke": "#db2777",
  "Oryantal - Arabic": "#b45309", "Kına": "#a21caf", "Sallama": "#9a3412", "Matine": "#c026d3", "Giriş - Pasta - Özel": "#ca8a04",
  "Slow - Çift Dans": "#be185d", "Enstrümantal - Fon": "#0f766e", "Türküler": "#15803d", "Yabancı Pop": "#0891b2", "Oyun Havası": "#ea580c",
  "Dans - Club": "#4f46e5", "Türkçe Pop": "#2563eb" };

async function loadSetup(force) {
  if (!S.setup) {
    const saved = JSON.parse(localStorage.getItem("djd.setup") || "null");
    S.setup = saved || { root: "Müzik", overrides: {}, genre_map: {}, extra: [], engine_off: [] };
    S.setup.engine_off = S.setup.engine_off || [];
  }
  const v = $("#view");
  if (!S.setupData || force) v.innerHTML = `<div class="setup"><h1>Düzen önerisi hazırlanıyor…</h1><p class="muted">Klasörlerin, Serato crate'lerin ve Engine listelerin inceleniyor.</p></div>`;
  try {
    if (!S.st.active.last_scan) {
      await task("/api/scan", {});
      S.st = await api("/api/state");
    }
    S.setupData = await api("/api/setup/preview", S.setup);
  } catch (e) { v.innerHTML = `<div class="setup"><h1>Bir sorun oluştu</h1><p>${esc(e.message)}</p></div>`; return; }
  renderSetup();
}

function setupSave() { localStorage.setItem("djd.setup", JSON.stringify(S.setup)); }

let setupTimer = null;
function setupRepreview() {
  setupSave();
  clearTimeout(setupTimer);
  setupTimer = setTimeout(async () => {
    try { S.setupData = await api("/api/setup/preview", S.setup); renderSetup(); } catch (e) { toast(e.message, "err"); }
  }, 250);
}

function renderSetup() {
  const d = S.setupData, su = S.setup;
  const shown = (d.genres || []).map((g) => g.name);
  const allG = Array.from(new Set([...shown, ...CANON]));
  const filt = fold(S.setupFilter);
  const folders = d.folders.filter((f) => f.direct > 0 && (!filt || fold(f.disp).includes(filt)));
  const optHtml = (cur) => [`<option value="spread" ${cur === "spread" ? "selected" : ""}>Tek tek seçeceğim</option>`,
    `<option value="ignore" ${cur === "ignore" ? "selected" : ""}>Dokunma (sample, efekt…)</option>`, `<optgroup label="Tür">`,
    ...allG.map((n) => `<option value="g:${esc(n)}" ${cur === "g:" + n ? "selected" : ""}>${esc(su.genre_map[n] || n)}</option>`), `</optgroup>`].join("");
  $("#view").innerHTML = `<div class="setup">
    <h1>Düzeni kuralım</h1>
    <p class="muted" style="max-width:780px">Her şarkının <b>tek bir evi</b> olacak: <b>${esc(su.root)}/&lt;Tür&gt;</b>. Program klasörlerine, Serato crate'lerine ve Engine listelerine bakıp aşağıdaki öneriyi yaptı. İstediğini değiştir, sonra <b>Düzeni kur</b>. Hiçbir dosya silinmez; tek tıkla geri alınır. Engine ve Serato listelerin yeni yerleri otomatik gösterir.</p>
    <div class="sum">
      <div><b>${fmtN(d.moves)}</b><span class="muted">şarkı tür klasörüne taşınacak</span></div>
      <div><b>${fmtN(d.spread)}</b><span class="muted">şarkının türünü sonra sen seçeceksin</span></div>
      <div><b>${fmtN(d.ignore)}</b><span class="muted">dosyaya dokunulmayacak (sample, efekt)</span></div>
      <div><b>${fmtN(shown.length)}</b><span class="muted">tür klasörü</span></div>
    </div>
    ${(() => { const add = d.genres.filter((g) => !su.engine_off.includes(g.name)).reduce((a, g) => a + g.to_engine, 0);
      return add ? `<div class="hint blue"><span class="ic">ℹ</span><div><b>${fmtN(add)} şarkı Engine koleksiyonuna eklenecek</b> (şu an Engine'de ${fmtN(d.engine_tracks)} şarkı var). Hepsi Engine'de “Analiz bekleyenler” listesine girer; Engine DJ'de bir kere analiz ettirmen yeter${add > 800 ? " (çok şarkı: bilgisayar başında birkaç saat sürebilir, istersen gece çalıştır)" : ""}. Bir türü Engine'e koymak istemiyorsan aşağıda o türün <b>Engine</b> düğmesini kapat.</div></div>` : ""; })()}
    <div class="card">
      <h3>Türler</h3>
      <div class="muted small" style="margin-bottom:10px">Ada tıklayıp değiştirebilirsin (ör. “Halay” yerine “HALAYLAR”). ✕ o türü kaldırır; şarkılarını sonra tek tek seçersin.</div>
      <div class="gchips">${d.genres.map((g) => { const off = su.engine_off.includes(g.name); return `<span class="gchip" style="background:${esc(g.color)}${off ? ";opacity:.75" : ""}"><span data-gren="${esc(g.name)}" style="cursor:pointer" title="Adını değiştir">${esc(g.folder)}</span><span class="n">${fmtN(g.count)}</span><button class="x" data-geng="${esc(g.name)}" title="${off ? "Engine'e eklenmeyecek — tıkla: ekle" : "Engine'e eklenecek — tıkla: ekleme"}" style="width:auto;padding:0 7px;${off ? "text-decoration:line-through" : ""}">Engine</button><button class="x" data-gdel="${esc(g.name)}" title="Kaldır">✕</button></span>`; }).join("")}
      <button class="btn sm" id="gadd">+ Tür ekle</button></div>
      <label class="field" style="max-width:340px;margin-top:16px"><span>Ana müzik klasörünün adı (SSD'de)</span><input id="sroot" value="${esc(su.root)}"></label>
    </div>
    <div class="card" style="padding:0">
      <div style="display:flex;gap:10px;align-items:center;padding:14px 18px 8px"><h3 style="margin:0">Klasörler</h3><span class="muted small">Şarkıların şu an durduğu klasörler ve nereye gidecekleri</span>
        <input class="search" id="sfilt" placeholder="Klasör ara…" value="${esc(S.setupFilter)}" style="max-width:240px;margin-left:auto"></div>
      <div style="max-height:46vh;overflow:auto"><table class="t"><thead><tr><th>Klasör</th><th class="nowrap">Şarkı</th><th>Nereye</th><th>Neden</th></tr></thead><tbody>
      ${folders.map((f) => { const a = d.assign[f.rel] || "spread"; const ch = su.overrides[f.rel] !== undefined; return `<tr class="${ch ? "changed" : ""}"><td>${esc(f.disp)}</td><td class="c-num">${fmtN(f.direct)}</td>
        <td><select class="assign ${a.startsWith("g:") ? "g" : ""}" data-rel="${esc(f.rel)}">${optHtml(a)}</select></td><td class="muted small">${esc(f.reason || (ch ? "senin seçimin" : "üst klasörden"))}</td></tr>`; }).join("")}
      </tbody></table></div>
    </div>
    <div class="card"><h3>Örnek taşımalar</h3><div class="small">${(d.sample || []).slice(0, 8).map((s) => `<div><span class="muted">${esc(s.from)}</span> → <b>${esc(s.to)}</b></div>`).join("") || '<span class="muted">Taşınacak şarkı yok.</span>'}</div></div>
    <div style="display:flex;gap:10px;align-items:center;margin:16px 0 40px">
      <button class="btn primary big" id="sapply">Düzeni kur</button>
      <button class="btn ghost" id="sreset">Öneriye dön</button>
      <span class="muted small">Engine DJ ve Serato kapalı olmalı. Taşıma aynı SSD içinde olduğu için birkaç dakikada biter.</span>
    </div></div>`;
  const v = $("#view");
  v.onchange = (e) => {
    const s = e.target.closest("select.assign");
    if (s) { su.overrides[s.dataset.rel] = s.value; setupRepreview(); }
    if (e.target.id === "sroot") { su.root = e.target.value.trim() || "Müzik"; setupRepreview(); }
  };
  v.oninput = (e) => {
    if (e.target.id === "sfilt") {
      S.setupFilter = e.target.value;
      clearTimeout(setupTimer);
      setupTimer = setTimeout(() => { renderSetup(); const f = $("#sfilt"); f.focus(); f.setSelectionRange(f.value.length, f.value.length); }, 200);
    }
  };
  v.onclick = async (e) => {
    const ren = e.target.closest("[data-gren]");
    if (ren) {
      const n = ren.dataset.gren;
      const nv = await promptBox("Tür klasörünün adı", "SSD'deki klasör adı", su.genre_map[n] || n);
      if (nv) { su.genre_map[n] = nv; setupRepreview(); }
      return;
    }
    const ge = e.target.closest("[data-geng]");
    if (ge) {
      const n = ge.dataset.geng;
      su.engine_off = su.engine_off.includes(n) ? su.engine_off.filter((x) => x !== n) : [...su.engine_off, n];
      setupSave(); renderSetup();
      return;
    }
    const del = e.target.closest("[data-gdel]");
    if (del) {
      const n = del.dataset.gdel;
      for (const f of d.folders) if ((d.assign[f.rel] || "") === "g:" + n) su.overrides[f.rel] = "spread";
      su.extra = su.extra.filter((x) => x !== n);
      setupRepreview();
      return;
    }
    if (e.target.id === "gadd") {
      menu(e, [...CANON.filter((n) => !shown.includes(n)).map((n) => ({ label: n, color: COLORS[n], fn: () => { su.extra.push(n); setupRepreview(); } })),
        "-", { label: "Başka bir ad…", icon: "＋", fn: async () => { const n = await promptBox("Yeni tür", "Tür adı"); if (n) { su.extra.push(n); setupRepreview(); } } }]);
      return;
    }
    if (e.target.id === "sreset") { S.setup = { root: su.root, overrides: {}, genre_map: {}, extra: [], engine_off: [] }; setupRepreview(); return; }
    if (e.target.id === "sapply") {
      const ok = await confirmBox("Düzeni kur", `${fmtN(d.moves)} şarkı ${su.root} altındaki tür klasörlerine taşınacak. Engine ve Serato listelerindeki yollar da güncellenecek. İstersen sonra tek tıkla geri alabilirsin.`, "Düzeni kur");
      if (!ok) return;
      try {
        const r = await task("/api/setup/apply", su);
        localStorage.removeItem("djd.setup");
        toast(`Düzen kuruldu: ${fmtN(r.moved)} şarkı taşındı.`, "ok");
        S.tab = "music"; S.view = r.spread ? "unsorted" : "all";
        await refresh(true);
      } catch (err) { /* bildirildi */ }
    }
  };
}

// ---------------------------------------------------------------------------
// MÜZİKLER
// ---------------------------------------------------------------------------
async function loadMusic() {
  S.ov = await api("/api/overview");
  if (S.view.startsWith("g:") && !genreById(S.view.slice(2))) S.view = "all";
  if (S.view === "dupes") S.dupes = await api("/api/dupes");
  else {
    const rows = await api("/api/tracks?view=" + encodeURIComponent(S.view));
    S.rows = rows;
    const ids = new Set(rows.map((r) => r.id));
    S.sel = new Set([...S.sel].filter((x) => ids.has(x)));
  }
  renderMusic();
}

function renderMusic() {
  const ov = S.ov;
  const v = $("#view");
  const side = `<aside class="side"><div class="scroll">
    ${ov.unsorted ? `<div class="attn ${S.view === "unsorted" ? "on" : ""}" data-view="unsorted"><span class="ic">❓</span>Türü belli değil<span class="n">${fmtN(ov.unsorted)}</span></div>` : ""}
    ${ov.dupes ? `<div class="attn ${S.view === "dupes" ? "on" : ""}" data-view="dupes"><span class="ic">⧉</span>Kopyalar<span class="n">${fmtN(ov.dupes)}</span></div>` : ""}
    ${ov.problems ? `<div class="attn bad ${S.view === "problems" ? "on" : ""}" data-view="problems"><span class="ic">⚠</span>Sorunlar<span class="n">${fmtN(ov.problems)}</span></div>` : ""}
    <h4>Türler <button class="icon-btn right" id="gnew" title="Yeni tür">＋</button></h4>
    <div class="nav-item ${S.view === "all" ? "on" : ""}" data-view="all"><span class="gdot" style="background:var(--ink-2)"></span><span class="name">Tümü</span><span class="cnt">${fmtN(ov.total)}</span></div>
    ${ov.genres.map((g) => { const tot = g.count || 1; return `<div class="nav-item ${S.view === "g:" + g.id ? "on" : ""}" data-view="g:${g.id}" data-gid="${g.id}" title="${esc(g.rel)}">
      <span class="gdot" style="background:${esc(g.color)}"></span><span class="name">${esc(g.name)}</span><span class="cnt">${fmtN(g.count)}</span>
      ${g.count ? `<span class="bar"><i style="width:${100 * g.ready / tot}%;background:var(--ok)"></i><i style="width:${100 * g.pending / tot}%;background:var(--warn)"></i><i style="width:${100 * g.problem / tot}%;background:var(--bad)"></i></span>` : ""}</div>`; }).join("")}
    </div>
    <div class="legend" style="border-top:1px solid var(--line);flex-direction:column;gap:4px;padding:10px 16px">
      <span>${dotHtml("ready")} Hazır (Engine'de, analiz edildi)</span><span>${dotHtml("pending")} Analiz bekliyor</span>
      <span>${dotHtml("none")} Engine'de değil</span><span>${dotHtml("problem")} Sorun</span></div></aside>`;
  let main;
  if (S.view === "dupes") main = dupesHtml();
  else main = tracksHtml();
  v.innerHTML = `<div class="split">${side}<section class="main" id="mmain">${main}</section></div>`;
  wireMusic();
}

function viewTitle() {
  const ov = S.ov;
  if (S.view === "all") return ["Tüm şarkılar", `${fmtN(ov.total)} şarkı · ${ov.genres.length} tür`];
  if (S.view === "unsorted") return ["Türü belli değil", "Bu şarkılar henüz bir türün klasöründe değil. Öneriye tıkla ya da türünü seç; şarkı o türün klasörüne taşınır ve Engine'e eklenir."];
  if (S.view === "problems") return ["Sorunlar", "Bozuk ya da Prime 4'ün çalamayacağı dosyalar ve Engine'de yolu kayıp parçalar."];
  if (S.view.startsWith("g:")) {
    const g = genreById(S.view.slice(2));
    if (!g) return ["", ""];
    return [g.name, `${g.rel} · ${fmtN(g.count)} şarkı · ${fmtN(g.ready)} hazır${g.pending ? ` · ${fmtN(g.pending)} analiz bekliyor` : ""}${g.none ? ` · ${fmtN(g.none)} Engine'de değil` : ""}${g.engine ? "" : " · Engine'e otomatik eklenmiyor"}`];
  }
  return ["", ""];
}

function filteredRows() {
  const q = fold(S.q).split(/\s+/).filter(Boolean);
  if (!q.length) return S.rows;
  return S.rows.filter((r) => { const s = r.search || fold(r.title + " " + r.artist + " " + r.folder); return q.every((w) => s.includes(w)); });
}

function tracksHtml() {
  const [title, sub] = viewTitle();
  const isG = S.view.startsWith("g:");
  const rows = filteredRows();
  const ov = S.ov;
  let hint = "";
  if (ov.maint && ov.maint.pending && (isG || S.view === "all")) {
    hint = `<div class="hint"><span class="ic">⏳</span><div><b>${fmtN(ov.maint.pending)} şarkı analiz bekliyor.</b> Engine DJ'yi aç, sol tarafta SSD'nin altındaki <b>“Analiz bekleyenler”</b> listesini seç
      <div class="steps"><span>Ctrl+A (Mac: ⌘A)</span><i>→</i><span>sağ tık</span><i>→</i><span>Analyze / Re-analyze tracks</span></div>Bitince burada yeşil görünür, listeden de kendiliğinden düşer.</div></div>`;
  }
  if (S.view === "unsorted" && rows.some((r) => r.sugg && !r.copy_of)) {
    const n = rows.filter((r) => r.sugg && !r.copy_of).length;
    hint = `<div class="hint blue"><span class="ic">💡</span><div>${fmtN(n)} şarkı için öneri var. Tek tek tıklayabilir ya da <button class="btn sm primary" id="applyall">önerilerin hepsini uygula</button> diyebilirsin.
      ${rows.some((r) => r.copy_of) ? ` Kopya olanları da <button class="btn sm" id="dropcopies">kopyaları kaldır (${rows.filter((r) => r.copy_of).length})</button> ile temizle.` : ""}</div></div>`;
  }
  const allChecked = rows.length && rows.every((r) => S.sel.has(r.id));
  const body = rows.slice(0, 1500).map((r) => {
    const g = r.gid ? genreById(r.gid) : null;
    let extra = "";
    if (S.view === "unsorted") {
      if (r.copy_of && r.keep_tags) extra = `<button class="btn sm" data-dropcopy="${esc(r.group)}" title="Bu dosyanın aynısı ${esc(r.copy_of)} klasöründe var. Bu kopyadaki not / cue / ton bilgisi daha zengin: bu dosya asıl yere geçer, eski dosya karantinaya taşınır. Listeler değişmez.">⧉ ${esc(r.copy_of)} içinde var · birleştir <span class="tag blue">etiketleri korunur</span></button>`;
      else if (r.copy_of) extra = `<button class="btn sm" data-dropcopy="${esc(r.group)}" title="Bu dosyanın aynısı ${esc(r.copy_of)} klasöründe var. Bu kopya karantinaya taşınır; listeler asıl dosyayı gösterir.">⧉ ${esc(r.copy_of)} içinde var · kopyayı kaldır</button>`;
      else if (r.sugg) extra = `<button class="gbtn ${r.sugg_new ? "outline" : ""}" style="background:${COLORS[r.sugg] || (genreByName(r.sugg) || {}).color || "#64748b"};color:${r.sugg_new ? COLORS[r.sugg] || "#64748b" : "#fff"}" data-sugg="${r.id}" title="${esc(r.why || "")}${r.sugg_new ? " (yeni tür oluşturulur)" : ""}">→ ${esc(r.sugg)}</button>`;
      extra += ` <button class="btn sm" data-pickg="${r.id}">Tür seç ▾</button>`;
    } else if (S.view === "problems") {
      if (r.bad) extra = `<span class="tag bad">bozuk / yarım</span> <button class="btn sm" data-quar="${r.id}">Karantinaya al</button>`;
      else if (r.fmt) extra = `<span class="tag warn">Prime 4 çalmaz</span>`;
      else if (r.es === "broken") extra = `<span class="tag warn">Engine yolu bozuk · otomatik onarılacak</span>`;
    } else if (r.dup && r.dupk !== "song") {
      extra = `<span class="tag warn" title="Bu şarkının diskte başka kopyası var">⧉ ${r.dup} kopya</span>`;
    }
    return `<tr data-id="${r.id}" draggable="true" class="${S.sel.has(r.id) ? "sel" : ""}">
      <td class="c-chk"><input type="checkbox" ${S.sel.has(r.id) ? "checked" : ""}></td>
      <td class="c-dot">${dotHtml(r.dot)}</td>
      <td><div class="ttl">${esc(r.title)}</div><div class="art">${esc(r.artist || "—")}${r.note ? ` · <span style="color:var(--warn)">${esc(r.note)}</span>` : ""}</div></td>
      <td class="c-num">${r.bpm || ""}</td><td class="c-num">${esc(r.key)}</td><td class="c-num">${fmtDur(r.dur)}</td>
      <td>${!isG && g ? `<span class="tag" style="border-color:${esc(g.color)};color:${esc(g.color)}">${esc(g.name)}</span>` : ""}${r.folder ? `<span class="folder-chip" data-folder="${esc(r.rel.split("/").slice(0, -1).join("/"))}" title="${esc(r.rel)}">📁 ${esc(r.folder)}</span>` : ""}</td>
      <td class="c-act">${extra} <button class="play" data-play="${r.id}" title="Dinle">▶</button></td></tr>`;
  }).join("");
  const more = rows.length > 1500 ? `<div class="muted small" style="padding:10px">İlk 1.500 şarkı gösteriliyor; aramayı daraltın.</div>` : "";
  const gActs = isG ? `<button class="icon-btn" id="grename" title="Adını değiştir">✎</button><button class="icon-btn" id="gmenu" title="Diğer">⋯</button>` : "";
  return `<div class="head"><div style="flex:1;min-width:240px"><h2>${esc(title)} ${gActs}</h2><div class="sub">${esc(sub)}</div></div>
      <input class="search" id="msearch" placeholder="Ara: şarkı, sanatçı, klasör…" value="${esc(S.q)}" style="max-width:320px"></div>
    <div class="body">${hint}
    ${rows.length ? `<table class="t" id="ttab"><thead><tr><th class="c-chk"><input type="checkbox" id="chkall" ${allChecked ? "checked" : ""}></th><th></th><th>Şarkı</th><th>BPM</th><th>Ton</th><th>Süre</th><th>${isG ? "Alt klasör" : "Yer"}</th><th></th></tr></thead><tbody>${body}</tbody></table>${more}`
      : `<div class="empty"><div class="big">${S.view === "unsorted" ? "🎉" : "♪"}</div>${S.view === "unsorted" ? "Hepsi yerli yerinde." : S.q ? "Aramaya uyan şarkı yok." : "Bu türde henüz şarkı yok. Yeni şarkıları <b>Gelen</b> sekmesinden ekleyebilirsin."}</div>`}
    ${S.sel.size ? bulkHtml() : ""}</div>`;
}

function genreByName(n) { return ((S.ov && S.ov.genres) || []).find((g) => g.name === n); }

function bulkHtml() {
  return `<div class="bulk"><b>${fmtN(S.sel.size)} şarkı seçili</b>
    <button class="btn" id="bmove">Türe taşı ▾</button><button class="btn" id="blist">Listeye ekle ▾</button>
    ${S.view === "problems" ? `<button class="btn" id="bquar">Karantinaya al</button>` : ""}
    <button class="btn ghost" id="bclear">Seçimi kaldır</button><span class="muted small right">İpucu: seçtiklerini soldaki bir türün üstüne sürükleyebilirsin.</span></div>`;
}

function dupesHtml() {
  const gs = S.dupes || [];
  const main = gs.filter((g) => g.kind !== "song");
  const sim = gs.filter((g) => g.kind === "song");
  const kindTxt = { exact: "Birebir aynı dosya", audio: "Aynı ses, farklı etiket", engine: "Engine'de iki kez görünüyor", song: "Aynı şarkı, farklı kayıt" };
  const card = (g) => `<div class="card dup" data-group="${esc(g.id)}"><div class="dh"><b>${esc(g.members[0].title || g.members[0].name)}</b><span class="muted">${esc(g.members[0].artist || "")}</span>
      <span class="tag ${g.kind === "song" ? "" : "warn"}">${kindTxt[g.kind]}</span><button class="btn sm primary right" data-merge="${esc(g.id)}">${g.kind === "engine" ? "Düzelt" : g.kind === "song" ? "Seçileni tut" : "Birleştir"}</button></div>
    ${g.kind === "engine" ? `<div class="m keep"><div style="flex:1"><div class="path">${esc(g.members[0].rel)}</div><div class="small muted">Engine'de ${g.tracks.length} kayıt var; Prime 4'te iki kez görünür. Düzelt: listeler korunur, fazla kayıt kalkar.</div></div></div>` :
    g.members.map((m) => `<label class="m ${m.keeper ? "keep" : ""}"><input type="radio" name="k-${esc(g.id)}" value="${m.id}" ${m.keeper ? "checked" : ""}>
      <div style="flex:1;min-width:0"><div class="path">${m.genre ? `<span class="tag" style="color:${esc(m.color)};border-color:${esc(m.color)}">${esc(m.genre)}</span>` : ""}${esc(m.rel)}</div>
      <div class="small">${m.why.filter((w) => !(m.genre && w === m.genre + " klasöründe")).map((w) => `<span class="tag">${esc(w)}</span>`).join("")}${m.bitrate ? `<span class="tag">${m.bitrate} kbps</span>` : ""}</div></div>
      ${m.content ? '<span class="tag blue" title="Bu kopyanın etiketleri (not, ton, cue) daha dolu: dosya, tutulan kopyanın yerine geçer; diğeri karantinaya gider.">etiketleri korunur</span>' : ""}
      ${m.keeper ? '<span class="tag st ok">tutulacak</span>' : '<span class="tag st">karantinaya</span>'}<button class="play" data-play="${m.id}" title="Dinle">▶</button></label>`).join("")}
    ${g.missing && g.missing.length ? `<div class="small" style="padding:8px 16px;color:var(--warn)">Dikkat: diğer kopyada ${g.missing.join(" ve ")} var, tutulacak kopyada yok.</div>` : ""}</div>`;
  return `<div class="head"><div style="flex:1"><h2>Kopyalar</h2><div class="sub">Aynı şarkının birden fazla kopyası. Biri kalır (önerilen işaretli), diğerleri silinmez: SSD'deki karantina klasörüne taşınır. Engine ve Serato listeleri kalan kopyayı gösterir.</div></div>
    ${main.length ? `<button class="btn primary" id="mergeall">Hepsini önerildiği gibi birleştir (${main.length})</button>` : ""}</div>
    <div class="body">${main.map(card).join("") || '<div class="empty"><div class="big">🎉</div>Kopya yok.</div>'}
    ${sim.length ? `<h3 style="margin:22px 0 8px">Benzer kayıtlar <span class="muted small">(farklı indirme / kalite — karar senin)</span></h3>${sim.map(card).join("")}` : ""}</div>`;
}

function wireMusic() {
  const v = $("#view");
  v.onclick = async (e) => {
    const nav = e.target.closest("[data-view]");
    if (nav) { S.view = nav.dataset.view; S.sel.clear(); S.q = ""; await loadMusic(); return; }
    if (e.target.id === "gnew") { newGenre(); return; }
    const play = e.target.closest("[data-play]");
    if (play) { playFid(+play.dataset.play, play); return; }
    if (e.target.id === "grename") { renameGenre(+S.view.slice(2)); return; }
    if (e.target.id === "gmenu") { genreMenu(e, +S.view.slice(2)); return; }
    if (e.target.id === "chkall") {
      const rows = filteredRows();
      if (e.target.checked) rows.forEach((r) => S.sel.add(r.id)); else S.sel.clear();
      rerenderMain(); return;
    }
    const tr = e.target.closest("tr[data-id]");
    if (tr && e.target.matches("input[type=checkbox]")) {
      const id = +tr.dataset.id;
      if (e.shiftKey && S.lastSel != null) {
        const rows = filteredRows().map((r) => r.id);
        const a = rows.indexOf(S.lastSel), b = rows.indexOf(id);
        if (a >= 0 && b >= 0) rows.slice(Math.min(a, b), Math.max(a, b) + 1).forEach((x) => S.sel.add(x));
      } else if (e.target.checked) S.sel.add(id); else S.sel.delete(id);
      S.lastSel = id;
      rerenderMain(); return;
    }
    const fc = e.target.closest("[data-folder]");
    if (fc) { folderMenu(e, fc.dataset.folder); return; }
    const sg = e.target.closest("[data-sugg]");
    if (sg) {
      const r = S.rows.find((x) => x.id === +sg.dataset.sugg);
      if (r) await moveTo([r.id], r.sugg_gid, r.sugg);
      return;
    }
    const pg = e.target.closest("[data-pickg]");
    if (pg) { pickGenreMenu(e, [+pg.dataset.pickg]); return; }
    const dc = e.target.closest("[data-dropcopy]");
    if (dc) { await mergeGroups([{ group: dc.dataset.dropcopy }], "Kopya kaldırıldı"); return; }
    const q = e.target.closest("[data-quar]");
    if (q) { await quarantine([+q.dataset.quar]); return; }
    if (e.target.id === "applyall") { await applyAllSuggestions(); return; }
    if (e.target.id === "dropcopies") {
      const groups = Array.from(new Set(S.rows.filter((r) => r.copy_of).map((r) => r.group)));
      await mergeGroups(groups.map((g) => ({ group: g })), groups.length + " kopya kaldırıldı");
      return;
    }
    if (e.target.id === "bmove") { pickGenreMenu(e, [...S.sel]); return; }
    if (e.target.id === "blist") { addToListMenu(e, [...S.sel]); return; }
    if (e.target.id === "bquar") { await quarantine([...S.sel]); return; }
    if (e.target.id === "bclear") { S.sel.clear(); rerenderMain(); return; }
    const mg = e.target.closest("[data-merge]");
    if (mg) {
      const card = mg.closest("[data-group]");
      const k = card.querySelector("input[type=radio]:checked");
      await mergeGroups([{ group: mg.dataset.merge, keeper: k ? +k.value : undefined }], "Birleştirildi");
      return;
    }
    if (e.target.id === "mergeall") {
      const picks = (S.dupes || []).filter((g) => g.kind !== "song").map((g) => {
        const card = v.querySelector(`[data-group="${CSS.escape(g.id)}"]`);
        const k = card && card.querySelector("input[type=radio]:checked");
        return { group: g.id, keeper: k ? +k.value : undefined };
      });
      const ok = await confirmBox("Kopyaları birleştir", `${picks.length} grupta tutulacak kopyalar kalır; diğerleri karantinaya taşınır (silinmez). Engine DJ ve Serato kapalı olmalı.`, "Birleştir");
      if (ok) await mergeGroups(picks, "Kopyalar birleştirildi");
    }
  };
  v.onchange = (e) => {
    const r = e.target.closest(".dup .m input[type=radio]");
    if (r) {
      const card = r.closest(".dup");
      $$(".m", card).forEach((m) => {
        const on = m.querySelector("input").checked;
        m.classList.toggle("keep", on);
        const tg = m.querySelector(".st");
        if (tg) { tg.className = "tag st " + (on ? "ok" : ""); tg.textContent = on ? "tutulacak" : "karantinaya"; }
      });
    }
  };
  v.oninput = (e) => {
    if (e.target.id === "msearch") {
      S.q = e.target.value;
      clearTimeout(S._qt);
      S._qt = setTimeout(() => { rerenderMain(); const f = $("#msearch"); if (f) { f.focus(); f.setSelectionRange(f.value.length, f.value.length); } }, 150);
    }
  };
  // sürükle-bırak: satırlar -> tür
  v.ondragstart = (e) => {
    const tr = e.target.closest && e.target.closest("tr[data-id]");
    if (!tr) return;
    const id = +tr.dataset.id;
    if (!S.sel.has(id)) { S.sel = new Set([id]); }
    S.drag = { fids: [...S.sel] };
    e.dataTransfer.setData("text/plain", "djd");
    e.dataTransfer.effectAllowed = "move";
  };
  v.ondragend = () => { S.drag = null; $$(".nav-item.drop").forEach((x) => x.classList.remove("drop")); };
  v.ondragover = (e) => {
    const it = e.target.closest && e.target.closest(".nav-item[data-gid]");
    if (it && S.drag) { e.preventDefault(); $$(".nav-item.drop").forEach((x) => x !== it && x.classList.remove("drop")); it.classList.add("drop"); }
  };
  v.ondrop = async (e) => {
    const it = e.target.closest && e.target.closest(".nav-item[data-gid]");
    if (!it || !S.drag) return;
    e.preventDefault();
    const fids = S.drag.fids; S.drag = null;
    await moveTo(fids, +it.dataset.gid);
  };
}

function rerenderMain() {
  const m = $("#mmain");
  if (!m) return;
  const st = m.querySelector(".body") ? m.querySelector(".body").scrollTop : 0;
  m.innerHTML = S.view === "dupes" ? dupesHtml() : tracksHtml();
  const b = m.querySelector(".body"); if (b) b.scrollTop = st;
}

async function moveTo(fids, gid, gname) {
  try {
    const r = await task("/api/move", gid ? { fids, gid } : { fids, genre: gname });
    toast(`${fmtN(r.moved)} şarkı taşındı.`, "ok");
  } catch (e) { /* bildirildi */ }
  S.sel.clear();
  await refresh(true);
}

async function applyAllSuggestions() {
  const rows = filteredRows().filter((r) => r.sugg && !r.copy_of);
  const byG = {};
  rows.forEach((r) => { const k = r.sugg; (byG[k] = byG[k] || { gid: r.sugg_gid, name: r.sugg, fids: [] }).fids.push(r.id); });
  const groups = Object.values(byG);
  const ok = await confirmBox("Önerileri uygula", groups.map((g) => `${g.name}: ${g.fids.length}`).join(" · "), "Uygula");
  if (!ok) return;
  for (const g of groups) {
    try { await task("/api/move", g.gid ? { fids: g.fids, gid: g.gid } : { fids: g.fids, genre: g.name }); } catch (e) { break; }
  }
  toast("Öneriler uygulandı.", "ok");
  await refresh(true);
}

async function mergeGroups(picks, msg) {
  try {
    const r = await task("/api/merge", { picks });
    toast(msg + (r.files ? ` (${r.files} dosya karantinada)` : ""), "ok");
  } catch (e) { /* bildirildi */ }
  await refresh(true);
}

async function quarantine(fids) {
  const ok = await confirmBox("Karantinaya al", `${fids.length} dosya SSD'deki _DJDoktor_/Karantina klasörüne taşınacak (silinmez, geri alınabilir).`, "Taşı");
  if (!ok) return;
  await act("/api/quarantine", { fids }, "Karantinaya alındı.");
  S.sel.clear();
}

function pickGenreMenu(e, fids) {
  const items = S.ov.genres.map((g) => ({ label: g.name, color: g.color, fn: () => moveTo(fids, g.id) }));
  const have = new Set(S.ov.genres.map((g) => g.name));
  const rest = CANON.filter((n) => !have.has(n));
  if (rest.length) {
    items.push("-", { label: "Yeni tür", head: true });
    rest.forEach((n) => items.push({ label: n, color: COLORS[n], fn: () => moveTo(fids, null, n) }));
  }
  items.push("-", { label: "Başka bir ad…", icon: "＋", fn: async () => { const n = await promptBox("Yeni tür", "Tür adı"); if (n) moveTo(fids, null, n); } });
  menu(e, items);
}

async function addToListMenu(e, fids) {
  let t;
  try { t = await api("/api/lists"); } catch (err) { toast(err.message, "err"); return; }
  const ls = t.lists.filter((l) => !l.managed);
  if (!ls.length) { toast("Önce Listeler sekmesinden bir liste oluştur."); return; }
  const items = ls.slice(0, 60).map((l) => ({ label: "  ".repeat(l.depth) + l.title, icon: l.ev ? "📅" : "♪", fn: async () => {
    try { const r = await api("/api/list/add", { id: l.id, fids }); toast(`${r.added} şarkı “${l.title}” listesine eklendi${r.skipped ? ` (${r.skipped} zaten vardı)` : ""}.`, "ok"); }
    catch (err) { toast(err.message, "err"); }
  } }));
  menu(e, items);
}

async function newGenre() {
  const have = new Set(S.ov.genres.map((g) => g.name));
  const n = await promptBox("Yeni tür", "Tür adı (SSD'de bu adla klasör açılır)", "", "Oluştur", "Öneriler: " + CANON.filter((x) => !have.has(x)).slice(0, 8).join(", "));
  if (!n) return;
  const r = await act("/api/genre/create", { name: n }, `“${n}” oluşturuldu.`);
  if (r) { S.view = "g:" + r.id; await refresh(true); }
}

async function renameGenre(gid) {
  const g = genreById(gid);
  const n = await promptBox("Türün adı", "Yeni ad (SSD'deki klasörün adı da değişir)", g.name);
  if (!n || n === g.name) return;
  try { await task("/api/genre/rename", { id: gid, name: n }); toast("Ad değişti; Engine ve Serato da güncellendi.", "ok"); } catch (e) { /* */ }
  await refresh(true);
}

function genreMenu(e, gid) {
  const g = genreById(gid);
  menu(e, [
    { label: g.engine ? "Engine'e otomatik ekleme: Açık" : "Engine'e otomatik ekleme: Kapalı", icon: g.engine ? "✓" : "○",
      fn: () => act("/api/genre/update", { id: gid, engine: g.engine ? 0 : 1 }, g.engine ? "Bu türün yeni şarkıları Engine'e otomatik eklenmeyecek." : "Bu türün şarkıları Engine'e eklenecek.") },
    { label: "Klasörü aç", icon: "📂", fn: () => api("/api/open", { path: S.st.active.root + "/" + g.rel }).catch((er) => toast(er.message, "err")) },
    "-",
    { label: "Başka türle birleştir…", icon: "⇢", fn: () => {
      const others = S.ov.genres.filter((x) => x.id !== gid);
      menu(e, others.map((o) => ({ label: o.name, color: o.color, fn: async () => {
        const ok = await confirmBox("Türleri birleştir", `“${g.name}” içindeki ${g.count} şarkı “${o.name}” klasörüne taşınacak ve “${g.name}” kaldırılacak.`, "Birleştir");
        if (!ok) return;
        try { await task("/api/genre/merge", { src: gid, dst: o.id }); S.view = "g:" + o.id; } catch (er) { /* */ }
        await refresh(true);
      } })));
    } },
    { label: "Türü kaldır", icon: "🗑", fn: async () => {
      if (g.count) { toast(`“${g.name}” içinde ${g.count} şarkı var. Önce başka türe taşı ya da birleştir.`, "err"); return; }
      await act("/api/genre/delete", { id: gid }, "Tür kaldırıldı.");
      S.view = "all"; await refresh(true);
    } },
  ]);
}

function folderMenu(e, rel) {
  const name = rel.split("/").pop();
  menu(e, [
    { label: "Klasörün adını değiştir", icon: "✎", fn: async () => {
      const n = await promptBox("Klasör adı", "Yeni ad", name);
      if (!n || n === name) return;
      try { await task("/api/folder/rename", { rel, name: n }); toast("Klasör adı değişti.", "ok"); } catch (er) { /* */ }
      await refresh(true);
    } },
    { label: "Finder / Gezgin'de göster", icon: "📂", fn: () => api("/api/open", { path: S.st.active.root + "/" + rel }).catch((er) => toast(er.message, "err")) },
    ...(S.view === "unsorted" ? ["-", { label: "Bu klasöre dokunma (sample, efekt…)", icon: "🚫", fn: () => act("/api/rule", { rel, action: "ignore" }, "Bu klasör artık listede görünmeyecek.") }] : []),
  ]);
}

// ---------------------------------------------------------------------------
// Dinleme
// ---------------------------------------------------------------------------
let playing = null;
function playFid(fid, btn) {
  const a = $("#audio");
  if (playing === fid && !a.paused) { a.pause(); btn.classList.remove("on"); btn.textContent = "▶"; playing = null; return; }
  $$(".play.on").forEach((b) => { b.classList.remove("on"); b.textContent = "▶"; });
  a.src = `/api/audio/${fid}?t=${encodeURIComponent(TOKEN)}`;
  a.play().catch(() => toast("Çalınamadı (tarayıcı bu biçimi desteklemiyor olabilir).", "err"));
  playing = fid; btn.classList.add("on"); btn.textContent = "❚❚";
  a.onended = () => { btn.classList.remove("on"); btn.textContent = "▶"; playing = null; };
}

// ---------------------------------------------------------------------------
// LİSTELER (Engine'in kendi listeleri; değişiklik anında kaydedilir)
// ---------------------------------------------------------------------------
async function loadLists() {
  S.lists = await api("/api/lists");
  if (!S.ov) { try { S.ov = await api("/api/overview"); } catch (e) { /* */ } }
  if (S.cur && !S.lists.lists.some((l) => l.id === S.cur)) S.cur = null;
  S.items = S.cur ? await api("/api/list/" + S.cur) : null;
  if (!S.pick.loaded) { await pickSearch(); }
  renderLists();
}

function listKids() {
  const kids = {};
  (S.lists.lists || []).forEach((l) => { (kids[l.parent] = kids[l.parent] || []).push(l); });
  return kids;
}

function treeHtml() {
  const kids = listKids();
  const out = [];
  const walk = (pid, depth) => {
    for (const l of kids[pid] || []) {
      const has = (kids[l.id] || []).length > 0;
      const open = S.open[l.id] !== undefined ? S.open[l.id] : (l.kind !== "genres");
      out.push(`<div class="nav-item ${S.cur === l.id ? "on" : ""}" data-lid="${l.id}" style="padding-left:${8 + depth * 16}px" title="${esc(l.path.join(" / "))}">
        <span class="tw" data-tw="${l.id}">${has ? (open ? "▾" : "▸") : ""}</span>
        <span class="name">${l.kind === "analysis" ? "⏳ " : l.ev ? "📅 " : ""}${esc(l.title)}</span>
        ${l.managed ? '<span class="auto" title="Program tarafından otomatik tutulur">otomatik</span>' : ""}${l.serato ? `<span class="ser" title="Serato'da da var${l.serato.dirty ? " (Serato kapanınca güncellenecek)" : ""}">S${l.serato.dirty ? "…" : ""}</span>` : ""}
        <span class="cnt">${l.n || ""}</span></div>`);
      if (has && open) walk(l.id, depth + 1);
    }
  };
  walk(0, 0);
  return out.join("");
}

function renderLists() {
  const t = S.lists;
  const v = $("#view");
  if (!t.db) {
    v.innerHTML = `<div class="setup"><h1>Engine kütüphanesi yok</h1><p class="muted">Bu SSD'de henüz Engine DJ kütüphanesi yok. Engine DJ'de SSD'ye bir kez parça aktarınca (ya da SSD'yi Prime 4'te bir kez kullanınca) listeler burada görünür.</p></div>`;
    return;
  }
  const ro = t.readonly;
  v.innerHTML = `<div class="split">
    <aside class="side"><div style="padding:10px 10px 0;display:flex;gap:6px;flex-wrap:wrap">
      <button class="btn primary" id="newev" ${ro ? "disabled" : ""}>＋ Yeni etkinlik</button><button class="btn" id="newlist" ${ro ? "disabled" : ""}>＋ Liste</button>
      <button class="icon-btn" id="lmore" title="Diğer">⋯</button></div>
      ${ro ? `<div class="hint" style="margin:10px 10px 0"><span class="ic">🔒</span><div>Engine DJ açık. Listeleri düzenlemek için Engine DJ'yi kapat (aynı listeleri ikisi birden değiştirmesin).</div></div>` : ""}
      <div class="scroll tree" id="tree">${treeHtml()}</div></aside>
    <section class="main" id="lmain">${listMainHtml()}</section>
    <aside class="picker" id="picker">${pickerHtml()}</aside></div>`;
  wireLists();
}

function listMainHtml() {
  const it = S.items;
  if (!it) return `<div class="empty" style="margin:auto"><div class="big">♪</div>Soldan bir liste seç ya da <b>Yeni etkinlik</b> oluştur.<div class="small" style="margin-top:8px">Burada yaptığın her değişiklik anında Engine'e yazılır; Prime 4 aynı listeyi görür. Kaydet/gönder yok.</div></div>`;
  const l = S.lists.lists.find((x) => x.id === it.id) || {};
  const ro = S.lists.readonly || it.managed;
  const ev = it.ev || {};
  const rows = it.items.map((r, i) => `<tr data-ref="${esc(r.ref)}" ${ro ? "" : 'draggable="true"'}>
      <td class="c-idx">${ro ? i + 1 : `<span class="grip" title="Sürükle">⋮⋮</span>`}</td><td class="c-dot">${dotHtml(r.dot, r.missing ? "Dosya bulunamadı" : undefined)}</td>
      <td><div class="ttl">${esc(r.title)}</div><div class="art">${esc(r.artist || "—")}${r.genre ? ` · <span style="color:${esc(r.color)}">${esc(r.genre)}</span>` : ""}</div></td>
      <td class="c-num">${r.bpm || ""}</td><td class="c-num">${esc(r.key)}</td><td class="c-num">${fmtDur(r.dur)}</td>
      <td style="min-width:160px">${ro ? `<span class="small" style="color:var(--warn)">${esc(r.note)}</span>` : `<input class="note" data-note="${esc(r.ref)}" value="${esc(r.note)}" placeholder="not ekle">`}</td>
      <td class="c-act">${r.fid ? `<button class="play" data-play="${r.fid}">▶</button>` : ""}${ro ? "" : `<button class="icon-btn" data-rm="${esc(r.ref)}" title="Listeden çıkar">✕</button>`}</td></tr>`).join("");
  const pend = it.items.filter((r) => r.dot === "pending").length;
  return `<div class="head"><div style="flex:1;min-width:260px">
      ${ro ? `<h2>${esc(it.title)}</h2>` : `<input class="title-edit" id="ltitle" value="${esc(it.title)}">`}
      <div class="sub">${esc(it.path.slice(0, -1).join(" / ") || "En üst")} · ${fmtN(it.items.length)} şarkı · ${fmtLong(it.dur)}${l.kids ? ` · ${l.kids} alt liste` : ""}${pend ? ` · <span style="color:var(--warn)">${pend} analiz bekliyor</span>` : ""}</div>
      ${it.ev ? `<div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap"><input type="date" class="search" style="max-width:170px" id="evdate" value="${esc(ev.date || "")}"><input class="search" style="max-width:260px" id="evvenue" placeholder="Yer / salon" value="${esc(ev.venue || "")}"></div>` : ""}
    </div>
    <div style="display:flex;gap:8px;align-items:center">
      ${S.st.active.has_serato ? `<label class="switch ${l.serato ? "on" : ""}" id="sertog" title="Bu liste Serato'da da crate olarak dursun; değişiklikler iki yönlü eşitlenir"><i></i>Serato'da da</label>` : ""}
      <button class="icon-btn" id="lmenu" title="Diğer">⋯</button></div></div>
    <div class="body">${it.managed ? `<div class="hint blue"><span class="ic">ℹ</span><div>${l.kind === "analysis" ? "Bu liste Engine'de analiz edilmemiş şarkıları gösterir. Engine DJ'de bu listeyi seç → tümünü seç → sağ tık → <b>Analyze / Re-analyze tracks</b>. Bitenler kendiliğinden düşer." : "Bu listeyi program tutar (tür klasörünün aynısı). Değiştirmek için kopyasını al."}</div></div>` : ""}
    ${it.items.length ? `<table class="t" id="ltab"><thead><tr><th></th><th></th><th>Şarkı</th><th>BPM</th><th>Ton</th><th>Süre</th><th>Not</th><th></th></tr></thead><tbody>${rows}</tbody></table>`
      : `<div class="empty"><div class="big">＋</div>Liste boş. Sağdan şarkı ara ve <b>＋</b> ile ekle ya da sürükleyip bırak.</div>`}</div>`;
}

function pickerHtml() {
  const gs = (S.ov && S.ov.genres) || [];
  return `<div class="ph"><input class="search" id="psearch" placeholder="Şarkı ekle: ara…" value="${esc(S.pick.q)}">
    <div class="chips"><span class="chip ${!S.pick.gid ? "on" : ""}" data-pg="">Hepsi</span>${gs.map((g) => `<span class="chip ${S.pick.gid === g.id ? "on" : ""}" data-pg="${g.id}">${esc(g.name)}</span>`).join("")}</div></div>
    <div class="scroll" id="pres">${pickResHtml()}</div>`;
}

function pickResHtml() {
  const inList = new Set(((S.items && S.items.items) || []).map((r) => r.fid));
  return S.pick.res.map((r) => `<div class="res ${inList.has(r.id) ? "in" : ""}" draggable="true" data-fid="${r.id}">${dotHtml(r.dot)}
      <div class="meta"><div class="ttl">${esc(r.title)}</div><div class="art">${esc(r.artist || "—")}${r.genre ? ` · ${esc(r.genre)}` : ""}${r.bpm ? ` · ${r.bpm}` : ""}${r.key ? ` · ${esc(r.key)}` : ""}</div></div>
      <button class="play" data-play="${r.id}">▶</button><button class="add" data-add="${r.id}" title="Listeye ekle">${inList.has(r.id) ? "✓" : "＋"}</button></div>`).join("") || '<div class="empty small">Sonuç yok.</div>';
}

async function pickSearch() {
  const q = S.pick.q, g = S.pick.gid;
  try {
    S.pick.res = await api(`/api/search?q=${encodeURIComponent(q)}${g ? "&gid=" + g : ""}&limit=300`);
    S.pick.loaded = true;
  } catch (e) { S.pick.res = []; }
}

async function selectList(id) {
  S.cur = id;
  try { S.items = await api("/api/list/" + id); } catch (e) { toast(e.message, "err"); S.items = null; }
  $("#lmain").innerHTML = listMainHtml();
  $("#tree").innerHTML = treeHtml();
  $("#picker").innerHTML = pickerHtml();
}

async function listOp(path, body, msg) {
  try {
    const r = await api(path, body);
    if (msg) toast(msg, "ok");
    await refreshLists();
    return r;
  } catch (e) { toast(e.message, "err"); await refreshLists(); return null; }
}

async function refreshLists() {
  S.st = await api("/api/state");
  S.stamp = S.st.stamp;
  S.lists = await api("/api/lists");
  if (S.cur && !S.lists.lists.some((l) => l.id === S.cur)) S.cur = null;
  S.items = S.cur ? await api("/api/list/" + S.cur) : null;
  const sc = $("#lmain .body") ? $("#lmain .body").scrollTop : 0;
  renderLists();
  const b = $("#lmain .body"); if (b) b.scrollTop = sc;
  renderTop();
}

function wireLists() {
  const v = $("#view");
  v.onclick = async (e) => {
    const tw = e.target.closest("[data-tw]");
    if (tw && tw.textContent) {
      const id = +tw.dataset.tw;
      const l = S.lists.lists.find((x) => x.id === id);
      const cur = S.open[id] !== undefined ? S.open[id] : (l.kind !== "genres");
      S.open[id] = !cur; localStorage.setItem("djd.open", JSON.stringify(S.open));
      $("#tree").innerHTML = treeHtml(); return;
    }
    const li = e.target.closest("[data-lid]");
    if (li) { await selectList(+li.dataset.lid); return; }
    const play = e.target.closest("[data-play]");
    if (play) { playFid(+play.dataset.play, play); return; }
    const add = e.target.closest("[data-add]");
    if (add) {
      if (!S.cur || !S.items) { toast("Önce soldan bir liste seç."); return; }
      if (S.items.managed) { toast("Bu liste otomatik; önce kopyasını al.", "err"); return; }
      await listOp("/api/list/add", { id: S.cur, fids: [+add.dataset.add] });
      return;
    }
    const pg = e.target.closest("[data-pg]");
    if (pg) { S.pick.gid = pg.dataset.pg ? +pg.dataset.pg : null; await pickSearch(); $("#picker").innerHTML = pickerHtml(); const f = $("#psearch"); if (f) f.focus(); return; }
    const rm = e.target.closest("[data-rm]");
    if (rm) { await listOp("/api/list/remove", { id: S.cur, refs: [rm.dataset.rm] }); return; }
    if (e.target.id === "newev") { newEventDialog(); return; }
    if (e.target.id === "newlist") {
      const n = await promptBox("Yeni liste", "Liste adı", "", "Oluştur");
      if (!n) return;
      const parent = S.items && !S.items.managed && e.shiftKey ? S.cur : 0;
      const r = await listOp("/api/list/create", { parent, title: n });
      if (r) await selectList(r.id);
      return;
    }
    if (e.target.id === "lmore") {
      menu(e, [
        { label: "Serato'dan crate al…", icon: "⇠", fn: seratoImportDialog },
        { label: "Serato ile şimdi eşitle", icon: "⇄", fn: () => listOp("/api/serato/sync", {}, "Eşitlendi.") },
      ]);
      return;
    }
    if (e.target.closest("#sertog")) {
      const l = S.lists.lists.find((x) => x.id === S.cur);
      await listOp("/api/serato/link", { id: S.cur, on: !l.serato }, !l.serato ? "Bu liste Serato'da da görünecek (Serato kapalıyken yazılır)." : "Serato bağı kaldırıldı.");
      return;
    }
    if (e.target.id === "lmenu") { listMenu(e); }
  };
  v.onchange = async (e) => {
    if (e.target.id === "ltitle") { const t = e.target.value.trim(); if (t && t !== S.items.title) await listOp("/api/list/rename", { id: S.cur, title: t }); }
    if (e.target.id === "evdate" || e.target.id === "evvenue") {
      await listOp("/api/event/set", { id: S.cur, date: $("#evdate").value, venue: $("#evvenue").value });
    }
    const n = e.target.closest("[data-note]");
    if (n) { await api("/api/list/note", { id: S.cur, ref: n.dataset.note, note: n.value }).catch((er) => toast(er.message, "err")); renderTop(); }
  };
  v.onkeydown = (e) => { if (e.target.id === "ltitle" && e.key === "Enter") e.target.blur(); if (e.target.matches("input.note") && e.key === "Enter") e.target.blur(); };
  v.oninput = (e) => {
    if (e.target.id === "psearch") {
      S.pick.q = e.target.value;
      clearTimeout(S._pt);
      S._pt = setTimeout(async () => { await pickSearch(); $("#pres").innerHTML = pickResHtml(); }, 220);
    }
  };
  // sürükle-bırak: sıra değiştirme, sağdan ekleme, başka listeye kopyalama
  v.ondragstart = (e) => {
    const tr = e.target.closest && e.target.closest("tr[data-ref]");
    const res = e.target.closest && e.target.closest(".res[data-fid]");
    if (tr) { S.drag = { ref: tr.dataset.ref }; tr.classList.add("dragging"); }
    else if (res) S.drag = { fid: +res.dataset.fid };
    else return;
    e.dataTransfer.setData("text/plain", "djd");
    e.dataTransfer.effectAllowed = "copyMove";
  };
  v.ondragend = () => { S.drag = null; $$(".dragging, .dropline, .drop").forEach((x) => x.classList.remove("dragging", "dropline", "drop")); };
  v.ondragover = (e) => {
    if (!S.drag) return;
    const tr = e.target.closest && e.target.closest("#ltab tr[data-ref]");
    const body = e.target.closest && e.target.closest("#lmain .body");
    const li = e.target.closest && e.target.closest("[data-lid]");
    $$(".dropline, .drop").forEach((x) => x.classList.remove("dropline", "drop"));
    if (li && S.drag.ref) { e.preventDefault(); li.classList.add("drop"); return; }
    if ((tr || body) && S.items && !S.items.managed && !S.lists.readonly) { e.preventDefault(); if (tr) tr.classList.add("dropline"); }
  };
  v.ondrop = async (e) => {
    if (!S.drag) return;
    const d = S.drag; S.drag = null;
    const li = e.target.closest && e.target.closest("[data-lid]");
    if (li && d.ref) {
      e.preventDefault();
      const dst = +li.dataset.lid;
      if (dst !== S.cur) await listOp("/api/list/move_entries", { src: S.cur, dst, refs: [d.ref], copy: true }, "Şarkı o listeye de eklendi.");
      return;
    }
    if (!S.items || S.items.managed) return;
    e.preventDefault();
    const tr = e.target.closest && e.target.closest("#ltab tr[data-ref]");
    const refs = S.items.items.map((r) => r.ref);
    let at = tr ? refs.indexOf(tr.dataset.ref) : refs.length;
    if (d.ref) {
      const from = refs.indexOf(d.ref);
      if (from < 0 || from === at) return;
      refs.splice(from, 1);
      if (from < at) at -= 1;
      refs.splice(at, 0, d.ref);
      await listOp("/api/list/reorder", { id: S.cur, refs });
    } else if (d.fid) {
      await listOp("/api/list/add", { id: S.cur, fids: [d.fid], at });
    }
  };
}

function listMenu(e) {
  const it = S.items;
  if (!it) return;
  const l = S.lists.lists.find((x) => x.id === it.id) || {};
  const items = [
    { label: "Kopyasını al", icon: "⧉", fn: async () => { const r = await listOp("/api/list/duplicate", { id: it.id }, "Kopyası alındı."); if (r) await selectList(r.id); } },
    { label: "Bundan yeni etkinlik", icon: "📅", fn: () => newEventDialog(it.id) },
    { label: "Yazdır", icon: "🖨", fn: () => window.open(`/api/print/${it.id}?t=${encodeURIComponent(TOKEN)}`, "_blank") },
  ];
  if (!it.managed) {
    items.push({ label: "Alt liste ekle", icon: "＋", fn: async () => { const n = await promptBox("Alt liste", "Adı", "", "Oluştur"); if (n) { const r = await listOp("/api/list/create", { parent: it.id, title: n }); if (r) await selectList(r.id); } } });
    items.push({ label: "Başka klasöre taşı…", icon: "⇢", fn: () => {
      const folders = S.lists.lists.filter((x) => !x.managed && x.id !== it.id && !x.path.slice(0, -1).includes(it.title));
      menu(e, [{ label: "En üste", icon: "⤒", fn: () => listOp("/api/list/move", { id: it.id, parent: 0 }) },
        ...folders.slice(0, 80).map((f) => ({ label: "  ".repeat(f.depth) + f.title, icon: "📁", fn: () => listOp("/api/list/move", { id: it.id, parent: f.id }) }))]);
    } });
    items.push("-", { label: "Listeyi sil", icon: "🗑", fn: async () => {
      const ok = await confirmBox("Listeyi sil", `“${it.title}”${l.kids ? ` ve ${l.kids} alt listesi` : ""} Engine'den silinecek. Şarkılar diskte ve koleksiyonda kalır. Geri alınabilir.`, "Sil", true);
      if (ok) { await listOp("/api/list/delete", { id: it.id }, "Liste silindi (Geri al ile geri gelir)."); }
    } });
  }
  menu(e, items);
}

function newEventDialog(baseId) {
  const t = S.lists;
  const temps = t.templates || [];
  const bases = t.lists.filter((l) => !l.managed && (l.kids || l.n));
  const today = new Date().toISOString().slice(0, 10);
  const m = modal(`<div class="dh">Yeni etkinlik</div><div class="db">
    <label class="field"><span>Adı</span><input id="evt" placeholder="ör. Ahmet & Ayşe Düğün"></label>
    <div style="display:flex;gap:10px"><label class="field" style="flex:1"><span>Tarih</span><input type="date" id="evd" value="${today}"></label>
    <label class="field" style="flex:1.4"><span>Yer</span><input id="evv" placeholder="Salon / şehir"></label></div>
    <div class="field"><span>Nasıl başlasın?</span><div class="opts">
      <label class="opt ${baseId ? "" : "on"}"><input type="radio" name="evk" value="t" ${baseId ? "" : "checked"}><div style="flex:1"><b>Şablondan</b><div class="muted small">Bölümler hazır gelir (Karşılama, Giriş, Halay…), içleri boş.</div>
        <select id="evtemp" class="search" style="margin-top:6px">${temps.map((x) => `<option value="${x.kind}">${esc(x.title)}${x.sections.length ? ` — ${x.sections.length} bölüm` : ""}</option>`).join("")}</select></div></label>
      <label class="opt ${baseId ? "on" : ""}"><input type="radio" name="evk" value="b" ${baseId ? "checked" : ""}><div style="flex:1"><b>Eski bir etkinliği / listeyi kopyala</b><div class="muted small">Bölümleri ve şarkılarıyla birlikte; sonra istediğini değiştirirsin.</div>
        <select id="evbase" class="search" style="margin-top:6px">${bases.map((x) => `<option value="${x.id}" ${x.id === baseId ? "selected" : ""}>${esc(x.path.join(" / "))} (${x.n})</option>`).join("")}</select></div></label>
    </div></div></div>
    <div class="df"><button class="btn" data-x="no">Vazgeç</button><button class="btn primary" data-x="yes">Oluştur</button></div>`);
  m.el.addEventListener("change", (e) => { if (e.target.name === "evk") $$(".opt", m.el).forEach((o) => o.classList.toggle("on", o.querySelector("input").checked)); });
  m.el.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-x]");
    if (!b) return;
    if (b.dataset.x === "no") { m.close(); return; }
    const title = $("#evt", m.el).value.trim();
    if (!title) { $("#evt", m.el).focus(); return; }
    const kind = $("input[name=evk]:checked", m.el).value;
    const body = { title, date: $("#evd", m.el).value, venue: $("#evv", m.el).value };
    if (kind === "t") body.template = $("#evtemp", m.el).value; else body.base = +$("#evbase", m.el).value;
    m.close();
    const r = await listOp("/api/event/new", body, "Etkinlik oluşturuldu.");
    if (r) { S.open[r.id] = true; await selectList(r.id); }
  });
}

async function seratoImportDialog() {
  let cs;
  try { cs = await api("/api/serato/crates"); } catch (e) { toast(e.message, "err"); return; }
  const m = modal(`<div class="dh">Serato'dan al</div><div class="db"><div class="muted small" style="margin-bottom:8px">Seçtiğin crate'ler Engine'de liste olur (alt crate'ler alt liste). Sonra iki tarafta da aynı kalır.</div>
    ${cs.map((c) => `<label class="nav-item" style="padding-left:${8 + (c.parts.length - 1) * 16}px"><input type="checkbox" value="${esc(c.name)}" ${c.linked ? "disabled" : ""}><span class="name">${esc(c.parts[c.parts.length - 1])}</span><span class="cnt">${c.linked ? "bağlı" : c.count}</span></label>`).join("") || '<div class="muted">Crate yok.</div>'}</div>
    <div class="df"><button class="btn" data-x="no">Vazgeç</button><button class="btn primary" data-x="yes">Seçilenleri Engine'e al</button></div>`, "wide");
  m.el.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-x]");
    if (!b) return;
    if (b.dataset.x === "no") { m.close(); return; }
    const names = $$("input[type=checkbox]:checked", m.el).map((x) => x.value);
    if (!names.length) return;
    m.close();
    const r = await listOp("/api/serato/import", { names }, "Serato crate'leri Engine'e alındı.");
    if (r && r.ids && r.ids[0]) await selectList(r.ids[0]);
  });
}

// ---------------------------------------------------------------------------
// GELEN KUTUSU
// ---------------------------------------------------------------------------
async function loadInbox() {
  S.inbox = await api("/api/inbox");
  renderInbox();
}

function renderInbox() {
  const ib = S.inbox;
  const gs = ib.genres;
  const gbtns = (path) => gs.map((g) => `<button class="gbtn" style="background:${esc(g.color)}" data-ing="${esc(path)}" data-g="${g.id}">${esc(g.name)}</button>`).join("");
  const wait = ib.items.filter((i) => ["nogenre", "similar", "broken", "unsupported", "held"].includes(i.status) || (!ib.auto && ["new", "exists"].includes(i.status)));
  const going = ib.items.filter((i) => i.status === "downloading" || (ib.auto && i.status === "new"));
  const sepName = ib.inbox.includes("\\") ? "\\" : "/";
  const row = (i) => {
    let st = "", acts = "";
    const name = `<div class="ttl">${esc(i.title || i.name)}</div><div class="art">${esc(i.artist || "")}${i.genre ? ` · klasör: ${esc(i.genre)}` : ""} · ${esc(i.name)}</div>`;
    if (i.status === "nogenre") { st = `<span class="tag warn">türü belli değil</span>`; acts = gbtns(i.path); }
    else if (i.status === "similar") {
      st = `<span class="tag warn">benzeri var</span>`;
      acts = `<span class="small muted">${esc(i.match.rel)}${i.match.bitrate ? ` (${i.match.bitrate} kbps)` : ""}${i.better ? " — yenisi daha kaliteli" : ""}</span>
        ${i.gid ? `<button class="btn sm" data-force="${esc(i.path)}" data-g="${i.gid}">Yine de ekle</button>` : gbtns(i.path)}<button class="btn sm" data-aside="${esc(i.path)}">Ekleme</button>`;
    } else if (i.status === "broken" || i.status === "unsupported") {
      st = `<span class="tag bad">${i.status === "broken" ? "bozuk / yarım" : "Prime 4 çalmaz"}</span>`;
      acts = `<span class="small muted">${esc(i.why || "")}</span><button class="btn sm" data-aside="${esc(i.path)}">Ayıkla</button>`;
    } else if (i.status === "held") {
      st = `<span class="tag">bekletiliyor</span>`;
      acts = i.gid ? `<button class="btn sm primary" data-force="${esc(i.path)}" data-g="${i.gid}">Ekle</button>` : gbtns(i.path);
      acts += `<button class="btn sm" data-aside="${esc(i.path)}">Ayıkla</button>`;
    } else if (i.status === "exists") {
      st = `<span class="tag">zaten var</span>`;
      acts = `<span class="small muted">${esc(i.match.rel)}</span><button class="btn sm" data-arch="${esc(i.path)}">Arşive kaldır</button>`;
    } else if (i.status === "new") {
      st = `<span class="tag ok">hazır</span>`;
      acts = `<button class="btn sm primary" data-force="${esc(i.path)}" data-g="${i.gid}">Ekle</button>`;
    }
    return `<div class="ib">${st}<div class="meta">${name}</div><div class="acts">${acts}</div></div>`;
  };
  const dl = ib.downloads || [];
  $("#view").innerHTML = `<div class="main"><div class="head"><div style="flex:1"><h2>Gelen</h2><div class="sub">Yeni şarkılar buradan girer. İndirirken türün klasörünü seç; gerisini program yapar.</div></div>
    <label class="switch ${ib.auto ? "on" : ""}" id="autotog"><i></i>Otomatik ekle</label></div>
    <div class="body">
    <div class="flow">
      <div class="st"><b>1 · İndir</b><span>${esc(ib.inbox)}${sepName}&lt;Tür&gt;</span></div><span class="ar">→</span>
      <div class="st"><b>2 · Kontrol</b><span>yarım mı? çalar mı? zaten var mı?</span></div><span class="ar">→</span>
      <div class="st"><b>3 · SSD</b><span>${esc(S.st.active.music_root || "Müzik")}/&lt;Tür&gt; (tek ev)</span></div><span class="ar">→</span>
      <div class="st"><b>4 · Engine</b><span>bir kez eklenir · “Analiz bekleyenler”</span></div><span class="ar">→</span>
      <div class="st"><b>5 · Arşiv</b><span>${esc(ib.archive)} (yedek, Engine'e girmez)</span></div>
    </div>
    <div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap"><button class="btn" id="openin">📂 Gelen klasörünü aç</button><button class="btn" id="openar">🗄 Arşivi aç</button>
      <span class="muted small" style="align-self:center">Tür klasörleri: ${gs.map((g) => esc(g.name)).join(", ")}</span></div>
    ${wait.length ? `<div class="card" style="padding:0"><div style="padding:12px 16px 4px"><h3>Senden karar bekleyenler (${wait.length})</h3></div>${wait.map(row).join("")}</div>` : ""}
    ${going.length ? `<div class="card" style="padding:0"><div style="padding:12px 16px 4px"><h3>Sırada</h3></div>${going.map((i) => `<div class="ib"><span class="tag blue">${i.status === "downloading" ? "iniyor…" : S.st.engine_open ? "Engine DJ kapanınca eklenecek" : "ekleniyor…"}</span><div class="meta"><div class="ttl">${esc(i.title || i.name)}</div><div class="art">${esc(i.genre || "")}</div></div></div>`).join("")}</div>` : ""}
    ${!wait.length && !going.length ? `<div class="empty" style="padding:28px"><div class="big">📥</div>Gelen kutusu boş. Yeni indirdiğin şarkıyı <b>${esc(ib.inbox)}${sepName}Halay</b> gibi bir tür klasörüne kaydet.</div>` : ""}
    ${dl.length ? `<div class="card" style="padding:0"><div style="padding:12px 16px 4px"><h3>İndirilenler klasöründe unutulanlar (${dl.length})</h3><div class="muted small">Türünü seçersen gelen kutusuna alınır.</div></div>
      ${dl.map((d) => `<div class="ib"><div class="meta"><div class="ttl">${esc(d.name)}</div></div><div class="acts">${gs.map((g) => `<button class="gbtn" style="background:${esc(g.color)}" data-take="${esc(d.path)}" data-g="${g.id}">${esc(g.name)}</button>`).join("")}<button class="btn sm ghost" data-ign="${esc(d.path)}">Yoksay</button></div></div>`).join("")}</div>` : ""}
    ${ib.log.length ? `<div class="card" style="padding:0"><div style="padding:12px 16px 4px"><h3>Son işlenenler</h3></div>${ib.log.slice(0, 20).map((l) => `<div class="ib"><span class="tag ${l.status === "eklendi" ? "ok" : ""}">${esc({ eklendi: "eklendi", zaten_vardi: "zaten vardı", ayiklanan: "ayıklandı" }[l.status] || l.status)}</span><div class="meta"><div>${esc(l.src)}</div><div class="art">${l.rel ? esc(l.rel) : ""} · ${new Date(l.ts * 1000).toLocaleString("tr-TR")}</div></div></div>`).join("")}</div>` : ""}
    </div></div>`;
  const v = $("#view");
  v.onclick = async (e) => {
    const ing = e.target.closest("[data-ing]");
    if (ing) { await ingest([{ path: ing.dataset.ing, gid: +ing.dataset.g }]); return; }
    const fo = e.target.closest("[data-force]");
    if (fo) { await ingest([{ path: fo.dataset.force, gid: +fo.dataset.g, force: true }]); return; }
    const as = e.target.closest("[data-aside]");
    if (as) { await act("/api/inbox/aside", { path: as.dataset.aside }, "Arşivdeki _Ayıklanan klasörüne kaldırıldı."); return; }
    const ar = e.target.closest("[data-arch]");
    if (ar) { await act("/api/inbox/archive", { path: ar.dataset.arch }, "Arşive kaldırıldı."); return; }
    const tk = e.target.closest("[data-take]");
    if (tk) { await act("/api/inbox/take", { path: tk.dataset.take, gid: +tk.dataset.g }, "Gelen kutusuna alındı."); return; }
    const ig = e.target.closest("[data-ign]");
    if (ig) { await act("/api/inbox/ignore", { path: ig.dataset.ign }); return; }
    if (e.target.id === "openin") { api("/api/inbox/open", {}).catch((er) => toast(er.message, "err")); return; }
    if (e.target.id === "openar") { api("/api/inbox/open", { archive: true }).catch((er) => toast(er.message, "err")); return; }
    if (e.target.closest("#autotog")) { await api("/api/prefs", { auto_inbox: !ib.auto }); await refresh(true); }
  };
}

async function ingest(entries) {
  try {
    const r = await task("/api/inbox/ingest", { entries });
    if (r.added) toast(`${r.added} şarkı eklendi; Engine'de “Analiz bekleyenler” listesinde.`, "ok");
  } catch (e) { /* */ }
  await refresh(true);
}

// ---------------------------------------------------------------------------
// Ayarlar
// ---------------------------------------------------------------------------
async function settingsDialog() {
  const st = S.st || {};
  const p = st.prefs || {};
  let journal = [];
  try { if (st.active) journal = await api("/api/journal"); } catch (e) { /* */ }
  const m = modal(`<div class="dh">Ayarlar</div><div class="db">
    <div style="display:flex;gap:10px"><label class="field" style="flex:1"><span>Görünüm</span><select id="ptheme"><option value="light" ${p.theme !== "dark" ? "selected" : ""}>Açık</option><option value="dark" ${p.theme === "dark" ? "selected" : ""}>Koyu</option></select></label>
    <label class="field" style="flex:1"><span>Yazı boyutu</span><select id="psize"><option value="normal">Normal</option><option value="large" ${p.text_size === "large" ? "selected" : ""}>Büyük</option></select></label></div>
    ${st.active ? `<label class="field"><span>Gelen kutusu (bu bilgisayarda)</span><input id="pin" value="${esc(p.inbox_dir || "")}" placeholder="Varsayılan: Müzik/DJ Gelen"></label>
    <label class="field"><span>Arşiv (bu bilgisayarda)</span><input id="par" value="${esc(p.archive_dir || "")}" placeholder="Varsayılan: Müzik/DJ Arşiv"></label>
    <label class="switch ${p.watch_downloads !== false ? "on" : ""}" data-pref="watch_downloads" style="margin:6px 0"><i></i>İndirilenler klasöründeki unutulan şarkıları göster</label><br>
    <label class="switch ${p.genre_lists !== false ? "on" : ""}" data-pref="genre_lists" style="margin:6px 0"><i></i>Engine'de “Türler” listelerini tut</label>
    <div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap"><button class="btn" id="pscan">Şimdi yeniden tara</button><button class="btn" id="pssd">Başka SSD seç</button><button class="btn" id="pq">Karantinayı aç</button></div>
    <h4 style="margin:18px 0 6px">Son işlemler</h4><div class="small" style="max-height:200px;overflow:auto">${journal.map((j) => `<div style="padding:3px 0;${j.status !== "tamam" ? "color:var(--muted);text-decoration:line-through" : ""}">${new Date(j.ts * 1000).toLocaleString("tr-TR")} — ${esc(j.title)}</div>`).join("") || '<span class="muted">Henüz işlem yok.</span>'}</div>
    <div class="muted small" style="margin-top:12px">SSD: ${esc(st.active.root)} · Sürüm ${esc(window.DJD_VERSION)}</div>` : ""}
    </div><div class="df"><button class="btn primary" data-x="ok">Tamam</button></div>`);
  m.el.addEventListener("change", async (e) => {
    const kw = {};
    if (e.target.id === "ptheme") kw.theme = e.target.value;
    if (e.target.id === "psize") kw.text_size = e.target.value;
    if (e.target.id === "pin") kw.inbox_dir = e.target.value.trim();
    if (e.target.id === "par") kw.archive_dir = e.target.value.trim();
    if (Object.keys(kw).length) { const np = await api("/api/prefs", kw); applyPrefs(np); S.st.prefs = np; }
  });
  m.el.addEventListener("click", async (e) => {
    const sw = e.target.closest("[data-pref]");
    if (sw) { const k = sw.dataset.pref; const on = !sw.classList.contains("on"); sw.classList.toggle("on", on); const np = await api("/api/prefs", { [k]: on }); S.st.prefs = np; return; }
    if (e.target.id === "pscan") { m.close(); try { await task("/api/scan", {}); toast("Tarama bitti.", "ok"); } catch (er) { /* */ } await refresh(true); return; }
    if (e.target.id === "pssd") { m.close(); const v = $("#view"); v.innerHTML = `<div class="setup"><h1>SSD seç</h1><div id="drives">…</div></div>`; drivesInto($("#drives"), null); return; }
    if (e.target.id === "pq") { api("/api/open", { path: st.active.root + "/_DJDoktor_/Karantina" }).catch((er) => toast(er.message, "err")); return; }
    if (e.target.closest("[data-x]")) m.close();
  });
}

// ---------------------------------------------------------------------------
refresh(true).then(poll);
