// Tek dosyalık sürüm: tek/index.html → SahneCAD.html (çift tıkla) ve docs/ (GitHub Pages: iPhone, ana ekran, çevrimdışı)
import fs from 'fs';
fs.copyFileSync('tek/index.html', 'SahneCAD.html');
fs.mkdirSync('docs', { recursive: true });
fs.copyFileSync('tek/index.html', 'docs/index.html');
for (const f of ['manifest.webmanifest', 'sw.js', 'icon.svg', 'icon-180.png', 'icon-192.png', 'icon-512.png']) fs.copyFileSync('public/' + f, 'docs/' + f);
// Pages, Jekyll'i atlasın
fs.writeFileSync('docs/.nojekyll', '');
console.log('SahneCAD.html + docs/ hazır');
