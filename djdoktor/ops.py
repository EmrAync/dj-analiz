"""Dosya işlemleri: karantina, güvenli ad düzeltme, çift birleştirme, yeni müzik ekleme, geri alma.

TEMEL KURAL: Bu program hiçbir dosyayı SİLMEZ.
  * "Kaldırılan" dosyalar diskteki '_DJDoktor_Karantina/<tarih>' klasörüne taşınır
    (aynı disk içinde taşıma anlıktır, kopyalama yapılmaz).
  * Her işlem günlüğe yazılır ve 'Geri al' ile eski hâline döndürülebilir.
  * Serato ve Engine dosyaları her işlemden önce yedeklenir.
"""
from __future__ import annotations

import json
import os
import shutil
from collections import defaultdict

from . import analysis, audiosig, engine, names, serato, util
from .resolver import Resolver
from .scanner import build_record
from .service import UserError

QDIR = util.QDIR


def _abs(lib, f):
    return lib.rootinfo.os_path(f["rel"], f.get("os_rel"))


def _qdir(lib, label):
    return util.quarantine_dir(lib.root, label)


def _move(src, dst):
    if os.path.exists(dst):
        base, ext = os.path.splitext(dst)
        k = 2
        while os.path.exists("%s (%d)%s" % (base, k, ext)):
            k += 1
        dst = "%s (%d)%s" % (base, k, ext)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    os.rename(src, dst)
    return dst


def _check_apps(need_serato, need_engine):
    msgs = []
    if need_serato and util.process_running(serato.SERATO_PROCS):
        msgs.append("Serato DJ açık")
    if need_engine and util.process_running(engine.ENGINE_PROCS):
        msgs.append("Engine DJ açık")
    if msgs:
        raise UserError(" ve ".join(msgs) + ". Lütfen kapatıp tekrar deneyin (açıkken yaptıkları değişiklikler bizimkinin üzerine yazılır).")


# ---------------------------------------------------------------------------
# Çöp dosyalar
# ---------------------------------------------------------------------------
def plan_junk(lib):
    rows = lib.catalog.q("SELECT id, rel, os_rel, size, kind FROM files WHERE kind IN ('appledouble','junk') AND present=1 ORDER BY rel")
    return {"files": [{"id": r["id"], "disp": names.display(r["rel"]), "size": r["size"], "kind": r["kind"]} for r in rows],
            "total_size": sum(r["size"] or 0 for r in rows)}


def apply_junk(lib, progress=None):
    lib.require_writable("Çöp dosyaları karantinaya taşıma")
    rows = lib.catalog.q("SELECT * FROM files WHERE kind IN ('appledouble','junk') AND present=1")
    if not rows:
        return {"moved": 0}
    q = _qdir(lib, "cop_dosyalar")
    moves, errors = [], []
    for i, f in enumerate(rows):
        src = _abs(lib, f)
        dst = names.long_path(names.join_os(q, f.get("os_rel") or f["rel"]))
        try:
            real = _move(src, dst)
            moves.append({"src": src, "dst": real, "file_id": f["id"], "origin": f.get("origin")})
            lib.catalog.update_file(f["id"], present=0, origin="quarantine")
        except OSError as e:
            errors.append("%s: %s" % (names.display(f["rel"]), e))
        if progress and i % 25 == 0:
            progress(0.1 + 0.8 * i / len(rows), "Taşınıyor (%d/%d)…" % (i, len(rows)))
    jid = lib.catalog.journal_add("karantina", "%d çöp dosya karantinaya taşındı" % len(moves),
                                  {"type": "move", "moves": moves, "qdir": q})
    analysis.compute(lib.catalog, lib.prefs())
    return {"moved": len(moves), "errors": errors, "qdir": q, "journal": jid}


# ---------------------------------------------------------------------------
# Güvenli ad düzeltme
# ---------------------------------------------------------------------------
RENAME_CODES = ("name_badchar", "name_trailing", "name_reserved", "name_nfd")


