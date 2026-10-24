// Kayıtlı salonlar: bir bölümü (salon ölçüleri, bölgeler, sabitler, elektrik girişi A/B/C) kütüphaneye kaydet, sonra tekrar kullan
import { getDef, nextLabel, uid } from '../model/project';
import type { Asset, Cable, EquipDef, Item, Project, VariantGroup, VenueTpl } from '../model/types';
import { publishLibrary } from './actions';
import { loadLibrary, saveLibrary } from './persist';
import { EMPTY_SEL, st } from './store';

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

// Salon şablonu: gear=false → sadece salon, bölgeler, mekan sabitleri, duvar prizleri ve elektrik girişi alternatifleri
export function venueFromArea(p: Project, areaId: string, name: string, gear: boolean): VenueTpl | null {
  const area = p.areas.find((a) => a.id === areaId);
  if (!area) return null;
  const inArea = p.items.filter((i) => i.areaId === areaId);
  const groups = (p.variants || []).filter((g) => g.variants.some((v) => inArea.some((i) => i.variant === v.id)));
  const vids = new Set(groups.flatMap((g) => g.variants.map((v) => v.id)));
  const entries = new Set(p.cables.filter((c) => c.variant && vids.has(c.variant)).map((c) => c.b.item));
  const keep = gear
    ? inArea
    : inArea.filter((i) => {
        const d = getDef(p, i.defId);
        return d.cat === 'mekan' || (!!d.source && d.mount === 'wall') || (i.variant && vids.has(i.variant)) || entries.has(i.id);
      });
  const ids = new Set(keep.map((i) => i.id));
  const cables = p.cables.filter((c) => ids.has(c.a.item) && ids.has(c.b.item) && (gear || (c.variant && vids.has(c.variant))));
  const assets: Record<string, Asset> = {};
  const addAsset = (id?: string) => {
    if (id && p.assets[id]) assets[id] = p.assets[id];
  };
  addAsset(area.bg?.assetId);
  for (const it of keep) {
    addAsset(it.imageId);
    addAsset(p.defImages[it.defId]);
  }
  const defs = p.defs.filter((d) => keep.some((i) => i.defId === d.id));
  return clone({
    id: uid('vn'),
    name,
    saved: Date.now(),
    gear,
    area,
    zones: p.zones.filter((z) => z.areaId === areaId),
    notes: p.notes.filter((n) => n.areaId === areaId),
    items: keep,
    cables,
    variants: groups,
    defs,
    assets,
  });
}

export async function saveVenue(areaId: string, name: string, gear: boolean): Promise<VenueTpl | null> {
  const v = venueFromArea(st().project, areaId, name, gear);
  if (!v) return null;
  const lib = await loadLibrary();
  // aynı adlı salonu güncelle
  const venues = (lib.venues || []).filter((x) => x.name.trim().toLowerCase() !== name.trim().toLowerCase());
  lib.venues = [v, ...venues];
  await saveLibrary(lib);
  publishLibrary(lib);
  return v;
}

export async function deleteVenue(id: string): Promise<void> {
  const lib = await loadLibrary();
  lib.venues = (lib.venues || []).filter((x) => x.id !== id);
  await saveLibrary(lib);
  publishLibrary(lib);
}

// Projeye yeni bölüm olarak ekle (proje boşsa boş bölümün yerine)
export function insertVenue(p: Project, v: VenueTpl): string {
  const t = clone(v);
  const areaId = uid('ar');
  const lone = p.areas.length === 1 && !p.items.some((i) => i.areaId === p.areas[0].id) && !p.zones.some((z) => z.areaId === p.areas[0].id);
  const last = p.areas[p.areas.length - 1];
  const area = { ...t.area, id: areaId, ox: lone ? 0 : (last?.ox || 0) + (last?.w || 0) + 4, oy: 0 };
  if (lone) p.areas = [];
  p.areas.push(area);
  for (const z of t.zones) p.zones.push({ ...z, id: uid('zn'), areaId });
  for (const n of t.notes) p.notes.push({ ...n, id: uid('nt'), areaId });
  // planlar
  const vmap = new Map<string, string>();
  const groups: VariantGroup[] = t.variants.map((g) => {
    const variants = g.variants.map((x) => {
      const id = uid('vr');
      vmap.set(x.id, id);
      return { ...x, id };
    });
    return { ...g, id: uid('vg'), variants, active: vmap.get(g.active) || variants[0]?.id || '' };
  });
  if (groups.length) (p.variants ||= []).push(...groups);
  const imap = new Map<string, string>();
  for (const src of t.items) {
    const it: Item = { ...src, id: uid('it'), areaId };
    if (it.variant) it.variant = vmap.get(it.variant);
    if (p.items.some((x) => x.label === it.label)) it.label = nextLabel(p, it.label.replace(/-\d+$/, ''));
    imap.set(src.id, it.id);
    p.items.push(it);
  }
  for (const src of t.cables) {
    const a = imap.get(src.a.item);
    const b = imap.get(src.b.item);
    if (!a || !b) continue;
    const c: Cable = { ...src, id: uid('cb'), a: { ...src.a, item: a }, b: { ...src.b, item: b } };
    if (c.variant) c.variant = vmap.get(c.variant);
    p.cables.push(c);
  }
  for (const d of t.defs) if (!p.defs.some((x) => x.id === d.id)) p.defs.push(d as EquipDef);
  for (const [k, a] of Object.entries(t.assets)) if (!p.assets[k]) p.assets[k] = a;
  if (!p.meta.venue) p.meta.venue = t.name;
  return areaId;
}

export function addVenue(v: VenueTpl): void {
  const s = st();
  let id = '';
  s.mutate((d) => {
    id = insertVenue(d as unknown as Project, v);
  });
  s.set({ areaId: id, sel: EMPTY_SEL });
}
