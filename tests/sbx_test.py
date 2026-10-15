"""Gerçek veriden üretilmiş sandbox üzerinde v2'nin tam akışı ve TAM geri alma denetimi.

  python sbx_test.py <sandbox_ssd> <çalışma_klasörü>
Çıktı: özet (JSON) — hiçbir gerçek dosyaya dokunmaz.
"""
from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import sys
import time
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
for p in (os.path.join(HERE, "..", "vendor"), os.path.join(HERE, "..")):
    if os.path.isdir(p):
        sys.path.insert(0, p)

ROOT, WORK = sys.argv[1], sys.argv[2]
os.environ["DJDOKTOR_HOME"] = os.path.join(WORK, "ws")
os.environ["HOME"] = os.path.join(WORK, "home")
os.makedirs(os.path.join(WORK, "home", "Music"), exist_ok=True)

from djdoktor import dedupe, engine, journal, lists, maintain, mirror, names, relocate, serato  # noqa: E402
from djdoktor.config import Settings  # noqa: E402
from djdoktor.library import Library  # noqa: E402
from djdoktor.resolver import Resolver  # noqa: E402

R = {}
T0 = time.time()


def lap(k, t):
    R.setdefault("sure", {})[k] = round(time.time() - t, 1)


def tree(root):
    out = {}
    for dp, dn, fn in os.walk(root):
        rel = os.path.relpath(dp, root).replace(os.sep, "/")
        if rel.split("/")[0] in ("_DJDoktor_",):
            continue
        for f in fn:
            p = os.path.join(dp, f)
            r = f if rel == "." else rel + "/" + f
            if r.startswith("Engine Library/Database2/") or r.startswith("_Serato_/"):
                continue
            out[r] = os.path.getsize(p)
    return out


def serato_state(root):
    sdir = os.path.join(root, "_Serato_")
    out = {}
    for dp, dn, fn in os.walk(sdir):
        for f in fn:
            p = os.path.join(dp, f)
            out[os.path.relpath(p, sdir)] = hashlib.md5(open(p, "rb").read()).hexdigest()
    return out


def engine_check(lib):
    d = lib.engine_db()
    con = sqlite3.connect(d["path"])
    ic = con.execute("PRAGMA integrity_check").fetchone()[0]
    fk = len(con.execute("PRAGMA foreign_key_check").fetchall())
    n = con.execute("SELECT COUNT(*) FROM Track").fetchone()[0]
    con.close()
    st = lib.engine_state(force=True)
    miss = Counter(o[2] for o in st["orphans"])
    return {"integrity": ic, "fk_errors": fk, "tracks": n, "status": dict(Counter(st["status"].values())),
            "orphans": dict(miss), "lists": len(st["playlists"])}


def serato_check(lib):
    sdir = lib.serato_dir()
    res = Resolver(lib.catalog, lib.root)
    c = Counter()
    for cr in serato.read_crates(sdir):
        for p in cr["tracks"]:
            f, m = res.resolve(p)
            c[m] += 1
    return dict(c)


dbp = engine.drive_db(ROOT)["path"]
fp0 = engine.semantic_fingerprint(dbp)

s = Settings()
lib = Library(s, s.add_library(ROOT, "SBX"))
t = time.time()
lib.full_scan()
lap("tarama", t)
# programın kendiliğinden yaptığı yol onarımları (geri alınmaz; Prime 4'ün dosyayı bulması için)
m0 = maintain.run(lib)
R["ilk_bakim"] = m0
before_tree = tree(ROOT)
before_ser = serato_state(ROOT)
before_fp = engine.semantic_fingerprint(dbp)
R["ilk_bakim_degistirdi"] = fp0 != before_fp
ov = lib.overview()
R["once"] = {"toplam": ov["total"], "tursuz": ov["unsorted"], "kopya_grup": ov["dupes"], "fazla_kopya": ov["dupe_extra"],
             "benzer": ov["similar"], "sorun": ov["problems"], "engine": engine_check(lib), "serato_crate_yollari": serato_check(lib)}
