'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Chip, Meter, cx, loadTone } from './ui';
import { mw, pct } from '@/lib/fmt';

/* Schematic geography: equirectangular projection; outline is approximate. */
const X = (lon: number) => (lon - 73.6) * 96.6;
const Y = (lat: number) => (18.7 - lat) * 100;

const OUTLINE: [number, number][] = [
  [77.05, 18.45], [77.45, 18.3], [77.6, 18.0], [77.55, 17.6], [77.45, 17.25], [77.6, 16.9], [77.48, 16.5], [77.25, 16.25],
  [77.0, 16.0], [76.95, 15.6], [77.15, 15.3], [77.1, 15.0], [76.85, 14.75], [77.15, 14.45], [77.45, 14.2], [77.8, 14.0],
  [78.1, 13.75], [78.45, 13.45], [78.5, 13.05], [78.2, 12.85], [77.9, 12.7], [77.75, 12.35], [77.75, 12.05], [77.45, 11.9],
  [77.1, 11.75], [76.7, 11.6], [76.4, 11.75], [76.1, 11.95], [75.85, 12.15], [75.55, 12.4], [75.2, 12.55], [74.85, 12.75],
  [74.82, 12.95], [74.7, 13.35], [74.62, 13.75], [74.5, 14.05], [74.35, 14.45], [74.12, 14.78], [74.25, 15.05],
  [74.45, 15.35], [74.25, 15.65], [74.32, 15.95], [74.55, 16.3], [74.95, 16.55], [75.45, 16.95], [75.85, 17.35],
  [76.25, 17.55], [76.55, 17.85], [76.85, 18.15],
];
const EXT = { x0: X(73.95), x1: X(78.65), y0: Y(18.55), y1: Y(11.5) };

type Sel = { kind: 'bus' | 'line'; id: string } | null;

