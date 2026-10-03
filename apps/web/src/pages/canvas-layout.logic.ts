/** Horizontal distance between stage nodes on the blueprint canvas. The
 * layout and the drag-to-reorder drop maths must use the same value, or a
 * drop lands on the wrong slot. */
export const STAGE_SPACING_X = 320;

export function stageX(index: number): number {
  return index * STAGE_SPACING_X;
}

/** The stage index a node dropped at `x` moves to: the nearest slot,
 * clamped to the graph. */
export function dropIndex(x: number, stageCount: number): number {
  if (stageCount <= 0) return 0;
  return Math.min(Math.max(Math.round(x / STAGE_SPACING_X), 0), stageCount - 1);
}
