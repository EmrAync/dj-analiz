"""Etiket okuma (mutagen ile) — MP3, M4A/AAC/ALAC, FLAC, WAV, AIFF, OGG.

Dosyalar yalnızca OKUNUR. Serato cue noktaları (Serato Markers2), Mixed In Key
ton/enerji bilgisi ve kullanıcının kendi notu (yorum alanından) ayrıştırılır.
"""
from __future__ import annotations

import base64
import re
import struct

from . import keys

try:  # vendor klasörü baslat.py tarafından sys.path'e eklenir
    import mutagen
    from mutagen.id3 import ID3
    from mutagen.mp4 import MP4
except Exception:  # pragma: no cover
    mutagen = None

_JUNK_COMMENT_RE = re.compile(
    r"(https?://\S+|www\.\S+|\b\S+\.(com|net|org|ru|tk)\b|"
    r"downloaded\s+(from|with|by)[^\n]*|converted\s+(by|with)[^\n]*|"
    r"\b(mediahuman|y2mate|ytmp3|savefrom|mp3juices|flvto|onlinevideoconverter|4k\s*video\s*downloader)\b\S*)",
    re.I,
)


def split_comment(comment: str):
    """Yorumu parçalar: (kendi_notun, mik_ton, mik_enerji)."""
    if not comment:
        return "", "", None
    mk, me = keys.parse_mik_comment(comment)
    note = keys.MIK_RE.sub(" ", comment)
    note = _JUNK_COMMENT_RE.sub(" ", note)
    note = re.sub(r"\s+", " ", note).strip(" -–—|,;/.")
    if note and re.fullmatch(r"[\W_]+", note):
        note = ""
    return note, mk, me


# ---------------------------------------------------------------------------
# Serato Markers2
# ---------------------------------------------------------------------------
def _b64(data: bytes) -> bytes:
    s = re.sub(rb"[^A-Za-z0-9+/]", b"", data)
    if len(s) % 4 == 1:
        s += b"A"
    s += b"=" * (-len(s) % 4)
    return base64.b64decode(s)


def parse_markers2(geob: bytes):
    """GEOB 'Serato Markers2' içeriğini çözer -> dict(cues, loops, color, bpmlock)."""
    res = {"cues": [], "loops": [], "color": None, "bpmlock": None}
    if not geob or len(geob) < 4:
        return res
    body = geob[2:] if geob[:2] == b"\x01\x01" else geob
    body = body.split(b"\x00", 1)[0]
    try:
        raw = _b64(body)
    except Exception:
        return res
    if raw[:2] == b"\x01\x01":
        raw = raw[2:]
    i = 0
    for _ in range(500):
        if i >= len(raw):
            break
        j = raw.find(b"\x00", i)
        if j < 0:
            break
        name = raw[i:j].decode("ascii", "replace")
        if not name:
            break
        if j + 5 > len(raw):
            break
        ln = struct.unpack(">I", raw[j + 1:j + 5])[0]
        d = raw[j + 5:j + 5 + ln]
        i = j + 5 + ln
        try:
            if name == "CUE" and len(d) >= 13:
                pos = struct.unpack(">I", d[2:6])[0]
                color = "#%02x%02x%02x" % (d[7], d[8], d[9])
                label = d[12:].split(b"\x00", 1)[0].decode("utf-8", "replace")
                res["cues"].append({"i": d[1], "ms": pos, "color": color, "name": label})
            elif name == "LOOP" and len(d) >= 20:
                st, en = struct.unpack(">II", d[2:10])
                label = d[0x14:].split(b"\x00", 1)[0].decode("utf-8", "replace") if len(d) > 0x14 else ""
                res["loops"].append({"i": d[1], "start": st, "end": en, "name": label})
            elif name == "COLOR" and len(d) >= 4:
                res["color"] = "#%02x%02x%02x" % (d[1], d[2], d[3])
            elif name == "BPMLOCK" and len(d) >= 1:
                res["bpmlock"] = bool(d[0])
        except Exception:
            continue
    res["cues"].sort(key=lambda c: c["i"])
    return res


def _unwrap_serato_b64(value: bytes) -> bytes:
    """MP4/FLAC'taki çift base64 sarmalını açıp GEOB içeriğini döndürür."""
    try:
        raw = _b64(value)
    except Exception:
        return b""
    # application/octet-stream\0\0Serato Markers2\0<veri>
    parts = raw.split(b"\x00", 3)
    if len(parts) == 4 and parts[0].startswith(b"application"):
        return parts[3]
    return raw


