'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from 'react';
import { Btn, Chip, FitList, Meter, Panel, Spark, Stat, cmdTone, cx, inputCls, loadTone, sevTone, useAct } from '../ui';
import { hhmm, mw, num, pct, rsShort } from '@/lib/fmt';

export const PHASES = ['DETECTED', 'ASSESSED', 'PROPOSED', 'APPROVED', 'ACTIVATING', 'VERIFYING', 'RECOVERY', 'SETTLED'];

export function Stepper({ phase, exception, compact }: { phase: string; exception?: string | null; compact?: boolean }) {
  const i = PHASES.indexOf(phase);
  return (
    <div className="flex items-center gap-0.5">
      {PHASES.map((p, k) => (
        <div key={p} className="flex min-w-0 flex-1 flex-col items-center gap-0.5" title={p}>
          <div className={cx('h-1 w-full rounded-full', k < i ? 'bg-[var(--fg-dim)]' : k === i ? 'bg-[var(--accent)]' : 'bg-[var(--chip)]')} />
          {!compact && <span className={cx('truncate text-[8px] tracking-wide', k === i ? 'font-bold text-[var(--fg)]' : 'text-[var(--muted)]')}>{p}</span>}
        </div>
      ))}
      {exception && <Chip tone="alarm" className="ml-1">{exception}</Chip>}
    </div>
  );
}

/* ----------------------------------------------------------------- Overview */

