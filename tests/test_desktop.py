"""desktop.py + baslat.py testleri (Linux'ta çalışır; Windows/macOS parçaları sahte kayıt defteri / dosya sistemiyle).

python3 -B tests/test_desktop.py [test_adı ...]
"""
from __future__ import annotations

import base64
import json
import os
import plistlib
import shutil
import socket
import struct
import subprocess
import sys
import tempfile
import threading
import time
import traceback
import urllib.error
import urllib.request
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
sys.path.insert(0, os.path.join(ROOT, "vendor"))
sys.path.insert(0, ROOT)

TMP = tempfile.mkdtemp(prefix="djd_desk_", dir=os.environ.get("DJD_TEST_BASE"))
os.environ["DJDOKTOR_HOME"] = os.path.join(TMP, "ws")
os.environ["HOME"] = os.path.join(TMP, "home")
os.makedirs(os.path.join(TMP, "home", "Desktop"), exist_ok=True)

import baslat  # noqa: E402
from djdoktor import desktop  # noqa: E402


# ---------------------------------------------------------------------------
# PNG / ICO / ICNS
# ---------------------------------------------------------------------------
def read_png(data):
    """PNG'yi baştan sona doğrular; (w, h, satırlar) döndürür."""
    assert data[:8] == b"\x89PNG\r\n\x1a\n", "imza"
    i, chunks = 8, []
    while i < len(data):
        n, = struct.unpack(">I", data[i:i + 4])
        typ, body = data[i + 4:i + 8], data[i + 8:i + 8 + n]
        crc, = struct.unpack(">I", data[i + 8 + n:i + 12 + n])
        assert zlib.crc32(typ + body) & 0xFFFFFFFF == crc, "CRC %s" % typ
        chunks.append((typ, body))
        i += 12 + n
    assert i == len(data)
    assert chunks[0][0] == b"IHDR" and chunks[-1][0] == b"IEND"
    w, h, depth, ctype, comp, filt, inter = struct.unpack(">IIBBBBB", chunks[0][1])
    assert (depth, ctype, comp, filt, inter) == (8, 6, 0, 0, 0)
    raw = zlib.decompress(b"".join(b for t, b in chunks if t == b"IDAT"))
    assert len(raw) == h * (1 + 4 * w)
    rows = []
    for y in range(h):
        line = raw[y * (1 + 4 * w):(y + 1) * (1 + 4 * w)]
        assert line[0] == 0, "filtre"
        rows.append(line[1:])
    return w, h, rows


def px(rows, x, y):
    return tuple(rows[y][x * 4:x * 4 + 4])


