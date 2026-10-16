"""Dosya ve klasör taşıma / yeniden adlandırma, türler (bölümler) ve ilk kurulum.

Her taşıma tek bir işlemdir ve 'Geri al' ile tamamen geri döner:
  * Dosya aynı SSD içinde yeniden adlandırılır (kopyalama yok, anlıktır).
  * Programın kataloğu, Engine kütüphanesi (SSD'deki ve varsa bilgisayardaki) ve Serato
    (database V2 + crate'ler) AYNI ANDA yeni yola çevrilir; Engine'deki analiz, cue ve listeler korunur.
  * Mac'in bıraktığı '._' yardımcı dosyaları dosyayla birlikte taşınır; boşalan klasörler kaldırılır
    (içinde yalnızca .DS_Store gibi çöp kaldıysa o çöp karantinaya taşınır, silinmez).
"""
from __future__ import annotations

import os
from collections import defaultdict

from . import engine, genres as G, journal, names, serato, util
from .dedupe import serato_raw_for

JUNK_LOWER = {n.lower() for n in names.JUNK_NAMES}
PROTECT_TOP = {"_serato_", "_serato_backup", "_djdoktor_", "engine library", "$recycle.bin",
               "system volume information"}


def _err(msg, code=None):
    from .library import UserError
    return UserError(msg, code)


def _is_junk(name):
    return name.startswith("._") or name.lower() in JUNK_LOWER


def _parent(rel):
    return rel.rsplit("/", 1)[0] if "/" in rel else ""


def _check_apps(lib, need_engine, need_serato):
    if need_engine and lib.engine_open():
        raise _err("Engine DJ açık. Bu değişiklik için Engine DJ'i kapatın (açıkken yapılan değişiklik Engine "
                   "tarafından ezilebilir).", "engine_open")
    if need_serato and lib.serato_open():
        raise _err("Serato açık. Bu değişiklik için Serato'yu kapatın.", "serato_open")


# ---------------------------------------------------------------------------
# Engine / Serato referansları
# ---------------------------------------------------------------------------
def _engine_rows(lib, fids):
    """{db_key: {'d': d, 'rows': {fid: [(tid, path)]}}} — taşınacak dosyaların Engine kayıtları."""
    out = {}
    want = set(fids)
    for d in lib.engine_dbs():
        try:
            data = engine.read(d["path"])
        except Exception:
            continue
        tracks, by_file, _o, _r, _t = lib.engine_map(d, data)
        rows = {}
        for fid in want:
            if by_file.get(fid):
                rows[fid] = [(tid, tracks[tid].get("path") or "") for tid, _m in by_file[fid]]
        if rows:
            out[d["key"]] = {"d": d, "rows": rows}
    return out


def _serato_raws(lib, fids):
    ids = sorted(set(fids))
    if not ids or not lib.serato_dir():
        return {}
    out = defaultdict(set)
    for i in range(0, len(ids), 900):
        chunk = ids[i:i + 900]
        marks = ",".join("?" for _ in chunk)
        for r in lib.catalog.q("SELECT DISTINCT raw_path, file_id FROM ext_items WHERE src='serato' AND file_id IN "
                               "(%s) UNION SELECT DISTINCT raw_path, file_id FROM ext_tracks WHERE src='serato' AND "
                               "file_id IN (%s)" % (marks, marks), chunk + chunk):
            if r["raw_path"]:
                out[r["file_id"]].add(r["raw_path"])
    return dict(out)


