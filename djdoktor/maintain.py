"""Otomatik bakım: Engine kütüphanesini klasör düzeniyle uyumlu tutar.

Kullanıcı hiçbir şey sürüklemez; program şunları kendisi yapar:
  1. Yol onarımı: Engine'de yanlış yazılmış yollar (Mac'e özel harf biçimi, ':' vb.) diskteki
     gerçek yola çevrilir -> Prime 4'te "dosya bulunamadı" kalmaz.
     Program dışında taşınmış/yeniden adlandırılmış dosyalar ses imzasıyla bulunup bağlanır.
  2. Otomatik ekleme: tür klasörlerindeki (Müzik/Halay …) her şarkı Engine koleksiyonunda
     TAM BİR KEZ bulunur. Engine'de zaten varsa tekrar eklenmez.
  3. "Analiz bekleyenler" listesi: Engine'de henüz analiz edilmemiş parçalar. Engine DJ'de bu listeyi
     seçip analiz ettirince parçalar listeden kendiliğinden düşer.
  4. "Türler" klasörü: her tür için bir liste (Prime 4'te türe göre gezinmek için).

Programın tuttuğu bu listeler (Analiz bekleyenler, Türler) elle düzenlenmez; her bakımda yeniden
hesaplanır. Bakım bir kullanıcı işleminin parçası olarak çalışınca eklenen parçalar ve yol
değişiklikleri o işlemle birlikte geri alınabilir.
"""
from __future__ import annotations

import json
import threading

from . import engine, names, util

ANALYSIS_TITLE = "Analiz bekleyenler"
GENRES_TITLE = "Türler"
_bg_lock = threading.Lock()


def managed_meta(lib, uuid):
    raw = lib.catalog.get_meta("managed:" + str(uuid))
    try:
        return json.loads(raw) if raw else {}
    except ValueError:
        return {}


def set_managed_meta(lib, uuid, data):
    lib.catalog.set_meta("managed:" + str(uuid), json.dumps(data))


def managed_ids(lib, uuid=None, data=None):
    """Programın tuttuğu listelerin kimlikleri (kullanıcı bunları elle düzenlemez)."""
    if uuid is None:
        uuid = lib.db_uuid()
    m = managed_meta(lib, uuid)
    ids = set()
    if m.get("analysis"):
        ids.add(int(m["analysis"]))
    if m.get("genres_root"):
        ids.add(int(m["genres_root"]))
    for v in (m.get("genres") or {}).values():
        ids.add(int(v))
    if data is not None:
        present = {p["id"] for p in data["playlists"]}
        ids &= present
    return ids


def _sort_key(f):
    return (names.fold(f.get("artist") or ""), names.fold(f.get("title") or f.get("name") or ""))


def plan(lib, d, data, resolver=None, relink=True):
    """Bir veritabanı için yapılacak bakım işleri (salt hesap). relink=False: kayıp kayıtlar bağlanmaz
    (geri almadan sonra: geri alınan bağlama hemen yeniden yapılmasın)."""
    tracks, by_file, orphans, _ref_of, _tor = lib.engine_map(d, data, resolver)
    files = {f["id"]: f for f in lib.audio_files()}
    repairs, relinks, missing = [], [], 0
    for fid, rows in by_file.items():
        f = files.get(fid)
        if not f:
            continue
        for tid, m in rows:
            if m in ("unicode", "sfm", "case"):
                old = tracks[tid].get("path") or ""
                repairs.append((tid, old, engine.repath(old, None, f["rel"], d["lib_dir"], lib.root)))
    taken = set(by_file)
    # program dışında taşınan / adı değişen dosyalar: kayıp yol bağlama ile aynı eşleştirme, YALNIZCA 'kesin' olanlar
    # (geçmiş, ses imzası — Engine Library kopyaları ve karantina hariç —, ya da boyut / süresi tutan sade ad)
    lost = [(tid, rel) for tid, rel, m in orphans if m in ("missing", "nodir") and rel]
    found = {}
    held = set()
    if lost:
        from . import relink as RL
        refs = [{"key": tid, "rel": rel, "size": tracks[tid].get("fileBytes"), "dur": tracks[tid].get("length")}
                for tid, rel in lost]
        found = RL.match(lib, refs)
    for tid, rel in lost:
        x = found.get(tid) or {}
        fid = x.get("fid") if x.get("confidence") == "kesin" else None
        if fid and fid in files and fid not in taken:
            if relink:
                oldp = tracks[tid].get("path") or ""
                relinks.append((tid, oldp, engine.repath(oldp, None, files[fid]["rel"], d["lib_dir"], lib.root), fid))
            else:
                held.add(fid)        # bağlanmaz ama Engine'e YENİ kayıt olarak da eklenmez (iki kez olmasın)
                missing += 1
            taken.add(fid)
        else:
            missing += 1
    return {"tracks": tracks, "by_file": by_file, "files": files, "repairs": repairs, "relinks": relinks,
            "missing": missing, "held": held}


