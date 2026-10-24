import { memo, useMemo } from 'react';
import { iconMarkup } from '../../catalog/icons';
import { sourcesOf, splColor, splGrid, type SplGrid } from '../../engine/acoustics';
import { analyzeCables, type CableInfo } from '../../engine/cables';
import { devColor, targetGrid, zoneTarget, type Proposal } from '../../engine/coverage';
import { polyLen, polyMid } from '../../engine/derive';
import { getDef, itemBaseZ, itemDims, localToPlan } from '../../model/project';
import type { Area, EquipDef, Item, Lang, Note, Project, Zone } from '../../model/types';
import type { HeatOpts, Layers, Selection } from '../../store/store';
import { cableColor, cableVisible, catColor, fmtM, itemImage, itemVisible, ZONE_STYLE } from '../common';
import type { TFn } from '../../i18n';
import { isOff, variantMap } from '../../model/variants';

export interface ViewBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface Props {
  p: Project;
  area: Area;
  layers: Layers;
  sel: Selection;
  k: number;
  lang: Lang;
  t: TFn;
  vb: ViewBox;
  heat?: HeatOpts | null;
  hover?: string | null;
  print?: boolean;
  ghosts?: Proposal[] | null;
}

const NS = { vectorEffect: 'non-scaling-stroke' } as const;

export function PlanDrawing({ p, area, layers, sel, k, lang, t, vb, heat, hover, print, ghosts }: Props) {
  const items = useMemo(() => p.items.filter((i) => i.areaId === area.id), [p.items, area.id]);
  const zones = useMemo(() => p.zones.filter((z) => z.areaId === area.id), [p.zones, area.id]);
  const notes = useMemo(() => p.notes.filter((n) => n.areaId === area.id), [p.notes, area.id]);
  const cinfo = analyzeCables(p);
  const selItems = new Set(sel.items);
  const selCables = new Set(sel.cables);
  const selZones = new Set(sel.zones);
  const selNotes = new Set(sel.notes);
  const px = (n: number) => n / k;
  const bg = layers.bg && area.bg ? p.assets[area.bg.assetId] : undefined;
  const grid = heat && layers.heatmap ? splGrid(p, area.id, heat) : null;
  const devMode = !!heat && heat.mode === 'dev' && heat.band === 'mid';
  const tgrid = grid && devMode ? targetGrid(p, area.id, grid) : null;
  const heatImg = useHeatImage(grid, p.settings.targetSpl, tgrid);
  const showLabels = layers.labels && k > 14;

  // seçili tek öğe: duvarlara ölçü
  const single = sel.items.length === 1 ? items.find((i) => i.id === sel.items[0]) : undefined;

  return (
    <g className="plan" style={{ ['--halo' as string]: `${3 / k}px` }}>
      <PlanDefs k={k} />
      {/* ızgara */}
      {layers.grid ? <rect x={vb.x0} y={vb.y0} width={vb.x1 - vb.x0} height={vb.y1 - vb.y0} fill={k > 14 ? 'url(#grid-fine)' : 'url(#grid-coarse)'} /> : null}
      {/* salon */}
      <rect x={0} y={0} width={area.w} height={area.d} fill={area.indoor ? 'var(--room-fill)' : 'rgba(34,197,94,0.05)'} />
      {bg ? <image href={bg.data} x={area.bg!.x} y={area.bg!.y} width={area.bg!.w} height={(area.bg!.w * bg.h) / bg.w} opacity={area.bg!.opacity} preserveAspectRatio="none" /> : null}
      {layers.grid ? <rect x={0} y={0} width={area.w} height={area.d} fill={k > 14 ? 'url(#grid-fine)' : 'url(#grid-coarse)'} opacity={0.9} /> : null}
      {/* bölgeler */}
      {layers.zones ? zones.map((z) => <PlanZone key={z.id} z={z} k={k} sel={selZones.has(z.id)} lang={lang} t={t} target={grid ? zoneTarget(z) : null} />) : null}
      {/* ısı haritası */}
      {grid && heatImg ? <image href={heatImg} x={0} y={0} width={grid.nx * grid.step} height={grid.ny * grid.step} opacity={0.72} preserveAspectRatio="none" style={{ pointerEvents: 'none' }} /> : null}
      {/* duvarlar */}
      <rect x={0} y={0} width={area.w} height={area.d} fill="none" stroke="var(--wall)" strokeWidth={area.indoor ? Math.max(0.12, px(3)) : px(1.5)} strokeDasharray={area.indoor ? undefined : `${px(8)} ${px(5)}`} />
      {layers.dims ? <RoomDims area={area} k={k} lang={lang} /> : null}
      {/* kapsama */}
      {layers.coverage ? <Coverage p={p} area={area} items={items} k={k} sel={selItems} /> : null}
      {/* kablolar */}
      {layers.cables ? (
        <g className="cables">
          {[...cinfo.values()].map((inf) => {
            if (!cableVisible(inf, layers)) return null;
            const off = isOff(p, inf.cable);
            if (off && !layers.alts) return null;
            if (inf.path && inf.a?.areaId === area.id)
              return off ? (
                <g key={inf.cable.id} opacity={0.3}>
                  <PlanCable inf={inf} k={k} sel={selCables.has(inf.cable.id)} tags={false} hover={false} />
                </g>
              ) : (
                <PlanCable key={inf.cable.id} inf={inf} k={k} sel={selCables.has(inf.cable.id)} tags={layers.cableTags} hover={hover === inf.cable.id} />
              );
            if (inf.crossArea && (inf.a?.areaId === area.id || inf.b?.areaId === area.id)) return <CrossCable key={inf.cable.id} inf={inf} p={p} areaId={area.id} k={k} sel={selCables.has(inf.cable.id)} />;
            return null;
          })}
        </g>
      ) : null}
      {/* öğeler */}
      <g className="items">
        {items.map((it) => {
          const def = getDef(p, it.defId);
          if (!itemVisible(it, def, layers)) return null;
          const off = isOff(p, it);
          if (off && !layers.alts) return null;
          const dm = itemDims(it, def);
          const big = Math.max(dm.w, dm.d) * k >= 15 || !!def.acoustic || k >= 48;
          const badge = it.variant ? variantMap(p).get(it.variant)?.v.label : undefined;
          return <PlanItem key={it.id} it={it} def={def} img={itemImage(p, it, def)} k={k} sel={selItems.has(it.id)} labels={(showLabels && big) || selItems.has(it.id) || hover === it.id} model={k > 55 && layers.labels} hover={hover === it.id} badge={badge} faded={off} />;
        })}
      </g>
      {/* ölçüm noktaları */}
      {layers.measure !== false && p.measurements?.length ? <MeasurePoints p={p} areaId={area.id} k={k} lang={lang} /> : null}
      {/* öneriler (hayalet) */}
      {ghosts?.length ? <Ghosts p={p} area={area} ghosts={ghosts} k={k} /> : null}
      {/* notlar */}
      {layers.notes ? notes.map((n) => <PlanNote key={n.id} n={n} k={k} sel={selNotes.has(n.id)} lang={lang} />) : null}
      {/* seçim tutamakları */}
      {!print && single ? <SelectionExtras it={single} def={getDef(p, single.defId)} area={area} k={k} lang={lang} single={sel.items.length === 1} z={itemBaseZ(p, single)} /> : null}
      {!print && sel.zones.length === 1 ? <ZoneHandles z={zones.find((z) => z.id === sel.zones[0])} k={k} /> : null}
      {!print && sel.cables.length === 1 ? <CableHandles inf={cinfo.get(sel.cables[0])} k={k} /> : null}
    </g>
  );
}

