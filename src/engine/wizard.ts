import { CATALOG, getDef, itemDims, makeItem, newArea, newProject, uid } from '../model/project';
import type { EventType, Item, Project, Zone, ZoneKind } from '../model/types';
import { autoPower, autoSignal } from './autowire';
import { suggestDelay } from './acoustics';

export interface WizardParams {
  name: string;
  eventType: EventType;
  guests: number;
  indoor: boolean;
  w: number; // 0 = otomatik
  d: number;
  h: number;
  music: 'dj' | 'band' | 'davulzurna' | 'djband';
  wirelessMics: number;
  lights: 'none' | 'basic' | 'full';
  power: 'schuko' | 'cee16' | 'cee32' | 'generator';
  quality: 'compact' | 'standard' | 'pro';
  tables: boolean;
  zoneNames: Record<ZoneKind, string>;
}

export const WIZ_DEFAULT: Omit<WizardParams, 'zoneNames'> = {
  name: '',
  eventType: 'dugun',
  guests: 250,
  indoor: true,
  w: 0,
  d: 0,
  h: 0,
  music: 'dj',
  wirelessMics: 2,
  lights: 'basic',
  power: 'cee16',
  quality: 'standard',
  tables: true,
};

export function autoRoom(guests: number, indoor: boolean): { w: number; d: number; h: number } {
  const A = guests * 1.5 + 70;
  const w = Math.round(Math.sqrt(A * 1.4));
  const d = Math.round(A / w);
  return { w: Math.max(10, w), d: Math.max(8, d), h: indoor ? (guests > 400 ? 6 : 4.5) : 12 };
}

