// Hesap motoru testleri. Çalıştır: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CABLE_BY_ID, cableFits, stockLength } from '../src/catalog/connectors';
import { EQUIPMENT } from '../src/catalog/equipment';
import { directivity, roomAcoustics, sourcesOf, speedOfSound, splAt, suggestDelay } from '../src/engine/acoustics';
import { addCable } from '../src/engine/autowire';
import { buildBom } from '../src/engine/bom';
import { analyzeCables } from '../src/engine/cables';
import { runChecks } from '../src/engine/checks';
import { patchList, toDXF } from '../src/engine/lists';
import { analyzePower } from '../src/engine/power';
import { buildSetup } from '../src/engine/setup';
import { runWizard, WIZ_DEFAULT, type WizardParams } from '../src/engine/wizard';
import { makeT } from '../src/i18n';
import { CATALOG, findPort, makeItem, newProject, portsOf } from '../src/model/project';
import type { Project } from '../src/model/types';
import { freeze } from 'immer';
import { applyPlan, coveragePlan, danceScan, moveDance, zoneTarget } from '../src/engine/coverage';
import { reverbEnergy } from '../src/engine/acoustics';
import { aWeight, calAt, cWeight, demoCurve, octaveBands, parseCal } from '../src/audio/dsp';
import { EQ_DEFAULT, peqDb, suggestEq } from '../src/engine/eq';
import { buildPlan } from '../src/engine/activities';
import { designWeight, limitsOf, Meter, weightDb } from '../src/audio/meter';
import { alignSubTop, analyzeIR, convolve, extractIRs, sweepSequence, SWEEP_DEFAULT } from '../src/audio/sweep';

const t = makeT('tr');
const zn = { stage: 'Sahne', audience: 'Seyirci', dance: 'Dans', tables: 'Masalar', foh: 'FOH', walkway: 'Yol', backstage: 'Kulis', bar: 'Bar', nogo: 'Yasak', custom: 'Alan' } as WizardParams['zoneNames'];
const wiz = (o: Partial<WizardParams>) => runWizard({ ...WIZ_DEFAULT, zoneNames: zn, ...o });
const errors = (p: Project) => runChecks(p).filter((i) => i.level === 'error');

test('katalog: benzersiz id ve geçerli portlar', () => {
  const ids = new Set<string>();
  for (const d of EQUIPMENT) {
    assert.ok(!ids.has(d.id), 'tekrar eden id ' + d.id);
    ids.add(d.id);
    assert.ok(d.w > 0 && d.d > 0 && d.h > 0, d.id + ' ölçü');
    const pids = new Set<string>();
    for (const p of portsOf(d)) {
      assert.ok(!pids.has(p.id), d.id + ' port tekrar ' + p.id);
      pids.add(p.id);
    }
  }
  assert.ok(EQUIPMENT.length > 130, 'katalog büyüklüğü');
});

test('kablo: standart boy yuvarlama', () => {
  assert.equal(stockLength(CABLE_BY_ID.xlr, 6.2), 7.5);
  assert.equal(stockLength(CABLE_BY_ID.xlr, 0.3), 0.5);
  assert.equal(stockLength(CABLE_BY_ID.xlr, 61), 65);
});

test('kablo: elektrik kabloları yönlüdür (priz → fiş)', () => {
  const ct = CABLE_BY_ID['schuko-pcon'];
  assert.equal(cableFits(ct, 'schuko', 'powercon'), true);
  assert.equal(cableFits(ct, 'powercon', 'schuko'), false);
  assert.equal(cableFits(CABLE_BY_ID.xlr, 'combo', 'xlr'), true);
  assert.equal(cableFits(CABLE_BY_ID.dmx3, 'xlr', 'dmx3'), true);
});

