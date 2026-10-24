import type { ConnFamily, Domain, EquipDef, L10n, PortDir, PortGroup } from '../model/types';

// Malzeme kataloğu. Marka/model değerleri yaklaşıktır (üretici föyleriyle kontrol edilmeli);
// kullanıcı her modeli "Özelleştir" ile kopyalayıp düzenleyebilir.

const nm = (tr: string, de: string, en: string): L10n => ({ tr, de, en });

function pg(key: string, name: L10n, conn: ConnFamily, dir: PortDir, domain: Domain, count?: number, names?: string[], extra?: Partial<PortGroup>): PortGroup {
  const g: PortGroup = { key, name, conn, dir, domain };
  if (count && count > 1) g.count = count;
  if (names) g.names = names;
  return extra ? { ...g, ...extra } : g;
}

const N = {
  in: nm('Giriş', 'Eingang', 'Input'),
  link: nm('Link çıkış', 'Link-Ausgang', 'Link out'),
  thru: nm('Çıkış (thru)', 'Ausgang (Thru)', 'Thru out'),
  out: nm('Çıkış', 'Ausgang', 'Output'),
  pwr: nm('Elektrik girişi', 'Netzeingang', 'Mains in'),
  pwrOut: nm('Elektrik link çıkış', 'Netz-Link-Ausgang', 'Mains link out'),
  mic: nm('Mikrofon girişi', 'Mic-Eingang', 'Mic input'),
  line: nm('Line girişi', 'Line-Eingang', 'Line input'),
  main: nm('Ana çıkış', 'Main-Ausgang', 'Main out'),
  aux: nm('Aux çıkış', 'Aux-Ausgang', 'Aux out'),
  booth: nm('Booth çıkış', 'Booth-Ausgang', 'Booth out'),
  dmxIn: nm('DMX giriş', 'DMX-Eingang', 'DMX in'),
  dmxOut: nm('DMX çıkış', 'DMX-Ausgang', 'DMX out'),
  net: nm('Ağ', 'Netzwerk', 'Network'),
  usb: 'USB',
  rf: nm('Kablosuz', 'Funk', 'Wireless'),
  spkOut: nm('Hoparlör çıkışı', 'Lautsprecherausgang', 'Speaker out'),
  ch: nm('Kanal girişi', 'Kanaleingang', 'Channel input'),
  hdmiIn: nm('HDMI giriş', 'HDMI-Eingang', 'HDMI in'),
  hdmiOut: nm('HDMI çıkış', 'HDMI-Ausgang', 'HDMI out'),
  sock: nm('Priz çıkışı', 'Steckdose', 'Socket'),
  pickup: nm('Manyetik/pickup çıkışı', 'Tonabnehmer-Ausgang', 'Pickup out'),
};

const LR = ['L', 'R'];

// ——— Hoparlör üreticileri ———
interface SpkOpt {
  id: string;
  brand?: string;
  model?: string;
  name?: L10n;
  spl: number;
  h: number;
  v: number;
  f: number;
  fHigh?: number;
  ampW: number;
  kg: number;
  dims: [number, number, number];
  pwr?: 'powercon' | 'iec' | 'true1';
  link?: boolean;
  tags?: string[];
}

function pwrPorts(kind: 'powercon' | 'iec' | 'true1' = 'powercon', link = true): PortGroup[] {
  const r = [pg('pwr', N.pwr, kind, 'in', 'power')];
  if (link && kind !== 'iec') r.push(pg('pwrout', N.pwrOut, kind, 'out', 'power'));
  return r;
}

function activeTop(o: SpkOpt): EquipDef {
  const inch = o.dims[1];
  return {
    id: o.id,
    cat: 'hoparlor',
    dept: 'ses',
    name: o.name || nm('Aktif hoparlör', 'Aktivlautsprecher', 'Powered loudspeaker'),
    brand: o.brand,
    model: o.model,
    icon: 'speaker',
    shape: 'speaker',
    w: o.dims[0],
    d: inch,
    h: o.dims[2],
    kg: o.kg,
    watt: Math.round(o.ampW * 0.15),
    wattMax: Math.round(o.ampW * 0.5),
    ports: [pg('in', N.in, 'combo', 'in', 'audio'), pg('link', N.link, 'xlr', 'out', 'audio'), ...pwrPorts(o.pwr, o.link !== false)],
    acoustic: { kind: 'top', maxSpl: o.spl, hDisp: o.h, vDisp: o.v, fLow: o.f, fHigh: o.fHigh || 20000, powered: true, ampW: o.ampW },
    mount: 'stand',
    mountH: 1.9,
    tags: ['top', 'pa', 'aktif', 'aktiv', 'powered', ...(o.tags || [])],
  };
}

function passiveTop(o: SpkOpt & { ohm?: number }): EquipDef {
  return {
    id: o.id,
    cat: 'hoparlor',
    dept: 'ses',
    name: o.name || nm('Pasif hoparlör', 'Passivlautsprecher', 'Passive loudspeaker'),
    brand: o.brand,
    model: o.model,
    icon: 'speaker-p',
    shape: 'speaker',
    w: o.dims[0],
    d: o.dims[1],
    h: o.dims[2],
    kg: o.kg,
    ports: [pg('in', N.in, 'speakon', 'in', 'speaker'), pg('link', N.link, 'speakon', 'out', 'speaker')],
    acoustic: { kind: 'top', maxSpl: o.spl, hDisp: o.h, vDisp: o.v, fLow: o.f, fHigh: o.fHigh || 20000, powered: false, ampW: o.ampW, impedance: o.ohm || 8 },
    mount: 'stand',
    mountH: 1.9,
    tags: ['top', 'pa', 'pasif', 'passiv', ...(o.tags || [])],
  };
}

function activeSub(o: SpkOpt): EquipDef {
  return {
    id: o.id,
    cat: 'sub',
    dept: 'ses',
    name: o.name || nm('Aktif subwoofer', 'Aktiv-Subwoofer', 'Powered subwoofer'),
    brand: o.brand,
    model: o.model,
    icon: 'sub',
    shape: 'sub',
    w: o.dims[0],
    d: o.dims[1],
    h: o.dims[2],
    kg: o.kg,
    watt: Math.round(o.ampW * 0.18),
    wattMax: Math.round(o.ampW * 0.5),
    ports: [pg('in', N.in, 'combo', 'in', 'audio', 2, LR), pg('thru', N.thru, 'xlr', 'out', 'audio', 2, LR), ...pwrPorts(o.pwr, o.link !== false)],
    acoustic: { kind: 'sub', maxSpl: o.spl, hDisp: 360, vDisp: 180, fLow: o.f, fHigh: o.fHigh || 120, powered: true, ampW: o.ampW },
    mount: 'floor',
    tags: ['sub', 'bas', 'bass', 'subwoofer', ...(o.tags || [])],
  };
}

function passiveSub(o: SpkOpt & { ohm?: number }): EquipDef {
  return {
    id: o.id,
    cat: 'sub',
    dept: 'ses',
    name: o.name || nm('Pasif subwoofer', 'Passiv-Subwoofer', 'Passive subwoofer'),
    brand: o.brand,
    model: o.model,
    icon: 'sub',
    shape: 'sub',
    w: o.dims[0],
    d: o.dims[1],
    h: o.dims[2],
    kg: o.kg,
    ports: [pg('in', N.in, 'speakon', 'in', 'speaker'), pg('link', N.link, 'speakon', 'out', 'speaker')],
    acoustic: { kind: 'sub', maxSpl: o.spl, hDisp: 360, vDisp: 180, fLow: o.f, fHigh: o.fHigh || 120, powered: false, ampW: o.ampW, impedance: o.ohm || 8 },
    mount: 'floor',
    tags: ['sub', 'bas', 'pasif', ...(o.tags || [])],
  };
}

function wedge(o: SpkOpt & { passive?: boolean; ohm?: number }): EquipDef {
  const ports = o.passive
    ? [pg('in', N.in, 'speakon', 'in', 'speaker'), pg('link', N.link, 'speakon', 'out', 'speaker')]
    : [pg('in', N.in, 'combo', 'in', 'audio'), pg('link', N.link, 'xlr', 'out', 'audio'), ...pwrPorts(o.pwr, o.link !== false)];
  return {
    id: o.id,
    cat: 'monitor',
    dept: 'ses',
    name: o.name || (o.passive ? nm('Pasif sahne monitörü', 'Passiver Bühnenmonitor', 'Passive stage monitor') : nm('Aktif sahne monitörü', 'Aktiver Bühnenmonitor', 'Powered stage monitor')),
    brand: o.brand,
    model: o.model,
    icon: 'monitor',
    shape: 'wedge',
    w: o.dims[0],
    d: o.dims[1],
    h: o.dims[2],
    kg: o.kg,
    watt: o.passive ? undefined : Math.round(o.ampW * 0.15),
    wattMax: o.passive ? undefined : Math.round(o.ampW * 0.5),
    ports,
    acoustic: { kind: 'monitor', maxSpl: o.spl, hDisp: o.h, vDisp: o.v, fLow: o.f, fHigh: o.fHigh || 20000, powered: !o.passive, ampW: o.ampW, impedance: o.passive ? o.ohm || 8 : undefined },
    mount: 'floor',
    props: { role: 'monitor', tilt: 40, rot: 180 },
    tags: ['monitor', 'wedge', 'sahne', ...(o.tags || [])],
  };
}

function arrayEl(o: SpkOpt & { passive?: boolean; ohm?: number; count?: number }): EquipDef {
  const ports = o.passive
    ? [pg('in', N.in, 'speakon', 'in', 'speaker'), pg('link', N.link, 'speakon', 'out', 'speaker')]
    : [pg('in', N.in, 'xlr', 'in', 'audio'), pg('link', N.link, 'xlr', 'out', 'audio'), ...pwrPorts(o.pwr || 'powercon', true)];
  const n = o.count || 6;
  return {
    id: o.id,
    cat: 'linearray',
    dept: 'ses',
    name: o.name || nm('Line array (eleman)', 'Line-Array (Element)', 'Line array (element)'),
    brand: o.brand,
    model: o.model,
    icon: 'array',
    shape: 'array',
    w: o.dims[0],
    d: o.dims[1],
    h: o.dims[2],
    kg: o.kg,
    watt: o.passive ? undefined : Math.round(o.ampW * 0.15),
    wattMax: o.passive ? undefined : Math.round(o.ampW * 0.5),
    ports,
    acoustic: { kind: 'array', maxSpl: o.spl, hDisp: o.h, vDisp: o.v, fLow: o.f, fHigh: o.fHigh || 20000, powered: !o.passive, ampW: o.ampW, impedance: o.passive ? o.ohm || 8 : undefined },
    mount: 'flown',
    mountH: 4,
    props: { count: n, splays: defaultSplays(n), tilt: -2 },
    tags: ['line array', 'array', 'asma', 'flown', ...(o.tags || [])],
  };
}

export function defaultSplays(n: number): number[] {
  const base = [0, 1, 1, 2, 3, 4, 5, 6, 7, 8, 10, 10, 10, 10, 10, 10, 10, 10];
  return base.slice(0, n);
}

// ——— Rack cihazları ———
function rackDev(o: { id: string; cat: EquipDef['cat']; name: L10n; brand?: string; model?: string; icon: string; u?: number; kg: number; watt?: number; ports: PortGroup[]; tags?: string[]; dept?: EquipDef['dept']; desc?: L10n; w?: number; d?: number }): EquipDef {
  const u = o.u || 1;
  return {
    id: o.id,
    cat: o.cat,
    dept: o.dept || 'ses',
    name: o.name,
    brand: o.brand,
    model: o.model,
    icon: o.icon,
    shape: 'rack',
    w: o.w || 0.48,
    d: o.d || 0.35,
    h: Math.max(0.044 * u, 0.044),
    kg: o.kg,
    watt: o.watt,
    ports: o.ports,
    mount: 'table',
    mountH: 0.75,
    tags: o.tags,
    desc: o.desc,
  };
}

const iec = (): PortGroup => pg('pwr', N.pwr, 'iec', 'in', 'power');

function amp(o: { id: string; brand?: string; model?: string; name?: L10n; ch: number; wPerCh: number; kg: number; u?: number; pwr?: 'iec' | 'powercon' | 'true1' | 'cee16'; watt?: number }): EquipDef {
  const pw = o.pwr || 'powercon';
  return rackDev({
    id: o.id,
    cat: 'islem',
    name: o.name || nm(`Amfi ${o.ch} kanal`, `Endstufe ${o.ch}-Kanal`, `Amplifier ${o.ch}-ch`),
    brand: o.brand,
    model: o.model,
    icon: 'amp',
    u: o.u || 2,
    kg: o.kg,
    watt: o.watt || Math.round(o.ch * o.wPerCh * 0.2),
    ports: [
      pg('in', N.in, 'xlr', 'in', 'audio', o.ch, o.ch === 2 ? ['A', 'B'] : undefined),
      pg('link', N.link, 'xlr', 'out', 'audio', o.ch, o.ch === 2 ? ['A', 'B'] : undefined),
      pg('out', N.spkOut, 'speakon', 'out', 'speaker', o.ch, o.ch === 2 ? ['A', 'B'] : undefined),
      pg('net', N.net, 'rj45', 'io', 'network'),
      pg('pwr', N.pwr, pw === 'cee16' ? 'cee16' : pw, 'in', 'power'),
    ],
    tags: ['amfi', 'amp', 'endstufe', 'güç'],
  });
}

// ——— Mikserler ———
function console_(o: { id: string; brand?: string; model?: string; name?: L10n; mic: number; lineSt?: number; outs: number; aux?: number; dig?: { key: string; name: string; count: number }[]; usb?: boolean; kg: number; dims: [number, number, number]; watt: number; shape?: string; tags?: string[]; desc?: L10n; mainXlr?: boolean }): EquipDef {
  const ports: PortGroup[] = [pg('mic', N.mic, 'xlr', 'in', 'audio', o.mic)];
  if (o.lineSt) ports.push(pg('line', N.line, 'jack', 'in', 'audio', o.lineSt * 2));
  ports.push(pg('main', N.main, 'xlr', 'out', 'audio', 2, LR));
  if (o.outs) ports.push(pg('out', N.out, 'xlr', 'out', 'audio', o.outs));
  if (o.aux) ports.push(pg('aux', N.aux, 'jack', 'out', 'audio', o.aux));
  for (const d of o.dig || []) ports.push(pg(d.key, d.name, 'rj45', 'io', 'digital', d.count));
  if (o.usb) ports.push(pg('usb', N.usb, 'usb', 'io', 'data'));
  ports.push(pg('net', N.net, 'rj45', 'io', 'network'));
  ports.push(iec());
  return {
    id: o.id,
    cat: 'mikser',
    dept: 'ses',
    name: o.name || nm('Dijital mikser', 'Digitalpult', 'Digital mixer'),
    brand: o.brand,
    model: o.model,
    icon: 'mixer',
    shape: o.shape || 'console',
    w: o.dims[0],
    d: o.dims[1],
    h: o.dims[2],
    kg: o.kg,
    watt: o.watt,
    ports,
    mount: 'table',
    mountH: 0.75,
    tags: ['mikser', 'mixer', 'pult', 'foh', 'konsol', ...(o.tags || [])],
    desc: o.desc,
  };
}

