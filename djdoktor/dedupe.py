"""Çiftler: aynı şarkının diskte birden çok kopyası ve Engine'de iki kez görünen parçalar.

Grup türleri:
  exact  : bayt bayt aynı dosya (aynı ses, aynı etiket)
  audio  : aynı ses, farklı etiket (yorum, ton, cue farkı)
  song   : aynı şarkı, farklı kayıt/kalite (ad + süre aynı, ses farklı) — yalnızca bilgi, otomatik birleşmez
  engine : tek dosya, Engine koleksiyonunda iki (veya daha çok) kayıt -> Engine'de iki kez görünür

Birleştirme (merge):
  * Tutulacak kopya seçilir (tür klasöründe olan, Engine'de analiz edilmiş, listelerde kullanılan,
    notu olan, kalitesi yüksek olan öne çıkar).
  * Diğer kopyalar SİLİNMEZ: SSD'deki _DJDoktor_/Karantina klasörüne taşınır.
  * Engine: listelerdeki kayıtlar tutulan kopyaya yönlendirilir, fazla kayıtlar koleksiyondan çıkar
    (aynı sesse analiz/cue bilgisi korunur). Geri alma, işlem öncesi yedekten yapılır.
  * Serato: crate'lerdeki yollar tutulan kopyaya çevrilir.
"""
from __future__ import annotations

import hashlib
import json
import os
from collections import defaultdict

from . import engine, journal, names, serato, util

LOSSLESS = (".flac", ".wav", ".aif", ".aiff", ".alac")


def _ctx(lib):
    st = lib.engine_state()
    place = lib.placer()
    gens = {g["id"]: g for g in lib.genre_rows()}
    nlists = defaultdict(int)
    for fid, paths in st["lists_of"].items():
        nlists[fid] = len(set(paths))
    scrates = defaultdict(int)
    for r in lib.catalog.q("SELECT file_id, COUNT(DISTINCT list_key) AS n FROM ext_items WHERE src='serato' AND "
                           "file_id IS NOT NULL GROUP BY file_id"):
        scrates[r["file_id"]] = r["n"]
    return {"st": st, "place": place, "gens": gens, "nlists": nlists, "scrates": scrates}


def _score(f, ctx):
    st = ctx["st"]
    s, why = 0.0, []
    kind, gid = ctx["place"](f["rel"])
    if kind == "genre" and gid in ctx["gens"]:
        s += 100
        why.append("%s klasöründe" % ctx["gens"][gid]["name"])
    elif kind == "ignore":
        s -= 20
    rows = st["by_file"].get(f["id"]) or []
    analyzed = any(st["tracks"][t].get("isAnalyzed") for t, _m in rows)
    if analyzed:
        s += 60
        why.append("Engine'de analiz edilmiş")
    elif rows:
        s += 30
        why.append("Engine'de var")
    nl = ctx["nlists"].get(f["id"], 0)
    if nl:
        s += 40 * min(3, nl)
        why.append("Engine'de %d listede" % nl)
    sc = ctx["scrates"].get(f["id"], 0)
    if sc:
        s += 30 * min(3, sc)
        why.append("Serato'da %d crate'te" % sc)
    if f.get("note"):
        s += 60
        why.append("notun var: “%s”" % f["note"][:40])
    if f.get("cues"):
        s += 25
        why.append("%d cue" % f["cues"])
    if f.get("camelot"):
        s += 8
    ext = f.get("ext") or ""
    if ext in LOSSLESS:
        s += 14
        why.append("kayıpsız")
    elif f.get("bitrate"):
        s += (f["bitrate"] or 0) / 32.0
        if f["bitrate"] >= 300:
            why.append("%d kbps" % f["bitrate"])
    if f.get("origin") == "engine_copy":
        s -= 80
        why.append("Engine'in yaptığı kopya")
    fl = json.loads(f["flags"]) if f.get("flags") else []
    if "audio_error" in fl or "audio_empty" in fl:
        s -= 300
        why.append("bozuk")
    if "fmt_engine" in fl:
        s -= 40
    s -= len(f["rel"]) / 1000.0
    return s, why


