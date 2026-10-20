import { useMemo } from 'react';
import * as THREE from 'three';
import { arrayElements } from '../../engine/acoustics';
import type { EquipDef, Item } from '../../model/types';
import { grilleTexture, iconTexture, imageTexture, ledTexture } from './textures';

export const DEG = Math.PI / 180;

// —— Ortak malzemeler (tek sefer oluşturulur) ——
let _m: ReturnType<typeof makeMats> | null = null;
function makeMats() {
  const std = (color: string, roughness = 0.7, metalness = 0.1, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
  return {
    cab: std('#2a2d34', 0.78, 0.08),
    cab2: std('#3a3f48', 0.7, 0.1),
    grille: new THREE.MeshStandardMaterial({ map: grilleTexture(), roughness: 0.55, metalness: 0.45, color: '#ffffff' }),
    black: std('#141519', 0.6, 0.2),
    metal: std('#a6adb7', 0.32, 0.8),
    chrome: std('#dfe3e8', 0.15, 1),
    dark: std('#1c1f24', 0.5, 0.3),
    wood: std('#a77b4f', 0.65, 0.05),
    stage: std('#30343b', 0.85, 0.05),
    white: std('#f3f2ee', 0.85, 0.02),
    cloth: std('#fbfaf6', 1, 0),
    gold: std('#c9a24f', 0.35, 0.65),
    red: std('#c0392b', 0.5, 0.15),
    blue: std('#2563eb', 0.5, 0.15),
    teal: std('#0d9488', 0.5, 0.1),
    yellow: std('#eab308', 0.6, 0.05),
    skin: std('#8a96a8', 0.9, 0),
    shirt: std('#55637a', 0.9, 0),
    glass: new THREE.MeshPhysicalMaterial({ color: '#bcd7f0', roughness: 0.05, metalness: 0, transmission: 0.6, transparent: true, opacity: 0.35 }),
    led: std('#ffffff', 0.4, 0, { emissive: new THREE.Color('#9b8cff'), emissiveIntensity: 0.9 }),
    ledWarm: std('#fff3c4', 0.4, 0, { emissive: new THREE.Color('#ffd27a'), emissiveIntensity: 1.2 }),
    green: std('#16a34a', 0.6, 0.05),
    pink: std('#f9a8d4', 0.8, 0),
    drumShell: std('#7f1d1d', 0.35, 0.3),
    drumHead: std('#ece7dc', 0.85, 0),
    wall: std('#cfd4dc', 0.95, 0),
  };
}
export function mats() {
  if (!_m) _m = makeMats();
  return _m;
}

type V3 = [number, number, number];

function B({ s, p = [0, 0, 0], m, r, cast = true }: { s: V3; p?: V3; m: THREE.Material; r?: V3; cast?: boolean }) {
  return (
    <mesh position={p} rotation={r} material={m} castShadow={cast} receiveShadow>
      <boxGeometry args={s} />
    </mesh>
  );
}

function Cyl({ r, h, p = [0, 0, 0], m, rot, seg = 24, r2 }: { r: number; h: number; p?: V3; m: THREE.Material; rot?: V3; seg?: number; r2?: number }) {
  return (
    <mesh position={p} rotation={rot} material={m} castShadow receiveShadow>
      <cylinderGeometry args={[r2 ?? r, r, h, seg]} />
    </mesh>
  );
}

function Rod({ a, b, r, m }: { a: V3; b: V3; r: number; m: THREE.Material }) {
  const { pos, quat, len } = useMemo(() => {
    const va = new THREE.Vector3(...a);
    const vb = new THREE.Vector3(...b);
    const dir = vb.clone().sub(va);
    const len = dir.length();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    return { pos: va.add(vb).multiplyScalar(0.5), quat: q, len };
  }, [a[0], a[1], a[2], b[0], b[1], b[2]]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <mesh position={pos} quaternion={quat} material={m} castShadow>
      <cylinderGeometry args={[r, r, len, 8]} />
    </mesh>
  );
}

function Decal({ tex, w, h, p, r }: { tex: THREE.Texture; w: number; h: number; p: V3; r?: V3 }) {
  return (
    <mesh position={p} rotation={r}>
      <planeGeometry args={[w, h]} />
      <meshStandardMaterial map={tex} transparent roughness={0.6} />
    </mesh>
  );
}

// —————————— Stand / direk ——————————
export function Tripod({ h, spread = 0.55, m }: { h: number; spread?: number; m?: THREE.Material }) {
  const M = mats();
  const mat = m || M.black;
  const legTop = Math.min(0.55, h * 0.35);
  const legs = [0, 120, 240].map((a) => [Math.sin(a * DEG) * spread, 0, Math.cos(a * DEG) * spread] as V3);
  return (
    <group>
      <Cyl r={0.018} h={h} p={[0, h / 2, 0]} m={mat} seg={10} />
      <Cyl r={0.026} h={0.25} p={[0, legTop + 0.12, 0]} m={M.dark} seg={10} />
      {legs.map((l, i) => (
        <Rod key={i} a={[0, legTop, 0]} b={l} r={0.012} m={mat} />
      ))}
    </group>
  );
}

// —————————— Hoparlörler ——————————
function SpeakerBox({ w, h, d, horn = true, two = false }: { w: number; h: number; d: number; horn?: boolean; two?: boolean }) {
  const M = mats();
  const ring = Math.min(w, h) * 0.36;
  return (
    <group>
      <B s={[w, h, d]} m={M.cab} />
      <mesh position={[0, 0, d / 2 + 0.003]} material={M.grille}>
        <planeGeometry args={[w * 0.92, h * 0.94]} />
      </mesh>
      {horn ? <B s={[w * 0.55, h * 0.13, 0.012]} p={[0, h * 0.3, d / 2 + 0.008]} m={M.black} cast={false} /> : null}
      {two ? (
        <>
          <mesh position={[-w * 0.24, 0, d / 2 + 0.008]} material={M.metal}>
            <torusGeometry args={[ring * 0.62, 0.007, 8, 32]} />
          </mesh>
          <mesh position={[w * 0.24, 0, d / 2 + 0.008]} material={M.metal}>
            <torusGeometry args={[ring * 0.62, 0.007, 8, 32]} />
          </mesh>
        </>
      ) : (
        <mesh position={[0, horn ? -h * 0.1 : 0, d / 2 + 0.008]} material={M.metal}>
          <torusGeometry args={[ring, 0.007, 8, 32]} />
        </mesh>
      )}
      <B s={[w * 0.3, 0.025, 0.05]} p={[0, h / 2 + 0.012, 0]} m={M.black} cast={false} />
    </group>
  );
}

function Speaker({ w, h, d, tilt }: { w: number; h: number; d: number; tilt: number }) {
  return (
    <group position={[0, h / 2, 0]} rotation={[-tilt * DEG, 0, 0]}>
      <SpeakerBox w={w} h={h} d={d} />
    </group>
  );
}

function Sub({ w, h, d }: { w: number; h: number; d: number }) {
  return (
    <group position={[0, h / 2, 0]}>
      <SpeakerBox w={w} h={h} d={d} horn={false} two={w > 0.95} />
    </group>
  );
}

function Wedge({ w, h, d }: { w: number; h: number; d: number }) {
  const M = mats();
  const geo = useMemo(() => {
    const s = new THREE.Shape();
    // u = -z, v = y
    s.moveTo(d / 2, 0);
    s.lineTo(-d / 2, 0);
    s.lineTo(-d / 2, h * 0.32);
    s.lineTo(d / 2, h);
    s.lineTo(d / 2, 0);
    const g = new THREE.ExtrudeGeometry(s, { depth: w, bevelEnabled: false });
    g.rotateY(Math.PI / 2);
    g.translate(-w / 2, 0, 0);
    return g;
  }, [w, h, d]);
  // eğik yüz: z=+d/2,y=.32h → z=-d/2,y=h
  const nz = h * 0.68;
  const ny = d;
  const nl = Math.hypot(nz, ny);
  const alpha = -Math.asin(ny / nl);
  const faceLen = Math.hypot(d, h * 0.68);
  return (
    <group>
      <mesh geometry={geo} material={M.cab} castShadow receiveShadow />
      <mesh position={[0, (h * 0.32 + h) / 2, 0.004]} rotation={[alpha, 0, 0]} material={M.grille}>
        <planeGeometry args={[w * 0.9, faceLen * 0.88]} />
      </mesh>
    </group>
  );
}

function LineArray({ it, def, ceiling }: { it: Item; def: EquipDef; ceiling: number }) {
  const M = mats();
  const els = arrayElements(it, def.h, def.d, 0);
  const top = els.length ? els[0].z + def.h / 2 : 0;
  return (
    <group>
      {els.map((e, i) => (
        <group key={i} position={[0, e.z, e.dy]} rotation={[-e.pitch * DEG, 0, 0]}>
          <B s={[def.w, def.h * 0.98, def.d]} m={M.cab} />
          <mesh position={[0, 0, def.d / 2 + 0.003]} material={M.grille}>
            <planeGeometry args={[def.w * 0.95, def.h * 0.85]} />
          </mesh>
        </group>
      ))}
      <B s={[def.w * 1.05, 0.06, def.d * 1.1]} p={[0, top + 0.05, 0]} m={M.metal} />
      {ceiling > top + 0.2 ? <Rod a={[0, top + 0.08, 0]} b={[0, ceiling, 0]} r={0.01} m={M.chrome} /> : null}
    </group>
  );
}

function Column({ w, h, d }: { w: number; h: number; d: number }) {
  const M = mats();
  const bh = Math.min(0.6, h * 0.3);
  return (
    <group>
      <group position={[0, bh / 2, 0]}>
        <SpeakerBox w={w} h={bh} d={d} horn={false} />
      </group>
      <B s={[w * 0.4, h - bh, d * 0.4]} p={[0, bh + (h - bh) / 2, 0]} m={M.cab} />
      <mesh position={[0, bh + (h - bh) / 2, d * 0.2 + 0.003]} material={M.grille}>
        <planeGeometry args={[w * 0.36, (h - bh) * 0.96]} />
      </mesh>
    </group>
  );
}

// —————————— Cihazlar ——————————
function DeskDevice({ w, h, d, icon, color, top = true }: { w: number; h: number; d: number; icon: string; color: string; top?: boolean }) {
  const M = mats();
  const tex = iconTexture(icon, color, '#1b1e24');
  return (
    <group>
      <B s={[w, h, d]} p={[0, h / 2, 0]} m={M.dark} />
      {top ? <Decal tex={tex} w={Math.min(w, d) * 0.92} h={Math.min(w, d) * 0.92} p={[0, h + 0.002, 0]} r={[-Math.PI / 2, 0, 0]} /> : null}
    </group>
  );
}

function Console({ w, h, d, color }: { w: number; h: number; d: number; color: string }) {
  const M = mats();
  const tex = iconTexture('mixer', color, '#1b1e24');
  return (
    <group>
      <B s={[w, h * 0.55, d]} p={[0, (h * 0.55) / 2, 0]} m={M.dark} />
      <group position={[0, h * 0.55, 0]} rotation={[-8 * DEG, 0, 0]}>
        <B s={[w, 0.03, d * 0.98]} p={[0, 0.015, 0]} m={M.cab2} />
        <Decal tex={tex} w={Math.min(w, d * 1.3) * 0.92} h={d * 0.9} p={[0, 0.032, 0]} r={[-Math.PI / 2, 0, 0]} />
      </group>
      <B s={[w * 0.96, h * 0.35, 0.06]} p={[0, h * 0.75, -d / 2 + 0.03]} m={M.black} />
    </group>
  );
}

function Rack({ w, h, d, icon, color, img }: { w: number; h: number; d: number; icon: string; color: string; img?: string }) {
  const M = mats();
  const tex = img ? imageTexture(img) : iconTexture(icon, color, '#16181d');
  const fh = Math.max(h, 0.044);
  return (
    <group>
      <B s={[w, fh, d]} p={[0, fh / 2, 0]} m={M.dark} />
      <Decal tex={tex} w={Math.min(fh * 0.9, w) * (img ? 1 : 1)} h={fh * 0.9} p={[w * 0.25, fh / 2, d / 2 + 0.002]} />
      <B s={[w * 0.04, fh, 0.01]} p={[-w / 2 + w * 0.02, fh / 2, d / 2 + 0.004]} m={M.metal} cast={false} />
      <B s={[w * 0.04, fh, 0.01]} p={[w / 2 - w * 0.02, fh / 2, d / 2 + 0.004]} m={M.metal} cast={false} />
    </group>
  );
}

function Laptop({ w, d }: { w: number; d: number }) {
  const M = mats();
  return (
    <group>
      <B s={[w, 0.015, d]} p={[0, 0.0075, 0]} m={M.metal} />
      <group position={[0, 0.015, -d / 2]} rotation={[-15 * DEG, 0, 0]}>
        <B s={[w, d, 0.01]} p={[0, d / 2, 0]} m={M.metal} />
        <mesh position={[0, d / 2, 0.006]} material={M.led}>
          <planeGeometry args={[w * 0.9, d * 0.85]} />
        </mesh>
      </group>
    </group>
  );
}

function Turntable({ w, h, d }: { w: number; h: number; d: number }) {
  const M = mats();
  return (
    <group>
      <B s={[w, h, d]} p={[0, h / 2, 0]} m={M.dark} />
      <Cyl r={Math.min(w, d) * 0.4} h={0.012} p={[-w * 0.08, h + 0.006, 0]} m={M.black} seg={40} />
      <Cyl r={0.04} h={0.014} p={[-w * 0.08, h + 0.013, 0]} m={M.red} />
      <Rod a={[w * 0.38, h + 0.03, -d * 0.35]} b={[w * 0.1, h + 0.03, d * 0.1]} r={0.006} m={M.chrome} />
    </group>
  );
}

// —————————— Mikrofon ——————————
function Mic({ it, wireless }: { it: Item; wireless: boolean }) {
  const M = mats();
  const z = it.z;
  const st = it.stand || 'none';
  const head = (
    <group>
      <Cyl r={0.02} r2={0.024} h={wireless ? 0.22 : 0.16} p={[0, 0, 0]} rot={[Math.PI / 2 - 0.35, 0, 0]} m={M.black} seg={12} />
      <mesh position={[0, 0.03, 0.085]} material={M.metal}>
        <sphereGeometry args={[0.03, 14, 10]} />
      </mesh>
    </group>
  );
  if (st === 'boom' || st === 'short') {
    const poleH = Math.max(0.25, z - 0.25);
    return (
      <group position={[0, -z, 0]}>
        <Tripod h={poleH} spread={st === 'short' ? 0.25 : 0.35} />
        <Rod a={[0, poleH, -0.35]} b={[0, z, 0]} r={0.008} m={M.black} />
        <group position={[0, z, 0]}>{head}</group>
      </group>
    );
  }
  if (st === 'straight') {
    return (
      <group position={[0, -z, 0]}>
        <Cyl r={0.15} h={0.02} p={[0, 0.01, 0]} m={M.black} seg={28} />
        <Cyl r={0.012} h={z} p={[0, z / 2, 0]} m={M.black} seg={10} />
        <group position={[0, z, 0]}>{head}</group>
      </group>
    );
  }
  if (st === 'table') {
    return (
      <group>
        <Cyl r={0.07} h={0.02} p={[0, 0.01, 0]} m={M.black} />
        <Rod a={[0, 0.02, 0]} b={[0, 0.35, 0.12]} r={0.005} m={M.black} />
        <group position={[0, 0.35, 0.12]}>{head}</group>
      </group>
    );
  }
  return <group position={[0, 0.03, 0]}>{head}</group>;
}

// —————————— Kişi ve enstrümanlar ——————————
export function Person({ seated = false, color }: { seated?: boolean; color?: THREE.Material }) {
  const M = mats();
  const body = color || M.shirt;
  const hip = seated ? 0.5 : 0.95;
  return (
    <group>
      {!seated ? (
        <>
          <Cyl r={0.07} h={0.9} p={[-0.1, 0.45, 0]} m={M.dark} seg={10} />
          <Cyl r={0.07} h={0.9} p={[0.1, 0.45, 0]} m={M.dark} seg={10} />
        </>
      ) : (
        <>
          <B s={[0.36, 0.45, 0.4]} p={[0, 0.225, -0.05]} m={M.dark} />
        </>
      )}
      <mesh position={[0, hip + 0.32, 0]} material={body} castShadow>
        <capsuleGeometry args={[0.17, 0.42, 6, 12]} />
      </mesh>
      <mesh position={[0, hip + 0.74, 0]} material={M.skin} castShadow>
        <sphereGeometry args={[0.11, 16, 12]} />
      </mesh>
    </group>
  );
}

function Performer({ kind }: { kind: string }) {
  const M = mats();
  return (
    <group>
      <Person />
      {kind === 'pipe' ? <Cyl r={0.012} r2={0.05} h={0.45} p={[0, 1.42, 0.25]} rot={[Math.PI / 2 + 0.5, 0, 0]} m={M.wood} seg={12} /> : null}
      {kind === 'string' ? (
        <group position={[0, 1.2, 0.2]} rotation={[0, 0, -0.9]}>
          <mesh material={M.wood} castShadow scale={[1, 1.3, 0.5]}>
            <sphereGeometry args={[0.14, 16, 12]} />
          </mesh>
          <Cyl r={0.018} h={0.6} p={[0, 0.42, 0]} m={M.wood} seg={8} />
        </group>
      ) : null}
      {kind === 'guitar' ? (
        <group position={[0, 1.05, 0.2]} rotation={[0, 0, -1.1]}>
          <mesh material={M.red} castShadow scale={[1, 1.25, 0.35]}>
            <sphereGeometry args={[0.18, 18, 12]} />
          </mesh>
          <Cyl r={0.02} h={0.65} p={[0, 0.48, 0]} m={M.wood} seg={8} />
        </group>
      ) : null}
    </group>
  );
}

function DrumKit({ w, d }: { w: number; d: number }) {
  const M = mats();
  const s = Math.min(w / 2, d / 1.8);
  return (
    <group scale={[s, s, s]}>
      <Cyl r={0.28} h={0.42} p={[0, 0.3, 0.15]} rot={[Math.PI / 2, 0, 0]} m={M.drumShell} />
      <Cyl r={0.275} h={0.43} p={[0, 0.3, 0.15]} rot={[Math.PI / 2, 0, 0]} m={M.drumHead} seg={24} />
      <Cyl r={0.18} h={0.14} p={[-0.38, 0.65, 0.05]} m={M.chrome} />
      <Cyl r={0.14} h={0.2} p={[-0.17, 0.85, 0.12]} rot={[0.3, 0, 0]} m={M.drumShell} />
      <Cyl r={0.14} h={0.2} p={[0.17, 0.85, 0.12]} rot={[0.3, 0, 0]} m={M.drumShell} />
      <Cyl r={0.2} h={0.42} p={[0.5, 0.45, -0.05]} m={M.drumShell} />
      <Cyl r={0.18} h={0.01} p={[-0.65, 0.95, 0.05]} m={M.gold} seg={28} />
      <Cyl r={0.008} h={0.95} p={[-0.65, 0.47, 0.05]} m={M.chrome} seg={6} />
      <Cyl r={0.23} h={0.01} p={[-0.55, 1.3, 0.3]} rot={[0.25, 0, 0.1]} m={M.gold} seg={28} />
      <Cyl r={0.008} h={1.3} p={[-0.55, 0.65, 0.3]} m={M.chrome} seg={6} />
      <Cyl r={0.25} h={0.01} p={[0.62, 1.2, 0.25]} rot={[0.25, 0, -0.1]} m={M.gold} seg={28} />
      <Cyl r={0.008} h={1.2} p={[0.62, 0.6, 0.25]} m={M.chrome} seg={6} />
      <Cyl r={0.17} h={0.06} p={[0, 0.5, -0.45]} m={M.black} />
      <Cyl r={0.025} h={0.47} p={[0, 0.235, -0.45]} m={M.chrome} />
      <group position={[0, 0, -0.55]}>
        <Person seated />
      </group>
    </group>
  );
}

function Davul() {
  const M = mats();
  return (
    <group>
      <group position={[0, 0, -0.3]}>
        <Person />
      </group>
      <Cyl r={0.3} h={0.34} p={[0, 1.0, 0.0]} rot={[0, 0, Math.PI / 2]} m={M.drumShell} />
      <Cyl r={0.295} h={0.35} p={[0, 1.0, 0.0]} rot={[0, 0, Math.PI / 2]} m={M.drumHead} />
    </group>
  );
}

function Darbuka({ w }: { w: number }) {
  const M = mats();
  const geo = useMemo(() => {
    const pts = [new THREE.Vector2(0.001, 0), new THREE.Vector2(0.09, 0), new THREE.Vector2(0.07, 0.15), new THREE.Vector2(0.08, 0.3), new THREE.Vector2(0.16, 0.42), new THREE.Vector2(0.17, 0.46), new THREE.Vector2(0.001, 0.46)];
    return new THREE.LatheGeometry(pts, 28);
  }, []);
  return (
    <group scale={[w / 0.5, 1, w / 0.5]}>
      <mesh geometry={geo} material={M.gold} castShadow />
    </group>
  );
}

function Keyboard({ it, w, d }: { it: Item; w: number; d: number }) {
  const M = mats();
  const z = it.mount === 'floor' ? 0.8 : it.z;
  const tex = iconTexture('keyboard', '#e5e7eb', '#111318', 256);
  return (
    <group position={[0, it.mount === 'floor' ? 0 : -it.z, 0]}>
      <Rod a={[-w * 0.35, 0, -d * 0.3]} b={[w * 0.35, z - 0.05, d * 0.3]} r={0.015} m={M.black} />
      <Rod a={[w * 0.35, 0, -d * 0.3]} b={[-w * 0.35, z - 0.05, d * 0.3]} r={0.015} m={M.black} />
      <Rod a={[-w * 0.35, 0, d * 0.3]} b={[w * 0.35, z - 0.05, -d * 0.3]} r={0.015} m={M.black} />
      <Rod a={[w * 0.35, 0, d * 0.3]} b={[-w * 0.35, z - 0.05, -d * 0.3]} r={0.015} m={M.black} />
      <B s={[w, 0.12, d * 0.8]} p={[0, z + 0.06, 0]} m={M.dark} />
      <Decal tex={tex} w={w * 0.95} h={d * 0.75} p={[0, z + 0.122, 0]} r={[-Math.PI / 2, 0, 0]} />
      <group position={[0, 0, -d * 0.9]}>
        <Person />
      </group>
    </group>
  );
}

function Piano({ w, d }: { w: number; d: number }) {
  const M = mats();
  const geo = useMemo(() => {
    const s = new THREE.Shape();
    s.moveTo(-w / 2, -d / 2);
    s.lineTo(w / 2, -d / 2);
    s.lineTo(w / 2, d * 0.05);
    s.bezierCurveTo(w / 2, d * 0.45, w * 0.1, d * 0.2, -w * 0.05, d / 2);
    s.lineTo(-w / 2, d / 2);
    s.lineTo(-w / 2, -d / 2);
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.3, bevelEnabled: false });
    g.rotateX(Math.PI / 2);
    return g;
  }, [w, d]);
  return (
    <group>
      <mesh geometry={geo} position={[0, 1.0, 0]} material={M.black} castShadow />
      {[
        [-w * 0.4, -d * 0.4],
        [w * 0.4, -d * 0.4],
        [-w * 0.35, d * 0.4],
      ].map(([x, z], i) => (
        <Cyl key={i} r={0.05} h={0.7} p={[x, 0.35, z]} m={M.black} />
      ))}
      <B s={[w, 0.1, 0.3]} p={[0, 0.75, -d / 2 - 0.1]} m={M.white} />
    </group>
  );
}

