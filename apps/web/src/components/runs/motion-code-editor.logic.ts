import type { MotionSource } from '@reelcraft/shared';

/** The longest a motion graphic may run, as the API allows (`MOTION_LIMITS`). */
export const MOTION_MAX_SEC = 60;
export const MOTION_MIN_SEC = 1;

/** Reads a motion graphic out of an artifact's data, or nothing when it isn't one. */
export function motionSourceOf(data: unknown): MotionSource | undefined {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return undefined;
  const value = data as Partial<MotionSource>;
  return value.version === 1 &&
    typeof value.code === 'string' &&
    typeof value.width === 'number' &&
    typeof value.height === 'number' &&
    typeof value.fps === 'number' &&
    typeof value.durationSec === 'number' &&
    (value.background === 'transparent' || value.background === 'opaque')
    ? (value as MotionSource)
    : undefined;
}

/** The graphic with the edited code and length; the length is held inside what a render allows. */
export function editedSource(
  original: MotionSource,
  code: string,
  durationSec: number,
): MotionSource {
  const length = Number.isFinite(durationSec) ? durationSec : original.durationSec;
  return {
    ...original,
    code,
    durationSec: Math.min(MOTION_MAX_SEC, Math.max(MOTION_MIN_SEC, length)),
  };
}

/** Whether the edit changes anything worth saving. */
export function hasChanges(original: MotionSource, edited: MotionSource): boolean {
  return original.code !== edited.code || original.durationSec !== edited.durationSec;
}
