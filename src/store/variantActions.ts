// Alternatif planlar (A/B/C): seç, çiz, kopyala, sırala, sil
import { current } from 'immer';
import { buildPowerAlternatives, findEntry } from '../engine/powerAlt';
import { makeT } from '../i18n';
import { uid } from '../model/project';
import type { Cable, Item, Project, Variant, VariantGroup } from '../model/types';
import { LETTERS } from '../model/variants';
import { st } from './store';

const groupOf = (p: Project, vid: string): VariantGroup | undefined => p.variants?.find((g) => g.variants.some((v) => v.id === vid));

function relabel(g: VariantGroup): void {
  g.variants.forEach((v, i) => {
    v.label = LETTERS[i] || String(i + 1);
  });
}

// Tıklanan öğe ya da kablodan elektrik girişine A/B/C planlarını kur
export function makePowerAlternatives(from: { item?: string; cable?: string }): boolean {
  const s = st();
  const t = makeT(s.lang);
  const p = s.project;
  let start = from.item;
  if (from.cable) start = p.cables.find((c) => c.id === from.cable)?.b.item;
  const entry = start ? findEntry(p, start) : null;
  if (!entry) {
    s.notify(t('var.noEntry'), 'warn');
    return false;
  }
  let res: ReturnType<typeof buildPowerAlternatives> | null = null;
  s.mutate((d) => {
    res = buildPowerAlternatives(d as unknown as Project, entry.id, t);
  });
  const r = res as ReturnType<typeof buildPowerAlternatives> | null;
  if (!r || !r.ok) {
    s.notify(t(r && r.reason === 'hasGroup' ? 'var.hasGroup' : 'var.unsupported'), 'warn');
    return false;
  }
  s.notify(t('var.created', { n: r.group.variants.length }));
  return true;
}

export function useVariant(vid: string): void {
  const s = st();
  s.mutate((d) => {
    const g = groupOf(d as unknown as Project, vid);
    if (g) g.active = vid;
  });
  if (s.editVariant && s.editVariant !== vid) s.set({ editVariant: null });
}

export function editVariant(vid: string | null): void {
  if (vid) useVariant(vid);
  st().set({ editVariant: vid });
}

export function updateVariant(vid: string, patch: Partial<Pick<Variant, 'name' | 'when'>>): void {
  st().mutate((d) => {
    const v = groupOf(d as unknown as Project, vid)?.variants.find((x) => x.id === vid);
    if (v) Object.assign(v, patch);
  });
}

export function renameGroup(gid: string, name: string): void {
  st().mutate((d) => {
    const g = d.variants?.find((x) => x.id === gid);
    if (g) g.name = name;
  });
}

export function moveVariant(vid: string, dir: -1 | 1): void {
  st().mutate((d) => {
    const g = groupOf(d as unknown as Project, vid);
    if (!g) return;
    const i = g.variants.findIndex((v) => v.id === vid);
    const j = i + dir;
    if (j < 0 || j >= g.variants.length) return;
    [g.variants[i], g.variants[j]] = [g.variants[j], g.variants[i]];
    relabel(g);
  });
}

// Yeni plan: seçili planın kopyası (parçalar ve kablolar yeni kimlikle); sonra çizim moduna geçer
export function copyVariant(vid: string): string | null {
  const s = st();
  let nid: string | null = null;
  s.mutate((d) => {
    const p = d as unknown as Project;
    const g = groupOf(p, vid);
    if (!g || g.variants.length >= LETTERS.length) return;
    const src = g.variants.find((v) => v.id === vid)!;
    nid = uid('vr');
    const map = new Map<string, string>();
    const items = p.items.filter((i) => i.variant === vid).map((i) => JSON.parse(JSON.stringify(current(i))) as Item);
    for (const it of items) {
      const id = uid('it');
      map.set(it.id, id);
      it.id = id;
      it.variant = nid;
      p.items.push(it);
    }
    const cables = p.cables.filter((c) => c.variant === vid).map((c) => JSON.parse(JSON.stringify(current(c))) as Cable);
    for (const c of cables) {
      c.id = uid('cb');
      c.variant = nid;
      c.a.item = map.get(c.a.item) || c.a.item;
      c.b.item = map.get(c.b.item) || c.b.item;
      p.cables.push(c);
    }
    g.variants.push({ id: nid, label: '', name: src.name + ' (2)', when: '' });
    relabel(g);
    g.active = nid;
  });
  if (nid) s.set({ editVariant: nid });
  return nid;
}

// Planı ve parçalarını sil; tek plan kalırsa grup çözülür (kalan parçalar normal olur)
export function deleteVariant(vid: string): void {
  const s = st();
  s.mutate((d) => {
    const p = d as unknown as Project;
    const g = groupOf(p, vid);
    if (!g) return;
    const rm = new Set(p.items.filter((i) => i.variant === vid).map((i) => i.id));
    p.items = p.items.filter((i) => !rm.has(i.id));
    p.cables = p.cables.filter((c) => c.variant !== vid && !rm.has(c.a.item) && !rm.has(c.b.item));
    g.variants = g.variants.filter((v) => v.id !== vid);
    relabel(g);
    if (g.active === vid) g.active = g.variants[0]?.id || '';
    if (g.variants.length <= 1) dissolve(p, g.id);
  });
  if (s.editVariant === vid) s.set({ editVariant: null });
}

// Grubu kaldır: seçili planın parçaları kalır, diğerleri silinir
export function dissolveGroup(gid: string): void {
  st().mutate((d) => dissolve(d as unknown as Project, gid));
  st().set({ editVariant: null });
}

function dissolve(p: Project, gid: string): void {
  const g = p.variants?.find((x) => x.id === gid);
  if (!g) return;
  const others = new Set(g.variants.filter((v) => v.id !== g.active).map((v) => v.id));
  const rm = new Set(p.items.filter((i) => i.variant && others.has(i.variant)).map((i) => i.id));
  p.items = p.items.filter((i) => !rm.has(i.id));
  p.cables = p.cables.filter((c) => !(c.variant && others.has(c.variant)) && !rm.has(c.a.item) && !rm.has(c.b.item));
  for (const it of p.items) if (it.variant === g.active) delete it.variant;
  for (const c of p.cables) if (c.variant === g.active) delete c.variant;
  p.variants = p.variants!.filter((x) => x.id !== gid);
}
