/* DJ Kütüphane Doktoru — arayüz */
'use strict';

const TOKEN = window.DJD_TOKEN;
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => Array.from(root.querySelectorAll(s));
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function el(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; }

const TRMAP = { 'ı': 'i', 'İ': 'i', 'I': 'i', 'ş': 's', 'Ş': 's', 'ğ': 'g', 'Ğ': 'g', 'ü': 'u', 'Ü': 'u', 'ö': 'o', 'Ö': 'o', 'ç': 'c', 'Ç': 'c', 'â': 'a', 'Â': 'a', 'î': 'i', 'Î': 'i', 'û': 'u', 'Û': 'u', 'ß': 'ss' };
function fold(s) {
  s = String(s || '').normalize('NFC').replace(/[ıİIşŞğĞüÜöÖçÇâÂîÎûÛß]/g, (c) => TRMAP[c]);
  return s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}
const fmtDur = (s) => {
  if (!s) return '';
  s = Math.round(s);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`;
};
const fmtLong = (s) => {
  if (!s) return '0 dk';
  if (s < 60) return Math.round(s) + ' sn';
  const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60);
  return h ? `${h} sa ${m} dk` : `${m} dk`;
};
const fmtSize = (n) => {
  if (n == null) return '';
  const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; n = Number(n);
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return (i < 2 ? Math.round(n) : n.toFixed(1)).toString().replace('.', ',') + ' ' + u[i];
};
const fmtNum = (n) => Number(n || 0).toLocaleString('tr-TR');
const fmtTime = (ts) => ts ? new Date(ts * 1000).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
const plural = (n, w) => `${fmtNum(n)} ${w}`;

/* ------------------------------------------------------------------ */
/* İkonlar                                                             */
/* ------------------------------------------------------------------ */
const I = {
  genel: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  kutuphane: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  sorunlar: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  ciftler: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  listeler: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  etkinlikler: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  senkron: '<path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/>',
  yeni: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.1z"/>',
  gecmis: '<path d="M3 3v5h5"/><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8"/><path d="M12 7v5l4 2"/>',
  ayarlar: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  folder: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
  list: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  section: '<path d="M4 6h16M4 12h10M4 18h7"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  print: '<path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
  export: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M17 8l-5-5-5 5"/><path d="M12 3v12"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>',
  scan: '<path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/><path d="M7 12h10"/>',
  open: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6M10 14 21 3"/>',
  up: '<path d="m18 15-6-6-6 6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  undo: '<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-15-6.7L3 13"/>',
};
const ic = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true">${I[name] || ''}</svg>`;
const PLAY = '<svg viewBox="0 0 24 24"><path d="M7 4v16l13-8z"/></svg>';
const PAUSE = '<svg viewBox="0 0 24 24"><path d="M6 4h4v16H6zM14 4h4v16h-4z"/></svg>';

/* ------------------------------------------------------------------ */
/* Durum                                                               */
/* ------------------------------------------------------------------ */
const S = {
  state: null, ov: null, tracks: null, lists: null, issues: null, dupes: null,
  route: 'genel', routeArg: null,
  lib: { q: '', quick: 'all', folder: '', bpmMin: '', bpmMax: '', key: '', sort: { key: 'folder', dir: 1 } },
  sel: new Set(),
  dupFilter: 'all', dupSel: {},
  activeSection: null,
  inbox: null,
};

const ISSUE_SEV = {
  name_badchar: 'kritik', name_trailing: 'kritik', name_reserved: 'kritik', name_nfd: 'uyari', name_long: 'uyari', name_emoji: 'bilgi',
  junk_appledouble: 'uyari', junk_other: 'bilgi', fmt_engine: 'uyari', fmt_aac: 'bilgi', fmt_video: 'bilgi', audio_error: 'kritik',
  audio_empty: 'kritik', audio_lowbr: 'bilgi', audio_hires: 'bilgi', tag_none: 'bilgi', engine_copy: 'uyari', dup_exact: 'uyari',
  dup_audio: 'uyari', dup_song: 'bilgi', missing: 'uyari',
};
const ISSUE_SHORT = {
  name_badchar: "Adda Mac'e özel karakter", name_trailing: 'Ad boşluk/nokta ile bitiyor', name_reserved: 'Windows ayrılmış ad',
  name_nfd: 'Ayrık Unicode ad', name_long: 'Yol çok uzun', name_emoji: 'Adda emoji', junk_appledouble: 'Mac çöp dosyası',
  junk_other: 'Sistem çöp dosyası', fmt_engine: "Prime 4 çalmaz", fmt_aac: 'Ham .aac', fmt_video: 'Video', audio_error: 'Okunamıyor',
  audio_empty: 'Boş dosya', audio_lowbr: 'Düşük kalite', audio_hires: 'Yüksek örnekleme', tag_none: 'Etiket yok',
  engine_copy: 'Engine kopyası', dup_exact: 'Birebir kopya', dup_audio: 'Aynı ses kopyası', dup_song: 'Benzer kayıt', missing: 'Dosya yok',
};
const MATCH = {
  exact: ['Doğru', 'g', 'Mac, Windows ve Prime 4\'te çalışır'],
  case: ['Harf farkı', 'g', 'exFAT diskte çalışır'],
  unicode: ['Türkçe harf biçimi', 'r', 'Sadece Mac\'te çalışır; Prime 4 ve Windows\'ta kırmızı'],
  sfm: ['Mac\'e özel karakter', 'r', 'Sadece Mac\'te çalışır; Prime 4 ve Windows\'ta kırmızı'],
  missing: ['Dosya yok', 'a', 'Dosya taşınmış ya da silinmiş'],
  nodir: ['Klasör bu diskte yok', 'w', 'Bu klasör seçili kütüphanede bulunmuyor'],
  outside: ['Kök dışında', 'w', 'Kütüphane klasörünün dışında'],
};
const worstSev = (flags) => {
  let s = '';
  for (const f of flags || []) {
    const v = ISSUE_SEV[f] || 'bilgi';
    if (v === 'kritik') return 'kritik';
    if (v === 'uyari') s = 'uyari';
    else if (!s) s = 'bilgi';
  }
  return s;
};
const ro = () => !!(S.state && S.state.active && S.state.active.readonly);

/* ------------------------------------------------------------------ */
/* API ve görevler                                                     */
/* ------------------------------------------------------------------ */
async function api(path, body, method) {
  const opt = { method: method || (body !== undefined ? 'POST' : 'GET'), headers: { 'X-DJD-Token': TOKEN } };
  if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  let r;
  try { r = await fetch('/api/' + path, opt); } catch (e) { throw new Error('Program ile bağlantı kurulamadı. Programın penceresi açık mı?'); }
  let data = {};
  try { data = await r.json(); } catch (e) { /* boş */ }
  // Not: görev durumu (tasks/<id>) başarılı bir yanıttır ve içinde görevin kendi 'error' alanı olabilir;
  // yalnızca HTTP hatası istek hatasıdır.
  if (!r.ok) throw new Error((data && data.error) || ('Sunucu hatası ' + r.status));
  return data;
}

function invalidate() { S.ov = null; S.tracks = null; S.lists = null; S.issues = null; S.dupes = null; }

async function runTask(path, body, opts = {}) {
  let res;
  try { res = await api(path, body || {}); } catch (e) { showError(e.message); return null; }
  const id = res.task;
  const card = el(`<div class="task"><b>${esc(opts.title || 'İşlem')}</b><div class="msg">Sırada…</div><div class="bar"><i></i></div></div>`);
  $('#taskbox').appendChild(card);
  return new Promise((resolve) => {
    const poll = async () => {
      let t;
      try { t = await api('tasks/' + id); } catch (e) { setTimeout(poll, 1200); return; }
      $('.msg', card).textContent = t.message || '';
      $('i', card).style.width = Math.round((t.progress || 0) * 100) + '%';
      if (t.status === 'bitti' || t.status === 'iptal') {
        card.remove();
        invalidate();
        await refreshState();
        if (opts.done) { try { opts.done(t.result); } catch (e) { console.error(e); } }
        if (opts.toast) toast(typeof opts.toast === 'function' ? opts.toast(t.result) : opts.toast, 'ok');
        if (opts.rerender !== false) render();
        resolve(t.result);
      } else if (t.status === 'hata') {
        card.remove();
        invalidate();
        if (opts.onError && opts.onError(t)) { resolve(null); return; }
        showError(t.error || 'Bilinmeyen hata');
        render();
        resolve(null);
      } else setTimeout(poll, 450);
    };
    poll();
  });
}

function toast(msg, kind) {
  const t = el(`<div class="toast ${kind || ''}">${esc(msg)}</div>`);
  $('#toasts').appendChild(t);
  setTimeout(() => t.remove(), kind === 'err' ? 8000 : 4500);
}

/* ------------------------------------------------------------------ */
/* Modal, onay, menü                                                   */
/* ------------------------------------------------------------------ */
function modal({ title, body, foot, wide, onClose, lead }) {
  const bg = el(`<div class="modal-bg"><div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">
    <div class="mh"><div style="flex:1"><h2>${esc(title)}</h2>${lead ? `<p class="muted" style="margin:6px 0 0">${lead}</p>` : ''}</div>
    <button class="btn ghost icon" data-x aria-label="Kapat">${ic('x')}</button></div>
    <div class="mb"></div><div class="mf"></div></div></div>`);
  const close = () => { bg.remove(); document.removeEventListener('keydown', onKey); if (onClose) onClose(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  $('[data-x]', bg).onclick = close;
  bg.addEventListener('mousedown', (e) => { if (e.target === bg) close(); });
  const mb = $('.mb', bg), mf = $('.mf', bg);
  if (typeof body === 'string') mb.innerHTML = body; else if (body) mb.appendChild(body);
  if (typeof foot === 'string') mf.innerHTML = foot; else if (foot) mf.appendChild(foot); else mf.remove();
  $('#modal-root').appendChild(bg);
  const first = $('input, select, textarea', mb);
  if (first) setTimeout(() => first.focus(), 30);
  return { root: bg, body: mb, foot: mf, close };
}

function confirmBox(title, html, okLabel = 'Tamam', danger = false) {
  return new Promise((resolve) => {
    const m = modal({ title, body: `<div>${html}</div>`, foot: `<button class="btn" data-c>Vazgeç</button><button class="btn ${danger ? 'danger' : 'primary'}" data-ok>${esc(okLabel)}</button>`, onClose: () => resolve(false) });
    $('[data-c]', m.root).onclick = () => { m.close(); };
    $('[data-ok]', m.root).onclick = () => { resolve(true); m.root.remove(); };
  });
}

function promptBox(title, label, value = '') {
  return new Promise((resolve) => {
    const m = modal({ title, body: `<label class="field"><span>${esc(label)}</span><input type="text" value="${esc(value)}"></label>`,
      foot: `<button class="btn" data-c>Vazgeç</button><button class="btn primary" data-ok>Kaydet</button>`, onClose: () => resolve(null) });
    const inp = $('input', m.root);
    const ok = () => { const v = inp.value.trim(); resolve(v || null); m.root.remove(); };
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') ok(); });
    $('[data-c]', m.root).onclick = () => m.close();
    $('[data-ok]', m.root).onclick = ok;
  });
}

function showError(msg) {
  modal({ title: 'İşlem yapılamadı', body: `<p>${esc(msg)}</p>`, foot: `<button class="btn primary" data-x2>Tamam</button>` });
  const b = $('#modal-root [data-x2]'); if (b) b.onclick = () => b.closest('.modal-bg').remove();
}

function closeMenu() { $('#menu-root').innerHTML = ''; }
function openMenu(anchor, items) {
  closeMenu();
  const m = el('<div class="menu"></div>');
  for (const it of items) {
    if (it === '-') { m.appendChild(el('<hr>')); continue; }
    if (it.head) { m.appendChild(el(`<div class="mh">${esc(it.head)}</div>`)); continue; }
    const a = el(`<a style="padding-left:${10 + (it.depth || 0) * 14}px">${it.icon ? ic(it.icon) : ''}<span>${esc(it.label)}</span>${it.hint ? `<span class="faint small" style="margin-left:auto">${esc(it.hint)}</span>` : ''}</a>`);
    a.onclick = () => { closeMenu(); it.action(); };
    m.appendChild(a);
  }
  $('#menu-root').appendChild(m);
  const r = anchor.getBoundingClientRect();
  const w = m.offsetWidth, h = m.offsetHeight;
  m.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left)) + 'px';
  m.style.top = (r.bottom + h + 8 > window.innerHeight ? Math.max(8, r.top - h - 4) : r.bottom + 4) + 'px';
  setTimeout(() => document.addEventListener('mousedown', function h(e) { if (!m.contains(e.target)) { closeMenu(); document.removeEventListener('mousedown', h); } }), 0);
}

async function requireWritable(what) {
  if (!ro()) return true;
  const ok = await confirmBox('Salt-okunur mod açık',
    `<p>${esc(what)} için diske yazmak gerekiyor. Bu kütüphane şu anda <b>salt-okunur</b>: program hiçbir dosyayı değiştirmiyor.</p>
     <p>İzin verirseniz yalnızca onayladığınız işlemler yapılır; her işlemden önce yedek alınır ve <b>Geçmiş</b> sayfasından geri alınabilir. Hiçbir dosya silinmez.</p>
     <p class="muted">Öneri: Önce masaüstündeki kopya kütüphanede deneyin, sonra orijinal diskte uygulayın.</p>`, 'Değişikliklere izin ver');
  if (!ok) return false;
  await api('library/update', { readonly: false });
  await refreshState();
  renderTop();
  return true;
}

/* ------------------------------------------------------------------ */
/* Veri yükleme                                                        */
/* ------------------------------------------------------------------ */
async function refreshState() {
  S.state = await api('state');
  document.documentElement.dataset.theme = (S.state.prefs && S.state.prefs.theme) || 'dark';
}

async function loadTracks(force) {
  if (S.tracks && !force) return S.tracks;
  const d = await api('tracks');
  const cols = d.cols;
  const list = d.rows.map((r) => { const o = {}; cols.forEach((c, i) => { o[c] = r[i]; }); o.sev = worstSev(o.flags); o.qfold = o.search; return o; });
  const byId = new Map(list.map((t) => [t.id, t]));
  S.tracks = { list, byId };
  return S.tracks;
}
async function loadLists(force) {
  if (S.lists && !force) return S.lists;
  S.lists = await api('lists');
  return S.lists;
}
function listTree() {
  const rows = S.lists || [];
  const by = new Map();
  rows.forEach((r) => { const k = r.parent_id || 0; if (!by.has(k)) by.set(k, []); by.get(k).push(r); });
  const out = [];
  const walk = (pid, depth) => { (by.get(pid) || []).forEach((r) => { out.push({ ...r, depth }); walk(r.id, depth + 1); }); };
  walk(0, 0);
  return out;
}

/* ------------------------------------------------------------------ */
/* İskelet                                                             */
/* ------------------------------------------------------------------ */
const NAV = [
  ['genel', 'Genel bakış'], ['kutuphane', 'Kütüphane'], ['sorunlar', 'Sorunlar'], ['ciftler', 'Çiftler'], '-',
  ['etkinlikler', 'Etkinlikler'], ['listeler', 'Listeler'], '-',
  ['senkron', 'Serato ve Engine'], ['yeni', 'Yeni müzik ekle'], ['gecmis', 'Geçmiş ve yedekler'], ['ayarlar', 'Ayarlar'],
];

function renderNav() {
  const nav = $('#nav');
  const ov = S.ov;
  let crit = 0, dup = 0;
  if (ov) {
    crit = (ov.issues || []).filter((i) => i.severity === 'kritik').reduce((a, b) => a + b.count, 0) + (ov.engine.unicode || 0) + (ov.engine.sfm || 0);
    dup = ov.dupe_extra || 0;
  }
  nav.innerHTML = NAV.map((n) => {
    if (n === '-') return '<div class="sep"></div>';
    const [k, label] = n;
    let cnt = '';
    if (k === 'sorunlar' && crit) cnt = `<span class="cnt red">${fmtNum(crit)}</span>`;
    if (k === 'ciftler' && dup) cnt = `<span class="cnt amber">${fmtNum(dup)}</span>`;
    const on = S.route === k || (k === 'etkinlikler' && S.route === 'etkinlik') ? 'on' : '';
    return `<a href="#/${k}" class="${on}">${ic(k)}<span>${esc(label)}</span>${cnt}</a>`;
  }).join('');
  $('#side-foot').innerHTML = `Sürüm ${esc(window.DJD_VERSION)}<br>Dosyalar silinmez, her işlem geri alınabilir.`;
}

function renderTop() {
  const top = $('#top');
  const st = S.state;
  if (!st || !st.active) { top.innerHTML = '<span class="top-title">Hoş geldiniz</span>'; return; }
  const a = st.active;
  const libs = st.libraries || [];
  top.innerHTML = `<div class="libsel"><select id="libsel" title="Kütüphane">${libs.map((l) => `<option value="${esc(l.id)}" ${l.id === a.id ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}<option value="__add">Yeni kütüphane ekle…</option></select>
    <span class="faint small" title="${esc(a.root)}">${a.last_scan ? 'Son tarama: ' + fmtTime(+a.last_scan) : 'Henüz taranmadı'}</span></div>
    <div class="spacer"></div>
    <button class="ro-pill ${a.readonly ? '' : 'rw'}" id="ropill" title="Tıklayarak değiştirin"><i></i>${a.readonly ? 'Salt-okunur: diske yazılmaz' : 'Değişikliklere izinli'}</button>
    <button class="btn" id="scanbtn">${ic('scan')}Tara</button>`;
  $('#libsel').onchange = async (e) => {
    const v = e.target.value;
    if (v === '__add') { e.target.value = a.id; return addLibraryFlow(); }
    await api('library/select', { id: v });
    invalidate(); S.sel.clear();
    await refreshState(); render();
  };
  $('#scanbtn').onclick = () => startScan();
  $('#ropill').onclick = async () => {
    if (a.readonly) { await requireWritable('Düzeltme ve senkron işlemleri'); render(); }
    else {
      await api('library/update', { readonly: true });
      await refreshState(); renderTop(); toast('Salt-okunur mod açıldı: diske hiçbir şey yazılmayacak.', 'ok');
    }
  };
}

function startScan() {
  runTask('scan', {}, { title: 'Kütüphane taranıyor', toast: (r) => r && r.files != null ? `${fmtNum(r.files)} dosya tarandı (${fmtNum(r.read)} yeni/değişmiş okundu).` : 'Tarama bitti.' });
}

/* ------------------------------------------------------------------ */
/* Oynatıcı                                                            */
/* ------------------------------------------------------------------ */
const P = { id: null };
function renderPlayer() {
  $('#player').innerHTML = `<button class="pbtn" id="pplay" aria-label="Çal / durdur">${PLAY}</button>
    <div class="pinfo"><b id="ptitle">Ön dinleme</b><span id="partist">Bir parçanın ▶ düğmesine basın</span></div>
    <div class="seek"><span class="time" id="pcur">0:00</span><input type="range" id="pseek" min="0" max="1000" value="0" aria-label="Konum"><span class="time" id="pdur">0:00</span></div>
    <input type="range" id="pvol" min="0" max="100" value="80" style="width:90px" aria-label="Ses">`;
  const a = $('#audio');
  a.volume = 0.8;
  $('#pplay').onclick = () => { if (!a.src) return; if (a.paused) a.play(); else a.pause(); };
  $('#pseek').oninput = (e) => { if (a.duration) a.currentTime = (e.target.value / 1000) * a.duration; };
  $('#pvol').oninput = (e) => { a.volume = e.target.value / 100; };
  a.ontimeupdate = () => {
    $('#pcur').textContent = fmtDur(a.currentTime) || '0:00';
    $('#pdur').textContent = fmtDur(a.duration) || '0:00';
    if (a.duration) $('#pseek').value = Math.round((a.currentTime / a.duration) * 1000);
  };
  a.onplay = () => { $('#pplay').innerHTML = PAUSE; markPlaying(); };
  a.onpause = () => { $('#pplay').innerHTML = PLAY; markPlaying(); };
  a.onerror = () => { if (P.id) toast('Bu dosya tarayıcıda çalınamıyor (biçim desteklenmiyor olabilir).', 'err'); };
}
function play(id, t) {
  const a = $('#audio');
  if (P.id === id && a.src) { if (a.paused) a.play(); else a.pause(); return; }
  P.id = id;
  const tr = t || (S.tracks && S.tracks.byId.get(id)) || {};
  $('#ptitle').textContent = tr.title || tr.name || tr.disp || 'Parça';
  $('#partist').textContent = tr.artist || tr.folder || '';
  a.src = `/api/audio/${id}?t=${encodeURIComponent(TOKEN)}`;
  a.play().catch(() => {});
}
function markPlaying() { $$('[data-play]').forEach((b) => { b.innerHTML = (+b.dataset.play === P.id && !$('#audio').paused) ? PAUSE : PLAY; }); }
document.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && !/INPUT|TEXTAREA|SELECT|BUTTON/.test(document.activeElement.tagName) && $('#audio').src && !$('.modal-bg')) {
    e.preventDefault(); const a = $('#audio'); if (a.paused) a.play(); else a.pause();
  }
});

/* ------------------------------------------------------------------ */
/* Sanal tablo                                                          */
/* ------------------------------------------------------------------ */
function VTable(opts) {
  const rowH = opts.rowH || 32;
  const root = el('<div class="vt" tabindex="0"><div class="vt-head"></div><div class="vt-body"></div></div>');
  const head = $('.vt-head', root), body = $('.vt-body', root);
  let rows = opts.rows || [];
  let anchor = null;
  const sel = opts.sel || new Set();
  const cols = opts.cols;
  const sizeCols = () => {
    const avail = Math.max(0, root.clientWidth - 4);
    const fixed = cols.reduce((a, c) => a + (c.flex ? 0 : c.w), 0);
    cols.forEach((c) => { c._w = c.flex ? Math.max(c.min || 200, avail - fixed) : c.w; });
  };
  const renderHead = () => {
    sizeCols();
    head.innerHTML = cols.map((c) => `<div style="width:${c._w}px" data-k="${c.key}" class="${opts.sort && opts.sort.key === c.key ? 'sorted' : ''}" title="${esc(c.title || c.label)}">${esc(c.label)}${opts.sort && opts.sort.key === c.key ? (opts.sort.dir > 0 ? ' ▴' : ' ▾') : ''}</div>`).join('');
    $$('div', head).forEach((d) => {
      const c = cols.find((x) => x.key === d.dataset.k);
      if (!c || c.nosort || !opts.onSort) return;
      d.onclick = () => opts.onSort(c.key);
    });
  };
  const draw = () => {
    const top = root.scrollTop - 34, h = root.clientHeight;
    const first = Math.max(0, Math.floor(top / rowH) - 5), last = Math.min(rows.length, Math.ceil((top + h) / rowH) + 5);
    body.style.height = rows.length * rowH + 'px';
    let html = '';
    for (let i = first; i < last; i++) {
      const r = rows[i];
      html += `<div class="vt-row ${sel.has(r.id) ? 'sel' : ''} ${r.present === 0 ? 'miss' : ''}" data-i="${i}" style="top:${i * rowH}px;height:${rowH}px" draggable="${opts.drag ? 'true' : 'false'}">${cols.map((c) => `<div style="width:${c._w}px" class="${c.cls || ''}">${c.render(r)}</div>`).join('')}</div>`;
    }
    body.innerHTML = html;
    markPlaying();
  };
  const paintSel = () => { $$('.vt-row', body).forEach((r) => { const row = rows[+r.dataset.i]; r.classList.toggle('sel', !!row && sel.has(row.id)); }); };
  let raf = 0;
  root.addEventListener('scroll', () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(draw); });
  const onResize = () => { if (!root.isConnected) { window.removeEventListener('resize', onResize); return; } cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { renderHead(); draw(); }); };
  window.addEventListener('resize', onResize);
  body.addEventListener('click', (e) => {
    const pb = e.target.closest('[data-play]');
    if (pb) { e.stopPropagation(); play(+pb.dataset.play); return; }
    const rowEl = e.target.closest('.vt-row'); if (!rowEl) return;
    const i = +rowEl.dataset.i, r = rows[i];
    if (e.shiftKey && anchor != null) {
      const [a, b] = [Math.min(anchor, i), Math.max(anchor, i)];
      if (!(e.ctrlKey || e.metaKey)) sel.clear();
      for (let k = a; k <= b; k++) sel.add(rows[k].id);
    } else if (e.ctrlKey || e.metaKey) {
      if (sel.has(r.id)) sel.delete(r.id); else sel.add(r.id);
      anchor = i;
    } else { sel.clear(); sel.add(r.id); anchor = i; }
    paintSel();
    if (opts.onSel) opts.onSel(sel);
  });
  body.addEventListener('dblclick', (e) => {
    const rowEl = e.target.closest('.vt-row'); if (!rowEl || e.target.closest('[data-play]')) return;
    if (opts.onOpen) opts.onOpen(rows[+rowEl.dataset.i]);
  });
  body.addEventListener('dragstart', (e) => {
    const rowEl = e.target.closest('.vt-row'); if (!rowEl) return;
    const r = rows[+rowEl.dataset.i];
    if (!sel.has(r.id)) { sel.clear(); sel.add(r.id); paintSel(); if (opts.onSel) opts.onSel(sel); }
    e.dataTransfer.setData('text/djd-files', JSON.stringify([...sel]));
    e.dataTransfer.effectAllowed = 'copy';
  });
  root.addEventListener('keydown', (e) => {
    if (!rows.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      let i = anchor == null ? 0 : anchor + (e.key === 'ArrowDown' ? 1 : -1);
      i = Math.max(0, Math.min(rows.length - 1, i));
      sel.clear(); sel.add(rows[i].id); anchor = i;
      const y = i * rowH; if (y < root.scrollTop) root.scrollTop = y; else if (y + rowH * 2 > root.scrollTop + root.clientHeight) root.scrollTop = y - root.clientHeight + rowH * 2;
      draw(); if (opts.onSel) opts.onSel(sel);
    } else if (e.key === 'Enter' && anchor != null && opts.onOpen) opts.onOpen(rows[anchor]);
    else if ((e.key === 'p' || e.key === 'P') && anchor != null) play(rows[anchor].id);
    else if ((e.key === 'a' || e.key === 'A') && (e.ctrlKey || e.metaKey)) { e.preventDefault(); rows.forEach((r) => sel.add(r.id)); paintSel(); if (opts.onSel) opts.onSel(sel); }
  });
  renderHead();
  return {
    root,
    setRows(r) { rows = r; anchor = null; renderHead(); draw(); },
    redraw: () => { renderHead(); draw(); },
    scrollToId(id) { const i = rows.findIndex((r) => r.id === id); if (i >= 0) { root.scrollTop = Math.max(0, i * rowH - 120); anchor = i; sel.clear(); sel.add(id); draw(); } },
  };
}

/* ------------------------------------------------------------------ */
/* Yönlendirme                                                          */
/* ------------------------------------------------------------------ */
function parseRoute() {
  const h = (location.hash || '#/genel').replace(/^#\//, '');
  const [r, arg] = h.split('/');
  S.route = r || 'genel';
  S.routeArg = arg ? decodeURIComponent(arg) : null;
}
window.addEventListener('hashchange', () => { parseRoute(); render(); });

let renderSeq = 0;
async function render() {
  const seq = ++renderSeq;
  renderTop();
  const main = $('#main');
  if (!S.state || !S.state.active) { renderNav(); return viewWelcome(main); }
  try {
    if (!S.ov) S.ov = await api('overview');
  } catch (e) { main.innerHTML = `<div class="page"><div class="banner err">${esc(e.message)}</div><button class="btn" onclick="location.reload()">Yeniden dene</button></div>`; return; }
  if (seq !== renderSeq) return;
  renderNav();
  const views = { genel: viewOverview, kutuphane: viewLibrary, sorunlar: viewIssues, ciftler: viewDupes, listeler: viewLists,
    etkinlikler: viewEvents, etkinlik: viewEvent, senkron: viewSync, yeni: viewInbox, gecmis: viewHistory, ayarlar: viewSettings };
  const fn = views[S.route] || viewOverview;
  try { await fn(main, seq); } catch (e) { console.error(e); main.innerHTML = `<div class="page"><div class="banner err">${esc(e.message)}</div></div>`; }
}

/* ------------------------------------------------------------------ */
/* Karşılama + kütüphane ekleme                                         */
/* ------------------------------------------------------------------ */
function viewWelcome(main) {
  main.innerHTML = `<div class="welcome">
    <h1>Müzik kütüphanenizi bir kez taratın, gerisini birlikte düzenleyelim</h1>
    <p class="muted">Program Serato ve Engine DJ kütüphanelerinizi diskteki gerçek dosyalarla karşılaştırır: Prime 4'te neden bazı parçaların okunmadığını, hangi şarkının kaç kopyası olduğunu ve notlarınızın hangi kopyada durduğunu gösterir. Etkinlik listelerinizi burada hazırlayıp Engine'e ve Serato'ya gönderebilirsiniz.</p>
    <div class="promise">
      <div>${ic('check')}<span><b>İlk tarama yalnızca okur.</b> Kütüphane salt-okunur modda eklenir; siz izin vermeden diske tek bayt yazılmaz.</span></div>
      <div>${ic('check')}<span><b>Hiçbir dosya silinmez.</b> Kaldırılan kopyalar diskteki karantina klasörüne taşınır.</span></div>
      <div>${ic('check')}<span><b>Her değişiklik geri alınabilir.</b> Serato ve Engine dosyaları her işlemden önce yedeklenir.</span></div>
    </div>
    <button class="btn primary" id="addlib">${ic('folder')}Müzik klasörünü seç</button>
    <p class="faint small" style="margin-top:14px">İpucu: Önce masaüstündeki kopyayı seçerek denemeniz en güvenlisi.</p>
  </div>`;
  $('#addlib').onclick = addLibraryFlow;
}

function folderPicker(title, startPath) {
  return new Promise((resolve) => {
    const body = el(`<div><div class="row" style="margin-bottom:10px"><input type="text" id="fbpath" style="flex:1" placeholder="Klasör yolu (ör. D:\\ veya /Volumes/Serato DJ)"><button class="btn" id="fbgo">Git</button></div>
      <div class="row small muted" style="margin-bottom:8px"><span id="fbinfo"></span></div><div class="fb-list" id="fblist"></div></div>`);
    const m = modal({ title, body, wide: false, foot: `<span class="left" id="fbsel"></span><button class="btn" data-c>Vazgeç</button><button class="btn primary" data-ok disabled>Bu klasörü seç</button>`, onClose: () => resolve(null) });
    let cur = '';
    const load = async (p) => {
      let d;
      try { d = await api('browse' + (p ? '?path=' + encodeURIComponent(p) : '')); } catch (e) { toast(e.message, 'err'); return; }
      cur = d.path || '';
      $('#fbpath', body).value = cur;
      $('[data-ok]', m.root).disabled = !cur;
      $('#fbsel', m.root).textContent = cur ? '' : 'Bir disk veya klasör açın';
      $('#fbinfo', body).textContent = cur ? (d.audio_here ? `Bu klasörde doğrudan ${d.audio_here} ses dosyası var.` : 'Alt klasörlerdeki tüm müzikler taranır.') : 'Diskler ve sık kullanılan konumlar';
      const items = [];
      if (cur) items.push(`<a data-p="${esc(d.parent || '')}">${ic('up')}<span>Üst klasör</span></a>`);
      for (const x of d.dirs) items.push(`<a data-p="${esc(x.path)}">${ic('folder')}<span>${esc(x.label)}</span></a>`);
      $('#fblist', body).innerHTML = items.join('') || '<div class="empty">Alt klasör yok</div>';
      $$('#fblist a', body).forEach((a) => { a.onclick = () => load(a.dataset.p); });
    };
    $('#fbgo', body).onclick = () => load($('#fbpath', body).value.trim());
    $('#fbpath', body).addEventListener('keydown', (e) => { if (e.key === 'Enter') load(e.target.value.trim()); });
    $('[data-c]', m.root).onclick = () => m.close();
    $('[data-ok]', m.root).onclick = () => { resolve(cur); m.root.remove(); };
    load(startPath || '');
  });
}

async function addLibraryFlow() {
  const p = await folderPicker('Müzik klasörünü seçin');
  if (!p) return;
  const name = p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p;
  const body = el(`<div>
    <p class="muted">Seçilen klasör: <b>${esc(p)}</b></p>
    <label class="field"><span>Kütüphane adı</span><input type="text" id="lname" value="${esc(name)}"></label>
    <div class="field"><span>Program kendi kataloğunu (listeler, etkinlikler) nerede tutsun?</span>
      <label class="chk"><input type="radio" name="cat" value="pc" checked> Bu bilgisayarda (önerilen; diske hiçbir şey yazılmaz)</label>
      <label class="chk"><input type="radio" name="cat" value="disk"> Müzik diskinde <span class="muted">(Mac ve PC aynı listeleri görür; diske "_DJDoktor_" klasörü eklenir)</span></label></div>
    <label class="chk"><input type="checkbox" id="lro" checked> Salt-okunur başlat (önerilen)</label>
  </div>`);
  const m = modal({ title: 'Kütüphane ekle', body, foot: '<button class="btn" data-c>Vazgeç</button><button class="btn primary" data-ok>Ekle ve tara</button>' });
  $('[data-c]', m.root).onclick = () => m.close();
  $('[data-ok]', m.root).onclick = async () => {
    try {
      await api('library/add', { root: p, name: $('#lname', body).value, shared: $('input[name=cat]:checked', body).value === 'disk', readonly: $('#lro', body).checked });
    } catch (e) { showError(e.message); return; }
    m.root.remove();
    invalidate(); S.sel.clear();
    await refreshState();
    location.hash = '#/genel';
    render();
    startScan();
  };
}

/* ------------------------------------------------------------------ */
/* Genel bakış                                                          */
/* ------------------------------------------------------------------ */
async function viewOverview(main) {
  const o = S.ov, st = o.stats, info = o.info;
  if (!info.last_scan) {
    main.innerHTML = `<div class="page"><div class="empty"><h3>Bu kütüphane henüz taranmadı</h3><p>Tarama yalnızca okur: etiketler, ses imzaları, Serato crate'leri ve Engine veritabanı incelenir.</p><button class="btn primary" id="sc">${ic('scan')}Taramayı başlat</button></div></div>`;
    $('#sc').onclick = startScan;
    return;
  }
  const red = (o.engine.unicode || 0) + (o.engine.sfm || 0);
  const engTotal = Object.values(o.engine).reduce((a, b) => a + b, 0);
  let sentence = `${plural(st.audio, 'parça')}, ${fmtSize(st.size)}, toplam ${fmtLong(st.duration)} müzik.`;
  if (red) sentence += ` Engine kütüphanesindeki ${plural(engTotal, 'parçanın')} ${fmtNum(red)} tanesi Prime 4'te kırmızı/bulunamaz görünüyor.`;
  else if (engTotal) sentence += ' Engine kütüphanesindeki tüm yollar diskle uyumlu.';
  const sevCount = (sev) => (o.issues || []).filter((i) => i.severity === sev).reduce((a, b) => a + b.count, 0);
  main.innerHTML = `<div class="page">
    <div class="ov-head"><div><h1>${esc(info.name)}</h1><p>${esc(sentence)}</p></div><div class="spacer"></div>
      <button class="btn" id="rep">${ic('open')}Doktor raporunu aç</button></div>
    <div class="wave-wrap"><canvas id="wave" aria-label="Kütüphane sağlık şeridi"></canvas><div class="wave-tip hide" id="wtip"></div></div>
    <div class="wave-legend"><span><i class="led b"></i>Sorunsuz</span><span><i class="led a"></i>Uyarı</span><span><i class="led r"></i>Kritik (Prime 4/Windows'ta çalışmaz veya okunamaz)</span><span class="faint">Her çizgi bir parça; yükseklik süreyi gösterir. Tıklayınca kütüphanede açılır.</span></div>
    <div class="ov-cols">
      <div class="panel"><div class="ph"><h2>Önerilen sıra</h2></div><div class="pb"><ol class="steps" id="steps"></ol></div></div>
      <div class="panel"><div class="ph"><h2>Kütüphane özeti</h2></div><div class="pb"><dl class="facts" id="facts"></dl></div></div>
    </div></div>`;
  $('#rep').onclick = () => window.open('/report?t=' + encodeURIComponent(TOKEN), '_blank');
  const act = { engine: () => engineRepairFlow(), rename: () => renameFlow(), junk: () => junkFlow(), dupes: () => { location.hash = '#/ciftler'; }, events: () => { location.hash = '#/etkinlikler'; } };
  $('#steps').innerHTML = o.steps.map((s) => {
    const done = s.count === 0;
    const label = s.key === 'events' ? 'Etkinliklere git' : (s.key === 'dupes' ? 'Çiftleri gör' : 'Planı gör');
    return `<li class="${done ? 'done' : 'todo'}"><div><b>${esc(s.title)}${s.count ? ` <span class="tag">${fmtNum(s.count)}</span>` : ''}</b><div class="d">${esc(done ? 'Sorun yok.' : s.desc)}</div></div><button class="btn sm ${done ? 'ghost' : ''}" data-k="${s.key}" ${done ? 'disabled' : ''}>${label}</button></li>`;
  }).join('');
  $$('#steps [data-k]').forEach((b) => { b.onclick = () => act[b.dataset.k](); });
  const fm = Object.entries(st.formats || {}).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k.replace('.', '').toUpperCase()} ${fmtNum(v)}`).join(', ');
  const ser = o.serato || {};
  const serTotal = Object.values(ser).reduce((a, b) => a + b, 0);
  const facts = [
    ['Kendi notunuz olan', fmtNum(st.with_note)], ['Mixed In Key bilgili', fmtNum(st.with_mik)], ['Serato cue\'lu', fmtNum(st.with_cues)],
    ['Etiketsiz', fmtNum(st.no_tags)], ['Biçimler', fm], ['Çöp dosya', fmtNum(st.junk)],
    ['Çift grubu', `${fmtNum(Object.values(o.dupes).reduce((a, b) => a + b, 0))} (${fmtNum(o.dupe_extra)} gereksiz kopya)`],
    ['Kritik sorun', fmtNum(sevCount('kritik'))], ['Uyarı', fmtNum(sevCount('uyari'))],
  ];
  if (serTotal) facts.push(['Serato crate kayıtları', `${fmtNum(serTotal)}: ${fmtNum(ser.exact || 0)} doğru, ${fmtNum((ser.unicode || 0) + (ser.sfm || 0))} sadece Mac, ${fmtNum((ser.missing || 0) + (ser.nodir || 0))} bu diskte yok`]);
  if (engTotal) facts.push(['Engine parçaları', `${fmtNum(engTotal)}: ${fmtNum(o.engine.exact || 0)} doğru, ${fmtNum(red)} Prime 4'te kırmızı, ${fmtNum((o.engine.missing || 0) + (o.engine.nodir || 0))} bu diskte yok`]);
  facts.push(['Dosya sistemi', (info.fstype || 'bilinmiyor').toUpperCase()]);
  $('#facts').innerHTML = facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('');
  drawWave(o);
  loadTracks().catch(() => {});
}

