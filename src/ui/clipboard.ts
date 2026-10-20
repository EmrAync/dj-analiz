import { uid } from '../model/project';
import type { Cable, Item } from '../model/types';
import { st } from '../store/store';

// Uygulama içi pano: seçili öğeleri (ve aralarındaki kabloları) başka bölüme/yere yapıştırmak için
let clip: { items: Item[]; cables: Cable[] } | null = null;

export function copySelection(): void {
  const s = st();
  const ids = new Set(s.sel.items);
  if (!ids.size) return;
  clip = {
    items: s.project.items.filter((i) => ids.has(i.id)).map((i) => JSON.parse(JSON.stringify(i))),
    cables: s.project.cables.filter((c) => ids.has(c.a.item) && ids.has(c.b.item)).map((c) => JSON.parse(JSON.stringify(c))),
  };
}

export function pasteClipboard(): void {
  if (!clip) return;
  const s = st();
  const map = new Map<string, string>();
  const used = new Set(s.project.items.map((i) => i.label));
  const newIds: string[] = [];
  s.mutate((d) => {
    for (const it of clip!.items) {
      const c: Item = { ...JSON.parse(JSON.stringify(it)), id: uid('it'), areaId: s.areaId };
      if (it.areaId === s.areaId) {
        c.x = Math.round((c.x + 0.6) * 100) / 100;
        c.y = Math.round((c.y + 0.6) * 100) / 100;
      }
      let lab = c.label;
      let n = 2;
      while (used.has(lab)) lab = `${c.label}-${n++}`;
      used.add(lab);
      c.label = lab;
      map.set(it.id, c.id);
      d.items.push(c);
      newIds.push(c.id);
    }
    for (const cb of clip!.cables) {
      const a = map.get(cb.a.item);
      const b = map.get(cb.b.item);
      if (!a || !b) continue;
      d.cables.push({ ...JSON.parse(JSON.stringify(cb)), id: uid('cb'), a: { ...cb.a, item: a }, b: { ...cb.b, item: b }, label: cb.label + "'", pts: [] });
    }
  });
  s.select({ items: newIds });
}
