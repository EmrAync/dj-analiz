#!/usr/bin/env python3
"""DJ Doktor — başlatıcı.

Kullanım:  python baslat.py              (Ayarlar'da "Ayrı pencerede aç" açıksa uygulama penceresi, değilse tarayıcı)
           python baslat.py --app        (ayrı uygulama penceresi: Edge/Chrome; pencere kapanınca program da kapanır)
           python baslat.py --browser    (varsayılan tarayıcıda sekme — eski davranış)
           python baslat.py --no-browser (pencere açmadan; adres ekranda yazar)
           python baslat.py --console    (bu konsol penceresinde kal; "konsol" kelimesi de olur)
           python baslat.py --port 8800

Baslat_Windows.bat / Baslat_Mac.command programı --detach ile çağırır: program konsolsuz olarak (Windows'ta
pythonw) yeniden başlatılır ve siyah pencere / Terminal hemen kapanabilir.
"""
import os
import sys

if sys.version_info < (3, 8):
    _MSG = ("Bu program Python 3.8 veya üstünü gerektirir. Şu anki sürüm: %s\n"
            "https://www.python.org/downloads/ adresinden güncel Python'u kurun." % sys.version.split()[0])
    _shown = False
    if sys.platform.startswith("win"):
        try:
            import ctypes
            ctypes.windll.user32.MessageBoxW(None, _MSG, "DJ Doktor", 0x10)
            _shown = True
        except Exception:
            pass
    if sys.stdout is not None:
        print(_MSG)
        if not _shown:
            try:
                input("Kapatmak için Enter'a basın…")
            except Exception:
                pass
    sys.exit(1)

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "vendor"))
sys.path.insert(0, HERE)

DEFAULT_PORT = 8770     # v1 8765 kullanır; ikisi karışmasın
LOG_NAME = "baslat.log"
EXIT_SHOWN = 2          # hata kullanıcıya zaten gösterildi (başlatıcı betikler ayrıca beklemesin)


def parse_args(argv=None):
    import argparse
    ap = argparse.ArgumentParser(prog="baslat.py", description="DJ Doktor")
    ap.add_argument("--port", type=int, default=DEFAULT_PORT)
    g = ap.add_mutually_exclusive_group()
    g.add_argument("--app", action="store_true", help="ayrı uygulama penceresinde aç (Edge/Chrome)")
    g.add_argument("--browser", action="store_true", help="varsayılan tarayıcıda sekme olarak aç")
    g.add_argument("--no-browser", action="store_true", help="pencere açma")
    ap.add_argument("--console", action="store_true", help="konsol penceresinde kal (iletiler burada)")
    ap.add_argument("--detach", action="store_true", help=argparse.SUPPRESS)   # konsolu bırak, arka planda başlat
    ap.add_argument("--bg", action="store_true", help=argparse.SUPPRESS)       # arka planda: konsol/terminal yok
    ap.add_argument("words", nargs="*", help=argparse.SUPPRESS)                # Baslat_Windows.bat konsol
    args = ap.parse_args(argv)
    if any(w.strip().lower() in ("konsol", "console") for w in args.words):
        args.console = True
    if args.console:
        args.detach = False
    return args


def choose_mode(args, prefs):
    """'app' | 'browser' | 'none' — bayrak yoksa ayar (Ayrı pencerede aç) belirler."""
    if args.no_browser:
        return "none"
    if args.browser:
        return "browser"
    if args.app:
        return "app"
    return "app" if prefs.get("app_window", True) else "browser"


def forward_args(args):
    out = []
    if args.port != DEFAULT_PORT:
        out += ["--port", str(args.port)]
    for flag in ("app", "browser", "no_browser"):
        if getattr(args, flag):
            out.append("--" + flag.replace("_", "-"))
    return out


def child_command(args, exe=None, win=None, isfile=None):
    """--detach: aynı programı konsolsuz başlatacak komut; Windows'ta pythonw yoksa None (konsolda devam)."""
    from djdoktor import desktop
    exe = exe or sys.executable
    win = sys.platform.startswith("win") if win is None else win
    script = os.path.join(HERE, "baslat.py")
    if win:
        pyw = desktop.win_pythonw(exe, isfile)
        if not pyw.lower().endswith("pythonw.exe"):
            return None
        exe = pyw
    if not exe:
        return None
    return [exe, script] + forward_args(args) + ["--bg"]


def is_windowless(args):
    """Kullanıcının göreceği bir konsol yok mu? (pythonw, .app, arka plan)"""
    if args.bg or sys.stdout is None:
        return True
    try:
        return not sys.stdout.isatty()
    except Exception:
        return True


def log_path():
    from djdoktor.config import workspace_dir
    return os.path.join(workspace_dir(), "gunluk", LOG_NAME)


def setup_io(windowless):
    """Konsolsuzken print'ler ve hatalar günlüğe gider (sys.stdout None olabilir)."""
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass
    if not windowless or (sys.stdout is not None and not _is_devnull(sys.stdout)):
        return
    try:
        p = log_path()
        if os.path.isfile(p) and os.path.getsize(p) > 2 * 1024 * 1024:
            os.replace(p, p + ".1")
        f = open(p, "a", encoding="utf-8", errors="replace", buffering=1)
        sys.stdout = sys.stderr = f
    except Exception:
        pass


def _is_devnull(stream):
    try:
        return os.path.samefile(stream.name, os.devnull)
    except Exception:
        return False


def say(text):
    try:
        print(text)
    except Exception:
        pass


def pause(windowless, text="Kapatmak için Enter'a basın… "):
    if windowless:
        return
    try:
        input(text)
    except Exception:
        pass


