"""Engine çalma listeleri: doğrudan düzenleme.

Listeler programın içinde ayrıca tutulmaz. Program, SSD'deki Engine kütüphanesinin listelerini
okur ve her değişikliği ANINDA oraya yazar. Prime 4 aynı listeleri görür; "gönder", "al",
"kaydet" adımı yoktur. Her değişiklik 'Geri al' ile geri alınabilir.

Etkinlik bilgileri (tarih, yer, not) ve satır notları Engine'de karşılığı olmadığı için
programın kataloğunda, Engine liste kimliğiyle birlikte tutulur.
"""
from __future__ import annotations

from collections import defaultdict

from . import engine, journal, names, util

EVENTS_TITLE = "Etkinlikler"

TEMPLATES = [
    ("dugun", "Düğün", ["Karşılama (Fon)", "Giriş", "İlk Dans", "Pasta", "Takı", "Halay", "Kürtçe Halay",
                        "Horon", "Roman - Mezdeke", "Oyun Havası", "Türkçe Pop", "Yabancı Pop - Dans", "Arabic",
                        "Çıkış", "Yedek"]),
    ("kina", "Kına Gecesi", ["Karşılama (Fon)", "Gelin Girişi", "Kına Şarkıları", "Tepsi - Mumlar", "Halay",
                             "Oyun Havası", "Roman - Mezdeke", "Türkçe Pop", "Arabic", "Yedek"]),
    ("nisan", "Nişan / Söz", ["Karşılama (Fon)", "Giriş", "Yüzük", "Pasta", "Slow", "Halay", "Oyun Havası",
                              "Türkçe Pop", "Yabancı Pop - Dans", "Yedek"]),
    ("sunnet", "Sünnet Düğünü", ["Karşılama (Fon)", "Giriş", "Çocuk Şarkıları", "Halay", "Oyun Havası",
                                 "Roman - Mezdeke", "Türkçe Pop", "Yedek"]),
    ("matine", "Matine", ["Fon", "Oyun Havası", "Roman - Mezdeke", "Arabic", "Halay", "Türkçe Pop", "Yedek"]),
    ("parti", "Doğum Günü / Parti", ["Karşılama", "Pasta", "Türkçe Pop", "Yabancı Pop - Dans", "Halay", "Yedek"]),
    ("bos", "Boş", []),
]


def _err(msg, code=None):
    from .library import UserError
    return UserError(msg, code)


def require_engine(lib):
    d = lib.engine_db()
    if not d:
        raise _err("Bu SSD'de Engine kütüphanesi yok. Engine DJ'de bu SSD'ye bir kez parça aktarın; "
                   "kütüphane oluşunca listeler burada görünür.", "no_engine")
    if lib.engine_open():
        raise _err("Engine DJ açık. Listeleri düzenlemek için Engine DJ'i kapatın (Prime 4 ve bu program aynı "
                   "listeleri kullanır).", "engine_open")
    return d


def ref_str(ref):
    return "%s:%s" % (ref[0], ref[1])


def parse_ref(s):
    u, t = str(s).rsplit(":", 1)
    return (u, int(t))


class Edit:
    """Engine'e tek işlemlik yazma: biter bitmez kaydedilir, günlüğe 'Geri al' adımı olarak girer."""

    def __init__(self, lib, title, kind="liste"):
        self.lib = lib
        self.title = title
        self.kind = kind

    def __enter__(self):
        self.d = require_engine(self.lib)
        try:
            engine.preflight(self.d["path"])
        except engine.EngineError as e:
            raise _err(str(e))
        self.op = journal.Op(self.lib, self.kind, self.title)
        self.lib.lock.acquire()
        try:
            self.w = engine.Writer(self.d["path"], self.d["lib_dir"], self.lib.root)
        except Exception:
            self.lib.lock.release()
            raise
        self.uuid = self.w.uuid
        return self

    def __exit__(self, et, e, tb):
        try:
            if et is not None:
                self.w.rollback()
                return False
            changed = set(self.w.changed_lists)
            self.w.commit()
            self.op.add_engine(self.w, "drive")
            from . import mirror
            try:
                self.result_mirror = mirror.after_engine_change(self.lib, changed, self.op)
            except Exception as ex:  # Serato aynası listeyi bozmasın
                self.result_mirror = {"error": str(ex)}
            self.jid = self.op.commit()
            return False
        finally:
            self.lib.lock.release()


def _managed(lib, uuid):
    from . import maintain
    return maintain.managed_ids(lib, uuid)


