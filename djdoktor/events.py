"""Etkinlik yardımcıları (v1'den): bölüm önerileri, etkinlik öncesi kontrol, uyumlu şarkılar.

  * suggest(lib, pid)   : bir bölüm (ör. "Halay", "İlk Dans") için kütüphaneden öneriler. Tür klasörü, bölüm adındaki
                          kelimeler, Serato crate / Engine liste adları, klasör adları, etiketler ve listedeki
                          şarkıların BPM'i birlikte puanlanır. Etkinliğin başka bölümlerinde olan şarkılar önerilmez.
  * gig_check(lib, pid) : etkinlikten önce: her şarkı diskte mi, Engine'de doğru yolda ve analiz edilmiş mi,
                          Prime 4 çalar mı, aynı şarkı iki kez var mı; bölüm bölüm süreler.
  * compatible(lib, fid): tona (Camelot) ve BPM'e göre bu şarkıdan sonra çalınabilecekler.
"""
from __future__ import annotations

import json
from collections import defaultdict

from . import genres as G, keys, names

# Bölüm adı -> anahtar kelimeler (katlanmış biçimde)
SECTION_KEYWORDS = {
    "karşılama": ["fon", "enstrumantal", "instrumental", "piano", "kanun", "cello", "keman", "ney", "lounge", "chill",
                  "jazz"],
    "fon": ["fon", "enstrumantal", "instrumental", "piano", "kanun", "cello", "keman", "ney", "lounge"],
    "giriş": ["giris", "entrance", "intro", "gelin", "damat", "wedding", "epic", "ozel"],
    "ilk dans": ["slow", "ilk dans", "first dance", "ask", "love", "sevda", "romantic", "ballad", "cift dans"],
    "slow": ["slow", "ask", "love", "sevda", "ballad", "cift dans"],
    "pasta": ["pasta", "cake", "happy", "mutlu", "dogum gunu"],
    "takı": ["taki", "oyun havasi", "sallama", "zurna"],
    "halay": ["halay", "grani", "govend", "delilo", "semmame", "bomba", "tulum", "dik halay", "3 ayak", "uc ayak",
              "potpori"],
    "kürtçe": ["kurtce", "kurdish", "kurdi", "grani", "govend", "delilo", "semmame", "cida", "rojda", "kurmanci"],
    "horon": ["horon", "karadeniz", "kemence", "tulum", "laz", "hemsin", "rize", "trabzon"],
    "roman": ["roman", "mezdeke", "ciftetelli", "9 8", "9/8", "gypsy", "darbuka", "kasap"],
    "mezdeke": ["mezdeke", "roman", "ciftetelli"],
    "oyun havası": ["oyun havasi", "oyun", "ankara", "zeybek", "kasik", "potpori", "ege", "klarnet", "zurna", "davul"],
    "ankara": ["ankara", "oyun havasi", "kasik", "misket"],
    "sallama": ["sallama", "grani", "oyun havasi"],
    "türkçe pop": ["pop", "turkce", "turkish", "remix", "hit"],
    "yabancı": ["yabanci", "remix", "mashup", "club", "dance", "edm", "house", "reggaeton", "latin", "english"],
    "dans": ["dance", "dans", "club", "mashup", "remix", "house", "edm", "reggaeton", "latin"],
    "arabic": ["arabic", "arab", "oryantal", "oriental", "habibi", "yalla", "darbuka"],
    "kına": ["kina", "tepsi", "yuksek yuksek", "annem", "gelin", "mumlar"],
    "çıkış": ["cikis", "final", "kapanis", "veda", "outro"],
    "yedek": ["yedek", "notfall", "pop", "hit"],
    "çocuk": ["cocuk", "kids", "sunnet", "children"],
    "matine": ["matine", "oyun havasi", "roman", "arabic"],
    "türkü": ["turku", "turkuler", "baglama", "saz"],
}


def keywords_for(title):
    t = names.fold(title)
    kws = set()
    for k, words in SECTION_KEYWORDS.items():
        kf = names.fold(k)
        if kf in t or any(len(part) >= 4 and part in t for part in kf.split()):
            kws.update(words)
    for w in t.replace("/", " ").replace("(", " ").replace(")", " ").replace("-", " ").split():
        if len(w) >= 4:
            kws.add(w)
    return sorted(kws)