function PlanDefs({ k }: { k: number }) {
  const w = 1 / k;
  return (
    <defs>
      <pattern id="grid-fine" width={1} height={1} patternUnits="userSpaceOnUse">
        <path d="M 0.5 0 L 0.5 1 M 0 0.5 L 1 0.5" stroke="var(--grid-minor)" strokeWidth={w} fill="none" />
        <path d="M 0 0 L 0 1 M 0 0 L 1 0" stroke="var(--grid-major)" strokeWidth={w * 1.2} fill="none" />
      </pattern>
      <pattern id="grid-coarse" width={5} height={5} patternUnits="userSpaceOnUse">
        <path d="M 1 0 V 5 M 2 0 V 5 M 3 0 V 5 M 4 0 V 5 M 0 1 H 5 M 0 2 H 5 M 0 3 H 5 M 0 4 H 5" stroke="var(--grid-minor)" strokeWidth={w} fill="none" />
        <path d="M 0 0 L 0 5 M 0 0 L 5 0" stroke="var(--grid-major)" strokeWidth={w * 1.2} fill="none" />
      </pattern>
      <pattern id="hatch-walk" width={0.6} height={0.6} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width={0.6} height={0.6} fill="rgba(34,197,94,0.10)" />
        <path d="M 0 0 L 0 0.6" stroke="rgba(22,163,74,0.35)" strokeWidth={0.08} />
      </pattern>
      <pattern id="hatch-nogo" width={0.5} height={0.5} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width={0.5} height={0.5} fill="rgba(248,113,113,0.10)" />
        <path d="M 0 0 L 0 0.5" stroke="rgba(220,38,38,0.4)" strokeWidth={0.07} />
      </pattern>
      <pattern id="dance-check" width={1} height={1} patternUnits="userSpaceOnUse">
        <rect width={1} height={1} fill="rgba(244,114,182,0.08)" />
        <rect width={0.5} height={0.5} fill="rgba(219,39,119,0.10)" />
        <rect x={0.5} y={0.5} width={0.5} height={0.5} fill="rgba(219,39,119,0.10)" />
      </pattern>
      <pattern id="stage-boards" width={0.5} height={2} patternUnits="userSpaceOnUse">
        <rect width={0.5} height={2} fill="rgba(100,116,139,0.18)" />
        <path d="M 0 0 V 2" stroke="rgba(71,85,105,0.25)" strokeWidth={w} />
      </pattern>
      <marker id="arrow-end" viewBox="0 0 10 10" refX={8} refY={5} markerWidth={7} markerHeight={7} orient="auto-start-reverse">
        <path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" />
      </marker>
    </defs>
  );
}

