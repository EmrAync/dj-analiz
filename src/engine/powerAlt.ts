// Elektrik girişi alternatifleri (A/B/C): duvardaki prize göre hazır zincirler.
// A: 32 A CEE → adaptör 32→16 → adaptör 16→Schuko → PRCD-S+ → sistem
// B: 16 A CEE → adaptör 16→Schuko → PRCD-S+ → sistem
// C: Schuko priz → PRCD-S+ → sistem
import { cableType } from '../catalog/connectors';
import type { TFn } from '../i18n';
import { CATALOG, getDef, makeItem, portsOf, uid } from '../model/project';
import type { Cable, Item, PortInst, Project, VariantGroup } from '../model/types';
import { isOff, LETTERS } from '../model/variants';
import { addCable } from './autowire';
import { suggestCableTypes } from './cables';

const GEAR = new Set(['prcd', 'adp-cee32-16', 'adp-cee16r-schuko']);

// Giriş parçası: duvar prizi, adaptör, PRCD
export function isEntryGear(p: Project, it: Item): boolean {
  const d = getDef(p, it.defId);
  return GEAR.has(d.id) || (!!d.source && d.mount === 'wall');
}

const isPow = (c: Cable) => cableType(c.type).domain === 'power';

function powerIn(p: Project, it: Item): PortInst | undefined {
  return portsOf(getDef(p, it.defId)).find((x) => x.group.domain === 'power' && x.group.dir === 'in');
}

// Tıklanan öğeden sistemin elektrik girişini bul (giriş parçalarını atlayarak)
export function findEntry(p: Project, itemId: string): Item | null {
  const byId = new Map(p.items.map((i) => [i.id, i]));
  let cur = byId.get(itemId);
  if (!cur) return null;
  if (isEntryGear(p, cur)) {
    // aşağı doğru: ilk sistem parçası
    for (let g = 0; g < 30 && cur && isEntryGear(p, cur); g++) {
      const id: string = cur.id;
      const c = p.cables.find((x) => !isOff(p, x) && isPow(x) && x.a.item === id);
      cur = c ? byId.get(c.b.item) : undefined;
    }
    return cur && !isEntryGear(p, cur) ? cur : null;
  }
  // yukarı doğru: kaynağa en yakın sistem parçası
  const path: Item[] = [cur];
  for (let g = 0; g < 30; g++) {
    const id: string = cur.id;
    const feed = p.cables.find((c) => !isOff(p, c) && isPow(c) && c.b.item === id);
    const up = feed ? byId.get(feed.a.item) : undefined;
    if (!up || path.includes(up)) break;
    path.unshift(up);
    cur = up;
  }
  return path.find((it) => !isEntryGear(p, it)) || null;
}

interface Spec {
  defs: string[];
  links: string[]; // defs[i] → defs[i+1]
  final?: string; // son parça → sistem (boşsa önerilen)
  name: string;
  when: string;
}

export function entrySpecs(p: Project, entry: Item, t: TFn): Spec[] | null {
  const pin = powerIn(p, entry);
  if (!pin) return null;
  const prcdOut = portsOf(CATALOG.prcd).find((x) => x.group.dir === 'out')!;
  const fromSchuko = suggestCableTypes(prcdOut, pin).some((x) => x.domain === 'power' && x.id !== 'generic');
  if (fromSchuko)
    return [
      { defs: ['wall-cee32r', 'adp-cee32-16', 'adp-cee16r-schuko', 'prcd'], links: ['plug', 'plug', 'plug'], name: t('var.n32'), when: t('var.w32') },
      { defs: ['wall-cee16r', 'adp-cee16r-schuko', 'prcd'], links: ['plug', 'plug'], name: t('var.n16'), when: t('var.w16') },
      { defs: ['wall-schuko', 'prcd'], links: ['plug'], name: t('var.nSchuko'), when: t('var.wSchuko') },
    ];
  if (pin.group.conn === 'cee16r')
    return [
      { defs: ['wall-cee32r', 'adp-cee32-16'], links: ['plug'], final: 'cee16r', name: t('var.n32'), when: t('var.w32') },
      { defs: ['wall-cee16r'], links: [], final: 'cee16r', name: t('var.n16'), when: t('var.w16') },
    ];
  return null;
}

