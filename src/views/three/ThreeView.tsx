import { Grid, Html, Line, OrbitControls, TransformControls } from '@react-three/drei';
import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { arrayElements, sourcesOf, splColor, splGrid } from '../../engine/acoustics';
import { analyzeCables, anchorPlan, anchorZ, type CableInfo } from '../../engine/cables';
import { floorElevAt, getDef, itemBaseZ, itemDims } from '../../model/project';
import type { Area, EquipDef, Item, Project, Zone } from '../../model/types';
import { addItem, updateItem } from '../../store/actions';
import { st, useStore, useT } from '../../store/store';
import { Icon } from '../../ui/kit';
import { HeatLegend } from '../HeatLegend';
import { cableColor, cableVisible, catColor, itemImage, itemVisible, ZONE_STYLE } from '../common';
import { DEG, mats, Model, Tripod } from './models';
import { isOff } from '../../model/variants';
import { checkerTexture, woodTexture } from './textures';

type TMode = 'translate' | 'height' | 'rotate';
type Preset = 'persp' | 'top' | 'front' | 'stage' | 'side' | 'foh';

export default function ThreeView() {
  const t = useT();
  const p = useStore((s) => s.project);
  const areaId = useStore((s) => s.areaId);
  const theme = useStore((s) => s.theme);
  const layers = useStore((s) => s.layers);
  const installer = useStore((s) => s.installer);
  const area = p.areas.find((a) => a.id === areaId) || p.areas[0];
  const [mode, setMode] = useState<TMode>('translate');
  const [preset, setPreset] = useState<{ id: Preset; at: number }>({ id: 'persp', at: Date.now() });
  const dark = theme === 'dark';
  const tog = (k: 'labels' | 'coverage' | 'heatmap' | 'room' | 'cableTags') => st().set({ layers: { ...layers, [k]: !layers[k] } });
  return (
    <div className="canvas-wrap three-wrap" data-testid="three-view">
      <Canvas
        shadows
        dpr={[1, 2]}
        gl={{ preserveDrawingBuffer: true, antialias: true }}
        camera={{ fov: 45, near: 0.05, far: 600, position: [area.w * 0.85, Math.max(area.w, area.d) * 0.7, area.d * 1.55] }}
        onPointerMissed={(e) => {
          if (e.button === 0 && !st().placing) st().clearSel();
        }}
      >
        <color attach="background" args={[dark ? '#11141a' : '#e8ecf1']} />
        <Scene area={area} p={p} mode={mode} preset={preset} dark={dark} />
      </Canvas>
      <div className="toolbar no-print">
        {!installer ? (
          <div className="tool-card">
            <button className={'ibtn' + (mode === 'translate' ? ' on' : '')} onClick={() => setMode('translate')} title={t('three.move')}>
              <Icon name="select" size={16} />
              <span className="hide-sm">{t('three.move')}</span>
            </button>
            <button className={'ibtn' + (mode === 'height' ? ' on' : '')} onClick={() => setMode('height')} title={t('three.height')}>
              ↕<span className="hide-sm">{t('three.height')}</span>
            </button>
            <button className={'ibtn' + (mode === 'rotate' ? ' on' : '')} onClick={() => setMode('rotate')} title={t('three.rotate')}>
              <Icon name="rotate" size={16} />
              <span className="hide-sm">{t('three.rotate')}</span>
            </button>
          </div>
        ) : null}
        <div className="tool-card">
          {(['persp', 'top', 'front', 'stage', 'side', 'foh'] as Preset[]).map((id) => (
            <button key={id} className={'ibtn' + (preset.id === id ? ' on' : '')} onClick={() => setPreset({ id, at: Date.now() })} title={t(('cam.' + id) as 'cam.persp')}>
              {t(('cam.' + id) as 'cam.persp')}
            </button>
          ))}
        </div>
        <div className="tool-card">
          <button className={'ibtn' + (layers.labels ? ' on' : '')} title={t('layer.labels')} onClick={() => tog('labels')}>
            <Icon name="tag" size={16} />
          </button>
          <button className={'ibtn' + (layers.cableTags ? ' on' : '')} title={t('layer.cableTags')} onClick={() => tog('cableTags')}>
            <Icon name="cable" size={16} />
          </button>
          <button className={'ibtn' + (layers.coverage ? ' on' : '')} title={t('layer.coverage')} onClick={() => tog('coverage')}>
            <Icon name="cone" size={16} />
          </button>
          <button className={'ibtn' + (layers.heatmap ? ' on' : '')} title={t('layer.heatmap')} onClick={() => tog('heatmap')}>
            <Icon name="heat" size={16} />
          </button>
          <button className={'ibtn' + (layers.room ? ' on' : '')} title={t('layer.room')} onClick={() => tog('room')}>
            <Icon name="house" size={16} />
          </button>
        </div>
      </div>
      <div className="floating-br no-print">{layers.heatmap ? <HeatLegend /> : null}</div>
    </div>
  );
}

