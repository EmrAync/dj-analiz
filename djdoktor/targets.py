"""Çalışma yeri ve hedefler: kütüphaneyi Engine DJ / Prime 4 / Serato'nun okuyacağı bir sürücüye (ya da yedek
klasörüne) DOĞRU yapıyla aktarmak.

Neden gerekli: Engine DJ ve Prime 4 bir kütüphaneyi yalnızca SÜRÜCÜNÜN KÖKÜNDEKİ "Engine Library" klasöründen tanır.
Kütüphane masaüstündeki bir klasördeyse ya da kart / USB'ye "klasörüyle birlikte" kopyalanırsa (Kart:/klasör/Engine
Library) Engine onu görmez. Serato da crate yollarını sürücü köküne göre tutar. Bu modül:

  check_location(path)   — bir yerin durumu ve sorunları (kök mü, Engine / Serato var mı, alt klasörde mi kalmış,
                           dosya sistemi, boş yer, yabancı bir kütüphane var mı …)
  library_location(lib)  — çalışma yerinin kısa durumu (uyarı şeridi için)
  plan(lib, target)      — aktarım planı: kopyalanacak / değişen / kenara alınacak dosyalar, gereken yer, engeller
  export(lib, target)    — planı uygular (görev): yalnızca yeni ve değişen dosyalar; geçici adla yazılır, sonra
                           yerine konur; veritabanları SQLite yedekleme ile tutarlı kopyalanır; kaynakta artık
                           olmayan eski kopyalar hedefte _DJDoktor_/Karantina'ya taşınır (silinmez); yarıda kalırsa
                           sonraki aktarım kaldığı yerden sürer (hedefte _DJDoktor_/hedef.json).

Kurallar: kaynak hiçbir zaman değiştirilmez. Hedefte BİZİM koymadığımız bir dosyanın üstüne yazılmaz (çakışma olarak
raporlanır). Engine DJ / Serato açıkken aktarılmaz. Hedefte başka bir kütüphanenin "Engine Library" ya da "_Serato_"
klasörü varsa aktarım durur; kullanıcı isterse o klasörler silinmeden "… (eski <tarih>)" adıyla kenara alınır.
"""
from __future__ import annotations

import os
import shutil
import sqlite3
import time

from . import engine, names, serato, util
from .ext import route
from .library import UserError

ENGINE_DIR = "Engine Library"
SERATO_DIR = "_Serato_"
STATE_DIR = "_DJDoktor_"
MANIFEST = "hedef.json"
# kaynaktan aktarılmayan klasörler (küçük harf, katlanmış ad)
SKIP_DIRS = {"_djdoktor_karantina", "$recycle.bin", "system volume information", ".trashes", ".spotlight-v100",
             ".fseventsd", ".temporaryitems", ".documentrevisions-v100", ".trash", "recycler", "_serato_backup",
             "dj gelen", "dj arşiv", "dj arsiv"}
SKIP_FILES = {".ds_store", "thumbs.db", "desktop.ini"}
DB_EXT = (".db",)
FAT32_MAX = 4 * 1024 ** 3 - 1


def _err(msg, code=None):
    return UserError(msg, code)


def is_drive_root(path):
    try:
        p = os.path.abspath(path)
        return os.path.ismount(p) or (util.IS_WIN and len(p.rstrip("\\/")) == 2 and p[1] == ":")
    except (OSError, ValueError):
        return False


def _drive_of(path):
    """Yolun bulunduğu sürücünün kökü."""
    p = os.path.abspath(path)
    while not is_drive_root(p):
        q = os.path.dirname(p)
        if q == p:
            break
        p = q
    return p


def _has_engine(p):
    return os.path.isfile(os.path.join(p, ENGINE_DIR, "Database2", "m.db"))


