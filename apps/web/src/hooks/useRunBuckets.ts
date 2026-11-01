import { useQueries } from '@tanstack/react-query';
import type { RunSummaryDto } from '@reelcraft/shared';
import { api } from '@/api/client';
import { ACTIVE_STATES, NEEDS_YOU_STATES, newestFirst } from '@/lib/run-buckets';

const PER_STATE = 20;

/** The runs that need a person and the runs still going, across every channel (test runs
 * included). The list API filters by one state at a time, so each state is its own query;
 * they share the `runs` key, so live updates refresh them with the rest. */
export function useRunBuckets() {
  const states = [...NEEDS_YOU_STATES, ...ACTIVE_STATES];
  const results = useQueries({
    queries: states.map((state) => ({
      queryKey: ['runs', 'bucket', state],
      queryFn: () =>
        api.listRuns({ state, includeDryRuns: true, includeDrafts: true, limit: PER_STATE }),
    })),
  });
  const pick = (wanted: readonly string[]): RunSummaryDto[] =>
    newestFirst(
      results.flatMap((r, i) => (wanted.includes(states[i]!) ? (r.data?.items ?? []) : [])),
    );
  return {
    needsYou: pick(NEEDS_YOU_STATES),
    active: pick(ACTIVE_STATES),
    loading: results.some((r) => r.isLoading),
  };
}
