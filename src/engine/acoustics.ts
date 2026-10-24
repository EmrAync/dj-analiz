import { getDef, itemBaseZ, itemDims, floorElevAt } from '../model/project';
import type { AcousticKind, Area, Item, L10n, MaterialId, Project, Zone } from '../model/types';
import { derive } from './derive';
import { activeView } from '../model/variants';

// ———————————————— Malzemeler (Sabine yutum katsayıları 125 / 500 / 2000 Hz) ————————————————
export const MATERIALS: Record<MaterialId, { name: L10n; a: [number, number, number] }> = {
  beton: { name: { tr: 'Beton (boyalı)', de: 'Beton (gestrichen)', en: 'Concrete (painted)' }, a: [0.01, 0.02, 0.02] },
  siva: { name: { tr: 'Sıva / tuğla', de: 'Putz / Mauerwerk', en: 'Plaster / brick' }, a: [0.02, 0.03, 0.04] },
  alcipan: { name: { tr: 'Alçıpan', de: 'Gipskarton', en: 'Gypsum board' }, a: [0.29, 0.05, 0.07] },
  ahsap: { name: { tr: 'Ahşap kaplama', de: 'Holzverkleidung', en: 'Wood panelling' }, a: [0.15, 0.1, 0.07] },
  parke: { name: { tr: 'Parke', de: 'Parkett', en: 'Parquet' }, a: [0.04, 0.07, 0.06] },
  seramik: { name: { tr: 'Seramik / mermer', de: 'Fliesen / Marmor', en: 'Tiles / marble' }, a: [0.01, 0.01, 0.02] },
  hali: { name: { tr: 'Halı (kalın)', de: 'Teppich (dick)', en: 'Carpet (heavy)' }, a: [0.08, 0.24, 0.57] },
  cam: { name: { tr: 'Cam', de: 'Glas', en: 'Glass' }, a: [0.18, 0.04, 0.02] },
  perde: { name: { tr: 'Kalın perde', de: 'Schwerer Vorhang', en: 'Heavy curtain' }, a: [0.14, 0.55, 0.7] },
  akustikTavan: { name: { tr: 'Akustik asma tavan', de: 'Akustikdecke', en: 'Acoustic ceiling tiles' }, a: [0.5, 0.7, 0.8] },
  akustikPanel: { name: { tr: 'Akustik panel', de: 'Akustikpaneel', en: 'Acoustic panel' }, a: [0.3, 0.9, 0.95] },
  cadir: { name: { tr: 'Çadır brandası (ses dışarı kaçar)', de: 'Zeltplane', en: 'Tent fabric' }, a: [0.5, 0.6, 0.7] },
  acik: { name: { tr: 'Açık hava (yansıma yok)', de: 'Offen (keine Reflexion)', en: 'Open air' }, a: [1, 1, 1] },
};

const PERSON_A: [number, number, number] = [0.25, 0.45, 0.5]; // m² Sabine / kişi
const AIR_M: [number, number, number] = [0, 0.0006, 0.0024]; // 1/m

export function speedOfSound(tC: number): number {
  return 331.3 * Math.sqrt(1 + tC / 273.15);
}

export interface RoomAcoustics {
  V: number;
  S: number;
  rt: [number, number, number]; // s
  A: [number, number, number];
  dc: number; // kritik mesafe (tipik tepe hoparlör için, 500 Hz)
  verdict: 'dry' | 'good' | 'live' | 'reverberant' | 'very';
}

