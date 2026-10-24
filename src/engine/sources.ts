// Kanal EQ bilgi tabanı: ses / enstrüman tipleri, frekans bölgeleri, başlangıç ayarları, mikrofon tipleri.
// Değerler canlı ses pratiğinden derlenmiş başlangıç noktalarıdır; kulak ve ölçümle son karar verilir.
import type { L10n } from '../model/types';

const n3 = (tr: string, de: string, en: string): L10n => ({ tr, de, en });

export type SourceGroup = 'vocal' | 'string' | 'wind' | 'perc' | 'drums' | 'keys' | 'other';

export type RegionKey =
  | 'rumble'
  | 'boom'
  | 'body'
  | 'warmth'
  | 'mud'
  | 'boxy'
  | 'nasal'
  | 'honk'
  | 'buzz'
  | 'presence'
  | 'string'
  | 'attack'
  | 'click'
  | 'harsh'
  | 'sibilance'
  | 'breath'
  | 'air';

// Bölgenin adı ve kısınca / açınca ne olur
export const REGIONS: Record<RegionKey, { name: L10n; cut: L10n; boost: L10n; color: string }> = {
  rumble: { name: n3('Uğultu', 'Rumpeln', 'Rumble'), cut: n3('sahne uğultusu ve titreşim gider', 'Rumpeln verschwindet', 'removes rumble'), boost: n3('', '', ''), color: '#64748b' },
  boom: { name: n3('Gümleme', 'Dröhnen', 'Boom'), cut: n3('gümleme ve yakınlık etkisi azalır', 'weniger Dröhnen / Nahbesprechung', 'less boom / proximity'), boost: n3('dolgunluk artar', 'mehr Fülle', 'more fullness'), color: '#7c3aed' },
  body: { name: n3('Gövde', 'Körper', 'Body'), cut: n3('ses incelir, yer açılır', 'schlanker, mehr Platz', 'thinner, makes room'), boost: n3('ses dolgunlaşır', 'voller', 'fuller'), color: '#6d28d9' },
  warmth: { name: n3('Sıcaklık', 'Wärme', 'Warmth'), cut: n3('ses incelir', 'dünner', 'thinner'), boost: n3('ses ısınır, dolgunlaşır', 'wärmer', 'warmer'), color: '#a855f7' },
  mud: { name: n3('Boğukluk', 'Mulm', 'Mud'), cut: n3('boğukluk gider, ses açılır', 'Mulm weg, klarer', 'clears the mud'), boost: n3('ses kalınlaşır (dikkat: boğar)', 'dicker (Vorsicht: mulmig)', 'thicker (careful: muddy)'), color: '#b45309' },
  boxy: { name: n3('Kutu sesi', 'Pappig', 'Boxy'), cut: n3('karton / kutu sesi gider', 'weniger pappig', 'less boxy'), boost: n3('', '', ''), color: '#c2410c' },
  nasal: { name: n3('Genizden', 'Näselnd', 'Nasal'), cut: n3('genizden / telefon gibi ses azalır', 'weniger näselnd', 'less nasal'), boost: n3('ses öne çıkar (dikkat: genizden)', 'präsenter (Vorsicht: näselnd)', 'more forward (careful: nasal)'), color: '#ea580c' },
  honk: { name: n3('Korna sesi', 'Tröten', 'Honk'), cut: n3('korna / burun sesi azalır', 'weniger tröten', 'less honk'), boost: n3('', '', ''), color: '#f97316' },
  buzz: { name: n3('Kamış vızıltısı', 'Rohrblatt-Schnarren', 'Reed buzz'), cut: n3('vızıltı yumuşar', 'weicher', 'softer buzz'), boost: n3('karakter artar', 'mehr Charakter', 'more character'), color: '#f59e0b' },
  presence: { name: n3('Netlik', 'Präsenz', 'Presence'), cut: n3('ses yumuşar, geri çekilir (vokale yer açar)', 'weicher, macht Platz für Gesang', 'softer, makes room for vocals'), boost: n3('sözler ve ses netleşir, öne çıkar', 'klarer, verständlicher', 'clearer, more intelligible'), color: '#16a34a' },
  string: { name: n3('Tel / mızrap', 'Saiten / Anschlag', 'Strings / pick'), cut: n3('mızrap sertliği azalır', 'weniger Anschlaghärte', 'less pick harshness'), boost: n3('tel sesi ve tını açılır', 'Saiten klarer', 'more string detail'), color: '#15803d' },
  attack: { name: n3('Vuruş', 'Attack', 'Attack'), cut: n3('vuruş yumuşar', 'weicher', 'softer attack'), boost: n3('vuruş netleşir', 'mehr Attack', 'more attack'), color: '#0d9488' },
  click: { name: n3('Tık', 'Kick-Klick', 'Click'), cut: n3('tık azalır', 'weniger Klick', 'less click'), boost: n3('pedal tıkı duyulur', 'Klick hörbar', 'audible click'), color: '#0891b2' },
  harsh: { name: n3('Sertlik', 'Härte', 'Harshness'), cut: n3('kulak tırmalayan sertlik gider', 'weniger hart', 'less harsh'), boost: n3('', '', ''), color: '#dc2626' },
  sibilance: { name: n3('Tıslama (s, ş)', 'Zischlaute', 'Sibilance'), cut: n3('s, ş tıslaması azalır', 'weniger Zischen', 'less hiss on s'), boost: n3('', '', ''), color: '#e11d48' },
  breath: { name: n3('Nefes', 'Atem', 'Breath'), cut: n3('nefes sesi azalır', 'weniger Atem', 'less breath'), boost: n3('nefes ve doğallık artar', 'mehr Luft', 'more breath'), color: '#0ea5e9' },
  air: { name: n3('Hava / parlaklık', 'Luft / Glanz', 'Air'), cut: n3('ses kararır, tıslama azalır', 'dunkler', 'darker'), boost: n3('parlaklık ve hava gelir', 'mehr Glanz', 'more air'), color: '#2563eb' },
};

export type MicType = 'dyn' | 'dyn-sc' | 'cond' | 'headset' | 'lav' | 'clip' | 'inst-dyn' | 'sdc' | 'ldc' | 'di';

export const MICS: Record<MicType, { name: L10n; phantom: boolean; tip?: L10n }> = {
  dyn: { name: n3('Dinamik el mikrofonu (SM58 vb.)', 'Dynamisches Handmikro (SM58)', 'Dynamic handheld (SM58)'), phantom: false, tip: n3('Monitör tam arkasında (kardioid).', 'Monitor direkt dahinter (Niere).', 'Monitor directly behind (cardioid).') },
  'dyn-sc': { name: n3('Süperkardioid el mikrofonu (Beta 58A, e945)', 'Superniere (Beta 58A, e945)', 'Supercardioid (Beta 58A, e945)'), phantom: false, tip: n3('Monitörü tam arkaya değil, iki yana çapraz (≈120°) koy.', 'Monitore schräg seitlich (≈120°), nicht direkt dahinter.', 'Put monitors at ≈120° to the sides, not directly behind.') },
  cond: { name: n3('Kondenser el mikrofonu (KSM9, e965, Beta 87A)', 'Kondensator-Handmikro (KSM9, e965)', 'Condenser handheld (KSM9, e965)'), phantom: true, tip: n3('Kablosuzsa pil besler; kabloluysa +48V aç.', 'Funk: Batterie; Kabel: +48 V an.', 'Wireless: battery; wired: +48 V on.') },
  headset: { name: n3('Kafa mikrofonu (headset)', 'Headset', 'Headset'), phantom: false, tip: n3('Kapsülü ağız kenarına 1–2 cm koy, nefesin önüne değil.', 'Kapsel 1–2 cm neben den Mundwinkel, nicht in den Atem.', 'Capsule 1–2 cm beside the mouth corner, out of the breath.') },
  lav: { name: n3('Yaka mikrofonu', 'Lavalier', 'Lavalier'), phantom: false, tip: n3('Göğüs ortasına, çeneden bir karış aşağı; kumaş sürtmesin.', 'Brustmitte, eine Handbreit unter dem Kinn; keine Reibung.', 'Mid-chest, a hand below the chin; no rubbing.') },
  clip: { name: n3('Klipsli enstrüman kondenseri', 'Clip-Kondensator', 'Clip-on condenser'), phantom: true },
  'inst-dyn': { name: n3('Dinamik enstrüman mikrofonu (SM57)', 'Dynamisches Instrumentenmikro (SM57)', 'Dynamic instrument mic (SM57)'), phantom: false },
  sdc: { name: n3('Küçük diyaframlı kondenser (SM81)', 'Kleinmembran-Kondensator (SM81)', 'Small-diaphragm condenser (SM81)'), phantom: true },
  ldc: { name: n3('Geniş diyaframlı kondenser (C414)', 'Großmembran-Kondensator (C414)', 'Large-diaphragm condenser (C414)'), phantom: true },
  di: { name: n3('DI kutusu / hat girişi', 'DI-Box / Line', 'DI box / line'), phantom: false, tip: n3('Pasif DI +48V istemez; aktif DI ister. Vınlama olursa DI üzerindeki GROUND LIFT.', 'Passive DI ohne, aktive mit +48 V. Brummen: Ground Lift.', 'Passive DI needs no phantom, active DI does. Hum: ground lift.') },
};

