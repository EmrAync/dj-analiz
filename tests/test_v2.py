"""v2 arka uç testleri (pytest gerekmez): python tests/test_v2.py [test_adı]"""
from __future__ import annotations

import json
import os
import shutil
import sqlite3
import sys
import tempfile
import traceback
import unicodedata

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "vendor"))
sys.path.insert(0, os.path.join(HERE, ".."))

import make_fixture  # noqa: E402

TMP = tempfile.mkdtemp(prefix="djd_v2_", dir=os.environ.get("DJD_TEST_BASE"))  # örn. exFAT bağlama noktası
os.environ["DJDOKTOR_HOME"] = os.path.join(TMP, "ws")
os.environ["HOME"] = os.path.join(TMP, "home")
os.makedirs(os.path.join(TMP, "home", "Music"), exist_ok=True)

from djdoktor import (dedupe, engine, inbox, journal, lists, maintain, mirror, names,  # noqa: E402
                      relocate, serato)
from djdoktor.config import Settings  # noqa: E402
from djdoktor.library import Library, UserError  # noqa: E402


def fresh(name):
    root = os.path.join(TMP, name, "SSD")
    if os.path.exists(os.path.dirname(root)):
        shutil.rmtree(os.path.dirname(root))
    fx = make_fixture.build(root)
    s = Settings()
    rec = s.add_library(root, name)
    lib = Library(s, rec)
    lib.full_scan()
    return lib, fx


def eng(lib, sql, args=()):
    con = sqlite3.connect(lib.engine_db()["path"])
    try:
        return con.execute(sql, args).fetchall()
    finally:
        con.close()


def disk(lib, rel):
    return os.path.exists(os.path.join(lib.root, *rel.split("/")))


def crate_paths(lib, name):
    p = os.path.join(lib.root, "_Serato_", "Subcrates", name + ".crate")
    return [unicodedata.normalize("NFC", x) for x in serato.read_crate_file(p)[0]]


def setup_default(lib):
    return relocate.setup_apply(lib, "Müzik")


# ---------------------------------------------------------------------------
def test_scan_and_state():
    lib, fx = fresh("scan")
    st = lib.engine_state()
    assert st["uuid"] == make_fixture.DB_UUID
    by_rel = {f["rel"]: f for f in lib.audio_files()}
    hus = by_rel["melis music/HALAYLAR/Hüseyin Ay - Çiftetelli Halay.mp3"]
    assert st["status"][hus["id"]] == "broken", st["status"].get(hus["id"])
    h1 = by_rel["melis music/HALAYLAR/Ali Kemal - Halay Başı.mp3"]
    assert st["status"][h1["id"]] == "ready"
    groups = dedupe.groups(lib)
    kinds = sorted(g["kind"] for g in groups)
    assert kinds.count("exact") >= 1 and kinds.count("audio") >= 1, kinds
    ov = lib.overview()
    assert ov["dupes"] >= 2 and ov["lib"]["setup_done"] is False, ov