def plan_rename(lib, file_ids=None, include_emoji=False):
    cat = lib.catalog
    codes = RENAME_CODES + (("name_emoji",) if include_emoji else ())
    targets = []
    for f in cat.q("SELECT id, rel, os_rel, flags, kind FROM files WHERE present=1 AND flags IS NOT NULL"):
        fl = json.loads(f["flags"])
        if (file_ids is None and any(c in fl for c in codes)) or (file_ids is not None and f["id"] in file_ids):
            targets.append(f)
    comp_new = {}  # (parent_rel, old_name) -> new_name
    for f in targets:
        parts = names.split_rel(f["rel"])
        for i, p in enumerate(parts):
            is_file = i == len(parts) - 1
            probs = names.component_problems(p)
            bad = any(x in probs for x in ("sfm", "illegal", "control", "trailing", "reserved", "nfd")) or \
                (include_emoji and "emoji" in probs)
            if not bad:
                continue
            new = names.clean_component(p, is_file) if (include_emoji and "emoji" in probs) else names.minimal_fix_component(p, is_file)
            if is_file:
                new = os.path.splitext(new)[0] + os.path.splitext(p)[1]  # uzantı aynen kalsın
            if new != p:
                comp_new[("/".join(parts[:i]), p)] = new
    if not comp_new:
        return {"renames": [], "files": []}
    # çakışma kontrolü (aynı klasörde aynı ad, büyük/küçük harf duyarsız)
    siblings = defaultdict(set)
    for f in cat.q("SELECT rel FROM files"):
        parts = names.split_rel(f["rel"])
        for i in range(len(parts)):
            siblings["/".join(parts[:i])].add(parts[i].casefold())
    final = {}
    for (parent, old), new in sorted(comp_new.items()):
        taken = siblings[parent] - {old.casefold()}
        cand, k = new, 2
        stem, ext = os.path.splitext(new) if "." in new else (new, "")
        while cand.casefold() in taken:
            cand = "%s (%d)%s" % (stem, k, ext)
            k += 1
        siblings[parent].add(cand.casefold())
        final[(parent, old)] = cand
    # tüm dosyalar için yeni yol
    rel_map = {}
    for f in cat.q("SELECT rel FROM files"):
        parts = names.split_rel(f["rel"])
        new_parts, changed = [], False
        for i, p in enumerate(parts):
            key = ("/".join(parts[:i]), p)
            if key in final:
                new_parts.append(final[key])
                changed = True
            else:
                new_parts.append(p)
        if changed:
            rel_map[f["rel"]] = "/".join(new_parts)
    renames = [{"parent": names.display(k[0]), "old": names.display(k[1]), "new": v, "depth": k[0].count("/") + (1 if k[0] else 0)}
               for k, v in sorted(final.items(), key=lambda kv: (-kv[0][0].count("/"), kv[0][1]))]
    files = [{"old": names.display(o), "new": n} for o, n in sorted(rel_map.items())]
    return {"renames": renames, "files": files, "_final": final, "_rel_map": rel_map}


def _serato_raw_for(raw_old, old_rel, new_rel):
    if raw_old == old_rel:
        return new_rel
    if names.nfc(raw_old) != raw_old or (names.has_sfm(old_rel) and not names.has_sfm(raw_old)):
        return names.to_mac_form(new_rel)
    return new_rel


