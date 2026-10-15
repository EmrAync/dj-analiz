"""Engine DJ veritabanı (Engine Library/Database2/m.db) okuma, onarma ve liste senkronu.

Güvenlik kuralları:
  * Okuma her zaman salt-okunur bağlantıyla yapılır.
  * Yazmadan önce: Engine DJ kapalı mı, yarım kalmış işlem (sıcak günlük) var mı,
    şema destekleniyor mu kontrol edilir; veritabanının tamamı SQLite yedekleme
    API'siyle bilgisayardaki çalışma alanına yedeklenir.
  * Tüm değişiklikler tek bir işlemde (transaction) yapılır; hata olursa hiçbir
    şey değişmez. Sonunda bütünlük denetimi çalışır.
  * Yalnızca Track.path/filename (yol onarımı), bizim oluşturduğumuz Playlist /
    PlaylistEntity satırları ve listelere eklenen yeni Track satırları yazılır.
    hm.db / sm.db / stm.db'ye dokunulmaz.
"""
from __future__ import annotations

import hashlib
import os
import posixpath
import re
import sqlite3
import urllib.request

from . import keys, names, util

ENGINE_PROCS = ["Engine DJ.exe", "Engine DJ", "Engine Prime.exe", "Engine Prime", "EnginePrime"]
JOURNAL_MAGIC = bytes([0xD9, 0xD5, 0x05, 0xF9, 0x20, 0xA1, 0x63, 0xD7])
WRITE_SCHEMAS = {(3, 0, 0), (3, 0, 1), (3, 0, 2)}


class EngineError(Exception):
    pass


def _uri(path: str, mode: str) -> str:
    return "file:" + urllib.request.pathname2url(os.path.abspath(path)) + "?mode=" + mode


def find_dbs(root: str):
    out = []
    try:
        for n in os.listdir(root):
            if n.lower() == "engine library":
                p = os.path.join(root, n, "Database2", "m.db")
                if os.path.isfile(p):
                    out.append({"key": "drive", "label": "Disk kütüphanesi (Prime 4'ün okuduğu)",
                                "path": p, "lib_dir": os.path.join(root, n), "in_root": True})
    except OSError:
        pass
    home = os.path.expanduser("~")
    for base in (os.path.join(home, "Music"), os.path.join(home, "Müzik")):
        p = os.path.join(base, "Engine Library", "Database2", "m.db")
        if os.path.isfile(p) and not any(os.path.normcase(p) == os.path.normcase(o["path"]) for o in out):
            out.append({"key": "desktop", "label": "Bilgisayar kütüphanesi (Engine DJ masaüstü)",
                        "path": p, "lib_dir": os.path.join(base, "Engine Library"), "in_root": False})
            break
    return out


def hot_journal(db_path: str) -> bool:
    j = db_path + "-journal"
    try:
        if os.path.getsize(j) < 8:
            return False
        with open(j, "rb") as f:
            return f.read(8) == JOURNAL_MAGIC
    except OSError:
        return False


def open_ro(db_path: str):
    """Salt-okunur bağlantı. Sıcak günlük varsa 'immutable' modda açar ve uyarır."""
    warn = ""
    if hot_journal(db_path):
        warn = "Engine DJ veritabanında yarım kalmış bir işlem var. Engine DJ'i bir kez açıp kapatın."
        con = sqlite3.connect(_uri(db_path, "ro") + "&immutable=1", uri=True)
    else:
        try:
            con = sqlite3.connect(_uri(db_path, "ro"), uri=True, timeout=5)
            con.execute("SELECT 1 FROM Information LIMIT 1").fetchone()
        except sqlite3.DatabaseError:
            con = sqlite3.connect(_uri(db_path, "ro") + "&immutable=1", uri=True)
            warn = "Veritabanı kilitli; anlık görüntüsü okundu."
    con.row_factory = sqlite3.Row
    return con, warn


def schema_of(con):
    r = con.execute("SELECT uuid, schemaVersionMajor, schemaVersionMinor, schemaVersionPatch FROM Information "
                    "ORDER BY id LIMIT 1").fetchone()
    return r["uuid"], (r["schemaVersionMajor"], r["schemaVersionMinor"], r["schemaVersionPatch"])


