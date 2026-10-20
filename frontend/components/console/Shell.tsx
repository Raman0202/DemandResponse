'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
import { BandGauge, Brand, Btn, Chip, Icon, Popover, SegBar, Spark, cx, prioTone, sevTone, useAct } from '../ui';
import { dur, hhmm, hhmmss, mw, rsShort } from '@/lib/fmt';
import type { Claims } from '@/lib/api';

export type View = 'simulator' | 'situation' | 'events' | 'network' | 'rotation' | 'programmes' | 'forecast' | 'alarms' | 'whatif' | 'settlement' | 'admin';

export const NAV: { id: View; label: string; icon: string; key: string }[] = [
  { id: 'simulator', label: '3D Simulator', icon: 'sim', key: '1' },
  { id: 'situation', label: 'Situation', icon: 'overview', key: '2' },
  { id: 'events', label: 'DR Events', icon: 'event', key: '3' },
  { id: 'network', label: 'Network', icon: 'grid', key: '4' },
  { id: 'rotation', label: 'Rotation', icon: 'rotate', key: '5' },
  { id: 'programmes', label: 'Programmes', icon: 'factory', key: '6' },
  { id: 'forecast', label: 'Forecast', icon: 'forecast', key: '7' },
  { id: 'alarms', label: 'Alarms', icon: 'bell', key: '8' },
  { id: 'whatif', label: 'What-if', icon: 'flask', key: '9' },
  { id: 'settlement', label: 'Settlement', icon: 'receipt', key: '0' },
  { id: 'admin', label: 'Admin', icon: 'settings', key: '-' },
];

/* ================================================================= command bar: identity · navigation · controls */

