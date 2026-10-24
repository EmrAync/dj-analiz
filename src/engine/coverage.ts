// Ses kapsama tasarımı: bölge hedefleri (pist yüksek, masalar konforlu), seviye planı,
// delay / pist hoparlörü önerileri, pist mesafesi taraması ve mesafe profili.
// Model: orta bant (1 kHz). Her hoparlör grubu için doğrudan ses ızgarası + yankı alanı (Hopkins–Stryker)
// tutulur; grup kazançları (dB) hedeflerden sapmayı ve masalardaki anlaşılırlık kaybını (D/R) en aza
// indirecek şekilde aranır.
import { CATALOG, floorElevAt, getDef, makeItem, nextLabel } from '../model/project';
import type { Item, Project, Zone, ZoneKind } from '../model/types';
import { midLevel, reverbOf, roomAcoustics, roomConstant, sourcesOf, speedOfSound, type Source, type SplGrid } from './acoustics';
import { autoPower, autoSignal } from './autowire';
import { derive } from './derive';
import { activeView } from '../model/variants';

// —— Bölge hedefleri ——
// pist 98: DIN 15905-5 (Almanya) seyirci alanında 30 dk Leq ≤ 99 dB(A)
export const ZONE_TARGETS: Partial<Record<ZoneKind, number>> = { dance: 98, audience: 96, tables: 87, bar: 82 };
const PRIO: Record<ZoneKind, number> = { dance: 0, audience: 1, foh: 2, tables: 3, bar: 4, custom: 5, stage: 6, walkway: 7, backstage: 8, nogo: 9 };
// [ağırlık, fazla ses çarpanı, eksik ses çarpanı, anlaşılırlık ağırlığı]
const WEIGHT: Record<ZoneKind, [number, number, number, number]> = {
  dance: [3, 1, 6, 0],
  audience: [1.5, 1, 1, 1],
  tables: [1, 1.2, 0.8, 1],
  bar: [0.6, 1.3, 0.7, 0.6],
  foh: [1, 1, 1, 1],
  custom: [1, 1, 1, 0.5],
  stage: [0.5, 1, 1, 0],
  walkway: [0.3, 1, 1, 0],
  backstage: [0.3, 1, 1, 0],
  nogo: [0.3, 1, 1, 0],
};
export const DR_MIN = -8; // doğrudan/yankı oranı alt sınırı (dB) — altında konuşma bulanıklaşır
const CLW = 0.6;
const SUPPORT = 3; // destek grupları (delay, fill) ana sistemden en fazla bu kadar yüksek olabilir (dB)

export function zoneTarget(z: Zone): number | null {
  if (z.target != null && !isNaN(z.target)) return z.target > 0 ? z.target : null;
  return ZONE_TARGETS[z.kind] ?? null;
}

export function targetZones(p: Project, areaId: string): Zone[] {
  return p.zones.filter((z) => z.areaId === areaId && zoneTarget(z) != null).sort((a, b) => PRIO[a.kind] - PRIO[b.kind]);
}

function zoneAt(zs: Zone[], x: number, y: number): Zone | undefined {
  for (const z of zs) if (x >= z.x && x <= z.x + z.w && y >= z.y && y <= z.y + z.d) return z;
  return undefined;
}

// İnce ızgara (ısı haritası) için hücre başına hedef
export function targetGrid(p: Project, areaId: string, g: SplGrid): Float32Array {
  return derive(g, 'tg', () => {
    const zs = targetZones(p, areaId);
    const out = new Float32Array(g.nx * g.ny).fill(NaN);
    for (let j = 0; j < g.ny; j++)
      for (let i = 0; i < g.nx; i++) {
        const z = zoneAt(zs, (i + 0.5) * g.step, (j + 0.5) * g.step);
        if (z) out[j * g.nx + i] = zoneTarget(z)!;
      }
    return out;
  });
}

// Hedeften sapma renkleri: mavi (az) — yeşil (hedef) — kırmızı (fazla)
export function devColor(dev: number): [number, number, number, number] {
  if (isNaN(dev)) return [0, 0, 0, 0];
  const stops: [number, [number, number, number]][] = [
    [-12, [30, 64, 175]],
    [-6, [56, 152, 236]],
    [-3, [125, 211, 252]],
    [0, [34, 197, 94]],
    [3, [250, 204, 21]],
    [6, [249, 115, 22]],
    [12, [220, 38, 38]],
  ];
  const d = Math.max(-12, Math.min(12, dev));
  if (Math.abs(d) <= 1.5) return [34, 197, 94, 165];
  for (let i = 0; i < stops.length - 1; i++) {
    const [a, ca] = stops[i];
    const [b, cb] = stops[i + 1];
    if (d >= a && d <= b) {
      const f = (d - a) / (b - a);
      return [ca[0] + (cb[0] - ca[0]) * f, ca[1] + (cb[1] - ca[1]) * f, ca[2] + (cb[2] - ca[2]) * f, 165];
    }
  }
  return [220, 38, 38, 165];
}

// —— Hücreler ——
interface Cells {
  n: number;
  x: Float64Array;
  y: Float64Array;
  z: Float64Array;
  T: Float64Array;
  W: Float64Array;
  ow: Float64Array;
  uw: Float64Array;
  cl: Float64Array;
  rf: Uint8Array; // 1: fazla ses cezası yankı tabanından başlar (ana bölge hariç)
  zi: Int32Array;
  zones: Zone[];
  step: number;
  R: number | null; // oda sabiti (açık havada null)
}

