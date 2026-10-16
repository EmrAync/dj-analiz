"""İşlem günlüğü ve tek düğmeli 'Geri al'.

Her kullanıcı işlemi (liste düzenleme, taşıma, tür değiştirme, gelen kutusundan alma…)
tek bir günlük kaydı olur. Kayıt, işlemin TERSİNE çevrilmesi için gereken adımları tutar.
'Geri al' her zaman en son işlemi geri alır (Ctrl+Z gibi).

Adım türleri (k):
  mv      : dosya taşındı            {fid, old, new}            (yollar kökten göreli, kanonik)
  mvdir   : klasör adı değişti       {old, new, files:[[fid, eski, yeni]]}
  q       : dosya karantinaya        {fid, old, dst}
  mkdir   : klasör oluşturuldu       {rel}
  rmdir   : boş klasör kaldırıldı    {rel}
  eng     : Engine adımları          {db, dbpath, steps}
  engsnap : Engine yedeğe dönüş      {db, dbpath, backup, fp}
  ser     : Serato yol eşlemesi      {map}
  sersnap : Serato yedeğe dönüş      {backup, hashes}
  crate   : Serato crate dosyası     {name, prev(base64|None), after}
  genre   : tür kaydı                {op, ...}
  rule    : klasör kuralı            {rel, old}
  cat     : katalog alanı            {fid, field, old}
  copy    : dosya SSD'ye kopyalandı  {rel, fid}         (geri alınca kopya karantinaya)
  inbox   : gelen kutusu dosyası     {src, dst, size, mtime} (arşivden gelen kutusuna, bekletilir)
  meta    : katalog meta             {key, old}
  evmeta  : etkinlik bilgisi         {db, pid, old}
  note    : liste satırı notu        {db, pid, ref, old}
  serlink : Serato bağı              {db, pid, old}
"""
from __future__ import annotations

import base64
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
            self.steps.append({"k": "eng", "db": key, "dbpath": w.db_path, "steps": list(w.steps)})

    def commit(self):
        """Kaydı yazar. Yedeğe dönüş adımlarının parmak izleri işlemin SON hâline göre hesaplanır
        (geri almadan önce "arada başka değişiklik oldu mu?" diye bakmak için)."""
        if not self.steps:
            return None
        for s in self.steps:
            if s["k"] == "engsnap" and s.get("dbpath") and os.path.isfile(s["dbpath"]):
                try:
                    s["fp"] = engine.semantic_fingerprint(s["dbpath"])
                except Exception:
                    pass
            elif s["k"] == "sersnap":
                sdir = serato.serato_dir(self.lib.root)
                if sdir and s.get("hashes"):
                    s["hashes"] = serato.state_fp(sdir, list(s["hashes"].keys()))
        payload = {"v": 2, "steps": self.steps, "info": self.info}
        return self.lib.catalog.journal_add(self.kind, self.title, payload)


class UndoNeedsForce(Exception):
    def __init__(self, msg):
        super().__init__(msg)


def _db_for(lib, step):
    dbs = engine.find_dbs(lib.root)
    if step.get("db") == "drive":
        for d in dbs:
            if d["key"] == "drive":
                return d
        return None
    p = step.get("dbpath")
    for d in dbs:
        if p and os.path.normcase(d["path"]) == os.path.normcase(p):
            return d
    return None


def _crate_path(sdir, name):
    return os.path.join(sdir, *name.split("/"))