def apply_rename(lib, file_ids=None, include_emoji=False, progress=None):
    lib.require_writable("Dosya/klasör adı düzeltme")
    plan = plan_rename(lib, file_ids, include_emoji)
    final, rel_map = plan.get("_final") or {}, plan.get("_rel_map") or {}
    if not final:
        return {"renamed": 0}
    cat = lib.catalog
    ids_by_rel = {r["rel"]: r for r in cat.q("SELECT id, rel, os_rel FROM files")}
    affected_ids = [ids_by_rel[o]["id"] for o in rel_map if o in ids_by_rel]
    # dış referanslar
    serato_refs = cat.q("SELECT DISTINCT raw_path, file_id FROM ext_items WHERE src='serato' AND file_id IN (%s) "
                        "UNION SELECT DISTINCT raw_path, file_id FROM ext_tracks WHERE src='serato' AND file_id IN (%s)"
                        % (",".join(map(str, affected_ids)) or "0", ",".join(map(str, affected_ids)) or "0"))
    engine_refs = cat.q("SELECT ext_id, raw_path, file_id FROM ext_tracks WHERE src='engine:drive' AND file_id IN (%s)"
                        % (",".join(map(str, affected_ids)) or "0"))
    _check_apps(bool(serato_refs), bool(engine_refs))
    if progress:
        progress(0.05, "Yedekler alınıyor…")
    sdir = serato.serato_dir(lib.root)
    s_bk = serato.backup(sdir, lib.settings.backup_dir(lib.id, "serato"), "ad_duzeltme") if (sdir and serato_refs) else None
    dbs = [d for d in engine.find_dbs(lib.root) if d["key"] == "drive"]
    e_db = dbs[0] if dbs else None
    e_bk = engine.backup(e_db["path"], lib.settings.backup_dir(lib.id, "engine"), "ad_duzeltme") if (e_db and engine_refs) else None
    if e_db and engine_refs:
        try:
            engine.preflight(e_db["path"])
        except engine.EngineError as e:
            raise UserError(str(e))
    # 1) dosya sistemi: en derinden başlayarak
    done = []
    try:
        for (parent, old), new in sorted(final.items(), key=lambda kv: -len(names.split_rel(kv[0][0]))):
            parent_os = _os_rel_of_dir(lib, parent)
            src = names.long_path(names.join_os(lib.root, (parent_os + "/" if parent_os else "") + _os_name(lib, old)))
            dst = names.long_path(names.join_os(lib.root, (parent_os + "/" if parent_os else "") + new))
            if not os.path.exists(src):
                continue
            if os.path.exists(dst) and os.path.normcase(src) != os.path.normcase(dst):
                raise UserError("Hedef ad zaten var: %s" % names.display(new))
            if names.match_key(old).casefold() == names.match_key(new).casefold():
                tmp = src + ".djdtmp"
                os.rename(src, tmp)
                os.rename(tmp, dst)
            else:
                os.rename(src, dst)
            done.append({"src": src, "dst": dst})
    except Exception:
        for d in reversed(done):  # yarım kalırsa geri al
            try:
                os.rename(d["dst"], d["src"])
            except OSError:
                pass
        raise
    if progress:
        progress(0.5, "Katalog güncelleniyor…")
    # 2) katalog (kimlikler korunur, listeler bozulmaz)
    with cat.tx() as c:
        for old, new in rel_map.items():
            if old not in ids_by_rel:
                continue
            folder, name = (new.rsplit("/", 1) if "/" in new else ("", new))
            os_rel = new if not lib.rootinfo.mac_exfat else "/".join(names.sfm_to_ascii(p) for p in names.split_rel(new))
            c.execute("UPDATE files SET rel=?, mkey=?, lkey=?, os_rel=?, folder=?, name=? WHERE rel=?",
                      (new, names.match_key(new), names.loose_key(new), os_rel, folder, name, old))
    # 3) Serato
    s_map = {}
    rel_by_id = {ids_by_rel[o]["id"]: o for o in rel_map if o in ids_by_rel}
    for r in serato_refs:
        old_rel = rel_by_id.get(r["file_id"])
        if old_rel and r["raw_path"]:
            s_map[r["raw_path"]] = _serato_raw_for(r["raw_path"], old_rel, rel_map[old_rel])
    s_stats = serato.rewrite_paths(sdir, s_map) if (sdir and s_map) else {}
    # 4) Engine
    e_changes = []
    if e_db and engine_refs:
        w = engine.Writer(e_db["path"], e_db["lib_dir"], lib.root)
        try:
            for r in engine_refs:
                old_rel = rel_by_id.get(r["file_id"])
                if not old_rel:
                    continue
                newp = engine.rel_to_engine_path(rel_map[old_rel], e_db["lib_dir"], lib.root)
                if w.set_path_raw(int(r["ext_id"]), newp, r["raw_path"]):
                    e_changes.append({"id": int(r["ext_id"]), "old": r["raw_path"], "new": newp})
            w.commit()
        except Exception:
            w.rollback()
            raise
    jid = cat.journal_add("ad_duzeltme", "%d ad düzeltildi (%d dosya etkilendi)" % (len(done), len(rel_map)),
                          {"type": "rename", "done": done, "rel_map": rel_map, "serato_dir": sdir,
                           "serato_map": s_map, "serato_backup": s_bk, "engine_db": e_db["path"] if e_db else None,
                           "engine_backup": e_bk, "engine_changes": e_changes})
    if progress:
        progress(0.85, "Analiz yenileniyor…")
    lib.reanalyze()
    return {"renamed": len(done), "files": len(rel_map), "serato": s_stats, "engine": len(e_changes), "journal": jid}


def _os_name(lib, disk_name):
    return names.sfm_to_ascii(disk_name) if lib.rootinfo.mac_exfat else disk_name


def _os_rel_of_dir(lib, rel_dir):
    if not rel_dir:
        return ""
    return "/".join(_os_name(lib, p) for p in names.split_rel(rel_dir))


# ---------------------------------------------------------------------------
# Çiftleri birleştirme
# ---------------------------------------------------------------------------
def plan_dupes(lib, selections):
    """selections: [{group_id, keeper, remove:[ids]}] -> önizleme."""
    groups = {g["id"]: g for g in lib.dupes()}
    out = []
    for s in selections:
        g = groups.get(s["group_id"])
        if not g:
            continue
        keeper = int(s["keeper"])
        rm = [int(x) for x in s.get("remove", []) if int(x) != keeper]
        mem = {m["id"]: m for m in g["members"]}
        if keeper not in mem:
            continue
        out.append({"group_id": g["id"], "kind": g["kind"], "keeper": mem[keeper],
                    "remove": [mem[x] for x in rm if x in mem]})
    return out


