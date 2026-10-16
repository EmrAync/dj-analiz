"""Gerçek veri sandbox'ında uçtan uca deneme (her aşama ayrı süreçte; sonuçlar run/result.json'a yazılır).

    python -B tests/sbx_build.py <gerçek_kopya_SALT_OKUNUR> <sandbox_SSD>
    python -B tests/sbx_phase.py <sandbox_SSD> <calisma_klasoru> 1   # tarama + bakım + kurulum önerisi
    python -B tests/sbx_phase.py <sandbox_SSD> <calisma_klasoru> 2   # düzeni kur (tür klasörleri)
    python -B tests/sbx_phase.py <sandbox_SSD> <calisma_klasoru> 3   # kopyaları birleştir, etkinlik, Serato
    python -B tests/sbx_phase.py <sandbox_SSD> <calisma_klasoru> 4   # hepsini geri al ve ilk hâlle karşılaştır

Asla gerçek SSD'de ya da kullanıcının kopyasında çalıştırma: yalnızca sbx_build.py'nin ürettiği sandbox'ta.
4. aşamanın sonunda 'geri_alma' içinde dosyalar_ayni / serato_ayni / engine_ayni hepsi True olmalı.
"""
import hashlib, json, os, sqlite3, sys, time
from collections import Counter
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "vendor"))
sys.path.insert(0, os.path.join(HERE, ".."))
ROOT, WORK, PHASE = sys.argv[1], sys.argv[2], sys.argv[3]
os.environ["DJDOKTOR_HOME"] = os.path.join(WORK, "ws")
os.environ["HOME"] = os.path.join(WORK, "home")
os.makedirs(os.path.join(WORK, "home", "Music"), exist_ok=True)
from djdoktor import dedupe, engine, journal, lists, maintain, mirror, relocate, serato  # noqa: E402
from djdoktor.config import Settings  # noqa: E402
from djdoktor.library import Library  # noqa: E402
from djdoktor.resolver import Resolver  # noqa: E402
RF = os.path.join(WORK, "result.json")
R = json.load(open(RF)) if os.path.exists(RF) else {}
T0 = time.time()


def tree(root):
    out = {}
    for dp, dn, fn in os.walk(root):
        rel = os.path.relpath(dp, root).replace(os.sep, "/")
        if rel.split("/")[0] == "_DJDoktor_":
            continue
        for f in fn:
            r = f if rel == "." else rel + "/" + f
            if r.startswith("Engine Library/Database2/") or r.startswith("_Serato_/"):
                continue
            out[r] = os.path.getsize(os.path.join(dp, f))
    return out


def serato_state(root):
    sdir = os.path.join(root, "_Serato_")
    out = {}
    for dp, dn, fn in os.walk(sdir):
        for f in fn:
            p = os.path.join(dp, f)
            out[os.path.relpath(p, sdir)] = hashlib.md5(open(p, "rb").read()).hexdigest()
    return out


def engine_check(lib):
    d = lib.engine_db()
    con = sqlite3.connect(d["path"])
    ic = con.execute("PRAGMA integrity_check").fetchone()[0]
    fk = len(con.execute("PRAGMA foreign_key_check").fetchall())
    n = con.execute("SELECT COUNT(*) FROM Track").fetchone()[0]
    con.close()
    st = lib.engine_state(force=True)
    return {"integrity": ic, "fk": fk, "tracks": n, "status": dict(Counter(st["status"].values())),
            "orphans": dict(Counter(o[2] for o in st["orphans"])), "lists": len(st["playlists"])}


def serato_check(lib):
    res = Resolver(lib.catalog, lib.root)
    c = Counter()
    for cr in serato.read_crates(lib.serato_dir()):
        for p in cr["tracks"]:
            c[res.resolve(p)[1]] += 1
    return dict(c)


s = Settings()
recs = s.libraries()
lib = Library(s, recs[0] if recs else s.add_library(ROOT, "SBX"))
dbp = engine.drive_db(ROOT)["path"]
if PHASE == "1":
    R["fp0"] = engine.semantic_fingerprint(dbp)
    t = time.time(); lib.full_scan(); R["t_scan"] = round(time.time() - t, 1)
    R["ilk_bakim"] = maintain.run(lib)
    json.dump(tree(ROOT), open(os.path.join(WORK, "tree0.json"), "w"))
    json.dump(serato_state(ROOT), open(os.path.join(WORK, "ser0.json"), "w"))
    R["fp1"] = engine.semantic_fingerprint(dbp)
    ov = lib.overview()
    R["once"] = {"toplam": ov["total"], "tursuz": ov["unsorted"], "kopya_grup": ov["dupes"], "fazla": ov["dupe_extra"],
                 "benzer": ov["similar"], "sorun": ov["problems"], "engine": engine_check(lib), "serato": serato_check(lib)}
    t = time.time(); pv = relocate.setup_preview(lib, "Müzik"); R["t_preview"] = round(time.time() - t, 1)
    R["oneri"] = {"tasinacak": pv["moves"], "tek_tek": pv["spread"], "dokunma": pv["ignore"], "yerinde": pv["stay"],
                  "turler": [(g["name"], g["count"], g.get("to_engine")) for g in pv["genres"]],
                  "engine_ekle": sum(g.get("to_engine", 0) for g in pv["genres"]), "engine_var": pv.get("engine_tracks")}
    R["klasorler"] = ["%s => %s (%d)" % (f["disp"], pv["assign"][f["rel"]], f["direct"]) for f in pv["folders"] if f["direct"]]
