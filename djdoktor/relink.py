"""Kayıp yollar: program DIŞINDA (Finder, Explorer, başka bir program) adı ya da yeri değişen dosyaların Engine ve
Serato kayıtlarını bulup yeniden bağlar.

Örnek: 'Müzik/Türküler/Neşet Ertaş - Gönül Dağı.mp3' Finder'da 'Müzik/Turkuler/Neset Ertas - Gonul Dagi.mp3'
oldu. Engine'deki kayıt ve Serato'daki crate'ler eski yolu gösterir (kırmızı / kayıp). Program her kayıp kayıt
için diskteki dosyayı şu yollarla arar (her eşleşmenin bir güveni ve gerekçesi vardır):

  gecmis     : programın kendi taşıma / ad değiştirme geçmişi                         -> kesin
  ses_imzasi : eski katalog satırının ses imzası tek bir dosyada var                   -> kesin
               (Engine Library kopyaları ve karantina sayılmaz)
  ad_sade    : Türkçe harf / aksan / büyük-küçük harf / NFD farkı dışında yol aynı     -> kesin (boyut ya da süre
               tutuyorsa), yuksek (yalnızca ad)
  klasor_adi : bir klasörün adı değişmiş: o klasördeki kayıpların çoğu yeni bir klasörde -> yuksek
  ad_boyut   : başka bir yerde aynı ad ve aynı boyut / süre                             -> orta

Bağlama tek işlemdir: önce yedek, sonra Engine (yol; çakışmada analizli kayıt korunarak birleştirme) ve Serato
(database V2 + bütün crate'ler, yazım biçimi korunur), tür / kural kayıtları; 'Geri al' hepsini döndürür.
Arka planda yalnızca 'kesin' olanlar kendiliğinden bağlanır; diğerleri kullanıcıya sorulur.
"""
from __future__ import annotations

import hashlib
import json
import os
from collections import defaultdict

from . import engine, journal, names, relocate, serato
from .resolver import Resolver

OK_MATCH = ("exact", "case", "unicode", "sfm")
CONF = {"kesin": 0, "yuksek": 1, "orta": 2}
METHODS = {"gecmis": "Program geçmişi", "ses_imzasi": "Ses imzası", "ad_sade": "Aynı ad (harf farkı)",
           "klasor_adi": "Klasör adı değişmiş", "ad_boyut": "Aynı ad ve boyut"}


def _err(msg, code=None):
    from .library import UserError
    return UserError(msg, code)


def _usable(rel):
    p = names.split_rel(rel)
    return bool(p) and names.fold(p[0]) not in relocate.PROTECT_TOP and not any(x.startswith(".") for x in p)


class Index:
    """Diskte bulunan ses dosyaları (Engine Library kopyaları, karantina, Serato klasörü hariç)."""

    def __init__(self, lib):
        rows = lib.catalog.q("SELECT id, rel, name, size, duration, qsig, alen FROM files WHERE present=1 "
                             "AND kind IN ('audio','video')")
        self.rows = [r for r in rows if _usable(r["rel"])]
        memo = {}

        def fold(p):                          # klasör adları binlerce kez tekrar eder: bir kez katla
            v = memo.get(p)
            if v is None:
                v = memo[p] = names.fold(p)
            return v

        def fpath(rel):
            return "/".join(fold(p) for p in names.split_rel(rel))
        self.fold_path = fpath
        self.by_id = {r["id"]: r for r in self.rows}
        self.by_fpath = defaultdict(list)
        self.by_fname = defaultdict(list)
        self.by_sig = defaultdict(list)
        self.children = defaultdict(set)      # katlanmış klasör yolu -> {gerçek alt klasör adı}
        self.dirs = set()
        self.real_dir = {}                    # katlanmış klasör yolu -> gerçek yol
        seen_dirs = set()
        for r in self.rows:
            parts = names.split_rel(r["rel"])
            fparts = [fold(p) for p in parts]
            self.by_fpath["/".join(fparts)].append(r)
            self.by_fname[fparts[-1] if fparts else ""].append(r)
            if r["qsig"]:
                self.by_sig[(r["qsig"], r["alen"])].append(r)
            d = "/".join(parts[:-1])
            if d in seen_dirs:
                continue
            seen_dirs.add(d)
            for i in range(len(parts) - 1):
                parent = "/".join(fparts[:i])
                self.children[parent].add(parts[i])
                k = "/".join(fparts[:i + 1])
                self.dirs.add(k)
                self.real_dir.setdefault(k, "/".join(parts[:i + 1]))


