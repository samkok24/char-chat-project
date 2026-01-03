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

// ✅ (삭제됨) 구버전 호환: 과거 "추천 캐릭터로 시작하기" 구좌 id
// - 현재 요구사항에서 제거되었으므로, 로컬스토리지에 남아있더라도 UI에서 자동으로 제외한다.
const LEGACY_REMOVED_SLOT_IDS = new Set(['slot_curated_characters']);

/**
 * 홈 구좌 ID(시스템 기본 구좌) 목록
 *
 * 의도/동작:
 * - 기본 홈 섹션(트렌딩/원작챗/추천 등)은 HomePage에서 "정해진 컴포넌트"로 렌더링된다.
 * - CMS에서 "커스텀 구좌(수동 선택 컨텐츠)"를 추가할 때, 시스템 구좌와 구분이 필요하다.
 *
 * 주의:
 * - id는 SSOT로 여기에서만 관리한다(프론트/홈 렌더링, CMS 편집 UI에서 공통 사용).
 */
export const HOME_SLOTS_SYSTEM_IDS = [
  'slot_top_origchat',
  'slot_trending_characters',
  'slot_top_stories',
  'slot_recommended_characters',
  'slot_daily_tag_characters',
];

export function isSystemHomeSlotId(idLike) {
  try {
    const id = String(idLike || '').trim();
    if (!id) return false;
    return HOME_SLOTS_SYSTEM_IDS.includes(id);
  } catch (_) {
    return false;
  }
}

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

/**
 * 서버에서 내려온 구좌 설정이 "초기 기본값(시스템 5개 + 비활성/기간/커스텀픽 없음)"인지 판별한다.
 *
 * 왜 필요한가?
 * - 배포 직후 서버 SSOT가 비어 기본값만 내려오는 순간, 관리자 로컬 편집본이 덮어써져 사라지는 사고를 막기 위함.
 * - 단, 일반 유저는 로컬 캐시보다 서버 SSOT를 우선해야 하므로(운영 일관성),
 *   이 판별은 "관리자 로컬 보호" 같은 예외 상황에서만 쓰는 게 안전하다.
 */
export function isDefaultHomeSlotsConfig(items) {
  try {
    const arr = Array.isArray(items) ? items : [];
    if (arr.length !== HOME_SLOTS_SYSTEM_IDS.length) return false;

    // id -> expected title(기본값)
    const expectedTitleById = new Map((DEFAULT_HOME_SLOTS || []).map((s) => [String(s?.id || '').trim(), String(s?.title || '').trim()]));

    for (const id of HOME_SLOTS_SYSTEM_IDS) {
      const sid = String(id || '').trim();
      const it = arr.find((x) => String(x?.id || '').trim() === sid);
      if (!it) return false;

      // 기본 타이틀이 아니면 서버가 이미 커스터마이즈된 상태이므로 기본값이 아님
      const expectedTitle = expectedTitleById.get(sid) || '';
      const title = String(it?.title || '').trim();
      if (expectedTitle && title && title !== expectedTitle) return false;

      // enabled 기본은 true
      const enabled = it?.enabled !== false;
      if (!enabled) return false;

      // 기간은 비어있어야 기본값
      const startAt = it?.startAt ? String(it.startAt).trim() : '';
      const endAt = it?.endAt ? String(it.endAt).trim() : '';
      if (startAt || endAt) return false;

      // 커스텀 픽은 없어야 기본값
      const picks = Array.isArray(it?.contentPicks) ? it.contentPicks : [];
      if (picks.length > 0) return false;

      // 정렬 기본은 metric
      const sortMode = String(it?.contentSortMode || '').trim().toLowerCase();
      if (sortMode && sortMode !== 'metric') return false;

      // slotType이 내려오면 system이어야 기본값
      const slotType = String(it?.slotType || '').trim().toLowerCase();
      if (slotType && slotType !== 'system') return false;
    }

    return true;
  } catch (_) {
    return false;
  }
}

