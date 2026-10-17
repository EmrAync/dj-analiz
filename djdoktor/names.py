"""Dosya adı ve yol yardımcıları.

Bu modül programın en kritik bilgisini taşır: aynı dosya adı farklı işletim
sistemlerinde FARKLI bayt dizileri olarak görünebilir.

1) Unicode normalizasyonu (NFC / NFD)
   Disk (exFAT) üzerinde "ü" tek karakter (U+00FC, NFC) olarak durur.
   macOS ise uygulamalara bunu "u" + "¨" (U+0075 U+0308, NFD) olarak verir.
   Serato / Engine DJ Mac'te bu ayrık hâli veritabanına yazar. Mac yine de
   dosyayı bulur, fakat Windows ve Prime 4 (Linux tabanlı Engine OS) bayt
   bayt karşılaştırdığı için dosyayı BULAMAZ -> kırmızı / kayıp parça.

2) macOS "SFM" karakter eşlemesi
   exFAT/FAT/NTFS'te yasak olan karakterler (" * : < > ? \\ | ve sondaki
   boşluk/nokta) macOS tarafından diske Unicode "özel kullanım" alanındaki
   karakterlerle (U+F020..U+F029) yazılır. Mac'te ":" görünen klasör adı
   Windows'ta ve Prime 4'te görünmez bir karakter içerir.
   Finder'da "/" yazılan bir ad POSIX'te ":" olur, diske de U+F022 yazılır.

Programın içinde her dosya için "disk biçimi" (kanonik yol) kullanılır:
NFC + SFM özel karakterleri. Bu biçim Windows ve Prime 4'ün gördüğü baytlarla
aynıdır; Engine veritabanına yazılması gereken doğru yol da budur.
"""
from __future__ import annotations

import os
import re
import sys
import unicodedata

# ---------------------------------------------------------------------------
# SFM (Services for Macintosh) eşlemesi
# ---------------------------------------------------------------------------
SFM_TO_ASCII = {
    0xF020: '"',
    0xF021: '*',
    0xF022: ':',
    0xF023: '<',
    0xF024: '>',
    0xF025: '?',
    0xF026: '\\',
    0xF027: '|',
    0xF028: ' ',  # yalnızca ad sonunda
    0xF029: '.',  # yalnızca ad sonunda
}
for _i in range(1, 32):
    SFM_TO_ASCII[0xF000 + _i] = chr(_i)

_SFM_TRANS = {k: v for k, v in SFM_TO_ASCII.items()}
_ASCII_TO_SFM = {
    '"': '', '*': '', ':': '', '<': '', '>': '',
    '?': '', '\\': '', '|': '',
}
for _i in range(1, 32):
    _ASCII_TO_SFM[chr(_i)] = chr(0xF000 + _i)

WIN_ILLEGAL = set('<>:"\\|?*')
WIN_RESERVED = {
    "CON", "PRN", "AUX", "NUL",
    *("COM%d" % i for i in range(1, 10)),
    *("LPT%d" % i for i in range(1, 10)),
}

AUDIO_EXTS = {
    ".mp3", ".m4a", ".aac", ".flac", ".wav", ".aif", ".aiff", ".alac",
    ".ogg", ".opus", ".wma", ".m4p", ".mp4",
}
# Engine DJ / Prime 4'ün oynatabildiği biçimler (Denon SSS: MP3, AAC/M4A, WAV, AIFF, ALAC, FLAC)
ENGINE_OK_EXTS = {".mp3", ".m4a", ".aac", ".flac", ".wav", ".aif", ".aiff", ".alac"}
SERATO_OK_EXTS = {".mp3", ".m4a", ".aac", ".flac", ".wav", ".aif", ".aiff", ".alac", ".ogg", ".mp4"}
VIDEO_EXTS = {".mp4", ".m4v", ".mov", ".avi", ".mkv", ".webm", ".wmv", ".flv", ".mpg", ".mpeg"}
JUNK_NAMES = {".ds_store", "thumbs.db", "desktop.ini", ".localized", "icon\r"}

PUA_RE = re.compile("[-]")


def has_sfm(s: str) -> bool:
    return bool(PUA_RE.search(s or ""))


def sfm_to_ascii(s: str) -> str:
    """Disk biçimindeki özel karakterleri macOS'un gösterdiği ASCII hâline çevirir."""
    if not s or not PUA_RE.search(s):
        return s
    return s.translate(_SFM_TRANS)