def apply_dupes(lib, selections, progress=None):
    lib.require_writable("Çift dosyaları birleştirme")
    plan = plan_dupes(lib, selections)
    pairs = []  # (remove_file, keeper_file, same_audio)
    for p in plan:
        for r in p["remove"]:
            pairs.append((r["id"], p["keeper"]["id"], p["kind"] in ("exact", "audio")))
    if not pairs:
        return {"moved": 0}
    cat = lib.catalog
    rm_ids = [a for a, _, _ in pairs]
    idlist = ",".join(map(str, rm_ids + [b for _, b, _ in pairs]))
    s_refs = cat.q("SELECT DISTINCT raw_path, file_id FROM ext_items WHERE src='serato' AND file_id IN (%s) "
                   "UNION SELECT DISTINCT raw_path, file_id FROM ext_tracks WHERE src='serato' AND file_id IN (%s)" % (idlist, idlist))
    e_refs = cat.q("SELECT ext_id, raw_path, file_id, match FROM ext_tracks WHERE src='engine:drive' AND file_id IN (%s)" % idlist)
    _check_apps(bool(s_refs), bool(e_refs))
    sdir = serato.serato_dir(lib.root)
    dbs = [d for d in engine.find_dbs(lib.root) if d["key"] == "drive"]
    e_db = dbs[0] if dbs else None
    if e_db and e_refs:
        try:
            engine.preflight(e_db["path"])
        except engine.EngineError as e:
            raise UserError(str(e))
    if progress:
        progress(0.05, "Yedekler alınıyor…")
    s_bk = serato.backup(sdir, lib.settings.backup_dir(lib.id, "serato"), "ciftler") if (sdir and s_refs) else None
    e_bk = engine.backup(e_db["path"], lib.settings.backup_dir(lib.id, "engine"), "ciftler") if (e_db and e_refs) else None
    files = {f["id"]: f for f in cat.q("SELECT * FROM files WHERE id IN (%s)" % idlist)}
    # --- Engine ---
    e_stats = {"paths": 0, "repointed": 0, "dedup": 0, "added": 0}
    if e_db and e_refs:
        by_file = defaultdict(list)
        for r in e_refs:
            by_file[r["file_id"]].append(r)
        w = engine.Writer(e_db["path"], e_db["lib_dir"], lib.root)
        try:
            for rm, kp, same in pairs:
                rts = by_file.get(rm, [])
                if not rts:
                    continue
                kts = [r for r in by_file.get(kp, []) if r["match"] in ("exact", "case")] or by_file.get(kp, [])
                kpath = engine.rel_to_engine_path(files[kp]["rel"], e_db["lib_dir"], lib.root)
                if not kts:
                    ex = w.track_for_path(kpath)
                    if ex:
                        kts = [{"ext_id": ex["id"]}]
                if not kts and same:
                    # aynı ses: Engine kaydını (analiz, cue dahil) asıl dosyaya yönlendir
                    first = rts[0]
                    if w.set_path_raw(int(first["ext_id"]), kpath, first["raw_path"]):
                        e_stats["paths"] += 1
                    kts = [{"ext_id": first["ext_id"]}]
                    rts = rts[1:]
                if not kts:
                    row = w.add_track(files[kp], kpath)
                    e_stats["added"] += 1
                    kts = [{"ext_id": row["id"]}]
                to_origin = w.origin_of(int(kts[0]["ext_id"]))
                for rt in rts:
                    fo = w.origin_of(int(rt["ext_id"]))
                    if fo and to_origin and fo != to_origin:
                        u, d = w.repoint(fo, to_origin)
                        e_stats["repointed"] += u
                        e_stats["dedup"] += d
            w.commit()
        except Exception:
            w.rollback()
            raise
    # --- Serato ---
    s_stats = {}
    if sdir and s_refs:
        db = serato.read_database(sdir) or {"tracks": []}
        db_paths = {}
        for t in db["tracks"]:
            if t.get("pfil"):
                db_paths.setdefault(names.match_key(t["pfil"]), t["pfil"])
        raw_by_file = defaultdict(set)
        for r in s_refs:
            if r["raw_path"]:
                raw_by_file[r["file_id"]].add(r["raw_path"])
        s_map, drop = {}, set()
        for rm, kp, same in pairs:
            krel = files[kp]["rel"]
            for raw in raw_by_file.get(rm, ()):
                target = db_paths.get(names.match_key(krel)) or _serato_raw_for(raw, files[rm]["rel"], krel)
                s_map[raw] = target
                if not same:
                    drop.add(raw)
        s_stats = serato.rewrite_paths(sdir, s_map, drop_db_paths=frozenset(drop))
    # --- kendi listelerimiz ---
    list_changes = []
    with cat.tx() as c:
        for rm, kp, same in pairs:
            for item_id, lid, pos in c.execute("SELECT id, list_id, pos FROM list_items WHERE file_id=?", (rm,)).fetchall():
                dup = c.execute("SELECT 1 FROM list_items WHERE list_id=? AND file_id=?", (lid, kp)).fetchone()
                if dup:
                    c.execute("DELETE FROM list_items WHERE id=?", (item_id,))
                    list_changes.append({"action": "deleted", "item_id": item_id, "list_id": lid, "file_id": rm, "pos": pos})
                else:
                    c.execute("UPDATE list_items SET file_id=? WHERE id=?", (kp, item_id))
                    list_changes.append({"action": "updated", "item_id": item_id, "list_id": lid, "file_id": rm})
    # --- dosyaları karantinaya taşı ---
    if progress:
        progress(0.7, "Kopyalar karantinaya taşınıyor…")
    q = _qdir(lib, "ciftler")
    moves = []
    for rm, kp, same in pairs:
        f = files[rm]
        src = _abs(lib, f)
        dst = names.long_path(names.join_os(q, f.get("os_rel") or f["rel"]))
        try:
            real = _move(src, dst)
            moves.append({"src": src, "dst": real, "file_id": rm, "origin": f.get("origin")})
            cat.update_file(rm, present=0, origin="quarantine")
        except OSError:
            pass
    jid = cat.journal_add("ciftler", "%d çift kopya karantinaya taşındı" % len(moves),
                          {"type": "dupes", "moves": moves, "qdir": q, "serato_dir": sdir, "serato_backup": s_bk,
                           "engine_db": e_db["path"] if e_db else None, "engine_backup": e_bk,
                           "engine_fp": engine.fingerprint(e_db["path"]) if e_bk else None,
                           "serato_fp": serato.state_fp(sdir, serato.backup_members(s_bk)) if s_bk else None,
                           "list_changes": list_changes, "pairs": pairs})
    if progress:
        progress(0.85, "Analiz yenileniyor…")
    lib.reanalyze()
    return {"moved": len(moves), "engine": e_stats, "serato": s_stats, "lists": len(list_changes), "journal": jid, "qdir": q}