def _cand(r):
    return {"fid": r["id"], "rel": names.display(r["rel"])}


def _evidence(ref, f, old=None):
    """Boyut, süre ya da eski ses imzası bu dosyayı doğruluyor mu?"""
    if ref.get("size") and f.get("size") and int(ref["size"]) == int(f["size"]):
        return True
    if ref.get("dur") and f.get("duration") and abs(float(ref["dur"]) - float(f["duration"])) <= 1.5:
        return True
    if old and old.get("qsig") and old["qsig"] == f.get("qsig") and old.get("alen") == f.get("alen"):
        return True
    return False


def _history(cat, rel):
    fid = cat.history_fid(rel)
    guard = 0
    while fid and guard < 20:
        f0 = cat.file(fid)
        if f0 and f0["present"]:
            return fid
        fid = cat.history_fid(f0["rel"]) if f0 else None
        guard += 1
    return None


def infer_folder_renames(ix, rels, rounds=8):
    """Klasör adı değişikliklerini oylamayla bulur: kayıp yolları (var olan en derin üst klasör, ilk kayıp parça)
    diye gruplar; o üst klasördeki her alt klasör için kaç kaydın devamının orada bulunduğunu sayar.
    -> ({kayıp_rel: eşlenmiş_rel}, [{'old','new','votes','total'}])"""
    mapped = {r: r for r in rels}
    found = {}
    folders = []
    for _it in range(rounds):
        groups = defaultdict(list)
        for orig, cur in mapped.items():
            if orig in found:
                continue
            parts = names.split_rel(cur)
            k = 0
            while k < len(parts) - 1 and names.fold_path("/".join(parts[:k + 1])) in ix.dirs:
                k += 1
            if k >= len(parts) - 1:
                continue
            groups[("/".join(parts[:k]), parts[k])].append((orig, parts[k + 1:]))
        progress = False
        for (parent, miss), refs in groups.items():
            score = {}
            for cand in ix.children.get(names.fold_path(parent), ()):
                base = ([parent] if parent else []) + [cand]
                hits = sum(1 for _o, rest in refs
                           if names.fold_path("/".join(base + rest)) in ix.by_fpath
                           or (len(rest) > 1 and names.fold_path("/".join(base + rest[:1])) in ix.dirs))
                if hits:
                    score[cand] = hits
            if not score:
                continue
            best = sorted(score.items(), key=lambda kv: (-kv[1], kv[0]))
            cand, hits = best[0]
            second = best[1][1] if len(best) > 1 else 0
            same = names.fold(cand) == names.fold(miss)
            if (hits >= 2 or same) and hits * 2 >= len(refs) and hits > second:
                base = ([parent] if parent else []) + [cand]
                for orig, rest in refs:
                    mapped[orig] = "/".join(base + rest)
                old_dir = "/".join(([parent] if parent else []) + [miss])
                new_dir = ix.real_dir.get(names.fold_path("/".join(base)), "/".join(base))
                folders.append({"old": old_dir, "new": new_dir, "votes": hits, "total": len(refs)})
                progress = True
        for orig, cur in mapped.items():
            if orig not in found and ix.by_fpath.get(names.fold_path(cur)):
                found[orig] = cur
        if not progress:
            break
    return mapped, folders


def index(lib):
    """Önbellekli dizin (katalog değişene kadar)."""
    return lib.cached("relink_index", lib.data_key(), lambda: Index(lib))