function buildCells(p: Project, areaId: string, zonesIn: Zone[], maxCells: number): Cells | null {
  const area = p.areas.find((a) => a.id === areaId);
  if (!area) return null;
  const zs = zonesIn.filter((z) => z.areaId === areaId && zoneTarget(z) != null).sort((a, b) => PRIO[a.kind] - PRIO[b.kind]);
  if (!zs.length) return null;
  const tot = zs.reduce((s, z) => s + z.w * z.d, 0);
  const step = Math.max(0.3, Math.sqrt(tot / maxCells));
  const A: number[][] = [[], [], [], [], [], [], [], [], []];
  const nx = Math.ceil(area.w / step);
  const ny = Math.ceil(area.d / step);
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const x = (i + 0.5) * step;
      const y = (j + 0.5) * step;
      if (x > area.w || y > area.d) continue;
      const z = zoneAt(zs, x, y);
      if (!z) continue;
      const w = WEIGHT[z.kind];
      A[0].push(x);
      A[1].push(y);
      A[2].push(floorElevAt(p.zones, areaId, x, y) + p.settings.earH);
      A[3].push(zoneTarget(z)!);
      A[4].push(w[0]);
      A[5].push(w[1]);
      A[6].push(w[2]);
      A[7].push(w[3]);
      A[8].push(zs.indexOf(z));
    }
  if (!A[0].length) return null;
  const F = (k: number) => Float64Array.from(A[k]);
  const prim = zs.indexOf(primaryOf(zs));
  return { n: A[0].length, x: F(0), y: F(1), z: F(2), T: F(3), W: F(4), ow: F(5), uw: F(6), cl: F(7), rf: Uint8Array.from(A[8].map((v) => (v === prim ? 0 : 1))), zi: Int32Array.from(A[8]), zones: zs, step, R: roomConstant(area) };
}

interface GE {
  d: Float64Array; // doğrudan ses enerjisi
  r: number; // yankı enerjisi (her yerde aynı)
}

function energy(srcs: Source[], cells: Cells): GE {
  const d = new Float64Array(cells.n);
  let r = 0;
  for (const s of srcs) {
    if (s.kind === 'sub' || s.kind === 'iem') continue;
    r += reverbOf(s, cells.R);
    for (let i = 0; i < cells.n; i++) d[i] += Math.pow(10, midLevel(s, cells.x[i], cells.y[i], cells.z[i]) / 10);
  }
  return { d, r };
}

// —— Hoparlör grupları ——
export interface SpkGroup {
  key: string;
  role: string;
  items: string[];
  labels: string[];
  head: number; // kazanç en fazla bu kadar artabilir (dB)
}

function isCoverSpeaker(p: Project, it: Item): boolean {
  const a = getDef(p, it.defId).acoustic;
  if (!a || it.hidden) return false;
  if (a.kind === 'sub' || a.kind === 'iem' || a.kind === 'monitor') return false;
  return it.role !== 'monitor' && it.role !== 'sub';
}

function isSub(p: Project, it: Item): boolean {
  return !it.hidden && getDef(p, it.defId).acoustic?.kind === 'sub';
}

function groupsOf(p: Project, areaId: string): SpkGroup[] {
  const m = new Map<string, SpkGroup>();
  for (const it of p.items) {
    if (it.areaId !== areaId || !isCoverSpeaker(p, it)) continue;
    const role = it.role || 'main';
    const key = role === 'main' ? 'main' : role + ':' + Math.round(it.y / 4);
    let g = m.get(key);
    if (!g) {
      g = { key, role, items: [], labels: [], head: 30 };
      m.set(key, g);
    }
    g.items.push(it.id);
    g.labels.push(it.label);
    g.head = Math.min(g.head, -(p.settings.level + (it.gainDb || 0)));
  }
  return [...m.values()].sort((a, b) => (a.key === 'main' ? -1 : b.key === 'main' ? 1 : a.key.localeCompare(b.key)));
}

// —— Değerlendirme ——
interface Lv {
  L: Float64Array;
  DR: Float64Array;
  lr: number; // yankı alanı seviyesi (dB, her yerde aynı); açık havada -Infinity
}

function levels(E: GE[], g: number[], n: number): Lv {
  const L = new Float64Array(n);
  const DR = new Float64Array(n);
  const a = g.map((x) => Math.pow(10, x / 10));
  let r = 0;
  for (let k = 0; k < E.length; k++) r += a[k] * E[k].r;
  for (let i = 0; i < n; i++) {
    let d = 0;
    for (let k = 0; k < E.length; k++) d += a[k] * E[k].d[i];
    const s = d + r;
    L[i] = s > 0 ? 10 * Math.log10(s) : -50;
    DR[i] = r > 0 ? 10 * Math.log10(Math.max(1e-12, d) / r) : 99;
  }
  return { L, DR, lr: r > 0 ? 10 * Math.log10(r) : -Infinity };
}

// Fazla ses cezası yankı tabanının altına inemez: salonun yankısı hoparlör seçimiyle düşürülemez
function cellCost(c: Cells, i: number, L: number, DR: number, lr: number): number {
  let s = 0;
  const T = c.T[i];
  const over = c.rf[i] ? L - Math.max(T, lr + 1) : L - T;
  const d = L - T;
  if (over > 1) s += c.W[i] * c.ow[i] * (over - 1) * (over - 1);
  else if (d < -1) s += c.W[i] * c.uw[i] * (d + 1) * (d + 1);
  if (c.cl[i] > 0 && DR < DR_MIN) s += c.W[i] * c.cl[i] * CLW * (DR_MIN - DR) * (DR_MIN - DR);
  return s;
}

function costOf(lv: Lv, c: Cells): number {
  let s = 0;
  for (let i = 0; i < c.n; i++) s += cellCost(c, i, lv.L[i], lv.DR[i], lv.lr);
  return s;
}

