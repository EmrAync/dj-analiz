"""Sorun tespiti ve çift (duplicate) gruplama."""
from __future__ import annotations

import hashlib
import json
from collections import defaultdict

from . import names

# kod: (önem, başlık, açıklama, çözüm)
ISSUES = {
    "name_badchar": (
        "kritik", "Adda Mac'e özel / yasak karakter var",
        "Bu dosya ya da içinde bulunduğu klasörün adında Mac'te ':' '/' '?' '\"' gibi görünen bir işaret var. "
        "Diskte bu işaret görünmez bir özel karaktere dönüşür. Mac'te çalışır; Windows'ta ve Prime 4'te "
        "yol farklı okunduğu için parça KAYIP/KIRMIZI görünür.",
        "Düzeltme > Güvenli ad düzeltme. Serato listeleri ve Engine veritabanındaki yollar birlikte güncellenir."),
    "name_trailing": (
        "kritik", "Ad boşluk veya nokta ile bitiyor",
        "Windows ve exFAT sonda boşluk/nokta kabul etmez; Mac bunu gizli bir karakterle saklar. "
        "Sistemler arasında yol uyuşmaz.",
        "Düzeltme > Güvenli ad düzeltme."),
    "name_reserved": (
        "kritik", "Windows'ta ayrılmış ad",
        "CON, AUX, NUL, COM1 gibi adlar Windows'ta açılamaz.",
        "Düzeltme > Güvenli ad düzeltme."),
    "name_nfd": (
        "uyari", "Ad ayrık Unicode (NFD) ile kaydedilmiş",
        "Türkçe harfler (ü, ö, ş, ç, ğ, İ) diskte ayrık biçimde duruyor. Windows ve Prime 4 başka programların "
        "yazdığı birleşik biçimle eşleştiremeyebilir.",
        "Düzeltme > Güvenli ad düzeltme (harfler korunur, sadece biçim düzelir)."),
    "name_long": (
        "uyari", "Yol çok uzun",
        "Dosya yolu 240 karakteri aşıyor. Windows'ta ve bazı DJ programlarında açılmayabilir.",
        "Dosyayı daha kısa adlı bir klasöre taşıyın veya adını kısaltın."),
    "name_emoji": (
        "bilgi", "Adda emoji / sembol var",
        "🥁 ⚡ 🎶 gibi semboller bazı cihazlarda ve yazı tiplerinde sorun çıkarabilir.",
        "İsterseniz Güvenli ad düzeltme ile temizleyin."),
    "junk_appledouble": (
        "uyari", "Mac çöp dosyası (._ ile başlayan)",
        "Mac, exFAT disklere her dosya için '._' ile başlayan 4 KB'lık yardımcı dosyalar bırakır. "
        "Uzantısı .mp3 olduğu için Engine DJ / Prime 4 / Serato bunları bozuk parça olarak gösterebilir.",
        "Düzeltme > Çöp dosyaları karantinaya taşı (silinmez, geri alınabilir)."),
    "junk_other": (
        "bilgi", "Sistem çöp dosyası (.DS_Store, Thumbs.db)",
        "Zararsızdır ama kalabalık yapar.",
        "Düzeltme > Çöp dosyaları karantinaya taşı."),
    "fmt_engine": (
        "uyari", "Engine DJ / Prime 4 bu biçimi çalmaz",
        "Prime 4 yalnızca MP3, AAC/M4A, WAV, AIFF, ALAC ve FLAC çalar.",
        "Bu dosyayı MP3/M4A/FLAC'a dönüştürün."),
    "fmt_aac": (
        "bilgi", "Ham .aac dosyası",
        "'.aac' uzantılı ham AAC dosyaları bazı yazılımlarda (ör. Windows'ta Serato) sorun çıkarır.",
        "M4A olarak yeniden kaydedin."),
    "fmt_video": (
        "bilgi", "Video dosyası",
        "Müzik klasöründe video var.",
        "Gerekmiyorsa ayrı bir klasöre taşıyın."),
    "audio_error": (
        "kritik", "Dosya okunamıyor / bozuk olabilir",
        "Etiket ya da ses bilgisi okunamadı. Dosya yarım inmiş veya bozuk olabilir.",
        "Dosyayı bir oynatıcıda kontrol edin, gerekirse yeniden indirin."),
    "audio_empty": (
        "kritik", "Boş dosya / içinde ses yok",
        "Dosya ya birkaç KB ya da yalnızca etiket (isim, kapak) içeriyor; ses verisi yok. "
        "Genellikle yarım kalmış bir indirmedir. Çalınamaz.",
        "Dosyayı yeniden indirin / kopyalayın."),
    "audio_lowbr": (
        "bilgi", "Düşük kalite (192 kbps altı)",
        "Büyük ses sistemlerinde kalite farkı duyulabilir (YouTube kaynaklı dosyalarda yaygın).",
        "Mümkünse 320 kbps veya kayıpsız sürümünü edinin."),
    "audio_hires": (
        "bilgi", "Yüksek örnekleme hızı (48 kHz üstü)",
        "Sorun değildir ama dosya gereksiz büyük olabilir.",
        ""),
    "tag_none": (
        "bilgi", "Sanatçı/başlık etiketi yok",
        "DJ programları dosya adını gösterir; Engine bu dosyaları 'Unknown Artist' olarak kopyalar.",
        "Etiketleri bir etiket düzenleyiciyle doldurun."),
    "engine_copy": (
        "uyari", "Engine DJ'in yaptığı kopya",
        "Engine DJ, dosyaları sürücüye aktarırken 'Engine Library/Music' içine kopyalar. "
        "Aynı şarkı diskte iki kez yer kaplar ve hangi kopyanın kullanıldığı karışır.",
        "Çiftler sayfasından asıl dosyayı seçip bu kopyayı karantinaya taşıyın."),
    "dup_exact": (
        "uyari", "Birebir aynı dosyanın kopyası",
        "Bu dosyanın diskte bayt bayt aynı bir kopyası daha var.",
        "Çiftler sayfasından birini tutun, diğerini karantinaya taşıyın."),
    "dup_audio": (
        "uyari", "Aynı ses, farklı etiket",
        "Ses verisi aynı ama etiketleri farklı (yorum, ton, cue noktaları). Hangisinde notunuz var karışır.",
        "Çiftler sayfasında farkları görün, en dolu olanı tutun."),
    "dup_song": (
        "bilgi", "Muhtemelen aynı şarkı (farklı kayıt/kalite)",
        "Adı ve süresi aynı ama ses verisi farklı: farklı indirme veya farklı kalite.",
        "Çiftler sayfasında karşılaştırıp yüksek kaliteli olanı tutun."),
    "missing": (
        "uyari", "Dosya artık yok",
        "Önceki taramada vardı, şimdi bulunamadı (taşınmış, adı değişmiş veya silinmiş).",
        "Listelerdeki kayıtları kontrol edin."),
}