export type AltResult = { ok: true; group: VariantGroup } | { ok: false; reason: 'noEntry' | 'hasGroup' | 'unsupported' };

// p: immer taslağı. Girişin mevcut beslemesi (priz, PRCD… zinciri) kaldırılır, yerine A/B/C planları gelir.
export function buildPowerAlternatives(p: Project, entryId: string, t: TFn): AltResult {
  const entry = p.items.find((i) => i.id === entryId);
  if (!entry) return { ok: false, reason: 'noEntry' };
  if (entry.variant || p.cables.some((c) => c.variant && c.b.item === entry.id && isPow(c))) return { ok: false, reason: 'hasGroup' };
  const specs = entrySpecs(p, entry, t);
  const pin = powerIn(p, entry);
  if (!specs || !pin) return { ok: false, reason: 'unsupported' };

  // eski besleme zincirini kaldır (başka bir şeyi beslemeyen giriş parçaları)
  const rmC = new Set<string>();
  const rmI = new Set<string>();
  let cur: Item = entry;
  for (let g = 0; g < 30; g++) {
    const id = cur.id;
    const feed = p.cables.find((c) => !isOff(p, c) && isPow(c) && c.b.item === id && !rmC.has(c.id));
    if (!feed) break;
    const up = p.items.find((i) => i.id === feed.a.item);
    if (!up || !isEntryGear(p, up)) break;
    rmC.add(feed.id);
    if (p.cables.some((c) => !isOff(p, c) && c.a.item === up.id && !rmC.has(c.id))) break;
    rmI.add(up.id);
    cur = up;
  }
  p.cables = p.cables.filter((c) => !rmC.has(c.id) && !rmI.has(c.a.item) && !rmI.has(c.b.item));
  p.items = p.items.filter((i) => !rmI.has(i.id));

  // en yakın duvar
  const area = p.areas.find((a) => a.id === entry.areaId) || p.areas[0];
  const walls = [
    { d: entry.x, w: { x: 0, y: entry.y }, u: { x: 1, y: 0 } },
    { d: area.w - entry.x, w: { x: area.w, y: entry.y }, u: { x: -1, y: 0 } },
    { d: entry.y, w: { x: entry.x, y: 0 }, u: { x: 0, y: 1 } },
    { d: area.d - entry.y, w: { x: entry.x, y: area.d }, u: { x: 0, y: -1 } },
  ].sort((a, b) => a.d - b.d);
  const { w, u } = walls[0];
  const perp = { x: -u.y, y: u.x };
  const rot = (((Math.atan2(-u.x, u.y) * 180) / Math.PI) + 360) % 360;
  const r2 = (v: number) => Math.round(v * 100) / 100;
  const clampX = (x: number) => Math.max(0.05, Math.min(area.w - 0.05, x));
  const clampY = (y: number) => Math.max(0.05, Math.min(area.d - 0.05, y));

  const group: VariantGroup = { id: uid('vg'), name: t('var.group', { l: entry.label }), kind: 'power', variants: [], active: '' };
  specs.forEach((sp, vi) => {
    const vid = uid('vr');
    group.variants.push({ id: vid, label: LETTERS[vi], name: sp.name, when: sp.when });
    const off = (vi - (specs.length - 1) / 2) * 0.45;
    const chain: Item[] = sp.defs.map((defId, k) => {
      const def = CATALOG[defId];
      const along = k === 0 ? 0.04 : 0.25 + 0.28 * k;
      const it = makeItem(p, def, area.id, r2(clampX(w.x + u.x * along + perp.x * off)), r2(clampY(w.y + u.y * along + perp.y * off)), { variant: vid, rot: Math.round(rot) });
      p.items.push(it);
      return it;
    });
    const outOf = (it: Item) => portsOf(getDef(p, it.defId)).find((x) => x.group.domain === 'power' && x.group.dir === 'out')!;
    for (let k = 0; k + 1 < chain.length; k++) addCable(p, chain[k], outOf(chain[k]), chain[k + 1], powerIn(p, chain[k + 1])!, sp.links[k], { variant: vid });
    const last = chain[chain.length - 1];
    addCable(p, last, outOf(last), entry, pin, sp.final, { variant: vid });
  });
  group.active = group.variants[0].id;
  (p.variants ||= []).push(group);
  return { ok: true, group };
}