test('elektrik: 16 A prize 3 büyük yük → aşırı yük hatası', () => {
  const p = newProject('t');
  const a = p.areas[0].id;
  const wall = makeItem(p, CATALOG['wall-schuko'], a, 0, 1);
  p.items.push(wall);
  const strip = makeItem(p, CATALOG['strip6'], a, 1, 1);
  p.items.push(strip);
  addCable(p, wall, findPort(CATALOG['wall-schuko'], 'out1')!, strip, findPort(CATALOG['strip6'], 'in')!);
  for (let i = 0; i < 3; i++) {
    const it = makeItem(p, CATALOG['fog'], a, 2 + i, 1); // 1500 W
    p.items.push(it);
    addCable(p, strip, findPort(CATALOG['strip6'], 'out' + (i + 1))!, it, findPort(CATALOG['fog'], 'pwr')!);
  }
  const q = JSON.parse(JSON.stringify(p)) as Project;
  const pw = analyzePower(q);
  const c = pw.circuits.find((x) => x.itemId === wall.id)!;
  assert.ok(Math.abs(c.loadW - 4500) < 1, 'yük ' + c.loadW);
  assert.ok(c.pct > 1, 'yüzde ' + c.pct);
  assert.ok(runChecks(q).some((i) => i.code === 'chk.overload'));
});

test('kablo: aynı porta iki kablo → hata', () => {
  const p = newProject('t');
  const a = p.areas[0].id;
  const m1 = makeItem(p, CATALOG['shure-sm58'], a, 1, 1);
  p.items.push(m1);
  const m2 = makeItem(p, CATALOG['shure-sm58'], a, 2, 1);
  p.items.push(m2);
  const mx = makeItem(p, CATALOG['mix-an12'], a, 3, 3);
  p.items.push(mx);
  addCable(p, m1, findPort(CATALOG['shure-sm58'], 'out')!, mx, findPort(CATALOG['mix-an12'], 'mic1')!);
  addCable(p, m2, findPort(CATALOG['shure-sm58'], 'out')!, mx, findPort(CATALOG['mix-an12'], 'mic1')!);
  const q = JSON.parse(JSON.stringify(p)) as Project;
  assert.ok([...analyzeCables(q).values()].every((i) => i.issues.includes('chk.portBusy')));
});

test('akustik: mesafe yasası ve yönelim', () => {
  const p = newProject('t');
  const a = p.areas[0].id;
  const it = makeItem(p, CATALOG['top-12a'], a, 5, 2, { mount: 'floor', z: 0, tilt: 0 });
  p.items.push(it);
  const q = JSON.parse(JSON.stringify(p)) as Project;
  const s = sourcesOf(q, a)[0];
  const c = speedOfSound(20);
  const o = { band: 'mid' as const, freq: 1000, coherent: false };
  const l1 = splAt([s], s.x, s.y + 1, s.z, o, c);
  const l2 = splAt([s], s.x, s.y + 2, s.z, o, c);
  assert.ok(Math.abs(l1 - l2 - 6.02) < 0.05, `6 dB/mesafe ikiye katlanınca (${l1 - l2})`);
  // kapsama kenarında −6 dB
  const half = (s.h / 2) * (Math.PI / 180);
  const att = directivity(s, -Math.sin(half), Math.cos(half), 0);
  assert.ok(Math.abs(att + 6) < 0.01, 'kenar ' + att);
  assert.ok(Math.abs(speedOfSound(20) - 343.2) < 0.3);
});

test('akustik: beton oda yankılı, perdeli oda daha kuru', () => {
  const p = newProject('t');
  const ar = { ...p.areas[0], w: 20, d: 15, h: 6, floor: 'beton' as const, walls: 'beton' as const, ceiling: 'beton' as const, guests: 0, glassPct: 0, curtainPct: 0 };
  const hard = roomAcoustics(ar)!;
  const soft = roomAcoustics({ ...ar, curtainPct: 80, ceiling: 'akustikTavan', floor: 'hali', guests: 150 })!;
  assert.ok(hard.rt[1] > 3, 'sert ' + hard.rt[1]);
  assert.ok(soft.rt[1] < 1.2, 'yumuşak ' + soft.rt[1]);
  assert.equal(roomAcoustics({ ...ar, indoor: false }), null);
});

