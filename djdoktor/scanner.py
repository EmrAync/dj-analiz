"""Kütüphane taraması: klasörleri gezer, etiketleri ve ses imzalarını okur.

Tarama tamamen SALT-OKUNURDUR: müzik dosyalarına hiçbir şey yazılmaz.
Değişmeyen dosyalar (aynı boyut + aynı değiştirilme zamanı) yeniden okunmaz.
"""
from __future__ import annotations

import json
import os
import time
from concurrent.futures import ThreadPoolExecutor

from . import audiosig, keys, names, tags, util
from .config import BUILTIN_EXCLUDES, ENGINE_LIB_DIR


class RootInfo:
    def __init__(self, root: str):
        self.root = os.path.abspath(root)
        self.fstype = util.fs_type(self.root)
        self.mac_exfat = util.IS_MAC and util.is_fat_like(self.fstype)

    def canonical(self, os_rel: str) -> str:
        return names.to_disk_form(os_rel, self.mac_exfat)

    def os_path(self, rel: str, os_rel: str = None) -> str:
        """Kanonik yoldan bu işletim sisteminde açılabilir mutlak yol."""
        if os_rel:
            p = names.join_os(self.root, os_rel)
            if os.path.exists(names.long_path(p)):
                return names.long_path(p)
        cand = rel
        if self.mac_exfat:
            cand = "/".join(names.sfm_to_ascii(x) for x in names.split_rel(rel))
        return names.long_path(names.join_os(self.root, cand))

    def os_rel_of(self, rel: str) -> str:
        """Kanonik (disk biçimi) yoldan bu işletim sisteminin göreceği göreli yol."""
        if self.mac_exfat:
            return "/".join(names.sfm_to_ascii(p) for p in names.split_rel(rel))
        return "/".join(names.split_rel(rel))

    def to_dict(self):
        return {"root": self.root, "fstype": self.fstype, "mac_exfat": self.mac_exfat}


def walk(root_info: RootInfo, extra_excludes=(), cancel=None, tick=None):
    """(os_rel, kind, stat) üretir. tick(klasör_sayısı) her klasörde çağrılır (ilerleme için)."""
    root = root_info.root
    excl = {names.fold(x) for x in BUILTIN_EXCLUDES} | {names.fold(x) for x in extra_excludes if x}
    stack = [("", 0)]
    ndirs = 0
    while stack:
        rel_dir, depth = stack.pop()
        if cancel and cancel():
            return
        ndirs += 1
        if tick:
            tick(ndirs)
        abs_dir = names.long_path(names.join_os(root, rel_dir)) if rel_dir else root
        try:
            it = list(os.scandir(abs_dir))
        except OSError:
            continue
        for e in sorted(it, key=lambda x: x.name):
            name = e.name
            rel = (rel_dir + "/" + name) if rel_dir else name
            try:
                is_dir = e.is_dir(follow_symlinks=False)
            except OSError:
                continue
            if is_dir:
                fn = names.fold(name)
                if fn in excl:
                    continue
                if fn == ENGINE_LIB_DIR and depth == 0:
                    # Engine Library içinde yalnızca Music (Engine'in kopyaladığı dosyalar)
                    music = os.path.join(e.path, "Music")
                    if os.path.isdir(music):
                        stack.append((rel + "/Music", depth + 2))
                    continue
                if depth > 40:
                    continue
                stack.append((rel, depth + 1))
                continue
            kind = names.classify(name)
            if kind == "other":
                continue
            try:
                st = e.stat(follow_symlinks=False)
            except OSError:
                continue
            yield rel, kind, st


def _origin(rel: str) -> str:
    low = names.fold(rel)
    if low.startswith("engine library/music/"):
        return "engine_copy"
    return "library"


