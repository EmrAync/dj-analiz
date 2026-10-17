"""Duyarlı yerleşim testi (Playwright + Chromium): python tests/ui_responsive.py [ekran_görüntüsü_klasörü]

Sentetik SSD (make_fixture + uzun Türkçe adlar, büyük bir tür, uzun notlu etkinlik) üzerinde düzeni kurar, sonra bir
görünüm matrisinde (800x600 … 2560x1440, %125 / %150 / %200 yakınlaştırma, büyük yazı, koyu tema, 360px) her ekranı gezer
ve şunları doğrular:
  * sayfa yatay taşmıyor (document.scrollingElement.scrollWidth <= innerWidth + 1), kabuk (#view, .split, #top) taşmıyor;
  * görünür hiçbir öğenin kenarı pencerenin dışında değil (kasıtlı yatay kaydırıcı içindeyse sayılmaz);
  * ana kaydırıcı son satıra ulaşıyor (son satır görünür ve üstünü bir şey örtmüyor);
  * her görünür sanal tablonun şarkı / başlık sütunu >= 120px (dar pencerede tablonun >= %30'u);
  * açık menü pencerenin içinde ve (yer varsa) çapasını örtmüyor, ↓ ile gezilir, kaydırınca / ikinci tıklamada kapanır;
    pencere ve ayrıntı paneli içeride, yatay kaymıyor;
  * seçim varken toplu işlem çubuğu görünür; bildirimler, görev kartı ve toplu işlem çubuğu çakışmıyor;
  * not kutusuna odaklanmak sayfayı yana kaydırmıyor; liste ağacı sürüklenerek genişliyor, çift tıkla geri dönüyor;
  * konsol / sunucu hatası yok.
Hataları okunur bir liste olarak yazar ve hata varsa 1 ile çıkar.
Ortam: DJD_UI_PORT (varsayılan 8902), DJD_RESP_CFG=800x600,1366x768 (yalnız bu görünümler), DJD_TEST_BASE.
"""
from __future__ import annotations

import os
import shutil
import sys
import tempfile
import threading
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "vendor"))
sys.path.insert(0, os.path.join(HERE, ".."))
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(tempfile.gettempdir(), "djd_ui_responsive")
os.makedirs(OUT, exist_ok=True)

TMP = tempfile.mkdtemp(prefix="djd_resp_", dir=os.environ.get("DJD_TEST_BASE"))
os.environ["DJDOKTOR_HOME"] = os.path.join(TMP, "ws")
os.environ["HOME"] = os.path.join(TMP, "home")
for d in ("home/Music", "home/Downloads"):
    os.makedirs(os.path.join(TMP, d), exist_ok=True)

import make_fixture as MF  # noqa: E402

ROOT = os.path.join(TMP, "SSD")
MF.build(ROOT)
# Uzun, boşluksuz Türkçe adlar (indirme paketlerinde sık): yerleşimi zorlar
LONGF = "ÇOKUZUNKLASÖRADI_DüğünKınaNişanSünnetMatineHalayHoronAnkaraOyunHavasıKarışıkSeçmeler2024_2025_YEDEK_v3"
LONGN = "Grup_Yıldızlar_ve_Arkadaşları_-_Çiftetelli_Oyun_Havası_Karışık_Uzun_Versiyon_Remix_2025_Extended_Club_Mix_320kbps"
LONGT = "Çok uzun bir şarkı adı ile sanatçı adı burada yer alıyor ve bitmiyor da bitmiyor (Canlı Kayıt, Düğün 2024)"
MF.write_mp3(os.path.join(ROOT, "melis music", "secilecek", LONGF, LONGN + ".mp3"), 501, 40, LONGN,
             "Grup_Yıldızlar_ve_Arkadaşları_Orkestrası_ve_Solistleri")
MF.write_mp3(os.path.join(ROOT, "melis music", "secilecek", LONGF, "Kısa.mp3"), 502, 40, "Kısa", "A")
MF.write_mp3(os.path.join(ROOT, "melis music", "HALAYLAR", "Uzun Halay.mp3"), 503, 40, LONGT, "Çok Uzun Sanatçı Adı ve Orkestrası")
# büyük bir tür: kaydırma, son satır ve toplu işlem çubuğu için
for i in range(140):
    MF.write_mp3(os.path.join(ROOT, "melis music", "HALAYLAR", "Halay %03d.mp3" % i), 1000 + i, 12,
                 "Halay Parçası %03d" % i, "Sanatçı %d" % (i % 9))