def _member(f, ctx, score, why):
    st = ctx["st"]
    rows = st["by_file"].get(f["id"]) or []
    kind, gid = ctx["place"](f["rel"])
    g = ctx["gens"].get(gid) if kind == "genre" else None
    return {"id": f["id"], "rel": names.display(f["rel"]), "folder": names.display(f.get("folder") or ""),
            "name": names.display(f["name"]), "genre": g["name"] if g else None, "gid": g["id"] if g else None,
            "color": g["color"] if g else None, "size": f.get("size"), "bitrate": f.get("bitrate"),
            "duration": f.get("duration"), "ext": f.get("ext"), "title": f.get("title"), "artist": f.get("artist"),
            "note": f.get("note"), "camelot": f.get("camelot"), "bpm": f.get("bpm"), "cues": f.get("cues") or 0,
            "origin": f.get("origin"), "engine": len(rows),
            "analyzed": any(st["tracks"][t].get("isAnalyzed") for t, _m in rows),
            "lists": ctx["nlists"].get(f["id"], 0), "serato": ctx["scrates"].get(f["id"], 0),
            "score": round(score, 1), "why": why}


def richness(f):
    """Bir kopyanın etiketlerindeki DJ bilgisi: not, Serato cue'ları, ton (Mixed In Key), BPM…"""
    r = 0
    if f.get("note"):
        r += 100
    if f.get("cues"):
        r += 50 + min(f["cues"], 8)
    if f.get("camelot"):
        r += 20
    if f.get("mik_energy"):
        r += 5
    if f.get("bpm"):
        r += 3
    if f.get("rating"):
        r += 3
    for k in ("title", "artist", "album", "genre"):
        if f.get(k):
            r += 2
    if f.get("has_art"):
        r += 2
    return r


def _make(gid, kind, members, ctx):
    scored = sorted(((_score(m, ctx), m) for m in members), key=lambda x: -x[0][0])
    keeper = scored[0][1]
    # aynı ses ama etiketler farklıysa: YER tür klasöründeki kopyanınki, İÇERİK (not, ton, cue) en dolu kopyanınki
    content = None
    if kind == "audio":
        best = max(members, key=lambda m: (richness(m), m["id"] == keeper["id"]))
        if best["id"] != keeper["id"] and richness(best) > richness(keeper):
            content = best
    out = []
    for (s, why), m in scored:
        d = _member(m, ctx, s, why)
        d["keeper"] = m["id"] == keeper["id"]
        d["content"] = bool(content and m["id"] == content["id"])
        out.append(d)
    src = content or keeper
    missing = []
    if not src.get("note") and any(m.get("note") for m in members):
        missing.append("not")
    if not src.get("cues") and any(m.get("cues") for m in members):
        missing.append("cue")
    if not src.get("camelot") and any(m.get("camelot") for m in members):
        missing.append("ton")
    return {"id": gid, "kind": kind, "members": out, "keeper": keeper["id"],
            "content": content["id"] if content else None, "missing": missing}


