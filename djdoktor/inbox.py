"""Gelen kutusu: indirilen şarkılar için tek giriş kapısı.

Akış (bilgisayarda -> SSD):
  1. İndir:   şarkıyı bilgisayardaki 'DJ Gelen/<Tür>' klasörüne kaydet (ör. DJ Gelen/Halay).
              Tür, indirirken seçtiğin klasördür. Türü belli değilse doğrudan 'DJ Gelen' içine.
  2. Kontrol: program dosyayı inceler: yarım/bozuk mu, Prime 4 çalar mı, kütüphanede zaten var mı?
  3. SSD:     temiz dosya SSD'deki 'Müzik/<Tür>' klasörüne KOPYALANIR (tek ev) ve doğrulanır.
  4. Engine:  program şarkıyı Engine koleksiyonuna BİR KEZ ekler ve 'Analiz bekleyenler' listesine koyar.
  5. Arşiv:   indirilen orijinal 'DJ Arşiv/<yıl-ay>/<Tür>' klasörüne taşınır (kaybolmaya karşı ikinci kopya;
              Engine'e asla eklenmez, karışmaz).
Hepsi tek işlemdir; 'Geri al' SSD'deki kopyayı karantinaya alır ve orijinali gelen kutusuna geri koyar.
"""
from __future__ import annotations

import os
import re
import shutil
import threading
import time

from . import audiosig, genres as G, journal, names, util
from .scanner import RootInfo, build_record

PARTIAL_EXTS = {".crdownload", ".part", ".partial", ".download", ".tmp", ".opdownload", ".!ut", ".ytdl"}
UNSORTED_LABEL = "Türü belli değil"
_cache = {}
_cache_lock = threading.Lock()
_seen_sizes = {}

NOISE = re.compile(r"\s*[\(\[\{][^\)\]\}]*(official|video|audio|lyric|lyrics|klip|clip|visuali[sz]er|\bhd\b|\bhq\b|"
                   r"\b4k\b|\bmv\b|şarkı sözleri|sarki sozleri|altyazı|resmi)[^\)\]\}]*[\)\]\}]", re.I)
TAIL_NOISE = re.compile(r"\s*[-|]\s*(youtube|official (music )?video|official audio)\s*$", re.I)


def _err(msg, code=None):
    from .library import UserError
    return UserError(msg, code)


def default_dirs():
    home = os.path.expanduser("~")
    music = os.path.join(home, "Music")
    if not os.path.isdir(music):
        alt = os.path.join(home, "Müzik")
        music = alt if os.path.isdir(alt) else music
    return os.path.join(music, "DJ Gelen"), os.path.join(music, "DJ Arşiv")


def dirs(lib):
    p = lib.prefs()
    di, da = default_dirs()
    return (p.get("inbox_dir") or di), (p.get("archive_dir") or da)


def nice_name(filename):
    """İndirilen dosya adını sadeleştirir: '(Official Video)', '[HD]', ' - YouTube' gibi ekler ve emoji gider."""
    stem, ext = os.path.splitext(filename)
    s = NOISE.sub("", stem)
    s = TAIL_NOISE.sub("", s)
    s = re.sub(r"\s{2,}", " ", s).strip(" -_.")
    if len(s) < 2:
        s = stem
    return names.clean_component(s + ext, True)


def ensure_dirs(lib):
    """Gelen kutusunu ve her tür için alt klasörünü oluşturur (yalnızca bilgisayarda)."""
    inbox, archive = dirs(lib)
    os.makedirs(inbox, exist_ok=True)
    os.makedirs(archive, exist_ok=True)
    for g in lib.genre_rows():
        p = os.path.join(inbox, G.genre_folder_name(g["name"]))
        if not os.path.isdir(p):
            try:
                os.makedirs(p, exist_ok=True)
            except OSError:
                pass
    return inbox, archive


def _genre_for_folder(lib, top):
    if not top:
        return None
    gens = {g["name"]: g for g in lib.genre_rows()}
    byf = {names.fold(G.genre_folder_name(n)): g for n, g in gens.items()}
    g = byf.get(names.fold(top))
    if g:
        return g
    m = G.match_existing(names.display(top), gens)
    return gens.get(m) if m else None


def _record(path, size, mtime):
    key = (path, size, mtime)
    with _cache_lock:
        if key in _cache:
            return _cache[key]
    d, n = os.path.split(path)
    ri = RootInfo(d)
    try:
        st = os.stat(path)
        rec = build_record(ri, n, "audio", st, util.now())
    except Exception as e:
        rec = {"tag_error": "okunamadı: %s" % e, "size": size, "name": n, "ext": os.path.splitext(n)[1].lower()}
    with _cache_lock:
        if len(_cache) > 2000:
            _cache.clear()
        _cache[key] = rec
    return rec


