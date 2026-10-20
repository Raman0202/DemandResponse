'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Btn, Chart, Chip, Field, FitList, Modal, Panel, Stat, Tabs, ToastHost, cmdTone, cx, inputCls, useAct } from '@/components/ui';
import { Claims, claims, setToken, usePoll } from '@/lib/api';
import { hhmm, hourWindow, mw, num, pct, rs, rsShort } from '@/lib/fmt';

type View = 'home' | 'opportunities' | 'offers' | 'dispatch' | 'settlements' | 'enrolment';

export default function IndustryPage() {
  const router = useRouter();
  const [user, setUser] = useState<Claims | null>(null);
  useEffect(() => {
    const c = claims();
    if (!c) router.replace('/');
    else if (c.role !== 'industry') router.replace('/console');
    else setUser(c);
  }, [router]);
  if (!user) return <div className="theme-portal h-screen w-screen" />;
  return (
    <ToastHost>
      <Portal onLogout={() => { setToken(null); router.replace('/'); }} />
    </ToastHost>
  );
}

function Portal({ onLogout }: { onLogout: () => void }) {
  const { data: d, reload } = usePoll<any>('/api/industry/portal', 2000);
  const [view, setView] = useState<View>('home');
  const [offerDraft, setOfferDraft] = useState<any>(null);
  const act = useAct('/api/industry/', reload);
  const enrolled = !!d?.participant;

  useEffect(() => {
    if (d && !d.participant && view !== 'opportunities') setView('enrolment');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d?.participant]);

  const startOffer = useCallback((prefill: any = {}) => {
    if (!enrolled) return setView('enrolment');
    setOfferDraft({ programme: 'PRG-EVE', mw: 20, start_h: 18, end_h: 22, response_min: 10, max_duration_min: 60, price_rs_mwh: 5000, availability_rs_mw_h: 0, restrictions: '', ...prefill });
  }, [enrolled]);

  if (!d) return <div className="theme-portal grid h-screen w-screen place-items-center text-sm text-[var(--muted)]">Loading portal…</div>;
  const gsTone = d.grid_status.condition === 'EMERGENCY' ? 'alarm' : d.grid_status.condition === 'TIGHT' ? 'warn' : 'neutral';
  const nav: { id: View; label: string; badge?: React.ReactNode }[] = [
    { id: 'home', label: 'Home' },
    { id: 'opportunities', label: 'SLDC offers & needs' },
    { id: 'offers', label: 'My offers', badge: enrolled && d.offers.some((o: any) => o.status === 'PENDING') ? <Chip tone="info" icon={false}>pending</Chip> : null },
    { id: 'dispatch', label: 'Dispatch', badge: d.instruction ? <span className="text-[var(--warn)]">●</span> : null },
    { id: 'settlements', label: 'Settlements' },
    { id: 'enrolment', label: enrolled ? 'Enrolment' : 'Enrol' },
  ];

  return (
    <div className="theme-portal flex h-screen w-screen flex-col overflow-hidden bg-[var(--bg)] text-[var(--fg)]">
      <header className="shrink-0 border-b border-[var(--line)] bg-white">
        <div className="flex items-center gap-4 px-4 py-2">
          <div className="flex items-center gap-2">
            <div className="grid h-8 w-8 place-items-center rounded-md bg-[var(--accent)] text-[11px] font-black text-white">GNA</div>
            <div className="leading-tight">
              <div className="text-sm font-semibold">GNA <span className="font-normal text-[var(--muted)]">(Demand Response)</span> · Industry portal</div>
              <div className="text-[11px] text-[var(--muted)]">GridFlex · Karnataka SLDC</div>
            </div>
          </div>
          <Tabs value={view} onChange={setView} items={nav} className="ml-2 min-w-0 flex-1" />
          <Chip tone={gsTone as any} icon={gsTone !== 'neutral'}>Grid {d.grid_status.condition}</Chip>
          <span className="text-xs tabular-nums text-[var(--muted)]">{d.clock.hhmm} · block {d.clock.block}</span>
          <Btn small kind="primary" onClick={() => startOffer()}>+ New offer</Btn>
          <div className="text-right leading-tight">
            <div className="max-w-48 truncate text-xs font-medium">{d.user.name}</div>
            <button onClick={onLogout} className="text-[11px] text-[var(--muted)] hover:underline">Sign out</button>
          </div>
        </div>
      </header>
      <main className="min-h-0 flex-1 p-3">
        {view === 'home' && <Home d={d} go={setView} startOffer={startOffer} />}
        {view === 'opportunities' && <Opportunities d={d} startOffer={startOffer} go={setView} />}
        {view === 'offers' && <Offers d={d} act={act} startOffer={startOffer} />}
        {view === 'dispatch' && <Dispatch d={d} />}
        {view === 'settlements' && <Settlements d={d} act={act} />}
        {view === 'enrolment' && <Enrolment d={d} act={act} />}
      </main>
      <OfferModal draft={offerDraft} setDraft={setOfferDraft} d={d} act={act} />
    </div>
  );
}

