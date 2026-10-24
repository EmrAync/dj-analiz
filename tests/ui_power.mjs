// Elektrik alternatifleri (A/B/C), paketleme ve telefon arayüzü akışları
import { createRequire } from 'module';
import fs from 'fs';
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
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()));
page.on('dialog', (d) => d.accept());
const shot = (n) => page.screenshot({ path: `${out}/${n}.png` });
const S = (fn, arg) => page.evaluate(fn, arg);

await page.goto(url);
await page.waitForSelector('[data-testid="plan-svg"]');
await page.waitForTimeout(600);
if (await page.locator('[data-testid="help-close"]').count()) await page.locator('[data-testid="help-close"]').click();

// —— 1. Elektrik şemasında prize tıkla → A/B planlarını kur
const wallId = await S(() => {
  const s = window.__sahnecad.getState();
  const w = s.project.items.find((i) => i.defId === 'wall-cee16r');
  s.set({ view: 'schema', schemaMode: 'power' });
  s.select({ items: [w.id] });
  return w.id;
});
ok(!!wallId, 'demo projesinde CEE prizi var');
await page.waitForSelector('[data-testid="make-alts"]');
await page.locator('[data-testid="make-alts"]').click();
await page.waitForTimeout(300);
const groups = await S(() => window.__sahnecad.getState().project.variants?.length || 0);
ok(groups === 1, 'alternatif grubu kuruldu');
// dağıtıcıyı seç → panel görünür
await S(() => {
  const s = window.__sahnecad.getState();
  const c = s.project.cables.find((x) => x.variant);
  s.select({ cables: [c.id] });
});
await page.waitForSelector('[data-testid="variant-list"]');
ok((await page.locator('[data-testid="variant-list"] .var-card').count()) === 2, 'A ve B kartları');
await page.locator('[data-testid="use-B"]').click();
await page.waitForTimeout(200);
const activeB = await S(() => {
  const g = window.__sahnecad.getState().project.variants[0];
  return g.variants.find((v) => v.id === g.active).label;
});
ok(activeB === 'B', 'B seçildi');
await page.locator('[data-testid="toggle-alts"]').click();
await page.waitForTimeout(300);
await shot('power-alts-schema');
const st0 = (await page.locator('[data-testid="status"]').innerText()).replace(/\s+/g, ' ');
ok(!/hata/i.test(st0) || /0 hata/.test(st0), 'durum çubuğunda hata yok: ' + st0.slice(0, 80));
// çizim modu: yeni parça B planına girer
await page.locator('[data-testid="variant-B"] button[title="Çiz"]').click();
ok(await page.locator('[data-testid="variant-banner"]').isVisible(), 'çizim şeridi görünür');
await S(() => window.__sahnecad.getState().set({ editVariant: null }));

// —— 2. Kurulum talimatında A/B seçenekleri
await S(() => window.__sahnecad.getState().set({ view: 'setup' }));
await page.waitForTimeout(300);
ok((await page.locator('.step .var-card').count()) === 2, 'kurulumda A/B kartları');
await page.locator('.step .var-card').first().scrollIntoViewIfNeeded();
await shot('power-alts-setup');

// —— 3. Malzeme listesinde "alternatifler için yanına al"
await S(() => window.__sahnecad.getState().set({ view: 'lists' }));
await page.waitForTimeout(300);
const bomText = await page.locator('[data-testid="lists-view"]').innerText();
ok(/Alternatifler için yanına al/.test(bomText), 'listede alternatif bölümü');
ok(/Adaptör CEE 32 A/.test(bomText), 'A planının adaptörü listede');

// —— geri al: grup kalkar
await S(() => {
  const s = window.__sahnecad.getState();
  for (let i = 0; i < 3; i++) s.undo();
});
ok((await S(() => window.__sahnecad.getState().project.variants?.length || 0)) === 0, 'geri alınca grup gider');


// —— 4. Kayıtlı salon: A/B ile kaydet, projeye ekle
await S(() => window.__sahnecad.getState().redo()); // grubu geri getir
await S(() => window.__sahnecad.getState().set({ view: 'plan', leftOpen: true, leftTab: 'areas' }));
await page.waitForTimeout(300);
await page.locator('[data-testid="venue-save-open"]').first().click();
await page.locator('[data-testid="venue-form"] input.inp').fill('Test Salonu');
await page.locator('[data-testid="venue-save"]').click();
await page.waitForTimeout(400);
ok((await S(() => window.__sahnecad.getState().library.venues.length)) === 1, 'salon kütüphaneye kaydedildi');
const vInfo = await S(() => { const v = window.__sahnecad.getState().library.venues[0]; return { g: v.variants.length, items: v.items.length, gear: v.gear }; });
ok(vInfo.g === 1 && !vInfo.gear && vInfo.items >= 3, 'salonda elektrik alternatifleri var: ' + JSON.stringify(vInfo));
const areas0 = await S(() => window.__sahnecad.getState().project.areas.length);
await page.locator('[data-testid="venue-add"]').first().click();
await page.waitForTimeout(300);
const after = await S(() => { const s = window.__sahnecad.getState(); return { areas: s.project.areas.length, groups: s.project.variants.length, cur: s.areaId === s.project.areas[s.project.areas.length - 1].id }; });
ok(after.areas === areas0 + 1 && after.groups === 2 && after.cur, 'salon yeni bölüm olarak eklendi: ' + JSON.stringify(after));
await shot('venue-added');
await S(() => { const s = window.__sahnecad.getState(); s.undo(); s.set({ leftTab: 'library' }); });

