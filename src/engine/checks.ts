import { getDef, itemBaseZ, itemDims } from '../model/project';
import type { Project } from '../model/types';
import { listenZones, offAxis, roomAcoustics, sourcesOf, splGrid, subClusters, suggestDelay, farField } from './acoustics';
import { analyzeCables, cablesAt } from './cables';
import { derive, segHitsRect } from './derive';
import { analyzePower } from './power';
import { activeView } from '../model/variants';

export type Level = 'error' | 'warn' | 'info';

export interface Issue {
  id: string;
  level: Level;
  code: string; // i18n anahtarı
  vars?: Record<string, string | number>;
  items?: string[];
  cables?: string[];
  areaId?: string;
}

const CABLE_LEVEL: Record<string, Level> = {
  'chk.cableOrphan': 'error',
  'chk.cablePortMissing': 'error',
  'chk.cableConn': 'warn',
  'chk.cableDomain': 'error',
  'chk.cableTypeDomain': 'warn',
  'chk.cableDir': 'warn',
  'chk.portBusy': 'error',
  'chk.cableTooLong': 'warn',
  'chk.cableNoLen': 'info',
  'chk.speakerLoss': 'warn',
  'chk.cableOverload': 'error',
  'chk.voltageDrop': 'warn',
  'chk.wirelessRange': 'warn',
  'chk.protocol': 'error',
};

// Kablo yolu yürüme yolu / kaçış yolu bölgesinden geçiyor mu?
export function walkwayCrossings(p: Project): { zoneId: string; cables: string[] }[] {
  const pv = activeView(p);
  if (pv !== p) return walkwayCrossings(pv);
  return derive(p, 'walkway', () => {
    const ci = analyzeCables(p);
    const res: { zoneId: string; cables: string[] }[] = [];
    for (const z of p.zones) {
      if (z.kind !== 'walkway') continue;
      const hits: string[] = [];
      for (const c of p.cables) {
        const inf = ci.get(c.id);
        if (!inf?.path || inf.type.wireless || inf.a?.areaId !== z.areaId) continue;
        for (let i = 1; i < inf.path.length; i++) {
          if (segHitsRect(inf.path[i - 1], inf.path[i], z)) {
            hits.push(c.id);
            break;
          }
        }
      }
      if (hits.length) res.push({ zoneId: z.id, cables: hits });
    }
    return res;
  });
}

