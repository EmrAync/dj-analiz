// EQ önerisi: ölçülen eğriyi hedef eğriyle karşılaştır; tepe noktaları için parametrik kesme (PEQ),
// 31 bant grafik EQ değerleri ve sahada işe yarayan kısa tavsiyeler üret. Varsayılan: sadece kesme.
import { ISO31, ms, smoothDb } from '../audio/dsp';
import type { CurveId, EqTarget } from '../model/types';

export const CURVES: Record<CurveId, { bass: number; tilt: number }> = {
  flat: { bass: 0, tilt: 0 },
  house: { bass: 4, tilt: -1 },
  dance: { bass: 8, tilt: -1.5 },
  live: { bass: 4, tilt: -0.8 },
  speech: { bass: -6, tilt: -0.5 },
};

export const EQ_DEFAULT: EqTarget = { curve: 'dance', bass: 8, tilt: -1.5, lo: 40, hi: 16000, boost: false };

// Hedef eğri (dB, 1 kHz = 0)
export function targetDb(eq: EqTarget, f: number): number {
  const shelf = 1 / (1 + Math.pow(f / 90, 2));
  return eq.bass * shelf + eq.tilt * Math.max(0, Math.log2(f / 1000));
}

// RBJ tepe (peaking) filtresi genlik yanıtı (dB)
export function peqDb(f: number, f0: number, gain: number, q: number, fs = 48000): number {
  const A = Math.pow(10, gain / 40);
  const w0 = (2 * Math.PI * f0) / fs;
  const alpha = Math.sin(w0) / (2 * q);
  const b0 = 1 + alpha * A;
  const b1 = -2 * Math.cos(w0);
  const b2 = 1 - alpha * A;
  const a0 = 1 + alpha / A;
  const a1 = -2 * Math.cos(w0);
  const a2 = 1 - alpha / A;
  const w = (2 * Math.PI * f) / fs;
  const c1 = Math.cos(w);
  const s1 = Math.sin(w);
  const c2 = Math.cos(2 * w);
  const s2 = Math.sin(2 * w);
  const nr = b0 + b1 * c1 + b2 * c2;
  const ni = -(b1 * s1 + b2 * s2);
  const dr = a0 + a1 * c1 + a2 * c2;
  const di = -(a1 * s1 + a2 * s2);
  return 10 * Math.log10((nr * nr + ni * ni) / (dr * dr + di * di));
}

export interface PeqFilter {
  f: number;
  gain: number;
  q: number;
}

export interface EqAdvice {
  code: 'subHigh' | 'subLow' | 'hfLow' | 'hfHigh' | 'mode' | 'dip' | 'tooFew';
  vars: Record<string, string | number>;
}

export interface EqResult {
  fc: number[];
  meas: number[]; // yumuşatılmış ölçüm (dB)
  target: number[]; // hizalanmış hedef (dB)
  dev: number[]; // sapma (ölçüm − hedef)
  after: number[]; // önerilen EQ sonrası tahmini sapma
  filters: PeqFilter[];
  geq: { f: number; gain: number }[];
  advice: EqAdvice[];
  offset: number;
}

const roundF = (f: number) => {
  const k = Math.round(24 * Math.log2(f / 1000));
  const v = 1000 * Math.pow(2, k / 24);
  return v >= 1000 ? Math.round(v / 10) * 10 : v >= 100 ? Math.round(v) : Math.round(v * 10) / 10;
};
const half = (v: number) => Math.round(v * 2) / 2;

function median(v: number[]): number {
  const a = v.filter((x) => isFinite(x)).sort((x, y) => x - y);
  return a.length ? a[Math.floor(a.length / 2)] : 0;
}