function useSize(ref: React.RefObject<HTMLDivElement | null>) {
  const [s, setS] = useState({ w: 1200, h: 800 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setS({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return s;
}

export default function KarnatakaMap({ snap, insetRight = 0, insetTop = 0, insetLeft = 0, insetBottom = 0, mode = 'grid', selected, onSelect, highlight = [] }: {
  snap: any; insetRight?: number; insetTop?: number; insetLeft?: number; insetBottom?: number;
  mode?: 'grid' | 'rotation' | 'dr'; selected: Sel; onSelect: (s: Sel) => void; highlight?: string[];
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const { w, h } = useSize(wrap);
  const g = snap?.grid;
  const buses: any[] = g?.buses ?? [];
  const busBy = useMemo(() => Object.fromEntries(buses.map((b) => [b.id, b])), [buses]);

  // camera: centre (world) + zoom; tweened
  const free = { w: Math.max(200, w - insetRight - insetLeft), h: Math.max(200, h - insetTop - insetBottom) };
  const baseScale = Math.min(free.w / (EXT.x1 - EXT.x0), free.h / (EXT.y1 - EXT.y0)) * 0.94;
  const target = useMemo(() => {
    if (selected?.kind === 'bus' && busBy[selected.id]) {
      const b = busBy[selected.id];
      return { cx: X(b.lon), cy: Y(b.lat), z: 2.4 };
    }
    if (selected?.kind === 'line') {
      const ln = g?.lines.find((l: any) => l.id === selected.id);
      if (ln && busBy[ln.from] && busBy[ln.to]) {
        const a = busBy[ln.from], c = busBy[ln.to];
        return { cx: (X(a.lon) + X(c.lon)) / 2, cy: (Y(a.lat) + Y(c.lat)) / 2, z: 2 };
      }
    }
    return { cx: (EXT.x0 + EXT.x1) / 2, cy: (EXT.y0 + EXT.y1) / 2, z: 1 };
  }, [selected, busBy, g?.lines]);
  const [cam, setCam] = useState(target);
  const camRef = useRef(cam);
  camRef.current = cam;
  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      setCam(target);
      return;
    }
    const from = camRef.current;
    const t0 = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / 650);
      const e = 1 - Math.pow(1 - k, 3);
      setCam({ cx: from.cx + (target.cx - from.cx) * e, cy: from.cy + (target.cy - from.cy) * e, z: from.z + (target.z - from.z) * e });
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target]);

  const s = baseScale * cam.z;
  const fcx = insetLeft + free.w / 2, fcy = insetTop + free.h / 2;
  const vb = [cam.cx - fcx / s, cam.cy - fcy / s, w / s, h / s];
  const k = 1 / cam.z; // keep symbols a constant screen size when zoomed

  // anchored card position
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  useLayoutEffect(() => {
    if (!selected) return setAnchor(null);
    let wx = 0, wy = 0;
    if (selected.kind === 'bus' && busBy[selected.id]) {
      wx = X(busBy[selected.id].lon); wy = Y(busBy[selected.id].lat);
    } else if (selected.kind === 'line') {
      wx = target.cx; wy = target.cy;
    } else return setAnchor(null);
    setAnchor({ x: (wx - vb[0]) * s, y: (wy - vb[1]) * s });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, cam, w, h, busBy]);

  if (!g) return <div ref={wrap} className="absolute inset-0" />;
  const outline = OUTLINE.map(([lo, la]) => `${X(lo)},${Y(la)}`).join(' ');
  const rot = snap.rotation;
  const outStations = new Set<string>();
  if (mode === 'rotation') for (const gr of rot.groups) if (gr.out) for (const st of gr.stations) outStations.add(`${st.bus}:${st.name}`);
  const res: any[] = snap.resources ?? [];

  return (
    <div ref={wrap} className="absolute inset-0 select-none">
      <svg ref={svg} viewBox={vb.join(' ')} className="h-full w-full" onClick={() => onSelect(null)} role="img"
        aria-label="Karnataka transmission network">
        <defs>
          <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
            <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#0f1a2c" strokeWidth={0.5} />
          </pattern>
        </defs>
        <rect x={vb[0]} y={vb[1]} width={vb[2]} height={vb[3]} fill="url(#grid)" />
        <polygon points={outline} fill="var(--map-land)" stroke="var(--map-edge)" strokeWidth={1.4 * k} />
        <text x={X(74.3)} y={Y(13.0)} fontSize={11 * k} fill="#334155" transform={`rotate(-62 ${X(74.3)} ${Y(13.0)})`}>ARABIAN SEA</text>

        {/* lines */}
        {g.lines.map((ln: any) => {
          const a = busBy[ln.from], b = busBy[ln.to];
          if (!a || !b) return null;
          const tone = loadTone(ln.loading);
          const col = !ln.in_service ? '#475569' : tone === 'alarm' ? 'var(--alarm)' : tone === 'p3' ? 'var(--p3)' : 'var(--map-line)';
          const sel = selected?.kind === 'line' && selected.id === ln.id;
          const x1 = X(a.lon), y1 = Y(a.lat), x2 = X(b.lon), y2 = Y(b.lat);
          const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
          const ang = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI + (ln.flow < 0 ? 180 : 0);
          return (
            <g key={ln.id} className="cursor-pointer" onClick={(e) => { e.stopPropagation(); onSelect({ kind: 'line', id: ln.id }); }}>
              <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="transparent" strokeWidth={10 * k} />
              {sel && <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--accent)" strokeOpacity={0.35} strokeWidth={7 * k} />}
              <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={col} strokeWidth={(ln.kv === 400 ? 2.2 : 1.3) * k}
                strokeDasharray={ln.in_service ? undefined : `${4 * k} ${3 * k}`} />
              {ln.in_service && Math.abs(ln.flow) > 20 && (
                <path d={`M ${-3 * k} ${-2.6 * k} L ${3 * k} 0 L ${-3 * k} ${2.6 * k} z`} fill={col}
                  transform={`translate(${mx} ${my}) rotate(${ang})`} />
              )}
              {(ln.loading >= 0.9 || sel || cam.z > 1.8) && (
                <text x={mx + 4 * k} y={my - 4 * k} fontSize={8 * k} fill={tone === 'neutral' ? 'var(--muted)' : col}>
                  {Math.round(ln.loading * 100)}%
                </text>
              )}
            </g>
          );
        })}

        {/* rotation overlay: stations out */}
        {mode === 'rotation' && rot.groups.flatMap((gr: any) => gr.stations.map((st: any, i: number) => {
          const b = busBy[st.bus];
          const n = gr.stations.length;
          const ang = (i / Math.max(1, n)) * Math.PI * 2 + gr.id.length;
          const x = X(b.lon) + Math.cos(ang) * 11 * k, y = Y(b.lat) + Math.sin(ang) * 11 * k;
          const out = outStations.has(`${st.bus}:${st.name}`);
          return (
            <g key={`${gr.id}:${st.name}`}>
              <rect x={x - 2.4 * k} y={y - 2.4 * k} width={4.8 * k} height={4.8 * k} transform={`rotate(45 ${x} ${y})`}
                fill={out ? 'var(--warn)' : '#334155'} stroke={out ? 'var(--warn)' : 'none'} />
            </g>
          );
        }))}

        {/* buses */}
        {buses.map((b) => {
          const x = X(b.lon), y = Y(b.lat);
          const r = (3 + Math.sqrt(b.load) / 9) * k;
          const sel = selected?.kind === 'bus' && selected.id === b.id;
          const hl = highlight.includes(b.id);
          const dr = b.dr > 1;
          const rotOut = b.rotated > 1;
          return (
            <g key={b.id} className="cursor-pointer" onClick={(e) => { e.stopPropagation(); onSelect({ kind: 'bus', id: b.id }); }}>
              {dr && mode !== 'rotation' && <circle cx={x} cy={y} r={r + 4 * k} fill="none" stroke="var(--ok)" strokeWidth={1.5 * k} className="pulse" />}
              {dr && <circle cx={x} cy={y} r={r + 3 * k} fill="none" stroke="var(--ok)" strokeWidth={1.4 * k} />}
              {rotOut && <circle cx={x} cy={y} r={r + 6 * k} fill="none" stroke="var(--warn)" strokeWidth={1.4 * k} strokeDasharray={`${3 * k} ${2 * k}`} />}
              {(sel || hl) && <circle cx={x} cy={y} r={r + 8 * k} fill="none" stroke="var(--accent)" strokeWidth={1.6 * k} />}
              {b.tie ? (
                <rect x={x - r} y={y - r} width={2 * r} height={2 * r} fill="#1e293b" stroke="#cbd5e1" strokeWidth={1.2 * k} />
              ) : (
                <circle cx={x} cy={y} r={r} fill="#1e293b" stroke="#cbd5e1" strokeWidth={1.2 * k} />
              )}
              {b.flag !== 'GOOD' && (
                <text x={x + r} y={y - r} fontSize={10 * k} fontWeight={700} fill="var(--p3)">?</text>
              )}
              <text x={x + r + 3 * k} y={y + 3 * k} fontSize={8.5 * k} fill="#cbd5e1">{b.name.split(' (')[0]}</text>
            </g>
          );
        })}
      </svg>

      {/* legend */}
      <div className="glass pointer-events-none absolute flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg px-2.5 py-1.5 text-[10px] text-[var(--muted)]"
        style={{ left: insetLeft + 12, bottom: insetBottom + 12 }}>
        <span className="flex items-center gap-1"><i className="inline-block h-0.5 w-4 bg-[var(--map-line)]" /> line</span>
        <span className="flex items-center gap-1"><i className="inline-block h-0.5 w-4 bg-[var(--p3)]" /> ≥ 90%</span>
        <span className="flex items-center gap-1"><i className="inline-block h-0.5 w-4 bg-[var(--alarm)]" /> ≥ 100%</span>
        <span className="flex items-center gap-1"><i className="inline-block h-2 w-2 rounded-full border border-[var(--ok)]" /> DR delivering</span>
        <span className="flex items-center gap-1"><i className="inline-block h-2 w-2 rounded-full border border-dashed border-[var(--warn)]" /> rotated out</span>
        <span className="flex items-center gap-1"><i className="inline-block h-2 w-2 border border-slate-300" /> tie bus</span>
        <span>Schematic geography · DC screening model</span>
      </div>

      {anchor && selected && <Anchored snap={snap} sel={selected} pos={anchor} res={res} busBy={busBy} onClose={() => onSelect(null)} bounds={{ w, h, right: insetRight }} />}
    </div>
  );
}

function Anchored({ snap, sel, pos, res, busBy, onClose, bounds }: any) {
  const width = 280;
  let left = pos.x + 24;
  if (left + width > bounds.w - bounds.right - 8) left = pos.x - width - 24;
  const top = Math.max(110, Math.min(bounds.h - 300, pos.y - 60));
  const g = snap.grid;
  let body: React.ReactNode = null;
  let title = '';
  if (sel.kind === 'bus') {
    const b = busBy[sel.id];
    if (!b) return null;
    title = b.name;
    const here = res.filter((r: any) => r.bus === b.id);
    const gens = g.gens.filter((x: any) => x.bus === b.id);
    const lines = g.lines.filter((l: any) => l.from === b.id || l.to === b.id);
    body = (
      <>
        <div className="grid grid-cols-3 gap-2 text-[11px]">
          <div><div className="text-[var(--muted)]">Load</div><div className="font-semibold tabular-nums">{mw(b.load)}</div></div>
          <div><div className="text-[var(--muted)]">V (screen)</div><div className={cx('font-semibold tabular-nums', b.v < 0.95 && 'text-[var(--warn)]')}>{b.v.toFixed(3)} pu</div></div>
          <div><div className="text-[var(--muted)]">Telemetry</div><Chip tone={b.flag === 'GOOD' ? 'neutral' : 'p3'} icon={b.flag !== 'GOOD'}>{b.flag}</Chip></div>
        </div>
        <div className="mt-2 text-[10px] uppercase tracking-wider text-[var(--muted)]">{b.discom}{b.tie ? ' · inter-state tie' : ''}</div>
        {(b.dr > 0 || b.rotated > 0) && (
          <div className="mt-1 flex gap-2 text-[11px]">
            {b.dr > 0 && <Chip tone="ok">DR {mw(b.dr)}</Chip>}
            {b.rotated > 0 && <Chip tone="warn">Rotated {mw(b.rotated)}</Chip>}
          </div>
        )}
        {gens.length > 0 && <div className="mt-2 space-y-0.5 text-[11px]">{gens.map((x: any) => (
          <div key={x.id} className="flex justify-between"><span className="truncate">{x.name}</span><span className="tabular-nums text-[var(--muted)]">{x.mw.toFixed(0)} / {x.capacity} MW</span></div>))}</div>}
        {here.length > 0 && <div className="mt-2 space-y-0.5 text-[11px]">{here.map((r: any) => (
          <div key={r.id} className="flex justify-between gap-2"><span className="truncate">{r.name}</span>
            <span className="shrink-0 tabular-nums">{r.delivering > 0.5 ? <span className="text-[var(--ok)]">{r.delivering.toFixed(0)} MW</span> : <span className="text-[var(--muted)]">{r.available.toFixed(0)} avail</span>}</span></div>))}</div>}
        <div className="mt-2 space-y-1">{lines.slice(0, 5).map((l: any) => (
          <div key={l.id} className="grid grid-cols-[3rem_1fr_2.5rem] items-center gap-2 text-[10px]">
            <span>{l.id}</span><Meter value={l.loading} max={1} tone={loadTone(l.loading)} /><span className="text-right tabular-nums">{pct(l.loading)}</span></div>))}</div>
      </>
    );
  } else {
    const l = g.lines.find((x: any) => x.id === sel.id);
    if (!l) return null;
    title = `${l.id} · ${busBy[l.from]?.name.split(' (')[0]} – ${busBy[l.to]?.name.split(' (')[0]}`;
    const fc = (snap.forecast?.violations ?? []).filter((v: any) => v.line === l.id);
    body = (
      <>
        <div className="grid grid-cols-3 gap-2 text-[11px]">
          <div><div className="text-[var(--muted)]">Flow</div><div className="font-semibold tabular-nums">{mw(Math.abs(l.flow))}</div></div>
          <div><div className="text-[var(--muted)]">Limit</div><div className="font-semibold tabular-nums">{mw(l.limit)}</div></div>
          <div><div className="text-[var(--muted)]">Loading</div><div className={cx('font-semibold tabular-nums', l.loading >= 1 ? 'text-[var(--alarm)]' : l.loading >= 0.9 && 'text-[var(--p3)]')}>{pct(l.loading)}</div></div>
        </div>
        <Meter className="mt-2" value={l.loading} max={1} tone={loadTone(l.loading)} />
        <div className="mt-2 text-[11px] text-[var(--muted)]">{l.kv} kV · {l.in_service ? 'in service' : 'OUT OF SERVICE'} · flow {l.flow >= 0 ? `${l.from} → ${l.to}` : `${l.to} → ${l.from}`}</div>
        {fc.length > 0 && <div className="mt-1 text-[11px] text-[var(--p3)]">◆ Forecast {pct(fc[0].value)} in block {fc[0].block}</div>}
      </>
    );
  }
  return (
    <div className="glass-strong absolute z-20 rounded-xl p-3 shadow-2xl" style={{ left, top, width }} onClick={(e) => e.stopPropagation()}>
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="text-sm font-semibold leading-tight">{title}</div>
        <button className="text-xs text-[var(--muted)] hover:text-[var(--fg)]" onClick={onClose} aria-label="Close">✕</button>
      </div>
      {body}
    </div>
  );
}
