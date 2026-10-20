'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from 'react';
import { Btn, Chip, FitList, Meter, Panel, Spark, Tabs, checkTone, cmdTone, cx, useAct } from '../ui';
import { Stepper } from './SpatialViews';
import { hhmm, mw, num, pct, rs, rsShort } from '@/lib/fmt';

type Tab = 'options' | 'plan' | 'safety' | 'dispatch' | 'settlement' | 'coordination';

export default function EventsView({ snap }: { snap: any }) {
  const act = useAct();
  const [tab, setTab] = useState<Tab>('options');
  const [pick, setPick] = useState<string | null>(null);
  const live = snap.event;
  const ev = pick && snap.event_history[pick] ? snap.event_history[pick] : live ?? (snap.events[0] ? snap.event_history[snap.events[0].id] : null);
  const isLive = !!live && ev?.id === live.id;
  const pending = isLive ? ev.rounds.find((r: any) => r.state === 'PENDING') : null;

  return (
    <Panel pad={false} className="h-full">
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-[var(--line)] px-3 py-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold">
            {ev ? <>DR event {ev.id} {isLive ? <Chip tone="info">LIVE</Chip> : <Chip>{ev.state}</Chip>}</> : 'No DR event yet'}
          </div>
          {ev && <div className="text-[11px] text-[var(--muted)]">Opened {hhmm(ev.opened_t)} · direction {ev.direction} · req at open {mw(ev.req_at_open)} · now {mw(ev.requirement)} · {ev.revisions.length} re-solves</div>}
        </div>
        {ev && <div className="min-w-[22rem] flex-1"><Stepper phase={ev.phase} exception={ev.exception} /></div>}
        <div className="flex shrink-0 items-center gap-1.5">
          {snap.events.length > 0 && (
            <select className="rounded-md border border-[var(--line)] bg-[var(--input)] px-1.5 py-1 text-xs" value={pick ?? ''} onChange={(e) => setPick(e.target.value || null)} aria-label="Choose event">
              <option value="">{live ? `Live: ${live.id}` : 'Latest'}</option>
              {snap.events.slice(0, 5).map((e: any) => <option key={e.id} value={e.id}>{e.id} · {hhmm(e.opened_t)} · {rsShort(e.net_savings)}</option>)}
            </select>
          )}
          {pending && (
            <>
              <Chip tone="warn">{mw(pending.mw)} awaiting · {pending.approvers.length}/{pending.needed}</Chip>
              <Btn kind="primary" onClick={() => act('event_approve', {}, 'Approval recorded')}>Approve</Btn>
              <Btn onClick={() => act('event_reject', { reason: 'rejected by shift-in-charge' }, 'Round rejected')}>Reject</Btn>
            </>
          )}
          {isLive && ev.state === 'OPEN' && <Btn kind="ghost" onClick={() => act('event_close', {}, 'Wind-down started')}>Wind down</Btn>}
        </div>
      </div>
      {!ev ? (
        <div className="flex flex-1 items-center justify-center text-sm text-[var(--muted)]">Events open when |ACE| ≥ 100 MW for 60 s. Use Simulate → a scenario to see one.</div>
      ) : (
        <>
          <div className="shrink-0 px-3 pt-2">
            <Tabs value={tab} onChange={setTab} items={[
              { id: 'options', label: 'Options' }, { id: 'plan', label: 'Plan' },
              { id: 'safety', label: 'Safety', badge: ev.twin && !ev.twin.passed ? <span className="text-[var(--alarm)]">■</span> : null },
              { id: 'dispatch', label: 'Dispatch' }, { id: 'settlement', label: 'Settlement' }, { id: 'coordination', label: 'Coordination' },
            ]} />
          </div>
          <div className="flex min-h-0 flex-1 flex-col p-3">
            {tab === 'options' && <Options ev={ev} />}
            {tab === 'plan' && <Plan ev={ev} />}
            {tab === 'safety' && <Safety ev={ev} />}
            {tab === 'dispatch' && <Dispatch ev={ev} />}
            {tab === 'settlement' && <Settlement ev={ev} />}
            {tab === 'coordination' && <Coordination ev={ev} snap={snap} isLive={isLive} />}
          </div>
        </>
      )}
    </Panel>
  );
}