SEV_ORDER = {"kritik": 0, "uyari": 1, "bilgi": 2}


def file_issues(f, prefs):
    codes = []
    rel = f["rel"]
    if not f.get("present", 1):
        return ["missing"]
    kind = f.get("kind")
    if kind == "appledouble":
        return ["junk_appledouble"]
    if kind == "junk":
        return ["junk_other"]
    probs = names.path_problems(rel)
    if "sfm" in probs or "illegal" in probs or "control" in probs:
        codes.append("name_badchar")
    if "trailing" in probs:
        codes.append("name_trailing")
    if "reserved" in probs:
        codes.append("name_reserved")
    if "nfd" in probs:
        codes.append("name_nfd")
    if "long_path" in probs or "long_name" in probs:
        codes.append("name_long")
    if "emoji" in probs:
        codes.append("name_emoji")
    if kind == "video":
        codes.append("fmt_video")
        return codes
    ext = f.get("ext") or ""
    if ext not in names.ENGINE_OK_EXTS:
        codes.append("fmt_engine")
    if ext == ".aac":
        codes.append("fmt_aac")
    size = f.get("size") or 0
    alen = f.get("alen")
    # Dosya küçükse ya da etiketler çıkarıldığında geriye neredeyse hiç ses kalmıyorsa
    # (yarım kalmış indirme: yalnızca ID3 etiketi var) -> boş dosya.
    if size < 4 * 1024 or (alen is not None and 0 <= alen < 4 * 1024):
        codes.append("audio_empty")
    elif f.get("tag_error"):
        codes.append("audio_error")
    br = f.get("bitrate") or 0
    lossless = ext in (".flac", ".wav", ".aif", ".aiff", ".alac")
    if br and not lossless and br < int(prefs.get("lowbitrate_kbps", 192)) - 2:
        codes.append("audio_lowbr")
    if (f.get("sample_rate") or 0) > 48000:
        codes.append("audio_hires")
    if not (f.get("title") or "").strip() or not (f.get("artist") or "").strip():
        codes.append("tag_none")
    if f.get("origin") == "engine_copy":
        codes.append("engine_copy")
    return codes


