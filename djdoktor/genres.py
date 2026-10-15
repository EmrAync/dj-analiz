"""Türler (bölümler): her şarkının TEK evi olan klasörler.

Bu modül mevcut dağınık yapıya bakıp bir düzen önerir:
  * Klasör adları, Serato crate'leri, Engine listeleri, etiketler ve Mixed In Key
    klasör adları birlikte değerlendirilir.
  * "HALAYLAR", "Melis Halaylar", "HALAY MP" gibi adlar türün kendisidir: içindeki
    dosyalar doğrudan tür klasörüne girer.
  * "7-24 Yıldızlarla Ankara Vol. 2" gibi albüm/derleme klasörleri türün içinde
    alt klasör olarak korunur.
  * Tarih adlı ("06.10.2026"), "secilecek", "yeni indirilenler" gibi karışık
    klasörlerin dosyaları tek tek sınıflandırılır (Türü belli değil).
  * Sample / efekt klasörlerine dokunulmaz.
"""
from __future__ import annotations

import re
from collections import Counter, defaultdict

from . import names

# (görünen ad, renk, kademe, eş anlamlılar)
# kademe: 3 = belirli tür (Halay, Ankara…), 2 = şemsiye tür (Oyun Havası, Türkçe Pop…).
# Bir ad birden çok türe uyarsa yüksek kademe, sonra uzun ifade kazanır:
# "Mix 312 (Ankara Oyun Havaları)" -> Ankara, "cift dans müzikleri" -> Slow - Çift Dans.
CANON = [
    ("Kürtçe Halay", "#c2410c", 3, ["kurtce", "kurdish", "kurdi", "kurmanci", "grani", "govend", "delilo",
                                    "semmame", "dengbej", "halay kurtce", "kurtce halay"]),
    ("Halay", "#dc2626", 3, ["halay", "halaylar", "halaylari", "damat halay", "dik halay", "uc ayak", "3 ayak"]),
    ("Horon", "#0e7490", 3, ["horon", "horonlar", "karadeniz", "kemence", "lazutlar", "hemsin", "tulum"]),
    ("Ankara", "#7c3aed", 3, ["ankara", "ankarali", "ank oy hav", "ank oy", "made in ankara", "ankara karisik"]),
    ("Roman - Mezdeke", "#db2777", 3, ["roman", "romanlar", "romanl", "mezdeke", "ciftetelli", "ciftte", "gypsy",
                                       "ortakina", "roman havalari", "roman havasi", "gayda roman", "kasap havasi"]),
    ("Oryantal - Arabic", "#b45309", 3, ["arabic", "arabia", "arab", "arapca", "arap", "oryantal", "oryental",
                                         "oriental", "harem", "asena", "darbuka", "gobek", "misirli", "habibi"]),
    ("Kına", "#a21caf", 3, ["kina", "kina gecesi", "kina sarkilari", "kina getir", "kina havasi"]),
    ("Sallama", "#9a3412", 3, ["sallama"]),
    ("Matine", "#c026d3", 3, ["matine", "kadinlar matine", "kadinlar matinesi"]),
    ("Giriş - Pasta - Özel", "#ca8a04", 3, ["giris", "cikis", "pasta", "entrance", "cake", "ozel anlar",
                                            "damat giris", "gelin giris"]),
    ("Slow - Çift Dans", "#be185d", 3, ["slow", "cift dans", "ilk dans", "first dance", "romantik", "romantic",
                                        "ballad"]),
    ("Enstrümantal - Fon", "#0f766e", 3, ["enstrumantal", "enstrumental", "ensturmental", "enstruman",
                                          "instrumental", "fon", "piano", "kanun", "keman", "ney", "lounge",
                                          "kesintisiz"]),
    ("Türküler", "#15803d", 3, ["turku", "turkuler", "anadolu rock", "halk muzigi", "bozlak", "modern turkuler"]),
    ("Yabancı Pop", "#0891b2", 3, ["yabanci", "yab pop", "yabanci pop", "english", "foreign", "international"]),
    ("Oyun Havası", "#ea580c", 2, ["oyun havasi", "oyun havalari", "oyunhavalari", "oyun hav", "oy hav",
                                   "kar oy hav", "klarnet", "zurna", "davul zurna", "misket", "trakya", "zeybek",
                                   "zebek", "kastamonu", "bergama", "gayda", "ege", "kasik", "potpori", "oyun set",
                                   "v oyun", "non stop mix oyun", "oyun"]),
    ("Dans - Club", "#4f46e5", 2, ["club", "clup", "house", "techno", "trance", "edm", "beatport", "deep house",
                                   "tech house", "progressive", "funky house", "organic house", "psy", "goa",
                                   "dans", "dance", "remix", "mashup"]),
    ("Türkçe Pop", "#2563eb", 2, ["turkce pop", "turk pop", "turkisch pop", "turkish pop", "turkce sarkilar",
                                  "karisik pop", "pop"]),
]
# bu ifadeler tek başına çok geneldir: kademe 1 sayılır
WEAK = {"pop", "oyun", "dans", "dance", "remix", "mashup"}
# önerilen türlerin gösterim sırası (düğün akışına yakın)
DISPLAY_ORDER = ["Halay", "Kürtçe Halay", "Horon", "Ankara", "Oyun Havası", "Roman - Mezdeke", "Oryantal - Arabic",
                 "Türkçe Pop", "Yabancı Pop", "Dans - Club", "Slow - Çift Dans", "Enstrümantal - Fon", "Kına",
                 "Sallama", "Matine", "Giriş - Pasta - Özel", "Türküler"]