function drawWave(o) {
  const cv = $('#wave'); if (!cv) return;
  const strip = o.strip || [];
  const dpr = window.devicePixelRatio || 1;
  const W = cv.clientWidth, H = cv.clientHeight;
  cv.width = W * dpr; cv.height = H * dpr;
  const g = cv.getContext('2d'); g.scale(dpr, dpr);
  const css = getComputedStyle(document.documentElement);
  const col = { 0: css.getPropertyValue('--blue').trim(), 1: css.getPropertyValue('--amber').trim(), 2: css.getPropertyValue('--red').trim() };
  const pad = 10, w = W - pad * 2, mid = H / 2;
  const n = strip.length; if (!n) return;
  const maxD = Math.max(60, ...strip.map((s) => Math.min(s[1], 1800)));
  const cols = Math.min(n, Math.floor(w));
  const per = n / cols, bw = w / cols;
  const buckets = [];
  for (let c = 0; c < cols; c++) {
    const a = Math.floor(c * per), b = Math.max(a + 1, Math.floor((c + 1) * per));
    let sev = 0, d = 0;
    for (let i = a; i < b && i < n; i++) { sev = Math.max(sev, strip[i][2]); d = Math.max(d, strip[i][1]); }
    buckets.push({ a, b, sev, d });
  }
  g.globalAlpha = 0.25; g.fillStyle = css.getPropertyValue('--line').trim(); g.fillRect(pad, mid - 0.5, w, 1); g.globalAlpha = 1;
  buckets.forEach((bk, c) => {
    const hh = Math.max(4, Math.sqrt(Math.min(bk.d, 1800) / maxD) * (H / 2 - 14));
    g.fillStyle = col[bk.sev];
    g.globalAlpha = bk.sev ? 1 : 0.85;
    g.fillRect(pad + c * bw, mid - hh, Math.max(1, bw - (bw > 3 ? 1 : 0)), hh * 2);
  });
  g.globalAlpha = 0.5; g.fillStyle = css.getPropertyValue('--faint').trim();
  let lastF = -1;
  buckets.forEach((bk, c) => { const f = strip[bk.a][3]; if (f !== lastF) { g.fillRect(pad + c * bw, H - 6, 1, 6); lastF = f; } });
  g.globalAlpha = 1;
  const tip = $('#wtip');
  cv.onmousemove = (e) => {
    const r = cv.getBoundingClientRect(); const x = e.clientX - r.left - pad;
    const c = Math.max(0, Math.min(cols - 1, Math.floor(x / bw))); const bk = buckets[c]; const s = strip[bk.a];
    const t = S.tracks && S.tracks.byId.get(s[0]);
    const folder = o.folders[s[3]];
    tip.innerHTML = `<b>${esc(t ? (t.title || t.name) : folder)}</b><br><span class="muted">${esc(folder)}${bk.b - bk.a > 1 ? ` · ${bk.b - bk.a} parça` : ''}</span>`;
    tip.style.left = (e.clientX - r.left) + 'px'; tip.style.top = (e.clientY - r.top) + 'px';
    tip.classList.remove('hide');
  };
  cv.onmouseleave = () => tip.classList.add('hide');
  cv.onclick = (e) => {
    const r = cv.getBoundingClientRect(); const x = e.clientX - r.left - pad;
    const c = Math.max(0, Math.min(cols - 1, Math.floor(x / bw))); const s = strip[buckets[c].a];
    S.lib.folder = ''; S.lib.quick = 'all'; S.lib.q = ''; S.focusTrack = s[0];
    location.hash = '#/kutuphane';
  };
}