function AmpCombo({ w, h, d }: { w: number; h: number; d: number }) {
  const M = mats();
  return (
    <group>
      <B s={[w, h, d]} p={[0, h / 2, 0]} m={M.black} />
      <mesh position={[0, h * 0.42, d / 2 + 0.003]} material={M.grille}>
        <planeGeometry args={[w * 0.9, h * 0.72]} />
      </mesh>
      <B s={[w * 0.9, h * 0.12, 0.01]} p={[0, h * 0.88, d / 2 + 0.006]} m={M.gold} cast={false} />
    </group>
  );
}

// —————————— Işık ——————————
function MovingHead({ w, h, d, flown, tilt }: { w: number; h: number; d: number; flown: boolean; tilt: number }) {
  const M = mats();
  const inner = (
    <group>
      <B s={[w, h * 0.22, d]} p={[0, h * 0.11, 0]} m={M.black} />
      <B s={[0.03, h * 0.55, d * 0.35]} p={[-w * 0.42, h * 0.5, 0]} m={M.black} />
      <B s={[0.03, h * 0.55, d * 0.35]} p={[w * 0.42, h * 0.5, 0]} m={M.black} />
      <group position={[0, h * 0.62, 0]} rotation={[-(tilt || 20) * DEG, 0, 0]}>
        <Cyl r={w * 0.3} h={w * 0.7} rot={[Math.PI / 2, 0, 0]} m={M.dark} />
        <Cyl r={w * 0.22} h={0.01} p={[0, 0, w * 0.35 + 0.006]} rot={[Math.PI / 2, 0, 0]} m={M.ledWarm} />
      </group>
    </group>
  );
  return flown ? <group position={[0, h, 0]} rotation={[Math.PI, 0, 0]}>{inner}</group> : inner;
}

