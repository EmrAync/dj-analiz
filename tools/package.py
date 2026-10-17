"""Kullanıcıya verilecek zip paketini üretir: python tools/package.py [çıktı_klasörü]

Paket: BENIOKU.html, Baslat_Windows.bat (CRLF), Baslat_Mac.command (çalıştırılabilir), baslat.py,
djdoktor/, web/, vendor/ — testler, .git ve __pycache__ hariç. Mac'te çift tıklanabilmesi için
.command ve baslat.py dosyalarının Unix izinleri (755) zip'e yazılır.

Zip'in içindeki üst klasör "DJ Doktor"dur (zip dosyasının adı sürümlüdür): kullanıcı zip'i doğrudan Masaüstüne
açınca "DJ Doktor" adlı bir klasör çıkar; program oradan çalışır ve masaüstü kısayolunu kendisi oluşturur.
"""
from __future__ import annotations

import os
import stat
import subprocess
import sys
import time
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)

from djdoktor import VERSION  # noqa: E402

INCLUDE = ["BENIOKU.html", "Baslat_Windows.bat", "Baslat_Mac.command", "baslat.py", "djdoktor", "web", "vendor"]
EXEC = {"Baslat_Mac.command", "baslat.py"}


TOP = "DJ Doktor"


def tracked_files():
    """git'in bildiği dosyalar + henüz eklenmemiş yeni dosyalar (.gitignore'dakiler hariç); silinmişler atlanır."""
    out = subprocess.run(["git", "-C", ROOT, "ls-files", "--cached", "--others", "--exclude-standard", "--"] + INCLUDE,
                         capture_output=True, text=True, check=True)
    files = {p for p in out.stdout.splitlines() if "__pycache__" not in p and not p.endswith(".pyc")}
    return sorted(p for p in files if os.path.isfile(os.path.join(ROOT, p)))


def main():
    dest = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "dist")
    os.makedirs(dest, exist_ok=True)
    top = TOP
    out = os.path.join(dest, "DJ_Doktor_v%s.zip" % VERSION)
    with open(os.path.join(ROOT, "Baslat_Windows.bat"), "rb") as f:
        bat = f.read()
    if b"\r\n" not in bat or bat.count(b"\n") != bat.count(b"\r\n"):
        sys.exit("Baslat_Windows.bat CRLF satır sonlarıyla olmalı (cmd.exe etiketleri için).")
    now = time.localtime()[:6]
    files = tracked_files()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        dirs = set()
        for rel in files:
            parts = rel.split("/")
            for i in range(1, len(parts)):
                dirs.add("/".join(parts[:i]))
        for d in [""] + sorted(dirs):
            zi = zipfile.ZipInfo((top + "/" + d).rstrip("/") + "/", now)
            zi.create_system = 3
            zi.external_attr = (0o40755 << 16) | 0x10
            z.writestr(zi, b"")
        for rel in sorted(files):
            zi = zipfile.ZipInfo(top + "/" + rel, now)
            zi.create_system = 3
            mode = 0o755 if os.path.basename(rel) in EXEC else 0o644
            zi.external_attr = (stat.S_IFREG | mode) << 16
            zi.compress_type = zipfile.ZIP_DEFLATED
            with open(os.path.join(ROOT, rel), "rb") as f:
                z.writestr(zi, f.read())
    print("%s  (%d dosya, %d KB)" % (out, len(files), os.path.getsize(out) // 1024))


if __name__ == "__main__":
    main()