def test_setup_apply_and_undo():
    lib, fx = fresh("setup")
    prev = relocate.setup_preview(lib, "Müzik")
    assert prev["moves"] > 5, prev
    assign = prev["assign"]
    assert assign["melis music/HALAYLAR"] == "g:Halay"
    assert assign["melis music/HORON"] == "g:Horon"
    assert assign["Samples MAO (kick,snare,clap,hat,noise,FX)"] == "ignore" or \
        assign.get("Samples MAO (kick,snare,clap,hat,noise,FX)/CLAPS") == "ignore", assign
    before_db = engine.semantic_fingerprint(lib.engine_db()["path"])
    res = setup_default(lib)
    assert res["moved"] >= 8, res
    assert disk(lib, "Müzik/Halay/Ali Kemal - Halay Başı.mp3")
    assert not disk(lib, "melis music/HALAYLAR/Ali Kemal - Halay Başı.mp3")
    assert disk(lib, "Müzik/Ankara/7-24 Yıldızlarla Ankara Vol. 2/CD-1/01 Ankara Havası.mp3"), os.listdir(
        os.path.join(lib.root, "Müzik"))
    assert disk(lib, "Müzik/Ankara/7-24 Yıldızlarla Ankara Vol. 2/CD-1/cover.jpg")  # kapak da gitti
    # Mac yardımcı dosyası şarkıyla birlikte taşındı
    assert disk(lib, "Müzik/Halay/._Sivas Halayı.mp3")
    # boşalan klasör kaldırıldı (.DS_Store karantinada)
    assert not disk(lib, "melis music/HORON")
    # Engine yolları güncel ve Prime 4 biçiminde (NFC)
    paths = {r[0] for r in eng(lib, "SELECT path FROM Track")}
    assert "../Müzik/Halay/Ali Kemal - Halay Başı.mp3" in paths, paths
    hus = [p for p in paths if "Çiftetelli" in p][0]
    assert hus == unicodedata.normalize("NFC", hus), "NFD yol onarılmadı"
    # Serato crate'i yeni yolu gösteriyor
    cp = crate_paths(lib, "Melis Program%%Halaylar")
    assert "Müzik/Halay/Ali Kemal - Halay Başı.mp3" in cp, cp
    # tür klasöründeki tüm şarkılar Engine'de (tek kez) + Analiz bekleyenler + Türler
    st = lib.engine_state(force=True)
    titles = [p["title"] for p in st["playlists"]]
    assert maintain.ANALYSIS_TITLE in titles and maintain.GENRES_TITLE in titles, titles
    states = lib.file_states()
    in_genre = [s for s in states.values() if s["place"] == "genre"]
    assert in_genre and all(s["es"] != "none" for s in in_genre if not s["bad"] and not (s["dup"] and not s["dup"]["keeper"])), \
        [(s["f"]["rel"], s["es"]) for s in in_genre]
    top = lib.catalog.journal_top()
    assert top and top["kind"] == "kurulum"
    # --- geri al
    journal.undo_last(lib)
    assert disk(lib, "melis music/HALAYLAR/Ali Kemal - Halay Başı.mp3")
    assert not disk(lib, "Müzik/Halay/Ali Kemal - Halay Başı.mp3")
    assert disk(lib, "melis music/HORON/.DS_Store")
    assert not lib.catalog.genres()
    paths = {r[0] for r in eng(lib, "SELECT path FROM Track")}
    assert "../melis music/HALAYLAR/Ali Kemal - Halay Başı.mp3" in paths
    cp = crate_paths(lib, "Melis Program%%Halaylar")
    assert "melis music/HALAYLAR/Ali Kemal - Halay Başı.mp3" in cp, cp
    n_tracks = eng(lib, "SELECT COUNT(*) FROM Track")[0][0]
    assert n_tracks == 8, n_tracks
    del before_db


def test_dedupe_merge_and_undo():
    lib, fx = fresh("dedupe")
    setup_default(lib)
    groups = [g for g in dedupe.groups(lib) if g["kind"] in ("exact", "audio", "engine")]
    assert groups, "çift yok"
    n_before = eng(lib, "SELECT COUNT(*) FROM Track")[0][0]
    res = dedupe.merge(lib, [{"group": g["id"]} for g in groups])
    assert res["files"] >= 2, res
    # Engine'de aynı şarkı bir kez
    halay = eng(lib, "SELECT id, path FROM Track WHERE title='Halay Başı'")
    assert len(halay) == 1, halay
    # aynı sesse analiz edilmiş Engine kaydı korunur ve tutulan dosyayı gösterir
    yolla = eng(lib, "SELECT path, isAnalyzed FROM Track WHERE title='Yolla'")
    assert yolla == [("../Müzik/Türkçe Pop/Tarkan - Yolla.mp3", 1)], yolla
    # notlu kopya (secilecek) Halay klasöründeki kopyanın YERİNE geçti: not kaybolmadı
    from mutagen.id3 import ID3
    t = ID3(os.path.join(lib.root, "Müzik", "Halay", "Grup Ateş - Delilo.mp3"))
    assert any("MIK 8A" in str(c) for c in t.getall("COMM")), t.getall("COMM")
    assert not disk(lib, "melis music/secilecek/Grup Ateş - Delilo (1).mp3")
    assert res.get("content_swaps") == 1, res
    # listedeki girişler tutulan kayda yönlendi
    st = lib.engine_state(force=True)
    h = next(p for p in st["playlists"] if p["path"] == ["Melis Program", "Halaylar"])
    assert len(h["refs"]) == len(set(h["refs"]))
    # fazla kopya karantinada, silinmedi
    q = os.path.join(lib.root, "_DJDoktor_", "Karantina")
    found = []
    for dp, dn, fn in os.walk(q):
        found += fn
    assert any("Halay Başı" in f for f in found), found
    journal.undo_last(lib)
    n_after = eng(lib, "SELECT COUNT(*) FROM Track")[0][0]
    assert n_after == n_before, (n_before, n_after)
    assert disk(lib, "melis music/secilecek/Grup Ateş - Delilo (1).mp3")
    t = ID3(os.path.join(lib.root, "Müzik", "Halay", "Grup Ateş - Delilo.mp3"))
    assert not t.getall("COMM"), t.getall("COMM")
    rows = {f["rel"] for f in lib.audio_files()}
    assert "Müzik/Halay/Grup Ateş - Delilo.mp3" in rows and "melis music/secilecek/Grup Ateş - Delilo (1).mp3" in rows


