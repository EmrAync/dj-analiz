import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CAT_BY_ID } from '../../catalog/categories';
import { CONNECTORS, DOMAINS } from '../../catalog/connectors';
import { iconMarkup } from '../../catalog/icons';
import { analyzeCables, suggestCableTypes, type CableInfo } from '../../engine/cables';
import { analyzePower } from '../../engine/power';
import { fmt, L } from '../../i18n';
import { getDef, portLabel, portsOf } from '../../model/project';
import type { EquipDef, Item, Lang, PortInst, Project } from '../../model/types';
import { connect, updateItems } from '../../store/actions';
import { st, useStore, useT } from '../../store/store';
import { Icon, Seg, useSize } from '../../ui/kit';
import { itemImage, itemVisible } from '../common';
import { isOff, variantMap } from '../../model/variants';

const BW = 230; // blok genişliği
const HEAD = 40;
const ROW = 17;
const COLW = 300;
const GAPY = 26;

interface Block {
  it: Item;
  def: EquipDef;
  x: number;
  y: number;
  h: number;
  left: PortInst[];
  right: PortInst[];
  hidden: number;
}

const RANK: Record<string, number> = { mikrofon: 0, enstruman: 0, dj: 1, hazirlik: 1, mikser: 2, islem: 3, ag: 3, video: 3, isik: 4, monitor: 4, hoparlor: 5, sub: 5, linearray: 5, elektrik: 0 };

