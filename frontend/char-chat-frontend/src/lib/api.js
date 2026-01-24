/**
 * API 클라이언트 설정
 */

import axios from 'axios';

/**
 * localStorage 안전 접근 유틸(인앱 WebView 방어)
 *
 * 배경:
 * - 일부 인앱 브라우저/커스텀탭(WebView) 환경에서 localStorage 접근이 SecurityError로 터지는 케이스가 있다.
 * - 우리 앱은 axios 인터셉터에서 localStorage를 읽는데, 여기서 예외가 나면 "모든 API 호출이 실패"처럼 보이며
 *   홈 콘텐츠가 로딩되지 않는 문제로 이어질 수 있다.
 *
 * 원칙:
 * - 토큰이 없어도 공개 API(홈/탐색)는 동작해야 한다(가용성 우선).
 */
const safeStorageGet = (key) => {
  try {
    return localStorage.getItem(key);
  } catch (_) {
    return null;
  }
};
const safeStorageSet = (key, value) => {
  try {
    localStorage.setItem(key, value);
  } catch (_) {
    // noop
  }
};
const safeStorageRemove = (key) => {
  try {
    localStorage.removeItem(key);
  } catch (_) {
    // noop
  }
};

// ===== Helpers for token refresh & URL parsing =====
const normalizePath = (rawUrl = '') => {
  try {
    if (/^https?:\/\//i.test(rawUrl)) return new URL(rawUrl).pathname.split('?')[0] || '/';
  } catch (_) {}
  let p = String(rawUrl || '/');
  if (!p.startsWith('/')) p = `/${p}`;
  return p.split('?')[0];
};
const parseJwtExpMs = (token) => {
  try { const payload = JSON.parse(atob(token.split('.')[1] || '')) || {}; const exp = Number(payload.exp || 0); return exp ? exp * 1000 : 0; } catch (_) { return 0; }
};
const isExpiringSoon = (token, thresholdSec = 300) => { const expMs = parseJwtExpMs(token); return expMs && (expMs - Date.now() <= thresholdSec * 1000); };
const isNotAuthenticatedDetail = (detail) => {
  /**
   * ✅ FastAPI HTTPBearer 기본 동작 구분
   *
   * - 토큰이 "없는" 경우: 403 + { detail: "Not authenticated" } 가 떨어질 수 있다.
   * - 권한이 "없는" 경우(예: 관리자 전용, 비공개 리소스): 403 + 한국어 메시지(detail)가 내려온다.
   *
   * 의도:
   * - 403을 전부 "로그인 필요"로 처리하면, 로그인한 유저도 403(권한없음) 상황에서 토큰이 지워지고 로그인 모달 루프가 난다.
   */
  try {
    return /not\s+authenticated/i.test(String(detail || ''));
  } catch (_) {
    return false;
  }
};
let refreshInFlight = null;
const runTokenRefresh = async (API_BASE_URL) => {
  if (refreshInFlight) return refreshInFlight;
  const refreshToken = safeStorageGet('refresh_token');
  if (!refreshToken) return Promise.reject(new Error('no refresh token'));
  refreshInFlight = axios.post(`${API_BASE_URL}/auth/refresh`, { refresh_token: refreshToken })
    .then((res) => {
      const { access_token, refresh_token: newRefreshToken } = res.data || {};
      if (!access_token) throw new Error('no access token');
      safeStorageSet('access_token', access_token);
      if (newRefreshToken) safeStorageSet('refresh_token', newRefreshToken);
      try { window.dispatchEvent(new CustomEvent('auth:tokenRefreshed', { detail: { access_token, refresh_token: newRefreshToken } })); } catch (_) {}
      return access_token;
    })
    .catch((err) => {
      safeStorageRemove('access_token');
      safeStorageRemove('refresh_token');
      try { window.dispatchEvent(new Event('auth:loggedOut')); } catch (_) {}
      if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) window.location.href = '/login';
      throw err;
    })
    .finally(() => { refreshInFlight = null; });
  return refreshInFlight;
};

/**
 * API 기본 URL 설정(방어적)
 *
 * 의도/동작:
 * - 로컬 개발: env가 없으면 기존대로 `http://localhost:8000`을 기본값으로 사용한다.
 * - 운영(프로덕션): env 누락 시 `현재 접속 도메인 + /api`를 기본값으로 사용한다.
 *   (Nginx에서 `/api/*`를 백엔드로 프록시하는 배포 구조에 맞춤)
 *
 * 왜 필요한가:
 * - 운영 빌드에서 VITE_API_URL이 비어 있으면 프론트가 `localhost:8000`으로 호출해서
 *   회원가입/로그인/중복확인 등이 전부 "확인 실패"로 보이게 된다.
 */
const getDefaultProdApiBaseUrl = () => {
  try {
    if (typeof window !== 'undefined' && window.location && window.location.origin) {
      return `${window.location.origin}/api`;
    }
  } catch (_) {}
  // 마지막 안전장치(브라우저 환경에서만 의미 있음)
  return 'http://localhost:8000';
};

