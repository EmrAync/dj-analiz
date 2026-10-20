import { fmt, L, type TFn, type TKey } from '../i18n';
import { getDef, itemBaseZ, portLabel } from '../model/project';
import type { Area, Item, Lang, Project } from '../model/types';
import { DOMAINS, DOMAIN_ORDER } from '../catalog/connectors';
import { sourcesOf, suggestDelay } from './acoustics';
import { analyzeCables } from './cables';
import { walkwayCrossings } from './checks';
import { analyzePower } from './power';

export type SetupPhase = 'prep' | 'stage' | 'rigging' | 'power' | 'speakers' | 'foh' | 'performers' | 'lights' | 'signal' | 'powercables' | 'poweron' | 'test';

export const PHASES: SetupPhase[] = ['prep', 'stage', 'rigging', 'power', 'speakers', 'foh', 'performers', 'lights', 'signal', 'powercables', 'poweron', 'test'];

export interface SetupStep {
  id: string;
  phase: SetupPhase;
  title: string;
  lines: string[];
  items?: string[];
  cables?: string[];
  icon?: string;
  compact?: boolean;
  warn?: string[];
}

export function posText(t: TFn, lang: Lang, area: Area, x: number, y: number): string {
  const dl = x;
  const dr = area.w - x;
  const dt = y;
  const db = area.d - y;
  const hx = dl <= dr ? t('setup.fromLeft', { m: fmt(dl, 2, lang) }) : t('setup.fromRight', { m: fmt(dr, 2, lang) });
  const hy = dt <= db ? t('setup.fromTop', { m: fmt(dt, 2, lang) }) : t('setup.fromBottom', { m: fmt(db, 2, lang) });
  return `${hx} · ${hy}`;
}

export function aimPoint(p: Project, it: Item): { x: number; y: number; dist: number } | null {
  const src = sourcesOf(p, it.areaId).find((s) => s.itemId === it.id);
  if (!src) return null;
  const yaw = (it.rot * Math.PI) / 180;
  const pitch = ((src.pitch || 0) * Math.PI) / 180;
  const dx = -Math.sin(yaw);
  const dy = Math.cos(yaw);
  let hd = 10;
  if (pitch < -0.01) {
    const drop = src.z - p.settings.earH;
    hd = (drop / Math.tan(-pitch)) || 10;
  }
  hd = Math.max(3, Math.min(25, hd));
  const area = p.areas.find((a) => a.id === it.areaId);
  let x = src.x + dx * hd;
  let y = src.y + dy * hd;
  if (area) {
    x = Math.max(0, Math.min(area.w, x));
    y = Math.max(0, Math.min(area.d, y));
  }
  return { x, y, dist: Math.hypot(x - src.x, y - src.y) };
}

function mountText(t: TFn, lang: Lang, p: Project, it: Item): string {
  const z = itemBaseZ(p, it);
  const h = fmt(z, 2, lang);
  switch (it.mount) {
    case 'stand':
      return t('setup.mountStand', { h });
    case 'pole':
      return t('setup.mountPole', { h });
    case 'flown':
      return t('setup.mountFlown', { h });
    case 'wall':
      return t('setup.mountWall', { h });
    case 'table':
      return t('setup.mountTable', { h });
    default:
      return z > 0.05 ? t('setup.mountStage', { h }) : t('setup.mountFloor');
  }
}

