import type { ConnFamily, Domain, L10n } from '../model/types';

// Sinyal alanları: çizim rengi, kablo etiket öneki, katman adı.
export const DOMAINS: Record<Domain, { name: L10n; color: string; prefix: string; dash?: string }> = {
  audio: { name: { tr: 'Ses (analog)', de: 'Audio (analog)', en: 'Audio (analog)' }, color: '#2563eb', prefix: 'A' },
  speaker: { name: { tr: 'Hoparlör hattı', de: 'Lautsprecherleitung', en: 'Speaker line' }, color: '#ea580c', prefix: 'S' },
  digital: { name: { tr: 'Dijital ses', de: 'Digital-Audio', en: 'Digital audio' }, color: '#0891b2', prefix: 'D' },
  network: { name: { tr: 'Ağ (Ethernet)', de: 'Netzwerk', en: 'Network' }, color: '#16a34a', prefix: 'N' },
  dmx: { name: { tr: 'DMX / ışık kontrol', de: 'DMX / Lichtsteuerung', en: 'DMX / lighting control' }, color: '#9333ea', prefix: 'X' },
  video: { name: { tr: 'Görüntü', de: 'Video', en: 'Video' }, color: '#db2777', prefix: 'V' },
  power: { name: { tr: 'Elektrik', de: 'Strom', en: 'Power' }, color: '#dc2626', prefix: 'P' },
  wireless: { name: { tr: 'Kablosuz', de: 'Funk', en: 'Wireless' }, color: '#64748b', prefix: 'W', dash: '6 4' },
  data: { name: { tr: 'USB / MIDI / veri', de: 'USB / MIDI / Daten', en: 'USB / MIDI / data' }, color: '#ca8a04', prefix: 'U' },
};

export const DOMAIN_ORDER: Domain[] = ['audio', 'speaker', 'digital', 'network', 'dmx', 'video', 'power', 'wireless', 'data'];

export const CONNECTORS: Record<ConnFamily, { name: L10n; short: string }> = {
  xlr: { name: 'XLR', short: 'XLR' },
  combo: { name: { tr: 'XLR/Jack kombo', de: 'XLR/Klinke Combo', en: 'XLR/jack combo' }, short: 'Combo' },
  jack: { name: { tr: 'Jack 6,3 mm', de: 'Klinke 6,3 mm', en: '1/4" jack' }, short: 'Jack' },
  jack35: { name: { tr: 'Jack 3,5 mm', de: 'Miniklinke 3,5 mm', en: '3.5 mm jack' }, short: '3,5' },
  rca: { name: { tr: 'RCA (Cinch)', de: 'Cinch (RCA)', en: 'RCA' }, short: 'RCA' },
  speakon: { name: 'speakON', short: 'NL4' },
  powercon: { name: 'powerCON', short: 'pCON' },
  true1: { name: 'powerCON TRUE1', short: 'TRUE1' },
  iec: { name: 'IEC (C13/C14)', short: 'IEC' },
  schuko: { name: 'Schuko', short: 'Schuko' },
  cee16: { name: { tr: 'CEE 16 A 230 V (mavi)', de: 'CEE 16 A 230 V (blau)', en: 'CEE 16 A 230 V (blue)' }, short: 'CEE16' },
  cee16r: { name: { tr: 'CEE 16 A 400 V (kırmızı)', de: 'CEE 16 A 400 V (rot)', en: 'CEE 16 A 400 V (red)' }, short: 'CEE16 3~' },
  cee32r: { name: { tr: 'CEE 32 A 400 V (kırmızı)', de: 'CEE 32 A 400 V (rot)', en: 'CEE 32 A 400 V (red)' }, short: 'CEE32 3~' },
  cee63r: { name: { tr: 'CEE 63 A 400 V (kırmızı)', de: 'CEE 63 A 400 V (rot)', en: 'CEE 63 A 400 V (red)' }, short: 'CEE63 3~' },
  powerlock: { name: 'Powerlock', short: 'PL' },
  rj45: { name: 'RJ45 / etherCON', short: 'RJ45' },
  dmx3: { name: { tr: 'DMX 3 pin', de: 'DMX 3-Pol', en: 'DMX 3-pin' }, short: 'DMX3' },
  dmx5: { name: { tr: 'DMX 5 pin', de: 'DMX 5-Pol', en: 'DMX 5-pin' }, short: 'DMX5' },
  hdmi: { name: 'HDMI', short: 'HDMI' },
  sdi: { name: 'SDI (BNC)', short: 'SDI' },
  bnc: { name: 'BNC', short: 'BNC' },
  usb: { name: 'USB', short: 'USB' },
  midi: { name: 'MIDI', short: 'MIDI' },
  optical: { name: { tr: 'Optik (TOSLINK/ADAT)', de: 'Optisch (TOSLINK/ADAT)', en: 'Optical (TOSLINK/ADAT)' }, short: 'OPT' },
  fiber: { name: { tr: 'Fiber (opticalCON)', de: 'Glasfaser (opticalCON)', en: 'Fiber (opticalCON)' }, short: 'Fiber' },
  multipin: { name: { tr: 'Multipin (multikor)', de: 'Multipin (Multicore)', en: 'Multipin (multicore)' }, short: 'Multi' },
  antenna: { name: { tr: 'Kablosuz (RF)', de: 'Funk (RF)', en: 'Wireless (RF)' }, short: 'RF' },
  terminal: { name: { tr: 'Klemens', de: 'Klemme', en: 'Terminal' }, short: 'Klem' },
};

