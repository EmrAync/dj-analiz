// Kurulum talimatından proje planı: ekiplere göre aktiviteler, süre tahmini, bağımlılıklar,
// kritik yol (CPM) ve etkinlik saatine göre en geç başlangıç.
import { getDef } from '../model/project';
import type { Item, Project } from '../model/types';
import { analyzeCables } from './cables';
import type { SetupPhase, SetupStep } from './setup';
import { activeView } from '../model/variants';

export type Team = 'general' | 'stage' | 'rigging' | 'power' | 'sound' | 'light';
export const TEAMS: Team[] = ['general', 'stage', 'rigging', 'power', 'sound', 'light'];
export const TEAM_COLOR: Record<Team, string> = { general: '#64748b', stage: '#8b5cf6', rigging: '#b45309', power: '#dc2626', sound: '#2563eb', light: '#d97706' };

export type ActKey = SetupPhase | 'dmx' | 'video';

export interface Activity {
  id: ActKey;
  phase: SetupPhase;
  team: Team;
  steps: string[];
  n: number; // iş sayısı
  min: number; // süre (dk)
  deps: ActKey[];
  es: number;
  ef: number;
  ls: number;
  lf: number;
  slack: number;
  critical: boolean;
  done: number; // tamamlanan adım sayısı
  level: number; // diyagram sütunu
  icon: string;
}

export interface Plan {
  acts: Activity[];
  total: number; // dk
  start: number | null; // etkinlik saatine göre önerilen başlangıç (gün içi dakika)
  event: number | null; // etkinlik başlangıcı (gün içi dakika)
  buffer: number;
}

const ICON: Record<ActKey, string> = {
  prep: 'checklist',
  stage: 'stagedeck',
  rigging: 'truss',
  power: 'distro',
  speakers: 'speaker',
  foh: 'mixer',
  performers: 'mic',
  lights: 'movinghead',
  signal: 'cable',
  dmx: 'lightdesk',
  video: 'ledwall',
  powercables: 'powerstrip',
  poweron: 'bolt',
  test: 'speakerline',
};

// Bir adımın süresi (dk, 2 kişilik ekip)
function itemMinutes(p: Project, it: Item, phase: SetupPhase): number {
  const d = getDef(p, it.defId);
  const a = d.acoustic;
  switch (phase) {
    case 'stage':
      if (d.cat === 'sahne' && /deck|podest|riser/i.test(d.id)) return 12;
      return d.cat === 'mekan' ? 2 : 5;
    case 'rigging':
      return d.icon === 'hoist' ? 30 : d.icon === 'trusstower' ? 25 : 20;
    case 'power':
      return d.source ? 8 : 10;
    case 'speakers':
      if (!a) return 5;
      if (a.kind === 'array') return 20 + 10 * (it.count || 1) + (it.mount === 'flown' ? 30 : 0);
      if (a.kind === 'sub') return 6;
      return (it.mount === 'flown' ? 25 : it.mount === 'wall' ? 20 : 10) + (it.z > 2.4 ? 5 : 0);
    case 'foh':
      return d.icon === 'djbooth' ? 20 : d.cat === 'mikser' ? 15 : d.cat === 'dj' ? 10 : 5;
    case 'performers':
      if (d.icon === 'drums') return 35;
      if (d.cat === 'enstruman') return 10;
      if (d.cat === 'mikrofon') return d.icon === 'receiver' ? 6 : 3;
      return 6;
    case 'lights':
      if (d.icon === 'movinghead') return it.mount === 'flown' ? 15 : 10;
      if (d.icon === 'uplight') return 3;
      if (d.cat === 'video') return d.icon === 'ledwall' ? 60 : 15;
      return it.mount === 'flown' ? 10 : 6;
    default:
      return 5;
  }
}

