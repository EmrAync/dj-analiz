"""Dosya ve klasör taşıma / yeniden adlandırma, türler (bölümler) ve ilk kurulum.

Her taşıma tek bir işlemdir ve 'Geri al' ile tamamen geri döner:
  * Dosya aynı SSD içinde yeniden adlandırılır (kopyalama yok, anlıktır).
  * Programın kataloğu, Engine kütüphanesi (SSD'deki ve varsa bilgisayardaki) ve Serato
    (database V2 + crate'ler) AYNI ANDA yeni yola çevrilir; Engine'deki analiz, cue ve listeler korunur.
  * Mac'in bıraktığı '._' yardımcı dosyaları dosyayla birlikte taşınır; boşalan klasörler kaldırılır
    (içinde yalnızca .DS_Store gibi çöp kaldıysa o çöp karantinaya taşınır, silinmez).
  * Serato yolları her seferinde diskten TAZE okunur (Serato'da sonradan eklenen kayıtlar da gelir), Mac / Windows
    yazımı korunur; aynalı crate bağları yenilenir (ayna bunu "Serato'da değişti" sanmaz).
  * batch_rename: çok sayıda dosya + klasör adı tek işlemde, veritabanı başına tek yedekle (Araçlar > Adlar,
    Sağlık > ad düzeltme, klasör / tür adı değiştirme hep bunu kullanır).
"""
from __future__ import annotations

import os
from collections import defaultdict

from . import engine, genres as G, journal, names, serato, util

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
    """Yazmadan hemen önce: Engine DJ / Serato açık mı? (taze denetim; önbellekteki eski sonuç kullanılmaz)"""
    if need_engine and lib.engine_open(fresh=True):
        raise _err("Engine DJ açık. Bu değişiklik için Engine DJ'i kapatın (açıkken yapılan değişiklik Engine "
                   "tarafından ezilebilir).", "engine_open")
    if need_serato and lib.serato_open(fresh=True):
        raise _err("Serato açık. Bu değişiklik için Serato'yu kapatın.", "serato_open")


# ---------------------------------------------------------------------------
# Engine / Serato referansları
# ---------------------------------------------------------------------------
class DirMap:
    """Yeniden adlandırılan klasörler: eski yol -> son yol. Engine / Serato'daki yollar (ayrık harf, büyük/küçük
    harf farkı olsa da) parça parça gevşek anahtarla eşlenir; en derindeki eşleşme kullanılır."""

    def __init__(self, pairs):
        self.by_key = {}
        self.depth = 0
        for old, new in pairs:
            parts = names.split_rel(old)
            self.by_key[names.loose_key(old)] = names.split_rel(new)
            self.depth = max(self.depth, len(parts))

    def __bool__(self):
        return bool(self.by_key)

    def apply(self, rel):
        """Klasörü yeniden adlandırılan bir dosya yolunun yeni hâli; altında değilse None."""
        if not self.by_key or not rel:
            return None
        parts = names.split_rel(rel)
        for k in range(min(len(parts) - 1, self.depth), 0, -1):
            hit = self.by_key.get(names.loose_key("/".join(parts[:k])))
            if hit is not None:
                return "/".join(hit + parts[k:])
        return None


def _under(rel, d):
    """rel, d klasörünün kendisi ya da altındaysa kalan parçalar (liste), değilse None (gevşek karşılaştırma)."""
    parts, dp = names.split_rel(rel), names.split_rel(d)
    if len(parts) < len(dp) or not dp:
        return None
    if names.loose_key("/".join(parts[:len(dp)])) != names.loose_key(d):
        return None
    return parts[len(dp):]


def _engine_rows(lib, fids, dmap=None, stale=None):
    """{db_key: {'d': d, 'rows': {fid: [(tid, path)]}, 'prefix': [(tid, path, rel)]}}

    rows: taşınacak / adı değişecek dosyaların Engine kayıtları. prefix: yeniden adlandırılan bir klasörün içinde
    olup kataloğa henüz girmemiş (taranmamış) ya da kayıp dosyaların kayıtları — klasörle birlikte giderler.
    stale (sözlük): verilirse Engine'deki BÜTÜN kayıtların yol anahtarı -> kanıt listesi eklenir (stale_ref_keys)."""
    out = {}
    want = set(fids)
    for d in lib.engine_dbs():
        try:
            data = engine.read(d["path"])
        except Exception:
            continue
        tracks, by_file, orphans, _r, _t = lib.engine_map(d, data)
        if stale is not None:
            for t in data["tracks"]:
                rel = engine.path_to_rel(t.get("path") or "", d["lib_dir"], lib.root)
                if rel:
                    stale.setdefault(names.loose_key(rel), []).append(engine_evidence(t))
        rows = {}
        for fid in want:
            if by_file.get(fid):
                rows[fid] = [(tid, tracks[tid].get("path") or "") for tid, _m in by_file[fid]]
        prefix = []
        if dmap:
            for tid, rel, _m in orphans:
                if rel and dmap.apply(rel) is not None:
                    prefix.append((tid, tracks[tid].get("path") or "", rel))
        if rows or prefix:
            out[d["key"]] = {"d": d, "rows": rows, "prefix": prefix}
    return out


