export type QueryKey = readonly unknown[];

export type LiveUpdate =
  { type: 'run'; runId: string } | { type: 'stage'; runId: string; stageKey: string };

/** Which cached queries a server hint makes stale. Never `run-reused-stages`:
 * it fetches the logs of every stage, so refetching it per event would cost
 * one request per stage each time. */
export function queryKeysFor(update: LiveUpdate): QueryKey[] {
  const keys: QueryKey[] = [['run', update.runId], ['runs']];
  if (update.type === 'stage') {
    for (const name of ['stage-output', 'stage-attempts', 'stage-logs', 'approval-candidate']) {
      keys.push([name, update.runId, update.stageKey]);
    }
  }
  return keys;
}

export interface InvalidationBatcher {
  add(keys: readonly QueryKey[]): void;
  dispose(): void;
}

/**
 * Coalesces bursts of server hints into one invalidation per distinct key.
 * Throttled, not debounced: the first key starts the timer and later keys just
 * join the batch, so a steady stream of events cannot postpone the refetch
 * forever. TanStack's `invalidateQueries` cancels in-flight fetches by
 * default, which is why per-event invalidation would starve a slow query.
 */
export function createInvalidationBatcher(
  invalidate: (key: QueryKey) => void,
  delayMs = 250,
  schedule: (fn: () => void, ms: number) => unknown = setTimeout,
  cancel: (handle: unknown) => void = (handle) => clearTimeout(handle as never),
): InvalidationBatcher {
  const pending = new Map<string, QueryKey>();
  let timer: unknown;

  const flush = () => {
    timer = undefined;
    const keys = [...pending.values()];
    pending.clear();
    for (const key of keys) invalidate(key);
  };

  return {
    add(keys) {
      for (const key of keys) pending.set(JSON.stringify(key), key);
      if (timer === undefined && pending.size > 0) timer = schedule(flush, delayMs);
    },
    dispose() {
      if (timer !== undefined) cancel(timer);
      timer = undefined;
      pending.clear();
    },
  };
}