function Par({ w, h, tilt }: { w: number; h: number; tilt: number }) {
  const M = mats();
  return (
    <group position={[0, h / 2, 0]}>
      <group rotation={[-(tilt || 0) * DEG, 0, 0]}>
        <Cyl r={w * 0.45} h={h * 0.75} rot={[Math.PI / 2, 0, 0]} m={M.black} />
        <Cyl r={w * 0.4} h={0.01} p={[0, 0, h * 0.38 + 0.005]} rot={[Math.PI / 2, 0, 0]} m={M.led} />
      </group>
      <B s={[w * 1.1, 0.02, 0.03]} p={[0, h / 2, 0]} m={M.black} />
    </group>
  );
}

function LedBar({ w, h, d }: { w: number; h: number; d: number }) {
  const M = mats();
  return (
    <group>
      <B s={[w, h, d]} p={[0, h / 2, 0]} m={M.black} />
      <mesh position={[0, h / 2, d / 2 + 0.003]} material={M.led}>
        <planeGeometry args={[w * 0.95, h * 0.5]} />
      </mesh>
    </group>
  );
}

function TBar({ w, h }: { w: number; h: number }) {
  const M = mats();
  return (
    <group>
      <Tripod h={h - 0.1} spread={0.6} />
      <Cyl r={0.018} h={w} p={[0, h - 0.1, 0]} rot={[0, 0, Math.PI / 2]} m={M.black} seg={10} />
    </group>
  );
}

