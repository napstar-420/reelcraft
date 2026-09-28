import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { useRun } from './useRun';

/** Backs the blueprint canvas's run dock: tracks which run is "active" for
 * this blueprint (most recent by default, or whichever one was just
 * started/switched to) and layers `useRun`'s live-updating detail fetch on
 * top of it. */
export function useCanvasRun(blueprintId: string | undefined) {
  const [activeRunId, setActiveRunId] = useState<string | undefined>(undefined);

  const latestRuns = useQuery({
    queryKey: ['runs', { blueprintId, limit: 1 }],
    queryFn: () => api.listRuns({ blueprintId, includeDryRuns: true, limit: 1 }),
    enabled: Boolean(blueprintId) && activeRunId === undefined,
  });

  useEffect(() => {
    if (activeRunId !== undefined) return;
    const latest = latestRuns.data?.items[0];
    if (latest) setActiveRunId(latest.id);
  }, [activeRunId, latestRuns.data]);

  const run = useRun(activeRunId);

  return {
    activeRunId,
    setActiveRunId,
    run: run.data,
    isLoading: activeRunId === undefined && latestRuns.isLoading,
  };
}
