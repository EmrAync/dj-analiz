"""Yerel web sunucusu: arayüzü tarayıcıda açar. Yalnızca bu bilgisayardan (127.0.0.1) erişilebilir."""
from __future__ import annotations

import json
import mimetypes
import os
import re
import secrets
import sys
import threading
import traceback
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from . import APP_ID, APP_NAME, VERSION, exporters, names, ops, report, sync, util
from .config import Settings, app_dir
from .service import Library, UserError
from .tasks import TaskManager

WEB_DIR = os.path.join(app_dir(), "web")


class App:
    def __init__(self):
        self.settings = Settings()
        self.token = secrets.token_urlsafe(24)
        self.log_path = os.path.join(self.settings.ws, "gunluk", "djdoktor.log")
        self.tasks = TaskManager(log=self.log)
        self._lib = None
        self._lib_lock = threading.RLock()
        self.port = None

    def log(self, text):
        try:
            with open(self.log_path, "a", encoding="utf-8") as f:
                f.write("[%s] %s\n" % (util.stamp(), text))
        except OSError:
            pass

    def lib(self, required=True):
        with self._lib_lock:
            rec = self.settings.active_library()
            if rec is None:
                if required:
                    raise UserError("Henüz bir müzik kütüphanesi eklenmedi.")
                return None
            if self._lib is None or self._lib.id != rec["id"]:
                if self._lib is not None:
                    self._lib.catalog.close()
                self._lib = Library(self.settings, rec)
            return self._lib

    def reset_lib(self):
        with self._lib_lock:
            if self._lib is not None:
                self._lib.catalog.close()
            self._lib = None


def _clean(obj):
    if isinstance(obj, dict):
        return {k: _clean(v) for k, v in obj.items() if not str(k).startswith("_")}
    if isinstance(obj, list):
        return [_clean(x) for x in obj]
    return obj