def find_nested(root, depth=3, limit=6):
    """Kökün altındaki klasörlerde kalmış Engine kütüphaneleri (ör. Kart:/melis_dj_muzik/Engine Library)."""
    out = []
    stack = [(root, 0)]
    while stack and len(out) < limit:
        p, d = stack.pop()
        try:
            ents = [e for e in os.scandir(p) if e.is_dir(follow_symlinks=False)]
        except OSError:
            continue
        for e in ents:
            n = names.fold(e.name)
            if n.startswith(".") or n.startswith("$") or n in SKIP_DIRS or n in ("_djdoktor_", "engine library"):
                continue
            if _has_engine(e.path):
                out.append(e.path)
            elif d + 1 < depth:
                stack.append((e.path, d + 1))
    return out


def _manifest(path):
    return util.read_json(os.path.join(path, STATE_DIR, MANIFEST), None)


def _fs_note(fs):
    if fs in ("exfat",):
        return None
    if fs in ("msdos", "fat", "fat32", "vfat", "fat16"):
        return ("warn", "fat32", "Dosya sistemi FAT32: 4 GB'tan büyük dosyalar kopyalanamaz. Mümkünse exFAT kullan.")
    if fs == "ntfs":
        return ("warn", "ntfs", "Dosya sistemi NTFS: Mac'te Serato bu sürücüye yazamaz. Mac + PC + Prime 4 için exFAT önerilir.")
    if fs in ("apfs", "hfs", "hfsplus"):
        return ("warn", "macfs", "Dosya sistemi Mac'e özel (%s): Windows'taki Engine DJ bu sürücüyü okuyamaz. exFAT önerilir." % fs)
    return None


def check_location(path, lib=None, role="target"):
    """Bir yerin durumu. role: 'target' (aktarım hedefi) | 'library' (çalışma yeri).
    -> {path, drive, drive_root, fs, free, engine, serato, ours, nested, problems: [{level, code, text}]}"""
    p = os.path.abspath(path or "")
    probs = []
    add = lambda level, code, text: probs.append({"level": level, "code": code, "text": text})  # noqa: E731
    info = {"path": p, "drive": _drive_of(p) if p else "", "drive_root": is_drive_root(p), "fs": "", "free": None,
            "engine": False, "serato": False, "ours": False, "nested": [], "problems": probs}
    if not p or not os.path.isdir(p):
        add("block", "missing", "Bu yer bulunamadı (sürücü takılı değil olabilir).")
        return info
    info["fs"] = util.fs_type(p)
    info["free"] = util.free_space(p)
    info["engine"] = _has_engine(p)
    info["serato"] = os.path.isdir(os.path.join(p, SERATO_DIR))
    man = _manifest(p)
    info["ours"] = bool(man and lib is not None and man.get("library") == lib.id)
    if info["drive_root"] and not info["engine"]:
        info["nested"] = find_nested(p)
    fsn = _fs_note(info["fs"])
    if role == "library":
        if not info["drive_root"]:
            add("warn", "not_root", "Bu kütüphane bir klasörde. Engine DJ ve Prime 4 yalnızca bir sürücünün kökündeki "
                "kütüphaneyi görür: çalmak için bir sürücüye aktar.")
        elif info["nested"] and not info["engine"]:
            add("warn", "nested", "Engine kütüphanesi bir alt klasörde kalmış: %s — Engine DJ onu görmez."
                % names.display(os.path.relpath(info["nested"][0], p)))
        if fsn:
            add(*fsn)
        return info
    # hedef
    if util.is_system_root(p):
        add("block", "system", "Bilgisayarın sistem diskinin kökü hedef olamaz. İçinde bir klasör seç.")
    try:
        writable = os.access(p, os.W_OK)
    except OSError:
        writable = False
    if not writable:
        add("block", "readonly", "Bu yere yazılamıyor (salt okunur ya da izin yok).")
    if lib is not None:
        src = os.path.normcase(os.path.abspath(lib.root))
        dst = os.path.normcase(p)
        if dst == src:
            add("block", "same", "Hedef, çalışma yerinin kendisi.")
        elif dst.startswith(src + os.sep):
            add("block", "inside", "Hedef, çalışma yerinin içinde olamaz.")
        elif src.startswith(dst + os.sep):
            add("block", "contains", "Çalışma yeri bu hedefin içinde: hedef olarak başka bir yer seç.")
    if not info["drive_root"]:
        add("warn", "not_root", "Hedef bir sürücünün kökü değil: Engine DJ / Prime 4 buradaki kütüphaneyi görmez. "
            "Yalnızca yedek olur.")
    if (info["engine"] or info["serato"]) and not info["ours"]:
        what = " ve ".join(x for x, ok in (("Engine Library", info["engine"]), ("_Serato_", info["serato"])) if ok)
        add("block", "foreign", "Hedefte başka bir kütüphane var (%s). Üstüne yazılmaz: başka bir sürücü seç ya da "
            "onları kenara al (silinmez, adı değişir)." % what)
    if info["nested"]:
        add("info", "nested", "Bu sürücüde alt klasörde kalmış bir Engine kütüphanesi var: %s (dokunulmaz)."
            % names.display(os.path.relpath(info["nested"][0], p)))
    if fsn:
        add(*fsn)
    return info