/* ------------------------------------------------------------------ */
/* Kütüphane                                                            */
/* ------------------------------------------------------------------ */
const QUICK = [
  ['all', 'Tüm parçalar', () => true],
  ['issues', 'Sorunlu', (t) => t.sev === 'kritik' || t.sev === 'uyari'],
  ['red', "Prime 4'te kırmızı", (t) => t.estat === 'unicode' || t.estat === 'sfm' || (t.flags || []).some((f) => ISSUE_SEV[f] === 'kritik')],
  ['note', 'Kendi notu olan', (t) => !!t.note],
  ['nonote', 'Notu olmayan', (t) => !t.note],
  ['dupes', 'Çift kopyalar', (t) => (t.flags || []).some((f) => f.startsWith('dup_') || f === 'engine_copy')],
  ['noengine', "Engine'de olmayan", (t) => !t.estat],
  ['serato', 'Serato listesinde', (t) => t.serato > 0],
  ['nolist', 'Hiçbir listede değil', (t) => !t.serato && !t.engine && !t.lists],
  ['cues', "Cue'lu", (t) => t.cues > 0],
  ['lowbr', 'Düşük kalite', (t) => (t.flags || []).includes('audio_lowbr')],
];
const CAMS = []; for (let n = 1; n <= 12; n++) { CAMS.push(n + 'A'); CAMS.push(n + 'B'); }

function trackCols() {
  return [
    { key: 'play', label: '', w: 40, nosort: true, render: (t) => `<button class="play" data-play="${t.id}" title="Ön dinle">${PLAY}</button>` },
    { key: 'folder', label: 'Parça ve klasörü', flex: true, min: 240, title: 'Sıralama: klasöre göre', render: (t) => `<div class="tt" title="${esc(t.disp)}"><span class="t1">${esc(t.title || t.name)}</span><span class="t3">${esc(t.folder || '(kök)')}</span></div>` },
    { key: 'artist', label: 'Sanatçı', w: 150, render: (t) => `<span class="t2">${esc(t.artist)}</span>` },
    { key: 'bpm', label: 'BPM', w: 52, cls: 'num', render: (t) => t.bpm ? esc(Math.round(t.bpm)) : '' },
    { key: 'camelot', label: 'Ton', w: 50, render: (t) => t.camelot ? `<span class="cam">${esc(t.camelot)}</span>` : '' },
    { key: 'duration', label: 'Süre', w: 56, cls: 'num', render: (t) => fmtDur(t.duration) },
    { key: 'note', label: 'Notunuz', w: 170, render: (t) => `<span class="note-cell" title="${esc(t.comment)}">${esc(t.note)}</span>` },
    { key: 'bitrate', label: 'Kalite', w: 64, cls: 'num', render: (t) => ['.flac', '.wav', '.aif', '.aiff'].includes(t.ext) ? esc(t.ext.slice(1).toUpperCase()) : (t.bitrate ? t.bitrate + ' k' : '') },
    { key: 'status', label: 'Durum', w: 66, nosort: true, title: 'Serato / Engine / Sorun', render: statusLeds },
  ];
}
function statusLeds(t) {
  const s = t.serato > 0 ? ['g', `Serato'da ${t.serato} crate'te`] : ['', "Serato crate'inde değil"];
  const em = { exact: ['g', 'Engine: doğru yol'], case: ['g', 'Engine: doğru'], unicode: ['r', "Engine: Prime 4'te kırmızı (Türkçe harf biçimi)"], sfm: ['r', "Engine: Prime 4'te kırmızı (Mac karakteri)"], missing: ['a', 'Engine: kayıp'] }[t.estat] || ['', "Engine'de yok"];
  const iv = { kritik: 'r', uyari: 'a', bilgi: 'b' }[t.sev] || 'g';
  const it = (t.flags || []).map((f) => ISSUE_SHORT[f] || f).join(', ') || 'Sorun yok';
  return `<span title="${esc(s[1])}"><i class="led ${s[0]}"></i></span> <span title="${esc(em[1])}"><i class="led ${em[0]}"></i></span> <span title="${esc(it)}"><i class="led ${iv}"></i></span>`;
}

function filterTracks(list) {
  const f = S.lib;
  const qf = QUICK.find((q) => q[0] === f.quick) || QUICK[0];
  const toks = fold(f.q).split(/\s+/).filter(Boolean);
  const bmin = parseFloat(f.bpmMin), bmax = parseFloat(f.bpmMax);
  return list.filter((t) => {
    if (t.present === 0 && f.quick !== 'all') return false;
    if (!qf[2](t)) return false;
    if (f.folder && !(t.folder === f.folder || t.folder.startsWith(f.folder + '/'))) return false;
    if (!isNaN(bmin) && !(t.bpm >= bmin)) return false;
    if (!isNaN(bmax) && !(t.bpm <= bmax)) return false;
    if (f.key && t.camelot !== f.key) return false;
    for (const k of toks) if (!t.qfold.includes(k)) return false;
    return true;
  });
}
function sortTracks(rows) {
  const { key, dir } = S.lib.sort;
  const v = (t) => {
    if (key === 'folder') return fold(t.folder + '/' + (t.title || t.name));
    if (key === 'title') return fold(t.title || t.name);
    if (['bpm', 'duration', 'bitrate'].includes(key)) return t[key] || 0;
    if (key === 'camelot') { const m = /^(\d+)([AB])$/.exec(t.camelot || ''); return m ? (+m[1]) * 2 + (m[2] === 'B' ? 1 : 0) : 99; }
    return fold(t[key] || '');
  };
  return rows.slice().sort((a, b) => { const x = v(a), y = v(b); return (x < y ? -1 : x > y ? 1 : 0) * dir; });
}

async function viewLibrary(main) {
  main.innerHTML = '<div class="boot">Parçalar yükleniyor…</div>';
  const T = await loadTracks();
  const list = T.list;
  const counts = {}; QUICK.forEach((q) => { counts[q[0]] = list.filter((t) => t.present !== 0 && q[2](t)).length; });
  const fol = (S.ov && null) || await api('folders');
  main.innerHTML = `<div class="lib">
    <div class="lib-side">
      <h3>Hızlı filtre</h3><div class="qf">${QUICK.map((q) => `<a data-q="${q[0]}" class="${S.lib.quick === q[0] ? 'on' : ''}">${esc(q[1])}<span class="n">${fmtNum(counts[q[0]])}</span></a>`).join('')}</div>
      <h3>Klasörler</h3><div class="ft"><a data-f="" class="${!S.lib.folder ? 'on' : ''}">Tümü<span class="n">${fmtNum(fol.total)}</span></a>${fol.folders.map((x) => `<a data-f="${esc(x.path)}" class="${S.lib.folder === x.path ? 'on' : ''}" style="padding-left:${8 + x.depth * 12}px" title="${esc(x.disp)}">${esc(x.disp.split('/').pop())}<span class="n">${fmtNum(x.n)}</span></a>`).join('')}</div>
    </div>
    <div class="lib-main">
      <div class="lib-tools">
        <input type="search" id="q" placeholder="Ara: ad, sanatçı, not, tür, klasör… (Türkçe harf duyarsız)" value="${esc(S.lib.q)}">
        <span class="bpm muted small">BPM <input type="number" id="bmin" placeholder="min" value="${esc(S.lib.bpmMin)}"> – <input type="number" id="bmax" placeholder="maks" value="${esc(S.lib.bpmMax)}"></span>
        <select id="kf" title="Ton"><option value="">Tüm tonlar</option>${CAMS.map((c) => `<option ${S.lib.key === c ? 'selected' : ''}>${c}</option>`).join('')}</select>
        <span class="spacer"></span><span class="muted small" id="cnt"></span>
      </div>
      <div id="tbl" style="flex:1;min-height:0;display:flex;flex-direction:column"></div>
      <div class="selbar hide" id="selbar"><b id="selcnt"></b><button class="btn sm primary" id="addto">${ic('plus')}Listeye / etkinliğe ekle</button><button class="btn sm" id="detail">Ayrıntılar</button><button class="btn sm" id="showf">${ic('folder')}Klasörde göster</button><span class="spacer"></span><button class="btn sm ghost" id="clr">Seçimi temizle</button></div>
    </div></div>`;
  const vt = VTable({
    cols: trackCols(), rows: [], sel: S.sel, drag: true, sort: S.lib.sort, rowH: 42,
    onSort: (k) => { S.lib.sort = { key: k, dir: S.lib.sort.key === k ? -S.lib.sort.dir : 1 }; refresh(); },
    onSel: () => updSel(), onOpen: (t) => openTrack(t.id),
  });
  vt.root.style.flex = '1';
  $('#tbl').appendChild(vt.root);
  const refresh = () => {
    const rows = sortTracks(filterTracks(list));
    $('#cnt').textContent = `${fmtNum(rows.length)} parça`;
    vt.setRows(rows);
  };
  const updSel = () => {
    const n = S.sel.size;
    $('#selbar').classList.toggle('hide', !n);
    $('#selcnt').textContent = `${fmtNum(n)} parça seçili`;
  };
  $$('.qf a').forEach((a) => { a.onclick = () => { S.lib.quick = a.dataset.q; $$('.qf a').forEach((x) => x.classList.toggle('on', x === a)); refresh(); }; });
  $$('.ft a').forEach((a) => { a.onclick = () => { S.lib.folder = a.dataset.f; $$('.ft a').forEach((x) => x.classList.toggle('on', x === a)); refresh(); }; });
  let qt = 0;
  $('#q').oninput = (e) => { clearTimeout(qt); qt = setTimeout(() => { S.lib.q = e.target.value; refresh(); }, 120); };
  $('#bmin').oninput = (e) => { S.lib.bpmMin = e.target.value; refresh(); };
  $('#bmax').oninput = (e) => { S.lib.bpmMax = e.target.value; refresh(); };
  $('#kf').onchange = (e) => { S.lib.key = e.target.value; refresh(); };
  $('#addto').onclick = (e) => addToMenu(e.currentTarget, [...S.sel]);
  $('#detail').onclick = () => { const id = [...S.sel][0]; if (id) openTrack(id); };
  $('#showf').onclick = async () => { const id = [...S.sel][0]; if (!id) return; const d = await api('track/' + id); api('open', { path: d.file.abs, select: true }).catch((e) => toast(e.message, 'err')); };
  $('#clr').onclick = () => { S.sel.clear(); vt.redraw(); updSel(); };
  refresh(); updSel();
  if (S.focusTrack) { const id = S.focusTrack; S.focusTrack = null; setTimeout(() => { vt.scrollToId(id); updSel(); openTrack(id); }, 30); }
  vt.root.focus();
}