export function buildPlan(p: Project, steps: SetupStep[]): Plan {
  const pv = activeView(p);
  if (pv !== p) return buildPlan(pv, steps);
  const ci = analyzeCables(p);
  const byId = new Map(p.items.map((i) => [i.id, i]));
  const acc = new Map<ActKey, { steps: string[]; min: number; n: number; done: number }>();
  const add = (k: ActKey, s: SetupStep, min: number) => {
    let a = acc.get(k);
    if (!a) {
      a = { steps: [], min: 0, n: 0, done: 0 };
      acc.set(k, a);
    }
    a.steps.push(s.id);
    a.min += min;
    a.n++;
    if (p.done[s.id]) a.done++;
  };
  for (const s of steps) {
    if (s.phase === 'prep') add('prep', s, 20 + Math.ceil(p.items.length / 10) * 2);
    else if (s.phase === 'poweron') add('poweron', s, 10);
    else if (s.phase === 'test') add('test', s, 30 + 5 * p.items.filter((i) => getDef(p, i.defId).icon === 'micwireless').length);
    else if (s.phase === 'signal' || s.phase === 'powercables') {
      const c = s.cables?.[0] ? ci.get(s.cables[0]) : undefined;
      const len = c?.len ?? 5;
      const dom = c?.type.domain;
      const k: ActKey = s.phase === 'powercables' ? 'powercables' : dom === 'dmx' ? 'dmx' : dom === 'video' ? 'video' : 'signal';
      add(k, s, (c?.type.wireless ? 1 : 2) + len * 0.06);
    } else if (s.phase === 'stage' && s.id.startsWith('zn:')) {
      const z = p.zones.find((x) => 'zn:' + x.id === s.id);
      add('stage', s, z ? (z.kind === 'stage' && z.elev > 0 ? 10 + z.w * z.d * 1.2 : z.kind === 'walkway' ? 5 : 8) : 8);
    } else {
      const its = (s.items || []).map((id) => byId.get(id)).filter(Boolean) as Item[];
      add(s.phase, s, its.length ? its.reduce((m, it) => m + itemMinutes(p, it, s.phase), 0) : 5);
    }
  }
  const team: Record<ActKey, Team> = { prep: 'general', stage: 'stage', rigging: 'rigging', power: 'power', speakers: 'sound', foh: 'sound', performers: 'sound', lights: 'light', signal: 'sound', dmx: 'light', video: 'light', powercables: 'power', poweron: 'general', test: 'sound' };
  const phaseOf: Record<ActKey, SetupPhase> = { prep: 'prep', stage: 'stage', rigging: 'rigging', power: 'power', speakers: 'speakers', foh: 'foh', performers: 'performers', lights: 'lights', signal: 'signal', dmx: 'signal', video: 'signal', powercables: 'powercables', poweron: 'poweron', test: 'test' };
  // bağımlılıklar (olmayan aktiviteler atlanarak bir öncekine bağlanır)
  const DEPS: Record<ActKey, ActKey[]> = {
    prep: [],
    stage: ['prep'],
    rigging: ['stage'],
    power: ['stage'],
    speakers: ['stage', 'rigging'],
    foh: ['stage'],
    performers: ['stage'],
    lights: ['stage', 'rigging'],
    signal: ['speakers', 'foh', 'performers'],
    dmx: ['lights'],
    video: ['lights'],
    powercables: ['power', 'speakers', 'foh', 'performers', 'lights'],
    poweron: ['signal', 'dmx', 'video', 'powercables'],
    test: ['poweron'],
  };
  const exists = (k: ActKey) => acc.has(k);
  const resolve = (k: ActKey, seen = new Set<ActKey>()): ActKey[] => {
    const out = new Set<ActKey>();
    for (const d of DEPS[k]) {
      if (seen.has(d)) continue;
      seen.add(d);
      if (exists(d)) out.add(d);
      else for (const x of resolve(d, seen)) out.add(x);
    }
    return [...out];
  };
  const order: ActKey[] = ['prep', 'stage', 'rigging', 'power', 'speakers', 'foh', 'performers', 'lights', 'signal', 'dmx', 'video', 'powercables', 'poweron', 'test'];
  const acts: Activity[] = order
    .filter(exists)
    .map((k) => {
      const a = acc.get(k)!;
      return { id: k, phase: phaseOf[k], team: team[k], steps: a.steps, n: a.n, min: Math.max(5, Math.round(a.min / 5) * 5), deps: resolve(k), es: 0, ef: 0, ls: 0, lf: 0, slack: 0, critical: false, done: a.done, level: 0, icon: ICON[k] };
    });
  const get = (k: ActKey) => acts.find((a) => a.id === k)!;
  // ileri geçiş
  for (const a of acts) {
    a.es = Math.max(0, ...a.deps.map((d) => get(d).ef));
    a.ef = a.es + a.min;
    a.level = Math.max(0, ...a.deps.map((d) => get(d).level + 1));
  }
  const total = Math.max(0, ...acts.map((a) => a.ef));
  // geri geçiş
  for (const a of [...acts].reverse()) {
    const succ = acts.filter((b) => b.deps.includes(a.id));
    a.lf = succ.length ? Math.min(...succ.map((b) => b.ls)) : total;
    a.ls = a.lf - a.min;
    a.slack = a.ls - a.es;
    a.critical = a.slack < 0.5;
  }
  const hm = /^(\d{1,2})[:.](\d{2})/.exec(p.meta.time || '');
  const event = hm ? Number(hm[1]) * 60 + Number(hm[2]) : null;
  const buffer = 45;
  return { acts, total, event, buffer, start: event != null ? event - total - buffer : null };
}

export function clock(min: number): string {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
