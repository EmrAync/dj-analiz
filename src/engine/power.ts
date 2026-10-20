import { findPort, getDef, itemDims, portsOf } from '../model/project';
import type { Item, Phase, Project } from '../model/types';
import { analyzeCables } from './cables';
import { derive } from './derive';

export const PF = 0.95; // güç faktörü (anahtarlamalı güç kaynakları)
const RHO = 0.0175; // bakır Ω·mm²/m

export type PhaseTag = Phase | '3P';

export interface PowerNode {
  itemId: string;
  ownW: number;
  downW: number; // kendisi + beslediği her şey
  feed?: string; // besleyen kablo
  phase?: PhaseTag;
  rootId?: string;
  children: { cable: string; port: string; item: string }[];
}

export interface Circuit {
  itemId: string; // kaynak / dağıtıcı
  port?: string; // çıkış portu (yoksa kaynağın kendisi)
  label: string;
  breakerA: number;
  voltage: number;
  phases: 1 | 3;
  phase?: PhaseTag;
  loadW: number;
  amps: number; // en yüklü faz akımı
  pct: number;
  perPhase?: Record<Phase, number>; // W
}

export interface PowerReport {
  nodes: Map<string, PowerNode>;
  roots: string[];
  circuits: Circuit[];
  unpowered: string[]; // elektrik gereken ama bağlı olmayan
  unfedDistros: string[]; // girişi bağlı olmayan dağıtıcı
  totalW: number;
  connectedW: number;
  loop: boolean;
  generatorIssues: { itemId: string; kva: number; loadKva: number }[];
}

export function ownWatt(p: Project, it: Item): number {
  if (it.watt != null) return it.watt;
  const def = getDef(p, it.defId);
  if (def.id === 'ledwall' || (def.props && (def.props as Record<string, unknown>).panel)) {
    const { w, h } = itemDims(it, def);
    return Math.round(w * h * 150);
  }
  if (def.acoustic?.kind === 'array' && def.watt) return def.watt * (it.count || 1);
  return def.watt || 0;
}

export function needsPower(p: Project, it: Item): boolean {
  const def = getDef(p, it.defId);
  return portsOf(def).some((x) => x.group.domain === 'power' && x.group.dir === 'in') && ownWatt(p, it) > 0;
}

