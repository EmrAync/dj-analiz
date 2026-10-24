// Paketleme: çantalar, içindekiler, yükleme / geri toplama işaretleri
import { lineKey, suggestCases } from '../engine/packing';
import { makeT } from '../i18n';
import { uid } from '../model/project';
import type { CaseDef, CaseLine, Project } from '../model/types';
import { publishLibrary } from './actions';
import { imageToAsset, loadLibrary, saveLibrary } from './persist';
import { st } from './store';

export type PackMode = 'out' | 'back';

const COLORS = ['#2563eb', '#dc2626', '#16a34a', '#d97706', '#7c3aed', '#0891b2', '#db2777', '#64748b'];

const findCase = (p: Project, id: string) => p.cases?.find((c) => c.id === id);

export function addCase(name: string): string {
  const id = uid('cs');
  st().mutate((d) => {
    const n = d.cases?.length || 0;
    (d.cases ||= []).push({ id, name, desc: '', color: COLORS[n % COLORS.length], lines: [] });
  });
  return id;
}

export function updateCase(id: string, patch: Partial<Omit<CaseDef, 'id' | 'lines'>>): void {
  st().mutate((d) => {
    const c = findCase(d as unknown as Project, id);
    if (c) Object.assign(c, patch);
  });
}

export function deleteCase(id: string): void {
  st().mutate((d) => {
    d.cases = (d.cases || []).filter((c) => c.id !== id);
    if (d.packing) for (const k of Object.keys(d.packing)) if (k.startsWith(id + ':')) delete d.packing[k];
  });
}

// Aynı malzeme zaten varsa adedini artır
export function addLine(caseId: string, line: Omit<CaseLine, 'id'>): void {
  st().mutate((d) => {
    const c = findCase(d as unknown as Project, caseId);
    if (!c) return;
    const ex = line.kind !== 'text' ? c.lines.find((l) => lineKey(l) === lineKey(line)) : undefined;
    if (ex) ex.qty += line.qty;
    else c.lines.push({ ...line, id: uid('ln') });
  });
}

export function updateLine(caseId: string, lineId: string, patch: Partial<CaseLine>): void {
  st().mutate((d) => {
    const l = findCase(d as unknown as Project, caseId)?.lines.find((x) => x.id === lineId);
    if (l) Object.assign(l, patch);
  });
}

export function removeLine(caseId: string, lineId: string): void {
  st().mutate((d) => {
    const c = findCase(d as unknown as Project, caseId);
    if (c) c.lines = c.lines.filter((l) => l.id !== lineId);
    if (d.packing) delete d.packing[caseId + ':' + lineId];
  });
}

export function moveLine(fromCase: string, lineId: string, toCase: string): void {
  st().mutate((d) => {
    const p = d as unknown as Project;
    const a = findCase(p, fromCase);
    const b = findCase(p, toCase);
    const l = a?.lines.find((x) => x.id === lineId);
    if (!a || !b || !l) return;
    a.lines = a.lines.filter((x) => x.id !== lineId);
    const ex = l.kind !== 'text' ? b.lines.find((x) => lineKey(x) === lineKey(l)) : undefined;
    if (ex) ex.qty += l.qty;
    else b.lines.push(l);
  });
}

// Malzeme listesinde olup çantada olmayanları türlerine göre çantalara dağıt
export function suggestPacking(): number {
  const s = st();
  const t = makeT(s.lang);
  const before = (s.project.cases || []).reduce((n, c) => n + c.lines.length, 0);
  const cases = suggestCases(s.project, t, s.lang);
  const after = cases.reduce((n, c) => n + c.lines.length, 0);
  if (after === before && cases.length === (s.project.cases || []).length) return 0;
  s.mutate((d) => {
    d.cases = cases;
  });
  return after - before;
}

// İşaretler geri alma geçmişine yazılmaz (sahada sık dokunulur)
export function setPacked(caseId: string, lineId: string, mode: PackMode, n: number): void {
  st().mutate((d) => {
    const k = caseId + ':' + lineId;
    const pk = (d.packing ||= {});
    const cur = { ...(pk[k] || {}) };
    if (n > 0) cur[mode] = n;
    else delete cur[mode];
    if (cur.out == null && cur.back == null) delete pk[k];
    else pk[k] = cur;
  }, false);
}

export function setCaseAll(caseId: string, mode: PackMode, on: boolean): void {
  const c = findCase(st().project, caseId);
  if (!c) return;
  st().mutate((d) => {
    const pk = (d.packing ||= {});
    for (const l of c.lines) {
      const k = caseId + ':' + l.id;
      const cur = { ...(pk[k] || {}) };
      if (on) cur[mode] = l.qty;
      else delete cur[mode];
      if (cur.out == null && cur.back == null) delete pk[k];
      else pk[k] = cur;
    }
  }, false);
}

export function resetPacking(mode: PackMode | 'all'): void {
  st().mutate((d) => {
    if (mode === 'all') d.packing = {};
    else
      for (const [k, v] of Object.entries(d.packing || {})) {
        const cur = { ...v };
        delete cur[mode];
        if (cur.out == null && cur.back == null) delete d.packing![k];
        else d.packing![k] = cur;
      }
  });
}

export async function setCaseImage(caseId: string, file: File): Promise<void> {
  const a = await imageToAsset(file, 480);
  updateCase(caseId, { image: a.data });
}

// —— Kütüphane: çantalar her işte aynı ——
export async function saveCaseTpl(caseId: string): Promise<void> {
  const c = findCase(st().project, caseId);
  if (!c) return;
  const lib = await loadLibrary();
  const list = (lib.cases || []).filter((x) => x.id !== c.id && x.name !== c.name);
  lib.cases = [JSON.parse(JSON.stringify(c)) as CaseDef, ...list];
  await saveLibrary(lib);
  publishLibrary(lib);
}

export function addCaseFromTpl(tpl: CaseDef): string {
  const id = uid('cs');
  st().mutate((d) => {
    const c = JSON.parse(JSON.stringify(tpl)) as CaseDef;
    c.id = id;
    c.lines = c.lines.map((l) => ({ ...l, id: uid('ln') }));
    (d.cases ||= []).push(c);
  });
  return id;
}

export async function deleteCaseTpl(id: string): Promise<void> {
  const lib = await loadLibrary();
  lib.cases = (lib.cases || []).filter((x) => x.id !== id);
  await saveLibrary(lib);
  publishLibrary(lib);
}
