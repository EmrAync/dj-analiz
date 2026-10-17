"""Masaüstü uygulaması gibi çalışma — yalnızca standart kütüphane.

- find_browser / open_app_window: arayüz Edge / Chrome / Brave'in "--app" penceresinde açılır (adres çubuğu yok,
  kendi görev çubuğu simgesi). Programın KENDİ tarayıcı profili kullanılır (Belgeler/DJ Doktor/Pencere):
  kullanıcının tarayıcısına dokunulmaz, pencere boyutu orada hatırlanır. Böyle bir tarayıcı yoksa varsayılan
  tarayıcıda sekme açılır.
- Watchdog: uygulama penceresi kapanınca sunucu kendiliğinden kapanır (sayfa kalp atışı + kapanışta "bye").
  Bir görev sürerken asla kapanmaz.
- Masaüstü kısayolu: Windows "DJ Doktor.lnk" (PowerShell + WScript.Shell), macOS "DJ Doktor.app", Linux .desktop.
- Simge: logo bağımlılıksız çizilir (PNG: zlib + struct); ICO ve ICNS bu PNG'lerden kurulur.
"""
from __future__ import annotations

import base64
import json
import ntpath
import os
import plistlib
import re
import shlex
import shutil
import struct
import subprocess
import sys
import threading
import time
import zlib

from . import APP_NAME, VERSION, util
from .ext import route

BUNDLE_ID = "de.djdoktor.app"
PROFILE_DIR = "Pencere"          # Belgeler/DJ Doktor/Pencere: uygulama penceresinin kendi tarayıcı profili
ICON_DIR = "simge"
RUN_FILE = "calisiyor.json"      # çalışan sunucunun portu (ikinci açılış ona yönlenir)
WINDOW_SIZE = (1440, 900)


# ---------------------------------------------------------------------------
# Simge: mavi yuvarlak kare (#2f6fed) + 4 beyaz yuvarlak çubuk (index.html'deki logo, 32 birimlik ızgara)
# ---------------------------------------------------------------------------
LOGO_BG = (47, 111, 237)
LOGO_BARS = ((6, 13, 3, 6), (11, 9, 3, 14), (16, 11, 3, 10), (21, 7, 3, 18))   # x, y, w, h (yarıçap 1)


def _rr_sdf(px, py, cx, cy, hx, hy, r):
    """Yuvarlak köşeli dikdörtgene işaretli uzaklık (içeride negatif)."""
    qx = abs(px - cx) - (hx - r)
    qy = abs(py - cy) - (hy - r)
    ox, oy = (qx if qx > 0 else 0.0), (qy if qy > 0 else 0.0)
    return (ox * ox + oy * oy) ** 0.5 + min(max(qx, qy), 0.0) - r


def logo_rgba(size, margin=0.0):
    """size×size RGBA (bytearray, satır satır). Kenar yumuşatma: piksel başına n×n alt örnek, her örnekte
    alt piksel genişliğinde uzaklık tabanlı kaplama (ince çubuklar küçük boyutta da düzgün çıkar)."""
    n = 4 if size <= 64 else (2 if size <= 256 else 1)
    off = size * margin
    u = (size - 2 * off) / 32.0                         # 1 logo birimi = u piksel
    shapes = [(off + 16 * u, off + 16 * u, 16 * u, 16 * u, 8 * u)]
    for x, y, w, h in LOGO_BARS:
        shapes.append((off + (x + w / 2.0) * u, off + (y + h / 2.0) * u, w / 2.0 * u, h / 2.0 * u, 1 * u))
    bg, bars = shapes[0], shapes[1:]
    bars_box = [(int(cx - hx) - 1, int(cx + hx) + 2, int(cy - hy) - 1, int(cy + hy) + 2) for cx, cy, hx, hy, _r in bars]
    subs = [(i + 0.5) / n for i in range(n)]
    k = 1.0 / (n * n)
    corner = bg[4] + 1.5
    lo, hi = off + corner, size - off - corner
    out = bytearray(size * size * 4)
    br, bgc, bb = LOGO_BG
    for y in range(size):
        row_mid = lo <= y <= hi - 1
        for x in range(size):
            # arka plan kaplaması (köşe bölgesi dışında, kenardan uzaksa tam)
            if (row_mid or lo <= x <= hi - 1) and off + 1 <= x <= size - off - 2 and off + 1 <= y <= size - off - 2:
                a_bg = 1.0
            else:
                a_bg = 0.0
                for sy in subs:
                    for sx in subs:
                        d = _rr_sdf(x + sx, y + sy, *bg) * n
                        a_bg += k * (1.0 if d <= -0.5 else (0.0 if d >= 0.5 else 0.5 - d))
            if a_bg <= 0:
                continue
            a_bar = 0.0
            for (x0, x1, y0, y1), sh in zip(bars_box, bars):
                if x0 <= x <= x1 and y0 <= y <= y1:
                    for sy in subs:
                        for sx in subs:
                            d = _rr_sdf(x + sx, y + sy, *sh) * n
                            a_bar += k * (1.0 if d <= -0.5 else (0.0 if d >= 0.5 else 0.5 - d))
            a_bar = min(a_bar, a_bg)
            i = (y * size + x) * 4
            w = a_bar / a_bg
            out[i] = int(round(br + (255 - br) * w))
            out[i + 1] = int(round(bgc + (255 - bgc) * w))
            out[i + 2] = int(round(bb + (255 - bb) * w))
            out[i + 3] = int(round(255 * a_bg))
    return out


