const STATIC_CACHE = 'taurus-static-v1';
const SHELL_CACHE = 'taurus-shell-v1';
const PRECACHE_URLS = [
  '/',
  '/manifest.webmanifest',
  '/icons/taurus-icon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(PRECACHE_URLS)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys
        .filter((key) => key !== STATIC_CACHE && key !== SHELL_CACHE)
        .map((key) => caches.delete(key)),
    )).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/ws/')) return;

  const isDocument = request.mode === 'navigate' || request.destination === 'document';

  if (isDocument) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put('/', copy));
          return response;
        })
        .catch(async () => {
          const cache = await caches.open(SHELL_CACHE);
          return cache.match('/') || caches.match('/');
        }),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const networkFetch = fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(STATIC_CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);

      return cached || networkFetch;
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  let targetUrl = '/';
  const raw = event.notification.data?.url;
  if (typeof raw === 'string') {
    try {
      const parsed = new URL(raw, self.location.origin);
      if (parsed.origin === self.location.origin
          && (parsed.protocol === 'http:' || parsed.protocol === 'https:')) {
        // Collapse leading slashes to prevent "//evil.com" being treated as protocol-relative
        const safePath = parsed.pathname.replace(/^\/\/+/, '/');
        targetUrl = safePath + parsed.search + parsed.hash;
      }
    } catch { /* invalid URL, use default */ }
  }

  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });

    for (const client of clients) {
      if ('focus' in client) {
        client.navigate(targetUrl);
        await client.focus();
        return;
      }
    }

    await self.clients.openWindow(targetUrl);
  })());
});
