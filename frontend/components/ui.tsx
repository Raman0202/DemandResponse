'use client';
import { ReactNode, createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { post } from '@/lib/api';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

/* ================================================================= icons (stroke, 24-grid) */

const PATHS: Record<string, string> = {
  overview: 'M3 3h7v9H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 16h7v5H3z',
  event: 'M13 2 4 14h7l-1 8 9-12h-7z',
  grid: 'M12 2v4M5 6h14M7 6l-3 8h6L7 6zM17 6l-3 8h6l-3-8zM12 6v16M8 22h8',
  rotate: 'M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5',
  factory: 'M2 20h20M4 20V10l5 3V10l5 3V6l6 4v10',
  forecast: 'M3 3v18h18M7 15l4-5 3 3 5-7',
  bell: 'M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10 21a2 2 0 0 0 4 0',
  flask: 'M9 2h6M10 2v6L4 19a2 2 0 0 0 2 3h12a2 2 0 0 0 2-3L14 8V2M7 15h10',
  receipt: 'M5 2h14v20l-3-2-2 2-2-2-2 2-2-2-3 2zM9 7h6M9 11h6M9 15h4',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  power: 'M12 2v10M18.4 6.6a9 9 0 1 1-12.8 0',
  play: 'M6 4l14 8-14 8z',
  pause: 'M7 4h3v16H7zM14 4h3v16h-3z',
  user: 'M20 21a8 8 0 0 0-16 0M12 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10z',
  battery: 'M3 7h15v10H3zM21 10v4M6 10v4M9 10v4',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2',
  check: 'M20 6 9 17l-5-5',
  alert: 'M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  x: 'M18 6 6 18M6 6l12 12',
  chevron: 'M9 18l6-6-6-6',
  down: 'M6 9l6 6 6-6',
  plus: 'M12 5v14M5 12h14',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
  sim: 'M4 4h16v12H4zM8 20h8M12 16v4M8 9l2 2 4-4',
  wallet: 'M3 7h18v13H3zM3 7l3-4h12l3 4M16 13h2',
  target: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  doc: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h6',
  market: 'M3 9l1.5-5h15L21 9M3 9h18M3 9v11h18V9M9 20v-6h6v6',
  link: 'M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  lock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4',
};

export function Icon({ name, size = 14, className, stroke = 1.8 }: { name: keyof typeof PATHS | string; size?: number; className?: string; stroke?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke}
      strokeLinecap="round" strokeLinejoin="round" className={cx('shrink-0', className)} aria-hidden>
      <path d={PATHS[name] ?? PATHS.overview} />
    </svg>
  );
}

/* ================================================================= brand */

/** GNA wordmark + orange "Demand Response" pill (GNAi style). */
export function Brand({ size = 'md', tag = 'Demand Response' }: { size?: 'sm' | 'md' | 'lg'; tag?: string }) {
  const t = size === 'lg' ? 'text-[34px]' : size === 'sm' ? 'text-[20px]' : 'text-[24px]';
  return (
    <span className="inline-flex items-center gap-2.5" aria-label="GNA (Demand Response)">
      <span className={cx('brand-text font-extrabold leading-none tracking-tight', t)}>GNA</span>
      <span className={cx('brand-fill inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg font-semibold text-white shadow-sm', size === 'lg' ? 'px-3.5 py-1.5 text-sm' : 'px-2.5 py-1 text-[12px]')}>
        <span className="h-1.5 w-1.5 rounded-full bg-white/90" />{tag}
      </span>
    </span>
  );
}

/* ================================================================= state colour (reserved for meaning) */

export type Tone = 'neutral' | 'ok' | 'warn' | 'alarm' | 'p1' | 'p2' | 'p3' | 'info' | 'accent';

