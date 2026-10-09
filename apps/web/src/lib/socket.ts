import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@reelcraft/shared';

/**
 * One socket for the whole app. It lives at module level and is never
 * disconnected by components, so React StrictMode's double mount only adds
 * and removes listeners. The path sits under `/api` so the same dev proxy and
 * production server that handle the API also handle it.
 */
export const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io({
  path: '/api/socket.io',
});