def _update_refs(lib, changes, eng, sraws, op, progress=None):
    """changes: [(fid, eski_rel, yeni_rel)] — katalog zaten güncel. Engine ve Serato'yu yeni yola çevirir."""
    res = {"engine": 0, "serato": 0}
    for key, info in eng.items():
        d = info["d"]
        w = engine.Writer(d["path"], d["lib_dir"], lib.root)
        try:
            for fid, _old, new in changes:
                for tid, oldp in info["rows"].get(fid, []):
                    newp = engine.repath(oldp, None, new, d["lib_dir"], lib.root)
                    if w.track_set_path(tid, newp, expect=oldp) == "ok":
                        res["engine"] += 1
            w.commit()
        except Exception:
            w.rollback()
            raise
        op.add_engine(w, key)
    sdir = lib.serato_dir()
    if sdir and sraws:
        mapping = {}
        for fid, old, new in changes:
            for raw in sraws.get(fid, ()):
                mapping[raw] = serato_raw_for(raw, old, new)
        mapping = {k: v for k, v in mapping.items() if k != v}
        if mapping:
            serato.backup(sdir, lib.backup_dir("serato"), "tasima")
            _prune(lib.backup_dir("serato"), "serato_", ".zip", 12)
            st = serato.rewrite_paths(sdir, mapping, dedupe=False)
            op.add({"k": "ser", "map": mapping})
            res["serato"] = st.get("crate_entries", 0) + st.get("db_changed", 0)
    return res


def _prune(dest, prefix, suffix, keep):
    try:
        files = sorted((f for f in os.listdir(dest) if f.startswith(prefix) and f.endswith(suffix)),
                       key=lambda f: os.path.getmtime(os.path.join(dest, f)))
    except OSError:
        return
    for f in files[:-keep]:
        try:
            os.remove(os.path.join(dest, f))
        except OSError:
            pass


# ---------------------------------------------------------------------------
# Dosya sistemi yardımcıları
# ---------------------------------------------------------------------------
def _ensure_dir(lib, rel_dir, op):
    parts = names.split_rel(rel_dir)
    for i in range(1, len(parts) + 1):
        sub = "/".join(parts[:i])
        p = lib.rootinfo.os_path(sub)
        if not os.path.isdir(p):
            os.mkdir(p)
            op.add({"k": "mkdir", "rel": sub})


def _taken_keys(lib, exclude_ids=()):
    ex = set(exclude_ids)
    return {r["lkey"] for r in lib.catalog.q("SELECT id, lkey FROM files WHERE present=1") if r["id"] not in ex}


def _unique_targets(lib, moves):
    """Hedef adlar çakışmasın: aynı klasörde aynı ad varsa ' (2)' eklenir."""
    taken = _taken_keys(lib, moves.keys())
    out = {}
    for fid, new in sorted(moves.items(), key=lambda kv: kv[1]):
        f = lib.catalog.file(fid)
        own = names.loose_key(f["rel"]) if f else None
        cand, k = new, 2
        stem, ext = os.path.splitext(new)
        while True:
            lk = names.loose_key(cand)
            if lk == own:
                break  # aynı dosya (yalnızca büyük/küçük harf değişiyor)
            if lk not in taken and not os.path.exists(lib.rootinfo.os_path(cand)):
                break
            cand = "%s (%d)%s" % (stem, k, ext)
            k += 1
        taken.add(names.loose_key(cand))
        out[fid] = cand
    return out


def _rename(src, dst):
    """Büyük/küçük harf farkı olan yeniden adlandırmalar için ara ad kullanır (exFAT/Windows/Mac);
    başka bir dosyanın üstüne asla yazmaz."""
    util.safe_rename(src, dst)


def _fs_move(lib, f, new_rel, op):
    src = lib.rootinfo.os_path(f["rel"], f.get("os_rel"))
    dst = lib.rootinfo.os_path(new_rel)
    _ensure_dir(lib, _parent(new_rel), op)
    _rename(src, dst)
    op.add({"k": "mv", "fid": f["id"], "old": f["rel"], "new": new_rel})
    comp = os.path.join(os.path.dirname(src), "._" + os.path.basename(src))
    if os.path.isfile(comp):
        cdst = os.path.join(os.path.dirname(dst), "._" + os.path.basename(dst))
        if not os.path.exists(cdst):
            try:
                os.rename(comp, cdst)
                op.add({"k": "mv", "fid": None, "old": _rel_of(lib, comp), "new": _rel_of(lib, cdst)})
            except OSError:
                pass


def _rel_of(lib, abs_path):
    """Mutlak yoldan kanonik göreli yol (karantina/çöp dosyaları için)."""
    rel = os.path.relpath(abs_path, lib.root).replace(os.sep, "/")
    return lib.rootinfo.canonical(rel)