test('sihirbaz: DJ düğünü — hata yok, her şeyin elektriği var, fazlar dengeli', () => {
  const p = wiz({ music: 'dj', guests: 250 });
  assert.equal(errors(p).length, 0, JSON.stringify(errors(p)));
  const pw = analyzePower(p);
  assert.equal(pw.unpowered.length, 0);
  const src = pw.circuits.find((c) => c.perPhase)!;
  const v = [src.perPhase!.L1, src.perPhase!.L2, src.perPhase!.L3];
  assert.ok(Math.max(...v) - Math.min(...v) < Math.max(...v) * 0.8, 'faz dengesi ' + v);
  assert.ok(p.items.some((i) => i.label === 'PA-L') && p.items.some((i) => i.label === 'SUB-R'));
  // hoparlörler sinyal almış
  assert.ok(!runChecks(p).some((i) => i.code === 'chk.noSignal'));
});

test('sihirbaz: profesyonel orkestra — stagebox protokolü uyumlu, input listesi', () => {
  const p = wiz({ music: 'band', guests: 450, quality: 'pro', lights: 'full', power: 'cee32' });
  assert.ok(!runChecks(p).some((i) => i.code === 'chk.protocol'));
  const rows = patchList(p, 'tr');
  assert.ok(rows.some((r) => r.channel === 'Kick'), 'kick kanalı');
  assert.ok(p.items.some((i) => i.defId === 'la-generic'), 'line array');
  assert.equal(analyzePower(p).unpowered.length, 0);
});

test('sihirbaz: derin salonda delay hoparlörü ve önerilen gecikme', () => {
  const p = wiz({ music: 'dj', guests: 500, w: 22, d: 34, h: 5, quality: 'standard' });
  const dl = p.items.filter((i) => i.role === 'delay');
  assert.equal(dl.length, 2);
  for (const d of dl) {
    const ms = suggestDelay(p, d)!;
    assert.ok(ms > 10 && ms < 80, 'gecikme ' + ms);
    assert.ok(Math.abs((d.delayMs || 0) - ms) < 0.2);
  }
});

test('malzeme listesi ve kurulum talimatı', () => {
  const p = wiz({ music: 'davulzurna', guests: 200, power: 'schuko' });
  const bom = buildBom(p, t, 'tr');
  assert.ok(bom.rows.some((r) => r.key === 'acc:pole' || r.key === 'acc:stand'));
  assert.ok(bom.cables.length > 3);
  const steps = buildSetup(p, t, 'tr');
  const spk = steps.find((s) => s.phase === 'speakers' && s.title.startsWith('PA-L'))!;
  assert.ok(spk.lines.some((l) => l.includes('Eksen')), 'nişan noktası');
  assert.ok(steps.some((s) => s.phase === 'poweron'));
  const de = buildSetup(p, makeT('de'), 'de');
  assert.ok(de.some((s) => s.lines.some((l) => l.includes('von der'))));
});

test('DXF çıktısı', () => {
  const p = wiz({ music: 'dj' });
  const dxf = toDXF(p, p.areas[0].id, 'tr');
  assert.ok(dxf.startsWith('0\r\nSECTION'));
  assert.ok(dxf.trim().endsWith('EOF'));
  assert.ok(dxf.includes('POLYLINE') && dxf.includes('KABLO_audio'));
});

// —— Ses dağılımı ——
test('kapsama: bölge hedefleri ve kapatma', () => {
  const p = wiz({ music: 'dj', guests: 250 });
  const dance = p.zones.find((z) => z.kind === 'dance')!;
  assert.equal(zoneTarget(dance), 98);
  assert.equal(zoneTarget({ ...dance, target: 0 }), null);
  assert.equal(zoneTarget({ ...dance, kind: 'tables' }), 87);
});

