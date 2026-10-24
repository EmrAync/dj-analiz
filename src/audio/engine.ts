// Web Audio ile canlı ölçüm: mikrofon (UMIK-1 USB, ECM8000 + ses kartı…), FFT, 1/24 oktav bantlar,
// kalibrasyon, ortalama, SPL (A/C/Z, Leq, Max), geri besleme tespiti ve sinyal üreteci (pembe/beyaz gürültü, sinüs).
import { create } from 'zustand';
import { binsToBands, calAt, dB, octaveBands, type Bands, type CalFile } from './dsp';
import { feedbackPeaks } from '../engine/eq';
import { Meter, type SecondRec } from './meter';
import { analyzeIR, extractIRs, sweepSequence, SWEEP_DEFAULT, type IRAnalysis, type SweepSpec } from './sweep';

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

// Ses seviyesi ölçer okumaları (dB SPL, kalibrasyon dahil)
export interface Levels {
  af: number; // LAF
  as: number; // LAS
  cs: number; // LCS
  zs: number; // LZS
  leqA: number; // LAeq (sıfırlamadan beri)
  leqC: number;
  maxAF: number;
  minAF: number;
  cpk: number; // LCpeak
  secs: number;
}

export interface SweepRun {
  id: string;
  at: number;
  source: 'self' | 'external';
  label: string;
  ir: Float64Array;
  pre: number;
  fs: number;
  an: IRAnalysis;
  absMs: number | null; // kendi çaldığımızda: tarama başlangıcından ilk varışa (sistem gecikmesi dahil)
  peakMs: number | null; // aynı zaman tabanında ir'deki ana tepe (ir[pre]) zamanı
  snr: number;
  found: number;
}

export interface SweepState {
  phase: 'idle' | 'play' | 'listen' | 'analyze';
  until: number; // performance.now() bitiş
  error: string | null;
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
  lv: Levels | null;
  histN: number; // saniyelik kayıt uzunluğu (yeniden çizim için)
  sweep: SweepState;
  runs: SweepRun[];
  latency: number | null; // sistem gecikmesi referansı (ms)
  dsp: { ec: boolean; ns: boolean; agc: boolean } | null; // tarayıcının ses işleme durumu (ölçümü bozar)
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
  lv: null,
  histN: 0,
  sweep: { phase: 'idle', until: 0, error: null },
  runs: [],
  latency: null,
  dsp: null,
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
let t0 = 0;
let calCorr: Float64Array | null = null; // bin başına kalibrasyon çarpanı
let proc: ScriptProcessorNode | null = null;
let mute: GainNode | null = null;
let meter: Meter | null = null;
// halka tampon: son 20 s giriş (tarama ölçümü için)
let ring = new Float32Array(0);
let ringPos = 0; // toplam yazılan örnek
let lastBlockTime = 0;
let lastBlockLen = 0;

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
    // örnek örnek ses seviyesi ölçer + halka tampon
    if (!meter || meter.fs !== c.sampleRate) meter = new Meter(c.sampleRate);
    ring = new Float32Array(Math.round(c.sampleRate * 20));
    ringPos = 0;
    proc = c.createScriptProcessor(4096, 1, 1);
    proc.onaudioprocess = (e) => {
      const x = e.inputBuffer.getChannelData(0);
      if (!get().frozen) meter?.process(x);
      const n = x.length;
      for (let i = 0; i < n; i++) ring[(ringPos + i) % ring.length] = x[i];
      ringPos += n;
      lastBlockTime = e.playbackTime;
      lastBlockLen = n;
    };
    mute = c.createGain();
    mute.gain.value = 0;
    splitter.connect(proc, ch);
    proc.connect(mute);
    mute.connect(c.destination);
    // cihaza ait kalibrasyon
    const saved = loadCals()[label];
    const cal = saved || { ...defaultCal(guessPreset(label)) };
    const ms0 = settings as MediaTrackSettings;
    const dsp = { ec: ms0.echoCancellation === true, ns: ms0.noiseSuppression === true, agc: ms0.autoGainControl === true };
    set({ running: true, starting: false, deviceId: ms0.deviceId || want || '', deviceLabel: label, channel: ch, channels: chans, sampleRate: c.sampleRate, cal, latency: loadLatency(label), dsp });
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
    proc?.disconnect();
    mute?.disconnect();
  } catch {
    /* yok */
  }
  if (proc) proc.onaudioprocess = null;
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  srcNode = null;
  splitter = null;
  analyser = null;
  proc = null;
  mute = null;
  if (clear) set({ running: false });
}

