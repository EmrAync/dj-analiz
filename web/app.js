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
// Eklenti noktaları: ek özellik dosyaları (web/*.js) çekirdeğe dokunmadan buradan bağlanır.
//   DJD.tab({key, label, order, load: async () => {}})         -> üst sekme
//   DJD.toolView({key, icon, title, order, load, html, after}) -> Araçlar'da alt bölüm
//   DJD.settings({html: (st) => "", wire: (el, st) => {}})     -> Ayarlar penceresine bölüm
//   DJD.healthAction(act, label, async (cat) => {})            -> Sağlık kartında düğme
//   DJD.trackAction({label, fn: (fid, detail) => {}})          -> şarkı ayrıntısında düğme
//   DJD.listMenu((it, list, e) => [menu öğeleri])              -> liste ⋯ menüsüne öğeler
// Düzen yardımcıları (ayrıntı: style.css başındaki sözleşme):
//   DJD.layout()                  -> yeni eklenen kutuları (data-w) ve sütun modelli tabloları hemen tara
//   DJD.fitCols(table)            -> <col data-w/data-min/data-pri/data-flex> taşıyan tabloyu genişliğe sığdır
//   DJD.popover(el, anchor)       -> position:fixed bir öğeyi çapanın altına/üstüne yerleştir (ekrandan taşmaz)
//   menu(ev, items, {filter})     -> açılır menü; öğe: {label, icon|color, fn, depth, note, title} | "-" | {label, head}
//   DJD.tab({...})                -> dar pencerede sığmayan sekmeler "⋯" menüsüne iner (etkin sekme hep görünür)
//   DJD.toolView({..., width})    -> width: "wide" (çok sütunlu tablo, tam genişlik) | "read" (kartlar, okuma genişliği)
//   table "djd:cols" olayı         -> sütun modeli bir sütunu gizleyince / gösterince (e.detail.hidden = [sütun no])
//   .split > .side / .picker       -> kenarından sürüklenip genişletilir (kendiliğinden; genişlik sekme başına saklanır)
//   DJD.restoreScroll(scroller, top) -> yeniden çizimden sonra kaydırma yerini geri koy; sanal tabloları (vtSet) ÖNCE kur
//   modal(html, cls, onClose)     -> onClose: Esc / dışarı tıklama / closeModal() ile kapanınca bir kez çağrılır
//   DJD.genreStyle(renk)          -> style="…" değeri; .gtx (renkli yazı) / .gfill (beyaz yazılı dolgu) ile tür rengi her temada okunur
// ---------------------------------------------------------------------------
const DJD = {
  tabs: [], toolViews: [], settingsParts: [], healthActs: {}, trackActs: [], listMenus: [],
  tab(t) { this.tabs.push(t); this.tabs.sort((a, b) => (a.order || 0) - (b.order || 0)); },
  toolView(v) { this.toolViews.push(v); this.toolViews.sort((a, b) => (a.order || 0) - (b.order || 0)); },
  settings(p) { this.settingsParts.push(p); },
  healthAction(act, label, fn) { this.healthActs[act] = { label, fn }; },
  trackAction(a) { this.trackActs.push(a); },
  listMenu(fn) { this.listMenus.push(fn); },
  layout() { layoutScan(true); },
  fitCols(table) { if (table) { fitCols(table); fitWatch(table); } },
  popover(el, anchor) { placePop(el, anchor && anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : anchor); },
  restoreScroll(scroller, top) { vtRestore(scroller, top); },
  genreStyle(color) { return gStyle(color); },
};
window.DJD = DJD;

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

// Görev kartı: bir kez kurulur, sonra yalnızca metin ve çubuk güncellenir (✕ tıklaması kaybolmasın)
function taskCard(t) {
  const bar = $("#taskbar");
  let el = bar.querySelector(".task");
  if (!el || el.dataset.id !== String(t.id)) {
    bar.innerHTML = `<div class="task" data-id="${t.id}"><div class="tt"><span class="tn"></span><span class="tr"><span class="tp muted"></span>
      <button class="tx" type="button" title="Durdur" aria-label="Durdur" hidden>✕</button></span></div>
      <div class="msg"></div><div class="prog"><i></i></div></div>`;
    el = bar.querySelector(".task");
    const x = el.querySelector(".tx");
    x.onclick = async () => {
      x.hidden = true; el.dataset.stopping = "1";
      el.querySelector(".msg").textContent = "Durduruluyor…";
      try { await api("/api/task/" + t.id + "/cancel", {}); } catch (e) { /* */ }
    };
  }
  el.querySelector(".tn").textContent = t.title;
  el.querySelector(".tn").title = t.title || "";
  el.querySelector(".tp").textContent = Math.round(t.progress * 100) + "%";
  if (!el.dataset.stopping || t.cancelling) { const mg = el.querySelector(".msg"); mg.textContent = t.message || ""; mg.title = t.message || ""; }
  el.querySelector(".prog i").style.width = Math.round(t.progress * 100) + "%";
  el.querySelector(".tx").hidden = !(t.cancellable && !t.cancelling && !el.dataset.stopping);
}

async function task(path, body, opts = {}) {
  let res;
  playerRelease();                       // çalınan dosya açıkken Windows onu taşıyamaz
  try {
    res = await api(path, body);
  } catch (e) { playerResume(); toast(e.message, "err"); throw e; }
  if (!res || !res.task) playerResume();
  if (!res || !res.task) return res;
  S.busy = true;
  const bar = $("#taskbar");
  try {
    for (;;) {
      const t = await api("/api/task/" + res.task);
      taskCard(t);
      if (t.status === "bitti") { bar.innerHTML = ""; S.busy = false; return t.result; }
      if (t.status === "iptal") {
        bar.innerHTML = ""; S.busy = false;
        toast(t.result && t.result.forgotten ? "Tarama durduruldu; bu seçimden vazgeçildi." : "Tarama durduruldu.", "ok");
        const e = new Error("durduruldu"); e.code = "cancelled"; throw e;
      }
      if (t.status === "hata") {
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
  } finally { S.busy = false; playerResume(); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function act(path, body, okMsg) {
  const mv = /quarantine|inbox\/(aside|archive|take)/.test(path);   // dosya taşıyan istekler: çaları bırak
  if (mv) playerRelease();
  try {
    const r = await api(path, body);
    if (okMsg) toast(okMsg, "ok");
    await refresh();
    return r;
  } catch (e) {
    toast(e.message, "err");
    throw e;
  } finally { if (mv) playerResume(); }
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

// Pencere: modal(html, cls, onClose). Esc, dışarı tıklama, closeModal() ya da yerine yeni pencere açılması onClose'u
// bir kez çağırır (ör. onay penceresi "hayır" döner; bekleyen işlem askıda kalmaz).
function modal(html, cls = "", onClose) {
  const root = $("#modal");
  const old = root.firstElementChild;
  root.innerHTML = `<div class="overlay"><div class="dialog ${cls}">${html}</div></div>`;
  modalGone(old);
  const ov = root.firstElementChild;
  ov._onClose = onClose || null;
  const close = () => { const cur = root.firstElementChild; root.innerHTML = ""; modalGone(cur); };
  ov.addEventListener("mousedown", (e) => { if (e.target === ov) close(); });
  const f = ov.querySelector("input:not([type=radio]):not([type=checkbox]), select, textarea");
  if (f) setTimeout(() => f.focus({ preventScroll: true }), 30);
  return { el: ov, close };
}
function modalGone(ov) { const cb = ov && ov._onClose; if (cb) { ov._onClose = null; try { cb(); } catch (e) { /* */ } } }
function closeModal() { const r = $("#modal"), cur = r.firstElementChild; r.innerHTML = ""; modalGone(cur); }

function confirmBox(title, text, okLabel = "Tamam", danger = false) {
  return new Promise((resolve) => {
    const m = modal(`<div class="dh">${esc(title)}</div><div class="db">${esc(text)}</div>
      <div class="df"><button class="btn" data-x="no">Vazgeç</button><button class="btn ${danger ? "danger" : "primary"}" data-x="yes">${esc(okLabel)}</button></div>`,
      "", () => resolve(false));
    m.el.addEventListener("click", (e) => {
      const b = e.target.closest("[data-x]");
      if (!b) return;
      resolve(b.dataset.x === "yes"); m.close();
    });
  });
}

function promptBox(title, label, value = "", okLabel = "Kaydet", hint = "") {
  return new Promise((resolve) => {
    const m = modal(`<div class="dh">${esc(title)}</div><div class="db">
      <label class="field"><span>${esc(label)}</span><input id="pv" value="${esc(value)}"></label>${hint ? `<div class="muted small">${hint}</div>` : ""}</div>
      <div class="df"><button class="btn" data-x="no">Vazgeç</button><button class="btn primary" data-x="yes">${esc(okLabel)}</button></div>`,
      "", () => resolve(null));
    const inp = $("#pv", m.el);
    setTimeout(() => { inp.focus({ preventScroll: true }); inp.select(); }, 40);
    const done = (ok) => { const v = inp.value.trim(); resolve(ok && v ? v : null); m.close(); };
    inp.addEventListener("keydown", (e) => { if (e.key === "Enter") done(true); if (e.key === "Escape") { e.preventDefault(); done(false); } });
    m.el.addEventListener("click", (e) => { const b = e.target.closest("[data-x]"); if (b) done(b.dataset.x === "yes"); });
  });
}

// ---------------------------------------------------------------------------
// Açılır pencere yerleşimi (menüler ve eklenti panelleri): çapanın altında, sığmazsa üstünde, o da olmazsa
// yanında açılır; ekrandan taşmaz, yüksekliği boş alana göre sınırlanır, mümkünse çapayı örtmez.
// ---------------------------------------------------------------------------
function placePop(el, a, gap = 4) {
  const M = 8, W = innerWidth, H = innerHeight;
  a = a || { left: W / 2, right: W / 2, top: H / 2, bottom: H / 2 };
  el.style.maxHeight = ""; el.style.left = "0px"; el.style.top = "0px";
  if (getComputedStyle(el).maxWidth === "none") el.style.maxWidth = (W - 2 * M) + "px";   // menülerin kendi sınırı CSS'te
  const w = el.offsetWidth, h = el.scrollHeight;
  const below = H - a.bottom - gap - M, above = a.top - gap - M, right = W - a.right - gap - M, left = a.left - gap - M;
  const cap = Math.max(120, H * .8);
  let x = a.left, y, mh;
  if (h <= below || (below >= above && below >= 150)) { y = a.bottom + gap; mh = below; }
  else if (h <= above || above >= 150) { mh = above; y = a.top - gap - Math.min(h, mh, cap); }
  else if (w <= Math.max(right, left)) {           // ne alt ne üst yetiyor: yanına
    mh = H - 2 * M; y = Math.min(a.top, H - M - Math.min(h, mh)); x = right >= w ? a.right + gap : a.left - gap - w;
  } else { mh = H - 2 * M; y = M; }                   // hiç yer yok: tüm yükseklik
  x = Math.max(M, Math.min(x, W - w - M));
  el.style.maxHeight = Math.max(80, Math.min(mh, cap)) + "px";
  el.style.left = Math.round(x) + "px";
  el.style.top = Math.round(Math.max(M, y)) + "px";
}

function closeMenu() { const r = $("#menu"); if (r && r.innerHTML) r.innerHTML = ""; }
const MENU = { closed: null, at: 0 };

// Menü: items = [{label, icon | color, fn, depth, note, title} | "-" | {label, head: true}]
// 14'ten çok öğede üstte bir arama kutusu çıkar (opts.filter ile zorlanabilir). Ekran kayınca / boyut değişince kapanır.
function menu(ev, items, opts = {}) {
  if (ev && ev.preventDefault) ev.preventDefault();
  if (ev && ev.stopPropagation) ev.stopPropagation();
  const root = $("#menu");
  const nBtn = items.filter((it) => it && it !== "-" && !it.head).length;
  const filt = opts.filter != null ? opts.filter : nBtn > 14;
  const html = items.map((it, i) => {
    if (!it) return "";
    if (it === "-") return "<hr>";
    if (it.label && it.head) return `<div class="lab">${esc(it.label)}</div>`;
    const ic = it.color ? `<span class="gdot" style="background:${esc(it.color)}"></span>` : (it.icon || "");
    const pad = it.depth ? ` style="padding-left:${10 + Math.min(it.depth, 8) * 14}px"` : "";
    const tt = it.title || (String(it.label).length > 28 ? it.label : "");
    return `<button data-i="${i}"${pad}${tt ? ` title="${esc(tt)}"` : ""}><span class="mi">${ic}</span><span class="ml">${esc(it.label)}</span>${it.note ? `<span class="mn">${esc(it.note)}</span>` : ""}</button>`;
  }).join("");
  root.innerHTML = `<div class="menu" role="menu">${filt ? `<input class="mf" placeholder="Ara…" aria-label="Menüde ara">` : ""}${html}</div>`;
  const m = root.firstElementChild;
  const tg = ev && ev.target && ev.target.closest ? ev.target.closest("button, .folder-chip, .chip, .nav-item, .gchip, [data-anchor]") : null;
  const anchor = tg && tg.isConnected ? tg : null;
  // aynı düğmeye ikinci tıklama menüyü kapatır (mousedown onu az önce kapattı; yeniden açma)
  if (anchor && MENU.closed === anchor && Date.now() - MENU.at < 800) { MENU.closed = null; root.innerHTML = ""; return; }
  const r = anchor ? anchor.getBoundingClientRect() : (ev && ev.clientX != null ? { left: ev.clientX, right: ev.clientX, top: ev.clientY, bottom: ev.clientY } : null);
  placePop(m, r);
  m._anchor = anchor;
  m._ar = r;
  m.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-i]");
    if (!b) return;
    root.innerHTML = "";
    const it = items[+b.dataset.i];
    if (it && it.fn) it.fn();
  });
  if (filt) {
    const f = m.querySelector(".mf");
    const btns = $$("button[data-i]", m);
    const keys = btns.map((b) => fold(b.textContent));
    f.addEventListener("input", () => {
      const q = fold(f.value).trim();
      btns.forEach((b, i) => { b.hidden = !!q && !keys[i].includes(q); });
      $$("hr, .lab", m).forEach((x) => { x.hidden = !!q; });
    });
    f.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { const b = btns.find((x) => !x.hidden); if (b) { e.preventDefault(); b.click(); } }
    });
    f.focus({ preventScroll: true });
  }
}
document.addEventListener("mousedown", (e) => {
  const m = $("#menu .menu");
  if (!m || e.target.closest(".menu")) return;
  MENU.closed = m._anchor && m._anchor.contains(e.target) ? m._anchor : null;
  MENU.at = Date.now();
  closeMenu();
});
// Sayfanın kendisi asla kaymasın (odak, Ctrl+F, sürükleme); menü, çapası yerinden oynayınca kapanır.
window.addEventListener("scroll", (e) => {
  const se = document.scrollingElement;
  if (se && (se.scrollLeft || se.scrollTop)) { se.scrollLeft = 0; se.scrollTop = 0; }
  const v = document.getElementById("view");
  if (v && (v.scrollLeft || v.scrollTop)) { v.scrollLeft = 0; v.scrollTop = 0; }
  const m = $("#menu .menu");
  if (!m) return;
  const t = e.target;
  if (t && t.nodeType === 1 && m.contains(t)) return;
  const a = m._anchor;
  if (!a || !a.isConnected) { closeMenu(); return; }
  const r = a.getBoundingClientRect(), o = m._ar;
  if (!o || Math.abs(r.top - o.top) > 2 || Math.abs(r.left - o.left) > 2) closeMenu();
}, true);
window.addEventListener("resize", closeMenu);
document.addEventListener("pointermove", (e) => { if (S.drag && e.buttons === 0) S.drag = null; }, { passive: true });
document.addEventListener("focusin", (e) => { if (e.target.matches("input, textarea, select")) S.editing = true; });
document.addEventListener("focusout", (e) => { if (e.target.matches("input, textarea, select")) S.editing = false; });

// Noktanın nedeni (kırmızı neden kırmızı?) — satırın üzerine gelince ve ayrıntı panelinde görünür
function dotWhy(r) {
  if (r.bad) return "Kırmızı: dosya bozuk ya da yarım inmiş";
  if (r.fmt) return "Kırmızı: Prime 4 bu dosya biçimini çalmaz";
  if (r.es === "broken") return "Kırmızı: Engine'deki yol bu dosyayı bulamıyor (program otomatik onarır)";
  if (r.dot === "pending") return "Turuncu: Engine'de, ama Engine DJ henüz analiz etmedi";
  if (r.dot === "ready") return "Yeşil: Engine'de ve analiz edildi";
  if (r.dot === "none") return "Boş: Engine'de değil";
  return "";
}
function dotHtml(d, title) {
  const t = { ready: "Hazır: Engine'de, analiz edildi", pending: "Engine'de, analiz bekliyor", none: "Engine'de değil", problem: "Sorun var" }[d] || "";
  return `<span class="dot ${d || "none"}" title="${esc(title || t)}"></span>`;
}

// bugünün tarihi yerel saate göre (toISOString UTC verir: Almanya'da gece 00–02 arası "dün" çıkardı)
function localDay(d) { d = d ? new Date(d) : new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); }

function genreById(id) { return ((S.ov && S.ov.genres) || []).find((g) => g.id === +id); }

