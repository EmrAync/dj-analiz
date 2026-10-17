"""Listeler sekmesinde salt okunur göz atma: Serato crate'leri ve diskteki klasör ağacı.

- crates(lib):        Serato crate ağacı (ad, parçalar, şarkı sayısı, Engine listesiyle eşli mi)
- crate_items(lib, n): bir crate'in şarkıları (Engine liste satırlarıyla aynı biçim; dosyası olmayanlar işaretli)
- folders(lib):       SSD'deki klasör ağacı; her klasörde kendi ve alt klasörlerindeki müzik sayısı. Müziği olmayan
                      klasörler de görünür (yalnızca varlığını bilmek için), programın kendi klasörleri görünmez.
- folder_items(lib, rel): bir klasördeki şarkılar (alt klasörler hariç)

Hiçbir şey yazılmaz.
"""
from __future__ import annotations

import os
import time

from . import names, serato
from .config import BUILTIN_EXCLUDES
from .ext import route
from .library import UserError

_DIRS = {}          # kök -> (zaman, klasör listesi): klasör gezintisi 60 sn önbellekli


def _row(lib, st, f, gens, place, title=None, artist=None, dur=None):
    """lists.items satır biçimi (tablo aynı çizilsin)."""
    if f:
        kind, gid = place(f["rel"])
        g = gens.get(gid) if kind == "genre" else None
        es = st["status"].get(f["id"], "none") if st.get("db") else "none"
        dot = "ready" if es == "ready" else ("problem" if es == "broken" else ("pending" if es == "pending" else "none"))
        return {"ref": "f:%d" % f["id"], "tid": None, "fid": f["id"],
                "title": f.get("title") or os.path.splitext(names.display(f["name"]))[0],
                "artist": f.get("artist") or "", "bpm": round(f["bpm"]) if f.get("bpm") else None,
                "key": f.get("camelot") or "", "dur": round(f["duration"]) if f.get("duration") else None,
                "genre": g["name"] if g else None, "color": g["color"] if g else None, "dot": dot,
                "missing": False, "note": "", "fnote": f.get("note") or "", "rel": names.display(f["rel"])}
    return {"ref": "", "tid": None, "fid": None, "title": title or "?", "artist": artist or "", "bpm": None, "key": "",
            "dur": round(dur) if dur else None, "genre": None, "color": None, "dot": "problem", "missing": True,
            "note": "", "fnote": "", "rel": ""}


def crates(lib):
    sdir = lib.serato_dir()
    if not sdir:
        return {"exists": False, "crates": []}
    st = lib.engine_state()
    linked = {r["crate"] for r in lib.catalog.serato_links(st["uuid"]).values() if r.get("crate")} if st["db"] else set()
    out = []
    for c in serato.read_crates(sdir):
        out.append({"name": c["name"], "parts": c["parts"], "n": len(c["tracks"]), "linked": c["name"] in linked})
    out.sort(key=lambda c: [names.fold(x) for x in c["parts"]])
    return {"exists": True, "crates": out}


def crate_items(lib, name):
    sdir = lib.serato_dir()
    if not sdir:
        raise UserError("Bu SSD'de Serato klasörü yok.", "no_serato")
    c = next((c for c in serato.read_crates(sdir) if c["name"] == name), None)
    if not c:
        raise UserError("Crate bulunamadı (Serato'da silinmiş olabilir).", "gone")
    from .resolver import Resolver
    res = Resolver(lib.catalog, lib.root)
    st = lib.engine_state()
    place = lib.placer()
    gens = {g["id"]: g for g in lib.genre_rows()}
    rows, total = [], 0
    for raw in c["tracks"]:
        f, _m = res.resolve(raw)
        f = lib.catalog.file(f["id"]) if f else None          # çözücü kısa kayıt döndürür: tam satırı al
        if f and not f.get("present", 1):
            f = None
        r = _row(lib, st, f, gens, place, title=os.path.splitext(names.display(raw.split("/")[-1]))[0])
        if not f:
            r["rel"] = names.display(raw)
        total += r["dur"] or 0
        rows.append(r)
    return {"kind": "crate", "id": "crate:" + name, "title": c["parts"][-1], "path": c["parts"], "items": rows,
            "dur": total, "managed": True, "readonly_reason": "serato"}


def _walk_dirs(root):
    hit = _DIRS.get(root)
    if hit and time.time() - hit[0] < 60:
        return hit[1]
    excl = {names.fold(x) for x in BUILTIN_EXCLUDES}
    out = []
    stack = [("", 0)]
    while stack:
        rel, depth = stack.pop()
        try:
            it = os.scandir(os.path.join(root, *rel.split("/")) if rel else root)
            ents = [e for e in it if e.is_dir(follow_symlinks=False)]
        except OSError:
            continue
        for e in ents:
            if e.name.startswith(".") or names.fold(e.name) in excl:
                continue
            r = (rel + "/" + e.name) if rel else e.name
            out.append(names.display(r))
            if depth < 8:
                stack.append((r, depth + 1))
    _DIRS[root] = (time.time(), out)
    return out


def folders(lib):
    """[{rel, name, parent, n (bu klasördeki müzik), total (alt klasörlerle)}] — ağaç sırasıyla."""
    direct = {}
    for f in lib.audio_files():
        if not f.get("present", 1):
            continue
        d = names.display(f.get("folder") or "")
        direct[d] = direct.get(d, 0) + 1
    dirs = set(_walk_dirs(lib.root)) | {d for d in direct if d}
    for d in list(dirs):                      # müzikli klasörlerin üst klasörleri de ağaçta olsun
        p = d
        while "/" in p:
            p = p.rsplit("/", 1)[0]
            dirs.add(p)
    total = {}
    for d, n in direct.items():
        p = d
        while True:
            total[p] = total.get(p, 0) + n
            if not p:
                break
            p = p.rsplit("/", 1)[0] if "/" in p else ""
    out = []
    for d in sorted(dirs, key=lambda x: [names.fold(s) for s in x.split("/")]):
        out.append({"rel": d, "name": d.rsplit("/", 1)[-1], "parent": d.rsplit("/", 1)[0] if "/" in d else "",
                    "n": direct.get(d, 0), "total": total.get(d, 0)})
    return {"root_n": direct.get("", 0), "folders": out}


def folder_items(lib, rel):
    rel = (rel or "").strip("/")
    st = lib.engine_state()
    place = lib.placer()
    gens = {g["id"]: g for g in lib.genre_rows()}
    rows, total = [], 0
    for f in lib.audio_files():
        if f.get("present", 1) and names.display(f.get("folder") or "") == rel:
            r = _row(lib, st, f, gens, place)
            total += r["dur"] or 0
            rows.append(r)
    rows.sort(key=lambda r: (names.fold(r["artist"]), names.fold(r["title"])))
    parts = rel.split("/") if rel else ["(SSD kökü)"]
    return {"kind": "folder", "id": "folder:" + rel, "title": parts[-1], "path": parts, "items": rows, "dur": total,
            "managed": True, "readonly_reason": "folder", "rel": rel}


@route("gozat")
def _api(h, lib, method, parts, qs, body):
    act = parts[1] if len(parts) > 1 else ""
    if act == "crates":
        return h._json(crates(lib))
    if act == "crate":
        return h._json(crate_items(lib, qs.get("name") or ""))
    if act == "folders":
        return h._json(folders(lib))
    if act == "folder":
        return h._json(folder_items(lib, qs.get("rel") or ""))
    return None