# ---------------------------------------------------------------------------
# Yeni müzik ekleme (gelen kutusu) — kaynak dosyalar sadece KOPYALANIR
# ---------------------------------------------------------------------------
def inbox_scan(lib, source, progress=None, cancel=None):
    if not os.path.isdir(source):
        raise UserError("Klasör bulunamadı: %s" % source)
    src_root = os.path.abspath(source)
    if os.path.normcase(src_root).startswith(os.path.normcase(os.path.abspath(lib.root)) + os.sep):
        raise UserError("Kaynak klasör kütüphanenin içinde. Yeni müzik ekleme, kütüphane dışındaki bir klasör içindir "
                        "(ör. İndirilenler).")
    from .scanner import RootInfo, walk
    ri = RootInfo(src_root)
    entries = [e for e in walk(ri, (), cancel) if e[1] == "audio"]
    cat = lib.catalog
    by_sig = defaultdict(list)
    by_song = defaultdict(list)
    for f in cat.q("SELECT id, rel, qsig, songkey, duration, bitrate FROM files WHERE kind='audio' AND present=1"):
        if f["qsig"]:
            by_sig[f["qsig"]].append(f)
        if f["songkey"]:
            by_song[f["songkey"]].append(f)
    items = []
    for i, (os_rel, kind, st) in enumerate(entries):
        rec = build_record(ri, os_rel, kind, st, util.now())
        status, match = "new", None
        if rec.get("qsig") and rec["qsig"] in by_sig:
            status, match = "same_audio", by_sig[rec["qsig"]][0]
        elif rec.get("songkey") and rec["songkey"] in by_song:
            for c in by_song[rec["songkey"]]:
                if rec.get("duration") and c["duration"] and abs(rec["duration"] - c["duration"]) <= 3:
                    status, match = "same_song", c
                    break
        items.append({
            "src": os.path.join(src_root, *names.split_rel(os_rel)), "disp": names.display(rec["rel"]),
            "name": names.display(rec["name"]), "size": rec["size"], "duration": rec.get("duration"),
            "bitrate": rec.get("bitrate"), "title": rec.get("title"), "artist": rec.get("artist"),
            "status": status, "error": rec.get("tag_error"),
            "match": {"id": match["id"], "disp": names.display(match["rel"]), "bitrate": match.get("bitrate")} if match else None,
            "safe_name": names.clean_component(rec["name"], True),
            "better": bool(match and rec.get("bitrate") and match.get("bitrate") and rec["bitrate"] > match["bitrate"] + 32),
        })
        if progress and i % 5 == 0:
            progress(0.05 + 0.9 * i / max(1, len(entries)), "İnceleniyor (%d/%d)…" % (i, len(entries)))
    return {"source": src_root, "items": items,
            "counts": {k: sum(1 for x in items if x["status"] == k) for k in ("new", "same_audio", "same_song")}}


