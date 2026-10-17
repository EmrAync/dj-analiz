"""Adlar ekranı arayüz testi (Playwright + Chromium): python3 -B tests/ui_rename.py [ekran_görüntüsü_klasörü]

Araçlar > Adlar: önizleme (sanal tablo), satır seçimi, Uygula, Geri al; Kayıp yollar > Bul ve bağla; Sağlık'tan
geçiş; şarkı ayrıntısından tek ad değiştirme; dar pencere. Konsol hatası, sayfa hatası ya da 5xx olursa başarısız.
Port: DJD_UI_PORT (varsayılan 8911).
"""
from __future__ import annotations

import os
import shutil
import sys
import tempfile
import threading
import time
import unicodedata

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "vendor"))
sys.path.insert(0, os.path.join(HERE, ".."))
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(tempfile.gettempdir(), "djd_ui_rename")
os.makedirs(OUT, exist_ok=True)

TMP = tempfile.mkdtemp(prefix="djd_uirn_", dir=os.environ.get("DJD_TEST_BASE"))
os.environ["DJDOKTOR_HOME"] = os.path.join(TMP, "ws")
os.environ["HOME"] = os.path.join(TMP, "home")
os.makedirs(os.path.join(TMP, "home", "Music"), exist_ok=True)

import make_fixture  # noqa: E402
from djdoktor import maintain, relink, relocate, serato, server  # noqa: E402
from djdoktor.config import Settings  # noqa: E402
from djdoktor.library import Library  # noqa: E402

NFD = make_fixture.mac_form
ROOT = os.path.join(TMP, "SSD")
make_fixture.build(ROOT)
s = Settings()
lib = Library(s, s.add_library(ROOT, "SSD"))
lib.full_scan()
relocate.setup_apply(lib, "Müzik")
# Türkçe adlı klasör + Mac (NFD) crate; Sağlık'ta 'sorunlu ad' çıksın diye Mac'in ':' karakteri
t = os.path.join(ROOT, "Müzik", "Türkçe Pop", "Türküler")
make_fixture.write_mp3(os.path.join(t, "Neşet Ertaş - Gönül Dağı Türkü.mp3"), 701, 150, "Gönül Dağı", "Neşet Ertaş")
make_fixture.write_mp3(os.path.join(t, "Belalım Türkü.mp3"), 702, 150, "Belalım", "X")
make_fixture.write_mp3(os.path.join(ROOT, "Müzik", "Halay", "ROMAN  MEZDEKE.mp3"), 703, 40, "Roman", "R")
# hiç görülmemiş 'Şiir.mp3' için crate kaydı; diskte katlanınca aynı iki ad var -> birden çok aday
make_fixture.write_mp3(os.path.join(ROOT, "Müzik", "Horon", "Siir.mp3"), 704, 30, "Siir", "A")
make_fixture.write_mp3(os.path.join(ROOT, "Müzik", "Horon", "SİİR.mp3"), 705, 30, "SİİR", "B")
lib.full_scan()
maintain.after_change(lib)
sd = os.path.join(ROOT, "_Serato_", "Subcrates")
with open(os.path.join(sd, "Şiirler.crate"), "wb") as f:
    f.write(serato.build_crate([NFD("Müzik/Horon/Şiir.mp3")]))
with open(os.path.join(sd, "Türküler.crate"), "wb") as f:
    f.write(serato.build_crate([NFD("Müzik/Türkçe Pop/Türküler/Neşet Ertaş - Gönül Dağı Türkü.mp3"),
                                NFD("Müzik/Türkçe Pop/Türküler/Belalım Türkü.mp3")]))
lib.analyze_serato()
lib.catalog.close()
del lib
# arka plandaki otomatik bağlama bu testte kapalı: kayıp yolları arayüzden biz bağlayacağız
relink.auto = lambda lib_: None

PORT = int(os.environ.get("DJD_UI_PORT") or 8911)
threading.Thread(target=server.run, kwargs={"port": PORT, "open_browser": False}, daemon=True).start()
for _ in range(50):
    time.sleep(0.1)
    if getattr(server.Handler, "app", None) is not None and getattr(server.Handler.app, "port", None):
        break
time.sleep(0.6)
URL = "http://127.0.0.1:%d/" % server.Handler.app.port

from playwright.sync_api import sync_playwright  # noqa: E402

errors = []


def shot(page, name):
    page.wait_for_timeout(300)
    page.screenshot(path=os.path.join(OUT, name + ".png"), full_page=False)
    print("  ekran:", name)


