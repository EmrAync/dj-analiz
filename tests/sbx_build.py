"""Gerçek veriden SAHTE SSD (sandbox) üretir — gerçek dosyalara yalnızca OKUMA erişimi.

  python sbx_build.py <kaynak_kopya_klasörü> <hedef_sandbox>

  * Kaynaktaki her MP3 için: gerçek etiket baytları (ID3, kapak dahil) aynen + gerçek ses imzasından
    türetilmiş küçük sahte ses (çiftler yine çift kalır) + gerçek süre (Xing başlığıyla).
  * Serato veritabanında olup kaynakta olmayan yollar (SSD'nin tamamı) için sahte dosya
    (etiketler Serato veritabanından).
  * _Serato_ (database V2, crate'ler) ve Engine Library/Database2/m.db kopyalanır.
"""
from __future__ import annotations

import hashlib
import os
import shutil
import struct
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
for p in (os.path.join(HERE, "..", "vendor"), os.path.join(HERE, "..")):
    if os.path.isdir(p):
        sys.path.insert(0, p)

from djdoktor import audiosig, names, serato, tags as T  # noqa: E402

HDR = b"\xff\xfb\x90\x64"
FL = 417
SKIP_TOP = {"_djdoktor_", "_djdoktor_karantina", "$recycle.bin", "system volume information"}


def _frames(seed: str, n: int) -> bytes:
    out = bytearray()
    h = hashlib.sha256(seed.encode("utf-8", "replace")).digest()
    for i in range(n):
        body = bytearray()
        while len(body) < FL - 4:
            h = hashlib.sha256(h + bytes([i & 255])).digest()
            body += h
        out += HDR + bytes(body[:FL - 4]).replace(b"\xff", b"\xfe")
    return bytes(out)


def _xing(nframes: int) -> bytes:
    side = b"\x00" * 32
    x = b"Xing" + struct.pack(">I", 1) + struct.pack(">I", max(1, nframes))
    body = side + x
    return HDR + body + b"\x00" * (FL - 4 - len(body))


def synth_audio(seed: str, duration) -> bytes:
    nfr = int(round((duration or 200.0) * 44100 / 1152))
    return _xing(nfr) + _frames(seed, 11)


def parse_len(s):
    try:
        s = (s or "").strip()
        if not s:
            return None
        m, rest = s.split(":", 1)
        return int(m) * 60 + float(rest)
    except (ValueError, TypeError):
        return None


def id3_bytes(title=None, artist=None, album=None, genre=None, comment=None):
    from mutagen.id3 import COMM, ID3, TALB, TCON, TIT2, TPE1
    import io
    t = ID3()
    if title:
        t.add(TIT2(encoding=3, text=title))
    if artist:
        t.add(TPE1(encoding=3, text=artist))
    if album:
        t.add(TALB(encoding=3, text=album))
    if genre:
        t.add(TCON(encoding=3, text=genre))
    if comment:
        t.add(COMM(encoding=3, lang="eng", desc="", text=comment))
    bio = io.BytesIO()
    t.save(bio, padding=lambda info: 0)
    return bio.getvalue()


