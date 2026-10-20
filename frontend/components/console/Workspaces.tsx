'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from 'react';
import { Btn, Card, Chart, Chip, Empty, Field, FitList, Icon, KV, Meter, SegBar, Segmented, Stat, THead, TRow, cx, inputCls, prioTone, useAct } from '../ui';
import { api, post } from '@/lib/api';
import { dur, hhmm, hourWindow, mw, num, pct, rs, rsShort } from '@/lib/fmt';

function KpiRow({ items }: { items: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: any }[] }) {
  return (
    <div className="grid shrink-0 gap-2" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
      {items.map((k) => <div key={k.label} className="card px-3 py-2"><Stat label={k.label} value={k.value} sub={k.sub} tone={k.tone} /></div>)}
    </div>
  );
}

/* ================================================================= Programmes (C&I) */

export function ProgrammesView({ snap }: { snap: any }) {
  const act = useAct();
  const gf = snap.gridflex;
  const [tab, setTab] = useState<'participants' | 'offers' | 'mv' | 'resources'>('participants');
  const [adj, setAdj] = useState<Record<string, string>>({});
  const pname = (id: string) => gf.participants.find((p: any) => p.id === id)?.name ?? id;
  const prog = (id: string) => gf.programmes.find((p: any) => p.id === id)?.name ?? id;
  const pendingOffers = gf.offers.filter((o: any) => o.status === 'PENDING');
  const apps = gf.applications.filter((a: any) => a.status === 'SUBMITTED');
  const acceptedNow = gf.participants.filter((p: any) => p.offer).reduce((a: number, p: any) => a + (gf.offers.find((o: any) => o.id === p.offer)?.mw ?? 0), 0);
  const activated = gf.participants.reduce((a: number, p: any) => a + p.activated, 0);
  const verified = gf.records.reduce((a: number, r: any) => a + r.totals.E_mwh, 0);
  const pc = '1.7fr 0.7fr 0.8fr 0.8fr 0.8fr 0.7fr 1.5fr';
  const oc = '1.5fr 1.2fr 3.4rem 6.5rem 3.6rem 4.4rem 4.6rem 7rem';
  return (
    <div className="flex h-full flex-col gap-2 p-2">
      <KpiRow items={[
        { label: 'Participants', value: gf.participants.length, sub: `${gf.participants.filter((p: any) => p.offer).length} with an offer in force` },
        { label: 'Offered now (accepted)', value: mw(acceptedNow) },
        { label: 'Activated now', value: mw(activated), tone: activated > 0 ? 'ok' : undefined },
        { label: 'Verified energy', value: `${verified.toFixed(1)} MWh`, sub: gf.baseline_method },
        { label: 'Awaiting decision', value: pendingOffers.length + apps.length, sub: `${pendingOffers.length} offers · ${apps.length} applications`, tone: pendingOffers.length + apps.length ? 'info' : undefined },
      ]} />
      <div className="grid min-h-0 flex-1 grid-cols-[1fr_340px] gap-2">
        <Card pad={false} title={<Segmented value={tab} onChange={setTab} items={[
          { id: 'participants', label: 'Participants' }, { id: 'offers', label: 'Offer book' }, { id: 'mv', label: 'Baseline M&V' }, { id: 'resources', label: 'All flexible resources' }]} />}
          right={<span className="text-[10px] text-[var(--muted)]">Industry is dispatched only inside an accepted offer, on its terms</span>}>
          <div className="flex min-h-0 flex-1 flex-col p-3">
            {tab === 'participants' && (
              <FitList items={gf.participants} rowHeight={44} keyOf={(p: any) => p.id}
                header={<THead cols={pc}><span>Participant · flexible processes</span><span>DISCOM</span><span className="text-right">Baseline</span><span className="text-right">Meter</span><span className="text-right">Instructed</span><span className="text-right">Reliab.</span><span>Offer in force</span></THead>}
                render={(p: any) => (
                  <TRow cols={pc}>
                    <span className="min-w-0"><span className="block truncate font-medium">{p.name}</span><span className="block truncate text-[10px] text-[var(--muted)]">{p.processes.map((x: any) => `${x.name} ${x.mw}`).join(' · ')}</span></span>
                    <span>{p.discom}</span>
                    <span className="num text-right">{p.baseline.toFixed(0)}</span>
                    <span className="num text-right">{p.meter.toFixed(0)}</span>
                    <span className="num text-right">{p.activated > 0 ? <span className="text-[var(--ok)]">{p.activated.toFixed(0)}</span> : '—'}</span>
                    <span className="num text-right">{p.reliability.toFixed(3)}</span>
                    <span className="truncate">{p.offer ? <Chip tone="ok">{p.offer}</Chip> : <Chip tone="p3" title={p.status}>{p.status.startsWith('offer awaiting') ? 'awaiting acceptance' : 'no offer this window'}</Chip>}</span>
                  </TRow>
                )} />
            )}
            {tab === 'offers' && (
              <FitList items={[...gf.offers].reverse()} rowHeight={34} keyOf={(o: any) => o.id}
                header={<THead cols={oc}><span>Participant</span><span>Programme</span><span className="text-right">MW</span><span>Window</span><span className="text-right">Resp</span><span className="text-right">₹/MWh</span><span className="text-right">Avail</span><span>Status</span></THead>}
                render={(o: any) => (
                  <TRow cols={oc} title={o.restrictions}>
                    <span className="truncate">{pname(o.participant)}</span>
                    <span className="truncate text-[var(--fg-dim)]">{prog(o.programme_id)}</span>
                    <span className="num text-right">{o.mw}</span>
                    <span className="num">{hourWindow(o.window)}</span>
                    <span className="num text-right">{o.response_min}m</span>
                    <span className="num text-right">{num(o.price_rs_mwh)}</span>
                    <span className="num text-right">{o.availability_rs_mw_h || '—'}</span>
                    <span><Chip tone={o.status === 'ACCEPTED' ? 'ok' : o.status === 'PENDING' ? 'info' : 'neutral'}>{o.status}</Chip></span>
                  </TRow>
                )} />
            )}
            {tab === 'mv' && (
              <FitList items={gf.records} rowHeight={48} keyOf={(r: any) => r.id} empty="M&V records open when an industry is activated"
                render={(r: any) => (
                  <TRow cols="1.3fr 2fr 1.4fr 12rem">
                    <span className="min-w-0"><span className="block truncate font-medium">{pname(r.participant)}</span><span className="block truncate text-[10px] text-[var(--muted)]">{r.event} · {r.method}</span></span>
                    <span className="num truncate font-mono text-[10px] text-[var(--muted)]">{r.blocks.map((b: any) => `B${b.B}/M${b.M}→V${b.V}`).join('  ')}</span>
                    <span className="num text-[11px]">E {r.totals.E_mwh}/{r.totals.accepted_mwh} · PF {r.totals.PF} · <b>{rs(r.totals.payment_rs)}</b></span>
                    <span className="flex items-center justify-end gap-1">
                      <Chip tone={r.status === 'DISPUTED' ? 'warn' : r.status === 'RESOLVED' ? 'info' : 'neutral'}>{r.status}</Chip>
                      {r.status !== 'DISPUTED' ? <Btn small onClick={() => act('mv_dispute', { id: r.id, reason: 'baseline under review' }, 'Disputed — payment held')}>Dispute</Btn> : (
                        <>
                          <input className={cx(inputCls, 'h-6 w-16')} placeholder="± ₹" value={adj[r.id] ?? ''} onChange={(e) => setAdj({ ...adj, [r.id]: e.target.value })} aria-label="Adjustment" />
                          <Btn small kind="primary" onClick={() => act('mv_resolve', { id: r.id, adjustment_rs: Number(adj[r.id] || 0), note: 'resolved after meter review' }, 'Resolved with audited adjustment')}>Resolve</Btn>
                        </>
                      )}
                    </span>
                  </TRow>
                )} />
            )}
            {tab === 'resources' && (
              <FitList items={snap.resources} rowHeight={28} keyOf={(r: any) => r.id}
                header={<THead cols="1.8fr 1fr 2rem repeat(5, 1fr) 1.3fr"><span>Resource</span><span>Type</span><span>Tier</span><span className="text-right">Avail</span><span className="text-right">Setpoint</span><span className="text-right">Metered</span><span className="text-right">Reliab.</span><span className="text-right">Resp/ramp</span><span>Status</span></THead>}
                render={(r: any) => (
                  <TRow cols="1.8fr 1fr 2rem repeat(5, 1fr) 1.3fr">
                    <span className="truncate">{r.name}</span><span className="text-[10px] text-[var(--muted)]">{r.type}</span><span>T{r.tier}</span>
                    <span className="num text-right">{r.available.toFixed(0)}</span><span className="num text-right">{r.setpoint.toFixed(0)}</span>
                    <span className={cx('num text-right', r.delivering > 0.5 && 'text-[var(--ok)]')}>{r.delivering.toFixed(0)}</span>
                    <span className="num text-right">{r.reliability.toFixed(3)}</span><span className="num text-right">{r.response_min}m/{r.ramp}</span>
                    <span className="truncate">{r.veto ? <Chip tone="p2" title={r.veto}>veto</Chip> : r.soc != null ? <span className="num text-[11px]">SoC {pct(r.soc)}</span> : r.ancillary_mw ? <span className="text-[10px] text-[var(--muted)]">{r.ancillary_mw} MW SRAS locked</span> : null}</span>
                  </TRow>
                )} />
            )}
          </div>
        </Card>
        <div className="flex min-h-0 flex-col gap-2">
          <Card title="Decision queue" icon="check" className="min-h-0 flex-1" sub={`${pendingOffers.length + apps.length} waiting`}>
            <FitList items={[...pendingOffers.map((o: any) => ({ kind: 'offer', o })), ...apps.map((a: any) => ({ kind: 'app', a }))]} rowHeight={74}
              empty="No offers or applications await a decision."
              render={(it: any) => it.kind === 'offer' ? (
                <div className="mb-1.5 h-[68px] rounded-md border border-[var(--line)] p-2 text-xs">
                  <div className="flex justify-between"><b className="truncate">{pname(it.o.participant)}</b><Chip tone="info">Offer</Chip></div>
                  <div className="num truncate text-[11px] text-[var(--muted)]">{it.o.mw} MW · {hourWindow(it.o.window)} · ₹{num(it.o.price_rs_mwh)}/MWh · {prog(it.o.programme_id)}</div>
                  <div className="mt-1 flex gap-1"><Btn small kind="primary" onClick={() => act('offer_decide', { id: it.o.id, accept: true }, 'Offer accepted')}>Accept</Btn><Btn small onClick={() => act('offer_decide', { id: it.o.id, accept: false }, 'Offer rejected')}>Reject</Btn></div>
                </div>
              ) : (
                <div className="mb-1.5 h-[68px] rounded-md border border-[var(--line)] p-2 text-xs">
                  <div className="flex justify-between"><b className="truncate">{it.a.company}</b><Chip tone="accent">Application</Chip></div>
                  <div className="num truncate text-[11px] text-[var(--muted)]">{it.a.sector} · {it.a.discom} · {it.a.flexible_mw} MW · {it.a.contact}</div>
                  <div className="mt-1 flex gap-1"><Btn small kind="primary" onClick={() => act('application_decide', { id: it.a.id, accept: true }, 'Accepted for onboarding')}>Onboard</Btn><Btn small onClick={() => act('application_decide', { id: it.a.id, accept: false })}>Decline</Btn></div>
                </div>
              )} />
          </Card>
          <Card title="Programmes on offer to industry" icon="market" className="h-[42%] shrink-0">
            <FitList items={gf.programmes} rowHeight={40} render={(p: any) => (
              <div className="border-b border-[var(--line)]/70 py-1 text-xs">
                <div className="flex justify-between gap-2"><span className="truncate font-medium">{p.name}</span><Chip tone={p.status === 'OPEN' ? 'ok' : 'neutral'}>{p.status}</Chip></div>
                <div className="num truncate text-[10px] text-[var(--muted)]">{hourWindow(p.window)} · ≤ {p.max_response_min} min · ≤ ₹{num(p.energy_cap_rs_mwh)}/MWh · {p.type}</div>
              </div>
            )} />
          </Card>
        </div>
      </div>
    </div>
  );
}

