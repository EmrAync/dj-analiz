"""Genel yardımcılar."""
from __future__ import annotations

import datetime as _dt
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time

IS_WIN = sys.platform.startswith("win")
IS_MAC = sys.platform == "darwin"


def now() -> int:
    return int(time.time())


def stamp() -> str:
    return _dt.datetime.now().strftime("%Y-%m-%d_%H%M%S")


def human_size(n) -> str:
    if n is None:
        return ""
    n = float(n)
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if n < 1024 or unit == "TB":
            return ("%.0f %s" if unit in ("B", "KB") else "%.1f %s") % (n, unit)
        n /= 1024.0
    return str(n)


def fmt_dur(sec) -> str:
    if not sec:
        return ""
    sec = int(round(sec))
    h, r = divmod(sec, 3600)
    m, s = divmod(r, 60)
    return ("%d:%02d:%02d" % (h, m, s)) if h else ("%d:%02d" % (m, s))


def atomic_write_bytes(path: str, data: bytes):
    """Önce geçici dosyaya yazar, sonra yerine koyar (yarım yazılmış dosya kalmaz)."""
    d = os.path.dirname(path) or "."
    os.makedirs(d, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=".djd_tmp_", dir=d)
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
            f.flush()
            try:
                os.fsync(f.fileno())
            except OSError:
                pass
        os.replace(tmp, path)
    except BaseException:
        try:
            os.remove(tmp)
        except OSError:
            pass
        raise


def atomic_write_text(path: str, text: str):
    atomic_write_bytes(path, text.encode("utf-8"))


def unique_path(path: str) -> str:
    """Dosya varsa sonuna _2, _3 … ekler (aynı saniyede alınan yedekler birbirinin üzerine yazmasın)."""
    if not os.path.exists(path):
        return path
    base, ext = os.path.splitext(path)
    k = 2
    while os.path.exists("%s_%d%s" % (base, k, ext)):
        k += 1
    return "%s_%d%s" % (base, k, ext)


QDIR = "_DJDoktor_Karantina"


def quarantine_dir(root: str, label: str) -> str:
    """Müzik diskinin kökünde karantina alt klasörü (taşımalar aynı diskte kalır)."""
    p = os.path.join(root, QDIR, stamp() + "_" + label)
    os.makedirs(p, exist_ok=True)
    return p


def move_file(src: str, dst: str) -> str:
    """Dosyayı taşır. Aynı diskte yeniden adlandırır; farklı diskteyse kopyalar,
    boyutunu doğrular, ancak ondan sonra kaynağı kaldırır. Hedef varsa ' (2)' ekler."""
    if os.path.exists(dst):
        base, ext = os.path.splitext(dst)
        k = 2
        while os.path.exists("%s (%d)%s" % (base, k, ext)):
            k += 1
        dst = "%s (%d)%s" % (base, k, ext)
    os.makedirs(os.path.dirname(dst) or ".", exist_ok=True)
    try:
        os.rename(src, dst)
    except OSError:
        if not os.path.exists(src) or os.path.exists(dst):
            raise
        shutil.copy2(src, dst)
        if os.path.getsize(dst) != os.path.getsize(src):
            os.remove(dst)
            raise OSError("Kopya doğrulanamadı: %s" % src)
        os.remove(src)
    return dst


def read_json(path: str, default=None):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def write_json(path: str, obj):
    atomic_write_text(path, json.dumps(obj, ensure_ascii=False, indent=2))


def free_space(path: str):
    try:
        return shutil.disk_usage(path).free
    except OSError:
        return None


def open_in_file_manager(path: str, select: bool = False) -> bool:
    """Dosyayı/klasörü Gezgin'de veya Finder'da gösterir."""
    try:
        if IS_WIN:
            if select and os.path.exists(path):
                subprocess.Popen(["explorer", "/select,", os.path.normpath(path)])
            else:
                os.startfile(os.path.normpath(path if os.path.isdir(path) else os.path.dirname(path)))  # type: ignore[attr-defined]
        elif IS_MAC:
            if select and os.path.exists(path):
                subprocess.Popen(["open", "-R", path])
            else:
                subprocess.Popen(["open", path if os.path.isdir(path) else os.path.dirname(path)])
        else:
            subprocess.Popen(["xdg-open", path if os.path.isdir(path) else os.path.dirname(path)])
        return True
    except Exception:
        return False


