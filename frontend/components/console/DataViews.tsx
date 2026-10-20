'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from 'react';
import { Btn, Chart, Chip, Field, FitList, Panel, Stat, Tabs, cx, inputCls, prioTone, useAct } from '../ui';
import { api, post } from '@/lib/api';
import { dur, hhmm, hourWindow, mw, num, pct, rs, rsShort } from '@/lib/fmt';

/* ----------------------------------------------------------------- Programmes (C&I) */

export function ProgrammesView({ snap }: { snap: any }) {
  const act = useAct();
  const gf = snap.gridflex;
  const [tab, setTab] = useState<'participants' | 'offers' | 'mv' | 'resources' | 'applications'>('participants');
  const pend = gf.offers.filter((o: any) => o.status === 'PENDING').length;
  const apps = gf.applications.filter((a: any) => a.status === 'SUBMITTED').length;
  const pname = (id: string) => gf.participants.find((p: any) => p.id === id)?.name ?? id;
  const [dispute, setDispute] = useState<Record<string, string>>({});
  return (
    <Panel pad={false} className="h-full">
      <div className="flex shrink-0 items-center justify-between border-b border-[var(--line)] px-3 py-2">
        <Tabs value={tab} onChange={setTab} items={[
          { id: 'participants', label: 'C&I participants' },
          { id: 'offers', label: 'Offers', badge: pend ? <Chip tone="info" icon={false}>{pend} pending</Chip> : null },
          { id: 'mv', label: 'Baseline M&V' },
          { id: 'applications', label: 'Enrolment applications', badge: apps ? <Chip tone="info" icon={false}>{apps}</Chip> : null },
          { id: 'resources', label: 'All flexible resources' },
        ]} />
        <span className="text-[11px] text-[var(--muted)]">Industry dispatched only inside an accepted offer, on its terms · baseline {gf.baseline_method}</span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col p-3">
        {tab === 'participants' && (
          <FitList items={gf.participants} rowHeight={46} keyOf={(p: any) => p.id}
            header={<div className="grid grid-cols-[1.8fr_0.8fr_1fr_1fr_1fr_1fr_1.6fr] gap-2 border-b border-[var(--line)] pb-1 text-[10px] uppercase tracking-wider text-[var(--muted)]">
              <span>Participant</span><span>DISCOM</span><span className="text-right">Baseline</span><span className="text-right">Meter</span><span className="text-right">Instructed</span><span className="text-right">Reliability</span><span>Offer now</span></div>}
            render={(p: any) => (
              <div className="grid grid-cols-[1.8fr_0.8fr_1fr_1fr_1fr_1fr_1.6fr] items-center gap-2 border-b border-[var(--line)]/50 text-xs">
                <div className="min-w-0"><div className="truncate font-medium">{p.name}</div><div className="truncate text-[10px] text-[var(--muted)]">{p.processes.map((x: any) => `${x.name} ${x.mw} MW`).join(' · ')}</div></div>
                <span>{p.discom}</span>
                <span className="text-right tabular-nums">{p.baseline.toFixed(0)} MW</span>
                <span className="text-right tabular-nums">{p.meter.toFixed(0)} MW</span>
                <span className="text-right tabular-nums">{p.activated > 0 ? <span className="text-[var(--ok)]">{p.activated.toFixed(0)} MW</span> : '—'}</span>
                <span className="text-right tabular-nums">{p.reliability.toFixed(3)}</span>
                <span className="truncate">{p.offer ? <Chip tone="ok">{p.offer}</Chip> : <Chip tone="p3">{p.status}</Chip>}</span>
              </div>
            )} />
        )}
        {tab === 'offers' && (
          <FitList items={[...gf.offers].sort((a: any, b: any) => (a.status === 'PENDING' ? -1 : 0) - (b.status === 'PENDING' ? -1 : 0))} rowHeight={40} keyOf={(o: any) => o.id}
            header={<div className="grid grid-cols-[7rem_1.6fr_1fr_4rem_6.5rem_4rem_4.5rem_6rem_6rem_9rem] gap-2 border-b border-[var(--line)] pb-1 text-[10px] uppercase tracking-wider text-[var(--muted)]">
              <span>Offer</span><span>Participant</span><span>Programme</span><span className="text-right">MW</span><span>Window</span><span className="text-right">Resp</span><span className="text-right">Max dur</span><span className="text-right">₹/MWh</span><span className="text-right">Avail ₹/MW·h</span><span>Status</span></div>}
            render={(o: any) => (
              <div className="grid grid-cols-[7rem_1.6fr_1fr_4rem_6.5rem_4rem_4.5rem_6rem_6rem_9rem] items-center gap-2 border-b border-[var(--line)]/50 text-xs">
                <span className="truncate text-[var(--muted)]">{o.id}</span>
                <span className="truncate" title={o.restrictions}>{pname(o.participant)}</span>
                <span className="truncate">{gf.programmes.find((p: any) => p.id === o.programme_id)?.name ?? o.programme}</span>
                <span className="text-right tabular-nums">{o.mw}</span>
                <span className="tabular-nums">{hourWindow(o.window)}</span>
                <span className="text-right tabular-nums">{o.response_min}m</span>
                <span className="text-right tabular-nums">{o.max_duration_min}m</span>
                <span className="text-right tabular-nums">{num(o.price_rs_mwh)}</span>
                <span className="text-right tabular-nums">{o.availability_rs_mw_h}</span>
                <span className="flex gap-1">
                  {o.status === 'PENDING' ? (
                    <>
                      <Btn small kind="primary" onClick={() => act('offer_decide', { id: o.id, accept: true }, 'Offer accepted')}>Accept</Btn>
                      <Btn small onClick={() => act('offer_decide', { id: o.id, accept: false }, 'Offer rejected')}>Reject</Btn>
                    </>
                  ) : <Chip tone={o.status === 'ACCEPTED' ? 'ok' : 'neutral'}>{o.status}</Chip>}
                </span>
              </div>
            )} />
        )}
        {tab === 'mv' && (
          <FitList items={gf.records} rowHeight={52} keyOf={(r: any) => r.id} empty="No M&V records yet — they open when an industry is activated"
            render={(r: any) => (
              <div className="grid grid-cols-[1.4fr_2.4fr_1.4fr_14rem] items-center gap-3 border-b border-[var(--line)]/50 text-xs">
                <div className="min-w-0"><div className="truncate font-medium">{pname(r.participant)}</div><div className="text-[10px] text-[var(--muted)]">{r.id} · {r.event} · {r.method}</div></div>
                <div className="truncate font-mono text-[10px] text-[var(--muted)]">{r.blocks.map((b: any) => `B${b.B}/M${b.M}→V${b.V}`).join('  ')}</div>
                <div className="text-[11px]">E {r.totals.E_mwh} of {r.totals.accepted_mwh} MWh · PF {r.totals.PF} · <b>{rs(r.totals.payment_rs)}</b>{r.totals.held && <span className="text-[var(--warn)]"> held</span>}</div>
                <div className="flex items-center gap-1">
                  <Chip tone={r.status === 'DISPUTED' ? 'warn' : r.status === 'RESOLVED' ? 'info' : 'neutral'}>{r.status}</Chip>
                  {r.status !== 'DISPUTED' ? (
                    <Btn small onClick={() => act('mv_dispute', { id: r.id, reason: 'baseline under review' }, 'Disputed — payment held')}>Dispute</Btn>
                  ) : (
                    <>
                      <input className={cx(inputCls, 'w-20')} placeholder="± ₹" value={dispute[r.id] ?? ''} onChange={(e) => setDispute({ ...dispute, [r.id]: e.target.value })} />
                      <Btn small kind="primary" onClick={() => act('mv_resolve', { id: r.id, adjustment_rs: Number(dispute[r.id] || 0), note: 'resolved after meter review' }, 'Resolved with audited adjustment')}>Resolve</Btn>
                    </>
                  )}
                </div>
              </div>
            )} />
        )}
        {tab === 'applications' && (
          <FitList items={gf.applications} rowHeight={44} keyOf={(a: any) => a.id} empty="No applications. Prospective industries apply from the Industry portal."
            render={(a: any) => (
              <div className="grid grid-cols-[1.6fr_0.8fr_1fr_4rem_1.6fr_10rem] items-center gap-2 border-b border-[var(--line)]/50 text-xs">
                <div className="min-w-0"><div className="truncate font-medium">{a.company}</div><div className="truncate text-[10px] text-[var(--muted)]">{a.processes || '—'}</div></div>
                <span>{a.discom}</span><span>{a.sector}</span><span className="text-right tabular-nums">{a.flexible_mw} MW</span>
                <span className="truncate text-[11px] text-[var(--muted)]">{a.programmes.join(', ') || 'any'} · {a.contact}</span>
                <span className="flex gap-1">{a.status === 'SUBMITTED' ? (
                  <>
                    <Btn small kind="primary" onClick={() => act('application_decide', { id: a.id, accept: true }, 'Accepted for onboarding')}>Onboard</Btn>
                    <Btn small onClick={() => act('application_decide', { id: a.id, accept: false })}>Decline</Btn>
                  </>
                ) : <Chip>{a.status.replace(/_/g, ' ')}</Chip>}</span>
              </div>
            )} />
        )}
        {tab === 'resources' && (
          <FitList items={snap.resources} rowHeight={28} keyOf={(r: any) => r.id}
            header={<div className="grid grid-cols-[1.8fr_1fr_3rem_repeat(6,1fr)] gap-2 border-b border-[var(--line)] pb-1 text-[10px] uppercase tracking-wider text-[var(--muted)]">
              <span>Resource</span><span>Type</span><span>Tier</span><span className="text-right">Available</span><span className="text-right">Setpoint</span><span className="text-right">Metered</span><span className="text-right">Reliability</span><span className="text-right">Resp / ramp</span><span>Status</span></div>}
            render={(r: any) => (
              <div className="grid grid-cols-[1.8fr_1fr_3rem_repeat(6,1fr)] items-center gap-2 border-b border-[var(--line)]/50 text-xs">
                <span className="truncate">{r.name}</span><span className="text-[11px] text-[var(--muted)]">{r.type}</span><span>T{r.tier}</span>
                <span className="text-right tabular-nums">{r.available.toFixed(0)}</span>
                <span className="text-right tabular-nums">{r.setpoint.toFixed(0)}</span>
                <span className={cx('text-right tabular-nums', r.delivering > 0.5 && 'text-[var(--ok)]')}>{r.delivering.toFixed(0)}</span>
                <span className="text-right tabular-nums">{r.reliability.toFixed(3)}</span>
                <span className="text-right tabular-nums">{r.response_min}m / {r.ramp}</span>
                <span className="truncate">{r.veto ? <Chip tone="p2" title={r.veto}>veto</Chip> : r.soc != null ? <span className="text-[11px]">SoC {pct(r.soc)}</span> : r.ancillary_mw ? <span className="text-[11px] text-[var(--muted)]">{r.ancillary_mw} MW SRAS locked</span> : null}</span>
              </div>
            )} />
        )}
      </div>
    </Panel>
  );
}