def inbox_import(lib, sources, dest_rel, keep_turkish=True, strip_emoji=True, list_id=None, progress=None):
    lib.require_writable("Yeni müzik ekleme")
    dest_rel = "/".join(names.minimal_fix_component(p, False) for p in names.split_rel(dest_rel or ""))
    if not dest_rel:
        raise UserError("Hedef klasör adı gerekli (ör. 'yeni 2026-10').")
    dest_abs = names.long_path(names.join_os(lib.root, dest_rel))
    os.makedirs(dest_abs, exist_ok=True)
    copied, errors, new_ids = [], [], []
    for i, src in enumerate(sources):
        if not os.path.isfile(src):
            errors.append("Bulunamadı: %s" % src)
            continue
        name = names.clean_component(os.path.basename(src), True, keep_turkish=keep_turkish, strip_emoji=strip_emoji)
        dst = os.path.join(dest_abs, name)
        if os.path.exists(dst):
            stem, ext = os.path.splitext(name)
            k = 2
            while os.path.exists(os.path.join(dest_abs, "%s (%d)%s" % (stem, k, ext))):
                k += 1
            dst = os.path.join(dest_abs, "%s (%d)%s" % (stem, k, ext))
        try:
            shutil.copy2(src, dst)
            if os.path.getsize(dst) != os.path.getsize(src):
                raise OSError("boyut tutmuyor")
            ext = os.path.splitext(dst)[1].lower()
            a = audiosig.analyze(src, ext)
            b = audiosig.analyze(dst, ext)
            if a["qsig"] != b["qsig"]:
                raise OSError("kopya doğrulanamadı")
            copied.append(dst)
            os_rel = os.path.relpath(dst, lib.root).replace(os.sep, "/")
            rec = build_record(lib.rootinfo, os_rel, "audio", os.stat(dst), util.now())
            lib.catalog.upsert_files([rec])
            row = lib.catalog.file_by_rel(rec["rel"])
            if row:
                new_ids.append(row["id"])
        except OSError as e:
            errors.append("%s: %s" % (os.path.basename(src), e))
        if progress:
            progress(0.05 + 0.85 * (i + 1) / max(1, len(sources)), "Kopyalanıyor (%d/%d)…" % (i + 1, len(sources)))
    if list_id and new_ids:
        lib.catalog.items_add(int(list_id), new_ids)
    jid = lib.catalog.journal_add("yeni_muzik", "%d yeni parça eklendi → %s" % (len(copied), dest_rel),
                                  {"type": "import", "copied": copied, "dest": dest_abs})
    analysis.compute(lib.catalog, lib.prefs())
    return {"copied": len(copied), "errors": errors, "dest": dest_rel, "journal": jid}


# ---------------------------------------------------------------------------
# Geri alma
# ---------------------------------------------------------------------------
ENGINE_CHANGED_MSG = ("Bu işlemden sonra Engine veritabanı değişmiş (Engine DJ'de veya Prime 4'te yapılan analiz, "
                      "cue noktası, liste değişikliği ya da bu programın daha yeni bir işlemi). ")
SERATO_CHANGED_MSG = ("Bu işlemden sonra Serato dosyaları değişmiş (Serato açılıp kapanmış veya crate'ler "
                      "düzenlenmiş olabilir). ")
FORCE_TAIL = ("Geri alma, işlem öncesi yedeğe döner; aradaki bu değişiklikler de geri gider. Daha yeni işlemleriniz "
              "varsa önce onları geri alın. Yine de devam ederseniz şu anki hâlin yedeği ayrıca alınır.")


def _engine_changed(db_path, recorded):
    if not recorded or not os.path.isfile(db_path):
        return True
    try:
        return engine.fingerprint(db_path) != recorded
    except Exception:
        return True


def _serato_changed(sdir, recorded):
    if not recorded or not sdir:
        return True
    try:
        return serato.state_fp(sdir, list(recorded.keys())) != recorded
    except OSError:
        return True


def _restore_engine(lib, db_path, backup_path, notes):
    if not backup_path or not os.path.isfile(backup_path):
        raise UserError("Bu işlemin Engine yedeği bulunamadı (yedekler klasöründen silinmiş olabilir); geri alınamıyor.")
    try:
        engine.preflight(db_path)
    except engine.EngineError as e:
        raise UserError(str(e))
    pre = engine.backup(db_path, lib.settings.backup_dir(lib.id, "engine"), "geri_alma_oncesi")
    engine.restore(db_path, backup_path)
    notes.append("Engine veritabanı işlem öncesi yedeğe döndü (geri almadan önceki hâlin yedeği: %s)." % os.path.basename(pre))