/* ================================================================= Forecast */

export function ForecastView({ snap }: { snap: any }) {
  const fc = snap.forecast;
  if (!fc?.blocks) return <Empty icon="forecast">Forecast warming up…</Empty>;
  const B = fc.blocks;
  const labels = B.map((b: any) => hhmm(b.t));
  return (
    <div className="flex h-full flex-col gap-2 p-2">
      <KpiRow items={[
        { label: 'Next block ACE (P50)', value: `${B[0].ace.p50.toFixed(0)} MW`, sub: `P10 ${B[0].ace.p10.toFixed(0)} · P90 ${B[0].ace.p90.toFixed(0)}` },
        { label: 'Next block demand', value: num(B[0].demand.p50), sub: 'MW' },
        { label: 'Next block RE', value: num(B[0].re.p50), sub: 'MW' },
        { label: 'Peak line (2 h)', value: fc.peak_line ? `${fc.peak_line.line} ${pct(fc.peak_line.loading)}` : '—', tone: fc.peak_line?.loading >= 1 ? 'p3' : undefined },
        { label: 'MAPE · 1 block', value: fc.mape == null ? '—' : `${fc.mape}%`, sub: `${fc.samples}/96 samples` },
        { label: 'Anomaly z', value: fc.z.toFixed(2), sub: 'alarm at |z| ≥ 4', tone: Math.abs(fc.z) >= 4 ? 'p3' : undefined },
      ]} />
      <div className="grid min-h-0 flex-1 grid-cols-[1fr_1fr_320px] grid-rows-2 gap-2">
        <Card title="ACE · P10 / P50 / P90" icon="forecast" className="col-span-2" sub="8 × 15-min blocks">
          <Chart labels={labels} series={[{ values: B.map((b: any) => b.ace.p50), color: 'var(--fg)', label: 'P50' }]}
            band={{ lo: B.map((b: any) => b.ace.p10), hi: B.map((b: any) => b.ace.p90), color: 'rgba(156,195,255,0.16)' }}
            refLines={[{ y: 100, label: '+100', color: 'var(--p3)' }, { y: -100, label: '−100', color: 'var(--p3)' }]} />
        </Card>
        <Card title="Predicted violations" icon="alert">
          <FitList items={fc.violations} rowHeight={24} empty="None in the 2-hour horizon" render={(v: any) => (
            <div className="num flex h-full items-center justify-between border-b border-[var(--line)]/60 text-xs">
              <span className="flex items-center gap-1.5">{v.kind === 'LINE' ? <Chip tone={v.value >= 1 ? 'p3' : 'neutral'}>Line {v.line}</Chip> : <Chip>ACE</Chip>} blk {v.block} · {hhmm(v.t)}</span>
              <span>{v.kind === 'LINE' ? pct(v.value) : `${v.value} MW`}</span>
            </div>
          )} />
        </Card>
        <Card title="Demand · P10–P90" icon="forecast">
          <Chart labels={labels} series={[{ values: B.map((b: any) => b.demand.p50), color: 'var(--fg)', label: 'Demand' }]}
            band={{ lo: B.map((b: any) => b.demand.p10), hi: B.map((b: any) => b.demand.p90), color: 'rgba(139,149,167,0.2)' }} />
        </Card>
        <Card title="Renewables · P10–P90" icon="forecast">
          <Chart labels={labels} series={[{ values: B.map((b: any) => b.re.p50), color: 'var(--info)', label: 'RE' }]}
            band={{ lo: B.map((b: any) => b.re.p10), hi: B.map((b: any) => b.re.p90), color: 'rgba(156,195,255,0.14)' }} />
        </Card>
        <Card title="Model" icon="doc">
          <KV rows={[['Model', 'Level-corrected profile'], ['Demand level vs day-ahead', fc.level_d.toFixed(3)], ['RE level vs day-ahead', fc.level_re.toFixed(3)], ['Uncertainty', 'σ grows with √lead'], ['Bands', 'P50 ∓ 1.2816σ']]} />
          <div className="mt-auto text-[10px] leading-relaxed text-[var(--muted)]">Lines are re-solved at blocks 1, 2 and 4 with scaled loads and RE; ≥ 95% is flagged. An ML ensemble (LightGBM / TFT) can replace this model behind the same interface.</div>
        </Card>
      </div>
    </div>
  );
}