test('kapsama: pist hedefte, öneriler uygulanınca kararlı', () => {
  const p = freeze(wiz({ music: 'dj', guests: 250 }), true);
  const a = p.areas[0].id;
  const plan = coveragePlan(p, a);
  assert.ok(!plan.noZones && !plan.noSpeakers);
  const d = plan.final.find((e) => e.kind === 'dance')!;
  assert.ok(Math.abs(d.avg - d.target) < 2.5, 'pist ' + d.avg);
  const q = JSON.parse(JSON.stringify(p)) as Project;
  applyPlan(q, a, plan.proposals.map((x) => x.id), true);
  const q2 = freeze(JSON.parse(JSON.stringify(q)) as Project, true);
  const plan2 = coveragePlan(q2, a);
  assert.equal(plan2.proposals.length, 0, 'ikinci kez öneri çıkmamalı');
  assert.ok(Math.abs(plan2.now.find((e) => e.kind === 'dance')!.avg - 98) < 2.5);
  assert.equal(errors(q2).length, 0, JSON.stringify(errors(q2)));
});

test('kapsama: yankılı salonda tavsiye, açık havada masalar hedefe yakın', () => {
  const hall = freeze(wiz({ music: 'dj', guests: 250 }), true);
  assert.ok(coveragePlan(hall, hall.areas[0].id).advice.some((x) => x.code === 'reverb'));
  const out = freeze(wiz({ music: 'dj', guests: 600, indoor: false, w: 30, d: 55 }), true);
  const pl = coveragePlan(out, out.areas[0].id);
  for (const e of pl.final.filter((x) => x.kind === 'tables')) assert.ok(Math.abs(e.avg - e.target) < 4, 'masa ' + e.avg);
  assert.ok(reverbEnergy(out, out.areas[0].id) === 0);
});

test('kapsama: pist mesafesi taraması', () => {
  const p = freeze(wiz({ music: 'dj', guests: 500, w: 22, d: 34, h: 5 }), true);
  const sc = danceScan(p, p.areas[0].id)!;
  assert.ok(sc && sc.pts.length > 5);
  assert.ok(sc.best[0] <= sc.bestGap && sc.bestGap <= sc.best[1]);
  const q = JSON.parse(JSON.stringify(p)) as Project;
  moveDance(q, q.areas[0].id, sc.bestGap, sc.ref);
  const dz = q.zones.find((z) => z.kind === 'dance')!;
  assert.ok(Math.abs(dz.y - (sc.ref + sc.bestGap)) < 0.02);
});

// —— Ölçüm / EQ ——
test('dsp: bantlar, ağırlıklar, kalibrasyon dosyası', () => {
  assert.equal(octaveBands(3).fc.length, 29);
  assert.ok(Math.abs(aWeight(1000)) < 0.05 && Math.abs(aWeight(100) + 19.1) < 0.2 && Math.abs(cWeight(31.5) + 3) < 0.2);
  const cal = parseCal('"Sens Factor =-1.378dB, SERNO: 7012345"\n20.0\t-1.2\n1000\t0.0\n20000\t2.1\n')!;
  assert.equal(cal.sens, -1.378);
  assert.equal(cal.serial, '7012345');
  assert.ok(Math.abs(calAt(cal, 1000)) < 1e-9 && calAt(cal, 30000) === 2.1);
});

test('eq: oda modu ve sertlik için kesme, sadece kesme', () => {
  const b = octaveBands(12);
  const r = suggestEq(b.fc, demoCurve(b.fc), EQ_DEFAULT);
  assert.ok(r.filters.length >= 2 && r.filters.every((f) => f.gain < 0));
  assert.ok(r.filters.some((f) => f.f > 50 && f.f < 80), '63 Hz modu');
  assert.ok(r.filters.some((f) => f.f > 2000 && f.f < 3200), '2,5 kHz');
  assert.ok(Math.max(...r.after) < Math.max(...r.dev));
  assert.ok(Math.abs(peqDb(1000, 1000, -6, 2) + 6) < 0.01);
});

