"""Dışa aktarma: rekordbox XML (Engine DJ'in resmi içe aktarımı için), M3U8, etkinlik çıktısı."""
from __future__ import annotations

import datetime as _dt
import html
import json
import os
import urllib.parse
from xml.sax.saxutils import quoteattr

from . import keys, names, util

KIND = {".mp3": "MP3 File", ".m4a": "M4A File", ".aac": "AAC File", ".wav": "WAV File", ".aif": "AIFF File",
        ".aiff": "AIFF File", ".flac": "FLAC File", ".alac": "M4A File", ".ogg": "OGG File"}


def _location(abs_path: str) -> str:
    p = os.path.abspath(abs_path)
    if p.startswith("\\\\?\\"):
        p = p[4:]
    p = names.nfc(p).replace("\\", "/")
    if not p.startswith("/"):
        p = "/" + p
    return "file://localhost" + urllib.parse.quote(p, safe="/:")


def _collect(lib, list_ids):
    """Seçili listeler (ve alt listeleri) -> ağaç + parça kümesi."""
    cat = lib.catalog

    def node(lid):
        l = cat.list_get(lid)
        kids = cat.list_children(lid)
        return {"id": lid, "title": l["title"], "kind": l["kind"], "info": l.get("info") or {},
                "files": cat.item_file_ids(lid), "children": [node(k["id"]) for k in kids]}
    tree = [node(int(i)) for i in list_ids]
    fids = []

    def walk(ns):
        for n in ns:
            fids.extend(n["files"])
            walk(n["children"])
    walk(tree)
    fids = list(dict.fromkeys(fids))
    files = {f["id"]: f for f in cat.q("SELECT * FROM files WHERE id IN (%s)" % (",".join(map(str, fids)) or "0"))}
    return tree, fids, files


