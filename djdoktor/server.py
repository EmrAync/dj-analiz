"""Yerel web sunucusu: arayüzü tarayıcıda açar. Yalnızca bu bilgisayardan (127.0.0.1) erişilebilir."""
from __future__ import annotations

import hashlib
import html
import json
import mimetypes
import os
import re
import secrets
import sys
import threading
import time
import traceback
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from . import (APP_ID, APP_NAME, VERSION, dedupe, engine, inbox, journal, lists, maintain, mirror, names, relocate,
               util)
from .config import Settings, app_dir
from .library import STATE_DIR, Library, UserError
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
        self.bg = {"engine_open": None, "serato_open": None, "last_scan": 0, "last_inbox": 0, "last_mirror": 0,
                   "events": []}
        self._stop = False

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
                    raise UserError("Henüz SSD seçilmedi.", "no_library")
                return None
            if rec.get("v") != 2:
                rec = self.settings.upgrade_library(rec["id"])
            if self._lib is None or self._lib.id != rec["id"] or self._lib.root != rec["root"]:
                if self._lib is not None:
                    self._lib.catalog.close()
                    self._lib = None
                if not os.path.isdir(rec["root"]):
                    if required:
                        raise UserError("SSD takılı değil (%s bulunamadı). SSD'yi takın ya da yeniden seçin."
                                        % rec["root"], "no_root")
                    return None
                self._lib = Library(self.settings, rec)
            return self._lib

    def reset_lib(self):
        with self._lib_lock:
            if self._lib is not None:
                self._lib.catalog.close()
            self._lib = None

    def note(self, text):
        self.bg["events"].append({"ts": time.time(), "text": text})
        self.bg["events"] = self.bg["events"][-20:]

    # ------------------------------------------------------------------
    # Arka plan: Engine/Serato kapanınca bakım, gelen kutusu, Serato aynası, ara tarama
    # ------------------------------------------------------------------
    def background_loop(self):
        while not self._stop:
            time.sleep(3)
            try:
                self._tick()
            except Exception:
                self.log(traceback.format_exc())

    def _tick(self):
        lib = self.lib(required=False)
        if lib is None or not self.tasks.idle():
            return
        if not lib.catalog.genres():
            return  # düzen kurulmadan otomatik hiçbir şey yapma
        now = time.time()
        eo, so = lib.engine_open(), lib.serato_open()
        was_eo, was_so = self.bg["engine_open"], self.bg["serato_open"]
        self.bg["engine_open"], self.bg["serato_open"] = eo, so
        if not lib.lock.acquire(blocking=False):
            return
        try:
            if was_eo and not eo:
                r = maintain.background(lib)
                if r and (r.get("added") or r.get("repaired") or r.get("relinked")):
                    self.note("Engine kapandı: kütüphane kontrol edildi")
            if was_so and not so:
                r = mirror.background(lib)
                if r and (r.get("pulled") or r.get("pushed")):
                    self.note("Serato kapandı: listeler eşitlendi")
            if now - self.bg["last_inbox"] > 4:
                self.bg["last_inbox"] = now
                r = inbox.auto_tick(lib)
                self.bg["inbox_wait"] = inbox.LAST.get("wait", 0)
                if r and r.get("added"):
                    self.note("%d yeni şarkı eklendi" % r["added"])
            if now - self.bg["last_mirror"] > 30 and not so:
                self.bg["last_mirror"] = now
                mirror.background(lib)
            if now - self.bg["last_scan"] > 240:
                self.bg["last_scan"] = now
                res = lib.full_scan()
                if res.get("read") or res.get("gone"):
                    maintain.background(lib)
        finally:
            lib.lock.release()


def _clean(obj):
    if isinstance(obj, dict):
        return {k: _clean(v) for k, v in obj.items() if not str(k).startswith("_")}
    if isinstance(obj, (list, tuple)):
        return [_clean(x) for x in obj]
    return obj


