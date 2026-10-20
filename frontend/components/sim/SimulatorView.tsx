'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
import dynamic from 'next/dynamic';
import { useMemo, useState } from 'react';
import { Btn, Chip, FitList, Icon, KV, Meter, Popover, Segmented, cmdTone, cx, useAct } from '../ui';
import { hhmm, mw, num, pct, rsShort } from '@/lib/fmt';
import type { CamPreset, Layers, Sel } from './Scene';

const Scene = dynamic(() => import('./Scene'), {
  ssr: false,
  loading: () => <div className="grid h-full place-items-center text-xs text-[var(--muted)]">Loading 3D simulator…</div>,
});

const STAGE_LABEL: Record<string, string> = {
  ingest: 'Ingest', quality: 'Quality', estimate: 'Estimate', assess: 'Assess', forecast: 'Forecast', detect: 'Detect',
  decide: 'Decide', optimise: 'Optimise', twin: 'Twin', policy: 'Policy', dispatch: 'Dispatch', rotate: 'Rotate', mv: 'M&V',
  settle: 'Settle', audit: 'Audit',
};
const toneOf = (t: string) => (t === 'alarm' ? 'alarm' : t === 'warn' ? 'warn' : t === 'ok' ? 'ok' : t === 'info' ? 'info' : 'neutral') as any;

