"""Eklenti rotaları: yeni özellik modülleri kendi API rotalarını burada kaydeder (server.py'yi büyütmeden).

Kullanım (bir özellik modülünde):

    from .ext import route

    @route("assistant")                      # /api/assistant/...
    def _api(h, lib, method, parts, qs, body):
        if parts[1:] == ["wheel"]:
            return h._json(...)
        return None                          # bu modül bu isteği işlemedi -> 404

    @route("app", needs_lib=False)           # kütüphane seçilmeden de çalışan rotalar (lib=None gelir)

h: server.Handler (h._json, h._task, h._err); parts[0] rota adıdır. Var olan çekirdek rotalar önce denenir.
"""
from __future__ import annotations

import importlib

ROUTES = {}
# yüklenecek özellik modülleri (dosya yoksa sessizce atlanır)
MODULES = ("renamer", "assistant", "ai", "desktop", "browse")
_loaded = False


def route(name, needs_lib=True):
    def deco(fn):
        ROUTES[name] = (fn, needs_lib)
        return fn
    return deco


def load():
    global _loaded
    if _loaded:
        return
    _loaded = True
    for m in MODULES:
        try:
            importlib.import_module("djdoktor." + m)
        except ModuleNotFoundError as e:
            if e.name != "djdoktor." + m:
                raise


def get(name):
    load()
    return ROUTES.get(name)