def build_record(root_info: RootInfo, os_rel: str, kind: str, st, now_ts: int):
    rel = root_info.canonical(os_rel)
    folder, name = (rel.rsplit("/", 1) if "/" in rel else ("", rel))
    ext = os.path.splitext(name)[1].lower()
    rec = {
        "rel": rel, "mkey": names.match_key(rel), "lkey": names.loose_key(rel), "os_rel": os_rel,
        "folder": folder, "name": name, "ext": ext, "kind": kind, "origin": _origin(rel),
        "size": st.st_size, "mtime": int(getattr(st, "st_mtime_ns", st.st_mtime * 1e9) // 1_000_000),
        "present": 1, "first_seen": now_ts, "last_seen": now_ts,
    }
    if kind != "audio":
        rec["search"] = names.fold(rel)
        return rec
    abs_path = names.long_path(names.join_os(root_info.root, os_rel))
    t = tags.read(abs_path, ext)
    sig = {}
    if st.st_size > 0:
        try:
            sig = audiosig.analyze(abs_path, ext)
        except OSError as e:
            t["error"] = t["error"] or ("okuma hatası: %s" % e)
    note, mk, me = tags.split_comment(t["comment"])
    markers = t.get("markers") or {}
    camelot = keys.to_camelot(t["key_raw"]) or mk
    stem = os.path.splitext(name)[0]
    rec.update({
        "title": t["title"], "artist": t["artist"], "album": t["album"], "genre": t["genre"],
        "comment": t["comment"], "note": note, "mik_key": mk, "mik_energy": me,
        "grouping": t["grouping"], "bpm": t["bpm"], "key_raw": t["key_raw"], "camelot": camelot,
        "year": t["year"], "label": t["label"], "composer": t["composer"], "remixer": t["remixer"],
        "rating": t["rating"], "track_no": t["track_no"], "has_art": t["has_art"],
        "duration": t["duration"], "bitrate": t["bitrate"], "sample_rate": t["sample_rate"],
        "channels": t["channels"], "bits": t["bits"], "codec": t["codec"],
        "cues": len(markers.get("cues") or []), "loops": len(markers.get("loops") or []),
        "cues_json": json.dumps(markers, ensure_ascii=False) if markers else None,
        "serato_color": markers.get("color"), "serato_analyzed": t["serato_analyzed"],
        "serato_beatgrid": t["serato_beatgrid"], "tag_error": t["error"] or None,
        "aoff": sig.get("off"), "alen": sig.get("len"), "qsig": sig.get("qsig"),
        "tagsig": sig.get("tagsig"), "fsig": None,
        "songkey": names.song_key(t["artist"], t["title"], stem),
    })
    rec["search"] = names.fold(" ".join(str(x) for x in (
        t["title"], t["artist"], t["album"], t["genre"], t["comment"], t["grouping"], t["label"],
        t["composer"], camelot, rel) if x))
    return rec


class _NoLock:
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def _mtime_ms(st):
    return int(getattr(st, "st_mtime_ns", st.st_mtime * 1e9) // 1_000_000)


HEAD_BYTES = 256 * 1024
TAIL_BYTES = 128 * 1024


def _readahead(root_info, item):
    """Dosyanın başını (etiketler) ve sonunu (ID3v1/APE/MP4 bilgisi) tek okumayla önbelleğe alır."""
    os_rel, kind, st = item
    if kind != "audio":
        return
    try:
        with open(names.long_path(names.join_os(root_info.root, os_rel)), "rb", buffering=0) as f:
            f.read(HEAD_BYTES)
            if st.st_size > HEAD_BYTES + TAIL_BYTES:
                f.seek(st.st_size - TAIL_BYTES)
                f.read(TAIL_BYTES)
    except OSError:
        pass


def _split(root_info, entries, index):
    """Gezilen dosyaları ayırır: değişmeyenler (katalogla aynı boyut/zaman) ve okunacaklar."""
    unchanged, todo = [], []
    for os_rel, kind, st in entries:
        old = index.get(root_info.canonical(os_rel))
        if old and old[1] == st.st_size and old[2] == _mtime_ms(st):
            unchanged.append((old, os_rel))
        else:
            todo.append((os_rel, kind, st))
    return unchanged, todo


def scan(catalog, root_info: RootInfo, prefs=None, progress=None, cancel=None, log=None, lock=None):
    """Kütüphaneyi tarar. progress(oran, mesaj) ile ilerleme bildirir.

    lock (kütüphane kilidi) verilirse tarama programı bekletmez: klasörleri gezmek ve etiketleri okumak
    kilitsiz yapılır, kataloğa yalnızca kısa süre kilitlenerek yazılır. Tarama sürerken kullanıcı bir dosya
    taşıdıysa (katalog değiştiyse) son adımda klasörler kilit altında yeniden gezilir; okunmuş etiketler
    yeniden kullanılır (yalnızca değişen birkaç dosya yeniden okunur)."""
    prefs = prefs or {}
    lock = lock or _NoLock()
    excludes = prefs.get("extra_excludes") or ()
    t0 = time.time()
    now_ts = util.now()
    if progress:
        progress(0.0, "Klasörler listeleniyor…")
    gen = {"v": catalog.gen, "stale": False}
    entries = []

    def tick(nd):
        if progress and nd % 100 == 0:
            progress(0.0, "Klasörler listeleniyor… %d klasör, %d dosya" % (nd, len(entries)))
    for e in walk(root_info, excludes, cancel, tick):
        entries.append(e)
    if cancel and cancel():
        return {"cancelled": True}
    index = catalog.file_index()
    unchanged, todo = _split(root_info, entries, index)
    total = len(todo)
    done = 0
    errors = 0
    pending = []          # okunmuş, henüz kataloğa yazılmamış kayıtlar
    read_cache = {}       # (os_rel, boyut, zaman) -> kayıt (yeniden gezmede tekrar okumamak için)
    if progress:
        progress(0.02, "%d dosya bulundu, %d tanesi okunacak" % (len(entries), total))

    def work(item):
        os_rel, kind, st = item
        try:
            return build_record(root_info, os_rel, kind, st, now_ts)
        except Exception as e:  # tek dosya hatası taramayı durdurmaz
            rel = root_info.canonical(os_rel)
            return {"rel": rel, "mkey": names.match_key(rel), "lkey": names.loose_key(rel),
                    "os_rel": os_rel, "name": rel.rsplit("/", 1)[-1],
                    "folder": rel.rsplit("/", 1)[0] if "/" in rel else "", "ext": os.path.splitext(rel)[1].lower(),
                    "kind": kind, "origin": _origin(rel), "size": st.st_size, "mtime": 0, "present": 1,
                    "first_seen": now_ts, "last_seen": now_ts, "tag_error": "tarama hatası: %s" % e}

    def flush():
        """Okunanları kısa bir kilitle yazar. Bu arada katalog değiştiyse yazmaz (son adımda bakılır)."""
        if not pending or gen["stale"]:
            return
        with lock:
            if catalog.gen != gen["v"]:
                gen["stale"] = True
                return
            catalog.upsert_files(pending)
            gen["v"] = catalog.gen
        del pending[:]

    # Etiketler TEK iş parçacığında çözülür: Python'da 4 iş parçacığı birbirini bekletip taramayı ~3 kat
    # yavaşlatıyordu (GIL). Bunun yerine birkaç hafif "önden okuyucu" sıradaki dosyaların başını/sonunu
    # tek seferde okuyup işletim sisteminin önbelleğine alır; çözücü diski beklemez (USB'de önemli).
    ahead = ThreadPoolExecutor(max_workers=2) if total > 20 else None
    window = 48
    try:
        for i, item in enumerate(todo):
            if ahead is not None:
                if i == 0:
                    for it in todo[:window]:
                        ahead.submit(_readahead, root_info, it)
                elif i + window < total:
                    ahead.submit(_readahead, root_info, todo[i + window])
            rec = work(item)
            done += 1
            if rec.get("tag_error"):
                errors += 1
            read_cache[(item[0], item[2].st_size, _mtime_ms(item[2]))] = rec
            pending.append(rec)
            if len(pending) >= 200:
                flush()
            if progress and (done % 10 == 0 or done == total):
                el = time.time() - t0
                eta = (el / done) * (total - done) if done else 0
                progress(0.02 + 0.93 * done / max(1, total),
                         "%d / %d dosya okundu (kalan ~%s)" % (done, total, util.fmt_dur(eta) or "0:00"))
            if cancel and cancel():
                break
    finally:
        if ahead is not None:
            try:
                ahead.shutdown(wait=True, cancel_futures=True)
            except TypeError:                      # Python 3.8: cancel_futures yok
                ahead.shutdown(wait=True)
    if cancel and cancel():
        flush()
        return {"cancelled": True, "read": done}
    if progress:
        progress(0.96, "Katalog güncelleniyor…")
    rewalked = False
    with lock:
        if catalog.gen != gen["v"]:
            # tarama sürerken dosyalar taşındı: kilit altında yeniden gez (yalnızca klasör listesi)
            rewalked = True
            entries = list(walk(root_info, excludes))
            index = catalog.file_index()
            unchanged, todo = _split(root_info, entries, index)
            recs = []
            for item in todo:
                rec = read_cache.get((item[0], item[2].st_size, _mtime_ms(item[2])))
                recs.append(rec if rec is not None else work(item))
            catalog.upsert_files(recs)
        else:
            catalog.upsert_files(pending)
        # yalnızca gerçekten değişenler yazılır (her taramada binlerce satır yazılmasın)
        touch = [(old[0], os_rel) for old, os_rel in unchanged if not old[3] or old[4] != os_rel]
        catalog.touch_files([t[0] for t in touch], now_ts, [t[1] for t in touch])
        idx2 = catalog.file_index()
        seen = []
        for os_rel, kind, st in entries:
            r = idx2.get(root_info.canonical(os_rel))
            if r:
                seen.append(r[0])
        gone = catalog.mark_absent_except(seen)
        catalog.set_meta("last_scan", now_ts)
        catalog.set_meta("fstype", root_info.fstype)
    return {"files": len(entries), "read": done, "unchanged": len(unchanged), "errors": errors,
            "gone": len(gone), "seconds": round(time.time() - t0, 1), "rewalked": rewalked}