def _dialect(lib, sx):
    pref = lib.prefs().get("serato_dialect", "auto")
    if pref in ("mac", "windows"):
        return pref
    return (sx or {}).get("dialect") or ("mac" if util.IS_MAC else "windows")


def _serato_hits(sx, rels, dmap=None):
    """Serato'da bu yollara (ya da yeniden adlandırılan klasörlerin içine) işaret eden kayıt var mı?"""
    if not sx or not sx["raws"]:
        return False
    for rel in rels:
        if sx["by_mkey"].get(names.match_key(rel)) or sx["by_lkey"].get(names.loose_key(rel)):
            return True
    if dmap:
        for raw in sx["raws"]:
            if dmap.apply(raw) is not None:
                return True
    return False


def _serato_mapping(lib, sx, changes, dmap=None):
    """{eski_ham_yol: yeni_ham_yol}. Diskten TAZE okunan dizinden (Serato'da sonradan eklenenler de dahil);
    yazım (Mac: ayrık harf + ':' / Windows: disk biçimi) her kayıtta korunur. Yeni yol database V2'de zaten
    kayıtlıysa onun yazımı kullanılır (Serato aynı şarkıyı iki kez tanımasın)."""
    dialect = _dialect(lib, sx)
    mapping = {}
    for _fid, old, new in changes:
        hits = set(sx["by_mkey"].get(names.match_key(old), ())) | set(sx["by_lkey"].get(names.loose_key(old), ()))
        if not hits:
            continue
        target = sx["db_by_mkey"].get(names.match_key(new))
        for raw in hits:
            mapping[raw] = target or serato.raw_for(raw, old, new, dialect)
    if dmap:
        for raw in sx["raws"]:
            if raw in mapping:
                continue
            rel = names.to_disk_form(raw, True)
            final = dmap.apply(rel)
            if final is None:
                continue
            mapping[raw] = sx["db_by_mkey"].get(names.match_key(final)) or serato.raw_for(raw, rel, final, dialect)
    return {k: v for k, v in mapping.items() if k != v}


def _crate_member(sdir, stem):
    return os.path.relpath(os.path.join(serato._subcrates_dir(sdir), stem + ".crate"), sdir).replace(os.sep, "/")


def _refresh_mirror_links(lib, sdir, before, after, op):
    """Program bir aynalı crate'in yollarını kendisi değiştirdiyse, bağın son özeti yenilenir: aksi hâlde ayna
    bunu 'Serato'da değişti' sanıp ayrı bir işlem kaydeder ve 'Geri al' o işlemi geri alırdı."""
    import json as _json
    n = 0
    for r in lib.catalog.q("SELECT db, pid, crate, last_hash, last_refs, dirty FROM serato_link"):
        if not r["crate"]:
            continue
        m = _crate_member(sdir, r["crate"])
        if m not in before or before.get(m) == after.get(m) or after.get(m) is None:
            continue
        if r["last_hash"] != before[m]:
            continue          # Serato'da zaten değişmişti: o değişiklik aynanın kendi yoluyla alınsın
        lr = _json.loads(r["last_refs"]) if r["last_refs"] else None
        op.add({"k": "serlink", "db": r["db"], "pid": r["pid"], "old": {"crate": r["crate"], "last_hash": r["last_hash"],
                                                                         "last_refs": lr, "dirty": r["dirty"] or 0}})
        lib.catalog.set_serato_link(r["db"], r["pid"], r["crate"], after[m], lr, r["dirty"] or 0)
        n += 1
    return n


