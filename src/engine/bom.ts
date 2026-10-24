import { L, type TFn } from '../i18n';
import { getDef } from '../model/project';
import type { Lang, Project } from '../model/types';
import { analyzeCables } from './cables';
import { walkwayCrossings } from './checks';
import { ownWatt } from './power';
import { activeView } from '../model/variants';
import { cableType } from '../catalog/connectors';

export interface BomRow {
  key: string;
  group: string; // kategori id | 'acc' | 'stage' | 'cons'
  name: string;
  brand?: string;
  model?: string;
  qty: number;
  kg: number;
  watt: number;
  items: string[];
  note?: string;
  defId?: string;
}

export interface CableRow {
  key: string;
  type: string;
  name: string;
  short: string;
  domain: string;
  len: number;
  qty: number;
  spare: number;
  kg: number;
  labels: string[];
}

const EXCLUDE = new Set(['person', 'external', 'vokal']);

export function buildBom(full: Project, t: TFn, lang: Lang): { rows: BomRow[]; cables: CableRow[]; totalKg: number; totalW: number } {
  const p = activeView(full); // seçili elektrik planı vb.; diğer planlar aşağıda "alternatifler" olarak eklenir
  const rows = new Map<string, BomRow>();
  const add = (key: string, r: Omit<BomRow, 'key' | 'items' | 'qty' | 'kg' | 'watt'> & { kg?: number; watt?: number }, qty: number, itemId?: string) => {
    let row = rows.get(key);
    if (!row) {
      row = { ...r, key, items: [], qty: 0, kg: 0, watt: 0 };
      rows.set(key, row);
    }
    row.qty += qty;
    row.kg += (r.kg || 0) * qty;
    row.watt += (r.watt || 0) * qty;
    if (itemId) row.items.push(itemId);
  };
  let stands = 0;
  let sandbagStands = 0;
  const micStands: Record<string, number> = {};
  let transmitters = 0;
  for (const it of p.items) {
    const def = getDef(p, it.defId);
    if (def.cat === 'mekan' || EXCLUDE.has(def.id)) continue;
    if (def.source && def.mount === 'wall') continue; // mekanın prizi
    const n = def.acoustic?.kind === 'array' ? it.count || 1 : 1;
    add(
      'd:' + def.id,
      { group: def.cat, name: L(def.name, lang), brand: def.brand, model: def.model, defId: def.id, kg: (def.kg || 0) * n, watt: ownWatt(p, it) / 1 },
      1,
      it.id,
    );
    const area = p.areas.find((a) => a.id === it.areaId);
    if (def.acoustic && it.mount === 'stand' && def.acoustic.kind !== 'monitor') {
      stands++;
      if (area && !area.indoor) sandbagStands++;
    }
    if (it.mount === 'pole') add('acc:pole', { group: 'acc', name: t('bom.pole'), kg: 3 }, 1);
    if (it.mount === 'flown' && def.acoustic?.kind === 'array') add('acc:bumper', { group: 'acc', name: t('bom.bumper'), kg: 25 }, 1);
    else if (it.mount === 'flown' && def.acoustic) add('acc:yoke', { group: 'acc', name: t('bom.yoke'), kg: 2 }, 1);
    if (it.mount === 'wall' && def.acoustic) add('acc:wallmount', { group: 'acc', name: t('bom.wallmount'), kg: 2 }, 1);
    if (def.cat === 'mikrofon' && def.icon !== 'receiver') {
      const st = it.stand || 'none';
      if (st !== 'none') micStands[st] = (micStands[st] || 0) + 1;
      if (def.ports.some((x) => x.domain === 'wireless')) transmitters++;
    }
    if ((def.id === 'tbar' || def.id === 'windup') && area && !area.indoor) sandbagStands++;
  }
  if (stands) add('acc:stand', { group: 'acc', name: t('bom.speakerStand'), brand: 'K&M', model: '21436', kg: 4 }, stands);
  const msName: Record<string, string> = { boom: t('bom.micBoom'), straight: t('bom.micStraight'), short: t('bom.micShort'), table: t('bom.micTable'), clip: t('bom.micClip') };
  for (const k of Object.keys(micStands)) add('acc:mic:' + k, { group: 'acc', name: msName[k] || k, kg: k === 'clip' ? 0.1 : 3 }, micStands[k]);
  if (transmitters) add('cons:aa', { group: 'cons', name: t('bom.batteries'), note: t('bom.batteriesNote') }, transmitters * 4);
  if (sandbagStands) add('acc:sandbag', { group: 'acc', name: t('bom.sandbag'), kg: 15 }, sandbagStands * 2);

  // sahne podestleri (bölgelerden)
  for (const z of p.zones) {
    if (z.kind !== 'stage' || z.elev <= 0) continue;
    const nx = Math.ceil(z.w / 2 - 0.01);
    const ny = Math.ceil(z.d / 1 - 0.01);
    add('stage:deck', { group: 'stage', name: t('bom.deck'), kg: 30 }, nx * ny);
    add('stage:legs:' + z.elev.toFixed(2), { group: 'stage', name: t('bom.legs', { h: Math.round(z.elev * 100) }), kg: 1 }, nx * ny * 4);
    add('stage:skirt', { group: 'stage', name: t('bom.skirt'), kg: 1 }, Math.ceil(z.w + 2 * z.d));
    if (z.elev >= 0.4 && !p.items.some((i) => i.defId === 'stairs' && i.areaId === z.areaId)) add('stage:stairs', { group: 'stage', name: t('bom.stairs'), kg: 15 }, 1);
  }
  // kablo köprüleri
  for (const w of walkwayCrossings(p)) {
    const z = p.zones.find((x) => x.id === w.zoneId)!;
    const pieces = Math.ceil(Math.min(z.w, z.d)) * Math.ceil(w.cables.length / 5);
    add('acc:ramp', { group: 'acc', name: t('bom.ramp'), kg: 12, note: z.name }, pieces);
  }

  // kablolar
  const ci = analyzeCables(p);
  const crow = new Map<string, CableRow>();
  for (const c of p.cables) {
    const inf = ci.get(c.id)!;
    if (inf.type.wireless || inf.type.id === 'plug') continue;
    const key = c.type + '@' + inf.len;
    let r = crow.get(key);
    if (!r) {
      r = { key, type: c.type, name: L(inf.type.name, lang), short: inf.type.short, domain: inf.type.domain, len: inf.len, qty: 0, spare: 0, kg: 0, labels: [] };
      crow.set(key, r);
    }
    r.qty++;
    r.kg += (inf.type.kgPerM || 0.1) * inf.len;
    r.labels.push(c.label);
  }
  const cables = [...crow.values()].sort((a, b) => (a.domain === b.domain ? (a.type === b.type ? a.len - b.len : a.type.localeCompare(b.type)) : a.domain.localeCompare(b.domain)));
  for (const r of cables) if (['audio', 'dmx', 'network', 'digital', 'speaker'].includes(r.domain)) r.spare = Math.max(1, Math.round(r.qty * 0.1));
  // sarf
  const nCables = p.cables.length;
  if (nCables) {
    add('cons:gaffa', { group: 'cons', name: t('bom.gaffa'), kg: 0.4 }, 2 + Math.floor(nCables / 25));
    add('cons:velcro', { group: 'cons', name: t('bom.velcro') }, nCables + 10);
  }
  // alternatif planlar: seçili plana ek olarak yanına alınacaklar (planlar arası en büyük − seçili)
  const fci = analyzeCables(full);
  for (const g of full.variants || []) {
    const per = new Map<string, Map<string, number>>();
    const info = new Map<string, { name: string; kg: number; cat: string; defId?: string }>();
    const bump = (vid: string, k: string) => {
      let m = per.get(vid);
      if (!m) per.set(vid, (m = new Map()));
      m.set(k, (m.get(k) || 0) + 1);
    };
    for (const it of full.items) {
      if (!it.variant || !g.variants.some((v) => v.id === it.variant)) continue;
      const def = getDef(full, it.defId);
      if (def.source && def.mount === 'wall') continue;
      const k = 'd:' + def.id;
      info.set(k, { name: L(def.name, lang), kg: def.kg || 0, cat: def.cat, defId: def.id });
      bump(it.variant, k);
    }
    for (const c of full.cables) {
      if (!c.variant || !g.variants.some((v) => v.id === c.variant)) continue;
      const inf = fci.get(c.id);
      const ct = cableType(c.type);
      if (!inf || ct.wireless || ct.id === 'plug') continue;
      const k = 'c:' + c.type + '@' + inf.len;
      info.set(k, { name: `${L(ct.name, lang)} · ${fmtLen(inf.len)} m`, kg: (ct.kgPerM || 0.1) * inf.len, cat: 'cable' });
      bump(c.variant, k);
    }
    const act = per.get(g.active) || new Map<string, number>();
    for (const [k, inf] of info) {
      let mx = 0;
      const uses: string[] = [];
      for (const v of g.variants) {
        const n = per.get(v.id)?.get(k) || 0;
        if (n > mx) mx = n;
        if (n && v.id !== g.active) uses.push(v.label);
      }
      const extra = mx - (act.get(k) || 0);
      if (extra > 0) add('alt:' + g.id + ':' + k, { group: 'alt', name: inf.name, defId: inf.defId, kg: inf.kg, note: t('bom.altNote', { g: g.name, v: uses.join(', ') }) }, extra);
    }
  }
  const list = [...rows.values()];
  const totalKg = list.reduce((s, r) => s + r.kg, 0) + cables.reduce((s, r) => s + r.kg, 0);
  const totalW = list.reduce((s, r) => s + r.watt, 0);
  return { rows: list, cables, totalKg, totalW };
}

function fmtLen(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}