def _library_index(lib):
    by_sig, by_song = {}, {}
    for f in lib.catalog.q("SELECT id, rel, qsig, alen, songkey, duration, bitrate FROM files WHERE kind='audio' "
                           "AND present=1"):
        if f["rel"].startswith("_DJDoktor_/"):
            continue
        if f["qsig"]:
            by_sig.setdefault((f["qsig"], f["alen"]), f)
        if f["songkey"]:
            by_song.setdefault(f["songkey"], []).append(f)
    return by_sig, by_song


def scan(lib, settle=2.0):
    """Gelen kutusundaki dosyalar ve durumları."""
    inbox, _archive = dirs(lib)
    if not os.path.isdir(inbox):
        return {"inbox": inbox, "items": [], "exists": False}
    holds = lib.catalog.holds()
    by_sig, by_song = _library_index(lib)
    place = lib.placer()
    gens = {g["id"]: g for g in lib.genre_rows()}
    items = []
    now = time.time()
    for dirpath, dirnames, filenames in os.walk(inbox):
        rel_dir = os.path.relpath(dirpath, inbox)
        depth = 0 if rel_dir == "." else rel_dir.count(os.sep) + 1
        dirnames[:] = [d for d in dirnames if not d.startswith(".") and depth < 3]
        top = None if rel_dir == "." else rel_dir.split(os.sep)[0]
        g = _genre_for_folder(lib, top) if top else None
        for n in filenames:
            if n.startswith(".") or n.startswith("._"):
                continue
            ext = os.path.splitext(n)[1].lower()
            p = os.path.join(dirpath, n)
            if ext in PARTIAL_EXTS:
                items.append({"path": p, "name": n, "status": "downloading", "genre": g["name"] if g else None,
                              "gid": g["id"] if g else None})
                continue
            if ext not in names.AUDIO_EXTS and ext not in (".webm", ".opus", ".ogg", ".wma"):
                continue
            try:
                st = os.stat(p)
            except OSError:
                continue
            size, mtime = st.st_size, int(st.st_mtime)
            item = {"path": p, "name": names.nfc(n), "size": size, "genre": g["name"] if g else None,
                    "gid": g["id"] if g else None, "folder": top or ""}
            prev = _seen_sizes.get(p)
            _seen_sizes[p] = (size, mtime)
            if now - st.st_mtime < settle or prev != (size, mtime) and now - st.st_mtime < 30:
                item["status"] = "downloading"
                items.append(item)
                continue
            h = holds.get(p)
            if h and h.get("size") == size:
                item["status"] = "held"
            rec = _record(p, size, mtime)
            item.update({"title": rec.get("title"), "artist": rec.get("artist"), "duration": rec.get("duration"),
                         "bitrate": rec.get("bitrate"), "target_name": nice_name(n)})
            status = item.get("status")
            if ext not in names.ENGINE_OK_EXTS:
                status = status or "unsupported"
                item["why"] = "Prime 4 bu biçimi çalmaz (%s). MP3 / M4A / FLAC / WAV olarak indir." % ext.lstrip(".")
            elif size < 4096 or (rec.get("alen") is not None and 0 <= rec["alen"] < 4096) or rec.get("tag_error"):
                status = status or "broken"
                item["why"] = "Dosya yarım inmiş ya da bozuk; yeniden indir."
            else:
                m = by_sig.get((rec.get("qsig"), rec.get("alen"))) if rec.get("qsig") else None
                if m:
                    kind, gid = place(m["rel"])
                    gg = gens.get(gid) if kind == "genre" else None
                    item["match"] = {"id": m["id"], "rel": names.display(m["rel"]), "genre": gg["name"] if gg else None}
                    status = status or "exists"
                else:
                    sim = None
                    for c in by_song.get(rec.get("songkey") or "", []):
                        if rec.get("duration") and c["duration"] and abs(rec["duration"] - c["duration"]) <= 3:
                            sim = c
                            break
                    if sim:
                        kind, gid = place(sim["rel"])
                        gg = gens.get(gid) if kind == "genre" else None
                        item["match"] = {"id": sim["id"], "rel": names.display(sim["rel"]),
                                         "genre": gg["name"] if gg else None, "bitrate": sim.get("bitrate")}
                        item["better"] = bool(rec.get("bitrate") and sim.get("bitrate") and
                                              rec["bitrate"] > sim["bitrate"] + 32)
                        status = status or "similar"
                    else:
                        status = status or ("new" if g else "nogenre")
            item["status"] = status
            items.append(item)
    items.sort(key=lambda x: (x.get("genre") or "~", names.fold(x["name"])))
    return {"inbox": inbox, "items": items, "exists": True}


