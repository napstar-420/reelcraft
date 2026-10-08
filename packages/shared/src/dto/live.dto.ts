/**
 * Socket.IO contract for live updates. Types only, so the CommonJS-built
 * shared package stays importable by the Vite web app. Payloads are
 * invalidation hints: the client refetches the affected queries instead of
 * trusting pushed data.
 */
export interface ServerToClientEvents {
  'run:updated': (payload: { runId: string }) => void;
  'stage:updated': (payload: { runId: string; stageKey: string }) => void;
}

export type ClientToServerEvents = Record<never, never>;