def precheck(lib, steps):
    """Geri almadan önce: arada başka bir yerde değişiklik olmuş mu? Varsa açıklama döndürür."""
    for s in steps:
        k = s["k"]
        if k == "engsnap":
            d = _db_for(lib, s)
            if d and engine.semantic_fingerprint(d["path"]) != s.get("fp"):
                return ("Bu işlemden sonra Engine kütüphanesi değişmiş (Engine DJ'de veya Prime 4'te yapılan analiz, "
                        "cue ya da liste değişikliği olabilir). Geri alırsanız bu değişiklikler de geri gider.")
        elif k == "sersnap":
            sdir = serato.serato_dir(lib.root)
            if sdir and serato.state_fp(sdir, list((s.get("hashes") or {}).keys())) != s.get("hashes"):
                return ("Bu işlemden sonra Serato dosyaları değişmiş (Serato açılıp kapanmış olabilir). "
                        "Geri alırsanız bu değişiklikler de geri gider.")
        elif k == "crate":
            sdir = serato.serato_dir(lib.root)
            if sdir:
                p = _crate_path(sdir, s["name"])
                cur = serato.file_hash(p) if os.path.isfile(p) else None
                if cur != s.get("after"):
                    return ("Serato'daki “%s” crate'i bu işlemden sonra Serato'da değiştirilmiş. Geri alırsanız o "
                            "değişiklik de geri gider." % s["name"].split("/")[-1][:-6].replace("%%", " / "))
    return None


