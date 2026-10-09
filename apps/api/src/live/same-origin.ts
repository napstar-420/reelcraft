import type { IncomingHttpHeaders, IncomingMessage } from 'node:http';

/**
 * CORS does not apply to WebSockets, and the API has no auth (ADR-0002), so
 * any web page could otherwise open a socket to a local Reelcraft and read
 * run data. Browsers always send `Origin` on a WebSocket handshake and
 * scripts cannot forge it. Non-browser clients send none and are allowed.
 */
export function isSameOrigin(headers: IncomingHttpHeaders): boolean {
  const origin = headers.origin;
  if (origin === undefined) return true;
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return false; // includes the literal "null" origin
  }
  const forwarded = headers['x-forwarded-host'];
  const forwardedHost = (Array.isArray(forwarded) ? forwarded[0] : forwarded)
    ?.split(',')[0]
    ?.trim();
  return (
    originHost === headers.host || (forwardedHost !== undefined && originHost === forwardedHost)
  );
}

/** engine.io `allowRequest`, called on every handshake (polling and websocket). */
export function sameOriginOnly(
  req: IncomingMessage,
  callback: (err: string | null | undefined, success: boolean) => void,
): void {
  if (isSameOrigin(req.headers)) callback(null, true);
  else callback('Origin not allowed', false);
}
