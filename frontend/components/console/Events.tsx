'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from 'react';
import { Btn, Card, Chart, Chip, Empty, FitList, Icon, KV, Meter, SegBar, Spark, Stat, THead, TRow, checkTone, cmdTone, cx, sevTone, useAct } from '../ui';
import { hhmm, mw, num, pct, rs, rsShort } from '@/lib/fmt';

const PHASES = ['DETECTED', 'ASSESSED', 'PROPOSED', 'APPROVED', 'ACTIVATING', 'VERIFYING', 'RECOVERY', 'SETTLED'];
type Stage = 'assess' | 'options' | 'safety' | 'dispatch' | 'verify' | 'settle';
const STAGES: { id: Stage; label: string; hint: string }[] = [
  { id: 'assess', label: 'Assess', hint: 'ACE, DSM, requirement' },
  { id: 'options', label: 'Options', hint: 'strategies compared' },
  { id: 'safety', label: 'Safety', hint: 'Digital Twin gate' },
  { id: 'dispatch', label: 'Approve & dispatch', hint: 'policy, commands' },
  { id: 'verify', label: 'Verify', hint: 'M&V, shortage ledger' },
  { id: 'settle', label: 'Settle', hint: 'payments, ledger' },
];

function defaultStage(ev: any): Stage {
  if (!ev) return 'assess';
  if (ev.phase === 'SETTLED') return 'settle';
  if (ev.rounds?.some((r: any) => r.state === 'PENDING')) return 'dispatch';
  if (ev.twin && !ev.twin.passed) return 'safety';
  if (['ACTIVATING', 'VERIFYING', 'RECOVERY'].includes(ev.phase)) return 'verify';
  return 'options';
}