def main(src, dst):
    t0 = time.time()
    os.makedirs(dst, exist_ok=True)
    stats = {"real_mp3": 0, "real_copy": 0, "junk": 0, "other": 0, "serato_only": 0, "skipped": 0}
    present_keys = set()
    for dirpath, dirnames, filenames in os.walk(src):
        rel_dir = os.path.relpath(dirpath, src).replace(os.sep, "/")
        rel_dir = "" if rel_dir == "." else rel_dir
        if not rel_dir:
            dirnames[:] = [d for d in dirnames if names.fold(d) not in SKIP_TOP]
        parts = names.split_rel(rel_dir)
        if parts and names.fold(parts[0]) == "_serato_":
            dirnames[:] = []
            continue
        if parts and names.fold(parts[0]) == "engine library" and (len(parts) < 2 or names.fold(parts[1]) != "music"):
            if len(parts) == 1:
                dirnames[:] = [d for d in dirnames if names.fold(d) == "music"]
            else:
                dirnames[:] = []
            continue
        for n in filenames:
            s_abs = os.path.join(dirpath, n)
            rel = (rel_dir + "/" + n) if rel_dir else n
            d_abs = os.path.join(dst, *rel.split("/"))
            os.makedirs(os.path.dirname(d_abs), exist_ok=True)
            kind = names.classify(n)
            ext = os.path.splitext(n)[1].lower()
            try:
                size = os.path.getsize(s_abs)
                if kind == "audio" and ext == ".mp3" and size > 0:
                    with open(s_abs, "rb") as f:
                        off, ln = audiosig.audio_region(f, ext, size)
                        if ln <= 0:
                            off, ln = 0, size
                        sig = audiosig.quick_sig_of(f, off, ln)
                        f.seek(0)
                        head = f.read(off)
                        f.seek(off + ln)
                        tail = f.read(size - off - ln)
                    tg = T.read(s_abs, ext)
                    data = head + (synth_audio(sig, tg.get("duration")) if ln >= 4096 else b"\x00" * ln) + tail
                    with open(d_abs, "wb") as out:
                        out.write(data)
                    stats["real_mp3"] += 1
                elif kind in ("audio", "video") and size <= 120 * 1024 * 1024:
                    shutil.copyfile(s_abs, d_abs)
                    stats["real_copy"] += 1
                elif kind in ("junk", "appledouble"):
                    shutil.copyfile(s_abs, d_abs)
                    stats["junk"] += 1
                elif kind == "other" and size <= 2 * 1024 * 1024:
                    shutil.copyfile(s_abs, d_abs)
                    stats["other"] += 1
                else:
                    stats["skipped"] += 1
                    continue
                os.utime(d_abs, (os.path.getatime(s_abs), os.path.getmtime(s_abs)))
                present_keys.add(names.loose_key(rel))
            except OSError as e:
                print("hata:", rel, e)
                stats["skipped"] += 1
    # Serato kopyası
    ssrc = os.path.join(src, "_Serato_")
    sdst = os.path.join(dst, "_Serato_")
    os.makedirs(os.path.join(sdst, "Subcrates"), exist_ok=True)
    for n in ("database V2", "neworder.pref", "collapsed.pref"):
        if os.path.isfile(os.path.join(ssrc, n)):
            shutil.copyfile(os.path.join(ssrc, n), os.path.join(sdst, n))
    for n in os.listdir(os.path.join(ssrc, "Subcrates")):
        if n.endswith(".crate") and not n.startswith("._"):
            shutil.copyfile(os.path.join(ssrc, "Subcrates", n), os.path.join(sdst, "Subcrates", n))
    # Serato'da olup kopyada olmayan yollar: SSD'nin geri kalanı
    db = serato.read_database(sdst) or {"tracks": []}
    for t in db["tracks"]:
        raw = t.get("pfil") or ""
        if not raw:
            continue
        rel = names.to_disk_form(raw, True)
        if names.loose_key(rel) in present_keys:
            continue
        ext = os.path.splitext(rel)[1].lower()
        if names.classify(rel.split("/")[-1]) != "audio":
            continue
        d_abs = os.path.join(dst, *rel.split("/"))
        os.makedirs(os.path.dirname(d_abs), exist_ok=True)
        head = id3_bytes(t.get("tsng"), t.get("tart"), t.get("talb"), t.get("tgen"), t.get("tcom"))
        with open(d_abs, "wb") as out:
            out.write(head + synth_audio("serato:" + names.match_key(rel), parse_len(t.get("tlen"))))
        present_keys.add(names.loose_key(rel))
        stats["serato_only"] += 1
        del ext
    # Engine
    edst = os.path.join(dst, "Engine Library", "Database2")
    os.makedirs(edst, exist_ok=True)
    shutil.copyfile(os.path.join(src, "Engine Library", "Database2", "m.db"), os.path.join(edst, "m.db"))
    stats["seconds"] = round(time.time() - t0, 1)
    print(stats)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
