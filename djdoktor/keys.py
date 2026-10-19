"""Ton (key) dönüşümleri: Camelot, müzikal gösterim, Open Key ve Engine DJ tamsayı kodu."""
from __future__ import annotations

import re

# Camelot numarası -> (minör, majör) müzikal adlar
_CAMELOT = {
    1: ("Abm", "B"), 2: ("Ebm", "F#"), 3: ("Bbm", "Db"), 4: ("Fm", "Ab"),
    5: ("Cm", "Eb"), 6: ("Gm", "Bb"), 7: ("Dm", "F"), 8: ("Am", "C"),
    9: ("Em", "G"), 10: ("Bm", "D"), 11: ("F#m", "A"), 12: ("Dbm", "E"),
}

_NOTE_INDEX = {
    "C": 0, "B#": 0, "C#": 1, "DB": 1, "D": 2, "D#": 3, "EB": 3, "E": 4, "FB": 4,
    "F": 5, "E#": 5, "F#": 6, "GB": 6, "G": 7, "G#": 8, "AB": 8, "A": 9,
    "A#": 10, "BB": 10, "B": 11, "CB": 11,
}
# kök nota indeksi -> Camelot numarası
_MAJOR_CAM = {0: 8, 7: 9, 2: 10, 9: 11, 4: 12, 11: 1, 6: 2, 1: 3, 8: 4, 3: 5, 10: 6, 5: 7}
_MINOR_CAM = {9: 8, 4: 9, 11: 10, 6: 11, 1: 12, 8: 1, 3: 2, 10: 3, 5: 4, 0: 5, 7: 6, 2: 7}

_CAM_RE = re.compile(r"^\s*0?(1[0-2]|[1-9])\s*([ABab])\s*$")
_OPEN_RE = re.compile(r"^\s*0?(1[0-2]|[1-9])\s*([dmDM])\s*$")
_MUS_RE = re.compile(
    r"^\s*([A-Ga-g])\s*([#♯b♭]?)\s*(m|min|minor|moll|maj|major|dur|M)?\s*$"
)
MIK_RE = re.compile(r"\b0?(1[0-2]|[1-9])\s*([AB])\s*-\s*Energy\s*(\d{1,2})\b", re.I)


def to_camelot(raw) -> str:
    """Her türlü ton yazımını Camelot'a ('8A') çevirir; anlaşılamazsa ''."""
    if raw is None:
        return ""
    s = str(raw).strip()
    if not s:
        return ""
    m = _CAM_RE.match(s)
    if m:
        return f"{int(m.group(1))}{m.group(2).upper()}"
    m = _OPEN_RE.match(s)
    if m:  # Open Key: 1d = C (8B), 1m = Am (8A)
        n = int(m.group(1))
        cam = (n + 6) % 12 + 1
        return f"{cam}{'B' if m.group(2).lower() == 'd' else 'A'}"
    m = MIK_RE.search(s)
    if m:
        return f"{int(m.group(1))}{m.group(2).upper()}"
    s2 = s.replace("♯", "#").replace("♭", "b")
    m = _MUS_RE.match(s2)
    if m:
        acc = (m.group(2) or "")
        note = m.group(1).upper() + ("#" if acc == "#" else ("B" if acc.lower() == "b" else ""))
        idx = _NOTE_INDEX.get(note)
        if idx is None:
            return ""
        qual = m.group(3) or ""
        minor = qual in ("m", "min", "minor", "moll")
        cam = (_MINOR_CAM if minor else _MAJOR_CAM)[idx]
        return f"{cam}{'A' if minor else 'B'}"
    return ""


def camelot_to_musical(cam: str) -> str:
    if not cam:
        return ""
    m = _CAM_RE.match(cam)
    if not m:
        return ""
    n, l = int(m.group(1)), m.group(2).upper()
    minor, major = _CAMELOT[n]
    return minor if l == "A" else major


