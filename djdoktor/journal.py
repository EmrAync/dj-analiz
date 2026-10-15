"""İşlem günlüğü ve tek düğmeli 'Geri al'.

Her kullanıcı işlemi (liste düzenleme, taşıma, tür değiştirme, gelen kutusundan alma…)
tek bir günlük kaydı olur. Kayıt, işlemin TERSİNE çevrilmesi için gereken adımları tutar.
'Geri al' her zaman en son işlemi geri alır (Ctrl+Z gibi).

Adım türleri (k):
  mv      : dosya taşındı            {fid, old, new}
  q       : dosya karantinaya        {fid, old, dst}   (dst: kökten göreli)
  mkdir   : klasör oluşturuldu       {rel}
  rmdir   : boş klasör kaldırıldı    {rel}
  eng     : Engine adımları          {db, dbpath, steps}
  engsnap : Engine yedeğe dönüş      {db, dbpath, backup, fp}
  ser     : Serato yol eşlemesi      {map}
  sersnap : Serato yedeğe dönüş      {sdir_rel, backup, hashes}
  genre   : tür kaydı                {op, ...}
  rule    : klasör kuralı            {rel, old}
  cat     : katalog alanı            {fid, field, old}
  copy    : dosya kopyalandı         {rel}            (geri alınca karantinaya)
  inbox   : gelen kutusu dosyası     {src, dst}       (arşivden geri gelen kutusuna)
  meta    : katalog meta             {key, old}
  evmeta  : etkinlik bilgisi         {db, pid, old}
"""
from __future__ import annotations

import json
import os

from . import engine, names, serato, util


class Op:
    """Bir kullanıcı işlemi boyunca geri alma adımlarını biriktirir."""

    def __init__(self, lib, kind: str, title: str):
        self.lib = lib
        self.kind = kind
        self.title = title
        self.steps = []
        self.info = {}

    def add(self, step: dict):
        self.steps.append(step)

    def add_engine(self, w, key="drive"):
        if w.steps:
            self.steps.append({"k": "eng", "db": key, "dbpath": None if key == "drive" else w.db_path,
                               "steps": w.steps})

    def commit(self):
        if not self.steps:
            return None
        payload = {"v": 2, "steps": self.steps, "info": self.info}
        return self.lib.catalog.journal_add(self.kind, self.title, payload)


class UndoNeedsForce(Exception):
    def __init__(self, msg):
        super().__init__(msg)


def _db_for(lib, step):
    if step.get("db") == "drive" or not step.get("dbpath"):
        return engine.drive_db(lib.root)
    p = step["dbpath"]
    for d in engine.find_dbs(lib.root):
        if os.path.normcase(d["path"]) == os.path.normcase(p):
            return d
    return None