GELEN = os.path.join(TMP, "home", "Music", "DJ Gelen")
MF.write_mp3(os.path.join(GELEN, LONGN + "_gelen.mp3"), 701, 30, LONGN, "Z")
MF.write_mp3(os.path.join(TMP, "home", "Downloads", LONGN + "_indirilen.mp3"), 801, 30, LONGN, "Z")
MF.write_mp3(os.path.join(TMP, "home", "Downloads", "Unutulan Halay.mp3"), 802, 30, "Unutulan Halay", "Z")

from djdoktor import server, util  # noqa: E402

FAKE = {"open": False}
_orig_pr = getattr(util, "process_running", None)
if _orig_pr:   # başlık "Engine DJ açık · kilitli" durumunu da sınamak için uygulamaları açık gösterebiliriz
    util.process_running = lambda names, fresh=False: list(names) if FAKE["open"] else _orig_pr(names, fresh)

PORT = int(os.environ.get("DJD_UI_PORT") or 8902)
threading.Thread(target=server.run, kwargs={"port": PORT, "open_browser": False}, daemon=True).start()
time.sleep(1.0)
URL = "http://127.0.0.1:%d/" % PORT

from playwright.sync_api import sync_playwright  # noqa: E402

CONFIGS = [  # ad, css genişlik, css yükseklik, piksel oranı, yazı, tema
    ("800x600", 800, 600, 1, "normal", "light"),
    ("1024x768", 1024, 768, 1, "normal", "light"),
    ("1280x720", 1280, 720, 1, "normal", "light"),
    ("1366x768", 1366, 768, 1, "normal", "light"),
    ("1440x900", 1440, 900, 1, "normal", "light"),
    ("1920x1080", 1920, 1080, 1, "normal", "light"),
    ("2560x1440", 2560, 1440, 1, "normal", "light"),
    ("1280x800@125", 1024, 640, 1.25, "normal", "light"),
    ("1280x800@150", 853, 533, 1.5, "normal", "light"),
    ("1280x800@200", 640, 400, 2, "normal", "light"),
    ("large_1280x720", 1280, 720, 1, "large", "light"),
    ("large_1024x768", 1024, 768, 1, "large", "light"),
    ("dark_1366x768", 1366, 768, 1, "normal", "dark"),
    ("360x640", 360, 640, 1, "normal", "light"),
]
if os.environ.get("DJD_RESP_CFG"):
    want = os.environ["DJD_RESP_CFG"].split(",")
    CONFIGS = [c for c in CONFIGS if c[0] in want]

FAILS = []