function optimize(E: GE[], c: Cells, hi: number[], sweeps = 3, mainIdx = 0): { g: number[]; cost: number } {
  const K = E.length;
  const g = hi.map((h) => Math.min(h, 0));
  const restD = new Float64Array(c.n);
  let restR = 0;
  const evalK = (k: number, x: number): number => {
    const a = Math.pow(10, x / 10);
    const r = restR + a * E[k].r;
    const lr = r > 0 ? Math.log10(r) : 0;
    const lrDb = r > 0 ? 10 * lr : -Infinity;
    let s = 0;
    for (let i = 0; i < c.n; i++) {
      const d = restD[i] + a * E[k].d[i];
      const tot = d + r;
      const L = tot > 0 ? 10 * Math.log10(tot) : -50;
      const DR = c.cl[i] > 0 && r > 0 ? 10 * (Math.log10(Math.max(1e-12, d)) - lr) : 99;
      s += cellCost(c, i, L, DR, lrDb);
    }
    return s;
  };
  for (let sweep = 0; sweep < (K > 1 ? sweeps : 1); sweep++) {
    for (let k = 0; k < K; k++) {
      restD.fill(0);
      restR = 0;
      for (let j = 0; j < K; j++) {
        if (j === k) continue;
        const a = Math.pow(10, g[j] / 10);
        restR += a * E[j].r;
        for (let i = 0; i < c.n; i++) restD[i] += a * E[j].d[i];
      }
      // destek grupları ana sistemi geçemez; ana sistem destek gruplarının çok altına inemez
      let lo = -30;
      let up = hi[k];
      if (K > 1 && mainIdx >= 0 && mainIdx < K) {
        if (k === mainIdx) lo = Math.max(lo, Math.max(...g.filter((_, j) => j !== k)) - SUPPORT);
        else up = Math.min(up, g[mainIdx] + SUPPORT);
      }
      let a0 = Math.min(lo, up - 0.1);
      let b0 = Math.max(a0 + 0.1, up);
      const r = 0.618034;
      let x1 = b0 - r * (b0 - a0);
      let x2 = a0 + r * (b0 - a0);
      let f1 = evalK(k, x1);
      let f2 = evalK(k, x2);
      for (let it = 0; it < 16; it++) {
        if (f1 < f2) {
          b0 = x2;
          x2 = x1;
          f2 = f1;
          x1 = b0 - r * (b0 - a0);
          f1 = evalK(k, x1);
        } else {
          a0 = x1;
          x1 = x2;
          f1 = f2;
          x2 = a0 + r * (b0 - a0);
          f2 = evalK(k, x2);
        }
      }
      g[k] = (a0 + b0) / 2;
    }
  }
  return { g, cost: costOf(levels(E, g, c.n), c) };
}

export interface ZoneEval {
  zoneId: string;
  name: string;
  kind: ZoneKind;
  target: number;
  avg: number;
  min: number;
  max: number;
  p10: number;
  p90: number;
  ok: number; // hedef ±3 dB içindeki oran
  under: number;
  over: number;
  overEff: number; // yankı tabanı üstünde (hoparlörle düzeltilebilir) fazla ses oranı
  clear: number; // anlaşılırlığı yeterli oran (D/R ≥ sınır); dans pistinde NaN
}

function evalZones(lv: Lv, c: Cells): ZoneEval[] {
  return c.zones.map((z, zi) => {
    const v: number[] = [];
    let clear = 0;
    let cn = 0;
    let oe = 0;
    for (let i = 0; i < c.n; i++)
      if (c.zi[i] === zi) {
        v.push(lv.L[i]);
        if (lv.L[i] > (c.rf[i] ? Math.max(c.T[i], lv.lr + 1) : c.T[i]) + 3) oe++;
        if (c.cl[i] > 0) {
          cn++;
          if (lv.DR[i] >= DR_MIN) clear++;
        }
      }
    const T = zoneTarget(z)!;
    if (!v.length) return { zoneId: z.id, name: z.name, kind: z.kind, target: T, avg: NaN, min: NaN, max: NaN, p10: NaN, p90: NaN, ok: 0, under: 0, over: 0, overEff: 0, clear: NaN };
    v.sort((a, b) => a - b);
    const q = (f: number) => v[Math.min(v.length - 1, Math.floor(f * v.length))];
    const n = v.length;
    return {
      zoneId: z.id,
      name: z.name,
      kind: z.kind,
      target: T,
      avg: v.reduce((a, b) => a + b, 0) / n,
      min: v[0],
      max: v[n - 1],
      p10: q(0.1),
      p90: q(0.9),
      ok: v.filter((x) => Math.abs(x - T) <= 3).length / n,
      under: v.filter((x) => x < T - 3).length / n,
      over: v.filter((x) => x > T + 3).length / n,
      overEff: oe / n,
      clear: cn ? clear / cn : NaN,
    };
  });
}

// —— Öneriler ——
export type ProposalKind = 'aim' | 'danceFill' | 'delay' | 'fill';

export interface NewSpeaker {
  defId: string;
  x: number;
  y: number;
  z: number;
  rot: number;
  tilt: number;
  role: 'delay' | 'fill';
  delayMs: number;
  prefix: string;
}

export interface Proposal {
  id: string;
  kind: ProposalKind;
  zoneName?: string;
  add: NewSpeaker[];
  change: { itemId: string; patch: Partial<Item> }[];
  gain: number; // sapma azalması (0–1)
  ms?: number;
  dist?: number;
  clarity?: boolean; // anlaşılırlık için önerildi
}

export interface LevelChange {
  key: string;
  role: string;
  labels: string[];
  delta: number; // hoparlör çıkışındaki değişim (dB)
}

export interface Advice {
  code: 'reverb' | 'outdoorLong' | 'farDance';
  vars: Record<string, string | number>;
}

export interface CoveragePlan {
  noZones: boolean;
  noSpeakers: boolean;
  now: ZoneEval[];
  levelOnly: ZoneEval[];
  levelChanges: LevelChange[];
  proposals: Proposal[];
  final: ZoneEval[];
  rmsNow: number;
  rmsLevel: number;
  rmsFinal: number;
  headShort: number; // pist hedefi için eksik pay (dB)
  advice: Advice[];
  gains: Record<string, number>; // grup anahtarı / öneri id → kazanç değişimi (tüm öneriler uygulanınca)
  subDelta: number; // sub'ların izleyeceği ana bölge değişimi
  cells: Cells | null;
  Lnow: Float64Array | null;
  Lfinal: Float64Array | null;
}

