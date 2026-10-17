"""Adlar (Araçlar > Adlar): dosya ve klasör adlarını toplu sadeleştirme.

Tek tıkla "Türkçe harfleri düzelt (Engine için)": 'Türkü Şöleni' -> 'Turku Soleni'. Yasak karakterler, emoji,
fazla boşluk da düzelir. Önizleme her satırda eski -> yeni adı ve çakışmaları gösterir; 'Uygula' tek işlemdir:
Engine (yollar, analiz, cue, listeler korunur), Serato (database V2 + bütün crate'ler, aynalı listeler) ve
programın tür / kural kayıtları birlikte yeni yola geçer; 'Geri al' her şeyi eski hâline döndürür.

Etiketlere (dosyanın içine) dokunulmaz; Engine'deki başlık ve Serato'daki şarkı adı aynen kalır.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import time
import unicodedata

from . import names, relocate, serato, util
from .ext import route

# ---------------------------------------------------------------------------
# Kurallar
# ---------------------------------------------------------------------------
DEFAULT_RULES = {
    "turkish_ascii": True,     # ç ğ ı ö ş ü İ -> c g i o s u I (büyük/küçük harf korunur)
    "accents": True,           # é ñ ß gibi diğer aksanlar da ASCII'ye
    "fix_illegal": True,       # Windows / Prime 4'te yasak karakterler (her zaman açık)
    "strip_emoji": True,
    "noise": False,            # (Official Video), [HD], y2mate gibi ekler (yalnızca parantez içindekiler)
    "spaces": True,            # fazla boşluklar, '( ' -> '('
    "underscores": False,      # '_' -> ' '
    "case": "none",            # none | title | upper | lower
    "case_locale": "auto",     # auto | tr | en
    "replace": [],             # [{find, to, regex, icase}]
    "trim": True,              # baştaki / sondaki boşluk, nokta, tire
    "ext_lower": False,        # '.MP3' -> '.mp3'
    "max_len": 180,
}
PRESETS = {
    "engine_safe": {"title": "Türkçe harfleri düzelt (Engine için)",
                    "hint": "Türkçe harfler, yasak karakterler ve emoji temizlenir.",
                    "rules": dict(DEFAULT_RULES)},
    "only_illegal": {"title": "Yalnızca sorunlu karakterler",
                     "hint": "Türkçe harfler kalır; yalnızca Windows ve Prime 4'ün açamadığı adlar düzelir.",
                     "rules": dict(DEFAULT_RULES, turkish_ascii=False, accents=False, strip_emoji=False,
                                   spaces=False, trim=False)},
    "tidy": {"title": "Toparla",
             "hint": "Engine için düzeltmeye ek olarak (Official Video) gibi ekler ve alt çizgiler gider.",
             "rules": dict(DEFAULT_RULES, noise=True, underscores=True, ext_lower=True)},
}
PRESET_ORDER = ["engine_safe", "only_illegal", "tidy"]

PUNCT = {"–": "-", "—": "-", "‒": "-", "−": "-", "‐": "-", "‑": "-", "‘": "'", "’": "'", "‚": "'", "´": "'",
         "`": "'", "“": "'", "”": "'", "„": "'", "…": "...", "«": "", "»": "", "⁄": "-", " ": " ",
         " ": " ", "　": " "}
for _c in range(0x2000, 0x200B):
    PUNCT[chr(_c)] = " "
PUNCT_T = str.maketrans(PUNCT)
_ZW = re.compile("[​-‍⁠﻿️︎]")
NOISE_RX = [re.compile(p, re.I) for p in (
    r"\s*[\(\[]\s*(official\s+)?((music|lyrics?)\s+)?(video|audio|clip|visuali[sz]er)\s*[\)\]]",
    r"\s*[\(\[]\s*(lyrics?|hd|hq|4k|8k|1080p|720p|full\s*hd|klip|video\s*klip|resmi\s+video|official|mp3)\s*[\)\]]",
    r"\s*[\(\[]\s*(\d{2,3}\s*kbps|320|256|192|128)\s*[\)\]]",
    r"^\s*(y2mate|ytmp3|savefrom|mp3juices)(\.com)?\s*[-_]\s*",
    r"\s*[-_]?\s*(y2mate|ytmp3|savefrom|mp3juices)(\.com)?\s*$",
    r"\s*-\s*youtube\s*$",
    r"\s*www\.\S+",
)]
_ILLEGAL = {":": " - ", "/": " - ", "\\": " - ", "|": " - ", '"': "'", "*": "", "?": "", "<": "(", ">": ")"}
_RISKY = re.compile(r"\([^)]*[+*}]\)[+*{]")
KEEP_UPPER = {"DJ", "MC", "CD", "HD", "TV", "USA", "UK", "EP", "LP", "RMX", "VIP", "II", "III", "IV", "TRT"}
LOWER_WORDS = {"feat.", "ft.", "vs.", "x", "feat", "ft", "vs"}
TR_CHARS = set("çğıöşüÇĞİÖŞÜ")
FILE_KINDS = ("audio", "video")
REASONS = {"nfc": "harf biçimi", "sfm": "Mac karakteri", "replace": "bul/değiştir", "noise": "gereksiz ek",
           "tr": "Türkçe harf", "accent": "aksan", "emoji": "emoji", "illegal": "yasak karakter",
           "space": "boşluk", "case": "büyük/küçük harf", "trim": "baş/son", "ext": "uzantı", "long": "uzun",
           "punct": "noktalama"}


def _err(msg, code=None):
    from .library import UserError
    return UserError(msg, code)


def normalize_rules(rules=None, preset=None):
    """Kuralları birleştirir ve denetler (bozuk ya da riskli düzenli ifade -> UserError)."""
    base = dict(PRESETS.get(preset or "", {}).get("rules") or DEFAULT_RULES)
    r = dict(base)
    for k, v in (rules or {}).items():
        if k in DEFAULT_RULES:
            r[k] = v
    for k in ("turkish_ascii", "accents", "strip_emoji", "noise", "spaces", "underscores", "trim", "ext_lower"):
        r[k] = bool(r.get(k))
    r["fix_illegal"] = True
    if r.get("case") not in ("none", "title", "upper", "lower"):
        r["case"] = "none"
    if r.get("case_locale") not in ("auto", "tr", "en"):
        r["case_locale"] = "auto"
    try:
        r["max_len"] = max(40, min(200, int(r.get("max_len") or 180)))
    except (TypeError, ValueError):
        r["max_len"] = 180
    reps = []
    for x in (r.get("replace") or [])[:10]:
        if not isinstance(x, dict):
            continue
        find = str(x.get("find") or "")
        if not find:
            continue
        if len(find) > 200:
            raise _err("Aranan ifade çok uzun.", "bad_regex")
        to = str(x.get("to") or "")[:200]
        rx = bool(x.get("regex"))
        ic = bool(x.get("icase"))
        if rx:
            if _RISKY.search(find):
                raise _err("Bu düzenli ifade çok yavaş çalışabilir (iç içe tekrar). Daha basit yazın.", "regex_risky")
            try:
                re.compile(find, re.I if ic else 0)
            except re.error as e:
                raise _err("Düzenli ifade hatalı: %s" % e, "bad_regex")
        reps.append({"find": find, "to": to, "regex": rx, "icase": ic})
    r["replace"] = reps
    return r


# ---------------------------------------------------------------------------
# Türkçe uyumlu büyük / küçük harf
# ---------------------------------------------------------------------------
def _up(w, tr):
    if tr:
        w = w.replace("i", "İ").replace("ı", "I")
    return w.upper()


def _low(w, tr):
    if tr:
        w = w.replace("I", "ı").replace("İ", "i")
    return w.replace("İ", "i").lower()


def tr_case(s, mode, locale="auto"):
    """mode: none | title | upper | lower. Türkçe kuralı (i->İ, I->ı) locale='tr' ya da adda Türkçe harf varsa.
    Başlık biçiminde DJ, MC, CD gibi kısa büyük kısaltmalar ve 'feat.', 'vs.' korunur; kesme işareti sözcüğü
    bölmez ("GEL'İN" -> "Gel'in")."""
    if not s or mode in (None, "none"):
        return s
    tr = locale == "tr" or (locale == "auto" and any(c in TR_CHARS for c in s))
    if mode == "upper":
        return _up(s, tr)
    if mode == "lower":
        return _low(s, tr)
    toks = re.split(r"([\s\-\(\[]+)", s)
    out = []
    first = True
    shout = s.upper() == s          # ad tümüyle büyük harfse kısa sözcükler kısaltma sayılmaz
    for t in toks:
        if not t or re.match(r"^[\s\-\(\[]+$", t):
            out.append(t)
            continue
        if t.upper() in KEEP_UPPER or (not shout and t.isupper() and len(t) <= 4 and t.isalpha()) or \
                re.match(r"^[A-Z]\.([A-Z]\.)+$", t):
            out.append(t if t.upper() not in KEEP_UPPER else t.upper())
        elif not first and t.lower() in LOWER_WORDS:
            out.append(t.lower())
        else:
            i = 0
            while i < len(t) and not t[i].isalpha():
                i += 1
            out.append(t[:i] + _up(t[i:i + 1], tr) + _low(t[i + 1:], tr) if i < len(t) else t)
        first = False
    return "".join(out)


# ---------------------------------------------------------------------------
# Tek ad dönüşümü
# ---------------------------------------------------------------------------
def _needs_fix(stem):
    return any(c in _ILLEGAL or ord(c) < 32 for c in stem) or stem != stem.rstrip(" .") or \
        stem.split(".")[0].upper() in names.WIN_RESERVED


def _fix_illegal(stem):
    """Yasak karakterler (Windows / exFAT / Prime 4), kontrol karakterleri, sondaki boşluk / nokta, ayrılmış adlar.
    Yalnızca sorunlu adlara dokunur (çift boşluk vb. burada düzelmez)."""
    if not _needs_fix(stem):
        return stem
    s = "".join(_ILLEGAL.get(c, c) if c in _ILLEGAL else ("" if ord(c) < 32 else c) for c in stem)
    s = re.sub(r"\s+-\s+(-\s+)+", " - ", s)
    s = re.sub(r" {2,}", " ", s)
    s = s.strip(" .")
    if s and s.split(".")[0].upper() in names.WIN_RESERVED:
        s += "_"
    return s


def _accents(s, keep_tr):
    out = []
    for c in s:
        if keep_tr and c in names.TR_LETTERS:
            out.append(c)
            continue
        d = unicodedata.normalize("NFKD", c)
        out.append("".join(x for x in d if not unicodedata.combining(x)))
    return unicodedata.normalize("NFC", "".join(out))


def _units(s):
    return len(s.encode("utf-16-le")) // 2


def transform(name, is_file, rules):
    """(yeni_ad, nedenler). Yeni ad NFC'dir; boş kalacaksa (ad, ['empty']) döner (asla 'adsiz' uydurulmaz).
    Sıra: Mac karakterleri -> bul/değiştir -> ekler -> Türkçe/aksan -> emoji -> alt çizgi -> yasak karakterler
    (harf çevirisinden SONRA: tam genişlikli '：' gibi karakterler ':' olabilir) -> boşluk -> harf -> kırp -> uzunluk."""
    reasons = []

    def step(code, before, after):
        if after != before and code not in reasons:
            reasons.append(code)
        return after
    s0 = names.sfm_to_ascii(name)
    if s0 != name:
        reasons.append("sfm")
    s = names.nfc(s0)
    if s != s0:
        reasons.append("nfc")
    stem, ext = os.path.splitext(s) if is_file else (s, "")
    if is_file and (not ext or len(ext) > 6 or " " in ext):
        stem, ext = s, ""
    if len(stem) <= 255:
        for x in rules.get("replace") or []:
            if x["regex"]:
                try:
                    new = re.sub(x["find"], x["to"], stem, flags=re.I if x["icase"] else 0)
                except (re.error, IndexError) as e:
                    raise _err("Değiştirme ifadesi hatalı: %s" % e, "bad_regex")
            elif x["icase"]:
                new = re.sub(re.escape(x["find"]), lambda _m, t=x["to"]: t, stem, flags=re.I)
            else:
                new = stem.replace(x["find"], x["to"])
            stem = step("replace", stem, new)
    if rules.get("noise"):
        new = stem
        for rx in NOISE_RX:
            new = rx.sub("", new)
        stem = step("noise", stem, new)
    stem = _ZW.sub("", stem)
    if rules.get("turkish_ascii"):
        new = names.nfc(stem).translate(names._TR_ASCII)
        stem = step("tr", stem, new)
        if rules.get("accents"):
            stem = step("accent", stem, _accents(stem, False))
        stem = step("punct", stem, stem.translate(PUNCT_T))
    elif rules.get("accents"):
        stem = step("accent", stem, _accents(stem, True))
    if rules.get("strip_emoji"):
        stem = step("emoji", stem, names._EMOJI_RE.sub("", stem))
    if rules.get("underscores"):
        stem = step("space", stem, stem.replace("_", " "))
    if rules.get("spaces"):
        new = re.sub(r"\s+", " ", stem)
        new = re.sub(r"\(\s+", "(", new)
        new = re.sub(r"\s+\)", ")", new)
        new = re.sub(r"\[\s+", "[", new)
        new = re.sub(r"\s+\]", "]", new)
        new = re.sub(r"\(\s*\)|\[\s*\]", "", new)
        new = re.sub(r"\s*-\s*-+\s*", " - ", new)
        new = re.sub(r" {2,}", " ", new)
        stem = step("space", stem, new)
    stem = step("case", stem, tr_case(stem, rules.get("case"), rules.get("case_locale", "auto")))
    if rules.get("trim"):
        stem = step("trim", stem, stem.strip(" .-_"))
    stem = step("illegal", stem, _fix_illegal(stem))      # en sonda: harf çevirisi ':' üretebilir, 'Con' -> 'Con_'
    if stem.startswith("."):                               # '.x' / '._x' gizli ya da Mac çöpü sayılır: olmasın
        stem = step("trim", stem, stem.lstrip(". "))
    if not stem.strip(" ."):
        return name, ["empty"]
    if rules.get("ext_lower") and ext:
        ext = step("ext", ext, ext.lower())
    mx = int(rules.get("max_len") or 180)
    if _units(stem + ext) > mx:
        while _units(stem + ext) > mx and len(stem) > 10:
            stem = stem[:-1]
        stem = stem.rstrip(" .-_")
        reasons.append("long")
    new = stem + ext
    if rules.get("turkish_ascii") and any(ord(c) > 127 for c in new):
        reasons.append("non_ascii")             # ASCII istendi ama başka alfabe / sembol kaldı (uyarı)
    if new == name:
        return name, [w for w in reasons if w == "non_ascii"]
    return new, reasons


# ---------------------------------------------------------------------------
# Kapsam
# ---------------------------------------------------------------------------
def _hidden(parts):
    return any(p.startswith(".") for p in parts)


def resolve_scope(lib, scope=None):
    """{'kind': all|genre|folder|files, ...} -> {'kind','prefix','fids','label','include_self','include_root',
    'include_ignored'}"""
    sc = dict(scope or {})
    kind = sc.get("kind") or "all"
    out = {"kind": kind, "prefix": "", "fids": None, "label": "Tüm SSD",
           "include_self": sc.get("include_self", True) is not False,
           "include_root": sc.get("include_root", True) is not False,
           "include_ignored": bool(sc.get("include_ignored"))}
    if kind == "genre":
        g = next((x for x in lib.genre_rows() if str(x["id"]) == str(sc.get("gid"))), None)
        if not g:
            raise _err("Tür bulunamadı.")
        out.update(prefix=g["rel"], label=g["name"], gid=g["id"])
    elif kind == "folder":
        rel = "/".join(names.split_rel(sc.get("rel") or ""))
        if not rel or not os.path.isdir(lib.rootinfo.os_path(rel)):
            raise _err("Klasör bulunamadı.")
        out.update(prefix=rel, label=names.display(rel))
    elif kind == "files":
        ids = {int(x) for x in sc.get("ids") or []}
        out.update(fids=ids, label="%d şarkı" % len(ids))
    else:
        out["kind"] = "all"
    return out


def _scope_key(sc):
    return {k: (sorted(v) if isinstance(v, set) else v) for k, v in sc.items()}


# ---------------------------------------------------------------------------
# Önizleme
# ---------------------------------------------------------------------------
def _refs_by_file(lib, rel_of):
    """({fid: engine_kayıt_sayısı}, serato_dizini, {Engine yol anahtarı: [kanıt]}) — önizlemede 'Engine 3, Serato 5
    kayıt güncellenecek' ve başka bir şarkının eski kaydına adlandırma denetimi için. rel_of: {fid: rel}"""
    eng, ev = {}, {}
    try:
        st = lib.engine_state()
        for fid, rows in st["by_file"].items():
            eng[fid] = len(rows)
            if fid in rel_of:
                ev.setdefault(names.loose_key(rel_of[fid]), []).extend(
                    relocate.engine_evidence(st["tracks"][tid]) for tid, _m in rows)
        for tid, rel, _m in st["orphans"]:
            if rel:
                ev.setdefault(names.loose_key(rel), []).append(relocate.engine_evidence(st["tracks"][tid]))
    except Exception:
        pass
    sx = lib.serato_index()
    return eng, sx, ev