def serato_rewrite(lib, sdir, sx, mapping, op, backup=None, label="tasima"):
    """Serato yollarını tek seferde değiştirir ve geri alma adımını kaydeder.
    Eşleme bire birse ve hedefler Serato'da önceden yoksa 'ser' (tersine eşleme), değilse 'sersnap' (yedekten
    yalnızca değişen dosyalar). Aynalı crate bağları yenilenir. -> istatistik"""
    if not mapping:
        return {"entries": 0, "files": [], "mirror_links": 0}
    if backup is None:
        backup = serato.backup(sdir, lib.backup_dir("serato"), label)
        _prune(lib.backup_dir("serato"), "serato_", ".zip", 12)
    members = serato.backup_members(backup)
    before = serato.state_fp(sdir, members)
    vals = list(mapping.values())
    pre_db = {v for v in vals if v in sx["db"] and v not in mapping}
    pre_any = {v for v in vals if v in sx["raws"] and v not in mapping}
    dedupe = bool(pre_db)
    try:
        st = serato.rewrite_paths(sdir, mapping, dedupe=dedupe)
    except Exception:
        # yarıda kaldı: değişen dosyalar yedekten geri yazılır (Serato yarım bir hâlde kalmasın)
        now = serato.state_fp(sdir, members)
        serato.restore_backup(sdir, backup, only={m for m, h in now.items() if before.get(m) != h})
        raise
    after = serato.state_fp(sdir, members)
    changed = {m: h for m, h in after.items() if before.get(m) != h}
    if len(set(vals)) == len(vals) and not pre_any and not dedupe:
        op.add({"k": "ser", "map": dict(mapping)})
    elif changed:
        op.add({"k": "sersnap", "backup": backup, "hashes": changed})
    links = _refresh_mirror_links(lib, sdir, before, after, op)
    return {"entries": st.get("crate_entries", 0) + st.get("db_changed", 0), "files": st.get("files", []),
            "mirror_links": links, "removed": st.get("db_removed", 0)}


def _update_refs(lib, changes, eng, sx, op, dmap=None, sbk=None):
    """changes: [(fid, eski_rel, yeni_rel)] — katalog zaten güncel. Engine ve Serato'yu yeni yola çevirir.
    Engine'de hedef yolda başka bir kayıt varsa (çakışma) atlanmaz, raporlanır."""
    res = {"engine": 0, "engine_clash": [], "serato": 0, "mirror_links": 0, "_serato_map": {}}
    for key, info in eng.items():
        d = info["d"]
        w = engine.Writer(d["path"], d["lib_dir"], lib.root)
        try:
            def setp(tid, oldp, new_rel):
                newp = engine.repath(oldp, None, new_rel, d["lib_dir"], lib.root)
                r = w.track_set_path(tid, newp, expect=oldp)
                if r == "ok":
                    res["engine"] += 1
                elif r == "cakisma":
                    res["engine_clash"].append({"db": key, "tid": tid, "path": newp, "old": oldp})
            for fid, _old, new in changes:
                for tid, oldp in info["rows"].get(fid, []):
                    setp(tid, oldp, new)
            if dmap:
                for tid, oldp, rel in info.get("prefix") or []:
                    final = dmap.apply(rel)
                    if final is not None:
                        setp(tid, oldp, final)
            w.commit()
        except Exception:
            w.rollback()
            raise
        op.add_engine(w, key)
    sdir = lib.serato_dir()
    if sdir and sx and sx["raws"]:
        mapping = _serato_mapping(lib, sx, changes, dmap)
        if mapping:
            st = serato_rewrite(lib, sdir, sx, mapping, op, backup=sbk)
            res["serato"] = st["entries"]
            res["mirror_links"] = st["mirror_links"]
            res["_serato_map"] = mapping
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
                journal.set_rel(lib, row["id"], dst_rel)
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
        sdir = lib.serato_dir()
        sx = serato.index(sdir) if sdir else None          # diskten taze (Serato'da sonradan eklenenler de)
        s_need = _serato_hits(sx, [files[fid]["rel"] for fid in moves])
        _check_apps(lib, bool(eng), s_need)
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
                        journal.set_rel(lib, fid, new)
                        cat.add_history(f["rel"], fid)
                        changes.append((fid, f["rel"], new))
                        src_dirs[f.get("folder") or ""].add(_parent(new))
                        if progress and (i % 25 == 0 or i == total - 1):
                            progress(0.05 + 0.55 * (i + 1) / max(1, total), "Taşınıyor (%d/%d)…" % (i + 1, total))
            if progress:
                progress(0.62, "Engine ve Serato güncelleniyor…")
            _check_apps(lib, bool(eng), s_need)    # dosyalar taşınırken açılmış olabilir: yazmadan hemen önce yine bak
            res = _update_refs(lib, changes, eng, sx if s_need else None, op)
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
        if s_need:
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
    """Klasörü yeniden adlandırır (içindeki her şey yerinde kalır; Engine/Serato yolları, tür ve kural kayıtları
    birlikte güncellenir). Toplu adlandırmanın tek klasörlük hâlidir."""
    rel = "/".join(names.split_rel(rel or ""))
    if not rel:
        raise _err("Klasör seçilmedi.")
    new_name = names.minimal_fix_component((new_name or "").strip(), False)
    if not new_name or new_name == "adsiz":
        raise _err("Yeni ad boş olamaz.")
    parent = _parent(rel)
    new_rel = (parent + "/" + new_name) if parent else new_name
    if new_rel == rel:
        return {"renamed": 0}
    if not os.path.isdir(lib.rootinfo.os_path(rel)):
        raise _err("Klasör bulunamadı: %s" % names.display(rel))
    if names.loose_key(rel) != names.loose_key(new_rel) and os.path.exists(lib.rootinfo.os_path(new_rel)):
        raise _err("Bu adda bir klasör zaten var: %s" % names.display(new_name), "exists")
    title = "Klasör adı: %s → %s" % (names.display(names.split_rel(rel)[-1]), new_name)
    res = batch_rename(lib, {}, {rel: new_name}, title, kind=kind, progress=progress, op=op)
    if not res["dirs"]:
        why = res["skipped"][0]["why"] if res["skipped"] else ""
        if why == "exists":
            raise _err("Bu adda bir klasör zaten var: %s" % names.display(new_name), "exists")
        raise _err("Klasör adı değiştirilemedi.")
    res.update({"renamed": 1, "new_rel": new_rel})
    return res


