/**
 * 루비 잔액 로컬 캐시 유틸 (유저 단위)
 *
 * 목적:
 * - 사이드바/충전페이지 재마운트 시 `...` 플리커를 줄이기 위해 마지막 잔액을 즉시 보여준다.
 * - 계정 전환 시 잔액이 섞이지 않도록 userId 단위 키를 사용한다.
 */

const MEMORY_CACHE = new Map();
const CACHE_PREFIX = 'ruby:balance:v1:';

const toCacheKey = (userId) => {
  const id = String(userId || '').trim();
  if (!id) return '';
  return `${CACHE_PREFIX}${id}`;
};

const safeGet = (key) => {
  try {
    return localStorage.getItem(key);
  } catch (_) {
    return null;
  }
};

const safeSet = (key, value) => {
  try {
    localStorage.setItem(key, value);
  } catch (_) {
    // noop
  }
};

export const getCachedRubyBalance = (userId) => {
  const key = toCacheKey(userId);
  if (!key) return null;

  if (MEMORY_CACHE.has(key)) {
    const cached = MEMORY_CACHE.get(key);
    return Number.isFinite(cached) ? cached : null;
  }

  const raw = safeGet(key);
  if (raw == null) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  MEMORY_CACHE.set(key, n);
  return n;
};

export const setCachedRubyBalance = (userId, balance) => {
  const key = toCacheKey(userId);
  const n = Number(balance);
  if (!key || !Number.isFinite(n)) return;
  MEMORY_CACHE.set(key, n);
  safeSet(key, String(n));
};
