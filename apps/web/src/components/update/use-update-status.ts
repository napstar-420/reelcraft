import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { UPDATE_STATUS_KEY, type UpdateTarget } from './update-dialog';
import { installOutcome } from './update.logic';

/** The updater's status, polled quickly while an update runs, plus the
 * update this view started (if any). Shared by the sidebar indicator and
 * the Settings page. */
export function useUpdateStatus() {
  const [target, setTarget] = useState<UpdateTarget | null>(null);
  const status = useQuery({
    queryKey: UPDATE_STATUS_KEY,
    queryFn: () => api.getUpdateStatus(),
    // Poll quickly while an update runs; the app restarts during it, so
    // failed polls are expected and simply retried.
    refetchInterval: (query) => {
      const data = query.state.data;
      const waiting = target !== null && (!data || installOutcome(data, target) === null);
      return waiting || (data && data.phase !== 'idle') ? 2000 : 60_000;
    },
    retry: false,
  });
  return { status, target, setTarget };
}
