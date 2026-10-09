import type { NotificationDto } from './notification.dto';

/**
 * Socket.IO contract for live updates. Types only, so the CommonJS-built
 * shared package stays importable by the Vite web app. Payloads are
 * invalidation hints: the client refetches the affected queries instead of
 * trusting pushed data.
 */
export interface ServerToClientEvents {
  'run:updated': (payload: { runId: string }) => void;
  'stage:updated': (payload: { runId: string; stageKey: string }) => void;
  /** A notification was recorded for this user. */
  'notification:created': (notification: NotificationDto) => void;
  /** Read state changed (here or in another tab); refetch the list. */
  'notifications:changed': () => void;
}

export type ClientToServerEvents = Record<never, never>;
