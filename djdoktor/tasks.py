"""Arka plan görevleri (tarama, taşıma, birleştirme…) — sırayla tek tek çalışır."""
from __future__ import annotations

import itertools
import queue
import threading
import time
import traceback


class Task:
    _ids = itertools.count(1)

    def __init__(self, kind, title, fn):
        self.id = next(self._ids)
        self.kind = kind
        self.title = title
        self.fn = fn
        self.status = "sirada"
        self.progress = 0.0
        self.message = "Sırada bekliyor…"
        self.result = None
        self.error = None
        self.code = None
        self.created = time.time()
        self.started = None
        self.finished = None
        self._cancel = False

    def to_dict(self):
        return {"id": self.id, "kind": self.kind, "title": self.title, "status": self.status,
                "progress": round(self.progress, 4), "message": self.message, "result": self.result,
                "error": self.error, "code": self.code, "started": self.started, "finished": self.finished}


class TaskManager:
    def __init__(self, log=None):
        self.tasks = {}
        self.q = queue.Queue()
        self.lock = threading.Lock()
        self.log = log
        self.busy = False
        self.worker = threading.Thread(target=self._run, name="djd-worker", daemon=True)
        self.worker.start()

    def submit(self, kind, title, fn):
        t = Task(kind, title, fn)
        with self.lock:
            self.tasks[t.id] = t
            done = [k for k, v in self.tasks.items() if v.finished and time.time() - v.finished > 3600]
            for k in done:
                del self.tasks[k]
        self.q.put(t)
        return t.id

    def get(self, tid):
        t = self.tasks.get(int(tid))
        return t.to_dict() if t else None

    def active(self):
        return [t.to_dict() for t in self.tasks.values() if t.status in ("sirada", "calisiyor")]

    def idle(self):
        return not self.busy and self.q.empty()

    def cancel(self, tid):
        t = self.tasks.get(int(tid))
        if t:
            t._cancel = True
            return True
        return False

    def _run(self):
        from .journal import UndoNeedsForce
        from .library import UserError
        while True:
            t = self.q.get()
            if t._cancel:
                t.status = "iptal"
                t.finished = time.time()
                continue
            self.busy = True
            t.status = "calisiyor"
            t.started = time.time()
            t.message = "Başladı…"

            def progress(r, msg=None, t=t):
                t.progress = max(0.0, min(1.0, float(r)))
                if msg:
                    t.message = msg

            try:
                t.result = t.fn(progress, lambda t=t: t._cancel)
                t.status = "iptal" if t._cancel else "bitti"
                t.progress = 1.0
                t.message = "İptal edildi" if t._cancel else "Tamamlandı"
            except UndoNeedsForce as e:
                t.status = "hata"
                t.error = str(e)
                t.code = "needs_force"
                t.message = t.error
            except UserError as e:
                t.status = "hata"
                t.error = str(e)
                t.code = e.code
                t.message = t.error
            except Exception as e:  # kullanıcıya anlaşılır mesaj
                t.status = "hata"
                t.error = "Beklenmeyen hata: %s" % e
                t.message = t.error
                if self.log:
                    self.log(traceback.format_exc())
            finally:
                t.finished = time.time()
                self.busy = False