function Scene({ area, p, mode, preset, dark }: { area: Area; p: Project; mode: TMode; preset: { id: Preset; at: number }; dark: boolean }) {
  const layers = useStore((s) => s.layers);
  const sel = useStore((s) => s.sel);
  const placing = useStore((s) => s.placing);
  const installer = useStore((s) => s.installer);
  const snap = useStore((s) => s.snap);
  const items = useMemo(() => p.items.filter((i) => i.areaId === area.id), [p.items, area.id]);
  const zones = useMemo(() => p.zones.filter((z) => z.areaId === area.id), [p.zones, area.id]);
  const [selObj, setSelObj] = useState<THREE.Object3D | null>(null);
  const selId = sel.items.length === 1 ? sel.items[0] : null;
  const selItem = selId ? items.find((i) => i.id === selId) : undefined;
  const ci = analyzeCables(p);
  const maxDim = Math.max(area.w, area.d);
  const supports = useSupports(p, items);
  const dragging = useRef(false);

  useEffect(() => {
    if (!selId) setSelObj(null);
  }, [selId]);

  const onFloorClick = (e: ThreeEvent<MouseEvent>) => {
    const s = st();
    if (!s.placing) return;
    e.stopPropagation();
    addItem(s.placing, e.point.x, e.point.z);
    if (!e.shiftKey) s.set({ placing: null });
  };

  return (
    <>
      <hemisphereLight args={[dark ? '#9fb2d0' : '#ffffff', dark ? '#202430' : '#9aa1ab', dark ? 0.55 : 0.75]} />
      <ambientLight intensity={dark ? 0.2 : 0.25} />
      <directionalLight
        position={[area.w * 0.25, Math.max(area.h * 3, 14), area.d * 1.1]}
        intensity={dark ? 1.1 : 1.35}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-maxDim}
        shadow-camera-right={maxDim}
        shadow-camera-top={maxDim}
        shadow-camera-bottom={-maxDim}
        shadow-camera-far={maxDim * 6}
        shadow-bias={-0.0004}
      />
      <CamRig area={area} p={p} preset={preset} />
      <OrbitControls makeDefault enableDamping dampingFactor={0.12} maxPolarAngle={Math.PI / 2 - 0.02} target={[area.w / 2, 0.8, area.d / 2]} />
      <Room area={area} dark={dark} showWalls={layers.room} onFloorClick={onFloorClick} placing={!!placing} />
      {layers.zones ? zones.map((z) => <Zone3D key={z.id} z={z} sel={sel.zones.includes(z.id)} />) : null}
      {items.map((it) => {
        const def = getDef(p, it.defId);
        if (!itemVisible(it, def, layers) || isOff(p, it)) return null;
        const dm = itemDims(it, def);
        const major = !!def.acoustic || ['mikser', 'dj', 'enstruman', 'video', 'elektrik', 'hazirlik'].includes(def.cat) || Math.max(dm.w, dm.d) > 1.2;
        return <ItemMesh key={it.id} p={p} it={it} def={def} area={area} sel={sel.items.includes(it.id)} label={layers.labels && major && def.cat !== 'sahne' && items.length < 220} support={supports.get(it.id)} registerSel={it.id === selId ? setSelObj : undefined} />;
      })}
      {layers.cables
        ? [...ci.values()].map((inf) => {
            if (!inf.path || inf.a?.areaId !== area.id || !cableVisible(inf, layers) || isOff(p, inf.cable)) return null;
            return <Cable3D key={inf.cable.id} p={p} inf={inf} sel={sel.cables.includes(inf.cable.id)} tag={false} />;
          })
        : null}
      <Coverage3D p={p} area={area} all={layers.coverage} selIds={sel.items} />
      {layers.heatmap ? <Heat3D p={p} area={area} /> : null}
      {selObj && selItem && !selItem.locked && !installer ? (
        <TransformControls
          object={selObj}
          mode={mode === 'rotate' ? 'rotate' : 'translate'}
          showX={mode === 'translate'}
          showZ={mode === 'translate'}
          showY={mode !== 'translate'}
          translationSnap={snap ? 0.05 : null}
          rotationSnap={snap ? 5 * DEG : null}
          size={0.8}
          onMouseDown={() => {
            dragging.current = true;
            st().checkpoint();
          }}
          onMouseUp={() => {
            dragging.current = false;
          }}
          onObjectChange={() => {
            if (!selObj || !selItem) return;
            const pos = selObj.position;
            if (mode === 'rotate') {
              const r = ((-selObj.rotation.y / DEG) % 360 + 360) % 360;
              updateItem(selItem.id, { rot: Math.round(r * 10) / 10 }, false);
            } else if (mode === 'height') {
              const fl = selItem.mount === 'flown' || selItem.mount === 'wall' ? 0 : floorElevAt(p.zones, selItem.areaId, selItem.x, selItem.y);
              updateItem(selItem.id, { z: Math.max(0, Math.round((pos.y - fl) * 100) / 100), mount: selItem.mount === 'floor' && pos.y - fl > 0.05 ? 'stand' : selItem.mount }, false);
            } else updateItem(selItem.id, { x: Math.round(pos.x * 100) / 100, y: Math.round(pos.z * 100) / 100 }, false);
          }}
        />
      ) : null}
    </>
  );
}