class Handler(BaseHTTPRequestHandler):
    server_version = "DJDoktor/" + VERSION
    app: App = None

    def log_message(self, fmt, *args):
        pass

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

    def _err(self, msg, code=400, ecode=None):
        self._json({"error": msg, "code": ecode}, code)

    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n <= 0:
            return {}
        raw = self.rfile.read(n)
        try:
            return json.loads(raw.decode("utf-8"))
        except ValueError:
            return {}

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
                if path.startswith("/api/audio/") or path.startswith("/api/print/"):
                    if qs.get("t") != self.app.token:
                        return self._err("Yetkisiz", 401)
                elif self.headers.get("X-DJD-Token") != self.app.token:
                    return self._err("Yetkisiz", 401)
                return self._api(method, path[5:], qs)
            if path in ("/", "/index.html"):
                return self._index()
            return self._static(path)
        except UserError as e:
            return self._err(str(e), 400, e.code)
        except journal.UndoNeedsForce as e:
            return self._err(str(e), 409, "needs_force")
        except Exception as e:
            self.app.log(traceback.format_exc())
            return self._err("Beklenmeyen hata: %s" % e, 500)

    def _index(self):
        p = os.path.join(WEB_DIR, "index.html")
        page = open(p, "r", encoding="utf-8").read().replace("{{TOKEN}}", self.app.token)
        page = page.replace("{{VERSION}}", VERSION)
        self._send(200, page.encode("utf-8"), "text/html; charset=utf-8")

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
            with open(p, "rb") as fh:
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

    def _task(self, kind, title, fn):
        tid = self.app.tasks.submit(kind, title, fn)
        return self._json({"task": tid})

    # ------------------------------------------------------------------
    def _state(self):
        app = self.app
        out = {"app": APP_NAME, "version": VERSION, "platform": sys.platform, "prefs": app.settings.prefs(),
               "libraries": app.settings.libraries(), "tasks": app.tasks.active(), "events": app.bg["events"][-5:]}
        try:
            lib = app.lib(required=False)
        except UserError as e:
            out["lib_error"] = str(e)
            lib = None
        rec = app.settings.active_library()
        if lib is None:
            out["active"] = None
            if rec and not os.path.isdir(rec["root"]):
                out["missing_root"] = rec
            return out
        info = lib.info()
        top = lib.catalog.journal_top()
        db = lib.engine_db()
        estamp = engine.db_stamp(db["path"]) if db else None
        stamp = hashlib.md5(json.dumps([lib.ver(), top["id"] if top else 0, estamp], default=str)
                            .encode()).hexdigest()[:12]
        out.update({"active": info, "engine_open": lib.engine_open(), "serato_open": lib.serato_open(),
                    "inbox_wait": app.bg.get("inbox_wait", 0),
                    "undo": {"id": top["id"], "title": top["title"], "kind": top["kind"]} if top else None,
                    "stamp": stamp, "has_engine": bool(db)})
        return out

    def _api(self, method, route, qs):
        app = self.app
        parts = route.strip("/").split("/")
        body = self._body() if method == "POST" else {}
        r0 = parts[0]
        if r0 == "state":
            return self._json(self._state())
        if r0 == "browse":
            return self._json(_browse(qs.get("path")))
        if r0 == "drives":
            return self._json(_drives())
        if r0 == "task":
            t = app.tasks.get(parts[1])
            return self._json(t) if t else self._err("Görev yok", 404)
        if r0 == "library":
            act = parts[1] if len(parts) > 1 else ""
            if act == "add":
                root = (body.get("root") or "").strip().strip('"')
                if not root or not os.path.isdir(root):
                    raise UserError("Klasör bulunamadı: %s" % root)
                app.reset_lib()
                old = app.settings.active_library()
                if old and body.get("relocate") and old.get("id") == body.get("relocate"):
                    app.settings.relocate_library(old["id"], root)
                else:
                    app.settings.add_library(root, body.get("name") or "")
                lib = app.lib()
                return self._task("scan", "SSD taranıyor", lambda p, c: _scan_and_maintain(lib, p, c))
            if act == "select":
                app.reset_lib()
                app.settings.set_active(body.get("id"))
                return self._json({"ok": True})
            if act == "remove":
                app.reset_lib()
                app.settings.remove_library(body.get("id"))
                return self._json({"ok": True})
        if r0 == "prefs" and method == "POST":
            app.settings.set_prefs(**body)
            return self._json(app.settings.prefs())
        if r0 == "open" and method == "POST":
            return self._json({"ok": _open(app, body)})

        lib = app.lib()
        # ---------------- genel ----------------
        if r0 == "scan" and method == "POST":
            return self._task("scan", "SSD taranıyor", lambda p, c: _scan_and_maintain(lib, p, c))
        if r0 == "undo" and method == "POST":
            force = bool(body.get("force"))
            return self._task("undo", "Geri alınıyor", lambda p, c: journal.undo_last(lib, force=force, progress=p))
        if r0 == "journal":
            rows = lib.catalog.journal(60)
            return self._json([{"id": r["id"], "ts": r["ts"], "kind": r["kind"], "title": r["title"],
                                "status": r["status"]} for r in rows])
        if r0 == "audio":
            return self._audio(int(parts[1]))
        if r0 == "print":
            return self._send(200, _print_list(lib, int(parts[1])).encode("utf-8"), "text/html; charset=utf-8")
        # ---------------- müzikler ----------------
        if r0 == "overview":
            ov = lib.overview()
            ov["maint"] = maintain.status(lib)
            ov["managed"] = maintain.managed_meta(lib, lib.db_uuid()) if lib.engine_db() else {}
            return self._json(ov)
        if r0 == "tracks":
            return self._json(lib.tracks(qs.get("view") or "all"))
        if r0 == "track":
            return self._json(lib.track_detail(int(parts[1])))
        if r0 == "dupes":
            return self._json(dedupe.groups(lib))
        if r0 == "merge" and method == "POST":
            picks = body.get("picks") or []
            return self._task("merge", "Kopyalar birleştiriliyor", lambda p, c: dedupe.merge(lib, picks, p))
        if r0 == "setup":
            if parts[1:] == ["preview"]:
                return self._json(relocate.setup_preview(lib, body.get("root") or "Müzik", body.get("overrides") or {},
                                                         body.get("genre_map") or {}, body.get("extra") or []))
            if parts[1:] == ["apply"] and method == "POST":
                root = body.get("root") or "Müzik"
                ov, gm, extra = body.get("overrides") or {}, body.get("genre_map") or {}, body.get("extra") or []
                off = body.get("engine_off") or []
                return self._task("setup", "Düzen kuruluyor",
                                  lambda p, c: _after(lib, relocate.setup_apply(lib, root, ov, gm, extra, p, off),
                                                      inbox_dirs=True))
            return self._json(relocate.setup_preview(lib, qs.get("root") or lib.music_root() or "Müzik"))
        if r0 == "genre" and method == "POST":
            act = parts[1] if len(parts) > 1 else ""
            if act == "create":
                gid = relocate.genre_create(lib, body.get("name"), body.get("color"))
                inbox.ensure_dirs(lib)
                return self._json({"id": gid})
            if act == "rename":
                gid, name = body.get("id"), body.get("name")
                return self._task("rename", "Tür adı değişiyor",
                                  lambda p, c: _after(lib, relocate.genre_rename(lib, gid, name), inbox_dirs=True))
            if act == "update":
                kw = {k: body[k] for k in ("color", "engine") if k in body}
                relocate.genre_update(lib, body.get("id"), **kw)
                return self._json({"ok": True})
            if act == "reorder":
                relocate.genre_reorder(lib, body.get("ids") or [])
                return self._json({"ok": True})
            if act == "delete":
                relocate.genre_delete(lib, body.get("id"))
                return self._json({"ok": True})
            if act == "merge":
                src, dst = body.get("src"), body.get("dst")
                return self._task("merge", "Türler birleştiriliyor",
                                  lambda p, c: _after(lib, relocate.genre_merge(lib, src, dst, p)))
        if r0 == "move" and method == "POST":
            fids = [int(x) for x in body.get("fids") or []]
            gid = body.get("gid")
            gname = body.get("genre")

            def run(p, c):
                g = gid
                if not g and gname:
                    ex = next((x for x in lib.genre_rows() if x["name"] == gname), None)
                    g = ex["id"] if ex else relocate.genre_create(lib, gname)
                    inbox.ensure_dirs(lib)
                return _after(lib, relocate.move_to_genre(lib, fids, g, sub=body.get("sub"), progress=p))
            return self._task("move", "Taşınıyor", run)
        if r0 == "folder" and method == "POST":
            if parts[1:] == ["rename"]:
                rel, name = body.get("rel"), body.get("name")
                return self._task("rename", "Klasör adı değişiyor",
                                  lambda p, c: _after(lib, relocate.rename_folder(lib, rel, name, p)))
            if parts[1:] == ["move"]:
                rel, parent = body.get("rel"), body.get("parent")
                return self._task("move", "Klasör taşınıyor",
                                  lambda p, c: _after(lib, relocate.move_folder(lib, rel, parent, p)))
        if r0 == "quarantine" and method == "POST":
            fids = [int(x) for x in body.get("fids") or []]
            return self._json(_quarantine(lib, fids))
        if r0 == "rule" and method == "POST":
            return self._json(_set_rule(lib, body.get("rel"), body.get("action")))
        # ---------------- listeler ----------------
        if r0 == "lists":
            return self._json(lists.tree(lib))
        if r0 == "list":
            if method == "GET":
                return self._json(lists.items(lib, int(parts[1])))
            act = parts[1]
            b = body
            if act == "create":
                return self._json(lists.create(lib, b.get("parent") or 0, b.get("title") or "Yeni liste", b.get("before") or 0))
            if act == "rename":
                return self._json(lists.rename(lib, b["id"], b.get("title") or ""))
            if act == "move":
                return self._json(lists.move(lib, b["id"], b.get("parent") or 0, b.get("before") or 0))
            if act == "delete":
                return self._json(lists.delete(lib, b["id"]))
            if act == "duplicate":
                return self._json(lists.duplicate(lib, b["id"], b.get("parent"), b.get("title")))
            if act == "add":
                return self._json(lists.add(lib, b["id"], b.get("fids"), b.get("refs"), b.get("at")))
            if act == "remove":
                return self._json(lists.remove(lib, b["id"], b.get("refs") or []))
            if act == "reorder":
                return self._json(lists.reorder(lib, b["id"], b.get("refs") or []))
            if act == "move_entries":
                return self._json(lists.move_entries(lib, b["src"], b["dst"], b.get("refs") or [], b.get("at"),
                                                     bool(b.get("copy"))))
            if act == "note":
                return self._json(lists.set_note(lib, b["id"], b["ref"], b.get("note") or ""))
        if r0 == "event" and method == "POST":
            b = body
            if parts[1:] == ["new"]:
                return self._json(lists.new_event(lib, b.get("title"), b.get("date"), b.get("venue"),
                                                  b.get("template"), b.get("base"), b.get("notes")))
            if parts[1:] == ["set"]:
                return self._json(lists.set_event(lib, b["id"], b.get("date"), b.get("venue"), b.get("notes")))
        if r0 == "search":
            return self._json(lists.search_library(lib, qs.get("q") or "", int(qs.get("limit") or 300),
                                                   qs.get("gid") or None))
        if r0 == "serato":
            act = parts[1] if len(parts) > 1 else ""
            if act == "crates":
                return self._json(mirror.crates(lib))
            if act == "state":
                return self._json({str(k): v for k, v in mirror.state(lib).items()})
            if act == "link" and method == "POST":
                return self._json(mirror.link(lib, body["id"], bool(body.get("on", True))))
            if act == "import" and method == "POST":
                return self._json(mirror.import_crates(lib, body.get("names") or [], body.get("parent") or 0))
            if act == "sync" and method == "POST":
                prefer = {int(k): v for k, v in (body.get("prefer") or {}).items()}
                if lib.serato_open():
                    raise UserError("Serato açık. Eşitlemek için Serato'yu kapatın.", "serato_open")
                op = journal.Op(lib, "serato", "Serato ile eşitlendi")
                res = mirror.sync(lib, op=op, prefer=prefer)
                op.commit()
                return self._json(res)
        # ---------------- gelen kutusu ----------------
        if r0 == "inbox":
            act = parts[1] if len(parts) > 1 else ""
            if method == "GET" and not act:
                ib, ar = inbox.dirs(lib)
                if lib.catalog.genres():
                    inbox.ensure_dirs(lib)
                s = inbox.scan(lib)
                return self._json({"inbox": ib, "archive": ar, "items": s["items"], "downloads": inbox.downloads(lib),
                                   "log": lib.catalog.inbox_log(40), "auto": lib.prefs().get("auto_inbox", True),
                                   "genres": [{"id": g["id"], "name": g["name"], "color": g["color"]}
                                              for g in lib.genre_rows()]})
            if act == "ingest" and method == "POST":
                entries = body.get("entries") or []
                return self._task("inbox", "Şarkılar ekleniyor", lambda p, c: inbox.ingest(lib, entries, p))
            if act == "aside" and method == "POST":
                return self._json(inbox.set_aside(lib, body["path"]))
            if act == "archive" and method == "POST":
                return self._json(inbox.archive_existing(lib, body["path"]))
            if act == "take" and method == "POST":
                return self._json(inbox.take_download(lib, body["path"], body["gid"]))
            if act == "ignore" and method == "POST":
                return self._json(inbox.ignore_download(lib, body["path"]))
            if act == "open" and method == "POST":
                ib, ar = inbox.ensure_dirs(lib)
                return self._json({"ok": util.open_in_file_manager(ar if body.get("archive") else ib)})
        return self._err("Bilinmeyen istek: %s" % route, 404)