def _cleanup_dirs(lib, dirs, op, protect=()):
    """Boşalan klasörleri kaldırır. İçinde yalnızca çöp (.DS_Store, ._) kaldıysa çöp karantinaya taşınır.
    Ana müzik klasörü ve tür klasörleri boş olsa da kalır."""
    keep = list(protect) + [g["rel"] for g in lib.catalog.genres()] + [lib.music_root()]
    prot = {names.loose_key(p) for p in keep if p}
    qdir_rel = None
    removed = 0
    todo = set()
    for d in dirs:
        parts = names.split_rel(d)
        for i in range(len(parts), 0, -1):
            todo.add("/".join(parts[:i]))
    for d in sorted(todo, key=lambda x: -x.count("/")):
        parts = names.split_rel(d)
        if not parts or names.fold(parts[0]) in PROTECT_TOP or names.loose_key(d) in prot:
            continue
        p = lib.rootinfo.os_path(d)
        try:
            entries = os.listdir(p)
        except OSError:
            continue
        if any(not _is_junk(e) for e in entries):
            continue
        for e in entries:
            src = os.path.join(p, e)
            if not os.path.isfile(src):
                break
            if qdir_rel is None:
                qdir_rel = lib.quarantine_rel("bos_klasor_copu")
            dst_rel = qdir_rel + "/" + d + "/" + e
            dst = util.unique_path(lib.rootinfo.os_path(dst_rel))
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            util.safe_rename(src, dst)
            op.add({"k": "q", "fid": None, "old": d + "/" + e, "dst": _rel_of(lib, dst), "raw": True})
        try:
            os.rmdir(p)
            op.add({"k": "rmdir", "rel": d})
            removed += 1
        except OSError:
            pass
    return removed


def _move_companions(lib, src_dirs_done, op):
    """Bir klasörün TÜM şarkıları aynı yere taşındıysa kapak resmi, .cue, video gibi diğer dosyalar da taşınır."""
    moved = 0
    for src_dir, dst_dir in src_dirs_done.items():
        p = lib.rootinfo.os_path(src_dir)
        try:
            entries = list(os.scandir(p))
        except OSError:
            continue
        for e in entries:
            if not e.is_file() or _is_junk(e.name):
                continue
            ext = os.path.splitext(e.name)[1].lower()
            if ext in names.AUDIO_EXTS:
                continue  # katalogda olmayan ses dosyasına dokunma
            src_rel = src_dir + "/" + lib.rootinfo.canonical(e.name)
            dst_rel = dst_dir + "/" + names.minimal_fix_component(e.name, True)
            dst = lib.rootinfo.os_path(dst_rel)
            if os.path.exists(dst):
                continue
            _ensure_dir(lib, dst_dir, op)
            try:
                os.rename(e.path, dst)
            except OSError:
                continue
            row = lib.catalog.file_by_rel(src_rel)
            if row:
                lib.catalog.update_rel(row["id"], dst_rel, lib.rootinfo.os_rel_of(dst_rel), names.match_key(dst_rel),
                                       names.loose_key(dst_rel))
            op.add({"k": "mv", "fid": row["id"] if row else None, "old": src_rel, "new": dst_rel})
            moved += 1
    return moved


