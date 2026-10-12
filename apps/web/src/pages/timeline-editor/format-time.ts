const pad = (value: number, length = 2) => String(value).padStart(length, '0');

/** `1:07.20`: minutes, seconds and the frame within the second, the way editors show a position. */
export function formatTimecode(seconds: number, fps: number): string {
  const safe = Math.max(0, seconds);
  const whole = Math.floor(safe);
  const frame = Math.min(fps - 1, Math.floor((safe - whole) * fps + 1e-6));
  return `${Math.floor(whole / 60)}:${pad(whole % 60)}.${pad(frame)}`;
}

/** `3.8s` or `1:07`: a length for a clip label or a ruler tick. */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds * 10) / 10}s`;
  return `${Math.floor(seconds / 60)}:${pad(Math.round(seconds % 60))}`;
}

/** The ruler's tick spacing for a zoom level: the smallest nice step that keeps labels apart. */
export function rulerStepSec(pxPerSec: number, minLabelPx = 84): number {
  const steps = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
  return steps.find((step) => step * pxPerSec >= minLabelPx) ?? 600;
}
