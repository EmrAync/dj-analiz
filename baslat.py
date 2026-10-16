#!/usr/bin/env python3
"""DJ Doktor — başlatıcı.

Kullanım:  python baslat.py            (arayüzü tarayıcıda açar)
           python baslat.py --port 8800 --no-browser
"""
import os
import sys

if sys.version_info < (3, 8):
    print("Bu program Python 3.8 veya üstünü gerektirir. Şu anki sürüm: %s" % sys.version.split()[0])
    print("https://www.python.org/downloads/ adresinden güncel Python'u kurun.")
    input("Kapatmak için Enter'a basın…")
    sys.exit(1)

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "vendor"))
sys.path.insert(0, HERE)

for stream in (sys.stdout, sys.stderr):
    try:
        stream.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass


def main():
    import argparse
    ap = argparse.ArgumentParser(description="DJ Doktor")
    ap.add_argument("--port", type=int, default=8770)  # v1 8765 kullanır; ikisi karışmasın
    ap.add_argument("--no-browser", action="store_true")
    args = ap.parse_args()
    import json
    import time
    import urllib.request
    import webbrowser
    from djdoktor import VERSION

    def running():
        try:
            with urllib.request.urlopen("http://127.0.0.1:%d/api/ping" % args.port, timeout=0.8) as r:
                info = json.loads(r.read().decode("utf-8"))
                return info if info.get("app") == "djdoktor" else None
        except Exception:
            return None

    info = running()
    if info and info.get("version") == VERSION:
        # aynı sürüm zaten açık: ikinci kopya yerine tarayıcıyı ona yönlendir
        print("Program zaten çalışıyor; tarayıcıda açılıyor…")
        if not args.no_browser:
            webbrowser.open("http://127.0.0.1:%d/" % args.port)
        return
    if info:
        # eski sürümün penceresi hâlâ açık: kapanmasını bekle (ikisi aynı anda çalışmasın)
        print()
        print("  Eski DJ Doktor penceresi (sürüm %s) hâlâ açık." % info.get("version", "?"))
        print("  Lütfen o siyah pencereyi kapatın. Kapatınca bu sürüm kendiliğinden açılır.")
        print()
        for _ in range(900):
            time.sleep(1)
            if not running():
                break
        else:
            input("Eski pencere kapanmadı. Kapatmak için Enter'a basın… ")
            return
    from djdoktor.server import run
    run(port=args.port, open_browser=not args.no_browser)


if __name__ == "__main__":
    main()
