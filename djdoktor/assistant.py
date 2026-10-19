"""Mix Asistanı: Camelot + tempo + enerji ile "sonra ne çalınır?", harmonik sıralama, set kurucu ve (isteğe bağlı)
yapay zekâ ile liste kurma.

Çevrimdışı çalışır (internet / API anahtarı gerekmez). Yapay zekâ yalnızca "Yapay zekâ ile kur" ve "Sonra ne
gelsin? (AI)" için kullanılır; o zaman da Claude'a yalnızca şarkı bilgileri (ad, sanatçı, tür, BPM, ton, enerji,
süre) gider — dosya yolu, klasör adı ya da ses gönderilmez.

Puanlama (0..100), ağırlıklar WEIGHTS tablosunda:
  ton (Camelot ilişkisi, keys.CAM_REL) + tempo (fark %, yarım/çift tempo dahil, Ayarlar > mix_bpm_range) +
  enerji akışı (MIK "Energy" etiketi ya da tür + BPM'den tahmin) + tür uyumu + öğrenilmiş çiftler (geçmişte arka
  arkaya çalınanlar: Engine / Serato geçmişi, Engine listeleri, Serato crate'leri) − çeşitlilik cezası (aynı sanatçı).

Program hiçbir dosyaya yazmaz; "Liste olarak kaydet" ve "Bu listeye uygula" Engine'in kendi listelerine
lists.Edit ile (Engine kapalıyken, yedekli, tek 'Geri al' adımı) yazar.
"""
from __future__ import annotations

import bisect
import math
import os
import re
import sqlite3
import time
import urllib.request

from . import ai, engine, events, keys as K, names
from .ext import route
from .library import STATE_DIR, UserError

# ---------------------------------------------------------------------------
# Ağırlıklar (tek tablo). Taban puan = ton + tempo + enerji + tür = 100; geçmiş en çok +15 ekler,
# aynı sanatçı arka arkaya 12 düşürür. Sonuç 0..100'e kırpılır.
# ---------------------------------------------------------------------------
WEIGHTS = {"key": 40, "bpm": 30, "energy": 15, "genre": 15, "history": 15, "variety": 12}
CURVE_W = 0.35            # set kurucu: adım değerinde enerji eğrisine uyumun payı (kalanı geçiş puanı)
UNKNOWN = 0.5             # ton / BPM bilinmiyorsa o bölümün puanı (ne iyi ne kötü)
DEFAULT_DUR = 240.0       # süresi bilinmeyen şarkı (sn)
WEAK = 45                 # bu puanın altındaki geçiş "zayıf" sayılır
MAX_SET = 200             # set kurucu en çok bu kadar şarkı dizer
MAX_SORT = 400            # harmonik sıralama en çok bu kadar şarkılık listede (n² geçiş hesaplanır)
HIST_W = {"history": 1.0, "list": 0.5, "crate": 0.2}   # öğrenilmiş çift ağırlıkları (kaynak başına, tekrarla artar)
HIST_REV = 0.3            # B→A çalındıysa A→B için de biraz işaret
HIST_FLAG = {"history": 1, "list": 2, "crate": 4}
BIG_LIST = 400            # bundan uzun liste / crate "koleksiyon" sayılır, sırası öğrenilmez

# Tür -> tahmini enerji (1..10). Sıra önemli: özel olan önce ("ilk dans" "dans"tan, "turkce pop" "pop"tan önce).
GENRE_ENERGY = [
    ("fon", 2), ("karsilama", 2), ("lounge", 3), ("chill", 3), ("ilk dans", 3), ("slow", 3), ("ballad", 3),
    ("akustik", 3), ("sanat", 3), ("klasik", 3), ("enstrumantal", 3), ("instrumental", 3), ("arabesk", 4),
    ("damar", 4), ("fantezi", 5), ("turku", 5), ("kina", 5), ("zeybek", 5), ("giris", 5), ("pasta", 5),
    ("ozel", 5), ("cocuk", 6), ("turkce pop", 6), ("pop", 6), ("rock", 6), ("rap", 6), ("arabic", 7),
    ("oryantal", 7), ("yabanci", 7), ("latin", 7), ("reggaeton", 7), ("matine", 7), ("sallama", 7), ("dans", 8),
    ("dance", 8), ("remix", 8), ("club", 8), ("house", 8), ("edm", 8), ("ankara", 8), ("oyun havasi", 8),
    ("trakya", 8), ("klarnet", 8), ("roman", 8), ("mezdeke", 8), ("ciftetelli", 8), ("kurtce", 8), ("kurdish", 8),
    ("halay", 8), ("govend", 8), ("grani", 8), ("karadeniz", 8), ("horon", 9),
]
# Yakın türler (aynı aile = "yakın tür")
GENRE_FAMILY = [
    ("sakin", ("slow", "ilk dans", "cift dans", "fon", "karsilama", "lounge", "chill", "ballad", "akustik",
               "enstrumantal", "instrumental", "sanat", "klasik", "romantik")),
    ("oyun", ("halay", "kurtce", "kurdish", "govend", "grani", "delilo", "oyun havasi", "ankara", "zeybek", "kasik",
              "misket", "sallama", "potpori", "matine", "trakya", "klarnet", "zurna")),
    ("karadeniz", ("horon", "karadeniz", "kemence", "laz")),
    ("roman", ("roman", "mezdeke", "ciftetelli", "oryantal", "arabic", "gypsy", "darbuka")),
    ("pop", ("pop", "yabanci", "dans", "dance", "remix", "club", "house", "edm", "latin", "reggaeton", "hit")),
    ("arabesk", ("arabesk", "damar", "fantezi")),
    ("turku", ("turku", "halk", "baglama", "saz")),
    ("kina", ("kina", "tepsi")),
    ("ozel", ("giris", "pasta", "ozel", "cikis")),
]

# Enerji eğrileri: 0..1 arası (x, y). y, aday havuzunun enerji aralığına (alt %10 .. üst %10) yayılır.
CURVES = {
    "flat": [(0, .55), (1, .55)],
    "rising": [(0, .1), (1, 1.0)],
    "wave": [(0, .35), (.25, .7), (.5, .45), (.75, .85), (1, .65)],
    "peak": [(0, .2), (.45, .55), (.75, 1.0), (1, .7)],
    "cooldown": [(0, .9), (1, .1)],
}
CURVE_NAMES = {"flat": "Sabit", "rising": "Yükselen", "wave": "Dalgalı", "peak": "Zirve", "cooldown": "Sakinleşen"}


def _genre_energy(gkey):
    for k, e in GENRE_ENERGY:
        if k in gkey:
            return e
    return None


def _family(gkey):
    if not gkey:
        return ""
    for fam, words in GENRE_FAMILY:
        if any(w in gkey for w in words):
            return fam
    return ""


def estimate_energy(gkey, bpm):
    """Enerji tahmini (1..10): tür tabanı + BPM düzeltmesi; ikisi de yoksa 5."""
    base = _genre_energy(gkey or "")
    if base is not None:
        e = base + (max(-1.0, min(1.0, (bpm - 110.0) / 25.0)) if bpm else 0.0)
    elif bpm:
        b = bpm if bpm >= 60 else bpm * 2
        e = 3.0 + (b - 70.0) / 12.0
    else:
        e = 5.0
    return int(max(1, min(10, round(e))))


# ---------------------------------------------------------------------------
# Şarkı modeli (kütüphaneden türetilir, önbellekli; paylaşılan satırlar değiştirilmez)
# ---------------------------------------------------------------------------
class T:
    __slots__ = ("id", "title", "artist", "genre", "gid", "color", "tg", "bpm", "cam", "ci", "energy", "e_est",
                 "dur", "dur_known", "ready", "es", "dot", "akey", "skey", "qsig", "gkey", "fam", "search", "rating")

    def __init__(self, **kw):
        for k in self.__slots__:
            setattr(self, k, kw.get(k))


class Model:
    def __init__(self, tracks):
        self.tracks = sorted(tracks, key=lambda t: t.id)
        self.by_id = {t.id: t for t in self.tracks}
        bb = sorted((t.bpm, t.id) for t in self.tracks if t.bpm)
        self.bpm_keys = [x[0] for x in bb]
        self.bpm_ids = [x[1] for x in bb]
        self.no_bpm = [t.id for t in self.tracks if not t.bpm]


def make_track(fid, title, artist="", genre=None, bpm=None, cam="", energy=None, dur=None, ready=True, gid=None,
               color=None, tg="", es=None, skey=None, qsig=None, rating=None, search=None):
    """Bir şarkı kaydı (kütüphaneden ya da testlerde elle). energy None ise tahmin edilir."""
    gname = genre or tg or ""
    gkey = names.fold(gname)
    cam = K.to_camelot(cam) if cam else ""
    try:
        bpm = float(bpm) if bpm else None
    except (TypeError, ValueError):
        bpm = None
    est = energy is None
    e = estimate_energy(gkey, bpm) if est else int(max(1, min(10, int(energy))))
    es = es or ("ready" if ready else "none")
    return T(id=int(fid), title=title or "?", artist=artist or "", genre=genre, gid=gid, color=color, tg=tg or "",
             bpm=bpm, cam=cam, ci=K.cam_index(cam), energy=e, e_est=est,
             dur=float(dur) if dur else DEFAULT_DUR, dur_known=bool(dur), ready=bool(ready), es=es,
             dot={"ready": "ready", "pending": "pending", "broken": "problem", "edup": "pending"}.get(es, "none"),
             akey=names.fold(artist or ""), skey=skey or None, qsig=qsig or None, gkey=gkey, fam=_family(gkey),
             search=search if search is not None else names.fold(" ".join(x for x in (title, artist, gname) if x)),
             rating=rating)


def model(lib):
    return lib.cached("asst_model", lib.view_key(), lambda: _build_model(lib))


