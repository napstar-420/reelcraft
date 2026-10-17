import { useCallback, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { useRun } from './useRun';

/** Backs the blueprint canvas's run dock: tracks which run is "active" for
 * this blueprint (most recent by default, or whichever one was just
 * started/switched to) and layers `useRun`'s live-updating detail fetch on
 * top of it. */
export function useCanvasRun(blueprintId: string | undefined) {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeRunId = searchParams.get('run') || undefined;
  const setActiveRunId = useCallback(
    (runId: string) => {
      setSearchParams(
        (params) => {
          params.set('run', runId);
          return params;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const latestRuns = useQuery({
    queryKey: ['runs', { blueprintId, limit: 20 }],
    queryFn: () =>
      api.listRuns({ blueprintId, includeDryRuns: true, includeDrafts: true, limit: 20 }),
    enabled: Boolean(blueprintId),
  });

  useEffect(() => {
    if (activeRunId !== undefined) return;
    const latest = latestRuns.data?.items[0];
    if (latest) setActiveRunId(latest.id);
  }, [activeRunId, latestRuns.data, setActiveRunId]);

  const run = useRun(activeRunId);

  return {
    activeRunId,
    setActiveRunId,
    run: run.data,
    recentRuns: latestRuns.data?.items ?? [],
    isLoading: activeRunId === undefined && latestRuns.isLoading,
  };
}