# ---------------------------------------------------------------------------
# Toplu yeniden adlandırma: çok sayıda dosya + klasör, TEK işlem, veritabanı başına TEK yedek
# ---------------------------------------------------------------------------
def _valid_component(new):
    new = (new or "").strip() if new else ""
    if not new or new.startswith(".") or "/" in new or "\\" in new or any(ord(c) < 32 for c in new):
        return None                 # '.x' / '._x': gizli dosya ya da Mac çöpü sayılır (kütüphaneden kaybolur)
    return new


def _compose(d, done):
    """Klasörün son yolu: kendisinin ve üst klasörlerinin yeni adları uygulanmış hâli."""
    parts = names.split_rel(d)
    out = []
    for i in range(1, len(parts) + 1):
        out.append(done.get("/".join(parts[:i]), parts[i - 1]))
    return "/".join(out)


class _Taken:
    """Bir klasördeki adların gevşek anahtarları, SAYILI: exFAT'te NFC ve NFD yazımlı iki ad (ikiz) yan yana
    durabilir; biri yeniden adlandırılınca diğeri o anahtarı hâlâ doldurur."""

    def __init__(self, keys=()):
        self.n = defaultdict(int)
        for k in keys:
            self.n[k] += 1

    def __contains__(self, k):
        return self.n.get(k, 0) > 0

    def add(self, k):
        self.n[k] += 1

    def discard(self, k):
        if self.n.get(k, 0) > 1:
            self.n[k] -= 1
        else:
            self.n.pop(k, None)


class _NameCheck:
    """'ad in taken' denetimi için: fn(gevşek_anahtar, ad) -> dolu mu?"""

    def __init__(self, fn):
        self.fn = fn

    def check(self, cand):
        return self.fn(names.loose_key(cand), cand)


def _free_name(name, taken, is_file):
    stem, ext = os.path.splitext(name) if is_file else (name, "")
    k = 2
    while True:
        cand = "%s (%d)%s" % (stem, k, ext)
        if not (taken.check(cand) if isinstance(taken, _NameCheck) else names.loose_key(cand) in taken):
            return cand
        k += 1


def _dir_ref_taken(lib, stale, d, new_name, dirs):
    """Klasör 'd' 'new_name' olursa içindeki bir dosyanın SON yolunda (üst klasörlerin planlanan adlarıyla) başka bir
    şarkının eski Engine / Serato kaydı var mı? (alt klasörler önceden adlandırıldıysa katalogdaki yol günceldir)"""
    parent = _parent(d)
    fp = _compose(parent, dirs) if parent else ""
    base = names.split_rel(fp) + [new_name]
    pre = d + "/"
    for r in lib.catalog.q("SELECT id, rel, qsig, alen, size, duration, title, artist FROM files WHERE present=1 "
                           "AND rel LIKE ? ESCAPE '\\'", (_like(pre),)):
        if r["rel"].startswith(pre):
            final = "/".join(base + names.split_rel(r["rel"][len(pre):]))
            if ref_taken(lib, stale, final, r["rel"], r):
                return True
    return False