function CamRig({ area, p, preset }: { area: Area; p: Project; preset: { id: Preset; at: number } }) {
  const { camera, controls } = useThree();
  useEffect(() => {
    const c = controls as unknown as { target: THREE.Vector3; update: () => void } | null;
    const W = area.w;
    const D = area.d;
    const H = area.h;
    let pos: [number, number, number];
    let tgt: [number, number, number];
    switch (preset.id) {
      case 'top':
        pos = [W / 2, Math.max(W, D) * 1.25, D / 2 + 0.01];
        tgt = [W / 2, 0, D / 2];
        break;
      case 'front':
        pos = [W / 2, 1.7, D - 0.6];
        tgt = [W / 2, 1.6, 0];
        break;
      case 'stage':
        pos = [W / 2, 2.4, 1.2];
        tgt = [W / 2, 1.0, D];
        break;
      case 'side':
        pos = [-W * 0.35, Math.max(H * 1.1, 5), D / 2];
        tgt = [W / 2, 0.8, D / 2];
        break;
      case 'foh': {
        const foh = p.zones.find((z) => z.areaId === area.id && z.kind === 'foh');
        const desk = p.items.find((i) => i.areaId === area.id && getDef(p, i.defId).cat === 'mikser' && getDef(p, i.defId).icon === 'mixer');
        const fx = foh ? foh.x + foh.w / 2 : desk ? desk.x : W / 2;
        const fy = foh ? foh.y + foh.d / 2 + 0.4 : desk ? desk.y + 0.6 : D * 0.7;
        pos = [fx, 1.65, fy];
        tgt = [W / 2, 1.5, 0];
        break;
      }
      default:
        pos = [W * 0.85, Math.max(W, D) * 0.7, D * 1.55];
        tgt = [W / 2, 0.8, D / 2];
    }
    camera.position.set(...pos);
    if (c?.target) {
      c.target.set(...tgt);
      c.update();
    } else camera.lookAt(...tgt);
  }, [preset.at, area.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

const Room = memo(function Room({ area, dark, showWalls, onFloorClick, placing }: { area: Area; dark: boolean; showWalls: boolean; onFloorClick: (e: ThreeEvent<MouseEvent>) => void; placing: boolean }) {
  const { w, d, h } = area;
  const floorMat = useMemo(() => {
    if (!area.indoor) return new THREE.MeshStandardMaterial({ color: '#7d9a62', roughness: 1 });
    switch (area.floor) {
      case 'parke':
      case 'ahsap': {
        const tex = woodTexture().clone();
        tex.needsUpdate = true;
        tex.repeat.set(w / 4, d / 4);
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        return new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55 });
      }
      case 'seramik':
        return new THREE.MeshStandardMaterial({ color: '#e9e6df', roughness: 0.25, metalness: 0.05 });
      case 'hali':
        return new THREE.MeshStandardMaterial({ color: '#7a2e3b', roughness: 1 });
      default:
        return new THREE.MeshStandardMaterial({ color: '#a3a8b0', roughness: 0.9 });
    }
  }, [area.floor, area.indoor, w, d]);
  const wallMat = useMemo(() => new THREE.MeshStandardMaterial({ color: dark ? '#434b5a' : '#d5dae2', transparent: true, opacity: 0.72, roughness: 1, side: THREE.DoubleSide, depthWrite: false }), [dark]);
  const edge = useMemo(() => new THREE.LineBasicMaterial({ color: dark ? '#7b8494' : '#8a93a2' }), [dark]);
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[w / 2, -0.02, d / 2]} receiveShadow>
        <planeGeometry args={[w + 60, d + 60]} />
        <meshStandardMaterial color={dark ? '#171a21' : area.indoor ? '#d9dde3' : '#86a46b'} roughness={1} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[w / 2, 0, d / 2]} receiveShadow material={floorMat} onClick={onFloorClick} onPointerOver={() => placing && (document.body.style.cursor = 'crosshair')} onPointerOut={() => (document.body.style.cursor = '')}>
        <planeGeometry args={[w, d]} />
      </mesh>
      <Grid position={[w / 2, 0.004, d / 2]} args={[w, d]} cellSize={0.5} sectionSize={1} cellThickness={0.5} sectionThickness={0.9} cellColor={dark ? '#2b313c' : '#9aa3af'} sectionColor={dark ? '#3a4352' : '#7d8794'} fadeDistance={400} infiniteGrid={false} />
      {area.indoor && showWalls ? (
        <group>
          <mesh position={[w / 2, h / 2, -0.08]} material={wallMat} receiveShadow>
            <boxGeometry args={[w + 0.32, h, 0.16]} />
          </mesh>
          <mesh position={[-0.08, h / 2, d / 2]} material={wallMat} receiveShadow>
            <boxGeometry args={[0.16, h, d]} />
          </mesh>
          <mesh position={[w + 0.08, h / 2, d / 2]} material={wallMat} receiveShadow>
            <boxGeometry args={[0.16, h, d]} />
          </mesh>
          <lineSegments position={[w / 2, h / 2, d / 2]} material={edge}>
            <edgesGeometry args={[new THREE.BoxGeometry(w, h, d)]} />
          </lineSegments>
        </group>
      ) : (
        <lineSegments position={[w / 2, 0.01, d / 2]} material={edge}>
          <edgesGeometry args={[new THREE.BoxGeometry(w, 0.02, d)]} />
        </lineSegments>
      )}
    </group>
  );
});

