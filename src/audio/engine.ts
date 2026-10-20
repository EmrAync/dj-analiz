// Web Audio ile canlı ölçüm: mikrofon (UMIK-1 USB, ECM8000 + ses kartı…), FFT, 1/24 oktav bantlar,
// kalibrasyon, ortalama, SPL (A/C/Z, Leq, Max), geri besleme tespiti ve sinyal üreteci (pembe/beyaz gürültü, sinüs).
import { create } from 'zustand';
import { binsToBands, calAt, dB, octaveBands, weighted, type Bands, type CalFile } from './dsp';
import { feedbackPeaks } from '../engine/eq';

export type MicPreset = 'umik1' | 'ecm8000' | 'other';
export type AvgMode = 'fast' | 'slow' | 'inf';

export interface MicCal {
  preset: MicPreset;
  offset: number; // dB SPL = dBFS + offset
  calibrated: boolean; // referansla kalibre edildi
  file: CalFile | null;
}

export interface Frame {
  bands: Float64Array; // 1/24 oktav, dB SPL (ortalama)
  peak: Float64Array; // tepe tutma
  live: Float64Array; // anlık (ortalamasız)
  spl: { a: number; c: number; z: number; leq: number; max: number };
  inPeak: number; // giriş tepe seviyesi dBFS
  clip: boolean;
  secs: number; // ortalama süresi
}

export interface Feedback {
  f: number;
  db: number;
  prom: number;
  seen: number;
  at: number;
}

export interface GenState {
  on: boolean;
  kind: 'pink' | 'white' | 'sine';
  level: number; // dBFS
  freq: number;
  out: 'both' | 'L' | 'R';
}

interface RtaState {
  running: boolean;
  starting: boolean;
  error: string | null;
  devices: { id: string; label: string }[];
  deviceId: string;
  deviceLabel: string;
  channel: number;
  channels: number;
  sampleRate: number;
  avg: AvgMode;
  frozen: boolean;
  cal: MicCal;
  gen: GenState;
  frame: Frame | null;
  fb: Feedback[];
}

export const FINE: Bands = octaveBands(24);

const CAL_KEY = 'sahnecad.mic';

function loadCals(): Record<string, MicCal> {
  try {
    return JSON.parse(localStorage.getItem(CAL_KEY) || '{}') as Record<string, MicCal>;
  } catch {
    return {};
  }
}

function saveCal(label: string, cal: MicCal): void {
  try {
    const all = loadCals();
    all[label || 'default'] = cal;
    localStorage.setItem(CAL_KEY, JSON.stringify(all));
  } catch {
    /* depolama yok */
  }
}

export function guessPreset(label: string): MicPreset {
  if (/umik/i.test(label)) return 'umik1';
  if (/ecm\s*8000/i.test(label)) return 'ecm8000';
  return 'other';
}

// Varsayılan ofsetler (kalibre edilmemiş, kaba): UMIK-1 ~ 0 dBFS ≈ 115 dB SPL; ses kartı + ECM8000 bilinmiyor
export function defaultCal(preset: MicPreset): MicCal {
  return { preset, offset: preset === 'umik1' ? 115 : 120, calibrated: false, file: null };
}

export const useRta = create<RtaState>()(() => ({
  running: false,
  starting: false,
  error: null,
  devices: [],
  deviceId: '',
  deviceLabel: '',
  channel: 0,
  channels: 1,
  sampleRate: 48000,
  avg: 'slow',
  frozen: false,
  cal: defaultCal('other'),
  gen: { on: false, kind: 'pink', level: -20, freq: 1000, out: 'both' },
  frame: null,
  fb: [],
}));

const set = (p: Partial<RtaState>) => useRta.setState(p);
const get = () => useRta.getState();

// —— Motor ——
let ctx: AudioContext | null = null;
let stream: MediaStream | null = null;
let srcNode: MediaStreamAudioSourceNode | null = null;
let splitter: ChannelSplitterNode | null = null;
let analyser: AnalyserNode | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let genNode: AudioScheduledSourceNode | null = null;
let genGain: GainNode | null = null;
let binDb = new Float32Array(0);
let td = new Float32Array(0);
let logScale = 0; // tarayıcıya göre FFT ölçek düzeltmesi (zaman bölgesiyle karşılaştırılarak)
let avgMs: Float64Array | null = null;
let peakMs: Float64Array | null = null;
let nAvg = 0;
let leqSum = 0;
let leqN = 0;
let maxA = -200;
let t0 = 0;
let calCorr: Float64Array | null = null; // bin başına kalibrasyon çarpanı

const FFT = 16384;
const FRAME_MS = 100;
const BLACKMAN_MS = 0.3046; // pencere kare ortalaması

