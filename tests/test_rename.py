"""Adlar + kayıp yol bağlama testleri (pytest gerekmez): python tests/test_rename.py [test_adı ...]

exFAT'te de çalıştırın: DJD_TEST_BASE=/mnt/exfat/tmp python3 -B tests/test_rename.py
"""
from __future__ import annotations

import hashlib
import os
import shutil
import sqlite3
import sys
import tempfile
import time
import traceback
import unicodedata

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "vendor"))
sys.path.insert(0, os.path.join(HERE, ".."))

import make_fixture  # noqa: E402

TMP = tempfile.mkdtemp(prefix="djd_rn_", dir=os.environ.get("DJD_TEST_BASE"))
os.environ["DJDOKTOR_HOME"] = os.path.join(TMP, "ws")
os.environ["HOME"] = os.path.join(TMP, "home")
os.makedirs(os.path.join(TMP, "home", "Music"), exist_ok=True)

from djdoktor import (engine, inbox, journal, lists, maintain, mirror, relink, relocate,  # noqa: E402
                      renamer, serato, util)
from djdoktor.config import Settings  # noqa: E402
from djdoktor.library import Library, UserError  # noqa: E402

NFD = make_fixture.mac_form


def fresh(name, setup=True):
    root = os.path.join(TMP, name, "SSD")
    if os.path.exists(os.path.dirname(root)):
        shutil.rmtree(os.path.dirname(root))
    make_fixture.build(root)
    s = Settings()
    rec = s.add_library(root, name)
    lib = Library(s, rec)
    lib.full_scan()
    if setup:
        relocate.setup_apply(lib, "Müzik")
    return lib


def eng(lib, sql, args=()):
    con = sqlite3.connect(lib.engine_db()["path"])
    try:
        return con.execute(sql, args).fetchall()
    finally:
        con.close()


def sdir(lib):
    return os.path.join(lib.root, "_Serato_")


def crates(lib):
    return {c["name"]: c["tracks"] for c in serato.read_crates(sdir(lib))}


def dbv2(lib):
    return [t.get("pfil") for t in serato.read_database(sdir(lib))["tracks"]]


def on_disk(lib, raw):
    """Serato / Engine ham yolu diskte var mı? (Linux bayt karşılaştırır: NFC ve NFD biçimini de dene)"""
    for form in (raw, unicodedata.normalize("NFC", raw)):
        if os.path.exists(os.path.join(lib.root, *form.split("/"))):
            return True
    return False


def broken(lib):
    """(bozuk crate kayıtları, bozuk database V2 yolları, Engine'de kayıp kayıtlar — fixture'daki silinen hariç)"""
    bc = [(k, p) for k, v in crates(lib).items() for p in v if not on_disk(lib, p)]
    bd = [p for p in dbv2(lib) if not on_disk(lib, p)]
    st = lib.engine_state(force=True)
    bo = [o[1] for o in st["orphans"] if o[2] in ("missing", "nodir") and "Silinen" not in (o[1] or "")
          and not on_disk(lib, o[1])]                   # taranmamış ama diskte olan dosya bozuk sayılmaz
    return bc, bd, bo


def tree(root):
    out = []
    for dp, dns, fns in os.walk(root):
        rel = os.path.relpath(dp, root)
        if rel.split(os.sep)[0] in ("_DJDoktor_", "_Serato_"):
            continue
        out += [os.path.join(rel, n) for n in fns] + [os.path.join(rel, n) + "/" for n in dns]
    return sorted(out)


def serato_bytes(root):
    h = hashlib.md5()
    sd = os.path.join(root, "_Serato_")
    for dp, dns, fns in os.walk(sd):
        dns.sort()
        for n in sorted(fns):
            h.update(os.path.relpath(os.path.join(dp, n), sd).encode("utf-8", "surrogateescape"))
            with open(os.path.join(dp, n), "rb") as f:
                h.update(f.read())
    return h.hexdigest()


def snapshot(lib):
    return (tree(lib.root), serato_bytes(lib.root), engine.semantic_fingerprint(lib.engine_db()["path"]),
            sorted((g["rel"], g["color"]) for g in lib.catalog.genres()), sorted(lib.catalog.folder_rules().items()),
            lib.music_root())


def engine_core(lib):
    """Engine'in kullanıcıya ait kısmı: parçalar (yol, analiz) ve programın tutmadığı listelerin içeriği
    (Analiz bekleyenler / Türler her bakımda yeniden hesaplanır, geri alma kaydına girmez)."""
    st = lib.engine_state(force=True)
    mg = maintain.managed_ids(lib, st["uuid"])
    mg |= {p["id"] for p in st["playlists"] for m in list(mg) if p["parent"] == m}
    tr = sorted((t["id"], t["path"], t["isAnalyzed"]) for t in st["tracks"].values())
    pls = sorted((tuple(p["path"]), tuple(map(tuple, p["refs"]))) for p in st["playlists"] if p["id"] not in mg)
    return tr, pls


def nbackups(lib):
    return (len(os.listdir(lib.backup_dir("engine"))), len(os.listdir(lib.backup_dir("serato"))))


def append_db(lib, rels, tlen="00:04.00"):
    p = os.path.join(sdir(lib), "database V2")
    items, tail = serato.parse(open(p, "rb").read())
    for r in rels:
        items.append((b"otrk", serato.serialize([(b"ttyp", serato.u16("mp3")), (b"pfil", serato.u16(r)),
                                                 (b"tlen", serato.u16(tlen))])))
    with open(p, "wb") as f:
        f.write(serato.serialize(items, tail))


def write_crate(lib, name, raws):
    with open(os.path.join(sdir(lib), "Subcrates", name + ".crate"), "wb") as f:
        f.write(serato.build_crate(raws))


def fid_of(lib, rel):
    r = lib.catalog.file_by_rel(rel)
    assert r and r["present"], rel
    return r["id"]


class FakeProcs:
    """Engine DJ / Serato 'açık' gibi davranır (util.process_running yerine)."""

    def __init__(self, procs):
        self.procs = set(procs)

    def __enter__(self):
        self.orig = util.process_running
        util.process_running = lambda names_, fresh=False: [n for n in names_ if n in self.procs]
        return self

    def __exit__(self, *a):
        util.process_running = self.orig


