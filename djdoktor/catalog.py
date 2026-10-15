"""Programın kendi kataloğu (SQLite).

Müzik dosyaları hakkında okunan bilgiler, listeler, etkinlikler, işlem günlüğü
ve Serato/Engine analiz önbelleği burada tutulur. Bu veritabanı programa aittir;
Serato veya Engine dosyalarıyla karışmaz.
"""
from __future__ import annotations

import json
import os
import sqlite3
import threading
from contextlib import contextmanager

from . import util

SCHEMA = """
CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT);

CREATE TABLE IF NOT EXISTS files(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rel TEXT NOT NULL UNIQUE,
  mkey TEXT NOT NULL,
  lkey TEXT NOT NULL,
  os_rel TEXT,
  folder TEXT, name TEXT, ext TEXT, kind TEXT, origin TEXT,
  size INTEGER, mtime INTEGER,
  present INTEGER NOT NULL DEFAULT 1,
  first_seen INTEGER, last_seen INTEGER,
  title TEXT, artist TEXT, album TEXT, genre TEXT, comment TEXT, note TEXT,
  mik_key TEXT, mik_energy INTEGER, grouping TEXT, bpm REAL, key_raw TEXT, camelot TEXT,
  year INTEGER, label TEXT, composer TEXT, remixer TEXT, rating INTEGER, track_no INTEGER,
  has_art INTEGER,
  duration REAL, bitrate INTEGER, sample_rate INTEGER, channels INTEGER, bits INTEGER, codec TEXT,
  cues INTEGER, loops INTEGER, cues_json TEXT, serato_color TEXT, serato_analyzed INTEGER,
  serato_beatgrid INTEGER,
  tag_error TEXT,
  aoff INTEGER, alen INTEGER, qsig TEXT, tagsig TEXT, fsig TEXT,
  songkey TEXT, search TEXT, flags TEXT
);
CREATE INDEX IF NOT EXISTS ix_files_mkey ON files(mkey);
CREATE INDEX IF NOT EXISTS ix_files_lkey ON files(lkey);
CREATE INDEX IF NOT EXISTS ix_files_qsig ON files(qsig);
CREATE INDEX IF NOT EXISTS ix_files_songkey ON files(songkey);

CREATE TABLE IF NOT EXISTS lists(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_id INTEGER REFERENCES lists(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  pos REAL NOT NULL DEFAULT 0,
  info TEXT,
  source TEXT,
  created INTEGER, updated INTEGER
);
CREATE TABLE IF NOT EXISTS list_items(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  list_id INTEGER NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  file_id INTEGER NOT NULL REFERENCES files(id),
  pos REAL NOT NULL,
  note TEXT,
  added INTEGER
);
CREATE INDEX IF NOT EXISTS ix_items_list ON list_items(list_id, pos);
CREATE INDEX IF NOT EXISTS ix_items_file ON list_items(file_id);

CREATE TABLE IF NOT EXISTS templates(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT UNIQUE, title TEXT, sections TEXT, builtin INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sync_map(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target TEXT NOT NULL, target_key TEXT NOT NULL, list_id INTEGER NOT NULL,
  ext_id TEXT, ext_title TEXT, last_sync INTEGER,
  UNIQUE(target, target_key, list_id)
);

CREATE TABLE IF NOT EXISTS journal(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER, kind TEXT, title TEXT, payload TEXT, status TEXT, undo_of INTEGER
);

CREATE TABLE IF NOT EXISTS ext_tracks(
  src TEXT NOT NULL, ext_id TEXT NOT NULL, raw_path TEXT, file_id INTEGER, match TEXT, info TEXT,
  PRIMARY KEY(src, ext_id)
);
CREATE INDEX IF NOT EXISTS ix_ext_tracks_file ON ext_tracks(file_id);
CREATE TABLE IF NOT EXISTS ext_lists(
  src TEXT NOT NULL, list_key TEXT NOT NULL, title TEXT, parent_key TEXT, path TEXT,
  pos INTEGER, count INTEGER, info TEXT,
  PRIMARY KEY(src, list_key)
);
CREATE TABLE IF NOT EXISTS ext_items(
  src TEXT NOT NULL, list_key TEXT NOT NULL, pos INTEGER, raw_path TEXT, ext_track TEXT,
  file_id INTEGER, match TEXT
);
CREATE INDEX IF NOT EXISTS ix_ext_items_list ON ext_items(src, list_key, pos);
CREATE INDEX IF NOT EXISTS ix_ext_items_file ON ext_items(file_id);

-- v2 ------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS genre(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rel TEXT NOT NULL UNIQUE,
  pos REAL NOT NULL DEFAULT 0,
  color TEXT,
  engine INTEGER NOT NULL DEFAULT 1,
  created INTEGER
);
CREATE TABLE IF NOT EXISTS folder_rule(rel TEXT PRIMARY KEY, action TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS ev_meta(db TEXT NOT NULL, pid INTEGER NOT NULL, data TEXT, PRIMARY KEY(db, pid));
CREATE TABLE IF NOT EXISTS entry_note(db TEXT NOT NULL, pid INTEGER NOT NULL, ref TEXT NOT NULL, note TEXT,
  PRIMARY KEY(db, pid, ref));
CREATE TABLE IF NOT EXISTS serato_link(db TEXT NOT NULL, pid INTEGER NOT NULL, crate TEXT, last_hash TEXT,
  last_refs TEXT, dirty INTEGER DEFAULT 0, PRIMARY KEY(db, pid));
CREATE TABLE IF NOT EXISTS pl_alias(db TEXT NOT NULL, old INTEGER NOT NULL, new INTEGER NOT NULL,
  PRIMARY KEY(db, old));
CREATE TABLE IF NOT EXISTS inbox_log(id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, src TEXT, status TEXT,
  rel TEXT, genre TEXT, note TEXT, journal INTEGER);
-- taşınan dosyaların eski yolları: Engine/Serato'da eski yolda kalmış kayıtları onarmak için
CREATE TABLE IF NOT EXISTS rel_history(lkey TEXT PRIMARY KEY, fid INTEGER NOT NULL, ts INTEGER);
-- gelen kutusunda bekletilen dosyalar (geri alınan eklemeler kendiliğinden tekrar alınmasın)
CREATE TABLE IF NOT EXISTS inbox_hold(path TEXT PRIMARY KEY, size INTEGER, mtime INTEGER, ts INTEGER);
"""

