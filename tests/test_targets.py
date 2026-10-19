"""Çalışma yeri / hedefe aktarım testleri (pytest gerekmez): python tests/test_targets.py [test_adı ...]"""
from __future__ import annotations

import os
import shutil
import sqlite3
import sys
import tempfile
import time
import traceback

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "vendor"))
sys.path.insert(0, os.path.join(HERE, ".."))

import make_fixture  # noqa: E402

TMP = tempfile.mkdtemp(prefix="djd_tg_", dir=os.environ.get("DJD_TEST_BASE"))
os.environ["DJDOKTOR_HOME"] = os.path.join(TMP, "ws")
os.environ["HOME"] = os.path.join(TMP, "home")

from djdoktor import engine, relocate, targets, util  # noqa: E402
from djdoktor.config import Settings  # noqa: E402
from djdoktor.library import Library, UserError  # noqa: E402


def fresh(name):
    root = os.path.join(TMP, name, "Masaustu", "melis_dj_muzik")      # PC'de bir klasör (sürücü kökü değil)
    make_fixture.build(root)
    s = Settings()
    lib = Library(s, s.add_library(root, name))
    lib.full_scan()
    relocate.setup_apply(lib, "Müzik")
    return lib


def tree(p):
    out = {}
    for dp, dn, fn in os.walk(p):
        for f in fn:
            ap = os.path.join(dp, f)
            out[os.path.relpath(ap, p).replace(os.sep, "/")] = os.path.getsize(ap)
    return out


def test_library_in_folder_warns():
    lib = fresh("warn")
    loc = targets.check_location(lib.root, lib, role="library")
    assert not loc["drive_root"] and loc["engine"]
    assert any(p["code"] == "not_root" for p in loc["problems"]), loc


def test_export_structure_incremental_and_stale():
    lib = fresh("exp")
    dst = os.path.join(TMP, "exp", "KART")
    os.makedirs(dst)
    before = tree(lib.root)
    pl = targets.plan(lib, dst)
    assert not pl["blocked"], pl["problems"]
    r = targets.export(lib, dst)
    assert r["files"] > 0 and r["dbs"] >= 1, r
    # yapı kökte: Engine Library, Müzik, _Serato_ — "melis_dj_muzik" alt klasörü YOK
    assert os.path.isfile(os.path.join(dst, "Engine Library", "Database2", "m.db"))
    assert os.path.isdir(os.path.join(dst, "Müzik", "Halay")) and os.path.isdir(os.path.join(dst, "_Serato_"))
    assert not os.path.exists(os.path.join(dst, "melis_dj_muzik"))
    con = sqlite3.connect(os.path.join(dst, "Engine Library", "Database2", "m.db"))
    paths = [p for (p,) in con.execute("SELECT path FROM Track")]
    con.close()
    for p in paths:                           # göreli yollar hedefte de dosyayı bulur
        if p.startswith("../Müzik/"):
            assert os.path.isfile(os.path.normpath(os.path.join(dst, "Engine Library", p))), p
    assert tree(lib.root) == before, "kaynak değişmemeli"
    assert not [k for k in tree(dst) if k.endswith(".djdtmp")]
    # ikinci aktarım: yalnızca değişen (hiçbiri) + veritabanları
    pl2 = targets.plan(lib, dst)
    assert pl2["summary"]["files"] == 0, pl2["summary"]
    # kaynakta bir dosya karantinaya gitti (ör. kopya birleştirme) -> hedefte silinmez, karantinaya taşınır
    gone = next(k for k in tree(lib.root) if k.startswith("Müzik/Halay/") and "/._" not in k)
    os.makedirs(os.path.join(TMP, "exp", "ayri"), exist_ok=True)
    shutil.move(os.path.join(lib.root, *gone.split("/")), os.path.join(TMP, "exp", "ayri", "x.mp3"))
    r2 = targets.export(lib, dst)
    assert r2["stale_moved"] == 1, r2
    assert not os.path.exists(os.path.join(dst, *gone.split("/")))
    q = [k for k in tree(dst) if k.startswith("_DJDoktor_/Karantina/") and k.endswith(gone.split("/")[-1])]
    assert q, "eski kopya hedefte karantinada olmalı"


