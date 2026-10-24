import { DOMAINS } from '../catalog/connectors';
import { fmt, L, type TFn } from '../i18n';
import { getDef, itemDims, localToPlan, portLabel, portsOf } from '../model/project';
import type { Item, Lang, Project } from '../model/types';
import { analyzeCables, type CableInfo } from './cables';
import { analyzePower } from './power';
import { activeView } from '../model/variants';

export function itemTitle(p: Project, it: Item, lang: Lang): string {
  const d = getDef(p, it.defId);
  return it.name || [d.brand, d.model].filter(Boolean).join(' ') || L(d.name, lang);
}

// —— Input / patch listesi ——
export interface PatchRow {
  dest: string; // mikser / stagebox etiketi
  destId: string;
  ch: number;
  port: string;
  source: string;
  sourceId: string;
  channel: string;
  model: string;
  stand: string;
  phantom: boolean;
  cable: string;
}

export function patchList(p: Project, lang: Lang): PatchRow[] {
  const pv = activeView(p);
  if (pv !== p) return patchList(pv, lang);
  const ci = analyzeCables(p);
  const rows: PatchRow[] = [];
  for (const inf of ci.values()) {
    if (!inf.a || !inf.b || !inf.portA || !inf.portB || !inf.defB || !inf.defA) continue;
    if (inf.type.domain !== 'audio') continue;
    const dcat = inf.defB.cat;
    const isDesk = dcat === 'mikser' || inf.defB.icon === 'djmixer' || inf.defB.icon === 'djcontroller';
    if (!isDesk || inf.portB.group.dir === 'out') continue;
    const src = inf.a;
    const sdef = inf.defA;
    let chName = inf.cable.channel || src.channel || '';
    if (!chName && sdef.icon === 'receiver') {
      // alıcı çıkışı n → n. kablosuz kanaldaki verici
      const rfPort = portsOf(sdef).filter((x) => x.group.domain === 'wireless')[inf.portA.index];
      const rfc = rfPort && [...ci.values()].find((x) => (x.cable.b.item === src.id && x.cable.b.port === rfPort.id) || (x.cable.a.item === src.id && x.cable.a.port === rfPort.id));
      const tx = rfc ? (rfc.a?.id === src.id ? rfc.b : rfc.a) : undefined;
      if (tx) chName = tx.channel || tx.label;
    }
    if (!chName) {
      const outsN = portsOf(sdef).filter((x) => x.group.dir !== 'in' && x.group.domain === 'audio').length;
      chName = outsN > 1 ? `${itemTitle(p, src, lang)} · ${portLabel(inf.portA, lang)}` : itemTitle(p, src, lang);
    }
    rows.push({
      dest: inf.b.label,
      destId: inf.b.id,
      ch: portsOf(inf.defB).filter((x) => x.group.dir !== 'out' && x.group.domain === 'audio').findIndex((x) => x.id === inf.portB!.id) + 1,
      port: portLabel(inf.portB, lang),
      source: src.label,
      sourceId: src.id,
      channel: chName,
      model: [sdef.brand, sdef.model].filter(Boolean).join(' ') || L(sdef.name, lang),
      stand: src.stand && src.stand !== 'none' ? src.stand : '',
      phantom: !!src.phantom,
      cable: inf.cable.label,
    });
  }
  rows.sort((a, b) => a.dest.localeCompare(b.dest) || a.ch - b.ch);
  return rows;
}