t = time.time()
pv = relocate.setup_preview(lib, "Müzik")
lap("oneri", t)
R["oneri"] = {"tasinacak": pv["moves"], "tek_tek": pv["spread"], "dokunma": pv["ignore"], "yerinde": pv["stay"],
              "turler": [(g["name"], g["count"]) for g in pv["genres"]]}
R["klasorler"] = ["%s => %s (%d)" % (f["disp"], pv["assign"][f["rel"]], f["direct"]) for f in pv["folders"] if f["direct"]]
t = time.time()
res = relocate.setup_apply(lib, "Müzik")
lap("kurulum", t)
R["kurulum"] = {k: v for k, v in res.items() if k not in ("maint",)}
R["kurulum"]["bakim"] = res.get("maint")
R["kurulum_sonrasi"] = {"engine": engine_check(lib), "serato_crate_yollari": serato_check(lib)}
ov = lib.overview()
R["kurulum_sonrasi"].update({"tursuz": ov["unsorted"], "kopya_grup": ov["dupes"], "turler": [(g["name"], g["count"], g["ready"], g["pending"], g["none"], g["problem"]) for g in ov["genres"]]})
# türü belli olmayanlar için öneriler
rows = lib.tracks("unsorted")
R["tursuz_oneri"] = dict(Counter((r.get("sugg") or "-") + (" (kopya)" if r.get("copy_of") else "") for r in rows))
# çiftler
t = time.time()
groups = dedupe.groups(lib)
R["ciftler"] = dict(Counter(g["kind"] for g in groups))
picks = [{"group": g["id"]} for g in groups if g["kind"] in ("exact", "audio", "engine")]
if picks:
    mres = dedupe.merge(lib, picks)
    R["birlestirme"] = {"dosya": mres["files"], "engine": mres["engine"], "serato": mres["serato"]}
lap("birlestirme", t)
R["birlestirme_sonrasi"] = {"engine": engine_check(lib), "serato_crate_yollari": serato_check(lib)}
# listeler
t = time.time()
tr = lists.tree(lib)
user_lists = [x for x in tr["lists"] if not x["managed"] and x["n"]]
R["engine_listeleri"] = len(tr["lists"])
if user_lists:
    base = user_lists[0]
    ev = lists.new_event(lib, "Test Düğün", date="2026-10-17", base=base["id"])
    fids = [f["id"] for f in lib.audio_files()[:3]]
    lists.add(lib, ev["id"], fids=fids)
    mirror.link(lib, ev["id"], True)
    R["etkinlik"] = {"kopyalanan": base["title"], "satir": len(lists.items(lib, ev["id"])["items"])}
cr = mirror.crates(lib)
if cr:
    mirror.import_crates(lib, [cr[0]["name"]])
lap("listeler", t)
# her şeyi geri al
t = time.time()
n_undo, forced = 0, 0
while lib.catalog.journal_top():
    try:
        journal.undo_last(lib)
    except journal.UndoNeedsForce as e:
        forced += 1
        R.setdefault("zorla", []).append(str(e)[:120])
        journal.undo_last(lib, force=True)
    n_undo += 1
lap("geri_alma", t)
after_tree = tree(ROOT)
after_ser = serato_state(ROOT)
after_fp = engine.semantic_fingerprint(dbp)
R["geri_alma"] = {"adim": n_undo, "zorla": forced, "dosyalar_ayni": before_tree == after_tree,
                  "eksik": sorted(set(before_tree) - set(after_tree))[:10], "fazla": sorted(set(after_tree) - set(before_tree))[:10],
                  "serato_ayni": before_ser == after_ser,
                  "serato_fark": sorted(k for k in set(before_ser) | set(after_ser) if before_ser.get(k) != after_ser.get(k))[:10],
                  "engine_ayni": before_fp == after_fp, "engine": engine_check(lib)}
R["sure"]["toplam"] = round(time.time() - T0, 1)
print(json.dumps(R, ensure_ascii=False, indent=1))