// —— Kurulum planı ——
test('kurulum planı: bağımlılık sırası ve kritik yol', () => {
  const p = wiz({ music: 'band', guests: 300, lights: 'full' });
  p.meta.time = '19:30';
  const plan = buildPlan(p, buildSetup(p, t, 'tr'));
  assert.ok(plan.total > 60);
  for (const a of plan.acts) for (const d of a.deps) assert.ok(plan.acts.find((x) => x.id === d)!.ef <= a.es + 1e-9);
  const crit = plan.acts.filter((a) => a.critical).map((a) => a.id);
  assert.ok(crit.includes('prep') && crit.includes('test'));
  assert.equal(plan.start, 19 * 60 + 30 - plan.total - plan.buffer);
});

// —— Ses seviyesi ölçer ——
test('dB ölçer: A/C ağırlıkları ve Leq', () => {
  const fs = 48000;
  const A = designWeight('A', fs);
  const C = designWeight('C', fs);
  assert.ok(Math.abs(weightDb(A, 1000, fs)) < 0.01);
  assert.ok(Math.abs(weightDb(A, 100, fs) + 19.1) < 0.3);
  assert.ok(Math.abs(weightDb(A, 31.5, fs) + 39.4) < 0.5);
  assert.ok(Math.abs(weightDb(C, 31.5, fs) + 3.0) < 0.3);
  for (const [f, exp] of [
    [1000, -6.02],
    [100, -6.02 - 19.1],
  ]) {
    const m = new Meter(fs);
    const x = new Float32Array(fs * 3);
    for (let i = 0; i < x.length; i++) x[i] = 0.5 * Math.sin((2 * Math.PI * f * i) / fs);
    m.process(x);
    const r = m.read();
    assert.ok(Math.abs(10 * Math.log10(r.leqA) - exp) < 0.3, `LAeq ${f} Hz`);
    assert.ok(Math.abs(10 * Math.log10(r.cpk) - 10 * Math.log10(r.leqC) - 3.01) < 0.3, 'tepe = rms + 3 dB');
    assert.equal(m.hist.length, 2);
  }
  assert.deepEqual(limitsOf(newProject('t')), { on: true, preset: 'din15905', laeq: 99, minutes: 30, lcpeak: 135 });
});

// —— Gecikme ölçümü ——
test('tarama: iki varış, yankı süresi, kayıt içinde bulma', () => {
  const fs = 48000;
  const spec = { ...SWEEP_DEFAULT, fs };
  const seq = sweepSequence(spec);
  const room = new Float64Array(Math.round(fs * 1.4));
  room[Math.round(0.01 * fs)] = 1;
  room[Math.round(0.041 * fs)] = 0.6;
  let s = 5;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
  for (let i = Math.round(0.02 * fs); i < room.length; i++) room[i] += 0.05 * rnd() * Math.exp((-6.91 * (i / fs)) / 1.0);
  const y = convolve(seq.data, room);
  const rec = new Float32Array(y.length + fs);
  const off = Math.round(0.2 * fs);
  for (let i = 0; i < y.length; i++) rec[i + off] = y[i];
  const known = extractIRs(rec, spec, seq.starts.map((x) => x + off))!;
  const an = analyzeIR(known.ir, fs, known.pre);
  assert.ok(Math.abs(an.arrivals[1].ms - 31) < 0.1, 'ikinci varış ' + an.arrivals[1].ms);
  assert.ok(Math.abs((known.peaks[0] - known.starts[0]) / fs - 0.01) < 0.0002, 'mutlak varış');
  assert.ok(Math.abs(an.rt.find((b) => b.f === 0)!.t20! - 1.0) < 0.05, 'RT');
  const blind = extractIRs(rec, spec)!;
  assert.equal(blind.found, 3);
  assert.ok(Math.abs(analyzeIR(blind.ir, fs, blind.pre).arrivals[1].ms - 31) < 0.1);
});

