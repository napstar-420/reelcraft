import type { NotificationKind } from '@reelcraft/shared';
import { api } from '@/api/client';
import {
  enabledKinds,
  loadNotificationPrefs,
  saveNotificationPrefs,
} from '@/lib/notification-prefs';
import {
  decidePushSupport,
  isPushActive as pushActiveFor,
  sameKey,
  urlBase64ToUint8Array,
  type PushSupport,
} from '@/lib/push.logic';

const SERVICE_WORKER_URL = '/sw.js';

function permission(): NotificationPermission | null {
  return typeof Notification === 'undefined' ? null : Notification.permission;
}

export function pushSupport(): PushSupport {
  return decidePushSupport({
    secure: window.isSecureContext,
    serviceWorker: 'serviceWorker' in navigator,
    pushManager: 'PushManager' in window,
    notification: typeof Notification !== 'undefined',
    permission: permission(),
  });
}

/** Whether a system notification already covers this browser right now. */
export function isPushActive(): boolean {
  return pushActiveFor(loadNotificationPrefs(), permission());
}

/** Registers the worker, subscribes against the server's current key, and tells
 * the server which kinds this browser wants. Safe to repeat: it reuses a
 * subscription made against the same key and replaces one made against another. */
async function subscribe(kinds: NotificationKind[]): Promise<void> {
  const registration = await navigator.serviceWorker.register(SERVICE_WORKER_URL);
  await navigator.serviceWorker.ready;
  const key = urlBase64ToUint8Array((await api.getVapidPublicKey()).publicKey);
  let subscription = await registration.pushManager.getSubscription();
  if (subscription && !sameKey(subscription.options.applicationServerKey, key)) {
    await subscription.unsubscribe();
    subscription = null;
  }
  subscription ??= await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: key,
  });
  const keys = subscription.toJSON().keys;
  if (!keys?.p256dh || !keys.auth) throw new Error('The browser gave no encryption keys.');
  await api.savePushSubscription({
    endpoint: subscription.endpoint,
    keys: { p256dh: keys.p256dh, auth: keys.auth },
    kinds,
  });
}

/** Call from the click that turns the switch on: the permission prompt needs a
 * user gesture. */
export async function enablePush(kinds: NotificationKind[]): Promise<'enabled' | 'denied'> {
  if (Notification.permission !== 'granted') {
    if ((await Notification.requestPermission()) !== 'granted') return 'denied';
  }
  await subscribe(kinds);
  saveNotificationPrefs({ push: true });
  return 'enabled';
}

export async function disablePush(): Promise<void> {
  saveNotificationPrefs({ push: false });
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return;
  // The server forgets it either way: a push to a dead endpoint is removed.
  await api.deletePushSubscription(subscription.endpoint).catch(() => undefined);
  await subscription.unsubscribe();
}

/** Keeps the server in step with this browser: on every page load, and when the
 * kinds change. Also repairs a subscription the server lost or no longer
 * recognises (it started over with a new key), so no separate rotation
 * handling is needed. Never throws: it is housekeeping. */
export async function syncPush(kinds: NotificationKind[]): Promise<void> {
  try {
    if (pushSupport() !== 'ready' || !isPushActive()) return;
    await subscribe(kinds);
  } catch (error) {
    console.warn('Could not update system notifications', error);
  }
}

export function syncPushFromPrefs(): Promise<void> {
  return syncPush(enabledKinds(loadNotificationPrefs()));
}