# Genel denetim: döndürdüğü her metin bir hatadır
AUDIT_JS = r"""(o) => {
  o = o || {};
  const W = innerWidth, H = innerHeight, out = [];
  const se = document.scrollingElement;
  if (se.scrollWidth > W + 1) out.push(`sayfa yatay taşıyor: ${se.scrollWidth} > ${W}`);
  if (se.scrollLeft || se.scrollTop) out.push(`sayfa kaymış: scrollLeft=${se.scrollLeft} scrollTop=${se.scrollTop}`);
  for (const sel of ["#top", "#view", "#view > .split"]) {
    const el = document.querySelector(sel);
    if (el && el.scrollWidth > el.clientWidth + 1) out.push(`${sel} içeriği kesiliyor (kaydırıcı yok): ${el.scrollWidth} > ${el.clientWidth}`);
    if (el && (el.scrollLeft || 0) > 0) out.push(`${sel} yana kaymış: ${el.scrollLeft}`);
  }
  const top = document.getElementById("top");
  if (top && Math.abs(top.getBoundingClientRect().left) > 1) out.push("#top yana kaymış");
  const set = document.getElementById("settings");
  if (set) { const r = set.getBoundingClientRect(); if (r.right > W + 1 || r.width < 4) out.push("⚙ Ayarlar düğmesi görünmüyor"); }
  const desc = (el) => { let s = el.tagName.toLowerCase(); if (el.id) s += "#" + el.id; if (el.classList.length) s += "." + Array.from(el.classList).slice(0, 3).join("."); const t = (el.innerText || el.value || "").replace(/\s+/g, " ").trim().slice(0, 40); return s + (t ? ` «${t}»` : ""); };
  const structural = new Set([document.documentElement, document.body, document.getElementById("view"), document.getElementById("top")]);
  document.querySelectorAll("#view > .split").forEach((x) => structural.add(x));
  const bad = [];
  for (const el of document.querySelectorAll("body *")) {
    if (["SCRIPT", "STYLE", "AUDIO", "OPTION", "OPTGROUP", "COL", "COLGROUP", "BR"].includes(el.tagName)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    if (r.right <= W + 1.5 && r.left >= -1.5) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none") continue;
    let ok = false;
    for (let p = el.parentElement; p; p = p.parentElement) {
      const ps = getComputedStyle(p);
      const ox = ps.overflowX;
      if (ox === "auto" || ox === "scroll") { const pr = p.getBoundingClientRect(); if (pr.right <= W + 1.5 && pr.left >= -1.5) { ok = true; break; } }
      if ((ox === "hidden" || ox === "clip") && !structural.has(p)) { const pr = p.getBoundingClientRect(); if (pr.right <= W + 1.5 && pr.left >= -1.5) { ok = true; break; } }
      if (structural.has(p)) break;
    }
    if (ok) continue;
    const par = el.parentElement, pr = par && par.getBoundingClientRect();
    if (par && pr && (pr.right > W + 1.5 || pr.left < -1.5) && !structural.has(par)) continue;  // yalnız en dıştaki taşanı yaz
    bad.push(`${desc(el)} pencere dışında (sol ${Math.round(r.left)}, sağ ${Math.round(r.right)} / ${W})`);
  }
  out.push(...bad.slice(0, 6));
  // sanal tablolar: şarkı / başlık sütunu okunur genişlikte
  for (const t of document.querySelectorAll("table.t.v")) {
    if (t.hidden || !t.offsetParent) continue;
    const td = t.querySelector("tbody tr:not(.vpad) td.c-song");
    if (!td) continue;
    const tr = t.getBoundingClientRect(), w = td.getBoundingClientRect().width;
    if (w < 120 && w < tr.width * .3) out.push(`#${t.id} şarkı sütunu çok dar: ${Math.round(w)}px (tablo ${Math.round(tr.width)}px)`);
    if (t.style.minWidth) {
      const b = t.closest(".body") || t.parentElement;
      // telefon genişliğinde (< 480px) tablonun kendi kutusunda yatay kayması tasarım gereği; masaüstünde olmamalı
      if (b && b.scrollWidth > b.clientWidth + 1 && !o.allowTableScroll && W >= 480) out.push(`#${t.id} sığmıyor, yatay kayıyor (${t.style.minWidth})`);
    }
  }
  // açık menü
  const m = document.querySelector("#menu .menu");
  if (m) {
    const r = m.getBoundingClientRect();
    if (r.left < -.5 || r.top < -.5 || r.right > W + .5 || r.bottom > H + .5) out.push(`menü pencere dışında: ${Math.round(r.left)},${Math.round(r.top)}-${Math.round(r.right)},${Math.round(r.bottom)}`);
    if (o.anchor) {
      const a = document.querySelector(o.anchor);
      if (a) {
        const ar = a.getBoundingClientRect();
        const ix = Math.min(r.right, ar.right) - Math.max(r.left, ar.left), iy = Math.min(r.bottom, ar.bottom) - Math.max(r.top, ar.top);
        const room = Math.max(H - ar.bottom, ar.top) - 16;
        if (ix > 2 && iy > 2 && room >= Math.min(m.scrollHeight, 150)) out.push("menü kendi düğmesini örtüyor");
      }
    }
  }
  // pencere ve ayrıntı paneli
  for (const [sel, body] of [[".dialog", ".db"], [".drawer", ".dw-b"]]) {
    const d = document.querySelector(sel);
    if (!d) continue;
    const r = d.getBoundingClientRect();
    if (r.left < -.5 || r.top < -.5 || r.right > W + .5 || r.bottom > H + .5) out.push(`${sel} pencere dışında`);
    const b = d.querySelector(body);
    if (b && b.scrollWidth > b.clientWidth + 1) out.push(`${sel} ${body} yatay kayıyor: ${b.scrollWidth} > ${b.clientWidth}`);
  }
  // alt katman: bildirimler, görev kartı, toplu işlem çubuğu
  const layers = [...document.querySelectorAll(".toast, #taskbar .task, .bulk")].filter((x) => x.offsetParent);
  for (const x of layers) {
    const r = x.getBoundingClientRect();
    if (r.left < -.5 || r.top < -.5 || r.right > W + .5 || r.bottom > H + .5) out.push(`${desc(x)} pencere dışında`);
  }
  for (let i = 0; i < layers.length; i++) for (let j = i + 1; j < layers.length; j++) {
    const a = layers[i].getBoundingClientRect(), b = layers[j].getBoundingClientRect();
    if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1)
      out.push(`çakışıyor: ${desc(layers[i])} ↔ ${desc(layers[j])}`);
  }
  if (o.bulk) {
    const bk = document.querySelector(".bulk");
    if (!bk) out.push("seçim var ama toplu işlem çubuğu yok");
    else {
      const r = bk.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + 20, r.top + r.height / 2);
      if (r.bottom > H + .5 || r.top < 0 || !hit || !bk.contains(hit)) out.push("toplu işlem çubuğu görünmüyor");
    }
  }
  return out;
}"""

