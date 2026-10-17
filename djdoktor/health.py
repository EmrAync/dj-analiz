"""Sağlık: kütüphanedeki sorunlar ve her biri için tek tıklık çözüm (v1'deki "Sorunlar / Düzeltme" ekranı).

Rapor yok: her kategori kısa bir cümle, bir sayı ve (varsa) bir düğmedir. Düğmeler:
  * junk     : Mac / Windows çöp dosyaları (._x, .DS_Store) karantinaya taşınır (silinmez).
  * rename   : Windows / Prime 4'te sorun çıkaran adlar güvenli hâle getirilir (Türkçe harfler korunur);
               Engine ve Serato yolları birlikte güncellenir (tek işlem, tek yedek: relocate.batch_rename).
               Arayüzde Araçlar > Adlar'a gider (önizleme, çakışmalar, Türkçe harfleri sadeleştirme).
  * repair   : Engine'de bozuk yazılmış yollar (Mac biçimi) diskteki doğru yola çevrilir.
  * missing  : Engine koleksiyonunda dosyası diskte olmayan kayıtlar Engine'den kaldırılır (yedekten geri alınır).
  * quarantine: bozuk / yarım dosyalar karantinaya taşınır.
Hepsi tek bir 'Geri al' adımıdır.
"""
from __future__ import annotations

import os
from collections import defaultdict

from . import analysis, engine, journal, names

# anahtar, kodlar, başlık, kısa açıklama, düğme
CATEGORIES = [
    ("bad", ("audio_error", "audio_empty"), "Bozuk / yarım dosyalar",
     "Çalınamaz; yeniden indirilmesi gerekir.", "quarantine"),
    ("missing", (), "Engine'de dosyası olmayan kayıtlar",
     "Prime 4'te kırmızı görünür. Adı ya da yeri değiştiyse program bulup bağlar.", "missing"),
    ("broken", (), "Engine'de yolu yanlış yazılmış şarkılar",
     "Mac biçiminde yazılmış; Prime 4 bulamaz. Engine kapalıyken kendiliğinden onarılır.", "repair"),
    ("names", ("name_badchar", "name_trailing", "name_reserved", "name_nfd"), "Sorunlu dosya / klasör adları",
     "Windows ve Prime 4'te bulunamayabilir. Türkçe harfler korunur.", "rename"),
    ("junk", ("junk_appledouble", "junk_other"), "Çöp dosyalar (._ , .DS_Store)",
     "Mac'in bıraktığı yardımcı dosyalar; Engine bunları bozuk şarkı sanabilir.", "junk"),
    ("format", ("fmt_engine",), "Prime 4'ün çalamadığı biçim",
     "MP3, M4A, FLAC, WAV ya da AIFF olarak yeniden kaydet.", None),
    ("engcopy", ("engine_copy",), "Engine'in yaptığı kopyalar",
     "Engine DJ dosyayı 'Engine Library/Music' içine kopyalamış.", "dupes"),
    ("long", ("name_long",), "Çok uzun yol",
     "Windows'ta açılmayabilir; klasör ya da dosya adını kısalt.", None),
    ("emoji", ("name_emoji",), "Adda emoji / sembol",
     "Bazı cihazlarda sorun çıkarabilir.", "rename_emoji"),
    ("lowbr", ("audio_lowbr",), "Düşük kalite (192 kbps altı)",
     "Büyük ses sisteminde fark edilebilir; mümkünse 320 kbps'lik sürümünü bul.", None),
    ("notags", ("tag_none",), "Sanatçı / başlık etiketi yok",
     "DJ programları dosya adını gösterir.", None),
]
RENAME_CODES = ("name_badchar", "name_trailing", "name_reserved", "name_nfd")


def _err(msg, code=None):
    from .library import UserError
    return UserError(msg, code)


def _row(lib, f, extra=None):
    d = {"id": f["id"], "rel": names.display(f["rel"]), "title": f.get("title") or
         os.path.splitext(names.display(f["name"] or ""))[0], "artist": f.get("artist") or "",
         "bitrate": f.get("bitrate"), "size": f.get("size")}
    if extra:
        d.update(extra)
    return d


def summary(lib, with_items=True, limit=300):
    """Kategoriler: [{key, title, hint, action, count, items}] + genel sayılar (önbellekli)."""
    return lib.cached("health:%s:%s" % (with_items, limit), lib.view_key(), lambda: _summary(lib, with_items, limit))