export function SchemaView() {
  const t = useT();
  const p = useStore((s) => s.project);
  const areaId = useStore((s) => s.areaId);
  const mode = useStore((s) => s.schemaMode);
  const sel = useStore((s) => s.sel);
  const lang = useStore((s) => s.lang);
  const layers = useStore((s) => s.layers);
  const installer = useStore((s) => s.installer);
  const [scopeAll, setScopeAll] = useState(false);
  const [allPorts, setAllPorts] = useState(false);
  const [showFree, setShowFree] = useState(false);
  const [wrapRef, size] = useSize<HTMLDivElement>();
  const svgRef = useRef<SVGSVGElement>(null);
  const [cam, setCam] = useState({ tx: 30, ty: 60, k: 0.8 });
  const ci = analyzeCables(p);
  const power = mode === 'power';
  const pw = analyzePower(p);

  const blocks = useMemo(() => layoutBlocks(p, ci, scopeAll ? null : areaId, power, allPorts, layers, showFree), [p, ci, scopeAll, areaId, power, allPorts, layers, showFree]);
  const byId = useMemo(() => new Map(blocks.map((b) => [b.it.id, b])), [blocks]);

  const fit = useCallback(() => {
    if (!blocks.length || !size.w) return;
    const x0 = Math.min(...blocks.map((b) => b.x)) - 40;
    const y0 = Math.min(...blocks.map((b) => b.y)) - 40;
    const x1 = Math.max(...blocks.map((b) => b.x + BW)) + 40;
    const y1 = Math.max(...blocks.map((b) => b.y + b.h)) + 40;
    const k = Math.max(0.15, Math.min(1.4, Math.min(size.w / (x1 - x0), (size.h - 60) / (y1 - y0))));
    setCam({ k, tx: -x0 * k + (size.w - (x1 - x0) * k) / 2, ty: -y0 * k + 50 });
  }, [blocks, size.w, size.h]);
  const fitted = useRef('');
  // görünür blok kümesi değişince yeniden sığdır
  const firstToggle = useRef(true);
  useEffect(() => {
    if (firstToggle.current) {
      firstToggle.current = false;
      return;
    }
    fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showFree, allPorts]);
  useEffect(() => {
    const key = areaId + mode + scopeAll;
    if (size.w && fitted.current !== key) {
      fitted.current = key;
      fit();
    }
  }, [size.w, areaId, mode, scopeAll, fit]);

  // port konumu (dünya)
  const portPos = (b: Block, portId: string): { x: number; y: number; side: 'l' | 'r' } | null => {
    let i = b.left.findIndex((x) => x.id === portId);
    if (i >= 0) return { x: b.x, y: b.y + HEAD + ROW * i + ROW / 2, side: 'l' };
    i = b.right.findIndex((x) => x.id === portId);
    if (i >= 0) return { x: b.x + BW, y: b.y + HEAD + ROW * i + ROW / 2, side: 'r' };
    return { x: b.x + BW / 2, y: b.y + b.h, side: 'r' };
  };

  // —— etkileşim ——
  const drag = useRef<null | { kind: 'pan'; sx: number; sy: number; tx: number; ty: number } | { kind: 'block'; ids: string[]; sx: number; sy: number; orig: Map<string, { x: number; y: number }>; started: boolean } | { kind: 'wire'; item: string; port: string }>(null);
  const [wire, setWire] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const toWorld = (cx: number, cy: number) => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: (cx - r.left - cam.tx) / cam.k, y: (cy - r.top - cam.ty) / cam.k };
  };
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
        const k = Math.max(0.1, Math.min(3, c.k * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0018))));
        return { k, tx: sx - ((sx - c.tx) * k) / c.k, ty: sy - ((sy - c.ty) * k) / c.k };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const onDown = (e: React.PointerEvent) => {
    svgRef.current!.setPointerCapture(e.pointerId);
    const el = (e.target as Element).closest('[data-k]');
    const k = el?.getAttribute('data-k');
    const id = el?.getAttribute('data-id') || '';
    if (k === 'port' && !installer) {
      const port = el!.getAttribute('data-port')!;
      const b = byId.get(id)!;
      const pp = portPos(b, port)!;
      drag.current = { kind: 'wire', item: id, port };
      setWire({ x1: pp.x, y1: pp.y, x2: pp.x, y2: pp.y });
      return;
    }
    if (k === 'block') {
      const s = st();
      if (e.shiftKey) s.select({ items: [id] }, true);
      else if (!s.sel.items.includes(id)) s.select({ items: [id] });
      const ids = st().sel.items.filter((x) => byId.has(x));
      const orig = new Map(ids.map((x) => [x, { x: byId.get(x)!.x, y: byId.get(x)!.y }]));
      if (!installer) drag.current = { kind: 'block', ids, sx: e.clientX, sy: e.clientY, orig, started: false };
      return;
    }
    if (k === 'edge') {
      st().select({ cables: [id] });
      return;
    }
    st().clearSel();
    drag.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, tx: cam.tx, ty: cam.ty };
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    if (d.kind === 'pan') setCam((c) => ({ ...c, tx: d.tx + e.clientX - d.sx, ty: d.ty + e.clientY - d.sy }));
    else if (d.kind === 'wire') {
      const w = toWorld(e.clientX, e.clientY);
      setWire((x) => (x ? { ...x, x2: w.x, y2: w.y } : x));
    } else if (d.kind === 'block') {
      const dx = (e.clientX - d.sx) / cam.k;
      const dy = (e.clientY - d.sy) / cam.k;
      if (!d.started) {
        if (Math.hypot(dx, dy) < 3) return;
        d.started = true;
        st().checkpoint();
      }
      updateItems(
        d.ids,
        (it) => {
          const o = d.orig.get(it.id)!;
          const v = { x: Math.round((o.x + dx) / 10) * 10, y: Math.round((o.y + dy) / 10) * 10 };
          if (power) it.pwr = v;
          else it.sch = v;
        },
        false,
      );
    }
  };
  const onUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    setWire(null);
    if (d?.kind === 'wire') {
      const el = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-k="port"]');
      if (el) {
        const bi = el.getAttribute('data-id')!;
        const bp = el.getAttribute('data-port')!;
        if (bi !== d.item) {
          const pr = st().project;
          const ia = pr.items.find((x) => x.id === d.item);
          const ib = pr.items.find((x) => x.id === bi);
          const pa = ia ? portsOf(getDef(pr, ia.defId)).find((x) => x.id === d.port) : undefined;
          const pb = ib ? portsOf(getDef(pr, ib.defId)).find((x) => x.id === bp) : undefined;
          if (pa && pb && suggestCableTypes(pa, pb)[0].id === 'generic' && pa.group.domain !== pb.group.domain) {
            st().notify(t('toast.incompatible'), 'warn');
          } else {
            const id = connect(d.item, d.port, bi, bp);
            if (id) st().notify(t('toast.connected', { c: st().project.cables.find((c) => c.id === id)?.label || '' }));
          }
        }
      }
    }
  };

  const edges = [...ci.values()].filter((inf) => byId.has(inf.cable.a.item) && byId.has(inf.cable.b.item) && (power ? inf.type.domain === 'power' : inf.type.domain !== 'power') && !inf.cable.hidden && layers.domains[inf.type.domain] !== false && (layers.alts || !isOff(p, inf.cable)));
  // kanal ofsetleri
  const laneOf = new Map<string, number>();
  {
    const cnt = new Map<number, number>();
    for (const e of edges) {
      const a = byId.get(e.cable.a.item)!;
      const col = Math.round(a.x / COLW);
      const n = cnt.get(col) || 0;
      laneOf.set(e.cable.id, n);
      cnt.set(col, n + 1);
    }
  }
  const areasMulti = scopeAll && p.areas.length > 1;
  return (
    <div className="canvas-wrap" ref={wrapRef} data-testid="schema-view">
      <svg ref={svgRef} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onContextMenu={(e) => e.preventDefault()} style={{ background: 'var(--plan-bg)' }}>
        <defs>
          <pattern id="sch-dots" width={20} height={20} patternUnits="userSpaceOnUse">
            <circle cx={1} cy={1} r={1} fill="var(--grid-major)" />
          </pattern>
        </defs>
        <g transform={`translate(${cam.tx} ${cam.ty}) scale(${cam.k})`}>
          <rect x={-5000} y={-5000} width={10000} height={10000} fill="url(#sch-dots)" />
          {areasMulti ? <AreaFrames p={p} blocks={blocks} /> : null}
          {edges.map((inf) => {
            const a = byId.get(inf.cable.a.item)!;
            const b = byId.get(inf.cable.b.item)!;
            const pa = portPos(a, inf.cable.a.port)!;
            const pb = portPos(b, inf.cable.b.port)!;
            const off = isOff(p, inf.cable);
            return <Edge key={inf.cable.id} inf={inf} pa={pa} pb={pb} lane={laneOf.get(inf.cable.id) || 0} sel={sel.cables.includes(inf.cable.id)} power={power} lang={lang} amps={off ? undefined : inf.amps} faded={off} />;
          })}
          {blocks.map((b) => (
            <BlockView key={b.it.id} b={b} p={p} sel={sel.items.includes(b.it.id)} lang={lang} power={power} showArea={areasMulti} pw={pw.nodes.get(b.it.id)} used={ci} t={t} faded={isOff(p, b.it)} badge={b.it.variant ? variantMap(p).get(b.it.variant)?.v.label : undefined} />
          ))}
          {wire ? <path d={`M ${wire.x1} ${wire.y1} C ${wire.x1 + 60} ${wire.y1}, ${wire.x2 - 60} ${wire.y2}, ${wire.x2} ${wire.y2}`} stroke="var(--accent)" strokeWidth={2} fill="none" strokeDasharray="6 4" style={{ pointerEvents: 'none' }} /> : null}
        </g>
      </svg>
      <div className="toolbar no-print">
        <div className="tool-card" style={{ padding: 4 }}>
          <Seg
            value={mode}
            options={[
              { v: 'signal', l: t('schema.signal') },
              { v: 'power', l: t('schema.power') },
            ]}
            onChange={(v) => st().set({ schemaMode: v })}
          />
        </div>
        <div className="tool-card" style={{ padding: 4 }}>
          <Seg
            value={scopeAll ? 'all' : 'area'}
            options={[
              { v: 'area', l: t('schema.thisArea') },
              { v: 'all', l: t('schema.allAreas') },
            ]}
            onChange={(v) => setScopeAll(v === 'all')}
          />
        </div>
        <div className="tool-card">
          {p.variants?.length ? (
            <button className={'ibtn' + (layers.alts ? ' on' : '')} onClick={() => st().set({ layers: { ...layers, alts: !layers.alts } })} title={t('var.showAltsTip')} data-testid="toggle-alts">
              <Icon name="bolt" size={16} />
              <span className="hide-sm">{t('var.showAlts')}</span>
            </button>
          ) : null}
          <button className={'ibtn' + (showFree ? ' on' : '')} onClick={() => setShowFree(!showFree)} title={t('schema.showFree')}>
            <Icon name="eye" size={16} />
            <span className="hide-sm">{t('schema.showFree')}</span>
          </button>
          <button className={'ibtn' + (allPorts ? ' on' : '')} onClick={() => setAllPorts(!allPorts)} title={t('schema.allPorts')}>
            <Icon name="list" size={16} />
            <span className="hide-sm">{t('schema.allPorts')}</span>
          </button>
          {!installer ? (
            <button
              className="ibtn"
              onClick={() => {
                const ids = blocks.map((b) => b.it.id);
                updateItems(ids, (it) => {
                  if (power) delete it.pwr;
                  else delete it.sch;
                });
                setTimeout(fit, 50);
              }}
              title={t('schema.relayout')}
            >
              <Icon name="magic" size={16} />
              <span className="hide-sm">{t('schema.relayout')}</span>
            </button>
          ) : null}
          <button className="ibtn" onClick={fit} title={t('plan.fit')}>
            <Icon name="fit" size={16} />
          </button>
        </div>
      </div>
      {!installer ? (
        <div className="hud no-print" style={{ top: 'auto', bottom: 12, left: 12, transform: 'none' }}>
          {t('schema.hint')}
        </div>
      ) : null}
      {!blocks.length ? (
        <div className="empty" style={{ position: 'absolute', inset: 0 }}>
          <Icon name="schema" size={40} color="var(--faint)" />
          {t('schema.empty')}
        </div>
      ) : null}
    </div>
  );
}