export function sanitizeHomeSlot(raw) {
  const obj = (raw && typeof raw === 'object') ? raw : {};

  const id = String(obj.id || '').trim() || genId();
  const title = String(obj.title || '').trim() || '구좌';
  const enabled = obj.enabled !== false; // default true

  /**
   * 커스텀 구좌 타입
   *
   * 의도/동작:
   * - system: 홈에서 정해진 컴포넌트로 렌더링되는 기본 구좌
   * - custom: 운영자가 CMS에서 "선택한 캐릭터/웹소설"을 담아 노출하는 커스텀 구좌
   *
   * 방어적:
   * - 저장값이 없으면 id 기반으로 추론한다.
   */
  let slotType = String(obj.slotType || obj.type || '').trim().toLowerCase();
  if (slotType !== 'system' && slotType !== 'custom') {
    slotType = isSystemHomeSlotId(id) ? 'system' : 'custom';
  }

  const startAt = obj.startAt ? String(obj.startAt) : null;
  const endAt = obj.endAt ? String(obj.endAt) : null;

  /**
   * 커스텀 구좌: 선택한 콘텐츠 목록
   *
   * 요구사항:
   * - 캐릭터(일반/원작챗) + 웹소설(스토리)을 혼합 선택 가능
   * - 다중 선택 후 저장
   * - 정렬: 대화수/조회수 순 또는 랜덤(새로고침마다)
   *
   * 저장 형태(SSOT):
   * - contentPicks: [{ type: 'character'|'story', item: {...} }]
   * - contentSortMode: 'metric'|'random'
   *
   * 방어적:
   * - 중복(type+id) 제거
   * - 최대 개수 제한(로컬스토리지 용량 보호)
   */
  const rawContentPicks = Array.isArray(obj.contentPicks) ? obj.contentPicks : [];
  const contentPicks = [];
  const seenKeys = new Set();
  const MAX_CUSTOM_PICKS = 40;
  for (const p of rawContentPicks) {
    try {
      const t = String(p?.type || p?.kind || '').trim().toLowerCase();
      const type = (t === 'story' || t === 'webnovel') ? 'story' : (t === 'character' ? 'character' : '');
      if (!type) continue;

      const src = (p && typeof p === 'object')
        ? (p.item || p.character || p.story || p.data || p)
        : null;
      const rid = String(src?.id || src?.story_id || src?.character_id || '').trim();
      if (!rid) continue;

      const k = `${type}:${rid}`;
      if (seenKeys.has(k)) continue;
      seenKeys.add(k);

      if (type === 'character') {
        const originStoryId = src?.origin_story_id || src?.originStoryId || null;
        const chatCount = Number(src?.chat_count ?? src?.chatCount ?? 0) || 0;
        const likeCount = Number(src?.like_count ?? src?.likeCount ?? 0) || 0;
        contentPicks.push({
          type: 'character',
          item: {
            id: rid,
            name: String(src?.name || '').trim() || '캐릭터',
            description: String(src?.description || '').trim(),
            avatar_url: String(src?.avatar_url || src?.thumbnail_url || '').trim(),
            thumbnail_url: String(src?.thumbnail_url || '').trim(),
            origin_story_id: originStoryId ? String(originStoryId) : null,
            is_origchat: !!originStoryId || !!src?.is_origchat,
            source_type: src?.source_type,
            chat_count: chatCount,
            like_count: likeCount,
            creator_id: src?.creator_id || null,
            creator_username: src?.creator_username || '',
            creator_avatar_url: src?.creator_avatar_url || '',
          },
        });
      } else {
        // story/webnovel
        const viewCount = Number(src?.view_count ?? src?.viewCount ?? 0) || 0;
        const likeCount = Number(src?.like_count ?? src?.likeCount ?? 0) || 0;
        const tags = Array.isArray(src?.tags) ? src.tags.filter(Boolean).map((x) => String(x)) : [];
        contentPicks.push({
          type: 'story',
          item: {
            id: rid,
            title: String(src?.title || '').trim() || '제목 없음',
            excerpt: String(src?.excerpt || '').trim(),
            cover_url: String(src?.cover_url || src?.coverUrl || '').trim(),
            is_webtoon: !!src?.is_webtoon,
            is_origchat: !!src?.is_origchat,
            view_count: viewCount,
            like_count: likeCount,
            tags,
            creator_id: src?.creator_id || null,
            creator_username: src?.creator_username || '',
            creator_avatar_url: src?.creator_avatar_url || '',
          },
        });
      }

      if (contentPicks.length >= MAX_CUSTOM_PICKS) break;
    } catch (_) {
      // ignore bad item
    }
  }

  let contentSortMode = String(obj.contentSortMode || obj.sortMode || '').trim().toLowerCase();
  if (contentSortMode !== 'random' && contentSortMode !== 'metric') contentSortMode = 'metric';

  const createdAt = obj.createdAt ? String(obj.createdAt) : nowIso();
  const updatedAt = nowIso();

  return {
    id,
    title,
    enabled,
    slotType,
    // custom
    contentPicks,
    contentSortMode,
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
    const normalized = arr
      .map(sanitizeHomeSlot)
      // ✅ 과거 제거된 구좌는 자동 제외 (CMS/홈 모두에서 안 보이게)
      .filter((s) => {
        const id = String(s?.id || '').trim();
        if (!id) return false;
        return !LEGACY_REMOVED_SLOT_IDS.has(id);
      });

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


