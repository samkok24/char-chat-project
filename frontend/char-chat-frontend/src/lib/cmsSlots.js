/**
 * CMS(관리자) 홈 구좌(슬롯) 설정 - 로컬스토리지 기반(데모용)
 *
 * 의도:
 * - CMS가 커지면서 "홈 배너" 외에도 홈에 노출되는 구좌(섹션/슬롯)를 관리할 필요가 있다.
 * - 지금은 서버/DB 없이도 동작하도록 로컬스토리지에 저장한다(배너 설정과 동일 패턴).
 *
 * 주의:
 * - 로컬스토리지에 저장되므로 '해당 브라우저/기기'에만 유지된다.
 * - 운영에서 모든 유저에게 동일 구좌를 적용하려면 추후 서버 저장소(DB) 연동이 필요하다.
 */

export const HOME_SLOTS_STORAGE_KEY = 'cms:homeSlots:v1';
export const HOME_SLOTS_CHANGED_EVENT = 'cms:homeSlotsChanged';
export const HOME_SLOTS_CURATED_CHARACTERS_SLOT_ID = 'slot_curated_characters';
export const HOME_SLOTS_CURATED_CHARACTERS_MAX = 6;

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
  return `slot_${Date.now()}_${Math.random().toString(16).slice(2)}`;
};

/**
 * 기본 구좌(처음 진입 시 노출)
 * - "상시"가 기본값이므로 startAt/endAt은 null
 * - 실제 홈 반영 로직은 추후 기획/연동 단계에서 추가
 */
/**
 * 홈 "구좌" 기본 목록(현재 홈 화면에 실제로 존재하는 섹션들)
 *
 * 요구사항:
 * - 탐색, 최근대화, 최근 스토리다이브는 CMS 구좌 조작 대상에서 제외한다.
 * - 그 외 "현재 홈에 있는 구좌"는 기본값으로 전부 포함되어 있어야 한다.
 *
 * 참고:
 * - 여기의 title은 "관리용/표시용"으로 사용될 수 있으나,
 *   현재 홈 컴포넌트(TopOrigChat 등)가 내부에서 제목을 가지고 있어 홈 반영은 추후 단계로 둔다.
 */
export const DEFAULT_HOME_SLOTS = [
  // 0) (초심자 온보딩) 운영자 추천 캐릭터 (최대 6개 선택)
  // - 홈 상단에 "바로 대화 시작" CTA로 활용된다.
  // - 선택이 없으면 홈에서 안내 메시지만 노출된다(요구사항).
  {
    id: HOME_SLOTS_CURATED_CHARACTERS_SLOT_ID,
    title: '추천 캐릭터로 시작하기',
    enabled: true,
    startAt: null,
    endAt: null,
    characterPicks: [], // [{ id, name, avatar_url }]
    createdAt: nowIso(),
    updatedAt: nowIso(),
  },
  // 1) 지금 대화가 활발한 원작 캐릭터
  {
    id: 'slot_top_origchat',
    title: '지금 대화가 활발한 원작 캐릭터',
    enabled: true,
    startAt: null,
    endAt: null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  },
  // 2) 지금 대화가 활발한 캐릭터
  {
    id: 'slot_trending_characters',
    title: '지금 대화가 활발한 캐릭터',
    enabled: true,
    startAt: null,
    endAt: null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  },
  // 3) 지금 인기 있는 원작 웹소설
  {
    id: 'slot_top_stories',
    title: '지금 인기 있는 원작 웹소설',
    enabled: true,
    startAt: null,
    endAt: null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  },
  // 4) 챕터8이 추천하는 캐릭터
  {
    id: 'slot_recommended_characters',
    title: '챕터8이 추천하는 캐릭터',
    enabled: true,
    startAt: null,
    endAt: null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  },
  // 6) 일상을 캐릭터와 같이 공유해보세요
  {
    id: 'slot_daily_tag_characters',
    title: '일상을 캐릭터와 같이 공유해보세요',
    enabled: true,
    startAt: null,
    endAt: null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  },
];