const rad = Math.PI / 180;
const aimRot = (fx: number, fy: number, tx: number, ty: number) => Math.round(Math.atan2(-(tx - fx), ty - fy) / rad);
const round1 = (v: number) => Math.round(v * 10) / 10;
const half = (v: number) => Math.round(v * 2) / 2;

function srcFor(p: Project, areaId: string, items: Item[]): Source[] {
  // geçici proje: türetilmiş önbellek yeni nesneye bağlanır
  const q: Project = { ...p, items };
  return sourcesOf(q, areaId);
}

function specItem(p: Project, areaId: string, s: NewSpeaker, idx: number): Item {
  const it = makeItem(p, CATALOG[s.defId], areaId, s.x, s.y, { z: s.z, rot: s.rot, tilt: s.tilt, role: s.role, mount: 'stand', delayMs: s.delayMs });
  it.id = 'tmp' + idx;
  return it;
}

function rmsOf(cost: number, c: Cells): number {
  let w = 0;
  for (let i = 0; i < c.n; i++) w += c.W[i];
  return Math.sqrt(cost / Math.max(1e-9, w));
}

function mainsOf(p: Project, areaId: string): Source[] {
  const srcs = sourcesOf(p, areaId).filter((s) => s.kind !== 'sub' && s.kind !== 'monitor' && s.kind !== 'iem');
  const m = srcs.filter((s) => s.role === 'main' || s.role == null || s.kind === 'array');
  return m.length ? m : srcs;
}

function alignMs(p: Project, areaId: string, x: number, y: number, z: number, ax: number, ay: number, haas: number): number {
  const mains = mainsOf(p, areaId);
  if (!mains.length) return 0;
  const c = speedOfSound(p.env.tempC);
  const az = floorElevAt(p.zones, areaId, ax, ay) + p.settings.earH;
  let dm = Infinity;
  for (const m of mains) dm = Math.min(dm, Math.hypot(ax - m.x, ay - m.y, az - m.z));
  const d = Math.hypot(ax - x, ay - y, az - z);
  return Math.max(0, round1(((dm - d) / c) * 1000 + haas));
}

function tiltTo(zc: number, earH: number, dist: number): number {
  return -Math.max(0, Math.min(15, Math.round(Math.atan((zc - earH) / Math.max(1, dist)) / rad)));
}

function inRect(z: { x: number; y: number; w: number; d: number }, x: number, y: number, m = 0): boolean {
  return x >= z.x - m && x <= z.x + z.w + m && y >= z.y - m && y <= z.y + z.d + m;
}

export function coveragePlan(p: Project, areaId: string): CoveragePlan {
  const pv = activeView(p);
  if (pv !== p) return coveragePlan(pv, areaId);
  return derive(p, 'cov:' + areaId, () => planImpl(p, areaId));
}

function primaryOf(zones: Zone[]): Zone {
  return zones.find((z) => z.kind === 'dance') || zones[0];
}