function ensureCtx(): AudioContext {
  if (!ctx) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new AC({ latencyHint: 'interactive' });
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

export async function listDevices(): Promise<void> {
  try {
    const all = await navigator.mediaDevices.enumerateDevices();
    const ins = all.filter((d) => d.kind === 'audioinput').map((d, i) => ({ id: d.deviceId, label: d.label || `Mikrofon ${i + 1}` }));
    set({ devices: ins });
  } catch {
    /* izin yok */
  }
}

export async function startRta(deviceId?: string): Promise<void> {
  if (get().starting) return;
  stopRta(false);
  set({ starting: true, error: null });
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('nomedia');
    const c = ensureCtx();
    const want = deviceId ?? get().deviceId;
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: want ? { exact: want } : undefined,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: { ideal: 2 },
      },
    });
    const track = stream.getAudioTracks()[0];
    const label = track?.label || '';
    const settings = track?.getSettings?.() || {};
    await listDevices();
    srcNode = c.createMediaStreamSource(stream);
    const chans = Math.max(1, Math.min(2, (settings as MediaTrackSettings).channelCount || srcNode.channelCount || 1));
    splitter = c.createChannelSplitter(2);
    analyser = c.createAnalyser();
    analyser.fftSize = FFT;
    analyser.smoothingTimeConstant = 0;
    analyser.minDecibels = -160;
    analyser.maxDecibels = 0;
    srcNode.connect(splitter);
    const ch = Math.min(get().channel, chans - 1);
    splitter.connect(analyser, ch);
    binDb = new Float32Array(analyser.frequencyBinCount);
    td = new Float32Array(analyser.fftSize);
    // cihaza ait kalibrasyon
    const saved = loadCals()[label];
    const cal = saved || { ...defaultCal(guessPreset(label)) };
    set({ running: true, starting: false, deviceId: (settings as MediaTrackSettings).deviceId || want || '', deviceLabel: label, channel: ch, channels: chans, sampleRate: c.sampleRate, cal });
    buildCalCorr();
    resetAvg();
    timer = setInterval(tick, FRAME_MS);
  } catch (e) {
    const err = e as Error & { name?: string };
    set({ starting: false, running: false, error: err.name === 'NotAllowedError' ? 'denied' : err.name === 'NotFoundError' ? 'notfound' : err.message === 'nomedia' ? 'nomedia' : 'other' });
    stopRta(false);
  }
}

export function stopRta(clear = true): void {
  if (timer) clearInterval(timer);
  timer = null;
  try {
    srcNode?.disconnect();
    splitter?.disconnect();
  } catch {
    /* yok */
  }
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  srcNode = null;
  splitter = null;
  analyser = null;
  if (clear) set({ running: false });
}

export function setChannel(ch: number): void {
  set({ channel: ch });
  if (splitter && analyser) {
    try {
      splitter.disconnect();
      splitter.connect(analyser, Math.min(ch, get().channels - 1));
    } catch {
      /* yok */
    }
    resetAvg();
  }
}

export function setAvg(a: AvgMode): void {
  set({ avg: a });
  resetAvg();
}

export function resetAvg(): void {
  avgMs = null;
  peakMs = null;
  nAvg = 0;
  leqSum = 0;
  leqN = 0;
  maxA = -200;
  t0 = performance.now();
  set({ fb: [] });
}

export function setCal(patch: Partial<MicCal>): void {
  const cal = { ...get().cal, ...patch };
  set({ cal });
  saveCal(get().deviceLabel, cal);
  buildCalCorr();
}

function buildCalCorr(): void {
  if (!analyser || !ctx) return;
  const n = analyser.frequencyBinCount;
  const binHz = ctx.sampleRate / FFT;
  const file = get().cal.file;
  calCorr = new Float64Array(n);
  for (let k = 0; k < n; k++) calCorr[k] = Math.pow(10, -calAt(file, Math.max(1, k * binHz)) / 10);
}

// Referansla kalibrasyon: o anki (ağırlıklı) seviye = referans ölçerin gösterdiği
export function calibrateTo(ref: number, w: 'A' | 'C' | 'Z'): boolean {
  const f = get().frame;
  if (!f) return false;
  const cur = w === 'A' ? f.spl.a : w === 'C' ? f.spl.c : f.spl.z;
  if (!isFinite(cur)) return false;
  setCal({ offset: get().cal.offset + (ref - cur), calibrated: true });
  resetAvg();
  return true;
}

