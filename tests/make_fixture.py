"""Test için sahte bir DJ SSD'si üretir: kullanıcının gerçek yapısına benzeyen klasörler,
gerçek MP3 çerçeveleri (ses imzası çalışsın diye), Serato database V2 + crate'ler ve gerçek
şemadan (3.0.2) Engine veritabanı.

Kullanım: python tests/make_fixture.py <hedef_klasör>
"""
from __future__ import annotations

import os
import random
import sqlite3
import sys
import unicodedata

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "vendor"))
sys.path.insert(0, os.path.join(HERE, ".."))

from mutagen.id3 import COMM, ID3, TCON, TIT2, TPE1  # noqa: E402

from djdoktor import serato  # noqa: E402

DB_UUID = "11111111-2222-3333-4444-555555555555"
FRAME = b"\xff\xfb\x90\x64"
FRAME_LEN = 417


def mp3_bytes(seed: int, frames: int) -> bytes:
    rnd = random.Random(seed)
    out = bytearray()
    for _ in range(frames):
        payload = bytes(rnd.getrandbits(8) for _ in range(FRAME_LEN - 4))
        payload = payload.replace(b"\xff", b"\xfe")  # sahte senkron olmasın
        out += FRAME + payload
    return bytes(out)


def write_mp3(path, seed, frames=160, title=None, artist=None, genre=None, comment=None):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(mp3_bytes(seed, frames))
    tags = ID3()
    if title:
        tags.add(TIT2(encoding=3, text=title))
    if artist:
        tags.add(TPE1(encoding=3, text=artist))
    if genre:
        tags.add(TCON(encoding=3, text=genre))
    if comment:
        tags.add(COMM(encoding=3, lang="eng", desc="", text=comment))
    tags.save(path)


# (klasör, dosya adı, seed, kare, başlık, sanatçı, tür, yorum)
FILES = [
    ("melis music/HALAYLAR", "Ali Kemal - Halay Başı.mp3", 1, 160, "Halay Başı", "Ali Kemal", "Halay", "gelin girişi sonrası"),
    ("melis music/HALAYLAR", "Grup Ateş - Delilo.mp3", 2, 170, "Delilo", "Grup Ateş", "Kurdish", None),
    ("melis music/HALAYLAR", "Hüseyin Ay - Çiftetelli Halay.mp3", 3, 150, "Çiftetelli Halay", "Hüseyin Ay", None, None),
    ("melis music/HALAYLAR", "Sivas Halayı.mp3", 4, 165, "Sivas Halayı", "Bilinmeyen", None, None),
    ("melis music/HORON", "Karadeniz Horon 1.mp3", 5, 155, "Horon 1", "Kemençe Ekibi", "Horon", None),
    ("melis music/HORON", "Karadeniz Horon 2.mp3", 6, 158, "Horon 2", "Kemençe Ekibi", "Horon", None),
    ("melis music/KARISIK POP", "Tarkan - Yolla.mp3", 7, 175, "Yolla", "Tarkan", "Pop", None),
    ("melis music/KARISIK POP", "Sezen Aksu - Firuze.mp3", 8, 180, "Firuze", "Sezen Aksu", "Pop", None),
    ("melis music/06.10.2026", "Ali Kemal - Halay Başı.mp3", 1, 160, "Halay Başı", "Ali Kemal", "Halay", "gelin girişi sonrası"),
    ("melis music/06.10.2026", "Yeni Oyun Havası.mp3", 9, 162, "Yeni Oyun Havası", "Klarnet Ustası", None, None),
    ("melis music/06.10.2026", "Bilinmeyen Parça.mp3", 10, 140, "Bilinmeyen Parça", "", None, None),
    ("melis music/secilecek", "Grup Ateş - Delilo (1).mp3", 2, 170, "Delilo", "Grup Ateş", None, "MIK 8A"),
    ("melis music/secilecek", "Horon Remix.mp3", 11, 150, "Horon Remix", "DJ X", None, None),
    ("mix/7-24 Yıldızlarla Ankara Vol. 2/CD-1", "01 Ankara Havası.mp3", 12, 160, "Ankara Havası", "Ankaralı Namık", None, None),
    ("mix/7-24 Yıldızlarla Ankara Vol. 2/CD-1", "02 Misket.mp3", 13, 160, "Misket", "Ankaralı Namık", None, None),
    ("mix/OYUN HAVASI  karisik/HALAY MP", "Dik Halay.mp3", 14, 160, "Dik Halay", "Davul Zurna", None, None),
    ("Samples MAO (kick,snare,clap,hat,noise,FX)/CLAPS", "clap 01.mp3", 15, 20, None, None, None, None),
    ("Engine Library/Music/Tarkan/Unknown Album", "Tarkan - Yolla.mp3", 7, 175, "Yolla", "Tarkan", "Pop", None),
    ("Dj Özlem", "Özel Giriş Müziği.mp3", 16, 150, "Özel Giriş", "Dj Özlem", None, None),
]


