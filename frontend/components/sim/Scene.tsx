'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Canvas, useFrame } from '@react-three/fiber';
import { CameraControls, Html, Line } from '@react-three/drei';
import { memo, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { OUTLINE, W } from '@/lib/geo';
import { GROUND_Y, arc, cmdColor, computeLayout, loadColor } from './layout';

export type Sel = { kind: 'bus' | 'line' | 'gen' | 'res' | 'sldc'; id: string } | null;
export type Layers = { flow: boolean; labels: boolean; beams: boolean; plants: boolean };
export type CamPreset = 'state' | 'bengaluru' | 'north' | 'coast';

const damp = THREE.MathUtils.damp;
const ORANGE = '#f26b1d';

/* ================================================================= root */

export default function Scene({ snap, sel, onSelect, layers, preset, focusTick }: {
  snap: any; sel: Sel; onSelect: (s: Sel) => void; layers: Layers; preset: CamPreset; focusTick: number;
}) {
  const topoKey = snap.grid.buses.length + ':' + snap.resources.length;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const layout = useMemo(() => computeLayout(snap), [topoKey]);
  const live = useRef(snap);
  live.current = snap;
  return (
    <Canvas shadows dpr={[1, 2]} camera={{ position: [0, 62, 55], fov: 38, near: 0.5, far: 600 }}
      onPointerMissed={() => onSelect(null)} gl={{ antialias: true, powerPreference: 'high-performance' }}>
      <color attach="background" args={['#eef1f5']} />
      <fog attach="fog" args={['#eef1f5', 110, 230]} />
      <hemisphereLight args={['#ffffff', '#f2e6da', 0.95]} />
      <directionalLight castShadow position={[28, 55, 22]} intensity={1.5} shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-50} shadow-camera-right={50} shadow-camera-top={50} shadow-camera-bottom={-50} shadow-bias={-0.0004} />
      <Ground />
      <Lines snap={snap} layout={layout} sel={sel} onSelect={onSelect} />
      {layers.flow && <FlowParticles live={live} layout={layout} />}
      <Buses snap={snap} layout={layout} sel={sel} onSelect={onSelect} labels={layers.labels} />
      {layers.plants && <Generators snap={snap} layout={layout} onSelect={onSelect} labels={layers.labels} />}
      <Resources snap={snap} layout={layout} onSelect={onSelect} labels={layers.labels} />
      <RotationZones snap={snap} layout={layout} />
      <Sldc pos={layout.sldc} onSelect={onSelect} />
      {layers.beams && <Beams snap={snap} layout={layout} />}
      <SelectionMarker sel={sel} layout={layout} snap={snap} />
      <CameraRig preset={preset} sel={sel} layout={layout} snap={snap} focusTick={focusTick} />
    </Canvas>
  );
}

/* ================================================================= ground */

const Ground = memo(function Ground() {
  const shape = useMemo(() => {
    const s = new THREE.Shape();
    OUTLINE.forEach(([lon, lat], i) => {
      const x = W.x(lon), y = -W.z(lat);
      if (i === 0) s.moveTo(x, y); else s.lineTo(x, y);
    });
    s.closePath();
    return s;
  }, []);
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position-y={-0.01} receiveShadow>
        <planeGeometry args={[400, 400]} />
        <meshStandardMaterial color="#e7ebf0" />
      </mesh>
      <gridHelper args={[160, 64, '#dde2e8', '#e3e7ec']} position-y={0.005} />
      <mesh rotation-x={-Math.PI / 2} receiveShadow castShadow>
        <extrudeGeometry args={[shape, { depth: GROUND_Y, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.15, bevelSegments: 2 }]} />
        <meshStandardMaterial attach="material-0" color="#ffffff" roughness={0.95} />
        <meshStandardMaterial attach="material-1" color="#f6c9a6" roughness={0.9} />
      </mesh>
      <Html position={[W.x(73.95), 0.2, W.z(13.4)]} center zIndexRange={[4, 0]}>
        <div className="pointer-events-none select-none whitespace-nowrap text-[11px] font-semibold uppercase tracking-[0.3em] text-[#9aa3b0]" style={{ transform: 'rotate(-68deg)' }}>Arabian Sea</div>
      </Html>
    </group>
  );
});

