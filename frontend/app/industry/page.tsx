'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Brand, Btn, Card, Chart, Chip, Empty, Field, FitList, Icon, KV, Modal, Popover, Ring, SegBar, Stat, THead, TRow, ToastHost, cmdTone, cx, inputCls, useAct } from '@/components/ui';
import { Claims, claims, setToken, usePoll } from '@/lib/api';
import { hhmm, hourWindow, mw, num, pct, rs, rsShort } from '@/lib/fmt';

type View = 'home' | 'market' | 'offers' | 'delivery' | 'earnings' | 'plan';

export default function IndustryPage() {
  const router = useRouter();
  const [user, setUser] = useState<Claims | null>(null);
  useEffect(() => {
    const c = claims();
    if (!c) router.replace('/');
    else if (c.role !== 'industry') router.replace('/console');
    else setUser(c);
  }, [router]);
  if (!user) return <div className="theme-portal h-screen w-screen bg-[var(--bg)]" />;
  return (
    <ToastHost>
      <Portal user={user} onLogout={() => { setToken(null); router.replace('/'); }} />
    </ToastHost>
  );
}

/** Merge consecutive hours with an uncovered gap into request windows. */
function requests(needs: any[]) {
  const out: any[] = [];
  for (const n of needs) {
    const last = out[out.length - 1];
    if (n.gap_mw > 0 && last && last.end === n.hour && last.open) {
      last.end = (n.hour + 1) % 24 || 24;
      last.peak = Math.max(last.peak, n.gap_mw);
      last.wanted = Math.max(last.wanted, n.desired_mw);
      last.ceiling = Math.max(last.ceiling, n.price_ceiling_rs_mwh);
      last.level = n.level === 'HIGH' || last.level === 'HIGH' ? 'HIGH' : last.level;
      last.programmes = Array.from(new Set([...last.programmes, ...n.programmes]));
    } else if (n.gap_mw > 0) {
      out.push({ start: n.hour, end: (n.hour + 1) % 24 || 24, peak: n.gap_mw, wanted: n.desired_mw, ceiling: n.price_ceiling_rs_mwh, level: n.level, programmes: [...n.programmes], open: true });
    } else if (last) last.open = false;
  }
  return out;
}

function Portal({ user, onLogout }: { user: Claims; onLogout: () => void }) {
  const { data: d, reload } = usePoll<any>('/api/industry/portal', 2000);
  const [view, setView] = useState<View>('home');
  const [draft, setDraft] = useState<any>(null);
  const act = useAct('/api/industry/', reload);
  const enrolled = !!d?.participant;

  const startOffer = useCallback((prefill: any = {}) => {
    if (!enrolled) return setView('plan');
    setDraft({ programme: 'PRG-EVE', mw: 20, start_h: 18, end_h: 22, response_min: 10, max_duration_min: 60, price_rs_mwh: 5000, availability_rs_mw_h: 0, restrictions: '', ...prefill });
  }, [enrolled]);

  if (!d) return <div className="theme-portal grid h-screen w-screen place-items-center bg-[var(--bg)] text-sm text-[var(--muted)]">Loading portal…</div>;
  const ins = d.instruction;
  const cond = d.grid_status.condition;
  const nav: { id: View; label: string; icon: string; badge?: React.ReactNode }[] = [
    { id: 'home', label: 'Home', icon: 'overview' },
    { id: 'market', label: 'Marketplace', icon: 'market', badge: <span className="num rounded bg-[var(--accent-soft)] px-1 text-[10px] font-bold text-[var(--accent-ink)]">{requests(d.needs).length}</span> },
    { id: 'offers', label: 'My offers', icon: 'doc' },
    { id: 'delivery', label: 'Delivery', icon: 'event', badge: ins ? <span className="h-1.5 w-1.5 rounded-full bg-[var(--warn)]" /> : null },
    { id: 'earnings', label: 'Earnings', icon: 'wallet' },
    { id: 'plan', label: enrolled ? 'Energy plan' : 'Enrol', icon: 'factory' },
  ];

  return (
    <div className="theme-portal flex h-screen w-screen flex-col overflow-hidden bg-[var(--bg)] text-[var(--fg)]">
      <header className="flex h-14 shrink-0 items-center gap-4 border-b border-[var(--line)] bg-white px-4">
        <div className="flex shrink-0 items-center gap-2.5">
          <Brand size="sm" tag="Demand Response" />
          <span className="rounded-full border border-[var(--accent-line)] px-2 py-0.5 text-[11px] font-semibold text-[var(--accent-ink)]">Industry portal</span>
        </div>
        <nav className="flex min-w-0 flex-1 items-center justify-center gap-1" aria-label="Portal">
          {nav.map((n) => (
            <button key={n.id} onClick={() => setView(n.id)} aria-current={view === n.id ? 'page' : undefined}
              className={cx('relative flex h-9 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium transition',
                view === n.id ? 'bg-[var(--accent-soft)] text-[var(--accent-ink)]' : 'text-[var(--muted)] hover:bg-[var(--chip)] hover:text-[var(--fg)]')}>
              <Icon name={n.icon} size={15} />{n.label}{n.badge}
            </button>
          ))}
        </nav>
        <div className="flex shrink-0 items-center gap-2">
          <Chip tone={cond === 'EMERGENCY' ? 'alarm' : cond === 'TIGHT' ? 'warn' : 'neutral'} glyph={cond !== 'NORMAL'}>Grid {cond.toLowerCase()}</Chip>
          <span className="num text-xs text-[var(--muted)]">{d.clock.hhmm}</span>
          <Btn kind="primary" icon="plus" onClick={() => startOffer()}>New offer</Btn>
          <Popover width="w-64" label={<span className="grid h-6 w-6 place-items-center rounded-full bg-[var(--accent-soft)] text-[10px] font-bold uppercase text-[var(--accent-ink)]">{user.sub.slice(0, 2)}</span>}>
            <div className="space-y-1 p-1 text-xs">
              <div className="font-semibold">{d.user.name}</div>
              <div className="text-[var(--muted)]">{d.user.participant ? `Participant ${d.user.participant}` : 'Not yet enrolled'}</div>
              <Btn small icon="logout" onClick={onLogout} className="mt-1 w-full">Sign out</Btn>
            </div>
          </Popover>
        </div>
      </header>

      {ins && <PerformanceBar d={d} onOpen={() => setView('delivery')} />}

      <main className="min-h-0 flex-1 p-3">
        {view === 'home' && (enrolled ? <Home d={d} go={setView} startOffer={startOffer} /> : <Plan d={d} act={act} />)}
        {view === 'market' && <Market d={d} startOffer={startOffer} go={setView} />}
        {view === 'offers' && (enrolled ? <Offers d={d} act={act} startOffer={startOffer} /> : <Plan d={d} act={act} />)}
        {view === 'delivery' && (enrolled ? <Delivery d={d} /> : <Plan d={d} act={act} />)}
        {view === 'earnings' && (enrolled ? <Earnings d={d} act={act} /> : <Plan d={d} act={act} />)}
        {view === 'plan' && <Plan d={d} act={act} />}
      </main>
      <OfferModal draft={draft} setDraft={setDraft} d={d} act={act} />
    </div>
  );
}