async function addToMenu(anchor, fileIds) {
  if (!fileIds.length) return;
  await loadLists();
  const tree = listTree().filter((r) => r.kind !== 'folder' || true);
  const items = [{ label: 'Yeni liste oluştur ve ekle…', icon: 'plus', action: async () => {
    const name = await promptBox('Yeni liste', 'Liste adı', 'Yeni liste'); if (!name) return;
    const r = await api('lists/create', { kind: 'list', title: name });
    await addFiles(r.id, fileIds, name);
  } }, '-'];
  if (!tree.length) items.push({ head: 'Henüz liste yok' });
  for (const r of tree) {
    if (r.kind === 'folder' || r.kind === 'event') { items.push({ label: r.title, icon: r.kind === 'event' ? 'etkinlikler' : 'folder', depth: r.depth, hint: r.kind === 'event' ? 'etkinlik' : '', action: () => { if (r.kind === 'event') { location.hash = '#/etkinlik/' + r.id; } } }); continue; }
    items.push({ label: r.title, icon: r.kind === 'section' ? 'section' : 'list', depth: r.depth, hint: String(r.n), action: () => addFiles(r.id, fileIds, r.title) });
  }
  openMenu(anchor, items);
}
async function addFiles(listId, fileIds, title) {
  try {
    const r = await api(`lists/${listId}/add`, { file_ids: fileIds });
    S.lists = null;
    toast(`${fmtNum(r.added)} parça "${title}" listesine eklendi${r.skipped ? ` (${r.skipped} tanesi zaten vardı)` : ''}.`, 'ok');
  } catch (e) { showError(e.message); }
}

/* ------------------------------------------------------------------ */
/* Parça ayrıntısı                                                      */
/* ------------------------------------------------------------------ */
async function openTrack(id) {
  let d;
  try { d = await api('track/' + id); } catch (e) { toast(e.message, 'err'); return; }
  const f = d.file;
  const root = $('#drawer-root');
  const stem = (f.name || '').replace(/\.[^.]+$/, '');
  const issues = d.issues.map((i) => `<div style="margin-bottom:8px"><span class="sev ${i.severity}">${esc(i.title)}</span><div class="small muted" style="margin-top:3px">${esc(i.desc)}</div>${i.fix ? `<div class="small" style="margin-top:2px">Çözüm: ${esc(i.fix)}</div>` : ''}</div>`).join('') || '<p class="muted">Sorun yok.</p>';
  const cues = d.markers && d.markers.cues && d.markers.cues.length ? d.markers.cues.map((c) => `<span class="cue"><i style="background:${esc(c.color)}"></i>${c.i + 1}: ${fmtDur(c.ms / 1000) || '0:00'}${c.name ? ' ' + esc(c.name) : ''}</span>`).join('') : '<span class="muted">Serato cue noktası yok.</span>';
  const refs = d.ext_refs.map((r) => {
    const m = MATCH[r.match] || [r.match, '', ''];
    const src = r.src === 'serato' ? 'Serato veritabanı' : (r.src === 'engine:drive' ? 'Engine (disk)' : 'Engine (bilgisayar)');
    const extra = r.info && r.info.comment && r.info.comment !== f.comment ? `<div class="small muted">Oradaki yorum: ${esc(r.info.comment)}</div>` : '';
    return `<div style="margin-bottom:8px"><i class="led ${m[1]}"></i> <b>${esc(src)}</b>: ${esc(m[0])} <span class="muted small">(${esc(m[2])})</span>${extra}</div>`;
  }).join('') || '<p class="muted">Serato veritabanında veya Engine\'de kaydı yok.</p>';
  const mem = d.membership.map((m) => `<div><span class="tag">${m.src === 'serato' ? 'Serato' : 'Engine'}</span> ${esc(m.path)}</div>`).join('') + d.lists.map((l) => `<div><span class="tag">Liste</span> ${esc(l)}</div>`).join('') || '<p class="muted">Hiçbir listede değil.</p>';
  let dup = '';
  if (d.dupe_group) {
    const g = d.dupe_group;
    const kind = { exact: 'Birebir aynı kopyalar', audio: 'Aynı ses, farklı etiketli kopyalar', song: 'Muhtemelen aynı şarkının başka kayıtları' }[g.kind];
    dup = `<section><h3>${esc(kind)}</h3>${g.members.map((m) => `<div style="margin-bottom:6px" class="${m.id === f.id ? '' : ''}"><span class="led ${m.keeper ? 'g' : 'w'}"></span> <span class="path">${esc(m.rel)}</span><div class="small muted">${m.keeper ? 'Önerilen (tutulacak) · ' : ''}${esc(m.reasons.join(', ') || '—')}</div></div>`).join('')}<button class="btn sm" id="godup">Çiftler sayfasında aç</button></section>`;
  }
  const lossless = ['.flac', '.wav', '.aif', '.aiff'].includes(f.ext);
  root.innerHTML = `<div class="drawer" role="dialog" aria-label="Parça ayrıntısı">
    <div class="dh"><button class="pbtn btn primary icon" id="dplay" style="border-radius:50%;width:38px;height:38px;justify-content:center">${PLAY}</button>
      <div style="flex:1;min-width:0"><h2>${esc(f.title || stem)}</h2><div class="muted">${esc(f.artist || 'Sanatçı etiketi yok')}</div></div>
      <button class="btn ghost icon" id="dclose" aria-label="Kapat">${ic('x')}</button></div>
    <div class="db">
      <section><h3>Notunuz</h3>${f.note ? `<div class="mynote">${esc(f.note)}</div>` : '<p class="muted">Bu kopyada kendi notunuz yok.</p>'}
        <dl class="kv" style="margin-top:8px"><dt>Yorum alanı</dt><dd>${esc(f.comment || '—')}</dd>${f.mik_key ? `<dt>Mixed In Key</dt><dd>${esc(f.mik_key)}${f.mik_energy ? ', enerji ' + f.mik_energy : ''}</dd>` : ''}</dl></section>
      <section><h3>Bilgiler</h3><dl class="kv">
        <dt>BPM</dt><dd>${f.bpm ? Math.round(f.bpm * 10) / 10 : '—'}</dd><dt>Ton</dt><dd>${esc(f.camelot || '—')} ${f.key_raw && f.key_raw !== f.camelot ? `<span class="muted">(${esc(f.key_raw)})</span>` : ''}</dd>
        <dt>Süre</dt><dd>${fmtDur(f.duration) || '—'}</dd><dt>Kalite</dt><dd>${lossless ? 'Kayıpsız ' : ''}${f.bitrate ? f.bitrate + ' kbps' : ''} ${f.sample_rate ? (f.sample_rate / 1000).toString().replace('.', ',') + ' kHz' : ''} ${esc((f.ext || '').slice(1).toUpperCase())} ${fmtSize(f.size)}</dd>
        <dt>Albüm</dt><dd>${esc(f.album || '—')}</dd><dt>Tür</dt><dd>${esc(f.genre || '—')}</dd>${f.year ? `<dt>Yıl</dt><dd>${f.year}</dd>` : ''}
        <dt>Konum</dt><dd class="path">${esc(f.disp)}</dd></dl>
        <div class="row" style="margin-top:10px"><button class="btn sm" id="dshow">${ic('folder')}Klasörde göster</button><button class="btn sm" id="dadd">${ic('plus')}Listeye ekle</button></div></section>
      <section><h3>Serato cue noktaları</h3>${cues}</section>
      <section><h3>Sorunlar</h3>${issues}</section>
      ${dup}
      <section><h3>DJ programlarındaki kaydı</h3>${refs}</section>
      <section><h3>Bulunduğu listeler</h3>${mem}</section>
    </div></div>`;
  const close = () => { root.innerHTML = ''; document.removeEventListener('keydown', esck); };
  const esck = (e) => { if (e.key === 'Escape' && !$('.modal-bg')) close(); };
  document.addEventListener('keydown', esck);
  $('#dclose').onclick = close;
  $('#dplay').onclick = () => play(f.id, f);
  $('#dshow').onclick = () => api('open', { path: f.abs, select: true }).catch((e) => toast(e.message, 'err'));
  $('#dadd').onclick = (e) => addToMenu(e.currentTarget, [f.id]);
  const gd = $('#godup'); if (gd) gd.onclick = () => { close(); location.hash = '#/ciftler'; };
}

