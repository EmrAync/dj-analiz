// SahneCAD veri modeli. Tüm ölçüler metre, açılar derece.
// Koordinatlar: her bölümün (alan) sol-arka köşesi (0,0). x → sağa, y → seyirciye doğru (plan aşağı), z → yukarı.
// rot = 0 iken cihazın önü +y yönüne (seyirciye) bakar.

export type Lang = 'tr' | 'de' | 'en';
export type L10n = string | { tr: string; de?: string; en?: string };

export type Dept =
  | 'ses' // ses sistemi
  | 'dj'
  | 'enstruman'
  | 'isik'
  | 'video'
  | 'elektrik'
  | 'ag' // network / kontrol
  | 'sahne' // sahne, dekor, mobilya
  | 'hazirlik'; // başka bölüm / ekip için bağlantı noktaları

export type Domain =
  | 'audio' // analog ses
  | 'speaker' // amfi → pasif hoparlör
  | 'digital' // AES, Dante, AES50, MADI
  | 'network' // Ethernet
  | 'dmx' // ışık kontrol
  | 'video'
  | 'power' // elektrik
  | 'wireless' // kablosuz bağlantı (mikrofon, IEM, Wi-Fi)
  | 'data'; // USB, MIDI

export type ConnFamily =
  | 'xlr'
  | 'combo' // XLR/jack kombo
  | 'jack' // 6.3 mm TRS/TS
  | 'jack35' // 3.5 mm
  | 'rca'
  | 'speakon'
  | 'powercon' // powerCON A/B (mavi giriş / gri çıkış)
  | 'true1' // powerCON TRUE1
  | 'iec' // C13/C14
  | 'schuko'
  | 'cee16' // CEE 16A mavi 230V
  | 'cee16r' // CEE 16A kırmızı 400V 3 faz
  | 'cee32r'
  | 'cee63r'
  | 'powerlock'
  | 'rj45' // RJ45 / etherCON
  | 'dmx3'
  | 'dmx5'
  | 'hdmi'
  | 'sdi' // BNC video
  | 'bnc' // word clock vb.
  | 'usb'
  | 'midi'
  | 'optical' // TOSLINK / ADAT
  | 'fiber' // opticalCON
  | 'multipin' // multikor (Harting vb.)
  | 'antenna' // kablosuz (anten)
  | 'terminal'; // klemens / sabit bağlantı

export type PortDir = 'in' | 'out' | 'io';
export type Phase = 'L1' | 'L2' | 'L3';

export interface PortGroup {
  key: string; // 'in', 'out', 'pwr'...
  name: L10n;
  conn: ConnFamily;
  dir: PortDir;
  domain: Domain;
  count?: number; // varsayılan 1
  names?: string[]; // tek tek port adları (örn. ['L','R'])
  phases?: Phase[]; // 3 fazlı dağıtıcı çıkışları için faz ataması (port sırasına göre)
  breakerA?: number; // bu çıkışın sigortası (A)
}

export type MountType = 'floor' | 'stand' | 'pole' | 'flown' | 'table' | 'wall' | 'stage';

export type AcousticKind = 'top' | 'sub' | 'monitor' | 'array' | 'column' | 'fill' | 'iem';

export interface AcousticSpec {
  kind: AcousticKind;
  maxSpl: number; // dB SPL tepe @1 m
  hDisp: number; // yatay kapsama (−6 dB) derece
  vDisp: number; // dikey kapsama derece (array için tek eleman)
  fLow: number; // Hz
  fHigh: number;
  powered: boolean; // aktif mi
  ampW?: number; // amfi gücü (aktif) / dayanım (pasif) W RMS
  impedance?: number; // Ω (pasif)
}

export interface PowerSourceSpec {
  voltage: 230 | 400;
  breakerA: number;
  phases: 1 | 3;
  kva?: number; // jeneratör
}

export type CatId =
  | 'hoparlor'
  | 'sub'
  | 'monitor'
  | 'linearray'
  | 'mikser'
  | 'islem' // DSP, amfi, DI, stagebox
  | 'dj'
  | 'mikrofon'
  | 'enstruman'
  | 'isik'
  | 'truss'
  | 'video'
  | 'elektrik'
  | 'ag'
  | 'sahne'
  | 'mekan'
  | 'hazirlik';

export interface EquipDef {
  id: string;
  cat: CatId;
  dept: Dept;
  name: L10n;
  brand?: string;
  model?: string;
  icon: string; // ikon anahtarı (icons.tsx)
  shape: string; // 3D model anahtarı (views/three/models.tsx)
  plan?: 'rect' | 'circle'; // plan sembol şekli
  w: number;
  d: number;
  h: number;
  kg?: number;
  watt?: number; // tipik çekiş (W)
  wattMax?: number; // tepe
  ports: PortGroup[];
  acoustic?: AcousticSpec;
  source?: PowerSourceSpec; // bu bir elektrik kaynağıdır (priz, jeneratör)
  mount?: MountType;
  mountH?: number; // varsayılan alt kenar yüksekliği (stand / asma)
  range?: number; // kablosuz menzil (m)
  tags?: string[];
  desc?: L10n;
  color?: string; // 3D gövde rengi
  imageId?: string; // özel resim (asset)
  custom?: boolean;
  props?: Record<string, unknown>; // varsayılan özellikler
}