# ---------------------------------------------------------------------------
def test_transform_rules():
    r = renamer.normalize_rules(preset="engine_safe")
    T = lambda n, f=True, rr=r: renamer.transform(n, f, rr)  # noqa: E731
    assert T("TÜRKÜ Şöleni.mp3")[0] == "TURKU Soleni.mp3"
    assert T("IBRAHIM TATLISES - Ağlama.mp3")[0] == "IBRAHIM TATLISES - Aglama.mp3"
    new, why = T(NFD("Gönül Dağı.mp3"))
    assert new == "Gonul Dagi.mp3" and "nfc" in why and "tr" in why, (new, why)
    assert T("Âşık Veysel - İnce.mp3")[0] == "Asik Veysel - Ince.mp3"
    assert T("ROMAN  MEZDEKE", False)[0] == "ROMAN - MEZDEKE"          # Mac'in ':' karakteri
    assert T("Tarkan：Yolla.mp3")[0] == "Tarkan - Yolla.mp3"              # tam genişlikli ':' çeviriden SONRA
    assert T("Çon.mp3")[0] == "Con_.mp3"                                       # Windows'ta ayrılmış ad
    assert T("Ayten Alpman – Bir Başkadır.mp3")[0] == "Ayten Alpman - Bir Baskadir.mp3"
    new, why = T("Хорон.mp3")
    assert new == "Хорон.mp3" and why == ["non_ascii"], (new, why)
    assert T("Halay 🔥🔥.mp3")[0] == "Halay.mp3"
    assert T("🔥.mp3") == ("🔥.mp3", ["empty"])                                # boş kalacaksa 'adsiz' uydurulmaz
    assert T("Grup Ateş - Delilo (1).mp3")[0] == "Grup Ates - Delilo (1).mp3"  # '(1)' kopya ipucu: dokunulmaz
    assert T("Pop yeni 10.04.", False)[0] == "Pop yeni 10.04"
    tidy = renamer.normalize_rules(preset="tidy")
    assert renamer.transform("Tarkan - Yolla (Official Audio) [4K].mp3", True, tidy)[0] == "Tarkan - Yolla.mp3"
    assert renamer.transform("y2mate.com - Tarkan_Yolla (Lyrics).MP3", True, tidy)[0] == "Tarkan Yolla.mp3"
    for keep in ("Audio Bullys.mp3", "Copy Cat.mp3", "Lyrics Of Life.mp3"):
        assert renamer.transform(keep, True, tidy)[0] == keep, keep
    # Türkçe büyük / küçük harf
    assert renamer.tr_case("ışık istanbul", "upper") == "IŞIK İSTANBUL"
    assert renamer.tr_case("IŞIK İSTANBUL", "lower") == "ışık istanbul"
    assert renamer.tr_case("GEL'İN ışık DJ feat. MC", "title") == "Gel'in Işık DJ feat. MC"
    assert renamer.tr_case("TARKAN - SEN VE BEN", "title") == "Tarkan - Sen Ve Ben"
    assert renamer.tr_case("istanbul", "upper", "en") == "ISTANBUL"
    # bul / değiştir
    rr = renamer.normalize_rules({"replace": [{"find": r"(\w+) - (\w+)", "to": r"\2 - \1", "regex": True}]},
                                 "only_illegal")
    assert renamer.transform("Tarkan - Yolla.mp3", True, rr)[0] == "Yolla - Tarkan.mp3"
    for bad, code in (("(a+)+", "regex_risky"), ("(a", "bad_regex")):
        try:
            renamer.normalize_rules({"replace": [{"find": bad, "to": "", "regex": True}]})
            raise AssertionError("kabul edildi: " + bad)
        except UserError as e:
            assert e.code == code, (bad, e.code)
    # yalnızca sorunlu: Türkçe harf ve çift boşluk kalır, NFD -> NFC
    oi = renamer.normalize_rules(preset="only_illegal")
    assert renamer.transform("OYUN HAVASI  karisik", False, oi)[0] == "OYUN HAVASI  karisik"
    assert renamer.transform(NFD("Güzel Halay.mp3"), True, oi)[0] == "Güzel Halay.mp3"
    assert renamer.transform("Soru.mp3", True, oi)[0] == "Soru.mp3"


def test_plan_conflicts():
    lib = fresh("plan")
    h = os.path.join(lib.root, "Müzik", "Halay")
    make_fixture.write_mp3(os.path.join(h, "Türkü.mp3"), 601, 20, "Türkü", "A")
    make_fixture.write_mp3(os.path.join(h, "Turku.mp3"), 602, 20, "Turku", "B")          # 'exists'
    make_fixture.write_mp3(os.path.join(h, "Şiir.mp3"), 603, 20, "Şiir", "C")
    make_fixture.write_mp3(os.path.join(h, "ŞİİR.mp3"), 604, 20, "ŞİİR", "D")            # ikisi de 'Siir' -> 'twin'
    make_fixture.write_mp3(os.path.join(h, "Gönül.mp3"), 605, 20, "Gönül", "E")
    make_fixture.write_mp3(os.path.join(h, "Gonul.mp3"), 605, 20, "Gönül", "E")          # aynı ses -> 'same_audio'
    make_fixture.write_mp3(os.path.join(h, NFD("Güzel.mp3")), 606, 20, "Güzel", "F")     # yalnızca NFD -> NFC
    make_fixture.write_mp3(os.path.join(h, "Türküler", "a.mp3"), 607, 20, "a", "G")
    make_fixture.write_mp3(os.path.join(h, "Turkuler", "b.mp3"), 608, 20, "b", "H")      # klasör 'exists'
    make_fixture.write_mp3(os.path.join(h, "Yöre", "Çay.mp3"), 609, 20, "Çay", "I")      # klasör içinde dosya
    make_fixture.write_mp3(os.path.join(lib.root, ".gizli", "Gizli Şarkı.mp3"), 610, 20, "x", "y")
    make_fixture.write_mp3(os.path.join(lib.root, "Samples MAO (kick,snare,clap,hat,noise,FX)", "Çıt.mp3"), 611, 20)
    lib.full_scan()
    pl = renamer.plan(lib, preset="engine_safe")
    by = {x["rel"]: x for x in pl["items"]}
    st = lambda rel: (by[rel]["status"], by[rel]["conflict"])  # noqa: E731
    assert st("Müzik/Halay/Türkü.mp3") == ("conflict", "exists"), by["Müzik/Halay/Türkü.mp3"]
    assert by["Müzik/Halay/Türkü.mp3"]["with"] == "Müzik/Halay/Turku.mp3"
    assert st("Müzik/Halay/Şiir.mp3") == ("conflict", "twin") and st("Müzik/Halay/ŞİİR.mp3") == ("conflict", "twin")
    assert st("Müzik/Halay/Gönül.mp3") == ("conflict", "same_audio"), by["Müzik/Halay/Gönül.mp3"]
    assert st("Müzik/Halay/Türküler") == ("conflict", "exists")
    assert by["Müzik/Halay/Yöre/Çay.mp3"]["new_rel"] == "Muzik/Halay/Yore/Cay.mp3", by["Müzik/Halay/Yöre/Çay.mp3"]
    assert not any(x["rel"].startswith((".gizli", "_Serato_", "Engine Library", "_DJDoktor_", "Samples"))
                   for x in pl["items"]), [x["rel"] for x in pl["items"]]
    pl2 = renamer.plan(lib, preset="engine_safe", scope={"kind": "all", "include_ignored": True})
    assert any(x["rel"].endswith("Çıt.mp3") for x in pl2["items"])
    # yalnızca sorunlu karakterler: NFD -> NFC tek başına 'ok'
    oi = renamer.plan(lib, preset="only_illegal")
    nf = [x for x in oi["items"] if x["kind"] == "file" and x["old"] == "Güzel.mp3"]
    assert nf and nf[0]["status"] == "ok" and "nfc" in nf[0]["reasons"], oi["items"]
    # yalnızca büyük / küçük harf değişen ad çakışma sayılmaz (exFAT'te aynı kayıt)
    up = renamer.plan(lib, {"turkish_ascii": False, "accents": False, "case": "upper"},
                      {"kind": "folder", "rel": "Müzik/Horon"})
    assert up["items"] and all(x["status"] == "ok" for x in up["items"]), up["items"]
    # tür klasörü başka bir türle aynı ada düşmesin
    lib.catalog.genre_add("Müzik/Halay/Turkuler")
    g = renamer.plan(lib, preset="engine_safe", scope={"kind": "folder", "rel": "Müzik/Türkçe Pop"})
    gi = [x for x in g["items"] if x["rel"] == "Müzik/Türkçe Pop"]
    assert gi and gi[0]["genre"], g["items"]
    lib.catalog.genre_add("Müzik/Halay/Turkce Pop")
    g = renamer.plan(lib, preset="engine_safe", scope={"kind": "folder", "rel": "Müzik/Türkçe Pop"})
    gi = [x for x in g["items"] if x["rel"] == "Müzik/Türkçe Pop"][0]
    assert gi["conflict"] == "genre_twin", gi
    # önizleme eskidi: arada disk değişti -> 'stale', hiçbir şey değişmez
    tok = pl["token"]
    make_fixture.write_mp3(os.path.join(h, "Siir.mp3"), 612, 20, "x", "y")
    before = tree(lib.root)
    try:
        renamer.apply(lib, preset="engine_safe", token=tok)
        raise AssertionError("eski önizleme uygulandı")
    except UserError as e:
        assert e.code == "stale", e.code
    assert tree(lib.root) == before