def ingest(lib, entries, progress=None, auto=False):
    """entries: [{'path', 'gid' (isteğe bağlı), 'force' (benzeri olsa da ekle)}] -> özet."""
    inbox, archive = dirs(lib)
    cat = lib.catalog
    gens = {g["id"]: g for g in lib.genre_rows()}
    month = time.strftime("%Y-%m")
    with lib.lock:
        cur = {i["path"]: i for i in scan(lib, settle=0 if not auto else 2.0)["items"]}
        todo = []
        for e in entries:
            it = cur.get(e["path"])
            if not it:
                continue
            gid = int(e.get("gid") or it.get("gid") or 0)
            ok = it["status"] in ("new", "nogenre", "held") or (it["status"] == "similar" and e.get("force"))
            if not ok or gid not in gens:
                continue
            todo.append((it, gens[gid]))
        if not todo:
            return {"added": 0}
        groups = {}
        for it, g in todo:
            groups[g["name"]] = groups.get(g["name"], 0) + 1
        title = "Gelen: %d şarkı eklendi (%s)" % (len(todo), ", ".join("%s %d" % kv for kv in groups.items()))
        op = journal.Op(lib, "gelen", title)
        added = []
        try:
            for i, (it, g) in enumerate(todo):
                name = nice_name(os.path.basename(it["path"]))
                rel = g["rel"] + "/" + name
                stem, ext = os.path.splitext(rel)
                k = 2
                taken = {r["lkey"] for r in cat.q("SELECT lkey FROM files WHERE present=1 AND folder=?", (g["rel"],))}
                while names.loose_key(rel) in taken or os.path.exists(lib.rootinfo.os_path(rel)):
                    rel = "%s (%d)%s" % (stem, k, ext)
                    k += 1
                dst = lib.rootinfo.os_path(rel)
                os.makedirs(os.path.dirname(dst), exist_ok=True)
                shutil.copy2(it["path"], dst)
                if os.path.getsize(dst) != os.path.getsize(it["path"]):
                    os.remove(dst)
                    raise OSError("Kopya doğrulanamadı (boyut): %s" % it["name"])
                a = audiosig.analyze(it["path"], ext.lower())
                b = audiosig.analyze(dst, ext.lower())
                if a.get("qsig") != b.get("qsig"):
                    os.remove(dst)
                    raise OSError("Kopya doğrulanamadı (ses imzası): %s" % it["name"])
                os_rel = os.path.relpath(dst, lib.root).replace(os.sep, "/")
                rec = build_record(lib.rootinfo, os_rel, "audio", os.stat(dst), util.now())
                cat.upsert_files([rec])
                row = cat.file_by_rel(rec["rel"])
                op.add({"k": "copy", "rel": rec["rel"], "fid": row["id"] if row else None})
                # orijinal arşive (bilgisayarda)
                adir = os.path.join(archive, month, G.genre_folder_name(g["name"]))
                os.makedirs(adir, exist_ok=True)
                adst = util.move_file(it["path"], os.path.join(adir, os.path.basename(it["path"])))
                op.add({"k": "inbox", "src": it["path"], "dst": adst})
                cat.set_hold(it["path"], on=False)
                added.append({"name": names.display(name), "genre": g["name"], "rel": rec["rel"]})
                if progress:
                    progress(0.1 + 0.6 * (i + 1) / len(todo), "Ekleniyor (%d/%d)…" % (i + 1, len(todo)))
        except Exception:
            journal.apply_inverse(lib, op.steps, force=True)
            lib.bump()
            raise
        lib.compute_flags()
        lib.bump()
        if progress:
            progress(0.8, "Engine koleksiyonuna ekleniyor…")
        from . import maintain
        m = maintain.after_change(lib, op)
        jid = op.commit()
        for a in added:
            cat.inbox_log_add(a["name"], "eklendi", a["rel"], a["genre"], journal=jid)
        return {"added": len(added), "items": added, "journal": jid, "maint": m}


def set_aside(lib, path, why="ayiklanan"):
    """Gelen kutusundaki bir dosyayı arşivin '_Ayıklanan' klasörüne taşır (silinmez)."""
    inbox, archive = dirs(lib)
    if not os.path.abspath(path).startswith(os.path.abspath(inbox) + os.sep):
        raise _err("Bu dosya gelen kutusunda değil.")
    if not os.path.isfile(path):
        raise _err("Dosya bulunamadı.")
    adir = os.path.join(archive, "_Ayıklanan")
    os.makedirs(adir, exist_ok=True)
    dst = util.move_file(path, os.path.join(adir, os.path.basename(path)))
    op = journal.Op(lib, "gelen", "Ayıklandı: %s" % os.path.basename(path))
    op.add({"k": "inbox", "src": path, "dst": dst})
    jid = op.commit()
    lib.catalog.inbox_log_add(names.nfc(os.path.basename(path)), why, None, None, journal=jid)
    return {"ok": True}