def undo(lib, jid, progress=None, force=False):
    lib.require_writable("Geri alma")
    cat = lib.catalog
    j = cat.journal_get(jid)
    if not j:
        raise UserError("İşlem bulunamadı")
    if j["status"] == "geri_alindi":
        raise UserError("Bu işlem zaten geri alınmış.")
    p = j["payload"]
    t = p.get("type")
    notes = []
    if t == "move":
        _undo_moves(lib, p["moves"], notes)
    elif t == "import":
        q = _qdir(lib, "geri_alinan_ekleme")
        for path in p.get("copied", []):
            if os.path.exists(path):
                _move(path, os.path.join(q, os.path.basename(path)))
        notes.append("Eklenen kopyalar karantinaya taşındı (kaynak dosyalarınız zaten hiç değişmedi).")
    elif t == "rename":
        _check_apps(bool(p.get("serato_map")), bool(p.get("engine_changes")))
        for d in reversed(p.get("done", [])):
            if os.path.exists(d["dst"]) and not os.path.exists(d["src"]):
                os.rename(d["dst"], d["src"])
        with cat.tx() as c:
            for old, new in p.get("rel_map", {}).items():
                folder, name = (old.rsplit("/", 1) if "/" in old else ("", old))
                os_rel = old if not lib.rootinfo.mac_exfat else "/".join(names.sfm_to_ascii(x) for x in names.split_rel(old))
                c.execute("UPDATE files SET rel=?, mkey=?, lkey=?, os_rel=?, folder=?, name=? WHERE rel=?",
                          (old, names.match_key(old), names.loose_key(old), os_rel, folder, name, new))
        if p.get("serato_map") and p.get("serato_dir"):
            inv = {v: k for k, v in p["serato_map"].items()}
            serato.rewrite_paths(p["serato_dir"], inv)
        if p.get("engine_changes") and p.get("engine_db"):
            dbs = [d for d in engine.find_dbs(lib.root) if d["path"] == p["engine_db"]]
            if dbs:
                w = engine.Writer(dbs[0]["path"], dbs[0]["lib_dir"], lib.root)
                try:
                    for ch in p["engine_changes"]:
                        w.set_path_raw(ch["id"], ch["old"], ch["new"])
                    w.commit()
                except Exception:
                    w.rollback()
                    raise
    elif t == "engine_repair":
        dbp = p["db"]
        dbs = [d for d in engine.find_dbs(lib.root) if d["path"] == dbp]
        if not dbs:
            raise UserError("Engine veritabanı bulunamadı.")
        try:
            engine.preflight(dbp)
        except engine.EngineError as e:
            raise UserError(str(e))
        w = engine.Writer(dbp, dbs[0]["lib_dir"], lib.root)
        try:
            n = sum(1 for ch in p.get("changes", []) if w.set_path_raw(ch["id"], ch["old"], ch["new"]))
            w.commit()
        except Exception:
            w.rollback()
            raise
        notes.append("%d yol eski hâline döndü." % n)
    elif t == "engine_sync":
        _check_apps(False, True)
        if progress:
            progress(0.1, "Engine veritabanı kontrol ediliyor…")
        if not force and _engine_changed(p["db"], p.get("engine_fp")):
            raise UserError(ENGINE_CHANGED_MSG + FORCE_TAIL, code="degisti")
        _restore_engine(lib, p["db"], p.get("backup"), notes)
        notes.append("İpucu: Bir etkinliği Engine'den kaldırmak için 'Engine'e gönder' işaretini kapatıp tekrar "
                     "göndermeniz yeterlidir; bu, veritabanının geri kalanına dokunmaz.")
    elif t == "serato_export":
        if util.process_running(serato.SERATO_PROCS):
            raise UserError("Serato DJ açık; lütfen kapatın.")
        sdir = p["sdir"]
        fps = p.get("written_fp")
        changed = []
        for w_path in p.get("written", []):
            if os.path.isfile(w_path) and (fps is None or serato.file_hash(w_path) != fps.get(os.path.basename(w_path))):
                changed.append(os.path.basename(w_path)[:-6].replace("%%", " / "))
        if changed and not force:
            raise UserError("Programın yazdığı crate'lerden %d tanesi sonradan Serato'da değiştirilmiş (%s). "
                            "Geri alırsanız bu değişiklikler de geri gider. Yine de devam ederseniz şu anki hâlin "
                            "yedeği ayrıca alınır." % (len(changed), ", ".join(changed[:3]) + ("…" if len(changed) > 3 else "")),
                            code="degisti")
        bk = p.get("backup")
        members = set(serato.backup_members(bk)) if bk and os.path.isfile(bk) else set()
        pre = serato.backup(sdir, lib.settings.backup_dir(lib.id, "serato"), "geri_alma_oncesi")
        restore, qd, removed = set(), None, 0
        for w_path in p.get("written", []):
            arc = os.path.relpath(w_path, sdir).replace(os.sep, "/")
            if arc in members:
                restore.add(arc)          # yazmadan önce de vardı: eski hâline dön
            elif os.path.isfile(w_path):
                qd = qd or _qdir(lib, "geri_alinan_serato_crateleri")
                serato.remove_crate_file(w_path, qd)
                removed += 1
        if restore:
            serato.restore_backup(sdir, bk, only=restore)
        back = 0
        for m in p.get("moved", []):
            if isinstance(m, dict) and os.path.isfile(m["dst"]) and not os.path.exists(m["src"]):
                util.move_file(m["dst"], m["src"])
                back += 1
        notes.append("Serato: %d crate eski hâline döndü, %d yeni crate karantinaya taşındı, %d eski crate geri geldi. "
                     "Serato'nun diğer dosyalarına dokunulmadı (geri almadan önceki hâlin yedeği: %s)."
                     % (len(restore), removed, back, os.path.basename(pre)))
    elif t == "dupes":
        _check_apps(bool(p.get("serato_backup")), bool(p.get("engine_backup")))
        if progress:
            progress(0.1, "Engine ve Serato kontrol ediliyor…")
        if p.get("engine_backup") and not os.path.isfile(p["engine_backup"]):
            raise UserError("Bu işlemin Engine yedeği bulunamadı (yedekler klasöründen silinmiş olabilir); geri alınamıyor.")
        if p.get("serato_backup") and not os.path.isfile(p["serato_backup"]):
            raise UserError("Bu işlemin Serato yedeği bulunamadı (yedekler klasöründen silinmiş olabilir); geri alınamıyor.")
        if p.get("engine_backup") and p.get("engine_db"):
            try:
                engine.preflight(p["engine_db"])
            except engine.EngineError as e:
                raise UserError(str(e))
        if not force:
            why = ""
            if p.get("engine_backup") and p.get("engine_db") and _engine_changed(p["engine_db"], p.get("engine_fp")):
                why += ENGINE_CHANGED_MSG
            if p.get("serato_backup") and p.get("serato_dir") and _serato_changed(p["serato_dir"], p.get("serato_fp")):
                why += SERATO_CHANGED_MSG
            if why:
                raise UserError(why + FORCE_TAIL, code="degisti")
        if p.get("engine_backup") and p.get("engine_db"):
            _restore_engine(lib, p["engine_db"], p["engine_backup"], notes)
        if p.get("serato_backup") and p.get("serato_dir"):
            pre = serato.backup(p["serato_dir"], lib.settings.backup_dir(lib.id, "serato"), "geri_alma_oncesi")
            serato.restore_backup(p["serato_dir"], p["serato_backup"])
            notes.append("Serato işlem öncesi hâline döndü (geri almadan önceki hâlin yedeği: %s)." % os.path.basename(pre))
        _undo_moves(lib, p.get("moves", []), notes)
        with cat.tx() as c:
            for ch in reversed(p.get("list_changes", [])):
                if ch["action"] == "updated":
                    c.execute("UPDATE list_items SET file_id=? WHERE id=?", (ch["file_id"], ch["item_id"]))
                else:
                    c.execute("INSERT INTO list_items(list_id, file_id, pos, added) VALUES(?,?,?,?)",
                              (ch["list_id"], ch["file_id"], ch["pos"], util.now()))
    else:
        raise UserError("Bu işlem türü geri alınamaz.")
    cat.journal_status(jid, "geri_alindi")
    cat.journal_add("geri_al", "Geri alındı: %s" % j["title"], {"type": "undo_record", "of": jid, "notes": notes},
                    undo_of=jid)
    lib.reanalyze()
    return {"ok": True, "notes": notes}


def _undo_moves(lib, moves, notes):
    back = 0
    for m in reversed(moves):
        if os.path.exists(m["dst"]) and not os.path.exists(m["src"]):
            os.makedirs(os.path.dirname(m["src"]), exist_ok=True)
            os.rename(m["dst"], m["src"])
            back += 1
            if m.get("file_id"):
                lib.catalog.update_file(m["file_id"], present=1, origin=m.get("origin") or "library")
    notes.append("%d dosya yerine geri taşındı." % back)
