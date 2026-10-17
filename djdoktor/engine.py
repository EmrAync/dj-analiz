"""Engine DJ veritabanı (Engine Library/Database2/m.db): okuma ve doğrudan düzenleme.

v2'de listeler programın içinde ayrıca tutulmaz: program, SSD'deki Engine
veritabanının çalma listelerini DOĞRUDAN okur ve yazar. Prime 4 de aynı
veritabanını okuduğu için "gönder / al" adımı yoktur.

Güvenlik kuralları:
  * Okuma her zaman salt-okunur bağlantıyla yapılır.
  * Yazmadan önce: Engine DJ kapalı mı, yarım kalmış işlem (sıcak günlük) var mı,
    şema destekleniyor mu kontrol edilir.
  * Her işlem tek bir SQLite işleminde (transaction) yapılır; hata olursa hiçbir
    şey değişmez. Sonunda yabancı anahtar ve bütünlük denetimi çalışır.
  * Her yazma adımının TERSİ kaydedilir (geri alma). Engine'in kendi kuralları
    (tetikleyiciler) korunur: liste sırası bağlı liste (nextListId / nextEntityId)
    olarak tutulur; silinen parça kimliği yeniden kullanılamaz.
  * hm.db / sm.db / stm.db'ye dokunulmaz.
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


class EngineError(Exception):
    pass


class UndoConflict(EngineError):
    """Geri alınacak durum sonradan değişmiş (Engine DJ / Prime 4'te düzenlenmiş)."""


def _uri(path: str, mode: str) -> str:
    return "file:" + urllib.request.pathname2url(os.path.abspath(path)) + "?mode=" + mode


def find_dbs(root: str):
    out = []
    try:
        for n in os.listdir(root):
            if n.lower() == "engine library":
                p = os.path.join(root, n, "Database2", "m.db")
                if os.path.isfile(p):
                    out.append({"key": "drive", "label": "SSD'deki Engine kütüphanesi (Prime 4'ün okuduğu)",
                                "path": p, "lib_dir": os.path.join(root, n), "in_root": True})
    except OSError:
        pass
    home = os.path.expanduser("~")
    for base in (os.path.join(home, "Music"), os.path.join(home, "Müzik")):
        p = os.path.join(base, "Engine Library", "Database2", "m.db")
        if os.path.isfile(p) and not any(os.path.normcase(p) == os.path.normcase(o["path"]) for o in out):
            out.append({"key": "desktop", "label": "Bilgisayardaki Engine kütüphanesi",
                        "path": p, "lib_dir": os.path.join(base, "Engine Library"), "in_root": False})
            break
    return out


def drive_db(root: str):
    for d in find_dbs(root):
        if d["key"] == "drive":
            return d
    return None


def is_running(fresh: bool = False) -> bool:
    return bool(util.process_running(ENGINE_PROCS, fresh=fresh))


def hot_journal(db_path: str) -> bool:
    j = db_path + "-journal"
    try:
        if os.path.getsize(j) < 8:
            return False
        with open(j, "rb") as f:
            return f.read(8) == JOURNAL_MAGIC
    except OSError:
        return False


def recover(db_path: str) -> bool:
    """Yarım kalmış işlem (sıcak günlük) varsa ve Engine DJ KAPALIYSA SQLite'ın kendi kurtarmasını çalıştırır:
    yarım işlem geri sarılır, veritabanı işlemden önceki sağlam hâline döner."""
    if not hot_journal(db_path) or is_running(fresh=True):
        return False
    try:
        con = sqlite3.connect(db_path, timeout=5)
        try:
            con.execute("SELECT COUNT(*) FROM sqlite_master").fetchone()
        finally:
            con.close()
    except sqlite3.DatabaseError:
        return False
    _wrote()
    return not hot_journal(db_path)


def open_ro(db_path: str):
    """Salt-okunur bağlantı. Sıcak günlük varsa 'immutable' modda açar ve uyarır."""
    warn = ""
    recover(db_path)
    if hot_journal(db_path):
        warn = "Engine DJ veritabanında yarım kalmış bir işlem var. Engine DJ'i bir kez açıp kapat."
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


_WRITES = [0]   # bu programın yaptığı Engine yazımlarının sayacı (önbellekler için)


def _wrote():
    _WRITES[0] += 1


def db_stamp(db_path: str):
    """Değişiklik algılamak için ucuz damga.

    Yalnızca boyut + zaman yetmez: exFAT'te değiştirilme zamanı 1–2 saniye hassasiyetinde olabilir ve
    liste adı değiştirmek dosya boyutunu değiştirmez. Bu yüzden SQLite başlığı (her kayıtta artan
    'değişiklik sayacı' dahil, ilk 100 bayt), WAL başlığı ve programın kendi yazma sayacı da eklenir."""
    out = [_WRITES[0]]
    for p, head in ((db_path, 100), (db_path + "-journal", 0), (db_path + "-wal", 32)):
        try:
            st = os.stat(p)
            h = ""
            if head:
                with open(p, "rb") as f:
                    h = hashlib.md5(f.read(head)).hexdigest()[:16]
            out.append((st.st_size, int(st.st_mtime_ns), h))
        except OSError:
            out.append(None)
    return tuple(out)


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
    """Kanonik (disk biçimi) göreli yoldan SSD veritabanına yazılacak yol: NFC, '/' ile."""
    lib_rel = posixpath.relpath(lib_dir.replace("\\", "/"), root.replace("\\", "/"))
    return posixpath.relpath(names.nfc(rel), lib_rel)


def repath(old_engine_path: str, old_rel_hint: str, new_rel: str, lib_dir: str, root: str) -> str:
    """Bir parçanın Engine yolunu yeni konuma çevirir; yolun biçimini (göreli/mutlak) korur."""
    p = old_engine_path.replace("\\", "/")
    if re.match(r"^[A-Za-z]:/", p) or p.startswith("/"):
        r = root.replace("\\", "/").rstrip("/")
        return r + "/" + names.nfc(new_rel)
    return rel_to_engine_path(new_rel, lib_dir, root)


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


TRACK_COLS = ["id", "path", "filename", "title", "artist", "album", "genre", "comment", "key", "bpmAnalyzed", "bpm",
              "length", "isAnalyzed", "originDatabaseUuid", "originTrackId", "fileBytes", "rating", "dateAdded"]


def read(db_path: str):
    """Tüm parçaları ve çalma listelerini (sıralı) okur."""
    con, warn = open_ro(db_path)
    try:
        uuid, ver = schema_of(con)
        cols = {r[1] for r in con.execute("PRAGMA table_info(Track)")}
        sel = [c for c in TRACK_COLS if c in cols]
        tracks = [dict(r) for r in con.execute("SELECT %s FROM Track" % ",".join(sel))]
        perf = {}
        try:
            for r in con.execute("SELECT trackId, length(quickCues) AS qc, length(beatData) AS bd FROM PerformanceData"):
                perf[r["trackId"]] = (r["qc"] or 0, r["bd"] or 0)
        except sqlite3.DatabaseError:
            pass
        pls = [dict(r) for r in con.execute("SELECT id, title, parentListId, nextListId, isPersisted FROM Playlist")]
        ents = [dict(r) for r in con.execute(
            "SELECT id, listId, trackId, databaseUuid, nextEntityId FROM PlaylistEntity")]
    finally:
        con.close()
    for t in tracks:
        p = perf.get(t["id"])
        t["has_grid"] = bool(p and p[1])
    by_origin = {(t.get("originDatabaseUuid"), t.get("originTrackId")): t for t in tracks}
    by_parent = {}
    for p in pls:
        by_parent.setdefault(p["parentListId"], []).append(p)
    titles = {p["id"]: p["title"] for p in pls}
    parents = {p["id"]: p["parentListId"] for p in pls}

    def path_of(pid):
        parts, guard = [], 0
        while pid and guard < 60:
            parts.append(titles.get(pid, "?"))
            pid = parents.get(pid, 0)
            guard += 1
        return list(reversed(parts))

    ordered_pls = []

    def walk(parent, depth):
        for p in _ordered(by_parent.get(parent, []), "id", "nextListId"):
            p["depth"] = depth
            ordered_pls.append(p)
            walk(p["id"], depth + 1)
    walk(0, 0)
    seen = {p["id"] for p in ordered_pls}
    for p in pls:
        if p["id"] not in seen:  # yetim (üst listesi olmayan) kayıtlar
            p["depth"] = 0
            ordered_pls.append(p)
    ents_by_list = {}
    for e in ents:
        ents_by_list.setdefault(e["listId"], []).append(e)
    playlists = []
    for pos, p in enumerate(ordered_pls):
        refs, entries = [], []
        for e in _ordered(ents_by_list.get(p["id"], []), "id", "nextEntityId"):
            refs.append((e["databaseUuid"], e["trackId"]))
            t = by_origin.get((e["databaseUuid"], e["trackId"]))
            entries.append(t["id"] if t else None)
        playlists.append({"id": p["id"], "title": p["title"], "parent": p["parentListId"] or 0,
                          "path": path_of(p["id"]), "pos": pos, "depth": p["depth"], "refs": refs,
                          "entries": entries, "persisted": p.get("isPersisted")})
    return {"uuid": uuid, "schema": ".".join(map(str, ver)), "schema_t": ver, "tracks": tracks,
            "by_origin": by_origin, "playlists": playlists, "warning": warn}


# ---------------------------------------------------------------------------
# Yazmadan önce denetimler, yedek, anlamsal parmak izi
# ---------------------------------------------------------------------------
def preflight(db_path: str):
    problems = []
    if not os.path.isfile(db_path):
        raise EngineError("Engine veritabanı bulunamadı: %s" % db_path)
    if is_running(fresh=True):
        problems.append("Engine DJ şu anda açık. Değişiklikler için Engine DJ'i kapat.")
    recover(db_path)
    if hot_journal(db_path):
        problems.append("Veritabanında yarım kalmış bir işlem var. Engine DJ'i bir kez açıp düzgünce kapat.")
    try:
        con, _ = open_ro(db_path)
        uuid, ver = schema_of(con)
        con.close()
    except Exception as e:
        raise EngineError("Engine veritabanı okunamadı: %s" % e)
    if ver[0] != 3:
        problems.append("Bu Engine sürümünün veritabanı (şema %s) desteklenmiyor; Engine DJ 3.x veya üstü gerekir."
                        % ".".join(map(str, ver)))
    if not os.access(db_path, os.W_OK):
        problems.append("Engine veritabanına yazma izni yok (disk salt-okunur olabilir).")
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


def prune_backups(dest_dir: str, keep: int = 12):
    try:
        files = sorted((f for f in os.listdir(dest_dir) if f.startswith("engine_m_") and f.endswith(".db")),
                       key=lambda f: os.path.getmtime(os.path.join(dest_dir, f)))
    except OSError:
        return
    for f in files[:-keep]:
        try:
            os.remove(os.path.join(dest_dir, f))
        except OSError:
            pass


def semantic_fingerprint(db_path: str) -> str:
    """Veritabanının ANLAMSAL özeti.

    Satır kimliklerinin yeniden numaralanmasından (ör. liste girdilerinin yeniden
    yazılması) ve zaman damgalarından etkilenmez; listeleri başlık yolu ve sıralı
    içerikleriyle, parçaları tüm alanlarıyla özetler. Yedekten geri dönmeden önce
    "arada Engine DJ / Prime 4 bir şey değiştirdi mi?" sorusunu yanıtlar.
    """
    con, _ = open_ro(db_path)
    con.row_factory = None
    try:
        h = hashlib.blake2b(digest_size=16)

        def feed(row):
            for v in row:
                if v is None:
                    h.update(b"\x01")
                elif isinstance(v, bytes):
                    h.update(b"\x02" + len(v).to_bytes(8, "little"))
                    h.update(v)
                else:
                    s = repr(v).encode("utf-8", "replace")
                    h.update(b"\x03" + len(s).to_bytes(4, "little") + s)
            h.update(b"\n")

        cols = [r[1] for r in con.execute("PRAGMA table_info(Track)") if r[1] not in ("lastEditTime",)]
        h.update(b"T")
        for row in con.execute("SELECT %s FROM Track ORDER BY id" % ",".join('"%s"' % c for c in cols)):
            feed(row)
        h.update(b"P")
        try:
            for row in con.execute("SELECT trackId, trackData, overviewWaveFormData, beatData, quickCues, loops, "
                                   "activeOnLoadLoops FROM PerformanceData ORDER BY trackId"):
                feed(row)
        except sqlite3.DatabaseError:
            pass
        pls = {r[0]: r for r in con.execute("SELECT id, title, parentListId, nextListId, isPersisted, "
                                              "isExplicitlyExported FROM Playlist")}
        ents = {}
        for r in con.execute("SELECT id, listId, trackId, databaseUuid, nextEntityId FROM PlaylistEntity"):
            ents.setdefault(r[1], []).append({"id": r[0], "t": r[2], "u": r[3], "n": r[4]})
        by_parent = {}
        for r in pls.values():
            by_parent.setdefault(r[2], []).append({"id": r[0], "n": r[3]})

        def walk(parent, prefix):
            for p in _ordered(by_parent.get(parent, []), "id", "n"):
                r = pls[p["id"]]
                path = prefix + (r[1],)
                h.update(b"L")
                feed(path + (r[4], r[5]))
                for e in _ordered(ents.get(p["id"], []), "id", "n"):
                    feed((e["u"], e["t"]))
                walk(p["id"], path)
        walk(0, ())
        for table in ("AlbumArt", "Smartlist", "PreparelistEntity", "Information"):
            try:
                h.update(table.encode())
                for row in con.execute("SELECT * FROM %s ORDER BY 1" % table):
                    feed(row)
            except sqlite3.DatabaseError:
                pass
        return h.hexdigest()
    finally:
        con.close()


def restore(db_path: str, backup_path: str):
    if is_running(fresh=True):
        raise EngineError("Engine DJ açıkken geri yükleme yapılamaz. Lütfen kapat.")
    src = sqlite3.connect(_uri(backup_path, "ro"), uri=True)
    dst = sqlite3.connect(db_path, timeout=3)
    try:
        src.backup(dst)
        _wrote()
        ok = dst.execute("PRAGMA quick_check").fetchone()[0]
        if ok != "ok":
            raise EngineError("Geri yükleme sonrası denetim başarısız: %s" % ok)
    finally:
        src.close()
        dst.close()
    return True


def clean_title(t: str) -> str:
    t = (t or "Adsız").replace(";", ",").replace("\n", " ").strip()
    return t[:120] or "Adsız"


# ---------------------------------------------------------------------------
# Yazıcı: her adımın tersini kaydeder
# ---------------------------------------------------------------------------
class Writer:
    """Tek bir işlem içinde Engine veritabanına yazar ve geri alma adımlarını biriktirir.

    self.steps: tersine çevirme adımları (uygulama sırasıyla). Geri almada sondan başa çalıştırılır.
    """

    def __init__(self, db_path: str, lib_dir: str, root: str, check_running: bool = True):
        if check_running and is_running(fresh=True):
            raise EngineError("Engine DJ açık. Değişiklik yapmak için Engine DJ'i kapat.")
        recover(db_path)
        if hot_journal(db_path):
            raise EngineError("Engine veritabanında yarım kalmış bir işlem var. Engine DJ'i bir kez açıp kapat.")
        self.db_path = db_path
        self.lib_dir = lib_dir
        self.root = root
        self.con = sqlite3.connect(db_path, timeout=4, isolation_level=None)
        self.con.row_factory = sqlite3.Row
        self.con.execute("PRAGMA foreign_keys=ON")
        try:
            self.con.execute("BEGIN IMMEDIATE")
        except sqlite3.OperationalError:
            self.con.close()
            raise EngineError("Engine veritabanı kilitli (Engine DJ veya başka bir program kullanıyor olabilir).")
        self.uuid, self.ver = schema_of(self.con)
        if self.ver[0] != 3:
            self.rollback()
            raise EngineError("Engine veritabanı şeması %s desteklenmiyor." % ".".join(map(str, self.ver)))
        self.track_cols = {r[1] for r in self.con.execute("PRAGMA table_info(Track)")}
        self.steps = []
        self.changed_lists = set()
        self.stats = {"paths": 0, "added": 0, "lists": 0, "entries": 0, "deleted_tracks": 0}
        self.fk_before = len(self.con.execute("PRAGMA foreign_key_check").fetchall())
        self._tc0 = self.con.total_changes
        self._open = True

    def changed(self) -> bool:
        """Bu işlemde veritabanına gerçekten bir şey yazıldı mı?"""
        return self.con.total_changes != self._tc0

    # -- yardımcılar -----------------------------------------------------------
    def q1(self, sql, args=()):
        r = self.con.execute(sql, args).fetchone()
        return dict(r) if r else None

    def children(self, parent: int):
        rows = [dict(r) for r in self.con.execute(
            "SELECT id, nextListId FROM Playlist WHERE parentListId=?", (parent,))]
        return [r["id"] for r in _ordered(rows, "id", "nextListId")]

    def pl(self, pid: int):
        return self.q1("SELECT id, title, parentListId, nextListId, isPersisted, isExplicitlyExported "
                       "FROM Playlist WHERE id=?", (pid,))

    def find_child(self, parent: int, title: str):
        r = self.q1("SELECT id FROM Playlist WHERE parentListId=? AND title=?", (parent, title))
        return r["id"] if r else None

    def unique_title(self, parent: int, title: str, exclude: int = None) -> str:
        title = clean_title(title)
        base, n, cand = title, 2, title
        while True:
            r = self.q1("SELECT id FROM Playlist WHERE parentListId=? AND title=?", (parent, cand))
            if not r or r["id"] == exclude:
                return cand
            cand = "%s (%d)" % (base, n)
            n += 1

    def descendants(self, pid):
        """Alt listeler: önce derindekiler, kardeşler sırasıyla (silme sırası)."""
        out = []

        def post(node):
            for c in self.children(node):
                post(c)
                out.append(c)
        post(pid)
        return out

    def refs(self, pid: int):
        rows = [dict(r) for r in self.con.execute(
            "SELECT id, trackId, databaseUuid, nextEntityId FROM PlaylistEntity WHERE listId=?", (pid,))]
        return [(r["databaseUuid"], r["trackId"]) for r in _ordered(rows, "id", "nextEntityId")]

    def _entity_rows(self, pid):
        rows = [dict(r) for r in self.con.execute(
            "SELECT id, trackId, databaseUuid, nextEntityId FROM PlaylistEntity WHERE listId=?", (pid,))]
        return _ordered(rows, "id", "nextEntityId")

    # -- çalma listeleri -------------------------------------------------------------
    def pl_create(self, parent: int, title: str, before: int = 0, persisted: int = 1, exported: int = 0,
                  record=True) -> int:
        if parent and not self.pl(parent):
            raise EngineError("Üst liste bulunamadı.")
        if before:
            b = self.pl(before)
            if not b or b["parentListId"] != parent:
                before = 0
        title = self.unique_title(parent, title)
        cur = self.con.execute(
            "INSERT INTO Playlist(title, parentListId, isPersisted, nextListId, lastEditTime, isExplicitlyExported) "
            "VALUES(?,?,?,?,datetime('now'),?)", (title, parent, persisted, before, exported))
        pid = cur.lastrowid
        if record:
            self.steps.append({"op": "pl_del", "id": pid})
        self.stats["lists"] += 1
        self.changed_lists.add(pid)
        return pid

    def pl_rename(self, pid: int, title: str, record=True):
        p = self.pl(pid)
        if not p:
            raise EngineError("Liste bulunamadı.")
        new = self.unique_title(p["parentListId"], title, exclude=pid)
        if new == p["title"]:
            return new
        self.con.execute("UPDATE Playlist SET title=?, lastEditTime=datetime('now') WHERE id=?", (new, pid))
        if record:
            self.steps.append({"op": "pl_ren", "id": pid, "title": p["title"], "expect": new})
        self.changed_lists.add(pid)
        return new

    def pl_move(self, pid: int, parent: int, before: int = 0, record=True):
        """Listeyi başka bir üst listeye ve/veya sıraya taşır (before=0: sona)."""
        p = self.pl(pid)
        if not p:
            raise EngineError("Liste bulunamadı.")
        if parent == pid or (parent and parent in self.descendants(pid)):
            raise EngineError("Bir liste kendi içine taşınamaz.")
        if parent and not self.pl(parent):
            raise EngineError("Hedef klasör bulunamadı.")
        if before == pid:
            return
        if before:
            b = self.pl(before)
            if not b or b["parentListId"] != parent:
                before = 0
        old_parent, old_next = p["parentListId"], p["nextListId"]
        if old_parent == parent and old_next == before:
            return
        # 1) yerinden çıkar: önce kendi işaretçisini geçici benzersiz bir değere çek
        tmp = -(10_000_000 + pid)
        self.con.execute("UPDATE Playlist SET nextListId=? WHERE id=?", (tmp, pid))
        self.con.execute("UPDATE Playlist SET nextListId=? WHERE parentListId=? AND nextListId=? AND id<>?",
                         (old_next, old_parent, pid, pid))
        # 2) yeni yere tak
        self.con.execute("UPDATE Playlist SET nextListId=? WHERE parentListId=? AND nextListId=? AND id<>?",
                         (pid, parent, before, pid))
        title = self.unique_title(parent, p["title"], exclude=pid)
        self.con.execute("UPDATE Playlist SET parentListId=?, nextListId=?, title=?, lastEditTime=datetime('now') "
                         "WHERE id=?", (parent, before, title, pid))
        if record:
            self.steps.append({"op": "pl_mv", "id": pid, "parent": old_parent, "before": old_next,
                               "title": p["title"]})
        self.changed_lists.add(pid)

    def pl_delete_tree(self, pid: int, record=True):
        """Listeyi alt listeleriyle siler; her birini geri getirmek için kaydeder."""
        if not self.pl(pid):
            return
        order = self.descendants(pid) + [pid]
        for nid in order:
            p = self.pl(nid)
            refs = self.refs(nid)
            if record:
                self.steps.append({"op": "pl_recreate", "old_id": nid, "title": p["title"],
                                   "parent": p["parentListId"], "before": p["nextListId"], "refs": refs,
                                   "persisted": p["isPersisted"], "exported": p["isExplicitlyExported"]})
            self.con.execute("DELETE FROM PlaylistEntity WHERE listId=?", (nid,))
            self.con.execute("DELETE FROM Playlist WHERE id=?", (nid,))
            self.changed_lists.add(nid)

    def pl_set_refs(self, pid: int, new_refs, record=True):
        """Listenin içeriğini verilen sıraya getirir. Mümkünse yalnızca ekler/çıkarır."""
        if not self.pl(pid):
            raise EngineError("Liste bulunamadı.")
        seen, clean = set(), []
        for r in new_refs:
            r = (r[0], int(r[1]))
            if r not in seen:          # Engine aynı parçayı bir listede iki kez tutamaz
                seen.add(r)
                clean.append(r)
        rows = self._entity_rows(pid)
        cur = [(r["databaseUuid"], r["trackId"]) for r in rows]
        if cur == clean:
            return False
        cur_set = set(cur)
        if clean[:len(cur)] == cur:                     # yalnızca sona ekleme
            last = rows[-1]["id"] if rows else None
            for ref in clean[len(cur):]:
                nid = self.con.execute(
                    "INSERT INTO PlaylistEntity(listId, trackId, databaseUuid, nextEntityId, membershipReference) "
                    "VALUES(?,?,?,0,0)", (pid, ref[1], ref[0])).lastrowid
                if last is not None:
                    self.con.execute("UPDATE PlaylistEntity SET nextEntityId=? WHERE id=?", (nid, last))
                last = nid
        elif all(r in cur_set for r in clean) and [r for r in cur if r in set(clean)] == clean:
            keep = set(clean)                           # yalnızca çıkarma (sıra korunuyor)
            for r in rows:
                if (r["databaseUuid"], r["trackId"]) not in keep:
                    self.con.execute("DELETE FROM PlaylistEntity WHERE id=?", (r["id"],))
        else:                                           # yeniden sıralama: tümünü yeniden yaz
            self.con.execute("DELETE FROM PlaylistEntity WHERE listId=?", (pid,))
            ids = []
            for ref in clean:
                ids.append(self.con.execute(
                    "INSERT INTO PlaylistEntity(listId, trackId, databaseUuid, nextEntityId, membershipReference) "
                    "VALUES(?,?,?,0,0)", (pid, ref[1], ref[0])).lastrowid)
            for a, b in zip(ids, ids[1:]):
                self.con.execute("UPDATE PlaylistEntity SET nextEntityId=? WHERE id=?", (b, a))
        after = self.refs(pid)
        if after != clean:
            raise EngineError("Liste sırası doğrulanamadı; hiçbir değişiklik yapılmadı.")
        self.con.execute("UPDATE Playlist SET lastEditTime=datetime('now') WHERE id=?", (pid,))
        if record:
            self.steps.append({"op": "pl_refs", "id": pid, "refs": cur, "expect": clean})
        self.stats["entries"] += abs(len(clean) - len(cur)) or 1
        self.changed_lists.add(pid)
        return True

    # -- parçalar ----------------------------------------------------------------------
    def track_by_path(self, engine_path: str):
        return self.q1("SELECT id, path, originDatabaseUuid, originTrackId, isAnalyzed FROM Track WHERE path=?",
                       (engine_path,))

    def track(self, tid: int):
        return self.q1("SELECT id, path, filename, originDatabaseUuid, originTrackId, isAnalyzed FROM Track WHERE id=?",
                       (tid,))

    def track_ref(self, tid: int):
        r = self.track(tid)
        return (r["originDatabaseUuid"], r["originTrackId"]) if r else None

    def track_add(self, f: dict, engine_path: str):
        """Kütüphanedeki bir dosyayı Engine koleksiyonuna ekler (yoksa). Dönüş: Track satırı."""
        ex = self.track_by_path(engine_path)
        if ex:
            return ex
        ts = util.now()
        ext = os.path.splitext(f.get("name") or engine_path)[1].lstrip(".").lower()
        art = self.con.execute("SELECT id FROM AlbumArt WHERE id=1").fetchone()
        stem = os.path.splitext(names.display(f.get("name") or posixpath.basename(engine_path)))[0]
        vals = {
            "playOrder": None, "length": int(round(f["duration"])) if f.get("duration") else None,
            "bpm": int(round(f["bpm"])) if f.get("bpm") else None, "year": f.get("year"),
            "path": engine_path, "filename": posixpath.basename(engine_path),
            "bitrate": f.get("bitrate"), "bpmAnalyzed": None, "albumArtId": 1 if art else None,
            "fileBytes": f.get("size"), "title": f.get("title") or stem,
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
        tid = self.con.execute("INSERT INTO Track(%s) VALUES(%s)" % (",".join(cols), ",".join("?" for _ in cols)),
                               [vals[c] for c in cols]).lastrowid
        self.steps.append({"op": "trk_del_added", "id": tid})
        self.stats["added"] += 1
        return self.track(tid)

    def track_set_path(self, tid: int, new_path: str, expect: str = None, record=True):
        r = self.track(tid)
        if not r:
            return "yok"
        if expect is not None and r["path"] != expect:
            return "degismis"
        if r["path"] == new_path:
            return "ayni"
        clash = self.q1("SELECT id FROM Track WHERE path=? AND id<>?", (new_path, tid))
        if clash:
            return "cakisma"
        self.con.execute("UPDATE Track SET path=?, filename=? WHERE id=?",
                         (new_path, posixpath.basename(new_path), tid))
        if record:
            self.steps.append({"op": "trk_path", "id": tid, "path": r["path"], "expect": new_path})
        self.stats["paths"] += 1
        return "ok"

    def repoint_refs(self, from_ref, to_ref):
        """Tüm listelerde bir parçayı başka bir parçayla değiştirir (sıra korunur)."""
        lists = [r[0] for r in self.con.execute(
            "SELECT DISTINCT listId FROM PlaylistEntity WHERE databaseUuid=? AND trackId=?", from_ref)]
        for lid in lists:
            refs = self.refs(lid)
            new = [to_ref if r == tuple(from_ref) else r for r in refs]
            self.pl_set_refs(lid, new)
        return len(lists)

    def track_delete(self, tid: int):
        """Parçayı koleksiyondan siler (yalnızca çift kayıt birleştirmede; geri alma yedekten yapılır)."""
        self.con.execute("DELETE FROM Track WHERE id=?", (tid,))
        self.stats["deleted_tracks"] += 1

    # -- bitiş -----------------------------------------------------------------------------
    def commit(self):
        if self._open and not self.changed():
            # hiçbir şey değişmedi: dosyaya dokunulmaz, önbellekler geçersiz kalmaz (gereksiz yenileme olmaz)
            self.con.execute("COMMIT")
            self.con.close()
            self._open = False
            return self.stats
        fk_after = len(self.con.execute("PRAGMA foreign_key_check").fetchall())
        if fk_after > self.fk_before:
            self.rollback()
            raise EngineError("Bütünlük denetimi başarısız (yabancı anahtar); değişiklikler geri alındı.")
        self.con.execute("COMMIT")
        _wrote()
        ok = self.con.execute("PRAGMA quick_check").fetchone()[0]
        self.con.close()
        self._open = False
        if ok != "ok":
            raise EngineError("Yazma sonrası denetim uyarısı: %s — geri alabilirsiniz." % ok)
        return self.stats

    def rollback(self):
        if not self._open:
            return
        try:
            self.con.execute("ROLLBACK")
        except Exception:
            pass
        try:
            self.con.close()
        except Exception:
            pass
        self._open = False

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        if exc_type is not None:
            self.rollback()
        elif self._open:
            self.commit()
        return False


# ---------------------------------------------------------------------------
# Geri alma: kaydedilen adımları tersten uygular
# ---------------------------------------------------------------------------
def undo_steps(w: Writer, steps, alias: dict, force: bool = False, managed=frozenset()):
    """steps: Writer.steps (uygulama sırası). alias: {eski_liste_id: yeni_id} (güncellenir).
    managed: programın kendiliğinden tuttuğu listeler (Analiz bekleyenler, Türler); bunlardaki
    kullanım çakışma sayılmaz, geri almadan sonra yeniden hesaplanır."""

    def A(pid):
        guard = 0
        while pid in alias and guard < 100:
            pid = alias[pid]
            guard += 1
        return pid

    seq = list(reversed(steps))
    i = 0
    while i < len(seq):
        st = seq[i]
        op = st["op"]
        if op == "trk_del_added":
            # ardışık eklemeler tek seferde geri alınır (binlerce parça için hızlı)
            j = i
            while j < len(seq) and seq[j]["op"] == "trk_del_added":
                j += 1
            _undo_added(w, [x["id"] for x in seq[i:j]], force, managed)
            i = j
            continue
        i += 1
        if op == "pl_refs":
            pid = A(st["id"])
            if not w.pl(pid):
                if force:
                    continue
                raise UndoConflict("Liste artık yok.")
            cur = w.refs(pid)
            expect = [tuple(x) for x in st["expect"]]
            if cur != expect and not force:
                raise UndoConflict("Liste sonradan değişmiş.")
            w.pl_set_refs(pid, [tuple(x) for x in st["refs"]], record=False)
        elif op == "pl_del":
            pid = A(st["id"])
            p = w.pl(pid)
            if not p:
                continue
            if (w.children(pid) or w.refs(pid)) and not force:
                raise UndoConflict("Liste sonradan doldurulmuş.")
            for d in w.descendants(pid) + [pid]:
                w.con.execute("DELETE FROM PlaylistEntity WHERE listId=?", (d,))
                w.con.execute("DELETE FROM Playlist WHERE id=?", (d,))
            w.changed_lists.add(pid)
        elif op == "pl_ren":
            pid = A(st["id"])
            p = w.pl(pid)
            if not p:
                if force:
                    continue
                raise UndoConflict("Liste artık yok.")
            if p["title"] != st.get("expect", p["title"]) and not force:
                raise UndoConflict("Listenin adı sonradan değişmiş.")
            new = w.unique_title(p["parentListId"], st["title"], exclude=pid)
            w.con.execute("UPDATE Playlist SET title=? WHERE id=?", (new, pid))
            w.changed_lists.add(pid)
        elif op == "pl_mv":
            pid = A(st["id"])
            if not w.pl(pid):
                if force:
                    continue
                raise UndoConflict("Liste artık yok.")
            w.pl_move(pid, A(st["parent"]) if st["parent"] else 0, A(st["before"]) if st["before"] else 0,
                      record=False)
            p = w.pl(pid)
            if st.get("title") and p["title"] != st["title"]:
                new = w.unique_title(p["parentListId"], st["title"], exclude=pid)
                w.con.execute("UPDATE Playlist SET title=? WHERE id=?", (new, pid))
        elif op == "pl_recreate":
            parent = A(st["parent"]) if st["parent"] else 0
            if parent and not w.pl(parent):
                parent = 0
            before = A(st["before"]) if st["before"] else 0
            persisted = st.get("persisted")
            new_id = w.pl_create(parent, st["title"], before=before, persisted=1 if persisted is None else persisted,
                                 exported=st.get("exported") or 0, record=False)
            alias[st["old_id"]] = new_id
            refs = [tuple(x) for x in st.get("refs") or []]
            if refs:
                w.pl_set_refs(new_id, refs, record=False)
        elif op == "trk_path":
            res = w.track_set_path(st["id"], st["path"], expect=None if force else st["expect"], record=False)
            if res == "degismis" and not force:
                raise UndoConflict("Parçanın yolu sonradan değişmiş.")
        else:
            raise EngineError("Bilinmeyen geri alma adımı: %s" % op)
    return alias


def _undo_added(w: Writer, tids, force, managed):
    """Programın eklediği parçaları koleksiyondan çıkarır (toplu)."""
    rows = {}
    for tid in tids:
        t = w.track(tid)
        if t:
            rows[tid] = t
    if not rows:
        return
    refs = {(t["originDatabaseUuid"], t["originTrackId"]) for t in rows.values()}
    used = {}
    for lid, u, t in w.con.execute("SELECT listId, databaseUuid, trackId FROM PlaylistEntity").fetchall():
        if (u, t) in refs:
            used.setdefault(lid, set()).add((u, t))
    if not force:
        if any(lid not in managed for lid in used):
            raise UndoConflict("Eklenen parça sonradan listelere konmuş.")
        analyzed = [tid for tid in rows if w.q1("SELECT isAnalyzed FROM Track WHERE id=?", (tid,))["isAnalyzed"]]
        if analyzed:
            raise UndoConflict("Eklenen parça sonradan Engine'de analiz edilmiş.")
    for lid, rs in used.items():
        w.pl_set_refs(lid, [r for r in w.refs(lid) if r not in rs], record=False)
    for tid in rows:
        w.con.execute("DELETE FROM Track WHERE id=?", (tid,))
