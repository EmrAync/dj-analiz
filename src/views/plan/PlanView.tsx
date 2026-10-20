import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { analyzeCables, anchorPlan } from '../../engine/cables';
import { getDef, makeItem } from '../../model/project';
import type { Item, Project, ZoneKind } from '../../model/types';
import { addItem, addNote, addZone, moveSelection, snapPt, updateCable, updateItem, updateNote, updateZone } from '../../store/actions';
import { st, useStore, useT } from '../../store/store';
import { Icon, useSize } from '../../ui/kit';
import { HeatLegend } from '../HeatLegend';
import { ZONE_KINDS } from '../common';
import { PlanDrawing, PlanItem, type ViewBox } from './PlanDrawing';

interface Cam {
  tx: number;
  ty: number;
  k: number;
}

const cams = new Map<string, Cam>();

type Drag =
  | { kind: 'pan'; sx: number; sy: number; tx0: number; ty0: number }
  | { kind: 'move'; wx0: number; wy0: number; ox: number; oy: number; ax: number; ay: number; started: boolean; sx: number; sy: number }
  | { kind: 'rotate'; id: string; cx: number; cy: number; started: boolean }
  | { kind: 'marquee'; x0: number; y0: number; x1: number; y1: number; add: boolean }
  | { kind: 'zone-draw'; x0: number; y0: number; x1: number; y1: number }
  | { kind: 'zone-resize'; id: string; h: string; ox: number; oy: number; ow: number; od: number; started: boolean }
  | { kind: 'measure'; x0: number; y0: number; x1: number; y1: number; arrow: boolean }
  | { kind: 'cable-pt'; id: string; i: number; started: boolean }
  | { kind: 'note-pt'; id: string; i: number; started: boolean };