function Followspot({ h, d }: { h: number; d: number }) {
  const M = mats();
  return (
    <group>
      <Tripod h={h - 0.3} spread={0.45} />
      <Cyl r={0.12} r2={0.09} h={d} p={[0, h - 0.15, 0]} rot={[Math.PI / 2, 0, 0]} m={M.black} />
      <Cyl r={0.08} h={0.01} p={[0, h - 0.15, d / 2 + 0.005]} rot={[Math.PI / 2, 0, 0]} m={M.ledWarm} />
    </group>
  );
}

// —————————— Truss / rigging ——————————
function Truss({ w, h, d }: { w: number; h: number; d: number }) {
  const M = mats();
  const s = Math.min(h, d) / 2 - 0.02;
  const corners: [number, number][] = [
    [-s, -s],
    [s, -s],
    [s, s],
    [-s, s],
  ];
  const n = Math.max(1, Math.round(w / 0.5));
  const braces: { a: V3; b: V3 }[] = [];
  for (let i = 0; i < n; i++) {
    const x0 = -w / 2 + (i * w) / n;
    const x1 = x0 + w / n;
    for (let f = 0; f < 4; f++) {
      const c0 = corners[f];
      const c1 = corners[(f + 1) % 4];
      braces.push(i % 2 ? { a: [x0, c0[0] + h / 2, c0[1]], b: [x1, c1[0] + h / 2, c1[1]] } : { a: [x0, c1[0] + h / 2, c1[1]], b: [x1, c0[0] + h / 2, c0[1]] });
    }
  }
  return (
    <group>
      {corners.map(([y, z], i) => (
        <Cyl key={i} r={0.024} h={w} p={[0, y + h / 2, z]} rot={[0, 0, Math.PI / 2]} m={M.metal} seg={10} />
      ))}
      {braces.map((b, i) => (
        <Rod key={i} a={b.a} b={b.b} r={0.008} m={M.metal} />
      ))}
    </group>
  );
}

