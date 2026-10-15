"""Ses imzası: dosyadaki SADECE ses verisinin parmak izi.

Etiketler (ID3, yorum, Mixed In Key notu, Serato cue'ları, kapak resmi)
değişse bile ses verisi aynı kalır. Böylece "aynı şarkının yorumlu ve yorumsuz
kopyası" gibi çiftler bulunur. Dosyalar sadece OKUNUR.
"""
from __future__ import annotations

import hashlib
import os
import struct

CHUNK = 65536


def _syncsafe(b: bytes) -> int:
    return (b[0] & 0x7F) << 21 | (b[1] & 0x7F) << 14 | (b[2] & 0x7F) << 7 | (b[3] & 0x7F)


def _skip_id3v2(f, off: int, size: int) -> int:
    for _ in range(4):  # birden fazla ardışık ID3v2 etiketi olabilir
        if off + 10 > size:
            break
        f.seek(off)
        hdr = f.read(10)
        if len(hdr) < 10 or hdr[:3] != b"ID3":
            break
        sz = _syncsafe(hdr[6:10])
        off += 10 + sz + (10 if hdr[5] & 0x10 else 0)
    return min(off, size)


def _trim_footers(f, off: int, end: int) -> int:
    for _ in range(6):
        changed = False
        if end - off >= 128:
            f.seek(end - 128)
            if f.read(3) == b"TAG":
                end -= 128
                changed = True
        if end - off >= 32:
            f.seek(end - 32)
            ft = f.read(32)
            if ft[:8] == b"APETAGEX":
                tag_size = struct.unpack("<I", ft[12:16])[0]
                flags = struct.unpack("<I", ft[20:24])[0]
                total = tag_size + (32 if flags & 0x80000000 else 0)
                if 0 < total <= end - off:
                    end -= total
                    changed = True
        if end - off >= 15:
            f.seek(end - 9)
            if f.read(9) == b"LYRICS200":
                f.seek(end - 15)
                try:
                    sz = int(f.read(6))
                    if 0 < sz + 15 <= end - off:
                        end -= sz + 15
                        changed = True
                except ValueError:
                    pass
        if end - off >= 10:
            f.seek(end - 10)
            ft = f.read(10)
            if ft[:3] == b"3DI":
                sz = _syncsafe(ft[6:10]) + 20
                if 0 < sz <= end - off:
                    end -= sz
                    changed = True
        if not changed:
            break
    return end


def _mp3_region(f, size):
    off = _skip_id3v2(f, 0, size)
    end = _trim_footers(f, off, size)
    return off, max(0, end - off)


def _flac_region(f, size):
    off = _skip_id3v2(f, 0, size)
    f.seek(off)
    if f.read(4) != b"fLaC":
        return 0, size
    off += 4
    for _ in range(1000):
        f.seek(off)
        h = f.read(4)
        if len(h) < 4:
            return 0, size
        last = h[0] & 0x80
        ln = int.from_bytes(h[1:4], "big")
        off += 4 + ln
        if last:
            break
    end = _trim_footers(f, off, size)
    return off, max(0, end - off)


def _mp4_region(f, size):
    pos, best = 0, None
    for _ in range(10000):
        if pos + 8 > size:
            break
        f.seek(pos)
        h = f.read(8)
        if len(h) < 8:
            break
        sz, typ = struct.unpack(">I4s", h)
        hdr = 8
        if sz == 1:
            ext = f.read(8)
            if len(ext) < 8:
                break
            sz = struct.unpack(">Q", ext)[0]
            hdr = 16
        elif sz == 0:
            sz = size - pos
        if sz < hdr:
            break
        if typ == b"mdat":
            cand = (pos + hdr, min(sz, size - pos) - hdr)
            if best is None or cand[1] > best[1]:
                best = cand
        pos += sz
    return best if best else (0, size)


