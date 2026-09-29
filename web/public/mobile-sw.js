/* Push only: never cache authenticated pages, transcripts, API responses or secrets. */
self.addEventListener('push', event => {
  let payload = {};
  try { payload = event.data?.json() ?? {}; } catch { /* Generic notification is safe. */ }
  const profile = typeof payload.profile === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(payload.profile) ? payload.profile : '';
  const scope = new URL(self.registration.scope);
  const url = `${scope.pathname}m${profile ? `?profile=${encodeURIComponent(profile)}` : ''}`;
  event.waitUntil(self.registration.showNotification('Hermes', {
    body: 'Frodo needs you',
    icon: `${scope.pathname}mobile-icon-192.png`,
    badge: `${scope.pathname}mobile-icon-192.png`,
    tag: typeof payload.request_id === 'string' ? `hermes-${payload.request_id.slice(0, 64)}` : 'hermes-request',
    data: { url },
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const url = new URL(event.notification.data?.url ?? 'm', self.registration.scope).href;
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const app = windows.find(client => new URL(client.url).origin === self.location.origin && new URL(client.url).pathname.startsWith(new URL(self.registration.scope).pathname + 'm'));
    if (app) { await app.navigate(url); return app.focus(); }
    return self.clients.openWindow(url);
  })());
});