export interface PresetMove {
  f: number;
  gain: number;
  q: number;
  type?: 'bell' | 'lshelf' | 'hshelf';
  why: RegionKey;
}

export interface DynAdvice {
  ratio: number;
  gr: [number, number]; // en yüksek yerde azaltma (dB)
  attack: number; // ms
  release: number; // ms
}

export type FxKind = 'vocal' | 'speech' | 'inst' | 'perc' | 'none';

export type SourceId =
  | 'voc-m'
  | 'voc-f'
  | 'speech'
  | 'choir'
  | 'baglama-long'
  | 'baglama-short'
  | 'baglama-el'
  | 'ud'
  | 'kanun'
  | 'keman'
  | 'kemence'
  | 'gtr-ac'
  | 'gtr-el'
  | 'bass'
  | 'klarnet'
  | 'mey'
  | 'ney'
  | 'zurna'
  | 'kaval'
  | 'tulum'
  | 'darbuka'
  | 'bendir'
  | 'davul'
  | 'kick'
  | 'snare'
  | 'tom'
  | 'oh'
  | 'piano'
  | 'keys'
  | 'pa-lr'
  | 'pa-bass'
  | 'pa-drums'
  | 'pa-lead'
  | 'pa-chord'
  | 'dj';

export interface SourceDef {
  id: SourceId;
  group: SourceGroup;
  name: L10n;
  f0: [number, number]; // temel frekans aralığı (Hz)
  core: [number, number]; // ölçümde seviye referansı alınan aralık
  hpf: number; // başlangıç HPF (Hz); vokalde şarkı için
  hpfSpeech?: number;
  lpf?: number;
  regions: { key: RegionKey; lo: number; hi: number }[];
  target: [number, number][]; // iyi ton dengesi (1/6 oktav bant gücü, dB, göreli)
  start: PresetMove[]; // dinlemeden önce başlangıç ayarı
  boost: [number, number][]; // yükseltmeye izin verilen aralıklar
  maxBoost: number;
  key: { lo: number; hi: number; w: number }[]; // mix içinde önemli aralıklar (frekans haritası)
  prio: number; // mix önceliği (vokal 10)
  comp?: DynAdvice;
  gate?: boolean;
  deess?: boolean;
  fx: FxKind;
  mic: MicType;
  loud?: boolean; // akustik olarak çok güçlü (zurna, davul): PA'dan az ver
  tips: L10n[];
}

// Ortak hedef şekilleri
const VOC_M: [number, number][] = [[60, -18], [90, -9], [120, -3], [160, 0], [250, 0], [400, -1], [630, -2.5], [1000, -4], [1600, -5], [2500, -5.5], [3150, -5.5], [4000, -6.5], [6300, -10], [8000, -12], [10000, -14], [12500, -16], [16000, -20]];
const VOC_F: [number, number][] = [[100, -18], [150, -9], [200, -3], [250, 0], [400, 0], [630, -1], [1000, -3], [1600, -4.5], [2500, -5], [3150, -5], [4000, -6], [6300, -9.5], [8000, -11.5], [10000, -13.5], [12500, -16], [16000, -20]];
const PLUCK: [number, number][] = [[80, -16], [120, -7], [180, -1], [250, 0], [400, -1], [700, -3], [1200, -4], [2000, -4.5], [3150, -5], [5000, -7], [8000, -11], [12000, -15], [16000, -19]];
const WIND: [number, number][] = [[100, -18], [160, -8], [250, -2], [400, 0], [630, 0], [1000, -2], [1600, -4], [2500, -5], [4000, -7], [6300, -10], [10000, -14], [16000, -20]];
const DRUM_LOW: [number, number][] = [[30, -8], [50, 0], [80, 0], [125, -3], [250, -7], [500, -10], [1000, -12], [2000, -12], [4000, -12], [8000, -16], [16000, -22]];
const BROAD: [number, number][] = [[30, -6], [60, 0], [125, 0], [250, -1], [500, -2], [1000, -3], [2000, -4], [4000, -5], [8000, -8], [16000, -14]];

const VOC_TIPS: L10n[] = [
  n3('Mikrofonu ağızdan 2–5 cm tut, tam karşıdan söyle. Çok yakın: boğuk; uzak: ince ve geri besleme.', 'Mikro 2–5 cm vor dem Mund, direkt hinein. Zu nah: mulmig; zu weit: dünn und Feedback.', 'Hold the mic 2–5 cm from the mouth, sing straight in. Too close: muddy; too far: thin and feedback.'),
  n3('Mikrofonun başını avuçlamasın: ses boğulur ve geri besleme yapar.', 'Mikrokopf nicht umgreifen: klingt mulmig und koppelt.', 'Do not cup the mic head: it muffles and feeds back.'),
  n3('Önce kişi şarkıdaki en yüksek yerini söylesin, gain buna göre; sonra EQ.', 'Erst die lauteste Stelle singen lassen und Gain einstellen, dann EQ.', 'Have them sing the loudest part first, set gain, then EQ.'),
];