function Options({ ev }: { ev: any }) {
  const opts = ev.options ?? [];
  const chosen = opts[0];
  const cheaper = opts.filter((o: any) => o.gives_up);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      {cheaper.length > 0 && chosen && (
        <div className="rounded-lg border border-[var(--info)]/40 bg-[var(--info-bg)] px-3 py-2 text-xs">
          ● Cheaper on paper: <b>{cheaper[0].label}</b> ({rsShort(cheaper[0].total_rs)} vs {rsShort(chosen.total_rs)}) — but it gives up {cheaper[0].gives_up.join(', ')}.
        </div>
      )}
      <div className="grid grid-cols-[1.6fr_repeat(7,1fr)] gap-2 border-b border-[var(--line)] pb-1 text-[10px] uppercase tracking-wider text-[var(--muted)]">
        <span>Strategy</span><span className="text-right">Total</span><span className="text-right">Paid</span><span className="text-right">DSM owed</span>
        <span className="text-right">Saves</span><span className="text-right">Coverage</span><span className="text-right">Acts in</span><span className="text-right">Worst line</span>
      </div>
      {opts.map((o: any) => (
        <div key={o.key} className={cx('grid grid-cols-[1.6fr_repeat(7,1fr)] items-center gap-2 rounded px-1 py-1.5 text-xs', o.chosen && 'bg-[var(--chip)] ring-1 ring-[var(--accent)]/50')}>
          <span className="flex items-center gap-1.5 font-medium">{o.label}{o.chosen && <Chip tone="info">Chosen</Chip>}{o.na && <Chip>n/a surplus</Chip>}{o.beyond_horizon && <Chip>beyond horizon</Chip>}</span>
          <span className="text-right tabular-nums font-semibold">{rsShort(o.total_rs)}</span>
          <span className="text-right tabular-nums">{rsShort(o.paid_rs)}</span>
          <span className={cx('text-right tabular-nums', o.dsm_owed_rs < 0 && 'text-[var(--ok)]')}>{rsShort(o.dsm_owed_rs)}{o.dsm_owed_rs < 0 ? ' cr' : ''}</span>
          <span className="text-right tabular-nums">{rsShort(o.savings_rs)}</span>
          <span className="flex items-center justify-end gap-1.5"><Meter className="w-12" value={o.coverage} max={1} tone={o.coverage >= 0.99 ? 'ok' : o.coverage > 0.5 ? 'neutral' : 'warn'} /><span className="w-9 text-right tabular-nums">{pct(o.coverage)}</span></span>
          <span className="text-right tabular-nums">{o.time_to_effect_min == null ? '—' : `${o.time_to_effect_min} min`}</span>
          <span className={cx('text-right tabular-nums', o.worst_line.loading >= 1 ? 'text-[var(--alarm)]' : o.worst_line.loading >= 0.9 && 'text-[var(--p3)]')}>{o.worst_line.line} {pct(o.worst_line.loading)}</span>
        </div>
      ))}
      <div className="mt-3 flex min-h-0 flex-1 flex-col rounded-lg border border-[var(--line)] p-3">
        <div className="mb-2 flex items-center justify-between text-[10px] uppercase tracking-wider text-[var(--muted)]">
          <span>Cost composition over the 1-hour horizon</span>
          <span className="flex gap-3 normal-case tracking-normal"><span><i className="mr-1 inline-block h-2 w-3 rounded-sm bg-[var(--fg-dim)]" />paid to resources</span><span><i className="mr-1 inline-block h-2 w-3 rounded-sm bg-[var(--warn)]" />DSM still owed</span></span>
        </div>
        <div className="flex min-h-0 flex-1 flex-col justify-around gap-1">
          {(() => {
            const mx = Math.max(1, ...opts.map((o: any) => Math.max(0, o.paid_rs) + Math.max(0, o.dsm_owed_rs)));
            return opts.map((o: any) => (
              <div key={o.key} className="grid grid-cols-[11rem_1fr_6rem] items-center gap-3 text-xs">
                <span className={cx('truncate', o.chosen && 'font-semibold')}>{o.label}</span>
                <div className="flex h-3 overflow-hidden rounded bg-[var(--chip)]">
                  <div className="bg-[var(--fg-dim)]" style={{ width: `${(Math.max(0, o.paid_rs) / mx) * 100}%` }} />
                  <div className="bg-[var(--warn)]" style={{ width: `${(Math.max(0, o.dsm_owed_rs) / mx) * 100}%` }} />
                </div>
                <span className="text-right tabular-nums">{rsShort(o.total_rs)}</span>
              </div>
            ));
          })()}
        </div>
      </div>
      <div className="text-[11px] text-[var(--muted)]">
        Each strategy is the same network-constrained LP (HiGHS, 4 × 15-min blocks) restricted to a set of resource types. Total = paid + rebound + DSM still owed. Priority mix: BESS → industrial → other flexibility → RTM, cheapest first within a tier.
      </div>
    </div>
  );
}