def groups(lib):
    """Tüm çift grupları (önbellekli)."""
    st = lib.engine_state()
    key = lib.data_key() + (st.get("seq"),)
    if lib._dupes is not None and lib._dupes_ver == key:
        return lib._dupes
    from .library import STATE_DIR
    files = [f for f in lib.audio_files() if not f["rel"].startswith(STATE_DIR + "/")]
    ctx = _ctx(lib)
    out = []
    in_audio = {}
    by_sig = defaultdict(list)
    for f in files:
        if f.get("qsig") and (f.get("alen") or 0) > 0:
            by_sig[(f["qsig"], f.get("alen"))].append(f)
    for (sig, _alen), members in by_sig.items():
        if len(members) < 2:
            continue
        exact = len({(m.get("tagsig"), m.get("size")) for m in members}) == 1
        g = _make("a:" + sig[:20], "exact" if exact else "audio", members, ctx)
        out.append(g)
        for m in members:
            in_audio[m["id"]] = g["id"]
    # aynı şarkı, farklı kayıt
    by_song = defaultdict(list)
    for f in files:
        if f.get("songkey") and f.get("duration"):
            by_song[f["songkey"]].append(f)
    for skey, members in by_song.items():
        if len(members) < 2:
            continue
        members.sort(key=lambda m: m["duration"])
        clusters, cur = [], [members[0]]
        for m in members[1:]:
            if abs(m["duration"] - cur[-1]["duration"]) <= 3.0:
                cur.append(m)
            else:
                clusters.append(cur)
                cur = [m]
        clusters.append(cur)
        for cl in clusters:
            if len(cl) < 2:
                continue
            # aynı ses grubundakileri tek temsilciye indir
            seen, rep = set(), []
            for m in cl:
                ag = in_audio.get(m["id"])
                if ag and ag in seen:
                    continue
                if ag:
                    seen.add(ag)
                rep.append(m)
            if len(rep) < 2:
                continue
            gid = "s:" + hashlib.md5((skey + str(int(cl[0]["duration"]))).encode("utf-8")).hexdigest()[:12]
            out.append(_make(gid, "song", rep, ctx))
    # tek dosya, Engine'de birden çok kayıt
    files_by_id = {f["id"]: f for f in files}
    for fid, rows in st["by_file"].items():
        if len(rows) > 1 and fid not in in_audio and fid in files_by_id:
            g = _make("e:%d" % fid, "engine", [files_by_id[fid]], ctx)
            g["tracks"] = [{"tid": t, "path": st["tracks"][t].get("path"), "match": m,
                            "analyzed": bool(st["tracks"][t].get("isAnalyzed"))} for t, m in rows]
            out.append(g)
    order = {"exact": 0, "audio": 1, "engine": 2, "song": 3}
    out.sort(key=lambda g: (order[g["kind"]], -len(g["members"]), g["members"][0]["rel"]))
    lib._dupes, lib._dupes_ver = out, key
    return out


def dup_index(lib):
    """{file_id: {'n', 'keeper', 'keeper_gid', 'group', 'kind'}} — kopyası olan dosyalar (önbellekli)."""
    gs = groups(lib)
    return lib.cached("dup_index", lib._dupes_ver, lambda: _dup_index(gs))


def _dup_index(gs):
    idx = {}
    for g in gs:
        keeper = next(m for m in g["members"] if m["keeper"])
        for m in g["members"]:
            if m["id"] in idx and idx[m["id"]]["kind"] in ("exact", "audio"):
                continue
            idx[m["id"]] = {"n": len(g["members"]) if g["kind"] != "engine" else len(g.get("tracks") or []),
                            "keeper": m["keeper"], "keeper_gid": keeper.get("gid"), "group": g["id"],
                            "kind": g["kind"], "content": bool(m.get("content"))}
    return idx


# ---------------------------------------------------------------------------
# Birleştirme
# ---------------------------------------------------------------------------
def _best_tid(tids, tracks, nlist):
    return sorted(tids, key=lambda t: (not tracks[t].get("isAnalyzed"), -nlist.get(t, 0), t))[0]


