"""Dışa aktarma (v1'den): rekordbox XML (cue noktalarıyla), M3U8 ve CSV (Excel).

Kaynak olarak Engine listeleri (bir etkinlik / liste ve alt listeleri), tüm listeler ya da tür klasörleri seçilir.
Dosyalar bilgisayardaki çalışma alanına yazılır: Belgeler/DJ Doktor/Dışa Aktarım. Müzik dosyalarına ve Engine /
Serato kütüphanelerine dokunulmaz (yalnızca okunur).
"""
from __future__ import annotations

import csv
import datetime as _dt
import io
import json
import os
import urllib.parse
from xml.sax.saxutils import quoteattr

from . import VERSION, keys, names, util

KIND = {".mp3": "MP3 File", ".m4a": "M4A File", ".aac": "AAC File", ".wav": "WAV File", ".aif": "AIFF File",
        ".aiff": "AIFF File", ".flac": "FLAC File", ".alac": "M4A File", ".ogg": "OGG File", ".mp4": "M4A File"}
ROOT_FOLDER = "DJ Doktor"


def _err(msg, code=None):
    from .library import UserError
    return UserError(msg, code)


def export_dir(lib):
    p = os.path.join(lib.settings.ws, "Dışa Aktarım")
    os.makedirs(p, exist_ok=True)
    return p


def _location(abs_path):
    p = os.path.abspath(abs_path)
    if p.startswith("\\\\?\\"):
        p = p[4:]
    p = names.nfc(p).replace("\\", "/")
    if not p.startswith("/"):
        p = "/" + p
    return "file://localhost" + urllib.parse.quote(p, safe="/:")


def _safe(name):
    return names.clean_component(name or "liste", False)[:80] or "liste"


# ---------------------------------------------------------------------------
# Kaynak ağacı: [{'title', 'fids', 'children'}]
# ---------------------------------------------------------------------------
def collect(lib, source):
    """source: 'list:<id>' (liste + alt listeleri) | 'lists' (tüm listeler) | 'genres' (tür klasörleri)."""
    from . import maintain
    st = lib.engine_state()
    if source == "genres":
        place = lib.placer()
        by_g = {g["id"]: [] for g in lib.genre_rows()}
        files = sorted(lib.audio_files(), key=lambda f: (names.fold(f.get("artist") or ""),
                                                          names.fold(f.get("title") or f["name"])))
        for f in files:
            kind, gid = place(f["rel"])
            if kind == "genre" and gid in by_g:
                by_g[gid].append(f["id"])
        nodes = [{"title": g["name"], "fids": by_g[g["id"]], "children": []} for g in lib.genre_rows()]
        return [{"title": "Türler", "fids": [], "children": nodes}], "Türler"
    if not st["db"]:
        raise _err("Bu SSD'de Engine kütüphanesi yok.", "no_engine")
    kids = {}
    for p in st["playlists"]:
        kids.setdefault(p["parent"], []).append(p)
    by_id = {p["id"]: p for p in st["playlists"]}
    managed = maintain.managed_ids(lib, st["uuid"])

    def node(p):
        fids = [st["fid_of_tid"].get(t) for t in p["entries"]]
        return {"title": p["title"], "fids": [f for f in fids if f],
                "children": [node(c) for c in kids.get(p["id"], []) if c["id"] not in managed]}
    if source == "lists":
        return [node(p) for p in kids.get(0, []) if p["id"] not in managed], "Tüm listeler"
    if source.startswith("list:"):
        p = by_id.get(int(source[5:]))
        if not p:
            raise _err("Liste bulunamadı.", "gone")
        return [node(p)], p["title"]
    raise _err("Bilinmeyen kaynak.")


def _walk_fids(tree):
    out = []
    for n in tree:
        out.extend(n["fids"])
        out.extend(_walk_fids(n["children"]))
    return list(dict.fromkeys(out))


def _engine_info(lib):
    st = lib.engine_state()
    tid_of = {fid: rows[0][0] for fid, rows in st["by_file"].items() if rows}
    return st, tid_of


