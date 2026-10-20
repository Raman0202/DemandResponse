/* eslint-disable @typescript-eslint/no-explicit-any */
import * as THREE from 'three';
import { SLDC, W } from '@/lib/geo';

export const GROUND_Y = 0.4;

export type Placed = { id: string; kind: 'gen' | 'res'; type: string; bus: string; pos: THREE.Vector3; label: string };

/** Static placement: buses at their coordinates, generators and flexible resources on a ring around their bus. */
export function computeLayout(snap: any) {
  const bus: Record<string, THREE.Vector3> = {};
  for (const b of snap.grid.buses) bus[b.id] = new THREE.Vector3(W.x(b.lon), GROUND_Y, W.z(b.lat));
  const placed: Record<string, Placed> = {};
  const byBus: Record<string, { id: string; kind: 'gen' | 'res'; type: string; label: string }[]> = {};
  for (const g of snap.grid.gens) (byBus[g.bus] ??= []).push({ id: g.id, kind: 'gen', type: g.kind, label: g.name });
  for (const r of snap.resources) {
    if (r.type === 'RTM' || r.type === 'GENERATION') continue; // RTM is a market; re-dispatch acts on the plant itself
    (byBus[r.bus] ??= []).push({ id: r.id, kind: 'res', type: r.type, label: r.name });
  }
  for (const [bid, items] of Object.entries(byBus)) {
    const c = bus[bid];
    const n = items.length;
    const radius = n > 2 ? 2.9 : 2.5;
    items.forEach((it, i) => {
      const a = -Math.PI / 3 + (i / Math.max(1, n)) * Math.PI * 2;
      placed[it.id] = { ...it, bus: bid, pos: new THREE.Vector3(c.x + Math.cos(a) * radius, GROUND_Y, c.z + Math.sin(a) * radius) };
    });
  }
  // generation re-dispatch resources act on the generator object
  for (const r of snap.resources) {
    if (r.type === 'GENERATION') {
      const gid = r.id.replace('GEN_', '');
      const g = placed[gid];
      if (g) placed[r.id] = { ...g, id: r.id, kind: 'res', type: 'GENERATION', label: r.name };
    }
  }
  const sldc = new THREE.Vector3(W.x(SLDC.lon), GROUND_Y, W.z(SLDC.lat));
  return { bus, placed, sldc };
}

export function arc(a: THREE.Vector3, b: THREE.Vector3, lift: number) {
  const mid = a.clone().add(b).multiplyScalar(0.5);
  mid.y = Math.max(a.y, b.y) + lift;
  return new THREE.QuadraticBezierCurve3(a, mid, b);
}

export const loadColor = (l: number, inService = true) =>
  !inService ? '#c3c8d0' : l >= 1 ? '#d92d20' : l >= 0.9 ? '#e3a008' : l >= 0.7 ? '#8a94a3' : '#a9b1bd';

export const cmdColor = (state: string) =>
  state === 'AWAITING_APPROVAL' ? '#d97706' : state === 'FAILED' ? '#d92d20' : state === 'EXECUTING' || state === 'ACKED' ? '#16a34a' : '#2563eb';
