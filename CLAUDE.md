# CLAUDE.md — DJ Doktor

Read this first. It is the hand-off from the sessions that built v1 and v2. The user (a Turkish mobile DJ in
Germany) wants Claude Code to keep developing the program. UI language is **Turkish**; code comments are mostly Turkish.
**Always answer the user in Turkish** (his own request, 17.10.2026). His "continue" messages after a usage-limit reset are
auto-generated in German — still answer in Turkish. His plan's usage limit fills quickly: multi-agent workflows (4–5
parallel agents, ~1–1.6 M tokens each run) exhausted it three times in 2.2; the container has 4 CPUs, so a workflow runs
only 2 agents at a time anyway. Prefer working directly; commit + push after every milestone so a limit stop loses nothing.

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
- Feedback (16.10.2026, second message): responsive layout everywhere ("scrollbars disappear / content runs off to the
  right"), a "professional program, not just HTML", bulk renaming of Turkish characters (Engine DJ) **without losing
  paths** (his example: a song ending in "Türkü" used in Serato crates, renamed to "Turku" → path lost), Camelot work,
  AI-supported list building ("which song can come after which"), and a folder on the desktop. Done in 2.2.0 (§6, §10).
- Feedback (16.10.2026): *"v1'de çok şey mümkündü, v2'de onların hiçbiri yok"* — v1 had many more capabilities
  that v2 dropped — and *"takılıyor, program çok sıkıntılı çalışıyor"* — it hangs / feels sluggish. Addressed in 2.1.0
  (§7, §8). His wish: the **simple use stays as it is** (Müzikler / Listeler / Gelen); professional v1 features live in
  a separate place (tab **Araçlar**); "world-class" breadth where it helps, without making the simple path busier.

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
python baslat.py [--app|--browser|--no-browser] [--console] [--port 8770]   # http://127.0.0.1:8770 (v1 used 8765)
python3 -B tests/test_v2.py [test_name ...]       # 12 end-to-end backend tests on a synthetic SSD (no pytest)
python3 -B tests/test_rename.py [test_name ...]   # 35 tests: bulk rename, conflicts, undo, relink after outside renames
python3 -B tests/test_assistant.py                # 14 tests: Camelot, transitions, sort, set builder, AI (fake opener), save
python3 -B tests/test_ai.py; python3 -B tests/test_desktop.py   # AI client (no network) / app window, icons, shortcuts, watchdog
python3 -B tests/ui_smoke.py /tmp/shots           # Playwright + Chromium click-through, screenshots, fails on JS/HTTP errors
python3 -B tests/ui_responsive.py /tmp/r          # responsive gate: 14 configs (360x640 … 2560x1440, zoom, large text, dark)
python3 -B tests/ui_rename.py /tmp/a; python3 -B tests/ui_assistant.py /tmp/b
python3 -B tests/bench_big.py [dir] [n_files]     # speed check: ~5k files, ~4k Engine tracks, big lists, 160 crates
python3 tools/package.py [dist_dir]               # user zip, top folder "DJ Doktor" (keeps CRLF .bat, chmod 755 .command)
```
UI tests take `DJD_UI_PORT` (default 8899/8902/…) so several can run at once.

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
- `ui_smoke.py` needs `pip install playwright` (Chromium is pre-installed under `/opt/pw-browsers`).
- Real-data sandbox (on the user's machine, never on the real SSD):
  `python -B tests/sbx_build.py <copy_READ_ONLY> <sandbox>` then `python -B tests/sbx_phase.py <sandbox> <work> 1|2|3|4`.
  Phase 4 undoes everything; `geri_alma.dosyalar_ayni / serato_ayni / engine_ayni` must all be `true`.
  Last run on a copy of his data (4,660 files, 326 Engine tracks, 162 crates): setup moved 3,641 files in 8 s,
  99 duplicate copies quarantined, full undo identical.

## 4. Architecture (v2)

| Module | Role |
|---|---|
| `baslat.py` | launcher; waits if an older instance is still running on the port |
| `djdoktor/server.py` | stdlib `ThreadingHTTPServer`, JSON API under `/api/*` (token header), `App` (active library, background loop `_tick`: quick jobs only when `lib.lock` is free — inbox every 4 s, Serato mirror every 30 s, maintenance/mirror when Engine/Serato close; interval scan every 240 s **without** the lock, cancelled as soon as a task starts) |
| `tasks.py` | task queue with two lanes: `scan` runs in the read lane, every writing task runs one after another in the main lane; only `scan` is cancellable (✕ in UI) |
| `config.py` | `Documents/DJ Doktor/ayarlar.json`: libraries, prefs |
| `library.py` | `Library`: catalog, `engine_state()` (single-flight, `seq`), `full_scan`, view caches (`cached(name, key, fn)` keyed by `view_key()` = catalog `gen` + `files_ver` + Engine state seq), views (`overview`, `tracks`, `file_states`, `library_table`, `track_detail`), flags |
| `catalog.py` | SQLite catalog **on the SSD** (`_DJDoktor_/katalog.db`, journal_mode=DELETE): files, genres, folder rules, journal, notes, Serato links, aliases, rel history, inbox |
| `scanner.py` `tags.py` `audiosig.py` `keys.py` | lock-free walk + tag read (one parser thread + readahead threads), short locked commits checked against `catalog.gen` (re-walk under lock if files moved meanwhile), audio signature `qsig` (dupe detection), key → Camelot |
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
| `analysis.py` | v1 issue codes; v2 uses it for flags (bad audio, Prime 4 format, junk, names, low bitrate, missing tags, Engine copies) |
| `health.py` | Araçlar > Sağlık: problem categories (live, cached) + fixes: junk → quarantine, safe rename (files + folders via `relocate`), Engine path repair, remove Engine records without a file (snapshot undo) |
| `events.py` | section suggestions, pre-gig check (`gig_check`), harmonic/tempo compatible tracks |
| `exporters.py` | rekordbox XML (with Serato cues), M3U8, library CSV → `Documents/DJ Doktor/Dışa Aktarım` |
| `ext.py` | route registry for feature modules: `@route(name, needs_lib)` → `/api/<name>/…`; modules listed in `ext.MODULES` |
| `renamer.py` | **Adlar** (2.2): rules (turkish_ascii via `names.ascii_tr`, fix_illegal/SFM, emoji, spaces, tr_case, safe regex…), presets `engine_safe` / `only_illegal` / `tidy`, scope all/genre/folder/files, `plan` (token + conflicts exists/twin/empty/genre_twin/too_long/same_audio/**ref_taken**), `apply`, `rename_one`; route `renamer` |
| `relocate.batch_rename` | many file + folder renames as ONE op, one backup per DB; Engine paths, Serato `database V2` + all crates (also mirrored) and genre rules follow; exFAT-safe (temp names, NFC/NFD twins via `_Taken`); refuses targets where another song's Engine/Serato record sits (`stale_ref_keys` / `ref_taken`) |
| `relink.py` | **Kayıp yollar** (2.2): Engine/Serato records whose file is gone → find the file (history `gecmis`, audio signature, simplified name + size/duration, folder-rename voting, name+size) with confidence kesin/yuksek/orta; `apply` = one op; background `auto()` applies only `kesin` and merges Engine records only when the dropped one has no user work (`merge_safe`); an undone relink is remembered (`relink_declined` meta) |
| `assistant.py` | **Asistan** (2.2): track model (cached by `view_key`), energy (Mixed In Key tag or genre+BPM estimate), `transition()` score 0–100 (key 40, tempo 30, energy 15, genre 15, learned pairs +15, same artist −12; weights in `WEIGHTS`), learned pairs from Engine lists, Serato crates, Engine `hm.db` and Serato history (read-only), `next_tracks`, `harmonic_sort` (greedy + 2-opt, ≤400), `build_set` (beam search, curves), AI set via `ai.ask_json` (≤250 candidates, metadata only, never paths), save via `lists` (journaled); route `assistant` |
| `ai.py` | Claude Messages API over urllib (no SDK: zero deps + Py 3.8): structured JSON output, server-side fallback, error codes → Turkish messages; key in prefs (`ai_api_key`, never returned to the UI); route `ai` (status/test) |
| `desktop.py` | app window (Edge/Chrome/Brave `--app`, own profile outside Documents), `Watchdog` (quit after window closed: heartbeat + `bye` beacon, never while a task runs), desktop shortcut (Windows .lnk via PowerShell, macOS `DJ Doktor.app`, Linux .desktop), icons drawn without deps (PNG/ICO/ICNS), run file `calisiyor.json`; route `app` (needs no library) |
| `util.py` | `safe_rename`, process detection (cached), drives, misc |
| `web/` | `index.html`, `app.js` (one file SPA: tabs **Müzikler / Listeler / Gelen** + **Araçlar**; virtual tables via `vtSet`; track detail drawer `openTrack`; `window.DJD` extension hooks), `style.css` (light default; responsive contract documented at the top), `ext/rename.*` (Araçlar > Adlar), `ext/assistant.*` (tab Asistan), `ext/desktop.*` (heartbeat, Ayarlar > Uygulama, "kapandı" overlay) |

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
- **Journal step kinds** (see `journal.py` header): `mv`, `mvdir`, `eng`, `engsnap`, `ser`, `sersnap`, `crate`, `serlink`,
  `hist` (rel_history rows), …  Undo prechecks: `journal.fs_changes` → changed outside since → `needs_force`; the old
  place now holds another file → `undo_blocked` (even with force). After a move use `journal.set_rel` (marks a stale
  catalog row at the target absent) instead of `catalog.update_rel`.
- **Change detection**: exFAT mtime can be 1–2 s coarse and list renames don't change the file size. `engine.db_stamp`
  therefore includes the SQLite header plus an in-process write counter. Keep it that way.

## 6. Status

- Built and passing: setup wizard (genre folders), unsorted triage, duplicates (with tag preservation), problems,
  genre management, Engine-native lists/events, Serato mirror and crate import, inbox pipeline, undo, wrong-drive guard
  (2.0.1), process-check cache and Windows console fixes (2.0.2).
- **2.1.0**: speed (§7) and the v1 features (§8): Araçlar tab (Sağlık with fixes, full library table, rekordbox XML /
  M3U8 / CSV export, history + backups), track detail drawer with compatible tracks, section suggestions, gig check,
  visible print button. Tested: `test_v2.py` 12/12 on ext4 and exFAT, Python 3.8 / 3.9 / 3.13; `ui_smoke.py` clean.
- **Not yet verified with the real apps**: that program-inserted Engine tracks and the managed lists show up correctly
  in Engine DJ desktop and on the Prime 4, and that analysis then turns them "ready". Verify on the user's machine with
  a copy first (backups are automatic).

- **2.2.0** (17.10.2026):
  - Responsive layout everywhere (§10), Araçlar > **Adlar** (bulk + single rename, Engine/Serato/crates follow, one undo),
    **Kayıp yollar** (relink after outside renames), tab **Asistan** (Camelot wheel, next track, set builder, harmonic
    sort, optional AI set with the user's own Anthropic key), app window + desktop shortcut + auto-quit, launchers
    without a console window (`baslat.py --detach`, pythonw on Windows).
  - Tested: test_v2 12/12 and test_rename 35/35 (ext4 + exFAT), test_assistant 14/14, test_ai 4/4, test_desktop 20/20
    (Py 3.13 + 3.8), every file compiles on 3.8/3.9; ui_smoke, ui_responsive (14 configs), ui_rename, ui_assistant clean.
  - Reviewed adversarially (rename + integration); found and fixed: renaming onto a path that another song's stale
    Engine/Serato record still holds, background merge dropping analyzed Engine records, undo after outside changes,
    genre folders merged in Finder, ambiguous outside renames re-added to Engine, background relink with a stale plan.
- **2.2.1** (17.10.2026): on his Windows PC the app window's heartbeat never reached the server, so the watchdog quit
  with `nostart` 180 s after every start (during a move at 85 % → "Failed to fetch", UI dead). Now every authenticated
  UI request counts as a heartbeat (`wd.hb("ui")`), START/TIMEOUT are 600 s, the shutdown log line includes the
  watchdog status, page JS errors are logged (`/api/app/log` → "arayüz: …"), the process waits for running tasks
  before exiting, and .js/.css MIME types are pinned (Windows registry). Root cause of the missing heartbeat is still
  unknown — check `djdoktor.log` for "arayüz:" lines on his machine.
- **Not yet verified with the real apps (2.2):** Windows .bat + pythonw start, the PowerShell .lnk, the macOS .app bundle
  (Gatekeeper, python3 from Finder's minimal PATH), Edge/Chrome `--app` windows, real Engine `hm.db` / Serato
  `History/Sessions` parsing (check `assistant.learned(lib)["info"]["history_sessions"] > 0` on his Mac), and renames
  seen by the real Engine DJ / Prime 4 / Serato. Test on his machine with a copy first.

## 7. Known issues — "takılıyor" (hangs / sluggish)

Fixed:
- **2.0.1:** picking the system drive started an endless full scan of `C:\` with no way out. The scan is now
  cancellable; cancelling the first scan undoes the selection; system and network drives are hidden from the SSD list.
- **2.0.1:** the drive list probed network drives (`listdir` on a disconnected share blocks for many seconds).
- **2.0.2:** `util.process_running` spawned `tasklist` on every call (UI poll every 4 s, background tick every 3 s,
  several calls per request). Results are now cached for 2.5 s, with a fresh check right before writes.
- **2.0.2:** Windows console QuickEdit could pause the process. Connection-abort tracebacks no longer go to the console.

- **2.1.0** (measured with `tests/bench_big.py`: 5,000 files, 4,000 Engine tracks, a 1,700-track genre):
  - The interval scan no longer holds `lib.lock`: walk and tag reading are lock-free, catalog writes are short locked
    batches checked against `Catalog.gen`; if a file was moved meanwhile the final step re-walks under the lock and reuses
    the tags it already read (`test_scan_while_moving`). The tick only does its quick jobs when the lock is free.
  - Two task lanes: a long scan no longer leaves user actions in "Sırada bekliyor…".
  - Tag parsing: 4 parser threads were ~3× slower than one (GIL convoy). Now one parser + 2 readahead threads
    (cold-cache USB benefit; on a warm local disk readahead costs ~0.2 ms/file).
  - UI: one checkbox click in a 1,700-row genre re-rendered the whole table (1.4–2.3 s); now virtual tables draw only
    the visible rows (~20 ms), search filters without rebuilding the view, scroll position survives refreshes.
  - Server: `audio_files`, `file_states`, overview, track views, dup index, health and library table are cached by
    `view_key()`; Engine state is read once for concurrent requests. Overview 0.3 s → 0.06 s cold / 0 s warm.
  - Engine writes without changes no longer touch `m.db` (no cache invalidation, no UI refresh); `maintain.run` skips
    when nothing changed since its last run (1.4 s → 0 s); list edits no longer re-read Engine when no Serato link exists;
    "fresh" process checks reuse a <0.5 s result (Windows spawned `tasklist` twice per edit).

Open:
1. Lazy `qsig` was **not** done: `qsig` is ~0.06 ms/file vs ~0.5 ms for tags locally, and maintain relinks and the inbox
   rely on it. Revisit only if a real USB profile shows signatures dominate.
2. `compute_flags` and `analyze_serato` still run over everything (under the lock) after a scan that found changes.
3. Readahead thread count is a guess for USB drives; measure on the user's SSD (Mac exFAT and Windows) if scans feel slow.
4. Ask the user for `Documents/DJ Doktor/gunluk/djdoktor.log` and exact steps when he reports a hang.

Open (2.2, low): a double fault during rollback (SSD unplugged mid-batch) cannot be journaled — recovery relies on
Kayıp yollar after reconnect; `/api/ping?hold=1` is unauthenticated (only delays auto-quit by 30 s); Engine history /
Serato sessions / .cue sheets keep old names after a rename; "İptal" of an AI request only abandons it (the server
finishes the call); the assistant chain in "Sonra ne çalınır?" lives only in the open page; the API key sits in
`Documents/DJ Doktor/ayarlar.json` (chmod 600; Documents may be cloud-synced on his Mac).

## 8. v1 capabilities (brought back in 2.1.0)

v1 is commit **`d908bb4`** "v1.0 (kullanıcıya teslim edilen sürüm)": `git show d908bb4:djdoktor/ops.py` etc.
Placement rule: the three simple tabs stay as they were; event helpers sit where events are edited (Listeler);
everything else is in **Araçlar**.

- **Sağlık** (`health.py`): bad / partial files (quarantine), Engine records without a file (remove, snapshot undo),
  broken Engine paths (repair now), problem names incl. NFD and Mac SFM chars (safe rename of files and folders; Engine and
  Serato paths follow), junk files (quarantine), unplayable format, Engine-made copies (→ Kopyalar), long paths, emoji
  (optional cleanup), low bitrate, missing tags. Codes are computed live (stored flags go stale after moves).
- **Events** (`events.py`, Listeler tab): `✨ Öneri` chip = suggestions for the selected section (genre folder matching
  the section name, keyword map, crate/list names, folder names, tags, tempo of the section); `✓ Kontrol et` = gig check
  with per-section durations and a "Şimdi onar" for broken paths; `🖨 Yazdır` button.
- **Exports** (`exporters.py`): rekordbox XML with cues/loops, M3U8 per list, CSV for Excel (`;`, UTF-8 BOM). Sources:
  one list/event, all Engine lists, or genre folders.
- **Track detail** (`Library.track_detail`, drawer): tags, Serato cues, Engine data, lists/crates, duplicates, issues,
  compatible tracks (same/adjacent Camelot, ±6 % BPM incl. half/double time).
- **Full library table** (`Library.library_table`): sortable, column chooser, quick filters, virtualized.

Ideas not done (ask the user first): writing tags into files (touches originals — rule 1), smart crates, set-time
planning per section, sharing an event list as PDF.

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
- Caches: every change to the `files` table must go through `Catalog` methods (they bump `Catalog.gen`); genre / rule
  changes call `lib.bump()`. Views cached with `lib.cached(...)` must not mutate shared rows (`audio_files()` is shared).
- Long tables in the UI use `vtSet(tableId, rows, rowHtml)` with `table.t.v` + a `<colgroup>`: rows have a fixed
  height and never wrap. Selection changes call `syncSel()`, not a re-render.

## 10. 2.2 notes for developers

- **Responsive contract** (top of `style.css`): `.ell` / `.ell2` / `.wrap-any` / `.minw0`; containers get
  `data-w="xs|s|m|l|xl|xxl"` (30/45/60/75/100 rem) and `#view` `data-h`; columns `<col data-w data-min data-max data-flex
  data-pri data-off>` (vtSet tables fit automatically, plain tables via `DJD.fitCols`); `DJD.popover`, `menu(ev, items)`
  (flips/clamps, closes on scroll/Esc), `DJD.restoreScroll`, `DJD.genreStyle(color)` + `.gtx/.gfill` (genre colours
  ≥ 4.5:1 in both themes), `--accent-fill` / `--bad-fill` behind white text, `data-dock` bottom bars lift toasts.
  `tests/ui_responsive.py` is the gate — add new screens to it.
- **Rename safety**: never rename a file onto a path where Engine/Serato still has another song's record (conflict
  `ref_taken`, UI "Bu adla başka şarkı kayıtlı", optional " (2)"); app-open checks are fresh right before writing,
  also re-checked after the long file-system phase; any failure rolls back files, catalog, Engine and Serato.
- **Desktop**: `Baslat_Windows.bat` / `Baslat_Mac.command` call `baslat.py --detach` (Windows: pythonw, no console; add
  "konsol" to keep the console). The app window's browser profile lives in `%LOCALAPPDATA%\DJ Doktor\Pencere`,
  `~/Library/Application Support/DJ Doktor/Pencere` or `~/.config/djdoktor/Pencere`. The server quits after the window
  closes (grace for reloads, never during a task); never in `--no-browser` mode or in tests.
- **AI**: only metadata is sent (index, title, artist, genre, BPM, Camelot, energy, duration, played-together hints) —
  a test asserts no paths in the request. Without a key everything works offline.