def _fs_rename_dir(lib, cur, new_rel, op):
    """Klasörü yeniden adlandırır, katalogdaki yolları ve geçmişi günceller. -> [[fid, eski, yeni], ...]"""
    cat = lib.catalog
    src, dst = lib.rootinfo.os_path(cur), lib.rootinfo.os_path(new_rel)
    util.safe_rename(src, dst)
    pre = cur + "/"
    rows = [r for r in cat.q("SELECT id, rel FROM files WHERE present=1 AND rel LIKE ? ESCAPE '\\'", (_like(pre),))
            if r["rel"].startswith(pre)]
    ch = []
    for b in range(0, len(rows), 400):
        with cat.tx():
            for r in rows[b:b + 400]:
                nr = new_rel + r["rel"][len(cur):]
                journal.set_rel(lib, r["id"], nr)
                cat.add_history(r["rel"], r["id"])
                ch.append([r["id"], r["rel"], nr])
    op.add({"k": "mvdir", "old": cur, "new": new_rel, "files": ch})
    # Mac'in klasör için bıraktığı '._Ad' yardımcı dosyası da ada uysun
    comp = os.path.join(os.path.dirname(src), "._" + os.path.basename(src))
    cdst = os.path.join(os.path.dirname(dst), "._" + os.path.basename(dst))
    if os.path.isfile(comp) and not os.path.lexists(cdst):
        try:
            util.safe_rename(comp, cdst)
            orel, nrel = _rel_of(lib, comp), _rel_of(lib, cdst)
            row = cat.file_by_rel(orel)
            if row:
                journal.set_rel(lib, row["id"], nrel)
            op.add({"k": "mv", "fid": row["id"] if row else None, "old": orel, "new": nrel})
        except OSError:
            pass
    return ch


def _retarget_meta(lib, old, new, op):
    """Klasör adı değişti: tür kayıtları, klasör kuralları ve ana müzik klasörü yeni yolu göstersin."""
    cat = lib.catalog
    n = 0
    newp = names.split_rel(new)
    gens = cat.genres()
    # taşınmayan başka bir tür zaten o yolu gösteriyorsa (ör. Finder'da iki tür klasörü birleştirilmiş) o tür
    # kaydı olduğu gibi kalır: iki tür aynı klasörü göstermesin
    others = {names.loose_key(g["rel"]) for g in gens if _under(g["rel"], old) is None}
    for g in gens:
        rest = _under(g["rel"], old)
        if rest is not None:
            nr = "/".join(newp + rest)
            if nr != g["rel"] and names.loose_key(nr) not in others:
                kw = {"rel": nr}
                if not g.get("color"):          # rengi addan geliyordu: yeni adla değişmesin
                    oname = names.display(names.split_rel(g["rel"])[-1])
                    kw["color"] = G.GENRE_COLORS.get(oname) or "#64748b"
                op.add({"k": "genre", "op": "upd", "id": g["id"], "old": {k: g.get(k) for k in kw}})
                cat.genre_update(g["id"], **kw)
                n += 1
    for r0, act in cat.folder_rules().items():
        rest = _under(r0, old)
        if rest is not None:
            nr = "/".join(newp + rest)
            if nr != r0:
                op.add({"k": "rule", "rel": r0, "old": act})
                cat.set_folder_rule(r0, None)
                op.add({"k": "rule", "rel": nr, "old": cat.folder_rules().get(nr)})
                cat.set_folder_rule(nr, act)
                n += 1
    mr = lib.music_root()
    if mr:
        rest = _under(mr, old)
        if rest is not None:
            nr = "/".join(newp + rest)
            if nr != mr:
                op.add({"k": "meta", "key": "music_root", "old": mr})
                cat.set_meta("music_root", nr)
                n += 1
    return n


