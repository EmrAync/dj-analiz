// Etkileşim testleri: kablo aracı, geri al, sürükleme, alan çizme, şemada bağlama, ayna kopya,
// kurulumcu modu, koyu tema, mobil görünüm, Almanca kurulum talimatı, DXF/PNG/JSON dışa aktarma,
// ses dağılımı önerileri, canlı RTA (sahte mikrofon), kalibrasyon, EQ önerisi, kurulum akış diyagramı.
import { createRequire } from 'module';
import fs from 'fs';
import { execFileSync } from 'child_process';
import path from 'path';
const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  ({ chromium } = require('/opt/node22/lib/node_modules/playwright'));
}
const url = process.argv[2] || 'http://127.0.0.1:4173/';
const out = process.argv[3] || 'shots';
fs.mkdirSync(out, { recursive: true });
const errors = [];
const fails = [];
const ok = (cond, msg) => {
  if (!cond) fails.push(msg);
  console.log((cond ? 'PASS ' : 'FAIL ') + msg);
};
// sahte mikrofon: iki varışlı (0 / +23 ms) salon kaydı (tarama WAV'ı)
const wav = path.resolve(out, 'sweep-room.wav');
execFileSync('node', ['--import', 'tsx', 'tests/make_sweep_fixture.ts', wav]);
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${wav}`, '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true, permissions: ['microphone'] });
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()));
const shot = (n) => page.screenshot({ path: `${out}/${n}.png` });
const status = async () => (await page.locator('[data-testid="status"]').innerText()).replace(/\s+/g, ' ');
const cableCount = async () => Number(/(\d+) kablo/.exec(await status())?.[1] ?? NaN);
const itemCount = async () => Number(/(\d+) malzeme/.exec(await status())?.[1] ?? NaN);

await page.goto(url);
await page.waitForSelector('[data-testid="plan-svg"]');
await page.waitForTimeout(700);
if (await page.locator('[data-testid="help-close"]').count()) await page.locator('[data-testid="help-close"]').click();

// —— 1. Kablo aracı: MIC-1 → DJ-1? DJ-1 mikrofon girişleri dolu; DJ-LT (laptop) → MON-DJ? En sağlamı: yeni bir aktif hoparlör ekleyip DJ-1'e bağlamak
const c0 = await cableCount();
await page.locator('[data-testid="lib-search"]').fill('K12.2');
await page.locator('[data-testid="lib-qsc-k12.2"]').click();
const box = await page.locator('[data-testid="plan-svg"]').boundingBox();
await page.mouse.click(box.x + box.width * 0.42, box.y + box.height * 0.6);
await page.waitForTimeout(300);
ok((await itemCount()) > 0, 'yeni hoparlör eklendi');
const newLabel = await page.locator('[data-testid="item-label"]').inputValue();
ok(/^PA-\d+$/.test(newLabel), 'yeni etiket ' + newLabel);
await page.locator('[data-testid="tool-cable"]').click();
const st = () => page.evaluate(() => { const s = window.__sahnecad.getState(); return JSON.stringify({ tool: s.tool, draft: s.cableDraft, dialog: s.dialog && s.dialog.kind }); });
const clickCenter = async (sel) => {
  const r = await page.locator(sel).first().boundingBox();
  await page.mouse.click(r.x + r.width / 2, r.y + r.height / 2);
};
await clickCenter('[data-label="DJ-1"] rect');
console.log('state1', await st());
await clickCenter(`[data-label="${newLabel}"] rect`);
console.log('state2', await st());
await page.waitForSelector('[data-testid="con-ok"]', { timeout: 5000 });
await shot('30-connect-dialog');
await page.locator('[data-testid="con-ok"]').click();
await page.waitForTimeout(300);
const c1 = await cableCount();
ok(c1 === c0 + 1, `kablo eklendi (${c0}→${c1})`);
await page.keyboard.press('Escape');
// —— 2. Geri al
await page.keyboard.press('Control+z');
await page.waitForTimeout(200);
ok((await cableCount()) === c0, 'geri al kabloyu kaldırdı');
await page.keyboard.press('Control+y');
await page.waitForTimeout(200);
ok((await cableCount()) === c1, 'yinele kabloyu geri getirdi');
// —— 3. Sürükle
await page.locator('[data-testid="tool-select"]').click();
const el = page.locator(`[data-label="${newLabel}"] rect`).first();
const b = await el.boundingBox();
await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
const x0 = Number(await page.locator('[data-testid="item-inspector"] input').nth(1).inputValue());
await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
await page.mouse.down();
await page.mouse.move(b.x + b.width / 2 + 60, b.y + b.height / 2 + 10, { steps: 6 });
await page.mouse.up();
await page.waitForTimeout(200);
const x1 = Number(await page.locator('[data-testid="item-inspector"] input').nth(1).inputValue());
ok(x1 > x0 + 0.5, `sürükleme X değiştirdi (${x0}→${x1})`);
// —— 4. Ayna kopya
const n0 = await itemCount();
await page.keyboard.press('Shift+M');
await page.waitForTimeout(200);
ok((await itemCount()) === n0 + 1, 'ayna kopya oluşturdu');
// —— 5. Alan çiz
await page.keyboard.press('Escape');
await page.locator('[data-testid="tool-zone"]').click();
await page.mouse.move(box.x + 120, box.y + box.height - 160);
await page.mouse.down();
await page.mouse.move(box.x + 260, box.y + box.height - 90, { steps: 5 });
await page.mouse.up();
await page.waitForTimeout(300);
ok((await page.locator('[data-kind="zone"]').count()) >= 6, 'alan çizildi');
await page.locator('[data-testid="tool-select"]').click();
await shot('31-after-edits');
// —— 6. Şemada porttan porta bağla
await page.locator('[data-testid="view-schema"]').click();
await page.waitForTimeout(600);
await page.locator('button:has-text("Bağlantısızlar")').click();
await page.waitForTimeout(400);
const c2 = await cableCount();
// DJ-1'in boş "zone" çıkışından ayna kopya hoparlörün boş girişine sürükle
const ids = await page.evaluate(() => {
  const p = window.__sahnecad.getState().project;
  const dj = p.items.find((i) => i.label === 'DJ-1');
  const used = new Set(p.cables.flatMap((c) => [c.a.item + '#' + c.a.port, c.b.item + '#' + c.b.port]));
  const spk = p.items.find((i) => i.defId === 'qsc-k12.2' && !used.has(i.id + '#in'));
  const port = ['zone1', 'zone2', 'mstb'].find((x) => !used.has(dj.id + '#' + x));
  return { dj: dj.id, spk: spk && spk.id, port };
});
const dot = async (id, port) => {
  const r = await page.locator(`[data-k="port"][data-id="${id}"][data-port="${port}"]`).boundingBox();
  return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
};
const fo = await dot(ids.dj, ids.port);
const fi = ids.spk ? await dot(ids.spk, 'in') : null;
if (fo && fi) {
  await page.mouse.move(fo.x, fo.y);
  await page.mouse.down();
  await page.mouse.move(fi.x, fi.y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  ok((await cableCount()) === c2 + 1, 'şemada sürükleyerek bağlandı');
} else ok(false, 'şemada port bulunamadı ' + JSON.stringify({ fo, fi }));
await shot('32-schema-connected');
// —— 7. Elektrik şeması
await page.locator('button:has-text("Elektrik")').first().click();
await page.waitForTimeout(500);
await shot('33-schema-power');
// —— 8. Dışa aktarma
await page.locator('[data-testid="view-plan"]').click();
await page.waitForTimeout(400);
for (const [label, ext] of [
  ['AutoCAD çizimi (DXF)', '.dxf'],
  ['Plan çizimi (SVG)', '.svg'],
  ['Plan resmi (PNG)', '.png'],
  ['Proje dosyası indir (.json)', '.json'],
]) {
  await page.locator('[data-testid="file-menu"]').click();
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 10000 }), page.locator(`.menu button:has-text("${label}")`).click()]);
  const p = `${out}/export${ext}`;
  await dl.saveAs(p);
  const size = fs.statSync(p).size;
  ok(size > 500 && dl.suggestedFilename().endsWith(ext), `dışa aktarma ${ext} (${size} bayt, ${dl.suggestedFilename()})`);
}
const dxf = fs.readFileSync(`${out}/export.dxf`, 'utf8');
ok(dxf.includes('SECTION') && dxf.trim().endsWith('EOF') && dxf.includes('KABLO_power'), 'DXF yapısı');
const js = JSON.parse(fs.readFileSync(`${out}/export.json`, 'utf8'));
ok(Array.isArray(js.items) && js.items.length > 40, 'JSON proje içeriği');
// —— 9. Kurulumcu modu
await page.locator('[data-testid="file-menu"]').click();
await page.locator('[data-testid="toggle-installer"]').click();
await page.waitForTimeout(300);
ok((await page.locator('[data-testid="tool-cable"]').count()) === 0, 'kurulumcu modunda araçlar gizli');
await page.locator('[data-testid="view-setup"]').click();
await page.waitForTimeout(500);
await page.locator('select').filter({ hasText: 'Deutsch' }).selectOption('de');
await page.waitForTimeout(500);
const setupText = await page.locator('[data-testid="setup-view"]').innerText();
ok(setupText.includes('Aufbauanleitung') && setupText.includes('von der linken Wand'), 'Almanca kurulum talimatı');
await shot('34-setup-de');
await page.locator('[data-testid="file-menu"]').click();
await page.locator('[data-testid="toggle-installer"]').click();
// —— 12. Ses dağılımı: önerileri uygula, geri al
await page.locator('[data-testid="view-analysis"]').click();
await page.waitForTimeout(1200);
ok((await page.locator('[data-testid="coverage-panel"]').count()) === 1, 'ses dağılımı paneli');
ok((await page.locator('[data-testid="cov-profile"]').count()) === 1, 'mesafe profili grafiği');
ok((await page.locator('[data-testid="dance-distance"]').count()) === 1, 'pist mesafesi taraması');
const nItems0 = await itemCount();
const props = await page.locator('[data-testid^="cov-prop-"]').count();
if (props) {
  await page.locator('[data-testid="cov-apply"]').click();
  await page.waitForTimeout(800);
  ok((await itemCount()) > nItems0, `öneriler uygulandı (${nItems0} → ${await itemCount()})`);
  await page.locator('[data-testid="undo"]').click();
  await page.waitForTimeout(400);
  ok((await itemCount()) === nItems0, 'öneri uygulaması geri alındı');
} else ok(true, 'öneri yok (dağılım iyi)');
await shot('50-coverage');
// —— 13. Ölçüm: dB ölçer, sınır, RTA + kalibrasyon, EQ, gecikme (sahte mikrofon = tarama kaydı)
await page.locator('[data-testid="view-measure"]').click();
await page.waitForTimeout(500);
await page.locator('[data-testid="ms-start"]').click();
await page.waitForTimeout(3000);
await page.getByText('dB ölçer').first().click();
await page.waitForTimeout(1200);
const laf = await page.locator('[data-testid="spl-laf"]').innerText();
ok(/\d/.test(laf), 'dB ölçer LAF (' + laf + ')');
ok((await page.locator('[data-testid="spl-history"]').count()) === 1, 'seviye geçmişi grafiği');
await page.locator('[data-testid="limit-preset"]').selectOption('who');
await page.waitForTimeout(300);
ok((await page.locator('[data-testid="spl-laeq"]').innerText()).includes('15'), 'WHO sınırı: 15 dk pencere');
const limSaved = await page.evaluate(() => window.__sahnecad.getState().project.settings.limits);
ok(limSaved && limSaved.laeq === 100 && limSaved.minutes === 15, 'sınır projeye kaydedildi');
await shot('50b-spl');
await page.getByText('RTA', { exact: true }).first().click();
await page.waitForTimeout(800);
const spl0 = await page.locator('[data-testid="ms-spl"]').innerText();
ok(/\d/.test(spl0), 'RTA yanında SPL (' + spl0.replace(/\s+/g, ' ') + ')');
// sahte mikrofon seviyesi oynar: dondur, ofset hesabını doğrula
await page.locator('[data-testid="ms-cal-toggle"]').click();
await page.getByText('Dondur').first().click();
const before = await page.evaluate(() => {
  const s = window.__sahnecadRta.getState();
  return { c: s.lv.cs, off: s.cal.offset };
});
await page.locator('[data-testid="ms-calibrate"]').click();
const after = await page.evaluate(() => window.__sahnecadRta.getState().cal);
ok(after.calibrated && Math.abs(after.offset - before.off - (94 - before.c)) < 0.05, `referansla kalibrasyon (ofset ${before.off.toFixed(1)} → ${after.offset.toFixed(1)})`);
await page.getByText('Devam').first().click();
await page.locator('[data-testid="ms-cal-toggle"]').click();
await page.getByText('Noktalar').first().click();
for (let i = 0; i < 3; i++) await page.locator('[data-testid="ms-demo"]').click();
await page.getByText('EQ', { exact: true }).first().click();
await page.waitForTimeout(800);
ok((await page.locator('[data-testid="peq-table"] tbody tr').count()) >= 1, 'parametrik EQ önerisi');
ok((await page.locator('[data-testid="geq-chart"]').count()) === 1, '31 bant GEQ');
await shot('51-measure');
await page.getByText('Gecikme').first().click();
await page.getByText('Başka cihazdan (WAV)').first().click();
await page.locator('[data-testid="dl-measure"]').click();
await page.waitForTimeout(15500);
const runs = await page.evaluate(() => window.__sahnecadRta.getState().runs.map((r) => r.an.arrivals.map((a) => a.ms)));
ok(runs.length === 1 && runs[0].some((ms) => Math.abs(ms - 23) < 0.3), 'gecikme ölçümü: ikinci varış ≈ 23 ms (' + JSON.stringify(runs) + ')');
ok((await page.locator('[data-testid="ir-chart"]').count()) === 1, 'dürtü yanıtı grafiği');
await shot('51b-delay');
await page.locator('[data-testid="ms-stop"]').click();
// —— 14. Kurulum akış diyagramı ve zaman çizelgesi
await page.locator('[data-testid="view-setup"]').click();
await page.waitForTimeout(600);
ok((await page.locator('[data-testid^="act-"]').count()) >= 6, 'aktivite diyagramı düğümleri');
await page.getByText('Zaman çizelgesi').first().click();
await page.waitForTimeout(300);
ok((await page.locator('[data-testid="gantt"]').count()) === 1, 'zaman çizelgesi');
await shot('52-gantt');
// —— 10. Koyu tema + İngilizce
await page.locator('[title="Açık / koyu tema"]').click();
await page.locator('[data-testid="view-plan"]').click();
await page.waitForTimeout(500);
await shot('35-dark');
await page.locator('[data-testid="view-3d"]').click();
await page.waitForTimeout(3000);
await shot('36-dark-3d');
await page.locator('[title="Light / dark theme"], [title="Açık / koyu tema"]').first().click();
// —— 11. Mobil
const m = await ctx.newPage();
m.on('pageerror', (e) => errors.push('mobile pageerror: ' + e.message));
await m.setViewportSize({ width: 390, height: 844 });
await m.goto(url + '#plan'); // telefonda adres boşsa ana sayfa açılır
await m.waitForSelector('[data-testid="plan-svg"]');
await m.waitForTimeout(800);
if (await m.locator('[data-testid="help-close"]').count()) await m.locator('[data-testid="help-close"]').click();
await m.screenshot({ path: `${out}/40-mobile.png` });
const scrollW = await m.evaluate(() => document.documentElement.scrollWidth);
ok(scrollW <= 392, 'mobilde yatay kaydırma yok (' + scrollW + ')');
await m.locator('[aria-label="menu"]').click();
await m.waitForTimeout(300);
await m.screenshot({ path: `${out}/41-mobile-library.png` });
await browser.close();
if (errors.length) console.log('JS ERRORS:\n' + errors.join('\n'));
if (fails.length || errors.length) {
  console.log('FAILED: ' + fails.join('; '));
  process.exit(1);
}
console.log('ALL FLOWS OK');