/* ----------------------------------------------------------------- live event performance (EnerNOC-style) */

function PerformanceBar({ d, onOpen }: { d: any; onOpen: () => void }) {
  const ins = d.instruction, p = d.participant;
  const target = ins.setpoint;
  const reduction = Math.max(0, p.baseline - p.meter);
  const ratio = target > 0 ? reduction / target : 0;
  const waiting = ins.state === 'AWAITING_APPROVAL' || ins.state === 'READY';
  return (
    <div className="flex shrink-0 items-center gap-4 border-b border-[var(--warn)]/30 bg-[var(--warn-bg)] px-4 py-2">
      <Icon name="event" size={18} className="text-[var(--warn)]" />
      <div className="min-w-0">
        <div className="text-[13px] font-semibold">{waiting ? 'Dispatch proposed — awaiting SLDC approval' : 'Live DR event — reduce load'} · target {mw(target)}</div>
        <div className="num text-[11px] text-[var(--fg-dim)]">Event {ins.event} · {ins.state.replace('_', ' ').toLowerCase()}{ins.clocks.ack_s != null && ` · gateway ack ${ins.clocks.ack_s} s`}{ins.clocks.full_s != null && ` · full output ${ins.clocks.full_s} s`}</div>
      </div>
      <div className="ml-auto flex w-[38%] items-center gap-3">
        <div className="flex-1">
          <div className="num mb-1 flex justify-between text-[11px]"><span>Reduction vs baseline <b>{mw(reduction)}</b></span><span className={ratio >= 0.9 ? 'text-[var(--ok)]' : ratio > 0.5 ? '' : 'text-[var(--warn)]'}>{pct(Math.min(ratio, 1.5))} of target</span></div>
          <SegBar height={8} total={Math.max(target, reduction, 1)} parts={[{ v: reduction, color: ratio >= 0.9 ? 'var(--ok)' : 'var(--warn)' }]} />
        </div>
        <Btn small onClick={onOpen}>Details</Btn>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- Home */

function Home({ d, go, startOffer }: { d: any; go: (v: View) => void; startOffer: (p?: any) => void }) {
  const p = d.participant, e = d.earnings;
  const reqs = requests(d.needs).slice(0, 4);
  const hist = [...d.meter_history, p.meter];
  const offerNow = d.offers.find((o: any) => o.id === p.offer_now);
  return (
    <div className="grid h-full grid-cols-[1fr_360px] grid-rows-[auto_1fr] gap-3">
      <div className="col-span-2 grid grid-cols-5 gap-3">
        <div className="card flex items-center gap-3 px-4 py-3">
          <Icon name="wallet" size={22} className="text-[var(--accent-ink)]" />
          <Stat label="Earned (settled)" value={rsShort(e.settled_rs)} tone="ok" />
        </div>
        <div className="card px-4 py-3"><Stat label="Pending settlement" value={rsShort(e.open_rs)} sub={e.held_rs ? `${rsShort(e.held_rs)} held in dispute` : 'verified by baseline M&V'} /></div>
        <div className="card px-4 py-3"><Stat label="Verified energy" value={`${e.verified_mwh} MWh`} sub="reduction delivered" /></div>
        <div className="card flex items-center gap-3 px-4 py-3">
          <Ring value={p.reliability} size={46} stroke={5} tone={p.reliability >= 0.9 ? 'ok' : 'warn'}><span className="num text-[11px] font-semibold">{Math.round(p.reliability * 100)}</span></Ring>
          <Stat label="Reliability score" value={pct(p.reliability, 1)} sub="learned from delivery" />
        </div>
        <div className="card px-4 py-3"><Stat label="Offer in force now" value={offerNow ? mw(offerNow.mw) : '—'} sub={offerNow ? `${offerNow.id} · ₹${num(offerNow.price_rs_mwh)}/MWh` : p.offer_status} /></div>
      </div>
      <Card title={d.instruction ? 'Live performance vs target' : 'My site load vs baseline'} icon="target"
        sub="revenue meter, 15-min blocks · baseline B4-mean ±10%"
        right={<span className="num flex gap-3 text-[11px] text-[var(--muted)]"><span>baseline <b className="text-[var(--fg)]">{mw(p.baseline)}</b></span><span>meter <b className="text-[var(--fg)]">{mw(p.meter)}</b></span>{p.instructed_mw > 0 && <span>target <b className="text-[var(--fg)]">{mw(p.baseline - p.instructed_mw)}</b></span>}</span>}>
        {hist.length >= 2 ? (
          <div className="min-h-0 flex-1">
            <Chart labels={hist.map((_: number, i: number) => (i === hist.length - 1 ? 'now' : `−${hist.length - 1 - i} blk`))}
              series={[
                { values: hist, color: 'var(--accent)', label: 'Meter' },
                { values: hist.map(() => p.baseline), color: 'var(--muted)', label: 'Baseline', dash: true },
                ...(p.instructed_mw > 0 ? [{ values: hist.map(() => p.baseline - p.instructed_mw), color: 'var(--warn)', label: 'Target', dash: true }] : []),
              ]} />
          </div>
        ) : <Empty icon="clock">Collecting block data — this chart fills as 15-minute blocks close.</Empty>}
        <div className="flex gap-4 pt-1 text-[11px] text-[var(--muted)]"><span className="text-[var(--accent-ink)]">— metered demand</span><span>- - baseline</span>{p.instructed_mw > 0 && <span className="text-[var(--warn)]">- - target load</span>}</div>
      </Card>
      <Card title="SLDC requests for you" icon="market" right={<Btn small kind="ghost" onClick={() => go('market')}>Marketplace <Icon name="chevron" size={11} /></Btn>}>
        <div className="flex min-h-0 flex-1 flex-col gap-2">
          {reqs.length === 0 && <Empty>No uncovered need in the next 24 hours.</Empty>}
          {reqs.map((r, i) => <RequestCard key={i} r={r} compact onBid={() => startOffer(bidPrefill(r))} />)}
        </div>
      </Card>
    </div>
  );
}

const bidPrefill = (r: any) => ({
  start_h: r.start, end_h: r.end, programme: r.programmes.includes('PRG-EVE') ? 'PRG-EVE' : r.programmes[0] ?? 'PRG-DAY',
  price_rs_mwh: Math.min(r.ceiling || 4000, 6000),
});

function RequestCard({ r, onBid, compact, mine = 0, progs = [] }: { r: any; onBid: () => void; compact?: boolean; mine?: number; progs?: any[] }) {
  return (
    <div className={cx('rounded-lg border border-[var(--line)] bg-white', compact ? 'p-2.5' : 'p-3')}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="num text-[13px] font-semibold">{hourWindow([r.start, r.end])}</div>
          <div className="num text-[11px] text-[var(--muted)]">SLDC wants up to {mw(r.wanted)} · uncovered {mw(r.peak)}</div>
        </div>
        <Chip tone={r.level === 'HIGH' ? 'warn' : r.level === 'MEDIUM' ? 'p3' : 'neutral'}>{r.level} need</Chip>
      </div>
      {!compact && (
        <div className="mt-2 flex flex-wrap items-center gap-1">
          {r.programmes.map((id: string) => <Chip key={id}>{progs.find((p: any) => p.id === id)?.name ?? id}</Chip>)}
          <span className="num ml-auto text-[11px] text-[var(--muted)]">your accepted offers here: <b className="text-[var(--fg)]">{mw(mine)}</b></span>
        </div>
      )}
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="num text-[11px] text-[var(--fg-dim)]">value to SLDC ≤ <b>₹{num(r.ceiling)}</b>/MWh</span>
        <Btn small kind="primary" onClick={onBid}>Bid</Btn>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- Marketplace */

function Market({ d, startOffer, go }: { d: any; startOffer: (p?: any) => void; go: (v: View) => void }) {
  const [hover, setHover] = useState<any>(null);
  const reqs = requests(d.needs);
  const max = Math.max(1, ...d.needs.map((n: any) => Math.max(n.desired_mw, n.committed_mw)));
  return (
    <div className="grid h-full grid-cols-[1fr_400px] grid-rows-[46%_1fr] gap-3">
      <Card title="SLDC demand for flexibility · next 24 hours" icon="forecast" className="col-span-2"
        sub="indicative, from the day-ahead net-demand profile and forecast-error reserve"
        right={<span className="flex gap-3 text-[11px] text-[var(--muted)]"><span><i className="mr-1 inline-block h-2 w-3 rounded-sm bg-[var(--chip-hover)]" />wanted</span><span><i className="mr-1 inline-block h-2 w-3 rounded-sm bg-[var(--accent)]" />committed by accepted offers</span></span>}>
        <div className="flex min-h-0 flex-1 items-end gap-[3px]">
          {d.needs.map((n: any) => (
            <button key={n.hour} onMouseEnter={() => setHover(n)} onFocus={() => setHover(n)} onClick={() => n.desired_mw && startOffer(bidPrefill({ start: n.hour, end: (n.hour + 2) % 24 || 24, programmes: n.programmes, ceiling: n.price_ceiling_rs_mwh }))}
              className="group flex h-full min-w-0 flex-1 flex-col justify-end" aria-label={`${n.label}: wanted ${n.desired_mw} MW`}>
              <div className="relative w-full" style={{ height: `${(n.desired_mw / max) * 100}%` }}>
                <div className={cx('absolute inset-0 rounded-t-md', hover?.hour === n.hour ? 'bg-[var(--accent)]/25' : 'bg-[var(--chip-hover)]')} />
                <div className="absolute inset-x-0 bottom-0 rounded-t-md bg-[var(--accent)]" style={{ height: `${n.desired_mw ? Math.min(100, (n.committed_mw / n.desired_mw) * 100) : 0}%` }} />
              </div>
              <div className={cx('num mt-1 text-center text-[10px]', hover?.hour === n.hour ? 'font-bold text-[var(--fg)]' : 'text-[var(--muted)]')}>{String(n.hour).padStart(2, '0')}</div>
            </button>
          ))}
        </div>
        <div className="num mt-2 h-5 text-xs">
          {hover ? <span><b>{hover.label}</b> · wanted {mw(hover.desired_mw)} · committed {mw(hover.committed_mw)} · gap <b>{mw(hover.gap_mw)}</b> · value ≤ ₹{num(hover.price_ceiling_rs_mwh)}/MWh — click to bid</span>
            : <span className="text-[var(--muted)]">Hover an hour for detail; click to bid for that window.</span>}
        </div>
      </Card>
      <Card title="Open requests" icon="market" sub={`${reqs.length} windows with uncovered need`}>
        <div className="grid min-h-0 flex-1 auto-rows-min grid-cols-2 gap-2 overflow-hidden">
          {reqs.length === 0 && <div className="col-span-2"><Empty>All needs are covered by accepted offers.</Empty></div>}
          {reqs.slice(0, 4).map((r, i) => {
            const mine = (d.offers ?? []).filter((o: any) => o.status === 'ACCEPTED' && o.window[0] < r.end && o.window[1] > r.start).reduce((a: number, o: any) => a + o.mw, 0);
            return <RequestCard key={i} r={r} mine={mine} progs={d.programmes} onBid={() => startOffer(bidPrefill(r))} />;
          })}
        </div>
        <div className="mt-2 rounded-lg bg-[var(--accent-soft)] px-3 py-2 text-[11px] text-[var(--fg-dim)]">
          Requests merge consecutive hours where the SLDC&apos;s wanted flexibility exceeds what accepted offers already cover. Bidding pre-fills an offer for that window; the SLDC accepts what it needs.
        </div>
      </Card>
      <Card title="Programmes the SLDC offers" icon="doc" pad={false}>
        <div className="min-h-0 flex-1 divide-y divide-[var(--line)] overflow-hidden">
          {d.programmes.map((p: any) => (
            <div key={p.id} className="flex items-center gap-3 px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2"><span className="truncate text-[13px] font-semibold">{p.name}</span><Chip tone={p.status === 'OPEN' ? 'ok' : 'neutral'}>{p.status}</Chip></div>
                <div className="num truncate text-[11px] text-[var(--muted)]">{hourWindow(p.window)} · ≤ {p.max_response_min} min · {p.duration_min[0]}–{p.duration_min[1]} min · ≤ ₹{num(p.energy_cap_rs_mwh)}/MWh{p.availability_rs_mw_h[1] ? ` · avail ₹${p.availability_rs_mw_h[0]}–${p.availability_rs_mw_h[1]}` : ''}</div>
              </div>
              {p.status === 'OPEN'
                ? <Btn small onClick={() => startOffer({ programme: p.id, start_h: p.window[0], end_h: p.window[1], response_min: Math.min(10, p.max_response_min), max_duration_min: p.duration_min[1], price_rs_mwh: Math.round(p.energy_cap_rs_mwh * 0.8), availability_rs_mw_h: p.availability_rs_mw_h[0] })}>Offer</Btn>
                : <Btn small kind="ghost" onClick={() => go('plan')}>Interest</Btn>}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

/* ----------------------------------------------------------------- My offers (kanban) */

function Offers({ d, act, startOffer }: { d: any; act: any; startOffer: (p?: any) => void }) {
  const prog = (id: string) => d.programmes.find((p: any) => p.id === id)?.name ?? id;
  const cols = [
    { k: 'PENDING', title: 'In SLDC review', tone: 'info' as const, items: d.offers.filter((o: any) => o.status === 'PENDING') },
    { k: 'ACCEPTED', title: 'Accepted · dispatchable', tone: 'ok' as const, items: d.offers.filter((o: any) => o.status === 'ACCEPTED') },
    { k: 'CLOSED', title: 'Closed', tone: 'neutral' as const, items: d.offers.filter((o: any) => !['PENDING', 'ACCEPTED'].includes(o.status)) },
  ];
  return (
    <div className="grid h-full grid-cols-[1fr_1fr_1fr_300px] gap-3">
      {cols.map((c) => (
        <section key={c.k} className="flex min-h-0 flex-col rounded-xl bg-[var(--s3)] p-2">
          <header className="flex items-center justify-between px-1.5 pb-2"><span className="text-[13px] font-semibold">{c.title}</span><Chip tone={c.tone} glyph={false}>{c.items.length}</Chip></header>
          <FitList items={[...c.items].reverse()} rowHeight={128} empty={c.k === 'PENDING' ? 'Nothing in review.' : c.k === 'ACCEPTED' ? 'No accepted offers.' : 'Nothing closed.'}
            render={(o: any) => (
              <div className="card mb-2 h-[120px] p-3">
                <div className="flex items-start justify-between gap-2"><div className="num text-[15px] font-semibold">{mw(o.mw)} · {hourWindow(o.window)}</div><Chip tone={c.tone}>{o.status}</Chip></div>
                <div className="truncate text-[11px] text-[var(--muted)]">{prog(o.programme_id)} · {o.id}</div>
                <div className="num mt-2 grid grid-cols-3 gap-2 text-[11px]">
                  <span><span className="text-[var(--muted)]">Price</span><br />₹{num(o.price_rs_mwh)}</span>
                  <span><span className="text-[var(--muted)]">Response</span><br />{o.response_min} min</span>
                  <span><span className="text-[var(--muted)]">Max dur.</span><br />{o.max_duration_min} min</span>
                </div>
                <div className="mt-1.5 flex items-center justify-between"><span className="truncate text-[10px] text-[var(--muted)]">{o.restrictions}</span>
                  {(o.status === 'PENDING' || o.status === 'ACCEPTED') && <Btn small kind="ghost" onClick={() => act('withdraw', { id: o.id }, 'Offer withdrawn')}>Withdraw</Btn>}</div>
              </div>
            )} />
        </section>
      ))}
      <Card title="How offers work" icon="doc">
        <ol className="space-y-2 text-xs">
          {[
            ['Declare an envelope', 'MW, window, response, duration and price — never an off-switch.'],
            ['SLDC accepts', 'Committed programme offers are accepted under the programme; voluntary ones by an operator.'],
            ['Dispatch on your terms', 'Only inside an accepted offer. Batteries go first; industry is the preferred response after them.'],
            ['Verified delivery', 'V = min(baseline − meter, accepted) from your revenue meter.'],
            ['Payment', 'Verified MWh × price + availability; performance factor below 90%. Any record can be disputed.'],
          ].map(([t, x], i) => (
            <li key={t} className="flex gap-2"><span className="num grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[var(--accent-soft)] text-[10px] font-bold text-[var(--accent-ink)]">{i + 1}</span><span><b>{t}.</b> <span className="text-[var(--muted)]">{x}</span></span></li>
          ))}
        </ol>
        <Btn kind="primary" icon="plus" className="mt-auto" onClick={() => startOffer()}>New offer</Btn>
      </Card>
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
      <div className="mb-3 flex flex-wrap gap-1.5">
        {d.programmes.filter((p: any) => p.status === 'OPEN').map((p: any) => (
          <button key={p.id} onClick={() => setDraft({ ...draft, programme: p.id })}
            className={cx('rounded-lg border px-3 py-1.5 text-left text-xs', draft.programme === p.id ? 'border-[var(--accent)] bg-[var(--accent-soft)]' : 'border-[var(--line)] hover:bg-[var(--chip)]')}>
            <div className="font-semibold">{p.name}</div><div className="num text-[10px] text-[var(--muted)]">{hourWindow(p.window)} · ≤ ₹{num(p.energy_cap_rs_mwh)}/MWh</div>
          </button>
        ))}
      </div>
      <div className="grid grid-cols-4 gap-3">
        <Field label="MW offered" hint={`min ${prog?.min_mw ?? '—'} · range ${flex}`}><input className={inputCls} value={draft.mw} onChange={set('mw')} inputMode="decimal" /></Field>
        <Field label="From (hour)" hint={prog ? `prog. ${hourWindow(prog.window)}` : undefined}><input className={inputCls} value={draft.start_h} onChange={set('start_h')} inputMode="decimal" /></Field>
        <Field label="To (hour)"><input className={inputCls} value={draft.end_h} onChange={set('end_h')} inputMode="decimal" /></Field>
        <Field label="Response (min)" hint={`≤ ${prog?.max_response_min ?? '—'}`}><input className={inputCls} value={draft.response_min} onChange={set('response_min')} inputMode="decimal" /></Field>
        <Field label="Max duration (min)" hint={prog ? `${prog.duration_min[0]}–${prog.duration_min[1]}` : undefined}><input className={inputCls} value={draft.max_duration_min} onChange={set('max_duration_min')} inputMode="decimal" /></Field>
        <Field label="Energy ₹/MWh" hint={`cap ₹${num(prog?.energy_cap_rs_mwh)}`}><input className={inputCls} value={draft.price_rs_mwh} onChange={set('price_rs_mwh')} inputMode="decimal" /></Field>
        <Field label="Availability ₹/MW·h" hint={prog?.availability_rs_mw_h[1] ? `₹${prog.availability_rs_mw_h[0]}–${prog.availability_rs_mw_h[1]}` : 'not paid'}><input className={inputCls} value={draft.availability_rs_mw_h} onChange={set('availability_rs_mw_h')} inputMode="decimal" /></Field>
        <Field label="Restrictions"><input className={inputCls} value={draft.restrictions} onChange={set('restrictions')} placeholder="e.g. not during curing" /></Field>
      </div>
      <div className="mt-3 flex items-center gap-3 rounded-lg bg-[var(--accent-soft)] p-3 text-xs">
        <Icon name="wallet" size={18} className="text-[var(--accent-ink)]" />
        <span>One hour fully delivered ≈ <b className="num">{rs(+draft.mw * +draft.price_rs_mwh)}</b>{+draft.availability_rs_mw_h ? <> + availability <b className="num">{rs(+draft.mw * +draft.availability_rs_mw_h)}</b>/h</> : null}. Payment depends on verified delivery against your baseline.</span>
      </div>
      <div className="mt-3 flex justify-end gap-2"><Btn onClick={() => setDraft(null)}>Cancel</Btn><Btn kind="primary" onClick={submit}>Submit offer</Btn></div>
    </Modal>
  );
}

/* ----------------------------------------------------------------- Delivery */

function Delivery({ d }: { d: any }) {
  const p = d.participant;
  const cols = '7rem 6rem 4.5rem 4.5rem 9rem 1fr';
  return (
    <div className="grid h-full grid-cols-[1fr_340px] gap-3">
      <Card title="Dispatch instructions to my gateway" icon="event" sub="authenticated setpoints from the SLDC">
        <FitList items={d.dispatches} rowHeight={36} keyOf={(c: any) => c.id} empty="No instructions yet — you are dispatched only inside an accepted offer."
          header={<THead cols={cols}><span>Instruction</span><span>Event</span><span className="text-right">Setpoint</span><span>Kind</span><span>State</span><span>Ack · first response · full output (s)</span></THead>}
          render={(c: any) => (
            <TRow cols={cols}>
              <span className="truncate text-[var(--muted)]">{c.id}</span><span className="truncate">{c.event}</span>
              <span className="num text-right font-semibold">{c.setpoint.toFixed(0)} MW</span><span>{c.kind}</span>
              <span><Chip tone={cmdTone(c.state)}>{c.state === 'AWAITING_APPROVAL' ? 'SLDC approval' : c.state}</Chip></span>
              <span className="num">{c.clocks.ack_s ?? '—'} · {c.clocks.first_s ?? '—'} · {c.clocks.full_s ?? '—'}</span>
            </TRow>
          )} />
      </Card>
      <div className="flex min-h-0 flex-col gap-3">
        <Card title="Right now" icon="target" className="shrink-0">
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Instructed" value={mw(p.instructed_mw)} />
            <Stat label="Gateway reports" value={mw(p.delivering_mw)} tone={p.delivering_mw > 0.5 ? 'ok' : undefined} />
            <Stat label="Baseline" value={mw(p.baseline)} />
            <Stat label="Meter" value={mw(p.meter)} sub={`reduction ${mw(Math.max(0, p.baseline - p.meter))}`} />
          </div>
          <div className="mt-3 flex items-center justify-between text-[11px]"><span className="text-[var(--muted)]">Gateway heartbeat</span><Chip tone={p.heartbeat_age > 60 ? 'alarm' : 'ok'}>{p.heartbeat_age > 60 ? `lost ${p.heartbeat_age.toFixed(0)} s` : 'healthy'}</Chip></div>
        </Card>
        <Card title="What counts as delivery" icon="check" className="min-h-0 flex-1">
          <ul className="space-y-2 text-xs">
            <li><b>Acknowledgement</b> <span className="text-[var(--muted)]">— a comms receipt, not delivery.</span></li>
            <li><b>First response</b> <span className="text-[var(--muted)]">— 10% of the way to setpoint.</span></li>
            <li><b>Full output</b> <span className="text-[var(--muted)]">— 90% of the way to setpoint.</span></li>
            <li><b>Delivered energy</b> <span className="text-[var(--muted)]">— verified from your revenue meter against your baseline. This is the settlement of record.</span></li>
            <li><b>Security</b> <span className="text-[var(--muted)]">— commands are HMAC-authenticated; your gateway rejects unknown keys, stale or replayed messages.</span></li>
          </ul>
        </Card>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- Earnings */

function Earnings({ d, act }: { d: any; act: any }) {
  const [open, setOpen] = useState<any>(null);
  const [reason, setReason] = useState('');
  const e = d.earnings;
  const total = e.settled_rs + e.open_rs + e.held_rs;
  return (
    <div className="grid h-full grid-cols-[1fr_340px] grid-rows-[auto_1fr] gap-3">
      <div className="card col-span-2 flex items-center gap-6 px-4 py-3">
        <Stat size="lg" label="Total earned (all events)" value={rsShort(total)} />
        <div className="flex-1">
          <SegBar height={10} total={Math.max(total, 1)} parts={[{ v: e.settled_rs, color: 'var(--ok)' }, { v: e.open_rs, color: 'var(--accent)' }, { v: e.held_rs, color: 'var(--warn)' }]} />
          <div className="num mt-1 flex gap-4 text-[11px] text-[var(--muted)]"><span><span className="text-[var(--ok)]">■</span> settled {rsShort(e.settled_rs)}</span><span><span className="text-[var(--accent-ink)]">■</span> open {rsShort(e.open_rs)}</span><span><span className="text-[var(--warn)]">■</span> held {rsShort(e.held_rs)}</span><span>· {e.verified_mwh} MWh verified</span></div>
        </div>
      </div>
      <Card title="Verified delivery & payment by event" icon="wallet">
        <FitList items={d.records} rowHeight={78} keyOf={(r: any) => r.id} empty="No events yet. Payments appear here after your first dispatch."
          render={(r: any) => (
            <div className="grid h-[72px] grid-cols-[9rem_1fr_13rem_6rem] items-center gap-3 border-b border-[var(--line)] text-xs">
              <div><div className="font-semibold">{r.event}</div><div className="num text-[10px] text-[var(--muted)]">{r.offer} · ₹{num(r.price_rs_mwh)}/MWh</div></div>
              <div className="flex gap-1 overflow-hidden">{r.blocks.map((b: any, i: number) => (
                <div key={i} className="num shrink-0 rounded-md border border-[var(--line)] px-1.5 py-1 text-[10px] leading-tight" title="B baseline · M meter · R = max(0, B − M) · A accepted · V = min(R, A)">
                  <div className="text-[var(--muted)]">{hhmm(b.t)}</div><div>R {b.R} · A {b.A}</div><div className="font-semibold">V {b.V}</div>
                </div>))}</div>
              <div className="num text-[11px]"><div>E <b>{r.totals.E_mwh}</b>/{r.totals.accepted_mwh} MWh · PF {r.totals.PF}</div><div className="text-[var(--muted)]">{rs(r.totals.energy_rs)} + {rs(r.totals.availability_rs)}{r.totals.pf_adjustment_rs ? ` − ${rs(-r.totals.pf_adjustment_rs)}` : ''}</div><div className="text-[13px] font-semibold">{rs(r.totals.payment_rs)}</div></div>
              <div className="flex flex-col items-end gap-1"><Chip tone={r.status === 'DISPUTED' ? 'warn' : r.status === 'SETTLED' || r.status === 'RESOLVED' ? 'ok' : 'info'}>{r.status}</Chip>{r.status !== 'DISPUTED' && <Btn small kind="ghost" onClick={() => setOpen(r)}>Dispute</Btn>}</div>
            </div>
          )} />
      </Card>
      <Card title="How you are paid" icon="doc">
        <KV rows={[['Baseline', d.baseline_method], ['B', 'mean of 4 blocks before the event, ±10% of declared'], ['R', 'max(0, B − M)'], ['A', 'dispatched MW, capped at offer, after your response time'], ['V', 'min(R, A)'], ['PF', '1 at ≥ 90%, linear 50–90%, 0 at ≤ 50%']]} />
        <div className="mt-auto rounded-lg bg-[var(--chip)] p-2 text-[11px] text-[var(--muted)]">A baseline-vs-meter difference is not automatically proof of delivery. Any record can be disputed — payment is held and resolved with an audited adjustment.</div>
      </Card>
      <Modal open={!!open} onClose={() => setOpen(null)} title={`Dispute ${open?.event ?? ''}`}>
        <Field label="Reason"><textarea className={cx(inputCls, 'h-24 py-1.5')} value={reason} onChange={(ev) => setReason(ev.target.value)} placeholder="e.g. block 2 meter reading excludes captive generation" /></Field>
        <div className="mt-3 flex justify-end gap-2"><Btn onClick={() => setOpen(null)}>Cancel</Btn>
          <Btn kind="primary" disabled={!reason.trim()} onClick={async () => { if (await act('dispute', { id: open.id, reason }, 'Dispute raised — payment held')) { setOpen(null); setReason(''); } }}>Raise dispute</Btn></div>
      </Modal>
    </div>
  );
}

/* ----------------------------------------------------------------- Energy plan / enrolment */

function Plan({ d, act }: { d: any; act: any }) {
  const p = d.participant;
  const [f, setF] = useState({ company: '', discom: 'BESCOM', sector: '', flexible_mw: '', contact: '', processes: '', programmes: [] as string[] });
  if (p) {
    const cols = '1.6fr 4.5rem 5rem 5rem 1.4fr';
    return (
      <div className="grid h-full grid-cols-[1fr_380px] gap-3">
        <Card title="Energy reduction plan" icon="factory" sub={`${p.name} · ${p.discom}`}>
          <div className="mb-3 grid grid-cols-4 gap-3">
            <Stat label="Declared demand" value={mw(p.declared_mw)} />
            <Stat label="Flexible range" value={mw(p.flexible_mw)} />
            <Stat label="Share flexible" value={pct(p.flexible_mw / p.declared_mw)} />
            <Stat label="Reliability" value={pct(p.reliability, 1)} />
          </div>
          <SegBar height={10} total={p.flexible_mw} parts={p.processes.map((x: any, i: number) => ({ v: x.mw, color: ['var(--accent)', '#3ea58c', '#7cc5b3', '#b5dfd4'][i % 4], label: x.name }))} />
          <div className="mt-3 min-h-0 flex-1">
            <FitList items={p.processes} rowHeight={36}
              header={<THead cols={cols}><span>Step · flexible process</span><span className="text-right">MW</span><span className="text-right">Response</span><span className="text-right">Duration</span><span>Restriction</span></THead>}
              render={(x: any, i: number) => (
                <TRow cols={cols}>
                  <span className="flex items-center gap-2 font-medium"><span className="num grid h-5 w-5 place-items-center rounded-full bg-[var(--accent-soft)] text-[10px] font-bold text-[var(--accent-ink)]">{i + 1}</span>{x.name}</span>
                  <span className="num text-right">{x.mw}</span><span className="num text-right">{x.response_min} min</span><span className="num text-right">{x.duration_min} min</span>
                  <span className="truncate text-[var(--muted)]">{x.restriction}</span>
                </TRow>
              )} />
          </div>
          <div className="text-[11px] text-[var(--muted)]">Processes are activated in this order up to the instructed MW. To change your plan, contact the SLDC programme desk; changes are audited.</div>
        </Card>
        <Card title="Programme requirements" icon="shield">
          <div className="space-y-3">
            {d.programmes.filter((x: any) => x.status === 'OPEN').map((x: any) => (
              <div key={x.id}><div className="text-xs font-semibold">{x.name}</div>
                <ul className="mt-1 space-y-0.5">{x.requirements.map((r: string) => <li key={r} className="flex items-center gap-1.5 text-[11px] text-[var(--fg-dim)]"><Icon name="check" size={12} className="text-[var(--ok)]" />{r}</li>)}</ul></div>
            ))}
          </div>
        </Card>
      </div>
    );
  }
  const toggle = (id: string) => setF({ ...f, programmes: f.programmes.includes(id) ? f.programmes.filter((x) => x !== id) : [...f.programmes, id] });
  return (
    <div className="grid h-full grid-cols-[1fr_1fr_340px] gap-3">
      <Card title="Join SLDC demand response" icon="factory" sub="apply in two minutes" className="col-span-2">
        <div className="grid grid-cols-3 gap-3">
          <Field label="Company / site"><input className={inputCls} value={f.company} onChange={(e) => setF({ ...f, company: e.target.value })} /></Field>
          <Field label="DISCOM"><select className={inputCls} value={f.discom} onChange={(e) => setF({ ...f, discom: e.target.value })}>{['BESCOM', 'CESC', 'MESCOM', 'HESCOM', 'GESCOM'].map((x) => <option key={x}>{x}</option>)}</select></Field>
          <Field label="Sector"><input className={inputCls} value={f.sector} onChange={(e) => setF({ ...f, sector: e.target.value })} placeholder="Steel, cement, data centre…" /></Field>
          <Field label="Flexible MW (estimate)"><input className={inputCls} value={f.flexible_mw} onChange={(e) => setF({ ...f, flexible_mw: e.target.value })} inputMode="decimal" /></Field>
          <Field label="Contact (email / phone)"><input className={inputCls} value={f.contact} onChange={(e) => setF({ ...f, contact: e.target.value })} /></Field>
          <Field label="Flexible processes"><input className={inputCls} value={f.processes} onChange={(e) => setF({ ...f, processes: e.target.value })} placeholder="e.g. arc furnace reschedule 30 MW" /></Field>
        </div>
        <div className="label mb-1.5 mt-4">Programmes of interest</div>
        <div className="grid grid-cols-2 gap-2">
          {d.programmes.map((x: any) => (
            <button key={x.id} onClick={() => toggle(x.id)} className={cx('rounded-lg border p-2.5 text-left text-xs', f.programmes.includes(x.id) ? 'border-[var(--accent)] bg-[var(--accent-soft)]' : 'border-[var(--line)] hover:bg-[var(--chip)]')}>
              <div className="flex justify-between"><b>{x.name}</b><Chip tone={x.status === 'OPEN' ? 'ok' : 'neutral'}>{x.status}</Chip></div>
              <div className="num mt-0.5 text-[10px] text-[var(--muted)]">{hourWindow(x.window)} · ≤ ₹{num(x.energy_cap_rs_mwh)}/MWh · {x.type}</div>
            </button>
          ))}
        </div>
        <div className="mt-auto flex justify-end pt-3"><Btn kind="primary" onClick={async () => { if (await act('apply', f, 'Application submitted to the SLDC programme desk')) setF({ ...f, company: '', flexible_mw: '', processes: '' }); }}>Submit application</Btn></div>
      </Card>
      <div className="flex min-h-0 flex-col gap-3">
        <Card title="What you get" icon="wallet" className="shrink-0">
          <ul className="space-y-1.5 text-xs">
            {['Paid per verified MWh, plus availability in committed programmes', 'You set MW, window, response and price — never an off-switch', 'Dispatch only inside offers you choose', 'Transparent baseline M&V with disputes'].map((x) => <li key={x} className="flex gap-2"><Icon name="check" size={13} className="mt-0.5 text-[var(--ok)]" />{x}</li>)}
          </ul>
        </Card>
        <Card title="My applications" icon="doc" className="min-h-0 flex-1">
          <FitList items={d.applications} rowHeight={44} empty="No applications yet" render={(a: any) => (
            <div className="flex h-full items-center justify-between border-b border-[var(--line)] text-xs">
              <div><div className="font-medium">{a.company}</div><div className="num text-[10px] text-[var(--muted)]">{a.id} · {a.flexible_mw} MW · {a.discom}</div></div>
              <Chip tone={a.status === 'ACCEPTED_FOR_ONBOARDING' ? 'ok' : a.status === 'DECLINED' ? 'neutral' : 'info'}>{a.status.replace(/_/g, ' ')}</Chip>
            </div>
          )} />
          <div className="pt-2 text-[11px] text-[var(--muted)]">After onboarding you receive a participant login, a gateway key and a revenue-meter check.</div>
        </Card>
      </div>
    </div>
  );
}