function RoomDims({ area, k, lang }: { area: Area; k: number; lang: Lang }) {
  const off = 18 / k;
  const fs = 11 / k;
  const tick = 5 / k;
  return (
    <g className="dims" stroke="var(--muted)" fill="var(--muted)" style={{ pointerEvents: 'none' }}>
      <line x1={0} y1={-off} x2={area.w} y2={-off} strokeWidth={1} {...NS} />
      <line x1={0} y1={-off - tick} x2={0} y2={-off + tick} strokeWidth={1} {...NS} />
      <line x1={area.w} y1={-off - tick} x2={area.w} y2={-off + tick} strokeWidth={1} {...NS} />
      <text x={area.w / 2} y={-off - 4 / k} fontSize={fs} textAnchor="middle" stroke="none" className="plan-dim">
        {fmtM(area.w, lang)} m
      </text>
      <line x1={-off} y1={0} x2={-off} y2={area.d} strokeWidth={1} {...NS} />
      <line x1={-off - tick} y1={0} x2={-off + tick} y2={0} strokeWidth={1} {...NS} />
      <line x1={-off - tick} y1={area.d} x2={-off + tick} y2={area.d} strokeWidth={1} {...NS} />
      <text x={-off - 4 / k} y={area.d / 2} fontSize={fs} textAnchor="middle" stroke="none" transform={`rotate(-90 ${-off - 4 / k} ${area.d / 2})`} className="plan-dim">
        {fmtM(area.d, lang)} m
      </text>
    </g>
  );
}

const PlanZone = memo(function PlanZone({ z, k, sel, lang, t, target }: { z: Zone; k: number; sel: boolean; lang: Lang; t: TFn; target?: number | null }) {
  const st = ZONE_STYLE[z.kind] || ZONE_STYLE.custom;
  const fill = z.kind === 'walkway' ? 'url(#hatch-walk)' : z.kind === 'nogo' ? 'url(#hatch-nogo)' : z.kind === 'dance' ? 'url(#dance-check)' : z.kind === 'stage' ? 'url(#stage-boards)' : z.color || st.fill;
  const fs = Math.min(12 / k, Math.max(0.18, z.w / 12));
  return (
    <g data-kind="zone" data-id={z.id} style={{ cursor: 'move' }}>
      <rect x={z.x} y={z.y} width={z.w} height={z.d} fill={fill} fillOpacity={fill.startsWith('url') ? 1 : 0.12} stroke={sel ? 'var(--sel)' : st.stroke} strokeWidth={sel ? 2 : z.kind === 'stage' ? 1.6 : 1} strokeDasharray={z.kind === 'stage' ? undefined : '6 4'} {...NS} />
      <text x={z.x + 5 / k} y={z.y + 14 / k} fontSize={fs} fill={st.stroke} fontWeight={700} className="plan-zone-label" style={{ textTransform: 'uppercase', letterSpacing: 0.4 / k }}>
        {z.name}
        {z.elev > 0 ? ` · +${fmtM(z.elev, lang)} m` : ''}
        {target ? ` · ${t('cov.targetShort', { d: target })}` : ''}
      </text>
      {k > 30 ? (
        <text x={z.x + 5 / k} y={z.y + 14 / k + fs * 1.25} fontSize={fs * 0.82} fill={st.stroke} opacity={0.8} className="plan-zone-label">
          {fmtM(z.w, lang)} × {fmtM(z.d, lang)} m{z.kind === 'walkway' ? ' — ' + t('plan.keepClear') : ''}
        </text>
      ) : null}
    </g>
  );
});

