'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from 'react';
import KarnatakaMap from '../KarnatakaMap';
import { Btn, Chart, Chip, FitList, Icon, Meter, Ring, Segmented, Stat, TRow, THead, cmdTone, cx, inputCls, loadTone, toneVar, useAct } from '../ui';
import { hhmm, mw, num, pct } from '@/lib/fmt';
import type { View } from './Shell';

const INSPECTOR = 400;
type Layer = 'flow' | 'dr' | 'rotation';

function MapCanvas({ snap, sel, setSel, layer, setLayer }: { snap: any; sel: any; setSel: (s: any) => void; layer: Layer; setLayer: (l: Layer) => void }) {
  return (
    <>
      <KarnatakaMap snap={snap} insetRight={INSPECTOR + 20} insetTop={52} insetBottom={8} mode={layer === 'rotation' ? 'rotation' : layer === 'dr' ? 'dr' : 'grid'} selected={sel} onSelect={setSel} />
      <div className="glass absolute left-3 top-3 z-10 flex items-center gap-2 rounded-lg p-1 pl-2.5">
        <span className="label">Layer</span>
        <Segmented value={layer} onChange={setLayer} items={[
          { id: 'flow', label: 'Power flow', icon: 'grid' }, { id: 'dr', label: 'Flexibility', icon: 'battery' }, { id: 'rotation', label: 'Rotation', icon: 'rotate' }]} />
      </div>
    </>
  );
}

function Inspector({ children }: { children: React.ReactNode }) {
  return <aside className="absolute bottom-3 right-3 top-3 z-10 flex flex-col gap-2" style={{ width: INSPECTOR }}>{children}</aside>;
}

/* ================================================================= Situation */

