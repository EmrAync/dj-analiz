// Tarama (üstel sinüs taraması, Farina) ile dürtü yanıtı: varış zamanları (delay, sub–tepe),
// sub–tepe geçiş bölgesi hizalaması, yankı süresi (Schroeder, T20/T30).

// —— FFT (radix-2, yerinde) ——
export function fft(re: Float64Array, im: Float64Array, inverse = false): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i];
      re[i] = re[j];
      re[j] = t;
      t = im[i];
      im[i] = im[j];
      im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inverse ? 2 : -2) * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < half; k++) {
        const a = i + k;
        const b = a + half;
        const xr = re[b] * cr - im[b] * ci;
        const xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) {
    re[i] /= n;
    im[i] /= n;
  }
}

const pow2 = (n: number) => 1 << Math.ceil(Math.log2(Math.max(2, n)));

export function convolve(a: ArrayLike<number>, b: ArrayLike<number>): Float64Array {
  const n = pow2(a.length + b.length - 1);
  const ar = new Float64Array(n);
  const ai = new Float64Array(n);
  const br = new Float64Array(n);
  const bi = new Float64Array(n);
  for (let i = 0; i < a.length; i++) ar[i] = a[i];
  for (let i = 0; i < b.length; i++) br[i] = b[i];
  fft(ar, ai);
  fft(br, bi);
  for (let i = 0; i < n; i++) {
    const r = ar[i] * br[i] - ai[i] * bi[i];
    ai[i] = ar[i] * bi[i] + ai[i] * br[i];
    ar[i] = r;
  }
  fft(ar, ai, true);
  return ar.subarray(0, a.length + b.length - 1);
}

// —— Tarama ——
export interface SweepSpec {
  fs: number;
  f1: number;
  f2: number;
  T: number; // saniye
  gap: number; // taramalar arası sessizlik (s)
  repeats: number;
  amp: number; // tepe genlik (0..1)
}

export const SWEEP_DEFAULT: Omit<SweepSpec, 'fs'> = { f1: 30, f2: 18000, T: 1.5, gap: 1.6, repeats: 3, amp: 0.5 };

export function makeSweep(s: SweepSpec): Float32Array {
  const n = Math.round(s.T * s.fs);
  const L = Math.log(s.f2 / s.f1);
  const k = (2 * Math.PI * s.f1 * s.T) / L;
  const out = new Float32Array(n);
  const fade = Math.round(0.02 * s.fs);
  for (let i = 0; i < n; i++) {
    const t = i / s.fs;
    let v = Math.sin(k * (Math.exp((t / s.T) * L) - 1));
    if (i < fade) v *= 0.5 - 0.5 * Math.cos((Math.PI * i) / fade);
    if (i > n - fade) v *= 0.5 - 0.5 * Math.cos((Math.PI * (n - i)) / fade);
    out[i] = v * s.amp;
  }
  return out;
}

// Ters filtre: zamanda ters çevrilmiş tarama × 6 dB/oktav düşen zarf; 1 kHz'de birim kazanca ölçeklenir
const invCache = new Map<string, Float32Array>();

export function inverseFilter(s: SweepSpec): Float32Array {
  const key = [s.fs, s.f1, s.f2, s.T, s.amp].join('|');
  const hit = invCache.get(key);
  if (hit) return hit;
  const v = inverseFilterRaw(s);
  invCache.set(key, v);
  return v;
}

function inverseFilterRaw(s: SweepSpec): Float32Array {
  const x = makeSweep({ ...s, amp: 1 });
  const n = x.length;
  const L = Math.log(s.f2 / s.f1);
  const inv = new Float64Array(n);
  for (let i = 0; i < n; i++) inv[i] = x[n - 1 - i] * Math.exp((-i / n) * L);
  // 1 kHz'de |X·INV| = 1 olacak şekilde ölçek
  const N = pow2(2 * n);
  const ar = new Float64Array(N);
  const ai = new Float64Array(N);
  const br = new Float64Array(N);
  const bi = new Float64Array(N);
  for (let i = 0; i < n; i++) {
    ar[i] = x[i];
    br[i] = inv[i];
  }
  fft(ar, ai);
  fft(br, bi);
  const k = Math.round((1000 / s.fs) * N);
  const g = Math.hypot(ar[k] * br[k] - ai[k] * bi[k], ar[k] * bi[k] + ai[k] * br[k]);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = inv[i] / (g * s.amp);
  return out;
}