def match(lib, refs, ix=None):
    """refs: [{'key','rel','size'?,'dur'?}] -> {key: {'fid','rel','method','confidence','status','candidates'}}
    status: found | ambiguous | none."""
    if not refs:
        return {}
    ix = ix or index(lib)
    cat = lib.catalog
    out = {}
    todo = []
    olds = {}
    for ref in refs:
        rel = ref["rel"]
        key = ref["key"]
        fid = _history(cat, rel)
        if fid and fid in ix.by_id:
            out[key] = {"fid": fid, "method": "gecmis", "confidence": "kesin", "status": "found"}
            continue
        old = cat.q1("SELECT qsig, alen, size, duration FROM files WHERE lkey=? AND present=0 AND qsig IS NOT NULL",
                     (names.loose_key(rel),))
        olds[key] = old
        amb = None
        if old:
            c = ix.by_sig.get((old["qsig"], old["alen"]), [])
            if len(c) > 1:
                c2 = [x for x in c if names.fold(x["name"]) == names.fold(names.split_rel(rel)[-1])]
                c = c2 or c
            if len(c) == 1:
                out[key] = {"fid": c[0]["id"], "method": "ses_imzasi", "confidence": "kesin", "status": "found"}
                continue
            if len(c) > 1:
                amb = {"method": "ses_imzasi", "candidates": c}
        c = ix.by_fpath.get(names.fold_path(rel), [])
        if len(c) == 1:
            conf = "kesin" if _evidence(ref, c[0], old) else "yuksek"
            out[key] = {"fid": c[0]["id"], "method": "ad_sade", "confidence": conf, "status": "found"}
            continue
        if len(c) > 1:
            ev = [x for x in c if _evidence(ref, x, old)]
            if len(ev) == 1:
                out[key] = {"fid": ev[0]["id"], "method": "ad_sade", "confidence": "kesin", "status": "found"}
                continue
            amb = {"method": "ad_sade", "candidates": c}
        if amb:
            out[key] = {"fid": None, "method": amb["method"], "confidence": None, "status": "ambiguous",
                        "candidates": [_cand(x) for x in amb["candidates"][:8]]}
            continue
        todo.append(ref)
    mapped, _folders = infer_folder_renames(ix, [r["rel"] for r in todo]) if todo else ({}, [])
    for ref in todo:
        key, rel = ref["key"], ref["rel"]
        cur = mapped.get(rel, rel)
        if cur != rel:
            c = ix.by_fpath.get(names.fold_path(cur), [])
            if len(c) == 1:
                conf = "kesin" if _evidence(ref, c[0], olds.get(key)) else "yuksek"
                out[key] = {"fid": c[0]["id"], "method": "klasor_adi", "confidence": conf, "status": "found"}
                continue
        c = ix.by_fname.get(names.fold(names.split_rel(cur)[-1]), [])
        c = [x for x in c if _evidence(ref, x, olds.get(key))]
        if len(c) == 1:
            out[key] = {"fid": c[0]["id"], "method": "ad_boyut", "confidence": "orta", "status": "found"}
        elif len(c) > 1:
            out[key] = {"fid": None, "method": "ad_boyut", "confidence": None, "status": "ambiguous",
                        "candidates": [_cand(x) for x in c[:8]]}
        else:
            out[key] = {"fid": None, "method": None, "confidence": None, "status": "none"}
    for v in out.values():
        if v.get("fid"):
            v["rel"] = ix.by_id[v["fid"]]["rel"]
    return out