export function roomAcoustics(area: Area): RoomAcoustics | null {
  if (!area.indoor) return null;
  const { w, d, h } = area;
  const V = w * d * h;
  const floor = w * d;
  const ceil = w * d;
  const walls = 2 * (w + d) * h;
  const glass = (walls * Math.min(100, area.glassPct)) / 100;
  const curtain = (walls * Math.min(100 - area.glassPct, area.curtainPct)) / 100;
  const rest = Math.max(0, walls - glass - curtain);
  const S = floor + ceil + walls;
  const A: [number, number, number] = [0, 0, 0];
  const rt: [number, number, number] = [0, 0, 0];
  for (let b = 0; b < 3; b++) {
    let a = floor * MATERIALS[area.floor].a[b] + ceil * MATERIALS[area.ceiling].a[b] + rest * MATERIALS[area.walls].a[b] + glass * MATERIALS.cam.a[b] + curtain * MATERIALS.perde.a[b];
    a += area.guests * PERSON_A[b];
    a += 4 * AIR_M[b] * V;
    A[b] = a;
    const mean = Math.min(0.95, a / S);
    // ortalama yutum yüksekse Eyring
    rt[b] = mean > 0.25 ? (0.161 * V) / (-S * Math.log(1 - mean)) : (0.161 * V) / a;
  }
  const Q = 8.7;
  const dc = 0.057 * Math.sqrt((Q * V) / Math.max(rt[1], 0.1));
  const r = rt[1];
  const verdict = r < 0.6 ? 'dry' : r < 1.1 ? 'good' : r < 1.6 ? 'live' : r < 2.5 ? 'reverberant' : 'very';
  return { V, S, rt, A, dc, verdict };
}

export function qFromCoverage(h: number, v: number): number {
  const rad = Math.PI / 180;
  const s = Math.sin(Math.min(h, 179) * rad * 0.5) * Math.sin(Math.min(v, 179) * rad * 0.5);
  return 180 / (Math.asin(Math.min(1, s)) / rad);
}

// ———————————————— Kaynaklar ————————————————
export interface Source {
  itemId: string;
  x: number;
  y: number;
  z: number;
  yaw: number; // derece
  pitch: number;
  kind: AcousticKind;
  lp1m: number; // 1 m'deki sürekli seviye (sürüş seviyesi dahil)
  h: number;
  v: number;
  fLow: number;
  delayMs: number;
  polarity: number;
  role?: string;
  cardioid?: boolean;
}

// Line array elemanlarının konum/açıları (bumper üstte, aşağı doğru dizilir)
export function arrayElements(it: Item, elemH: number, elemD: number, baseZ: number): { z: number; dy: number; pitch: number }[] {
  const n = Math.max(1, it.count || 1);
  const spl = it.splays || [];
  const res: { z: number; dy: number; pitch: number }[] = [];
  let pitch = it.tilt || 0;
  let z = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    if (i > 0) pitch -= spl[i] ?? 0;
    const rad = (pitch * Math.PI) / 180;
    // elemanın alt yönü (-u) = (ileri: sinθ, yukarı: -cosθ); aşağı bakan kutular arkaya kıvrılır (J)
    const cz = z - (elemH / 2) * Math.cos(rad);
    const cy = dy + (elemH / 2) * Math.sin(rad);
    res.push({ z: cz, dy: cy - elemD * 0.1, pitch });
    z -= elemH * Math.cos(rad);
    dy += elemH * Math.sin(rad);
  }
  // en alt kenar baseZ'de olacak şekilde kaydır
  const bottom = z;
  return res.map((e) => ({ ...e, z: e.z - bottom + baseZ }));
}

export function sourcesOf(p: Project, areaId: string): Source[] {
  const pv = activeView(p);
  if (pv !== p) return sourcesOf(pv, areaId);
  return derive(p, 'src:' + areaId, () => {
    const out: Source[] = [];
    const s = p.settings;
    for (const it of p.items) {
      if (it.areaId !== areaId || it.hidden) continue;
      const def = getDef(p, it.defId);
      const a = def.acoustic;
      if (!a || a.kind === 'iem') continue;
      const lp = a.maxSpl - s.crest + s.level + (it.gainDb || 0);
      const base = itemBaseZ(p, it);
      const dims = itemDims(it, def);
      if (a.kind === 'array') {
        const els = arrayElements(it, def.h, def.d, base);
        const r = (it.rot * Math.PI) / 180;
        for (const e of els) {
          out.push({ itemId: it.id, x: it.x - Math.sin(r) * e.dy, y: it.y + Math.cos(r) * e.dy, z: e.z, yaw: it.rot, pitch: e.pitch, kind: a.kind, lp1m: lp, h: a.hDisp, v: a.vDisp, fLow: a.fLow, delayMs: it.delayMs || 0, polarity: it.polarity || 1, role: it.role });
        }
        continue;
      }
      const zc = a.kind === 'column' ? base + dims.h * 0.7 : base + dims.h / 2;
      out.push({ itemId: it.id, x: it.x, y: it.y, z: zc, yaw: it.rot, pitch: it.tilt || 0, kind: a.kind, lp1m: lp, h: a.hDisp, v: a.vDisp, fLow: a.fLow, delayMs: it.delayMs || 0, polarity: it.polarity || 1, role: it.role, cardioid: !!(it.notes && /kardioid|cardioid/i.test(it.notes)) });
    }
    return out;
  });
}

