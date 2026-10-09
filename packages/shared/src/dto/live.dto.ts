import type { AssistantStreamEvent } from './assistant.dto';
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
  /** A chat the socket is watching changed. Unlike the others this carries data:
   * streamed text arrives token by token and is not worth a refetch each. */
  'assistant:event': (payload: { sessionId: string; event: AssistantStreamEvent }) => void;
}

export interface ClientToServerEvents {
  /** Start receiving a chat's events. The ack comes after the socket has joined
   * the chat's room, so a refetch sent then cannot miss an event; `false` means
   * the chat doesn't exist or belongs to someone else. */
  'assistant:watch': (sessionId: string, ack?: (joined: boolean) => void) => void;
  'assistant:unwatch': (sessionId: string) => void;
}