function TrussTower({ w, h }: { w: number; h: number }) {
  const M = mats();
  return (
    <group>
      <B s={[w * 1.6, 0.03, w * 1.6]} p={[0, 0.015, 0]} m={M.metal} />
      <group position={[0, h / 2, 0]} rotation={[0, 0, Math.PI / 2]}>
        <group position={[0, -0.145, 0]}>
          <Truss w={h} h={0.29} d={0.29} />
        </group>
      </group>
      <B s={[0.4, 0.3, 0.4]} p={[0, h - 0.4, 0]} m={M.black} />
    </group>
  );
}

function Hoist({ w, h }: { w: number; h: number }) {
  const M = mats();
  return (
    <group>
      <B s={[w * 0.8, h * 0.45, w * 0.6]} p={[0, h * 0.6, 0]} m={M.black} />
      <Rod a={[0, h * 0.35, 0]} b={[0, 0, 0]} r={0.008} m={M.chrome} />
      <Rod a={[0, h * 0.85, 0]} b={[0, h * 1.3, 0]} r={0.008} m={M.chrome} />
    </group>
  );
}

// —————————— Görüntü ——————————
function LedWall({ w, h, d, img }: { w: number; h: number; d: number; img?: string }) {
  const M = mats();
  const tex = img ? imageTexture(img) : ledTexture();
  return (
    <group>
      <B s={[w, h, d]} p={[0, h / 2, 0]} m={M.black} />
      <mesh position={[0, h / 2, d / 2 + 0.003]}>
        <planeGeometry args={[w * 0.995, h * 0.995]} />
        <meshStandardMaterial map={tex} emissive="#ffffff" emissiveMap={tex} emissiveIntensity={0.85} roughness={0.5} />
      </mesh>
      <Rod a={[-w * 0.4, 0, -0.6]} b={[-w * 0.4, h * 0.8, -d / 2]} r={0.02} m={M.metal} />
      <Rod a={[w * 0.4, 0, -0.6]} b={[w * 0.4, h * 0.8, -d / 2]} r={0.02} m={M.metal} />
    </group>
  );
}

function Screen({ w, h }: { w: number; h: number }) {
  const M = mats();
  const sh = h * 0.65;
  return (
    <group>
      <B s={[w, sh, 0.03]} p={[0, h - sh / 2, 0]} m={M.black} />
      <mesh position={[0, h - sh / 2, 0.017]} material={M.white}>
        <planeGeometry args={[w * 0.96, sh * 0.94]} />
      </mesh>
      <Rod a={[-w / 2 + 0.05, 0, 0]} b={[-w / 2 + 0.05, h, 0]} r={0.02} m={M.black} />
      <Rod a={[w / 2 - 0.05, 0, 0]} b={[w / 2 - 0.05, h, 0]} r={0.02} m={M.black} />
    </group>
  );
}

function TV({ w, h, img }: { w: number; h: number; img?: string }) {
  const M = mats();
  const ph = w * 0.58;
  const tex = img ? imageTexture(img) : ledTexture();
  return (
    <group>
      <B s={[0.8, 0.03, 0.6]} p={[0, 0.015, 0]} m={M.black} />
      <Cyl r={0.03} h={h - ph / 2} p={[0, (h - ph / 2) / 2, 0]} m={M.black} />
      <B s={[w, ph, 0.05]} p={[0, h - ph / 2, 0]} m={M.black} />
      <mesh position={[0, h - ph / 2, 0.027]}>
        <planeGeometry args={[w * 0.96, ph * 0.94]} />
        <meshStandardMaterial map={tex} emissive="#ffffff" emissiveMap={tex} emissiveIntensity={0.6} />
      </mesh>
    </group>
  );
}

