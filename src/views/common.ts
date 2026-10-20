import { CAT_BY_ID, DEPT_BY_ID } from '../catalog/categories';
import { DOMAINS } from '../catalog/connectors';
import type { CableInfo } from '../engine/cables';
import type { EquipDef, Item, Project } from '../model/types';
import type { Layers } from '../store/store';

export function catColor(def: EquipDef): string {
  return CAT_BY_ID[def.cat]?.color || '#64748b';
}

export function itemImage(p: Project, it: Item, def: EquipDef): string | undefined {
  const id = it.imageId || p.defImages[def.id] || def.imageId;
  return id ? p.assets[id]?.data : undefined;
}

export function itemVisible(it: Item, def: EquipDef, layers: Layers): boolean {
  if (it.hidden) return false;
  const dept = it.dept || def.dept;
  return layers.depts[dept] !== false;
}

export function cableVisible(inf: CableInfo, layers: Layers): boolean {
  if (inf.cable.hidden || !layers.cables) return false;
  return layers.domains[inf.type.domain] !== false;
}

export function cableColor(inf: CableInfo): string {
  return inf.cable.color || DOMAINS[inf.type.domain].color;
}

export function deptColor(def: EquipDef): string {
  return DEPT_BY_ID[def.dept]?.color || '#64748b';
}

export const ZONE_STYLE: Record<string, { fill: string; stroke: string }> = {
  stage: { fill: '#94a3b8', stroke: '#475569' },
  audience: { fill: '#60a5fa', stroke: '#2563eb' },
  dance: { fill: '#f472b6', stroke: '#db2777' },
  tables: { fill: '#fbbf24', stroke: '#d97706' },
  foh: { fill: '#34d399', stroke: '#059669' },
  walkway: { fill: '#4ade80', stroke: '#16a34a' },
  backstage: { fill: '#a78bfa', stroke: '#7c3aed' },
  bar: { fill: '#fb923c', stroke: '#ea580c' },
  nogo: { fill: '#f87171', stroke: '#dc2626' },
  custom: { fill: '#94a3b8', stroke: '#64748b' },
};

export const ZONE_KINDS = ['stage', 'audience', 'dance', 'tables', 'foh', 'walkway', 'backstage', 'bar', 'nogo', 'custom'] as const;

export function fmtM(v: number, lang: string, d = 2): string {
  const s = v.toFixed(d);
  return lang === 'en' ? s : s.replace('.', ',');
}