def _engine_merge(lib, d, pairs, eng_only, files, op, progress=None):
    """Bir Engine veritabanında çiftleri birleştirir. Anlık görüntü (yedek) ile geri alınır."""
    data = engine.read(d["path"])
    tracks, by_file, _orph, ref_of, _tor = lib.engine_map(d, data)
    involved = {rm for rm, _k, _s in pairs} | {kp for _r, kp, _s in pairs} | set(eng_only)
    if not any(by_file.get(f) for f in involved):
        return None
    nlist = defaultdict(int)
    for p in data["playlists"]:
        for t in set(x for x in p["entries"] if x):
            nlist[t] += 1
    try:
        engine.preflight(d["path"])
    except engine.EngineError as e:
        from .library import UserError
        raise UserError(str(e))
    bk = engine.backup(d["path"], lib.backup_dir("engine"), "ciftler")
    engine.prune_backups(lib.backup_dir("engine"))
    stats = {"repath": 0, "repoint": 0, "removed": 0, "added": 0}
    w = engine.Writer(d["path"], d["lib_dir"], lib.root)
    try:
        keep_of = {}

        def canonical_path(fid, like=None):
            rel = files[fid]["rel"]
            if like:
                return engine.repath(like, None, rel, d["lib_dir"], lib.root)
            return engine.rel_to_engine_path(rel, d["lib_dir"], lib.root)

        def fold_into(keep, others):
            kref = (w.track(keep)["originDatabaseUuid"], w.track(keep)["originTrackId"])
            for t in others:
                tr = w.track(t)
                if not tr:
                    continue
                ref = (tr["originDatabaseUuid"], tr["originTrackId"])
                if ref != kref:
                    stats["repoint"] += w.repoint_refs(ref, kref)
                w.track_delete(t)
                stats["removed"] += 1

        for rm, kp, same in pairs:
            rm_t = [t for t, _m in by_file.get(rm, []) if w.track(t)]
            kp_t = [t for t, _m in by_file.get(kp, []) if w.track(t)]
            if kp in keep_of:
                kp_t = [keep_of[kp]]
            if not rm_t:
                continue
            if same:
                # aynı ses: en değerli Engine kaydı (analiz edilmiş, listelerde olan) kalır ve tutulan dosyayı gösterir
                pool = [t for t in kp_t + rm_t if t in tracks]
                best = _best_tid(pool, tracks, nlist)
                fold_into(best, [t for t in kp_t + rm_t if t != best])
                newp = canonical_path(kp, tracks[best].get("path"))
                if w.track(best)["path"] != newp:
                    r = w.track_set_path(best, newp)
                    if r == "ok":
                        stats["repath"] += 1
                    elif r == "cakisma":
                        ex = w.track_by_path(newp)
                        fold_into(ex["id"], [best])
                        best = ex["id"]
                keep_of[kp] = best
                continue
            if not kp_t:
                row = w.track_add(files[kp], canonical_path(kp))
                stats["added"] += 1
                kp_t = [row["id"]]
            keep = _best_tid(kp_t, tracks, nlist) if all(t in tracks for t in kp_t) else kp_t[0]
            fold_into(keep, [t for t in kp_t if t != keep] + rm_t)
            keep_of[kp] = keep
        for fid in eng_only:
            rows = [t for t, _m in by_file.get(fid, [])]
            if len(rows) < 2:
                continue
            keep = _best_tid(rows, tracks, nlist)
            fold_into(keep, [t for t in rows if t != keep])
            newp = canonical_path(fid, tracks[keep].get("path"))
            if w.track(keep)["path"] != newp:
                if w.track_set_path(keep, newp) == "ok":
                    stats["repath"] += 1
        w.commit()
    except Exception:
        w.rollback()
        raise
    op.add({"k": "engsnap", "db": d["key"], "dbpath": d["path"], "backup": bk,
            "fp": engine.semantic_fingerprint(d["path"])})
    return stats


def _serato_refs(sx, rel):
    """Bu dosyaya işaret eden Serato ham yolları (diskten TAZE dizinden: Mac / Windows yazımı, harf farkı dahil)."""
    if not sx or not sx["raws"] or not rel:
        return set()
    return set(sx["by_mkey"].get(names.match_key(rel), ())) | set(sx["by_lkey"].get(names.loose_key(rel), ()))


