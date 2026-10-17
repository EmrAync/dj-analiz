"""Mix Asistanı testleri (pytest gerekmez; ağ yok): python3 -B tests/test_assistant.py [test_adı]

Sahte SSD tests/make_fixture.py ile kurulur; ton / BPM'li ek şarkılar testin kendi kopyasına yazılır.
Hız testleri diskten bağımsız, elle kurulan modellerle yapılır (5.000 şarkı)."""
from __future__ import annotations

import io
import json
import os
import random
import shutil
import sqlite3
import sys
import tempfile
import time
import traceback
import urllib.error

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "vendor"))
sys.path.insert(0, os.path.join(HERE, ".."))

import make_fixture  # noqa: E402

TMP = tempfile.mkdtemp(prefix="djd_asst_", dir=os.environ.get("DJD_TEST_BASE"))
os.environ["DJDOKTOR_HOME"] = os.path.join(TMP, "ws")
os.environ["HOME"] = os.path.join(TMP, "home")
os.environ.pop("ANTHROPIC_API_KEY", None)
os.makedirs(os.path.join(TMP, "home", "Music"), exist_ok=True)

from mutagen.id3 import ID3, TBPM, TKEY  # noqa: E402

from djdoktor import ai, assistant as A, engine, journal, keys as K, lists, relocate, serato  # noqa: E402
from djdoktor.config import Settings  # noqa: E402
from djdoktor.library import Library, UserError  # noqa: E402

PREFS = {"ai_api_key": "sk-ant-test-1234567890", "ai_model": "", "ai_effort": "low"}

# (göreli yol, seed, başlık, sanatçı, BPM, ton, yorum)
TAGGED = [
    ("melis music/HALAYLAR/Halay A.mp3", 101, "Halay A", "Grup A", 100, "Am", "8A - Energy 7"),
    ("melis music/HALAYLAR/Halay B.mp3", 102, "Halay B", "Grup B", 102, "9A", None),
    ("melis music/HALAYLAR/Halay C.mp3", 103, "Halay C", "Grup C", 98, "8B", None),
    ("melis music/HALAYLAR/Halay D.mp3", 104, "Halay D", "Grup D", 125, "3A", None),
    ("melis music/HALAYLAR/Halay E.mp3", 105, "Halay E", "Grup E", 200, "8A", None),
    ("melis music/HALAYLAR/Halay F.mp3", 106, "Halay F", "Grup A", 101, "8A", None),
    ("melis music/HORON/Horon X.mp3", 107, "Horon X", "Kemençe Ekibi", 140, "10A", None),
    ("melis music/SLOW/Slow 1.mp3", 108, "Slow 1", "Sanatçı S", 70, "8A", None),
    ("melis music/SLOW/Slow 2.mp3", 109, "Slow 2", "Sanatçı T", 72, "7A", None),
    ("melis music/KARISIK POP/Pop 1.mp3", 110, "Pop 1", "Pop Yıldızı", 101, "9B", None),
    ("melis music/KARISIK POP/Pop 2.mp3", 111, "Pop 2", "Pop Yıldızı", 128, "8A", None),
]


def tagged(root, rel, seed, title, artist, bpm=None, key=None, comment=None):
    p = os.path.join(root, *rel.split("/"))
    make_fixture.write_mp3(p, seed, 160, title, artist, None, comment)
    t = ID3(p)
    if bpm:
        t.add(TBPM(encoding=3, text=str(bpm)))
    if key:
        t.add(TKEY(encoding=3, text=key))
    t.save(p)


def fresh(name, setup=True, extra=None):
    root = os.path.join(TMP, name, "SSD")
    if os.path.exists(os.path.dirname(root)):
        shutil.rmtree(os.path.dirname(root))
    fx = make_fixture.build(root)
    for x in TAGGED:
        tagged(root, *x)
    if extra:
        extra(root, fx)
    s = Settings()
    rec = s.add_library(root, name)
    lib = Library(s, rec)
    lib.full_scan()
    if setup:
        relocate.setup_apply(lib, "Müzik")
        lib.full_scan()
    return lib, fx


def by_title(c):
    return {t.title: t for t in c.m.tracks}


def eng(lib, sql, args=()):
    con = sqlite3.connect(lib.engine_db()["path"])
    try:
        return con.execute(sql, args).fetchall()
    finally:
        con.close()


