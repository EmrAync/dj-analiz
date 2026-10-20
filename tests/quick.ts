import { writeFileSync } from 'fs';
import { runWizard, WIZ_DEFAULT } from '../src/engine/wizard';
import { analyzeCables } from '../src/engine/cables';
import { analyzePower } from '../src/engine/power';
import { runChecks } from '../src/engine/checks';
import { splGrid, roomAcoustics } from '../src/engine/acoustics';
import { buildBom } from '../src/engine/bom';
import { buildSetup } from '../src/engine/setup';
import { makeT } from '../src/i18n';
import { patchList, toDXF } from '../src/engine/lists';

const zn = { stage: 'Sahne', dance: 'Dans pisti', tables: 'Masalar', audience: 'Seyirci', walkway: 'Kaçış yolu', foh: 'FOH', backstage: 'Kulis', bar: 'Bar', nogo: 'Yasak', custom: 'Alan' } as any;
const only = process.argv[2];
for (const music of ['dj', 'band', 'davulzurna'] as const) {
  if (only && only !== music) continue;
  const p = runWizard({ ...WIZ_DEFAULT, music, zoneNames: zn, guests: music === 'band' ? 450 : 250, quality: music === 'band' ? 'pro' : 'standard', lights: music === 'band' ? 'full' : 'basic' });
  const t = makeT('tr');
  console.log('\n=== ', music, p.areas[0].w, 'x', p.areas[0].d, 'items', p.items.length, 'cables', p.cables.length);
  const ci = analyzeCables(p);
  for (const inf of ci.values()) if (inf.type.domain !== 'power') console.log('  ', inf.cable.label, inf.type.short, inf.len, inf.a?.label, inf.portA?.label, '->', inf.b?.label, inf.portB?.label, inf.issues.join(','));
  const pw = analyzePower(p);
  console.log(' power total', pw.totalW, 'connected', pw.connectedW, 'unpowered', pw.unpowered.map(id => p.items.find(i => i.id === id)!.label));
  for (const c of pw.circuits) console.log('  circ', c.label, Math.round(c.loadW), c.amps.toFixed(1), c.breakerA, c.perPhase ? JSON.stringify(c.perPhase) : '');
  const g = splGrid(p, p.areas[0].id, { band: 'mid', freq: 1000, coherent: false });
  console.log(' spl', JSON.stringify(g?.stats));
  console.log(' room', JSON.stringify(roomAcoustics(p.areas[0])));
  for (const i of runChecks(p)) console.log('  [' + i.level + ']', t(i.code as any, i.vars));
  const bom = buildBom(p, t, 'tr');
  console.log(' bom rows', bom.rows.length, 'cables rows', bom.cables.length, 'kg', Math.round(bom.totalKg));
  console.log(' tables', p.items.filter(i => i.defId === 'table-round').length);
  const st = buildSetup(p, t, 'tr');
  console.log(' setup steps', st.length);
  console.log(' patch', patchList(p, 'tr').map(r => `${r.dest}/${r.ch}:${r.channel}`).join(', '));
  if (music === 'dj') writeFileSync('/tmp/claude-0/-home-user-dj-analiz/a1bfe282-cf31-5f29-8c15-e3b9c5d9d0d6/scratchpad/t.dxf', toDXF(p, p.areas[0].id, 'tr'));
}