def _rich_setup(name):
    """Kullanıcının durumu: iç içe Türkçe klasörler, Mac (NFD) crate, aynalı etkinlik listesi, Serato'ya sonradan
    eklenmiş (programın henüz okumadığı) kayıtlar, taranmamış bir dosya."""
    lib = fresh(name)
    t = os.path.join(lib.root, "Müzik", "Türkçe Pop", "Türkü Arşivi")
    make_fixture.write_mp3(os.path.join(t, "Neşet Ertaş - Gönül Dağı.mp3"), 701, 150, "Gönül Dağı", "Neşet Ertaş")
    make_fixture.write_mp3(os.path.join(t, "Belalım Türkü.mp3"), 702, 150, "Belalım", "X")
    lib.full_scan()
    maintain.after_change(lib)
    write_crate(lib, "Türküler", [NFD("Müzik/Türkçe Pop/Türkü Arşivi/Neşet Ertaş - Gönül Dağı.mp3"),
                                  NFD("Müzik/Halay/Sivas Halayı.mp3")])
    lib.analyze_serato()
    # aynalı etkinlik listesi (Engine listesi <-> Serato crate)
    ev = lists.new_event(lib, "Kına Gecesi", template="kina")
    mirror.link(lib, ev["id"], True)
    sec = next(x for x in lists.tree(lib)["lists"] if x["parent"] == ev["id"] and x["title"] == "Halay")
    lists.add(lib, sec["id"], fids=[fid_of(lib, "Müzik/Halay/Sivas Halayı.mp3"),
                                    fid_of(lib, "Müzik/Türkçe Pop/Türkü Arşivi/Belalım Türkü.mp3")])
    # B1: Serato'da sonradan eklenen kayıtlar (program analyze_serato çalıştırmadı)
    append_db(lib, [NFD("Müzik/Türkçe Pop/Türkü Arşivi/Belalım Türkü.mp3")])
    write_crate(lib, "Yeni Crate", [NFD("Müzik/Türkçe Pop/Türkü Arşivi/Belalım Türkü.mp3")])
    write_crate(lib, "Windows Crate", ["Müzik/Türkçe Pop/Tarkan - Yolla.mp3"])        # Windows'un NFC yazımı
    # taranmamış dosya: Engine ve Serato'da kaydı var, katalogda yok -> klasörle birlikte gitmeli
    make_fixture.write_mp3(os.path.join(t, "Taranmamış Türkü.mp3"), 703, 60, "T", "Y")
    con = sqlite3.connect(lib.engine_db()["path"])
    con.execute("INSERT INTO Track(path, filename, title, isAnalyzed, fileType, isAvailable, "
                "isMetadataOfPackedTrackChanged, isPerfomanceDataOfPackedTrackChanged, isMetadataImported, "
                "pdbImportKey, isBeatGridLocked, streamingFlags, explicitLyrics, albumArtId, dateAdded) "
                "VALUES(?,?,?,1,'mp3',1,0,0,1,0,0,0,0,1,1700000000)",
                ("../Müzik/Türkçe Pop/Türkü Arşivi/Taranmamış Türkü.mp3", "Taranmamış Türkü.mp3", "T"))
    con.commit()
    con.close()
    write_crate(lib, "Taranmamis", [NFD("Müzik/Türkçe Pop/Türkü Arşivi/Taranmamış Türkü.mp3")])
    return lib, ev, sec


def test_batch_apply_engine_safe_and_undo():
    lib, ev, sec = _rich_setup("batch")
    assert all(v == "ok" for v in mirror.state(lib).values()), mirror.state(lib)
    before = snapshot(lib)
    b0 = nbackups(lib)
    top0 = lib.catalog.journal_top()["id"]
    pl = renamer.plan(lib, preset="engine_safe")
    assert pl["counts"]["conflicts"] == 0, [x for x in pl["items"] if x["status"] == "conflict"]
    assert any(x["rel"] == "Müzik" and x["music_root"] for x in pl["items"])
    dry = renamer.apply(lib, preset="engine_safe", token=pl["token"], dry_run=True)
    assert dry["counts"]["engine"] >= 10 and dry["counts"]["serato"] >= 10, dry["counts"]
    assert tree(lib.root) == before[0]                                    # deneme diske dokunmaz
    t0 = time.time()
    res = renamer.apply(lib, preset="engine_safe", token=pl["token"])
    el = time.time() - t0
    assert res["files"] >= 10 and res["dirs"] >= 4 and not res["skipped"], res
    assert res["verify"] == {"engine_missing": 0, "serato_missing": 0}, res["verify"]
    assert not res["engine_clash"], res["engine_clash"]
    # her veritabanı için TEK yedek
    b1 = nbackups(lib)
    assert b1[0] - b0[0] == 1 and b1[1] - b0[1] == 1, (b0, b1)
    assert os.path.isfile(os.path.join(lib.root, "Muzik", "Turkce Pop", "Turku Arsivi", "Neset Ertas - Gonul Dagi.mp3"))
    assert os.path.isfile(os.path.join(lib.root, "Muzik", "Turkce Pop", "Turku Arsivi", "Taranmamış Türkü.mp3"))
    bc, bd, bo = broken(lib)
    assert not bc and not bd and not bo, (bc, bd, bo)
    paths = {r[0] for r in eng(lib, "SELECT path FROM Track")}
    assert "../Muzik/Halay/Sivas Halayi.mp3" in paths, sorted(paths)
    assert "../Muzik/Turkce Pop/Turku Arsivi/Taranmamış Türkü.mp3" in paths      # taranmamış: klasörle gitti
    # Serato: Mac yazımı (NFD) korunur, sonradan eklenen kayıtlar da (B1)
    cr = crates(lib)
    assert cr["Yeni Crate"] == ["Muzik/Turkce Pop/Turku Arsivi/Belalim Turku.mp3"], cr["Yeni Crate"]
    assert cr["Taranmamis"] == [NFD("Muzik/Turkce Pop/Turku Arsivi/Taranmamış Türkü.mp3")], cr["Taranmamis"]
    assert cr["Windows Crate"] == ["Muzik/Turkce Pop/Tarkan - Yolla.mp3"]
    # tür, kural ve ana klasör kayıtları yeni yolu gösterir; Engine'deki Türler listesi de
    assert lib.music_root() == "Muzik"
    assert sorted(g["rel"] for g in lib.catalog.genres()) == ["Muzik/Ankara", "Muzik/Halay", "Muzik/Horon",
                                                              "Muzik/Turkce Pop"]
    assert dict(before[3])["Müzik/Türkçe Pop"] == dict((g["rel"], g["color"]) for g in lib.catalog.genres())[
        "Muzik/Turkce Pop"]                                                  # renk korunur
    pls = lib.engine_state(force=True)["playlists"]
    root = next(p["id"] for p in pls if p["title"] == maintain.GENRES_TITLE and not p["parent"])
    titles = [p["title"] for p in pls if p["parent"] == root]
    assert "Turkce Pop" in titles and "Türkçe Pop" not in titles, titles
    states = lib.file_states()
    assert not [s["f"]["rel"] for s in states.values() if s["f"]["rel"].startswith("Muzik/") and s["place"] != "genre"]
    # B2: aynalı crate programın kendi yazımı -> ayna 'ok', arka plan ayrı bir işlem kaydetmez
    assert all(v == "ok" for v in mirror.state(lib).values()), mirror.state(lib)
    assert mirror.background(lib) is None
    top = lib.catalog.journal_top()
    assert top["id"] == res["journal"] and top["id"] > top0, (top, res["journal"])
    # tek 'Geri al': her şey birebir eski hâline
    journal.undo_last(lib)
    after = snapshot(lib)
    for i, nm in enumerate(("dosyalar", "serato", "engine", "turler", "kurallar", "ana_klasor")):
        assert before[i] == after[i], (nm, set(before[i]) ^ set(after[i]) if i == 0 else (before[i], after[i]))
    assert all(v == "ok" for v in mirror.state(lib).values()), mirror.state(lib)
    print("    (uygulama %.2f sn)" % el)


