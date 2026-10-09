import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { createInvalidationBatcher, queryKeysFor } from '@/lib/live-invalidation.logic';
import { socket } from '@/lib/socket';

/** The UI is a view over server state (REQ-2.8.4): the server only says what
 * changed, and this hook refetches the affected queries. Mounted once at the
 * app root, because the timeline editor renders without the app shell. */
export function useLiveUpdates(): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    const batcher = createInvalidationBatcher((queryKey) => {
      void queryClient.invalidateQueries({ queryKey });
    });
    let connectedBefore = false;

    const onConnect = () => {
      // After a drop (API restart, in-app update, sleeping laptop) anything
      // could have changed while no events were delivered.
      if (connectedBefore) void queryClient.invalidateQueries();
      connectedBefore = true;
    };
    const onRun = ({ runId }: { runId: string }) =>
      batcher.add(queryKeysFor({ type: 'run', runId }));
    const onStage = ({ runId, stageKey }: { runId: string; stageKey: string }) =>
      batcher.add(queryKeysFor({ type: 'stage', runId, stageKey }));

    socket.on('connect', onConnect);
    socket.on('run:updated', onRun);
    socket.on('stage:updated', onStage);
    // `connect` fired before this effect ran if the socket was already up.
    if (socket.connected) connectedBefore = true;

    return () => {
      socket.off('connect', onConnect);
      socket.off('run:updated', onRun);
      socket.off('stage:updated', onStage);
      batcher.dispose();
    };
  }, [queryClient]);
}
