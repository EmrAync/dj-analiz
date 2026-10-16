# CLAUDE.md — DJ Doktor

Read this first. It is the hand-off from the sessions that built v1 and v2. The user (a Turkish mobile DJ in
Germany) wants Claude Code to keep developing the program. UI language is **Turkish**; code comments are mostly Turkish.

## 1. The user and the problem

- Gear: **Denon Prime 4** + **Engine DJ** desktop on a Windows PC; **Serato DJ Pro** on a MacBook (used most).
- Music lives on one **external exFAT SSD** ("Serato DJ (D:)") shared by Mac, PC and Prime 4.
- Pain points (his words, condensed):
  - songs don't play / "konumu yanlış" (wrong location) after moving between Serato and Engine;
  - the same song sits in **several folders**; the folder hierarchy must be put "on rails" and folder names must be easy to rename;
  - he wants to prepare **event lists** (Düğün, Kına, Nişan, Sünnet, Matine…) directly, without "send / receive / save / close" steps, with undo;
  - a download should go to its **genre** chosen at download time (Halay → Halay, Horon → Horon, Ankara → Ankara);
  - he must always see which songs are **analyzed** and whose path **Engine has confirmed**;
  - a song must **never be added to Engine twice**;
  - calm, eye-friendly UI, little reading, **no reports to read**, light theme.
- Latest feedback (16.10.2026): *"v1'de çok şey mümkündü, v2'de onların hiçbiri yok"* — v1 had many more capabilities
  that v2 dropped — and *"takılıyor, program çok sıkıntılı çalışıyor"* — it hangs / feels sluggish. See §7 and §8.

## 2. Hard rules (never break these)

1. **"Orijinallere hiçbir şekilde zarar gelmesin."** Never damage the user's originals. Develop and test on copies
   (`tests/make_fixture.py` synthetic SSD, or `tests/sbx_build.py` sandbox built *read-only* from a real copy).
2. **Never delete user files.** Anything removed goes to `<SSD>/_DJDoktor_/Karantina/…`. The only files the program may
   delete are its own (e.g. a freshly created catalog when the user backs out of a wrong drive).
3. **Never write Engine's `m.db` while Engine DJ runs, never write Serato files while Serato runs** (both overwrite
   or cache their DB). Check with `engine.is_running(fresh=True)` / `lib.serato_open()` right before writing.
4. **Back up before every write** (`engine.backup`, `serato.backup` → `<SSD>/_DJDoktor_/Yedekler`).
5. **Every user-visible change is a journal operation and must be undoable** (`journal.Op`, inverse steps, LIFO undo with
   prechecks). The program's own managed lists are recomputed, not journaled.
6. Never overwrite an existing file (Mac `rename()` overwrites silently): use `util.safe_rename`.
7. Do not touch v1's folders/settings (`Documents/DJ Kutuphane Doktoru`). v2 uses `Documents/DJ Doktor`.
8. Stay compatible with **Python 3.8+** (macOS system Python is 3.9) and keep **zero runtime dependencies** besides
   `vendor/mutagen` (GPL-2.0+). The app is a local stdlib HTTP server + vanilla JS page.

## 3. Run, test, package

```bash
python baslat.py [--port 8770] [--no-browser]     # opens http://127.0.0.1:8770 (v1 used 8765)
python3 -B tests/test_v2.py [test_name ...]       # 9 end-to-end backend tests on a synthetic SSD (no pytest)
python3 -B tests/ui_smoke.py /tmp/shots           # Playwright + Chromium click-through, screenshots, fails on JS/HTTP errors
python3 tools/package.py [dist_dir]               # user zip (keeps CRLF .bat, chmod 755 .command)
```