def _summary(lib, with_items, limit):
    from .library import STATE_DIR
    files = [f for f in lib.audio_files() if not f["rel"].startswith(STATE_DIR + "/")]
    prefs = lib.prefs()
    by_code = defaultdict(list)
    for f in files:
        # bayraklar taramada yazılır; taşınan / adı değişen dosyalarda eskiyebilir: o an yeniden hesaplanır
        for c in analysis.file_issues(f, prefs):
            by_code[c].append(f)
    junk = lib.catalog.q("SELECT id, rel, name, size, kind, flags FROM files WHERE present=1 AND kind IN "
                         "('appledouble','junk') AND rel NOT LIKE '_DJDoktor_/%' ORDER BY rel")
    st = lib.engine_state()
    missing = [o for o in st["orphans"] if o[2] in ("missing", "nodir")]
    broken = [fid for fid, s in st["status"].items() if s == "broken"]
    fmap = {f["id"]: f for f in files}
    out = []
    for key, codes, title, hint, action in CATEGORIES:
        items = []
        if key == "junk":
            items = [{"id": r["id"], "rel": names.display(r["rel"]), "title": names.display(r["name"]),
                      "artist": "", "size": r["size"]} for r in junk]
        elif key == "missing":
            for tid, rel, _m in missing:
                t = st["tracks"].get(tid) or {}
                items.append({"tid": tid, "rel": names.display(rel or t.get("path") or ""),
                              "title": t.get("title") or t.get("filename") or "?", "artist": t.get("artist") or ""})
        elif key == "broken":
            items = [_row(lib, fmap[fid]) for fid in broken if fid in fmap]
        else:
            seen = set()
            for c in codes:
                for f in by_code.get(c, []):
                    if f["id"] not in seen:
                        seen.add(f["id"])
                        items.append(_row(lib, f, {"codes": [c]}))
        items.sort(key=lambda x: names.fold(x["rel"]))
        d = {"key": key, "title": title, "hint": hint, "action": action, "count": len(items)}
        if key == "junk":
            d["size"] = sum(r["size"] or 0 for r in junk)
        if with_items:
            d["items"] = items[:limit]
        out.append(d)
    audio = files
    stats = {"songs": len(audio), "duration": sum(f.get("duration") or 0 for f in audio),
             "size": sum(f.get("size") or 0 for f in audio),
             "formats": dict(sorted(_count(f.get("ext") or "?" for f in audio).items(), key=lambda kv: -kv[1])),
             "with_note": sum(1 for f in audio if f.get("note")), "with_cues": sum(1 for f in audio if f.get("cues")),
             "with_key": sum(1 for f in audio if f.get("camelot")), "engine": len(st["tracks"]),
             "analyzed": sum(1 for t in st["tracks"].values() if t.get("isAnalyzed"))}
    return {"categories": out, "stats": stats, "problems": sum(c["count"] for c in out if c["action"])}


def _count(it):
    d = defaultdict(int)
    for x in it:
        d[x] += 1
    return dict(d)


# ---------------------------------------------------------------------------
# Çöp dosyalar
# ---------------------------------------------------------------------------
def fix_junk(lib, progress=None):
    """Mac / Windows çöp dosyalarını karantinaya taşır (silmez). Tek 'Geri al' adımı."""
    from . import dedupe
    with lib.lock:
        rows = lib.catalog.q("SELECT * FROM files WHERE present=1 AND kind IN ('appledouble','junk') "
                             "AND rel NOT LIKE '_DJDoktor_/%'")
        if not rows:
            return {"moved": 0}
        if lib.serato_open(fresh=True):
            raise _err("Serato açık; lütfen kapatın.", "serato_open")
        op = journal.Op(lib, "karantina", "%d çöp dosya karantinaya taşındı" % len(rows))
        if progress:
            progress(0.2, "Taşınıyor…")
        n = dedupe.quarantine_files(lib, [r["id"] for r in rows], "cop_dosyalar", op, {r["id"]: r for r in rows})
        lib.bump()
        op.title = "%d çöp dosya karantinaya taşındı" % n
        jid = op.commit()
        return {"moved": n, "journal": jid}


# ---------------------------------------------------------------------------
# Güvenli ad düzeltme
# ---------------------------------------------------------------------------
def _rules(emoji):
    from . import renamer
    return renamer.normalize_rules({"strip_emoji": bool(emoji)}, preset="only_illegal")


def plan_rename(lib, emoji=False):
    """Düzeltilecek adlar (Araçlar > Adlar'daki 'Yalnızca sorunlu karakterler' ile aynı hesap):
    -> {'files': {fid: yeni_ad}, 'folders': [(klasör_rel, yeni_ad)], 'preview': [...], 'conflicts': [...]}"""
    from . import renamer
    pl = renamer.plan(lib, _rules(emoji), {"kind": "all", "include_root": True}, "both", limit=None)
    files, dirs, _sx = renamer._selection(pl)
    preview = [{"kind": "klasör" if x["kind"] == "dir" else "dosya", "old": x["rel"], "new": x["new"],
                "conflict": x["conflict"]} for x in pl["items"]]
    return {"files": files, "folders": sorted(dirs.items(), key=lambda kv: -kv[0].count("/")), "preview": preview,
            "conflicts": [x for x in pl["items"] if x["status"] == "conflict"], "token": pl["token"]}


