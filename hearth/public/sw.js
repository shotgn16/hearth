// Service worker: app shell works offline, last API responses are readable offline, and push notifications arrive.
const SHELL = 'hearth-shell-v2';
const SHELL_FILES = ['./', 'styles.css', 'icon.svg', 'manifest.webmanifest', 'js/app.js', 'js/core.js', 'js/charts.js',
  'js/home.js', 'js/money.js', 'js/plan.js', 'js/insights.js', 'js/more.js', 'js/settings.js', 'js/ask.js'];
const ASSETS = SHELL_FILES.map((f) => new URL(f, self.registration.scope).href);

self.addEventListener('install', (e) => { e.waitUntil(caches.open(SHELL).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== SHELL && k !== 'hearth-api').map((k) => caches.delete(k)))).then(() => self.clients.claim())); });

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.includes('/api/')) {
    if (url.pathname.endsWith('/ai/chat')) return; // streaming
    if (e.request.method !== 'GET') return;
    // network first, fall back to the last good copy so the app still opens without a connection
    e.respondWith(fetch(e.request).then((r) => { if (r.ok) { const c = r.clone(); caches.open('hearth-api').then((ca) => ca.put(e.request, c)); } return r; })
      .catch(() => caches.match(e.request).then((r) => r || new Response(JSON.stringify({ error: 'Offline' }), { status: 503, headers: { 'Content-Type': 'application/json' } }))));
    return;
  }
  e.respondWith(fetch(e.request).then((r) => { const c = r.clone(); caches.open(SHELL).then((ca) => ca.put(e.request, c)); return r; }).catch(() => caches.match(e.request).then((r) => r || caches.match(new URL('./', self.registration.scope).href))));
});

self.addEventListener('push', (e) => {
  let d = {}; try { d = e.data.json(); } catch { d = { title: 'Hearth', body: e.data?.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Hearth', { body: d.body, icon: 'icon-192.png', badge: 'icon-192.png', data: { url: new URL(d.url || './', self.registration.scope).href } }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then((cs) => { const c = cs[0]; if (c) { c.navigate(e.notification.data.url); return c.focus(); } return self.clients.openWindow(e.notification.data.url); }));
});