function Plan({ ev }: { ev: any }) {
  const p = ev.plan;
  if (!p) return null;
  const c = p.costs;
  return (
    <div className="grid min-h-0 flex-1 grid-cols-[1fr_20rem] gap-3">
      <div className="flex min-h-0 flex-col">
        <div className="mb-1 flex items-center gap-3 text-[11px] text-[var(--muted)]">
          <span>{p.status}</span><span>req/blk {p.req.map((x: number) => x.toFixed(0)).join(' · ')}</span>
          <span>supplied {p.supplied.map((x: number) => x.toFixed(0)).join(' · ')}</span><span>rebound {mw(p.rebound_mw)}</span>
        </div>
        <FitList items={p.allocations} rowHeight={34} keyOf={(a: any) => a.id}
          header={<div className="grid grid-cols-[1.7fr_0.5fr_1.6fr_1.6fr_0.8fr_1.4fr] gap-2 border-b border-[var(--line)] pb-1 text-[10px] uppercase tracking-wider text-[var(--muted)]">
            <span>Resource (tier)</span><span className="text-right">R</span><span>Setpoint MW / block</span><span>Expected MW (R·φ·x)</span><span className="text-right">₹/kWh</span><span>Caps</span></div>}
          render={(a: any) => (
            <div className="grid grid-cols-[1.7fr_0.5fr_1.6fr_1.6fr_0.8fr_1.4fr] items-center gap-2 border-b border-[var(--line)]/50 py-1 text-xs">
              <span className="truncate"><span className="text-[var(--muted)]">T{a.tier}</span> {a.name}</span>
              <span className="text-right tabular-nums">{a.reliability.toFixed(2)}</span>
              <span className="tabular-nums">{a.x.map((v: number) => v.toFixed(0)).join(' · ')}</span>
              <span className="tabular-nums" title={`φ ${a.phi.join(' / ')}`}>{a.expected.map((v: number) => v.toFixed(0)).join(' · ')}</span>
              <span className="text-right tabular-nums" title={`pay ${a.pay_rate} + rebound ${a.rebound_rate}`}>{a.effective.toFixed(2)}</span>
              <span className="truncate text-[10px] text-[var(--muted)]">{a.caps.join(', ')}</span>
            </div>
          )} />
      </div>
      <div className="flex min-h-0 flex-col gap-2 overflow-hidden">
        <div className="rounded-lg border border-[var(--line)] p-2 text-xs">
          <div className="mb-1 text-[10px] uppercase tracking-wider text-[var(--muted)]">Costs of this plan (π excluded)</div>
          {[['Resources (DR/BESS/gen)', c.resource_rs], ['RTM purchase', c.rtm_rs], ['Rebound energy', c.rebound_rs], ['DSM still owed', c.residual_dsm]].map(([l, v]) => (
            <div key={l as string} className="flex justify-between"><span>{l}</span><span className="tabular-nums">{rs(v as number)}</span></div>))}
          <div className="mt-1 flex justify-between border-t border-[var(--line)] pt-1 font-semibold"><span>Total</span><span className="tabular-nums">{rs(c.total_rs)}</span></div>
          <div className="flex justify-between text-[var(--muted)]"><span>Do nothing (DSM)</span><span className="tabular-nums">{rs(c.do_nothing_rs)}</span></div>
          <div className="flex justify-between font-semibold text-[var(--ok)]"><span>Savings</span><span className="tabular-nums">{rs(c.savings_rs)}</span></div>
        </div>
        <div className="rounded-lg border border-[var(--line)] p-2 text-xs">
          <div className="mb-1 text-[10px] uppercase tracking-wider text-[var(--muted)]">Binding lines · shadow price</div>
          {p.binding_lines.length ? p.binding_lines.slice(0, 3).map((b: any, i: number) => (
            <div key={i} className="flex justify-between"><span>{b.line} blk {b.block}</span><span className="tabular-nums">₹{num(b.shadow_rs_per_mw)}/MW</span></div>
          )) : <div className="text-[var(--muted)]">No network constraint binding</div>}
        </div>
        <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-[var(--line)] p-2 text-xs">
          <div className="mb-1 text-[10px] uppercase tracking-wider text-[var(--muted)]">Skipped ({p.skipped.length})</div>
          {p.skipped.slice(0, 6).map((s: any) => <div key={s.id} className="truncate" title={s.reason}><b>{s.name}</b> <span className="text-[var(--muted)]">— {s.reason}</span></div>)}
          {p.skipped.length > 6 && <div className="text-[var(--muted)]">+{p.skipped.length - 6} more</div>}
        </div>
      </div>
    </div>
  );
}

