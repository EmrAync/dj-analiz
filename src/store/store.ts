import { create } from 'zustand';
import { produce, freeze, type Draft } from 'immer';
import { useMemo } from 'react';
import { makeT } from '../i18n';
import type { Dept, Domain, Lang, Project } from '../model/types';
import { newProject } from '../model/project';
import type { Band } from '../engine/acoustics';
import type { EquipDef } from '../model/types';

export type View = 'plan' | '3d' | 'schema' | 'lists' | 'analysis' | 'setup';
export type Tool = 'select' | 'cable' | 'zone' | 'measure' | 'text' | 'pan';
export type LeftTab = 'library' | 'layers' | 'areas' | 'checks';

export interface Selection {
  items: string[];
  cables: string[];
  zones: string[];
  notes: string[];
}

export const EMPTY_SEL: Selection = { items: [], cables: [], zones: [], notes: [] };

export interface Layers {
  domains: Record<Domain, boolean>;
  depts: Record<Dept, boolean>;
  labels: boolean;
  cableTags: boolean;
  cables: boolean;
  coverage: boolean;
  heatmap: boolean;
  dims: boolean;
  grid: boolean;
  zones: boolean;
  bg: boolean;
  notes: boolean;
  room: boolean; // 3D duvarlar
}

export interface HeatOpts {
  band: Band;
  freq: number;
  coherent: boolean;
}

export type DialogKind = 'wizard' | 'projects' | 'project' | 'defEditor' | 'connect' | 'help' | 'export' | 'area';

export interface Dialog {
  kind: DialogKind;
  data?: Record<string, unknown>;
}

interface PrefState {
  lang: Lang;
  theme: 'light' | 'dark';
  layers: Layers;
  heat: HeatOpts;
  snap: boolean;
  gridStep: number;
  leftTab: LeftTab;
}

export interface State extends PrefState {
  project: Project;
  past: Project[];
  future: Project[];
  savedAt: number;
  view: View;
  areaId: string;
  sel: Selection;
  tool: Tool;
  placing: string | null;
  leftOpen: boolean;
  rightOpen: boolean;
  dialog: Dialog | null;
  toast: { msg: string; kind: 'ok' | 'warn' | 'err'; at: number } | null;
  schemaMode: 'signal' | 'power';
  cableDraft: { item: string; port?: string } | null;
  library: { defs: EquipDef[] };
  focus: { x: number; y: number; at: number } | null; // planı bir noktaya odakla
  installer: boolean; // kurulumcu (salt-okunur) modu

  mutate: (fn: (d: Draft<Project>) => void, history?: boolean) => void;
  checkpoint: () => void;
  undo: () => void;
  redo: () => void;
  setProject: (p: Project) => void;
  set: (patch: Partial<State>) => void;
  select: (s: Partial<Selection>, add?: boolean) => void;
  clearSel: () => void;
  notify: (msg: string, kind?: 'ok' | 'warn' | 'err') => void;
}

const ALL_DOMAINS: Domain[] = ['audio', 'speaker', 'digital', 'network', 'dmx', 'video', 'power', 'wireless', 'data'];
const ALL_DEPTS: Dept[] = ['ses', 'dj', 'enstruman', 'isik', 'video', 'elektrik', 'ag', 'sahne', 'hazirlik'];

function defaultPrefs(): PrefState {
  return {
    lang: 'tr',
    theme: 'light',
    layers: {
      domains: Object.fromEntries(ALL_DOMAINS.map((d) => [d, true])) as Record<Domain, boolean>,
      depts: Object.fromEntries(ALL_DEPTS.map((d) => [d, true])) as Record<Dept, boolean>,
      labels: true,
      cableTags: true,
      cables: true,
      coverage: false,
      heatmap: false,
      dims: true,
      grid: true,
      zones: true,
      bg: true,
      notes: true,
      room: true,
    },
    heat: { band: 'mid', freq: 63, coherent: true },
    snap: true,
    gridStep: 0.1,
    leftTab: 'library',
  };
}

function loadPrefs(): PrefState {
  const d = defaultPrefs();
  try {
    const raw = localStorage.getItem('sahnecad.prefs');
    if (!raw) return d;
    const o = JSON.parse(raw) as Partial<PrefState>;
    return {
      ...d,
      ...o,
      layers: { ...d.layers, ...(o.layers || {}), domains: { ...d.layers.domains, ...(o.layers?.domains || {}) }, depts: { ...d.layers.depts, ...(o.layers?.depts || {}) } },
      heat: { ...d.heat, ...(o.heat || {}) },
    };
  } catch {
    return d;
  }
}