def _after(lib, res, inbox_dirs=False):
    if inbox_dirs:
        try:
            inbox.ensure_dirs(lib)
        except OSError:
            pass
    return res


def _scan_and_maintain(lib, progress, cancel):
    res = lib.full_scan(lambda r, m: progress(r * 0.85, m), cancel)
    if res.get("cancelled"):
        return res
    if lib.catalog.genres():
        progress(0.9, "Engine kontrol ediliyor…")
        res["maint"] = maintain.after_change(lib)
    return res


def _quarantine(lib, fids):
    """Bozuk / istenmeyen dosyaları SSD'deki karantinaya alır (silmez). Engine'de kayıtları varsa kaldırılmaz;
    Engine'de kırmızı görünmesinler diye yalnızca koleksiyonda olmayan dosyalar alınır."""
    st = lib.engine_state()
    ok = [f for f in fids if not st["by_file"].get(f)]
    if not ok:
        raise UserError("Bu dosyalar Engine koleksiyonunda; önce Engine'den kaldırın.")
    op = journal.Op(lib, "karantina", "%d dosya karantinaya alındı" % len(ok))
    with lib.lock:
        if lib.serato_open():
            raise UserError("Serato açık; lütfen kapatın.", "serato_open")
        n = dedupe.quarantine_files(lib, ok, "ayiklanan", op)
        lib.bump()
        op.commit()
    return {"moved": n}