function Safety({ ev }: { ev: any }) {
  const tw = ev.twin;
  if (!tw) return null;
  return (
    <div className="grid min-h-0 flex-1 grid-cols-[1fr_18rem] gap-3">
      <div className="flex min-h-0 flex-col gap-1">
        <div className="mb-1 flex items-center gap-2 text-xs">
          <Chip tone={tw.passed ? 'ok' : 'alarm'}>{tw.passed ? 'Twin passed' : 'Twin failed — human must decide'}</Chip>
          <span className="text-[var(--muted)]">after {ev.twin_passes} optimise → twin pass(es)</span>
        </div>
        <FitList items={tw.checks} rowHeight={38} render={(c: any) => (
          <div className="grid grid-cols-[4.5rem_14rem_1fr] items-center gap-2 border-b border-[var(--line)]/50 text-xs">
            <Chip tone={checkTone(c.status)}>{c.status}</Chip>
            <span className="font-medium">{c.name}</span>
            <span className="truncate text-[var(--muted)]" title={c.detail}>{c.detail}{c.fix ? ` · fix: ${c.fix}` : ''}</span>
          </div>
        )} />
      </div>
      <div className="flex flex-col gap-2 text-xs">
        <div className="rounded-lg border border-[var(--line)] p-2">
          <div className="mb-1 text-[10px] uppercase tracking-wider text-[var(--muted)]">Expected delivery, minute by minute (60 min)</div>
          <Spark values={tw.trajectory} height={70} stroke="var(--ok)" fill="rgba(74,222,128,0.12)" zero />
        </div>
        <div className="text-[11px] text-[var(--muted)]">The twin is a pre-dispatch DC screening gate, not utility-grade network validation. A DC flow cannot establish that a real switching or dispatch action is safe.</div>
      </div>
    </div>
  );
}

function Dispatch({ ev }: { ev: any }) {
  const cmds = [...ev.commands].reverse();
  return (
    <FitList items={cmds} rowHeight={30} keyOf={(c: any) => c.id}
      header={<div className="grid grid-cols-[6.5rem_1.6fr_4rem_5rem_7.5rem_1.6fr_7rem_6rem] gap-2 border-b border-[var(--line)] pb-1 text-[10px] uppercase tracking-wider text-[var(--muted)]">
        <span>Command</span><span>Resource</span><span className="text-right">Setpoint</span><span>Kind</span><span>State</span><span>Approval</span><span className="text-right">Ack · first · full (s)</span><span>HMAC</span></div>}
      render={(c: any) => (
        <div className="grid grid-cols-[6.5rem_1.6fr_4rem_5rem_7.5rem_1.6fr_7rem_6rem] items-center gap-2 border-b border-[var(--line)]/50 text-xs">
          <span className="truncate text-[var(--muted)]">{c.id}</span>
          <span className="truncate">{c.name}</span>
          <span className="text-right tabular-nums">{c.setpoint.toFixed(0)}</span>
          <span>{c.kind} {c.direction}</span>
          <span><Chip tone={cmdTone(c.state)}>{c.state.replace('AWAITING_APPROVAL', 'AWAIT APPROVAL')}</Chip></span>
          <span className="truncate text-[11px] text-[var(--muted)]" title={c.fail_reason || c.approval_reason || ''}>{c.fail_reason || (c.approvals.length ? `by ${c.approvals.join(', ')}` : c.approval_reason || 'automatic (policy)')}</span>
          <span className="text-right tabular-nums">{c.clocks.ack_s ?? '—'} · {c.clocks.first_s ?? '—'} · {c.clocks.full_s ?? '—'}</span>
          <span className="truncate font-mono text-[10px] text-[var(--muted)]" title={c.msg || ''}>{c.tag ? c.tag.slice(0, 10) + '…' : '—'}</span>
        </div>
      )} />
  );
}