/* ================================================================= transmission */

function Lines({ snap, layout, sel, onSelect }: any) {
  return (
    <group>
      {snap.grid.lines.map((ln: any) => {
        const a = layout.bus[ln.from], b = layout.bus[ln.to];
        if (!a || !b) return null;
        return <Span key={ln.id} ln={ln} a={a} b={b} selected={sel?.kind === 'line' && sel.id === ln.id} onSelect={onSelect} />;
      })}
    </group>
  );
}

function Span({ ln, a, b, selected, onSelect }: any) {
  const curve = useMemo(() => arc(a.clone().setY(GROUND_Y + 1.1), b.clone().setY(GROUND_Y + 1.1), 0.8 + a.distanceTo(b) * 0.05), [a, b]);
  const r = ln.kv === 400 ? 0.075 : 0.05;
  const color = loadColor(ln.loading, ln.in_service);
  return (
    <group>
      <mesh onClick={(e) => { e.stopPropagation(); onSelect({ kind: 'line', id: ln.id }); }} castShadow>
        <tubeGeometry args={[curve, 32, selected ? r * 2.2 : r, 6, false]} />
        <meshStandardMaterial color={selected ? ORANGE : color} transparent={!ln.in_service} opacity={ln.in_service ? 1 : 0.45} roughness={0.6} />
      </mesh>
      {/* pylons at the ends */}
      {[a, b].map((p: THREE.Vector3, i: number) => (
        <mesh key={i} position={[p.x, GROUND_Y + 0.55, p.z]} castShadow>
          <cylinderGeometry args={[0.04, 0.09, 1.1, 5]} />
          <meshStandardMaterial color="#9aa3b0" />
        </mesh>
      ))}
    </group>
  );
}

/** One InstancedMesh for every flow particle; speed ∝ loading, direction = sign of flow. */
function FlowParticles({ live, layout }: any) {
  const K = 6;
  const lines: any[] = live.current.grid.lines;
  const curves = useMemo(() => lines.map((ln: any) => {
    const a = layout.bus[ln.from], b = layout.bus[ln.to];
    return arc(a.clone().setY(GROUND_Y + 1.1), b.clone().setY(GROUND_Y + 1.1), 0.8 + a.distanceTo(b) * 0.05);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [layout]);
  const ref = useRef<THREE.InstancedMesh>(null);
  const phase = useRef(new Float32Array(lines.length * K).map((_, i) => (i % K) / K));
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const col = useMemo(() => new THREE.Color(), []);
  useFrame((_, dt) => {
    const m = ref.current;
    if (!m) return;
    const L = live.current.grid.lines;
    for (let i = 0; i < L.length; i++) {
      const ln = L[i];
      const on = ln.in_service && Math.abs(ln.flow) > 15;
      const speed = (0.05 + 0.32 * Math.min(1.3, ln.loading)) * Math.sign(ln.flow || 1);
      col.set(ln.loading >= 1 ? '#d92d20' : ln.loading >= 0.9 ? '#e3a008' : '#f26b1d');
      for (let k = 0; k < K; k++) {
        const j = i * K + k;
        let u = phase.current[j] + dt * speed;
        u = ((u % 1) + 1) % 1;
        phase.current[j] = u;
        const p = curves[i].getPoint(u);
        dummy.position.copy(p);
        const s = on ? (ln.kv === 400 ? 0.17 : 0.13) * (0.8 + Math.min(1, ln.loading) * 0.6) : 0.0001;
        dummy.scale.setScalar(s);
        dummy.updateMatrix();
        m.setMatrixAt(j, dummy.matrix);
        m.setColorAt(j, col);
      }
    }
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  });
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, lines.length * K]} frustumCulled={false}>
      <sphereGeometry args={[1, 10, 8]} />
      <meshStandardMaterial emissive="#f26b1d" emissiveIntensity={0.6} toneMapped={false} />
    </instancedMesh>
  );
}