function relevantPorts(def: EquipDef, power: boolean): PortInst[] {
  return portsOf(def).filter((x) => (power ? x.group.domain === 'power' : x.group.domain !== 'power'));
}

function layoutBlocks(p: Project, ci: Map<string, CableInfo>, areaId: string | null, power: boolean, allPorts: boolean, layers: ReturnType<typeof st>['layers'], showFree: boolean): Block[] {
  let items = p.items.filter((it) => (!areaId || it.areaId === areaId) && (layers.alts || !isOff(p, it)) && itemVisible(it, getDef(p, it.defId), layers) && relevantPorts(getDef(p, it.defId), power).length > 0);
  if (!showFree) {
    const linked = new Set<string>();
    for (const inf of ci.values()) {
      if ((inf.type.domain === 'power') !== power) continue;
      if (!layers.alts && isOff(p, inf.cable)) continue;
      linked.add(inf.cable.a.item);
      linked.add(inf.cable.b.item);
    }
    const sel = new Set(st().sel.items);
    const f = items.filter((it) => linked.has(it.id) || sel.has(it.id));
    if (f.length) items = f;
  }
  const ids = new Set(items.map((i) => i.id));
  const used = new Set<string>();
  const edges: [string, string][] = [];
  for (const inf of ci.values()) {
    if (!inf.a || !inf.b || !ids.has(inf.a.id) || !ids.has(inf.b.id)) continue;
    if (!layers.alts && isOff(p, inf.cable)) continue;
    const isPow = inf.type.domain === 'power';
    if (isPow !== power) continue;
    used.add(inf.cable.a.item + '#' + inf.cable.a.port);
    used.add(inf.cable.b.item + '#' + inf.cable.b.port);
    edges.push([inf.cable.a.item, inf.cable.b.item]);
  }
  // seviyeler (en uzun yol)
  const level = new Map<string, number>();
  const connected = new Set(edges.flat());
  for (const it of items) level.set(it.id, connected.has(it.id) ? 0 : RANK[getDef(p, it.defId).cat] ?? 3);
  for (let iter = 0; iter < items.length + 2; iter++) {
    let changed = false;
    for (const [a, b] of edges) {
      const la = level.get(a)!;
      if (level.get(b)! < la + 1 && la + 1 < 30) {
        level.set(b, la + 1);
        changed = true;
      }
    }
    if (!changed) break;
  }
  // bağlı olmayanlar: kategori sırası, bağlı olanların yanında
  if (!power) {
    for (const it of items) if (!connected.has(it.id)) level.set(it.id, RANK[getDef(p, it.defId).cat] ?? 3);
  }
  const cols = new Map<number, Item[]>();
  for (const it of items) {
    const l = level.get(it.id)!;
    const c = cols.get(l);
    if (c) c.push(it);
    else cols.set(l, [it]);
  }
  const blocks: Block[] = [];
  const colKeys = [...cols.keys()].sort((a, b) => a - b);
  colKeys.forEach((lv, ci2) => {
    const list = cols.get(lv)!;
    list.sort((a, b) => (a.areaId === b.areaId ? 0 : a.areaId < b.areaId ? -1 : 1) || (RANK[getDef(p, a.defId).cat] ?? 3) - (RANK[getDef(p, b.defId).cat] ?? 3) || a.label.localeCompare(b.label, undefined, { numeric: true }));
    let y = 0;
    for (const it of list) {
      const def = getDef(p, it.defId);
      const ports = relevantPorts(def, power);
      const show = allPorts || ports.length <= 12 ? ports : ports.filter((x) => used.has(it.id + '#' + x.id));
      const hidden = ports.length - show.length;
      const left = show.filter((x) => x.group.dir === 'in');
      const right = show.filter((x) => x.group.dir !== 'in');
      const h = HEAD + Math.max(1, Math.max(left.length, right.length)) * ROW + (hidden ? 16 : 6);
      const manual = power ? it.pwr : it.sch;
      blocks.push({ it, def, x: manual ? manual.x : ci2 * COLW, y: manual ? manual.y : y, h, left, right, hidden });
      y += h + GAPY;
    }
  });
  return blocks;
}

