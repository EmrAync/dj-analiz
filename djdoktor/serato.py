"""Serato DJ: 'database V2' ve crate (.crate) dosyalarını okuma/yazma.

Biçim: [4 baytlık etiket][4 bayt uzunluk (big-endian)][veri] dizisi.
Metinler UTF-16 big-endian. Yollar, _Serato_ klasörünün bulunduğu diskin
köküne göre GÖRELİDİR (ör. 'melis music/HALAYLAR/parca.mp3').

Okuma/yazma birebir aynı baytları üretecek şekilde yazılmıştır (gerçek
kütüphanede 160 crate ve database V2 üzerinde doğrulandı).
"""
from __future__ import annotations

import hashlib
import os
import struct
import zipfile

from . import names, util

VRSN_CRATE = "1.0/Serato ScratchLive Crate"
DEFAULT_COLUMNS = [("song", "300"), ("artist", "180"), ("bpm", "50"), ("key", "50"),
                   ("length", "60"), ("comment", "220"), ("bitrate", "70"), ("location", "0")]
SERATO_PROCS = ["Serato DJ Pro", "Serato DJ Lite", "Serato DJ.exe", "Serato DJ Pro.exe", "Serato DJ Lite.exe", "Serato DJ"]


# ---------------------------------------------------------------------------
# TLV
# ---------------------------------------------------------------------------
def parse(data: bytes):
    out, i, n = [], 0, len(data)
    while i + 8 <= n:
        tag = data[i:i + 4]
        ln = struct.unpack(">I", data[i + 4:i + 8])[0]
        out.append((tag, data[i + 8:i + 8 + ln]))
        i += 8 + ln
    return out, data[i:]


def serialize(items, tail=b"") -> bytes:
    return b"".join(t + struct.pack(">I", len(b)) + b for t, b in items) + tail


def u16(s: str) -> bytes:
    return s.encode("utf-16-be")


def s16(b: bytes) -> str:
    return b.decode("utf-16-be", "replace")


# ---------------------------------------------------------------------------
def serato_dir(root: str):
    try:
        for n in os.listdir(root):
            if n.lower() == "_serato_" and os.path.isdir(os.path.join(root, n)):
                return os.path.join(root, n)
    except OSError:
        pass
    return None


def _subcrates_dir(sdir):
    for n in ("Subcrates", "subcrates"):
        p = os.path.join(sdir, n)
        if os.path.isdir(p):
            return p
    return os.path.join(sdir, "Subcrates")


def read_database(sdir: str):
    p = os.path.join(sdir, "database V2")
    if not os.path.exists(p):
        return None
    data = open(p, "rb").read()
    items, _tail = parse(data)
    tracks = []
    version = ""
    for tag, body in items:
        if tag == b"vrsn":
            version = s16(body)
        elif tag == b"otrk":
            sub, _ = parse(body)
            t = {}
            for t2, b2 in sub:
                k = t2.decode("latin-1")
                if k.startswith("t") or k == "pfil":
                    t[k] = s16(b2)
                elif k.startswith("b") and len(b2) == 1:
                    t[k] = b2[0]
                elif k.startswith("u") and len(b2) == 4:
                    t[k] = struct.unpack(">I", b2)[0]
            tracks.append(t)
    return {"version": version, "tracks": tracks}


def crate_name_to_parts(stem: str):
    return [p for p in stem.split("%%")]


def read_crate_file(path: str):
    data = open(path, "rb").read()
    items, _ = parse(data)
    tracks, cols = [], []
    for tag, body in items:
        if tag == b"otrk":
            sub, _ = parse(body)
            for t2, b2 in sub:
                if t2 == b"ptrk":
                    tracks.append(s16(b2))
        elif tag == b"ovct":
            sub, _ = parse(body)
            name = width = ""
            for t2, b2 in sub:
                if t2 == b"tvcn":
                    name = s16(b2)
                elif t2 == b"tvcw":
                    width = s16(b2)
            cols.append((name, width))
    return tracks, cols


def read_crates(sdir: str):
    d = _subcrates_dir(sdir)
    out = []
    if not os.path.isdir(d):
        return out
    for n in sorted(os.listdir(d)):
        if not n.lower().endswith(".crate") or n.startswith("._"):
            continue
        p = os.path.join(d, n)
        try:
            tracks, cols = read_crate_file(p)
        except OSError:
            continue
        stem = n[:-6]
        out.append({"name": stem, "parts": crate_name_to_parts(stem), "file": p, "tracks": tracks})
    return out


def build_crate(paths, columns=None) -> bytes:
    items = [(b"vrsn", u16(VRSN_CRATE)),
             (b"osrt", serialize([(b"tvcn", u16("song")), (b"brev", b"\x00")]))]
    for name, width in (columns or DEFAULT_COLUMNS):
        items.append((b"ovct", serialize([(b"tvcn", u16(name)), (b"tvcw", u16(width))])))
    for p in paths:
        items.append((b"otrk", serialize([(b"ptrk", u16(p))])))
    return serialize(items)