def test_b1_stale_ext_tables_rename_folder():
    lib = fresh("b1")
    rel = "Müzik/Türkçe Pop/Barış Manço - Gülpembe.mp3"
    make_fixture.write_mp3(os.path.join(lib.root, *rel.split("/")), 801, 150, "Gülpembe", "Barış Manço")
    lib.full_scan()
    append_db(lib, [NFD(rel)])
    write_crate(lib, "Yeni Crate", [NFD(rel)])
    g = next(g for g in lib.genre_rows() if g["name"] == "Türkçe Pop")
    relocate.genre_rename(lib, g["id"], "Pop Arşivi")
    want = NFD("Müzik/Pop Arşivi/Barış Manço - Gülpembe.mp3")
    assert crates(lib)["Yeni Crate"] == [want], crates(lib)["Yeni Crate"]
    assert want in dbv2(lib), dbv2(lib)
    bc, bd, bo = broken(lib)
    assert not bc and not bd and not bo, (bc, bd, bo)


def test_b3_dialect_for_ascii_raw():
    # Mac kütüphanesi (database V2 NFD) + ASCII yazılmış eski yol: yeni Türkçe yol Mac biçiminde yazılmalı
    assert serato.raw_for("a/Pop/x.mp3", "a/Pop/x.mp3", "a/Türkçe/x.mp3", "mac") == NFD("a/Türkçe/x.mp3")
    assert serato.raw_for("a/Pop/x.mp3", "a/Pop/x.mp3", "a/Türkçe/x.mp3", "windows") == "a/Türkçe/x.mp3"
    assert serato.raw_for(NFD("a/Gül/x.mp3"), "a/Gül/x.mp3", "a/Gul/y.mp3") == "a/Gul/y.mp3"
    assert serato.raw_for("a/Gül/x.mp3", "a/Gül/x.mp3", "a/Gül2/x.mp3", "mac") == "a/Gül2/x.mp3"   # NFC kanıtı
    lib = fresh("b3")
    lib.settings.set_prefs(serato_dialect="auto")
    write_crate(lib, "Ascii", ["Müzik/Horon/Karadeniz Horon 2.mp3".replace("Müzik", "Muzik")])
    # 'Müzik' -> 'Muzik' yapıp sonra 'Horon' -> 'Horonlar Ş' ; ASCII ham yol Mac lehçesiyle yazılır
    relocate.rename_folder(lib, "Müzik", "Muzik")
    write_crate(lib, "Ascii", ["Muzik/Horon/Karadeniz Horon 2.mp3"])
    relocate.rename_folder(lib, "Muzik/Horon", "Horon Şöleni")
    assert crates(lib)["Ascii"] == [NFD("Muzik/Horon Şöleni/Karadeniz Horon 2.mp3")], crates(lib)["Ascii"]


def test_b4_non_injective_uses_snapshot():
    lib = fresh("b4")
    rel = "Müzik/Türkçe Pop/Tarkan - Yolla.mp3"
    write_crate(lib, "Windows Crate", [rel])                         # NFC (Windows) — DB'de NFD
    before = serato_bytes(lib.root)
    # Türkçe harfli hedef: iki yazım iki ayrı yola gider (bire bir) -> 'ser'
    fid = fid_of(lib, rel)
    relocate.batch_rename(lib, {fid: "Tarkan - Yolla 2.mp3"}, {}, "test")
    kinds = [s["k"] for s in lib.catalog.journal_top()["payload"]["steps"]]
    assert "ser" in kinds, kinds
    assert crates(lib)["Windows Crate"] == ["Müzik/Türkçe Pop/Tarkan - Yolla 2.mp3"]
    journal.undo_last(lib)
    assert serato_bytes(lib.root) == before
    # tamamen ASCII hedef: NFD ve NFC yazım AYNI yola düşer (bire bir değil) -> geri alma yedekten ('sersnap')
    res = relocate.batch_rename(lib, {}, {"Müzik": "Muzik", "Müzik/Türkçe Pop": "Pop"}, "test")
    kinds = [s["k"] for s in lib.catalog.journal_top()["payload"]["steps"]]
    assert "sersnap" in kinds and "ser" not in kinds, kinds
    assert crates(lib)["Windows Crate"] == ["Muzik/Pop/Tarkan - Yolla.mp3"] and res["dirs"] == 2
    assert "Muzik/Pop/Tarkan - Yolla.mp3" in dbv2(lib)
    journal.undo_last(lib)
    assert serato_bytes(lib.root) == before


def test_b5_one_backup_many_folders_and_fix_names():
    from djdoktor import health
    lib = fresh("b5")
    h = os.path.join(lib.root, "Müzik", "Halay")
    for i, nm in enumerate(("Birİki", "Üç", "Dört")):
        make_fixture.write_mp3(os.path.join(h, nm, "AltKlasör", "parça %d.mp3" % i), 900 + i, 20, "p", "q")
    make_fixture.write_mp3(os.path.join(h, "Bir - İki", "zaten.mp3"), 910, 20, "z", "z")   # hedef dolu
    lib.full_scan()
    maintain.after_change(lib)
    b0 = nbackups(lib)
    t0 = time.time()
    r = health.fix_names(lib)
    el = time.time() - t0
    b1 = nbackups(lib)
    assert b1[0] - b0[0] <= 1 and b1[1] - b0[1] <= 1, (b0, b1)
    assert r["renamed"] >= 4, r
    assert r["conflicts"] >= 1, r                                    # dolu hedef sessizce atlanmaz, raporlanır
    assert os.path.isdir(os.path.join(h, "Üç")) and os.path.isdir(os.path.join(h, "Dört", "Alt - Klasör"))
    bc, bd, bo = broken(lib)
    assert not bo, bo
    assert el < 20, el
    journal.undo_last(lib)
    assert os.path.isdir(os.path.join(h, "Üç"))


def test_guards_engine_serato_open():
    lib = fresh("guard")
    before = snapshot(lib)
    pl = renamer.plan(lib, preset="engine_safe")
    with FakeProcs(engine.ENGINE_PROCS):
        assert renamer.plan(lib, preset="engine_safe")["blocked"] == "engine_open"
        try:
            renamer.apply(lib, preset="engine_safe", token=pl["token"])
            raise AssertionError("Engine açıkken yazdı")
        except UserError as e:
            assert e.code == "engine_open", e.code
    assert snapshot(lib) == before
    with FakeProcs(serato.SERATO_PROCS):
        try:
            renamer.apply(lib, preset="engine_safe", token=pl["token"])
            raise AssertionError("Serato açıkken yazdı")
        except UserError as e:
            assert e.code == "serato_open", e.code
    assert snapshot(lib) == before
    # Serato'da kaydı olmayan bir ad Serato açıkken de değişebilir
    make_fixture.write_mp3(os.path.join(lib.root, "Müzik", "Horon", "Yeni Horon.mp3"), 1301, 20, "Y", "Z")
    lib.full_scan()
    s0 = serato_bytes(lib.root)
    with FakeProcs(serato.SERATO_PROCS):
        fid = fid_of(lib, "Müzik/Horon/Yeni Horon.mp3")
        assert not renamer._ser_count(lib.serato_index(), "Müzik/Horon/Yeni Horon.mp3")
        r = renamer.rename_one(lib, "file", fid, "Yeni Horon İki")
        assert r["files"] == 1, r
    assert serato_bytes(lib.root) == s0                              # Serato dosyalarına dokunulmadı
    journal.undo_last(lib)
    assert os.path.isfile(os.path.join(lib.root, "Müzik", "Horon", "Yeni Horon.mp3"))