# ---------------------------------------------------------------------------
# Kayıp kayıtlar
# ---------------------------------------------------------------------------
def find_missing(lib, sx=None):
    """Engine (her veritabanı) ve Serato'da (database V2 + bütün crate'ler, diskten taze) dosyası bulunamayan
    kayıtlar. -> {'engine': [...], 'serato': [...], 'sx': serato dizini}"""
    from . import maintain
    out = {"engine": [], "serato": [], "sx": None}
    rs = Resolver(lib.catalog, lib.root)
    for d in lib.engine_dbs():
        try:
            data = engine.read(d["path"])
        except Exception:
            continue
        tracks, _bf, orphans, _r, _t = lib.engine_map(d, data, rs)
        miss = [(tid, rel) for tid, rel, m in orphans if m in ("missing", "nodir") and rel]
        if not miss:
            continue
        mg = maintain.managed_ids(lib, data["uuid"]) if d["key"] == "drive" else set()
        lists_of = defaultdict(list)
        want = {tid for tid, _r in miss}
        for p in data["playlists"]:
            if p["id"] in mg:
                continue
            for tid in set(x for x in p["entries"] if x in want):
                lists_of[tid].append(" / ".join(p["path"]))
        for tid, rel in miss:
            t = tracks[tid]
            out["engine"].append({"key": "e:%s:%d" % (d["key"], tid), "db": d["key"], "tid": tid,
                                  "path": t.get("path") or "", "rel": rel, "title": t.get("title") or "",
                                  "artist": t.get("artist") or "", "size": t.get("fileBytes"),
                                  "dur": t.get("length"), "lists": sorted(lists_of.get(tid, []))})
    sdir = lib.serato_dir()
    if sdir:
        sx = sx or serato.index(sdir)
        out["sx"] = sx
        for raw, where in sx["raws"].items():
            f, m = rs.resolve(raw)
            if f and f["present"] and m in OK_MATCH:
                continue
            rel = names.to_disk_form(raw, True)
            if not _usable(rel):
                continue
            info = sx["db"].get(raw) or sx["db"].get(sx["db_by_mkey"].get(names.match_key(raw)) or "") or {}
            out["serato"].append({"key": "s:" + hashlib.sha1(raw.encode("utf-8", "surrogatepass")).hexdigest()[:12],
                                  "raw": raw, "rel": rel, "where": list(where), "title": info.get("title") or "",
                                  "artist": info.get("artist") or "", "dur": info.get("dur")})
    return out


def _folders_for_meta(lib, ix, items, inferred):
    """Tür / kural / ana klasör kayıtlarından diskte artık olmayanlar için yeni klasör (aynı ad sadeleşmiş ya da
    oylamayla bulunan). -> [{'old','new','refs','genre','rule','music_root'}]"""
    cat = lib.catalog
    want = {}
    for g in cat.genres():
        want.setdefault(g["rel"], {}).update(genre=g["id"])
    for r0, act in cat.folder_rules().items():
        want.setdefault(r0, {}).update(rule=True)
    mr = lib.music_root()
    if mr:
        want.setdefault(mr, {}).update(music_root=True)
    # oylamayla bulunan klasörler + bulunan eşleşmelerden çıkan klasör eşlemeleri
    pairs = {}
    for f in inferred:
        pairs.setdefault(names.loose_key(f["old"]), (f["old"], f["new"]))
    out = []
    depth_of = lambda r: len(names.split_rel(r))  # noqa: E731
    for rel, flags in want.items():
        if os.path.isdir(lib.rootinfo.os_path(rel)):
            continue
        new, sure = None, False
        cand = ix.real_dir.get(names.fold_path(rel))
        if cand and names.loose_key(cand) != names.loose_key(rel):
            new, sure = cand, True                  # aynı ad, yalnızca harfler sadeleşmiş
        # bu klasördeki kayıpların bulunduğu yeni klasörler (çoğunluk); 'kesin' eşleşmeler ayrıca sayılır
        votes, kvotes, n, nk = defaultdict(int), defaultdict(int), 0, 0
        for it in items:
            if it["status"] != "found":
                continue
            rest = relocate._under(it["_old"], rel)
            if not rest:
                continue
            newp = names.split_rel(it["_new"])
            if len(newp) <= depth_of(rel):
                continue
            k = "/".join(newp[:depth_of(rel)])
            n += 1
            votes[k] += 1
            if it.get("confidence") == "kesin":
                nk += 1
                kvotes[k] += 1
        if new is None and pairs:
            hit = relocate.DirMap([pairs[k] for k in pairs]).apply(rel + "/x")
            if hit:
                new = names.parent_rel(hit)
        if new is None and votes:
            best, v = sorted(votes.items(), key=lambda kv: -kv[1])[0]
            if v * 2 > n:
                new = best
        if new and not sure and kvotes:
            kb, kv = sorted(kvotes.items(), key=lambda kv_: -kv_[1])[0]
            sure = kb == new and kv * 2 > nk and kv >= 2
        if new and os.path.isdir(lib.rootinfo.os_path(new)):
            out.append({"old": rel, "new": new, "genre": flags.get("genre"), "rule": bool(flags.get("rule")),
                        "music_root": bool(flags.get("music_root")), "sure": sure})
    out.sort(key=lambda x: x["old"].count("/"))
    return out


