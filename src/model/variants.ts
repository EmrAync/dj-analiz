// Alternatif planlar: bir malzeme/kablo bir plana (Variant) aitse sadece o plan seçiliyken hesaba girer.
// Hesaplar activeView(p) üzerinde yapılır; çizim ve malzeme listesi tüm planları görebilir.
import { derive } from '../engine/derive';
import { getDef } from './project';
import type { Cable, Item, Project, Variant, VariantGroup } from './types';

export const LETTERS = 'ABCDEFGH';

export interface VariantRef {
  g: VariantGroup;
  v: Variant;
  i: number;
}

export function variantMap(p: Project): Map<string, VariantRef> {
  return derive(p, 'vmap', () => {
    const m = new Map<string, VariantRef>();
    for (const g of p.variants || []) g.variants.forEach((v, i) => m.set(v.id, { g, v, i }));
    return m;
  });
}

// Plan seçili değilse kapalı (grubu silinmiş plan: açık sayılır). Taslak (immer) üzerinde de çalışır.
export function isOff(p: Project, x: { variant?: string }): boolean {
  if (!x.variant || !p.variants?.length) return false;
  for (const g of p.variants) if (g.variants.some((v) => v.id === x.variant)) return g.active !== x.variant;
  return false;
}

const bases = new WeakMap<Project, Project>();

// Seçili olmayan planların malzeme ve kablolarını çıkarılmış proje (yoksa aynı nesne).
// Hesaplar (elektrik, kontroller, listeler, kurulum) bunun üzerinde yapılır.
export function activeView(p: Project): Project {
  if (!p.variants?.length || bases.has(p)) return p;
  return derive(p, 'active', () => {
    const items = p.items.filter((i) => !isOff(p, i));
    const cables = p.cables.filter((c) => !isOff(p, c));
    if (items.length === p.items.length && cables.length === p.cables.length) return p;
    const v = { ...p, items, cables };
    bases.set(v, p);
    return v;
  });
}

// activeView'in türetildiği tam proje (görünüm değilse kendisi)
export function baseOf(p: Project): Project {
  return bases.get(p) || p;
}

export function members(p: Project, vid: string): { items: Item[]; cables: Cable[] } {
  return { items: p.items.filter((i) => i.variant === vid), cables: p.cables.filter((c) => c.variant === vid) };
}

export type ChainNode = { kind: 'item'; it: Item; inPlan: boolean } | { kind: 'cable'; c: Cable };

// Planın zinciri: kaynaktan (duvar prizi) sisteme giden sıra
export function variantChain(p: Project, vid: string): ChainNode[] {
  const { items, cables } = members(p, vid);
  if (!items.length && !cables.length) return [];
  const ids = new Set(items.map((i) => i.id));
  const incoming = new Set(cables.map((c) => c.b.item));
  let cur: Item | undefined = items.find((i) => getDef(p, i.defId).source) || items.find((i) => !incoming.has(i.id)) || items[0];
  const out: ChainNode[] = [];
  const seen = new Set<string>();
  for (let guard = 0; cur && guard < 24; guard++) {
    if (seen.has(cur.id)) break;
    seen.add(cur.id);
    out.push({ kind: 'item', it: cur, inPlan: ids.has(cur.id) });
    if (!ids.has(cur.id)) break; // sistem girişine ulaşıldı
    const id: string = cur.id;
    const c: Cable | undefined = cables.find((x) => x.a.item === id);
    if (!c) break;
    out.push({ kind: 'cable', c });
    cur = p.items.find((i) => i.id === c.b.item);
  }
  return out;
}

// Her plan için malzeme sayısı (defId → adet): alternatifler için yanına alınacaklar = planlar arası en büyük
export function variantDefCounts(p: Project, vid: string): Map<string, number> {
  const m = new Map<string, number>();
  for (const it of p.items) if (it.variant === vid) m.set(it.defId, (m.get(it.defId) || 0) + 1);
  return m;
}
