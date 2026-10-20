import { cableFits, cableType, CABLE_TYPES, type CableType } from '../catalog/connectors';
import { findPort, floorElevAt, getDef, itemBaseZ, itemDims, localToPlan, portsOf } from '../model/project';
import type { Cable, EquipDef, Item, PortInst, Project } from '../model/types';
import { derive, dist, polyLen, type Pt } from './derive';

export interface CableInfo {
  cable: Cable;
  type: CableType;
  a?: Item;
  b?: Item;
  defA?: EquipDef;
  defB?: EquipDef;
  portA?: PortInst;
  portB?: PortInst;
  path: Pt[] | null; // aynı bölümdeyse plan yolu
  crossArea: boolean;
  len3d: number; // ölçülen (pay hariç)
  need: number; // pay dahil gereken
  stock: number; // standart boy
  len: number; // kullanılacak boy
  issues: string[];
  lossDb?: number; // hoparlör hattı kaybı
  amps?: number; // elektrik hattı akımı (power.ts doldurur)
  dropPct?: number; // gerilim düşümü %
}

// Kablonun öğeye bağlandığı plan noktası
export function anchorPlan(it: Item, def: EquipDef): Pt {
  const { w, d } = itemDims(it, def);
  if (Math.max(w, d) < 0.35 || def.plan === 'circle') return { x: it.x, y: it.y };
  return localToPlan(it, 0, -d * 0.42);
}

export function anchorZ(p: Project, it: Item, def: EquipDef): number {
  const base = itemBaseZ(p, it);
  const { h } = itemDims(it, def);
  if (it.mount === 'stand' || it.mount === 'pole' || it.mount === 'flown' || it.mount === 'wall') return base + Math.min(h * 0.25, 0.3);
  return base + Math.min(h * 0.5, 0.3);
}

// Aynı iki öğe arasındaki paralel kabloları ayırmak için kaydırma
function pairOffsets(p: Project): Map<string, number> {
  return derive(p.cables, 'pairOffsets', () => {
    const groups = new Map<string, string[]>();
    for (const c of p.cables) {
      const k = c.a.item < c.b.item ? c.a.item + '|' + c.b.item : c.b.item + '|' + c.a.item;
      const g = groups.get(k);
      if (g) g.push(c.id);
      else groups.set(k, [c.id]);
    }
    const off = new Map<string, number>();
    for (const g of groups.values()) g.forEach((id, i) => off.set(id, (i - (g.length - 1) / 2) * 0.16));
    return off;
  });
}

export function buildPath(c: Cable, A: Pt, B: Pt, offset: number): Pt[] {
  const pts = [A, ...c.pts, B];
  let out: Pt[];
  if (c.route === 'straight' || c.route === 'manual') out = pts;
  else {
    out = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      if (Math.abs(a.x - b.x) > 0.02 && Math.abs(a.y - b.y) > 0.02) out.push({ x: b.x, y: a.y });
      out.push(b);
    }
  }
  if (offset && out.length >= 2) {
    // ara noktaları dik yönde kaydır (uçlar sabit)
    const res = out.map((q) => ({ ...q }));
    for (let i = 1; i < res.length - 1; i++) {
      const pa = out[i - 1];
      const pb = out[i + 1];
      const dx = pb.x - pa.x;
      const dy = pb.y - pa.y;
      const l = Math.hypot(dx, dy) || 1;
      res[i].x += (-dy / l) * offset;
      res[i].y += (dx / l) * offset;
    }
    if (res.length === 2) {
      const dx = B.x - A.x;
      const dy = B.y - A.y;
      const l = Math.hypot(dx, dy) || 1;
      const m = { x: (A.x + B.x) / 2 + (-dy / l) * offset, y: (A.y + B.y) / 2 + (dx / l) * offset };
      return [res[0], m, res[1]];
    }
    return res;
  }
  return out;
}