def wait_task(page, timeout=60000):
    page.wait_for_function("() => !document.querySelector('#taskbar .task')", timeout=timeout)
    page.wait_for_timeout(350)


def disk(rel):
    return os.path.exists(os.path.join(ROOT, *rel.split("/")))


def no_hscroll(page, where):
    w = page.evaluate("() => [document.documentElement.scrollWidth, innerWidth, document.querySelector('#tmain') ? "
                      "document.querySelector('#tmain').scrollWidth - document.querySelector('#tmain').clientWidth : 0]")
    if w[0] > w[1] + 1 or w[2] > 1:
        errors.append("yatay taşma (%s): %s" % (where, w))


with sync_playwright() as p:
    exe = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
    b = p.chromium.launch(executable_path=exe if os.path.exists(exe) else None)
    page = b.new_page(viewport={"width": 1366, "height": 860})
    page.on("console", lambda m: errors.append("console %s: %s" % (m.type, m.text)) if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append("pageerror: %s" % e))
    page.on("response", lambda r: errors.append("http %d %s" % (r.status, r.url)) if r.status >= 500 else None)
    page.goto(URL)
    page.wait_for_selector("[data-tab=tools]", timeout=30000)
    # --- Araçlar > Adlar: önizleme
    page.click("[data-tab=tools]")
    page.wait_for_selector("[data-tv=names]")
    page.click("[data-tv=names]")
    page.wait_for_selector("#rntab tbody tr[data-rnid]", timeout=30000)
    n_rows = page.locator("#rntab tbody tr[data-rnid]").count()
    assert n_rows >= 8, n_rows
    assert page.locator("#rntab mark.rn-ins").count() > 0, "değişen harfler işaretlenmedi"
    shot(page, "rn01_onizleme")
    sel0 = page.inner_text("#rnsel")
    # bir satırın işaretini kaldır: tablo yeniden çizilmez, sayı azalır
    first = page.locator("#rntab tbody tr[data-rnid]").first
    rid = first.get_attribute("data-rnid")
    page.evaluate("() => { window.__rnMark = document.querySelector('#rntab tbody tr[data-rnid]'); }")
    first.locator("input[data-rnck]").click()
    page.wait_for_timeout(150)
    assert page.inner_text("#rnsel") != sel0, (sel0, page.inner_text("#rnsel"))
    assert page.evaluate("() => window.__rnMark === document.querySelector('#rntab tbody tr[data-rnid]')"), \
        "tıklamada tablo yeniden çizildi"
    first.locator("input[data-rnck]").click()
    # kapsam: bir tür
    page.click("[data-rnscope]")
    page.locator(".menu button", has_text="Türkçe Pop").first.click()     # tür (klasör listesinde de var)
    page.wait_for_function("() => document.querySelector('[data-rnscope]').textContent.includes('Türkçe Pop')")
    page.wait_for_selector("#rntab tbody tr[data-rnid]")
    shot(page, "rn02_kapsam_tur")
    # kurallar paneli
    page.click("[data-rnadv]")
    page.wait_for_selector(".rn-adv")
    page.locator("[data-rnrule=spaces]").click()
    page.wait_for_timeout(600)
    shot(page, "rn03_kurallar")
    # tümüne dön ve uygula
    page.click("[data-rnpreset=engine_safe]")
    page.wait_for_timeout(300)
    page.click("[data-rnscope]")
    page.locator(".menu button", has_text="Tüm SSD").click()
    page.wait_for_timeout(600)
    page.wait_for_selector("#rnapply:not([disabled])")
    page.click("#rnapply")
    wait_task(page)
    page.wait_for_selector(".toast [data-u]")
    shot(page, "rn04_uygulandi")
    assert disk("Muzik/Turkce Pop/Turkuler/Belalim Turku.mp3"), os.listdir(ROOT)
    cr = serato.read_crate_file(os.path.join(sd, "Türküler.crate"))[0]
    assert cr == [NFD("Muzik/Turkce Pop/Turkuler/Neset Ertas - Gonul Dagi Turku.mp3"),
                  NFD("Muzik/Turkce Pop/Turkuler/Belalim Turku.mp3")], cr
    # bildirimdeki Geri al
    page.locator(".toast [data-u]").first.click()
    wait_task(page)
    page.wait_for_timeout(500)
    assert disk("Müzik/Türkçe Pop/Türküler/Belalım Türkü.mp3"), "geri alınmadı"
    shot(page, "rn05_geri_alindi")
    # --- Sağlık'tan: sorunlu adlar -> Adlar (yalnızca sorunlu karakterler)
    page.click("[data-tv=health]")
    page.wait_for_selector("[data-hact]", timeout=30000)
    if page.locator("[data-hact=rename]").count():
        page.click("[data-hact=rename]")
        page.wait_for_selector("#rntab tbody tr[data-rnid]")
        assert page.locator("[data-rnpreset=only_illegal].primary").count() == 1
        shot(page, "rn06_saglik_adlar")
    else:
        errors.append("Sağlık'ta 'Adları düzelt' düğmesi yok")
    # --- Program dışında yeniden adlandırma -> Kayıp yollar
    t2 = os.path.join(ROOT, "Müzik", "Türkçe Pop", "Turkuler")
    os.rename(t, t2)
    os.rename(os.path.join(t2, "Belalım Türkü.mp3"), os.path.join(t2, "Belalim Turku.mp3"))
    os.rename(os.path.join(t2, "Neşet Ertaş - Gönül Dağı Türkü.mp3"), os.path.join(t2, "Neset Ertas - Gonul Dagi Turku.mp3"))
    page.click("[data-rnmode=links]")
    page.wait_for_selector("#rnscan")
    page.click("#rnscan")
    wait_task(page)
    page.wait_for_selector("#rnltab tbody tr[data-rnkey]")
    shot(page, "rn07_kayip_yollar")
    assert "Kesin olanları bağla" in page.inner_text("#rnlink"), page.inner_text("#rnlink")
    # başlıktaki kutu: bulunanların hepsi kapanır / yeniden açılır (tablo yeniden çizilmez)
    page.click("#rnlall")
    page.wait_for_function("() => document.querySelector('#rnlink').disabled")
    page.click("#rnlall")
    page.wait_for_function("() => !document.querySelector('#rnlink').disabled")
    # birden çok aday: kullanıcı seçer
    page.locator("[data-rnpick]").first.click()
    page.locator(".menu button", has_text="Müzik/Horon/Siir.mp3").click()
    page.wait_for_function("() => document.querySelector('#rnlink').textContent.includes('Seçilenleri bağla')")
    shot(page, "rn07b_aday_secildi")
    page.click("#rnlink")
    wait_task(page)
    page.wait_for_selector(".toast [data-u]")
    cr = serato.read_crate_file(os.path.join(sd, "Türküler.crate"))[0]
    assert unicodedata.normalize("NFC", cr[1]) == "Müzik/Türkçe Pop/Turkuler/Belalim Turku.mp3", cr
    cr = serato.read_crate_file(os.path.join(sd, "Şiirler.crate"))[0]
    assert [unicodedata.normalize("NFC", x) for x in cr] == ["Müzik/Horon/Siir.mp3"], cr
    shot(page, "rn08_baglandi")
    # --- şarkı ayrıntısından tek ad
    page.click("[data-tab=music]")
    page.wait_for_selector("[data-info]", timeout=30000)
    page.locator("[data-info]").first.click()
    page.wait_for_selector(".drawer")
    page.locator(".drawer button", has_text="Adını değiştir").click()
    page.wait_for_selector("#rnone")
    page.fill("#rnone", "Yeni Ad Denemesi")
    page.wait_for_function("() => document.querySelector('#rnonepv').textContent.includes('Engine')", timeout=10000)
    shot(page, "rn09_tek_ad")
    page.click(".dialog [data-x=yes]")
    wait_task(page)
    page.wait_for_selector(".toast [data-u]")
    shot(page, "rn10_tek_ad_bitti")
    page.keyboard.press("Escape")
    page.wait_for_timeout(200)
    # --- dar pencere: yatay kaydırma yok
    page.click("[data-tab=tools]")
    page.wait_for_selector("[data-tv=names]")
    page.click("[data-tv=names]")
    page.click("[data-rnmode=names]")
    page.wait_for_selector("#rntab tbody tr[data-rnid], .empty")
    no_hscroll(page, "geniş")
    page.set_viewport_size({"width": 420, "height": 820})
    page.wait_for_timeout(700)
    no_hscroll(page, "dar")
    shot(page, "rn11_dar")
    page.set_viewport_size({"width": 1366, "height": 860})
    b.close()

print("Hatalar:" if errors else "Konsol/sunucu hatası yok.")
for e in errors:
    print("  ", e)
print("Ekranlar:", OUT)
shutil.rmtree(TMP, ignore_errors=True)
sys.exit(1 if errors else 0)