function Camera({ h }: { h: number }) {
  const M = mats();
  return (
    <group>
      <Tripod h={h - 0.12} spread={0.4} />
      <B s={[0.14, 0.16, 0.32]} p={[0, h, 0]} m={M.black} />
      <Cyl r={0.05} h={0.12} p={[0, h, 0.2]} rot={[Math.PI / 2, 0, 0]} m={M.dark} />
    </group>
  );
}

// —————————— Elektrik ——————————
function Generator({ w, h, d }: { w: number; h: number; d: number }) {
  const M = mats();
  return (
    <group>
      <B s={[w, h, d]} p={[0, h / 2 + 0.1, 0]} m={M.yellow} />
      <mesh position={[0, h / 2 + 0.1, d / 2 + 0.003]} material={M.grille}>
        <planeGeometry args={[w * 0.5, h * 0.6]} />
      </mesh>
      {[-1, 1].map((sx) => [-1, 1].map((sz) => <Cyl key={sx + ':' + sz} r={0.1} h={0.08} p={[sx * w * 0.38, 0.1, sz * d * 0.42]} rot={[Math.PI / 2, 0, 0]} m={M.black} />))}
    </group>
  );
}

function Ramp({ w, h, d }: { w: number; h: number; d: number }) {
  const M = mats();
  const geo = useMemo(() => {
    const s = new THREE.Shape();
    s.moveTo(-d / 2, 0);
    s.lineTo(d / 2, 0);
    s.lineTo(d * 0.25, h);
    s.lineTo(-d * 0.25, h);
    s.lineTo(-d / 2, 0);
    const g = new THREE.ExtrudeGeometry(s, { depth: w, bevelEnabled: false });
    g.rotateY(Math.PI / 2);
    g.translate(-w / 2, 0, 0);
    return g;
  }, [w, h, d]);
  return (
    <group>
      <mesh geometry={geo} material={M.black} castShadow receiveShadow />
      <B s={[w, 0.004, d * 0.5]} p={[0, h + 0.002, 0]} m={M.yellow} cast={false} />
    </group>
  );
}

// —————————— Sahne / mobilya ——————————
function Deck({ w, h, d }: { w: number; h: number; d: number }) {
  const M = mats();
  return (
    <group>
      <B s={[w, 0.08, d]} p={[0, h - 0.04, 0]} m={M.stage} />
      {[-1, 1].map((sx) => [-1, 1].map((sz) => <Cyl key={sx + ':' + sz} r={0.03} h={h - 0.08} p={[sx * (w / 2 - 0.08), (h - 0.08) / 2, sz * (d / 2 - 0.08)]} m={M.metal} seg={8} />))}
    </group>
  );
}

function Stairs({ w, h, d }: { w: number; h: number; d: number }) {
  const M = mats();
  const n = Math.max(2, Math.round(h / 0.18));
  return (
    <group>
      {Array.from({ length: n }, (_, i) => {
        const sh = (h * (i + 1)) / n;
        const sd = d / n;
        return <B key={i} s={[w, sh, sd]} p={[0, sh / 2, d / 2 - sd * (i + 0.5)]} m={M.stage} />;
      })}
    </group>
  );
}

function Rail({ w, h }: { w: number; h: number }) {
  const M = mats();
  return (
    <group>
      <Cyl r={0.02} h={w} p={[0, h, 0]} rot={[0, 0, Math.PI / 2]} m={M.chrome} seg={10} />
      <Cyl r={0.015} h={w} p={[0, h * 0.5, 0]} rot={[0, 0, Math.PI / 2]} m={M.chrome} seg={10} />
      {[-0.5, 0, 0.5].map((f) => (
        <Cyl key={f} r={0.02} h={h} p={[f * w * 0.95, h / 2, 0]} m={M.chrome} seg={10} />
      ))}
    </group>
  );
}

function Table({ w, h, d, cloth = true }: { w: number; h: number; d: number; cloth?: boolean }) {
  const M = mats();
  return (
    <group>
      <B s={[w, 0.04, d]} p={[0, h - 0.02, 0]} m={cloth ? M.cloth : M.wood} />
      {cloth ? <B s={[w * 0.995, h - 0.06, d * 0.995]} p={[0, (h - 0.06) / 2 + 0.02, 0]} m={M.cloth} /> : [-1, 1].map((sx) => [-1, 1].map((sz) => <Cyl key={sx + ':' + sz} r={0.025} h={h} p={[sx * (w / 2 - 0.06), h / 2, sz * (d / 2 - 0.06)]} m={M.metal} seg={8} />))}
    </group>
  );
}

function Chair({ s = 1 }: { s?: number }) {
  const M = mats();
  return (
    <group scale={[s, s, s]}>
      <B s={[0.42, 0.04, 0.42]} p={[0, 0.46, 0]} m={M.cloth} />
      <B s={[0.42, 0.48, 0.04]} p={[0, 0.7, -0.19]} m={M.cloth} />
      {[-1, 1].map((sx) => [-1, 1].map((sz) => <Cyl key={sx + ':' + sz} r={0.015} h={0.46} p={[sx * 0.18, 0.23, sz * 0.18]} m={M.gold} seg={6} />))}
    </group>
  );
}

function RoundTable({ w, h }: { w: number; h: number }) {
  const M = mats();
  const big = w > 1.5;
  const r = big ? Math.min(0.9, w / 2 - 0.45) : w / 2;
  const chairs = big ? Math.round((2 * Math.PI * (r + 0.35)) / 0.62) : 0;
  return (
    <group>
      <Cyl r={r} h={0.04} p={[0, h - 0.02, 0]} m={M.cloth} seg={36} />
      <Cyl r={r} r2={r * 1.0} h={h - 0.04} p={[0, (h - 0.04) / 2, 0]} m={M.cloth} seg={36} />
      {big ? <Cyl r={0.12} h={0.35} p={[0, h + 0.17, 0]} m={M.glass} seg={16} /> : null}
      {Array.from({ length: chairs }, (_, i) => {
        const a = (i / chairs) * Math.PI * 2;
        return (
          <group key={i} position={[Math.sin(a) * (r + 0.38), 0, Math.cos(a) * (r + 0.38)]} rotation={[0, a + Math.PI, 0]}>
            <Chair />
          </group>
        );
      })}
    </group>
  );
}