// Tekrarlı tarama dizisi (çalma / WAV)
export function sweepSequence(s: SweepSpec, lead = 0.5, tail = 1.0): { data: Float32Array; starts: number[] } {
  const sw = makeSweep(s);
  const per = Math.round((s.T + s.gap) * s.fs);
  const len = Math.round(lead * s.fs) + per * s.repeats + Math.round(tail * s.fs);
  const data = new Float32Array(len);
  const starts: number[] = [];
  for (let r = 0; r < s.repeats; r++) {
    const o = Math.round(lead * s.fs) + r * per;
    starts.push(o);
    data.set(sw, o);
  }
  return { data, starts };
}

// —— Kayıttan dürtü yanıtları ——
export interface IRSet {
  ir: Float64Array; // ortalama dürtü yanıtı
  pre: number; // ana tepe öncesi örnek sayısı (ir içinde ana tepenin indeksi)
  peaks: number[]; // kayıt içindeki ana tepe konumları (örnek)
  starts: number[]; // kayıt içinde tahmini tarama başlangıçları (örnek)
  snr: number; // dB
  found: number;
}

// starts verilirse (kendi çaldığımız) pencereler onlara göre; verilmezse eşleşen filtreyle bulunur
export function extractIRs(rec: Float32Array, s: SweepSpec, starts?: number[], preMs = 30, postMs = 1300): IRSet | null {
  const inv = inverseFilter(s);
  const Li = inv.length;
  const pre = Math.round((preMs / 1000) * s.fs);
  const post = Math.round((postMs / 1000) * s.fs);
  let cands = starts;
  if (!cands) {
    // kaba tarama: 8 kat seyrelt, ilişkilendir
    const D = 8;
    const rd = new Float64Array(Math.floor(rec.length / D));
    for (let i = 0; i < rd.length; i++) {
      let v = 0;
      for (let j = 0; j < D; j++) v += rec[i * D + j];
      rd[i] = v / D;
    }
    // eşleşen filtre: aynı şekilde seyreltilmiş taramanın ters çevrilmişi
    const sw = makeSweep({ ...s, amp: 1 });
    const invD = new Float64Array(Math.floor(sw.length / D));
    for (let i = 0; i < invD.length; i++) {
      let v = 0;
      for (let j = 0; j < D; j++) v += sw[i * D + j];
      invD[invD.length - 1 - i] = v / D;
    }
    const y = convolve(rd, invD);
    const env = Float64Array.from(y, Math.abs);
    const found: number[] = [];
    const minSep = Math.round(((s.T + s.gap * 0.5) * s.fs) / D);
    const order = Array.from(env.keys()).sort((a, b) => env[b] - env[a]);
    const top = env[order[0]] || 0;
    for (const i of order) {
      if (env[i] < top * 0.3 || found.length >= s.repeats + 2) break;
      if (found.every((f) => Math.abs(f - i) > minSep)) found.push(i);
    }
    cands = found.map((i) => (i - (invD.length - 1)) * D).filter((v) => v > -s.fs * 0.2);
  }
  const irs: Float64Array[] = [];
  const peaks: number[] = [];
  const st: number[] = [];
  let noise = 0;
  let sig = 0;
  for (const c of cands) {
    const w0 = Math.max(0, Math.round(c - 0.2 * s.fs));
    const w1 = Math.min(rec.length, Math.round(c + (s.T + postMs / 1000 + 0.1) * s.fs));
    if (w1 - w0 < s.T * s.fs) continue;
    const y = convolve(rec.subarray(w0, w1), inv);
    // ana tepe: beklenen konum çevresinde (±0,25 s) en büyük |y|
    const exp0 = c - w0 + Li - 1;
    const lo = Math.max(0, Math.round(exp0 - 0.25 * s.fs));
    const hi = Math.min(y.length - 1, Math.round(exp0 + 0.25 * s.fs));
    let pk = lo;
    for (let i = lo; i <= hi; i++) if (Math.abs(y[i]) > Math.abs(y[pk])) pk = i;
    if (pk - pre < 0 || pk + post >= y.length) continue;
    irs.push(y.slice(pk - pre, pk + post));
    peaks.push(w0 + pk - (Li - 1));
    st.push(c);
    sig += y[pk] * y[pk];
    // gürültü: tepe öncesi bölge (harmonik bozulma hariç uzak kısım)
    let nn = 0;
    let ns = 0;
    for (let i = Math.max(0, pk - Math.round(0.6 * s.fs)); i < pk - Math.round(0.35 * s.fs); i++) {
      ns += y[i] * y[i];
      nn++;
    }
    if (nn) noise += ns / nn;
  }
  if (!irs.length || sig / irs.length < 1e-14) return null;
  // kendi çaldığımızda mutlak zaman korunur: hizalama başlangıçlara göre; aksi halde ana tepeye göre (zaten öyle)
  const ir = new Float64Array(irs[0].length);
  if (starts) {
    // her pencerenin tepe kayması, başlangıca göre: aynı gecikme beklenir; ortalamayı ilk tepeye hizala
    const base = peaks[0] - st[0];
    irs.forEach((x, r) => {
      const sh = peaks[r] - st[r] - base;
      for (let i = 0; i < ir.length; i++) {
        const j = i + sh;
        if (j >= 0 && j < x.length) ir[i] += x[j] / irs.length;
      }
    });
  } else irs.forEach((x) => x.forEach((v, i) => (ir[i] += v / irs.length)));
  const snr = noise > 0 ? 10 * Math.log10(sig / irs.length / (noise / irs.length)) : 99;
  return { ir, pre, peaks, starts: st, snr, found: irs.length };
}

