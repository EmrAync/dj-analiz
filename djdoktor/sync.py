"""Engine DJ ve Serato ile senkron, Engine yol onarımı, içe aktarma."""
from __future__ import annotations

import json
import os
from collections import defaultdict

from . import engine, names, serato, util
from .resolver import Resolver, WORKS_ON
from .service import UserError


# ---------------------------------------------------------------------------
# Yardımcılar
# ---------------------------------------------------------------------------
def _db(lib, key):
    for d in engine.find_dbs(lib.root):
        if d["key"] == key:
            return d
    raise UserError("Engine kütüphanesi bulunamadı. Diskte 'Engine Library' klasörü olmalı "
                    "(Engine DJ ile diski bir kez açınca oluşur).")


def _engine_track_map(lib, db):
    """file_id -> [(track_row, match)] (önce tam eşleşenler)."""
    data = engine.read(db["path"])
    resolver = Resolver(lib.catalog, lib.root)
    out = defaultdict(list)
    for t in data["tracks"]:
        rel = engine.path_to_rel(t.get("path") or "", db["lib_dir"], lib.root)
        if rel is None:
            continue
        f, m = resolver.resolve(rel)
        if f is not None and m != "missing":
            out[f["id"]].append((t, m))
    for k in out:
        out[k].sort(key=lambda x: 0 if x[1] == "exact" else 1)
    return out, data


# ---------------------------------------------------------------------------
# Engine durumu ve onarım
# ---------------------------------------------------------------------------
def engine_status(lib):
    cat = lib.catalog
    res = []
    for db in engine.find_dbs(lib.root):
        src = "engine:" + db["key"]
        info = json.loads(cat.get_meta(src + "_info") or "{}")
        counts = defaultdict(int)
        samples = defaultdict(list)
        unanalyzed = 0
        for r in cat.q("SELECT ext_id, raw_path, file_id, match, info FROM ext_tracks WHERE src=?", (src,)):
            counts[r["match"]] += 1
            inf = json.loads(r["info"] or "{}")
            if not inf.get("analyzed"):
                unanalyzed += 1
            if len(samples[r["match"]]) < 400:
                samples[r["match"]].append({"id": r["ext_id"], "path": names.display(r["raw_path"] or ""),
                                            "title": inf.get("title") or "", "file_id": r["file_id"]})
        pls = cat.q("SELECT list_key, title, path, count FROM ext_lists WHERE src=? ORDER BY pos", (src,))
        red_by_pl = defaultdict(int)
        for r in cat.q("SELECT list_key, match FROM ext_items WHERE src=?", (src,)):
            if r["match"] not in ("exact", "case"):
                red_by_pl[r["list_key"]] += 1
        for p in pls:
            p["red"] = red_by_pl.get(p["list_key"], 0)
        res.append({"key": db["key"], "label": db["label"], "path": db["path"], "info": info,
                    "counts": dict(counts), "samples": dict(samples), "unanalyzed": unanalyzed,
                    "playlists": pls, "works_on": WORKS_ON,
                    "last_sync": cat.get_meta("engine_last_sync_" + db["key"])})
    return res


def engine_repair_plan(lib, key="drive"):
    db = _db(lib, key)
    if not db.get("in_root"):
        raise UserError("Yol onarımı yalnızca bu diskteki Engine kütüphanesi için yapılabilir.")
    data = engine.read(db["path"])
    resolver = Resolver(lib.catalog, lib.root)
    fixes, unfixable, used = [], defaultdict(int), {t.get("path") for t in data["tracks"]}
    targets = defaultdict(list)
    for t in data["tracks"]:
        p = t.get("path") or ""
        rel = engine.path_to_rel(p, db["lib_dir"], lib.root)
        if rel is None:
            unfixable["outside"] += 1
            continue
        f, m = resolver.resolve(rel)
        if m in ("exact",):
            continue
        if m in ("unicode", "sfm", "case") and f is not None:
            new = engine.rel_to_engine_path(f["rel"], db["lib_dir"], lib.root)
            if new == p:
                continue
            targets[new].append(t["id"])
            fixes.append({"track_id": t["id"], "old": p, "new": new, "match": m,
                          "old_disp": names.display(p), "new_disp": names.display(new),
                          "title": t.get("title") or ""})
        else:
            unfixable[m] += 1
    conflicts = []
    ok = []
    for fx in fixes:
        if fx["new"] in used or len(targets[fx["new"]]) > 1:
            fx["conflict"] = True
            conflicts.append(fx)
        else:
            ok.append(fx)
    return {"db": db["path"], "fixes": ok, "conflicts": conflicts, "unfixable": dict(unfixable),
            "by_class": {c: sum(1 for f in ok if f["match"] == c) for c in ("unicode", "sfm", "case")}}


