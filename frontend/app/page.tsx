'use client';
import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Brand, Btn, Icon, cx, inputCls } from '@/components/ui';
import { claims, login } from '@/lib/api';

const ACCOUNTS = {
  control: [['operator', 'Operator'], ['sic1', 'Shift-in-charge A'], ['sic2', 'Shift-in-charge B'], ['engineer', 'Engineer'], ['analyst', 'Analyst'], ['admin', 'Admin']],
  industry: [['jsw', 'JSW Steel'], ['mrpl', 'MRPL refinery'], ['cement', 'Cement cluster'], ['dc', 'Data-centre campus'], ['sugar', 'Sugar co-gen'], ['guest', 'New industry']],
};

const FLOWS = {
  control: { title: 'SLDC control room', icon: 'grid', blurb: 'Situation map, DR event workflow, approvals, load rotation, settlement and audit.' },
  industry: { title: 'Industry portal', icon: 'factory', blurb: 'See what the SLDC offers and needs, bid flexibility, track delivery and payments.' },
} as const;

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

  return (
    <div className="theme-console grid h-screen w-screen grid-cols-[1.15fr_1fr] overflow-hidden bg-[var(--bg)] text-[var(--fg)]">
      <section className="relative flex flex-col justify-between overflow-hidden border-r border-[var(--line)] p-10">
        <div className="pointer-events-none absolute inset-0" style={{ backgroundImage: 'linear-gradient(var(--line) 1px, transparent 1px), linear-gradient(90deg, var(--line) 1px, transparent 1px)', backgroundSize: '40px 40px', opacity: 0.35, maskImage: 'radial-gradient(70% 60% at 40% 45%, black, transparent)' }} />
        <div className="relative flex items-center gap-3">
          <Brand size="lg" />
          <div className="text-xs text-[var(--muted)]">Automated Demand Response Management System<br />Karnataka SLDC</div>
        </div>

        <div className="relative max-w-2xl">
          <h1 className="text-[34px] font-semibold leading-tight tracking-tight">Close the gap between schedule and drawal —<br /><span className="text-[var(--accent-ink)]">at the lowest cost, with proof.</span></h1>
          <div className="mt-8 grid grid-cols-5 gap-2">
            {[['target', 'Assess', 'ACE · DSM · forecast'], ['event', 'Optimise', 'priority LP on HiGHS'], ['shield', 'Screen', 'Digital Twin gate'], ['lock', 'Dispatch', 'HMAC setpoints'], ['receipt', 'Settle', 'M&V · audit chain']].map(([i, t, d], k) => (
              <div key={t} className="card relative p-3">
                <div className="mb-2 flex items-center justify-between"><Icon name={i} size={16} className="text-[var(--accent-ink)]" /><span className="num text-[10px] text-[var(--muted)]">0{k + 1}</span></div>
                <div className="text-sm font-semibold">{t}</div>
                <div className="text-[11px] text-[var(--muted)]">{d}</div>
              </div>
            ))}
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-[11px] text-[var(--fg-dim)]">
            {['BESS → industry → other flexibility → RTM, load rotation last', 'Fit-to-screen spatial console built on ISA-101 HMI practice', 'Separate industry portal: offers, delivery, earnings'].map((x) => (
              <div key={x} className="flex gap-2"><Icon name="check" size={13} className="mt-0.5 text-[var(--ok)]" />{x}</div>
            ))}
          </div>
        </div>

        <div className="relative text-[11px] text-[var(--muted)]">Simulation &amp; advisory prototype — not authorised for autonomous grid control. Prices, bids, roster and DSM multipliers are demonstration data.</div>
      </section>

      <section className="flex items-center justify-center p-10">
        <div className="w-full max-w-md">
          <div className="label mb-2">Choose your workspace</div>
          <div className="mb-6 grid grid-cols-2 gap-2">
            {(Object.keys(FLOWS) as ('control' | 'industry')[]).map((m) => (
              <button key={m} onClick={() => { setMode(m); setU(ACCOUNTS[m][0][0]); setErr(null); }}
                className={cx('rounded-xl border p-3 text-left transition', mode === m ? 'border-[var(--accent)] bg-[var(--accent-soft)]' : 'border-[var(--line)] hover:bg-[var(--s2)]')}>
                <Icon name={FLOWS[m].icon} size={18} className={mode === m ? 'text-[var(--accent-ink)]' : 'text-[var(--muted)]'} />
                <div className="mt-2 text-sm font-semibold">{FLOWS[m].title}</div>
                <div className="mt-0.5 text-[11px] leading-snug text-[var(--muted)]">{FLOWS[m].blurb}</div>
              </button>
            ))}
          </div>
          <form onSubmit={submit} className="space-y-2.5">
            <input className={cx(inputCls, 'h-9 text-sm')} value={u} onChange={(e) => setU(e.target.value)} placeholder="Username" aria-label="Username" autoComplete="username" />
            <input className={cx(inputCls, 'h-9 text-sm')} type="password" value={p} onChange={(e) => setP(e.target.value)} placeholder="Password" aria-label="Password" autoComplete="current-password" />
            {err && <div role="alert" className="text-sm text-[var(--alarm)]">■ {err}</div>}
            <Btn type="submit" kind="primary" className="h-9 w-full text-sm" disabled={busy}>{busy ? 'Signing in…' : `Sign in to ${FLOWS[mode].title}`}</Btn>
          </form>
          <div className="mt-6 text-[11px] text-[var(--muted)]">Demo accounts · password <code className="text-[var(--fg)]">demo</code></div>
          <div className="mt-2 grid grid-cols-3 gap-1.5">
            {ACCOUNTS[mode].map(([id, label]) => <Btn key={id} small onClick={() => { setU(id); submit(undefined, id); }}>{label}</Btn>)}
          </div>
        </div>
      </section>
    </div>
  );
}
