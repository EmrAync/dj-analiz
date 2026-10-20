import type { Asset, EquipDef, Project } from '../model/types';

// IndexedDB: projeler ve kişisel kütüphane (özel malzemeler + resimler).
// Tarayıcı izin vermezse (gizli pencere vb.) bellek içi yedeğe düşer.

const DB_NAME = 'sahnecad';
const DB_VER = 1;
let dbp: Promise<IDBDatabase | null> | null = null;
const mem = { projects: new Map<string, Project>(), lib: new Map<string, unknown>() };

function openDB(): Promise<IDBDatabase | null> {
  if (dbp) return dbp;
  dbp = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const r = indexedDB.open(DB_NAME, DB_VER);
      r.onupgradeneeded = () => {
        const db = r.result;
        if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('lib')) db.createObjectStore('lib');
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => resolve(null);
      r.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbp;
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  return openDB().then(
    (db) =>
      new Promise((resolve) => {
        if (!db) return resolve(undefined);
        try {
          const t = db.transaction(store, mode);
          const req = fn(t.objectStore(store));
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve(undefined);
        } catch {
          resolve(undefined);
        }
      }),
  );
}

export async function saveProject(p: Project): Promise<void> {
  mem.projects.set(p.id, p);
  await tx('projects', 'readwrite', (s) => s.put(p));
  try {
    localStorage.setItem('sahnecad.last', p.id);
  } catch {
    /* yok */
  }
}

export async function loadProject(id: string): Promise<Project | undefined> {
  const r = await tx<Project>('projects', 'readonly', (s) => s.get(id));
  return r || mem.projects.get(id);
}

export interface ProjectMeta {
  id: string;
  name: string;
  modified: number;
  items: number;
  eventType: string;
  date: string;
}

export async function listProjects(): Promise<ProjectMeta[]> {
  const all = (await tx<Project[]>('projects', 'readonly', (s) => s.getAll())) || [...mem.projects.values()];
  return all
    .map((p) => ({ id: p.id, name: p.name, modified: p.modified, items: p.items.length, eventType: p.meta?.eventType || '', date: p.meta?.date || '' }))
    .sort((a, b) => b.modified - a.modified);
}

export async function deleteProject(id: string): Promise<void> {
  mem.projects.delete(id);
  await tx('projects', 'readwrite', (s) => s.delete(id));
}

export function lastProjectId(): string | null {
  try {
    return localStorage.getItem('sahnecad.last');
  } catch {
    return null;
  }
}

// —— Kişisel kütüphane ——
export interface Library {
  defs: EquipDef[];
  assets: Record<string, Asset>;
}

export async function loadLibrary(): Promise<Library> {
  const r = (await tx<Library>('lib', 'readonly', (s) => s.get('main'))) || (mem.lib.get('main') as Library | undefined);
  return r || { defs: [], assets: {} };
}

export async function saveLibrary(lib: Library): Promise<void> {
  mem.lib.set('main', lib);
  await tx('lib', 'readwrite', (s) => s.put(lib, 'main'));
}

// —— Dosya ——
export function downloadText(name: string, text: string, mime = 'application/json'): void {
  const blob = new Blob([text], { type: mime + ';charset=utf-8' });
  downloadBlob(name, blob);
}

export function downloadBlob(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = accept;
    inp.onchange = () => resolve(inp.files?.[0] || null);
    inp.click();
  });
}

export function readText(f: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsText(f);
  });
}

// Resmi küçült (en fazla `max` piksel) ve data URL döndür
export function imageToAsset(f: File, max = 640): Promise<Asset> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const img = new Image();
      img.onload = () => {
        const sc = Math.min(1, max / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * sc));
        const h = Math.max(1, Math.round(img.height * sc));
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const ctx = c.getContext('2d')!;
        ctx.drawImage(img, 0, 0, w, h);
        const png = /png|svg|webp|gif/i.test(f.type);
        const data = c.toDataURL(png ? 'image/png' : 'image/jpeg', 0.86);
        resolve({ id: 'as' + Math.random().toString(36).slice(2, 10), name: f.name, data, w, h });
      };
      img.onerror = () => reject(new Error('image'));
      img.src = String(r.result);
    };
    r.onerror = () => reject(r.error);
    r.readAsDataURL(f);
  });
}

// Eski/yabancı dosyaları güvenli hale getir
export function normalizeProject(raw: unknown): Project | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Partial<Project>;
  if (!Array.isArray(p.areas) || !Array.isArray(p.items)) return null;
  return {
    schema: 1,
    id: p.id || 'pr' + Math.random().toString(36).slice(2, 10),
    name: p.name || 'Proje',
    created: p.created || Date.now(),
    modified: p.modified || Date.now(),
    meta: { client: '', eventType: 'dugun', date: '', time: '', venue: '', address: '', engineer: '', phone: '', guests: 100, notes: '', ...(p.meta || {}) },
    env: { tempC: 22, humidity: 50, wind: 0, rain: false, noiseLimit: 0, neighborDist: 0, curfew: '', ...(p.env || {}) },
    settings: { slackPct: 10, slackM: 1, level: -6, earH: 1.6, targetSpl: 100, crest: 6, ...(p.settings || {}) },
    areas: p.areas,
    items: p.items,
    cables: p.cables || [],
    zones: p.zones || [],
    notes: p.notes || [],
    defs: p.defs || [],
    defImages: p.defImages || {},
    assets: p.assets || {},
    done: p.done || {},
  };
}