export const toneVar: Record<Tone, string> = {
  neutral: 'var(--fg-dim)', ok: 'var(--ok)', warn: 'var(--warn)', alarm: 'var(--alarm)', p1: 'var(--alarm)',
  p2: 'var(--warn)', p3: 'var(--p3)', info: 'var(--info)', accent: 'var(--accent)',
};
const toneText: Record<Tone, string> = {
  neutral: '', ok: 'text-[var(--ok)]', warn: 'text-[var(--warn)]', alarm: 'text-[var(--alarm)]', p1: 'text-[var(--alarm)]',
  p2: 'text-[var(--warn)]', p3: 'text-[var(--p3)]', info: 'text-[var(--info)]', accent: 'text-[var(--accent-ink)]',
};
const toneChip: Record<Tone, string> = {
  neutral: 'bg-[var(--chip)] text-[var(--fg-dim)] border-transparent',
  ok: 'bg-[var(--ok-bg)] text-[var(--ok)] border-[var(--ok)]/30',
  warn: 'bg-[var(--warn-bg)] text-[var(--warn)] border-[var(--warn)]/35',
  alarm: 'bg-[var(--alarm-bg)] text-[var(--alarm)] border-[var(--alarm)]/45',
  p1: 'bg-[var(--alarm-bg)] text-[var(--alarm)] border-[var(--alarm)]/45',
  p2: 'bg-[var(--warn-bg)] text-[var(--warn)] border-[var(--warn)]/35',
  p3: 'bg-[var(--p3-bg)] text-[var(--p3)] border-[var(--p3)]/35',
  info: 'bg-[var(--info-bg)] text-[var(--info)] border-[var(--info)]/30',
  accent: 'bg-white text-[var(--accent-ink)] border-[var(--accent-line)] rounded-full px-2',
};
const toneGlyph: Record<Tone, string> = { neutral: '', ok: '✓', warn: '▲', alarm: '■', p1: '■', p2: '▲', p3: '◆', info: '●', accent: '' };

export const sevTone = (s: string): Tone => (s === 'EMERGENCY' ? 'alarm' : s === 'ALERT' ? 'warn' : 'neutral');
export const prioTone = (p: string): Tone => (p === 'P1' ? 'p1' : p === 'P2' ? 'p2' : 'p3');
export const checkTone = (s: string): Tone => (s === 'fail' ? 'alarm' : s === 'warn' ? 'warn' : 'ok');
export const cmdTone = (s: string): Tone =>
  s === 'FAILED' ? 'alarm' : s === 'AWAITING_APPROVAL' ? 'warn' : s === 'EXECUTING' || s === 'COMPLETED' ? 'ok' : s === 'SENT' || s === 'ACKED' || s === 'READY' ? 'info' : 'neutral';
export const loadTone = (l: number): Tone => (l >= 1 ? 'alarm' : l >= 0.9 ? 'p3' : 'neutral');

/** Chip: colour is always paired with a glyph or text — never colour alone. */
export function Chip({ tone = 'neutral', children, glyph = true, className, title }: {
  tone?: Tone; children: ReactNode; glyph?: boolean; className?: string; title?: string;
}) {
  return (
    <span title={title} className={cx('inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded border px-1.5 py-[1px] text-[10px] font-semibold uppercase tracking-wide', toneChip[tone], className)}>
      {glyph && toneGlyph[tone] && <span aria-hidden className="text-[8px] leading-none">{toneGlyph[tone]}</span>}
      {children}
    </span>
  );
}

/* ================================================================= surfaces */

export function Card({ children, className, title, icon, right, pad = true, sub }: {
  children: ReactNode; className?: string; title?: ReactNode; icon?: string; right?: ReactNode; pad?: boolean; sub?: ReactNode;
}) {
  return (
    <section className={cx('card flex min-h-0 min-w-0 flex-col', className)}>
      {(title || right) && (
        <header className="flex shrink-0 items-center justify-between gap-2 rounded-t-[12px] border-b border-[var(--line)] bg-[var(--s2)] px-3.5 py-2.5">
          <div className="flex min-w-0 items-center gap-2">
            {icon && <Icon name={icon} size={14} className="text-[var(--accent)]" />}
            <h2 className="truncate text-[13px] font-semibold text-[var(--fg)]">{title}</h2>
            {sub && <span className="truncate text-[11px] text-[var(--muted)]">{sub}</span>}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">{right}</div>
        </header>
      )}
      <div className={cx('flex min-h-0 flex-1 flex-col', pad && 'p-3')}>{children}</div>
    </section>
  );
}
/** Back-compat alias. */
export const Panel = Card;