function analyzeOne(p: Project, c: Cable, items: Map<string, Item>, offsets: Map<string, number>): CableInfo {
  const type = cableType(c.type);
  const a = items.get(c.a.item);
  const b = items.get(c.b.item);
  const defA = a ? getDef(p, a.defId) : undefined;
  const defB = b ? getDef(p, b.defId) : undefined;
  const portA = defA ? findPort(defA, c.a.port) : undefined;
  const portB = defB ? findPort(defB, c.b.port) : undefined;
  const issues: string[] = [];
  let path: Pt[] | null = null;
  let len3d = 0;
  const crossArea = !!(a && b && a.areaId !== b.areaId);
  if (!a || !b || !defA || !defB) issues.push('chk.cableOrphan');
  else {
    const A = anchorPlan(a, defA);
    const B = anchorPlan(b, defB);
    if (!crossArea) {
      path = buildPath(c, A, B, offsets.get(c.id) || 0);
      const horiz = polyLen(path);
      const za = anchorZ(p, a, defA);
      const zb = anchorZ(p, b, defB);
      const fa = floorElevAt(p.zones, a.areaId, a.x, a.y);
      const fb = floorElevAt(p.zones, b.areaId, b.x, b.y);
      if (horiz < 1.5 && za - fa > 0.4 && zb - fb > 0.4 && Math.abs(za - zb) < 0.6) len3d = Math.hypot(horiz, za - zb) * 1.15;
      else len3d = horiz + (za - fa) + (zb - fb) + Math.abs(fa - fb);
    } else {
      const aa = p.areas.find((x) => x.id === a.areaId);
      const ab = p.areas.find((x) => x.id === b.areaId);
      if (aa?.ox != null && ab?.ox != null) {
        len3d = dist({ x: A.x + (aa.ox || 0), y: A.y + (aa.oy || 0) }, { x: B.x + (ab.ox || 0), y: B.y + (ab.oy || 0) }) * 1.3 + 1;
      }
      issues.push('chk.cableCrossArea');
    }
    if (!portA || !portB) issues.push('chk.cablePortMissing');
    else {
      if (!cableFits(type, portA.group.conn, portB.group.conn)) issues.push('chk.cableConn');
      const da = portA.group.domain;
      const db = portB.group.domain;
      const compatible = (x: string, y: string) => x === y || (x === 'digital' && y === 'network') || (x === 'network' && y === 'digital') || (x === 'video' && y === 'network') || (x === 'network' && y === 'video');
      if (!compatible(da, db)) issues.push('chk.cableDomain');
      else if (c.type !== 'generic' && !compatible(type.domain, da) && !(type.domain === 'digital' && da === 'audio' && c.type === 'aes')) issues.push('chk.cableTypeDomain');
      if (portA.group.dir === portB.group.dir && portA.group.dir !== 'io') issues.push('chk.cableDir');
      if (da === 'digital' && db === 'digital' && protoFamily(portA.group.key) !== protoFamily(portB.group.key)) issues.push('chk.protocol');
    }
    if (type.wireless) {
      const range = Math.max(defA.range || 0, defB.range || 0) || 100;
      if (!crossArea && path && polyLen(path) > range) issues.push('chk.wirelessRange');
    }
  }
  const s = p.settings;
  const need = type.wireless ? 0 : len3d > 0 ? len3d * (1 + s.slackPct / 100) + s.slackM : 0;
  const stock = type.wireless ? 0 : need > 0 ? stockOf(type, need) : 0;
  const len = c.len ?? stock;
  if (!type.wireless && type.maxLen && len > type.maxLen) issues.push('chk.cableTooLong');
  if (!type.wireless && crossArea && c.len == null && len3d === 0) issues.push('chk.cableNoLen');
  const info: CableInfo = { cable: c, type, a, b, defA, defB, portA, portB, path, crossArea, len3d, need, stock, len, issues };
  if (type.domain === 'speaker' && type.mm2 && len > 0) {
    const spk = defB?.acoustic?.impedance ? defB : defA?.acoustic?.impedance ? defA : undefined;
    const z = spk?.acoustic?.impedance || 8;
    const r = (2 * len * 0.0175) / type.mm2;
    info.lossDb = 20 * Math.log10(z / (z + r));
    if (info.lossDb < -0.8) issues.push('chk.speakerLoss');
  }
  return info;
}

// Dijital ses protokol aileleri (aynı aileden olmayanlar birbiriyle konuşmaz)
export function protoFamily(key: string): string {
  if (key === 'aes50') return 'aes50';
  if (key === 'slink' || key === 'dx' || key === 'dsnake') return 'ah';
  if (key === 'dante' || key === 'tfrack') return 'dante';
  return key;
}

function stockOf(t: CableType, need: number): number {
  for (const s of t.stock) if (s >= need - 1e-6) return s;
  return Math.ceil(need / 5) * 5;
}