/* ----------------------------------------------------------------- Home */

function Home({ d, go, startOffer }: { d: any; go: (v: View) => void; startOffer: (p?: any) => void }) {
  const p = d.participant;
  const next = d.needs.filter((n: any) => n.gap_mw > 0).slice(0, 4);
  if (!p) return <Enrolment d={d} act={null} />;
  const ins = d.instruction;
  return (
    <div className="grid h-full grid-cols-[1.25fr_1fr] grid-rows-[auto_1fr] gap-3">
      <div className={cx('col-span-2 flex items-center justify-between rounded-xl border px-4 py-3',
        ins ? 'border-[var(--warn)]/40 bg-[var(--warn-bg)]' : 'border-[var(--line)] bg-white')}>
        <div>
          <div className="text-sm font-semibold">{ins ? `Dispatch instruction: reduce ${mw(ins.setpoint)} (${ins.state.replace('_', ' ').toLowerCase()})` : d.grid_status.message}</div>
          <div className="text-xs text-[var(--muted)]">
            {ins ? `Event ${ins.event} · sent ${ins.sent_t != null ? hhmm(ins.sent_t) : '—'} · acknowledged by your gateway ${ins.clocks.ack_s != null ? `in ${ins.clocks.ack_s} s` : '— pending'}. Respond within your offer's response time; delivery is verified against your baseline.`
              : `Your offer in force now: ${p.offer_now ?? `none (${p.offer_status})`}.`}
          </div>
        </div>
        {ins ? <Btn onClick={() => go('dispatch')}>Track delivery ›</Btn> : <Btn onClick={() => go('opportunities')}>See where the SLDC needs flexibility ›</Btn>}
      </div>
      <Panel title="My site now">
        <div className="grid grid-cols-4 gap-3">
          <Stat label="Baseline" value={mw(p.baseline)} sub="B4-mean ±10% of declared" />
          <Stat label="Meter" value={mw(p.meter)} sub="revenue meter, 15-min" />
          <Stat label="Instructed" value={p.instructed_mw > 0 ? mw(p.instructed_mw) : '—'} />
          <Stat label="Delivering" value={p.delivering_mw > 0.5 ? mw(p.delivering_mw) : '—'} tone={p.delivering_mw > 0.5 ? 'ok' : 'neutral'} />
        </div>
        <div className="mt-3 flex min-h-0 flex-1 flex-col">
          <div className="mb-1 text-[11px] text-[var(--muted)]">Metered demand per 15-min block vs your baseline (MW)</div>
          {d.meter_history.length >= 2 ? (
            <div className="min-h-0 flex-1"><Chart
              series={[{ values: [...d.meter_history, p.meter], color: 'var(--accent)', label: 'Meter' }, { values: [...d.meter_history, p.meter].map(() => p.baseline), color: 'var(--muted)', label: 'Baseline', dash: true }]}
              labels={[...d.meter_history.map((_: number, i: number) => `−${d.meter_history.length - i} blk`), 'now']} /></div>
          ) : <div className="flex flex-1 items-center justify-center text-xs text-[var(--muted)]">Collecting block data — the chart fills as 15-minute blocks close.</div>}
        </div>
        <div className="mt-2 grid grid-cols-3 gap-3 border-t border-[var(--line)] pt-2">
          <Stat label="Reliability score" value={pct(p.reliability, 1)} sub="learned from metered delivery" />
          <Stat label="Flexible range" value={mw(p.flexible_mw)} sub={`${p.processes.length} processes declared`} />
          <Stat label="Gateway heartbeat" value={`${p.heartbeat_age.toFixed(0)} s`} tone={p.heartbeat_age > 60 ? 'alarm' : 'neutral'} sub={p.heartbeat_age > 60 ? 'lost — commands go to approval' : 'healthy'} />
        </div>
      </Panel>
      <div className="flex min-h-0 flex-col gap-3">
        <Panel title="Earnings (verified)">
          <div className="grid grid-cols-4 gap-3">
            <Stat label="Settled" value={rsShort(d.earnings.settled_rs)} tone="ok" />
            <Stat label="Open" value={rsShort(d.earnings.open_rs)} />
            <Stat label="Held (dispute)" value={rsShort(d.earnings.held_rs)} tone={d.earnings.held_rs ? 'warn' : 'neutral'} />
            <Stat label="Verified" value={`${d.earnings.verified_mwh} MWh`} />
          </div>
        </Panel>
        <Panel title="Where the SLDC needs you next" right={<Btn small onClick={() => go('opportunities')}>All 24 h ›</Btn>} className="min-h-0 flex-1">
          <FitList items={next} rowHeight={40} empty="No uncovered need in the next 24 h" render={(n: any) => (
            <div className="flex items-center justify-between gap-2 border-b border-[var(--line)] text-xs">
              <div><div className="font-medium">{n.label}</div><div className="text-[11px] text-[var(--muted)]">gap {mw(n.gap_mw)} of {mw(n.desired_mw)} · ceiling ₹{num(n.price_ceiling_rs_mwh)}/MWh</div></div>
              <div className="flex items-center gap-2"><NeedChip level={n.level} /><Btn small kind="primary" onClick={() => startOffer({ start_h: n.hour, end_h: (n.hour + 2) % 24 || 24, programme: n.programmes.includes('PRG-EVE') ? 'PRG-EVE' : n.programmes[0] ?? 'PRG-DAY', price_rs_mwh: Math.min(n.price_ceiling_rs_mwh, 6000) })}>Offer</Btn></div>
            </div>
          )} />
        </Panel>
      </div>
    </div>
  );
}