def test_lists_direct_edit_and_undo():
    lib, fx = fresh("lists")
    setup_default(lib)
    t = lists.tree(lib)
    dugun = next(x for x in t["lists"] if x["title"] == "Düğün 2024")
    ev = lists.new_event(lib, "Ahmet & Ayşe", date="2026-10-17", base=dugun["id"])
    t = lists.tree(lib)
    e = next(x for x in t["lists"] if x["id"] == ev["id"])
    assert e["title"] == "17.10.2026 - Ahmet & Ayşe" and e["n"] == 2, e
    assert e["path"][0] == lists.EVENTS_TITLE
    files = {f["rel"]: f["id"] for f in lib.audio_files()}
    fid = files["Müzik/Halay/Ali Kemal - Halay Başı.mp3"]
    r = lists.add(lib, ev["id"], fids=[fid], at=0)
    assert r["added"] == 1
    it = lists.items(lib, ev["id"])
    assert it["items"][0]["title"] == "Halay Başı", it["items"][0]
    r2 = lists.add(lib, ev["id"], fids=[fid])
    assert r2["added"] == 0  # aynı şarkı aynı listede iki kez olmaz
    refs = [x["ref"] for x in it["items"]]
    lists.reorder(lib, ev["id"], list(reversed(refs)))
    assert [x["ref"] for x in lists.items(lib, ev["id"])["items"]] == list(reversed(refs))
    journal.undo_last(lib)  # sıra
    assert [x["ref"] for x in lists.items(lib, ev["id"])["items"]] == refs
    lists.rename(lib, ev["id"], "Ahmet Ayşe Düğünü")
    lists.delete(lib, ev["id"])
    assert not any(x["id"] == ev["id"] for x in lists.tree(lib)["lists"])
    journal.undo_last(lib)  # silme geri
    t = lists.tree(lib)
    back = [x for x in t["lists"] if x["title"] == "Ahmet Ayşe Düğünü"]
    assert back and back[0]["n"] == 3, back
    # programın tuttuğu listeler elle düzenlenemez
    an = next(x for x in t["lists"] if x["kind"] == "analysis")
    try:
        lists.rename(lib, an["id"], "x")
        raise AssertionError("yönetilen liste değişti")
    except UserError as ex:
        assert ex.code == "managed"


def test_serato_mirror():
    lib, fx = fresh("mirror")
    setup_default(lib)
    t = lists.tree(lib)
    dugun = next(x for x in t["lists"] if x["title"] == "Düğün 2024")
    ev = lists.new_event(lib, "Test", template="kina")
    mirror.link(lib, ev["id"], True)
    t = lists.tree(lib)
    e = next(x for x in t["lists"] if x["id"] == ev["id"])
    assert e["serato"] and e["serato"]["crate"], e
    stem = e["serato"]["crate"]
    assert os.path.isfile(os.path.join(lib.root, "_Serato_", "Subcrates", stem + ".crate"))
    sec = next(x for x in t["lists"] if x["parent"] == ev["id"] and x["title"] == "Halay")
    files = {f["rel"]: f["id"] for f in lib.audio_files()}
    lists.add(lib, sec["id"], fids=[files["Müzik/Halay/Grup Ateş - Delilo.mp3"]])
    sec_crate = next(x for x in lists.tree(lib)["lists"] if x["id"] == sec["id"])["serato"]["crate"]
    cp = crate_paths(lib, sec_crate)
    assert cp == ["Müzik/Halay/Grup Ateş - Delilo.mp3"], cp
    # Serato'da değişiklik -> Engine'e alınır
    p = os.path.join(lib.root, "_Serato_", "Subcrates", sec_crate + ".crate")
    with open(p, "wb") as f:
        f.write(serato.build_crate([make_fixture.mac_form("Müzik/Halay/Grup Ateş - Delilo.mp3"),
                                    make_fixture.mac_form("Müzik/Halay/Sivas Halayı.mp3")]))
    r = mirror.background(lib)
    assert r and r.get("pulled") == 1, r
    it = lists.items(lib, sec["id"])
    assert [x["title"] for x in it["items"]] == ["Delilo", "Sivas Halayı"], it["items"]
    # Serato'dan crate al
    res = mirror.import_crates(lib, ["Melis Program%%Oyun Havaları"])
    assert res["lists"] == 1
    del dugun