def _section_genre(lib, title):
    """Bölüm adı bir türe karşılık geliyorsa o türün kimliği ("Halay" -> Halay, "Kürtçe Halay" -> Kürtçe Halay)."""
    gens = {g["name"]: g for g in lib.genre_rows()}
    m = G.match_existing(title, gens)
    if m and m in gens:
        return gens[m]["id"]
    t = names.fold(title)
    best = None
    for g in gens.values():
        gf = names.fold(g["name"])
        if gf and gf in t and (best is None or len(gf) > len(names.fold(best["name"]))):
            best = g
    return best["id"] if best else None


def _playlist(st, pid):
    return next((p for p in st["playlists"] if p["id"] == int(pid)), None)


def _event_root(st, p):
    """Bölümün bağlı olduğu etkinlik (üst liste); en üstteki 'Etkinlikler' klasörü sayılmaz."""
    by_id = {x["id"]: x for x in st["playlists"]}
    par = by_id.get(p["parent"])
    if par and par["parent"] and par["parent"] in by_id:
        return par
    return par if par and par["path"] and par["path"][0] != "Etkinlikler" else p


def _descendants(st, pid):
    kids = defaultdict(list)
    for p in st["playlists"]:
        kids[p["parent"]].append(p["id"])
    out, stack = [], [pid]
    while stack:
        cur = stack.pop()
        for k in kids.get(cur, []):
            out.append(k)
            stack.append(k)
    return out


def _bpm_of(f, t):
    return f.get("bpm") or (t or {}).get("bpmAnalyzed") or None


def _key_of(f, t):
    return f.get("camelot") or keys.engine_key_to_camelot((t or {}).get("key"))