export function analyzePower(p: Project): PowerReport {
  return derive(p, 'power', () => {
    const cinfo = analyzeCables(p);
    const items = new Map(p.items.map((i) => [i.id, i]));
    const nodes = new Map<string, PowerNode>();
    const node = (id: string) => {
      let n = nodes.get(id);
      if (!n) {
        const it = items.get(id)!;
        n = { itemId: id, ownW: ownWatt(p, it), downW: 0, children: [] };
        nodes.set(id, n);
      }
      return n;
    };
    // yönlü kenarlar: çıkış → giriş
    for (const c of p.cables) {
      const inf = cinfo.get(c.id);
      if (!inf || inf.type.domain !== 'power' || !inf.a || !inf.b || !inf.portA || !inf.portB) continue;
      let up = c.a;
      let dn = c.b;
      if (inf.portA.group.dir === 'in' && inf.portB.group.dir !== 'in') {
        up = c.b;
        dn = c.a;
      }
      const upN = node(up.item);
      const dnN = node(dn.item);
      if (dnN.feed) continue; // ikinci besleme yok sayılır
      dnN.feed = c.id;
      upN.children.push({ cable: c.id, port: up.port, item: dn.item });
    }
    for (const it of p.items) node(it.id);

    let loop = false;
    const visiting = new Set<string>();
    const done = new Set<string>();
    const calc = (id: string): number => {
      const n = nodes.get(id)!;
      if (done.has(id)) return n.downW;
      if (visiting.has(id)) {
        loop = true;
        return 0;
      }
      visiting.add(id);
      let s = n.ownW;
      for (const ch of n.children) s += calc(ch.item);
      visiting.delete(id);
      done.add(id);
      n.downW = s;
      return s;
    };

    const roots: string[] = [];
    const unfedDistros: string[] = [];
    for (const it of p.items) {
      const n = nodes.get(it.id)!;
      if (n.feed) continue;
      const def = getDef(p, it.defId);
      if (def.source) roots.push(it.id);
      else if (n.children.length > 0) {
        unfedDistros.push(it.id);
        roots.push(it.id);
      }
    }
    for (const r of roots) calc(r);

    // faz ataması
    const assign = (id: string, ph: PhaseTag, root: string, depth: number) => {
      if (depth > 50) return;
      const n = nodes.get(id)!;
      n.phase = ph;
      n.rootId = root;
      const def = getDef(p, items.get(id)!.defId);
      for (const ch of n.children) {
        const port = findPort(def, ch.port);
        let cph: PhaseTag = ph;
        if (port?.phase) cph = port.phase;
        else if (ph === '3P') {
          const cdef = getDef(p, items.get(ch.item)!.defId);
          const three = portsOf(cdef).some((x) => x.group.domain === 'power' && x.group.dir === 'in' && /r$/.test(x.group.conn));
          cph = three ? '3P' : 'L1';
        }
        assign(ch.item, cph, root, depth + 1);
      }
    };
    for (const r of roots) {
      const def = getDef(p, items.get(r)!.defId);
      const three = def.source ? def.source.phases === 3 : portsOf(def).some((x) => x.group.domain === 'power' && x.group.dir === 'in' && /r$/.test(x.group.conn));
      assign(r, three ? '3P' : 'L1', r, 0);
    }

    // faz yükleri (bir alt ağaç için)
    const phaseLoads = (id: string, acc: Record<Phase, number>, guard = 0) => {
      if (guard > 60) return;
      const n = nodes.get(id)!;
      if (n.phase === '3P') {
        acc.L1 += n.ownW / 3;
        acc.L2 += n.ownW / 3;
        acc.L3 += n.ownW / 3;
      } else acc[n.phase || 'L1'] += n.ownW;
      for (const ch of n.children) phaseLoads(ch.item, acc, guard + 1);
    };

    const circuits: Circuit[] = [];
    const ampsOf = (perPhase: Record<Phase, number>, phases: 1 | 3, voltage: number, total: number) =>
      phases === 3 ? Math.max(perPhase.L1, perPhase.L2, perPhase.L3) / (230 * PF) : total / ((voltage === 400 ? 230 : voltage) * PF);
    for (const it of p.items) {
      const def = getDef(p, it.defId);
      const n = nodes.get(it.id)!;
      if (def.source && !n.feed) {
        const pp = { L1: 0, L2: 0, L3: 0 };
        phaseLoads(it.id, pp);
        const br = it.breakerA ?? def.source.breakerA;
        const amps = ampsOf(pp, def.source.phases, def.source.voltage, n.downW);
        circuits.push({ itemId: it.id, label: it.label, breakerA: br, voltage: def.source.voltage, phases: def.source.phases, loadW: n.downW, amps, pct: amps / br, perPhase: def.source.phases === 3 ? pp : undefined, phase: def.source.phases === 3 ? '3P' : 'L1' });
      }
      // çıkış portu sigortaları
      const byPort = new Map<string, string[]>();
      for (const ch of n.children) {
        const l = byPort.get(ch.port);
        if (l) l.push(ch.item);
        else byPort.set(ch.port, [ch.item]);
      }
      for (const [portId, kids] of byPort) {
        const port = findPort(def, portId);
        if (!port?.breakerA || def.source) continue;
        const pp = { L1: 0, L2: 0, L3: 0 };
        let w = 0;
        for (const k of kids) {
          phaseLoads(k, pp);
          w += nodes.get(k)!.downW;
        }
        const three = /r$/.test(port.group.conn);
        const amps = three ? Math.max(pp.L1, pp.L2, pp.L3) / (230 * PF) : w / (230 * PF);
        circuits.push({ itemId: it.id, port: portId, label: `${it.label} · ${port.label}`, breakerA: port.breakerA, voltage: three ? 400 : 230, phases: three ? 3 : 1, phase: port.phase || (three ? '3P' : n.phase), loadW: w, amps, pct: amps / port.breakerA, perPhase: three ? pp : undefined });
      }
    }

    // kablo akımı ve gerilim düşümü
    for (const c of p.cables) {
      const inf = cinfo.get(c.id);
      if (!inf || inf.type.domain !== 'power') continue;
      const dn = [...nodes.values()].find((x) => x.feed === c.id);
      if (!dn) continue;
      let amps: number;
      let drop: number;
      const mm2 = inf.type.mm2 || 1.5;
      if (dn.phase === '3P') {
        const pp = { L1: 0, L2: 0, L3: 0 };
        phaseLoads(dn.itemId, pp);
        amps = Math.max(pp.L1, pp.L2, pp.L3) / (230 * PF);
        drop = ((Math.sqrt(3) * inf.len * amps * RHO) / mm2 / 400) * 100;
      } else {
        amps = dn.downW / (230 * PF);
        drop = ((2 * inf.len * amps * RHO) / mm2 / 230) * 100;
      }
      inf.amps = amps;
      inf.dropPct = drop;
      if (inf.type.ampMax && amps > inf.type.ampMax && !inf.issues.includes('chk.cableOverload')) inf.issues.push('chk.cableOverload');
      if (drop > 3 && !inf.issues.includes('chk.voltageDrop')) inf.issues.push('chk.voltageDrop');
    }

    const unpowered = p.items.filter((it) => needsPower(p, it) && !nodes.get(it.id)!.feed && !getDef(p, it.defId).source).map((i) => i.id);
    let totalW = 0;
    let connectedW = 0;
    for (const it of p.items) {
      const w = ownWatt(p, it);
      totalW += w;
      const root = nodes.get(it.id)!.rootId;
      if (root && getDef(p, items.get(root)!.defId).source) connectedW += w;
    }
    const generatorIssues: PowerReport['generatorIssues'] = [];
    for (const r of roots) {
      const def = getDef(p, items.get(r)!.defId);
      if (def.source?.kva) {
        const loadKva = nodes.get(r)!.downW / PF / 1000;
        if (loadKva > def.source.kva * 0.8) generatorIssues.push({ itemId: r, kva: def.source.kva, loadKva });
      }
    }
    return { nodes, roots, circuits, unpowered, unfedDistros, totalW, connectedW, loop, generatorIssues };
  });
}