export function sanitizeHomeSlot(raw) {
  const obj = (raw && typeof raw === 'object') ? raw : {};

  const id = String(obj.id || '').trim() || genId();
  const title = String(obj.title || '').trim() || '구좌';
  const enabled = obj.enabled !== false; // default true

  /**
   * 운영자 추천 캐릭터(초심자 온보딩)
   *
   * 의도:
   * - 홈 상단 추천 캐릭터 구좌는 "최대 6개"만 지원한다(UX/레이아웃 고정).
   * - 저장 시점에만 sanitize하여, 런타임 렌더에서 예외가 발생하지 않도록 한다.
   * - 중복 id는 제거하고, 순서는 유지한다(관리자가 선택/정렬한 순서 보존).
   */
  const rawPicks = Array.isArray(obj.characterPicks) ? obj.characterPicks : [];
  const seenPickIds = new Set();
  const characterPicks = [];
  for (const p of rawPicks) {
    try {
      const pid = String(p?.id || '').trim();
      if (!pid) continue;
      if (seenPickIds.has(pid)) continue;
      seenPickIds.add(pid);
      characterPicks.push({
        id: pid,
        name: String(p?.name || '').trim(),
        avatar_url: String(p?.avatar_url || p?.avatarUrl || '').trim(),
      });
      if (characterPicks.length >= HOME_SLOTS_CURATED_CHARACTERS_MAX) break;
    } catch (_) {
      // ignore bad item
    }
  }

  const startAt = obj.startAt ? String(obj.startAt) : null;
  const endAt = obj.endAt ? String(obj.endAt) : null;

  const createdAt = obj.createdAt ? String(obj.createdAt) : nowIso();
  const updatedAt = nowIso();

  return {
    id,
    title,
    enabled,
    characterPicks,
    startAt,
    endAt,
    createdAt,
    updatedAt,
  };
}

export function isHomeSlotActive(slot, atMs = Date.now()) {
  const s = sanitizeHomeSlot(slot);
  if (!s.enabled) return false;

  const startMs = safeParseMs(s.startAt);
  const endMs = safeParseMs(s.endAt);

  if (startMs !== null && atMs < startMs) return false;
  if (endMs !== null && atMs > endMs) return false;
  return true;
}

export function getHomeSlots() {
  try {
    const raw = localStorage.getItem(HOME_SLOTS_STORAGE_KEY);
    const defaults = DEFAULT_HOME_SLOTS.map(sanitizeHomeSlot);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw);
    const arr = Array.isArray(parsed) ? parsed : [];
    const normalized = arr.map(sanitizeHomeSlot);

    // ✅ 구버전(초기 더미 1개) 마이그레이션:
    // - 기존에 slot_1 하나만 있던 버전에서, "실제 홈 구좌 기본목록"으로 업그레이드한다.
    // - 사용자가 커스텀 구좌를 이미 추가해둔 경우를 고려해, '정확히 1개' + 'id/제목이 기본값'일 때만 교체한다.
    const isLegacyPlaceholderOnly =
      normalized.length === 1
      && String(normalized[0]?.id || '') === 'slot_1'
      && String(normalized[0]?.title || '') === '구좌 1';
    if (isLegacyPlaceholderOnly) return defaults;

    // ✅ 기본 구좌는 항상 포함되어야 한다(누락 방지/방어적):
    // - 저장된 목록이 있으면 그 순서를 우선 유지하되,
    // - 기본 구좌가 빠져 있으면 뒤에 추가한다.
    const existingIds = new Set(normalized.map((s) => String(s?.id || '').trim()).filter(Boolean));
    const merged = [...normalized];
    for (const d of defaults) {
      const id = String(d?.id || '').trim();
      if (!id) continue;
      if (!existingIds.has(id)) merged.push(d);
    }

    return merged.length ? merged : defaults;
  } catch (e) {
    try { console.error('[cmsSlots] getHomeSlots failed:', e); } catch (_) {}
    return DEFAULT_HOME_SLOTS.map(sanitizeHomeSlot);
  }
}

export function setHomeSlots(slots) {
  const arr = Array.isArray(slots) ? slots : [];
  const normalized = arr.map(sanitizeHomeSlot);
  try {
    localStorage.setItem(HOME_SLOTS_STORAGE_KEY, JSON.stringify(normalized));
    try { window.dispatchEvent(new Event(HOME_SLOTS_CHANGED_EVENT)); } catch (_) {}
    return { ok: true, items: normalized };
  } catch (e) {
    try { console.error('[cmsSlots] setHomeSlots failed:', e); } catch (_) {}
    return { ok: false, error: e, items: normalized };
  }
}

export function getActiveHomeSlots(atMs = Date.now()) {
  const all = getHomeSlots();
  return (all || []).filter((s) => isHomeSlotActive(s, atMs));
}