def _set_rule(lib, rel, action):
    cat = lib.catalog
    old = cat.folder_rules().get(rel)
    op = journal.Op(lib, "kural", ("Dokunulmayacak: %s" if action == "ignore" else "Kural kaldırıldı: %s")
                    % names.display(rel))
    op.add({"k": "rule", "rel": rel, "old": old})
    cat.set_folder_rule(rel, action or None)
    lib.bump()
    op.commit()
    return {"ok": True}


def _open(app, body):
    lib = app.lib(required=False)
    if body.get("fid") and lib:
        f = lib.catalog.file(int(body["fid"]))
        if f:
            return util.open_in_file_manager(lib.rootinfo.os_path(f["rel"], f.get("os_rel")), True)
    p = body.get("path") or ""
    allowed = [os.path.abspath(app.settings.ws)]
    if lib:
        allowed.append(os.path.abspath(lib.root))
        allowed.extend(os.path.abspath(x) for x in inbox.dirs(lib))
    ap = os.path.abspath(p)
    if not any(os.path.normcase(ap).startswith(os.path.normcase(a)) for a in allowed):
        raise UserError("Bu konum açılamaz.")
    return util.open_in_file_manager(ap, bool(body.get("select")))


def _drives():
    out = []
    for d in util.list_drives():
        p = d["path"]
        mark = {"serato": False, "engine": False, "djd": False}
        try:
            ents = {e.lower() for e in os.listdir(p)}
            mark = {"serato": "_serato_" in ents, "engine": "engine library" in ents, "djd": "_djdoktor_" in ents}
        except OSError:
            pass
        out.append(dict(d, **mark))
    return out


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
    return {"path": p, "parent": parent, "dirs": dirs}