# ---------------------------------------------------------------------------
# Çiftler
# ---------------------------------------------------------------------------
def _score(f, refs):
    r = refs.get(f["id"], {})
    reasons = []
    s = 0.0
    sc, ec, lc = r.get("serato", 0), r.get("engine", 0), r.get("lists", 0)
    if sc:
        s += 40 * min(3, sc)
        reasons.append("Serato'da %d listede" % sc)
    if ec:
        s += 40 * min(3, ec)
        reasons.append("Engine'de %d listede" % ec)
    if lc:
        s += 30 * min(3, lc)
        reasons.append("Kendi listelerinizde %d kez" % lc)
    if f.get("note"):
        s += 60
        reasons.append("Kendi notunuz var: “%s”" % (f["note"][:40]))
    if f.get("cues"):
        s += 25
        reasons.append("%d cue noktası" % f["cues"])
    if f.get("camelot"):
        s += 8
    ext = f.get("ext") or ""
    if ext in (".flac", ".wav", ".aif", ".aiff", ".alac"):
        s += 14
        reasons.append("kayıpsız kalite")
    elif f.get("bitrate"):
        s += (f["bitrate"] or 0) / 32.0
        if f["bitrate"] >= 300:
            reasons.append("%d kbps" % f["bitrate"])
    if f.get("origin") == "engine_copy":
        s -= 80
        reasons.append("Engine kopyası (önerilmez)")
    filled = sum(1 for k in ("title", "artist", "genre", "album", "camelot", "bpm") if f.get(k))
    s += filled
    if f.get("issues_crit"):
        s -= 30
        reasons.append("adında sorun var")
    s -= len(f["rel"]) / 1000.0
    return s, reasons


def group_duplicates(files, refs):
    """files: katalog satırları (present=1). refs: {file_id: {serato,engine,lists}}"""
    audio = [f for f in files if f.get("kind") == "audio" and f.get("present") and f.get("qsig")]
    by_sig = defaultdict(list)
    for f in audio:
        by_sig[(f["qsig"], f.get("alen"))].append(f)
    groups = []
    in_audio_group = {}
    for (sig, alen), members in by_sig.items():
        if len(members) < 2:
            continue
        exact = len({(m.get("tagsig"), m.get("size")) for m in members}) == 1
        g = _make_group("ses-" + sig[:16], "exact" if exact else "audio", members, refs)
        groups.append(g)
        for m in members:
            in_audio_group[m["id"]] = g["id"]
    # bulanık: aynı şarkı anahtarı + benzer süre, farklı ses verisi
    by_song = defaultdict(list)
    for f in audio:
        if f.get("songkey") and f.get("duration"):
            by_song[f["songkey"]].append(f)
    for key, members in by_song.items():
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
            sigs = {m["qsig"] for m in cl}
            if len(cl) < 2 or len(sigs) < 2:
                continue
            # aynı ses grubundakileri tek temsilciye indir
            seen, rep = set(), []
            for m in cl:
                g = in_audio_group.get(m["id"])
                if g and g in seen:
                    continue
                if g:
                    seen.add(g)
                rep.append(m)
            if len(rep) < 2:
                continue
            gid = "sarki-" + hashlib.md5(key.encode("utf-8")).hexdigest()[:10] + "-" + str(int(cl[0]["duration"]))
            groups.append(_make_group(gid, "song", cl, refs))
    order = {"exact": 0, "audio": 1, "song": 2}
    groups.sort(key=lambda g: (order[g["kind"]], -len(g["members"]), g["members"][0]["rel"]))
    return groups


