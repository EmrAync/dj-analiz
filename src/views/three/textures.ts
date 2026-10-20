import * as THREE from 'three';
import { iconSvgString } from '../../catalog/icons';

// SVG ikon / resim → three.js dokusu (önbellekli)
const cache = new Map<string, THREE.Texture>();

export function iconTexture(name: string, color: string, bg = 'transparent', size = 256): THREE.Texture {
  const key = `ic:${name}:${color}:${bg}:${size}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  cache.set(key, tex);
  const img = new Image();
  img.onload = () => {
    const ctx = c.getContext('2d')!;
    if (bg !== 'transparent') {
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, size, size);
    }
    ctx.drawImage(img, size * 0.12, size * 0.12, size * 0.76, size * 0.76);
    tex.needsUpdate = true;
  };
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(iconSvgString(name, color, size, 1.6));
  return tex;
}

export function imageTexture(dataUrl: string): THREE.Texture {
  const key = 'img:' + dataUrl.length + ':' + dataUrl.slice(-64);
  const hit = cache.get(key);
  if (hit) return hit;
  const tex = new THREE.TextureLoader().load(dataUrl);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  cache.set(key, tex);
  return tex;
}

export function checkerTexture(a: string, b: string, n = 8): THREE.Texture {
  const key = `ck:${a}:${b}:${n}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d')!;
  const s = 256 / n;
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      ctx.fillStyle = (i + j) % 2 ? a : b;
      ctx.fillRect(i * s, j * s, s, s);
    }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  cache.set(key, tex);
  return tex;
}

// Parke / ahşap zemin dokusu
export function woodTexture(): THREE.Texture {
  const key = 'wood';
  const hit = cache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 512;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#b48a5e';
  ctx.fillRect(0, 0, 512, 512);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let row = 0; row < 16; row++) {
    let x = -rnd() * 200;
    while (x < 512) {
      const len = 120 + rnd() * 180;
      const shade = 0.82 + rnd() * 0.3;
      ctx.fillStyle = `rgb(${Math.round(180 * shade)},${Math.round(136 * shade)},${Math.round(92 * shade)})`;
      ctx.fillRect(x, row * 32, len - 2, 30);
      ctx.strokeStyle = 'rgba(70,40,15,0.12)';
      for (let g = 0; g < 4; g++) {
        ctx.beginPath();
        const yy = row * 32 + 4 + rnd() * 22;
        ctx.moveTo(x, yy);
        ctx.bezierCurveTo(x + len * 0.3, yy + rnd() * 4 - 2, x + len * 0.6, yy + rnd() * 4 - 2, x + len - 2, yy);
        ctx.stroke();
      }
      x += len;
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  cache.set(key, tex);
  return tex;
}

// LED ekran için renkli gradyan
export function ledTexture(): THREE.Texture {
  const key = 'led';
  const hit = cache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 512, 256);
  g.addColorStop(0, '#1e1b4b');
  g.addColorStop(0.45, '#7c3aed');
  g.addColorStop(0.75, '#db2777');
  g.addColorStop(1, '#f59e0b');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 512, 256);
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 2;
  for (let x = 0; x <= 512; x += 64) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, 256);
    ctx.stroke();
  }
  for (let y = 0; y <= 256; y += 64) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(512, y);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  cache.set(key, tex);
  return tex;
}

// Hoparlör ön ızgarası (delikli metal)
export function grilleTexture(): THREE.Texture {
  const key = 'grille';
  const hit = cache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#202329';
  ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = '#0d0e11';
  for (let y = 4; y < 128; y += 8)
    for (let x = (y / 8) % 2 ? 8 : 4; x < 128; x += 8) {
      ctx.beginPath();
      ctx.arc(x, y, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(4, 4);
  cache.set(key, tex);
  return tex;
}