function stagebox(o: { id: string; brand?: string; model?: string; ins: number; outs: number; dig: { key: string; name: string; count: number }; kg: number; u: number; watt: number }): EquipDef {
  return rackDev({
    id: o.id,
    cat: 'mikser',
    name: nm('Dijital stagebox', 'Digitale Stagebox', 'Digital stage box'),
    brand: o.brand,
    model: o.model,
    icon: 'stagebox',
    u: o.u,
    kg: o.kg,
    watt: o.watt,
    ports: [pg('in', N.in, 'xlr', 'in', 'audio', o.ins), pg('out', N.out, 'xlr', 'out', 'audio', o.outs), pg(o.dig.key, o.dig.name, 'rj45', 'io', 'digital', o.dig.count), iec()],
    tags: ['stagebox', 'stage box', 'snake', 'sahne kutusu'],
  });
}

function djDef(o: Omit<EquipDef, 'cat' | 'dept' | 'mount'> & { mount?: EquipDef['mount'] }): EquipDef {
  return { cat: 'dj', dept: 'dj', mount: 'table', mountH: 0.9, ...o };
}

function micDef(o: { id: string; brand?: string; model?: string; name: L10n; icon?: string; phantom?: boolean; stand?: 'boom' | 'straight' | 'short' | 'table' | 'clip' | 'none'; tags?: string[]; kg?: number; desc?: L10n }): EquipDef {
  return {
    id: o.id,
    cat: 'mikrofon',
    dept: 'ses',
    name: o.name,
    brand: o.brand,
    model: o.model,
    icon: o.icon || 'mic',
    shape: 'mic',
    plan: 'circle',
    w: 0.12,
    d: 0.12,
    h: 0.2,
    kg: o.kg || 0.35,
    ports: [pg('out', N.out, 'xlr', 'out', 'audio')],
    mount: 'stand',
    mountH: 1.5,
    props: { stand: o.stand || 'boom', phantom: !!o.phantom },
    tags: ['mikrofon', 'mic', 'mikro', ...(o.tags || [])],
    desc: o.desc,
  };
}

function wlMic(o: { id: string; brand: string; model: string; name: L10n; icon?: string; tags?: string[]; range?: number }): EquipDef {
  return {
    id: o.id,
    cat: 'mikrofon',
    dept: 'ses',
    name: o.name,
    brand: o.brand,
    model: o.model,
    icon: o.icon || 'micwireless',
    shape: 'mic',
    plan: 'circle',
    w: 0.12,
    d: 0.12,
    h: 0.25,
    kg: 0.35,
    ports: [pg('rf', N.rf, 'antenna', 'out', 'wireless')],
    mount: 'stand',
    mountH: 1.5,
    range: o.range || 100,
    props: { stand: 'straight' },
    tags: ['kablosuz', 'wireless', 'funk', 'el mikrofonu', ...(o.tags || [])],
  };
}

function wlRx(o: { id: string; brand: string; model: string; ch: number; tags?: string[] }): EquipDef {
  return rackDev({
    id: o.id,
    cat: 'mikrofon',
    name: o.ch > 1 ? nm(`Kablosuz alıcı (${o.ch} kanal)`, `Funkempfänger (${o.ch}-Kanal)`, `Wireless receiver (${o.ch}-ch)`) : nm('Kablosuz alıcı', 'Funkempfänger', 'Wireless receiver'),
    brand: o.brand,
    model: o.model,
    icon: 'receiver',
    u: 1,
    kg: o.ch > 1 ? 3.5 : 1.2,
    watt: 12 * o.ch,
    w: o.ch > 1 ? 0.48 : 0.21,
    d: 0.25,
    ports: [pg('rf', N.rf, 'antenna', 'in', 'wireless', o.ch), pg('out', N.out, 'xlr', 'out', 'audio', o.ch), pg('net', N.net, 'rj45', 'io', 'network'), iec()],
    tags: ['alıcı', 'receiver', 'empfänger', 'kablosuz', ...(o.tags || [])],
  });
}

function instr(o: { id: string; name: L10n; icon: string; shape: string; dims: [number, number, number]; kg?: number; ports?: PortGroup[]; watt?: number; tags?: string[]; plan?: 'rect' | 'circle'; mount?: EquipDef['mount']; mountH?: number; desc?: L10n }): EquipDef {
  return {
    id: o.id,
    cat: 'enstruman',
    dept: 'enstruman',
    name: o.name,
    icon: o.icon,
    shape: o.shape,
    plan: o.plan,
    w: o.dims[0],
    d: o.dims[1],
    h: o.dims[2],
    kg: o.kg,
    watt: o.watt,
    ports: o.ports || [],
    mount: o.mount || 'floor',
    mountH: o.mountH,
    tags: o.tags,
    desc: o.desc,
  };
}

function light(o: { id: string; name: L10n; brand?: string; model?: string; icon: string; shape: string; dims: [number, number, number]; kg: number; watt: number; pwr?: 'powercon' | 'true1' | 'schuko' | 'iec' | 'none'; dmx?: 'dmx3' | 'dmx5' | 'none'; mount?: EquipDef['mount']; mountH?: number; tags?: string[]; desc?: L10n; extra?: PortGroup[] }): EquipDef {
  const ports: PortGroup[] = [];
  if (o.dmx !== 'none') {
    const c = o.dmx || 'dmx3';
    ports.push(pg('dmxin', N.dmxIn, c, 'in', 'dmx'), pg('dmxout', N.dmxOut, c, 'out', 'dmx'));
  }
  const pw = o.pwr || 'powercon';
  if (pw !== 'none') ports.push(pg('pwr', N.pwr, pw, 'in', 'power'));
  if (pw === 'powercon' || pw === 'true1') ports.push(pg('pwrout', N.pwrOut, pw, 'out', 'power'));
  if (o.extra) ports.push(...o.extra);
  return {
    id: o.id,
    cat: 'isik',
    dept: 'isik',
    name: o.name,
    brand: o.brand,
    model: o.model,
    icon: o.icon,
    shape: o.shape,
    w: o.dims[0],
    d: o.dims[1],
    h: o.dims[2],
    kg: o.kg,
    watt: o.watt,
    ports,
    mount: o.mount || 'floor',
    mountH: o.mountH,
    tags: ['ışık', 'licht', 'light', 'dmx', ...(o.tags || [])],
    desc: o.desc,
  };
}

function simple(o: Partial<EquipDef> & { id: string; cat: EquipDef['cat']; name: L10n; icon: string; shape: string; dims: [number, number, number] }): EquipDef {
  const { dims, ...rest } = o;
  return {
    dept: o.cat === 'mekan' || o.cat === 'sahne' ? 'sahne' : o.cat === 'truss' ? 'isik' : 'sahne',
    ports: [],
    mount: 'floor',
    ...rest,
    w: dims[0],
    d: dims[1],
    h: dims[2],
  } as EquipDef;
}

