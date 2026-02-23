/**
 * CMS(관리자) 홈 팝업 설정 - 로컬 캐시 + 서버 SSOT 병행
 *
 * 의도:
 * - 운영 SSOT는 서버(DB: SiteConfig)이며, 프론트는 이를 로컬스토리지에 캐시해 즉시 반영한다.
 * - "N일간 보지 않기"는 유저 로컬 기준으로 동작해야 하므로 localStorage/sessionStorage로 별도 관리한다.
 *
 * 주의:
 * - 팝업은 과도하면 UX를 크게 해치므로, maxDisplayCount를 0~10으로 제한한다.
 * - 시간(startAt/endAt)은 문자열로 저장되며, 해석은 클라이언트 로컬 시간대 기준이다.
 */

export const HOME_POPUPS_STORAGE_KEY = 'cms:homePopups:v1';
export const HOME_POPUPS_CHANGED_EVENT = 'cms:homePopupsChanged';

export const DEFAULT_HOME_POPUPS_CONFIG = {
  maxDisplayCount: 1,
  items: [],
};

const nowIso = () => {
  try { return new Date().toISOString(); } catch (_) { return ''; }
};

const safeParseMs = (isoLike) => {
  try {
    if (!isoLike) return null;
    const t = new Date(isoLike).getTime();
    return Number.isFinite(t) ? t : null;
  } catch (_) {
    return null;
  }
};

const genId = () => {
  try {
    if (typeof crypto !== 'undefined' && crypto?.randomUUID) return crypto.randomUUID();
  } catch (_) {}
  return `pop_${Date.now()}_${Math.random().toString(16).slice(2)}`;
};

export const popupDismissStorageKey = (idLike) => {
  const id = String(idLike || '').trim();
  return `cms:homePopup:dismiss:${id || 'unknown'}`;
};

export function sanitizeHomePopupItem(raw) {
  const obj = (raw && typeof raw === 'object') ? raw : {};
  const id = String(obj.id || '').trim() || genId();
  const title = String(obj.title || '').trim();
  const message = String(obj.message || '').trim();
  const imageUrl = String(obj.imageUrl || '').trim();
  const mobileImageUrl = String(obj.mobileImageUrl || '').trim();
  const linkUrl = String(obj.linkUrl || '').trim();

  const displayOnRaw = String(obj.displayOn || '').trim().toLowerCase();
  const displayOn = (displayOnRaw === 'pc' || displayOnRaw === 'desktop')
    ? 'pc'
    : (displayOnRaw === 'mobile' || displayOnRaw === 'm' || displayOnRaw === 'phone')
      ? 'mobile'
      : 'all';

  const enabled = obj.enabled === true;
  const openInNewTab = !!obj.openInNewTab;
  const startAt = obj.startAt ? String(obj.startAt) : null;
  const endAt = obj.endAt ? String(obj.endAt) : null;

  let dismissDays = Number(obj.dismissDays);
  if (!Number.isFinite(dismissDays)) dismissDays = 1;
  dismissDays = Math.max(0, Math.min(365, Math.floor(dismissDays)));

  const createdAt = obj.createdAt ? String(obj.createdAt) : nowIso();
  const updatedAt = nowIso();

  return {
    id,
    enabled,
    title,
    message,
    imageUrl,
    mobileImageUrl,
    linkUrl,
    openInNewTab,
    displayOn,
    startAt,
    endAt,
    dismissDays,
    createdAt,
    updatedAt,
  };
}

export function sanitizeHomePopupsConfig(raw) {
  const obj = (raw && typeof raw === 'object') ? raw : {};
  let maxDisplayCount = Number(obj.maxDisplayCount);
  if (!Number.isFinite(maxDisplayCount)) maxDisplayCount = DEFAULT_HOME_POPUPS_CONFIG.maxDisplayCount;
  maxDisplayCount = Math.max(0, Math.min(10, Math.floor(maxDisplayCount)));

  const itemsRaw = Array.isArray(obj.items) ? obj.items : [];
  const items = itemsRaw.map(sanitizeHomePopupItem);
  return { maxDisplayCount, items };
}

