"""Serato aynası: bir Engine listesini Serato'da crate olarak da tutar (iki yönlü).

  * Listede "Serato'da da olsun" açıksa program aynı adlı crate'i yazar ve liste her değiştiğinde
    crate'i kendiliğinden günceller.
  * Crate Serato'da değiştirilirse (Mac'te Serato kapandıktan sonra) değişiklik Engine listesine alınır.
  * İki tarafta da değiştiyse kullanıcıya sorulur.
  * Serato açıkken crate'lere yazılmaz (Serato kapanırken üzerine yazabilir); kapanınca yazılır.
  * "Serato'dan al": mevcut bir crate'ten yeni Engine listesi oluşturur.
"""
from __future__ import annotations

import base64
import json
import os
import threading

from . import engine, journal, names, serato, util
from .resolver import Resolver

_lock = threading.Lock()


def _err(msg, code=None):
    from .library import UserError
    return UserError(msg, code)


def _sub(sdir):
    return serato._subcrates_dir(sdir)


def crate_stem(path_titles):
    return "%%".join(serato.safe_crate_part(t) for t in path_titles)


def _crate_rel(stem):
    return "Subcrates/" + stem + ".crate"


def _dialect(lib):
    pref = lib.prefs().get("serato_dialect", "auto")
    if pref in ("mac", "windows"):
        return pref
    try:
        info = json.loads(lib.catalog.get_meta("serato_info") or "{}")
        return info.get("dialect") or ("mac" if util.IS_MAC else "windows")
    except ValueError:
        return "mac" if util.IS_MAC else "windows"


def _db_paths(sdir):
    db = serato.read_database(sdir) or {"tracks": []}
    out = {}
    for t in db["tracks"]:
        if t.get("pfil"):
            out.setdefault(names.match_key(t["pfil"]), t["pfil"])
    return out


def _refs_now(lib, st, pid):
    return next((x for x in st["playlists"] if x["id"] == pid), None)


def _paths_for(lib, st, p, db_paths, dialect):
    out = []
    for tid in p["entries"]:
        fid = st["fid_of_tid"].get(tid) if tid else None
        if not fid:
            continue
        f = lib.catalog.file(fid)
        if f and f["present"]:
            out.append(serato.path_for(f["rel"], dialect, db_paths))
    return out


def _write(lib, sdir, stem, paths, op=None):
    """Crate'i yazar; önceki hâlini geri alma için kaydeder. Dönüş: yeni özet (hash)."""
    p = os.path.join(_sub(sdir), stem + ".crate")
    prev = None
    cols = None
    if os.path.isfile(p):
        with open(p, "rb") as fh:
            prev = fh.read()
        try:
            _t, cols = serato.read_crate_file(p)
        except Exception:
            cols = None
    data = serato.build_crate(paths, cols or None)
    if prev == data:
        return serato.file_hash(p)
    util.atomic_write_bytes(p, data)
    h = serato.file_hash(p)
    if op is not None:
        op.add({"k": "crate", "name": _crate_rel(stem), "prev": base64.b64encode(prev).decode() if prev is not None else None,
                "after": h})
    return h


def _remove(lib, sdir, stem, op=None):
    p = os.path.join(_sub(sdir), stem + ".crate")
    if not os.path.isfile(p):
        return
    with open(p, "rb") as fh:
        prev = fh.read()
    qd = lib.quarantine("serato_crate")
    util.move_file(p, os.path.join(qd, os.path.basename(p)))
    if op is not None:
        op.add({"k": "crate", "name": _crate_rel(stem), "prev": base64.b64encode(prev).decode(), "after": None})


def _ensure_parents(lib, sdir, path_titles, op):
    """Alt crate için üst crate dosyaları da olsun (Serato ağacı doğru göstersin)."""
    for i in range(1, len(path_titles)):
        stem = crate_stem(path_titles[:i])
        p = os.path.join(_sub(sdir), stem + ".crate")
        if not os.path.isfile(p):
            _write(lib, sdir, stem, [], op)