export function CommandBar({ snap, view, setView, user, onLogout }: {
  snap: any; view: View; setView: (v: View) => void; user: Claims; onLogout: () => void;
}) {
  const act = useAct();
  const ev = snap.event, au = snap.autonomy;
  const unacked = snap.alarms.active.filter((a: any) => !a.acked_by && !a.shelved_until);
  const awaiting = !!ev?.rounds?.find((r: any) => r.state === 'PENDING');
  const rotProposed = snap.rotation.order?.state === 'PROPOSED';
  const pending = snap.gridflex.offers.filter((o: any) => o.status === 'PENDING').length + snap.gridflex.applications.filter((a: any) => a.status === 'SUBMITTED').length;
  const badge: Partial<Record<View, React.ReactNode>> = {
    events: awaiting ? <Dot tone="warn" n="!" /> : ev ? <Dot tone="ok" /> : null,
    rotation: rotProposed ? <Dot tone="warn" n="!" /> : snap.rotation.order ? <Dot tone="warn" /> : null,
    programmes: pending ? <Dot tone="info" n={pending} /> : null,
    alarms: unacked.length ? <Dot tone={snap.alarms.counts.P1 ? 'alarm' : 'warn'} n={unacked.length} /> : null,
  };
  const degraded = au.effective !== au.configured;

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-[var(--line)] bg-white px-3">
      <div className="flex shrink-0 items-center gap-2 pr-2">
        <Brand size="sm" tag="Demand Response" />
        <span className="hidden text-[10px] leading-tight text-[var(--muted)] 2xl:block">KPTCL SLDC<br />ADRMS</span>
      </div>

      <nav className="flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden" aria-label="Primary">
        {NAV.map((n) => (
          <button key={n.id} onClick={() => setView(n.id)} title={`${n.label}  (Alt+${n.key})`} aria-current={view === n.id ? 'page' : undefined}
            className={cx('relative flex h-8 items-center gap-1.5 rounded-md px-1.5 text-[12px] font-medium transition 2xl:px-2',
              view === n.id ? 'bg-[var(--accent-soft)] font-semibold text-[var(--accent-ink)]' : 'text-[var(--fg-dim)] hover:bg-[var(--s2)]')}>
            <Icon name={n.icon} size={14} className={view === n.id ? 'text-[var(--accent-ink)]' : ''} />
            <span className={cx('whitespace-nowrap', view !== n.id && 'hidden min-[1400px]:inline')}>{n.label}</span>
            {badge[n.id]}
            {view === n.id && <span className="absolute inset-x-2 -bottom-[9px] h-0.5 rounded bg-[var(--accent)]" />}
          </button>
        ))}
      </nav>

      <div className="flex shrink-0 items-center gap-1.5">
        <Popover width="w-80" label={<span className="flex items-center gap-1.5"><Icon name="shield" size={13} className={degraded ? 'text-[var(--warn)]' : 'text-[var(--muted)]'} /><b className={degraded ? 'text-[var(--warn)]' : ''}>{au.effective}</b></span>}>
          <div className="label mb-1 px-1">Autonomy level {degraded && <span className="normal-case text-[var(--warn)]">· set {au.configured}, degraded</span>}</div>
          {[['L0', 'Monitor', 'Detect, forecast, alarm — no decisions'], ['L1', 'Advisory', 'Every command needs approval'], ['L2', 'Supervised', 'BESS & generation ≤ 250 MW automatic'], ['L3', 'Autonomous', 'All but RTM once the twin passes']].map(([l, t, d]) => (
            <button key={l} onClick={() => act('autonomy', { level: l }, `Autonomy set to ${l}`)}
              className={cx('flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-[var(--chip)]', au.configured === l && 'bg-[var(--accent-soft)]')}>
              <b className="w-5">{l}</b><span><span className="font-medium">{t}</span><br /><span className="text-[var(--muted)]">{d}</span></span>
            </button>
          ))}
          {au.reasons.length > 0 && <div className="mt-2 space-y-0.5 border-t border-[var(--line)] px-1 pt-2 text-[11px] text-[var(--warn)]">{au.reasons.map((r: string) => <div key={r}>▲ {r}</div>)}</div>}
        </Popover>
        <Btn kind={au.suspended ? 'primary' : 'danger'} icon="power" onClick={() => act('suspend', { on: !au.suspended }, au.suspended ? 'Kill switch released' : 'Autonomy suspended')}
          title="Kill switch: suspend all automatic execution"><span className="hidden 2xl:inline">{au.suspended ? 'Resume' : 'Suspend'}</span></Btn>
        <Popover width="w-[23rem]" label={<span className="flex items-center gap-1.5"><Icon name="sim" size={13} className="text-[var(--muted)]" /><span className="hidden 2xl:inline">Simulate</span>{snap.scenarios.some((s: any) => s.active) && <span className="h-1.5 w-1.5 rounded-full bg-[var(--info)]" />}</span>}>
          <SimMenu snap={snap} />
        </Popover>
        <Popover width="w-60" label={<span className="grid h-5 w-5 place-items-center rounded-full bg-[var(--chip-hover)] text-[10px] font-bold uppercase">{user.sub.slice(0, 2)}</span>}>
          <div className="space-y-1 p-1 text-xs">
            <div className="font-semibold">{user.name}</div>
            <div className="text-[var(--muted)]">{user.role.replace(/_/g, ' ')}{user.dual ? ' · dual authority' : ''}</div>
            <div className="pt-1 text-[10px] text-[var(--muted)]">Shortcuts: Alt+1…0 switch views · Esc closes</div>
            <Btn small icon="logout" onClick={onLogout} className="mt-1 w-full">Sign out</Btn>
          </div>
        </Popover>
      </div>
    </header>
  );
}

function Dot({ tone, n }: { tone: 'ok' | 'warn' | 'alarm' | 'info'; n?: number | string }) {
  const bg = { ok: 'bg-[var(--ok)]', warn: 'bg-[var(--warn)]', alarm: 'bg-[var(--alarm)]', info: 'bg-[var(--info)]' }[tone];
  if (n == null) return <span className={cx('h-1.5 w-1.5 rounded-full', bg)} />;
  return <span className={cx('num min-w-4 rounded px-1 text-center text-[9px] font-bold leading-4 text-white', bg)}>{n}</span>;
}

