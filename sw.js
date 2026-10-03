/* ============================================================
   CjayCards — Service Worker
   Bump CACHE_VERSION on every deploy.
   ============================================================ */

const CACHE_VERSION = 'v1.0.1';
const CACHE_NAME = `cjaycards-${CACHE_VERSION}`;

const SHELL = [
  './',
  './index.html',
  './styles.css',
  './storage.js',
  './app.js',
  './manifest.json',
  './icon.svg',
  'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@600;700;800&family=Inter:wght@400;500;600;700&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL)).catch((err) => console.warn('SW install cache failed:', err))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (!url.protocol.startsWith('http')) return;
  if (url.hostname.endsWith('googleapis.com') || url.hostname === 'accounts.google.com') return;

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) {
        fetch(req).then((res) => {
          if (res && res.status === 200 && res.type === 'basic') caches.open(CACHE_NAME).then((cache) => cache.put(req, res.clone()));
        }).catch(() => {});
        return cached;
      }
      return fetch(req).then((res) => {
        if (!res || res.status !== 200) return res;
        const clone = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
        return res;
      }).catch(() => {
        if (req.mode === 'navigate') return caches.match('./index.html');
      });
    })
  );
});
