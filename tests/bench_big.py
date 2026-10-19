"""Büyük kütüphane ölçümü (yavaşlık / takılma için): ~5.000 dosya, ~4.000 Engine parçası, büyük listeler,
160 Serato crate'i olan sahte bir SSD üretir ve sık kullanılan işlemlerin sürelerini yazar.

Kullanım: python3 -B tests/bench_big.py [hedef_klasör] [dosya_sayısı]
"""
from __future__ import annotations

import os
import random
import sqlite3
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "vendor"))
sys.path.insert(0, os.path.join(HERE, ".."))

BASE = sys.argv[1] if len(sys.argv) > 1 else tempfile.mkdtemp(prefix="djd_bench_")
N = int(sys.argv[2]) if len(sys.argv) > 2 else 5000
os.environ["DJDOKTOR_HOME"] = os.path.join(BASE, "ws")
os.environ["HOME"] = os.path.join(BASE, "home")
os.makedirs(os.path.join(BASE, "home", "Music"), exist_ok=True)

from mutagen.id3 import COMM, ID3, TIT2, TPE1  # noqa: E402

import make_fixture  # noqa: E402
from djdoktor import dedupe, engine, lists, maintain, serato  # noqa: E402
from djdoktor.config import Settings  # noqa: E402
from djdoktor.library import Library  # noqa: E402

GENRES = ["Halay", "Kürtçe Halay", "Horon", "Ankara", "Oyun Havası", "Roman - Mezdeke", "Oryantal - Arabic",
          "Türkçe Pop", "Yabancı Pop", "Dans - Club", "Slow - Çift Dans", "Enstrümantal - Fon", "Kına", "Sallama",
          "Matine", "Giriş - Pasta - Özel", "Türküler"]
WEIGHTS = [8, 4, 3, 4, 5, 4, 3, 10, 6, 34, 3, 2, 2, 2, 2, 2, 4]


def mp3(seed, frames):
    rnd = random.Random(seed)
    out = bytearray()
    for _ in range(frames):
        out += make_fixture.FRAME + rnd.randbytes(make_fixture.FRAME_LEN - 4).replace(b"\xff", b"\xfe")
    return bytes(out)