def _ser_count(sx, rel):
    if not sx or not sx["raws"]:
        return 0
    hits = set(sx["by_mkey"].get(names.match_key(rel), ())) | set(sx["by_lkey"].get(names.loose_key(rel), ()))
    return sum(len(sx["raws"].get(h, ())) for h in hits)


def plan(lib, rules=None, scope=None, targets="both", limit=20000, preset=None):
    """Önizleme: değişecek her ad için eski -> yeni, çakışma ve Engine / Serato kayıt sayıları + bir jeton.
    Uygulamadan önce yeniden hesaplanır; disk ya da katalog arada değiştiyse jeton tutmaz ('stale')."""
    t0 = time.time()
    rules = normalize_rules(rules, preset)
    sc = resolve_scope(lib, scope)
    if sc["kind"] == "files":
        targets = "files"
    targets = targets if targets in ("files", "dirs", "both") else "both"
    cat = lib.catalog
    with lib.lock:
        rows = cat.q("SELECT id, rel, name, kind, size, qsig, alen, duration, title, artist FROM files WHERE present=1")
        rules_ign = [names.loose_key(r) for r, a in cat.folder_rules().items() if a == "ignore"]
        mr = lib.music_root()
        gens = {names.loose_key(g["rel"]): g for g in lib.genre_rows()}
    pre_parts = names.split_rel(sc["prefix"]) if sc["prefix"] else []
    pre_key = names.loose_key(sc["prefix"]) if sc["prefix"] else ""
    ign = set(rules_ign)
    mr_key = names.loose_key(mr) if mr else None

    def ignored(parts):
        if sc["include_ignored"] or not ign:
            return False
        for i in range(1, len(parts)):
            if names.loose_key("/".join(parts[:i])) in ign:
                return True
        return False
    eng_n, sx, eng_ev = _refs_by_file(lib, {r["id"]: r["rel"] for r in rows})
    by_rel = {}
    file_items, dir_set = [], {}
    for r in rows:
        parts = names.split_rel(r["rel"])
        if not parts or names.fold(parts[0]) in relocate.PROTECT_TOP or _hidden(parts):
            continue
        if r["kind"] in ("appledouble", "junk"):
            continue
        if pre_parts and names.loose_key("/".join(parts[:len(pre_parts)])) != pre_key:
            continue
        if ignored(parts):
            continue
        by_rel[r["rel"]] = r
        if sc["fids"] is not None:
            if r["id"] not in sc["fids"]:
                continue
        elif targets != "files":
            lo = len(pre_parts) - (1 if sc["include_self"] and pre_parts else 0)
            for i in range(max(1, lo + 1), len(parts)):
                d = "/".join(parts[:i])
                if i == 1 and mr_key and names.loose_key(d) == mr_key and not sc["include_root"] and not pre_parts:
                    continue
                dir_set.setdefault(d, 0)
                dir_set[d] += 1
        if targets != "dirs" and r["kind"] in FILE_KINDS:
            file_items.append(r)
    # yeni adlar
    dir_new = {}
    for d in dir_set:
        last = names.split_rel(d)[-1]
        new, why = transform(last, False, rules)
        if new != last or why == ["empty"]:
            dir_new[d] = (new, why)
    items = []
    for r in file_items:
        new, why = transform(r["name"], True, rules)
        if new != r["name"] or why == ["empty"]:
            items.append({"kind": "file", "fid": r["id"], "rel": r["rel"], "old": r["name"], "new": new, "why": why})
    for d, (new, why) in dir_new.items():
        items.append({"kind": "dir", "fid": None, "rel": d, "old": names.split_rel(d)[-1], "new": new, "why": why,
                      "files": dir_set[d]})
    done = {d: n for d, (n, w) in dir_new.items() if w != ["empty"]}
    # çakışmalar: her üst klasörde son ad alanı
    by_parent = {}
    for it in items:
        by_parent.setdefault(names.parent_rel(it["rel"]), []).append(it)
    ren_old = {(names.parent_rel(it["rel"]), it["old"]) for it in items}
    for parent, its in by_parent.items():
        try:
            ents = os.listdir(lib.rootinfo.os_path(parent) if parent else lib.root)
        except OSError:
            ents = []
        # çakışan (adı değişmeyecek) öğeler eski adlarını tutmaya devam eder: onlara adlandırılan başka öğeler de
        # çakışır (A -> B, ama B -> C yapılamıyorsa A da yapılamaz). Birkaç turda oturur.
        kept = set()
        for _round in range(12):
            stay = {}
            present_keys = set()
            for e in ents:
                c = lib.rootinfo.canonical(e)
                present_keys.add(names.loose_key(c))
                if (parent, c) in ren_old and c not in kept:
                    continue
                stay.setdefault(names.loose_key(c), c)
            seen = {}
            for it in sorted(its, key=lambda x: (x["kind"] != "dir", x["rel"])):
                if it["old"] in kept:
                    continue                # önceki turda çakıştı: nedeni aynen kalır
                it["conflict"] = None
                it["with"] = None
                if it["why"] == ["empty"]:
                    it["conflict"] = "empty"
                    continue
                if names.loose_key(it["old"]) not in present_keys:
                    it["conflict"] = "gone"
                    continue
                k = names.loose_key(it["new"])
                if k in stay:
                    other = (parent + "/" + stay[k]) if parent else stay[k]
                    it["with"] = other
                    it["conflict"] = "exists"
                    o = by_rel.get(other) or cat.file_by_rel(other)
                    src = by_rel.get(it["rel"])
                    if it["kind"] == "file" and o and src and o.get("qsig") and o.get("qsig") == src.get("qsig") and \
                            o.get("alen") == src.get("alen"):
                        it["conflict"] = "same_audio"
                elif k in seen:
                    it["conflict"] = "twin"
                    it["with"] = seen[k]["rel"]
                    if not seen[k].get("conflict"):
                        seen[k]["conflict"] = "twin"
                        seen[k]["with"] = it["rel"]
                else:
                    seen[k] = it
            now = {it["old"] for it in its if it["conflict"]}
            if now <= kept:
                break
            kept |= now
    # tür klasörü: başka bir türle aynı ada düşmesin
    gnames = {}
    for gk, g in gens.items():
        gnames.setdefault(names.fold(g["name"]), []).append(g)
    for it in items:
        if it["kind"] != "dir":
            continue
        g = gens.get(names.loose_key(it["rel"]))
        it["genre"] = g["id"] if g else None
        it["music_root"] = bool(mr_key and names.loose_key(it["rel"]) == mr_key)
        if g and not it["conflict"]:
            others = [x for x in gnames.get(names.fold(it["new"]), []) if x["id"] != g["id"]]
            if others:
                it["conflict"] = "genre_twin"
                it["with"] = names.display(others[0]["rel"])
    # son yollar, sayılar, durum
    eng_total = set()
    files_under = {}
    if any(it["kind"] == "dir" for it in items):
        for rel, r in by_rel.items():
            parts = names.split_rel(rel)
            for i in range(1, len(parts)):
                d = "/".join(parts[:i])
                if d in dir_new:
                    files_under.setdefault(d, []).append(r)
    # başka bir şarkının eski Engine / Serato kaydına düşen ad (dosyası kaybolmuş ya da katalogda bayat): o kayıt
    # bu dosyayı gösterirdi (yanlış şarkı, yanlış cue) -> çakışma; ' (2)' ile yine de yapılabilir
    # son yollar yalnızca gerçekten adı değişecek (çakışmayan) klasörlerle hesaplanır
    done = {it["rel"]: it["new"] for it in items if it["kind"] == "dir" and not it["conflict"]}
    moving = {names.loose_key(it["rel"]) for it in items if it["kind"] == "file"}
    for d in dir_new:
        moving.update(names.loose_key(r["rel"]) for r in files_under.get(d, ()))
    stale = relocate.stale_ref_keys(eng_ev, sx, moving)
    if stale:
        for it in items:
            if it["conflict"]:
                continue
            if it["kind"] == "file":
                p = names.parent_rel(it["rel"])
                fp = relocate._compose(p, done) if p else ""
                final = (fp + "/" + it["new"]) if fp else it["new"]
                if relocate.ref_taken(lib, stale, final, it["rel"], by_rel.get(it["rel"]) or {"id": it["fid"]}):
                    it["conflict"], it["with"] = "ref_taken", final
            else:
                p = names.parent_rel(it["rel"])
                base = names.split_rel(relocate._compose(p, done) if p else "") + [it["new"]]
                pre = it["rel"] + "/"
                for r in files_under.get(it["rel"], ()):
                    final = "/".join(base + names.split_rel(r["rel"][len(pre):]))
                    if relocate.ref_taken(lib, stale, final, r["rel"], r):
                        it["conflict"], it["with"] = "ref_taken", final
                        break
    done = {it["rel"]: it["new"] for it in items if it["kind"] == "dir" and not it["conflict"]}
    ser_n = {}

    def sn(r):
        if r["id"] not in ser_n:
            ser_n[r["id"]] = _ser_count(sx, r["rel"])
        return ser_n[r["id"]]
    out = []
    n_files = n_dirs = n_conf = n_warn = 0
    affected = set()
    for it in items:
        if it["kind"] == "file":
            final = relocate._compose(names.parent_rel(it["rel"]), done) if names.parent_rel(it["rel"]) else ""
            final = (final + "/" + it["new"]) if final else it["new"]
            e = eng_n.get(it["fid"], 0)
            s = sn(by_rel[it["rel"]]) if it["rel"] in by_rel else _ser_count(sx, it["rel"])
            if not it["conflict"]:
                affected.add(it["fid"])
        else:
            final = relocate._compose(it["rel"], done) if it["conflict"] != "empty" else it["rel"]
            under = files_under.get(it["rel"], [])
            e = sum(eng_n.get(r["id"], 0) for r in under)
            s = sum(sn(r) for r in under) if sx and sx["raws"] else 0
            if not it["conflict"]:
                affected.update(r["id"] for r in under)
        why = [w for w in it["why"] if w != "empty"]
        warn = [w for w in why if w in ("non_ascii", "long")]
        if len(final) > 240:
            warn.append("too_long")
        status = "conflict" if it["conflict"] else ("warn" if warn else "ok")
        if status == "conflict":
            n_conf += 1
        elif status == "warn":
            n_warn += 1
        if it["kind"] == "file":
            n_files += 1
        else:
            n_dirs += 1
        iid = ("f:%d" % it["fid"]) if it["kind"] == "file" else ("d:" + it["rel"])
        out.append({"id": iid, "kind": it["kind"], "fid": it["fid"], "rel": names.display(it["rel"]),
                    "old": names.display(it["old"]), "new": names.display(it["new"]),
                    "new_rel": names.display(final), "reasons": [w for w in why if w not in ("non_ascii",)],
                    "warn": warn, "status": status, "conflict": it["conflict"],
                    "with": names.display(it["with"]) if it.get("with") else None,
                    "files": it.get("files", 0), "genre": it.get("genre"), "music_root": it.get("music_root", False),
                    "engine": e, "serato": s, "_rel": it["rel"], "_new": it["new"]})
    out.sort(key=lambda x: (x["status"] != "conflict", x["kind"] != "dir", names.fold(x["rel"])))
    for fid in affected:
        if eng_n.get(fid):
            eng_total.add(fid)
    ser_refs = 0
    if sx and sx["raws"] and affected:
        ser_refs = sum(sn(r) for r in rows if r["id"] in affected)
    truncated = limit is not None and len(out) > limit
    sig = json.dumps([rules, _scope_key(sc), targets,
                      [(x["id"], x["_new"], x["new_rel"], x["status"], x["conflict"]) for x in out]],
                     ensure_ascii=False, sort_keys=True, default=str)
    blocked = None
    if eng_total and lib.engine_open():
        blocked = "engine_open"
    elif ser_refs and lib.serato_open():
        blocked = "serato_open"
    last = lib.catalog.get_meta("last_scan")
    return {"token": hashlib.sha1(sig.encode("utf-8")).hexdigest()[:20], "rules": rules,
            "scope": {"kind": sc["kind"], "label": sc["label"], "prefix": names.display(sc["prefix"]),
                      "gid": sc.get("gid")},
            "targets": targets, "items": out[:limit] if truncated else out,
            "counts": {"files": n_files, "dirs": n_dirs, "affected_files": len(affected), "conflicts": n_conf,
                       "warnings": n_warn, "engine_refs": sum(eng_n.get(f, 0) for f in eng_total),
                       "serato_refs": ser_refs, "total": len(out)},
            "blocked": blocked, "truncated": truncated,
            "scan_age": (util.now() - int(last)) if last and str(last).isdigit() else None,
            "ms": int((time.time() - t0) * 1000)}