const Zone3D = memo(function Zone3D({ z, sel }: { z: Zone; sel: boolean }) {
  const M = mats();
  const st0 = ZONE_STYLE[z.kind] || ZONE_STYLE.custom;
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (st().placing) return;
    e.stopPropagation();
    st().select({ zones: [z.id] });
  };
  if (z.elev > 0) {
    return (
      <group position={[z.x + z.w / 2, 0, z.y + z.d / 2]} onClick={onClick}>
        <mesh position={[0, z.elev - 0.025, 0]} material={M.stage} castShadow receiveShadow>
          <boxGeometry args={[z.w, 0.05, z.d]} />
        </mesh>
        <mesh position={[0, (z.elev - 0.05) / 2, z.d / 2 - 0.01]} material={M.black}>
          <boxGeometry args={[z.w, z.elev - 0.05, 0.02]} />
        </mesh>
        <mesh position={[-z.w / 2 + 0.01, (z.elev - 0.05) / 2, 0]} material={M.black}>
          <boxGeometry args={[0.02, z.elev - 0.05, z.d]} />
        </mesh>
        <mesh position={[z.w / 2 - 0.01, (z.elev - 0.05) / 2, 0]} material={M.black}>
          <boxGeometry args={[0.02, z.elev - 0.05, z.d]} />
        </mesh>
        {sel ? (
          <lineSegments position={[0, z.elev / 2, 0]}>
            <edgesGeometry args={[new THREE.BoxGeometry(z.w, z.elev, z.d)]} />
            <lineBasicMaterial color="#2563eb" />
          </lineSegments>
        ) : null}
      </group>
    );
  }
  const isDance = z.kind === 'dance';
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[z.x + z.w / 2, 0.006, z.y + z.d / 2]} onClick={onClick} receiveShadow>
      <planeGeometry args={[z.w, z.d]} />
      {isDance ? (
        <meshStandardMaterial map={danceTex(z)} roughness={0.15} metalness={0.1} />
      ) : (
        <meshStandardMaterial color={sel ? '#2563eb' : st0.fill} transparent opacity={z.kind === 'walkway' ? 0.35 : 0.16} depthWrite={false} />
      )}
    </mesh>
  );
});