export const SOURCES: SourceDef[] = [
  // ——— Vokal ———
  {
    id: 'voc-m', group: 'vocal', name: n3('Erkek vokal', 'Männlicher Gesang', 'Male vocal'),
    f0: [85, 400], core: [150, 3000], hpf: 90, hpfSpeech: 110,
    regions: [{ key: 'boom', lo: 80, hi: 160 }, { key: 'mud', lo: 200, hi: 450 }, { key: 'boxy', lo: 450, hi: 800 }, { key: 'nasal', lo: 800, hi: 1500 }, { key: 'presence', lo: 2000, hi: 4500 }, { key: 'sibilance', lo: 5000, hi: 8000 }, { key: 'air', lo: 10000, hi: 16000 }],
    target: VOC_M,
    start: [{ f: 300, gain: -2.5, q: 1.2, why: 'mud' }, { f: 3000, gain: 2, q: 1, why: 'presence' }, { f: 10000, gain: 1.5, q: 0.7, type: 'hshelf', why: 'air' }],
    boost: [[140, 260], [1800, 5500], [8000, 15000]], maxBoost: 4,
    key: [{ lo: 120, hi: 350, w: 0.6 }, { lo: 2000, hi: 4500, w: 1 }], prio: 10,
    comp: { ratio: 3, gr: [3, 6], attack: 10, release: 120 }, fx: 'vocal', mic: 'dyn', tips: VOC_TIPS,
  },
  {
    id: 'voc-f', group: 'vocal', name: n3('Kadın vokal', 'Weiblicher Gesang', 'Female vocal'),
    f0: [165, 1000], core: [250, 4000], hpf: 130, hpfSpeech: 160,
    regions: [{ key: 'boom', lo: 120, hi: 220 }, { key: 'mud', lo: 250, hi: 500 }, { key: 'boxy', lo: 500, hi: 900 }, { key: 'nasal', lo: 900, hi: 1600 }, { key: 'presence', lo: 2500, hi: 5000 }, { key: 'sibilance', lo: 6000, hi: 9500 }, { key: 'air', lo: 10000, hi: 16000 }],
    target: VOC_F,
    start: [{ f: 400, gain: -2, q: 1.2, why: 'mud' }, { f: 3500, gain: 1.5, q: 1.2, why: 'presence' }, { f: 12000, gain: 1, q: 0.7, type: 'hshelf', why: 'air' }],
    boost: [[200, 320], [2200, 5500], [9000, 15000]], maxBoost: 3.5,
    key: [{ lo: 200, hi: 500, w: 0.5 }, { lo: 2500, hi: 5000, w: 1 }], prio: 10,
    comp: { ratio: 3, gr: [3, 6], attack: 8, release: 120 }, deess: true, fx: 'vocal', mic: 'dyn', tips: VOC_TIPS,
  },
  {
    id: 'speech', group: 'vocal', name: n3('Anons / konuşma mikrofonu', 'Moderation / Sprache', 'Announcer / speech'),
    f0: [85, 300], core: [200, 4000], hpf: 120, hpfSpeech: 120,
    regions: [{ key: 'boom', lo: 80, hi: 180 }, { key: 'mud', lo: 200, hi: 450 }, { key: 'boxy', lo: 450, hi: 800 }, { key: 'nasal', lo: 800, hi: 1500 }, { key: 'presence', lo: 2000, hi: 4500 }, { key: 'sibilance', lo: 5000, hi: 9000 }],
    target: VOC_M,
    start: [{ f: 300, gain: -3, q: 1.2, why: 'mud' }, { f: 3000, gain: 3, q: 1, why: 'presence' }],
    boost: [[1800, 5000]], maxBoost: 5,
    key: [{ lo: 2000, hi: 4500, w: 1 }], prio: 10,
    comp: { ratio: 4, gr: [4, 8], attack: 5, release: 100 }, fx: 'speech', mic: 'dyn',
    tips: [n3('Konuşmada reverb kapalı: sözler net olsun.', 'Bei Sprache kein Hall.', 'No reverb on speech.'), n3('Konuşurken müziği 6–10 dB kıs (ya da ducking).', 'Musik beim Sprechen 6–10 dB absenken (Ducking).', 'Duck the music 6–10 dB while talking.')],
  },
  {
    id: 'choir', group: 'vocal', name: n3('Koro (karışık)', 'Chor (gemischt)', 'Choir (mixed)'),
    f0: [85, 1000], core: [200, 4000], hpf: 120,
    regions: [{ key: 'boom', lo: 80, hi: 160 }, { key: 'mud', lo: 200, hi: 450 }, { key: 'boxy', lo: 450, hi: 900 }, { key: 'presence', lo: 2500, hi: 5000 }, { key: 'sibilance', lo: 6000, hi: 9000 }, { key: 'air', lo: 10000, hi: 16000 }],
    target: [[80, -18], [120, -8], [160, -3], [250, 0], [400, 0], [630, -1.5], [1000, -3.5], [2000, -5], [3150, -5], [5000, -8], [8000, -11], [12000, -15], [16000, -19]],
    start: [{ f: 250, gain: -2, q: 1, why: 'mud' }, { f: 4000, gain: 2, q: 0.9, why: 'presence' }, { f: 12000, gain: 1.5, q: 0.7, type: 'hshelf', why: 'air' }],
    boost: [[2500, 6000], [9000, 15000]], maxBoost: 3,
    key: [{ lo: 250, hi: 600, w: 0.4 }, { lo: 2500, hi: 5000, w: 0.8 }], prio: 8,
    comp: { ratio: 2, gr: [2, 4], attack: 20, release: 200 }, deess: true, fx: 'vocal', mic: 'sdc',
    tips: [
      n3('10 kişiye 2–3 kondenser yeter: başların biraz üstünde, ağızlara doğru, 60–100 cm önde.', 'Für 10 Sänger 2–3 Kondensatoren: etwas über den Köpfen, 60–100 cm davor.', '2–3 condensers for 10 singers: slightly above heads, 60–100 cm in front.'),
      n3('3:1 kuralı: mikrofonlar arası mesafe, mikrofon–koro mesafesinin en az 3 katı olsun (faz iptali olmaz).', '3:1-Regel: Mikroabstand ≥ 3 × Abstand zum Chor.', '3:1 rule: spacing between mics ≥ 3 × mic-to-choir distance.'),
      n3('Koro mikrofonları uzaktan alır: monitörü düşük tut, geri besleme sınırı çabuk gelir.', 'Chormikros nehmen von weit ab: Monitor leise, Feedback kommt schnell.', 'Choir mics pick up from afar: keep monitors low.'),
    ],
  },
  // ——— Telli ———
  {
    id: 'baglama-long', group: 'string', name: n3('Bağlama (uzun sap)', 'Bağlama (langer Hals)', 'Bağlama (long neck)'),
    f0: [110, 1000], core: [150, 5000], hpf: 110,
    regions: [{ key: 'boom', lo: 80, hi: 150 }, { key: 'body', lo: 150, hi: 280 }, { key: 'mud', lo: 280, hi: 500 }, { key: 'boxy', lo: 500, hi: 900 }, { key: 'string', lo: 2000, hi: 5000 }, { key: 'air', lo: 8000, hi: 14000 }],
    target: PLUCK,
    start: [{ f: 350, gain: -2.5, q: 1.4, why: 'mud' }, { f: 3000, gain: 1.5, q: 1.2, why: 'string' }, { f: 8000, gain: 1, q: 0.7, type: 'hshelf', why: 'air' }],
    boost: [[150, 260], [2000, 5500], [7000, 13000]], maxBoost: 3,
    key: [{ lo: 150, hi: 300, w: 0.5 }, { lo: 2000, hi: 5000, w: 0.8 }], prio: 7,
    comp: { ratio: 2.5, gr: [2, 4], attack: 15, release: 150 }, fx: 'inst', mic: 'sdc',
    tips: [n3('Mikrofonu kapağa 20–30 cm, sapın gövdeye birleştiği yere doğru tut.', 'Mikro 20–30 cm vor die Decke, Richtung Hals-Korpus-Übergang.', 'Mic 20–30 cm from the top, aimed where neck meets body.'), n3('Mızrap sesi sertse 3–4 kHz civarını 1–2 dB kıs.', 'Hartes Plektrum: 3–4 kHz 1–2 dB absenken.', 'Harsh pick: cut 3–4 kHz by 1–2 dB.')],
  },
  {
    id: 'baglama-short', group: 'string', name: n3('Bağlama (kısa sap) / cura', 'Bağlama (kurzer Hals) / Cura', 'Bağlama (short neck) / cura'),
    f0: [150, 1300], core: [200, 6000], hpf: 140,
    regions: [{ key: 'body', lo: 180, hi: 350 }, { key: 'mud', lo: 350, hi: 600 }, { key: 'boxy', lo: 600, hi: 1000 }, { key: 'string', lo: 2500, hi: 6000 }, { key: 'harsh', lo: 3000, hi: 5000 }, { key: 'air', lo: 9000, hi: 15000 }],
    target: PLUCK.map(([f, d]) => [f * 1.3, d] as [number, number]),
    start: [{ f: 450, gain: -2, q: 1.4, why: 'mud' }, { f: 3500, gain: 1, q: 1.2, why: 'string' }, { f: 10000, gain: 1, q: 0.7, type: 'hshelf', why: 'air' }],
    boost: [[200, 330], [2500, 6000], [8000, 14000]], maxBoost: 3,
    key: [{ lo: 200, hi: 400, w: 0.4 }, { lo: 2500, hi: 6000, w: 0.8 }], prio: 7,
    comp: { ratio: 2.5, gr: [2, 4], attack: 15, release: 150 }, fx: 'inst', mic: 'sdc',
    tips: [n3('Kısa sap daha tiz ve keskin: 3–5 kHz sertse hafif kıs, gövdeyi (200–300 Hz) koru.', 'Kurzhals klingt heller: 3–5 kHz ggf. absenken, 200–300 Hz behalten.', 'Short neck is brighter: tame 3–5 kHz, keep 200–300 Hz.')],
  },
  {
    id: 'baglama-el', group: 'string', name: n3('Elektro bağlama (DI)', 'E-Bağlama (DI)', 'Electric bağlama (DI)'),
    f0: [110, 1300], core: [150, 5000], hpf: 100,
    regions: [{ key: 'boom', lo: 100, hi: 200 }, { key: 'mud', lo: 200, hi: 450 }, { key: 'nasal', lo: 800, hi: 1500 }, { key: 'harsh', lo: 2000, hi: 4000 }, { key: 'string', lo: 4000, hi: 7000 }, { key: 'air', lo: 8000, hi: 14000 }],
    target: PLUCK,
    start: [{ f: 250, gain: -2, q: 1.2, why: 'mud' }, { f: 1100, gain: -2, q: 2, why: 'nasal' }, { f: 5000, gain: 1.5, q: 1, why: 'string' }],
    boost: [[150, 250], [4000, 8000], [8000, 13000]], maxBoost: 3,
    key: [{ lo: 150, hi: 300, w: 0.5 }, { lo: 2000, hi: 5000, w: 0.8 }], prio: 7,
    comp: { ratio: 3, gr: [3, 5], attack: 10, release: 120 }, fx: 'inst', mic: 'di',
    tips: [n3('Manyetik/piezo çıkışı doğrudan mikser girişine değil, DI kutusuyla (ya da Hi-Z girişe) bağla.', 'Tonabnehmer über DI-Box (oder Hi-Z-Eingang) anschließen.', 'Connect the pickup via a DI box (or a Hi-Z input).'), n3('Piezo "kutu" sesi 1 kHz civarında: dar kes. Vınlama: DI üzerinde GROUND LIFT.', 'Piezo-Näseln um 1 kHz schmal absenken. Brummen: Ground Lift.', 'Piezo honk near 1 kHz: narrow cut. Hum: ground lift.')],
  },
  {
    id: 'ud', group: 'string', name: n3('Ud', 'Oud', 'Oud'),
    f0: [65, 700], core: [120, 4000], hpf: 80,
    regions: [{ key: 'boom', lo: 80, hi: 140 }, { key: 'body', lo: 140, hi: 250 }, { key: 'mud', lo: 250, hi: 450 }, { key: 'boxy', lo: 450, hi: 900 }, { key: 'string', lo: 2000, hi: 5000 }, { key: 'air', lo: 8000, hi: 13000 }],
    target: PLUCK.map(([f, d]) => [f * 0.85, d] as [number, number]),
    start: [{ f: 300, gain: -2, q: 1.2, why: 'mud' }, { f: 3000, gain: 1.5, q: 1, why: 'string' }],
    boost: [[120, 220], [2000, 5000], [7000, 12000]], maxBoost: 3,
    key: [{ lo: 120, hi: 300, w: 0.6 }, { lo: 2000, hi: 4500, w: 0.7 }], prio: 7,
    comp: { ratio: 2.5, gr: [2, 4], attack: 15, release: 150 }, fx: 'inst', mic: 'sdc',
    tips: [n3('Mikrofonu köprü ile kafes (gül) arasına 20–30 cm.', 'Mikro 20–30 cm zwischen Steg und Rosette.', 'Mic 20–30 cm between bridge and rosette.')],
  },
  {
    id: 'kanun', group: 'string', name: n3('Kanun', 'Kanun', 'Kanun'),
    f0: [100, 1500], core: [200, 6000], hpf: 120,
    regions: [{ key: 'body', lo: 150, hi: 300 }, { key: 'mud', lo: 300, hi: 500 }, { key: 'boxy', lo: 500, hi: 900 }, { key: 'string', lo: 2500, hi: 6000 }, { key: 'harsh', lo: 3000, hi: 5000 }, { key: 'air', lo: 9000, hi: 15000 }],
    target: PLUCK,
    start: [{ f: 350, gain: -2, q: 1.2, why: 'mud' }, { f: 10000, gain: 1, q: 0.7, type: 'hshelf', why: 'air' }],
    boost: [[150, 260], [2500, 6000], [8000, 14000]], maxBoost: 3,
    key: [{ lo: 200, hi: 400, w: 0.4 }, { lo: 2500, hi: 6000, w: 0.7 }], prio: 6,
    fx: 'inst', mic: 'sdc',
    tips: [n3('İki küçük kondenser (bas ve tiz telleri) ya da tek mikrofon 30–40 cm üstten.', 'Zwei Kleinmembraner (Bass/Diskant) oder eines 30–40 cm darüber.', 'Two small condensers (low/high strings) or one 30–40 cm above.')],
  },
  {
    id: 'keman', group: 'string', name: n3('Keman', 'Violine', 'Violin'),
    f0: [196, 3000], core: [300, 6000], hpf: 180,
    regions: [{ key: 'body', lo: 250, hi: 500 }, { key: 'nasal', lo: 800, hi: 1500 }, { key: 'harsh', lo: 2500, hi: 5000 }, { key: 'air', lo: 9000, hi: 15000 }],
    target: WIND.map(([f, d]) => [f * 1.2, d] as [number, number]),
    start: [{ f: 1000, gain: -1.5, q: 1.6, why: 'nasal' }, { f: 3000, gain: -2, q: 1.8, why: 'harsh' }, { f: 10000, gain: 1, q: 0.7, type: 'hshelf', why: 'air' }],
    boost: [[250, 450], [8000, 14000]], maxBoost: 2.5,
    key: [{ lo: 400, hi: 2500, w: 0.7 }], prio: 7,
    comp: { ratio: 2, gr: [2, 3], attack: 20, release: 150 }, fx: 'inst', mic: 'clip',
    tips: [n3('Klipsli kondenser köprünün üstüne, f deliğine doğru; yay sürtmesi sertse 2,5–4 kHz kıs.', 'Clip-Mikro über dem Steg zum f-Loch; Bogenkratzen: 2,5–4 kHz absenken.', 'Clip mic above the bridge toward the f-hole; scratchy: cut 2.5–4 kHz.')],
  },
  {
    id: 'kemence', group: 'string', name: n3('Kemençe', 'Kemençe', 'Kemençe'),
    f0: [300, 2500], core: [400, 6000], hpf: 250,
    regions: [{ key: 'body', lo: 300, hi: 600 }, { key: 'nasal', lo: 900, hi: 1600 }, { key: 'harsh', lo: 2000, hi: 4500 }, { key: 'air', lo: 9000, hi: 15000 }],
    target: WIND.map(([f, d]) => [f * 1.5, d] as [number, number]),
    start: [{ f: 3000, gain: -2.5, q: 1.6, why: 'harsh' }, { f: 1200, gain: -1, q: 1.6, why: 'nasal' }],
    boost: [[300, 500], [8000, 14000]], maxBoost: 2,
    key: [{ lo: 500, hi: 3000, w: 0.7 }], prio: 7, fx: 'inst', mic: 'clip',
    tips: [n3('Kemençe sert ve tizdir: 2–4 kHz kesmek çoğu zaman yeterli.', 'Kemençe klingt hart: 2–4 kHz absenken genügt meist.', 'Kemençe is harsh: cutting 2–4 kHz usually does it.')],
  },
  {
    id: 'gtr-ac', group: 'string', name: n3('Akustik gitar', 'Akustikgitarre', 'Acoustic guitar'),
    f0: [82, 1200], core: [120, 6000], hpf: 90,
    regions: [{ key: 'boom', lo: 90, hi: 200 }, { key: 'mud', lo: 200, hi: 350 }, { key: 'nasal', lo: 800, hi: 1300 }, { key: 'string', lo: 3000, hi: 7000 }, { key: 'air', lo: 9000, hi: 15000 }],
    target: PLUCK,
    start: [{ f: 200, gain: -2.5, q: 1.2, why: 'boom' }, { f: 1000, gain: -1.5, q: 2, why: 'nasal' }, { f: 5000, gain: 2, q: 0.9, why: 'string' }],
    boost: [[3000, 7000], [8000, 14000]], maxBoost: 3,
    key: [{ lo: 150, hi: 300, w: 0.4 }, { lo: 3000, hi: 7000, w: 0.6 }], prio: 5,
    comp: { ratio: 3, gr: [2, 5], attack: 15, release: 150 }, fx: 'inst', mic: 'di',
    tips: [n3('Eşlik yapıyorsa 2–4 kHz\'i 1–2 dB kıs: vokale yer aç.', 'Als Begleitung 2–4 kHz leicht absenken: Platz für Gesang.', 'When accompanying, cut 2–4 kHz a little to make room for vocals.')],
  },
  {
    id: 'gtr-el', group: 'string', name: n3('Elektro gitar (amfi)', 'E-Gitarre (Amp)', 'Electric guitar (amp)'),
    f0: [82, 1200], core: [150, 5000], hpf: 90, lpf: 8000,
    regions: [{ key: 'boom', lo: 80, hi: 150 }, { key: 'mud', lo: 200, hi: 350 }, { key: 'body', lo: 400, hi: 900 }, { key: 'presence', lo: 2000, hi: 4000 }, { key: 'harsh', lo: 4000, hi: 7000 }],
    target: [[80, -16], [120, -6], [200, -1], [400, 0], [800, 0], [1600, -1], [2500, -2], [4000, -5], [6300, -10], [8000, -16], [12000, -24]],
    start: [{ f: 250, gain: -2, q: 1.2, why: 'mud' }, { f: 3000, gain: 1, q: 1, why: 'presence' }],
    boost: [[400, 900], [2000, 4000]], maxBoost: 3,
    key: [{ lo: 400, hi: 2500, w: 0.6 }], prio: 6,
    fx: 'none', mic: 'inst-dyn',
    tips: [n3('SM57\'yi hoparlör konisinin kenarına, 2–5 cm. Ortaya doğru: daha parlak.', 'SM57 2–5 cm vor den Konusrand; zur Mitte: heller.', 'SM57 2–5 cm from the cone edge; toward the center: brighter.')],
  },
  {
    id: 'bass', group: 'string', name: n3('Bas gitar', 'E-Bass', 'Bass guitar'),
    f0: [41, 400], core: [50, 2000], hpf: 35,
    regions: [{ key: 'rumble', lo: 20, hi: 35 }, { key: 'body', lo: 60, hi: 110 }, { key: 'mud', lo: 200, hi: 300 }, { key: 'boxy', lo: 400, hi: 800 }, { key: 'attack', lo: 1500, hi: 3000 }],
    target: [[30, -6], [50, 0], [80, 0], [125, -2], [250, -5], [500, -8], [1000, -10], [2000, -12], [4000, -16], [8000, -22]],
    start: [{ f: 80, gain: 1.5, q: 1, why: 'body' }, { f: 250, gain: -2.5, q: 1.2, why: 'mud' }, { f: 2000, gain: 1.5, q: 1.2, why: 'attack' }],
    boost: [[50, 110], [1500, 3000]], maxBoost: 3,
    key: [{ lo: 40, hi: 110, w: 1 }, { lo: 1500, hi: 3000, w: 0.3 }], prio: 6,
    comp: { ratio: 4, gr: [4, 8], attack: 15, release: 150 }, fx: 'none', mic: 'di',
    tips: [n3('Bas ve davul/kick aynı yeri istemesin: biri 60–80 Hz, diğeri 90–120 Hz.', 'Bass und Kick nicht am selben Ort: einer 60–80, der andere 90–120 Hz.', 'Bass and kick should not share: one 60–80 Hz, the other 90–120 Hz.')],
  },
  // ——— Nefesli ———
  {
    id: 'klarnet', group: 'wind', name: n3('Klarnet', 'Klarinette', 'Clarinet'),
    f0: [147, 1600], core: [200, 5000], hpf: 150,
    regions: [{ key: 'body', lo: 200, hi: 450 }, { key: 'honk', lo: 800, hi: 1500 }, { key: 'presence', lo: 2000, hi: 3500 }, { key: 'harsh', lo: 3500, hi: 5500 }, { key: 'breath', lo: 6000, hi: 10000 }],
    target: WIND,
    start: [{ f: 300, gain: -1.5, q: 1, why: 'mud' }, { f: 1100, gain: -2, q: 1.8, why: 'honk' }, { f: 3000, gain: 1, q: 1.2, why: 'presence' }],
    boost: [[250, 450], [2000, 3500]], maxBoost: 2.5,
    key: [{ lo: 300, hi: 1500, w: 0.7 }, { lo: 2000, hi: 4000, w: 0.6 }], prio: 8,
    comp: { ratio: 2, gr: [2, 4], attack: 20, release: 150 }, fx: 'inst', mic: 'clip',
    tips: [n3('Klarnetin sesi zilden değil deliklerden çıkar: mikrofonu gövdenin ortasına 20–30 cm tut.', 'Klarinette klingt aus den Tonlöchern, nicht aus dem Trichter: Mikro 20–30 cm auf die Mitte.', 'The clarinet sounds from the tone holes, not the bell: mic 20–30 cm at the middle.'), n3('Tiz yerlerde sert çalarsa 3–4 kHz\'i 1–2 dB kıs.', 'Hart in der Höhe: 3–4 kHz leicht absenken.', 'Harsh up high: cut 3–4 kHz slightly.')],
  },
  {
    id: 'mey', group: 'wind', name: n3('Mey', 'Mey', 'Mey'),
    f0: [110, 700], core: [150, 4000], hpf: 100,
    regions: [{ key: 'body', lo: 150, hi: 400 }, { key: 'mud', lo: 300, hi: 500 }, { key: 'buzz', lo: 1000, hi: 2500 }, { key: 'presence', lo: 2500, hi: 4500 }],
    target: WIND.map(([f, d]) => [f * 0.75, d] as [number, number]),
    start: [{ f: 350, gain: -1.5, q: 1.2, why: 'mud' }, { f: 1800, gain: -1.5, q: 2, why: 'buzz' }, { f: 3500, gain: 1, q: 1, why: 'presence' }],
    boost: [[150, 300], [2500, 4500]], maxBoost: 2.5,
    key: [{ lo: 200, hi: 1000, w: 0.6 }], prio: 7,
    comp: { ratio: 2, gr: [2, 3], attack: 20, release: 150 }, fx: 'inst', mic: 'sdc',
    tips: [n3('Mey yumuşak ve kalındır: gövdeyi (150–300 Hz) koru, sadece boğuksa 300–400 Hz kıs.', 'Mey ist weich und tief: 150–300 Hz behalten.', 'Mey is soft and low: keep 150–300 Hz.')],
  },
  {
    id: 'ney', group: 'wind', name: n3('Ney', 'Ney', 'Ney'),
    f0: [250, 1400], core: [300, 6000], hpf: 200,
    regions: [{ key: 'body', lo: 300, hi: 800 }, { key: 'presence', lo: 2000, hi: 4000 }, { key: 'breath', lo: 4000, hi: 9000 }, { key: 'air', lo: 9000, hi: 14000 }],
    target: WIND.map(([f, d]) => [f * 1.4, d + (f > 4000 ? 2 : 0)] as [number, number]),
    start: [{ f: 2500, gain: 1.5, q: 1, why: 'presence' }, { f: 10000, gain: 1, q: 0.7, type: 'hshelf', why: 'air' }],
    boost: [[300, 600], [2000, 4000], [8000, 14000]], maxBoost: 3,
    key: [{ lo: 400, hi: 2000, w: 0.7 }], prio: 7,
    comp: { ratio: 2, gr: [2, 4], attack: 20, release: 200 }, fx: 'inst', mic: 'sdc',
    tips: [n3('Ney\'in nefes sesi karakteridir; kesme. Mikrofonu ağızlığa yandan (45°) 15–25 cm, rüzgar süngeri tak.', 'Atemgeräusch gehört zum Ney. Mikro seitlich (45°) 15–25 cm, Windschutz.', 'Breath is part of the ney. Mic from the side (45°) 15–25 cm, windscreen.'), n3('Ney sessizdir: gain yüksek olur, monitörden geri besleme yapabilir.', 'Ney ist leise: viel Gain, Feedbackgefahr am Monitor.', 'Ney is quiet: high gain, watch monitor feedback.')],
  },
  {
    id: 'zurna', group: 'wind', name: n3('Zurna', 'Zurna', 'Zurna'),
    f0: [400, 2000], core: [500, 6000], hpf: 300,
    regions: [{ key: 'body', lo: 400, hi: 1000 }, { key: 'harsh', lo: 2000, hi: 4500 }, { key: 'sibilance', lo: 5000, hi: 8000 }],
    target: WIND.map(([f, d]) => [f * 1.8, d - (f > 2000 ? 1.5 : 0)] as [number, number]),
    start: [{ f: 3000, gain: -3, q: 1.4, why: 'harsh' }, { f: 6000, gain: -2, q: 1.5, why: 'sibilance' }],
    boost: [], maxBoost: 0,
    key: [{ lo: 500, hi: 1500, w: 0.8 }, { lo: 2000, hi: 4000, w: 0.6 }], prio: 7,
    fx: 'none', mic: 'inst-dyn', loud: true,
    tips: [n3('Zurna salonu kendisi doldurur: kanalı az aç, çoğu salonda sadece uzak köşeler için yeter.', 'Zurna füllt den Saal allein: Kanal nur wenig auf.', 'Zurna fills the hall by itself: barely open the channel.'), n3('Mikrofonu 50 cm–1 m uzak tut; monitöre zurna verme.', 'Mikro 50 cm–1 m entfernt; kein Zurna im Monitor.', 'Mic 50 cm–1 m away; no zurna in monitors.')],
  },
  {
    id: 'kaval', group: 'wind', name: n3('Kaval', 'Kaval', 'Kaval'),
    f0: [300, 2000], core: [400, 6000], hpf: 250,
    regions: [{ key: 'body', lo: 300, hi: 800 }, { key: 'presence', lo: 2000, hi: 4000 }, { key: 'breath', lo: 4000, hi: 9000 }, { key: 'air', lo: 9000, hi: 14000 }],
    target: WIND.map(([f, d]) => [f * 1.6, d + (f > 4000 ? 2 : 0)] as [number, number]),
    start: [{ f: 600, gain: -1, q: 1.2, why: 'mud' }, { f: 3000, gain: 1, q: 1, why: 'presence' }, { f: 10000, gain: 1, q: 0.7, type: 'hshelf', why: 'air' }],
    boost: [[2000, 4000], [8000, 14000]], maxBoost: 2.5,
    key: [{ lo: 500, hi: 2500, w: 0.7 }], prio: 7, fx: 'inst', mic: 'sdc',
    tips: [n3('Ney gibi: mikrofon yandan, rüzgar süngeriyle; nefes sesi doğaldır.', 'Wie Ney: seitlich, Windschutz; Atem ist natürlich.', 'Like the ney: from the side, windscreen; breath is natural.')],
  },
  {
    id: 'tulum', group: 'wind', name: n3('Tulum', 'Tulum', 'Tulum'),
    f0: [300, 1500], core: [400, 5000], hpf: 250,
    regions: [{ key: 'body', lo: 300, hi: 800 }, { key: 'buzz', lo: 1000, hi: 2000 }, { key: 'harsh', lo: 2500, hi: 4500 }],
    target: WIND.map(([f, d]) => [f * 1.5, d] as [number, number]),
    start: [{ f: 3000, gain: -2.5, q: 1.4, why: 'harsh' }], boost: [], maxBoost: 0,
    key: [{ lo: 400, hi: 2000, w: 0.7 }], prio: 6, fx: 'none', mic: 'inst-dyn', loud: true,
    tips: [n3('Tulum güçlüdür: az aç, 2,5–4 kHz sertliğini kes.', 'Tulum ist laut: wenig auf, 2,5–4 kHz absenken.', 'Tulum is loud: little level, cut 2.5–4 kHz.')],
  },
  // ——— Vurmalı ———
  {
    id: 'darbuka', group: 'perc', name: n3('Darbuka', 'Darbuka', 'Darbuka'),
    f0: [60, 400], core: [60, 6000], hpf: 50,
    regions: [{ key: 'body', lo: 60, hi: 120 }, { key: 'boxy', lo: 300, hi: 600 }, { key: 'attack', lo: 2000, hi: 5000 }, { key: 'air', lo: 8000, hi: 14000 }],
    target: BROAD,
    start: [{ f: 80, gain: 1.5, q: 1.2, why: 'body' }, { f: 400, gain: -3, q: 1.4, why: 'boxy' }, { f: 4000, gain: 2, q: 1, why: 'attack' }],
    boost: [[60, 120], [2000, 6000], [8000, 13000]], maxBoost: 3,
    key: [{ lo: 60, hi: 120, w: 0.5 }, { lo: 2000, hi: 5000, w: 0.6 }], prio: 5,
    comp: { ratio: 3, gr: [3, 6], attack: 5, release: 80 }, fx: 'perc', mic: 'inst-dyn',
    tips: [n3('Mikrofonu deriye 10–15 cm, kenara doğru. Alttan ikinci mikrofon varsa onun POLARİTESİNİ ters çevir (Ø).', 'Mikro 10–15 cm über das Fell, zum Rand. Zweites Mikro unten: Polarität drehen (Ø).', 'Mic 10–15 cm above the head, toward the edge. Second mic below: flip its polarity (Ø).')],
  },
  {
    id: 'bendir', group: 'perc', name: n3('Bendir / def', 'Bendir / Def', 'Bendir / frame drum'),
    f0: [40, 150], core: [50, 5000], hpf: 35,
    regions: [{ key: 'body', lo: 50, hi: 100 }, { key: 'mud', lo: 200, hi: 400 }, { key: 'attack', lo: 1500, hi: 4000 }],
    target: DRUM_LOW.map(([f, d]) => [f, d + (f > 1000 ? 3 : 0)] as [number, number]),
    start: [{ f: 70, gain: 2, q: 1, why: 'body' }, { f: 300, gain: -2.5, q: 1.2, why: 'mud' }, { f: 2500, gain: 1, q: 1, why: 'attack' }],
    boost: [[50, 100], [1500, 4000]], maxBoost: 3,
    key: [{ lo: 50, hi: 100, w: 0.6 }], prio: 4,
    comp: { ratio: 3, gr: [3, 6], attack: 10, release: 100 }, fx: 'perc', mic: 'inst-dyn',
    tips: [n3('Bendirin derin sesi 50–100 Hz: sub ile birlikte çok şişebilir, gerekirse 60 Hz\'i kıs.', 'Tiefer Bendir-Ton bei 50–100 Hz: mit Sub kann es dröhnen.', 'Deep bendir tone at 50–100 Hz: can boom with the sub.')],
  },
  {
    id: 'davul', group: 'perc', name: n3('Davul (asma davul)', 'Davul (Trommel)', 'Davul (Turkish drum)'),
    f0: [50, 150], core: [60, 5000], hpf: 45,
    regions: [{ key: 'body', lo: 60, hi: 120 }, { key: 'boxy', lo: 300, hi: 600 }, { key: 'attack', lo: 1500, hi: 4000 }],
    target: DRUM_LOW,
    start: [{ f: 90, gain: 1.5, q: 1, why: 'body' }, { f: 400, gain: -3, q: 1.4, why: 'boxy' }, { f: 3000, gain: 1, q: 1, why: 'attack' }],
    boost: [[60, 120], [1500, 4000]], maxBoost: 3,
    key: [{ lo: 60, hi: 120, w: 0.9 }], prio: 6,
    comp: { ratio: 3, gr: [2, 5], attack: 10, release: 100 }, fx: 'none', mic: 'inst-dyn', loud: true,
    tips: [n3('Davul salonu kendi doldurur: PA\'dan az ver, mikrofonu 30–50 cm uzak tut.', 'Davul füllt den Saal: wenig PA, Mikro 30–50 cm.', 'Davul fills the hall: little PA, mic 30–50 cm.'), n3('Tokmak (kalın) tarafı bas verir, çubuk (ince) tarafı tiz: mikrofonu tokmak tarafına.', 'Schlägelseite = Bass, Rutenseite = Höhen: Mikro zur Schlägelseite.', 'Mallet side gives lows, stick side highs: mic on the mallet side.')],
  },
  // ——— Bateri ———
  {
    id: 'kick', group: 'drums', name: n3('Bateri: kick (bas davul)', 'Schlagzeug: Kick', 'Drums: kick'),
    f0: [40, 100], core: [40, 6000], hpf: 35,
    regions: [{ key: 'body', lo: 50, hi: 90 }, { key: 'boxy', lo: 250, hi: 500 }, { key: 'click', lo: 3000, hi: 5000 }],
    target: DRUM_LOW.map(([f, d]) => [f, d + (f >= 2000 && f <= 5000 ? 4 : 0)] as [number, number]),
    start: [{ f: 60, gain: 2, q: 1.2, why: 'body' }, { f: 400, gain: -4, q: 1.4, why: 'boxy' }, { f: 4000, gain: 2, q: 1.2, why: 'click' }],
    boost: [[50, 90], [3000, 5000]], maxBoost: 4,
    key: [{ lo: 50, hi: 100, w: 1 }, { lo: 3000, hi: 5000, w: 0.3 }], prio: 7,
    comp: { ratio: 4, gr: [3, 6], attack: 15, release: 80 }, gate: true, fx: 'none', mic: 'inst-dyn',
    tips: [n3('Mikrofonu deliğin içine, deriden 5–15 cm. İçeri: daha tık; dışarı: daha gövde.', 'Mikro ins Loch, 5–15 cm vom Fell.', 'Mic inside the port, 5–15 cm from the head.')],
  },
  {
    id: 'snare', group: 'drums', name: n3('Bateri: trampet', 'Schlagzeug: Snare', 'Drums: snare'),
    f0: [150, 250], core: [150, 8000], hpf: 90,
    regions: [{ key: 'body', lo: 150, hi: 250 }, { key: 'boxy', lo: 400, hi: 800 }, { key: 'attack', lo: 2000, hi: 5000 }, { key: 'air', lo: 8000, hi: 12000 }],
    target: BROAD,
    start: [{ f: 200, gain: 1, q: 1.2, why: 'body' }, { f: 600, gain: -3, q: 1.6, why: 'boxy' }, { f: 4000, gain: 2, q: 1, why: 'attack' }],
    boost: [[150, 250], [2000, 6000], [8000, 12000]], maxBoost: 3,
    key: [{ lo: 150, hi: 250, w: 0.5 }, { lo: 2000, hi: 5000, w: 0.5 }], prio: 6,
    comp: { ratio: 4, gr: [3, 6], attack: 10, release: 100 }, gate: true, fx: 'perc', mic: 'inst-dyn',
    tips: [n3('Mikrofon kenardan, deriden 3–5 cm, ortaya doğru; hi-hat\'e sırtını dönsün.', 'Mikro am Rand, 3–5 cm, zur Mitte; Rücken zur Hi-Hat.', 'Mic at the rim, 3–5 cm, aimed at the center; back toward the hi-hat.')],
  },
  {
    id: 'tom', group: 'drums', name: n3('Bateri: tom', 'Schlagzeug: Tom', 'Drums: tom'),
    f0: [70, 250], core: [70, 6000], hpf: 70,
    regions: [{ key: 'body', lo: 80, hi: 200 }, { key: 'boxy', lo: 300, hi: 700 }, { key: 'attack', lo: 3000, hi: 5000 }],
    target: BROAD,
    start: [{ f: 100, gain: 1.5, q: 1.2, why: 'body' }, { f: 500, gain: -3, q: 1.4, why: 'boxy' }, { f: 4000, gain: 2, q: 1, why: 'attack' }],
    boost: [[80, 200], [3000, 5000]], maxBoost: 3,
    key: [{ lo: 80, hi: 200, w: 0.4 }], prio: 4,
    comp: { ratio: 3, gr: [3, 5], attack: 15, release: 100 }, gate: true, fx: 'perc', mic: 'inst-dyn',
    tips: [],
  },
  {
    id: 'oh', group: 'drums', name: n3('Bateri: overhead', 'Schlagzeug: Overhead', 'Drums: overhead'),
    f0: [200, 15000], core: [300, 10000], hpf: 250,
    regions: [{ key: 'boxy', lo: 300, hi: 800 }, { key: 'harsh', lo: 2000, hi: 4000 }, { key: 'air', lo: 10000, hi: 16000 }],
    target: [[200, -6], [400, 0], [1000, 0], [2000, -1], [4000, -2], [8000, -4], [12000, -6], [16000, -10]],
    start: [{ f: 400, gain: -2, q: 1, why: 'boxy' }, { f: 3000, gain: -1, q: 1.5, why: 'harsh' }, { f: 12000, gain: 1.5, q: 0.7, type: 'hshelf', why: 'air' }],
    boost: [[10000, 16000]], maxBoost: 2,
    key: [{ lo: 5000, hi: 12000, w: 0.4 }], prio: 4, fx: 'perc', mic: 'sdc',
    tips: [n3('Küçük salonda overhead HPF 300–400 Hz olabilir: sadece zil ve parlaklık gelsin.', 'Im kleinen Saal HPF 300–400 Hz: nur Becken.', 'In small halls HPF 300–400 Hz: cymbals only.')],
  },
  // ——— Klavye ———
  {
    id: 'piano', group: 'keys', name: n3('Piyano', 'Klavier', 'Piano'),
    f0: [27, 4200], core: [80, 6000], hpf: 50,
    regions: [{ key: 'boom', lo: 80, hi: 150 }, { key: 'mud', lo: 200, hi: 400 }, { key: 'boxy', lo: 500, hi: 1000 }, { key: 'presence', lo: 2000, hi: 5000 }, { key: 'air', lo: 10000, hi: 16000 }],
    target: BROAD,
    start: [{ f: 300, gain: -2, q: 1, why: 'mud' }, { f: 3000, gain: 1, q: 1, why: 'presence' }, { f: 12000, gain: 1, q: 0.7, type: 'hshelf', why: 'air' }],
    boost: [[2000, 5000], [9000, 15000]], maxBoost: 2.5,
    key: [{ lo: 200, hi: 2000, w: 0.6 }], prio: 5,
    comp: { ratio: 2, gr: [2, 3], attack: 20, release: 150 }, fx: 'inst', mic: 'sdc',
    tips: [n3('Vokal varken 2–4 kHz\'i 1–2 dB kıs; piyano ve vokal aynı yerde konuşur.', 'Mit Gesang 2–4 kHz leicht absenken.', 'With vocals, cut 2–4 kHz slightly.')],
  },
  {
    id: 'keys', group: 'keys', name: n3('Klavye / synth', 'Keyboard / Synth', 'Keys / synth'),
    f0: [40, 4000], core: [80, 6000], hpf: 60,
    regions: [{ key: 'mud', lo: 200, hi: 400 }, { key: 'presence', lo: 2000, hi: 5000 }],
    target: BROAD,
    start: [{ f: 300, gain: -1.5, q: 1, why: 'mud' }],
    boost: [], maxBoost: 2,
    key: [{ lo: 200, hi: 3000, w: 0.5 }], prio: 4, fx: 'none', mic: 'di',
    tips: [n3('Klavyenin kendi master\'ı ¾\'te kalsın; seviyeyi mikserde ayarla.', 'Keyboard-Master auf ¾, Pegel am Mischpult.', 'Keep the keyboard master at ¾; set level at the mixer.')],
  },
  {
    id: 'pa-lr', group: 'keys', name: n3('Korg Pa5X · L/R (eşlik)', 'Korg Pa5X · L/R (Begleitung)', 'Korg Pa5X · L/R (accompaniment)'),
    f0: [40, 5000], core: [100, 6000], hpf: 40,
    regions: [{ key: 'mud', lo: 200, hi: 400 }, { key: 'presence', lo: 2000, hi: 4500 }],
    target: BROAD,
    start: [{ f: 300, gain: -1.5, q: 1, why: 'mud' }, { f: 3000, gain: -1.5, q: 1.2, why: 'presence' }],
    boost: [], maxBoost: 2,
    key: [{ lo: 150, hi: 3000, w: 0.4 }], prio: 4, fx: 'none', mic: 'di',
    tips: [n3('Mono PA\'da L ve R\'yi iki kanala al, ikisini de ortala (ya da tek kanal kullan). Geniş stereo efektler mono\'da iptal olabilir: mikserde mono dinle.', 'Bei Mono-PA: L und R beide in die Mitte (oder nur einen Kanal). Breite Stereo-Effekte können sich mono auslöschen.', 'On a mono PA, pan L and R both to center (or use one channel). Wide stereo effects may cancel in mono.')],
  },
  {
    id: 'pa-bass', group: 'keys', name: n3('Korg Pa5X · Out (bas)', 'Korg Pa5X · Out (Bass)', 'Korg Pa5X · Out (bass)'),
    f0: [30, 300], core: [40, 2000], hpf: 30,
    regions: [{ key: 'body', lo: 50, hi: 100 }, { key: 'mud', lo: 200, hi: 300 }, { key: 'attack', lo: 1000, hi: 2500 }],
    target: [[30, -4], [50, 0], [80, 0], [125, -2], [250, -6], [500, -9], [1000, -11], [2000, -14], [4000, -18], [8000, -24]],
    start: [{ f: 250, gain: -2, q: 1.2, why: 'mud' }],
    boost: [[50, 100], [1000, 2500]], maxBoost: 2,
    key: [{ lo: 40, hi: 110, w: 1 }], prio: 6,
    comp: { ratio: 3, gr: [2, 4], attack: 20, release: 150 }, fx: 'none', mic: 'di',
    tips: [n3('Bas ayrı çıkıyorsa L/R kanallarına HPF 100 Hz koy: bas iki kere çıkmasın.', 'Bass separat: L/R mit HPF 100 Hz, damit der Bass nicht doppelt kommt.', 'Bass on its own out: HPF the L/R at 100 Hz so bass does not double.')],
  },
  {
    id: 'pa-drums', group: 'keys', name: n3('Korg Pa5X · Out (davul / ritim)', 'Korg Pa5X · Out (Drums)', 'Korg Pa5X · Out (drums)'),
    f0: [40, 12000], core: [50, 8000], hpf: 35,
    regions: [{ key: 'body', lo: 50, hi: 100 }, { key: 'boxy', lo: 300, hi: 600 }, { key: 'click', lo: 3000, hi: 5000 }, { key: 'air', lo: 9000, hi: 14000 }],
    target: BROAD,
    start: [{ f: 400, gain: -2, q: 1.2, why: 'boxy' }, { f: 4000, gain: 1, q: 1, why: 'click' }],
    boost: [[50, 100], [3000, 5000]], maxBoost: 2,
    key: [{ lo: 50, hi: 110, w: 0.8 }, { lo: 3000, hi: 6000, w: 0.3 }], prio: 5, fx: 'none', mic: 'di',
    tips: [n3('Canlı davul / darbuka varsa ritim çıkışını kıs: iki ritim üst üste binmesin.', 'Mit Live-Percussion Rhythmus-Out leiser.', 'With live percussion, turn the rhythm out down.')],
  },
  {
    id: 'pa-lead', group: 'keys', name: n3('Korg Pa5X · Out (sağ el / solo)', 'Korg Pa5X · Out (Solo)', 'Korg Pa5X · Out (lead)'),
    f0: [150, 3000], core: [200, 6000], hpf: 150,
    regions: [{ key: 'mud', lo: 250, hi: 450 }, { key: 'presence', lo: 2000, hi: 4000 }, { key: 'harsh', lo: 3000, hi: 5000 }],
    target: WIND,
    start: [{ f: 300, gain: -1.5, q: 1, why: 'mud' }, { f: 3000, gain: -1, q: 1.2, why: 'presence' }],
    boost: [[1000, 2500]], maxBoost: 2,
    key: [{ lo: 400, hi: 2500, w: 0.7 }], prio: 7, fx: 'inst', mic: 'di',
    tips: [n3('Solo çalarken seviyeyi aç, vokal girince 2–3 dB indir.', 'Solo lauter, mit Gesang 2–3 dB runter.', 'Up for solos, 2–3 dB down under vocals.')],
  },
  {
    id: 'pa-chord', group: 'keys', name: n3('Korg Pa5X · Out (akor / pad)', 'Korg Pa5X · Out (Akkorde / Pad)', 'Korg Pa5X · Out (chords / pad)'),
    f0: [100, 4000], core: [150, 5000], hpf: 180,
    regions: [{ key: 'mud', lo: 200, hi: 450 }, { key: 'presence', lo: 2000, hi: 4500 }],
    target: BROAD,
    start: [{ f: 300, gain: -2, q: 1, why: 'mud' }, { f: 3000, gain: -2, q: 1, why: 'presence' }],
    boost: [], maxBoost: 1,
    key: [{ lo: 200, hi: 2000, w: 0.4 }], prio: 3, fx: 'none', mic: 'di',
    tips: [n3('Akor/pad arkada kalmalı: 2–4 kHz kısık, HPF yüksek.', 'Pads im Hintergrund: 2–4 kHz absenken, HPF hoch.', 'Pads sit behind: cut 2–4 kHz, high HPF.')],
  },
  {
    id: 'dj', group: 'other', name: n3('DJ mikseri / müzik', 'DJ-Mixer / Musik', 'DJ mixer / music'),
    f0: [30, 16000], core: [60, 8000], hpf: 25,
    regions: [],
    target: BROAD,
    start: [], boost: [], maxBoost: 0,
    key: [{ lo: 40, hi: 12000, w: 0.3 }], prio: 5, fx: 'none', mic: 'di',
    tips: [n3('DJ mikserinin master\'ını kırmızıya sokma; seviye mikserde. Müziğin tonunu ana sistem EQ\'su belirler.', 'DJ-Master nicht ins Rot; Klang über die System-EQ.', 'Keep the DJ master out of the red; tone comes from the system EQ.')],
  },
];

