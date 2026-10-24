// Kanal EQ asistanı: kanal listesi (kadro), mikser, ölçüm ve uygulanan EQ
import { guessSource } from '../engine/chanEq';
import { patchList } from '../engine/lists';
import { mixerFor } from '../engine/mixers';
import { DRUMKIT, PA5X_OUTS, srcDef, type SourceId } from '../engine/sources';
import { L } from '../i18n';
import { getDef, uid } from '../model/project';
import type { ChanAnalysis, ChanEq, LineupTpl, MixChannel, MixerId, MixSetup, Project } from '../model/types';
import { publishLibrary } from './actions';
import { loadLibrary, saveLibrary } from './persist';
import { st } from './store';

export function detectMixer(p: Project): MixerId {
  for (const it of p.items) {
    const m = mixerFor(it.defId);
    if (m) return m;
  }
  return 'xr18';
}

export function ensureMix(): void {
  const p = st().project;
  if (p.mix) return;
  st().mutate((d) => {
    d.mix = { mixer: detectMixer(p), mono: true, channels: [] };
  });
}

const mixOf = (d: Project): MixSetup => (d.mix ||= { mixer: 'xr18', mono: true, channels: [] });

export function setMix(patch: Partial<Omit<MixSetup, 'channels'>>): void {
  st().mutate((d) => void Object.assign(mixOf(d as unknown as Project), patch));
}

function nextCh(m: MixSetup): number {
  return m.channels.reduce((mx, c) => Math.max(mx, c.ch), 0) + 1;
}

export function addChannels(list: { src: SourceId | string; name: string; use?: MixChannel['use'] }[]): string[] {
  const ids: string[] = [];
  st().mutate((d) => {
    const m = mixOf(d as unknown as Project);
    for (const x of list) {
      const id = uid('mc');
      ids.push(id);
      m.channels.push({ id, ch: nextCh(m), name: x.name, src: x.src, use: x.use });
    }
  });
  return ids;
}

export function addSource(src: SourceId): string | null {
  const lang = st().lang;
  if (src === ('pa5x' as SourceId)) return addChannels(PA5X_OUTS.map((o) => ({ src: o.src, name: L(o.name, lang) })))[0] ?? null;
  if (src === ('drumkit' as SourceId)) return addChannels(DRUMKIT.map((o) => ({ src: o.src, name: L(o.name, lang) })))[0] ?? null;
  const m = st().project.mix;
  const s = srcDef(src);
  const same = m?.channels.filter((c) => c.src === src).length || 0;
  return addChannels([{ src, name: L(s.name, lang) + (same ? ` ${same + 1}` : '') }])[0] ?? null;
}

export function updateChannel(id: string, patch: Partial<MixChannel>): void {
  st().mutate((d) => {
    const c = mixOf(d as unknown as Project).channels.find((x) => x.id === id);
    if (c) Object.assign(c, patch);
  });
}

export function removeChannel(id: string): void {
  st().mutate((d) => {
    const m = mixOf(d as unknown as Project);
    m.channels = m.channels.filter((c) => c.id !== id);
  });
}

export function saveMeas(id: string, meas: ChanAnalysis): void {
  updateChannel(id, { meas });
}

export function markApplied(id: string, eq: ChanEq): void {
  updateChannel(id, { applied: JSON.parse(JSON.stringify(eq)) as ChanEq, done: true });
}

// Projedeki giriş listesinden (mikrofonlar, enstrümanlar → mikser kanalları)
export function importFromProject(): number {
  const s = st();
  const p = s.project;
  const rows = patchList(p, s.lang);
  const have = new Set((p.mix?.channels || []).map((c) => c.name.toLowerCase()));
  const list: { src: string; name: string }[] = [];
  for (const r of rows) {
    if (have.has(r.channel.toLowerCase())) continue;
    const it = p.items.find((i) => i.id === r.sourceId);
    const def = it ? getDef(p, it.defId) : undefined;
    list.push({ src: guessSource(def?.id || '', def?.icon || '', r.channel + ' ' + (it?.name || '')), name: r.channel });
    have.add(r.channel.toLowerCase());
  }
  if (list.length) addChannels(list);
  return list.length;
}

// —— Kadrolar (kütüphane): aynı grup her işte aynı ——
export async function saveLineup(name: string): Promise<void> {
  const m = st().project.mix;
  if (!m) return;
  const lib = await loadLibrary();
  const tpl: LineupTpl = { id: uid('lu'), name, mixer: m.mixer, channels: m.channels.map(({ id, ch, name: n, src, use, voice, mic }) => ({ id, ch, name: n, src, use, voice, mic })) };
  lib.lineups = [tpl, ...(lib.lineups || []).filter((x) => x.name !== name)];
  await saveLibrary(lib);
  publishLibrary(lib);
}

export function applyLineup(tpl: LineupTpl): void {
  st().mutate((d) => {
    const m = mixOf(d as unknown as Project);
    m.mixer = tpl.mixer;
    m.channels = tpl.channels.map((c) => ({ ...c, id: uid('mc') }));
  });
}

export async function deleteLineup(id: string): Promise<void> {
  const lib = await loadLibrary();
  lib.lineups = (lib.lineups || []).filter((x) => x.id !== id);
  await saveLibrary(lib);
  publishLibrary(lib);
}