def _make_group(gid, kind, members, refs):
    scored = []
    for m in members:
        s, reasons = _score(m, refs)
        scored.append((s, m, reasons))
    scored.sort(key=lambda x: -x[0])
    keeper = scored[0][1]
    out_members = []
    for s, m, reasons in scored:
        r = refs.get(m["id"], {})
        out_members.append({
            "id": m["id"], "rel": m["rel"], "folder": m.get("folder"), "name": m.get("name"),
            "size": m.get("size"), "bitrate": m.get("bitrate"), "duration": m.get("duration"),
            "ext": m.get("ext"), "title": m.get("title"), "artist": m.get("artist"),
            "comment": m.get("comment"), "note": m.get("note"), "camelot": m.get("camelot"),
            "bpm": m.get("bpm"), "cues": m.get("cues") or 0, "origin": m.get("origin"),
            "serato": r.get("serato", 0), "engine": r.get("engine", 0), "lists": r.get("lists", 0),
            "score": round(s, 1), "reasons": reasons, "keeper": m["id"] == keeper["id"],
        })
    # tutulacak kopyada eksik olup başka kopyada olan bilgiler
    missing = []
    if not keeper.get("note") and any(m.get("note") for m in members):
        missing.append("not")
    if not keeper.get("cues") and any(m.get("cues") for m in members):
        missing.append("cue")
    if not keeper.get("camelot") and any(m.get("camelot") for m in members):
        missing.append("ton")
    return {"id": gid, "kind": kind, "members": out_members, "keeper": keeper["id"],
            "keeper_missing": missing}


def compute(catalog, prefs):
    """Tüm dosyalar için sorun bayraklarını ve çift gruplarını hesaplar."""
    files = catalog.files()
    refs = reference_counts(catalog)
    flags = {}
    for f in files:
        codes = file_issues(f, prefs)
        if codes:
            flags[f["id"]] = codes
        f["issues_crit"] = any(ISSUES[c][0] == "kritik" for c in codes)
    present = [f for f in files if f.get("present")]
    groups = group_duplicates(present, refs)
    for g in groups:
        code = {"exact": "dup_exact", "audio": "dup_audio", "song": "dup_song"}[g["kind"]]
        for m in g["members"]:
            if not m["keeper"]:
                flags.setdefault(m["id"], [])
                if code not in flags[m["id"]]:
                    flags[m["id"]].append(code)
    catalog.set_flags(flags)
    catalog.set_meta("dupes", json.dumps(groups, ensure_ascii=False))
    return {"issues": len(flags), "dupe_groups": len(groups)}


def reference_counts(catalog):
    refs = defaultdict(lambda: {"serato": 0, "engine": 0, "lists": 0})
    for r in catalog.q("SELECT file_id, src, COUNT(DISTINCT list_key) AS n FROM ext_items "
                       "WHERE file_id IS NOT NULL GROUP BY file_id, src"):
        k = "serato" if r["src"].startswith("serato") else "engine"
        refs[r["file_id"]][k] += r["n"]
    for r in catalog.q("SELECT file_id, COUNT(*) AS n FROM list_items GROUP BY file_id"):
        refs[r["file_id"]]["lists"] += r["n"]
    return dict(refs)


def summary(catalog):
    files = catalog.files()
    counts = defaultdict(int)
    examples = defaultdict(list)
    for f in files:
        if not f.get("flags"):
            continue
        for c in json.loads(f["flags"]):
            counts[c] += 1
            if len(examples[c]) < 3:
                examples[c].append(f["rel"])
    items = []
    for code, n in counts.items():
        sev, title, desc, fix = ISSUES.get(code, ("bilgi", code, "", ""))
        items.append({"code": code, "count": n, "severity": sev, "title": title, "desc": desc,
                      "fix": fix, "examples": [names.display(x) for x in examples[code]]})
    items.sort(key=lambda x: (SEV_ORDER[x["severity"]], -x["count"]))
    audio = [f for f in files if f.get("kind") == "audio" and f.get("present")]
    stats = {
        "audio": len(audio),
        "missing": sum(1 for f in files if not f.get("present") and f.get("kind") == "audio"),
        "junk": sum(1 for f in files if f.get("kind") in ("appledouble", "junk") and f.get("present")),
        "size": sum(f.get("size") or 0 for f in audio),
        "duration": sum(f.get("duration") or 0 for f in audio),
        "with_note": sum(1 for f in audio if f.get("note")),
        "with_mik": sum(1 for f in audio if f.get("mik_key")),
        "with_cues": sum(1 for f in audio if f.get("cues")),
        "no_tags": sum(1 for f in audio if not (f.get("title") and f.get("artist"))),
        "formats": {},
    }
    for f in audio:
        stats["formats"][f["ext"]] = stats["formats"].get(f["ext"], 0) + 1
    return {"items": items, "stats": stats}