def plan(lib):
    """Kayıp Engine / Serato kayıtları ve her biri için bulunan dosya. (salt okuma)"""
    miss = find_missing(lib)
    ix = index(lib)
    refs = [{"key": e["key"], "rel": e["rel"], "size": e["size"], "dur": e["dur"]} for e in miss["engine"]]
    refs += [{"key": s["key"], "rel": s["rel"], "dur": s["dur"]} for s in miss["serato"]]
    m = match(lib, refs, ix)
    items = []
    for src, rows in (("engine", miss["engine"]), ("serato", miss["serato"])):
        for r in rows:
            x = m.get(r["key"]) or {"status": "none"}
            it = {"key": r["key"], "src": src, "old": names.display(r["rel"]),
                  "new": names.display(x["rel"]) if x.get("rel") else None, "fid": x.get("fid"),
                  "method": x.get("method"), "confidence": x.get("confidence"), "status": x["status"],
                  "candidates": x.get("candidates") or [], "title": r.get("title") or "",
                  "artist": r.get("artist") or "", "_old": r["rel"], "_new": x.get("rel")}
            if src == "engine":
                it.update(db=r["db"], tid=r["tid"], where=r["lists"], _path=r["path"])
            else:
                it.update(where=r["where"], _raw=r["raw"])
            items.append(it)
    _m, inferred = infer_folder_renames(ix, [r["rel"] for r in refs if (m.get(r["key"]) or {}).get("method") ==
                                             "klasor_adi"])
    folders = _folders_for_meta(lib, ix, items, inferred)
    items.sort(key=lambda x: ({"found": 0, "ambiguous": 1, "none": 2}[x["status"]],
                              CONF.get(x.get("confidence"), 3), x["src"], names.fold(x["old"])))
    counts = {"engine": len(miss["engine"]), "serato": len(miss["serato"]),
              "found": sum(1 for x in items if x["status"] == "found"),
              "kesin": sum(1 for x in items if x.get("confidence") == "kesin"),
              "ambiguous": sum(1 for x in items if x["status"] == "ambiguous"),
              "none": sum(1 for x in items if x["status"] == "none"), "folders": len(folders)}
    sig = json.dumps([(x["key"], x["fid"], x["status"], x.get("confidence")) for x in items] +
                     [(f["old"], f["new"]) for f in folders], ensure_ascii=False)
    blocked = None
    if any(x["src"] == "engine" and x["status"] != "none" for x in items) and lib.engine_open():
        blocked = "engine_open"
    elif any(x["src"] == "serato" and x["status"] != "none" for x in items) and lib.serato_open():
        blocked = "serato_open"
    return {"token": hashlib.sha1(sig.encode("utf-8", "surrogatepass")).hexdigest()[:20], "items": items,
            "folders": [{"old": names.display(f["old"]), "new": names.display(f["new"]), "genre": f["genre"],
                         "rule": f["rule"], "music_root": f["music_root"], "sure": f["sure"], "_old": f["old"],
                         "_new": f["new"]} for f in folders],
            "counts": counts, "blocked": blocked, "methods": METHODS}