# ---------------------------------------------------------------------------
# rekordbox XML
# ---------------------------------------------------------------------------
def rekordbox_xml(lib, source, cues=True):
    tree, label = collect(lib, source)
    fids = _walk_fids(tree)
    files = {f["id"]: f for f in lib.catalog.q("SELECT * FROM files WHERE id IN (%s)" % (",".join(map(str, fids)) or "0"))}
    st, tid_of = _engine_info(lib)
    present = [f for f in fids if f in files and files[f]["present"]]
    tid = {}
    lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<DJ_PLAYLISTS Version="1.0.0">',
             '  <PRODUCT Name="DJ Doktor" Version="%s" Company="DJ Doktor"/>' % VERSION,
             '  <COLLECTION Entries="%d">' % len(present)]
    n_cues = 0
    for n, fid in enumerate(present, 1):
        f = files[fid]
        tid[fid] = n
        t = st["tracks"].get(tid_of.get(fid)) or {}
        stem = os.path.splitext(names.display(f["name"]))[0]
        bpm = f.get("bpm") or t.get("bpmAnalyzed") or 0
        cam = f.get("camelot") or keys.engine_key_to_camelot(t.get("key"))
        attrs = [
            ("TrackID", str(n)), ("Name", f.get("title") or stem), ("Artist", f.get("artist") or ""),
            ("Composer", f.get("composer") or ""), ("Album", f.get("album") or ""), ("Grouping", f.get("grouping") or ""),
            ("Genre", f.get("genre") or ""), ("Kind", KIND.get(f.get("ext") or "", "MP3 File")),
            ("Size", str(f.get("size") or 0)), ("TotalTime", str(int(round(f.get("duration") or 0)))),
            ("DiscNumber", "0"), ("TrackNumber", str(f.get("track_no") or 0)), ("Year", str(f.get("year") or "")),
            ("AverageBpm", "%.2f" % bpm),
            ("DateAdded", _dt.date.fromtimestamp(f.get("first_seen") or util.now()).isoformat()),
            ("BitRate", str(f.get("bitrate") or 0)), ("SampleRate", str(f.get("sample_rate") or 44100)),
            ("Comments", f.get("comment") or ""), ("PlayCount", "0"),
            ("Rating", str({0: 0, 1: 51, 2: 102, 3: 153, 4: 204, 5: 255}.get(f.get("rating") or 0, 0))),
            ("Location", _location(lib.rootinfo.os_path(f["rel"], f.get("os_rel")))),
            ("Remixer", f.get("remixer") or ""), ("Tonality", keys.camelot_to_rekordbox(cam or "")),
            ("Label", f.get("label") or ""), ("Mix", ""),
        ]
        attr_s = " ".join("%s=%s" % (k, quoteattr(str(v))) for k, v in attrs)
        marks = []
        if cues and f.get("cues_json"):
            try:
                m = json.loads(f["cues_json"])
            except ValueError:
                m = {}
            for c in (m.get("cues") or []):
                r, g, b = _rgb(c.get("color"))
                for num in (str(c.get("i", 0)), "-1"):
                    marks.append('      <POSITION_MARK Name=%s Type="0" Start="%.3f" Num="%s" Red="%d" Green="%d" '
                                 'Blue="%d"/>' % (quoteattr(c.get("name") or ""), (c.get("ms") or 0) / 1000.0, num,
                                                  r, g, b))
                n_cues += 1
            for lp in (m.get("loops") or []):
                marks.append('      <POSITION_MARK Name=%s Type="4" Start="%.3f" End="%.3f" Num="-1"/>'
                             % (quoteattr(lp.get("name") or ""), (lp.get("start") or 0) / 1000.0,
                                (lp.get("end") or 0) / 1000.0))
        if marks:
            lines.append("    <TRACK %s>" % attr_s)
            lines.extend(marks)
            lines.append("    </TRACK>")
        else:
            lines.append("    <TRACK %s/>" % attr_s)
    lines.append("  </COLLECTION>")
    lines.append("  <PLAYLISTS>")

    def emit(nd, ind):
        sp = "  " * ind
        if nd["children"]:
            extra = 1 if nd["fids"] else 0
            lines.append('%s<NODE Name=%s Type="0" Count="%d">' % (sp, quoteattr(nd["title"]), len(nd["children"]) + extra))
            if nd["fids"]:
                emit({"title": nd["title"] + " (tümü)", "fids": nd["fids"], "children": []}, ind + 1)
            for c in nd["children"]:
                emit(c, ind + 1)
            lines.append("%s</NODE>" % sp)
        else:
            ent = [tid[f] for f in nd["fids"] if f in tid]
            lines.append('%s<NODE Name=%s Type="1" KeyType="0" Entries="%d">' % (sp, quoteattr(nd["title"]), len(ent)))
            for k in ent:
                lines.append('%s  <TRACK Key="%d"/>' % (sp, k))
            lines.append("%s</NODE>" % sp)
    lines.append('    <NODE Type="0" Name="ROOT" Count="1">')
    lines.append('      <NODE Name=%s Type="0" Count="%d">' % (quoteattr(ROOT_FOLDER), len(tree)))
    for nd in tree:
        emit(nd, 4)
    lines.append("      </NODE>")
    lines.append("    </NODE>")
    lines.append("  </PLAYLISTS>")
    lines.append("</DJ_PLAYLISTS>")
    path = util.unique_path(os.path.join(export_dir(lib), "rekordbox - %s - %s.xml" % (_safe(label), util.stamp())))
    util.atomic_write_text(path, "\n".join(lines) + "\n")
    return {"path": path, "dir": os.path.dirname(path), "tracks": len(present), "cues": n_cues,
            "missing": len(fids) - len(present)}


