import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';

/** REQ-2.8.4 — the UI is a view over Run state, not the driver of it. This
 * hook only reads and re-fetches; it never advances anything itself. */
export function useRun(runId: string | undefined) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ['run', runId],
    queryFn: () => api.getRun(runId as string),
    enabled: Boolean(runId),
  });

  useEffect(() => {
    if (!runId) return;
    const source = new EventSource(`/api/runs/${runId}/events`);
    source.onmessage = () => {
      void queryClient.invalidateQueries({ queryKey: ['run', runId] });
    };
    // Fallback in case SSE drops silently.
    const interval = setInterval(() => {
      void queryClient.invalidateQueries({ queryKey: ['run', runId] });
    }, 3000);
    return () => {
      source.close();
      clearInterval(interval);
    };
  }, [runId, queryClient]);

  return query;
}