IGNORE_WORDS = ["sample", "samples", "sfx", "fx", "effets", "effekt", "efekt", "effects", "loops", "loopmasters",
                "kick", "kicks", "snare", "snares", "clap", "claps", "hats", "hihat", "bassdrum", "bassdrums",
                "breaks", "scratch", "noise", "drum", "drums", "one shot", "stems", "acapella", "aseslerr",
                "ses efekt", "ses efektleri", "efekt sesleri"]
STAGING_WORDS = ["secilecek", "secim", "indir", "indirmeler", "indirilenler", "indiirilenler", "indirilen",
                 "download", "downloads", "gelen", "temp", "gecici", "yeni yukleme", "son yukleme", "yukleme",
                 "youtube", "yerli", "karar", "denenecek", "bakilacak", "listele", "unknown artist", "unknown album"]
# türün adıyla birlikte kullanıldığında anlamı değiştirmeyen dolgu kelimeler
FILLER = {"melis", "yeni", "new", "son", "karisik", "kariisik", "mix", "mp", "mp3", "youtube", "sarkilar",
          "sarkilari", "sarki", "muzik", "muzikleri", "muzikler", "muzigi", "the", "best", "of", "top", "hits", "hit",
          "parca", "tek", "set", "liste", "listesi", "program", "programi", "dj", "ve", "and", "vol", "cd", "my",
          "en", "iyi", "guzel", "secme", "secmeler", "tum", "hepsi", "alle", "musik", "all", "music", "cesitli",
          "sanatcilar", "turkce"}
# gün.ay(.yıl) biçimindeki tarihler (ör. "06.10.2026", "yeni 22.06.26", "Pop yeni 10.04") = geçici klasör.
# Yalnız yıl ("Nancy Ajram 2008", "Hitmix 2019") albüm adıdır, geçici sayılmaz.
DATE_RE = re.compile(r"\b(0?[1-9]|[12]\d|3[01])[.\-_/](0?[1-9]|1[0-2])([.\-_/](\d{2}|\d{4}))?\b")
CONTAINER_HINT = {"mix", "music", "muzik", "musik", "my music", "dj", "alle musik", "recorded", "library", "kutuphane"}

GENRE_COLORS = {n: c for n, c, _t, _s in CANON}


def _tok(s: str):
    return [t for t in re.split(r"[^a-z0-9]+", names.fold(s)) if t]


def _norm(s: str) -> str:
    return " ".join(_tok(s))


def _has_phrase(norm: str, phrase: str) -> bool:
    return (" " + phrase + " ") in (" " + norm + " ")


