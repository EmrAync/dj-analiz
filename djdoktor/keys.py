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
