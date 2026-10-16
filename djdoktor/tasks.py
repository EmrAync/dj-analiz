"""Arka plan görevleri (tarama, taşıma, birleştirme…).

İki şerit vardır: taramalar kendi şeridinde çalışır (yalnızca okur, kütüphane kilidini kısa süre alır);
taşıma, birleştirme, geri alma gibi yazan işler diğer şeritte SIRAYLA çalışır. Böylece uzun bir tarama
kullanıcının işlemini "Sırada bekliyor…" durumunda bekletmez."""
from __future__ import annotations

import itertools
import queue
import threading
import time
import traceback

CANCELLABLE = {"scan"}   # yarıda durdurulması güvenli görevler (yalnızca okuyan işler)
READ_LANE = {"scan"}     # ayrı şeritte çalışan (okuyan) görevler


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
                "error": self.error, "code": self.code, "started": self.started, "finished": self.finished,
                "cancellable": self.kind in CANCELLABLE and self.status in ("sirada", "calisiyor"),
                "cancelling": self._cancel and self.status in ("sirada", "calisiyor")}


class TaskManager:
    def __init__(self, log=None):
        self.tasks = {}
        self.lock = threading.Lock()
        self.log = log
        self.lanes = {}
        for lane in ("main", "read"):
            q = queue.Queue()
            th = threading.Thread(target=self._run, args=(lane, q), name="djd-worker-" + lane, daemon=True)
            self.lanes[lane] = {"q": q, "busy": False, "thread": th}
            th.start()

    @property
    def busy(self):
        return any(l["busy"] for l in self.lanes.values())

    def _lane(self, kind):
        return "read" if kind in READ_LANE else "main"

    def submit(self, kind, title, fn):
        t = Task(kind, title, fn)
        with self.lock:
            self.tasks[t.id] = t
            done = [k for k, v in self.tasks.items() if v.finished and time.time() - v.finished > 3600]
            for k in done:
                del self.tasks[k]
        self.lanes[self._lane(kind)]["q"].put(t)
        return t.id

    def get(self, tid):
        t = self.tasks.get(int(tid))
        return t.to_dict() if t else None

    def active(self):
        return [t.to_dict() for t in self.tasks.values() if t.status in ("sirada", "calisiyor")]

    def idle(self, lane=None):
        lanes = [self.lanes[lane]] if lane else self.lanes.values()
        return all(not l["busy"] and l["q"].empty() for l in lanes)

    def cancel(self, tid):
        t = self.tasks.get(int(tid))
        if t and t.kind in CANCELLABLE and t.status in ("sirada", "calisiyor"):
            t._cancel = True
            t.message = "Durduruluyor…"
            return True
        return False

    def cancel_kind(self, kind, timeout=8.0):
        """O türdeki sıradaki/çalışan görevleri durdurur ve bitmelerini bekler (en çok timeout sn)."""
        hit = [t for t in list(self.tasks.values()) if t.kind == kind and t.status in ("sirada", "calisiyor")]
        for t in hit:
            t._cancel = True
            t.message = "Durduruluyor…"
        end = time.time() + timeout
        while time.time() < end and any(t.status == "calisiyor" for t in hit):
            time.sleep(0.05)
        return len(hit)

    def _run(self, lane, q):
        from .journal import UndoNeedsForce
        from .library import UserError
        st = self.lanes[lane]
        while True:
            t = q.get()
            # sırada beklerken durdurulan tarama da bir kez çağrılır: hemen 'durdu' der ve
            # ilk taramaysa seçimi geri alır (yanlış sürücüde iz kalmaz)
            st["busy"] = True
            t.status = "calisiyor"
            t.started = time.time()
            t.message = "Durduruluyor…" if t._cancel else "Başladı…"

            def progress(r, msg=None, t=t):
                t.progress = max(0.0, min(1.0, float(r)))
                if msg:
                    t.message = msg

            try:
                res = t.fn(progress, lambda t=t: t._cancel)
                t.result = res
                stopped = bool(res.get("cancelled")) if isinstance(res, dict) else t._cancel
                t.status = "iptal" if stopped else "bitti"
                t.progress = 1.0
                t.message = "Durduruldu" if stopped else "Tamamlandı"
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
                st["busy"] = False