def _guard_managed(lib, uuid, *pids):
    m = _managed(lib, uuid)
    for p in pids:
        if p and int(p) in m:
            raise _err("Bu liste program tarafından otomatik tutuluyor (Analiz bekleyenler / Türler). "
                       "Düzenlemek için önce kopyasını alın.", "managed")


# ---------------------------------------------------------------------------
# Okuma
# ---------------------------------------------------------------------------
def tree(lib):
    st = lib.engine_state()
    if not st["db"]:
        return {"db": None, "lists": [], "readonly": True, "reason": "no_engine"}
    from . import maintain
    uuid = st["uuid"]
    cat = lib.catalog
    mm = maintain.managed_meta(lib, uuid)
    mids = maintain.managed_ids(lib, uuid)
    ev = cat.ev_meta_all(uuid)
    links = cat.serato_links(uuid)
    kids = defaultdict(int)
    for p in st["playlists"]:
        kids[p["parent"]] += 1
    out = []
    for p in st["playlists"]:
        n = len(p["refs"])
        dur, pend, miss = 0, 0, 0
        for tid in p["entries"]:
            t = st["tracks"].get(tid) if tid else None
            if not t:
                miss += 1
                continue
            dur += t.get("length") or 0
            if not t.get("isAnalyzed"):
                pend += 1
            if tid not in st["fid_of_tid"]:
                miss += 1
        kind = "list"
        if p["id"] == mm.get("analysis"):
            kind = "analysis"
        elif p["id"] == mm.get("genres_root"):
            kind = "genres"
        elif p["id"] in mids:
            kind = "genre"
        lk = links.get(p["id"])
        out.append({"id": p["id"], "title": p["title"], "parent": p["parent"], "depth": p["depth"],
                    "path": p["path"], "n": n, "dur": dur, "pending": pend, "missing": miss, "kids": kids[p["id"]],
                    "kind": kind, "managed": p["id"] in mids, "ev": ev.get(p["id"]),
                    "serato": {"crate": lk["crate"], "dirty": lk["dirty"]} if lk else None})
    return {"db": uuid, "lists": out, "readonly": lib.engine_open(), "reason": "engine_open" if lib.engine_open() else "",
            "templates": [{"kind": k, "title": t, "sections": s} for k, t, s in TEMPLATES]}


def items(lib, pid):
    st = lib.engine_state()
    if not st["db"]:
        raise _err("Engine kütüphanesi yok.", "no_engine")
    p = next((x for x in st["playlists"] if x["id"] == int(pid)), None)
    if not p:
        raise _err("Liste bulunamadı (Engine'de silinmiş olabilir).", "gone")
    cat = lib.catalog
    notes = cat.notes(st["uuid"], p["id"])
    fids = [st["fid_of_tid"].get(t) for t in p["entries"]]
    rows = {}
    ids = sorted({f for f in fids if f})
    for i in range(0, len(ids), 900):
        chunk = ids[i:i + 900]
        for r in cat.q("SELECT id, rel, name, folder, title, artist, bpm, camelot, duration, note, flags, ext "
                       "FROM files WHERE id IN (%s)" % ",".join("?" for _ in chunk), chunk):
            rows[r["id"]] = r
    place = lib.placer()
    gens = {g["id"]: g for g in lib.genre_rows()}
    out = []
    total = 0
    for ref, tid, fid in zip(p["refs"], p["entries"], fids):
        t = st["tracks"].get(tid) if tid else None
        f = rows.get(fid) if fid else None
        if f:
            kind, gid = place(f["rel"])
            g = gens.get(gid) if kind == "genre" else None
            es = st["status"].get(fid, "none")
            dot = "ready" if es == "ready" else ("problem" if es == "broken" else "pending")
            title = f.get("title") or (t or {}).get("title") or names.display(f["name"])
            artist = f.get("artist") or (t or {}).get("artist") or ""
            dur = f.get("duration") or (t or {}).get("length")
        else:
            g, dot = None, "problem"
            title = (t or {}).get("title") or (t or {}).get("filename") or "?"
            artist = (t or {}).get("artist") or ""
            dur = (t or {}).get("length")
        total += dur or 0
        out.append({"ref": ref_str(ref), "tid": tid, "fid": fid, "title": title, "artist": artist,
                    "bpm": round(f["bpm"]) if f and f.get("bpm") else (round(t["bpmAnalyzed"]) if t and t.get("bpmAnalyzed") else None),
                    "key": (f or {}).get("camelot") or "", "dur": round(dur) if dur else None,
                    "genre": g["name"] if g else None, "color": g["color"] if g else None, "dot": dot,
                    "missing": f is None, "note": notes.get(ref_str(ref), ""),
                    "fnote": (f or {}).get("note") or ""})
    return {"id": p["id"], "title": p["title"], "path": p["path"], "items": out, "dur": total,
            "managed": p["id"] in _managed(lib, st["uuid"]), "ev": cat.ev_meta(st["uuid"], p["id"])}