def run(lib, op=None, progress=None, relink=True):
    """Bakımı uygular. op verilirse eklenen parçalar ve yol değişiklikleri o işlemle geri alınabilir.
    Engine DJ açıksa hiçbir şey yazmaz ({'skipped': 'engine_open'})."""
    from . import dedupe
    out = {"repaired": 0, "relinked": 0, "added": 0, "pending": 0, "missing": 0, "lists": False}
    dbs = lib.engine_dbs()
    if not dbs:
        return out
    if lib.engine_open():
        out["skipped"] = "engine_open"
        return out
    with lib.lock:
        gens = [g for g in lib.genre_rows()]
        prefs = lib.prefs()
        sig = _sig(lib, dbs, gens, prefs)
        if sig == getattr(lib, "_maint_sig", None):
            out["unchanged"] = True       # son bakımdan beri ne Engine ne katalog değişti: yapılacak iş yok
            return out
        for d in dbs:
            try:
                engine.preflight(d["path"])
            except engine.EngineError as e:
                out.setdefault("errors", []).append(str(e))
                continue
            data = engine.read(d["path"])
            pl = plan(lib, d, data, relink=relink)
            drive = d["key"] == "drive"
            adds = []
            if drive and gens:
                place = lib.placer()
                gmap = {g["id"]: g for g in gens}
                dup = dedupe.dup_index(lib)
                relinked = {r[3] for r in pl["relinks"]} | pl["held"]
                for fid, f in pl["files"].items():
                    if fid in pl["by_file"] or fid in relinked:
                        continue
                    if f["rel"].startswith("_DJDoktor_/"):
                        continue
                    kind, gid = place(f["rel"])
                    if kind != "genre" or not gmap.get(gid, {}).get("engine", 1):
                        continue
                    fl = json.loads(f["flags"]) if f.get("flags") else []
                    if any(c in fl for c in ("audio_error", "audio_empty", "fmt_engine")):
                        continue
                    di = dup.get(fid)
                    if di and di["kind"] in ("exact", "audio") and not di["keeper"]:
                        continue  # önce çift birleştirilsin; Engine'de iki kez görünmesin
                    adds.append(f)
            want_lists = drive and bool(gens)
            stale = set()
            if drive and not gens:
                stale = managed_ids(lib, data["uuid"], data)   # düzen geri alındı: programın listeleri kalkar
            if not (pl["repairs"] or pl["relinks"] or adds or want_lists or stale):
                out["missing"] += pl["missing"]
                continue
            w = engine.Writer(d["path"], d["lib_dir"], lib.root)
            try:
                for tid, old, new in pl["repairs"]:
                    if w.track_set_path(tid, new, expect=old) == "ok":
                        out["repaired"] += 1
                for tid, old, new, _fid in pl["relinks"]:
                    if w.track_set_path(tid, new, expect=old) == "ok":
                        out["relinked"] += 1
                for f in sorted(adds, key=lambda x: x["rel"]):
                    w.track_add(f, engine.rel_to_engine_path(f["rel"], d["lib_dir"], lib.root))
                    out["added"] += 1
                n_rec = len(w.steps)
                if want_lists:
                    out["pending"] = _managed_lists(lib, w, gens, prefs)
                    out["lists"] = True
                elif stale:
                    for pid in sorted(stale, key=lambda x: -len(w.descendants(x)) if w.pl(x) else 0):
                        if w.pl(pid):
                            w.pl_delete_tree(pid, record=False)
                    set_managed_meta(lib, data["uuid"], {})
                    out["lists"] = True
                del w.steps[n_rec:]          # programın listeleri geri alma kaydına girmez
                w.commit()
            except Exception:
                w.rollback()
                raise
            if op is not None:
                op.add_engine(w, d["key"])
            out["missing"] += pl["missing"]
        if out["repaired"] or out["relinked"] or out["added"] or out["lists"]:
            lib.catalog.set_meta("last_maint", util.now())
        lib._maint_sig = None if (out.get("errors") or not relink) else _sig(lib, dbs, gens, prefs)
        return out


def _sig(lib, dbs, gens, prefs):
    """Bakımın girdilerinin imzası: Engine veritabanları, katalog, türler ve ilgili ayarlar."""
    return (tuple((d["path"], engine.db_stamp(d["path"])) for d in dbs), lib.data_key(),
            tuple((g["id"], g["rel"], g.get("engine", 1)) for g in gens), bool(prefs.get("genre_lists", True)))


