import { EQUIPMENT } from '../catalog/equipment';
import type { Area, EquipDef, Item, PortInst, Project, Zone } from './types';

export function uid(prefix = ''): string {
  return prefix + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
}

export const CATALOG: Record<string, EquipDef> = Object.fromEntries(EQUIPMENT.map((d) => [d.id, d]));

const FALLBACK: EquipDef = { id: '?', cat: 'sahne', dept: 'sahne', name: '?', icon: 'box', shape: 'box', w: 0.5, d: 0.5, h: 0.5, ports: [] };

export function getDef(p: Project | null | undefined, defId: string): EquipDef {
  if (p) {
    for (const d of p.defs) if (d.id === defId) return d;
  }
  return CATALOG[defId] || FALLBACK;
}

export function newArea(name = 'Ana salon', w = 24, d = 16, h = 5): Area {
  return {
    id: uid('ar'),
    name,
    w,
    d,
    h,
    indoor: true,
    floor: 'parke',
    ceiling: 'siva',
    walls: 'siva',
    glassPct: 10,
    curtainPct: 0,
    guests: 200,
  };
}

export function newProject(name = 'Yeni proje'): Project {
  const area = newArea();
  const now = Date.now();
  return {
    schema: 1,
    id: uid('pr'),
    name,
    created: now,
    modified: now,
    meta: { client: '', eventType: 'dugun', date: '', time: '', venue: '', address: '', engineer: '', phone: '', guests: 200, notes: '' },
    env: { tempC: 22, humidity: 50, wind: 0, rain: false, noiseLimit: 0, neighborDist: 0, curfew: '' },
    settings: { slackPct: 10, slackM: 1, level: -6, earH: 1.6, targetSpl: 100, crest: 6 },
    areas: [area],
    items: [],
    cables: [],
    zones: [],
    notes: [],
    defs: [],
    defImages: {},
    assets: {},
    done: {},
  };
}

// —— Boyutlar ——
export function itemDims(it: Item, def: EquipDef): { w: number; d: number; h: number } {
  const w = it.w ?? def.w;
  const d = it.d ?? def.d;
  let h = it.h ?? def.h;
  if (def.acoustic?.kind === 'array') h = def.h * (it.count || 1);
  return { w, d, h };
}

// Bölgelerden zemin yüksekliği (sahne podesti)
export function floorElevAt(zones: Zone[], areaId: string, x: number, y: number): number {
  let e = 0;
  for (const z of zones) {
    if (z.areaId !== areaId || z.elev <= 0) continue;
    if (x >= z.x && x <= z.x + z.w && y >= z.y && y <= z.y + z.d) e = Math.max(e, z.elev);
  }
  return e;
}

// Cismin alt kenarının mutlak yüksekliği
export function itemBaseZ(p: Project, it: Item): number {
  if (it.mount === 'flown' || it.mount === 'wall') return it.z;
  return floorElevAt(p.zones, it.areaId, it.x, it.y) + it.z;
}

// —— Portlar ——
const portCache = new WeakMap<EquipDef, PortInst[]>();

export function portsOf(def: EquipDef): PortInst[] {
  let r = portCache.get(def);
  if (r) return r;
  r = [];
  for (const g of def.ports) {
    const n = g.count || 1;
    for (let i = 0; i < n; i++) {
      const id = n > 1 ? `${g.key}${i + 1}` : g.key;
      const base = typeof g.name === 'string' ? g.name : g.name.tr;
      const label = g.names?.[i] != null ? `${base} ${g.names[i]}` : n > 1 ? `${base} ${i + 1}` : base;
      r.push({ id, key: g.key, index: i, label, group: g, phase: g.phases?.[i], breakerA: g.breakerA });
    }
  }
  portCache.set(def, r);
  return r;
}

export function findPort(def: EquipDef, portId: string): PortInst | undefined {
  return portsOf(def).find((p) => p.id === portId);
}

// Port etiketi (dile göre)
export function portLabel(pi: PortInst, lang: 'tr' | 'de' | 'en'): string {
  const g = pi.group;
  const base = typeof g.name === 'string' ? g.name : g.name[lang] || g.name.tr;
  const n = g.count || 1;
  if (g.names?.[pi.index] != null) return `${base} ${g.names[pi.index]}`;
  return n > 1 ? `${base} ${pi.index + 1}` : base;
}