/* ------------------------------------------------------------------ */
/* Sorunlar                                                             */
/* ------------------------------------------------------------------ */
async function viewIssues(main) {
  if (!S.issues) S.issues = await api('issues');
  const items = S.issues.items;
  const o = S.ov;
  const red = (o.engine.unicode || 0) + (o.engine.sfm || 0);
  const actions = {
    name_badchar: ['Ad düzeltme planı', renameFlow], name_trailing: ['Ad düzeltme planı', renameFlow], name_reserved: ['Ad düzeltme planı', renameFlow], name_nfd: ['Ad düzeltme planı', renameFlow],
    name_emoji: ['Emojileri temizle', () => renameFlow(true)], junk_appledouble: ['Karantina planı', junkFlow], junk_other: ['Karantina planı', junkFlow],
    dup_exact: ['Çiftlere git', () => { location.hash = '#/ciftler'; }], dup_audio: ['Çiftlere git', () => { location.hash = '#/ciftler'; }], dup_song: ['Çiftlere git', () => { location.hash = '#/ciftler'; }], engine_copy: ['Çiftlere git', () => { location.hash = '#/ciftler'; }],
  };
  let html = `<div class="page"><div class="page-head"><div><h1>Sorunlar</h1><p class="lead">Kritik olanlar parçanın Prime 4'te veya Windows'ta çalmamasına yol açar. Her başlığın altında nedeni ve çözümü yazıyor.</p></div></div>`;
  if (red) html += `<div class="banner err"><i class="led r"></i><div style="flex:1"><b>Prime 4'te ${fmtNum(red)} parça kırmızı/bulunamaz görünür.</b> Engine veritabanındaki yollar Mac'in yazdığı biçimde; diskteki adlarla bayt bayt aynı değil.</div><button class="btn sm primary" id="erep">Onarım planı</button></div>`;
  if (!items.length) html += '<div class="empty"><h3>Sorun bulunamadı</h3><p>Kütüphaneniz temiz görünüyor.</p></div>';
  html += items.map((it, i) => `<div class="panel" style="margin-bottom:12px"><div class="ph"><span class="sev ${it.severity}">${{ kritik: 'Kritik', uyari: 'Uyarı', bilgi: 'Bilgi' }[it.severity]}</span><h3 style="flex:1">${esc(it.title)}</h3><span class="tag">${fmtNum(it.count)} dosya</span>${actions[it.code] ? `<button class="btn sm primary" data-a="${it.code}">${esc(actions[it.code][0])}</button>` : ''}<button class="btn sm" data-show="${it.code}" data-i="${i}">Dosyaları göster</button></div>
    <div class="pb"><p>${esc(it.desc)}</p>${it.fix ? `<p class="muted small">Çözüm: ${esc(it.fix)}</p>` : ''}<div class="hide" id="iss-${i}"></div></div></div>`).join('');
  html += '</div>';
  main.innerHTML = html;
  const er = $('#erep'); if (er) er.onclick = () => engineRepairFlow();
  $$('[data-a]', main).forEach((b) => { b.onclick = () => actions[b.dataset.a][1](); });
  $$('[data-show]', main).forEach((b) => {
    b.onclick = async () => {
      const box = $('#iss-' + b.dataset.i);
      if (!box.classList.contains('hide')) { box.classList.add('hide'); return; }
      const files = await api('issue/' + b.dataset.show);
      box.innerHTML = `<div class="scrollbox"><table class="t"><tbody>${files.map((f) => `<tr><td>${f.kind === 'audio' ? `<button class="btn ghost icon sm" data-play="${f.id}">${PLAY}</button>` : ''}</td><td class="path">${esc(f.disp)}</td><td class="num muted">${fmtSize(f.size)}</td><td>${f.kind === 'audio' ? `<button class="btn sm ghost" data-open="${f.id}">Ayrıntı</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`;
      box.classList.remove('hide');
      $$('[data-play]', box).forEach((p) => { p.onclick = () => play(+p.dataset.play); });
      $$('[data-open]', box).forEach((p) => { p.onclick = () => openTrack(+p.dataset.open); });
    };
  });
}

/* ------------------------------------------------------------------ */
/* Düzeltme akışları (plan → onay → görev)                              */
/* ------------------------------------------------------------------ */
async function engineRepairFlow() {
  let plan;
  try { plan = await api('engine/repair-plan?key=drive'); } catch (e) { showError(e.message); return; }
  const fx = plan.fixes;
  if (!fx.length) { modal({ title: 'Engine yol onarımı', body: '<p>Onarılacak yol yok. Engine veritabanındaki tüm bulunabilen parçaların yolu diskle birebir aynı.</p>' }); return; }
  const cls = { unicode: 'Türkçe harf biçimi', sfm: "Mac'e özel karakter", case: 'Büyük/küçük harf' };
  const body = `<p><b>${fmtNum(fx.length)} parçanın</b> Engine'deki yolu, diskteki gerçek adla aynı olacak şekilde yeniden yazılacak. Müzik dosyalarına dokunulmaz; yalnızca <code>Engine Library/Database2/m.db</code> değişir ve önce bilgisayarınıza yedeklenir.</p>
    <p class="muted small">${Object.entries(plan.by_class).filter((x) => x[1]).map(([k, v]) => `${cls[k]}: ${fmtNum(v)}`).join(' &nbsp; ')}${plan.conflicts.length ? ` &nbsp; Çakışma nedeniyle atlanacak: ${plan.conflicts.length}` : ''}</p>
    <div class="scrollbox"><table class="t"><thead><tr><th>Parça</th><th>Sorun</th></tr></thead><tbody>${fx.slice(0, 400).map((f) => `<tr><td><b>${esc(f.title || f.new_disp.split('/').pop())}</b><div class="path">${esc(f.new_disp.replace(/^\.\.\//, ''))}</div></td><td><span class="sev kritik">${esc(cls[f.match] || f.match)}</span></td></tr>`).join('')}</tbody></table></div>
    <p class="small muted" style="margin-top:10px">Onarımdan önce Engine DJ'i tamamen kapatın. Mac'te Engine DJ bu yolları yine açar; Prime 4 ve Windows ise artık bulur.</p>`;
  const m = modal({ title: 'Engine yol onarımı', body, wide: true, foot: `<button class="btn" data-c>Vazgeç</button><button class="btn primary" data-ok>Onarımı uygula</button>` });
  $('[data-c]', m.root).onclick = () => m.close();
  $('[data-ok]', m.root).onclick = async () => {
    m.root.remove();
    if (!(await requireWritable('Engine yol onarımı'))) return;
    runTask('engine/repair', { key: 'drive' }, { title: 'Engine yolları onarılıyor', toast: (r) => r ? `${fmtNum(r.fixed)} yol onarıldı. Yedek alındı; Geçmiş sayfasından geri alabilirsiniz.` : 'Bitti' });
  };
}

async function renameFlow(emoji) {
  let plan;
  try { plan = await api('plan/rename' + (emoji ? '?emoji=1' : '')); } catch (e) { showError(e.message); return; }
  if (!plan.renames.length) { modal({ title: 'Güvenli ad düzeltme', body: '<p>Düzeltilecek ad yok.</p>' }); return; }
  const body = `<p><b>${fmtNum(plan.renames.length)} ad</b> düzeltilecek; bundan <b>${fmtNum(plan.files.length)} dosyanın</b> yolu etkilenir. Türkçe harfler korunur, sadece sorunlu işaretler değişir. Serato crate'leri, Serato veritabanı ve Engine veritabanındaki yollar birlikte güncellenir (önce yedek alınır).</p>
    <div class="scrollbox"><table class="t"><thead><tr><th>Klasör</th><th>Eski ad</th><th>Yeni ad</th></tr></thead><tbody>${plan.renames.map((r) => `<tr><td class="path">${esc(r.parent || '(kök)')}</td><td>${esc(r.old)}</td><td><b>${esc(r.new)}</b></td></tr>`).join('')}</tbody></table></div>
    <label class="chk" style="margin-top:12px"><input type="checkbox" id="remoji" ${emoji ? 'checked' : ''}> Adlardaki emojileri de temizle</label>
    <p class="small muted" style="margin-top:10px">Serato DJ ve Engine DJ kapalı olmalı. Geçmiş sayfasından tek tıkla geri alınabilir.</p>`;
  const m = modal({ title: 'Güvenli ad düzeltme', body, wide: true, foot: `<button class="btn" data-c>Vazgeç</button><button class="btn primary" data-ok>Adları düzelt</button>` });
  $('#remoji', m.root).onchange = (e) => { m.root.remove(); renameFlow(e.target.checked); };
  $('[data-c]', m.root).onclick = () => m.close();
  $('[data-ok]', m.root).onclick = async () => {
    const em = $('#remoji', m.root).checked;
    m.root.remove();
    if (!(await requireWritable('Ad düzeltme'))) return;
    runTask('ops/rename', { emoji: em }, { title: 'Adlar düzeltiliyor', toast: (r) => r ? `${fmtNum(r.renamed)} ad düzeltildi, ${fmtNum(r.files)} dosyanın yolu güncellendi.` : 'Bitti' });
  };
}

async function junkFlow() {
  let plan;
  try { plan = await api('plan/junk'); } catch (e) { showError(e.message); return; }
  if (!plan.files.length) { modal({ title: 'Çöp dosyalar', body: '<p>Çöp dosya yok.</p>' }); return; }
  const body = `<p><b>${fmtNum(plan.files.length)} dosya</b> (${fmtSize(plan.total_size)}) diskteki <code>_DJDoktor_Karantina</code> klasörüne taşınacak. Silinmez; Geçmiş sayfasından geri alınabilir ya da karantina klasörünü inceledikten sonra kendiniz silebilirsiniz.</p>
    <div class="scrollbox"><table class="t"><tbody>${plan.files.slice(0, 500).map((f) => `<tr><td class="path">${esc(f.disp)}</td><td class="num muted">${fmtSize(f.size)}</td></tr>`).join('')}</tbody></table></div>`;
  const m = modal({ title: 'Mac çöp dosyaları', body, wide: true, foot: `<button class="btn" data-c>Vazgeç</button><button class="btn primary" data-ok>Karantinaya taşı</button>` });
  $('[data-c]', m.root).onclick = () => m.close();
  $('[data-ok]', m.root).onclick = async () => {
    m.root.remove();
    if (!(await requireWritable('Çöp dosyaları taşıma'))) return;
    runTask('ops/junk', {}, { title: 'Çöp dosyalar taşınıyor', toast: (r) => r ? `${fmtNum(r.moved)} dosya karantinaya taşındı.` : 'Bitti' });
  };
}

/* ------------------------------------------------------------------ */
/* Çiftler                                                              */
/* ------------------------------------------------------------------ */
async function viewDupes(main) {
  if (!S.dupes) S.dupes = await api('dupes');
  const groups = S.dupes;
  const KIND = { exact: 'Birebir aynı dosya', audio: 'Aynı ses, farklı etiket', song: 'Muhtemelen aynı şarkı (farklı kayıt)' };
  const counts = { all: groups.length, exact: 0, audio: 0, song: 0 };
  groups.forEach((g) => counts[g.kind]++);
  const vis = groups.filter((g) => S.dupFilter === 'all' || g.kind === S.dupFilter);
  const selN = Object.keys(S.dupSel).length;
  const rmN = Object.values(S.dupSel).reduce((a, s) => a + s.remove.length, 0);
  main.innerHTML = `<div class="page"><div class="page-head"><div><h1>Çiftler</h1><p class="lead">Her grupta yeşil satır önerilen (tutulacak) kopyadır: Serato/Engine listelerinde kullanılan, notu ve cue'su olan kopya öne çıkar. Diğerleri karantinaya taşınır; listeler otomatik olarak tutulan kopyaya yönlenir.</p></div></div>
    <div class="row" style="margin-bottom:14px">
      <select id="dk">${['all', 'exact', 'audio', 'song'].map((k) => `<option value="${k}" ${S.dupFilter === k ? 'selected' : ''}>${k === 'all' ? 'Tüm gruplar' : KIND[k]} (${counts[k]})</option>`).join('')}</select>
      <button class="btn" id="dauto">Kesin çiftlerde önerileri işaretle</button><button class="btn ghost" id="dnone">İşaretleri kaldır</button>
      <span class="spacer"></span><span class="muted">${selN ? `${selN} grup, ${rmN} kopya seçili` : 'Grup seçilmedi'}</span>
      <button class="btn primary" id="dgo" ${rmN ? '' : 'disabled'}>Seçilenleri birleştir</button></div>
    <div id="dl">${vis.length ? '' : '<div class="empty"><h3>Çift bulunamadı</h3></div>'}</div></div>`;
  const dl = $('#dl');
  vis.slice(0, 300).forEach((g) => {
    const s = S.dupSel[g.id];
    const keeper = s ? s.keeper : g.keeper;
    const warn = g.keeper_missing && g.keeper_missing.length ? `<span class="sev uyari">Dikkat: ${g.keeper_missing.map((x) => ({ not: 'notunuz', cue: "cue'lar", ton: 'ton bilgisi' }[x])).join(', ')} başka kopyada</span>` : '';
    const box = el(`<div class="panel" style="margin-bottom:12px"><div class="ph"><label class="chk"><input type="checkbox" data-g ${s ? 'checked' : ''}> <b>${esc(KIND[g.kind])}</b></label><span class="tag">${g.members.length} kopya</span>${warn}</div>
      <table class="t"><thead><tr><th>Tut</th><th>Taşı</th><th></th><th>Konum</th><th>Kalite</th><th>Süre</th><th>Notunuz</th><th>Cue</th><th>Ton</th><th title="Serato / Engine / Kendi listeleriniz">Kullanım</th><th>Neden</th></tr></thead><tbody>
      ${g.members.map((m) => `<tr class="${m.id === keeper ? 'k' : ''}"><td><input type="radio" name="k${esc(g.id)}" value="${m.id}" ${m.id === keeper ? 'checked' : ''}></td>
        <td><input type="checkbox" data-rm="${m.id}" ${s && s.remove.includes(m.id) ? 'checked' : ''} ${m.id === keeper ? 'disabled' : ''}></td>
        <td><button class="btn ghost icon sm" data-play="${m.id}">${PLAY}</button></td>
        <td class="path"><b>${esc((m.rel || '').split('/').pop())}</b><br>${esc(m.folder || '')}</td>
        <td class="num" style="white-space:nowrap">${['.flac', '.wav', '.aif', '.aiff'].includes(m.ext) ? esc(m.ext.slice(1).toUpperCase()) : (m.bitrate ? m.bitrate + ' k' : '')}<div class="faint small">${fmtSize(m.size)}</div></td>
        <td class="num">${fmtDur(m.duration)}</td><td class="note-cell">${esc(m.note || '')}</td><td class="num">${m.cues || ''}</td><td>${m.camelot ? `<span class="cam">${esc(m.camelot)}</span>` : ''}</td>
        <td class="num small" style="white-space:nowrap" title="Serato crate / Engine listesi / kendi listeleriniz">S ${m.serato}&nbsp; E ${m.engine}&nbsp; L ${m.lists}</td><td class="small muted">${esc(m.reasons.join(', '))}</td></tr>`).join('')}
      </tbody></table></div>`);
    const sync = () => {
      const on = $('[data-g]', box).checked;
      if (!on) { delete S.dupSel[g.id]; viewDupes(main); return; }
      const k = +$(`input[type=radio]:checked`, box).value;
      const rm = $$('[data-rm]', box).filter((c) => c.checked && +c.dataset.rm !== k).map((c) => +c.dataset.rm);
      S.dupSel[g.id] = { keeper: k, remove: rm };
      viewDupes(main);
    };
    $('[data-g]', box).onchange = (e) => {
      if (e.target.checked) {
        const k = +$(`input[type=radio]:checked`, box).value;
        S.dupSel[g.id] = { keeper: k, remove: g.kind === 'song' ? [] : g.members.filter((m) => m.id !== k).map((m) => m.id) };
        viewDupes(main);
      } else sync();
    };
    $$('input[type=radio]', box).forEach((r) => { r.onchange = () => { const k = +r.value; S.dupSel[g.id] = { keeper: k, remove: g.kind === 'song' ? [] : g.members.filter((m) => m.id !== k).map((m) => m.id) }; viewDupes(main); }; });
    $$('[data-rm]', box).forEach((c) => { c.onchange = () => { $('[data-g]', box).checked = true; sync(); }; });
    $$('[data-play]', box).forEach((p) => { p.onclick = () => play(+p.dataset.play); });
    dl.appendChild(box);
  });
  if (vis.length > 300) dl.appendChild(el(`<p class="muted">İlk 300 grup gösteriliyor (${vis.length} grup var).</p>`));
  $('#dk').onchange = (e) => { S.dupFilter = e.target.value; viewDupes(main); };
  $('#dauto').onclick = () => { groups.filter((g) => g.kind !== 'song').forEach((g) => { S.dupSel[g.id] = { keeper: g.keeper, remove: g.members.filter((m) => m.id !== g.keeper).map((m) => m.id) }; }); viewDupes(main); };
  $('#dnone').onclick = () => { S.dupSel = {}; viewDupes(main); };
  $('#dgo').onclick = async () => {
    const sel = Object.entries(S.dupSel).filter(([, s]) => s.remove.length).map(([gid, s]) => ({ group_id: gid, keeper: s.keeper, remove: s.remove }));
    const nWarn = sel.filter((s) => { const g = groups.find((x) => x.id === s.group_id); return g && g.keeper_missing && g.keeper_missing.length && s.keeper === g.keeper; }).length;
    const ok = await confirmBox('Çiftleri birleştir', `<p><b>${sel.length} grupta ${sel.reduce((a, s) => a + s.remove.length, 0)} kopya</b> diskteki <code>_DJDoktor_Karantina</code> klasörüne taşınacak.</p>
      <ul><li>Serato crate'leri ve Engine listeleri, taşınan kopya yerine tutulan kopyayı gösterecek.</li><li>Kendi listeleriniz de güncellenir.</li><li>Serato ve Engine dosyaları önce yedeklenir; Geçmiş sayfasından geri alınabilir.</li></ul>
      ${nWarn ? `<p class="sev uyari">${nWarn} grupta notunuz veya cue'larınız taşınacak kopyada duruyor. İsterseniz önce o kopyayı "Tut" olarak seçin.</p>` : ''}<p class="muted small">Serato DJ ve Engine DJ kapalı olmalı.</p>`, 'Birleştir');
    if (!ok) return;
    if (!(await requireWritable('Çift birleştirme'))) return;
    S.dupSel = {};
    runTask('ops/dupes', { selections: sel }, { title: 'Çiftler birleştiriliyor', toast: (r) => r ? `${fmtNum(r.moved)} kopya karantinaya taşındı; ${fmtNum(r.lists)} liste kaydı güncellendi.` : 'Bitti' });
  };
}

/* ------------------------------------------------------------------ */
/* Listeler                                                             */
/* ------------------------------------------------------------------ */
function kindIcon(k) { return k === 'folder' ? 'folder' : k === 'event' ? 'etkinlikler' : k === 'section' ? 'section' : 'list'; }

async function viewLists(main) {
  await loadLists(true);
  const tree = listTree();
  const selId = S.routeArg ? +S.routeArg : null;
  main.innerHTML = `<div class="two"><div class="tree"><div class="row" style="margin:0 4px 10px"><button class="btn sm primary" id="nl">${ic('plus')}Liste</button><button class="btn sm" id="nf">${ic('folder')}Klasör</button></div><div id="tr"></div></div><div class="detail" id="ld"></div></div>`;
  const tr = $('#tr');
  tr.innerHTML = tree.length ? tree.map((r) => `<a data-id="${r.id}" class="${r.id === selId ? 'on' : ''}" style="padding-left:${8 + r.depth * 14}px">${ic(kindIcon(r.kind))}<span>${esc(r.title)}</span><span class="n">${r.kind === 'folder' || r.kind === 'event' ? '' : r.n}</span><span class="sy">${r.info && r.info.sync_engine ? '<i class="led b" title="Engine\'e gönderilir"></i>' : ''}${r.info && r.info.sync_serato ? '<i class="led g" title="Serato\'ya yazılır"></i>' : ''}</span></a>`).join('') : '<p class="muted small" style="padding:8px">Henüz liste yok.</p>';
  $$('a', tr).forEach((a) => {
    a.onclick = () => { location.hash = '#/listeler/' + a.dataset.id; };
    a.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('text/djd-files')) { e.preventDefault(); a.classList.add('drop'); } });
    a.addEventListener('dragleave', () => a.classList.remove('drop'));
    a.addEventListener('drop', async (e) => {
      e.preventDefault(); a.classList.remove('drop');
      const ids = JSON.parse(e.dataTransfer.getData('text/djd-files') || '[]');
      const r = (S.lists || []).find((x) => x.id === +a.dataset.id);
      if (!r || r.kind === 'folder' || r.kind === 'event') { toast('Parçaları bir listeye veya bölüme bırakın.', 'err'); return; }
      await addFiles(r.id, ids, r.title); viewLists(main);
    });
  });
  const parentFor = () => { const s = (S.lists || []).find((x) => x.id === selId); return s && s.kind === 'folder' ? s.id : (s ? s.parent_id : null); };
  $('#nl').onclick = async () => { const n = await promptBox('Yeni liste', 'Liste adı', 'Yeni liste'); if (!n) return; const r = await api('lists/create', { kind: 'list', title: n, parent_id: parentFor() }); location.hash = '#/listeler/' + r.id; };
  $('#nf').onclick = async () => { const n = await promptBox('Yeni klasör', 'Klasör adı', 'Yeni klasör'); if (!n) return; const r = await api('lists/create', { kind: 'folder', title: n, parent_id: parentFor() }); location.hash = '#/listeler/' + r.id; };
  const ld = $('#ld');
  if (!selId) { ld.innerHTML = `<div class="empty"><h3>Bir liste seçin ya da yeni liste oluşturun</h3><p>Kütüphaneden parçaları sürükleyip soldaki listelere bırakabilirsiniz. Etkinlikler için <a href="#/etkinlikler">Etkinlikler</a> sayfasını kullanın.</p></div>`; return; }
  const L = (S.lists || []).find((x) => x.id === selId);
  if (!L) { ld.innerHTML = '<div class="empty">Liste bulunamadı.</div>'; return; }
  if (L.kind === 'event') { location.hash = '#/etkinlik/' + L.id; return; }
  await renderListDetail(ld, L);
}

async function renderListDetail(ld, L) {
  const items = L.kind === 'folder' ? [] : await api(`lists/${L.id}/items`);
  const dur = items.reduce((a, i) => a + (i.duration || 0), 0);
  ld.innerHTML = `<div class="page"><div class="page-head"><div><h1>${esc(L.title)}</h1><p class="lead">${L.kind === 'folder' ? 'Klasör' : `${plural(items.length, 'parça')}, ${fmtLong(dur)}`}</p></div><span class="spacer"></span>
    <button class="btn" id="lren">${ic('edit')}Yeniden adlandır</button>${L.kind !== 'folder' ? `<button class="btn" id="ladd">${ic('plus')}Parça ekle</button><button class="btn" id="lgig">${ic('shield')}Gig kontrolü</button>` : ''}<button class="btn" id="lmore">Diğer</button></div>
    <div class="row" style="margin-bottom:14px"><label class="chk"><input type="checkbox" id="seng" ${L.info.sync_engine ? 'checked' : ''}> Engine'e gönderilsin</label><label class="chk"><input type="checkbox" id="sser" ${L.info.sync_serato ? 'checked' : ''}> Serato'ya crate olarak yazılsın</label>
    <span class="muted small">İşaretli listeler "Serato ve Engine" sayfasından tek seferde gönderilir.</span></div>
    <div id="itm"></div></div>`;
  $('#lren').onclick = async () => { const n = await promptBox('Yeniden adlandır', 'Yeni ad', L.title); if (!n) return; await api(`lists/${L.id}/update`, { title: n }); S.lists = null; render(); };
  $('#seng').onchange = async (e) => { await api(`lists/${L.id}/update`, { info: { sync_engine: e.target.checked } }); S.lists = null; toast(e.target.checked ? "Bu liste Engine'e gönderilecek." : "Engine gönderiminden çıkarıldı.", 'ok'); };
  $('#sser').onchange = async (e) => { await api(`lists/${L.id}/update`, { info: { sync_serato: e.target.checked } }); S.lists = null; toast(e.target.checked ? "Bu liste Serato'ya yazılacak." : "Serato yazımından çıkarıldı.", 'ok'); };
  if ($('#ladd')) $('#ladd').onclick = () => quickAdd(L.id, () => renderListDetail(ld, L));
  if ($('#lgig')) $('#lgig').onclick = () => gigCheck(L.id);
  $('#lmore').onclick = (e) => openMenu(e.currentTarget, [
    { label: 'rekordbox XML olarak dışa aktar', icon: 'export', action: () => exportLists([L.id], 'rekordbox') },
    { label: 'M3U8 olarak dışa aktar', icon: 'export', action: () => exportLists([L.id], 'm3u') },
    { label: 'Kopyasını oluştur', icon: 'ciftler', action: async () => { const r = await api(`lists/${L.id}/duplicate`, {}); location.hash = '#/listeler/' + r.id; } },
    { label: 'Klasöre taşı…', icon: 'folder', action: () => moveListFlow(L) },
    '-',
    { label: 'Listeyi sil (dosyalar silinmez)', icon: 'x', action: async () => { if (!(await confirmBox('Listeyi sil', `<p>"${esc(L.title)}" listesi ve alt listeleri programdan silinecek. Müzik dosyalarınız etkilenmez.</p>`, 'Sil', true))) return; await api(`lists/${L.id}/delete`, {}); S.lists = null; location.hash = '#/listeler'; } },
  ]);
  renderItems($('#itm'), L.id, items, () => renderListDetail(ld, L));
}

function renderItems(box, listId, items, reload) {
  if (!items.length) { box.innerHTML = '<div class="empty small">Liste boş. Kütüphaneden parçaları sürükleyin ya da "Parça ekle"yi kullanın.</div>'; bindDrop(box, listId, reload); return; }
  box.innerHTML = `<table class="items"><thead><tr><th style="width:32px">#</th><th style="width:34px"></th><th>Parça</th><th>BPM</th><th>Ton</th><th>Süre</th><th>Notunuz</th><th>Bu listedeki not</th><th style="width:34px"></th></tr></thead><tbody>
    ${items.map((it, i) => `<tr draggable="true" data-item="${it.item_id}" class="${it.present ? '' : 'miss'}"><td class="num muted">${i + 1}</td><td><button class="btn ghost icon sm" data-play="${it.id}">${PLAY}</button></td>
      <td><b>${esc(it.title)}</b> <span class="muted">${esc(it.artist)}</span>${worstSev(it.flags) === 'kritik' ? ' <span class="sev kritik">sorunlu</span>' : ''}</td><td class="num">${it.bpm ? Math.round(it.bpm) : ''}</td>
      <td>${it.key_comp ? `<span class="kc ${it.key_comp}" title="Önceki parçayla ton uyumu: ${esc(it.key_comp)}"></span>` : ''}${it.camelot ? `<span class="cam">${esc(it.camelot)}</span>` : ''}</td><td class="num">${fmtDur(it.duration)}</td>
      <td class="note-cell">${esc(it.note)}</td><td><span class="muted" data-note="${it.item_id}" style="cursor:text">${esc(it.item_note) || '<span class="faint">ekle</span>'}</span></td>
      <td><button class="btn ghost icon sm" data-rm="${it.item_id}" title="Listeden çıkar">${ic('x')}</button></td></tr>`).join('')}</tbody></table>`;
  $$('[data-play]', box).forEach((b) => { b.onclick = () => play(+b.dataset.play); });
  $$('[data-rm]', box).forEach((b) => { b.onclick = async () => { await api(`lists/${listId}/remove`, { item_ids: [+b.dataset.rm] }); S.lists = null; reload(); }; });
  $$('[data-note]', box).forEach((b) => { b.onclick = async () => { const it = items.find((x) => x.item_id === +b.dataset.note); const n = await promptBox('Bu listedeki not', 'Not (ör. "gelin girerken", "2. dakikadan başlat")', it.item_note); if (n === null) return; await api(`items/${it.item_id}/note`, { note: n }); reload(); }; });
  let dragId = null;
  $$('tr[data-item]', box).forEach((tr) => {
    tr.addEventListener('dragstart', (e) => { dragId = +tr.dataset.item; e.dataTransfer.setData('text/djd-item', String(dragId)); e.dataTransfer.effectAllowed = 'move'; });
    tr.addEventListener('dragover', (e) => { if (dragId) { e.preventDefault(); tr.classList.add('dragover'); } });
    tr.addEventListener('dragleave', () => tr.classList.remove('dragover'));
    tr.addEventListener('drop', async (e) => {
      tr.classList.remove('dragover');
      if (!dragId) return;
      e.preventDefault(); e.stopPropagation();
      const order = items.map((i) => i.item_id).filter((x) => x !== dragId);
      const at = order.indexOf(+tr.dataset.item);
      order.splice(at, 0, dragId);
      dragId = null;
      await api(`lists/${listId}/reorder`, { item_ids: order }); reload();
    });
  });
  bindDrop(box, listId, reload);
}
function bindDrop(box, listId, reload) {
  box.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('text/djd-files')) e.preventDefault(); });
  box.addEventListener('drop', async (e) => {
    const raw = e.dataTransfer.getData('text/djd-files'); if (!raw) return;
    e.preventDefault();
    const r = await api(`lists/${listId}/add`, { file_ids: JSON.parse(raw) });
    S.lists = null; toast(`${r.added} parça eklendi${r.skipped ? `, ${r.skipped} tanesi zaten vardı` : ''}.`, 'ok'); reload();
  });
}

async function moveListFlow(L) {
  await loadLists();
  const opts = listTree().filter((r) => (r.kind === 'folder' || (L.kind === 'section' && r.kind === 'event')) && r.id !== L.id);
  const body = `<label class="field"><span>Hedef klasör</span><select id="mv"><option value="">(En üst düzey)</option>${opts.map((r) => `<option value="${r.id}">${'— '.repeat(r.depth)}${esc(r.title)}</option>`).join('')}</select></label>`;
  const m = modal({ title: 'Klasöre taşı', body, foot: '<button class="btn" data-c>Vazgeç</button><button class="btn primary" data-ok>Taşı</button>' });
  $('[data-c]', m.root).onclick = () => m.close();
  $('[data-ok]', m.root).onclick = async () => { const v = $('#mv', m.root).value; try { await api(`lists/${L.id}/update`, { parent_id: v ? +v : null }); } catch (e) { showError(e.message); return; } m.root.remove(); S.lists = null; render(); };
}

async function quickAdd(listId, reload) {
  const T = await loadTracks();
  const body = el(`<div><input type="search" id="qa" placeholder="Ara: ad, sanatçı, not, klasör…" style="width:100%;margin-bottom:10px"><div class="scrollbox" style="max-height:420px" id="qr"></div></div>`);
  const m = modal({ title: 'Parça ekle', body, wide: true, foot: '<span class="left" id="qn"></span><button class="btn primary" data-ok>Kapat</button>' });
  $('[data-ok]', m.root).onclick = () => { m.root.remove(); reload(); };
  let added = 0;
  const draw = () => {
    const toks = fold($('#qa', body).value).split(/\s+/).filter(Boolean);
    const rows = T.list.filter((t) => t.present !== 0 && toks.every((k) => t.qfold.includes(k))).slice(0, 200);
    $('#qr', body).innerHTML = `<table class="t"><tbody>${rows.map((t) => `<tr><td><button class="btn ghost icon sm" data-play="${t.id}">${PLAY}</button></td><td><b>${esc(t.title || t.name)}</b> <span class="muted">${esc(t.artist)}</span><div class="path">${esc(t.folder)}</div></td><td class="num">${t.bpm ? Math.round(t.bpm) : ''}</td><td>${t.camelot ? `<span class="cam">${esc(t.camelot)}</span>` : ''}</td><td class="num">${fmtDur(t.duration)}</td><td><button class="btn sm" data-add="${t.id}">${ic('plus')}Ekle</button></td></tr>`).join('')}</tbody></table>`;
    $$('[data-play]', body).forEach((b) => { b.onclick = () => play(+b.dataset.play); });
    $$('[data-add]', body).forEach((b) => { b.onclick = async () => { const r = await api(`lists/${listId}/add`, { file_ids: [+b.dataset.add] }); added += r.added; b.disabled = true; b.textContent = r.added ? 'Eklendi' : 'Zaten var'; $('#qn', m.root).textContent = `${added} parça eklendi`; S.lists = null; }; });
  };
  $('#qa', body).oninput = draw;
  draw();
}

async function exportLists(ids, kind) {
  try {
    const r = await api('export/' + kind, { list_ids: ids, cues: true });
    if (kind === 'rekordbox') {
      modal({ title: 'rekordbox XML hazır', body: `<p>${fmtNum(r.tracks)} parça ve Serato cue noktaları XML dosyasına yazıldı.</p><p class="path">${esc(r.path)}</p>
        <p><b>Engine DJ'e aktarmak için:</b> Engine DJ > Ayarlar > Kütüphane > rekordbox XML konumu olarak <code>rekordbox_son.xml</code> dosyasını seçin, sonra soldaki rekordbox bölümünden listeye sağ tıklayıp içe aktarın. Cue'lar için "Hot Cue" seçeneğini kullanın.</p>`,
        foot: `<button class="btn" id="xo">${ic('folder')}Klasörü aç</button>` });
      $('#xo').onclick = () => api('open', { path: r.latest, select: true });
    } else {
      modal({ title: 'M3U8 hazır', body: `<p>${r.files.length} dosya yazıldı.</p><p class="path">${esc(r.dir)}</p>`, foot: `<button class="btn" id="xo">${ic('folder')}Klasörü aç</button>` });
      $('#xo').onclick = () => api('open', { path: r.dir });
    }
  } catch (e) { showError(e.message); }
}

async function gigCheck(listId) {
  let r;
  try { r = await api('gigcheck/' + listId); } catch (e) { showError(e.message); return; }
  const head = { kritik: ['kritik', 'Etkinlikten önce düzeltilmesi gereken sorunlar var'], uyari: ['uyari', 'Küçük uyarılar var'], tamam: ['tamam', 'Her şey hazır'] }[r.status];
  const body = `<p><span class="sev ${head[0]}">${esc(head[1])}</span> <span class="muted">${plural(r.tracks, 'parça')}, ${fmtLong(r.duration)}</span></p>
    ${r.checks.map((c) => `<details class="check"><summary><span class="sev ${c.severity}">${{ kritik: 'Kritik', uyari: 'Uyarı', bilgi: 'Bilgi' }[c.severity]}</span><b>${esc(c.title)}</b></summary><p class="small muted" style="padding:0 12px">${esc(c.detail)}</p>${c.items.length ? `<ul>${c.items.slice(0, 200).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}</details>`).join('') || '<p>Kontrollerin hepsi geçti. Prime 4\'te sorunsuz çalması bekleniyor.</p>'}`;
  modal({ title: 'Gig öncesi kontrol: ' + r.title, body, wide: true });
}

/* ------------------------------------------------------------------ */
/* Etkinlikler                                                          */
/* ------------------------------------------------------------------ */
async function viewEvents(main) {
  await loadLists(true);
  const evs = (S.lists || []).filter((r) => r.kind === 'event');
  const today = new Date().toISOString().slice(0, 10);
  evs.sort((a, b) => String(a.info.date || '9999').localeCompare(String(b.info.date || '9999')));
  const up = evs.filter((e) => !e.info.date || e.info.date >= today), past = evs.filter((e) => e.info.date && e.info.date < today).reverse();
  const card = (e) => {
    const d = e.info.date ? new Date(e.info.date + 'T12:00:00') : null;
    const secs = (S.lists || []).filter((x) => x.parent_id === e.id);
    const n = secs.reduce((a, s) => a + s.n, 0), dur = secs.reduce((a, s) => a + (s.dur || 0), 0);
    return `<div class="ev" data-id="${e.id}"><div class="date">${d ? `<b>${d.getDate()}</b><span>${d.toLocaleDateString('tr-TR', { month: 'short', year: 'numeric' })}</span>` : '<span>Tarih yok</span>'}</div>
      <div><b>${esc(e.title)}</b><div class="muted small">${esc([e.info.venue, e.info.couple].filter(Boolean).join(', ') || 'Ayrıntı eklenmedi')}</div><div class="small faint">${secs.length} bölüm, ${plural(n, 'parça')}, ${fmtLong(dur)}</div></div>
      <div class="row">${e.info.sync_engine ? '<span class="tag">Engine</span>' : ''}${e.info.sync_serato ? '<span class="tag">Serato</span>' : ''}</div></div>`;
  };
  main.innerHTML = `<div class="page"><div class="page-head"><div><h1>Etkinlikler</h1><p class="lead">Düğün, kına, nişan… Her etkinlik için şablondan bölümler oluşturun, parçaları seçin; Prime 4'e "DJ Doktor" klasörü altında tarihli olarak gider.</p></div><span class="spacer"></span><button class="btn primary" id="nev">${ic('plus')}Yeni etkinlik</button></div>
    ${evs.length ? '' : '<div class="empty"><h3>Henüz etkinlik yok</h3><p>İlk etkinliğinizi oluşturun; düğün şablonu Giriş, Pasta, Halay, Roman, Oyun Havası gibi bölümlerle gelir.</p></div>'}
    ${up.length ? `<h2 style="margin:6px 0 10px">Yaklaşan</h2><div class="ev-list">${up.map(card).join('')}</div>` : ''}
    ${past.length ? `<h2 style="margin:22px 0 10px">Geçmiş</h2><div class="ev-list">${past.map(card).join('')}</div>` : ''}</div>`;
  $$('.ev', main).forEach((c) => { c.onclick = () => { location.hash = '#/etkinlik/' + c.dataset.id; }; });
  $('#nev').onclick = () => eventWizard();
}

async function eventWizard(existing) {
  const tpls = await api('templates');
  const info = existing ? existing.info : {};
  const body = el(`<div>
    <div class="grid2">
      <label class="field"><span>Etkinlik adı</span><input type="text" id="et" value="${esc(existing ? existing.title : '')}" placeholder="ör. Ayşe & Mehmet Düğün"></label>
      ${existing ? '' : `<label class="field"><span>Şablon</span><select id="ety">${tpls.map((t) => `<option value="${esc(t.kind)}">${esc(t.title)}</option>`).join('')}</select></label>`}
      <label class="field"><span>Tarih</span><input type="date" id="ed" value="${esc(info.date || '')}"></label>
      <label class="field"><span>Başlangıç saati</span><input type="time" id="es" value="${esc(info.start || '')}"></label>
      <label class="field"><span>Mekân</span><input type="text" id="ev" value="${esc(info.venue || '')}"></label>
      <label class="field"><span>Çift / kişiler</span><input type="text" id="ec" value="${esc(info.couple || '')}"></label>
      <label class="field"><span>İletişim</span><input type="text" id="ek" value="${esc(info.contact || '')}"></label>
    </div>
    <label class="field"><span>Notlar</span><textarea id="en" rows="2">${esc(info.notes || '')}</textarea></label>
    <div class="grid2"><label class="field"><span>İstek parçalar</span><textarea id="er" rows="3">${esc(info.requests || '')}</textarea></label>
    <label class="field"><span>Çalınmayacaklar</span><textarea id="ex" rows="3">${esc(info.donotplay || '')}</textarea></label></div>
    ${existing ? '' : `<label class="field"><span>Bölümler (her satıra bir bölüm; sırası programın sırasıdır)</span><textarea id="esec" rows="8"></textarea></label>`}
    <div class="row"><label class="chk"><input type="checkbox" id="eeng" ${!existing || info.sync_engine ? 'checked' : ''}> Engine'e gönderilsin (Prime 4)</label><label class="chk"><input type="checkbox" id="eser" ${info.sync_serato ? 'checked' : ''}> Serato'ya crate olarak yazılsın</label></div>
  </div>`);
  const m = modal({ title: existing ? 'Etkinliği düzenle' : 'Yeni etkinlik', body, wide: true, foot: `<button class="btn" data-c>Vazgeç</button><button class="btn primary" data-ok>${existing ? 'Kaydet' : 'Oluştur'}</button>` });
  if (!existing) {
    const fill = () => { const t = tpls.find((x) => x.kind === $('#ety', body).value); $('#esec', body).value = (t ? t.sections : []).join('\n'); };
    $('#ety', body).onchange = fill; fill();
  }
  $('[data-c]', m.root).onclick = () => m.close();
  $('[data-ok]', m.root).onclick = async () => {
    const data = { title: $('#et', body).value.trim(), date: $('#ed', body).value, start: $('#es', body).value, venue: $('#ev', body).value, couple: $('#ec', body).value,
      contact: $('#ek', body).value, notes: $('#en', body).value, requests: $('#er', body).value, donotplay: $('#ex', body).value,
      sync_engine: $('#eeng', body).checked, sync_serato: $('#eser', body).checked };
    if (!data.title) { toast('Etkinlik adı gerekli.', 'err'); return; }
    try {
      if (existing) {
        await api(`lists/${existing.id}/update`, { title: data.title, info: data });
        m.root.remove(); S.lists = null; render();
      } else {
        data.type = $('#ety', body).value;
        data.sections = $('#esec', body).value.split('\n').map((s) => s.trim()).filter(Boolean);
        const r = await api('events/create', data);
        m.root.remove(); S.lists = null; location.hash = '#/etkinlik/' + r.id;
      }
    } catch (e) { showError(e.message); }
  };
}

async function viewEvent(main) {
  const id = +S.routeArg;
  let ov;
  try { ov = await api('events/' + id); } catch (e) { main.innerHTML = `<div class="page"><div class="banner err">${esc(e.message)}</div></div>`; return; }
  const T = await loadTracks();
  const ev = ov.event, info = ev.info || {};
  if (!S.activeSection || !ov.sections.some((s) => s.id === S.activeSection)) S.activeSection = ov.sections.length ? ov.sections[0].id : null;
  const d = info.date ? new Date(info.date + 'T12:00:00').toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : '';
  main.innerHTML = `<div class="page wide"><div class="page-head"><div><h1>${esc(ev.title)}</h1><p class="lead">${esc([d, info.start, info.venue, info.couple].filter(Boolean).join(', '))}${d || info.venue ? '. ' : ''}${ov.sections.length} bölüm, ${fmtLong(ov.duration)}</p></div><span class="spacer"></span>
    <button class="btn" id="egig">${ic('shield')}Gig kontrolü</button><button class="btn" id="eprint">${ic('print')}Yazdır</button><button class="btn" id="esync">${ic('senkron')}Gönder</button><button class="btn" id="emore">Diğer</button></div>
    ${info.requests || info.donotplay ? `<div class="banner info"><div>${info.requests ? `<b>İstekler:</b> ${esc(info.requests)}` : ''}${info.requests && info.donotplay ? '<br>' : ''}${info.donotplay ? `<b>Çalınmayacaklar:</b> ${esc(info.donotplay)}` : ''}</div></div>` : ''}
    <div class="board"><div id="secs"></div>
      <div class="picker"><div class="pk-h"><input type="search" id="pq" placeholder="Kütüphanede ara…" style="width:100%"><div class="small muted" style="margin-top:8px" id="pkhint"></div></div><div class="pk-b" id="pk"></div></div></div></div>`;
  const secs = $('#secs');
  ov.sections.forEach((s, si) => {
    const box = el(`<div class="sec ${s.id === S.activeSection ? 'active' : ''}" data-sec="${s.id}"><div class="sh"><h3>${esc(s.title)}</h3><span class="meta">${plural(s.items.length, 'parça')}, ${fmtDur(s.duration) || '0:00'}</span><span class="spacer"></span>
      <button class="btn ghost icon sm" data-up title="Yukarı taşı" ${si === 0 ? 'disabled' : ''}>${ic('up')}</button><button class="btn ghost icon sm" data-down title="Aşağı taşı" ${si === ov.sections.length - 1 ? 'disabled' : ''}>${ic('down')}</button>
      <button class="btn ghost icon sm" data-ren title="Yeniden adlandır">${ic('edit')}</button><button class="btn ghost icon sm" data-del title="Bölümü sil">${ic('x')}</button></div><div class="sb"></div></div>`);
    $('.sh', box).addEventListener('click', (e) => { if (e.target.closest('button')) return; S.activeSection = s.id; $$('.sec', secs).forEach((x) => x.classList.toggle('active', x === box)); loadPicker(); });
    const reload = () => viewEvent(main);
    if (s.items.length) renderItems($('.sb', box), s.id, s.items, reload);
    else { $('.sb', box).innerHTML = '<div class="dropzone">Parçaları buraya sürükleyin ya da sağdaki listeden + ile ekleyin</div>'; bindDrop($('.sb', box), s.id, reload); }
    box.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('text/djd-files')) { e.preventDefault(); box.classList.add('drop'); } });
    box.addEventListener('dragleave', (e) => { if (!box.contains(e.relatedTarget)) box.classList.remove('drop'); });
    box.addEventListener('drop', () => box.classList.remove('drop'));
    const move = async (dir) => {
      const order = ov.sections.map((x) => x.id); const i = order.indexOf(s.id); const j = i + dir;
      [order[i], order[j]] = [order[j], order[i]];
      for (let k = 0; k < order.length; k++) await api(`lists/${order[k]}/update`, { pos: k + 1 });
      reload();
    };
    $('[data-up]', box).onclick = () => move(-1);
    $('[data-down]', box).onclick = () => move(1);
    $('[data-ren]', box).onclick = async () => { const n = await promptBox('Bölümü yeniden adlandır', 'Bölüm adı', s.title); if (!n) return; await api(`lists/${s.id}/update`, { title: n }); reload(); };
    $('[data-del]', box).onclick = async () => { if (!(await confirmBox('Bölümü sil', `<p>"${esc(s.title)}" bölümü ve içindeki liste silinecek (dosyalar etkilenmez).</p>`, 'Sil', true))) return; await api(`lists/${s.id}/delete`, {}); reload(); };
    secs.appendChild(box);
  });
  const addSec = el(`<button class="btn">${ic('plus')}Bölüm ekle</button>`);
  addSec.onclick = async () => { const n = await promptBox('Yeni bölüm', 'Bölüm adı', ''); if (!n) return; await api('lists/create', { parent_id: ev.id, kind: 'section', title: n }); viewEvent(main); };
  secs.appendChild(addSec);

  const pk = $('#pk');
  const inEvent = new Set(ov.sections.flatMap((s) => s.items.map((i) => i.id)));
  const pickRow = (t, why) => `<div class="pk-item" draggable="true" data-id="${t.id}"><button class="btn ghost icon sm" data-play="${t.id}">${PLAY}</button><div class="t"><b>${esc(t.title || t.name)}</b> <span class="muted">${esc(t.artist)}</span><div class="why">${why ? esc(why) : esc(t.folder)}</div></div><div class="row">${t.camelot ? `<span class="cam">${esc(t.camelot)}</span>` : ''}<button class="btn sm" data-add="${t.id}" title="Etkin bölüme ekle">${ic('plus')}</button></div></div>`;
  const bindPick = () => {
    $$('[data-play]', pk).forEach((b) => { b.onclick = () => play(+b.dataset.play); });
    $$('[data-add]', pk).forEach((b) => { b.onclick = async () => { if (!S.activeSection) { toast('Önce bir bölüm seçin.', 'err'); return; } await api(`lists/${S.activeSection}/add`, { file_ids: [+b.dataset.add] }); viewEvent(main); }; });
    $$('.pk-item', pk).forEach((it) => { it.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/djd-files', JSON.stringify([+it.dataset.id])); e.dataTransfer.effectAllowed = 'copy'; }); });
  };
  const loadPicker = async () => {
    const q = $('#pq').value;
    const sec = ov.sections.find((s) => s.id === S.activeSection);
    if (q.trim()) {
      const toks = fold(q).split(/\s+/).filter(Boolean);
      const rows = T.list.filter((t) => t.present !== 0 && toks.every((k) => t.qfold.includes(k))).slice(0, 150);
      $('#pkhint').textContent = `${rows.length} sonuç${sec ? `, + düğmesi "${sec.title}" bölümüne ekler` : ''}`;
      pk.innerHTML = rows.map((t) => pickRow(t, inEvent.has(t.id) ? 'Bu etkinlikte zaten var' : '')).join('') || '<div class="empty small">Sonuç yok</div>';
    } else if (sec) {
      $('#pkhint').textContent = `"${sec.title}" için öneriler (klasör, crate adı, tür ve notlara göre)`;
      pk.innerHTML = '<div class="empty small">Öneriler hazırlanıyor…</div>';
      const sug = await api(`lists/${sec.id}/suggest`);
      pk.innerHTML = sug.map((s) => { const t = T.byId.get(s.id); return t ? pickRow(t, 'Eşleşen: ' + s.why.join(', ')) : ''; }).join('') || '<div class="empty small">Bu bölüm için öneri bulunamadı. Arama kutusunu kullanın.</div>';
    } else { pk.innerHTML = ''; $('#pkhint').textContent = 'Bölüm ekleyin.'; }
    bindPick();
  };
  let qt = 0;
  $('#pq').oninput = () => { clearTimeout(qt); qt = setTimeout(loadPicker, 150); };
  loadPicker();
  $('#egig').onclick = () => gigCheck(ev.id);
  $('#eprint').onclick = () => window.open(`/print/event/${ev.id}?t=${encodeURIComponent(TOKEN)}`, '_blank');
  $('#esync').onclick = (e) => openMenu(e.currentTarget, [
    { label: "Engine'e gönder (Prime 4)", icon: 'senkron', action: () => syncEngineFlow(ev.id) },
    { label: "Serato'ya crate olarak yaz", icon: 'senkron', action: () => syncSeratoFlow(ev.id) },
    '-',
    { label: 'rekordbox XML olarak dışa aktar', icon: 'export', action: () => exportLists([ev.id], 'rekordbox') },
    { label: 'M3U8 olarak dışa aktar', icon: 'export', action: () => exportLists([ev.id], 'm3u') },
  ]);
  $('#emore').onclick = (e) => openMenu(e.currentTarget, [
    { label: 'Bilgileri düzenle', icon: 'edit', action: async () => { await loadLists(true); eventWizard((S.lists || []).find((x) => x.id === ev.id)); } },
    { label: 'Kopyasını oluştur (yeni etkinlik için)', icon: 'ciftler', action: async () => { const r = await api(`lists/${ev.id}/duplicate`, {}); location.hash = '#/etkinlik/' + r.id; } },
    '-',
    { label: 'Etkinliği sil (dosyalar silinmez)', icon: 'x', action: async () => { if (!(await confirmBox('Etkinliği sil', `<p>"${esc(ev.title)}" ve tüm bölümleri programdan silinecek. Müzik dosyaları etkilenmez. Engine'e gönderildiyse bir sonraki gönderimde oradan da kalkar.</p>`, 'Sil', true))) return; await api(`lists/${ev.id}/delete`, {}); location.hash = '#/etkinlikler'; } },
  ]);
}

async function syncEngineFlow(ensureId) {
  if (ensureId) { await api(`lists/${ensureId}/update`, { info: { sync_engine: true } }); S.lists = null; }
  await loadLists(true);
  const flagged = (S.lists || []).filter((r) => r.info && r.info.sync_engine);
  const st = await api('engine');
  const drive = st.find((d) => d.key === 'drive');
  if (!drive) { showError("Bu diskte Engine kütüphanesi bulunamadı. Engine DJ ile diski bir kez açın; 'Engine Library' klasörü oluşur."); return; }
  const folder = (S.state.prefs && S.state.prefs.engine_folder) || 'DJ Doktor';
  const body = `<p>Aşağıdaki ${flagged.length} liste/etkinlik, diskteki Engine kütüphanesinde <b>"${esc(folder)}"</b> klasörünün altına yazılacak. Bu klasör programın kontrolündedir; önceki gönderim yenisiyle değiştirilir. Diğer Engine listelerinize dokunulmaz.</p>
    <ul>${flagged.map((r) => `<li>${esc(r.title)} <span class="muted small">${r.kind === 'event' ? 'etkinlik' : r.kind === 'folder' ? 'klasör' : plural(r.n, 'parça')}</span></li>`).join('') || '<li class="muted">İşaretli liste yok</li>'}</ul>
    <p class="small muted">Boş bölümler gönderilmez. Engine'de olmayan parçalar eklenir (Prime 4 çalarken analiz eder; Engine DJ masaüstünde önceden analiz etmeniz önerilir). Yolu hatalı olan parçalar otomatik onarılır. Engine DJ kapalı olmalı; önce yedek alınır.</p>`;
  const m = modal({ title: "Engine'e gönder", body, foot: `<button class="btn" data-c>Vazgeç</button><button class="btn primary" data-ok ${flagged.length ? '' : 'disabled'}>Gönder</button>` });
  $('[data-c]', m.root).onclick = () => m.close();
  $('[data-ok]', m.root).onclick = async () => {
    m.root.remove();
    if (!(await requireWritable("Engine'e gönderme"))) return;
    runTask('engine/sync', { key: 'drive' }, { title: "Engine'e gönderiliyor", toast: (r) => r ? `${r.stats.playlists} liste, ${r.stats.entries} parça kaydı yazıldı; ${r.stats.tracks_added} yeni parça Engine'e eklendi.` : 'Bitti' });
  };
}

async function syncSeratoFlow(ensureId) {
  if (ensureId) { await api(`lists/${ensureId}/update`, { info: { sync_serato: true } }); S.lists = null; }
  await loadLists(true);
  const flagged = (S.lists || []).filter((r) => r.info && r.info.sync_serato);
  const parent = (S.state.prefs && S.state.prefs.serato_parent) || 'DJ Doktor';
  const body = `<p>${flagged.length} liste/etkinlik, Serato'da <b>"${esc(parent)}"</b> crate'inin altına yazılacak. Serato'nun diğer crate'lerine ve veritabanına dokunulmaz.</p>
    <ul>${flagged.map((r) => `<li>${esc(r.title)}</li>`).join('') || '<li class="muted">İşaretli liste yok</li>'}</ul>
    <p class="small muted">Serato DJ kapalı olmalı; açınca yeni crate'ler görünür. Önce Serato klasörü yedeklenir.</p>`;
  const m = modal({ title: "Serato'ya yaz", body, foot: `<button class="btn" data-c>Vazgeç</button><button class="btn primary" data-ok ${flagged.length ? '' : 'disabled'}>Yaz</button>` });
  $('[data-c]', m.root).onclick = () => m.close();
  $('[data-ok]', m.root).onclick = async () => {
    m.root.remove();
    if (!(await requireWritable("Serato'ya yazma"))) return;
    runTask('serato/export', {}, { title: "Serato'ya yazılıyor", toast: (r) => r ? `${r.crates} crate yazıldı. Serato'yu açtığınızda görünür.` : 'Bitti' });
  };
}

/* ------------------------------------------------------------------ */
/* Serato ve Engine                                                     */
/* ------------------------------------------------------------------ */
async function viewSync(main) {
  const [eng, ser] = await Promise.all([api('engine'), api('serato')]);
  await loadLists(true);
  const fe = (S.lists || []).filter((r) => r.info && r.info.sync_engine).length;
  const fs = (S.lists || []).filter((r) => r.info && r.info.sync_serato).length;
  const mrow = (counts) => Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, v]) => { const m = MATCH[k] || [k, '', '']; return `<tr><td><i class="led ${m[1]}"></i> ${esc(m[0])}</td><td class="num">${fmtNum(v)}</td><td class="muted small">${esc(m[2])}</td></tr>`; }).join('');
  let html = `<div class="page"><div class="page-head"><div><h1>Serato ve Engine</h1><p class="lead">Mac'te Türkçe harfler "ayrık" yazılır (ü = u + ¨). Diskte ise "birleşik" durur. Mac bu farkı tolere eder; Prime 4 ve Windows etmez. Bu yüzden Mac'te hazırlanan listelerde bazı parçalar Denon'da kırmızı görünür.</p></div></div>`;
  for (const d of eng) {
    const red = (d.counts.unicode || 0) + (d.counts.sfm || 0);
    html += `<div class="panel" style="margin-bottom:16px"><div class="ph"><h2 style="flex:1">Engine DJ: ${esc(d.label)}</h2>${d.info.schema ? `<span class="tag">şema ${esc(d.info.schema)}</span>` : ''}</div><div class="pb">
      ${d.info.warning ? `<div class="banner">${esc(d.info.warning)}</div>` : ''}
      <p class="path">${esc(d.path)}</p>
      <table class="t" style="max-width:760px"><thead><tr><th>Yol durumu</th><th>Parça</th><th>Nerede çalışır</th></tr></thead><tbody>${mrow(d.counts)}</tbody></table>
      <p class="muted small">${fmtNum(d.unanalyzed)} parça analiz edilmemiş.${d.last_sync ? ' Son gönderim: ' + fmtTime(+d.last_sync) : ''}</p>
      ${d.key === 'drive' ? `<div class="row" style="margin-top:10px"><button class="btn ${red ? 'primary' : ''}" data-erep>${red ? `${fmtNum(red)} kırmızı parçayı onar` : 'Yol onarım planı'}</button><button class="btn" data-esync>${ic('senkron')}İşaretli listeleri gönder (${fe})</button><button class="btn" data-eimp>Engine listelerini programa aktar</button></div>` : '<p class="small muted">Bilgisayardaki Engine kütüphanesi yalnızca incelenir; değişiklikler diskteki kütüphaneye yapılır.</p>'}
      ${d.playlists.length ? `<details class="check" style="margin-top:12px"><summary><b>Engine listeleri (${d.playlists.length})</b></summary><div style="padding:0 12px 10px"><table class="t"><tbody>${d.playlists.map((p) => `<tr><td>${esc(p.path)}</td><td class="num">${p.count}</td><td>${p.red ? `<span class="sev kritik">${p.red} kırmızı</span>` : ''}</td></tr>`).join('')}</tbody></table></div></details>` : ''}
    </div></div>`;
  }
  if (!eng.length) html += '<div class="panel" style="margin-bottom:16px"><div class="pb"><h2>Engine DJ</h2><p class="muted">Bu kütüphanede "Engine Library" klasörü yok. Engine DJ ile diski bir kez açtığınızda oluşur.</p></div></div>';
  if (ser) {
    html += `<div class="panel"><div class="ph"><h2 style="flex:1">Serato DJ</h2><span class="tag">${ser.info.dialect === 'mac' ? 'Mac yazımı' : 'Windows yazımı'}</span></div><div class="pb">
      <p class="muted">${fmtNum(ser.crates.length)} crate, veritabanında ${fmtNum(Object.values(ser.tracks).reduce((a, b) => a + b, 0))} parça.</p>
      <table class="t" style="max-width:760px"><thead><tr><th>Crate kayıtları</th><th>Adet</th><th>Nerede çalışır</th></tr></thead><tbody>${mrow(ser.items)}</tbody></table>
      ${ser.missing_tops.length ? `<p class="small muted">Bu diskte bulunmayan klasörlere işaret eden kayıtlar: ${ser.missing_tops.slice(0, 8).map(([k, v]) => `${esc(k)} (${fmtNum(v)})`).join(', ')}</p>` : ''}
      <div class="row" style="margin-top:10px"><button class="btn" data-ssync>${ic('senkron')}İşaretli listeleri Serato'ya yaz (${fs})</button><button class="btn" data-simp>Serato crate'lerini programa aktar</button></div>
      <details class="check" style="margin-top:12px"><summary><b>Crate'ler (${ser.crates.length})</b></summary><div style="padding:0 12px 10px"><table class="t"><tbody>${ser.crates.map((c) => { const bad = (c.by.unicode || 0) + (c.by.sfm || 0); const miss = (c.by.missing || 0) + (c.by.nodir || 0); return `<tr><td>${esc(c.path)}</td><td class="num">${c.count}</td><td>${bad ? `<span class="sev uyari">${bad} sadece Mac</span>` : ''} ${miss ? `<span class="sev bilgi">${miss} bu diskte yok</span>` : ''}</td></tr>`; }).join('')}</tbody></table></div></details>
    </div></div>`;
  } else html += '<div class="panel"><div class="pb"><h2>Serato DJ</h2><p class="muted">Bu kütüphanede _Serato_ klasörü yok.</p></div></div>';
  html += '</div>';
  main.innerHTML = html;
  $$('[data-erep]', main).forEach((b) => { b.onclick = () => engineRepairFlow(); });
  $$('[data-esync]', main).forEach((b) => { b.onclick = () => syncEngineFlow(); });
  $$('[data-ssync]', main).forEach((b) => { b.onclick = () => syncSeratoFlow(); });
  $$('[data-eimp]', main).forEach((b) => { b.onclick = () => importFlow('engine', eng.find((d) => d.key === 'drive')); });
  $$('[data-simp]', main).forEach((b) => { b.onclick = () => importFlow('serato', ser); });
}

function importFlow(kind, data) {
  const rows = kind === 'engine' ? data.playlists.filter((p) => p.count > 0).map((p) => ({ k: p.list_key, t: p.path, n: p.count })) : data.crates.filter((c) => c.count > 0).map((c) => ({ k: c.list_key, t: c.path, n: c.count }));
  const body = `<p class="muted">Seçtiğiniz ${kind === 'engine' ? 'Engine listeleri' : "Serato crate'leri"} bu programa liste olarak kopyalanır (orijinallerine dokunulmaz). Bulunamayan parçalar atlanır.</p>
    <div class="row" style="margin-bottom:8px"><input type="search" id="imq" placeholder="Filtrele" style="flex:1"><button class="btn sm" id="ima">Tümünü seç</button></div>
    <div class="scrollbox" style="max-height:380px"><table class="t"><tbody>${rows.map((r) => `<tr data-t="${esc(fold(r.t))}"><td><input type="checkbox" value="${esc(r.k)}"></td><td>${esc(r.t)}</td><td class="num muted">${r.n}</td></tr>`).join('')}</tbody></table></div>`;
  const m = modal({ title: kind === 'engine' ? 'Engine listelerini aktar' : "Serato crate'lerini aktar", body, wide: true, foot: '<button class="btn" data-c>Vazgeç</button><button class="btn primary" data-ok>Aktar</button>' });
  $('#imq', m.root).oninput = (e) => { const q = fold(e.target.value); $$('tr[data-t]', m.root).forEach((tr) => tr.classList.toggle('hide', !tr.dataset.t.includes(q))); };
  $('#ima', m.root).onclick = () => $$('tr[data-t]:not(.hide) input', m.root).forEach((c) => { c.checked = true; });
  $('[data-c]', m.root).onclick = () => m.close();
  $('[data-ok]', m.root).onclick = async () => {
    const sel = $$('input[type=checkbox]:checked', m.root).map((c) => c.value);
    if (!sel.length) { toast('En az bir liste seçin.', 'err'); return; }
    try {
      const r = kind === 'engine' ? await api('engine/import', { key: 'drive', playlist_ids: sel }) : await api('serato/import', { crates: sel });
      m.root.remove(); S.lists = null;
      toast(`${r.lists} liste aktarıldı${r.missing ? `; ${r.missing} parça diskte bulunamadığı için atlandı` : ''}.`, 'ok');
      location.hash = '#/listeler';
    } catch (e) { showError(e.message); }
  };
}

/* ------------------------------------------------------------------ */
/* Yeni müzik ekle                                                      */
/* ------------------------------------------------------------------ */
async function viewInbox(main) {
  const IB = S.inbox;
  const ym = new Date().toISOString().slice(0, 7);
  let html = `<div class="page"><div class="page-head"><div><h1>Yeni müzik ekle</h1><p class="lead">İndirdiğiniz parçaları diske koymadan önce kontrol edin: diskte zaten olanlar ayıklanır, sadece yeniler temiz adlarla kopyalanır. Kaynak klasördeki dosyalara dokunulmaz.</p></div></div>
    <div class="panel" style="margin-bottom:16px"><div class="pb"><div class="row"><input type="text" id="isrc" style="flex:1;min-width:260px" placeholder="Kaynak klasör (ör. İndirilenler)" value="${esc(IB ? IB.source : '')}"><button class="btn" id="ibr">${ic('folder')}Gözat</button><button class="btn primary" id="iscan">İncele</button></div></div></div>`;
  if (IB) {
    const st = { new: ['tamam', 'Yeni'], same_audio: ['kritik', 'Diskte zaten var'], same_song: ['uyari', 'Benzeri var'] };
    html += `<div class="panel"><div class="ph"><h2 style="flex:1">${plural(IB.items.length, 'dosya')} incelendi</h2><span class="sev tamam">${IB.counts.new} yeni</span><span class="sev kritik">${IB.counts.same_audio} zaten var</span><span class="sev uyari">${IB.counts.same_song} benzeri var</span></div>
      <div class="pb"><div class="scrollbox" style="max-height:420px"><table class="t"><thead><tr><th></th><th>Dosya</th><th>Durum</th><th>Kalite</th><th>Diskteki eşi</th><th>Yeni adı</th></tr></thead><tbody>
      ${IB.items.map((it, i) => `<tr><td><input type="checkbox" data-i="${i}" ${it.status === 'new' ? 'checked' : ''}></td><td><b>${esc(it.title || it.name)}</b> <span class="muted">${esc(it.artist || '')}</span>${it.error ? `<div class="small" style="color:var(--red)">${esc(it.error)}</div>` : ''}</td>
        <td><span class="sev ${st[it.status][0]}">${st[it.status][1]}</span>${it.better ? ' <span class="tag">daha kaliteli</span>' : ''}</td><td class="num">${it.bitrate ? it.bitrate + ' k' : ''}</td>
        <td class="path">${it.match ? esc(it.match.disp) + (it.match.bitrate ? ` (${it.match.bitrate} k)` : '') : ''}</td><td class="small">${esc(it.safe_name)}</td></tr>`).join('')}</tbody></table></div>
      <div class="grid2" style="margin-top:14px"><label class="field"><span>Diskte hedef klasör (kütüphane kökünden itibaren)</span><input type="text" id="idest" value="yeni eklenenler/${ym}"></label>
        <label class="field"><span>Ayrıca bu listeye ekle</span><select id="ilist"><option value="">Hiçbiri</option></select></label></div>
      <div class="row"><label class="chk"><input type="checkbox" id="itr" checked> Türkçe harfleri koru</label><label class="chk"><input type="checkbox" id="iem" checked> Emojileri temizle</label><span class="spacer"></span><button class="btn primary" id="igo">Seçilenleri kopyala</button></div></div></div>`;
  }
  html += '</div>';
  main.innerHTML = html;
  $('#ibr').onclick = async () => { const p = await folderPicker('Kaynak klasör'); if (p) $('#isrc').value = p; };
  $('#iscan').onclick = async () => {
    const src = $('#isrc').value.trim(); if (!src) { toast('Kaynak klasörü seçin.', 'err'); return; }
    const r = await runTask('inbox/scan', { source: src }, { title: 'Yeni müzikler inceleniyor', rerender: false });
    if (r) { S.inbox = r; viewInbox(main); }
  };
  if (IB) {
    await loadLists();
    $('#ilist').innerHTML += listTree().filter((r) => r.kind === 'list' || r.kind === 'section').map((r) => `<option value="${r.id}">${'— '.repeat(r.depth)}${esc(r.title)}</option>`).join('');
    $('#igo').onclick = async () => {
      const srcs = $$('input[data-i]:checked').map((c) => IB.items[+c.dataset.i].src);
      if (!srcs.length) { toast('Kopyalanacak dosya seçin.', 'err'); return; }
      if (!(await requireWritable('Yeni müzik ekleme'))) return;
      const r = await runTask('inbox/import', { sources: srcs, dest: $('#idest').value, keep_turkish: $('#itr').checked, strip_emoji: $('#iem').checked, list_id: $('#ilist').value ? +$('#ilist').value : null },
        { title: 'Yeni müzikler kopyalanıyor', rerender: false, toast: (x) => x ? `${x.copied} parça "${x.dest}" klasörüne kopyalandı.` : 'Bitti' });
      if (r) { S.inbox = null; if (r.errors && r.errors.length) showError(r.errors.join('\n')); viewInbox(main); }
    };
  }
}

/* ------------------------------------------------------------------ */
/* Geçmiş ve yedekler                                                   */
/* ------------------------------------------------------------------ */
async function viewHistory(main) {
  const [j, bk] = await Promise.all([api('journal'), api('backups')]);
  const b = bk.items || [];
  const undoable = new Set(['move', 'import', 'rename', 'engine_repair', 'engine_sync', 'serato_export', 'dupes']);
  main.innerHTML = `<div class="page"><div class="page-head"><div><h1>Geçmiş ve yedekler</h1><p class="lead">Yapılan her değişiklik burada. "Geri al" işlemi eski hâline döndürür. Karantinadaki dosyaları inceledikten sonra isterseniz kendiniz silebilirsiniz; program hiçbir dosyayı silmez.</p></div><span class="spacer"></span><button class="btn" id="oq">${ic('folder')}Karantina klasörü</button><button class="btn" id="ob">${ic('folder')}Yedekler klasörü</button></div>
    <div class="panel" style="margin-bottom:16px"><div class="ph"><h2>İşlemler</h2></div><div class="pb">${j.length ? `<table class="t"><tbody>${j.map((x) => `<tr><td class="num muted" style="white-space:nowrap">${fmtTime(x.ts)}</td><td>${esc(x.title)}${x.status === 'geri_alindi' ? ' <span class="tag">geri alındı</span>' : ''}</td><td style="text-align:right">${undoable.has(x.payload.type) && x.status !== 'geri_alindi' ? `<button class="btn sm" data-u="${x.id}">${ic('undo')}Geri al</button>` : ''}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">Henüz değişiklik yapılmadı.</p>'}</div></div>
    <div class="panel"><div class="ph"><h2>Yedekler</h2>${bk.count ? `<span class="muted small">${bk.count} dosya · toplam ${fmtSize(bk.total)}</span>` : ''}</div><div class="pb">${b.length ? `<p class="muted small" style="margin:0 0 10px">Engine ve Serato dosyaları her değişiklikten önce buraya yedeklenir; geri alma bu yedekleri kullanır. Yer açmak isterseniz eski yedekleri "Yedekler klasörü"nden kendiniz silebilirsiniz (en yenilerini tutun).</p><table class="t"><tbody>${b.slice(0, 60).map((x) => `<tr><td class="num muted">${fmtTime(x.mtime)}</td><td class="path">${esc(x.name)}</td><td class="num muted">${fmtSize(x.size)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">Henüz yedek yok. Serato veya Engine dosyası değiştirilmeden önce otomatik yedek alınır.</p>'}</div></div></div>`;
  $('#oq').onclick = () => api('open', { path: S.state.active.root + (S.state.platform.startsWith('win') ? '\\' : '/') + '_DJDoktor_Karantina' }).catch(() => toast('Karantina klasörü henüz yok.', 'err'));
  $('#ob').onclick = () => api('open', { path: S.state.workspace + (S.state.platform.startsWith('win') ? '\\' : '/') + 'yedekler' }).catch((e) => toast(e.message, 'err'));
  $$('[data-u]', main).forEach((btn) => {
    btn.onclick = async () => {
      const x = j.find((y) => y.id === +btn.dataset.u);
      const guarded = ['engine_sync', 'dupes', 'serato_export'].includes(x.payload.type);
      const info = guarded ? '<p class="muted small">Bu işlemden sonra Engine DJ, Prime 4 veya Serato\'da bir şey değiştiyse program önce sizi uyarır; o değişiklikler habersiz silinmez.</p>' : '';
      if (!(await confirmBox('Geri al', `<p>"${esc(x.title)}" işlemi geri alınacak.</p>${info}<p class="muted small">Serato DJ ve Engine DJ kapalı olmalı.</p>`, 'Geri al'))) return;
      if (!(await requireWritable('Geri alma'))) return;
      const done = (r) => { if (r && r.notes && r.notes.length) toast(r.notes[0], 'ok'); };
      runTask('undo', { journal_id: x.id }, {
        title: 'Geri alınıyor', toast: 'Geri alındı.', done,
        onError: (t) => {
          if (t.code !== 'degisti') return false;
          confirmBox('Arada değişiklik var', `<p class="sev uyari">${esc(t.error)}</p>`, 'Yine de geri al').then((yes) => {
            if (yes) runTask('undo', { journal_id: x.id, force: true }, { title: 'Geri alınıyor', toast: 'Geri alındı.', done });
            else render();
          });
          return true;
        },
      });
    };
  });
}

/* ------------------------------------------------------------------ */
/* Ayarlar                                                              */
/* ------------------------------------------------------------------ */
async function viewSettings(main) {
  const st = S.state, a = st.active, p = st.prefs;
  main.innerHTML = `<div class="page"><div class="page-head"><div><h1>Ayarlar</h1></div></div>
    <div class="panel" style="margin-bottom:16px"><div class="ph"><h2 style="flex:1">Bu kütüphane</h2></div><div class="pb">
      <dl class="kv"><dt>Ad</dt><dd>${esc(a.name)}</dd><dt>Klasör</dt><dd class="path">${esc(a.root)}</dd><dt>Dosya sistemi</dt><dd>${esc((a.fstype || 'bilinmiyor').toUpperCase())}</dd>
      <dt>Katalog</dt><dd class="path">${esc(a.catalog)}</dd><dt>Boş alan</dt><dd>${fmtSize(a.free)}</dd></dl>
      <div class="banner ${a.readonly ? 'ok' : ''}" style="margin-top:14px"><div style="flex:1"><b>${a.readonly ? 'Salt-okunur mod açık.' : 'Değişikliklere izin veriliyor.'}</b> ${a.readonly ? 'Program bu diske hiçbir şey yazmaz; analiz, liste hazırlama ve bilgisayara dışa aktarma çalışır.' : 'Onayladığınız işlemler diske yazılır; her işlemden önce yedek alınır.'}</div>
        <button class="btn" id="rot">${a.readonly ? 'Değişikliklere izin ver' : 'Salt-okunur moda geç'}</button></div>
      <div class="row"><button class="btn" id="ren">${ic('edit')}Adını değiştir</button><button class="btn" id="add">${ic('plus')}Başka kütüphane ekle</button><button class="btn danger" id="rm">Programdan kaldır</button></div></div></div>
    <div class="panel" style="margin-bottom:16px"><div class="ph"><h2>Senkron tercihleri</h2></div><div class="pb">
      <div class="grid2"><label class="field"><span>Engine'deki klasör adı</span><input type="text" id="pf_engine" value="${esc(p.engine_folder)}"></label>
      <label class="field"><span>Serato'daki üst crate adı</span><input type="text" id="pf_serato" value="${esc(p.serato_parent)}"></label>
      <label class="field"><span>Serato yol yazımı</span><select id="pf_dial"><option value="auto" ${p.serato_dialect === 'auto' ? 'selected' : ''}>Otomatik (önerilen)</option><option value="mac" ${p.serato_dialect === 'mac' ? 'selected' : ''}>Mac</option><option value="windows" ${p.serato_dialect === 'windows' ? 'selected' : ''}>Windows</option></select></label>
      <label class="field"><span>Düşük kalite sınırı (kbps)</span><input type="number" id="pf_br" value="${esc(p.lowbitrate_kbps)}"></label></div>
      <label class="chk"><input type="checkbox" id="pf_num" ${p.number_sections ? 'checked' : ''}> Etkinlik bölümlerini 01, 02… diye numarala (Prime 4'te sıralı görünür)</label>
      <label class="field" style="margin-top:12px"><span>Taramada atlanacak klasörler (virgülle)</span><input type="text" id="pf_ex" value="${esc((p.extra_excludes || []).join(', '))}" placeholder="ör. Recording, Samples"></label>
      <div class="row"><label class="field" style="margin:0"><span>Tema</span><select id="pf_theme"><option value="dark" ${p.theme === 'dark' ? 'selected' : ''}>Koyu</option><option value="light" ${p.theme === 'light' ? 'selected' : ''}>Açık</option></select></label><span class="spacer"></span><button class="btn primary" id="psave">Kaydet</button></div>
    </div></div>
    <div class="panel"><div class="ph"><h2>Çalışma alanı</h2></div><div class="pb"><p class="path">${esc(st.workspace)}</p><p class="muted small">Yedekler, raporlar ve dışa aktarılan dosyalar burada durur.</p><div class="row"><button class="btn" id="ow">${ic('folder')}Klasörü aç</button><button class="btn" id="rs">Raporu kaydet</button></div></div></div></div>`;
  $('#rot').onclick = async () => {
    if (a.readonly) { if (await requireWritable('Düzeltme ve senkron işlemleri')) render(); }
    else { await api('library/update', { readonly: true }); await refreshState(); render(); }
  };
  $('#ren').onclick = async () => { const n = await promptBox('Kütüphane adı', 'Ad', a.name); if (!n) return; await api('library/update', { name: n }); await refreshState(); render(); };
  $('#add').onclick = addLibraryFlow;
  $('#rm').onclick = async () => { if (!(await confirmBox('Programdan kaldır', '<p>Bu kütüphane programın listesinden çıkarılır. Müzik dosyalarına, Serato\'ya ve Engine\'e dokunulmaz; katalog dosyası bilgisayarda kalır.</p>', 'Kaldır', true))) return; await api('library/remove', { id: a.id }); invalidate(); await refreshState(); location.hash = '#/genel'; render(); };
  $('#psave').onclick = async () => {
    await api('prefs', { engine_folder: $('#pf_engine').value.trim() || 'DJ Doktor', serato_parent: $('#pf_serato').value.trim() || 'DJ Doktor', serato_dialect: $('#pf_dial').value,
      lowbitrate_kbps: +$('#pf_br').value || 192, number_sections: $('#pf_num').checked, theme: $('#pf_theme').value,
      extra_excludes: $('#pf_ex').value.split(',').map((x) => x.trim()).filter(Boolean) });
    await refreshState(); toast('Ayarlar kaydedildi.', 'ok'); render();
  };
  $('#ow').onclick = () => api('open', { path: st.workspace });
  $('#rs').onclick = async () => { const r = await api('report/save', {}); toast('Rapor kaydedildi.', 'ok'); api('open', { path: r.path, select: true }); };
}

/* ------------------------------------------------------------------ */
/* Başlangıç                                                            */
/* ------------------------------------------------------------------ */
(async function init() {
  renderPlayer();
  parseRoute();
  try { await refreshState(); } catch (e) { $('#main').innerHTML = `<div class="page"><div class="banner err">${esc(e.message)}</div></div>`; return; }
  for (const t of S.state.tasks || []) {
    // sayfa yenilendiğinde süren görevleri takip et
    const card = el(`<div class="task"><b>${esc(t.title)}</b><div class="msg">${esc(t.message)}</div><div class="bar"><i></i></div></div>`);
    $('#taskbox').appendChild(card);
    const poll = async () => { const x = await api('tasks/' + t.id).catch(() => null); if (!x || ['bitti', 'hata', 'iptal'].includes(x.status)) { card.remove(); invalidate(); render(); return; } $('.msg', card).textContent = x.message; $('i', card).style.width = Math.round(x.progress * 100) + '%'; setTimeout(poll, 600); };
    poll();
  }
  render();
})();