def _managed_lists(lib, w, gens, prefs):
    """Analiz bekleyenler + Türler listelerini veritabanının şu anki hâline göre yazar."""
    uuid = w.uuid
    meta = managed_meta(lib, uuid)
    cur = w.con.execute("SELECT id, path, title, artist, isAnalyzed, originDatabaseUuid, originTrackId FROM Track")
    rows = [dict(r) for r in cur]
    # parça -> dosya -> tür
    from .resolver import Resolver
    resolver = Resolver(lib.catalog, lib.root)
    place = lib.placer()
    order = {g["id"]: i for i, g in enumerate(gens)}
    pending, by_genre = [], {g["id"]: [] for g in gens if g.get("engine", 1)}
    for t in rows:
        rel = engine.path_to_rel(t["path"] or "", w.lib_dir, lib.root)
        if rel is None:
            continue
        f, m = resolver.resolve(rel)
        if not f or m not in ("exact", "case", "unicode", "sfm") or not f["present"]:
            continue
        kind, gid = place(f["rel"])
        ref = (t["originDatabaseUuid"], t["originTrackId"])
        info = {"ref": ref, "artist": t["artist"] or "", "title": t["title"] or "", "name": f["rel"],
                "g": order.get(gid, 999) if kind == "genre" else 999}
        if not t["isAnalyzed"]:
            pending.append(info)
        if kind == "genre" and gid in by_genre:
            by_genre[gid].append(info)
    pending.sort(key=lambda x: (x["g"],) + _sort_key(x))
    # 1) Analiz bekleyenler (en üstte)
    aid = meta.get("analysis")
    if aid and not w.pl(int(aid)):
        aid = None
    if not aid and pending:
        top = w.children(0)
        aid = w.pl_create(0, ANALYSIS_TITLE, before=top[0] if top else 0, record=False)
    if aid:
        w.pl_set_refs(int(aid), [x["ref"] for x in pending], record=False)
    meta["analysis"] = int(aid) if aid else None
    # 2) Türler klasörü
    if prefs.get("genre_lists", True):
        rid = meta.get("genres_root")
        if rid and not w.pl(int(rid)):
            rid = None
        if not rid:
            rid = w.pl_create(0, GENRES_TITLE, record=False)
        rid = int(rid)
        known = {int(k): int(v) for k, v in (meta.get("genres") or {}).items()}
        new_known = {}
        for g in [g for g in gens if g.get("engine", 1)]:
            pid = known.get(g["id"])
            if pid and (not w.pl(pid) or w.pl(pid)["parentListId"] != rid):
                pid = None
            if not pid:
                pid = w.find_child(rid, g["name"]) or w.pl_create(rid, g["name"], record=False)
            elif w.pl(pid)["title"] != g["name"]:
                w.pl_rename(pid, g["name"], record=False)
            items = sorted(by_genre.get(g["id"], []), key=_sort_key)
            w.pl_set_refs(pid, [x["ref"] for x in items], record=False)
            new_known[g["id"]] = pid
        # sıra: türlerin sırası
        kids = w.children(rid)
        want = [new_known[g["id"]] for g in gens if g["id"] in new_known]
        if [k for k in kids if k in set(want)] != want:
            for pid in reversed(want):
                first = w.children(rid)
                if first and first[0] != pid:
                    w.pl_move(pid, rid, first[0], record=False)
        # artık tür olmayan listeler
        for gid, pid in known.items():
            if gid not in new_known and w.pl(pid) and w.pl(pid)["parentListId"] == rid:
                w.pl_delete_tree(pid, record=False)
        meta["genres_root"] = rid
        meta["genres"] = {str(k): v for k, v in new_known.items()}
    else:
        rid = meta.get("genres_root")
        if rid and w.pl(int(rid)):
            w.pl_delete_tree(int(rid), record=False)
        meta["genres_root"] = None
        meta["genres"] = {}
    set_managed_meta(lib, uuid, meta)
    return len(pending)


def after_change(lib, op=None, relink=True):
    """Bir değişiklikten sonra sessiz bakım. Hata olursa işlemi bozmaz, günlüğe yazar."""
    try:
        return run(lib, op=op, relink=relink)
    except Exception as e:  # bakım asla kullanıcının işlemini düşürmesin
        try:
            lib.catalog.set_meta("last_maint_error", "%s: %s" % (util.stamp(), e))
        except Exception:
            pass
        return {"error": str(e)}


def background(lib):
    """Arka planda (ör. tarama sonrası, Engine DJ kapanınca) tek seferlik bakım. Program dışında adı / yeri değişen
    dosyaların Engine ve Serato kayıtları önce bağlanır (yalnızca kesin eşleşmeler; tek 'Geri al' adımı)."""
    if not _bg_lock.acquire(blocking=False):
        return None
    try:
        linked = None
        try:
            from . import relink as RL
            linked = RL.auto(lib)
        except Exception as e:  # bağlama hiçbir zaman bakımı düşürmesin
            try:
                lib.catalog.set_meta("last_relink_error", "%s: %s" % (util.stamp(), e))
            except Exception:
                pass
        r = after_change(lib)
        if linked and isinstance(r, dict):
            r["relinked"] = r.get("relinked", 0) + linked.get("engine", 0) + linked.get("serato", 0)
            r["auto_linked"] = {k: linked.get(k) for k in ("engine", "serato", "folders", "journal")}
        return r
    finally:
        _bg_lock.release()


def status(lib):
    """Arayüz için: analiz bekleyen sayısı, Engine'de kayıp parça sayısı vb."""
    st = lib.engine_state()
    pend = sum(1 for t in st["tracks"].values() if not t.get("isAnalyzed"))
    miss = len([o for o in st["orphans"] if o[2] in ("missing", "nodir")])
    return {"pending": pend, "missing": miss, "tracks": len(st["tracks"]),
            "last": lib.catalog.get_meta("last_maint"), "error": lib.catalog.get_meta("last_maint_error")}