def engine_key_to_camelot(k) -> str:
    """Engine DJ Track.key (0..23) -> Camelot. 0=C(8B), 1=Am(8A), 2=G(9B) ..."""
    if k is None:
        return ""
    try:
        k = int(k)
    except (TypeError, ValueError):
        return ""
    if not 0 <= k <= 23:
        return ""
    n = (k // 2 + 7) % 12 + 1
    return f"{n}{'B' if k % 2 == 0 else 'A'}"


def camelot_to_engine_key(cam: str):
    m = _CAM_RE.match(cam or "")
    if not m:
        return None
    n, l = int(m.group(1)), m.group(2).upper()
    return ((n - 8) % 12) * 2 + (1 if l == "A" else 0)


def camelot_to_rekordbox(cam: str) -> str:
    """rekordbox XML 'Tonality' alanı için müzikal ad (Am, F#m, Db...)."""
    return camelot_to_musical(cam)


def compatible(a: str, b: str) -> str:
    """İki Camelot ton arasındaki uyum: 'ayni', 'uyumlu', 'enerji' veya 'uyumsuz'."""
    ma, mb = _CAM_RE.match(a or ""), _CAM_RE.match(b or "")
    if not ma or not mb:
        return ""
    na, la = int(ma.group(1)), ma.group(2).upper()
    nb, lb = int(mb.group(1)), mb.group(2).upper()
    if na == nb and la == lb:
        return "ayni"
    if la == lb and (abs(na - nb) in (1, 11)):
        return "uyumlu"
    if na == nb and la != lb:
        return "uyumlu"
    if la == lb and (abs(na - nb) in (2, 10, 7, 5)):
        return "enerji"
    return "uyumsuz"


def parse_mik_comment(comment: str):
    """Mixed In Key yorumu: '8A - Energy 6' -> ('8A', 6) ; yoksa ('', None)."""
    if not comment:
        return "", None
    m = MIK_RE.search(comment)
    if not m:
        return "", None
    return f"{int(m.group(1))}{m.group(2).upper()}", int(m.group(3))


# ---------------------------------------------------------------------------
# Camelot ilişkileri (Mix Asistanı): iki ton arasında hangi geçiş türü, ne kadar uyumlu
# ---------------------------------------------------------------------------
# kod -> (kısa Türkçe ad, uyum puanı 0..1). Puanlar DJ pratiği: aynı ton en güvenli; komşu (±1) ve paralel
# (A↔B) neredeyse her zaman temiz; çapraz (+1 ile A→B / −1 ile B→A) ve +2 enerji yükseltme bilerek yapılır;
# +7 (yarım ton yukarı) dikkatle; geri kalan "çatışma".
CAM_REL = {
    "same": ("Aynı ton", 1.0),
    "up1": ("Komşu ton (+1)", 0.9),
    "down1": ("Komşu ton (−1)", 0.88),
    "relative": ("Paralel (A↔B)", 0.84),
    "diagonal": ("Çapraz geçiş", 0.72),
    "diagonal2": ("Çapraz geçiş (zayıf)", 0.56),
    "boost2": ("Enerji yükseltme +2", 0.62),
    "drop2": ("Enerji düşürme −2", 0.5),
    "semi_up": ("Yarım ton yukarı (+7)", 0.46),
    "semi_down": ("Yarım ton aşağı (−7)", 0.34),
    "near_clash": ("Ton uyumsuz", 0.14),
    "clash": ("Ton çatışması", 0.04),
}
# geçişin müzikal "yönü": +1 yükseltir, −1 indirir, 0 nötr (enerji eğrisiyle birlikte kullanılır)
CAM_LIFT = {"same": 0, "up1": 1, "down1": -1, "relative": 0, "diagonal": 1, "diagonal2": 0, "boost2": 1,
            "drop2": -1, "semi_up": 1, "semi_down": -1, "near_clash": 0, "clash": 0}


def parse_cam(cam):
    """'8A' -> (8, 'A'); anlaşılamazsa None."""
    m = _CAM_RE.match(cam or "")
    if not m:
        return None
    return int(m.group(1)), m.group(2).upper()


def cam_index(cam):
    """Camelot -> 0..23 (dizi indeksi: 1A=0, 1B=1, 2A=2 ...); yoksa -1."""
    p = parse_cam(cam)
    return (p[0] - 1) * 2 + (1 if p[1] == "B" else 0) if p else -1


def cam_of_index(i):
    return "%d%s" % (i // 2 + 1, "B" if i % 2 else "A")


def relation_code(a, b):
    """İki Camelot ton arasındaki geçişin kodu (CAM_REL anahtarı) ya da ton bilinmiyorsa ''."""
    pa, pb = parse_cam(a), parse_cam(b)
    if not pa or not pb:
        return ""
    (na, la), (nb, lb) = pa, pb
    d = (nb - na) % 12            # saat yönünde adım (0..11)
    if la == lb:
        return {0: "same", 1: "up1", 11: "down1", 2: "boost2", 10: "drop2", 7: "semi_up", 5: "semi_down",
                3: "near_clash", 9: "near_clash"}.get(d, "clash")
    if d == 0:
        return "relative"
    if (la == "A" and d == 1) or (la == "B" and d == 11):
        return "diagonal"         # 8A→9B, 8B→7A: altı ortak nota, akıcı
    if d in (1, 11):
        return "diagonal2"        # 8A→7B, 8B→9A
    return "near_clash" if d in (2, 10) else "clash"


def relation(a, b):
    """{'code', 'label', 'score', 'lift'} ya da ton bilinmiyorsa None."""
    c = relation_code(a, b)
    if not c:
        return None
    label, score = CAM_REL[c]
    return {"code": c, "label": label, "score": score, "lift": _lift(c, a)}


def _lift(code, a):
    if code == "diagonal":        # A→B (+1) açar, B→A (−1) duyguyu yumuşatır
        p = parse_cam(a)
        return 1 if p and p[1] == "A" else -1
    return CAM_LIFT[code]


# 24×24 hızlı tablo: REL_SCORE[i][j] (i, j = cam_index); ilişki kodları REL_CODE[i][j]
REL_CODE = [[relation_code(cam_of_index(i), cam_of_index(j)) for j in range(24)] for i in range(24)]
REL_SCORE = [[CAM_REL[c][1] for c in row] for row in REL_CODE]
REL_LIFT = [[_lift(REL_CODE[i][j], cam_of_index(i)) for j in range(24)] for i in range(24)]


def compatible_keys(cam, min_score=0.5):
    """Bu tondan sonra iyi gidecek tonlar: [(camelot, kod, puan)] puana göre."""
    i = cam_index(cam)
    if i < 0:
        return []
    out = [(cam_of_index(j), REL_CODE[i][j], REL_SCORE[i][j]) for j in range(24) if REL_SCORE[i][j] >= min_score]
    out.sort(key=lambda x: -x[2])
    return out


def tempo_diff(a, b):
    """İki BPM arasındaki fark (%), yarım / çift tempo dahil: (yüzde, oran). Oran b'ye uygulanan çarpandır:
    1 = düz, 0.5 = b çift tempoda (70 → 140), 2 = b yarım tempoda (140 → 70). BPM yoksa (None, None)."""
    try:
        a, b = float(a or 0), float(b or 0)
    except (TypeError, ValueError):
        return None, None
    if a <= 0 or b <= 0:
        return None, None
    best = None
    for r in (1.0, 2.0, 0.5):
        d = abs(b * r - a) / a * 100.0
        if best is None or d < best[0] - 1e-9:
            best = (d, r)
    return best