export function isDefaultHomePopupsConfig(cfg) {
  try {
    const c = sanitizeHomePopupsConfig(cfg);
    return (Number(c.maxDisplayCount) === 1) && Array.isArray(c.items) && c.items.length === 0;
  } catch (_) {
    return false;
  }
}

export function isHomePopupActive(popup, atMs = Date.now()) {
  const p = sanitizeHomePopupItem(popup);
  if (!p.enabled) return false;

  const startMs = safeParseMs(p.startAt);
  const endMs = safeParseMs(p.endAt);
  if (startMs !== null && atMs < startMs) return false;
  if (endMs !== null && atMs > endMs) return false;
  return true;
}

export function isHomePopupVisibleOnDevice(popup, device = 'pc') {
  const p = sanitizeHomePopupItem(popup);
  const d = String(p.displayOn || 'all').trim().toLowerCase() || 'all';
  const dev = String(device || 'pc').trim().toLowerCase() || 'pc';
  if (d === 'pc') return dev === 'pc';
  if (d === 'mobile') return dev === 'mobile';
  return true;
}

export function getHomePopupsConfig() {
  try {
    const raw = localStorage.getItem(HOME_POPUPS_STORAGE_KEY);
    if (!raw) return sanitizeHomePopupsConfig(DEFAULT_HOME_POPUPS_CONFIG);
    return sanitizeHomePopupsConfig(JSON.parse(raw));
  } catch (e) {
    try { console.error('[cmsPopups] getHomePopupsConfig failed:', e); } catch (_) {}
    return sanitizeHomePopupsConfig(DEFAULT_HOME_POPUPS_CONFIG);
  }
}

export function setHomePopupsConfig(cfg) {
  const normalized = sanitizeHomePopupsConfig(cfg);
  try {
    localStorage.setItem(HOME_POPUPS_STORAGE_KEY, JSON.stringify(normalized));
    try { window.dispatchEvent(new Event(HOME_POPUPS_CHANGED_EVENT)); } catch (_) {}
    return { ok: true, config: normalized };
  } catch (e) {
    try { console.error('[cmsPopups] setHomePopupsConfig failed:', e); } catch (_) {}
    return { ok: false, error: e, config: normalized };
  }
}

export function getActiveHomePopups(atMs = Date.now(), device = 'pc') {
  const cfg = getHomePopupsConfig();
  const list = Array.isArray(cfg.items) ? cfg.items : [];
  return list.filter((p) => isHomePopupActive(p, atMs) && isHomePopupVisibleOnDevice(p, device));
}

export function getPopupDismissUntilMs(idLike) {
  const id = String(idLike || '').trim();
  if (!id) return null;
  const key = popupDismissStorageKey(id);
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const until = Number(raw);
      return Number.isFinite(until) ? until : null;
    }
  } catch (_) {}
  try {
    const raw = sessionStorage.getItem(key);
    if (raw) return atMsPlusZero(); // session 동안만
  } catch (_) {}
  return null;
}

function atMsPlusZero() {
  try { return Date.now() + 1; } catch (_) { return 1; }
}

export function isPopupDismissed(idLike, atMs = Date.now()) {
  const id = String(idLike || '').trim();
  if (!id) return false;
  const key = popupDismissStorageKey(id);
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const until = Number(raw);
      if (!Number.isFinite(until)) return false;
      if (atMs < until) return true;
      // 만료됐으면 정리
      try { localStorage.removeItem(key); } catch (_) {}
      return false;
    }
  } catch (_) {}
  try {
    return !!sessionStorage.getItem(key);
  } catch (_) {
    return false;
  }
}

export function dismissPopup(idLike, days) {
  const id = String(idLike || '').trim();
  if (!id) return;
  const key = popupDismissStorageKey(id);
  let d = Number(days);
  if (!Number.isFinite(d)) d = 1;
  d = Math.max(0, Math.min(365, Math.floor(d)));
  if (d <= 0) {
    // 세션 동안만 숨김(브라우저 탭 닫으면 복구)
    try { sessionStorage.setItem(key, '1'); } catch (_) {}
    return;
  }
  const until = Date.now() + (d * 24 * 60 * 60 * 1000);
  try { localStorage.setItem(key, String(until)); } catch (_) {}
}