export const SOURCE_BY_ID: Record<SourceId, SourceDef> = Object.fromEntries(SOURCES.map((s) => [s.id, s])) as Record<SourceId, SourceDef>;

export function srcDef(id: string): SourceDef {
  return SOURCE_BY_ID[id as SourceId] || SOURCE_BY_ID.keys;
}

// Log frekansta hedef eğri (göreli dB)
export function interpAnchors(a: [number, number][], f: number): number {
  if (!a.length) return 0;
  if (f <= a[0][0]) return a[0][1];
  if (f >= a[a.length - 1][0]) return a[a.length - 1][1];
  for (let i = 1; i < a.length; i++) {
    if (f <= a[i][0]) {
      const t = Math.log(f / a[i - 1][0]) / Math.log(a[i][0] / a[i - 1][0]);
      return a[i - 1][1] + t * (a[i][1] - a[i - 1][1]);
    }
  }
  return 0;
}

// Konuşmada hedef: alt bölge daha az, netlik bölgesi biraz daha fazla
export function targetAt(s: SourceDef, f: number, use: 'sing' | 'speech' | 'both'): number {
  let v = interpAnchors(s.target, f);
  if (s.group === 'vocal' && use !== 'sing') {
    const k = use === 'speech' ? 1 : 0.5;
    const lo = s.core[0] * 1.3;
    if (f < lo) v -= 3 * k * Math.min(1, Math.log2(lo / f));
    if (f >= 1500 && f <= 5000) v += 1.5 * k;
    if (f > 8000) v -= 1.5 * k;
  }
  return v;
}