def test_rename_genre_and_move():
    lib, fx = fresh("rename")
    setup_default(lib)
    g = next(g for g in lib.genre_rows() if g["name"] == "Halay")
    relocate.genre_rename(lib, g["id"], "Halaylar")
    assert disk(lib, "Müzik/Halaylar/Sivas Halayı.mp3")
    paths = {r[0] for r in eng(lib, "SELECT path FROM Track")}
    assert "../Müzik/Halaylar/Sivas Halayı.mp3" in paths, paths
    t = lists.tree(lib)
    assert any(x["title"] == "Halaylar" and x["kind"] == "genre" for x in t["lists"]), [x["title"] for x in t["lists"]]
    journal.undo_last(lib)
    assert disk(lib, "Müzik/Halay/Sivas Halayı.mp3")
    # türü belli olmayanı türüne taşı
    states = lib.file_states()
    uns = [s["f"] for s in states.values() if s["place"] == "unsorted"]
    assert uns, "türü belli olmayan yok"
    target = next(f for f in uns if "Özel Giriş" in f["name"])
    gg = relocate.genre_create(lib, "Giriş - Pasta - Özel")
    relocate.move_to_genre(lib, [target["id"]], gg)
    assert disk(lib, "Müzik/Giriş - Pasta - Özel/Özel Giriş Müziği.mp3")
    st = lib.engine_state(force=True)
    assert st["status"].get(target["id"]) == "pending"
    journal.undo_last(lib)
    assert disk(lib, "Dj Özlem/Özel Giriş Müziği.mp3")
    st = lib.engine_state(force=True)
    assert st["status"].get(target["id"]) is None, st["status"].get(target["id"])


def test_scan_while_moving():
    """Tarama kilitsiz yürür: tarama sürerken taşınan dosya ne kaybolur ne de iki kez görünür."""
    import threading as _th
    lib, fx = fresh("scanmove")
    setup_default(lib)
    files = {f["rel"]: f for f in lib.audio_files()}
    target = files["Müzik/Horon/Karadeniz Horon 2.mp3"]
    # birkaç dosyanın zamanını değiştir: tarama onları yeniden okusun (okuma döngüsüne girsin)
    for rel in ("Müzik/Halay/Sivas Halayı.mp3", "Müzik/Türkçe Pop/Sezen Aksu - Firuze.mp3"):
        os.utime(os.path.join(lib.root, *rel.split("/")), (1, 1700000123))
    fired = {"n": 0, "blocked": None}

    def progress(r, msg=None):
        if fired["n"] == 0 and msg and "okundu" in msg:
            fired["n"] = 1
            # taşıma, taramanın kilidi tutmadığını gösterir: başka bir iş parçacığı kilidi hemen alabilmeli
            got = []
            th = _th.Thread(target=lambda: got.append(lib.lock.acquire(timeout=2)) or lib.lock.release())
            th.start()
            th.join()
            fired["blocked"] = not (got and got[0])
            relocate.move_files(lib, {target["id"]: "Müzik/Halay/Karadeniz Horon 2.mp3"}, "test taşıma")
    res = lib.full_scan(progress)
    assert fired["n"] == 1 and fired["blocked"] is False, fired
    assert res.get("rewalked"), res
    rows = lib.catalog.q("SELECT id, rel, present FROM files WHERE name LIKE 'Karadeniz Horon 2%'")
    present = [r for r in rows if r["present"]]
    assert len(present) == 1 and present[0]["id"] == target["id"], rows
    assert present[0]["rel"] == "Müzik/Halay/Karadeniz Horon 2.mp3", rows
    assert disk(lib, "Müzik/Halay/Karadeniz Horon 2.mp3")
    # yeniden okunan dosyalar güncel, yinelenen satır yok
    rels = [f["rel"] for f in lib.audio_files()]
    assert len(rels) == len(set(rels))
    # ikinci tarama değişiklik bulmaz
    res2 = lib.full_scan()
    assert not res2.get("read") and not res2.get("gone") and not res2.get("rewalked"), res2