/* ----------------------------------------------------------------- Forecast */

export function ForecastView({ snap }: { snap: any }) {
  const fc = snap.forecast;
  if (!fc?.blocks) return <Panel className="h-full">Forecast warming up…</Panel>;
  const B = fc.blocks;
  const labels = B.map((b: any) => hhmm(b.t));
  return (
    <div className="grid h-full grid-cols-[1fr_1fr_20rem] grid-rows-2 gap-2">
      <Panel title="ACE — P10 / P50 / P90 (8 blocks)" className="col-span-2">
        <div className="min-h-0 flex-1"><Chart height={150} labels={labels}
          series={[{ values: B.map((b: any) => b.ace.p50), color: 'var(--fg)', label: 'P50' }]}
          band={{ lo: B.map((b: any) => b.ace.p10), hi: B.map((b: any) => b.ace.p90), color: 'rgba(147,197,253,0.18)' }}
          refLines={[{ y: 100, label: '+100', color: 'var(--p3)' }, { y: -100, label: '−100', color: 'var(--p3)' }, { y: 0, label: '0', color: 'var(--line)' }]} /></div>
      </Panel>
      <Panel title="Accuracy & anomaly">
        <div className="grid grid-cols-2 gap-3">
          <Stat label="MAPE (1-block)" value={fc.mape == null ? '—' : `${fc.mape}%`} sub={`${fc.samples}/96 samples`} />
          <Stat label="Anomaly z" value={fc.z.toFixed(2)} sub="alarm at |z| ≥ 4" tone={Math.abs(fc.z) >= 4 ? 'p3' : 'neutral'} />
          <Stat label="Level (demand)" value={fc.level_d.toFixed(3)} sub="vs day-ahead" />
          <Stat label="Level (RE)" value={fc.level_re.toFixed(3)} />
        </div>
        <div className="mt-auto text-[11px] text-[var(--muted)]">{fc.model}. σ grows with √lead; P10/P90 = P50 ∓ 1.2816σ. An ML ensemble can replace it behind the same interface.</div>
      </Panel>
      <Panel title="Demand · RE (MW)">
        <div className="min-h-0 flex-1"><Chart height={150} labels={labels}
          series={[{ values: B.map((b: any) => b.demand.p50), color: 'var(--fg)', label: 'Demand' }]}
          band={{ lo: B.map((b: any) => b.demand.p10), hi: B.map((b: any) => b.demand.p90), color: 'rgba(148,163,184,0.18)' }} /></div>
      </Panel>
      <Panel title="Renewables (MW)">
        <div className="min-h-0 flex-1"><Chart height={150} labels={labels}
          series={[{ values: B.map((b: any) => b.re.p50), color: 'var(--info)', label: 'RE' }]}
          band={{ lo: B.map((b: any) => b.re.p10), hi: B.map((b: any) => b.re.p90), color: 'rgba(147,197,253,0.15)' }} /></div>
      </Panel>
      <Panel title="Predicted violations">
        <div className="mb-1 text-[11px] text-[var(--muted)]">Peak line (2 h): <b className="text-[var(--fg)]">{fc.peak_line ? `${fc.peak_line.line} ${pct(fc.peak_line.loading)}` : '—'}</b></div>
        <FitList items={fc.violations} rowHeight={22} empty="None in the 2-hour horizon" render={(v: any) => (
          <div className="flex justify-between text-xs">
            <span>{v.kind === 'LINE' ? <Chip tone={v.value >= 1 ? 'p3' : 'neutral'}>Line {v.line}</Chip> : <Chip>ACE</Chip>} block {v.block} ({hhmm(v.t)})</span>
            <span className="tabular-nums">{v.kind === 'LINE' ? pct(v.value) : `${v.value} MW`}</span>
          </div>
        )} />
      </Panel>
    </div>
  );
}

