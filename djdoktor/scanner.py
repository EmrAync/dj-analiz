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

    def to_dict(self):
        return {"root": self.root, "fstype": self.fstype, "mac_exfat": self.mac_exfat}


def walk(root_info: RootInfo, extra_excludes=(), cancel=None):
    """(os_rel, kind, stat) üretir."""
    root = root_info.root
    excl = {names.fold(x) for x in BUILTIN_EXCLUDES} | {names.fold(x) for x in extra_excludes if x}
    stack = [("", 0)]
    while stack:
        rel_dir, depth = stack.pop()
        if cancel and cancel():
            return
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


def scan(catalog, root_info: RootInfo, prefs=None, progress=None, cancel=None, log=None):
    """Kütüphaneyi tarar. progress(oran, mesaj) ile ilerleme bildirir."""
    prefs = prefs or {}
    t0 = time.time()
    now_ts = util.now()
    if progress:
        progress(0.0, "Klasörler listeleniyor…")
    entries = list(walk(root_info, prefs.get("extra_excludes") or (), cancel))
    if cancel and cancel():
        return {"cancelled": True}
    index = catalog.file_index()
    unchanged_ids, unchanged_osrel, todo = [], [], []
    for os_rel, kind, st in entries:
        rel = root_info.canonical(os_rel)
        mt = int(getattr(st, "st_mtime_ns", st.st_mtime * 1e9) // 1_000_000)
        old = index.get(rel)
        if old and old[1] == st.st_size and old[2] == mt:
            unchanged_ids.append(old[0])
            unchanged_osrel.append(os_rel)
        else:
            todo.append((os_rel, kind, st))
    catalog.touch_files(unchanged_ids, now_ts, unchanged_osrel)
    total = len(todo)
    done = 0
    errors = 0
    batch = []
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

    workers = 4 if total > 20 else 1
    with ThreadPoolExecutor(max_workers=workers) as ex:
        it = ex.map(work, todo)
        for rec in it:
            done += 1
            if rec.get("tag_error"):
                errors += 1
            batch.append(rec)
            if len(batch) >= 200:
                catalog.upsert_files(batch)
                batch = []
            if progress and (done % 10 == 0 or done == total):
                el = time.time() - t0
                eta = (el / done) * (total - done) if done else 0
                progress(0.02 + 0.93 * done / max(1, total),
                         "%d / %d dosya okundu (kalan ~%s)" % (done, total, util.fmt_dur(eta) or "0:00"))
            if cancel and cancel():
                break
    if batch:
        catalog.upsert_files(batch)
    if cancel and cancel():
        return {"cancelled": True, "read": done}
    idx2 = catalog.file_index()
    seen = []
    for os_rel, kind, st in entries:
        r = idx2.get(root_info.canonical(os_rel))
        if r:
            seen.append(r[0])
    gone = catalog.mark_absent_except(seen)
    catalog.set_meta("last_scan", now_ts)
    catalog.set_meta("fstype", root_info.fstype)
    return {"files": len(entries), "read": done, "unchanged": len(unchanged_ids), "errors": errors,
            "gone": len(gone), "seconds": round(time.time() - t0, 1)}