def test_health_fixes_and_undo():
    """Araçlar > Sağlık: çöp dosyalar, sorunlu adlar, Engine'de dosyası olmayan kayıtlar — hepsi geri alınabilir."""
    from djdoktor import health
    lib, fx = fresh("health")
    setup_default(lib)
    # sorunlu adlar: Mac'in özel karakteri (':' -> U+F022) olan klasör, '?' olan dosya, ayrık (NFD) Türkçe harf
    bad_dir = os.path.join(lib.root, "Müzik", "Halay", "ROMAN  MEZDEKE")
    make_fixture.write_mp3(os.path.join(bad_dir, "Roman 1.mp3"), 501, 150, "Roman 1", "R")
    make_fixture.write_mp3(os.path.join(lib.root, "Müzik", "Halay", "Soru.mp3"), 502, 150, "Soru", "S")
    nfd = unicodedata.normalize("NFD", "Güzel Halay.mp3")
    make_fixture.write_mp3(os.path.join(lib.root, "Müzik", "Halay", nfd), 503, 150, "Güzel Halay", "G")
    lib.full_scan()
    maintain.after_change(lib)
    s = {c["key"]: c for c in health.summary(lib)["categories"]}
    assert s["names"]["count"] >= 3, s["names"]
    assert s["junk"]["count"] >= 1, s["junk"]
    assert s["missing"]["count"] >= 1, s["missing"]
    n_tracks = eng(lib, "SELECT COUNT(*) FROM Track")[0][0]
    # 1) ad düzeltme: dosyalar ve klasör, Engine yolları birlikte
    r = health.fix_names(lib)
    assert r["renamed"] >= 3, r
    assert disk(lib, "Müzik/Halay/ROMAN - MEZDEKE/Roman 1.mp3"), os.listdir(os.path.join(lib.root, "Müzik", "Halay"))
    assert disk(lib, "Müzik/Halay/Soru.mp3")
    assert "Güzel Halay.mp3" in os.listdir(os.path.join(lib.root, "Müzik", "Halay"))
    paths = {r_[0] for r_ in eng(lib, "SELECT path FROM Track")}
    assert "../Müzik/Halay/ROMAN - MEZDEKE/Roman 1.mp3" in paths, [p for p in paths if "Roman" in p]
    assert next(c for c in health.summary(lib)["categories"] if c["key"] == "names")["count"] == 0
    journal.undo_last(lib)
    assert os.path.isdir(bad_dir) and disk(lib, "Müzik/Halay/Soru.mp3")
    assert nfd in os.listdir(os.path.join(lib.root, "Müzik", "Halay"))
    # 2) çöp dosyalar karantinaya (silinmez), geri alınca yerine
    r = health.fix_junk(lib)
    assert r["moved"] >= 1 and not disk(lib, "Müzik/Halay/._Sivas Halayı.mp3"), r
    journal.undo_last(lib)
    assert disk(lib, "Müzik/Halay/._Sivas Halayı.mp3")
    # 3) dosyası olmayan Engine kaydı: koleksiyondan ve listelerden kalkar, geri alınca döner
    before = eng(lib, "SELECT COUNT(*) FROM Track")[0][0]
    r = health.remove_missing(lib)
    assert r["removed"] >= 1, r
    assert eng(lib, "SELECT COUNT(*) FROM Track WHERE path LIKE '%Silinen%'") == [(0,)]
    journal.undo_last(lib)
    assert eng(lib, "SELECT COUNT(*) FROM Track")[0][0] == before
    del n_tracks


