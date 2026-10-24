// Kanal ayarını seçilen mikserin diliyle yaz: "Band 2 · PEQ: 350 Hz · −3 dB · Q 1,4"
import { fmt, L } from '../i18n';
import type { ChanEq, EqMove, Lang, MixChannel, MixSetup } from '../model/types';
import type { ProcAdvice } from './chanEq';
import { useOf } from './chanEq';
import { MIXER_BY_ID, qToOct, type MixerSpec } from './mixers';
import { MICS, REGIONS, srcDef, type MicType, type RegionKey } from './sources';

export interface MixLine {
  k: string; // başlık
  v: string; // değer
  sub?: string; // açıklama
  key: 'input' | 'gain' | 'hpf' | 'lpf' | 'band' | 'gate' | 'comp' | 'deess' | 'fx' | 'pan' | 'automix';
  band?: number;
  move?: EqMove;
}

const T = (lang: Lang, tr: string, de: string, en: string) => (lang === 'de' ? de : lang === 'en' ? en : tr);

export function fHz(f: number, lang: Lang): string {
  return f >= 1000 ? `${fmt(f / 1000, f % 1000 ? (f % 100 ? 2 : 1) : 0, lang)} kHz` : `${Math.round(f)} Hz`;
}

export function dbStr(g: number, lang: Lang): string {
  return `${g > 0 ? '+' : g < 0 ? '−' : ''}${fmt(Math.abs(g), g % 1 ? 1 : 0, lang)} dB`;
}

function typeName(spec: MixerSpec, t: EqMove['type'], lang: Lang): string {
  if (spec.xair) return t === 'lshelf' ? 'LShv' : t === 'hshelf' ? 'HShv' : 'PEQ';
  if (t === 'lshelf') return T(lang, 'alçak raf (low shelf)', 'Low Shelf', 'low shelf');
  if (t === 'hshelf') return T(lang, 'yüksek raf (high shelf)', 'High Shelf', 'high shelf');
  return T(lang, 'çan (bell)', 'Glocke (Peak)', 'bell (peak)');
}

export function moveText(spec: MixerSpec, m: EqMove, lang: Lang): string {
  const base = `${fHz(m.f, lang)} · ${dbStr(m.gain, lang)}`;
  return m.type === 'bell' ? `${base} · Q ${fmt(m.q, 1, lang)} (≈${fmt(qToOct(m.q), 1, lang)} ${T(lang, 'okt', 'Okt', 'oct')})` : base;
}

export function whyText(m: EqMove, lang: Lang): string {
  const r = REGIONS[m.why as RegionKey];
  if (!r) return '';
  return `${L(r.name, lang)}: ${L(m.gain < 0 ? r.cut : r.boost, lang)}`;
}