def _print_list(lib, pid):
    """Etkinlik/liste çıktısı (yazdırmak için sade sayfa)."""
    data = lists.items(lib, pid)
    ev = data.get("ev") or {}
    st = lib.engine_state()
    by_parent = {}
    for p in st["playlists"]:
        by_parent.setdefault(p["parent"], []).append(p)
    blocks = [(data["title"], data["items"])]
    for ch in by_parent.get(pid, []):
        blocks.append((ch["title"], lists.items(lib, ch["id"])["items"]))
    e = html.escape
    out = ["<!doctype html><html lang='tr'><head><meta charset='utf-8'><title>%s</title>" % e(data["title"]),
           "<style>body{font:14px/1.45 system-ui,sans-serif;margin:28px;color:#111}h1{font-size:22px;margin:0 0 4px}"
           ".meta{color:#555;margin-bottom:18px}h2{font-size:16px;margin:22px 0 6px;border-bottom:1px solid #ccc;"
           "padding-bottom:3px}table{border-collapse:collapse;width:100%}td{padding:3px 6px;border-bottom:1px solid #eee}"
           "td.n{color:#888;width:28px}td.k,td.b,td.d{width:56px;color:#444}.note{color:#a15c00}"
           "@media print{body{margin:10mm}}</style></head><body>"]
    out.append("<h1>%s</h1><div class='meta'>%s</div>" % (e(data["title"]), e(" · ".join(
        x for x in (ev.get("date"), ev.get("venue"), ev.get("notes")) if x))))
    for title, items in blocks:
        if not items:
            continue
        if title != data["title"]:
            out.append("<h2>%s</h2>" % e(title))
        out.append("<table>")
        for i, it in enumerate(items, 1):
            note = it.get("note") or ""
            out.append("<tr><td class='n'>%d</td><td><b>%s</b> — %s%s</td><td class='b'>%s</td><td class='k'>%s</td>"
                       "<td class='d'>%s</td></tr>" % (
                           i, e(it["title"] or ""), e(it["artist"] or ""),
                           (" <span class='note'>(%s)</span>" % e(note)) if note else "",
                           it["bpm"] or "", e(it["key"] or ""), util.fmt_dur(it["dur"]) if it["dur"] else ""))
        out.append("</table>")
    out.append("<script>window.print&&setTimeout(()=>window.print(),300)</script></body></html>")
    return "".join(out)


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
    threading.Thread(target=app.background_loop, name="djd-bg", daemon=True).start()
    print("=" * 60)
    print(" %s %s" % (APP_NAME, VERSION))
    print(" Arayüz: %s" % url)
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
        app._stop = True
        srv.server_close()


__all__ = ["run", "App", "Handler", "STATE_DIR"]