def test_events_and_exports():
    """Bölüm önerileri, etkinlik öncesi kontrol, rekordbox XML / M3U8 / CSV."""
    from xml.etree import ElementTree as ET
    from djdoktor import events, exporters
    lib, fx = fresh("events")
    setup_default(lib)
    ev = lists.new_event(lib, "Düğün", template="dugun")
    t = lists.tree(lib)
    sec = next(x for x in t["lists"] if x["parent"] == ev["id"] and x["title"] == "Halay")
    sug = events.suggest(lib, sec["id"])
    assert sug["genre"] == "Halay" and sug["items"], sug
    assert all(i["genre"] in ("Halay", "Kürtçe Halay", None) or "halay" in names.fold(i["why"]) for i in sug["items"]), sug
    first = sug["items"][0]["id"]
    lists.add(lib, sec["id"], fids=[first])
    sug2 = events.suggest(lib, sec["id"])
    assert first not in [i["id"] for i in sug2["items"]]          # listedeki tekrar önerilmez
    gc = events.gig_check(lib, ev["id"])
    assert gc["tracks"] == 1 and gc["status"] in ("uyari", "tamam", "kritik"), gc
    assert any(c["title"].endswith("analiz edilmemiş") for c in gc["checks"]) or gc["status"] == "tamam", gc
    files = {f["rel"]: f["id"] for f in lib.audio_files()}
    comp = events.compatible(lib, files["Müzik/Halay/Ali Kemal - Halay Başı.mp3"])
    assert isinstance(comp, list)
    det = lib.track_detail(first)
    assert det["file"]["id"] == first and "compatible" in det and "issues" in det
    # dışa aktarma
    x = exporters.rekordbox_xml(lib, "genres")
    root = ET.parse(x["path"]).getroot()
    assert root.find("COLLECTION") is not None and int(root.find("COLLECTION").get("Entries")) >= 8, x
    x2 = exporters.rekordbox_xml(lib, "list:%d" % ev["id"])
    assert x2["tracks"] == 1
    m = exporters.m3u(lib, "lists")
    assert m["files"] >= 1 and os.listdir(m["dir"])
    c = exporters.library_csv(lib)
    with open(c["path"], encoding="utf-8-sig") as fh:
        head = fh.readline()
    assert head.startswith("Başlık;Sanatçı") and c["rows"] >= 8, (head, c)
    tab = lib.library_table()
    assert tab["rows"] and len(tab["rows"][0]) == len(tab["cols"])


def test_inbox():
    lib, fx = fresh("inbox")
    setup_default(lib)
    ib, ar = inbox.ensure_dirs(lib)
    assert os.path.isdir(os.path.join(ib, "Halay"))
    make_fixture.write_mp3(os.path.join(ib, "Halay", "Yeni Halay (Official Video).mp3"), 101, 150, "Yeni Halay", "X")
    make_fixture.write_mp3(os.path.join(ib, "Horon", "Karadeniz Horon 1.mp3"), 5, 155, "Horon 1", "Kemençe Ekibi")
    make_fixture.write_mp3(os.path.join(ib, "Bilinmeyen.mp3"), 102, 150, "Bilinmeyen", "Y")
    for dp, dn, fn in os.walk(ib):
        for f in fn:
            os.utime(os.path.join(dp, f), (1, 1700000000))
    s = inbox.scan(lib)
    st = {os.path.basename(i["path"]): i["status"] for i in s["items"]}
    assert st["Yeni Halay (Official Video).mp3"] == "new", st
    assert st["Karadeniz Horon 1.mp3"] == "exists", st
    assert st["Bilinmeyen.mp3"] == "nogenre", st
    r = inbox.auto_tick(lib)
    assert r and r.get("added") == 1 and r.get("archived") == 1, r
    assert disk(lib, "Müzik/Halay/Yeni Halay.mp3"), os.listdir(os.path.join(lib.root, "Müzik", "Halay"))
    tr = eng(lib, "SELECT isAnalyzed FROM Track WHERE path=?", ("../Müzik/Halay/Yeni Halay.mp3",))
    assert tr == [(0,)], tr
    st2 = lib.engine_state(force=True)
    an = next(p for p in st2["playlists"] if p["title"] == maintain.ANALYSIS_TITLE)
    tid = eng(lib, "SELECT id FROM Track WHERE path=?", ("../Müzik/Halay/Yeni Halay.mp3",))[0][0]
    assert tid in an["entries"]
    arch = [f for dp, dn, fn in os.walk(ar) for f in fn]
    assert "Yeni Halay (Official Video).mp3" in arch, arch
    # geri al: önce "zaten vardı" arşivlemesi, sonra ekleme
    top = lib.catalog.journal_top()
    assert top["title"].startswith("Zaten vardı"), top["title"]
    journal.undo_last(lib)
    assert os.path.isfile(os.path.join(ib, "Horon", "Karadeniz Horon 1.mp3"))
    # SSD kopyası karantinaya, orijinal gelen kutusuna (bekletilir)
    journal.undo_last(lib)
    assert not disk(lib, "Müzik/Halay/Yeni Halay.mp3")
    assert os.path.isfile(os.path.join(ib, "Halay", "Yeni Halay (Official Video).mp3"))
    assert not eng(lib, "SELECT id FROM Track WHERE path=?", ("../Müzik/Halay/Yeni Halay.mp3",))
    s = inbox.scan(lib)
    st = {os.path.basename(i["path"]): i["status"] for i in s["items"]}
    assert st["Yeni Halay (Official Video).mp3"] == "held", st
    assert st["Karadeniz Horon 1.mp3"] == "held", st
    r = inbox.auto_tick(lib)
    assert not r or not r.get("added"), r
    # kullanıcı isterse bekletileni ekler
    r = inbox.ingest(lib, [{"path": os.path.join(ib, "Halay", "Yeni Halay (Official Video).mp3")}])
    assert r["added"] == 1, r
    assert disk(lib, "Müzik/Halay/Yeni Halay.mp3")