class Handler(BaseHTTPRequestHandler):
    server_version = "DJDoktor/" + VERSION
    app: App = None  # atanır

    def log_message(self, fmt, *args):  # konsolu kirletme
        pass

    # ---------------------------------------------------------------
    def _host_ok(self):
        host = (self.headers.get("Host") or "").split(":")[0]
        return host in ("127.0.0.1", "localhost", "[::1]")

    def _send(self, code, body: bytes, ctype="application/json; charset=utf-8", extra=None):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            try:
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError):
                pass

    def _json(self, obj, code=200):
        self._send(code, json.dumps(_clean(obj), ensure_ascii=False, default=str).encode("utf-8"))

    def _err(self, msg, code=400):
        self._json({"error": msg}, code)

    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n <= 0:
            return {}
        raw = self.rfile.read(n)
        try:
            return json.loads(raw.decode("utf-8"))
        except ValueError:
            return {}

    # ---------------------------------------------------------------
    def do_GET(self):
        self._dispatch("GET")

    def do_HEAD(self):
        self._dispatch("GET")

    def do_POST(self):
        self._dispatch("POST")

    def _dispatch(self, method):
        if not self._host_ok():
            return self._err("Erişim reddedildi", 403)
        u = urllib.parse.urlsplit(self.path)
        path = urllib.parse.unquote(u.path)
        qs = dict(urllib.parse.parse_qsl(u.query))
        try:
            if path == "/api/ping":
                return self._json({"app": APP_ID, "version": VERSION})
            if path.startswith("/api/"):
                if path.startswith("/api/audio/"):
                    if qs.get("t") != self.app.token:
                        return self._err("Yetkisiz", 401)
                elif self.headers.get("X-DJD-Token") != self.app.token:
                    return self._err("Yetkisiz", 401)
                return self._api(method, path[5:], qs)
            if path in ("/", "/index.html"):
                return self._index()
            if path.startswith("/print/event/") or path == "/report":
                if qs.get("t") != self.app.token:
                    return self._err("Yetkisiz", 401)
                if path == "/report":
                    return self._send(200, report.build(self.app.lib()).encode("utf-8"), "text/html; charset=utf-8")
                eid = int(path.rsplit("/", 1)[1])
                return self._send(200, exporters.event_print_html(self.app.lib(), eid).encode("utf-8"),
                                  "text/html; charset=utf-8")
            return self._static(path)
        except UserError as e:
            return self._err(str(e), 400)
        except Exception as e:
            self.app.log(traceback.format_exc())
            return self._err("Beklenmeyen hata: %s" % e, 500)

    def _index(self):
        p = os.path.join(WEB_DIR, "index.html")
        html = open(p, "r", encoding="utf-8").read().replace("{{TOKEN}}", self.app.token).replace("{{VERSION}}", VERSION)
        self._send(200, html.encode("utf-8"), "text/html; charset=utf-8")

    def _static(self, path):
        rel = path.lstrip("/")
        full = os.path.normpath(os.path.join(WEB_DIR, rel))
        if not full.startswith(os.path.normpath(WEB_DIR)) or not os.path.isfile(full):
            return self._err("Bulunamadı", 404)
        ctype = mimetypes.guess_type(full)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype in ("application/javascript",):
            ctype += "; charset=utf-8"
        with open(full, "rb") as f:
            self._send(200, f.read(), ctype)

    def _audio(self, fid):
        lib = self.app.lib()
        f = lib.catalog.file(fid)
        if not f:
            return self._err("Bulunamadı", 404)
        p = lib.rootinfo.os_path(f["rel"], f.get("os_rel"))
        if not os.path.isfile(p):
            return self._err("Dosya yok", 404)
        size = os.path.getsize(p)
        ctype = {".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".aac": "audio/aac", ".wav": "audio/wav",
                 ".flac": "audio/flac", ".aif": "audio/aiff", ".aiff": "audio/aiff", ".ogg": "audio/ogg",
                 ".mp4": "audio/mp4", ".alac": "audio/mp4"}.get(f["ext"], "application/octet-stream")
        rng = self.headers.get("Range")
        start, end = 0, size - 1
        code = 200
        if rng:
            m = re.match(r"bytes=(\d*)-(\d*)", rng)
            if m:
                if m.group(1):
                    start = int(m.group(1))
                    if m.group(2):
                        end = min(int(m.group(2)), size - 1)
                elif m.group(2):
                    start = max(0, size - int(m.group(2)))
                code = 206
        if start > end:
            self.send_response(416)
            self.send_header("Content-Range", "bytes */%d" % size)
            self.end_headers()
            return
        length = end - start + 1
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(length))
        if code == 206:
            self.send_header("Content-Range", "bytes %d-%d/%d" % (start, end, size))
        self.end_headers()
        if self.command == "HEAD":
            return
        try:
            with open(p, "rb") as fh:  # yalnızca okuma
                fh.seek(start)
                remaining = length
                while remaining > 0:
                    chunk = fh.read(min(262144, remaining))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    remaining -= len(chunk)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass

    # ---------------------------------------------------------------
    def _task(self, kind, title, fn):
        tid = self.app.tasks.submit(kind, title, fn)
        return self._json({"task": tid})

    def _api(self, method, route, qs):
        app = self.app
        parts = route.strip("/").split("/")
        body = self._body() if method == "POST" else {}
        r0 = parts[0]
        # ---------------- genel ----------------
        if r0 == "ping":
            return self._json({"app": APP_ID, "version": VERSION})
        if r0 == "state":
            lib = app.lib(required=False)
            return self._json({"app": APP_NAME, "version": VERSION, "workspace": app.settings.ws,
                               "libraries": app.settings.libraries(), "active": lib.info() if lib else None,
                               "prefs": app.settings.prefs(), "platform": sys.platform,
                               "tasks": app.tasks.active()})
        if r0 == "browse":
            return self._json(_browse(qs.get("path")))
        if r0 == "tasks":
            if len(parts) == 1:
                return self._json(app.tasks.active())
            if len(parts) == 3 and parts[2] == "cancel":
                return self._json({"ok": app.tasks.cancel(parts[1])})
            t = app.tasks.get(parts[1])
            return self._json(t) if t else self._err("Görev yok", 404)
        if r0 == "library":
            act = parts[1] if len(parts) > 1 else ""
            if act == "add":
                root = (body.get("root") or "").strip().strip('"')
                if not root or not os.path.isdir(root):
                    raise UserError("Klasör bulunamadı: %s" % root)
                app.reset_lib()
                rec = app.settings.add_library(root, body.get("name") or "", bool(body.get("shared")),
                                               bool(body.get("readonly", True)))
                return self._json({"library": rec})
            if act == "select":
                app.reset_lib()
                app.settings.set_active(body.get("id"))
                return self._json({"ok": True})
            if act == "remove":
                app.reset_lib()
                app.settings.remove_library(body.get("id"))
                return self._json({"ok": True})
            if act == "update":
                lib = app.lib()
                kw = {}
                if "readonly" in body:
                    kw["readonly"] = bool(body["readonly"])
                if body.get("name"):
                    kw["name"] = body["name"]
                app.settings.update_library(lib.id, **kw)
                return self._json({"ok": True, "library": app.settings.get_library(lib.id)})
        if r0 == "prefs" and method == "POST":
            app.settings.set_prefs(**body)
            return self._json(app.settings.prefs())
        if r0 == "open" and method == "POST":
            p = body.get("path") or ""
            lib = app.lib(required=False)
            allowed = [os.path.abspath(app.settings.ws)] + ([os.path.abspath(lib.root)] if lib else [])
            ap = os.path.abspath(p)
            if not any(os.path.normcase(ap).startswith(os.path.normcase(a)) for a in allowed):
                raise UserError("Bu konum açılamaz.")
            return self._json({"ok": util.open_in_file_manager(ap, bool(body.get("select")))})
        if r0 == "backups":
            out = []
            base = os.path.join(app.settings.ws, "yedekler")
            for root, _d, files in os.walk(base):
                for f in files:
                    full = os.path.join(root, f)
                    out.append({"path": full, "name": os.path.relpath(full, base), "size": os.path.getsize(full),
                                "mtime": int(os.path.getmtime(full))})
            out.sort(key=lambda x: -x["mtime"])
            return self._json({"items": out[:300], "count": len(out), "total": sum(x["size"] for x in out)})

        lib = app.lib()
        cat = lib.catalog
        # ---------------- tarama / analiz ----------------
        if r0 == "scan":
            return self._task("tarama", "Kütüphane taranıyor", lambda p, c: lib.full_scan(p, c))
        if r0 == "reanalyze":
            return self._task("analiz", "Analiz yenileniyor", lambda p, c: lib.reanalyze())
        if r0 == "overview":
            return self._json(lib.overview())
        if r0 == "tracks":
            return self._json(lib.tracks_payload())
        if r0 == "track":
            return self._json(lib.track_detail(int(parts[1])))
        if r0 == "audio":
            return self._audio(int(parts[1]))
        if r0 == "issues":
            return self._json(lib.issues())
        if r0 == "issue":
            return self._json(lib.issue_files(parts[1]))
        if r0 == "dupes":
            return self._json(lib.dupes())
        if r0 == "folders":
            return self._json(lib.folders())
        # ---------------- listeler ----------------
        if r0 == "lists":
            if len(parts) == 1:
                return self._json(lib.lists_tree())
            if parts[1] == "create":
                lid = cat.list_create(body.get("parent_id"), body.get("kind") or "list", body.get("title") or "Yeni liste",
                                      body.get("info") or {})
                return self._json({"id": lid})
            lid = int(parts[1])
            act = parts[2] if len(parts) > 2 else "items"
            if act == "items":
                return self._json(lib.list_items(lid))
            if act == "suggest":
                return self._json(lib.suggestions(lid))
            if act == "update":
                info = None
                if "info" in body:
                    cur = cat.list_get(lid)
                    info = dict(cur.get("info") or {}, **(body.get("info") or {}))
                cat.list_update(lid, title=body.get("title"), info=info,
                                parent_id=body["parent_id"] if "parent_id" in body else -1, pos=body.get("pos"))
                return self._json({"ok": True})
            if act == "delete":
                return self._json({"deleted": cat.list_delete(lid)})
            if act == "add":
                added, skipped = cat.items_add(lid, [int(x) for x in body.get("file_ids", [])], body.get("at"))
                return self._json({"added": added, "skipped": skipped})
            if act == "remove":
                cat.items_remove([int(x) for x in body.get("item_ids", [])])
                return self._json({"ok": True})
            if act == "reorder":
                cat.items_reorder(lid, [int(x) for x in body.get("item_ids", [])])
                return self._json({"ok": True})
            if act == "move-items":
                cat.items_move([int(x) for x in body.get("item_ids", [])], int(body["to"]))
                return self._json({"ok": True})
            if act == "duplicate":
                return self._json({"id": _duplicate_list(lib, lid)})
        if r0 == "items" and len(parts) == 3 and parts[2] == "note":
            cat.item_note(int(parts[1]), body.get("note") or "")
            return self._json({"ok": True})
        if r0 == "events":
            if parts[1] == "create":
                return self._json({"id": lib.create_event(body)})
            return self._json(lib.event_overview(int(parts[1])))
        if r0 == "templates":
            if len(parts) > 1 and parts[1] == "save":
                cat.template_save(body["kind"], body["title"], body.get("sections") or [])
            return self._json(cat.templates())
        if r0 == "gigcheck":
            return self._json(lib.gig_check(int(parts[1])))
        # ---------------- Engine / Serato ----------------
        if r0 == "engine":
            act = parts[1] if len(parts) > 1 else ""
            if not act:
                return self._json(sync.engine_status(lib))
            key = body.get("key") or qs.get("key") or "drive"
            if act == "repair-plan":
                return self._json(sync.engine_repair_plan(lib, key))
            if act == "repair":
                return self._task("engine", "Engine yol onarımı", lambda p, c: sync.engine_repair_apply(lib, key, p))
            if act == "sync":
                return self._task("engine", "Engine'e listeler gönderiliyor", lambda p, c: sync.engine_sync(lib, key, p))
            if act == "import":
                return self._json(sync.engine_import(lib, key, body.get("playlist_ids") or []))
        if r0 == "serato":
            act = parts[1] if len(parts) > 1 else ""
            if not act:
                return self._json(sync.serato_status(lib))
            if act == "export":
                return self._task("serato", "Serato'ya crate yazılıyor", lambda p, c: sync.serato_export(lib, p))
            if act == "import":
                return self._json(sync.serato_import(lib, body.get("crates") or []))
        # ---------------- dosya işlemleri ----------------
        if r0 == "plan":
            kind = parts[1]
            if kind == "junk":
                return self._json(ops.plan_junk(lib))
            if kind == "rename":
                return self._json(ops.plan_rename(lib, None, qs.get("emoji") == "1"))
            if kind == "dupes":
                return self._json(ops.plan_dupes(lib, body.get("selections") or []))
        if r0 == "ops":
            kind = parts[1]
            if kind == "junk":
                return self._task("dosya", "Çöp dosyalar karantinaya taşınıyor", lambda p, c: ops.apply_junk(lib, p))
            if kind == "rename":
                emoji = bool(body.get("emoji"))
                ids = body.get("file_ids")
                return self._task("dosya", "Adlar düzeltiliyor",
                                  lambda p, c: ops.apply_rename(lib, set(map(int, ids)) if ids else None, emoji, p))
            if kind == "dupes":
                sel = body.get("selections") or []
                return self._task("dosya", "Çiftler birleştiriliyor", lambda p, c: ops.apply_dupes(lib, sel, p))
        if r0 == "inbox":
            if parts[1] == "scan":
                src = body.get("source") or ""
                return self._task("gelen", "Yeni müzikler inceleniyor", lambda p, c: ops.inbox_scan(lib, src, p, c))
            if parts[1] == "import":
                b = body
                return self._task("gelen", "Yeni müzikler ekleniyor",
                                  lambda p, c: ops.inbox_import(lib, b.get("sources") or [], b.get("dest") or "",
                                                                b.get("keep_turkish", True), b.get("strip_emoji", True),
                                                                b.get("list_id"), p))
        if r0 == "undo":
            jid = int(body.get("journal_id"))
            force = bool(body.get("force"))
            return self._task("geri", "Geri alınıyor", lambda p, c: ops.undo(lib, jid, p, force=force))
        if r0 == "journal":
            return self._json(cat.journal())
        if r0 == "export":
            ids = body.get("list_ids") or []
            if not ids:
                raise UserError("Önce en az bir liste seçin.")
            if parts[1] == "rekordbox":
                return self._json(exporters.rekordbox_xml(lib, ids, bool(body.get("cues", True))))
            if parts[1] == "m3u":
                return self._json(exporters.m3u(lib, ids))
        if r0 == "report" and parts[1:] == ["save"]:
            return self._json({"path": report.save(lib)})
        return self._err("Bilinmeyen istek: %s" % route, 404)