def png_bytes(width, height, rgba):
    def chunk(typ, data):
        return struct.pack(">I", len(data)) + typ + data + struct.pack(">I", zlib.crc32(typ + data) & 0xFFFFFFFF)
    stride = width * 4
    raw = b"".join(b"\x00" + bytes(rgba[y * stride:(y + 1) * stride]) for y in range(height))
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))


_PNG_CACHE = {}
_PNG_LOCK = threading.Lock()


def logo_png(size, margin=0.0):
    key = (int(size), round(margin, 3))
    with _PNG_LOCK:
        if key not in _PNG_CACHE:
            _PNG_CACHE[key] = png_bytes(size, size, logo_rgba(size, margin))
        return _PNG_CACHE[key]


ICO_SIZES = (16, 24, 32, 48, 64, 128, 256)


def ico_bytes(sizes=ICO_SIZES):
    """Windows .ico: PNG kayıtlı (Vista ve sonrası tüm boyutlarda okur)."""
    imgs = [(s, logo_png(s)) for s in sizes]
    head = struct.pack("<HHH", 0, 1, len(imgs))
    off = 6 + 16 * len(imgs)
    ents, data = b"", b""
    for s, png in imgs:
        ents += struct.pack("<BBBBHHII", s % 256, s % 256, 0, 0, 1, 32, len(png), off + len(data))
        data += png
    return head + ents + data


# macOS simge kayıtları (PNG içerikli; 10.7+): tür -> piksel
ICNS_TYPES = (("ic11", 32), ("ic12", 64), ("ic07", 128), ("ic13", 256), ("ic08", 256), ("ic14", 512), ("ic09", 512),
              ("ic10", 1024))
ICNS_MARGIN = 0.09               # macOS simgeleri kenarda boşluk bırakır (Big Sur ızgarası ~%10)


def icns_bytes(types=ICNS_TYPES):
    body = b""
    for typ, px in types:
        png = logo_png(px, ICNS_MARGIN)
        body += typ.encode("ascii") + struct.pack(">I", len(png) + 8) + png
    return b"icns" + struct.pack(">I", len(body) + 8) + body


def ensure_icons(ws):
    """Simge dosyaları çalışma alanında (kısayollar bunları gösterir). Sürüm değişince yeniden çizilir."""
    d = os.path.join(ws, ICON_DIR)
    os.makedirs(d, exist_ok=True)
    files = {"ico": os.path.join(d, "DJ Doktor.ico"), "icns": os.path.join(d, "DJ Doktor.icns"),
             "png": os.path.join(d, "DJ Doktor.png")}
    makers = {"ico": ico_bytes, "icns": icns_bytes, "png": lambda: logo_png(256)}
    for k, p in files.items():
        if not os.path.isfile(p) or os.path.getsize(p) < 64:
            util.atomic_write_bytes(p, makers[k]())
    return files


def manifest(name=APP_NAME):
    return {"name": name, "short_name": name, "start_url": "/", "scope": "/", "display": "standalone",
            "background_color": "#f4f5f7", "theme_color": "#2f6fed", "lang": "tr",
            "icons": [{"src": "/icon-%d.png" % s, "sizes": "%dx%d" % (s, s), "type": "image/png"}
                      for s in (192, 512)]}


def static_asset(path):
    """Sunucunun simge / manifest yolları: (gövde, içerik türü) ya da None."""
    if path == "/manifest.webmanifest":
        return json.dumps(manifest(), ensure_ascii=False).encode("utf-8"), "application/manifest+json"
    if path == "/favicon.ico":
        return ico_bytes((16, 32, 48)), "image/x-icon"
    if path == "/icon.png":
        return logo_png(256), "image/png"
    m = re.match(r"^/icon-(\d{2,3})\.png$", path)
    if m and int(m.group(1)) in (16, 32, 48, 64, 128, 180, 192, 256, 512):
        return logo_png(int(m.group(1))), "image/png"
    return None


def warm_icons():
    """Sık istenen simgeleri arka planda önceden çiz (ilk istek beklemesin)."""
    def run():
        for s in (32, 192, 256, 512):
            try:
                logo_png(s)
            except Exception:
                pass
    threading.Thread(target=run, name="djd-icons", daemon=True).start()