function Sofa({ w, h, d }: { w: number; h: number; d: number }) {
  const M = mats();
  return (
    <group>
      <B s={[w, 0.45, d]} p={[0, 0.225, 0]} m={M.cloth} />
      <B s={[w, h - 0.45, 0.15]} p={[0, 0.45 + (h - 0.45) / 2, -d / 2 + 0.075]} m={M.cloth} />
      <B s={[0.15, 0.3, d]} p={[-w / 2 + 0.075, 0.6, 0]} m={M.gold} />
      <B s={[0.15, 0.3, d]} p={[w / 2 - 0.075, 0.6, 0]} m={M.gold} />
    </group>
  );
}

function Cake({ w }: { w: number }) {
  const M = mats();
  return (
    <group>
      <Table w={w} h={0.75} d={w} />
      <Cyl r={0.25} h={0.18} p={[0, 0.84, 0]} m={M.white} seg={28} />
      <Cyl r={0.18} h={0.16} p={[0, 1.01, 0]} m={M.white} seg={28} />
      <Cyl r={0.11} h={0.14} p={[0, 1.16, 0]} m={M.white} seg={28} />
      <mesh position={[0, 1.27, 0]} material={M.pink}>
        <sphereGeometry args={[0.05, 12, 10]} />
      </mesh>
    </group>
  );
}

function Backdrop({ w, h, img }: { w: number; h: number; img?: string }) {
  const M = mats();
  const tex = img ? imageTexture(img) : null;
  return (
    <group>
      <Cyl r={0.025} h={h} p={[-w / 2, h / 2, 0]} m={M.metal} seg={8} />
      <Cyl r={0.025} h={h} p={[w / 2, h / 2, 0]} m={M.metal} seg={8} />
      <Cyl r={0.02} h={w} p={[0, h, 0]} rot={[0, 0, Math.PI / 2]} m={M.metal} seg={8} />
      <mesh position={[0, h / 2, 0]} castShadow receiveShadow>
        <planeGeometry args={[w * 0.98, h * 0.98]} />
        {tex ? <meshStandardMaterial map={tex} side={THREE.DoubleSide} /> : <meshStandardMaterial color="#e9e3f5" roughness={1} side={THREE.DoubleSide} />}
      </mesh>
    </group>
  );
}

function Arch({ w, h }: { w: number; h: number }) {
  const M = mats();
  const r = w / 2;
  const flowers = Array.from({ length: 22 }, (_, i) => {
    const a = Math.PI * (i / 21);
    const leg = h - r;
    return [Math.cos(a) * r, leg + Math.sin(a) * r, (i % 3) * 0.05 - 0.05] as V3;
  });
  return (
    <group>
      <Cyl r={0.025} h={h - r} p={[-r, (h - r) / 2, 0]} m={M.gold} seg={8} />
      <Cyl r={0.025} h={h - r} p={[r, (h - r) / 2, 0]} m={M.gold} seg={8} />
      <mesh position={[0, h - r, 0]} material={M.gold}>
        <torusGeometry args={[r, 0.025, 8, 32, Math.PI]} />
      </mesh>
      {flowers.map((f, i) => (
        <mesh key={i} position={f} material={i % 2 ? M.pink : M.white}>
          <sphereGeometry args={[0.09, 10, 8]} />
        </mesh>
      ))}
    </group>
  );
}

function DJBooth({ w, h, d }: { w: number; h: number; d: number }) {
  const M = mats();
  return (
    <group>
      <B s={[w, h, d]} p={[0, h / 2, 0]} m={M.black} />
      <mesh position={[0, h / 2, d / 2 + 0.004]} material={M.led}>
        <planeGeometry args={[w * 0.96, h * 0.9]} />
      </mesh>
      <B s={[w + 0.04, 0.03, d + 0.04]} p={[0, h + 0.015, 0]} m={M.dark} />
    </group>
  );
}

function Door({ w, h, exit }: { w: number; h: number; exit: boolean }) {
  const M = mats();
  return (
    <group>
      <B s={[w, h, 0.06]} p={[0, h / 2, 0]} m={exit ? M.green : M.wood} />
      <B s={[w + 0.1, 0.08, 0.1]} p={[0, h + 0.04, 0]} m={M.white} />
      {exit ? <B s={[0.4, 0.16, 0.05]} p={[0, h + 0.2, 0.05]} m={M.green} /> : null}
    </group>
  );
}

function Tie({ w, h, color }: { w: number; h: number; color: string }) {
  const M = mats();
  const tex = iconTexture('tie', '#ffffff', 'transparent');
  return (
    <group>
      <Cyl r={w / 2} h={h} p={[0, h / 2, 0]} m={M.teal} seg={6} />
      <Decal tex={tex} w={w * 0.7} h={w * 0.7} p={[0, h + 0.002, 0]} r={[-Math.PI / 2, 0, 0]} />
      <B s={[w * 0.5, 0.01, 0.01]} p={[0, h / 2, w / 2]} m={new THREE.MeshBasicMaterial({ color })} cast={false} />
    </group>
  );
}

function External({ w, h, d }: { w: number; h: number; d: number }) {
  const geo = useMemo(() => new THREE.EdgesGeometry(new THREE.BoxGeometry(w, h, d)), [w, h, d]);
  return (
    <group position={[0, h / 2, 0]}>
      <lineSegments geometry={geo}>
        <lineDashedMaterial color="#0d9488" dashSize={0.1} gapSize={0.06} />
      </lineSegments>
      <mesh>
        <boxGeometry args={[w, h, d]} />
        <meshStandardMaterial color="#0d9488" transparent opacity={0.12} />
      </mesh>
    </group>
  );
}

function GenericBox({ w, h, d, icon, color, img }: { w: number; h: number; d: number; icon: string; color: string; img?: string }) {
  const M = mats();
  const tex = img ? imageTexture(img) : iconTexture(icon, color, '#f8fafc');
  const s = Math.min(w, h) * 0.85;
  return (
    <group>
      <B s={[w, h, d]} p={[0, h / 2, 0]} m={M.cab2} />
      <Decal tex={tex} w={img ? w * 0.95 : s} h={img ? h * 0.95 : s} p={[0, h / 2, d / 2 + 0.003]} />
      {!img ? <Decal tex={tex} w={Math.min(w, d) * 0.85} h={Math.min(w, d) * 0.85} p={[0, h + 0.002, 0]} r={[-Math.PI / 2, 0, 0]} /> : null}
    </group>
  );
}

// —————————— Dağıtıcı ——————————
export interface ModelProps {
  it: Item;
  def: EquipDef;
  w: number;
  h: number;
  d: number;
  color: string;
  img?: string;
  ceiling: number;
}

