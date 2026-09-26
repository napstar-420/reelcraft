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

export function formatOffset(ms: number): string {
  return ms < 1000 ? `+${ms}ms` : `+${(ms / 1000).toFixed(1)}s`;
}