def _build_model(lib):
    st = lib.engine_state()
    states = lib.file_states()
    gens = {g["id"]: g for g in lib.genre_rows()}
    out = []
    for fid, s in states.items():
        if s["place"] == "ignore" or s["bad"] or s["fmt"]:
            continue
        d = s["dup"]
        if d and d["kind"] in ("exact", "audio") and not d["keeper"]:
            continue                       # kopya: asıl dosya modelde
        f = s["f"]
        if f["rel"].startswith(STATE_DIR + "/"):
            continue
        rows = st["by_file"].get(fid) or []
        t = {}
        if rows:
            tid = sorted(rows, key=lambda r: (not st["tracks"][r[0]].get("isAnalyzed"), r[0]))[0][0]
            t = st["tracks"].get(tid) or {}
        g = gens.get(s["gid"]) if s["place"] == "genre" else None
        en = f.get("mik_energy")
        if en is None:
            for src in (f.get("grouping"), f.get("comment")):
                m = K.MIK_RE.search(src or "")
                if m:
                    en = int(m.group(3))
                    break
        if en is not None and not 1 <= int(en) <= 10:
            en = None
        title = f.get("title") or t.get("title") or os.path.splitext(names.display(f["name"]))[0]
        artist = f.get("artist") or t.get("artist") or ""
        es = s["es"]
        out.append(make_track(
            fid, title, artist, genre=g["name"] if g else None, gid=g["id"] if g else None,
            color=g["color"] if g else None, tg=f.get("genre") or t.get("genre") or "",
            bpm=events._bpm_of(f, t), cam=events._key_of(f, t), energy=en,
            dur=f.get("duration") or t.get("length"), ready=es == "ready", es=es, skey=f.get("songkey"),
            qsig=f.get("qsig"), rating=f.get("rating") or t.get("rating"),
            search=names.fold(" ".join(x for x in (title, artist, g["name"] if g else "", f.get("genre") or "",
                                                   f.get("search") or "") if x))))
    return Model(out)


# ---------------------------------------------------------------------------
# Öğrenilmiş çiftler: geçmiş (Engine / Serato), Engine listeleri, Serato crate'leri
# ---------------------------------------------------------------------------
def _ro(path):
    """Salt-okunur ve 'değişmez' bağlantı: kilit almaz, günlüğe dokunmaz (hm.db'ye asla yazılmaz)."""
    return sqlite3.connect("file:" + urllib.request.pathname2url(os.path.abspath(path)) + "?mode=ro&immutable=1",
                           uri=True, timeout=2)


def _serato_hist_dirs(lib):
    out = []
    sd = lib.serato_dir()
    if sd:
        out.append(os.path.join(sd, "History", "Sessions"))
    home = os.path.expanduser("~")
    for base in (os.path.join(home, "Music", "_Serato_"), os.path.join(home, "Müzik", "_Serato_")):
        out.append(os.path.join(base, "History", "Sessions"))
    seen, res = set(), []
    for p in out:
        k = os.path.normcase(os.path.abspath(p))
        if k not in seen and os.path.isdir(p):
            seen.add(k)
            res.append(p)
    return res


def _hist_files(lib):
    """Geçmiş dosyaları ve ucuz imzaları (değiştiler mi?)."""
    files = []
    for d in engine.find_dbs(lib.root):
        p = os.path.join(os.path.dirname(d["path"]), "hm.db")
        if os.path.isfile(p):
            files.append(("engine", p, d))
    for sdir in _serato_hist_dirs(lib):
        try:
            ss = sorted((e for e in os.scandir(sdir) if e.name.endswith(".session")),
                        key=lambda e: e.stat().st_mtime, reverse=True)[:300]
        except OSError:
            continue
        for e in ss:
            files.append(("serato", e.path, None))
    sig = []
    for kind, p, _d in files:
        try:
            s = os.stat(p)
            sig.append((p, s.st_size, s.st_mtime_ns))
        except OSError:
            pass
    return files, tuple(sig)


def _path_resolver(lib):
    from .resolver import Resolver
    res = Resolver(lib.catalog, lib.root)
    cache = {}

    def find(path):
        """Başka bilgisayardaki tam yol -> dosya kimliği ('/Volumes/SSD/Müzik/a.mp3', 'D:\\Müzik\\a.mp3')."""
        if not path:
            return None
        if path in cache:
            return cache[path]
        p = path.replace("\\", "/")
        p = re.sub(r"^[A-Za-z]:", "", p).lstrip("/")
        parts = [x for x in p.split("/") if x]
        if len(parts) > 2 and parts[0].lower() == "volumes":
            parts = parts[2:]
        fid = None
        for i in range(0, min(len(parts) - 1, 5) + 1):
            f, m = res.resolve("/".join(parts[i:]))
            if f is not None and m in ("exact", "case", "unicode", "sfm") and f["present"]:
                fid = f["id"]
                break
        cache[path] = fid
        return fid
    return find


