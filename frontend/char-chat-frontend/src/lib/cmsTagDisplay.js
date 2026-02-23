/**
 * CMS(관리자) 태그 노출/순서 설정 - 로컬스토리지 캐시
 *
 * 의도:
 * - "캐릭터 탭" / "태그 선택 모달"에서 태그 노출 순서/숨김을 동일하게 적용한다.
 * - 운영 SSOT는 서버(DB, site_configs)이고, 프론트는 빠른 반영/탭 동기화를 위해 로컬스토리지에 캐시한다.
 *
 * 주의:
 * - 로컬스토리지는 기기/브라우저 단위다.
 * - 실제 운영 반영은 CMS 저장(서버 PUT)로 이뤄진다.
 */

import { CHARACTER_TAG_PRIORITY_SLUGS } from './tagOrder';

export const CHARACTER_TAG_DISPLAY_STORAGE_KEY = 'cms:characterTagDisplay:v1';
export const CHARACTER_TAG_DISPLAY_CHANGED_EVENT = 'cms:characterTagDisplayChanged';

export const DEFAULT_CHARACTER_TAG_DISPLAY = {
  // ✅ 미설정(서버 기본값)에서도 UX가 망가지지 않도록 프론트 기본 우선순위를 둔다.
  // - 관리자는 CMS에서 이 값을 마음대로 편집/저장할 수 있다.
  prioritySlugs: [...CHARACTER_TAG_PRIORITY_SLUGS],
  hiddenSlugs: [],
  updatedAt: null,
};

const uniq = (arr) => {
  const out = [];
  const seen = new Set();
  for (const v of (arr || [])) {
    const s = String(v || '').trim();
    if (!s) continue;
    if (s.startsWith('cover:')) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
};

export function sanitizeCharacterTagDisplay(raw) {
  try {
    const obj = (raw && typeof raw === 'object') ? raw : {};
    const priority = Array.isArray(obj.prioritySlugs)
      ? obj.prioritySlugs
      : (typeof obj.prioritySlugs === 'string' ? [obj.prioritySlugs] : []);
    const hidden = Array.isArray(obj.hiddenSlugs)
      ? obj.hiddenSlugs
      : (typeof obj.hiddenSlugs === 'string' ? [obj.hiddenSlugs] : []);
    const updatedAt = obj.updatedAt ? String(obj.updatedAt) : null;

    return {
      prioritySlugs: uniq(priority).slice(0, 500),
      hiddenSlugs: uniq(hidden).slice(0, 500),
      updatedAt: updatedAt && updatedAt.trim() ? updatedAt.trim() : null,
    };
  } catch (_) {
    return { ...DEFAULT_CHARACTER_TAG_DISPLAY };
  }
}

/**
 * 서버 기본값(미설정)인지 판별한다.
 * - 서버는 기본적으로 priority/hidden이 비어있고 updatedAt도 없다.
 */
export function isDefaultCharacterTagDisplayConfig(cfg) {
  try {
    const c = sanitizeCharacterTagDisplay(cfg);
    const hasUpdated = !!String(c.updatedAt || '').trim();
    return !hasUpdated && (c.prioritySlugs || []).length === 0 && (c.hiddenSlugs || []).length === 0;
  } catch (_) {
    return false;
  }
}

export function getCharacterTagDisplay() {
  try {
    const raw = localStorage.getItem(CHARACTER_TAG_DISPLAY_STORAGE_KEY);
    if (!raw) return sanitizeCharacterTagDisplay(DEFAULT_CHARACTER_TAG_DISPLAY);
    const parsed = JSON.parse(raw);
    return sanitizeCharacterTagDisplay(parsed);
  } catch (_) {
    return sanitizeCharacterTagDisplay(DEFAULT_CHARACTER_TAG_DISPLAY);
  }
}

export function setCharacterTagDisplay(config) {
  try {
    const normalized = sanitizeCharacterTagDisplay(config);
    localStorage.setItem(CHARACTER_TAG_DISPLAY_STORAGE_KEY, JSON.stringify(normalized));
    try { window.dispatchEvent(new Event(CHARACTER_TAG_DISPLAY_CHANGED_EVENT)); } catch (_) {}
    return { ok: true, item: normalized };
  } catch (e) {
    return { ok: false, error: e };
  }
}