/* ================================================================= substations */

function Buses({ snap, layout, sel, onSelect, labels }: any) {
  return <group>{snap.grid.buses.map((b: any) => <Bus key={b.id} b={b} p={layout.bus[b.id]} selected={sel?.kind === 'bus' && sel.id === b.id} onSelect={onSelect} labels={labels} />)}</group>;
}

function Bus({ b, p, selected, onSelect, labels }: any) {
  const ref = useRef<THREE.Mesh>(null);
  const target = 0.6 + b.load / 380;
  const dark = b.rotated > 1;
  useFrame((_, dt) => {
    const m = ref.current;
    if (!m) return;
    m.scale.y = damp(m.scale.y, target, 3, dt);
    m.position.y = GROUND_Y + m.scale.y / 2;
  });
  const color = dark ? '#4b5563' : b.flag !== 'GOOD' ? '#f5d76e' : '#ffffff';
  return (
    <group position={[p.x, 0, p.z]} onClick={(e) => { e.stopPropagation(); onSelect({ kind: 'bus', id: b.id }); }}>
      <mesh ref={ref} castShadow receiveShadow scale={[1, 0.6, 1]}>
        {b.tie ? <boxGeometry args={[1.1, 1, 1.1]} /> : <cylinderGeometry args={[0.55, 0.62, 1, 20]} />}
        <meshStandardMaterial color={color} roughness={0.5} metalness={0.05} emissive={selected ? ORANGE : '#000'} emissiveIntensity={selected ? 0.25 : 0} />
      </mesh>
      <mesh position-y={GROUND_Y + 0.02} rotation-x={-Math.PI / 2}>
        <ringGeometry args={[0.75, 0.95, 32]} />
        <meshBasicMaterial color={b.dr > 1 ? '#16a34a' : '#c9cfd8'} />
      </mesh>
      {labels && (
        <Html position={[0, GROUND_Y + target + 0.9, 0]} center zIndexRange={[4, 0]}>
          <div className="pointer-events-none select-none whitespace-nowrap rounded-md border border-[#e5e7eb] bg-white/90 px-1 py-px text-center text-[9px] leading-tight shadow-sm">
            <div className="font-semibold text-[#1f2937]">{b.name.split(' (')[0]}</div>
            <div className="text-[#6b7280]">{Math.round(b.load).toLocaleString('en-IN')} MW{b.rotated > 1 ? <span className="text-[#b45309]"> · −{Math.round(b.rotated)} rot</span> : null}</div>
          </div>
        </Html>
      )}
    </group>
  );
}

/* ================================================================= generators */

function Generators({ snap, layout, onSelect, labels }: any) {
  return (
    <group>
      {snap.grid.gens.map((g: any) => {
        const pl = layout.placed[g.id];
        if (!pl) return null;
        const cf = g.capacity ? g.mw / g.capacity : 0;
        const red = snap.resources.find((r: any) => r.type === 'GENERATION' && r.id === `GEN_${g.id}`);
        return (
          <group key={g.id} position={[pl.pos.x, GROUND_Y, pl.pos.z]} onClick={(e) => { e.stopPropagation(); onSelect({ kind: 'gen', id: g.id }); }}>
            {g.kind === 'thermal' && <Thermal cf={cf} />}
            {g.kind === 'wind' && <Wind cf={cf} />}
            {g.kind === 'solar' && <Solar cf={cf} />}
            {g.kind === 'hydro' && <Hydro cf={cf} />}
            {red && red.delivering > 0.5 && (
              <mesh rotation-x={-Math.PI / 2} position-y={0.03}><ringGeometry args={[1.3, 1.5, 36]} /><meshBasicMaterial color="#16a34a" /></mesh>
            )}
            {labels && (
              <Html position={[0, 3.2, 0]} center zIndexRange={[4, 0]}>
                <div className="pointer-events-none select-none whitespace-nowrap rounded bg-[#1f2937]/80 px-1 py-px text-[9px] text-white">
                  {g.name.split(' ')[0]} · <b>{Math.round(g.mw)}</b>/{g.capacity}{red && red.delivering > 0.5 ? <span className="text-[#86efac]"> +{Math.round(red.delivering)}</span> : null}
                </div>
              </Html>
            )}
          </group>
        );
      })}
    </group>
  );
}