// Tür renkleri (sarı, turuncu, camgöbeği…) yazı ya da beyaz yazılı dolgu olunca da okunur kalsın (≥ 4.5:1, iki temada):
//   gStyle(renk) -> style değeri: --gc (asıl renk), --gc-t / --gc-td (açık / koyu temada yazı rengi), --gc-f (dolgu)
//   CSS: .gtx = renkli yazı + asıl renkte çerçeve (ör. tür etiketi), .gfill = beyaz yazılı dolgu (tür düğmesi, çip)
// Renk zaten yeterliyse olduğu gibi kalır; değilse yazı mürekkebe doğru, dolgu siyaha doğru adım adım koyulaşır.
const GSTY = new Map();
function gStyle(c) {
  c = String(c || "").trim().toLowerCase();
  if (GSTY.has(c)) return GSTY.get(c);
  const m = /^#([0-9a-f]{6})$/.exec(c);
  if (!m) { const s = /^[#a-z0-9(),.% ]{1,40}$/.test(c) ? `--gc:${c};--gc-t:${c};--gc-td:${c};--gc-f:${c}` : ""; GSTY.set(c, s); return s; }
  const rgb = (h) => [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  const lum = (v) => { const f = v.map((x) => { x /= 255; return x <= .03928 ? x / 12.92 : Math.pow((x + .055) / 1.055, 2.4); }); return .2126 * f[0] + .7152 * f[1] + .0722 * f[2]; };
  const cr = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
  const hex = (v) => "#" + v.map((x) => Math.round(x).toString(16).padStart(2, "0")).join("");
  const fit = (base, to, bg) => { for (let p = 0; p <= 1; p += .05) { const v = base.map((x, i) => x + (to[i] - x) * p); if (cr(v, bg) >= 4.6) return hex(v); } return hex(to); };
  const v = rgb(m[1]);
  // en kötü zeminler: açıkta seçili satır (#e8f0fe), koyuda seçili satır (#1f2a44)
  const s = `--gc:${c};--gc-t:${fit(v, [29, 35, 48], [232, 240, 254])};--gc-td:${fit(v, [233, 235, 239], [31, 42, 68])};--gc-f:${fit(v, [0, 0, 0], [255, 255, 255])}`;
  GSTY.set(c, s);
  return s;
}

// ---------------------------------------------------------------------------
// Yerleşim motoru: tek bir ResizeObserver
//   * kutulara genişlik sınıfı yazar: data-w = xs|s|m|l|xl|xxl (rem eşikleri, bkz. style.css), #view'a data-h
//   * sütun modelli tabloları (fitCols) kap genişliği değişince yeniden sığdırır, sanal tabloyu tamamlar
//   * üst çubuğu sığdırır (fitTop), alt katmanın (#dock) yerini ayarlar (dockSync)
// Ağır işler requestAnimationFrame'de toplu yapılır: önce hepsi ölçülür, sonra yazılır (layout thrash yok).
// ---------------------------------------------------------------------------
const WB = [["xs", 30], ["s", 45], ["m", 60], ["l", 75], ["xl", 100], ["xxl", Infinity]];
const HB = [["s", 32], ["m", 46], ["l", Infinity]];
const LAY = { rem: 15, ro: null, mo: null, wEls: new Set(), hosts: new Map(), pend: new Set(), raf: 0, top: false, all: false, bulk: -1 };
const LAY_SEL = "#view, #top, #view .main, #view .side, #view .picker, #view .setup, .dialog, .drawer, [data-cw]";
const LAY_NEW = ".main, .side, .picker, .setup, .dialog, .drawer, [data-cw], colgroup, [data-dock]";
const COL_SEL = "table > colgroup > col[data-w], table > colgroup > col[data-flex], table > colgroup > col[data-pri], table > colgroup > col[data-min], table > colgroup > col[data-off]";
const bucket = (px, B) => { const r = px / LAY.rem; for (const [k, lim] of B) if (r < lim) return k; return B[B.length - 1][0]; };
function remPx() { LAY.rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 15; }
function setBucket(el, w, h) {
  if (!(w > 0)) return;
  const b = bucket(w, WB);
  if (el.dataset.w !== b) el.dataset.w = b;
  if (el.id === "view" && h > 0) { const hb = bucket(h, HB); if (el.dataset.h !== hb) el.dataset.h = hb; }
}

function layRO() {
  if (LAY.ro || !window.ResizeObserver) return LAY.ro;
  LAY.ro = new ResizeObserver((ents) => {
    for (const en of ents) {
      const el = en.target;
      const bb = en.borderBoxSize && en.borderBoxSize[0];
      const w = bb ? bb.inlineSize : en.contentRect.width, h = bb ? bb.blockSize : en.contentRect.height;
      if (LAY.wEls.has(el)) setBucket(el, w, h);       // yalnız nitelik yazar: ilk çizimden önce doğru düzen
      const ts = LAY.hosts.get(el);
      if (ts) ts.forEach((t) => LAY.pend.add(t));
      if (el.id === "top") LAY.top = true;
      if (el.id === "taskbar") document.documentElement.style.setProperty("--task-h", h > 0 ? Math.ceil(h + 12) + "px" : "0px");
    }
    layFlush();
  });
  return LAY.ro;
}

function layFlush() {
  if (LAY.raf) return;
  LAY.raf = requestAnimationFrame(() => {
    LAY.raf = 0;
    if (LAY.all) {                                       // yazı boyutu değişti: hepsini yeniden ölç
      LAY.all = false;
      const els = [...LAY.wEls].filter((el) => el.isConnected);
      const rs = els.map((el) => el.getBoundingClientRect());
      els.forEach((el, i) => setBucket(el, rs[i].width, rs[i].height));
      LAY.hosts.forEach((ts) => ts.forEach((t) => LAY.pend.add(t)));
      LAY.top = true;
    }
    dockSync();
    const ts = [...LAY.pend].filter((t) => t.isConnected);
    LAY.pend.clear();
    const ws = ts.map((t) => colAvail(t));               // önce ölç
    ts.forEach((t, i) => fitCols(t, ws[i]));             // sonra yaz
    Object.values(VT).forEach((st) => { if (st.table.isConnected) vtDraw(st, st.remeasure); });
    if (LAY.top) { LAY.top = false; fitTop(); }
  });
}

// Yeni kutuları ve sütun modelli tabloları gözlemeye al; kopanları bırak. (#view'daki her çizimden sonra kendiliğinden.)
function layoutScan(now) {
  const ro = layRO();
  if (!ro) return;
  for (const el of LAY.wEls) if (!el.isConnected) { ro.unobserve(el); LAY.wEls.delete(el); }
  for (const [host, ts] of LAY.hosts) {
    for (const t of ts) if (!t.isConnected) ts.delete(t);
    if (!ts.size || !host.isConnected) { if (!LAY.wEls.has(host)) ro.unobserve(host); LAY.hosts.delete(host); }
  }
  $$(LAY_SEL).forEach((el) => { if (!LAY.wEls.has(el)) { LAY.wEls.add(el); ro.observe(el); } });
  const tb = $("#taskbar");
  if (tb && !tb._lay) { tb._lay = 1; ro.observe(tb); }
  new Set($$(COL_SEL).map((c) => c.closest("table"))).forEach((t) => { if (t && !t._fit) { fitCols(t); fitWatch(t); } });
  paneScan();
  if (now) { LAY.top = true; LAY.hosts.forEach((ts) => ts.forEach((t) => LAY.pend.add(t))); layFlush(); }
  dockSync();
}

// ---------------------------------------------------------------------------
// Bölme genişliği: kenar listesi (.split > .side) ve ekleme paneli (.split > .picker) kenarından sürüklenerek
// genişletilir (←/→ tuşları da olur, çift tık varsayılana döner). Genişlik sekme başına rem olarak saklanır,
// çekmece olduklarında (dar pencere) tutamak gizlidir (CSS: .gut).
// ---------------------------------------------------------------------------
const paneKey = (el) => `djd.pane.${S.tab || "x"}.${el.classList.contains("picker") ? "picker" : "side"}`;
function paneApply(el) {
  let v = null;
  try { v = parseFloat(localStorage.getItem(paneKey(el))); } catch (e) { v = null; }
  if (v > 0) el.style.setProperty("--pane-w", v + "rem"); else el.style.removeProperty("--pane-w");
}
function paneScan() {
  $$("#view .split > .side, #view .split > .picker").forEach((el) => {
    if (el.querySelector(":scope > .gut")) return;
    const g = document.createElement("div");
    g.className = "gut";
    g.tabIndex = 0;
    g.setAttribute("role", "separator");
    g.setAttribute("aria-orientation", "vertical");
    g.setAttribute("aria-label", "Genişlik");
    g.title = "Sürükle: genişlik · çift tık: varsayılan";
    el.appendChild(g);
    if (!el._pane) { el._pane = 1; paneApply(el); }
  });
}
function paneSet(el, px, save) {
  const sp = el.parentElement, pk = el.classList.contains("picker");
  const max = Math.max(12 * LAY.rem, (sp ? sp.clientWidth : innerWidth) * (pk ? .42 : .38));
  const w = Math.round(Math.max(11 * LAY.rem, Math.min(px, max)));
  el.style.setProperty("--pane-w", (w / LAY.rem).toFixed(2) + "rem");
  if (save) { try { localStorage.setItem(paneKey(el), (w / LAY.rem).toFixed(2)); } catch (e) { /* */ } }
}
document.addEventListener("pointerdown", (e) => {
  const g = e.target.closest && e.target.closest(".gut");
  if (!g || e.button !== 0) return;
  const el = g.parentElement, pk = el.classList.contains("picker");
  e.preventDefault();
  g.setPointerCapture(e.pointerId);
  document.documentElement.classList.add("resizing");
  let raf = 0, last = null;
  const mv = (ev) => {
    last = ev;
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      const r = el.getBoundingClientRect();
      paneSet(el, pk ? r.right - last.clientX : last.clientX - r.left, false);
    });
  };
  const up = () => {
    g.removeEventListener("pointermove", mv);
    document.documentElement.classList.remove("resizing");
    paneSet(el, el.getBoundingClientRect().width, true);
  };
  g.addEventListener("pointermove", mv);
  g.addEventListener("pointerup", up, { once: true });
  g.addEventListener("pointercancel", up, { once: true });
});
document.addEventListener("dblclick", (e) => {
  const g = e.target.closest && e.target.closest(".gut");
  if (!g) return;
  try { localStorage.removeItem(paneKey(g.parentElement)); } catch (er) { /* */ }
  g.parentElement.style.removeProperty("--pane-w");
});
document.addEventListener("keydown", (e) => {
  const g = e.target.closest && e.target.closest(".gut");
  if (!g || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
  e.preventDefault();
  const el = g.parentElement, d = (e.key === "ArrowRight" ? 1 : -1) * (el.classList.contains("picker") ? -1 : 1);
  paneSet(el, el.getBoundingClientRect().width + d * LAY.rem, true);
});

function relayout() {
  remPx();
  Object.values(VT).forEach((st) => { st.measured = false; st.remeasure = true; });
  LAY.all = true;
  layFlush();
}

// Alt çubuk (data-dock, ör. toplu işlem çubuğu) görünürken bildirimler ve görev kartı onun üstüne çıkar.
function dockSync() {
  let h = 0;
  $$("#view [data-dock]").forEach((el) => { if (el.firstElementChild) h = Math.max(h, el.offsetHeight); });
  if (h !== LAY.bulk) { LAY.bulk = h; document.documentElement.style.setProperty("--bulk-h", h + "px"); }
}

// ---------------------------------------------------------------------------
// Sütun modeli: <colgroup> içindeki her <col> şunları taşıyabilir (sayı = px; em tablonun yazısına, rem köke,
// % kullanılabilir genişliğe göre):
//   data-w="4em"     tercih edilen genişlik. Yoksa (ya da data-flex varsa) sütun esnektir, kalan yeri alır.
//   data-min="3em"   en dar hali (varsayılan: data-w; esnek sütunda 10em). Yer azalınca önce buna kadar daralır.
//   data-max="30em"  esnek sütunun en geniş hali (varsayılan sınırsız).
//   data-flex="2"    esnek sütunların kalan yerden payı.
//   data-pri="3"     yer yine yetmezse gizlenme sırası: küçük sayı önce gizlenir. Yoksa hiç gizlenmez.
//   data-off         sütun şimdilik hiç gösterilmez (ör. bu görünümde tamamen boş); sıra numaraları değişmez.
// Gizlenen sütunun bilgisi başka hücrede gösterilebilir: <span class="vf" data-c="4">…</span> (4 = sütun sırası,
// 1'den başlar) yalnızca 4. sütun gizliyken görünür. Gizli sütunlar tabloda data-hide="4 5" olarak durur; bu küme
// değişince tablo "djd:cols" olayını yayar (e.detail.hidden = [4, 5]), ör. "2 sütun sığmadı" göstermek için.
// Gizlenemeyen sütunlar bile sığmazsa tablo min-width alır ve kendi kutusunda yatay kayar (sayfa kaymaz).
// Kullanım: sanal tablolarda vtSet kendisi uygular; düz tablolarda nitelikleri yazmak yeter (otomatik taranır),
// ya da DJD.fitCols(table). Satırlar sabit yükseklikte, sarmasız kalır (CLAUDE.md §9).
// ---------------------------------------------------------------------------
(function colRules() {
  let css = "";
  for (let i = 1; i <= 40; i++) {
    const h = `table[data-hide~="${i}"]`;
    css += `${h}>thead>tr>:nth-child(${i}),${h}>tbody>tr:not(.vpad)>:nth-child(${i}){visibility:hidden;padding:0;border:0}${h} .vf[data-c="${i}"]{display:inline}\n`;
  }
  const s = document.createElement("style");
  s.id = "djd-cols";
  s.textContent = css;
  document.head.appendChild(s);
})();

function colSpec(col) {
  const d = col.dataset;
  const model = d.w != null || d.min != null || d.max != null || d.flex != null || d.pri != null || d.off != null;
  const legacy = col.style.width || null;
  const w = d.w != null ? d.w : legacy;
  const flex = d.flex != null ? (+d.flex || 0) : (w == null ? 1 : 0);
  return { model, w, min: d.min != null ? d.min : null, max: d.max != null ? d.max : null, flex, pri: d.pri != null ? +d.pri : null, off: d.off != null };
}
function colLen(v, fs, W) {
  if (v == null || v === "") return null;
  const s = String(v).trim(), n = parseFloat(s);
  if (!isFinite(n)) return null;
  if (s.endsWith("rem")) return n * LAY.rem;
  if (s.endsWith("em")) return n * fs;
  if (s.endsWith("%")) return n * W / 100;
  return n;
}
// Tablonun kullanabileceği genişlik (kabın iç genişliği, tablonun max-width'i ile sınırlı) ve yazı boyutu
function colAvail(t) {
  const host = t.parentElement;
  if (!host) return null;
  const hs = getComputedStyle(host), ts = getComputedStyle(t);
  let W = host.clientWidth - (parseFloat(hs.paddingLeft) || 0) - (parseFloat(hs.paddingRight) || 0);
  if (ts.maxWidth && ts.maxWidth.endsWith("px")) W = Math.min(W, parseFloat(ts.maxWidth));
  return { W, fs: parseFloat(ts.fontSize) || LAY.rem };
}
function fitCols(table, av) {
  const cg = table && table.querySelector(":scope > colgroup");
  if (!cg) return;
  const cols = Array.from(cg.children);
  if (!table._cspec || table._cspec.cg !== cg || table._cspec.n !== cols.length) table._cspec = { cg, n: cols.length, cols: cols.map(colSpec) };
  const S0 = table._cspec.cols;
  if (!S0.some((c) => c.model)) return;                       // eski usul colgroup: dokunma
  av = av || colAvail(table);
  if (!av || !(av.W > 0)) return;
  const W = av.W, fs = av.fs;
  const C = S0.map((c) => {
    const w = colLen(c.w, fs, W);
    const min = colLen(c.min, fs, W) != null ? colLen(c.min, fs, W) : (w != null && !c.flex ? w : (c.flex && w == null ? 10 * fs : Math.min(w, 10 * fs)));
    const pref = Math.max(min, w != null ? w : min);
    const max = colLen(c.max, fs, W) != null ? colLen(c.max, fs, W) : (c.flex ? Infinity : pref);
    return { min, pref, max: Math.max(max, min), flex: c.flex, pri: c.pri };
  });
  const vis = S0.map((c) => !c.off);
  let need = C.reduce((s, c, i) => s + (vis[i] ? c.min : 0), 0);
  while (need > W + .5) {                                      // önce en önemsiz sütunlar gizlenir
    let k = -1;
    C.forEach((c, i) => { if (vis[i] && c.pri != null && (k < 0 || c.pri <= C[k].pri)) k = i; });
    if (k < 0) break;
    vis[k] = false; need -= C[k].min;
  }
  const wd = C.map((c, i) => (vis[i] ? c.min : 0));
  let R = W - need;
  if (R > 0) {                                                 // tercih edilen genişliğe doğru, orantılı
    const gap = C.map((c, i) => (vis[i] ? c.pref - c.min : 0));
    const G = gap.reduce((s, g) => s + g, 0);
    if (G > 0) { const f = Math.min(1, R / G); gap.forEach((g, i) => { wd[i] += g * f; }); R -= G * f; }
  }
  for (let guard = 0; R > .5 && guard < 6; guard++) {           // kalan yer esnek sütunlara
    const fl = C.map((c, i) => (vis[i] && c.flex > 0 && wd[i] < c.max - .5 ? c.flex : 0));
    const F = fl.reduce((s, f) => s + f, 0);
    if (!F) break;
    let used = 0;
    fl.forEach((f, i) => { if (f) { const add = Math.min(R * f / F, C[i].max - wd[i]); wd[i] += add; used += add; } });
    R -= used;
    if (used < .5) break;
  }
  const tot = wd.reduce((s, x) => s + x, 0);
  let sink = -1;                                               // tarayıcının yuvarlama artığını alan sütun
  C.forEach((c, i) => { if (vis[i] && c.flex > 0 && c.max === Infinity && (sink < 0 || c.flex > C[sink].flex)) sink = i; });
  const hide = [];
  cols.forEach((col, i) => {
    const v = !vis[i] ? "0px" : (i === sink && tot <= W + 1 ? "" : Math.floor(wd[i]) + "px");
    if (col.style.width !== v) col.style.width = v;
    if (!vis[i]) hide.push(i + 1);
  });
  const hs = hide.join(" ");
  if ((table.dataset.hide || "") !== hs) {
    if (hs) table.dataset.hide = hs; else delete table.dataset.hide;
    table.dispatchEvent(new CustomEvent("djd:cols", { bubbles: true, detail: { hidden: hide } }));
  }
  if (!table.dataset.fit) table.dataset.fit = "1";
  const mw = tot > W + 1 ? Math.ceil(tot) + "px" : "";         // gizlenemeyenler bile sığmıyor: kutusunda yatay kayar
  if (table.style.minWidth !== mw) table.style.minWidth = mw;
  const tw = sink < 0 && tot < W - 1 ? Math.floor(tot) + "px" : "";   // hepsi tavanında: tablo daha dar kalır
  if (table.style.width !== tw) table.style.width = tw;
}
function fitWatch(table, scroller) {
  const ro = layRO();
  if (!ro || !table) return;
  table._fit = 1;
  [table.parentElement, scroller].forEach((host) => {
    if (!host) return;
    if (!LAY.hosts.has(host)) { LAY.hosts.set(host, new Set()); ro.observe(host); }
    LAY.hosts.get(host).add(table);
  });
}

// ---------------------------------------------------------------------------
// Sanal tablo: binlerce satırda yalnızca ekranda görünenler (ve biraz fazlası) çizilir.
// Satır yüksekliği sabittir (CSS: table.t.v, --row-h); ilk çizimde gerçek yükseklik ölçülür.
// Kap boyu değişince (pencere, alt çubuk, yazı boyutu) yerleşim motoru eksik satırları tamamlar.
// Sütunlar yukarıdaki sütun modeline göre sığdırılır (<colgroup> içinde data-* nitelikleri).
// ---------------------------------------------------------------------------
const VT = {};
function vtSet(id, rows, rowHtml) {
  const table = document.getElementById(id);
  if (!table) return;
  let st = VT[id];
  if (!st || st.table !== table) {
    if (st && st.scroller) st.scroller.removeEventListener("scroll", st.onScroll);
    st = VT[id] = { table, h: (st && st.h) || 48, raf: 0 };
    st.scroller = table.closest(".body") || table.parentElement;
    st.onScroll = () => { if (!st.raf) st.raf = requestAnimationFrame(() => { st.raf = 0; vtDraw(st); }); };
    st.scroller.addEventListener("scroll", st.onScroll, { passive: true });
    fitCols(table);
    fitWatch(table, st.scroller);
  }
  st.rows = rows; st.rowHtml = rowHtml; st.a = st.b = -1;
  st.cols = table.tHead && table.tHead.rows[0] ? table.tHead.rows[0].cells.length : 1;
  vtDraw(st, true);
}
function vtDraw(st, force) {
  if (!st.table.isConnected || !st.rows) return;
  st.remeasure = false;
  const n = st.rows.length;
  const head = st.table.tHead ? st.table.tHead.offsetHeight : 0;
  const y0 = st.scroller.scrollTop - st.table.offsetTop - head;
  const vh = st.scroller.clientHeight || 800;
  const over = 15, edge = 4;
  const f = Math.max(0, Math.min(n, Math.floor(y0 / st.h))), l = Math.min(n, Math.max(0, Math.ceil((y0 + vh) / st.h)));
  // çizili aralık görünen satırları kenardan en az `edge` satır payla hâlâ kapsıyorsa dokunma: kaydırırken her
  // satırda değil ~10 satırda bir çizilir (tbody yeniden kurulumu + yerleşim her karede olmasın)
  if (!force && st.a >= 0 && st.a <= Math.max(0, f - edge) && st.b >= Math.min(n, l + edge)) return;
  const a = Math.max(0, f - over), b = Math.min(n, l + over);
  if (!force && a === st.a && b === st.b) return;
  st.a = a; st.b = b;
  let html = a > 0 ? `<tr class="vpad"><td colspan="${st.cols}" style="height:${a * st.h}px"></td></tr>` : "";
  for (let i = a; i < b; i++) html += st.rowHtml(st.rows[i], i);
  if (b < n) html += `<tr class="vpad"><td colspan="${st.cols}" style="height:${(n - b) * st.h}px"></td></tr>`;
  st.table.tBodies[0].innerHTML = html;
  if (!st.measured && b > a) {
    st.measured = true;
    const r = st.table.tBodies[0].querySelector("tr:not(.vpad)");
    const rh = r ? r.getBoundingClientRect().height : 0;
    if (rh && Math.abs(rh - st.h) > .5) { st.h = rh; vtDraw(st, true); }
  }
}
function vtRedraw(id) { const st = VT[id]; if (st) vtDraw(st, true); }
// Yeniden çizimden sonra kaydırma yerini geri koy. Sanal tablo ÖNCE vtSet ile kurulmalı: boş tabloda scrollTop 0'a
// kırpılır. Bu kaydırıcıdaki sanal tablolar yeni yere göre hemen çizilir (bir kare boş/yanlış satır görünmez).
function vtRestore(scroller, top) {
  if (!scroller || !(top > 0)) return;
  scroller.scrollTop = top;
  Object.values(VT).forEach((st) => { if (st.scroller === scroller && st.table.isConnected) vtDraw(st, true); });
}

// ---------------------------------------------------------------------------
// Üst çubuk her genişlikte sığar: sığmadıkça sırayla kısalır (f1..f4, bkz. style.css); en sonda sığmayan
// sekmeler "⋯" menüsüne iner (etkin sekme hep görünür). ⚙ ve Engine/Serato kilit noktası hep görünür.
// ---------------------------------------------------------------------------
function fitTop() {
  const top = $("#top"), tabs = $("#tabs"), st = $("#status");
  if (!top || !tabs || !st) return;
  const over = (el) => !!el && el.scrollWidth > el.clientWidth + 1;
  const bad = () => over(top) || over(tabs) || over(st) || over($("#undo"));
  $$(".tab.ovf", tabs).forEach((t) => t.classList.remove("ovf"));
  const more = $("#tabmore");
  if (more) more.hidden = true;
  top.classList.remove("f1", "f2", "f3", "f4");
  for (let lv = 1; lv <= 4 && bad(); lv++) {
    top.classList.add("f" + lv);
    if (lv === 4 && more) {
      more.hidden = false;
      for (const t of $$(".tab[data-tab]:not(.on)", tabs).reverse()) { if (!bad()) break; t.classList.add("ovf"); }
      if (!$(".tab.ovf", tabs)) more.hidden = true;
    }
  }
}

// ---------------------------------------------------------------------------
// Ana çerçeve
// ---------------------------------------------------------------------------
function applyPrefs(p) {
  const de = document.documentElement;
  const th = p.theme === "dark" ? "dark" : "light", sz = p.text_size === "large" ? "large" : "normal";
  if (de.dataset.theme !== th) de.dataset.theme = th;
  if (de.dataset.size !== sz) { de.dataset.size = sz; relayout(); }
}

const pill = (cls, label, title, dot = "") => `<span class="pill ${cls}" title="${esc(title)}" aria-label="${esc(label)}"><span class="d ${dot}"></span><span class="lbl">${esc(label)}</span></span>`;

function renderTop() {
  const st = S.st || {};
  const ready = st.active && st.active.setup_done;
  const ov = S.ov || {};
  const attn = (ov.unsorted || 0) + (ov.dupes || 0);
  const inb = st.inbox_wait || 0;
  const tabs = [
    [10, "music", "Müzikler", attn ? `<span class="badge">${attn}</span>` : ""],
    [20, "lists", "Listeler", ""],
    [30, "inbox", "Gelen", inb ? `<span class="badge">${inb}</span>` : ""],
    [90, "tools", "Araçlar", ""],
    ...DJD.tabs.map((t) => [t.order || 50, t.key, t.label, t.badge ? t.badge() : ""]),
  ].sort((a, b) => a[0] - b[0]);
  const tabsHtml = ready ? tabs.map(([_o, k, l, b]) => `<button class="tab ${S.tab === k ? "on" : ""}" data-tab="${k}"><span class="tl">${l}</span>${b}</button>`).join("")
    + `<button class="tab more" id="tabmore" title="Diğer sekmeler" aria-label="Diğer sekmeler" hidden>⋯</button>` : "";
  let html = "";
  if (st.active) {
    if (!st.has_engine) html += pill("", "Engine kütüphanesi yok", "Bu SSD'de Engine kütüphanesi yok", "off");
    else html += st.engine_open ? pill("lock", "Engine DJ açık · kilitli", "Engine DJ açıkken listeler ve taşımalar kilitli")
      : pill("", "Engine", "Engine DJ kapalı: program Engine kütüphanesine doğrudan yazabilir");
    if (st.active.has_serato) html += st.serato_open ? pill("lock", "Serato açık", "Serato açık: Serato dosyalarına o kapanınca yazılır") : pill("", "Serato", "Serato kapalı");
    const u = st.undo;
    html += `<button class="btn undo" id="undo" ${u ? "" : "disabled"} title="${esc(u ? "Geri al: " + u.title + "  (Ctrl+Z)" : "Geri alınacak işlem yok")}"><span class="ic" aria-hidden="true">↶</span><span class="lbl">Geri al</span>${u ? `<span class="t">${esc(u.title)}</span>` : ""}</button>`;
  }
  html += `<button class="icon-btn" id="settings" title="Ayarlar" aria-label="Ayarlar">⚙</button>`;
  const key = tabsHtml + "\u0000" + html;
  if (key === S._topKey) return;                         // değişmediyse dokunma (yoklama her 4 sn'de çağırır)
  S._topKey = key;
  $("#tabs").innerHTML = tabsHtml;
  $("#status").innerHTML = html;
  fitTop();
}

// Çok dar pencerede (#view[data-w=xs]) kenar listesi çekmeceye döner; bu düğme onu açar (CSS'te yalnız o zaman görünür).
const SIDEBTN = `<button class="icon-btn sidebtn" data-side title="Menü" aria-label="Menüyü aç">☰</button>`;

async function goTab(k) {
  S.tab = k; localStorage.setItem("djd.tab", k);
  await refresh(true);
}

document.addEventListener("click", async (e) => {
  const inf = e.target.closest("#view [data-info]");
  if (inf && !e.target.closest("button, input, select, a, .folder-chip")) { openTrack(+inf.dataset.info); return; }
  if (e.target.closest("#tabmore")) {
    menu(e, $$("#tabs .tab.ovf").map((t) => ({ label: (t.querySelector(".tl") || t).textContent, fn: () => goTab(t.dataset.tab) })));
    return;
  }
  const t = e.target.closest("[data-tab]");
  if (t) { await goTab(t.dataset.tab); return; }
  if (e.target.closest("#undo")) { await undo(); return; }
  if (e.target.closest("#settings")) { settingsDialog(); return; }
  const sb = e.target.closest("[data-side]");
  const sp = e.target.closest("#view .split:not(.lists)");
  if (sb && sp) { sp.classList.toggle("side-open"); return; }
  if (sp && sp.classList.contains("side-open") && (e.target === sp || e.target.closest(".side .nav-item, .side .attn"))) sp.classList.remove("side-open");
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
  // açık menüde ↑ / ↓ öğeler arasında gezer (Enter seçer)
  const mo = $("#menu .menu");
  if (mo && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
    const bs = $$("button[data-i]", mo).filter((b) => !b.hidden);
    if (bs.length) {
      const i = bs.indexOf(document.activeElement), dn = e.key === "ArrowDown";
      const n = i < 0 ? (dn ? 0 : bs.length - 1) : (i + (dn ? 1 : -1) + bs.length) % bs.length;
      e.preventDefault();
      bs[n].focus({ preventScroll: true });
      bs[n].scrollIntoView({ block: "nearest" });
    }
    return;
  }
  // Esc yalnızca en üstteki katmanı kapatır: menü → pencere → ayrıntı paneli → çekmeceler
  if (e.key === "Escape" && !e.defaultPrevented) {
    if ($("#menu").innerHTML) { const a = mo && mo._anchor; closeMenu(); if (a && a.isConnected && a.focus) a.focus({ preventScroll: true }); return; }
    if ($("#modal").innerHTML) { closeModal(); return; }
    if ($("#drawer").innerHTML) { closeDrawer(); return; }
    const so = $("#view .split.side-open");
    if (so) { so.classList.remove("side-open"); return; }
    const sp = $("#view .split.lists");
    if (sp && (S.pickOpen || S.treeOpen)) { S.pickOpen = S.treeOpen = false; sp.classList.remove("pick-open", "tree-open"); }
  }
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
    else if (S.tab === "tools") await loadTools();
    else if (DJD.tabs.some((t) => t.key === S.tab)) await DJD.tabs.find((t) => t.key === S.tab).load();
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
function ssdPickerHtml(title, sub, opts = {}) {
  return `<div class="setup"><h1>${esc(title)}</h1>${sub ? `<p class="muted">${sub}</p>` : ""}
    <div id="drives">Sürücüler aranıyor…</div>
    <div class="pick-actions"><button class="btn" id="browse">📁 Klasör seç</button>
      ${opts.retry ? `<button class="btn ghost" id="retry">Yeniden dene</button>` : ""}
      ${opts.back ? `<button class="btn ghost" id="pback">Vazgeç</button>` : ""}</div>
    <p class="muted small">SSD'n listede yoksa tak; birkaç saniye içinde burada görünür. Müziklerin bilgisayarda bir klasördeyse <b>Klasör seç</b>.</p></div>`;
}

function renderPicker(v, title, sub, opts = {}) {
  v.innerHTML = ssdPickerHtml(title, sub, opts);
  drivesInto($("#drives"), opts.relocateId || null);
  $("#browse").onclick = () => browseDialog(opts.relocateId || null);
  if (opts.retry) $("#retry").onclick = () => refresh(true);
  if (opts.back) $("#pback").onclick = () => refresh(true);
}

async function renderNoLib(v) {
  renderPicker(v, "Merhaba 👋", "Müziklerinin durduğu SSD'yi seç. Program önce yalnızca okur; hiçbir şeyi sen onaylamadan taşımaz.");
}

async function renderMissing(v) {
  const r = S.st.missing_root;
  renderPicker(v, "SSD takılı değil", `“${esc(r.name)}” (${esc(r.root)}) bulunamadı. SSD'yi tak; başka bir harfle takıldıysa aşağıdan seç.`,
    { retry: true, relocateId: r.id });
}

function renderOtherSsd() {
  renderPicker($("#view"), "SSD seç", "Hangi SSD ile çalışmak istiyorsun?", { back: true });
}

const hasMarks = (d) => !!(d.serato || d.engine || d.djd);

async function drivesInto(el, relocateId) {
  let last = "";
  const draw = async () => {
    let ds = [];
    try { ds = await api("/api/drives"); } catch (e) { el.textContent = e.message; return; }
    // sistem diski ve ağ sürücüleri burada gösterilmez (yanlışlıkla seçilmesin); onlar "Klasör seç"te
    ds = ds.filter((d) => d.drive && !d.system && !d.net);
    ds.sort((a, b) => (hasMarks(b) - hasMarks(a)) || a.label.localeCompare(b.label, "tr"));
    const cur = S.st && S.st.active ? S.st.active.root : "";
    const key = JSON.stringify(ds.map((d) => [d.path, d.label, d.serato, d.engine, d.djd]).concat([cur]));
    if (key === last) return;
    last = key;
    el.innerHTML = ds.map((d) => `<div class="drive" data-root="${esc(d.path)}" data-marks="${hasMarks(d) ? 1 : 0}"><span class="ic">💽</span><div class="dinfo"><b>${esc(d.label)}</b><div class="muted small">${esc(d.path)}
      ${d.serato ? ' · <span class="tag blue">Serato</span>' : ""}${d.engine ? ' <span class="tag blue">Engine</span>' : ""}${d.djd ? ' <span class="tag ok">DJ Doktor</span>' : ""}${!hasMarks(d) ? ' · <span class="tag">müzik kütüphanesi görünmüyor</span>' : ""}${cur && cur === d.path ? ' <span class="tag ok">şu an seçili</span>' : ""}</div></div>
      <button class="btn primary">Bu SSD</button></div>`).join("")
      || `<div class="empty-drives">Takılı bir SSD bulunamadı. SSD'ni tak; burada kendiliğinden görünür.</div>`;
  };
  await draw();
  const timer = setInterval(() => {
    if (!document.body.contains(el)) { clearInterval(timer); return; }
    if (!$("#modal").innerHTML && !S.busy) draw();
  }, 3000);
  el.onclick = (e) => {
    const d = e.target.closest(".drive");
    if (!d) return;
    if (d.dataset.marks === "1") chooseRoot(d.dataset.root, relocateId);
    else wrongDriveDialog(d.dataset.root, relocateId);
  };
}

// Serato / Engine izi olmayan sürücü ya da klasör: yanlış seçim olabilir
function wrongDriveDialog(root, relocateId, fromBrowse) {
  const m = modal(`<div class="dh">Burada müzik kütüphanesi görünmüyor</div><div class="db">
    <p><b>${esc(root)}</b> içinde Serato ya da Engine kütüphanesi yok. Yanlış ${fromBrowse ? "klasör" : "sürücü"} olabilir.</p>
    <p class="muted small">Müziklerin bunun içinde bir klasördeyse o klasörü seç. Yine de tararsan tarama istediğin an ✕ ile durdurulur ve seçim geri alınır.</p></div>
    <div class="df"><button class="btn" data-x="no">Vazgeç</button><button class="btn" data-x="pick">📁 Klasör seç</button><button class="btn primary" data-x="yes">Yine de tara</button></div>`);
  m.el.addEventListener("click", (e) => {
    const b = e.target.closest("[data-x]");
    if (!b) return;
    if (b.dataset.x === "no") m.close();
    else if (b.dataset.x === "pick") browseDialog(relocateId, root);
    else { m.close(); chooseRoot(root, relocateId); }
  });
}

async function chooseRoot(root, relocateId) {
  try {
    await task("/api/library/add", { root, relocate: relocateId || undefined });
  } catch (e) {
    if (e.code === "system_drive") { browseDialog(relocateId, root); return; }
    closeModal();
    await refresh(true);
    return;
  }
  closeModal();
  await refresh(true);
}

// onPick verilirse genel klasör seçici olur (ör. Gelen klasörü): seçilen yol onPick'e gider
async function browseDialog(relocateId, path = "", onPick = null) {
  let d;
  try { d = await api("/api/browse?path=" + encodeURIComponent(path || "")); } catch (e) { toast(e.message, "err"); return; }
  const marks = d.path ? `${d.serato ? '<span class="tag blue">Serato</span>' : ""}${d.engine ? '<span class="tag blue">Engine</span>' : ""}${d.djd ? '<span class="tag ok">DJ Doktor</span>' : ""}` : "";
  const m = modal(`<div class="dh">Klasör seç</div><div class="db"><div class="muted small wrap-any">${esc(d.path || "Konumlar")} ${marks}</div>
    ${d.system ? '<div class="muted small" style="margin-top:6px">Bu, bilgisayarın sistem diski: tamamı seçilemez. İçinden müziklerinin olduğu klasörü aç.</div>' : ""}
    ${d.nested && d.nested.length ? `<div class="hint" style="margin:8px 0 0"><span class="ic">⚠</span><div>Bu sürücüde Engine kütüphanesi bir <b>alt klasörde</b> kalmış: <b>${esc(d.nested[0])}</b>. Engine DJ ve Prime 4 onu görmez. Doğrusu: o klasörün içindekiler sürücünün kökünde olmalı — program bunu <b>Araçlar → Sürücüye aktar</b> ile doğru yapar.</div></div>` : ""}
    <div style="margin-top:8px">${d.parent !== null && d.path ? `<div class="nav-item" data-p="${esc(d.parent)}"><span class="tic">⬆</span><span class="name">Üst klasör</span></div>` : ""}
    ${d.dirs.map((x) => `<div class="nav-item" data-p="${esc(x.path)}" title="${esc(x.path)}"><span class="tic">📁</span><span class="name">${esc(x.label)}</span></div>`).join("")}</div></div>
    <div class="df"><button class="btn" data-x="no">Vazgeç</button>${d.path && !d.system ? `<button class="btn primary" data-x="yes">Bu klasör</button>` : ""}</div>`, "wide");
  m.el.addEventListener("click", (e) => {
    const it = e.target.closest("[data-p]");
    if (it) { browseDialog(relocateId, it.dataset.p, onPick); return; }
    const b = e.target.closest("[data-x]");
    if (!b) return;
    if (b.dataset.x !== "yes") { m.close(); return; }
    if (onPick) { m.close(); onPick(d.path); return; }
    if (d.serato || d.engine || d.djd) chooseRoot(d.path, relocateId);
    else wrongDriveDialog(d.path, relocateId, true);
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
  } catch (e) {
    if (e.code === "cancelled") { S.setupData = null; await refresh(true); return; }
    v.innerHTML = `<div class="setup"><h1>Bir sorun oluştu</h1><p>${esc(e.message)}</p>
      <div class="pick-actions"><button class="btn primary" id="sretry">Tekrar dene</button><button class="btn" id="sother">Başka SSD seç</button></div></div>`;
    $("#sretry").onclick = () => refresh(true);
    $("#sother").onclick = () => renderOtherSsd();
    return;
  }
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
  const prevSc = $("#view > .setup");
  const keepTop = prevSc ? prevSc.scrollTop : 0;
  $("#view").innerHTML = `<div class="setup">
    <h1>Düzeni kuralım</h1>
    <p class="muted lead">Her şarkının <b>tek bir evi</b> olacak: <b>${esc(su.root)}/&lt;Tür&gt;</b>. Program klasörlerine, Serato crate'lerine ve Engine listelerine bakıp aşağıdaki öneriyi yaptı. İstediğini değiştir, sonra <b>Düzeni kur</b>. Hiçbir dosya silinmez; tek tıkla geri alınır. Engine ve Serato listelerin yeni yerleri otomatik gösterir.</p>
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
      <div class="gchips">${d.genres.map((g) => { const off = su.engine_off.includes(g.name); return `<span class="gchip gfill" style="${gStyle(g.color)}${off ? ";opacity:.75" : ""}"><span data-gren="${esc(g.name)}" style="cursor:pointer" title="Adını değiştir: ${esc(g.folder)}">${esc(g.folder)}</span><span class="n">${fmtN(g.count)}</span><button class="x" data-geng="${esc(g.name)}" title="${off ? "Engine'e eklenmeyecek — tıkla: ekle" : "Engine'e eklenecek — tıkla: ekleme"}" style="width:auto;padding:0 7px;${off ? "text-decoration:line-through" : ""}">Engine</button><button class="x" data-gdel="${esc(g.name)}" title="Kaldır">✕</button></span>`; }).join("")}
      <button class="btn sm" id="gadd">+ Tür ekle</button></div>
      <label class="field" style="max-width:22rem;margin-top:16px"><span>Ana müzik klasörünün adı (SSD'de)</span><input id="sroot" value="${esc(su.root)}"></label>
    </div>
    <div class="card" style="padding:0">
      <div class="sfh"><h3 style="margin:0">Klasörler</h3><span class="muted small">Şarkıların şu an durduğu klasörler ve nereye gidecekleri</span>
        <input class="search" id="sfilt" placeholder="Klasör ara…" value="${esc(S.setupFilter)}"></div>
      <table class="t" id="stab"><colgroup><col data-flex="1" data-min="8em" data-w="16em"><col data-w="4.6em"><col data-w="15em" data-min="9em"><col data-w="22%" data-min="8em" data-pri="1"></colgroup>
      <thead><tr><th>Klasör</th><th class="nowrap">Şarkı</th><th>Nereye</th><th>Neden</th></tr></thead><tbody>
      ${folders.map((f) => { const a = d.assign[f.rel] || "spread"; const ch = su.overrides[f.rel] !== undefined; return `<tr class="${ch ? "changed" : ""}"><td class="wrap-any">${esc(f.disp)}</td><td class="c-num">${fmtN(f.direct)}</td>
        <td><select class="assign ${a.startsWith("g:") ? "g" : ""}" data-rel="${esc(f.rel)}">${optHtml(a)}</select></td><td class="muted small wrap-any">${esc(f.reason || (ch ? "senin seçimin" : "üst klasörden"))}</td></tr>`; }).join("")}
      </tbody></table>
    </div>
    <div class="card"><h3>Örnek taşımalar</h3><div class="small wrap-any">${(d.sample || []).slice(0, 8).map((s) => `<div><span class="muted">${esc(s.from)}</span> → <b>${esc(s.to)}</b></div>`).join("") || '<span class="muted">Taşınacak şarkı yok.</span>'}</div></div>
    <div class="sfoot">
      <button class="btn primary big" id="sapply">Düzeni kur</button>
      <button class="btn ghost" id="sreset">Öneriye dön</button>
      <span class="muted small">Engine DJ ve Serato kapalı olmalı. Taşıma aynı SSD içinde olduğu için birkaç dakikada biter.</span>
    </div></div>`;
  if (keepTop) $("#view > .setup").scrollTop = keepTop;
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
      setupTimer = setTimeout(() => { renderSetup(); const f = $("#sfilt"); f.focus({ preventScroll: true }); f.setSelectionRange(f.value.length, f.value.length); }, 200);
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
    <div class="legend">
      <span>${dotHtml("ready")} Hazır<span class="lx"> (Engine'de, analiz edildi)</span></span><span>${dotHtml("pending")} Analiz bekliyor</span>
      <span>${dotHtml("none")} Engine'de değil</span><span>${dotHtml("problem")} Sorun</span></div></aside>`;
  let main;
  if (S.view === "dupes") main = dupesHtml();
  else main = tracksHtml();
  const prev = $("#mmain .body");
  const keep = prev && S._lastView === S.view ? prev.scrollTop : 0;
  const sideScroll = $(".side .scroll") ? $(".side .scroll").scrollTop : 0;
  v.innerHTML = `<div class="split">${side}<section class="main" id="mmain">${main}</section></div>`;
  S._lastView = S.view;
  if ($(".side .scroll")) $(".side .scroll").scrollTop = sideScroll;
  if (S.view !== "dupes") drawTracks();
  vtRestore($("#mmain .body"), keep);                   // tablo çizildikten sonra (yoksa kaydırma yeri kaybolur)
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
  if (S._fr && S._fr.rows === S.rows && S._fr.q === S.q) return S._fr.out;
  const out = S.rows.filter((r) => { const s = r.search || fold(r.title + " " + r.artist + " " + r.folder); return q.every((w) => s.includes(w)); });
  S._fr = { rows: S.rows, q: S.q, out };
  return out;
}

// Satır HTML'i: sanal tablo yalnızca ekranda görünen satırları çizer
function trackRowHtml(r) {
  const isG = S.view.startsWith("g:");
  const g = r.gid ? genreById(r.gid) : null;
  let extra = "";
  if (S.view === "unsorted") {
    if (r.copy_of && r.keep_tags) extra = `<button class="btn sm shr" data-dropcopy="${esc(r.group)}" title="Bu dosyanın aynısı ${esc(r.copy_of)} klasöründe var. Bu kopyadaki not / cue / ton bilgisi daha zengin: bu dosya asıl yere geçer, eski dosya karantinaya taşınır. Listeler değişmez."><span class="ell">⧉ ${esc(r.copy_of)} içinde var · birleştir</span></button>`;
    else if (r.copy_of) extra = `<button class="btn sm shr" data-dropcopy="${esc(r.group)}" title="Bu dosyanın aynısı ${esc(r.copy_of)} klasöründe var. Bu kopya karantinaya taşınır; listeler asıl dosyayı gösterir."><span class="ell">⧉ ${esc(r.copy_of)} içinde var · kaldır</span></button>`;
    else if (r.sugg) extra = `<button class="gbtn shr ${r.sugg_new ? "outline gtx" : "gfill"}" style="${gStyle(COLORS[r.sugg] || (genreByName(r.sugg) || {}).color || "#64748b")}" data-sugg="${r.id}" title="${esc(r.sugg)}${r.why ? " · " + esc(r.why) : ""}${r.sugg_new ? " (yeni tür oluşturulur)" : ""}"><span class="ell">→ ${esc(r.sugg)}</span></button>`;
    extra += `<button class="btn sm" data-pickg="${r.id}">Tür seç ▾</button>`;
  } else if (S.view === "problems") {
    if (r.bad) extra = `<span class="tag bad shr">bozuk / yarım</span><button class="btn sm shr" data-quar="${r.id}" title="Karantinaya al"><span class="ell">Karantinaya al</span></button>`;
    else if (r.fmt) extra = `<span class="tag warn shr">Prime 4 çalmaz</span>`;
    else if (r.es === "broken") extra = `<span class="tag warn shr" title="Engine yolu bozuk · otomatik onarılacak">Engine yolu bozuk · otomatik onarılacak</span>`;
  } else if (r.dup && r.dupk !== "song") {
    extra = `<span class="tag warn shr" title="Bu şarkının diskte başka kopyası var">⧉ ${r.dup} kopya</span>`;
  }
  const on = S.sel.has(r.id);
  // dar pencerede gizlenen sütunların bilgisi ikinci satıra iner (.vf, bkz. sütun modeli)
  const fold = `${r.bpm ? `<span class="vf" data-c="4"> · ${r.bpm} BPM</span>` : ""}${r.key ? `<span class="vf" data-c="5"> · ${esc(r.key)}</span>` : ""}${r.dur ? `<span class="vf" data-c="6"> · ${fmtDur(r.dur)}</span>` : ""}${r.folder ? `<span class="vf" data-c="7"> · ${esc(isG || !g ? r.folder : g.name)}</span>` : ""}`;
  return `<tr data-id="${r.id}" draggable="true" class="${on ? "sel" : ""}">
    <td class="c-chk"><input type="checkbox" ${on ? "checked" : ""} aria-label="Seç"></td>
    <td class="c-dot">${dotHtml(r.dot, dotWhy(r))}</td>
    <td class="c-song" data-info="${r.id}" title="${esc(r.title)}${r.artist ? " · " + esc(r.artist) : ""} — ayrıntılar"><div class="ttl">${esc(r.title)}</div><div class="art">${esc(r.artist || "—")}${r.note ? ` · <span class="nt">${esc(r.note)}</span>` : ""}${fold}</div></td>
    <td class="c-num">${r.bpm || ""}</td><td class="c-num">${esc(r.key)}</td><td class="c-num">${fmtDur(r.dur)}</td>
    <td class="c-place"><div class="place">${!isG && g ? `<span class="tag gtx" style="${gStyle(g.color)}" title="${esc(g.name)}">${esc(g.name)}</span>` : ""}${r.folder ? `<span class="folder-chip" data-folder="${esc(r.rel.split("/").slice(0, -1).join("/"))}" title="${esc(r.rel)}">📁 ${esc(r.folder)}</span>` : ""}</div></td>
    <td class="c-act"><div class="cacts">${extra}<button class="play" data-play="${r.id}" title="Dinle" aria-label="Dinle">▶</button></div></td></tr>`;
}

// Şarkı tablosu sütunları (sütun modeli): Şarkı en az 11em; yer azalınca önce Süre/Ton/BPM/Yer gizlenir ve
// bilgileri şarkının ikinci satırına iner. Tür görünümünde alt klasör daha önemsizdir.
function trackCols() {
  const un = S.view === "unsorted", pr = S.view === "problems", isG = S.view.startsWith("g:");
  const dup = !un && !pr && S.rows.some((r) => r.dup && r.dupk !== "song");
  const act = un ? ["21em", "11em"] : pr ? ["17em", "10.5em"] : dup ? ["9em", "6.5em"] : ["3em", "3em"];
  const p = isG ? [3, 2, 1, 0.5] : [3, 2, 1, 4];   // BPM, Ton, Süre, Yer
  // bu görünümde tamamen boş olan BPM / Ton / Yer sütunu yer kaplamaz (ör. tür klasöründe alt klasör yoksa)
  const off = (f) => (S.rows.length && !S.rows.some(f) ? " data-off" : "");
  const g = (r) => (isG ? r.folder : r.folder || r.gid);
  return `<colgroup><col data-w="34px"><col data-w="28px"><col data-flex="3" data-min="9em" data-w="20em">`
    + `<col data-w="3.9em" data-pri="${p[0]}"${off((r) => r.bpm)}><col data-w="3.9em" data-pri="${p[1]}"${off((r) => r.key)}><col data-w="4.2em" data-pri="${p[2]}">`
    + `<col data-w="${isG ? "11em" : un ? "15em" : "13em"}" data-min="7.5em" data-max="26em" data-flex=".6" data-pri="${p[3]}"${off(g)}>`
    + `<col data-w="${act[0]}" data-min="${act[1]}"></colgroup>`;
}

function tracksHtml() {
  const [title, sub] = viewTitle();
  const isG = S.view.startsWith("g:");
  const rows = filteredRows();
  const ov = S.ov;
  let hint = "";
  if (ov.maint && ov.maint.pending && (isG || S.view === "all")) {
    hint = `<details class="hint" data-hk="analysis" ${hintOpen("analysis") ? "open" : ""}><summary><span class="ic">⏳</span><div><b>${fmtN(ov.maint.pending)} şarkı analiz bekliyor.</b> <span class="more">Nasıl?</span></div></summary>
      <div class="hb">Engine DJ'yi aç, sol tarafta SSD'nin altındaki <b>“Analiz bekleyenler”</b> listesini seç
      <div class="steps"><span>Ctrl+A (Mac: ⌘A)</span><i>→</i><span>sağ tık</span><i>→</i><span>Analyze / Re-analyze tracks</span></div>Bitince burada yeşil görünür, listeden de kendiliğinden düşer.
      <div class="small muted" style="margin-top:6px">Klasör klasör gitmek istersen: “Analiz bekleyenler”in altında her tür ayrı liste (ör. <b>Halay</b>) olarak durur.</div></div></details>`;
  }
  // çalışma yeri bir klasörse Engine DJ / Prime 4 onu görmez: her müzik görünümünde kısa uyarı + düğme
  const loc = S.st.active && S.st.active.loc;
  const locHint = loc && loc.warn === "not_root" ? `<div class="hint warn"><span class="ic">💾</span><div><b>Bu kütüphane bir klasörde</b> — Engine DJ ve Prime 4 onu görmez.
    <button class="btn sm primary" id="gotarget">Sürücüye aktar</button></div></div>` : "";
  if (S.view === "problems" && ov.orphans) {
    // Engine'de kaydı olup dosyası diskte olmayan parçalar: dosya değil, bu yüzden tabloda satır olarak görünmezler
    hint = `<div class="hint"><span class="ic">🔗</span><div><b>${fmtN(ov.orphans)} Engine kaydının dosyası diskte yok</b> (taşınmış, adı değişmiş ya da silinmiş).
      <button class="btn sm primary" id="gomissing">Göster · bul ve bağla</button></div></div>`;
  }
  if (S.view === "unsorted" && rows.some((r) => r.sugg && !r.copy_of)) {
    const n = rows.filter((r) => r.sugg && !r.copy_of).length;
    hint = `<div class="hint blue"><span class="ic">💡</span><div>${fmtN(n)} şarkı için öneri var. Tek tek tıklayabilir ya da <button class="btn sm primary" id="applyall">önerilerin hepsini uygula</button> diyebilirsin.
      ${rows.some((r) => r.copy_of) ? ` Kopya olanları da <button class="btn sm" id="dropcopies">kopyaları kaldır (${rows.filter((r) => r.copy_of).length})</button> ile temizle.` : ""}</div></div>`;
  }
  const gActs = isG ? `<button class="icon-btn" id="grename" title="Adını değiştir">✎</button><button class="icon-btn" id="gmenu" title="Diğer">⋯</button>` : "";
  return `<div class="head">${SIDEBTN}<div class="ht"><h2><span class="ell" title="${esc(title)}">${esc(title)}</span>${gActs}</h2><div class="sub" title="${esc(sub)}">${esc(sub)}</div></div>
      <input class="search" id="msearch" placeholder="Ara: şarkı, sanatçı, klasör…" value="${esc(S.q)}"></div>
    <div class="body">${locHint}${hint}
    <table class="t v" id="ttab" ${rows.length ? "" : "hidden"}>${trackCols()}<thead><tr><th class="c-chk"><input type="checkbox" id="chkall" aria-label="Hepsini seç"></th><th></th><th>Şarkı <span class="muted" id="tcount"></span></th><th title="Dosyanın etiketinden (Serato / Mixed In Key / indirilen yer yazmış olabilir). Engine analiziyle ilgisi yok.">BPM</th><th title="Dosyanın etiketinden (Serato / Mixed In Key / indirilen yer yazmış olabilir). Engine analiziyle ilgisi yok.">Ton</th><th>Süre</th><th>${isG ? "Alt klasör" : "Yer"}</th><th></th></tr></thead><tbody></tbody></table>
    <div id="tempty" ${rows.length ? "hidden" : ""}>${emptyTracksHtml()}</div></div>
    <div id="bulkbar" class="foot" data-dock></div>`;
}

// Açılır ipucu kutuları (<details data-hk>): kullanıcının seçimi hatırlanır; kısa ekranda kapalı başlar.
function hintOpen(k) {
  let v = null;
  try { v = localStorage.getItem("djd.hk." + k); } catch (e) { v = null; }
  if (v != null) return v === "1";
  const vw = $("#view");
  return !vw || !vw.dataset.h || vw.dataset.h === "l";
}
document.addEventListener("toggle", (e) => {
  const d = e.target;
  if (d && d.matches && d.matches("details[data-hk]")) { try { localStorage.setItem("djd.hk." + d.dataset.hk, d.open ? "1" : "0"); } catch (er) { /* */ } }
}, true);

function emptyTracksHtml() {
  return `<div class="empty"><div class="big">${S.view === "unsorted" ? "🎉" : "♪"}</div>${S.view === "unsorted" ? "Hepsi yerli yerinde." : S.q ? "Aramaya uyan şarkı yok." : S.view === "problems" ? "Dosyalarda sorun yok." : "Bu türde henüz şarkı yok. Yeni şarkıları <b>Gelen</b> sekmesinden ekleyebilirsin."}</div>`;
}

// Tabloyu (yeniden) bağla: arama ya da seçim değişince yalnızca görünen satırlar çizilir
function drawTracks(resetScroll) {
  const t = $("#ttab");
  if (!t) return;
  const rows = filteredRows();
  t.hidden = !rows.length;
  const em = $("#tempty");
  if (em) { em.hidden = !!rows.length; if (!rows.length) em.innerHTML = emptyTracksHtml(); }
  const c = $("#tcount");
  if (c) c.textContent = S.q ? `(${fmtN(rows.length)} / ${fmtN(S.rows.length)})` : "";
  if (resetScroll && t.closest(".body")) t.closest(".body").scrollTop = 0;
  vtSet("ttab", rows, trackRowHtml);
  syncSel();
}

// Seçim değişti: tüm tabloyu çizmeden yalnızca görünen satırların işaretini ve alt çubuğu güncelle
function syncSel() {
  $$("#ttab tbody tr[data-id]").forEach((tr) => {
    const on = S.sel.has(+tr.dataset.id);
    tr.classList.toggle("sel", on);
    const c = tr.querySelector("input[type=checkbox]");
    if (c) c.checked = on;
  });
  const rows = filteredRows();
  const all = $("#chkall");
  if (all) all.checked = !!rows.length && S.sel.size >= rows.length && rows.every((r) => S.sel.has(r.id));
  const bb = $("#bulkbar");
  if (bb) { const h = S.sel.size ? bulkHtml() : ""; if (bb.innerHTML !== h) { bb.innerHTML = h; dockSync(); } }
}

function genreByName(n) { return ((S.ov && S.ov.genres) || []).find((g) => g.name === n); }

function bulkHtml() {
  return `<div class="bulk"><b>${fmtN(S.sel.size)} şarkı seçili</b>
    <button class="btn" id="bmove">Türe taşı ▾</button><button class="btn" id="blist">Listeye ekle ▾</button>
    ${S.view === "problems" ? `<button class="btn" id="bquar">Karantinaya al</button>` : ""}
    <button class="btn ghost" id="bclear">Seçimi kaldır</button><span class="muted small bh ell" title="Seçtiklerini soldaki bir türün üstüne sürükleyebilirsin.">İpucu: seçtiklerini soldaki bir türün üstüne sürükleyebilirsin.</span></div>`;
}

function dupesHtml() {
  const gs = S.dupes || [];
  const main = gs.filter((g) => g.kind !== "song");
  const sim = gs.filter((g) => g.kind === "song");
  const kindTxt = { exact: "Birebir aynı dosya", audio: "Aynı ses, farklı etiket", engine: "Engine'de iki kez görünüyor", song: "Aynı şarkı, farklı kayıt" };
  const card = (g) => `<div class="card dup" data-group="${esc(g.id)}"><div class="dh"><b>${esc(g.members[0].title || g.members[0].name)}</b><span class="muted wrap-any">${esc(g.members[0].artist || "")}</span>
      <span class="tag ${g.kind === "song" ? "" : "warn"}">${kindTxt[g.kind]}</span><button class="btn sm primary right" data-merge="${esc(g.id)}">${g.kind === "engine" ? "Düzelt" : g.kind === "song" ? "Seçileni tut" : "Birleştir"}</button></div>
    ${g.kind === "engine" ? `<div class="m keep"><div><div class="path">${esc(g.members[0].rel)}</div><div class="small muted">Engine'de ${g.tracks.length} kayıt var; Prime 4'te iki kez görünür. Düzelt: listeler korunur, fazla kayıt kalkar.</div></div></div>` :
    g.members.map((m) => `<label class="m ${m.keeper ? "keep" : ""}"><input type="radio" name="k-${esc(g.id)}" value="${m.id}" ${m.keeper ? "checked" : ""}>
      <div><div class="path">${m.genre ? `<span class="tag gtx" style="${gStyle(m.color)}">${esc(m.genre)}</span>` : ""}${esc(m.rel)}</div>
      <div class="small">${m.why.filter((w) => !(m.genre && w === m.genre + " klasöründe")).map((w) => `<span class="tag">${esc(w)}</span>`).join("")}${m.bitrate ? `<span class="tag">${m.bitrate} kbps</span>` : ""}</div></div>
      ${m.content ? '<span class="tag blue" title="Bu kopyanın etiketleri (not, ton, cue) daha dolu: dosya, tutulan kopyanın yerine geçer; diğeri karantinaya gider.">etiketleri korunur</span>' : ""}
      ${m.keeper ? '<span class="tag st ok">tutulacak</span>' : '<span class="tag st">karantinaya</span>'}<button class="play" data-play="${m.id}" title="Dinle">▶</button></label>`).join("")}
    ${g.missing && g.missing.length ? `<div class="small" style="padding:8px 16px;color:var(--warn-ink)">Dikkat: diğer kopyada ${g.missing.join(" ve ")} var, tutulacak kopyada yok.</div>` : ""}</div>`;
  return `<div class="head">${SIDEBTN}<div class="ht"><h2>Kopyalar</h2><div class="sub" title="Aynı şarkının birden fazla kopyası. Biri kalır (önerilen işaretli), diğerleri silinmez: SSD'deki karantina klasörüne taşınır.">Aynı şarkının birden fazla kopyası. Biri kalır (önerilen işaretli), diğerleri silinmez: SSD'deki karantina klasörüne taşınır. Engine ve Serato listeleri kalan kopyayı gösterir.</div></div>
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
      syncSel(); return;
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
      syncSel(); return;
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
    if (e.target.id === "gotarget") { if (window.DJDTargets) await window.DJDTargets.open(); return; }
    if (e.target.id === "gomissing") { if (window.DJDRename) await window.DJDRename.go("links"); return; }
    if (e.target.id === "dropcopies") {
      const groups = Array.from(new Set(S.rows.filter((r) => r.copy_of).map((r) => r.group)));
      await mergeGroups(groups.map((g) => ({ group: g })), groups.length + " kopya kaldırıldı");
      return;
    }
    if (e.target.id === "bmove") { pickGenreMenu(e, [...S.sel]); return; }
    if (e.target.id === "blist") { addToListMenu(e, [...S.sel]); return; }
    if (e.target.id === "bquar") { await quarantine([...S.sel]); return; }
    if (e.target.id === "bclear") { S.sel.clear(); syncSel(); return; }
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
      S._qt = setTimeout(() => drawTracks(true), 120);
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
  if (S.view !== "dupes") drawTracks();
  vtRestore(m.querySelector(".body"), st);
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
  const items = ls.map((l) => ({ label: l.title, depth: l.depth, title: l.path.join(" / "), icon: l.ev ? "📅" : "♪", fn: async () => {
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
// Alttaki çalar çubuğu (#player): hangi sayfaya gidilirse gidilsin çalan şarkı, ileri / geri sarma, konum çubuğu,
// türe taşıma. Çalan satırın ▶ düğmesi her yeniden çizimde de ❚❚ görünür (CSS ile, bkz. playMark).
let playing = null;
const PL = { fid: null, title: "", artist: "", gid: null, resume: null };
function playMark() {
  let st = document.getElementById("playmark");
  if (!st) { st = document.createElement("style"); st.id = "playmark"; document.head.appendChild(st); }
  const a = $("#audio");
  const f = PL.fid;
  st.textContent = f ? `tr[data-id="${f}"] > td { background: var(--accent-soft, rgba(47,111,237,.08)); }
    .play[data-play="${f}"], .play[data-dplay="${f}"] { color: var(--accent); border-color: var(--accent); }
    ${a && !a.paused ? `.play[data-play="${f}"], .play[data-dplay="${f}"] { font-size: 0 !important; }
    .play[data-play="${f}"]::after, .play[data-dplay="${f}"]::after { content: "❚❚"; font-size: 12px; }` : ""}` : "";
}
function rowMeta(btn, fid) {
  const row = btn && btn.closest ? btn.closest("tr, .hrow, .res, label, .pk, div[data-id]") : null;
  const t = row && row.querySelector(".ttl");
  const ar = row && row.querySelector(".art");
  return { title: t ? t.textContent.trim() : "", artist: ar ? ar.textContent.split("·")[0].trim().replace(/^—$/, "") : "" };
}
function playFid(fid, btn) {
  const a = $("#audio");
  if (PL.fid === fid) { if (a.paused) a.play().catch(() => { /* */ }); else a.pause(); return; }
  const m = rowMeta(btn, fid);
  PL.fid = fid; PL.title = m.title || "Şarkı"; PL.artist = m.artist || "";
  playing = fid;
  a.src = `/api/audio/${fid}?t=${encodeURIComponent(TOKEN)}`;
  a.play().catch(() => toast("Çalınamadı (tarayıcı bu biçimi desteklemiyor olabilir).", "err"));
  if (!m.title) api("/api/track/" + fid).then((d) => { if (PL.fid === fid && d && d.file) { PL.title = d.file.title || d.file.name || PL.title; PL.artist = d.file.artist || ""; playerDraw(); } }).catch(() => { /* */ });
  playerDraw();
}
function playerStop() {
  const a = $("#audio");
  a.pause(); a.removeAttribute("src"); try { a.load(); } catch (e) { /* */ }
  PL.fid = null; playing = null;
  playerDraw();
}
// Yazan bir iş başlamadan önce: Windows çalınan dosyayı kilitler (taşınamaz, "WinError 32"). Çaları bırak, iş
// bitince aynı yerden sürdür (dosya taşınsa da şarkının kimliği aynı kalır).
function playerRelease() {
  const a = $("#audio");
  if (!PL.fid || PL.resume) return;
  PL.resume = { fid: PL.fid, t: a.currentTime || 0, on: !a.paused };
  a.pause(); a.removeAttribute("src"); try { a.load(); } catch (e) { /* */ }
}
function playerResume() {
  const r = PL.resume;
  PL.resume = null;
  if (!r || PL.fid !== r.fid) return;
  const a = $("#audio");
  a.src = `/api/audio/${r.fid}?t=${encodeURIComponent(TOKEN)}`;
  const go = () => { try { a.currentTime = r.t; } catch (e) { /* */ } if (r.on) a.play().catch(() => { /* */ }); };
  if (a.readyState >= 1) go(); else a.addEventListener("loadedmetadata", go, { once: true });
}
function playerDraw() {
  const el = $("#player");
  if (!el) return;
  const a = $("#audio");
  if (!PL.fid) { el.hidden = true; el.innerHTML = ""; document.documentElement.style.setProperty("--player-h", "0px"); playMark(); return; }
  if (!el.firstElementChild) {
    el.innerHTML = `<button class="pl-b pl-pp" data-pl="pp" aria-label="Çal / durdur">▶</button>
      <button class="pl-b" data-pl="back" title="10 sn geri" aria-label="10 saniye geri">⏪</button>
      <button class="pl-b" data-pl="fwd" title="10 sn ileri" aria-label="10 saniye ileri">⏩</button>
      <div class="pl-meta minw0" data-pl="info" title="Ayrıntılar"><div class="pl-t ell"></div><div class="pl-a ell muted small"></div></div>
      <span class="pl-tm small muted">0:00</span><input type="range" class="pl-seek" min="0" max="1000" value="0" aria-label="Konum"><span class="pl-du small muted">0:00</span>
      <button class="btn sm" data-pl="genre" title="Bu şarkıyı bir türe taşı">Türe taşı ▾</button>
      <button class="pl-b" data-pl="close" title="Kapat" aria-label="Çaları kapat">✕</button>`;
    el.addEventListener("click", (e) => {
      const b = e.target.closest("[data-pl]");
      if (!b || !PL.fid) return;
      const k = b.dataset.pl;
      if (k === "pp") { if (a.paused) a.play().catch(() => { /* */ }); else a.pause(); }
      else if (k === "back") a.currentTime = Math.max(0, a.currentTime - 10);
      else if (k === "fwd") a.currentTime = Math.min((a.duration || 0) - 0.5, a.currentTime + 10);
      else if (k === "close") playerStop();
      else if (k === "genre") pickGenreMenu(e, [PL.fid]);
      else if (k === "info") openTrack(PL.fid);
    });
    const sk = el.querySelector(".pl-seek");
    sk.addEventListener("input", () => { if (a.duration) { el._seeking = true; el.querySelector(".pl-tm").textContent = fmtDur(sk.value / 1000 * a.duration); } });
    sk.addEventListener("change", () => { if (a.duration) a.currentTime = sk.value / 1000 * a.duration; el._seeking = false; });
  }
  el.hidden = false;
  el.querySelector(".pl-t").textContent = PL.title;
  el.querySelector(".pl-t").title = PL.title;
  el.querySelector(".pl-a").textContent = PL.artist || "—";
  el.querySelector(".pl-pp").textContent = a.paused ? "▶" : "❚❚";
  playerTime();
  document.documentElement.style.setProperty("--player-h", el.offsetHeight + "px");
  playMark();
}
function playerTime() {
  const el = $("#player"), a = $("#audio");
  if (!el || el.hidden || !el.firstElementChild || el._seeking) return;
  el.querySelector(".pl-tm").textContent = fmtDur(a.currentTime || 0);
  el.querySelector(".pl-du").textContent = a.duration ? fmtDur(a.duration) : "–:––";
  el.querySelector(".pl-seek").value = a.duration ? Math.round(a.currentTime / a.duration * 1000) : 0;
}
(function () {
  const a = document.getElementById("audio");
  if (!a) return;
  ["play", "pause", "ended", "loadedmetadata"].forEach((ev) => a.addEventListener(ev, () => { if (!PL.resume) playerDraw(); }));
  a.addEventListener("timeupdate", playerTime);
})();

// ---------------------------------------------------------------------------
// LİSTELER (Engine'in kendi listeleri; değişiklik anında kaydedilir)
// ---------------------------------------------------------------------------
// S.cur: Engine listesi (sayı) ya da salt okunur görünüm: "crate:<ad>" (Serato) / "folder:<yol>" (disk klasörü)
const isX = (id) => typeof id === "string";
function xUrl(id) {
  return id.startsWith("crate:") ? "/api/gozat/crate?name=" + encodeURIComponent(id.slice(6))
    : "/api/gozat/folder?rel=" + encodeURIComponent(id.slice(7));
}
async function loadLists() {
  S.lists = await api("/api/lists");
  if (!S.ov) { try { S.ov = await api("/api/overview"); } catch (e) { /* */ } }
  try { S.br = { crates: (await api("/api/gozat/crates")).crates, folders: (await api("/api/gozat/folders")).folders }; }
  catch (e) { S.br = S.br || { crates: [], folders: [] }; }
  if (S.cur && !isX(S.cur) && !S.lists.lists.some((l) => l.id === S.cur)) S.cur = null;
  try { S.items = S.cur ? await api(isX(S.cur) ? xUrl(S.cur) : "/api/list/" + S.cur) : null; } catch (e) { S.cur = null; S.items = null; }
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
  const all = S.lists.lists || [];
  const mine = [], auto = [];
  const walk = (pid, depth, out) => {
    for (const l of kids[pid] || []) {
      const has = (kids[l.id] || []).length > 0;
      const open = S.open[l.id] !== undefined ? S.open[l.id] : (l.kind !== "genres" && l.kind !== "analysis");
      out.push(`<div class="nav-item ${S.cur === l.id ? "on" : ""}" data-lid="${l.id}" style="padding-left:${8 + Math.min(depth, 6) * 14}px" title="${esc(l.path.join(" / "))}">
        <span class="tw" data-tw="${l.id}">${has ? (open ? "▾" : "▸") : ""}</span>
        <span class="name">${l.kind === "analysis" ? "⏳ " : l.ev ? "📅 " : ""}${esc(l.title)}</span>
        ${l.serato ? `<span class="ser" title="Serato'da da var${l.serato.dirty ? " (Serato kapanınca güncellenecek)" : ""}">S${l.serato.dirty ? "…" : ""}</span>` : ""}
        <span class="cnt">${l.n || ""}</span></div>`);
      if (has && open) walk(l.id, depth + 1, out);
    }
  };
  // kendi listelerin üstte; programın tuttukları (Analiz bekleyenler, Türler) ayrı ve kapalı bölümde
  for (const l of kids[0] || []) (l.managed ? auto : mine).push(l);
  const top = (arr) => { const out = []; arr.forEach((l) => { const k = kids[0]; kids[0] = [l]; walk(0, 0, out); kids[0] = k; }); return out.join(""); };
  const sec = (key, title, n, body, defOpen) => {
    const open = S.open["s:" + key] !== undefined ? S.open["s:" + key] : defOpen;
    return `<div class="lsec" data-sec="${key}"><span class="tw">${open ? "▾" : "▸"}</span>${title}<span class="cnt">${n}</span></div>${open ? `<div class="lsecb">${body || '<div class="muted small" style="padding:4px 12px">Yok.</div>'}</div>` : ""}`;
  };
  const br = S.br || { crates: [], folders: [] };
  // Serato crate'leri (%% alt crate)
  const crates = br.crates.map((c) => `<div class="nav-item ${S.cur === "crate:" + c.name ? "on" : ""}" data-xid="crate:${esc(c.name)}" style="padding-left:${8 + Math.min(c.parts.length - 1, 6) * 14}px" title="Serato crate: ${esc(c.parts.join(" / "))}">
      <span class="tw"></span><span class="name">${esc(c.parts[c.parts.length - 1])}</span>${c.linked ? '<span class="ser" title="Engine listesiyle eşli">E</span>' : ""}<span class="cnt">${c.n || ""}</span></div>`).join("");
  // disk klasörleri (ağaç; müziği olmayanlar soluk)
  const fk = {};
  br.folders.forEach((f) => { (fk[f.parent] = fk[f.parent] || []).push(f); });
  const fout = [];
  const fwalk = (parent, depth) => {
    for (const f of fk[parent] || []) {
      const has = (fk[f.rel] || []).length > 0;
      const open = !!S.open["f:" + f.rel];
      fout.push(`<div class="nav-item ${S.cur === "folder:" + f.rel ? "on" : ""} ${f.total ? "" : "dim"}" data-xid="folder:${esc(f.rel)}" style="padding-left:${8 + Math.min(depth, 8) * 14}px" title="${esc(f.rel)}${f.total ? ` · ${f.total} müzik` : " · müzik yok"}">
        <span class="tw" data-ftw="${esc(f.rel)}">${has ? (open ? "▾" : "▸") : ""}</span><span class="name">📁 ${esc(f.name)}</span><span class="cnt">${f.n ? f.n : ""}${f.total > f.n ? `<span class="muted"> / ${f.total}</span>` : ""}</span></div>`);
      if (has && open) fwalk(f.rel, depth + 1);
    }
  };
  fwalk("", 0);
  return sec("mine", "Engine listelerim", mine.length, top(mine), true)
    + sec("auto", "Programın listeleri (otomatik)", auto.length, top(auto), false)
    + (S.st.active.has_serato ? sec("serato", "Serato crate'leri", br.crates.length, crates, false) : "")
    + sec("folders", "Klasörler (SSD)", br.folders.filter((f) => !f.parent).length, fout.join(""), false);
}

function renderLists() {
  const t = S.lists;
  const v = $("#view");
  if (!t.db) {
    v.innerHTML = `<div class="setup"><h1>Engine kütüphanesi yok</h1><p class="muted">Bu SSD'de henüz Engine DJ kütüphanesi yok. Engine DJ'de SSD'ye bir kez parça aktarınca (ya da SSD'yi Prime 4'te bir kez kullanınca) listeler burada görünür.</p></div>`;
    return;
  }
  const ro = t.readonly;
  const lro = ro || (S.items && S.items.managed);
  // dar pencerede: ağaç ve ekleme paneli çekmece olur (CSS: #view[data-w] .split.lists); açık/kapalı S'de durur
  v.innerHTML = `<div class="split lists ${S.cur && isX(S.cur) ? "xview" : ""} ${S.treeOpen || !S.items ? "tree-open" : ""} ${S.pickOpen ? "pick-open" : ""} ${lro ? "ro" : ""}">
    <aside class="side"><div class="sideh">
      <button class="btn primary" id="newev" ${ro ? "disabled" : ""}>＋ Yeni etkinlik</button><button class="btn" id="newlist" ${ro ? "disabled" : ""}>＋ Liste</button>
      <button class="icon-btn" id="lmore" title="Diğer">⋯</button><button class="icon-btn tclose" id="treex" title="Kapat" aria-label="Listeleri kapat">✕</button></div>
      ${ro ? `<div class="hint" style="margin:10px 10px 0"><span class="ic">🔒</span><div>Engine DJ açık. Listeleri düzenlemek için Engine DJ'yi kapat (aynı listeleri ikisi birden değiştirmesin).</div></div>` : ""}
      <div class="scroll tree" id="tree">${treeHtml()}</div></aside>
    <section class="main" id="lmain">${listMainHtml()}</section>
    <aside class="picker" id="picker">${pickerHtml()}</aside></div>`;
  afterListMain();
  wireLists();
}

// Liste tablosu her boyda aynı: sabit düzen + sütun modeli + sanal çizim (kısa listede hepsi çizilir).
// Not sütunu otomatik listelerde yalnızca not varsa çıkar.
function listNoteCol(it) {
  if (it._nc == null) it._nc = !(S.lists.readonly || it.managed) || it.items.some((r) => r.note);
  return it._nc;
}

function listRowHtml(r, i) {
  const ro = S.lists.readonly || S.items.managed;
  const nc = listNoteCol(S.items);
  const fold = `${r.bpm ? `<span class="vf" data-c="4"> · ${r.bpm}</span>` : ""}${r.key ? `<span class="vf" data-c="5"> · ${esc(r.key)}</span>` : ""}${r.dur ? `<span class="vf" data-c="6"> · ${fmtDur(r.dur)}</span>` : ""}${nc && r.note ? `<span class="vf" data-c="7"> · <span class="nt">${esc(r.note)}</span></span>` : ""}`;
  return `<tr data-ref="${esc(r.ref)}" ${ro ? "" : 'draggable="true"'}>
      <td class="c-idx">${ro ? i + 1 : `<span class="grip" title="Sürükle">⋮⋮</span>`}</td><td class="c-dot">${dotHtml(r.dot, r.missing ? "Dosya bulunamadı" : undefined)}</td>
      <td class="c-song" ${r.fid ? `data-info="${r.fid}" title="${esc(r.title)}${r.artist ? " · " + esc(r.artist) : ""} — ayrıntılar"` : `title="${esc(r.title)}"`}><div class="ttl">${esc(r.title)}</div><div class="art">${esc(r.artist || "—")}${r.genre ? ` · <span class="gtx" style="${gStyle(r.color)}">${esc(r.genre)}</span>` : ""}${fold}</div></td>
      <td class="c-num">${r.bpm || ""}</td><td class="c-num">${esc(r.key)}</td><td class="c-num">${fmtDur(r.dur)}</td>
      ${nc ? `<td class="c-note">${ro ? `<span class="small nt" title="${esc(r.note)}">${esc(r.note)}</span>` : `<input class="note" data-note="${esc(r.ref)}" value="${esc(r.note)}" placeholder="not ekle" aria-label="Not">`}</td>` : ""}
      <td class="c-act"><div class="cacts">${r.fid ? `<button class="play" data-play="${r.fid}" aria-label="Dinle">▶</button>` : ""}${ro ? "" : `<button class="icon-btn" data-rm="${esc(r.ref)}" title="Listeden çıkar" aria-label="Listeden çıkar">✕</button>`}</div></td></tr>`;
}

function listMainHtml() {
  const it = S.items;
  const tb = `<button class="icon-btn treebtn" id="treebtn" title="Listeler" aria-label="Listeleri göster">☰</button>`;
  if (!it) return `<div class="empty" style="margin:auto"><div class="big">♪</div>Soldan bir liste seç ya da <b>Yeni etkinlik</b> oluştur.<div style="margin-top:10px"><button class="btn treebtn" id="treebtn2">☰ Listeleri göster</button></div><div class="small" style="margin-top:8px">Burada yaptığın her değişiklik anında Engine'e yazılır; Prime 4 aynı listeyi görür. Kaydet/gönder yok.</div></div>`;
  const l = S.lists.lists.find((x) => x.id === it.id) || {};
  const ro = S.lists.readonly || it.managed;
  const ev = it.ev || {};
  const pend = it.items.filter((r) => r.dot === "pending").length;
  const nc = listNoteCol(it);
  const off = (k) => (it.items.length && !it.items.some((r) => r[k]) ? " data-off" : "");   // bu listede hiç yoksa yer kaplamaz
  const cols = `<colgroup><col data-w="2.6em"><col data-w="2em"><col data-flex="1" data-min="10em" data-w="18em"><col data-w="3.9em" data-pri="2"${off("bpm")}><col data-w="3.9em" data-pri="3"${off("key")}><col data-w="4.2em" data-pri="4">`
    + `${nc ? `<col data-w="14em" data-min="7em" data-max="24em" data-flex="0.6" data-pri="5">` : ""}<col data-w="${ro ? "2.8em" : "5.2em"}"></colgroup>`;
  const subTxt = `${it.path.slice(0, -1).join(" / ") || "En üst"} · ${fmtN(it.items.length)} şarkı · ${fmtLong(it.dur)}${l.kids ? ` · ${l.kids} alt liste` : ""}${pend ? ` · ${pend} analiz bekliyor` : ""}`;
  return `<div class="head lhead">${tb}<div class="ht">
      ${ro ? `<h2><span class="ell" title="${esc(it.title)}">${esc(it.title)}</span></h2>` : `<input class="title-edit" id="ltitle" value="${esc(it.title)}" title="${esc(it.title)}" aria-label="Liste adı">`}
      <div class="sub" title="${esc(subTxt)}">${esc(it.path.slice(0, -1).join(" / ") || "En üst")} · ${fmtN(it.items.length)} şarkı · ${fmtLong(it.dur)}${l.kids ? ` · ${l.kids} alt liste` : ""}${pend ? ` · <span class="nt">${pend} analiz bekliyor</span>` : ""}</div>
      ${it.ev ? `<div class="evrow"><input type="date" class="search" id="evdate" value="${esc(ev.date || "")}" aria-label="Tarih"><input class="search" id="evvenue" placeholder="Yer / salon" value="${esc(ev.venue || "")}" aria-label="Yer"></div>` : ""}
    </div>
    <div class="hacts">
      ${isX(it.id) && it.kind === "crate" && !S.lists.readonly ? `<button class="btn sm" id="ximport" title="Bu crate'i Engine'e liste olarak al (Serato'da da eşli kalır)">Engine'e liste olarak al</button>` : ""}
      ${isX(it.id) ? "" : `${it.items.length || l.kids ? `<button class="btn sm" id="gigbtn" title="Etkinlikten önce: her şarkı yerinde, analiz edilmiş, Prime 4 çalar mı?">✓ Kontrol et</button><button class="btn sm" id="printbtn" title="Yazdırılabilir liste">🖨 Yazdır</button>` : ""}
      ${S.st.active.has_serato ? `<label class="switch ${l.serato ? "on" : ""}" id="sertog" title="Bu liste Serato'da da crate olarak dursun; değişiklikler iki yönlü eşitlenir"><i></i>Serato'da da</label>` : ""}
      <button class="icon-btn" id="lmenu" title="Diğer">⋯</button>${ro ? "" : `<button class="btn sm primary pickbtn" id="pickbtn">＋ Şarkı ekle</button>`}`}</div></div>
    <div class="body">${isX(it.id) ? `<div class="hint"><span class="ic">${it.kind === "crate" ? "🎧" : "📁"}</span><div>${it.kind === "crate" ? "Serato crate'i — burada yalnızca görüntülenir." : `SSD'deki klasör: <b>${esc(it.rel || "(kök)")}</b> — burada yalnızca görüntülenir. Şarkıyı türe taşımak için Müzikler'i kullan.`}${it.items.some((r) => r.missing) ? ` <span class="nt">${it.items.filter((r) => r.missing).length} şarkının dosyası bulunamadı.</span>` : ""}</div></div>` : it.managed ? `<div class="hint blue"><span class="ic">ℹ</span><div>${l.kind === "analysis" ? "Bu liste Engine'de analiz edilmemiş şarkıları gösterir. Engine DJ'de bu listeyi seç → tümünü seç → sağ tık → <b>Analyze / Re-analyze tracks</b>. Bitenler kendiliğinden düşer." : "Bu listeyi program tutar (tür klasörünün aynısı). Değiştirmek için kopyasını al."}</div></div>` : ""}
    ${it.items.length ? `<table class="t v" id="ltab">${cols}<thead><tr><th></th><th></th><th>Şarkı</th><th>BPM</th><th>Ton</th><th>Süre</th>${nc ? "<th>Not</th>" : ""}<th></th></tr></thead><tbody></tbody></table>`
      : isX(it.id) ? `<div class="empty"><div class="big">📁</div>${it.kind === "crate" ? "Bu crate boş." : "Bu klasörde doğrudan müzik yok. Alt klasörlerine soldan bakabilirsin."}</div>`
      : `<div class="empty"><div class="big">＋</div>Liste boş. Sağdan şarkı ara ve <b>＋</b> ile ekle ya da sürükleyip bırak.${ro ? "" : `<div style="margin-top:10px"><button class="btn primary pickbtn" id="pickbtn2">＋ Şarkı ekle</button></div>`}</div>`}</div>`;
}

// Liste alanı çizildikten sonra: tabloyu (sanal) doldur
function afterListMain() {
  if (S.items && S.items.items.length) vtSet("ltab", S.items.items, listRowHtml);
}

function pickerHtml() {
  const gs = (S.ov && S.ov.genres) || [];
  const sg = S.pick.gid === "sugg";
  return `<div class="ph"><div class="phr"><input class="search" id="psearch" placeholder="Şarkı ekle: ara…" value="${esc(S.pick.q)}" ${sg ? "disabled" : ""}><button class="icon-btn pclose" id="pickx" title="Kapat" aria-label="Ekleme panelini kapat">✕</button></div>
    <div class="chips"><span class="chip sugg ${sg ? "on" : ""}" data-pg="sugg" title="Bu bölüme uygun şarkılar (bölüm adı, tür, tempo)">✨ Öneri</span><span class="chip ${!S.pick.gid ? "on" : ""}" data-pg="">Hepsi</span>${gs.map((g) => `<span class="chip ${S.pick.gid === g.id ? "on" : ""}" data-pg="${g.id}">${esc(g.name)}</span>`).join("")}</div></div>
    <div class="scroll" id="pres">${pickResHtml()}</div>`;
}

function pickResHtml() {
  const inList = new Set(((S.items && S.items.items) || []).map((r) => r.fid));
  let head = "";
  if (S.pick.gid === "sugg") {
    if (!S.cur) return '<div class="empty small">Önce soldan bir bölüm / liste seç; ona uygun şarkılar burada çıkar.</div>';
    head = `<div class="muted small psh">${S.pick.sinfo ? `“${esc(S.pick.sinfo.title)}” için${S.pick.sinfo.genre ? ` · tür: <b>${esc(S.pick.sinfo.genre)}</b>` : ""}` : ""}</div>`;
  }
  return head + (S.pick.res.map((r) => `<div class="res ${inList.has(r.id) ? "in" : ""}" draggable="true" data-fid="${r.id}">${dotHtml(r.dot)}
      <div class="meta" data-info="${r.id}" title="${esc(r.title)}${r.artist ? " · " + esc(r.artist) : ""}"><div class="ttl">${esc(r.title)}</div><div class="art">${esc(r.artist || "—")}${r.genre ? ` · ${esc(r.genre)}` : ""}${r.bpm ? ` · ${r.bpm}` : ""}${r.key ? ` · ${esc(r.key)}` : ""}</div>${r.why ? `<div class="why">${esc(r.why)}</div>` : ""}</div>
      <button class="play" data-play="${r.id}">▶</button><button class="add" data-add="${r.id}" title="Listeye ekle">${inList.has(r.id) ? "✓" : "＋"}</button></div>`).join("") || `<div class="empty small">${S.pick.gid === "sugg" ? "Bu bölüm için öneri bulunamadı. Aramayı kullan." : "Sonuç yok."}</div>`);
}

async function pickSearch() {
  const q = S.pick.q, g = S.pick.gid;
  try {
    if (g === "sugg") {
      if (!S.cur) { S.pick.res = []; return; }
      const r = await api(`/api/suggest?list=${S.cur}`);
      S.pick.res = r.items; S.pick.sinfo = r;
    } else {
      S.pick.res = await api(`/api/search?q=${encodeURIComponent(q)}${g ? "&gid=" + g : ""}&limit=300`);
    }
    S.pick.loaded = true;
  } catch (e) { S.pick.res = []; }
}

async function selectList(id) {
  S.cur = id;
  S.treeOpen = false;
  const sp = $("#view .split.lists");
  if (sp) sp.classList.remove("tree-open");
  try { S.items = await api(isX(id) ? xUrl(id) : "/api/list/" + id); } catch (e) { toast(e.message, "err"); S.items = null; }
  if (S.pick.gid === "sugg") await pickSearch();
  $("#lmain").innerHTML = listMainHtml();
  afterListMain();
  $("#tree").innerHTML = treeHtml();
  $("#picker").innerHTML = pickerHtml();
  if (sp) { sp.classList.toggle("ro", !!(S.lists.readonly || (S.items && S.items.managed))); sp.classList.toggle("xview", isX(id)); }
}

// Dar pencerede ağaç / ekleme paneli çekmecesi
function listDrawer(which, on) {
  if (which === "pick") S.pickOpen = on; else S.treeOpen = on;
  const sp = $("#view .split.lists");
  if (sp) sp.classList.toggle(which === "pick" ? "pick-open" : "tree-open", on);
  if (on && which === "pick") { const f = $("#psearch"); if (f && !f.disabled) f.focus({ preventScroll: true }); }
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
  if (S.pick.gid === "sugg") await pickSearch();
  const sc = $("#lmain .body") ? $("#lmain .body").scrollTop : 0;
  renderLists();
  const b = $("#lmain .body"); if (b) b.scrollTop = sc;
  renderTop();
}

function wireLists() {
  const v = $("#view");
  v.onclick = async (e) => {
    if (e.target.id === "ximport" && S.items) {
      const name = S.items.id.slice(6);
      try { await task("/api/serato/import", { names: [name] }); toast("Engine'e liste olarak alındı.", "ok"); } catch (er) { return; }
      await refresh(true); return;
    }
    if (e.target.closest("#pickbtn, #pickbtn2")) { listDrawer("pick", !S.pickOpen); return; }
    if (e.target.closest("#pickx")) { listDrawer("pick", false); return; }
    if (e.target.closest("#treebtn, #treebtn2")) { listDrawer("tree", true); return; }
    if (e.target.closest("#treex") || e.target.matches(".split.lists.tree-open")) { listDrawer("tree", false); return; }
    const tw = e.target.closest("[data-tw]");
    if (tw && tw.textContent) {
      const id = +tw.dataset.tw;
      const l = S.lists.lists.find((x) => x.id === id);
      const cur = S.open[id] !== undefined ? S.open[id] : (l.kind !== "genres");
      S.open[id] = !cur; localStorage.setItem("djd.open", JSON.stringify(S.open));
      $("#tree").innerHTML = treeHtml(); return;
    }
    const sc = e.target.closest("[data-sec]");
    if (sc) { const k = "s:" + sc.dataset.sec; const def = sc.dataset.sec === "mine"; S.open[k] = !(S.open[k] !== undefined ? S.open[k] : def); localStorage.setItem("djd.open", JSON.stringify(S.open)); $("#tree").innerHTML = treeHtml(); return; }
    const ftw = e.target.closest("[data-ftw]");
    if (ftw && ftw.textContent) { const k = "f:" + ftw.dataset.ftw; S.open[k] = !S.open[k]; localStorage.setItem("djd.open", JSON.stringify(S.open)); $("#tree").innerHTML = treeHtml(); return; }
    const xi = e.target.closest("[data-xid]");
    if (xi) { await selectList(xi.dataset.xid); return; }
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
    if (pg) { S.pick.gid = pg.dataset.pg === "sugg" ? "sugg" : pg.dataset.pg ? +pg.dataset.pg : null; await pickSearch(); $("#picker").innerHTML = pickerHtml(); const f = $("#psearch"); if (f && !f.disabled) f.focus({ preventScroll: true }); return; }
    if (e.target.id === "gigbtn") { gigCheck(S.cur); return; }
    if (e.target.id === "printbtn") { window.open(`/api/print/${S.cur}?t=${encodeURIComponent(TOKEN)}`, "_blank"); return; }
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
    { label: "Etkinlik kontrolü", icon: "✓", fn: () => gigCheck(it.id) },
    "-",
    { label: "rekordbox XML olarak dışa aktar", icon: "⇪", fn: () => runExport("xml", "list:" + it.id) },
    { label: "M3U8 olarak dışa aktar", icon: "⇪", fn: () => runExport("m3u", "list:" + it.id) },
  ];
  if (!it.managed) {
    items.push({ label: "Alt liste ekle", icon: "＋", fn: async () => { const n = await promptBox("Alt liste", "Adı", "", "Oluştur"); if (n) { const r = await listOp("/api/list/create", { parent: it.id, title: n }); if (r) await selectList(r.id); } } });
    items.push({ label: "Başka klasöre taşı…", icon: "⇢", fn: () => {
      const folders = S.lists.lists.filter((x) => !x.managed && x.id !== it.id && !x.path.slice(0, -1).includes(it.title));
      menu({ target: $("#lmenu") }, [{ label: "En üste", icon: "⤒", fn: () => listOp("/api/list/move", { id: it.id, parent: 0 }) },
        ...folders.map((f) => ({ label: f.title, depth: f.depth, title: f.path.join(" / "), icon: "📁", fn: () => listOp("/api/list/move", { id: it.id, parent: f.id }) }))]);
    } });
    items.push("-", { label: "Listeyi sil", icon: "🗑", fn: async () => {
      const ok = await confirmBox("Listeyi sil", `“${it.title}”${l.kids ? ` ve ${l.kids} alt listesi` : ""} Engine'den silinecek. Şarkılar diskte ve koleksiyonda kalır. Geri alınabilir.`, "Sil", true);
      if (ok) { await listOp("/api/list/delete", { id: it.id }, "Liste silindi (Geri al ile geri gelir)."); }
    } });
  }
  const extra = DJD.listMenus.flatMap((fn) => { try { return fn(it, l, e) || []; } catch (er) { return []; } });
  if (extra.length) items.push("-", ...extra);
  menu(e, items);
}

function newEventDialog(baseId) {
  const t = S.lists;
  const temps = t.templates || [];
  const bases = t.lists.filter((l) => !l.managed && (l.kids || l.n));
  const today = localDay();
  const m = modal(`<div class="dh">Yeni etkinlik</div><div class="db">
    <label class="field"><span>Adı</span><input id="evt" placeholder="ör. Ahmet & Ayşe Düğün"></label>
    <div class="frow"><label class="field"><span>Tarih</span><input type="date" id="evd" value="${today}"></label>
    <label class="field grow"><span>Yer</span><input id="evv" placeholder="Salon / şehir"></label></div>
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
    ${cs.map((c) => `<label class="nav-item" style="padding-left:${8 + Math.min(c.parts.length - 1, 6) * 14}px" title="${esc(c.parts.join(" / "))}"><input type="checkbox" value="${esc(c.name)}" ${c.linked ? "disabled" : ""}><span class="name">${esc(c.parts[c.parts.length - 1])}</span><span class="cnt">${c.linked ? "bağlı" : c.count}</span></label>`).join("") || '<div class="muted">Crate yok.</div>'}</div>
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
  // önerilen tür (etiket / şarkı adı) en başta ve "öneri" olarak işaretli
  const gbtns = (path, sg) => [...gs.filter((g) => g.id === sg), ...gs.filter((g) => g.id !== sg)].map((g) => `<button class="gbtn ${g.id === sg ? "gfill sugg" : "gfill"}" style="${gStyle(g.color)}" title="${esc(g.name)}${g.id === sg ? " · öneri" : ""}" data-ing="${esc(path)}" data-g="${g.id}">${g.id === sg ? "→ " : ""}${esc(g.name)}</button>`).join("");
  const wait = ib.items.filter((i) => ["nogenre", "similar", "broken", "unsupported", "held"].includes(i.status) || (!ib.auto && ["new", "exists"].includes(i.status)));
  const going = ib.items.filter((i) => i.status === "downloading" || (ib.auto && i.status === "new"));
  const sepName = ib.inbox.includes("\\") ? "\\" : "/";
  const row = (i) => {
    let st = "", acts = "";
    const art = `${i.artist || ""}${i.genre ? ` · klasör: ${i.genre}` : ""} · ${i.name}`;
    const name = `<div class="ttl" title="${esc(i.title || i.name)}">${esc(i.title || i.name)}</div><div class="art" title="${esc(art)}">${esc(art)}</div>`;
    if (i.status === "nogenre") { st = `<span class="tag warn">türü belli değil</span>`; acts = gbtns(i.path, i.sugg); }
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
  const tail = (p) => { const a = String(p || "").split(/[\\/]+/).filter(Boolean); return a.length > 2 ? "…" + sepName + a.slice(-2).join(sepName) : String(p || ""); };
  $("#view").innerHTML = `<div class="main read"><div class="head"><div class="ht"><h2>Gelen</h2><div class="sub">Yeni şarkılar buradan girer. İndirirken türün klasörünü seç; gerisini program yapar.</div></div>
    <div class="ib-ctl"><label class="small muted">Gelen klasörü <select id="inloc" title="Yeni şarkıları nereye indiriyorsun?">
      <option value="pc" ${!ib.loc || ib.loc === "pc" ? "selected" : ""}>Bu bilgisayarda</option><option value="ssd" ${ib.loc === "ssd" ? "selected" : ""}>SSD'de</option>
      ${ib.loc === "custom" ? `<option value="custom" selected>Seçtiğim klasör</option>` : ""}<option value="pick">Başka klasör seç…</option></select></label>
    <label class="switch ${ib.auto ? "on" : ""}" id="autotog"><i></i>Otomatik ekle</label></div></div>
    <div class="body">
    <div class="flow">
      <div class="st" title="${esc(ib.inbox + sepName)}<Tür>"><b>1 · İndir</b><span title="${esc(ib.inbox)}">${esc(tail(ib.inbox))}${sepName}&lt;Tür&gt;</span></div>
      <div class="st" title="yarım mı? çalar mı? zaten var mı?"><b>2 · Kontrol</b><span>yarım mı? çalar mı? zaten var mı?</span></div>
      <div class="st" title="${esc(S.st.active.music_root || "Müzik")}/<Tür> (tek ev)"><b>3 · SSD</b><span>${esc(S.st.active.music_root || "Müzik")}/&lt;Tür&gt; (tek ev)</span></div>
      <div class="st" title="bir kez eklenir · “Analiz bekleyenler”"><b>4 · Engine</b><span>bir kez eklenir · “Analiz bekleyenler”</span></div>
      <div class="st" title="${esc(ib.archive)} (yedek, Engine'e girmez)"><b>5 · Arşiv</b><span title="${esc(ib.archive)}">${esc(tail(ib.archive))} (yedek, Engine'e girmez)</span></div>
    </div>
    <div class="ibbar"><button class="btn" id="openin">📂 Gelen klasörünü aç</button><button class="btn" id="openar">🗄 Arşivi aç</button>
      <span class="muted small">Tür klasörleri: ${gs.map((g) => esc(g.name)).join(", ")}</span></div>
    ${wait.length ? `<div class="card" style="padding:0"><div class="cardh"><h3>Senden karar bekleyenler (${wait.length})</h3></div>${wait.map(row).join("")}</div>` : ""}
    ${going.length ? `<div class="card" style="padding:0"><div class="cardh"><h3>Sırada</h3></div>${going.map((i) => `<div class="ib"><span class="tag blue">${i.status === "downloading" ? "iniyor…" : S.st.engine_open ? "Engine DJ kapanınca eklenecek" : "ekleniyor…"}</span><div class="meta"><div class="ttl" title="${esc(i.title || i.name)}">${esc(i.title || i.name)}</div><div class="art">${esc(i.genre || "")}</div></div></div>`).join("")}</div>` : ""}
    ${!wait.length && !going.length ? `<div class="empty" style="padding:28px"><div class="big">📥</div>Gelen kutusu boş. Yeni indirdiğin şarkıyı <b>${esc(ib.inbox)}${sepName}Halay</b> gibi bir tür klasörüne kaydet.</div>` : ""}
    ${dl.length ? `<div class="card" style="padding:0"><div class="cardh"><h3>İndirilenler klasöründe unutulanlar (${dl.length})</h3><div class="muted small">Türünü seçersen gelen kutusuna alınır.</div></div>
      ${dl.map((d) => `<div class="ib"><div class="meta"><div class="ttl" title="${esc(d.name)}">${esc(d.name)}</div></div><div class="acts">${gs.map((g) => `<button class="gbtn gfill" style="${gStyle(g.color)}" title="${esc(g.name)}" data-take="${esc(d.path)}" data-g="${g.id}">${esc(g.name)}</button>`).join("")}<button class="btn sm ghost" data-ign="${esc(d.path)}">Yoksay</button></div></div>`).join("")}</div>` : ""}
    ${ib.log.length ? `<div class="card" style="padding:0"><div class="cardh"><h3>Son işlenenler</h3></div>${ib.log.slice(0, 20).map((l) => `<div class="ib"><span class="tag ${l.status === "eklendi" ? "ok" : ""}">${esc({ eklendi: "eklendi", zaten_vardi: "zaten vardı", ayiklanan: "ayıklandı" }[l.status] || l.status)}</span><div class="meta"><div title="${esc(l.src)}">${esc(l.src)}</div><div class="art">${l.rel ? esc(l.rel) : ""} · ${new Date(l.ts * 1000).toLocaleString("tr-TR")}</div></div></div>`).join("")}</div>` : ""}
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
  v.onchange = async (e) => {
    if (e.target.id !== "inloc") return;
    if (e.target.value === "custom") return;
    if (e.target.value === "pick") {
      e.target.value = ib.loc || "pc";
      browseDialog(null, "", async (p) => {
        try { await api("/api/prefs", { inbox_loc: "custom", inbox_dir: p }); toast("Gelen klasörü: " + p, "ok"); }
        catch (er) { toast(er.message, "err"); }
        await refresh(true);
      });
      return;
    }
    try {
      await api("/api/prefs", { inbox_loc: e.target.value });
      toast(e.target.value === "ssd" ? "Gelen klasörü artık SSD'de: “DJ Gelen”." : "Gelen klasörü artık bu bilgisayarda.", "ok");
    } catch (er) { toast(er.message, "err"); }
    await refresh(true);
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
// ARAÇLAR — v1'in profesyonel özellikleri: sağlık, tam tablo, dışa aktarma, geçmiş ve yedekler.
// Basit kullanım (Müzikler / Listeler / Gelen) olduğu gibi kalır; buradakiler isteyene.
// ---------------------------------------------------------------------------
const TVIEWS = [["health", "🩺", "Sağlık"], ["table", "▤", "Kütüphane tablosu"], ["export", "⇪", "Dışa aktar"], ["history", "↶", "Geçmiş ve yedekler"]];
const fmtSize = (n) => { n = +n || 0; if (n < 1048576) return Math.round(n / 1024) + " KB"; if (n < 1073741824) return (n / 1048576).toFixed(1).replace(".", ",") + " MB"; return (n / 1073741824).toFixed(1).replace(".", ",") + " GB"; };
const fmtDate = (ts) => ts ? new Date(ts * 1000).toLocaleDateString("tr-TR") : "";
const ENG_TXT = { ready: "hazır", pending: "analiz bekliyor", broken: "yolu bozuk", edup: "iki kez", none: "—" };

function toolViewsAll() {
  return [...TVIEWS.map(([k, ic, t], i) => ({ key: k, icon: ic, title: t, order: (i + 1) * 10 })), ...DJD.toolViews]
    .sort((a, b) => (a.order || 0) - (b.order || 0));
}
const extView = () => DJD.toolViews.find((x) => x.key === S.tview);

async function loadTools() {
  S.tview = S.tview || localStorage.getItem("djd.tview") || "health";
  if (!toolViewsAll().some((x) => x.key === S.tview)) S.tview = "health";
  if (!S.ov) { try { S.ov = await api("/api/overview"); } catch (e) { /* */ } }
  const xv = extView(), tv = S.tview;
  let d;
  if (xv) d = xv.load ? await xv.load() : null;
  else if (tv === "health") d = await api("/api/health");
  else if (tv === "table") d = await api("/api/libtable");
  else if (tv === "export") d = await api("/api/lists").catch(() => ({ lists: [] }));
  else d = { journal: await api("/api/journal"), backups: await api("/api/backups") };
  if (S.tview !== tv || S.tab !== "tools") return;          // bu arada başka görünüme geçildi: eski veriyi çizme
  S.tdata = d; S.tdataFor = tv;
  renderTools();
}

function renderTools() {
  const v = $("#view");
  if (S.tdataFor !== S.tview) {                         // veri başka görünüme ait (hızlı geçiş): önce yükle
    if (!$("#tmain")) v.innerHTML = `<div class="empty">Yükleniyor…</div>`;
    loadTools().catch((e) => toast(e.message, "err"));
    return;
  }
  const prev = $("#tmain .body");
  const keep = prev && S._lastT === S.tview ? prev.scrollTop : 0;
  const side = `<aside class="side"><div class="scroll">
    ${toolViewsAll().map(({ key: k, icon: ic, title: t }) => `<div class="nav-item ${S.tview === k ? "on" : ""}" data-tv="${k}"><span class="tic">${ic}</span><span class="name">${t}</span>${k === "health" && S.tview === "health" && S.tdata && S.tdata.problems ? `<span class="cnt">${fmtN(S.tdata.problems)}</span>` : ""}</div>`).join("")}
    </div><div class="muted small sidenote">Günlük işler için <b>Müzikler</b>, <b>Listeler</b> ve <b>Gelen</b> yeter; buradakiler ileri araçlar.</div></aside>`;
  let main = "";
  const xv = extView();
  if (xv) main = xv.html(S.tdata);
  else if (S.tview === "health") main = healthHtml(S.tdata);
  else if (S.tview === "table") main = libTableHtml();
  else if (S.tview === "export") main = exportHtml();
  else main = historyHtml();
  const cls = xv ? (xv.width || "") : S.tview === "table" ? "wide" : "read";
  v.innerHTML = `<div class="split">${side}<section class="main ${cls}" id="tmain">${main}</section></div>`;
  S._lastT = S.tview;
  const xh = $("#tmain > .head");
  if (xh && !xh.querySelector(".sidebtn")) xh.insertAdjacentHTML("afterbegin", SIDEBTN);   // eklenti görünümleri de çekmeceyi açabilsin
  if (S.tview === "table") drawLibTable();
  wireTools();
  if (xv && xv.after) xv.after(S.tdata);
  vtRestore($("#tmain .body"), keep);                   // tablolar (eklentininkiler de) çizildikten sonra
}

// --- Sağlık --------------------------------------------------------------
const HACT = { quarantine: "Karantinaya al", missing: "Engine'den kaldır", repair: "Şimdi onar", rename: "Adları düzelt",
  rename_emoji: "Emojileri temizle", junk: "Karantinaya taşı", dupes: "Kopyalara git" };

function healthHtml(h) {
  if (!h || !h.stats || !h.categories) return `<div class="body"><div class="empty">Yükleniyor…</div></div>`;
  const st = h.stats;
  const cats = h.categories.filter((c) => c.count);
  S.hopen = S.hopen || new Set();
  const fm = Object.entries(st.formats).slice(0, 6).map(([k, n]) => `${esc(k.replace(".", "").toUpperCase())} ${fmtN(n)}`).join(" · ");
  const card = (c) => {
    const open = S.hopen.has(c.key);
    const items = open ? `<div class="hlist">${c.items.map((i) => `<div class="hrow">${i.id && c.key !== "junk" ? `<div class="meta" data-info="${i.id}">` : `<div class="meta">`}<div class="ttl">${esc(i.title)}${i.artist ? ` <span class="muted">— ${esc(i.artist)}</span>` : ""}</div><div class="art" title="${esc(i.rel)}">${esc(i.rel)}${i.bitrate ? ` · ${i.bitrate} kbps` : ""}</div></div>${i.id && c.key !== "junk" ? `<button class="play" data-play="${i.id}">▶</button>` : ""}</div>`).join("")}${c.count > c.items.length ? `<div class="muted small" style="padding:8px 14px">… ve ${fmtN(c.count - c.items.length)} tane daha</div>` : ""}</div>` : "";
    return `<div class="card hc ${c.action ? "act" : ""}"><div class="hc-h"><span class="hc-n">${fmtN(c.count)}</span><div class="hct"><b>${esc(c.title)}</b>${c.size ? ` <span class="muted small">(${fmtSize(c.size)})</span>` : ""}<div class="muted small">${esc(c.hint)}</div></div>
      ${c.action ? `<button class="btn sm ${c.action === "dupes" ? "" : "primary"}" data-hact="${c.action}" data-cat="${c.key}">${esc((DJD.healthActs[c.action] || {}).label || HACT[c.action] || c.action)}</button>` : ""}
      <button class="btn sm ghost" data-hshow="${c.key}">${open ? "Gizle ▴" : "Göster ▾"}</button></div>${items}</div>`;
  };
  return `<div class="head">${SIDEBTN}<div class="ht"><h2>Sağlık</h2><div class="sub">${fmtN(st.songs)} şarkı · ${fmtLong(st.duration)} · ${fmtSize(st.size)} · Engine'de ${fmtN(st.engine)} (${fmtN(st.analyzed)} analiz edildi)</div>
    <div class="sub">${fm}${st.with_note ? ` · notlu ${fmtN(st.with_note)}` : ""}${st.with_cues ? ` · cue'lu ${fmtN(st.with_cues)}` : ""}${st.with_key ? ` · tonu belli ${fmtN(st.with_key)}` : ""}</div></div></div>
    <div class="body">${cats.length ? cats.map(card).join("") : `<div class="empty"><div class="big">🎉</div>Her şey yolunda.</div>`}
    <div class="muted small" style="margin-top:6px">Düzeltmeler dosya silmez (karantinaya taşır), önce yedek alır ve tek tıkla <b>Geri al</b> ile döner.</div></div>`;
}

async function toolTask(path, body, msg) {
  try { const r = await task(path, body); toast(msg(r), "ok"); } catch (e) { /* bildirildi */ }
  await refresh(true);
}

async function healthAction(act, key) {
  const c = ((S.tdata && S.tdata.categories) || []).find((x) => x.key === key) || { items: [], count: 0 };
  if (DJD.healthActs[act]) { await DJD.healthActs[act].fn(c); return; }
  if (act === "quarantine") { await quarantine(c.items.map((i) => i.id)); return; }
  if (act === "dupes") { S.tab = "music"; S.view = "dupes"; localStorage.setItem("djd.tab", "music"); await refresh(true); return; }
  if (act === "repair") { await toolTask("/api/health/repair", {}, (r) => `Engine onarıldı (${(r.repaired || 0) + (r.relinked || 0)} yol).`); return; }
  if (act === "junk") {
    if (await confirmBox("Çöp dosyalar", `${fmtN(c.count)} dosya SSD'deki karantinaya taşınacak (silinmez, geri alınabilir).`, "Taşı"))
      await toolTask("/api/health/junk", {}, (r) => `${fmtN(r.moved)} dosya karantinaya taşındı.`);
    return;
  }
  if (act === "missing") {
    if (await confirmBox("Engine'den kaldır", `Dosyası diskte olmayan ${fmtN(c.count)} kayıt Engine koleksiyonundan ve listelerden kalkacak. Önce yedek alınır; Geri al ile döner. Engine DJ kapalı olmalı.`, "Kaldır", true))
      await toolTask("/api/health/missing", {}, (r) => `${fmtN(r.removed)} kayıt Engine'den kaldırıldı.`);
    return;
  }
  if (act === "rename" || act === "rename_emoji") { renameDialog(act === "rename_emoji"); }
}

async function renameDialog(emoji) {
  let p;
  try { p = await api("/api/health/rename" + (emoji ? "?emoji=1" : "")); } catch (e) { toast(e.message, "err"); return; }
  if (!p.count) { toast("Düzeltilecek ad yok."); return; }
  const m = modal(`<div class="dh">${emoji ? "Emojileri temizle" : "Adları düzelt"}</div><div class="db">
    <div class="muted small" style="margin-bottom:8px">${fmtN(p.count)} ad değişecek. Türkçe harfler korunur; Engine ve Serato yolları birlikte güncellenir. Engine DJ ve Serato kapalı olmalı.</div>
    <table class="t cmp"><colgroup><col data-w="4.5em"><col data-flex="1" data-min="7em"><col data-flex="1" data-min="7em"></colgroup><thead><tr><th></th><th>Şimdi</th><th>Yeni ad</th></tr></thead><tbody>${p.preview.map((x) => `<tr><td class="muted small">${esc(x.kind)}</td><td class="small">${esc(x.old)}</td><td class="small"><b>${esc(x.new)}</b></td></tr>`).join("")}</tbody></table></div>
    <div class="df"><button class="btn" data-x="no">Vazgeç</button><button class="btn primary" data-x="yes">Düzelt</button></div>`, "wide");
  m.el.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-x]");
    if (!b) return;
    m.close();
    if (b.dataset.x === "yes") await toolTask("/api/health/rename", { emoji }, (r) => `${fmtN(r.renamed)} ad düzeltildi.`);
  });
}

// --- Kütüphane tablosu -------------------------------------------------------
// Sütunlar: w = tercih edilen genişlik, min = en dar hal, pri = dar pencerede gizlenme sırası (küçük önce gizlenir)
const LCOLS = [
  { k: "dot", t: "", w: "30px", def: 1 }, { k: "title", t: "Başlık", def: 1, w: "16em", min: "9em", flex: 3 },
  { k: "artist", t: "Sanatçı", w: "12em", min: "7em", flex: 1, max: "20em", pri: 9, def: 1 },
  { k: "genre", t: "Tür", w: "9em", min: "6em", pri: 6, def: 1 }, { k: "bpm", t: "BPM", w: "4.2em", pri: 8, def: 1, num: 1 },
  { k: "key", t: "Ton", w: "3.8em", pri: 7, def: 1 }, { k: "energy", t: "Enerji", w: "4.2em", pri: 2, num: 1 },
  { k: "dur", t: "Süre", w: "4.2em", pri: 5, def: 1, num: 1, f: fmtDur }, { k: "kbps", t: "kbps", w: "4.2em", pri: 3, def: 1, num: 1 },
  { k: "ext", t: "Biçim", w: "4.2em", pri: 2, def: 1 }, { k: "size", t: "Boyut", w: "5.4em", pri: 1, num: 1, f: fmtSize },
  { k: "note", t: "Not", w: "11em", min: "6em", flex: .5, max: "22em", pri: 4, def: 1 }, { k: "cues", t: "Cue", w: "3.6em", pri: 1, num: 1 },
  { k: "album", t: "Albüm", w: "10em", min: "6em", pri: 2 }, { k: "tag_genre", t: "Tür etiketi", w: "8em", pri: 1 },
  { k: "year", t: "Yıl", w: "3.8em", pri: 1, num: 1 }, { k: "label", t: "Plak şirketi", w: "8.5em", pri: 1 },
  { k: "engine", t: "Engine", w: "8em", min: "6em", pri: 5, def: 1, f: (x) => ENG_TXT[x] || x }, { k: "dup", t: "Kopya", w: "4.2em", pri: 1, num: 1 },
  { k: "serato", t: "Crate", w: "4.2em", pri: 1, num: 1 }, { k: "lists", t: "Liste", w: "4em", pri: 1, num: 1 },
  { k: "added", t: "Eklenme", w: "6.4em", pri: 2, num: 1, f: fmtDate }, { k: "rel", t: "Yol", w: "20em", min: "8em", flex: 1, pri: 3 },
];
const lcolAttr = (c) => [["w", c.w], ["min", c.min], ["max", c.max], ["flex", c.flex], ["pri", c.pri]].filter((x) => x[1] != null).map(([k, v]) => ` data-${k}="${v}"`).join("");
const LFILTERS = [["all", "Hepsi"], ["pending", "Analiz bekleyen"], ["none", "Engine'de değil"], ["note", "Notlu"], ["cues", "Cue'lu"],
  ["nokey", "Tonu yok"], ["lowbr", "Düşük kalite"], ["notags", "Etiketsiz"], ["dup", "Kopyası olan"]];

function lcolsOn() {
  let on = null;
  try { on = JSON.parse(localStorage.getItem("djd.lcols") || "null"); } catch (e) { on = null; }
  return LCOLS.filter((c) => (on ? on.includes(c.k) : c.def) || c.k === "title");
}

function libObjs() {
  const d = S.tdata;
  if (!d || !d.cols) return [];
  if (d._objs) return d._objs;
  const cols = d.cols;
  d._objs = d.rows.map((r) => { const o = {}; cols.forEach((c, i) => { o[c] = r[i]; }); return o; });
  return d._objs;
}

function libRows() {
  let rows = libObjs();
  const q = fold(S.lq || "").split(/\s+/).filter(Boolean);
  const fl = S.lflt || "all";
  const lossless = new Set(["flac", "wav", "aif", "aiff", "alac"]);
  const test = { pending: (r) => r.engine === "pending", none: (r) => r.engine === "none", note: (r) => !!r.note, cues: (r) => r.cues > 0,
    nokey: (r) => !r.key, lowbr: (r) => r.kbps && r.kbps < 190 && !lossless.has(r.ext), notags: (r) => !r.artist, dup: (r) => r.dup > 0 }[fl];
  if (test) rows = rows.filter(test);
  if (q.length) rows = rows.filter((r) => { const s = r.search || fold(r.title + " " + r.artist); return q.every((w) => s.includes(w)); });
  const so = S.lsort || { k: "artist", d: 1 };
  const col = LCOLS.find((c) => c.k === so.k) || {};
  const key = col.num ? (r) => (r[so.k] == null ? -Infinity : +r[so.k]) : (r) => fold(r[so.k] == null ? "" : String(r[so.k]));
  const tie = (r) => fold(r.title);
  return rows.slice().sort((a, b) => { const x = key(a), y = key(b); if (x < y) return -so.d; if (x > y) return so.d; const t1 = tie(a), t2 = tie(b); return t1 < t2 ? -1 : t1 > t2 ? 1 : 0; });
}

function libTableHtml() {
  return `<div class="head">${SIDEBTN}<div class="ht"><h2>Kütüphane tablosu</h2><div class="sub ell" id="lcount"></div></div>
    <input class="search" id="lsearch" placeholder="Ara: şarkı, sanatçı, albüm, not, yol…" value="${esc(S.lq || "")}">
    <div class="hacts"><button class="btn" id="lcolbtn">Sütunlar<span class="lhid muted small"></span> ▾</button><button class="btn" id="lcsv" title="Excel'de açılır">⇪ CSV</button></div>
    <div class="chips" style="width:100%;margin-top:0">${LFILTERS.map(([k, t]) => `<span class="chip ${(S.lflt || "all") === k ? "on" : ""}" data-lf="${k}">${t}</span>`).join("")}</div></div>
    <div class="body">${libTableTable()}</div>`;
}
function libTableTable() {
  const cols = lcolsOn();
  const so = S.lsort || { k: "artist", d: 1 };
  return `<table class="t v lt" id="libt"><colgroup>${cols.map((c) => `<col${lcolAttr(c)}>`).join("")}<col data-w="3em"></colgroup>
    <thead><tr>${cols.map((c) => `<th data-ls="${c.k}" class="${c.num ? "r" : ""}" title="${esc(c.t)}">${esc(c.t)}${so.k === c.k ? (so.d > 0 ? " ▲" : " ▼") : ""}</th>`).join("")}<th></th></tr></thead><tbody></tbody></table>`;
}
// Yalnızca tabloyu yeniden kur (arama kutusu, odak ve kaydırma yerinde kalır)
function rebuildLibTable(reset) {
  const t = $("#libt"), b = $("#tmain .body");
  if (!t) return;
  const top = b ? b.scrollTop : 0;
  t.outerHTML = libTableTable();
  drawLibTable(reset);
  if (b && !reset) b.scrollTop = top;
}

function libRowHtml(r) {
  const cols = S._lcols;
  return `<tr data-id="${r.id}">${cols.map((c) => {
    if (c.k === "dot") return `<td class="c-dot">${dotHtml(r.dot)}</td>`;
    if (c.k === "title") return `<td class="c-song" data-info="${r.id}" title="${esc(r.rel)}"><span class="ttl">${esc(r.title)}</span></td>`;
    const v = r[c.k];
    const txt = v == null || v === "" ? "" : c.f ? c.f(v) : v;
    return `<td class="${c.num ? "r" : ""}${c.k === "note" ? " notec" : ""}" title="${esc(txt)}">${esc(txt)}</td>`;
  }).join("")}<td class="c-act"><button class="play" data-play="${r.id}" title="Dinle">▶</button></td></tr>`;
}

function drawLibTable(reset) {
  S._lcols = lcolsOn();
  const rows = libRows();
  const c = $("#lcount");
  if (c) c.textContent = `${fmtN(rows.length)} şarkı${rows.length !== libObjs().length ? ` (toplam ${fmtN(libObjs().length)})` : ""} · başlığa tıkla: ayrıntılar · sütun adına tıkla: sırala`;
  if (reset && $("#tmain .body")) $("#tmain .body").scrollTop = 0;
  vtSet("libt", rows, libRowHtml);
  libHidSync();
}
// Dar pencerede sığmayan seçili sütunların sayısı "Sütunlar" düğmesinde görünür
function libHidSync() {
  const t = $("#libt"), b = $("#lcolbtn .lhid");
  if (!t || !b) return;
  const n = ((t.dataset.hide || "").match(/\d+/g) || []).length;
  b.textContent = n ? ` · ${n} gizli` : "";
  $("#lcolbtn").title = n ? `Pencere dar: ${n} sütun sığmadı` : "";
}
document.addEventListener("djd:cols", (e) => { if (e.target && e.target.id === "libt") libHidSync(); });

// Sütun seçici: seçim değişince menü açık kalır (aynı düğmeye bağlı), tablo yerinde yenilenir.
// Dar pencerede sığmayan seçili sütunlar "sığmıyor" notuyla görünür.
function colMenu() {
  const btn = $("#lcolbtn");
  if (!btn) return;
  const cols = lcolsOn();
  const on = new Set(cols.map((c) => c.k));
  const t = $("#libt");
  const hid = new Set(((t && t.dataset.hide) || "").split(" ").filter(Boolean).map((i) => (cols[+i - 1] || {}).k));
  menu({ target: btn }, [...LCOLS.filter((c) => c.k !== "title" && c.k !== "dot").map((c) => ({ label: c.t, icon: on.has(c.k) ? "✓" : "",
    note: on.has(c.k) && hid.has(c.k) ? "sığmıyor" : "", fn: () => {
      if (on.has(c.k)) on.delete(c.k); else on.add(c.k);
      on.add("title"); on.add("dot");
      localStorage.setItem("djd.lcols", JSON.stringify(LCOLS.filter((x) => on.has(x.k)).map((x) => x.k)));
      rebuildLibTable(); colMenu();
    } })), "-", { label: "Varsayılan sütunlar", icon: "↺", fn: () => { localStorage.removeItem("djd.lcols"); rebuildLibTable(); colMenu(); } }], { filter: false });
}

// --- Dışa aktar ----------------------------------------------------------------
function sourceOptions() {
  const ls = ((S.tdata && S.tdata.lists) || []).filter((l) => !l.managed);
  return `<option value="lists">Tüm listeler (Engine)</option><option value="genres">Tür klasörleri</option>${ls.length ? `<optgroup label="Tek liste / etkinlik">${ls.map((l) => `<option value="list:${l.id}">${esc(l.path.join(" / "))} (${l.n})</option>`).join("")}</optgroup>` : ""}`;
}

function exportHtml() {
  const opts = sourceOptions();
  return `<div class="head">${SIDEBTN}<div class="ht"><h2>Dışa aktar</h2><div class="sub">Listelerini başka programlara taşı. Müzik dosyalarına ve Engine / Serato kütüphanelerine dokunulmaz.</div></div>
    <button class="btn" id="openexp">📂 Dışa aktarım klasörü</button></div>
    <div class="body">
    <div class="card"><h3>rekordbox XML</h3><div class="muted small" style="margin-bottom:10px">Listeler, BPM, ton ve Serato cue noktalarıyla. rekordbox ve rekordbox XML okuyan programlar (Engine DJ, VirtualDJ, Traktor araçları) içe alabilir.</div>
      <div class="exrow"><select id="xsrc" class="search">${opts}</select><label class="small"><input type="checkbox" id="xcues" checked> Cue noktaları</label><button class="btn primary" data-exp="xml">Dışa aktar</button></div></div>
    <div class="card"><h3>M3U8 çalma listeleri</h3><div class="muted small" style="margin-bottom:10px">Her liste için bir dosya (VLC, Traktor, VirtualDJ, Mixxx…).</div>
      <div class="exrow"><select id="msrc" class="search">${opts}</select><button class="btn primary" data-exp="m3u">Dışa aktar</button></div></div>
    <div class="card"><h3>Kütüphane tablosu (CSV)</h3><div class="muted small" style="margin-bottom:10px">Tüm şarkılar tek tabloda: Excel / Numbers ile açılır (BPM, ton, süre, kalite, Engine durumu, yol).</div>
      <div class="exrow"><button class="btn primary" data-exp="csv">CSV oluştur</button></div></div></div>`;
}

async function runExport(format, source, cues = true) {
  let r;
  try { r = await task("/api/export", { format, source, cues }); } catch (e) { return; }
  const what = { xml: `rekordbox XML hazır: ${fmtN(r.tracks)} şarkı${r.cues ? `, ${fmtN(r.cues)} cue` : ""}`, m3u: `${fmtN(r.files)} çalma listesi dosyası hazır`, csv: `CSV hazır: ${fmtN(r.rows)} şarkı` }[format];
  const m = modal(`<div class="dh">Dışa aktarıldı</div><div class="db"><p>${esc(what)}${r.missing ? ` <span class="muted">(${r.missing} şarkının dosyası yok, atlandı)</span>` : ""}.</p><div class="muted small wrap-any">${esc(r.path || r.dir)}</div></div>
    <div class="df"><button class="btn" data-x="no">Tamam</button><button class="btn primary" data-x="yes">📂 Klasörü aç</button></div>`);
  m.el.addEventListener("click", (e) => {
    const b = e.target.closest("[data-x]");
    if (!b) return;
    m.close();
    if (b.dataset.x === "yes") api("/api/open", r.path ? { path: r.path, select: true } : { path: r.dir }).catch((er) => toast(er.message, "err"));
  });
}

// --- Geçmiş ve yedekler --------------------------------------------------------
function historyHtml() {
  const j = S.tdata.journal || [], b = S.tdata.backups || { items: [], dirs: {}, quarantine: {} };
  const top = (S.st && S.st.undo) ? S.st.undo.id : null;
  return `<div class="head">${SIDEBTN}<div class="ht"><h2>Geçmiş ve yedekler</h2><div class="sub">Her işlem kayıtlı; en sondaki tek tıkla geri alınır. Yedekler SSD'de: _DJDoktor_/Yedekler.</div></div></div>
    <div class="body">
    <div class="card" style="padding:0"><div style="padding:12px 16px 6px"><h3>Son işlemler</h3></div>
      ${j.map((x) => `<div class="ib"><span class="muted small nowrap">${new Date(x.ts * 1000).toLocaleString("tr-TR")}</span><div class="meta" style="${x.status !== "tamam" ? "color:var(--muted);text-decoration:line-through" : ""}">${esc(x.title)}</div>${x.id === top ? `<button class="btn sm" id="hundo">↶ Geri al</button>` : x.status === "geri_alindi" ? '<span class="tag">geri alındı</span>' : ""}</div>`).join("") || '<div class="empty small">Henüz işlem yok.</div>'}</div>
    <div class="card"><h3>Yedekler ve karantina</h3>
      <div class="exrow" style="flex-wrap:wrap"><button class="btn" data-od="engine">📂 Engine yedekleri</button><button class="btn" data-od="serato">📂 Serato yedekleri</button>
      <button class="btn" data-od="karantina">📂 Karantina (${fmtN(b.quarantine.files || 0)} dosya, ${fmtSize(b.quarantine.size || 0)})</button></div>
      <div class="small hlist" style="margin-top:10px">${b.items.slice(0, 40).map((x) => `<div class="hrow"><span class="tag">${x.kind === "engine" ? "Engine" : "Serato"}</span><div class="meta"><div title="${esc(x.name)}">${esc(x.name)}</div></div><span class="muted nowrap">${new Date(x.ts * 1000).toLocaleString("tr-TR")} · ${fmtSize(x.size)}</span></div>`).join("") || '<span class="muted">Henüz yedek yok.</span>'}</div></div></div>`;
}

function wireTools() {
  const v = $("#view");
  v.onclick = async (e) => {
    const tv = e.target.closest("[data-tv]");
    if (tv) { S.tview = tv.dataset.tv; localStorage.setItem("djd.tview", S.tview); await loadTools(); return; }
    const play = e.target.closest("[data-play]");
    if (play) { playFid(+play.dataset.play, play); return; }
    const hs = e.target.closest("[data-hshow]");
    if (hs) { const k = hs.dataset.hshow; if (S.hopen.has(k)) S.hopen.delete(k); else S.hopen.add(k); renderTools(); return; }
    const ha = e.target.closest("[data-hact]");
    if (ha) { await healthAction(ha.dataset.hact, ha.dataset.cat); return; }
    const lf = e.target.closest("[data-lf]");
    if (lf) { S.lflt = lf.dataset.lf; $$(".chip[data-lf]").forEach((c) => c.classList.toggle("on", c === lf)); drawLibTable(true); return; }
    const ls = e.target.closest("[data-ls]");
    if (ls) { const k = ls.dataset.ls; const so = S.lsort || { k: "artist", d: 1 }; S.lsort = { k, d: so.k === k ? -so.d : 1 }; rebuildLibTable(true); return; }
    if (e.target.closest("#lcolbtn")) { colMenu(); return; }
    if (e.target.id === "lcsv") { runExport("csv", "all"); return; }
    const ex = e.target.closest("[data-exp]");
    if (ex) { const f = ex.dataset.exp; runExport(f, f === "xml" ? $("#xsrc").value : f === "m3u" ? $("#msrc").value : "all", f === "xml" ? $("#xcues").checked : true); return; }
    if (e.target.id === "openexp") { const b = await api("/api/backups").catch(() => null); if (b) api("/api/open", { path: b.export_dir }).catch((er) => toast(er.message, "err")); return; }
    const od = e.target.closest("[data-od]");
    if (od) { api("/api/open", { path: S.tdata.backups.dirs[od.dataset.od] }).catch((er) => toast(er.message, "err")); return; }
    if (e.target.id === "hundo") { await undo(); }
  };
  v.oninput = (e) => {
    if (e.target.id === "lsearch") { S.lq = e.target.value; clearTimeout(S._lt); S._lt = setTimeout(() => drawLibTable(true), 140); }
  };
  v.onchange = null;
}

// ---------------------------------------------------------------------------
// Parça ayrıntısı (sağdan açılan panel): etiketler, cue'lar, Engine, listeler, kopyalar, uyumlu şarkılar
// ---------------------------------------------------------------------------
async function openTrack(fid) {
  let d;
  try { d = await api("/api/track/" + fid); } catch (e) { toast(e.message, "err"); return; }
  const f = d.file;
  const kv = (k, v) => (v == null || v === "" ? "" : `<div class="k">${esc(k)}</div><div class="v">${esc(v)}</div>`);
  const es = { ready: ["ready", "Engine'de, analiz edildi"], pending: ["pending", "Engine'de, analiz bekliyor"], broken: ["problem", "Engine'de yolu bozuk"], edup: ["pending", "Engine'de iki kez"], none: ["none", "Engine'de değil"] }[d.es] || ["none", ""];
  const mk = d.markers || {};
  const cues = (mk.cues || []).map((c) => `<span class="cue" style="border-color:${esc(c.color || "#cc0000")}"><i style="background:${esc(c.color || "#cc0000")}"></i>${fmtDur((c.ms || 0) / 1000) || "0:00"}${c.name ? " · " + esc(c.name) : ""}</span>`).join("")
    + (mk.loops || []).map((l) => `<span class="cue loop">⟲ ${fmtDur((l.start || 0) / 1000) || "0:00"}–${fmtDur((l.end || 0) / 1000)}${l.name ? " · " + esc(l.name) : ""}</span>`).join("");
  const grp = d.dupe_group;
  const html = `<div class="drawer-bg" data-dx="1"></div><aside class="drawer" role="dialog" aria-label="Şarkı ayrıntısı">
    <div class="dw-h"><div><div class="dw-t" title="${esc(f.title || f.name)}">${esc(f.title || f.name)}</div><div class="muted ell" title="${esc(f.artist || "")}">${esc(f.artist || "—")}</div>
      <div style="margin-top:6px">${dotHtml(d.issues && d.issues.some((i) => i.severity === "kritik") ? "problem" : es[0])} <span class="small">${es[1]}</span>${d.genre ? ` <span class="tag gtx" style="${gStyle(d.color)}">${esc(d.genre)}</span>` : ""}</div></div>
      <button class="icon-btn" data-dx="1" title="Kapat (Esc)">✕</button></div>
    <div class="dw-b">
      <div class="exrow" style="margin-bottom:12px;flex-wrap:wrap"><button class="btn sm" data-dplay="${f.id}">▶ Dinle</button><button class="btn sm" data-dopen="${f.id}">📂 Göster</button>
        <button class="btn sm" data-dmove="${f.id}">Türe taşı ▾</button><button class="btn sm" data-dlist="${f.id}">Listeye ekle ▾</button>
        ${DJD.trackActs.map((a, i) => `<button class="btn sm" data-dext="${i}">${esc(a.label)}</button>`).join("")}</div>
      <div class="dw-s"><h4>Yollar</h4><div class="kv">
        <div class="k">Dosya</div><div class="v"><span class="wrap-any">${esc(d.abs || d.disp)}</span> <button class="btn xs" data-dcopy="${esc(d.abs || d.disp)}" title="Kopyala">⧉</button></div>
        <div class="k">SSD içinde</div><div class="v wrap-any">${esc(d.disp)}</div>
        ${d.engine ? `<div class="k">Engine</div><div class="v"><span class="wrap-any">${esc(d.engine.path || "")}</span> <span class="tag ${d.es === "broken" ? "bad" : "ok"}">${d.es === "broken" ? "✗ dosyayı bulamıyor" : "✓ dosyayı buluyor"}</span></div>` : `<div class="k">Engine</div><div class="v muted">Engine'de kayıt yok</div>`}
        <div class="k">Serato</div><div class="v ${d.serato_lists.length ? "" : "muted"}">${d.serato_lists.length ? d.serato_lists.length + " crate'te" : "hiçbir crate'te değil"}</div></div></div>
      ${d.issues && d.issues.length ? `<div class="dw-s"><h4>Sorunlar (nokta bu yüzden ${d.issues.some((i) => i.severity === "kritik") ? "kırmızı" : "uyarılı"})</h4>${d.issues.map((i) => `<div class="small"><span class="tag ${i.severity === "kritik" ? "bad" : i.severity === "uyari" ? "warn" : ""}">${esc(i.title)}</span> <span class="muted">${esc(i.desc)}</span></div>`).join("")}</div>` : ""}
      <div class="dw-s"><h4>Bilgiler</h4><div class="kv">
        ${kv("BPM", f.bpm ? Math.round(f.bpm * 10) / 10 : (d.engine && d.engine.bpm ? Math.round(d.engine.bpm * 10) / 10 + " (Engine)" : ""))}
        ${kv("Ton", f.camelot || (d.engine && d.engine.key ? d.engine.key + " (Engine)" : ""))}${kv("Enerji (MIK)", f.mik_energy)}
        ${kv("Süre", fmtDur(f.duration))}${kv("Kalite", [(f.ext || "").replace(".", "").toUpperCase(), f.bitrate ? f.bitrate + " kbps" : "", f.sample_rate ? (f.sample_rate / 1000) + " kHz" : ""].filter(Boolean).join(" · "))}
        ${kv("Boyut", fmtSize(f.size))}${kv("Albüm", f.album)}${kv("Tür etiketi", f.genre)}${kv("Yıl", f.year)}${kv("Plak şirketi", f.label)}
        ${kv("Besteci", f.composer)}${kv("Remix", f.remixer)}${kv("Not", f.note)}${kv("Yorum", f.comment && f.comment !== f.note ? f.comment : "")}
        ${kv("Gruplama", f.grouping)}</div>
        ${f.bpm || f.camelot ? `<div class="muted small" style="margin-top:6px">BPM ve ton dosyanın etiketinden gelir (Serato, Mixed In Key ya da indirdiğin yer yazmış). Engine'in kendi analizi ayrıdır: grid, dalga formu ve cue için Engine DJ'de bir kez analiz gerekir.</div>` : ""}</div>
      ${cues ? `<div class="dw-s"><h4>Cue noktaları (Serato)</h4><div class="cues">${cues}</div></div>` : ""}
      ${d.engine ? `<div class="dw-s"><h4>Engine DJ</h4><div class="kv">${kv("Durum", d.engine.analyzed ? "analiz edildi" : "analiz bekliyor")}${kv("Beatgrid", d.engine.grid ? "var" : "")}${kv("Engine yolu", d.engine.path)}${d.engine.copies > 1 ? kv("Uyarı", "Engine'de " + d.engine.copies + " kez kayıtlı") : ""}</div></div>` : ""}
      ${(d.engine_lists.length || d.serato_lists.length) ? `<div class="dw-s"><h4>Listeler</h4>${d.engine_lists.map((x) => `<span class="tag blue">${esc(x)}</span>`).join("")}${d.serato_lists.map((x) => `<span class="tag" title="Serato crate">S · ${esc(x)}</span>`).join("")}</div>` : ""}
      ${grp ? `<div class="dw-s"><h4>Kopyalar (${grp.members.length})</h4>${grp.members.map((m) => `<div class="small" style="padding:2px 0"><span class="tag ${m.keeper ? "ok" : ""}">${m.keeper ? "tutulacak" : "kopya"}</span>${esc(m.rel)}</div>`).join("")}<button class="btn sm" data-dgo="dupes" style="margin-top:6px">Kopyalara git</button></div>` : ""}
      <div class="dw-s"><h4>Uyumlu şarkılar <span class="muted small">(aynı / komşu ton, ±%${bpmRange()} BPM)</span></h4>
        ${d.compatible.length ? d.compatible.map((c) => `<div class="hrow"><div class="meta" data-info="${c.id}"><div class="ttl">${esc(c.title)}</div><div class="art">${esc(c.artist || "—")} · ${c.bpm || "?"} · ${esc(c.key)} · ${esc(c.match)}${c.genre ? " · " + esc(c.genre) : ""}</div></div><button class="play" data-play="${c.id}">▶</button><button class="icon-btn" data-dlist="${c.id}" title="Listeye ekle">＋</button></div>`).join("")
          : `<div class="muted small">${f.camelot || f.bpm || d.engine ? "Bu tona ve tempoya uyan şarkı bulunamadı." : "Ton ve BPM bilgisi yok (Engine'de analiz edilince gelir)."}</div>`}</div>
    </div></aside>`;
  const root = $("#drawer");
  root.innerHTML = html;
  root.onclick = async (e) => {
    if (e.target.closest("[data-dx]")) { closeDrawer(); return; }
    const pl = e.target.closest("[data-dplay], [data-play]");
    if (pl) { playFid(+(pl.dataset.dplay || pl.dataset.play), pl); return; }
    const cp = e.target.closest("[data-dcopy]");
    if (cp) { try { await navigator.clipboard.writeText(cp.dataset.dcopy); toast("Yol kopyalandı.", "ok"); } catch (er) { toast(cp.dataset.dcopy); } return; }
    const op = e.target.closest("[data-dopen]");
    if (op) { api("/api/open", { fid: +op.dataset.dopen }).catch((er) => toast(er.message, "err")); return; }
    const mv = e.target.closest("[data-dmove]");
    if (mv) { if (!S.ov) S.ov = await api("/api/overview"); pickGenreMenu(e, [+mv.dataset.dmove]); return; }
    const li = e.target.closest("[data-dlist]");
    if (li) { addToListMenu(e, [+li.dataset.dlist]); return; }
    const dx = e.target.closest("[data-dext]");
    if (dx) { const a = DJD.trackActs[+dx.dataset.dext]; if (a) a.fn(f.id, d, e); return; }
    if (e.target.closest("[data-dgo]")) { closeDrawer(); S.tab = "music"; S.view = "dupes"; localStorage.setItem("djd.tab", "music"); await refresh(true); return; }
    const inf = e.target.closest("[data-info]");
    if (inf) { openTrack(+inf.dataset.info); }
  };
}
function closeDrawer() { const r = $("#drawer"); if (r) r.innerHTML = ""; }
// Ayarlar'daki geçiş tempo farkı (%): sunucu (events.compatible) da aynı sınırları kullanır
function bpmRange() { const v = Math.round(+((S.st && S.st.prefs) || {}).mix_bpm_range || 6); return Math.max(1, Math.min(25, v)); }

// ---------------------------------------------------------------------------
// Etkinlik kontrolü (gig check)
// ---------------------------------------------------------------------------
async function gigCheck(pid) {
  if (!pid) return;
  let g;
  try { g = await api("/api/gigcheck/" + pid); } catch (e) { toast(e.message, "err"); return; }
  const b = { tamam: ["ok", "✓ Hazır", "Her şarkı yerinde, analiz edilmiş ve Prime 4'te çalar."], uyari: ["warn", "Neredeyse hazır", "Küçük eksikler var."], kritik: ["bad", "Dikkat", "Etkinlikten önce düzelt."] }[g.status];
  const sev = { kritik: "bad", uyari: "warn", bilgi: "" };
  const m = modal(`<div class="dh">Kontrol: ${esc(g.title)}</div><div class="db">
    <div class="gc ${b[0]}"><b>${b[1]}</b> · ${fmtN(g.tracks)} şarkı · ${fmtLong(g.duration)}<div class="small">${b[2]}</div></div>
    ${g.checks.map((c, i) => `<details class="gcx" ${c.severity === "kritik" ? "open" : ""}><summary><span class="tag ${sev[c.severity]}">${c.severity === "kritik" ? "önemli" : c.severity === "uyari" ? "uyarı" : "bilgi"}</span> <b>${esc(c.title)}</b>${c.action === "repair" ? ` <button class="btn sm primary" data-grepair="${i}">Şimdi onar</button>` : ""}</summary>
      <div class="muted small" style="margin:4px 0 6px">${esc(c.detail)}</div><div class="small gci">${c.items.slice(0, 60).map((x) => `<div>${esc(x)}</div>`).join("")}${c.items.length > 60 ? `<div class="muted">… ve ${c.items.length - 60} tane daha</div>` : ""}</div></details>`).join("")}
    ${g.sections.length > 1 ? `<h4 style="margin:14px 0 6px">Bölümler</h4><table class="t"><tbody>${g.sections.map((s) => `<tr><td style="padding-left:${8 + Math.max(0, s.depth - 1) * 14}px">${esc(s.title)}</td><td class="c-num">${s.n}</td><td class="c-num">${fmtLong(s.dur)}</td></tr>`).join("")}</tbody></table>` : ""}
    </div><div class="df"><button class="btn" data-x="print">🖨 Yazdır</button><button class="btn primary" data-x="ok">Tamam</button></div>`, "wide");
  m.el.addEventListener("click", async (e) => {
    if (e.target.closest("[data-grepair]")) { e.preventDefault(); m.close(); await toolTask("/api/health/repair", {}, (r) => `Engine onarıldı (${(r.repaired || 0) + (r.relinked || 0)} yol).`); gigCheck(pid); return; }
    const x = e.target.closest("[data-x]");
    if (!x) return;
    if (x.dataset.x === "print") window.open(`/api/print/${pid}?t=${encodeURIComponent(TOKEN)}`, "_blank");
    m.close();
  });
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
    <div class="frow"><label class="field"><span>Görünüm</span><select id="ptheme"><option value="light" ${p.theme !== "dark" ? "selected" : ""}>Açık</option><option value="dark" ${p.theme === "dark" ? "selected" : ""}>Koyu</option></select></label>
    <label class="field"><span>Yazı boyutu</span><select id="psize"><option value="normal">Normal</option><option value="large" ${p.text_size === "large" ? "selected" : ""}>Büyük</option></select></label></div>
    ${st.active ? `<label class="field"><span>Gelen kutusu (bu bilgisayarda)</span><input id="pin" value="${esc(p.inbox_dir || "")}" placeholder="Varsayılan: Müzik/DJ Gelen"></label>
    <label class="field"><span>Arşiv (bu bilgisayarda)</span><input id="par" value="${esc(p.archive_dir || "")}" placeholder="Varsayılan: Müzik/DJ Arşiv"></label>
    <label class="switch ${p.watch_downloads !== false ? "on" : ""}" data-pref="watch_downloads" style="margin:6px 0"><i></i>İndirilenler klasöründeki unutulan şarkıları göster</label><br>
    <label class="switch ${p.genre_lists !== false ? "on" : ""}" data-pref="genre_lists" style="margin:6px 0"><i></i>Engine'de “Türler” listelerini tut</label>
    <div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap"><button class="btn" id="pscan">Şimdi yeniden tara</button><button class="btn" id="pssd">Başka SSD seç</button><button class="btn" id="pq">Karantinayı aç</button></div>
    ${DJD.settingsParts.map((p) => { try { return p.html(st) || ""; } catch (er) { return ""; } }).join("")}
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
    if (e.target.id === "pssd") { m.close(); renderOtherSsd(); return; }
    if (e.target.id === "pq") { api("/api/open", { path: st.active.root + "/_DJDoktor_/Karantina" }).catch((er) => toast(er.message, "err")); return; }
    if (e.target.closest("[data-x]")) m.close();
  });
  DJD.settingsParts.forEach((p) => { try { if (p.wire) p.wire(m.el, st, m); } catch (er) { /* */ } });
}

// ---------------------------------------------------------------------------
// Yerleşim motorunu başlat: #view'a yeni kutu / tablo eklendikçe (sanal tablo satırları hariç) taranır.
function layInit() {
  remPx();
  layoutScan();
  if (!window.MutationObserver) return;
  LAY.mo = new MutationObserver((recs) => {
    for (const r of recs) {
      if (r.target.nodeName === "TBODY") continue;
      if (r.target.classList && (r.target.classList.contains("picker") || r.target.classList.contains("side"))) paneScan();   // içi yeniden çizildi: tutamak geri
      for (const n of r.addedNodes) {
        if (n.nodeType === 1 && (n.matches(LAY_NEW) || n.querySelector(LAY_NEW))) { layoutScan(); return; }
      }
      for (const n of r.removedNodes) {
        if (n.nodeType === 1 && (n.matches("[data-dock]") || n.querySelector("[data-dock]"))) { dockSync(); break; }
      }
    }
  });
  LAY.mo.observe(document.body, { childList: true, subtree: true });
}
// Açılış: durum 2,5 sn'de gelmezse boş "Yükleniyor…" yerine programın ne yaptığını göster (/api/ping kilitsizdir)
function boot() {
  layInit();
  let done = false;
  refresh(true).then(() => { done = true; poll(); });
  const t0 = Date.now();
  const wait = async () => {
    if (done) return;
    const el = document.querySelector("#view .boot");
    if (el) {
      let txt = "";
      try {
        const r = await fetch("/api/ping", { cache: "no-store" }).then((x) => x.json());
        const b = (r.busy || [])[0];
        txt = b ? `Program meşgul: <b>${esc(b.title || "")}</b> · %${Math.round((b.progress || 0) * 100)}<div class="small muted wrap-any">${esc(b.message || "")}</div>`
          : "Program yanıt bekliyor…";
      } catch (e) { txt = "Program yanıt vermiyor."; }
      const sec = Math.round((Date.now() - t0) / 1000);
      el.innerHTML = `${txt}<div class="small muted" style="margin-top:8px">${sec} sn${sec > 40 ? " — çok uzun sürerse programı kapatıp aç ve <b>Belgeler/DJ Doktor/gunluk/djdoktor.log</b> dosyasını gönder." : ""}</div>`;
    }
    setTimeout(wait, 2000);
  };
  setTimeout(wait, 2500);
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
