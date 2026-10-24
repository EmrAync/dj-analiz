import { current, type Draft } from 'immer';
import { addCable as addCableRaw, autoPower, autoSignal } from '../engine/autowire';
import { suggestDelay } from '../engine/acoustics';
import { applyPlan, moveDance } from '../engine/coverage';
import { portUse } from '../engine/cables';
import { CATALOG, findPort, getDef, makeItem, newArea, uid } from '../model/project';
import type { Area, Asset, Cable, EquipDef, Item, Measurement, Note, NoteKind, Project, Zone, ZoneKind } from '../model/types';
import { EMPTY_SEL, st, type Selection } from './store';
import { makeT } from '../i18n';
import { imageToAsset, loadLibrary, saveLibrary, type Library } from './persist';

// kütüphaneyi arayüze yayınla
export function publishLibrary(lib: Library): void {
  st().set({ library: { defs: lib.defs, venues: lib.venues || [], cases: lib.cases || [], lineups: lib.lineups || [] } });
}

const r2 = (v: number) => Math.round(v * 100) / 100;

function snapV(v: number): number {
  const s = st();
  return s.snap ? Math.round(v / s.gridStep) * s.gridStep : v;
}

export function snapPt(x: number, y: number): { x: number; y: number } {
  return { x: r2(snapV(x)), y: r2(snapV(y)) };
}

// —— Öğeler ——
export function addItem(defId: string, x: number, y: number, extra?: Partial<Item>): string {
  const s = st();
  let id = '';
  s.mutate((d) => {
    const p = d as unknown as Project;
    let def = getDef(p, defId);
    // kütüphanedeki özel malzemeyi projeye kopyala
    if (def.id === '?') {
      const lib = s.library.defs.find((x) => x.id === defId);
      if (lib) {
        d.defs.push(JSON.parse(JSON.stringify(lib)) as EquipDef);
        def = lib;
      }
    }
    const pt = snapPt(x, y);
    const it = makeItem(p, def, s.areaId, pt.x, pt.y, extra);
    if (s.editVariant && d.variants?.some((g) => g.variants.some((v) => v.id === s.editVariant))) it.variant = s.editVariant;
    d.items.push(it);
    id = it.id;
  });
  st().select({ items: [id] });
  return id;
}

export function updateItem(id: string, patch: Partial<Item>, history = true): void {
  st().mutate((d) => {
    const it = d.items.find((i) => i.id === id);
    if (it) Object.assign(it, patch);
  }, history);
}

export function updateItems(ids: string[], fn: (it: Draft<Item>) => void, history = true): void {
  const set = new Set(ids);
  st().mutate((d) => {
    for (const it of d.items) if (set.has(it.id)) fn(it);
  }, history);
}

export function moveSelection(dx: number, dy: number, history = false): void {
  const s = st();
  const ids = new Set(s.sel.items);
  const zs = new Set(s.sel.zones);
  const ns = new Set(s.sel.notes);
  s.mutate((d) => {
    for (const it of d.items) if (ids.has(it.id) && !it.locked) {
      it.x = r2(it.x + dx);
      it.y = r2(it.y + dy);
    }
    for (const z of d.zones) if (zs.has(z.id)) {
      z.x = r2(z.x + dx);
      z.y = r2(z.y + dy);
    }
    for (const n of d.notes) if (ns.has(n.id)) {
      n.x = r2(n.x + dx);
      n.y = r2(n.y + dy);
      if (n.x2 != null) n.x2 = r2(n.x2 + dx);
      if (n.y2 != null) n.y2 = r2(n.y2 + dy);
    }
    // seçili kabloların manuel noktaları
    for (const c of d.cables) if (ids.has(c.a.item) && ids.has(c.b.item)) for (const q of c.pts) {
      q.x = r2(q.x + dx);
      q.y = r2(q.y + dy);
    }
  }, history);
}