def rekordbox_xml(lib, list_ids, include_cues=True):
    tree, fids, files = _collect(lib, list_ids)
    tid = {}
    lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<DJ_PLAYLISTS Version="1.0.0">',
             '  <PRODUCT Name="DJ Kutuphane Doktoru" Version="1.0.0" Company="DJ Kutuphane Doktoru"/>']
    present = [f for f in fids if f in files and files[f]["present"]]
    lines.append('  <COLLECTION Entries="%d">' % len(present))
    for n, fid in enumerate(present, 1):
        f = files[fid]
        tid[fid] = n
        stem = os.path.splitext(names.display(f["name"]))[0]
        attrs = {
            "TrackID": str(n), "Name": f["title"] or stem, "Artist": f["artist"] or "", "Composer": f["composer"] or "",
            "Album": f["album"] or "", "Grouping": f["grouping"] or "", "Genre": f["genre"] or "",
            "Kind": KIND.get(f["ext"], "MP3 File"), "Size": str(f["size"] or 0),
            "TotalTime": str(int(round(f["duration"] or 0))), "DiscNumber": "0", "TrackNumber": str(f["track_no"] or 0),
            "Year": str(f["year"] or ""), "AverageBpm": "%.2f" % (f["bpm"] or 0),
            "DateAdded": _dt.date.fromtimestamp(f["first_seen"] or util.now()).isoformat(),
            "BitRate": str(f["bitrate"] or 0), "SampleRate": str(f["sample_rate"] or 44100),
            "Comments": f["comment"] or "", "PlayCount": "0",
            "Rating": str({0: 0, 1: 51, 2: 102, 3: 153, 4: 204, 5: 255}.get(f["rating"] or 0, 0)),
            "Location": _location(lib.rootinfo.os_path(f["rel"], f.get("os_rel"))),
            "Remixer": f["remixer"] or "", "Tonality": keys.camelot_to_rekordbox(f["camelot"] or ""),
            "Label": f["label"] or "", "Mix": "",
        }
        attr_s = " ".join("%s=%s" % (k, quoteattr(v)) for k, v in attrs.items())
        marks = []
        if include_cues and f.get("cues_json"):
            try:
                m = json.loads(f["cues_json"])
            except ValueError:
                m = {}
            for c in (m.get("cues") or []):
                r, g, b = _rgb(c.get("color"))
                for num in (str(c["i"]), "-1"):
                    marks.append('      <POSITION_MARK Name=%s Type="0" Start="%.3f" Num="%s" Red="%d" Green="%d" Blue="%d"/>'
                                 % (quoteattr(c.get("name") or ""), c["ms"] / 1000.0, num, r, g, b))
            for lp in (m.get("loops") or []):
                marks.append('      <POSITION_MARK Name=%s Type="4" Start="%.3f" End="%.3f" Num="-1"/>'
                             % (quoteattr(lp.get("name") or ""), lp["start"] / 1000.0, lp["end"] / 1000.0))
        if marks:
            lines.append("    <TRACK %s>" % attr_s)
            lines.extend(marks)
            lines.append("    </TRACK>")
        else:
            lines.append("    <TRACK %s/>" % attr_s)
    lines.append("  </COLLECTION>")
    lines.append("  <PLAYLISTS>")
    folder = lib.prefs().get("engine_folder") or "DJ Doktor"

    def emit(n, ind):
        sp = "  " * ind
        if n["children"]:
            lines.append('%s<NODE Name=%s Type="0" Count="%d">' % (sp, quoteattr(_title(n)), len(n["children"]) + (1 if n["files"] else 0)))
            if n["files"]:
                emit({"title": _title(n) + " (tümü)", "kind": "list", "files": n["files"], "children": [], "info": {}}, ind + 1)
            for c in n["children"]:
                emit(c, ind + 1)
            lines.append("%s</NODE>" % sp)
        else:
            ent = [tid[f] for f in n["files"] if f in tid]
            lines.append('%s<NODE Name=%s Type="1" KeyType="0" Entries="%d">' % (sp, quoteattr(_title(n)), len(ent)))
            for k in ent:
                lines.append('%s  <TRACK Key="%d"/>' % (sp, k))
            lines.append("%s</NODE>" % sp)
    lines.append('    <NODE Type="0" Name="ROOT" Count="1">')
    lines.append('      <NODE Name=%s Type="0" Count="%d">' % (quoteattr(folder), len(tree)))
    for n in tree:
        emit(n, 4)
    lines.append("      </NODE>")
    lines.append("    </NODE>")
    lines.append("  </PLAYLISTS>")
    lines.append("</DJ_PLAYLISTS>")
    out_dir = lib.settings.export_dir(lib.id, "rekordbox")
    path = os.path.join(out_dir, "rekordbox_%s.xml" % util.stamp())
    util.atomic_write_text(path, "\n".join(lines) + "\n")
    util.atomic_write_text(os.path.join(out_dir, "rekordbox_son.xml"), "\n".join(lines) + "\n")
    return {"path": path, "latest": os.path.join(out_dir, "rekordbox_son.xml"), "tracks": len(present)}


def _title(n):
    t = n["title"]
    if n.get("kind") == "event" and (n.get("info") or {}).get("date"):
        t = "%s %s" % (n["info"]["date"], t)
    return t


def _rgb(c):
    try:
        c = (c or "#cc0000").lstrip("#")
        return int(c[0:2], 16), int(c[2:4], 16), int(c[4:6], 16)
    except Exception:
        return 204, 0, 0


def m3u(lib, list_ids):
    tree, fids, files = _collect(lib, list_ids)
    out_dir = lib.settings.export_dir(lib.id, "m3u")
    written = []

    def emit(n, prefix):
        title = _title(n)
        safe = names.clean_component(" - ".join(prefix + [title]), False)
        if n["files"]:
            lines = ["#EXTM3U", "#PLAYLIST:%s" % title]
            for fid in n["files"]:
                f = files.get(fid)
                if not f or not f["present"]:
                    continue
                name = " - ".join(x for x in (f["artist"], f["title"]) if x) or os.path.splitext(names.display(f["name"]))[0]
                lines.append("#EXTINF:%d,%s" % (int(round(f["duration"] or 0)), name))
                p = lib.rootinfo.os_path(f["rel"], f.get("os_rel"))
                lines.append(p[4:] if p.startswith("\\\\?\\") else p)
            path = os.path.join(out_dir, safe + ".m3u8")
            util.atomic_write_text(path, "\n".join(lines) + "\n")
            written.append(path)
        for c in n["children"]:
            emit(c, prefix + [title])
    for n in tree:
        emit(n, [])
    return {"files": written, "dir": out_dir}


