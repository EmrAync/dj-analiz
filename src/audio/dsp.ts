// Ölçüm için saf yardımcılar: oktav bantları, A/C ağırlıkları, kalibrasyon dosyası, yumuşatma.
// Seviyeler "ortalama kare" (MS) ve dB olarak; dBFS: tam ölçekli sinüs = 0 dBFS.

export const ISO31 = [20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000, 20000];

export interface Bands {
  frac: number; // 1/frac oktav
  fc: number[];
  lo: number[];
  hi: number[];
}

// 1/frac oktav bantları (taban 2, 1 kHz merkezli), 20 Hz – 20 kHz
export function octaveBands(frac: number, fLo = 20, fHi = 20000): Bands {
  const fc: number[] = [];
  const kLo = Math.ceil(frac * Math.log2(fLo / 1000) - 1e-9);
  const kHi = Math.floor(frac * Math.log2(fHi / 1000) + 1e-9);
  for (let k = kLo; k <= kHi; k++) fc.push(1000 * Math.pow(2, k / frac));
  const h = Math.pow(2, 1 / (2 * frac));
  return { frac, fc, lo: fc.map((f) => f / h), hi: fc.map((f) => f * h) };
}

// IEC 61672 A ve C ağırlıkları (dB)
export function aWeight(f: number): number {
  const f2 = f * f;
  const ra = (12194 ** 2 * f2 * f2) / ((f2 + 20.6 ** 2) * Math.sqrt((f2 + 107.7 ** 2) * (f2 + 737.9 ** 2)) * (f2 + 12194 ** 2));
  return 20 * Math.log10(ra) + 2.0;
}

export function cWeight(f: number): number {
  const f2 = f * f;
  const rc = (12194 ** 2 * f2) / ((f2 + 20.6 ** 2) * (f2 + 12194 ** 2));
  return 20 * Math.log10(rc) + 0.06;
}

export const dB = (ms: number) => (ms > 0 ? 10 * Math.log10(ms) : -200);
export const ms = (db: number) => Math.pow(10, db / 10);

// Spektrum (bin başına MS) → bant MS. Bant içinde bin yoksa en yakın binin yoğunluğu × bant genişliği.
export function binsToBands(P: Float64Array, binHz: number, b: Bands): Float64Array {
  const out = new Float64Array(b.fc.length);
  const n = P.length;
  for (let i = 0; i < b.fc.length; i++) {
    const k0 = Math.ceil(b.lo[i] / binHz);
    const k1 = Math.floor(b.hi[i] / binHz);
    if (k1 >= k0 && k0 >= 1) {
      let s = 0;
      for (let k = k0; k <= Math.min(k1, n - 1); k++) s += P[k];
      out[i] = s;
    } else {
      const k = Math.max(1, Math.min(n - 1, Math.round(b.fc[i] / binHz)));
      out[i] = P[k] * ((b.hi[i] - b.lo[i]) / binHz);
    }
  }
  return out;
}

// İnce bantları (MS) daha kaba bantlara topla (aynı tabanlı 1/24 → 1/12, 1/6, 1/3, 1/1)
export function regroup(fine: ArrayLike<number>, fineB: Bands, coarse: Bands): Float64Array {
  const out = new Float64Array(coarse.fc.length);
  for (let i = 0; i < fineB.fc.length; i++) {
    const f = fineB.fc[i];
    for (let j = 0; j < coarse.fc.length; j++)
      if (f >= coarse.lo[j] * 0.999 && f < coarse.hi[j] * 0.999) {
        out[j] += fine[i];
        break;
      }
  }
  return out;
}

// Ağırlıklı toplam seviye (MS bantlarından)
export function weighted(msBands: ArrayLike<number>, b: Bands, w: 'A' | 'C' | 'Z'): number {
  let s = 0;
  for (let i = 0; i < b.fc.length; i++) {
    const g = w === 'A' ? aWeight(b.fc[i]) : w === 'C' ? cWeight(b.fc[i]) : 0;
    s += msBands[i] * ms(g);
  }
  return dB(s);
}

