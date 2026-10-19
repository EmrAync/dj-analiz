"""Mix Asistanı arayüz testi (Playwright + Chromium): python3 -B tests/ui_assistant.py [ekran_klasörü]

Ağ yok: API anahtarı girilmez, yapay zekâ istekleri çevrimdışı sonuca düşer. Konsol / sayfa hatasında,
5xx yanıtta ya da yatay taşmada başarısız olur. Port: DJD_UI_PORT (varsayılan 8921)."""
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
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(tempfile.gettempdir(), "djd_ui_asst")
os.makedirs(OUT, exist_ok=True)

TMP = tempfile.mkdtemp(prefix="djd_uia_", dir=os.environ.get("DJD_TEST_BASE"))
os.environ["DJDOKTOR_HOME"] = os.path.join(TMP, "ws")
os.environ["HOME"] = os.path.join(TMP, "home")
os.environ.pop("ANTHROPIC_API_KEY", None)
os.makedirs(os.path.join(TMP, "home", "Music"), exist_ok=True)
os.makedirs(os.path.join(TMP, "home", "Downloads"), exist_ok=True)

import make_fixture  # noqa: E402
from mutagen.id3 import ID3, TBPM, TKEY  # noqa: E402

ROOT = os.path.join(TMP, "SSD")
make_fixture.build(ROOT)
TAGGED = [
    ("melis music/HALAYLAR/Halay A.mp3", 101, "Halay A", "Grup A", 100, "Am", "8A - Energy 7"),
    ("melis music/HALAYLAR/Halay B.mp3", 102, "Halay B", "Grup B", 102, "9A", None),
    ("melis music/HALAYLAR/Halay C.mp3", 103, "Halay C", "Grup C", 98, "8B", None),
    ("melis music/HALAYLAR/Halay D.mp3", 104, "Halay D", "Grup D", 125, "3A", None),
    ("melis music/HALAYLAR/Halay E.mp3", 105, "Halay E Uzun Bir Şarkı Adı ve Daha da Uzun Bir Ek", "Grup E", 200, "8A", None),
    ("melis music/HORON/Horon X.mp3", 107, "Horon X", "Kemençe Ekibi", 140, "10A", None),
    ("melis music/SLOW/Slow 1.mp3", 108, "Slow 1", "Sanatçı S", 70, "8A", None),
    ("melis music/SLOW/Slow 2.mp3", 109, "Slow 2", "Sanatçı T", 72, "7A", None),
    ("melis music/KARISIK POP/Pop 1.mp3", 110, "Pop 1", "Pop Yıldızı", 101, "9B", None),
    ("melis music/KARISIK POP/Pop 2.mp3", 111, "Pop 2", "Pop Yıldızı", 128, "8A", None),
]
for rel, seed, title, artist, bpm, key, comment in TAGGED:
    p = os.path.join(ROOT, *rel.split("/"))
    make_fixture.write_mp3(p, seed, 160, title, artist, None, comment)
    t = ID3(p)
    t.add(TBPM(encoding=3, text=str(bpm)))
    t.add(TKEY(encoding=3, text=key))
    t.save(p)

from djdoktor import relocate, server  # noqa: E402
from djdoktor.config import Settings  # noqa: E402
from djdoktor.library import Library  # noqa: E402

_s = Settings()
_lib = Library(_s, _s.add_library(ROOT, "SSD"))
_lib.full_scan()
relocate.setup_apply(_lib, "Müzik")
_lib.full_scan()
del _lib, _s

PORT = int(os.environ.get("DJD_UI_PORT") or 8921)
threading.Thread(target=server.run, kwargs={"port": PORT, "open_browser": False}, daemon=True).start()
time.sleep(1.0)
URL = "http://127.0.0.1:%d/" % PORT

from playwright.sync_api import sync_playwright  # noqa: E402

errors = []


def shot(page, name):
    page.wait_for_timeout(300)
    page.screenshot(path=os.path.join(OUT, name + ".png"), full_page=False)
    print("  ekran:", name)