def test_engine_open_guard():
    lib, fx = fresh("guard")
    setup_default(lib)
    import djdoktor.engine as E
    orig = E.is_running
    E.is_running = lambda *a, **k: True
    try:
        try:
            lists.create(lib, 0, "x")
            raise AssertionError("Engine açıkken yazdı")
        except UserError as e:
            assert e.code == "engine_open"
        r = maintain.run(lib)
        assert r.get("skipped") == "engine_open"
        # gelen kutusu Engine kapanana kadar bekler (kopya + Engine kaydı tek işlem kalsın)
        ib, _ar = inbox.ensure_dirs(lib)
        p = os.path.join(ib, "Halay", "Bekleyen Halay.mp3")
        make_fixture.write_mp3(p, 103, 150, "Bekleyen Halay", "W")
        os.utime(p, (1, 1700000000))
        r = inbox.auto_tick(lib)
        assert not r or not r.get("added"), r
        assert os.path.isfile(p) and not disk(lib, "Müzik/Halay/Bekleyen Halay.mp3")
        try:
            inbox.ingest(lib, [{"path": p}])
            raise AssertionError("Engine açıkken gelen eklendi")
        except UserError as e:
            assert e.code == "engine_open"
    finally:
        E.is_running = orig
    r = inbox.auto_tick(lib)   # Engine kapandı: şimdi eklenir
    assert r and r.get("added") == 1, r
    assert disk(lib, "Müzik/Halay/Bekleyen Halay.mp3")