const normalizeExplicitApiBaseUrl = (raw) => {
  /**
   * ✅ VITE_API_URL 방어 로직(운영 안정성)
   *
   * 문제:
   * - 운영 빌드에서 VITE_API_URL이 `http://localhost:8000` 또는 Docker 내부 호스트(`backend:8000`)로
   *   잘못 주입되면, 모바일/카카오 커스텀탭에서 API 호출이 전부 실패해 홈 화면이 "빈 깡통"처럼 보일 수 있다.
   *
   * 의도/동작:
   * - 절대 URL(https?://)만 신뢰한다. (상대경로는 런타임에서 origin 기반으로 처리)
   * - 운영에서는 localhost/127.0.0.1/backend 등 "브라우저에서 접근 불가능한 호스트"를 차단한다.
   *
   * ⚠️ 중요(로컬/운영 겸용):
   * - 백엔드(FastAPI)는 기본 라우터가 `/auth`, `/characters` 처럼 `/api` 프리픽스 없이 등록되어 있다.
   * - 운영 배포는 Nginx가 `/api/*` → 백엔드 `/*` 로 프록시(프리픽스 제거)하는 구조다.
   * - 따라서 VITE_API_URL은 환경에 따라 아래처럼 달라질 수 있다.
   *   - 로컬 개발(백엔드 직접 접속): `http://localhost:8000` (✅ /api 붙이면 404)
   *   - 운영(동일 도메인 프록시): `https://your-domain.com` 또는 `https://your-domain.com/api`
   *   - 운영(API 서브도메인 직결): `https://api.your-domain.com` (프록시 구조가 다르면 /api 미사용 가능)
   *
   * 최종 정책:
   * - dev: 입력 URL을 가능한 그대로 사용(경로 포함 시 유지, 없으면 origin만)
   * - production:
   *   - 명시 경로가 있으면 그대로 사용(`/api`든 뭐든)
   *   - 경로가 없고, 프론트와 같은 호스트면 `{origin}/api` 로 보정(기본 배포 구조)
   *   - 경로가 없고, 다른 호스트면 origin 그대로 사용(API 서브도메인 직결 케이스)
   */
  if (!raw) return '';
  const s = String(raw || '').trim();
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) return '';

  try {
    const u = new URL(s);
    const host = String(u.hostname || '').toLowerCase();

    if (import.meta.env.MODE === 'production') {
      // ✅ 운영에서 https 페이지인데 API가 http로 지정되면(혼합 콘텐츠) 인앱/크롬에서 API 호출이 막힐 수 있다.
      // 가능하면 https로 자동 승격(대부분의 운영 배포는 https가 정상).
      try {
        const curProto = String(window?.location?.protocol || '');
        if (curProto === 'https:' && String(u.protocol || '') === 'http:') {
          u.protocol = 'https:';
        }
      } catch (_) {}
      const badHosts = ['localhost', '127.0.0.1', '0.0.0.0', 'backend', 'backend-api'];
      if (badHosts.includes(host)) return '';
    }

    const origin = `${u.protocol}//${u.host}`;
    // pathname은 항상 "/"로 시작한다. "/"만 온 경우는 "경로 없음"으로 본다.
    const trimmedPath = String(u.pathname || '').replace(/\/+$/, '');

    // ✅ dev: 입력값을 최대한 그대로 사용 (로컬 백엔드 직접 붙이는 케이스 지원)
    if (import.meta.env.MODE !== 'production') {
      return trimmedPath ? `${origin}${trimmedPath}` : origin;
    }

    // ✅ production: 경로가 명시되면 그대로 사용(사용자가 의도적으로 지정한 값)
    if (trimmedPath) return `${origin}${trimmedPath}`;

    // ✅ production: 경로가 비어 있고 "프론트와 같은 호스트"면 /api를 기본값으로 보정
    // (배포 구조: Nginx가 /api를 백엔드로 프록시)
    try {
      const curHost = String(window?.location?.hostname || '').toLowerCase();
      if (curHost && curHost === host) return `${origin}/api`;
    } catch (_) {}

    // ✅ production: 다른 호스트(API 서브도메인 직결 등)면 origin 그대로 사용
    return origin;
  } catch (_) {
    return '';
  }
};

const EXPLICIT_API_BASE_URL = normalizeExplicitApiBaseUrl(import.meta.env.VITE_API_URL);
try {
  if (import.meta.env.MODE === 'production' && import.meta.env.VITE_API_URL && !EXPLICIT_API_BASE_URL) {
    // 운영에서 잘못된 VITE_API_URL이 들어왔을 때 원인을 남긴다(가용성 우선: 자동 폴백)
    console.warn('[api] invalid VITE_API_URL in production; fallback to window.origin/api', { VITE_API_URL: import.meta.env.VITE_API_URL });
  }
} catch (_) {}

const API_BASE_URL = EXPLICIT_API_BASE_URL
  || (import.meta.env.MODE === 'production' ? getDefaultProdApiBaseUrl() : 'http://localhost:8000');

const getRuntimeFallbackApiBases = () => {
  /**
   * ✅ 인앱(WebView)에서의 "데이터만 안 뜨는" 케이스 방어
   *
   * 발생 패턴:
   * - API_BASE_URL이 잘못되면(캐시된 구버전 JS / 프록시 설정 실수 / 혼합 콘텐츠 등),
   *   API 요청이 index.html(HTML)로 떨어지거나 Network Error로 실패한다.
   * - 이 경우 UI는 "빈 데이터"처럼 보여서, 인앱에서는 특히 디버깅이 매우 어렵다.
   *
   * 해결:
   * - 런타임에서 (1) HTML 응답 감지 또는 (2) 네트워크 에러 감지 시,
   *   가장 보수적인 후보 베이스(`/api`)로 1회 자동 재시도한다.
   *
   * 주의:
   * - 안전을 위해 GET 요청에만 적용한다(POST/PUT 재시도는 부작용 위험).
   */
  try {
    if (typeof window === 'undefined') return [];
    const origin = String(window.location?.origin || '').trim();
    const out = [];
    if (origin) out.push(`${origin}/api`);
    out.push('/api');
    // 마지막 폴백: origin 루트 (일부 배포가 /api 프록시 없이 루트로 직접 노출하는 경우)
    if (origin) out.push(origin);
    // 중복 제거
    return Array.from(new Set(out)).filter(Boolean);
  } catch (_) {
    return ['/api'];
  }
};

/**
 * SOCKET URL(방어적)
 *
 * 의도/동작:
 * - 운영: 동일 도메인(`/socket.io`)을 통해 Nginx 프록시로 연결(포트 노출/방화벽 이슈 회피)
 * - 로컬: 기존처럼 API host 기반으로 :3001을 기본값으로 사용
 */
const SOCKET_URL = (() => {
  const explicit = import.meta.env.VITE_SOCKET_URL;
  if (explicit) return explicit;

  if (import.meta.env.MODE === 'production') {
    try {
      if (typeof window !== 'undefined' && window.location && window.location.origin) {
        return window.location.origin;
      }
    } catch (_) {}
  }

  // dev fallback: API 도메인에 포트만 3001로 교체
  try {
    const u = new URL(API_BASE_URL);
    return `${u.protocol}//${u.hostname}:3001`;
  } catch (_) {
    return 'http://localhost:3001';
  }
})();

// Axios 인스턴스 생성
const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 600000,
  headers: {
    'Content-Type': 'application/json',
  },
});

const notifyAuthRequired = (detail = {}) => {
  try {
    window.dispatchEvent(new CustomEvent('auth:required', { detail }));
  } catch (_) {
    // noop
  }
};

const clearStoredTokens = () => {
  try {
    safeStorageRemove('access_token');
    safeStorageRemove('refresh_token');
  } catch (_) {
    // noop
  }
};