// —— Analiz ——
function bandMask(x: Float64Array, fs: number, lo: number, hi: number): Float64Array {
  const n = pow2(x.length);
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  re.set(x);
  fft(re, im);
  for (let k = 0; k <= n / 2; k++) {
    const f = (k * fs) / n;
    let g = 1;
    if (lo > 0) g *= f <= lo / 1.41 ? 0 : f >= lo ? 1 : 0.5 - 0.5 * Math.cos((Math.PI * Math.log2(f / (lo / 1.41))) / 0.5);
    if (hi > 0) g *= f >= hi * 1.41 ? 0 : f <= hi ? 1 : 0.5 + 0.5 * Math.cos((Math.PI * Math.log2(f / hi)) / 0.5);
    re[k] *= g;
    im[k] *= g;
    if (k > 0 && k < n / 2) {
      re[n - k] *= g;
      im[n - k] *= g;
    }
  }
  fft(re, im, true);
  return re.slice(0, x.length);
}

// Analitik sinyal zarfı (Hilbert) + yumuşatma
export function envelope(x: Float64Array, smooth = 1): Float64Array {
  const n = pow2(x.length);
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  re.set(x);
  fft(re, im);
  for (let k = 1; k < n / 2; k++) {
    re[k] *= 2;
    im[k] *= 2;
  }
  for (let k = n / 2 + 1; k < n; k++) {
    re[k] = 0;
    im[k] = 0;
  }
  fft(re, im, true);
  const e = new Float64Array(x.length);
  for (let i = 0; i < x.length; i++) e[i] = Math.hypot(re[i], im[i]);
  if (smooth <= 1) return e;
  const out = new Float64Array(x.length);
  let s = 0;
  const h = Math.floor(smooth / 2);
  for (let i = 0; i < x.length + h; i++) {
    if (i < x.length) s += e[i];
    if (i - smooth >= 0) s -= e[i - smooth];
    if (i - h >= 0 && i - h < x.length) out[i - h] = s / Math.min(smooth, i + 1);
  }
  return out;
}

export interface Arrival {
  ms: number; // ilk varışa göre
  db: number; // en güçlüye göre
}

export interface RtBand {
  f: number; // 0 = geniş bant
  t20: number | null;
  t30: number | null;
}

export interface IRAnalysis {
  arrivals: Arrival[];
  firstMs: number; // ilk varışın ir penceresindeki zamanı (ms, pencere başına göre)
  lfMs: number; // ≤150 Hz bant zarf tepesi (ilk varışa göre)
  hfMs: number; // ≥1 kHz bant zarf tepesi (ilk varışa göre)
  rt: RtBand[];
  envDb: Float32Array; // çizim için (0,5 ms adım), en güçlüye göre dB
  stepMs: number;
}