def test_wrong_drive_cancel():
    """Yanlış sürücü seçildi: ilk tarama ✕ ile durdurulunca seçim geri alınır, sürücüde iz kalmaz.
    Önceden taranmış bir SSD'de durdurmak ise yalnızca taramayı durdurur."""
    import time as _t
    from djdoktor import server, util
    from djdoktor.tasks import TaskManager
    app = server.App()
    for rec in app.settings.libraries():
        app.settings.remove_library(rec["id"])
    wrong = os.path.join(TMP, "yanlis_disk")
    os.makedirs(os.path.join(wrong, "Belgeler"), exist_ok=True)
    for i in range(30):
        make_fixture.write_mp3(os.path.join(wrong, "Belgeler", "ses %02d.mp3" % i), 300 + i, 120, "Ses %d" % i, "X")
    app.settings.add_library(wrong, "Yanlış")
    lib = app.lib()
    assert os.path.isfile(os.path.join(wrong, "_DJDoktor_", "katalog.db"))
    tok = app.sel_tokens[lib.id] = object()
    res = server._scan_task(app, lib, tok)(lambda r, m=None: None, lambda: True)
    assert res.get("cancelled") and res.get("forgotten"), res
    assert not app.settings.libraries(), app.settings.libraries()
    assert not os.path.exists(os.path.join(wrong, "_DJDoktor_")), os.listdir(wrong)
    assert sorted(os.listdir(os.path.join(wrong, "Belgeler")))[0] == "ses 00.mp3"   # kullanıcı dosyalarına dokunulmadı
    # görev yöneticisi üzerinden: çalışan tarama durdurulur, durum 'iptal'
    tm = TaskManager()
    def slow(progress, cancel):
        for _ in range(400):
            if cancel():
                return {"cancelled": True}
            _t.sleep(0.01)
        return {"ok": True}
    tid = tm.submit("scan", "SSD taranıyor", slow)
    _t.sleep(0.05)
    assert tm.get(tid)["cancellable"]
    assert tm.cancel(tid)
    for _ in range(100):
        if tm.get(tid)["status"] != "calisiyor":
            break
        _t.sleep(0.02)
    assert tm.get(tid)["status"] == "iptal", tm.get(tid)
    # taranmamış görev türleri durdurulamaz (yazan işler yarıda kesilmez)
    tid2 = tm.submit("kurulum", "Düzen kuruluyor", lambda p, c: {"ok": True})
    assert not tm.cancel(tid2)
    # önceden taranmış SSD: durdurmak seçimi geri ALMAZ
    lib2, _fx = fresh("cancel_ok")
    app.settings.add_library(lib2.root, "SSD")
    lib2b = app.lib()
    tok2 = app.sel_tokens[lib2b.id] = object()
    res2 = server._scan_task(app, lib2b, tok2)(lambda r, m=None: None, lambda: True)
    assert res2.get("cancelled") and not res2.get("forgotten"), res2
    assert any(r["root"] == lib2.root for r in app.settings.libraries())
    assert os.path.isfile(os.path.join(lib2.root, "_DJDoktor_", "katalog.db"))
    # sistem diskinin kökü kütüphane olamaz; 2.0.0'dan kalan böyle bir kayıt kendiliğinden unutulur
    assert util.is_system_root("/") and not util.is_system_root(lib2.root)
    app.reset_lib()
    app.settings.data["libraries"].append({"id": "sistem-x", "name": "System", "root": "/",
                                          "catalog": os.path.join("/", "_DJDoktor_", "katalog.db"), "v": 2})
    app.settings.set_active("sistem-x")
    l3 = app.lib(required=False)
    assert l3 is None or l3.root != "/", l3
    assert not any(r["id"] == "sistem-x" for r in app.settings.libraries())
    # 2.0.0'da sistem diski (C:\) seçilip takılmış hâl: açılışta seçim geri alınır, kendi kataloğu kaldırılır
    fakec = os.path.join(TMP, "sahte_C")
    os.makedirs(os.path.join(fakec, "Windows"), exist_ok=True)
    app.settings.add_library(fakec, "System")
    app.lib()                                   # katalog oluşur: sahte_C/_DJDoktor_/katalog.db
    app.reset_lib()
    keep = os.path.join(TMP, "sahte_D")         # içinde başka şey olan _DJDoktor_ asla silinmez
    os.makedirs(os.path.join(keep, "_DJDoktor_", "Yedekler"), exist_ok=True)
    assert server._remove_fresh_state(keep) is False and os.path.isdir(os.path.join(keep, "_DJDoktor_", "Yedekler"))
    orig = util.is_system_root
    util.is_system_root = lambda p: os.path.abspath(p) == os.path.abspath(fakec) or orig(p)
    try:
        app2 = server.App()
        assert app2.lib(required=False) is None or app2.lib(required=False).root != fakec
        assert not any(r["root"] == fakec for r in app2.settings.libraries()), app2.settings.libraries()
        assert not os.path.exists(os.path.join(fakec, "_DJDoktor_")), os.listdir(fakec)
        assert os.path.isdir(os.path.join(fakec, "Windows"))
    finally:
        util.is_system_root = orig


TESTS = [v for k, v in sorted(globals().items()) if k.startswith("test_")]

if __name__ == "__main__":
    only = sys.argv[1:]
    ok = fail = 0
    for t in TESTS:
        if only and t.__name__ not in only:
            continue
        try:
            t()
            print("OK   ", t.__name__)
            ok += 1
        except Exception:
            print("FAIL ", t.__name__)
            traceback.print_exc()
            fail += 1
    print("%d geçti, %d başarısız  (%s)" % (ok, fail, TMP))
    sys.exit(1 if fail else 0)