const towerGeo = (() => {
  const pts = [];
  for (let i = 0; i <= 10; i++) {
    const y = i / 10;
    pts.push(new THREE.Vector2(0.42 - 0.22 * Math.sin(Math.PI * y * 0.85) + 0.05 * y, y * 1.6));
  }
  return new THREE.LatheGeometry(pts, 20);
})();

function Thermal({ cf }: { cf: number }) {
  const puffs = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    puffs.current?.children.forEach((c: any, i) => {
      c.position.y += dt * (0.5 + cf);
      c.position.x += dt * 0.15;
      const life = (c.position.y - 2.7) / 2.2;
      if (life > 1) { c.position.set(0.55, 2.7, 0.0); }
      const s = 0.15 + life * 0.35;
      c.scale.setScalar(s);
      c.material.opacity = Math.max(0, (1 - life) * 0.55 * cf);
      void i;
    });
  });
  return (
    <group>
      <mesh geometry={towerGeo} position={[-0.45, 0, 0.2]} castShadow><meshStandardMaterial color="#dfe3e8" side={THREE.DoubleSide} /></mesh>
      <mesh geometry={towerGeo} position={[0.0, 0, -0.55]} castShadow><meshStandardMaterial color="#dfe3e8" side={THREE.DoubleSide} /></mesh>
      <mesh position={[0.55, 1.35, 0]} castShadow><cylinderGeometry args={[0.09, 0.13, 2.7, 10]} /><meshStandardMaterial color="#9aa3b0" /></mesh>
      <mesh position={[0.55, 2.55, 0]}><cylinderGeometry args={[0.1, 0.1, 0.2, 10]} /><meshStandardMaterial color={ORANGE} /></mesh>
      <group ref={puffs}>
        {Array.from({ length: 6 }).map((_, i) => (
          <mesh key={i} position={[0.55, 2.7 + i * 0.37, 0]}>
            <sphereGeometry args={[1, 8, 6]} /><meshStandardMaterial color="#e5e7eb" transparent opacity={0.4} depthWrite={false} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

function Wind({ cf }: { cf: number }) {
  const rotors = useRef<(THREE.Group | null)[]>([]);
  useFrame((_, dt) => rotors.current.forEach((r) => { if (r) r.rotation.z -= dt * (0.6 + cf * 5); }));
  return (
    <group>
      {[[-0.7, -0.4], [0.5, -0.6], [0, 0.6]].map(([x, z], i) => (
        <group key={i} position={[x, 0, z]}>
          <mesh position-y={1.2} castShadow><cylinderGeometry args={[0.04, 0.07, 2.4, 8]} /><meshStandardMaterial color="#f3f4f6" /></mesh>
          <mesh position={[0, 2.42, 0.05]}><boxGeometry args={[0.12, 0.12, 0.3]} /><meshStandardMaterial color="#e5e7eb" /></mesh>
          <group ref={(el) => { rotors.current[i] = el; }} position={[0, 2.42, 0.22]}>
            {[0, 1, 2].map((k) => (
              <mesh key={k} rotation-z={(k * 2 * Math.PI) / 3} position={[0, 0, 0]}>
                <boxGeometry args={[0.07, 1.6, 0.02]} />
                <meshStandardMaterial color="#ffffff" />
              </mesh>
            ))}
          </group>
        </group>
      ))}
    </group>
  );
}

function Solar({ cf }: { cf: number }) {
  return (
    <group>
      {Array.from({ length: 12 }).map((_, i) => {
        const x = (i % 4) * 0.62 - 0.93, z = Math.floor(i / 4) * 0.55 - 0.55;
        return (
          <mesh key={i} position={[x, 0.25, z]} rotation-x={-0.45} castShadow>
            <boxGeometry args={[0.55, 0.03, 0.38]} />
            <meshStandardMaterial color="#1e3a5f" metalness={0.4} roughness={0.3} emissive="#f7941d" emissiveIntensity={cf * 0.55} />
          </mesh>
        );
      })}
    </group>
  );
}

function Hydro({ cf }: { cf: number }) {
  const water = useRef<THREE.Mesh>(null);
  useFrame((st) => { if (water.current) (water.current.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.15 + 0.15 * Math.sin(st.clock.elapsedTime * 2) * cf; });
  return (
    <group>
      <mesh position={[0, 0.5, 0]} castShadow><boxGeometry args={[2, 1, 0.35]} /><meshStandardMaterial color="#cfd5dd" /></mesh>
      <mesh ref={water} position={[0, 0.85, -0.7]} rotation-x={-Math.PI / 2}><planeGeometry args={[2, 1]} /><meshStandardMaterial color="#60a5fa" emissive="#3b82f6" emissiveIntensity={0.2} /></mesh>
      <mesh position={[0, 0.3, 0.45]} rotation-x={-0.6}><planeGeometry args={[0.6, 0.7]} /><meshStandardMaterial color="#93c5fd" transparent opacity={0.4 + cf * 0.5} /></mesh>
    </group>
  );
}

/* ================================================================= flexible resources */

function Resources({ snap, layout, onSelect, labels }: any) {
  const lastCmd: Record<string, any> = {};
  for (const c of [...snap.commands].reverse()) lastCmd[c.resource] = c;
  return (
    <group>
      {snap.resources.filter((r: any) => r.type !== 'RTM' && r.type !== 'GENERATION').map((r: any) => {
        const pl = layout.placed[r.id];
        if (!pl) return null;
        const c = lastCmd[r.id];
        const pending = c && c.state === 'AWAITING_APPROVAL';
        return (
          <group key={r.id} position={[pl.pos.x, GROUND_Y, pl.pos.z]} onClick={(e) => { e.stopPropagation(); onSelect({ kind: 'res', id: r.id }); }}>
            {r.type === 'BESS' && <Bess r={r} />}
            {r.type === 'INDUSTRIAL' && <Factory r={r} />}
            {(r.type === 'INTERRUPTIBLE' || r.type === 'SHIFTABLE') && <Pump r={r} />}
            {r.type === 'DER' && <DerCluster r={r} />}
            {(r.delivering > 0.5 || pending || r.veto) && (
              <mesh rotation-x={-Math.PI / 2} position-y={0.03}>
                <ringGeometry args={[0.85, 1.0, 32]} />
                <meshBasicMaterial color={r.veto ? '#d92d20' : pending ? '#d97706' : '#16a34a'} />
              </mesh>
            )}
            {labels && (r.delivering > 0.5 || pending) && (
              <Html position={[0, 2.1, 0]} center zIndexRange={[4, 0]}>
                <div className={`pointer-events-none select-none whitespace-nowrap rounded-full px-1.5 py-px text-[9px] font-semibold text-white shadow ${pending ? 'bg-[#d97706]' : 'bg-[#16a34a]'}`}>
                  {pending ? `awaiting · ${Math.round(c.setpoint)} MW` : `−${Math.round(r.delivering)} MW`}
                </div>
              </Html>
            )}
          </group>
        );
      })}
    </group>
  );
}

function Bess({ r }: { r: any }) {
  const fill = useRef<THREE.Mesh>(null);
  const glow = useRef<THREE.Mesh>(null);
  useFrame((st, dt) => {
    if (fill.current) {
      fill.current.scale.y = damp(fill.current.scale.y, Math.max(0.02, r.soc ?? 0.5), 3, dt);
      fill.current.position.y = 0.05 + fill.current.scale.y * 0.6;
    }
    if (glow.current) (glow.current.material as THREE.MeshStandardMaterial).emissiveIntensity = r.delivering > 0.5 ? 0.6 + 0.4 * Math.sin(st.clock.elapsedTime * 4) : 0;
  });
  return (
    <group>
      {[-0.4, 0.4].map((x) => (
        <mesh key={x} position={[x, 0.3, 0]} castShadow><boxGeometry args={[0.7, 0.6, 0.45]} /><meshStandardMaterial color="#ffffff" /></mesh>
      ))}
      <mesh position={[0, 0.62, 0]}><boxGeometry args={[1.5, 0.04, 0.47]} /><meshStandardMaterial color={ORANGE} /></mesh>
      {/* SoC gauge */}
      <mesh position={[0.95, 0.65, 0]}><boxGeometry args={[0.16, 1.25, 0.16]} /><meshStandardMaterial color="#e5e7eb" transparent opacity={0.5} /></mesh>
      <mesh ref={fill} position={[0.95, 0.35, 0]} scale={[1, r.soc ?? 0.5, 1]}><boxGeometry args={[0.12, 1.2, 0.12]} /><meshStandardMaterial color={(r.soc ?? 1) < 0.2 ? '#d97706' : '#16a34a'} /></mesh>
      <mesh ref={glow} position={[0, 0.66, 0]}><boxGeometry args={[0.3, 0.06, 0.3]} /><meshStandardMaterial color="#16a34a" emissive="#22c55e" emissiveIntensity={0} /></mesh>
    </group>
  );
}

function Factory({ r }: { r: any }) {
  const curtail = r.available > 0 ? Math.min(1, r.delivering / Math.max(r.available, 1)) : 0;
  const win = useRef<THREE.MeshStandardMaterial>(null);
  useFrame((_, dt) => { if (win.current) win.current.emissiveIntensity = damp(win.current.emissiveIntensity, 0.9 * (1 - curtail * 0.85), 2, dt); });
  return (
    <group>
      <mesh position={[0, 0.35, 0]} castShadow receiveShadow><boxGeometry args={[1.5, 0.7, 0.9]} /><meshStandardMaterial color="#eef0f3" /></mesh>
      {[-0.5, 0, 0.5].map((x) => (
        <mesh key={x} position={[x, 0.78, 0]} rotation-z={Math.PI / 4} castShadow><boxGeometry args={[0.32, 0.32, 0.9]} /><meshStandardMaterial color="#d4d8de" /></mesh>
      ))}
      <mesh position={[0, 0.32, 0.455]}><planeGeometry args={[1.2, 0.18]} /><meshStandardMaterial ref={win} color="#fed7aa" emissive="#f7941d" emissiveIntensity={0.9} /></mesh>
      <mesh position={[0.6, 1.0, -0.25]} castShadow><cylinderGeometry args={[0.07, 0.09, 1.3, 8]} /><meshStandardMaterial color="#9aa3b0" /></mesh>
    </group>
  );
}

function Pump({ r }: { r: any }) {
  const off = r.delivering > 0.5;
  return (
    <group>
      <mesh position={[0, 0.3, 0]} castShadow><cylinderGeometry args={[0.35, 0.35, 0.6, 16]} /><meshStandardMaterial color={off ? '#d1d5db' : '#bfdbfe'} /></mesh>
      <mesh position={[0.45, 0.15, 0]} rotation-z={Math.PI / 2}><cylinderGeometry args={[0.08, 0.08, 0.6, 8]} /><meshStandardMaterial color="#9aa3b0" /></mesh>
    </group>
  );
}

function DerCluster({ r }: { r: any }) {
  const off = r.delivering > 0.5;
  return (
    <group>
      {[[-0.35, -0.2], [0.3, -0.3], [0, 0.35], [0.45, 0.3]].map(([x, z], i) => (
        <group key={i} position={[x, 0, z]}>
          <mesh position-y={0.15} castShadow><boxGeometry args={[0.3, 0.3, 0.3]} /><meshStandardMaterial color="#ffffff" /></mesh>
          <mesh position-y={0.33} rotation-x={-0.4}><boxGeometry args={[0.32, 0.02, 0.2]} /><meshStandardMaterial color="#1e3a5f" emissive={off ? '#16a34a' : '#000'} emissiveIntensity={off ? 0.5 : 0} /></mesh>
        </group>
      ))}
    </group>
  );
}

/* ================================================================= rotation */

function RotationZones({ snap, layout }: any) {
  return (
    <group>
      {snap.grid.buses.filter((b: any) => b.rotated > 1).map((b: any) => {
        const p = layout.bus[b.id];
        return (
          <group key={b.id} position={[p.x, GROUND_Y + 0.02, p.z]}>
            <mesh rotation-x={-Math.PI / 2}><circleGeometry args={[2.4, 40]} /><meshBasicMaterial color="#1f2937" transparent opacity={0.18} /></mesh>
            <mesh rotation-x={-Math.PI / 2}><ringGeometry args={[2.35, 2.5, 40]} /><meshBasicMaterial color="#d97706" /></mesh>
          </group>
        );
      })}
    </group>
  );
}

/* ================================================================= SLDC + command beams */

function Sldc({ pos, onSelect }: { pos: THREE.Vector3; onSelect: (s: Sel) => void }) {
  const beacon = useRef<THREE.Mesh>(null);
  useFrame((st) => { if (beacon.current) (beacon.current.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.6 + 0.6 * Math.sin(st.clock.elapsedTime * 3); });
  return (
    <group position={[pos.x, GROUND_Y, pos.z]} onClick={(e) => { e.stopPropagation(); onSelect({ kind: 'sldc', id: 'SLDC' }); }}>
      <mesh position-y={1.4} castShadow><boxGeometry args={[1.3, 2.8, 1.3]} /><meshStandardMaterial color="#ffffff" /></mesh>
      {[0.6, 1.2, 1.8, 2.4].map((y) => (
        <mesh key={y} position={[0, y, 0.656]}><planeGeometry args={[1.1, 0.3]} /><meshStandardMaterial color="#bfdbfe" emissive="#93c5fd" emissiveIntensity={0.3} /></mesh>
      ))}
      <mesh position-y={2.9}><boxGeometry args={[1.4, 0.15, 1.4]} /><meshStandardMaterial color={ORANGE} /></mesh>
      <mesh position-y={3.5}><cylinderGeometry args={[0.03, 0.03, 1.1, 6]} /><meshStandardMaterial color="#6b7280" /></mesh>
      <mesh ref={beacon} position-y={4.1}><sphereGeometry args={[0.12, 12, 10]} /><meshStandardMaterial color={ORANGE} emissive={ORANGE} emissiveIntensity={1} /></mesh>
      <Html position={[0, 4.8, 0]} center zIndexRange={[4, 0]}>
        <div className="pointer-events-none select-none whitespace-nowrap rounded-md px-1.5 py-0.5 text-[10px] font-semibold text-white shadow" style={{ background: 'linear-gradient(90deg,#f26b1d,#f7941d)' }}>SLDC · ADRMS</div>
      </Html>
    </group>
  );
}

function Beams({ snap, layout }: any) {
  const latest: Record<string, any> = {};
  for (const c of [...snap.commands].reverse()) if (c.kind === 'SET') latest[c.resource] = c;
  const live = Object.values(latest).filter((c: any) => ['AWAITING_APPROVAL', 'READY', 'SENT', 'ACKED', 'EXECUTING', 'FAILED'].includes(c.state));
  return <group>{live.map((c: any) => {
    const pl = layout.placed[c.resource];
    if (!pl) return null;
    return <Beam key={c.resource} from={layout.sldc} to={pl.pos} state={c.state} />;
  })}</group>;
}

function Beam({ from, to, state }: { from: THREE.Vector3; to: THREE.Vector3; state: string }) {
  const curve = useMemo(() => arc(from.clone().setY(GROUND_Y + 4.1), to.clone().setY(GROUND_Y + 1.2), 4 + from.distanceTo(to) * 0.12), [from, to]);
  const pts = useMemo(() => curve.getPoints(48), [curve]);
  const color = cmdColor(state);
  const dots = useRef<THREE.Group>(null);
  const speed = state === 'SENT' || state === 'READY' ? 0.9 : state === 'EXECUTING' || state === 'ACKED' ? 0.35 : 0;
  useFrame((st) => {
    dots.current?.children.forEach((c, i) => {
      const u = speed ? (st.clock.elapsedTime * speed + i / 3) % 1 : 0.5;
      c.position.copy(curve.getPoint(u));
      c.visible = speed > 0;
    });
  });
  return (
    <group>
      <Line points={pts} color={color} lineWidth={state === 'AWAITING_APPROVAL' ? 1.6 : 2.2} dashed={state === 'AWAITING_APPROVAL'} dashSize={0.6} gapSize={0.4} transparent opacity={0.9} />
      <group ref={dots}>
        {[0, 1, 2].map((i) => <mesh key={i}><sphereGeometry args={[0.16, 10, 8]} /><meshBasicMaterial color={color} /></mesh>)}
      </group>
    </group>
  );
}

/* ================================================================= selection & camera */

function posOf(sel: Sel, layout: any, snap: any): THREE.Vector3 | null {
  if (!sel) return null;
  if (sel.kind === 'bus') return layout.bus[sel.id] ?? null;
  if (sel.kind === 'gen' || sel.kind === 'res') return layout.placed[sel.id]?.pos ?? (sel.kind === 'res' ? layout.bus[snap.resources.find((r: any) => r.id === sel.id)?.bus] ?? null : null);
  if (sel.kind === 'sldc') return layout.sldc;
  if (sel.kind === 'line') {
    const ln = snap.grid.lines.find((l: any) => l.id === sel.id);
    if (!ln) return null;
    return layout.bus[ln.from].clone().add(layout.bus[ln.to]).multiplyScalar(0.5);
  }
  return null;
}

function SelectionMarker({ sel, layout, snap }: any) {
  const ref = useRef<THREE.Mesh>(null);
  const p = posOf(sel, layout, snap);
  useFrame((st) => {
    if (!ref.current) return;
    const s = 1 + 0.12 * Math.sin(st.clock.elapsedTime * 4);
    ref.current.scale.set(s, s, s);
  });
  if (!p) return null;
  return (
    <mesh ref={ref} position={[p.x, GROUND_Y + 0.05, p.z]} rotation-x={-Math.PI / 2}>
      <ringGeometry args={[1.25, 1.45, 48]} />
      <meshBasicMaterial color={ORANGE} />
    </mesh>
  );
}

const PRESETS: Record<CamPreset, [number, number, number, number, number, number]> = {
  state: [0, 62, 55, 0, 0, 2],
  bengaluru: [W.x(77.55) + 4, 30, W.z(12.95) + 24, W.x(77.6), 0, W.z(13.0)],
  north: [W.x(76.6), 34, W.z(16.2) + 28, W.x(76.6), 0, W.z(16.3)],
  coast: [W.x(74.9) - 10, 24, W.z(13.6) + 20, W.x(75.2), 0, W.z(13.7)],
};

function CameraRig({ preset, sel, layout, snap, focusTick }: any) {
  const ref = useRef<CameraControls>(null);
  useEffect(() => { ref.current?.setLookAt(...PRESETS[preset as CamPreset], true); }, [preset]);
  useEffect(() => {
    const p = posOf(sel, layout, snap);
    if (p && ref.current) ref.current.setLookAt(p.x + 7, 13, p.z + 11, p.x, 0.6, p.z, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel?.kind, sel?.id, focusTick]);
  return <CameraControls ref={ref} makeDefault minDistance={6} maxDistance={140} maxPolarAngle={Math.PI / 2.2} smoothTime={0.6} />;
}