def scan_and_plan(lib, progress=None, cancel=None):
    """Önce SSD'yi tarar (Finder'da yapılan değişiklikler kataloğa girsin), sonra kayıpları arar."""
    def sub(lo, hi):
        return (lambda r, msg=None: progress(lo + (hi - lo) * r, msg)) if progress else None
    lib.full_scan(sub(0.0, 0.8), cancel)
    if progress:
        progress(0.85, "Kayıp yollar aranıyor…")
    return plan(lib)


# ---------------------------------------------------------------------------
# Bağlama
# ---------------------------------------------------------------------------
def _nlists(w, tid):
    t = w.track(tid)
    if not t:
        return 0
    r = w.q1("SELECT COUNT(DISTINCT listId) AS n FROM PlaylistEntity WHERE databaseUuid=? AND trackId=?",
             (t["originDatabaseUuid"], t["originTrackId"]))
    return r["n"] if r else 0


def _merge_into_path(w, tid, newp):
    """Hedef yolda başka bir Engine kaydı var (kullanıcı dosyayı yeniden eklemiş): analizli / listelerde olan kayıt
    kalır, diğerinin liste yerleri ona geçer ve fazla kayıt kaldırılır. -> kalan kayıt"""
    ex = w.track_by_path(newp)
    if not ex:
        return None
    a, b = w.track(tid), w.track(ex["id"])
    score = lambda t: (bool(t["isAnalyzed"]), _nlists(w, t["id"]), -t["id"])  # noqa: E731
    keep, drop = (a, b) if score(a) >= score(b) else (b, a)
    kref = (keep["originDatabaseUuid"], keep["originTrackId"])
    dref = (drop["originDatabaseUuid"], drop["originTrackId"])
    if dref != kref:
        w.repoint_refs(dref, kref)
    w.track_delete(drop["id"])
    if w.track(keep["id"])["path"] != newp:
        w.track_set_path(keep["id"], newp)
    return keep["id"]