export function PlanView() {
  const t = useT();
  const p = useStore((s) => s.project);
  const areaId = useStore((s) => s.areaId);
  const layers = useStore((s) => s.layers);
  const sel = useStore((s) => s.sel);
  const tool = useStore((s) => s.tool);
  const placing = useStore((s) => s.placing);
  const lang = useStore((s) => s.lang);
  const heat = useStore((s) => s.heat);
  const cableDraft = useStore((s) => s.cableDraft);
  const focus = useStore((s) => s.focus);
  const installer = useStore((s) => s.installer);
  const area = p.areas.find((a) => a.id === areaId) || p.areas[0];
  const [wrapRef, size] = useSize<HTMLDivElement>();
  const svgRef = useRef<SVGSVGElement>(null);
  const [cam, setCam] = useState<Cam>(() => cams.get(area.id) || { tx: 60, ty: 60, k: 30 });
  const drag = useRef<Drag | null>(null);
  const [overlay, setOverlay] = useState<Drag | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [zoneKind, setZoneKind] = useState<ZoneKind>('stage');
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d: number; k: number; cx: number; cy: number; tx: number; ty: number } | null>(null);

  const fit = useCallback(() => {
    if (!size.w || !size.h) return;
    const pad = 70;
    const k = Math.max(4, Math.min((size.w - pad * 2) / area.w, (size.h - pad * 2) / area.d));
    setCam({ k, tx: (size.w - area.w * k) / 2, ty: (size.h - area.d * k) / 2 + 12 });
  }, [size.w, size.h, area.w, area.d]);

  // bölüm değişince kamerayı geri yükle veya sığdır
  const fitted = useRef<string>('');
  useEffect(() => {
    if (!size.w) return;
    if (fitted.current === area.id) return;
    fitted.current = area.id;
    const c = cams.get(area.id);
    if (c) setCam(c);
    else fit();
  }, [area.id, size.w, fit]);
  useEffect(() => {
    cams.set(area.id, cam);
  }, [cam, area.id]);
  useEffect(() => {
    const h = () => fit();
    window.addEventListener('sahnecad:fit', h);
    return () => window.removeEventListener('sahnecad:fit', h);
  }, [fit]);
  useEffect(() => {
    if (!focus || !size.w) return;
    setCam((c) => {
      const k = Math.max(c.k, 45);
      return { k, tx: size.w / 2 - focus.x * k, ty: size.h / 2 - focus.y * k };
    });
  }, [focus, size.w, size.h]);

  const toWorld = (cx: number, cy: number) => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: (cx - r.left - cam.tx) / cam.k, y: (cy - r.top - cam.ty) / cam.k };
  };

  const vb: ViewBox = useMemo(() => ({ x0: -cam.tx / cam.k, y0: -cam.ty / cam.k, x1: (size.w - cam.tx) / cam.k, y1: (size.h - cam.ty) / cam.k }), [cam, size]);

  // —— Tekerlek: yakınlaştır / kaydır ——
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const sx = e.clientX - r.left;
      const sy = e.clientY - r.top;
      const isZoom = e.ctrlKey || e.deltaMode === 1 || (Math.abs(e.deltaY) >= 50 && Math.abs(e.deltaX) < 1);
      setCam((c) => {
        if (!isZoom) return { ...c, tx: c.tx - e.deltaX, ty: c.ty - e.deltaY };
        const f = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0018));
        const k = Math.max(2, Math.min(800, c.k * f));
        return { k, tx: sx - ((sx - c.tx) * k) / c.k, ty: sy - ((sy - c.ty) * k) / c.k };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const targetOf = (e: { target: EventTarget | null }) => {
    const el = (e.target as Element).closest?.('[data-kind]') as HTMLElement | SVGElement | null;
    if (!el) return null;
    return { kind: el.getAttribute('data-kind')!, id: el.getAttribute('data-id') || '', h: el.getAttribute('data-h') || '', i: Number(el.getAttribute('data-i') || 0) };
  };

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    const el = svgRef.current!;
    el.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const r = el.getBoundingClientRect();
      pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y), k: cam.k, cx: (a.x + b.x) / 2 - r.left, cy: (a.y + b.y) / 2 - r.top, tx: cam.tx, ty: cam.ty };
      drag.current = null;
      setOverlay(null);
      return;
    }
    const w = toWorld(e.clientX, e.clientY);
    const tg = targetOf(e);
    const s = st();
    // orta/sağ tuş veya boşlukla kaydır
    if (e.button === 1 || e.button === 2 || tool === 'pan' || spaceDown.current) {
      drag.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, tx0: cam.tx, ty0: cam.ty };
      return;
    }
    if (placing) {
      const def = getDef(s.project, placing) || s.library.defs.find((d) => d.id === placing);
      addItem(placing, w.x, w.y);
      if (!e.shiftKey || !def) s.set({ placing: null });
      return;
    }
    if (installer) {
      if (tg?.kind === 'item') s.select({ items: [tg.id] });
      else if (tg?.kind === 'cable') s.select({ cables: [tg.id] });
      else drag.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, tx0: cam.tx, ty0: cam.ty };
      return;
    }
    if (tool === 'cable') {
      if (tg?.kind === 'item') {
        const d = s.cableDraft;
        if (!d) s.set({ cableDraft: { item: tg.id } });
        else if (d.item !== tg.id) {
          s.set({ dialog: { kind: 'connect', data: { a: d.item, ap: d.port, b: tg.id } }, cableDraft: null });
        }
      } else if (tg?.kind === 'cable') s.select({ cables: [tg.id] });
      else {
        s.set({ cableDraft: null });
        drag.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, tx0: cam.tx, ty0: cam.ty };
      }
      return;
    }
    if (tool === 'zone') {
      const q = snapPt(w.x, w.y);
      drag.current = { kind: 'zone-draw', x0: q.x, y0: q.y, x1: q.x, y1: q.y };
      setOverlay(drag.current);
      return;
    }
    if (tool === 'measure') {
      const q = snapPt(w.x, w.y);
      drag.current = { kind: 'measure', x0: q.x, y0: q.y, x1: q.x, y1: q.y, arrow: e.shiftKey };
      setOverlay(drag.current);
      return;
    }
    if (tool === 'text') {
      addNote('text', w.x, w.y, undefined, undefined, t('plan.newText'));
      s.set({ tool: 'select' });
      return;
    }
    // —— seçim aracı ——
    if (!tg) {
      if (e.pointerType === 'touch') {
        drag.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, tx0: cam.tx, ty0: cam.ty };
        if (!e.shiftKey) s.clearSel();
        return;
      }
      drag.current = { kind: 'marquee', x0: w.x, y0: w.y, x1: w.x, y1: w.y, add: e.shiftKey };
      if (!e.shiftKey) s.clearSel();
      return;
    }
    if (tg.kind === 'rot') {
      const it = s.project.items.find((i) => i.id === tg.id)!;
      drag.current = { kind: 'rotate', id: tg.id, cx: it.x, cy: it.y, started: false };
      return;
    }
    if (tg.kind === 'zone-h') {
      const z = s.project.zones.find((x) => x.id === tg.id)!;
      drag.current = { kind: 'zone-resize', id: tg.id, h: tg.h, ox: z.x, oy: z.y, ow: z.w, od: z.d, started: false };
      return;
    }
    if (tg.kind === 'cable-pt') {
      drag.current = { kind: 'cable-pt', id: tg.id, i: tg.i, started: false };
      return;
    }
    if (tg.kind === 'note-pt') {
      drag.current = { kind: 'note-pt', id: tg.id, i: tg.i, started: false };
      return;
    }
    if (tg.kind === 'cable') {
      s.select({ cables: [tg.id] }, e.shiftKey);
      return;
    }
    // öğe / bölge / not: seç ve taşı
    const key = tg.kind === 'item' ? 'items' : tg.kind === 'zone' ? 'zones' : 'notes';
    const already = (s.sel[key as 'items'] as string[]).includes(tg.id);
    if (e.shiftKey) s.select({ [key]: [tg.id] }, true);
    else if (!already) s.select({ [key]: [tg.id] });
    // taşıma referansı: ilk seçili öğenin konumu
    let ox = w.x;
    let oy = w.y;
    if (tg.kind === 'item') {
      const it = s.project.items.find((i) => i.id === tg.id);
      if (it) {
        ox = it.x;
        oy = it.y;
      }
    } else if (tg.kind === 'zone') {
      const z = s.project.zones.find((x) => x.id === tg.id);
      if (z) {
        ox = z.x;
        oy = z.y;
      }
    }
    drag.current = { kind: 'move', wx0: w.x, wy0: w.y, ox, oy, ax: 0, ay: 0, started: false, sx: e.clientX, sy: e.clientY };
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch.current && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const r = svgRef.current!.getBoundingClientRect();
      const pc = pinch.current;
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const k = Math.max(2, Math.min(800, (pc.k * d) / pc.d));
      const cx = (a.x + b.x) / 2 - r.left;
      const cy = (a.y + b.y) / 2 - r.top;
      setCam({ k, tx: cx - ((pc.cx - pc.tx) * k) / pc.k, ty: cy - ((pc.cy - pc.ty) * k) / pc.k });
      return;
    }
    const w = toWorld(e.clientX, e.clientY);
    setCursor(w);
    const dg = drag.current;
    if (!dg) {
      const tg = targetOf(e);
      const h = tg && (tg.kind === 'item' || tg.kind === 'cable') ? tg.id : null;
      if (h !== hover) setHover(h);
      return;
    }
    const s = st();
    switch (dg.kind) {
      case 'pan':
        setCam((c) => ({ ...c, tx: dg.tx0 + e.clientX - dg.sx, ty: dg.ty0 + e.clientY - dg.sy }));
        break;
      case 'move': {
        if (!dg.started) {
          if (Math.hypot(e.clientX - dg.sx, e.clientY - dg.sy) < 4) return;
          dg.started = true;
          s.checkpoint();
        }
        const tx = s.snap ? Math.round((dg.ox + w.x - dg.wx0) / s.gridStep) * s.gridStep : dg.ox + w.x - dg.wx0;
        const ty = s.snap ? Math.round((dg.oy + w.y - dg.wy0) / s.gridStep) * s.gridStep : dg.oy + w.y - dg.wy0;
        const dx = tx - dg.ox - dg.ax;
        const dy = ty - dg.oy - dg.ay;
        if (Math.abs(dx) > 1e-6 || Math.abs(dy) > 1e-6) {
          moveSelection(dx, dy, false);
          dg.ax += dx;
          dg.ay += dy;
        }
        break;
      }
      case 'rotate': {
        if (!dg.started) {
          dg.started = true;
          s.checkpoint();
        }
        let a = (Math.atan2(-(w.x - dg.cx), w.y - dg.cy) * 180) / Math.PI;
        const stepA = e.altKey ? 1 : e.shiftKey ? 15 : 5;
        a = Math.round(a / stepA) * stepA;
        a = ((a % 360) + 360) % 360;
        updateItem(dg.id, { rot: a }, false);
        break;
      }
      case 'marquee':
      case 'zone-draw':
      case 'measure': {
        const q = dg.kind === 'marquee' ? w : snapPt(w.x, w.y);
        dg.x1 = q.x;
        dg.y1 = q.y;
        setOverlay({ ...dg });
        break;
      }
      case 'zone-resize': {
        if (!dg.started) {
          dg.started = true;
          s.checkpoint();
        }
        const q = snapPt(w.x, w.y);
        let x0 = dg.ox;
        let y0 = dg.oy;
        let x1 = dg.ox + dg.ow;
        let y1 = dg.oy + dg.od;
        if (dg.h.includes('w')) x0 = Math.min(q.x, x1 - 0.2);
        if (dg.h.includes('e')) x1 = Math.max(q.x, x0 + 0.2);
        if (dg.h.includes('n')) y0 = Math.min(q.y, y1 - 0.2);
        if (dg.h.includes('s')) y1 = Math.max(q.y, y0 + 0.2);
        updateZone(dg.id, { x: x0, y: y0, w: +(x1 - x0).toFixed(2), d: +(y1 - y0).toFixed(2) }, false);
        break;
      }
      case 'cable-pt': {
        if (!dg.started) {
          dg.started = true;
          s.checkpoint();
        }
        const q = snapPt(w.x, w.y);
        const c = s.project.cables.find((x) => x.id === dg.id);
        if (c) updateCable(dg.id, { pts: c.pts.map((pp, i) => (i === dg.i ? q : pp)) }, false);
        break;
      }
      case 'note-pt': {
        if (!dg.started) {
          dg.started = true;
          s.checkpoint();
        }
        const q = snapPt(w.x, w.y);
        updateNote(dg.id, dg.i === 1 ? { x: q.x, y: q.y } : { x2: q.x, y2: q.y }, false);
        break;
      }
    }
  };

  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    const dg = drag.current;
    drag.current = null;
    setOverlay(null);
    if (!dg) return;
    const s = st();
    if (dg.kind === 'marquee') {
      const x0 = Math.min(dg.x0, dg.x1);
      const x1 = Math.max(dg.x0, dg.x1);
      const y0 = Math.min(dg.y0, dg.y1);
      const y1 = Math.max(dg.y0, dg.y1);
      if (x1 - x0 < 0.05 && y1 - y0 < 0.05) return;
      const items = s.project.items.filter((i) => i.areaId === area.id && !i.hidden && i.x >= x0 && i.x <= x1 && i.y >= y0 && i.y <= y1).map((i) => i.id);
      const zones = s.project.zones.filter((z) => z.areaId === area.id && z.x >= x0 && z.x + z.w <= x1 && z.y >= y0 && z.y + z.d <= y1).map((z) => z.id);
      s.select({ items, zones }, dg.add);
    } else if (dg.kind === 'zone-draw') {
      const x0 = Math.min(dg.x0, dg.x1);
      const y0 = Math.min(dg.y0, dg.y1);
      const w = Math.abs(dg.x1 - dg.x0);
      const d = Math.abs(dg.y1 - dg.y0);
      if (w > 0.2 && d > 0.2) addZone(zoneKind, t(('zone.' + zoneKind) as 'zone.stage'), x0, y0, w, d);
    } else if (dg.kind === 'measure') {
      if (Math.hypot(dg.x1 - dg.x0, dg.y1 - dg.y0) > 0.1) addNote(dg.arrow ? 'arrow' : 'dim', dg.x0, dg.y0, dg.x1, dg.y1);
    }
  };

  const onDoubleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (installer) return;
    const tg = targetOf(e);
    const w = toWorld(e.clientX, e.clientY);
    const s = st();
    if (tg?.kind === 'cable-pt') {
      const c = s.project.cables.find((x) => x.id === tg.id);
      if (c) updateCable(c.id, { pts: c.pts.filter((_, i) => i !== tg.i) });
      return;
    }
    if (tg?.kind === 'cable') {
      const inf = analyzeCables(s.project).get(tg.id);
      if (!inf?.path || !inf.a || !inf.b || !inf.defA || !inf.defB) return;
      const A = anchorPlan(inf.a, inf.defA);
      const B = anchorPlan(inf.b, inf.defB);
      const chain = [A, ...inf.cable.pts, B];
      let best = 0;
      let bd = Infinity;
      for (let i = 1; i < chain.length; i++) {
        const d = segDist(w, chain[i - 1], chain[i]);
        if (d < bd) {
          bd = d;
          best = i - 1;
        }
      }
      const pts = inf.cable.pts.slice();
      pts.splice(best, 0, snapPt(w.x, w.y));
      updateCable(tg.id, { pts });
      s.select({ cables: [tg.id] });
    }
  };

  // boşluk tuşu ile kaydırma
  const spaceDown = useRef(false);
  useEffect(() => {
    const d = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !(e.target as HTMLElement).closest('input,textarea,select')) {
        spaceDown.current = true;
        e.preventDefault();
      }
    };
    const u = (e: KeyboardEvent) => {
      if (e.code === 'Space') spaceDown.current = false;
    };
    window.addEventListener('keydown', d);
    window.addEventListener('keyup', u);
    return () => {
      window.removeEventListener('keydown', d);
      window.removeEventListener('keyup', u);
    };
  }, []);

  // kütüphaneden sürükle-bırak
  const onDrop = (e: React.DragEvent) => {
    const id = e.dataTransfer.getData('application/x-sahnecad-def') || e.dataTransfer.getData('text/plain');
    if (!id) return;
    e.preventDefault();
    const w = toWorld(e.clientX, e.clientY);
    addItem(id, w.x, w.y);
  };

  const ghost = useMemo(() => {
    if (!placing || !cursor) return null;
    const def = getDef(p, placing).id !== '?' ? getDef(p, placing) : st().library.defs.find((d) => d.id === placing);
    if (!def) return null;
    const it: Item = makeItem(p, def, area.id, cursor.x, cursor.y);
    return { it, def };
  }, [placing, cursor, p, area.id]);

  const draftLine = useMemo(() => {
    if (!cableDraft || !cursor) return null;
    const it = p.items.find((i) => i.id === cableDraft.item);
    if (!it) return null;
    const a = anchorPlan(it, getDef(p, it.defId));
    return { a, b: cursor };
  }, [cableDraft, cursor, p]);

  const hud = placing ? t('hud.placing') : tool === 'cable' ? (cableDraft ? t('hud.cable2') : t('hud.cable1')) : tool === 'zone' ? t('hud.zone') : tool === 'measure' ? t('hud.measure') : tool === 'text' ? t('hud.text') : null;

  return (
    <div className="canvas-wrap" ref={wrapRef} onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      <svg
        ref={svgRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => setCursor(null)}
        onDoubleClick={onDoubleClick}
        onContextMenu={(e) => e.preventDefault()}
        style={{ cursor: placing || tool === 'zone' || tool === 'measure' ? 'crosshair' : tool === 'cable' ? 'cell' : tool === 'text' ? 'text' : drag.current?.kind === 'pan' ? 'grabbing' : 'default' }}
        data-testid="plan-svg"
      >
        <g transform={`translate(${cam.tx} ${cam.ty}) scale(${cam.k})`}>
          <PlanDrawing p={p} area={area} layers={layers} sel={sel} k={cam.k} lang={lang} t={t} vb={vb} heat={layers.heatmap ? heat : null} hover={hover} />
          {ghost ? <PlanItem it={ghost.it} def={ghost.def} k={cam.k} sel={false} labels={false} ghost /> : null}
          {draftLine ? <line x1={draftLine.a.x} y1={draftLine.a.y} x2={draftLine.b.x} y2={draftLine.b.y} stroke="var(--accent)" strokeWidth={2} strokeDasharray="6 4" vectorEffect="non-scaling-stroke" /> : null}
          {overlay?.kind === 'marquee' ? <rect x={Math.min(overlay.x0, overlay.x1)} y={Math.min(overlay.y0, overlay.y1)} width={Math.abs(overlay.x1 - overlay.x0)} height={Math.abs(overlay.y1 - overlay.y0)} fill="rgba(37,99,235,0.08)" stroke="var(--accent)" strokeDasharray="4 3" vectorEffect="non-scaling-stroke" /> : null}
          {overlay?.kind === 'zone-draw' ? (
            <g>
              <rect x={Math.min(overlay.x0, overlay.x1)} y={Math.min(overlay.y0, overlay.y1)} width={Math.abs(overlay.x1 - overlay.x0)} height={Math.abs(overlay.y1 - overlay.y0)} fill="rgba(37,99,235,0.1)" stroke="var(--accent)" vectorEffect="non-scaling-stroke" />
              <text x={Math.max(overlay.x0, overlay.x1)} y={Math.max(overlay.y0, overlay.y1)} dx={6 / cam.k} dy={14 / cam.k} fontSize={11 / cam.k} fill="var(--accent)" fontWeight={700}>
                {Math.abs(overlay.x1 - overlay.x0).toFixed(2)} × {Math.abs(overlay.y1 - overlay.y0).toFixed(2)} m
              </text>
            </g>
          ) : null}
          {overlay?.kind === 'measure' ? (
            <g>
              <line x1={overlay.x0} y1={overlay.y0} x2={overlay.x1} y2={overlay.y1} stroke="#0891b2" strokeWidth={2} vectorEffect="non-scaling-stroke" />
              <text x={overlay.x1} y={overlay.y1} dx={8 / cam.k} dy={-8 / cam.k} fontSize={12 / cam.k} fill="#0891b2" fontWeight={700}>
                {Math.hypot(overlay.x1 - overlay.x0, overlay.y1 - overlay.y0).toFixed(2)} m
              </text>
            </g>
          ) : null}
        </g>
      </svg>
      {!installer ? (
        <div className="toolbar no-print">
          <div className="tool-card">
            <ToolBtn id="select" icon="select" label={t('tool.select')} keyHint="V" />
            <ToolBtn id="cable" icon="cable" label={t('tool.cable')} keyHint="K" />
            <ToolBtn id="zone" icon="zone" label={t('tool.zone')} keyHint="B" />
            {tool === 'zone' ? (
              <select className="inp" value={zoneKind} onChange={(e) => setZoneKind(e.target.value as ZoneKind)}>
                {ZONE_KINDS.map((z) => (
                  <option key={z} value={z}>
                    {t(('zone.' + z) as 'zone.stage')}
                  </option>
                ))}
              </select>
            ) : null}
            <ToolBtn id="measure" icon="measure" label={t('tool.measure')} keyHint="M" />
            <ToolBtn id="text" icon="text" label={t('tool.text')} keyHint="T" />
          </div>
          <LayerQuick />
        </div>
      ) : null}
      {hud ? <div className="hud">{hud}</div> : null}
      <div className="floating-br no-print">
        {layers.heatmap ? <HeatLegend /> : null}
        <div className="tool-card">
          <button className="ibtn" title={t('plan.zoomOut')} onClick={() => setCam((c) => zoomAt(c, size.w / 2, size.h / 2, 1 / 1.3))}>
            <Icon name="minus" size={16} />
          </button>
          <span style={{ minWidth: 46, textAlign: 'center', fontSize: 11, color: 'var(--muted)' }}>{Math.round(cam.k)} px/m</span>
          <button className="ibtn" title={t('plan.zoomIn')} onClick={() => setCam((c) => zoomAt(c, size.w / 2, size.h / 2, 1.3))}>
            <Icon name="plus" size={16} />
          </button>
          <button className="ibtn" title={t('plan.fit') + ' (F)'} onClick={fit}>
            <Icon name="fit" size={16} />
          </button>
        </div>
      </div>
      <CursorReadout cursor={cursor} />
    </div>
  );
}

