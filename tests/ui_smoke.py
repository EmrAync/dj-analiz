"""Arayüz duman testi (Playwright + Chromium): python tests/ui_smoke.py [ekran_görüntüsü_klasörü]"""
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
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(tempfile.gettempdir(), "djd_ui")
os.makedirs(OUT, exist_ok=True)

TMP = tempfile.mkdtemp(prefix="djd_ui_", dir=os.environ.get("DJD_TEST_BASE"))  # örn. exFAT bağlama noktası
os.environ["DJDOKTOR_HOME"] = os.path.join(TMP, "ws")
os.environ["HOME"] = os.path.join(TMP, "home")
os.makedirs(os.path.join(TMP, "home", "Music"), exist_ok=True)
os.makedirs(os.path.join(TMP, "home", "Downloads"), exist_ok=True)

import make_fixture  # noqa: E402

ROOT = os.path.join(TMP, "SSD")
make_fixture.build(ROOT)
make_fixture.write_mp3(os.path.join(TMP, "home", "Downloads", "Unutulan Halay.mp3"), 201, 150, "Unutulan Halay", "Z")

from djdoktor import server  # noqa: E402

PORT = 8899
threading.Thread(target=server.run, kwargs={"port": PORT, "open_browser": False}, daemon=True).start()
time.sleep(1.0)
URL = "http://127.0.0.1:%d/" % PORT

from playwright.sync_api import sync_playwright  # noqa: E402

errors = []


def shot(page, name):
    page.wait_for_timeout(350)
    page.screenshot(path=os.path.join(OUT, name + ".png"), full_page=False)
    print("  ekran:", name)


def wait_task(page, timeout=60000):
    page.wait_for_function("() => !document.querySelector('#taskbar .task')", timeout=timeout)
    page.wait_for_timeout(300)


with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
                          if os.path.exists("/opt/pw-browsers/chromium-1194/chrome-linux/chrome") else None)
    page = b.new_page(viewport={"width": 1440, "height": 900})
    page.on("console", lambda m: errors.append("console %s: %s" % (m.type, m.text)) if m.type in ("error",) else None)
    page.on("pageerror", lambda e: errors.append("pageerror: %s" % e))
    page.on("response", lambda r: errors.append("http %d %s" % (r.status, r.url)) if r.status >= 500 else None)
    page.goto(URL)
    page.wait_for_selector("text=Merhaba")
    shot(page, "01_ssd_sec")
    page.evaluate("root => chooseRoot(root)", ROOT)
    page.wait_for_selector("text=Düzeni kuralım", timeout=60000)
    shot(page, "02_kurulum")
    # bir klasörün atamasını değiştir (Dj Özlem -> Giriş)
    page.select_option("select.assign[data-rel='Dj Özlem']", "g:Giriş - Pasta - Özel")
    page.wait_for_timeout(900)
    shot(page, "03_kurulum_degisti")
    page.click("#sapply")
    page.click(".dialog [data-x=yes]")
    wait_task(page)
    page.wait_for_selector("text=Türü belli değil")
    shot(page, "04_turu_belli_degil")
    # önerilen türe taşı
    btn = page.locator("[data-sugg]").first
    if btn.count():
        btn.click()
        wait_task(page)
    shot(page, "05_oneri_uygulandi")
    # kopyalar
    page.click(".attn[data-view=dupes]")
    page.wait_for_selector("text=Hepsini önerildiği gibi")
    shot(page, "06_kopyalar")
    page.click("#mergeall")
    page.click(".dialog [data-x=yes]")
    wait_task(page)
    shot(page, "07_kopyalar_birlesti")
    # tür görünümü
    page.click(".nav-item[data-gid]")
    page.wait_for_timeout(500)
    shot(page, "08_tur")
    # listeler
    page.click("[data-tab=lists]")
    page.wait_for_selector("#newev")
    shot(page, "09_listeler")
    page.click("#newev")
    page.fill("#evt", "Ahmet & Ayşe")
    page.click(".dialog [data-x=yes]")
    page.wait_for_selector(".title-edit")
    page.wait_for_timeout(400)
    # bir bölüm seç ve şarkı ekle
    sec = page.locator(".tree .nav-item").filter(has=page.locator(".name", has_text="Halay")).filter(
        has_not=page.locator(".cnt", has_text="5")).last
    sec.click()
    page.wait_for_timeout(400)
    page.locator("[data-add]").first.click()
    page.wait_for_timeout(600)
    page.locator("[data-add]").nth(1).click()
    page.wait_for_timeout(600)
    shot(page, "10_etkinlik_bolum")
    # sürükle: 2. satırı en üste
    rows = page.locator("#ltab tr[data-ref]")
    if rows.count() >= 2:
        rows.nth(1).drag_to(rows.nth(0))
        page.wait_for_timeout(700)
    shot(page, "11_siralama")
    # Serato'da da
    if page.locator("#sertog").count():
        page.click("#sertog")
        page.wait_for_timeout(800)
    shot(page, "12_serato")
    # gelen
    page.click("[data-tab=inbox]")
    page.wait_for_selector("text=Gelen klasörünü aç")
    shot(page, "13_gelen")
    # geri al
    page.click("#undo")
    wait_task(page)
    shot(page, "14_geri_al")
    # koyu tema (ayarlardan)
    page.click("#settings")
    page.select_option("#ptheme", "dark")
    page.wait_for_timeout(300)
    page.click(".dialog [data-x=ok]")
    page.click("[data-tab=music]")
    page.wait_for_timeout(600)
    shot(page, "15_koyu")
    page.click("[data-tab=lists]")
    page.wait_for_timeout(600)
    shot(page, "16_koyu_listeler")
    b.close()

print("Hatalar:" if errors else "Konsol/sunucu hatası yok.")
for e in errors:
    print("  ", e)
print("Ekranlar:", OUT)
shutil.rmtree(TMP, ignore_errors=True)
sys.exit(1 if errors else 0)