def match_genre(name: str):
    """Bir ad hangi standart türe karşılık geliyor? -> (tür adı, puan) ya da (None, None)."""
    n = _norm(name)
    if not n:
        return None, None
    best, best_score = None, 0
    for gname, _c, tier, syns in CANON:
        for syn in syns:
            if _has_phrase(n, syn):
                score = (1 if syn in WEAK else tier) * 1000 + len(syn)
                if score > best_score:
                    best, best_score = gname, score
    return best, (best_score or None)


def is_ignore(name: str) -> bool:
    n = _norm(name)
    return any(_has_phrase(n, w) for w in IGNORE_WORDS)


def is_staging(name: str) -> bool:
    raw = names.nfc(names.sfm_to_ascii(name))
    n = _norm(name)
    if DATE_RE.search(raw) and not match_genre(name)[0]:
        return True
    return any(_has_phrase(n, w) for w in STAGING_WORDS)


def is_genre_named(name: str, genre: str) -> bool:
    """Klasör adı türün KENDİSİ mi (ör. 'HALAYLAR', 'Melis Halaylar', 'KARISIK POP')? Albüm adları hayır."""
    g, _ = match_genre(name)
    if g != genre:
        return False
    toks = _tok(name)
    syn_toks = set()
    for gname, _c, _t, syns in CANON:
        if gname == genre:
            for s in syns:
                syn_toks.update(s.split())
    syn_toks.update(_tok(genre))
    rest = [t for t in toks if t not in syn_toks and t not in FILLER and not t.isdigit()]
    return not rest


def name_kind(name: str):
    """('genre', tür) | ('ignore', None) | ('spread', None) | (None, None)"""
    if is_ignore(name):
        return "ignore", None
    g, _ = match_genre(name)
    if g:
        return "genre", g
    if is_staging(name):
        return "spread", None
    return None, None


def genre_folder_name(display: str) -> str:
    return names.minimal_fix_component(display, False)


# ---------------------------------------------------------------------------
# Klasör ağacı ve öneri
# ---------------------------------------------------------------------------
EXCLUDED_TOP = {"_serato_", "_djdoktor_", "_djdoktor_karantina", "$recycle.bin", "system volume information"}


def _top_excluded(rel: str) -> bool:
    parts = names.split_rel(rel)
    if not parts:
        return False
    top = names.fold(parts[0])
    if top in EXCLUDED_TOP:
        return True
    if top == "engine library" and (len(parts) < 2 or names.fold(parts[1]) != "music"):
        return True
    return False


def build_tree(files):
    """files: katalog satırları (ses, mevcut). -> {klasör: {'direct': n, 'total': n, 'children': set()}}"""
    tree = defaultdict(lambda: {"direct": 0, "total": 0, "children": set(), "files": []})
    for f in files:
        folder = f.get("folder") or ""
        if _top_excluded(f["rel"]):
            continue
        parts = names.split_rel(folder)
        tree[folder]["direct"] += 1
        tree[folder]["files"].append(f)
        for i in range(len(parts) + 1):
            k = "/".join(parts[:i])
            tree[k]["total"] += 1
            if i < len(parts):
                tree[k]["children"].add("/".join(parts[:i + 1]))
    return tree


def content_votes(file_ids, memberships, files_by_id):
    """Dosyaların crate/liste üyelikleri, etiketleri ve Mixed In Key klasör adından tür oyları."""
    votes = Counter()
    for fid in file_ids:
        seen = set()
        for path in memberships.get(fid, ()):
            # en derindeki eşleşen bileşen kazanır ('Melis Program / Halaylar' -> Halay)
            for comp in reversed([p.strip() for p in re.split(r"\s*/\s*|%%", path) if p.strip()]):
                g, _ = match_genre(comp)
                if g:
                    seen.add(g)
                    break
        f = files_by_id.get(fid) or {}
        tag_g, _ = match_genre(f.get("genre") or "")
        if tag_g:
            seen.add(tag_g)
        for g in seen:
            votes[g] += 1
    return votes


