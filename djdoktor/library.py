"""Kütüphane (SSD): tarama, türler, Engine durumu ve ekranlar için özetler."""
from __future__ import annotations

import json
import os
import threading
import time
from collections import Counter, defaultdict

from . import engine, genres as G, names, serato, util
from .catalog import Catalog
from .resolver import Resolver
from .scanner import RootInfo, scan

STATE_DIR = "_DJDoktor_"


class UserError(Exception):
    """Kullanıcıya gösterilecek Türkçe hata. 'code' arayüzün özel davranışı için."""

    def __init__(self, msg, code=None):
        super().__init__(msg)
        self.code = code


BAD_FLAGS = ("audio_error", "audio_empty")


class Library:
    def __init__(self, settings, rec):
        self.settings = settings
        self.rec = rec
        self.id = rec["id"]
        self.root = rec["root"]
        if not os.path.isdir(self.root):
            raise UserError("Kütüphane klasörü bulunamadı: %s (SSD takılı mı?)" % self.root, code="no_root")
        self.catalog = Catalog(rec["catalog"], self.root)
        self.rootinfo = RootInfo(self.root)
        self.lock = threading.RLock()
        self._estate = None
        self._estate_key = None
        self._dupes = None
        self._dupes_ver = None

    # ------------------------------------------------------------------
    # Yollar
    # ------------------------------------------------------------------
    def state_dir(self):
        p = os.path.join(self.root, STATE_DIR)
        os.makedirs(p, exist_ok=True)
        return p

    def backup_dir(self, kind):
        p = os.path.join(self.state_dir(), "Yedekler", kind)
        os.makedirs(p, exist_ok=True)
        return p

    def quarantine(self, label):
        p = os.path.join(self.state_dir(), "Karantina", util.stamp() + "_" + label)
        os.makedirs(p, exist_ok=True)
        return p

    def quarantine_rel(self, label):
        """Karantina klasörü (kökten göreli kanonik yol)."""
        return STATE_DIR + "/Karantina/" + util.stamp() + "_" + label

    def prefs(self):
        return self.settings.prefs()

    def ver(self):
        return int(self.catalog.get_meta("files_ver", "0") or 0)

    def bump(self):
        self.catalog.set_meta("files_ver", self.ver() + 1)
        self._dupes = None

    # ------------------------------------------------------------------
    # Engine / Serato
    # ------------------------------------------------------------------
    def engine_db(self):
        return engine.drive_db(self.root)

    def engine_open(self):
        return engine.is_running()

    def serato_open(self):
        return bool(util.process_running(serato.SERATO_PROCS))

    def serato_dir(self):
        return serato.serato_dir(self.root)

    def engine_state(self, force=False):
        """SSD'deki Engine kütüphanesinin durumu: her dosya için Engine kaydı ve analiz bilgisi.

        Dönüş (önbellekli): {
          'db': {...} | None, 'uuid': str, 'schema': str,
          'tracks': {tid: track}, 'by_file': {fid: [(tid, match)]}, 'orphans': [(tid, rel, match)],
          'status': {fid: 'ready'|'pending'|'broken'|'edup'}, 'playlists': [...], 'lists_of': {fid: [yol]},
          'ref_of': {tid: (uuid, origin_id)}, 'tid_of_ref': {(uuid, origin): tid}
        }"""
        db = self.engine_db()
        if not db:
            return {"db": None, "uuid": None, "schema": None, "tracks": {}, "by_file": {}, "orphans": [],
                    "status": {}, "playlists": [], "lists_of": {}, "ref_of": {}, "tid_of_ref": {}, "warning": ""}
        key = (engine.db_stamp(db["path"]), self.ver())
        if not force and self._estate is not None and self._estate_key == key:
            return self._estate
        data = engine.read(db["path"])
        resolver = Resolver(self.catalog, self.root)
        tracks, by_file, orphans = {}, defaultdict(list), []
        ref_of, tid_of_ref = {}, {}
        for t in data["tracks"]:
            tracks[t["id"]] = t
            ref = (t.get("originDatabaseUuid"), t.get("originTrackId"))
            ref_of[t["id"]] = ref
            tid_of_ref[ref] = t["id"]
            rel = engine.path_to_rel(t.get("path") or "", db["lib_dir"], self.root)
            if rel is None:
                orphans.append((t["id"], None, "outside"))
                continue
            f, m = resolver.resolve(rel)
            if f is not None and m in ("exact", "case", "unicode", "sfm") and f["present"]:
                by_file[f["id"]].append((t["id"], m))
            else:
                orphans.append((t["id"], rel, m))
        status = {}
        for fid, rows in by_file.items():
            if len(rows) > 1:
                status[fid] = "edup"
                continue
            tid, m = rows[0]
            if m in ("unicode", "sfm"):
                status[fid] = "broken"
            elif tracks[tid].get("isAnalyzed"):
                status[fid] = "ready"
            else:
                status[fid] = "pending"
        fid_of_tid = {tid: fid for fid, rows in by_file.items() for tid, _m in rows}
        lists_of = defaultdict(list)
        for p in data["playlists"]:
            path = " / ".join(p["path"])
            for tid in p["entries"]:
                fid = fid_of_tid.get(tid)
                if fid is not None:
                    lists_of[fid].append(path)
        st = {"db": db, "uuid": data["uuid"], "schema": data["schema"], "tracks": tracks, "by_file": dict(by_file),
              "orphans": orphans, "status": status, "playlists": data["playlists"], "lists_of": dict(lists_of),
              "ref_of": ref_of, "tid_of_ref": tid_of_ref, "fid_of_tid": fid_of_tid, "warning": data["warning"]}
        self._estate, self._estate_key = st, key
        return st

    def db_uuid(self):
        return self.engine_state().get("uuid")

    # ------------------------------------------------------------------
    # Türler ve yerleşim
    # ------------------------------------------------------------------
    def music_root(self):
        return self.catalog.get_meta("music_root", "") or ""

    def genre_rows(self):
        out = []
        for g in self.catalog.genres():
            g = dict(g)
            g["name"] = names.display(names.split_rel(g["rel"])[-1]) if g["rel"] else "?"
            g["color"] = g.get("color") or G.GENRE_COLORS.get(g["name"]) or "#64748b"
            out.append(g)
        return out

    def placer(self):
        """Dosya -> ('genre', gid) | ('ignore', None) | ('unsorted', None)"""
        gens = sorted(((names.loose_key(g["rel"]), g["id"]) for g in self.catalog.genres()), key=lambda x: -len(x[0]))
        ign = sorted((names.loose_key(r) for r, a in self.catalog.folder_rules().items() if a == "ignore"),
                     key=lambda x: -len(x))
        cache = {}

        def place(rel):
            folder = names.loose_key(rel.rsplit("/", 1)[0]) if "/" in rel else ""
            if folder in cache:
                return cache[folder]
            res = ("unsorted", None)
            for k, gid in gens:
                if folder == k or folder.startswith(k + "/"):
                    res = ("genre", gid)
                    break
            else:
                for k in ign:
                    if folder == k or folder.startswith(k + "/"):
                        res = ("ignore", None)
                        break
            cache[folder] = res
            return res
        return place

    def audio_files(self, present=True):
        sql = "SELECT * FROM files WHERE kind='audio'" + (" AND present=1" if present else "")
        return self.catalog.q(sql)

    def memberships(self):
        """{file_id: [liste yolu]} — Serato crate'leri + Engine listeleri (tür önerileri için)."""
        out = defaultdict(list)
        for r in self.catalog.q("SELECT e.file_id, l.path FROM ext_items e JOIN ext_lists l ON l.src=e.src AND "
                                "l.list_key=e.list_key WHERE e.src='serato' AND e.file_id IS NOT NULL"):
            out[r["file_id"]].append(r["path"])
        try:
            st = self.engine_state()
            for fid, paths in st["lists_of"].items():
                out[fid].extend(paths)
        except Exception:
            pass
        return out

    # ------------------------------------------------------------------
    # Tarama
    # ------------------------------------------------------------------
    def full_scan(self, progress=None, cancel=None):
        def sub(lo, hi):
            return (lambda r, m: progress(lo + (hi - lo) * r, m)) if progress else None
        with self.lock:
            res = scan(self.catalog, self.rootinfo, self.prefs(), sub(0.0, 0.85), cancel)
            if res.get("cancelled"):
                return res
            if progress:
                progress(0.88, "Serato listeleri okunuyor…")
            res["serato"] = self.analyze_serato()
            self.compute_flags()
            self.bump()
            if progress:
                progress(0.95, "Engine durumu okunuyor…")
            self.engine_state(force=True)
            self.catalog.set_meta("last_scan", util.now())
            if progress:
                progress(1.0, "Tamamlandı")
            return res

    def analyze_serato(self):
        resolver = Resolver(self.catalog, self.root)
        try:
            s = serato.analyze(self.root, resolver)
        except Exception as e:
            return {"error": str(e)}
        if s:
            self.catalog.ext_replace("serato", s["tracks"], s["lists"], s["items"])
            self.catalog.set_meta("serato_info", json.dumps({"dir": s["dir"], "version": s["version"],
                                                             "dialect": s["dialect"]}))
            return {"tracks": len(s["tracks"]), "crates": len(s["lists"])}
        self.catalog.ext_replace("serato", [], [], [])
        return {"tracks": 0, "crates": 0}

    def compute_flags(self):
        """Dosya sorun bayrakları (bozuk, desteklenmeyen biçim, çöp, Mac yardımcı dosyası)."""
        from . import analysis
        prefs = self.prefs()
        flags = {}
        for f in self.catalog.files():
            codes = [c for c in analysis.file_issues(f, prefs)
                     if c in ("audio_error", "audio_empty", "fmt_engine", "junk_appledouble", "junk_other",
                              "name_badchar", "name_trailing", "name_reserved", "name_long", "audio_lowbr")]
            if codes:
                flags[f["id"]] = codes
        self.catalog.set_flags(flags)

    # ------------------------------------------------------------------
    # Ekran özetleri
    # ------------------------------------------------------------------
    def info(self):
        cat = self.catalog
        db = self.engine_db()
        return {"id": self.id, "name": self.rec["name"], "root": self.root, "catalog": self.rec["catalog"],
                "fstype": self.rootinfo.fstype, "mac_exfat": self.rootinfo.mac_exfat,
                "last_scan": cat.get_meta("last_scan"), "has_serato": bool(self.serato_dir()),
                "has_engine": bool(db), "music_root": self.music_root(), "free": util.free_space(self.root),
                "setup_done": bool(self.catalog.genres())}

    def file_states(self):
        """Her mevcut ses dosyası için: yer, tür, Engine durumu, sorun ve çift bilgisi."""
        from . import dedupe
        st = self.engine_state()
        place = self.placer()
        dup = dedupe.dup_index(self)
        out = {}
        for f in self.audio_files():
            kind, gid = place(f["rel"])
            if f["rel"].startswith(STATE_DIR + "/"):
                continue
            fl = json.loads(f["flags"]) if f.get("flags") else []
            es = st["status"].get(f["id"], "none")
            bad = any(c in BAD_FLAGS for c in fl)
            fmt = "fmt_engine" in fl
            d = dup.get(f["id"])
            out[f["id"]] = {"f": f, "place": kind, "gid": gid, "es": es, "bad": bad, "fmt": fmt, "dup": d}
        return out

    @staticmethod
    def dot(s):
        """Tek durum ışığı: ready | pending | none | problem"""
        if s["bad"] or s["fmt"] or s["es"] == "broken":
            return "problem"
        if s["es"] == "edup":
            return "pending"
        return {"ready": "ready", "pending": "pending"}.get(s["es"], "none")

    def overview(self):
        states = self.file_states()
        gens = self.genre_rows()
        by_g = {g["id"]: Counter() for g in gens}
        unsorted = Counter()
        ignored = 0
        problems = 0
        pending_total = 0
        for s in states.values():
            d = self.dot(s)
            if s["bad"] or s["fmt"]:
                problems += 1
            if s["place"] == "genre" and s["gid"] in by_g:
                c = by_g[s["gid"]]
                c["count"] += 1
                c[d] += 1
                if s["es"] == "pending":
                    pending_total += 1
            elif s["place"] == "ignore":
                ignored += 1
            else:
                unsorted["count"] += 1
                unsorted[d] += 1
        from . import dedupe
        groups = dedupe.groups(self)
        extra = sum(len(g["members"]) - 1 for g in groups if g["kind"] in ("exact", "audio"))
        st = self.engine_state()
        orphans = [o for o in st["orphans"] if o[2] in ("missing", "nodir")]
        gl = []
        for g in gens:
            c = by_g[g["id"]]
            gl.append({"id": g["id"], "name": g["name"], "rel": g["rel"], "color": g["color"], "engine": g["engine"],
                       "count": c["count"], "ready": c["ready"], "pending": c["pending"], "none": c["none"],
                       "problem": c["problem"]})
        top = self.catalog.journal_top()
        return {"lib": self.info(), "genres": gl, "unsorted": unsorted["count"], "ignored": ignored,
                "dupes": len([g for g in groups if g["kind"] in ("exact", "audio", "engine")]), "dupe_extra": extra,
                "similar": len([g for g in groups if g["kind"] == "song"]), "problems": problems + len(orphans),
                "orphans": len(orphans), "pending": pending_total,
                "total": sum(c["count"] for c in by_g.values()) + unsorted["count"],
                "engine_open": self.engine_open(), "serato_open": self.serato_open(),
                "undo": {"id": top["id"], "title": top["title"]} if top else None,
                "engine_tracks": len(st["tracks"]), "engine_warning": st.get("warning") or ""}

    def row(self, s, gnames, suggest=None):
        f = s["f"]
        fl = json.loads(f["flags"]) if f.get("flags") else []
        stem = os.path.splitext(names.display(f["name"]))[0]
        g = gnames.get(s["gid"]) if s["gid"] else None
        sub = names.display(f.get("folder") or "")
        if g:
            gr = names.display(g["rel"])
            sub = sub[len(gr) + 1:] if sub.startswith(gr + "/") else ("" if sub == gr else sub)
        return {"id": f["id"], "title": f.get("title") or stem, "artist": f.get("artist") or "",
                "folder": sub, "rel": names.display(f["rel"]), "bpm": round(f["bpm"]) if f.get("bpm") else None,
                "key": f.get("camelot") or "", "dur": round(f["duration"]) if f.get("duration") else None,
                "note": f.get("note") or "", "dot": self.dot(s), "es": s["es"], "bad": s["bad"], "fmt": s["fmt"],
                "dup": (s["dup"] or {}).get("n"), "keeper": (s["dup"] or {}).get("keeper"),
                "genre": g["name"] if g else None, "gid": s["gid"], "sugg": suggest[0] if suggest else None,
                "why": suggest[1] if suggest else None, "flags": fl, "search": f.get("search") or ""}

    def tracks(self, view: str):
        """view: 'all' | 'g:<id>' | 'unsorted' | 'problems' | 'pending' | 'none'"""
        states = self.file_states()
        gens = {g["id"]: g for g in self.genre_rows()}
        rows = []
        if view == "unsorted":
            mem = self.memberships()
            byname = {g["name"]: g for g in gens.values()}
            for s in states.values():
                if s["place"] != "unsorted":
                    continue
                dg = None
                if s["dup"] and s["dup"].get("keeper_gid"):
                    kg = gens.get(s["dup"]["keeper_gid"])
                    dg = kg["name"] if kg else None
                sug = G.suggest_file(s["f"], mem, byname, dupe_genre=dg)
                rows.append(self.row(s, gens, sug if sug[0] else None))
        else:
            for s in states.values():
                if view == "all":
                    ok = s["place"] in ("genre", "unsorted")
                elif view.startswith("g:"):
                    ok = s["place"] == "genre" and str(s["gid"]) == view[2:]
                elif view == "problems":
                    ok = s["bad"] or s["fmt"] or s["es"] == "broken"
                elif view == "pending":
                    ok = s["place"] == "genre" and s["es"] == "pending"
                elif view == "none":
                    ok = s["place"] == "genre" and s["es"] == "none"
                else:
                    ok = False
                if ok:
                    rows.append(self.row(s, gens))
        rows.sort(key=lambda r: (names.fold(r["folder"]), names.fold(r["artist"]), names.fold(r["title"])))
        return rows

    def track_detail(self, fid):
        f = self.catalog.file(fid)
        if not f:
            raise UserError("Parça bulunamadı")
        st = self.engine_state()
        place = self.placer()
        kind, gid = place(f["rel"])
        gens = {g["id"]: g for g in self.genre_rows()}
        from . import dedupe
        dup = dedupe.dup_index(self).get(fid)
        group = None
        if dup:
            for g in dedupe.groups(self):
                if any(m["id"] == fid for m in g["members"]):
                    group = g
                    break
        serato_lists = [r["path"] for r in self.catalog.q(
            "SELECT DISTINCT l.path FROM ext_items e JOIN ext_lists l ON l.src=e.src AND l.list_key=e.list_key "
            "WHERE e.src='serato' AND e.file_id=?", (fid,))]
        rows = st["by_file"].get(fid) or []
        etr = st["tracks"].get(rows[0][0]) if rows else None
        markers = json.loads(f["cues_json"]) if f.get("cues_json") else None
        f.pop("search", None)
        return {"file": f, "disp": names.display(f["rel"]), "abs": self.rootinfo.os_path(f["rel"], f.get("os_rel")),
                "genre": gens[gid]["name"] if gid in gens else None, "place": kind, "es": st["status"].get(fid, "none"),
                "engine": {"id": etr["id"], "analyzed": bool(etr.get("isAnalyzed")), "path": etr.get("path"),
                           "bpm": etr.get("bpmAnalyzed"), "key": etr.get("key")} if etr else None,
                "engine_lists": st["lists_of"].get(fid, []), "serato_lists": serato_lists, "dupe_group": group,
                "markers": markers}
