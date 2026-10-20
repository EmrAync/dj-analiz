# CLAUDE.md — SahneCAD

Hand-off notes for future Claude sessions. Read this first.

## 1. The user and the goal

- Same user as the `dj-analiz` project (DJ Doktor): a Turkish mobile DJ / event technician in Germany
  (Denon Prime 4, Serato, weddings, henna nights, engagements, circumcision feasts, davul-zurna, live bands).
- He asked for a "very professional" **stage design app**: draw like a 3D AutoCAD, place every kind of gear
  (speakers, subs, monitors, instruments…), see cables like a Cisco diagram (name, type, length), see power
  cables, upload his own pictures for gear, prepare a drawing for another section/team/program, so that
  **someone who doesn't know the setup can build it** from the drawing. Think like a sound engineer, an
  analyst and an architect (room acoustics, environment).
- UI language: **Turkish** first (DE/EN complete as well). Calm, light UI; short sentences; buttons over text.
- The project lives on the **`sahne-cad` branch of `EmrAync/dj-analiz`** (orphan branch, no DJ Doktor files) because the
  session could not create a new repository. If he creates a separate repo, push this branch there as `main`.

## 2. Run, test, build

```bash
npm install
npm run dev                 # vite dev server :5180
npm run typecheck
npm test                    # node:test + tsx, tests/engine.test.ts (engine only, no DOM)
npm run build               # dist/
npx vite preview --port 4173 --strictPort &
node tests/ui_smoke.mjs http://127.0.0.1:4173/ shots   # every view, fails on JS errors
node tests/ui_flows.mjs http://127.0.0.1:4173/ shots   # cable tool, undo, drag, zone, schema drag-connect,
                                                       # exports (DXF/SVG/PNG/JSON), installer mode, DE setup, mobile
npm run release             # SahneCAD.html (single file, file://) + docs/ (app files for Pages)
npm run pages               # publish docs/ app files to the gh-pages branch → https://emraync.github.io/dj-analiz/
node tests/docs_shots.mjs http://127.0.0.1:4173/ docs  # README screenshots
```

Playwright comes from the global install (`/opt/node22/lib/node_modules/playwright` in the cloud container);
the scripts fall back to it. Chromium needs `--use-gl=swiftshader` for the 3D view in headless mode.
`window.__sahnecad` exposes the zustand store for tests/debugging.

**Always rebuild `SahneCAD.html` (`npm run release`) before committing a user-visible change** — the user
double-clicks that file.

## 3. Architecture

