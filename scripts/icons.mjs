// public/icon.svg → PNG simgeler (iPhone ana ekran, PWA). Kullanım: node scripts/icons.mjs
import { createRequire } from 'module';
import fs from 'fs';
const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  ({ chromium } = require('/opt/node22/lib/node_modules/playwright'));
}
const svg = fs.readFileSync('public/icon.svg', 'utf8');
const browser = await chromium.launch();
for (const [size, name, pad] of [[180, 'icon-180.png', 0], [192, 'icon-192.png', 0], [512, 'icon-512.png', 0]]) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  // iPhone köşeleri kendisi yuvarlar: arka planı tam doldur
  const full = svg.replace('rx="112"', 'rx="0"');
  await page.setContent(`<html><body style="margin:0;padding:${pad}px;background:#2563eb">${full.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  await page.screenshot({ path: `public/${name}`, omitBackground: false });
  await page.close();
}
await browser.close();
console.log('ok');
