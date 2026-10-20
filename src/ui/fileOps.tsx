import { renderToStaticMarkup } from 'react-dom/server';
import { toDXF } from '../engine/lists';
import { makeT, type TFn } from '../i18n';
import { newProject } from '../model/project';
import { downloadBlob, downloadText, normalizeProject, pickFile, readText, saveProject } from '../store/persist';
import { st } from '../store/store';
import { PlanDrawing } from '../views/plan/PlanDrawing';

function safeName(s: string): string {
  return (s || 'proje').replace(/[\\/:*?"<>|]+/g, '_').trim() || 'proje';
}

export function exportJSON(): void {
  const p = st().project;
  downloadText(`${safeName(p.name)}.sahnecad.json`, JSON.stringify(p, null, 1));
}

export async function importJSON(t: TFn): Promise<void> {
  const f = await pickFile('.json,.sahnecad,application/json');
  if (!f) return;
  try {
    const raw = JSON.parse(await readText(f));
    const p = normalizeProject(raw);
    if (!p) throw new Error('format');
    // aynı id ile mevcut projenin üstüne yazmamak için yeni id
    p.id = 'pr' + Math.random().toString(36).slice(2, 10);
    st().setProject(p);
    await saveProject(p);
    st().notify(t('toast.imported', { n: p.name }));
  } catch {
    st().notify(t('toast.importFail'), 'err');
  }
}

export async function saveNow(t: TFn): Promise<void> {
  await saveProject(st().project);
  st().set({ savedAt: Date.now() });
  st().notify(t('toast.saved'));
}

export async function newEmptyProject(t: TFn): Promise<void> {
  const p = newProject(t('proj.newName'));
  p.areas[0].name = t('proj.mainArea');
  st().setProject(p);
  await saveProject(p);
}

// —— Plan dışa aktarma ——
function resolveVars(svg: string): string {
  const cs = getComputedStyle(document.documentElement);
  return svg.replace(/var\(--([a-z0-9-]+)\)/gi, (_, n) => cs.getPropertyValue('--' + n).trim() || '#888');
}

export function planSvgString(scale = 40): { svg: string; w: number; h: number } {
  const s = st();
  const p = s.project;
  const area = p.areas.find((a) => a.id === s.areaId) || p.areas[0];
  const pad = 2.2;
  const k = scale;
  const W = Math.round((area.w + pad * 2) * k);
  const H = Math.round((area.d + pad * 2 + 1.2) * k);
  const t = makeT(s.lang);
  const meta = p.meta;
  const inner = renderToStaticMarkup(
    <svg xmlns="http://www.w3.org/2000/svg" width={W} height={H} viewBox={`0 0 ${W} ${H}`} fontFamily="Segoe UI, Roboto, Helvetica, Arial, sans-serif">
      <rect width={W} height={H} fill="var(--plan-bg)" />
      <g transform={`translate(${pad * k} ${(pad + 0.6) * k}) scale(${k})`}>
        <PlanDrawing p={p} area={area} layers={{ ...s.layers }} sel={{ items: [], cables: [], zones: [], notes: [] }} k={k} lang={s.lang} t={t} vb={{ x0: -pad, y0: -pad, x1: area.w + pad, y1: area.d + pad }} heat={s.layers.heatmap ? s.heat : null} print />
      </g>
      <text x={14} y={22} fontSize={15} fontWeight={700} fill="var(--text)">
        {p.name} — {area.name}
      </text>
      <text x={14} y={40} fontSize={11} fill="var(--muted)">
        {[meta.venue, meta.date, meta.engineer].filter(Boolean).join(' · ')} · SahneCAD
      </text>
    </svg>,
  );
  return { svg: resolveVars(inner), w: W, h: H };
}

export function exportPlanSVG(): void {
  const { svg } = planSvgString(40);
  downloadText(`${safeName(st().project.name)}-plan.svg`, svg, 'image/svg+xml');
}

export function exportPlanPNG(): void {
  const { svg, w, h } = planSvgString(40);
  const img = new Image();
  const scale = 2;
  img.onload = () => {
    const c = document.createElement('canvas');
    c.width = w * scale;
    c.height = h * scale;
    const ctx = c.getContext('2d')!;
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0);
    c.toBlob((b) => b && downloadBlob(`${safeName(st().project.name)}-plan.png`, b), 'image/png');
  };
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

export function exportDXF(): void {
  const s = st();
  downloadText(`${safeName(s.project.name)}.dxf`, toDXF(s.project, s.areaId, s.lang), 'application/dxf');
}

export function export3DPNG(t: TFn): void {
  const s = st();
  if (s.view !== '3d') {
    s.set({ view: '3d' });
    setTimeout(() => export3DPNG(t), 900);
    return;
  }
  const c = document.querySelector('.three-wrap canvas') as HTMLCanvasElement | null;
  if (!c) {
    s.notify(t('toast.no3d'), 'warn');
    return;
  }
  c.toBlob((b) => b && downloadBlob(`${safeName(s.project.name)}-3d.png`, b), 'image/png');
}