test('sub–tepe hizalama: geç gelen tarafa göre gecikme önerisi', () => {
  const fs = 48000;
  const lpImp = (at: number) => {
    const ir = new Float64Array(fs / 2);
    const al = Math.exp((-2 * Math.PI * 100) / fs);
    let y1 = 0;
    let y2 = 0;
    for (let i = 0; i < ir.length; i++) {
      const x = i === Math.round(at * fs) ? 1 : 0;
      y1 = (1 - al) * x + al * y1;
      y2 = (1 - al) * y1 + al * y2;
      ir[i] = y2;
    }
    return ir;
  };
  const r = alignSubTop(lpImp(0.01), lpImp(0.015), fs, 100);
  assert.ok(Math.abs(r.delayMs + 5) < 0.1, 'sub 5 ms gecikmeli olmalı: ' + r.delayMs);
  assert.ok(!r.invert && r.gainDb > 0 && r.coherence > 0.98);
});

test('tarama: sessiz kayıtta sonuç yok', () => {
  const spec = { ...SWEEP_DEFAULT, fs: 48000 };
  assert.equal(extractIRs(new Float32Array(48000 * 12), spec), null);
});

test('elektrik alternatifleri: A/B/C kurulur, seçili plan hesaplara girer', async () => {
  const { produce } = await import('immer');
  const { buildPowerAlternatives, findEntry } = await import('../src/engine/powerAlt');
  const { activeView, isOff } = await import('../src/model/variants');
  const base = wiz({ power: 'schuko', guests: 120 });
  const gp = base.items.find((i) => i.label === 'GP-1')!;
  assert.equal(findEntry(base, gp.id)?.id, gp.id);
  let res: ReturnType<typeof buildPowerAlternatives> | undefined;
  const p = produce(base, (d) => {
    res = buildPowerAlternatives(d as Project, gp.id, t);
  });
  assert.ok(res && res.ok, 'kuruldu');
  const g = p.variants![0];
  assert.equal(g.variants.map((v) => v.label).join(''), 'ABC');
  assert.equal(g.active, g.variants[0].id);
  // seçili olmayan planlar görünümden çıkar, port meşgul sayılmaz
  const view = activeView(p);
  assert.ok(view.items.length < p.items.length);
  assert.ok(!runChecks(p).some((i) => i.code === 'chk.portBusy'), 'port meşgul yok');
  assert.deepEqual(errors(p), []);
  const pw = analyzePower(p);
  const root = (q: Project) => {
    const n = analyzePower(q).nodes.get(gp.id)!;
    return q.items.find((i) => i.id === n.rootId)!.defId;
  };
  assert.ok(pw.nodes.get(gp.id)!.feed, 'GP-1 beslenmiş');
  assert.equal(root(p), 'wall-cee32r');
  // C seçilince: Schuko priz kök olur, adaptörler "alternatifler için" listede
  const pc = produce(p, (d) => {
    d.variants![0].active = d.variants![0].variants[2].id;
  });
  assert.equal(root(pc), 'wall-schuko');
  assert.ok(isOff(pc, pc.items.find((i) => i.defId === 'adp-cee32-16')!));
  const bom = buildBom(pc, t, 'tr');
  const alt = bom.rows.filter((r) => r.group === 'alt');
  assert.ok(alt.some((r) => r.defId === 'adp-cee32-16' && r.qty === 1), 'adaptör 32→16 yanına');
  assert.ok(alt.some((r) => r.defId === 'adp-cee16r-schuko'), 'adaptör 16→Schuko yanına');
  assert.ok(bom.rows.some((r) => r.defId === 'prcd' && r.group !== 'alt'), 'PRCD seçili planda');
  // kurulum talimatında karar adımı
  const steps = buildSetup(pc, t, 'tr');
  const vg = steps.find((s) => s.id === 'vg:' + g.id)!;
  assert.ok(vg && vg.lines.length === 4, 'A/B/C + seçim notu');
  assert.ok(vg.lines[2].startsWith('✓ C)'));
  assert.ok(vg.lines[0].includes('→'), 'zincir yazılı');
  // ikinci kez kurulamaz
  let again: ReturnType<typeof buildPowerAlternatives> | undefined;
  produce(pc, (d) => {
    again = buildPowerAlternatives(d as Project, gp.id, t);
  });
  assert.ok(again && !again.ok);
});