export const PlanItem = memo(function PlanItem({ it, def, img, k, sel, labels, model, hover, ghost, badge, faded }: { it: Item; def: EquipDef; img?: string; k: number; sel: boolean; labels: boolean; model?: boolean; hover?: boolean; ghost?: boolean; badge?: string; faded?: boolean }) {
  const { w, d } = itemDims(it, def);
  const col = def.color && def.custom ? def.color : catColor(def);
  const minS = 12 / k;
  const W = Math.max(w, minS);
  const D = Math.max(d, minS);
  const circle = def.plan === 'circle';
  const iconS = Math.max(Math.min(W, D) * 0.8, 18 / k);
  const directional = !!def.acoustic || ['dj', 'mikser', 'islem', 'video', 'isik', 'enstruman'].includes(def.cat);
  const R = Math.max(W, D) / 2;
  return (
    <g data-kind={ghost ? undefined : 'item'} data-id={it.id} data-label={it.label} transform={`translate(${it.x} ${it.y})`} style={{ cursor: it.locked ? 'default' : 'move', opacity: ghost ? 0.55 : faded ? 0.3 : 1, pointerEvents: ghost ? 'none' : undefined }}>
      <g transform={`rotate(${it.rot})`}>
        {circle ? (
          <circle r={R} fill={col} fillOpacity={0.1} stroke={sel ? 'var(--sel)' : hover ? col : col} strokeOpacity={sel ? 1 : 0.85} strokeWidth={sel ? 2.2 : 1.3} {...NS} />
        ) : (
          <rect x={-W / 2} y={-D / 2} width={W} height={D} rx={Math.min(W, D) * 0.08} fill={col} fillOpacity={0.1} stroke={sel ? 'var(--sel)' : col} strokeOpacity={sel ? 1 : 0.85} strokeWidth={sel ? 2.2 : 1.3} {...NS} />
        )}
        {directional && !circle ? <line x1={-W / 2} y1={D / 2} x2={W / 2} y2={D / 2} stroke={col} strokeWidth={3.2} strokeLinecap="round" {...NS} /> : null}
        {directional ? <path d={`M ${-4 / k} ${D / 2 + 3 / k} L 0 ${D / 2 + 8 / k} L ${4 / k} ${D / 2 + 3 / k}`} fill={col} /> : null}
      </g>
      {img ? (
        <image href={img} x={-iconS / 2} y={-iconS / 2} width={iconS} height={iconS} preserveAspectRatio="xMidYMid meet" style={{ pointerEvents: 'none' }} />
      ) : (
        <g transform={`translate(${-iconS / 2} ${-iconS / 2}) scale(${iconS / 32})`} stroke={col} fill="none" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" style={{ color: col, pointerEvents: 'none' }} dangerouslySetInnerHTML={{ __html: iconMarkup(def.icon) }} />
      )}
      {it.locked ? <circle cx={R * 0.85} cy={-R * 0.85} r={4 / k} fill="var(--muted)" /> : null}
      {badge ? (
        <g transform={`translate(${-R * 0.9} ${-R * 0.9})`} style={{ pointerEvents: 'none' }}>
          <circle r={7 / k} fill={faded ? 'var(--warn)' : 'var(--ok)'} />
          <text y={3.4 / k} fontSize={9.5 / k} textAnchor="middle" fill="#fff" fontWeight={800}>
            {badge}
          </text>
        </g>
      ) : null}
      {labels ? (
        <text y={R + 12 / k} fontSize={11 / k} textAnchor="middle" fontWeight={700} className="plan-label">
          {it.label}
        </text>
      ) : null}
      {labels && model ? (
        <text y={R + 24 / k} fontSize={9.5 / k} textAnchor="middle" className="plan-label sub">
          {[def.brand, def.model].filter(Boolean).join(' ') || it.name || ''}
        </text>
      ) : null}
    </g>
  );
});