def mac_form(rel):
    return unicodedata.normalize("NFD", rel)


def build_serato(root, rels):
    sdir = os.path.join(root, "_Serato_")
    os.makedirs(os.path.join(sdir, "Subcrates"), exist_ok=True)
    items = [(b"vrsn", serato.u16("2.0/Serato Scratch LIVE Database"))]
    for rel in rels:
        sub = [(b"ttyp", serato.u16("mp3")), (b"pfil", serato.u16(mac_form(rel))),
               (b"tsng", serato.u16(os.path.splitext(rel.split("/")[-1])[0]))]
        items.append((b"otrk", serato.serialize(sub)))
    with open(os.path.join(sdir, "database V2"), "wb") as f:
        f.write(serato.serialize(items))

    def crate(name, paths):
        with open(os.path.join(sdir, "Subcrates", name + ".crate"), "wb") as f:
            f.write(serato.build_crate([mac_form(p) for p in paths]))
    crate("Melis Program", [])
    crate("Melis Program%%Halaylar", ["melis music/HALAYLAR/Ali Kemal - Halay Başı.mp3",
                                      "melis music/HALAYLAR/Grup Ateş - Delilo.mp3",
                                      "melis music/06.10.2026/Ali Kemal - Halay Başı.mp3",
                                      "melis music/secilecek/Grup Ateş - Delilo (1).mp3"])
    crate("Melis Program%%Oyun Havaları", ["melis music/06.10.2026/Yeni Oyun Havası.mp3",
                                           "mix/OYUN HAVASI  karisik/HALAY MP/Dik Halay.mp3"])
    crate("Düğün 2024", ["melis music/KARISIK POP/Tarkan - Yolla.mp3", "melis music/HORON/Karadeniz Horon 1.mp3"])
    return sdir