test('elektrik alternatifleri: 3 fazlı dağıtıcı için A (32→16) / B (16 A)', async () => {
  const { produce } = await import('immer');
  const { buildPowerAlternatives, findEntry } = await import('../src/engine/powerAlt');
  const base = wiz({ power: 'cee16', guests: 200 });
  const wall = base.items.find((i) => i.label === 'CEE-1')!;
  const dist = findEntry(base, wall.id)!;
  assert.equal(dist.defId, 'distro-16');
  let res: ReturnType<typeof buildPowerAlternatives> | undefined;
  const p = produce(base, (d) => {
    res = buildPowerAlternatives(d as Project, dist.id, t);
  });
  assert.ok(res && res.ok);
  assert.equal(p.variants![0].variants.length, 2);
  assert.ok(!p.items.some((i) => i.id === wall.id), 'eski priz kaldırıldı');
  assert.deepEqual(errors(p), []);
  const n = analyzePower(p).nodes.get(dist.id)!;
  assert.equal(n.phase, '3P');
});

test('kayıtlı salon: sadece salon + elektrik A/B/C kaydedilir, yeni bölüm olarak eklenir', async () => {
  const { produce } = await import('immer');
  const { buildPowerAlternatives } = await import('../src/engine/powerAlt');
  const { venueFromArea, insertVenue } = await import('../src/store/venueActions');
  const base = wiz({ power: 'schuko', guests: 120 });
  const gp = base.items.find((i) => i.label === 'GP-1')!;
  const p = produce(base, (d) => void buildPowerAlternatives(d as Project, gp.id, t));
  const v = venueFromArea(p, p.areas[0].id, 'Salon X', false)!;
  assert.equal(v.variants.length, 1);
  assert.ok(v.items.some((i) => i.id === gp.id), 'sistem girişi kayıtlı');
  assert.ok(!v.items.some((i) => i.defId.startsWith('top-') || i.defId.startsWith('sub-')), 'hoparlör yok');
  assert.ok(v.cables.every((c) => c.variant), 'sadece plan kabloları');
  const q = produce(p, (d) => void insertVenue(d as Project, v));
  assert.equal(q.areas.length, 2);
  assert.equal(q.variants!.length, 2);
  const g2 = q.variants![1];
  assert.notEqual(g2.id, p.variants![0].id);
  const a2 = q.areas[1].id;
  assert.ok(q.items.filter((i) => i.areaId === a2 && i.variant).every((i) => g2.variants.some((x) => x.id === i.variant)), 'yeni plan kimlikleri');
  assert.deepEqual(errors(q), []);
  // boş projeye eklenince boş bölümün yerine geçer
  const e = produce(newProject(), (d) => void insertVenue(d as Project, v));
  assert.equal(e.areas.length, 1);
  assert.equal(e.meta.venue, 'Salon X');
});

test('paketleme: öneri her şeyi çantalara dağıtır, mobilya girmez, işaret ilerlemesi', async () => {
  const { packingNeeds, suggestCases, caseProgress } = await import('../src/engine/packing');
  const p0 = wiz({ guests: 200, tables: true });
  const needs = packingNeeds(p0, t, 'tr');
  assert.ok(needs.length > 5);
  assert.ok(!needs.some((n) => n.ref === 'table-round' || n.ref === 'chair'), 'masa/sandalye yok');
  assert.ok(needs.some((n) => n.kind === 'cable'), 'kablolar var');
  const cases = suggestCases(p0, t, 'tr');
  const p = { ...p0, cases };
  assert.ok(packingNeeds(p, t, 'tr').every((n) => n.packed >= n.need), 'hepsi çantada');
  assert.ok(cases.some((c) => c.name === 'Elektrik çantası'));
  // ikinci öneri bir şey eklemez
  assert.equal(JSON.stringify(suggestCases(p, t, 'tr')), JSON.stringify(cases));
  const c0 = cases[0];
  const pk = { ...p, packing: { [c0.id + ':' + c0.lines[0].id]: { out: c0.lines[0].qty } } };
  const pr = caseProgress(pk, c0);
  assert.equal(pr.out, c0.lines[0].qty);
  assert.equal(pr.back, 0);
});