def batch_rename(lib, file_names, dir_names, title, kind="toplu_ad", progress=None, op=None, maint=True,
                 on_exists="skip", suffix=()):
    """Çok sayıda dosya ve klasörü TEK işlemde yeniden adlandırır.

    file_names: {fid: yeni_ad} (aynı klasörde kalır), dir_names: {klasör_rel: yeni_ad}.
    * Önce dosyalar, sonra klasörler (en derinden başlayarak); büyük/küçük harf ve NFD->NFC değişiklikleri
      exFAT'te güvenli ara adla yapılır, var olan bir dosyanın üstüne asla yazılmaz.
    * Engine (SSD + varsa bilgisayardaki) ve Serato (database V2 + bütün crate'ler, diskten taze okunur) birlikte
      güncellenir; klasörün içindeki taranmamış / kayıp kayıtlar da klasörle gider. Her veritabanı için TEK yedek.
    * Tür, kural ve ana klasör kayıtları yeni yolu gösterir; aynalı crate bağları yenilenir.
    * Hedef doluysa: on_exists='skip' atlar (raporlar), 'suffix' ya da suffix kümesindeki öğe ' (2)' ekler.
    -> {'files','dirs','skipped':[{'id','why'}],'engine','engine_clash':[...],'serato','mirror_links','genres',
        'changes','verify':{...},'journal','maint'}"""
    cat = lib.catalog
    own_op = op is None
    op = op or journal.Op(lib, kind, title)
    suffix = set(suffix or ())
    res = {"files": 0, "dirs": 0, "skipped": [], "engine": 0, "engine_clash": [], "serato": 0, "mirror_links": 0,
           "genres": 0, "changes": 0, "journal": None}

    def prog(r, m):
        if progress:
            progress(r, m)
    with lib.lock:
        # 1) kaynaklar
        files = {}
        for fid, new in (file_names or {}).items():
            f = cat.file(int(fid))
            if not f or not f["present"]:
                res["skipped"].append({"id": "f:%s" % fid, "why": "gone"})
                continue
            new = _valid_component(new)
            if not new:
                res["skipped"].append({"id": "f:%s" % fid, "why": "bad"})
                continue
            if new != f["name"]:
                files[f["id"]] = (f, new)
        dirs = {}
        for rel, new in (dir_names or {}).items():
            rel = "/".join(names.split_rel(rel or ""))
            parts = names.split_rel(rel)
            if not parts or names.fold(parts[0]) in PROTECT_TOP or parts[0].startswith("."):
                res["skipped"].append({"id": "d:" + rel, "why": "protected"})
                continue
            if not os.path.isdir(lib.rootinfo.os_path(rel)):
                res["skipped"].append({"id": "d:" + rel, "why": "gone"})
                continue
            new = _valid_component(new)
            if not new:
                res["skipped"].append({"id": "d:" + rel, "why": "bad"})
                continue
            if new != parts[-1]:
                dirs[rel] = new
        if not files and not dirs:
            return res
        # 2) etkilenen kayıtlar ve planlanan klasör eşlemesi
        orig = {fid: f["rel"] for fid, (f, _n) in files.items()}
        for d in dirs:
            for r in cat.q("SELECT id, rel FROM files WHERE present=1 AND rel LIKE ? ESCAPE '\\'", (_like(d + "/"),)):
                if r["rel"].startswith(d + "/"):
                    orig.setdefault(r["id"], r["rel"])
        plan_map = DirMap([(d, _compose(d, dirs)) for d in dirs])
        prog(0.03, "Engine ve Serato kayıtları okunuyor…")
        eng_ev = {}
        eng = _engine_rows(lib, orig.keys(), plan_map, eng_ev)
        sdir = lib.serato_dir()
        sx = serato.index(sdir) if sdir else None            # diskten TAZE: Serato'da sonradan eklenenler de
        s_need = _serato_hits(sx, orig.values(), plan_map)
        stale = stale_ref_keys(eng_ev, sx, {names.loose_key(r) for r in orig.values()})

        def file_ref_taken(f, parent, name):
            fp = _compose(parent, dirs) if parent else ""
            return ref_taken(lib, stale, (fp + "/" + name) if fp else name, f["rel"], f)
        # 3) güvenlik: uygulamalar kapalı, yedekler (veritabanı başına bir kez)
        _check_apps(lib, bool(eng), s_need)
        for key, info in eng.items():
            try:
                engine.preflight(info["d"]["path"])
            except engine.EngineError as e:
                raise _err(str(e), "engine_open" if lib.engine_open(fresh=True) else None)
            engine.backup(info["d"]["path"], lib.backup_dir("engine"), kind)
            engine.prune_backups(lib.backup_dir("engine"))
        sbk = None
        if s_need:
            sbk = serato.backup(sdir, lib.backup_dir("serato"), kind)
            _prune(lib.backup_dir("serato"), "serato_", ".zip", 12)
        n0 = len(op.steps)
        try:
            # 4) dosyalar (klasörler henüz eski adında)
            occ = {}

            def occupied(parent):
                if parent not in occ:
                    try:
                        ents = os.listdir(lib.rootinfo.os_path(parent) if parent else lib.root)
                    except OSError:
                        ents = []
                    occ[parent] = _Taken(names.loose_key(lib.rootinfo.canonical(e)) for e in ents)
                return occ[parent]
            todo = sorted(files.items(), key=lambda kv: kv[1][0]["rel"])
            total = max(1, len(todo))
            moved = 0
            while todo:
                later = []
                for b in range(0, len(todo), 200):
                    with cat.tx():
                        for fid, (f, new) in todo[b:b + 200]:
                            parent = _parent(f["rel"])
                            ko, kn = names.loose_key(f["name"]), names.loose_key(new)
                            if kn != ko and kn in occupied(parent):
                                later.append((fid, (f, new)))
                                continue
                            if stale and file_ref_taken(f, parent, new):
                                later.append((fid, (f, new)))   # o adda başka bir şarkının Engine / Serato kaydı var
                                continue
                            new_rel = (parent + "/" + new) if parent else new
                            try:
                                _fs_move(lib, f, new_rel, op)
                            except FileExistsError:
                                later.append((fid, (f, new)))
                                continue
                            journal.set_rel(lib, fid, new_rel)
                            cat.add_history(f["rel"], fid)
                            occupied(parent).discard(ko)
                            occupied(parent).add(kn)
                            moved += 1
                            if moved % 25 == 0:
                                prog(0.05 + 0.45 * moved / total, "Dosya adları değişiyor (%d/%d)…" % (moved, total))
                if len(later) == len(todo):
                    # kalanların hedefi dolu: ' (2)' istenmişse ekle, değilse atla
                    for fid, (f, new) in later:
                        parent = _parent(f["rel"])
                        if on_exists == "suffix" or fid in suffix:
                            occ_p = occupied(parent)
                            alt = _free_name(new, _NameCheck(lambda k, c, f=f, p=parent: k in occ_p or (
                                stale and file_ref_taken(f, p, c))), True)
                            new_rel = (parent + "/" + alt) if parent else alt
                            try:
                                _fs_move(lib, f, new_rel, op)
                            except FileExistsError:
                                res["skipped"].append({"id": "f:%d" % fid, "why": "exists"})
                                continue
                            journal.set_rel(lib, fid, new_rel)
                            cat.add_history(f["rel"], fid)
                            occupied(parent).discard(names.loose_key(f["name"]))
                            occupied(parent).add(names.loose_key(alt))
                            moved += 1
                        else:
                            why = "exists"
                            if stale and names.loose_key(new) not in occupied(parent) and \
                                    file_ref_taken(f, parent, new):
                                why = "ref_taken"
                            res["skipped"].append({"id": "f:%d" % fid, "why": why})
                    break
                todo = later
            res["files"] = moved
            # 5) klasörler: en derinden başlayarak (üst klasörler henüz eski adında)
            done = {}
            dl = sorted(dirs, key=lambda x: (-x.count("/"), x))
            for i, d in enumerate(dl):
                new = dirs[d]
                parent = _parent(d)
                ko, kn = names.loose_key(names.split_rel(d)[-1]), names.loose_key(new)
                want_sfx = on_exists == "suffix" or ("d:" + d) in suffix or d in suffix
                if kn != ko and kn in occupied(parent):
                    if want_sfx:
                        new = _free_name(new, occupied(parent), False)
                        kn = names.loose_key(new)
                    else:
                        res["skipped"].append({"id": "d:" + d, "why": "exists"})
                        continue
                if stale and kn != ko and _dir_ref_taken(lib, stale, d, new, dirs):
                    if want_sfx:
                        occ_p = occupied(parent)
                        new = _free_name(new, _NameCheck(lambda k, c: k in occ_p or _dir_ref_taken(
                            lib, stale, d, c, dirs)), False)
                        kn = names.loose_key(new)
                    else:
                        res["skipped"].append({"id": "d:" + d, "why": "ref_taken"})
                        continue
                new_rel = (parent + "/" + new) if parent else new
                try:
                    _fs_rename_dir(lib, d, new_rel, op)
                except FileExistsError:
                    res["skipped"].append({"id": "d:" + d, "why": "exists"})
                    continue
                occupied(parent).discard(ko)
                occupied(parent).add(kn)
                occ.pop(d, None)
                done[d] = new
                res["genres"] += _retarget_meta(lib, d, new_rel, op)
                prog(0.5 + 0.1 * (i + 1) / len(dl), "Klasör adları değişiyor (%d/%d)…" % (i + 1, len(dl)))
            res["dirs"] = len(done)
            # 6) Engine ve Serato
            cur = {}
            ids = list(orig)
            for b in range(0, len(ids), 900):
                chunk = ids[b:b + 900]
                for r in cat.q("SELECT id, rel FROM files WHERE id IN (%s)" % ",".join("?" for _ in chunk), chunk):
                    cur[r["id"]] = r["rel"]
            changes = [(fid, orig[fid], cur[fid]) for fid in ids if cur.get(fid) and cur[fid] != orig[fid]]
            dmap = DirMap([(d, _compose(d, done)) for d in done])
            res["changes"] = len(changes)
            prog(0.62, "Engine ve Serato güncelleniyor…")
            _check_apps(lib, bool(eng), s_need)    # adlar değişirken açılmış olabilir: yazmadan hemen önce yine bak
            r = _update_refs(lib, changes, eng, sx if s_need else None, op, dmap=dmap, sbk=sbk)
            mapping = r.pop("_serato_map", {})
            res.update(r)
        except Exception:
            # yarım kalmasın: bu işlemde yapılan her şeyi geri al
            journal.apply_inverse(lib, op.steps[n0:], force=True)
            del op.steps[n0:]
            lib.bump()
            raise
        lib.bump()
        try:                    # yalnızca okuma / denetim: bir hata işlemin günlüğe yazılmasını (Geri al) engellemesin
            if s_need or changes:
                lib.analyze_serato()
            res["verify"] = _verify(lib, eng, changes, dmap, mapping)
        except Exception as e:
            res["verify"] = {"error": str(e)}
        if own_op:
            if maint:
                prog(0.85, "Engine koleksiyonu güncelleniyor…")
                res["maint"] = _maint(lib, op)
            res["journal"] = op.commit()
        prog(1.0, "Tamamlandı")
        return res


