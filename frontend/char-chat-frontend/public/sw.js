/**
 * Legacy Service Worker (정리 전용)
 *
 * 배경:
 * - 과거 SW가 API 응답을 캐시(stale-while-revalidate)하면서,
 *   일시적으로 "빈 데이터" 응답이 캐시되면 크롬/카카오 커스텀탭(=Chrome WebView)에서
 *   홈 화면이 계속 "깡통"처럼 보이는 문제가 발생할 수 있다.
 * - 현재 운영 정책은 `src/main.jsx`에서 SW 등록을 중단하고, 방문 시 SW/캐시를 정리한다.
 * - 하지만 이미 설치된 SW는 남아있을 수 있으므로, 이 파일 자체도 "정리/해제" 역할만 수행한다.
 *
 * 의도/동작:
 * - install: 즉시 활성화(캐시 설치하지 않음)
 * - activate: 모든 Cache Storage를 삭제하고, 가능하면 열린 탭을 1회 리로드 후 unregister
 * - fetch: 어떤 요청도 가로채지 않음(네트워크를 그대로 사용)
 */

self.addEventListener('install', () => {
  try { self.skipWaiting(); } catch (_) {}
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // 1) 캐시 전부 삭제
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    } catch (_) {}

    // ✅ 안정성 우선:
    // - 여기서 강제 리로드/claim을 하면, "지금 사용 중인" 유저 세션(채팅 등)이 갑자기 새로고침될 수 있다.
    // - 따라서 이 SW는 캐시 정리만 수행하고 즉시 unregister 한다.
    // - 빈 화면을 겪는 사용자는 1회 새로고침만 해도 대부분 정상화된다(또는 main.jsx의 캐시 정리 로직이 다음 로드에서 처리).

    // 2) 스스로 해제
    try { await self.registration.unregister(); } catch (_) {}
  })());
});

self.addEventListener('fetch', () => {
  // no-op: 어떤 요청도 respondWith 하지 않는다(=네트워크 기본 동작)
});