export function rotateSelection(deg: number): void {
  updateItems(st().sel.items, (it) => {
    if (!it.locked) it.rot = (((it.rot + deg) % 360) + 360) % 360;
  });
}

export function deleteSelection(): void {
  const s = st();
  const sel = s.sel;
  if (!sel.items.length && !sel.cables.length && !sel.zones.length && !sel.notes.length) return;
  const items = new Set(sel.items.filter((id) => !s.project.items.find((i) => i.id === id)?.locked));
  const cables = new Set(sel.cables);
  const zones = new Set(sel.zones);
  const notes = new Set(sel.notes);
  s.mutate((d) => {
    d.items = d.items.filter((i) => !items.has(i.id));
    d.cables = d.cables.filter((c) => !cables.has(c.id) && !items.has(c.a.item) && !items.has(c.b.item));
    d.zones = d.zones.filter((z) => !zones.has(z.id));
    d.notes = d.notes.filter((n) => !notes.has(n.id));
  });
  s.set({ sel: EMPTY_SEL });
}

export function duplicateSelection(dx = 0.5, dy = 0.5, mirror = false): void {
  const s = st();
  const area = s.project.areas.find((a) => a.id === s.areaId);
  const map = new Map<string, string>();
  const newSel: Selection = { items: [], cables: [], zones: [], notes: [] };
  s.mutate((d) => {
    const p = d as unknown as Project;
    for (const id of s.sel.items) {
      const src = d.items.find((i) => i.id === id);
      if (!src) continue;
      const c = JSON.parse(JSON.stringify(current(src))) as Item;
      c.id = uid('it');
      const def = getDef(p, c.defId);
      const ml = mirrorLabel(src.label, mirror);
      c.label = ml && !d.items.some((i) => i.label === ml) ? ml : nextFree(p, src.label);
      if (mirror && area) {
        c.x = r2(area.w - src.x);
        c.rot = (360 - src.rot) % 360;
      } else {
        c.x = r2(src.x + dx);
        c.y = r2(src.y + dy);
      }
      void def;
      if (mirror && c.splays) c.splays = [...c.splays];
      d.items.push(c);
      map.set(id, c.id);
      newSel.items.push(c.id);
    }
    // seçili öğeler arasındaki kabloları da kopyala
    for (const cb of [...d.cables]) {
      const a = map.get(cb.a.item);
      const b = map.get(cb.b.item);
      if (!a || !b) continue;
      const c = JSON.parse(JSON.stringify(current(cb))) as Cable;
      c.id = uid('cb');
      c.a.item = a;
      c.b.item = b;
      c.label = cb.label + "'";
      c.pts = mirror && area ? c.pts.map((q) => ({ x: r2(area.w - q.x), y: q.y })) : c.pts.map((q) => ({ x: r2(q.x + dx), y: r2(q.y + dy) }));
      d.cables.push(c);
      newSel.cables.push(c.id);
    }
    for (const id of s.sel.zones) {
      const z = d.zones.find((x) => x.id === id);
      if (!z) continue;
      const c = { ...JSON.parse(JSON.stringify(current(z))), id: uid('zn') } as Zone;
      if (mirror && area) c.x = r2(area.w - z.x - z.w);
      else {
        c.x = r2(z.x + dx);
        c.y = r2(z.y + dy);
      }
      d.zones.push(c);
      newSel.zones.push(c.id);
    }
  });
  s.set({ sel: newSel });
}

function mirrorLabel(l: string, mirror: boolean): string | null {
  if (!mirror) return null;
  if (/-L(\d*)$/.test(l)) return l.replace(/-L(\d*)$/, '-R$1');
  if (/-R(\d*)$/.test(l)) return l.replace(/-R(\d*)$/, '-L$1');
  return null;
}