def engine_repair_apply(lib, key="drive", progress=None):
    lib.require_writable("Engine yol onarımı")
    plan = engine_repair_plan(lib, key)
    if not plan["fixes"]:
        return {"fixed": 0, "message": "Onarılacak yol yok."}
    db = _db(lib, key)
    try:
        engine.preflight(db["path"])
    except engine.EngineError as e:
        raise UserError(str(e))
    if progress:
        progress(0.1, "Engine veritabanı yedekleniyor…")
    bk = engine.backup(db["path"], lib.settings.backup_dir(lib.id, "engine"), "yol_onarimi")
    if progress:
        progress(0.4, "Yollar düzeltiliyor…")
    try:
        w = engine.Writer(db["path"], db["lib_dir"], lib.root)
    except engine.EngineError as e:
        raise UserError(str(e))
    changes = []
    try:
        for fx in plan["fixes"]:
            r = w.fix_path(fx["track_id"], fx["old"], fx["new"])
            if r == "ok":
                changes.append({"id": fx["track_id"], "old": fx["old"], "new": fx["new"]})
        stats = w.commit()
    except Exception:
        w.rollback()
        raise
    jid = lib.catalog.journal_add("engine_onarim", "Engine yol onarımı: %d parça" % len(changes),
                                  {"type": "engine_repair", "db": db["path"], "backup": bk, "changes": changes})
    if progress:
        progress(0.85, "Analiz yenileniyor…")
    lib.reanalyze()
    return {"fixed": len(changes), "backup": bk, "journal": jid, "conflicts": len(plan["conflicts"]), "stats": stats}


# ---------------------------------------------------------------------------
# Engine'e liste gönderme
# ---------------------------------------------------------------------------
def _flag(lst, key):
    return bool((lst.get("info") or {}).get(key))


def build_spec(lib, flag_key):
    """İşaretli listelerden ağaç: [{list_id, title, kind, files:[ids], children:[...]}]"""
    cat = lib.catalog
    allrows = cat.lists_all()
    by_parent = defaultdict(list)
    for r in allrows:
        by_parent[r["parent_id"]].append(r)
    numbered = lib.prefs().get("number_sections", True)

    def node(r, inherited=False):
        kind = r["kind"]
        title = r["title"]
        if kind == "event":
            d = (r.get("info") or {}).get("date")
            if d:
                title = "%s %s" % (d, title)
        n = {"list_id": r["id"], "title": title, "kind": kind, "files": cat.item_file_ids(r["id"]), "children": []}
        kids = sorted(by_parent.get(r["id"], []), key=lambda x: (x["pos"], x["id"]))
        for i, ch in enumerate(kids):
            c = node(ch, True)
            if kind == "event" and numbered:
                c["title"] = "%02d %s" % (i + 1, c["title"])
            n["children"].append(c)
        return n

    spec = []

    def prune(n):
        """Boş bölüm/listeleri gönderme (Prime 4'te gereksiz kalabalık olmasın)."""
        n["children"] = [c for c in (prune(c) for c in n["children"]) if c is not None]
        if not n["files"] and not n["children"]:
            return None
        return n

    def walk(parent):
        for r in sorted(by_parent.get(parent, []), key=lambda x: (x["pos"], x["id"])):
            if _flag(r, flag_key):
                n = prune(node(r))
                if n is not None:
                    spec.append(n)
            else:
                walk(r["id"])
    walk(None)
    return spec