function planImpl(p: Project, areaId: string): CoveragePlan {
  const empty: CoveragePlan = { noZones: false, noSpeakers: false, now: [], levelOnly: [], levelChanges: [], proposals: [], final: [], rmsNow: 0, rmsLevel: 0, rmsFinal: 0, headShort: 0, advice: [], gains: {}, subDelta: 0, cells: null, Lnow: null, Lfinal: null };
  const area = p.areas.find((a) => a.id === areaId);
  const cells = area ? buildCells(p, areaId, p.zones, 1800) : null;
  if (!area || !cells) return { ...empty, noZones: true };
  const groups = groupsOf(p, areaId);
  if (!groups.length) return { ...empty, noSpeakers: true, cells };
  const srcs = sourcesOf(p, areaId);
  const G: { key: string; role: string; head: number; E: GE }[] = groups.map((g) => ({ key: g.key, role: g.role, head: g.head, E: energy(srcs.filter((s) => g.items.includes(s.itemId)), cells) }));
  const E0 = G.map((g) => g.E);
  const lvNow = levels(E0, E0.map(() => 0), cells.n);
  const costNow = costOf(lvNow, cells);
  const now = evalZones(lvNow, cells);
  const run = () => optimize(G.map((g) => g.E), cells, G.map((g) => g.head), 3, G.findIndex((g) => g.key === 'main'));
  let best = run();
  const lvl = best;
  const levelOnly = evalZones(levels(E0, lvl.g, cells.n), cells);
  const proposals: Proposal[] = [];
  const dance = cells.zones.find((z) => z.kind === 'dance');
  const primary = primaryOf(cells.zones);
  const pc = { x: primary.x + primary.w / 2, y: primary.y + primary.d * 0.55 };
  const earH = p.settings.earH;
  const evalCur = () => evalZones(levels(G.map((g) => g.E), best.g, cells.n), cells);

  // 1 — Ana hoparlörler: yükselt + piste çevir (diğer bölgeler ana sisteme göre çok yüksekse)
  {
    const ev = evalCur();
    const loudOthers = ev.some((e) => e.kind !== primary.kind && e.overEff > 0.2);
    const mainItems = p.items.filter((it) => it.areaId === areaId && isCoverSpeaker(p, it) && (it.role || 'main') === 'main' && getDef(p, it.defId).acoustic!.kind === 'top');
    const mg = G.findIndex((g) => g.key === 'main');
    if (loudOthers && mainItems.length && mg >= 0) {
      const items = p.items.map((it) => {
        if (!mainItems.includes(it)) return it;
        const d = getDef(p, it.defId);
        const z = Math.min(Math.max(it.z, 2.3), Math.max(it.z, area.h - d.h - 0.4));
        const side = Math.sign(it.x - pc.x) || 1;
        const rot = aimRot(it.x, it.y, pc.x + side * 0.8, pc.y);
        const dist = Math.hypot(pc.x - it.x, pc.y - it.y);
        const tilt = tiltTo(z + d.h / 2, earH, dist);
        return { ...it, z: round1(z), rot, tilt, mount: it.mount === 'pole' && z <= it.z ? it.mount : ('stand' as const) };
      });
      const old = G[mg].E;
      G[mg].E = energy(srcFor(p, areaId, items).filter((s) => mainItems.some((m) => m.id === s.itemId)), cells);
      const r = run();
      if (r.cost < best.cost * 0.93) {
        const ch: Proposal['change'] = [];
        for (const it of items) if (mainItems.some((m) => m.id === it.id)) ch.push({ itemId: it.id, patch: { z: it.z, rot: it.rot, tilt: it.tilt, mount: it.mount } });
        proposals.push({ id: 'aim', kind: 'aim', add: [], change: ch, gain: 1 - r.cost / best.cost });
        best = r;
      } else G[mg].E = old;
    }
  }

  let tmpN = 0;
  // clarityZone: bu bölgenin anlaşılırlığı belirgin artıyor ve toplam sapma çok kötüleşmiyorsa da kabul et
  const tryAdd = (sp: NewSpeaker[], key: string, role: string, minGain: number, clarityZone?: string): number | null => {
    const tmp = sp.map((s) => specItem(p, areaId, s, tmpN++));
    const ids = new Set(tmp.map((t) => t.id));
    const E = energy(srcFor(p, areaId, [...p.items, ...tmp]).filter((s) => ids.has(s.itemId)), cells);
    const before = clarityZone ? evalCur().find((e) => e.zoneId === clarityZone) : undefined;
    G.push({ key, role, head: -p.settings.level, E });
    const r = run();
    let ok = r.cost < best.cost * (1 - minGain);
    if (!ok && before && !isNaN(before.clear)) {
      const after = evalZones(levels(G.map((g) => g.E), r.g, cells.n), cells).find((e) => e.zoneId === clarityZone)!;
      ok = after.clear - before.clear >= 0.2 && after.avg - before.avg <= 2 && r.cost <= best.cost * 1.08;
    }
    if (ok) {
      const gain = Math.max(0, 1 - r.cost / Math.max(1e-9, best.cost));
      best = r;
      return gain;
    }
    G.pop();
    return null;
  };

  // 2 — Pist hoparlörleri
  if (dance) {
    const evs = evalCur();
    const ev = evs.find((e) => e.zoneId === dance.id)!;
    const mi = G.findIndex((g) => g.key === 'main');
    const capped = mi >= 0 && best.g[mi] > G[mi].head - 0.5;
    const othersLoud = evs.some((e) => e.kind !== 'dance' && e.overEff > 0.25);
    if (ev.under > 0.15 || ev.p90 - ev.p10 > 8 || (capped && ev.avg < ev.target - 2) || othersLoud) {
      const n = dance.w * dance.d > 70 ? 4 : 2;
      const ys = n === 4 ? [dance.y + dance.d * 0.25, dance.y + dance.d * 0.75] : [dance.y + dance.d * 0.5];
      const sp: NewSpeaker[] = [];
      const cx = dance.x + dance.w / 2;
      const cy = dance.y + dance.d / 2;
      for (const y of ys)
        for (const side of [-1, 1]) {
          const x = Math.max(0.4, Math.min(area.w - 0.4, side < 0 ? dance.x - 0.5 : dance.x + dance.w + 0.5));
          const dist = Math.hypot(cx - x, cy - y);
          const def = CATALOG['top-12a'];
          const z = 1.9;
          sp.push({ defId: def.id, x: round1(x), y: round1(y), z, rot: aimRot(x, y, cx, cy), tilt: tiltTo(z + def.h / 2, earH, dist), role: 'fill', delayMs: alignMs(p, areaId, x, y, z + def.h / 2, cx, cy, 5), prefix: 'DF' });
        }
      const g = tryAdd(sp, 'dancefill', 'fill', 0.1);
      if (g != null) proposals.push({ id: 'dancefill', kind: 'danceFill', zoneName: dance.name, add: sp, change: [], gain: g, ms: Math.max(...sp.map((s) => s.delayMs)) });
    }
  }

  // 3 — Delay hoparlörleri: hedefin altında kalan ya da anlaşılırlığı zayıf bölge parçaları
  const mains = mainsOf(p, areaId);
  const M = mains.length ? { x: mains.reduce((s, m) => s + m.x, 0) / mains.length, y: mains.reduce((s, m) => s + m.y, 0) / mains.length } : { x: area.w / 2, y: 0 };
  const taken: { x: number; y: number }[] = [...p.items.filter((it) => it.areaId === areaId && getDef(p, it.defId).acoustic), ...proposals.flatMap((x) => x.add)];
  for (let round = 0; round < 2; round++) {
    const lv = levels(G.map((g) => g.E), best.g, cells.n);
    const ev = evalZones(lv, cells);
    const cand = ev.filter((e) => e.kind !== 'dance' && (e.under > 0.2 || (!isNaN(e.clear) && e.clear < 0.7))).sort((a, b) => b.under + (1 - (b.clear || 1)) - (a.under + (1 - (a.clear || 1))));
    let added = false;
    for (const e of cand) {
      const zi = cells.zones.findIndex((z) => z.id === e.zoneId);
      const zone = cells.zones[zi];
      let x0 = Infinity;
      let x1 = -Infinity;
      let y0 = Infinity;
      let y1 = -Infinity;
      let cx = 0;
      let cy = 0;
      let n = 0;
      for (let i = 0; i < cells.n; i++) {
        if (cells.zi[i] !== zi) continue;
        const poor = lv.L[i] < e.target - 3 || (cells.cl[i] > 0 && lv.DR[i] < DR_MIN);
        if (!poor) continue;
        x0 = Math.min(x0, cells.x[i]);
        x1 = Math.max(x1, cells.x[i]);
        y0 = Math.min(y0, cells.y[i]);
        y1 = Math.max(y1, cells.y[i]);
        cx += cells.x[i];
        cy += cells.y[i];
        n++;
      }
      if (n < 4) continue;
      cx /= n;
      cy /= n;
      const def = CATALOG[e.target <= 90 ? 'top-10a' : 'top-12a'];
      const hd = def.acoustic!.hDisp;
      const z = 2.0;
      const vertical = Math.abs(cy - M.y) >= Math.abs(cx - M.x) * 0.6;
      const sp: NewSpeaker[] = [];
      if (vertical) {
        const fwd = cy >= M.y;
        let py = fwd ? Math.max(zone.y - 0.3, y0 - 0.6) : Math.min(zone.y + zone.d + 0.3, y1 + 0.6);
        if (dance && inRect(dance, cx, py, 0.3)) py = fwd ? dance.y + dance.d + 0.4 : dance.y - 0.4;
        py = Math.max(0.4, Math.min(area.d - 0.4, py));
        const thr = Math.max(3, Math.abs((fwd ? y1 : y0) - py) * 0.6);
        const covW = 2 * thr * Math.tan((hd / 2) * rad) * 0.8;
        const k = Math.max(1, Math.min(4, Math.ceil((x1 - x0 + 1) / covW)));
        for (let i = 0; i < k; i++) {
          const x = Math.max(0.4, Math.min(area.w - 0.4, x0 + ((x1 - x0) * (i + 0.5)) / k));
          const ty = fwd ? py + thr : py - thr;
          sp.push({ defId: def.id, x: round1(x), y: round1(py), z, rot: aimRot(x, py, x, ty), tilt: tiltTo(z + def.h / 2, earH, thr), role: 'delay', delayMs: alignMs(p, areaId, x, py, z + def.h / 2, x, ty, 8), prefix: 'DL' });
        }
      } else {
        const right = cx >= M.x;
        let px = right ? Math.max(zone.x - 0.3, x0 - 0.6) : Math.min(zone.x + zone.w + 0.3, x1 + 0.6);
        if (dance && inRect(dance, px, cy, 0.3)) px = right ? dance.x + dance.w + 0.4 : dance.x - 0.4;
        px = Math.max(0.4, Math.min(area.w - 0.4, px));
        const thr = Math.max(3, Math.abs((right ? x1 : x0) - px) * 0.6);
        const covW = 2 * thr * Math.tan((hd / 2) * rad) * 0.8;
        const k = Math.max(1, Math.min(4, Math.ceil((y1 - y0 + 1) / covW)));
        for (let i = 0; i < k; i++) {
          const y = Math.max(0.4, Math.min(area.d - 0.4, y0 + ((y1 - y0) * (i + 0.5)) / k));
          const tx = right ? px + thr : px - thr;
          sp.push({ defId: def.id, x: round1(px), y: round1(y), z, rot: aimRot(px, y, tx, y), tilt: tiltTo(z + def.h / 2, earH, thr), role: 'delay', delayMs: alignMs(p, areaId, px, y, z + def.h / 2, tx, y, 8), prefix: 'DL' });
        }
      }
      const near = (s0: NewSpeaker) => taken.some((t) => Math.hypot(t.x - s0.x, t.y - s0.y) < 1.5);
      const spx = sp.filter((s0) => !near(s0));
      if (!spx.length) continue;
      sp.length = 0;
      sp.push(...spx);
      // ana sisteme yakınsa yan dolgu, uzaksa delay
      const dist = Math.min(...sp.map((s0) => Math.hypot(s0.x - M.x, s0.y - M.y)));
      const isFill = Math.abs(Math.min(...sp.map((s0) => s0.y)) - M.y) < 3;
      if (isFill) for (const s0 of sp) {
        s0.role = 'fill';
        s0.prefix = 'FL';
      }
      const id = (isFill ? 'fill:' : 'delay:') + zone.id + ':' + round;
      const g = tryAdd(sp, id, isFill ? 'fill' : 'delay', 0.08, zone.id);
      if (g != null) {
        taken.push(...sp);
        proposals.push({ id, kind: isFill ? 'fill' : 'delay', zoneName: zone.name, add: sp, change: [], gain: g, ms: Math.max(...sp.map((s0) => s0.delayMs)), dist, clarity: e.under <= 0.2 });
        added = true;
      }
    }
    if (!added) break;
  }

  // etkisiz kalan önerileri çıkar (ana sistemin 12 dB altında çalışacaksa gereksiz)
  for (let guard = 0; guard < 6; guard++) {
    const mi0 = G.findIndex((g) => g.key === 'main');
    const ref = mi0 >= 0 ? best.g[mi0] : Math.max(...best.g);
    const k = G.findIndex((g, j) => proposals.some((x) => x.id === g.key) && best.g[j] < ref - 12);
    if (k < 0) break;
    const key = G[k].key;
    G.splice(k, 1);
    proposals.splice(proposals.findIndex((x) => x.id === key), 1);
    best = run();
  }
  const lvFinal = levels(G.map((g) => g.E), best.g, cells.n);
  const final = evalZones(lvFinal, cells);
  // seviye değişimleri (sadece mevcut gruplar) + sub'lar pist değişimini izler
  const levelChanges: LevelChange[] = groups.map((g, k) => ({ key: g.key, role: g.role, labels: g.labels, delta: half(lvl.g[k]) }));
  const pe0 = now.find((e) => e.zoneId === primary.id);
  const pe1 = levelOnly.find((e) => e.zoneId === primary.id);
  const subs = p.items.filter((it) => it.areaId === areaId && isSub(p, it));
  if (subs.length && pe0 && pe1) levelChanges.push({ key: 'sub', role: 'sub', labels: subs.map((s) => s.label), delta: half(Math.min(-(p.settings.level + Math.max(...subs.map((s) => s.gainDb || 0))), pe1.avg - pe0.avg)) });
  const mi = groups.findIndex((g) => g.key === 'main');
  const de = final.find((e) => e.zoneId === primary.id);
  const headShort = mi >= 0 && de && best.g[mi] > groups[mi].head - 0.5 && de.avg < de.target - 1 ? de.target - de.avg : 0;
  // öneriler: yankılı salon, uzun açık alan
  const advice: Advice[] = [];
  const ra = roomAcoustics(area);
  const tz = final.filter((e) => e.kind !== primary.kind);
  if (ra && de && tz.length) {
    const want = de.target - Math.min(...tz.map((e) => e.target));
    const got = de.avg - Math.max(...tz.map((e) => e.avg));
    if (got < want - 4) advice.push({ code: 'reverb', vars: { rt: ra.rt[1].toFixed(1), got: Math.max(0, Math.round(got)), want: Math.round(want), rev: Math.round(lvFinal.lr) } });
  }
  if (!ra && area.d > 25 && !proposals.some((x) => x.kind === 'delay') && !p.items.some((it) => it.areaId === areaId && it.role === 'delay')) advice.push({ code: 'outdoorLong', vars: { d: Math.round(area.d) } });
  if (dance && mains.length) {
    const dd = Math.min(...mains.map((m) => Math.hypot(dance.x + dance.w / 2 - m.x, dance.y + dance.d / 2 - m.y)));
    if (dd > 12) advice.push({ code: 'farDance', vars: { d: Math.round(dd) } });
  }
  return {
    noZones: false,
    noSpeakers: false,
    now,
    levelOnly,
    levelChanges: levelChanges.filter((c) => Math.abs(c.delta) >= 1),
    proposals,
    final,
    rmsNow: rmsOf(costNow, cells),
    rmsLevel: rmsOf(lvl.cost, cells),
    rmsFinal: rmsOf(best.cost, cells),
    headShort,
    advice,
    gains: Object.fromEntries(G.map((g, k) => [g.key, best.g[k]])),
    subDelta: pe0 && de ? de.avg - pe0.avg : 0,
    cells,
    Lnow: lvNow.L,
    Lfinal: lvFinal.L,
  };
}