function tick(): void {
  if (!analyser || !ctx || get().frozen) return;
  analyser.getFloatFrequencyData(binDb);
  analyser.getFloatTimeDomainData(td);
  let pk = 0;
  for (let i = 0; i < td.length; i++) pk = Math.max(pk, Math.abs(td[i]));
  const binHz = ctx.sampleRate / FFT;
  const n = binDb.length;
  // bin dB → MS (sinüs = 0 dBFS ölçeği: ×2) → kalibrasyon
  const P = new Float64Array(n);
  const k2 = (2 / BLACKMAN_MS) * 2;
  let pt = 0;
  for (let k = 1; k < n; k++) {
    P[k] = Math.pow(10, binDb[k] / 10) * k2;
    pt += P[k];
  }
  // ölçek denetimi: spektrum toplamı ≈ zaman bölgesi ortalama karesi (sinüs = 0 dBFS → ×2)
  let mt = 0;
  for (let i = 0; i < td.length; i++) mt += td[i] * td[i];
  mt = (mt / td.length) * 2;
  if (pt > 1e-10 && mt > 1e-10) logScale += (Math.log(mt / pt) - logScale) * 0.05;
  const sc = Math.exp(Math.max(-1.6, Math.min(1.6, logScale)));
  for (let k = 1; k < n; k++) P[k] *= sc * (calCorr ? calCorr[k] : 1);
  const bandsMs = binsToBands(P, binHz, FINE);
  const off = Math.pow(10, get().cal.offset / 10);
  for (let i = 0; i < bandsMs.length; i++) bandsMs[i] *= off;
  // ortalama
  const mode = get().avg;
  if (!avgMs || mode === 'inf') {
    if (!avgMs) avgMs = new Float64Array(bandsMs.length);
    nAvg++;
    for (let i = 0; i < bandsMs.length; i++) avgMs[i] += (bandsMs[i] - avgMs[i]) / nAvg;
  } else {
    const tau = mode === 'fast' ? 0.35 : 1.5;
    const a = 1 - Math.exp(-FRAME_MS / 1000 / tau);
    for (let i = 0; i < bandsMs.length; i++) avgMs[i] += (bandsMs[i] - avgMs[i]) * a;
  }
  if (!peakMs) peakMs = Float64Array.from(bandsMs);
  else for (let i = 0; i < bandsMs.length; i++) peakMs[i] = Math.max(peakMs[i] * 0.995, bandsMs[i]);
  const la = weighted(bandsMs, FINE, 'A');
  leqSum += Math.pow(10, la / 10);
  leqN++;
  maxA = Math.max(maxA, la);
  const toDb = (a: Float64Array) => Float64Array.from(a, (v) => dB(v));
  const frame: Frame = {
    bands: toDb(avgMs),
    peak: toDb(peakMs),
    live: toDb(bandsMs),
    spl: { a: weighted(avgMs, FINE, 'A'), c: weighted(avgMs, FINE, 'C'), z: weighted(avgMs, FINE, 'Z'), leq: dB(leqSum / leqN), max: maxA },
    inPeak: pk > 0 ? 20 * Math.log10(pk) : -120,
    clip: pk >= 0.98,
    secs: (performance.now() - t0) / 1000,
  };
  // geri besleme takibi
  const now = performance.now();
  // test sinyali çalarken (özellikle sinüs) geri besleme araması yapılmaz
  const g = get().gen;
  const peaks = g.on && g.kind === 'sine' ? [] : feedbackPeaks(binDb, binHz, 20);
  const fb = get().fb.slice();
  for (const p of peaks) {
    const e = fb.find((x) => Math.abs(Math.log2(x.f / p.f)) < 1 / 24);
    if (e) {
      e.seen++;
      e.at = now;
      e.db = p.db;
      e.prom = Math.max(e.prom, p.prom);
      e.f = p.f;
    } else fb.push({ ...p, seen: 1, at: now });
  }
  set({ frame, fb: fb.filter((x) => now - x.at < 15000 || x.seen >= 8).slice(-12) });
}

// —— Sinyal üreteci ——
function noiseBuffer(c: AudioContext, kind: 'pink' | 'white'): AudioBuffer {
  const len = c.sampleRate * 8;
  const buf = c.createBuffer(2, len, c.sampleRate);
  for (let chn = 0; chn < 2; chn++) {
    const d = buf.getChannelData(chn);
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    let b3 = 0;
    let b4 = 0;
    let b5 = 0;
    let b6 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === 'white') {
        d[i] = w * 0.5;
        continue;
      }
      // Paul Kellet pembe gürültü filtresi
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    }
  }
  return buf;
}

export function setGen(patch: Partial<GenState>): void {
  const g = { ...get().gen, ...patch };
  set({ gen: g });
  const c = ensureCtx();
  const restart = 'kind' in patch || 'out' in patch || ('freq' in patch && g.kind !== 'sine') || ('on' in patch && patch.on);
  if (!g.on) {
    try {
      genNode?.stop();
    } catch {
      /* yok */
    }
    genNode = null;
    return;
  }
  if (genNode && !restart) {
    if (genGain) genGain.gain.setTargetAtTime(Math.pow(10, g.level / 20), c.currentTime, 0.05);
    if (g.kind === 'sine' && genNode instanceof OscillatorNode) genNode.frequency.setTargetAtTime(g.freq, c.currentTime, 0.02);
    return;
  }
  try {
    genNode?.stop();
  } catch {
    /* yok */
  }
  genGain = c.createGain();
  genGain.gain.value = Math.pow(10, g.level / 20);
  const merger = c.createChannelMerger(2);
  if (g.kind === 'sine') {
    const o = c.createOscillator();
    o.frequency.value = g.freq;
    genNode = o;
  } else {
    const s = c.createBufferSource();
    s.buffer = noiseBuffer(c, g.kind);
    s.loop = true;
    genNode = s;
  }
  // sinüs tam ölçek: genlik 1 = 0 dBFS; gürültü tampon ~ −12 dBFS RMS
  genNode.connect(genGain);
  if (g.out !== 'R') genGain.connect(merger, 0, 0);
  if (g.out !== 'L') genGain.connect(merger, 0, 1);
  merger.connect(c.destination);
  genNode.start();
}
