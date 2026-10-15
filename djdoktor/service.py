"""Kütüphane servis katmanı: tarama, analiz, listeler, etkinlikler, kontrol."""
from __future__ import annotations

import json
import os
import threading
from collections import defaultdict

from . import analysis, engine, events, names, serato, util
from .catalog import Catalog
from .resolver import Resolver, WORKS_ON
from .scanner import RootInfo, scan


class UserError(Exception):
    """Kullanıcıya gösterilecek Türkçe hata. 'code' arayüzün özel davranışı için (ör. 'degisti')."""

    def __init__(self, msg, code=None):
        super().__init__(msg)
        self.code = code


class Library:
    def __init__(self, settings, rec):
        self.settings = settings
        self.rec = rec
        self.id = rec["id"]
        self.root = rec["root"]
        if not os.path.isdir(self.root):
            raise UserError("Kütüphane klasörü bulunamadı: %s (disk takılı mı?)" % self.root)
        self.catalog = Catalog(rec["catalog"], self.root)
        self.rootinfo = RootInfo(self.root)
        events.ensure_templates(self.catalog)
        self.lock = threading.RLock()

    # ------------------------------------------------------------------
    @property
    def readonly(self):
        return bool(self.settings.get_library(self.id).get("readonly", True))

    def require_writable(self, what="Bu işlem"):
        if self.readonly:
            raise UserError("%s diske yazma gerektirir, fakat bu kütüphane SALT-OKUNUR modda. "
                            "Ayarlar > 'Salt-okunur mod' anahtarını kapatarak izin verebilirsiniz." % what)

    def prefs(self):
        return self.settings.prefs()

    def info(self):
        cat = self.catalog
        return {
            "id": self.id, "name": self.rec["name"], "root": self.root, "readonly": self.readonly,
            "catalog": self.rec["catalog"], "shared_catalog": self.rec.get("shared_catalog", False),
            "fstype": self.rootinfo.fstype, "mac_exfat": self.rootinfo.mac_exfat,
            "last_scan": cat.get_meta("last_scan"), "has_serato": bool(serato.serato_dir(self.root)),
            "engine_dbs": [{"key": d["key"], "label": d["label"], "path": d["path"]} for d in engine.find_dbs(self.root)],
            "free": util.free_space(self.root),
        }

    # ------------------------------------------------------------------
    # Tarama + analiz
    # ------------------------------------------------------------------
    def full_scan(self, progress=None, cancel=None):
        def sub(lo, hi):
            return (lambda r, m: progress(lo + (hi - lo) * r, m)) if progress else None
        res = scan(self.catalog, self.rootinfo, self.prefs(), sub(0.0, 0.85), cancel)
        if res.get("cancelled"):
            return res
        if progress:
            progress(0.86, "Serato ve Engine kütüphaneleri okunuyor…")
        res["external"] = self.analyze_external()
        if progress:
            progress(0.95, "Sorunlar ve çiftler hesaplanıyor…")
        res["analysis"] = analysis.compute(self.catalog, self.prefs())
        if progress:
            progress(1.0, "Tamamlandı")
        return res

    def analyze_external(self):
        resolver = Resolver(self.catalog, self.root)
        out = {}
        try:
            s = serato.analyze(self.root, resolver)
        except Exception as e:
            s = None
            out["serato_error"] = str(e)
        if s:
            self.catalog.ext_replace("serato", s["tracks"], s["lists"], s["items"])
            self.catalog.set_meta("serato_info", json.dumps({"dir": s["dir"], "version": s["version"],
                                                             "dialect": s["dialect"]}))
            out["serato"] = {"tracks": len(s["tracks"]), "crates": len(s["lists"])}
        else:
            self.catalog.ext_replace("serato", [], [], [])
        for db in engine.find_dbs(self.root):
            src = "engine:" + db["key"]
            try:
                e = engine.analyze(db, self.root, resolver)
            except Exception as ex:
                out[src + "_error"] = str(ex)
                continue
            self.catalog.ext_replace(src, e["tracks"], e["lists"], e["items"])
            self.catalog.set_meta(src + "_info", json.dumps({"uuid": e["uuid"], "schema": e["schema"],
                                                             "warning": e["warning"], "path": db["path"]}))
            out[src] = {"tracks": len(e["tracks"]), "playlists": len(e["lists"])}
        return out

    def reanalyze(self):
        ext = self.analyze_external()
        a = analysis.compute(self.catalog, self.prefs())
        return {"external": ext, "analysis": a}

    # ------------------------------------------------------------------
    # Parça tablosu
    # ------------------------------------------------------------------
    TRACK_COLS = ["id", "disp", "folder", "name", "title", "artist", "album", "genre", "bpm", "camelot",
                  "duration", "bitrate", "ext", "size", "note", "comment", "energy", "cues", "rating", "year",
                  "flags", "present", "origin", "serato", "engine", "estat", "lists", "art", "search", "sr"]

    def tracks_payload(self):
        cat = self.catalog
        refs = analysis.reference_counts(cat)
        estat = {}
        for r in cat.q("SELECT file_id, match FROM ext_tracks WHERE src LIKE 'engine:%' AND file_id IS NOT NULL"):
            prev = estat.get(r["file_id"])
            if prev is None or (prev != "exact" and r["match"] == "exact"):
                estat[r["file_id"]] = r["match"]
        rows = []
        for f in cat.q("SELECT * FROM files WHERE kind='audio' AND (present=1 OR id IN (SELECT file_id FROM list_items)) "
                       "ORDER BY folder, name"):
            r = refs.get(f["id"], {})
            rows.append([
                f["id"], names.display(f["rel"]), names.display(f["folder"] or ""), names.display(f["name"]),
                f["title"] or "", f["artist"] or "", f["album"] or "", f["genre"] or "",
                round(f["bpm"], 1) if f["bpm"] else None, f["camelot"] or "",
                round(f["duration"], 1) if f["duration"] else None, f["bitrate"], f["ext"], f["size"],
                f["note"] or "", f["comment"] or "", f["mik_energy"], f["cues"] or 0, f["rating"], f["year"],
                json.loads(f["flags"]) if f["flags"] else [], f["present"], f["origin"],
                r.get("serato", 0), r.get("engine", 0), estat.get(f["id"], ""), r.get("lists", 0),
                f["has_art"] or 0, f["search"] or "", f["sample_rate"],
            ])
        return {"cols": self.TRACK_COLS, "rows": rows}

    def track_detail(self, fid):
        cat = self.catalog
        f = cat.file(fid)
        if not f:
            raise UserError("Parça bulunamadı")
        flags = json.loads(f["flags"]) if f.get("flags") else []
        issues = []
        for c in flags:
            sev, title, desc, fix = analysis.ISSUES.get(c, ("bilgi", c, "", ""))
            issues.append({"code": c, "severity": sev, "title": title, "desc": desc, "fix": fix})
        group = None
        for g in self.dupes():
            if any(m["id"] == fid for m in g["members"]):
                group = g
                break
        refs = cat.ext_track_refs(fid)
        for r in refs:
            r["works_on"] = WORKS_ON.get(r["match"], "")
        markers = json.loads(f["cues_json"]) if f.get("cues_json") else None
        f.pop("search", None)
        f["disp"] = names.display(f["rel"])
        f["abs"] = self.rootinfo.os_path(f["rel"], f.get("os_rel"))
        return {"file": f, "issues": issues, "dupe_group": group, "membership": cat.ext_membership(fid),
                "lists": cat.file_list_membership(fid), "ext_refs": refs, "markers": markers}

    def overview(self):
        """Genel bakış: istatistikler, sağlık şeridi verisi, önerilen adımlar."""
        cat = self.catalog
        summ = analysis.summary(cat)
        sev_of = {c: analysis.ISSUES[c][0] for c in analysis.ISSUES}
        estat = {}
        for r in cat.q("SELECT file_id, match FROM ext_tracks WHERE src='engine:drive' AND file_id IS NOT NULL"):
            if estat.get(r["file_id"]) != "exact":
                estat[r["file_id"]] = r["match"]
        strip = []
        folders = []
        fidx = {}
        for f in cat.q("SELECT id, folder, duration, flags, present FROM files WHERE kind='audio' "
                       "AND present=1 ORDER BY folder, name"):
            fl = json.loads(f["flags"]) if f["flags"] else []
            sev = 0
            for c in fl:
                s = sev_of.get(c, "bilgi")
                if s == "kritik":
                    sev = 2
                    break
                if s == "uyari":
                    sev = max(sev, 1)
            if estat.get(f["id"]) in ("unicode", "sfm"):
                sev = 2
            fo = f["folder"] or ""
            if fo not in fidx:
                fidx[fo] = len(folders)
                folders.append(names.display(fo) or "(kök)")
            strip.append([f["id"], round(f["duration"] or 0), sev, fidx[fo]])
        dupes = self.dupes()
        dkind = defaultdict(int)
        extra = 0
        for g in dupes:
            dkind[g["kind"]] += 1
            if g["kind"] in ("exact", "audio"):
                extra += len(g["members"]) - 1
        eng = defaultdict(int)
        for r in cat.q("SELECT match, COUNT(*) AS n FROM ext_tracks WHERE src='engine:drive' GROUP BY match"):
            eng[r["match"]] = r["n"]
        ser = defaultdict(int)
        for r in cat.q("SELECT match, COUNT(*) AS n FROM ext_items WHERE src='serato' GROUP BY match"):
            ser[r["match"]] = r["n"]
        counts = {i["code"]: i["count"] for i in summ["items"]}
        rename_n = sum(counts.get(c, 0) for c in ("name_badchar", "name_trailing", "name_reserved", "name_nfd"))
        steps = [
            {"key": "engine", "title": "Prime 4'te kırmızı görünen parçaları onar",
             "count": eng.get("unicode", 0) + eng.get("sfm", 0),
             "desc": "Engine veritabanındaki yolları diskteki gerçek adlarla eşitler. Müzik dosyalarına dokunmaz."},
            {"key": "rename", "title": "Sorunlu klasör ve dosya adlarını düzelt", "count": rename_n,
             "desc": "Mac'e özel karakterleri temizler; Serato ve Engine'deki yollar birlikte güncellenir."},
            {"key": "junk", "title": "Mac çöp dosyalarını karantinaya taşı",
             "count": counts.get("junk_appledouble", 0) + counts.get("junk_other", 0),
             "desc": "'._' ile başlayan dosyalar DJ programlarında bozuk parça gibi görünür."},
            {"key": "dupes", "title": "Çift kopyaları birleştir", "count": extra,
             "desc": "Notu ve cue'su olan kopya kalır, diğerleri karantinaya gider; listeler asıl kopyaya yönlenir."},
            {"key": "events", "title": "Etkinlik listesini hazırla ve Engine'e gönder", "count": None,
             "desc": "Şablondan bölümleri oluştur, parçaları ekle, tek tıkla Prime 4'e hazırla."},
        ]
        return {"info": self.info(), "stats": summ["stats"], "issues": summ["items"], "strip": strip,
                "folders": folders, "dupes": dict(dkind), "dupe_extra": extra, "engine": dict(eng),
                "serato": dict(ser), "steps": steps, "lists": len(cat.q("SELECT id FROM lists"))}

    def dupes(self):
        raw = self.catalog.get_meta("dupes")
        try:
            return json.loads(raw) if raw else []
        except ValueError:
            return []

    def issues(self):
        return analysis.summary(self.catalog)

    def issue_files(self, code):
        rows = self.catalog.q("SELECT id, rel, size, kind FROM files WHERE flags LIKE ?", ('%"' + code + '"%',))
        return [{"id": r["id"], "disp": names.display(r["rel"]), "size": r["size"], "kind": r["kind"]} for r in rows]

    def folders(self):
        counts = defaultdict(int)
        for r in self.catalog.q("SELECT folder, COUNT(*) AS n FROM files WHERE kind='audio' AND present=1 GROUP BY folder"):
            parts = names.split_rel(r["folder"] or "")
            for i in range(len(parts) + 1):
                counts["/".join(parts[:i])] += r["n"]
        tree = []
        for path in sorted(counts):
            if not path:
                continue
            tree.append({"path": path, "disp": names.display(path), "depth": path.count("/"), "n": counts[path]})
        return {"total": counts.get("", 0), "folders": tree}

    # ------------------------------------------------------------------
    # Listeler
    # ------------------------------------------------------------------
    def lists_tree(self):
        rows = self.catalog.lists_all()
        sync = defaultdict(list)
        for r in self.catalog.q("SELECT list_id, target, last_sync FROM sync_map"):
            sync[r["list_id"]].append({"target": r["target"], "ts": r["last_sync"]})
        for r in rows:
            r["sync"] = sync.get(r["id"], [])
        return rows

    def list_items(self, lid):
        items = self.catalog.items(lid)
        out = []
        prev_key = None
        for it in items:
            comp = ""
            if prev_key and it.get("camelot"):
                from . import keys
                comp = keys.compatible(prev_key, it["camelot"])
            prev_key = it.get("camelot") or prev_key
            out.append({
                "item_id": it["item_id"], "id": it["id"], "disp": names.display(it["rel"]),
                "title": it["title"] or os.path.splitext(names.display(it["name"]))[0], "artist": it["artist"] or "",
                "bpm": round(it["bpm"], 1) if it.get("bpm") else None, "camelot": it.get("camelot") or "",
                "duration": it.get("duration"), "note": it.get("note") or "", "item_note": it.get("item_note") or "",
                "present": it["present"], "flags": json.loads(it["flags"]) if it.get("flags") else [],
                "bitrate": it.get("bitrate"), "ext": it.get("ext"), "key_comp": comp, "energy": it.get("mik_energy"),
            })
        return out

    def create_event(self, data):
        title = (data.get("title") or "").strip()
        if not title:
            raise UserError("Etkinlik adı gerekli")
        info = {k: data.get(k) for k in ("type", "date", "venue", "couple", "notes", "requests", "donotplay",
                                          "contact", "start", "end")}
        info["sync_engine"] = bool(data.get("sync_engine", True))
        info["sync_serato"] = bool(data.get("sync_serato", False))
        parent = data.get("parent_id")
        eid = self.catalog.list_create(parent, "event", title, info)
        for i, sec in enumerate(data.get("sections") or []):
            if sec and str(sec).strip():
                self.catalog.list_create(eid, "section", str(sec).strip(), {}, pos=i + 1)
        return eid

    def event_overview(self, eid):
        ev = self.catalog.list_get(eid)
        if not ev:
            raise UserError("Etkinlik bulunamadı")
        secs = []
        total = 0.0
        for s in self.catalog.list_children(eid):
            items = self.list_items(s["id"])
            dur = sum(i["duration"] or 0 for i in items)
            total += dur
            secs.append({"id": s["id"], "title": s["title"], "items": items, "duration": dur,
                         "info": json.loads(s["info"]) if s.get("info") else {}})
        return {"event": ev, "sections": secs, "duration": total}

    def suggestions(self, lid):
        lst = self.catalog.list_get(lid)
        if not lst:
            return []
        exclude = set(self.catalog.item_file_ids(lid))
        if lst.get("parent_id"):
            for sib in self.catalog.list_children(lst["parent_id"]):
                exclude.update(self.catalog.item_file_ids(sib["id"]))
        return events.suggest(self.catalog, lst["title"], exclude)

    # ------------------------------------------------------------------
    # Gig öncesi kontrol
    # ------------------------------------------------------------------
    def gig_check(self, lid):
        cat = self.catalog
        lst = cat.list_get(lid)
        if not lst:
            raise UserError("Liste bulunamadı")
        ids = [lid] + cat.list_descendants(lid)
        file_ids, where = [], {}
        for i in ids:
            for fid in cat.item_file_ids(i):
                file_ids.append(fid)
                where.setdefault(fid, []).append(" / ".join(cat.list_path(i)))
        checks = []

        def add(sev, title, detail, items=None):
            checks.append({"severity": sev, "title": title, "detail": detail, "items": items or []})

        uniq = list(dict.fromkeys(file_ids))
        files = {f["id"]: f for f in cat.q("SELECT * FROM files WHERE id IN (%s)" % ",".join(str(x) for x in uniq))} if uniq else {}
        miss = [names.display(files[f]["rel"]) for f in uniq if f in files and not files[f]["present"]]
        if miss:
            add("kritik", "%d parça diskte yok" % len(miss), "Bu dosyalar taşınmış ya da silinmiş.", miss)
        bad = [names.display(files[f]["rel"]) for f in uniq if f in files and files[f].get("flags") and
               any(c in files[f]["flags"] for c in ("name_badchar", "name_trailing", "name_reserved"))]
        if bad:
            add("kritik", "%d parçanın adında Prime 4/Windows'ta sorun çıkaran karakter var" % len(bad),
                "Düzeltme > Güvenli ad düzeltme ile düzeltin.", bad)
        fmt = [names.display(files[f]["rel"]) for f in uniq if f in files and files[f]["ext"] not in names.ENGINE_OK_EXTS]
        if fmt:
            add("kritik", "%d parça Prime 4'te çalınamayan biçimde" % len(fmt), "MP3/M4A/FLAC'a dönüştürün.", fmt)
        broken = [names.display(files[f]["rel"]) for f in uniq if f in files and files[f].get("tag_error")]
        if broken:
            add("uyari", "%d parça okunurken hata verdi" % len(broken), "Dosya bozuk olabilir; dinleyerek kontrol edin.", broken)
        # aynı ses iki kez
        by_sig = defaultdict(list)
        for f in uniq:
            if f in files and files[f].get("qsig"):
                by_sig[files[f]["qsig"]].append(f)
        dup = [" = ".join(names.display(files[x]["name"]) for x in v) for v in by_sig.values() if len(v) > 1]
        if dup:
            add("uyari", "Aynı parça farklı kopyalarla %d kez listede" % len(dup), "Birini çıkarın.", dup)
        repeated = [names.display(files[f]["name"]) + "  →  " + " | ".join(where[f]) for f in uniq if len(where.get(f, [])) > 1]
        if repeated:
            add("bilgi", "%d parça birden fazla bölümde" % len(repeated), "Bilerek yaptıysanız sorun değil.", repeated)
        # Engine durumu
        dbs = engine.find_dbs(self.root)
        drive = [d for d in dbs if d["key"] == "drive"]
        if drive:
            src = "engine:drive"
            em = {}
            for r in cat.q("SELECT file_id, match, info FROM ext_tracks WHERE src=? AND file_id IS NOT NULL", (src,)):
                em[r["file_id"]] = (r["match"], json.loads(r["info"] or "{}"))
            not_in = [names.display(files[f]["rel"]) for f in uniq if f in files and f not in em]
            red = [names.display(files[f]["rel"]) for f in uniq if f in em and em[f][0] not in ("exact", "case")]
            unan = [names.display(files[f]["rel"]) for f in uniq if f in em and not em[f][1].get("analyzed")]
            synced = cat.q("SELECT last_sync FROM sync_map WHERE target='engine' AND list_id=?", (lid,))
            if not synced:
                add("uyari", "Bu liste henüz Engine'e gönderilmedi", "Serato & Engine > Engine'e gönder.")
            if not_in:
                add("uyari", "%d parça Engine kütüphanesinde yok" % len(not_in),
                    "Engine'e gönderince otomatik eklenir.", not_in)
            if red:
                add("kritik", "%d parça Prime 4'te KIRMIZI görünecek" % len(red),
                    "Engine yolu Türkçe karakter/Mac biçiminde. 'Engine yol onarımı' ile düzeltin.", red)
            if unan:
                add("bilgi", "%d parça Engine'de analiz edilmemiş" % len(unan),
                    "Engine DJ masaüstünde diski açıp bu listeyi analiz edin (Prime 4 çalarken de analiz eder ama yavaştır).", unan)
        else:
            add("bilgi", "Diskte Engine kütüphanesi bulunamadı", "Engine'e gönderince oluşturulmaz; önce Engine DJ ile diski bir kez açın.")
        low = [names.display(files[f]["rel"]) for f in uniq if f in files and files[f].get("flags") and "audio_lowbr" in files[f]["flags"]]
        if low:
            add("bilgi", "%d parça düşük kalitede (192 kbps altı)" % len(low), "Büyük salonda fark edilebilir.", low)
        total = sum((files[f].get("duration") or 0) for f in uniq if f in files)
        sev_order = {"kritik": 0, "uyari": 1, "bilgi": 2}
        checks.sort(key=lambda c: sev_order[c["severity"]])
        status = "kritik" if any(c["severity"] == "kritik" for c in checks) else (
            "uyari" if any(c["severity"] == "uyari" for c in checks) else "tamam")
        return {"title": lst["title"], "tracks": len(uniq), "duration": total, "status": status, "checks": checks}