export default function SimulatorView({ snap }: { snap: any }) {
  const act = useAct();
  const [sel, setSel] = useState<Sel>(null);
  const [layers, setLayers] = useState<Layers>({ flow: true, labels: true, beams: true, plants: true });
  const [preset, setPreset] = useState<CamPreset>('state');
  const [stageFilter, setStageFilter] = useState<string | null>(null);
  const [focusTick, setFocusTick] = useState(0);
  const trace: any[] = snap.trace ?? [];
  const feed = stageFilter ? trace.filter((d) => d.stage === stageFilter) : trace;
  const latestStage = trace[0]?.stage;
  const maxMs = Math.max(0.05, ...snap.pipeline.map((p: any) => p.ms));
  const clk = snap.clock;
  const lp = snap.pipeline.find((p: any) => p.stage === 'optimise');

  const focusRef = (d: any) => {
    const ref: string | null = d.ref;
    if (!ref) return;
    const cmd = snap.commands.find((c: any) => c.id === ref);
    const rid = cmd?.resource ?? (snap.resources.find((r: any) => r.id === ref) ? ref : null);
    if (rid) { setSel({ kind: 'res', id: rid }); setFocusTick((x) => x + 1); return; }
    if (ref.startsWith('L') && snap.grid.lines.find((l: any) => l.id === ref)) { setSel({ kind: 'line', id: ref }); setFocusTick((x) => x + 1); return; }
    if (ref.startsWith('DR-') || ref.startsWith('ROT-')) { setSel({ kind: 'sldc', id: 'SLDC' }); setFocusTick((x) => x + 1); }
  };

  return (
    <div className="relative h-full overflow-hidden">
      <div className="absolute inset-0 isolate z-0"><Scene snap={snap} sel={sel} onSelect={setSel} layers={layers} preset={preset} focusTick={focusTick} /></div>

      {/* toolbar */}
      <div className="pointer-events-none absolute left-[300px] right-[366px] top-3 z-20 flex justify-center">
      <div className="glass pointer-events-auto flex items-center gap-1.5 px-2 py-1.5">
        <Segmented value={preset} onChange={(p) => { setPreset(p); setSel(null); }} items={[
          { id: 'state', label: 'State' }, { id: 'bengaluru', label: 'BLR' }, { id: 'north', label: 'North' }, { id: 'coast', label: 'Coast' }]} />
        <span className="h-5 w-px bg-[var(--line)]" />
        {([['flow', 'Flow'], ['beams', 'Beams'], ['plants', 'Plants'], ['labels', 'Labels']] as const).map(([k, l]) => (
          <button key={k} onClick={() => setLayers({ ...layers, [k]: !layers[k] })}
            className={cx('h-6 whitespace-nowrap rounded-md border px-1.5 text-[11px] font-medium', layers[k] ? 'border-[var(--accent-line)] bg-[var(--accent-soft)] text-[var(--accent-ink)]' : 'border-[var(--line)] bg-white text-[var(--muted)]')}>
            {layers[k] ? '✓ ' : ''}{l}
          </button>
        ))}
        <span className="h-5 w-px bg-[var(--line)]" />
        <Btn small icon={clk.running ? 'pause' : 'play'} onClick={() => act('pause', { paused: clk.running })} title={clk.running ? 'Pause' : 'Run'} />
        <Segmented value={String(clk.speed)} onChange={(v) => act('speed', { speed: +v })} items={[1, 10, 30, 120].map((s) => ({ id: String(s), label: `${s}×` }))} />
        <Popover width="w-80" label={<Icon name="sim" size={13} />}>
          {(close) => (
            <div className="space-y-0.5 text-xs">
              {snap.scenarios.map((s: any) => (
                <div key={s.key} className="flex items-center justify-between gap-2 rounded-md px-1.5 py-1 hover:bg-[var(--s2)]">
                  <span className="truncate">{s.active && <span className="text-[var(--accent-ink)]">● </span>}{s.label}</span>
                  {s.active ? <Btn small onClick={() => act('scenario_stop', { key: s.key })}>Stop</Btn>
                    : <Btn small kind="outline" onClick={() => { act('scenario_start', { key: s.key }, `Started: ${s.label}`); close(); }}>Run</Btn>}
                </div>
              ))}
            </div>
          )}
        </Popover>
      </div>
      </div>

      {/* pipeline */}
      <aside className="glass absolute bottom-3 left-3 top-3 z-20 flex w-[284px] flex-col">
        <header className="flex items-center justify-between rounded-t-[12px] border-b border-[var(--line)] bg-[var(--s2)] px-3 py-2">
          <span className="flex items-center gap-2 text-[13px] font-semibold"><Icon name="event" size={14} className="text-[var(--accent)]" />Decision pipeline</span>
          <span className="num text-[10px] text-[var(--muted)]">tick {snap.tick_ms?.toFixed(2)} ms</span>
        </header>
        <div className="grid grid-cols-3 gap-1 border-b border-[var(--line)] px-3 py-2 text-center">
          <div><div className="label">Sim time</div><div className="num text-xs font-semibold">{hhmm(clk.t)}</div></div>
          <div><div className="label">LP solve</div><div className="num text-xs font-semibold">{lp?.ms ? `${lp.ms.toFixed(1)} ms` : '—'}</div></div>
          <div><div className="label">Speed</div><div className="num text-xs font-semibold">×{clk.speed}</div></div>
        </div>
        <ol className="min-h-0 flex-1 overflow-hidden px-2 py-1.5">
          {snap.pipeline.map((p: any, i: number) => {
            const hot = p.stage === latestStage || (latestStage === 'optimise' && p.stage === 'decide');
            const on = stageFilter === p.stage;
            return (
              <li key={p.stage}>
                <button onClick={() => setStageFilter(on ? null : p.stage)}
                  className={cx('relative grid w-full grid-cols-[1.25rem_1fr] gap-x-2 rounded-lg px-1.5 py-[5px] text-left transition', on ? 'bg-[var(--accent-soft)]' : 'hover:bg-[var(--s2)]')}>
                  <span className={cx('num mt-0.5 grid h-5 w-5 place-items-center rounded-full border text-[9px] font-bold', hot ? 'border-[var(--accent)] bg-[var(--accent)] text-white' : 'border-[var(--line-strong)] text-[var(--muted)]')}>{i + 1}</span>
                  <span className="min-w-0">
                    <span className="flex items-center justify-between text-[11px]"><b>{p.label}</b><span className="num text-[10px] text-[var(--muted)]">{p.ms < 0.01 ? '<0.01' : p.ms.toFixed(2)} ms</span></span>
                    <span className="block truncate text-[10px] text-[var(--fg-dim)]">{p.summary}</span>
                    <span className="mt-0.5 block h-[3px] overflow-hidden rounded bg-[var(--chip)]"><span className="block h-full rounded bg-[var(--accent)]" style={{ width: `${Math.max(2, (p.ms / maxMs) * 100)}%` }} /></span>
                  </span>
                  {i < snap.pipeline.length - 1 && <span className="absolute left-[15px] top-[26px] h-[14px] w-px bg-[var(--line-strong)]" />}
                </button>
              </li>
            );
          })}
        </ol>
        <div className="border-t border-[var(--line)] px-3 py-1.5 text-[10px] text-[var(--muted)]">Click a stage to filter the decision feed. The engine runs once per second; each tick advances {clk.speed} s of grid time.</div>
      </aside>

      {/* decision feed */}
      <aside className="glass absolute bottom-3 right-3 top-3 z-20 flex w-[350px] flex-col">
        <header className="flex items-center justify-between rounded-t-[12px] border-b border-[var(--line)] bg-[var(--s2)] px-3 py-2">
          <span className="flex items-center gap-2 text-[13px] font-semibold"><Icon name="doc" size={14} className="text-[var(--accent)]" />Decisions &amp; reasons</span>
          {stageFilter ? <Chip tone="accent">{STAGE_LABEL[stageFilter]} <button onClick={() => setStageFilter(null)} className="ml-1">✕</button></Chip> : <span className="text-[10px] text-[var(--muted)]">{trace.length} recent</span>}
        </header>
        <div className="flex min-h-0 flex-1 flex-col px-2 py-1.5">
          <FitList items={feed} rowHeight={68} keyOf={(d: any) => String(d.seq)} empty="No decisions yet — start a scenario."
            render={(d: any, i: number) => (
              <button onClick={() => focusRef(d)} className={cx('mb-1 flex h-[64px] w-full flex-col rounded-lg border px-2 py-1.5 text-left transition hover:border-[var(--accent-line)]', i === 0 && !stageFilter ? 'border-[var(--accent-line)] bg-[var(--accent-soft)]' : 'border-[var(--line)] bg-white')}>
                <span className="flex items-center gap-1.5">
                  <Chip tone={toneOf(d.tone)}>{STAGE_LABEL[d.stage] ?? d.stage}</Chip>
                  <span className="num text-[10px] text-[var(--muted)]">{hhmm(d.t)}</span>
                  {d.data?.solver && <span className="num ml-auto text-[10px] text-[var(--muted)]">{d.data.solver.solve_ms} ms</span>}
                </span>
                <span className="mt-0.5 truncate text-[11px] font-semibold">{d.title}</span>
                <span className="line-clamp-1 text-[10px] text-[var(--fg-dim)]" title={d.why}>{d.why || ' '}</span>
              </button>
            )} />
        </div>
      </aside>

      {/* inspector */}
      <div className="pointer-events-none absolute bottom-3 left-[300px] right-[366px] z-20 flex justify-center [&>*]:pointer-events-auto">
        {sel ? <Inspector sel={sel} snap={snap} onClose={() => setSel(null)} /> : <Legend snap={snap} />}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- explain the selected object */

function Inspector({ sel, snap, onClose }: { sel: Sel; snap: any; onClose: () => void }) {
  const act = useAct();
  const ev = snap.event;
  const body = useMemo(() => {
    if (!sel) return null;
    if (sel.kind === 'res') {
      const r = snap.resources.find((x: any) => x.id === sel.id);
      if (!r) return null;
      const a = ev?.plan?.allocations?.find((x: any) => x.id === r.id);
      const sk = ev?.plan?.skipped?.find((x: any) => x.id === r.id);
      const c = snap.commands.filter((x: any) => x.resource === r.id)[0];
      const mrg = snap.grid.dsm.marginal_rate;
      return {
        title: r.name, sub: `${r.type} · tier ${r.tier} · ${r.bus} · ${r.discom}`,
        cols: [
          <KV key="1" rows={[['Available', mw(r.available)], ['Setpoint', mw(r.setpoint)], ['Metered', mw(r.delivering)], ['Reliability', pct(r.reliability, 1)], ...(r.soc != null ? [['State of charge', pct(r.soc)] as [string, string]] : []), ['Response / ramp', `${r.response_min} min · ${r.ramp} MW/min`]]} />,
          <div key="2" className="space-y-1 text-[11px]">
            <div className="label">Optimiser decision</div>
            {a ? (
              <>
                <div><b className="text-[var(--ok)]">Chosen</b> · tier {a.tier} · effective ₹{a.effective.toFixed(2)}/kWh (pay {a.pay_rate} + rebound {a.rebound_rate}) vs DSM marginal ₹{mrg}/kWh</div>
                <div className="num">Setpoint by block: <b>{a.x.map((v: number) => v.toFixed(0)).join(' · ')}</b> MW</div>
                <div className="num">Expected R·φ·x: {a.expected.map((v: number) => v.toFixed(0)).join(' · ')} MW · φ₁ {a.phi[0]}</div>
                {a.caps.length > 0 && <div className="text-[var(--muted)]">Limits: {a.caps.join(', ')}</div>}
              </>
            ) : sk ? <div><b className="text-[var(--warn)]">Skipped</b> — {sk.reason}</div> : <div className="text-[var(--muted)]">{ev ? 'Not needed in the current plan (cheaper tiers cover the requirement).' : 'No DR event — resource on standby.'}</div>}
          </div>,
          <div key="3" className="space-y-1 text-[11px]">
            <div className="label">Command path</div>
            {c ? (
              <>
                <div className="flex items-center gap-1.5"><Chip tone={cmdTone(c.state)}>{c.state === 'AWAITING_APPROVAL' ? 'awaiting approval' : c.state}</Chip><span className="num">{c.setpoint.toFixed(0)} MW {c.direction}</span></div>
                <div className="text-[var(--muted)]">{c.approval_reason ? `Policy: ${c.approval_reason}` : 'Policy: automatic within autonomy envelope'}</div>
                <div className="num">ack {c.clocks.ack_s ?? '—'} s · first {c.clocks.first_s ?? '—'} s · full {c.clocks.full_s ?? '—'} s</div>
                {c.tag && <div className="num truncate font-mono text-[10px] text-[var(--muted)]">HMAC {c.tag.slice(0, 24)}…</div>}
                {c.state === 'AWAITING_APPROVAL' && <Btn small kind="primary" icon="check" onClick={() => act('event_approve', {}, 'Approval recorded')}>Approve round</Btn>}
              </>
            ) : <div className="text-[var(--muted)]">No command issued.</div>}
            {r.veto && <div className="text-[var(--alarm)]">■ {r.veto}</div>}
          </div>,
        ],
      };
    }
    if (sel.kind === 'gen') {
      const g = snap.grid.gens.find((x: any) => x.id === sel.id);
      if (!g) return null;
      const red = snap.resources.find((r: any) => r.id === `GEN_${g.id}`);
      return {
        title: g.name, sub: `${g.kind} · bus ${g.bus}`,
        cols: [
          <div key="1"><div className="label">Output</div><div className="num text-xl font-semibold">{num(g.mw)} <span className="text-xs text-[var(--muted)]">/ {num(g.capacity)} MW</span></div><Meter value={g.mw} max={g.capacity} tone="accent" className="mt-1" /></div>,
          <KV key="2" rows={[['Capacity factor', pct(g.mw / g.capacity)], ['Telemetry', g.flag], ['Re-dispatch resource', red ? red.name : '—']]} />,
          <div key="3" className="text-[11px]">{red ? <>Re-dispatch available <b>{mw(red.available)}</b>, delivering <b>{mw(red.delivering)}</b> (tier 3; pay = variable cost + wear).</> : <span className="text-[var(--muted)]">Renewable output follows weather; not dispatched for DR.</span>}</div>,
        ],
      };
    }
    if (sel.kind === 'bus') {
      const b = snap.grid.buses.find((x: any) => x.id === sel.id);
      if (!b) return null;
      const lines = snap.grid.lines.filter((l: any) => l.from === b.id || l.to === b.id);
      return {
        title: b.name, sub: `${b.discom}${b.tie ? ' · inter-state tie (distributed slack)' : ''}`,
        cols: [
          <KV key="1" rows={[['Load', mw(b.load)], ['Voltage (screen)', `${b.v.toFixed(3)} pu`], ['Telemetry', b.flag], ['DR delivering here', mw(b.dr)], ['Rotated out', mw(b.rotated)]]} />,
          <div key="2" className="space-y-1">{lines.slice(0, 5).map((l: any) => (
            <div key={l.id} className="grid grid-cols-[2.4rem_1fr_2.6rem] items-center gap-2 text-[10px]"><span>{l.id}</span><Meter value={l.loading} max={1} tone={l.loading >= 1 ? 'alarm' : l.loading >= 0.9 ? 'p3' : 'neutral'} /><span className="num text-right">{pct(l.loading)}</span></div>))}</div>,
          <div key="3" className="text-[11px] text-[var(--muted)]">Bus load is estimated from RTU telemetry; a missing value is filled by load share so one failed RTU lowers confidence rather than corrupting the state.</div>,
        ],
      };
    }
    if (sel.kind === 'line') {
      const l = snap.grid.lines.find((x: any) => x.id === sel.id);
      if (!l) return null;
      const bind = ev?.plan?.binding_lines?.find((x: any) => x.line === l.id);
      const fc = snap.forecast?.violations?.find((v: any) => v.line === l.id);
      return {
        title: `${l.id} · ${l.from} – ${l.to}`, sub: `${l.kv} kV · ${l.in_service ? 'in service' : 'OUT OF SERVICE'}`,
        cols: [
          <div key="1"><div className="label">Loading</div><div className={cx('num text-xl font-semibold', l.loading >= 1 ? 'text-[var(--alarm)]' : l.loading >= 0.9 && 'text-[var(--p3)]')}>{pct(l.loading)}</div><Meter value={l.loading} max={1} tone={l.loading >= 1 ? 'alarm' : l.loading >= 0.9 ? 'p3' : 'neutral'} className="mt-1" /></div>,
          <KV key="2" rows={[['Flow', mw(Math.abs(l.flow))], ['Direction', l.flow >= 0 ? `${l.from} → ${l.to}` : `${l.to} → ${l.from}`], ['Limit', mw(l.limit)]]} />,
          <div key="3" className="text-[11px]">{bind ? <>Binding in the LP (block {bind.block}): one more MW of capacity saves <b>₹{num(bind.shadow_rs_per_mw)}</b>.</> : 'Not binding in the current plan.'}{fc && <div className="mt-1 text-[var(--p3)]">◆ Forecast {pct(fc.value)} in block {fc.block}</div>}</div>,
        ],
      };
    }
    const pending = ev?.rounds?.find((r: any) => r.state === 'PENDING');
    return {
      title: 'SLDC control centre · ADRMS', sub: `autonomy ${snap.autonomy.effective}${snap.autonomy.suspended ? ' · SUSPENDED' : ''}`,
      cols: [
        <KV key="1" rows={[['ACE', `${snap.grid.ace.toFixed(0)} MW`], ['Severity', snap.grid.severity], ['DSM / block', rsShort(snap.grid.dsm.amount)], ['Event', ev ? `${ev.id} · ${ev.phase}` : 'none']]} />,
        <div key="2" className="space-y-1 text-[11px]">
          <div className="label">Beams show live commands</div>
          <div><span className="text-[#d97706]">- - amber</span> awaiting approval · <span className="text-[#2563eb]">blue</span> sent · <span className="text-[#16a34a]">green</span> executing · <span className="text-[#d92d20]">red</span> failed</div>
          {snap.autonomy.reasons.map((x: string) => <div key={x} className="text-[var(--warn)]">▲ {x}</div>)}
        </div>,
        <div key="3" className="space-y-1 text-[11px]">
          {pending ? <><div><b>{mw(pending.mw)}</b> awaiting · {pending.approvers.length}/{pending.needed} approvers</div><Btn small kind="primary" icon="check" onClick={() => act('event_approve', {}, 'Approval recorded')}>Approve</Btn></> : <div className="text-[var(--muted)]">Nothing awaiting approval.</div>}
          {snap.rotation.order?.state === 'PROPOSED' && <Btn small kind="outline" onClick={() => act('rotation_approve', {}, 'Rotation approval recorded')}>Approve rotation {mw(snap.rotation.order.mw)}</Btn>}
        </div>,
      ],
    };
  }, [sel, snap, ev, act]);
  if (!body) return null;
  return (
    <div className="glass-strong w-full max-w-[860px] rounded-xl">
      <header className="flex items-center justify-between rounded-t-xl border-b border-[var(--line)] bg-[var(--s2)] px-3 py-2">
        <div className="min-w-0"><div className="truncate text-[13px] font-semibold">{body.title}</div><div className="truncate text-[10px] text-[var(--muted)]">{body.sub}</div></div>
        <Btn small kind="ghost" icon="x" onClick={onClose} title="Close" />
      </header>
      <div className="grid grid-cols-3 gap-4 p-3">{body.cols}</div>
    </div>
  );
}

function Legend({ snap }: { snap: any }) {
  const ev = snap.event;
  return (
    <div className="glass flex flex-wrap items-center justify-center gap-x-3 gap-y-1 whitespace-nowrap px-3 py-1.5 text-[10px] text-[var(--fg-dim)]">
      <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-[#f26b1d]" />flow · speed ∝ loading</span>
      <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-[#e3a008]" />≥ 90%</span>
      <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-[#d92d20]" />≥ 100%</span>
      <span className="flex items-center gap-1.5"><i className="h-0.5 w-4 bg-[#16a34a]" />command executing</span>
      <span className="flex items-center gap-1.5"><i className="h-0.5 w-4 border-t-2 border-dashed border-[#d97706]" />awaiting approval</span>
      <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full border-2 border-[#d97706]" />rotated out</span>
      <span className="text-[var(--muted)]">{ev ? `Event ${ev.id} · ${ev.phase}` : 'Click any object to see why the engine decided what it did'}</span>
    </div>
  );
}