function danceTex(z: Zone): THREE.Texture {
  const t = checkerTexture('#f4f4f5', '#18181b', 8).clone();
  t.needsUpdate = true;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(z.w / 4, z.d / 4);
  return t;
}

// masa üstü cihazları taşıyan öğe var mı?
function useSupports(p: Project, items: Item[]): Map<string, number> {
  return useMemo(() => {
    const m = new Map<string, number>();
    const supports = items.filter((i) => ['table', 'roundtable', 'djbooth', 'counter', 'rackcase', 'deck', 'cake'].includes(getDef(p, i.defId).shape));
    for (const it of items) {
      if (it.mount !== 'table' || it.z < 0.2) continue;
      const base = itemBaseZ(p, it);
      const fl = floorElevAt(p.zones, it.areaId, it.x, it.y);
      const ok = supports.some((s) => {
        const d = getDef(p, s.defId);
        const dm = itemDims(s, d);
        const r = Math.max(dm.w, dm.d) / 2 + 0.05;
        const top = itemBaseZ(p, s) + dm.h;
        return Math.abs(s.x - it.x) <= r && Math.abs(s.y - it.y) <= r && Math.abs(top - base) < 0.25;
      });
      if (!ok) m.set(it.id, base - fl);
    }
    return m;
  }, [p, items]);
}

const ItemMesh = memo(function ItemMesh({ p, it, def, area, sel, label, support, registerSel }: { p: Project; it: Item; def: EquipDef; area: Area; sel: boolean; label: boolean; support?: number; registerSel?: (o: THREE.Object3D | null) => void }) {
  const M = mats();
  const dims = itemDims(it, def);
  const base = itemBaseZ(p, it);
  const floor = floorElevAt(p.zones, it.areaId, it.x, it.y);
  const color = catColor(def);
  const img = itemImage(p, it, def);
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (st().placing) return;
    e.stopPropagation();
    st().select({ items: [it.id] }, e.shiftKey);
  };
  const standH = base - floor;
  const isSpeaker = !!def.acoustic && def.acoustic.kind !== 'iem';
  const ceiling = area.indoor ? area.h - base : 0;
  let labelY = dims.h + 0.25;
  if (def.acoustic?.kind === 'array') labelY = 0.35;
  return (
    <group position={[it.x, base, it.y]} rotation={[0, -it.rot * DEG, 0]} onClick={onClick} ref={registerSel || undefined}>
      {it.mount === 'stand' && isSpeaker && standH > 0.2 ? (
        <group position={[0, -standH, 0]}>
          <Tripod h={standH} />
        </group>
      ) : null}
      {it.mount === 'pole' && standH > 0.2 ? <mesh position={[0, -Math.min(1.2, standH) / 2, 0]} material={M.black}><cylinderGeometry args={[0.018, 0.018, Math.min(1.2, standH), 10]} /></mesh> : null}
      {support && support > 0.2 ? (
        <mesh position={[0, -support / 2, 0]} material={M.black} castShadow receiveShadow>
          <boxGeometry args={[Math.max(0.3, dims.w * 0.98), support, Math.max(0.3, dims.d * 0.98)]} />
        </mesh>
      ) : null}
      {it.mount === 'flown' && def.acoustic && def.acoustic.kind !== 'array' && area.indoor && area.h - base - dims.h > 0.2 ? (
        <mesh position={[0, dims.h + (area.h - base - dims.h) / 2, 0]} material={M.chrome}>
          <cylinderGeometry args={[0.008, 0.008, area.h - base - dims.h, 6]} />
        </mesh>
      ) : null}
      <Model it={it} def={def} w={dims.w} h={dims.h} d={dims.d} color={color} img={img} ceiling={ceiling} />
      {sel ? <SelBox w={dims.w} h={def.acoustic?.kind === 'array' ? dims.h : dims.h} d={dims.d} array={def.acoustic?.kind === 'array'} /> : null}
      {label || sel ? (
        <Html position={[0, labelY, 0]} zIndexRange={[20, 0]} className="three-labels">
          <div className={'lbl3d' + (sel ? ' sel' : '')}>{it.label}</div>
        </Html>
      ) : null}
    </group>
  );
});