```
src/
  model/types.ts        Project, Area, Item, Cable, Zone, Note, EquipDef, PortGroup … (all metres/degrees)
  model/project.ts      catalog lookup (getDef), ports (portsOf), labels, makeItem, geometry helpers
  catalog/              equipment.ts (~150 defs, builder helpers), connectors.ts (connector families, cable
                        types, cableFits, stock lengths), categories.ts, icons.ts (SVG icon markup, 32×32)
  engine/               pure functions on a Project, memoised per (immutable) object via derive.ts
    cables.ts           paths (ortho/straight + waypoints), 3D length, slack, stock length, issues, port use
    power.ts            power tree, phases, circuits/breakers, generator kVA, voltage drop
    acoustics.ts        sources (arrays expanded), directivity, SPL grid (energy / coherent LF), RT60 Sabine/Eyring,
                        critical distance, delay suggestion, far field
    checks.ts           all warnings (i18n codes `chk.*`)
    bom.ts              equipment list + derived accessories + cable pack
    setup.ts            installer instructions (phases, positions from walls, aim point, power-on order)
    autowire.ts         addCable, autoSignal, autoPower (auto strips, auto sub-distro, circuit capacity, balancePhases)
    wizard.ts           runWizard: room, zones, PA sizing (throw distance → model, delays, arrays), DJ/band/davul,
                        lights, tables, power, then autowire
    lists.ts            patch/input list, CSV, DXF (R12 ASCII, layers per cable kind)
    coverage.ts         zone targets (dance 98 / tables 87 dB…; DIN 15905-5: Leq 30 min ≤ 99 dB(A)), per-group direct-energy grids + reverberant
                        field, gain optimiser (dance near-hard, reverb floor, D/R clarity), proposals (aim mains,
                        dance fills, side fills, delays), applyPlan/applyLevels, danceScan, profile rows
    eq.ts               target curves, RBJ peaking response, suggestEq (cuts first, GEQ 31, advice), feedbackPeaks
    activities.ts       setup steps → team activities, durations, dependencies, CPM (critical path), latest start
  audio/dsp.ts          fractional-octave bands, A/C weighting, UMIK-1 cal file parser, smoothing, demo curve
  audio/meter.ts        sound level meter: A/C weighting (first-order sections, bilinear + prewarp), LAF/LAS,
                        Leq, LCpeak, per-second history, rollingLeq, limit presets (DIN 15905-5, WHO), limitsOf
  audio/sweep.ts        radix-2 FFT, convolution, ESS sweep + inverse filter, sweepSequence, extractIRs (known
                        starts or blind matched-filter search), analyzeIR (arrivals, LF/HF arrival, Schroeder
                        T20/T30 per octave), alignSubTop (crossover phase-sum search), WAV writer, pink noise
  audio/engine.ts       Web Audio RTA (getUserMedia raw, AnalyserNode 16k FFT, scale self-check vs time domain),
                        calibration per device (localStorage), averaging, generator, feedback; ScriptProcessor
                        feeds Meter + 20 s ring buffer; measureSweep('self'|'external'); latency ref; wake lock
  store/store.ts        zustand: project + undo history (immer snapshots), UI state, prefs (localStorage)
  store/actions.ts      every user operation (add/move/rotate/duplicate/mirror/delete, connect, zones, areas, images, custom defs)
  store/persist.ts      IndexedDB (projects + personal library), file import/export, image downscaling
  views/plan/           PlanDrawing (pure SVG, also used for export/print), PlanView (camera, tools, pointer logic)
  views/three/          ThreeView (r3f scene, TransformControls, cones, heatmap), models.tsx (procedural models)
  views/schema/         SchemaView (signal/power block diagram, drag port→port)
  views/lists|analysis|setup|measure/   analysis/CoveragePanel, measure/MeasureView, setup/ActivityDiagram
  ui/                   TopBar, LeftPanel (library/layers/sections/checks), Inspector, StatusBar, dialogs, kit
  i18n/                 tr.ts (source of keys, TKey type), de.ts, en.ts (complete), makeT, L()
```

Coordinates: each area's top-left corner is (0,0); x → right, y → towards the audience (down on the plan),
z → up. `rot = 0` faces +y (audience). Three.js: plan (x, y) → (x, z), height → y, `rotation.y = -rot`,
pitch `rotation.x = -tilt`. Item `z` is the bottom edge above the local floor (stage zones raise the floor).

## 4. Conventions

- **Every string in the UI goes through `t('key')`**; add the key to `tr.ts` first (TS enforces it), then
  `de.ts` and `en.ts` (a script check: all three have 708+ identical keys). Catalog names use `L10n` objects.
- **Engine functions are pure** and cached with `derive(obj, key, fn)` on frozen project objects. Never call
  derived functions on an object you will mutate afterwards (the wizard returns a JSON clone for this reason).
- Mutations only via `st().mutate(fn, history?)`; drags call `checkpoint()` once, then `mutate(fn, false)`.
- Power cables are **directional** (`ends[0]` = socket side). `addCable` orients output → input.
- One cable per port (`connect()` refuses busy ports).
- Approximate brand data: keep the "values are approximate" hint; never claim manufacturer accuracy.
- Safety hints stay: 400 V by an electrician, rigging by a qualified rigger, keep escape routes clear.

## 5. Status (v0.3.0)