// Hoparlör yerel eksenine göre sapma açıları (derece)
export function offAxis(src: { yaw: number; pitch: number }, vx: number, vy: number, vz: number): { ah: number; av: number; front: number } {
  const y = (src.yaw * Math.PI) / 180;
  const pch = (src.pitch * Math.PI) / 180;
  const sy = Math.sin(y);
  const cy = Math.cos(y);
  const sp = Math.sin(pch);
  const cp = Math.cos(pch);
  const fx = -sy * cp;
  const fy = cy * cp;
  const fz = sp;
  const rx = cy;
  const ry = sy;
  const ux = sy * sp;
  const uy = -cy * sp;
  const uz = cp;
  const lx = vx * rx + vy * ry;
  const ly = vx * ux + vy * uy + vz * uz;
  const lz = vx * fx + vy * fy + vz * fz;
  const ah = (Math.abs(Math.atan2(lx, lz)) * 180) / Math.PI;
  const av = (Math.abs(Math.atan2(ly, Math.hypot(lx, lz))) * 180) / Math.PI;
  return { ah, av, front: lz };
}

export function directivity(src: Source, vx: number, vy: number, vz: number): number {
  if (src.kind === 'sub') {
    if (!src.cardioid) return 0;
    const { ah } = offAxis(src, vx, vy, 0);
    return Math.max(-20, 20 * Math.log10(Math.max(0.01, 0.5 + 0.5 * Math.cos((ah * Math.PI) / 180))));
  }
  const { ah, av } = offAxis(src, vx, vy, vz);
  const rh = ah / (src.h / 2);
  const rv = av / (src.v / 2);
  let att = -6 * (rh * rh + rv * rv);
  const floor = src.kind === 'column' ? -18 : -24;
  if (att < floor) att = floor;
  if (ah > 100 && src.kind !== 'column') att = Math.min(att, -18);
  return att;
}

export type Band = 'mid' | 'low';

export interface GridOpts {
  band: Band;
  freq: number; // low bandında
  coherent: boolean;
}

export interface SplGrid {
  x0: number;
  y0: number;
  step: number;
  nx: number;
  ny: number;
  data: Float32Array; // dB, maskede NaN
  min: number;
  max: number;
  stats: { avg: number; p10: number; p90: number; min: number; max: number; n: number } | null;
}

function inZones(zs: Zone[], x: number, y: number): boolean {
  for (const z of zs) if (x >= z.x && x <= z.x + z.w && y >= z.y && y <= z.y + z.d) return true;
  return false;
}

export function listenZones(p: Project, areaId: string): Zone[] {
  return p.zones.filter((z) => z.areaId === areaId && (z.kind === 'audience' || z.kind === 'dance' || z.kind === 'tables' || z.kind === 'foh'));
}

// Tek kaynağın orta bant (1 kHz) seviyesi
export function midLevel(s: Source, x: number, y: number, z: number): number {
  const vx = x - s.x;
  const vy = y - s.y;
  const vz = z - s.z;
  const d = Math.max(1, Math.hypot(vx, vy, vz));
  return s.lp1m - 20 * Math.log10(d) - 0.004 * d + directivity(s, vx, vy, vz);
}