// —— Uygula: seçilen önerileri ekle, seviyeleri hesapla, kabloları bağla (q düz nesne, yerinde değişir) ——
export function applyPlan(q: Project, areaId: string, ids: string[], withLevels: boolean): string[] {
  const plan = planImpl(JSON.parse(JSON.stringify(q)) as Project, areaId);
  const chosen = plan.proposals.filter((x) => ids.includes(x.id));
  const added: string[] = [];
  const groupOf = new Map<string, string>();
  for (const g of groupsOf(q, areaId)) for (const id of g.items) groupOf.set(id, g.key);
  for (const pr of chosen) {
    for (const c of pr.change) {
      const it = q.items.find((i) => i.id === c.itemId);
      if (it) Object.assign(it, c.patch);
    }
    for (const s of pr.add) {
      const def = CATALOG[s.defId];
      const it = makeItem(q, def, areaId, s.x, s.y, { z: s.z, rot: s.rot, tilt: s.tilt, role: s.role, mount: 'stand', delayMs: s.delayMs, label: nextLabel(q, s.prefix) });
      q.items.push(it);
      added.push(it.id);
      groupOf.set(it.id, pr.id);
    }
  }
  if (withLevels) {
    // tüm öneriler seçildiyse planın hesapladığı kazançları aynen kullan (tutarlı sonuç)
    if (chosen.length === plan.proposals.length && plan.gains.main != null) setGains(q, areaId, (id) => plan.gains[groupOf.get(id) || ''], plan.subDelta);
    else applyLevels(q, areaId);
  }
  if (added.length) {
    autoSignal(q, areaId);
    autoPower(q, added);
  }
  return added;
}

