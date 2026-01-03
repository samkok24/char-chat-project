/**
 * CMS(관리자) 홈 배너 설정 - 로컬스토리지 기반(데모용)
 *
 * 의도:
 * - "관리자 페이지 UI만" 먼저 만들기 위해 서버/DB 없이도 배너 CRUD가 가능하도록 한다.
 * - HomePage 캐러셀은 이 설정을 읽어 노출(기간/활성 여부 포함)한다.
 *
 * 주의:
 * - 로컬스토리지에 저장되므로 '해당 브라우저/기기'에만 유지된다.
 * - 운영에서 모든 유저에게 동일 배너를 노출하려면 추후 서버 저장소(DB/파일) 연동이 필요하다.
 */

export const HOME_BANNERS_STORAGE_KEY = 'cms:homeBanners:v1';
export const HOME_BANNERS_CHANGED_EVENT = 'cms:homeBannersChanged';

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
  return `bn_${Date.now()}_${Math.random().toString(16).slice(2)}`;
};

/**
 * 기본 배너(처음 진입 시 노출)
 * - 이미지/링크는 관리자가 CMS에서 교체하도록 "빈 이미지"로 둔다.
 */
export const DEFAULT_HOME_BANNERS = [
  {
    id: 'banner_notice',
    title: '공지사항',
    imageUrl: '',
    // 모바일 전용 배너(옵션). 없으면 imageUrl(PC/공통)을 사용한다.
    mobileImageUrl: '',
    linkUrl: '/notices',
    openInNewTab: false,
    enabled: true,
    startAt: null,
    endAt: null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  },
];

/**
 * 서버에서 내려온 배너 설정이 "초기 기본값(공지사항 1개 + 빈 이미지)"인지 판별한다.
 *
 * 왜 필요한가?
 * - 배포 직후 서버 SSOT가 비어 기본값만 내려오는 순간, 관리자 로컬 편집본이 덮어써져 사라지는 사고를 막기 위함.
 * - 단, 일반 유저는 로컬 캐시보다 서버 SSOT를 우선해야 하므로(운영 일관성),
 *   이 판별은 "관리자 로컬 보호" 같은 예외 상황에서만 쓰는 게 안전하다.
 */
export function isDefaultHomeBannersConfig(items) {
  try {
    const arr = Array.isArray(items) ? items : [];
    if (arr.length !== 1) return false;
    const b = arr[0] || {};

    const id = String(b.id || '').trim();
    if (id !== 'banner_notice') return false;

    const title = String(b.title || '').trim();
    const imageUrl = String(b.imageUrl || '').trim();
    const mobileImageUrl = String(b.mobileImageUrl || '').trim();
    const linkUrl = String(b.linkUrl || '').trim();
    const openInNewTab = !!b.openInNewTab;
    const enabled = b.enabled !== false; // default true

    // 기간은 null/빈값이어야 기본값으로 취급
    const startAt = (b.startAt ? String(b.startAt).trim() : '');
    const endAt = (b.endAt ? String(b.endAt).trim() : '');

    return (
      title === '공지사항' &&
      imageUrl === '' &&
      mobileImageUrl === '' &&
      linkUrl === '/notices' &&
      openInNewTab === false &&
      enabled === true &&
      !startAt &&
      !endAt
    );
  } catch (_) {
    return false;
  }
}

export function sanitizeHomeBanner(raw) {
  const obj = (raw && typeof raw === 'object') ? raw : {};

  const id = String(obj.id || '').trim() || genId();
  const title = String(obj.title || '').trim() || '배너';
  const imageUrl = String(obj.imageUrl || '').trim();
  const mobileImageUrl = String(obj.mobileImageUrl || '').trim();
  const linkUrl = String(obj.linkUrl || '').trim();

  const enabled = obj.enabled !== false; // default true
  const openInNewTab = !!obj.openInNewTab;

  const startAt = obj.startAt ? String(obj.startAt) : null;
  const endAt = obj.endAt ? String(obj.endAt) : null;

  const createdAt = obj.createdAt ? String(obj.createdAt) : nowIso();
  const updatedAt = nowIso();

  return {
    id,
    title,
    imageUrl,
    mobileImageUrl,
    linkUrl,
    openInNewTab,
    enabled,
    startAt,
    endAt,
    createdAt,
    updatedAt,
  };
}

export function isHomeBannerActive(banner, atMs = Date.now()) {
  const b = sanitizeHomeBanner(banner);
  if (!b.enabled) return false;

  const startMs = safeParseMs(b.startAt);
  const endMs = safeParseMs(b.endAt);

  if (startMs !== null && atMs < startMs) return false;
  if (endMs !== null && atMs > endMs) return false;
  return true;
}

export function getHomeBanners() {
  try {
    const raw = localStorage.getItem(HOME_BANNERS_STORAGE_KEY);
    if (!raw) return DEFAULT_HOME_BANNERS.map(sanitizeHomeBanner);
    const parsed = JSON.parse(raw);
    const arr = Array.isArray(parsed) ? parsed : [];
    const normalized = arr.map(sanitizeHomeBanner);
    return normalized.length ? normalized : DEFAULT_HOME_BANNERS.map(sanitizeHomeBanner);
  } catch (e) {
    try { console.error('[cmsBanners] getHomeBanners failed:', e); } catch (_) {}
    return DEFAULT_HOME_BANNERS.map(sanitizeHomeBanner);
  }
}

export function setHomeBanners(banners) {
  const arr = Array.isArray(banners) ? banners : [];
  const normalized = arr.map(sanitizeHomeBanner);
  try {
    localStorage.setItem(HOME_BANNERS_STORAGE_KEY, JSON.stringify(normalized));
    try { window.dispatchEvent(new Event(HOME_BANNERS_CHANGED_EVENT)); } catch (_) {}
    return { ok: true, items: normalized };
  } catch (e) {
    // QuotaExceededError 등
    try { console.error('[cmsBanners] setHomeBanners failed:', e); } catch (_) {}
    return { ok: false, error: e, items: normalized };
  }
}

export function getActiveHomeBanners(atMs = Date.now()) {
  const all = getHomeBanners();
  return (all || []).filter((b) => isHomeBannerActive(b, atMs));
}