def library_location(lib):
    """Çalışma yerinin kısa durumu (önbellekli değil; ucuz)."""
    root = lib.root
    out = {"path": root, "drive_root": is_drive_root(root), "engine": _has_engine(root)}
    if not out["drive_root"] and out["engine"]:
        out["warn"] = "not_root"
    return out


# ---------------------------------------------------------------------------
# Plan
# ---------------------------------------------------------------------------
def _source_files(root, extra_excludes=()):
    """(göreli yol '/', mutlak yol, boyut, mtime, db_mu) — kaynakta aktarılacak her dosya."""
    skip = set(SKIP_DIRS) | {names.fold(x) for x in extra_excludes or () if x}
    out = []
    stack = [""]
    while stack:
        rel = stack.pop()
        absd = os.path.join(root, *rel.split("/")) if rel else root
        try:
            ents = list(os.scandir(absd))
        except OSError:
            continue
        for e in ents:
            r = (rel + "/" + e.name) if rel else e.name
            fn = names.fold(e.name)
            try:
                if e.is_dir(follow_symlinks=False):
                    if fn in skip or (not rel and fn == "_djdoktor_"):
                        continue
                    stack.append(r)
                    continue
                if not e.is_file(follow_symlinks=False):
                    continue
                if fn in SKIP_FILES or e.name.startswith("._") or e.name.endswith(".djdtmp"):
                    continue
                if fn.endswith(("-journal", "-wal", "-shm")):
                    continue
                st = e.stat()
            except OSError:
                continue
            is_db = r.split("/")[0] == ENGINE_DIR and fn.endswith(DB_EXT)
            out.append((r, e.path, st.st_size, st.st_mtime, is_db))
    cat = os.path.join(root, STATE_DIR, "katalog.db")
    if os.path.isfile(cat):
        st = os.stat(cat)
        out.append((STATE_DIR + "/katalog.db", cat, st.st_size, st.st_mtime, True))
    return out


def _same(meta, size, mtime):
    return meta and meta[0] == size and abs(meta[1] - mtime) <= 2.0


