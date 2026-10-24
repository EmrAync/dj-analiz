// Paketleme: çantalar / kasalar, malzeme listesine göre ne eksik, öneri
import { cableType } from '../catalog/connectors';
import { L, type TFn } from '../i18n';
import { getDef, uid } from '../model/project';
import type { CaseDef, CaseLine, Lang, Project } from '../model/types';
import { buildBom } from './bom';

export interface PackNeed {
  key: string; // kind:ref
  kind: CaseLine['kind'];
  ref: string;
  name: string;
  group: string; // malzeme listesi grubu / kablo alanı
  need: number;
  packed: number;
  cases: string[]; // içinde olduğu çantalar
}

// Mekanın mobilyası: çantaya girmez
const FURNITURE = new Set(['table-rect', 'table-round', 'table-cocktail', 'chair', 'sofa', 'cake', 'bar', 'person']);

export const lineKey = (l: Pick<CaseLine, 'kind' | 'ref'>) => l.kind + ':' + l.ref;

// Satırın görünen adı
export function lineName(p: Project, l: CaseLine, lang: Lang): string {
  if (l.kind === 'def') {
    const d = getDef(p, l.ref);
    if (d.id !== '?') return [d.brand, d.model].filter(Boolean).join(' ') || L(d.name, lang);
  } else if (l.kind === 'cable') {
    const [type, len] = l.ref.split('@');
    const ct = cableType(type);
    return `${ct.short} · ${len} m`;
  }
  return l.name || l.ref;
}

// Malzeme listesinden paketlenecekler (sahne podesti ve sarf hariç); alternatif planların parçaları da
export function packingNeeds(p: Project, t: TFn, lang: Lang): PackNeed[] {
  const bom = buildBom(p, t, lang);
  const m = new Map<string, PackNeed>();
  const put = (kind: CaseLine['kind'], ref: string, name: string, group: string, n: number) => {
    const key = kind + ':' + ref;
    const x = m.get(key);
    if (x) x.need += n;
    else m.set(key, { key, kind, ref, name, group, need: n, packed: 0, cases: [] });
  };
  for (const r of bom.rows) {
    if (r.group === 'stage' || r.group === 'cons') continue;
    if (r.defId) {
      const d = getDef(p, r.defId);
      if (FURNITURE.has(d.id) || d.cat === 'hazirlik') continue;
      put('def', r.defId, [d.brand, d.model].filter(Boolean).join(' ') || r.name, r.group === 'alt' ? d.cat : r.group, r.qty);
    } else put('acc', r.key, r.name, r.group, r.qty);
  }
  for (const c of bom.cables) put('cable', c.type + '@' + c.len, `${c.short} · ${c.len} m`, 'cable:' + c.domain, c.qty + c.spare);
  for (const cs of p.cases || [])
    for (const l of cs.lines) {
      const x = m.get(lineKey(l));
      if (!x) continue;
      x.packed += l.qty;
      if (!x.cases.includes(cs.id)) x.cases.push(cs.id);
    }
  return [...m.values()];
}

export interface CaseProgress {
  total: number;
  out: number;
  back: number;
}

export function caseProgress(p: Project, cs: CaseDef): CaseProgress {
  let total = 0;
  let out = 0;
  let back = 0;
  for (const l of cs.lines) {
    total += l.qty;
    const s = p.packing?.[cs.id + ':' + l.id];
    out += Math.min(l.qty, s?.out || 0);
    back += Math.min(l.qty, s?.back || 0);
  }
  return { total, out, back };
}

const SUGGEST: { key: string; color: string; match: (n: PackNeed) => boolean }[] = [
  { key: 'pack.sugPower', color: '#dc2626', match: (n) => n.group === 'cable:power' || n.group === 'elektrik' },
  { key: 'pack.sugSignal', color: '#2563eb', match: (n) => n.group.startsWith('cable:') },
  { key: 'pack.sugMic', color: '#7c3aed', match: (n) => n.group === 'mikrofon' },
  { key: 'pack.sugDj', color: '#0891b2', match: (n) => n.group === 'dj' || n.group === 'mikser' || n.group === 'islem' },
  { key: 'pack.sugLight', color: '#d97706', match: (n) => n.group === 'isik' || n.group === 'video' },
  { key: 'pack.sugAcc', color: '#64748b', match: (n) => n.group === 'acc' || n.group === 'ag' || n.group === 'hazirlik' },
  { key: 'pack.sugBig', color: '#16a34a', match: () => true },
];

// Henüz bir çantada olmayanları türlerine göre çantalara dağıt (aynı adlı çanta varsa ona ekle)
export function suggestCases(p: Project, t: TFn, lang: Lang): CaseDef[] {
  const needs = packingNeeds(p, t, lang).filter((n) => n.need > n.packed);
  const cases: CaseDef[] = JSON.parse(JSON.stringify(p.cases || []));
  for (const n of needs) {
    const s = SUGGEST.find((x) => x.match(n))!;
    const name = t(s.key as 'pack.sugBig');
    let cs = cases.find((c) => c.name === name);
    if (!cs) {
      cs = { id: uid('cs'), name, desc: '', color: s.color, lines: [] };
      cases.push(cs);
    }
    const ex = cs.lines.find((l) => lineKey(l) === n.key);
    if (ex) ex.qty += n.need - n.packed;
    else cs.lines.push({ id: uid('ln'), kind: n.kind, ref: n.ref, qty: n.need - n.packed, name: n.name });
  }
  return cases;
}
