export const short = (h: string, head = 10, tail = 6): string =>
  h.length > head + tail + 1 ? `${h.slice(0, head)}…${h.slice(-tail)}` : h;

export const pct = (bps: number): string => `${(bps / 100).toFixed(1)}%`;

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return 'undated';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toISOString().slice(0, 10);
}

export function fmtDuration(seconds: number): string {
  if (seconds <= 0) return 'now';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return m > 0 ? `${m}m ${s.toString().padStart(2, '0')}s` : `${s}s`;
}