def plan(lib, target, files=None):
    target = os.path.abspath(target)
    chk = check_location(target, lib)
    files = files if files is not None else _source_files(lib.root, lib.prefs().get("extra_excludes"))
    man = (_manifest(target) or {}) if chk["ours"] else {}
    done = man.get("files") or {}
    copy, conflicts, big = [], [], []
    need = 0
    fat = util.is_fat_like(chk.get("fs") or "") and chk.get("fs") != "exfat"
    for rel, ap, size, mtime, is_db in files:
        if fat and size > FAT32_MAX:
            big.append(rel)
            continue
        dst = os.path.join(target, *rel.split("/"))
        if is_db:
            copy.append((rel, ap, size, mtime, True))
            need += size
            continue
        if rel in done and _same(done[rel], size, mtime) and os.path.isfile(dst):
            continue
        if rel not in done and os.path.isfile(dst):
            try:
                ds = os.path.getsize(dst)
            except OSError:
                ds = -1
            if ds == size:                     # aynı boyut: büyük olasılıkla aynı dosya (önceden elle kopyalanmış)
                copy.append((rel, ap, size, mtime, "adopt"))
                continue
            conflicts.append(rel)              # bizim koymadığımız farklı bir dosya: üstüne yazılmaz
            continue
        copy.append((rel, ap, size, mtime, False))
        need += size
    src_set = {f[0] for f in files}
    stale = [r for r in done if r not in src_set and os.path.isfile(os.path.join(target, *r.split("/")))]
    free = chk.get("free")
    probs = list(chk["problems"])
    if free is not None and need > free - 50 * 1024 * 1024:
        probs.append({"level": "block", "code": "space", "text": "Hedefte yer yetmiyor: %s gerekli, %s boş."
                      % (util.human_size(need), util.human_size(free))})
    if big:
        probs.append({"level": "warn", "code": "big", "text": "%d dosya 4 GB'tan büyük; FAT32'ye kopyalanamaz, atlanır." % len(big)})
    if conflicts:
        probs.append({"level": "warn", "code": "conflict", "text": "%d dosya hedefte farklı bir hâliyle zaten var; "
                      "üstüne yazılmaz, atlanır." % len(conflicts)})
    return {"target": target, "check": chk, "copy": copy, "need": need, "stale": stale, "conflicts": conflicts,
            "big": big, "problems": probs, "blocked": any(p["level"] == "block" for p in probs),
            "summary": {"files": sum(1 for c in copy if c[4] is not True and c[4] != "adopt"),
                        "dbs": sum(1 for c in copy if c[4] is True), "adopt": sum(1 for c in copy if c[4] == "adopt"),
                        "bytes": need, "stale": len(stale), "conflicts": len(conflicts), "big": len(big),
                        "total": len(files)}}


def _public(pl):
    out = {k: v for k, v in pl.items() if k not in ("copy",)}
    out["conflicts"] = pl["conflicts"][:50]
    out["stale"] = pl["stale"][:50]
    return out


# ---------------------------------------------------------------------------
# Aktarım
# ---------------------------------------------------------------------------
def _copy_file(src, dst):
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    tmp = dst + ".djdtmp"
    with open(src, "rb") as fi, open(tmp, "wb") as fo:
        shutil.copyfileobj(fi, fo, 1024 * 1024)
        fo.flush()
        os.fsync(fo.fileno())
    try:
        shutil.copystat(src, tmp)
    except OSError:
        pass
    if os.path.getsize(tmp) != os.path.getsize(src):
        raise OSError("Kopya eksik kaldı: %s" % os.path.basename(src))
    os.replace(tmp, dst)          # yalnızca kendi kopyamızın (ya da hiç olmayan dosyanın) yerine


def _copy_db(src, dst):
    """SQLite yedekleme API'siyle tutarlı kopya (kaynak o anda yazılıyor olsa bile), sonra bütünlük denetimi."""
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    tmp = dst + ".djdtmp"
    if os.path.exists(tmp):
        os.remove(tmp)                         # yarım kalmış kendi geçici dosyamız
    s = sqlite3.connect("file:%s?mode=ro" % src.replace("?", "%3F"), uri=True, timeout=30)
    d = sqlite3.connect(tmp)
    try:
        s.backup(d)
        ok = d.execute("PRAGMA quick_check").fetchone()[0]
    finally:
        d.close()
        s.close()
    if ok != "ok":
        raise OSError("Veritabanı kopyası sağlam değil: %s" % os.path.basename(src))
    os.replace(tmp, dst)


