const inr = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });

export const rs = (v: number | null | undefined) => (v == null ? '—' : `₹${inr.format(Math.round(v))}`);

/** ₹ in lakh / crore for compact display. */
export const rsShort = (v: number | null | undefined) => {
  if (v == null) return '—';
  const a = Math.abs(v);
  const s = v < 0 ? '−' : '';
  if (a >= 1e7) return `${s}₹${(a / 1e7).toFixed(2)} Cr`;
  if (a >= 1e5) return `${s}₹${(a / 1e5).toFixed(2)} L`;
  return `${s}₹${inr.format(Math.round(a))}`;
};

export const mw = (v: number | null | undefined, dp = 0) => (v == null ? '—' : `${v.toFixed(dp)} MW`);
export const num = (v: number | null | undefined, dp = 0) => (v == null ? '—' : v.toLocaleString('en-IN', { maximumFractionDigits: dp, minimumFractionDigits: dp }));
export const pct = (v: number | null | undefined, dp = 0) => (v == null ? '—' : `${(v * 100).toFixed(dp)}%`);

export const hhmm = (s: number | null | undefined) => {
  if (s == null) return '—';
  const t = ((Math.floor(s) % 86400) + 86400) % 86400;
  return `${String(Math.floor(t / 3600)).padStart(2, '0')}:${String(Math.floor((t % 3600) / 60)).padStart(2, '0')}`;
};

export const hhmmss = (s: number | null | undefined) => {
  if (s == null) return '—';
  const t = ((Math.floor(s) % 86400) + 86400) % 86400;
  return `${hhmm(t)}:${String(t % 60).padStart(2, '0')}`;
};

export const dur = (sec: number | null | undefined) => {
  if (sec == null) return '—';
  if (sec < 90) return `${Math.round(sec)} s`;
  if (sec < 5400) return `${Math.round(sec / 60)} min`;
  return `${(sec / 3600).toFixed(1)} h`;
};

export const hourWindow = (w: [number, number]) => {
  const f = (h: number) => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;
  return `${f(w[0])}–${f(w[1])}`;
};