def build(root):
    rnd = random.Random(7)
    rels = []
    for i in range(N):
        g = rnd.choices(GENRES, WEIGHTS)[0]
        artist = "Sanatçı %d" % rnd.randrange(600)
        title = "Şarkı %05d" % i
        sub = "" if rnd.random() < 0.7 else "/Arşiv %d" % rnd.randrange(8)
        rel = "Müzik/%s%s/%s - %s.mp3" % (g, sub, artist, title)
        seed = i if rnd.random() > 0.04 else max(0, i - 1)          # %4 aynı ses (kopya)
        p = os.path.join(root, *rel.split("/"))
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "wb") as f:
            f.write(mp3(seed, 24 + seed % 9))
        t = ID3()
        t.add(TIT2(encoding=3, text=title))
        t.add(TPE1(encoding=3, text=artist))
        if rnd.random() < 0.2:
            t.add(COMM(encoding=3, lang="eng", desc="", text="not %d" % i))
        t.save(p)
        rels.append((rel, g, artist, title))
    # Engine
    dbdir = os.path.join(root, "Engine Library", "Database2")
    os.makedirs(dbdir, exist_ok=True)
    dbp = os.path.join(dbdir, "m.db")
    sql = open(os.path.join(HERE, "fixtures", "engine_schema_3_0_2.sql"), encoding="utf-8").read()
    con = sqlite3.connect(dbp)
    for st in sql.split(";\n"):
        st = st.strip()
        if st and not st.startswith("CREATE TABLE sqlite_sequence"):
            con.execute(st)
    con.execute("INSERT INTO Information(uuid, schemaVersionMajor, schemaVersionMinor, schemaVersionPatch, "
                "currentPlayedIndiciator, lastRekordBoxLibraryImportReadCounter) VALUES(?,3,0,2,0,0)",
                (make_fixture.DB_UUID,))
    con.execute("INSERT INTO AlbumArt(id, hash, albumArt) VALUES(1, '', NULL)")
    tids = []
    for k, (rel, g, artist, title) in enumerate(rels[: int(N * 0.8)]):
        cur = con.execute(
            "INSERT INTO Track(path, filename, title, artist, isAnalyzed, length, fileType, isAvailable, "
            "isMetadataOfPackedTrackChanged, isPerfomanceDataOfPackedTrackChanged, isMetadataImported, pdbImportKey, "
            "isBeatGridLocked, streamingFlags, explicitLyrics, albumArtId, dateAdded) "
            "VALUES(?,?,?,?,?,?,'mp3',1,0,0,1,0,0,0,0,1,1700000000)",
            ("../" + rel, rel.split("/")[-1], title, artist, int(k % 5 != 0), 200))
        tids.append((cur.lastrowid, g))

    def pl(title, parent=0):
        return con.execute("INSERT INTO Playlist(title, parentListId, isPersisted, nextListId, lastEditTime, "
                           "isExplicitlyExported) VALUES(?,?,1,0,datetime('now'),1)", (title, parent)).lastrowid

    def fill(pid, ids):
        prev = None
        for tid in ids:
            r = con.execute("SELECT originDatabaseUuid, originTrackId FROM Track WHERE id=?", (tid,)).fetchone()
            nid = con.execute("INSERT INTO PlaylistEntity(listId, trackId, databaseUuid, nextEntityId, "
                              "membershipReference) VALUES(?,?,?,0,0)", (pid, r[1], r[0])).lastrowid
            if prev:
                con.execute("UPDATE PlaylistEntity SET nextEntityId=? WHERE id=?", (nid, prev))
            prev = nid
    big = pl("Dans - Club (eski)")
    fill(big, [t for t, g in tids if g == "Dans - Club"])
    ev = pl("Etkinlikler")
    for e in range(30):
        pid = pl("%02d.06.2026 - Düğün %d" % (e % 28 + 1, e), ev)
        for s in range(12):
            sec = pl("Bölüm %d" % s, pid)
            fill(sec, [t for t, _g in rnd.sample(tids, 18)])
    con.commit()
    con.close()
    # Serato
    sdir = os.path.join(root, "_Serato_")
    os.makedirs(os.path.join(sdir, "Subcrates"), exist_ok=True)
    items = [(b"vrsn", serato.u16("2.0/Serato Scratch LIVE Database"))]
    for rel, _g, _a, _t in rels[: int(N * 0.8)]:
        items.append((b"otrk", serato.serialize([(b"ttyp", serato.u16("mp3")), (b"pfil", serato.u16(rel))])))
    with open(os.path.join(sdir, "database V2"), "wb") as f:
        f.write(serato.serialize(items))
    for c in range(160):
        paths = [r[0] for r in rnd.sample(rels, 30)]
        with open(os.path.join(sdir, "Subcrates", "Crate %03d.crate" % c), "wb") as f:
            f.write(serato.build_crate(paths))
    return dbp


def timed(label, fn, *a, **k):
    t0 = time.time()
    r = fn(*a, **k)
    print("%-42s %7.2f s" % (label, time.time() - t0), flush=True)
    return r


def main():
    root = os.path.join(BASE, "SSD")
    if not os.path.isdir(root):
        timed("sahte SSD üretimi (%d dosya)" % N, build, root)
    s = Settings()
    rec = s.add_library(root, "bench")
    lib = Library(s, rec)
    timed("ilk tarama (full_scan)", lib.full_scan)
    if not lib.catalog.genres():
        lib.catalog.set_meta("music_root", "Müzik")
        for g in GENRES:
            lib.catalog.genre_add("Müzik/" + g)
        lib.bump()
    timed("ikinci tarama (değişiklik yok)", lib.full_scan)
    timed("engine_state (soğuk)", lib.engine_state, True)
    timed("dedupe.groups (soğuk)", dedupe.groups, lib)
    timed("overview", lib.overview)
    timed("overview (tekrar)", lib.overview)
    timed("tracks all", lib.tracks, "all")
    gid = lib.catalog.genres()[9]["id"]
    timed("tracks g:Dans - Club", lib.tracks, "g:%d" % gid)
    timed("tracks unsorted", lib.tracks, "unsorted")
    timed("lists.tree", lists.tree, lib)
    t = lists.tree(lib)
    big = max(t["lists"], key=lambda x: x["n"])
    timed("lists.items (%d)" % big["n"], lists.items, lib, big["id"])
    timed("lists.search_library ''", lists.search_library, lib, "", 300)
    timed("maintain.status", maintain.status, lib)
    timed("maintain.run (ilk: Engine'e ekleme)", maintain.run, lib)
    timed("maintain.run (tekrar)", maintain.run, lib)
    timed("overview (Engine yazımından sonra)", lib.overview)
    timed("engine.db_stamp", engine.db_stamp, lib.engine_db()["path"])
    print("kök:", root)


if __name__ == "__main__":
    main()