def apply_inverse(lib, steps, force=False, notes=None, managed=None):
    """Adımları sondan başa tersine uygular. force=False iken çakışmada UndoNeedsForce fırlatır."""
    cat = lib.catalog
    notes = notes if notes is not None else []
    i = len(steps) - 1
    batch = 0
    while i >= 0:
        s = steps[i]
        k = s["k"]
        if k in ("mv", "q") and batch == 0:
            # ardışık dosya adımları: katalog yazımları 200'lük paketlerle (binlerce dosyada hızlı)
            j = i
            while j >= 0 and steps[j]["k"] in ("mv", "q") and i - j < 200:
                j -= 1
            with cat.tx():
                batch = i - j
                while batch:
                    _file_step(lib, steps[i])
                    i -= 1
                    batch -= 1
            continue
        if k == "eng":
            d = _db_for(lib, s)
            if d is None:
                notes.append("Bilgisayardaki Engine kütüphanesi bu bilgisayarda yok; o kısım atlandı.")
            else:
                w = engine.Writer(d["path"], d["lib_dir"], lib.root)
                uuid = w.uuid
                alias = cat.aliases(uuid)
                if managed is None:
                    from . import maintain
                    mg = maintain.managed_ids(lib, uuid) if d["key"] == "drive" else set()
                else:
                    mg = managed
                try:
                    try:
                        engine.undo_steps(w, s["steps"], alias, force=force, managed=frozenset(mg))
                    except engine.UndoConflict as e:
                        w.rollback()
                        raise UndoNeedsForce("Bu işlemden sonra Engine'de aynı yer değişmiş (%s) Geri alırsanız o "
                                             "değişiklik de geri gider." % e)
                    w.commit()
                except UndoNeedsForce:
                    raise
                except Exception:
                    w.rollback()
                    raise
                for old, new in alias.items():
                    cat.add_alias(uuid, old, new)
        elif k == "engsnap":
            d = _db_for(lib, s)
            if d and s.get("backup") and os.path.isfile(s["backup"]):
                pre = engine.backup(d["path"], lib.backup_dir("engine"), "geri_alma_oncesi")
                engine.restore(d["path"], s["backup"])
                notes.append("Engine kütüphanesi işlem öncesine döndü (önceki hâlin yedeği: %s)." % os.path.basename(pre))
            elif d:
                raise ValueError("Bu işlemin Engine yedeği bulunamadı; geri alınamıyor.")
        elif k == "ser":
            sdir = serato.serato_dir(lib.root)
            if sdir and s.get("map"):
                inv = {v: k2 for k2, v in s["map"].items()}
                serato.rewrite_paths(sdir, inv, dedupe=False)
        elif k == "sersnap":
            sdir = serato.serato_dir(lib.root)
            if sdir and os.path.isfile(s["backup"]):
                serato.backup(sdir, lib.backup_dir("serato"), "geri_alma_oncesi")
                serato.restore_backup(sdir, s["backup"], only=set((s.get("hashes") or {}).keys()))
        elif k == "crate":
            sdir = serato.serato_dir(lib.root)
            if sdir:
                p = _crate_path(sdir, s["name"])
                if s.get("prev") is not None:
                    util.atomic_write_bytes(p, base64.b64decode(s["prev"]))
                elif os.path.isfile(p):
                    qd = lib.quarantine("geri_alinan_crate")
                    util.move_file(p, os.path.join(qd, os.path.basename(p)))
        elif k == "mvdir":
            src = lib.rootinfo.os_path(s["new"])
            dst = lib.rootinfo.os_path(s["old"])
            if os.path.isdir(src) and (not os.path.exists(dst) or names.loose_key(s["new"]) == names.loose_key(s["old"])):
                _rename(src, dst)
            for fid, old, _new in s.get("files") or []:
                cat.update_rel(fid, old, lib.rootinfo.os_rel_of(old), names.match_key(old), names.loose_key(old))
        elif k == "copy":
            p_ = lib.rootinfo.os_path(s["rel"])
            if os.path.exists(p_):
                qrel = lib.quarantine_rel("geri_alinan_ekleme") + "/" + names.split_rel(s["rel"])[-1]
                q_ = lib.rootinfo.os_path(qrel)
                os.makedirs(os.path.dirname(q_), exist_ok=True)
                os.rename(p_, util.unique_path(q_))
            if s.get("fid"):
                cat.update_file(s["fid"], present=0, origin="quarantine")
        elif k == "inbox":
            if os.path.exists(s["dst"]) and not os.path.exists(s["src"]):
                os.makedirs(os.path.dirname(s["src"]), exist_ok=True)
                util.move_file(s["dst"], s["src"])
            try:
                st = os.stat(s["src"])
                cat.set_hold(s["src"], st.st_size, int(st.st_mtime))
            except OSError:
                pass
        elif k == "mkdir":
            p_ = s["rel"] if s.get("abs") else lib.rootinfo.os_path(s["rel"])
            _rmdir_junk_only(lib, p_)
        elif k == "rmdir":
            os.makedirs(lib.rootinfo.os_path(s["rel"]), exist_ok=True)
        elif k == "genre":
            op = s["op"]
            if op == "add":
                cat.genre_delete(s["id"])
            elif op == "del":
                r = s["row"]
                cat.x("INSERT OR REPLACE INTO genre(id, rel, pos, color, engine, created) VALUES(?,?,?,?,?,?)",
                      (r["id"], r["rel"], r["pos"], r.get("color"), r.get("engine", 1), r.get("created")))
            elif op == "upd":
                cat.genre_update(s["id"], **s["old"])
        elif k == "rule":
            cat.set_folder_rule(s["rel"], s.get("old"))
        elif k == "cat":
            cat.update_file(s["fid"], **{s["field"]: s["old"]})
        elif k == "meta":
            cat.set_meta(s["key"], s["old"] if s["old"] is not None else "")
        elif k == "evmeta":
            cat.set_ev_meta(s["db"], _alias(cat, s["db"], s["pid"]), s.get("old"))
        elif k == "note":
            cat.set_note(s["db"], _alias(cat, s["db"], s["pid"]), s["ref"], s.get("old"))
        elif k == "serlink":
            pid = _alias(cat, s["db"], s["pid"])
            if s.get("old") is None:
                cat.del_serato_link(s["db"], pid)
            else:
                o = s["old"]
                cat.set_serato_link(s["db"], pid, o.get("crate"), o.get("last_hash"), o.get("last_refs"),
                                    o.get("dirty", 0))
        i -= 1
    return notes


