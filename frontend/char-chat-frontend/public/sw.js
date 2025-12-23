/* Simple SW (legacy)
 *
 * ⚠️ 안정성 이슈:
 * - 외부 스크립트/확장(chrome-extension) 요청을 캐시하려다 예외가 나면,
 *   respondWith가 Response를 못 받아 "Failed to convert value to Response"가 발생할 수 있다.
 *
 * 현재는 `src/main.jsx`에서 운영 SW 등록을 중단하고, 방문 시 기존 SW/캐시를 정리한다.
 * 다만 이미 설치된 SW가 남아있는 사용자를 위해, 이 SW도 최대한 안전하게 동작시키고
 * activate 시 자동으로 unregister를 시도한다.
 */
const VERSION = 'sw-v4';
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
    (async () => {
      try {
        const keys = await caches.keys();
        await Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)));
      } catch (_) {}
      try { self.clients.claim(); } catch (_) {}
      // ✅ 가능하면 스스로 unregister (새 빌드에서는 main.jsx가 unregister 수행)
      try { await self.registration.unregister(); } catch (_) {}
    })()
  );
});

function isApiRequest(url) {
  try {
    const u = new URL(url);
    const p = u.pathname || '';
    return p.startsWith('/stories') || p.startsWith('/characters') || p.startsWith('/tags') || p.startsWith('/chapters') || p.startsWith('/chat')
      || p.startsWith('/api/stories') || p.startsWith('/api/characters') || p.startsWith('/api/tags') || p.startsWith('/api/chapters') || p.startsWith('/api/chat');
  } catch (_) { return false; }
}

function isHttpUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch (_) { return false; }
}
function isSameOrigin(url) {
  try {
    const u = new URL(url);
    return u.origin === self.location.origin;
  } catch (_) { return false; }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = request.url;
  if (request.method !== 'GET') return;
  // ✅ http(s) 이외(chrome-extension 등)는 SW가 건드리지 않는다.
  if (!isHttpUrl(url)) return;

  // Static assets: try cache first
  // ✅ same-origin 정적 리소스만 캐시 (외부/확장 리소스 캐싱으로 인한 예외 방지)
  if (isSameOrigin(url) && (request.destination === 'style' || request.destination === 'script' || request.destination === 'image' || request.destination === 'font')) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(STATIC_CACHE);
        const cached = await cache.match(request);

        const update = async () => {
          try {
            const res = await fetch(request);
            if (res && res.status === 200) {
              try { await cache.put(request, res.clone()); } catch (_) {}
            }
            return res;
          } catch (_) {
            return null;
          }
        };

        if (cached) {
          try { event.waitUntil(update()); } catch (_) {}
          return cached;
        }

        const fresh = await update();
        return fresh || new Response('', { status: 504 });
      })()
    );
    return;
  }

  // API: stale-while-revalidate
  // ✅ same-origin API만 캐시 (외부 API/광고 스크립트 등은 건드리지 않음)
  if (isSameOrigin(url) && isApiRequest(url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(API_CACHE);
        const cached = await cache.match(request);

        const update = async () => {
          try {
            const res = await fetch(request);
            if (res && res.status === 200) {
              try { await cache.put(request, res.clone()); } catch (_) {}
            }
            return res;
          } catch (_) {
            return null;
          }
        };

        if (cached) {
          try { event.waitUntil(update()); } catch (_) {}
          return cached;
        }

        const fresh = await update();
        return fresh || new Response(JSON.stringify({ error: 'offline', url }), { status: 503, headers: { 'Content-Type': 'application/json' } });
      })()
    );
  }
});