# ---------------------------------------------------------------------------
# Yardımcılar: dosya -> Engine kaydı (gerekirse koleksiyona ekleyerek)
# ---------------------------------------------------------------------------
def refs_for_files(lib, w, fids, d):
    """Kütüphane dosyaları için Engine referansları. Koleksiyonda yoksa eklenir (tek kez).
    Bir dosyanın birebir kopyası Engine'deyse o kayıt kullanılır (Engine'de iki kez görünmesin)."""
    from . import dedupe
    st = lib.engine_state()
    dup = dedupe.dup_index(lib)
    out, skipped = [], []
    for fid in fids:
        fid = int(fid)
        di = dup.get(fid)
        target = fid
        if di and di["kind"] in ("exact", "audio") and not di["keeper"]:
            g = next((g for g in dedupe.groups(lib) if g["id"] == di["group"]), None)
            if g:
                target = g["keeper"]
        rows = st["by_file"].get(target) or []
        tid = None
        if rows:
            tid = sorted(rows, key=lambda r: (not st["tracks"][r[0]].get("isAnalyzed"), r[0]))[0][0]
        if tid is None:
            f = lib.catalog.file(target)
            if not f or not f["present"]:
                skipped.append(fid)
                continue
            path = engine.rel_to_engine_path(f["rel"], d["lib_dir"], lib.root)
            row = w.track_by_path(path) or w.track_add(f, path)
            out.append((row["originDatabaseUuid"], row["originTrackId"]))
            continue
        tr = w.track(tid)
        out.append((tr["originDatabaseUuid"], tr["originTrackId"]))
    return out, skipped


def _ensure_events_folder(w):
    pid = w.find_child(0, EVENTS_TITLE)
    if pid:
        return pid
    return w.pl_create(0, EVENTS_TITLE)


# ---------------------------------------------------------------------------
# Yazma işlemleri (her biri tek 'Geri al' adımı)
# ---------------------------------------------------------------------------
def create(lib, parent, title, before=0):
    with Edit(lib, "Yeni liste: %s" % title) as e:
        _guard_managed(lib, e.uuid, parent)
        pid = e.w.pl_create(int(parent or 0), title, before=int(before or 0))
    return {"id": pid, "journal": e.jid}


def rename(lib, pid, title):
    with Edit(lib, "Liste adı: %s" % title) as e:
        _guard_managed(lib, e.uuid, pid)
        new = e.w.pl_rename(int(pid), title)
    return {"title": new}


def move(lib, pid, parent, before=0):
    with Edit(lib, "Liste taşındı") as e:
        _guard_managed(lib, e.uuid, pid, parent)
        p = e.w.pl(int(pid))
        if not p:
            raise _err("Liste bulunamadı.")
        e.op.title = "Liste taşındı: %s" % p["title"]
        e.w.pl_move(int(pid), int(parent or 0), int(before or 0))
    return {"ok": True}


def delete(lib, pid):
    with Edit(lib, "Liste silindi") as e:
        _guard_managed(lib, e.uuid, pid)
        p = e.w.pl(int(pid))
        if not p:
            raise _err("Liste bulunamadı.")
        sub = e.w.descendants(int(pid))
        e.op.title = "Liste silindi: %s" % p["title"] + (" (+%d alt liste)" % len(sub) if sub else "")
        e.w.pl_delete_tree(int(pid))
    return {"ok": True, "journal": e.jid}


def _copy_tree(w, src, parent, before, title=None):
    p = w.pl(src)
    new = w.pl_create(parent, title or p["title"], before=before)
    refs = w.refs(src)
    if refs:
        w.pl_set_refs(new, refs)
    for ch in w.children(src):
        _copy_tree(w, ch, new, 0)
    return new