export type SpeakerRole = 'main' | 'fill' | 'delay' | 'sidefill' | 'monitor' | 'sub' | 'outfill';

export interface Item {
  id: string;
  defId: string;
  areaId: string;
  label: string; // kısa etiket: PA-L, SUB-1, MIC-3
  name?: string; // görünen ad (boşsa katalog adı)
  x: number;
  y: number;
  z: number; // tabanın zeminden (sahne yükseltisi dahil değil) yüksekliği. Stand/asma için alt kenar.
  rot: number;
  tilt: number;
  mount: MountType;
  w?: number;
  d?: number;
  h?: number;
  color?: string;
  imageId?: string;
  notes?: string;
  locked?: boolean;
  hidden?: boolean;
  dept?: Dept;
  // tipe özel parametreler
  role?: SpeakerRole;
  delayMs?: number;
  polarity?: 1 | -1;
  gainDb?: number; // hoparlöre özel seviye
  count?: number; // line array eleman sayısı
  splays?: number[]; // line array açıları
  channel?: string; // mikrofon/enstrüman kanal adı
  phantom?: boolean;
  stand?: 'boom' | 'straight' | 'short' | 'table' | 'clip' | 'none';
  breakerA?: number; // kaynak için sigorta değeri (geçersiz kılar)
  watt?: number; // güç (geçersiz kılar)
  target?: string; // hazırlık noktası: hedef bölüm / ekip / program
  sch?: { x: number; y: number }; // bağlantı şemasındaki konum
  pwr?: { x: number; y: number }; // elektrik şemasındaki konum
  variant?: string; // alternatif plan (Variant.id) — sadece o plan seçiliyken kullanılır
}

export interface PortRef {
  item: string;
  port: string;
}

export type RouteMode = 'ortho' | 'straight' | 'manual';

export interface Cable {
  id: string;
  label: string; // A-001, P-004…
  type: string; // kablo tipi id
  a: PortRef; // kaynak (çıkış)
  b: PortRef; // hedef (giriş)
  route: RouteMode;
  pts: { x: number; y: number }[]; // ara noktalar (manuel)
  len?: number; // elle girilen uzunluk (m) — boşsa otomatik
  color?: string;
  channel?: string;
  notes?: string;
  hidden?: boolean;
  variant?: string; // alternatif plan (Variant.id)
}

// —— Alternatif planlar (örn. elektrik girişi: A 32 A CEE / B 16 A CEE / C Schuko) ——
export interface Variant {
  id: string;
  label: string; // A, B, C…
  name: string; // kısa ad: "32 A 5 pin"
  when: string; // ne zaman: "Duvarda 32 A 5 pin (kırmızı CEE) priz varsa"
}

export interface VariantGroup {
  id: string;
  name: string;
  kind: 'power' | 'other';
  variants: Variant[]; // öncelik sırasıyla
  active: string; // şu an kullanılan / çizili plan
}

// —— Paketleme: çantalar / kasalar ——
export interface CaseLine {
  id: string;
  kind: 'def' | 'cable' | 'acc' | 'text';
  ref: string; // defId | kabloTipi@boy | malzeme listesi satırı (acc:stand) | serbest metin
  qty: number;
  name?: string; // görünen ad (listede yoksa)
  note?: string;
}

export interface CaseDef {
  id: string;
  name: string;
  desc: string;
  color: string;
  image?: string; // küçültülmüş fotoğraf (data URL)
  lines: CaseLine[];
}

// —— Kayıtlı salon (kütüphane): ölçüler, bölgeler, sabitler, elektrik girişi alternatifleri ——
export interface VenueTpl {
  id: string;
  name: string;
  saved: number;
  gear: boolean; // tüm malzemeler de kayıtlı mı
  area: Area;
  zones: Zone[];
  notes: Note[];
  items: Item[];
  cables: Cable[];
  variants: VariantGroup[];
  defs: EquipDef[];
  assets: Record<string, Asset>;
}

export type ZoneKind =
  | 'stage'
  | 'audience'
  | 'dance'
  | 'tables'
  | 'foh'
  | 'walkway'
  | 'backstage'
  | 'bar'
  | 'nogo'
  | 'custom';

export interface Zone {
  id: string;
  areaId: string;
  kind: ZoneKind;
  name: string;
  x: number;
  y: number;
  w: number;
  d: number;
  elev: number; // yükselti (sahne podesti yüksekliği)
  color?: string;
  target?: number; // hedef ses seviyesi dB (0 = hedef yok; boşsa bölge türüne göre)
}