// —— CSV ——
export function toCSV(rows: (string | number | boolean | undefined)[][]): string {
  const esc = (v: string | number | boolean | undefined) => {
    const s = v == null ? '' : String(v);
    return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return '﻿' + rows.map((r) => r.map(esc).join(';')).join('\r\n');
}

export function cableRows(p: Project, t: TFn, lang: Lang): (string | number)[][] {
  const pv = activeView(p);
  if (pv !== p) return cableRows(pv, t, lang);
  const ci = analyzeCables(p);
  const head = [t('col.label'), t('col.type'), t('col.domain'), t('col.length'), t('col.from'), t('col.fromPort'), t('col.to'), t('col.toPort'), t('col.channel'), t('col.notes')];
  const rows: (string | number)[][] = [head];
  const list = [...ci.values()].sort((a, b) => a.cable.label.localeCompare(b.cable.label));
  for (const inf of list) rows.push(cableRow(inf, lang));
  return rows;
}

export function cableRow(inf: CableInfo, lang: Lang): (string | number)[] {
  return [
    inf.cable.label,
    L(inf.type.name, lang),
    L(DOMAINS[inf.type.domain].name, lang),
    inf.type.wireless ? '' : fmt(inf.len, inf.len % 1 ? 1 : 0, lang),
    inf.a?.label || '?',
    inf.portA ? portLabel(inf.portA, lang) : '?',
    inf.b?.label || '?',
    inf.portB ? portLabel(inf.portB, lang) : '?',
    inf.cable.channel || '',
    inf.cable.notes || '',
  ];
}

export function powerRows(p: Project, t: TFn, lang: Lang): (string | number)[][] {
  const pv = activeView(p);
  if (pv !== p) return powerRows(pv, t, lang);
  const pw = analyzePower(p);
  const rows: (string | number)[][] = [[t('col.circuit'), t('col.phase'), t('col.load'), t('col.current'), t('col.breaker'), t('col.usage')]];
  for (const c of pw.circuits) rows.push([c.label, c.phase || '', Math.round(c.loadW), fmt(c.amps, 1, lang), c.breakerA, Math.round(c.pct * 100) + ' %']);
  return rows;
}

// —— DXF (AutoCAD) ——
const DXF_LAYERS: Record<string, number> = {
  SALON: 7,
  BOLGE: 8,
  MALZEME: 5,
  ETIKET: 7,
  KABLO_audio: 5,
  KABLO_speaker: 30,
  KABLO_digital: 4,
  KABLO_network: 3,
  KABLO_dmx: 6,
  KABLO_video: 210,
  KABLO_power: 1,
  KABLO_wireless: 8,
  KABLO_data: 2,
  NOT: 2,
};

export function toDXF(p: Project, areaId: string, lang: Lang): string {
  const pv = activeView(p);
  if (pv !== p) return toDXF(pv, areaId, lang);
  const area = p.areas.find((a) => a.id === areaId) || p.areas[0];
  const o: string[] = [];
  const g = (code: number, v: string | number) => o.push(String(code), typeof v === 'number' ? v.toFixed(4) : v);
  const Y = (y: number) => -y;
  g(0, 'SECTION');
  g(2, 'HEADER');
  g(9, '$ACADVER');
  g(1, 'AC1009');
  g(9, '$INSUNITS');
  o.push('70', '6');
  g(0, 'ENDSEC');
  g(0, 'SECTION');
  g(2, 'TABLES');
  g(0, 'TABLE');
  g(2, 'LAYER');
  o.push('70', String(Object.keys(DXF_LAYERS).length));
  for (const [name, color] of Object.entries(DXF_LAYERS)) {
    g(0, 'LAYER');
    g(2, name);
    o.push('70', '0', '62', String(color));
    g(6, 'CONTINUOUS');
  }
  g(0, 'ENDTAB');
  g(0, 'ENDSEC');
  g(0, 'SECTION');
  g(2, 'ENTITIES');
  const line = (layer: string, x1: number, y1: number, x2: number, y2: number) => {
    g(0, 'LINE');
    g(8, layer);
    g(10, x1);
    g(20, Y(y1));
    g(11, x2);
    g(21, Y(y2));
  };
  const poly = (layer: string, pts: { x: number; y: number }[], closed: boolean) => {
    g(0, 'POLYLINE');
    g(8, layer);
    o.push('66', '1', '70', closed ? '1' : '0');
    for (const q of pts) {
      g(0, 'VERTEX');
      g(8, layer);
      g(10, q.x);
      g(20, Y(q.y));
    }
    g(0, 'SEQEND');
  };
  const text = (layer: string, x: number, y: number, h: number, s: string, rot = 0) => {
    g(0, 'TEXT');
    g(8, layer);
    g(10, x);
    g(20, Y(y));
    g(40, h);
    g(1, s.replace(/[\r\n]/g, ' '));
    if (rot) g(50, rot);
  };
  const circle = (layer: string, x: number, y: number, r: number) => {
    g(0, 'CIRCLE');
    g(8, layer);
    g(10, x);
    g(20, Y(y));
    g(40, r);
  };
  // salon
  poly('SALON', [{ x: 0, y: 0 }, { x: area.w, y: 0 }, { x: area.w, y: area.d }, { x: 0, y: area.d }], true);
  text('SALON', 0, -0.6, 0.35, `${area.name} ${fmt(area.w, 2, lang)} x ${fmt(area.d, 2, lang)} m`);
  for (const z of p.zones.filter((z) => z.areaId === area.id)) {
    poly('BOLGE', [{ x: z.x, y: z.y }, { x: z.x + z.w, y: z.y }, { x: z.x + z.w, y: z.y + z.d }, { x: z.x, y: z.y + z.d }], true);
    text('BOLGE', z.x + 0.1, z.y + 0.4, 0.25, z.name);
  }
  for (const it of p.items.filter((i) => i.areaId === area.id && !i.hidden)) {
    const d = getDef(p, it.defId);
    const dm = itemDims(it, d);
    if (d.plan === 'circle') circle('MALZEME', it.x, it.y, Math.max(dm.w, dm.d) / 2);
    else {
      const c = [
        localToPlan(it, -dm.w / 2, -dm.d / 2),
        localToPlan(it, dm.w / 2, -dm.d / 2),
        localToPlan(it, dm.w / 2, dm.d / 2),
        localToPlan(it, -dm.w / 2, dm.d / 2),
      ];
      poly('MALZEME', c, true);
      if (d.acoustic) {
        const f = localToPlan(it, 0, dm.d / 2 + 0.4);
        line('MALZEME', it.x, it.y, f.x, f.y);
      }
    }
    text('ETIKET', it.x + Math.max(dm.w, 0.3) / 2 + 0.05, it.y, 0.18, `${it.label} ${itemTitle(p, it, lang)}`);
  }
  const ci = analyzeCables(p);
  for (const inf of ci.values()) {
    if (!inf.path || inf.a?.areaId !== area.id) continue;
    const layer = 'KABLO_' + inf.type.domain;
    poly(layer, inf.path, false);
    const m = inf.path[Math.floor(inf.path.length / 2)];
    text(layer, m.x + 0.05, m.y - 0.05, 0.14, `${inf.cable.label} ${inf.type.short}${inf.type.wireless ? '' : ' ' + inf.len + 'm'}`);
  }
  for (const n of p.notes.filter((x) => x.areaId === area.id)) {
    if (n.kind === 'text') text('NOT', n.x, n.y, 0.25, n.text);
    else if (n.x2 != null && n.y2 != null) {
      line('NOT', n.x, n.y, n.x2, n.y2);
      if (n.kind === 'dim') text('NOT', (n.x + n.x2) / 2, (n.y + n.y2) / 2 - 0.1, 0.2, fmt(Math.hypot(n.x2 - n.x, n.y2 - n.y), 2, lang) + ' m');
    }
  }
  g(0, 'ENDSEC');
  g(0, 'EOF');
  return o.join('\r\n');
}

export function powerTreeOrder(p: Project): string[] {
  const pv = activeView(p);
  if (pv !== p) return powerTreeOrder(pv);
  const pw = analyzePower(p);
  const out: string[] = [];
  const walk = (id: string, depth: number) => {
    if (depth > 40 || out.includes(id)) return;
    out.push(id);
    for (const ch of pw.nodes.get(id)?.children || []) walk(ch.item, depth + 1);
  };
  for (const r of pw.roots) walk(r, 0);
  return out;
}