def path_to_rel(p: str, lib_dir: str, root: str):
    """Engine'deki yolu kök klasöre göre göreli yola çevirir; kök dışındaysa None."""
    if not p:
        return None
    p2 = p.replace("\\", "/")
    if re.match(r"^[A-Za-z]:/", p2) or p2.startswith("/"):
        absp = p2
    else:
        absp = posixpath.normpath(posixpath.join(lib_dir.replace("\\", "/"), p2))
    r = root.replace("\\", "/").rstrip("/")
    if os.name == "nt":
        if not absp.lower().startswith(r.lower() + "/"):
            return None
    elif not absp.startswith(r + "/"):
        return None
    return absp[len(r) + 1:]


def rel_to_engine_path(rel: str, lib_dir: str, root: str) -> str:
    lib_rel = posixpath.relpath(lib_dir.replace("\\", "/"), root.replace("\\", "/"))
    return posixpath.relpath(rel, lib_rel)


def _ordered(rows, id_key, next_key):
    """Bağlı liste (nextId) sırasına göre dizer; bozuk zincirde id sırasına düşer."""
    if not rows:
        return []
    by_id = {r[id_key]: r for r in rows}
    targets = {r[next_key] for r in rows}
    heads = [r for r in rows if r[id_key] not in targets]
    out, seen = [], set()
    for h in sorted(heads, key=lambda r: r[id_key]):
        cur = h
        while cur is not None and cur[id_key] not in seen:
            seen.add(cur[id_key])
            out.append(cur)
            cur = by_id.get(cur[next_key])
    for r in sorted(rows, key=lambda r: r[id_key]):
        if r[id_key] not in seen:
            out.append(r)
    return out


def read(db_path: str):
    con, warn = open_ro(db_path)
    try:
        uuid, ver = schema_of(con)
        cols = {r[1] for r in con.execute("PRAGMA table_info(Track)")}
        sel = ["id", "path", "filename", "title", "artist", "comment", "key", "bpmAnalyzed", "bpm",
               "isAnalyzed", "originDatabaseUuid", "originTrackId", "fileBytes", "length"]
        sel = [c for c in sel if c in cols]
        tracks = [dict(r) for r in con.execute("SELECT %s FROM Track" % ",".join(sel))]
        pls = [dict(r) for r in con.execute("SELECT id, title, parentListId, nextListId, isPersisted FROM Playlist")]
        ents = [dict(r) for r in con.execute(
            "SELECT id, listId, trackId, databaseUuid, nextEntityId FROM PlaylistEntity")]
    finally:
        con.close()
    by_origin = {(t.get("originDatabaseUuid"), t.get("originTrackId")): t for t in tracks}
    by_parent = {}
    for p in pls:
        by_parent.setdefault(p["parentListId"], []).append(p)
    ordered_pls = []
    titles = {p["id"]: p["title"] for p in pls}
    parents = {p["id"]: p["parentListId"] for p in pls}

    def path_of(pid):
        parts, guard = [], 0
        while pid and guard < 50:
            parts.append(titles.get(pid, "?"))
            pid = parents.get(pid, 0)
            guard += 1
        return list(reversed(parts))

    def walk(parent):
        for p in _ordered(by_parent.get(parent, []), "id", "nextListId"):
            ordered_pls.append(p)
            walk(p["id"])
    walk(0)
    seen = {p["id"] for p in ordered_pls}
    for p in pls:
        if p["id"] not in seen:
            ordered_pls.append(p)
    ents_by_list = {}
    for e in ents:
        ents_by_list.setdefault(e["listId"], []).append(e)
    playlists = []
    for pos, p in enumerate(ordered_pls):
        entries = []
        for e in _ordered(ents_by_list.get(p["id"], []), "id", "nextEntityId"):
            t = by_origin.get((e["databaseUuid"], e["trackId"]))
            entries.append(t["id"] if t else None)
        playlists.append({"id": p["id"], "title": p["title"], "parent": p["parentListId"],
                          "path": path_of(p["id"]), "pos": pos, "entries": entries,
                          "persisted": p.get("isPersisted")})
    return {"uuid": uuid, "schema": ".".join(map(str, ver)), "schema_t": ver, "tracks": tracks,
            "playlists": playlists, "warning": warn}