// —— 5. Paketleme: öner, çanta aç, işaretle, kütüphaneye kaydet
await S(() => window.__sahnecad.getState().set({ view: 'pack', packCase: null }));
await page.waitForSelector('[data-testid="pack-view"]');
await page.locator('[data-testid="pack-suggest"]').first().click();
await page.waitForTimeout(300);
const nCases = await page.locator('[data-testid="pack-card"]').count();
ok(nCases >= 3, 'öneri çantaları: ' + nCases);
const miss = await S(() => document.querySelectorAll('.pk-miss').length);
ok(miss === 0, 'öneriden sonra çantasız parça kalmadı');
await shot('pack-home');
await page.locator('[data-testid="pack-card"]').first().click();
await page.waitForSelector('[data-testid="case-lines"]');
const nLines = await page.locator('[data-testid="case-line"]').count();
ok(nLines > 0, 'çantada satırlar: ' + nLines);
await page.locator('[data-testid="case-line"] .pk-check').first().click();
await page.waitForTimeout(150);
const packed = await S(() => Object.keys(window.__sahnecad.getState().project.packing || {}).length);
ok(packed === 1, 'satır işaretlendi');
await page.locator('[data-testid="pack-edit"]').click();
await page.locator('[data-testid="case-add"] input.inp').fill('Yedek pil');
await page.locator('[data-testid="case-add"] input.inp').press('Enter');
await page.waitForTimeout(150);
ok((await page.locator('[data-testid="case-line"]').count()) === nLines + 1, 'serbest satır eklendi');
await page.locator('[data-testid="case-name"]').fill('Elektrik çantası 1');
await page.locator('[data-testid="pack-edit"]').click();
await page.locator('[data-testid="case-save-tpl"]').click();
await page.waitForTimeout(300);
ok((await S(() => window.__sahnecad.getState().library.cases.length)) === 1, 'çanta kütüphaneye kaydedildi');
await shot('pack-case');
await page.locator('[data-testid="pack-back"]').click();
// geri toplama modu
await S(() => window.__sahnecad.getState().set({ packMode: 'back' }));
await page.waitForTimeout(100);
await shot('pack-home-back');

// —— 6. Telefon: ana sayfa, alt çubuk, çanta sayfası, alt panel
const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const m = await phone.newPage();
m.on('pageerror', (e) => errors.push('phone pageerror: ' + e.message));
m.on('console', (x) => x.type() === 'error' && errors.push('phone console: ' + x.text()));
await m.goto(url);
await m.waitForSelector('[data-testid="home-view"]');
if (await m.locator('[data-testid="help-close"]').count()) await m.locator('[data-testid="help-close"]').click();
ok(await m.locator('[data-testid="bottom-nav"]').isVisible(), 'telefonda alt çubuk');
ok(await m.locator('[data-testid="home-next"]').isVisible(), 'sıradaki adım kartı');
await m.screenshot({ path: `${out}/phone-home.png` });
await m.locator('[data-testid="bnav-pack"]').tap();
await m.waitForSelector('[data-testid="pack-view"]');
await m.screenshot({ path: `${out}/phone-pack.png` });
await m.locator('[data-testid="bnav-setup"]').tap();
await m.waitForSelector('[data-testid="setup-view"], .page');
await m.screenshot({ path: `${out}/phone-setup.png` });
await m.locator('[data-testid="more-menu"]').tap();
await m.locator('[data-testid="more-schema"]').tap();
await m.waitForSelector('[data-testid="schema-view"]');
await m.evaluate(() => { const s = window.__sahnecad.getState(); s.set({ schemaMode: 'power' }); const c = s.project.cables.find((x) => x.type.startsWith('cee')) || s.project.cables[0]; s.select({ cables: [c.id] }); });
await m.waitForTimeout(400);
ok(await m.evaluate(() => window.__sahnecad.getState().rightOpen), 'seçince alt panel açıldı');
await m.screenshot({ path: `${out}/phone-sheet.png` });
await m.locator('[data-testid="bnav-home"]').tap();
await m.waitForSelector('[data-testid="home-view"]');
await phone.close();

console.log(errors.length ? errors.join('\n') : 'konsol hatası yok');
await browser.close();
if (errors.length || fails.length) {
  console.log('BAŞARISIZ: ' + [...fails, ...errors].join(' | '));
  process.exit(1);
}
console.log('UI elektrik/paket testleri tamam');