# ---------------------------------------------------------------------------
# Tarayıcı: "--app" penceresi açabilen Chromium ailesi
# ---------------------------------------------------------------------------
APP_PATHS = r"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths"


def _platform(plat=None):
    plat = plat or sys.platform
    if plat in ("win", "mac", "linux"):
        return plat
    return "win" if plat.startswith("win") else ("mac" if plat == "darwin" else "linux")


def _reg_read(hive, key, value=""):
    """Windows kayıt defterinden tek değer (yoksa None). hive: 'HKCU' | 'HKLM'."""
    try:
        import winreg  # type: ignore
    except ImportError:
        return None
    h = {"HKCU": winreg.HKEY_CURRENT_USER, "HKLM": winreg.HKEY_LOCAL_MACHINE}[hive]
    try:
        with winreg.OpenKey(h, key) as k:
            v, _t = winreg.QueryValueEx(k, value)
            return v if isinstance(v, str) else None
    except OSError:
        return None


def expand_win(s, env):
    """%USERPROFILE% gibi Windows ortam değişkenlerini açar (büyük/küçük harf duyarsız)."""
    low = {k.lower(): v for k, v in env.items()}
    return re.sub(r"%([^%]+)%", lambda m: low.get(m.group(1).lower(), m.group(0)), s or "")


def browser_candidates(plat=None, env=None, home=None):
    """Sırayla denenecek (ad, yol) çiftleri. Windows'ta yollar ntpath ile kurulur."""
    plat = _platform(plat)
    env = os.environ if env is None else env
    out = []
    if plat == "win":
        bases = [env.get(k) for k in ("ProgramFiles(x86)", "ProgramFiles", "ProgramW6432", "LOCALAPPDATA")]
        bases = [b for b in bases if b]
        for name, sub in (("Microsoft Edge", r"Microsoft\Edge\Application\msedge.exe"),
                          ("Google Chrome", r"Google\Chrome\Application\chrome.exe"),
                          ("Brave", r"BraveSoftware\Brave-Browser\Application\brave.exe")):
            for b in bases:
                out.append((name, ntpath.join(b, sub)))
    elif plat == "mac":
        home = home or os.path.expanduser("~")
        for name, app, exe in (("Google Chrome", "Google Chrome.app", "Google Chrome"),
                               ("Microsoft Edge", "Microsoft Edge.app", "Microsoft Edge"),
                               ("Brave", "Brave Browser.app", "Brave Browser"),
                               ("Chromium", "Chromium.app", "Chromium")):
            for base in ("/Applications", os.path.join(home, "Applications")):
                out.append((name, os.path.join(base, app, "Contents", "MacOS", exe)))
    return out


WIN_APP_EXES = (("Microsoft Edge", "msedge.exe"), ("Google Chrome", "chrome.exe"), ("Brave", "brave.exe"))
LINUX_CMDS = (("Chromium", "chromium"), ("Chromium", "chromium-browser"), ("Google Chrome", "google-chrome"),
              ("Google Chrome", "google-chrome-stable"), ("Microsoft Edge", "microsoft-edge"),
              ("Microsoft Edge", "microsoft-edge-stable"), ("Brave", "brave-browser"))


def find_browser(plat=None, env=None, isfile=None, which=None, reg=None, home=None):
    """{'name', 'path'} ya da None. Bağımlılıklar test için değiştirilebilir (sahte dosya sistemi / kayıt defteri)."""
    plat = _platform(plat)
    isfile = isfile or os.path.isfile
    which = which or shutil.which
    reg = reg or _reg_read
    env = os.environ if env is None else env
    if plat == "linux":
        for name, cmd in LINUX_CMDS:
            p = which(cmd)
            if p:
                return {"name": name, "path": p}
        return None
    cands = browser_candidates(plat, env, home)
    if plat == "win":
        # bilinen kurulum yerleri; yoksa kayıt defterindeki App Paths (başka diske kurulmuş olabilir)
        for name, exe in WIN_APP_EXES:
            for n, p in cands:
                if n == name and isfile(p):
                    return {"name": name, "path": p}
            for hive in ("HKCU", "HKLM"):
                v = reg(hive, APP_PATHS + "\\" + exe, "")
                if v:
                    v = expand_win(v.strip().strip('"'), env)
                    if isfile(v):
                        return {"name": name, "path": v}
        return None
    for name, p in cands:
        if isfile(p):
            return {"name": name, "path": p}
    return None


