#!/usr/bin/env python3
"""DJ Kütüphane Doktoru — başlatıcı.

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
    ap = argparse.ArgumentParser(description="DJ Kütüphane Doktoru")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--no-browser", action="store_true")
    args = ap.parse_args()
    # Zaten çalışıyorsa ikinci kopyayı açmak yerine tarayıcıyı ona yönlendir
    try:
        import json
        import urllib.request
        import webbrowser
        with urllib.request.urlopen("http://127.0.0.1:%d/api/ping" % args.port, timeout=0.8) as r:
            if json.loads(r.read().decode("utf-8")).get("app") == "djdoktor":
                print("Program zaten çalışıyor; tarayıcıda açılıyor…")
                if not args.no_browser:
                    webbrowser.open("http://127.0.0.1:%d/" % args.port)
                return
    except Exception:
        pass
    from djdoktor.server import run
    run(port=args.port, open_browser=not args.no_browser)


if __name__ == "__main__":
    main()
