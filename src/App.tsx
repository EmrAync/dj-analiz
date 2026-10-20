import { lazy, Suspense, useEffect } from 'react';
import { runWizard, WIZ_DEFAULT } from './engine/wizard';
import { makeT } from './i18n';
import { deleteSelection, duplicateSelection, moveSelection, rotateSelection, toggleLock } from './store/actions';
import { lastProjectId, loadLibrary, loadProject, normalizeProject, saveProject } from './store/persist';
import { st, useStore, useT, type View } from './store/store';
import { Dialogs } from './ui/dialogs/Dialogs';
import { Inspector } from './ui/Inspector';
import { Icon } from './ui/kit';
import { LeftPanel } from './ui/LeftPanel';
import { StatusBar } from './ui/StatusBar';
import { TopBar } from './ui/TopBar';
import { zoneNames } from './ui/dialogs/Wizard';
import { PlanView } from './views/plan/PlanView';
import { SchemaView } from './views/schema/SchemaView';
import { ListsView } from './views/lists/ListsView';
import { AnalysisView } from './views/analysis/AnalysisView';
import { SetupView } from './views/setup/SetupView';
import { MeasureView } from './views/measure/MeasureView';
import { copySelection, pasteClipboard } from './ui/clipboard';

const ThreeView = lazy(() => import('./views/three/ThreeView'));

export function App() {
  const view = useStore((s) => s.view);
  const theme = useStore((s) => s.theme);
  const lang = useStore((s) => s.lang);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  useBoot();
  useAutosave();
  useShortcuts();
  useHashView();
  return (
    <div className="app">
      <TopBar />
      <LeftPanel />
      <main className="main">
        {view === 'plan' ? <PlanView /> : null}
        {view === '3d' ? (
          <Suspense fallback={<Loading />}>
            <ThreeView />
          </Suspense>
        ) : null}
        {view === 'schema' ? <SchemaView /> : null}
        {view === 'lists' ? <ListsView /> : null}
        {view === 'analysis' ? <AnalysisView /> : null}
        {view === 'measure' ? <MeasureView /> : null}
        {view === 'setup' ? <SetupView /> : null}
      </main>
      <Inspector />
      <StatusBar />
      <Dialogs />
      <Toast />
    </div>
  );
}

function Loading() {
  const t = useT();
  return (
    <div className="empty" style={{ height: '100%' }}>
      <Icon name="cube" size={36} color="var(--faint)" />
      {t('three.loading')}
    </div>
  );
}

function Toast() {
  const toast = useStore((s) => s.toast);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => st().set({ toast: null }), 3200);
    return () => clearTimeout(id);
  }, [toast]);
  if (!toast) return null;
  return (
    <div className={'toast ' + toast.kind} role="status">
      <Icon name={toast.kind === 'ok' ? 'ok' : toast.kind === 'warn' ? 'warning' : 'error'} size={16} />
      {toast.msg}
    </div>
  );
}

export function demoProject(lang: 'tr' | 'de' | 'en') {
  const t = makeT(lang);
  const p = runWizard({ ...WIZ_DEFAULT, name: t('demo.name'), guests: 250, music: 'dj', lights: 'basic', power: 'cee16', quality: 'standard', tables: true, wirelessMics: 2, zoneNames: zoneNames(t) });
  p.meta.venue = t('demo.venue');
  p.meta.notes = t('demo.notes');
  return p;
}

