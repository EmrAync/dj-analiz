import type { L10n, Lang } from '../model/types';
import { tr } from './tr';
import { de } from './de';
import { en } from './en';

export type TKey = keyof typeof tr;
export type TFn = (key: TKey, vars?: Record<string, string | number>) => string;

const DICTS: Record<Lang, Partial<Record<TKey, string>>> = { tr, de, en };

export function makeT(lang: Lang): TFn {
  const d = DICTS[lang] || tr;
  return (key, vars) => {
    let s = d[key] ?? tr[key] ?? String(key);
    if (vars) for (const k in vars) s = s.split('{' + k + '}').join(String(vars[k]));
    return s;
  };
}

export function L(v: L10n | undefined, lang: Lang): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  return v[lang] || v.tr;
}

export const LANGS: { id: Lang; name: string }[] = [
  { id: 'tr', name: 'Türkçe' },
  { id: 'de', name: 'Deutsch' },
  { id: 'en', name: 'English' },
];

// Sayı biçimi (virgül TR/DE, nokta EN)
export function fmt(n: number, digits = 1, lang: Lang = 'tr'): string {
  if (!isFinite(n)) return '–';
  const s = n.toFixed(digits);
  return lang === 'en' ? s : s.replace('.', ',');
}