def profile_dir(ws, env=None, platform=None, home=None):
    """Uygulama penceresinin tarayıcı profili. Belgeler'de DEĞİL (iCloud / OneDrive "Belgeler" eşitlemesi yüzlerce
    önbellek dosyasını buluta taşımasın): Windows %LOCALAPPDATA%, macOS ~/Library/Application Support,
    Linux ~/.config. Testlerde (DJDOKTOR_HOME) çalışma klasörünün içinde kalır."""
    env = os.environ if env is None else env
    platform = platform or sys.platform
    home = home or os.path.expanduser("~")
    if env.get("DJDOKTOR_HOME"):
        return os.path.join(ws, PROFILE_DIR)
    if platform.startswith("win"):
        base = env.get("LOCALAPPDATA")
        return ntpath.join(base, APP_NAME, PROFILE_DIR) if base else os.path.join(ws, PROFILE_DIR)
    if platform == "darwin":
        return os.path.join(home, "Library", "Application Support", APP_NAME, PROFILE_DIR)
    return os.path.join(env.get("XDG_CONFIG_HOME") or os.path.join(home, ".config"), "djdoktor", PROFILE_DIR)


def app_command(browser_path, url, profile):
    return [browser_path, "--app=" + url, "--user-data-dir=" + profile, "--no-first-run",
            "--no-default-browser-check", "--window-size=%d,%d" % WINDOW_SIZE,
            "--disable-features=Translate"]   # Türkçe sayfa için "çevir?" balonu çıkmasın


def spawn_detached(cmd, cwd=None, stdout=None):
    """Bu süreçten bağımsız başlatır (konsol/terminal kapanınca ölmez, konsol penceresi açmaz)."""
    kw = {"cwd": cwd, "stdin": subprocess.DEVNULL, "stdout": stdout or subprocess.DEVNULL,
          "stderr": subprocess.STDOUT if stdout else subprocess.DEVNULL, "close_fds": True}
    if util.IS_WIN:
        flags = 0x00000008 | 0x00000200            # DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP
        try:
            return subprocess.Popen(cmd, creationflags=flags | 0x01000000, **kw)   # + CREATE_BREAKAWAY_FROM_JOB
        except OSError:
            return subprocess.Popen(cmd, creationflags=flags, **kw)
    return subprocess.Popen(cmd, start_new_session=True, **kw)


def open_app_window(url, ws, use_app=True, browser=None, popen=None, fallback=None):
    """Arayüzü açar. Dönüş: {'mode': 'app'|'browser', 'browser': ad}. Önce --app penceresi, olmazsa sekme."""
    popen = popen or spawn_detached
    if use_app:
        b = browser if browser is not None else find_browser()
        if b:
            prof = profile_dir(ws)
            try:
                os.makedirs(prof, exist_ok=True)
                popen(app_command(b["path"], url, prof))
                return {"mode": "app", "browser": b["name"]}
            except Exception:
                pass
    if fallback is None:
        import webbrowser
        fallback = webbrowser.open
    try:
        fallback(url)
    except Exception:
        pass
    return {"mode": "browser", "browser": None}


# ---------------------------------------------------------------------------
# Kendiliğinden kapanma
# ---------------------------------------------------------------------------
class Watchdog:
    """Pencere kapanınca sunucuyu kapatma kararı. Her sayfa (cid) kalp atışı yollar (5 sn; gizli/simge durumundaki
    pencerede tarayıcı bunu dakikada bire indirir) ve kapanırken 'bye' der.

    policy: 'app'  — son pencere 'bye' dedi ve `grace` sn içinde yenisi gelmedi (sayfa yenileme) YA DA hiçbir
                     pencereden `timeout` sn kalp atışı yok (pencere çöktü) YA DA ilk pencere `start` sn içinde gelmedi
            'bye'  — yalnızca 'bye' + grace (sıradan tarayıcı sekmesi: gizli sekmeler uyutulabilir, zaman aşımı yok)
            'off'  — yalnızca kullanıcı 'Programı kapat' derse
    Bir görev sürerken (busy) hiçbir karar verilmez; görev bitince yeniden bakılır.
    Bilgisayar uykudan uyanınca (iki tick arası çok uzun) pencerelerin süresi tazelenir."""

    GRACE, TIMEOUT, START, HOLD, SLEEP_GAP = 10.0, 180.0, 180.0, 30.0, 30.0

    def __init__(self, policy="app", busy=None, clock=None, grace=None, timeout=None, start=None):
        self.policy = policy
        self.busy = busy or (lambda: False)
        self.clock = clock or time.monotonic
        self.grace = self.GRACE if grace is None else grace
        self.timeout = self.TIMEOUT if timeout is None else timeout
        self.start = self.START if start is None else start
        self.lock = threading.Lock()
        now = self.clock()
        self.t0 = now
        self.clients = {}
        self.seen = False
        self.last_bye = None
        self.hold_until = 0.0
        self.quit_req = False
        self.last_tick = now

    def hb(self, cid="?"):
        with self.lock:
            self.clients[str(cid)[:64]] = self.clock()
            self.seen = True
            if len(self.clients) > 50:        # bozuk istemci sonsuz kimlik yollamasın
                for k in sorted(self.clients, key=self.clients.get)[:-50]:
                    self.clients.pop(k, None)

    def bye(self, cid="?"):
        with self.lock:
            self.clients.pop(str(cid)[:64], None)
            self.seen = True
            self.last_bye = self.clock()

    def hold(self, sec=None):
        """Yeni bir pencere açılmak üzere (ikinci açılış): kısa süre kapanma."""
        with self.lock:
            self.hold_until = max(self.hold_until, self.clock() + (self.HOLD if sec is None else sec))

    def request_quit(self):
        with self.lock:
            self.quit_req = True

    def status(self):
        with self.lock:
            return {"policy": self.policy, "clients": len(self.clients), "quit": self.quit_req}

    def tick(self):
        """Kapanma nedeni ('user' | 'closed' | 'timeout' | 'nostart') ya da None."""
        with self.lock:
            now = self.clock()
            if now - self.last_tick > self.SLEEP_GAP:
                # uyku / askıya alma: sayfaların zamanlayıcıları da durmuştu, onları hemen kapatma
                for k in self.clients:
                    self.clients[k] = now
                self.hold_until = max(self.hold_until, now + self.HOLD)
            self.last_tick = now
            if self.busy():
                return None
            if self.quit_req:
                return "user"
            if self.policy == "off" or now < self.hold_until:
                return None
            if self.policy == "app":
                for k in [k for k, t in self.clients.items() if now - t > self.timeout]:
                    del self.clients[k]
            if self.clients:
                return None
            if not self.seen:
                return "nostart" if self.policy == "app" and now - self.t0 > self.start else None
            if self.last_bye is not None and now - self.last_bye >= self.grace:
                return "closed"
            if self.policy == "app" and self.last_bye is None:
                return "timeout"
            return None