export function buildSetup(p: Project, t: TFn, lang: Lang): SetupStep[] {
  const steps: SetupStep[] = [];
  const ci = analyzeCables(p);
  const pw = analyzePower(p);
  const area = (id: string) => p.areas.find((a) => a.id === id) || p.areas[0];
  const nm = (it: Item) => {
    const d = getDef(p, it.defId);
    return it.name || [d.brand, d.model].filter(Boolean).join(' ') || L(d.name, lang);
  };
  const cableLine = (cid: string) => {
    const inf = ci.get(cid)!;
    const c = inf.cable;
    const a = inf.a && inf.portA ? `${inf.a.label} (${nm(inf.a)}) · ${portLabel(inf.portA, lang)}` : '?';
    const b = inf.b && inf.portB ? `${inf.b.label} (${nm(inf.b)}) · ${portLabel(inf.portB, lang)}` : '?';
    const len = inf.type.wireless ? t('setup.wireless') : `${fmt(inf.len, inf.len % 1 ? 1 : 0, lang)} m`;
    return `${c.label} · ${inf.type.short} ${len}${c.channel ? ` · „${c.channel}"` : ''}: ${a} → ${b}`;
  };
  const multi = p.areas.length > 1;
  const areaTag = (it: Item) => (multi ? ` [${area(it.areaId).name}]` : '');

  // 1 — Hazırlık
  {
    const lines = [t('setup.prep1', { n: p.items.length, c: p.cables.length }), t('setup.prep2'), t('setup.prep3')];
    for (const a of p.areas) lines.push(t('setup.prepArea', { a: a.name, w: fmt(a.w, 1, lang), d: fmt(a.d, 1, lang), h: fmt(a.h, 1, lang) }));
    if (!p.areas.every((a) => a.indoor)) lines.push(t('setup.prepOutdoor'));
    steps.push({ id: 'ph:prep', phase: 'prep', title: t('setup.prepTitle'), lines, icon: 'checklist' });
  }

  // 2 — Sahne / mekan
  for (const z of p.zones) {
    if (z.kind !== 'stage' && z.kind !== 'dance' && z.kind !== 'foh' && z.kind !== 'walkway') continue;
    const a = area(z.areaId);
    const lines = [posText(t, lang, a, z.x, z.y) + ' ' + t('setup.corner'), t('setup.zoneSize', { w: fmt(z.w, 2, lang), d: fmt(z.d, 2, lang) })];
    if (z.elev > 0) lines.push(t('setup.zoneElev', { h: fmt(z.elev, 2, lang) }));
    if (z.kind === 'walkway') lines.push(t('setup.walkwayKeep'));
    steps.push({ id: 'zn:' + z.id, phase: 'stage', title: `${z.name}${multi ? ` [${a.name}]` : ''}`, lines, icon: z.kind === 'stage' ? 'stagedeck' : z.kind === 'walkway' ? 'exit' : 'zone' });
  }
  // gruplanan sahne öğeleri
  const groups = new Map<string, Item[]>();
  for (const it of p.items) {
    const d = getDef(p, it.defId);
    if (d.cat !== 'sahne' && d.cat !== 'mekan') continue;
    if (d.cat === 'mekan' || d.id === 'person') continue;
    const k = d.id + '@' + it.areaId;
    const g = groups.get(k);
    if (g) g.push(it);
    else groups.set(k, [it]);
  }
  for (const [k, g] of groups) {
    const d = getDef(p, g[0].defId);
    const a = area(g[0].areaId);
    if (g.length > 3) {
      steps.push({ id: 'grp:' + k, phase: 'stage', title: `${g.length} × ${L(d.name, lang)}${multi ? ` [${a.name}]` : ''}`, lines: [t('setup.placeByPlan'), g.map((i) => i.label).join(', ')], items: g.map((i) => i.id), icon: d.icon });
    } else
      for (const it of g)
        steps.push({ id: 'it:' + it.id, phase: 'stage', title: `${it.label} · ${nm(it)}${areaTag(it)}`, lines: [posText(t, lang, a, it.x, it.y), t('setup.rotation', { r: Math.round(((it.rot % 360) + 360) % 360) })], items: [it.id], icon: d.icon });
  }

  // 3 — Truss / asma
  for (const it of p.items) {
    const d = getDef(p, it.defId);
    if (d.cat !== 'truss' || d.id === 'spk-stand') continue;
    const a = area(it.areaId);
    steps.push({ id: 'it:' + it.id, phase: 'rigging', title: `${it.label} · ${nm(it)}${areaTag(it)}`, lines: [posText(t, lang, a, it.x, it.y), mountText(t, lang, p, it), t('setup.rotation', { r: Math.round(((it.rot % 360) + 360) % 360) })], items: [it.id], icon: d.icon, warn: d.id === 'hoist' ? [t('setup.riggingWarn')] : undefined });
  }

  // 4 — Elektrik dağıtımı
  for (const it of p.items) {
    const d = getDef(p, it.defId);
    if (d.cat !== 'elektrik' || d.id === 'ramp' || d.id === 'extinguisher') continue;
    const a = area(it.areaId);
    const lines = [posText(t, lang, a, it.x, it.y)];
    if (d.source) lines.push(t('setup.source', { v: d.source.voltage, a: it.breakerA ?? d.source.breakerA }));
    const node = pw.nodes.get(it.id);
    if (node && node.downW > 0) lines.push(t('setup.loadOn', { w: Math.round(node.downW) }));
    steps.push({ id: 'it:' + it.id, phase: 'power', title: `${it.label} · ${nm(it)}${areaTag(it)}`, lines, items: [it.id], icon: d.icon, warn: d.source && d.source.voltage === 400 ? [t('setup.electricianWarn')] : undefined });
  }

  // 5 — Hoparlörler
  const spk = p.items.filter((i) => getDef(p, i.defId).acoustic && getDef(p, i.defId).acoustic!.kind !== 'iem' && i.role !== 'monitor' && getDef(p, i.defId).acoustic!.kind !== 'monitor');
  spk.sort((x, y) => (x.role === 'sub' ? 1 : 0) - (y.role === 'sub' ? 1 : 0) || x.label.localeCompare(y.label));
  for (const it of spk) {
    const d = getDef(p, it.defId);
    const a = area(it.areaId);
    const lines = [posText(t, lang, a, it.x, it.y), mountText(t, lang, p, it)];
    if (d.acoustic!.kind === 'array') lines.push(t('setup.array', { n: it.count || 1, s: (it.splays || []).slice(1).join(' / ') || '0' }));
    if (d.acoustic!.kind !== 'sub') {
      const ap = aimPoint(p, it);
      if (ap) lines.push(t('setup.aim', { pos: posText(t, lang, a, ap.x, ap.y), d: fmt(ap.dist, 1, lang) }));
      if (it.tilt) lines.push(it.tilt < 0 ? t('setup.tiltDown', { a: Math.abs(it.tilt) }) : t('setup.tiltUp', { a: it.tilt }));
    } else {
      lines.push(t('setup.subFront', { r: Math.round(((it.rot % 360) + 360) % 360) }));
    }
    const sd = suggestDelay(p, it);
    if (it.delayMs) lines.push(t('setup.delay', { ms: fmt(it.delayMs, 1, lang) }));
    else if (sd && sd > 2) lines.push(t('setup.delaySuggest', { ms: fmt(sd, 1, lang) }));
    if (it.polarity === -1) lines.push(t('setup.polarity'));
    if (it.gainDb) lines.push(t('setup.gain', { g: fmt(it.gainDb, 1, lang) }));
    if (it.notes) lines.push('📝 ' + it.notes);
    steps.push({ id: 'it:' + it.id, phase: 'speakers', title: `${it.label} · ${nm(it)}${areaTag(it)}`, lines, items: [it.id], icon: d.icon });
  }

  // 6 — FOH / DJ / işlem / ağ / hazırlık
  for (const it of p.items) {
    const d = getDef(p, it.defId);
    if (!['mikser', 'islem', 'dj', 'ag', 'hazirlik'].includes(d.cat)) continue;
    if (d.acoustic) continue;
    const a = area(it.areaId);
    const lines = [posText(t, lang, a, it.x, it.y), mountText(t, lang, p, it)];
    if (d.cat === 'hazirlik') lines.push(t('setup.tieTarget', { t: it.target || '—' }));
    if (it.notes) lines.push('📝 ' + it.notes);
    steps.push({ id: 'it:' + it.id, phase: 'foh', title: `${it.label} · ${nm(it)}${areaTag(it)}`, lines, items: [it.id], icon: d.icon });
  }

  // 7 — Müzisyen alanı: enstrüman, mikrofon, monitör
  for (const it of p.items) {
    const d = getDef(p, it.defId);
    const isMon = d.acoustic && (it.role === 'monitor' || d.acoustic.kind === 'monitor' || d.acoustic.kind === 'iem');
    if (d.cat !== 'enstruman' && d.cat !== 'mikrofon' && !isMon && !(d.cat === 'monitor' && !d.acoustic)) continue;
    const a = area(it.areaId);
    const lines = [posText(t, lang, a, it.x, it.y)];
    if (d.cat === 'mikrofon' && d.icon !== 'receiver') {
      if (it.channel) lines.push(t('setup.channel', { c: it.channel }));
      if (it.stand && it.stand !== 'none') lines.push(t(('setup.stand.' + it.stand) as TKey));
      if (it.phantom) lines.push(t('setup.phantom'));
    }
    if (isMon) lines.push(t('setup.monitorAim', { r: Math.round(((it.rot % 360) + 360) % 360), a: it.tilt || 0 }));
    if (d.cat !== 'mikrofon' && d.cat !== 'enstruman') lines.push(mountText(t, lang, p, it));
    steps.push({ id: 'it:' + it.id, phase: 'performers', title: `${it.label} · ${nm(it)}${areaTag(it)}`, lines, items: [it.id], icon: d.icon });
  }

  // 8 — Işık & görüntü
  for (const it of p.items) {
    const d = getDef(p, it.defId);
    if (d.cat !== 'isik' && d.cat !== 'video') continue;
    const a = area(it.areaId);
    const lines = [posText(t, lang, a, it.x, it.y), mountText(t, lang, p, it)];
    if (it.notes) lines.push('📝 ' + it.notes);
    steps.push({ id: 'it:' + it.id, phase: 'lights', title: `${it.label} · ${nm(it)}${areaTag(it)}`, lines, items: [it.id], icon: d.icon });
  }

  // 9–10 — Kablolar
  const walk = new Set(walkwayCrossings(p).flatMap((w) => w.cables));
  const sigCables = p.cables.filter((c) => ci.get(c.id)!.type.domain !== 'power');
  sigCables.sort((x, y) => DOMAIN_ORDER.indexOf(ci.get(x.id)!.type.domain) - DOMAIN_ORDER.indexOf(ci.get(y.id)!.type.domain) || x.label.localeCompare(y.label));
  for (const c of sigCables) {
    const inf = ci.get(c.id)!;
    steps.push({ id: 'cb:' + c.id, phase: 'signal', title: cableLine(c.id), lines: [L(DOMAINS[inf.type.domain].name, lang) + ' · ' + L(inf.type.name, lang)], cables: [c.id], compact: true, warn: walk.has(c.id) ? [t('setup.rampHere')] : undefined });
  }
  const pCables = p.cables.filter((c) => ci.get(c.id)!.type.domain === 'power');
  // önce ana besleme (kaynağa yakın) kabloları
  const depth = (cid: string) => {
    let d = 0;
    let n = [...pw.nodes.values()].find((x) => x.feed === cid);
    while (n && n.feed && d < 20) {
      const inf = ci.get(n.feed)!;
      const up = inf.portA?.group.dir === 'out' ? inf.a : inf.b;
      n = up ? pw.nodes.get(up.id) : undefined;
      d++;
    }
    return d;
  };
  pCables.sort((x, y) => depth(x.id) - depth(y.id) || x.label.localeCompare(y.label));
  for (const c of pCables) {
    const inf = ci.get(c.id)!;
    const extra: string[] = [];
    if (inf.amps != null) extra.push(t('setup.amps', { a: fmt(inf.amps, 1, lang) }));
    steps.push({ id: 'cb:' + c.id, phase: 'powercables', title: cableLine(c.id), lines: extra, cables: [c.id], compact: true, warn: walk.has(c.id) ? [t('setup.rampHere')] : undefined });
  }

  // 11 — Açma sırası
  {
    const order = (it: Item) => {
      const d = getDef(p, it.defId);
      if (d.source || d.cat === 'elektrik') return 0;
      if (d.acoustic || d.icon === 'amp') return 3;
      if (d.cat === 'mikser' || d.cat === 'islem') return 2;
      return 1;
    };
    const powered = p.items.filter((i) => pw.nodes.get(i.id)?.feed && order(i) > 0);
    const seq = [1, 2, 3].map((k) => powered.filter((i) => order(i) === k).map((i) => i.label).join(', ')).filter(Boolean);
    const lines = [t('setup.on0'), ...seq.map((s, i) => `${i + 1}. ${s}`), t('setup.onLast'), t('setup.offOrder')];
    steps.push({ id: 'ph:poweron', phase: 'poweron', title: t('setup.poweronTitle'), lines, icon: 'bolt' });
  }

  // 12 — Test
  {
    const lines = [t('setup.test1'), t('setup.test2'), t('setup.test3'), t('setup.test4'), t('setup.test5'), t('setup.test6', { t: p.settings.targetSpl })];
    if (p.items.some((i) => getDef(p, i.defId).acoustic?.kind === 'sub')) lines.splice(3, 0, t('setup.testSub'));
    if (p.items.some((i) => getDef(p, i.defId).ports.some((x) => x.domain === 'wireless'))) lines.push(t('setup.testRf'));
    lines.push(t('setup.testSafety'));
    steps.push({ id: 'ph:test', phase: 'test', title: t('setup.testTitle'), lines, icon: 'speakerline' });
  }
  return steps;
}