# Ana kaydırıcıyı sona kaydır, son satır görünüyor mu?
LAST_ROW_JS = r"""async (sel) => {
  const t = document.querySelector(sel);
  if (!t) return null;
  const sc = t.closest(".body") || t.parentElement;
  const frames = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  for (let k = 0; k < 3; k++) { sc.scrollTop = sc.scrollHeight; await frames(); }
  const st = Object.values(VT).find((x) => x.table === t);
  const rows = t.querySelectorAll("tbody tr:not(.vpad)");
  const last = rows[rows.length - 1];
  const out = [];
  if (st && st.b !== st.rows.length) out.push(`${sel}: son satırlar çizilmedi (${st.b}/${st.rows.length})`);
  if (!last) return out.concat([`${sel}: satır yok`]);
  const r = last.getBoundingClientRect(), s = sc.getBoundingClientRect();
  const hsb = sc.offsetHeight - sc.clientHeight;
  if (r.bottom > s.bottom - hsb + 1 || r.top < s.top - 1) out.push(`${sel}: son satıra ulaşılamıyor (satır ${Math.round(r.top)}-${Math.round(r.bottom)}, kaydırıcı ${Math.round(s.top)}-${Math.round(s.bottom - hsb)})`);
  const hit = document.elementFromPoint(Math.max(s.left, r.left) + 30, (r.top + r.bottom) / 2);
  if (hit && !last.contains(hit)) out.push(`${sel}: son satırın üstünü başka bir şey örtüyor (${hit.className || hit.tagName})`);
  sc.scrollTop = 0;
  await frames();
  return out;
}"""