def ascii_to_sfm_component(name: str) -> str:
    """Tek bir ad parçasında macOS'un exFAT'a yazarken yaptığı eşlemeyi uygular."""
    if not name:
        return name
    out = [_ASCII_TO_SFM.get(c, c) for c in name]
    if out and out[-1] == " ":
        out[-1] = ""
    elif out and out[-1] == ".":
        out[-1] = ""
    return "".join(out)


def nfc(s: str) -> str:
    return unicodedata.normalize("NFC", s) if s else s


def nfd(s: str) -> str:
    return unicodedata.normalize("NFD", s) if s else s


def split_rel(rel: str):
    return [p for p in rel.replace("\\", "/").split("/") if p not in ("", ".")]


def to_disk_form(rel: str, mac_exfat: bool) -> str:
    """İşletim sisteminin verdiği göreli yolu disk biçimine çevirir.

    mac_exfat=True: program macOS'ta, kök exFAT/FAT bir diskte -> NFC + SFM.
    Aksi hâlde ad zaten diskteki gibidir (Windows, Linux, Mac APFS) ve
    olduğu gibi bırakılır.
    """
    parts = split_rel(rel)
    if mac_exfat:
        parts = [ascii_to_sfm_component(nfc(p)) for p in parts]
    return "/".join(parts)


def to_mac_form(rel: str) -> str:
    """Disk biçimini macOS uygulamalarının (Serato/Engine Mac) yazdığı biçime çevirir."""
    return "/".join(nfd(sfm_to_ascii(p)) for p in split_rel(rel))


def match_key(rel: str) -> str:
    """Normalizasyon ve SFM farklarından bağımsız eşleştirme anahtarı."""
    return "/".join(nfc(sfm_to_ascii(p)) for p in split_rel(rel))


def loose_key(rel: str) -> str:
    """Büyük/küçük harf farkını da yok sayan gevşek anahtar (exFAT büyük/küçük harf duyarsızdır)."""
    return match_key(rel).casefold()


# ---------------------------------------------------------------------------
# Türkçe uyumlu katlama (arama ve benzerlik için)
# ---------------------------------------------------------------------------
_TR_MAP = str.maketrans({
    "ı": "i", "İ": "i", "I": "i", "ş": "s", "Ş": "s", "ğ": "g", "Ğ": "g",
    "ü": "u", "Ü": "u", "ö": "o", "Ö": "o", "ç": "c", "Ç": "c",
    "â": "a", "Â": "a", "î": "i", "Î": "i", "û": "u", "Û": "u",
    "ß": "ss", "æ": "ae", "ø": "o", "đ": "d", "ł": "l",
})


# Büyük/küçük harfi KORUYAN Türkçe -> ASCII (dosya / klasör adı sadeleştirme için; arama katlaması değil)
_TR_ASCII = str.maketrans({
    "ı": "i", "İ": "I", "ş": "s", "Ş": "S", "ğ": "g", "Ğ": "G", "ü": "u", "Ü": "U", "ö": "o", "Ö": "O",
    "ç": "c", "Ç": "C", "â": "a", "Â": "A", "î": "i", "Î": "I", "û": "u", "Û": "U",
    "ß": "ss", "æ": "ae", "Æ": "AE", "ø": "o", "Ø": "O", "đ": "d", "Đ": "D", "ł": "l", "Ł": "L",
})


def ascii_tr(s: str) -> str:
    """'Türkü Şöleni' -> 'Turku Soleni', 'İSTANBUL' -> 'ISTANBUL'. Mac'in ayrık (NFD) harflerini de çözer;
    diğer aksanlar (é, ñ…) temel harfe iner. Büyük/küçük harf korunur."""
    if not s:
        return s
    s = nfc(s).translate(_TR_ASCII)
    s = unicodedata.normalize("NFKD", s)
    return "".join(c for c in s if not unicodedata.combining(c))


def fold(s: str) -> str:
    """'HALAYI', 'Halayı', 'halayi' -> 'halayi'. Aksanları ve Türkçe harfleri sadeleştirir."""
    if not s:
        return ""
    s = nfc(sfm_to_ascii(s)).translate(_TR_MAP)
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    return s.casefold()


