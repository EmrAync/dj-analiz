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