function Settlement({ ev }: { ev: any }) {
  const st = ev.settlement;
  const mv = Object.entries(ev.mv ?? {}) as [string, any][];
  const ledger = st?.ledger ?? {
    counterfactual_dsm: ev.counterfactual_dsm, actual_dsm: ev.actual_dsm, dsm_avoided: ev.counterfactual_dsm - ev.actual_dsm,
  };
  return (
    <div className="grid min-h-0 flex-1 grid-cols-[1fr_20rem] gap-3">
      <FitList items={st ? st.lines : mv.map(([id, m]) => ({ id, name: m.name, type: m.type, expected_mwh: m.expected_mwh, delivered_mwh: m.delivered_mwh, rate: m.pay_rate }))}
        rowHeight={28} keyOf={(l: any) => l.id}
        header={<div className="grid grid-cols-[1.6fr_repeat(6,1fr)] gap-2 border-b border-[var(--line)] pb-1 text-[10px] uppercase tracking-wider text-[var(--muted)]">
          <span>Participant</span><span className="text-right">Expected MWh</span><span className="text-right">Delivered</span><span className="text-right">p</span><span className="text-right">PF</span><span className="text-right">Payment</span><span className="text-right">Reliability</span></div>}
        render={(l: any) => {
          const p = l.performance ?? (l.expected_mwh > 0 ? l.delivered_mwh / l.expected_mwh : null);
          return (
            <div className="grid grid-cols-[1.6fr_repeat(6,1fr)] items-center gap-2 border-b border-[var(--line)]/50 text-xs" title={l.source}>
              <span className="truncate">{l.name}</span>
              <span className="text-right tabular-nums">{l.expected_mwh.toFixed(1)}</span>
              <span className="text-right tabular-nums">{l.delivered_mwh.toFixed(1)}</span>
              <span className={cx('text-right tabular-nums', p != null && p < 0.7 && 'text-[var(--warn)]')}>{p == null ? '—' : pct(p)}</span>
              <span className="text-right tabular-nums">{l.PF != null ? l.PF.toFixed(2) : '—'}</span>
              <span className="text-right tabular-nums">{l.payment_rs != null ? rs(l.payment_rs) : 'open'}</span>
              <span className="text-right tabular-nums">{l.reliability_new != null ? `${l.reliability_old.toFixed(3)} → ${l.reliability_new.toFixed(3)}` : '—'}</span>
            </div>
          );
        }} />
      <div className="rounded-lg border border-[var(--line)] p-3 text-xs">
        <div className="mb-2 text-[10px] uppercase tracking-wider text-[var(--muted)]">Counterfactual ledger {st ? '(settled)' : '(running)'}</div>
        {[
          ['DSM with no action', ledger.counterfactual_dsm, ''], ['− DSM on actual deviation', ledger.actual_dsm, ''], ['= DSM avoided', ledger.dsm_avoided, 'font-semibold'],
          ...(st ? [['− participant payments', ledger.participant_payments, ''], ['− RTM purchase', ledger.rtm_purchase, ''], ['− rebound energy', ledger.rebound_energy, ''], ['= net savings', ledger.net_savings, 'font-semibold text-[var(--ok)]']] : []),
        ].map(([l, v, c]) => (
          <div key={l as string} className={cx('flex justify-between py-0.5', c as string)}><span>{l}</span><span className="tabular-nums">{rs(v as number)}</span></div>
        ))}
        <div className="mt-3 text-[11px] text-[var(--muted)]">PF = 1 at ≥ 90% of expected, linear 50–90%, 0 at ≤ 50%. Generation always PF 1. Industrial payments come from GridFlex baseline M&V (settlement of record). Reconciles by assertion.</div>
      </div>
    </div>
  );
}