# ---------------------------------------------------------------------------
# Taşıma
# ---------------------------------------------------------------------------
def move_files(lib, moves, title, kind="tasima", progress=None, op=None, maint=True, protect=(), exact=False):
    """moves: {file_id: yeni_rel (kanonik)}. Tek işlem, tek 'Geri al'.
    exact=True: yalnızca harf biçimi (NFD -> NFC) değişen adlar da taşınır (ad düzeltme için)."""
    own_op = op is None
    op = op or journal.Op(lib, kind, title)
    cat = lib.catalog
    with lib.lock:
        files = {}
        for fid in moves:
            f = cat.file(fid)
            if f and f["present"]:
                files[fid] = f
        moves = {fid: rel for fid, rel in moves.items() if fid in files and
                 (rel != files[fid]["rel"] if exact else names.match_key(rel) != names.match_key(files[fid]["rel"]))}
        if not moves:
            if own_op and not op.steps:
                return {"moved": 0}
        moves = _unique_targets(lib, moves)
        eng = _engine_rows(lib, moves.keys())
        sraws = _serato_raws(lib, moves.keys())
        _check_apps(lib, bool(eng), bool(sraws))
        for key, info in eng.items():
            try:
                engine.preflight(info["d"]["path"])
            except engine.EngineError as e:
                raise _err(str(e))
            engine.backup(info["d"]["path"], lib.backup_dir("engine"), kind)
            engine.prune_backups(lib.backup_dir("engine"))
        n0 = len(op.steps)
        changes = []
        src_dirs = defaultdict(set)
        total = len(moves)
        try:
            items = sorted(moves.items(), key=lambda kv: kv[1])
            for b in range(0, len(items), 200):
                with cat.tx():   # katalog yazımları 200'lük paketlerle (hızlı, yarım kalmaz)
                    for i, (fid, new) in enumerate(items[b:b + 200], b):
                        f = files[fid]
                        _fs_move(lib, f, new, op)
                        cat.update_rel(fid, new, lib.rootinfo.os_rel_of(new), names.match_key(new), names.loose_key(new))
                        cat.add_history(f["rel"], fid)
                        changes.append((fid, f["rel"], new))
                        src_dirs[f.get("folder") or ""].add(_parent(new))
                        if progress and (i % 25 == 0 or i == total - 1):
                            progress(0.05 + 0.55 * (i + 1) / max(1, total), "Taşınıyor (%d/%d)…" % (i + 1, total))
            if progress:
                progress(0.62, "Engine ve Serato güncelleniyor…")
            res = _update_refs(lib, changes, eng, sraws, op)
            # klasörün tamamı tek yere gittiyse diğer dosyaları da götür
            whole = {}
            for sdir, dsts in src_dirs.items():
                if len(dsts) != 1 or not sdir:
                    continue
                left = cat.q1("SELECT COUNT(*) AS n FROM files WHERE folder=? AND present=1 AND kind='audio'", (sdir,))
                if left and left["n"] == 0:
                    whole[sdir] = next(iter(dsts))
            res["companions"] = _move_companions(lib, whole, op)
            res["dirs_removed"] = _cleanup_dirs(lib, list(src_dirs.keys()), op, protect=protect)
        except Exception:
            # yarım kalmasın: bu işlemde yapılan her şeyi geri al
            journal.apply_inverse(lib, op.steps[n0:], force=True)
            del op.steps[n0:]
            lib.bump()
            raise
        res["moved"] = len(changes)
        lib.bump()
        if sraws:
            lib.analyze_serato()
        if own_op:
            if maint:
                if progress:
                    progress(0.85, "Engine koleksiyonu güncelleniyor…")
                res["maint"] = _maint(lib, op)
            res["journal"] = op.commit()
        return res


def _maint(lib, op):
    from . import maintain
    return maintain.after_change(lib, op)