def synth(n, seed=5, genres=("Halay", "Horon", "Türkçe Pop", "Slow - Çift Dans", "Roman - Mezdeke", "Oyun Havası",
                              "Arabesk", "Ankara")):
    rnd = random.Random(seed)
    ts = []
    for i in range(1, n + 1):
        g = rnd.choice(genres)
        ts.append(A.make_track(i, "Şarkı %d" % i, "Sanatçı %d" % rnd.randint(1, n // 3 + 1), genre=g,
                               bpm=None if rnd.random() < .08 else rnd.uniform(85, 135),
                               cam="" if rnd.random() < .08 else K.cam_of_index(rnd.randrange(24)),
                               dur=rnd.uniform(150, 330), ready=rnd.random() < .85))
    return A.Ctx(A.Model(ts))


class _Resp(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def fake_opener(reply, seen):
    """Messages API yanıtı taklidi: reply(body) -> dict (modelin JSON çıktısı)."""
    def op(req, timeout=None):
        body = json.loads(req.data.decode("utf-8"))
        seen.append(body)
        out = reply(body)
        return _Resp(json.dumps({"model": "claude-opus-5-5", "stop_reason": "end_turn",
                                 "content": [{"type": "text", "text": json.dumps(out, ensure_ascii=False)}],
                                 "usage": {"input_tokens": 1000, "output_tokens": 200}}).encode("utf-8"))
    return op


def http_error(code):
    def op(req, timeout=None):
        raise urllib.error.HTTPError(req.full_url, code, "x", {}, io.BytesIO(b'{"error":{"message":"x"}}'))
    return op


class FakeH:
    """server.Handler yerine: _json / _err çağrılarını yakalar."""

    def __init__(self, prefs=None):
        self.out = None
        self.code = 200

        class _S:
            def prefs(_s):
                return dict(prefs or {})

        class _App:
            settings = _S()
        self.app = _App()

    def _json(self, obj, code=200):
        self.out, self.code = json.loads(json.dumps(obj, default=str)), code
        return True

    def _err(self, msg, code=400, ecode=None):
        return self._json({"error": msg, "code": ecode}, code)


# ---------------------------------------------------------------------------
def test_camelot_relations():
    R = lambda a, b: K.relation(a, b)["code"]  # noqa: E731
    assert R("8A", "8A") == "same"
    assert R("8A", "9A") == "up1" and R("8A", "7A") == "down1"
    assert R("12A", "1A") == "up1" and R("1B", "12B") == "down1"          # çarkın başı / sonu
    assert R("8A", "8B") == "relative" and R("8B", "8A") == "relative"
    assert R("8A", "9B") == "diagonal" and R("8B", "7A") == "diagonal"
    assert R("8A", "7B") == "diagonal2" and R("8B", "9A") == "diagonal2"
    assert R("8A", "10A") == "boost2" and R("8A", "6A") == "drop2"
    assert R("8A", "3A") == "semi_up" and R("8A", "1A") == "semi_down"
    assert R("8A", "2B") == "clash" and R("8A", "11A") == "near_clash"
    assert K.relation("8A", "") is None and K.relation("x", "8A") is None
    s = lambda a, b: K.relation(a, b)["score"]  # noqa: E731
    assert s("8A", "8A") > s("8A", "9A") > s("8A", "8B") > s("8A", "9B") > s("8A", "10A") > s("8A", "3A") > \
        s("8A", "11A") > s("8A", "2B")
    assert K.relation("8A", "9B")["lift"] == 1 and K.relation("8B", "7A")["lift"] == -1
    assert K.relation("8A", "10A")["label"] == "Enerji yükseltme +2" and K.relation("8A", "2B")["label"] == "Ton çatışması"
    comp = [x[0] for x in K.compatible_keys("8A")]
    assert comp[:4] == ["8A", "9A", "7A", "8B"] and "2B" not in comp
    for i in range(24):                      # hızlı tablo ile tek tek hesap aynı
        for j in range(24):
            r = K.relation(K.cam_of_index(i), K.cam_of_index(j))
            assert K.REL_SCORE[i][j] == r["score"] and K.REL_LIFT[i][j] == r["lift"]
    assert K.cam_index("1A") == 0 and K.cam_index("12B") == 23 and K.cam_of_index(15) == "8B"
    assert K.compatible("8A", "9A") == "uyumlu"              # eski yardımcı değişmedi
    assert K.tempo_diff(70, 140) == (0.0, .5) and K.tempo_diff(140, 70) == (0.0, 2.0)
    d, r = K.tempo_diff(128, 126)
    assert r == 1.0 and abs(d - 1.5625) < 1e-9 and K.tempo_diff(100, None) == (None, None)


def test_transition_scoring():
    mk = A.make_track
    a = mk(1, "A", "X", genre="Halay", bpm=100, cam="8A", dur=200)
    c = A.Ctx(A.Model([a, mk(2, "B", "Y", genre="Halay", bpm=101, cam="9A"),
                       mk(3, "C", "Z", genre="Halay", bpm=200, cam="8A"),       # çift tempo
                       mk(4, "D", "W", genre="Halay", bpm=50, cam="8A"),        # yarım tempo
                       mk(5, "E", "V", genre="Slow - Çift Dans", bpm=125, cam="2B"),
                       mk(6, "F", "X", genre="Halay", bpm=100, cam="8A"),       # aynı sanatçı
                       mk(7, "G", "U", genre="Halay"),                          # ton / BPM yok
                       mk(8, "H", "T", genre="Kürtçe Halay", bpm=100, cam="8A")]), rng=6)
    m = c.m.by_id
    t2 = A.transition(c, a, m[2])
    assert t2["score"] >= 85 and "Komşu ton (+1)" in t2["reasons"] and t2["rel"] == "up1", t2
    t3 = A.transition(c, a, m[3])
    assert t3["tempo"] == "double" and t3["parts"]["bpm"] >= .9 and "Çift tempo" in t3["reasons"], t3
    t4 = A.transition(c, a, m[4])
    assert t4["tempo"] == "half" and "Yarım tempo" in t4["reasons"], t4
    t5 = A.transition(c, a, m[5])
    assert t5["score"] < 40 and "Ton çatışması" in t5["warns"] and any("Tempo farkı" in w for w in t5["warns"]), t5
    assert t5["parts"]["genre"] == .25 and t5["de"] < 0
    t6 = A.transition(c, a, m[6])
    assert t6["parts"]["variety"] == 0 and "Aynı sanatçı" in t6["warns"] and t6["score"] < A.transition(c, a, m[8])["score"]
    t7 = A.transition(c, a, m[7])
    assert t7["parts"]["key"] == A.UNKNOWN and "Ton bilinmiyor" in t7["warns"] and "BPM bilinmiyor" in t7["warns"]
    t8 = A.transition(c, a, m[8])
    assert t8["parts"]["genre"] == .7 and "Yakın tür" in t8["reasons"]
    # tempo aralığı: %6 içinde puan yüksek, iki katında sıfır
    assert A._bpm_fit(0, 6) == 1 and A._bpm_fit(6, 6) > .6 and A._bpm_fit(12, 6) == 0 and A._bpm_fit(3, 6) > A._bpm_fit(5, 6)
    c2 = A.Ctx(c.m, rng=2)                  # Ayarlar'da dar aralık: aynı fark daha kötü
    assert A.transition(c2, a, m[2])["parts"]["bpm"] < t2["parts"]["bpm"]
    # öğrenilmiş çift puanı yükseltir ve gerekçe yazar
    c3 = A.Ctx(c.m, {"succ": {1: {7: [2.0, A.HIST_FLAG["history"]]}}})
    t7b = A.transition(c3, a, m[7])
    assert t7b["score"] > t7["score"] + 10 and "Daha önce arka arkaya çaldın" in t7b["reasons"]
    # enerji yönü
    hi = mk(9, "Hi", "S", genre="Horon", bpm=100, cam="8A", energy=9)
    lo = mk(10, "Lo", "R", genre="Halay", bpm=100, cam="8A", energy=4)
    mid = mk(11, "Mid", "Q", genre="Halay", bpm=100, cam="8A", energy=7)
    c4 = A.Ctx(A.Model([hi, lo, mid]))
    assert A.score(c4, mid, hi, "up") > A.score(c4, mid, lo, "up")
    assert A.score(c4, mid, lo, "down") > A.score(c4, mid, hi, "down")
    assert not mid.e_est and a.e_est and A.estimate_energy("slow", 70) <= 3 and A.estimate_energy("horon", 140) >= 9


def test_model_from_library():
    lib, fx = fresh("model")
    c = A.context(lib)
    bt = by_title(c)
    ha = bt["Halay A"]
    assert ha.genre == "Halay" and ha.cam == "8A" and ha.bpm == 100 and ha.energy == 7 and not ha.e_est, vars(ha)
    assert bt["Halay B"].e_est and bt["Halay B"].energy >= 7
    assert bt["Slow 1"].genre == "Slow - Çift Dans" and bt["Slow 1"].energy <= 4
    assert "clap 01" not in bt                                   # Samples klasörü yok sayılıyor
    titles = [t.title for t in c.m.tracks]
    assert titles.count("Halay Başı") == 1 and titles.count("Delilo") == 1   # kopyalar modelde yok
    assert ha.ready is False and ha.dot == "pending"              # kurulumda Engine'e eklendi, analiz bekliyor
    st = lib.engine_state()
    h1 = bt["Halay Başı"]
    assert st["status"].get(h1.id) == "ready" and h1.ready
    # önbellek: aynı veriyle aynı nesne, paylaşılan satırlar değişmedi
    assert A.model(lib) is c.m
    f = next(x for x in lib.audio_files() if x["id"] == ha.id)
    assert "energy" not in f and "cam" not in f
    w = A.camelot_wheel(c)
    n8a = next(k["n"] for k in w["keys"] if k["cam"] == "8A")
    assert n8a == 5 and w["total"] == len(c.m.tracks) and sum(k["n"] for k in w["keys"]) + w["unknown"] == w["total"]
    w2 = A.camelot_wheel(c, {"genres": ["Halay"]}, around=ha.id)
    assert w2["total"] < w["total"] and w2["around"]["id"] == ha.id and w2["compatible"][0]["cam"] == "8A"
    kt = A.key_tracks(c, "8A", {}, around=ha.id)
    assert {r["title"] for r in kt["rows"]} >= {"Halay E", "Slow 1", "Pop 2"} and kt["musical"] == "Am"
    assert A.search(c, "halay a")[0]["title"] == "Halay A" and A.search(c, "") == []
    inf = A.info(lib, c)
    assert inf["with_key"] == 11 and inf["mik_energy"] == 1 and inf["ai"]["key_set"] is False
    assert any(g["name"] == "Halay" for g in inf["genres"]) and len(inf["curves"]) == 5


def test_events_compatible():
    """Şarkı ayrıntısındaki 'Uyumlu şarkılar': keys.relation + Ayarlar'daki tempo aralığı."""
    from djdoktor import events
    lib, fx = fresh("compat")
    bt = by_title(A.context(lib))
    comp = events.compatible(lib, bt["Halay A"].id)
    got = {c["title"]: c for c in comp}
    assert {"Halay B", "Halay C", "Halay E", "Halay F"} <= set(got), list(got)
    assert not {"Slow 1", "Pop 2", "Halay D", "Horon X"} & set(got), list(got)
    assert got["Halay C"]["match"] == "paralel (a↔b)" and got["Halay F"]["match"] == "aynı ton"
    assert comp[0]["title"] in ("Halay E", "Halay F")              # önce aynı ton, en yakın tempo
    lib.settings.set_prefs(mix_bpm_range=1)
    try:
        got = {c["title"] for c in events.compatible(lib, bt["Halay A"].id)}
        assert got == {"Halay E", "Halay F"}, got
        c = A.context(lib)
        assert c.rng == 1.0
    finally:
        lib.settings.set_prefs(mix_bpm_range=6)


def _write_history(root, fx):
    """Engine hm.db (Historylist) + Serato oturum dosyası: test için sahte çalma geçmişi."""
    db = os.path.join(root, "Engine Library", "Database2", "hm.db")
    con = sqlite3.connect(db)
    con.execute("CREATE TABLE Historylist (id INTEGER PRIMARY KEY, sessionId INTEGER, title TEXT, startTime INTEGER)")
    con.execute("CREATE TABLE HistorylistEntity (id INTEGER PRIMARY KEY, listId INTEGER, trackId INTEGER, "
                "startTime INTEGER)")
    con.execute("INSERT INTO Historylist VALUES (1, 1, 'Düğün', 1000)")
    t = fx["tracks"]
    # Delilo -> Horon 1 -> Yeni Oyun Havası, iki gece üst üste
    for k, (tid, ts) in enumerate([(t["delilo"], 1), (t["horon1"], 2), (t["oyun"], 3)]):
        con.execute("INSERT INTO HistorylistEntity(listId, trackId, startTime) VALUES (1, ?, ?)", (tid, ts))
    con.execute("INSERT INTO Historylist VALUES (2, 2, 'Kına', 2000)")
    for tid, ts in [(t["delilo"], 11), (t["horon1"], 12)]:
        con.execute("INSERT INTO HistorylistEntity(listId, trackId, startTime) VALUES (2, ?, ?)", (tid, ts))
    con.commit()
    con.close()
    # Serato: Mac'teki tam yol ('/Volumes/<SSD>/...'), alan 2 = yol, 1 = satır
    sess = os.path.join(root, "_Serato_", "History", "Sessions")
    os.makedirs(sess, exist_ok=True)

    def ent(row, path):
        adat = b"".join(
            f.to_bytes(4, "big") + len(v).to_bytes(4, "big") + v
            for f, v in ((1, row.to_bytes(4, "big")), (2, (path + "\x00").encode("utf-16-be"))))
        return serato.serialize([(b"adat", adat)])
    data = serato.serialize([(b"vrsn", serato.u16("1.0/Serato Scratch LIVE Review"))] + [
        (b"oent", ent(i, p)) for i, p in enumerate([
            "/Volumes/Serato DJ/melis music/SLOW/Slow 1.mp3",
            "/Volumes/Serato DJ/melis music/SLOW/Slow 2.mp3",
            "D:\\melis music\\KARISIK POP\\Pop 1.mp3"])])
    with open(os.path.join(sess, "12.session"), "wb") as f:
        f.write(data)
    with open(os.path.join(sess, "13.session"), "wb") as f:   # bozuk dosya: atlanmalı
        f.write(b"oent\x00\x00\x00\x09garbage")


def test_learned_pairs():
    lib, fx = fresh("learn", setup=False, extra=_write_history)
    before_hm = open(os.path.join(lib.root, "Engine Library", "Database2", "hm.db"), "rb").read()
    c = A.context(lib)
    bt = by_title(c)
    L = c.succ
    # Engine listesi "Halaylar": Halay Başı -> Delilo -> Çiftetelli Halay
    hb, de, ci = bt["Halay Başı"].id, bt["Delilo"].id, bt["Çiftetelli Halay"].id
    assert L[hb][de][1] & A.HIST_FLAG["list"] and L[de][ci][1] & A.HIST_FLAG["list"], L.get(hb)
    assert L[de][hb][1] == 0 and L[de][hb][0] < L[hb][de][0]            # ters yön zayıf
    # Serato crate'i "Düğün 2024": Yolla -> Horon 1 (zayıf)
    h1 = bt["Horon 1"].id
    # Engine geçmişi: Delilo -> Horon 1 iki kez, Horon 1 -> Yeni Oyun Havası bir kez
    assert L[de][h1][1] & A.HIST_FLAG["history"] and L[de][h1][0] >= 2.0, L[de].get(h1)
    oy = bt["Yeni Oyun Havası"].id
    assert L[h1][oy][1] & A.HIST_FLAG["history"]
    assert c.plays[de] == 2 and c.plays[h1] == 2
    # Serato oturumu (Mac ve Windows yolları): Slow 1 -> Slow 2 -> Pop 1
    s1, s2, p1 = bt["Slow 1"].id, bt["Slow 2"].id, bt["Pop 1"].id
    assert L[s1][s2][1] & A.HIST_FLAG["history"] and L[s2][p1][1] & A.HIST_FLAG["history"], L.get(s1)
    assert c.info["history_sessions"] == 3 and c.info["lists"] >= 2, c.info
    # "sonra ne çalınır" geçmişi öne çıkarır ve gerekçesini yazar
    nx = A.next_tracks(c, de)
    first = nx["items"][0]
    assert first["id"] == h1 and "Daha önce arka arkaya çaldın" in first["reasons"], nx["items"][:3]
    # hm.db'ye dokunulmadı
    assert open(os.path.join(lib.root, "Engine Library", "Database2", "hm.db"), "rb").read() == before_hm
    assert not os.path.exists(os.path.join(lib.root, "Engine Library", "Database2", "hm.db-journal"))
    # önbellek: aynı durumda yeniden hesaplanmaz; geçmiş değişince yenilenir
    assert A.learned(lib) is A.learned(lib)
    old = A.learned(lib)
    with open(os.path.join(lib.root, "_Serato_", "History", "Sessions", "14.session"), "wb") as f:
        f.write(b"")
    assert A.learned(lib) is not old


def test_next_tracks():
    lib, fx = fresh("next")
    c = A.context(lib)
    bt = by_title(c)
    ha = bt["Halay A"]
    r = A.next_tracks(c, ha.id, limit=50)
    ids = [x["id"] for x in r["items"]]
    assert ha.id not in ids and r["cur"]["id"] == ha.id
    top = r["items"][0]
    assert top["cam"] in ("8A", "9A", "7A", "8B") and top["score"] >= 75, r["items"][:3]
    pos = {x["title"]: i for i, x in enumerate(r["items"])}
    assert pos["Halay B"] < pos["Halay D"] and pos["Halay C"] < pos["Halay D"]   # 3A / 125 BPM en sona yakın
    assert pos["Halay E"] < pos["Horon X"]                                       # çift tempo + aynı ton
    hf = next(x for x in r["items"] if x["title"] == "Halay F")
    assert "Aynı sanatçı" in hf["warns"]
    # filtreler
    r2 = A.next_tracks(c, ha.id, filters={"genres": ["Slow - Çift Dans"]})
    assert {x["genre"] for x in r2["items"]} == {"Slow - Çift Dans"}
    gid = next(g["id"] for g in lib.genre_rows() if g["name"] == "Halay")
    r3 = A.next_tracks(c, ha.id, filters={"genres": [gid], "bpm_min": 99, "bpm_max": 103})
    assert {x["title"] for x in r3["items"]} == {"Halay B", "Halay F"}, [x["title"] for x in r3["items"]]
    r4 = A.next_tracks(c, ha.id, filters={"ready": True})
    assert r4["items"] and all(x["ready"] for x in r4["items"])
    r5 = A.next_tracks(c, ha.id, filters={"exclude": [bt["Halay B"].id]})
    assert bt["Halay B"].id not in [x["id"] for x in r5["items"]]
    r6 = A.next_tracks(c, ha.id, filters={"energy": "down"}, limit=5)
    assert all(x["energy"] <= ha.energy for x in r6["items"][:3]), r6["items"]
    r7 = A.next_tracks(c, bt["Halay B"].id, prev_fid=ha.id)
    assert ha.id not in [x["id"] for x in r7["items"]] and r7["prev"]["id"] == ha.id
    try:
        A.next_tracks(c, 999999)
        raise AssertionError("bilinmeyen şarkı hata vermeli")
    except UserError as e:
        assert e.code == "gone"
    # API
    h = FakeH()
    A._api(h, lib, "POST", ["assistant", "next"], {}, {"id": ha.id, "filters": {"genres": ["Halay"]}, "limit": 3})
    assert h.code == 200 and len(h.out["items"]) == 3 and h.out["items"][0]["genre"] == "Halay"
    h = FakeH()
    A._api(h, lib, "GET", ["assistant", "wheel"], {"genres": "Halay", "around": str(ha.id)}, {})
    assert h.out["around"]["id"] == ha.id and h.out["total"] >= 6
    h = FakeH()
    A._api(h, lib, "GET", ["assistant", "info"], {}, {})
    assert h.out["total"] == len(c.m.tracks)
    assert A._api(FakeH(), lib, "GET", ["assistant", "nope"], {}, {}) is None


def test_harmonic_sort():
    c = synth(200)
    ids = [t.id for t in c.m.tracks]
    random.Random(3).shuffle(ids)
    t0 = time.time()
    r = A.harmonic_sort(c, ids + [999999])
    dt = time.time() - t0
    assert dt < 1.0, dt
    assert sorted(r["order"][:-1]) == sorted(ids) and r["order"][-1] == 999999 and r["missing"] == [999999]
    assert r["after"]["total"] > r["before"]["total"] * 1.5 and r["after"]["avg"] > 70, (r["before"], r["after"])
    assert len(r["transitions"]) == 199 and r["transitions"][0]["from"] == r["order"][0]
    # sabit başlangıç / bitiş
    r2 = A.harmonic_sort(c, ids, fixed_first=ids[10], fixed_last=ids[20])
    assert r2["order"][0] == ids[10] and r2["order"][-1] == ids[20] and sorted(r2["order"]) == sorted(ids)
    # küçük listede en iyi sıra bulunur (kaba kuvvetle karşılaştır)
    import itertools
    small = A.Ctx(A.Model([A.make_track(1, "a", "1", genre="Halay", bpm=100, cam="8A"),
                           A.make_track(2, "b", "2", genre="Halay", bpm=100, cam="10A"),
                           A.make_track(3, "c", "3", genre="Halay", bpm=100, cam="9A"),
                           A.make_track(4, "d", "4", genre="Halay", bpm=100, cam="11A"),
                           A.make_track(5, "e", "5", genre="Halay", bpm=100, cam="12A")]))
    best = max(sum(A.score(small, small.m.by_id[p[k]], small.m.by_id[p[k + 1]]) for k in range(4))
               for p in itertools.permutations([1, 2, 3, 4, 5]))
    got = A.harmonic_sort(small, [5, 1, 4, 2, 3])
    tot = sum(A.score(small, small.m.by_id[a], small.m.by_id[b]) for a, b in zip(got["order"], got["order"][1:]))
    assert abs(tot - best) < 1e-6 and got["order"] == [1, 3, 2, 4, 5], got["order"]
    # sonuç asla başlangıçtan kötü değil
    for seed in range(5):
        cc = synth(30, seed)
        o = [t.id for t in cc.m.tracks]
        rr = A.harmonic_sort(cc, o)
        assert rr["after"]["total"] >= rr["before"]["total"] - 2, (rr["before"], rr["after"])
    # enerji eğrisi: yükselen sırada ilk çeyrek son çeyrekten sakin
    rc = A.harmonic_sort(c, ids[:60], curve="rising")
    es = [x["energy"] for x in rc["rows"]]
    assert sum(es[:15]) / 15 + 1 < sum(es[-15:]) / 15, es
    assert A.harmonic_sort(c, [ids[0]])["order"] == [ids[0]] and A.harmonic_sort(c, [])["order"] == []


def test_build_set():
    c = synth(5000)
    times = {}
    res = {}
    for curve in ("flat", "rising", "wave", "peak", "cooldown"):
        t0 = time.time()
        b = A.build_set(c, {"minutes": 60, "curve": curve})
        times[curve] = time.time() - t0
        res[curve] = b
        d = b["summary"]["dur"]
        assert 55 * 60 <= d <= 70 * 60, (curve, d)
        assert len(set(b["sections"][0]["ids"])) == len(b["sections"][0]["ids"])
        assert b["summary"]["avg"] > 75, (curve, b["summary"])
    assert max(times.values()) < 2.0, times
    er = [r["energy"] for r in res["rising"]["rows"]]
    ec = [r["energy"] for r in res["cooldown"]["rows"]]
    q = max(1, len(er) // 4)
    assert sum(er[:q]) / q + 2 <= sum(er[-q:]) / q, er
    assert sum(ec[:q]) / q >= sum(ec[-q:]) / q + 2, ec
    assert all(abs(r["energy"] - r["target"]) <= 3 for r in res["flat"]["rows"]), res["flat"]["rows"]
    # aynı girdi -> aynı set
    again = A.build_set(c, {"minutes": 60, "curve": "rising"})
    assert again["sections"] == res["rising"]["sections"]
    # tür, yalnızca hazır, başlangıç şarkıları, BPM yolu
    seeds = [t.id for t in c.m.tracks if t.genre == "Halay" and t.ready][:2]
    b = A.build_set(c, {"minutes": 45, "genres": ["Halay"], "only_ready": True, "seeds": seeds, "curve": "rising",
                        "bpm_start": 95, "bpm_end": 120})
    ids = b["sections"][0]["ids"]
    assert ids[0] == seeds[0] and seeds[1] in ids
    assert all(c.m.by_id[i].genre == "Halay" and c.m.by_id[i].ready for i in ids)
    bp = [c.m.by_id[i].bpm for i in ids if c.m.by_id[i].bpm]
    assert sum(bp[:3]) / 3 < sum(bp[-3:]) / 3, bp
    # yetersiz havuz uyarısı
    small = synth(6, 2, genres=("Horon",))
    w = A.build_set(small, {"minutes": 90})
    assert any("yeterli şarkı yok" in x for x in w["warnings"]) and len(w["sections"][0]["ids"]) == 6
    e = A.build_set(small, {"minutes": 30, "genres": ["Kına"]})
    assert e["sections"] == [] and e["warnings"]


def _set_reply(n_tracks):
    def reply(body):
        return {"title": "Kına Gecesi", "notes": "Sakin başla, halayla bitir.",
                "sections": [{"name": "Karşılama", "tracks": [{"i": 0, "why": "sakin giriş"}, {"i": 1, "why": "aynı ton"},
                                                               {"i": -1, "why": "geçersiz"}]},
                             {"name": "Halay", "tracks": [{"i": 2, "why": "coşku"}, {"i": 1, "why": "tekrar"},
                                                          {"i": n_tracks + 50, "why": "yok"}, {"i": 3, "why": "+1 ton"}]},
                             {"name": "Boş", "tracks": [{"i": 99999, "why": "yok"}]}]}
    return reply


def test_ai_build_fake():
    lib, fx = fresh("ai")
    c = A.context(lib)
    bt = by_title(c)
    seen = []
    seed = bt["Halay A"].id
    res = A.ai_build(c, {"request": "Kına gecesi, 30 dakika, sakin başlasın sonunda coşsun", "genres": ["Halay"],
                         "seeds": [seed]}, PREFS, opener=fake_opener(_set_reply(20), seen))
    assert res["source"] == "ai" and res["title"] == "Kına Gecesi", res
    assert [s["name"] for s in res["sections"]] == ["Karşılama", "Halay"]       # boş bölüm atıldı
    assert res["dropped"] == 4 and any("atlandı" in w for w in res["warnings"]), res
    flat = [x for s in res["sections"] for x in s["ids"]]
    assert len(flat) == len(set(flat)) == 4 and len(res["transitions"]) == 3
    assert res["rows"][0]["why"] == "sakin giriş" and res["minutes"] == 30
    body = seen[0]
    prompt = body["messages"][0]["content"]
    assert body["system"] == A.AI_SYSTEM and body["output_config"]["format"]["schema"] == A.AI_SET_SCHEMA
    # ilk aday başlangıç şarkısı; istek ve hedef süre istemde
    lines = prompt.split("\n")
    i0 = lines.index("Adaylar (i | ad | sanatçı | tür | BPM | Camelot | enerji | süre):")
    assert lines[i0 + 1].startswith("0 | Halay A | Grup A | Halay | 100 | 8A | 7 |"), lines[i0 + 1]
    assert "Hedef süre: 30 dakika" in prompt and "Başlangıç şarkıları" in prompt and "Kına gecesi" in prompt
    assert len(lines) - i0 - 1 <= A.AI_MAX + 3
    # gizlilik: dosya yolu / klasör adı / kök gönderilmez (tür adı serbest)
    gnames = {g["name"] for g in lib.genre_rows()}
    meta = {x for t in c.m.tracks for x in (t.title, t.artist)}       # sanatçı adıyla aynı klasör adı olabilir
    for f in lib.audio_files():
        assert f["rel"] not in prompt
        for part in f["rel"].split("/")[:-1]:
            if part not in gnames and part not in meta:
                assert part not in prompt, part
        assert f["name"] not in prompt
    assert lib.root not in prompt and "/" not in "\n".join(lines[i0 + 1:]), prompt
    # "Geçişleri iyileştir": seçim aynı kalır, bölümler korunur
    imp = A.improve_sections(c, res["sections"])
    assert [sorted(s["ids"]) for s in imp["sections"]] == [sorted(s["ids"]) for s in res["sections"]]
    assert imp["summary"]["total"] >= res["summary"]["total"] - 2


def test_ai_errors_fallback():
    lib, fx = fresh("aierr")
    c = A.context(lib)
    # anahtar yok: istek gönderilmez, çevrimdışı set döner
    calls = []

    def never(req, timeout=None):
        calls.append(1)
        raise AssertionError("anahtarsız istek gitmemeli")
    r = A.ai_build(c, {"request": "Halay, 20 dk, coşkulu", "genres": ["Halay"]}, {"ai_api_key": ""}, opener=never)
    assert not calls and r["source"] == "offline" and r["ai_error"]["code"] == "ai_no_key", r
    assert r["sections"] and r["sections"][0]["ids"] and r["minutes"] == 20
    for code, want in ((401, "ai_auth"), (429, "ai_busy"), (529, "ai_server")):
        r = A.ai_build(c, {"request": "x"}, PREFS, opener=http_error(code))
        assert r["source"] == "offline" and r["ai_error"]["code"] == want and r["sections"], r

    def offline(req, timeout=None):
        raise urllib.error.URLError(OSError("Name or service not known"))
    r = A.ai_build(c, {"request": "x"}, PREFS, opener=offline)
    assert r["ai_error"]["code"] == "ai_offline" and "İnternet" in r["ai_error"]["message"]
    # tümü geçersiz: çevrimdışı + ai_empty
    r = A.ai_build(c, {"request": "x"}, PREFS, opener=fake_opener(
        lambda b: {"title": "t", "notes": "", "sections": [{"name": "a", "tracks": [{"i": 9999, "why": "?"}]}]}, []))
    assert r["source"] == "offline" and r["ai_error"]["code"] == "ai_empty"
    # sonra ne gelsin (AI): hata -> çevrimdışı ilk 5
    ha = by_title(c)["Halay A"].id
    n = A.ai_next(c, ha, PREFS, opener=http_error(401))
    assert n["source"] == "offline" and n["ai_error"]["code"] == "ai_auth" and len(n["items"]) == 5
    # istek ipuçları (anahtar yokken çevrimdışı set için)
    assert A._guess_curve("sakin başlasın, sonunda coşsun") == "rising"
    assert A._guess_curve("coşkulu başla, sakin bitir") == "cooldown"
    assert A._guess_minutes("Kına gecesi, 1,5 saat") == 90 and A._guess_minutes("45 dk") == 45
    # API: anahtar yok -> 200 + çevrimdışı sonuç
    h = FakeH()
    A._api(h, lib, "POST", ["assistant", "ai_build"], {}, {"request": "Halay 15 dk"})
    assert h.code == 200 and h.out["source"] == "offline" and h.out["ai_error"]["code"] == "ai_no_key"
    h = FakeH()
    ai._api(h, None, "POST", ["ai", "test"], {}, {})
    assert h.out["ok"] is False and h.out["code"] == "ai_no_key"
    h = FakeH(PREFS)
    ai._api(h, None, "GET", ["ai", "status"], {}, {})
    assert h.out["key_set"] and h.out["mask"].startswith("sk-ant-") and "1234567890" not in json.dumps(h.out)


def test_ai_next_fake():
    lib, fx = fresh("ainext")
    c = A.context(lib)
    ha = by_title(c)["Halay A"].id
    seen = []

    def reply(body):
        return {"note": "Halayla devam.", "picks": [{"i": 3, "why": "aynı ton"}, {"i": 3, "why": "tekrar"},
                                                    {"i": 500, "why": "yok"}, {"i": 0, "why": "komşu ton"},
                                                    {"i": 1, "why": "x"}, {"i": 2, "why": "y"}, {"i": 4, "why": "z"},
                                                    {"i": 5, "why": "fazla"}]}
    r = A.ai_next(c, ha, PREFS, opener=fake_opener(reply, seen))
    assert r["source"] == "ai" and len(r["items"]) == 5 and r["items"][0]["why"] == "aynı ton", r
    assert len({x["id"] for x in r["items"]}) == 5 and "score" in r["items"][0] and r["note"] == "Halayla devam."
    p = seen[0]["messages"][0]["content"]
    assert "Şu an çalan: Halay A | Grup A | Halay" in p and "/" not in p.split("Adaylar", 1)[1]


def test_save_list_event_undo():
    lib, fx = fresh("save")
    c = A.context(lib)
    bt = by_title(c)
    ids = [bt[x].id for x in ("Halay A", "Halay B", "Halay C")]
    n_tracks = eng(lib, "SELECT COUNT(*) FROM Track")[0][0]
    r = A.save(lib, "list", "Asistan Halay", [{"name": "Set", "ids": ids + [ids[0], "x"]}])
    assert r["kind"] == "list" and r["skipped"] == 0
    st = lib.engine_state(force=True)
    p = next(x for x in st["playlists"] if x["id"] == r["id"])
    assert p["title"] == "Asistan Halay" and [st["fid_of_tid"][t] for t in p["entries"]] == ids
    assert eng(lib, "SELECT COUNT(*) FROM Track")[0][0] == n_tracks          # zaten Engine'deydiler: iki kez yok
    assert lib.catalog.journal_top()["title"].startswith("Yeni liste: Asistan Halay")
    # aynı adla ikinci kez: Engine'deki ad tekil kalır
    r2 = A.save(lib, "list", "Asistan Halay", [{"name": "Set", "ids": ids[:1]}])
    st = lib.engine_state(force=True)
    assert next(x for x in st["playlists"] if x["id"] == r2["id"])["title"] == "Asistan Halay (2)"
    journal.undo_last(lib)
    journal.undo_last(lib)
    st = lib.engine_state(force=True)
    assert not any(x["title"].startswith("Asistan Halay") for x in st["playlists"])
    # etkinlik: bölümlerle, tek 'Geri al'
    secs = [{"name": "Karşılama", "ids": [bt["Slow 1"].id, bt["Slow 2"].id]}, {"name": "Halay", "ids": ids}]
    r3 = A.save(lib, "event", "Kına", secs, date="2026-11-07")
    st = lib.engine_state(force=True)
    ev = next(x for x in st["playlists"] if x["id"] == r3["id"])
    assert ev["path"] == ["Etkinlikler", "07.11.2026 - Kına"], ev["path"]
    kids = [x for x in st["playlists"] if x["parent"] == ev["id"]]
    assert [k["title"] for k in kids] == ["Karşılama", "Halay"]
    assert [st["fid_of_tid"][t] for t in kids[1]["entries"]] == ids
    assert lib.catalog.ev_meta(st["uuid"], ev["id"])["title"] == "Kına"
    journal.undo_last(lib)
    st = lib.engine_state(force=True)
    assert not any(x["id"] == ev["id"] for x in st["playlists"])
    assert lib.catalog.ev_meta(st["uuid"], ev["id"]) in (None, {})
    # Engine DJ açıkken yazılmaz
    orig = engine.is_running
    engine.is_running = lambda fresh=False: True
    try:
        A.save(lib, "list", "Olmaz", [{"name": "Set", "ids": ids}])
        raise AssertionError("Engine açıkken kaydedilmemeli")
    except UserError as e:
        assert e.code == "engine_open"
    finally:
        engine.is_running = orig
    try:
        A.save(lib, "list", "Boş", [{"name": "Set", "ids": []}])
        raise AssertionError("boş liste kaydedilmemeli")
    except UserError:
        pass
    # set kurucu: bir etkinlikte olanları dışarıda bırak (API: exclude_list)
    r4 = A.save(lib, "event", "Nişan", [{"name": "Halay", "ids": ids[:2]}])
    assert set(A.list_fids(lib, r4["id"])) == set(ids[:2])
    h = FakeH()
    A._api(h, lib, "POST", ["assistant", "build"], {}, {"minutes": 30, "genres": ["Halay"], "exclude_list": r4["id"]})
    got = set(h.out["sections"][0]["ids"])
    assert got and not got & set(ids[:2]), got
    h = FakeH()
    A._api(h, lib, "POST", ["assistant", "ai_build"], {}, {"request": "halay", "exclude_used_in_event": r4["id"]})
    assert h.out["source"] == "offline" and not set(h.out["sections"][0]["ids"]) & set(ids[:2])
    journal.undo_last(lib)
    # API ile kaydet
    h = FakeH()
    A._api(h, lib, "POST", ["assistant", "save"], {}, {"kind": "list", "title": "API Liste", "sections": [{"ids": ids}]})
    assert h.out["kind"] == "list" and h.out["journal"]
    journal.undo_last(lib)


def test_list_sort_apply_undo():
    lib, fx = fresh("lsort")
    c = A.context(lib)
    bt = by_title(c)
    order = [bt[x].id for x in ("Halay D", "Halay A", "Pop 2", "Halay C", "Halay B", "Slow 1", "Halay E")]
    r = A.save(lib, "list", "Karışık", [{"ids": order}])
    c = A.context(lib)
    ls = A.list_sort(lib, c, r["id"])
    assert ls["n"] == 7 and sorted(ls["refs"]) == sorted(ls["current"]) and not ls["same"]
    assert ls["after"]["summary"]["total"] > ls["before"]["summary"]["total"], (ls["before"]["summary"], ls["after"]["summary"])
    h = FakeH()
    A._api(h, lib, "POST", ["assistant", "apply_sort"], {}, {"id": r["id"], "refs": ls["refs"]})
    assert h.out == {"ok": True}
    st = lib.engine_state(force=True)
    p = next(x for x in st["playlists"] if x["id"] == r["id"])
    new = [st["fid_of_tid"][t] for t in p["entries"]]
    assert new == [x["id"] for x in ls["after"]["rows"]] and new != order
    assert lib.catalog.journal_top()["title"].startswith("Sıra değişti")
    journal.undo_last(lib)
    st = lib.engine_state(force=True)
    p = next(x for x in st["playlists"] if x["id"] == r["id"])
    assert [st["fid_of_tid"][t] for t in p["entries"]] == order
    # liste bu arada değiştiyse uygulanmaz
    try:
        lists.reorder(lib, r["id"], ls["refs"][:-1])
        raise AssertionError("eksik sıra kabul edilmemeli")
    except UserError as e:
        assert e.code == "stale"
    # programın tuttuğu liste sıralanmaz
    from djdoktor import maintain
    mm = maintain.managed_meta(lib, st["uuid"])
    if mm.get("analysis"):
        try:
            A.list_sort(lib, c, mm["analysis"])
            raise AssertionError("yönetilen liste sıralanmamalı")
        except UserError as e:
            assert e.code == "managed"


def test_speed_next_5000():
    c = synth(5000, 11)
    t0 = time.time()
    for fid in (1, 77, 1234, 4999):
        r = A.next_tracks(c, fid, limit=30)
        assert len(r["items"]) == 30
    dt = (time.time() - t0) / 4
    assert dt < .15, dt
    t0 = time.time()
    w = A.camelot_wheel(c)
    assert time.time() - t0 < .1 and w["total"] == 5000
    t0 = time.time()
    sl = A.shortlist(c, "Kına gecesi halay ve horon", ["Halay"], [5])
    assert len(sl) <= A.AI_MAX and sl[0].id == 5 and time.time() - t0 < 1.5
    assert sum(1 for t in sl if t.genre == "Halay") > len(sl) / 2


if __name__ == "__main__":
    only = sys.argv[1:]
    ok = fail = 0
    for k, v in list(globals().items()):
        if k.startswith("test_") and (not only or k in only):
            t0 = time.time()
            try:
                v()
                print("OK   %-28s %.1fs" % (k, time.time() - t0))
                ok += 1
            except Exception:
                print("FAIL", k)
                traceback.print_exc()
                fail += 1
    shutil.rmtree(TMP, ignore_errors=True)
    print("%d geçti, %d başarısız" % (ok, fail))
    sys.exit(1 if fail else 0)