# ---------------------------------------------------------------------------
# Yardımcılar
# ---------------------------------------------------------------------------
def _first(v):
    if v is None:
        return ""
    if isinstance(v, (list, tuple)):
        for x in v:
            s = _first(x)
            if s:
                return s
        return ""
    if isinstance(v, bytes):
        try:
            return v.decode("utf-8").strip("\x00 ").strip()
        except UnicodeDecodeError:
            return v.decode("latin-1").strip("\x00 ").strip()
    return str(v).strip()


def _num(v):
    try:
        s = _first(v).replace(",", ".")
        m = re.search(r"\d+(\.\d+)?", s)
        return float(m.group(0)) if m else None
    except Exception:
        return None


def _year(v):
    s = _first(v)
    m = re.search(r"(19|20)\d\d", s)
    return int(m.group(0)) if m else None


def _popm_stars(val):
    if val is None:
        return None
    if val <= 0:
        return 0
    if val < 32:
        return 1
    if val < 96:
        return 2
    if val < 160:
        return 3
    if val < 224:
        return 4
    return 5


def _empty():
    return {
        "title": "", "artist": "", "album": "", "genre": "", "comment": "", "grouping": "",
        "bpm": None, "key_raw": "", "year": None, "label": "", "composer": "", "remixer": "",
        "rating": None, "track_no": None, "has_art": 0,
        "duration": None, "bitrate": None, "sample_rate": None, "channels": None, "bits": None,
        "codec": "", "serato_analyzed": 0, "serato_beatgrid": 0, "markers": None, "error": "",
    }


# ---------------------------------------------------------------------------
# Biçime özel okuyucular
# ---------------------------------------------------------------------------
def _read_id3(tags, out):
    if tags is None:
        return
    g = tags.getall
    def txt(fid):
        fr = tags.get(fid)
        return _first(fr.text) if fr is not None and hasattr(fr, "text") else ""
    out["title"] = txt("TIT2")
    out["artist"] = txt("TPE1")
    out["album"] = txt("TALB")
    tcon = tags.get("TCON")
    if tcon is not None:
        try:
            out["genre"] = ", ".join(x for x in tcon.genres if x)
        except Exception:
            out["genre"] = _first(tcon.text)
    out["grouping"] = txt("TIT1") or txt("GRP1")
    out["bpm"] = _num(txt("TBPM"))
    out["key_raw"] = txt("TKEY")
    out["year"] = _year(txt("TDRC") or txt("TYER") or txt("TDOR"))
    out["label"] = txt("TPUB")
    out["composer"] = txt("TCOM")
    out["remixer"] = txt("TPE4")
    trck = txt("TRCK")
    if trck:
        m = re.match(r"\d+", trck)
        out["track_no"] = int(m.group(0)) if m else None
    comments = []
    for fr in g("COMM"):
        desc = (fr.desc or "")
        if desc.lower().startswith("itun") or desc.lower() in ("songs-db_custom1",):
            continue
        t = _first(fr.text)
        if t and t not in comments:
            comments.append(t)
    out["comment"] = " | ".join(comments)
    pop = [fr.rating for fr in g("POPM") if getattr(fr, "rating", None) is not None]
    if pop:
        out["rating"] = _popm_stars(max(pop))
    out["has_art"] = 1 if g("APIC") else 0
    for fr in g("GEOB"):
        d = (fr.desc or "")
        if d == "Serato Markers2":
            out["markers"] = parse_markers2(fr.data)
        elif d == "Serato Analysis":
            out["serato_analyzed"] = 1
        elif d == "Serato BeatGrid":
            out["serato_beatgrid"] = 1


def _read_mp4(tags, out):
    if tags is None:
        return
    def t(k):
        return _first(tags.get(k))
    out["title"] = t("\xa9nam")
    out["artist"] = t("\xa9ART")
    out["album"] = t("\xa9alb")
    out["genre"] = t("\xa9gen")
    out["comment"] = t("\xa9cmt")
    out["grouping"] = t("\xa9grp")
    tm = tags.get("tmpo")
    if tm:
        try:
            out["bpm"] = float(tm[0])
        except Exception:
            pass
    for k in ("----:com.apple.iTunes:initialkey", "----:com.apple.iTunes:KEY", "----:com.apple.iTunes:Key"):
        if k in tags:
            out["key_raw"] = _first(tags[k])
            break
    if out["bpm"] is None and "----:com.apple.iTunes:BPM" in tags:
        out["bpm"] = _num(tags["----:com.apple.iTunes:BPM"])
    out["year"] = _year(t("\xa9day"))
    out["composer"] = t("\xa9wrt")
    for k in ("----:com.apple.iTunes:LABEL", "----:com.apple.iTunes:publisher"):
        if k in tags:
            out["label"] = _first(tags[k])
    trkn = tags.get("trkn")
    if trkn:
        try:
            out["track_no"] = int(trkn[0][0])
        except Exception:
            pass
    out["has_art"] = 1 if tags.get("covr") else 0
    mv2 = tags.get("----:com.serato.dj:markersv2")
    if mv2:
        out["markers"] = parse_markers2(_unwrap_serato_b64(bytes(mv2[0])))
    if tags.get("----:com.serato.dj:analysisVersion"):
        out["serato_analyzed"] = 1
    if tags.get("----:com.serato.dj:beatgrid"):
        out["serato_beatgrid"] = 1


