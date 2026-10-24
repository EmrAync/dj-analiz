// Kanal dinleme analizi: uzun süreli ortalama spektrum (LTAS, sadece ses olan anlar) ve temel frekans (YIN).
// Saf fonksiyonlar (Node testleri için DOM yok).
import { binsToBands, dB, octaveBands, type Bands } from './dsp';
import { fft } from './sweep';

export const LTAS_BANDS: Bands = octaveBands(6, 45, 16000);

export interface Ltas {
  fc: number[];
  db: number[]; // 1/6 oktav bant gücü (dBFS, pembe gürültü düz görünür)
  active: number; // sesli kare oranı
  peak: number; // dBFS
  rms: number; // sesli karelerin ortalaması (dBFS)
  crest: number; // tepe − ortalama (dB)
  secs: number;
}

export interface PitchStats {
  med: number;
  lo: number; // %10
  hi: number; // %90
  voiced: number; // perdeli kare oranı
}

const N = 4096;

let hann: Float64Array | null = null;
function window(): Float64Array {
  if (!hann) {
    hann = new Float64Array(N);
    for (let i = 0; i < N; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));
  }
  return hann;
}

function pct(a: number[], p: number): number {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.max(0, Math.round((s.length - 1) * p)))];
}

// all=true: sessizlik / gürültü ölçümü (tüm kareler)
export function analyzeTake(x: Float32Array, fs: number, all = false): Ltas | null {
  if (x.length < N * 2) return null;
  const hop = N / 2;
  const nF = Math.floor((x.length - N) / hop) + 1;
  const energy: number[] = [];
  for (let f = 0; f < nF; f++) {
    let s = 0;
    const o = f * hop;
    for (let i = 0; i < N; i++) s += x[o + i] * x[o + i];
    energy.push(dB(s / N));
  }
  const maxE = Math.max(...energy);
  const thr = all ? -Infinity : Math.max(maxE - 30, pct(energy, 0.2) + 6, -75);
  const w = window();
  let wp = 0;
  for (let i = 0; i < N; i++) wp += w[i] * w[i];
  const acc = new Float64Array(N / 2);
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  let used = 0;
  let sumMs = 0;
  for (let f = 0; f < nF; f++) {
    if (energy[f] < thr) continue;
    const o = f * hop;
    for (let i = 0; i < N; i++) {
      re[i] = x[o + i] * w[i];
      im[i] = 0;
    }
    fft(re, im);
    for (let k = 1; k < N / 2; k++) acc[k] += (re[k] * re[k] + im[k] * im[k]) / wp;
    sumMs += Math.pow(10, energy[f] / 10);
    used++;
  }
  if (!used) return null;
  // tek taraflı güç (sinüs = 0 dBFS ölçeği: ×2)
  const P = new Float64Array(N / 2);
  for (let k = 1; k < N / 2; k++) P[k] = ((acc[k] / used) * 2) / N;
  const bands = binsToBands(P, fs / N, LTAS_BANDS);
  let pk = 0;
  for (let i = 0; i < x.length; i++) pk = Math.max(pk, Math.abs(x[i]));
  const rms = dB(sumMs / used);
  const peak = pk > 0 ? 20 * Math.log10(pk) : -120;
  return { fc: LTAS_BANDS.fc.slice(), db: Array.from(bands, (v) => dB(v)), active: used / nF, peak, rms, crest: peak - rms, secs: x.length / fs };
}