# ---------------------------------------------------------------------------
# Uygulama
# ---------------------------------------------------------------------------
def _selection(pl, exclude=(), force=()):
    exclude, force = set(exclude or ()), set(force or ())
    files, dirs, suffix = {}, {}, set()
    for it in pl["items"]:
        if it["id"] in exclude:
            continue
        if it["status"] == "conflict":
            if it["id"] not in force or it["conflict"] in ("empty", "gone", "genre_twin"):
                continue
            suffix.add(it["fid"] if it["kind"] == "file" else "d:" + it["_rel"])
        if it["kind"] == "file":
            files[it["fid"]] = it["_new"]
        else:
            dirs[it["_rel"]] = it["_new"]
    return files, dirs, suffix


def preview_refs(lib, files, dirs, limit=200):
    """Uygulanırsa Engine ve Serato'da hangi kayıtlar değişir? (diske dokunmaz)"""
    cat = lib.catalog
    orig, final = {}, {}
    plan_map = relocate.DirMap([(d, relocate._compose(d, dirs)) for d in dirs])
    for fid, new in files.items():
        f = cat.file(int(fid))
        if f and f["present"]:
            orig[f["id"]] = f["rel"]
            p = names.parent_rel(f["rel"])
            fp = relocate._compose(p, dirs) if p else ""
            final[f["id"]] = (fp + "/" + new) if fp else new
    for d in dirs:
        for r in cat.q("SELECT id, rel FROM files WHERE present=1 AND rel LIKE ? ESCAPE '\\'",
                       (relocate._like(d + "/"),)):
            if r["rel"].startswith(d + "/") and r["id"] not in final:
                orig[r["id"]] = r["rel"]
                final[r["id"]] = plan_map.apply(r["rel"]) or r["rel"]
    changes = [(fid, orig[fid], final[fid]) for fid in orig if final.get(fid) and final[fid] != orig[fid]]
    out = {"engine": [], "serato": [], "counts": {"engine": 0, "serato": 0, "files": len(changes)}}
    eng = relocate._engine_rows(lib, orig.keys(), plan_map)
    for key, info in eng.items():
        d = info["d"]
        for fid, _old, new in changes:
            for tid, oldp in info["rows"].get(fid, []):
                newp = relocate.engine.repath(oldp, None, new, d["lib_dir"], lib.root)
                if newp != oldp:
                    out["counts"]["engine"] += 1
                    if len(out["engine"]) < limit:
                        out["engine"].append({"db": key, "tid": tid, "old": names.display(oldp), "new": names.display(newp)})
        for tid, oldp, rel in info.get("prefix") or []:
            fin = plan_map.apply(rel)
            if fin:
                newp = relocate.engine.repath(oldp, None, fin, d["lib_dir"], lib.root)
                out["counts"]["engine"] += 1
                if len(out["engine"]) < limit:
                    out["engine"].append({"db": key, "tid": tid, "old": names.display(oldp), "new": names.display(newp)})
    sdir = lib.serato_dir()
    if sdir:
        sx = serato.index(sdir)
        mapping = relocate._serato_mapping(lib, sx, changes, plan_map)
        for raw, new in sorted(mapping.items()):
            where = sx["raws"].get(raw, [])
            out["counts"]["serato"] += len(where)
            if len(out["serato"]) < limit:
                out["serato"].append({"old": names.display(names.nfc(raw)), "new": names.display(names.nfc(new)),
                                      "where": where[:12], "n": len(where)})
    return out