def _rmdir_junk_only(lib, p):
    """Klasörü kaldırır; içinde yalnızca işletim sisteminin bıraktığı çöp (.DS_Store, ._) varsa onu
    karantinaya taşır (silmez). Başka bir şey varsa klasöre dokunmaz."""
    try:
        entries = os.listdir(p)
    except OSError:
        return False
    junk = [e for e in entries if e.startswith("._") or e.lower() in (".ds_store", "thumbs.db", "desktop.ini")]
    if len(junk) != len(entries):
        return False
    if junk:
        qd = lib.quarantine("bos_klasor_copu")
        for e in junk:
            try:
                util.move_file(os.path.join(p, e), os.path.join(qd, e))
            except OSError:
                return False
    try:
        os.rmdir(p)
        return True
    except OSError:
        return False


def _file_step(lib, s):
    cat = lib.catalog
    if s["k"] == "mv":
        src = lib.rootinfo.os_path(s["new"])
        dst = lib.rootinfo.os_path(s["old"])
        if os.path.exists(src) and (not os.path.exists(dst) or names.loose_key(s["new"]) == names.loose_key(s["old"])):
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            try:
                _rename(src, dst)
            except OSError:
                return  # eski yerde başka bir dosya var: dosya yeni yerinde kalır, katalog da öyle bilir
        if s.get("fid"):
            old = s["old"]
            cat.update_rel(s["fid"], old, lib.rootinfo.os_rel_of(old), names.match_key(old), names.loose_key(old))
    elif s["k"] == "q":
        src = lib.rootinfo.os_path(s["dst"])
        dst = lib.rootinfo.os_path(s["old"])
        if os.path.exists(src) and not os.path.exists(dst):
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            os.rename(src, dst)
        if s.get("fid"):
            old = s["old"]
            cat.update_rel(s["fid"], old, lib.rootinfo.os_rel_of(old), names.match_key(old), names.loose_key(old))
            cat.update_file(s["fid"], present=1, origin=s.get("origin") or "library")


def _alias(cat, db, pid):
    al = cat.aliases(db)
    guard = 0
    while pid in al and guard < 100:
        pid = al[pid]
        guard += 1
    return pid


def _rename(src, dst):
    util.safe_rename(src, dst)


def undo_last(lib, force=False, progress=None):
    """En son işlemi geri alır. Arada başka değişiklik olduysa (Engine/Prime 4/Serato)
    force=False iken UndoNeedsForce fırlatır; kullanıcı onaylarsa force=True ile tekrar çağrılır."""
    from .library import UserError
    cat = lib.catalog
    with lib.lock:
        j = cat.journal_top()
        if not j:
            raise UserError("Geri alınacak işlem yok.")
        p = j["payload"] or {}
        if p.get("v") != 2:
            raise UserError("Bu işlem programın önceki sürümünde yapıldı; buradan geri alınamaz.")
        steps = p.get("steps") or []
        need_engine = any(s["k"] in ("eng", "engsnap") for s in steps)
        need_serato = any(s["k"] in ("ser", "sersnap", "crate") for s in steps)
        if need_engine and lib.engine_open():
            raise UserError("Engine DJ açık. Geri almak için Engine DJ'i kapatın.", "engine_open")
        if need_serato and lib.serato_open():
            raise UserError("Serato açık. Geri almak için Serato'yu kapatın.", "serato_open")
        if not force:
            why = precheck(lib, steps)
            if why:
                raise UndoNeedsForce(why)
        if progress:
            progress(0.2, "Geri alınıyor…")
        notes = apply_inverse(lib, steps, force=force)
        cat.journal_status(j["id"], "geri_alindi")
        cat.journal_add("geri_al", "Geri alındı: %s" % j["title"], {"v": 2, "of": j["id"], "notes": notes},
                        undo_of=j["id"])
        lib.bump()
        if need_serato or any(s["k"] in ("mv", "mvdir", "q") for s in steps):
            lib.analyze_serato()
        if progress:
            progress(0.8, "Engine kontrol ediliyor…")
        from . import maintain
        maintain.after_change(lib)
        return {"title": j["title"], "notes": notes, "kind": j["kind"]}