def event_print_html(lib, eid):
    ov = lib.event_overview(eid)
    ev = ov["event"]
    info = ev.get("info") or {}
    e = html.escape

    def row_html(i, it):
        warn = "" if it["present"] else ' class="miss"'
        return ("<tr%s><td>%d</td><td><b>%s</b><br><span>%s</span></td><td>%s</td><td>%s</td><td>%s</td><td>%s</td></tr>"
                % (warn, i, e(it["title"]), e(it["artist"]), e(str(it["bpm"] or "")), e(it["camelot"] or ""),
                   e(util.fmt_dur(it["duration"])), e(it["item_note"] or it["note"] or "")))
    secs = []
    for n, s in enumerate(ov["sections"], 1):
        rows = "".join(row_html(i, it) for i, it in enumerate(s["items"], 1)) or '<tr><td colspan="6" class="empty">— boş —</td></tr>'
        secs.append('<section><h2>%02d · %s <small>%d parça · %s</small></h2><table><thead><tr><th>#</th><th>Parça</th>'
                    '<th>BPM</th><th>Ton</th><th>Süre</th><th>Not</th></tr></thead><tbody>%s</tbody></table></section>'
                    % (n, e(s["title"]), len(s["items"]), util.fmt_dur(s["duration"]) or "0:00", rows))
    meta = []
    for k, lbl in (("date", "Tarih"), ("start", "Başlangıç"), ("venue", "Mekân"), ("couple", "Çift / Kişiler"),
                   ("contact", "İletişim")):
        if info.get(k):
            meta.append("<div><b>%s:</b> %s</div>" % (lbl, e(str(info[k]))))
    extra = []
    for k, lbl in (("notes", "Notlar"), ("requests", "İstek parçalar"), ("donotplay", "ÇALINMAYACAKLAR")):
        if info.get(k):
            extra.append('<div class="box"><h3>%s</h3><p>%s</p></div>' % (lbl, e(str(info[k])).replace("\n", "<br>")))
    return """<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>%s</title>
<style>
body{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;margin:24px;color:#111}
h1{margin:0 0 4px;font-size:26px} .meta{display:flex;gap:18px;flex-wrap:wrap;color:#333;margin:6px 0 14px}
h2{font-size:17px;margin:22px 0 6px;border-bottom:2px solid #111;padding-bottom:3px} h2 small{font-weight:400;color:#555;font-size:13px}
table{width:100%%;border-collapse:collapse;font-size:13px} th,td{padding:4px 6px;border-bottom:1px solid #ddd;text-align:left;vertical-align:top}
td span{color:#555} tr.miss td{color:#b00;text-decoration:line-through} .empty{color:#888;text-align:center}
.box{border:1px solid #ccc;border-radius:6px;padding:8px 12px;margin:8px 0} .box h3{margin:0 0 4px;font-size:14px}
.tot{margin-top:4px;color:#333} .btn{position:fixed;top:14px;right:14px;padding:8px 14px;font-size:14px}
@media print{.btn{display:none} section{break-inside:avoid-page}}
</style></head><body><button class="btn" onclick="print()">Yazdır / PDF</button>
<h1>%s</h1><div class="meta">%s</div><div class="tot">Toplam: %d bölüm · %s</div>%s%s
<p style="color:#888;font-size:11px;margin-top:30px">DJ Kütüphane Doktoru · %s</p></body></html>""" % (
        e(ev["title"]), e(ev["title"]), "".join(meta), len(ov["sections"]), util.fmt_dur(ov["duration"]) or "0:00",
        "".join(extra), "".join(secs), _dt.datetime.now().strftime("%d.%m.%Y %H:%M"))