def safe_crate_part(title: str) -> str:
    t = names.minimal_fix_component(title.replace("%%", "%"), False)
    return t.replace("%%", "%")


# ---------------------------------------------------------------------------
# Yol lehçesi: Serato Mac'te ayrık (NFD) + ':' ; Windows'ta disk biçimi
# ---------------------------------------------------------------------------
def detect_dialect(db_tracks) -> str:
    mac = win = 0
    for t in db_tracks or []:
        p = t.get("pfil") or ""
        if names.nfc(p) != p:
            mac += 1
        elif any(ord(c) > 127 for c in p) and names.nfd(p) != p:
            win += 1
        if names.has_sfm(p):
            win += 1
        elif any(c in p for c in ':?*"|<>'):
            mac += 1
    return "mac" if mac >= win else "windows"


def path_for(rel: str, dialect: str, db_by_mkey=None) -> str:
    """Bir dosya için Serato'ya yazılacak yol. Serato veritabanında zaten
    kayıtlıysa onun kullandığı yazım aynen kullanılır (Serato aynı parçayı
    iki kez tanımasın diye)."""
    if db_by_mkey:
        ex = db_by_mkey.get(names.match_key(rel))
        if ex:
            return ex
    if dialect == "mac":
        return names.to_mac_form(rel)
    return rel


# ---------------------------------------------------------------------------
# Yedek
# ---------------------------------------------------------------------------
def backup(sdir: str, dest_dir: str, label: str = "") -> str:
    """database V2, tüm crate'ler ve tercih dosyalarını zip olarak yedekler."""
    os.makedirs(dest_dir, exist_ok=True)
    zp = util.unique_path(os.path.join(dest_dir, "serato_%s%s.zip" % (util.stamp(), ("_" + label) if label else "")))
    with zipfile.ZipFile(zp, "w", zipfile.ZIP_DEFLATED) as z:
        for n in ("database V2", "neworder.pref", "collapsed.pref"):
            p = os.path.join(sdir, n)
            if os.path.exists(p):
                z.write(p, n)
        sc = _subcrates_dir(sdir)
        if os.path.isdir(sc):
            for root, _dirs, files in os.walk(sc):
                for f in files:
                    if f.startswith("._"):
                        continue
                    full = os.path.join(root, f)
                    z.write(full, os.path.relpath(full, sdir))
    return zp


def restore_backup(sdir: str, zip_path: str, only=None):
    """Yedeği geri yükler. only: yalnızca bu adlardaki dosyalar (ör. {'Subcrates/x.crate'})."""
    done = []
    with zipfile.ZipFile(zip_path) as z:
        for info in z.infolist():
            if only is not None and info.filename not in only:
                continue
            target = os.path.join(sdir, *info.filename.split("/"))
            os.makedirs(os.path.dirname(target), exist_ok=True)
            util.atomic_write_bytes(target, z.read(info))
            done.append(info.filename)
    return done


