// README için ekran görüntüleri (JPEG). Kullanım: node tests/docs_shots.mjs <url> docs
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  ({ chromium } = require('/opt/node22/lib/node_modules/playwright'));
}
const url = process.argv[2] || 'http://127.0.0.1:4173/';
const out = process.argv[3] || 'docs';
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 860 } });
const snap = (n) => page.screenshot({ path: `${out}/${n}.jpg`, type: 'jpeg', quality: 78 });
await page.goto(url);
await page.waitForSelector('[data-testid="plan-svg"]');
await page.waitForTimeout(800);
if (await page.locator('[data-testid="help-close"]').count()) await page.locator('[data-testid="help-close"]').click();
await page.locator('[data-label="PA-L"] rect').first().click();
await page.waitForTimeout(300);
await snap('plan');
await page.locator('[data-testid="toggle-heat"]').click();
await page.waitForTimeout(600);
await snap('isi-haritasi');
await page.locator('[data-testid="toggle-heat"]').click();
await page.locator('[data-testid="view-3d"]').click();
await page.waitForTimeout(3500);
await snap('3d');
await page.locator('[data-testid="view-schema"]').click();
await page.waitForTimeout(900);
await snap('sema');
await page.locator('[data-testid="view-lists"]').click();
await page.waitForTimeout(600);
await snap('listeler');
await page.locator('[data-testid="view-setup"]').click();
await page.waitForTimeout(800);
await page.locator('[data-testid="setup-view"]').evaluate((e) => e.scrollTo(0, 820));
await page.waitForTimeout(300);
await snap('kurulum');
await page.locator('[data-testid="view-plan"]').click();
await page.locator('[data-testid="open-wizard"]').click();
await page.waitForTimeout(800);
await snap('sihirbaz');
await browser.close();
console.log('ok');