export function Model({ it, def, w, h, d, color, img, ceiling }: ModelProps) {
  const M = mats();
  switch (def.shape) {
    case 'speaker':
      return <Speaker w={w} h={h} d={d} tilt={it.tilt} />;
    case 'sub':
      return <Sub w={w} h={h} d={d} />;
    case 'wedge':
      return <Wedge w={w} h={h} d={d} />;
    case 'array':
      return <LineArray it={it} def={def} ceiling={ceiling} />;
    case 'column':
      return <Column w={w} h={h} d={d} />;
    case 'console':
      return <Console w={w} h={h} d={d} color={color} />;
    case 'rack':
      return <Rack w={w} h={h} d={d} icon={def.icon} color={color} img={img} />;
    case 'djplayer':
    case 'djmixer':
    case 'djcontroller':
      return <DeskDevice w={w} h={h} d={d} icon={def.icon} color="#c4b5fd" />;
    case 'turntable':
      return <Turntable w={w} h={h} d={d} />;
    case 'laptop':
      return <Laptop w={w} d={d} />;
    case 'mic':
      return <Mic it={it} wireless={def.ports.some((x) => x.domain === 'wireless')} />;
    case 'drumkit':
      return <DrumKit w={w} d={d} />;
    case 'davul':
      return <Davul />;
    case 'pipe':
      return <Performer kind="pipe" />;
    case 'string':
      return <Performer kind="string" />;
    case 'guitar':
      return <Performer kind="guitar" />;
    case 'person':
      return <Person />;
    case 'darbuka':
      return <Darbuka w={w} />;
    case 'keyboard':
      return <Keyboard it={it} w={w} d={d} />;
    case 'piano':
      return <Piano w={w} d={d} />;
    case 'ampcombo':
      return <AmpCombo w={w} h={h} d={d} />;
    case 'movinghead':
      return <MovingHead w={w} h={h} d={d} flown={it.mount === 'flown'} tilt={it.tilt} />;
    case 'par':
      return <Par w={w} h={h} tilt={it.tilt} />;
    case 'ledbar':
      return <LedBar w={w} h={h} d={d} />;
    case 'tbar':
      return <TBar w={w} h={h} />;
    case 'followspot':
      return <Followspot h={h} d={d} />;
    case 'speakerstand':
      return <Tripod h={h} spread={0.6} />;
    case 'truss':
      return <Truss w={w} h={h} d={d} />;
    case 'trusstower':
      return <TrussTower w={w} h={h} />;
    case 'hoist':
      return <Hoist w={w} h={h} />;
    case 'ledwall':
      return <LedWall w={w} h={h} d={d} img={img} />;
    case 'projector':
      return (
        <group>
          <B s={[w, h, d]} p={[0, h / 2, 0]} m={M.white} />
          <Cyl r={h * 0.32} h={0.06} p={[w * 0.25, h / 2, d / 2 + 0.03]} rot={[Math.PI / 2, 0, 0]} m={M.black} />
        </group>
      );
    case 'screen':
      return <Screen w={w} h={h} />;
    case 'tv':
      return <TV w={w} h={h} img={img} />;
    case 'camera':
      return <Camera h={h} />;
    case 'outlet':
      return <B s={[w, h, d]} p={[0, h / 2, 0]} m={def.ports[0]?.conn === 'schuko' ? M.white : def.ports[0]?.conn === 'cee16' ? M.blue : M.red} />;
    case 'distro':
      return <GenericBox w={w} h={h} d={d} icon={def.icon} color="#dc2626" img={img} />;
    case 'generator':
      return <Generator w={w} h={h} d={d} />;
    case 'strip':
      return <B s={[w, h, d]} p={[0, h / 2, 0]} m={M.black} />;
    case 'ramp':
      return <Ramp w={w} h={h} d={d} />;
    case 'extinguisher':
      return (
        <group>
          <Cyl r={w * 0.35} h={h * 0.85} p={[0, h * 0.425, 0]} m={M.red} />
          <Cyl r={0.03} h={0.12} p={[0, h * 0.92, 0]} m={M.black} />
        </group>
      );
    case 'deck':
      return <Deck w={w} h={h} d={d} />;
    case 'stairs':
      return <Stairs w={w} h={h} d={d} />;
    case 'rail':
      return <Rail w={w} h={h} />;
    case 'table':
      return <Table w={w} h={h} d={d} cloth={def.cat === 'sahne'} />;
    case 'roundtable':
      return <RoundTable w={w} h={h} />;
    case 'chair':
      return <Chair />;
    case 'sofa':
      return <Sofa w={w} h={h} d={d} />;
    case 'cake':
      return <Cake w={w} />;
    case 'counter':
      return <B s={[w, h, d]} p={[0, h / 2, 0]} m={M.wood} />;
    case 'backdrop':
      return <Backdrop w={w} h={h} img={img} />;
    case 'arch':
      return <Arch w={w} h={h} />;
    case 'pillar':
      return <B s={[w, Math.max(h, ceiling), d]} p={[0, Math.max(h, ceiling) / 2, 0]} m={M.wall} />;
    case 'pillarround':
      return <Cyl r={w / 2} h={Math.max(h, ceiling)} p={[0, Math.max(h, ceiling) / 2, 0]} m={M.wall} seg={32} />;
    case 'wall':
      return <B s={[w, Math.max(h, ceiling), d]} p={[0, Math.max(h, ceiling) / 2, 0]} m={M.wall} />;
    case 'door':
      return <Door w={w} h={h} exit={def.id === 'exit'} />;
    case 'window':
      return (
        <group>
          <B s={[w, h, d]} p={[0, h / 2, 0]} m={M.white} />
          <mesh position={[0, h / 2, d / 2 + 0.003]} material={M.glass}>
            <planeGeometry args={[w * 0.9, h * 0.9]} />
          </mesh>
        </group>
      );
    case 'tie':
      return <Tie w={w} h={h} color={color} />;
    case 'external':
      return <External w={w} h={h} d={d} />;
    case 'djbooth':
      return <DJBooth w={w} h={h} d={d} />;
    case 'rackcase':
      return (
        <group>
          <B s={[w, h, d]} p={[0, h / 2, 0]} m={M.black} />
          <B s={[w * 1.01, 0.03, d * 1.01]} p={[0, h * 0.8, 0]} m={M.metal} />
        </group>
      );
    default:
      return <GenericBox w={w} h={h} d={d} icon={def.icon} color={color} img={img} />;
  }
}