def suggest(lib, pid, limit=60):
    """Bir bölüm için öneriler (listeye ekleme panelinde '✨ Öneri')."""
    from . import dedupe
    from .library import STATE_DIR
    st = lib.engine_state()
    p = _playlist(st, pid) if st["db"] else None
    if not p:
        return {"title": "", "items": [], "keywords": []}
    title = p["title"]
    kws = keywords_for(title)
    gid = _section_genre(lib, title)
    # bu bölümde ve etkinliğin diğer bölümlerinde olanlar önerilmez
    root = _event_root(st, p)
    exclude = set()
    for lid in [root["id"]] + _descendants(st, root["id"]):
        q = _playlist(st, lid)
        for tid in (q or {}).get("entries") or []:
            fid = st["fid_of_tid"].get(tid)
            if fid:
                exclude.add(fid)
    # listedeki şarkıların BPM'i (bölümün temposu)
    files = {f["id"]: f for f in lib.audio_files() if not f["rel"].startswith(STATE_DIR + "/")}
    tid_of = {fid: rows[0][0] for fid, rows in st["by_file"].items() if rows}
    cur_bpms = sorted(b for b in (_bpm_of(files[f], st["tracks"].get(tid_of.get(f))) for f in
                                  (st["fid_of_tid"].get(t) for t in p["entries"]) if f in files) if b)
    med = cur_bpms[len(cur_bpms) // 2] if cur_bpms else None
    mem = lib.memberships()
    place = lib.placer()
    gens = {g["id"]: g for g in lib.genre_rows()}
    dup = dedupe.dup_index(lib)
    scored = []
    for fid, f in files.items():
        if fid in exclude:
            continue
        fl = f.get("flags") or ""
        if "audio_error" in fl or "audio_empty" in fl or "fmt_engine" in fl:
            continue
        di = dup.get(fid)
        if di and di["kind"] in ("exact", "audio") and not di["keeper"]:
            continue
        kind, g = place(f["rel"])
        if kind == "ignore":
            continue
        s, why = 0.0, []
        if gid and kind == "genre" and g == gid:
            s += 6
            why.append(gens[g]["name"])
        lists = " | ".join(names.fold(x) for x in mem.get(fid, []))
        hay_folder = names.fold(f.get("folder") or "")
        hay = f.get("search") or ""
        for k in kws:
            if lists and k in lists:
                s += 4
                why.append("liste: " + k)
            elif k in hay_folder:
                s += 3
                why.append("klasör: " + k)
            elif k in hay:
                s += 2
                why.append(k)
        if s <= 0:
            continue
        t = st["tracks"].get(tid_of.get(fid))
        b = _bpm_of(f, t)
        if med and b:
            if abs(b - med) / med <= 0.06:
                s += 1.5
                why.append("tempo uyumlu")
        if st["status"].get(fid) == "ready":
            s += 0.5
        scored.append((s, f, why, t, kind, g))
    scored.sort(key=lambda x: (-x[0], names.fold(x[1].get("artist") or ""), names.fold(x[1].get("title") or "")))
    out = []
    for s, f, why, t, kind, g in scored[:limit]:
        gg = gens.get(g) if kind == "genre" else None
        es = st["status"].get(f["id"], "none")
        b = _bpm_of(f, t)
        out.append({"id": f["id"], "title": f.get("title") or names.display(f["name"]), "artist": f.get("artist") or "",
                    "bpm": round(b) if b else None, "key": _key_of(f, t) or "",
                    "dur": round(f["duration"]) if f.get("duration") else None,
                    "genre": gg["name"] if gg else None, "color": gg["color"] if gg else None,
                    "dot": {"ready": "ready", "pending": "pending", "broken": "problem", "edup": "pending"}.get(es, "none"),
                    "why": ", ".join(dict.fromkeys(why))[:80], "score": round(s, 1)})
    return {"title": title, "items": out, "keywords": kws[:12], "genre": gens[gid]["name"] if gid in gens else None}


def gig_check(lib, pid):
    """Etkinlik öncesi kontrol: tek bakışta 'hazır mı?'."""
    st = lib.engine_state()
    if not st["db"]:
        from .library import UserError
        raise UserError("Bu SSD'de Engine kütüphanesi yok.", "no_engine")
    p = _playlist(st, pid)
    if not p:
        from .library import UserError
        raise UserError("Liste bulunamadı.", "gone")
    files = {f["id"]: f for f in lib.audio_files()}
    ids = [p["id"]] + _descendants(st, p["id"])
    order = {q["id"]: i for i, q in enumerate(st["playlists"])}
    ids.sort(key=lambda x: order.get(x, 0))
    checks = []

    def add(sev, title, detail, items=None, action=None):
        checks.append({"severity": sev, "title": title, "detail": detail, "items": items or [], "action": action})

    sections, where = [], defaultdict(list)
    missing, broken, pending, badfmt, bad, lowbr = [], [], [], [], [], []
    seen_t, total = set(), 0.0
    by_sig = defaultdict(set)
    for lid in ids:
        q = _playlist(st, lid)
        if not q:
            continue
        dur, n = 0.0, 0
        for tid in q["entries"]:
            n += 1
            t = st["tracks"].get(tid) if tid else None
            fid = st["fid_of_tid"].get(tid) if tid else None
            f = files.get(fid) if fid else None
            label = ("%s — %s" % ((f or t or {}).get("artist") or "", (f or t or {}).get("title") or
                                  (t or {}).get("filename") or "?")).strip(" —")
            d = (f or {}).get("duration") or (t or {}).get("length") or 0
            dur += d
            key = fid or ("t", tid)
            where[key].append(" / ".join(q["path"][len(p["path"]) - 1:]) or q["title"])
            if key in seen_t:
                continue
            seen_t.add(key)
            total += d
            if not f:
                missing.append(label)
                continue
            es = st["status"].get(fid)
            if es == "broken":
                broken.append(label)
            elif t and not t.get("isAnalyzed"):
                pending.append(label)
            fl = json.loads(f["flags"]) if f.get("flags") else []
            if "fmt_engine" in fl:
                badfmt.append(label)
            if "audio_error" in fl or "audio_empty" in fl:
                bad.append(label)
            if "audio_lowbr" in fl:
                lowbr.append("%s (%s kbps)" % (label, f.get("bitrate")))
            if f.get("qsig"):
                by_sig[(f["qsig"], f.get("alen"))].add(fid)
        if lid != p["id"] or q["entries"]:
            sections.append({"id": lid, "title": q["title"] if lid != p["id"] else "(liste)", "n": n, "dur": dur,
                             "depth": len(q["path"]) - len(p["path"])})
    if missing:
        add("kritik", "%d şarkının dosyası yok" % len(missing),
            "Taşınmış ya da silinmiş. Bulunursa program kendisi bağlar; yoksa listeden çıkar.", missing)
    if bad:
        add("kritik", "%d şarkı bozuk / yarım" % len(bad), "Çalınamaz; yeniden indir.", bad)
    if badfmt:
        add("kritik", "%d şarkı Prime 4'te çalınamaz" % len(badfmt), "MP3 / M4A / FLAC olarak kaydet.", badfmt)
    if broken:
        add("kritik", "%d şarkı Prime 4'te kırmızı görünür" % len(broken),
            "Engine'deki yolu Mac biçiminde. 'Şimdi onar' ya da Engine DJ kapanınca kendiliğinden onarılır.", broken,
            "repair")
    if pending:
        add("uyari", "%d şarkı Engine'de analiz edilmemiş" % len(pending),
            "Engine DJ'de “Analiz bekleyenler” listesini analiz ettir (Prime 4'te de olur ama yavaştır).", pending)
    dups = [v for v in by_sig.values() if len(v) > 1]
    if dups:
        add("uyari", "Aynı şarkının iki kopyası %d kez var" % len(dups), "Birini çıkar.",
            [" = ".join(names.display(files[x]["name"]) for x in v) for v in dups])
    rep = ["%s → %s" % (names.display(files[k]["name"]) if k in files else "?", " | ".join(v))
           for k, v in where.items() if len(v) > 1 and not isinstance(k, tuple)]
    if rep:
        add("bilgi", "%d şarkı birden fazla bölümde" % len(rep), "Bilerek yaptıysan sorun yok.", rep)
    if lowbr:
        add("bilgi", "%d şarkı düşük kalitede" % len(lowbr), "Büyük salonda fark edilebilir.", lowbr)
    sev = {"kritik": 0, "uyari": 1, "bilgi": 2}
    checks.sort(key=lambda c: sev[c["severity"]])
    status = "kritik" if any(c["severity"] == "kritik" for c in checks) else (
        "uyari" if any(c["severity"] == "uyari" for c in checks) else "tamam")
    return {"id": p["id"], "title": p["title"], "tracks": len(seen_t), "duration": total, "status": status,
            "checks": checks, "sections": sections}


def compatible(lib, fid, limit=25):
    """Bu şarkıdan sonra çalınabilecekler: aynı/komşu Camelot ton ve ±%6 BPM (yarım/çift tempo dahil)."""
    from .library import STATE_DIR
    st = lib.engine_state()
    tid_of = {f: rows[0][0] for f, rows in st["by_file"].items() if rows}
    files = [f for f in lib.audio_files() if not f["rel"].startswith(STATE_DIR + "/")]
    me = next((f for f in files if f["id"] == int(fid)), None)
    if not me:
        return []
    t0 = st["tracks"].get(tid_of.get(me["id"]))
    k0, b0 = _key_of(me, t0), _bpm_of(me, t0)
    if not k0 and not b0:
        return []
    place = lib.placer()
    gens = {g["id"]: g for g in lib.genre_rows()}
    out = []
    for f in files:
        if f["id"] == me["id"] or (me.get("qsig") and f.get("qsig") == me.get("qsig")):
            continue
        fl = f.get("flags") or ""
        if "audio_error" in fl or "audio_empty" in fl or "fmt_engine" in fl:
            continue
        t = st["tracks"].get(tid_of.get(f["id"]))
        k, b = _key_of(f, t), _bpm_of(f, t)
        rel = keys.compatible(k0, k) if k0 and k else ""
        if k0 and rel not in ("ayni", "uyumlu"):
            continue
        diff = None
        if b0 and b:
            diff = min(abs(b - b0), abs(b * 2 - b0), abs(b / 2 - b0)) / b0
            if diff > 0.06:
                continue
        elif b0:
            continue
        kind, g = place(f["rel"])
        if kind == "ignore":
            continue
        gg = gens.get(g) if kind == "genre" else None
        out.append(((0 if rel == "ayni" else 1), diff if diff is not None else 1, {
            "id": f["id"], "title": f.get("title") or names.display(f["name"]), "artist": f.get("artist") or "",
            "bpm": round(b) if b else None, "key": k or "", "genre": gg["name"] if gg else None,
            "color": gg["color"] if gg else None, "match": "aynı ton" if rel == "ayni" else ("uyumlu ton" if rel else "")}))
    out.sort(key=lambda x: (x[0], x[1]))
    return [x[2] for x in out[:limit]]