export function suggestEq(fc: number[], levels: number[], eq: EqTarget, maxFilters = 8): EqResult {
  const meas = smoothDb(fc, levels, 6);
  const inR = (f: number) => f >= eq.lo && f <= eq.hi;
  const tRaw = fc.map((f) => targetDb(eq, f));
  const offset = median(fc.map((f, i) => (f >= 250 && f <= 4000 ? meas[i] - tRaw[i] : NaN)));
  const target = tRaw.map((v) => v + offset);
  const dev = fc.map((f, i) => (inR(f) && isFinite(meas[i]) ? meas[i] - target[i] : 0));
  const work = dev.slice();
  const filters: PeqFilter[] = [];
  const advice: EqAdvice[] = [];
  // tepe noktalarını kes
  for (let n = 0; n < maxFilters; n++) {
    let k = -1;
    let pk = 2;
    for (let i = 1; i < fc.length - 1; i++) if (inR(fc[i]) && work[i] > pk && work[i] >= work[i - 1] && work[i] >= work[i + 1]) {
      pk = work[i];
      k = i;
    }
    if (k < 0) break;
    let l = k;
    let r = k;
    while (l > 0 && work[l - 1] > pk / 2 && inR(fc[l - 1])) l--;
    while (r < fc.length - 1 && work[r + 1] > pk / 2 && inR(fc[r + 1])) r++;
    const bw = Math.max(1 / 6, Math.log2(fc[r] / fc[l]) + 1 / 12);
    const q = Math.max(0.5, Math.min(8, Math.sqrt(Math.pow(2, bw)) / (Math.pow(2, bw) - 1)));
    const gain = -Math.min(12, half(pk * 0.85));
    if (gain > -1) break;
    const f0 = roundF(fc[k]);
    const flt = { f: f0, gain, q: Math.round(q * 10) / 10 };
    filters.push(flt);
    for (let i = 0; i < fc.length; i++) work[i] += inR(fc[i]) ? peqDb(fc[i], flt.f, flt.gain, flt.q) : 0;
    if (fc[k] < 200 && q > 4) advice.push({ code: 'mode', vars: { f: Math.round(f0) } });
  }
  // çukurlar: geniş olanlar biraz yükseltilebilir, dar olanlar iptal (EQ ile düzelmez)
  for (let i = 1; i < fc.length - 1; i++) {
    if (!inR(fc[i]) || work[i] > -6 || work[i] > work[i - 1] || work[i] > work[i + 1]) continue;
    let l = i;
    let r = i;
    while (l > 0 && work[l - 1] < work[i] / 2) l--;
    while (r < fc.length - 1 && work[r + 1] < work[i] / 2) r++;
    const bw = Math.log2(fc[r] / fc[l]) + 1 / 12;
    if (bw < 0.5) {
      if (!advice.some((a) => a.code === 'dip')) advice.push({ code: 'dip', vars: { f: Math.round(roundF(fc[i])) } });
    } else if (eq.boost && filters.length < maxFilters) {
      const q = Math.max(0.5, Math.min(2, Math.sqrt(Math.pow(2, bw)) / (Math.pow(2, bw) - 1)));
      const flt = { f: roundF(fc[i]), gain: Math.min(3, half(-work[i] * 0.5)), q: Math.round(q * 10) / 10 };
      filters.push(flt);
      for (let j = 0; j < fc.length; j++) work[j] += inR(fc[j]) ? peqDb(fc[j], flt.f, flt.gain, flt.q) : 0;
    }
  }
  filters.sort((a, b) => a.f - b.f);
  // 31 bant GEQ (komşu bantlar örtüştüğü için 0,7 ile çarp)
  const geq = ISO31.map((f) => {
    if (f < eq.lo || f > eq.hi) return { f, gain: 0 };
    const h = Math.pow(2, 1 / 6);
    let s = 0;
    let n = 0;
    for (let i = 0; i < fc.length; i++)
      if (fc[i] >= f / h && fc[i] <= f * h) {
        s += ms(dev[i]);
        n++;
      }
    const d = n ? 10 * Math.log10(s / n) : 0;
    let g = 0;
    if (d > 1.5) g = -Math.min(12, half((d - 1) * 0.7));
    else if (eq.boost && d < -3) g = Math.min(3, half((-d - 2) * 0.5));
    return { f, gain: g };
  });
  // genel tavsiyeler
  const band = (a: number, b: number) => {
    const v = fc.map((f, i) => (f >= a && f <= b ? dev[i] : NaN)).filter((x) => isFinite(x));
    return v.length ? v.reduce((x, y) => x + y, 0) / v.length : 0;
  };
  const sub = band(Math.max(35, eq.lo), 90);
  if (sub > 4) advice.unshift({ code: 'subHigh', vars: { d: Math.round(sub) } });
  else if (sub < -5) advice.unshift({ code: 'subLow', vars: { d: Math.round(-sub) } });
  const hf = band(8000, Math.min(16000, eq.hi));
  if (hf < -6) advice.push({ code: 'hfLow', vars: { d: Math.round(-hf) } });
  else if (hf > 5) advice.push({ code: 'hfHigh', vars: { d: Math.round(hf) } });
  return { fc, meas, target, dev, after: work, filters, geq, advice, offset };
}

// Geri besleme (feedback) adayları: çevresinden çok yüksek, dar tepe noktaları (bin dB dizisi)
export function feedbackPeaks(binDb: Float32Array | number[], binHz: number, minProm = 15): { f: number; db: number; prom: number }[] {
  const out: { f: number; db: number; prom: number }[] = [];
  const n = binDb.length;
  const k0 = Math.max(3, Math.floor(80 / binHz));
  const k1 = Math.min(n - 4, Math.floor(12000 / binHz));
  for (let k = k0; k <= k1; k++) {
    const v = binDb[k];
    if (!(v > binDb[k - 1] && v >= binDb[k + 1] && v > -90)) continue;
    // çevre: ±1/3 oktav, tepenin ±3 bini hariç
    const lo = Math.max(1, Math.floor(k / 1.26));
    const hi = Math.min(n - 1, Math.ceil(k * 1.26));
    const ring: number[] = [];
    for (let j = lo; j <= hi; j++) if (Math.abs(j - k) > 3) ring.push(binDb[j]);
    if (ring.length < 4) continue;
    ring.sort((a, b) => a - b);
    const med = ring[Math.floor(ring.length / 2)];
    const prom = v - med;
    if (prom < minProm) continue;
    // parabolik ara değer
    const a = binDb[k - 1];
    const c = binDb[k + 1];
    const den = a - 2 * v + c;
    const dk = den !== 0 ? (0.5 * (a - c)) / den : 0;
    out.push({ f: (k + dk) * binHz, db: v, prom });
  }
  out.sort((a, b) => b.prom - a.prom);
  return out.slice(0, 6);
}