def no_overflow(page, where):
    bad = page.evaluate("""() => {
      const out = [];
      const se = document.scrollingElement;
      if (se.scrollWidth > innerWidth + 1) out.push('sayfa ' + se.scrollWidth + '>' + innerWidth);
      for (const el of document.querySelectorAll('#view, #view .main, #view .main > .head, #view .main > .body, .as-grid, .as-cur, .as-chain, .as-res, .as-form, .as-wheelwrap')) {
        if (el.scrollWidth > el.clientWidth + 2 && getComputedStyle(el).overflowX !== 'auto') out.push((el.id || el.className) + ' ' + el.scrollWidth + '>' + el.clientWidth);
      }
      return out;
    }""")
    if bad:
        errors.append("taşma (%s): %s" % (where, "; ".join(bad)))


def wait_toast(page, text, timeout=15000):
    page.wait_for_selector(".toast:has-text('%s')" % text, timeout=timeout)


def api(page, path, body=None):
    if body is None:
        return page.evaluate("p => api(p)", path)
    return page.evaluate("([p, b]) => api(p, b)", [path, body])


with sync_playwright() as p:
    exe = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
    b = p.chromium.launch(executable_path=exe if os.path.exists(exe) else None)
    page = b.new_page(viewport={"width": 1440, "height": 900})
    page.on("console", lambda m: errors.append("console %s: %s" % (m.type, m.text)) if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append("pageerror: %s" % e))
    page.on("response", lambda r: errors.append("http %d %s" % (r.status, r.url)) if r.status >= 500 else None)
    page.goto(URL)
    page.wait_for_selector("[data-tab=assistant]", timeout=30000)

    # 1) Sonra ne çalınır?
    page.click("[data-tab=assistant]")
    page.wait_for_selector("text=Yukarıdan bir şarkı ara")
    shot(page, "a01_bos")
    page.fill("#asq", "halay a")
    page.wait_for_selector("#aspop [data-aspp]")
    shot(page, "a02_arama")
    page.click("#aspop [data-aspp]")
    page.wait_for_selector("#asnx tr.as-row")
    assert page.locator(".as-cur .ttl").inner_text() == "Halay A"
    shot(page, "a03_adaylar")
    no_overflow(page, "sonra ne 1440")
    first = page.locator("#asnx tr.as-row").first
    first_title = first.locator(".ttl").inner_text()
    first.click()
    page.wait_for_function("t => document.querySelector('.as-cur .ttl') && document.querySelector('.as-cur .ttl').textContent === t", arg=first_title)
    assert page.locator(".as-ci").count() == 2, page.locator(".as-ci").count()
    page.click("[data-asen=up]")
    page.wait_for_selector("[data-asen=up].on")
    shot(page, "a04_zincir")
    # yapay zekâ (anahtar yok): bilgi + çevrimdışı öneriler kalır
    page.click("#asainext")
    page.wait_for_selector(".as-aibox:has-text('anahtarı girilmemiş')", timeout=20000)
    assert page.locator(".as-aibox [data-askey]").count() == 1
    shot(page, "a05_ai_anahtar_yok")
    page.click("[data-asaiclose]")
    # zinciri kaydet
    page.click("[data-assave=chain]")
    page.fill("#assvt", "UI Zincir")
    page.click(".dialog [data-x=yes]")
    wait_toast(page, "Liste kaydedildi")
    lst = api(page, "/api/lists")
    assert any(l["title"] == "UI Zincir" and l["n"] == 2 for l in lst["lists"]), [l["title"] for l in lst["lists"]]

    # şarkı ayrıntısından giriş
    page.click("[data-tab=music]")
    page.wait_for_selector("td.c-song")
    page.locator("td.c-song").first.click()
    page.wait_for_selector(".drawer [data-dext]")
    shot(page, "a06_ayrinti")
    dtitle = page.locator(".drawer .dw-t").inner_text()
    page.locator(".drawer [data-dext]", has_text="Sonra ne çalınır?").click()
    page.wait_for_selector(".as-cur .ttl")
    assert page.locator(".as-cur .ttl").inner_text() == dtitle, (dtitle, page.locator(".as-cur .ttl").inner_text())
    assert page.locator(".as-ci").count() == 3                     # zincir korunur, şarkı sona eklenir
    page.click("#asclr")
    assert page.locator(".as-ci").count() == 1

    # 2) Camelot çarkı
    page.click("[data-asv=wheel]")
    page.wait_for_selector("svg.as-wheel g[data-ascam='8A']")
    assert page.locator("svg.as-wheel g[data-ascam]").count() == 24
    page.click("svg.as-wheel g[data-ascam='8A']")
    page.wait_for_selector("#askt tbody tr td.c-song")
    shot(page, "a07_cark")
    no_overflow(page, "çark 1440")
    page.locator("#askt [data-asgo]").first.click()
    page.wait_for_selector("#asnx tr.as-row")

    # 3) Set kurucu: kur ve etkinlik olarak kaydet
    page.click("[data-asv=build]")
    page.wait_for_selector("#asbgo")
    page.fill("#asbmin", "10")
    page.click("[data-ascurve=rising]")
    page.locator("[data-asbg]", has_text="Halay").first.click()
    page.click("#asbgo")
    page.wait_for_selector("#asbt tbody td.c-song")
    shot(page, "a08_set")
    no_overflow(page, "set 1440")
    page.click("[data-asimprove=asbt]")
    page.wait_for_selector(".toast:has-text('Geçişler iyileşti'), .toast:has-text('zaten en iyi')")
    page.click("[data-assave=asbt]")
    page.check("input[name=assvk][value=event]")
    page.fill("#assvt", "UI Kına")
    page.click(".dialog [data-x=yes]")
    wait_toast(page, "Etkinlik kaydedildi")
    lst = api(page, "/api/lists")
    ev = [l for l in lst["lists"] if l["title"].endswith("UI Kına")]
    assert ev and ev[0]["path"][0] == "Etkinlikler", [l["path"] for l in lst["lists"]]
    # "Şu etkinlikte olanları ekleme" ile yeniden kur: o etkinlikteki şarkılar yeni sette yok
    page.wait_for_selector("#asbx")
    page.select_option("#asbx", str(ev[0]["id"]))
    page.locator("[data-asbg].on", has_text="Halay").first.click()          # tüm türler
    page.click("#asbgo")
    page.wait_for_selector("#asbt tbody td.c-song")
    used = set()
    for l in lst["lists"]:
        if l["parent"] == ev[0]["id"]:
            used |= {x["fid"] for x in api(page, "/api/list/%d" % l["id"])["items"]}
    now = set(page.evaluate("() => [...document.querySelectorAll('#asbt td.c-song[data-info]')].map((e) => +e.dataset.info)"))
    assert used and now and not used & now, (used, now)
    # geri al: etkinlik gider
    page.click("#undo")
    page.wait_for_function("() => !document.querySelector('#taskbar .task')", timeout=30000)
    page.wait_for_timeout(500)
    lst = api(page, "/api/lists")
    assert not any(l["title"].endswith("UI Kına") for l in lst["lists"])

    # 4) Yapay zekâ ile kur (anahtar yok -> çevrimdışı set + bilgi)
    page.click("[data-asv=ai]")
    page.wait_for_selector("text=Yapay zekâ için bir API anahtarı gerekli.")
    page.fill("#asareq", "Kına gecesi, 15 dakika, sakin başlasın, sonunda coşsun")
    page.fill("#asamin", "15")
    page.click("#asago")
    page.wait_for_selector("#asat tbody td.c-song", timeout=30000)
    assert page.locator(".as-res .tag", has_text="Çevrimdışı").count() == 1
    assert page.locator(".hint:has-text('anahtarı girilmemiş')").count() >= 1
    shot(page, "a09_ai_cevrimdisi")

    # 5) Listeyi sırala: karışık sıralı bir liste kur, Listeler > ⋯ > Harmonik sırala > uygula > geri al
    ids = []
    for q in ("Halay D", "Halay A", "Pop 2", "Halay C", "Slow 1", "Halay B"):
        ids.append(api(page, "/api/assistant/search?q=" + q.replace(" ", "%20"))[0]["id"])
    mixed = api(page, "/api/assistant/save", {"kind": "list", "title": "Karışık Sıra", "sections": [{"ids": ids}]})
    page.click("[data-tab=lists]")
    page.wait_for_selector("#newev")
    page.locator(".tree .nav-item[data-lid='%d']" % mixed["id"]).click()
    page.wait_for_selector("#lmenu")
    page.click("#lmenu")
    page.locator("#menu button", has_text="Harmonik sırala").click()
    page.wait_for_selector(".as-cmp", timeout=20000)
    shot(page, "a10_sirala")
    no_overflow(page, "sırala 1440")
    page.click("#asapply")
    page.click(".dialog [data-x=yes]")
    wait_toast(page, "sıralandı")
    page.wait_for_selector(".as-cmp .tag:has-text('zaten en iyi sırada')", timeout=20000)
    after = [x["fid"] for x in api(page, "/api/list/%d" % mixed["id"])["items"]]
    assert sorted(after) == sorted(ids) and after != ids, (after, ids)
    page.click("#undo")
    page.wait_for_function("() => !document.querySelector('#taskbar .task')", timeout=30000)
    page.wait_for_timeout(500)
    assert [x["fid"] for x in api(page, "/api/list/%d" % mixed["id"])["items"]] == ids

    # Ayarlar: yapay zekâ bölümü (ağ yok)
    page.click("#settings")
    page.wait_for_selector("#aikey")
    assert page.get_attribute("#aikey", "type") == "password"
    page.click("#aitest")
    page.wait_for_selector("#aimsg.as-bad", timeout=15000)
    assert "anahtar" in page.locator("#aimsg").inner_text().lower()
    page.fill("#mixbpm", "8")
    page.locator("#mixbpm").dispatch_event("change")
    page.wait_for_timeout(400)
    shot(page, "a11_ayarlar_ai")
    st = api(page, "/api/state")
    assert st["prefs"]["mix_bpm_range"] == 8 and st["prefs"]["ai_key_set"] is False and "ai_api_key" not in st["prefs"]
    page.click(".dialog [data-x=ok]")

    # yapay zekâ yanıtı (sahte, ağ yok): anahtarı Ayarlar'dan kaydet, sunucudaki istemciyi taklitle değiştir
    import json as _json
    import re as _re
    from djdoktor import ai as AIM
    KEY = "sk-ant-ui-test-key-0000000000"
    sent = []

    def fake_post(body, key, timeout=None, opener=None):
        assert key == KEY, key
        sent.append(body)
        content = body["messages"][0]["content"]
        if "picks" in _json.dumps(body["output_config"]["format"]["schema"]):
            out = {"note": "Halayla devam et.", "picks": [{"i": i, "why": "ton ve tempo uyumlu"} for i in range(5)]}
        elif "ok" in body["output_config"]["format"]["schema"]["properties"]:
            out = {"ok": True}
        else:
            n = sum(1 for ln in content.split("\n") if _re.match(r"^\d+ \| ", ln))
            out = {"title": "Kına Gecesi (AI)", "notes": "Sakin başla, halayla bitir.",
                   "sections": [{"name": "Karşılama", "tracks": [{"i": i, "why": "sakin giriş"} for i in range(min(3, n))]},
                                {"name": "Halay", "tracks": [{"i": i, "why": "coşku"} for i in range(3, min(8, n))] + [{"i": 999, "why": "yok"}]}]}
        return {"model": "claude-opus-5-5", "stop_reason": "end_turn", "content": [{"type": "text", "text": _json.dumps(out)}]}
    AIM._post = fake_post
    page.click("#settings")
    page.wait_for_selector("#aikey")
    page.fill("#aikey", KEY)
    page.click("#aisave")
    page.wait_for_selector("#aimsg:has-text('Kaydedildi')")
    assert "(kayıtlı)" in page.get_attribute("#aikey", "placeholder") and KEY not in page.content()
    page.click("#aitest")
    page.wait_for_selector("#aimsg:has-text('Çalışıyor')")
    page.click(".dialog [data-x=ok]")
    page.click("[data-asv=ai]")
    page.wait_for_selector("#asago:has-text('Yapay zekâ ile kur')")
    assert page.locator("text=Yapay zekâ için bir API anahtarı gerekli.").count() == 0
    page.click("#asago")
    page.wait_for_selector(".as-res .tag:has-text('Yapay zekâ')", timeout=20000)
    page.wait_for_selector("#asat tr.as-sec")
    assert page.locator("#asat tr.as-sec").count() == 2 and page.locator("#asat .why", has_text="coşku").count() >= 1
    assert page.locator(".as-warn", has_text="atlandı").count() == 1
    shot(page, "a15_ai_sonuc")
    no_overflow(page, "ai 1440")
    page.click("[data-asimprove=asat]")
    page.wait_for_selector(".toast:has-text('Geçişler iyileşti'), .toast:has-text('zaten en iyi')")
    page.click("[data-asv=next]")
    page.wait_for_selector("#asainext")
    page.click("[data-asen='']")                                  # enerji serbest: yeterli aday
    page.wait_for_selector("[data-asen=''].on")
    page.click("#asainext")
    page.wait_for_selector(".as-aibox .as-pick", timeout=20000)
    assert page.locator(".as-aibox .as-pick").count() == 5
    shot(page, "a16_ai_sonra")
    page.locator(".as-aibox .as-pick").first.click()
    page.wait_for_function("() => document.querySelectorAll('.as-ci').length >= 2")
    prompt = sent[-2]["messages"][0]["content"] if len(sent) >= 2 else ""
    assert ROOT not in prompt and "melis music" not in prompt, prompt[:400]
    page.click("#settings")
    page.wait_for_selector("#aidel")
    page.click("#aidel")
    page.wait_for_selector("#aimsg:has-text('silindi')")
    page.click(".dialog [data-x=ok]")
    assert api(page, "/api/state")["prefs"]["ai_key_set"] is False

    # dar pencere (800 px) ve koyu tema
    page.set_viewport_size({"width": 800, "height": 700})
    page.click("[data-tab=assistant]") if page.locator("[data-tab=assistant]:visible").count() else None
    for v in ("next", "wheel", "build", "ai", "sort"):
        page.evaluate("v => { const el = document.querySelector('[data-asv=' + v + ']'); if (el) el.click(); }", v)
        page.wait_for_timeout(700)
        no_overflow(page, v + " 800")
        shot(page, "a12_dar_" + v)
    page.set_viewport_size({"width": 1440, "height": 900})
    page.evaluate("() => api('/api/prefs', {theme: 'dark'}).then(applyPrefs)")
    page.evaluate("() => { const el = document.querySelector('[data-asv=wheel]'); if (el) el.click(); }")
    page.wait_for_selector("svg.as-wheel")
    shot(page, "a13_koyu_cark")
    page.evaluate("() => { const el = document.querySelector('[data-asv=next]'); if (el) el.click(); }")
    page.wait_for_timeout(700)
    shot(page, "a14_koyu_sonra")
    b.close()

print("Hatalar:" if errors else "Konsol/sunucu hatası ve taşma yok.")
for e in errors:
    print("  ", e)
print("Ekranlar:", OUT)
shutil.rmtree(TMP, ignore_errors=True)
sys.exit(1 if errors else 0)
