"""Çalışma alanı, ayarlar ve kütüphane kayıtları.

Bilgisayardaki çalışma alanında yalnızca ayarlar ve günlük durur:
  Windows/Mac: Belgeler/DJ Doktor
(Katalog, yedekler ve karantina SSD'dedir: _DJDoktor_/. v1'in 'DJ Kutuphane Doktoru' klasörüne dokunulmaz.)
Programın yanına 'portable.txt' konursa çalışma alanı programın yanında açılır.
"""
from __future__ import annotations

import hashlib
import os
import re
import sys
import threading

from . import util

DEFAULT_PREFS = {
    "serato_dialect": "auto",            # auto | mac | windows
    "theme": "light",                    # light | dark
    "text_size": "normal",               # normal | large
    "extra_excludes": [],
    "lowbitrate_kbps": 192,
    "long_path_limit": 240,
    # v2
    "inbox_dir": "",                     # boşsa: Müzik/DJ Gelen (bu bilgisayarda)
    "archive_dir": "",                   # boşsa: Müzik/DJ Arşiv (bu bilgisayarda)
    "auto_inbox": True,                  # gelen kutusunu kendiliğinden işle
    "watch_downloads": True,             # İndirilenler'deki unutulan şarkıları göster
    "genre_lists": True,                 # Engine'de 'Türler' listelerini tut
}

BUILTIN_EXCLUDES = {
    "_serato_", "_serato_backup", "$recycle.bin", "system volume information", ".trashes",
    ".spotlight-v100", ".fseventsd", ".temporaryitems", ".documentrevisions-v100",
    "_djdoktor_", "_djdoktor_karantina", ".trash", "recycler",
}
# Engine Library içinden yalnızca Music (Engine'in kendi kopyaları) taranır
ENGINE_LIB_DIR = "engine library"


def app_dir() -> str:
    if getattr(sys, "frozen", False):
        return os.path.dirname(sys.executable)
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def workspace_dir() -> str:
    env = os.environ.get("DJDOKTOR_HOME")
    if env:
        p = env
    elif os.path.exists(os.path.join(app_dir(), "portable.txt")):
        p = os.path.join(app_dir(), "Calisma_Alani")
    else:
        home = os.path.expanduser("~")
        docs = os.path.join(home, "Documents")
        base = docs if os.path.isdir(docs) else home
        p = os.path.join(base, "DJ Doktor")   # v1'in klasöründen ayrı: v1 ayarları olduğu gibi kalır
    os.makedirs(p, exist_ok=True)
    for sub in ("gunluk",):
        os.makedirs(os.path.join(p, sub), exist_ok=True)
    return p


def slugify(s: str) -> str:
    from .names import fold
    s = fold(s)
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s[:40] or "kutuphane"


class Settings:
    def __init__(self):
        self.lock = threading.RLock()
        self.ws = workspace_dir()
        self.path = os.path.join(self.ws, "ayarlar.json")
        data = util.read_json(self.path, {}) or {}
        self.data = {
            "version": 2,
            "libraries": data.get("libraries", []),
            "active": data.get("active"),
            "prefs": dict(DEFAULT_PREFS, **(data.get("prefs") or {})),
        }

    def save(self):
        with self.lock:
            util.write_json(self.path, self.data)

    # --- kütüphaneler ---------------------------------------------------
    def libraries(self):
        return list(self.data["libraries"])

    def get_library(self, lib_id):
        for l in self.data["libraries"]:
            if l["id"] == lib_id:
                return l
        return None

    def active_library(self):
        lib = self.get_library(self.data.get("active"))
        if lib is None and self.data["libraries"]:
            lib = self.data["libraries"][0]
        return lib

    def add_library(self, root: str, name: str = "", shared_catalog: bool = True, readonly: bool = False):
        root = os.path.abspath(root)
        with self.lock:
            for l in self.data["libraries"]:
                if os.path.normcase(l["root"]) == os.path.normcase(root):
                    self.data["active"] = l["id"]
                    self.save()
                    return l
            base = name or os.path.basename(root.rstrip("\\/")) or root
            lid = slugify(base) + "-" + hashlib.sha1(root.encode("utf-8")).hexdigest()[:6]
            if shared_catalog:
                cat = os.path.join(root, "_DJDoktor_", "katalog.db")
            else:
                cat = os.path.join(self.ws, "kutuphaneler", lid, "katalog.db")
            lib = {
                "id": lid, "name": name or base, "root": root, "catalog": cat,
                "shared_catalog": bool(shared_catalog), "readonly": bool(readonly),
                "created": util.now(), "v": 2,
            }
            self.data["libraries"].append(lib)
            self.data["active"] = lid
            self.save()
            return lib

    def update_library(self, lib_id, **kw):
        with self.lock:
            lib = self.get_library(lib_id)
            if not lib:
                return None
            lib.update(kw)
            self.save()
            return lib

    def remove_library(self, lib_id):
        with self.lock:
            self.data["libraries"] = [l for l in self.data["libraries"] if l["id"] != lib_id]
            if self.data.get("active") == lib_id:
                self.data["active"] = self.data["libraries"][0]["id"] if self.data["libraries"] else None
            self.save()

    def set_active(self, lib_id):
        with self.lock:
            if self.get_library(lib_id):
                self.data["active"] = lib_id
                self.save()

    # --- tercihler --------------------------------------------------------
    def prefs(self):
        return dict(self.data["prefs"])

    def set_prefs(self, **kw):
        with self.lock:
            for k, v in kw.items():
                if k in DEFAULT_PREFS:
                    self.data["prefs"][k] = v
            self.save()

    def upgrade_library(self, lib_id):
        """v1 kaydı: katalog bilgisayardaydı. v2'de katalog SSD'de (_DJDoktor_/katalog.db) durur ki
        Mac ve PC aynı bilgiyi görsün. Eski katalog dosyasına dokunulmaz."""
        with self.lock:
            lib = self.get_library(lib_id)
            if not lib or lib.get("v") == 2:
                return lib
            lib["catalog_v1"] = lib.get("catalog")
            lib["catalog"] = os.path.join(lib["root"], "_DJDoktor_", "katalog.db")
            lib["shared_catalog"] = True
            lib["readonly"] = False
            lib["v"] = 2
            self.save()
            return lib

    def relocate_library(self, lib_id, new_root):
        """SSD başka bir sürücü harfi / bağlama noktasıyla takıldı."""
        with self.lock:
            lib = self.get_library(lib_id)
            if not lib:
                return None
            lib["root"] = os.path.abspath(new_root)
            lib["catalog"] = os.path.join(lib["root"], "_DJDoktor_", "katalog.db")
            self.save()
            return lib

    def backup_dir(self, lib_id: str, kind: str) -> str:
        p = os.path.join(self.ws, "yedekler", lib_id, kind)
        os.makedirs(p, exist_ok=True)
        return p

    def export_dir(self, lib_id: str, kind: str) -> str:
        p = os.path.join(self.ws, "disari_aktarim", lib_id, kind)
        os.makedirs(p, exist_ok=True)
        return p