def process_running(names) -> list:
    """Verilen adlardan çalışan süreçleri döndürür (Engine DJ / Serato açık mı?)."""
    found = []
    try:
        if IS_WIN:
            out = subprocess.run(["tasklist", "/FO", "CSV", "/NH"], capture_output=True, timeout=8,
                                 creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            text = out.stdout.decode("mbcs" if IS_WIN else "utf-8", "replace").lower()
        else:
            out = subprocess.run(["ps", "-axo", "comm"], capture_output=True, timeout=8)
            text = out.stdout.decode("utf-8", "replace").lower()
        for n in names:
            if n.lower() in text:
                found.append(n)
    except Exception:
        pass
    return found


def list_drives():
    """Klasör seçici için kök konumlar."""
    res = []
    home = os.path.expanduser("~")
    res.append({"label": "Ev klasörü", "path": home})
    desk = os.path.join(home, "Desktop")
    if os.path.isdir(desk):
        res.append({"label": "Masaüstü", "path": desk})
    if IS_WIN:
        import string
        try:
            import ctypes
            k32 = ctypes.windll.kernel32  # type: ignore[attr-defined]
            # boş kart okuyucu vb. için "Sürücüde disk yok" pencerelerini bastır
            k32.SetErrorMode(0x0001 | 0x8000)
            mask = k32.GetLogicalDrives()
            for i, letter in enumerate(string.ascii_uppercase):
                if mask & (1 << i):
                    p = letter + ":\\"
                    dtype = k32.GetDriveTypeW(ctypes.c_wchar_p(p))
                    if dtype == 1:          # kök yok
                        continue
                    # ağ (4) ve CD (5) sürücülerini sorgulama: bağlantı kopuksa uzun süre bekletir
                    label = volume_label(p) if dtype in (2, 3, 6) else ""
                    if dtype == 4:
                        label = "Ağ sürücüsü"
                    res.append({"label": (label + " (" + letter + ":)") if label else (letter + ":"), "path": p})
        except Exception:
            for letter in "CDEFGHIJ":
                p = letter + ":\\"
                if os.path.exists(p):
                    res.append({"label": letter + ":", "path": p})
    elif IS_MAC:
        try:
            for n in sorted(os.listdir("/Volumes")):
                res.append({"label": n, "path": os.path.join("/Volumes", n)})
        except OSError:
            pass
    else:
        for base in ("/media", "/mnt", "/run/media"):
            try:
                for n in sorted(os.listdir(base)):
                    p = os.path.join(base, n)
                    if os.path.isdir(p):
                        res.append({"label": n, "path": p})
            except OSError:
                pass
    return res


def volume_label(path: str) -> str:
    if not IS_WIN:
        return ""
    try:
        import ctypes
        buf = ctypes.create_unicode_buffer(261)
        fs = ctypes.create_unicode_buffer(261)
        ok = ctypes.windll.kernel32.GetVolumeInformationW(  # type: ignore[attr-defined]
            ctypes.c_wchar_p(path), buf, 261, None, None, None, fs, 261)
        return buf.value if ok else ""
    except Exception:
        return ""


def fs_type(path: str) -> str:
    """Kökün dosya sistemi: 'exfat', 'msdos', 'ntfs', 'apfs', 'hfs', ... (bilinmiyorsa '')."""
    try:
        if IS_WIN:
            import ctypes
            drive = os.path.splitdrive(os.path.abspath(path))[0] + "\\"
            name = ctypes.create_unicode_buffer(261)
            fs = ctypes.create_unicode_buffer(261)
            ok = ctypes.windll.kernel32.GetVolumeInformationW(  # type: ignore[attr-defined]
                ctypes.c_wchar_p(drive), name, 261, None, None, None, fs, 261)
            return fs.value.lower() if ok else ""
        out = subprocess.run(["mount"], capture_output=True, timeout=8).stdout.decode("utf-8", "replace")
        best, best_len = "", -1
        ap = os.path.realpath(path)
        for line in out.splitlines():
            # macOS: /dev/disk4s1 on /Volumes/Serato DJ (exfat, local, ...)
            # Linux: /dev/sdb1 on /media/x type exfat (rw,...)
            if " on " not in line:
                continue
            rest = line.split(" on ", 1)[1]
            if IS_MAC and " (" in rest:
                mnt, opts = rest.rsplit(" (", 1)
                typ = opts.split(",")[0].strip(" )")
            elif " type " in rest:
                mnt, rest2 = rest.split(" type ", 1)
                typ = rest2.split(" ")[0]
            else:
                continue
            if (ap == mnt or ap.startswith(mnt.rstrip("/") + "/")) and len(mnt) > best_len:
                best, best_len = typ.lower(), len(mnt)
        return best
    except Exception:
        return ""


def is_fat_like(fstype: str) -> bool:
    return fstype in ("exfat", "msdos", "fat", "fat32", "vfat", "fat16")