def test_b6_fresh_process_check():
    """B6: önbellekteki 'kapalı' sonucu yazmadan önce kullanılmaz; Serato az önce açıldıysa taze denetim yakalar."""
    lib = fresh("b6")
    pl = renamer.plan(lib, preset="engine_safe")
    before = snapshot(lib)

    class Ps:
        stdout = b"serato dj pro\n"
    real_run = util.subprocess.run
    try:
        util.subprocess.run = lambda *a, **k: Ps()
        util._PROC.update(t=time.time() - 1.0, text="")             # 1 sn önceki sonuç: 'hiçbiri açık değil'
        assert not lib.serato_open() and lib.serato_open(fresh=True)
        util._PROC.update(t=time.time() - 1.0, text="")
        try:
            renamer.apply(lib, preset="engine_safe", token=pl["token"])
            raise AssertionError("Serato açıkken yazdı")
        except UserError as e:
            assert e.code == "serato_open", e.code
    finally:
        util.subprocess.run = real_run
        util._PROC.update(t=0.0, text=None)
    assert snapshot(lib) == before


def test_twin_names_keep_occupancy():
    """exFAT / Linux: NFC ve NFD yazımlı iki ad yan yana durabilir. Biri yeniden adlandırılınca diğeri o adı hâlâ
    tutar; başka bir dosya o ada adlandırılırsa ikinci bir ikiz oluşmaz ('exists' ile atlanır)."""
    lib = fresh("twin", setup=False)
    d = os.path.join(lib.root, "İkiz")
    make_fixture.write_mp3(os.path.join(d, "Gül.mp3"), 1401, 20, "Gül", "A")              # NFC
    make_fixture.write_mp3(os.path.join(d, "Başka.mp3"), 1402, 20, "Başka", "B")
    lib.full_scan()
    make_fixture.write_mp3(os.path.join(d, NFD("Gül.mp3")), 1403, 20, "Gül", "C")         # NFD ikiz (taranmamış)
    if len([e for e in os.listdir(d) if unicodedata.normalize("NFC", e) == "Gül.mp3"]) < 2:
        return                                   # bu dosya sistemi ikizlere izin vermiyor (macOS APFS gibi)
    a, b = fid_of(lib, "İkiz/Gül.mp3"), fid_of(lib, "İkiz/Başka.mp3")
    res = relocate.batch_rename(lib, {a: "Gul.mp3", b: "Gül.mp3"}, {}, "ikiz")
    assert res["files"] == 1 and [s["id"] for s in res["skipped"]] == ["f:%d" % b], res
    left = sorted(unicodedata.normalize("NFC", e) for e in os.listdir(d))
    assert left == ["Başka.mp3", "Gul.mp3", "Gül.mp3"], left
    journal.undo_last(lib)
    assert sorted(unicodedata.normalize("NFC", e) for e in os.listdir(d)) == ["Başka.mp3", "Gül.mp3", "Gül.mp3"]


def test_b7_engine_clash_reported():
    lib = fresh("clash")
    con = sqlite3.connect(lib.engine_db()["path"])
    con.execute("INSERT INTO Track(path, filename, title, isAnalyzed, fileType, isAvailable, "
                "isMetadataOfPackedTrackChanged, isPerfomanceDataOfPackedTrackChanged, isMetadataImported, "
                "pdbImportKey, isBeatGridLocked, streamingFlags, explicitLyrics, albumArtId, dateAdded) "
                "VALUES('../Müzik/Halay/Sivas Halayi.mp3','Sivas Halayi.mp3','x',0,'mp3',1,0,0,1,0,0,0,0,1,1)")
    con.commit()
    con.close()
    fid = fid_of(lib, "Müzik/Halay/Sivas Halayı.mp3")
    res = relocate.batch_rename(lib, {fid: "Sivas Halayi.mp3"}, {}, "test")
    assert res["files"] == 1 and res["engine_clash"], res
    assert res["engine_clash"][0]["path"] == "../Müzik/Halay/Sivas Halayi.mp3"


def test_case_only_and_collisions():
    """exFAT: yalnızca büyük/küçük harf değişen klasör, ü/Ü çakışması, dolu hedefe ' (2)'."""
    lib = fresh("case")
    r = relocate.rename_folder(lib, "Müzik/Horon", "HORON")
    assert r["renamed"] == 1 and os.listdir(os.path.join(lib.root, "Müzik")).count("HORON") == 1
    assert {g["rel"] for g in lib.catalog.genres()} >= {"Müzik/HORON"}
    paths = {x[0] for x in eng(lib, "SELECT path FROM Track")}
    assert "../Müzik/HORON/Karadeniz Horon 1.mp3" in paths, paths
    journal.undo_last(lib)
    assert "Horon" in os.listdir(os.path.join(lib.root, "Müzik"))
    h = os.path.join(lib.root, "Müzik", "Halay")
    make_fixture.write_mp3(os.path.join(h, "Türkü.mp3"), 1001, 20, "a", "b")
    make_fixture.write_mp3(os.path.join(h, "TURKU.mp3"), 1002, 20, "c", "d")
    lib.full_scan()
    fid = fid_of(lib, "Müzik/Halay/Türkü.mp3")
    res = relocate.batch_rename(lib, {fid: "Turku.mp3"}, {}, "t")       # TURKU.mp3 var: atlanır
    assert res["files"] == 0 and res["skipped"][0]["why"] == "exists", res
    res = relocate.batch_rename(lib, {fid: "Turku.mp3"}, {}, "t", suffix={fid})
    assert res["files"] == 1 and os.path.isfile(os.path.join(h, "Turku (2).mp3")), os.listdir(h)
    try:
        relocate.rename_folder(lib, "Müzik/Halay", "Horon")
        raise AssertionError("dolu klasöre adlandırıldı")
    except UserError as e:
        assert e.code == "exists"


def test_music_root_rename():
    lib = fresh("root")
    before = snapshot(lib)
    pl = renamer.plan(lib, preset="engine_safe", scope={"kind": "folder", "rel": "Müzik"}, targets="dirs")
    assert [x["rel"] for x in pl["items"]] == ["Müzik", "Müzik/Ankara/7-24 Yıldızlarla Ankara Vol. 2",
                                                "Müzik/Türkçe Pop"], [x["rel"] for x in pl["items"]]
    renamer.apply(lib, preset="engine_safe", scope={"kind": "folder", "rel": "Müzik"}, targets="dirs",
                  token=pl["token"], exclude=["d:Müzik/Türkçe Pop", "d:Müzik/Ankara/7-24 Yıldızlarla Ankara Vol. 2"])
    assert lib.music_root() == "Muzik"
    assert sorted(g["rel"] for g in lib.catalog.genres())[-1] == "Muzik/Türkçe Pop"
    assert all(p.startswith(("../Muzik/", "../melis", "../Dj", "Music/")) for (p,) in eng(lib, "SELECT path FROM Track")
               if "Silinen" not in p), eng(lib, "SELECT path FROM Track")
    g = inbox._genre_for_folder(lib, "Türkçe Pop")
    assert g and g["rel"] == "Muzik/Türkçe Pop", g
    assert relocate.genre_create(lib, "Oyun Havası")
    assert os.path.isdir(os.path.join(lib.root, "Muzik", "Oyun Havası"))
    journal.undo_last(lib)
    journal.undo_last(lib)
    assert snapshot(lib) == before


def test_rename_one_with_preview():
    lib = fresh("one")
    fid = fid_of(lib, "Müzik/Halay/Grup Ateş - Delilo.mp3")
    pv = renamer.rename_one(lib, "file", fid, "Grup Ateş - Delilo (Canlı)", dry_run=True)
    assert pv["new"] == "Grup Ateş - Delilo (Canlı).mp3", pv
    assert pv["counts"]["engine"] == 1 and pv["counts"]["serato"] >= 2, pv["counts"]
    assert any("Halaylar" in " ".join(s["where"]) for s in pv["serato"]), pv["serato"]
    r = renamer.rename_one(lib, "file", fid, "Grup Ateş - Delilo (Canlı)")
    assert r["files"] == 1
    assert NFD("Müzik/Halay/Grup Ateş - Delilo (Canlı).mp3") in crates(lib)["Melis Program%%Halaylar"]
    try:
        renamer.rename_one(lib, "file", fid, "Sivas Halayı")
        raise AssertionError("dolu ada adlandırıldı")
    except UserError as e:
        assert e.code == "exists"
    r = renamer.rename_one(lib, "dir", "Müzik/Horon", "Horon: Karadeniz")      # yasak ':' güvenli hâle gelir
    assert os.path.isdir(os.path.join(lib.root, "Müzik", "Horon - Karadeniz")), r