def _verify(lib, eng, changes, dmap, mapping):
    """Son denetim: güncellenen Engine kayıtları ve Serato yolları diskteki dosyayı buluyor mu?"""
    from .resolver import Resolver
    out = {"engine_missing": 0, "serato_missing": 0}
    if not eng and not mapping:
        return out
    rs = Resolver(lib.catalog, lib.root)

    def found(rel):
        f, m = rs.resolve(rel)
        if f and f["present"] and m in ("exact", "case", "unicode", "sfm"):
            return True
        for form in {rel, names.nfc(rel), names.to_disk_form(rel, True)}:      # taranmamış ama diskte
            if os.path.exists(lib.rootinfo.os_path(form)):
                return True
        return False
    for raw in set(mapping.values()):
        if not found(raw):
            out["serato_missing"] += 1
    want = {fid for fid, _o, _n in changes}
    for _key, info in eng.items():
        d = info["d"]
        try:
            data = engine.read(d["path"])
        except Exception:
            continue
        tids = {tid for fid in want for tid, _p in info["rows"].get(fid, [])}
        tids |= {tid for tid, _p, _r in info.get("prefix") or []}
        for t in data["tracks"]:
            if t["id"] not in tids:
                continue
            rel = engine.path_to_rel(t.get("path") or "", d["lib_dir"], lib.root)
            if not rel or not found(rel):
                out["engine_missing"] += 1
    return out