def analyze(db_info, root: str, resolver):
    """Engine kütüphanesini okur, her parçayı diskteki dosyayla eşleştirir."""
    data = read(db_info["path"])
    tracks, lists, items = [], [], []
    tmap = {}
    for t in data["tracks"]:
        rel = path_to_rel(t.get("path") or "", db_info["lib_dir"], root)
        if rel is None:
            f, m = None, "outside"
        else:
            f, m = resolver.resolve(rel)
        tmap[t["id"]] = (f, m, t)
        tracks.append({"ext_id": t["id"], "raw_path": t.get("path"), "file_id": f["id"] if f else None, "match": m,
                       "info": {"title": t.get("title"), "artist": t.get("artist"), "comment": t.get("comment"),
                                "analyzed": t.get("isAnalyzed"), "camelot": keys.engine_key_to_camelot(t.get("key")),
                                "bpm": t.get("bpmAnalyzed") or t.get("bpm"), "rel": rel}})
    for p in data["playlists"]:
        lists.append({"list_key": p["id"], "title": p["title"], "parent_key": p["parent"] or None,
                      "path": " / ".join(p["path"]), "pos": p["pos"], "count": len(p["entries"]),
                      "info": {"persisted": p.get("persisted")}})
        for i, tid in enumerate(p["entries"]):
            f, m, t = tmap.get(tid, (None, "missing", None))
            items.append({"list_key": p["id"], "pos": i, "raw_path": t.get("path") if t else None,
                          "ext_track": tid, "file_id": f["id"] if f else None, "match": m})
    return {"uuid": data["uuid"], "schema": data["schema"], "warning": data["warning"],
            "tracks": tracks, "lists": lists, "items": items}


# ---------------------------------------------------------------------------
# Yazma
# ---------------------------------------------------------------------------
def preflight(db_path: str, need_write_schema=False):
    problems = []
    if not os.path.isfile(db_path):
        raise EngineError("Engine veritabanı bulunamadı: %s" % db_path)
    running = util.process_running(ENGINE_PROCS)
    if running:
        problems.append("Engine DJ şu anda açık. Lütfen Engine DJ'i tamamen kapatın.")
    if hot_journal(db_path):
        problems.append("Veritabanında yarım kalmış bir işlem var. Engine DJ'i bir kez açıp düzgünce kapatın.")
    try:
        con, _ = open_ro(db_path)
        uuid, ver = schema_of(con)
        con.close()
    except Exception as e:
        raise EngineError("Engine veritabanı okunamadı: %s" % e)
    if need_write_schema and tuple(ver) not in WRITE_SCHEMAS:
        problems.append("Bu Engine sürümünün veritabanı (şema %s) için liste yazma desteklenmiyor. "
                        "Engine DJ 4.x / 5.x gerekir." % ".".join(map(str, ver)))
    if not os.access(db_path, os.W_OK):
        problems.append("Veritabanına yazma izni yok (disk salt-okunur olabilir).")
    if problems:
        raise EngineError(" ".join(problems))
    return uuid, ver


def backup(db_path: str, dest_dir: str, label: str = "") -> str:
    os.makedirs(dest_dir, exist_ok=True)
    dst = util.unique_path(os.path.join(dest_dir, "engine_m_%s%s.db" % (util.stamp(), ("_" + label) if label else "")))
    src, _ = open_ro(db_path)
    try:
        out = sqlite3.connect(dst)
        try:
            src.backup(out)
        finally:
            out.close()
    finally:
        src.close()
    chk = sqlite3.connect(dst)
    try:
        ok = chk.execute("PRAGMA quick_check").fetchone()[0]
    finally:
        chk.close()
    if ok != "ok":
        raise EngineError("Yedek doğrulanamadı; işlem yapılmadı.")
    return dst