# ---------------------------------------------------------------------------
# Program dışında yapılan adlandırmalar: Kayıp yollar — Bul ve bağla
# ---------------------------------------------------------------------------
def _outside(lib, fresh_catalog=False):
    """Kullanıcının durumu: '... Türkü.mp3' Serato (Mac NFD, DB + crate'ler) ve Engine'de; Finder'da hem dosya hem
    klasör ('Türküler' -> 'Turkuler') yeniden adlandırılır."""
    t = os.path.join(lib.root, "Müzik", "Türkçe Pop", "Türküler")
    rels = ["Müzik/Türkçe Pop/Türküler/Neşet Ertaş - Gönül Dağı Türkü.mp3", "Müzik/Türkçe Pop/Türküler/Belalım Türkü.mp3"]
    make_fixture.write_mp3(os.path.join(lib.root, *rels[0].split("/")), 701, 150, "Gönül Dağı", "Neşet Ertaş")
    make_fixture.write_mp3(os.path.join(lib.root, *rels[1].split("/")), 702, 150, "Belalım", "X")
    lib.full_scan()
    maintain.after_change(lib)
    append_db(lib, [NFD(r) for r in rels], tlen="00:03.92")
    write_crate(lib, "Türküler", [NFD(r) for r in rels])
    write_crate(lib, "Düğün 2025", [NFD(rels[0]), NFD("Müzik/Halay/Sivas Halayı.mp3")])
    lib.analyze_serato()
    d2 = os.path.join(lib.root, "Müzik", "Türkçe Pop", "Turkuler")
    os.rename(t, d2)
    os.rename(os.path.join(d2, "Neşet Ertaş - Gönül Dağı Türkü.mp3"), os.path.join(d2, "Neset Ertas - Gonul Dagi Turku.mp3"))
    os.rename(os.path.join(d2, "Belalım Türkü.mp3"), os.path.join(d2, "Belalim Turku.mp3"))
    if fresh_catalog:
        lib.catalog.x("DELETE FROM files WHERE rel LIKE '%Türküler%'")
        lib.catalog.x("DELETE FROM rel_history")
    lib.full_scan()
    return rels


def test_relink_outside_turkish_rename():
    for fresh_catalog in (False, True):
        lib = fresh("rl_%d" % fresh_catalog)
        rels = _outside(lib, fresh_catalog)
        bc, bd, bo = broken(lib)
        assert len(bc) == 3 and len(bd) == 2 and len(bo) == 2, (bc, bd, bo)
        before = (serato_bytes(lib.root), engine_core(lib))
        pl = relink.plan(lib)
        found = [x for x in pl["items"] if x["status"] == "found"]
        assert len(found) == 4 and all(x["confidence"] in ("kesin", "yuksek") for x in found), pl["items"]
        assert {x["method"] for x in found} <= {"ad_sade", "ses_imzasi", "gecmis", "klasor_adi"}, found
        if fresh_catalog:
            assert {x["method"] for x in found} == {"ad_sade"}, found
        none = [x for x in pl["items"] if x["status"] == "none"]
        assert len(none) == 1 and "Silinen" in none[0]["old"], none
        r = relink.apply(lib, pl["token"], keys=[x["key"] for x in found])
        assert r["engine"] == 2 and r["serato"] == 5 and r["history"] == 4, r
        bc, bd, bo = broken(lib)
        assert not bc and not bd and not bo, (bc, bd, bo)
        cr = crates(lib)
        assert cr["Türküler"] == [NFD("Müzik/Türkçe Pop/Turkuler/Neset Ertas - Gonul Dagi Turku.mp3"),
                                  NFD("Müzik/Türkçe Pop/Turkuler/Belalim Turku.mp3")], cr["Türküler"]
        assert lib.catalog.history_fid(rels[0]) == fid_of(lib, "Müzik/Türkçe Pop/Turkuler/Neset Ertas - Gonul Dagi Turku.mp3")
        assert relink.plan(lib)["counts"]["found"] == 0
        journal.undo_last(lib)
        after = (serato_bytes(lib.root), engine_core(lib))
        assert before[0] == after[0], "geri alma Serato'yu döndürmedi"
        assert before[1] == after[1], ("geri alma Engine'i döndürmedi", set(before[1][0]) ^ set(after[1][0]))
        # geri alınan bağlama hemen yeniden yapılmaz ve dosyalar Engine'e İKİNCİ kez eklenmez
        assert len(eng(lib, "SELECT id FROM Track WHERE path LIKE '%Turku%'")) == 0
        assert lib.catalog.history_fid(rels[0]) is None                       # yol geçmişi de geri alındı
        # arka plan geri alınan bağlamayı sonra da kendiliğinden yapmaz; kullanıcı isterse yeniden bağlar
        lib._maint_sig = None
        r = maintain.background(lib)
        assert not (r or {}).get("auto_linked"), r
        assert [len(x) for x in broken(lib)] == [3, 2, 2], broken(lib)
        assert len(eng(lib, "SELECT id FROM Track WHERE path LIKE '%Turku%'")) == 0
        pl = relink.plan(lib)
        assert all(x["declined"] for x in pl["items"] if x["status"] == "found"), pl["items"]
        assert relink.apply(lib, pl["token"])["engine"] == 0                  # varsayılan seçim: geri alınanlar yok
        r = relink.apply(lib, pl["token"], keys=[x["key"] for x in pl["items"] if x["status"] == "found"])
        assert r["engine"] == 2 and r["serato"] == 5 and not relink.declined(lib), r


def test_relink_folder_vote_and_genres():
    lib = fresh("vote")
    # 'Türkçe Pop' Finder'da 'Pop Arsivi', 'Halay' 'Halay Kayitlari' oldu; katalog sıfırdan (program sonra açıldı)
    os.rename(os.path.join(lib.root, "Müzik", "Türkçe Pop"), os.path.join(lib.root, "Müzik", "Pop Arsivi"))
    os.rename(os.path.join(lib.root, "Müzik", "Halay"), os.path.join(lib.root, "Müzik", "Halay Kayitlari"))
    lib.catalog.x("DELETE FROM files WHERE rel LIKE 'Müzik/Türkçe Pop/%' OR rel LIKE 'Müzik/Halay/%'")
    lib.catalog.x("DELETE FROM rel_history")
    lib.full_scan()
    pl = relink.plan(lib)
    found = {x["old"]: x for x in pl["items"] if x["status"] == "found"}
    y = found.get("Müzik/Türkçe Pop/Tarkan - Yolla.mp3")
    assert y and y["method"] == "klasor_adi" and y["new"] == "Müzik/Pop Arsivi/Tarkan - Yolla.mp3", pl["items"]
    assert any(f["old"] == "Müzik/Türkçe Pop" and f["new"] == "Müzik/Pop Arsivi" and f["genre"] for f in pl["folders"]), \
        pl["folders"]
    r = relink.apply(lib, pl["token"], keys=[x["key"] for x in found.values()])
    assert r["folders"] >= 2, r
    rels = {g["rel"] for g in lib.catalog.genres()}
    assert {"Müzik/Pop Arsivi", "Müzik/Halay Kayitlari"} <= rels, rels
    st = lib.file_states()
    assert all(s["place"] == "genre" for s in st.values() if s["f"]["rel"].startswith("Müzik/Pop Arsivi/")), \
        [(s["f"]["rel"], s["place"]) for s in st.values()]
    bc, bd, bo = broken(lib)
    assert not bc and not bd and not bo, (bc, bd, bo)