def rename_folder(lib, rel, new_name, progress=None, op=None, kind="ad_degistir"):
    """Klasörü yeniden adlandırır (içindeki her şey yerinde kalır; Engine/Serato yolları güncellenir)."""
    cat = lib.catalog
    rel = "/".join(names.split_rel(rel))
    if not rel:
        raise _err("Klasör seçilmedi.")
    new_name = names.minimal_fix_component((new_name or "").strip(), False)
    if not new_name or new_name == "adsiz":
        raise _err("Yeni ad boş olamaz.")
    parent = _parent(rel)
    new_rel = (parent + "/" + new_name) if parent else new_name
    if new_rel == rel:
        return {"renamed": 0}
    src = lib.rootinfo.os_path(rel)
    dst = lib.rootinfo.os_path(new_rel)
    if not os.path.isdir(src):
        raise _err("Klasör bulunamadı: %s" % names.display(rel))
    if names.loose_key(rel) != names.loose_key(new_rel) and os.path.exists(dst):
        raise _err("Bu adda bir klasör zaten var: %s" % names.display(new_name), "exists")
    own_op = op is None
    op = op or journal.Op(lib, kind, "Klasör adı: %s → %s" % (names.display(names.split_rel(rel)[-1]), new_name))
    with lib.lock:
        pre = rel + "/"
        rows = [r for r in cat.q("SELECT id, rel, os_rel, present FROM files WHERE present=1 AND rel LIKE ? "
                                 "ESCAPE '\\'", (_like(pre),)) if r["rel"].startswith(pre)]
        fids = [r["id"] for r in rows if r["present"]]
        eng = _engine_rows(lib, fids)
        sraws = _serato_raws(lib, fids)
        _check_apps(lib, bool(eng), bool(sraws))
        for key, info in eng.items():
            try:
                engine.preflight(info["d"]["path"])
            except engine.EngineError as e:
                raise _err(str(e))
            engine.backup(info["d"]["path"], lib.backup_dir("engine"), kind)
        n0 = len(op.steps)
        try:
            _rename(src, dst)
            changes, cat_changes = [], []
            with cat.tx():
                for r in rows:
                    nr = new_rel + r["rel"][len(rel):]
                    cat.update_rel(r["id"], nr, lib.rootinfo.os_rel_of(nr), names.match_key(nr), names.loose_key(nr))
                    cat_changes.append([r["id"], r["rel"], nr])
                    cat.add_history(r["rel"], r["id"])
                    changes.append((r["id"], r["rel"], nr))
            op.add({"k": "mvdir", "old": rel, "new": new_rel, "files": cat_changes})
            # tür ve kural kayıtları
            for g in cat.genres():
                if g["rel"] == rel or g["rel"].startswith(pre):
                    nr = new_rel + g["rel"][len(rel):]
                    op.add({"k": "genre", "op": "upd", "id": g["id"], "old": {"rel": g["rel"]}})
                    cat.genre_update(g["id"], rel=nr)
            for r0, act in cat.folder_rules().items():
                if r0 == rel or r0.startswith(pre):
                    nr = new_rel + r0[len(rel):]
                    op.add({"k": "rule", "rel": r0, "old": act})
                    cat.set_folder_rule(r0, None)
                    op.add({"k": "rule", "rel": nr, "old": None})
                    cat.set_folder_rule(nr, act)
            mr = lib.music_root()
            if mr and (mr == rel or mr.startswith(pre)):
                op.add({"k": "meta", "key": "music_root", "old": mr})
                cat.set_meta("music_root", new_rel + mr[len(rel):])
            res = _update_refs(lib, changes, eng, sraws, op)
        except Exception:
            journal.apply_inverse(lib, op.steps[n0:], force=True)
            del op.steps[n0:]
            lib.bump()
            raise
        res.update({"renamed": 1, "files": len(changes), "new_rel": new_rel})
        lib.bump()
        if sraws:
            lib.analyze_serato()
        if own_op:
            res["maint"] = _maint(lib, op)
            res["journal"] = op.commit()
        return res


def _like(prefix):
    return prefix.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


def move_folder(lib, rel, new_parent, progress=None):
    """Klasörü başka bir klasörün içine taşır (ör. albüm klasörünü bir türün içine)."""
    rel = "/".join(names.split_rel(rel))
    new_parent = "/".join(names.split_rel(new_parent or ""))
    name = names.split_rel(rel)[-1]
    target = (new_parent + "/" + name) if new_parent else name
    if names.loose_key(target) == names.loose_key(rel):
        return {"moved": 0}
    if names.loose_key(new_parent + "/").startswith(names.loose_key(rel + "/")):
        raise _err("Bir klasör kendi içine taşınamaz.")
    cat = lib.catalog
    pre = rel + "/"
    moves = {}
    for r in cat.q("SELECT id, rel FROM files WHERE present=1 AND rel LIKE ? ESCAPE '\\'", (_like(pre),)):
        if r["rel"].startswith(pre):
            moves[r["id"]] = target + r["rel"][len(rel):]
    return move_files(lib, moves, "Klasör taşındı: %s → %s" % (names.display(name), names.display(new_parent) or "kök"),
                      progress=progress)