def _serato_merge(lib, pairs, files, op, sx=None):
    """Kaldırılan kopyaların Serato yolları (database V2 + bütün crate'ler) tutulan kopyaya çevrilir.
    Yollar diskten taze okunur (Serato'da sonradan eklenenler de), yazım biçimi (Mac NFD / Windows) korunur,
    aynalı crate bağları yenilenir (ayna bunu 'Serato'da değişti' sanmaz)."""
    from . import relocate
    sdir = lib.serato_dir()
    if not sdir:
        return None
    sx = sx or serato.index(sdir)
    if not sx["raws"]:
        return None
    dialect = relocate._dialect(lib, sx)
    mapping, drop = {}, set()
    for rm, kp, same in pairs:
        orel, krel = files[rm]["rel"], files[kp]["rel"]
        if names.match_key(orel) == names.match_key(krel):
            continue                    # NFC / NFD ikizleri: Serato'daki yol zaten ikisini de gösterir
        for raw in _serato_refs(sx, orel):
            target = sx["db_by_mkey"].get(names.match_key(krel)) or serato.raw_for(raw, orel, krel, dialect)
            if target != raw:
                mapping[raw] = target
            if not same:
                drop.add(raw)
    if not mapping and not drop:
        return None
    bk = serato.backup(sdir, lib.backup_dir("serato"), "ciftler")
    members = serato.backup_members(bk)
    before = serato.state_fp(sdir, members)
    try:
        stats = serato.rewrite_paths(sdir, mapping, drop_db_paths=frozenset(drop))
    except Exception:
        now = serato.state_fp(sdir, members)            # yarıda kaldı: değişen dosyalar yedekten geri
        serato.restore_backup(sdir, bk, only={m for m, h in now.items() if before.get(m) != h})
        raise
    after = serato.state_fp(sdir, members)
    changed = {m: h for m, h in after.items() if before.get(m) != h}
    if changed:
        op.add({"k": "sersnap", "backup": bk, "hashes": changed})
    stats["mirror_links"] = relocate._refresh_mirror_links(lib, sdir, before, after, op)
    return stats


def serato_raw_for(raw_old, old_rel, new_rel, dialect=None):
    """Serato'daki eski yazımın lehçesini (Mac: ayrık harf + ':') koruyarak yeni yolu yazar (serato.raw_for)."""
    return serato.raw_for(raw_old, old_rel, new_rel, dialect)


def quarantine_files(lib, fids, label, op, files=None):
    """Dosyaları SSD'deki karantinaya taşır (silmez). Mac yardımcı dosyaları (._) birlikte taşınır."""
    from .library import STATE_DIR
    cat = lib.catalog
    qrel = lib.quarantine_rel(label)
    moved = 0
    for fid in fids:
        f = (files or {}).get(fid) or cat.file(fid)
        if not f:
            continue
        src = lib.rootinfo.os_path(f["rel"], f.get("os_rel"))
        if not os.path.exists(src):
            continue
        dst_rel = qrel + "/" + "/".join(names.split_rel(f.get("os_rel") or f["rel"]))
        dst = lib.rootinfo.os_path(dst_rel)
        dst = util.unique_path(dst)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        os.rename(src, dst)
        real_rel = os.path.relpath(dst, lib.root).replace(os.sep, "/")
        op.add({"k": "q", "fid": fid, "old": f["rel"], "dst": real_rel, "origin": f.get("origin")})
        cat.update_file(fid, present=0, origin="quarantine")
        moved += 1
        comp = os.path.join(os.path.dirname(src), "._" + os.path.basename(src))
        if os.path.isfile(comp):
            cdst = os.path.join(os.path.dirname(dst), "._" + os.path.basename(dst))
            try:
                util.safe_rename(comp, cdst)
                op.add({"k": "q", "fid": None, "old": os.path.relpath(comp, lib.root).replace(os.sep, "/"),
                        "dst": os.path.relpath(cdst, lib.root).replace(os.sep, "/"), "raw": True})
            except OSError:
                pass
    return moved


def _move_into(lib, f, rel, op):
    """Dosyayı verilen (boşaltılmış) yola taşır; katalog satırı o yolu devralır."""
    src = lib.rootinfo.os_path(f["rel"], f.get("os_rel"))
    dst = lib.rootinfo.os_path(rel)
    if os.path.exists(dst):
        raise OSError("Hedef dolu: %s" % rel)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    util.safe_rename(src, dst)
    op.add({"k": "mv", "fid": f["id"], "old": f["rel"], "new": rel})
    lib.catalog.update_rel(f["id"], rel, lib.rootinfo.os_rel_of(rel), names.match_key(rel), names.loose_key(rel))