const PlanCable = memo(function PlanCable({ inf, k, sel, tags, hover }: { inf: CableInfo; k: number; sel: boolean; tags: boolean; hover: boolean }) {
  const pts = inf.path!;
  const d = 'M ' + pts.map((q) => `${q.x} ${q.y}`).join(' L ');
  const col = cableColor(inf);
  const dash = inf.type.wireless ? '6 5' : undefined;
  const m = polyMid(pts);
  const bad = inf.issues.some((x) => x !== 'chk.cableCrossArea' && x !== 'chk.cableNoLen');
  const full = inf.cable.label + ` · ${inf.type.short}${inf.type.wireless ? '' : ' ' + fmtLen(inf.len)}`;
  const screenLen = polyLen(pts) * k;
  const label = screenLen > full.length * 5.6 + 40 || sel || hover ? full : inf.cable.label;
  const showTag = sel || hover || screenLen > label.length * 5.6 + 26;
  const fs = 9.5 / k;
  const tw = label.length * 5.6 / k + 10 / k;
  const isPower = inf.type.domain === 'power';
  return (
    <g data-kind="cable" data-id={inf.cable.id} style={{ cursor: 'pointer' }}>
      <path d={d} fill="none" stroke="transparent" strokeWidth={12} {...NS} />
      {sel || hover ? <path d={d} fill="none" stroke={col} strokeOpacity={0.25} strokeWidth={8} strokeLinejoin="round" {...NS} /> : null}
      <path d={d} fill="none" stroke={col} strokeWidth={sel ? 2.6 : isPower ? 1.3 : 1.7} strokeOpacity={sel || hover ? 1 : isPower ? 0.7 : 0.95} strokeDasharray={dash} strokeLinejoin="round" strokeLinecap="round" {...NS} />
      {tags && k > 12 && showTag ? (
        <g transform={`translate(${m.p.x} ${m.p.y})`}>
          <rect x={-tw / 2} y={-8 / k} width={tw} height={16 / k} rx={4 / k} fill="var(--panel)" stroke={bad ? 'var(--warn)' : col} strokeWidth={sel ? 2 : 1.2} {...NS} />
          <text y={3.5 / k} fontSize={fs} textAnchor="middle" fill={col} fontWeight={600} style={{ fontFamily: 'var(--mono)' }}>
            {label}
          </text>
        </g>
      ) : null}
    </g>
  );
});

function fmtLen(v: number): string {
  return (v % 1 ? v.toFixed(1) : String(v)) + 'm';
}

function CrossCable({ inf, p, areaId, k, sel }: { inf: CableInfo; p: Project; areaId: string; k: number; sel: boolean }) {
  const here = inf.a?.areaId === areaId ? inf.a! : inf.b!;
  const other = here === inf.a ? inf.b! : inf.a!;
  const otherArea = p.areas.find((a) => a.id === other.areaId);
  const col = cableColor(inf);
  const x2 = here.x - 1.2;
  const y2 = here.y - 0.6;
  const label = `→ ${otherArea?.name || '?'} · ${other.label} (${inf.cable.label})`;
  const tw = label.length * 5.6 / k + 10 / k;
  return (
    <g data-kind="cable" data-id={inf.cable.id} style={{ cursor: 'pointer' }}>
      <path d={`M ${here.x} ${here.y} L ${x2} ${y2}`} stroke={col} strokeWidth={sel ? 2.6 : 1.7} strokeDasharray="4 3" markerEnd="url(#arrow-end)" {...NS} />
      <g transform={`translate(${x2} ${y2 - 10 / k})`}>
        <rect x={-tw} y={-8 / k} width={tw} height={16 / k} rx={8 / k} fill={col} />
        <text x={-tw / 2} y={3.5 / k} fontSize={9.5 / k} textAnchor="middle" fill="#fff" fontWeight={600}>
          {label}
        </text>
      </g>
    </g>
  );
}