export function Stat({ label, value, sub, tone, size = 'md' }: { label: ReactNode; value: ReactNode; sub?: ReactNode; tone?: Tone; size?: 'sm' | 'md' | 'lg' }) {
  return (
    <div className="min-w-0">
      <div className="label truncate">{label}</div>
      <div className={cx('num truncate font-semibold leading-tight', size === 'lg' ? 'text-2xl' : size === 'sm' ? 'text-sm' : 'text-lg', tone && toneText[tone])}>{value}</div>
      {sub != null && <div className="truncate text-[11px] text-[var(--muted)]">{sub}</div>}
    </div>
  );
}

export function KV({ rows, className }: { rows: [ReactNode, ReactNode][]; className?: string }) {
  return (
    <dl className={cx('grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px]', className)}>
      {rows.map(([k, v], i) => (
        <div key={i} className="contents">
          <dt className="text-[var(--muted)]">{k}</dt>
          <dd className="num min-w-0 truncate text-right">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Empty({ icon = 'check', children }: { icon?: string; children: ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-xs text-[var(--muted)]">
      <Icon name={icon} size={20} />
      <div className="max-w-sm">{children}</div>
    </div>
  );
}

/* ================================================================= controls */

export function Btn({ children, onClick, kind = 'default', disabled, className, title, type = 'button', small, icon }: {
  children?: ReactNode; onClick?: () => void; kind?: 'default' | 'primary' | 'danger' | 'ghost' | 'outline'; disabled?: boolean;
  className?: string; title?: string; type?: 'button' | 'submit'; small?: boolean; icon?: string;
}) {
  const k = {
    default: 'border-[var(--line-strong)] bg-white text-[var(--fg)] hover:bg-[var(--s2)]',
    primary: 'border-transparent brand-fill text-white shadow-sm hover:brightness-105',
    outline: 'border-[var(--accent)] bg-white text-[var(--accent-ink)] hover:bg-[var(--accent-soft)]',
    danger: 'border-[var(--alarm)]/50 bg-[var(--alarm-bg)] text-[var(--alarm)] hover:brightness-110',
    ghost: 'border-transparent text-[var(--fg-dim)] hover:bg-[var(--chip)] hover:text-[var(--fg)]',
  }[kind];
  return (
    <button type={type} title={title} aria-label={title} disabled={disabled} onClick={onClick}
      className={cx('inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg border font-medium transition focus-visible:outline-2 focus-visible:outline-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-40',
        small ? 'h-6 px-2 text-[11px]' : 'h-7 px-2.5 text-xs', k, className)}>
      {icon && <Icon name={icon} size={small ? 12 : 13} />}
      {children}
    </button>
  );
}

export function Segmented<T extends string>({ value, onChange, items, className }: {
  value: T; onChange: (v: T) => void; items: { id: T; label: ReactNode; badge?: ReactNode; icon?: string }[]; className?: string;
}) {
  return (
    <div role="tablist" className={cx('inline-flex shrink-0 items-center gap-0.5 rounded-lg border border-[var(--line)] bg-white p-0.5', className)}>
      {items.map((it) => (
        <button key={it.id} role="tab" aria-selected={value === it.id} onClick={() => onChange(it.id)}
          className={cx('flex h-6 items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 text-[11px] font-medium transition',
            value === it.id ? 'bg-[var(--accent-soft)] font-semibold text-[var(--accent-ink)]' : 'text-[var(--fg-dim)] hover:bg-[var(--s2)]')}>
          {it.icon && <Icon name={it.icon} size={12} />}
          {it.label}
          {it.badge}
        </button>
      ))}
    </div>
  );
}
/** Back-compat alias. */
export const Tabs = Segmented;

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="flex min-w-0 flex-col gap-1 text-[11px]">
      <span className="font-medium text-[var(--fg-dim)]">{label}</span>
      {children}
      {hint && <span className="text-[10px] text-[var(--muted)]">{hint}</span>}
    </label>
  );
}

export const inputCls = 'h-7 w-full rounded-md border border-[var(--line-strong)] bg-[var(--input)] px-2 text-xs text-[var(--fg)] outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-soft)]';

/* ================================================================= fit-to-screen list (pages instead of scrolling) */

export function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, ...size };
}

export function FitList<T>({ items, rowHeight, render, empty, header, className, keyOf }: {
  items: T[]; rowHeight: number; render: (item: T, i: number) => ReactNode; empty?: ReactNode;
  header?: ReactNode; className?: string; keyOf?: (item: T, i: number) => string;
}) {
  const { ref, h } = useSize<HTMLDivElement>();
  const rows = Math.max(1, Math.floor(h / rowHeight));
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(items.length / rows));
  const p = Math.min(page, pages - 1);
  const view = items.slice(p * rows, p * rows + rows);
  return (
    <div className={cx('flex min-h-0 flex-1 flex-col', className)}>
      {header}
      <div ref={ref} className="min-h-0 flex-1 overflow-hidden">
        {items.length === 0 ? (
          typeof empty === 'string' || empty == null ? <Empty>{empty ?? 'Nothing to show'}</Empty> : empty
        ) : (
          view.map((it, i) => (
            <div key={keyOf ? keyOf(it, i) : i} style={{ height: rowHeight }} className="overflow-hidden">
              {render(it, p * rows + i)}
            </div>
          ))
        )}
      </div>
      {pages > 1 && (
        <div className="flex shrink-0 items-center justify-end gap-1 border-t border-[var(--line)] pt-1 text-[10px] text-[var(--muted)]">
          <span className="num mr-1">{p * rows + 1}–{Math.min(items.length, p * rows + rows)} of {items.length}</span>
          <Btn small kind="ghost" disabled={p === 0} onClick={() => setPage(p - 1)} title="Previous page">‹</Btn>
          <span className="num">{p + 1}/{pages}</span>
          <Btn small kind="ghost" disabled={p >= pages - 1} onClick={() => setPage(p + 1)} title="Next page">›</Btn>
        </div>
      )}
    </div>
  );
}

