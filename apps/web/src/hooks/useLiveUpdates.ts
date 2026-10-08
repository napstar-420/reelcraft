import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import type { NotificationDto } from '@reelcraft/shared';
import { NOTIFICATIONS_KEY } from '@/components/notifications/notification-bell';
import {
  shouldToast,
  toastDurationMs,
  toastTone,
} from '@/components/notifications/notifications.logic';
import { createInvalidationBatcher, queryKeysFor } from '@/lib/live-invalidation.logic';
import { loadNotificationPrefs } from '@/lib/notification-prefs';
import { isPushActive } from '@/lib/push';
import { safeInternalPath } from '@/lib/push.logic';
import { socket } from '@/lib/socket';

/** The UI is a view over server state (REQ-2.8.4): the server only says what
 * changed, and this hook refetches the affected queries. Mounted once at the
 * app root, because the timeline editor renders without the app shell. */
export function useLiveUpdates(): void {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

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
    const onNotificationsChanged = () =>
      void queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_KEY });
    const onNotification = (n: NotificationDto) => {
      void queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_KEY });
      const toastIt = shouldToast({
        kind: n.kind,
        prefs: loadNotificationPrefs(),
        visible: document.visibilityState === 'visible',
        pushActive: isPushActive(),
      });
      if (!toastIt) return;
      toast[toastTone(n.kind)](n.title, {
        description: n.body,
        duration: toastDurationMs(n.kind),
        action: { label: 'Open', onClick: () => navigate(n.url) },
      });
    };

    // A clicked system notification asks the page it focused to go to its link.
    const onWorkerMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; url?: unknown } | null;
      const path = data?.type === 'reelcraft:navigate' ? safeInternalPath(data.url) : null;
      if (path) navigate(path);
    };
    // Absent outside a secure context (plain http on a LAN address).
    navigator.serviceWorker?.addEventListener('message', onWorkerMessage);

    socket.on('connect', onConnect);
    socket.on('run:updated', onRun);
    socket.on('stage:updated', onStage);
    socket.on('notification:created', onNotification);
    socket.on('notifications:changed', onNotificationsChanged);
    // `connect` fired before this effect ran if the socket was already up.
    if (socket.connected) connectedBefore = true;

    return () => {
      navigator.serviceWorker?.removeEventListener('message', onWorkerMessage);
      socket.off('connect', onConnect);
      socket.off('run:updated', onRun);
      socket.off('stage:updated', onStage);
      socket.off('notification:created', onNotification);
      socket.off('notifications:changed', onNotificationsChanged);
      batcher.dispose();
    };
  }, [queryClient, navigate]);
}