// —— Etiketler ——
export function labelPrefix(def: EquipDef): string {
  const a = def.acoustic;
  if (a) {
    if (a.kind === 'sub') return 'SUB';
    if (a.kind === 'monitor') return 'MON';
    if (a.kind === 'array') return 'LA';
    if (a.kind === 'column') return 'COL';
    return 'PA';
  }
  if (def.source) return 'SRC';
  switch (def.cat) {
    case 'mikser':
      return def.icon === 'stagebox' ? 'SB' : 'MIX';
    case 'islem':
      return def.icon === 'amp' ? 'AMP' : def.icon === 'di' ? 'DI' : def.icon === 'dsp' ? 'DSP' : 'PRO';
    case 'dj':
      return 'DJ';
    case 'mikrofon':
      return def.icon === 'receiver' ? 'RX' : 'MIC';
    case 'monitor':
      return 'IEM';
    case 'enstruman':
      return 'INS';
    case 'isik':
      return 'LT';
    case 'truss':
      return 'TR';
    case 'video':
      return 'VID';
    case 'elektrik':
      return def.icon === 'distro' ? 'DIST' : 'PWR';
    case 'ag':
      return 'NET';
    case 'sahne':
      return 'ST';
    case 'mekan':
      return 'M';
    case 'hazirlik':
      return def.id === 'external' ? 'EXT' : 'TIE';
    default:
      return 'X';
  }
}

export function nextLabel(p: Project, prefix: string): string {
  let max = 0;
  const re = new RegExp('^' + prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '-(\\d+)$');
  for (const it of p.items) {
    const m = re.exec(it.label);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `${prefix}-${max + 1}`;
}

export function nextCableLabel(p: Project, prefix: string): string {
  let max = 0;
  const re = new RegExp('^' + prefix + '-(\\d+)$');
  for (const c of p.cables) {
    const m = re.exec(c.label);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `${prefix}-${String(max + 1).padStart(3, '0')}`;
}

// Yeni bir öğe oluştur (katalog varsayılanlarıyla)
export function makeItem(p: Project, def: EquipDef, areaId: string, x: number, y: number, extra?: Partial<Item>): Item {
  const pr = (def.props || {}) as Record<string, unknown>;
  const it: Item = {
    id: uid('it'),
    defId: def.id,
    areaId,
    label: nextLabel(p, labelPrefix(def)),
    x,
    y,
    z: def.mount === 'stand' || def.mount === 'flown' || def.mount === 'table' || def.mount === 'wall' ? def.mountH ?? 0 : 0,
    rot: typeof pr.rot === 'number' ? (pr.rot as number) : 0,
    tilt: typeof pr.tilt === 'number' ? (pr.tilt as number) : 0,
    mount: def.mount || 'floor',
  };
  if (def.acoustic) {
    it.role = (pr.role as Item['role']) || (def.acoustic.kind === 'sub' ? 'sub' : def.acoustic.kind === 'monitor' ? 'monitor' : 'main');
    it.polarity = 1;
    it.delayMs = 0;
  }
  if (def.acoustic?.kind === 'array') {
    it.count = (pr.count as number) || 6;
    it.splays = ((pr.splays as number[]) || []).slice();
  }
  if (def.cat === 'mikrofon' && pr.stand) it.stand = pr.stand as Item['stand'];
  if (pr.phantom) it.phantom = true;
  return { ...it, ...extra };
}

export function areaOf(p: Project, id: string): Area | undefined {
  return p.areas.find((a) => a.id === id);
}

export function itemById(p: Project): Map<string, Item> {
  return new Map(p.items.map((i) => [i.id, i]));
}

// Ön yön vektörü (plan): rot=0 → +y
export function dirVec(rotDeg: number): { x: number; y: number } {
  const r = (rotDeg * Math.PI) / 180;
  return { x: -Math.sin(r), y: Math.cos(r) };
}

// Yerel (öğeye göre) noktayı plana çevir: lx sağ, ly ön
export function localToPlan(it: { x: number; y: number; rot: number }, lx: number, ly: number): { x: number; y: number } {
  const r = (it.rot * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  // rot=0: sağ = -x? Plan: ön +y, sağ (seyirciden bakınca) -x. Basit tutmak için yerel x = plan x.
  return { x: it.x + lx * c - ly * s, y: it.y + lx * s + ly * c };
}