# ---------------------------------------------------------------------------
def link(lib, pid, on=True):
    """Listeyi (ve alt listelerini) Serato'da da tut / tutma."""
    sdir = lib.serato_dir()
    if not sdir:
        raise _err("Bu SSD'de Serato kütüphanesi (_Serato_ klasörü) yok.", "no_serato")
    st = lib.engine_state()
    uuid = st["uuid"]
    cat = lib.catalog
    pid = int(pid)
    p = _refs_now(lib, st, pid)
    if not p:
        raise _err("Liste bulunamadı.")
    ids = [pid] + _descendants(st, pid)
    links = cat.serato_links(uuid)
    op = journal.Op(lib, "serato", ("Serato'da da göster: %s" if on else "Serato'dan kaldır: %s") % p["title"])
    with lib.lock:
        serato_open = lib.serato_open(fresh=True)
        for i in ids:
            old = links.get(i)
            op.add({"k": "serlink", "db": uuid, "pid": i, "old": _link_dict(old)})
            if on:
                cat.set_serato_link(uuid, i, old["crate"] if old else None, old["last_hash"] if old else None,
                                    old["last_refs"] if old else None, 1)
            else:
                if old and old.get("crate") and not serato_open:
                    _remove(lib, sdir, old["crate"], op)
                cat.del_serato_link(uuid, i)
        res = {"ok": True}
        if on:
            res = sync(lib, op=op, only=set(ids))
        op.commit()
        return res


def _free_stem(sdir, stem, own=None):
    """Serato'da aynı adda BAŞKA bir crate varsa onu ezmemek için ' (Engine)' ekler."""
    cand, k = stem, 1
    while os.path.isfile(os.path.join(_sub(sdir), cand + ".crate")) and cand != own:
        cand = "%s (Engine%s)" % (stem, "" if k == 1 else " %d" % k)
        k += 1
    return cand


def _last(refs, path):
    return {"refs": ["%s:%s" % tuple(x) for x in refs], "path": list(path)}


def _path_of(w, pid):
    parts, guard = [], 0
    while pid and guard < 60:
        p = w.pl(pid)
        if not p:
            break
        parts.append(p["title"])
        pid = p["parentListId"]
        guard += 1
    return list(reversed(parts))


def _link_dict(r):
    if not r:
        return None
    return {"crate": r.get("crate"), "last_hash": r.get("last_hash"), "last_refs": r.get("last_refs"),
            "dirty": r.get("dirty", 0)}


def _descendants(st, pid):
    by_parent = {}
    for p in st["playlists"]:
        by_parent.setdefault(p["parent"], []).append(p["id"])
    out, stack = [], [pid]
    while stack:
        c = stack.pop()
        for k in by_parent.get(c, []):
            out.append(k)
            stack.append(k)
    return out


def after_engine_change(lib, changed_pids, op, uuid=None):
    """Engine'de liste değişti: bağlı crate'leri güncelle (Serato kapalıysa hemen, açıksa sonra)."""
    if uuid is not None and not lib.catalog.serato_links(uuid):
        return None          # Serato'ya bağlı liste yok: Engine'i yeniden okumaya gerek yok
    sdir = lib.serato_dir()
    st = lib.engine_state(force=True)
    if not st["db"]:
        return None
    links = lib.catalog.serato_links(st["uuid"])
    if not links:
        return None
    # silinen listelerin crate'leri, alt listesi değişen klasörler
    affected = set()
    present = {p["id"] for p in st["playlists"]}
    for pid in links:
        if pid in changed_pids or pid not in present:
            affected.add(pid)
    if not affected:
        return None
    if not sdir or lib.serato_open():
        for pid in affected:
            r = links[pid]
            lib.catalog.set_serato_link(st["uuid"], pid, r["crate"], r["last_hash"], r["last_refs"], 1)
        return {"deferred": len(affected)}
    return sync(lib, op=op, only=affected, st=st)


def state(lib, st=None):
    """Her bağ için durum: ok | push (Engine değişti) | pull (Serato değişti) | conflict | gone."""
    sdir = lib.serato_dir()
    st = st or lib.engine_state()
    out = {}
    if not st["db"] or not sdir:
        return out
    links = lib.catalog.serato_links(st["uuid"])
    by_id = {p["id"]: p for p in st["playlists"]}
    for pid, r in links.items():
        p = by_id.get(pid)
        if not p:
            out[pid] = "gone"
            continue
        refs = ["%s:%s" % tuple(x) for x in p["refs"]]
        last = r.get("last_refs") or {}
        cur_hash = None
        if r.get("crate"):
            cp = os.path.join(_sub(sdir), r["crate"] + ".crate")
            cur_hash = serato.file_hash(cp) if os.path.isfile(cp) else "missing"
        eng_changed = (not last or not r.get("crate") or refs != last.get("refs") or
                       list(p["path"]) != list(last.get("path") or []))
        ser_changed = bool(r.get("crate")) and cur_hash != r.get("last_hash")
        if ser_changed and cur_hash == "missing":
            out[pid] = "push"
        elif eng_changed and ser_changed:
            out[pid] = "conflict"
        elif ser_changed:
            out[pid] = "pull"
        elif eng_changed or r.get("dirty"):
            out[pid] = "push"
        else:
            out[pid] = "ok"
    return out


