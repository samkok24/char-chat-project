# 10. 프론트엔드 아키텍처

기준 디렉터리: `frontend/char-chat-frontend`

## 1) 핵심 진입점

- `src/main.jsx`
  - `App` 렌더
  - `TooltipProvider`, `Toaster` 전역 등록
  - textarea ephemeral scrollbar 설치
  - 기존 Service Worker 등록 해제 + cache 삭제 로직 포함
- `src/App.jsx`
  - 전역 Provider 체인:
    - `QueryClientProvider`
    - `AuthProvider`
    - `LoginModalProvider`
    - `SocketProvider`
  - 전역 Bridge 컴포넌트:
    - `MediaEventsBridge`
    - `ToastEventsBridge`
    - `PresenceHeartbeatBridge`
    - `PostLoginRedirectBridge`
  - 페이지는 대부분 `React.lazy`로 코드 스플리팅

## 2) 상태/인증/소켓 구조

### Auth (`src/contexts/AuthContext.jsx`)

- `access_token`, `refresh_token`를 localStorage 기준으로 관리
- `checkAuth`로 초기 로그인 상태 확인
- 탭 간 동기화:
  - `storage` 이벤트 감지
  - 토큰 갱신 시 `auth:tokenRefreshed`
  - 로그아웃 시 `auth:loggedOut`
- 프로필 낙관적 업데이트 지원 (`updateUserProfile`)

### Login Modal (`src/contexts/LoginModalContext.jsx`)

- 전역 `auth:required` 이벤트를 받아 로그인 모달 오픈
- 개별 페이지에서 직접 모달 제어하지 않아도 되게 중앙 집중화

### Socket (`src/contexts/SocketContext.jsx`)

- `SOCKET_URL`로 소켓 연결, 인증 토큰 포함
- 핵심 방어 로직:
  - room 전환 레이스 방지 (`desiredRoomIdRef`)
  - history 로딩 타임아웃 + fallback 에러 처리
  - 다중 탭/다중 디바이스 상황에서 stale 이벤트 필터링
  - `auth:tokenRefreshed` 수신 시 소켓 재연결
- 채팅 관련 상태를 전역으로 보유:
  - `messages`, `historyLoading`, `hasMoreMessages`, `aiTyping`, `socketError`

## 3) API 클라이언트 SSOT

- 파일: `src/lib/api.js` (가장 중요)
- 주요 설계 포인트:
  - 환경별 `API_BASE_URL` 안전 결정
  - 운영 환경 오설정 방어:
    - 잘못된 `VITE_API_URL` fallback
    - HTML 응답/Network Error 감지 시 런타임 fallback base 재시도
  - 요청 인터셉터:
    - 공개 엔드포인트 제외 토큰 자동 부착
  - 응답 인터셉터:
    - 401/`Not authenticated`에 refresh token 시도
    - 실패 시 토큰 정리 + `auth:required` 이벤트
  - 객체 단위 API 분리:
    - `authAPI`, `usersAPI`, `charactersAPI`, `chatAPI`, `origChatAPI`, `storiesAPI`, `mediaAPI` 등

## 4) 전역 Bridge 컴포넌트

- `MediaEventsBridge`
  - `media:updated` 수신 시 연관 query invalidate
- `ToastEventsBridge`
  - 전역 `toast` 커스텀 이벤트 -> Sonner 토스트로 변환
- `PresenceHeartbeatBridge`
  - `/metrics/online/heartbeat` 주기 호출 (best-effort)
- `PostLoginRedirectBridge`
  - 로그인 성공 후 저장된 redirect URL 복귀 처리

## 5) 라우팅 방식

- 파일: `src/App.jsx`
- 공개/보호 라우트 분리:
  - `ProtectedRoute`: 인증 필요
  - `PublicRoute`: 로그인 상태면 `/dashboard`로 우회
- 루트 `/`는 `/dashboard`로 리다이렉트
- 과거 경로 `/works/*`는 `/stories/*`로 리다이렉트

## 6) 페이지 규모/책임

대형 페이지(핵심 변경 리스크):

- `CreateCharacterPage.jsx` (15k+)
  - 캐릭터 생성/수정 wizard, start_sets, 미리보기, 자동생성
- `ChatPage.jsx` (7.5k+)
  - 실시간 채팅, 원작챗, 메시지 편집/재생성/피드백, 매직 선택지
- `AgentPage.jsx` (4.9k+)
  - 스토리 에이전트 플로우, 세션/메시지 로컬 저장, 콘텐츠 생성/저장
- `CMSPage.jsx` (4k+)
  - 관리자 CMS(배너/구좌/팝업/태그 표시/테스트 유저)
- `HomePage.jsx` (3.1k+)
  - 메인 허브, CMS 슬롯/팝업/배너 반영, 랭킹/추천 섹션

## 7) 대형 컴포넌트

- `QuickMeetCharacterModal.jsx` (4.6k+)
  - “30초 캐릭터 만들기”, 태그/이미지/자동생성 파이프라인
- `ModelSelectionModal.jsx` (1.2k+)
  - 모델/응답길이/UI 설정, 메모리노트/페르소나 관리
- `ImageGenerateInsertModal.jsx` (1.1k+)
  - 미디어 업로드/생성/크롭/정렬/attach
- `components/layout/Sidebar.jsx`
  - 최근 채팅/최근 본 스토리/캐시/사용자 액션 허브

## 8) 로컬 캐시 전략(프론트)

- React Query persistence (localStorage)
- Sidebar 자체 캐시(`sidebar:chatRooms:cache`)
- CMS 로컬 캐시:
  - `cmsBanners`, `cmsSlots`, `cmsPopups`, `cmsTagDisplay`
- 읽기 진행도:
  - `reader_progress:*`, `reader_progress_at:*`
- 로그인 후 복귀:
  - `cc:postLoginRedirect:v1`, session draft 키