function Coverage({ p, area, items, k, sel }: { p: Project; area: Area; items: Item[]; k: number; sel: Set<string> }) {
  const srcs = sourcesOf(p, area.id);
  const target = p.settings.targetSpl;
  const seen = new Set<string>();
  return (
    <g style={{ pointerEvents: 'none' }}>
      {srcs.map((s, i) => {
        if (seen.has(s.itemId)) return null;
        seen.add(s.itemId);
        const it = items.find((x) => x.id === s.itemId);
        if (!it || it.hidden) return null;
        const def = getDef(p, it.defId);
        const col = catColor(def);
        if (s.kind === 'sub') return null;
        const r = Math.min(40, Math.pow(10, (s.lp1m - (target - 6)) / 20));
        const half = Math.min(179, s.h / 2);
        const a0 = ((it.rot - half) * Math.PI) / 180;
        const a1 = ((it.rot + half) * Math.PI) / 180;
        const P = (a: number, rr: number) => ({ x: it.x - Math.sin(a) * rr, y: it.y + Math.cos(a) * rr });
        const n = 24;
        const arc = Array.from({ length: n + 1 }, (_, j) => P(a0 + ((a1 - a0) * j) / n, r));
        const arc6 = Array.from({ length: n + 1 }, (_, j) => P(a0 + ((a1 - a0) * j) / n, r / 2));
        const d = `M ${it.x} ${it.y} ` + arc.map((q) => `L ${q.x} ${q.y}`).join(' ') + ' Z';
        const d6 = `M ${arc6[0].x} ${arc6[0].y} ` + arc6.map((q) => `L ${q.x} ${q.y}`).join(' ');
        const strong = sel.has(it.id);
        return (
          <g key={i}>
            <path d={d} fill={col} fillOpacity={strong ? 0.14 : 0.07} stroke={col} strokeOpacity={0.5} strokeDasharray="5 4" strokeWidth={1} {...NS} />
            <path d={d6} fill="none" stroke={col} strokeOpacity={0.35} strokeWidth={1} strokeDasharray="2 4" {...NS} />
            {strong ? (
              <text x={arc[n / 2].x} y={arc[n / 2].y} fontSize={10 / k} fill={col} textAnchor="middle" className="plan-label">
                {Math.round(target - 6)} dB
              </text>
            ) : null}
          </g>
        );
      })}
    </g>
  );
}

function PlanNote({ n, k, sel, lang }: { n: Note; k: number; sel: boolean; lang: Lang }) {
  const col = n.color || (sel ? 'var(--sel)' : 'var(--text)');
  if (n.kind === 'text') {
    const fs = Math.max(0.28, 12 / k);
    return (
      <g data-kind="note" data-id={n.id} style={{ cursor: 'move' }}>
        <text x={n.x} y={n.y} fontSize={fs} fill={col} fontWeight={600} className="plan-label">
          {(n.text || '…').split('\n').map((l, i) => (
            <tspan key={i} x={n.x} dy={i ? fs * 1.2 : 0}>
              {l}
            </tspan>
          ))}
        </text>
      </g>
    );
  }
  const x2 = n.x2 ?? n.x + 1;
  const y2 = n.y2 ?? n.y;
  const len = Math.hypot(x2 - n.x, y2 - n.y);
  const ang = (Math.atan2(y2 - n.y, x2 - n.x) * 180) / Math.PI;
  const mx = (n.x + x2) / 2;
  const my = (n.y + y2) / 2;
  const flip = ang > 90 || ang < -90;
  const tick = 6 / k;
  const nx = (-(y2 - n.y) / (len || 1)) * tick;
  const ny = ((x2 - n.x) / (len || 1)) * tick;
  return (
    <g data-kind="note" data-id={n.id} style={{ cursor: 'move' }}>
      <line x1={n.x} y1={n.y} x2={x2} y2={y2} stroke="transparent" strokeWidth={10} {...NS} />
      <line x1={n.x} y1={n.y} x2={x2} y2={y2} stroke={n.kind === 'dim' ? (sel ? 'var(--sel)' : '#0891b2') : col} strokeWidth={sel ? 2 : 1.3} markerEnd={n.kind === 'arrow' ? 'url(#arrow-end)' : undefined} {...NS} />
      {n.kind === 'dim' ? (
        <>
          <line x1={n.x - nx} y1={n.y - ny} x2={n.x + nx} y2={n.y + ny} stroke="#0891b2" strokeWidth={1.3} {...NS} />
          <line x1={x2 - nx} y1={y2 - ny} x2={x2 + nx} y2={y2 + ny} stroke="#0891b2" strokeWidth={1.3} {...NS} />
          <text x={mx} y={my} dy={-4 / k} fontSize={11 / k} textAnchor="middle" fill="#0891b2" fontWeight={700} transform={`rotate(${flip ? ang + 180 : ang} ${mx} ${my})`} className="plan-label">
            {fmtM(len, lang)} m{n.text ? ` · ${n.text}` : ''}
          </text>
        </>
      ) : n.text ? (
        <text x={n.x} y={n.y} dy={-6 / k} fontSize={11 / k} fill={col} fontWeight={600} className="plan-label">
          {n.text}
        </text>
      ) : null}
      {sel ? (
        <>
          <circle data-kind="note-pt" data-id={n.id} data-i={1} cx={n.x} cy={n.y} r={5 / k} fill="var(--panel)" stroke="var(--sel)" strokeWidth={1.5} {...NS} style={{ cursor: 'crosshair' }} />
          <circle data-kind="note-pt" data-id={n.id} data-i={2} cx={x2} cy={y2} r={5 / k} fill="var(--panel)" stroke="var(--sel)" strokeWidth={1.5} {...NS} style={{ cursor: 'crosshair' }} />
        </>
      ) : null}
    </g>
  );
}