// Grup içi hazır kadrolar (kanal ekleme kısayolları)
export const PA5X_OUTS: { src: SourceId; name: L10n }[] = [
  { src: 'pa-lr', name: n3('Pa5X L', 'Pa5X L', 'Pa5X L') },
  { src: 'pa-lr', name: n3('Pa5X R', 'Pa5X R', 'Pa5X R') },
  { src: 'pa-bass', name: n3('Pa5X Out 1 · bas', 'Pa5X Out 1 · Bass', 'Pa5X Out 1 · bass') },
  { src: 'pa-drums', name: n3('Pa5X Out 2 · davul / ritim', 'Pa5X Out 2 · Drums', 'Pa5X Out 2 · drums') },
  { src: 'pa-lead', name: n3('Pa5X Out 3 · sağ el / solo', 'Pa5X Out 3 · Solo', 'Pa5X Out 3 · lead') },
  { src: 'pa-chord', name: n3('Pa5X Out 4 · akor / pad', 'Pa5X Out 4 · Pad', 'Pa5X Out 4 · chords') },
];

export const DRUMKIT: { src: SourceId; name: L10n }[] = [
  { src: 'kick', name: n3('Kick', 'Kick', 'Kick') },
  { src: 'snare', name: n3('Trampet', 'Snare', 'Snare') },
  { src: 'tom', name: n3('Tom 1', 'Tom 1', 'Tom 1') },
  { src: 'tom', name: n3('Tom 2 (yer tom)', 'Tom 2 (Floor)', 'Tom 2 (floor)') },
  { src: 'oh', name: n3('Overhead L', 'Overhead L', 'Overhead L') },
  { src: 'oh', name: n3('Overhead R', 'Overhead R', 'Overhead R') },
];
