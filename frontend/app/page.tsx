'use client';
import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Btn, cx, inputCls } from '@/components/ui';
import { claims, login } from '@/lib/api';

const CONTROL = [
  ['operator', 'Operator'], ['sic1', 'Shift-in-charge A (dual)'], ['sic2', 'Shift-in-charge B (dual)'],
  ['engineer', 'Engineer'], ['analyst', 'Analyst'], ['admin', 'Admin'],
];
const INDUSTRY = [
  ['jsw', 'JSW Steel'], ['mrpl', 'MRPL refinery'], ['cement', 'Cement cluster'], ['dc', 'Data-centre campus'],
  ['sugar', 'Sugar co-gen'], ['guest', 'New industry (apply)'],
];

export default function Landing() {
  const router = useRouter();
  const [mode, setMode] = useState<'control' | 'industry'>('control');
  const [u, setU] = useState('operator');
  const [p, setP] = useState('demo');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const c = claims();
    if (c) router.replace(c.role === 'industry' ? '/industry' : '/console');
  }, [router]);

  const submit = async (e?: FormEvent, user = u) => {
    e?.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const c = await login(user, p);
      router.replace(c.role === 'industry' ? '/industry' : '/console');
    } catch (x) {
      setErr((x as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const industry = mode === 'industry';
  return (
    <div className={cx('grid h-screen w-screen grid-cols-[1.1fr_1fr] overflow-hidden', industry ? 'theme-portal' : 'theme-console')}>
      <div className="relative flex flex-col justify-between overflow-hidden bg-[#070d18] p-10 text-slate-200">
        <div className="pointer-events-none absolute inset-0 opacity-30" style={{ background: 'radial-gradient(60% 50% at 30% 40%, rgba(125,211,252,0.25), transparent 70%)' }} />
        <div className="relative flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-lg bg-sky-300 text-sm font-black text-sky-950">GNA</div>
          <div>
            <div className="text-xl font-semibold">GNA <span className="font-normal text-slate-400">(Demand Response)</span></div>
            <div className="text-xs text-slate-400">Automated Demand Response Management System · Karnataka SLDC</div>
          </div>
        </div>
        <div className="relative max-w-xl space-y-5">
          <h1 className="text-3xl font-semibold leading-tight text-white">Close the gap between schedule and drawal — at the lowest cost, with proof.</h1>
          <ol className="grid grid-cols-2 gap-3 text-sm">
            {[
              ['Monitor & assess', 'Telemetry quality, ACE, DSM exposure, 2-hour forecast'],
              ['Optimise & screen', 'Priority LP (BESS → industry → others → RTM) and Digital Twin gate'],
              ['Approve & dispatch', 'Autonomy policy, dual authorisation, HMAC-authenticated setpoints'],
              ['Measure & settle', 'Baseline M&V, counterfactual ledger, hash-chained audit'],
            ].map(([t, d]) => (
              <li key={t} className="rounded-lg border border-white/10 bg-white/5 p-3">
                <div className="font-medium text-white">{t}</div>
                <div className="text-xs text-slate-400">{d}</div>
              </li>
            ))}
          </ol>
        </div>
        <div className="relative text-[11px] text-slate-500">Simulation &amp; advisory prototype — not authorised for autonomous grid control. Prices, bids, roster and DSM multipliers are demonstration data.</div>
      </div>

      <div className="flex items-center justify-center bg-[var(--bg)] p-10 text-[var(--fg)]">
        <div className="w-full max-w-md">
          <div className="mb-6 grid grid-cols-2 gap-1 rounded-lg bg-[var(--chip)] p-1">
            {(['control', 'industry'] as const).map((m) => (
              <button key={m} onClick={() => { setMode(m); setU(m === 'control' ? 'operator' : 'jsw'); setErr(null); }}
                className={cx('rounded-md px-3 py-2 text-sm font-medium', mode === m ? 'bg-[var(--accent)] text-[var(--accent-fg)]' : 'text-[var(--muted)]')}>
                {m === 'control' ? 'SLDC control room' : 'Industry portal'}
              </button>
            ))}
          </div>
          <h2 className="text-lg font-semibold">{industry ? 'Industry participants' : 'Control-room sign in'}</h2>
          <p className="mb-4 text-sm text-[var(--muted)]">
            {industry
              ? 'See what the SLDC offers and needs, make flexibility offers, follow dispatch instructions and verified payments.'
              : 'Spatial operations console for the shift: grid need, DR events, approvals, load rotation and settlement.'}
          </p>
          <form onSubmit={submit} className="space-y-3">
            <input className={cx(inputCls, 'py-2 text-sm')} value={u} onChange={(e) => setU(e.target.value)} placeholder="Username" aria-label="Username" autoComplete="username" />
            <input className={cx(inputCls, 'py-2 text-sm')} type="password" value={p} onChange={(e) => setP(e.target.value)} placeholder="Password" aria-label="Password" autoComplete="current-password" />
            {err && <div role="alert" className="text-sm text-[var(--alarm)]">■ {err}</div>}
            <Btn type="submit" kind="primary" className="w-full py-2 text-sm" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</Btn>
          </form>
          <div className="mt-6 text-xs text-[var(--muted)]">Demo accounts (password <code>demo</code>):</div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {(industry ? INDUSTRY : CONTROL).map(([id, label]) => (
              <Btn key={id} small onClick={() => { setU(id); submit(undefined, id); }}>{label}</Btn>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