function SelectionExtras({ it, def, area, k, lang, z }: { it: Item; def: EquipDef; area: Area; k: number; lang: Lang; single: boolean; z: number }) {
  const { w, d } = itemDims(it, def);
  const R = Math.max(w, d, 12 / k) / 2;
  const h = localToPlan(it, 0, R + 22 / k);
  const near = it.x <= area.w - it.x ? { x: 0, v: it.x } : { x: area.w, v: area.w - it.x };
  const nearY = it.y <= area.d - it.y ? { y: 0, v: it.y } : { y: area.d, v: area.d - it.y };
  const fs = 10.5 / k;
  return (
    <g>
      {/* duvarlara mesafe */}
      <g stroke="#0891b2" fill="#0891b2" style={{ pointerEvents: 'none' }}>
        <line x1={near.x} y1={it.y} x2={it.x} y2={it.y} strokeWidth={1} strokeDasharray="3 3" {...NS} />
        <line x1={it.x} y1={nearY.y} x2={it.x} y2={it.y} strokeWidth={1} strokeDasharray="3 3" {...NS} />
        <text x={(near.x + it.x) / 2} y={it.y - 4 / k} fontSize={fs} textAnchor="middle" stroke="none" fontWeight={700} className="plan-label">
          {fmtM(near.v, lang)} m
        </text>
        <text x={it.x + 4 / k} y={(nearY.y + it.y) / 2} fontSize={fs} stroke="none" fontWeight={700} className="plan-label">
          {fmtM(nearY.v, lang)} m
        </text>
        {z > 0.02 ? (
          <text x={it.x + R + 6 / k} y={it.y - R} fontSize={fs} stroke="none" fontWeight={700} className="plan-label">
            ↑ {fmtM(z, lang)} m
          </text>
        ) : null}
      </g>
      {/* döndürme tutamağı */}
      {!it.locked ? (
        <g data-kind="rot" data-id={it.id} style={{ cursor: 'grab' }}>
          <line x1={it.x} y1={it.y} x2={h.x} y2={h.y} stroke="var(--sel)" strokeWidth={1} strokeDasharray="3 2" {...NS} style={{ pointerEvents: 'none' }} />
          <circle cx={h.x} cy={h.y} r={6 / k} fill="var(--panel)" stroke="var(--sel)" strokeWidth={2} {...NS} />
          <circle cx={h.x} cy={h.y} r={2 / k} fill="var(--sel)" style={{ pointerEvents: 'none' }} />
        </g>
      ) : null}
    </g>
  );
}

function ZoneHandles({ z, k }: { z?: Zone; k: number }) {
  if (!z) return null;
  const s = 7 / k;
  const hs: [string, number, number, string][] = [
    ['nw', z.x, z.y, 'nwse-resize'],
    ['ne', z.x + z.w, z.y, 'nesw-resize'],
    ['sw', z.x, z.y + z.d, 'nesw-resize'],
    ['se', z.x + z.w, z.y + z.d, 'nwse-resize'],
  ];
  return (
    <g>
      {hs.map(([h, x, y, cur]) => (
        <rect key={h} data-kind="zone-h" data-id={z.id} data-h={h} x={x - s / 2} y={y - s / 2} width={s} height={s} fill="var(--panel)" stroke="var(--sel)" strokeWidth={1.5} {...NS} style={{ cursor: cur }} />
      ))}
    </g>
  );
}

function CableHandles({ inf, k }: { inf?: CableInfo; k: number }) {
  if (!inf?.path) return null;
  return (
    <g>
      {inf.cable.pts.map((q, i) => (
        <circle key={i} data-kind="cable-pt" data-id={inf.cable.id} data-i={i} cx={q.x} cy={q.y} r={5 / k} fill="var(--panel)" stroke="var(--sel)" strokeWidth={2} {...NS} style={{ cursor: 'move' }} />
      ))}
    </g>
  );
}