def _spec_files(spec):
    out = []
    for n in spec:
        out.extend(n["files"])
        out.extend(_spec_files(n["children"]))
    return out


def engine_sync(lib, key="drive", progress=None):
    lib.require_writable("Engine'e liste gönderme")
    db = _db(lib, key)
    if not db.get("in_root"):
        raise UserError("Listeler yalnızca bu diskteki Engine kütüphanesine gönderilebilir.")
    spec = build_spec(lib, "sync_engine")
    try:
        engine.preflight(db["path"], need_write_schema=True)
    except engine.EngineError as e:
        raise UserError(str(e))
    cat = lib.catalog
    if progress:
        progress(0.05, "Engine kütüphanesi okunuyor…")
    tmap, data = _engine_track_map(lib, db)
    if progress:
        progress(0.15, "Yedek alınıyor…")
    bk = engine.backup(db["path"], lib.settings.backup_dir(lib.id, "engine"), "senkron")
    try:
        w = engine.Writer(db["path"], db["lib_dir"], lib.root)
    except engine.EngineError as e:
        raise UserError(str(e))
    skipped_missing = []
    fixed_paths = []
    try:
        folder_title = engine.clean_title(lib.prefs().get("engine_folder") or "DJ Doktor")
        # kök klasörümüz
        root_id = None
        sm = cat.sync_get("engine", key)
        known = {r["list_id"]: r for r in sm}
        if 0 in known:
            r = w.playlist_exists(int(known[0]["ext_id"]))
            if r and r["parentListId"] == 0:
                root_id = r["id"]
        if root_id is None:
            cand = w.find_child(0, folder_title)
            if cand and w.is_empty(cand):
                root_id = cand
            elif cand and 0 in known and str(cand) == known[0]["ext_id"]:
                root_id = cand
        if root_id is None:
            root_id = w.create_playlist(0, folder_title)
        cat.sync_set("engine", key, 0, root_id, folder_title)
        w.clear_children(root_id)
        resolved = {}
        file_rows = {}
        need = list(dict.fromkeys(_spec_files(spec)))
        total = max(1, len(need))
        for i, fid in enumerate(need):
            f = cat.file(fid)
            if not f or not f["present"]:
                skipped_missing.append(names.display(f["rel"]) if f else str(fid))
                continue
            file_rows[fid] = f
            epath = engine.rel_to_engine_path(f["rel"], db["lib_dir"], lib.root)
            row = w.track_for_path(epath)  # tam yolla kayıtlı parça varsa onu kullan
            if row is None:
                cands = tmap.get(fid, [])
                if cands:
                    t, m = cands[0]
                    if m != "exact":
                        r = w.fix_path(t["id"], t["path"], epath)
                        if r == "ok":
                            fixed_paths.append({"id": t["id"], "old": t["path"], "new": epath})
                    row = {"originDatabaseUuid": t["originDatabaseUuid"], "originTrackId": t["originTrackId"]}
                else:
                    row = w.add_track(f, epath)
            resolved[fid] = (row["originDatabaseUuid"], row["originTrackId"])
            if progress and i % 20 == 0:
                progress(0.2 + 0.5 * i / total, "Parçalar eşleştiriliyor (%d/%d)…" % (i, total))

        def make(nodes, parent):
            for n in nodes:
                pid = w.create_playlist(parent, n["title"])
                refs = [resolved[f] for f in n["files"] if f in resolved]
                if refs:
                    w.set_entries(pid, refs)
                cat.sync_set("engine", key, n["list_id"], pid, n["title"])
                make(n["children"], pid)
        if progress:
            progress(0.75, "Çalma listeleri yazılıyor…")
        make(spec, root_id)
        stats = w.commit()
    except Exception:
        w.rollback()
        raise
    # artık gönderilmeyen listelerin eşlemesini temizle
    live = {n for n in _spec_ids(spec)}
    for r in cat.sync_get("engine", key):
        if r["list_id"] != 0 and r["list_id"] not in live:
            cat.sync_delete("engine", key, r["list_id"])
    cat.set_meta("engine_last_sync_" + key, util.now())
    if progress:
        progress(0.85, "Kontrol özeti alınıyor…")
    jid = cat.journal_add("engine_senkron", "Engine'e %d liste gönderildi" % stats["playlists"],
                          {"type": "engine_sync", "db": db["path"], "backup": bk, "stats": stats,
                           "fixed_paths": fixed_paths, "skipped": skipped_missing,
                           "engine_fp": engine.fingerprint(db["path"])})
    if progress:
        progress(0.9, "Analiz yenileniyor…")
    lib.reanalyze()
    return {"stats": stats, "backup": bk, "journal": jid, "skipped": skipped_missing, "fixed_paths": len(fixed_paths),
            "folder": folder_title}