const NeedChip = ({ level }: { level: string }) => (
  <Chip tone={level === 'HIGH' ? 'warn' : level === 'MEDIUM' ? 'p3' : 'neutral'} icon={level === 'HIGH' || level === 'MEDIUM'}>{level} need</Chip>
);

/* ----------------------------------------------------------------- Opportunities: what the SLDC offers and wants */

function Opportunities({ d, startOffer, go }: { d: any; startOffer: (p?: any) => void; go: (v: View) => void }) {
  const [hover, setHover] = useState<any>(null);
  const max = Math.max(1, ...d.needs.map((n: any) => Math.max(n.desired_mw, n.committed_mw)));
  return (
    <div className="grid h-full grid-cols-[1.3fr_1fr] gap-3">
      <Panel title="What the SLDC wants — flexibility needed, next 24 h" right={<span className="text-[10px] text-[var(--muted)]">Indicative, from the day-ahead net-demand profile and forecast-error reserve</span>}>
        <div className="flex min-h-0 flex-1 items-end gap-1 pb-1">
          {d.needs.map((n: any) => (
            <button key={n.hour} onMouseEnter={() => setHover(n)} onFocus={() => setHover(n)}
              onClick={() => startOffer({ start_h: n.hour, end_h: (n.hour + 2) % 24 || 24, programme: n.programmes.includes('PRG-EVE') ? 'PRG-EVE' : n.programmes[0] ?? 'PRG-DAY', price_rs_mwh: Math.min(n.price_ceiling_rs_mwh || 4000, 6000) })}
              className="group flex h-full min-w-0 flex-1 flex-col justify-end" title={`${n.label}: want ${n.desired_mw} MW, committed ${n.committed_mw} MW`}>
              <div className="relative w-full" style={{ height: `${(n.desired_mw / max) * 100}%` }}>
                <div className="absolute inset-0 rounded-t bg-[var(--chip-hover)] group-hover:bg-[var(--accent)]/25" />
                <div className="absolute inset-x-0 bottom-0 rounded-t bg-[var(--accent)]" style={{ height: `${n.desired_mw ? Math.min(100, (n.committed_mw / n.desired_mw) * 100) : 0}%` }} />
              </div>
              <div className="mt-1 text-center text-[9px] tabular-nums text-[var(--muted)]">{String(n.hour).padStart(2, '0')}</div>
            </button>
          ))}
        </div>
        <div className="flex items-center justify-between border-t border-[var(--line)] pt-2 text-xs">
          <div className="flex gap-3 text-[11px] text-[var(--muted)]">
            <span><span className="inline-block h-2 w-3 rounded-sm bg-[var(--chip-hover)]" /> wanted</span>
            <span><span className="inline-block h-2 w-3 rounded-sm bg-[var(--accent)]" /> already committed (accepted offers)</span>
          </div>
          {hover ? (
            <div className="flex items-center gap-2">
              <b>{hover.label}</b> want {mw(hover.desired_mw)} · gap <b>{mw(hover.gap_mw)}</b> · ceiling ₹{num(hover.price_ceiling_rs_mwh)}/MWh <NeedChip level={hover.level} />
            </div>
          ) : <span className="text-[11px] text-[var(--muted)]">Click an hour to offer for that window</span>}
        </div>
      </Panel>
      <Panel title="What the SLDC offers — programmes" pad={false}>
        <div className="grid min-h-0 flex-1 grid-cols-2 grid-rows-2 gap-2 p-2">
          {d.programmes.map((p: any) => (
            <div key={p.id} className="flex min-h-0 flex-col rounded-lg border border-[var(--line)] bg-white p-2.5 text-xs">
              <div className="flex items-start justify-between gap-1">
                <div className="font-semibold leading-tight">{p.name}</div>
                <Chip tone={p.status === 'OPEN' ? 'ok' : 'neutral'} icon={p.status === 'OPEN'}>{p.status}</Chip>
              </div>
              <div className="mt-0.5 text-[11px] text-[var(--muted)]">{p.summary}</div>
              <div className="mt-1.5 grid grid-cols-2 gap-x-2 text-[11px]">
                <span className="text-[var(--muted)]">Window</span><span>{hourWindow(p.window)}</span>
                <span className="text-[var(--muted)]">Response</span><span>≤ {p.max_response_min} min</span>
                <span className="text-[var(--muted)]">Duration</span><span>{p.duration_min[0]}–{p.duration_min[1]} min</span>
                <span className="text-[var(--muted)]">Energy</span><span>≤ ₹{num(p.energy_cap_rs_mwh)}/MWh</span>
                <span className="text-[var(--muted)]">Availability</span><span>{p.availability_rs_mw_h[1] ? `₹${p.availability_rs_mw_h[0]}–${p.availability_rs_mw_h[1]}/MW·h` : '—'}</span>
                <span className="text-[var(--muted)]">Min / type</span><span>{p.min_mw} MW · {p.type}</span>
              </div>
              <div className="mt-2 min-h-0 overflow-hidden text-[10px] text-[var(--muted)]">
                <div className="mb-0.5 uppercase tracking-wider">Requirements</div>
                {p.requirements.map((r: string) => <div key={r}>✓ {r}</div>)}
                <div className="mt-1">{p.settlement}</div>
              </div>
              <div className="mt-auto flex items-center justify-between pt-1.5">
                <span className="text-[10px] text-[var(--muted)]">max {p.max_activations_day}/day</span>
                {p.status === 'OPEN'
                  ? <Btn small kind="primary" onClick={() => startOffer({ programme: p.id, start_h: p.window[0], end_h: p.window[1], response_min: Math.min(10, p.max_response_min), max_duration_min: p.duration_min[1], price_rs_mwh: Math.round(p.energy_cap_rs_mwh * 0.8), availability_rs_mw_h: p.availability_rs_mw_h[0] })}>Offer</Btn>
                  : <Btn small onClick={() => go('enrolment')}>Express interest</Btn>}
              </div>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

/* ----------------------------------------------------------------- offers */

function Offers({ d, act, startOffer }: { d: any; act: any; startOffer: (p?: any) => void }) {
  if (!d.participant) return <Enrolment d={d} act={act} />;
  const prog = (id: string) => d.programmes.find((p: any) => p.id === id)?.name ?? id;
  return (
    <div className="grid h-full grid-cols-[1fr_20rem] gap-3">
      <Panel title="My flexibility offers" right={<Btn small kind="primary" onClick={() => startOffer()}>+ New offer</Btn>}>
        <FitList items={[...d.offers].reverse()} rowHeight={46} keyOf={(o: any) => o.id} empty="No offers yet"
          header={<div className="grid grid-cols-[7rem_1.4fr_4rem_7rem_6rem_6rem_6rem_9rem] gap-2 border-b border-[var(--line)] pb-1 text-[10px] uppercase tracking-wider text-[var(--muted)]">
            <span>Offer</span><span>Programme</span><span className="text-right">MW</span><span>Window</span><span className="text-right">Response</span><span className="text-right">₹/MWh</span><span className="text-right">Avail</span><span>Status</span></div>}
          render={(o: any) => (
            <div className="grid grid-cols-[7rem_1.4fr_4rem_7rem_6rem_6rem_6rem_9rem] items-center gap-2 border-b border-[var(--line)] text-xs">
              <span className="truncate text-[var(--muted)]">{o.id}</span>
              <div className="min-w-0"><div className="truncate">{prog(o.programme_id)}</div><div className="truncate text-[10px] text-[var(--muted)]">{o.restrictions}</div></div>
              <span className="text-right tabular-nums">{o.mw}</span>
              <span className="tabular-nums">{hourWindow(o.window)}</span>
              <span className="text-right tabular-nums">{o.response_min} min</span>
              <span className="text-right tabular-nums">{num(o.price_rs_mwh)}</span>
              <span className="text-right tabular-nums">{o.availability_rs_mw_h || '—'}</span>
              <span className="flex items-center gap-1">
                <Chip tone={o.status === 'ACCEPTED' ? 'ok' : o.status === 'PENDING' ? 'info' : 'neutral'}>{o.status}</Chip>
                {(o.status === 'PENDING' || o.status === 'ACCEPTED') && <Btn small kind="ghost" onClick={() => act('withdraw', { id: o.id }, 'Offer withdrawn')}>Withdraw</Btn>}
              </span>
            </div>
          )} />
      </Panel>
      <Panel title="How offers work">
        <ol className="list-decimal space-y-1.5 pl-4 text-xs">
          <li>You declare an <b>envelope</b> — MW, window, response, duration, price — never an off-switch.</li>
          <li>Committed programme offers are accepted under the programme; voluntary offers wait for an SLDC operator.</li>
          <li>The SLDC dispatches you <b>only inside an accepted offer, on its terms</b>. Batteries go first; industry is the preferred response after them.</li>
          <li>Delivery is verified from your revenue meter against your baseline: V = min(baseline − meter, accepted).</li>
          <li>Pay = verified MWh × price + availability, with a performance factor below 90% of accepted energy. You can dispute any record.</li>
        </ol>
        <div className="mt-auto rounded-lg bg-[var(--chip)] p-2 text-[11px] text-[var(--muted)]">Programme values are demonstration data; the approved programme and State Commission regulations govern participation, baselines and compensation.</div>
      </Panel>
    </div>
  );
}

function OfferModal({ draft, setDraft, d, act }: { draft: any; setDraft: (v: any) => void; d: any; act: any }) {
  const prog = useMemo(() => d?.programmes.find((p: any) => p.id === draft?.programme), [d, draft?.programme]);
  if (!draft) return null;
  const set = (k: string) => (e: any) => setDraft({ ...draft, [k]: e.target.value });
  const flex = d.participant?.flexible_mw ?? 0;
  const submit = async () => {
    const r = await act('offer', {
      ...draft, mw: +draft.mw, start_h: +draft.start_h, end_h: +draft.end_h, response_min: +draft.response_min,
      max_duration_min: +draft.max_duration_min, price_rs_mwh: +draft.price_rs_mwh, availability_rs_mw_h: +draft.availability_rs_mw_h,
    }, 'Offer submitted to the SLDC');
    if (r) setDraft(null);
  };
  return (
    <Modal open onClose={() => setDraft(null)} title="New flexibility offer" width="max-w-2xl">
      <div className="grid grid-cols-3 gap-3">
        <Field label="Programme">
          <select className={inputCls} value={draft.programme} onChange={set('programme')}>
            {d.programmes.filter((p: any) => p.status === 'OPEN').map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        <Field label="MW offered" hint={`min ${prog?.min_mw ?? '—'} · your range ${flex} MW`}><input className={inputCls} value={draft.mw} onChange={set('mw')} inputMode="decimal" /></Field>
        <Field label="Restrictions"><input className={inputCls} value={draft.restrictions} onChange={set('restrictions')} placeholder="e.g. not during curing" /></Field>
        <Field label="Window from (h)" hint={prog ? `programme ${hourWindow(prog.window)}` : undefined}><input className={inputCls} value={draft.start_h} onChange={set('start_h')} inputMode="decimal" /></Field>
        <Field label="Window to (h)"><input className={inputCls} value={draft.end_h} onChange={set('end_h')} inputMode="decimal" /></Field>
        <Field label="Response (min)" hint={`≤ ${prog?.max_response_min ?? '—'} min`}><input className={inputCls} value={draft.response_min} onChange={set('response_min')} inputMode="decimal" /></Field>
        <Field label="Max duration (min)" hint={prog ? `${prog.duration_min[0]}–${prog.duration_min[1]} min` : undefined}><input className={inputCls} value={draft.max_duration_min} onChange={set('max_duration_min')} inputMode="decimal" /></Field>
        <Field label="Energy price ₹/MWh" hint={`cap ₹${num(prog?.energy_cap_rs_mwh)}`}><input className={inputCls} value={draft.price_rs_mwh} onChange={set('price_rs_mwh')} inputMode="decimal" /></Field>
        <Field label="Availability ₹/MW·h" hint={prog?.availability_rs_mw_h[1] ? `₹${prog.availability_rs_mw_h[0]}–${prog.availability_rs_mw_h[1]}` : 'not paid in this programme'}><input className={inputCls} value={draft.availability_rs_mw_h} onChange={set('availability_rs_mw_h')} inputMode="decimal" /></Field>
      </div>
      <div className="mt-3 rounded-lg bg-[var(--chip)] p-2 text-[11px] text-[var(--muted)]">
        Indicative value: {draft.mw} MW for one hour verified at ₹{num(+draft.price_rs_mwh)}/MWh ≈ <b className="text-[var(--fg)]">{rs(+draft.mw * +draft.price_rs_mwh)}</b>{+draft.availability_rs_mw_h ? ` + availability ${rs(+draft.mw * +draft.availability_rs_mw_h)}/h` : ''}. Payment depends on verified delivery.
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <Btn onClick={() => setDraft(null)}>Cancel</Btn>
        <Btn kind="primary" onClick={submit}>Submit offer</Btn>
      </div>
    </Modal>
  );
}

/* ----------------------------------------------------------------- dispatch & delivery */

function Dispatch({ d }: { d: any }) {
  if (!d.participant) return <Enrolment d={d} act={null} />;
  const p = d.participant;
  return (
    <div className="grid h-full grid-cols-[1fr_22rem] gap-3">
      <Panel title="Dispatch instructions to my gateway">
        <FitList items={d.dispatches} rowHeight={40} keyOf={(c: any) => c.id} empty="No instructions yet"
          header={<div className="grid grid-cols-[7rem_6rem_5rem_5rem_9rem_1fr] gap-2 border-b border-[var(--line)] pb-1 text-[10px] uppercase tracking-wider text-[var(--muted)]">
            <span>Instruction</span><span>Event</span><span className="text-right">Setpoint</span><span>Kind</span><span>State</span><span>Ack · first response · full output (s from send)</span></div>}
          render={(c: any) => (
            <div className="grid grid-cols-[7rem_6rem_5rem_5rem_9rem_1fr] items-center gap-2 border-b border-[var(--line)] text-xs">
              <span className="truncate text-[var(--muted)]">{c.id}</span><span className="truncate">{c.event}</span>
              <span className="text-right tabular-nums">{c.setpoint.toFixed(0)} MW</span><span>{c.kind}</span>
              <span><Chip tone={cmdTone(c.state)}>{c.state.replace('AWAITING_APPROVAL', 'SLDC APPROVAL')}</Chip></span>
              <span className="tabular-nums">{c.clocks.ack_s ?? '—'} · {c.clocks.first_s ?? '—'} · {c.clocks.full_s ?? '—'}</span>
            </div>
          )} />
      </Panel>
      <div className="flex min-h-0 flex-col gap-3">
        <Panel title="Live delivery">
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Instructed" value={mw(p.instructed_mw)} />
            <Stat label="Delivering (gateway)" value={mw(p.delivering_mw)} tone={p.delivering_mw > 0.5 ? 'ok' : 'neutral'} />
            <Stat label="Baseline" value={mw(p.baseline)} />
            <Stat label="Meter" value={mw(p.meter)} sub={`reduction ${mw(Math.max(0, p.baseline - p.meter))}`} />
          </div>
        </Panel>
        <Panel title="What counts" className="flex-1">
          <ul className="space-y-1.5 text-xs">
            <li><b>Acknowledgement</b> is a comms receipt, not delivery.</li>
            <li><b>First response</b> = 10% of the way to setpoint; <b>full output</b> = 90%.</li>
            <li><b>Delivered energy</b> is verified from the revenue meter against your baseline — the settlement of record.</li>
            <li>Commands are HMAC-authenticated; your gateway rejects unknown keys, stale or replayed messages.</li>
          </ul>
        </Panel>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- settlements */

function Settlements({ d, act }: { d: any; act: any }) {
  const [reason, setReason] = useState('');
  const [open, setOpen] = useState<any>(null);
  if (!d.participant) return <Enrolment d={d} act={act} />;
  return (
    <div className="grid h-full grid-cols-[1fr_22rem] gap-3">
      <Panel title="Verified delivery & payment, per event">
        <FitList items={d.records} rowHeight={64} keyOf={(r: any) => r.id} empty="No events settled yet"
          render={(r: any) => (
            <div className="grid grid-cols-[1.1fr_2fr_1.2fr_8rem] items-center gap-3 border-b border-[var(--line)] text-xs">
              <div><div className="font-medium">{r.event}</div><div className="text-[10px] text-[var(--muted)]">{r.id} · offer {r.offer} · ₹{num(r.price_rs_mwh)}/MWh</div></div>
              <div className="flex gap-1 overflow-hidden">{r.blocks.map((b: any, i: number) => (
                <div key={i} className="shrink-0 rounded border border-[var(--line)] px-1.5 py-0.5 text-[10px] leading-tight" title="B baseline · M meter · R=max(0,B−M) · A accepted · V=min(R,A)">
                  <div className="text-[var(--muted)]">{hhmm(b.t)}</div><div className="tabular-nums">R {b.R} · A {b.A}</div><div className="tabular-nums font-semibold">V {b.V}</div>
                </div>))}</div>
              <div className="text-[11px]">
                <div>E <b>{r.totals.E_mwh}</b> / {r.totals.accepted_mwh} MWh · PF {r.totals.PF}</div>
                <div>energy {rs(r.totals.energy_rs)} + avail {rs(r.totals.availability_rs)} {r.totals.pf_adjustment_rs ? `− ${rs(-r.totals.pf_adjustment_rs)}` : ''}</div>
                <div className="font-semibold">= {rs(r.totals.payment_rs)}{r.totals.held && <span className="text-[var(--warn)]"> (held)</span>}</div>
              </div>
              <div className="flex flex-col items-end gap-1">
                <Chip tone={r.status === 'DISPUTED' ? 'warn' : r.status === 'SETTLED' || r.status === 'RESOLVED' ? 'ok' : 'neutral'}>{r.status}</Chip>
                {r.status !== 'DISPUTED' && <Btn small kind="ghost" onClick={() => setOpen(r)}>Dispute</Btn>}
              </div>
            </div>
          )} />
      </Panel>
      <Panel title="Baseline method">
        <div className="space-y-1.5 text-xs">
          <div><b>{d.baseline_method}</b></div>
          <div>B = mean metered demand over the 4 blocks before the event, bounded to ±10% of your declared level.</div>
          <div>R = max(0, B − M) · A = dispatched MW capped at your offer (counted after your response time) · V = min(R, A).</div>
          <div>PF = 1 at ≥ 90% of accepted energy, linear 50–90%, 0 at ≤ 50%.</div>
          <div className="text-[var(--muted)]">A baseline-vs-meter difference is not automatically proof of delivery: any record can be disputed (payment held) and is resolved with an audited adjustment.</div>
        </div>
      </Panel>
      <Modal open={!!open} onClose={() => setOpen(null)} title={`Dispute ${open?.id ?? ''}`}>
        <Field label="Reason"><textarea className={cx(inputCls, 'h-24')} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. meter reading in block 2 excludes captive generation" /></Field>
        <div className="mt-3 flex justify-end gap-2">
          <Btn onClick={() => setOpen(null)}>Cancel</Btn>
          <Btn kind="primary" disabled={!reason.trim()} onClick={async () => { if (await act('dispute', { id: open.id, reason }, 'Dispute raised — payment held')) { setOpen(null); setReason(''); } }}>Raise dispute</Btn>
        </div>
      </Modal>
    </div>
  );
}

/* ----------------------------------------------------------------- enrolment */

function Enrolment({ d, act }: { d: any; act: any }) {
  const p = d.participant;
  const [f, setF] = useState({ company: '', discom: 'BESCOM', sector: '', flexible_mw: '', contact: '', processes: '', programmes: [] as string[] });
  const fallbackAct = useAct('/api/industry/');
  const doAct = act ?? fallbackAct;
  if (p) {
    return (
      <div className="grid h-full grid-cols-[1fr_1fr] gap-3">
        <Panel title={`${p.name} — declared flexibility envelope`}>
          <div className="mb-2 grid grid-cols-3 gap-3"><Stat label="Declared demand" value={mw(p.declared_mw)} /><Stat label="Flexible range" value={mw(p.flexible_mw)} /><Stat label="DISCOM" value={p.discom} /></div>
          <FitList items={p.processes} rowHeight={38} render={(x: any) => (
            <div className="grid grid-cols-[1.6fr_4rem_5rem_5rem_1.4fr] items-center gap-2 border-b border-[var(--line)] text-xs">
              <span className="font-medium">{x.name}</span><span className="text-right tabular-nums">{x.mw} MW</span>
              <span className="text-right tabular-nums">{x.response_min} min</span><span className="text-right tabular-nums">{x.duration_min} min</span>
              <span className="truncate text-[var(--muted)]">{x.restriction}</span>
            </div>
          )} />
        </Panel>
        <Panel title="Programme requirements checklist">
          {d.programmes.filter((x: any) => x.status === 'OPEN').map((x: any) => (
            <div key={x.id} className="mb-2 text-xs"><div className="font-medium">{x.name}</div>
              <div className="flex flex-wrap gap-1 pt-0.5">{x.requirements.map((r: string) => <Chip key={r} tone="ok">{r}</Chip>)}</div></div>
          ))}
          <div className="mt-auto text-[11px] text-[var(--muted)]">To change your declared processes, contact the SLDC programme desk; changes are audited.</div>
        </Panel>
      </div>
    );
  }
  const toggle = (id: string) => setF({ ...f, programmes: f.programmes.includes(id) ? f.programmes.filter((x) => x !== id) : [...f.programmes, id] });
  return (
    <div className="grid h-full grid-cols-[1.2fr_1fr] gap-3">
      <Panel title="Apply to join SLDC demand response">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Company / site"><input className={inputCls} value={f.company} onChange={(e) => setF({ ...f, company: e.target.value })} /></Field>
          <Field label="DISCOM"><select className={inputCls} value={f.discom} onChange={(e) => setF({ ...f, discom: e.target.value })}>{['BESCOM', 'CESC', 'MESCOM', 'HESCOM', 'GESCOM'].map((x) => <option key={x}>{x}</option>)}</select></Field>
          <Field label="Sector"><input className={inputCls} value={f.sector} onChange={(e) => setF({ ...f, sector: e.target.value })} placeholder="Steel, cement, data centre…" /></Field>
          <Field label="Flexible MW (estimate)"><input className={inputCls} value={f.flexible_mw} onChange={(e) => setF({ ...f, flexible_mw: e.target.value })} inputMode="decimal" /></Field>
          <Field label="Contact (email / phone)"><input className={inputCls} value={f.contact} onChange={(e) => setF({ ...f, contact: e.target.value })} /></Field>
          <Field label="Flexible processes"><input className={inputCls} value={f.processes} onChange={(e) => setF({ ...f, processes: e.target.value })} placeholder="e.g. arc furnace reschedule 30 MW" /></Field>
        </div>
        <div className="mt-3 text-[11px] text-[var(--muted)]">Programmes of interest</div>
        <div className="mt-1 flex flex-wrap gap-1.5">{d.programmes.map((x: any) => (
          <Btn key={x.id} small kind={f.programmes.includes(x.id) ? 'primary' : 'default'} onClick={() => toggle(x.id)}>{x.name}</Btn>))}</div>
        <div className="mt-auto flex justify-end pt-3">
          <Btn kind="primary" onClick={async () => { if (await doAct('apply', f, 'Application submitted to the SLDC programme desk')) setF({ ...f, company: '', flexible_mw: '', processes: '' }); }}>Submit application</Btn>
        </div>
      </Panel>
      <Panel title="My applications">
        <FitList items={d.applications} rowHeight={40} empty="No applications yet" render={(a: any) => (
          <div className="flex items-center justify-between border-b border-[var(--line)] text-xs">
            <div><div className="font-medium">{a.company}</div><div className="text-[10px] text-[var(--muted)]">{a.id} · {a.flexible_mw} MW · {a.discom}</div></div>
            <Chip tone={a.status === 'ACCEPTED_FOR_ONBOARDING' ? 'ok' : 'info'}>{a.status.replace(/_/g, ' ')}</Chip>
          </div>
        )} />
        <div className="text-[11px] text-[var(--muted)]">After onboarding you receive a participant login, a gateway key and a revenue-meter check.</div>
      </Panel>
    </div>
  );
}