// —— Isı haritası görüntüsü ——
const heatCache = new WeakMap<SplGrid, Map<string, string>>();
function useHeatImage(g: SplGrid | null, target: number, tg: Float32Array | null): string | null {
  return useMemo(() => {
    if (!g) return null;
    let m = heatCache.get(g);
    if (!m) {
      m = new Map();
      heatCache.set(g, m);
    }
    const key = tg ? 'dev' : String(target);
    const hit = m.get(key);
    if (hit) return hit;
    const c = document.createElement('canvas');
    c.width = g.nx;
    c.height = g.ny;
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    const img = ctx.createImageData(g.nx, g.ny);
    for (let i = 0; i < g.data.length; i++) {
      let col: [number, number, number, number];
      if (tg) {
        col = isNaN(tg[i]) ? (isNaN(g.data[i]) ? [0, 0, 0, 0] : [148, 163, 184, 40]) : devColor(g.data[i] - tg[i]);
      } else col = splColor(g.data[i], target);
      img.data[i * 4] = col[0];
      img.data[i * 4 + 1] = col[1];
      img.data[i * 4 + 2] = col[2];
      img.data[i * 4 + 3] = col[3];
    }
    ctx.putImageData(img, 0, 0);
    const url = c.toDataURL();
    m.set(key, url);
    return url;
  }, [g, target, tg]);
}

// —— Ölçüm noktaları ——
function MeasurePoints({ p, areaId, k, lang }: { p: Project; areaId: string; k: number; lang: Lang }) {
  const ms = (p.measurements || []).filter((m) => m.areaId === areaId && !m.hidden && m.x != null && m.y != null);
  const r = 7 / k;
  return (
    <g className="plan-overlay" style={{ pointerEvents: 'none' }}>
      {ms.map((m, i) => (
        <g key={m.id} transform={`translate(${m.x} ${m.y})`}>
          <circle r={r} fill="#7c3aed" stroke="#fff" strokeWidth={1.5} {...NS} />
          <path d={`M ${-r * 0.45} 0 H ${r * 0.45} M 0 ${-r * 0.45} V ${r * 0.45}`} stroke="#fff" strokeWidth={1.4} {...NS} />
          <text x={r * 1.4} y={-r * 0.2} fontSize={11 / k} fontWeight={700} fill="#6d28d9" className="plan-label">
            {i + 1}. {fmtM(m.spl.a, lang, 0)} dB(A)
          </text>
          <text x={r * 1.4} y={r * 1.2} fontSize={9.5 / k} fill="#6d28d9" className="plan-label">
            {m.name}
          </text>
        </g>
      ))}
    </g>
  );
}

// —— Öneri hayaletleri ——
function Ghosts({ p, area, ghosts, k }: { p: Project; area: Area; ghosts: Proposal[]; k: number }) {
  return (
    <g className="plan-overlay" style={{ pointerEvents: 'none' }}>
      {ghosts.map((g) => (
        <g key={g.id}>
          {g.add.map((s, i) => {
            const def = getDef(p, s.defId);
            const it: Item = { id: g.id + i, defId: s.defId, areaId: area.id, label: s.prefix, x: s.x, y: s.y, z: s.z, rot: s.rot, tilt: s.tilt, mount: 'stand', role: s.role };
            const r = (s.rot * Math.PI) / 180;
            const L = 3.5;
            return (
              <g key={i}>
                <line x1={s.x} y1={s.y} x2={s.x - Math.sin(r) * L} y2={s.y + Math.cos(r) * L} stroke="#16a34a" strokeWidth={1.6} strokeDasharray="5 4" {...NS} />
                <circle cx={s.x} cy={s.y} r={Math.max(def.w, 16 / k)} fill="rgba(22,163,74,0.12)" stroke="#16a34a" strokeWidth={1.6} strokeDasharray="4 3" {...NS} />
                <PlanItem it={it} def={def} k={k} sel={false} labels={false} ghost />
                <text x={s.x + 14 / k} y={s.y - 10 / k} fontSize={11 / k} fontWeight={800} fill="#15803d" className="plan-label">
                  + {s.prefix} · {s.delayMs.toFixed(1)} ms
                </text>
              </g>
            );
          })}
          {g.change.map((c) => {
            const it0 = p.items.find((x) => x.id === c.itemId);
            if (!it0) return null;
            const it = { ...it0, ...c.patch } as Item;
            const r = (it.rot * Math.PI) / 180;
            return (
              <g key={c.itemId}>
                <line x1={it.x} y1={it.y} x2={it.x - Math.sin(r) * 5} y2={it.y + Math.cos(r) * 5} stroke="#d97706" strokeWidth={1.8} strokeDasharray="6 4" {...NS} />
                <PlanItem it={it} def={getDef(p, it.defId)} k={k} sel={false} labels={false} ghost />
              </g>
            );
          })}
        </g>
      ))}
    </g>
  );
}