/* ================================================================= Alarms */

export function AlarmsView({ snap }: { snap: any }) {
  const act = useAct();
  const a = snap.alarms;
  const [tab, setTab] = useState<'active' | 'history'>('active');
  const unacked = a.active.filter((x: any) => !x.acked_by).map((x: any) => x.id);
  const t = snap.clock.t;
  const cols = '3rem 1.4fr 1.6fr 3.4rem 5.5rem 10.5rem';
  return (
    <div className="grid h-full grid-cols-[1fr_320px] gap-2 p-2">
      <Card pad={false} title={<Segmented value={tab} onChange={setTab} items={[{ id: 'active', label: `Active (${a.active.length})` }, { id: 'history', label: 'History' }]} />}
        right={<><span className="num text-[11px] text-[var(--muted)]">oldest unacked {a.oldest_unacked != null ? dur(t - a.oldest_unacked) : '—'}</span><Btn small disabled={!unacked.length} onClick={() => act('alarm_ack', { ids: unacked }, `${unacked.length} acknowledged`)}>Acknowledge all</Btn></>}>
        <div className="flex min-h-0 flex-1 flex-col p-3">
          {tab === 'active' ? (
            <FitList items={a.active} rowHeight={34} keyOf={(x: any) => x.id} empty="No active alarms."
              header={<THead cols={cols}><span>Prio</span><span>Alarm</span><span>Detail</span><span>Raised</span><span>State</span><span className="text-right">Actions</span></THead>}
              render={(x: any) => (
                <TRow cols={cols} className={!x.active ? 'opacity-60' : ''}>
                  <Chip tone={prioTone(x.priority)} className={x.priority === 'P1' && !x.acked_by ? 'blink' : ''}>{x.priority}</Chip>
                  <span className="truncate font-medium">{x.title}</span>
                  <span className="truncate text-[var(--muted)]">{x.detail}</span>
                  <span className="num text-[var(--muted)]">{hhmm(x.raised_at)}</span>
                  <span className="text-[11px]">{x.active ? 'active' : 'cleared'}{x.shelved_until ? ' · shelved' : ''}</span>
                  <span className="flex justify-end gap-1">
                    {x.acked_by ? <span className="text-[10px] text-[var(--muted)]">ack {x.acked_by}</span> : <Btn small onClick={() => act('alarm_ack', { id: x.id })}>Ack</Btn>}
                    {!x.shelved_until && <Btn small kind="ghost" onClick={() => act('alarm_shelve', { id: x.id, minutes: 30, reason: 'known condition' }, 'Shelved 30 min')}>Shelve</Btn>}
                  </span>
                </TRow>
              )} />
          ) : (
            <FitList items={a.history} rowHeight={28} keyOf={(x: any) => x.id}
              header={<THead cols="3rem 1.4fr 1.6fr 3.4rem 3.4rem"><span>Prio</span><span>Alarm</span><span>Detail</span><span>Raised</span><span>Cleared</span></THead>}
              render={(x: any) => (
                <TRow cols="3rem 1.4fr 1.6fr 3.4rem 3.4rem">
                  <Chip tone={prioTone(x.priority)}>{x.priority}</Chip><span className="truncate">{x.title}</span><span className="truncate text-[var(--muted)]">{x.detail}</span>
                  <span className="num">{hhmm(x.raised_at)}</span><span className="num text-[var(--muted)]">{x.cleared_at ? hhmm(x.cleared_at) : '—'}</span>
                </TRow>
              )} />
          )}
          <div className="pt-1 text-[10px] text-[var(--muted)]">ISA-18.2 style: on-delays suppress chatter, 60 s off-delay, alarms stay listed until acknowledged.</div>
        </div>
      </Card>
      <div className="flex min-h-0 flex-col gap-2">
        <Card title="Priority mix" icon="bell" className="shrink-0">
          <div className="grid grid-cols-3 gap-2">{(['P1', 'P2', 'P3'] as const).map((p) => <Stat key={p} label={p} value={a.counts[p]} tone={a.counts[p] ? prioTone(p) : undefined} />)}</div>
          <div className="mt-2"><SegBar total={Math.max(1, a.counts.P1 + a.counts.P2 + a.counts.P3)} parts={[{ v: a.counts.P1, color: 'var(--alarm)' }, { v: a.counts.P2, color: 'var(--warn)' }, { v: a.counts.P3, color: 'var(--p3)' }]} /></div>
        </Card>
        <Card title="Incidents" icon="link" className="min-h-0 flex-1" sub="correlated alarms">
          <FitList items={a.incidents} rowHeight={40} empty="No incidents" render={(x: any) => (
            <div className="border-b border-[var(--line)]/70 py-1 text-xs">
              <div className="flex justify-between"><span className="truncate font-medium">{x.title}</span>{x.closed_at ? <span className="num text-[10px] text-[var(--muted)]">closed {hhmm(x.closed_at)}</span> : <Chip tone="p2">open</Chip>}</div>
              <div className="num text-[10px] text-[var(--muted)]">{x.id} · {x.category} · {x.alarms.length} alarms · {hhmm(x.opened_at)}</div>
            </div>
          )} />
        </Card>
      </div>
    </div>
  );
}