def sync(lib, op=None, only=None, st=None, prefer=None):
    """Bağlı listeleri eşitler. prefer: {pid: 'engine'|'serato'} (çakışma çözümü)."""
    sdir = lib.serato_dir()
    if not sdir:
        return {"skipped": "no_serato"}
    if lib.serato_open(fresh=True):          # yazmadan hemen önce taze denetim
        return {"skipped": "serato_open"}
    with _lock:
        st = st or lib.engine_state(force=True)
        uuid = st["uuid"]
        cat = lib.catalog
        links = cat.serato_links(uuid)
        states = state(lib, st)
        by_id = {p["id"]: p for p in st["playlists"]}
        db_paths = _db_paths(sdir)
        dialect = _dialect(lib)
        res = {"pushed": 0, "pulled": 0, "removed": 0, "conflicts": []}
        pulls = []
        for pid, s in sorted(states.items(), key=lambda kv: (by_id.get(kv[0]) or {}).get("depth", 0)):
            if only is not None and pid not in only:
                continue
            r = links[pid]
            choice = (prefer or {}).get(pid)
            if s == "gone":
                if r.get("crate"):
                    _remove(lib, sdir, r["crate"], op)
                    res["removed"] += 1
                if op is not None:
                    op.add({"k": "serlink", "db": uuid, "pid": pid, "old": _link_dict(r)})
                cat.del_serato_link(uuid, pid)
                continue
            if s == "conflict" and not choice:
                res["conflicts"].append(pid)
                continue
            if s == "pull" or (s == "conflict" and choice == "serato"):
                pulls.append(pid)
                continue
            if s in ("push",) or (s == "conflict" and choice == "engine") or r.get("dirty"):
                p = by_id[pid]
                last = r.get("last_refs") or {}
                if r.get("crate") and list(p["path"]) == list(last.get("path") or []):
                    stem = r["crate"]                 # ad değişmedi: crate'in adı aynen kalır
                else:
                    stem = _free_stem(sdir, crate_stem(p["path"]), r.get("crate"))  # yeni bağ / ad değişti
                    _ensure_parents(lib, sdir, p["path"], op)
                h = _write(lib, sdir, stem, _paths_for(lib, st, p, db_paths, dialect), op)
                if r.get("crate") and r["crate"] != stem:
                    _remove(lib, sdir, r["crate"], op)
                if op is not None:
                    op.add({"k": "serlink", "db": uuid, "pid": pid, "old": _link_dict(r)})
                cat.set_serato_link(uuid, pid, stem, h, _last(p["refs"], p["path"]), 0)
                res["pushed"] += 1
        if pulls:
            res["pulled"] = _pull(lib, pulls, op)
        lib.analyze_serato()
        return res


def _pull(lib, pids, op):
    """Serato'da değişen crate'leri Engine listelerine alır."""
    from . import lists
    sdir = lib.serato_dir()
    if lib.engine_open(fresh=True):            # Engine listelerine yazmadan hemen önce taze denetim
        return 0
    st = lib.engine_state(force=True)
    uuid = st["uuid"]
    cat = lib.catalog
    links = cat.serato_links(uuid)
    resolver = Resolver(cat, lib.root)
    d = lib.engine_db()
    own = op is None
    op = op or journal.Op(lib, "serato", "Serato'daki değişiklik Engine'e alındı")
    w = engine.Writer(d["path"], d["lib_dir"], lib.root)
    n = 0
    try:
        for pid in pids:
            r = links.get(pid)
            if not r or not r.get("crate") or not w.pl(pid):
                continue
            cp = os.path.join(_sub(sdir), r["crate"] + ".crate")
            if not os.path.isfile(cp):
                continue
            paths, _cols = serato.read_crate_file(cp)
            fids = []
            for raw in paths:
                f, m = resolver.resolve(raw)
                if f and f["present"] and m in ("exact", "case", "unicode", "sfm"):
                    fids.append(f["id"])
            refs, _sk = lists.refs_for_files(lib, w, fids, d)
            seen, clean = set(), []
            for x in refs:
                if x not in seen:
                    seen.add(x)
                    clean.append(x)
            w.pl_set_refs(pid, clean)
            op.add({"k": "serlink", "db": uuid, "pid": pid, "old": _link_dict(r)})
            cat.set_serato_link(uuid, pid, r["crate"], serato.file_hash(cp), _last(clean, _path_of(w, pid)), 0)
            n += 1
        w.commit()
    except Exception:
        w.rollback()
        raise
    op.add_engine(w, "drive")
    if own:
        op.commit()
    return n