// Grup kazançlarını hesapla: ana grup → sistem seviyesi, diğerleri → gainDb (ana sisteme göre), sub'lar pisti izler
export function applyLevels(q: Project, areaId: string): void {
  const snap = JSON.parse(JSON.stringify(q)) as Project;
  const cells = buildCells(snap, areaId, snap.zones, 1800);
  const groups = groupsOf(snap, areaId);
  if (!cells || !groups.length) return;
  const srcs = sourcesOf(snap, areaId);
  const E = groups.map((g) => energy(srcs.filter((s) => g.items.includes(s.itemId)), cells));
  const r = optimize(E, cells, groups.map((g) => g.head), 3, groups.findIndex((g) => g.key === 'main'));
  const pz = cells.zones.indexOf(primaryOf(cells.zones));
  const avgP = (lv: { L: Float64Array }) => {
    let s = 0;
    let n = 0;
    for (let i = 0; i < cells.n; i++)
      if (cells.zi[i] === pz) {
        s += lv.L[i];
        n++;
      }
    return n ? s / n : 0;
  };
  const dPrim = avgP(levels(E, r.g, cells.n)) - avgP(levels(E, E.map(() => 0), cells.n));
  const gk = new Map<string, number>();
  groups.forEach((g, k) => {
    for (const id of g.items) gk.set(id, r.g[k]);
  });
  setGains(q, areaId, (id) => gk.get(id) ?? (groups.some((g) => g.key === 'main') ? undefined : undefined), dPrim, groups.some((g) => g.key === 'main') ? r.g[groups.findIndex((g) => g.key === 'main')] : undefined);
}

