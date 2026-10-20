import { CABLE_TYPES, DOMAINS } from '../catalog/connectors';
import { CATALOG, getDef, makeItem, nextCableLabel, portsOf, uid } from '../model/project';
import { ownWatt } from './power';
import type { Cable, Domain, Item, PortInst, Project } from '../model/types';
import { suggestCableTypes } from './cables';

// Kablo oluştur (proje üzerinde doğrudan — immer taslağı ile çağrılır)
export function addCable(p: Project, a: Item, pa: PortInst, b: Item, pb: PortInst, typeId?: string, extra?: Partial<Cable>): Cable {
  // yön: çıkış → giriş
  let A = a;
  let PA = pa;
  let B = b;
  let PB = pb;
  if (pa.group.dir === 'in' && pb.group.dir !== 'in') {
    A = b;
    PA = pb;
    B = a;
    PB = pa;
  }
  const type = typeId || suggestCableTypes(PA, PB)[0].id;
  const ct = CABLE_TYPES.find((c) => c.id === type)!;
  const dom: Domain = ct.id === 'generic' ? PA.group.domain : ct.domain;
  const c: Cable = {
    id: uid('cb'),
    label: nextCableLabel(p, DOMAINS[dom].prefix),
    type,
    a: { item: A.id, port: PA.id },
    b: { item: B.id, port: PB.id },
    route: 'ortho',
    pts: [],
    ...extra,
  };
  p.cables.push(c);
  return c;
}

function used(p: Project): Set<string> {
  const s = new Set<string>();
  for (const c of p.cables) {
    s.add(c.a.item + '#' + c.a.port);
    s.add(c.b.item + '#' + c.b.port);
  }
  return s;
}

const freePorts = (p: Project, it: Item, u: Set<string>, f: (x: PortInst) => boolean) => portsOf(getDef(p, it.defId)).filter((x) => !u.has(it.id + '#' + x.id) && f(x));

function d2(a: Item, b: Item): number {
  return Math.hypot(a.x - b.x, a.y - b.y) + (a.areaId === b.areaId ? 0 : 1000);
}