export function OverviewView({ snap, go, onSelect }: { snap: any; go: (v: any) => void; onSelect: (s: any) => void }) {
  const act = useAct();
  const g = snap.grid, ev = snap.event, h = snap.history as any[];
  const need = ev ? ev.requirement : g.requirement;
  const delivering = h.length ? h[h.length - 1].delivering : 0;
  const rotated = snap.rotation.measured_mw;
  const gap = Math.max(0, need - delivering - rotated);
  const pending = ev?.rounds?.find((r: any) => r.state === 'PENDING');
  const fb = snap.forecast?.blocks?.[0];
  return (
    <div className="flex h-full flex-col gap-2">
      <Panel title="Grid need" right={<><Chip tone={sevTone(g.severity)}>{g.severity}</Chip><Chip>{(ev?.direction ?? g.direction) === 'UP' ? 'UP · reduce load / add supply' : 'DOWN · absorb surplus'}</Chip></>}>
        <div className="grid grid-cols-3 gap-3">
          <Stat label={ev ? 'Event requirement' : 'Live requirement'} value={mw(need)} sub={ev ? 'underlying, own actions backed out' : '|ACE|'} />
          <Stat label="ACE" value={`${g.ace.toFixed(0)} MW`} sub={`Δf term ${g.ace_terms.freq_term.toFixed(0)} · Bf ${g.ace_terms.bias}`} />
          <Stat label="DSM this block" value={rsShort(g.dsm.amount)} sub={`NR ₹${g.nr.NR.toFixed(2)} (${g.nr.binding})`} />
        </div>
        <div className="mt-3">
          <div className="flex h-3 w-full overflow-hidden rounded bg-[var(--chip)]" title="Coverage: delivering (green) + rotated out (orange) vs need">
            <div style={{ width: `${need > 0 ? Math.min(100, (delivering / need) * 100) : 0}%` }} className="bg-[var(--ok)]" />
            <div style={{ width: `${need > 0 ? Math.min(100, (rotated / need) * 100) : 0}%` }} className="bg-[var(--warn)]" />
          </div>
          <div className="mt-1 flex justify-between text-[11px] text-[var(--muted)]">
            <span><span className="text-[var(--ok)]">■</span> delivering {mw(delivering)}</span>
            <span><span className="text-[var(--warn)]">■</span> rotated {mw(rotated)}</span>
            <span>gap <b className={gap > 50 ? 'text-[var(--warn)]' : 'text-[var(--fg)]'}>{mw(gap)}</b></span>
          </div>
        </div>
        <div className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
          {g.dsm.bands.map((b: any) => (
            <div key={b.band} className="rounded border border-[var(--line)] px-2 py-1">
              <div className="text-[var(--muted)]">Band {b.band}{b.edge ? ` ≤ ${b.edge} MW` : ' beyond'}</div>
              <div className="tabular-nums">{b.mw} MW × {b.mult} · {rsShort(b.rs)}</div>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title={ev ? `DR event ${ev.id}` : 'DR event'} right={ev && <Btn small onClick={() => go('events')}>Open ›</Btn>} className="min-h-0 flex-1">
        {ev ? (
          <div className="flex min-h-0 flex-1 flex-col gap-2">
            <Stepper phase={ev.phase} exception={ev.exception} />
            {pending && (
              <div className="flex items-center justify-between gap-2 rounded-lg border border-[var(--warn)]/50 bg-[var(--warn-bg)] px-2 py-1.5 text-xs">
                <span><b>{mw(pending.mw)}</b> awaiting approval · {pending.approvers.length}/{pending.needed} approver{pending.needed > 1 ? 's (dual)' : ''}</span>
                <span className="flex gap-1">
                  <Btn small kind="primary" onClick={() => act('event_approve', {}, 'Approval recorded')}>Approve</Btn>
                  <Btn small onClick={() => act('event_reject', { reason: 'operator rejected' }, 'Round rejected')}>Reject</Btn>
                </span>
              </div>
            )}
            <FitList items={ev.plan?.allocations ?? []} rowHeight={26} empty="Plan pending"
              render={(a: any) => {
                const r = snap.resources.find((x: any) => x.id === a.id);
                const c = ev.commands.filter((x: any) => x.resource === a.id).slice(-1)[0];
                return (
                  <button className="grid w-full grid-cols-[1fr_4rem_4.5rem_6rem] items-center gap-2 text-left text-xs hover:bg-[var(--chip)]" onClick={() => onSelect({ kind: 'bus', id: a.bus })}>
                    <span className="truncate"><span className="text-[var(--muted)]">T{a.tier}</span> {a.name}</span>
                    <span className="text-right tabular-nums">{a.x[0].toFixed(0)} MW</span>
                    <span className="text-right tabular-nums text-[var(--ok)]">{r?.delivering > 0.5 ? `${r.delivering.toFixed(0)} MW` : ''}</span>
                    <span className="text-right">{c && <Chip tone={cmdTone(c.state)} icon={false}>{c.state.replace('AWAITING_APPROVAL', 'APPROVAL')}</Chip>}</span>
                  </button>
                );
              }} />
            <div className="text-[11px] text-[var(--muted)]">
              Plan {ev.plan?.status} · total {rsShort(ev.plan?.costs.total_rs)} vs do-nothing {rsShort(ev.plan?.costs.do_nothing_rs)} · twin {ev.twin?.passed ? 'PASS' : 'FAIL'}
            </div>
          </div>
        ) : (
          <div className="flex flex-1 flex-col justify-center gap-1 text-xs text-[var(--muted)]">
            <div>No DR event. Opens when |ACE| ≥ {snap.config.policy.ace_alert_mw} MW for {snap.config.policy.event_open_hold_s} s (immediately in EMERGENCY).</div>
            <div>Now |ACE| = <b className="text-[var(--fg)]">{Math.abs(g.ace).toFixed(0)} MW</b>. Use <b>Simulate</b> in the top bar to inject a disturbance.</div>
            {snap.events[0] && <div>Last event {snap.events[0].id}: net savings {rsShort(snap.events[0].net_savings)}</div>}
          </div>
        )}
      </Panel>

      <Panel title="Trend · last hour (sim)" right={<span className="text-[10px] text-[var(--muted)]">ACE · requirement · frequency</span>}>
        <Spark values={h.map((x) => x.ace)} height={34} stroke="var(--fg)" zero />
        <Spark values={h.map((x) => x.freq)} height={22} stroke="var(--info)" />
        <div className="mt-1 grid grid-cols-3 gap-2 text-[11px]">
          <div><span className="text-[var(--muted)]">Next blk ACE</span> <b className="tabular-nums">{fb ? fb.ace.p50.toFixed(0) : '—'}</b></div>
          <div><span className="text-[var(--muted)]">Demand</span> <b className="tabular-nums">{fb ? num(fb.demand.p50) : '—'}</b></div>
          <div><span className="text-[var(--muted)]">RE</span> <b className="tabular-nums">{fb ? num(fb.re.p50) : '—'}</b></div>
        </div>
      </Panel>
    </div>
  );
}

/* ----------------------------------------------------------------- Grid */

export function GridView({ snap, onSelect }: { snap: any; onSelect: (s: any) => void }) {
  const g = snap.grid;
  const lines = [...g.lines].sort((a: any, b: any) => b.loading - a.loading);
  const busBy = Object.fromEntries(g.buses.map((b: any) => [b.id, b]));
  const short = (id: string) => busBy[id]?.name.split(' (')[0] ?? id;
  return (
    <div className="flex h-full flex-col gap-2">
      <Panel title="Control area">
        <div className="grid grid-cols-4 gap-3">
          <Stat label="Demand" value={num(g.demand)} sub={`Δ/blk ${g.demand_delta_blk > 0 ? '+' : ''}${num(g.demand_delta_blk)} MW`} />
          <Stat label="In-state gen" value={num(g.in_state_gen)} sub={`RE ${num(g.re)} MW`} />
          <Stat label="Drawal" value={num(g.drawal)} sub={`sched ${num(g.schedule)}`} />
          <Stat label="Deviation" value={`${g.deviation > 0 ? '+' : ''}${num(g.deviation)}`} sub={g.deviation > 0 ? 'over-drawal' : 'under-drawal'} />
        </div>
        <div className="mt-2 flex items-center justify-between text-[11px] text-[var(--muted)]">
          <span>Most loaded corridor: <b className={cx(g.worst_line.loading >= 1 ? 'text-[var(--alarm)]' : g.worst_line.loading >= 0.9 ? 'text-[var(--p3)]' : 'text-[var(--fg)]')}>{g.worst_line.id} {pct(g.worst_line.loading)}</b></span>
          <span>Islands {g.islands} · P90 reserve {mw(g.p90_margin)}</span>
        </div>
      </Panel>
      <Panel title="Line loading (DC power flow)" className="min-h-0 flex-1">
        <FitList items={lines} rowHeight={24} keyOf={(l: any) => l.id}
          render={(l: any) => (
            <button className="grid w-full grid-cols-[2.4rem_1fr_6rem_3rem] items-center gap-2 text-left text-xs hover:bg-[var(--chip)]" onClick={() => onSelect({ kind: 'line', id: l.id })}>
              <span className="text-[var(--muted)]">{l.id}</span>
              <span className="truncate">{short(l.from)} – {short(l.to)} {!l.in_service && <Chip tone="p2">OUT</Chip>}</span>
              <Meter value={l.loading} max={1} tone={loadTone(l.loading)} />
              <span className={cx('text-right tabular-nums', l.loading >= 1 ? 'text-[var(--alarm)]' : l.loading >= 0.9 && 'text-[var(--p3)]')}>{pct(l.loading)}</span>
            </button>
          )} />
      </Panel>
      <Panel title="Generation" className="h-[33%] min-h-0">
        <FitList items={g.gens} rowHeight={22} keyOf={(x: any) => x.id}
          render={(x: any) => (
            <button className="grid w-full grid-cols-[1fr_3.5rem_5rem_4.5rem] items-center gap-2 text-left text-xs hover:bg-[var(--chip)]" onClick={() => onSelect({ kind: 'bus', id: x.bus })}>
              <span className="truncate">{x.name}</span>
              <span className="text-[10px] uppercase text-[var(--muted)]">{x.kind}</span>
              <Meter value={x.mw} max={x.capacity} />
              <span className="text-right tabular-nums">{x.mw.toFixed(0)} MW</span>
            </button>
          )} />
      </Panel>
    </div>
  );
}

/* ----------------------------------------------------------------- Load rotation */

export function RotationView({ snap, onSelect }: { snap: any; onSelect: (s: any) => void }) {
  const act = useAct();
  const rot = snap.rotation;
  const o = rot.order;
  const [manual, setManual] = useState('');
  const tr = rot.trigger;
  const groups = [...rot.groups].sort((a: any, b: any) => (b.out ? 1 : 0) - (a.out ? 1 : 0) || a.F - b.F);
  return (
    <div className="flex h-full flex-col gap-2">
      <Panel title="Load rotation — last resort" right={rot.demo_roster && <Chip tone="p3" title="Groups, 30% rotatable share and protected-feeder counts are demonstration data">Demo roster</Chip>}>
        <div className="grid grid-cols-4 gap-3">
          <Stat label="Uncovered OD" value={mw(tr.residual)} sub={`limit ${mw(tr.band)} (band 1)`} tone={tr.cond ? 'warn' : 'neutral'} />
          <Stat label="Planned / metered" value={`${num(rot.planned_mw)} / ${num(rot.measured_mw)}`} sub="MW relief" />
          <Stat label="Energy not served" value={`${rot.ens_mwh.toFixed(1)} MWh`} />
          <Stat label="Fairness" value={`${rot.fairness_spread_min.toFixed(0)} min`} sub={`max ${rot.max_minutes.toFixed(0)}/120`} />
        </div>
        <div className="mt-2 text-[11px] text-[var(--muted)]">
          Trigger: residual ≥ 50 MW and (f &lt; 49.90 Hz or residual &gt; band 1), sustained 120 s — immediately below 49.80 Hz.
          {tr.since != null && tr.cond && <b className="text-[var(--warn)]"> Condition true since {hhmm(tr.since)}.</b>}
          {' '}Independent UFR / df/dt protection is never delayed or overridden.
        </div>
      </Panel>
      <Panel title={o ? `Order ${o.id}` : 'Order'} right={o && <Chip tone={o.state === 'PROPOSED' ? 'warn' : o.state === 'ACTIVE' ? 'p2' : 'info'}>{o.state}</Chip>}>
        {o ? (
          <div className="space-y-1.5 text-xs">
            <div className="flex items-center justify-between gap-2">
              <span><b>{mw(o.mw)}</b> · {o.reason}</span>
              {o.state === 'PROPOSED' && (
                <span className="flex shrink-0 gap-1">
                  <Btn small kind="primary" onClick={() => act('rotation_approve', {}, 'Rotation approval recorded')}>Approve {o.approvals.length}/{o.mw > snap.config.policy.dual_auth_mw ? 2 : 1}</Btn>
                  <Btn small onClick={() => act('rotation_reject', { reason: 'shift-in-charge rejected' })}>Reject</Btn>
                </span>
              )}
            </div>
            {o.escalated && <div className="text-[var(--warn)]">▲ Metered relief below 90% of plan for 2 min — escalated, residual re-estimated from metering.</div>}
            <div className="text-[11px] text-[var(--muted)]">
              {o.log.slice(-3).map((l: any, i: number) => <div key={i} className="truncate">{hhmm(l.t)} {l.action} {l.group} — {l.reason}</div>)}
              {o.state === 'PROPOSED' && o.next_in_line.length > 0 && <div className="truncate">Next in line: {o.next_in_line.map((n: any) => `${n.group} (F ${n.score.toFixed(2)})`).join(', ')}</div>}
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-xs text-[var(--muted)]">
            <span className="flex-1">No order. Proposals never act on their own: shift-in-charge approval, dual above 200 MW.</span>
            <input className={cx(inputCls, 'w-20')} placeholder="MW" value={manual} onChange={(e) => setManual(e.target.value)} />
            <Btn small onClick={() => manual && act('rotation_manual', { mw: Number(manual) }, 'Manual order proposed')}>Propose</Btn>
          </div>
        )}
      </Panel>
      <Panel title="Roster groups" right={<span className="text-[10px] text-[var(--muted)]">F = 0.5·H + 0.3·N + 0.2·D (7 days)</span>} className="min-h-0 flex-1">
        <FitList items={groups} rowHeight={24} keyOf={(x: any) => x.id}
          header={<div className="grid grid-cols-[5.5rem_1fr_3.5rem_4rem_3.2rem] gap-2 pb-1 text-[10px] uppercase text-[var(--muted)]"><span>Group</span><span>Status</span><span className="text-right">MW</span><span className="text-right">Today</span><span className="text-right">F</span></div>}
          render={(x: any) => (
            <button title={`${x.stations.map((s: any) => s.name).join(', ')} · ${x.protected_feeders} protected feeders never rotated`}
              className="grid w-full grid-cols-[5.5rem_1fr_3.5rem_4rem_3.2rem] items-center gap-2 text-left text-xs hover:bg-[var(--chip)]"
              onClick={() => onSelect({ kind: 'bus', id: x.stations[0].bus })}>
              <span className="font-medium">{x.id}</span>
              <span className="truncate">{x.out ? <Chip tone="p2">OUT {x.spell_min.toFixed(0)}/45 min</Chip> : <span className="text-[var(--muted)]">{x.eligible}</span>}</span>
              <span className="text-right tabular-nums">{x.mw.toFixed(0)}</span>
              <span className="text-right tabular-nums">{x.minutes_today.toFixed(0)}/120</span>
              <span className="text-right tabular-nums">{x.F.toFixed(2)}</span>
            </button>
          )} />
        <div className="pt-1 text-[10px] text-[var(--muted)]">Never rotated: {rot.protected_classes.join(', ')}.</div>
      </Panel>
    </div>
  );
}