// YIN temel frekans takibi (~12 kHz'e indirilmiş sinyalde)
export function pitchStats(x: Float32Array, fs: number, lo = 60, hi = 1100): PitchStats | null {
  const D = Math.max(1, Math.round(fs / 12000));
  const sr = fs / D;
  const m = Math.floor(x.length / D);
  if (m < 2048) return null;
  const y = new Float64Array(m);
  for (let i = 0; i < m; i++) {
    let s = 0;
    for (let k = 0; k < D; k++) s += x[i * D + k];
    y[i] = s / D;
  }
  const W = 512;
  const maxLag = Math.min(Math.ceil(sr / lo), W);
  const minLag = Math.max(2, Math.floor(sr / hi));
  const hop = 384;
  const d = new Float64Array(maxLag + 1);
  const f0s: number[] = [];
  let frames = 0;
  // enerji eşiği (sessiz kareleri atla)
  const en: number[] = [];
  for (let o = 0; o + W + maxLag < m; o += hop) {
    let s = 0;
    for (let j = 0; j < W; j++) s += y[o + j] * y[o + j];
    en.push(dB(s / W));
  }
  const thr = Math.max(Math.max(...en) - 30, pct(en, 0.2) + 6);
  let fi = 0;
  for (let o = 0; o + W + maxLag < m; o += hop, fi++) {
    if (en[fi] < thr) continue;
    frames++;
    d[0] = 1;
    let run = 0;
    for (let tau = 1; tau <= maxLag; tau++) {
      let s = 0;
      for (let j = 0; j < W; j++) {
        const v = y[o + j] - y[o + j + tau];
        s += v * v;
      }
      run += s;
      d[tau] = run > 0 ? (s * tau) / run : 1;
    }
    let best = -1;
    for (let tau = minLag; tau < maxLag; tau++) {
      if (d[tau] < 0.15) {
        while (tau + 1 < maxLag && d[tau + 1] < d[tau]) tau++;
        best = tau;
        break;
      }
    }
    if (best < 0) {
      let mn = 1;
      for (let tau = minLag; tau < maxLag; tau++)
        if (d[tau] < mn) {
          mn = d[tau];
          best = tau;
        }
      if (mn > 0.3) continue;
    }
    // parabolik ara değer
    const a = d[best - 1];
    const b = d[best];
    const c = d[best + 1] ?? b;
    const den = a - 2 * b + c;
    const t = den !== 0 ? best + (0.5 * (a - c)) / den : best;
    const f0 = sr / t;
    if (f0 >= lo && f0 <= hi) f0s.push(f0);
  }
  if (f0s.length < 5) return frames ? { med: NaN, lo: NaN, hi: NaN, voiced: f0s.length / Math.max(1, frames) } : null;
  return { med: pct(f0s, 0.5), lo: pct(f0s, 0.1), hi: pct(f0s, 0.9), voiced: f0s.length / frames };
}

// Test / demo için ses benzeri sinyal: harmonikler + formantlar + vibrato + hece aralıkları
export function synthVoice(fs: number, secs: number, f0: number, opt: { formants?: [number, number, number][]; mudDb?: number; presenceDb?: number; noise?: number } = {}): Float32Array {
  const n = Math.round(fs * secs);
  const x = new Float32Array(n);
  const forms = opt.formants || [
    [500, 1, 80],
    [1500, 0.5, 120],
    [2800, 0.3, 160],
  ];
  // gırtlak kaynağı (harmonik başına −12 dB/okt'a yakın) × formant filtresi
  const gainAt = (f: number, h: number) => {
    let g = 0.25;
    for (const [fc, a, bw] of forms) g += a / (1 + Math.pow((f - fc) / bw, 2));
    g *= Math.pow(h, -1.1);
    const lm = Math.log2(f);
    if (opt.mudDb) g *= Math.pow(10, (opt.mudDb * Math.exp(-Math.pow((lm - Math.log2(300)) / 0.6, 2))) / 20);
    if (opt.presenceDb) g *= Math.pow(10, (opt.presenceDb * Math.exp(-Math.pow((lm - Math.log2(3000)) / 0.7, 2))) / 20);
    return g;
  };
  const H = Math.floor(9000 / f0);
  const amps: number[] = [];
  for (let h = 1; h <= H; h++) amps.push(gainAt(h * f0, h));
  let ph = 0;
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
  for (let i = 0; i < n; i++) {
    const t = i / fs;
    const syl = Math.sin(Math.PI * ((t * 2.2) % 1)) ** 0.6; // hece zarfı (2,2 hece/s)
    const gap = (t * 2.2) % 3 > 2.6 ? 0 : 1; // arada sessizlik
    // ezgi: yarım saniyede bir nota değişir (±4 yarım ses) + vibrato
    const note = [0, 2, 4, 2, -1, 0, 3, 1][Math.floor(t * 2) % 8];
    const f = f0 * Math.pow(2, note / 12) * (1 + 0.012 * Math.sin(2 * Math.PI * 5.5 * t));
    ph += (2 * Math.PI * f) / fs;
    let s = 0;
    for (let h = 0; h < amps.length; h++) s += amps[h] * Math.sin((h + 1) * ph);
    x[i] = 0.08 * s * syl * gap + (opt.noise || 0) * rnd();
  }
  return x;
}