def duplicate(lib, pid, parent=None, title=None):
    with Edit(lib, "Liste kopyalandı") as e:
        p = e.w.pl(int(pid))
        if not p:
            raise _err("Liste bulunamadı.")
        par = p["parentListId"] if parent is None else int(parent)
        _guard_managed(lib, e.uuid, par)
        before = p["nextListId"] if par == p["parentListId"] else 0
        new = _copy_tree(e.w, int(pid), par, before, title or (p["title"] + " (kopya)"))
        e.op.title = "Liste kopyalandı: %s" % e.w.pl(new)["title"]
    return {"id": new, "journal": e.jid}


def add(lib, pid, fids=None, refs=None, at=None):
    """Listeye şarkı ekler (fids: kütüphane dosyaları, refs: başka listeden 'uuid:id'). Var olanlar atlanır."""
    with Edit(lib, "Listeye eklendi") as e:
        pid = int(pid)
        _guard_managed(lib, e.uuid, pid)
        p = e.w.pl(pid)
        if not p:
            raise _err("Liste bulunamadı.")
        new, skipped = [], []
        if fids:
            r, skipped = refs_for_files(lib, e.w, fids, e.d)
            new.extend(r)
        for s in refs or []:
            new.append(parse_ref(s))
        cur = e.w.refs(pid)
        have = set(cur)
        add_ = []
        for r in new:
            if r in have or r in add_:
                skipped.append(ref_str(r))
                continue
            add_.append(r)
        if not add_:
            e.op.steps = []
            return {"added": 0, "skipped": len(skipped)}
        at = len(cur) if at is None else max(0, min(int(at), len(cur)))
        e.w.pl_set_refs(pid, cur[:at] + add_ + cur[at:])
        e.op.title = ("%d şarkı → %s" % (len(add_), p["title"])) if len(add_) != 1 else "Şarkı eklendi → %s" % p["title"]
    return {"added": len(add_), "skipped": len(skipped), "journal": e.jid}


def remove(lib, pid, refs):
    with Edit(lib, "Listeden çıkarıldı") as e:
        pid = int(pid)
        _guard_managed(lib, e.uuid, pid)
        p = e.w.pl(pid)
        drop = {parse_ref(s) for s in refs}
        cur = e.w.refs(pid)
        new = [r for r in cur if r not in drop]
        e.w.pl_set_refs(pid, new)
        n = len(cur) - len(new)
        e.op.title = ("%d şarkı çıkarıldı: %s" % (n, p["title"])) if n != 1 else "Şarkı çıkarıldı: %s" % p["title"]
    return {"removed": n}


def reorder(lib, pid, refs):
    with Edit(lib, "Sıra değişti") as e:
        pid = int(pid)
        _guard_managed(lib, e.uuid, pid)
        p = e.w.pl(pid)
        cur = e.w.refs(pid)
        want = [parse_ref(s) for s in refs]
        if set(want) != set(cur) or len(want) != len(cur):
            raise _err("Liste bu arada değişmiş; sayfayı yenileyin.", "stale")
        e.w.pl_set_refs(pid, want)
        e.op.title = "Sıra değişti: %s" % p["title"]
    return {"ok": True}


def move_entries(lib, src, dst, refs, at=None, copy=False):
    """Satırları başka listeye taşır (copy=True: kopyalar)."""
    with Edit(lib, "Şarkılar taşındı") as e:
        src, dst = int(src), int(dst)
        _guard_managed(lib, e.uuid, dst)
        if not copy:
            _guard_managed(lib, e.uuid, src)
        ps, pd = e.w.pl(src), e.w.pl(dst)
        if not ps or not pd:
            raise _err("Liste bulunamadı.")
        moving = [parse_ref(s) for s in refs]
        cur_d = e.w.refs(dst)
        have = set(cur_d)
        add_ = [r for r in moving if r not in have]
        at = len(cur_d) if at is None else max(0, min(int(at), len(cur_d)))
        if add_:
            e.w.pl_set_refs(dst, cur_d[:at] + add_ + cur_d[at:])
        if not copy and src != dst:
            drop = set(moving)
            e.w.pl_set_refs(src, [r for r in e.w.refs(src) if r not in drop])
        e.op.title = "%d şarkı %s: %s → %s" % (len(moving), "kopyalandı" if copy else "taşındı", ps["title"], pd["title"])
    return {"moved": len(add_)}


