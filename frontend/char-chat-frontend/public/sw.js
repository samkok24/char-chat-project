/* Simple SW: stale-while-revalidate for API GETs and static assets */
const VERSION = 'sw-v2';
const STATIC_CACHE = `${VERSION}-static`;
const API_CACHE = `${VERSION}-api`;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(['/']))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

function isApiRequest(url) {
  try {
    const u = new URL(url);
    return u.pathname.startsWith('/stories') || u.pathname.startsWith('/characters') || u.pathname.startsWith('/tags') || u.pathname.startsWith('/chapters') || u.pathname.startsWith('/chat');
  } catch (_) { return false; }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = request.url;
  if (request.method !== 'GET') return;

  // Static assets: try cache first
  if (request.destination === 'style' || request.destination === 'script' || request.destination === 'image' || request.destination === 'font') {
    event.respondWith(
      caches.match(request).then((cached) => {
        const fetchPromise = fetch(request).then((response) => {
          const respClone = response.clone();
          caches.open(STATIC_CACHE).then((cache) => cache.put(request, respClone));
          return response;
        }).catch(() => cached);
        // 보장: 네트워크/캐시 모두 실패 시에도 유효한 Response 반환
        return cached || fetchPromise.catch(() => new Response('', { status: 504 }));
      })
    );
    return;
  }

  // API: stale-while-revalidate
  if (isApiRequest(url)) {
    event.respondWith(
      caches.open(API_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        const fetchPromise = fetch(request).then((response) => {
          if (response && response.status === 200) {
            cache.put(request, response.clone());
          }
          return response;
        }).catch(() => cached);
        // 보장: 네트워크/캐시 모두 실패 시에도 유효한 Response 반환
        return cached || fetchPromise.catch(() => new Response(JSON.stringify({ error: 'offline', url }), { status: 503, headers: { 'Content-Type': 'application/json' } }));
      })
    );
  }
});