def merge(lib, picks, progress=None):
    """picks: [{'group': id, 'keeper': file_id | None}] -> özet. Tek işlem olarak geri alınabilir."""
    from .library import UserError
    with lib.lock:
        allg = {g["id"]: g for g in groups(lib)}
        pairs, eng_only, swaps = [], [], {}
        for p in picks:
            g = allg.get(p.get("group"))
            if not g:
                continue
            if g["kind"] == "engine":
                eng_only.append(g["members"][0]["id"])
                continue
            keeper = int(p.get("keeper") or g["keeper"])
            if not any(m["id"] == keeper for m in g["members"]):
                continue
            content = p.get("content", g.get("content") if keeper == g["keeper"] else None)
            if content and g["kind"] == "audio" and int(content) != keeper and \
                    any(m["id"] == int(content) for m in g["members"]):
                swaps[keeper] = int(content)
            for m in g["members"]:
                if m["id"] != keeper:
                    pairs.append((m["id"], keeper, g["kind"] in ("exact", "audio")))
        if not pairs and not eng_only:
            raise UserError("Birleştirilecek kopya seçilmedi.")
        cat = lib.catalog
        ids = sorted({a for a, _b, _c in pairs} | {b for _a, b, _c in pairs} | set(eng_only))
        files = {f["id"]: f for f in cat.q("SELECT * FROM files WHERE id IN (%s)" % ",".join(map(str, ids)))}
        st = lib.engine_state()
        need_engine = any(st["by_file"].get(i) for i in ids)
        sdir = lib.serato_dir()
        sx = serato.index(sdir) if sdir else None          # diskten taze (Serato'da sonradan eklenenler de)
        need_serato = any(_serato_refs(sx, files[a]["rel"]) for a, _b, _c in pairs if a in files)
        # yazmadan hemen önce taze denetim (önbellekteki birkaç saniyelik 'kapalı' sonucu kullanılmaz)
        if need_engine and lib.engine_open(fresh=True):
            raise UserError("Engine DJ açık. Çiftleri birleştirmek için Engine DJ'i kapatın.", code="engine_open")
        if need_serato and lib.serato_open(fresh=True):
            raise UserError("Serato açık. Çiftleri birleştirmek için Serato'yu kapatın.", code="serato_open")
        n_files = len({a for a, _b, _c in pairs})
        title = ("%d fazla kopya kaldırıldı" % n_files) if n_files else "Engine'de iki kez görünen parçalar düzeltildi"
        op = journal.Op(lib, "ciftler", title)
        res = {"files": n_files, "engine": {}, "serato": None}
        if progress:
            progress(0.1, "Engine kütüphanesi düzenleniyor…")
        try:
            for d in lib.engine_dbs():
                r = _engine_merge(lib, d, pairs, eng_only, files, op)
                if r:
                    res["engine"][d["key"]] = r
            if progress:
                progress(0.45, "Serato listeleri düzenleniyor…")
            res["serato"] = _serato_merge(lib, pairs, files, op, sx) if need_serato else None
            if progress:
                progress(0.6, "Fazla kopyalar karantinaya taşınıyor…")
            rm_ids = sorted({a for a, _b, _c in pairs} - set(swaps.values()))
            quarantine_files(lib, rm_ids, "ciftler", op, files)
            for rm, kp, _same in pairs:
                cat.add_history(files[rm]["rel"], kp)
            # içerik değişimi: zengin etiketli kopya, tür klasöründeki kopyanın YERİNE geçer
            for kp, ct in swaps.items():
                quarantine_files(lib, [kp], "ciftler", op, files)
                _move_into(lib, files[ct], files[kp]["rel"], op)
                cat.add_history(files[ct]["rel"], ct)
        except Exception:
            # yarım kalmasın: bu işlemde yapılan her şey (Engine, Serato, karantina) geri alınır
            journal.apply_inverse(lib, op.steps, force=True)
            lib.bump()
            raise
        res["content_swaps"] = len(swaps)
        op.info = {"pairs": pairs, "eng_only": eng_only, "swaps": swaps}
        lib.bump()
        if progress:
            progress(0.85, "Engine kontrol ediliyor…")
        from . import maintain
        res["maint"] = maintain.after_change(lib, op)
        res["journal"] = op.commit()
        return res
