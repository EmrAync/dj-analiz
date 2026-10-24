// Mikser bilgileri: kanal sayısı, EQ yapısı, işlemler ve menü adları — talimatlar her miksere göre yazılır.
// Kaynak: üretici / satıcı teknik özellikleri (yaklaşık; firmware ile değişebilir).
import type { L10n, MixerId } from '../model/types';

const n3 = (tr: string, de: string, en: string): L10n => ({ tr, de, en });

export interface MixerSpec {
  id: MixerId;
  name: string;
  defIds: string[]; // katalogdaki karşılığı (projeden otomatik seçim)
  mic: number; // mikrofon ön amfisi
  line: number; // ek hat girişi (mono sayısı)
  aux: number; // monitör / aux çıkışı
  fx: number;
  hpfMax: number;
  hpfSlope: boolean; // eğim seçilebilir
  lpf: 'own' | 'band4' | 'none';
  xair: boolean; // X AIR bant tipleri (LCut/LShv/PEQ/VEQ/HShv/HCut)
  eqGain: number;
  deess: 'own' | 'fx' | 'none';
  automix?: L10n;
  fbAssist?: L10n;
  gainAssist?: L10n;
  app: L10n;
  scene: L10n;
  usb: L10n;
  names: { gain: L10n; hpf: L10n; eq: L10n; gate: L10n; comp: L10n; fx: L10n };
  extras: L10n[];
}