def fingerprint(db_path: str) -> str:
    """Veritabanının mantıksal içeriğinin özeti (tüm tablolar, tüm satırlar).

    Sayfa düzeninden bağımsızdır: yedekten geri yüklenen bir veritabanı, yedeği
    alındığı andaki özetin aynısını verir. Geri almadan önce "bu işlemden sonra
    Engine DJ / Prime 4 veritabanını değiştirdi mi?" sorusunu yanıtlamak için kullanılır.
    """
    con, _ = open_ro(db_path)
    con.row_factory = None
    con.text_factory = bytes
    try:
        h = hashlib.blake2b(digest_size=16)
        tables = [r[0] for r in con.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")]
        for t in tables:
            tq = '"%s"' % t.decode("utf-8", "replace").replace('"', '""')
            h.update(b"\x00T" + t)
            try:
                cur = con.execute("SELECT * FROM %s ORDER BY rowid" % tq)
            except sqlite3.OperationalError:
                cur = con.execute("SELECT * FROM %s" % tq)
            for row in cur:
                for v in row:
                    if v is None:
                        h.update(b"\x01")
                    elif isinstance(v, bytes):
                        h.update(b"\x02" + len(v).to_bytes(8, "little"))
                        h.update(v)
                    else:
                        s = repr(v).encode()
                        h.update(b"\x03" + len(s).to_bytes(2, "little") + s)
                h.update(b"\n")
        return h.hexdigest()
    finally:
        con.close()


def restore(db_path: str, backup_path: str):
    if util.process_running(ENGINE_PROCS):
        raise EngineError("Engine DJ açıkken geri yükleme yapılamaz. Lütfen kapatın.")
    src = sqlite3.connect(_uri(backup_path, "ro"), uri=True)
    dst = sqlite3.connect(db_path, timeout=3)
    try:
        src.backup(dst)
        ok = dst.execute("PRAGMA quick_check").fetchone()[0]
        if ok != "ok":
            raise EngineError("Geri yükleme sonrası denetim başarısız: %s" % ok)
    finally:
        src.close()
        dst.close()
    return True


class Writer:
    """Tek bir işlem içinde Engine veritabanına yazar."""

    def __init__(self, db_path: str, lib_dir: str, root: str):
        self.db_path = db_path
        self.lib_dir = lib_dir
        self.root = root
        self.con = sqlite3.connect(db_path, timeout=3, isolation_level=None)
        self.con.row_factory = sqlite3.Row
        self.con.execute("PRAGMA foreign_keys=ON")
        try:
            self.con.execute("BEGIN IMMEDIATE")
        except sqlite3.OperationalError:
            self.con.close()
            raise EngineError("Engine veritabanı kilitli (Engine DJ veya bir cihaz kullanıyor olabilir).")
        self.uuid, self.ver = schema_of(self.con)
        self.track_cols = {r[1] for r in self.con.execute("PRAGMA table_info(Track)")}
        self.stats = {"paths_fixed": 0, "tracks_added": 0, "playlists": 0, "entries": 0, "removed_playlists": 0}
        self.fk_before = len(self.con.execute("PRAGMA foreign_key_check").fetchall())

    # -- yol onarımı ------------------------------------------------------
    def fix_path(self, track_id: int, old_path: str, new_path: str):
        clash = self.con.execute("SELECT id FROM Track WHERE path=? AND id<>?", (new_path, track_id)).fetchone()
        if clash:
            return "cakisma"
        cur = self.con.execute("UPDATE Track SET path=?, filename=? WHERE id=? AND path=?",
                               (new_path, posixpath.basename(new_path), track_id, old_path))
        if cur.rowcount == 1:
            self.stats["paths_fixed"] += 1
            return "ok"
        return "degismis"

    # -- parça ekleme ------------------------------------------------------
    def track_for_path(self, engine_path: str):
        r = self.con.execute("SELECT id, originDatabaseUuid, originTrackId FROM Track WHERE path=?",
                             (engine_path,)).fetchone()
        return dict(r) if r else None

    def add_track(self, f, engine_path: str):
        ts = util.now()
        ext = os.path.splitext(f.get("name") or engine_path)[1].lstrip(".")
        art = self.con.execute("SELECT id FROM AlbumArt WHERE id=1").fetchone()
        vals = {
            "playOrder": None, "length": int(round(f["duration"])) if f.get("duration") else None,
            "bpm": int(round(f["bpm"])) if f.get("bpm") else None, "year": f.get("year"),
            "path": engine_path, "filename": posixpath.basename(engine_path),
            "bitrate": f.get("bitrate"), "bpmAnalyzed": None, "albumArtId": 1 if art else None,
            "fileBytes": f.get("size"), "title": f.get("title") or os.path.splitext(f.get("name") or "")[0],
            "artist": f.get("artist") or None, "album": f.get("album") or None, "genre": f.get("genre") or None,
            "comment": f.get("comment") or None, "label": f.get("label") or None,
            "composer": f.get("composer") or None, "remixer": f.get("remixer") or None,
            "key": keys.camelot_to_engine_key(f.get("camelot") or ""), "rating": 0, "albumArt": None,
            "timeLastPlayed": None, "isPlayed": 0, "fileType": ext, "isAnalyzed": 0,
            "dateCreated": int((f.get("mtime") or ts * 1000) // 1000), "dateAdded": ts, "isAvailable": 1,
            "isMetadataOfPackedTrackChanged": 0, "isPerfomanceDataOfPackedTrackChanged": 0,
            "playedIndicator": None, "isMetadataImported": 0, "pdbImportKey": 0, "streamingSource": None,
            "uri": None, "isBeatGridLocked": 0, "streamingFlags": 0, "explicitLyrics": 0, "lastEditTime": ts,
        }
        cols = [c for c in vals if c in self.track_cols]
        cur = self.con.execute("INSERT INTO Track(%s) VALUES(%s)" % (",".join(cols), ",".join("?" for _ in cols)),
                               [vals[c] for c in cols])
        tid = cur.lastrowid
        r = self.con.execute("SELECT id, originDatabaseUuid, originTrackId FROM Track WHERE id=?", (tid,)).fetchone()
        self.stats["tracks_added"] += 1
        return dict(r)

    def origin_of(self, track_id: int):
        r = self.con.execute("SELECT originDatabaseUuid, originTrackId FROM Track WHERE id=?", (track_id,)).fetchone()
        return (r["originDatabaseUuid"], r["originTrackId"]) if r else None

    def repoint(self, from_origin, to_origin):
        """Listelerdeki bir parçayı başka bir parçayla değiştirir (çift birleştirme)."""
        upd = dele = 0
        rows = self.con.execute("SELECT id, listId FROM PlaylistEntity WHERE databaseUuid=? AND trackId=?",
                                from_origin).fetchall()
        for r in rows:
            exists = self.con.execute("SELECT 1 FROM PlaylistEntity WHERE listId=? AND databaseUuid=? AND trackId=?",
                                      (r["listId"], to_origin[0], to_origin[1])).fetchone()
            if exists:
                self.con.execute("DELETE FROM PlaylistEntity WHERE id=?", (r["id"],))
                dele += 1
            else:
                self.con.execute("UPDATE PlaylistEntity SET databaseUuid=?, trackId=? WHERE id=?",
                                 (to_origin[0], to_origin[1], r["id"]))
                upd += 1
        return upd, dele

    def set_path_raw(self, track_id: int, path: str, expect: str):
        cur = self.con.execute("UPDATE Track SET path=?, filename=? WHERE id=? AND path=?",
                               (path, posixpath.basename(path), track_id, expect))
        return cur.rowcount == 1

    # -- çalma listeleri -----------------------------------------------------
    def playlist_exists(self, pid):
        return self.con.execute("SELECT id, title, parentListId FROM Playlist WHERE id=?", (pid,)).fetchone()

    def find_child(self, parent: int, title: str):
        r = self.con.execute("SELECT id FROM Playlist WHERE parentListId=? AND title=?", (parent, title)).fetchone()
        return r["id"] if r else None

    def is_empty(self, pid):
        if self.con.execute("SELECT 1 FROM Playlist WHERE parentListId=? LIMIT 1", (pid,)).fetchone():
            return False
        return not self.con.execute("SELECT 1 FROM PlaylistEntity WHERE listId=? LIMIT 1", (pid,)).fetchone()

    def create_playlist(self, parent: int, title: str, exported: int = 0) -> int:
        title = clean_title(title)
        base, n = title, 2
        while self.find_child(parent, title):
            title = "%s (%d)" % (base, n)
            n += 1
        cur = self.con.execute(
            "INSERT INTO Playlist(title, parentListId, isPersisted, nextListId, lastEditTime, isExplicitlyExported) "
            "VALUES(?,?,1,0,datetime('now'),?)", (title, parent, exported))
        self.stats["playlists"] += 1
        return cur.lastrowid

    def descendants(self, pid):
        out, stack = [], [pid]
        while stack:
            cur = stack.pop()
            for r in self.con.execute("SELECT id FROM Playlist WHERE parentListId=?", (cur,)):
                out.append(r["id"])
                stack.append(r["id"])
        return out

    def clear_children(self, pid):
        """Bizim klasörümüzün altındaki her şeyi siler (önce en derindekiler)."""
        desc = self.descendants(pid)
        depth = {}
        for d in desc:
            k, cur = 0, d
            while cur and cur != pid and k < 60:
                r = self.con.execute("SELECT parentListId FROM Playlist WHERE id=?", (cur,)).fetchone()
                cur = r["parentListId"] if r else 0
                k += 1
            depth[d] = k
        for d in sorted(desc, key=lambda x: -depth[x]):
            self.con.execute("DELETE FROM PlaylistEntity WHERE listId=?", (d,))
            self.con.execute("DELETE FROM Playlist WHERE id=?", (d,))
            self.stats["removed_playlists"] += 1

    def set_entries(self, pid: int, origin_refs):
        """origin_refs: [(originDatabaseUuid, originTrackId)] sırasıyla."""
        self.con.execute("DELETE FROM PlaylistEntity WHERE listId=?", (pid,))
        ids, seen = [], set()
        for uuid, tid in origin_refs:
            if (uuid, tid) in seen:
                continue
            seen.add((uuid, tid))
            cur = self.con.execute(
                "INSERT INTO PlaylistEntity(listId, trackId, databaseUuid, nextEntityId, membershipReference) "
                "VALUES(?,?,?,0,0)", (pid, tid, uuid))
            ids.append(cur.lastrowid)
        for a, b in zip(ids, ids[1:]):
            self.con.execute("UPDATE PlaylistEntity SET nextEntityId=? WHERE id=?", (b, a))
        self.con.execute("UPDATE Playlist SET lastEditTime=datetime('now') WHERE id=?", (pid,))
        self.stats["entries"] += len(ids)
        # zincir doğrulaması
        if ids:
            rows = [dict(r) for r in self.con.execute(
                "SELECT id, nextEntityId FROM PlaylistEntity WHERE listId=?", (pid,))]
            order = [r["id"] for r in _ordered(rows, "id", "nextEntityId")]
            if order != ids:
                raise EngineError("Liste sırası doğrulanamadı; hiçbir değişiklik yapılmadı.")
        return len(ids)

    # -- bitiş -----------------------------------------------------------------
    def commit(self):
        fk_after = len(self.con.execute("PRAGMA foreign_key_check").fetchall())
        if fk_after > self.fk_before:
            self.rollback()
            raise EngineError("Bütünlük denetimi başarısız (yabancı anahtar); değişiklikler geri alındı.")
        self.con.execute("COMMIT")
        ok = self.con.execute("PRAGMA quick_check").fetchone()[0]
        self.con.close()
        if ok != "ok":
            raise EngineError("Yazma sonrası denetim uyarısı: %s — yedekten geri yükleyebilirsiniz." % ok)
        return self.stats

    def rollback(self):
        try:
            self.con.execute("ROLLBACK")
        except Exception:
            pass
        try:
            self.con.close()
        except Exception:
            pass


def clean_title(t: str) -> str:
    t = (t or "Adsız").replace(";", ",").strip()
    return t[:120] or "Adsız"
