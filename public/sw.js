// Spotter service worker: Web Push only. No fetch handler and no caching;
// the app is online-only.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

/** Only same-origin paths may be opened from a notification. */
function safePath(raw) {
  try {
    const url = new URL(raw || '/', self.location.origin);
    return url.origin === self.location.origin ? url.pathname + url.search + url.hash : '/';
  } catch {
    return '/';
  }
}

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }
  const tag = typeof data.tag === 'string' ? data.tag : undefined;
  event.waitUntil(
    self.registration.showNotification(typeof data.title === 'string' ? data.title : 'Spotter', {
      body: typeof data.body === 'string' ? data.body : '',
      tag,
      // A tag alone silently replaces; renotify makes the replacement buzz.
      renotify: !!(tag && data.renotify),
      icon: '/icons/icon-192.png',
      data: { url: safePath(data.url) },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const path = safePath(event.notification.data && event.notification.data.url);
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of windows) {
        if (new URL(client.url).origin !== self.location.origin) continue;
        await client.focus();
        if ('navigate' in client) await client.navigate(path).catch(() => {});
        return;
      }
      await self.clients.openWindow(path);
    })(),
  );
});