/* ----------------------------------------------------------------- Alarms */

export function AlarmsView({ snap }: { snap: any }) {
  const act = useAct();
  const a = snap.alarms;
  const [tab, setTab] = useState<'active' | 'incidents' | 'history'>('active');
  const unacked = a.active.filter((x: any) => !x.acked_by).map((x: any) => x.id);
  const t = snap.clock.t;
  return (
    <Panel pad={false} className="h-full">
      <div className="flex shrink-0 items-center justify-between border-b border-[var(--line)] px-3 py-2">
        <Tabs value={tab} onChange={setTab} items={[{ id: 'active', label: `Active (${a.active.length})` }, { id: 'incidents', label: 'Incidents' }, { id: 'history', label: 'History' }]} />
        <div className="flex items-center gap-2 text-[11px] text-[var(--muted)]">
          <span>Oldest unacknowledged: {a.oldest_unacked != null ? dur(t - a.oldest_unacked) : '—'}</span>
          <Btn small disabled={!unacked.length} onClick={() => act('alarm_ack', { ids: unacked }, `${unacked.length} acknowledged`)}>Acknowledge all</Btn>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col p-3">
        {tab === 'active' && (
          <FitList items={a.active} rowHeight={34} keyOf={(x: any) => x.id} empty="No active alarms"
            render={(x: any) => (
              <div className={cx('grid grid-cols-[3rem_1.4fr_1.6fr_5rem_6rem_12rem] items-center gap-2 border-b border-[var(--line)]/50 text-xs', !x.active && 'opacity-60')}>
                <Chip tone={prioTone(x.priority)}>{x.priority}</Chip>
                <span className="truncate font-medium">{x.title}</span>
                <span className="truncate text-[var(--muted)]">{x.detail}</span>
                <span className="tabular-nums text-[var(--muted)]">{hhmm(x.raised_at)}</span>
                <span>{x.active ? 'active' : 'cleared'}{x.shelved_until ? ' · shelved' : ''}</span>
                <span className="flex justify-end gap-1">
                  {x.acked_by ? <span className="text-[11px] text-[var(--muted)]">ack {x.acked_by}</span> : <Btn small onClick={() => act('alarm_ack', { id: x.id })}>Ack</Btn>}
                  {!x.shelved_until && <Btn small kind="ghost" onClick={() => act('alarm_shelve', { id: x.id, minutes: 30, reason: 'known condition' }, 'Shelved 30 min')}>Shelve 30m</Btn>}
                </span>
              </div>
            )} />
        )}
        {tab === 'incidents' && (
          <FitList items={a.incidents} rowHeight={30} keyOf={(x: any) => x.id} empty="No incidents"
            render={(x: any) => (
              <div className="grid grid-cols-[7rem_1fr_6rem_5rem_6rem] items-center gap-2 border-b border-[var(--line)]/50 text-xs">
                <span className="text-[var(--muted)]">{x.id}</span><span className="truncate">{x.title}</span><span>{x.category}</span>
                <span className="tabular-nums">{x.alarms.length} alarms</span><span>{x.closed_at ? `closed ${hhmm(x.closed_at)}` : <Chip tone="p2">open</Chip>}</span>
              </div>
            )} />
        )}
        {tab === 'history' && (
          <FitList items={a.history} rowHeight={26} keyOf={(x: any) => x.id}
            render={(x: any) => (
              <div className="grid grid-cols-[3rem_1.4fr_1.6fr_5rem_5rem] items-center gap-2 border-b border-[var(--line)]/50 text-xs">
                <Chip tone={prioTone(x.priority)}>{x.priority}</Chip><span className="truncate">{x.title}</span><span className="truncate text-[var(--muted)]">{x.detail}</span>
                <span className="tabular-nums">{hhmm(x.raised_at)}</span><span className="tabular-nums text-[var(--muted)]">{x.cleared_at ? hhmm(x.cleared_at) : '—'}</span>
              </div>
            )} />
        )}
        <div className="pt-1 text-[10px] text-[var(--muted)]">ISA-18.2 style: on-delays suppress chatter, 60 s off-delay, alarms stay listed until acknowledged; related alarms correlate into incidents.</div>
      </div>
    </Panel>
  );
}