export function savePrefs(s: PrefState): void {
  try {
    const { lang, theme, layers, heat, snap, gridStep, leftTab } = s;
    localStorage.setItem('sahnecad.prefs', JSON.stringify({ lang, theme, layers, heat, snap, gridStep, leftTab }));
  } catch {
    /* yok */
  }
}

const HISTORY = 150;
const initial = newProject();

export const useStore = create<State>()((set, get) => ({
  ...loadPrefs(),
  project: freeze(initial, true),
  past: [],
  future: [],
  savedAt: 0,
  view: 'plan',
  areaId: initial.areas[0].id,
  sel: EMPTY_SEL,
  tool: 'select',
  placing: null,
  leftOpen: true,
  rightOpen: true,
  dialog: null,
  toast: null,
  schemaMode: 'signal',
  cableDraft: null,
  library: { defs: [] },
  focus: null,
  installer: false,

  mutate: (fn, history = true) =>
    set((s) => {
      const next = produce(s.project, (d) => {
        fn(d);
      });
      if (next === s.project) return {};
      const stamped = produce(next, (d) => {
        d.modified = Date.now();
      });
      return history ? { project: stamped, past: [...s.past.slice(-HISTORY), s.project], future: [] } : { project: stamped };
    }),
  checkpoint: () => set((s) => ({ past: [...s.past.slice(-HISTORY), s.project], future: [] })),
  undo: () =>
    set((s) => {
      if (!s.past.length) return {};
      const prev = s.past[s.past.length - 1];
      return { project: prev, past: s.past.slice(0, -1), future: [s.project, ...s.future].slice(0, HISTORY), sel: pruneSel(prev, s.sel), areaId: prev.areas.some((a) => a.id === s.areaId) ? s.areaId : prev.areas[0].id };
    }),
  redo: () =>
    set((s) => {
      if (!s.future.length) return {};
      const nx = s.future[0];
      return { project: nx, future: s.future.slice(1), past: [...s.past, s.project], sel: pruneSel(nx, s.sel), areaId: nx.areas.some((a) => a.id === s.areaId) ? s.areaId : nx.areas[0].id };
    }),
  setProject: (p) => set({ project: freeze(p, true), past: [], future: [], sel: EMPTY_SEL, areaId: p.areas[0]?.id || '', placing: null, cableDraft: null }),
  set: (patch) => set(patch),
  select: (s, add) =>
    set((st) => {
      if (!add) return { sel: { ...EMPTY_SEL, ...s } };
      const tog = (a: string[], b: string[] = []) => {
        const r = new Set(a);
        for (const x of b) {
          if (r.has(x)) r.delete(x);
          else r.add(x);
        }
        return [...r];
      };
      return { sel: { items: tog(st.sel.items, s.items), cables: tog(st.sel.cables, s.cables), zones: tog(st.sel.zones, s.zones), notes: tog(st.sel.notes, s.notes) } };
    }),
  clearSel: () => {
    const s = get().sel;
    if (s.items.length || s.cables.length || s.zones.length || s.notes.length) set({ sel: EMPTY_SEL });
  },
  notify: (msg, kind = 'ok') => set({ toast: { msg, kind, at: Date.now() } }),
}));

function pruneSel(p: Project, s: Selection): Selection {
  const it = new Set(p.items.map((i) => i.id));
  const cb = new Set(p.cables.map((c) => c.id));
  const zn = new Set(p.zones.map((z) => z.id));
  const nt = new Set(p.notes.map((n) => n.id));
  return { items: s.items.filter((x) => it.has(x)), cables: s.cables.filter((x) => cb.has(x)), zones: s.zones.filter((x) => zn.has(x)), notes: s.notes.filter((x) => nt.has(x)) };
}

// tercihleri sakla
useStore.subscribe((s, prev) => {
  if (s.lang !== prev.lang || s.theme !== prev.theme || s.layers !== prev.layers || s.heat !== prev.heat || s.snap !== prev.snap || s.gridStep !== prev.gridStep || s.leftTab !== prev.leftTab) savePrefs(s);
});

export function useT() {
  const lang = useStore((s) => s.lang);
  return useMemo(() => makeT(lang), [lang]);
}

export const st = () => useStore.getState();