elif PHASE == "2":
    t = time.time(); res = relocate.setup_apply(lib, "Müzik"); R["t_setup"] = round(time.time() - t, 1)
    R["kurulum"] = {k: v for k, v in res.items()}
    ov = lib.overview()
    R["kurulum_sonrasi"] = {"engine": engine_check(lib), "serato": serato_check(lib), "tursuz": ov["unsorted"],
                            "kopya_grup": ov["dupes"],
                            "turler": [(g["name"], g["count"], g["ready"], g["pending"], g["none"], g["problem"])
                                       for g in ov["genres"]]}
    rows = lib.tracks("unsorted")
    R["tursuz_oneri"] = dict(Counter((r.get("sugg") or "-") + (" (kopya)" if r.get("copy_of") else "") for r in rows))
elif PHASE == "3":
    t = time.time(); groups = dedupe.groups(lib)
    R["ciftler"] = dict(Counter(g["kind"] for g in groups))
    picks = [{"group": g["id"]} for g in groups if g["kind"] in ("exact", "audio", "engine")]
    if picks:
        m = dedupe.merge(lib, picks)
        R["birlestirme"] = {"dosya": m["files"], "engine": m["engine"], "serato": m["serato"], "bakim": m.get("maint"),
                            "icerik_takas": m.get("content_swaps")}
    R["t_merge"] = round(time.time() - t, 1)
    R["birlestirme_sonrasi"] = {"engine": engine_check(lib), "serato": serato_check(lib)}
    t = time.time(); tr = lists.tree(lib)
    ul = [x for x in tr["lists"] if not x["managed"] and x["n"]]
    R["engine_listeleri"] = [(" / ".join(x["path"]), x["n"]) for x in tr["lists"]][:60]
    if ul:
        ev = lists.new_event(lib, "Test Düğün", date="2026-10-17", base=ul[0]["id"])
        lists.add(lib, ev["id"], fids=[f["id"] for f in lib.audio_files()[:3]])
        mirror.link(lib, ev["id"], True)
        R["etkinlik"] = {"kopyalanan": ul[0]["title"], "satir": len(lists.items(lib, ev["id"])["items"])}
    cr = mirror.crates(lib)
    if cr:
        R["crate_al"] = mirror.import_crates(lib, [cr[0]["name"]])
    R["t_lists"] = round(time.time() - t, 1)
elif PHASE == "4":
    t = time.time(); n = forced = 0; R.setdefault("zorla", [])
    R["journal_before"] = [(j["id"], j["kind"], j["status"], j["title"][:50]) for j in lib.catalog.journal(20)]
    while lib.catalog.journal_top() and time.time() - t < 150:
        try:
            journal.undo_last(lib)
        except journal.UndoNeedsForce as e:
            forced += 1; R["zorla"].append(str(e)[:140]); journal.undo_last(lib, force=True)
        n += 1
        R.setdefault("undo_log", []).append(round(time.time() - t, 1))
        json.dump(R, open(RF, "w"), ensure_ascii=False, indent=1)
    R["t_undo"] = round(time.time() - t, 1)
    R["geri_alma_adim"] = R.get("geri_alma_adim", 0) + n
    R["kalan"] = bool(lib.catalog.journal_top())
    if not R["kalan"]:
        b, a = json.load(open(os.path.join(WORK, "tree0.json"))), tree(ROOT)
        bs, as_ = json.load(open(os.path.join(WORK, "ser0.json"))), serato_state(ROOT)
        R["geri_alma"] = {"dosyalar_ayni": a == b, "eksik": sorted(set(b) - set(a))[:10], "fazla": sorted(set(a) - set(b))[:10],
                          "boyut_farki": [k for k in b if k in a and a[k] != b[k]][:10], "serato_ayni": as_ == bs,
                          "serato_fark": sorted(k for k in set(bs) | set(as_) if bs.get(k) != as_.get(k))[:10],
                          "engine_ayni": engine.semantic_fingerprint(dbp) == R["fp1"], "engine": engine_check(lib)}
json.dump(R, open(RF, "w"), ensure_ascii=False, indent=1)
print("phase", PHASE, "ok", round(time.time() - T0, 1))