export function setChannel(ch: number): void {
  set({ channel: ch });
  if (splitter && analyser) {
    try {
      splitter.disconnect();
      splitter.connect(analyser, Math.min(ch, get().channels - 1));
      if (proc) splitter.connect(proc, Math.min(ch, get().channels - 1));
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
  meter?.reset();
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
  const lv = get().lv;
  if (!lv) return false;
  const cur = w === 'A' ? lv.as : w === 'C' ? lv.cs : lv.zs;
  if (!isFinite(cur)) return false;
  setCal({ offset: get().cal.offset + (ref - cur), calibrated: true });
  resetAvg();
  return true;
}

function levelsNow(): Levels | null {
  if (!meter) return null;
  const r = meter.read();
  const off = get().cal.offset;
  const L = (v: number) => (v > 0 ? 10 * Math.log10(v) + off : NaN);
  return { af: L(r.af), as: L(r.as), cs: L(r.cs), zs: L(r.zs), leqA: L(r.leqA), leqC: L(r.leqC), maxAF: L(r.maxAF), minAF: isFinite(r.minAF) ? L(r.minAF) : NaN, cpk: L(r.cpk), secs: r.secs };
}

// Saniyelik kayıt (ham MS; dB'ye çevirirken güncel ofset kullanılır)
export function meterHistory(): SecondRec[] {
  return meter?.hist ?? [];
}

export function clearHistory(): void {
  meter?.clearHistory();
  set({ histN: 0 });
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
  const toDb = (a: Float64Array) => Float64Array.from(a, (v) => dB(v));
  const lv = levelsNow();
  const frame: Frame = {
    bands: toDb(avgMs),
    peak: toDb(peakMs),
    live: toDb(bandsMs),
    spl: { a: lv?.as ?? NaN, c: lv?.cs ?? NaN, z: lv?.zs ?? NaN, leq: lv?.leqA ?? NaN, max: lv?.maxAF ?? NaN },
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
  set({ frame, lv, histN: meter?.hist.length ?? 0, fb: fb.filter((x) => now - x.at < 15000 || x.seen >= 8).slice(-12) });
}

// —— Kanal dinleme: halka tampondan kayıt (en fazla 20 s) ——
let capStart = -1;

export function captureBegin(): boolean {
  if (!get().running) return false;
  capStart = ringPos;
  return true;
}

export function captureSecs(): number {
  return capStart >= 0 && ctx ? (ringPos - capStart) / ctx.sampleRate : 0;
}

export function captureEnd(): { x: Float32Array; fs: number } | null {
  if (capStart < 0 || !ctx || !ring.length) return null;
  const n = Math.min(ringPos - capStart, ring.length);
  capStart = -1;
  if (n <= 0) return null;
  const x = new Float32Array(n);
  const start = ringPos - n;
  for (let i = 0; i < n; i++) x[i] = ring[(start + i) % ring.length];
  return { x, fs: ctx.sampleRate };
}

export function captureCancel(): void {
  capStart = -1;
}

// Mikrofon kalibrasyon dosyası düzeltmesi (dB, eklenir)
export function micCorr(f: number): number {
  return -calAt(get().cal.file, f);
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

// —— Sistem gecikmesi referansı (mikrofon hoparlöre dayalıyken ölçülen) ——
const LAT_KEY = 'sahnecad.latency';

function loadLatency(label: string): number | null {
  try {
    const v = (JSON.parse(localStorage.getItem(LAT_KEY) || '{}') as Record<string, number>)[label || 'default'];
    return typeof v === 'number' ? v : null;
  } catch {
    return null;
  }
}

export function setLatency(ms: number | null): void {
  set({ latency: ms });
  try {
    const all = JSON.parse(localStorage.getItem(LAT_KEY) || '{}') as Record<string, number | null>;
    all[get().deviceLabel || 'default'] = ms;
    localStorage.setItem(LAT_KEY, JSON.stringify(all));
  } catch {
    /* yok */
  }
}

// —— Tarama ölçümü ——
function ringRead(from: number, to: number): Float32Array | null {
  if (to <= from || ringPos - from > ring.length || to > ringPos) return null;
  const out = new Float32Array(to - from);
  for (let g = from; g < to; g++) out[g - from] = ring[g % ring.length];
  return out;
}

function indexOfTime(t: number, fs: number): number {
  return ringPos - lastBlockLen + Math.round((t - lastBlockTime) * fs);
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function sweepSpec(): SweepSpec {
  return { ...SWEEP_DEFAULT, fs: ctx?.sampleRate || get().sampleRate || 48000 };
}

// source 'self': bu cihaz taramayı çalar (zaman referansı bilinir, A/B karşılaştırılabilir)
// source 'external': tarama WAV'ı başka cihazdan çalınır; sadece aynı ölçümdeki varışlar karşılaştırılır
export async function measureSweep(source: 'self' | 'external', label: string, out: 'both' | 'L' | 'R' = 'both'): Promise<SweepRun | null> {
  if (!ctx || !proc || get().sweep.phase !== 'idle') return null;
  const c = ctx;
  const spec = sweepSpec();
  const seq = sweepSequence(spec, 0.3, 1.4);
  const durMs = (seq.data.length / spec.fs) * 1000;
  if (get().gen.on) setGen({ on: false });
  let g0 = 0;
  try {
    if (source === 'self') {
      const buf = c.createBuffer(2, seq.data.length, spec.fs);
      if (out !== 'R') buf.copyToChannel(seq.data, 0);
      if (out !== 'L') buf.copyToChannel(seq.data, 1);
      const node = c.createBufferSource();
      node.buffer = buf;
      node.connect(c.destination);
      const T0 = c.currentTime + 0.25;
      node.start(T0);
      set({ sweep: { phase: 'play', until: performance.now() + durMs + 450, error: null } });
      await wait(durMs + 450);
      g0 = indexOfTime(T0, spec.fs);
    } else {
      const listen = durMs + 2500;
      set({ sweep: { phase: 'listen', until: performance.now() + listen, error: null } });
      await wait(listen);
    }
    set({ sweep: { phase: 'analyze', until: 0, error: null } });
    await wait(30);
    let rec: Float32Array | null;
    let res;
    if (source === 'self') {
      const from = g0 - Math.round(0.2 * spec.fs);
      rec = ringRead(from, Math.min(ringPos, g0 + seq.data.length + Math.round(0.4 * spec.fs)));
      res = rec ? extractIRs(rec, spec, seq.starts.map((st) => st + g0 - from)) : null;
    } else {
      const n = Math.round(((durMs + 2400) / 1000) * spec.fs);
      rec = ringRead(ringPos - n, ringPos);
      res = rec ? extractIRs(rec, spec) : null;
    }
    if (!res || res.snr < 10) {
      set({ sweep: { phase: 'idle', until: 0, error: res ? 'lowsnr' : 'notfound' } });
      return null;
    }
    const an = analyzeIR(res.ir, spec.fs, res.pre);
    const run: SweepRun = {
      id: Math.random().toString(36).slice(2, 8),
      at: Date.now(),
      source,
      label,
      ir: res.ir,
      pre: res.pre,
      fs: spec.fs,
      an,
      absMs: source === 'self' ? ((res.peaks[0] - res.starts[0]) / spec.fs) * 1000 + an.firstMs - (res.pre / spec.fs) * 1000 : null,
      peakMs: source === 'self' ? ((res.peaks[0] - res.starts[0]) / spec.fs) * 1000 : null,
      snr: res.snr,
      found: res.found,
    };
    set({ sweep: { phase: 'idle', until: 0, error: null }, runs: [...get().runs.slice(-7), run] });
    return run;
  } catch {
    set({ sweep: { phase: 'idle', until: 0, error: 'other' } });
    return null;
  }
}

export function removeRun(id: string): void {
  set({ runs: get().runs.filter((r) => r.id !== id) });
}

// —— Ekranı açık tut (ölçüm/kayıt sırasında) ——
let wake: { release: () => Promise<void> } | null = null;
let wantWake = false;

export async function keepAwake(on: boolean): Promise<boolean> {
  wantWake = on;
  try {
    if (!on) {
      await wake?.release();
      wake = null;
      return true;
    }
    const wl = (navigator as unknown as { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } }).wakeLock;
    if (!wl) return false;
    wake = await wl.request('screen');
    return true;
  } catch {
    return false;
  }
}

if (typeof document !== 'undefined')
  document.addEventListener('visibilitychange', () => {
    if (wantWake && document.visibilityState === 'visible') void keepAwake(true);
  });