export function runChecks(p: Project): Issue[] {
  const pv = activeView(p);
  if (pv !== p) return runChecks(pv);
  return derive(p, 'checks', () => {
    const out: Issue[] = [];
    let n = 0;
    const add = (level: Level, code: string, extra?: Partial<Issue>) => out.push({ id: 'i' + n++, level, code, ...extra });
    const items = new Map(p.items.map((i) => [i.id, i]));
    const lab = (id: string) => items.get(id)?.label || '?';

    // —— Kablolar ——
    const ci = analyzeCables(p);
    for (const [id, inf] of ci) {
      for (const code of inf.issues) {
        if (code === 'chk.cableCrossArea') continue;
        add(CABLE_LEVEL[code] || 'warn', code, { cables: [id], vars: { c: inf.cable.label, len: inf.len, max: inf.type.maxLen || 0, loss: inf.lossDb != null ? inf.lossDb.toFixed(1) : '', drop: inf.dropPct != null ? inf.dropPct.toFixed(1) : '' }, areaId: inf.a?.areaId });
      }
    }

    // —— Elektrik ——
    const pw = analyzePower(p);
    for (const id of pw.unpowered) add('warn', 'chk.unpowered', { items: [id], vars: { i: lab(id) }, areaId: items.get(id)?.areaId });
    for (const id of pw.unfedDistros) add('warn', 'chk.unfedDistro', { items: [id], vars: { i: lab(id) }, areaId: items.get(id)?.areaId });
    for (const c of pw.circuits) {
      const vars = { c: c.label, a: c.amps.toFixed(1), b: c.breakerA, pct: Math.round(c.pct * 100) };
      if (c.pct > 1) add('error', 'chk.overload', { items: [c.itemId], vars });
      else if (c.pct > 0.8) add('warn', 'chk.nearLimit', { items: [c.itemId], vars });
      if (c.perPhase) {
        const v = [c.perPhase.L1, c.perPhase.L2, c.perPhase.L3];
        const mx = Math.max(...v);
        const mn = Math.min(...v);
        if (mx > 1500 && (mx - mn) / mx > 0.35) add('warn', 'chk.phaseImbalance', { items: [c.itemId], vars: { c: c.label, l1: Math.round(v[0]), l2: Math.round(v[1]), l3: Math.round(v[2]) } });
      }
    }
    for (const g of pw.generatorIssues) add('warn', 'chk.generator', { items: [g.itemId], vars: { i: lab(g.itemId), kva: g.kva, load: g.loadKva.toFixed(1) } });
    if (pw.loop) add('error', 'chk.powerLoop');

    // —— Sinyal ——
    const at = cablesAt(p);
    for (const it of p.items) {
      if (it.hidden) continue;
      const def = getDef(p, it.defId);
      const cs = at.get(it.id) || [];
      if (def.acoustic && def.acoustic.kind !== 'iem') {
        const sig = cs.some((c) => {
          const inf = ci.get(c.id);
          if (!inf || inf.type.domain === 'power') return false;
          const mine = c.a.item === it.id ? inf.portA : inf.portB;
          return mine && mine.group.dir !== 'out';
        });
        if (!sig) add('warn', 'chk.noSignal', { items: [it.id], vars: { i: it.label }, areaId: it.areaId });
      }
      if (def.cat === 'mikrofon' && def.icon !== 'receiver' && cs.length === 0) add('info', 'chk.micFree', { items: [it.id], vars: { i: it.label }, areaId: it.areaId });
    }

    // —— Akustik ve yerleşim ——
    let wireless = 0;
    for (const a of p.areas) {
      const srcs = sourcesOf(p, a.id);
      const aItems = p.items.filter((i) => i.areaId === a.id && !i.hidden);
      const zones = p.zones.filter((z) => z.areaId === a.id);
      const listen = listenZones(p, a.id);
      if (aItems.some((i) => getDef(p, i.defId).acoustic) === false && aItems.length > 0) add('info', 'chk.noSpeakers', { areaId: a.id, vars: { a: a.name } });
      for (const it of aItems) {
        const def = getDef(p, it.defId);
        const dims = itemDims(it, def);
        if (def.cat === 'mikrofon' && def.icon !== 'receiver' && def.ports.some((x) => x.domain === 'wireless')) wireless++;
        // salon dışı
        if (def.cat !== 'mekan' && (it.x < -0.3 || it.y < -0.3 || it.x > a.w + 0.3 || it.y > a.d + 0.3)) add('warn', 'chk.outside', { items: [it.id], vars: { i: it.label }, areaId: a.id });
        // yürüme yolu / yasak alan
        if (def.id !== 'ramp' && def.cat !== 'mekan') {
          for (const z of zones) {
            if ((z.kind === 'walkway' || z.kind === 'nogo') && it.x > z.x && it.x < z.x + z.w && it.y > z.y && it.y < z.y + z.d) add('warn', 'chk.inWalkway', { items: [it.id], vars: { i: it.label, z: z.name }, areaId: a.id });
          }
        }
        // seyirci içinde alçak hoparlör
        const ak = def.acoustic?.kind;
        if ((ak === 'top' || ak === 'fill') && it.mount !== 'flown') {
          const bottom = itemBaseZ(p, it);
          const inListen = listen.some((z) => it.x >= z.x && it.x <= z.x + z.w && it.y >= z.y && it.y <= z.y + z.d);
          if (inListen && bottom < 1.9) add('warn', 'chk.lowSpeaker', { items: [it.id], vars: { i: it.label, h: bottom.toFixed(2) }, areaId: a.id });
          if (dims.h > 0 && bottom + dims.h > a.h && a.indoor) add('warn', 'chk.ceiling', { items: [it.id], vars: { i: it.label }, areaId: a.id });
        }
        // gecikme önerisi
        const sd = suggestDelay(p, it);
        if (sd != null && sd > 2 && Math.abs((it.delayMs || 0) - sd) > 3) add('info', 'chk.delayNeeded', { items: [it.id], vars: { i: it.label, ms: sd.toFixed(1) }, areaId: a.id });
      }
      // geri besleme riski: mikrofon ana hoparlörün önünde
      const mics = aItems.filter((i) => {
        const d = getDef(p, i.defId);
        return d.cat === 'mikrofon' && d.icon !== 'receiver';
      });
      for (const m of mics) {
        const mz = itemBaseZ(p, m) + 0.1;
        for (const s of srcs) {
          if (s.kind === 'sub' || s.role === 'monitor' || s.kind === 'monitor') continue;
          const vx = m.x - s.x;
          const vy = m.y - s.y;
          const vz = mz - s.z;
          const d = Math.hypot(vx, vy, vz);
          if (d > 7) continue;
          const o = offAxis(s, vx, vy, vz);
          const sItem = items.get(s.itemId);
          const vCov = s.kind === 'array' && sItem ? (sItem.splays || []).reduce((a, b) => a + b, 0) + s.v : s.v;
          if (o.front > 0 && o.ah < s.h / 2 + 5 && o.av < vCov / 2 + 8) {
            add('warn', 'chk.feedback', { items: [m.id, s.itemId], vars: { m: m.label, s: lab(s.itemId), d: d.toFixed(1) }, areaId: a.id });
            break;
          }
        }
      }
      // power alley
      const cl = subClusters(p, a.id);
      if (cl.length >= 2) {
        let far = 0;
        for (let i = 0; i < cl.length; i++) for (let j = i + 1; j < cl.length; j++) far = Math.max(far, Math.hypot(cl[i].x - cl[j].x, cl[i].y - cl[j].y));
        if (far > 3) add('info', 'chk.powerAlley', { areaId: a.id, vars: { d: far.toFixed(1) } });
      }
      // kapsama
      if (srcs.some((s) => s.kind !== 'sub')) {
        const g = splGrid(p, a.id, { band: 'mid', freq: 1000, coherent: false });
        if (g?.stats) {
          const spread = g.stats.p90 - g.stats.p10;
          if (spread > 10) add('info', 'chk.coverageSpread', { areaId: a.id, vars: { a: a.name, d: spread.toFixed(0) } });
          if (g.stats.avg < p.settings.targetSpl - 6) add('warn', 'chk.splLow', { areaId: a.id, vars: { a: a.name, avg: g.stats.avg.toFixed(0), t: p.settings.targetSpl } });
          if (g.stats.max > 115) add('warn', 'chk.splHigh', { areaId: a.id, vars: { a: a.name, max: g.stats.max.toFixed(0) } });
        }
      }
      // yankı
      const ra = roomAcoustics(a);
      if (ra && ra.rt[1] > 1.6) add('info', 'chk.reverb', { areaId: a.id, vars: { a: a.name, rt: ra.rt[1].toFixed(1) } });
      // sis / pus
      if (a.indoor && aItems.some((i) => /hazer|fog|lowfog/.test(i.defId))) add('info', 'chk.fogAlarm', { areaId: a.id, vars: { a: a.name } });
      // asma
      const flown = aItems.filter((i) => i.mount === 'flown' && getDef(p, i.defId).cat !== 'truss');
      if (flown.length && !aItems.some((i) => i.defId === 'hoist' || i.defId === 'truss-tower')) add('info', 'chk.rigging', { items: flown.map((i) => i.id), areaId: a.id });
      // açık hava
      if (!a.indoor) {
        const standing = aItems.filter((i) => i.mount === 'stand' || i.defId === 'tbar' || i.defId === 'windup' || i.defId === 'truss-tower');
        if (p.env.wind >= 13.9 && standing.length) add('error', 'chk.windStop', { areaId: a.id, vars: { w: p.env.wind } });
        else if (p.env.wind >= 8 && standing.length) add('warn', 'chk.wind', { areaId: a.id, vars: { w: p.env.wind } });
        if (p.env.rain) add('warn', 'chk.rain', { areaId: a.id });
      }
    }
    // yürüme yolu kablo
    for (const w of walkwayCrossings(p)) {
      const z = p.zones.find((x) => x.id === w.zoneId)!;
      add('warn', 'chk.cableWalkway', { cables: w.cables, areaId: z.areaId, vars: { z: z.name, n: w.cables.length } });
    }
    if (p.env.tempC >= 32) add('info', 'chk.heat', { vars: { t: p.env.tempC } });
    if (p.env.tempC <= 5) add('info', 'chk.cold', { vars: { t: p.env.tempC } });
    if (wireless > 4) add('info', 'chk.rfPlan', { vars: { n: wireless } });
    if (p.env.noiseLimit > 0 && p.env.neighborDist > 0) {
      const L = farField(p, p.env.neighborDist);
      if (L > p.env.noiseLimit) add('warn', 'chk.noise', { vars: { l: L.toFixed(0), lim: p.env.noiseLimit, d: p.env.neighborDist } });
    }
    // aynı etiket
    const seen = new Map<string, string>();
    for (const it of p.items) {
      const o = seen.get(it.label);
      if (o) add('warn', 'chk.dupLabel', { items: [o, it.id], vars: { l: it.label } });
      else seen.set(it.label, it.id);
    }
    const order: Record<Level, number> = { error: 0, warn: 1, info: 2 };
    out.sort((x, y) => order[x.level] - order[y.level]);
    return out;
  });
}