def _engine_history(lib, st, path, d, find):
    """hm.db -> [[fid, fid, ...] oturum başına]. Şema bilinmiyorsa ya da okunamazsa boş."""
    sessions = []
    try:
        con = _ro(path)
    except sqlite3.Error:
        return sessions
    try:
        tabs = {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        if not {"Historylist", "HistorylistEntity"} <= tabs:
            return sessions
        cols = {r[1] for r in con.execute("PRAGMA table_info(HistorylistEntity)")}
        if not {"listId", "trackId"} <= cols:
            return sessions
        order = "startTime, id" if "startTime" in cols else "id"
        rows = con.execute("SELECT listId, trackId FROM (SELECT * FROM HistorylistEntity ORDER BY id DESC "
                           "LIMIT 50000) ORDER BY listId, %s" % order).fetchall()
        tmap = {}
        own = 0
        if "Track" in tabs:
            tcols = {r[1] for r in con.execute("PRAGMA table_info(Track)")}
            sel = [c for c in ("id", "path", "originDatabaseUuid", "originTrackId") if c in tcols]
            if "id" in sel:
                for r in con.execute("SELECT %s FROM Track" % ",".join(sel)):
                    r = dict(zip(sel, r))
                    own += 1
                    fid = None
                    if d.get("key") == "drive" and "originTrackId" in r:
                        tid = st["tid_of_ref"].get((r.get("originDatabaseUuid"), r.get("originTrackId")))
                        fid = st["fid_of_tid"].get(tid) if tid else None
                    if fid is None and r.get("path"):
                        rel = engine.path_to_rel(r["path"], d["lib_dir"], lib.root)
                        fid = find(rel) if rel else None
                    if fid:
                        tmap[r["id"]] = fid
        if not own:                         # hm.db kendi parça tablosunu tutmuyor: kimlikler m.db'ninki
            if d.get("key") == "drive":
                tmap = st.get("fid_of_tid") or {}
            else:
                try:
                    c2 = _ro(d["path"])
                    try:
                        for tid, p in c2.execute("SELECT id, path FROM Track"):
                            rel = engine.path_to_rel(p or "", d["lib_dir"], lib.root)
                            fid = find(rel) if rel else None
                            if fid:
                                tmap[tid] = fid
                    finally:
                        c2.close()
                except sqlite3.Error:
                    pass
        cur, last = [], None
        for lid, tid in rows:
            if lid != last and cur:
                sessions.append(cur)
                cur = []
            last = lid
            fid = tmap.get(tid)
            if fid and (not cur or cur[-1] != fid):
                cur.append(fid)
        if cur:
            sessions.append(cur)
    except sqlite3.Error:
        return []
    finally:
        con.close()
    return sessions


def parse_serato_session(data):
    """Serato History/Sessions/*.session -> [(sıra, yol)]. Biçim: 'oent' kayıtları içinde 'adat' alanları
    (4 bayt alan no + 4 bayt uzunluk + veri). Alan 2 = tam yol (UTF-16BE), 1 = satır no, 28 = başlama zamanı."""
    from . import serato
    out = []
    items, _tail = serato.parse(data)
    for tag, body in items:
        if tag != b"oent":
            continue
        inner, _t = serato.parse(body)
        for t2, adat in inner:
            if t2 != b"adat":
                continue
            i, n, row, path, start = 0, len(adat), None, None, None
            while i + 8 <= n:
                fid = int.from_bytes(adat[i:i + 4], "big")
                ln = int.from_bytes(adat[i + 4:i + 8], "big")
                v = adat[i + 8:i + 8 + ln]
                i += 8 + ln
                if fid == 2:
                    path = v.decode("utf-16-be", "replace").rstrip("\x00")
                elif fid == 1 and len(v) == 4:
                    row = int.from_bytes(v, "big")
                elif fid == 28 and len(v) == 4:
                    start = int.from_bytes(v, "big")
            if path:
                out.append((start if start is not None else (row if row is not None else len(out)), path))
    out.sort(key=lambda x: x[0])
    return out


def learned(lib):
    """{'succ': {a: {b: [ağırlık, kaynak bayrakları]}}, 'plays': {fid: n}, 'info': {...}} (önbellekli)."""
    files, sig = _hist_files(lib)
    return lib.cached("asst_learned", (lib.view_key(), sig), lambda: _learned(lib, files))


def _learned(lib, files):
    succ, plays = {}, {}
    info = {"history_sessions": 0, "history_plays": 0, "lists": 0, "crates": 0, "pairs": 0}

    def add(a, b, w, flag):
        if not a or not b or a == b:
            return
        r = succ.setdefault(a, {}).get(b)
        if r is None:
            succ[a][b] = [w, flag]
        else:
            r[0] += w
            r[1] |= flag
        rv = succ.setdefault(b, {}).get(a)
        if rv is None:
            succ[b][a] = [w * HIST_REV, 0]
        else:
            rv[0] += w * HIST_REV

    st = lib.engine_state()
    # 1) Engine listeleri ve etkinlik bölümleri (programın tuttuğu listeler hariç)
    if st.get("db"):
        from . import maintain
        managed = maintain.managed_ids(lib, st["uuid"])
        for p in st["playlists"]:
            if p["id"] in managed or len(p["entries"]) > BIG_LIST or len(p["entries"]) < 2:
                continue
            fids = [st["fid_of_tid"].get(t) for t in p["entries"]]
            info["lists"] += 1
            for a, b in zip(fids, fids[1:]):
                add(a, b, HIST_W["list"], HIST_FLAG["list"])
    # 2) Serato crate'leri (sıra çoğu zaman rastgele: zayıf işaret)
    cur_key, prev, n = None, None, 0
    sizes = {r["list_key"]: r["n"] for r in lib.catalog.q(
        "SELECT list_key, COUNT(*) AS n FROM ext_items WHERE src='serato' GROUP BY list_key")}
    for r in lib.catalog.q("SELECT list_key, file_id FROM ext_items WHERE src='serato' ORDER BY list_key, pos"):
        if sizes.get(r["list_key"], 0) > BIG_LIST:
            continue
        if r["list_key"] != cur_key:
            cur_key, prev = r["list_key"], None
            n += 1
        if prev and r["file_id"]:
            add(prev, r["file_id"], HIST_W["crate"], HIST_FLAG["crate"])
        prev = r["file_id"] or prev
    info["crates"] = n
    # 3) Gerçek çalma geçmişi (en güçlü işaret)
    find = None
    for kind, p, d in files:
        try:
            if find is None:
                find = _path_resolver(lib)
            if kind == "engine":
                sessions = _engine_history(lib, st, p, d, find)
            else:
                with open(p, "rb") as fh:
                    data = fh.read(8 * 1024 * 1024)
                ents = parse_serato_session(data)
                sess = []
                for _o, path in ents:
                    fid = find(path)
                    if fid and (not sess or sess[-1] != fid):
                        sess.append(fid)
                sessions = [sess] if sess else []
        except Exception:
            continue                        # bozuk / bilinmeyen biçim: atla
        for sess in sessions:
            info["history_sessions"] += 1
            for fid in sess:
                plays[fid] = plays.get(fid, 0) + 1
                info["history_plays"] += 1
            for a, b in zip(sess, sess[1:]):
                add(a, b, HIST_W["history"], HIST_FLAG["history"])
    info["pairs"] = sum(1 for a in succ.values() for r in a.values() if r[1])
    return {"succ": succ, "plays": plays, "info": info}


# ---------------------------------------------------------------------------
# Bağlam ve puanlama
# ---------------------------------------------------------------------------
class Ctx:
    """Bir isteğin bağlamı: model + öğrenilmiş çiftler + tempo aralığı (Ayarlar)."""

    def __init__(self, mdl, learn=None, rng=6.0):
        self.m = mdl
        self.succ = (learn or {}).get("succ") or {}
        self.plays = (learn or {}).get("plays") or {}
        self.info = (learn or {}).get("info") or {}
        try:
            self.rng = max(1.0, min(25.0, float(rng or 6)))
        except (TypeError, ValueError):
            self.rng = 6.0


def context(lib):
    try:
        rng = lib.prefs().get("mix_bpm_range", 6)
    except Exception:
        rng = 6
    return Ctx(model(lib), learned(lib), rng)


def _bpm_fit(pct, rng):
    if pct <= rng:
        return 1.0 - 0.35 * (pct / rng) ** 2
    if pct <= 2 * rng:
        return 0.65 * (1.0 - (pct - rng) / rng)
    return 0.0


def _energy_fit(de, mode):
    if mode == "up":
        return {0: .6, 1: 1.0, 2: .95, 3: .75}.get(de, .55 if de > 3 else (.25 if de == -1 else .1))
    if mode == "down":
        return {0: .6, -1: 1.0, -2: .95, -3: .75}.get(de, .55 if de < -3 else (.25 if de == 1 else .1))
    if mode == "same":
        return {0: 1.0, 1: .75, -1: .75, 2: .4, -2: .4}.get(de, .1)
    v = {0: 1.0, 1: .95, -1: .85, 2: .7, -2: .55}.get(de)
    return v if v is not None else max(0.0, .45 - .12 * (abs(de) - 3))


def _genre_fit(a, b):
    if a.gkey and a.gkey == b.gkey:
        return 1.0
    if a.fam and a.fam == b.fam:
        return 0.7
    if not a.gkey or not b.gkey:
        return UNKNOWN
    return 0.25


def _parts(c, a, b, mode=None):
    """(puan, k, t, e, g, h, v, bpm_yüzde, oran, geçmiş_bayrakları)"""
    W = WEIGHTS
    k = K.REL_SCORE[a.ci][b.ci] if a.ci >= 0 and b.ci >= 0 else UNKNOWN
    pct = ratio = None
    if a.bpm and b.bpm:
        x, y = a.bpm, b.bpm
        pct, ratio = abs(y - x) / x * 100.0, 1.0
        d2 = abs(y * 2 - x) / x * 100.0
        if d2 < pct - 1e-9:
            pct, ratio = d2, 2.0
        d3 = abs(y * .5 - x) / x * 100.0
        if d3 < pct - 1e-9:
            pct, ratio = d3, .5
        t = _bpm_fit(pct, c.rng) * (1.0 if ratio == 1.0 else 0.92)
    else:
        t = UNKNOWN
    e = _energy_fit(b.energy - a.energy, mode)
    g = _genre_fit(a, b)
    hr = c.succ.get(a.id)
    hr = hr.get(b.id) if hr else None
    h = (1.0 - math.exp(-hr[0])) if hr else 0.0
    v = 0.0 if (a.akey and a.akey == b.akey) else 1.0
    s = W["key"] * k + W["bpm"] * t + W["energy"] * e + W["genre"] * g + W["history"] * h - W["variety"] * (1 - v)
    return (max(0.0, min(100.0, s)), k, t, e, g, h, v, pct, ratio, hr[1] if hr else 0)


def score(c, a, b, mode=None):
    return _parts(c, a, b, mode)[0]


def transition(c, a, b, mode=None):
    """Bir geçişin ayrıntısı: {score, parts, rel, rel_label, bpm_pct, tempo, de, reasons, warns}."""
    s, k, t, e, g, h, v, pct, ratio, hflag = _parts(c, a, b, mode)
    reasons, warns = [], []
    rel = K.relation(a.cam, b.cam) if a.ci >= 0 and b.ci >= 0 else None
    if rel:
        (reasons if rel["score"] >= .5 else warns).append(rel["label"])
    else:
        warns.append("Ton bilinmiyor")
    signed = None
    if pct is not None:
        if pct > c.rng and ratio != 1.0:      # yarım / çift tempo da uymuyor: düz farkı göster
            ratio = 1.0
            pct = abs(b.bpm - a.bpm) / a.bpm * 100.0
        signed = (b.bpm * ratio - a.bpm) / a.bpm * 100.0
        tl = "Çift tempo" if ratio == .5 else ("Yarım tempo" if ratio == 2.0 else "")
        if pct < 0.75:
            reasons.append(tl or "Tempo aynı")
        elif pct <= c.rng:
            reasons.append(("%s ±%%%d" % (tl, round(pct))).strip() if tl else "Tempo %+d%%" % round(signed))
        else:
            warns.append("Tempo farkı %%%d" % round(pct))
    else:
        warns.append("BPM bilinmiyor")
    de = b.energy - a.energy
    if de > 0:
        reasons.append("Enerji ↑")
    elif de < 0:
        (warns if de <= -3 else reasons).append("Enerji ↓" if de > -3 else "Enerji çok düşüyor")
    if g == 1.0:
        reasons.append("Aynı tür")
    elif g == .7:
        reasons.append("Yakın tür")
    if hflag & HIST_FLAG["history"]:
        reasons.append("Daha önce arka arkaya çaldın")
    elif hflag & HIST_FLAG["list"]:
        reasons.append("Listende arka arkaya")
    elif hflag & HIST_FLAG["crate"]:
        reasons.append("Aynı crate'te")
    if not v:
        warns.append("Aynı sanatçı")
    r2 = lambda x: round(x, 2)  # noqa: E731
    return {"score": int(round(s)), "parts": {"key": r2(k), "bpm": r2(t), "energy": r2(e), "genre": r2(g),
                                              "history": r2(h), "variety": v},
            "rel": rel["code"] if rel else "", "rel_label": rel["label"] if rel else "",
            "bpm_pct": round(signed, 1) if signed is not None else None,
            "tempo": {.5: "double", 2.0: "half"}.get(ratio, "") if ratio else "", "de": de,
            "reasons": reasons, "warns": warns}


def row(t, c=None):
    """Arayüze giden kısa satır."""
    out = {"id": t.id, "title": t.title, "artist": t.artist, "genre": t.genre or (t.tg or None), "color": t.color,
           "gid": t.gid, "bpm": round(t.bpm, 1) if t.bpm else None, "cam": t.cam, "energy": t.energy,
           "e_est": t.e_est, "dur": round(t.dur) if t.dur_known else None, "ready": t.ready, "dot": t.dot}
    if c is not None and c.plays.get(t.id):
        out["plays"] = c.plays[t.id]
    return out


# ---------------------------------------------------------------------------
# Filtreler
# ---------------------------------------------------------------------------
def _gmatch(filters):
    gs = filters.get("genres") or []
    if isinstance(gs, (str, int)):
        gs = [gs]
    ids, keys_ = set(), set()
    for g in gs:
        if isinstance(g, int) or (isinstance(g, str) and g.isdigit()):
            ids.add(int(g))
        elif g:
            keys_.add(names.fold(str(g)))
    if not ids and not keys_:
        return None
    return lambda t: (t.gid in ids) or (t.gkey in keys_) or (bool(t.genre) and names.fold(t.genre) in keys_)


def pool(c, filters=None):
    """Filtreye uyan şarkılar."""
    f = filters or {}
    gm = _gmatch(f)
    only_ready = bool(f.get("ready") or f.get("only_ready"))
    lo, hi = f.get("bpm_min"), f.get("bpm_max")
    lo = float(lo) if lo else None
    hi = float(hi) if hi else None
    excl = {int(x) for x in (f.get("exclude") or [])}
    words = [w for w in names.fold(f.get("q") or "").split() if w]
    cams = set(f.get("keys") or [])
    out = []
    for t in c.m.tracks:
        if t.id in excl or (only_ready and not t.ready) or (gm and not gm(t)):
            continue
        if (lo or hi) and (not t.bpm or (lo and t.bpm < lo) or (hi and t.bpm > hi)):
            continue
        if cams and t.cam not in cams:
            continue
        if words and not all(w in t.search for w in words):
            continue
        out.append(t)
    return out


def _get(c, fid):
    try:
        t = c.m.by_id.get(int(fid))
    except (TypeError, ValueError):
        t = None
    if t is None:
        raise UserError("Şarkı bulunamadı (taranmamış, bozuk ya da bir kopya olabilir).", "gone")
    return t


def _ids(xs):
    """Kimlik listesi (sayıya çevrilemeyenler atlanır, sıra korunur, tekrarsız)."""
    out = []
    for x in xs or []:
        try:
            x = int(x)
        except (TypeError, ValueError):
            continue
        if x not in out:
            out.append(x)
    return out


def same_song(a, b):
    return (a.skey and a.skey == b.skey) or (a.qsig and a.qsig == b.qsig)


# ---------------------------------------------------------------------------
# "Sonra ne çalınır?"
# ---------------------------------------------------------------------------
def next_tracks(c, fid, prev_fid=None, filters=None, limit=30):
    a = _get(c, fid)
    prev = c.m.by_id.get(int(prev_fid)) if prev_fid else None
    f = dict(filters or {})
    mode = f.get("energy") if f.get("energy") in ("up", "down", "same") else None
    f["exclude"] = list(f.get("exclude") or []) + [a.id] + ([prev.id] if prev else [])
    cands = pool(c, f)
    scored = []
    for b in cands:
        if same_song(a, b):
            continue
        de = b.energy - a.energy
        if (mode == "up" and de < 0) or (mode == "down" and de > 0) or (mode == "same" and abs(de) > 1):
            continue                       # enerji yönü filtresi
        s = _parts(c, a, b, mode)[0]
        if prev is not None and prev.akey and prev.akey == b.akey:
            s -= 6                         # iki önceki şarkının sanatçısı da tekrar etmesin
        scored.append((s, b))
    scored.sort(key=lambda x: (-x[0], not x[1].ready, -c.plays.get(x[1].id, 0), x[1].id))
    items = []
    for s, b in scored[:max(1, min(int(limit or 30), 200))]:
        r = row(b, c)
        r.update(transition(c, a, b, mode))
        r["score"] = int(round(max(0, s)))
        items.append(r)
    return {"cur": row(a, c), "prev": row(prev, c) if prev else None, "items": items, "considered": len(scored),
            "compatible_keys": [x[0] for x in K.compatible_keys(a.cam)] if a.cam else []}


def score_chain(c, fids, mode=None):
    """Sıralı bir listenin geçiş puanları ve özeti."""
    ts = [c.m.by_id[int(x)] for x in fids if int(x) in c.m.by_id]
    trs = []
    for a, b in zip(ts, ts[1:]):
        tr = transition(c, a, b, mode)
        tr.update({"from": a.id, "to": b.id})
        trs.append(tr)
    return {"rows": [row(t, c) for t in ts], "transitions": trs, "summary": _summary(ts, trs)}


def _summary(ts, trs):
    sc = [t["score"] for t in trs]
    return {"n": len(ts), "dur": round(sum(t.dur for t in ts)), "avg": round(sum(sc) / len(sc), 1) if sc else None,
            "total": sum(sc), "min": min(sc) if sc else None, "weak": sum(1 for x in sc if x < WEAK),
            "unknown": sum(1 for t in ts if t.ci < 0 or not t.bpm), "not_ready": sum(1 for t in ts if not t.ready)}


# ---------------------------------------------------------------------------
# Harmonik sıralama
# ---------------------------------------------------------------------------
def _curve_fn(curve, lo=3.0, hi=9.0):
    """curve: ad ('rising'...) ya da [(x, y)] -> f(x) enerji hedefi. None -> None."""
    if not curve:
        return None
    pts = CURVES.get(curve) if isinstance(curve, str) else curve
    if not pts:
        return None
    pts = sorted((float(x), float(y)) for x, y in pts)
    span = hi - lo

    def f(x):
        x = max(0.0, min(1.0, x))
        for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
            if x <= x1:
                y = y0 + (y1 - y0) * ((x - x0) / (x1 - x0) if x1 > x0 else 0)
                return lo + y * span
        return lo + pts[-1][1] * span
    return f


def _energy_span(ts):
    es = sorted(t.energy for t in ts) or [5]
    lo = es[int(len(es) * .1)]
    hi = es[min(len(es) - 1, int(len(es) * .9))]
    if hi - lo < 3:
        mid = (hi + lo) / 2.0
        lo, hi = max(1.0, mid - 1.5), min(10.0, mid + 1.5)
    return float(lo), float(hi)


def _fit(e, target):
    return max(0.0, 1.0 - abs(e - target) / 4.0)


def harmonic_sort(c, fids, fixed_first=None, fixed_last=None, curve=None, budget=0.7):
    """Toplam geçiş puanını en yükseğe çıkaran sıra (açgözlü + 2-opt / or-opt). Bilinmeyen kimlikler sona."""
    seen, ts, rest = set(), [], []
    for x in fids or []:
        try:
            x = int(x)
        except (TypeError, ValueError):
            continue
        if x in seen:
            continue
        seen.add(x)
        t = c.m.by_id.get(x)
        (ts if t is not None else rest).append(t if t is not None else x)
    n = len(ts)
    before = score_chain(c, [t.id for t in ts])["summary"]
    if n < 3:
        order = list(range(n))
        if fixed_last is not None and n == 2 and ts[0].id == int(fixed_last):
            order = [1, 0]
        return _sort_result(c, ts, order, rest, before)
    t0 = time.time()
    S = [[0.0] * n for _ in range(n)]
    for i, a in enumerate(ts):
        Si = S[i]
        for j, b in enumerate(ts):
            if i != j:
                Si[j] = _parts(c, a, b)[0]
    ff = next((i for i, t in enumerate(ts) if fixed_first is not None and t.id == int(fixed_first)), None)
    fl = next((i for i, t in enumerate(ts) if fixed_last is not None and t.id == int(fixed_last)), None)
    if ff is not None and ff == fl:
        fl = None
    cf = _curve_fn(curve, *_energy_span(ts))
    U = None
    if cf:                                  # U[i][p]: şarkı i'nin p. sıradaki eğri uyumu (puan ölçeğinde)
        tg = [cf(p / (n - 1)) for p in range(n)]
        w = 100.0 * CURVE_W / (1 - CURVE_W)
        U = [[w * _fit(t.energy, tg[p]) for p in range(n)] for t in ts]

    def total(o):
        s = sum(S[o[k]][o[k + 1]] for k in range(n - 1))
        if U:
            s += sum(U[o[k]][k] for k in range(n))
        return s

    # 1) açgözlü: birkaç başlangıçtan
    if ff is not None:
        starts = [ff]
    else:
        cand = [i for i in range(n) if i != fl]
        rowsum = sorted(cand, key=lambda i: (-sum(S[i]), i))
        low_e = sorted(cand, key=lambda i: (ts[i].energy, -sum(S[i]), i))
        starts = []
        for i in [low_e[0], rowsum[0]] + ([max(cand, key=lambda i: (U[i][0], -i))] if U else []) + \
                 [cand[(k * len(cand)) // 6] for k in range(6)]:
            if i not in starts:
                starts.append(i)
    best, best_v = None, None
    for s0 in starts:
        o, used = [s0], {s0}
        if fl is not None:
            used.add(fl)
        while len(o) < n - (1 if fl is not None else 0):
            last, p = o[-1], len(o)
            Sl = S[last]
            nx, nv = None, None
            for j in range(n):
                if j in used:
                    continue
                v = Sl[j] + (U[j][p] if U else 0.0)
                if nv is None or v > nv:
                    nx, nv = j, v
            o.append(nx)
            used.add(nx)
        if fl is not None:
            o.append(fl)
        v = total(o)
        if best_v is None or v > best_v:
            best, best_v = o, v
        if time.time() - t0 > budget * .4:
            break
    # verilen sıra daha iyiyse oradan devam (sonuç hiçbir zaman başlangıçtan kötü olmasın)
    orig = list(range(n))
    if ff is not None:
        orig.remove(ff)
        orig.insert(0, ff)
    if fl is not None:
        orig.remove(fl)
        orig.append(fl)
    if total(orig) > best_v:
        best, best_v = orig, total(orig)
    o = list(best)
    lo = 1 if ff is not None else 0
    hi = n - 2 if fl is not None else n - 1
    deadline = t0 + budget
    # 2) yerel iyileştirme: 2-opt (parça ters çevirme) + or-opt (1-3 şarkıyı başka yere taşıma)
    improved = True
    while improved and time.time() < deadline:
        improved = False
        PF, PR = [0.0] * n, [0.0] * n
        for k in range(n - 1):
            PF[k + 1] = PF[k] + S[o[k]][o[k + 1]]
            PR[k + 1] = PR[k] + S[o[k + 1]][o[k]]
        for i in range(lo, hi):
            if improved or time.time() > deadline:
                break
            for j in range(i + 1, hi + 1):
                d = (PR[j] - PR[i]) - (PF[j] - PF[i])
                if i > 0:
                    d += S[o[i - 1]][o[j]] - S[o[i - 1]][o[i]]
                if j < n - 1:
                    d += S[o[i]][o[j + 1]] - S[o[j]][o[j + 1]]
                if U:
                    d += sum(U[o[i + j - p]][p] - U[o[p]][p] for p in range(i, j + 1))
                if d > 1e-6:
                    o[i:j + 1] = o[i:j + 1][::-1]
                    improved = True
                    break
        if improved:
            continue
        for L in (1, 2, 3):
            if improved or time.time() > deadline:
                break
            for i in range(lo, hi - L + 2):
                if improved:
                    break
                seg = o[i:i + L]
                restl = o[:i] + o[i + L:]
                base = total(o) if U else None
                for p in range(lo, len(restl) - (1 if fl is not None else 0) + 1):
                    if p == i:
                        continue
                    if U:
                        cand = restl[:p] + seg + restl[p:]
                        d = total(cand) - base
                    else:
                        d = _oropt_delta(S, o, i, L, restl, p, n)
                    if d > 1e-6:
                        o = restl[:p] + seg + restl[p:]
                        improved = True
                        break
    return _sort_result(c, ts, o, rest, before, curve=curve)


def _oropt_delta(S, o, i, L, restl, p, n):
    """Parça o[i:i+L]'yi kalan dizide p konumuna taşımanın puan farkı (yalnızca değişen kenarlar)."""
    a, b = o[i], o[i + L - 1]
    d = 0.0
    if i > 0:
        d -= S[o[i - 1]][a]
    if i + L < n:
        d -= S[b][o[i + L]]
    if i > 0 and i + L < n:
        d += S[o[i - 1]][o[i + L]]
    m = len(restl)
    if p > 0 and p < m:
        d -= S[restl[p - 1]][restl[p]]
    if p > 0:
        d += S[restl[p - 1]][a]
    if p < m:
        d += S[b][restl[p]]
    return d


def _sort_result(c, ts, order, rest, before, curve=None):
    ids = [ts[i].id for i in order]
    ch = score_chain(c, ids)
    return {"order": ids + list(rest), "rows": ch["rows"], "transitions": ch["transitions"],
            "before": before, "after": ch["summary"], "missing": list(rest), "curve": curve or None}


# ---------------------------------------------------------------------------
# Set kurucu (çevrimdışı): ışın araması
# ---------------------------------------------------------------------------
def _candidates(c, a, allowed, mode, cache, k=120):
    """a'dan sonra gelebilecek en iyi k aday (geçiş puanına göre), ton/BPM ön elemesiyle hızlı."""
    key = (a.id, mode)
    hit = cache.get(key)
    if hit is not None:
        return hit
    m = c.m
    ids = set()
    if a.bpm:
        w = 2.0 * c.rng / 100.0
        for base in (a.bpm, a.bpm * 2, a.bpm / 2):
            lo_ = bisect.bisect_left(m.bpm_keys, base * (1 - w))
            hi_ = bisect.bisect_right(m.bpm_keys, base * (1 + w))
            ids.update(m.bpm_ids[lo_:hi_])
        ids.update(m.no_bpm)
        if len(ids & allowed) < k:          # tempoya uyan az: hepsine bak
            ids = allowed
    else:
        ids = allowed
    out = []
    ra = K.REL_SCORE[a.ci] if a.ci >= 0 else None
    for fid in ids:
        if fid not in allowed or fid == a.id:
            continue
        b = m.by_id[fid]
        if ra is not None and b.ci >= 0 and ra[b.ci] < .3 and len(allowed) > 3 * k:
            continue
        if same_song(a, b):
            continue
        out.append((_parts(c, a, b, mode)[0], fid))
    out.sort(key=lambda x: (-x[0], x[1]))
    out = out[:k]
    cache[key] = out
    return out


def _guess_curve(text):
    t = names.fold(text or "")
    if not t:
        return None
    if re.search(r"zirve|tepe", t):
        return "peak"
    if re.search(r"dalga|inis cikis|iniş", t):
        return "wave"
    calm = re.search(r"sakin|yavas|hafif|fon|romantik|slow", t)
    hype = re.search(r"cos|hareket|yuksel|enerji|patla|oynat|kopar|halay", t)
    if calm and hype:
        return "rising" if calm.start() < hype.start() else "cooldown"
    if hype:
        return "rising" if re.search(r"yuksel|sonunda|sona", t) else "flat"
    if calm:
        return "flat"
    return None


def _guess_minutes(text):
    t = names.fold(text or "").replace(",", ".")
    m = re.search(r"(\d+(?:\.\d+)?)\s*(saat|sa\b)", t)
    if m:
        return int(round(float(m.group(1)) * 60))
    m = re.search(r"(\d{1,3})\s*(dakika|dk|min)", t)
    if m:
        return int(m.group(1))
    return None


def build_set(c, params):
    """Çevrimdışı set: {seeds, genres, minutes, curve, bpm_start, bpm_end, only_ready, exclude, title}."""
    p = params or {}
    minutes = max(5, min(600, int(p.get("minutes") or 60)))
    target = minutes * 60.0
    curve = p.get("curve") if p.get("curve") in CURVES else "wave"
    filters = {"genres": p.get("genres") or [], "ready": p.get("only_ready"), "exclude": p.get("exclude") or [],
               "q": p.get("q") or ""}
    seeds = []
    for x in _ids(p.get("seeds")):
        t = c.m.by_id.get(x)
        if t is not None and t not in seeds:
            seeds.append(t)
    cands = [t for t in pool(c, filters)]
    warnings = []
    if not cands and not seeds:
        return {"source": "offline", "title": p.get("title") or "Set", "sections": [], "transitions": [],
                "summary": _summary([], []), "warnings": ["Bu seçime uyan şarkı yok."], "curve": curve,
                "minutes": minutes}
    allowed = {t.id for t in cands} | {t.id for t in seeds}
    allt = cands + [t for t in seeds if t not in cands]
    if sum(t.dur for t in allt) < target * .9:
        warnings.append("Bu türde yeterli şarkı yok: set %d dakikada kalıyor." % round(sum(t.dur for t in allt) / 60))
    lo, hi = _energy_span(allt)
    cf = _curve_fn(curve, lo, hi)
    b0, b1 = p.get("bpm_start"), p.get("bpm_end")
    b0 = float(b0) if b0 else None
    b1 = float(b1) if b1 else b0
    if b0 and not b1:
        b1 = b0

    def fit_at(t, x):
        f = _fit(t.energy, cf(x))
        if b0:
            tb = b0 + (b1 - b0) * x
            if t.bpm:
                d, _r = K.tempo_diff(tb, t.bpm)
                fb = max(0.0, 1.0 - d / 15.0)
            else:
                fb = UNKNOWN
            f = (f + fb) / 2.0
        return f

    def mode_at(x):
        d = cf(min(1.0, x + .1)) - cf(max(0.0, x - .1))
        return "up" if d > .6 else ("down" if d < -.6 else None)

    seed_ids = {t.id for t in seeds}
    # başlangıç durumları
    if seeds:
        starts = [seeds[0]]
    else:
        def st_val(t):
            v = fit_at(t, 0.0) * 100 + (8 if t.ready else 0) + min(6, c.plays.get(t.id, 0))
            if b0 and t.bpm:
                v += 10 * max(0.0, 1 - K.tempo_diff(b0, t.bpm)[0] / 10.0)
            return v
        starts = sorted(allt, key=lambda t: (-st_val(t), t.id))[:10]
    # durum: [değer, dizi, süre, kullanılanlar, şarkı anahtarları, ses imzaları, sırasız özet (Zobrist)]
    Z = {}

    def zh(fid):
        v = Z.get(fid)
        if v is None:                       # splitmix64: her çalıştırmada aynı (sonuç belirleyici kalsın)
            z = (fid * 0x9E3779B97F4A7C15 + 0x632BE59BD9B4E019) & 0xFFFFFFFFFFFFFFFF
            z = ((z ^ (z >> 30)) * 0xBF58476D1CE4E5B9) & 0xFFFFFFFFFFFFFFFF
            z = ((z ^ (z >> 27)) * 0x94D049BB133111EB) & 0xFFFFFFFFFFFFFFFF
            v = Z[fid] = z ^ (z >> 31)
        return v

    def state(val, seq, dur, prev=None):
        t = c.m.by_id[seq[-1]]
        if prev is None:
            used, usk, uqs, h = set(), set(), set(), 0
        else:
            used, usk, uqs, h = set(prev[3]), set(prev[4]), set(prev[5]), prev[6]
        used.add(t.id)
        if t.skey:
            usk.add(t.skey)
        if t.qsig:
            uqs.add(t.qsig)
        return [val, seq, dur, used, usk, uqs, h ^ zh(t.id)]
    beam = [state(fit_at(t, 0) * 100 * CURVE_W, [t.id], t.dur) for t in starts]
    done = []
    cache = {}
    width, expand = 10, 40
    steps = 0
    while beam and steps < MAX_SET:
        steps += 1
        nxt = []
        for si, stt in enumerate(beam):
            val, seq, dur, used, usk, uqs, _h = stt
            if dur >= target - 60:
                done.append((val / max(1, len(seq)), val, seq, dur))
                continue
            a = c.m.by_id[seq[-1]]
            x = min(1.0, dur / target)
            mode = mode_at(x)
            p2 = c.m.by_id[seq[-2]].akey if len(seq) >= 2 else ""
            opts = []
            for sc, fid in _candidates(c, a, allowed, mode, cache):
                if fid in used:
                    continue
                b = c.m.by_id[fid]
                if (b.skey and b.skey in usk) or (b.qsig and b.qsig in uqs):
                    continue
                xb = min(1.0, (dur + b.dur / 2) / target)
                v = (1 - CURVE_W) * sc + CURVE_W * 100 * fit_at(b, xb)
                if fid in seed_ids:
                    v += 25
                if p2 and p2 == b.akey:
                    v -= 6
                opts.append((v, fid))
            if not opts:
                done.append((val / max(1, len(seq)), val, seq, dur))
                continue
            opts.sort(key=lambda o: (-o[0], o[1]))
            for v, fid in opts[:expand]:
                nxt.append((val + v, si, fid))
        # beam'deki tüm diziler aynı uzunlukta: toplam değere göre en iyi 'width' durum; aynı küme + aynı son
        # şarkı (geleceği aynı) bir kez
        nxt.sort(key=lambda s: (-s[0], s[1], s[2]))
        new, seen = [], set()
        for val, si, fid in nxt:
            k = (beam[si][6] ^ zh(fid), fid)
            if k in seen:
                continue
            seen.add(k)
            par = beam[si]
            new.append(state(val, par[1] + [fid], par[2] + c.m.by_id[fid].dur, par))
            if len(new) >= width:
                break
        beam = new
    if beam:                                # sınır doldu: kalanlar da aday
        done.extend((st_[0] / len(st_[1]), st_[0], st_[1], st_[2]) for st_ in beam)
    done.sort(key=lambda d: (-(d[0] + (5 if d[3] >= target * .9 else 0)), d[2]))
    seq = list(done[0][2]) if done else []
    # dışarıda kalan başlangıç şarkılarını en uygun yere ekle
    for t in seeds:
        if t.id not in seq:
            best, bv = len(seq), None
            for pos in range(1, len(seq) + 1):
                v = (score(c, c.m.by_id[seq[pos - 1]], t) if pos > 0 else 0) + \
                    (score(c, t, c.m.by_id[seq[pos]]) if pos < len(seq) else 0)
                if bv is None or v > bv:
                    best, bv = pos, v
            seq.insert(best, t.id)
    ch = score_chain(c, seq)
    rows = ch["rows"]
    x = 0.0
    for r in rows:                          # eğri hedefi (arayüzdeki çizgi için)
        t = c.m.by_id[r["id"]]
        r["target"] = round(cf(min(1.0, (x + t.dur / 2) / target)), 1)
        x += t.dur
    summ = ch["summary"]
    if summ["not_ready"]:
        warnings.append("%d şarkı Engine'de henüz analiz edilmemiş." % summ["not_ready"])
    if seq and summ["unknown"] > len(seq) / 2:
        warnings.append("Şarkıların çoğunda ton / BPM yok; öneriler daha zayıf.")
    return {"source": "offline", "title": p.get("title") or "Set", "minutes": minutes, "curve": curve,
            "sections": [{"name": p.get("section") or "Set", "ids": seq}], "rows": rows,
            "transitions": ch["transitions"], "summary": summ, "warnings": warnings,
            "energy_span": [lo, hi]}


# ---------------------------------------------------------------------------
# Camelot çarkı
# ---------------------------------------------------------------------------
def camelot_wheel(c, filters=None, around=None):
    ts = pool(c, filters or {})
    counts = [0] * 24
    unknown = 0
    bins = {}
    en = [0] * 10
    for t in ts:
        if t.ci >= 0:
            counts[t.ci] += 1
        else:
            unknown += 1
        if t.bpm:
            b = int(t.bpm // 5 * 5)
            b = max(55, min(185, b))
            bins[b] = bins.get(b, 0) + 1
        en[t.energy - 1] += 1
    out = {"keys": [{"cam": K.cam_of_index(i), "n": counts[i], "musical": K.camelot_to_musical(K.cam_of_index(i))}
                    for i in range(24)], "unknown": unknown, "total": len(ts),
           "bpm": [{"lo": b, "n": bins[b]} for b in sorted(bins)], "energy": en}
    if around:
        a = c.m.by_id.get(int(around))
        if a is not None:
            out["around"] = row(a, c)
            out["compatible"] = [{"cam": x[0], "code": x[1], "score": x[2], "label": K.CAM_REL[x[1]][0]}
                                 for x in K.compatible_keys(a.cam, .3)]
    return out


def key_tracks(c, cam, filters=None, around=None, limit=500):
    f = dict(filters or {})
    cam = K.to_camelot(cam) if cam and cam != "?" else ""
    ts = [t for t in pool(c, f) if (t.cam == cam if cam else t.ci < 0)]
    a = c.m.by_id.get(int(around)) if around else None
    rows = []
    for t in ts:
        r = row(t, c)
        if a is not None and t.id != a.id:
            r["score"] = int(round(score(c, a, t)))
        rows.append(r)
    if a is not None:
        rows.sort(key=lambda r: (-(r.get("score") or 0), r["id"]))
    else:
        rows.sort(key=lambda r: (r["bpm"] or 999, names.fold(r["artist"]), names.fold(r["title"])))
    return {"cam": cam, "musical": K.camelot_to_musical(cam), "rows": rows[:limit], "n": len(rows)}


def search(c, q, limit=60):
    words = [w for w in names.fold(q or "").split() if w]
    if not words:
        return []
    qf = " ".join(words)
    out = []
    for t in c.m.tracks:
        if not all(w in t.search for w in words):
            continue
        tf = names.fold(t.title)
        ta = tf + " " + t.akey
        rank = 3 if tf.startswith(qf) else (2 if all(w in tf for w in words) else (1 if all(w in ta for w in words) else 0))
        out.append((-rank, not t.ready, names.fold(t.artist), tf, t))
    out.sort(key=lambda x: x[:4])
    return [row(x[4], c) for x in out[:limit]]


def info(lib, c):
    m = c.m
    gens = {}
    for t in m.tracks:
        if t.gid:
            g = gens.setdefault(t.gid, {"id": t.gid, "name": t.genre, "color": t.color, "n": 0})
            g["n"] += 1
    prefs = lib.prefs()
    return {"total": len(m.tracks), "with_key": sum(1 for t in m.tracks if t.ci >= 0),
            "with_bpm": sum(1 for t in m.tracks if t.bpm), "ready": sum(1 for t in m.tracks if t.ready),
            "mik_energy": sum(1 for t in m.tracks if not t.e_est),
            "genres": sorted(gens.values(), key=lambda g: names.fold(g["name"] or "")),
            "curves": [{"key": k, "name": CURVE_NAMES[k], "pts": CURVES[k]} for k in CURVES],
            "learned": c.info, "bpm_range": c.rng, "weights": WEIGHTS,
            "ai": {"key_set": bool(ai.settings_of(prefs)[0]), "model": ai.settings_of(prefs)[1]}}


# ---------------------------------------------------------------------------
# Yapay zekâ ile set ve "sonra ne gelsin?"
# ---------------------------------------------------------------------------
AI_SYSTEM = """Sen Türkiye'de ve Almanya'daki Türk düğünlerinde (düğün, kına gecesi, nişan, sünnet, matine) çalan deneyimli bir mobil DJ'in müzik asistanısın. Görevin, sana verilen aday şarkılardan isteğe uyan, akıcı ve çalınabilir bir liste kurmak.

Kurallar:
- YALNIZCA aday listesindeki şarkıları numaralarıyla (i) kullan. Şarkı uydurma, listede olmayan numara yazma, bir şarkıyı iki kez koyma.
- Türk etkinlik akışını gözet: karşılama / fon sakin başlar; giriş, ilk dans, pasta, takı gibi özel anlar kendi bölümündedir; ardından halay, oyun havası, Karadeniz (horon), Roman / mezdeke gibi coşkulu bölümler gelir; Türkçe pop ve yabancı dans parçaları enerjiyi taşır; kapanış ya duygulu ya coşkuludur. İstek farklıysa isteğe uy.
- Geçişler: Camelot'ta aynı ton, ±1 komşu ton ve A↔B paralel geçiş en temizidir; +2 enerjiyi yükseltir; uzak tonları yan yana koyma. Tempo farkı %6'yı geçmesin (yarım / çift tempo uyumlu sayılır); büyük tempo sıçramalarını bölüm aralarına koy.
- Enerji (1–10) istenen eğriyi izlesin (ör. "sakin başla, sonunda coşsun"). "~" ile işaretli enerji tahmindir.
- "Birlikte çalınanlar" DJ'in daha önce arka arkaya çaldığı çiftlerdir; uygun düştükçe kullan.
- Aynı sanatçıyı arka arkaya koyma. Toplam süre hedefe yakın olsun (±%10).
- Bölümlere kısa Türkçe adlar ver (ör. "Karşılama", "Halay", "Oyun Havası", "Final"); tek bölüm de olabilir.
- Her şarkı için "why" alanına en çok 8 kelimelik Türkçe gerekçe yaz; "notes" alanına DJ'e 1–2 kısa cümle ipucu yaz."""

AI_SET_SCHEMA = {
    "type": "object",
    "properties": {
        "title": {"type": "string"},
        "sections": {"type": "array", "items": {
            "type": "object",
            "properties": {
                "name": {"type": "string"},
                "tracks": {"type": "array", "items": {
                    "type": "object", "properties": {"i": {"type": "integer"}, "why": {"type": "string"}},
                    "required": ["i", "why"], "additionalProperties": False}},
            },
            "required": ["name", "tracks"], "additionalProperties": False}},
        "notes": {"type": "string"},
    },
    "required": ["title", "sections", "notes"],
    "additionalProperties": False,
}
AI_NEXT_SCHEMA = {
    "type": "object",
    "properties": {
        "picks": {"type": "array", "items": {
            "type": "object", "properties": {"i": {"type": "integer"}, "why": {"type": "string"}},
            "required": ["i", "why"], "additionalProperties": False}},
        "note": {"type": "string"},
    },
    "required": ["picks", "note"],
    "additionalProperties": False,
}
AI_MAX = 250


def _clean(s, n=60):
    s = re.sub(r"[\r\n\t|]+", " ", str(s or "")).strip()
    return s[:n]


def _fmt_dur(sec):
    sec = int(round(sec or 0))
    return "%d:%02d" % (sec // 60, sec % 60)


def _cand_line(i, t):
    return "%d | %s | %s | %s | %s | %s | %s%d | %s" % (
        i, _clean(t.title), _clean(t.artist, 40) or "-", _clean(t.genre or t.tg, 30) or "-",
        ("%d" % round(t.bpm)) if t.bpm else "-", t.cam or "-", "~" if t.e_est else "", t.energy,
        _fmt_dur(t.dur) if t.dur_known else "?")


def shortlist(c, request="", genres=None, seeds=None, limit=AI_MAX, exclude=None):
    """Yapay zekâya gidecek en çok 'limit' aday: tür / anahtar kelime eşleşmesi, başlangıç şarkılarına ton ve tempo
    uyumu, öğrenilmiş çiftler; analiz edilmişler önce. Hiç eşleşme yoksa türlere dengeli dağılmış bir seçki."""
    words = set(events.keywords_for(request or "")) if request else set()
    reqf = names.fold(request or "")
    gm = _gmatch({"genres": genres or []})
    mentioned = set()
    for t in c.m.tracks:
        if t.genre:
            gk = names.fold(t.genre)
            if gk and (gk in reqf or any(len(w) >= 4 and w in reqf for w in gk.split())):
                mentioned.add(gk)
    seeds = [c.m.by_id[x] for x in _ids(seeds) if x in c.m.by_id]
    seed_ids = {t.id for t in seeds}
    excl = set(_ids(exclude)) - seed_ids
    scored = []
    for t in c.m.tracks:
        if t.id in excl:
            continue
        s = 0.0
        if gm and gm(t):
            s += 6
        elif gm:
            s -= 4
        gk = names.fold(t.genre or "")
        if gk and gk in mentioned:
            s += 5
        if words:
            hits = sum(1 for w in words if w in t.search)
            s += min(4, 2 * hits)
        if seeds:
            best = max(score(c, a, t) for a in seeds)
            s += 3 * best / 100.0
            if any(c.succ.get(a.id, {}).get(t.id) for a in seeds):
                s += 2
        if t.ready:
            s += 1
        if t.ci >= 0 and t.bpm:
            s += .5
        s += min(1.5, c.plays.get(t.id, 0) * .3)
        scored.append((s, t))
    scored.sort(key=lambda x: (-x[0], x[1].id))
    strong = [t for s, t in scored if s >= 4]
    out = list(seeds)
    if len(strong) >= 10:
        for t in strong:
            if len(out) >= limit:
                break
            if t.id not in seed_ids:
                out.append(t)
    # az eşleşme: türlere dengeli dağıt (her türden en iyiler sırayla)
    if len(out) < min(limit, len(scored)):
        by_g = {}
        for s, t in scored:
            by_g.setdefault(t.gkey or "", []).append(t)
        have = {t.id for t in out}
        lists_ = [v for _k, v in sorted(by_g.items(), key=lambda kv: (-len(kv[1]), kv[0]))]
        k = 0
        while len(out) < limit and any(lists_):
            lst = lists_[k % len(lists_)]
            while lst:
                t = lst.pop(0)
                if t.id not in have:
                    out.append(t)
                    have.add(t.id)
                    break
            k += 1
            lists_ = [x for x in lists_ if x] or []
            if not lists_:
                break
    return out[:limit]


def _hints(c, cands):
    idx = {t.id: i for i, t in enumerate(cands)}
    pairs = []
    for t in cands:
        for b, r in (c.succ.get(t.id) or {}).items():
            if r[1] and b in idx:
                pairs.append((r[0], idx[t.id], idx[b]))
    pairs.sort(key=lambda x: -x[0])
    return ["%d>%d" % (a, b) for _w, a, b in pairs[:60]]


def build_prompt(c, cands, request, minutes, genres=None, seed_idx=None):
    avg = sum(t.dur for t in cands) / len(cands) if cands else DEFAULT_DUR
    lines = ["İstek: " + _clean(request, 500) if request else "İstek: (yok) — dengeli, akıcı bir set kur.",
             "Hedef süre: %d dakika (yaklaşık %d şarkı)" % (minutes, max(1, round(minutes * 60 / avg)))]
    if genres:
        lines.append("Tür tercihi: " + ", ".join(_clean(g, 30) for g in genres))
    if seed_idx:
        lines.append("Başlangıç şarkıları (bunları mutlaka kullan, ilkiyle başla): " + ", ".join(map(str, seed_idx)))
    lines.append("Tempo toleransı: ±%%%d" % round(c.rng))
    lines.append("")
    lines.append("Adaylar (i | ad | sanatçı | tür | BPM | Camelot | enerji | süre):")
    lines.extend(_cand_line(i, t) for i, t in enumerate(cands))
    h = _hints(c, cands)
    if h:
        lines.append("")
        lines.append("Birlikte çalınanlar (i>j): " + ", ".join(h))
    return "\n".join(lines)


def _ai_error(e):
    return {"code": getattr(e, "code", "ai_error"), "message": str(e),
            "retry_after": getattr(e, "retry_after", None)}


def _fallback_params(p):
    req = p.get("request") or ""
    return {"seeds": p.get("seeds") or [], "genres": p.get("genres") or [], "exclude": p.get("exclude") or [],
            "minutes": p.get("minutes") or _guess_minutes(req) or 60,
            "curve": p.get("curve") or _guess_curve(req) or "wave", "only_ready": p.get("only_ready"),
            "title": p.get("title") or "Set"}


def ai_build(c, params, prefs, opener=None):
    """Yapay zekâ ile set. Hata olursa çevrimdışı set + 'ai_error' döner (arayüz bunu gösterir)."""
    p = params or {}
    req = (p.get("request") or "").strip()
    minutes = max(5, min(600, int(p.get("minutes") or _guess_minutes(req) or 60)))
    try:
        cands = shortlist(c, req, p.get("genres"), p.get("seeds"), exclude=p.get("exclude"))
        if not cands:
            raise ai.AIError("Kütüphanede uygun şarkı yok.", "ai_no_candidates")
        sids = set(_ids(p.get("seeds")))
        seed_idx = [i for i, t in enumerate(cands) if t.id in sids]
        prompt = build_prompt(c, cands, req, minutes, p.get("genres"), seed_idx)
        out = ai.ask_json(prompt, AI_SET_SCHEMA, prefs, system=AI_SYSTEM, opener=opener)
    except ai.AIError as e:
        res = build_set(c, _fallback_params(dict(p, minutes=minutes)))
        res["ai_error"] = _ai_error(e)
        return res
    used, sections, dropped = set(), [], 0
    for sec in out.get("sections") or []:
        ids, why = [], {}
        for it in sec.get("tracks") or []:
            i = it.get("i") if isinstance(it, dict) else None
            if not isinstance(i, int) or isinstance(i, bool) or not 0 <= i < len(cands):
                dropped += 1
                continue
            t = cands[i]
            if t.id in used:
                dropped += 1
                continue
            used.add(t.id)
            ids.append(t.id)
            why[t.id] = _clean(it.get("why"), 120)
        if ids:
            sections.append({"name": _clean(sec.get("name"), 60) or "Bölüm", "ids": ids, "why": why})
    if not sections:
        res = build_set(c, _fallback_params(dict(p, minutes=minutes)))
        res["ai_error"] = {"code": "ai_empty", "message": "Yapay zekâ kullanılabilir bir liste döndürmedi."}
        return res
    flat = [x for s in sections for x in s["ids"]]
    ch = score_chain(c, flat)
    whys = {}
    for s in sections:
        whys.update(s.pop("why"))
    for r in ch["rows"]:
        r["why"] = whys.get(r["id"], "")
    warnings = []
    if dropped:
        warnings.append("Yapay zekânın %d önerisi listede yoktu ya da tekrardı; atlandı." % dropped)
    if ch["summary"]["dur"] < minutes * 60 * .8:
        warnings.append("Set istenen süreden kısa kaldı (%d dk)." % round(ch["summary"]["dur"] / 60))
    if ch["summary"]["not_ready"]:
        warnings.append("%d şarkı Engine'de henüz analiz edilmemiş." % ch["summary"]["not_ready"])
    return {"source": "ai", "title": _clean(out.get("title"), 80) or "Set", "notes": _clean(out.get("notes"), 400),
            "minutes": minutes, "sections": sections, "rows": ch["rows"], "transitions": ch["transitions"],
            "summary": ch["summary"], "warnings": warnings, "dropped": dropped, "shortlist": len(cands),
            "model": out.get("_model"), "usage": out.get("_usage")}


def ai_next(c, fid, prefs, prev_fid=None, filters=None, opener=None, pick=5):
    """Yapay zekâ, çevrimdışı ilk 40 aday arasından en iyi 5'i seçip açıklar. Hata: çevrimdışı ilk 5 + ai_error."""
    off = next_tracks(c, fid, prev_fid, filters, limit=40)
    cands = [c.m.by_id[r["id"]] for r in off["items"]]
    a = c.m.by_id[off["cur"]["id"]]
    if not cands:
        off["items"] = []
        off["source"] = "offline"
        return off
    lines = ["Şu an çalan: " + _cand_line(0, a).split(" | ", 1)[1],
             "Bu şarkıdan sonra en iyi %d şarkıyı seç ve kısaca nedenini yaz. Ton (Camelot), tempo, enerji akışı ve "
             "Türk etkinlik akışına bak. Sadece aday numaralarını kullan." % pick, "",
             "Adaylar (i | ad | sanatçı | tür | BPM | Camelot | enerji | süre | çevrimdışı puan):"]
    for i, (t, r) in enumerate(zip(cands, off["items"])):
        lines.append("%s | %d" % (_cand_line(i, t), r["score"]))
    try:
        out = ai.ask_json("\n".join(lines), AI_NEXT_SCHEMA, prefs, system=AI_SYSTEM, max_tokens=6000, opener=opener)
    except ai.AIError as e:
        off["items"] = off["items"][:pick]
        off["source"] = "offline"
        off["ai_error"] = _ai_error(e)
        return off
    items, used = [], set()
    by_id = {r["id"]: r for r in off["items"]}
    for it in out.get("picks") or []:
        i = it.get("i") if isinstance(it, dict) else None
        if not isinstance(i, int) or isinstance(i, bool) or not 0 <= i < len(cands) or cands[i].id in used:
            continue
        used.add(cands[i].id)
        r = dict(by_id[cands[i].id])
        r["why"] = _clean(it.get("why"), 160)
        items.append(r)
        if len(items) >= pick:
            break
    if not items:
        off["items"] = off["items"][:pick]
        off["source"] = "offline"
        off["ai_error"] = {"code": "ai_empty", "message": "Yapay zekâ kullanılabilir bir öneri döndürmedi."}
        return off
    off["items"] = items
    off["source"] = "ai"
    off["note"] = _clean(out.get("note"), 300)
    off["model"] = out.get("_model")
    return off


def improve_sections(c, sections):
    """AI seçimini koruyarak her bölümün içini harmonik sıralar; bölümler arası geçiş için önceki bölümün son
    şarkısı başa sabitlenir (sonra çıkarılır)."""
    out, prev = [], None
    for sec in sections or []:
        ids = _ids(sec.get("ids"))
        if len(ids) >= 2:
            if prev is not None and prev not in ids:
                r = harmonic_sort(c, [prev] + ids, fixed_first=prev, budget=.4)
                ids = [x for x in r["order"] if x != prev]
            else:
                ids = harmonic_sort(c, ids, budget=.4)["order"]
        if ids:
            prev = ids[-1]
        out.append({"name": sec.get("name") or "Bölüm", "ids": ids})
    flat = [x for s in out for x in s["ids"]]
    ch = score_chain(c, flat)
    return {"sections": out, "rows": ch["rows"], "transitions": ch["transitions"], "summary": ch["summary"]}


# ---------------------------------------------------------------------------
# Kaydetme (Engine listeleri; lists.Edit: Engine kapalı mı, yedek, tek 'Geri al' adımı)
# ---------------------------------------------------------------------------
def _event_label(title, date):
    if not date:
        return title
    try:
        y, m, d_ = date.split("-")
        return "%s.%s.%s - %s" % (d_, m, y, title)
    except ValueError:
        return "%s - %s" % (date, title)


def save(lib, kind, title, sections, date=None, parent=0):
    from . import lists, util
    secs = []
    for s in sections or []:
        ids = []
        for x in s.get("ids") or []:
            try:
                x = int(x)
            except (TypeError, ValueError):
                continue
            if x not in ids:
                ids.append(x)
        secs.append({"name": (s.get("name") or "").strip() or "Bölüm", "ids": ids})
    if not any(s["ids"] for s in secs):
        raise UserError("Kaydedilecek şarkı yok.")
    title = (title or "").strip() or "Asistan seti"
    skipped = 0
    if kind == "event":
        label = _event_label(title, date)
        with lists.Edit(lib, "Yeni etkinlik: %s" % label, kind="etkinlik") as e:
            root = lists._ensure_events_folder(e.w)
            first = e.w.children(root)
            pid = e.w.pl_create(root, label, before=first[0] if first else 0)
            for s in secs:
                sid = e.w.pl_create(pid, s["name"])
                refs, sk = lists.refs_for_files(lib, e.w, s["ids"], e.d)
                skipped += len(sk)
                if refs:
                    e.w.pl_set_refs(sid, refs)
            e.op.add({"k": "evmeta", "db": e.uuid, "pid": pid, "old": None})
            lib.catalog.set_ev_meta(e.uuid, pid, {"date": date or "", "venue": "", "notes": "Mix Asistanı",
                                                  "template": "", "created": util.now(), "title": title})
        return {"id": pid, "journal": e.jid, "skipped": skipped, "kind": "event"}
    ids = []
    for s in secs:
        ids.extend(x for x in s["ids"] if x not in ids)
    with lists.Edit(lib, "Yeni liste: %s" % title) as e:
        lists._guard_managed(lib, e.uuid, parent)
        pid = e.w.pl_create(int(parent or 0), title)
        refs, sk = lists.refs_for_files(lib, e.w, ids, e.d)
        skipped += len(sk)
        if refs:
            e.w.pl_set_refs(pid, refs)
        e.op.title = "Yeni liste: %s (%d şarkı)" % (e.w.pl(pid)["title"], len(refs))
    return {"id": pid, "journal": e.jid, "skipped": skipped, "kind": "list"}


def list_sort(lib, c, pid, curve=None):
    """Var olan bir Engine listesi için önce / sonra karşılaştırması ve uygulanacak sıra (refs)."""
    from . import lists
    it = lists.items(lib, pid)
    if it.get("managed"):
        raise UserError("Bu liste program tarafından tutuluyor; önce kopyasını al.", "managed")
    entries = it["items"]
    fids = [e["fid"] for e in entries if e.get("fid") and e["fid"] in c.m.by_id]
    if len(fids) > MAX_SORT:
        raise UserError("Bu liste çok uzun (%d şarkı). Harmonik sıralama en çok %d şarkılık listelerde yapılır."
                        % (len(fids), MAX_SORT), "too_long")
    res = harmonic_sort(c, fids, curve=curve)
    by_fid = {}
    for e in entries:
        if e.get("fid"):
            by_fid.setdefault(e["fid"], []).append(e["ref"])
    refs, used = [], set()
    for fid in res["order"]:
        for r in by_fid.get(fid, []):
            if r not in used:
                refs.append(r)
                used.add(r)
    rest = [e["ref"] for e in entries if e["ref"] not in used]
    refs.extend(rest)
    before = score_chain(c, fids)
    return {"id": it["id"], "title": it["title"], "path": it["path"], "n": len(entries), "sortable": len(fids),
            "kept": len(rest), "refs": refs, "current": [e["ref"] for e in entries],
            "before": {"rows": before["rows"], "transitions": before["transitions"], "summary": before["summary"]},
            "after": {"rows": res["rows"], "transitions": res["transitions"], "summary": res["after"]},
            "same": refs == [e["ref"] for e in entries]}


# ---------------------------------------------------------------------------
# API: /api/assistant/...
# ---------------------------------------------------------------------------
def list_fids(lib, pid):
    """Bir Engine listesindeki / etkinlikteki (alt bölümler dahil) şarkıların dosya kimlikleri."""
    st = lib.engine_state()
    if not st.get("db"):
        return []
    ids = {int(pid)} | set(events._descendants(st, int(pid)))
    out = []
    for p in st["playlists"]:
        if p["id"] in ids:
            for tid in p["entries"]:
                fid = st["fid_of_tid"].get(tid)
                if fid and fid not in out:
                    out.append(fid)
    return out


def _with_excl(lib, b):
    """exclude_list (ya da exclude_used_in_event): o listede / etkinlikte olanlar sete girmesin."""
    pid = b.get("exclude_list") or b.get("exclude_used_in_event")
    if not pid:
        return b
    b = dict(b)
    b["exclude"] = list(b.get("exclude") or []) + list_fids(lib, pid)
    return b


def _filters(b):
    f = b.get("filters") if isinstance(b.get("filters"), dict) else {}
    return f


def _qs_filters(qs):
    f = {}
    if qs.get("genres"):
        f["genres"] = [x for x in qs["genres"].split(",") if x]
    if qs.get("ready") in ("1", "true"):
        f["ready"] = True
    return f


@route("assistant")
def _api(h, lib, method, parts, qs, body):
    act = parts[1] if len(parts) > 1 else ""
    b = body or {}
    if method == "GET":
        if act == "info":
            return h._json(info(lib, context(lib)))
        if act == "wheel":
            return h._json(camelot_wheel(context(lib), _qs_filters(qs), qs.get("around")))
        if act == "search":
            return h._json(search(context(lib), qs.get("q") or "", int(qs.get("limit") or 60)))
        return None
    if method != "POST":
        return None
    if act == "next":
        return h._json(next_tracks(context(lib), b.get("id"), b.get("prev"), _filters(b), b.get("limit") or 30))
    if act == "key":
        return h._json(key_tracks(context(lib), b.get("cam") or "", _filters(b), b.get("around")))
    if act == "score":
        return h._json(score_chain(context(lib), b.get("ids") or []))
    if act == "sort":
        return h._json(harmonic_sort(context(lib), b.get("ids") or [], b.get("fixed_first"), b.get("fixed_last"),
                                     b.get("curve")))
    if act == "build":
        return h._json(build_set(context(lib), _with_excl(lib, b)))
    if act == "improve":
        return h._json(improve_sections(context(lib), b.get("sections") or []))
    if act == "ai_build":
        return h._json(ai_build(context(lib), _with_excl(lib, b), lib.prefs()))
    if act == "ai_next":
        return h._json(ai_next(context(lib), b.get("id"), lib.prefs(), b.get("prev"), _filters(b)))
    if act == "list_sort":
        return h._json(list_sort(lib, context(lib), int(b.get("id") or 0), b.get("curve")))
    if act == "apply_sort":
        from . import lists
        return h._json(lists.reorder(lib, int(b.get("id") or 0), b.get("refs") or []))
    if act == "save":
        return h._json(save(lib, b.get("kind") or "list", b.get("title"), b.get("sections") or [],
                            b.get("date"), b.get("parent") or 0))
    return None