export type NoteKind = 'text' | 'dim' | 'arrow';

export interface Note {
  id: string;
  areaId: string;
  kind: NoteKind;
  x: number;
  y: number;
  x2?: number;
  y2?: number;
  text: string;
  color?: string;
}

export type MaterialId =
  | 'beton'
  | 'siva'
  | 'alcipan'
  | 'ahsap'
  | 'parke'
  | 'seramik'
  | 'hali'
  | 'cam'
  | 'perde'
  | 'akustikTavan'
  | 'akustikPanel'
  | 'cadir'
  | 'acik';

export interface Area {
  id: string;
  name: string;
  w: number; // genişlik (x)
  d: number; // derinlik (y)
  h: number; // tavan yüksekliği
  indoor: boolean;
  floor: MaterialId;
  ceiling: MaterialId;
  walls: MaterialId;
  glassPct: number; // duvarlardaki cam oranı %
  curtainPct: number; // duvarlardaki perde oranı %
  guests: number; // bu bölümdeki kişi sayısı (akustik)
  bg?: { assetId: string; x: number; y: number; w: number; opacity: number };
  notes?: string;
  ox?: number; // genel yerleşimdeki konum (başka bölümlerle ilişki için)
  oy?: number;
}

export interface Asset {
  id: string;
  name: string;
  data: string; // data URL
  w: number;
  h: number;
}

export type EventType =
  | 'dugun'
  | 'kina'
  | 'nisan'
  | 'sunnet'
  | 'konser'
  | 'kurumsal'
  | 'parti'
  | 'festival'
  | 'diger';

export interface Environment {
  tempC: number;
  humidity: number;
  wind: number; // m/s
  rain: boolean;
  noiseLimit: number; // dB(A) — 0 = yok
  neighborDist: number; // en yakın komşuya mesafe (m) — açık hava
  curfew: string; // örn. 22:00
}

export interface ProjectSettings {
  slackPct: number; // kablo payı %
  slackM: number; // her uca ek pay (m)
  level: number; // sistem sürüş seviyesi (dB, maksimuma göre; 0 = tam)
  earH: number; // kulak yüksekliği (m)
  targetSpl: number; // hedef dB
  crest: number; // tepe/ortalama farkı dB
  eq?: EqTarget; // ölçüm: hedef eğri
  limits?: SoundLimits; // yasal / önerilen ses sınırı (isteğe bağlı)
}

export interface SoundLimits {
  on: boolean;
  preset: 'din15905' | 'who' | 'custom';
  laeq: number; // dB(A) — kayan ortalama sınırı
  minutes: number; // ortalama süresi
  lcpeak: number; // dB(C) tepe sınırı
}

export type CurveId = 'flat' | 'house' | 'dance' | 'live' | 'speech';

export interface EqTarget {
  curve: CurveId;
  bass: number; // ek bas (dB, ~90 Hz altı)
  tilt: number; // 1 kHz üstü eğim (dB/oktav)
  lo: number; // sistem alt sınırı (Hz)
  hi: number; // sistem üst sınırı (Hz)
  boost: boolean; // küçük yükseltmelere izin
}

// RTA ölçümü (kalibre edilmiş, Z ağırlıklı, 1/12 oktav bantlar)
export interface Measurement {
  id: string;
  name: string;
  areaId: string;
  x?: number;
  y?: number;
  at: number;
  device: string;
  calibrated: boolean;
  freqs: number[];
  bands: number[]; // dB SPL (kalibre değilse dBFS + ofset)
  spl: { a: number; c: number; z: number; leq: number; max: number };
  secs: number; // ortalama süresi
  hidden?: boolean;
  demo?: boolean;
}

export interface Project {
  schema: 1;
  id: string;
  name: string;
  created: number;
  modified: number;
  meta: {
    client: string;
    eventType: EventType;
    date: string;
    time: string;
    venue: string;
    address: string;
    engineer: string;
    phone: string;
    guests: number;
    notes: string;
  };
  env: Environment;
  settings: ProjectSettings;
  areas: Area[];
  items: Item[];
  cables: Cable[];
  zones: Zone[];
  notes: Note[];
  defs: EquipDef[]; // özel malzemeler
  defImages: Record<string, string>; // katalog modeli → resim (asset id)
  assets: Record<string, Asset>;
  done: Record<string, boolean>; // kurulum kontrol listesi
  measurements?: Measurement[];
  variants?: VariantGroup[];
  cases?: CaseDef[];
  packing?: Record<string, { out?: number; back?: number }>; // "caseId:lineId" → işaretlenen adet
}

export interface PortInst {
  id: string;
  key: string;
  index: number;
  label: string;
  group: PortGroup;
  phase?: Phase;
  breakerA?: number;
}