# ---------------------------------------------------------------------------
# Masaüstü kısayolu
# ---------------------------------------------------------------------------
SHORTCUT_NAME = "DJ Doktor"


def win_known_folder(name, reg=None, env=None, isdir=None):
    """Kullanıcının gerçek Masaüstü / Programlar klasörü (OneDrive'a taşınmış ya da yerelleştirilmiş olabilir)."""
    reg = reg or _reg_read
    env = os.environ if env is None else env
    isdir = isdir or os.path.isdir
    for key in (r"Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders",
                r"Software\Microsoft\Windows\CurrentVersion\Explorer\Shell Folders"):
        v = reg("HKCU", key, name)
        if v:
            p = expand_win(v, env)
            if "%" not in p and isdir(p):
                return p
    up = env.get("USERPROFILE") or env.get("HOMEPATH") or os.path.expanduser("~")
    if name == "Programs":
        ad = env.get("APPDATA") or ntpath.join(up, "AppData", "Roaming")
        return ntpath.join(ad, "Microsoft", "Windows", "Start Menu", "Programs")
    return ntpath.join(up, name)


def win_pythonw(exe=None, isfile=None):
    """Konsol penceresi açmayan pythonw.exe (çalışan python'un yanında); yoksa python'un kendisi."""
    exe = exe or sys.executable
    isfile = isfile or os.path.isfile
    d, base = ntpath.split(exe)
    if base.lower() == "pythonw.exe":
        return exe
    w = ntpath.join(d, "pythonw.exe")
    return w if isfile(w) else exe


def ps_quote(s):
    """PowerShell tek tırnaklı dize. PowerShell ‘ ’ ‚ ‛ işaretlerini de tek tırnak sayar: hepsi ikilenir."""
    return "'" + re.sub("(['\u2018\u2019\u201a\u201b])", r"\1\1", s) + "'"


def lnk_script(links, target, arguments, workdir, icon, desc=APP_NAME):
    lines = ["$ErrorActionPreference = 'Stop'", "$ProgressPreference = 'SilentlyContinue'",
             "$sh = New-Object -ComObject WScript.Shell"]
    for p in links:
        lines += ["$s = $sh.CreateShortcut(%s)" % ps_quote(p),
                  "$s.TargetPath = %s" % ps_quote(target),
                  "$s.Arguments = %s" % ps_quote(arguments),
                  "$s.WorkingDirectory = %s" % ps_quote(workdir),
                  "$s.IconLocation = %s" % ps_quote(icon + ",0"),
                  "$s.Description = %s" % ps_quote(desc),
                  "$s.WindowStyle = 1",
                  "$s.Save()"]
    return "\r\n".join(lines) + "\r\n"


def ps_encoded(script):
    """powershell -EncodedCommand: UTF-16LE + base64 (Türkçe harf ve boşluklu yollar tırnak derdi olmadan geçer)."""
    return base64.b64encode(script.encode("utf-16-le")).decode("ascii")