def set_aside(target, what=("Engine Library", "_Serato_")):
    """Hedefteki yabancı kütüphane klasörlerini SİLMEDEN kenara alır: 'Engine Library (eski 2026-10-18 1230)'."""
    moved = []
    tag = time.strftime("%Y-%m-%d %H%M")
    for n in what:
        p = os.path.join(target, n)
        if os.path.isdir(p):
            dst = util.unique_path(os.path.join(target, "%s (eski %s)" % (n, tag)))
            util.safe_rename(p, dst)
            moved.append({"from": n, "to": os.path.basename(dst)})
    return moved


def export(lib, target, progress=None, cancel=None):
    target = os.path.abspath(target)
    if engine.is_running(fresh=True):
        raise _err("Engine DJ açık. Aktarmadan önce Engine DJ'yi kapat (açıkken veritabanı yarım kopyalanabilir).",
                   "engine_open")
    if lib.serato_open(fresh=True):
        raise _err("Serato açık. Aktarmadan önce Serato'yu kapat.", "serato_open")
    pl = plan(lib, target)
    if pl["blocked"]:
        raise _err(" ".join(p["text"] for p in pl["problems"] if p["level"] == "block"), "blocked")
    mpath = os.path.join(target, STATE_DIR, MANIFEST)
    old = (_manifest(target) or {}) if pl["check"]["ours"] else {}
    man = {"library": lib.id, "source": lib.root, "files": dict(old.get("files") or {}), "started": util.now()}
    os.makedirs(os.path.dirname(mpath), exist_ok=True)
    total = max(1, pl["need"])
    done_b, n_files, n_db, last_save = 0, 0, 0, time.time()
    stopped = False
    files = [c for c in pl["copy"] if c[4] is not True]
    dbs = [c for c in pl["copy"] if c[4] is True]
    for rel, ap, size, mtime, kind in files:
        if cancel and cancel():
            stopped = True
            break
        dst = os.path.join(target, *rel.split("/"))
        if kind != "adopt":
            _copy_file(ap, dst)
            done_b += size
            n_files += 1
        man["files"][rel] = [size, mtime]
        if progress:
            progress(min(0.95, done_b / total), "Kopyalanıyor: %s" % names.display(rel.split("/")[-1]))
        if time.time() - last_save > 5:        # yarıda kalırsa sonraki aktarım buradan sürer
            util.write_json(mpath, man)
            last_save = time.time()
    if not stopped:
        if engine.is_running(fresh=True):
            util.write_json(mpath, man)
            raise _err("Engine DJ açıldı: veritabanları kopyalanmadı. Kapatıp yeniden aktar.", "engine_open")
        with lib.lock:                          # program bu arada m.db / katalog yazmasın
            for rel, ap, size, mtime, _k in dbs:
                if progress:
                    progress(0.96, "Veritabanı: %s" % rel)
                _copy_db(ap, os.path.join(target, *rel.split("/")))
                man["files"][rel] = [os.path.getsize(ap), os.path.getmtime(ap)]
                n_db += 1
        # kaynakta artık olmayan eski kopyalar: hedefte karantinaya (silinmez)
        moved = 0
        if pl["stale"]:
            qd = os.path.join(target, STATE_DIR, "Karantina", util.stamp() + "_aktarim")
            for rel in pl["stale"]:
                p = os.path.join(target, *rel.split("/"))
                if os.path.isfile(p):
                    q = util.unique_path(os.path.join(qd, *rel.split("/")))
                    os.makedirs(os.path.dirname(q), exist_ok=True)
                    try:
                        util.safe_rename(p, q)
                        moved += 1
                    except OSError:
                        continue
                man["files"].pop(rel, None)
        man["finished"] = util.now()
    util.write_json(mpath, man)
    _remember(lib, target, stopped)
    return {"files": n_files, "dbs": n_db, "bytes": done_b, "stale_moved": 0 if stopped else moved,
            "conflicts": len(pl["conflicts"]), "big": len(pl["big"]), "stopped": stopped,
            "visible": pl["check"]["drive_root"]}


