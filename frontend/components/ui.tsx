'use client';
import { ReactNode, createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { post } from '@/lib/api';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

/* ----------------------------------------------------------------- surfaces */

/** Glass panel: opaque enough (≥ 85%) for text over the map; falls back to solid without backdrop-filter. */
export function Panel({ children, className, title, right, pad = true }: {
  children: ReactNode; className?: string; title?: ReactNode; right?: ReactNode; pad?: boolean;
}) {
  return (
    <section className={cx('glass flex min-h-0 flex-col rounded-xl', className)}>
      {(title || right) && (
        <header className="flex shrink-0 items-center justify-between gap-2 border-b border-[var(--line)] px-3 py-2">
          <h2 className="truncate text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">{title}</h2>
          <div className="flex shrink-0 items-center gap-1.5">{right}</div>
        </header>
      )}
      <div className={cx('flex min-h-0 flex-1 flex-col', pad && 'p-3')}>{children}</div>
    </section>
  );
}

export function Stat({ label, value, sub, tone }: { label: ReactNode; value: ReactNode; sub?: ReactNode; tone?: Tone }) {
  return (
    <div className="min-w-0">
      <div className="truncate text-[10px] uppercase tracking-wider text-[var(--muted)]">{label}</div>
      <div className={cx('truncate text-lg font-semibold tabular-nums leading-tight', tone && toneText[tone])}>{value}</div>
      {sub != null && <div className="truncate text-[11px] text-[var(--muted)]">{sub}</div>}
    </div>
  );
}

/* ----------------------------------------------------------------- state colour (reserved for meaning) */

export type Tone = 'neutral' | 'ok' | 'warn' | 'alarm' | 'p1' | 'p2' | 'p3' | 'info';

const toneText: Record<Tone, string> = {
  neutral: '', ok: 'text-[var(--ok)]', warn: 'text-[var(--warn)]', alarm: 'text-[var(--alarm)]',
  p1: 'text-[var(--alarm)]', p2: 'text-[var(--warn)]', p3: 'text-[var(--p3)]', info: 'text-[var(--info)]',
};
const toneChip: Record<Tone, string> = {
  neutral: 'bg-[var(--chip)] text-[var(--fg)] border-[var(--line)]',
  ok: 'bg-[var(--ok-bg)] text-[var(--ok)] border-[var(--ok)]/40',
  warn: 'bg-[var(--warn-bg)] text-[var(--warn)] border-[var(--warn)]/40',
  alarm: 'bg-[var(--alarm-bg)] text-[var(--alarm)] border-[var(--alarm)]/50',
  p1: 'bg-[var(--alarm-bg)] text-[var(--alarm)] border-[var(--alarm)]/50',
  p2: 'bg-[var(--warn-bg)] text-[var(--warn)] border-[var(--warn)]/40',
  p3: 'bg-[var(--p3-bg)] text-[var(--p3)] border-[var(--p3)]/40',
  info: 'bg-[var(--info-bg)] text-[var(--info)] border-[var(--info)]/40',
};
const toneIcon: Record<Tone, string> = { neutral: '', ok: '✓', warn: '▲', alarm: '■', p1: '■', p2: '▲', p3: '◆', info: '●' };

/** Chip: colour is always paired with an icon or text, never colour alone. */
export function Chip({ tone = 'neutral', children, icon = true, className, title }: {
  tone?: Tone; children: ReactNode; icon?: boolean; className?: string; title?: string;
}) {
  return (
    <span title={title} className={cx('inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide', toneChip[tone], className)}>
      {icon && toneIcon[tone] && <span aria-hidden className="text-[8px]">{toneIcon[tone]}</span>}
      {children}
    </span>
  );
}

export const sevTone = (s: string): Tone => (s === 'EMERGENCY' ? 'alarm' : s === 'ALERT' ? 'warn' : 'neutral');
export const prioTone = (p: string): Tone => (p === 'P1' ? 'p1' : p === 'P2' ? 'p2' : 'p3');
export const checkTone = (s: string): Tone => (s === 'fail' ? 'alarm' : s === 'warn' ? 'warn' : 'ok');
export const cmdTone = (s: string): Tone =>
  s === 'FAILED' ? 'alarm' : s === 'AWAITING_APPROVAL' ? 'warn' : s === 'EXECUTING' || s === 'COMPLETED' ? 'ok' : s === 'SENT' || s === 'ACKED' || s === 'READY' ? 'info' : 'neutral';
export const loadTone = (l: number): Tone => (l >= 1 ? 'alarm' : l >= 0.9 ? 'p3' : 'neutral');

/* ----------------------------------------------------------------- controls */

export function Btn({ children, onClick, kind = 'default', disabled, className, title, type = 'button', small }: {
  children: ReactNode; onClick?: () => void; kind?: 'default' | 'primary' | 'danger' | 'ghost'; disabled?: boolean;
  className?: string; title?: string; type?: 'button' | 'submit'; small?: boolean;
}) {
  const k = {
    default: 'border-[var(--line)] bg-[var(--chip)] hover:bg-[var(--chip-hover)]',
    primary: 'border-transparent bg-[var(--accent)] text-[var(--accent-fg)] hover:brightness-110',
    danger: 'border-[var(--alarm)]/60 bg-[var(--alarm-bg)] text-[var(--alarm)] hover:brightness-110',
    ghost: 'border-transparent hover:bg-[var(--chip)]',
  }[kind];
  return (
    <button type={type} title={title} disabled={disabled} onClick={onClick}
      className={cx('inline-flex shrink-0 items-center justify-center gap-1 rounded-md border font-medium transition disabled:cursor-not-allowed disabled:opacity-40',
        small ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs', k, className)}>
      {children}
    </button>
  );
}

export function Tabs<T extends string>({ value, onChange, items, className }: {
  value: T; onChange: (v: T) => void; items: { id: T; label: ReactNode; badge?: ReactNode }[]; className?: string;
}) {
  return (
    <div role="tablist" className={cx('flex shrink-0 items-center gap-0.5 overflow-hidden', className)}>
      {items.map((it) => (
        <button key={it.id} role="tab" aria-selected={value === it.id} onClick={() => onChange(it.id)}
          className={cx('flex items-center gap-1 whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-medium transition',
            value === it.id ? 'bg-[var(--accent)] text-[var(--accent-fg)]' : 'text-[var(--muted)] hover:bg-[var(--chip)] hover:text-[var(--fg)]')}>
          {it.label}
          {it.badge}
        </button>
      ))}
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="flex min-w-0 flex-col gap-0.5 text-[11px]">
      <span className="text-[var(--muted)]">{label}</span>
      {children}
      {hint && <span className="text-[10px] text-[var(--muted)]">{hint}</span>}
    </label>
  );
}

export const inputCls = 'w-full rounded-md border border-[var(--line)] bg-[var(--input)] px-2 py-1 text-xs text-[var(--fg)] outline-none focus:border-[var(--accent)]';

/* ----------------------------------------------------------------- fit-to-screen list (pages instead of scrolling) */

export function useFit(rowHeight: number, reserve = 0) {
  const ref = useRef<HTMLDivElement>(null);
  const [rows, setRows] = useState(5);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setRows(Math.max(1, Math.floor((el.clientHeight - reserve) / rowHeight))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [rowHeight, reserve]);
  return { ref, rows };
}

export function FitList<T>({ items, rowHeight, render, empty, header, className, keyOf }: {
  items: T[]; rowHeight: number; render: (item: T, i: number) => ReactNode; empty?: ReactNode;
  header?: ReactNode; className?: string; keyOf?: (item: T, i: number) => string;
}) {
  const { ref, rows } = useFit(rowHeight);
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(items.length / rows));
  const p = Math.min(page, pages - 1);
  const view = items.slice(p * rows, p * rows + rows);
  return (
    <div className={cx('flex min-h-0 flex-1 flex-col', className)}>
      {header}
      <div ref={ref} className="min-h-0 flex-1 overflow-hidden">
        {items.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-[var(--muted)]">{empty ?? 'Nothing to show'}</div>
        ) : (
          view.map((it, i) => (
            <div key={keyOf ? keyOf(it, i) : i} style={{ height: rowHeight }} className="overflow-hidden">
              {render(it, p * rows + i)}
            </div>
          ))
        )}
      </div>
      {pages > 1 && (
        <div className="flex shrink-0 items-center justify-end gap-2 pt-1 text-[10px] text-[var(--muted)]">
          <span className="tabular-nums">{p * rows + 1}–{Math.min(items.length, p * rows + rows)} of {items.length}</span>
          <Btn small kind="ghost" disabled={p === 0} onClick={() => setPage(p - 1)} title="Previous page">‹</Btn>
          <Btn small kind="ghost" disabled={p >= pages - 1} onClick={() => setPage(p + 1)} title="Next page">›</Btn>
        </div>
      )}
    </div>
  );
}

/* ----------------------------------------------------------------- charts */

export function Spark({ values, height = 28, stroke = 'var(--fg)', fill, min, max, className, zero }: {
  values: number[]; height?: number; stroke?: string; fill?: string; min?: number; max?: number; className?: string; zero?: boolean;
}) {
  if (!values.length) return <div style={{ height }} />;
  const lo = min ?? Math.min(...values, zero ? 0 : Infinity);
  const hi = max ?? Math.max(...values, zero ? 0 : -Infinity);
  const span = hi - lo || 1;
  const w = 100;
  const pts = values.map((v, i) => `${(i / Math.max(1, values.length - 1)) * w},${height - ((v - lo) / span) * (height - 2) - 1}`);
  const z = zero && lo < 0 && hi > 0 ? height - ((0 - lo) / span) * (height - 2) - 1 : null;
  return (
    <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" className={cx('w-full', className)} style={{ height }}>
      {fill && <polygon points={`0,${height} ${pts.join(' ')} ${w},${height}`} fill={fill} />}
      {z != null && <line x1={0} x2={w} y1={z} y2={z} stroke="var(--line)" strokeDasharray="2 2" vectorEffect="non-scaling-stroke" />}
      <polyline points={pts.join(' ')} fill="none" stroke={stroke} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** Multi-series chart with optional band (P10–P90). Measures its container so text is never stretched. */
export function Chart({ series, band, labels, refLines = [] }: {
  series: { values: number[]; color: string; label: string; dash?: boolean }[];
  band?: { lo: number[]; hi: number[]; color: string };
  height?: number; labels?: string[]; refLines?: { y: number; label: string; color: string }[];
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 300, h: 120 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: Math.max(80, el.clientWidth), h: Math.max(60, el.clientHeight) }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const all = [...series.flatMap((s) => s.values), ...(band ? [...band.lo, ...band.hi] : []), ...refLines.map((r) => r.y)];
  const W = size.w, H = size.h;
  let body: ReactNode = null;
  if (all.length) {
    const lo = Math.min(...all), hi = Math.max(...all);
    const pad = (hi - lo) * 0.08 || 1;
    const a = lo - pad, b = hi + pad;
    const n = Math.max(...series.map((s) => s.values.length), band?.lo.length ?? 0);
    const L = 44;
    const X = (i: number) => (i / Math.max(1, n - 1)) * (W - L - 8) + L;
    const Y = (v: number) => H - 18 - ((v - a) / (b - a)) * (H - 26);
    const ticks = [a + pad, (a + b) / 2, b - pad];
    body = (
      <svg width={W} height={H} className="block">
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={L} x2={W - 4} y1={Y(t)} y2={Y(t)} stroke="var(--line)" strokeWidth={1} />
            <text x={L - 6} y={Y(t) + 3} textAnchor="end" fontSize={10} fill="var(--muted)">{Math.round(t).toLocaleString('en-IN')}</text>
          </g>
        ))}
        {band && (
          <polygon fill={band.color}
            points={[...band.hi.map((v, i) => `${X(i)},${Y(v)}`), ...band.lo.map((v, i) => `${X(i)},${Y(v)}`).reverse()].join(' ')} />
        )}
        {refLines.map((r, i) => (
          <g key={i}>
            <line x1={L} x2={W - 4} y1={Y(r.y)} y2={Y(r.y)} stroke={r.color} strokeDasharray="4 4" strokeWidth={1} />
            <text x={W - 6} y={Y(r.y) - 3} textAnchor="end" fontSize={9} fill={r.color}>{r.label}</text>
          </g>
        ))}
        {series.map((s, k) => (
          <polyline key={k} fill="none" stroke={s.color} strokeWidth={2} strokeDasharray={s.dash ? '5 4' : undefined}
            points={s.values.map((v, i) => `${X(i)},${Y(v)}`).join(' ')} />
        ))}
        {labels && labels.map((l, i) => (i % Math.ceil(labels.length / 6) === 0 ? (
          <text key={i} x={X(i)} y={H - 4} fontSize={10} textAnchor="middle" fill="var(--muted)">{l}</text>
        ) : null))}
      </svg>
    );
  }
  return <div ref={ref} className="h-full min-h-0 w-full overflow-hidden">{body}</div>;
}

