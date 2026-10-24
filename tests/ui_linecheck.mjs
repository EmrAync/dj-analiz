// Kanal EQ asistanı: kanal ekle, başlangıç ayarı, sahte mikrofonla dinle, öneri, mix haritası, telefonda görünüm
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
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
const wav = path.resolve(out, 'voice.wav');
execFileSync('node', ['--import', 'tsx', 'tests/make_voice_fixture.ts', wav]);
const errors = [];
const fails = [];
const ok = (cond, msg) => {
  if (!cond) fails.push(msg);
  console.log((cond ? 'PASS ' : 'FAIL ') + msg);
};
const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${wav}`, '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['microphone'] });
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()));
page.on('dialog', (d) => (d.type() === 'prompt' ? d.accept('Grup Test') : d.accept()));
const S = (fn, arg) => page.evaluate(fn, arg);
const shot = (n) => page.screenshot({ path: `${out}/${n}.png` });

await page.goto(url + '#olcum');
await page.waitForSelector('[data-testid="measure-view"]');
if (await page.locator('[data-testid="help-close"]').count()) await page.locator('[data-testid="help-close"]').click();
const intro = page.locator('.ms-intro .ibtn');
if (await intro.count()) await intro.first().click();
await page.getByText('Kanal EQ').first().click();
await page.waitForSelector('[data-testid="lc-start"]');
await page.locator('[data-testid="lc-import"]').click();
await page.waitForSelector('[data-testid="linecheck"]');
const nImp = await page.locator('[data-testid="lc-row"]').count();
ok(nImp >= 2, 'projeden kanallar: ' + nImp);
// mikser: Ui24R, Pa5X ve kadın vokal ekle
await page.locator('[data-testid="lc-mixer"]').selectOption('ui24r');
await page.locator('[data-testid="lc-add"]').selectOption('pa5x');
ok((await page.locator('[data-testid="lc-row"]').count()) === nImp + 6, 'Pa5X 6 çıkış eklendi');
await page.locator('[data-testid="lc-add"]').selectOption('baglama-long');
await page.locator('[data-testid="lc-add"]').selectOption('voc-f');
await page.waitForSelector('[data-testid="lc-channel"]');
ok((await page.locator('[data-testid="lc-band"]').count()) === 4, '4 bant satırı');
const lines = await page.locator('[data-testid="lc-settings"]').innerText();
ok(/HPF/.test(lines) && /De-esser/.test(lines), 'Ui24R başlangıç ayarı (HPF, de-esser)');
ok(/Ortada \(C\)/.test(lines), 'mono: pan ortada');
// boğuk ses seç
await page.getByText('Boğuk', { exact: true }).click();
await page.waitForTimeout(150);
await shot('lc-start');
// dinle (sahte mikrofon: boğuk kadın sesi)
await page.locator('[data-testid="lc-mic"]').click();
await page.waitForFunction(() => window.__sahnecadRta.getState().running, null, { timeout: 15000 });
await page.waitForTimeout(800);
await page.locator('[data-testid="lc-listen"]').getByText('8 s').click();
await page.locator('[data-testid="lc-go"]').click();
await page.waitForSelector('[data-testid="lc-result"]', { timeout: 30000 });
const res = await page.locator('[data-testid="lc-result"]').innerText();
console.log(res.replace(/\s+/g, ' ').slice(0, 400));
ok(/Anlaşılırlık/.test(res), 'anlaşılırlık göstergesi');
ok(/kıs/.test(res), 'kısma önerisi var');
const meas = await S(() => { const m = window.__sahnecad.getState().project.mix.channels.find((c) => c.src === 'voc-f').meas; return { n: m.db.length, f0: m.f0 && Math.round(m.f0.med), mode: m.mode }; });
ok(meas.n > 40 && meas.f0 > 180 && meas.f0 < 320, 'ölçüm kaydı ve ses perdesi: ' + JSON.stringify(meas));
const mud = await S(() => { const ch = window.__sahnecad.getState().project.mix.channels.find((c) => c.src === 'voc-f'); return ch.meas ? 1 : 0; });
ok(mud === 1, 'ölçüm projede');
await page.locator('[data-testid="lc-result"]').scrollIntoViewIfNeeded();
await shot('lc-result');
// uygula → tekrar dinlemede EQ hesaba katılır
await page.locator('[data-testid="lc-applied"]').click();
ok(await S(() => !!window.__sahnecad.getState().project.mix.channels.find((c) => c.src === 'voc-f').applied), 'uygulanan EQ kaydı');
// mix haritası
await page.locator('[data-testid="lc-back"]').click().catch(() => {});
await page.locator('[data-testid="lc-mixmap"]').click();
await page.waitForSelector('[data-testid="lc-map"]');
const map = await page.locator('[data-testid="lc-map"]').innerText();
ok(/Vokale yer aç/.test(map), 'vokale yer açma notu');
ok(/Pa5X/.test(map), 'Pa5X kanalları haritada');
await shot('lc-map');
// kadro kaydet
await page.locator('[data-testid="lc-lineups"]').click();
await page.getByText('Bu kadroyu kaydet').click();
await page.waitForTimeout(400);
ok((await S(() => window.__sahnecad.getState().library.lineups.length)) === 1, 'kadro kütüphanede');

// telefon
const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, permissions: ['microphone'] });
const m = await phone.newPage();
m.on('pageerror', (e) => errors.push('phone: ' + e.message));
await m.goto(url + '#olcum');
await m.waitForSelector('[data-testid="measure-view"]');
if (await m.locator('[data-testid="help-close"]').count()) await m.locator('[data-testid="help-close"]').click();
await m.getByText('Kanal EQ').first().tap();
await m.locator('[data-testid="lc-empty"]').tap();
await m.locator('[data-testid="lc-add"]').selectOption('voc-m');
await m.waitForSelector('[data-testid="lc-channel"]');
const sw = await m.evaluate(() => document.documentElement.scrollWidth);
ok(sw <= 392, 'telefonda yatay kaydırma yok (' + sw + ')');
await m.screenshot({ path: `${out}/lc-phone.png`, fullPage: false });
await phone.close();

console.log(errors.length ? errors.join('\n') : 'konsol hatası yok');
await browser.close();
if (errors.length || fails.length) {
  console.log('BAŞARISIZ: ' + [...fails, ...errors].join(' | '));
  process.exit(1);
}
console.log('UI kanal EQ testleri tamam');
