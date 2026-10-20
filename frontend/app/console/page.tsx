'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import KarnatakaMap from '@/components/KarnatakaMap';
import TopBar, { View } from '@/components/console/TopBar';
import { GridView, OverviewView, RotationView } from '@/components/console/SpatialViews';
import EventsView from '@/components/console/EventsView';
import { AdminView, AlarmsView, ForecastView, ProgrammesView, SettlementAuditView, WhatIfView } from '@/components/console/DataViews';
import { ToastHost } from '@/components/ui';
import { Claims, claims, setToken, useSnapshot } from '@/lib/api';

const SPATIAL: View[] = ['overview', 'grid', 'rotation'];
const TOP = 104;          // top bar height + margins (px)
const SIDE = 440;         // docked column width for spatial views

export default function ConsolePage() {
  const router = useRouter();
  const [user, setUser] = useState<Claims | null>(null);
  useEffect(() => {
    const c = claims();
    if (!c) router.replace('/');
    else if (c.role === 'industry') router.replace('/industry');
    else setUser(c);
  }, [router]);
  if (!user) return <div className="theme-console h-screen w-screen" />;
  return (
    <ToastHost>
      <Console user={user} onLogout={() => { setToken(null); router.replace('/'); }} />
    </ToastHost>
  );
}

function Console({ user, onLogout }: { user: Claims; onLogout: () => void }) {
  const { snap, link } = useSnapshot();
  const [view, setView] = useState<View>('overview');
  const [sel, setSel] = useState<any>(null);
  const spatial = SPATIAL.includes(view);
  if (!snap) {
    return (
      <div className="theme-console grid h-screen w-screen place-items-center text-sm text-[var(--muted)]">
        Connecting to the GNA engine… (start the API: <code className="mx-1">uvicorn app:app --port 8000</code> in backend/)
      </div>
    );
  }
  return (
    <div className="theme-console relative h-screen w-screen overflow-hidden">
      <div className={spatial ? '' : 'opacity-35'}>
        <KarnatakaMap snap={snap} insetTop={TOP} insetRight={spatial ? SIDE + 16 : 0} mode={view === 'rotation' ? 'rotation' : 'grid'}
          selected={spatial ? sel : null} onSelect={setSel} />
      </div>
      <TopBar snap={snap} view={view} setView={(v) => { setView(v); if (!SPATIAL.includes(v)) setSel(null); }} user={user} link={link} onLogout={onLogout} />
      <main className="pointer-events-none absolute inset-x-2 bottom-2 z-20" style={{ top: TOP }}>
        {spatial ? (
          <div className="pointer-events-auto absolute bottom-0 right-0 top-0" style={{ width: SIDE }}>
            {view === 'overview' && <OverviewView snap={snap} go={setView} onSelect={setSel} />}
            {view === 'grid' && <GridView snap={snap} onSelect={setSel} />}
            {view === 'rotation' && <RotationView snap={snap} onSelect={setSel} />}
          </div>
        ) : (
          <div className="pointer-events-auto h-full">
            {view === 'events' && <EventsView snap={snap} />}
            {view === 'programmes' && <ProgrammesView snap={snap} />}
            {view === 'forecast' && <ForecastView snap={snap} />}
            {view === 'alarms' && <AlarmsView snap={snap} />}
            {view === 'whatif' && <WhatIfView />}
            {view === 'settlement' && <SettlementAuditView snap={snap} />}
            {view === 'admin' && <AdminView snap={snap} />}
          </div>
        )}
      </main>
    </div>
  );
}
