'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlarmStrip, CommandBar, NAV, SituationStrip, View } from '@/components/console/Shell';
import { NetworkView, RotationView, SituationView } from '@/components/console/Spatial';
import EventsView from '@/components/console/Events';
import SimulatorView from '@/components/sim/SimulatorView';
import { AdminView, AlarmsView, ForecastView, ProgrammesView, SettlementView, WhatIfView } from '@/components/console/Workspaces';
import { Brand, ToastHost } from '@/components/ui';
import { Claims, claims, setToken, useSnapshot } from '@/lib/api';

export default function ConsolePage() {
  const router = useRouter();
  const [user, setUser] = useState<Claims | null>(null);
  useEffect(() => {
    const c = claims();
    if (!c) router.replace('/');
    else if (c.role === 'industry') router.replace('/industry');
    else setUser(c);
  }, [router]);
  if (!user) return <div className="theme-console h-screen w-screen bg-[var(--bg)]" />;
  return (
    <ToastHost>
      <Console user={user} onLogout={() => { setToken(null); router.replace('/'); }} />
    </ToastHost>
  );
}

function Console({ user, onLogout }: { user: Claims; onLogout: () => void }) {
  const { snap, link } = useSnapshot();
  const [view, setView] = useState<View>('simulator');

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (!e.altKey) return;
      const n = NAV.find((x) => x.key === e.key);
      if (n) { e.preventDefault(); setView(n.id); }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);

  if (!snap) {
    return (
      <div className="theme-console grid h-screen w-screen place-items-center bg-[var(--bg)] text-sm text-[var(--muted)]">
        <div className="text-center">
          <div className="mb-3"><Brand /></div>
          Connecting to the GNA engine…
          <div className="mt-1 text-[11px]">Start the API with <code>uvicorn app:app --port 8000</code> in <code>backend/</code>.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="theme-console flex h-screen w-screen flex-col overflow-hidden bg-[var(--bg)] text-[var(--fg)]">
      <CommandBar snap={snap} view={view} setView={setView} user={user} onLogout={onLogout} />
      <SituationStrip snap={snap} go={setView} />
      <main className="relative min-h-0 flex-1 border-t border-[var(--line)] shadow-[inset_0_6px_8px_-8px_rgba(16,24,40,0.12)]">
        {view === 'simulator' && <SimulatorView snap={snap} />}
        {view === 'situation' && <SituationView snap={snap} go={setView} />}
        {view === 'network' && <NetworkView snap={snap} />}
        {view === 'rotation' && <RotationView snap={snap} />}
        {view === 'events' && <EventsView snap={snap} />}
        {view === 'programmes' && <ProgrammesView snap={snap} />}
        {view === 'forecast' && <ForecastView snap={snap} />}
        {view === 'alarms' && <AlarmsView snap={snap} />}
        {view === 'whatif' && <WhatIfView />}
        {view === 'settlement' && <SettlementView snap={snap} />}
        {view === 'admin' && <AdminView snap={snap} />}
      </main>
      <AlarmStrip snap={snap} link={link} go={setView} />
    </div>
  );
}
