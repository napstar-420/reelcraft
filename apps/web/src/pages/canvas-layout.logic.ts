import type { StageDef } from '@reelcraft/shared';
import { stageDependencies } from '../lib/stage-deps';

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

/** Vertical distance between two lanes: stages that run side by side stack
 * with this spacing. */
export const STAGE_SPACING_Y = 360;

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

/** Where a stage sits: `level` is its column (the longest chain of stages it
 * waits for), `lane` its row among stages in the same column. */
export type StageSlot = { level: number; lane: number };

/** Layered layout, recomputed from the graph and never persisted. A chain puts
 * stage i in column i, lane 0, exactly as before. A stage that waits for others
 * goes one column right of the furthest one; where several share a column, the
 * later one takes the first free lane at or below its first dependency's lane. */
export function stageLayout(graph: StageDef[]): StageSlot[] {
  const deps = stageDependencies(graph);
  const slots = new Map<string, StageSlot>();
  const taken = new Set<string>();
  return graph.map((stage) => {
    const waitsFor = (deps.get(stage.key) ?? []).flatMap((key) => slots.get(key) ?? []);
    const level = waitsFor.length === 0 ? 0 : Math.max(...waitsFor.map((s) => s.level)) + 1;
    let lane = waitsFor[0]?.lane ?? 0;
    while (taken.has(`${level}:${lane}`)) lane += 1;
    taken.add(`${level}:${lane}`);
    const slot = { level, lane };
    slots.set(stage.key, slot);
    return slot;
  });
}

/** True when the layout is a single row in graph order — the only layout where
 * dragging a card sideways has a clear meaning. */
export function isChainLayout(layout: StageSlot[]): boolean {
  return layout.every((slot, index) => slot.level === index && slot.lane === 0);
}

export function stageY(lane: number): number {
  return NODE_TOP_Y + lane * STAGE_SPACING_Y;
}

/** Edges worth drawing: each stage's dependencies minus those it reaches
 * through another dependency (a transitive reduction), as [from, to] pairs. */
export function reducedEdges(graph: StageDef[]): Array<[string, string]> {
  const deps = stageDependencies(graph);
  const reach = new Map<string, Set<string>>();
  const ancestorsOfKey = (key: string): Set<string> => {
    const known = reach.get(key);
    if (known) return known;
    const found = new Set<string>();
    reach.set(key, found);
    for (const dep of deps.get(key) ?? []) {
      found.add(dep);
      ancestorsOfKey(dep).forEach((a) => found.add(a));
    }
    return found;
  };
  const edges: Array<[string, string]> = [];
  for (const stage of graph) {
    const direct = (deps.get(stage.key) ?? []).filter((dep) => graph.some((s) => s.key === dep));
    for (const dep of direct) {
      const viaOther = direct.some((other) => other !== dep && ancestorsOfKey(other).has(dep));
      if (!viaOther) edges.push([dep, stage.key]);
    }
  }
  return edges;
}