function SelBox({ w, h, d, array }: { w: number; h: number; d: number; array?: boolean }) {
  const geo = useMemo(() => new THREE.EdgesGeometry(new THREE.BoxGeometry(w + 0.06, h + 0.06, d + 0.06)), [w, h, d]);
  return (
    <lineSegments geometry={geo} position={[0, array ? h / 2 - 0.03 : h / 2, 0]}>
      <lineBasicMaterial color="#2563eb" />
    </lineSegments>
  );
}

const Cable3D = memo(function Cable3D({ p, inf, sel, tag }: { p: Project; inf: CableInfo; sel: boolean; tag: boolean }) {
  const pts = useMemo(() => {
    const a = inf.a!;
    const b = inf.b!;
    const A = anchorPlan(a, inf.defA!);
    const Bp = anchorPlan(b, inf.defB!);
    const za = anchorZ(p, a, inf.defA!);
    const zb = anchorZ(p, b, inf.defB!);
    if (inf.type.wireless) {
      const mid = new THREE.Vector3((A.x + Bp.x) / 2, Math.max(za, zb) + 1.2, (A.y + Bp.y) / 2);
      const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(A.x, za, A.y), mid, new THREE.Vector3(Bp.x, zb, Bp.y));
      return curve.getPoints(24).map((v) => [v.x, v.y, v.z] as [number, number, number]);
    }
    const path = inf.path!;
    const short = inf.len3d > 0 && Math.hypot(A.x - Bp.x, A.y - Bp.y) < 1.5 && za - floorElevAt(p.zones, a.areaId, a.x, a.y) > 0.4 && zb - floorElevAt(p.zones, b.areaId, b.x, b.y) > 0.4;
    if (short) return [[A.x, za, A.y], [(A.x + Bp.x) / 2, Math.min(za, zb) - 0.15, (A.y + Bp.y) / 2], [Bp.x, zb, Bp.y]] as [number, number, number][];
    const out: [number, number, number][] = [[A.x, za, A.y]];
    for (const q of path) out.push([q.x, floorElevAt(p.zones, a.areaId, q.x, q.y) + 0.02, q.y]);
    out.push([Bp.x, zb, Bp.y]);
    return out;
  }, [p, inf]);
  const col = cableColor(inf);
  const mid = pts[Math.floor(pts.length / 2)];
  return (
    <group>
      <Line
        points={pts}
        color={col}
        lineWidth={sel ? 4 : 2}
        dashed={inf.type.wireless}
        dashSize={0.25}
        gapSize={0.15}
        onClick={(e) => {
          if (st().placing) return;
          e.stopPropagation();
          st().select({ cables: [inf.cable.id] });
        }}
      />
      {tag || sel ? (
        <Html position={mid} zIndexRange={[15, 0]} className="three-labels">
          <div className="ctag3d" style={{ color: col, transform: 'translate(-50%,-50%)' }}>
            {inf.cable.label}
          </div>
        </Html>
      ) : null}
    </group>
  );
});