function SimMenu({ snap }: { snap: any }) {
  const act = useAct();
  const clk = snap.clock;
  const groups: [string, string][] = [['physics', 'Grid disturbances'], ['telemetry', 'Telemetry faults'], ['comms', 'Communications']];
  return (
    <div className="space-y-2 text-xs">
      <div className="flex items-center justify-between px-1">
        <span className="label">Sim speed</span>
        <div className="flex gap-1">
          {[1, 10, 30, 60].map((s) => <Btn key={s} small kind={clk.speed === s ? 'primary' : 'default'} onClick={() => act('speed', { speed: s })}>{s}×</Btn>)}
          <Btn small icon={clk.running ? 'pause' : 'play'} onClick={() => act('pause', { paused: clk.running })} title={clk.running ? 'Pause' : 'Run'} />
        </div>
      </div>
      {groups.map(([k, title]) => (
        <div key={k}>
          <div className="label px-1 pb-0.5">{title}</div>
          {snap.scenarios.filter((s: any) => s.kind === k).map((s: any) => (
            <div key={s.key} className="flex items-center justify-between gap-2 rounded-md px-1.5 py-0.5 hover:bg-[var(--chip)]">
              <span className="truncate">{s.active && <span className="text-[var(--info)]">● </span>}{s.label}{s.active && s.until != null && <span className="text-[var(--muted)]"> · to {hhmm(s.until)}</span>}</span>
              {s.active ? <Btn small onClick={() => act('scenario_stop', { key: s.key })}>Stop</Btn>
                : <Btn small icon="play" onClick={() => act('scenario_start', { key: s.key }, `Started: ${s.label}`)}>Run</Btn>}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/* ================================================================= situation strip: persistent Level-1 overview */

function Tile({ children, onClick, title, className, tone }: { children: React.ReactNode; onClick?: () => void; title?: string; className?: string; tone?: 'warn' | 'alarm' }) {
  return (
    <button onClick={onClick} title={title}
      className={cx('relative flex min-w-0 flex-col justify-between rounded-xl border bg-white px-3 py-2 text-left shadow-[0_1px_2px_rgba(16,24,40,0.04)] transition hover:border-[var(--accent-line)]',
        tone === 'alarm' ? 'border-[var(--alarm)]/60' : tone === 'warn' ? 'border-[var(--warn)]/50' : 'border-[var(--line)]', className)}>
      {children}
    </button>
  );
}

export function SituationStrip({ snap, go }: { snap: any; go: (v: View) => void }) {
  const g = snap.grid, q = snap.quality, ev = snap.event, clk = snap.clock, h = snap.history as any[];
  const need = ev ? ev.requirement : g.requirement;
  const delivering = h.length ? h[h.length - 1].delivering : 0;
  const rotated = snap.rotation.measured_mw;
  const fAbn = g.freq < 49.9 || g.freq > 50.05;
  const fCrit = g.freq < 49.8;
  const pending = ev?.rounds?.find((r: any) => r.state === 'PENDING');
  const rot = snap.rotation.order;
  const c = snap.alarms.counts;
  const confBad = q.confidence < 0.85 || q.vetoes.length > 0;
  return (
    <div className="grid h-[88px] shrink-0 grid-cols-[0.8fr_1.15fr_1.15fr_1.35fr_1fr_1.35fr_1fr] gap-2 px-3 pb-3 pt-2.5">
      <Tile onClick={() => go('admin')} title="Sim clock and DSM block">
        <div className="label flex items-center gap-1"><Icon name="clock" size={11} />Block {clk.block}/96</div>
        <div className="num text-lg font-semibold leading-none">{hhmmss(clk.t)}</div>
        <div className="flex items-center gap-1.5 text-[10px] text-[var(--muted)]">
          <span className="h-1 flex-1 overflow-hidden rounded bg-[var(--chip)]"><span className="block h-full bg-[var(--fg-dim)]" style={{ width: `${clk.block_progress * 100}%` }} /></span>
          ×{clk.speed}{!clk.running && ' ❚❚'}
        </div>
      </Tile>

      <Tile onClick={() => go('network')} tone={fCrit ? 'alarm' : fAbn ? 'warn' : undefined} title="Frequency vs IEGC band 49.90–50.05 Hz; 49.80 Hz emergency policy">
        <div className="flex items-baseline justify-between">
          <span className="label">Frequency</span>
          <span className={cx('num text-lg font-semibold leading-none', fCrit ? 'text-[var(--alarm)]' : fAbn && 'text-[var(--warn)]')}>{g.freq.toFixed(3)}<span className="ml-0.5 text-[11px] font-normal text-[var(--muted)]">Hz</span></span>
        </div>
        <BandGauge value={g.freq} min={49.7} max={50.2} lo={49.9} hi={50.05} critLo={49.8} fmt={(v) => `${v.toFixed(3)} Hz`} ticks={[49.8, 49.9, 50, 50.05]} />
        <div className="flex justify-between text-[9px] text-[var(--muted)]"><span>49.7</span><span>band 49.90–50.05</span><span>50.2</span></div>
      </Tile>

      <Tile onClick={() => go('situation')} tone={g.severity === 'EMERGENCY' ? 'alarm' : g.severity === 'ALERT' ? 'warn' : undefined} title="Area Control Error (IEGC)">
        <div className="flex items-baseline justify-between">
          <span className="label">ACE · {g.direction === 'UP' ? 'short' : 'long'}</span>
          <Chip tone={sevTone(g.severity)}>{g.severity}</Chip>
        </div>
        <div className="flex items-end gap-2">
          <span className="num text-lg font-semibold leading-none">{g.ace > 0 ? '+' : ''}{g.ace.toFixed(0)}<span className="ml-0.5 text-[11px] font-normal text-[var(--muted)]">MW</span></span>
          <Spark values={h.slice(-120).map((x) => x.ace)} height={22} zero className="flex-1" />
        </div>
      </Tile>

      <Tile onClick={() => go(ev ? 'events' : 'situation')} title="Requirement and how it is being covered">
        <div className="flex items-baseline justify-between">
          <span className="label">{ev ? 'Event requirement' : 'Requirement'}</span>
          <span className="num text-lg font-semibold leading-none">{need.toFixed(0)}<span className="ml-0.5 text-[11px] font-normal text-[var(--muted)]">MW</span></span>
        </div>
        <SegBar total={Math.max(need, 1)} parts={[{ v: delivering, color: 'var(--ok)', label: 'delivering' }, { v: rotated, color: 'var(--warn)', label: 'rotated out' }]} />
        <div className="num flex justify-between text-[10px] text-[var(--muted)]"><span><span className="text-[var(--ok)]">■</span> {delivering.toFixed(0)} flex</span><span><span className="text-[var(--warn)]">■</span> {rotated.toFixed(0)} rot</span><span>gap {Math.max(0, need - delivering - rotated).toFixed(0)}</span></div>
      </Tile>

      <Tile onClick={() => go('settlement')} title="Deviation Settlement Mechanism exposure this block">
        <div className="label">DSM / block</div>
        <div className="num text-lg font-semibold leading-none">{rsShort(g.dsm.amount)}</div>
        <div className="num text-[10px] text-[var(--muted)]">{g.dsm.freq_band} · mgn ₹{g.dsm.marginal_rate}/kWh</div>
      </Tile>

      <Tile onClick={() => go(rot && !ev ? 'rotation' : 'events')} tone={pending || rot?.state === 'PROPOSED' ? 'warn' : undefined} title="DR event and load-rotation status">
        <div className="flex items-center justify-between">
          <span className="label">{ev ? `Event ${ev.id.slice(-6)}` : 'DR event'}</span>
          {ev ? <span className="text-[10px] font-semibold">{ev.phase}</span> : <span className="text-[10px] text-[var(--muted)]">monitoring</span>}
        </div>
        {ev ? (
          <div className="flex gap-0.5">{['DETECTED', 'ASSESSED', 'PROPOSED', 'APPROVED', 'ACTIVATING', 'VERIFYING', 'RECOVERY', 'SETTLED'].map((p, i, arr) => (
            <span key={p} className={cx('h-1 flex-1 rounded', arr.indexOf(ev.phase) > i ? 'bg-[var(--fg-dim)]' : arr.indexOf(ev.phase) === i ? 'bg-[var(--accent)]' : 'bg-[var(--chip)]')} />))}</div>
        ) : <div className="h-1" />}
        <div className="truncate text-[10px]">
          {pending ? <span className="text-[var(--warn)]">▲ {mw(pending.mw)} awaiting {pending.approvers.length}/{pending.needed} approval</span>
            : rot ? <span className="text-[var(--warn)]">▲ Rotation {rot.state.toLowerCase()} · {mw(rot.mw)}</span>
              : <span className="text-[var(--muted)]">{ev ? `${ev.commands.filter((x: any) => x.state === 'EXECUTING').length} resources executing` : `opens at |ACE| ≥ ${snap.config.policy.ace_alert_mw} MW`}</span>}
        </div>
      </Tile>

      <Tile onClick={() => go('alarms')} tone={c.P1 ? 'alarm' : confBad ? 'warn' : undefined} title={[`Data confidence ${(q.confidence * 100).toFixed(1)}%`, ...q.vetoes.map((v: string) => `VETO: ${v}`)].join('\n')}>
        <div className="flex items-center justify-between">
          <span className="label">Data · alarms</span>
          <span className={cx('num text-[11px] font-semibold', q.confidence < 0.8 ? 'text-[var(--alarm)]' : confBad && 'text-[var(--p3)]')}>{(q.confidence * 100).toFixed(1)}%</span>
        </div>
        <div className="flex gap-1">
          {(['P1', 'P2', 'P3'] as const).map((p) => <Chip key={p} tone={c[p] ? prioTone(p) : 'neutral'} glyph={c[p] > 0}>{p} {c[p]}</Chip>)}
        </div>
        <div className="truncate text-[10px] text-[var(--muted)]">{q.vetoes.length ? <span className="text-[var(--warn)]">▲ {q.vetoes.length} veto · advisory</span> : `worst age ${dur(q.worst_age_s)}`}</div>
      </Tile>
    </div>
  );
}

/* ================================================================= alarm strip: dedicated alarm & message area */

export function AlarmStrip({ snap, link, go }: { snap: any; link: string; go: (v: View) => void }) {
  const act = useAct();
  const unacked = snap.alarms.active.filter((a: any) => !a.acked_by && !a.shelved_until);
  const top = unacked.slice(0, 3);
  return (
    <footer className="flex h-8 shrink-0 items-center gap-3 border-t border-[var(--line)] bg-[var(--s1)] px-3 text-[11px]">
      <button onClick={() => go('alarms')} className="flex items-center gap-1.5 text-[var(--muted)] hover:text-[var(--fg)]">
        <Icon name="bell" size={12} className={unacked.length ? 'text-[var(--warn)]' : ''} />{unacked.length} unacknowledged
      </button>
      <div className="flex min-w-0 flex-1 items-center gap-4 overflow-hidden">
        {top.length === 0 && <span className="text-[var(--muted)]">No unacknowledged alarms.</span>}
        {top.map((a: any) => (
          <span key={a.id} className="flex min-w-0 items-center gap-1.5">
            <Chip tone={prioTone(a.priority)} className={a.priority === 'P1' ? 'blink' : ''}>{a.priority}</Chip>
            <span className="num text-[var(--muted)]">{hhmm(a.raised_at)}</span>
            <span className="truncate font-medium">{a.title}</span>
            <span className="truncate text-[var(--muted)]">{a.detail}</span>
          </span>
        ))}
      </div>
      {unacked.length > 0 && <Btn small onClick={() => act('alarm_ack', { ids: unacked.map((a: any) => a.id) }, `${unacked.length} acknowledged`)}>Ack all</Btn>}
      <span className="flex shrink-0 items-center gap-3 text-[var(--muted)]">
        <span className={link === 'ws' ? 'text-[var(--ok)]' : 'text-[var(--warn)]'}>{link === 'ws' ? '● live' : link === 'poll' ? '▲ polling' : '■ offline'}</span>
        <span>{snap.source === 'SIM' ? 'Simulated SCADA' : 'SLDC website · advisory'}</span>
        <span className="hidden 2xl:inline">Simulation &amp; advisory prototype</span>
      </span>
    </footer>
  );
}