function zoomAt(c: Cam, sx: number, sy: number, f: number): Cam {
  const k = Math.max(2, Math.min(800, c.k * f));
  return { k, tx: sx - ((sx - c.tx) * k) / c.k, ty: sy - ((sy - c.ty) * k) / c.k };
}

function segDist(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

function ToolBtn({ id, icon, label, keyHint }: { id: 'select' | 'cable' | 'zone' | 'measure' | 'text'; icon: string; label: string; keyHint: string }) {
  const tool = useStore((s) => s.tool);
  return (
    <button className={'ibtn' + (tool === id ? ' on' : '')} title={`${label} (${keyHint})`} onClick={() => st().set({ tool: id, cableDraft: null, placing: null })} data-testid={'tool-' + id}>
      <Icon name={icon} size={17} />
      <span className="hide-sm">{label}</span>
    </button>
  );
}

function LayerQuick() {
  const t = useT();
  const layers = useStore((s) => s.layers);
  const snap = useStore((s) => s.snap);
  const tog = (k: 'labels' | 'cableTags' | 'coverage' | 'heatmap' | 'grid' | 'dims') => st().set({ layers: { ...layers, [k]: !layers[k] } });
  return (
    <div className="tool-card">
      <button className={'ibtn' + (snap ? ' on' : '')} title={t('plan.snap')} onClick={() => st().set({ snap: !snap })}>
        <Icon name="magnet" size={16} />
      </button>
      <button className={'ibtn' + (layers.grid ? ' on' : '')} title={t('layer.grid')} onClick={() => tog('grid')}>
        <Icon name="grid" size={16} />
      </button>
      <button className={'ibtn' + (layers.labels ? ' on' : '')} title={t('layer.labels')} onClick={() => tog('labels')}>
        <Icon name="tag" size={16} />
      </button>
      <button className={'ibtn' + (layers.cableTags ? ' on' : '')} title={t('layer.cableTags')} onClick={() => tog('cableTags')}>
        <Icon name="cable" size={16} />
      </button>
      <button className={'ibtn' + (layers.coverage ? ' on' : '')} title={t('layer.coverage')} onClick={() => tog('coverage')}>
        <Icon name="cone" size={16} />
      </button>
      <button className={'ibtn' + (layers.heatmap ? ' on' : '')} title={t('layer.heatmap') + ' (H)'} onClick={() => tog('heatmap')} data-testid="toggle-heat">
        <Icon name="heat" size={16} />
      </button>
    </div>
  );
}

function CursorReadout({ cursor }: { cursor: { x: number; y: number } | null }) {
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('sahnecad:cursor', { detail: cursor }));
  }, [cursor]);
  return null;
}

export type { Project };