def apply(lib, token=None, keys=None, picks=None, include_medium=False, progress=None, auto=False, pl=None):
    """Seçilen eşleşmeleri TEK işlemde bağlar. keys: uygulanacak öğeler (None: yalnızca 'kesin' olanlar; include_medium
    ile 'yuksek' de). picks: {anahtar: fid} (birden çok aday varsa kullanıcının seçtiği dosya).
    -> {'engine','engine_merged','serato','folders','history','journal','left'}"""
    from . import maintain
    cat = lib.catalog
    picks = {str(k): int(v) for k, v in (picks or {}).items() if v}
    res = {"engine": 0, "engine_merged": 0, "serato": 0, "mirror_links": 0, "folders": 0, "history": 0,
           "journal": None, "left": 0, "skipped": None}
    with lib.lock:
        pl = pl or plan(lib)
        if token and pl["token"] != token:
            raise _err("Bu arada bir şey değişti; liste yenilendi. Kontrol edip yeniden bağla.", "stale")
        ix = None
        keys = set(keys) if keys is not None else None
        chosen = []
        for it in pl["items"]:
            if it["key"] in picks:                      # birden çok aday: kullanıcının seçtiği dosya
                fid = picks[it["key"]]
                ix = ix or index(lib)
                if fid not in ix.by_id:
                    continue
                chosen.append((it, fid, ix.by_id[fid]["rel"]))
                continue
            if it["status"] != "found":
                continue
            if keys is not None:
                ok = it["key"] in keys
            else:
                ok = it["confidence"] == "kesin" or (include_medium and it["confidence"] == "yuksek")
            if ok:
                chosen.append((it, it["fid"], it["_new"]))
        need_e = [c for c in chosen if c[0]["src"] == "engine"]
        need_s = [c for c in chosen if c[0]["src"] == "serato"]
        e_open = bool(need_e) and lib.engine_open(fresh=True)
        s_open = bool(need_s) and lib.serato_open(fresh=True)
        if not auto:
            if e_open:
                raise _err("Engine DJ açık. Bağlamak için Engine DJ'i kapatın.", "engine_open")
            if s_open:
                raise _err("Serato açık. Bağlamak için Serato'yu kapatın.", "serato_open")
        if e_open:
            need_e, res["skipped"] = [], "engine_open"
        if s_open:
            need_s, res["skipped"] = [], "serato_open"
        folders = [f for f in pl["folders"] if not os.path.isdir(lib.rootinfo.os_path(f["_old"])) and
                   (f["sure"] or not auto)]          # arka planda yalnızca kesin klasör eşlemeleri
        if not need_e and not need_s and not folders:
            res["left"] = sum(1 for x in pl["items"] if x["status"] != "none") - len(chosen)
            return res
        n = len(need_e) + len(need_s)
        op = journal.Op(lib, "bakim", ("Yolu değişen %d kayıt bağlandı" % n) + (" (otomatik)" if auto else ""))
        n0 = 0
        try:
            # Engine
            by_db = defaultdict(list)
            for it, fid, new in need_e:
                by_db[it["db"]].append((it, fid, new))
            dbs = {d["key"]: d for d in lib.engine_dbs()}
            for key, rows in by_db.items():
                d = dbs.get(key)
                if not d:
                    continue
                try:
                    engine.preflight(d["path"])
                except engine.EngineError as e:
                    raise _err(str(e))
                bk = engine.backup(d["path"], lib.backup_dir("engine"), "baglama")
                engine.prune_backups(lib.backup_dir("engine"))
                w = engine.Writer(d["path"], d["lib_dir"], lib.root)
                merged = 0
                try:
                    for it, fid, new in rows:
                        oldp = it["_path"]
                        newp = engine.repath(oldp, None, new, d["lib_dir"], lib.root)
                        r = w.track_set_path(it["tid"], newp, expect=oldp)
                        if r == "ok":
                            res["engine"] += 1
                        elif r == "cakisma":
                            if _merge_into_path(w, it["tid"], newp):
                                merged += 1
                    w.commit()
                except Exception:
                    w.rollback()
                    raise
                if merged:
                    op.add({"k": "engsnap", "db": key, "dbpath": d["path"], "backup": bk})
                    res["engine_merged"] += merged
                else:
                    op.add_engine(w, key)
            # Serato
            sdir = lib.serato_dir()
            if need_s and sdir:
                sx = serato.index(sdir)
                dialect = relocate._dialect(lib, sx)
                mapping = {}
                for it, fid, new in need_s:
                    raw = it["_raw"]
                    if raw not in sx["raws"]:
                        continue
                    mapping[raw] = sx["db_by_mkey"].get(names.match_key(new)) or \
                        serato.raw_for(raw, it["_old"], new, dialect)
                mapping = {k: v for k, v in mapping.items() if k != v}
                st = relocate.serato_rewrite(lib, sdir, sx, mapping, op, label="baglama")
                res["serato"] = st["entries"]
                res["mirror_links"] = st["mirror_links"]
            # tür / kural / ana klasör kayıtları
            for f in folders:
                res["folders"] += relocate._retarget_meta(lib, f["_old"], f["_new"], op)
            # geçmiş: bilgisayardaki (Windows) Engine kütüphanesi de sonradan bağlansın
            for it, fid, new in need_e + need_s:
                if fid:
                    cat.add_history(it["_old"], fid)
                    res["history"] += 1
        except Exception:
            journal.apply_inverse(lib, op.steps[n0:], force=True)
            lib.bump()
            raise
        lib.bump()
        if need_s:
            lib.analyze_serato()
        res["maint"] = maintain.after_change(lib, op)
        res["journal"] = op.commit()
        res["left"] = max(0, sum(1 for x in pl["items"] if x["status"] != "none") - len(need_e) - len(need_s))
        return res


def auto(lib):
    """Arka plan: yalnızca 'kesin' eşleşmeleri bağlar (Engine / Serato kapalıysa). Diğerleri kullanıcıya kalır."""
    pl = plan(lib)
    if not any(x.get("confidence") == "kesin" for x in pl["items"]) and not \
            [f for f in pl["folders"] if f["sure"] and not os.path.isdir(lib.rootinfo.os_path(f["_old"]))]:
        return None
    return apply(lib, auto=True, pl=pl)