export function splAt(srcs: Source[], x: number, y: number, z: number, o: GridOpts, c: number): number {
  if (o.band === 'mid') {
    let e = 0;
    for (const s of srcs) {
      if (s.kind === 'sub') continue;
      e += Math.pow(10, midLevel(s, x, y, z) / 10);
    }
    return e > 0 ? 10 * Math.log10(e) : NaN;
  }
  // alçak frekans: sub'lar (yoksa tepelerin alt ucu)
  const hasSub = srcs.some((s) => s.kind === 'sub');
  let re = 0;
  let im = 0;
  let e = 0;
  const k = (2 * Math.PI * o.freq) / c;
  for (const s of srcs) {
    if (hasSub ? s.kind !== 'sub' : s.fLow > o.freq * 1.5) continue;
    const vx = x - s.x;
    const vy = y - s.y;
    const vz = z - s.z;
    const d = Math.max(1, Math.hypot(vx, vy, vz));
    let L = s.lp1m - 20 * Math.log10(d) + (s.kind === 'sub' ? directivity(s, vx, vy, vz) : -6);
    if (!hasSub) L -= 3;
    if (o.coherent) {
      const amp = Math.pow(10, L / 20) * s.polarity;
      const ph = k * d + 2 * Math.PI * o.freq * (s.delayMs / 1000);
      re += amp * Math.cos(ph);
      im -= amp * Math.sin(ph);
    } else e += Math.pow(10, L / 10);
  }
  if (o.coherent) {
    const m = Math.hypot(re, im);
    return m > 0 ? 20 * Math.log10(m) : NaN;
  }
  return e > 0 ? 10 * Math.log10(e) : NaN;
}

// Yankı alanı (Hopkins–Stryker): kapalı salonda her kaynağın yansıyan enerjisi her yere eşit dağılır.
// Lrev = Lw + 10·log10(4/R), Lw = Lp(1 m) − 10·log10(Q) + 11, R = A/(1−ᾱ) (500 Hz)
export function roomConstant(area: Area): number | null {
  const ra = roomAcoustics(area);
  if (!ra) return null;
  const am = Math.min(0.95, ra.A[1] / ra.S);
  return ra.A[1] / (1 - am);
}

export function reverbOf(s: Source, R: number | null): number {
  if (R == null || s.kind === 'sub' || s.kind === 'iem') return 0;
  const Q = s.kind === 'array' ? qFromCoverage(s.h, Math.max(s.v, 10)) : qFromCoverage(s.h, s.v);
  const Lw = s.lp1m - 10 * Math.log10(Math.max(1, Q)) + 11;
  return Math.pow(10, (Lw + 10 * Math.log10(4 / Math.max(1, R))) / 10);
}

export function reverbEnergy(p: Project, areaId: string): number {
  return derive(p, 'rev:' + areaId, () => {
    const area = p.areas.find((a) => a.id === areaId);
    const R = area ? roomConstant(area) : null;
    if (R == null) return 0;
    let e = 0;
    for (const s of sourcesOf(p, areaId)) e += reverbOf(s, R);
    return e;
  });
}

export function splGrid(p: Project, areaId: string, o: GridOpts): SplGrid | null {
  const key = `grid:${areaId}:${o.band}:${o.freq}:${o.coherent}`;
  return derive(p, key, () => {
    const area = p.areas.find((a) => a.id === areaId);
    if (!area) return null;
    const srcs = sourcesOf(p, areaId);
    if (srcs.length === 0) return null;
    const step = Math.max(0.25, Math.sqrt((area.w * area.d) / 9000));
    const nx = Math.max(2, Math.ceil(area.w / step));
    const ny = Math.max(2, Math.ceil(area.d / step));
    const data = new Float32Array(nx * ny);
    const zones = listenZones(p, areaId);
    const c = speedOfSound(p.env.tempC);
    const rev = reverbEnergy(p, areaId);
    const vals: number[] = [];
    let min = Infinity;
    let max = -Infinity;
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const x = (i + 0.5) * step;
        const y = (j + 0.5) * step;
        const z = floorElevAt(p.zones, areaId, x, y) + p.settings.earH;
        let L = splAt(srcs, x, y, z, o, c);
        if (o.band === 'mid' && rev > 0) L = 10 * Math.log10((isNaN(L) ? 0 : Math.pow(10, L / 10)) + rev);
        data[j * nx + i] = L;
        if (!isNaN(L)) {
          if (L < min) min = L;
          if (L > max) max = L;
          if (zones.length === 0 || inZones(zones, x, y)) vals.push(L);
        }
      }
    }
    let stats: SplGrid['stats'] = null;
    if (vals.length) {
      vals.sort((a, b) => a - b);
      const q = (f: number) => vals[Math.min(vals.length - 1, Math.floor(f * vals.length))];
      stats = { avg: vals.reduce((a, b) => a + b, 0) / vals.length, p10: q(0.1), p90: q(0.9), min: vals[0], max: vals[vals.length - 1], n: vals.length };
    }
    return { x0: 0, y0: 0, step, nx, ny, data, min, max, stats };
  });
}

