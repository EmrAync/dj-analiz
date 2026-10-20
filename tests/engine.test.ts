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