def run_cfg(b, cfg, ids):
    name, w, h, dpr, size, theme = cfg
    ctx = b.new_context(viewport={"width": w, "height": h}, device_scale_factor=dpr)
    page = ctx.new_page()
    errs = []
    page.on("console", lambda m: errs.append("console %s: %s" % (m.type, m.text)) if m.type == "error" else None)
    page.on("pageerror", lambda e: errs.append("pageerror: %s" % e))
    page.on("response", lambda r: errs.append("http %d %s" % (r.status, r.url)) if r.status >= 500 else None)

    def fail(screen, msgs):
        for m in msgs or []:
            FAILS.append("[%s] %s: %s" % (name, screen, m))

    def settle(ms=250):
        page.wait_for_timeout(ms)
        page.evaluate("() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))")

    def check(screen, shot=True, **o):
        settle()
        if shot:
            page.screenshot(path=os.path.join(OUT, "%s__%s.png" % (name, screen)))
        fail(screen, page.evaluate(AUDIT_JS, o))

    def last_row(screen, sel):
        fail(screen, page.evaluate(LAST_ROW_JS, sel))

    def music(view):
        page.evaluate("v => { S.tab = 'music'; S.view = v; S.sel.clear(); S.q = ''; return refresh(true); }", view)
        page.wait_for_selector("#mmain")

    page.goto(URL)
    page.wait_for_selector("#tabs .tab", timeout=30000)
    page.evaluate("p => api('/api/prefs', p)", {"theme": theme, "text_size": size})
    page.evaluate("() => { try { localStorage.removeItem('djd.lcols'); } catch (e) {} }")

    # --- Müzikler ---
    music("all")
    page.wait_for_selector("#ttab tbody tr[data-id]")
    check("muzik_tumu")
    last_row("muzik_tumu", "#ttab")
    page.evaluate("gid => { S.view = 'g:' + gid; return loadMusic(); }", ids["big_gid"])
    page.wait_for_selector("#ttab tbody tr[data-id]")
    check("muzik_tur")
    for i in (0, 1, 2):
        page.locator("#ttab tbody tr[data-id] td.c-chk input").nth(i).click()
    page.wait_for_selector(".bulk")
    check("muzik_secim", bulk=True)
    last_row("muzik_secim", "#ttab")
    page.click("#bmove")
    page.wait_for_selector("#menu .menu")
    check("menu_ture_tasi", anchor="#bmove", bulk=True)
    page.keyboard.press("Escape")
    # bildirimler + görev kartı + toplu işlem çubuğu birlikte
    page.evaluate("""(p) => { toast('Düzen kuruldu: 12 şarkı taşındı.', 'ok'); toast('Engine DJ açık. Lütfen kapatın; sonra yeniden dene. ' + p, 'err'); toast('Bilgi');
      taskCard({ id: 99999, title: 'Taranıyor — ' + p, progress: .42, message: '/Volumes/Serato DJ/' + p + '/' + p + '.mp3', cancellable: true }); }""", LONGN)
    check("katmanlar", bulk=True)
    page.evaluate("() => { document.getElementById('taskbar').innerHTML = ''; document.getElementById('toasts').innerHTML = ''; }")
    page.click("#bclear")
    music("unsorted")
    page.wait_for_selector("#ttab tbody tr[data-id]")
    check("turu_belli_degil")
    btns = page.locator("#ttab tbody tr[data-id] [data-pickg]")
    if btns.count():
        k = btns.count() - 1
        btns.nth(k).scroll_into_view_if_needed()
        btns.nth(k).click()
        page.wait_for_selector("#menu .menu")
        page.evaluate("() => { const m = document.querySelector('#menu .menu'); const a = m && m._anchor; if (a) a.id = 'tmpanchor'; }")
        check("menu_tur_sec", anchor="#tmpanchor")
        # ↓ ile menüde gezinme, sonra liste kayınca menü kapanmalı (çapası yerinden oynadı)
        page.keyboard.press("ArrowDown")
        if not page.evaluate("() => !!document.activeElement.closest('#menu .menu')"):
            fail("menu_tur_sec", ["↓ tuşu menü öğesine geçmedi"])
        moved = page.evaluate("""() => { const b = document.querySelector('#mmain .body'); const t0 = b.scrollTop;
          b.scrollTop = t0 > 60 ? t0 - 60 : t0 + 60; return b.scrollTop !== t0; }""")
        settle()
        if moved and page.locator("#menu .menu").count():
            fail("menu_tur_sec", ["liste kayınca menü kapanmadı"])
        page.keyboard.press("Escape")
    else:
        fail("turu_belli_degil", ["'Tür seç ▾' düğmesi görünmüyor"])
    if page.locator(".attn[data-view=dupes]").count():
        music("dupes")
        page.wait_for_selector(".dup")
        check("kopyalar")
    if page.locator(".attn[data-view=problems]").count():
        music("problems")
        page.wait_for_selector("#ttab, #tempty")
        check("sorunlar")

    # --- başlık: Engine ve Serato açık (kilit), uzun geri-al başlığı ---
    if _orig_pr:
        FAKE["open"] = True
        page.wait_for_timeout(2700)   # süreç önbelleği
        page.evaluate("() => refresh(true)")
        page.wait_for_function("() => !!document.querySelector('#status .pill.lock')", timeout=15000)
        check("baslik_kilitli")
        # eklentilerin eklediği sekmelerle de sığmalı (ör. Asistan, order 40)
        page.evaluate("""() => { DJD.tab({ key: 'x_test', label: 'Mix Asistanı', order: 45, load: async () => {} });
          DJD.tab({ key: 'y_test', label: 'Yapay zekâ', order: 46, load: async () => {} }); renderTop(); }""")
        check("baslik_eklenti_sekmeleri")
        fail("baslik_eklenti_sekmeleri", page.evaluate("""() => { const o = []; const on = document.querySelector('#tabs .tab.on');
          if (!on || on.getBoundingClientRect().width < 10) o.push('etkin sekme görünmüyor');
          const hid = document.querySelectorAll('#tabs .tab.ovf').length, more = document.getElementById('tabmore');
          if (hid && (!more || more.hidden)) o.push('gizlenen sekmeler için ⋯ düğmesi yok'); return o; }"""))
        if page.evaluate("() => !document.getElementById('tabmore').hidden"):
            page.click("#tabmore")
            page.wait_for_selector("#menu .menu")
            check("menu_sekmeler", anchor="#tabmore")
            page.keyboard.press("Escape")
        page.evaluate("() => { DJD.tabs = DJD.tabs.filter((t) => !/_test$/.test(t.key)); renderTop(); }")
        FAKE["open"] = False
        page.wait_for_timeout(2700)
        page.evaluate("() => refresh(true)")
        page.wait_for_function("() => !document.querySelector('#status .pill.lock')", timeout=15000)

    # --- Listeler ---
    page.evaluate("() => { S.tab = 'lists'; S.pickOpen = false; S.treeOpen = false; return refresh(true); }")
    page.wait_for_selector("#newev")
    page.evaluate("id => selectList(id)", ids["halay"])
    page.wait_for_selector("#ltab tbody tr[data-ref]")
    check("listeler_etkinlik")
    last_row("listeler_etkinlik", "#ltab")
    # not kutusuna odak: sayfa yana kaymamalı
    page.locator("#ltab input.note").first.focus()
    settle()
    fail("not_odak", page.evaluate("""() => { const o = []; const se = document.scrollingElement; const v = document.getElementById('view');
      if (se.scrollLeft || v.scrollLeft) o.push('not kutusu odakta sayfa yana kaydı'); if (Math.abs(document.getElementById('top').getBoundingClientRect().left) > 1) o.push('üst çubuk kaydı'); return o; }"""))
    page.evaluate("() => document.activeElement && document.activeElement.blur()")
    mode = page.evaluate("() => getComputedStyle(document.querySelector('.split.lists > .picker')).position")
    if mode == "absolute":   # dar: ekleme paneli çekmece
        if not page.locator("#pickbtn").is_visible():
            fail("listeler_ekle", ["'＋ Şarkı ekle' düğmesi görünmüyor"])
        else:
            page.click("#pickbtn")
            page.wait_for_selector("#picker .res, #picker .empty")
            check("listeler_ekle_paneli")
            page.click("#pickx")
    else:
        check("listeler_ekle_paneli", shot=False)
    side_abs = page.evaluate("() => getComputedStyle(document.querySelector('.split.lists > .side')).position") == "absolute"
    if side_abs:
        if not page.locator("#treebtn").is_visible():
            fail("listeler_agac", ["'☰' liste düğmesi görünmüyor"])
        else:
            page.click("#treebtn")
            page.wait_for_selector(".split.lists.tree-open")
            check("listeler_agac")
            page.click("#treex")
    # bölme tutamağı: ağacı sürükleyerek genişlet, tablo yine sığmalı; çift tık varsayılana döner
    gut = page.locator(".split.lists > .side > .gut")
    if gut.count() and gut.is_visible():
        w0 = page.evaluate("() => document.querySelector('.split.lists > .side').getBoundingClientRect().width")
        bb = gut.bounding_box()
        page.mouse.move(bb["x"] + bb["width"] / 2, bb["y"] + 200)
        page.mouse.down()
        page.mouse.move(bb["x"] + bb["width"] / 2 + 60, bb["y"] + 200, steps=4)
        page.mouse.move(bb["x"] + bb["width"] / 2 + 120, bb["y"] + 200, steps=4)
        page.mouse.up()
        w1 = page.evaluate("() => document.querySelector('.split.lists > .side').getBoundingClientRect().width")
        if w1 < w0 + 30:
            fail("bolme", ["ağaç sürüklenerek genişlemedi (%d → %d)" % (w0, w1)])
        check("bolme_genis")
        gut.dblclick()
        settle()
        w2 = page.evaluate("() => document.querySelector('.split.lists > .side').getBoundingClientRect().width")
        if abs(w2 - w0) > 2:
            fail("bolme", ["çift tık varsayılan genişliğe dönmedi (%d → %d)" % (w0, w2)])
    page.click("#lmenu")
    page.wait_for_selector("#menu .menu")
    page.locator("#menu button", has_text="Başka klasöre taşı").click()
    page.wait_for_selector("#menu .menu")
    check("menu_klasore_tasi")
    page.keyboard.press("Escape")
    page.evaluate("id => selectList(id)", ids["big_list"])
    page.wait_for_selector("#ltab tbody tr[data-ref]")
    check("listeler_uzun")
    last_row("listeler_uzun", "#ltab")
    if side_abs:
        page.click("#treebtn")
    page.click("#newev")
    page.wait_for_selector(".dialog #evt")
    check("yeni_etkinlik")
    fail("yeni_etkinlik", page.evaluate("""() => Array.from(document.querySelectorAll('.dialog .opt')).filter((o) => {
      const d = o.querySelector(':scope > div'); return d && d.getBoundingClientRect().width < o.getBoundingClientRect().width * .6; }).map(() => 'seçenek metni sıkışmış')"""))
    page.keyboard.press("Escape")
    page.evaluate("id => gigCheck(id)", ids["ev"])
    page.wait_for_selector(".gc")
    check("etkinlik_kontrol")
    page.keyboard.press("Escape")

    # --- Gelen ---
    page.evaluate("() => { S.tab = 'inbox'; return refresh(true); }")
    page.wait_for_selector("#openin")
    check("gelen")
    page.evaluate("() => { const b = document.querySelector('.main > .body'); b.scrollTop = b.scrollHeight; }")
    check("gelen_alt")

    # --- Araçlar ---
    def tool(k, sel):
        page.evaluate("k => { S.tab = 'tools'; S.tview = k; return refresh(true); }", k)
        page.wait_for_selector(sel)

    tool("health", "#tmain")
    show = page.locator("[data-hshow]")
    for i in range(min(show.count(), 3)):
        page.locator("[data-hshow]").nth(i).click()
        page.wait_for_timeout(150)
    check("saglik")
    if page.locator("[data-hact=rename]").count():
        page.click("[data-hact=rename]")
        page.wait_for_selector(".dialog")
        check("adlari_duzelt")
        page.keyboard.press("Escape")
    tool("table", "#libt tbody tr[data-id]")
    check("tablo")
    last_row("tablo", "#libt")
    page.click("#lcolbtn")
    page.wait_for_selector("#menu .menu")
    check("menu_sutunlar", anchor="#lcolbtn")
    page.click("#lcolbtn")   # aynı düğmeye ikinci tıklama menüyü kapatır
    settle(100)
    if page.locator("#menu .menu").count():
        fail("menu_sutunlar", ["düğmeye ikinci tıklama menüyü kapatmadı"])
    page.keyboard.press("Escape")
    page.evaluate("() => { localStorage.setItem('djd.lcols', JSON.stringify(LCOLS.map((c) => c.k))); rebuildLibTable(); }")
    check("tablo_tum_sutunlar", allowTableScroll=True)
    page.evaluate("() => { localStorage.removeItem('djd.lcols'); rebuildLibTable(); }")
    page.locator("#libt td.c-song").first.click()
    page.wait_for_selector(".drawer")
    check("ayrinti")
    page.click(".drawer [data-dlist]")
    page.wait_for_selector("#menu .menu")
    check("menu_listeye_ekle")
    page.keyboard.press("Escape")
    page.keyboard.press("Escape")
    tool("export", "[data-exp=xml]")
    check("disa_aktar")
    tool("history", "#tmain .body")
    check("gecmis")
    page.evaluate("() => settingsDialog()")
    page.wait_for_selector(".dialog #ptheme")
    check("ayarlar")
    page.keyboard.press("Escape")

    for e in errs:
        FAILS.append("[%s] %s" % (name, e))
    ctx.close()


