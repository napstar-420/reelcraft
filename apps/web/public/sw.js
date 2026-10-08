/* Reelcraft service worker: shows Web Push notifications, even with every tab
 * closed, and opens the right page when one is clicked. It has no fetch
 * handler, so it never touches /api or /storage. Plain JS because it is served
 * as-is from the site root. */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let note = {};
  try {
    note = event.data ? event.data.json() : {};
  } catch {
    // an unreadable payload still gets a notification: browsers (Safari
    // especially) revoke permission when a push shows nothing
  }
  // Always shown, even when a tab is open: the tab skips its own toast while
  // a subscription is active, so the user gets exactly one alert.
  event.waitUntil(
    self.registration.showNotification(note.title || 'Reelcraft', {
      body: note.body || '',
      tag: note.id,
      icon: '/favicon.svg',
      data: { id: note.id, url: note.url || '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const { id, url } = event.notification.data || {};
  event.waitUntil(
    (async () => {
      if (id) {
        try {
          await fetch('/api/notifications/' + encodeURIComponent(id) + '/read', { method: 'POST' });
        } catch {
          // the page marks it read when it opens; this is only a head start
        }
      }
      const target = url || '/';
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const open = windows.find((client) => new URL(client.url).origin === self.location.origin);
      if (open) {
        await open.focus();
        open.postMessage({ type: 'reelcraft:navigate', url: target });
      } else {
        await self.clients.openWindow(new URL(target, self.location.origin).href);
      }
    })(),
  );
});