def undo_last(lib, force=False, progress=None):
    """En son işlemi geri alır. Arada başka değişiklik olduysa (Engine/Prime 4/Serato)
    force=False iken UndoNeedsForce fırlatır; kullanıcı onaylarsa force=True ile tekrar çağrılır."""
    cat = lib.catalog
    j = cat.journal_top()
    if not j:
        raise ValueError("Geri alınacak işlem yok.")
    p = j["payload"] or {}
    if p.get("v") != 2:
        raise ValueError("Bu işlem programın önceki sürümünde yapıldı; buradan geri alınamaz.")
    steps = p.get("steps") or []
    notes = []
    alias = {}
    engine_db = engine.drive_db(lib.root)
    db_uuid = None
    if engine_db:
        try:
            con, _ = engine.open_ro(engine_db["path"])
            db_uuid = engine.schema_of(con)[0]
            con.close()
        except Exception:
            db_uuid = None
        if db_uuid:
            alias.update(cat.aliases(db_uuid))
    need_engine = any(s["k"] in ("eng", "engsnap") for s in steps)
    need_serato = any(s["k"] in ("ser", "sersnap") for s in steps)
    if need_engine and engine.is_running():
        raise ValueError("Engine DJ açık. Geri almak için Engine DJ'i kapatın.")
    if need_serato and util.process_running(serato.SERATO_PROCS):
        raise ValueError("Serato DJ açık. Geri almak için Serato'yu kapatın.")
    # --- ön denetim: anlık görüntüye dönülecekse arada değişiklik var mı?
    if not force:
        for s in steps:
            if s["k"] == "engsnap":
                d = _db_for(lib, s)
                if d and engine.semantic_fingerprint(d["path"]) != s.get("fp"):
                    raise UndoNeedsForce("Bu işlemden sonra Engine kütüphanesi değişmiş (Engine DJ'de veya Prime 4'te "
                                         "yapılan analiz, cue ya da liste değişikliği olabilir). Geri alırsanız bu "
                                         "değişiklikler de geri gider.")
            if s["k"] == "sersnap":
                sdir = serato.serato_dir(lib.root)
                if sdir and serato.state_fp(sdir, list((s.get("hashes") or {}).keys())) != s.get("hashes"):
                    raise UndoNeedsForce("Bu işlemden sonra Serato dosyaları değişmiş (Serato açılıp kapanmış olabilir). "
                                         "Geri alırsanız bu değişiklikler de geri gider.")
    # --- adımları sondan başa uygula
    i = len(steps) - 1
    while i >= 0:
        s = steps[i]
        k = s["k"]
        if k == "eng":
            # ardışık Engine adımlarını tek işlemde uygula
            d = _db_for(lib, s)
            if d is None:
                notes.append("Bilgisayardaki Engine kütüphanesi bu bilgisayarda yok; o kısım atlandı.")
            else:
                w = engine.Writer(d["path"], d["lib_dir"], lib.root)
                try:
                    try:
                        engine.undo_steps(w, s["steps"], alias, force=force)
                    except engine.UndoConflict as e:
                        w.rollback()
                        raise UndoNeedsForce("Bu işlemden sonra Engine'de aynı yer değişmiş (%s). Geri alırsanız o "
                                             "değişiklik de geri gider." % e)
                    w.commit()
                except Exception:
                    w.rollback()
                    raise
                if db_uuid:
                    for old, new in alias.items():
                        cat.add_alias(db_uuid, old, new)
        elif k == "engsnap":
            d = _db_for(lib, s)
            if d:
                pre = engine.backup(d["path"], lib.backup_dir("engine"), "geri_alma_oncesi")
                engine.restore(d["path"], s["backup"])
                notes.append("Engine kütüphanesi işlem öncesine döndü (önceki hâlin yedeği: %s)." % os.path.basename(pre))
        elif k == "ser":
            sdir = serato.serato_dir(lib.root)
            if sdir and s.get("map"):
                inv = {v: k2 for k2, v in s["map"].items()}
                serato.rewrite_paths(sdir, inv)
        elif k == "sersnap":
            sdir = serato.serato_dir(lib.root)
            if sdir and os.path.isfile(s["backup"]):
                serato.backup(sdir, lib.backup_dir("serato"), "geri_alma_oncesi")
                serato.restore_backup(sdir, s["backup"], only=set((s.get("hashes") or {}).keys()))
        elif k == "mv":
            src = lib.rootinfo.os_path(s["new"])
            dst = lib.rootinfo.os_path(s["old"])
            if os.path.exists(src) and not os.path.exists(dst):
                os.makedirs(os.path.dirname(dst), exist_ok=True)
                os.rename(src, dst)
            if s.get("fid"):
                old = s["old"]
                cat.update_rel(s["fid"], old, lib.rootinfo.os_rel_of(old), names.match_key(old), names.loose_key(old))
        elif k == "q":
            src = lib.rootinfo.os_path(s["dst"])
            dst = lib.rootinfo.os_path(s["old"])
            if os.path.exists(src) and not os.path.exists(dst):
                os.makedirs(os.path.dirname(dst), exist_ok=True)
                os.rename(src, dst)
            if s.get("fid"):
                cat.update_file(s["fid"], present=1, origin=s.get("origin") or "library")
        elif k == "copy":
            p_ = lib.rootinfo.os_path(s["rel"])
            if os.path.exists(p_):
                qd = lib.quarantine("geri_alinan_ekleme")
                util.move_file(p_, os.path.join(qd, os.path.basename(p_)))
            if s.get("fid"):
                cat.update_file(s["fid"], present=0, origin="quarantine")
        elif k == "inbox":
            if os.path.exists(s["dst"]) and not os.path.exists(s["src"]):
                os.makedirs(os.path.dirname(s["src"]), exist_ok=True)
                util.move_file(s["dst"], s["src"])
        elif k == "mkdir":
            p_ = lib.rootinfo.os_path(s["rel"]) if not s.get("abs") else s["rel"]
            try:
                os.rmdir(p_)
            except OSError:
                pass
        elif k == "rmdir":
            p_ = lib.rootinfo.os_path(s["rel"])
            os.makedirs(p_, exist_ok=True)
        elif k == "genre":
            op = s["op"]
            if op == "add":
                cat.genre_delete(s["id"])
            elif op == "del":
                cat.x("INSERT INTO genre(id, rel, pos, color, engine, created) VALUES(?,?,?,?,?,?)",
                      (s["row"]["id"], s["row"]["rel"], s["row"]["pos"], s["row"].get("color"),
                       s["row"].get("engine", 1), s["row"].get("created")))
            elif op == "upd":
                cat.genre_update(s["id"], **s["old"])
        elif k == "rule":
            cat.set_folder_rule(s["rel"], s.get("old"))
        elif k == "cat":
            cat.update_file(s["fid"], **{s["field"]: s["old"]})
        elif k == "meta":
            cat.set_meta(s["key"], s["old"] if s["old"] is not None else "")
        elif k == "evmeta":
            cat.set_ev_meta(s["db"], alias.get(s["pid"], s["pid"]), s.get("old"))
        elif k == "serlink":
            pid = alias.get(s["pid"], s["pid"])
            if s.get("old") is None:
                cat.del_serato_link(s["db"], pid)
            else:
                o = s["old"]
                cat.set_serato_link(s["db"], pid, o.get("crate"), o.get("last_hash"), o.get("last_refs"), o.get("dirty", 0))
        i -= 1
    cat.journal_status(j["id"], "geri_alindi")
    cat.journal_add("geri_al", "Geri alındı: %s" % j["title"], {"v": 2, "of": j["id"], "notes": notes}, undo_of=j["id"])
    return {"title": j["title"], "notes": notes, "kind": j["kind"]}
