import type { StageDef } from '@reelcraft/shared';
import { memoryBaseKey, memoryWritersBefore, producerOf, stageRefLeaves } from '@/lib/stage-deps';

export type StageRead = {
  /** What is read: a Run Memory key, or `stage:<key>` for a stage's whole output. */
  key: string;
  /** The stages that produced it (can be several when more than one writes the same key). */
  fromStageKeys: string[];
};

/** What a stage reads from earlier work, once per source: memory keys and other stages' outputs. */
export function stageReads(graph: StageDef[], stageKey: string): StageRead[] {
  const index = graph.findIndex((s) => s.key === stageKey);
  if (index < 0) return [];
  const reads = new Map<string, StageRead>();
  for (const ref of stageRefLeaves(graph[index]!)) {
    if (ref.from === 'memory') {
      const key = memoryBaseKey(ref.key);
      reads.set(key, { key, fromStageKeys: memoryWritersBefore(graph, key, index) });
    } else if (ref.from === 'prev' || ref.from === 'stage') {
      const producer = producerOf(ref, graph, index);
      if (producer)
        reads.set(`stage:${producer}`, { key: `stage:${producer}`, fromStageKeys: [producer] });
    }
  }
  return [...reads.values()];
}

/** The reason a stage failed, as the run stored it. */
export function failureReason(failure: unknown): string | null {
  if (!failure || typeof failure !== 'object') return null;
  const { reason, message } = failure as { reason?: unknown; message?: unknown };
  const text = typeof message === 'string' && message ? message : reason;
  return typeof text === 'string' && text ? text : null;
}

/** The mark on an item's chip: has output, out of date, or nothing yet. */
export function itemMark(hasOutput: boolean, stale: boolean): string {
  return hasOutput ? '✓' : stale ? '⟳' : '·';
}

/** The warning shown above an out-of-date output. */
export const STALE_WARNING =
  'Out of date: an earlier stage changed after this was made. Re-run it to refresh.';

/** What to say for an item that has no output to show. */
export function itemEmptyText(itemIndex: number, stale: boolean): string {
  return stale
    ? `Item ${itemIndex + 1} is out of date: an earlier stage changed. Re-run it to refresh.`
    : `Item ${itemIndex + 1} has no output yet.`;
}