export function analyzeIR(ir: Float64Array, fs: number, pre: number): IRAnalysis {
  const env = envelope(ir, Math.max(1, Math.round(fs * 0.0003)));
  let mx = 0;
  for (let i = 0; i < env.length; i++) mx = Math.max(mx, env[i]);
  const thr = mx * Math.pow(10, -15 / 20);
  // tepe noktaları (yerel maks., ≥2 ms aralık), ana tepenin 5 ms öncesinden başlayarak
  const minSep = Math.round(fs * 0.002);
  const peaks: number[] = [];
  const from = Math.max(1, pre - Math.round(fs * 0.005));
  const to = Math.min(env.length - 1, pre + Math.round(fs * 0.25));
  for (let i = from; i < to; i++) {
    if (env[i] < thr || env[i] < env[i - 1] || env[i] < env[i + 1]) continue;
    const near = peaks.findIndex((p) => Math.abs(p - i) < minSep);
    if (near >= 0) {
      if (env[i] > env[peaks[near]]) peaks[near] = i;
    } else peaks.push(i);
  }
  peaks.sort((a, b) => a - b);
  // ilk anlamlı varış: en güçlünün −12 dB içindeki ilk tepe
  const strong = peaks.filter((p) => env[p] >= mx * Math.pow(10, -12 / 20));
  const first = strong.length ? strong[0] : pre;
  const arrivals = strong
    .slice(0, 4)
    .map((p) => ({ ms: ((p - first) / fs) * 1000, db: 20 * Math.log10(env[p] / mx) }));
  const bandPeak = (lo: number, hi: number, smoothMs: number) => {
    const e = envelope(bandMask(ir, fs, lo, hi), Math.max(1, Math.round((fs * smoothMs) / 1000)));
    let k = 0;
    const lim = Math.min(e.length, pre + Math.round(fs * 0.12));
    for (let i = Math.max(0, pre - Math.round(fs * 0.02)); i < lim; i++) if (e[i] > e[k]) k = i;
    return ((k - first) / fs) * 1000;
  };
  const rt: RtBand[] = [0, 125, 250, 500, 1000, 2000, 4000].map((f) => {
    const x = f ? bandMask(ir.subarray(first), fs, f / 1.41, f * 1.41) : ir.subarray(first);
    return { f, ...schroeder(x, fs) };
  });
  const step = Math.max(1, Math.round(fs * 0.0005));
  const n0 = Math.max(0, first - Math.round(fs * 0.01));
  const n1 = Math.min(env.length, first + Math.round(fs * 0.2));
  const envDb = new Float32Array(Math.ceil((n1 - n0) / step));
  for (let i = 0; i < envDb.length; i++) {
    let m = 0;
    for (let j = n0 + i * step; j < Math.min(n1, n0 + (i + 1) * step); j++) m = Math.max(m, env[j]);
    envDb[i] = 20 * Math.log10(Math.max(1e-9, m / mx));
  }
  return { arrivals, firstMs: (first / fs) * 1000, lfMs: bandPeak(0, 150, 4), hfMs: bandPeak(1000, 0, 0.3), rt, envDb, stepMs: (step / fs) * 1000 };
}

// Schroeder geri entegrasyonu; gürültü tabanı kuyruktan kestirilip çıkarılır
export function schroeder(x: ArrayLike<number>, fs: number): { t20: number | null; t30: number | null } {
  const n = x.length;
  if (n < fs * 0.2) return { t20: null, t30: null };
  const e2 = new Float64Array(n);
  for (let i = 0; i < n; i++) e2[i] = x[i] * x[i];
  const tailN = Math.round(n * 0.15);
  let noise = 0;
  for (let i = n - tailN; i < n; i++) noise += e2[i];
  noise /= tailN;
  // kesme noktası: 20 ms ortalama enerji gürültünün 2 katına indiği yer
  const w = Math.round(fs * 0.02);
  let cut = n - tailN;
  let s = 0;
  for (let i = 0; i < n - tailN; i++) {
    s += e2[i];
    if (i >= w) s -= e2[i - w];
    if (i > fs * 0.05 && s / w < noise * 2) {
      cut = i;
      break;
    }
  }
  const edc = new Float64Array(cut);
  let acc = 0;
  for (let i = cut - 1; i >= 0; i--) {
    acc += Math.max(0, e2[i] - noise);
    edc[i] = acc;
  }
  if (edc[0] <= 0) return { t20: null, t30: null };
  const db = (i: number) => 10 * Math.log10(Math.max(1e-30, edc[i] / edc[0]));
  const fit = (a: number, b: number): number | null => {
    let i0 = -1;
    let i1 = -1;
    for (let i = 0; i < cut; i++) {
      const d = db(i);
      if (i0 < 0 && d <= a) i0 = i;
      if (d <= b) {
        i1 = i;
        break;
      }
    }
    if (i0 < 0 || i1 < 0 || i1 - i0 < fs * 0.02) return null;
    // en küçük kareler
    let sx = 0;
    let sy = 0;
    let sxx = 0;
    let sxy = 0;
    let m = 0;
    const stp = Math.max(1, Math.floor((i1 - i0) / 400));
    for (let i = i0; i <= i1; i += stp) {
      const t = i / fs;
      const d = db(i);
      sx += t;
      sy += d;
      sxx += t * t;
      sxy += t * d;
      m++;
    }
    const slope = (m * sxy - sx * sy) / (m * sxx - sx * sx);
    return slope < 0 ? -60 / slope : null;
  };
  return { t20: fit(-5, -25), t30: fit(-5, -35) };
}