def _duplicate_list(lib, lid):
    cat = lib.catalog
    src = cat.list_get(lid)

    def copy(node_id, parent):
        n = cat.list_get(node_id)
        title = n["title"] + (" (kopya)" if node_id == lid else "")
        new = cat.list_create(parent, n["kind"], title, n.get("info") or {})
        cat.items_add(new, cat.item_file_ids(node_id))
        for ch in cat.list_children(node_id):
            copy(ch["id"], new)
        return new
    return copy(lid, src.get("parent_id"))


def _browse(path):
    if not path:
        return {"path": "", "parent": None, "dirs": util.list_drives()}
    p = os.path.abspath(path)
    if not os.path.isdir(p):
        raise UserError("Klasör bulunamadı: %s" % p)
    dirs = []
    try:
        for e in sorted(os.scandir(p), key=lambda e: names.fold(e.name)):
            try:
                if e.is_dir() and not e.name.startswith(".") and not e.name.startswith("$"):
                    dirs.append({"label": names.display(e.name), "path": e.path})
            except OSError:
                pass
    except OSError as e:
        raise UserError("Klasör okunamadı: %s" % e)
    parent = os.path.dirname(p.rstrip("\\/"))
    if parent == p or not parent:
        parent = ""
    audio = 0
    try:
        audio = sum(1 for e in os.scandir(p) if e.is_file() and os.path.splitext(e.name)[1].lower() in names.AUDIO_EXTS)
    except OSError:
        pass
    return {"path": p, "parent": parent, "dirs": dirs, "audio_here": audio}


def run(port=8765, open_browser=True):
    app = App()
    Handler.app = app
    srv = None
    for p in [port] + list(range(port + 1, port + 30)):
        try:
            srv = ThreadingHTTPServer(("127.0.0.1", p), Handler)
            break
        except OSError:
            continue
    if srv is None:
        print("Boş port bulunamadı.")
        return
    srv.daemon_threads = True
    app.port = srv.server_address[1]
    url = "http://127.0.0.1:%d/" % app.port
    print("=" * 60)
    print(" %s %s" % (APP_NAME, VERSION))
    print(" Arayüz: %s" % url)
    print(" Çalışma alanı: %s" % app.settings.ws)
    print(" Kapatmak için bu pencereyi kapatın veya Ctrl+C'ye basın.")
    print("=" * 60)
    if open_browser:
        import webbrowser
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        srv.server_close()