def propose(lib_files, memberships, music_root_name="Müzik", existing_genres=None):
    """Mevcut yapıya göre düzen önerisi.

    lib_files: mevcut ses dosyaları (katalog satırları)
    memberships: {file_id: [liste yolu, ...]} (Serato crate'leri + Engine listeleri)
    Dönüş: {'root': ad, 'folders': [...], 'genres': [...]}
    """
    files_by_id = {f["id"]: f for f in lib_files}
    tree = build_tree(lib_files)
    folders = []
    own_of = {}

    def ancestor(rel):
        parts = names.split_rel(rel)
        for i in range(len(parts) - 1, 0, -1):
            a = own_of.get("/".join(parts[:i]))
            if a:
                return a
        return None

    for rel in sorted(k for k in tree if k):
        node = tree[rel]
        name = names.split_rel(rel)[-1]
        kind, g = name_kind(name)
        depth = rel.count("/")
        own = None
        reason = ""
        anc = ancestor(rel)
        if kind == "genre":
            _g, score = match_genre(name)
            if anc == "ignore":
                kind = None              # sample klasörünün altı da sample'dır ("Electric Piano" -> Fon değil)
            elif score and score < 2000 and anc and anc.startswith("g:"):
                kind = None              # yalnızca "remix/pop" gibi genel bir kelime: üst klasörün türü geçerli
            else:
                own = "g:" + g
                reason = "klasör adı"
        elif kind == "ignore":
            own = "ignore"
            reason = "sample / efekt"
        elif kind == "spread":
            own = "spread"
            reason = "karışık / geçici klasör"
        votes = None
        if node["direct"]:
            ids = [f["id"] for f in node["files"]]
            votes = content_votes(ids, memberships, files_by_id)
            if own is None and votes and anc != "ignore":
                top, n = votes.most_common(1)[0]
                if n >= max(2, int(0.6 * len(ids) + 0.5)):
                    own = "g:" + top
                    reason = "içindeki şarkıların listeleri"
        if own is None and depth == 0:
            own = "spread" if node["direct"] else None
            if own:
                reason = "kök klasör"
        own_of[rel] = own
        folders.append({"rel": rel, "disp": names.display(rel), "name": names.display(name), "depth": depth,
                        "direct": node["direct"], "total": node["total"], "suggest": own, "reason": reason,
                        "votes": dict(votes.most_common(3)) if votes else {},
                        "genre_named": bool(kind == "genre" and is_genre_named(name, g))})
    used = Counter()
    eff = effective_assignments(folders, {})
    for f in folders:
        a = eff.get(f["rel"])
        if a and a.startswith("g:") and f["direct"]:
            used[a[2:]] += f["direct"]
    order = DISPLAY_ORDER
    genres = [{"name": n, "color": GENRE_COLORS.get(n), "count": used[n]}
              for n in sorted(used, key=lambda x: (order.index(x) if x in order else 99, x))]
    for eg in existing_genres or []:
        if not any(x["name"] == eg for x in genres):
            genres.append({"name": eg, "color": GENRE_COLORS.get(eg), "count": 0})
    return {"root": music_root_name, "folders": folders, "genres": genres}


def effective_assignments(folders, overrides):
    """Her klasörün geçerli ataması: kullanıcı seçimi > öneri > üst klasörden miras.

    Atamalar: 'g:<Tür>' | 'spread' (tek tek sınıflandır) | 'ignore' (dokunma).
    overrides[rel] == 'inherit' -> öneriyi yok say, üst klasörden al.
    """
    known = {f["rel"] for f in folders}
    out = {}
    for f in sorted(folders, key=lambda x: x["rel"].count("/")):
        rel = f["rel"]
        ov = overrides.get(rel)
        if ov and ov != "inherit":
            a = ov
        elif ov == "inherit":
            a = None
        else:
            a = f.get("suggest")
        if not a:
            parent = rel.rsplit("/", 1)[0] if "/" in rel else ""
            a = out.get(parent) if parent in known else None
            a = a or "spread"
        out[rel] = a
    return out