// ——————————————————————————————————————————————————————————————
export const EQUIPMENT: EquipDef[] = [
  // ===== HOPARLÖRLER (genel) =====
  activeTop({ id: 'top-10a', name: nm('Aktif hoparlör 10"', 'Aktivlautsprecher 10"', 'Powered speaker 10"'), spl: 126, h: 90, v: 60, f: 55, ampW: 1000, kg: 14, dims: [0.3, 0.29, 0.5], tags: ['10'] }),
  activeTop({ id: 'top-12a', name: nm('Aktif hoparlör 12"', 'Aktivlautsprecher 12"', 'Powered speaker 12"'), spl: 129, h: 90, v: 60, f: 50, ampW: 1300, kg: 18, dims: [0.37, 0.35, 0.6], tags: ['12'] }),
  activeTop({ id: 'top-15a', name: nm('Aktif hoparlör 15"', 'Aktivlautsprecher 15"', 'Powered speaker 15"'), spl: 131, h: 90, v: 60, f: 45, ampW: 1600, kg: 24, dims: [0.44, 0.4, 0.71], tags: ['15'] }),
  passiveTop({ id: 'top-12p', name: nm('Pasif hoparlör 12"', 'Passivlautsprecher 12"', 'Passive speaker 12"'), spl: 128, h: 90, v: 50, f: 55, ampW: 600, kg: 17, dims: [0.37, 0.35, 0.6], tags: ['12'] }),
  passiveTop({ id: 'top-15p', name: nm('Pasif hoparlör 15"', 'Passivlautsprecher 15"', 'Passive speaker 15"'), spl: 130, h: 90, v: 50, f: 45, ampW: 800, kg: 22, dims: [0.44, 0.4, 0.71], tags: ['15'] }),
  // marka modelleri
  activeTop({ id: 'qsc-k10.2', brand: 'QSC', model: 'K10.2', spl: 131, h: 90, v: 90, f: 56, ampW: 2000, kg: 14.2, dims: [0.31, 0.3, 0.52], pwr: 'iec' }),
  activeTop({ id: 'qsc-k12.2', brand: 'QSC', model: 'K12.2', spl: 132, h: 75, v: 75, f: 50, ampW: 2000, kg: 17.7, dims: [0.36, 0.35, 0.6], pwr: 'iec' }),
  activeTop({ id: 'rcf-art912a', brand: 'RCF', model: 'ART 912-A', spl: 131, h: 90, v: 60, f: 50, ampW: 2100, kg: 19.4, dims: [0.37, 0.34, 0.62], pwr: 'powercon' }),
  activeTop({ id: 'rcf-art935a', brand: 'RCF', model: 'ART 935-A', spl: 135, h: 90, v: 60, f: 45, ampW: 2100, kg: 23.4, dims: [0.43, 0.39, 0.71], pwr: 'powercon' }),
  activeTop({ id: 'jbl-prx912', brand: 'JBL', model: 'PRX912', spl: 134, h: 90, v: 50, f: 44, ampW: 2000, kg: 19.1, dims: [0.38, 0.38, 0.62], pwr: 'powercon' }),
  activeTop({ id: 'jbl-prx915', brand: 'JBL', model: 'PRX915', spl: 135, h: 90, v: 50, f: 39, ampW: 2000, kg: 22.9, dims: [0.44, 0.42, 0.71], pwr: 'powercon' }),
  activeTop({ id: 'jbl-eon715', brand: 'JBL', model: 'EON715', spl: 127, h: 90, v: 60, f: 50, ampW: 1300, kg: 17.4, dims: [0.43, 0.36, 0.7], pwr: 'iec' }),
  activeTop({ id: 'ev-zlx12p', brand: 'Electro-Voice', model: 'ZLX-12P G2', spl: 127, h: 90, v: 60, f: 50, ampW: 1000, kg: 15.6, dims: [0.36, 0.34, 0.6], pwr: 'iec' }),
  activeTop({ id: 'ev-etx15p', brand: 'Electro-Voice', model: 'ETX-15P', spl: 136, h: 90, v: 60, f: 41, ampW: 2000, kg: 30, dims: [0.45, 0.42, 0.73], pwr: 'powercon' }),
  activeTop({ id: 'yam-dxr12', brand: 'Yamaha', model: 'DXR12mkII', spl: 132, h: 90, v: 60, f: 52, ampW: 1100, kg: 21.4, dims: [0.36, 0.36, 0.6], pwr: 'iec' }),
  activeTop({ id: 'dbt-opera12', brand: 'dB Technologies', model: 'Opera 12', spl: 129, h: 90, v: 60, f: 55, ampW: 900, kg: 16, dims: [0.36, 0.34, 0.61], pwr: 'iec' }),
  activeTop({ id: 'hk-l5-112xa', brand: 'HK Audio', model: 'Linear 5 MKII 112 XA', spl: 129, h: 80, v: 50, f: 55, ampW: 1200, kg: 19, dims: [0.36, 0.38, 0.6], pwr: 'powercon' }),
  passiveTop({ id: 'db-y10p', brand: 'd&b audiotechnik', model: 'Y10P', spl: 136, h: 110, v: 40, f: 59, ampW: 400, kg: 16, dims: [0.31, 0.34, 0.53], ohm: 12 }),
  passiveTop({ id: 'la-x12', brand: 'L-Acoustics', model: 'X12', spl: 136, h: 90, v: 60, f: 59, ampW: 800, kg: 20, dims: [0.43, 0.32, 0.43], ohm: 8 }),
  // kolon
  {
    id: 'bose-l1pro32', cat: 'hoparlor', dept: 'ses', name: nm('Kolon sistem (sub dahil)', 'Säulensystem (mit Sub)', 'Column system (with sub)'), brand: 'Bose', model: 'L1 Pro32 + Sub1',
    icon: 'column', shape: 'column', w: 0.35, d: 0.45, h: 2.0, kg: 34, watt: 180, wattMax: 900,
    ports: [pg('in', N.in, 'combo', 'in', 'audio', 2), pg('out', N.out, 'xlr', 'out', 'audio'), pg('pwr', N.pwr, 'iec', 'in', 'power')],
    acoustic: { kind: 'column', maxSpl: 124, hDisp: 180, vDisp: 40, fLow: 37, fHigh: 16000, powered: true, ampW: 1440 }, mount: 'floor', tags: ['kolon', 'column', 'säule'],
  },
  {
    id: 'ld-maui28', cat: 'hoparlor', dept: 'ses', name: nm('Kolon sistem', 'Säulensystem', 'Column system'), brand: 'LD Systems', model: 'MAUI 28 G3',
    icon: 'column', shape: 'column', w: 0.4, d: 0.55, h: 2.1, kg: 35, watt: 200, wattMax: 1000,
    ports: [pg('in', N.in, 'combo', 'in', 'audio', 2), pg('out', N.out, 'xlr', 'out', 'audio'), pg('pwr', N.pwr, 'powercon', 'in', 'power')],
    acoustic: { kind: 'column', maxSpl: 125, hDisp: 120, vDisp: 20, fLow: 35, fHigh: 20000, powered: true, ampW: 2030 }, mount: 'floor', tags: ['kolon', 'column', 'säule'],
  },

  // ===== SUBWOOFER =====
  activeSub({ id: 'sub-15a', name: nm('Aktif sub 15"', 'Aktiv-Sub 15"', 'Powered sub 15"'), spl: 130, h: 360, v: 180, f: 40, ampW: 1000, kg: 33, dims: [0.46, 0.6, 0.55], tags: ['15'] }),
  activeSub({ id: 'sub-18a', name: nm('Aktif sub 18"', 'Aktiv-Sub 18"', 'Powered sub 18"'), spl: 134, h: 360, v: 180, f: 35, ampW: 1600, kg: 45, dims: [0.55, 0.7, 0.65], tags: ['18'] }),
  activeSub({ id: 'sub-218a', name: nm('Aktif sub 2×18"', 'Aktiv-Sub 2×18"', 'Powered sub 2×18"'), spl: 139, h: 360, v: 180, f: 30, ampW: 3000, kg: 95, dims: [1.1, 0.75, 0.6], tags: ['18', '2x18'] }),
  passiveSub({ id: 'sub-18p', name: nm('Pasif sub 18"', 'Passiv-Sub 18"', 'Passive sub 18"'), spl: 134, h: 360, v: 180, f: 35, ampW: 1200, kg: 50, dims: [0.55, 0.7, 0.65], tags: ['18'] }),
  activeSub({ id: 'qsc-ks118', brand: 'QSC', model: 'KS118', spl: 136, h: 360, v: 180, f: 37, ampW: 3600, kg: 47, dims: [0.54, 0.76, 0.66], pwr: 'iec' }),
  activeSub({ id: 'qsc-ks112', brand: 'QSC', model: 'KS112', spl: 129, h: 360, v: 180, f: 41, ampW: 2000, kg: 34, dims: [0.36, 0.64, 0.56], pwr: 'iec' }),
  activeSub({ id: 'rcf-sub8004', brand: 'RCF', model: 'SUB 8004-AS', spl: 141, h: 360, v: 180, f: 30, ampW: 4400, kg: 79, dims: [0.68, 0.84, 0.72], pwr: 'powercon' }),
  activeSub({ id: 'rcf-sub708', brand: 'RCF', model: 'SUB 708-AS II', spl: 133, h: 360, v: 180, f: 35, ampW: 1400, kg: 41, dims: [0.51, 0.66, 0.61], pwr: 'powercon' }),
  activeSub({ id: 'jbl-prx918', brand: 'JBL', model: 'PRX918XLF', spl: 135, h: 360, v: 180, f: 30, ampW: 2000, kg: 45, dims: [0.55, 0.67, 0.66], pwr: 'powercon' }),
  activeSub({ id: 'ev-etx18sp', brand: 'Electro-Voice', model: 'ETX-18SP', spl: 136, h: 360, v: 180, f: 30, ampW: 1800, kg: 53, dims: [0.54, 0.76, 0.65], pwr: 'powercon' }),
  activeSub({ id: 'yam-dxs18', brand: 'Yamaha', model: 'DXS18XLF', spl: 136, h: 360, v: 180, f: 32, ampW: 1600, kg: 56, dims: [0.56, 0.75, 0.68], pwr: 'iec' }),
  passiveSub({ id: 'la-ks28', brand: 'L-Acoustics', model: 'KS28', spl: 143, h: 360, v: 180, f: 25, ampW: 2400, kg: 79, dims: [1.34, 0.7, 0.55], ohm: 4 }),
  passiveSub({ id: 'la-sb18', brand: 'L-Acoustics', model: 'SB18', spl: 136, h: 360, v: 180, f: 32, ampW: 1100, kg: 52, dims: [0.7, 0.71, 0.52], ohm: 8 }),

  // ===== LINE ARRAY =====
  arrayEl({ id: 'la-generic', name: nm('Aktif line array elemanı 2×8"', 'Aktives Line-Array-Element 2×8"', 'Powered line array element 2×8"'), spl: 133, h: 100, v: 10, f: 65, ampW: 1000, kg: 25, dims: [0.6, 0.42, 0.25] }),
  arrayEl({ id: 'rcf-hdl6a', brand: 'RCF', model: 'HDL 6-A', spl: 131, h: 100, v: 15, f: 65, ampW: 1400, kg: 14.8, dims: [0.44, 0.35, 0.2] }),
  arrayEl({ id: 'dbt-viol208', brand: 'dB Technologies', model: 'VIO L208', spl: 133, h: 100, v: 10, f: 60, ampW: 1200, kg: 20, dims: [0.55, 0.38, 0.25] }),
  arrayEl({ id: 'la-karaii', brand: 'L-Acoustics', model: 'Kara II', spl: 142, h: 110, v: 10, f: 55, ampW: 1200, kg: 26, dims: [0.73, 0.48, 0.25], passive: true, ohm: 8 }),

  // ===== MONİTÖR / IEM =====
  wedge({ id: 'mon-12a', name: nm('Aktif monitör 12"', 'Aktiver Monitor 12"', 'Powered wedge 12"'), spl: 128, h: 70, v: 70, f: 60, ampW: 1000, kg: 17, dims: [0.55, 0.4, 0.34], tags: ['12'] }),
  wedge({ id: 'mon-15a', name: nm('Aktif monitör 15"', 'Aktiver Monitor 15"', 'Powered wedge 15"'), spl: 131, h: 60, v: 60, f: 50, ampW: 1500, kg: 23, dims: [0.66, 0.46, 0.38], tags: ['15'] }),
  wedge({ id: 'mon-12p', name: nm('Pasif monitör 12"', 'Passiver Monitor 12"', 'Passive wedge 12"'), spl: 128, h: 70, v: 70, f: 60, ampW: 600, kg: 16, dims: [0.55, 0.4, 0.34], passive: true }),
  wedge({ id: 'rcf-nx15sma', brand: 'RCF', model: 'NX 15-SMA', spl: 133, h: 40, v: 60, f: 50, ampW: 1400, kg: 25, dims: [0.6, 0.48, 0.35] }),
  wedge({ id: 'la-x15', brand: 'L-Acoustics', model: 'X15 HiQ', spl: 139, h: 40, v: 60, f: 55, ampW: 1100, kg: 21, dims: [0.6, 0.45, 0.36], passive: true }),
  {
    id: 'iem-tx', cat: 'monitor', dept: 'ses', name: nm('Kulak içi monitör vericisi (IEM)', 'In-Ear-Sender', 'In-ear monitor transmitter'), brand: 'Shure', model: 'PSM300 P3T',
    icon: 'iem', shape: 'rack', w: 0.21, d: 0.2, h: 0.044, kg: 1.3, watt: 15,
    ports: [pg('in', N.in, 'combo', 'in', 'audio', 2, LR), pg('rf', N.rf, 'antenna', 'out', 'wireless'), iec()], mount: 'table', mountH: 0.75, range: 90,
    tags: ['iem', 'in-ear', 'kulak', 'monitör'],
  },
  {
    id: 'iem-rx', cat: 'monitor', dept: 'ses', name: nm('IEM kemer alıcısı', 'In-Ear-Taschenempfänger', 'IEM bodypack receiver'), brand: 'Shure', model: 'PSM300 P3R',
    icon: 'iem', shape: 'box', plan: 'circle', w: 0.07, d: 0.03, h: 0.1, kg: 0.2,
    ports: [pg('rf', N.rf, 'antenna', 'in', 'wireless'), pg('out', nm('Kulaklık', 'Kopfhörer', 'Earphones'), 'jack35', 'out', 'audio')], mount: 'stand', mountH: 1.1, tags: ['iem', 'in-ear', 'bodypack'],
  },

  // ===== MİKSERLER =====
  console_({ id: 'beh-x32c', brand: 'Behringer', model: 'X32 Compact', mic: 16, outs: 8, aux: 6, dig: [{ key: 'aes50', name: 'AES50', count: 2 }], usb: true, kg: 15, dims: [0.62, 0.53, 0.2], watt: 120, tags: ['x32'] }),
  console_({ id: 'beh-wing', brand: 'Behringer', model: 'WING', mic: 8, outs: 8, dig: [{ key: 'aes50', name: 'AES50', count: 3 }], usb: true, kg: 20, dims: [0.86, 0.55, 0.25], watt: 150 }),
  console_({ id: 'midas-m32r', brand: 'Midas', model: 'M32R', mic: 16, outs: 8, aux: 6, dig: [{ key: 'aes50', name: 'AES50', count: 2 }], usb: true, kg: 12, dims: [0.48, 0.45, 0.22], watt: 120 }),
  console_({ id: 'ah-sq6', brand: 'Allen & Heath', model: 'SQ-6', mic: 24, outs: 14, dig: [{ key: 'slink', name: 'SLink', count: 1 }], usb: true, kg: 15.5, dims: [0.69, 0.56, 0.2], watt: 140 }),
  console_({ id: 'ah-qu16', brand: 'Allen & Heath', model: 'Qu-16', mic: 16, lineSt: 3, outs: 12, dig: [{ key: 'dsnake', name: 'dSnake', count: 1 }], usb: true, kg: 11.2, dims: [0.44, 0.5, 0.19], watt: 80 }),
  console_({ id: 'ah-cq18t', brand: 'Allen & Heath', model: 'CQ-18T', mic: 16, lineSt: 1, outs: 6, usb: true, kg: 5, dims: [0.42, 0.33, 0.12], watt: 60 }),
  console_({ id: 'yam-tf5', brand: 'Yamaha', model: 'TF5', mic: 32, lineSt: 2, outs: 16, dig: [{ key: 'tfrack', name: 'Dante (NY64-D)', count: 1 }], usb: true, kg: 23, dims: [0.9, 0.6, 0.23], watt: 120 }),
  console_({ id: 'yam-dm3', brand: 'Yamaha', model: 'DM3', mic: 16, outs: 8, dig: [{ key: 'dante', name: 'Dante', count: 2 }], usb: true, kg: 9.5, dims: [0.43, 0.54, 0.2], watt: 90 }),
  console_({ id: 'sc-ui24r', brand: 'Soundcraft', model: 'Ui24R', name: nm('Rack dijital mikser (tablet kontrol)', 'Rack-Digitalmixer (Tablet)', 'Rack digital mixer (tablet)'), mic: 20, outs: 10, usb: true, kg: 6.5, dims: [0.48, 0.3, 0.13], watt: 80, shape: 'rack' }),
  console_({ id: 'beh-xr18', brand: 'Behringer', model: 'XR18', name: nm('Rack dijital mikser (tablet kontrol)', 'Rack-Digitalmixer (Tablet)', 'Rack digital mixer (tablet)'), mic: 16, lineSt: 1, outs: 6, usb: true, kg: 3.6, dims: [0.48, 0.22, 0.13], watt: 40, shape: 'rack', tags: ['x air', 'xr18'] }),
  console_({ id: 'midas-mr12', brand: 'Midas', model: 'MR12', name: nm('Kompakt dijital mikser (tablet kontrol)', 'Kompakter Digitalmixer (Tablet)', 'Compact digital mixer (tablet)'), mic: 4, lineSt: 4, outs: 2, usb: true, kg: 2.5, dims: [0.32, 0.2, 0.1], watt: 30, shape: 'rack', tags: ['mr12', 'x air'], desc: nm('Sadece 4 mikrofon girişi: kalabalık grupta yetmez.', 'Nur 4 Mikrofoneingänge.', 'Only 4 mic inputs.') }),
  console_({ id: 'ah-cq20b', brand: 'Allen & Heath', model: 'CQ-20B', name: nm('Kutu dijital mikser (tablet kontrol)', 'Digitalmixer als Box (Tablet)', 'Box digital mixer (tablet)'), mic: 16, lineSt: 2, outs: 6, usb: true, kg: 4.2, dims: [0.44, 0.3, 0.12], watt: 60, shape: 'rack', tags: ['cq', 'cq20b'] }),
  console_({ id: 'mix-an12', name: nm('Analog mikser 12 kanal', 'Analogpult 12 Kanäle', 'Analog mixer 12-ch'), brand: 'Yamaha', model: 'MG12XU', mic: 6, lineSt: 3, outs: 0, aux: 2, usb: true, kg: 4.2, dims: [0.31, 0.5, 0.12], watt: 40, tags: ['analog'] }),
  console_({ id: 'mix-an16', name: nm('Analog mikser 16 kanal', 'Analogpult 16 Kanäle', 'Analog mixer 16-ch'), mic: 12, lineSt: 2, outs: 0, aux: 4, usb: true, kg: 8, dims: [0.48, 0.5, 0.13], watt: 50, tags: ['analog'] }),
  stagebox({ id: 'beh-s16', brand: 'Behringer', model: 'S16', ins: 16, outs: 8, dig: { key: 'aes50', name: 'AES50', count: 2 }, kg: 7, u: 3, watt: 50 }),
  stagebox({ id: 'midas-dl16', brand: 'Midas', model: 'DL16', ins: 16, outs: 8, dig: { key: 'aes50', name: 'AES50', count: 2 }, kg: 7.5, u: 3, watt: 50 }),
  stagebox({ id: 'ah-ar2412', brand: 'Allen & Heath', model: 'AR2412', ins: 24, outs: 12, dig: { key: 'dsnake', name: 'dSnake', count: 1 }, kg: 9, u: 4, watt: 60 }),
  stagebox({ id: 'ah-dx168', brand: 'Allen & Heath', model: 'DX168', ins: 16, outs: 8, dig: { key: 'dx', name: 'DX/SLink', count: 2 }, kg: 6, u: 3, watt: 50 }),
  stagebox({ id: 'yam-rio1608', brand: 'Yamaha', model: 'Rio1608-D2', ins: 16, outs: 8, dig: { key: 'dante', name: 'Dante', count: 2 }, kg: 8, u: 3, watt: 70 }),
  rackDev({
    id: 'snake-stage', cat: 'mikser', name: nm('Analog multikor sahne kutusu 16/4', 'Analoge Stagebox 16/4', 'Analog snake stage box 16/4'), icon: 'stagebox', u: 3, kg: 6,
    ports: [pg('in', N.in, 'xlr', 'in', 'audio', 16), pg('ret', nm('Dönüş çıkışı', 'Rückweg-Ausgang', 'Return out'), 'xlr', 'out', 'audio', 4), pg('multi', nm('Multikor', 'Multicore', 'Multicore'), 'multipin', 'out', 'audio')],
    tags: ['snake', 'multikor', 'multicore', 'analog'],
  }),
  rackDev({
    id: 'snake-foh', cat: 'mikser', name: nm('Analog multikor FOH ucu 16/4', 'Multicore FOH-Seite 16/4', 'Analog snake FOH fan 16/4'), icon: 'stagebox', u: 2, kg: 3,
    ports: [pg('multi', nm('Multikor', 'Multicore', 'Multicore'), 'multipin', 'in', 'audio'), pg('out', N.out, 'xlr', 'out', 'audio', 16), pg('ret', nm('Dönüş girişi', 'Rückweg-Eingang', 'Return in'), 'xlr', 'in', 'audio', 4)],
    tags: ['snake', 'multikor', 'multicore', 'analog'],
  }),

  // ===== AMFİ / DSP / DI =====
  amp({ id: 'amp-2ch', name: nm('Amfi 2 kanal (2×1000 W)', 'Endstufe 2-Kanal (2×1000 W)', 'Amplifier 2-ch (2×1000 W)'), ch: 2, wPerCh: 1000, kg: 9, pwr: 'iec' }),
  amp({ id: 'amp-4ch', name: nm('Amfi 4 kanal (4×1300 W)', 'Endstufe 4-Kanal (4×1300 W)', 'Amplifier 4-ch (4×1300 W)'), ch: 4, wPerCh: 1300, kg: 12, pwr: 'powercon' }),
  amp({ id: 'crown-xti4002', brand: 'Crown', model: 'XTi 4002', ch: 2, wPerCh: 1200, kg: 10, pwr: 'iec' }),
  amp({ id: 'ps-x4', brand: 'Powersoft', model: 'X4', ch: 4, wPerCh: 5200, kg: 12.5, pwr: 'true1', watt: 1200 }),
  amp({ id: 'la-la12x', brand: 'L-Acoustics', model: 'LA12X', ch: 4, wPerCh: 3300, kg: 15, pwr: 'cee16', watt: 1500 }),
  amp({ id: 'db-d80', brand: 'd&b audiotechnik', model: 'D80', ch: 4, wPerCh: 4000, kg: 19, pwr: 'cee16', watt: 1500 }),
  rackDev({
    id: 'dsp-pa2', cat: 'islem', name: nm('Hoparlör işlemcisi (DSP)', 'Lautsprecher-Controller (DSP)', 'Loudspeaker processor (DSP)'), brand: 'dbx', model: 'DriveRack PA2', icon: 'dsp', u: 1, kg: 2.5, watt: 25,
    ports: [pg('in', N.in, 'xlr', 'in', 'audio', 2, LR), pg('out', N.out, 'xlr', 'out', 'audio', 6), pg('net', N.net, 'rj45', 'io', 'network'), iec()], tags: ['dsp', 'controller', 'eq', 'crossover'],
  }),
  rackDev({
    id: 'dsp-4x8', cat: 'islem', name: nm('DSP matris 4×8', 'DSP-Matrix 4×8', 'DSP matrix 4×8'), icon: 'dsp', u: 1, kg: 3, watt: 30,
    ports: [pg('in', N.in, 'xlr', 'in', 'audio', 4), pg('out', N.out, 'xlr', 'out', 'audio', 8), pg('dante', 'Dante', 'rj45', 'io', 'digital'), pg('net', N.net, 'rj45', 'io', 'network'), iec()], tags: ['dsp', 'matrix', 'delay'],
  }),
  {
    id: 'di-passive', cat: 'islem', dept: 'ses', name: nm('DI kutusu (pasif)', 'DI-Box (passiv)', 'DI box (passive)'), brand: 'Radial', model: 'ProDI', icon: 'di', shape: 'box', w: 0.09, d: 0.13, h: 0.05, kg: 0.6,
    ports: [pg('in', N.in, 'jack', 'in', 'audio'), pg('thru', N.thru, 'jack', 'out', 'audio'), pg('out', N.out, 'xlr', 'out', 'audio')], mount: 'floor', tags: ['di', 'direct box'],
  },
  {
    id: 'di-active', cat: 'islem', dept: 'ses', name: nm('DI kutusu (aktif, +48 V)', 'DI-Box (aktiv, +48 V)', 'DI box (active, +48 V)'), brand: 'BSS', model: 'AR-133', icon: 'di', shape: 'box', w: 0.1, d: 0.15, h: 0.06, kg: 0.9,
    ports: [pg('in', N.in, 'jack', 'in', 'audio'), pg('thru', N.thru, 'jack', 'out', 'audio'), pg('out', N.out, 'xlr', 'out', 'audio')], mount: 'floor', props: { phantom: true }, tags: ['di', 'direct box', 'aktif'],
  },
  {
    id: 'di-stereo', cat: 'islem', dept: 'ses', name: nm('Stereo DI kutusu', 'Stereo-DI-Box', 'Stereo DI box'), brand: 'Radial', model: 'ProD2', icon: 'di', shape: 'box', w: 0.12, d: 0.13, h: 0.05, kg: 0.8,
    ports: [pg('in', N.in, 'jack', 'in', 'audio', 2, LR), pg('rca', 'RCA', 'rca', 'in', 'audio'), pg('jack35', '3,5 mm', 'jack35', 'in', 'audio'), pg('out', N.out, 'xlr', 'out', 'audio', 2, LR)], mount: 'floor', tags: ['di', 'stereo', 'laptop', 'telefon'],
  },
  rackDev({
    id: 'intercom-base', cat: 'islem', name: nm('İnterkom ana ünite', 'Intercom-Hauptstation', 'Intercom main station'), brand: 'Clear-Com', model: 'MS-702', icon: 'intercom', u: 1, kg: 3, watt: 40,
    ports: [pg('line', nm('Parti hattı', 'Partyline', 'Party line'), 'xlr', 'out', 'audio', 2, ['A', 'B']), iec()], tags: ['intercom', 'interkom', 'telsiz', 'kommunikation'],
  }),
  {
    id: 'intercom-bp', cat: 'islem', dept: 'ses', name: nm('İnterkom kemer ünitesi', 'Intercom-Gürtelstation', 'Intercom beltpack'), brand: 'Clear-Com', model: 'RS-703', icon: 'intercom', shape: 'box', plan: 'circle', w: 0.1, d: 0.05, h: 0.15, kg: 0.5,
    ports: [pg('in', N.in, 'xlr', 'in', 'audio'), pg('link', N.link, 'xlr', 'out', 'audio')], mount: 'stand', mountH: 1.1, tags: ['intercom', 'beltpack'],
  },

  // ===== DJ =====
  djDef({
    id: 'denon-prime4', name: nm('DJ sistemi (4 deck, bağımsız)', 'DJ-System (4 Decks, Standalone)', 'DJ system (4-deck standalone)'), brand: 'Denon DJ', model: 'Prime 4', icon: 'djcontroller', shape: 'djcontroller', w: 0.86, d: 0.46, h: 0.09, kg: 10.6, watt: 60,
    ports: [pg('mic', N.mic, 'combo', 'in', 'audio', 2), pg('aux', nm('Aux giriş', 'Aux-Eingang', 'Aux in'), 'rca', 'in', 'audio'), pg('master', nm('Master çıkış', 'Master-Ausgang', 'Master out'), 'xlr', 'out', 'audio', 2, LR), pg('mstb', nm('Master 2 (RCA)', 'Master 2 (Cinch)', 'Master 2 (RCA)'), 'rca', 'out', 'audio'), pg('booth', N.booth, 'jack', 'out', 'audio', 2, LR), pg('zone', nm('Zone çıkış', 'Zone-Ausgang', 'Zone out'), 'jack', 'out', 'audio', 2, LR), pg('usb', N.usb, 'usb', 'io', 'data'), pg('net', nm('Ağ (StageLinQ)', 'Netzwerk (StageLinQ)', 'Network (StageLinQ)'), 'rj45', 'io', 'network'), iec()],
    tags: ['prime', 'denon', 'engine', 'standalone', 'controller'],
  }),
  djDef({
    id: 'pio-cdj3000', name: nm('DJ medya oynatıcı', 'DJ-Mediaplayer', 'DJ media player'), brand: 'Pioneer DJ', model: 'CDJ-3000', icon: 'djplayer', shape: 'djplayer', w: 0.33, d: 0.45, h: 0.12, kg: 5.5, watt: 41,
    ports: [pg('out', N.out, 'rca', 'out', 'audio'), pg('dig', nm('Dijital çıkış', 'Digitalausgang', 'Digital out'), 'rca', 'out', 'digital'), pg('link', 'Pro DJ Link', 'rj45', 'io', 'network'), pg('usb', N.usb, 'usb', 'io', 'data'), iec()],
    tags: ['cdj', 'player', 'pioneer', 'rekordbox'],
  }),
  djDef({
    id: 'denon-sc6000', name: nm('DJ medya oynatıcı', 'DJ-Mediaplayer', 'DJ media player'), brand: 'Denon DJ', model: 'SC6000', icon: 'djplayer', shape: 'djplayer', w: 0.33, d: 0.44, h: 0.11, kg: 5.3, watt: 35,
    ports: [pg('out', N.out, 'rca', 'out', 'audio'), pg('dig', nm('Dijital çıkış', 'Digitalausgang', 'Digital out'), 'rca', 'out', 'digital'), pg('net', 'StageLinQ', 'rj45', 'io', 'network'), pg('usb', N.usb, 'usb', 'io', 'data'), iec()],
    tags: ['player', 'denon', 'engine'],
  }),
  djDef({
    id: 'pio-djm900', name: nm('DJ mikseri 4 kanal', 'DJ-Mixer 4-Kanal', 'DJ mixer 4-ch'), brand: 'Pioneer DJ', model: 'DJM-900NXS2', icon: 'djmixer', shape: 'djmixer', w: 0.33, d: 0.41, h: 0.11, kg: 7.3, watt: 39,
    ports: [pg('ch', N.ch, 'rca', 'in', 'audio', 4), pg('mic', N.mic, 'combo', 'in', 'audio', 2), pg('master', nm('Master çıkış', 'Master-Ausgang', 'Master out'), 'xlr', 'out', 'audio', 2, LR), pg('mstb', nm('Master 2 (RCA)', 'Master 2 (Cinch)', 'Master 2 (RCA)'), 'rca', 'out', 'audio'), pg('booth', N.booth, 'jack', 'out', 'audio', 2, LR), pg('usb', N.usb, 'usb', 'io', 'data'), pg('link', 'Pro DJ Link', 'rj45', 'io', 'network'), iec()],
    tags: ['djm', 'mixer', 'pioneer'],
  }),
  djDef({
    id: 'pio-djma9', name: nm('DJ mikseri 4 kanal', 'DJ-Mixer 4-Kanal', 'DJ mixer 4-ch'), brand: 'Pioneer DJ', model: 'DJM-A9', icon: 'djmixer', shape: 'djmixer', w: 0.33, d: 0.43, h: 0.11, kg: 8.1, watt: 41,
    ports: [pg('ch', N.ch, 'rca', 'in', 'audio', 4), pg('mic', N.mic, 'combo', 'in', 'audio', 2), pg('master', nm('Master çıkış', 'Master-Ausgang', 'Master out'), 'xlr', 'out', 'audio', 2, LR), pg('booth', N.booth, 'jack', 'out', 'audio', 2, LR), pg('usb', N.usb, 'usb', 'io', 'data'), pg('link', 'Pro DJ Link', 'rj45', 'io', 'network'), iec()],
    tags: ['djm', 'mixer', 'pioneer'],
  }),
  djDef({
    id: 'denon-x1850', name: nm('DJ mikseri 4 kanal', 'DJ-Mixer 4-Kanal', 'DJ mixer 4-ch'), brand: 'Denon DJ', model: 'X1850 Prime', icon: 'djmixer', shape: 'djmixer', w: 0.32, d: 0.41, h: 0.11, kg: 6.6, watt: 35,
    ports: [pg('ch', N.ch, 'rca', 'in', 'audio', 4), pg('mic', N.mic, 'combo', 'in', 'audio', 2), pg('master', nm('Master çıkış', 'Master-Ausgang', 'Master out'), 'xlr', 'out', 'audio', 2, LR), pg('booth', N.booth, 'jack', 'out', 'audio', 2, LR), pg('usb', N.usb, 'usb', 'io', 'data'), pg('net', 'StageLinQ', 'rj45', 'io', 'network'), iec()],
    tags: ['mixer', 'denon'],
  }),
  djDef({
    id: 'pio-xdjxz', name: nm('Hepsi bir arada DJ sistemi', 'All-in-One-DJ-System', 'All-in-one DJ system'), brand: 'Pioneer DJ', model: 'XDJ-XZ', icon: 'djcontroller', shape: 'djcontroller', w: 0.88, d: 0.47, h: 0.12, kg: 12.5, watt: 50,
    ports: [pg('mic', N.mic, 'combo', 'in', 'audio', 2), pg('master', nm('Master çıkış', 'Master-Ausgang', 'Master out'), 'xlr', 'out', 'audio', 2, LR), pg('booth', N.booth, 'jack', 'out', 'audio', 2, LR), pg('usb', N.usb, 'usb', 'io', 'data'), pg('link', 'Pro DJ Link', 'rj45', 'io', 'network'), iec()],
    tags: ['xdj', 'all in one', 'pioneer'],
  }),
  djDef({
    id: 'dj-controller', name: nm('DJ kontrolcü (laptop ile)', 'DJ-Controller (mit Laptop)', 'DJ controller (with laptop)'), brand: 'Pioneer DJ', model: 'DDJ-FLX10', icon: 'djcontroller', shape: 'djcontroller', w: 0.73, d: 0.4, h: 0.07, kg: 6, watt: 25,
    ports: [pg('mic', N.mic, 'combo', 'in', 'audio', 2), pg('master', nm('Master çıkış', 'Master-Ausgang', 'Master out'), 'xlr', 'out', 'audio', 2, LR), pg('booth', N.booth, 'jack', 'out', 'audio', 2, LR), pg('usb', N.usb, 'usb', 'io', 'data'), pg('pwr', nm('Adaptör', 'Netzteil', 'PSU'), 'schuko', 'in', 'power')],
    tags: ['controller', 'serato', 'rekordbox', 'ddj'],
  }),
  djDef({
    id: 'tech-1200', name: nm('Pikap', 'Plattenspieler', 'Turntable'), brand: 'Technics', model: 'SL-1200MK7', icon: 'turntable', shape: 'turntable', w: 0.45, d: 0.35, h: 0.16, kg: 9.6, watt: 15,
    ports: [pg('out', nm('Phono çıkış', 'Phono-Ausgang', 'Phono out'), 'rca', 'out', 'audio'), iec()], tags: ['pikap', 'vinyl', 'plak'],
  }),
  djDef({
    id: 'laptop', name: 'Laptop', icon: 'laptop', shape: 'laptop', w: 0.36, d: 0.25, h: 0.02, kg: 2, watt: 90,
    ports: [pg('usb', N.usb, 'usb', 'io', 'data', 2), pg('hp', nm('Kulaklık çıkışı', 'Kopfhörer', 'Headphone out'), 'jack35', 'out', 'audio'), pg('hdmi', N.hdmiOut, 'hdmi', 'out', 'video'), pg('net', N.net, 'rj45', 'io', 'network'), pg('pwr', nm('Adaptör', 'Netzteil', 'PSU'), 'schuko', 'in', 'power')],
    tags: ['laptop', 'macbook', 'bilgisayar', 'serato', 'computer'],
  }),
  {
    id: 'dj-booth', cat: 'dj', dept: 'dj', name: nm('DJ kabini / DJ masası', 'DJ-Pult / Booth', 'DJ booth'), icon: 'djbooth', shape: 'djbooth', w: 2.0, d: 0.8, h: 1.05, kg: 45,
    ports: [], mount: 'floor', tags: ['booth', 'kabin', 'masa', 'facade'],
  },
  {
    id: 'dj-headphones-amp', cat: 'dj', dept: 'dj', name: nm('DJ booth monitörü 8"', 'DJ-Booth-Monitor 8"', 'DJ booth monitor 8"'), icon: 'speaker', shape: 'speaker', w: 0.27, d: 0.27, h: 0.42, kg: 9, watt: 60, wattMax: 300,
    ports: [pg('in', N.in, 'combo', 'in', 'audio'), pg('pwr', N.pwr, 'iec', 'in', 'power')],
    acoustic: { kind: 'monitor', maxSpl: 118, hDisp: 90, vDisp: 60, fLow: 55, fHigh: 20000, powered: true, ampW: 400 }, mount: 'table', mountH: 1.05, props: { role: 'monitor', rot: 180 }, tags: ['booth', 'monitör', 'dj'],
  },

  // ===== MİKROFONLAR =====
  micDef({ id: 'shure-sm58', brand: 'Shure', model: 'SM58', name: nm('Vokal mikrofonu (dinamik)', 'Gesangsmikrofon (dynamisch)', 'Vocal mic (dynamic)'), tags: ['vokal', 'vocal', 'konuşma'] }),
  micDef({ id: 'shure-beta58', brand: 'Shure', model: 'Beta 58A', name: nm('Vokal mikrofonu (süperkardioid)', 'Gesangsmikrofon (Superniere)', 'Vocal mic (supercardioid)'), tags: ['vokal', 'vocal'] }),
  micDef({ id: 'shure-sm57', brand: 'Shure', model: 'SM57', name: nm('Enstrüman mikrofonu', 'Instrumentenmikrofon', 'Instrument mic'), stand: 'short', tags: ['trampet', 'snare', 'gitar amfi', 'zurna'] }),
  micDef({ id: 'shure-beta52', brand: 'Shure', model: 'Beta 52A', name: nm('Kick / bas davul mikrofonu', 'Bassdrum-Mikrofon', 'Kick drum mic'), stand: 'short', tags: ['kick', 'davul', 'bas davul'] }),
  micDef({ id: 'shure-beta91', brand: 'Shure', model: 'Beta 91A', name: nm('Sınır mikrofonu (kick içi)', 'Grenzflächenmikrofon', 'Boundary mic'), stand: 'none', phantom: true, tags: ['kick', 'boundary'] }),
  micDef({ id: 'senn-e604', brand: 'Sennheiser', model: 'e604', name: nm('Tom / perküsyon mikrofonu (klipsli)', 'Tom-Mikrofon (Klemme)', 'Tom mic (clip)'), stand: 'clip', tags: ['tom', 'darbuka', 'perküsyon', 'davul'] }),
  micDef({ id: 'senn-e906', brand: 'Sennheiser', model: 'e906', name: nm('Gitar amfi mikrofonu', 'Gitarren-Amp-Mikrofon', 'Guitar amp mic'), stand: 'none', tags: ['gitar', 'amfi'] }),
  micDef({ id: 'senn-md421', brand: 'Sennheiser', model: 'MD 421-II', name: nm('Çok amaçlı dinamik mikrofon', 'Universal-Dynamikmikrofon', 'All-round dynamic mic'), stand: 'short', tags: ['davul', 'zurna', 'tom', 'nefesli'] }),
  micDef({ id: 'shure-sm81', brand: 'Shure', model: 'SM81', name: nm('Kondenser mikrofon (overhead/akustik)', 'Kondensatormikrofon (Overhead)', 'Condenser mic (overhead)'), icon: 'condenser', phantom: true, tags: ['overhead', 'kondenser', 'bağlama', 'ud', 'kanun', 'keman'] }),
  micDef({ id: 'akg-c414', brand: 'AKG', model: 'C414 XLS', name: nm('Geniş diyafram kondenser', 'Großmembran-Kondensator', 'Large-diaphragm condenser'), icon: 'condenser', phantom: true, tags: ['kondenser', 'piyano', 'vokal'] }),
  micDef({ id: 'clip-cond', brand: 'DPA', model: '4099', name: nm('Klipsli enstrüman kondenseri', 'Clip-Kondensator', 'Clip-on condenser'), icon: 'condenser', stand: 'clip', phantom: true, tags: ['keman', 'kemençe', 'klarnet', 'saz', 'clip'] }),
  micDef({ id: 'mic-gooseneck', name: nm('Kürsü mikrofonu (gooseneck)', 'Schwanenhalsmikrofon', 'Gooseneck lectern mic'), brand: 'Shure', model: 'MX418', icon: 'condenser', stand: 'table', phantom: true, tags: ['kürsü', 'konuşma', 'speech'] }),
  wlMic({ id: 'shure-slxd24-58', brand: 'Shure', model: 'SLXD2/SM58', name: nm('Kablosuz el mikrofonu', 'Funk-Handmikrofon', 'Wireless handheld mic') }),
  wlMic({ id: 'senn-ewd835', brand: 'Sennheiser', model: 'EW-D 835-S', name: nm('Kablosuz el mikrofonu', 'Funk-Handmikrofon', 'Wireless handheld mic') }),
  wlMic({ id: 'shure-qlxd-b58', brand: 'Shure', model: 'QLXD2/Beta 58A', name: nm('Kablosuz el mikrofonu (pro)', 'Funk-Handmikrofon (Pro)', 'Wireless handheld mic (pro)') }),
  wlMic({ id: 'wl-headset', brand: 'Sennheiser', model: 'EW-D SK + HSP Essential', name: nm('Kablosuz headset (kafa mikrofonu)', 'Funk-Headset', 'Wireless headset'), icon: 'headset', tags: ['headset', 'kafa', 'sunucu'] }),
  wlMic({ id: 'wl-lav', brand: 'Sennheiser', model: 'EW-D SK + ME 4', name: nm('Kablosuz yaka mikrofonu', 'Funk-Lavalier', 'Wireless lavalier'), icon: 'headset', tags: ['yaka', 'lavalier', 'nikah', 'sunucu'] }),
  wlMic({ id: 'wl-inst', brand: 'Shure', model: 'GLXD16+', name: nm('Kablosuz enstrüman vericisi', 'Funk-Instrumentensender', 'Wireless instrument transmitter'), icon: 'micwireless', tags: ['gitar', 'bağlama', 'kablosuz'] }),
  wlRx({ id: 'shure-slxd4', brand: 'Shure', model: 'SLXD4', ch: 1 }),
  wlRx({ id: 'shure-slxd4d', brand: 'Shure', model: 'SLXD4D', ch: 2 }),
  wlRx({ id: 'senn-ewdem', brand: 'Sennheiser', model: 'EW-DX EM 2', ch: 2 }),
  wlRx({ id: 'shure-qlxd4', brand: 'Shure', model: 'QLXD4', ch: 1 }),

  // ===== ENSTRÜMANLAR =====
  instr({ id: 'drumkit', name: nm('Davul seti (bateri)', 'Schlagzeug', 'Drum kit'), icon: 'drums', shape: 'drumkit', dims: [2.0, 1.8, 1.4], kg: 45, tags: ['bateri', 'drums', 'schlagzeug', 'davul seti'], desc: nm('Önerilen: 2×3 m halı / podest, 5–8 mikrofon.', 'Empfohlen: 2×3 m Teppich/Podest, 5–8 Mikrofone.', 'Recommended: 2×3 m rug/riser, 5–8 mics.') }),
  instr({ id: 'davul', name: nm('Davul (Türk davulu)', 'Davul (türkische Trommel)', 'Davul (Turkish drum)'), icon: 'davul', shape: 'davul', plan: 'circle', dims: [0.7, 0.5, 1.4], kg: 8, tags: ['davul', 'zurna', 'halay', 'tokmak'], desc: nm('Çok yüksek ses: mikrofonu 1–2 m uzağa koy.', 'Sehr laut: Mikro 1–2 m entfernt.', 'Very loud: place mic 1–2 m away.') }),
  instr({ id: 'zurna', name: nm('Zurna', 'Zurna', 'Zurna'), icon: 'zurna', shape: 'pipe', plan: 'circle', dims: [0.5, 0.5, 1.7], kg: 0.5, tags: ['zurna', 'davul', 'halay'] }),
  instr({ id: 'klarnet', name: nm('Klarnet', 'Klarinette', 'Clarinet'), icon: 'clarinet', shape: 'pipe', plan: 'circle', dims: [0.5, 0.5, 1.7], kg: 0.8, tags: ['klarnet', 'roman', 'çiftetelli'] }),
  instr({ id: 'kaval', name: nm('Kaval / ney', 'Kaval / Ney', 'Kaval / ney'), icon: 'clarinet', shape: 'pipe', plan: 'circle', dims: [0.5, 0.5, 1.7], kg: 0.3, tags: ['kaval', 'ney', 'flüt'] }),
  instr({ id: 'baglama', name: nm('Elektro bağlama (saz)', 'Elektro-Bağlama (Saz)', 'Electric bağlama (saz)'), icon: 'baglama', shape: 'string', plan: 'circle', dims: [0.6, 0.5, 1.5], kg: 2, ports: [pg('out', N.pickup, 'jack', 'out', 'audio')], tags: ['bağlama', 'saz', 'ankara', 'türkü'] }),
  instr({ id: 'ud', name: nm('Ud', 'Oud', 'Oud'), icon: 'ud', shape: 'string', plan: 'circle', dims: [0.6, 0.5, 1.4], kg: 2, ports: [pg('out', N.pickup, 'jack', 'out', 'audio')], tags: ['ud', 'oud'] }),
  instr({ id: 'kanun', name: nm('Kanun', 'Kanun', 'Kanun'), icon: 'kanun', shape: 'table', dims: [1.0, 0.45, 0.8], kg: 6, ports: [pg('out', N.pickup, 'jack', 'out', 'audio')], tags: ['kanun', 'qanun'] }),
  instr({ id: 'keman', name: nm('Keman', 'Violine', 'Violin'), icon: 'violin', shape: 'string', plan: 'circle', dims: [0.5, 0.5, 1.6], kg: 0.6, ports: [pg('out', N.pickup, 'jack', 'out', 'audio')], tags: ['keman', 'violin', 'geige'] }),
  instr({ id: 'kemence', name: nm('Kemençe (Karadeniz)', 'Kemençe (Schwarzmeer)', 'Kemençe (Black Sea fiddle)'), icon: 'violin', shape: 'string', plan: 'circle', dims: [0.5, 0.5, 1.5], kg: 0.5, ports: [pg('out', N.pickup, 'jack', 'out', 'audio')], tags: ['kemençe', 'horon', 'karadeniz'] }),
  instr({ id: 'darbuka', name: nm('Darbuka', 'Darbuka', 'Darbuka'), icon: 'darbuka', shape: 'darbuka', plan: 'circle', dims: [0.5, 0.5, 0.6], kg: 3, tags: ['darbuka', 'perküsyon', 'çiftetelli'] }),
  instr({ id: 'def', name: nm('Def / bendir', 'Def / Bendir', 'Def / bendir'), icon: 'darbuka', shape: 'darbuka', plan: 'circle', dims: [0.5, 0.5, 0.6], kg: 1, tags: ['def', 'bendir', 'perküsyon'] }),
  instr({ id: 'tulum', name: nm('Tulum', 'Tulum (Dudelsack)', 'Tulum (bagpipe)'), icon: 'zurna', shape: 'pipe', plan: 'circle', dims: [0.6, 0.5, 1.7], kg: 1.5, tags: ['tulum', 'karadeniz', 'horon'] }),
  instr({ id: 'org', name: nm('Org / aranjör klavye', 'Arranger-Keyboard', 'Arranger keyboard'), icon: 'keyboard', shape: 'keyboard', dims: [1.25, 0.45, 1.0], kg: 15, watt: 50, mountH: 0.8, ports: [pg('out', N.out, 'jack', 'out', 'audio', 2, LR), pg('midi', 'MIDI', 'midi', 'io', 'data'), pg('usb', N.usb, 'usb', 'io', 'data'), pg('pwr', N.pwr, 'iec', 'in', 'power')], tags: ['org', 'korg', 'yamaha', 'genos', 'pa5x', 'klavye', 'keyboard', 'aranjör'] }),
  instr({ id: 'stagepiano', name: nm('Sahne piyanosu / synth', 'Stagepiano / Synth', 'Stage piano / synth'), icon: 'keyboard', shape: 'keyboard', dims: [1.35, 0.4, 1.0], kg: 18, watt: 40, mountH: 0.8, ports: [pg('out', N.out, 'jack', 'out', 'audio', 2, LR), pg('midi', 'MIDI', 'midi', 'io', 'data'), pg('pwr', N.pwr, 'iec', 'in', 'power')], tags: ['piyano', 'nord', 'synth', 'keyboard'] }),
  instr({ id: 'piano', name: nm('Kuyruklu piyano', 'Flügel', 'Grand piano'), icon: 'piano', shape: 'piano', dims: [1.5, 2.0, 1.0], kg: 350, tags: ['piyano', 'piano', 'flügel'] }),
  instr({ id: 'egitar', name: nm('Elektro gitar', 'E-Gitarre', 'Electric guitar'), icon: 'guitar', shape: 'guitar', plan: 'circle', dims: [0.5, 0.5, 1.0], kg: 4, ports: [pg('out', N.out, 'jack', 'out', 'audio')], tags: ['gitar', 'guitar'] }),
  instr({ id: 'agitar', name: nm('Akustik gitar (elektro)', 'Akustikgitarre (elektrisch)', 'Acoustic guitar (electric)'), icon: 'guitar', shape: 'guitar', plan: 'circle', dims: [0.5, 0.5, 1.0], kg: 2.5, ports: [pg('out', N.out, 'jack', 'out', 'audio')], tags: ['gitar', 'akustik'] }),
  instr({ id: 'bas', name: nm('Bas gitar', 'E-Bass', 'Bass guitar'), icon: 'bass', shape: 'guitar', plan: 'circle', dims: [0.5, 0.5, 1.2], kg: 4.5, ports: [pg('out', N.out, 'jack', 'out', 'audio')], tags: ['bas', 'bass'] }),
  instr({ id: 'gitar-amp', name: nm('Gitar amfisi (kombo)', 'Gitarrenverstärker (Combo)', 'Guitar amp (combo)'), icon: 'guitaramp', shape: 'ampcombo', dims: [0.6, 0.27, 0.48], kg: 20, watt: 100, ports: [pg('in', N.in, 'jack', 'in', 'audio'), pg('pwr', N.pwr, 'iec', 'in', 'power')], tags: ['amfi', 'gitar', 'combo'] }),
  instr({ id: 'bas-amp', name: nm('Bas amfisi', 'Bassverstärker', 'Bass amp'), icon: 'guitaramp', shape: 'ampcombo', dims: [0.6, 0.45, 0.8], kg: 30, watt: 200, ports: [pg('in', N.in, 'jack', 'in', 'audio'), pg('di', nm('DI çıkış', 'DI-Ausgang', 'DI out'), 'xlr', 'out', 'audio'), pg('pwr', N.pwr, 'iec', 'in', 'power')], tags: ['amfi', 'bas'] }),
  instr({ id: 'percset', name: nm('Perküsyon seti (konga, bongo)', 'Percussion-Set (Conga, Bongo)', 'Percussion set (conga, bongo)'), icon: 'darbuka', shape: 'darbuka', dims: [1.2, 0.9, 1.0], kg: 20, tags: ['konga', 'bongo', 'perküsyon'] }),
  instr({ id: 'vokal', name: nm('Vokalist / sunucu (kişi)', 'Sänger / Moderator', 'Vocalist / MC'), icon: 'person', shape: 'person', plan: 'circle', dims: [0.5, 0.35, 1.75], kg: 0, tags: ['vokal', 'şarkıcı', 'sunucu', 'kişi'] }),

  // ===== IŞIK =====
  light({ id: 'mh-spot', name: nm('Moving head spot', 'Moving Head Spot', 'Moving head spot'), icon: 'movinghead', shape: 'movinghead', dims: [0.38, 0.3, 0.55], kg: 18, watt: 450, pwr: 'true1', tags: ['moving', 'robot', 'spot'] }),
  light({ id: 'mh-beam', name: nm('Moving head beam', 'Moving Head Beam', 'Moving head beam'), icon: 'movinghead', shape: 'movinghead', dims: [0.35, 0.28, 0.5], kg: 16, watt: 380, pwr: 'true1', tags: ['moving', 'beam', 'sharpy'] }),
  light({ id: 'mh-wash', name: nm('Moving head wash (LED)', 'Moving Head Wash (LED)', 'Moving head wash (LED)'), icon: 'movinghead', shape: 'movinghead', dims: [0.38, 0.3, 0.45], kg: 12, watt: 400, pwr: 'powercon', tags: ['moving', 'wash'] }),
  light({ id: 'par-led', name: nm('LED PAR', 'LED-PAR', 'LED PAR'), icon: 'par', shape: 'par', dims: [0.25, 0.2, 0.28], kg: 3, watt: 120, pwr: 'powercon', tags: ['par', 'led'] }),
  light({ id: 'uplight-bat', name: nm('Akülü uplight (kablosuz DMX)', 'Akku-Uplight (Funk-DMX)', 'Battery uplight (wireless DMX)'), icon: 'uplight', shape: 'par', dims: [0.18, 0.18, 0.22], kg: 2.5, watt: 0, dmx: 'none', pwr: 'none', tags: ['uplight', 'akü', 'duvar', 'düğün'], desc: nm('Duvar dibine; şarjlı. Etkinlikten önce tam şarj et.', 'Akku – vorher voll laden.', 'Battery – charge fully before the event.'), extra: [pg('rf', N.rf, 'antenna', 'in', 'wireless')] }),
  light({ id: 'ledbar', name: nm('LED bar', 'LED-Bar', 'LED bar'), icon: 'ledbar', shape: 'ledbar', dims: [1.0, 0.1, 0.1], kg: 4, watt: 150, pwr: 'powercon', tags: ['bar', 'led'] }),
  light({ id: 'strobe', name: nm('Strob', 'Stroboskop', 'Strobe'), icon: 'strobe', shape: 'box', dims: [0.5, 0.15, 0.25], kg: 6, watt: 500, pwr: 'powercon', tags: ['strobe', 'flaş'] }),
  light({ id: 'blinder', name: nm('Blinder (2 lamba)', 'Blinder (2-fach)', 'Blinder (2-lite)'), icon: 'strobe', shape: 'box', dims: [0.5, 0.15, 0.3], kg: 5, watt: 300, pwr: 'powercon', tags: ['blinder'] }),
  light({ id: 'hazer', name: nm('Hazer (pus makinesi)', 'Hazer', 'Hazer'), icon: 'hazer', shape: 'box', dims: [0.45, 0.3, 0.3], kg: 12, watt: 700, pwr: 'iec', tags: ['hazer', 'pus', 'duman'], desc: nm('Yangın alarmını mekanla konuş!', 'Brandmelder mit Location klären!', 'Check fire alarms with the venue!') }),
  light({ id: 'fog', name: nm('Sis makinesi', 'Nebelmaschine', 'Fog machine'), icon: 'hazer', shape: 'box', dims: [0.5, 0.3, 0.25], kg: 10, watt: 1500, pwr: 'iec', tags: ['sis', 'duman', 'fog'], desc: nm('Yangın alarmını mekanla konuş!', 'Brandmelder mit Location klären!', 'Check fire alarms with the venue!') }),
  light({ id: 'lowfog', name: nm('Yer bulutu (low fog / ilk dans)', 'Bodennebel (Hochzeitstanz)', 'Low fog (first dance)'), icon: 'hazer', shape: 'box', dims: [0.6, 0.4, 0.4], kg: 20, watt: 1500, pwr: 'iec', tags: ['bulut', 'ilk dans', 'low fog', 'dans'] }),
  light({ id: 'spark', name: nm('Soğuk kıvılcım (Sparkular)', 'Kaltfunken-Maschine', 'Cold spark machine'), icon: 'spark', shape: 'box', dims: [0.3, 0.3, 0.35], kg: 9, watt: 600, pwr: 'iec', tags: ['kıvılcım', 'volkan', 'gelin girişi', 'spark'], desc: nm('Önünde 2 m boş alan bırak.', '2 m Sicherheitsabstand.', 'Keep 2 m clear in front.') }),
  light({ id: 'followspot', name: nm('Takip spotu', 'Verfolger', 'Follow spot'), icon: 'followspot', shape: 'followspot', dims: [0.5, 1.1, 1.6], kg: 30, watt: 600, pwr: 'schuko', dmx: 'none', tags: ['takip', 'follow', 'spot'] }),
  light({ id: 'laser', name: nm('Lazer (gösteri)', 'Showlaser', 'Show laser'), icon: 'strobe', shape: 'box', dims: [0.3, 0.3, 0.15], kg: 5, watt: 100, pwr: 'iec', tags: ['lazer', 'laser'], desc: nm('Seyirci taraması yasal izin ister (Laserschutzbeauftragter).', 'Publikumsscanning nur mit LSB.', 'Audience scanning requires a laser safety officer.') }),
  {
    id: 'dmx-desk', cat: 'isik', dept: 'isik', name: nm('Işık masası (DMX)', 'Lichtpult (DMX)', 'Lighting console (DMX)'), icon: 'lightdesk', shape: 'console', w: 0.7, d: 0.45, h: 0.15, kg: 10, watt: 80,
    ports: [pg('dmx', N.dmxOut, 'dmx5', 'out', 'dmx', 2, ['A', 'B']), pg('artnet', 'Art-Net / sACN', 'rj45', 'io', 'network'), pg('usb', N.usb, 'usb', 'io', 'data'), iec()], mount: 'table', mountH: 0.75, tags: ['ışık masası', 'lichtpult', 'dmx', 'grandma', 'chamsys'],
  },
  {
    id: 'dmx-wl-tx', cat: 'isik', dept: 'isik', name: nm('Kablosuz DMX vericisi', 'Funk-DMX-Sender', 'Wireless DMX transmitter'), icon: 'receiver', shape: 'box', w: 0.12, d: 0.08, h: 0.04, kg: 0.4, watt: 5,
    ports: [pg('dmxin', N.dmxIn, 'dmx3', 'in', 'dmx'), pg('rf', N.rf, 'antenna', 'out', 'wireless'), pg('pwr', N.pwr, 'schuko', 'in', 'power')], mount: 'table', mountH: 0.75, range: 300, tags: ['kablosuz dmx', 'w-dmx'],
  },
  {
    id: 'dmx-split', cat: 'isik', dept: 'isik', name: nm('DMX splitter 1→4', 'DMX-Splitter 1→4', 'DMX splitter 1→4'), icon: 'dsp', shape: 'rack', w: 0.48, d: 0.15, h: 0.044, kg: 2, watt: 10,
    ports: [pg('dmxin', N.dmxIn, 'dmx3', 'in', 'dmx'), pg('dmxout', N.dmxOut, 'dmx3', 'out', 'dmx', 4), iec()], mount: 'table', mountH: 0.75, tags: ['dmx', 'splitter', 'booster'],
  },
  simple({ id: 'tbar', cat: 'isik', dept: 'isik', name: nm('Işık standı + T-bar (4 armatür)', 'Lichtstativ + T-Bar', 'Lighting stand + T-bar'), icon: 'lightstand', shape: 'tbar', dims: [1.2, 1.2, 2.8], kg: 12, plan: 'circle', tags: ['stand', 't-bar', 'ışık standı'] }),
  simple({ id: 'windup', cat: 'isik', dept: 'isik', name: nm('Wind-up stand (krank)', 'Kurbelstativ', 'Wind-up stand'), icon: 'lightstand', shape: 'tbar', dims: [1.6, 1.6, 4.5], kg: 40, plan: 'circle', tags: ['wind up', 'kurbel', 'krank'] }),

  // ===== TRUSS & RIGGING =====
  simple({ id: 'truss-1', cat: 'truss', dept: 'isik', name: nm('Truss F34 – 1 m', 'Traverse F34 – 1 m', 'Truss F34 – 1 m'), icon: 'truss', shape: 'truss', dims: [1.0, 0.29, 0.29], kg: 5, mount: 'flown', mountH: 3.5, tags: ['truss', 'traverse', 'f34'] }),
  simple({ id: 'truss-2', cat: 'truss', dept: 'isik', name: nm('Truss F34 – 2 m', 'Traverse F34 – 2 m', 'Truss F34 – 2 m'), icon: 'truss', shape: 'truss', dims: [2.0, 0.29, 0.29], kg: 9, mount: 'flown', mountH: 3.5, tags: ['truss', 'traverse', 'f34'] }),
  simple({ id: 'truss-3', cat: 'truss', dept: 'isik', name: nm('Truss F34 – 3 m', 'Traverse F34 – 3 m', 'Truss F34 – 3 m'), icon: 'truss', shape: 'truss', dims: [3.0, 0.29, 0.29], kg: 13, mount: 'flown', mountH: 3.5, tags: ['truss', 'traverse', 'f34'] }),
  simple({ id: 'truss-corner', cat: 'truss', dept: 'isik', name: nm('Truss köşe (4 yön)', 'Traversen-Ecke (4-Weg)', 'Truss corner (4-way)'), icon: 'truss', shape: 'truss', dims: [0.29, 0.29, 0.29], kg: 4, mount: 'flown', mountH: 3.5, tags: ['truss', 'köşe', 'ecke'] }),
  simple({ id: 'truss-tower', cat: 'truss', dept: 'isik', name: nm('Truss kule (ground support)', 'Traversenturm (Ground Support)', 'Truss tower (ground support)'), icon: 'trusstower', shape: 'trusstower', dims: [0.6, 0.6, 4.5], kg: 60, tags: ['ground support', 'kule', 'turm', 'goalpost'] }),
  simple({ id: 'hoist', cat: 'truss', dept: 'isik', name: nm('Zincirli motor (D8+, 500 kg)', 'Kettenzug (D8+, 500 kg)', 'Chain hoist (D8+, 500 kg)'), icon: 'hoist', shape: 'hoist', dims: [0.35, 0.35, 0.6], kg: 30, watt: 900, mount: 'flown', mountH: 6, ports: [pg('pwr', N.pwr, 'cee16r', 'in', 'power')], tags: ['motor', 'hoist', 'kettenzug', 'caraskal'] }),
  simple({ id: 'spk-stand', cat: 'truss', dept: 'ses', name: nm('Hoparlör standı (tripod)', 'Lautsprecherstativ', 'Speaker stand (tripod)'), brand: 'K&M', model: '21436', icon: 'speakerstand', shape: 'speakerstand', dims: [1.3, 1.3, 2.0], kg: 4, plan: 'circle', tags: ['stand', 'tripod', 'stativ'], desc: nm('Hoparlörü "stand" bağlantısıyla eklersen stand otomatik sayılır.', 'Wird bei Montage "Stativ" automatisch gezählt.', 'Counted automatically when a speaker is mounted on a stand.') }),

  // ===== GÖRÜNTÜ =====
  {
    id: 'ledwall', cat: 'video', dept: 'video', name: nm('LED ekran (modüler, 50×50 cm panel)', 'LED-Wand (50×50 cm Module)', 'LED wall (50×50 cm panels)'), icon: 'ledwall', shape: 'ledwall', w: 4.0, d: 0.15, h: 2.5, kg: 8 * 40, watt: 40 * 150,
    ports: [pg('data', nm('Veri girişi', 'Dateneingang', 'Data in'), 'rj45', 'in', 'video', 2), pg('pwr', N.pwr, 'cee16r', 'in', 'power')], mount: 'floor', props: { panel: 0.5 }, tags: ['led', 'ekran', 'wall', 'video'],
    desc: nm('Boyutu değiştir; panel sayısı ve güç otomatik hesaplanır.', 'Größe ändern – Module und Leistung werden berechnet.', 'Resize it – panel count and power are calculated.'),
  },
  {
    id: 'led-proc', cat: 'video', dept: 'video', name: nm('LED video işlemcisi', 'LED-Videoprozessor', 'LED video processor'), brand: 'Novastar', model: 'VX600', icon: 'videoswitch', shape: 'rack', w: 0.48, d: 0.3, h: 0.09, kg: 4, watt: 50,
    ports: [pg('hdmi', N.hdmiIn, 'hdmi', 'in', 'video', 2), pg('out', nm('LED çıkışı', 'LED-Ausgang', 'LED out'), 'rj45', 'out', 'video', 6), iec()], mount: 'table', mountH: 0.75, tags: ['novastar', 'led', 'processor'],
  },
  {
    id: 'projector', cat: 'video', dept: 'video', name: nm('Projeksiyon (6000 lm)', 'Beamer (6000 lm)', 'Projector (6000 lm)'), icon: 'projector', shape: 'projector', w: 0.48, d: 0.4, h: 0.17, kg: 9, watt: 450,
    ports: [pg('hdmi', N.hdmiIn, 'hdmi', 'in', 'video'), pg('sdi', 'SDI', 'sdi', 'in', 'video'), pg('net', N.net, 'rj45', 'io', 'network'), iec()], mount: 'table', mountH: 1.2, tags: ['projeksiyon', 'beamer', 'projector'],
  },
  simple({ id: 'screen', cat: 'video', dept: 'video', name: nm('Projeksiyon perdesi 3×2 m', 'Leinwand 3×2 m', 'Projection screen 3×2 m'), icon: 'screen', shape: 'screen', dims: [3.2, 0.6, 2.8], kg: 25, tags: ['perde', 'leinwand', 'screen'] }),
  {
    id: 'tv65', cat: 'video', dept: 'video', name: nm('TV / monitör 65" (standlı)', 'TV / Monitor 65" (Stativ)', 'TV / monitor 65" (stand)'), icon: 'tv', shape: 'tv', w: 1.46, d: 0.6, h: 1.8, kg: 40, watt: 200,
    ports: [pg('hdmi', N.hdmiIn, 'hdmi', 'in', 'video', 2), pg('pwr', N.pwr, 'iec', 'in', 'power')], mount: 'floor', tags: ['tv', 'monitör', 'ekran'],
  },
  {
    id: 'camera', cat: 'video', dept: 'video', name: nm('Video kamera (tripod)', 'Videokamera (Stativ)', 'Video camera (tripod)'), icon: 'camera', shape: 'camera', plan: 'circle', w: 0.8, d: 0.8, h: 1.6, kg: 8, watt: 30,
    ports: [pg('sdi', nm('SDI çıkış', 'SDI-Ausgang', 'SDI out'), 'sdi', 'out', 'video'), pg('hdmi', N.hdmiOut, 'hdmi', 'out', 'video'), pg('audio', nm('Ses girişi', 'Audio-Eingang', 'Audio in'), 'xlr', 'in', 'audio', 2), pg('pwr', N.pwr, 'schuko', 'in', 'power')], mount: 'floor', tags: ['kamera', 'camera', 'çekim', 'video'],
  },
  {
    id: 'atem-mini', cat: 'video', dept: 'video', name: nm('Video mikseri (4 HDMI)', 'Videomischer (4× HDMI)', 'Video switcher (4× HDMI)'), brand: 'Blackmagic', model: 'ATEM Mini Pro', icon: 'videoswitch', shape: 'box', w: 0.24, d: 0.1, h: 0.04, kg: 1, watt: 20,
    ports: [pg('in', N.hdmiIn, 'hdmi', 'in', 'video', 4), pg('out', N.hdmiOut, 'hdmi', 'out', 'video'), pg('audio', nm('Ses girişi', 'Audio-Eingang', 'Audio in'), 'jack35', 'in', 'audio', 2), pg('net', N.net, 'rj45', 'io', 'network'), pg('usb', N.usb, 'usb', 'io', 'data'), pg('pwr', nm('Adaptör', 'Netzteil', 'PSU'), 'schuko', 'in', 'power')], mount: 'table', mountH: 0.75, tags: ['atem', 'switcher', 'stream', 'yayın'],
  },

  // ===== ELEKTRİK =====
  {
    id: 'wall-schuko', cat: 'elektrik', dept: 'elektrik', name: nm('Duvar prizi 2× Schuko (16 A)', 'Wandsteckdose 2× Schuko (16 A)', 'Wall socket 2× Schuko (16 A)'), icon: 'outlet', shape: 'outlet', w: 0.16, d: 0.06, h: 0.08, kg: 0,
    ports: [pg('out', N.sock, 'schuko', 'out', 'power', 2)], source: { voltage: 230, breakerA: 16, phases: 1 }, mount: 'wall', mountH: 0.3, props: { phaseOf: 'L1' }, tags: ['priz', 'steckdose', 'schuko', 'duvar'],
    desc: nm('Aynı sigortaya bağlı prizleri tek kaynak say. Sigorta değerini mekandan öğren.', 'Steckdosen am selben Stromkreis als eine Quelle zählen.', 'Treat sockets on the same breaker as one source.'),
  },
  {
    id: 'wall-cee16', cat: 'elektrik', dept: 'elektrik', name: nm('CEE 16 A mavi priz (230 V)', 'CEE 16 A blau (230 V)', 'CEE 16 A blue (230 V)'), icon: 'cee', shape: 'outlet', w: 0.12, d: 0.1, h: 0.14, kg: 0,
    ports: [pg('out', N.sock, 'cee16', 'out', 'power')], source: { voltage: 230, breakerA: 16, phases: 1 }, mount: 'wall', mountH: 0.5, tags: ['cee', 'mavi', 'blau', 'camping'],
  },
  {
    id: 'wall-cee16r', cat: 'elektrik', dept: 'elektrik', name: nm('CEE 16 A kırmızı priz (3 faz)', 'CEE 16 A rot (Drehstrom)', 'CEE 16 A red (3-phase)'), icon: 'cee', shape: 'outlet', w: 0.12, d: 0.1, h: 0.14, kg: 0,
    ports: [pg('out', N.sock, 'cee16r', 'out', 'power')], source: { voltage: 400, breakerA: 16, phases: 3 }, mount: 'wall', mountH: 0.5, tags: ['cee', 'kırmızı', 'rot', 'drehstrom', 'kraftstrom', '3 faz'],
  },
  {
    id: 'wall-cee32r', cat: 'elektrik', dept: 'elektrik', name: nm('CEE 32 A kırmızı priz (3 faz)', 'CEE 32 A rot (Drehstrom)', 'CEE 32 A red (3-phase)'), icon: 'cee', shape: 'outlet', w: 0.14, d: 0.12, h: 0.16, kg: 0,
    ports: [pg('out', N.sock, 'cee32r', 'out', 'power')], source: { voltage: 400, breakerA: 32, phases: 3 }, mount: 'wall', mountH: 0.5, tags: ['cee', 'kırmızı', 'rot', 'drehstrom', '32a', '3 faz'],
  },
  {
    id: 'wall-cee63r', cat: 'elektrik', dept: 'elektrik', name: nm('CEE 63 A kırmızı priz (3 faz)', 'CEE 63 A rot (Drehstrom)', 'CEE 63 A red (3-phase)'), icon: 'cee', shape: 'outlet', w: 0.18, d: 0.14, h: 0.2, kg: 0,
    ports: [pg('out', N.sock, 'cee63r', 'out', 'power')], source: { voltage: 400, breakerA: 63, phases: 3 }, mount: 'wall', mountH: 0.5, tags: ['cee', '63a', '3 faz'],
  },
  {
    id: 'generator', cat: 'elektrik', dept: 'elektrik', name: nm('Jeneratör 20 kVA (sessiz)', 'Stromaggregat 20 kVA (schallgedämmt)', 'Generator 20 kVA (silent)'), icon: 'generator', shape: 'generator', w: 2.0, d: 0.9, h: 1.2, kg: 650,
    ports: [pg('cee32', N.sock, 'cee32r', 'out', 'power'), pg('cee16', N.sock, 'cee16r', 'out', 'power', 2), pg('schuko', N.sock, 'schuko', 'out', 'power', 2, undefined, { phases: ['L1', 'L2'], breakerA: 16 })],
    source: { voltage: 400, breakerA: 32, phases: 3, kva: 20 }, mount: 'floor', tags: ['jeneratör', 'aggregat', 'generator'],
    desc: nm('Egzozu seyirciden uzağa; topraklama kazığı ve yakıt planı.', 'Abgas weg vom Publikum; Erdungsspieß.', 'Exhaust away from the audience; earth rod.'),
  },
  {
    id: 'distro-32', cat: 'elektrik', dept: 'elektrik', name: nm('Dağıtıcı CEE 32 A → 1× CEE 16 + 6× Schuko', 'Stromverteiler 32 A → 1× CEE 16 + 6× Schuko', 'Distro 32 A → 1× CEE 16 + 6× Schuko'), icon: 'distro', shape: 'distro', w: 0.45, d: 0.3, h: 0.35, kg: 12,
    ports: [pg('in', N.in, 'cee32r', 'in', 'power'), pg('cee', N.sock, 'cee16r', 'out', 'power', 1, undefined, { breakerA: 16 }), pg('out', N.sock, 'schuko', 'out', 'power', 6, undefined, { phases: ['L1', 'L1', 'L2', 'L2', 'L3', 'L3'], breakerA: 16 })],
    mount: 'floor', tags: ['dağıtıcı', 'distro', 'verteiler', 'stromverteiler', 'pano'], desc: nm('FI/RCD 30 mA dahil olmalı.', 'Mit FI 30 mA.', 'Must include 30 mA RCD.'),
  },
  {
    id: 'distro-16', cat: 'elektrik', dept: 'elektrik', name: nm('Dağıtıcı CEE 16 A (3 faz) → 6× Schuko', 'Stromverteiler 16 A → 6× Schuko', 'Distro 16 A (3-phase) → 6× Schuko'), icon: 'distro', shape: 'distro', w: 0.35, d: 0.25, h: 0.3, kg: 8,
    ports: [pg('in', N.in, 'cee16r', 'in', 'power'), pg('out', N.sock, 'schuko', 'out', 'power', 6, undefined, { phases: ['L1', 'L1', 'L2', 'L2', 'L3', 'L3'], breakerA: 16 })],
    mount: 'floor', tags: ['dağıtıcı', 'distro', 'verteiler'],
  },
  {
    id: 'distro-63', cat: 'elektrik', dept: 'elektrik', name: nm('Ana dağıtıcı 63 A → 2× CEE 32 + 3× CEE 16 + 6× Schuko', 'Hauptverteiler 63 A', 'Main distro 63 A'), icon: 'distro', shape: 'distro', w: 0.6, d: 0.4, h: 0.5, kg: 30,
    ports: [pg('in', N.in, 'cee63r', 'in', 'power'), pg('cee32', N.sock, 'cee32r', 'out', 'power', 2, undefined, { breakerA: 32 }), pg('cee16', N.sock, 'cee16r', 'out', 'power', 3, undefined, { breakerA: 16 }), pg('out', N.sock, 'schuko', 'out', 'power', 6, undefined, { phases: ['L1', 'L1', 'L2', 'L2', 'L3', 'L3'], breakerA: 16 })],
    mount: 'floor', tags: ['ana dağıtıcı', 'hauptverteiler', '63a'],
  },
  {
    id: 'cee16-box', cat: 'elektrik', dept: 'elektrik', name: nm('CEE 16 A mavi → 3× Schuko kutusu', 'CEE 16 A blau → 3× Schuko', 'CEE 16 A blue → 3× Schuko box'), icon: 'distro', shape: 'distro', w: 0.25, d: 0.2, h: 0.2, kg: 3,
    ports: [pg('in', N.in, 'cee16', 'in', 'power'), pg('out', N.sock, 'schuko', 'out', 'power', 3)], mount: 'floor', tags: ['cee', 'adaptör', 'verteiler'],
  },
  {
    id: 'adp-cee32-16', cat: 'elektrik', dept: 'elektrik', name: nm('Adaptör CEE 32 A → CEE 16 A (5 pin, sigortalı)', 'Adapter CEE 32 A → CEE 16 A (rot, abgesichert)', 'Adapter CEE 32 A → CEE 16 A (red, fused)'), icon: 'cee', shape: 'box', w: 0.14, d: 0.1, h: 0.22, kg: 1.4,
    ports: [pg('in', N.in, 'cee32r', 'in', 'power'), pg('out', N.sock, 'cee16r', 'out', 'power', 1, undefined, { breakerA: 16 })], mount: 'floor', tags: ['adaptör', 'adapter', '32a', '16a', 'cee', 'kırmızı'],
    desc: nm('Prize doğrudan takılır. 16 A sigortalı olanı kullan.', 'Direkt in die Dose. Abgesicherte Version verwenden.', 'Plugs straight into the socket. Use a fused one.'),
  },
  {
    id: 'adp-cee16r-schuko', cat: 'elektrik', dept: 'elektrik', name: nm('Adaptör CEE 16 A 5 pin → 3× Schuko', 'Adapter CEE 16 A rot → 3× Schuko', 'Adapter CEE 16 A red → 3× Schuko'), icon: 'distro', shape: 'distro', w: 0.22, d: 0.16, h: 0.18, kg: 2,
    ports: [pg('in', N.in, 'cee16r', 'in', 'power'), pg('out', N.sock, 'schuko', 'out', 'power', 3, undefined, { phases: ['L1', 'L2', 'L3'], breakerA: 16 })], mount: 'floor', tags: ['adaptör', 'adapter', 'cee', 'schuko', '16a', 'kırmızı'],
    desc: nm('Her Schuko ayrı fazda.', 'Jede Schuko auf eigener Phase.', 'Each Schuko on its own phase.'),
  },
  {
    id: 'strip6', cat: 'elektrik', dept: 'elektrik', name: nm('Grup priz 6× Schuko', 'Steckdosenleiste 6×', 'Power strip 6× Schuko'), icon: 'powerstrip', shape: 'strip', w: 0.45, d: 0.07, h: 0.05, kg: 1,
    ports: [pg('in', N.in, 'schuko', 'in', 'power'), pg('out', N.sock, 'schuko', 'out', 'power', 6)], mount: 'floor', tags: ['grup priz', 'steckdosenleiste', 'çoklu priz'],
  },
  {
    id: 'prcd', cat: 'elektrik', dept: 'elektrik', name: nm('PRCD-S+ kişi koruma şalteri (30 mA)', 'PRCD-S+ Personenschutzschalter (30 mA)', 'PRCD-S+ personal protection (30 mA)'), icon: 'ups', shape: 'box', w: 0.1, d: 0.08, h: 0.06, kg: 0.6,
    ports: [pg('in', N.in, 'schuko', 'in', 'power'), pg('out', N.sock, 'schuko', 'out', 'power')], mount: 'floor', tags: ['fi', 'rcd', 'prcd', 'prcd-s+', 'kaçak akım', 'personenschutz', 'kişi koruma'],
    desc: nm('Hattın başına tak; her kurulumda test düğmesiyle dene.', 'An den Anfang der Leitung; bei jedem Aufbau Testtaste drücken.', 'At the start of the line; press the test button every setup.'),
  },
  {
    id: 'ups', cat: 'elektrik', dept: 'elektrik', name: nm('UPS (kesintisiz güç, 1500 VA)', 'USV (1500 VA)', 'UPS (1500 VA)'), icon: 'ups', shape: 'rack', w: 0.48, d: 0.45, h: 0.09, kg: 25, watt: 30,
    ports: [pg('in', N.in, 'iec', 'in', 'power'), pg('out', N.sock, 'schuko', 'out', 'power', 4)], mount: 'table', mountH: 0.75, tags: ['ups', 'usv', 'kesintisiz'],
  },
  simple({ id: 'ramp', cat: 'elektrik', dept: 'elektrik', name: nm('Kablo köprüsü (1 m, 5 kanal)', 'Kabelbrücke (1 m, 5 Kanäle)', 'Cable ramp (1 m, 5 channels)'), icon: 'ramp', shape: 'ramp', dims: [1.0, 0.5, 0.07], kg: 12, tags: ['kablo köprüsü', 'kabelbrücke', 'ramp', 'rampa'] }),
  simple({ id: 'extinguisher', cat: 'elektrik', dept: 'elektrik', name: nm('Yangın söndürücü (CO₂)', 'Feuerlöscher (CO₂)', 'Fire extinguisher (CO₂)'), icon: 'extinguisher', shape: 'extinguisher', plan: 'circle', dims: [0.25, 0.25, 0.65], kg: 9, tags: ['yangın', 'feuerlöscher', 'güvenlik'] }),

  // ===== AĞ =====
  {
    id: 'switch8', cat: 'ag', dept: 'ag', name: nm('Ağ switch 8 port (Dante uyumlu)', 'Netzwerk-Switch 8-Port', 'Network switch 8-port'), icon: 'switch', shape: 'rack', w: 0.25, d: 0.15, h: 0.044, kg: 1, watt: 15,
    ports: [pg('port', 'Port', 'rj45', 'io', 'network', 8), pg('pwr', nm('Adaptör', 'Netzteil', 'PSU'), 'schuko', 'in', 'power')], mount: 'table', mountH: 0.75, tags: ['switch', 'ağ', 'dante', 'netzwerk'],
  },
  {
    id: 'router', cat: 'ag', dept: 'ag', name: nm('Wi-Fi router / erişim noktası', 'WLAN-Router / Access Point', 'Wi-Fi router / access point'), icon: 'router', shape: 'box', w: 0.22, d: 0.15, h: 0.04, kg: 0.6, watt: 12,
    ports: [pg('port', 'LAN', 'rj45', 'io', 'network', 4), pg('rf', 'Wi-Fi', 'antenna', 'out', 'wireless'), pg('pwr', nm('Adaptör', 'Netzteil', 'PSU'), 'schuko', 'in', 'power')], mount: 'table', mountH: 0.75, range: 50, tags: ['router', 'wifi', 'wlan'],
  },
  {
    id: 'tablet', cat: 'ag', dept: 'ag', name: nm('Tablet (mikser uzaktan kontrol)', 'Tablet (Mixer-Fernsteuerung)', 'Tablet (mixer remote)'), icon: 'tablet', shape: 'box', w: 0.25, d: 0.18, h: 0.01, kg: 0.5,
    ports: [pg('rf', 'Wi-Fi', 'antenna', 'in', 'wireless')], mount: 'stand', mountH: 1.2, tags: ['ipad', 'tablet', 'uzaktan'],
  },

  // ===== SAHNE & DEKOR =====
  simple({ id: 'deck-2x1', cat: 'sahne', name: nm('Sahne podesti 2×1 m', 'Bühnenpodest 2×1 m', 'Stage deck 2×1 m'), icon: 'stagedeck', shape: 'deck', dims: [2, 1, 0.6], kg: 30, tags: ['podest', 'sahne', 'bütec', 'riser'] }),
  simple({ id: 'deck-1x1', cat: 'sahne', name: nm('Sahne podesti 1×1 m', 'Bühnenpodest 1×1 m', 'Stage deck 1×1 m'), icon: 'stagedeck', shape: 'deck', dims: [1, 1, 0.6], kg: 16, tags: ['podest', 'sahne', 'riser'] }),
  simple({ id: 'drumriser', cat: 'sahne', name: nm('Davul platformu 2×3 m (halılı)', 'Drumriser 2×3 m', 'Drum riser 2×3 m'), icon: 'stagedeck', shape: 'deck', dims: [3, 2, 0.4], kg: 90, tags: ['riser', 'davul', 'drum'] }),
  simple({ id: 'stairs', cat: 'sahne', name: nm('Sahne merdiveni', 'Bühnentreppe', 'Stage stairs'), icon: 'stairs', shape: 'stairs', dims: [1.0, 0.9, 0.6], kg: 15, tags: ['merdiven', 'treppe'] }),
  simple({ id: 'rail', cat: 'sahne', name: nm('Korkuluk 2 m', 'Geländer 2 m', 'Handrail 2 m'), icon: 'rail', shape: 'rail', dims: [2, 0.05, 1.1], kg: 8, tags: ['korkuluk', 'geländer'] }),
  simple({ id: 'backdrop', cat: 'sahne', name: nm('Fon / backdrop (resim eklenebilir)', 'Backdrop (mit Bild)', 'Backdrop (image possible)'), icon: 'backdrop', shape: 'backdrop', dims: [6, 0.3, 3], kg: 30, tags: ['fon', 'backdrop', 'perde', 'dekor'] }),
  simple({ id: 'arch', cat: 'sahne', name: nm('Çiçek kemeri (nikah / gelin girişi)', 'Blumenbogen', 'Flower arch'), icon: 'arch', shape: 'arch', dims: [2.4, 0.6, 2.5], kg: 25, tags: ['kemer', 'çiçek', 'nikah', 'gelin'] }),
  simple({ id: 'table-rect', cat: 'sahne', name: nm('Masa 1,8×0,8 m', 'Tisch 1,8×0,8 m', 'Table 1.8×0.8 m'), icon: 'table', shape: 'table', dims: [1.8, 0.8, 0.75], kg: 15, tags: ['masa', 'tisch'] }),
  simple({ id: 'table-round', cat: 'sahne', name: nm('Yuvarlak masa Ø1,8 m (10 kişi)', 'Runder Tisch Ø1,8 m (10 P.)', 'Round table Ø1.8 m (10 seats)'), icon: 'roundtable', shape: 'roundtable', plan: 'circle', dims: [2.8, 2.8, 0.75], kg: 25, tags: ['masa', 'yuvarlak', 'rund', 'misafir'] }),
  simple({ id: 'table-cocktail', cat: 'sahne', name: nm('Bistro masası Ø0,8 m', 'Stehtisch Ø0,8 m', 'Cocktail table Ø0.8 m'), icon: 'roundtable', shape: 'roundtable', plan: 'circle', dims: [0.8, 0.8, 1.1], kg: 10, tags: ['bistro', 'stehtisch'] }),
  simple({ id: 'chair', cat: 'sahne', name: nm('Sandalye', 'Stuhl', 'Chair'), icon: 'chair', shape: 'chair', dims: [0.45, 0.5, 0.9], kg: 4, tags: ['sandalye', 'stuhl'] }),
  simple({ id: 'sofa', cat: 'sahne', name: nm('Gelin–damat koltuğu', 'Brautpaar-Sofa', 'Bride & groom seat'), icon: 'sofa', shape: 'sofa', dims: [1.8, 0.8, 1.0], kg: 40, tags: ['gelin', 'damat', 'koltuk', 'düğün'] }),
  simple({ id: 'cake', cat: 'sahne', name: nm('Pasta masası', 'Tortentisch', 'Cake table'), icon: 'cake', shape: 'cake', plan: 'circle', dims: [1.2, 1.2, 1.4], kg: 20, tags: ['pasta', 'torte'] }),
  simple({ id: 'bar', cat: 'sahne', name: nm('Bar tezgahı', 'Bartresen', 'Bar counter'), icon: 'bar', shape: 'counter', dims: [3, 0.7, 1.1], kg: 80, tags: ['bar', 'tezgah'] }),
  simple({ id: 'person', cat: 'sahne', name: nm('Kişi (ölçek)', 'Person (Maßstab)', 'Person (scale)'), icon: 'person', shape: 'person', plan: 'circle', dims: [0.5, 0.35, 1.75], kg: 0, tags: ['kişi', 'person', 'insan'] }),
  simple({ id: 'rack-case', cat: 'sahne', dept: 'ses', name: nm('Rack case 12U (tekerlekli)', 'Rack-Case 12 HE', 'Rack case 12U'), icon: 'rack', shape: 'rackcase', dims: [0.6, 0.65, 0.75], kg: 25, tags: ['rack', 'case', 'flightcase'] }),

  // ===== MEKAN =====
  simple({ id: 'pillar', cat: 'mekan', name: nm('Sütun / kolon', 'Säule', 'Pillar'), icon: 'pillar', shape: 'pillar', dims: [0.5, 0.5, 4], kg: 0, tags: ['sütun', 'kolon', 'säule'] }),
  simple({ id: 'pillar-round', cat: 'mekan', name: nm('Yuvarlak sütun', 'Runde Säule', 'Round pillar'), icon: 'pillar', shape: 'pillarround', plan: 'circle', dims: [0.5, 0.5, 4], kg: 0, tags: ['sütun', 'säule'] }),
  simple({ id: 'wall', cat: 'mekan', name: nm('Duvar parçası 1 m', 'Wandstück 1 m', 'Wall segment 1 m'), icon: 'wall', shape: 'wall', dims: [1, 0.2, 3], kg: 0, tags: ['duvar', 'wand'] }),
  simple({ id: 'door', cat: 'mekan', name: nm('Kapı (1 m)', 'Tür (1 m)', 'Door (1 m)'), icon: 'door', shape: 'door', dims: [1, 0.12, 2.1], kg: 0, tags: ['kapı', 'tür'] }),
  simple({ id: 'door-double', cat: 'mekan', name: nm('Çift kanat kapı (2 m)', 'Doppeltür (2 m)', 'Double door (2 m)'), icon: 'door', shape: 'door', dims: [2, 0.12, 2.3], kg: 0, tags: ['kapı', 'tür', 'giriş'] }),
  simple({ id: 'exit', cat: 'mekan', name: nm('Acil çıkış (açık tutulmalı)', 'Notausgang (freihalten)', 'Emergency exit (keep clear)'), icon: 'exit', shape: 'door', dims: [1.2, 0.12, 2.1], kg: 0, tags: ['acil', 'notausgang', 'exit', 'çıkış'] }),
  simple({ id: 'window', cat: 'mekan', name: nm('Pencere', 'Fenster', 'Window'), icon: 'window', shape: 'window', dims: [1.5, 0.1, 1.5], kg: 0, mount: 'wall', mountH: 0.9, tags: ['pencere', 'fenster', 'cam'] }),

  // ===== HAZIRLIK / BAŞKA BÖLÜM =====
  {
    id: 'tie-point', cat: 'hazirlik', dept: 'hazirlik', name: nm('Bağlantı noktası (başka bölüme / ekibe)', 'Übergabepunkt (zu anderem Bereich)', 'Tie point (to another section / team)'), icon: 'tie', shape: 'tie', w: 0.4, d: 0.3, h: 0.3, kg: 2,
    ports: [pg('audio', nm('Ses hattı', 'Audioleitung', 'Audio line'), 'xlr', 'io', 'audio', 4), pg('net', N.net, 'rj45', 'io', 'network', 2), pg('dmx', 'DMX', 'dmx3', 'io', 'dmx'), pg('pwr', N.sock, 'schuko', 'io', 'power', 2)],
    mount: 'floor', tags: ['bağlantı', 'tie line', 'übergabe', 'hazırlık', 'patch'],
    desc: nm('Başka bölüm, ekip veya sonraki program buradan bağlanacak. "Hedef" alanını doldur.', 'Hier schließt ein anderer Bereich/Team an. "Ziel" ausfüllen.', 'Another section/team connects here. Fill in the "target".'),
  },
  {
    id: 'external', cat: 'hazirlik', dept: 'hazirlik', name: nm('Harici sistem (başka ekip / program)', 'Externes System (anderes Team)', 'External system (other team / program)'), icon: 'external', shape: 'external', w: 1.0, d: 0.6, h: 0.9, kg: 0,
    ports: [pg('in', N.in, 'xlr', 'in', 'audio', 8), pg('out', N.out, 'xlr', 'out', 'audio', 8), pg('net', N.net, 'rj45', 'io', 'network', 2), pg('dmx', 'DMX', 'dmx5', 'io', 'dmx'), pg('video', 'SDI', 'sdi', 'io', 'video', 2), pg('pwr', N.pwr, 'cee16r', 'in', 'power')],
    mount: 'floor', tags: ['harici', 'extern', 'ob van', 'yayın', 'orkestra', 'program'],
    desc: nm('Örn. orkestranın kendi sistemi, yayın aracı, ışık ekibi. Portları özelleştirebilirsin.', 'z. B. Bandanlage, Ü-Wagen, Lichtcrew.', 'E.g. band rig, OB van, lighting crew.'),
  },
];