export function analyzeCables(p: Project): Map<string, CableInfo> {
  return derive(p, 'cables', () => {
    const items = new Map(p.items.map((i) => [i.id, i]));
    const offsets = pairOffsets(p);
    const m = new Map<string, CableInfo>();
    const used = new Map<string, string[]>();
    for (const c of p.cables) {
      m.set(c.id, analyzeOne(p, c, items, offsets));
      for (const e of [c.a, c.b]) {
        const k = e.item + '#' + e.port;
        const u = used.get(k);
        if (u) u.push(c.id);
        else used.set(k, [c.id]);
      }
    }
    for (const [, ids] of used) {
      if (ids.length > 1) {
        for (const id of ids) {
          const inf = m.get(id)!;
          // RF alıcılarına çok verici bağlanamaz; ağ switch portu da tek kablo alır
          if (!inf.issues.includes('chk.portBusy')) inf.issues.push('chk.portBusy');
        }
      }
    }
    return m;
  });
}

// Bir öğenin portlarına bağlı kablolar
export function cablesAt(p: Project): Map<string, Cable[]> {
  return derive(p, 'cablesAt', () => {
    const m = new Map<string, Cable[]>();
    for (const c of p.cables) {
      for (const e of [c.a, c.b]) {
        const k = e.item;
        const l = m.get(k);
        if (l) l.push(c);
        else m.set(k, [c]);
      }
    }
    return m;
  });
}

export function portUse(p: Project): Map<string, Cable> {
  return derive(p, 'portUse', () => {
    const m = new Map<string, Cable>();
    for (const c of p.cables) {
      m.set(c.a.item + '#' + c.a.port, c);
      m.set(c.b.item + '#' + c.b.port, c);
    }
    return m;
  });
}

// İki port için uygun kablo tipleri (en iyi önce)
export function suggestCableTypes(pa: PortInst, pb: PortInst): CableType[] {
  const res = CABLE_TYPES.filter((ct) => ct.id !== 'generic' && cableFits(ct, pa.group.conn, pb.group.conn));
  const dom = pa.group.domain === pb.group.domain ? pa.group.domain : pa.group.domain;
  res.sort((x, y) => {
    const sx = (x.domain === dom ? 0 : 1) + (x.ends[0].includes(pa.group.conn) && x.ends[1].includes(pb.group.conn) ? 0 : 0.5);
    const sy = (y.domain === dom ? 0 : 1) + (y.ends[0].includes(pa.group.conn) && y.ends[1].includes(pb.group.conn) ? 0 : 0.5);
    return sx - sy;
  });
  if (res.length === 0) res.push(cableType('generic'));
  return res;
}

// Kaynak→hedef için en uygun boş port çifti
export function bestPortPair(p: Project, a: Item, b: Item, prefer?: string): { pa: PortInst; pb: PortInst } | null {
  const da = getDef(p, a.defId);
  const db = getDef(p, b.defId);
  const used = portUse(p);
  const freeA = portsOf(da).filter((x) => !used.has(a.id + '#' + x.id) && (x.group.dir === 'out' || x.group.dir === 'io'));
  const freeB = portsOf(db).filter((x) => !used.has(b.id + '#' + x.id) && (x.group.dir === 'in' || x.group.dir === 'io'));
  let best: { pa: PortInst; pb: PortInst; s: number } | null = null;
  for (const pa of freeA) {
    for (const pb of freeB) {
      if (pa.group.domain !== pb.group.domain) {
        const ok = (pa.group.domain === 'digital' && pb.group.domain === 'network') || (pa.group.domain === 'network' && pb.group.domain === 'digital');
        if (!ok) continue;
      }
      const types = suggestCableTypes(pa, pb);
      if (types[0].id === 'generic') continue;
      let s = 0;
      if (prefer && pa.group.domain === prefer) s += 10;
      if (pa.group.domain === 'audio' || pa.group.domain === 'speaker') s += 3;
      if (pa.group.dir === 'out') s += 1;
      if (pb.group.dir === 'in') s += 1;
      if (pa.group.key === 'link' || pa.group.key === 'thru' || pa.group.key === 'pwrout') s -= 2;
      if (pa.group.key === 'main' || pa.group.key === 'master') s += 2;
      s -= pa.index * 0.01 + pb.index * 0.01;
      if (!best || s > best.s) best = { pa, pb, s };
    }
  }
  return best ? { pa: best.pa, pb: best.pb } : null;
}