_NOISE_PATTERNS = [
    r"\(?\[?\s*official\s+(music\s+)?(video|audio|clip|lyric\s+video|visualizer)\s*\]?\)?",
    r"\(?\[?\s*(lyrics?|lyric\s+video|audio|hd|hq|4k|8k|1080p|720p|full\s*hd|klip|video\s*klip|videoclip|music\s+video|resmi\s+video|official)\s*\]?\)?",
    r"\(\s*\d{3}\s*(kbps)?\s*\)",
    r"\b(y2mate|ytmp3|savefrom|mp3juices|mediahuman|youtube)\b(\.com)?",
    r"www\.[^\s]+",
    r"\s-\s*youtube$",
    r"\((\d|kopya|kopie|copy)\)$",
    r"\b(copy|kopya|kopie)\b",
]
_NOISE_RE = [re.compile(p, re.I) for p in _NOISE_PATTERNS]


def song_key(artist: str, title: str, filename_stem: str) -> str:
    """Bulanık çift tespiti için 'aynı şarkı' anahtarı.

    Etiket varsa sanatçı+başlık, yoksa dosya adı kullanılır; YouTube eklentileri
    ('Official Video', '(320)', 'Lyrics' ...) atılır ve kelimeler sıralanır.
    """
    base = ""
    if title and artist and fold(title) != fold(filename_stem):
        base = f"{artist} {title}"
    elif title and len(title) > 3:
        base = title if not artist else f"{artist} {title}"
    else:
        base = filename_stem or ""
    s = fold(base)
    for rx in _NOISE_RE:
        s = rx.sub(" ", s)
    s = re.sub(r"[^\w]+", " ", s)
    s = re.sub(r"\b(feat|ft|featuring|vs|x|ve|and|the)\b", " ", s)
    toks = [t for t in s.split() if t]
    if len(toks) <= 1 and len("".join(toks)) < 4:
        return ""  # çok kısa / anlamsız
    return " ".join(sorted(set(toks)))


# ---------------------------------------------------------------------------
# Ad sorunları
# ---------------------------------------------------------------------------
_EMOJI_RE = re.compile(
    "[\U0001F000-\U0001FAFF\U00002600-\U000027BF\U0001F900-\U0001F9FF️‍⃣]"
)


def has_emoji(s: str) -> bool:
    return bool(_EMOJI_RE.search(s or ""))


def component_problems(name: str):
    """Bir ad parçası için sorun kodlarını döndürür."""
    probs = []
    if not name:
        return probs
    if has_sfm(name):
        probs.append("sfm")
    if any(c in WIN_ILLEGAL for c in name):
        probs.append("illegal")
    if any(ord(c) < 32 for c in name):
        probs.append("control")
    if name != name.rstrip(" .") and not has_sfm(name[-1:]):
        probs.append("trailing")
    if name != name.lstrip(" "):
        probs.append("leading_space")
    if nfc(name) != name:
        probs.append("nfd")
    stem = name.split(".")[0].upper()
    if stem in WIN_RESERVED:
        probs.append("reserved")
    if has_emoji(name):
        probs.append("emoji")
    if len(name.encode("utf-16-le")) // 2 > 200:
        probs.append("long_name")
    return probs


def path_problems(rel: str):
    """Yolun tüm parçalarındaki sorunları birleştirir: {kod: [parça, ...]}"""
    res = {}
    for p in split_rel(rel):
        for code in component_problems(p):
            res.setdefault(code, []).append(p)
    if len(rel) > 240:
        res.setdefault("long_path", []).append(rel)
    return res


def minimal_fix_component(name: str, is_file: bool) -> str:
    """Ad parçasını yalnızca SORUNLU karakterleri düzelterek güvenli hâle getirir.

    Türkçe harfler korunur, sadece normalizasyon NFC yapılır.
    'ROMAN : MEZDEKE' -> 'ROMAN - MEZDEKE', 'Pop yeni 10.04.' -> 'Pop yeni 10.04'
    """
    s = nfc(sfm_to_ascii(name))
    stem, ext = (os.path.splitext(s) if is_file else (s, ""))
    rep = {
        ":": " - ", "/": " - ", "\\": " - ", "|": " - ",
        '"': "'", "*": "", "?": "", "<": "(", ">": ")",
    }
    stem = "".join(rep.get(c, c) if (c in rep) else ("" if ord(c) < 32 else c) for c in stem)
    stem = re.sub(r"\s+-\s+(-\s+)+", " - ", stem)
    stem = re.sub(r" {2,}", " ", stem)
    stem = stem.strip(" .")
    if not stem:
        stem = "adsiz"
    if stem.split(".")[0].upper() in WIN_RESERVED:
        stem += "_"
    # aşırı uzun adları kısalt
    max_units = 180
    while len((stem + ext).encode("utf-16-le")) // 2 > max_units and len(stem) > 10:
        stem = stem[:-1].rstrip(" .")
    return stem + ext


