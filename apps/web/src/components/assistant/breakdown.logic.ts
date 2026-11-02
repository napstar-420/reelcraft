import type { BreakdownMake } from '@reelcraft/shared';

/** How each shot would be made, in the UI's words. */
export const MAKE_LABELS: Record<BreakdownMake, string> = {
  generate_image: 'Picture',
  generate_video: 'Video clip',
  motion_graphic: 'Motion graphic',
  library_asset: 'From the Library',
  reference_frame: 'Style reference',
  text_only: 'Text card',
  other: 'Other',
};

/** The shot playing at `seconds` (the last one once past the end). */
export function shotAt(
  shots: Array<{ index: number; startSec: number; endSec: number }>,
  seconds: number,
): number {
  const found = shots.find((s) => seconds >= s.startSec && seconds < s.endSec);
  return found ? found.index : (shots.at(-1)?.index ?? 0);
}