def crates(lib):
    """Serato crate ağacı (Engine'e almak için)."""
    sdir = lib.serato_dir()
    if not sdir:
        return []
    st = lib.engine_state()
    linked = {r["crate"] for r in lib.catalog.serato_links(st["uuid"]).values() if r.get("crate")} if st["db"] else set()
    out = []
    for c in serato.read_crates(sdir):
        out.append({"name": c["name"], "parts": c["parts"], "count": len(c["tracks"]), "linked": c["name"] in linked})
    out.sort(key=lambda c: [names.fold(x) for x in c["parts"]])
    return out


def import_crates(lib, names_, parent=0, keep_link=True):
    """Serato crate'lerinden Engine listeleri oluşturur (hiyerarşi korunur)."""
    from . import lists
    sdir = lib.serato_dir()
    if not sdir:
        raise _err("Serato kütüphanesi yok.", "no_serato")
    want = set(names_)
    allc = {c["name"]: c for c in serato.read_crates(sdir)}
    sel = [allc[n] for n in sorted(want) if n in allc]
    if not sel:
        raise _err("Crate seçilmedi.")
    resolver = Resolver(lib.catalog, lib.root)
    made, created_ids = 0, {}
    with lists.Edit(lib, "Serato'dan alındı: %d crate" % len(sel), kind="serato") as e:
        for c in sorted(sel, key=lambda c: len(c["parts"])):
            parts = c["parts"]
            # üst crate'ler de seçildiyse altına, değilse doğrudan hedefe
            par = int(parent or 0)
            for i in range(len(parts) - 1, 0, -1):
                key = "%%".join(parts[:i])
                if key in created_ids:
                    par = created_ids[key]
                    break
            title = parts[-1] if par != int(parent or 0) or len(parts) == 1 else " - ".join(parts)
            pid = e.w.pl_create(par, title)
            created_ids[c["name"]] = pid
            fids = []
            for raw in c["tracks"]:
                f, m = resolver.resolve(raw)
                if f and f["present"] and m in ("exact", "case", "unicode", "sfm"):
                    fids.append(f["id"])
            refs, _sk = lists.refs_for_files(lib, e.w, fids, e.d)
            seen, clean = set(), []
            for x in refs:
                if x not in seen:
                    seen.add(x)
                    clean.append(x)
            if clean:
                e.w.pl_set_refs(pid, clean)
            made += 1
    if keep_link:
        st = lib.engine_state(force=True)
        uuid = st["uuid"]
        by_id = {p["id"]: p for p in st["playlists"]}
        for cname, pid in created_ids.items():
            p = by_id.get(pid)
            cp = os.path.join(_sub(sdir), cname + ".crate")
            if p and os.path.isfile(cp):
                # aynı crate'e bağla: Engine yolu crate adından farklıysa ilk eşitlemede yeni ada yazılır
                lib.catalog.set_serato_link(uuid, pid, cname, serato.file_hash(cp), _last(p["refs"], p["path"]), 0)
    return {"lists": made, "ids": list(created_ids.values())}


def background(lib):
    """Arka plan: Serato kapalıyken bekleyen yazmaları yap, Serato'da değişenleri Engine'e al."""
    try:
        if not lib.serato_dir() or lib.serato_open():
            return None
        st = lib.engine_state()
        if not st["db"] or not lib.catalog.serato_links(st["uuid"]):
            return None
        s = state(lib, st)
        if not any(v in ("push", "pull", "gone") for v in s.values()):
            return None
        sdir = lib.serato_dir()
        serato.backup(sdir, lib.backup_dir("serato"), "otomatik")
        return sync(lib, op=None, st=st)
    except Exception as e:
        return {"error": str(e)}