function Coverage3D({ p, area, all, selIds }: { p: Project; area: Area; all: boolean; selIds: string[] }) {
  const srcs = sourcesOf(p, area.id);
  const target = p.settings.targetSpl;
  const shown = new Set<string>();
  const out: JSX.Element[] = [];
  for (const s of srcs) {
    if (s.kind === 'sub' || shown.has(s.itemId)) continue;
    if (!all && !selIds.includes(s.itemId)) continue;
    shown.add(s.itemId);
    const it = p.items.find((i) => i.id === s.itemId)!;
    const def = getDef(p, it.defId);
    let v = s.v;
    let pitch = s.pitch;
    let y = s.z;
    let fwd = 0;
    if (s.kind === 'array') {
      const els = arrayElements(it, def.h, def.d, itemBaseZ(p, it));
      v = (it.splays || []).reduce((a, b) => a + b, 0) + s.v;
      const midE = els[Math.floor(els.length / 2)];
      pitch = (els[0].pitch + els[els.length - 1].pitch) / 2;
      y = midE.z;
      fwd = midE.dy;
    }
    const L = Math.min(30, Math.pow(10, (s.lp1m - (target - 6)) / 20));
    out.push(<Cone key={s.itemId} x={it.x - Math.sin(it.rot * DEG) * fwd} y={y} z={it.y + Math.cos(it.rot * DEG) * fwd} rot={it.rot} pitch={pitch} h={Math.min(170, s.h)} v={Math.min(170, v)} L={L} color={catColor(def)} />);
  }
  return <>{out}</>;
}

function Cone({ x, y, z, rot, pitch, h, v, L, color }: { x: number; y: number; z: number; rot: number; pitch: number; h: number; v: number; L: number; color: string }) {
  const geo = useMemo(() => {
    const hw = L * Math.tan(Math.min(h, 160) * 0.5 * DEG);
    const hh = L * Math.tan(Math.min(v, 160) * 0.5 * DEG);
    const g = new THREE.BufferGeometry();
    const P = [0, 0, 0, -hw, -hh, L, hw, -hh, L, hw, hh, L, -hw, hh, L];
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.setIndex([0, 1, 2, 0, 2, 3, 0, 3, 4, 0, 4, 1, 1, 3, 2, 1, 4, 3]);
    g.computeVertexNormals();
    return g;
  }, [h, v, L]);
  const edges = useMemo(() => new THREE.EdgesGeometry(geo), [geo]);
  return (
    <group position={[x, y, z]} rotation={[0, -rot * DEG, 0]}>
      <group rotation={[-pitch * DEG, 0, 0]}>
        <mesh geometry={geo} raycast={() => null}>
          <meshBasicMaterial color={color} transparent opacity={0.08} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
        <lineSegments geometry={edges} raycast={() => null}>
          <lineBasicMaterial color={color} transparent opacity={0.45} />
        </lineSegments>
      </group>
    </group>
  );
}

function Heat3D({ p, area }: { p: Project; area: Area }) {
  const heat = useStore((s) => s.heat);
  const g = splGrid(p, area.id, heat);
  const tex = useMemo(() => {
    if (!g) return null;
    const c = document.createElement('canvas');
    c.width = g.nx;
    c.height = g.ny;
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(g.nx, g.ny);
    for (let i = 0; i < g.data.length; i++) {
      const [r, gg, b, a] = splColor(g.data[i], p.settings.targetSpl);
      img.data[i * 4] = r;
      img.data[i * 4 + 1] = gg;
      img.data[i * 4 + 2] = b;
      img.data[i * 4 + 3] = a;
    }
    ctx.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, [g, p.settings.targetSpl]);
  if (!g || !tex) return null;
  const W = g.nx * g.step;
  const D = g.ny * g.step;
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[W / 2, p.settings.earH, D / 2]} raycast={() => null}>
      <planeGeometry args={[W, D]} />
      <meshBasicMaterial map={tex} transparent opacity={0.6} depthWrite={false} side={THREE.DoubleSide} />
    </mesh>
  );
}