def _rgb(c):
    try:
        c = (c or "#cc0000").lstrip("#")
        return int(c[0:2], 16), int(c[2:4], 16), int(c[4:6], 16)
    except (ValueError, TypeError):
        return 204, 0, 0


# ---------------------------------------------------------------------------
# M3U8
# ---------------------------------------------------------------------------
def m3u(lib, source):
    tree, label = collect(lib, source)
    fids = _walk_fids(tree)
    files = {f["id"]: f for f in lib.catalog.q("SELECT id, rel, os_rel, name, title, artist, duration, present FROM "
                                               "files WHERE id IN (%s)" % (",".join(map(str, fids)) or "0"))}
    base = os.path.join(export_dir(lib), "M3U - %s - %s" % (_safe(label), util.stamp()))
    os.makedirs(base, exist_ok=True)
    written = []

    def emit(nd, prefix):
        title = nd["title"]
        if nd["fids"]:
            out = ["#EXTM3U", "#PLAYLIST:%s" % title]
            for fid in nd["fids"]:
                f = files.get(fid)
                if not f or not f["present"]:
                    continue
                name = " - ".join(x for x in (f.get("artist"), f.get("title")) if x) or \
                    os.path.splitext(names.display(f["name"]))[0]
                out.append("#EXTINF:%d,%s" % (int(round(f.get("duration") or 0)), name))
                p = lib.rootinfo.os_path(f["rel"], f.get("os_rel"))
                out.append(p[4:] if p.startswith("\\\\?\\") else p)
            path = util.unique_path(os.path.join(base, _safe(" - ".join(prefix + [title])) + ".m3u8"))
            util.atomic_write_text(path, "\n".join(out) + "\n")
            written.append(path)
        for c in nd["children"]:
            emit(c, prefix + [title])
    for nd in tree:
        emit(nd, [])
    return {"dir": base, "files": len(written)}


# ---------------------------------------------------------------------------
# CSV (Excel): tüm kütüphane
# ---------------------------------------------------------------------------
CSV_COLS = [("Başlık", "title"), ("Sanatçı", "artist"), ("Albüm", "album"), ("Tür (klasör)", "_genre"),
            ("Tür etiketi", "genre"), ("BPM", "_bpm"), ("Ton", "_key"), ("Enerji", "mik_energy"), ("Süre", "_dur"),
            ("kbps", "bitrate"), ("Biçim", "ext"), ("Boyut (MB)", "_mb"), ("Not", "note"), ("Cue", "cues"),
            ("Yıl", "year"), ("Plak şirketi", "label"), ("Engine", "_engine"), ("Kopya", "_dup"), ("Yol", "_rel")]
ENGINE_TXT = {"ready": "hazır", "pending": "analiz bekliyor", "broken": "yolu bozuk", "edup": "iki kez",
              "none": "yok"}


def library_csv(lib):
    from . import dedupe
    from .library import STATE_DIR
    st, tid_of = _engine_info(lib)
    place = lib.placer()
    gens = {g["id"]: g["name"] for g in lib.genre_rows()}
    dup = dedupe.dup_index(lib)
    buf = io.StringIO()
    w = csv.writer(buf, delimiter=";", lineterminator="\r\n")
    w.writerow([c for c, _k in CSV_COLS])
    rows = sorted((f for f in lib.audio_files() if not f["rel"].startswith(STATE_DIR + "/")),
                  key=lambda f: (names.fold(f.get("folder") or ""), names.fold(f.get("artist") or ""),
                                 names.fold(f.get("title") or f["name"])))
    for f in rows:
        t = st["tracks"].get(tid_of.get(f["id"])) or {}
        kind, gid = place(f["rel"])
        bpm = f.get("bpm") or t.get("bpmAnalyzed")
        d = dup.get(f["id"])
        vals = {"_genre": gens.get(gid, "") if kind == "genre" else "", "_bpm": ("%.1f" % bpm).replace(".", ",") if bpm else "",
                "_key": f.get("camelot") or keys.engine_key_to_camelot(t.get("key")),
                "_dur": util.fmt_dur(f.get("duration")), "_mb": ("%.1f" % ((f.get("size") or 0) / 1048576.0)).replace(".", ","),
                "_engine": ENGINE_TXT.get(st["status"].get(f["id"], "none"), ""),
                "_dup": ("%d kopya" % d["n"]) if d and d["kind"] != "song" else "", "_rel": names.display(f["rel"])}
        w.writerow([vals[k] if k.startswith("_") else ("" if f.get(k) is None else f.get(k)) for _c, k in CSV_COLS])
    path = util.unique_path(os.path.join(export_dir(lib), "Kütüphane - %s.csv" % util.stamp()))
    with open(path, "w", encoding="utf-8-sig", newline="") as fh:
        fh.write(buf.getvalue())
    return {"path": path, "dir": os.path.dirname(path), "rows": len(rows)}