def _spec_ids(spec):
    for n in spec:
        yield n["list_id"]
        yield from _spec_ids(n["children"])


def engine_import(lib, key, playlist_ids, parent_id=None):
    db = _db(lib, key)
    data = engine.read(db["path"])
    resolver = Resolver(lib.catalog, lib.root)
    tmap = {}
    for t in data["tracks"]:
        rel = engine.path_to_rel(t.get("path") or "", db["lib_dir"], lib.root)
        f, m = resolver.resolve(rel) if rel else (None, "outside")
        tmap[t["id"]] = f["id"] if (f and m != "missing") else None
    want = {int(x) for x in playlist_ids}
    folder = lib.catalog.list_create(parent_id, "folder", "Engine'den aktarılanlar") if want else None
    made, missing = 0, 0
    for p in data["playlists"]:
        if p["id"] not in want:
            continue
        lid = lib.catalog.list_create(folder, "list", " / ".join(p["path"]), {}, source="engine:%s" % p["id"])
        fids = []
        for tid in p["entries"]:
            fid = tmap.get(tid)
            if fid:
                fids.append(fid)
            else:
                missing += 1
        lib.catalog.items_add(lid, fids)
        made += 1
    return {"lists": made, "missing": missing}


# ---------------------------------------------------------------------------
# Serato
# ---------------------------------------------------------------------------
def serato_status(lib):
    cat = lib.catalog
    info = json.loads(cat.get_meta("serato_info") or "{}")
    if not info:
        return None
    counts = defaultdict(int)
    for r in cat.q("SELECT match, COUNT(*) AS n FROM ext_tracks WHERE src='serato' GROUP BY match"):
        counts[r["match"]] = r["n"]
    icounts = defaultdict(int)
    missing_tops = defaultdict(int)
    for r in cat.q("SELECT match, raw_path FROM ext_items WHERE src='serato'"):
        icounts[r["match"]] += 1
        if r["match"] in ("nodir", "missing"):
            top = names.split_rel(r["raw_path"] or "")[:1]
            missing_tops[top[0] if top else "?"] += 1
    crates = cat.q("SELECT list_key, title, path, count FROM ext_lists WHERE src='serato' ORDER BY path")
    bad_by = defaultdict(lambda: defaultdict(int))
    for r in cat.q("SELECT list_key, match FROM ext_items WHERE src='serato'"):
        bad_by[r["list_key"]][r["match"]] += 1
    for c in crates:
        c["by"] = dict(bad_by.get(c["list_key"], {}))
    return {"info": info, "tracks": dict(counts), "items": dict(icounts),
            "missing_tops": sorted(missing_tops.items(), key=lambda x: -x[1]), "crates": crates,
            "works_on": WORKS_ON}


def serato_import(lib, crate_names, parent_id=None):
    sdir = serato.serato_dir(lib.root)
    if not sdir:
        raise UserError("Bu diskte _Serato_ klasörü yok.")
    crates = {c["name"]: c for c in serato.read_crates(sdir)}
    resolver = Resolver(lib.catalog, lib.root)
    folder = lib.catalog.list_create(parent_id, "folder", "Serato'dan aktarılanlar") if crate_names else None
    made = missing = 0
    for name in crate_names:
        c = crates.get(name)
        if not c:
            continue
        fids = []
        for p in c["tracks"]:
            f, m = resolver.resolve(p)
            if f and m not in ("missing", "nodir"):
                fids.append(f["id"])
            else:
                missing += 1
        lid = lib.catalog.list_create(folder, "list", " / ".join(c["parts"]), {}, source="serato:" + name)
        lib.catalog.items_add(lid, fids)
        made += 1
    return {"lists": made, "missing": missing}