// 요청 인터셉터 - 토큰 자동 추가
api.interceptors.request.use(
  (config) => {
    const token = safeStorageGet('access_token');
    const isGet = (config.method || 'get').toLowerCase() === 'get';
    const path = normalizePath(config.url || '');
    // 개별 리소스 조회는 비공개일 수 있으므로 항상 토큰 포함
    const isIndividualResource = /^\/characters\/[0-9a-fA-F\-]+$/.test(path) || /^\/stories\/[0-9a-fA-F\-]+$/.test(path);
    // 목록 조회만 공개로 처리
    const isPublicCharacters = (path === '/characters' || path === '/characters/');
    const isPublicStories = (path === '/stories' || path === '/stories/');
    const isPublicTags = path.startsWith('/tags');
    // 회원가입 관련 공개 API
    const isPublicAuth = path === '/auth/check-email' 
      || path === '/auth/check-username' 
      || path === '/auth/generate-username'
      || path === '/auth/register'
      || path === '/auth/login';
    const isPublicGet = isGet && (isPublicCharacters || isPublicStories || isPublicTags);
    const isPublicEndpoint = isPublicGet || isPublicAuth;
    // 개별 리소스 조회이거나 공개 엔드포인트가 아니면 토큰 포함
    if (token && (isIndividualResource || !isPublicEndpoint)) {
      config.headers.Authorization = `Bearer ${token}`;
    } else {
      // 공개 요청은 Authorization 제거 (백엔드에서 500 방지)
      if (config.headers && config.headers.Authorization) {
        delete config.headers.Authorization;
      }
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// 응답 인터셉터 - 토큰 만료/권한 오류 처리(+경합 방지)
api.interceptors.response.use(
  async (response) => {
    /**
     * ✅ HTML 응답 감지(=API가 프론트로 잘못 라우팅된 경우)
     *
     * 증상:
     * - axios는 200 OK로 성공 처리하지만, response.data가 HTML(string)이라
     *   호출부에서 Array.isArray(...)가 false가 되어 빈 배열로 떨어진다.
     * - 결과적으로 홈이 "콘텐츠 없음"처럼 보인다.
     *
     * 처리:
     * - production + GET + API 경로 요청에서 HTML이면, /api 베이스로 1회 재시도한다.
     */
    try {
      const cfg = response?.config || {};
      const method = String(cfg.method || 'get').toLowerCase();
      const isGet = method === 'get';
      const path = normalizePath(cfg.url || '');
      const ct = String(response?.headers?.['content-type'] || '').toLowerCase();
      const looksHtml = ct.includes('text/html') || (typeof response?.data === 'string' && /<!doctype\s+html|<html/i.test(response.data));
      const looksApiPath =
        path.startsWith('/auth') ||
        path.startsWith('/characters') ||
        path.startsWith('/stories') ||
        path.startsWith('/rankings') ||
        path.startsWith('/tags') ||
        path.startsWith('/cms') ||
        path.startsWith('/notices') ||
        path.startsWith('/faqs') ||
        path.startsWith('/faq-categories') ||
        path.startsWith('/storydive') ||
        path.startsWith('/metrics') ||
        path.startsWith('/media') ||
        path.startsWith('/files') ||
        path.startsWith('/users') ||
        path.startsWith('/chapters') ||
        path.startsWith('/payment') ||
        path.startsWith('/point') ||
        path.startsWith('/user-personas') ||
        path.startsWith('/memory-notes') ||
        path.startsWith('/agent/contents') ||
        path.startsWith('/story-importer') ||
        path.startsWith('/chat');

      if (import.meta.env.MODE === 'production' && isGet && looksApiPath && looksHtml && !cfg.__fallbackRetried) {
        const bases = getRuntimeFallbackApiBases();
        for (const base of bases) {
          try {
            // 같은 베이스면 스킵
            const curBase = String(cfg.baseURL || api.defaults.baseURL || '').trim();
            if (base && curBase && base === curBase) continue;
            const nextCfg = { ...cfg, baseURL: base, __fallbackRetried: true };
            return await api.request(nextCfg);
          } catch (_) {
            // 다음 후보 시도
          }
        }
      }
    } catch (_) {}

    return response;
  },
  async (error) => {
    const originalRequest = error.config || {};
    const status = error.response?.status;
    const path = normalizePath(originalRequest.url || '');
    const detail = error.response?.data?.detail;
    const isGet = (originalRequest.method || 'get').toLowerCase() === 'get';
    // ✅ 네트워크 에러(응답 없음) 로깅(운영 디버깅)
    // - 브라우저에서 CORS/SSL/프록시/차단 이슈는 axios에선 "Network Error"로 뭉개지기 쉽다.
    // - 원인 파악을 위해 최소한의 컨텍스트를 콘솔에 남긴다(중복 로그 방지).
    try {
      const noResponse = !error.response;
      if (import.meta.env.MODE === 'production' && noResponse && !originalRequest.__loggedNetworkError) {
        originalRequest.__loggedNetworkError = true;
        console.error('[api] Network Error (no response)', {
          method: String(originalRequest.method || 'get'),
          url: String(originalRequest.url || ''),
          baseURL: String(originalRequest.baseURL || api.defaults.baseURL || ''),
          origin: String(window?.location?.origin || ''),
          online: typeof navigator !== 'undefined' ? navigator.onLine : undefined,
          ua: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
        });
      }
    } catch (_) {}
    // 개별 리소스 조회는 비공개일 수 있으므로 공개 엔드포인트에서 제외
    const isIndividualResource = /^\/characters\/[0-9a-fA-F\-]+$/.test(path) || /^\/stories\/[0-9a-fA-F\-]+$/.test(path);
    // 목록 조회만 공개로 처리
    const isPublicEndpoint = isGet && (
      (path === '/characters' || path === '/characters/') ||
      (path === '/stories' || path === '/stories/') ||
      path.startsWith('/tags')
    ) && !isIndividualResource;

    // ✅ 403 전체를 로그인 처리하지 않는다.
    // - 403 중에서도 "Not authenticated"(토큰 없음)만 로그인/리프레시 대상으로 보고,
    //   나머지 403(권한 없음)은 화면에서 권한 오류로만 처리되게 둔다.
    const isNotAuthenticated = (status === 403) && isNotAuthenticatedDetail(detail);
    const shouldHandleAuthError = (status === 401 || isNotAuthenticated) && !isPublicEndpoint;

    // 401 Unauthorized 또는 403 Forbidden에서 토큰 갱신 시도 (공개 GET 엔드포인트 제외)
    if (shouldHandleAuthError && !originalRequest._retry) {
      originalRequest._retry = true;

      try {
        const newAccess = await runTokenRefresh(API_BASE_URL);
        if (newAccess) originalRequest.headers.Authorization = `Bearer ${newAccess}`;
        return api(originalRequest);
      } catch (_) {}
    }

    if (shouldHandleAuthError && !originalRequest._handledAuthFailure) {
      originalRequest._handledAuthFailure = true;
      clearStoredTokens();
      notifyAuthRequired({
        reason: status === 401 ? 'unauthorized' : 'not_authenticated',
        path,
      });
    }

    // ✅ Network Error(응답 자체가 없음) 방어: production + GET 에서 /api 베이스로 1회 재시도
    try {
      const method = String(originalRequest.method || 'get').toLowerCase();
      const isGet = method === 'get';
      const noResponse = !error.response;
      if (import.meta.env.MODE === 'production' && isGet && noResponse && !originalRequest.__fallbackRetried) {
        const bases = getRuntimeFallbackApiBases();
        for (const base of bases) {
          try {
            const curBase = String(originalRequest.baseURL || api.defaults.baseURL || '').trim();
            if (base && curBase && base === curBase) continue;
            const nextCfg = { ...originalRequest, baseURL: base, __fallbackRetried: true };
            return await api.request(nextCfg);
          } catch (_) {
            // 다음 후보 시도
          }
        }
      }
    } catch (_) {}

    return Promise.reject(error);
  }
);

// 사전 리프레시: 포커스/가시성/주기적으로 access_token 만료 임박 시 갱신
const tryProactiveRefresh = async () => {
  const token = safeStorageGet('access_token');
  if (!token) return;
  if (isExpiringSoon(token, 300)) { try { await runTokenRefresh(API_BASE_URL); } catch (_) {} }
};
try {
  window.addEventListener('focus', tryProactiveRefresh);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') tryProactiveRefresh(); });
  setInterval(tryProactiveRefresh, 120000);
} catch (_) {}

// 🔐 인증 관련 API
export const authAPI = {
  login: (email, password) =>
    api.post('/auth/login', { email, password }),
  
  register: (email, username, password, gender) =>
    api.post('/auth/register', { email, username, password, gender }),
  
  logout: () =>
    api.post('/auth/logout'),
  
  getMe: () =>
    api.get('/auth/me'),
  
  refreshToken: (refreshToken) =>
    api.post('/auth/refresh', { refresh_token: refreshToken }),
  
  verifyEmail: (token) =>
    api.post('/auth/verify-email', { token }),
  
  sendVerificationEmail: (email) =>
    api.post('/auth/send-verification-email', { email }),
  checkEmail: (email) => api.get(`/auth/check-email`, { params: { email } }),
  checkUsername: (username) => api.get(`/auth/check-username`, { params: { username } }),
  generateUsername: () => api.get('/auth/generate-username'),
  updatePassword: (current_password, new_password) =>
    api.post('/auth/update-password', { current_password, new_password }),
  
  forgotPassword: (email) =>
    api.post('/auth/forgot-password', { email }),
  
  resetPassword: (token, new_password) =>
    api.post('/auth/reset-password', { token, new_password }),
};

// 👤 사용자 관련 API
export const usersAPI = {
  // 사용자 프로필 조회
  getUserProfile: (userId) =>
    api.get(`/users/${userId}`),
  
  // 사용자 프로필 수정
  updateUserProfile: (userId, data) =>
    api.put(`/users/${userId}`, data),

  // 사용자 댓글 조회
  getUserCharacterComments: (userId, params = {}) =>
    api.get(`/users/${userId}/comments/characters`, { params }),
  // 사용자 스토리 댓글 조회
  getUserStoryComments: (userId, params = {}) =>
    api.get(`/users/${userId}/comments/stories`, { params }),
  
  // 사용자가 생성한 캐릭터 목록
  getUserCharacters: (userId, params = {}) =>
    api.get(`/users/${userId}/characters`, { params }),
  
  // 사용자가 생성한 스토리 목록
  getUserStories: (userId, params = {}) =>
    api.get(`/users/${userId}/stories`, { params }),

  // 최근 대화한 캐릭터 목록
  getRecentCharacters: (params = {}) =>
    api.get('/me/characters/recent', { params }),
  // 내가 좋아요한 캐릭터 목록
  getLikedCharacters: (params = {}) =>
    api.get('/me/characters/liked', { params }),
  // 내가 선호작(좋아요)한 웹소설 목록
  getLikedStories: (params = {}) =>
    api.get('/me/stories/liked', { params }),
    
  // 모델 설정 관련
  getModelSettings: () =>
    api.get('/me/model-settings'),
    
  updateModelSettings: (model, subModel, responseLength) =>
    api.put('/me/model-settings', null, { 
      params: { model, sub_model: subModel, response_length: responseLength } 
    }),

  // 통계: 개요
  getCreatorStatsOverview: (userId, params = {}) =>
    api.get(`/users/${userId}/stats/overview`, { params }),
  // 통계: 시계열(예: chats 최근 7일)
  getCreatorTimeseries: (userId, params = {}) =>
    api.get(`/users/${userId}/stats/timeseries`, { params }),
  // 통계: 상위 캐릭터
  getCreatorTopCharacters: (userId, params = {}) =>
    api.get(`/users/${userId}/stats/top-characters`, { params }),

  // ===== 관리자: 회원 목록 =====
  adminListUsers: (params = {}) =>
    api.get('/admin/users', { params }),

  // ===== 관리자: 테스트 계정 생성(메일 인증 완료) =====
  adminCreateTestUser: (data) =>
    api.post('/admin/users/test', data),
};

// 🎭 캐릭터 관련 API
export const charactersAPI = {
  getCharacters: (params = {}) =>
    api.get('/characters/', { params }),
  
  getMyCharacters: (params = {}) =>
    api.get('/characters/my', { params }),
  
  getCharacter: (id) =>
    api.get(`/characters/${id}`),
  
  createCharacter: (data) =>
    api.post('/characters', data),

  // 🔥 CAVEDUCK 스타일 고급 생성 API
  createAdvancedCharacter: (data) =>
    api.post('/characters/advanced', data),

  // ⚡ 온보딩: 30초만에 캐릭터 만나기(초안 생성)
  // - DB 저장은 하지 않고, 고급 생성 payload 초안만 반환한다.
  quickGenerateCharacterDraft: (data) =>
    api.post('/characters/quick-generate', data),

  // ⚡ 위저드(일반 캐릭터): 프롬프트(world_setting) 자동 생성
  quickGeneratePromptDraft: (data) =>
    api.post('/characters/quick-generate-prompt', data),

  // ⚡ 위저드(일반 캐릭터): 첫시작(도입부+첫대사) 자동 생성
  quickGenerateFirstStartDraft: (data) =>
    api.post('/characters/quick-generate-first-start', data),

  // ⚡ 위저드(일반 캐릭터): 디테일(성격/말투/칩) 자동 생성
  quickGenerateDetailDraft: (data) =>
    api.post('/characters/quick-generate-detail', data),

  // ⚡ 위저드(일반 캐릭터): 비밀정보(secret) 자동 생성
  quickGenerateSecretDraft: (data) =>
    api.post('/characters/quick-generate-secret', data),

  // ⚡ 위저드(일반 캐릭터): 턴수별 사건(오프닝 내) 자동 생성
  quickGenerateTurnEventsDraft: (data) =>
    api.post('/characters/quick-generate-turn-events', data),

  // ⚡ 위저드(일반 캐릭터): 엔딩 제목/기본조건(초안) 자동 생성
  quickGenerateEndingDraft: (data) =>
    api.post('/characters/quick-generate-ending-draft', data),

  // ⚡ 위저드(일반 캐릭터): 엔딩 내용(에필로그) 자동 생성
  quickGenerateEndingEpilogueDraft: (data) =>
    api.post('/characters/quick-generate-ending-epilogue', data),
  
  updateAdvancedCharacter: (id, data) =>
    api.put(`/characters/advanced/${id}`, data),
  
  getAdvancedCharacter: (id) =>
    api.get(`/characters/advanced/${id}`),

  updateCharacter: (id, data) =>
    api.put(`/characters/${id}`, data),
  
  deleteCharacter: (id) =>
    api.delete(`/characters/${id}`),

  toggleCharacterPublic: (id) =>
    api.patch(`/characters/${id}/toggle-public`),
  
  likeCharacter: (id) =>
    api.post(`/characters/${id}/like`),
  
  unlikeCharacter: (id) =>
    api.delete(`/characters/${id}/like`),
  
  getLikeStatus: (id) =>
    api.get(`/characters/${id}/like-status`),
  
  getCharacterSettings: (id) =>
    api.get(`/characters/${id}/settings`),
  
  updateCharacterSettings: (id, data) =>
    api.put(`/characters/${id}/settings`, data),
  
  createCharacterSettings: (id, data) =>
    api.post(`/characters/${id}/settings`, data),
  
  getCharacterStats: (id) =>
    api.get(`/characters/${id}/stats`),
  
  // 댓글 관련 API
  getComments: (characterId, params = {}) =>
    api.get(`/characters/${characterId}/comments`, { params }),
  // 태그 관련(캐릭터별 연결)
  getCharacterTags: (characterId) =>
    api.get(`/characters/${characterId}/tags`),
  setCharacterTags: (characterId, tags) =>
    api.put(`/characters/${characterId}/tags`, { tags }),
  
  createComment: (characterId, data) =>
    api.post(`/characters/${characterId}/comments`, data),
  
  updateComment: (commentId, data) =>
    api.put(`/characters/comments/${commentId}`, data),
  
  deleteComment: (commentId) =>
    api.delete(`/characters/comments/${commentId}`),
  
  // 세계관 설정 API
  createWorldSetting: (data) =>
    api.post('/characters/world-settings', data),
  
  getWorldSettings: (params = {}) =>
    api.get('/characters/world-settings', { params }),
  
  // 커스텀 모듈 API
  createCustomModule: (data) =>
    api.post('/characters/custom-modules', data),
  
  getCustomModules: (params = {}) =>
    api.get('/characters/custom-modules', { params }),
};

// 🏷️ 태그 관련 API
export const tagsAPI = {
  getTags: () => api.get('/tags/'),
  getUsedTags: () => api.get('/tags/used'),
  createTag: (data) => api.post('/tags', data),
  deleteTag: (tagId) => api.delete(`/tags/${tagId}`),
};

// 💬 채팅 관련 API
export const chatAPI = {
  // 🔥 CAVEDUCK 스타일 채팅 시작 API
  startChat: (characterId, extra = null) =>
    api.post('/chat/start', { character_id: characterId, ...(extra && typeof extra === 'object' ? extra : {}) }),
  
  startNewChat: (characterId, extra = null) =>
    api.post('/chat/start-new', { character_id: characterId, ...(extra && typeof extra === 'object' ? extra : {}) }),
  
  startChatWithContext: (data) =>
    api.post('/chat/start-with-context', data),

  sendMessage: (data) =>
    api.post('/chat/message', data),
  // 에이전트 탭용 간단 시뮬레이터(캐릭터 없이)
  agentSimulate: (data) =>
    api.post('/chat/agent/simulate', data),
  agentGenerateHighlights: (data) =>
    api.post('/chat/agent/generate-highlights', data),
  classifyIntent: (data) =>
    api.post('/chat/agent/classify-intent', data),
  agentPartialRegenerate: (data) =>
    api.post('/chat/agent/partial-regenerate', data),
  
  // 에이전트 콘텐츠 (내 서랍)
  saveAgentContent: (data) =>
    api.post('/agent/contents', data),
  getAgentContents: (params = {}) =>
    api.get('/agent/contents', { params }),
  deleteAgentContent: (id) =>
    api.delete(`/agent/contents/${id}`),
  publishAgentContent: (id, is_public = true) =>
    api.patch(`/agent/contents/${id}/publish`, { is_public }),
  unpublishAgentContent: (id) =>
    api.patch(`/agent/contents/${id}/unpublish`),
  getAgentFeed: (params = {}) =>
    api.get('/agent/contents/feed', { params }),
  
  getChatHistory: (sessionId) =>
    api.get(`/chat/history/${sessionId}`),
  
  getChatSessions: () =>
    api.get('/chat/sessions'),
  
  // 채팅룸 관련 API (레거시)
  getChatRooms: (params = {}) =>
    api.get('/chat/rooms', { params }),
  
  getRoomsWithUnread: (params = {}) =>
    api.get('/chat/read/rooms/with-unread', { params }),
  
  markRoomAsRead: (roomId) =>
    api.post(`/chat/read/rooms/${roomId}/mark`),
  
  createChatRoom: (data) =>
    api.post('/chat/rooms', data),
  
  getChatRoom: (id) =>
    api.get(`/chat/rooms/${id}`),
  
  getMessages: (roomId, params = {}) =>
    api.get(`/chat/rooms/${roomId}/messages`, { params }),
  
  sendMessageLegacy: (data) =>
    api.post('/chat/messages', data),
    
  // 채팅 삭제 관련 API
  clearChatMessages: (roomId) =>
    api.delete(`/chat/rooms/${roomId}/messages`),
    
  deleteChatRoom: (roomId) =>
    api.delete(`/chat/rooms/${roomId}`),
  // 룸 메타(원작챗 진행도/설정) 조회
  getRoomMeta: (roomId) => api.get(`/chat/rooms/${roomId}/meta`),
  // ✅ 요술봉 모드: 선택지 3개 생성(일반 캐릭터챗)
  // payload: { n?: number, seed_message_id?: string, seed_hint?: string }
  getMagicChoices: (roomId, payload = {}) => api.post(`/chat/rooms/${roomId}/magic-choices`, payload),
  // 메시지 수정/재생성
  updateMessage: (messageId, content) =>
    api.patch(`/chat/messages/${messageId}`, { content }),
  regenerateMessage: (messageId, instruction) =>
    api.post(`/chat/messages/${messageId}/regenerate`, { instruction }),
  feedbackMessage: (messageId, action) =>
    api.post(`/chat/messages/${messageId}/feedback`, { action }),
};

// 💬 원작챗 API (MVP 스텁 연동)
export const origChatAPI = {
  // 컨텍스트 팩
  // ✅ 서비스 정책: 원작챗은 plain 모드만 사용한다.
  getContextPack: (storyId, { anchor, characterId, mode = 'plain', rangeFrom, rangeTo, sceneId } = {}) =>
    api.get(`/stories/${storyId}/context-pack`, { params: { anchor, characterId, mode, rangeFrom, rangeTo, sceneId } }),

  // 세션 시작(기존 채팅방 구조 재사용)
  start: ({ story_id, character_id, mode = 'plain', start = null, focus_character_id = null, range_from = null, range_to = null, narrator_mode = null, pov = null, force_new = null }) =>
    api.post('/chat/origchat/start', { story_id, character_id, mode, start, focus_character_id, range_from, range_to, narrator_mode, pov, force_new }),

  // 턴 진행(스텁 응답)
  turn: ({ room_id, user_text = null, choice_id = null, trigger = null, situation_text = null, idempotency_key = null, settings_patch = null }) =>
    api.post('/chat/origchat/turn', { room_id, user_text, choice_id, trigger, situation_text, idempotency_key, settings_patch }),
};

// 📖 스토리 관련 API
export const storiesAPI = {
  getStories: (params = {}) =>
    api.get('/stories/', { params }),
  
  getMyStories: (params = {}) =>
    api.get('/stories/my', { params }),
  
  getStory: (id) =>
    api.get(`/stories/${id}`),
  // 시작 옵션(개요/씬 인덱스/추천/모드/씨앗)
  getStartOptions: (storyId) => api.get(`/stories/${storyId}/start-options`),
  // 역진가중 리캡, 장면 발췌
  getBackwardRecap: (storyId, anchor) => api.get(`/stories/${storyId}/recap`, { params: { anchor } }),
  getSceneExcerpt: (storyId, chapter, sceneId) => api.get(`/stories/${storyId}/scene-excerpt`, { params: { chapter, sceneId } }),
  getExtractedCharacters: (storyId) =>
    api.get(`/stories/${storyId}/extracted-characters`),
  rebuildExtractedCharacters: (storyId) =>
    api.post(`/stories/${storyId}/extracted-characters/rebuild`, null, { timeout: 600000 }),
  rebuildSingleExtractedCharacter: (storyId, extractedId) =>
    api.post(`/stories/${storyId}/extracted-characters/${extractedId}/rebuild`, null, { timeout: 600000 }),
  // 비동기 추출 잡 API
  rebuildExtractedCharactersAsync: (storyId) =>
    api.post(`/stories/${storyId}/extracted-characters/rebuild-async`),
  getExtractJobStatus: (jobId) =>
    api.get(`/stories/extracted-characters/jobs/${jobId}`),
  cancelExtractJob: (jobId) =>
    api.post(`/stories/extracted-characters/jobs/${jobId}/cancel`),
  deleteExtractedCharacters: (storyId) =>
    api.delete(`/stories/${storyId}/extracted-characters`),
  
  createStory: (data) =>
    api.post('/stories/', data),
  
  updateStory: (id, data) =>
    api.put(`/stories/${id}`, data),
  
  deleteStory: (id) =>
    api.delete(`/stories/${id}`),
  
  generateStory: (data) =>
    api.post('/stories/generate', data),

  // Experimental streaming API (SSE events)
  generateStoryStream: async (data, { onMeta, onPreview, onEpisode, onFinal, onError, onStageStart, onStageEnd, onStart } = {}) => {
    const endpoint = '/stories/generate/stream';
    const token = safeStorageGet('access_token');
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const controller = new AbortController();
    try { if (onStart) onStart({ controller, abort: () => controller.abort() }); } catch (_) {}
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let result = { ok: false };
    try {
      const res = await fetch(`${API_BASE_URL}${endpoint}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(data),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) throw new Error(`stream error ${res.status}`);
      const reader = res.body.getReader();
      let done, value;
      while (({ done, value } = await reader.read()) && !done) {
        buffer += decoder.decode(value, { stream: true });
        // Parse SSE frames
        let idx;
        while ((idx = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, idx).trimEnd();
          buffer = buffer.slice(idx + 2);
          // Expect lines: event: X\n data: Y
          let event = null; let dataJson = null;
          const lines = frame.split('\n');
          for (const line of lines) {
            if (line.startsWith('event:')) event = line.slice(6).trim();
            else if (line.startsWith('data:')) dataJson = line.slice(5).trim();
          }
          if (!event || !dataJson) continue;
          let payload = null;
          try { payload = JSON.parse(dataJson); } catch { payload = null; }
          if (!payload) continue;
          switch (event) {
            case 'meta': if (onMeta) onMeta(payload); break;
            case 'preview': if (onPreview) onPreview(payload.text || ''); break;
            case 'episode': if (onEpisode) onEpisode(payload); break;
            case 'final': if (onFinal) onFinal(payload); result = { ok: true, data: payload }; break;
            case 'error': 
              if (onError) onError(payload);
              throw new Error(payload?.message || 'stream error');
            case 'stage_start': if (onStageStart) onStageStart(payload); break;
            case 'stage_end': if (onStageEnd) onStageEnd(payload); break;
            // stage_progress is ignored for now to reduce re-renders
            default: break;
          }
        }
      }
      if (!result.ok && onFinal) onFinal({ content: '' });
      return result.ok ? { ...result, controller, abort: () => controller.abort() } : { ok: false, data: result.data, controller, abort: () => controller.abort() };
    } catch (e) {
      const msg = (e && e.message) ? String(e.message) : '';
      const aborted = (e && e.name === 'AbortError') || msg.toLowerCase().includes('aborted');
      try { controller.abort(); } catch (_) {}
      return { ok: false, error: e, aborted, controller, abort: () => controller.abort() };
    }
  },

  // 원작챗 컨텍스트 워밍 상태
  getContextStatus: (storyId) => api.get(`/stories/${storyId}/context-status`),

  // ✅ 작품공지(작가 공지)
  createAnnouncement: (storyId, { content }) =>
    api.post(`/stories/${storyId}/announcements`, { content }),
  pinAnnouncement: (storyId, announcementId, pinned) =>
    api.post(`/stories/${storyId}/announcements/${announcementId}/pin`, { pinned: !!pinned }),
  deleteAnnouncement: (storyId, announcementId) =>
    api.delete(`/stories/${storyId}/announcements/${announcementId}`),

  // Queue: cancel / status / patch
  cancelGenerateJob: (jobId) => api.delete(`/stories/generate/stream/${jobId}`),
  getGenerateJobStatus: (jobId) => api.get(`/stories/generate/stream/${jobId}/status`),
  patchGenerateJob: (jobId, patch) => api.patch(`/stories/generate/stream/${jobId}`, patch),
  
  likeStory: (id) =>
    api.post(`/stories/${id}/like`),
  
  unlikeStory: (id) =>
    api.delete(`/stories/${id}/like`),
  
  getLikeStatus: (id) =>
    api.get(`/stories/${id}/like-status`),
  
  // 스토리 댓글 관련 API
  getComments: (storyId, params = {}) =>
    api.get(`/stories/${storyId}/comments`, { params }),
  
  createComment: (storyId, data) =>
    api.post(`/stories/${storyId}/comments`, data),
  
  updateComment: (commentId, data) =>
    api.put(`/stories/comments/${commentId}`, data),
  
  deleteComment: (commentId) =>
    api.delete(`/stories/comments/${commentId}`),
  
  getEpisodes: (storyId) =>
    api.get(`/chapters/by-story/${storyId}`),
    
  incrementEpisodeView: (chapterId) =>
    api.post(`/chapters/${chapterId}/view`),

  // 🏊 메인 '스토리다이브' 구좌용 추천 작품 목록
  getStoryDiveSlots: (limit = 10, minEpisodes = 10) =>
    api.get('/stories/storydive/slots', { params: { limit, min_episodes: minEpisodes } }),
};

// 🏆 랭킹 API
export const rankingAPI = {
  getDaily: (params = {}) => api.get('/rankings/daily', { params }),
};

// 📈 메트릭(임시 요약) API
export const metricsAPI = {
  // params: { day?: 'YYYYMMDD', story_id?, room_id?, mode? }
  getSummary: (params = {}) => api.get('/metrics/summary', { params }),
  // 스토리 에이전트 상단 카피용: (일반캐릭터챗 + 원작챗 캐릭터 + 웹소설) 합산 수
  getContentCounts: (params = {}) => api.get('/metrics/content-counts', { params }),
  // 관리자용: 트래픽(채팅 기반) DAU/WAU/MAU
  getTraffic: (params = {}) => api.get('/metrics/traffic', { params }),
  // ✅ 실시간 온라인(접속) - Redis 하트비트 기반(관리자/운영 판단용)
  // - heartbeat: 유저가 접속 중임을 짧은 TTL로 갱신(실패해도 무시해도 됨)
  onlineHeartbeat: () => api.post('/metrics/online/heartbeat'),
  // - online: 최근 N초 내 하트비트 유저 수(관리자 전용)
  getOnlineNow: (params = {}) => api.get('/metrics/online', { params }),
};

// 📖 회차(Chapters) API
export const chaptersAPI = {
  getByStory: (storyId, order = 'asc') => api.get(`/chapters/by-story/${storyId}`, { params: { order } }),
  create: (data) => api.post('/chapters/', data),
  getOne: (chapterId) => api.get(`/chapters/${chapterId}`),
  update: (chapterId, data) => api.put(`/chapters/${chapterId}`, data),
  delete: (chapterId) => api.delete(`/chapters/${chapterId}`),
};

// 📚 웹소설 원작(MVP 더미용)
// worksAPI 더미 제거됨

// ✨ 스토리 임포터 관련 API
export const storyImporterAPI = {
  analyzeStory: (content, ai_model, title = null) => {
    return api.post('/story-importer/analyze', { content, ai_model, title });
  },
};

// 📢 공지사항 API
export const noticesAPI = {
  list: (params = {}) => api.get('/notices/', { params }),
  latest: () => api.get('/notices/latest'),
  get: (id) => api.get(`/notices/${id}`),
  create: (data) => api.post('/notices/', data),
  update: (id, data) => api.put(`/notices/${id}`, data),
  delete: (id) => api.delete(`/notices/${id}`),
};

// ❓ FAQ API
export const faqsAPI = {
  list: (params = {}) => api.get('/faqs/', { params }),
  create: (data) => api.post('/faqs/', data),
  update: (id, data) => api.put(`/faqs/${id}`, data),
  delete: (id) => api.delete(`/faqs/${id}`),
};

// ❓ FAQ 카테고리(큰 항목) API
export const faqCategoriesAPI = {
  list: (params = {}) => api.get('/faq-categories/', { params }),
  upsert: (id, data) => api.put(`/faq-categories/${id}`, data),
};

// 🧩 CMS(홈 배너/구좌 설정) API
// - 운영 SSOT: 서버(DB)에 저장된 설정을 모든 유저가 공유한다.
// - 관리자 페이지(CMSPage)에서 저장/수정하고, 홈(HomePage/HomeBannerCarousel)에서 조회해 렌더링한다.
export const cmsAPI = {
  // 공개 GET(유저/비로그인)
  getHomeBanners: () => api.get('/cms/home/banners'),
  getHomeSlots: () => api.get('/cms/home/slots'),
  getHomePopups: () => api.get('/cms/home/popups'),
  getCharacterTagDisplay: () => api.get('/cms/tags/character'),
  // 관리자 PUT(저장)
  putHomeBanners: (data) => api.put('/cms/home/banners', data),
  putHomeSlots: (data) => api.put('/cms/home/slots', data),
  putHomePopups: (data) => api.put('/cms/home/popups', data),
  putCharacterTagDisplay: (data) => api.put('/cms/tags/character', data),
};

// 💎 포인트 관련 API
export const pointAPI = {
  getBalance: () =>
    api.get('/point/balance'),
  
  usePoints: (data) =>
    api.post('/point/use', data),
  
  getTransactions: (params = {}) =>
    api.get('/point/transactions', { params }),
  
  getTransactionsSummary: () =>
    api.get('/point/transactions/summary'),
};

// 💳 결제 관련 API
export const paymentAPI = {
  getProducts: () =>
    api.get('/payment/products'),
  
  createProduct: (data) =>
    api.post('/payment/products', data),
  
  checkout: (data) =>
    api.post('/payment/checkout', data),
  
  webhook: (data) =>
    api.post('/payment/webhook', data),
  
  getPaymentHistory: (params = {}) =>
    api.get('/payment/history', { params }),
  
  getPayment: (paymentId) =>
    api.get(`/payment/payment/${paymentId}`),
};

// 📁 파일 관련 API
export const filesAPI = {
  uploadImages: (files, onProgress) => {
    const formData = new FormData();
    files.forEach(file => {
      formData.append('files', file);
    });
    return api.post('/files/upload', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
      onUploadProgress: (evt) => {
        if (!onProgress) return;
        const total = evt.total || 0;
        const loaded = evt.loaded || 0;
        const percent = total ? Math.round((loaded / total) * 100) : 0;
        try { onProgress(percent); } catch (_) {}
      }
    });
  },
};

// 🖼️ 미디어(이미지) API
export const mediaAPI = {
  listAssets: ({ entityType, entityId, presign = false, expiresIn = 300 }) =>
    api.get(`/media/assets`, { params: { entity_type: entityType, entity_id: entityId, presign, expires_in: expiresIn } }),
  upload: (files) => {
    const form = new FormData();
    files.forEach((f) => form.append('files', f));
    return api.post(`/media/upload`, form, { headers: { 'Content-Type': 'multipart/form-data' } });
  },
  /**
   * 이미지 크롭(서버 사이드)
   *
   * 의도/동작:
   * - 일부 운영 환경에서는 스토리지(CDN/R2 등)에서 CORS 헤더가 없어 `canvas.toBlob()` 기반 크롭이 실패할 수 있다.
   * - 이 경우 백엔드가 원본(MediaAsset.url)을 내려받아 PIL로 크롭한 뒤 새 MediaAsset을 생성해 반환한다.
   *
   * 주의:
   * - assetId는 반드시 서버에 저장된 MediaAsset id여야 한다(로컬/레거시 url 아이템은 불가).
   */
  cropAsset: (assetId, { sx, sy, sw, sh }) =>
    api.post(`/media/assets/${assetId}/crop`, { sx, sy, sw, sh }),
  attach: ({ entityType, entityId, assetIds, asPrimary = false }) =>
    api.post(`/media/assets/attach`, null, {
      params: { entity_type: entityType, entity_id: entityId, asset_ids: assetIds, as_primary: asPrimary },
      paramsSerializer: {
        serialize: (params) => {
          const usp = new URLSearchParams();
          Object.entries(params).forEach(([k, v]) => {
            if (Array.isArray(v)) v.forEach((x) => usp.append(k, x));
            else if (v !== undefined && v !== null) usp.append(k, v);
          });
          return usp.toString();
        },
      },
    }),
  reorder: ({ entityType, entityId, orderedIds }) =>
    api.patch(`/media/assets/order`, null, {
      params: { entity_type: entityType, entity_id: entityId, ordered_ids: orderedIds },
      paramsSerializer: {
        serialize: (params) => {
          const usp = new URLSearchParams();
          Object.entries(params).forEach(([k, v]) => {
            if (Array.isArray(v)) v.forEach((x) => usp.append(k, x));
            else if (v !== undefined && v !== null) usp.append(k, v);
          });
          return usp.toString();
        },
      },
    }),
  update: (assetId, { is_primary, order_index } = {}) =>
    api.patch(`/media/assets/${assetId}`, null, { params: { is_primary, order_index } }),
  deleteAsset: (assetId) => api.delete(`/media/assets/${assetId}`),
  deleteAssets: (assetIds) =>
    api.delete(`/media/assets`, {
      params: { asset_ids: assetIds },
      paramsSerializer: {
        serialize: (params) => {
          const usp = new URLSearchParams();
          Object.entries(params).forEach(([k, v]) => {
            if (Array.isArray(v)) v.forEach((x) => usp.append(k, x));
            else if (v !== undefined && v !== null) usp.append(k, v);
          });
          return usp.toString();
        },
      },
    }),
  generate: (params, options = {}) => api.post(`/media/generate`, null, { params, ...options }),
  getJob: (jobId) => api.get(`/media/jobs/${jobId}`),
  cancelJob: (jobId) => api.post(`/media/jobs/${jobId}/cancel`),
  trackEvent: ({ event, entityType, entityId, count }) => api.post(`/media/events`, null, { params: { event, entity_type: entityType, entity_id: entityId, count } }),
};

// 📝 기억노트 관련 API
export const memoryNotesAPI = {
  // 특정 캐릭터의 기억노트 목록 조회
  getMemoryNotesByCharacter: (characterId) =>
    api.get(`/memory-notes/character/${characterId}`),

  // 기억노트 생성
  createMemoryNote: (memoryData) =>
    api.post('/memory-notes', memoryData),

  // 기억노트 수정
  updateMemoryNote: (memoryId, memoryData) =>
    api.put(`/memory-notes/${memoryId}`, memoryData),

  // 기억노트 삭제
  deleteMemoryNote: (memoryId) =>
    api.delete(`/memory-notes/${memoryId}`),

  // 기억노트 단일 조회
  getMemoryNote: (memoryId) =>
    api.get(`/memory-notes/${memoryId}`),
};

// 👤 유저 페르소나 관련 API
export const userPersonasAPI = {
  // 사용자의 모든 페르소나 목록 조회
  getUserPersonas: () =>
    api.get('/user-personas'),

  // 페르소나 생성
  createUserPersona: (personaData) =>
    api.post('/user-personas', personaData),

  // 페르소나 수정
  updateUserPersona: (personaId, personaData) =>
    api.put(`/user-personas/${personaId}`, personaData),

  // 페르소나 삭제
  deleteUserPersona: (personaId) =>
    api.delete(`/user-personas/${personaId}`),

  // 페르소나 단일 조회
  getUserPersona: (personaId) =>
    api.get(`/user-personas/${personaId}`),

  // 활성 페르소나 설정
  setActivePersona: (personaId) =>
    api.post('/user-personas/set-active', { persona_id: personaId }),

  // 현재 활성 페르소나 조회
  getCurrentActivePersona: () =>
    api.get('/user-personas/active/current'),
};

// 🏊 스토리 다이브 관련 API
export const storydiveAPI = {
  // 소설 목록 조회
  getNovels: (skip = 0, limit = 20) =>
    api.get('/storydive/novels', { params: { skip, limit } }),

  // 소설 상세 조회
  getNovel: (novelId) =>
    api.get(`/storydive/novels/${novelId}`),

  // 최근 스토리다이브 세션(유저별)
  getRecentSessions: (limit = 10) =>
    api.get('/storydive/sessions/recent', { params: { limit } }),

  // 스토리(연재 회차) 기반으로 StoryDive용 Novel(합본 텍스트 스냅샷) 준비
  prepareNovelFromStory: (storyId, toNo, maxEpisodes = 10) =>
    api.post('/storydive/novels/from-story', { story_id: storyId, to_no: toNo, max_episodes: maxEpisodes }),

  // 세션 생성
  createSession: (novelId, entryPoint) =>
    api.post('/storydive/sessions', { novel_id: novelId, entry_point: entryPoint }),

  // 세션 조회
  getSession: (sessionId) =>
    api.get(`/storydive/sessions/${sessionId}`),

  // 턴 진행
  processTurn: (sessionId, mode, input, action = 'turn') =>
    api.post(`/storydive/sessions/${sessionId}/turn`, { mode, input, action }),

  // 마지막 턴 삭제 (Erase)
  eraseTurn: (sessionId) =>
    api.delete(`/storydive/sessions/${sessionId}/erase`),
};

export { api, API_BASE_URL, SOCKET_URL };