def report(msg, windowless, error=True):
    """Kullanıcıya ileti: konsolsuzsa yerel ileti kutusu (Windows MessageBox / macOS iletişim kutusu)."""
    say(msg)
    if windowless:
        from djdoktor import desktop
        desktop.message_box(msg, error=error)


def _url(port, path=""):
    return "http://127.0.0.1:%d/%s" % (port, path)


def ping(port, hold=False):
    import json
    import urllib.request
    try:
        with urllib.request.urlopen(_url(port, "api/ping" + ("?hold=1" if hold else "")), timeout=0.8) as r:
            info = json.loads(r.read().decode("utf-8"))
            return info if info.get("app") == "djdoktor" else None
    except Exception:
        return None


def find_running(port):
    """Çalışan DJ Doktor: (port, bilgi) ya da (None, None). Kayıt dosyasındaki port da denenir."""
    from djdoktor import desktop
    from djdoktor.config import workspace_dir
    ports = [port]
    rp = desktop.read_run_port(workspace_dir())
    if rp and rp not in ports:
        ports.append(rp)
    for p in ports:
        info = ping(p)
        if info:
            return p, info
    return None, None


def ask_quit(port):
    """Çalışan (2.2+) kopyadan kibarca kapanmasını iste: 'ok' | 'busy' | 'unsupported'."""
    import json
    import re
    import urllib.error
    import urllib.request
    try:
        with urllib.request.urlopen(_url(port), timeout=3) as r:
            m = re.search(r'DJD_TOKEN\s*=\s*"([^"]+)"', r.read().decode("utf-8", "replace"))
        if not m:
            return "unsupported"
        req = urllib.request.Request(_url(port, "api/app/quit"), data=b"{}", method="POST",
                                     headers={"X-DJD-Token": m.group(1), "Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=5) as r:
            return "ok" if json.loads(r.read().decode("utf-8")).get("ok") else "unsupported"
    except urllib.error.HTTPError as e:
        return "busy" if e.code == 409 else "unsupported"
    except Exception:
        return "unsupported"


def wait_old_version(port, info, windowless):
    """Eski sürüm açık: önce kibarca kapatmayı dene, olmazsa kullanıcıdan kapatmasını iste ve bekle."""
    import threading
    import time
    old = info.get("version", "?")
    if ask_quit(port) == "ok":
        for _ in range(120):
            time.sleep(0.5)
            if not ping(port):
                return True
    msg = ("Eski DJ Doktor (sürüm %s) hâlâ açık.\nOnun penceresini kapatın; kapanınca bu sürüm kendiliğinden açılır."
           % old)
    say("")
    say("  " + msg.replace("\n", "\n  "))
    say("")
    if windowless:
        threading.Thread(target=report, args=(msg, True, False), daemon=True).start()
    for i in range(900):
        time.sleep(1)
        if not ping(port):
            return True
        if i % 15 == 14:
            ask_quit(port)         # eski kopyada bir işlem sürüyorduysa bitmiş olabilir
    report("Eski DJ Doktor penceresi kapanmadı. Onu kapatıp programı yeniden açın.", windowless)
    pause(windowless)
    return False


def open_window(port, mode):
    from djdoktor import desktop
    from djdoktor.config import workspace_dir
    url = _url(port)
    if mode == "none":
        say("Program zaten çalışıyor: %s" % url)
        return
    say("Program zaten çalışıyor; pencere açılıyor…")
    ping(port, hold=True)          # pencere yüklenene kadar çalışan kopya kapanmasın
    desktop.open_app_window(url, workspace_dir(), use_app=(mode == "app"))


def main(argv=None):
    args = parse_args(argv)
    windowless = is_windowless(args)
    setup_io(windowless)
    try:
        return _main(args, windowless)
    except SystemExit:
        raise
    except BaseException as e:   # noqa: B902 — konsolsuzken hata görünür kalsın
        if isinstance(e, KeyboardInterrupt):
            return 0
        import traceback
        tb = traceback.format_exc()
        try:
            from djdoktor import util
            with open(log_path(), "a", encoding="utf-8") as f:
                f.write("[%s] başlatılamadı\n%s\n" % (util.stamp(), tb))
        except Exception:
            pass
        say(tb)
        where = ""
        try:
            where = "\n\nAyrıntı: %s" % log_path()
        except Exception:
            pass
        report("DJ Doktor açılamadı: %s%s" % (e, where), windowless)
        pause(windowless)
        return EXIT_SHOWN


def _main(args, windowless):
    from djdoktor import VERSION, desktop
    from djdoktor.config import Settings
    prefs = Settings().prefs()
    mode = choose_mode(args, prefs)
    port, info = find_running(args.port)
    if info and info.get("version") == VERSION:
        # aynı sürüm zaten açık: ikinci kopya yerine ona yeni pencere aç
        open_window(port, mode)
        return 0
    if info and not wait_old_version(port, info, windowless):
        return EXIT_SHOWN
    if args.detach:
        cmd = child_command(args)
        if cmd:
            try:
                log = open(log_path(), "ab")
            except OSError:
                log = None
            try:
                desktop.spawn_detached(cmd, cwd=HERE, stdout=log)
                say("DJ Doktor açılıyor… Bu pencere kapanabilir.")
                return 0
            except OSError as e:
                say("Arka planda başlatılamadı (%s); bu pencerede devam ediliyor." % e)
            finally:
                if log is not None:
                    log.close()
    from djdoktor.server import run
    run(port=args.port, mode=mode, windowless=windowless)
    return 0


if __name__ == "__main__":
    sys.exit(main())