def _riff_region(f, size):
    f.seek(0)
    h = f.read(12)
    if len(h) < 12 or h[:4] not in (b"RIFF", b"RF64") or h[8:12] != b"WAVE":
        return 0, size
    pos = 12
    for _ in range(10000):
        if pos + 8 > size:
            break
        f.seek(pos)
        ck = f.read(8)
        cid, csz = ck[:4], struct.unpack("<I", ck[4:8])[0]
        if cid == b"data":
            if csz == 0 or csz == 0xFFFFFFFF or pos + 8 + csz > size:
                csz = size - pos - 8
            return pos + 8, csz
        pos += 8 + csz + (csz & 1)
    return 0, size


def _aiff_region(f, size):
    f.seek(0)
    h = f.read(12)
    if len(h) < 12 or h[:4] != b"FORM" or h[8:12] not in (b"AIFF", b"AIFC"):
        return 0, size
    pos = 12
    for _ in range(10000):
        if pos + 8 > size:
            break
        f.seek(pos)
        ck = f.read(16)
        cid, csz = ck[:4], struct.unpack(">I", ck[4:8])[0]
        if cid == b"SSND" and len(ck) >= 16:
            data_off = struct.unpack(">I", ck[8:12])[0]
            start = pos + 16 + data_off
            ln = csz - 8 - data_off
            if ln <= 0 or start + ln > size:
                ln = size - start
            return start, max(0, ln)
        pos += 8 + csz + (csz & 1)
    return 0, size


def audio_region(f, ext: str, size: int):
    ext = ext.lower()
    try:
        if ext == ".mp3":
            return _mp3_region(f, size)
        if ext == ".flac":
            return _flac_region(f, size)
        if ext in (".m4a", ".mp4", ".alac", ".m4p", ".aac") and ext != ".aac":
            return _mp4_region(f, size)
        if ext == ".aac":  # ham ADTS: başta ID3 olabilir
            return _mp3_region(f, size)
        if ext == ".wav":
            return _riff_region(f, size)
        if ext in (".aif", ".aiff"):
            return _aiff_region(f, size)
    except (OSError, struct.error, ValueError):
        pass
    return 0, size


def quick_sig_of(f, off: int, length: int) -> str:
    h = hashlib.blake2b(digest_size=16)
    h.update(length.to_bytes(8, "little"))
    if length <= CHUNK * 6:
        f.seek(off)
        h.update(f.read(length))
    else:
        for frac in (0.0, 0.25, 0.5, 0.75):
            f.seek(off + int((length - CHUNK) * frac))
            h.update(f.read(CHUNK))
        f.seek(off + length - CHUNK)
        h.update(f.read(CHUNK))
    return h.hexdigest()


def tag_sig_of(f, off: int, length: int, size: int) -> str:
    """Ses dışındaki baytların (etiketlerin) özeti: etiketler aynı mı?"""
    h = hashlib.blake2b(digest_size=12)
    f.seek(0)
    remaining = off
    while remaining > 0:
        b = f.read(min(remaining, 1 << 20))
        if not b:
            break
        h.update(b)
        remaining -= len(b)
    tail = off + length
    if tail < size:
        f.seek(tail)
        h.update(f.read(size - tail))
    return h.hexdigest()


def analyze(path: str, ext: str):
    """{'off','len','qsig','tagsig'} döndürür. Dosya yalnızca okunur."""
    size = os.path.getsize(path)
    with open(path, "rb") as f:
        off, ln = audio_region(f, ext, size)
        if ln <= 0:
            off, ln = 0, size
        q = quick_sig_of(f, off, ln)
        t = tag_sig_of(f, off, ln, size)
    return {"off": off, "len": ln, "qsig": q, "tagsig": t}


def full_sig(path: str, off: int, length: int, progress=None) -> str:
    h = hashlib.blake2b(digest_size=20)
    with open(path, "rb") as f:
        f.seek(off)
        remaining = length
        while remaining > 0:
            b = f.read(min(remaining, 1 << 20))
            if not b:
                break
            h.update(b)
            remaining -= len(b)
            if progress:
                progress(len(b))
    return h.hexdigest()


def file_hash(path: str) -> str:
    h = hashlib.blake2b(digest_size=20)
    with open(path, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()