export function SituationView({ snap, go }: { snap: any; go: (v: View) => void }) {
  const [sel, setSel] = useState<any>(null);
  const [layer, setLayer] = useState<Layer>('flow');
  const act = useAct();
  const g = snap.grid, ev = snap.event;
  const need = ev ? ev.requirement : g.requirement;
  const res: any[] = snap.resources;
  const dir = ev?.direction ?? g.direction;
  const byType = (types: string[]) => res.filter((r) => types.includes(r.type) && r.direction === dir).reduce((a, r) => a + r.delivering, 0);
  const tiers = [
    { label: 'BESS', v: byType(['BESS']), color: 'var(--ok)' },
    { label: 'Industrial', v: byType(['INDUSTRIAL']), color: '#3fb57a' },
    { label: 'Other', v: byType(['GENERATION', 'INTERRUPTIBLE', 'SHIFTABLE', 'DER']), color: '#2d8c5f' },
    { label: 'Rotation', v: snap.rotation.measured_mw, color: 'var(--warn)' },
  ];
  const covered = tiers.reduce((a, t) => a + t.v, 0);
  const pending = ev?.rounds?.find((r: any) => r.state === 'PENDING');
  const rot = snap.rotation.order;
  const offers = snap.gridflex.offers.filter((o: any) => o.status === 'PENDING').length;
  const fc = snap.forecast?.blocks ?? [];
  const actions = [
    pending && { key: 'ev', tone: 'warn', text: <><b>{mw(pending.mw)}</b> of DR awaiting approval · {pending.approvers.length}/{pending.needed}{pending.needed > 1 ? ' (dual)' : ''}</>,
      btns: <><Btn small kind="primary" icon="check" onClick={() => act('event_approve', {}, 'Approval recorded')}>Approve</Btn><Btn small onClick={() => go('events')}>Review</Btn></> },
    rot?.state === 'PROPOSED' && { key: 'rot', tone: 'warn', text: <>Load rotation <b>{mw(rot.mw)}</b> proposed — last resort</>,
      btns: <><Btn small kind="primary" onClick={() => act('rotation_approve', {}, 'Rotation approval recorded')}>Approve</Btn><Btn small onClick={() => go('rotation')}>Review</Btn></> },
    ev?.twin && !ev.twin.passed && { key: 'tw', tone: 'alarm', text: <>Digital twin failed — a human must decide</>, btns: <Btn small onClick={() => go('events')}>Open</Btn> },
    offers > 0 && { key: 'of', tone: 'info', text: <>{offers} industry offer{offers > 1 ? 's' : ''} awaiting acceptance</>, btns: <Btn small onClick={() => go('programmes')}>Open</Btn> },
  ].filter(Boolean) as any[];

  return (
    <div className="relative h-full">
      <MapCanvas snap={snap} sel={sel} setSel={setSel} layer={layer} setLayer={setLayer} />
      <Inspector>
        <div className="glass shrink-0 rounded-[12px]">
          <div className="flex items-center justify-between rounded-t-[12px] border-b border-[var(--line)] bg-[var(--s2)] px-3 py-2">
            <span className="flex items-center gap-2 text-[12px] font-semibold"><Icon name="alert" size={13} className={actions.length ? 'text-[var(--warn)]' : 'text-[var(--muted)]'} />Action required</span>
            <span className="text-[11px] text-[var(--muted)]">{actions.length || 'none'}</span>
          </div>
          <div className="space-y-1.5 p-2">
            {actions.length === 0 && <div className="px-1 py-1 text-xs text-[var(--muted)]">Nothing awaits you. The engine is monitoring; approvals and proposals appear here first.</div>}
            {actions.map((a) => (
              <div key={a.key} className="flex items-center justify-between gap-2 rounded-md border px-2 py-1.5 text-xs" style={{ borderColor: `color-mix(in srgb, ${toneVar[a.tone as 'warn']} 45%, transparent)`, background: `color-mix(in srgb, ${toneVar[a.tone as 'warn']} 10%, transparent)` }}>
                <span className="min-w-0">{a.text}</span><span className="flex shrink-0 gap-1">{a.btns}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="glass shrink-0 rounded-[12px] p-3">
          <div className="mb-2 flex items-center justify-between"><span className="text-[12px] font-semibold">Response stack</span><span className="text-[11px] text-[var(--muted)]">{dir === 'UP' ? 'UP · reduce load / add supply' : 'DOWN · absorb surplus'}</span></div>
          <div className="flex items-center gap-4">
            <Ring value={0} size={92} stroke={9} segments={tiers.map((t) => ({ v: need > 0 ? t.v / need : 0, color: t.color }))}>
              <span className="num text-lg font-semibold">{need > 0 ? Math.min(999, Math.round((covered / need) * 100)) : 100}%</span>
              <span className="text-[9px] text-[var(--muted)]">covered</span>
            </Ring>
            <div className="min-w-0 flex-1 space-y-1">
              <div className="num flex justify-between text-[11px]"><span className="text-[var(--muted)]">Need</span><b>{mw(need)}</b></div>
              {tiers.map((t, i) => (
                <div key={t.label} className="grid grid-cols-[5.6rem_1fr_3.6rem] items-center gap-2 text-[11px]">
                  <span className="flex items-center gap-1.5 whitespace-nowrap"><i className="h-2 w-2 shrink-0 rounded-sm" style={{ background: t.color }} /><span className="text-[9px] text-[var(--muted)]">{i < 3 ? `T${i + 1}` : 'last'}</span>{t.label}</span>
                  <Meter value={t.v} max={Math.max(need, 1)} tone={i === 3 ? 'warn' : 'ok'} />
                  <span className="num text-right">{t.v.toFixed(0)} MW</span>
                </div>
              ))}
              <div className="num flex justify-between border-t border-[var(--line)] pt-1 text-[11px]"><span className="text-[var(--muted)]">Gap</span><b className={need - covered > 50 ? 'text-[var(--warn)]' : ''}>{mw(Math.max(0, need - covered))}</b></div>
            </div>
          </div>
        </div>

        <div className="glass flex min-h-0 flex-1 flex-col rounded-[12px]">
          <div className="flex items-center justify-between rounded-t-[12px] border-b border-[var(--line)] bg-[var(--s2)] px-3 py-2">
            <span className="text-[12px] font-semibold">{ev ? `Dispatch · ${ev.id}` : 'Dispatch'}</span>
            {ev && <Btn small kind="ghost" onClick={() => go('events')}>Workflow <Icon name="chevron" size={11} /></Btn>}
          </div>
          <div className="flex min-h-0 flex-1 flex-col px-3 py-1.5">
            {ev ? (
              <FitList items={ev.plan?.allocations ?? []} rowHeight={26} empty="Plan pending"
                render={(a: any) => {
                  const r = res.find((x) => x.id === a.id);
                  const c = ev.commands.filter((x: any) => x.resource === a.id).slice(-1)[0];
                  return (
                    <TRow cols="1.7rem 1fr 3.4rem 3.4rem 5.8rem" onClick={() => setSel({ kind: 'bus', id: a.bus })}>
                      <span className="text-[10px] text-[var(--muted)]">T{a.tier}</span>
                      <span className="truncate">{a.name}</span>
                      <span className="num text-right">{a.x[0].toFixed(0)}</span>
                      <span className="num text-right text-[var(--ok)]">{r?.delivering > 0.5 ? r.delivering.toFixed(0) : ''}</span>
                      <span className="text-right">{c && <Chip tone={cmdTone(c.state)} glyph={false}>{c.state === 'AWAITING_APPROVAL' ? 'APPROVAL' : c.state}</Chip>}</span>
                    </TRow>
                  );
                }} />
            ) : (
              <div className="flex flex-1 flex-col justify-center gap-2 text-xs text-[var(--muted)]">
                <div>No DR event. One opens when |ACE| ≥ {snap.config.policy.ace_alert_mw} MW for {snap.config.policy.event_open_hold_s} s, immediately in EMERGENCY.</div>
                <div className="num">Now |ACE| = <b className="text-[var(--fg)]">{Math.abs(g.ace).toFixed(0)} MW</b>. Inject a disturbance from <b>Simulate</b>.</div>
              </div>
            )}
          </div>
        </div>

        <div className="glass h-[132px] shrink-0 rounded-[12px] p-2.5">
          <div className="mb-1 flex items-center justify-between text-[11px]"><span className="font-semibold">ACE next 2 h · P10–P90</span><button className="text-[var(--muted)] hover:text-[var(--fg)]" onClick={() => go('forecast')}>Forecast ›</button></div>
          <div className="h-[96px]">
            <Chart labels={fc.map((b: any) => hhmm(b.t))} series={[{ values: fc.map((b: any) => b.ace.p50), color: 'var(--fg)', label: 'P50' }]}
              band={{ lo: fc.map((b: any) => b.ace.p10), hi: fc.map((b: any) => b.ace.p90), color: 'rgba(156,195,255,0.16)' }}
              refLines={[{ y: 0, label: '', color: 'var(--line-strong)' }]} />
          </div>
        </div>
      </Inspector>
    </div>
  );
}

/* ================================================================= Network */

export function NetworkView({ snap }: { snap: any }) {
  const [sel, setSel] = useState<any>(null);
  const [layer, setLayer] = useState<Layer>('flow');
  const [tab, setTab] = useState<'lines' | 'gens' | 'buses'>('lines');
  const g = snap.grid;
  const busBy = Object.fromEntries(g.buses.map((b: any) => [b.id, b]));
  const short = (id: string) => busBy[id]?.name.split(' (')[0] ?? id;
  const lines = [...g.lines].sort((a: any, b: any) => b.loading - a.loading);
  const discoms = ['BESCOM', 'CESC', 'MESCOM', 'HESCOM', 'GESCOM'].map((d) => ({ d, mw: g.buses.filter((b: any) => b.discom === d).reduce((a: number, b: any) => a + b.load, 0) }));
  return (
    <div className="relative h-full">
      <MapCanvas snap={snap} sel={sel} setSel={setSel} layer={layer} setLayer={setLayer} />
      <Inspector>
        <div className="glass shrink-0 rounded-[12px] p-3">
          <div className="grid grid-cols-3 gap-3">
            <Stat label="Demand" value={num(g.demand)} sub={`Δ/blk ${g.demand_delta_blk > 0 ? '+' : ''}${num(g.demand_delta_blk)}`} />
            <Stat label="In-state gen" value={num(g.in_state_gen)} sub={`RE ${num(g.re)}`} />
            <Stat label="Drawal" value={num(g.drawal)} sub={`sched ${num(g.schedule)}`} />
          </div>
          <div className="mt-2 grid grid-cols-5 gap-1">
            {discoms.map((x) => (
              <div key={x.d} className="rounded-md bg-[var(--chip)] px-1.5 py-1 text-center">
                <div className="text-[9px] text-[var(--muted)]">{x.d}</div><div className="num text-[11px] font-semibold">{num(x.mw)}</div>
              </div>
            ))}
          </div>
          <div className="mt-2 flex justify-between text-[11px] text-[var(--muted)]">
            <span>Most loaded: <b className={cx(g.worst_line.loading >= 1 ? 'text-[var(--alarm)]' : g.worst_line.loading >= 0.9 ? 'text-[var(--p3)]' : 'text-[var(--fg)]')}>{g.worst_line.id} {pct(g.worst_line.loading)}</b></span>
            <span>Islands {g.islands} · P90 reserve {mw(g.p90_margin)}</span>
          </div>
        </div>
        <div className="glass flex min-h-0 flex-1 flex-col rounded-[12px]">
          <div className="flex items-center justify-between rounded-t-[12px] border-b border-[var(--line)] bg-[var(--s2)] px-2 py-1.5">
            <Segmented value={tab} onChange={setTab} items={[{ id: 'lines', label: 'Lines' }, { id: 'gens', label: 'Generation' }, { id: 'buses', label: 'Buses' }]} />
            <span className="text-[10px] text-[var(--muted)]">DC power flow · screening</span>
          </div>
          <div className="flex min-h-0 flex-1 flex-col px-3 py-1.5">
            {tab === 'lines' && (
              <FitList items={lines} rowHeight={25} keyOf={(l: any) => l.id} header={<THead cols="2.2rem 1fr 5rem 2.8rem"><span>Line</span><span>Corridor</span><span>Loading</span><span className="text-right">%</span></THead>}
                render={(l: any) => (
                  <TRow cols="2.2rem 1fr 5rem 2.8rem" onClick={() => setSel({ kind: 'line', id: l.id })} className={sel?.id === l.id ? 'bg-[var(--accent-soft)]' : ''}>
                    <span className="text-[var(--muted)]">{l.id}</span>
                    <span className="truncate">{short(l.from)} – {short(l.to)} {!l.in_service && <Chip tone="p2">out</Chip>}</span>
                    <Meter value={l.loading} max={1} tone={loadTone(l.loading)} />
                    <span className={cx('num text-right', l.loading >= 1 ? 'text-[var(--alarm)]' : l.loading >= 0.9 && 'text-[var(--p3)]')}>{(l.loading * 100).toFixed(0)}</span>
                  </TRow>
                )} />
            )}
            {tab === 'gens' && (
              <FitList items={g.gens} rowHeight={25} keyOf={(x: any) => x.id} header={<THead cols="1fr 3.5rem 4.5rem 3.6rem"><span>Unit</span><span>Kind</span><span>Output</span><span className="text-right">MW</span></THead>}
                render={(x: any) => (
                  <TRow cols="1fr 3.5rem 4.5rem 3.6rem" onClick={() => setSel({ kind: 'bus', id: x.bus })}>
                    <span className="truncate">{x.name}</span><span className="text-[10px] uppercase text-[var(--muted)]">{x.kind}</span>
                    <Meter value={x.mw} max={x.capacity} /><span className="num text-right">{x.mw.toFixed(0)}</span>
                  </TRow>
                )} />
            )}
            {tab === 'buses' && (
              <FitList items={[...g.buses].sort((a: any, b: any) => b.load - a.load)} rowHeight={25} keyOf={(x: any) => x.id} header={<THead cols="1fr 4rem 3.4rem 3.6rem"><span>Bus</span><span>DISCOM</span><span>V pu</span><span className="text-right">MW</span></THead>}
                render={(b: any) => (
                  <TRow cols="1fr 4rem 3.4rem 3.6rem" onClick={() => setSel({ kind: 'bus', id: b.id })}>
                    <span className="truncate">{b.name} {b.flag !== 'GOOD' && <Chip tone="p3">{b.flag}</Chip>}</span><span className="text-[var(--muted)]">{b.discom}</span>
                    <span className={cx('num', b.v < 0.95 && 'text-[var(--warn)]')}>{b.v.toFixed(3)}</span><span className="num text-right">{b.load.toFixed(0)}</span>
                  </TRow>
                )} />
            )}
          </div>
        </div>
      </Inspector>
    </div>
  );
}

/* ================================================================= Rotation */

export function RotationView({ snap }: { snap: any }) {
  const [sel, setSel] = useState<any>(null);
  const [layer, setLayer] = useState<Layer>('rotation');
  const [manual, setManual] = useState('');
  const act = useAct();
  const rot = snap.rotation, o = rot.order, tr = rot.trigger;
  const groups = [...rot.groups].sort((a: any, b: any) => (b.out ? 1 : 0) - (a.out ? 1 : 0) || a.F - b.F);
  const dual = o && o.mw > snap.config.policy.dual_auth_mw;
  return (
    <div className="relative h-full">
      <MapCanvas snap={snap} sel={sel} setSel={setSel} layer={layer} setLayer={setLayer} />
      <Inspector>
        <div className="glass shrink-0 rounded-[12px] p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[12px] font-semibold">Load rotation · last resort</span>
            {rot.demo_roster && <Chip tone="p3" title="Groups, 30% rotatable share and protected-feeder counts are demonstration data">Demo roster</Chip>}
          </div>
          <div className="mb-1 flex items-center justify-between text-[11px]"><span className="text-[var(--muted)]">Uncovered over-drawal vs DSM band 1</span><span className="num"><b className={tr.cond ? 'text-[var(--warn)]' : ''}>{mw(tr.residual)}</b> / {mw(tr.band)}</span></div>
          <Meter value={tr.residual} max={Math.max(tr.band * 2, tr.residual, 1)} tone={tr.cond ? 'warn' : 'neutral'} />
          <div className="mt-2 grid grid-cols-4 gap-2">
            <Stat size="sm" label="Planned" value={`${num(rot.planned_mw)} MW`} />
            <Stat size="sm" label="Metered" value={`${num(rot.measured_mw)} MW`} />
            <Stat size="sm" label="ENS" value={`${rot.ens_mwh.toFixed(1)} MWh`} />
            <Stat size="sm" label="Fairness" value={`${rot.fairness_spread_min.toFixed(0)} min`} sub={`max ${rot.max_minutes.toFixed(0)}/120`} />
          </div>
          <div className="mt-2 text-[10px] leading-snug text-[var(--muted)]">Residual ≥ 50 MW and (f &lt; 49.90 Hz or residual &gt; band 1), sustained 120 s — immediately below 49.80 Hz.{tr.since != null && tr.cond && <b className="text-[var(--warn)]"> True since {hhmm(tr.since)}.</b>} UFR and df/dt protection are never delayed or overridden.</div>
        </div>
        <div className={cx('glass shrink-0 rounded-[10px] p-3', o?.state === 'PROPOSED' && 'ring-1 ring-[var(--warn)]/60')}>
          <div className="mb-1.5 flex items-center justify-between"><span className="text-[12px] font-semibold">{o ? `Order ${o.id}` : 'No rotation order'}</span>{o && <Chip tone={o.state === 'PROPOSED' ? 'warn' : o.state === 'ACTIVE' ? 'p2' : 'info'}>{o.state}</Chip>}</div>
          {o ? (
            <div className="space-y-1.5 text-xs">
              <div><b className="num">{mw(o.mw)}</b> <span className="text-[var(--muted)]">· {o.reason}</span></div>
              {o.state === 'PROPOSED' && (
                <div className="flex items-center justify-between gap-2 rounded-md bg-[var(--warn-bg)] px-2 py-1.5">
                  <span>Shift-in-charge approval {o.approvals.length}/{dual ? 2 : 1}{dual && ' (dual > 200 MW)'}</span>
                  <span className="flex gap-1"><Btn small kind="primary" onClick={() => act('rotation_approve', {}, 'Rotation approval recorded')}>Approve</Btn><Btn small onClick={() => act('rotation_reject', { reason: 'shift-in-charge rejected' })}>Reject</Btn></span>
                </div>
              )}
              {o.escalated && <div className="text-[var(--warn)]">▲ Metered relief &lt; 90% of plan for 2 min — escalated</div>}
              <div className="space-y-0.5 text-[11px] text-[var(--muted)]">
                {o.log.slice(-3).map((l: any, i: number) => <div key={i} className="truncate"><span className="num">{hhmm(l.t)}</span> {l.action} {l.group} — {l.reason}</div>)}
                {o.state === 'PROPOSED' && o.next_in_line.length > 0 && <div className="truncate">Next: {o.next_in_line.map((n: any) => `${n.group} F${n.score.toFixed(2)}`).join(' · ')}</div>}
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-xs">
              <span className="flex-1 text-[var(--muted)]">Proposals never act alone: approval required, dual above 200 MW.</span>
              <input className={cx(inputCls, 'w-16')} placeholder="MW" value={manual} onChange={(e) => setManual(e.target.value)} aria-label="Manual rotation MW" />
              <Btn small onClick={() => manual && act('rotation_manual', { mw: Number(manual) }, 'Manual order proposed')}>Propose</Btn>
            </div>
          )}
        </div>
        <div className="glass flex min-h-0 flex-1 flex-col rounded-[12px]">
          <div className="flex items-center justify-between rounded-t-[12px] border-b border-[var(--line)] bg-[var(--s2)] px-3 py-2"><span className="text-[12px] font-semibold">Roster groups</span><span className="text-[10px] text-[var(--muted)]">F = 0.5H + 0.3N + 0.2D · 7 days</span></div>
          <div className="flex min-h-0 flex-1 flex-col px-3 py-1.5">
            <FitList items={groups} rowHeight={25} keyOf={(x: any) => x.id} header={<THead cols="4.6rem 1fr 2.8rem 3.4rem 2.6rem"><span>Group</span><span>Status</span><span className="text-right">MW</span><span className="text-right">Today</span><span className="text-right">F</span></THead>}
              render={(x: any) => (
                <TRow cols="4.6rem 1fr 2.8rem 3.4rem 2.6rem" onClick={() => setSel({ kind: 'bus', id: x.stations[0].bus })} title={`${x.stations.map((s: any) => s.name).join(', ')} · ${x.protected_feeders} protected feeders never rotated`}>
                  <span className="font-medium">{x.id}</span>
                  <span className="truncate">{x.out ? <Chip tone="p2">out {x.spell_min.toFixed(0)}/45m</Chip> : <span className="text-[var(--muted)]">{x.eligible}</span>}</span>
                  <span className="num text-right">{x.mw.toFixed(0)}</span>
                  <span className="num text-right">{x.minutes_today.toFixed(0)}/120</span>
                  <span className="num text-right">{x.F.toFixed(2)}</span>
                </TRow>
              )} />
            <div className="pt-1 text-[10px] text-[var(--muted)]">Never rotated: {rot.protected_classes.join(', ')}.</div>
          </div>
        </div>
      </Inspector>
    </div>
  );
}