def _like(prefix):
    return prefix.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


def engine_evidence(t):
    """Bir Engine kaydının hangi şarkı olduğuna dair kanıt: (boyut, başlık, sanatçı, süre)."""
    return (t.get("fileBytes"), t.get("title"), t.get("artist"), t.get("length"))


def stale_ref_keys(eng_ev, sx, moving_keys):
    """Engine ve Serato'daki yollar -> kanıt listesi [(boyut, başlık, sanatçı, süre)]; bu işlemde taşınan / adı
    değişen dosyalarınkiler hariç. Diskte BOŞ olan bir hedef yol burada varsa oradaki kayıt başka (kaybolmuş ya da
    katalogda bayat kalmış) bir şarkınındır: dosya oraya adlandırılırsa Engine'de o şarkının cue'larıyla, Serato
    crate'lerinde o şarkı yerine bu dosya çalar (yanlış şarkı)."""
    out = {k: list(v) for k, v in (eng_ev or {}).items()}
    if sx and sx["raws"]:
        for k, raws in sx["by_lkey"].items():
            for raw in raws:
                info = sx["db"].get(raw) or {}
                out.setdefault(k, []).append((None, info.get("title"), info.get("artist"), info.get("dur")))
    for k in moving_keys or ():
        out.pop(k, None)
    return out


def _same_song(ev, f):
    """Kanıt bu dosya için ne diyor? True: aynı şarkı (aynı bayt boyutu ya da aynı başlık + sanatçı, süre de
    tutuyorsa), False: başka şarkı (başlık ve sanatçı belli ve ikisi de farklı), None: bilinmiyor."""
    size, title, artist, dur = ev
    if size and f.get("size") and int(size) == int(f["size"]):
        return True
    if title and artist and f.get("title") and f.get("artist"):
        t_ok = names.fold(title) == names.fold(f["title"])
        a_ok = names.fold(artist) == names.fold(f["artist"])
        if t_ok and a_ok:
            try:
                return not (dur and f.get("duration")) or abs(float(dur) - float(f["duration"])) <= 2.0
            except (TypeError, ValueError):
                return True
        if not t_ok and not a_ok:
            return False
    return None


def ref_taken(lib, stale, final, current, f):
    """'final' yolunda BAŞKA bir şarkının Engine / Serato kaydı var mı? Yalnızca harf biçimi / büyük-küçük harf
    değişiyorsa kendi kaydıdır. O yolun eski katalog satırı aynı sesi gösteriyorsa ya da kayıtlar boyut / başlık +
    sanatçı ile bu şarkıyı gösteriyorsa (eski yerine dönüyor) kayıtlar bu dosyanındır ve bağlanır."""
    k = names.loose_key(final)
    evs = stale.get(k)
    if not evs or k == names.loose_key(current):
        return False
    if f.get("qsig"):
        for r in lib.catalog.q("SELECT qsig, alen FROM files WHERE lkey=? AND id<>? AND qsig IS NOT NULL",
                               (k, f.get("id") or 0)):
            if r["qsig"] == f["qsig"] and r["alen"] == f.get("alen"):
                return False
    said = [_same_song(ev, f) for ev in evs]
    return not (True in said and False not in said)       # en az bir kanıt aynı şarkı diyor, hiçbiri başka demiyor


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