function BlockView({ b, p, sel, lang, power, showArea, pw, used, t, faded, badge }: { b: Block; p: Project; sel: boolean; lang: Lang; power: boolean; showArea: boolean; pw?: { ownW: number; downW: number; phase?: string; children?: unknown[] }; used: Map<string, CableInfo>; t: ReturnType<typeof useT>; faded?: boolean; badge?: string }) {
  const col = CAT_BY_ID[b.def.cat]?.color || '#64748b';
  const img = itemImage(p, b.it, b.def);
  const title = [b.def.brand, b.def.model].filter(Boolean).join(' ') || b.it.name || L(b.def.name, lang);
  const area = showArea ? p.areas.find((a) => a.id === b.it.areaId)?.name : null;
  const isUsed = (pi: PortInst) => {
    for (const inf of used.values()) if (!isOff(p, inf.cable) && (inf.cable.a.item === b.it.id && inf.cable.a.port === pi.id) || (inf.cable.b.item === b.it.id && inf.cable.b.port === pi.id)) return true;
    return false;
  };
  const rows = Math.max(b.left.length, b.right.length);
  return (
    <g transform={`translate(${b.x} ${b.y})`} opacity={faded ? 0.35 : 1}>
      <g data-k="block" data-id={b.it.id} style={{ cursor: 'move' }}>
        <rect width={BW} height={b.h} rx={8} fill="var(--panel)" stroke={sel ? 'var(--sel)' : 'var(--line2)'} strokeWidth={sel ? 2.4 : 1.2} style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,.08))' }} />
        <path d={`M 0 8 a 8 8 0 0 1 8 -8 h ${BW - 16} a 8 8 0 0 1 8 8 v ${HEAD - 8} h ${-BW} z`} fill={col} fillOpacity={0.12} />
        <rect x={0} y={0} width={4} height={b.h} rx={2} fill={col} />
        {img ? (
          <image href={img} x={10} y={6} width={28} height={28} preserveAspectRatio="xMidYMid slice" />
        ) : (
          <g transform="translate(10 6) scale(0.875)" stroke={col} fill="none" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" style={{ color: col }} dangerouslySetInnerHTML={{ __html: iconMarkup(b.def.icon) }} />
        )}
        <text x={44} y={17} fontSize={12.5} fontWeight={700} fill="var(--text)">
          {b.it.label}
          {area ? <tspan fill="var(--muted)" fontWeight={500} fontSize={10}>{`  · ${area}`}</tspan> : null}
        </text>
        <text x={44} y={31} fontSize={10.5} fill="var(--muted)">
          {title.length > 30 ? title.slice(0, 29) + '…' : title}
        </text>
        {power && pw ? (
          <text x={BW - 8} y={17} fontSize={10.5} textAnchor="end" fill="var(--err)" fontWeight={700}>
            {Math.round(pw.children?.length ? pw.downW : pw.ownW)} W{pw.phase ? ` · ${pw.phase}` : ''}
          </text>
        ) : null}
        {badge ? (
          <g transform={`translate(${BW - 4} -4)`}>
            <circle r={10} fill={faded ? 'var(--warn)' : 'var(--ok)'} />
            <text y={4} fontSize={11} textAnchor="middle" fill="#fff" fontWeight={800}>
              {badge}
            </text>
          </g>
        ) : null}
        {Array.from({ length: rows }, (_, i) => (i % 2 ? <rect key={i} x={1} y={HEAD + i * ROW} width={BW - 2} height={ROW} fill="var(--panel2)" /> : null))}
        {b.hidden ? (
          <text x={BW / 2} y={b.h - 5} fontSize={10} textAnchor="middle" fill="var(--faint)">
            {t('schema.morePorts', { n: b.hidden })}
          </text>
        ) : null}
      </g>
      {b.left.map((pi, i) => (
        <PortRow key={pi.id} b={b} pi={pi} i={i} side="l" used={isUsed(pi)} lang={lang} />
      ))}
      {b.right.map((pi, i) => (
        <PortRow key={pi.id} b={b} pi={pi} i={i} side="r" used={isUsed(pi)} lang={lang} />
      ))}
    </g>
  );
}