// Isı haritası renk skalası (hedefe göre)
export function splColor(L: number, target: number): [number, number, number, number] {
  if (isNaN(L)) return [0, 0, 0, 0];
  const t = (L - (target - 18)) / 24; // hedef-18 … hedef+6
  const stops: [number, number, number][] = [
    [30, 64, 175],
    [14, 165, 233],
    [34, 197, 94],
    [234, 179, 8],
    [249, 115, 22],
    [220, 38, 38],
  ];
  const x = Math.max(0, Math.min(1, t)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  const f = x - i;
  const a = stops[i];
  const b = stops[i + 1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f, 150];
}

// Gecikme hoparlörü için önerilen gecikme (ms)
export function suggestDelay(p: Project, it: Item): number | null {
  if (it.role !== 'delay' && it.role !== 'fill' && it.role !== 'outfill' && it.role !== 'sidefill') return null;
  const srcs = sourcesOf(p, it.areaId);
  const mains = srcs.filter((s) => s.itemId !== it.id && (s.role === 'main' || s.kind === 'array') && s.kind !== 'sub');
  if (mains.length === 0) return null;
  const own = srcs.find((s) => s.itemId === it.id);
  if (!own) return null;
  const r = (it.rot * Math.PI) / 180;
  const reach = it.role === 'delay' ? 6 : 3;
  const px = own.x - Math.sin(r) * reach;
  const py = own.y + Math.cos(r) * reach;
  const pz = floorElevAt(p.zones, it.areaId, px, py) + p.settings.earH;
  const c = speedOfSound(p.env.tempC);
  let dMain = Infinity;
  for (const m of mains) dMain = Math.min(dMain, Math.hypot(px - m.x, py - m.y, pz - m.z));
  const dOwn = Math.hypot(px - own.x, py - own.y, pz - own.z);
  const ms = ((dMain - dOwn) / c) * 1000 + (it.role === 'delay' ? 10 : 5);
  return Math.max(0, ms);
}

// Belirli bir noktadaki toplam seviye (tepe + sub enerji toplamı)
export function splPoint(p: Project, areaId: string, x: number, y: number): { mid: number; low: number } {
  const srcs = sourcesOf(p, areaId);
  const c = speedOfSound(p.env.tempC);
  const z = floorElevAt(p.zones, areaId, x, y) + p.settings.earH;
  const d = splAt(srcs, x, y, z, { band: 'mid', freq: 1000, coherent: false }, c);
  const rev = reverbEnergy(p, areaId);
  const mid = rev > 0 ? 10 * Math.log10((isNaN(d) ? 0 : Math.pow(10, d / 10)) + rev) : d;
  return { mid, low: splAt(srcs, x, y, z, { band: 'low', freq: 63, coherent: false }, c) };
}

// Uzak mesafede tahmini seviye (komşu)
export function farField(p: Project, dist: number): number {
  let e = 0;
  for (const a of p.areas) for (const s of sourcesOf(p, a.id)) e += Math.pow(10, (s.lp1m - (s.kind === 'sub' ? 0 : 3)) / 10);
  if (e <= 0) return NaN;
  const L1 = 10 * Math.log10(e);
  return L1 - 20 * Math.log10(Math.max(1, dist)) - 0.005 * dist - 5; // -5: zemin/engel etkisi (kaba)
}

// Sub kümeleri (power alley uyarısı için)
export function subClusters(p: Project, areaId: string): { x: number; y: number; n: number }[] {
  const pv = activeView(p);
  if (pv !== p) return subClusters(pv, areaId);
  const subs = p.items.filter((i) => i.areaId === areaId && !i.hidden && getDef(p, i.defId).acoustic?.kind === 'sub');
  const cl: { x: number; y: number; n: number }[] = [];
  for (const s of subs) {
    const c = cl.find((k) => Math.hypot(k.x - s.x, k.y - s.y) < 2);
    if (c) {
      c.x = (c.x * c.n + s.x) / (c.n + 1);
      c.y = (c.y * c.n + s.y) / (c.n + 1);
      c.n++;
    } else cl.push({ x: s.x, y: s.y, n: 1 });
  }
  return cl;
}