def test_b8_qsig_ignores_engine_copies():
    """E4: 'Tarkan - Yolla' — Engine Library/Music'te aynı sesten kopya var; ses imzası yine de tek dosyayı bulur."""
    lib = fresh("b8")
    os.rename(os.path.join(lib.root, "Müzik", "Türkçe Pop"), os.path.join(lib.root, "Müzik", "Pop"))
    os.rename(os.path.join(lib.root, "Müzik", "Pop", "Tarkan - Yolla.mp3"), os.path.join(lib.root, "Müzik", "Pop", "Yolla.mp3"))
    lib.full_scan()
    lib._maint_sig = None
    m = maintain.run(lib)
    assert m["relinked"] >= 1, m
    paths = {r[0] for r in eng(lib, "SELECT path FROM Track")}
    assert "../Müzik/Pop/Yolla.mp3" in paths, paths
    assert "Music/Tarkan/Unknown Album/Tarkan - Yolla.mp3" in paths          # Engine'in kopyasına dokunulmadı


def test_relink_ambiguous_needs_pick():
    lib = fresh("amb")
    h = os.path.join(lib.root, "Müzik", "Horon")
    make_fixture.write_mp3(os.path.join(h, "Şiir.mp3"), 1201, 20, "Şiir", "A")
    lib.full_scan()
    maintain.after_change(lib)
    os.rename(os.path.join(h, "Şiir.mp3"), os.path.join(h, "Siir.mp3"))
    make_fixture.write_mp3(os.path.join(h, "SİİR.mp3"), 1202, 20, "Başka", "B")         # katlanınca aynı ad
    lib.catalog.x("DELETE FROM files WHERE rel LIKE '%Şiir%'")
    lib.full_scan()
    pl = relink.plan(lib)
    it = next(x for x in pl["items"] if x["old"].endswith("Şiir.mp3"))
    assert it["status"] == "ambiguous" and len(it["candidates"]) == 2, it
    r = relink.apply(lib, pl["token"])
    assert r["engine"] == 0, r
    want = next(c for c in it["candidates"] if c["rel"].endswith("/Siir.mp3"))
    r = relink.apply(lib, pl["token"], keys=[], picks={it["key"]: want["fid"]})
    assert r["engine"] == 1, r
    assert "../Müzik/Horon/Siir.mp3" in {x[0] for x in eng(lib, "SELECT path FROM Track")}


def test_relink_reimported_duplicates():
    lib = fresh("reimp")
    rel = "Müzik/Türkçe Pop/Sezen Aksu - Firuze.mp3"
    new = "Müzik/Türkçe Pop/Sezen Aksu - Firuze (Yeni).mp3"
    maintain.after_change(lib)
    # Engine: eski kayıt analizli ve bir listede
    con = sqlite3.connect(lib.engine_db()["path"])
    con.execute("UPDATE Track SET isAnalyzed=1 WHERE path=?", ("../" + rel,))
    con.commit()
    con.close()
    tid_old = eng(lib, "SELECT id FROM Track WHERE path=?", ("../" + rel,))[0][0]
    lst = lists.create(lib, 0, "Yaz Düğünü")
    lists.add(lib, lst["id"], fids=[fid_of(lib, rel)])
    append_db(lib, [NFD(rel)])
    write_crate(lib, "Pop", [NFD(rel)])
    os.rename(os.path.join(lib.root, *rel.split("/")), os.path.join(lib.root, *new.split("/")))
    lib.full_scan()
    # kullanıcı yeni dosyayı Engine'e ve Serato'ya yeniden eklemiş
    con = sqlite3.connect(lib.engine_db()["path"])
    con.execute("INSERT INTO Track(path, filename, title, isAnalyzed, fileType, isAvailable, "
                "isMetadataOfPackedTrackChanged, isPerfomanceDataOfPackedTrackChanged, isMetadataImported, "
                "pdbImportKey, isBeatGridLocked, streamingFlags, explicitLyrics, albumArtId, dateAdded) "
                "VALUES(?,?,'Firuze',0,'mp3',1,0,0,1,0,0,0,0,1,1)", ("../" + new, new.split("/")[-1]))
    con.commit()
    con.close()
    append_db(lib, [NFD(new)])
    before = (serato_bytes(lib.root), engine_core(lib))
    pl = relink.plan(lib)
    keys = [x["key"] for x in pl["items"] if x["status"] == "found"]
    assert len(keys) == 2, pl["items"]
    r = relink.apply(lib, pl["token"], keys=keys)
    assert r["engine_merged"] == 1, r
    rows = eng(lib, "SELECT id, path, isAnalyzed FROM Track WHERE path LIKE '%Firuze%'")
    assert len(rows) == 1 and rows[0][2] == 1 and rows[0][0] == tid_old and rows[0][1] == "../" + new, rows
    it = lists.items(lib, lst["id"])
    assert [x["title"] for x in it["items"]] == ["Firuze"], it["items"]
    assert crates(lib)["Pop"] == [NFD(new)]
    assert dbv2(lib).count(NFD(new)) == 1 and NFD(rel) not in dbv2(lib)
    kinds = [s["k"] for s in lib.catalog.journal_top()["payload"]["steps"]]
    assert "engsnap" in kinds and "sersnap" in kinds, kinds
    journal.undo_last(lib, force=True)
    after = (serato_bytes(lib.root), engine_core(lib))
    assert before[0] == after[0], "Serato"
    assert before[1] == after[1], ("Engine", set(before[1][0]) ^ set(after[1][0]), set(before[1][1]) ^ set(after[1][1]))


def test_auto_relink_merge_only_without_user_work():
    """Arka plandaki otomatik bağlama, bulunan dosyanın Engine'de zaten başka bir kaydı varsa (kullanıcı dosyayı
    yeniden eklemiş) iki kaydı YALNIZCA silinecek kayıtta emek yoksa (analiz, grid / cue, kendi listesi) birleştirir;
    varsa hiçbir kaydı silmez, karar kullanıcıya kalır (Kayıp yollar). Her turda boşuna yedek de alınmaz."""
    rel = "Müzik/Türkçe Pop/Sezen Aksu - Firuze.mp3"
    new = "Müzik/Türkçe Pop/Sezen Aksu - Firuze (Yeni).mp3"
    for analyzed_new in (1, 0):
        lib = fresh("noauto%d" % analyzed_new)
        maintain.after_change(lib)
        con = sqlite3.connect(lib.engine_db()["path"])
        con.execute("UPDATE Track SET isAnalyzed=1 WHERE path=?", ("../" + rel,))
        con.commit()
        con.close()
        tid_old = eng(lib, "SELECT id FROM Track WHERE path=?", ("../" + rel,))[0][0]
        os.rename(os.path.join(lib.root, *rel.split("/")), os.path.join(lib.root, *new.split("/")))
        lib.full_scan()
        con = sqlite3.connect(lib.engine_db()["path"])
        con.execute("INSERT INTO Track(path, filename, title, isAnalyzed, fileType, isAvailable, "
                    "isMetadataOfPackedTrackChanged, isPerfomanceDataOfPackedTrackChanged, isMetadataImported, "
                    "pdbImportKey, isBeatGridLocked, streamingFlags, explicitLyrics, albumArtId, dateAdded) "
                    "VALUES(?,?,'Firuze',?,'mp3',1,0,0,1,0,0,0,0,1,1)", ("../" + new, new.split("/")[-1], analyzed_new))
        con.commit()
        con.close()
        rows0 = eng(lib, "SELECT id, path FROM Track WHERE path LIKE '%Firuze%'")
        assert len(rows0) == 2, rows0
        pl = relink.plan(lib)
        it = next(x for x in pl["items"] if x["src"] == "engine" and x["status"] == "found")
        assert it["merge"] and it["confidence"] == "kesin" and it["merge_safe"] == (not analyzed_new), it
        lib._maint_sig = None
        maintain.background(lib)
        rows = eng(lib, "SELECT id, path FROM Track WHERE path LIKE '%Firuze%'")
        if analyzed_new:
            assert rows == rows0, rows                         # emek içeren kayıt kendiliğinden silinmedi
            b0 = nbackups(lib)
            lib._maint_sig = None
            maintain.background(lib)
            assert nbackups(lib) == b0, (b0, nbackups(lib))   # her arka plan turunda boşuna yedek alınmaz
            pl = relink.plan(lib)
            it = next(x for x in pl["items"] if x["src"] == "engine" and x["status"] == "found")
            r = relink.apply(lib, pl["token"], keys=[it["key"]])                   # kullanıcı seçerse birleşir
            assert r["engine_merged"] == 1, r
            rows = eng(lib, "SELECT id, path FROM Track WHERE path LIKE '%Firuze%'")
        assert rows == [(tid_old, "../" + new)], rows           # analizli eski kayıt kaldı, yeni yolu gösteriyor