// —— Elektrik: her tüketiciyi en yakın uygun boş prize bağla ——
// Uzak cihazlar için yanına otomatik grup priz koyar; 3 fazlı dağıtıcılarda fazları dengeler.
export function autoPower(p: Project, onlyItems?: string[], allowStrips = true): number {
  let n = 0;
  const u = used(p);
  const targets = p.items.filter((it) => (!onlyItems || onlyItems.includes(it.id)) && !it.hidden && (ownWatt(p, it) > 0 || isDistro(p, it)));
  targets.sort((a, b) => (isDistro(p, b) ? 1 : 0) - (isDistro(p, a) ? 1 : 0));
  const phaseLoad = new Map<string, number>();
  const itemPhase = new Map<string, { root: string; phase: string }>();
  const phaseCount = new Map<string, number>();
  // sadece enerjili kaynaklardan besle (zincir döngüsü olmasın)
  const fed = new Set<string>();
  for (const c of p.cables) if (CABLE_TYPES.find((t) => t.id === c.type)?.domain === 'power') fed.add(c.b.item);
  const energized = (it: Item) => !!getDef(p, it.defId).source || fed.has(it.id);
  const circLoad = new Map<string, number>(); // sigortalı devre başına yük (W)
  const circCap = new Map<string, number>();
  const itemCirc = new Map<string, string>();
  type Cand = { src: Item; port: PortInst; type: string; s: number; dist: number };
  const circuitOf = (src: Item, po: PortInst): string | undefined => {
    const sdef = getDef(p, src.defId);
    if (po.breakerA) {
      const k = src.id + '#' + po.id;
      circCap.set(k, po.breakerA * 230 * 0.8);
      return k;
    }
    if (sdef.source) {
      circCap.set(src.id, sdef.source.breakerA * 230 * 0.8 * (sdef.source.phases === 3 ? 3 : 1));
      return src.id;
    }
    return itemCirc.get(src.id);
  };
  const findSource = (it: Item, pin: PortInst): Cand | null => {
    const def = getDef(p, it.defId);
    const w = ownWatt(p, it);
    const targetIsStrip = isDistro(p, it);
    let best: Cand | null = null;
    for (const src of p.items) {
      if (src.id === it.id || src.hidden || !energized(src)) continue;
      const sdef = getDef(p, src.defId);
      for (const po of freePorts(p, src, u, (x) => x.group.domain === 'power' && (x.group.dir === 'out' || x.group.dir === 'io'))) {
        const types = suggestCableTypes(po, pin).filter((t) => t.domain === 'power');
        if (!types.length) continue;
        const dist = d2(src, it);
        if (dist > 60) continue;
        let s = -dist;
        if (sdef.source) s -= 3; // dağıtıcı / grup priz tercih
        if (targetIsStrip && po.phase) s -= (phaseCount.get(src.id + ':' + po.phase) || 0) * 3;
        if (targetIsStrip) {
          if (po.breakerA) s += 6; // grup prizi sigortalı çıkıştan besle
          if (isDistro(p, src) && !po.breakerA) s -= 12; // grup priz → grup priz zinciri yapma
        }
        if (po.group.key === 'pwrout') {
          // aynı tip ışıklar yan yana ise link zinciri doğal; diğerleri için son çare
          if (sdef.id === def.id && def.cat === 'isik' && dist < 2.5) s += 2;
          else if (sdef.id === def.id) s -= 4;
          else s -= 20;
        }
        const ph = po.phase ? { root: src.id, phase: po.phase } : itemPhase.get(src.id);
        if (ph) s -= (phaseLoad.get(ph.root + ':' + ph.phase) || 0) / 300;
        const ck = circuitOf(src, po);
        if (ck) {
          const load = circLoad.get(ck) || 0;
          const cap = circCap.get(ck) || 2944;
          if (load + w > cap) continue; // devre dolu
          s -= load / 400;
        }
        if (!best || s > best.s) best = { src, port: po, type: types[0].id, s, dist };
      }
    }
    return best;
  };
  const connect = (c: Cand, it: Item, pin: PortInst) => {
    addCable(p, c.src, c.port, it, pin, c.type);
    u.add(c.src.id + '#' + c.port.id);
    u.add(it.id + '#' + pin.id);
    const w = ownWatt(p, it);
    const ph = c.port.phase ? { root: c.src.id, phase: c.port.phase } : itemPhase.get(c.src.id);
    if (ph) {
      itemPhase.set(it.id, ph);
      const k = ph.root + ':' + ph.phase;
      phaseLoad.set(k, (phaseLoad.get(k) || 0) + w);
      phaseCount.set(k, (phaseCount.get(k) || 0) + 1);
    }
    fed.add(it.id);
    const ck = circuitOf(c.src, c.port);
    if (ck) {
      itemCirc.set(it.id, ck);
      circLoad.set(ck, (circLoad.get(ck) || 0) + w);
    }
    n++;
  };
  for (const it of targets) {
    const def = getDef(p, it.defId);
    if (def.source) continue;
    const pin = freePorts(p, it, u, (x) => x.group.domain === 'power' && x.group.dir === 'in')[0];
    if (!pin) continue;
    let best = findSource(it, pin);
    const ct = best ? CABLE_TYPES.find((c) => c.id === best!.type) : undefined;
    const tooFar = !best || (ct?.maxLen != null && (Math.abs(best.src.x - it.x) + Math.abs(best.src.y - it.y)) * 1.1 + 2 > ct.maxLen);
    if (tooFar && allowStrips && pin.group.conn !== 'cee16r' && pin.group.conn !== 'cee32r' && pin.group.conn !== 'cee63r') {
      // cihazın yanına grup priz koy ve onu besle
      const strip = makeItem(p, CATALOG['strip6'], it.areaId, Math.round((it.x + 0.45) * 100) / 100, Math.round((it.y - 0.45) * 100) / 100);
      const sIn = portsOf(CATALOG['strip6']).find((x) => x.group.dir === 'in')!;
      const feed = findSource(strip, sIn);
      if (feed) {
        p.items.push(strip);
        const longType = feed.dist * 1.25 + 1 > 25 ? 'schuko-25' : feed.type;
        connect({ ...feed, type: CABLE_TYPES.some((c) => c.id === longType && c.ends[0].includes(feed.port.group.conn)) ? longType : feed.type }, strip, sIn);
        best = findSource(it, pin);
      }
    }
    if (best) connect(best, it, pin);
  }
  return n;
}