def clean_component(name: str, is_file: bool, keep_turkish: bool = True, strip_emoji: bool = True) -> str:
    """Yeni eklenen dosyalar için daha kapsamlı temizlik (emoji, çift boşluk, isteğe bağlı ASCII)."""
    s = minimal_fix_component(name, is_file)
    stem, ext = (os.path.splitext(s) if is_file else (s, ""))
    if strip_emoji:
        stem = _EMOJI_RE.sub("", stem)
    if not keep_turkish:
        stem = nfc(stem).translate(_TR_MAP)
        stem = unicodedata.normalize("NFKD", stem)
        stem = "".join(c for c in stem if not unicodedata.combining(c) and ord(c) < 128)
    stem = re.sub(r"\s+", " ", stem).strip(" .-_")
    stem = re.sub(r"\(\s*\)", "", stem).strip()
    if not stem:
        stem = "adsiz"
    return stem + ext.lower()


def display(s: str) -> str:
    """Arayüzde göstermek için: özel karakterleri görünür yap."""
    if not s:
        return s
    if has_sfm(s):
        s = "".join(("⟪" + SFM_TO_ASCII[ord(c)] + "⟫") if 0xF001 <= ord(c) <= 0xF029 else c for c in s)
    return nfc(s)


# ---------------------------------------------------------------------------
# Dosya türü sınıflandırma
# ---------------------------------------------------------------------------
def classify(name: str) -> str:
    low = name.lower()
    if name.startswith("._"):
        return "appledouble"
    if low in JUNK_NAMES:
        return "junk"
    ext = os.path.splitext(low)[1]
    if ext in (".mp4",):
        return "audio"  # mp4 hem video hem ses olabilir; etiket okuyucu karar verir
    if ext in AUDIO_EXTS:
        return "audio"
    if ext in VIDEO_EXTS:
        return "video"
    return "other"


# ---------------------------------------------------------------------------
# İşletim sistemi yolları
# ---------------------------------------------------------------------------
IS_WIN = sys.platform.startswith("win")
IS_MAC = sys.platform == "darwin"


def long_path(p: str) -> str:
    """Windows'ta 260 karakter sınırını aşan yollar için \\\\?\\ öneki."""
    if IS_WIN and len(p) > 240 and not p.startswith("\\\\?\\"):
        p = os.path.abspath(p)
        if p.startswith("\\\\"):
            return "\\\\?\\UNC\\" + p[2:]
        return "\\\\?\\" + p
    return p


def join_os(root: str, rel: str) -> str:
    return os.path.join(root, *split_rel(rel))


# ---------------------------------------------------------------------------
# Yeniden adlandırma ve kayıp yol bağlama yardımcıları (2.2)
# ---------------------------------------------------------------------------
TR_LETTERS = frozenset("çğıöşüÇĞİÖŞÜâîûÂÎÛ")


def has_turkish(s: str) -> bool:
    """Adda Türkçe harf (ç ğ ı ö ş ü İ â î û) var mı? Mac'in ayrık (NFD) yazımı da sayılır."""
    return bool(s) and any(c in TR_LETTERS for c in nfc(s))


def fold_path(rel: str) -> str:
    """Yolun her parçası katlanmış (Türkçe harf, aksan, büyük/küçük harf, NFD ve Mac özel karakteri farkı yok):
    'Müzik/Türkü Arşivi/Gönül.mp3' ve 'Muzik/TURKU ARSIVI/gonul.mp3' aynı anahtarı verir."""
    return "/".join(fold(p) for p in split_rel(rel))


def parent_rel(rel: str) -> str:
    return rel.rsplit("/", 1)[0] if "/" in rel else ""