def win_shortcut_plan(app_dir, ws, reg=None, env=None, isdir=None, isfile=None, exe=None):
    env = os.environ if env is None else env
    desk = win_known_folder("Desktop", reg, env, isdir)
    progs = win_known_folder("Programs", reg, env, isdir)
    target = win_pythonw(exe, isfile)
    args = '"%s" --app' % ntpath.join(app_dir, "baslat.py")
    icon = ntpath.join(ws, ICON_DIR, "DJ Doktor.ico")
    links = [ntpath.join(desk, SHORTCUT_NAME + ".lnk"), ntpath.join(progs, SHORTCUT_NAME + ".lnk")]
    script = lnk_script(links, target, args, app_dir, icon)
    ps = ntpath.join(env.get("SystemRoot") or env.get("WINDIR") or r"C:\Windows",
                     "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
    return {"path": links[0], "links": links, "target": target, "args": args, "icon": icon, "script": script,
            "command": [ps, "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
                        "-EncodedCommand", ps_encoded(script)]}


def _create_win(app_dir, ws):
    ensure_icons(ws)
    plan = win_shortcut_plan(app_dir, ws)
    cmd = plan["command"]
    if not os.path.isfile(cmd[0]):
        cmd = ["powershell.exe"] + cmd[1:]
    os.makedirs(os.path.dirname(plan["links"][1]), exist_ok=True)
    r = subprocess.run(cmd, capture_output=True, timeout=90, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    if r.returncode != 0 or not os.path.isfile(plan["path"]):
        raise OSError("Kısayol oluşturulamadı. %s" % ps_error(r.stderr or r.stdout or b""))
    return plan


def ps_error(raw):
    """PowerShell hata çıktısından okunur ilk satır (CLIXML / XML etiketleri ayıklanır)."""
    text = raw.decode("mbcs" if util.IS_WIN else "utf-8", "replace") if isinstance(raw, bytes) else str(raw)
    text = text.replace("#< CLIXML", "").replace("_x000D__x000A_", "\n")
    text = re.sub(r"<[^<>]*>", " ", text)
    for line in text.splitlines():
        line = " ".join(line.split())
        if line and not line.startswith("#<"):
            return line[:200]
    return ""


MAC_SCRIPT = r"""#!/bin/bash
# DJ Doktor — bu uygulama paketini DJ Doktor oluşturdu (Ayarlar > Uygulama). Programı açar, sonra çıkar.
# djdoktor-app-dir: %(dir_comment)s
APP_DIR=%(app_dir)s
LOG=%(log)s
export PYTHONUTF8=1
export PATH="/opt/homebrew/bin:/usr/local/bin:/Library/Frameworks/Python.framework/Versions/Current/bin:$PATH"
fail() {
  /usr/bin/osascript -e 'on run argv' -e 'display dialog (item 1 of argv) with title "DJ Doktor" buttons {"Tamam"} default button 1 with icon caution' -e 'end run' "$1" >/dev/null 2>&1
  exit 1
}
[ -f "$APP_DIR/baslat.py" ] || fail "DJ Doktor klasörü bulunamadı (taşınmış olabilir). Klasördeki Baslat_Mac.command ile aç, sonra Ayarlar > Uygulama'dan kısayolu yenile."
PY=""
for c in %(pythons)s python3 /opt/homebrew/bin/python3 /usr/local/bin/python3 /Library/Frameworks/Python.framework/Versions/Current/bin/python3 /usr/bin/python3; do
  if [ -x "$c" ] || command -v "$c" >/dev/null 2>&1; then
    if "$c" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 8) else 1)' >/dev/null 2>&1; then PY="$c"; break; fi
  fi
done
[ -n "$PY" ] || fail "Python 3 bulunamadı. python.org'dan Python 3'ü kurup tekrar dene."
cd "$APP_DIR" || fail "DJ Doktor klasörü açılamadı."
mkdir -p "$(dirname "$LOG")" 2>/dev/null
exec "$PY" baslat.py --detach --app >>"$LOG" 2>&1
"""


def mac_app_plan(app_dir, ws, python=None):
    log = os.path.join(ws, "gunluk", "baslat.log")
    py = python or sys.executable or ""
    script = MAC_SCRIPT % {"app_dir": shlex.quote(app_dir), "log": shlex.quote(log),
                           "pythons": shlex.quote(py) if py else "", "dir_comment": app_dir.replace("\n", " ")}
    info = {"CFBundleName": APP_NAME, "CFBundleDisplayName": APP_NAME, "CFBundleIdentifier": BUNDLE_ID,
            "CFBundleExecutable": APP_NAME, "CFBundleIconFile": "icon.icns", "CFBundlePackageType": "APPL",
            "CFBundleSignature": "????", "CFBundleInfoDictionaryVersion": "6.0",
            "CFBundleShortVersionString": VERSION, "CFBundleVersion": VERSION,
            "LSMinimumSystemVersion": "10.13", "NSHighResolutionCapable": True,
            "LSApplicationCategoryType": "public.app-category.music"}
    return {"script": script, "info": info}


def _bundle_is_ours(path):
    try:
        with open(os.path.join(path, "Contents", "Info.plist"), "rb") as f:
            return plistlib.load(f).get("CFBundleIdentifier") == BUNDLE_ID
    except Exception:
        return False


def make_mac_app(target_dir, app_dir, ws, python=None, icns=None):
    """target_dir/DJ Doktor.app paketini kurar (var olan paket bizimse güncellenir; başkasınınsa dokunulmaz)."""
    path = os.path.join(target_dir, SHORTCUT_NAME + ".app")
    if os.path.lexists(path) and not _bundle_is_ours(path):
        raise FileExistsError("Masaüstünde aynı adda başka bir uygulama var: %s" % path)
    plan = mac_app_plan(app_dir, ws, python)
    contents = os.path.join(path, "Contents")
    for sub in ("MacOS", "Resources"):
        os.makedirs(os.path.join(contents, sub), exist_ok=True)
    util.atomic_write_bytes(os.path.join(contents, "Info.plist"), plistlib.dumps(plan["info"]))
    util.atomic_write_bytes(os.path.join(contents, "PkgInfo"), b"APPL????")
    exe = os.path.join(contents, "MacOS", APP_NAME)
    util.atomic_write_bytes(exe, plan["script"].encode("utf-8"))
    os.chmod(exe, 0o755)
    util.atomic_write_bytes(os.path.join(contents, "Resources", "icon.icns"), icns if icns is not None else icns_bytes())
    try:
        os.utime(path, None)          # Finder simgeyi yenilesin
    except OSError:
        pass
    return path


def linux_desktop_entry(app_dir, icon, python=None):
    def q(s):
        return '"' + re.sub(r'(["`$\\])', r"\\\1", s) + '"'
    py = python or sys.executable or "python3"
    return ("[Desktop Entry]\nType=Application\nName=%s\nComment=Serato / Engine DJ müzik düzeni\n"
            "Exec=%s %s --app\nPath=%s\nIcon=%s\nTerminal=false\nCategories=AudioVideo;Audio;\n"
            % (APP_NAME, q(py), q(os.path.join(app_dir, "baslat.py")), app_dir, icon))


def _linux_desktop_dir(home):
    if os.path.abspath(home) != os.path.abspath(os.path.expanduser("~")):
        return os.path.join(home, "Desktop")
    try:
        r = subprocess.run(["xdg-user-dir", "DESKTOP"], capture_output=True, timeout=5)
        p = r.stdout.decode("utf-8", "replace").strip()
        if p and os.path.isdir(p) and os.path.abspath(p) != os.path.abspath(home):
            return p
    except Exception:
        pass
    return os.path.join(home, "Desktop")


def shortcut_path(plat=None, home=None):
    plat = _platform(plat)
    home = home or os.path.expanduser("~")
    if plat == "win":
        return ntpath.join(win_known_folder("Desktop"), SHORTCUT_NAME + ".lnk")
    if plat == "mac":
        return os.path.join(home, "Desktop", SHORTCUT_NAME + ".app")
    return os.path.join(_linux_desktop_dir(home), SHORTCUT_NAME + ".desktop")


def create_shortcut(app_dir, ws, plat=None, home=None):
    """Masaüstüne kısayol. Dönüş: kısayolun yolu. Hata: OSError (Türkçe ileti)."""
    plat = _platform(plat)
    home = home or os.path.expanduser("~")
    if plat == "win":
        return _create_win(app_dir, ws)["path"]
    if plat == "mac":
        desk = os.path.join(home, "Desktop")
        return make_mac_app(desk, app_dir, ws)
    icons = ensure_icons(ws)
    entry = linux_desktop_entry(app_dir, icons["png"])
    apps = os.path.join(home, ".local", "share", "applications")
    os.makedirs(apps, exist_ok=True)
    util.atomic_write_text(os.path.join(apps, "djdoktor.desktop"), entry)
    path = shortcut_path("linux", home)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    util.atomic_write_text(path, entry)
    os.chmod(path, 0o755)
    return path


def shortcut_status(prefs, app_dir, plat=None, home=None):
    try:
        p = shortcut_path(plat, home)
    except Exception:
        return {"supported": False, "exists": False}
    exists = os.path.exists(p)
    rec = prefs.get("shortcut") or {}
    current = exists and (not rec or (rec.get("dir") == app_dir and (not rec.get("target")
                                                                   or os.path.exists(rec["target"]))))
    return {"supported": True, "exists": exists, "current": bool(current), "path": p,
            "name": os.path.basename(p)}


# ---------------------------------------------------------------------------
# Çalışan kopyanın kaydı (ikinci açılış portu buradan da bulur) ve yerel ileti kutusu
# ---------------------------------------------------------------------------
def write_run_file(ws, port, mode):
    try:
        util.write_json(os.path.join(ws, RUN_FILE), {"pid": os.getpid(), "port": port, "version": VERSION,
                                                     "mode": mode, "started": util.now()})
    except OSError:
        pass


def clear_run_file(ws, port):
    p = os.path.join(ws, RUN_FILE)
    rec = util.read_json(p, {}) or {}
    if rec.get("pid") == os.getpid() and rec.get("port") == port:
        try:
            os.remove(p)
        except OSError:
            pass


def read_run_port(ws):
    rec = util.read_json(os.path.join(ws, RUN_FILE), {}) or {}
    try:
        return int(rec.get("port") or 0) or None
    except (TypeError, ValueError):
        return None


def message_box(text, title=APP_NAME, error=True):
    """Konsolsuz (pythonw / .app) çalışırken hatayı kullanıcıya gösterir."""
    try:
        if util.IS_WIN:
            import ctypes
            flags = (0x10 if error else 0x40) | 0x10000 | 0x40000     # simge | SETFOREGROUND | TOPMOST
            ctypes.windll.user32.MessageBoxW(None, str(text), str(title), flags)  # type: ignore[attr-defined]
            return True
        if util.IS_MAC:
            subprocess.run(["/usr/bin/osascript", "-e", "on run argv",
                            "-e", 'display dialog (item 1 of argv) with title (item 2 of argv) buttons {"Tamam"} '
                                  'default button 1 with icon %s' % ("caution" if error else "note"),
                            "-e", "end run", str(text), str(title)], capture_output=True, timeout=3600)
            return True
    except Exception:
        pass
    try:
        sys.stderr.write("%s: %s\n" % (title, text))
    except Exception:
        pass
    return False


# ---------------------------------------------------------------------------
# API: /api/app/...  (kütüphane seçilmeden de çalışır)
# ---------------------------------------------------------------------------
def info(app):
    from .config import app_dir
    prefs = app.settings.prefs()
    wd = getattr(app, "watchdog", None)
    mode = getattr(app, "mode", "none")
    sc = shortcut_status(prefs, app_dir())
    b = getattr(app, "browser", None)
    return {"platform": _platform(), "mode": mode, "app_mode": mode == "app",
            "auto_quit": bool(wd and wd.policy != "off"), "browser": b,
            "app_window": prefs.get("app_window", True), "shortcut": sc,
            # ilk "uygulama" açılışında bir kez (Chrome/Edge yoksa da: kısayol programı sekmede açar)
            "offer": bool(getattr(app, "requested_mode", mode) == "app" and sc.get("supported")
                          and not sc.get("exists") and not prefs.get("shortcut_offered")),
            "version": VERSION}


@route("app", needs_lib=False)
def _api(h, lib, method, parts, qs, body):
    app = h.app
    act = parts[1] if len(parts) > 1 else ""
    wd = getattr(app, "watchdog", None)
    if act == "info" and method == "GET":
        return h._json(info(app))
    if method != "POST":
        return None
    if act == "hb":
        cid = body.get("cid") or qs.get("c") or "?"
        if wd:
            wd.hb(cid)
        return h._json({"ok": True, "auto_quit": bool(wd and wd.policy != "off")})
    if act == "bye":
        if wd:
            wd.bye(qs.get("c") or body.get("cid") or "?")
        return h._json({"ok": True})
    if act == "offer":
        app.settings.set_prefs(shortcut_offered=True)
        return h._json({"ok": True})
    if act == "shortcut":
        from .config import app_dir
        ad = app_dir()
        try:
            path = create_shortcut(ad, app.settings.ws)
        except PermissionError:
            return h._err("Masaüstüne yazma izni yok. Sistem ayarlarından izin verip yeniden dene.", 400, "denied")
        except (OSError, subprocess.SubprocessError) as e:
            app.log("kısayol: %r" % (e,))
            return h._err(str(e) or "Kısayol oluşturulamadı.", 400, "shortcut")
        rec = {"path": path, "dir": ad, "target": win_pythonw() if util.IS_WIN else (sys.executable or ""),
               "ts": util.now()}
        app.settings.set_prefs(shortcut=rec, shortcut_offered=True)
        return h._json({"ok": True, "path": path, "shortcut": shortcut_status(app.settings.prefs(), ad)})
    if act == "quit":
        if not app.tasks.idle():
            return h._err("Bir işlem sürüyor. Bitince kapatabilirsin.", 409, "busy")
        if wd is None:
            return h._err("Program bu modda buradan kapatılamaz.", 400, "no_watchdog")
        wd.request_quit()
        return h._json({"ok": True})
    return None