# ---------------------------------------------------------------------------
# Türler
# ---------------------------------------------------------------------------
def _genre_by_id(lib, gid):
    for g in lib.genre_rows():
        if g["id"] == int(gid):
            return g
    raise _err("Tür bulunamadı.")


def genre_create(lib, name, color=None, op=None):
    name = (name or "").strip()
    if not name:
        raise _err("Tür adı boş olamaz.")
    root = lib.music_root()
    if not root:
        raise _err("Önce düzeni kurun (ana müzik klasörü belli değil).")
    dname = G.genre_folder_name(name)
    rel = root + "/" + dname
    for g in lib.genre_rows():
        if names.loose_key(g["rel"]) == names.loose_key(rel):
            raise _err("Bu tür zaten var: %s" % g["name"], "exists")
    own = op is None
    op = op or journal.Op(lib, "tur", "Yeni tür: %s" % dname)
    _ensure_dir(lib, rel, op)
    gid = lib.catalog.genre_add(rel, color=color or G.GENRE_COLORS.get(dname) or G.GENRE_COLORS.get(name))
    op.add({"k": "genre", "op": "add", "id": gid})
    rule = lib.catalog.folder_rules().get(rel)
    if rule:
        op.add({"k": "rule", "rel": rel, "old": rule})
        lib.catalog.set_folder_rule(rel, None)
    lib.bump()
    if own:
        _maint(lib, op)
        op.commit()
    return gid


def genre_rename(lib, gid, new_name):
    g = _genre_by_id(lib, gid)
    res = rename_folder(lib, g["rel"], new_name, kind="tur")
    return res


def genre_update(lib, gid, **kw):
    g = _genre_by_id(lib, gid)
    old = {k: g.get(k) for k in kw if k in ("color", "engine", "pos")}
    if not old:
        return
    op = journal.Op(lib, "tur", "Tür ayarı: %s" % g["name"])
    op.add({"k": "genre", "op": "upd", "id": g["id"], "old": old})
    lib.catalog.genre_update(g["id"], **{k: kw[k] for k in old})
    lib.bump()
    _maint(lib, op)
    op.commit()


def genre_reorder(lib, ids):
    op = journal.Op(lib, "tur", "Türlerin sırası değişti")
    for pos, gid in enumerate(ids):
        g = lib.catalog.genre(int(gid))
        if g and g["pos"] != pos:
            op.add({"k": "genre", "op": "upd", "id": g["id"], "old": {"pos": g["pos"]}})
            lib.catalog.genre_update(g["id"], pos=pos)
    lib.bump()
    _maint(lib, op)
    op.commit()


def genre_delete(lib, gid):
    """Türü kaldırır: klasör boşsa kaldırılır; içinde şarkı varsa izin verilmez (önce taşıyın/birleştirin)."""
    g = _genre_by_id(lib, gid)
    cat = lib.catalog
    pre = g["rel"] + "/"
    n = [r for r in cat.q("SELECT rel FROM files WHERE present=1 AND kind='audio' AND rel LIKE ? ESCAPE '\\'",
                          (_like(pre),)) if r["rel"].startswith(pre)]
    if n:
        raise _err("“%s” içinde %d şarkı var. Önce şarkıları başka türe taşıyın ya da türü başka bir türle "
                   "birleştirin." % (g["name"], len(n)), "not_empty")
    op = journal.Op(lib, "tur", "Tür kaldırıldı: %s" % g["name"])
    row = cat.genre(g["id"])
    op.add({"k": "genre", "op": "del", "row": row})
    cat.genre_delete(g["id"])
    _cleanup_dirs(lib, [g["rel"]], op)
    lib.bump()
    _maint(lib, op)
    op.commit()