- Use `-B` so no `__pycache__` lands in folders you don't own.
- **exFAT matters** (case-insensitive names, 1–2 s timestamps). Run the suite on a real exFAT mount before releasing:
  ```bash
  apt-get install -y exfat-fuse exfatprogs
  truncate -s 300M /tmp/exfat.img && mkfs.exfat /tmp/exfat.img
  L=$(losetup -f --show /tmp/exfat.img) && mkdir -p /mnt/exfat && mount.exfat-fuse $L /mnt/exfat
  mkdir -p /mnt/exfat/tmp && DJD_TEST_BASE=/mnt/exfat/tmp python3 -B tests/test_v2.py
  ```
  (Do not point Playwright's TMPDIR at exFAT — Chromium needs symlinks.)
- Old Pythons: `uv python install 3.8 3.9` and run the suite with them.
- Real-data sandbox (on the user's machine, never on the real SSD):
  `python -B tests/sbx_build.py <copy_READ_ONLY> <sandbox>` then `python -B tests/sbx_phase.py <sandbox> <work> 1|2|3|4`.
  Phase 4 undoes everything; `geri_alma.dosyalar_ayni / serato_ayni / engine_ayni` must all be `true`.
  Last run on a copy of his data (4,660 files, 326 Engine tracks, 162 crates): setup moved 3,641 files in 8 s,
  99 duplicate copies quarantined, full undo identical.

## 4. Architecture (v2)

| Module | Role |
|---|---|
| `baslat.py` | launcher; waits if an older instance is still running on the port |
| `djdoktor/server.py` | stdlib `ThreadingHTTPServer`, JSON API under `/api/*` (token header), `App` (active library, background loop `_tick`: inbox every 4 s, Serato mirror every 30 s, full scan every 240 s, maintenance/mirror when Engine/Serato close) |
| `tasks.py` | single-worker task queue; only `scan` is cancellable (✕ in UI) |
| `config.py` | `Documents/DJ Doktor/ayarlar.json`: libraries, prefs |
| `library.py` | `Library`: catalog, `engine_state()` cache, `full_scan`, views (`overview`, `tracks`, `file_states`), flags |
| `catalog.py` | SQLite catalog **on the SSD** (`_DJDoktor_/katalog.db`, journal_mode=DELETE): files, genres, folder rules, journal, notes, Serato links, aliases, rel history, inbox |
| `scanner.py` `tags.py` `audiosig.py` `keys.py` | walk, tag read (mutagen), audio signature `qsig` (dupe detection), key → Camelot |
| `names.py` `resolver.py` | NFC/NFD/SFM normalization, canonical names, path → file resolution (exact/case/unicode/sfm) |
| `engine.py` | Engine DJ `m.db` (schema 3.x) reader + `Writer` recording inverse steps; backup/restore; hot-journal recovery; `db_stamp` |
| `serato.py` | `database V2` + `Subcrates/*.crate` read/write, path rewrite, backups |
| `genres.py` | Turkish event genre canon + folder-name heuristics (setup proposal) |
| `relocate.py` | moves, folder rename/move, genre CRUD, setup preview/apply |
| `dedupe.py` | duplicate groups (exact / same audio / same song / Engine copies), keeper scoring, merge, tag-rich "content keeper" |
| `maintain.py` | auto path repair, relink, add genre files to Engine once, managed lists "Analiz bekleyenler" + "Türler/<Tür>" |
| `lists.py` | Engine-native lists/events (templates, notes, reorder) — edited directly in `m.db` |
| `mirror.py` | per-list two-way Serato crate mirror |
| `inbox.py` | `Müzik/DJ Gelen/<Tür>` → verify → SSD → Engine → `Müzik/DJ Arşiv/<ay>/<tür>`; Downloads watch |
| `journal.py` | `Op` (steps, Engine snapshots), `apply_inverse`, `undo_last` (prechecks → `UndoNeedsForce`) |
| `analysis.py` | v1 issue codes; v2 uses it for flags (bad audio, Prime 4 format, junk, bad names, low bitrate) |
| `util.py` | `safe_rename`, process detection (cached), drives, misc |
| `web/` | `index.html`, `app.js` (one file SPA: tabs **Müzikler / Listeler / Gelen**), `style.css` (light default) |

## 5. Formats and gotchas

- **Engine `m.db` 3.0.2** (`tests/fixtures/engine_schema_3_0_2.sql`):
  - `Playlist` is a linked list (`nextListId`) maintained by triggers. The after-delete trigger relinks and deletes only
    direct children (recursive triggers off), so delete trees bottom-up.
  - `PlaylistEntity` is a linked list (`nextEntityId`) with `UNIQUE(listId, databaseUuid, trackId)`. Entities point at
    tracks by `(originDatabaseUuid, originTrackId)`.
  - `Track` has `UNIQUE(path)`. A trigger forbids reusing deleted ids. Inserting a Track auto-inserts `PerformanceData`.
  - Drive DB paths are relative to `Engine Library` (`../Müzik/...`); the desktop DB uses absolute paths (`D:/...`).
  - Writes refuse schema major ≠ 3.
- **Serato**:
  - Data lives in `_Serato_/database V2` and `Subcrates/*.crate` (UTF-16BE TLV records).
  - Subcrate names are joined with `%%`. Paths are relative to the drive root.
  - The Mac writes NFD. Serato rewrites its DB on exit.
- **Names**:
  - On the Mac, Turkish letters are decomposed (NFD).
  - Characters that are illegal on exFAT become SFM private-use chars when the Mac writes them: `" * : < > ? \ |` map
    to U+F020–F027, and a trailing space or dot becomes U+F028 / U+F029 (Finder shows `/` for U+F022).
  - The canonical "disk form" is NFC + SFM; `names.loose_key` = case-insensitive match key.
- **Change detection**: exFAT mtime can be 1–2 s coarse and list renames don't change the file size. `engine.db_stamp`
  therefore includes the SQLite header plus an in-process write counter. Keep it that way.

## 6. Status

- Built and passing: setup wizard (genre folders), unsorted triage, duplicates (with tag preservation), problems,
  genre management, Engine-native lists/events, Serato mirror and crate import, inbox pipeline, undo, wrong-drive guard
  (2.0.1), process-check cache and Windows console fixes (2.0.2).
- **Not yet verified with the real apps**: that program-inserted Engine tracks and the managed lists show up correctly
  in Engine DJ desktop and on the Prime 4, and that analysis then turns them "ready". Verify on the user's machine with
  a copy first (backups are automatic).

## 7. Known issues — "takılıyor" (hangs / sluggish)

Fixed:
- **2.0.1:** picking the system drive started an endless full scan of `C:\` with no way out. The scan is now
  cancellable; cancelling the first scan undoes the selection; system and network drives are hidden from the SSD list.
- **2.0.1:** the drive list probed network drives (`listdir` on a disconnected share blocks for many seconds).
- **2.0.2:** `util.process_running` spawned `tasklist` on every call (UI poll every 4 s, background tick every 3 s,
  several calls per request). Results are now cached for 2.5 s, with a fresh check right before writes.
- **2.0.2:** Windows console QuickEdit could pause the process. Connection-abort tracebacks no longer go to the console.

Open (in priority order):
1. **Background `full_scan` holds `lib.lock` for the whole scan** (`App._tick`, every 240 s). Any action that needs the
   lock (list edits, moves, setup) waits, so the UI looks frozen on a large SSD. Do a lock-free stat walk and a short
   locked commit, or run it through `TaskManager` and let user tasks pre-empt it.
2. **One worker for all tasks**: a long task blocks the next one ("Sırada bekliyor…").
3. **Heavy re-renders**: views render up to 1,500 rows and `refresh()` refetches everything after every action
   (e.g. "Dans - Club" has 1,679 tracks). Needs virtualized lists and incremental updates.
4. **First scan of a big SSD** reads tags and an audio signature for every file over USB (minutes). Consider computing
   `qsig` lazily (only for dupe candidates).
5. Profile `engine_state()` / `dedupe.groups()` with ~5k files / ~4k Engine tracks.
6. Ask the user for `Documents/DJ Doktor/gunluk/djdoktor.log` and exact steps when he reports a hang.

## 8. Backlog — v1 capabilities to bring back (calm UI, actionable, no "reports")

v1 is commit **`d908bb4`** "v1.0 (kullanıcıya teslim edilen sürüm)" (tag `v1.0` if present):
`git show d908bb4:djdoktor/ops.py` etc. v2 removed `service`, `sync`, `ops`, `report`,
`events`, `exporters`. Bring the useful parts back as one-click actions inside the three tabs:

- **Health / Sağlık**: the flags are already computed (`library.compute_flags`) but only bad / unplayable / broken-path
  are shown. Also surface low bitrate (<192 kbps), missing tags, problem names (illegal chars, trailing dot/space, long
  paths, emoji), junk files (`._*`, `.DS_Store`), and Engine-made copies, each with a fix button
  (v1: `ops.plan_junk/apply_junk`, `ops.plan_rename/apply_rename`).
- **Event helpers**:
  - section **suggestions** (v1 `events.suggest`, by section keywords / genre / BPM);
  - **gig check** before an event: every track present, analyzed, Prime-4-playable, no duplicates; duration per section
    (v1 `service.gig_check`);
  - printable list (v2 has `/api/print/<id>`; link it in the UI).
- **Exports**: rekordbox XML with cues and M3U8 (v1 `exporters.py`).
- **Track detail** panel (all tags, cues, which lists/crates contain it) — v1 `service.track_detail`.
- Keep v2's principles: Turkish, light theme, short sentences, direct editing, everything undoable, Engine gets a song once.

## 9. Conventions

- Version lives in `djdoktor/__init__.py` (`VERSION`); bump it, update `BENIOKU.html` (short, Turkish), run
  `test_v2.py` (normal + exFAT) and `ui_smoke.py`, then `tools/package.py`.
- New write operation checklist:
  1. App-open guard.
  2. Backup.
  3. `journal.Op` with inverse steps (or an Engine/Serato snapshot).
  4. `maintain.after_change(lib, op)` before `op.commit()`.
  5. Test, including undo and the "changed in between" precheck.
- UI text: Turkish, friendly, at most one short sentence per hint; prefer a button over an explanation.
