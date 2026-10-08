import { TimingMap } from '@reelcraft/shared';

/** The word timings an artifact carries: a transcription's data is a
 * `TimingMap`; Generate Speech keeps one under `timing` beside its audio.
 * Either artifact's handle is a valid captions `timingHandle`. */
export function timingMapOf(data: unknown): TimingMap | undefined {
  const direct = TimingMap.safeParse(data);
  if (direct.success) return direct.data;
  const nested = TimingMap.safeParse((data as { timing?: unknown } | null | undefined)?.timing);
  return nested.success ? nested.data : undefined;
}