def genre_merge(lib, src_id, dst_id, progress=None):
    """Bir türün tüm şarkılarını (alt klasörleriyle) başka türe taşır ve eski türü kaldırır."""
    src, dst = _genre_by_id(lib, src_id), _genre_by_id(lib, dst_id)
    if src["id"] == dst["id"]:
        raise _err("Aynı tür seçildi.")
    cat = lib.catalog
    pre = src["rel"] + "/"
    moves = {}
    for r in cat.q("SELECT id, rel FROM files WHERE present=1 AND rel LIKE ? ESCAPE '\\'", (_like(pre),)):
        if r["rel"].startswith(pre):
            moves[r["id"]] = dst["rel"] + "/" + r["rel"][len(pre):]
    op = journal.Op(lib, "tur", "“%s” → “%s” ile birleştirildi" % (src["name"], dst["name"]))
    res = move_files(lib, moves, op.title, progress=progress, op=op, protect=[dst["rel"]])
    row = cat.genre(src["id"])
    op.add({"k": "genre", "op": "del", "row": row})
    cat.genre_delete(src["id"])
    _cleanup_dirs(lib, [src["rel"]], op)
    lib.bump()
    res["maint"] = _maint(lib, op)
    res["journal"] = op.commit()
    return res


def move_to_genre(lib, fids, gid, sub=None, progress=None):
    """Şarkıları türün klasörüne taşır (ör. Türü belli değil -> Halay)."""
    g = _genre_by_id(lib, gid)
    base = g["rel"] + ("/" + "/".join(names.minimal_fix_component(p, False) for p in names.split_rel(sub))
                       if sub else "")
    moves = {}
    for fid in fids:
        f = lib.catalog.file(int(fid))
        if not f or not f["present"]:
            continue
        moves[f["id"]] = base + "/" + names.minimal_fix_component(f["name"], True)
    n = len(moves)
    title = ("%d şarkı → %s" % (n, g["name"])) if n != 1 else "“%s” → %s" % (
        os.path.splitext(names.display(lib.catalog.file(next(iter(moves)))["name"]))[0][:50], g["name"])
    return move_files(lib, moves, title, progress=progress)


# ---------------------------------------------------------------------------
# İlk kurulum: mevcut dağınık yapıdan tür klasörlerine
# ---------------------------------------------------------------------------
def setup_proposal(lib, music_root=None):
    from .library import STATE_DIR
    files = [f for f in lib.audio_files() if not f["rel"].startswith(STATE_DIR + "/")]
    existing = [g["name"] for g in lib.genre_rows()]
    prop = G.propose(files, lib.memberships(), music_root or lib.music_root() or "Müzik", existing)
    return prop


def _setup_targets(lib, root_rel, overrides, genre_map):
    from .library import STATE_DIR
    files = [f for f in lib.audio_files() if not f["rel"].startswith(STATE_DIR + "/")]
    prop = G.propose(files, lib.memberships(), root_rel, [])
    folders = prop["folders"]
    # öneriyi kullanıcının tür adlarına çevir (ör. 'Halay' -> 'HALAYLAR')
    ov = dict(overrides or {})
    gdirs = {}
    for name, target in (genre_map or {}).items():
        gdirs[name] = G.genre_folder_name(target or name)
    targets, stats = G.plan_targets(folders, ov, gdirs, root_rel, files)
    # yalnızca müzik kökünün DIŞINDAN gelen veya tür klasörüne girecek dosyalar
    return prop, targets, stats


