import type { Project, SoundLimits } from '../model/types';

// Ses seviyesi ölçer (IEC 61672'ye yakın): A/C ağırlık filtreleri (birinci derece bölümler, bilineer + ön bükme),
// Fast (125 ms) / Slow (1 s) zaman ağırlığı, Leq, LCpeak, saniyelik kayıt.
// Değerler "ortalama kare" (MS, tam ölçek sinüs = 0 dBFS için ×2) tutulur; dB SPL = 10·log10(MS) + ofset.

const F1 = 20.598997;
const F2 = 107.65265;
const F3 = 737.86223;
const F4 = 12194.217;

interface Sec {
  b0: number;
  b1: number;
  a1: number;
}

function hp(fc: number, fs: number): Sec {
  const K = 2 * fs;
  const w = 2 * fs * Math.tan((Math.PI * fc) / fs);
  return { b0: K / (K + w), b1: -K / (K + w), a1: (w - K) / (K + w) };
}

function lp(fc: number, fs: number): Sec {
  const K = 2 * fs;
  const w = 2 * fs * Math.tan((Math.PI * fc) / fs);
  return { b0: w / (K + w), b1: w / (K + w), a1: (w - K) / (K + w) };
}

export type Weight = 'A' | 'C' | 'Z';

export interface WFilter {
  secs: Sec[];
  g: number;
}

function respAt(secs: Sec[], f: number, fs: number): number {
  const w = (2 * Math.PI * f) / fs;
  let mag = 1;
  for (const s of secs) {
    const nr = s.b0 + s.b1 * Math.cos(w);
    const ni = -s.b1 * Math.sin(w);
    const dr = 1 + s.a1 * Math.cos(w);
    const di = -s.a1 * Math.sin(w);
    mag *= Math.hypot(nr, ni) / Math.hypot(dr, di);
  }
  return mag;
}

export function designWeight(w: Weight, fs: number): WFilter {
  if (w === 'Z') return { secs: [], g: 1 };
  const secs = w === 'A' ? [hp(F1, fs), hp(F1, fs), hp(F2, fs), hp(F3, fs), lp(F4, fs), lp(F4, fs)] : [hp(F1, fs), hp(F1, fs), lp(F4, fs), lp(F4, fs)];
  return { secs, g: 1 / respAt(secs, 1000, fs) };
}

// Filtrenin f'deki kazancı (dB) — test ve kontrol için
export function weightDb(flt: WFilter, f: number, fs: number): number {
  return 20 * Math.log10(respAt(flt.secs, f, fs) * flt.g);
}

class Chain {
  private x1: Float64Array;
  private y1: Float64Array;
  constructor(private f: WFilter) {
    this.x1 = new Float64Array(f.secs.length);
    this.y1 = new Float64Array(f.secs.length);
  }
  run(x: number): number {
    let v = x * this.f.g;
    const s = this.f.secs;
    for (let i = 0; i < s.length; i++) {
      const y = s[i].b0 * v + s[i].b1 * this.x1[i] - s[i].a1 * this.y1[i];
      this.x1[i] = v;
      this.y1[i] = y;
      v = y;
    }
    return v;
  }
}

export interface SecondRec {
  t: number; // zaman damgası (ms, epoch)
  a: number; // LAeq,1s (MS)
  c: number; // LCeq,1s
  z: number;
  af: number; // LAFmax bu saniyede (MS)
  cpk: number; // LCpeak bu saniyede (genlik²·2 → MS ölçeğinde tepe)
}

export interface MeterRead {
  af: number; // LAF (MS)
  as: number; // LAS
  cs: number; // LCS
  zs: number; // LZS
  leqA: number; // başlangıçtan beri (MS)
  leqC: number;
  maxAF: number;
  minAF: number;
  cpk: number; // LCpeak başlangıçtan beri (MS ölçeğinde: tepe² ×2)
  secs: number;
}