def run_setup_cfg(b, cfg):
    name, w, h, dpr, size, theme = cfg
    ctx = b.new_context(viewport={"width": w, "height": h}, device_scale_factor=dpr)
    pg = ctx.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append("pageerror: %s" % e))
    pg.on("console", lambda m: errs.append("console %s: %s" % (m.type, m.text)) if m.type == "error" else None)
    try:
        pg.goto(URL)
        pg.wait_for_selector("text=Düzeni kuralım", timeout=60000)
        pg.evaluate("p => api('/api/prefs', p).then(applyPrefs)", {"theme": theme, "text_size": size})
        pg.wait_for_timeout(300)
        pg.screenshot(path=os.path.join(OUT, "%s__kurulum.png" % name))
        for m in pg.evaluate(AUDIT_JS, {}):
            FAILS.append("[%s] kurulum: %s" % (name, m))
        vis = pg.evaluate("""() => { const s = document.querySelector('select.assign'); if (!s) return false; const r = s.getBoundingClientRect();
          const t = s.closest('table').getBoundingClientRect(); const c = s.closest('.card').getBoundingClientRect();
          return r.width > 60 && r.right <= Math.min(t.right, c.right, innerWidth) + 1; }""")
        if not vis:
            FAILS.append("[%s] kurulum: 'Nereye' seçimi görünmüyor" % name)
        foot = pg.evaluate("""() => { const f = document.getElementById('sapply'); if (!f) return false; const r = f.getBoundingClientRect();
          return r.bottom <= innerHeight + 1 && r.top >= 0; }""")
        if not foot:
            FAILS.append("[%s] kurulum: 'Düzeni kur' düğmesi ekranda değil (en alta kaydırmak gerekiyor)" % name)
        pg.click("#gadd")
        pg.wait_for_selector("#menu .menu")
        pg.screenshot(path=os.path.join(OUT, "%s__kurulum_menu.png" % name))
        for m in pg.evaluate(AUDIT_JS, {"anchor": "#gadd"}):
            FAILS.append("[%s] kurulum menü: %s" % (name, m))
    finally:
        FAILS.extend("[%s] %s" % (name, e) for e in errs)
        ctx.close()