def test_png_logo():
    for s in (16, 32, 48, 64, 128, 256, 512):
        w, h, rows = read_png(desktop.logo_png(s))
        assert (w, h) == (s, s)
        assert px(rows, 0, 0)[3] < 40, "köşe saydam olmalı (%d)" % s
        mid = px(rows, s // 2, s - 3)
        assert mid[3] == 255 and mid[:3] == desktop.LOGO_BG, (s, mid)
    w, h, rows = read_png(desktop.logo_png(256))
    # en uzun çubuğun ortası beyaz (x = 22.5/32, y = 16/32)
    assert px(rows, int(22.5 * 8), 128) == (255, 255, 255, 255)
    # kenar boşluklu (macOS) simgede kenar tamamen saydam
    w, h, rows = read_png(desktop.logo_png(128, desktop.ICNS_MARGIN))
    assert px(rows, 3, 64)[3] == 0 and px(rows, 64, 64)[3] == 255


def test_ico():
    data = desktop.ico_bytes()
    res, typ, n = struct.unpack("<HHH", data[:6])
    assert (res, typ, n) == (0, 1, len(desktop.ICO_SIZES))
    for k, s in enumerate(desktop.ICO_SIZES):
        bw, bh, cc, r0, planes, bits, size, off = struct.unpack("<BBBBHHII", data[6 + 16 * k:22 + 16 * k])
        assert bw == bh == (0 if s == 256 else s) and planes == 1 and bits == 32
        w, h, _rows = read_png(data[off:off + size])
        assert (w, h) == (s, s)


def test_icns():
    data = desktop.icns_bytes()
    assert data[:4] == b"icns" and struct.unpack(">I", data[4:8])[0] == len(data)
    i, seen = 8, []
    while i < len(data):
        typ, n = data[i:i + 4].decode("ascii"), struct.unpack(">I", data[i + 4:i + 8])[0]
        w, h, _ = read_png(data[i + 8:i + n])
        seen.append((typ, w))
        i += n
    assert i == len(data)
    assert seen == list(desktop.ICNS_TYPES)


def test_static_assets_and_manifest():
    body, ctype = desktop.static_asset("/icon-192.png")
    assert ctype == "image/png" and read_png(body)[0] == 192
    body, ctype = desktop.static_asset("/manifest.webmanifest")
    m = json.loads(body.decode("utf-8"))
    assert m["display"] == "standalone" and {i["sizes"] for i in m["icons"]} == {"192x192", "512x512"}
    assert desktop.static_asset("/favicon.ico")[1] == "image/x-icon"
    assert desktop.static_asset("/icon-999.png") is None and desktop.static_asset("/app.js") is None
    files = desktop.ensure_icons(os.path.join(TMP, "ws_icons"))
    assert all(os.path.getsize(p) > 100 for p in files.values())


# ---------------------------------------------------------------------------
# macOS uygulama paketi
# ---------------------------------------------------------------------------
def test_mac_bundle():
    target = os.path.join(TMP, "MacDesk")
    os.makedirs(target)
    app_dir = os.path.join(TMP, "Program Klasörü 'tırnak'")
    os.makedirs(app_dir)
    ws = os.path.join(TMP, "Belgeler", "DJ Doktor")
    path = desktop.make_mac_app(target, app_dir, ws, python="/usr/bin/python3", icns=b"icns\x00\x00\x00\x08")
    assert path == os.path.join(target, "DJ Doktor.app")
    with open(os.path.join(path, "Contents", "Info.plist"), "rb") as f:
        info = plistlib.load(f)
    assert info["CFBundleIdentifier"] == "de.djdoktor.app" and info["CFBundleExecutable"] == "DJ Doktor"
    assert info["CFBundleIconFile"] == "icon.icns" and info["LSMinimumSystemVersion"]
    exe = os.path.join(path, "Contents", "MacOS", "DJ Doktor")
    assert os.stat(exe).st_mode & 0o111 == 0o111, "çalıştırılabilir olmalı"
    assert os.path.isfile(os.path.join(path, "Contents", "Resources", "icon.icns"))
    with open(os.path.join(path, "Contents", "PkgInfo"), "rb") as f:
        assert f.read() == b"APPL????"
    script = open(exe, encoding="utf-8").read()
    assert script.startswith("#!/bin/bash") and "--detach --app" in script
    if shutil.which("bash"):
        assert subprocess.run(["bash", "-n", exe]).returncode == 0, "bash söz dizimi"
        # tırnaklı/boşluklu yol doğru çözülüyor mu: APP_DIR satırını bash'e değerlendirt
        line = next(l for l in script.splitlines() if l.startswith("APP_DIR="))
        out = subprocess.run(["bash", "-c", line + '; printf %s "$APP_DIR"'], capture_output=True)
        assert out.stdout.decode("utf-8") == app_dir
        # klasörde baslat.py yok: betik hata verip çıkar (python başlatmaz)
        r = subprocess.run([exe], capture_output=True, timeout=20, env=dict(os.environ, PATH="/usr/bin:/bin"))
        assert r.returncode == 1
    # aynı ad başka bir uygulamaya aitse dokunulmaz
    other = os.path.join(TMP, "MacDesk2", "DJ Doktor.app", "Contents")
    os.makedirs(other)
    with open(os.path.join(other, "Info.plist"), "wb") as f:
        plistlib.dump({"CFBundleIdentifier": "com.baska.app"}, f)
    try:
        desktop.make_mac_app(os.path.join(TMP, "MacDesk2"), app_dir, ws)
        raise AssertionError("başkasının paketi ezilmemeli")
    except FileExistsError:
        pass
    # bizimki güncellenir
    desktop.make_mac_app(target, app_dir, ws, python="/usr/bin/python3", icns=b"icns\x00\x00\x00\x08")


def test_linux_desktop_entry():
    home = os.path.join(TMP, "lhome")
    os.makedirs(home)
    p = desktop.create_shortcut(os.path.join(TMP, "prog dir"), os.path.join(TMP, "ws_l"), plat="linux", home=home)
    assert p == os.path.join(home, "Desktop", "DJ Doktor.desktop") and os.access(p, os.X_OK)
    txt = open(p, encoding="utf-8").read()
    assert "Exec=" in txt and '"%s"' % os.path.join(TMP, "prog dir", "baslat.py") in txt and "--app" in txt
    assert os.path.isfile(os.path.join(home, ".local", "share", "applications", "djdoktor.desktop"))
    st = desktop.shortcut_status({}, os.path.join(TMP, "prog dir"), plat="linux", home=home)
    assert st["exists"] and st["current"]
    st = desktop.shortcut_status({"shortcut": {"dir": "/baska"}}, os.path.join(TMP, "prog dir"), plat="linux", home=home)
    assert st["exists"] and not st["current"]


# ---------------------------------------------------------------------------
# Windows: masaüstü klasörü, pythonw, .lnk betiği
# ---------------------------------------------------------------------------
WENV = {"USERPROFILE": r"C:\Users\Emrullah", "APPDATA": r"C:\Users\Emrullah\AppData\Roaming",
        "SystemRoot": r"C:\Windows", "ProgramFiles": r"C:\Program Files",
        "ProgramFiles(x86)": r"C:\Program Files (x86)", "LOCALAPPDATA": r"C:\Users\Emrullah\AppData\Local"}


def fake_reg(values):
    def reg(hive, key, value=""):
        return values.get((hive, key.split("\\")[-1], value))
    return reg


def test_windows_desktop_dir():
    reg = fake_reg({("HKCU", "User Shell Folders", "Desktop"): r"%USERPROFILE%\OneDrive\Masaüstü"})
    dirs = {r"C:\Users\Emrullah\OneDrive\Masaüstü"}
    assert desktop.win_known_folder("Desktop", reg, WENV, dirs.__contains__) == r"C:\Users\Emrullah\OneDrive\Masaüstü"
    # değişken küçük harfle yazılmış olabilir
    reg = fake_reg({("HKCU", "User Shell Folders", "Desktop"): r"%userprofile%\Desktop"})
    assert desktop.win_known_folder("Desktop", reg, WENV, {r"C:\Users\Emrullah\Desktop"}.__contains__) \
        == r"C:\Users\Emrullah\Desktop"
    # User Shell Folders yok / klasör yok: Shell Folders, sonra %USERPROFILE%\Desktop
    reg = fake_reg({("HKCU", "Shell Folders", "Desktop"): r"D:\Masaüstü"})
    assert desktop.win_known_folder("Desktop", reg, WENV, {r"D:\Masaüstü"}.__contains__) == r"D:\Masaüstü"
    assert desktop.win_known_folder("Desktop", fake_reg({}), WENV, lambda p: False) == r"C:\Users\Emrullah\Desktop"
    assert desktop.win_known_folder("Programs", fake_reg({}), WENV, lambda p: False) \
        == r"C:\Users\Emrullah\AppData\Roaming\Microsoft\Windows\Start Menu\Programs"


def test_windows_pythonw():
    assert desktop.win_pythonw(r"C:\Python312\python.exe", lambda p: True) == r"C:\Python312\pythonw.exe"
    assert desktop.win_pythonw(r"C:\Python312\python.exe", lambda p: False) == r"C:\Python312\python.exe"
    assert desktop.win_pythonw(r"C:\Python312\pythonw.exe", lambda p: False) == r"C:\Python312\pythonw.exe"


def test_windows_lnk_script():
    assert desktop.ps_quote("a'b") == "'a''b'"
    assert desktop.ps_quote("Emre\u2019s") == "'Emre\u2019\u2019s'"
    app_dir = r"C:\Users\Emrullah\Desktop\DJ Doktor 'yeni'"
    ws = r"C:\Users\Emrullah\Documents\DJ Doktor"
    reg = fake_reg({("HKCU", "User Shell Folders", "Desktop"): r"%USERPROFILE%\OneDrive\Masaüstü"})
    plan = desktop.win_shortcut_plan(app_dir, ws, reg=reg, env=WENV, isdir=lambda p: True, isfile=lambda p: True,
                                     exe=r"C:\Program Files\Python312\python.exe")
    assert plan["path"] == r"C:\Users\Emrullah\OneDrive\Masaüstü\DJ Doktor.lnk"
    assert plan["target"] == r"C:\Program Files\Python312\pythonw.exe"
    assert plan["args"] == '"%s\\baslat.py" --app' % app_dir
    cmd = plan["command"]
    assert cmd[0] == r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe"
    assert cmd[-2] == "-EncodedCommand" and "-NoProfile" in cmd
    script = base64.b64decode(cmd[-1]).decode("utf-16-le")
    assert script == plan["script"]
    assert "$s = $sh.CreateShortcut('C:\\Users\\Emrullah\\OneDrive\\Masaüstü\\DJ Doktor.lnk')" in script
    assert "$s.WorkingDirectory = 'C:\\Users\\Emrullah\\Desktop\\DJ Doktor ''yeni'''" in script
    assert "$s.TargetPath = 'C:\\Program Files\\Python312\\pythonw.exe'" in script
    assert "$s.IconLocation = 'C:\\Users\\Emrullah\\Documents\\DJ Doktor\\simge\\DJ Doktor.ico,0'" in script
    assert script.count("$s.Save()") == 2 and "Start Menu" in script
    clix = ('#< CLIXML\r\n<Objs Version="1.1.0.1"><S S="Error">Erişim engellendi_x000D__x000A_</S>'
            '<S S="Error">ikinci satır</S></Objs>').encode("utf-8")
    assert desktop.ps_error(clix) == "Erişim engellendi"
    assert desktop.ps_error(b"Exception calling Save\r\nat line 1") == "Exception calling Save"


# ---------------------------------------------------------------------------
# Tarayıcı bulma
# ---------------------------------------------------------------------------
def test_find_browser():
    files = {r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"}
    b = desktop.find_browser("win32", WENV, files.__contains__, lambda c: None, fake_reg({}))
    assert b == {"name": "Microsoft Edge", "path": r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"}
    files = {r"C:\Users\Emrullah\AppData\Local\Google\Chrome\Application\chrome.exe"}
    b = desktop.find_browser("win32", WENV, files.__contains__, lambda c: None, fake_reg({}))
    assert b["name"] == "Google Chrome"
    # yalnızca kayıt defterinde (başka diske kurulu)
    reg = fake_reg({("HKLM", "msedge.exe", ""): r'"E:\Apps\Edge\msedge.exe"'})
    b = desktop.find_browser("win32", WENV, {r"E:\Apps\Edge\msedge.exe"}.__contains__, lambda c: None, reg)
    assert b == {"name": "Microsoft Edge", "path": r"E:\Apps\Edge\msedge.exe"}
    assert desktop.find_browser("win32", WENV, lambda p: False, lambda c: None, fake_reg({})) is None
    # macOS: kullanıcı klasöründeki Chrome; hiçbiri yoksa None (Safari --app açamaz)
    home = "/Users/emre"
    p = home + "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    b = desktop.find_browser("darwin", {}, {p}.__contains__, lambda c: None, home=home)
    assert b == {"name": "Google Chrome", "path": p}
    p2 = "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
    assert desktop.find_browser("darwin", {}, {p2}.__contains__, lambda c: None, home=home)["name"] == "Microsoft Edge"
    assert desktop.find_browser("darwin", {}, lambda p: False, lambda c: None, home=home) is None
    # Linux: PATH'teki komut
    b = desktop.find_browser("linux", {}, lambda p: False, {"google-chrome": "/usr/bin/google-chrome"}.get)
    assert b == {"name": "Google Chrome", "path": "/usr/bin/google-chrome"}


def test_app_command_and_open():
    ws = os.path.join(TMP, "ws_open")
    seen = []
    res = desktop.open_app_window("http://127.0.0.1:8770/", ws, browser={"name": "X", "path": "/x/chrome"},
                                  popen=seen.append, fallback=lambda u: seen.append(("tab", u)))
    assert res == {"mode": "app", "browser": "X"}
    cmd = seen[0]
    assert cmd[0] == "/x/chrome" and "--app=http://127.0.0.1:8770/" in cmd and "--no-first-run" in cmd
    prof = [c for c in cmd if c.startswith("--user-data-dir=")][0].split("=", 1)[1]
    assert prof == os.path.join(ws, "Pencere") and os.path.isdir(prof)
    assert "Kutuphane" not in prof
    seen.clear()
    res = desktop.open_app_window("http://u/", ws, browser=False, popen=seen.append,
                                  fallback=lambda u: seen.append(("tab", u)))
    assert res["mode"] == "browser" and seen == [("tab", "http://u/")]
    seen.clear()
    res = desktop.open_app_window("http://u/", ws, use_app=False, browser={"name": "X", "path": "/x"},
                                  popen=seen.append, fallback=lambda u: seen.append(("tab", u)))
    assert res["mode"] == "browser" and seen == [("tab", "http://u/")]


# ---------------------------------------------------------------------------
# Watchdog (sahte saat)
# ---------------------------------------------------------------------------
class Clock:
    def __init__(self):
        self.t = 1000.0

    def __call__(self):
        return self.t

    def go(self, to, wd, step=1.0):
        """Saati adım adım ilerletir ve her adımda tick yapar (ilk kapanma nedeni döner)."""
        while self.t < to:
            self.t = min(to, self.t + step)
            r = wd.tick()
            if r:
                return r
        return None


def test_watchdog_app_policy():
    c = Clock()
    wd = desktop.Watchdog("app", clock=c)
    assert c.go(c.t + 170, wd) is None
    assert c.go(c.t + 20, wd) == "nostart"            # pencere hiç bağlanmadı
    # kapanış: bye + 10 sn içinde yeni sayfa yok
    c = Clock()
    wd = desktop.Watchdog("app", clock=c)
    wd.hb("A")
    c.go(c.t + 30, wd)
    wd.bye("A")
    assert c.go(c.t + 9, wd) is None
    assert c.go(c.t + 2, wd) == "closed"
    # yenileme: bye ardından yeni sayfa
    c = Clock()
    wd = desktop.Watchdog("app", clock=c)
    wd.hb("A")
    wd.bye("A")
    c.go(c.t + 1, wd)
    wd.hb("B")
    assert c.go(c.t + 60, wd, 5) is None
    # iki pencere: biri kapanır, öteki simge durumunda (dakikada bir kalp atışı) açık kalır
    wd.hb("C")
    wd.bye("B")
    for _ in range(10):
        assert c.go(c.t + 60, wd) is None
        wd.hb("C")
    # kalp atışı kesildi (pencere çöktü): 180 sn sonra
    assert c.go(c.t + 175, wd) is None
    assert c.go(c.t + 10, wd) in ("timeout", "closed")
    c = Clock()
    wd = desktop.Watchdog("app", clock=c)
    wd.hb("A")
    assert c.go(c.t + 179, wd) is None
    assert c.go(c.t + 3, wd) == "timeout"


def test_watchdog_busy_hold_sleep_user():
    c = Clock()
    busy = {"v": True}
    wd = desktop.Watchdog("app", busy=lambda: busy["v"], clock=c)
    wd.hb("A")
    wd.bye("A")
    assert c.go(c.t + 600, wd) is None                  # görev sürerken asla
    busy["v"] = False
    assert c.go(c.t + 1, wd) == "closed"
    # ikinci açılış: 'hold' yeni pencereye zaman tanır
    c = Clock()
    wd = desktop.Watchdog("app", clock=c)
    wd.hb("A")
    wd.bye("A")
    c.go(c.t + 5, wd)
    wd.hold()
    assert c.go(c.t + 25, wd) is None
    assert c.go(c.t + 10, wd) == "closed"
    # uyku: iki tick arası çok uzun -> pencereler tazelenir, hemen kapanmaz
    c = Clock()
    wd = desktop.Watchdog("app", clock=c)
    wd.hb("A")
    c.go(c.t + 5, wd)
    c.t += 3600
    assert wd.tick() is None
    assert c.go(c.t + 20, wd) is None
    wd.hb("A")
    assert c.go(c.t + 100, wd) is None
    # kullanıcı 'Programı kapat': her politikada; görev sürüyorsa bekler
    for pol in ("off", "bye", "app"):
        busy["v"] = True
        c = Clock()
        wd = desktop.Watchdog(pol, busy=lambda: busy["v"], clock=c)
        wd.request_quit()
        assert wd.tick() is None
        busy["v"] = False
        assert wd.tick() == "user"


def test_watchdog_plain_modes():
    c = Clock()
    wd = desktop.Watchdog("off", clock=c)              # --no-browser / --browser
    wd.hb("A")
    wd.bye("A")
    assert c.go(c.t + 3600, wd, 10) is None
    c = Clock()
    wd = desktop.Watchdog("bye", clock=c)              # uygulama penceresi açılamadı, sıradan sekme
    assert c.go(c.t + 600, wd, 10) is None             # hiç bağlanmadı: zaman aşımı yok
    wd.hb("A")
    assert c.go(c.t + 3600, wd, 10) is None            # sekme uyutuldu: zaman aşımıyla kapanmaz
    wd.bye("A")
    assert c.go(c.t + 15, wd) == "closed"


# ---------------------------------------------------------------------------
# Gerçek sunucu: /api/app rotaları, kendiliğinden kapanma
# ---------------------------------------------------------------------------
def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


def start_server(mode="none"):
    from djdoktor import server
    port = free_port()
    th = threading.Thread(target=server.run, kwargs={"port": port, "mode": mode}, daemon=True)
    th.start()
    for _ in range(100):
        app = server.Handler.app
        if app is not None and app.port == port and app.watchdog is not None and app.watchdog.policy is not None:
            break
        time.sleep(0.05)
    html = urllib.request.urlopen("http://127.0.0.1:%d/" % port, timeout=5).read().decode("utf-8")
    token = html.split('DJD_TOKEN = "', 1)[1].split('"', 1)[0]
    return server.Handler.app, port, token, th


def call(port, path, body=None, token=None, method=None):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["X-DJD-Token"] = token
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request("http://127.0.0.1:%d%s" % (port, path), data=data, headers=headers,
                                 method=method or ("POST" if data is not None else "GET"))
    try:
        with urllib.request.urlopen(req, timeout=5) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def test_server_routes_and_quit():
    app, port, token, th = start_server("none")
    assert app.mode == "none" and app.watchdog.policy == "off"
    st, body = call(port, "/api/app/info", token=token)
    info = json.loads(body)
    assert st == 200 and info["mode"] == "none" and info["auto_quit"] is False and "shortcut" in info
    assert info["offer"] is False
    assert call(port, "/api/app/info")[0] == 401                       # jeton başlığı şart
    assert call(port, "/api/app/hb", {"cid": "A"}, token=token)[0] == 200
    assert app.watchdog.status()["clients"] == 1
    assert call(port, "/api/app/bye?c=A", {})[0] == 401                # sendBeacon: jetonsuz reddedilir
    assert call(port, "/api/app/bye?t=yanlis&c=A", {})[0] == 401
    assert call(port, "/api/app/bye?t=%s&c=A" % token, {})[0] == 200   # sorgudaki jeton yalnızca burada geçer
    assert app.watchdog.status()["clients"] == 0
    assert call(port, "/api/app/hb?t=%s" % token, {"cid": "B"})[0] == 401
    st, body = call(port, "/icon-192.png")
    assert st == 200 and read_png(body)[0] == 192
    st, body = call(port, "/manifest.webmanifest")
    assert st == 200 and json.loads(body)["name"] == "DJ Doktor"
    st, body = call(port, "/api/ping?hold=1")
    assert st == 200 and json.loads(body)["mode"] == "none"
    assert call(port, "/api/app/offer", {}, token=token)[0] == 200 and app.settings.prefs()["shortcut_offered"]
    run_file = os.path.join(app.settings.ws, desktop.RUN_FILE)
    assert json.load(open(run_file))["port"] == port
    # görev sürerken kapanmaz
    gate = threading.Event()
    app.tasks.submit("test", "Bekleyen iş", lambda p, c: gate.wait(10) and {})
    time.sleep(0.2)
    st, body = call(port, "/api/app/quit", {}, token=token)
    assert st == 409 and json.loads(body)["code"] == "busy"
    gate.set()
    for _ in range(50):
        if app.tasks.idle():
            break
        time.sleep(0.05)
    st, body = call(port, "/api/app/quit", {}, token=token)
    assert st == 200
    th.join(8)
    assert not th.is_alive(), "sunucu kapanmalıydı"
    assert not os.path.exists(run_file)
    try:
        urllib.request.urlopen("http://127.0.0.1:%d/api/ping" % port, timeout=1)
        raise AssertionError("port kapanmalıydı")
    except (urllib.error.URLError, ConnectionError, socket.timeout):
        pass


def test_server_app_mode_autoquit():
    seen = []
    old = (desktop.find_browser, desktop.spawn_detached, desktop.Watchdog.GRACE)
    desktop.find_browser = lambda *a, **k: {"name": "Sahte Edge", "path": "/yok/msedge"}
    desktop.spawn_detached = lambda cmd, **k: seen.append(cmd)
    desktop.Watchdog.GRACE = 1.0
    try:
        app, port, token, th = start_server("app")
        assert app.mode == "app" and app.watchdog.policy == "app" and app.browser == "Sahte Edge"
        assert seen and seen[0][0] == "/yok/msedge" and seen[0][1] == "--app=http://127.0.0.1:%d/" % port
        info = json.loads(call(port, "/api/app/info", token=token)[1])
        assert info["app_mode"] and info["auto_quit"] and info["offer"] in (True, False)
        call(port, "/api/app/hb", {"cid": "P1"}, token=token)
        call(port, "/api/app/bye?t=%s&c=P1" % token, {})          # sayfa yenileniyor…
        call(port, "/api/app/hb", {"cid": "P2"}, token=token)      # …yeni sayfa geldi
        time.sleep(2.5)
        assert th.is_alive(), "yenilemede kapanmamalı"
        call(port, "/api/app/bye?t=%s&c=P2" % token, {})          # pencere kapandı
        th.join(8)
        assert not th.is_alive(), "pencere kapanınca sunucu kapanmalı"
    finally:
        desktop.find_browser, desktop.spawn_detached, desktop.Watchdog.GRACE = old


# ---------------------------------------------------------------------------
# Tarayıcıda (Playwright varsa): öneri bildirimi, Ayarlar > Uygulama, pencere kapanınca kapanma, kapanış ekranı
# ---------------------------------------------------------------------------
def _chromium(p):
    exe = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
    return p.chromium.launch(executable_path=exe if os.path.exists(exe) else None)


def _add_library(port, token):
    sys.path.insert(0, HERE)
    import make_fixture
    root = os.path.join(TMP, "SSD_ui")
    if not os.path.isdir(root):
        make_fixture.build(root)
    st, body = call(port, "/api/library/add", {"root": root}, token=token)
    assert st == 200, body
    tid = json.loads(body)["task"]
    for _ in range(300):
        t = json.loads(call(port, "/api/task/%d" % tid, token=token)[1])
        if t["status"] in ("bitti", "hata", "iptal"):
            assert t["status"] == "bitti", t
            return
        time.sleep(0.1)
    raise AssertionError("tarama bitmedi")


def test_ui_app_window():
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("      (Playwright yok: atlandı)")
        return
    errors = []
    seen = []
    old = (desktop.find_browser, desktop.spawn_detached, desktop.Watchdog.GRACE)
    desktop.find_browser = lambda *a, **k: {"name": "Sahte Edge", "path": "/yok/msedge"}
    desktop.spawn_detached = lambda cmd, **k: seen.append(cmd)
    desktop.Watchdog.GRACE = 1.0
    try:
        app, port, token, th = start_server("app")
        app.settings.set_prefs(shortcut_offered=False)
        _add_library(port, token)
        with sync_playwright() as p:
            b = _chromium(p)
            page = b.new_page(viewport={"width": 1280, "height": 800})
            page.on("pageerror", lambda e: errors.append("pageerror: %s" % e))
            page.on("console", lambda m: errors.append("console: %s" % m.text) if m.type == "error" else None)
            page.goto("http://127.0.0.1:%d/" % port)
            assert page.locator('link[rel="manifest"]').count() == 1
            page.wait_for_selector(".toast.djd-offer", timeout=8000)            # ilk açılış önerisi
            page.click(".toast.djd-offer .dof-go")
            page.wait_for_selector("text=kısayolu eklendi", timeout=8000)
            assert os.path.isfile(os.path.join(os.environ["HOME"], "Desktop", "DJ Doktor.desktop"))
            assert app.settings.prefs()["shortcut_offered"] is True
            page.click("#settings")
            page.wait_for_selector(".djd-appset")
            page.wait_for_function("() => /Masaüstünde var/.test(document.querySelector('#dscs').textContent)")
            if os.environ.get("DJD_SHOTS"):
                page.locator(".djd-appset").scroll_into_view_if_needed()
                page.screenshot(path=os.path.join(os.environ["DJD_SHOTS"], "desktop_ayarlar.png"))
            assert page.locator(".djd-appset [data-pref=app_window].on").count() == 1
            page.click(".djd-appset [data-pref=app_window]")                  # çekirdeğin [data-pref] düğmesi
            page.wait_for_timeout(400)
            assert app.settings.prefs()["app_window"] is False
            page.click(".djd-appset [data-pref=app_window]")
            page.wait_for_timeout(400)
            assert app.watchdog.status()["clients"] == 1
            page.goto("about:blank")                                         # pencere kapandı (pagehide + bye)
            th.join(10)
            assert not th.is_alive(), "pencere kapanınca sunucu kapanmalı"
            # ikinci sunucu (pencere yok): "Programı kapat" -> kapanış ekranı, hata bildirimi yok
            app2, port2, token2, th2 = start_server("none")
            page = b.new_page(viewport={"width": 1280, "height": 800})
            page.on("pageerror", lambda e: errors.append("pageerror: %s" % e))
            page.goto("http://127.0.0.1:%d/" % port2)
            page.click("#settings")
            page.wait_for_selector(".djd-appset #dquit")
            page.click(".djd-appset #dquit")
            page.wait_for_selector("#djd-gone >> text=DJ Doktor kapandı", timeout=8000)
            th2.join(10)
            assert not th2.is_alive()
            page.wait_for_timeout(300)
            assert page.locator("#dock").is_hidden()
            if os.environ.get("DJD_SHOTS"):                                  # ekran görüntüsü klasörü (isteğe bağlı)
                page.screenshot(path=os.path.join(os.environ["DJD_SHOTS"], "desktop_kapandi.png"))
            # sunucu başka yoldan kapandıysa (ör. konsol kapatıldı) da kapanış ekranı çıkar
            app3, port3, token3, th3 = start_server("none")
            page = b.new_page()
            page.goto("http://127.0.0.1:%d/" % port3)
            page.wait_for_timeout(500)
            app3.shutdown("test")
            th3.join(10)
            page.wait_for_selector("#djd-gone", timeout=15000)
            b.close()
        assert not errors, errors
    finally:
        desktop.find_browser, desktop.spawn_detached, desktop.Watchdog.GRACE = old


# ---------------------------------------------------------------------------
# baslat.py
# ---------------------------------------------------------------------------
def test_baslat_args():
    a = baslat.parse_args([])
    assert a.port == 8770 and not (a.app or a.browser or a.no_browser or a.console or a.detach)
    assert baslat.choose_mode(a, {}) == "app" and baslat.choose_mode(a, {"app_window": False}) == "browser"
    a = baslat.parse_args(["--browser"])
    assert baslat.choose_mode(a, {"app_window": True}) == "browser"
    a = baslat.parse_args(["--no-browser", "--port", "8800"])
    assert baslat.choose_mode(a, {}) == "none" and baslat.forward_args(a) == ["--port", "8800", "--no-browser"]
    a = baslat.parse_args(["--detach", "--app"])
    assert a.detach and baslat.choose_mode(a, {"app_window": False}) == "app"
    a = baslat.parse_args(["--detach", "konsol"])                    # Baslat_Windows.bat konsol
    assert a.console and not a.detach
    try:
        baslat.parse_args(["--app", "--browser"])
        raise AssertionError("ikisi birden olmamalı")
    except SystemExit:
        pass
    a = baslat.parse_args(["--detach", "--app", "--port", "8801"])
    cmd = baslat.child_command(a, exe=r"C:\Py\python.exe", win=True, isfile=lambda p: True)
    assert cmd[0].endswith("pythonw.exe") and cmd[1].endswith("baslat.py")
    assert cmd[2:] == ["--port", "8801", "--app", "--bg"]
    assert baslat.child_command(a, exe=r"C:\Py\python.exe", win=True, isfile=lambda p: False) is None
    assert baslat.child_command(a, exe="/usr/bin/python3", win=False)[0] == "/usr/bin/python3"
    b = baslat.parse_args(["--bg"])
    assert baslat.is_windowless(b)


def test_baslat_running_instance():
    """Aynı sürüm çalışıyorsa ikinci sunucu açılmaz; --no-browser ile adres yazılıp çıkılır."""
    app, port, token, th = start_server("none")
    try:
        r = subprocess.run([sys.executable, "-B", os.path.join(ROOT, "baslat.py"), "--no-browser", "--port", str(port)],
                           capture_output=True, timeout=30, env=dict(os.environ))
        assert r.returncode == 0, r.stderr
        assert b"zaten" in r.stdout and str(port).encode() in r.stdout
    finally:
        call(port, "/api/app/quit", {}, token=token)
        th.join(8)


if __name__ == "__main__":
    want = set(sys.argv[1:])
    ok = fail = 0
    try:
        for k, v in sorted(globals().items()):
            if k.startswith("test_") and (not want or k in want):
                try:
                    t = time.time()
                    v()
                    print("OK    %-36s %.2fs" % (k, time.time() - t))
                    ok += 1
                except Exception:
                    print("FAIL  ", k)
                    traceback.print_exc()
                    fail += 1
    finally:
        shutil.rmtree(TMP, ignore_errors=True)
    print("%d geçti, %d başarısız" % (ok, fail))
    sys.exit(1 if fail else 0)