def _read_vorbis(tags, out, pictures=None):
    if tags is None:
        return
    def t(*ks):
        for k in ks:
            try:
                v = tags.get(k)
            except Exception:
                v = None
            if v:
                return _first(v)
        return ""
    out["title"] = t("title", "TITLE")
    out["artist"] = t("artist", "ARTIST")
    out["album"] = t("album", "ALBUM")
    out["genre"] = t("genre", "GENRE")
    out["comment"] = t("comment", "COMMENT", "description", "DESCRIPTION")
    out["grouping"] = t("grouping", "GROUPING")
    out["bpm"] = _num(t("bpm", "BPM", "tempo"))
    out["key_raw"] = t("initialkey", "INITIALKEY", "key", "KEY")
    out["year"] = _year(t("date", "DATE", "year", "YEAR"))
    out["label"] = t("label", "LABEL", "organization", "ORGANIZATION", "publisher")
    out["composer"] = t("composer", "COMPOSER")
    out["remixer"] = t("remixer", "REMIXER", "mixartist")
    tn = t("tracknumber", "TRACKNUMBER")
    if tn:
        m = re.match(r"\d+", tn)
        out["track_no"] = int(m.group(0)) if m else None
    if pictures:
        out["has_art"] = 1
    elif t("metadata_block_picture", "METADATA_BLOCK_PICTURE"):
        out["has_art"] = 1
    mv2 = t("serato_markers_v2", "SERATO_MARKERS_V2")
    if mv2:
        out["markers"] = parse_markers2(_unwrap_serato_b64(mv2.encode("ascii", "ignore")))
    if t("serato_analysis", "SERATO_ANALYSIS"):
        out["serato_analyzed"] = 1
    if t("serato_beatgrid", "SERATO_BEATGRID"):
        out["serato_beatgrid"] = 1


def _fill_info(info, out):
    if info is None:
        return
    try:
        out["duration"] = float(getattr(info, "length", 0) or 0) or None
    except Exception:
        pass
    br = getattr(info, "bitrate", None)
    if br:
        out["bitrate"] = int(round(br / 1000.0))
    out["sample_rate"] = getattr(info, "sample_rate", None)
    out["channels"] = getattr(info, "channels", None)
    out["bits"] = getattr(info, "bits_per_sample", None)
    codec = getattr(info, "codec", None) or type(info).__name__.replace("Info", "").replace("Stream", "")
    out["codec"] = str(codec)


def read(path: str, ext: str):
    """Bir ses dosyasının etiketlerini okur. Hiçbir zaman hata fırlatmaz."""
    out = _empty()
    if mutagen is None:
        out["error"] = "mutagen yüklenemedi"
        return out
    ext = ext.lower()
    try:
        mf = mutagen.File(path)
    except Exception as e:  # bozuk dosya
        out["error"] = "okunamadı: %s" % (str(e)[:120] or type(e).__name__)
        mf = None
    if mf is None:
        if not out["error"]:
            out["error"] = "tanınmayan ses biçimi"
        if ext in (".mp3", ".aac"):
            try:
                _read_id3(ID3(path), out)
            except Exception:
                pass
        return out
    try:
        _fill_info(getattr(mf, "info", None), out)
        name = type(mf).__name__
        tags = getattr(mf, "tags", None)
        if name in ("MP4", "EasyMP4"):
            _read_mp4(tags, out)
        elif name in ("FLAC",):
            _read_vorbis(tags, out, getattr(mf, "pictures", None))
        elif name.startswith("Ogg") or name in ("OggVorbis", "OggOpus", "OggFLAC"):
            _read_vorbis(tags, out)
        elif tags is not None and hasattr(tags, "getall"):
            _read_id3(tags, out)  # MP3, WAVE, AIFF (ID3 içerir)
        elif tags is not None:
            _read_vorbis(tags, out)
        if ext == ".aac" and not out["title"]:
            try:
                _read_id3(ID3(path), out)
            except Exception:
                pass
    except Exception as e:
        out["error"] = "etiket hatası: %s" % (str(e)[:120] or type(e).__name__)
    if not out["duration"]:
        out["error"] = out["error"] or "süre okunamadı (bozuk olabilir)"
    return out