/* ----------------------------------------------------------------- What-if */

export function WhatIfView() {
  const [f, setF] = useState({ shortage: 900, minutes: 60, participation: 0.7 });
  const [r, setR] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      setR(await post('/api/whatif', f));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => { run(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  return (
    <div className="grid h-full grid-cols-[18rem_1fr_1fr_1fr] gap-2">
      <Panel title="Shortage & rotation scenario">
        <div className="flex flex-col gap-3">
          <Field label={`Shortage ${f.shortage} MW`}><input type="range" min={100} max={2500} step={50} value={f.shortage} onChange={(e) => setF({ ...f, shortage: +e.target.value })} /></Field>
          <Field label={`Duration ${f.minutes} min`}><input type="range" min={15} max={120} step={15} value={f.minutes} onChange={(e) => setF({ ...f, minutes: +e.target.value })} /></Field>
          <Field label="Industrial participation">
            <div className="flex gap-1">{[0.5, 0.7, 0.9].map((p) => <Btn key={p} kind={f.participation === p ? 'primary' : 'default'} onClick={() => setF({ ...f, participation: p })}>{p * 100}%</Btn>)}</div>
          </Field>
          <Btn kind="primary" onClick={run} disabled={busy}>{busy ? 'Solving…' : 'Run on a copy of live state'}</Btn>
          <div className="text-[11px] text-[var(--muted)]">Uses the same priority LP as live dispatch. Interruption cost is illustrative (set per utility study).</div>
        </div>
      </Panel>
      {r && (
        <>
          <Panel title="1 · No action">
            <Stat label="DSM over duration" value={rsShort(r.no_action.dsm_rs)} sub={`${rsShort(r.no_action.per_block_rs)} per block × ${r.inputs.blocks}`} />
            <div className="mt-auto text-[11px] text-[var(--muted)]">Absorb the deviation and pay DSM on the full shortage.</div>
          </Panel>
          <Panel title="2 · Flexibility first">
            <div className="grid grid-cols-2 gap-2">
              <Stat label="Total" value={rsShort(r.flex_first.total_rs)} />
              <Stat label="Persistent residual" value={mw(r.flex_first.persistent_residual_mw)} tone={r.flex_first.persistent_residual_mw > 50 ? 'warn' : 'neutral'} />
              <Stat label="Payments" value={rsShort(r.flex_first.payments_rs)} />
              <Stat label="DSM still owed" value={rsShort(r.flex_first.dsm_owed_rs)} />
            </div>
            <div className="mt-2 min-h-0 flex-1">
              <FitList items={r.flex_first.allocations} rowHeight={20} render={(a: any) => (
                <div className="flex justify-between text-[11px]"><span className="truncate">{a.name}</span><span className="tabular-nums">{a.x1.toFixed(0)} MW</span></div>
              )} />
            </div>
          </Panel>
          <Panel title="3 · Rotation-assisted">
            <div className="grid grid-cols-2 gap-2">
              <Stat label="Total (incl. DSM)" value={rsShort(r.rotation_assisted.total_rs)} />
              <Stat label="Rotated / realised" value={`${num(r.rotation_assisted.rotated_mw)} / ${num(r.rotation_assisted.realised_mw)}`} sub="MW (~92%)" />
              <Stat label="Unserved energy" value={`${r.rotation_assisted.unserved_mwh} MWh`} />
              <Stat label="Interruption impact" value={rsShort(r.rotation_assisted.interruption_cost_rs)} sub={`@ ₹${r.rotation_assisted.interruption_cost_rate}/kWh`} />
            </div>
            <div className="mt-2 text-[11px]">{r.rotation_assisted.groups.length ? `${r.rotation_assisted.groups.length} groups · ${r.rotation_assisted.stations} stations: ${r.rotation_assisted.groups.join(', ')}` : 'No rotation needed'}</div>
          </Panel>
        </>
      )}
    </div>
  );
}

/* ----------------------------------------------------------------- Settlement & audit */

export function SettlementAuditView({ snap }: { snap: any }) {
  const [verify, setVerify] = useState<any>(null);
  const [tab, setTab] = useState<'audit' | 'events'>('events');
  const [audit, setAudit] = useState<any[]>([]);
  useEffect(() => {
    if (tab === 'audit') api<any>('/api/audit?limit=1000').then((r) => setAudit(r.entries)).catch(() => {});
  }, [tab, snap.audit.length]);
  return (
    <Panel pad={false} className="h-full">
      <div className="flex shrink-0 items-center justify-between border-b border-[var(--line)] px-3 py-2">
        <Tabs value={tab} onChange={setTab} items={[{ id: 'events', label: 'Settled events' }, { id: 'audit', label: `Audit chain (${snap.audit.length})` }]} />
        <div className="flex items-center gap-2 text-[11px]">
          <span className="font-mono text-[var(--muted)]">head {snap.audit.head.slice(0, 16)}…</span>
          <Btn small onClick={async () => setVerify(await api('/api/audit/verify'))}>Verify chain</Btn>
          {verify && (verify.ok ? <Chip tone="ok">Intact · {verify.length} entries</Chip> : <Chip tone="alarm">Broken at #{verify.broken_at}</Chip>)}
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col p-3">
        {tab === 'events' && (
          <FitList items={snap.events} rowHeight={30} keyOf={(e: any) => e.id} empty="No settled events yet"
            header={<div className="grid grid-cols-[8rem_5rem_5rem_6rem_7rem_1fr_8rem] gap-2 border-b border-[var(--line)] pb-1 text-[10px] uppercase tracking-wider text-[var(--muted)]">
              <span>Event</span><span>Opened</span><span>Closed</span><span>Direction</span><span className="text-right">Req at open</span><span>Phase</span><span className="text-right">Net savings</span></div>}
            render={(e: any) => (
              <div className="grid grid-cols-[8rem_5rem_5rem_6rem_7rem_1fr_8rem] items-center gap-2 border-b border-[var(--line)]/50 text-xs">
                <span>{e.id}</span><span className="tabular-nums">{hhmm(e.opened_t)}</span><span className="tabular-nums">{hhmm(e.closed_t)}</span><span>{e.direction}</span>
                <span className="text-right tabular-nums">{mw(e.req_at_open)}</span><span>{e.phase}{e.exception ? ` · ${e.exception}` : ''}</span>
                <span className="text-right font-semibold tabular-nums text-[var(--ok)]">{rs(e.net_savings)}</span>
              </div>
            )} />
        )}
        {tab === 'audit' && (
          <FitList items={audit} rowHeight={24} keyOf={(e: any) => String(e.seq)}
            render={(e: any) => (
              <div className="grid grid-cols-[3.5rem_4rem_8.5rem_6rem_1fr_7rem] items-center gap-2 border-b border-[var(--line)]/40 text-[11px]">
                <span className="tabular-nums text-[var(--muted)]">#{e.seq}</span><span className="tabular-nums">{hhmm(e.sim_t)}</span>
                <span className="truncate font-medium">{e.kind}</span><span className="truncate text-[var(--muted)]">{e.actor}</span>
                <span className="truncate" title={e.message}>{e.message}</span><span className="truncate font-mono text-[10px] text-[var(--muted)]" title={e.hash}>{e.hash.slice(0, 12)}</span>
              </div>
            )} />
        )}
        <div className="pt-1 text-[10px] text-[var(--muted)]">hash_n = SHA-256([hash_n−1, seq, ts, kind, actor, ref, message]); changing any entry breaks every hash after it.</div>
      </div>
    </Panel>
  );
}

/* ----------------------------------------------------------------- Administration */

export function AdminView({ snap }: { snap: any }) {
  const act = useAct();
  const cfg = snap.config;
  const [prices, setPrices] = useState(cfg.prices);
  const [band, setBand] = useState<string>(snap.rotation.band_override_mw ?? '');
  const [table, setTable] = useState(() => JSON.stringify(cfg.dsm_table, null, 1));
  const t = cfg.dsm_table;
  return (
    <div className="grid h-full grid-cols-3 gap-2">
      <Panel title="DSM rule table (versioned)">
        <div className="mb-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
          <span className="text-[var(--muted)]">Version</span><span>{t.version}</span>
          <span className="text-[var(--muted)]">Effective</span><span>{t.effective_date}</span>
          <span className="text-[var(--muted)]">Source</span><span className="truncate" title={t.source}>{t.source}</span>
          <span className="text-[var(--muted)]">Amendments</span><span className="truncate" title={t.amendments.join('; ')}>{t.amendments.join('; ')}</span>
        </div>
        {t.illustrative && <div className="mb-2"><Chip tone="p3">Illustrative multipliers — not the notified table</Chip></div>}
        <div className="mb-2 grid grid-cols-[3rem_1fr_1fr_1fr] gap-1 text-[10px]">
          <span className="text-[var(--muted)]">Band</span><span className="text-[var(--muted)]">Edge</span><span className="text-[var(--muted)]">Over L/N/H</span><span className="text-[var(--muted)]">Under L/N/H</span>
          {t.bands.map((b: any, i: number) => (
            <div key={i} className="contents"><span>{i + 1}</span><span>{b.pct != null ? `min(${b.pct}%, ${b.cap_mw} MW)` : 'beyond'}</span>
              <span>{b.over.LOW}/{b.over.NORMAL}/{b.over.HIGH}</span><span>{b.under.LOW}/{b.under.NORMAL}/{b.under.HIGH}</span></div>
          ))}
        </div>
        <textarea className={cx(inputCls, 'min-h-0 flex-1 resize-none font-mono text-[10px]')} value={table} onChange={(e) => setTable(e.target.value)} aria-label="DSM table JSON" />
        <Btn className="mt-2" kind="primary" onClick={() => {
          try { act('dsm_table', { table: JSON.parse(table) }, 'DSM table loaded'); } catch { act('dsm_table', { table: {} }); }
        }}>Load table (engineer)</Btn>
      </Panel>
      <Panel title="Market & control-area configuration">
        <div className="grid grid-cols-3 gap-2">
          {(['dam', 'rtm', 'ancillary'] as const).map((k) => (
            <Field key={k} label={`${k.toUpperCase()} ₹/kWh`}><input className={inputCls} value={prices[k]} onChange={(e) => setPrices({ ...prices, [k]: e.target.value })} /></Field>
          ))}
        </div>
        <Btn className="mt-2 self-start" onClick={() => act('prices', { dam: +prices.dam, rtm: +prices.rtm, ancillary: +prices.ancillary }, 'Prices updated')}>Save prices</Btn>
        <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
          <span className="text-[var(--muted)]">NR</span><span>₹{snap.grid.nr.NR} ({snap.grid.nr.binding})</span>
          <span className="text-[var(--muted)]">Frequency bias Bf</span><span>{cfg.bias} MW/0.1 Hz <Chip tone="p3">pending SLDC declaration</Chip></span>
          <span className="text-[var(--muted)]">Band edges now</span><span>{cfg.band_edges.map((e: number) => `${e.toFixed(0)} MW`).join(' · ')}</span>
        </div>
        <div className="mt-3 flex items-end gap-2">
          <Field label="Rotation band override (MW, blank = DSM band 1)"><input className={inputCls} value={band} onChange={(e) => setBand(e.target.value)} /></Field>
          <Btn onClick={() => act('rotation_band', { mw: band === '' ? null : +band }, 'Band override saved')}>Apply</Btn>
        </div>
        <div className="mt-3">
          <div className="mb-1 text-[11px] text-[var(--muted)]">Telemetry source</div>
          <div className="flex gap-1">
            <Btn kind={snap.source === 'SIM' ? 'primary' : 'default'} onClick={() => act('source', { mode: 'SIM' })}>Simulated SCADA</Btn>
            <Btn kind={snap.source === 'SLDC_WEB' ? 'primary' : 'default'} onClick={() => act('source', { mode: 'SLDC_WEB' })}>SLDC website (hybrid, 300 s)</Btn>
          </div>
          <div className="mt-1 text-[10px] text-[var(--muted)]">The website source is a hard veto: the platform stays advisory until authorised SCADA/EMS telemetry is connected.</div>
        </div>
      </Panel>
      <Panel title="Policy (application, not grid code)">
        <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
          {Object.entries(cfg.policy).map(([k, v]) => (<div key={k} className="contents"><span className="text-[var(--muted)]">{k.replace(/_/g, ' ')}</span><span className="tabular-nums">{String(v)}</span></div>))}
        </div>
        <div className="mt-3 text-[10px] uppercase tracking-wider text-[var(--muted)]">Data quality now</div>
        <div className="mt-1 flex flex-wrap gap-1">{Object.entries(snap.quality.flags).map(([k, v]) => <Chip key={k} tone={k === 'GOOD' ? 'neutral' : 'p3'} icon={k !== 'GOOD'}>{k} {String(v)}</Chip>)}</div>
        <div className="mt-2 space-y-0.5 text-[11px]">{snap.quality.vetoes.map((v: string) => <div key={v} className="text-[var(--warn)]">▲ {v}</div>)}</div>
        <div className="mt-auto rounded-lg border border-[var(--line)] p-2 text-[11px] text-[var(--muted)]">
          <b className="text-[var(--fg)]">Simulation &amp; advisory prototype.</b> Before operational use: authenticated SCADA/EMS telemetry, the notified DSM table, a validated network model with AC studies, the DISCOM&apos;s approved feeder roster, and shadow-mode replay.
        </div>
      </Panel>
    </div>
  );
}