/** Column header row for FitList tables. */
export function THead({ cols, children }: { cols: string; children: ReactNode }) {
  return <div className="label grid gap-2 border-b border-[var(--line)] pb-1.5" style={{ gridTemplateColumns: cols }}>{children}</div>;
}
export function TRow({ cols, children, className, onClick, title }: { cols: string; children: ReactNode; className?: string; onClick?: () => void; title?: string }) {
  const C = onClick ? 'button' : 'div';
  return (
    <C onClick={onClick} title={title} className={cx('grid h-full w-full items-center gap-2 border-b border-[var(--line)]/70 text-left text-xs', onClick && 'hover:bg-[var(--chip)]', className)}
      style={{ gridTemplateColumns: cols }}>
      {children}
    </C>
  );
}

/* ================================================================= indicators */

export function Spark({ values, height = 28, stroke = 'var(--fg-dim)', fill, className, zero }: {
  values: number[]; height?: number; stroke?: string; fill?: string; className?: string; zero?: boolean;
}) {
  if (values.length < 2) return <div style={{ height }} className={className} />;
  const lo = Math.min(...values, zero ? 0 : Infinity);
  const hi = Math.max(...values, zero ? 0 : -Infinity);
  const span = hi - lo || 1;
  const w = 100;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${height - ((v - lo) / span) * (height - 2) - 1}`);
  const z = zero && lo < 0 && hi > 0 ? height - ((0 - lo) / span) * (height - 2) - 1 : null;
  return (
    <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" className={cx('w-full', className)} style={{ height }}>
      {fill && <polygon points={`0,${height} ${pts.join(' ')} ${w},${height}`} fill={fill} />}
      {z != null && <line x1={0} x2={w} y1={z} y2={z} stroke="var(--line-strong)" strokeDasharray="2 2" vectorEffect="non-scaling-stroke" />}
      <polyline points={pts.join(' ')} fill="none" stroke={stroke} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** Analogue band indicator (ISA-101): neutral scale, normal band shaded, marker coloured only when abnormal. */
export function BandGauge({ value, min, max, lo, hi, critLo, critHi, fmt = (v: number) => v.toFixed(2), ticks = [] }: {
  value: number; min: number; max: number; lo: number; hi: number; critLo?: number; critHi?: number; fmt?: (v: number) => string; ticks?: number[];
}) {
  const P = (v: number) => `${((Math.min(max, Math.max(min, v)) - min) / (max - min)) * 100}%`;
  const abnormal = value < lo || value > hi;
  const crit = (critLo != null && value < critLo) || (critHi != null && value > critHi);
  const c = crit ? 'var(--alarm)' : abnormal ? 'var(--warn)' : 'var(--fg)';
  return (
    <div className="relative h-5 w-full">
      <div className="absolute inset-x-0 top-2 h-1 rounded bg-[var(--chip)]" />
      <div className="absolute top-2 h-1 rounded bg-[var(--fg-dim)]/40" style={{ left: P(lo), width: `calc(${P(hi)} - ${P(lo)})` }} />
      {critLo != null && <div className="absolute top-1 h-3 w-px bg-[var(--alarm)]/70" style={{ left: P(critLo) }} />}
      {critHi != null && <div className="absolute top-1 h-3 w-px bg-[var(--alarm)]/70" style={{ left: P(critHi) }} />}
      {ticks.map((t) => <div key={t} className="absolute top-3.5 h-1 w-px bg-[var(--line-strong)]" style={{ left: P(t) }} />)}
      <div className="absolute top-0 h-5 w-0.5 -translate-x-1/2 rounded" style={{ left: P(value), background: c }} title={fmt(value)} />
    </div>
  );
}

export function Ring({ value, size = 64, stroke = 7, tone = 'ok', children, segments }: {
  value: number; size?: number; stroke?: number; tone?: Tone; children?: ReactNode; segments?: { v: number; color: string }[];
}) {
  const r = (size - stroke) / 2, C = 2 * Math.PI * r;
  const segs = segments ?? [{ v: value, color: toneVar[tone] }];
  let acc = 0;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--chip)" strokeWidth={stroke} />
        {segs.map((s, i) => {
          const len = Math.max(0, Math.min(1 - acc, s.v)) * C;
          const el = <circle key={i} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={s.color} strokeWidth={stroke}
            strokeDasharray={`${len} ${C}`} strokeDashoffset={-acc * C} />;
          acc += Math.max(0, s.v);
          return el;
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center leading-tight">{children}</div>
    </div>
  );
}

export function SegBar({ parts, total, height = 8 }: { parts: { v: number; color: string; label?: string }[]; total: number; height?: number }) {
  return (
    <div className="flex w-full overflow-hidden rounded-full bg-[var(--chip)]" style={{ height }}>
      {parts.map((p, i) => (
        <div key={i} title={p.label} style={{ width: `${total > 0 ? Math.max(0, Math.min(100, (p.v / total) * 100)) : 0}%`, background: p.color }} />
      ))}
    </div>
  );
}

export function Meter({ value, max, tone = 'neutral', className }: { value: number; max: number; tone?: Tone; className?: string }) {
  const p = Math.max(0, Math.min(1, max > 0 ? value / max : 0));
  return (
    <div className={cx('h-1.5 w-full overflow-hidden rounded-full bg-[var(--chip)]', className)}>
      <div className="h-full rounded-full" style={{ width: `${p * 100}%`, background: toneVar[tone] }} />
    </div>
  );
}

/** Multi-series chart with optional band. Measures its container so text never stretches. */
export function Chart({ series, band, labels, refLines = [], bars }: {
  series: { values: number[]; color: string; label: string; dash?: boolean }[];
  band?: { lo: number[]; hi: number[]; color: string };
  labels?: string[]; refLines?: { y: number; label: string; color: string }[];
  bars?: { values: number[]; color: string };
}) {
  const { ref, w: cw, h: ch } = useSize<HTMLDivElement>();
  const W = Math.max(80, cw), H = Math.max(60, ch);
  const all = [...series.flatMap((s) => s.values), ...(band ? [...band.lo, ...band.hi] : []), ...refLines.map((r) => r.y), ...(bars?.values ?? []), ...(bars ? [0] : [])];
  let body: ReactNode = null;
  if (all.length && cw > 0) {
    const lo = Math.min(...all), hi = Math.max(...all);
    const pad = (hi - lo) * 0.1 || 1;
    const a = lo - pad, b = hi + pad;
    const n = Math.max(...series.map((s) => s.values.length), band?.lo.length ?? 0, bars?.values.length ?? 0);
    const L = 46;
    const X = (i: number) => (i / Math.max(1, n - 1)) * (W - L - 10) + L;
    const Y = (v: number) => H - 18 - ((v - a) / (b - a)) * (H - 26);
    const ticks = [a + pad, (a + b) / 2, b - pad];
    body = (
      <svg width={W} height={H} className="block">
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={L} x2={W - 4} y1={Y(t)} y2={Y(t)} stroke="var(--line)" />
            <text x={L - 6} y={Y(t) + 3} textAnchor="end" fontSize={10} fill="var(--muted)" className="num">{Math.round(t).toLocaleString('en-IN')}</text>
          </g>
        ))}
        {bars && bars.values.map((v, i) => {
          const bw = Math.max(2, (W - L - 10) / n * 0.6);
          return <rect key={i} x={X(i) - bw / 2} y={Math.min(Y(v), Y(0))} width={bw} height={Math.abs(Y(v) - Y(0))} fill={bars.color} rx={1} />;
        })}
        {band && <polygon fill={band.color} points={[...band.hi.map((v, i) => `${X(i)},${Y(v)}`), ...band.lo.map((v, i) => `${X(i)},${Y(v)}`).reverse()].join(' ')} />}
        {refLines.map((r, i) => (
          <g key={i}>
            <line x1={L} x2={W - 4} y1={Y(r.y)} y2={Y(r.y)} stroke={r.color} strokeDasharray="4 4" />
            <text x={W - 6} y={Y(r.y) - 3} textAnchor="end" fontSize={9} fill={r.color}>{r.label}</text>
          </g>
        ))}
        {series.map((s, k) => (
          <g key={k}>
            <polyline fill="none" stroke={s.color} strokeWidth={2} strokeDasharray={s.dash ? '5 4' : undefined} strokeLinejoin="round"
              points={s.values.map((v, i) => `${X(i)},${Y(v)}`).join(' ')} />
            {!s.dash && n <= 16 && s.values.map((v, i) => <circle key={i} cx={X(i)} cy={Y(v)} r={3} fill="#fff" stroke={s.color} strokeWidth={2} />)}
          </g>
        ))}
        {labels && labels.map((l, i) => (i % Math.ceil(labels.length / 7) === 0 ? (
          <text key={i} x={X(i)} y={H - 4} fontSize={10} textAnchor="middle" fill="var(--muted)">{l}</text>
        ) : null))}
      </svg>
    );
  }
  return <div ref={ref} className="h-full min-h-0 w-full overflow-hidden">{body}</div>;
}

/* ================================================================= popover & modal */

export function Popover({ label, children, width = 'w-72', align = 'right', className }: {
  label: ReactNode; children: ReactNode | ((close: () => void) => ReactNode); width?: string; align?: 'left' | 'right'; className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const k = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('mousedown', h);
    window.addEventListener('keydown', k);
    return () => { window.removeEventListener('mousedown', h); window.removeEventListener('keydown', k); };
  }, []);
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(!open)} aria-expanded={open}
        className={cx('flex h-7 items-center gap-1.5 rounded-md border border-[var(--line-strong)] bg-[var(--s2)] px-2 text-xs hover:bg-[var(--s3)]', className)}>
        {label}<Icon name="down" size={11} className="text-[var(--muted)]" />
      </button>
      {open && (
        <div className={cx('glass-strong absolute top-full z-50 mt-1.5 rounded-lg p-2 shadow-2xl', align === 'right' ? 'right-0' : 'left-0', width)}>
          {typeof children === 'function' ? children(() => setOpen(false)) : children}
        </div>
      )}
    </div>
  );
}

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4" onClick={onClose}>
      <div role="dialog" aria-modal className={cx('glass-strong w-full rounded-xl shadow-2xl', width)} onClick={(e) => e.stopPropagation()}>
        <header className="flex items-center justify-between border-b border-[var(--line)] px-4 py-2.5">
          <h3 className="text-sm font-semibold">{title}</h3>
          <Btn kind="ghost" small onClick={onClose} title="Close" icon="x" />
        </header>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

/* ================================================================= toasts + actions */

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
      <div className="pointer-events-none fixed bottom-12 left-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2">
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