export interface CableType {
  id: string;
  name: L10n;
  short: string;
  domain: Domain;
  ends: [ConnFamily[], ConnFamily[]];
  stock: number[]; // standart boylar (m)
  maxLen?: number; // önerilen en uzun
  mm2?: number; // kesit
  ampMax?: number; // taşıma (A)
  wireless?: boolean;
  kgPerM?: number;
  desc?: L10n;
}

const SIG = [0.5, 1, 2, 3, 5, 7.5, 10, 15, 20, 25, 30, 50];

export const CABLE_TYPES: CableType[] = [
  // — Ses —
  { id: 'xlr', name: { tr: 'XLR mikrofon/line kablosu', de: 'XLR Mikrofon-/Line-Kabel', en: 'XLR mic/line cable' }, short: 'XLR', domain: 'audio', ends: [['xlr', 'combo'], ['xlr', 'combo']], stock: SIG, maxLen: 100, kgPerM: 0.06 },
  { id: 'xlr-jack', name: { tr: 'XLR – Jack (TRS) kablo', de: 'XLR – Klinke (TRS)', en: 'XLR – TRS jack' }, short: 'XLR-Jack', domain: 'audio', ends: [['xlr', 'combo'], ['jack', 'combo']], stock: [1, 2, 3, 5, 10, 15], maxLen: 50, kgPerM: 0.06 },
  { id: 'jack', name: { tr: 'Jack – Jack (TRS, simetrik)', de: 'Klinke – Klinke (TRS, symmetrisch)', en: 'TRS – TRS (balanced)' }, short: 'TRS', domain: 'audio', ends: [['jack', 'combo'], ['jack', 'combo']], stock: [1, 2, 3, 5, 10], maxLen: 50, kgPerM: 0.05 },
  { id: 'inst', name: { tr: 'Enstrüman kablosu (TS)', de: 'Instrumentenkabel (TS)', en: 'Instrument cable (TS)' }, short: 'TS', domain: 'audio', ends: [['jack'], ['jack', 'combo']], stock: [3, 6, 9], maxLen: 9, kgPerM: 0.05, desc: { tr: 'Dengesiz, yüksek empedans — 6–9 m üstünde tiz kaybı. Uzaksa DI kullan.', de: 'Unsymmetrisch – über 6–9 m Höhenverlust. Sonst DI verwenden.', en: 'Unbalanced high-Z — treble loss above 6–9 m. Use a DI for longer runs.' } },
  { id: 'rca', name: { tr: 'RCA – RCA (cinch) stereo', de: 'Cinch – Cinch Stereo', en: 'RCA – RCA stereo' }, short: 'RCA', domain: 'audio', ends: [['rca'], ['rca']], stock: [0.5, 1, 1.5, 3, 5], maxLen: 5, kgPerM: 0.04 },
  { id: 'rca-xlr', name: { tr: 'RCA – XLR', de: 'Cinch – XLR', en: 'RCA – XLR' }, short: 'RCA-XLR', domain: 'audio', ends: [['rca'], ['xlr', 'combo']], stock: [1, 2, 3, 5], maxLen: 10, kgPerM: 0.05 },
  { id: 'rca-jack', name: { tr: 'RCA – Jack', de: 'Cinch – Klinke', en: 'RCA – jack' }, short: 'RCA-Jack', domain: 'audio', ends: [['rca'], ['jack', 'combo']], stock: [1, 2, 3, 5], maxLen: 10, kgPerM: 0.05 },
  { id: 'mini', name: { tr: '3,5 mm – 2× RCA/Jack/XLR (telefon, laptop)', de: '3,5 mm – 2× Cinch/Klinke/XLR', en: '3.5 mm – 2× RCA/jack/XLR' }, short: '3,5mm', domain: 'audio', ends: [['jack35'], ['rca', 'jack', 'combo', 'xlr', 'jack35']], stock: [1, 2, 3, 5], maxLen: 5, kgPerM: 0.04 },
  { id: 'multicore', name: { tr: 'Analog multikor (snake)', de: 'Analog-Multicore', en: 'Analog multicore (snake)' }, short: 'Multi', domain: 'audio', ends: [['multipin'], ['multipin']], stock: [15, 25, 30, 50], maxLen: 100, kgPerM: 0.35 },
  // — Hoparlör —
  { id: 'nl4-25', name: { tr: 'Hoparlör kablosu speakON 4×2,5 mm²', de: 'Lautsprecherkabel speakON 4×2,5 mm²', en: 'Speaker cable speakON 4×2.5 mm²' }, short: 'NL4 2,5', domain: 'speaker', ends: [['speakon'], ['speakon']], stock: [1, 3, 5, 10, 15, 20, 25, 30], mm2: 2.5, maxLen: 30, kgPerM: 0.16 },
  { id: 'nl4-4', name: { tr: 'Hoparlör kablosu speakON 4×4 mm²', de: 'Lautsprecherkabel speakON 4×4 mm²', en: 'Speaker cable speakON 4×4 mm²' }, short: 'NL4 4', domain: 'speaker', ends: [['speakon'], ['speakon']], stock: [5, 10, 15, 20, 30, 50], mm2: 4, maxLen: 50, kgPerM: 0.24 },
  { id: 'nl8', name: { tr: 'Hoparlör multikablo speakON NL8 8×2,5 mm²', de: 'Lautsprecher-Multikabel NL8 8×2,5 mm²', en: 'Speaker multicable NL8 8×2.5 mm²' }, short: 'NL8', domain: 'speaker', ends: [['speakon'], ['speakon']], stock: [5, 10, 15, 25, 30], mm2: 2.5, maxLen: 40, kgPerM: 0.32 },
  { id: 'spk-banana', name: { tr: 'Hoparlör kablosu (klemens/banana)', de: 'Lautsprecherkabel (Klemme/Banane)', en: 'Speaker cable (binding post)' }, short: 'Klem', domain: 'speaker', ends: [['terminal', 'speakon'], ['terminal', 'speakon']], stock: [5, 10, 20], mm2: 2.5, maxLen: 30, kgPerM: 0.1 },
  // — Dijital / ağ —
  { id: 'aes', name: { tr: 'AES/EBU dijital (110 Ω XLR)', de: 'AES/EBU digital (110 Ω XLR)', en: 'AES/EBU digital (110 Ω XLR)' }, short: 'AES', domain: 'digital', ends: [['xlr', 'combo'], ['xlr', 'combo']], stock: [1, 2, 5, 10, 20, 30, 50], maxLen: 100, kgPerM: 0.06 },
  { id: 'cat6', name: { tr: 'Cat6 / etherCON (Dante, AES50, ağ)', de: 'Cat6 / etherCON (Dante, AES50, Netzwerk)', en: 'Cat6 / etherCON (Dante, AES50, network)' }, short: 'Cat6', domain: 'network', ends: [['rj45'], ['rj45']], stock: [0.5, 1, 2, 5, 10, 15, 20, 30, 50, 75, 100], maxLen: 100, kgPerM: 0.06 },
  { id: 'fiber', name: { tr: 'Fiber opticalCON', de: 'Glasfaser opticalCON', en: 'Fiber opticalCON' }, short: 'Fiber', domain: 'network', ends: [['fiber'], ['fiber']], stock: [50, 100, 150, 300], maxLen: 2000, kgPerM: 0.05 },
  { id: 'optical', name: { tr: 'Optik TOSLINK/ADAT', de: 'Optisch TOSLINK/ADAT', en: 'Optical TOSLINK/ADAT' }, short: 'OPT', domain: 'digital', ends: [['optical'], ['optical']], stock: [1, 2, 5, 10], maxLen: 10, kgPerM: 0.03 },
  { id: 'bnc', name: { tr: 'BNC (word clock / MADI)', de: 'BNC (Wordclock / MADI)', en: 'BNC (word clock / MADI)' }, short: 'BNC', domain: 'digital', ends: [['bnc', 'sdi'], ['bnc', 'sdi']], stock: [1, 2, 5, 10, 25, 50], maxLen: 100, kgPerM: 0.05 },
  // — DMX —
  { id: 'dmx3', name: { tr: 'DMX kablosu 3 pin (110 Ω)', de: 'DMX-Kabel 3-Pol (110 Ω)', en: 'DMX cable 3-pin (110 Ω)' }, short: 'DMX3', domain: 'dmx', ends: [['dmx3', 'xlr'], ['dmx3', 'xlr']], stock: [1, 3, 5, 10, 15, 20, 30, 50], maxLen: 300, kgPerM: 0.06 },
  { id: 'dmx5', name: { tr: 'DMX kablosu 5 pin (110 Ω)', de: 'DMX-Kabel 5-Pol (110 Ω)', en: 'DMX cable 5-pin (110 Ω)' }, short: 'DMX5', domain: 'dmx', ends: [['dmx5'], ['dmx5']], stock: [1, 3, 5, 10, 20, 30], maxLen: 300, kgPerM: 0.07 },
  { id: 'dmx-35', name: { tr: 'DMX adaptör 3 pin ↔ 5 pin', de: 'DMX-Adapter 3-Pol ↔ 5-Pol', en: 'DMX adapter 3-pin ↔ 5-pin' }, short: 'DMX 3↔5', domain: 'dmx', ends: [['dmx3', 'xlr'], ['dmx5']], stock: [0.3, 1, 3], maxLen: 300, kgPerM: 0.06 },
  // — Görüntü —
  { id: 'hdmi', name: 'HDMI', short: 'HDMI', domain: 'video', ends: [['hdmi'], ['hdmi']], stock: [1, 2, 3, 5, 10, 15], maxLen: 15, kgPerM: 0.08 },
  { id: 'hdmi-aoc', name: { tr: 'HDMI fiber (aktif, uzun mesafe)', de: 'HDMI-Glasfaser (aktiv)', en: 'HDMI fiber (active)' }, short: 'HDMI-AOC', domain: 'video', ends: [['hdmi'], ['hdmi']], stock: [10, 20, 30, 50, 100], maxLen: 100, kgPerM: 0.04 },
  { id: 'sdi', name: { tr: 'SDI video (75 Ω BNC)', de: 'SDI-Video (75 Ω BNC)', en: 'SDI video (75 Ω BNC)' }, short: 'SDI', domain: 'video', ends: [['sdi', 'bnc'], ['sdi', 'bnc']], stock: [1, 5, 10, 25, 50, 100], maxLen: 100, kgPerM: 0.06 },
  // — Veri —
  { id: 'usb', name: 'USB', short: 'USB', domain: 'data', ends: [['usb'], ['usb']], stock: [1, 2, 3, 5], maxLen: 5, kgPerM: 0.04 },
  { id: 'usb-act', name: { tr: 'USB aktif uzatma', de: 'USB aktive Verlängerung', en: 'USB active extension' }, short: 'USB+', domain: 'data', ends: [['usb'], ['usb']], stock: [5, 10, 15, 20], maxLen: 20, kgPerM: 0.05 },
  { id: 'midi', name: 'MIDI 5 pin', short: 'MIDI', domain: 'data', ends: [['midi'], ['midi']], stock: [1, 3, 5, 10], maxLen: 15, kgPerM: 0.04 },
  // — Elektrik —
  { id: 'schuko-15', name: { tr: 'Schuko uzatma 3G1,5', de: 'Schuko-Verlängerung H07RN-F 3G1,5', en: 'Schuko extension 3G1.5' }, short: 'Schuko 1,5', domain: 'power', ends: [['schuko'], ['schuko']], stock: [3, 5, 10, 15, 25], mm2: 1.5, ampMax: 16, maxLen: 50, kgPerM: 0.13 },
  { id: 'schuko-25', name: { tr: 'Schuko uzatma 3G2,5 (uzun hat)', de: 'Schuko-Verlängerung H07RN-F 3G2,5', en: 'Schuko extension 3G2.5' }, short: 'Schuko 2,5', domain: 'power', ends: [['schuko'], ['schuko']], stock: [10, 25, 50], mm2: 2.5, ampMax: 16, maxLen: 80, kgPerM: 0.18 },
  { id: 'reel', name: { tr: 'Kablo makarası (Schuko, tam açılmalı)', de: 'Kabeltrommel (Schuko, ganz abrollen)', en: 'Cable reel (Schuko, unwind fully)' }, short: 'Makara', domain: 'power', ends: [['schuko'], ['schuko']], stock: [25, 50], mm2: 1.5, ampMax: 16, maxLen: 50, kgPerM: 0.2, desc: { tr: 'Isınma riski: makarayı tamamen aç.', de: 'Überhitzungsgefahr: Trommel ganz abrollen.', en: 'Overheating risk: always unwind fully.' } },
  { id: 'schuko-iec', name: { tr: 'Güç kablosu Schuko – IEC (C13)', de: 'Kaltgerätekabel Schuko – C13', en: 'Power cord Schuko – IEC C13' }, short: 'IEC', domain: 'power', ends: [['schuko'], ['iec']], stock: [1.5, 2, 3, 5], mm2: 1.0, ampMax: 10, maxLen: 5, kgPerM: 0.1 },
  { id: 'schuko-pcon', name: { tr: 'Güç kablosu Schuko – powerCON', de: 'Netzkabel Schuko – powerCON', en: 'Power cord Schuko – powerCON' }, short: 'pCON', domain: 'power', ends: [['schuko'], ['powercon']], stock: [1.5, 3, 5, 10], mm2: 1.5, ampMax: 16, maxLen: 25, kgPerM: 0.13 },
  { id: 'pcon-link', name: { tr: 'powerCON link (gri → mavi)', de: 'powerCON Link (grau → blau)', en: 'powerCON link (grey → blue)' }, short: 'pCON link', domain: 'power', ends: [['powercon'], ['powercon']], stock: [0.5, 1, 1.5, 3, 5, 10], mm2: 1.5, ampMax: 16, maxLen: 25, kgPerM: 0.13 },
  { id: 'schuko-true1', name: { tr: 'Güç kablosu Schuko – TRUE1', de: 'Netzkabel Schuko – TRUE1', en: 'Power cord Schuko – TRUE1' }, short: 'TRUE1', domain: 'power', ends: [['schuko'], ['true1']], stock: [1.5, 3, 5, 10], mm2: 1.5, ampMax: 16, maxLen: 25, kgPerM: 0.13 },
  { id: 'true1-link', name: { tr: 'TRUE1 link', de: 'TRUE1 Link', en: 'TRUE1 link' }, short: 'TRUE1 link', domain: 'power', ends: [['true1'], ['true1']], stock: [0.5, 1, 1.5, 3, 5, 10], mm2: 1.5, ampMax: 16, maxLen: 25, kgPerM: 0.13 },
  { id: 'cee16', name: { tr: 'CEE 16 A mavi uzatma 3G2,5', de: 'CEE 16 A blau 3G2,5', en: 'CEE 16 A blue 3G2.5' }, short: 'CEE16', domain: 'power', ends: [['cee16'], ['cee16']], stock: [5, 10, 25, 50], mm2: 2.5, ampMax: 16, maxLen: 80, kgPerM: 0.2 },
  { id: 'cee16-schuko', name: { tr: 'Adaptör CEE 16 A mavi → Schuko', de: 'Adapter CEE 16 A blau → Schuko', en: 'Adapter CEE 16 A blue → Schuko' }, short: 'CEE→Schuko', domain: 'power', ends: [['cee16'], ['schuko']], stock: [0.5, 1.5], mm2: 2.5, ampMax: 16, maxLen: 3, kgPerM: 0.2 },
  { id: 'cee16r', name: { tr: 'CEE 16 A kırmızı 5G2,5 (3 faz)', de: 'CEE 16 A rot 5G2,5', en: 'CEE 16 A red 5G2.5' }, short: 'CEE16 3~', domain: 'power', ends: [['cee16r'], ['cee16r']], stock: [5, 10, 25, 50], mm2: 2.5, ampMax: 16, maxLen: 100, kgPerM: 0.3 },
  { id: 'cee32r', name: { tr: 'CEE 32 A kırmızı 5G6 (3 faz)', de: 'CEE 32 A rot 5G6', en: 'CEE 32 A red 5G6' }, short: 'CEE32 3~', domain: 'power', ends: [['cee32r'], ['cee32r']], stock: [5, 10, 25, 50], mm2: 6, ampMax: 32, maxLen: 100, kgPerM: 0.65 },
  { id: 'cee63r', name: { tr: 'CEE 63 A kırmızı 5G16 (3 faz)', de: 'CEE 63 A rot 5G16', en: 'CEE 63 A red 5G16' }, short: 'CEE63 3~', domain: 'power', ends: [['cee63r'], ['cee63r']], stock: [10, 25, 50], mm2: 16, ampMax: 63, maxLen: 150, kgPerM: 1.5 },
  { id: 'plug', name: { tr: 'Doğrudan takılır (kablo yok)', de: 'Direkt gesteckt (kein Kabel)', en: 'Plugged directly (no cable)' }, short: 'direkt', domain: 'power', ends: [[], []], stock: [0], maxLen: 0 },
  { id: 'cee32-16', name: { tr: 'Adaptör CEE 32 A → CEE 16 A (kırmızı)', de: 'Adapter CEE 32 A → 16 A (rot)', en: 'Adapter CEE 32 A → 16 A (red)' }, short: '32→16', domain: 'power', ends: [['cee32r'], ['cee16r']], stock: [0.5, 1.5], mm2: 2.5, ampMax: 16, maxLen: 3, kgPerM: 0.3 },
  { id: 'powerlock', name: { tr: 'Powerlock tek damar seti (125 A+)', de: 'Powerlock Einleiter-Satz (125 A+)', en: 'Powerlock single-core set (125 A+)' }, short: 'Powerlock', domain: 'power', ends: [['powerlock'], ['powerlock']], stock: [10, 25, 50], mm2: 35, ampMax: 125, maxLen: 150, kgPerM: 2 },
  // — Kablosuz —
  { id: 'rf', name: { tr: 'Kablosuz bağlantı (RF)', de: 'Funkstrecke (RF)', en: 'Wireless link (RF)' }, short: 'RF', domain: 'wireless', ends: [['antenna'], ['antenna']], stock: [], wireless: true },
  // — Genel —
  { id: 'generic', name: { tr: 'Diğer / özel kablo', de: 'Sonstiges Kabel', en: 'Other / custom cable' }, short: '?', domain: 'audio', ends: [[], []], stock: [1, 2, 3, 5, 10, 15, 20, 30, 50] },
];