function PortRow({ b, pi, i, side, used, lang }: { b: Block; pi: PortInst; i: number; side: 'l' | 'r'; used: boolean; lang: Lang }) {
  const y = HEAD + i * ROW + ROW / 2;
  const col = DOMAINS[pi.group.domain].color;
  const x = side === 'l' ? 0 : BW;
  const label = portLabel(pi, lang);
  const conn = CONNECTORS[pi.group.conn].short;
  return (
    <g>
      <text x={side === 'l' ? 10 : BW - 10} y={y + 3.5} fontSize={10} textAnchor={side === 'l' ? 'start' : 'end'} fill="var(--text)" style={{ pointerEvents: 'none' }}>
        {label.length > 22 ? label.slice(0, 21) + '…' : label}
        <tspan fill="var(--faint)" fontSize={9}>{` ${conn}${pi.phase ? ' ' + pi.phase : ''}`}</tspan>
      </text>
      <circle data-k="port" data-id={b.it.id} data-port={pi.id} cx={x} cy={y} r={5.2} fill={used ? col : 'var(--panel)'} stroke={col} strokeWidth={2} style={{ cursor: 'crosshair' }} />
    </g>
  );
}

function Edge({ inf, pa, pb, lane, sel, power, lang, amps, faded }: { inf: CableInfo; pa: { x: number; y: number; side: 'l' | 'r' }; pb: { x: number; y: number; side: 'l' | 'r' }; lane: number; sel: boolean; power: boolean; lang: Lang; amps?: number; faded?: boolean }) {
  const col = inf.cable.color || DOMAINS[inf.type.domain].color;
  let d: string;
  let mx: number;
  let my: number;
  const fwd = pa.side === 'r' && pb.side === 'l' && pb.x > pa.x + 40;
  if (fwd) {
    const xm = pa.x + 26 + (lane % 9) * 11;
    const r = Math.min(8, Math.abs(pb.y - pa.y) / 2);
    const sy = pb.y > pa.y ? 1 : -1;
    d = `M ${pa.x} ${pa.y} H ${xm - r} q ${r} 0 ${r} ${sy * r} V ${pb.y - sy * r} q 0 ${sy * r} ${r} ${sy * r} H ${pb.x}`;
    if (Math.abs(pb.y - pa.y) < 1) d = `M ${pa.x} ${pa.y} H ${pb.x}`;
    mx = xm;
    my = (pa.y + pb.y) / 2;
  } else {
    const o1 = pa.side === 'r' ? 50 : -50;
    const o2 = pb.side === 'l' ? -50 : 50;
    d = `M ${pa.x} ${pa.y} C ${pa.x + o1} ${pa.y}, ${pb.x + o2} ${pb.y}, ${pb.x} ${pb.y}`;
    mx = (pa.x + pb.x) / 2;
    my = (pa.y + pb.y) / 2;
  }
  const plug = inf.type.id === 'plug';
  const label = plug ? inf.type.short : `${inf.cable.label} · ${inf.type.short}${inf.type.wireless ? '' : ' ' + fmt(inf.len, inf.len % 1 ? 1 : 0, lang) + 'm'}${power && amps != null ? ` · ${fmt(amps, 1, lang)} A` : ''}`;
  const tw = label.length * 5.7 + 10;
  const bad = inf.issues.some((x) => x !== 'chk.cableCrossArea' && x !== 'chk.cableNoLen');
  return (
    <g data-k="edge" data-id={inf.cable.id} style={{ cursor: 'pointer' }} opacity={faded ? 0.3 : 1}>
      <path d={d} stroke="transparent" strokeWidth={10} fill="none" />
      {sel ? <path d={d} stroke={col} strokeOpacity={0.25} strokeWidth={7} fill="none" /> : null}
      <path d={d} stroke={col} strokeWidth={sel ? 2.4 : 1.6} fill="none" strokeDasharray={inf.type.wireless || plug ? '6 4' : undefined} />
      <g transform={`translate(${mx} ${my})`}>
        <rect x={-tw / 2} y={-8} width={tw} height={16} rx={4} fill="var(--panel)" stroke={bad ? 'var(--warn)' : col} strokeWidth={sel ? 2 : 1.1} />
        <text y={3.6} fontSize={9.5} textAnchor="middle" fill={col} fontWeight={600} style={{ fontFamily: 'var(--mono)' }}>
          {label}
        </text>
      </g>
    </g>
  );
}

function AreaFrames({ p, blocks }: { p: Project; blocks: Block[] }) {
  const groups = new Map<string, Block[]>();
  for (const b of blocks) {
    const g = groups.get(b.it.areaId);
    if (g) g.push(b);
    else groups.set(b.it.areaId, [b]);
  }
  return (
    <g style={{ pointerEvents: 'none' }}>
      {[...groups].map(([aid, bs]) => {
        const x0 = Math.min(...bs.map((b) => b.x)) - 16;
        const y0 = Math.min(...bs.map((b) => b.y)) - 34;
        const x1 = Math.max(...bs.map((b) => b.x + BW)) + 16;
        const y1 = Math.max(...bs.map((b) => b.y + b.h)) + 16;
        return (
          <g key={aid}>
            <rect x={x0} y={y0} width={x1 - x0} height={y1 - y0} rx={12} fill="var(--accent)" fillOpacity={0.03} stroke="var(--accent)" strokeOpacity={0.35} strokeDasharray="8 5" />
            <text x={x0 + 12} y={y0 + 20} fontSize={13} fontWeight={700} fill="var(--accent)">
              {p.areas.find((a) => a.id === aid)?.name}
            </text>
          </g>
        );
      })}
    </g>
  );
}
