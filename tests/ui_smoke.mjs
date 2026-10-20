// Playwright ile tıklayarak duman testi: her görünüm açılır, ekran görüntüsü alınır, JS hatası varsa başarısız.
// Kullanım: node tests/ui_smoke.mjs <url> <çıktı_klasörü>
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
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 920 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push('console: ' + m.text());
});
const shot = async (name) => {
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log('shot', name);
};
await page.goto(url);
await page.waitForSelector('[data-testid="plan-svg"]');
await page.waitForTimeout(800);
await shot('00-welcome');
const close = page.locator('[data-testid="help-close"]');
if (await close.count()) await close.click();
await shot('01-plan');
// bir hoparlör seç
await page.locator('[data-label="PA-L"] rect').first().click();
await shot('02-plan-selected');
// ısı haritası
await page.locator('[data-testid="toggle-heat"]').click();
await page.waitForTimeout(600);
await shot('03-plan-heat');
await page.locator('[data-testid="toggle-heat"]').click();
for (const v of ['3d', 'schema', 'lists', 'analysis', 'setup']) {
  await page.locator(`[data-testid="view-${v}"]`).click();
  await page.waitForTimeout(v === '3d' ? 3500 : 900);
  await shot('10-' + v);
}
// sihirbaz
await page.locator('[data-testid="view-plan"]').click();
await page.locator('[data-testid="open-wizard"]').click();
await page.waitForTimeout(800);
await shot('20-wizard');
await page.locator('[data-testid="wiz-create"]').click();
await page.waitForTimeout(900);
await shot('21-wizard-result');
// kütüphaneden ekle
await page.locator('[data-testid="ltab-library"]').click();
await page.locator('[data-testid="lib-search"]').fill('prime');
await page.locator('[data-testid="lib-denon-prime4"]').click();
const box = await page.locator('[data-testid="plan-svg"]').boundingBox();
await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.8);
await page.waitForTimeout(500);
await shot('22-placed');
// kontrol paneli
await page.locator('[data-testid="ltab-checks"]').click();
await shot('23-checks');
// kurulumcu modu
await page.locator('[data-testid="file-menu"]').click();
await shot('24-file-menu');
await page.keyboard.press('Escape');
await browser.close();
if (errors.length) {
  console.log('ERRORS:\n' + errors.join('\n'));
  process.exit(1);
}
console.log('OK, no JS errors');