def test_foreign_library_blocks_then_set_aside():
    lib = fresh("foreign")
    dst = os.path.join(TMP, "foreign", "BASKA")
    os.makedirs(os.path.join(dst, "Engine Library", "Database2"))
    with open(os.path.join(dst, "Engine Library", "Database2", "m.db"), "wb") as f:
        f.write(b"baska")
    pl = targets.plan(lib, dst)
    assert pl["blocked"] and any(p["code"] == "foreign" for p in pl["problems"]), pl["problems"]
    try:
        targets.export(lib, dst)
        assert False, "yabancı kütüphanenin üstüne yazılmamalı"
    except UserError:
        pass
    moved = targets.set_aside(dst)
    assert moved and os.path.isfile(os.path.join(dst, moved[0]["to"], "Database2", "m.db"))   # silinmedi
    assert not targets.plan(lib, dst)["blocked"]


def test_conflict_not_overwritten_and_guards():
    lib = fresh("conf")
    dst = os.path.join(TMP, "conf", "KART")
    rel = next(k for k in tree(lib.root) if k.startswith("Müzik/Horon/") and "/._" not in k)
    os.makedirs(os.path.dirname(os.path.join(dst, *rel.split("/"))))
    with open(os.path.join(dst, *rel.split("/")), "wb") as f:
        f.write(b"kullanicinin baska dosyasi")
    pl = targets.plan(lib, dst)
    assert rel in pl["conflicts"], pl["conflicts"]
    targets.export(lib, dst)
    with open(os.path.join(dst, *rel.split("/")), "rb") as f:
        assert f.read() == b"kullanicinin baska dosyasi"       # üstüne yazılmadı
    # hedef = kaynak / kaynağın içi
    assert targets.plan(lib, lib.root)["blocked"]
    assert targets.plan(lib, os.path.join(lib.root, "Müzik"))["blocked"]
    # Engine açıkken aktarılmaz
    orig = engine.is_running
    engine.is_running = lambda fresh=False: True
    try:
        targets.export(lib, os.path.join(TMP, "conf", "KART2"))
        assert False
    except UserError as e:
        assert e.code == "engine_open"
    finally:
        engine.is_running = orig


def test_progress_moves_inside_big_file():
    """Büyük dosya (potpori) kopyalanırken ilerleme dosya bitmeden de ilerler (takılmış görünmesin)."""
    lib = fresh("big")
    big = os.path.join(lib.root, "Müzik", "Halay", "Uzun Potpori.mp3")
    with open(big, "wb") as f:
        f.write(os.urandom(1024) * (20 * 1024))         # 20 MB
    dst = os.path.join(TMP, "big", "KART")
    os.makedirs(dst)
    seen = []
    old, targets.REPORT_EVERY = targets.REPORT_EVERY, 0
    try:
        targets.export(lib, dst, progress=lambda r, m=None: seen.append((r, m)))
    finally:
        targets.REPORT_EVERY = old
    mid = [m for r, m in seen if m and "Uzun Potpori" in m]
    assert len(mid) >= 2 and any("/sn" in m for m in mid), mid[:5]


def test_resume_after_cancel():
    lib = fresh("resume")
    dst = os.path.join(TMP, "resume", "KART")
    os.makedirs(dst)
    n = [0]

    def cancel():
        n[0] += 1
        return n[0] > 3
    r = targets.export(lib, dst, cancel=cancel)
    k = r["files"]
    assert r["stopped"] and k >= 1, r
    assert not [x for x in tree(dst) if x.endswith(".djdtmp")], "yarım geçici dosya kalmamalı"
    pl = targets.plan(lib, dst)
    assert pl["summary"]["files"] == pl["summary"]["total"] - pl["summary"]["dbs"] - k - pl["summary"]["adopt"], pl["summary"]
    r2 = targets.export(lib, dst)
    assert not r2["stopped"] and r2["dbs"] >= 1


def main(argv):
    names_ = argv[1:] or sorted(k for k in globals() if k.startswith("test_"))
    ok = bad = 0
    for n in names_:
        t0 = time.time()
        try:
            globals()[n]()
            ok += 1
            print("OK    %s  (%.1f sn)" % (n, time.time() - t0))
        except Exception:
            bad += 1
            print("FAIL  %s" % n)
            traceback.print_exc()
    print("%d geçti, %d başarısız  (%s)" % (ok, bad, TMP))
    if not bad:
        shutil.rmtree(TMP, ignore_errors=True)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