// gainOf(itemId) → grubun kazanç değişimi (dB); ana grubun değişimi sistem seviyesine yazılır
function setGains(q: Project, areaId: string, gainOf: (id: string) => number | undefined, subDelta: number, mainDelta?: number): void {
  const main = mainDelta ?? (() => {
    const it = q.items.find((i) => i.areaId === areaId && isCoverSpeaker(q, i) && (i.role || 'main') === 'main');
    return it ? gainOf(it.id) : undefined;
  })();
  const oldLevel = q.settings.level;
  if (main != null) q.settings.level = Math.max(-40, Math.min(0, half(oldLevel + main)));
  const applied = q.settings.level - oldLevel;
  const setGain = (it: Item, d: number) => {
    const v = half((it.gainDb || 0) + d);
    it.gainDb = Math.abs(v) < 0.25 ? 0 : Math.min(-q.settings.level, v);
  };
  for (const it of q.items) {
    if (it.areaId !== areaId) continue;
    if (isSub(q, it)) {
      setGain(it, half(subDelta) - applied);
      continue;
    }
    if (!isCoverSpeaker(q, it)) continue;
    const g = gainOf(it.id);
    if (g != null) setGain(it, half(g) - applied);
  }
}

// —— Pist mesafesi taraması ——
export interface DanceScan {
  ref: number; // sahne ön kenarı / ana hoparlör hattı (y)
  current: number; // mevcut boşluk (m)
  pts: { gap: number; rms: number }[];
  best: [number, number];
  bestGap: number;
}

export function danceScan(p: Project, areaId: string): DanceScan | null {
  const pv = activeView(p);
  if (pv !== p) return danceScan(pv, areaId);
  return derive(p, 'dscan:' + areaId, () => {
    const area = p.areas.find((a) => a.id === areaId);
    const dance = p.zones.find((z) => z.areaId === areaId && z.kind === 'dance');
    if (!area || !dance || zoneTarget(dance) == null) return null;
    const groups = groupsOf(p, areaId);
    if (!groups.length) return null;
    const stage = p.zones.find((z) => z.areaId === areaId && z.kind === 'stage' && z.x < dance.x + dance.w && z.x + z.w > dance.x && z.y < dance.y);
    const mains = mainsOf(p, areaId);
    const ref = stage ? stage.y + stage.d : mains.length ? Math.max(...mains.map((m) => m.y)) : 0;
    const current = dance.y - ref;
    const maxGap = area.d - dance.d - 0.3 - ref;
    if (maxGap < 0.5) return null;
    const srcs = sourcesOf(p, areaId);
    const pts: DanceScan['pts'] = [];
    const steps = Math.min(24, Math.max(1, Math.floor(maxGap / 0.5)));
    const stepM = maxGap / steps;
    for (let s = 0; s <= steps; s++) {
      const gap = Math.max(0.3, s * stepM);
      const zones = p.zones.map((z) => (z.id === dance.id ? { ...z, y: ref + gap } : z));
      const cells = buildCells(p, areaId, zones, 700);
      if (!cells) continue;
      const E = groups.map((g) => energy(srcs.filter((x) => g.items.includes(x.itemId)), cells));
      const r = optimize(E, cells, groups.map((g) => g.head), 2, groups.findIndex((g) => g.key === 'main'));
      // sahneye çok yakın pist: geçiş, kablo ve güvenlik payı
      const near = gap < 1 ? (1 - gap) * 0.6 : 0;
      pts.push({ gap: round1(gap), rms: rmsOf(r.cost, cells) + near });
    }
    if (!pts.length) return null;
    const min = Math.min(...pts.map((x) => x.rms));
    const okPts = pts.filter((x) => x.rms <= min + Math.max(0.15, min * 0.04));
    const bestPt = pts.find((x) => x.rms === min)!;
    return { ref, current: round1(current), pts, best: [Math.min(...okPts.map((x) => x.gap)), Math.max(...okPts.map((x) => x.gap))], bestGap: bestPt.gap };
  });
}

// Pisti (ve içindeki kilitsiz öğeleri) yeni boşluğa taşı — q düz nesne ya da immer taslağı
export function moveDance(q: Project, areaId: string, gap: number, ref: number): void {
  const dance = q.zones.find((z) => z.areaId === areaId && z.kind === 'dance');
  if (!dance) return;
  const dy = ref + gap - dance.y;
  for (const it of q.items) if (it.areaId === areaId && !it.locked && inRect(dance, it.x, it.y)) it.y = Math.round((it.y + dy) * 100) / 100;
  dance.y = Math.round((dance.y + dy) * 100) / 100;
}

// —— Mesafe profili (sahneden uzaklığa göre her bölgenin ortalama seviyesi) ——
export interface ProfileRow {
  y: number;
  zone: string;
  now: number;
  plan: number;
  min: number;
  max: number;
}

export function profileRows(plan: CoveragePlan): ProfileRow[] {
  const c = plan.cells;
  if (!c || !plan.Lnow || !plan.Lfinal) return [];
  const m = new Map<string, { y: number; zone: string; s: number; sp: number; n: number; min: number; max: number }>();
  for (let i = 0; i < c.n; i++) {
    const z = c.zones[c.zi[i]];
    const k = z.id + '@' + c.y[i].toFixed(2);
    let r = m.get(k);
    if (!r) {
      r = { y: c.y[i], zone: z.id, s: 0, sp: 0, n: 0, min: Infinity, max: -Infinity };
      m.set(k, r);
    }
    r.s += plan.Lnow[i];
    r.sp += plan.Lfinal[i];
    r.n++;
    r.min = Math.min(r.min, plan.Lnow[i]);
    r.max = Math.max(r.max, plan.Lnow[i]);
  }
  return [...m.values()].map((r) => ({ y: r.y, zone: r.zone, now: r.s / r.n, plan: r.sp / r.n, min: r.min, max: r.max })).sort((a, b) => a.y - b.y);
}