function useBoot() {
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const lib = await loadLibrary();
      if (!cancelled) st().set({ library: { defs: lib.defs } });
      // URL ile gelen proje (#p=...)? Yok — son projeyi aç
      const id = lastProjectId();
      const saved = id ? await loadProject(id) : undefined;
      const norm = saved ? normalizeProject(saved) : null;
      if (cancelled) return;
      if (norm) {
        st().setProject(norm);
        st().set({ savedAt: norm.modified });
      } else {
        const p = demoProject(st().lang);
        st().setProject(p);
        await saveProject(p);
        st().set({ dialog: { kind: 'help', data: { welcome: true } } });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
}

function useAutosave() {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsub = useStore.subscribe((s, prev) => {
      if (s.project === prev.project) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(async () => {
        await saveProject(st().project);
        st().set({ savedAt: Date.now() });
      }, 900);
    });
    const flush = () => {
      if (timer) {
        clearTimeout(timer);
        void saveProject(st().project);
      }
    };
    window.addEventListener('beforeunload', flush);
    return () => {
      unsub();
      window.removeEventListener('beforeunload', flush);
    };
  }, []);
}

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tgt = e.target as HTMLElement;
      if (tgt.closest('input, textarea, select, [contenteditable]')) return;
      const s = st();
      if (s.dialog) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === 'z' && !e.shiftKey) {
        e.preventDefault();
        s.undo();
        return;
      }
      if ((mod && k === 'y') || (mod && k === 'z' && e.shiftKey)) {
        e.preventDefault();
        s.redo();
        return;
      }
      if (mod && k === 's') {
        e.preventDefault();
        void saveProject(s.project).then(() => s.notify(makeT(s.lang)('toast.saved')));
        return;
      }
      if (s.installer) return;
      if (mod && k === 'd') {
        e.preventDefault();
        duplicateSelection();
        return;
      }
      if (mod && k === 'c') {
        copySelection();
        return;
      }
      if (mod && k === 'v') {
        e.preventDefault();
        pasteClipboard();
        return;
      }
      if (mod && k === 'a') {
        e.preventDefault();
        s.select({ items: s.project.items.filter((i) => i.areaId === s.areaId && !i.hidden).map((i) => i.id) });
        return;
      }
      if (mod) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteSelection();
        return;
      }
      if (e.key === 'Escape') {
        if (s.placing || s.cableDraft || s.tool !== 'select') s.set({ placing: null, cableDraft: null, tool: 'select' });
        else s.clearSel();
        return;
      }
      const nudge = e.shiftKey ? 0.5 : 0.1;
      if (e.key.startsWith('Arrow') && s.sel.items.length + s.sel.zones.length + s.sel.notes.length) {
        e.preventDefault();
        const dx = e.key === 'ArrowLeft' ? -nudge : e.key === 'ArrowRight' ? nudge : 0;
        const dy = e.key === 'ArrowUp' ? -nudge : e.key === 'ArrowDown' ? nudge : 0;
        moveSelection(dx, dy, true);
        return;
      }
      const views = ['plan', '3d', 'schema', 'lists', 'analysis', 'measure', 'setup'] as const;
      if (/^[1-7]$/.test(e.key)) {
        s.set({ view: views[Number(e.key) - 1] });
        return;
      }
      switch (k) {
        case 'v':
          s.set({ tool: 'select', cableDraft: null, placing: null });
          break;
        case 'k':
          s.set({ tool: 'cable', placing: null });
          break;
        case 'b':
          s.set({ tool: 'zone', placing: null });
          break;
        case 'm':
          if (e.shiftKey) duplicateSelection(0, 0, true);
          else s.set({ tool: 'measure', placing: null });
          break;
        case 't':
          s.set({ tool: 'text', placing: null });
          break;
        case 'r':
          rotateSelection(e.shiftKey ? -15 : 15);
          break;
        case 'l':
          toggleLock();
          break;
        case 'f':
          window.dispatchEvent(new Event('sahnecad:fit'));
          break;
        case 'g':
          s.set({ layers: { ...s.layers, grid: !s.layers.grid } });
          break;
        case 'h':
          s.set({ layers: { ...s.layers, heatmap: !s.layers.heatmap } });
          break;
        case 'c':
          s.set({ layers: { ...s.layers, coverage: !s.layers.coverage } });
          break;
        case '?':
          s.set({ dialog: { kind: 'help' } });
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

// Adres çubuğunda görünüm: #plan, #3d, #sema, #listeler, #analiz, #olcum, #kurulum (ana ekran kısayolu için)
const SLUG: Record<string, string> = { plan: 'plan', '3d': '3d', schema: 'sema', lists: 'listeler', analysis: 'analiz', measure: 'olcum', setup: 'kurulum' };

function useHashView() {
  useEffect(() => {
    const fromHash = () => {
      const h = decodeURIComponent(location.hash.replace(/^#/, ''));
      const v = Object.keys(SLUG).find((k) => SLUG[k] === h);
      if (v && st().view !== v) st().set({ view: v as View });
    };
    fromHash();
    window.addEventListener('hashchange', fromHash);
    const unsub = useStore.subscribe((s, prev) => {
      if (s.view === prev.view) return;
      try {
        history.replaceState(null, '', '#' + SLUG[s.view]);
      } catch {
        /* yok */
      }
    });
    return () => {
      window.removeEventListener('hashchange', fromHash);
      unsub();
    };
  }, []);
}