v0.3.0 (user: "legal limits optional, not fixed; measure delays between sub and satellite / main and delay;
make it usable on iPhone because the UMIK works there; not only RTA, also SPL dB"):
- Measure view tabs: dB meter (SplTab), RTA, Delay (DelayTab), EQ, Points. Calibration/generator behind the
  "Mikrofon ve kalibrasyon" button. `settings.limits` (on/off, preset, laeq/minutes/lcpeak).
- iPhone: mic needs https → GitHub Pages: https://emraync.github.io/dj-analiz/ served from branch **`gh-pages`**
  (app files only; Pages was enabled automatically when that branch was pushed). After `npm run release`,
  run `npm run pages` (scripts/pages.sh) to publish docs/ app files to gh-pages, then check the
  "pages build and deployment" run. `npm run release` writes SahneCAD.html AND docs/index.html + public/ PWA files
  (manifest, sw.js network-first offline cache, icons). main.tsx injects manifest/apple-touch-icon and registers
  the service worker only on https/localhost (never file:// or claude.ai). Hash routes: #plan #3d #sema
  #listeler #analiz #olcum #kurulum. Artifact preview has NO microphone capability.
- Tests: `tests/make_sweep_fixture.ts` writes a room recording (two arrivals 0/+23 ms, RT 0.9 s);
  ui_flows/docs_shots pass it to Chromium via `--use-file-for-fake-audio-capture=<absolute path>`.
  Headless Chromium runs the AudioContext at 44.1 kHz; capture shortens RT slightly (node on the same WAV
  gives the exact 0.90 s), arrivals are exact.
- iOS Safari may ignore `autoGainControl:false`; `dsp` state shows a warning when the browser reports
  processing on. Ask the user to set Control Centre → Mic Mode: Standard.

v0.2.0:

v0.2.0 (user request: "as the venue gets longer, where to add speakers; dance floor loud, tables pleasant;
dance-floor distance; UMIK-1 / ECM8000 live RTA with cut suggestions; setup as an activity diagram"):
- Analysis → **Ses dağılımı** panel (coverage.ts). Reverberant field is now part of `splGrid` mid band and
  `splPoint` (indoor only). Wizard indoor rooms use gypsum ceiling + 15 % curtains.
- **Ölçüm** view (key 6; setup moved to 7). Mic needs a secure context: works from `file://` in Chrome/Edge;
  blocked inside the claude.ai artifact preview. Fake mic for tests: Chromium flags
  `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream` (beeping tone; freeze before asserting levels).
- Setup view modes: flow diagram / Gantt / list (`activities.ts`). Event time from Project info (`meta.time`).
- `window.__sahnecadRta` exposes the RTA store for tests.
- UMIK-1 absolute SPL from "Sens Factor" is only approximate (depends on OS input gain); reference
  calibration is the primary path. Keep saying so in the UI.

v0.1.0:

Working and tested: all six views, library + custom gear + images, cable tool & dialog, schema drag-connect,
autowire signal/power, checks, BOM/cable pack/input/power lists + CSV, analysis, setup instructions in 3
languages, wizard, sections + cross-section cables, role views, installer mode, undo/redo, copy/paste,
mirror copy, DXF/SVG/PNG/JSON export, dark theme, mobile layout, single-file build.

## 6. Backlog / ideas (ask the user before big changes)

0. Coverage: per-band (63/125/…/8k) model, ground reflection, real speaker balloon data; transfer-function
   (dual-channel) measurement and impulse response / RT60 measurement with sweeps; measured points could
   calibrate the model.
1. **Programs/scenes** (e.g. "DJ set" vs "live band", ceremony vs dance): per-item visibility per program.
2. Truss load calculation (points, kg per hoist) and LED-wall processor port mapping.
3. Wireless frequency plan (Germany: 470–608 MHz, 823–832, 863–865 MHz) and IEM mixes.
4. PDF export with a title block; A3 plan sheets with scale bar (1:50/1:100).
5. Cable bundles (multicore/snake channels) and cable routing along walls/trays; auto ramps as items.
6. Import venue DXF; calibrate background image with two points.
7. Better SPL model (ground reflection, air absorption per band, measured balloon data).
8. Share via link / collaboration (would need a backend).
