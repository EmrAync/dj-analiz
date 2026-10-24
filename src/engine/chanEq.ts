// Kanal EQ asistanı: başlangıç ayarı, dinlemeye göre öneri (en fazla 4 bant + HPF), mix içinde frekans paylaşımı,
// mono ve kanal kapasitesi. Önce kısma, az yükseltme; yükseltme sınırlı ve geniş.
import type { ChanEq, EqMove, EqTarget, L10n, Measurement, MixChannel, MixSetup } from '../model/types';
import { peqDb, targetDb } from './eq';
import { MIXER_BY_ID } from './mixers';
import { REGIONS, srcDef, targetAt, type MicType, type RegionKey, type SourceDef } from './sources';

const n3 = (tr: string, de: string, en: string): L10n => ({ tr, de, en });
const FS = 48000;

export type Use = 'sing' | 'speech' | 'both';

export function useOf(ch: MixChannel): Use {
  const s = srcDef(ch.src);
  if (s.id === 'speech') return 'speech';
  return s.group === 'vocal' ? ch.use || 'sing' : 'sing';
}

// —— Filtre yanıtları ——
function shelfDb(f: number, f0: number, gain: number, high: boolean): number {
  const A = Math.pow(10, gain / 40);
  const w0 = (2 * Math.PI * f0) / FS;
  const cs = Math.cos(w0);
  const alpha = (Math.sin(w0) / 2) * Math.SQRT2; // S = 1
  const sq = 2 * Math.sqrt(A) * alpha;
  let b0, b1, b2, a0, a1, a2;
  if (high) {
    b0 = A * (A + 1 + (A - 1) * cs + sq);
    b1 = -2 * A * (A - 1 + (A + 1) * cs);
    b2 = A * (A + 1 + (A - 1) * cs - sq);
    a0 = A + 1 - (A - 1) * cs + sq;
    a1 = 2 * (A - 1 - (A + 1) * cs);
    a2 = A + 1 - (A - 1) * cs - sq;
  } else {
    b0 = A * (A + 1 - (A - 1) * cs + sq);
    b1 = 2 * A * (A - 1 - (A + 1) * cs);
    b2 = A * (A + 1 - (A - 1) * cs - sq);
    a0 = A + 1 + (A - 1) * cs + sq;
    a1 = -2 * (A - 1 + (A + 1) * cs);
    a2 = A + 1 + (A - 1) * cs - sq;
  }
  const w = (2 * Math.PI * f) / FS;
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

export function moveDb(m: Pick<EqMove, 'f' | 'gain' | 'q' | 'type'>, f: number): number {
  if (m.type === 'lshelf') return shelfDb(f, m.f, m.gain, false);
  if (m.type === 'hshelf') return shelfDb(f, m.f, m.gain, true);
  return peqDb(f, m.f, m.gain, m.q, FS);
}

// 12 dB/oktav Butterworth (çoğu mikserde varsayılan)
export function hpfDb(f: number, fc: number): number {
  return fc > 0 ? -10 * Math.log10(1 + Math.pow(fc / f, 4)) : 0;
}

export function lpfDb(f: number, fc: number | undefined): number {
  return fc ? -10 * Math.log10(1 + Math.pow(f / fc, 4)) : 0;
}

export function eqResponse(eq: ChanEq | undefined, f: number, withFilters = true): number {
  if (!eq) return 0;
  let v = withFilters ? hpfDb(f, eq.hpf) + lpfDb(f, eq.lpf) : 0;
  for (const m of eq.moves) v += moveDb(m, f);
  return v;
}

// —— Yardımcılar ——
const lg = (f: number) => Math.log2(f);

function smoothOct(fc: number[], v: number[], ok: boolean[], oct: number): number[] {
  return fc.map((f, i) => {
    let s = 0;
    let n = 0;
    for (let j = 0; j < fc.length; j++)
      if (ok[j] && Math.abs(lg(fc[j]) - lg(f)) <= oct / 2) {
        s += v[j];
        n++;
      }
    return n ? s / n : ok[i] ? v[i] : NaN;
  });
}

function meanIn(fc: number[], v: number[], ok: boolean[], lo: number, hi: number): number {
  let s = 0;
  let n = 0;
  for (let i = 0; i < fc.length; i++)
    if (ok[i] && fc[i] >= lo && fc[i] <= hi && isFinite(v[i])) {
      s += v[i];
      n++;
    }
  return n ? s / n : NaN;
}

export function niceF(f: number): number {
  if (f < 100) return Math.round(f);
  if (f < 1000) return Math.round(f / 5) * 5;
  if (f < 10000) return Math.round(f / 50) * 50;
  return Math.round(f / 100) * 100;
}

const r1 = (v: number) => Math.round(v * 10) / 10;
const rHalf = (v: number) => Math.round(v * 2) / 2;

function regionAt(s: SourceDef, f: number): RegionKey {
  let best: RegionKey | null = null;
  let d = Infinity;
  for (const r of s.regions) {
    if (f >= r.lo && f <= r.hi) return r.key;
    const dist = Math.min(Math.abs(lg(f) - lg(r.lo)), Math.abs(lg(f) - lg(r.hi)));
    if (dist < d) {
      d = dist;
      best = r.key;
    }
  }
  if (best && d < 0.7) return best;
  if (f < 120) return 'boom';
  if (f < 500) return 'mud';
  if (f < 1000) return 'boxy';
  if (f < 2000) return 'nasal';
  if (f < 5000) return 'presence';
  if (f < 9000) return 'sibilance';
  return 'air';
}

// Bantlara dağıt: 1 alçak, 2–3 orta, 4 tiz; sıra korunur
function assignBands(moves: EqMove[]): EqMove[] {
  const ms = [...moves].sort((a, b) => a.f - b.f);
  const n = ms.length;
  const zone = (f: number) => (f < 250 ? 1 : f < 1200 ? 2 : f < 5000 ? 3 : 4);
  let prev = 0;
  return ms.map((m, i) => {
    let b = Math.max(zone(m.f), prev + 1, i + 1);
    b = Math.min(b, 4 - (n - 1 - i));
    prev = b;
    return { ...m, band: b, type: m.type === 'lshelf' && b !== 1 ? 'bell' : m.type === 'hshelf' && b !== 4 ? 'bell' : m.type };
  });
}

// Yükseltmede anlamı olmayan bölge adı (tıslama, sertlik…) yerine yakın anlamlı bölge
function boostWhy(m: EqMove): EqMove {
  const r = REGIONS[m.why as RegionKey];
  if (m.gain <= 0 || (r && typeof r.boost !== 'string' && r.boost.tr)) return m;
  return { ...m, why: m.f < 250 ? 'warmth' : m.f < 1500 ? 'body' : m.f < 8000 ? 'presence' : 'air' };
}

function finalize(eq: ChanEq): ChanEq {
  const moves = eq.moves
    .map(boostWhy)
    .filter((m) => Math.abs(m.gain) >= 0.75)
    .map((m) => ({ ...m, f: niceF(m.f), gain: rHalf(m.gain), q: r1(Math.max(0.5, Math.min(8, m.q))) }));
  return { hpf: niceF(eq.hpf), lpf: eq.lpf ? niceF(eq.lpf) : undefined, moves: assignBands(moves) };
}

// Aynı yöne giden yakın hamleleri birleştir, en fazla 4 bant (önce kısmalar)
function limitMoves(ms: EqMove[], max = 4): EqMove[] {
  const out: EqMove[] = [];
  for (const m of [...ms].sort((a, b) => Math.abs(b.gain) * (b.gain < 0 ? 1.2 : 1) - Math.abs(a.gain) * (a.gain < 0 ? 1.2 : 1))) {
    const near = out.find((o) => Math.abs(lg(o.f) - lg(m.f)) < 0.45 && Math.sign(o.gain) === Math.sign(m.gain));
    if (near) {
      near.gain = Math.sign(near.gain) * Math.max(Math.abs(near.gain), Math.abs(m.gain));
      continue;
    }
    if (out.length < max) out.push({ ...m });
  }
  return out;
}

function hpfFor(s: SourceDef, use: Use): number {
  if (s.group !== 'vocal') return s.hpf;
  const sp = s.hpfSpeech ?? s.hpf * 1.2;
  return use === 'speech' ? sp : use === 'both' ? (s.hpf + sp) / 2 : s.hpf;
}

// —— 1) Dinlemeden önce: başlangıç ayarı ——
export function startEq(ch: MixChannel, setup?: MixSetup): ChanEq {
  const s = srcDef(ch.src);
  const use = useOf(ch);
  const mic = (ch.mic || s.mic) as MicType;
  let hpf = hpfFor(s, use);
  let moves: EqMove[] = s.start.map((m) => ({ f: m.f, gain: m.gain, q: m.q, type: m.type || 'bell', why: m.why }));
  const find = (why: RegionKey) => moves.find((m) => m.why === why);
  if (s.group === 'vocal' && use !== 'sing') {
    moves = moves.filter((m) => m.why !== 'air');
    const pr = find('presence');
    if (pr) pr.gain = Math.min(4, pr.gain + (use === 'speech' ? 1 : 0.5));
    const mud = find('mud');
    if (mud) mud.gain -= 0.5;
  }
  const v = ch.voice || 'normal';
  if (v === 'muffled') {
    const mud = find('mud');
    if (mud) mud.gain = Math.max(-5, mud.gain - 1.5);
    else moves.push({ f: s.core[0] * 1.8, gain: -3, q: 1.2, type: 'bell', why: 'mud' });
    const pr = find('presence');
    if (pr) pr.gain = Math.min(5, pr.gain + 1.5);
    else moves.push({ f: 3000, gain: 3, q: 1, type: 'bell', why: 'presence' });
    hpf *= 1.15;
  } else if (v === 'harsh') {
    moves = moves.filter((m) => m.why !== 'presence' && m.why !== 'air');
    moves.push({ f: 3000, gain: -2.5, q: 1.6, type: 'bell', why: 'harsh' });
  } else if (v === 'thin') {
    hpf *= 0.8;
    moves = moves.filter((m) => m.why !== 'mud' || m.gain > -2);
    moves.push({ f: Math.max(140, s.f0[0] * 1.8), gain: 2, q: 1, type: 'bell', why: 'warmth' });
  }
  if (mic === 'lav') {
    moves.push({ f: 700, gain: -3, q: 1.5, type: 'bell', why: 'boxy' });
    const pr = find('presence');
    if (pr) pr.gain = Math.min(5, pr.gain + 1.5);
    else moves.push({ f: 4000, gain: 2.5, q: 1, type: 'bell', why: 'presence' });
  } else if (mic === 'headset') {
    hpf += 20;
  } else if (mic === 'clip' && s.group !== 'vocal') {
    moves.push({ f: Math.max(180, s.f0[0] * 1.5), gain: -1.5, q: 1.2, type: 'bell', why: 'boom' });
  }
  // Pa5X: bas ayrı çıkıyorsa L/R'ye yüksek HPF (bas iki kere çıkmasın)
  if (s.id === 'pa-lr' && setup?.channels.some((c) => c.src === 'pa-bass')) hpf = 100;
  return finalize({ hpf, lpf: s.lpf, moves: limitMoves(moves) });
}

// —— 2) Dinlemeye göre öneri ——
export interface ChanNote {
  level: 'ok' | 'info' | 'warn';
  text: L10n;
}

export interface ChanSuggestion {
  eq: ChanEq;
  notes: ChanNote[];
  fc: number[];
  ok: boolean[];
  before: number[]; // ölçülen sapma (hedefe göre, dB)
  after: number[]; // öneri uygulanınca
  clarity?: { before: number; after: number; mud: number }; // vokal: anlaşılırlık (%)
  detected?: 'male' | 'female';
}

// Sistem ölçümünün (pembe gürültü) hedeften sapması: salon mikrofonuyla dinlerken kanal EQ'sundan çıkarılır
export function systemDev(sys: Measurement | null | undefined, eq: EqTarget, fc: number[]): number[] | null {
  if (!sys || !sys.freqs.length) return null;
  const at = (f: number) => {
    const a = sys.freqs;
    if (f <= a[0]) return sys.bands[0];
    if (f >= a[a.length - 1]) return sys.bands[a.length - 1];
    for (let i = 1; i < a.length; i++)
      if (f <= a[i]) {
        const t = (lg(f) - lg(a[i - 1])) / (lg(a[i]) - lg(a[i - 1]));
        return sys.bands[i - 1] + t * (sys.bands[i] - sys.bands[i - 1]);
      }
    return NaN;
  };
  const raw = fc.map((f) => at(f) - targetDb(eq, f));
  const ok = raw.map((v) => isFinite(v));
  const ref = meanIn(fc, raw, ok, 200, 4000);
  const sm = smoothOct(fc, raw.map((v) => v - ref), ok, 1 / 3);
  return sm.map((v) => (isFinite(v) ? Math.max(-6, Math.min(6, v)) : 0));
}

function clarityOf(fc: number[], d: number[], ok: boolean[], s: SourceDef): { pct: number; mud: number } {
  const lowHi = s.id === 'voc-f' ? 700 : 600;
  const mud = meanIn(fc, d, ok, s.core[0] * 0.9, lowHi) - meanIn(fc, d, ok, 1000, 5000);
  const harsh = meanIn(fc, d, ok, 2000, 5000) - meanIn(fc, d, ok, 300, 1000) - 3;
  const m = isFinite(mud) ? Math.max(0, mud) : 0;
  const h = isFinite(harsh) ? Math.max(0, harsh) : 0;
  return { pct: Math.round(Math.max(5, Math.min(100, 100 - 9 * m - 5 * h))), mud: r1(isFinite(mud) ? mud : 0) };
}

// Harmonik tarağını yok eden uyarlamalı yumuşatma (güç ortalaması): pencere en az 1/3 oktav ve ~1,5 harmonik aralığı
export function smoothLtas(fc: number[], db: number[], f0?: number): number[] {
  return fc.map((f) => {
    // temel sesin altında genişletme yok (perdenin enerjisi aşağı taşınmasın)
    const w = f0 && isFinite(f0) && f >= f0 * 0.8 ? Math.max(1 / 3, Math.log2(1 + (1.5 * f0) / f)) : f0 && isFinite(f0) ? 1 / 6 : 1 / 3;
    let s = 0;
    let n = 0;
    for (let j = 0; j < fc.length; j++)
      if (isFinite(db[j]) && Math.abs(lg(fc[j]) - lg(f)) <= w / 2) {
        s += Math.pow(10, db[j] / 10);
        n++;
      }
    return n ? 10 * Math.log10(s / n) : NaN;
  });
}

export function suggestFromMeas(ch: MixChannel, setup: MixSetup, sys?: Measurement | null, sysEq?: EqTarget): ChanSuggestion | null {
  const a = ch.meas;
  if (!a) return null;
  const s = srcDef(ch.src);
  const use = useOf(ch);
  const fc = a.fc;
  const base = startEq(ch, setup);
  const notes: ChanNote[] = [];
  const lo = Math.max(45, s.f0[0] * 0.5);
  const f0m = a.f0 && isFinite(a.f0.med) ? a.f0.med : undefined;
  const db = smoothLtas(fc, a.db, s.group === 'drums' || s.group === 'perc' ? undefined : f0m ?? (s.group === 'vocal' ? s.f0[0] * 1.3 : undefined));
  const nz = a.noise ? smoothLtas(fc, a.noise) : undefined;
  const ok = fc.map((f, i) => isFinite(db[i]) && f >= lo && f <= 16000 && (!nz || db[i] - nz[i] >= 6));
  if (a.noise && ok.filter(Boolean).length < fc.length * 0.4) notes.push({ level: 'warn', text: n3('Ortam gürültüsü yüksek: diğer sesler sussun ve tekrar dinle.', 'Zu viel Störgeräusch: andere leise, nochmal.', 'Too much background noise: silence others and listen again.') });
  if (a.active < 0.15) notes.push({ level: 'warn', text: n3('Çok az ses yakalandı: kişi daha uzun söylesin / çalsın.', 'Zu wenig Signal: länger singen / spielen.', 'Too little signal: sing / play longer.') });
  // hedefe göre sapma
  const dev0 = fc.map((f, i) => db[i] - targetAt(s, f, use));
  const ref = meanIn(fc, dev0, ok, s.core[0], s.core[1]);
  let dev = dev0.map((v) => v - ref);
  if (a.mode === 'room') {
    const sd = systemDev(sys, sysEq || { curve: 'flat', bass: 0, tilt: 0, lo: 40, hi: 16000, boost: false }, fc);
    if (sd) dev = dev.map((v, i) => v - sd[i]);
    else notes.push({ level: 'info', text: n3('Salon mikrofonuyla dinledin ama sistem ölçümü yok: öneri salonun ve hoparlörün rengini de içerebilir. Önce EQ sekmesinde pembe gürültüyle sistemi ölç.', 'Raummikro ohne Systemmessung: Vorschlag enthält Raum/PA. Erst System mit Rosa Rauschen messen.', 'Room mic without a system measurement: the advice may include room / PA colour. Measure the system with pink noise first.') });
  }
  const before = dev.slice();
  // kaynağın EQ'suz hali (ölçüm sırasında mikserdeki EQ çıkarılır)
  const raw = dev.map((v, i) => v - eqResponse(a.eqAt, fc[i]));
  // HPF: vokalde perdeye göre
  let hpf = base.hpf;
  let detected: 'male' | 'female' | undefined;
  if (s.group === 'vocal' && a.f0 && isFinite(a.f0.med)) {
    detected = a.f0.med < 165 ? 'male' : 'female';
    const byF0 = Math.max(70, Math.min(220, a.f0.lo * 0.75));
    hpf = Math.max(base.hpf * 0.8, Math.min(base.hpf * 1.3, byF0 * (use === 'speech' ? 1.25 : 1)));
    if (s.id === 'voc-m' && detected === 'female') notes.push({ level: 'info', text: n3(`Ses perdesi ~${Math.round(a.f0.med)} Hz: kadın sesi gibi. Kanal tipini "Kadın vokal" yapabilirsin.`, `Tonhöhe ~${Math.round(a.f0.med)} Hz: eher weiblich.`, `Pitch ~${Math.round(a.f0.med)} Hz: sounds female.`) });
    if (s.id === 'voc-f' && detected === 'male') notes.push({ level: 'info', text: n3(`Ses perdesi ~${Math.round(a.f0.med)} Hz: erkek sesi gibi. Kanal tipini "Erkek vokal" yapabilirsin.`, `Tonhöhe ~${Math.round(a.f0.med)} Hz: eher männlich.`, `Pitch ~${Math.round(a.f0.med)} Hz: sounds male.`) });
  }
  const lowE = meanIn(fc, raw, ok, lo, hpf * 0.9);
  if (isFinite(lowE) && lowE > 3) {
    hpf *= 1.15;
    notes.push({ level: 'info', text: n3('Temel sesin altında uğultu / pop var: HPF biraz yukarı.', 'Rumpeln unter dem Grundton: HPF etwas höher.', 'Rumble below the fundamental: HPF a bit higher.') });
  }
  const lpf = base.lpf;
  const fitLo = Math.max(hpf * 1.25, 90);
  const fitHi = Math.min(lpf ? lpf * 0.8 : 13000, 13000);
  const inFit = fc.map((f, i) => ok[i] && f >= fitLo && f <= fitHi);
  const moves: EqMove[] = [];
  const resp = (f: number) => hpfDb(f, hpf) + lpfDb(f, lpf) + moves.reduce((t, m) => t + moveDb(m, f), 0);
  const boostOk = (f: number) => s.boost.some(([l, h]) => f >= l && f <= h);
  const narrowOk = s.group !== 'vocal';
  for (let it = 0; it < 8 && moves.length < 4; it++) {
    const res = raw.map((v, i) => v + resp(fc[i]) - hpfDb(fc[i], hpf) - lpfDb(fc[i], lpf));
    const broad = smoothOct(fc, res, inFit, 1);
    const narrow = res.map((v, i) => v - broad[i]);
    let best: { m: EqMove; score: number } | null = null;
    const consider = (m: EqMove, score: number) => {
      if (moves.some((o) => Math.abs(lg(o.f) - lg(m.f)) < (Math.sign(o.gain) === Math.sign(m.gain) ? 0.6 : 0.4))) return;
      if (!best || score > best.score) best = { m, score };
    };
    for (let i = 1; i < fc.length - 1; i++) {
      if (!inFit[i]) continue;
      const b = broad[i];
      // geniş fazlalık → kısma
      if (b > 2.5 && b >= broad[i - 1] && b >= broad[i + 1]) {
        let l = i;
        let r = i;
        while (l > 0 && inFit[l - 1] && broad[l - 1] > b / 2) l--;
        while (r < fc.length - 1 && inFit[r + 1] && broad[r + 1] > b / 2) r++;
        const bw = Math.max(1 / 3, lg(fc[r]) - lg(fc[l]));
        const q = Math.max(0.7, Math.min(2.5, Math.sqrt(Math.pow(2, bw)) / (Math.pow(2, bw) - 1)));
        const why = regionAt(s, fc[i]);
        const w = why === 'mud' || why === 'boxy' || why === 'harsh' || why === 'nasal' || why === 'honk' ? 1.3 : 1;
        consider({ f: fc[i], gain: -Math.min(6, b * 0.85), q, type: 'bell', why }, b * 0.85 * 1.25 * w);
      }
      // geniş eksiklik → izin verilen yerde yükseltme
      if (b < -3 && b <= broad[i - 1] && b <= broad[i + 1] && boostOk(fc[i]) && s.maxBoost > 0) {
        const g = Math.min(s.maxBoost + (ch.voice === 'muffled' ? 1 : 0), -b * 0.6);
        const shelf = fc[i] >= 7000;
        consider({ f: shelf ? Math.max(7000, fc[i] / 1.4) : fc[i], gain: g, q: shelf ? 0.7 : 1, type: shelf ? 'hshelf' : 'bell', why: regionAt(s, fc[i]) }, g);
      }
      // dar rezonans (çınlama, kutu) → dar kesme
      // (vokalde yok: ses yolu geniş biçimlenir; dar tepe genelde salon / geri beslemedir)
      const nv = narrow[i];
      if (narrowOk && nv > 4.5 && nv >= narrow[i - 1] && nv >= narrow[i + 1] && fc[i] >= Math.max(120, (f0m || 0) * 5) && fc[i] <= 9000) {
        consider({ f: fc[i], gain: -Math.min(7, nv * 0.8), q: 4, type: 'bell', why: regionAt(s, fc[i]) }, nv * 0.8 * 1.1);
      }
    }
    const pick = best as { m: EqMove; score: number } | null;
    if (!pick || pick.score < 1.6) break;
    moves.push(pick.m);
  }
  // karakter: boğuk ses bildirildiyse ve netlik hâlâ düşükse
  const after0 = raw.map((v, i) => v + resp(fc[i]));
  if (s.group === 'vocal') {
    const pr = meanIn(fc, after0, ok, 2000, 4500);
    const mud = meanIn(fc, after0, ok, s.core[0] * 0.9, 600) - pr;
    if ((ch.voice === 'muffled' || mud > 3) && pr < 1 && !moves.some((m) => m.why === 'presence' && m.gain > 0)) {
      const add: EqMove = { f: 3000, gain: Math.min(4, 2 + Math.max(0, mud - 3) * 0.5), q: 1, type: 'bell', why: 'presence' };
      if (moves.length >= 4) moves.sort((x, y) => Math.abs(x.gain) - Math.abs(y.gain)).shift();
      moves.push(add);
    }
    if (mud > 3) notes.push({ level: 'warn', text: n3('Boğuk ses: alt-orta bölge fazla, netlik az. Önce boğukluğu kıs, mikrofonu ağza 2–5 cm ve tam karşıdan kullansın.', 'Mulmige Stimme: untere Mitten zu viel. Erst Mulm absenken, Mikro 2–5 cm direkt.', 'Muffled voice: too much low-mid. Cut the mud first; mic 2–5 cm, on axis.') });
    const sib = meanIn(fc, raw, ok, s.id === 'voc-f' ? 6000 : 5000, s.id === 'voc-f' ? 9500 : 8500);
    if (isFinite(sib) && sib > 3.5) notes.push({ level: 'info', text: n3('"S" ve "ş" sesleri sert: de-esser kullan (yoksa 7 kHz civarı dar kesme).', 'Zischlaute stark: De-Esser.', 'Strong sibilance: use a de-esser.') });
  }
  if (a.mode === 'direct') {
    if (a.peak > -1) notes.push({ level: 'warn', text: n3('Sinyal tepe yapıyor: gain\'i 3–6 dB düşür.', 'Signal clippt: Gain 3–6 dB runter.', 'Signal clips: lower gain 3–6 dB.') });
    else if (a.peak < -30) notes.push({ level: 'info', text: n3('Sinyal çok zayıf: gain\'i artır (en yüksek yerde ≈ −10 dBFS).', 'Signal schwach: Gain erhöhen.', 'Signal weak: raise gain.') });
  }
  if (a.crest > 22 && s.comp) notes.push({ level: 'info', text: n3('Ses seviyesi çok iniş çıkışlı: kompresör önerilen ayarla mutlaka açık olsun.', 'Große Dynamik: Kompressor unbedingt an.', 'Very dynamic: keep the compressor on.') });
  const eq = finalize({ hpf, lpf, moves: limitMoves(moves) });
  const after = raw.map((v, i) => v + eqResponse(eq, fc[i]) - hpfDb(fc[i], eq.hpf) - lpfDb(fc[i], eq.lpf));
  let clarity: ChanSuggestion['clarity'];
  if (s.group === 'vocal') {
    const b = clarityOf(fc, before, ok, s);
    const af = clarityOf(fc, after, ok, s);
    clarity = { before: b.pct, after: af.pct, mud: b.mud };
  }
  const resid = meanIn(fc, after.map((v) => Math.abs(v)), inFit, fitLo, fitHi);
  if (!eq.moves.length || (isFinite(resid) && resid < 1.5)) notes.unshift({ level: 'ok', text: n3('Ton dengesi iyi: büyük değişiklik gerekmiyor.', 'Klangbalance gut.', 'Tonal balance is good.') });
  return { eq, notes, fc, ok, before, after, clarity, detected };
}

// —— 3) Dinamik ve efekt ——
export interface ProcAdvice {
  comp?: { ratio: number; gr: [number, number]; attack: number; release: number };
  gate: boolean;
  deess: boolean;
  fx: { kind: 'vocal' | 'speech' | 'inst' | 'perc' | 'none'; decay?: number; send: 'off' | 'low' | 'mid' };
  phantom: boolean;
  loud: boolean;
}

export function procAdvice(ch: MixChannel, rt60?: number | null): ProcAdvice {
  const s = srcDef(ch.src);
  const use = useOf(ch);
  const micId = (ch.mic || s.mic) as MicType;
  let comp = s.comp ? { ...s.comp, gr: [...s.comp.gr] as [number, number] } : undefined;
  if (comp && s.group === 'vocal' && (use === 'speech' || ch.voice === 'muffled')) comp = { ...comp, ratio: comp.ratio + 1, gr: [comp.gr[0] + 1, comp.gr[1] + 2] };
  const rt = rt60 ?? 1.2;
  const kind = s.group === 'vocal' && use === 'speech' ? 'speech' : s.fx;
  const decay = kind === 'vocal' ? r1(Math.max(0.8, Math.min(1.8, 2.1 - rt * 0.6))) : kind === 'perc' ? 0.8 : kind === 'inst' ? r1(Math.max(0.8, Math.min(1.6, 1.9 - rt * 0.5))) : undefined;
  const send: ProcAdvice['fx']['send'] = kind === 'speech' || kind === 'none' ? 'off' : rt > 1.6 || kind === 'perc' ? 'low' : kind === 'vocal' ? 'mid' : 'low';
  const phantom = ['cond', 'clip', 'sdc', 'ldc'].includes(micId) && !(micId === 'cond' && /kablosuz|wireless/i.test(ch.name));
  return { comp, gate: !!s.gate, deess: !!s.deess || ch.voice === 'harsh', fx: { kind, decay, send }, phantom, loud: !!s.loud };
}

// —— 4) Mix: frekans paylaşımı (mono'da ayrım EQ ile yapılır) ——
export interface SlotCut {
  chId: string;
  f: number;
  gain: number;
  q: number;
  why: RegionKey;
  forCh: string[]; // yer açılan kanallar
}

export interface MixAdvice {
  cuts: SlotCut[];
  notes: L10n[];
  hpf: { chId: string; hpf: number }[];
}

const LOW_OWNERS = new Set(['bass', 'pa-bass', 'kick', 'davul', 'pa-drums', 'bendir', 'darbuka', 'dj']);

export function mixAdvice(setup: MixSetup): MixAdvice {
  const chans = setup.channels.map((c) => ({ c, s: srcDef(c.src) }));
  const cuts: SlotCut[] = [];
  const notes: L10n[] = [];
  const vocals = chans.filter((x) => x.s.group === 'vocal');
  const add = (chId: string, f: number, gain: number, q: number, why: RegionKey, forName: string) => {
    const ex = cuts.find((x) => x.chId === chId && Math.abs(lg(x.f) - lg(f)) < 0.5);
    if (ex) {
      if (!ex.forCh.includes(forName)) ex.forCh.push(forName);
      ex.gain = Math.min(ex.gain, gain);
      return;
    }
    cuts.push({ chId, f: niceF(f), gain, q, why, forCh: [forName] });
  };
  if (vocals.length) {
    const female = vocals.some((v) => v.s.id === 'voc-f');
    const vName = vocals.length > 3 ? vocals.slice(0, 3).map((v) => v.c.name).join(', ') + ` +${vocals.length - 3}` : vocals.map((v) => v.c.name).join(', ');
    for (const { c, s } of chans) {
      if (s.group === 'vocal' || s.id === 'dj') continue;
      const pres = s.key.find((k) => k.hi >= 2000 && k.lo <= 5000 && k.w >= 0.35);
      if (pres) add(c.id, female ? 3500 : 3000, s.prio <= 4 ? -2.5 : s.prio <= 6 ? -2 : -1.5, 1.2, 'presence', vName);
      const body = s.key.find((k) => k.lo <= 450 && k.hi >= 200 && k.w >= 0.4);
      if (body && (s.group === 'keys' || s.group === 'string') && s.prio <= 7 && !LOW_OWNERS.has(s.id)) add(c.id, female ? 400 : 300, -1.5, 1.2, 'mud', vName);
    }
    notes.push(n3('Vokale yer aç: enstrümanlarda 3 kHz civarını 1,5–2,5 dB kıs. Mono PA\'da ayrım pan ile değil EQ ile olur.', 'Platz für Gesang: Instrumente um 3 kHz 1,5–2,5 dB absenken. Bei Mono trennt EQ, nicht Panorama.', 'Make room for vocals: cut instruments around 3 kHz by 1.5–2.5 dB. In mono, EQ separates, not panning.'));
  }
  // alt bölge: tek sahip olsun
  const bassLike = chans.filter((x) => x.s.id === 'bass' || x.s.id === 'pa-bass');
  const drumLike = chans.filter((x) => ['kick', 'davul', 'pa-drums', 'bendir'].includes(x.s.id));
  if (bassLike.length && drumLike.length) {
    for (const b of bassLike) add(b.c.id, 70, -2, 1.4, 'body', drumLike.map((d) => d.c.name).slice(0, 2).join(', '));
    notes.push(n3('Bas ve davul aynı yeri istemesin: davul/kick 60–80 Hz\'te, bas 100–120 Hz\'te dursun (basta 70 Hz −2 dB).', 'Bass und Kick trennen: Kick 60–80 Hz, Bass 100–120 Hz.', 'Separate bass and kick: kick 60–80 Hz, bass 100–120 Hz.'));
  }
  if (chans.some((x) => x.s.id === 'pa-drums') && chans.some((x) => ['darbuka', 'davul', 'kick', 'snare'].includes(x.s.id))) notes.push(n3('Canlı ritim varken Pa5X ritim çıkışını kıs ya da kapat: iki ritim üst üste biner.', 'Mit Live-Rhythmus den Pa5X-Rhythmus leiser.', 'With live rhythm, turn the Pa5X rhythm down.'));
  const leads = chans.filter((x) => x.s.prio >= 7 && x.s.group !== 'vocal');
  if (leads.length >= 2) notes.push(n3('Birden çok solo enstrüman: aynı anda çalınca biri 2–3 dB geri. Ayrım için klarnet 1–1,5 kHz, bağlama 3 kHz, solo klavye 2 kHz çevresinde öne çıksın.', 'Mehrere Soloinstrumente: gleichzeitig einer 2–3 dB zurück.', 'Several lead instruments: when together, one sits 2–3 dB back.'));
  if (chans.some((x) => x.s.loud)) notes.push(n3('Zurna / davul akustik olarak salonu doldurur: kanallarını az aç, mikrofonlarını vokalden uzak tut.', 'Zurna / Davul sind akustisch laut: wenig Pegel.', 'Zurna / davul are acoustically loud: little level.'));
  const hpf = chans.map(({ c }) => ({ chId: c.id, hpf: startEq(c, setup).hpf }));
  return { cuts, notes, hpf };
}

// —— 5) Kanal kapasitesi ve mono ——
export function capacity(setup: MixSetup): { mic: number; line: number; total: number; ok: boolean; micOk: boolean } {
  const spec = MIXER_BY_ID[setup.mixer];
  let mic = 0;
  let line = 0;
  for (const c of setup.channels) {
    const m = (c.mic || srcDef(c.src).mic) as MicType;
    if (m === 'di') line++;
    else mic++;
  }
  const total = mic + line;
  const micOk = mic <= spec.mic;
  // hat kaynakları boş mikrofon girişlerine de takılabilir
  const ok = micOk && total <= spec.mic + spec.line;
  return { mic, line, total, ok, micOk };
}

export function monoNotes(setup: MixSetup): L10n[] {
  const out: L10n[] = [];
  if (!setup.mono) {
    out.push(n3('Stereo sadece seyircinin çoğu iki hoparlörün ortasındaysa işe yarar. Düğün salonu / spor salonunda MONO öner: herkes her şeyi duyar.', 'Stereo nur, wenn das Publikum mittig steht. Im Saal lieber MONO.', 'Stereo only works if most listeners are centered. In halls, prefer MONO.'));
    return out;
  }
  out.push(n3('Tüm kanalların pan\'ı ortada (C). Efekt dönüşleri stereo kalabilir, sonuçta ikisi de aynı hoparlörlerden çıkar.', 'Alle Kanäle Panorama Mitte. FX-Returns dürfen stereo bleiben.', 'All channels panned center. FX returns may stay stereo.'));
  if (setup.channels.some((c) => c.src === 'pa-lr')) out.push(n3('Pa5X L/R: ikisini de ortala. Geniş stereo / chorus efektleri mono\'da zayıflayabilir: mikserde mono dinle, gerekirse Pa5X\'te efekt genişliğini azalt.', 'Pa5X L/R beide Mitte; breite Effekte mono prüfen.', 'Pa5X L/R both center; check wide effects in mono.'));
  out.push(n3('Mono\'da aynı ses iki hoparlörden çıkar: enstrümanları birbirinden EQ ile ayır (frekans haritası).', 'Mono: dasselbe aus beiden Boxen — Trennung per EQ.', 'Mono: same signal from both speakers — separate with EQ.'));
  return out;
}

// Projedeki giriş listesinden kanal tipi tahmini
export function guessSource(defId: string, icon: string, name: string): string {
  const n = name.toLowerCase();
  if (/koro|chor|choir/.test(n)) return 'choir';
  if (/anons|konuşma|moderat|speech|kürsü|gooseneck/.test(n) || defId === 'mic-gooseneck') return 'speech';
  if (/kadın|female|frau|bayan/.test(n)) return 'voc-f';
  const map: Record<string, string> = { davul: 'davul', zurna: 'zurna', klarnet: 'klarnet', kaval: 'kaval', baglama: 'baglama-el', ud: 'ud', kanun: 'kanun', keman: 'keman', kemence: 'kemence', darbuka: 'darbuka', def: 'bendir', tulum: 'tulum', org: 'pa-lr', stagepiano: 'keys', piano: 'piano', egitar: 'gtr-el', agitar: 'gtr-ac', bas: 'bass', drumkit: 'kick' };
  if (map[defId]) return map[defId];
  if (icon === 'djmixer' || icon === 'djcontroller' || icon === 'djplayer') return 'dj';
  if (icon === 'keyboard') return 'keys';
  return 'voc-m';
}

// —— 6) Kanalın son EQ'su: ölçüme göre (yoksa başlangıç) + mix için yer açma ——
export function mergeSlots(eq: ChanEq, cuts: SlotCut[]): ChanEq {
  const moves = eq.moves.map((m) => ({ ...m }));
  for (const c of cuts) {
    const near = moves.find((m) => Math.abs(lg(m.f) - lg(c.f)) < 0.5);
    if (near) {
      near.gain = Math.max(-8, Math.min(6, near.gain + c.gain));
      near.slot = true;
      continue;
    }
    const mv: EqMove = { f: c.f, gain: c.gain, q: c.q, type: 'bell', why: c.why, slot: true };
    if (moves.length < 4) moves.push(mv);
    else {
      const weakest = moves.reduce((a, b) => (Math.abs(a.gain) <= Math.abs(b.gain) ? a : b));
      if (Math.abs(weakest.gain) < Math.abs(c.gain)) moves.splice(moves.indexOf(weakest), 1, mv);
    }
  }
  return finalize({ ...eq, moves: moves.filter((m) => Math.abs(m.gain) >= 0.75) });
}

export interface ChannelPlan {
  base: ChanEq; // dinlemeden başlangıç
  sugg: ChanSuggestion | null; // dinlemeye göre
  eq: ChanEq; // mikserde girilecek son ayar (mix payı dahil)
  slots: SlotCut[];
}

export function channelPlan(ch: MixChannel, setup: MixSetup, mix: MixAdvice, sys?: Measurement | null, sysEq?: EqTarget): ChannelPlan {
  const base = startEq(ch, setup);
  const sugg = ch.meas ? suggestFromMeas(ch, setup, sys, sysEq) : null;
  const slots = mix.cuts.filter((c) => c.chId === ch.id);
  const eq = mergeSlots(sugg ? sugg.eq : base, slots);
  return { base, sugg, eq, slots };
}

// İki EQ arasındaki farklar (mikserde ne değişecek)
export function eqDiff(from: ChanEq | undefined, to: ChanEq): { band: number; from?: EqMove; to?: EqMove }[] {
  const out: { band: number; from?: EqMove; to?: EqMove }[] = [];
  for (let b = 1; b <= 4; b++) {
    const a = from?.moves.find((m) => m.band === b);
    const c = to.moves.find((m) => m.band === b);
    if (!a && !c) continue;
    if (a && c && a.f === c.f && a.gain === c.gain && a.q === c.q && a.type === c.type) continue;
    out.push({ band: b, from: a, to: c });
  }
  return out;
}