/* ================================================================= What-if */

export function WhatIfView() {
  const [f, setF] = useState({ shortage: 900, minutes: 60, participation: 0.7 });
  const [r, setR] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const run = async (v = f) => {
    setBusy(true);
    try { setR(await post('/api/whatif', v)); } finally { setBusy(false); }
  };
  useEffect(() => { run(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  const cases = r ? [
    { k: 'No action', v: r.no_action.dsm_rs }, { k: 'Flexibility first', v: r.flex_first.total_rs }, { k: 'Rotation-assisted', v: r.rotation_assisted.total_rs + r.rotation_assisted.interruption_cost_rs },
  ] : [];
  const mx = Math.max(1, ...cases.map((c) => c.v));
  return (
    <div className="grid h-full grid-cols-[280px_1fr] gap-2 p-2">
      <Card title="Scenario" icon="flask">
        <div className="flex flex-col gap-4">
          <Field label={`Shortage · ${f.shortage} MW`}><input type="range" min={100} max={2500} step={50} value={f.shortage} onChange={(e) => setF({ ...f, shortage: +e.target.value })} className="accent-[var(--accent)]" /></Field>
          <Field label={`Duration · ${f.minutes} min`}><input type="range" min={15} max={120} step={15} value={f.minutes} onChange={(e) => setF({ ...f, minutes: +e.target.value })} className="accent-[var(--accent)]" /></Field>
          <Field label="Industrial participation">
            <Segmented value={String(f.participation)} onChange={(v) => setF({ ...f, participation: +v })} items={[{ id: '0.5', label: '50%' }, { id: '0.7', label: '70%' }, { id: '0.9', label: '90%' }]} />
          </Field>
          <Btn kind="primary" icon="play" onClick={() => run()} disabled={busy}>{busy ? 'Solving…' : 'Run on a copy of live state'}</Btn>
        </div>
        <div className="mt-auto text-[10px] leading-relaxed text-[var(--muted)]">Uses the same priority LP as live dispatch on a copy of the current grid. Rotation is realised at ~92% of plan. Interruption cost is illustrative and set per utility study.</div>
      </Card>
      {r ? (
        <div className="grid min-h-0 grid-rows-[auto_1fr] gap-2">
          <Card title="Total cost of each case" icon="receipt" sub={`${r.inputs.shortage} MW for ${r.inputs.minutes} min · ${r.inputs.participation * 100}% industrial participation`}>
            <div className="space-y-2">
              {cases.map((c) => (
                <div key={c.k} className="grid grid-cols-[9rem_1fr_6rem] items-center gap-3 text-xs">
                  <span className="font-medium">{c.k}</span>
                  <SegBar height={12} total={mx} parts={[{ v: c.v, color: c.k === 'No action' ? 'var(--warn)' : 'var(--fg-dim)' }]} />
                  <span className="num text-right font-semibold">{rsShort(c.v)}</span>
                </div>
              ))}
            </div>
          </Card>
          <div className="grid min-h-0 grid-cols-3 gap-2">
            <Card title="1 · No action" icon="x">
              <Stat size="lg" label="DSM over the duration" value={rsShort(r.no_action.dsm_rs)} sub={`${rsShort(r.no_action.per_block_rs)} × ${r.inputs.blocks} blocks`} />
              <div className="mt-auto text-[11px] text-[var(--muted)]">Absorb the deviation and pay DSM on the full shortage.</div>
            </Card>
            <Card title="2 · Flexibility first" icon="battery">
              <div className="grid grid-cols-2 gap-3">
                <Stat label="Total" value={rsShort(r.flex_first.total_rs)} />
                <Stat label="Persistent residual" value={mw(r.flex_first.persistent_residual_mw)} tone={r.flex_first.persistent_residual_mw > 50 ? 'warn' : undefined} />
                <Stat label="Payments" value={rsShort(r.flex_first.payments_rs)} />
                <Stat label="DSM still owed" value={rsShort(r.flex_first.dsm_owed_rs)} />
              </div>
              <div className="label mb-1 mt-3">Dispatch, block 1</div>
              <FitList items={r.flex_first.allocations} rowHeight={22} render={(a: any) => (
                <div className="num flex h-full items-center justify-between border-b border-[var(--line)]/60 text-[11px]"><span className="truncate">{a.name}</span><span>{a.x1.toFixed(0)} MW</span></div>
              )} />
            </Card>
            <Card title="3 · Rotation-assisted" icon="rotate">
              <div className="grid grid-cols-2 gap-3">
                <Stat label="Total incl. DSM" value={rsShort(r.rotation_assisted.total_rs)} />
                <Stat label="Rotated / realised" value={`${num(r.rotation_assisted.rotated_mw)} / ${num(r.rotation_assisted.realised_mw)}`} sub="MW" />
                <Stat label="Unserved energy" value={`${r.rotation_assisted.unserved_mwh} MWh`} />
                <Stat label="Interruption impact" value={rsShort(r.rotation_assisted.interruption_cost_rs)} sub={`@ ₹${r.rotation_assisted.interruption_cost_rate}/kWh`} />
              </div>
              <div className="mt-3 text-[11px]">{r.rotation_assisted.groups.length ? <><b>{r.rotation_assisted.groups.length} groups · {r.rotation_assisted.stations} stations</b><div className="mt-1 flex flex-wrap gap-1">{r.rotation_assisted.groups.map((g: string) => <Chip key={g}>{g}</Chip>)}</div></> : <span className="text-[var(--muted)]">No rotation needed — flexibility covers the shortage.</span>}</div>
            </Card>
          </div>
        </div>
      ) : <Empty icon="flask">Solving…</Empty>}
    </div>
  );
}

/* ================================================================= Settlement & audit */

export function SettlementView({ snap }: { snap: any }) {
  const [verify, setVerify] = useState<any>(null);
  const [audit, setAudit] = useState<any[]>([]);
  useEffect(() => { api<any>('/api/audit?limit=1000').then((r) => setAudit(r.entries)).catch(() => {}); }, [snap.audit.length]);
  const net = snap.events.reduce((a: number, e: any) => a + (e.net_savings ?? 0), 0);
  const ec = '7.5rem 3.6rem 3.6rem 3.6rem 5rem 1fr 6.5rem';
  const ac = '3.2rem 3.4rem 8rem 5.5rem 1fr 6rem';
  return (
    <div className="flex h-full flex-col gap-2 p-2">
      <KpiRow items={[
        { label: 'Events settled', value: snap.events.length },
        { label: 'Net savings (settled)', value: rsShort(net), tone: net > 0 ? 'ok' : undefined },
        { label: 'DSM this block', value: rsShort(snap.grid.dsm.amount), sub: `${snap.grid.dsm.direction} · ${snap.grid.dsm.freq_band}` },
        { label: 'Audit entries', value: num(snap.audit.length), sub: <span className="font-mono">{snap.audit.head.slice(0, 14)}…</span> },
        { label: 'Chain integrity', value: verify ? (verify.ok ? 'Intact' : `Broken #${verify.broken_at}`) : 'Not checked', tone: verify ? (verify.ok ? 'ok' : 'alarm') : undefined, sub: <button className="underline" onClick={async () => setVerify(await api('/api/audit/verify'))}>Verify now</button> },
      ]} />
      <div className="grid min-h-0 flex-1 grid-cols-[1fr_1.25fr] gap-2">
        <Card title="Settled DR events" icon="wallet" sub="counterfactual ledger per event">
          <FitList items={snap.events} rowHeight={30} keyOf={(e: any) => e.id} empty="No settled events yet."
            header={<THead cols={ec}><span>Event</span><span>Open</span><span>Close</span><span>Dir</span><span className="text-right">Req</span><span>Phase</span><span className="text-right">Net savings</span></THead>}
            render={(e: any) => (
              <TRow cols={ec}>
                <span className="font-medium">{e.id}</span><span className="num">{hhmm(e.opened_t)}</span><span className="num">{hhmm(e.closed_t)}</span><span>{e.direction}</span>
                <span className="num text-right">{mw(e.req_at_open)}</span><span className="truncate text-[11px]">{e.phase}{e.exception ? ` · ${e.exception}` : ''}</span>
                <span className="num text-right font-semibold text-[var(--ok)]">{rs(e.net_savings)}</span>
              </TRow>
            )} />
        </Card>
        <Card title="Audit trail" icon="lock" sub="SHA-256 hash chain">
          <FitList items={audit} rowHeight={24} keyOf={(e: any) => String(e.seq)}
            header={<THead cols={ac}><span>#</span><span>Sim</span><span>Kind</span><span>Actor</span><span>Message</span><span>Hash</span></THead>}
            render={(e: any) => (
              <TRow cols={ac} title={e.message}>
                <span className="num text-[var(--muted)]">{e.seq}</span><span className="num">{hhmm(e.sim_t)}</span>
                <span className="truncate text-[11px] font-medium">{e.kind}</span><span className="truncate text-[11px] text-[var(--muted)]">{e.actor}</span>
                <span className="truncate text-[11px]">{e.message}</span><span className="truncate font-mono text-[10px] text-[var(--muted)]">{e.hash.slice(0, 12)}</span>
              </TRow>
            )} />
          <div className="pt-1 text-[10px] text-[var(--muted)]">hash_n = SHA-256([hash_n−1, seq, ts, kind, actor, ref, message]) — editing any entry breaks every hash after it.</div>
        </Card>
      </div>
    </div>
  );
}

/* ================================================================= Administration */

export function AdminView({ snap }: { snap: any }) {
  const act = useAct();
  const cfg = snap.config;
  const [prices, setPrices] = useState(cfg.prices);
  const [band, setBand] = useState<string>(snap.rotation.band_override_mw ?? '');
  const [table, setTable] = useState(() => JSON.stringify(cfg.dsm_table, null, 1));
  const t = cfg.dsm_table;
  return (
    <div className="grid h-full grid-cols-3 gap-2 p-2">
      <Card title="DSM rule table" icon="doc" sub="versioned configuration" right={t.illustrative && <Chip tone="p3">Illustrative</Chip>}>
        <KV rows={[['Version', t.version], ['Effective', t.effective_date], ['Source', <span key="s" title={t.source}>{t.source}</span>], ['Amendments', <span key="a" title={t.amendments.join('; ')}>{t.amendments.join('; ')}</span>]]} />
        <div className="mt-3 grid grid-cols-[2.5rem_1fr_1fr_1fr] gap-x-2 gap-y-1 rounded-md bg-[var(--chip)] p-2 text-[10px]">
          <span className="label">Band</span><span className="label">Edge</span><span className="label">Over L/N/H</span><span className="label">Under L/N/H</span>
          {t.bands.map((b: any, i: number) => (
            <div key={i} className="contents num"><span>{i + 1}</span><span>{b.pct != null ? `min(${b.pct}%, ${b.cap_mw})` : 'beyond'}</span><span>{b.over.LOW}/{b.over.NORMAL}/{b.over.HIGH}</span><span>{b.under.LOW}/{b.under.NORMAL}/{b.under.HIGH}</span></div>
          ))}
        </div>
        <div className="label mb-1 mt-3">Load a notified table (JSON)</div>
        <textarea className="min-h-0 w-full flex-1 resize-none rounded-md border border-[var(--line-strong)] bg-[var(--input)] p-2 font-mono text-[10px] outline-none focus:border-[var(--accent)]" value={table} onChange={(e) => setTable(e.target.value)} aria-label="DSM table JSON" />
        <Btn className="mt-2" kind="primary" onClick={() => { try { act('dsm_table', { table: JSON.parse(table) }, 'DSM table loaded'); } catch { act('dsm_table', { table: {} }); } }}>Load table · engineer</Btn>
      </Card>
      <div className="flex min-h-0 flex-col gap-2">
        <Card title="Market prices" icon="receipt" className="shrink-0">
          <div className="grid grid-cols-3 gap-2">
            {(['dam', 'rtm', 'ancillary'] as const).map((k) => <Field key={k} label={`${k.toUpperCase()} ₹/kWh`}><input className={inputCls} value={prices[k]} onChange={(e) => setPrices({ ...prices, [k]: e.target.value })} /></Field>)}
          </div>
          <div className="mt-2 flex items-center justify-between"><span className="num text-[11px] text-[var(--muted)]">NR ₹{snap.grid.nr.NR} ({snap.grid.nr.binding})</span><Btn small onClick={() => act('prices', { dam: +prices.dam, rtm: +prices.rtm, ancillary: +prices.ancillary }, 'Prices updated')}>Save</Btn></div>
        </Card>
        <Card title="Control area" icon="target" className="shrink-0">
          <KV rows={[['Frequency bias Bf', <span key="b">{cfg.bias} MW/0.1 Hz <Chip tone="p3">pending declaration</Chip></span>], ['ACE offset', `${cfg.offset} MW`], ['DSM band edges now', cfg.band_edges.map((e: number) => `${e.toFixed(0)} MW`).join(' · ')]]} />
          <div className="mt-3 flex items-end gap-2">
            <Field label="Rotation band override (MW, blank = DSM band 1)"><input className={inputCls} value={band} onChange={(e) => setBand(e.target.value)} /></Field>
            <Btn onClick={() => act('rotation_band', { mw: band === '' ? null : +band }, 'Band override saved')}>Apply</Btn>
          </div>
        </Card>
        <Card title="Telemetry source" icon="link" className="min-h-0 flex-1">
          <Segmented value={snap.source} onChange={(v) => act('source', { mode: v })} items={[{ id: 'SIM', label: 'Simulated SCADA' }, { id: 'SLDC_WEB', label: 'SLDC website · 300 s' }]} />
          <div className="mt-2 text-[11px] leading-relaxed text-[var(--muted)]">The website source is a hard veto: the platform stays advisory until authorised SCADA/EMS telemetry with source timestamps is connected.</div>
          <div className="label mb-1 mt-3">Data quality now</div>
          <div className="flex flex-wrap gap-1">{Object.entries(snap.quality.flags).map(([k, v]) => <Chip key={k} tone={k === 'GOOD' ? 'neutral' : 'p3'} glyph={k !== 'GOOD'}>{k} {String(v)}</Chip>)}</div>
          <div className="mt-2 space-y-0.5 text-[11px]">{snap.quality.vetoes.map((v: string) => <div key={v} className="text-[var(--warn)]">▲ {v}</div>)}</div>
        </Card>
      </div>
      <div className="flex min-h-0 flex-col gap-2">
        <Card title="Policy" icon="shield" sub="application policy, not grid code" className="shrink-0">
          <KV rows={Object.entries(cfg.policy).map(([k, v]) => [k.replace(/_/g, ' '), String(v)] as [string, string])} />
        </Card>
        <Card title="Engine" icon="sim" className="shrink-0">
          <KV rows={[['Loop latency', `${snap.clock.latency_ms} ms`], ['Ticks', num(snap.clock.tick)], ['Sim speed', `×${snap.clock.speed}`], ['Running', snap.clock.running ? 'yes' : 'paused']]} />
        </Card>
        <Card title="Before operational use" icon="alert" className="min-h-0 flex-1">
          <ul className="space-y-1.5 text-[11px] text-[var(--fg-dim)]">
            {['Authenticated, fresh SCADA/EMS telemetry', 'Notified DSM table with all amendments', 'Validated network model with AC voltage studies', "DISCOM's approved feeder roster", 'Per-resource response envelopes from metered data', 'Shadow-mode replay against historical operations'].map((x) => (
              <li key={x} className="flex items-start gap-2"><Icon name="check" size={12} className="mt-0.5 text-[var(--muted)]" />{x}</li>
            ))}
          </ul>
          <div className="mt-auto text-[10px] text-[var(--muted)]">Status: simulation &amp; advisory prototype</div>
        </Card>
      </div>
    </div>
  );
}