export function Meter({ value, max, tone = 'neutral', className }: { value: number; max: number; tone?: Tone; className?: string }) {
  const p = Math.max(0, Math.min(1, max > 0 ? value / max : 0));
  const c = { neutral: 'var(--fg-dim)', ok: 'var(--ok)', warn: 'var(--warn)', alarm: 'var(--alarm)', p1: 'var(--alarm)', p2: 'var(--warn)', p3: 'var(--p3)', info: 'var(--info)' }[tone];
  return (
    <div className={cx('h-1.5 w-full overflow-hidden rounded-full bg-[var(--chip)]', className)}>
      <div className="h-full rounded-full" style={{ width: `${p * 100}%`, background: c }} />
    </div>
  );
}

/* ----------------------------------------------------------------- modal */

export function Modal({ open, onClose, title, children, width = 'max-w-lg' }: {
  open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; width?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div role="dialog" aria-modal className={cx('glass-strong w-full rounded-xl shadow-2xl', width)} onClick={(e) => e.stopPropagation()}>
        <header className="flex items-center justify-between border-b border-[var(--line)] px-4 py-2.5">
          <h3 className="text-sm font-semibold">{title}</h3>
          <Btn kind="ghost" small onClick={onClose} title="Close">✕</Btn>
        </header>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- toasts + actions */

type Toast = { id: number; text: string; tone: Tone };
const ToastCtx = createContext<(text: string, tone?: Tone) => void>(() => {});

export function ToastHost({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone: Tone = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-3), { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-4 left-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2">
        {toasts.map((t) => (
          <div key={t.id} role="status" className="glass-strong pointer-events-auto flex items-center gap-2 rounded-lg px-3 py-2 text-xs shadow-xl">
            <Chip tone={t.tone}>{t.tone === 'alarm' ? 'Refused' : t.tone === 'ok' ? 'Done' : 'Info'}</Chip>
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);

/** POST helper that reports success/refusal as a toast. */
export function useAct(prefix = '/api/action/', after?: () => void) {
  const toast = useToast();
  return useCallback(async (name: string, body: unknown = {}, okText?: string) => {
    try {
      const r = await post<{ ok: boolean; id?: string }>(prefix + name, body);
      if (okText) toast(okText, 'ok');
      after?.();
      return r;
    } catch (e) {
      toast((e as Error).message, 'alarm');
      return null;
    }
  }, [prefix, toast, after]);
}