function isDistro(p: Project, it: Item): boolean {
  const d = getDef(p, it.defId);
  return d.cat === 'elektrik' && !d.source && portsOf(d).some((x) => x.group.domain === 'power' && x.group.dir === 'out');
}

// —— Ses: kaynaklar → mikser → hoparlörler ——
export function autoSignal(p: Project, areaId?: string): number {
  let n = 0;
  const u = used(p);
  const inArea = (it: Item) => !it.hidden && (!areaId || it.areaId === areaId);
  const all = p.items.filter(inArea);
  const def = (it: Item) => getDef(p, it.defId);
  const link = (a: Item, pa: PortInst, b: Item, pb: PortInst, type?: string) => {
    addCable(p, a, pa, b, pb, type);
    u.add(a.id + '#' + pa.id);
    u.add(b.id + '#' + pb.id);
    n++;
  };
  const consoles = all.filter((i) => def(i).cat === 'mikser' && def(i).icon === 'mixer');
  const djMain = all.filter((i) => def(i).cat === 'dj' && portsOf(def(i)).some((x) => x.group.key === 'master'));
  const players = all.filter((i) => def(i).icon === 'djplayer' || def(i).icon === 'turntable');
  const djMixers = all.filter((i) => def(i).icon === 'djmixer');
  const stageboxes = all.filter((i) => def(i).icon === 'stagebox');
  const amps = all.filter((i) => def(i).icon === 'amp');
  const dsp = all.filter((i) => def(i).icon === 'dsp' && def(i).cat === 'islem');
  const receivers = all.filter((i) => def(i).icon === 'receiver' && def(i).cat === 'mikrofon');
  const txs = all.filter((i) => def(i).cat === 'mikrofon' && portsOf(def(i)).some((x) => x.group.domain === 'wireless' && x.group.dir === 'out'));
  const wiredMics = all.filter((i) => def(i).cat === 'mikrofon' && portsOf(def(i)).some((x) => x.group.key === 'out' && x.group.domain === 'audio') && def(i).icon !== 'receiver');
  const instruments = all.filter((i) => def(i).cat === 'enstruman' && portsOf(def(i)).some((x) => x.group.dir === 'out' && x.group.domain === 'audio'));
  const speakers = all.filter((i) => def(i).acoustic && def(i).acoustic!.kind !== 'iem');
  const iemTx = all.filter((i) => i.defId === 'iem-tx');
  const iemRx = all.filter((i) => i.defId === 'iem-rx');

  const free = (it: Item, f: (x: PortInst) => boolean) => freePorts(p, it, u, f);
  const outs = (it: Item, key?: string, dom: Domain = 'audio') => free(it, (x) => x.group.domain === dom && x.group.dir !== 'in' && (!key || x.group.key === key));
  const ins = (it: Item, key?: string, dom: Domain = 'audio') => free(it, (x) => x.group.domain === dom && x.group.dir !== 'out' && (!key || x.group.key === key));

  // 1) kablosuz vericiler → alıcılar
  for (const tx of txs) {
    const rxs = [...receivers].sort((a, b) => d2(a, tx) - d2(b, tx));
    for (const rx of rxs) {
      const pin = ins(rx, 'rf', 'wireless')[0];
      const po = outs(tx, 'rf', 'wireless')[0];
      if (pin && po) {
        link(tx, po, rx, pin, 'rf');
        break;
      }
    }
  }
  for (const rx of iemRx) {
    const tx = iemTx.find((t) => outs(t, 'rf', 'wireless').length > 0);
    const po = tx && outs(tx, 'rf', 'wireless')[0];
    const pin = ins(rx, 'rf', 'wireless')[0];
    if (tx && po && pin) link(tx, po, rx, pin, 'rf');
  }

  // 2) DJ oynatıcılar → DJ mikser kanalları
  for (const pl of players) {
    const mx = [...djMixers].sort((a, b) => d2(a, pl) - d2(b, pl))[0];
    if (!mx) continue;
    const po = outs(pl)[0];
    const pin = ins(mx, 'ch')[0];
    if (po && pin) link(pl, po, mx, pin);
  }

  // 3) mikrofon/enstrüman/alıcı → stagebox veya mikser girişleri
  const inputTargets = stageboxes.length ? stageboxes : consoles;
  const srcList: Item[] = [...wiredMics, ...instruments];
  for (const s of srcList) {
    const tgt = [...inputTargets].sort((a, b) => d2(a, s) - d2(b, s))[0];
    if (!tgt) break;
    const po = outs(s)[0];
    const pin = ins(tgt, 'in').concat(ins(tgt, 'mic'))[0];
    if (po && pin) link(s, po, tgt, pin);
  }
  for (const rx of receivers) {
    const tgt = consoles[0] || stageboxes[0] || djMain[0];
    if (!tgt) break;
    for (const po of outs(rx, 'out')) {
      const pin = ins(tgt, 'mic').concat(ins(tgt, 'in'))[0];
      if (pin) link(rx, po, tgt, pin);
    }
  }
  // stagebox ↔ mikser dijital
  for (const sb of stageboxes) {
    const mx = consoles[0];
    if (!mx) break;
    const a = free(sb, (x) => x.group.domain === 'digital')[0];
    const b = free(mx, (x) => x.group.domain === 'digital')[0];
    if (a && b) link(sb, a, mx, b, 'cat6');
  }

  // 4) DJ master → konsol (varsa) yoksa hoparlörlere
  if (consoles.length) {
    for (const dj of [...djMain, ...djMixers]) {
      const mx = consoles[0];
      for (const po of outs(dj, 'master')) {
        const pin = ins(mx, 'line').concat(ins(mx, 'mic'))[0];
        if (pin) link(dj, po, mx, pin);
      }
    }
  }
  const console0 = consoles[0];
  const master: Item | undefined = console0 || djMixers[0] || djMain[0];
  if (!master) return n;
  // dijital stagebox varsa hoparlörler sahnedeki stagebox çıkışlarından beslenir (uzun analog hat yok)
  const sbOut = console0 && stageboxes.length && p.cables.some((c) => (c.a.item === stageboxes[0].id || c.b.item === stageboxes[0].id) && (c.a.item === console0.id || c.b.item === console0.id)) ? stageboxes[0] : null;
  const mOuts = sbOut ? outs(sbOut, 'out') : outs(master, 'main').length ? outs(master, 'main') : outs(master, 'master');
  const L = mOuts.find((x) => / L$/.test(x.label)) || mOuts[0];
  const R = mOuts.find((x) => / R$/.test(x.label)) || mOuts.find((x) => x !== L);
  const feedDev = sbOut || master;

  // 5) DSP varsa ana çıkış DSP'ye
  let feedL: { it: Item; port: PortInst } | null = L ? { it: feedDev, port: L } : null;
  let feedR: { it: Item; port: PortInst } | null = R ? { it: feedDev, port: R } : null;
  if (dsp.length && L && R) {
    const d = dsp[0];
    const di = ins(d, 'in');
    if (di.length >= 2) {
      link(feedDev, L, d, di[0]);
      link(feedDev, R, d, di[1]);
      feedL = null;
      feedR = null;
    }
  }
  // hoparlör grupları
  const area = p.areas.find((a) => a.id === (master.areaId || p.areas[0].id));
  const cx = area ? area.w / 2 : 0;
  const mains = speakers.filter((s) => s.role !== 'monitor' && def(s).acoustic!.kind !== 'monitor');
  const mons = speakers.filter((s) => s.role === 'monitor' || def(s).acoustic!.kind === 'monitor');
  const dspOuts = dsp.length ? outs(dsp[0]) : [];
  let dspIdx = 0;
  const chains = new Map<string, Item>(); // sinyal zinciri başı (taraf+rol)
  // aktif hoparlörler ve amfiler
  const passive = mains.filter((s) => !def(s).acoustic!.powered);
  const active = mains.filter((s) => def(s).acoustic!.powered);
  active.sort((a, b) => (a.role === 'sub' ? 0 : 1) - (b.role === 'sub' ? 0 : 1) || d2(a, master) - d2(b, master));
  for (const s of active) {
    const side = s.x < cx ? 'L' : 'R';
    const key = side + ':' + (s.role || 'main');
    const allIn = ins(s, 'in');
    const pin = allIn.find((x) => x.label.endsWith(' ' + side)) || allIn[0];
    if (!pin) continue;
    const head = chains.get(key);
    if (head) {
      // aynı taraf ve rol: link zinciri
      const los = outs(head, 'link').concat(outs(head, 'thru'));
      const lo = los.find((x) => x.label.endsWith(' ' + side)) || los[0];
      if (lo) {
        link(head, lo, s, pin);
        chains.set(key, s);
        continue;
      }
    }
    // sub üstünden tepe beslemesi (thru)
    if ((s.role || 'main') === 'main') {
      const subHead = chains.get(side + ':sub');
      const th = subHead ? outs(subHead, 'thru').find((x) => x.label.endsWith(side)) || outs(subHead, 'thru')[0] : undefined;
      if (subHead && th && !dsp.length) {
        link(subHead, th, s, pin);
        chains.set(key, s);
        continue;
      }
    }
    if (dspOuts[dspIdx]) {
      link(dsp[0], dspOuts[dspIdx++], s, pin);
    } else {
      const f = side === 'L' ? feedL : feedR;
      const po = f ? (u.has(f.it.id + '#' + f.port.id) ? null : f.port) : null;
      if (f && po) link(f.it, po, s, pin);
      else {
        const any = outs(feedDev, 'out').concat(outs(master, 'aux'))[0];
        if (any) link(any && feedDev && outs(feedDev, 'out').includes(any) ? feedDev : master, any, s, pin);
      }
    }
    chains.set(key, s);
  }
  // pasif hoparlörler → amfi
  for (const s of passive) {
    const amp = [...amps].sort((a, b) => d2(a, s) - d2(b, s)).find((a) => outs(a, 'out', 'speaker').length > 0);
    const pin = ins(s, 'in', 'speaker')[0];
    if (amp && pin) link(amp, outs(amp, 'out', 'speaker')[0], s, pin);
  }
  // amfi girişleri
  for (const a of amps) {
    for (const pin of ins(a, 'in')) {
      if (dspOuts[dspIdx]) link(dsp[0], dspOuts[dspIdx++], a, pin);
      else {
        const po = outs(master, 'main')[0] || outs(master, 'out')[0];
        if (po) link(master, po, a, pin);
        break;
      }
    }
  }
  // monitörler → aux/out
  for (const m of mons) {
    const pin = ins(m, 'in')[0];
    if (!pin) continue;
    const near = sbOut && d2(sbOut, m) < d2(master, m) ? sbOut : master;
    const po = outs(near, 'aux')[0] || outs(near, 'out')[0] || outs(master, 'aux')[0] || outs(master, 'out')[0] || outs(master, 'booth')[0];
    if (po) link(outs(near, 'aux').concat(outs(near, 'out')).includes(po) ? near : master, po, m, pin);
  }
  for (const t of iemTx) {
    for (const pin of ins(t, 'in')) {
      const po = outs(master, 'out')[0] || outs(master, 'aux')[0];
      if (po) link(master, po, t, pin);
    }
  }
  return n;
}