// Kesirli oktav yumuşatma (dB eğri, güç ortalaması)
export function smoothDb(fc: number[], lv: number[], frac: number): number[] {
  const h = Math.pow(2, 1 / (2 * frac));
  return fc.map((f) => {
    let s = 0;
    let n = 0;
    for (let i = 0; i < fc.length; i++)
      if (fc[i] >= f / h && fc[i] <= f * h && isFinite(lv[i])) {
        s += ms(lv[i]);
        n++;
      }
    return n ? dB(s / n) : NaN;
  });
}

// —— Kalibrasyon dosyası (miniDSP UMIK-1 / REW biçimi) ——
export interface CalFile {
  name: string;
  sens: number | null; // "Sens Factor" (dB)
  serial: string;
  pts: [number, number][]; // frekans, düzeltme (dB) — ölçüme EKLENİR değil ÇIKARILIR
}

export function parseCal(text: string, name = ''): CalFile | null {
  const pts: [number, number][] = [];
  let sens: number | null = null;
  let serial = '';
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const ms0 = /sens\s*factor\s*=\s*([-+]?\d+(?:[.,]\d+)?)/i.exec(line);
    if (ms0) sens = parseFloat(ms0[1].replace(',', '.'));
    const sn = /SERNO:\s*([\w-]+)/i.exec(line);
    if (sn) serial = sn[1];
    if (/^[*"#;]/.test(line) || /[a-df-z]/i.test(line.replace(/e[-+]?\d/gi, ''))) continue;
    const parts = line.split(/[\s,;\t]+/).filter(Boolean);
    if (parts.length < 2) continue;
    const f = parseFloat(parts[0]);
    const g = parseFloat(parts[1]);
    if (isFinite(f) && isFinite(g) && f > 0) pts.push([f, g]);
  }
  if (pts.length < 3) return null;
  pts.sort((a, b) => a[0] - b[0]);
  return { name, sens, serial, pts };
}

export function calAt(cal: CalFile | null | undefined, f: number): number {
  if (!cal || !cal.pts.length) return 0;
  const p = cal.pts;
  if (f <= p[0][0]) return p[0][1];
  if (f >= p[p.length - 1][0]) return p[p.length - 1][1];
  let lo = 0;
  let hi = p.length - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (p[m][0] <= f) lo = m;
    else hi = m;
  }
  const t = Math.log(f / p[lo][0]) / Math.log(p[hi][0] / p[lo][0]);
  return p[lo][1] + (p[hi][1] - p[lo][1]) * t;
}

// UMIK-1: Sens Factor = 94 dB SPL'de okunan RMS dBFS (tam ölçekli sinüs −3,01 dBFS kabulüyle, OS giriş seviyesi en yüksek).
// Bizim dBFS'imiz sinüs = 0 dBFS → ofset = 94 − (sens + 3,01). Yaklaşıktır; mümkünse referansla kalibre et.
export function umikNominalOffset(sens: number): number {
  return 94 - (sens + 3.01);
}

// —— Hayali (örnek) ölçüm: oda modu, alçak orta şişme, tiz düşüşü ——
export function demoCurve(fc: number[], level = 98): number[] {
  const bump = (f: number, f0: number, g: number, oct: number) => g * Math.exp(-Math.pow(Math.log2(f / f0) / oct, 2));
  const raw = fc.map((f) => {
    let v = 0;
    v += 7 / (1 + Math.pow(f / 85, 2)); // sub
    v += bump(f, 63, 5, 0.18); // oda modu
    v += bump(f, 125, -6, 0.12); // iptal
    v += bump(f, 250, 4, 0.5); // gövde şişmesi
    v += bump(f, 2500, 3, 0.35); // sertlik
    v += f > 6000 ? -2.2 * Math.log2(f / 6000) : 0;
    v += f < 35 ? -12 * Math.log2(35 / f) : 0;
    v += Math.sin(f * 0.013) * 0.6;
    return v;
  });
  // ortalama seviyeyi ayarla (A ağırlıklı yaklaşık)
  let s = 0;
  for (let i = 0; i < fc.length; i++) s += ms(raw[i] + aWeight(fc[i]));
  const off = level - dB(s);
  return raw.map((v) => v + off);
}
