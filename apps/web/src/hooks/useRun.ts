import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';

/** REQ-2.8.4 — the UI is a view over Run state, not the driver of it. This
 * hook only reads; `useLiveUpdates` refetches it when the server says the run
 * changed, and it never advances anything itself. */
export function useRun(runId: string | undefined) {
  const query = useQuery({
    queryKey: ['run', runId],
    queryFn: () => api.getRun(runId as string),
    enabled: Boolean(runId),
  });

  return query;
}
