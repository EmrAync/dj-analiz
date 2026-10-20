// Proje nesnesi değişmez (immer) olduğu için türetilmiş verileri nesneye bağlı önbellekte tutarız.
const cache = new WeakMap<object, Map<string, unknown>>();

export function derive<T>(obj: object, key: string, fn: () => T): T {
  let m = cache.get(obj);
  if (!m) {
    m = new Map();
    cache.set(obj, m);
  }
  if (m.has(key)) return m.get(key) as T;
  const v = fn();
  m.set(key, v);
  return v;
}

export interface Pt {
  x: number;
  y: number;
}

export function dist(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function polyLen(pts: Pt[]): number {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += dist(pts[i - 1], pts[i]);
  return s;
}

// Çoklu çizginin orta noktası ve o noktadaki yön
export function polyMid(pts: Pt[]): { p: Pt; ang: number } {
  const total = polyLen(pts);
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const seg = dist(pts[i - 1], pts[i]);
    if (acc + seg >= total / 2 && seg > 0) {
      const t = (total / 2 - acc) / seg;
      const a = pts[i - 1];
      const b = pts[i];
      return { p: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, ang: Math.atan2(b.y - a.y, b.x - a.x) };
    }
    acc += seg;
  }
  return { p: pts[0] || { x: 0, y: 0 }, ang: 0 };
}

// Doğru parçası – dikdörtgen kesişimi (kablo köprüsü için)
export function segHitsRect(a: Pt, b: Pt, r: { x: number; y: number; w: number; d: number }): boolean {
  const inside = (p: Pt) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.d;
  if (inside(a) || inside(b)) return true;
  const edges: [Pt, Pt][] = [
    [{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }],
    [{ x: r.x + r.w, y: r.y }, { x: r.x + r.w, y: r.y + r.d }],
    [{ x: r.x + r.w, y: r.y + r.d }, { x: r.x, y: r.y + r.d }],
    [{ x: r.x, y: r.y + r.d }, { x: r.x, y: r.y }],
  ];
  return edges.some(([c, d]) => segSeg(a, b, c, d));
}

function segSeg(p1: Pt, p2: Pt, p3: Pt, p4: Pt): boolean {
  const d = (p2.x - p1.x) * (p4.y - p3.y) - (p2.y - p1.y) * (p4.x - p3.x);
  if (Math.abs(d) < 1e-12) return false;
  const u = ((p3.x - p1.x) * (p4.y - p3.y) - (p3.y - p1.y) * (p4.x - p3.x)) / d;
  const v = ((p3.x - p1.x) * (p2.y - p1.y) - (p3.y - p1.y) * (p2.x - p1.x)) / d;
  return u >= 0 && u <= 1 && v >= 0 && v <= 1;
}

export function clamp(v: number, a: number, b: number): number {
  return v < a ? a : v > b ? b : v;
}

export function round(v: number, step: number): number {
  return Math.round(v / step) * step;
}