def fix_names(lib, emoji=False, progress=None):
    """Sorunlu adları düzeltir: dosyalar ve klasörler TEK işlemde, veritabanı başına tek yedekle (relocate.batch_rename).
    Engine ve Serato yolları birlikte güncellenir; aynı adda bir şey varsa o ad atlanır ve raporlanır."""
    from . import relocate
    with lib.lock:
        pl = plan_rename(lib, emoji)
        if not pl["files"] and not pl["folders"]:
            return {"renamed": 0, "conflicts": len(pl["conflicts"])}
        n = len(pl["files"]) + len(pl["folders"])
        res = relocate.batch_rename(lib, pl["files"], dict(pl["folders"]), "%d ad düzeltildi" % n, kind="ad_duzeltme",
                                    progress=progress)
        res["renamed"] = res["files"] + res["dirs"]
        res["conflicts"] = len(pl["conflicts"]) + sum(1 for x in res["skipped"] if x["why"] == "exists")
        return res


# ---------------------------------------------------------------------------
# Engine: bozuk yollar ve dosyası olmayan kayıtlar
# ---------------------------------------------------------------------------
def repair_engine(lib, progress=None):
    """Engine'deki bozuk yolları (ve başka yerde bulunan dosyaları) şimdi onarır."""
    from . import maintain
    if lib.engine_db() and lib.engine_open(fresh=True):
        raise _err("Engine DJ açık. Onarmak için Engine DJ'i kapatın.", "engine_open")
    op = journal.Op(lib, "bakim", "Engine yolları onarıldı")
    with lib.lock:
        lib._maint_sig = None
        r = maintain.run(lib, op=op)
        if r.get("errors"):
            raise _err(" ".join(r["errors"]))
        op.title = "Engine onarıldı: %d yol" % (r.get("repaired", 0) + r.get("relinked", 0))
        r["journal"] = op.commit()
        return r


def remove_missing(lib, tids=None, progress=None):
    """Dosyası diskte olmayan Engine kayıtlarını koleksiyondan (ve listelerden) kaldırır.
    Engine yedeği alınır; 'Geri al' veritabanını işlem öncesine döndürür."""
    d = lib.engine_db()
    if not d:
        raise _err("Bu SSD'de Engine kütüphanesi yok.", "no_engine")
    if lib.engine_open(fresh=True):
        raise _err("Engine DJ açık. Bu işlem için Engine DJ'i kapatın.", "engine_open")
    with lib.lock:
        st = lib.engine_state(force=True)
        cand = {tid for tid, _rel, m in st["orphans"] if m in ("missing", "nodir")}
        if tids:
            cand &= {int(t) for t in tids}
        if not cand:
            return {"removed": 0}
        try:
            engine.preflight(d["path"])
        except engine.EngineError as e:
            raise _err(str(e))
        bk = engine.backup(d["path"], lib.backup_dir("engine"), "kayip_kaldirma")
        engine.prune_backups(lib.backup_dir("engine"))
        op = journal.Op(lib, "engine", "Engine'den %d kayıp kayıt kaldırıldı" % len(cand))
        w = engine.Writer(d["path"], d["lib_dir"], lib.root)
        removed = 0
        try:
            refs = {}
            for tid in cand:
                t = w.track(tid)
                if t:
                    refs[(t["originDatabaseUuid"], t["originTrackId"])] = tid
            lists_ = [r[0] for r in w.con.execute("SELECT DISTINCT listId FROM PlaylistEntity")]
            for lid in lists_:
                cur = w.refs(lid)
                new = [r for r in cur if r not in refs]
                if len(new) != len(cur):
                    w.pl_set_refs(lid, new, record=False)
            for tid in refs.values():
                w.track_delete(tid)
                removed += 1
            w.commit()
        except Exception:
            w.rollback()
            raise
        op.add({"k": "engsnap", "db": d["key"], "dbpath": d["path"], "backup": bk})
        op.title = "Engine'den %d kayıp kayıt kaldırıldı" % removed
        jid = op.commit()
        return {"removed": removed, "journal": jid}


def explain(codes):
    """Bayrak kodlarının kısa Türkçe açıklaması (parça ayrıntısı için)."""
    out = []
    for c in codes or []:
        sev, title, desc, _fix = analysis.ISSUES.get(c, ("bilgi", c, "", ""))
        out.append({"code": c, "severity": sev, "title": title, "desc": desc})
    return out

