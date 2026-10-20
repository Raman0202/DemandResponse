'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef, useState } from 'react';
import { Btn, Chip, Tabs, cx, sevTone, useAct } from '../ui';
import { dur, hhmmss, rsShort } from '@/lib/fmt';
import type { Claims } from '@/lib/api';

export type View = 'overview' | 'events' | 'grid' | 'rotation' | 'programmes' | 'forecast' | 'alarms' | 'whatif' | 'settlement' | 'admin';

function Popover({ label, children, tone, width = 'w-72' }: { label: React.ReactNode; children: React.ReactNode; tone?: string; width?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    window.addEventListener('mousedown', h);
    return () => window.removeEventListener('mousedown', h);
  }, []);
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(!open)} aria-expanded={open}
        className={cx('flex items-center gap-1.5 rounded-md border border-[var(--line)] px-2 py-1 text-xs hover:bg-[var(--chip)]', tone)}>
        {label}<span className="text-[8px] text-[var(--muted)]">▼</span>
      </button>
      {open && <div className={cx('glass-strong absolute right-0 top-full z-50 mt-1 rounded-lg p-2 shadow-2xl', width)}>{children}</div>}
    </div>
  );
}

export default function TopBar({ snap, view, setView, user, link, onLogout }: {
  snap: any; view: View; setView: (v: View) => void; user: Claims; link: string; onLogout: () => void;
}) {
  const act = useAct();
  const g = snap.grid, q = snap.quality, au = snap.autonomy, ev = snap.event, clk = snap.clock;
  const counts = snap.alarms.counts;
  const unacked = snap.alarms.active.filter((a: any) => !a.acked_by && !a.shelved_until);
  const top = unacked[0];
  const awaiting = ev?.rounds?.find((r: any) => r.state === 'PENDING');
  const rotProposed = snap.rotation.order?.state === 'PROPOSED';
  const pendingOffers = snap.gridflex.offers.filter((o: any) => o.status === 'PENDING').length + snap.gridflex.applications.filter((a: any) => a.status === 'SUBMITTED').length;
  const confTone = q.confidence < 0.8 ? 'text-[var(--alarm)]' : q.confidence < 0.97 || q.vetoes.length ? 'text-[var(--p3)]' : '';
  const freqTone = g.freq < 49.8 ? 'text-[var(--alarm)]' : g.freq < 49.9 || g.freq > 50.05 ? 'text-[var(--warn)]' : '';
  const badge = (n: number, tone: 'p1' | 'p2' | 'warn' | 'info' = 'warn') =>
    n > 0 ? <span className={cx('ml-0.5 rounded px-1 text-[9px] font-bold', tone === 'p1' ? 'bg-[var(--alarm)] text-black' : tone === 'info' ? 'bg-[var(--info)] text-black' : 'bg-[var(--warn)] text-black')}>{n}</span> : null;

  const nav: { id: View; label: string; badge?: React.ReactNode }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'events', label: 'DR Events', badge: awaiting ? badge(1) : ev ? <span className="ml-0.5 text-[var(--ok)]">●</span> : null },
    { id: 'grid', label: 'Grid' },
    { id: 'rotation', label: 'Load Rotation', badge: rotProposed ? badge(1) : snap.rotation.order ? <span className="ml-0.5 text-[var(--warn)]">●</span> : null },
    { id: 'programmes', label: 'Programmes (C&I)', badge: badge(pendingOffers, 'info') },
    { id: 'forecast', label: 'Forecast' },
    { id: 'alarms', label: 'Alarms', badge: badge(unacked.length, counts.P1 ? 'p1' : 'p2') },
    { id: 'whatif', label: 'What-if' },
    { id: 'settlement', label: 'Settlement & Audit' },
    { id: 'admin', label: 'Administration' },
  ];

  return (
    <header className="glass absolute inset-x-2 top-2 z-30 rounded-xl">
      {/* row 1: identity + live status */}
      <div className="flex items-center gap-3 border-b border-[var(--line)] px-3 py-1.5">
        <div className="flex shrink-0 items-center gap-2">
          <div className="grid h-7 w-7 place-items-center rounded-md bg-[var(--accent)] text-[11px] font-black text-[var(--accent-fg)]">GNA</div>
          <div className="leading-tight">
            <div className="text-[13px] font-semibold">GNA <span className="font-normal text-[var(--muted)]">(Demand Response)</span></div>
            <div className="text-[10px] text-[var(--muted)]">KPTCL SLDC · ADRMS · simulation &amp; advisory</div>
          </div>
        </div>

        <div className="flex min-w-0 flex-1 items-center gap-4 overflow-hidden pl-2">
          <div className="shrink-0" title={`Block ${clk.block} of 96 (15-min DSM blocks)`}>
            <div className="text-sm font-semibold tabular-nums">{hhmmss(clk.t)}</div>
            <div className="flex items-center gap-1 text-[10px] text-[var(--muted)]">
              Blk {clk.block}/96
              <span className="inline-block h-1 w-10 overflow-hidden rounded bg-[var(--chip)]"><span className="block h-full bg-[var(--fg-dim)]" style={{ width: `${clk.block_progress * 100}%` }} /></span>
            </div>
          </div>
          <Kpi label="Frequency" value={`${g.freq.toFixed(3)} Hz`} cls={freqTone} />
          <Kpi label="ACE" value={`${g.ace > 0 ? '+' : ''}${g.ace.toFixed(0)} MW`} sub={g.direction === 'UP' ? 'short · UP' : 'long · DOWN'} />
          <Kpi label="DSM / block" value={rsShort(g.dsm.amount)} sub={`${g.freq_band} · ₹${g.dsm.marginal_rate}/kWh mgn`} />
          <div className="shrink-0"><Chip tone={sevTone(g.severity)}>{g.severity}</Chip></div>
          <div className="shrink-0" title={[`Ages — frequency ${dur(q.ages.frequency)}, schedule ${dur(q.ages.schedule)}, breakers ${dur(q.ages.breakers)}${q.ages.sldc_fetch != null ? `, SLDC fetch ${dur(q.ages.sldc_fetch)}` : ''}`, ...q.vetoes.map((v: string) => `VETO: ${v}`)].join('\n')}>
            <div className="text-[10px] uppercase tracking-wider text-[var(--muted)]">Data</div>
            <div className={cx('text-xs font-semibold tabular-nums', confTone)}>
              {(q.confidence * 100).toFixed(1)}%{q.worst_age_s > 10 ? ` · ${dur(q.worst_age_s)}` : ''}{q.vetoes.length ? ` · ${q.vetoes.length} veto` : ''}
            </div>
          </div>
          {top && (
            <button onClick={() => setView('alarms')} className="flex min-w-0 items-center gap-1.5 rounded-md px-1 py-0.5 text-left hover:bg-[var(--chip)]" title="Most severe unacknowledged alarm">
              <Chip tone={top.priority === 'P1' ? 'p1' : top.priority === 'P2' ? 'p2' : 'p3'}>{top.priority}</Chip>
              <span className="truncate text-xs">{top.title}</span>
            </button>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <span className="flex items-center gap-1">
            {(['P1', 'P2', 'P3'] as const).map((p) => (
              <button key={p} onClick={() => setView('alarms')} title={`${p} alarms`}>
                <Chip tone={counts[p] ? (p === 'P1' ? 'p1' : p === 'P2' ? 'p2' : 'p3') : 'neutral'} icon={counts[p] > 0}>{p} {counts[p]}</Chip>
              </button>
            ))}
          </span>
          <Popover label={<span>Autonomy <b className={au.effective !== au.configured ? 'text-[var(--warn)]' : ''}>{au.effective}</b>{au.effective !== au.configured && <span className="text-[var(--muted)]"> (set {au.configured})</span>}</span>} width="w-80">
            <div className="mb-1 text-[10px] uppercase tracking-wider text-[var(--muted)]">Autonomy level</div>
            {[['L0', 'Monitor — detect, forecast, alarm'], ['L1', 'Advisory — every command needs approval'], ['L2', 'Supervised — BESS & generation ≤ 250 MW auto'], ['L3', 'Autonomous — all but RTM once twin passes']].map(([l, d]) => (
              <button key={l} onClick={() => act('autonomy', { level: l }, `Autonomy set to ${l}`)}
                className={cx('flex w-full items-start gap-2 rounded px-2 py-1 text-left text-xs hover:bg-[var(--chip)]', au.configured === l && 'bg-[var(--chip)]')}>
                <b className="w-6">{l}</b><span className="text-[var(--muted)]">{d}</span>
              </button>
            ))}
            {au.reasons.length > 0 && <div className="mt-2 space-y-0.5 border-t border-[var(--line)] pt-2 text-[11px] text-[var(--warn)]">{au.reasons.map((r: string) => <div key={r}>▲ {r}</div>)}</div>}
          </Popover>
          <Btn kind={au.suspended ? 'primary' : 'danger'} small onClick={() => act('suspend', { on: !au.suspended }, au.suspended ? 'Kill switch released' : 'Autonomy suspended')}
            title="Kill switch: suspend all automatic execution">{au.suspended ? 'Resume' : '⏻ Suspend'}</Btn>
          <Popover label={<span>Simulate{snap.scenarios.some((s: any) => s.active) && <span className="ml-1 text-[var(--info)]">●</span>}</span>} width="w-[22rem]">
            <SimMenu snap={snap} />
          </Popover>
          <Popover label={<span className="max-w-28 truncate">{user.name}</span>} width="w-56">
            <div className="space-y-1 text-xs">
              <div className="font-semibold">{user.name}</div>
              <div className="text-[var(--muted)]">{user.role.replace(/_/g, ' ')}{user.dual ? ' · dual authority' : ''}</div>
              <div className="text-[var(--muted)]">Link: {link === 'ws' ? 'live (WebSocket)' : link === 'poll' ? 'polling' : 'down'}</div>
              <Btn small onClick={onLogout} className="mt-1 w-full">Sign out</Btn>
            </div>
          </Popover>
        </div>
      </div>
      {/* row 2: navigation */}
      <div className="flex items-center justify-between gap-2 px-2 py-1">
        <Tabs value={view} onChange={setView} items={nav} />
        <div className="flex shrink-0 items-center gap-2 text-[10px] text-[var(--muted)]">
          {ev && <span>Event <b className="text-[var(--fg)]">{ev.id}</b> · {ev.phase}</span>}
          <span className={link === 'ws' ? 'text-[var(--ok)]' : 'text-[var(--warn)]'}>{link === 'ws' ? '● live' : link === 'poll' ? '▲ polling' : '■ offline'}</span>
          <span>×{clk.speed} sim · {snap.source === 'SIM' ? 'simulated field' : 'SLDC website (advisory)'}</span>
        </div>
      </div>
    </header>
  );
}

function Kpi({ label, value, sub, cls }: { label: string; value: string; sub?: string; cls?: string }) {
  return (
    <div className="shrink-0">
      <div className="text-[10px] uppercase tracking-wider text-[var(--muted)]">{label}</div>
      <div className={cx('text-sm font-semibold tabular-nums leading-tight', cls)}>{value}</div>
      {sub && <div className="text-[10px] text-[var(--muted)]">{sub}</div>}
    </div>
  );
}

function SimMenu({ snap }: { snap: any }) {
  const act = useAct();
  const clk = snap.clock;
  return (
    <div className="space-y-2 text-xs">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wider text-[var(--muted)]">Speed ×{clk.speed}</span>
        <div className="flex gap-1">
          {[1, 5, 10, 30, 60].map((s) => <Btn key={s} small kind={clk.speed === s ? 'primary' : 'default'} onClick={() => act('speed', { speed: s })}>{s}×</Btn>)}
          <Btn small onClick={() => act('pause', { paused: clk.running })}>{clk.running ? '❚❚' : '▶'}</Btn>
        </div>
      </div>
      <div className="text-[10px] uppercase tracking-wider text-[var(--muted)]">Scenarios (inject into the simulated field)</div>
      <div className="grid grid-cols-1 gap-0.5">
        {snap.scenarios.map((s: any) => (
          <div key={s.key} className="flex items-center justify-between gap-2 rounded px-1.5 py-0.5 hover:bg-[var(--chip)]">
            <span className="truncate">{s.active && <span className="text-[var(--info)]">● </span>}{s.label}</span>
            {s.active
              ? <Btn small onClick={() => act('scenario_stop', { key: s.key })}>Stop</Btn>
              : <Btn small onClick={() => act('scenario_start', { key: s.key }, `Started: ${s.label}`)}>Run</Btn>}
          </div>
        ))}
      </div>
    </div>
  );
}
