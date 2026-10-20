import type { CatId, Dept, L10n } from '../model/types';

export const CATEGORIES: { id: CatId; name: L10n; icon: string; color: string }[] = [
  { id: 'hoparlor', name: { tr: 'Hoparlörler', de: 'Lautsprecher', en: 'Loudspeakers' }, icon: 'speaker', color: '#1d4ed8' },
  { id: 'sub', name: { tr: 'Subwoofer', de: 'Subwoofer', en: 'Subwoofers' }, icon: 'sub', color: '#1e3a8a' },
  { id: 'linearray', name: { tr: 'Line array', de: 'Line-Array', en: 'Line arrays' }, icon: 'array', color: '#1e40af' },
  { id: 'monitor', name: { tr: 'Monitör / IEM', de: 'Monitor / IEM', en: 'Monitors / IEM' }, icon: 'monitor', color: '#2563eb' },
  { id: 'mikser', name: { tr: 'Mikser / stagebox', de: 'Mischpult / Stagebox', en: 'Mixers / stage boxes' }, icon: 'mixer', color: '#0f766e' },
  { id: 'islem', name: { tr: 'Amfi / DSP / DI', de: 'Endstufe / DSP / DI', en: 'Amps / DSP / DI' }, icon: 'amp', color: '#115e59' },
  { id: 'dj', name: { tr: 'DJ ekipmanı', de: 'DJ-Equipment', en: 'DJ gear' }, icon: 'djcontroller', color: '#7c3aed' },
  { id: 'mikrofon', name: { tr: 'Mikrofonlar', de: 'Mikrofone', en: 'Microphones' }, icon: 'mic', color: '#0369a1' },
  { id: 'enstruman', name: { tr: 'Enstrümanlar', de: 'Instrumente', en: 'Instruments' }, icon: 'baglama', color: '#b45309' },
  { id: 'isik', name: { tr: 'Işık & efekt', de: 'Licht & Effekte', en: 'Lighting & FX' }, icon: 'movinghead', color: '#a21caf' },
  { id: 'truss', name: { tr: 'Truss & rigging', de: 'Traversen & Rigging', en: 'Truss & rigging' }, icon: 'truss', color: '#525252' },
  { id: 'video', name: { tr: 'Görüntü', de: 'Video', en: 'Video' }, icon: 'ledwall', color: '#be185d' },
  { id: 'elektrik', name: { tr: 'Elektrik', de: 'Strom', en: 'Power' }, icon: 'distro', color: '#b91c1c' },
  { id: 'ag', name: { tr: 'Ağ & kontrol', de: 'Netzwerk & Steuerung', en: 'Network & control' }, icon: 'switch', color: '#15803d' },
  { id: 'sahne', name: { tr: 'Sahne & dekor', de: 'Bühne & Deko', en: 'Stage & decor' }, icon: 'stagedeck', color: '#78716c' },
  { id: 'mekan', name: { tr: 'Mekan (mimari)', de: 'Raum (Architektur)', en: 'Venue (architecture)' }, icon: 'pillar', color: '#57534e' },
  { id: 'hazirlik', name: { tr: 'Hazırlık / başka bölüm', de: 'Übergabe / andere Bereiche', en: 'Hand-off / other sections' }, icon: 'tie', color: '#0d9488' },
];

export const CAT_BY_ID = Object.fromEntries(CATEGORIES.map((c) => [c.id, c])) as Record<CatId, (typeof CATEGORIES)[number]>;

export const DEPTS: { id: Dept; name: L10n; color: string }[] = [
  { id: 'ses', name: { tr: 'Ses', de: 'Ton', en: 'Sound' }, color: '#2563eb' },
  { id: 'dj', name: 'DJ', color: '#7c3aed' },
  { id: 'enstruman', name: { tr: 'Müzisyen', de: 'Musiker', en: 'Musicians' }, color: '#b45309' },
  { id: 'isik', name: { tr: 'Işık', de: 'Licht', en: 'Lighting' }, color: '#a21caf' },
  { id: 'video', name: { tr: 'Görüntü', de: 'Video', en: 'Video' }, color: '#be185d' },
  { id: 'elektrik', name: { tr: 'Elektrik', de: 'Strom', en: 'Power' }, color: '#b91c1c' },
  { id: 'ag', name: { tr: 'Ağ', de: 'Netzwerk', en: 'Network' }, color: '#15803d' },
  { id: 'sahne', name: { tr: 'Sahne / mekan', de: 'Bühne / Raum', en: 'Stage / venue' }, color: '#78716c' },
  { id: 'hazirlik', name: { tr: 'Hazırlık', de: 'Übergabe', en: 'Hand-off' }, color: '#0d9488' },
];

export const DEPT_BY_ID = Object.fromEntries(DEPTS.map((d) => [d.id, d])) as Record<Dept, (typeof DEPTS)[number]>;