def serato_export(lib, progress=None):
    lib.require_writable("Serato'ya crate yazma")
    sdir = serato.serato_dir(lib.root)
    if not sdir:
        raise UserError("Bu diskte _Serato_ klasörü yok. Serato'yu bu diskle en az bir kez açın.")
    running = util.process_running(serato.SERATO_PROCS)
    if running:
        raise UserError("Serato DJ açık. Serato kapanırken crate'lerin üzerine yazar; lütfen önce Serato'yu kapatın.")
    spec = build_spec(lib, "sync_serato")
    cat = lib.catalog
    if progress:
        progress(0.1, "Serato yedekleniyor…")
    bk = serato.backup(sdir, lib.settings.backup_dir(lib.id, "serato"), "crate_yazma")
    db = serato.read_database(sdir) or {"tracks": []}
    pref = lib.prefs().get("serato_dialect", "auto")
    dialect = serato.detect_dialect(db["tracks"]) if pref == "auto" else pref
    by_mkey = {}
    for t in db["tracks"]:
        p = t.get("pfil")
        if p:
            by_mkey.setdefault(names.match_key(p), p)
    parent = serato.safe_crate_part(lib.prefs().get("serato_parent") or "DJ Doktor")
    written = []

    def paths_for(fids):
        out = []
        for fid in fids:
            f = cat.file(fid)
            if f and f["present"]:
                out.append(serato.path_for(f["rel"], dialect, by_mkey))
        return out

    def all_files(n):
        res = list(n["files"])
        for c in n["children"]:
            res.extend(all_files(c))
        return list(dict.fromkeys(res))

    written.append(serato.write_crate(sdir, [parent], []))

    def make(nodes, prefix):
        for n in nodes:
            parts = prefix + [n["title"]]
            fids = all_files(n) if n["children"] else n["files"]
            written.append(serato.write_crate(sdir, parts, paths_for(fids)))
            cat.sync_set("serato", "crates", n["list_id"], os.path.basename(written[-1]), " / ".join(parts))
            make(n["children"], parts)
    if progress:
        progress(0.4, "Crate'ler yazılıyor…")
    make(spec, [parent])
    # bizim daha önce yazdığımız ama artık listede olmayan crate'leri karantinaya taşı
    # (aynı diskte kalır; silinmez)
    sub = os.path.join(sdir, "Subcrates")
    prefix_stem = parent + "%%"
    moved = []
    keep = {os.path.basename(p) for p in written}
    if os.path.isdir(sub):
        old = [n for n in os.listdir(sub) if n.startswith(prefix_stem) and n.endswith(".crate") and n not in keep]
        if old:
            qd = util.quarantine_dir(lib.root, "eski_serato_crateleri")
            for n in old:
                src = os.path.join(sub, n)
                moved.append({"src": src, "dst": serato.remove_crate_file(src, qd)})
    written_fp = {os.path.basename(p): serato.file_hash(p) for p in written if os.path.isfile(p)}
    live = set(_spec_ids(spec))
    for r in cat.sync_get("serato", "crates"):
        if r["list_id"] not in live:
            cat.sync_delete("serato", "crates", r["list_id"])
    jid = cat.journal_add("serato_yazma", "Serato'ya %d crate yazıldı" % len(written),
                          {"type": "serato_export", "sdir": sdir, "backup": bk, "written": written, "moved": moved,
                           "written_fp": written_fp, "dialect": dialect})
    cat.set_meta("serato_last_export", util.now())
    if progress:
        progress(0.9, "Analiz yenileniyor…")
    lib.reanalyze()
    return {"crates": len(written), "backup": bk, "journal": jid, "dialect": dialect, "moved_old": len(moved)}