FILE_COLS = [
    "rel", "mkey", "lkey", "os_rel", "folder", "name", "ext", "kind", "origin", "size", "mtime",
    "present", "first_seen", "last_seen", "title", "artist", "album", "genre", "comment", "note",
    "mik_key", "mik_energy", "grouping", "bpm", "key_raw", "camelot", "year", "label", "composer",
    "remixer", "rating", "track_no", "has_art", "duration", "bitrate", "sample_rate", "channels",
    "bits", "codec", "cues", "loops", "cues_json", "serato_color", "serato_analyzed",
    "serato_beatgrid", "tag_error", "aoff", "alen", "qsig", "tagsig", "fsig", "songkey", "search",
    "flags",
]


def _d(row):
    return dict(row) if row is not None else None


class Catalog:
    def __init__(self, path: str, root: str):
        self.path = path
        self.root = root
        os.makedirs(os.path.dirname(path), exist_ok=True)
        self.lock = threading.RLock()
        self._depth = 0
        self.con = sqlite3.connect(path, check_same_thread=False, timeout=30, isolation_level=None)
        self.con.row_factory = sqlite3.Row
        self.con.execute("PRAGMA journal_mode=DELETE")
        self.con.execute("PRAGMA synchronous=NORMAL")
        self.con.execute("PRAGMA foreign_keys=ON")
        with self.lock:
            self.con.executescript(SCHEMA)
            self.set_meta("schema", "1")
            if not self.get_meta("root"):
                self.set_meta("root", root)

    def close(self):
        with self.lock:
            try:
                self.con.close()
            except Exception:
                pass

    # ------------------------------------------------------------------
    @contextmanager
    def tx(self):
        """İşlem (transaction). İç içe çağrılabilir: içteki çağrılar dıştakine katılır."""
        with self.lock:
            if self._depth:
                self._depth += 1
                try:
                    yield self.con
                finally:
                    self._depth -= 1
                return
            self.con.execute("BEGIN IMMEDIATE")
            self._depth = 1
            try:
                yield self.con
                self._depth = 0
                self.con.execute("COMMIT")
            except BaseException:
                self._depth = 0
                self.con.execute("ROLLBACK")
                raise

    def q(self, sql, args=()):
        with self.lock:
            return [dict(r) for r in self.con.execute(sql, args).fetchall()]

    def q1(self, sql, args=()):
        with self.lock:
            return _d(self.con.execute(sql, args).fetchone())

    def x(self, sql, args=()):
        with self.lock:
            return self.con.execute(sql, args)

    def get_meta(self, k, default=None):
        r = self.q1("SELECT v FROM meta WHERE k=?", (k,))
        return r["v"] if r else default

    def set_meta(self, k, v):
        self.x("INSERT INTO meta(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v", (k, str(v)))

    # ------------------------------------------------------------------
    # Dosyalar
    # ------------------------------------------------------------------
    def file_index(self):
        with self.lock:
            return {r["rel"]: (r["id"], r["size"], r["mtime"], r["present"])
                    for r in self.con.execute("SELECT id, rel, size, mtime, present FROM files")}

    def upsert_files(self, recs):
        """recs: dict listesi (FILE_COLS alt kümesi, 'rel' zorunlu)."""
        if not recs:
            return
        with self.tx() as c:
            for r in recs:
                cols = [k for k in FILE_COLS if k in r]
                ph = ",".join("?" for _ in cols)
                upd = ",".join("%s=excluded.%s" % (k, k) for k in cols if k not in ("rel", "first_seen"))
                c.execute(
                    "INSERT INTO files(%s) VALUES(%s) ON CONFLICT(rel) DO UPDATE SET %s"
                    % (",".join(cols), ph, upd),
                    [r[k] for k in cols],
                )

    def touch_files(self, ids, ts, os_rels=None):
        with self.tx() as c:
            for i, fid in enumerate(ids):
                if os_rels:
                    c.execute("UPDATE files SET present=1, last_seen=?, os_rel=? WHERE id=?", (ts, os_rels[i], fid))
                else:
                    c.execute("UPDATE files SET present=1, last_seen=? WHERE id=?", (ts, fid))

    def mark_absent_except(self, seen_ids):
        seen = set(seen_ids)
        with self.lock:
            all_ids = [r[0] for r in self.con.execute("SELECT id FROM files WHERE present=1")]
        gone = [i for i in all_ids if i not in seen]
        with self.tx() as c:
            for i in gone:
                c.execute("UPDATE files SET present=0 WHERE id=?", (i,))
        return gone

    def files(self, where="1=1", args=()):
        return self.q("SELECT * FROM files WHERE %s" % where, args)

    def file(self, fid):
        return self.q1("SELECT * FROM files WHERE id=?", (fid,))

    def file_by_rel(self, rel):
        return self.q1("SELECT * FROM files WHERE rel=?", (rel,))

    def set_flags(self, flags_by_id):
        with self.tx() as c:
            c.execute("UPDATE files SET flags=NULL WHERE flags IS NOT NULL")
            for fid, fl in flags_by_id.items():
                c.execute("UPDATE files SET flags=? WHERE id=?", (json.dumps(fl, ensure_ascii=False), fid))

    def update_file(self, fid, **kw):
        cols = [k for k in kw if k in FILE_COLS]
        if not cols:
            return
        self.x("UPDATE files SET %s WHERE id=?" % ",".join("%s=?" % k for k in cols), [kw[k] for k in cols] + [fid])

    # ------------------------------------------------------------------
    # Listeler / etkinlikler
    # ------------------------------------------------------------------
    def lists_all(self):
        rows = self.q("SELECT l.*, (SELECT COUNT(*) FROM list_items i WHERE i.list_id=l.id) AS n, "
                      "(SELECT COALESCE(SUM(f.duration),0) FROM list_items i JOIN files f ON f.id=i.file_id "
                      " WHERE i.list_id=l.id) AS dur FROM lists l ORDER BY parent_id, pos, id")
        for r in rows:
            r["info"] = json.loads(r["info"]) if r.get("info") else {}
        return rows

    def list_get(self, lid):
        r = self.q1("SELECT * FROM lists WHERE id=?", (lid,))
        if r:
            r["info"] = json.loads(r["info"]) if r.get("info") else {}
        return r

    def list_children(self, lid):
        return self.q("SELECT * FROM lists WHERE parent_id IS ? ORDER BY pos, id", (lid,))

    def list_descendants(self, lid):
        out, stack = [], [lid]
        while stack:
            cur = stack.pop()
            for ch in self.q("SELECT id FROM lists WHERE parent_id=? ORDER BY pos, id", (cur,)):
                out.append(ch["id"])
                stack.append(ch["id"])
        return out

    def list_path(self, lid):
        parts = []
        cur = self.list_get(lid)
        guard = 0
        while cur and guard < 50:
            parts.append(cur["title"])
            cur = self.list_get(cur["parent_id"]) if cur.get("parent_id") else None
            guard += 1
        return list(reversed(parts))

    def list_create(self, parent_id, kind, title, info=None, source=None, pos=None):
        ts = util.now()
        with self.tx() as c:
            if pos is None:
                r = c.execute("SELECT COALESCE(MAX(pos),0)+1 FROM lists WHERE parent_id IS ?", (parent_id,)).fetchone()
                pos = r[0]
            cur = c.execute(
                "INSERT INTO lists(parent_id, kind, title, pos, info, source, created, updated) VALUES(?,?,?,?,?,?,?,?)",
                (parent_id, kind, title.strip() or "Adsız", pos,
                 json.dumps(info or {}, ensure_ascii=False), source, ts, ts))
            return cur.lastrowid

    def list_update(self, lid, title=None, info=None, parent_id=-1, pos=None):
        sets, args = [], []
        if title is not None:
            sets.append("title=?")
            args.append(title.strip() or "Adsız")
        if info is not None:
            sets.append("info=?")
            args.append(json.dumps(info, ensure_ascii=False))
        if parent_id != -1:
            if parent_id is not None and (parent_id == lid or parent_id in self.list_descendants(lid)):
                raise ValueError("Bir liste kendi altına taşınamaz")
            sets.append("parent_id=?")
            args.append(parent_id)
        if pos is not None:
            sets.append("pos=?")
            args.append(pos)
        sets.append("updated=?")
        args.append(util.now())
        self.x("UPDATE lists SET %s WHERE id=?" % ",".join(sets), args + [lid])

    def list_delete(self, lid):
        ids = [lid] + self.list_descendants(lid)
        with self.tx() as c:
            for i in reversed(ids):
                c.execute("DELETE FROM list_items WHERE list_id=?", (i,))
                c.execute("DELETE FROM lists WHERE id=?", (i,))
        return ids

    def items(self, lid):
        return self.q(
            "SELECT i.id AS item_id, i.pos, i.note AS item_note, i.added, f.* FROM list_items i "
            "JOIN files f ON f.id=i.file_id WHERE i.list_id=? ORDER BY i.pos, i.id", (lid,))

    def item_file_ids(self, lid):
        return [r["file_id"] for r in self.q("SELECT file_id FROM list_items WHERE list_id=? ORDER BY pos, id", (lid,))]

    def items_add(self, lid, file_ids, at_index=None):
        existing = set(self.item_file_ids(lid))
        new = []
        for f in file_ids:
            if f not in existing and f not in new:
                new.append(f)
        if not new:
            return 0, len(file_ids)
        ts = util.now()
        with self.tx() as c:
            rows = c.execute("SELECT id, pos FROM list_items WHERE list_id=? ORDER BY pos, id", (lid,)).fetchall()
            if at_index is None or at_index >= len(rows):
                start = (rows[-1][1] if rows else 0) + 1
                for k, f in enumerate(new):
                    c.execute("INSERT INTO list_items(list_id, file_id, pos, added) VALUES(?,?,?,?)", (lid, f, start + k, ts))
            else:
                # araya ekle: tüm sırayı yeniden numarala
                order = [r[0] for r in rows]
                for k, r in enumerate(order[:at_index]):
                    c.execute("UPDATE list_items SET pos=? WHERE id=?", (k, r))
                base = at_index
                for k, f in enumerate(new):
                    c.execute("INSERT INTO list_items(list_id, file_id, pos, added) VALUES(?,?,?,?)", (lid, f, base + k, ts))
                for k, r in enumerate(order[at_index:]):
                    c.execute("UPDATE list_items SET pos=? WHERE id=?", (base + len(new) + k, r))
            c.execute("UPDATE lists SET updated=? WHERE id=?", (ts, lid))
        return len(new), len(file_ids) - len(new)

    def items_remove(self, item_ids):
        with self.tx() as c:
            for i in item_ids:
                c.execute("DELETE FROM list_items WHERE id=?", (i,))

    def items_reorder(self, lid, item_ids):
        with self.tx() as c:
            for k, i in enumerate(item_ids):
                c.execute("UPDATE list_items SET pos=? WHERE id=? AND list_id=?", (k, i, lid))
            c.execute("UPDATE lists SET updated=? WHERE id=?", (util.now(), lid))

    def items_move(self, item_ids, to_list):
        with self.tx() as c:
            r = c.execute("SELECT COALESCE(MAX(pos),0)+1 FROM list_items WHERE list_id=?", (to_list,)).fetchone()
            base = r[0]
            existing = {row[0] for row in c.execute("SELECT file_id FROM list_items WHERE list_id=?", (to_list,))}
            for k, i in enumerate(item_ids):
                row = c.execute("SELECT file_id FROM list_items WHERE id=?", (i,)).fetchone()
                if row and row[0] in existing:
                    c.execute("DELETE FROM list_items WHERE id=?", (i,))
                else:
                    c.execute("UPDATE list_items SET list_id=?, pos=? WHERE id=?", (to_list, base + k, i))

    def item_note(self, item_id, note):
        self.x("UPDATE list_items SET note=? WHERE id=?", (note, item_id))

    def replace_file_refs(self, old_fid, new_fid):
        """Çift birleştirmede: listelerdeki eski dosyayı yenisiyle değiştir."""
        with self.tx() as c:
            rows = c.execute("SELECT id, list_id FROM list_items WHERE file_id=?", (old_fid,)).fetchall()
            for item_id, lid in rows:
                dup = c.execute("SELECT 1 FROM list_items WHERE list_id=? AND file_id=?", (lid, new_fid)).fetchone()
                if dup:
                    c.execute("DELETE FROM list_items WHERE id=?", (item_id,))
                else:
                    c.execute("UPDATE list_items SET file_id=? WHERE id=?", (new_fid, item_id))
            return len(rows)

    def file_list_membership(self, fid):
        rows = self.q("SELECT DISTINCT list_id FROM list_items WHERE file_id=?", (fid,))
        return [" / ".join(self.list_path(r["list_id"])) for r in rows]

    # ------------------------------------------------------------------
    # Şablonlar
    # ------------------------------------------------------------------
    def templates(self):
        rows = self.q("SELECT * FROM templates ORDER BY builtin DESC, id")
        for r in rows:
            r["sections"] = json.loads(r["sections"] or "[]")
        return rows

    def template_save(self, kind, title, sections, builtin=0):
        self.x("INSERT INTO templates(kind, title, sections, builtin) VALUES(?,?,?,?) "
               "ON CONFLICT(kind) DO UPDATE SET title=excluded.title, sections=excluded.sections",
               (kind, title, json.dumps(sections, ensure_ascii=False), builtin))

    # ------------------------------------------------------------------
    # Senkron eşlemesi
    # ------------------------------------------------------------------
    def sync_get(self, target, target_key):
        return self.q("SELECT * FROM sync_map WHERE target=? AND target_key=?", (target, target_key))

    def sync_set(self, target, target_key, list_id, ext_id, ext_title):
        self.x("INSERT INTO sync_map(target, target_key, list_id, ext_id, ext_title, last_sync) VALUES(?,?,?,?,?,?) "
               "ON CONFLICT(target, target_key, list_id) DO UPDATE SET ext_id=excluded.ext_id, "
               "ext_title=excluded.ext_title, last_sync=excluded.last_sync",
               (target, target_key, list_id, str(ext_id), ext_title, util.now()))

    def sync_delete(self, target, target_key, list_id):
        self.x("DELETE FROM sync_map WHERE target=? AND target_key=? AND list_id=?", (target, target_key, list_id))

    # ------------------------------------------------------------------
    # İşlem günlüğü
    # ------------------------------------------------------------------
    def journal_add(self, kind, title, payload, status="tamam", undo_of=None):
        cur = self.x("INSERT INTO journal(ts, kind, title, payload, status, undo_of) VALUES(?,?,?,?,?,?)",
                     (util.now(), kind, title, json.dumps(payload, ensure_ascii=False), status, undo_of))
        return cur.lastrowid

    def journal(self, limit=200):
        rows = self.q("SELECT * FROM journal ORDER BY id DESC LIMIT ?", (limit,))
        for r in rows:
            try:
                r["payload"] = json.loads(r["payload"] or "{}")
            except ValueError:
                r["payload"] = {}
        return rows

    def journal_get(self, jid):
        r = self.q1("SELECT * FROM journal WHERE id=?", (jid,))
        if r:
            r["payload"] = json.loads(r["payload"] or "{}")
        return r

    def journal_status(self, jid, status):
        self.x("UPDATE journal SET status=? WHERE id=?", (status, jid))

    # ------------------------------------------------------------------
    # v2: türler, klasör kuralları, etkinlik bilgileri, Serato bağları
    # ------------------------------------------------------------------
    def genres(self):
        return self.q("SELECT * FROM genre ORDER BY pos, id")

    def genre(self, gid):
        return self.q1("SELECT * FROM genre WHERE id=?", (gid,))

    def genre_add(self, rel, pos=None, color=None, engine=1):
        if pos is None:
            r = self.q1("SELECT COALESCE(MAX(pos),0)+1 AS p FROM genre")
            pos = r["p"]
        cur = self.x("INSERT INTO genre(rel, pos, color, engine, created) VALUES(?,?,?,?,?)",
                     (rel, pos, color, int(engine), util.now()))
        return cur.lastrowid

    def genre_update(self, gid, **kw):
        cols = [k for k in kw if k in ("rel", "pos", "color", "engine")]
        if cols:
            self.x("UPDATE genre SET %s WHERE id=?" % ",".join("%s=?" % c for c in cols),
                   [kw[c] for c in cols] + [gid])

    def genre_delete(self, gid):
        self.x("DELETE FROM genre WHERE id=?", (gid,))

    def folder_rules(self):
        return {r["rel"]: r["action"] for r in self.q("SELECT rel, action FROM folder_rule")}

    def set_folder_rule(self, rel, action):
        if action:
            self.x("INSERT INTO folder_rule(rel, action) VALUES(?,?) ON CONFLICT(rel) DO UPDATE SET action=excluded.action",
                   (rel, action))
        else:
            self.x("DELETE FROM folder_rule WHERE rel=?", (rel,))

    def update_rel(self, fid, rel, os_rel, mkey, lkey):
        folder, name = (rel.rsplit("/", 1) if "/" in rel else ("", rel))
        with self.tx() as c:
            # aynı yolda artık olmayan eski bir kayıt varsa onu kenara al (UNIQUE çakışmasın)
            c.execute("UPDATE files SET rel=rel || '#' || id WHERE rel=? AND id<>? AND present=0", (rel, fid))
            c.execute("UPDATE files SET rel=?, os_rel=?, mkey=?, lkey=?, folder=?, name=? WHERE id=?",
                      (rel, os_rel, mkey, lkey, folder, name, fid))

    def ev_meta(self, db, pid):
        r = self.q1("SELECT data FROM ev_meta WHERE db=? AND pid=?", (db, pid))
        return json.loads(r["data"]) if r and r["data"] else None

    def ev_meta_all(self, db):
        return {r["pid"]: json.loads(r["data"] or "{}") for r in self.q("SELECT pid, data FROM ev_meta WHERE db=?", (db,))}

    def set_ev_meta(self, db, pid, data):
        if data is None:
            self.x("DELETE FROM ev_meta WHERE db=? AND pid=?", (db, pid))
        else:
            self.x("INSERT INTO ev_meta(db, pid, data) VALUES(?,?,?) ON CONFLICT(db, pid) DO UPDATE SET data=excluded.data",
                   (db, pid, json.dumps(data, ensure_ascii=False)))

    def notes(self, db, pid):
        return {r["ref"]: r["note"] for r in self.q("SELECT ref, note FROM entry_note WHERE db=? AND pid=?", (db, pid))}

    def set_note(self, db, pid, ref, note):
        if note:
            self.x("INSERT INTO entry_note(db, pid, ref, note) VALUES(?,?,?,?) ON CONFLICT(db, pid, ref) "
                   "DO UPDATE SET note=excluded.note", (db, pid, ref, note))
        else:
            self.x("DELETE FROM entry_note WHERE db=? AND pid=? AND ref=?", (db, pid, ref))

    def serato_links(self, db):
        rows = self.q("SELECT * FROM serato_link WHERE db=?", (db,))
        for r in rows:
            r["last_refs"] = json.loads(r["last_refs"]) if r.get("last_refs") else None
        return {r["pid"]: r for r in rows}

    def set_serato_link(self, db, pid, crate=None, last_hash=None, last_refs=None, dirty=0):
        self.x("INSERT INTO serato_link(db, pid, crate, last_hash, last_refs, dirty) VALUES(?,?,?,?,?,?) "
               "ON CONFLICT(db, pid) DO UPDATE SET crate=excluded.crate, last_hash=excluded.last_hash, "
               "last_refs=excluded.last_refs, dirty=excluded.dirty",
               (db, pid, crate, last_hash, json.dumps(last_refs, ensure_ascii=False) if last_refs is not None else None,
                int(dirty)))

    def del_serato_link(self, db, pid):
        self.x("DELETE FROM serato_link WHERE db=? AND pid=?", (db, pid))

    def add_alias(self, db, old, new):
        with self.tx() as c:
            c.execute("INSERT INTO pl_alias(db, old, new) VALUES(?,?,?) ON CONFLICT(db, old) DO UPDATE SET new=excluded.new",
                      (db, old, new))
            for t in ("ev_meta", "entry_note", "serato_link"):
                c.execute("UPDATE OR REPLACE %s SET pid=? WHERE db=? AND pid=?" % t, (new, db, old))

    def aliases(self, db):
        return {r["old"]: r["new"] for r in self.q("SELECT old, new FROM pl_alias WHERE db=?", (db,))}

    def inbox_log_add(self, src, status, rel, genre, note="", journal=None):
        self.x("INSERT INTO inbox_log(ts, src, status, rel, genre, note, journal) VALUES(?,?,?,?,?,?,?)",
               (util.now(), src, status, rel, genre, note, journal))

    def inbox_log(self, limit=40):
        return self.q("SELECT * FROM inbox_log ORDER BY id DESC LIMIT ?", (limit,))

    def add_history(self, old_rel, fid):
        from . import names
        self.x("INSERT INTO rel_history(lkey, fid, ts) VALUES(?,?,?) ON CONFLICT(lkey) DO UPDATE SET fid=excluded.fid, "
               "ts=excluded.ts", (names.loose_key(old_rel), fid, util.now()))

    def history_fid(self, rel):
        from . import names
        r = self.q1("SELECT fid FROM rel_history WHERE lkey=?", (names.loose_key(rel),))
        return r["fid"] if r else None

    def holds(self):
        return {r["path"]: r for r in self.q("SELECT * FROM inbox_hold")}

    def set_hold(self, path, size=None, mtime=None, on=True):
        if on:
            self.x("INSERT INTO inbox_hold(path, size, mtime, ts) VALUES(?,?,?,?) ON CONFLICT(path) DO UPDATE SET "
                   "size=excluded.size, mtime=excluded.mtime, ts=excluded.ts", (path, size, mtime, util.now()))
        else:
            self.x("DELETE FROM inbox_hold WHERE path=?", (path,))

    def journal_top(self):
        """Geri alınabilecek en son işlem (LIFO)."""
        r = self.q1("SELECT * FROM journal WHERE status='tamam' AND kind NOT IN ('geri_al') ORDER BY id DESC LIMIT 1")
        if r:
            try:
                r["payload"] = json.loads(r["payload"] or "{}")
            except ValueError:
                r["payload"] = {}
        return r

    # ------------------------------------------------------------------
    # Serato / Engine analiz önbelleği
    # ------------------------------------------------------------------
    def ext_replace(self, src, tracks, lists, items):
        with self.tx() as c:
            c.execute("DELETE FROM ext_tracks WHERE src=?", (src,))
            c.execute("DELETE FROM ext_lists WHERE src=?", (src,))
            c.execute("DELETE FROM ext_items WHERE src=?", (src,))
            c.executemany("INSERT OR REPLACE INTO ext_tracks(src, ext_id, raw_path, file_id, match, info) VALUES(?,?,?,?,?,?)",
                          [(src, str(t["ext_id"]), t.get("raw_path"), t.get("file_id"), t.get("match"),
                            json.dumps(t.get("info") or {}, ensure_ascii=False)) for t in tracks])
            c.executemany("INSERT OR REPLACE INTO ext_lists(src, list_key, title, parent_key, path, pos, count, info) VALUES(?,?,?,?,?,?,?,?)",
                          [(src, str(l["list_key"]), l.get("title"), l.get("parent_key"), l.get("path"), l.get("pos"),
                            l.get("count"), json.dumps(l.get("info") or {}, ensure_ascii=False)) for l in lists])
            c.executemany("INSERT INTO ext_items(src, list_key, pos, raw_path, ext_track, file_id, match) VALUES(?,?,?,?,?,?,?)",
                          [(src, str(i["list_key"]), i.get("pos"), i.get("raw_path"), i.get("ext_track"),
                            i.get("file_id"), i.get("match")) for i in items])
        self.set_meta("ext_ts_" + src, util.now())

    def ext_sources(self):
        return [r["src"] for r in self.q("SELECT DISTINCT src FROM ext_lists UNION SELECT DISTINCT src FROM ext_tracks")]

    def ext_membership(self, fid):
        return self.q("SELECT DISTINCT e.src, l.path, l.title FROM ext_items e JOIN ext_lists l "
                      "ON l.src=e.src AND l.list_key=e.list_key WHERE e.file_id=? ORDER BY e.src, l.path", (fid,))

    def ext_track_refs(self, fid):
        rows = self.q("SELECT src, ext_id, raw_path, match, info FROM ext_tracks WHERE file_id=?", (fid,))
        for r in rows:
            r["info"] = json.loads(r["info"] or "{}")
        return rows