def apply(lib, rules=None, scope=None, targets="both", token=None, exclude=(), force=(), progress=None,
          dry_run=False, preset=None):
    """Önizlemeyi yeniden hesaplar (jeton tutmazsa 'stale'), seçilenleri TEK işlemde uygular."""
    with lib.lock:
        pl = plan(lib, rules, scope, targets, limit=None, preset=preset)
        if token and pl["token"] != token:
            raise _err("Bu arada diskte bir şey değişti; önizleme yenilendi. Kontrol edip yeniden uygula.", "stale")
        files, dirs, suffix = _selection(pl, exclude, force)
        if dry_run:
            out = preview_refs(lib, files, dirs)
            out["selected"] = {"files": len(files), "dirs": len(dirs)}
            return out
        if not files and not dirs:
            return {"files": 0, "dirs": 0, "skipped": [], "journal": None}
        n = len(files) + len(dirs)
        pr = PRESETS.get(preset or "")
        title = ("%s: %d ad" % (pr["title"].split(" (")[0], n)) if pr else "%d ad değişti" % n
        res = relocate.batch_rename(lib, files, dirs, title, kind="toplu_ad", progress=progress, suffix=suffix)
        res["selected"] = n
        return res


def rename_one(lib, kind, ref, new_name, dry_run=False, progress=None):
    """Tek dosya ya da klasörün adını değiştirir (şarkı ayrıntısından). Yazılan ad yalnızca güvenli hâle
    getirilir (yasak karakterler); aynı klasörde aynı ad varsa 'exists'."""
    cat = lib.catalog
    rules = normalize_rules(preset="only_illegal")
    if kind == "file":
        f = cat.file(int(ref))
        if not f or not f["present"]:
            raise _err("Şarkı bulunamadı.")
        rel, old, is_file = f["rel"], f["name"], True
    else:
        rel = "/".join(names.split_rel(ref or ""))
        if not rel or not os.path.isdir(lib.rootinfo.os_path(rel)):
            raise _err("Klasör bulunamadı.")
        old, is_file = names.split_rel(rel)[-1], False
        if names.fold(names.split_rel(rel)[0]) in relocate.PROTECT_TOP:
            raise _err("Bu klasörün adı değiştirilemez.")
    typed = (new_name or "").strip()
    if is_file and typed and os.path.splitext(typed)[1].lower() != os.path.splitext(old)[1].lower():
        typed += os.path.splitext(old)[1]          # uzantı yanlışlıkla değişmesin
    new, why = transform(typed, is_file, rules) if typed else ("", ["empty"])
    if not new or why == ["empty"]:
        raise _err("Yeni ad boş olamaz.", "empty")
    parent = names.parent_rel(rel)
    if new == old:
        return {"files": 0, "dirs": 0, "new": names.display(new), "unchanged": True}
    if names.loose_key(new) != names.loose_key(old):
        try:
            ents = os.listdir(lib.rootinfo.os_path(parent) if parent else lib.root)
        except OSError:
            ents = []
        if any(names.loose_key(lib.rootinfo.canonical(e)) == names.loose_key(new) for e in ents):
            raise _err("Bu klasörde aynı adda bir %s var: %s" % ("dosya" if is_file else "klasör", names.display(new)),
                       "exists")
    files = {f["id"]: new} if is_file else {}
    dirs = {} if is_file else {rel: new}
    if names.loose_key(new) != names.loose_key(old):
        # bu adla başka (kaybolmuş) bir şarkının Engine / Serato kaydı var mı? (önizlemede hemen söylensin)
        if is_file:
            moving = {names.loose_key(rel)}
        else:
            moving = {names.loose_key(r["rel"]) for r in cat.q("SELECT rel FROM files WHERE present=1 AND rel LIKE ? "
                                                                "ESCAPE '\\'", (relocate._like(rel + "/"),))}
        _n, sx, eng_ev = _refs_by_file(lib, {r["id"]: r["rel"] for r in cat.q("SELECT id, rel FROM files WHERE present=1")})
        stale = relocate.stale_ref_keys(eng_ev, sx, moving)
        hit = relocate.ref_taken(lib, stale, (parent + "/" + new) if parent else new, rel, f) if is_file else \
            relocate._dir_ref_taken(lib, stale, rel, new, {})
        if hit:
            raise _err("Engine / Serato'da bu adla başka bir şarkının kaydı var. Başka bir ad seçin.", "ref_taken")
    if dry_run:
        out = preview_refs(lib, files, dirs)
        out.update({"old": names.display(old), "new": names.display(new), "changed": why})
        return out
    title = "Ad değişti: %s → %s" % (names.display(old)[:60], names.display(new)[:60])
    res = relocate.batch_rename(lib, files, dirs, title, kind="ad_degistir", progress=progress)
    if not res["files"] and not res["dirs"]:
        why = res["skipped"][0]["why"] if res["skipped"] else ""
        if why == "ref_taken":
            raise _err("Engine / Serato'da bu adla başka bir şarkının kaydı var. Başka bir ad seçin.", why)
        raise _err("Ad değiştirilemedi%s." % (": aynı adda bir dosya var" if why == "exists" else ""), why or None)
    res["new"] = names.display(new)
    return res


