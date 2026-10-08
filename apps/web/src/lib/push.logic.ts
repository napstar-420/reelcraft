export type PushSupport = 'unsupported' | 'insecure' | 'denied' | 'ready';

/** Why system notifications can or can't be turned on here. Service workers and
 * push only exist in a secure context: https, or localhost. A Reelcraft opened
 * by a LAN address over plain http gets neither, whatever the browser. */
export function decidePushSupport(env: {
  secure: boolean;
  serviceWorker: boolean;
  pushManager: boolean;
  notification: boolean;
  permission: NotificationPermission | null;
}): PushSupport {
  if (!env.secure) return 'insecure';
  if (!env.serviceWorker || !env.pushManager || !env.notification) return 'unsupported';
  if (env.permission === 'denied') return 'denied';
  return 'ready';
}

/** True when a system notification already covers this browser, so a toast
 * would be a second alert for the same event. */
export function isPushActive(
  prefs: { push?: boolean },
  permission: NotificationPermission | null,
): boolean {
  return prefs.push === true && permission === 'granted';
}

/** The server gives its VAPID key as URL-safe base64; the Push API wants bytes. */
export function urlBase64ToUint8Array(value: string): Uint8Array<ArrayBuffer> {
  const padded = value + '='.repeat((4 - (value.length % 4)) % 4);
  const raw = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/** Whether a browser's existing subscription was made against this server key.
 * A different key (the server started over) means it must resubscribe. */
export function sameKey(current: ArrayBuffer | null, expected: Uint8Array): boolean {
  if (!current) return false;
  const bytes = new Uint8Array(current);
  return bytes.length === expected.length && bytes.every((byte, i) => byte === expected[i]);
}

/** The service worker tells the page where to go. Only an in-app path is
 * followed, never a full URL or a `//host` one. */
export function safeInternalPath(url: unknown): string | null {
  if (typeof url !== 'string') return null;
  if (!url.startsWith('/') || url.startsWith('//') || url.startsWith('/\\')) return null;
  return url;
}
