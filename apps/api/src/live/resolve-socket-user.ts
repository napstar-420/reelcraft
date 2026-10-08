import type { Handshake } from 'socket.io/dist/socket-types';

/**
 * REQ-17.3 — mirror of the `@Owner()` seam for sockets. Always 'local' in v1;
 * this is the one place that learns about authentication once it exists, and
 * every room name derives from its result.
 */
export function resolveSocketUser(_handshake: Handshake): string {
  return 'local';
}

export const userRoom = (userId: string): string => `user:${userId}`;

export const assistantRoom = (sessionId: string): string => `assistant:${sessionId}`;
