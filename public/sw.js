// THE KITCHEN service worker: shows meal, water and exercise reminders sent
// by the server (Web Push) and opens the right page when one is tapped.
// It does not cache pages, so the site always loads fresh.
self.addEventListener('install', () => self.skipWaiting());
// On every update, delete any caches an older version may have left behind.
self.addEventListener('activate', (event) => event.waitUntil((async () => {
  const keys = await caches.keys();
  await Promise.all(keys.map((key) => caches.delete(key)));
  await self.clients.claim();
})()));

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'THE KITCHEN';
  const options = {
    body: data.body || 'You have a new reminder.',
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-96.png',
    tag: data.tag || 'kitchen',
    renotify: true,
    data: { url: data.url || '/diet-monitoring.html' },
    actions: Array.isArray(data.actions) ? data.actions.slice(0, 2) : []
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || '/diet-monitoring.html', self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if (new URL(client.url).origin === self.location.origin && 'focus' in client) {
        await client.focus();
        if ('navigate' in client) return client.navigate(target);
        return client;
      }
    }
    return self.clients.openWindow(target);
  })());
});

// The browser can renew a subscription; tell the server about the new one.
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil((async () => {
    const options = event.oldSubscription && event.oldSubscription.options;
    if (!options) return;
    const subscription = await self.registration.pushManager.subscribe(options);
    await fetch('/api/reminders/subscribe', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription: subscription.toJSON() })
    });
  })());
});