export class Meter {
  private A: Chain;
  private C: Chain;
  private aF: number;
  private aS: number;
  private af = 0;
  private as = 0;
  private cs = 0;
  private zs = 0;
  private sA = 0;
  private sC = 0;
  private n = 0;
  private maxAF = 0;
  private minAF = Infinity;
  private cpk = 0;
  // saniye toplayıcı
  private secA = 0;
  private secC = 0;
  private secZ = 0;
  private secN = 0;
  private secAF = 0;
  private secPk = 0;
  private warm: number;
  hist: SecondRec[] = [];
  constructor(public fs: number) {
    this.A = new Chain(designWeight('A', fs));
    this.C = new Chain(designWeight('C', fs));
    this.aF = 1 - Math.exp(-1 / (fs * 0.125));
    this.aS = 1 - Math.exp(-1 / (fs * 1));
    this.warm = Math.round(fs * 0.5); // filtrelerin oturması
  }

  reset(): void {
    this.sA = 0;
    this.sC = 0;
    this.n = 0;
    this.maxAF = 0;
    this.minAF = Infinity;
    this.cpk = 0;
  }

  clearHistory(): void {
    this.hist = [];
  }

  process(x: Float32Array | number[], now = Date.now()): void {
    const sec = this.fs;
    for (let i = 0; i < x.length; i++) {
      const v = x[i];
      const a = this.A.run(v);
      const c = this.C.run(v);
      if (this.warm > 0) {
        this.warm--;
        continue;
      }
      const a2 = a * a * 2;
      const c2 = c * c * 2;
      const z2 = v * v * 2;
      this.af += (a2 - this.af) * this.aF;
      this.as += (a2 - this.as) * this.aS;
      this.cs += (c2 - this.cs) * this.aS;
      this.zs += (z2 - this.zs) * this.aS;
      this.sA += a2;
      this.sC += c2;
      this.n++;
      if (this.af > this.maxAF) this.maxAF = this.af;
      if (this.n > sec && this.af < this.minAF) this.minAF = this.af;
      if (c2 > this.cpk) this.cpk = c2;
      this.secA += a2;
      this.secC += c2;
      this.secZ += z2;
      this.secN++;
      if (this.af > this.secAF) this.secAF = this.af;
      if (c2 > this.secPk) this.secPk = c2;
      if (this.secN >= sec) {
        this.hist.push({ t: now, a: this.secA / this.secN, c: this.secC / this.secN, z: this.secZ / this.secN, af: this.secAF, cpk: this.secPk });
        if (this.hist.length > 6 * 3600) this.hist.shift();
        this.secA = this.secC = this.secZ = 0;
        this.secN = 0;
        this.secAF = 0;
        this.secPk = 0;
      }
    }
  }

  read(): MeterRead {
    return { af: this.af, as: this.as, cs: this.cs, zs: this.zs, leqA: this.n ? this.sA / this.n : 0, leqC: this.n ? this.sC / this.n : 0, maxAF: this.maxAF, minAF: this.minAF, cpk: this.cpk, secs: this.n / this.fs };
  }
}

// Son 'secs' saniyenin enerji ortalaması (MS)
export function rollingLeq(hist: SecondRec[], secs: number, key: 'a' | 'c' = 'a'): { ms: number; n: number } {
  const k = Math.min(hist.length, Math.max(1, Math.round(secs)));
  let s = 0;
  for (let i = hist.length - k; i < hist.length; i++) s += hist[i][key];
  return { ms: k ? s / k : 0, n: k };
}

// —— Yasal / önerilen sınırlar ——
export interface LimitPreset {
  laeq: number;
  minutes: number;
  lcpeak: number;
}

export const LIMIT_PRESETS: Record<'din15905' | 'who', LimitPreset> = {
  din15905: { laeq: 99, minutes: 30, lcpeak: 135 }, // DIN 15905-5 (Almanya): Lr 30 dk ≤ 99 dB(A), LCpeak ≤ 135 dB(C)
  who: { laeq: 100, minutes: 15, lcpeak: 135 }, // WHO 2022 güvenli dinleme mekanları: LAeq 15 dk ≤ 100 dB
};

export const LIMITS_DEFAULT: SoundLimits = { on: true, preset: 'din15905', ...LIMIT_PRESETS.din15905 };

export function limitsOf(p: Project): SoundLimits {
  return { ...LIMITS_DEFAULT, ...(p.settings.limits || {}) };
}
