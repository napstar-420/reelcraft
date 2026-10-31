/** Elapsed time as a clock: "0:42", "4:12", "1:02:03". Uses `now` while it is still going. */
export function formatElapsed(startedAt: string, endedAt: string | null, now = Date.now()): string {
  const ms = (endedAt ? new Date(endedAt).getTime() : now) - new Date(startedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '0:00';
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** A money amount for display: "$0.62". */
export function formatUsd(value: number): string {
  return `$${value.toFixed(2)}`;
}
