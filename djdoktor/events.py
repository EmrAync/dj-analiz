"""Etkinlik şablonları ve bölümlere göre parça önerileri."""
from __future__ import annotations

from . import names

# Bölüm adı -> öneri anahtar kelimeleri (katlanmış/ASCII biçimde)
SECTION_KEYWORDS = {
    "karşılama": ["fon", "enstrumantal", "instrumental", "piano", "kanun", "cello", "keman", "ney", "lounge", "chill", "jazz"],
    "fon": ["fon", "enstrumantal", "instrumental", "piano", "kanun", "cello", "keman", "ney", "lounge"],
    "giriş": ["giris", "entrance", "intro", "gelin", "damat", "wedding", "epic"],
    "ilk dans": ["slow", "ilk dans", "first dance", "ask", "love", "sevda", "romantic", "ballad", "cift dans", "dans"],
    "slow": ["slow", "ask", "love", "sevda", "ballad", "cift dans"],
    "pasta": ["pasta", "cake", "happy", "mutlu"],
    "takı": ["taki", "takı", "oyun havasi", "sallama", "zurna"],
    "halay": ["halay", "grani", "govend", "delilo", "semmame", "bomba", "tulum", "dik halay", "3 ayak", "uc ayak", "kurtce", "kurdish", "cida", "sallama", "potpori"],
    "kürtçe": ["kurtce", "kurdish", "kurdi", "grani", "govend", "delilo", "semmame", "cida", "rojda", "kurmanci", "dengbej"],
    "horon": ["horon", "karadeniz", "kemence", "tulum", "laz", "hemsin", "rize", "trabzon"],
    "roman": ["roman", "mezdeke", "ciftetelli", "9 8", "9/8", "gypsy", "darbuka", "kasap"],
    "oyun havası": ["oyun havasi", "oyun", "ankara", "zeybek", "kasik", "potpori", "ege", "kasap", "klarnet", "zurna", "davul"],
    "sallama": ["sallama", "grani", "oyun havasi"],
    "türkçe pop": ["pop", "turkce", "turkish", "remix", "hit", "mix"],
    "yabancı": ["yabanci", "remix", "mashup", "club", "dance", "edm", "house", "reggaeton", "latin", "english"],
    "dans": ["dance", "dans", "club", "mashup", "remix", "house", "edm", "reggaeton", "latin"],
    "arabic": ["arabic", "arab", "oryantal", "oriental", "habibi", "yalla", "darbuka", "amr diab", "haifa", "nancy"],
    "kına": ["kina", "tepsi", "yuksek yuksek", "annem", "gelin", "mumlar"],
    "çıkış": ["cikis", "final", "son", "kapanis", "veda", "outro"],
    "notfall": ["notfall", "yedek", "pop", "hit"],
    "yedek": ["notfall", "yedek", "pop", "hit"],
    "çocuk": ["cocuk", "kids", "sunnet", "children"],
    "matine": ["matine", "oyun havasi", "roman", "arabic"],
}

BUILTIN_TEMPLATES = [
    ("dugun", "Düğün", ["Karşılama (Fon)", "Giriş", "İlk Dans", "Pasta", "Takı", "Halay", "Kürtçe Halay / Grani",
                        "Horon", "Roman / Mezdeke", "Oyun Havası", "Türkçe Pop", "Yabancı Pop / Dans", "Arabic",
                        "Çıkış", "Notfall / Yedek"]),
    ("kina", "Kına Gecesi", ["Karşılama (Fon)", "Gelin Girişi", "Kına Şarkıları", "Tepsi / Mumlar", "Halay",
                             "Oyun Havası", "Roman / Mezdeke", "Türkçe Pop", "Arabic", "Notfall / Yedek"]),
    ("nisan", "Nişan / Söz", ["Karşılama (Fon)", "Giriş", "Yüzük", "Pasta", "Slow", "Halay", "Oyun Havası",
                              "Türkçe Pop", "Yabancı Pop / Dans", "Notfall / Yedek"]),
    ("sunnet", "Sünnet Düğünü", ["Karşılama (Fon)", "Giriş", "Çocuk Şarkıları", "Halay", "Oyun Havası",
                                 "Roman / Mezdeke", "Türkçe Pop", "Notfall / Yedek"]),
    ("matine", "Matine / Kadınlar Matinesi", ["Fon", "Oyun Havası", "Roman / Mezdeke", "Arabic", "Halay",
                                              "Türkçe Pop", "Notfall / Yedek"]),
    ("dogumgunu", "Doğum Günü / Parti", ["Karşılama", "Pasta", "Türkçe Pop", "Yabancı Pop / Dans", "Halay",
                                          "Notfall / Yedek"]),
    ("sahne", "Konser / Sahne", ["Açılış", "Set 1", "Set 2", "Bis", "Kapanış"]),
    ("kulup", "Kulüp / Bar", ["Isınma", "Peak Time", "Kapanış"]),
    ("bos", "Boş (kendi bölümlerin)", []),
]