def file_hash(path: str) -> str:
    h = hashlib.blake2b(digest_size=16)
    with open(path, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def backup_members(zip_path: str):
    with zipfile.ZipFile(zip_path) as z:
        return [i.filename for i in z.infolist()]


def state_fp(sdir: str, members) -> dict:
    """Verilen dosyaların (yedekteki adlarıyla) şu anki özetleri; dosya yoksa None.
    Geri almadan önce "Serato bu dosyaları sonradan değiştirdi mi?" kontrolü için."""
    out = {}
    for m in members:
        p = os.path.join(sdir, *m.split("/"))
        out[m] = file_hash(p) if os.path.isfile(p) else None
    return out


# ---------------------------------------------------------------------------
# Yazma işlemleri
# ---------------------------------------------------------------------------
def write_crate(sdir: str, parts, paths):
    """parts: ['DJ Doktor', 'Etkinlik', 'Halay'] -> 'DJ Doktor%%Etkinlik%%Halay.crate'"""
    d = _subcrates_dir(sdir)
    os.makedirs(d, exist_ok=True)
    stem = "%%".join(safe_crate_part(p) for p in parts)
    path = os.path.join(d, stem + ".crate")
    util.atomic_write_bytes(path, build_crate(paths))
    return path


def remove_crate_file(path: str, quarantine_dir: str):
    """Crate'i silmez: karantina klasörüne taşır (tercihen aynı diskte)."""
    return util.move_file(path, os.path.join(quarantine_dir, os.path.basename(path)))


def rewrite_paths(sdir: str, mapping: dict, drop_db_paths=frozenset(), dedupe: bool = True):
    """Tüm crate'lerde ve database V2'de yolları değiştirir.

    mapping: {eski_ham_yol: yeni_ham_yol}
    drop_db_paths: database V2'den çıkarılacak yollar (karantinaya alınan çiftler)
    dedupe: True (çift birleştirme) -> aynı yere düşen kayıtlar teke indirilir.
            False (taşıma / geri alma) -> hiçbir kayıt silinmez; işlem birebir geri alınabilir.
    Dönüş: istatistik sözlüğü.
    """
    stats = {"crates_changed": 0, "crate_entries": 0, "db_changed": 0, "db_removed": 0}
    sc = _subcrates_dir(sdir)
    if os.path.isdir(sc):
        for root, _d, files in os.walk(sc):
            for f in files:
                if not f.lower().endswith(".crate") or f.startswith("._"):
                    continue
                p = os.path.join(root, f)
                data = open(p, "rb").read()
                items, tail = parse(data)
                changed = False
                seen = set()
                mapped_finals = set()
                new_items = []
                for tag, body in items:
                    if tag == b"otrk":
                        sub, stail = parse(body)
                        new_sub = []
                        keep = True
                        for t2, b2 in sub:
                            if t2 == b"ptrk":
                                old = s16(b2)
                                new = mapping.get(old, old)
                                was_mapped = new != old
                                if was_mapped:
                                    changed = True
                                    stats["crate_entries"] += 1
                                    b2 = u16(new)
                                if dedupe and new in seen and (was_mapped or new in mapped_finals):
                                    keep = False  # birleştirme sonrası aynı crate'te iki kez olmasın
                                    changed = True
                                seen.add(new)
                                if was_mapped:
                                    mapped_finals.add(new)
                            new_sub.append((t2, b2))
                        if keep:
                            new_items.append((tag, serialize(new_sub, stail)))
                    else:
                        new_items.append((tag, body))
                if changed:
                    util.atomic_write_bytes(p, serialize(new_items, tail))
                    stats["crates_changed"] += 1
    dbp = os.path.join(sdir, "database V2")
    if os.path.exists(dbp):
        data = open(dbp, "rb").read()
        items, tail = parse(data)
        existing = set()
        for tag, body in items:
            if tag == b"otrk":
                for t2, b2 in parse(body)[0]:
                    if t2 == b"pfil":
                        existing.add(s16(b2))
        new_items = []
        changed = False
        for tag, body in items:
            if tag != b"otrk":
                new_items.append((tag, body))
                continue
            sub, stail = parse(body)
            pf = None
            for t2, b2 in sub:
                if t2 == b"pfil":
                    pf = s16(b2)
            if pf is not None and pf in drop_db_paths:
                stats["db_removed"] += 1
                changed = True
                continue
            if pf is not None and pf in mapping and mapping[pf] != pf:
                new = mapping[pf]
                if dedupe and new in existing:
                    # hedef zaten kayıtlı: eski kaydı çıkar (birleştirme)
                    stats["db_removed"] += 1
                    changed = True
                    continue
                sub = [(t2, u16(new) if t2 == b"pfil" else b2) for t2, b2 in sub]
                existing.add(new)
                stats["db_changed"] += 1
                changed = True
            new_items.append((tag, serialize(sub, stail)))
        if changed:
            util.atomic_write_bytes(dbp, serialize(new_items, tail))
    return stats


def analyze(root: str, resolver):
    """Serato kütüphanesini okur ve diskteki dosyalarla eşleştirir."""
    sdir = serato_dir(root)
    if not sdir:
        return None
    db = read_database(sdir) or {"version": "", "tracks": []}
    crates = read_crates(sdir)
    tracks, lists, items = [], [], []
    for i, t in enumerate(db["tracks"]):
        p = t.get("pfil") or ""
        f, m = resolver.resolve(p)
        tracks.append({"ext_id": i, "raw_path": p, "file_id": f["id"] if f else None, "match": m,
                       "info": {"title": t.get("tsng", ""), "artist": t.get("tart", ""),
                                "comment": t.get("tcom", ""), "key": t.get("tkey", ""),
                                "bpm": t.get("tbpm", ""), "missing_flag": t.get("bmis", 0)}})
    for ci, c in enumerate(crates):
        parent = "%%".join(c["parts"][:-1]) if len(c["parts"]) > 1 else None
        lists.append({"list_key": c["name"], "title": c["parts"][-1], "parent_key": parent,
                      "path": " / ".join(c["parts"]), "pos": ci, "count": len(c["tracks"]),
                      "info": {"file": os.path.basename(c["file"])}})
        for pi, p in enumerate(c["tracks"]):
            f, m = resolver.resolve(p)
            items.append({"list_key": c["name"], "pos": pi, "raw_path": p, "file_id": f["id"] if f else None,
                          "match": m})
    return {"dir": sdir, "version": db["version"], "dialect": detect_dialect(db["tracks"]),
            "tracks": tracks, "lists": lists, "items": items}