def setup_preview(lib, root_name="Müzik", overrides=None, genre_map=None, extra=()):
    root_rel = names.minimal_fix_component(root_name or "Müzik", False)
    prop, targets, stats = _setup_targets(lib, root_rel, overrides, genre_map)
    eff = G.effective_assignments(prop["folders"], overrides or {})
    gm = genre_map or {}
    names_ = [k[2:] for k, v in stats.items() if k.startswith("g:") and v]
    for x in extra or ():
        if x not in names_:
            names_.append(x)
    names_.sort(key=lambda n: (G.DISPLAY_ORDER.index(n) if n in G.DISPLAY_ORDER else 99, n))
    # Engine'e eklenecekler: tür klasörüne girip Engine'de henüz olmayanlar
    st = lib.engine_state()
    folder_to_name = {names.loose_key(G.genre_folder_name(gm.get(n) or n)): n for n in names_}
    add = defaultdict(int)
    for fid, rel in targets.items():
        parts = names.split_rel(rel)
        n = folder_to_name.get(names.loose_key(parts[1])) if len(parts) > 1 else None
        if n and not st["by_file"].get(fid):
            add[n] += 1
    genres = [{"name": n, "folder": G.genre_folder_name(gm.get(n) or n), "count": stats.get("g:" + n, 0),
               "to_engine": add.get(n, 0), "color": G.GENRE_COLORS.get(n) or "#64748b"} for n in names_]
    return {"root": root_rel, "folders": prop["folders"], "genres": genres, "assign": eff,
            "engine_tracks": len(st["tracks"]),
            "moves": len(targets), "spread": stats.get("spread", 0), "ignore": stats.get("ignore", 0),
            "stay": stats.get("stay", 0), "canon": [{"name": n, "color": c} for n, c, _t, _s in G.CANON],
            "sample": [{"from": names.display(lib.catalog.file(fid)["rel"]), "to": names.display(rel)}
                       for fid, rel in list(targets.items())[:40]]}


def setup_apply(lib, root_name="Müzik", overrides=None, genre_map=None, extra_genres=(), progress=None,
                engine_off=()):
    """Tür klasörlerini oluşturur ve şarkıları taşır. Tek işlem; 'Geri al' her şeyi eski yerine koyar."""
    root_rel = names.minimal_fix_component(root_name or "Müzik", False)
    with lib.lock:
        prop, targets, stats = _setup_targets(lib, root_rel, overrides, genre_map)
        eff = G.effective_assignments(prop["folders"], overrides or {})
        # yalnızca şarkı alan türler + kullanıcının ayrıca seçtikleri
        used = sorted({k[2:] for k, v in stats.items() if k.startswith("g:") and v} | set(extra_genres or ()),
                      key=lambda n: (G.DISPLAY_ORDER.index(n) if n in G.DISPLAY_ORDER else 99, n))
        op = journal.Op(lib, "kurulum", "Düzen kuruldu: %d şarkı tür klasörlerine taşındı" % len(targets))
        try:
            return _setup_apply(lib, op, root_rel, used, eff, targets, stats, genre_map, progress, set(engine_off or ()))
        except Exception:
            journal.apply_inverse(lib, op.steps, force=True)
            lib.bump()
            raise


def _setup_apply(lib, op, root_rel, used, eff, targets, stats, genre_map, progress, engine_off=frozenset()):
    cat = lib.catalog
    old_root = lib.music_root()
    if old_root != root_rel:
        op.add({"k": "meta", "key": "music_root", "old": old_root or None})
        cat.set_meta("music_root", root_rel)
    _ensure_dir(lib, root_rel, op)
    existing = {names.loose_key(g["rel"]): g for g in lib.genre_rows()}
    pos = len(existing)
    for name in used:
        dname = G.genre_folder_name((genre_map or {}).get(name) or name)
        rel = root_rel + "/" + dname
        if names.loose_key(rel) in existing:
            continue
        _ensure_dir(lib, rel, op)
        gid = cat.genre_add(rel, pos=pos, color=G.GENRE_COLORS.get(name), engine=0 if name in engine_off else 1)
        pos += 1
        op.add({"k": "genre", "op": "add", "id": gid})
    rules = cat.folder_rules()
    for rel, a in eff.items():
        want = "ignore" if a == "ignore" else None
        parent = _parent(rel)
        if want and eff.get(parent) == "ignore":
            continue  # üst klasör zaten dokunulmaz
        if rules.get(rel) != want and (want or rel in rules):
            op.add({"k": "rule", "rel": rel, "old": rules.get(rel)})
            cat.set_folder_rule(rel, want)
    lib.bump()
    res = move_files(lib, targets, op.title, kind="kurulum", progress=progress, op=op,
                     protect=[root_rel])
    if progress:
        progress(0.88, "Engine koleksiyonu güncelleniyor…")
    res["maint"] = _maint(lib, op)
    res["journal"] = op.commit()
    res["genres"] = len(used)
    res["spread"] = stats.get("spread", 0)
    return res