def archive_existing(lib, path):
    """Kütüphanede zaten olan bir indirmeyi arşive kaldırır (SSD'ye ikinci kez girmez)."""
    inbox, archive = dirs(lib)
    if not os.path.isfile(path):
        raise _err("Dosya bulunamadı.")
    adir = os.path.join(archive, time.strftime("%Y-%m"), "_Zaten vardı")
    os.makedirs(adir, exist_ok=True)
    dst = util.move_file(path, os.path.join(adir, os.path.basename(path)))
    op = journal.Op(lib, "gelen", "Zaten vardı, arşive kaldırıldı: %s" % os.path.basename(path))
    op.add({"k": "inbox", "src": path, "dst": dst})
    jid = op.commit()
    lib.catalog.inbox_log_add(names.nfc(os.path.basename(path)), "zaten_vardi", None, None, journal=jid)
    return {"ok": True}


def auto_tick(lib):
    """Arka plan: türü belli, temiz ve tamamen inmiş dosyaları kendiliğinden ekler; kütüphanede zaten olanları
    arşive kaldırır. Benzer kayıtlar, bozuklar ve türü belli olmayanlar kullanıcıyı bekler."""
    if not lib.prefs().get("auto_inbox", True):
        return None
    inbox, _a = dirs(lib)
    if not os.path.isdir(inbox) or not lib.genre_rows():
        return None
    s = scan(lib)
    new = [{"path": i["path"]} for i in s["items"] if i["status"] == "new"]
    res = {}
    if new:
        res = ingest(lib, new, auto=True)
    for i in s["items"]:
        if i["status"] == "exists":
            try:
                archive_existing(lib, i["path"])
                res["archived"] = res.get("archived", 0) + 1
            except Exception:
                pass
    return res or None


# ---------------------------------------------------------------------------
# İndirilenler klasörü (tarayıcı varsayılanı): unutulan indirmeler
# ---------------------------------------------------------------------------
def downloads_dir():
    home = os.path.expanduser("~")
    for n in ("Downloads", "İndirilenler", "Indirilenler"):
        p = os.path.join(home, n)
        if os.path.isdir(p):
            return p
    return None


def downloads(lib, days=21):
    """İndirilenler'de son günlerde inmiş, henüz gelen kutusuna alınmamış ses dosyaları."""
    if not lib.prefs().get("watch_downloads", True):
        return []
    d = downloads_dir()
    if not d:
        return []
    import json
    seen = set(json.loads(lib.catalog.get_meta("dl_seen") or "[]"))
    out = []
    lim = time.time() - days * 86400
    try:
        for e in os.scandir(d):
            if not e.is_file() or e.name.startswith("."):
                continue
            ext = os.path.splitext(e.name)[1].lower()
            if ext not in names.AUDIO_EXTS and ext not in (".webm", ".opus"):
                continue
            st = e.stat()
            key = "%s|%d" % (e.path, st.st_size)
            if st.st_mtime < lim or key in seen:
                continue
            out.append({"path": e.path, "name": names.nfc(e.name), "size": st.st_size, "mtime": int(st.st_mtime)})
    except OSError:
        return []
    out.sort(key=lambda x: -x["mtime"])
    return out[:50]


def take_download(lib, path, gid):
    """İndirilenler'deki dosyayı seçilen türün gelen kutusu klasörüne taşır (sonra normal akış işler)."""
    g = next((g for g in lib.genre_rows() if g["id"] == int(gid)), None)
    if not g:
        raise _err("Tür bulunamadı.")
    inbox, _a = ensure_dirs(lib)
    if not os.path.isfile(path):
        raise _err("Dosya bulunamadı.")
    dst = util.move_file(path, os.path.join(inbox, G.genre_folder_name(g["name"]), os.path.basename(path)))
    return {"path": dst}


def ignore_download(lib, path):
    import json
    seen = json.loads(lib.catalog.get_meta("dl_seen") or "[]")
    try:
        seen.append("%s|%d" % (path, os.path.getsize(path)))
    except OSError:
        return {"ok": False}
    lib.catalog.set_meta("dl_seen", json.dumps(seen[-2000:]))
    return {"ok": True}