def set_note(lib, pid, ref, note):
    """Liste satırına not (ör. 'gelin girişinde 1:12'den başlat'). Yalnızca programda görünür."""
    st = lib.engine_state()
    uuid = st["uuid"]
    cat = lib.catalog
    old = cat.notes(uuid, int(pid)).get(ref)
    note = (note or "").strip()
    if (old or "") == note:
        return {"ok": True}
    op = journal.Op(lib, "not", "Not: %s" % (note[:30] or "silindi"))
    op.add({"k": "note", "db": uuid, "pid": int(pid), "ref": ref, "old": old})
    cat.set_note(uuid, int(pid), ref, note)
    op.commit()
    return {"ok": True}


def new_event(lib, title, date=None, venue=None, template=None, base=None, notes=None):
    """Yeni etkinlik: Etkinlikler klasörünün en üstüne. Şablondan (bölümler) ya da eski bir
    etkinliğin/listenin kopyası olarak başlar."""
    title = (title or "").strip() or "Yeni etkinlik"
    label = title
    if date:
        try:
            y, m, d_ = date.split("-")
            label = "%s.%s.%s - %s" % (d_, m, y, title)
        except ValueError:
            label = "%s - %s" % (date, title)
    with Edit(lib, "Yeni etkinlik: %s" % label, kind="etkinlik") as e:
        root = _ensure_events_folder(e.w)
        first = e.w.children(root)
        if base:
            src = int(base)
            if not e.w.pl(src):
                raise _err("Kopyalanacak liste bulunamadı.")
            pid = e.w.pl_create(root, label, before=first[0] if first else 0)
            refs = e.w.refs(src)
            if refs:
                e.w.pl_set_refs(pid, refs)
            for ch in e.w.children(src):
                _copy_tree(e.w, ch, pid, 0)
        else:
            pid = e.w.pl_create(root, label, before=first[0] if first else 0)
            secs = next((s for k, _t, s in TEMPLATES if k == (template or "dugun")), [])
            for sec in secs:
                e.w.pl_create(pid, sec)
        meta = {"date": date or "", "venue": venue or "", "notes": notes or "", "template": template or "",
                "created": util.now(), "title": title}
        e.op.add({"k": "evmeta", "db": e.uuid, "pid": pid, "old": None})
        lib.catalog.set_ev_meta(e.uuid, pid, meta)
    return {"id": pid, "journal": e.jid}


def set_event(lib, pid, date=None, venue=None, notes=None):
    st = lib.engine_state()
    uuid = st["uuid"]
    cat = lib.catalog
    old = cat.ev_meta(uuid, int(pid))
    new = dict(old or {})
    for k, v in (("date", date), ("venue", venue), ("notes", notes)):
        if v is not None:
            new[k] = v
    op = journal.Op(lib, "etkinlik", "Etkinlik bilgisi güncellendi")
    op.add({"k": "evmeta", "db": uuid, "pid": int(pid), "old": old})
    cat.set_ev_meta(uuid, int(pid), new)
    op.commit()
    return {"ok": True}


def search_library(lib, q, limit=200, gid=None):
    """Listeye eklemek için kütüphanede arama (ad, sanatçı, klasör, not)."""
    from .library import STATE_DIR
    words = [w for w in names.fold(q or "").split() if w]
    st = lib.engine_state()
    place = lib.placer()
    gens = {g["id"]: g for g in lib.genre_rows()}
    sql = "SELECT id, rel, name, title, artist, bpm, camelot, duration, note, search, flags FROM files " \
          "WHERE kind='audio' AND present=1"
    args = []
    for w_ in words[:6]:
        sql += " AND search LIKE ?"
        args.append("%" + w_ + "%")
    rows = lib.catalog.q(sql + " LIMIT 3000", args)
    out = []
    for f in rows:
        if f["rel"].startswith(STATE_DIR + "/"):
            continue
        kind, g = place(f["rel"])
        if kind == "ignore":
            continue
        if gid and not (kind == "genre" and g == int(gid)):
            continue
        es = st["status"].get(f["id"], "none")
        gg = gens.get(g) if kind == "genre" else None
        out.append({"id": f["id"], "title": f.get("title") or names.display(f["name"]), "artist": f.get("artist") or "",
                    "bpm": round(f["bpm"]) if f.get("bpm") else None, "key": f.get("camelot") or "",
                    "dur": round(f["duration"]) if f.get("duration") else None,
                    "genre": gg["name"] if gg else None, "color": gg["color"] if gg else None,
                    "dot": {"ready": "ready", "pending": "pending", "broken": "problem", "edup": "pending"}.get(es, "none"),
                    "note": f.get("note") or ""})
        if len(out) >= limit:
            break
    out.sort(key=lambda r: (names.fold(r["artist"]), names.fold(r["title"])))
    return out