def build_engine(root):
    lib = os.path.join(root, "Engine Library", "Database2")
    os.makedirs(lib, exist_ok=True)
    dbp = os.path.join(lib, "m.db")
    sql = open(os.path.join(HERE, "fixtures", "engine_schema_3_0_2.sql"), encoding="utf-8").read()
    con = sqlite3.connect(dbp)
    for st in sql.split(";\n"):
        st = st.strip()
        if not st or st.startswith("CREATE TABLE sqlite_sequence"):
            continue
        con.execute(st)
    con.execute("INSERT INTO Information(uuid, schemaVersionMajor, schemaVersionMinor, schemaVersionPatch, "
                "currentPlayedIndiciator, lastRekordBoxLibraryImportReadCounter) VALUES(?,3,0,2,0,0)", (DB_UUID,))
    con.execute("INSERT INTO AlbumArt(id, hash, albumArt) VALUES(1, '', NULL)")

    def track(path, title, artist, analyzed=0, length=4):
        cur = con.execute(
            "INSERT INTO Track(path, filename, title, artist, isAnalyzed, length, fileType, isAvailable, "
            "isMetadataOfPackedTrackChanged, isPerfomanceDataOfPackedTrackChanged, isMetadataImported, pdbImportKey, "
            "isBeatGridLocked, streamingFlags, explicitLyrics, albumArtId, dateAdded) "
            "VALUES(?,?,?,?,?,?,'mp3',1,0,0,1,0,0,0,0,1,1700000000)",
            (path, path.split("/")[-1], title, artist, analyzed, length))
        return cur.lastrowid
    t = {}
    t["halay1"] = track("../melis music/HALAYLAR/Ali Kemal - Halay Başı.mp3", "Halay Başı", "Ali Kemal", 1)
    t["delilo"] = track("../melis music/HALAYLAR/Grup Ateş - Delilo.mp3", "Delilo", "Grup Ateş", 1)
    # Mac'te eklenmiş: ayrık harf (NFD) -> Prime 4 bulamaz
    t["huseyin"] = track(mac_form("../melis music/HALAYLAR/Hüseyin Ay - Çiftetelli Halay.mp3"), "Çiftetelli Halay",
                         "Hüseyin Ay", 0)
    t["yolla_copy"] = track("Music/Tarkan/Unknown Album/Tarkan - Yolla.mp3", "Yolla", "Tarkan", 1)
    t["horon1"] = track("../melis music/HORON/Karadeniz Horon 1.mp3", "Horon 1", "Kemençe Ekibi", 0)
    t["missing"] = track("../melis music/eski/Silinen Şarkı.mp3", "Silinen Şarkı", "?", 1)
    t["dup06"] = track("../melis music/06.10.2026/Ali Kemal - Halay Başı.mp3", "Halay Başı", "Ali Kemal", 0)
    t["oyun"] = track("../melis music/06.10.2026/Yeni Oyun Havası.mp3", "Yeni Oyun Havası", "Klarnet Ustası", 0)

    def pl(title, parent=0):
        cur = con.execute("INSERT INTO Playlist(title, parentListId, isPersisted, nextListId, lastEditTime, "
                          "isExplicitlyExported) VALUES(?,?,1,0,datetime('now'),1)", (title, parent))
        return cur.lastrowid

    def fill(pid, tids):
        prev = None
        for tid in tids:
            r = con.execute("SELECT originDatabaseUuid, originTrackId FROM Track WHERE id=?", (tid,)).fetchone()
            nid = con.execute("INSERT INTO PlaylistEntity(listId, trackId, databaseUuid, nextEntityId, "
                              "membershipReference) VALUES(?,?,?,0,0)", (pid, r[1], r[0])).lastrowid
            if prev:
                con.execute("UPDATE PlaylistEntity SET nextEntityId=? WHERE id=?", (nid, prev))
            prev = nid
    mp = pl("Melis Program")
    h = pl("Halaylar", mp)
    o = pl("Oyun Havaları", mp)
    d = pl("Düğün 2024")
    fill(h, [t["halay1"], t["delilo"], t["huseyin"], t["dup06"]])
    fill(o, [t["oyun"], t["missing"]])
    fill(d, [t["yolla_copy"], t["horon1"]])
    con.commit()
    con.close()
    return dbp, t


def build(root):
    os.makedirs(root, exist_ok=True)
    rels = []
    for folder, name, seed, frames, title, artist, genre, comment in FILES:
        rel = folder + "/" + name
        write_mp3(os.path.join(root, *rel.split("/")), seed, frames, title, artist, genre, comment)
        rels.append(rel)
    # yarım inmiş dosya: yalnızca etiket
    p = os.path.join(root, "melis music", "secilecek", "Yarım İnmiş.mp3")
    with open(p, "wb") as f:
        f.write(b"")
    t = ID3()
    t.add(TIT2(encoding=3, text="Yarım"))
    t.save(p)
    # Mac çöpü
    with open(os.path.join(root, "melis music", "HALAYLAR", "._Sivas Halayı.mp3"), "wb") as f:
        f.write(b"\x00\x05\x16\x07" + b"\x00" * 4092)
    with open(os.path.join(root, "melis music", "HORON", ".DS_Store"), "wb") as f:
        f.write(b"\x00\x00\x00\x01Bud1")
    with open(os.path.join(root, "mix", "7-24 Yıldızlarla Ankara Vol. 2", "CD-1", "cover.jpg"), "wb") as f:
        f.write(b"\xff\xd8\xff\xe0JFIF")
    build_serato(root, [r for r in rels if not r.startswith("Engine Library/") and "Samples" not in r])
    dbp, tracks = build_engine(root)
    return {"root": root, "engine_db": dbp, "tracks": tracks}


if __name__ == "__main__":
    print(build(sys.argv[1]))