function Coordination({ ev, snap, isLive }: { ev: any; snap: any; isLive: boolean }) {
  const L = isLive ? snap.ledger : null;
  return (
    <div className="grid min-h-0 flex-1 grid-cols-3 gap-3">
      <div className="rounded-lg border border-[var(--line)] p-3 text-xs">
        <div className="mb-2 text-[10px] uppercase tracking-wider text-[var(--muted)]">Lifecycle</div>
        {ev.phase_log.map((p: any, i: number) => <div key={i} className="flex justify-between py-0.5"><span>{p.phase}</span><span className="tabular-nums text-[var(--muted)]">{hhmm(p.t)}</span></div>)}
        {ev.exception && <div className="mt-1"><Chip tone="alarm">{ev.exception}</Chip></div>}
        <div className="mt-3 text-[10px] uppercase tracking-wider text-[var(--muted)]">Approval rounds</div>
        {ev.rounds.length ? ev.rounds.map((r: any) => (
          <div key={r.n} className="flex justify-between py-0.5"><span>#{r.n} {mw(r.mw)} · needs {r.needed}</span><span>{r.state} {r.approvers.join(', ')}</span></div>
        )) : <div className="text-[var(--muted)]">None (automatic under policy)</div>}
      </div>
      <div className="rounded-lg border border-[var(--line)] p-3 text-xs">
        <div className="mb-2 text-[10px] uppercase tracking-wider text-[var(--muted)]">Shortage ledger (measured)</div>
        {L ? (
          <>
            {[['Shortage', L.shortage, null], ['− industrial (verified)', L.industrial_verified, L.industrial_planned], ['− other flexibility (metered)', L.other_metered, L.other_planned], ['− load rotation (metered)', L.rotation_metered, L.rotation_planned]].map(([l, v, pl]) => (
              <div key={l as string} className="flex justify-between py-0.5"><span>{l}</span><span className="tabular-nums">{num(v as number)} MW{pl != null && <span className="text-[var(--muted)]"> / plan {num(pl as number)}</span>}</span></div>
            ))}
            <div className="mt-1 flex justify-between border-t border-[var(--line)] pt-1 font-semibold"><span>= residual</span><span className={cx('tabular-nums', L.residual > 50 && 'text-[var(--warn)]')}>{num(L.residual)} MW</span></div>
            {L.emergency_override && <div className="mt-2 text-[var(--alarm)]">■ Emergency: control-room procedure and UFR / df/dt protection take precedence over offers and the roster.</div>}
            <div className="mt-2 space-y-0.5">{L.escalations.map((e: string) => <div key={e} className="text-[var(--warn)]">▲ {e}</div>)}</div>
          </>
        ) : <div className="text-[var(--muted)]">Available while an over-drawal event is live.</div>}
      </div>
      <div className="flex min-h-0 flex-col rounded-lg border border-[var(--line)] p-3 text-xs">
        <div className="mb-2 text-[10px] uppercase tracking-wider text-[var(--muted)]">Industrial M&amp;V (baseline vs meter)</div>
        <FitList items={ev.mv_records} rowHeight={44} empty="No industrial participant activated" render={(r: any) => {
          const pname = snap.gridflex.participants.find((p: any) => p.id === r.participant)?.name ?? r.participant;
          const last = r.blocks[r.blocks.length - 1];
          return (
            <div className="border-b border-[var(--line)]/50 py-1">
              <div className="flex justify-between"><span className="truncate font-medium">{pname}</span><Chip tone={r.status === 'DISPUTED' ? 'warn' : 'neutral'}>{r.status}</Chip></div>
              <div className="text-[11px] text-[var(--muted)]">{last ? `B ${last.B} · M ${last.M} · R ${last.R} · A ${last.A} · V ${last.V}` : 'first block open'} · E {r.totals.E_mwh} MWh · PF {r.totals.PF}</div>
            </div>
          );
        }} />
      </div>
    </div>
  );
}