def wait_task(page, timeout=90000):
    page.wait_for_function("() => !document.querySelector('#taskbar .task')", timeout=timeout)
    page.wait_for_timeout(300)


with sync_playwright() as p:
    chrome = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
    b = p.chromium.launch(executable_path=chrome if os.path.exists(chrome) else None)
    page = b.new_page(viewport={"width": 1366, "height": 768})
    perr = []
    page.on("pageerror", lambda e: perr.append("pageerror: %s" % e))
    page.goto(URL)
    page.wait_for_selector("text=Merhaba")
    page.evaluate("root => chooseRoot(root)", ROOT)
    page.wait_for_selector("text=Düzeni kuralım", timeout=90000)
    page.close()
    # Kurulum ekranı: her görünümde
    for cfg in CONFIGS:
        try:
            run_setup_cfg(b, cfg)
        except Exception as e:
            FAILS.append("[%s] kurulum akışı durdu: %s" % (cfg[0], str(e).splitlines()[0]))
    # Düzeni kur, sonra etkinlik ve uzun listeler hazırla
    page = b.new_page(viewport={"width": 1366, "height": 768})
    page.on("pageerror", lambda e: perr.append("pageerror: %s" % e))
    page.goto(URL)
    page.wait_for_selector("text=Düzeni kuralım", timeout=60000)
    page.evaluate("() => api('/api/prefs', {theme: 'light', text_size: 'normal'})")
    page.click("#sapply")
    page.click(".dialog [data-x=yes]")
    wait_task(page)
    page.wait_for_selector("#ttab, .attn", timeout=60000)
    ids = page.evaluate("""async ([L, T]) => {
      const ids = {};
      const ov = await api('/api/overview');
      const big = ov.genres.reduce((a, g) => (g.count > (a ? a.count : -1) ? g : a), null);
      ids.big_gid = big.id;
      let parent = 0;
      for (const t of ['Arşiv', 'Eski Etkinlikler 2019-2025 (Serato\\'dan aktarılanlar)', L, 'Düğünler', 'Haziran ayı düğünleri ve kına geceleri', 'Kına', L.slice(0, 60)]) {
        const r = await api('/api/list/create', { parent, title: t }); parent = r.id; }
      const ev = await api('/api/event/new', { title: 'Ahmet & Ayşe Düğünü – Büyük Salon ' + L.slice(0, 50), date: '2026-06-20', venue: 'Kristal Düğün Salonu ' + L.slice(0, 40), template: 'dugun' });
      ids.ev = ev.id;
      const ls = await api('/api/lists');
      const kids = ls.lists.filter((x) => x.parent === ev.id);
      const halay = kids.find((x) => x.title === 'Halay') || kids[0];
      ids.halay = halay.id;
      const res = await api('/api/search?q=' + encodeURIComponent('Halay') + '&limit=60');
      const longs = await api('/api/search?q=' + encodeURIComponent('Çok uzun') + '&limit=5');
      const lg = await api('/api/search?q=' + encodeURIComponent('Grup_Yıldızlar') + '&limit=5');
      await api('/api/list/add', { id: halay.id, fids: longs.concat(lg).concat(res.slice(0, 40)).map((x) => x.id) });
      const it = await api('/api/list/' + halay.id);
      let k = 0;
      for (const r of it.items.slice(0, 5)) await api('/api/list/note', { id: halay.id, ref: r.ref, note: (k++ % 2 ? 'gelin girişinden hemen sonra çal, davulcu gelince geç – ' : 'NOT ') + (k % 3 ? '' : T) });
      const lst = await api('/api/list/create', { parent: 0, title: 'Tüm halaylar (uzun liste)' });
      const all = await api('/api/search?q=&limit=500');
      await api('/api/list/add', { id: lst.id, fids: all.map((x) => x.id) });
      ids.big_list = lst.id;
      return ids;
    }""", [LONGF, LONGT])
    page.close()
    print("Hazır:", ids)
    for cfg in CONFIGS:
        t0 = time.time()
        try:
            run_cfg(b, cfg, ids)
        except Exception as e:  # bir görünümde akış koptuysa diğerleri yine denensin
            FAILS.append("[%s] akış durdu: %s" % (cfg[0], str(e).splitlines()[0]))
        print("  %-16s %4.1f sn" % (cfg[0], time.time() - t0))
    FAILS.extend(perr)
    b.close()

if FAILS:
    print("\nDuyarlı yerleşim HATALARI (%d):" % len(FAILS))
    for f in FAILS:
        print("  -", f)
else:
    print("\nDuyarlı yerleşim: tüm görünümlerde sorun yok.")
print("Ekranlar:", OUT)
shutil.rmtree(TMP, ignore_errors=True)
sys.exit(1 if FAILS else 0)