// —— Sub–tepe hizalama: geçiş bölgesinde en güçlü toplam için gecikme ve polarite ——
export interface AlignResult {
  delayMs: number; // + : tepeyi geciktir, − : sub'ı geciktir
  invert: boolean; // sub polaritesini ters çevir
  gainDb: number; // şimdiki duruma göre geçiş bölgesindeki kazanç
  coherence: number; // 0..1 (1 = kusursuz toplam)
}

function dftAt(x: ArrayLike<number>, fs: number, f: number, start: number, len: number): [number, number] {
  let r = 0;
  let i = 0;
  const w = (2 * Math.PI * f) / fs;
  for (let n = start; n < Math.min(x.length, start + len); n++) {
    r += x[n] * Math.cos(w * (n - start));
    i -= x[n] * Math.sin(w * (n - start));
  }
  return [r, i];
}

// irSub, irTop aynı zaman tabanında (aynı oturumda, kendi çaldığımız taramayla) ölçülmüş olmalı
export function alignSubTop(irSub: ArrayLike<number>, irTop: ArrayLike<number>, fs: number, fc = 100, maxMs = 20): AlignResult {
  const fr: number[] = [];
  for (let k = 0; k < 24; k++) fr.push(fc * Math.pow(2, -1 + (2 * k) / 23));
  const len = Math.min(irSub.length, irTop.length, Math.round(fs * 0.3));
  const S = fr.map((f) => dftAt(irSub, fs, f, 0, len));
  const T = fr.map((f) => dftAt(irTop, fs, f, 0, len));
  const sum = (d: number, p: number) => {
    let e = 0;
    for (let k = 0; k < fr.length; k++) {
      const ph = 2 * Math.PI * fr[k] * (Math.abs(d) / 1000);
      const c = Math.cos(ph);
      const s = -Math.sin(ph);
      let sr = S[k][0] * p;
      let si = S[k][1] * p;
      let tr = T[k][0];
      let ti = T[k][1];
      if (d > 0) [tr, ti] = [tr * c - ti * s, tr * s + ti * c];
      else if (d < 0) [sr, si] = [sr * c - si * s, sr * s + si * c];
      e += (sr + tr) ** 2 + (si + ti) ** 2;
    }
    return e;
  };
  const e0 = sum(0, 1);
  let best = { d: 0, p: 1, e: e0 };
  for (let d = -maxMs; d <= maxMs + 1e-9; d += 0.05)
    for (const p of [1, -1]) {
      const e = sum(d, p);
      if (e > best.e * 1.0001) best = { d, p, e };
    }
  let ideal = 0;
  for (let k = 0; k < fr.length; k++) ideal += (Math.hypot(S[k][0], S[k][1]) + Math.hypot(T[k][0], T[k][1])) ** 2;
  return { delayMs: Math.round(best.d * 100) / 100, invert: best.p < 0, gainDb: 10 * Math.log10(best.e / Math.max(1e-30, e0)), coherence: ideal > 0 ? best.e / ideal : 0 };
}

// —— WAV (16 bit PCM) ——
export function wavBlob(ch: Float32Array[], fs: number): Blob {
  const n = ch[0].length;
  const nc = ch.length;
  const buf = new ArrayBuffer(44 + n * nc * 2);
  const v = new DataView(buf);
  const w = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF');
  v.setUint32(4, 36 + n * nc * 2, true);
  w(8, 'WAVE');
  w(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, nc, true);
  v.setUint32(24, fs, true);
  v.setUint32(28, fs * nc * 2, true);
  v.setUint16(32, nc * 2, true);
  v.setUint16(34, 16, true);
  w(36, 'data');
  v.setUint32(40, n * nc * 2, true);
  let o = 44;
  for (let i = 0; i < n; i++)
    for (let c = 0; c < nc; c++) {
      const s = Math.max(-1, Math.min(1, ch[c][i]));
      v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      o += 2;
    }
  return new Blob([buf], { type: 'audio/wav' });
}

// Pembe gürültü (Paul Kellet), RMS ≈ −15 dBFS
export function pinkNoise(n: number, seed = 1): Float32Array {
  let x = seed >>> 0 || 1;
  const rnd = () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return ((x >>> 0) / 4294967296) * 2 - 1;
  };
  const out = new Float32Array(n);
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  let b3 = 0;
  let b4 = 0;
  let b5 = 0;
  let b6 = 0;
  for (let i = 0; i < n; i++) {
    const w = rnd();
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.016898;
    out[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.06;
    b6 = w * 0.115926;
  }
  return out;
}