def test_auto_relink_in_background():
    lib = fresh("auto")
    _outside(lib)
    r = maintain.background(lib)
    assert r and r.get("auto_linked") and r["auto_linked"]["serato"] == 5, r
    bc, bd, bo = broken(lib)
    assert not bc and not bd and not bo, (bc, bd, bo)
    assert "otomatik" in lib.catalog.journal_top()["title"]
    assert maintain.background(lib).get("auto_linked") is None     # ikinci kez bağlanacak bir şey yok


def test_dedupe_serato_fresh_mirror_dialect():
    """Çift birleştirme (dedupe._serato_merge): Serato yolları diskten TAZE okunur (B1: sonradan eklenen crate),
    Mac lehçesi korunur (B3: ASCII ham yol -> Türkçe hedef NFD), aynalı crate bağı yenilenir (B2: ayna 'çakışma' /
    'Serato'da değişti' sanmaz). Tek 'Geri al' her şeyi birebir döndürür."""
    from djdoktor import dedupe
    lib = fresh("ddm")
    rm_rel = "melis music/06.10.2026/Ali Kemal - Halay Başı.mp3"
    keep_rel = "Müzik/Halay/Ali Kemal - Halay Başı.mp3"
    # B3: tutulan kopya Türkçe adlı ve database V2'de yok; kaldırılan kopyanın ham yolu tamamen ASCII
    sen = "Müzik/Horon/Şen Horon.mp3"
    make_fixture.write_mp3(os.path.join(lib.root, *sen.split("/")), 1501, 30, "Şen Horon", "K")
    os.makedirs(os.path.join(lib.root, "Dj Kopya"), exist_ok=True)
    shutil.copyfile(os.path.join(lib.root, *sen.split("/")), os.path.join(lib.root, "Dj Kopya", "Sen Horon.mp3"))
    lib.full_scan()
    maintain.after_change(lib)
    write_crate(lib, "Ascii Crate", ["Dj Kopya/Sen Horon.mp3"])
    # B2: kaldırılan kopya aynalı bir listede (Engine listesi <-> Serato crate)
    lst = lists.create(lib, 0, "Kına Aynası")
    lists.add(lib, lst["id"], fids=[fid_of(lib, rm_rel)])
    mirror.link(lib, lst["id"], True)
    uuid = lib.engine_state()["uuid"]
    ln = lib.catalog.serato_links(uuid)[lst["id"]]
    write_crate(lib, ln["crate"], [NFD(rm_rel)])          # aynanın yazdığı crate kaldırılan kopyayı gösteriyor
    lib.catalog.set_serato_link(uuid, lst["id"], ln["crate"],
                                serato.file_hash(os.path.join(sdir(lib), "Subcrates", ln["crate"] + ".crate")),
                                ln["last_refs"], 0)
    lib.analyze_serato()
    assert all(v == "ok" for v in mirror.state(lib).values()), mirror.state(lib)
    # B1: Serato'da sonradan eklenen crate (program henüz okumadı; Windows yazımı, başka hiçbir yerde yok)
    write_crate(lib, "Yeni Crate", [unicodedata.normalize("NFC", rm_rel)])
    before = (tree(lib.root), serato_bytes(lib.root), engine_core(lib))
    gs = dedupe.groups(lib)
    g1 = next(g for g in gs if g["kind"] == "exact" and any(m["rel"] == rm_rel for m in g["members"]))
    g2 = next(g for g in gs if any(m["rel"] == "Dj Kopya/Sen Horon.mp3" for m in g["members"]))
    res = dedupe.merge(lib, [{"group": g1["id"], "keeper": fid_of(lib, keep_rel)},
                             {"group": g2["id"], "keeper": fid_of(lib, sen)}])
    cr = crates(lib)
    assert cr["Yeni Crate"] == [NFD(keep_rel)], cr["Yeni Crate"]                          # B1
    assert cr["Ascii Crate"] == [NFD(sen)], cr["Ascii Crate"]                             # B3
    assert cr[ln["crate"]] == [NFD(keep_rel)], cr[ln["crate"]]
    bc, bd, bo = broken(lib)
    assert not bc and not bd and not bo, (bc, bd, bo)
    st = mirror.state(lib)
    assert not [v for v in st.values() if v in ("conflict", "pull")], st                  # B2
    assert lib.catalog.journal_top()["id"] == res["journal"]
    mirror.background(lib)
    assert lib.catalog.journal_top()["id"] == res["journal"]                             # ayrı bir işlem yok
    assert all(v == "ok" for v in mirror.state(lib).values()), mirror.state(lib)
    journal.undo_last(lib)
    after = (tree(lib.root), serato_bytes(lib.root), engine_core(lib))
    assert before[0] == after[0], set(before[0]) ^ set(after[0])
    assert before[1] == after[1], "Serato birebir dönmedi"
    assert before[2] == after[2], ("Engine dönmedi", set(before[2][0]) ^ set(after[2][0]),
                                   set(before[2][1]) ^ set(after[2][1]))


def test_perf_plan_5000_apply_1000():
    lib = fresh("perf", setup=True)
    base = os.path.join(lib.root, "Müzik", "Halay")
    data = make_fixture.mp3_bytes(5, 2)
    for i in range(5000):
        d = os.path.join(base, "Klasör %02d Şen" % (i % 50))
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, "Şarkı %04d Gönül.mp3" % i), "wb") as f:
            f.write(data[:-(i % 97) - 1] + bytes([i % 251]))
    t0 = time.time()
    lib.full_scan()
    t_scan = time.time() - t0
    maintain.after_change(lib)
    t0 = time.time()
    pl = renamer.plan(lib, preset="engine_safe")
    t_plan = time.time() - t0
    assert pl["counts"]["files"] >= 5000, pl["counts"]
    limit = 3.0 if os.environ.get("DJD_TEST_BASE") else 1.5
    assert t_plan < limit, t_plan
    # 1000 ad (20 klasör) tek işlemde, tek yedek
    sel = {}
    for x in pl["items"]:
        if x["kind"] == "file" and len(sel) < 1000:
            sel[x["fid"]] = x["_new"]
    b0 = nbackups(lib)
    t0 = time.time()
    res = relocate.batch_rename(lib, sel, {}, "perf")
    t_apply = time.time() - t0
    b1 = nbackups(lib)
    assert res["files"] == 1000 and b1[0] - b0[0] == 1 and b1[1] - b0[1] <= 1, (res["files"], b0, b1)
    t0 = time.time()
    journal.undo_last(lib)
    t_undo = time.time() - t0
    print("    (5000 dosya: tarama %.1f sn, önizleme %.2f sn; 1000 ad: uygulama %.1f sn, geri alma %.1f sn)"
          % (t_scan, t_plan, t_apply, t_undo))


TESTS = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]


def main(argv):
    want = set(argv[1:])
    ok = fail = 0
    for t in TESTS:
        if want and t.__name__ not in want:
            continue
        t0 = time.time()
        try:
            t()
            ok += 1
            print("OK    %s  (%.1f sn)" % (t.__name__, time.time() - t0))
        except Exception:
            fail += 1
            print("FAIL  %s" % t.__name__)
            traceback.print_exc()
    print("%d geçti, %d başarısız  (%s)" % (ok, fail, TMP))
    if not fail:
        shutil.rmtree(TMP, ignore_errors=True)
    return 1 if fail else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