export const MIXERS: MixerSpec[] = [
  {
    id: 'ui24r', name: 'Soundcraft Ui24R', defIds: ['sc-ui24r'], mic: 20, line: 2, aux: 8, fx: 4,
    hpfMax: 1000, hpfSlope: true, lpf: 'own', xair: false, eqGain: 20, deess: 'own',
    fbAssist: n3('Çıkışlarda dbx AFS2 geri besleme bastırıcı', 'dbx AFS2 auf den Ausgängen', 'dbx AFS2 on outputs'),
    app: n3('Ui arayüzü (tarayıcıda: telefon, tablet, PC)', 'Ui-Oberfläche im Browser', 'Ui web interface (browser)'),
    scene: n3('Show / Snapshot kaydet', 'Show / Snapshot speichern', 'Save show / snapshot'),
    usb: n3('USB çok kanallı kayıt (sanal ses kontrolü için)', 'USB-Mehrspuraufnahme (virtueller Soundcheck)', 'USB multitrack recording (virtual soundcheck)'),
    names: { gain: n3('Gain', 'Gain', 'Gain'), hpf: n3('HPF', 'HPF', 'HPF'), eq: n3('EQ (4 bant)', 'EQ (4 Bänder)', 'EQ (4 bands)'), gate: n3('Gate', 'Gate', 'Gate'), comp: n3('Compressor', 'Kompressor', 'Compressor'), fx: n3('FX gönder (Lexicon reverb / delay)', 'FX-Send (Lexicon Hall / Delay)', 'FX send (Lexicon reverb / delay)') },
    extras: [n3('Kanal EQ: 20 Hz–22 kHz, Q 0,05–15, ±20 dB; HPF 1 kHz\'e kadar, eğim seçilir; ayrıca LPF ve de-esser var.', 'Kanal-EQ: 20 Hz–22 kHz, Q 0,05–15, ±20 dB; HPF bis 1 kHz mit Flanke; LPF und De-Esser.', 'Channel EQ 20 Hz–22 kHz, Q 0.05–15, ±20 dB; HPF up to 1 kHz with slopes; LPF and de-esser.')],
  },
  {
    id: 'xr18', name: 'Behringer XR18', defIds: ['beh-xr18'], mic: 16, line: 2, aux: 6, fx: 4,
    hpfMax: 400, hpfSlope: false, lpf: 'band4', xair: true, eqGain: 15, deess: 'fx',
    automix: n3('Automix (konuşma mikrofonları)', 'Automix (Sprechermikros)', 'Automix (speech mics)'),
    app: n3('X AIR Edit / Mixing Station', 'X AIR Edit / Mixing Station', 'X AIR Edit / Mixing Station'),
    scene: n3('Snapshot kaydet', 'Snapshot speichern', 'Save snapshot'),
    usb: n3('18×18 USB ses kartı (kanal kanal kayıt)', '18×18 USB-Audio', '18×18 USB audio'),
    names: { gain: n3('Gain (preamp)', 'Gain (Preamp)', 'Gain (preamp)'), hpf: n3('Low Cut', 'Low Cut', 'Low Cut'), eq: n3('EQ (4 bant)', 'EQ (4 Bänder)', 'EQ (4 bands)'), gate: n3('Gate', 'Gate', 'Gate'), comp: n3('Dyn (kompresör)', 'Dyn (Kompressor)', 'Dyn (compressor)'), fx: n3('FX gönder (Bus)', 'FX-Send', 'FX send') },
    extras: [n3('Kanal: Low Cut 20–400 Hz, 4 bant parametrik; 1. ve 4. bandın tipi değişir (LShv / HShv / HCut).', 'Kanal: Low Cut 20–400 Hz, 4 Bänder; Band 1/4 umschaltbar (LShv / HShv / HCut).', 'Channel: Low Cut 20–400 Hz, 4-band PEQ; bands 1/4 switchable (LShv / HShv / HCut).'), n3('Ana çıkışta 6 bant PEQ ve FX yuvasında 31 bant GEQ.', 'Main: 6-Band-PEQ, GEQ im FX-Slot.', 'Main: 6-band PEQ, GEQ in an FX slot.')],
  },
  {
    id: 'mr12', name: 'Midas MR12', defIds: ['midas-mr12'], mic: 4, line: 8, aux: 2, fx: 4,
    hpfMax: 400, hpfSlope: false, lpf: 'band4', xair: true, eqGain: 15, deess: 'fx',
    automix: n3('Automix (konuşma mikrofonları)', 'Automix (Sprechermikros)', 'Automix (speech mics)'),
    app: n3('MIDAS M AIR / Mixing Station', 'MIDAS M AIR / Mixing Station', 'MIDAS M AIR / Mixing Station'),
    scene: n3('Snapshot kaydet', 'Snapshot speichern', 'Save snapshot'),
    usb: n3('USB stereo kayıt', 'USB-Stereoaufnahme', 'USB stereo recording'),
    names: { gain: n3('Gain (preamp)', 'Gain (Preamp)', 'Gain (preamp)'), hpf: n3('Low Cut', 'Low Cut', 'Low Cut'), eq: n3('EQ (4 bant)', 'EQ (4 Bänder)', 'EQ (4 bands)'), gate: n3('Gate', 'Gate', 'Gate'), comp: n3('Dyn (kompresör)', 'Dyn (Kompressor)', 'Dyn (compressor)'), fx: n3('FX gönder', 'FX-Send', 'FX send') },
    extras: [n3('Sadece 4 mikrofon ön amfisi var: kalabalık grupta vokaller buraya, Pa5X / elektro saz hat girişlerine.', 'Nur 4 Mikrofon-Preamps: Gesang dorthin, Keyboard / E-Saz auf Line.', 'Only 4 mic preamps: vocals there, keyboard / electric saz on line inputs.')],
  },
  {
    id: 'cq20b', name: 'Allen & Heath CQ-20B', defIds: ['ah-cq20b', 'ah-cq18t'], mic: 16, line: 8, aux: 6, fx: 4,
    hpfMax: 1000, hpfSlope: false, lpf: 'none', xair: false, eqGain: 15, deess: 'none',
    automix: n3('Otomatik mikrofon mikseri (AMM) — tüm girişlerde', 'Automatischer Mikrofonmixer (AMM)', 'Automatic Mic Mixer (AMM)'),
    fbAssist: n3('Feedback Assistant (çıkış başına 16 filtre)', 'Feedback Assistant (16 Filter je Ausgang)', 'Feedback Assistant (16 filters per output)'),
    gainAssist: n3('Gain Assistant (kazancı kendisi ayarlar)', 'Gain Assistant', 'Gain Assistant'),
    app: n3('CQ MixPad (Expert modunda tam ayar)', 'CQ MixPad (Expert-Modus)', 'CQ MixPad (Expert mode)'),
    scene: n3('Scene kaydet', 'Scene speichern', 'Save scene'),
    usb: n3('USB ses / SD kayıt', 'USB-Audio / SD-Aufnahme', 'USB audio / SD recording'),
    names: { gain: n3('Gain', 'Gain', 'Gain'), hpf: n3('HPF', 'HPF', 'HPF'), eq: n3('PEQ (4 bant)', 'PEQ (4 Bänder)', 'PEQ (4 bands)'), gate: n3('Gate', 'Gate', 'Gate'), comp: n3('Compressor', 'Kompressor', 'Compressor'), fx: n3('FX gönder', 'FX-Send', 'FX send') },
    extras: [n3('16 mikrofon/hat girişi + stereo hat girişleri; 6 monitör çıkışı.', '16 Mic/Line + Stereo-Line; 6 Monitorwege.', '16 mic/line + stereo line inputs; 6 monitor outs.'), n3('Quick/Standard modunda bazı ayarlar gizlidir: EQ için Expert moduna geç.', 'Im Quick/Standard-Modus sind Parameter versteckt: Expert-Modus.', 'Quick/Standard modes hide parameters: use Expert mode.')],
  },
  {
    id: 'dm3', name: 'Yamaha DM3', defIds: ['yam-dm3'], mic: 16, line: 2, aux: 6, fx: 2,
    hpfMax: 600, hpfSlope: false, lpf: 'none', xair: false, eqGain: 18, deess: 'none',
    app: n3('DM3 Editor / DM3 StageMix', 'DM3 Editor / StageMix', 'DM3 Editor / StageMix'),
    scene: n3('Scene kaydet', 'Scene speichern', 'Save scene'),
    usb: n3('18×18 USB ses kartı', '18×18 USB-Audio', '18×18 USB audio'),
    names: { gain: n3('Gain', 'Gain', 'Gain'), hpf: n3('HPF', 'HPF', 'HPF'), eq: n3('PEQ (4 bant)', 'PEQ (4 Bänder)', 'PEQ (4 bands)'), gate: n3('Dynamics 1 (Gate)', 'Dynamics 1 (Gate)', 'Dynamics 1 (Gate)'), comp: n3('Dynamics 2 (Comp)', 'Dynamics 2 (Comp)', 'Dynamics 2 (Comp)'), fx: n3('FX gönder', 'FX-Send', 'FX send') },
    extras: [n3('16 mikrofon/hat girişi; HPF 20–600 Hz; PEQ ekranında RTA açılabilir — bu öneriyi onunla karşılaştır.', '16 Mic/Line; HPF 20–600 Hz; RTA im PEQ-Bild.', '16 mic/line; HPF 20–600 Hz; RTA overlay on the PEQ screen.'), n3('Girişte gecikme (delay) var: davul / hoparlör hizası için.', 'Eingangs-Delay vorhanden.', 'Input delay available.')],
  },
  {
    id: 'other', name: 'Diğer mikser', defIds: [], mic: 16, line: 2, aux: 4, fx: 2,
    hpfMax: 400, hpfSlope: false, lpf: 'none', xair: false, eqGain: 15, deess: 'none',
    app: n3('Mikserin kendi ekranı / uygulaması', 'Pult / App', 'Mixer screen / app'),
    scene: n3('Sahneyi (scene) kaydet', 'Szene speichern', 'Save scene'),
    usb: n3('—', '—', '—'),
    names: { gain: n3('Gain', 'Gain', 'Gain'), hpf: n3('HPF / Low Cut', 'HPF / Low Cut', 'HPF / Low Cut'), eq: n3('EQ', 'EQ', 'EQ'), gate: n3('Gate', 'Gate', 'Gate'), comp: n3('Kompresör', 'Kompressor', 'Compressor'), fx: n3('FX gönder', 'FX-Send', 'FX send') },
    extras: [],
  },
];

export const MIXER_BY_ID: Record<MixerId, MixerSpec> = Object.fromEntries(MIXERS.map((m) => [m.id, m])) as Record<MixerId, MixerSpec>;

export function mixerFor(defId: string): MixerId | null {
  return MIXERS.find((m) => m.defIds.includes(defId))?.id ?? null;
}

// Q → oktav genişliği
export function qToOct(q: number): number {
  return (2 / Math.LN2) * Math.asinh(1 / (2 * q));
}
