/**
 * Client/session identity helpers (SSOT)
 *
 * - client_id: 브라우저 단위 고정 식별자(localStorage)
 * - session_id: 최근 활동 TTL 기준 세션 식별자(localStorage)
 * - localStorage가 막힌 환경(WebView 등)에서는 메모리 폴백으로 동작
 */

const CLIENT_ID_KEY = 'cc:client_id:v1';
const SESSION_KEY = 'cc:session:v1';
const DEFAULT_SESSION_TTL_MS = 30 * 60 * 1000; // 30m

let memoryClientId = '';
let memorySessionId = '';
let memorySessionTs = 0;

export const safeUuid = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  try {
    return `u_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  } catch {
    return `u_${Date.now()}`;
  }
};

export const getOrCreateClientId = () => {
  try {
    const cur = String(localStorage.getItem(CLIENT_ID_KEY) || '').trim();
    if (cur) return cur;
    const next = safeUuid();
    localStorage.setItem(CLIENT_ID_KEY, next);
    return next;
  } catch {
    if (memoryClientId) return memoryClientId;
    memoryClientId = safeUuid();
    return memoryClientId;
  }
};

export const getOrCreateSessionId = (ttlMs = DEFAULT_SESSION_TTL_MS) => {
  const now = Date.now();
  const ttl = Math.max(1, Number(ttlMs || DEFAULT_SESSION_TTL_MS));

  try {
    const raw = localStorage.getItem(SESSION_KEY);
    const obj = raw ? JSON.parse(raw) : null;
    const id = String(obj?.id || '').trim();
    const ts = Number(obj?.ts || 0);
    if (id && ts && (now - ts) <= ttl) {
      try {
        localStorage.setItem(SESSION_KEY, JSON.stringify({ id, ts: now }));
      } catch {
        void 0;
      }
      return id;
    }
  } catch {
    void 0;
  }

  if (memorySessionId && memorySessionTs && (now - memorySessionTs) <= ttl) {
    memorySessionTs = now;
    return memorySessionId;
  }

  const next = safeUuid();
  memorySessionId = next;
  memorySessionTs = now;

  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ id: next, ts: now }));
  } catch {
    void 0;
  }

  return next;
};