export function mixerLines(setup: MixSetup, ch: MixChannel, eq: ChanEq, proc: ProcAdvice, lang: Lang): MixLine[] {
  const spec = MIXER_BY_ID[setup.mixer];
  const s = srcDef(ch.src);
  const mic = (ch.mic || s.mic) as MicType;
  const out: MixLine[] = [];
  const di = mic === 'di';
  out.push({
    key: 'input',
    k: T(lang, 'Giriş', 'Eingang', 'Input'),
    v: di ? T(lang, 'Hat / DI (Hi-Z ya da DI kutusu)', 'Line / DI', 'Line / DI') : T(lang, 'Mikrofon girişi', 'Mikrofoneingang', 'Mic input'),
    sub: `+48V: ${proc.phantom ? T(lang, 'AÇIK', 'AN', 'ON') : T(lang, 'kapalı', 'aus', 'off')} · ${L(MICS[mic]?.name, lang)}`,
  });
  out.push({
    key: 'gain',
    k: L(spec.names.gain, lang),
    v: proc.loud ? T(lang, 'Düşük tut (kaynak zaten güçlü)', 'Niedrig (Quelle laut)', 'Keep low (loud source)') : T(lang, 'En yüksek yerde ≈ −10…−6 dBFS, kırmızı yok', 'Lauteste Stelle ≈ −10…−6 dBFS', 'Loudest part ≈ −10…−6 dBFS'),
    sub: spec.gainAssist ? L(spec.gainAssist, lang) : T(lang, 'Önce gain, sonra EQ.', 'Erst Gain, dann EQ.', 'Gain first, then EQ.'),
  });
  const hpfOver = eq.hpf > spec.hpfMax;
  out.push({
    key: 'hpf',
    k: L(spec.names.hpf, lang),
    v: hpfOver ? fHz(spec.hpfMax, lang) : fHz(eq.hpf, lang),
    sub: hpfOver ? T(lang, `Mikser en fazla ${fHz(spec.hpfMax, lang)}; ayrıca Band 1 alçak raf ${fHz(eq.hpf, lang)} −4 dB`, `Max ${fHz(spec.hpfMax, lang)}; zusätzlich Band 1 Low Shelf −4 dB`, `Max ${fHz(spec.hpfMax, lang)}; also band 1 low shelf −4 dB`) : spec.hpfSlope ? T(lang, 'Eğim: vokal 12, diğerleri 24 dB/okt', 'Flanke: Gesang 12, sonst 24 dB/Okt', 'Slope: vocals 12, others 24 dB/oct') : undefined,
  });
  if (eq.lpf) {
    out.push({
      key: 'lpf',
      k: 'LPF',
      v: fHz(eq.lpf, lang),
      sub: spec.lpf === 'own' ? undefined : spec.lpf === 'band4' ? T(lang, 'Band 4 tipini HCut yap', 'Band 4 auf HCut', 'Set band 4 to HCut') : T(lang, 'LPF yoksa Band 4: yüksek raf −6 dB', 'Ohne LPF: Band 4 High Shelf −6 dB', 'No LPF: band 4 high shelf −6 dB'),
    });
  }
  for (let b = 1; b <= 4; b++) {
    const m = eq.moves.find((x) => x.band === b);
    out.push({
      key: 'band',
      band: b,
      move: m,
      k: `${L(spec.names.eq, lang).replace(/\s*\(.*\)/, '')} · Band ${b}${m ? ' · ' + typeName(spec, m.type, lang) : ''}`,
      v: m ? moveText(spec, m, lang) : T(lang, 'düz (0 dB)', 'flach (0 dB)', 'flat (0 dB)'),
      sub: m ? whyText(m, lang) + (m.slot ? T(lang, ' · mix içinde yer açmak için', ' · Platz im Mix', ' · room in the mix') : '') : undefined,
    });
  }
  if (proc.gate)
    out.push({ key: 'gate', k: L(spec.names.gate, lang), v: T(lang, 'AÇIK', 'AN', 'ON'), sub: T(lang, 'Eşik: çalmazken kapanacak kadar · attack 1 ms · hold 50 ms · release 150 ms', 'Threshold: schließt in Pausen · Attack 1 ms · Hold 50 ms · Release 150 ms', 'Threshold: closes in pauses · attack 1 ms · hold 50 ms · release 150 ms') });
  if (proc.comp) {
    const c = proc.comp;
    out.push({ key: 'comp', k: L(spec.names.comp, lang), v: `${fmt(c.ratio, 1, lang)}:1 · GR ${c.gr[0]}–${c.gr[1]} dB`, sub: `attack ${c.attack} ms · release ${c.release} ms · ${T(lang, 'eşik: en yüksek yerde gösterilen kadar azaltsın', 'Threshold so, dass die GR erreicht wird', 'threshold so the GR is reached')}` });
  }
  if (proc.deess) {
    const f = s.id === 'voc-f' || s.id === 'choir' ? '7–9 kHz' : '6–8 kHz';
    out.push({ key: 'deess', k: 'De-esser', v: `${f} · 3–5 dB`, sub: spec.deess === 'own' ? undefined : spec.deess === 'fx' ? T(lang, 'FX yuvasına De-Esser koy (kanala insert)', 'De-Esser im FX-Slot als Insert', 'De-esser in an FX slot as insert') : T(lang, 'De-esser yoksa: 7 kHz dar (Q 4) −3 dB', 'Ohne De-Esser: 7 kHz schmal −3 dB', 'No de-esser: narrow cut 7 kHz −3 dB') });
  }
  const fx = proc.fx;
  out.push({
    key: 'fx',
    k: L(spec.names.fx, lang),
    v: fx.send === 'off' ? T(lang, 'kapalı', 'aus', 'off') : `${fx.send === 'low' ? T(lang, 'az', 'wenig', 'low') : T(lang, 'orta', 'mittel', 'medium')}${fx.decay ? ` · ${T(lang, 'yankı', 'Hall', 'reverb')} ${fmt(fx.decay, 1, lang)} s` : ''}`,
    sub: fx.kind === 'speech' ? T(lang, 'Konuşmada reverb yok: sözler net.', 'Sprache ohne Hall.', 'No reverb on speech.') : fx.kind === 'vocal' ? T(lang, 'Plate / hall; salon yankılıysa daha az ve kısa.', 'Plate / Hall; im halligen Saal weniger.', 'Plate / hall; less in reverberant rooms.') : undefined,
  });
  if (setup.mono) out.push({ key: 'pan', k: 'Pan', v: T(lang, 'Ortada (C) — mono', 'Mitte (C) — mono', 'Center (C) — mono') });
  if (spec.automix && s.group === 'vocal' && useOf(ch) !== 'sing') out.push({ key: 'automix', k: 'Automix', v: T(lang, 'Birden çok konuşma mikrofonu varsa aç', 'Bei mehreren Sprechermikros an', 'On with several speech mics'), sub: L(spec.automix, lang) });
  return out;
}