function zone(p: Project, areaId: string, kind: ZoneKind, name: string, x: number, y: number, w: number, d: number, elev = 0): Zone {
  const z: Zone = { id: uid('zn'), areaId, kind, name, x: round2(x), y: round2(y), w: round2(w), d: round2(d), elev };
  p.zones.push(z);
  return z;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

function aimRot(fromX: number, fromY: number, toX: number, toY: number): number {
  // rot=0 → +y; rot pozitif → -x yönüne döner
  return Math.round((Math.atan2(-(toX - fromX), toY - fromY) * 180) / Math.PI);
}

export function runWizard(par: WizardParams): Project {
  const p = newProject(par.name || 'Proje');
  const auto = autoRoom(par.guests, par.indoor);
  const W = par.w || auto.w;
  const D = par.d || auto.d;
  const H = par.h || auto.h;
  const area = newArea(par.indoor ? 'Salon' : 'Açık alan', W, D, H);
  area.indoor = par.indoor;
  area.guests = par.guests;
  if (!par.indoor) {
    area.floor = 'acik';
    area.walls = 'acik';
    area.ceiling = 'acik';
    area.glassPct = 0;
  }
  p.areas = [area];
  p.meta.eventType = par.eventType;
  p.meta.guests = par.guests;
  p.name = par.name || p.name;
  const A = area.id;
  const put = (defId: string, x: number, y: number, extra?: Partial<Item>): Item => {
    const def = getDef(p, defId);
    const it = makeItem(p, def, A, round2(x), round2(y), extra);
    p.items.push(it);
    return it;
  };
  const cx = W / 2;
  const band = par.music === 'band' || par.music === 'djband';
  const dz = par.music === 'davulzurna';
  const zn = par.zoneNames;

  // — Bölgeler —
  const stageW = Math.min(band ? 10 : 7, W * 0.55);
  const stageD = band ? 4.5 : 3;
  const stage = zone(p, A, 'stage', zn.stage, cx - stageW / 2, 0.6, stageW, stageD, band ? 0.6 : 0.4);
  const danceW = Math.min(W * 0.55, Math.max(7, Math.sqrt(par.guests) * 0.7));
  const danceD = Math.max(5, Math.min(10, par.guests * 0.025));
  const dance = zone(p, A, 'dance', zn.dance, cx - danceW / 2, stage.y + stage.d + 0.8, danceW, danceD);
  const tablesY = dance.y + dance.d + 0.8;
  const walkW = 1.4;
  const walkX = W - walkW - 0.3;
  const sideTop = stage.y + stage.d + 0.8;
  const audKind: ZoneKind = par.tables ? 'tables' : 'audience';
  const audName = par.tables ? zn.tables : zn.audience;
  const audZones: Zone[] = [];
  // dans pistinin solu, sağı ve arkası
  if (dance.x - 1.6 > 2.5) audZones.push(zone(p, A, audKind, audName, 0.8, sideTop, dance.x - 1.6, Math.max(2, D - sideTop - 1.8)));
  if (walkX - (dance.x + dance.w + 0.8) > 2.5) audZones.push(zone(p, A, audKind, audName, dance.x + dance.w + 0.8, sideTop, walkX - 0.4 - (dance.x + dance.w + 0.8), Math.max(2, D - sideTop - 1.8)));
  if (D - tablesY - 1.8 > 2.5) audZones.push(zone(p, A, audKind, audName, dance.x - 0.8 < 2.5 ? 0.8 : dance.x - 0.8, tablesY, Math.min(dance.w + 1.6, walkX - 0.4 - (dance.x - 0.8 < 2.5 ? 0.8 : dance.x - 0.8)), D - tablesY - 1.8));
  zone(p, A, 'walkway', zn.walkway, walkX, stage.y + stage.d + 0.5, walkW, D - (stage.y + stage.d + 0.5) - 0.2);
  let foh: Zone | null = null;
  if (band) foh = zone(p, A, 'foh', zn.foh, cx - 1.5, Math.min(D - 3.5, tablesY + (D - tablesY) * 0.35), 3, 2);

  // — Mekan —
  put('door-double', cx, D - 0.06, { rot: 180 });
  put('exit', W - 0.06, D * 0.5, { rot: 90 });

  // — Hoparlör seçimi —
  const farY = D - 1.5;
  const mainY = stage.y + stage.d - 0.25;
  const mainX = Math.min(stageW / 2 + 0.6, W / 2 - 1);
  const distFar = Math.hypot(mainX, farY - mainY);
  const need = p.settings.targetSpl + 6 + 20 * Math.log10(distFar);
  const delays = (par.quality !== 'pro' || H < 5) && D > 18;
  const reach = delays ? Math.hypot(mainX, (farY - mainY) * 0.55) : distFar;
  const needMain = p.settings.targetSpl + 6 + 20 * Math.log10(reach);
  let topId = par.quality === 'compact' ? 'top-12a' : par.quality === 'pro' ? 'rcf-art935a' : 'top-15a';
  if (needMain > CATALOG[topId].acoustic!.maxSpl + 2 && par.quality !== 'compact') topId = 'rcf-art935a';
  const useArray = par.quality === 'pro' && H >= 5 && (par.guests > 350 || need > 136);
  let subId = par.guests <= 120 ? 'sub-15a' : par.guests <= 500 ? 'sub-18a' : 'sub-218a';
  if (par.quality === 'pro' && !useArray) subId = par.guests > 300 ? 'rcf-sub8004' : 'rcf-sub708';
  const subsPerSide = par.guests > 350 ? 2 : 1;
  const subDef = getDef(p, subId);

  const targetX = cx;
  const targetY = mainY + (delays ? (farY - mainY) * 0.45 : (farY - mainY) * 0.6);
  for (const side of [-1, 1]) {
    const x = cx + side * mainX;
    // sublar
    for (let k = 0; k < subsPerSide; k++) {
      put(subId, x + side * k * (subDef.w + 0.05), mainY + 0.35, { label: `SUB-${side < 0 ? 'L' : 'R'}${subsPerSide > 1 ? k + 1 : ''}`, role: 'sub' });
    }
    if (useArray) {
      const arr = put('la-generic', x, mainY, { label: `LA-${side < 0 ? 'L' : 'R'}`, mount: 'flown', z: 4.2, count: par.guests > 600 ? 8 : 6, rot: aimRot(x, mainY, targetX + side * 1, targetY) });
      arr.splays = [0, 1, 2, 3, 5, 7, 8, 10].slice(0, arr.count);
      arr.tilt = -1;
    } else {
      const subH = itemDims({ ...(p.items[p.items.length - 1]) }, subDef).h;
      const z = subsPerSide === 1 && !delays ? subH + 1.15 : 1.95;
      put(topId, x, mainY + (subsPerSide === 1 && !delays ? 0.35 : -0.3), {
        label: `PA-${side < 0 ? 'L' : 'R'}`,
        mount: subsPerSide === 1 && !delays ? 'pole' : 'stand',
        z,
        rot: aimRot(x, mainY, targetX + side * 1.5, targetY),
        tilt: -4,
        role: 'main',
      });
    }
  }
  if (delays) {
    const dy = mainY + (farY - mainY) * 0.55;
    for (const side of [-1, 1]) {
      const x = side < 0 ? 1.4 : W - walkW - 1.2;
      put(par.quality === 'compact' ? 'top-12a' : 'top-12a', x, dy, { label: `DL-${side < 0 ? 'L' : 'R'}`, mount: 'stand', z: 2.0, rot: aimRot(x, dy, cx, D - 1), tilt: -6, role: 'delay' });
    }
  }
  // sahne monitörleri / booth
  if (band) {
    const n = stageW > 8 ? 4 : 3;
    for (let k = 0; k < n; k++) put('mon-12a', stage.x + (stageW * (k + 0.5)) / n, stage.y + stage.d - 0.45, { label: `MON-${k + 1}`, rot: 180, tilt: 40, role: 'monitor' });
  }

  // — DJ —
  let djMain: Item | null = null;
  if (par.music === 'dj' || par.music === 'djband' || dz) {
    const bx = band ? stage.x + stageW - 1.4 : cx;
    const by = band ? stage.y + 1.0 : stage.y + 1.3;
    put('dj-booth', bx, by, { label: 'DJ-BOOTH' });
    djMain = put('denon-prime4', bx, by - 0.05, { mount: 'table', z: 1.05, label: 'DJ-1' });
    put('strip6', bx, by - 0.6, { label: 'GP-DJ' });
    put('laptop', bx + 0.75, by - 0.05, { mount: 'table', z: 1.05, label: 'DJ-LT' });
    put('dj-headphones-amp', bx - 0.85, by - 0.15, { mount: 'table', z: 1.05, rot: 180, role: 'monitor', label: 'MON-DJ' });
  }

  // — Müzisyenler —
  const mics: Item[] = [];
  if (band) {
    put('drumriser', stage.x + 1.8, stage.y + 1.3, { label: 'RISER-1' });
    put('drumkit', stage.x + 1.8, stage.y + 1.3, { label: 'DRUM' });
    for (const [def, ch] of [
      ['shure-beta52', 'Kick'],
      ['shure-sm57', 'Snare'],
      ['shure-sm81', 'OH L'],
      ['shure-sm81', 'OH R'],
    ] as const) {
      mics.push(put(def, stage.x + 1.2 + mics.length * 0.4, stage.y + 2.1, { channel: ch }));
    }
    put('org', cx + 0.5, stage.y + 1.5, { label: 'ORG', mount: 'stand', z: 0.8 });
    put('di-stereo', cx + 0.5, stage.y + 2.1);
    put('baglama', cx - 1.4, stage.y + 2.2, { label: 'SAZ' });
    put('di-active', cx - 1.4, stage.y + 2.7);
    mics.push(put('shure-beta58', cx - 0.4, stage.y + 3.1, { channel: 'Vokal 1', rot: 180 }));
    mics.push(put('shure-sm58', cx + 1.4, stage.y + 3.1, { channel: 'Vokal 2', rot: 180 }));
  }
  if (dz) {
    put('davul', cx - 2.2, stage.y + 1.8, { label: 'DAVUL' });
    put('zurna', cx - 1.2, stage.y + 1.8, { label: 'ZURNA' });
    mics.push(put('senn-md421', cx - 2.2, stage.y + 2.9, { channel: 'Davul', rot: 180 }));
    mics.push(put('shure-sm57', cx - 1.2, stage.y + 2.5, { channel: 'Zurna', rot: 180 }));
  }
  // kablosuz mikrofonlar
  const rxIds: string[] = [];
  let left = par.wirelessMics;
  const rxX = band && foh ? foh.x + 2.4 : (djMain?.x ?? cx) + 0.5;
  const rxY = band && foh ? foh.y + 1 : (djMain?.y ?? stage.y + 1) + 0.6;
  while (left > 0) {
    const two = left >= 2;
    const rx = put(two ? 'shure-slxd4d' : 'shure-slxd4', rxX, rxY + rxIds.length * 0.35, { mount: 'table', z: 0.75 });
    rxIds.push(rx.id);
    left -= two ? 2 : 1;
  }
  for (let k = 0; k < par.wirelessMics; k++) put('shure-slxd24-58', stage.x + 0.6 + k * 0.45, stage.y + stage.d - 0.4, { channel: k === 0 ? 'Sunucu' : `Kablosuz ${k + 1}`, stand: 'straight' });

  // — FOH —
  if (band && foh) {
    put(par.quality === 'pro' ? 'ah-sq6' : 'beh-x32c', foh.x + 1.2, foh.y + 0.9, { label: 'FOH', rot: 0 });
    put(par.quality === 'pro' ? 'ah-ar2412' : 'beh-s16', stage.x + stageW - 0.6, stage.y + 0.5, { label: 'SB-1', mount: 'floor', z: 0 });
  } else if (par.wirelessMics > 2 || dz) {
    put('mix-an12', (djMain?.x ?? cx) - 0.5, (djMain?.y ?? stage.y + 1) + 0.6, { label: 'MIX-1', mount: 'table', z: 0.75 });
  }

  // — Işık —
  if (par.lights !== 'none') {
    for (const side of [-1, 1]) {
      const x = cx + side * (stageW / 2 + 1.4);
      put('tbar', x, stage.y + stage.d - 0.4, { label: `TB-${side < 0 ? 'L' : 'R'}` });
      for (let k = 0; k < 4; k++) put('par-led', x - 0.45 + k * 0.3, stage.y + stage.d - 0.4, { mount: 'stand', z: 2.6, tilt: -20, label: `PAR-${side < 0 ? 'L' : 'R'}${k + 1}` });
    }
    // uplight'lar
    const nUp = Math.min(16, Math.round((W + D) / 4));
    for (let k = 0; k < nUp; k++) {
      const t = (k + 0.5) / nUp;
      const onLeft = k % 2 === 0;
      put('uplight-bat', onLeft ? 0.25 : W - 0.25, stage.y + stage.d + t * (D - stage.d - 2), { rot: onLeft ? -90 : 90, label: `UP-${k + 1}` });
    }
    if (par.lights === 'full') {
      put('truss-tower', stage.x - 0.3, stage.y + 0.3, { label: 'TWR-L' });
      put('truss-tower', stage.x + stageW + 0.3, stage.y + 0.3, { label: 'TWR-R' });
      for (let k = 0; k < Math.ceil(stageW / 3); k++) put('truss-3', stage.x + 1.5 + k * 3, stage.y + 0.3, { label: `TRS-${k + 1}`, mount: 'flown', z: 4 });
      for (let k = 0; k < 4; k++) put('mh-wash', stage.x + 1 + (k * (stageW - 2)) / 3, stage.y + 0.3, { mount: 'flown', z: 3.55, rot: 0, label: `MH-${k + 1}` });
      put('spark', dance.x + 0.6, dance.y + 0.4, { label: 'SPARK-1' });
      put('spark', dance.x + dance.w - 0.6, dance.y + 0.4, { label: 'SPARK-2' });
      put('lowfog', cx, stage.y + stage.d + 0.4, { label: 'FOG-1' });
      put('dmx-desk', band && foh ? foh.x + 2.3 : (djMain?.x ?? cx) - 1.2, band && foh ? foh.y + 0.9 : (djMain?.y ?? stage.y + 1) + 0.5, { mount: 'table', z: 0.75, label: 'LX-1' });
    }
  }

  // — Masalar / düğün —
  const wedding = par.eventType === 'dugun' || par.eventType === 'nisan' || par.eventType === 'kina';
  // gelin–damat masası dans pistinin solunda, pastası yanında
  const reserved: { x: number; y: number; r: number }[] = [];
  if (wedding) {
    const sx = Math.max(1.2, dance.x - 1.4);
    put('sofa', sx, dance.y + 1.2, { rot: -90, label: 'GELIN-DAMAT' });
    put('cake', sx, dance.y + 3.2, { label: 'PASTA' });
    reserved.push({ x: sx, y: dance.y + 1.2, r: 1.6 }, { x: sx, y: dance.y + 3.2, r: 1.3 });
  }
  if (par.tables) {
    const n = Math.ceil(par.guests / 10);
    const sp = 3.0;
    let k = 0;
    for (const z of audZones) {
      const cols = Math.max(1, Math.floor((z.w - 0.2) / sp));
      const rows = Math.max(1, Math.floor((z.d - 0.2) / sp));
      const ox = z.x + (z.w - cols * sp) / 2 + sp / 2;
      const oy = z.y + (z.d - rows * sp) / 2 + sp / 2;
      for (let r = 0; r < rows && k < n; r++)
        for (let c = 0; c < cols && k < n; c++) {
          const x = ox + c * sp;
          const y = oy + r * sp;
          if (reserved.some((q) => Math.hypot(q.x - x, q.y - y) < q.r + 1.4)) continue;
          put('table-round', x, y, { label: `T-${++k}` });
        }
    }
  }

  // — Elektrik —
  if (par.power === 'schuko') {
    put('wall-schuko', 0.06, stage.y + 0.8, { rot: -90, label: 'PRIZ-1' });
    put('wall-schuko', W - 0.06, stage.y + 0.8, { rot: 90, label: 'PRIZ-2' });
    put('strip6', 1.2, stage.y + 1.4, { label: 'GP-1' });
    put('strip6', W - 1.2, stage.y + 1.4, { label: 'GP-2' });
    put('strip6', cx, stage.y + 0.4, { label: 'GP-3' });
  } else if (par.power === 'generator') {
    put('generator', W + 6, 2, { label: 'GEN-1' });
    put('distro-32', stage.x - 0.8, stage.y + 0.4, { label: 'DIST-1' });
  } else {
    put(par.power === 'cee32' ? 'wall-cee32r' : 'wall-cee16r', 0.06, stage.y + 0.5, { rot: -90, label: 'CEE-1' });
    put(par.power === 'cee32' ? 'distro-32' : 'distro-16', stage.x - 0.6, stage.y + 0.5, { label: 'DIST-1' });
    put('strip6', stage.x + stageW + 0.6, stage.y + 0.5, { label: 'GP-1' });
    if (band && foh) put('strip6', foh.x + 0.3, foh.y + 1.6, { label: 'GP-FOH' });
  }
  put('extinguisher', 0.3, D - 0.4, { label: 'FE-1' });

  // — Kablolama —
  autoSignal(p);
  autoPower(p);
  // gecikmeler
  for (const it of p.items) {
    if (it.role === 'delay') {
      const s = suggestDelay(p, it);
      if (s != null) it.delayMs = Math.round(s * 10) / 10;
    }
  }
  p.settings.targetSpl = 100;
  // türetilmiş önbellekler bu nesneye bağlı; değişmiş olabileceği için temiz kopya döndür
  return JSON.parse(JSON.stringify(p)) as Project;
}