def presets_info(lib):
    gens = []
    try:
        gens = [{"id": g["id"], "name": g["name"], "rel": names.display(g["rel"]), "color": g["color"]}
                for g in lib.genre_rows()]
    except Exception:
        pass
    folders = set()
    try:
        for r in lib.catalog.q("SELECT DISTINCT folder FROM files WHERE present=1 AND kind IN ('audio','video')"):
            parts = names.split_rel(r["folder"] or "")
            if not parts or names.fold(parts[0]) in relocate.PROTECT_TOP or _hidden(parts):
                continue
            for i in range(1, min(len(parts), 2) + 1):
                folders.add("/".join(parts[:i]))
    except Exception:
        pass
    folders = sorted(folders, key=lambda x: (names.fold(x.split("/")[0]), x.count("/"), names.fold(x)))[:60]
    return {"presets": [{"key": k, "title": PRESETS[k]["title"], "hint": PRESETS[k]["hint"], "rules": PRESETS[k]["rules"]}
                        for k in PRESET_ORDER],
            "folders": [{"rel": f, "label": names.display(f), "depth": f.count("/")} for f in folders],
            "default": "engine_safe", "reasons": REASONS, "genres": gens, "music_root": names.display(lib.music_root()),
            "has_engine": bool(lib.engine_db()), "has_serato": bool(lib.serato_dir())}