export default function EventsView({ snap }: { snap: any }) {
  const act = useAct();
  const [pick, setPick] = useState<string | null>(null);
  const live = snap.event;
  const ev = pick && pick !== live?.id && snap.event_history[pick] ? snap.event_history[pick] : live ?? (snap.events[0] ? snap.event_history[snap.events[0].id] : null);
  const isLive = !!live && ev?.id === live.id;
  const [stage, setStage] = useState<Stage>(() => defaultStage(ev));
  const evId = ev?.id;
  useEffect(() => { setStage(defaultStage(ev)); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [evId]);
  const pending = isLive ? ev.rounds.find((r: any) => r.state === 'PENDING') : null;

  const stageState = (s: Stage): 'done' | 'warn' | 'alarm' | 'idle' => {
    if (!ev) return 'idle';
    const i = PHASES.indexOf(ev.phase);
    if (s === 'assess') return i >= 1 ? 'done' : 'idle';
    if (s === 'options') return ev.options?.length ? 'done' : 'idle';
    if (s === 'safety') return !ev.twin ? 'idle' : ev.twin.passed ? 'done' : 'alarm';
    if (s === 'dispatch') return pending ? 'warn' : i >= 4 ? 'done' : 'idle';
    if (s === 'verify') return ev.lagging?.length ? 'warn' : i >= 5 ? 'done' : 'idle';
    return ev.settlement ? 'done' : 'idle';
  };

  return (
    <div className="grid h-full grid-cols-[250px_1fr] gap-2 p-2">
      {/* event rail */}
      <Card title="Events" icon="event" pad={false}>
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="space-y-1 border-b border-[var(--line)] p-2">
            {live && <EventItem e={{ id: live.id, opened_t: live.opened_t, direction: live.direction, phase: live.phase, req: live.requirement }} live active={ev?.id === live.id} onClick={() => setPick(live.id)} />}
            {snap.events.slice(0, 4).map((e: any) => (
              <EventItem key={e.id} e={{ ...e, req: e.req_at_open }} active={ev?.id === e.id} onClick={() => setPick(e.id)} />
            ))}
            {!live && !snap.events.length && <div className="p-2 text-xs text-[var(--muted)]">No events yet.</div>}
          </div>
          {ev && (
            <div className="min-h-0 flex-1 overflow-hidden p-3">
              <div className="label mb-2">Lifecycle</div>
              <ol className="relative space-y-[7px] border-l border-[var(--line-strong)] pl-3">
                {PHASES.map((p) => {
                  const log = ev.phase_log.find((x: any) => x.phase === p);
                  const cur = ev.phase === p;
                  return (
                    <li key={p} className="relative text-[11px]">
                      <span className={cx('absolute -left-[17px] top-1 h-2 w-2 rounded-full border', cur ? 'border-[var(--accent)] bg-[var(--accent)]' : log ? 'border-[var(--fg-dim)] bg-[var(--fg-dim)]' : 'border-[var(--line-strong)] bg-[var(--s1)]')} />
                      <div className="flex justify-between"><span className={cx(cur ? 'font-semibold' : log ? '' : 'text-[var(--muted)]')}>{p}</span><span className="num text-[var(--muted)]">{log ? hhmm(log.t) : ''}</span></div>
                    </li>
                  );
                })}
              </ol>
              {ev.exception && <div className="mt-2"><Chip tone="alarm">{ev.exception}</Chip></div>}
              <div className="label mb-1 mt-4">Approval rounds</div>
              {ev.rounds.length ? ev.rounds.slice(-4).map((r: any) => (
                <div key={r.n} className="num flex justify-between text-[11px]"><span>#{r.n} · {mw(r.mw)} · ×{r.needed}</span><span className={r.state === 'PENDING' ? 'text-[var(--warn)]' : 'text-[var(--muted)]'}>{r.state.toLowerCase()}</span></div>
              )) : <div className="text-[11px] text-[var(--muted)]">Automatic under policy</div>}
              <div className="label mb-1 mt-4">Re-solves</div>
              <div className="text-[11px] text-[var(--muted)]">{ev.revisions.length} · last: {ev.revisions.at(-1)?.reason ?? '—'}</div>
            </div>
          )}
        </div>
      </Card>

      {/* workflow */}
      <section className="card flex min-h-0 flex-col">
        {!ev ? (
          <Empty icon="event">No DR event yet. Events open when |ACE| ≥ 100 MW for 60 s (immediately in EMERGENCY). Use <b>Simulate</b> in the top bar to inject a disturbance.</Empty>
        ) : (
          <>
            <header className="flex shrink-0 items-center gap-4 border-b border-[var(--line)] px-4 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h1 className="text-[15px] font-semibold">Event {ev.id}</h1>
                  {isLive ? <Chip tone="info">Live</Chip> : <Chip>{ev.state}</Chip>}
                  <Chip>{ev.direction === 'UP' ? 'UP · short' : 'DOWN · long'}</Chip>
                  <Chip tone={sevTone(ev.severity)}>{ev.severity} at open</Chip>
                </div>
                <div className="num mt-0.5 text-[11px] text-[var(--muted)]">Opened {hhmm(ev.opened_t)} · requirement at open {mw(ev.req_at_open)} · now {mw(ev.requirement)} · residual for rotation {mw(ev.residual)}</div>
              </div>
              {pending && (
                <div className="flex items-center gap-2 rounded-lg border border-[var(--warn)]/50 bg-[var(--warn-bg)] py-1 pl-3 pr-1">
                  <span className="text-xs"><b className="num">{mw(pending.mw)}</b> awaiting · {pending.approvers.length}/{pending.needed}{pending.needed > 1 ? ' dual' : ''}</span>
                  <Btn small kind="primary" icon="check" onClick={() => act('event_approve', {}, 'Approval recorded')}>Approve</Btn>
                  <Btn small onClick={() => act('event_reject', { reason: 'rejected by shift-in-charge' }, 'Round rejected')}>Reject</Btn>
                </div>
              )}
              {isLive && ev.state === 'OPEN' && <Btn kind="ghost" onClick={() => act('event_close', {}, 'Wind-down started')}>Wind down</Btn>}
            </header>

            <nav className="grid shrink-0 grid-cols-6 border-b border-[var(--line)]" aria-label="Event workflow">
              {STAGES.map((s, i) => {
                const st = stageState(s.id);
                const on = stage === s.id;
                return (
                  <button key={s.id} onClick={() => setStage(s.id)} aria-current={on ? 'step' : undefined}
                    className={cx('relative flex items-center gap-2.5 px-3 py-2 text-left transition hover:bg-[var(--s2)]', on && 'bg-[var(--s2)]')}>
                    <span className={cx('num grid h-6 w-6 shrink-0 place-items-center rounded-full border text-[11px] font-semibold',
                      st === 'done' ? 'border-[var(--fg-dim)] bg-[var(--fg-dim)] text-[var(--bg)]' : st === 'warn' ? 'border-[var(--warn)] text-[var(--warn)]' : st === 'alarm' ? 'border-[var(--alarm)] text-[var(--alarm)]' : 'border-[var(--line-strong)] text-[var(--muted)]')}>
                      {st === 'done' ? <Icon name="check" size={12} stroke={2.6} /> : st === 'alarm' ? '■' : st === 'warn' ? '▲' : i + 1}
                    </span>
                    <span className="min-w-0"><span className="block truncate text-xs font-semibold">{s.label}</span><span className="block truncate text-[10px] text-[var(--muted)]">{s.hint}</span></span>
                    {on && <span className="absolute inset-x-3 bottom-0 h-0.5 rounded bg-[var(--accent)]" />}
                  </button>
                );
              })}
            </nav>

            <div className="flex min-h-0 flex-1 flex-col p-3">
              {stage === 'assess' && <Assess ev={ev} snap={snap} isLive={isLive} />}
              {stage === 'options' && <Options ev={ev} />}
              {stage === 'safety' && <Safety ev={ev} />}
              {stage === 'dispatch' && <Dispatch ev={ev} snap={snap} isLive={isLive} />}
              {stage === 'verify' && <Verify ev={ev} snap={snap} isLive={isLive} />}
              {stage === 'settle' && <Settle ev={ev} />}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function EventItem({ e, live, active, onClick }: { e: any; live?: boolean; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={cx('w-full rounded-md border px-2 py-1.5 text-left text-xs transition', active ? 'border-[var(--accent)]/60 bg-[var(--accent-soft)]' : 'border-transparent hover:bg-[var(--chip)]')}>
      <div className="flex items-center justify-between"><span className="font-semibold">{e.id}</span>{live ? <Chip tone="info">Live</Chip> : <span className="num text-[10px] text-[var(--muted)]">{hhmm(e.opened_t)}</span>}</div>
      <div className="num flex justify-between text-[10px] text-[var(--muted)]"><span>{e.direction} · {mw(e.req)}</span><span>{e.phase}{e.net_savings != null ? ` · ${rsShort(e.net_savings)}` : ''}</span></div>
    </button>
  );
}

/* ----------------------------------------------------------------- 1 Assess */

function Assess({ ev, snap, isLive }: { ev: any; snap: any; isLive: boolean }) {
  const g = snap.grid;
  const p = ev.plan;
  return (
    <div className="grid min-h-0 flex-1 grid-cols-3 grid-rows-[auto_1fr] gap-3">
      <Card title="Area Control Error" icon="target" sub="IEGC: ACE = (Ia − Is) − 10·Bf·(Fa − Fs) + Offset">
        {isLive ? (
          <KV rows={[
            ['Interchange (Ia − Is)', `${g.ace_terms.interchange.toFixed(0)} MW`],
            ['Frequency term −10·Bf·Δf', `${(-g.ace_terms.freq_term).toFixed(0)} MW`],
            ['Offset', `${g.ace_terms.offset} MW`],
            [<b key="a">ACE</b>, <b key="b">{g.ace.toFixed(0)} MW</b>],
            ['Bf (pending SLDC declaration)', `${g.ace_terms.bias} MW/0.1 Hz`],
            ['Frequency', `${g.freq.toFixed(3)} Hz · ${g.freq_band}`],
          ]} />
        ) : <div className="text-xs text-[var(--muted)]">Live decomposition is shown while the event is open.</div>}
      </Card>
      <Card title="Underlying requirement" icon="event" sub="own actions backed out">
        <Stat size="lg" label="Now" value={mw(ev.requirement)} sub={`at open ${mw(ev.req_at_open)}`} />
        <div className="mt-2 text-[11px] text-[var(--muted)]">= ACE in the event direction + MW our resources deliver + MW rotated out (UP). Rotation is counted in so paid flexibility stays sized to the full over-drawal and rotation is released first.</div>
      </Card>
      <Card title="DSM exposure this block" icon="receipt" sub={isLive ? `NR ₹${g.nr.NR.toFixed(2)} (${g.nr.binding})` : ''}>
        {isLive ? (
          <>
            <div className="mb-2 flex items-baseline justify-between"><span className="num text-xl font-semibold">{rsShort(g.dsm.amount)}</span><span className="num text-[11px] text-[var(--muted)]">marginal ₹{g.dsm.marginal_rate}/kWh</span></div>
            <div className="grid grid-cols-3 gap-1.5">
              {g.dsm.bands.map((b: any) => (
                <div key={b.band} className="rounded-md bg-[var(--chip)] px-2 py-1 text-[10px]">
                  <div className="text-[var(--muted)]">Band {b.band} {b.edge ? `≤ ${b.edge}` : '· beyond'}</div>
                  <div className="num">{b.mw} MW × {b.mult}</div><div className="num font-semibold">{rsShort(b.rs)}</div>
                </div>
              ))}
            </div>
          </>
        ) : <div className="text-xs text-[var(--muted)]">See Settle for the event ledger.</div>}
      </Card>
      <Card title="Requirement vs planned supply by block" icon="forecast" className="col-span-2" sub="MPC re-solve every block · 4 × 15 min">
        {p ? (
          <div className="min-h-0 flex-1">
            <Chart labels={p.req.map((_: number, i: number) => `blk +${i + 1}`)} bars={{ values: p.req, color: 'rgba(139,149,167,0.28)' }}
              series={[{ values: p.supplied, color: 'var(--ok)', label: 'Supplied (expected)' }, { values: p.unserved, color: 'var(--warn)', label: 'Unserved', dash: true }]} />
          </div>
        ) : <Empty>Plan pending</Empty>}
        <div className="flex gap-4 pt-1 text-[10px] text-[var(--muted)]"><span>▮ requirement</span><span className="text-[var(--ok)]">— expected supply</span><span className="text-[var(--warn)]">- - unserved</span></div>
      </Card>
      <Card title="Re-solve log" icon="rotate">
        <FitList items={[...ev.revisions].reverse()} rowHeight={34} render={(r: any) => (
          <div className="border-b border-[var(--line)]/70 py-1 text-[11px]">
            <div className="flex justify-between"><span className="num font-medium">{hhmm(r.t)} · {mw(r.req)}</span><Chip tone={r.twin === 'pass' ? 'ok' : 'alarm'}>twin {r.twin}</Chip></div>
            <div className="truncate text-[var(--muted)]">{r.reason}</div>
          </div>
        )} />
      </Card>
    </div>
  );
}

/* ----------------------------------------------------------------- 2 Options */

function Options({ ev }: { ev: any }) {
  const opts = ev.options ?? [];
  const chosen = opts[0];
  const cheaper = opts.filter((o: any) => o.gives_up);
  const mx = Math.max(1, ...opts.map((o: any) => Math.max(0, o.paid_rs) + Math.max(0, o.dsm_owed_rs)));
  const cols = '1.5fr 0.9fr 0.9fr 0.9fr 0.9fr 1.3fr 0.7fr 0.9fr';
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {cheaper.length > 0 && chosen && (
        <div className="flex items-center gap-2 rounded-lg border border-[var(--info)]/35 bg-[var(--info-bg)] px-3 py-2 text-xs">
          <Icon name="alert" size={13} className="text-[var(--info)]" />
          <span><b>{cheaper[0].label}</b> is cheaper on paper ({rsShort(cheaper[0].total_rs)} vs {rsShort(chosen.total_rs)}) — but gives up {cheaper[0].gives_up.join(', ')}.</span>
        </div>
      )}
      <div className="card shrink-0 p-3">
        <div className="grid gap-0 pb-1 text-[11px] font-semibold" style={{ gridTemplateColumns: cols }}>
          <span />
          <span className="col-span-3 rounded-t-lg bg-[var(--tint-peach)] px-2 pt-1.5 text-center text-[var(--accent-ink)]">Cost (₹)</span>
          <span className="col-span-2 rounded-t-lg bg-[var(--tint-sand)] px-2 pt-1.5 text-center text-[#a16207]">Outcome</span>
          <span className="col-span-2 rounded-t-lg bg-[var(--tint-sky)] px-2 pt-1.5 text-center text-[var(--info)]">Speed &amp; network</span>
        </div>
        <div className="label grid border-b border-[var(--line)]" style={{ gridTemplateColumns: cols }}>
          <span className="py-1 pl-1">Strategy</span>
          <span className="bg-[var(--tint-peach)] py-1 pr-2 text-right">Total</span><span className="bg-[var(--tint-peach)] py-1 pr-2 text-right">Paid</span><span className="bg-[var(--tint-peach)] py-1 pr-2 text-right">DSM owed</span>
          <span className="bg-[var(--tint-sand)] py-1 pr-2 text-right">Saves</span><span className="bg-[var(--tint-sand)] py-1 pr-2 text-right">Coverage</span>
          <span className="bg-[var(--tint-sky)] py-1 pr-2 text-right">Acts in</span><span className="bg-[var(--tint-sky)] py-1 pr-2 text-right">Worst line</span>
        </div>
        {opts.map((o: any) => (
          <div key={o.key} className={cx('grid h-9 items-stretch border-b border-[var(--line)]/70 text-xs last:border-0', o.chosen && 'outline outline-1 -outline-offset-1 outline-[var(--accent)] rounded-md')} style={{ gridTemplateColumns: cols }}>
            <span className="flex items-center gap-1.5 pl-2 font-medium">{o.label}{o.chosen && <Chip tone="accent">Chosen</Chip>}{o.na && <Chip>n/a</Chip>}{o.beyond_horizon && <Chip>beyond horizon</Chip>}</span>
            <span className="num flex items-center justify-end bg-[var(--tint-peach)] pr-2 font-semibold">{rsShort(o.total_rs)}</span>
            <span className="num flex items-center justify-end bg-[var(--tint-peach)] pr-2">{rsShort(o.paid_rs)}</span>
            <span className={cx('num flex items-center justify-end bg-[var(--tint-peach)] pr-2', o.dsm_owed_rs < 0 ? 'text-[var(--ok)]' : 'text-[var(--alarm)]')}>{rsShort(o.dsm_owed_rs)}{o.dsm_owed_rs < 0 ? ' cr' : ''}</span>
            <span className={cx('num flex items-center justify-end bg-[var(--tint-sand)] pr-2', o.savings_rs > 0 && 'text-[var(--ok)]')}>{rsShort(o.savings_rs)}</span>
            <span className="flex items-center justify-end gap-2 bg-[var(--tint-sand)] pr-2"><Meter className="w-14" value={o.coverage} max={1} tone={o.coverage >= 0.99 ? 'ok' : o.coverage > 0.5 ? 'neutral' : 'warn'} /><span className="num w-9 text-right">{pct(o.coverage)}</span></span>
            <span className="num flex items-center justify-end bg-[var(--tint-sky)] pr-2">{o.time_to_effect_min == null ? '—' : `${o.time_to_effect_min}m`}</span>
            <span className={cx('num flex items-center justify-end bg-[var(--tint-sky)] pr-2', o.worst_line.loading >= 1 ? 'text-[var(--alarm)]' : o.worst_line.loading >= 0.9 && 'text-[var(--p3)]')}>{o.worst_line.line} {pct(o.worst_line.loading)}</span>
          </div>
        ))}
      </div>
      <Card title="Cost composition over the 1-hour horizon" icon="receipt" className="min-h-0 flex-1"
        right={<span className="flex gap-3 text-[10px] text-[var(--muted)]"><span><i className="mr-1 inline-block h-2 w-3 rounded-sm bg-[var(--fg-dim)]" />paid</span><span><i className="mr-1 inline-block h-2 w-3 rounded-sm bg-[var(--warn)]" />DSM still owed</span></span>}>
        <div className="flex min-h-0 flex-1 flex-col justify-around">
          {opts.map((o: any) => (
            <div key={o.key} className="grid grid-cols-[11rem_1fr_5.5rem] items-center gap-3 text-xs">
              <span className={cx('truncate', o.chosen && 'font-semibold')}>{o.label}</span>
              <SegBar height={10} total={mx} parts={[{ v: Math.max(0, o.paid_rs), color: 'var(--fg-dim)' }, { v: Math.max(0, o.dsm_owed_rs), color: 'var(--warn)' }]} />
              <span className="num text-right">{rsShort(o.total_rs)}</span>
            </div>
          ))}
        </div>
        <div className="pt-2 text-[10px] text-[var(--muted)]">Each strategy is the same network-constrained LP (HiGHS) restricted to a set of resource types. Priority mix: BESS → industrial → other flexibility → RTM, cheapest first within a tier; reported costs exclude the tier step π.</div>
      </Card>
    </div>
  );
}

/* ----------------------------------------------------------------- 3 Safety */

function Safety({ ev }: { ev: any }) {
  const tw = ev.twin;
  if (!tw) return <Empty>Twin not yet run.</Empty>;
  return (
    <div className="grid min-h-0 flex-1 grid-cols-[1fr_300px] gap-3">
      <Card title="Pre-dispatch checks" icon="shield" right={<><Chip tone={tw.passed ? 'ok' : 'alarm'}>{tw.passed ? 'Passed' : 'Failed — human decision'}</Chip><span className="text-[10px] text-[var(--muted)]">{ev.twin_passes} pass(es)</span></>}>
        <FitList items={tw.checks} rowHeight={42} render={(c: any) => (
          <div className="grid h-full grid-cols-[4.6rem_13rem_1fr] items-center gap-3 border-b border-[var(--line)]/70 text-xs">
            <Chip tone={checkTone(c.status)}>{c.status}</Chip>
            <span className="font-medium">{c.name}</span>
            <span className="min-w-0 text-[11px] text-[var(--muted)]"><span className="line-clamp-2">{c.detail}{c.fix ? ` · fix: ${c.fix}` : ''}</span></span>
          </div>
        )} />
      </Card>
      <div className="flex min-h-0 flex-col gap-3">
        <Card title="Expected delivery · 60 min" icon="forecast" className="h-48 shrink-0">
          <Spark values={tw.trajectory} height={110} stroke="var(--ok)" fill="rgba(79,209,139,0.12)" zero />
        </Card>
        <Card title="Scope" icon="alert" className="flex-1">
          <p className="text-[11px] leading-relaxed text-[var(--muted)]">The twin simulates the plan minute by minute against live state: heartbeat, SoC trajectory, DC line loading, heuristic voltage, response lag, P90 reserve, ancillary lock-out, rebound and coverage. Up to four optimise → twin passes exclude or derate assets. It is a DC screening gate — not utility-grade validation; it cannot certify a switching or dispatch action as safe.</p>
        </Card>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- 4 Approve & dispatch */

function Dispatch({ ev, snap, isLive }: { ev: any; snap: any; isLive: boolean }) {
  const p = ev.plan;
  const cmds = [...ev.commands].reverse();
  const au = snap.autonomy;
  const ac = '1.6fr 0.4fr 1.5fr 1.5fr 0.7fr 1.5fr';
  const cc = '1.5fr 3.5rem 5.2rem 8rem 1.5fr 6.8rem 6rem';
  return (
    <div className="grid min-h-0 flex-1 grid-cols-[1fr_300px] grid-rows-2 gap-3">
      <Card title="Plan · setpoints by block" icon="event" sub={p ? `${p.status} · rebound ${mw(p.rebound_mw)}` : ''}>
        {p ? (
          <FitList items={p.allocations} rowHeight={30} keyOf={(a: any) => a.id}
            header={<THead cols={ac}><span>Resource</span><span className="text-right">R</span><span>Setpoint MW / block</span><span>Expected (R·φ·x)</span><span className="text-right">₹/kWh</span><span>Caps</span></THead>}
            render={(a: any) => (
              <TRow cols={ac}>
                <span className="truncate"><span className="text-[10px] text-[var(--muted)]">T{a.tier}</span> {a.name}</span>
                <span className="num text-right">{a.reliability.toFixed(2)}</span>
                <span className="num">{a.x.map((v: number) => v.toFixed(0)).join(' · ')}</span>
                <span className="num" title={`φ ${a.phi.join(' / ')}`}>{a.expected.map((v: number) => v.toFixed(0)).join(' · ')}</span>
                <span className="num text-right" title={`pay ${a.pay_rate} + rebound ${a.rebound_rate}`}>{a.effective.toFixed(2)}</span>
                <span className="truncate text-[10px] text-[var(--muted)]">{a.caps.join(', ')}</span>
              </TRow>
            )} />
        ) : <Empty>Plan pending</Empty>}
      </Card>
      <Card title="Autonomy & approval" icon="shield" className="row-span-2">
        <div className="space-y-3 text-xs">
          <div className="flex items-center justify-between"><span className="text-[var(--muted)]">Effective level</span><b className={au.effective !== au.configured ? 'text-[var(--warn)]' : ''}>{au.effective}{au.effective !== au.configured && ` (set ${au.configured})`}</b></div>
          {au.reasons.length > 0 && <div className="space-y-0.5 text-[11px] text-[var(--warn)]">{au.reasons.map((r: string) => <div key={r}>▲ {r}</div>)}</div>}
          <div className="rounded-md bg-[var(--chip)] p-2 text-[11px] leading-relaxed text-[var(--muted)]">L2: BESS and generation inside 250 MW execute automatically once the twin passes; the rest await approval. Dual authorisation above {snap.config.policy.dual_auth_mw} MW by two different users. Re-solves growing beyond 1.1 × approved + 20 MW start a new round.</div>
          {ev.rounds.slice(-3).reverse().map((r: any) => (
            <div key={r.n} className={cx('rounded-md border p-2', r.state === 'PENDING' ? 'border-[var(--warn)]/50 bg-[var(--warn-bg)]' : 'border-[var(--line)]')}>
              <div className="flex justify-between"><b>Round {r.n}</b><span>{r.state}</span></div>
              <div className="num text-[11px]">{mw(r.mw)} · needs {r.needed} · {r.approvers.join(', ') || 'no approvals yet'}</div>
            </div>
          ))}
          {p && (
            <div>
              <div className="label mb-1">Skipped ({p.skipped.length})</div>
              {p.skipped.slice(0, 5).map((s: any) => <div key={s.id} className="truncate text-[11px]" title={s.reason}>{s.name} <span className="text-[var(--muted)]">— {s.reason}</span></div>)}
              <div className="label mb-1 mt-2">Binding lines</div>
              {p.binding_lines.length ? p.binding_lines.slice(0, 3).map((b: any, i: number) => <div key={i} className="num flex justify-between text-[11px]"><span>{b.line} · blk {b.block}</span><span>₹{num(b.shadow_rs_per_mw)}/MW</span></div>) : <div className="text-[11px] text-[var(--muted)]">none</div>}
            </div>
          )}
          {!isLive && <div className="text-[11px] text-[var(--muted)]">Historical event — actions disabled.</div>}
        </div>
      </Card>
      <Card title="Commands · HMAC-authenticated" icon="lock" sub="ack · first response · full output, seconds from send">
        <FitList items={cmds} rowHeight={28} keyOf={(c: any) => c.id}
          header={<THead cols={cc}><span>Resource</span><span className="text-right">MW</span><span>Kind</span><span>State</span><span>Approval</span><span className="text-right">Ack·first·full</span><span>Tag</span></THead>}
          render={(c: any) => (
            <TRow cols={cc} title={c.msg || ''}>
              <span className="truncate">{c.name}</span>
              <span className="num text-right">{c.setpoint.toFixed(0)}</span>
              <span className="text-[11px]">{c.kind} {c.direction}</span>
              <span><Chip tone={cmdTone(c.state)}>{c.state === 'AWAITING_APPROVAL' ? 'approval' : c.state}</Chip></span>
              <span className="truncate text-[11px] text-[var(--muted)]">{c.fail_reason || (c.approvals.length ? `by ${c.approvals.join(', ')}` : c.approval_reason || 'automatic')}</span>
              <span className="num text-right">{c.clocks.ack_s ?? '—'}·{c.clocks.first_s ?? '—'}·{c.clocks.full_s ?? '—'}</span>
              <span className="truncate font-mono text-[10px] text-[var(--muted)]">{c.tag ? c.tag.slice(0, 10) : '—'}</span>
            </TRow>
          )} />
      </Card>
    </div>
  );
}

/* ----------------------------------------------------------------- 5 Verify */

function Verify({ ev, snap, isLive }: { ev: any; snap: any; isLive: boolean }) {
  const mv = Object.entries(ev.mv ?? {}) as [string, any][];
  const L = isLive ? snap.ledger : null;
  const pname = (id: string) => snap.gridflex.participants.find((p: any) => p.id === id)?.name ?? id;
  return (
    <div className="grid min-h-0 flex-1 grid-cols-[1.3fr_1fr] grid-rows-2 gap-3">
      <Card title="Delivered vs expected energy" icon="battery" className="row-span-2" sub="platform M&V, metered every tick">
        <FitList items={mv} rowHeight={40} empty="No resource has delivered yet" render={([id, m]: any) => {
          const p = m.expected_mwh > 0 ? m.delivered_mwh / m.expected_mwh : null;
          return (
            <div key={id} className="border-b border-[var(--line)]/70 py-1.5 text-xs">
              <div className="flex justify-between"><span className="truncate font-medium">{m.name}</span><span className="num text-[11px]">{m.delivered_mwh.toFixed(1)} / {m.expected_mwh.toFixed(1)} MWh {p != null && <b className={p < 0.7 ? 'text-[var(--warn)]' : ''}>· {pct(p)}</b>}</span></div>
              <div className="mt-1"><SegBar height={6} total={Math.max(m.expected_mwh, m.delivered_mwh, 0.01)} parts={[{ v: m.delivered_mwh, color: p != null && p < 0.7 ? 'var(--warn)' : 'var(--ok)' }]} /></div>
            </div>
          );
        }} />
        {ev.lagging?.length > 0 && <div className="pt-2 text-[11px] text-[var(--warn)]">{ev.lagging.map((l: any) => <div key={l.resource}>▲ {l.name}: {l.metered} of {l.expected} MW after its response window</div>)}</div>}
      </Card>
      <Card title="Shortage ledger · measured" icon="target">
        {L ? (
          <div className="text-xs">
            {[['Shortage', L.shortage, null], ['− industrial (verified)', L.industrial_verified, L.industrial_planned], ['− other flexibility (metered)', L.other_metered, L.other_planned], ['− load rotation (metered)', L.rotation_metered, L.rotation_planned]].map(([l, v, pl]) => (
              <div key={l as string} className="num flex justify-between py-0.5"><span>{l}</span><span>{num(v as number)} MW{pl != null && <span className="text-[var(--muted)]"> / plan {num(pl as number)}</span>}</span></div>
            ))}
            <div className="num mt-1 flex justify-between border-t border-[var(--line)] pt-1 font-semibold"><span>= residual</span><span className={L.residual > 50 ? 'text-[var(--warn)]' : ''}>{num(L.residual)} MW</span></div>
            {L.emergency_override && <div className="mt-2 text-[11px] text-[var(--alarm)]">■ Emergency: control-room procedure and UFR/df/dt protection take precedence.</div>}
            {L.escalations.map((e: string) => <div key={e} className="mt-1 text-[11px] text-[var(--warn)]">▲ {e}</div>)}
          </div>
        ) : <Empty>Shown while an over-drawal event is live.</Empty>}
      </Card>
      <Card title="Industrial baseline M&V" icon="factory" sub="settlement of record">
        <FitList items={ev.mv_records} rowHeight={42} empty="No industry activated" render={(r: any) => {
          const last = r.blocks[r.blocks.length - 1];
          return (
            <div className="border-b border-[var(--line)]/70 py-1 text-xs">
              <div className="flex justify-between"><span className="truncate font-medium">{pname(r.participant)}</span><Chip tone={r.status === 'DISPUTED' ? 'warn' : 'neutral'}>{r.status}</Chip></div>
              <div className="num truncate text-[11px] text-[var(--muted)]">{last ? `B ${last.B} · M ${last.M} · R ${last.R} · A ${last.A} · V ${last.V}` : 'first block open'} · E {r.totals.E_mwh} MWh · PF {r.totals.PF}</div>
            </div>
          );
        }} />
      </Card>
    </div>
  );
}

/* ----------------------------------------------------------------- 6 Settle */

function Settle({ ev }: { ev: any }) {
  const st = ev.settlement;
  const ledger = st?.ledger ?? { counterfactual_dsm: ev.counterfactual_dsm, actual_dsm: ev.actual_dsm, dsm_avoided: ev.counterfactual_dsm - ev.actual_dsm };
  const cols = '1.6fr repeat(5, 1fr) 1.3fr';
  return (
    <div className="grid min-h-0 flex-1 grid-cols-[1fr_320px] gap-3">
      <Card title={st ? 'Participant settlement' : 'Running M&V (settles at close)'} icon="wallet">
        <FitList items={st ? st.lines : []} rowHeight={30} keyOf={(l: any) => l.id} empty="Settlement is produced when the event closes."
          header={<THead cols={cols}><span>Participant</span><span className="text-right">Expected</span><span className="text-right">Delivered</span><span className="text-right">p</span><span className="text-right">PF</span><span className="text-right">Payment</span><span className="text-right">Reliability</span></THead>}
          render={(l: any) => (
            <TRow cols={cols} title={l.source}>
              <span className="truncate">{l.name}</span>
              <span className="num text-right">{l.expected_mwh.toFixed(1)}</span>
              <span className="num text-right">{l.delivered_mwh.toFixed(1)}</span>
              <span className={cx('num text-right', l.performance < 0.7 && 'text-[var(--warn)]')}>{pct(l.performance)}</span>
              <span className="num text-right">{l.PF.toFixed(2)}</span>
              <span className="num text-right">{rs(l.payment_rs)}</span>
              <span className="num text-right">{l.reliability_old.toFixed(3)} → {l.reliability_new.toFixed(3)}</span>
            </TRow>
          )} />
      </Card>
      <Card title="Counterfactual ledger" icon="receipt" sub={st ? 'settled' : 'running'}>
        <div className="space-y-0.5 text-xs">
          {[
            ['DSM with no action', ledger.counterfactual_dsm, ''], ['− DSM on actual deviation', ledger.actual_dsm, ''], ['= DSM avoided', ledger.dsm_avoided, 'font-semibold border-t border-[var(--line)] pt-1'],
            ...(st ? [['− participant payments', ledger.participant_payments, ''], ['− RTM purchase', ledger.rtm_purchase, ''], ['− rebound energy', ledger.rebound_energy, ''], ['= net savings', ledger.net_savings, 'font-semibold text-[var(--ok)] border-t border-[var(--line)] pt-1']] : []),
          ].map(([l, v, c]) => <div key={l as string} className={cx('num flex justify-between py-0.5', c as string)}><span>{l}</span><span>{rs(v as number)}</span></div>)}
        </div>
        <div className="mt-auto text-[10px] leading-relaxed text-[var(--muted)]">PF = 1 at ≥ 90% of expected, linear 50–90%, 0 at ≤ 50%; generation always PF 1. Industrial payments come from GridFlex baseline M&V. The ledger reconciles by assertion — nothing counted twice. Reliability_new = min(0.995, 0.8·old + 0.2·min(1, p)).</div>
      </Card>
    </div>
  );
}