# ---------------------------------------------------------------------------
# Kayıtlı hedefler (bu bilgisayarın ayarlarında; sürücü harfi / yolu bilgisayara göre değişir)
# ---------------------------------------------------------------------------
def saved(lib):
    out = []
    for t in lib.prefs().get("export_targets") or []:
        if t.get("lib") != lib.id:
            continue
        p = t.get("path")
        m = _manifest(p) if p and os.path.isdir(p) else None
        out.append({"path": p, "label": t.get("label") or os.path.basename(p.rstrip("\\/")) or p,
                    "present": bool(p and os.path.isdir(p)), "last": (m or {}).get("finished") or t.get("last"),
                    "drive_root": is_drive_root(p) if p and os.path.isdir(p) else None,
                    "free": util.free_space(p) if p and os.path.isdir(p) else None})
    return out


def _remember(lib, target, stopped=False):
    ts = [t for t in (lib.prefs().get("export_targets") or []) if not (t.get("lib") == lib.id and
                                                                      os.path.normcase(t.get("path", "")) == os.path.normcase(target))]
    label = util.volume_label(_drive_of(target)) or os.path.basename(target.rstrip("\\/")) or target
    ts.append({"lib": lib.id, "path": target, "label": label, "last": None if stopped else util.now()})
    lib.settings.set_prefs(export_targets=ts)


def forget(lib, target):
    ts = [t for t in (lib.prefs().get("export_targets") or []) if not (t.get("lib") == lib.id and
                                                                      os.path.normcase(t.get("path", "")) == os.path.normcase(target))]
    lib.settings.set_prefs(export_targets=ts)


@route("hedef")
def _api(h, lib, method, parts, qs, body):
    act = parts[1] if len(parts) > 1 else ""
    if act == "durum":
        loc = check_location(lib.root, lib, role="library")
        return h._json({"library": loc, "targets": saved(lib), "drives": [d for d in util.list_drives() if d.get("drive")
                                                                            and not d.get("system") and not d.get("net")]})
    if act == "kontrol":
        return h._json(_public(plan(lib, body.get("path") or qs.get("path") or "")))
    if act == "ekle" and method == "POST":
        p = os.path.abspath(body.get("path") or "")
        chk = check_location(p, lib)
        if any(x["code"] in ("missing", "same", "inside", "contains", "system") for x in chk["problems"]):
            raise _err(" ".join(x["text"] for x in chk["problems"] if x["level"] == "block"))
        ts = lib.prefs().get("export_targets") or []
        if not any(t.get("lib") == lib.id and os.path.normcase(t.get("path", "")) == os.path.normcase(p) for t in ts):
            ts = ts + [{"lib": lib.id, "path": p, "label": util.volume_label(_drive_of(p)) or os.path.basename(p.rstrip("\\/")) or p,
                        "last": None}]
            lib.settings.set_prefs(export_targets=ts)
        return h._json({"ok": True, "targets": saved(lib)})
    if act == "unut" and method == "POST":
        forget(lib, body.get("path") or "")
        return h._json({"ok": True, "targets": saved(lib)})
    if act == "kenara" and method == "POST":
        p = os.path.abspath(body.get("path") or "")
        if engine.is_running(fresh=True) or lib.serato_open(fresh=True):
            raise _err("Önce Engine DJ ve Serato'yu kapat.", "app_open")
        return h._json({"moved": set_aside(p)})
    if act == "aktar" and method == "POST":
        p = body.get("path") or ""
        title = "Aktarılıyor: %s" % (os.path.basename(p.rstrip("\\/")) or p)
        return h._task("export_target", title, lambda pr, c: export(lib, p, pr, c))
    return None