# ---------------------------------------------------------------------------
# API: /api/renamer/...
# ---------------------------------------------------------------------------
@route("renamer")
def _api(h, lib, method, parts, qs, body):
    act = parts[1] if len(parts) > 1 else ""
    sub = parts[2] if len(parts) > 2 else ""
    b = body or {}
    if act == "presets":
        return h._json(presets_info(lib))
    if act == "plan" and method == "POST":
        return h._json(plan(lib, b.get("rules"), b.get("scope"), b.get("targets") or "both", preset=b.get("preset")))
    if act == "apply" and method == "POST":
        args = (b.get("rules"), b.get("scope"), b.get("targets") or "both", b.get("token"), b.get("exclude") or [],
                b.get("force") or [])
        if b.get("dry_run"):
            return h._json(apply(lib, *args, dry_run=True, preset=b.get("preset")))
        return h._task("rename", "Adlar değişiyor", lambda p, c: apply(lib, *args, progress=p, preset=b.get("preset")))
    if act == "one" and method == "POST":
        kind = "dir" if b.get("kind") == "dir" else "file"
        ref = b.get("rel") if kind == "dir" else b.get("id")
        if b.get("dry_run"):
            return h._json(rename_one(lib, kind, ref, b.get("name"), dry_run=True))
        return h._task("rename", "Ad değişiyor", lambda p, c: rename_one(lib, kind, ref, b.get("name"), progress=p))
    if act == "relink":
        from . import relink
        if not sub and method == "GET":
            return h._json(relink.plan(lib))
        if sub == "scan" and method == "POST":
            return h._task("relink", "Kayıp yollar aranıyor", lambda p, c: relink.scan_and_plan(lib, p, c))
        if sub == "apply" and method == "POST":
            keys = b.get("keys")
            picks = b.get("picks") or {}
            return h._task("relink", "Yollar bağlanıyor",
                           lambda p, c: relink.apply(lib, b.get("token"), keys=keys, picks=picks,
                                                     include_medium=bool(b.get("include_medium")), progress=p))
    return None
