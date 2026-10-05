/** Width of a stage node on the blueprint canvas. */
export const STAGE_NODE_WIDTH = 256;

/** Horizontal distance between stage nodes on the blueprint canvas. The
 * layout and the drag-to-reorder drop maths must use the same value, or a
 * drop lands on the wrong slot. */
export const STAGE_SPACING_X = 336;

/** The gap left between two neighbouring nodes (where the connector and the
 * insert button live). */
export const STAGE_GAP_X = STAGE_SPACING_X - STAGE_NODE_WIDTH;

/** The Start node (blueprint inputs, role, run cap) sits one slot before the
 * first stage; it is not part of the graph and never moves. */
export const START_NODE_WIDTH = 208;
export const START_NODE_X = -(START_NODE_WIDTH + STAGE_GAP_X);

/** Top of every node, leaving room for the frame label above it. */
export const NODE_TOP_Y = 44;

/** Vertical position of a node's ports: the middle of its header row. */
export const PORT_Y = NODE_TOP_Y + 28;

export function stageX(index: number): number {
  return index * STAGE_SPACING_X;
}

/** The stage index a node dropped at `x` moves to: the nearest slot,
 * clamped to the graph. */
export function dropIndex(x: number, stageCount: number): number {
  if (stageCount <= 0) return 0;
  return Math.min(Math.max(Math.round(x / STAGE_SPACING_X), 0), stageCount - 1);
}

/** The x of the `+` button between slot `index - 1` and slot `index`
 * (index 0 is the connector from the Start node). */
export function insertButtonX(index: number): number {
  const left = index === 0 ? START_NODE_X + START_NODE_WIDTH : stageX(index - 1) + STAGE_NODE_WIDTH;
  return left + STAGE_GAP_X / 2;
}
