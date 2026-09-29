import type { StageEventDto } from '@reelcraft/shared';

export interface StageLogLine extends StageEventDto {
  /** Milliseconds since the first visible event of the same attempt. */
  offsetMs: number;
}

/** Events for one attempt (or the stage-level events when `attemptId` is
 * null), debug hidden unless asked for, each stamped with its offset from
 * the attempt's first event. */
export function stageLogLines(
  events: StageEventDto[],
  attemptId: string | null,
  showDebug: boolean,
): StageLogLine[] {
  const scoped = events.filter(
    (event) => event.stageAttemptId === attemptId && (showDebug || event.level !== 'debug'),
  );
  const start = scoped.length ? Date.parse(scoped[0]!.createdAt) : 0;
  return scoped.map((event) => ({ ...event, offsetMs: Date.parse(event.createdAt) - start }));
}

/** `+250ms`, `+2.5s`, then whole units past a minute: `+2m 51s`, `+1h 5m`. */
export function formatOffset(ms: number): string {
  if (ms < 1000) return `+${ms}ms`;
  if (ms < 60_000) return `+${(ms / 1000).toFixed(1)}s`;
  const total = Math.round(ms / 1000);
  const parts = [
    [Math.floor(total / 3600), 'h'],
    [Math.floor((total % 3600) / 60), 'm'],
    [total % 60, 's'],
  ] as const;
  return `+${parts
    .filter(([n]) => n > 0)
    .map(([n, unit]) => `${n}${unit}`)
    .join(' ')}`;
}