function nextFree(p: Project, label: string): string {
  const m = /^(.*?)-?(\d+)$/.exec(label);
  const base = m ? m[1] : label;
  let n = m ? parseInt(m[2], 10) + 1 : 2;
  const used = new Set(p.items.map((i) => i.label));
  while (used.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

export function toggleLock(): void {
  const s = st();
  const ids = s.sel.items;
  const anyUnlocked = s.project.items.some((i) => ids.includes(i.id) && !i.locked);
  updateItems(ids, (it) => {
    it.locked = anyUnlocked;
  });
}

export function toggleHidden(ids: string[]): void {
  const s = st();
  const anyVisible = s.project.items.some((i) => ids.includes(i.id) && !i.hidden);
  updateItems(ids, (it) => {
    it.hidden = anyVisible;
  });
}

// —— Kablolar ——
export function connect(aItem: string, aPort: string, bItem: string, bPort: string, typeId?: string): string | null {
  const s = st();
  const p = s.project;
  const a = p.items.find((i) => i.id === aItem);
  const b = p.items.find((i) => i.id === bItem);
  if (!a || !b) return null;
  const pa = findPort(getDef(p, a.defId), aPort);
  const pb = findPort(getDef(p, b.defId), bPort);
  if (!pa || !pb) return null;
  // bir porta tek kablo (seçili olmayan alternatif planların kabloları sayılmaz)
  const pu = portUse(p);
  const busy = pu.has(aItem + '#' + aPort) || pu.has(bItem + '#' + bPort);
  if (busy) {
    s.notify(makeT(s.lang)('toast.portBusy'), 'warn');
    return null;
  }
  let id: string | null = null;
  // alternatif plan: çizilen plan, yoksa uçlardaki parçanın planı
  const ev = s.editVariant && p.variants?.some((g) => g.variants.some((v) => v.id === s.editVariant)) ? s.editVariant : null;
  const variant = ev || a.variant || b.variant;
  s.mutate((d) => {
    const c = addCableRaw(d as unknown as Project, a, pa, b, pb, typeId, variant ? { variant } : undefined);
    id = c.id;
  });
  if (id) s.select({ cables: [id] });
  return id;
}

export function updateCable(id: string, patch: Partial<Cable>, history = true): void {
  st().mutate((d) => {
    const c = d.cables.find((x) => x.id === id);
    if (c) Object.assign(c, patch);
  }, history);
}

export function autoWire(kind: 'power' | 'signal', onlySelected = false): number {
  const s = st();
  let n = 0;
  s.mutate((d) => {
    const p = d as unknown as Project;
    if (kind === 'power') n = autoPower(p, onlySelected && s.sel.items.length ? s.sel.items : undefined);
    else n = autoSignal(p, s.areaId);
  });
  return n;
}

export function removeCablesOf(ids: string[]): void {
  const set = new Set(ids);
  st().mutate((d) => {
    d.cables = d.cables.filter((c) => !set.has(c.a.item) && !set.has(c.b.item));
  });
}

// —— Bölgeler / notlar ——
export function addZone(kind: ZoneKind, name: string, x: number, y: number, w: number, dd: number): string {
  const s = st();
  const z: Zone = { id: uid('zn'), areaId: s.areaId, kind, name, x: r2(x), y: r2(y), w: r2(w), d: r2(dd), elev: kind === 'stage' ? 0.6 : 0 };
  s.mutate((d) => {
    d.zones.push(z);
  });
  s.select({ zones: [z.id] });
  return z.id;
}

export function updateZone(id: string, patch: Partial<Zone>, history = true): void {
  st().mutate((d) => {
    const z = d.zones.find((x) => x.id === id);
    if (z) Object.assign(z, patch);
  }, history);
}

export function addNote(kind: NoteKind, x: number, y: number, x2?: number, y2?: number, text = ''): string {
  const s = st();
  const n: Note = { id: uid('nt'), areaId: s.areaId, kind, x: r2(x), y: r2(y), x2: x2 != null ? r2(x2) : undefined, y2: y2 != null ? r2(y2) : undefined, text };
  s.mutate((d) => {
    d.notes.push(n);
  });
  s.select({ notes: [n.id] });
  return n.id;
}

export function updateNote(id: string, patch: Partial<Note>, history = true): void {
  st().mutate((d) => {
    const n = d.notes.find((x) => x.id === id);
    if (n) Object.assign(n, patch);
  }, history);
}

// —— Bölümler ——
export function addArea(name: string): void {
  const s = st();
  const a = newArea(name, 12, 10, 4);
  const last = s.project.areas[s.project.areas.length - 1];
  a.ox = (last?.ox || 0) + (last?.w || 0) + 4;
  a.oy = 0;
  a.guests = 50;
  s.mutate((d) => {
    d.areas.push(a);
  });
  s.set({ areaId: a.id, sel: EMPTY_SEL });
}

export function updateArea(id: string, patch: Partial<Area>): void {
  st().mutate((d) => {
    const a = d.areas.find((x) => x.id === id);
    if (a) Object.assign(a, patch);
  });
}

export function deleteArea(id: string): void {
  const s = st();
  if (s.project.areas.length <= 1) return;
  const items = new Set(s.project.items.filter((i) => i.areaId === id).map((i) => i.id));
  s.mutate((d) => {
    d.areas = d.areas.filter((a) => a.id !== id);
    d.items = d.items.filter((i) => i.areaId !== id);
    d.zones = d.zones.filter((z) => z.areaId !== id);
    d.notes = d.notes.filter((n) => n.areaId !== id);
    d.cables = d.cables.filter((c) => !items.has(c.a.item) && !items.has(c.b.item));
  });
  s.set({ areaId: st().project.areas[0].id, sel: EMPTY_SEL });
}

export function duplicateArea(id: string, suffix: string): void {
  const s = st();
  const src = s.project.areas.find((a) => a.id === id);
  if (!src) return;
  const na: Area = { ...JSON.parse(JSON.stringify(src)), id: uid('ar'), name: src.name + ' ' + suffix };
  const map = new Map<string, string>();
  s.mutate((d) => {
    d.areas.push(na);
    for (const it of s.project.items.filter((i) => i.areaId === id)) {
      const c = { ...JSON.parse(JSON.stringify(it)), id: uid('it'), areaId: na.id } as Item;
      map.set(it.id, c.id);
      d.items.push(c);
    }
    for (const z of s.project.zones.filter((x) => x.areaId === id)) d.zones.push({ ...JSON.parse(JSON.stringify(z)), id: uid('zn'), areaId: na.id });
    for (const n of s.project.notes.filter((x) => x.areaId === id)) d.notes.push({ ...JSON.parse(JSON.stringify(n)), id: uid('nt'), areaId: na.id });
    for (const c of s.project.cables) {
      const a = map.get(c.a.item);
      const b = map.get(c.b.item);
      if (a && b) d.cables.push({ ...JSON.parse(JSON.stringify(c)), id: uid('cb'), a: { ...c.a, item: a }, b: { ...c.b, item: b }, label: c.label + "'" });
    }
  });
  s.set({ areaId: na.id, sel: EMPTY_SEL });
}

// —— Resimler ——
export async function uploadImage(file: File): Promise<Asset> {
  const a = await imageToAsset(file);
  st().mutate((d) => {
    d.assets[a.id] = a;
  });
  return a;
}

export function setItemImage(ids: string[], assetId: string | undefined): void {
  updateItems(ids, (it) => {
    it.imageId = assetId;
  });
}

export function setDefImage(defId: string, assetId: string | undefined): void {
  st().mutate((d) => {
    if (assetId) d.defImages[defId] = assetId;
    else delete d.defImages[defId];
    const cd = d.defs.find((x) => x.id === defId);
    if (cd) cd.imageId = assetId;
  });
}

// —— Özel malzemeler ——
export function cloneDef(defId: string, nameSuffix: string): EquipDef {
  const s = st();
  const src = getDef(s.project, defId);
  const def = JSON.parse(JSON.stringify(src)) as EquipDef;
  def.id = uid('cd');
  def.custom = true;
  const base = typeof src.name === 'string' ? src.name : src.name.tr;
  def.name = { tr: base + ' ' + nameSuffix, de: typeof src.name === 'string' ? src.name : src.name.de || base, en: typeof src.name === 'string' ? src.name : src.name.en || base };
  return def;
}

export async function saveCustomDef(def: EquipDef, assetForLib?: Asset): Promise<void> {
  const s = st();
  s.mutate((d) => {
    const i = d.defs.findIndex((x) => x.id === def.id);
    if (i >= 0) d.defs[i] = def as Draft<EquipDef>;
    else d.defs.push(def as Draft<EquipDef>);
  });
  // kişisel kütüphaneye de ekle
  const lib = await loadLibrary();
  const i = lib.defs.findIndex((x) => x.id === def.id);
  if (i >= 0) lib.defs[i] = def;
  else lib.defs.push(def);
  if (assetForLib) lib.assets[assetForLib.id] = assetForLib;
  await saveLibrary(lib);
  publishLibrary(lib);
}

export async function removeLibraryDef(defId: string): Promise<void> {
  const lib = await loadLibrary();
  lib.defs = lib.defs.filter((d) => d.id !== defId);
  await saveLibrary(lib);
  publishLibrary(lib);
}

// item'ı başka bir modele çevir (bağlantıları port id'si aynı olanlar korunur)
export function changeModel(ids: string[], defId: string): void {
  const s = st();
  const def = getDef(s.project, defId);
  const portIds = new Set(def.ports.flatMap((g) => (g.count && g.count > 1 ? Array.from({ length: g.count }, (_, i) => g.key + (i + 1)) : [g.key])));
  const set = new Set(ids);
  s.mutate((d) => {
    for (const it of d.items) if (set.has(it.id)) {
      it.defId = defId;
      if (def.acoustic?.kind === 'array' && !it.count) {
        it.count = 6;
        it.splays = [0, 1, 2, 3, 5, 7];
      }
    }
    d.cables = d.cables.filter((c) => !(set.has(c.a.item) && !portIds.has(c.a.port)) && !(set.has(c.b.item) && !portIds.has(c.b.port)));
  });
}

export function applySuggestedDelay(id: string): void {
  const s = st();
  const it = s.project.items.find((i) => i.id === id);
  if (!it) return;
  const ms = suggestDelay(s.project, it);
  if (ms != null) updateItem(id, { delayMs: Math.round(ms * 10) / 10 });
}

export function toggleDone(stepId: string): void {
  st().mutate((d) => {
    if (d.done[stepId]) delete d.done[stepId];
    else d.done[stepId] = true;
  });
}

export function catalogDef(id: string): EquipDef | undefined {
  return CATALOG[id];
}

// —— Ses kapsama ——
export function applyCoverage(ids: string[], withLevels: boolean): number {
  const s = st();
  const q = JSON.parse(JSON.stringify(s.project)) as Project;
  const added = applyPlan(q, s.areaId, ids, withLevels);
  s.mutate((d) => {
    d.items = q.items;
    d.cables = q.cables;
    d.settings = q.settings;
  });
  if (added.length) s.set({ sel: { ...EMPTY_SEL, items: added } });
  return added.length;
}

export function moveDanceGap(gap: number, ref: number): void {
  const areaId = st().areaId;
  st().mutate((d) => moveDance(d as Project, areaId, gap, ref));
}

// —— Ölçümler ——
export function addMeasurement(m: Measurement): void {
  st().mutate((d) => {
    if (!d.measurements) d.measurements = [];
    d.measurements.push(m);
  });
}

export function updateMeasurement(id: string, patch: Partial<Measurement>): void {
  st().mutate((d) => {
    const m = d.measurements?.find((x) => x.id === id);
    if (m) Object.assign(m, patch);
  });
}

export function deleteMeasurement(id: string): void {
  st().mutate((d) => {
    if (d.measurements) d.measurements = d.measurements.filter((x) => x.id !== id);
  });
}