def plan_targets(folders, overrides, genre_dirs, music_root, files):
    """Her dosyanın gideceği yer.

    genre_dirs: {'Halay': 'Halay', ...}  (tür adı -> klasör adı)
    music_root: tür klasörlerinin üst klasörü (kanonik göreli yol, ör. 'Müzik')
    Dönüş: ({file_id: yeni_rel}, Counter)
    Kurallar:
      * Türün KENDİSİ olan klasörün (HALAYLAR) dosyaları doğrudan Müzik/Halay içine girer;
        bu klasörün alt klasörleri albüm olarak korunur.
      * Albüm/derleme klasörleri (7-24 Yıldızlarla Ankara Vol. 2/CD-1) türün içinde aynen korunur.
    """
    eff = effective_assignments(folders, overrides)
    by_rel = {f["rel"]: f for f in folders}
    root_parts = names.split_rel(music_root)
    targets, stats = {}, Counter()
    for f in files:
        folder = f.get("folder") or ""
        if _top_excluded(f["rel"]):
            continue
        a = eff.get(folder, "spread") if folder else "spread"
        if a == "ignore":
            stats["ignore"] += 1
            continue
        if not a.startswith("g:"):
            stats["spread"] += 1
            continue
        gname = a[2:]
        gdir = genre_dirs.get(gname) or genre_folder_name(gname)
        parts = names.split_rel(folder)
        chain = ["/".join(parts[:i + 1]) for i in range(len(parts))]

        def own(c):
            ov = overrides.get(c)
            if ov and ov != "inherit":
                return ov
            return None if ov == "inherit" else (by_rel.get(c) or {}).get("suggest")

        named_idx = None
        for i, c in enumerate(chain):
            node = by_rel.get(c) or {}
            if eff.get(c) == a and node.get("genre_named") and own(c) == a:
                named_idx = i
        if named_idx is not None:
            sub = parts[named_idx + 1:]
        else:
            start = len(parts) - 1
            while start - 1 >= 0 and eff.get(chain[start - 1]) == a and (start - 1 > 0 or own(chain[0]) == a):
                start -= 1
            sub = parts[start:]
        new_rel = "/".join(root_parts + [gdir] + [names.minimal_fix_component(p, False) for p in sub] +
                           [names.minimal_fix_component(f["name"], True)])
        stats["g:" + gname] += 1
        if names.match_key(new_rel) != names.match_key(f["rel"]):
            targets[f["id"]] = new_rel
            stats["move"] += 1
        else:
            stats["stay"] += 1
    return targets, stats


# ---------------------------------------------------------------------------
# Tek dosya için öneri (Türü belli değil -> hızlı sınıflandırma)
# ---------------------------------------------------------------------------
def suggest_file(f, memberships, genres_by_name, dupe_genre=None):
    """-> (genre_name, neden) ya da (None, None)"""
    if dupe_genre:
        return dupe_genre, "aynı şarkı bu türde zaten var"
    votes = content_votes([f["id"]], memberships, {f["id"]: f})
    for g, _n in votes.most_common():
        if g in genres_by_name:
            path = next((p for p in memberships.get(f["id"], ()) if match_genre(p.replace("%%", "/").split("/")[-1])[0] == g), None)
            return g, ("listede: " + path.replace("%%", " / ")) if path else "etiket"
    for comp in reversed(names.split_rel(f.get("folder") or "")):
        g, _ = match_genre(comp)
        if g and g in genres_by_name:
            return g, "klasör adı: " + names.display(comp)
    for text in (f.get("title") or "", f.get("name") or "", f.get("comment") or ""):
        g, _ = match_genre(text)
        if g and g in genres_by_name:
            return g, "şarkı adı"
    return None, None


def match_existing(name: str, genres_by_name):
    """Serbest bir adı (liste/bölüm/klasör) mevcut türlerden birine eşler."""
    if name in genres_by_name:
        return name
    g, _ = match_genre(name)
    if g and g in genres_by_name:
        return g
    fn = names.fold(name)
    for gn in genres_by_name:
        if names.fold(gn) == fn or names.fold(genre_folder_name(gn)) == fn:
            return gn
    return None