def ensure_templates(catalog):
    have = {t["kind"] for t in catalog.templates()}
    for kind, title, secs in BUILTIN_TEMPLATES:
        if kind not in have:
            catalog.template_save(kind, title, secs, builtin=1)


def keywords_for(section_title: str):
    t = names.fold(section_title)
    kws = set()
    for k, words in SECTION_KEYWORDS.items():
        kf = names.fold(k)
        if kf in t or any(part and part in t for part in kf.split()):
            kws.update(words)
    # bölüm adının kendi kelimeleri de anahtar olsun
    for w in t.replace("/", " ").replace("(", " ").replace(")", " ").split():
        if len(w) >= 4:
            kws.add(w)
    return sorted(kws)


def suggest(catalog, section_title: str, exclude_ids=(), limit=60):
    """Bölüm adına göre kütüphaneden öneri: klasör, ad, tür, yorum ve Serato/Engine liste adları."""
    kws = keywords_for(section_title)
    if not kws:
        return []
    ex = set(exclude_ids)
    # dış liste üyelikleri (crate adları güçlü bir sinyaldir)
    member = {}
    for r in catalog.q("SELECT e.file_id, l.path FROM ext_items e JOIN ext_lists l ON l.src=e.src "
                       "AND l.list_key=e.list_key WHERE e.file_id IS NOT NULL"):
        member.setdefault(r["file_id"], []).append(names.fold(r["path"] or ""))
    for r in catalog.q("SELECT i.file_id, l.title FROM list_items i JOIN lists l ON l.id=i.list_id"):
        member.setdefault(r["file_id"], []).append(names.fold(r["title"] or ""))
    scored = []
    rows = catalog.q("SELECT id, rel, folder, title, artist, genre, comment, search, duration, bpm, camelot, "
                     "bitrate, flags, qsig FROM files WHERE kind='audio' AND present=1")
    ex_sigs = {f["qsig"] for f in rows if f["id"] in ex and f.get("qsig")}
    for f in rows:
        if f["id"] in ex or (f.get("qsig") and f["qsig"] in ex_sigs):
            continue
        hay_folder = names.fold(f.get("folder") or "")
        hay = f.get("search") or ""
        lists = " | ".join(member.get(f["id"], []))
        s = 0.0
        hits = []
        for k in kws:
            if k in lists:
                s += 5
                hits.append(k)
            elif k in hay_folder:
                s += 3
                hits.append(k)
            elif k in hay:
                s += 2
                hits.append(k)
        if s <= 0:
            continue
        if f.get("flags") and "dup_" in (f.get("flags") or ""):
            s -= 2  # çift kopyalar arkaya
        scored.append((s, f, hits))
    scored.sort(key=lambda x: (-x[0], x[1]["rel"]))
    out, seen_sig = [], set()
    for s, f, hits in scored:
        if f.get("qsig"):
            if f["qsig"] in seen_sig:
                continue  # aynı sesin kopyalarını bir kez öner
            seen_sig.add(f["qsig"])
        out.append({"id": f["id"], "score": s, "why": sorted(set(hits))[:4]})
        if len(out) >= limit:
            break
    return out