export const CABLE_BY_ID: Record<string, CableType> = Object.fromEntries(CABLE_TYPES.map((c) => [c.id, c]));

export function cableType(id: string): CableType {
  return CABLE_BY_ID[id] || CABLE_BY_ID.generic;
}

// Port konnektörü kablo ucuna fiziksel olarak uyuyor mu?
export function connFits(port: ConnFamily, end: ConnFamily[]): boolean {
  if (end.length === 0) return true; // genel kablo
  if (end.includes(port)) return true;
  if (port === 'combo') return end.includes('xlr') || end.includes('jack');
  if (port === 'dmx3') return end.includes('xlr');
  if (port === 'xlr') return end.includes('dmx3') || end.includes('combo');
  if (port === 'sdi') return end.includes('bnc');
  return false;
}

// a: çıkış (kaynak) tarafı, b: giriş tarafı. Elektrik kabloları yönlüdür (priz → fiş).
export function cableFits(ct: CableType, a: ConnFamily, b: ConnFamily): boolean {
  if (ct.id === 'plug') return a === b; // fiş prize doğrudan: aynı konnektör
  if (ct.domain === 'power') return connFits(a, ct.ends[0]) && connFits(b, ct.ends[1]);
  return (connFits(a, ct.ends[0]) && connFits(b, ct.ends[1])) || (connFits(a, ct.ends[1]) && connFits(b, ct.ends[0]));
}

// Standart boylardan uygun olanı seç; yoksa 5 m'ye yuvarla.
export function stockLength(ct: CableType, need: number): number {
  if (ct.wireless) return 0;
  for (const s of ct.stock) if (s >= need - 1e-6) return s;
  return Math.ceil(need / 5) * 5;
}
