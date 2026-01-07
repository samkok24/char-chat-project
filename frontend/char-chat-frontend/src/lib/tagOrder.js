/**
 * 태그 노출 우선순위/정렬 유틸
 *
 * 목표:
 * - "캐릭터 탭" / "태그 선택 모달"에서 사람들이 많이 찾는 태그(특히 남성향)를 앞에 배치
 * - 우선순위에 없는 태그는 기존 정렬(가나다 등)을 유지하여 예측 가능하게 한다.
 */

// ✅ 남성향 위주 우선순위(상단 18개가 UX상 가장 중요)
export const CHARACTER_TAG_PRIORITY_SLUGS = [
  // 1) 장르/큰 취향
  '판타지',
  '현대판타지',
  '이세계',
  '무협',
  'SF',
  '액션',
  '미스터리',
  '느와르',
  '공포',
  '대체역사',
  '역사',
  '일상',

  // 2) 소재/구조(클릭률 높은 한방 키워드)
  '헌터',
  '던전',
  '배틀',
  '마법사',
  '기사',
  '괴물',
  '밀리터리',
  '빙의',
  '변신',
  '모험',

  // 2-2) 요청 추가 소재
  '학교',
  '아카데미',
  '학원물',
  '스트리머',

  // 3) 사건/트로프
  '복수',
  '참교육',
  '구원',
  '비밀',
  '재난',
  '조난',
  '방탈출',
  '정치물',
  '스포츠',
];

/**
 * 우선순위 태그를 먼저 배치하고, 나머지는 원래 순서를 유지한다(안정적).
 *
 * @param {Array<{slug?: string, name?: string}>} tags
 * @param {string[]} prioritySlugs
 * @returns {Array<any>}
 */
export function sortTagsByPriority(tags = [], prioritySlugs = CHARACTER_TAG_PRIORITY_SLUGS) {
  const list = Array.isArray(tags) ? tags : [];
  const pr = Array.isArray(prioritySlugs) ? prioritySlugs : [];
  const bySlug = new Map();
  for (const t of list) {
    const slug = String(t?.slug || '').trim();
    if (slug) bySlug.set(slug, t);
  }

  const used = new Set();
  const out = [];
  for (const slug of pr) {
    const s = String(slug || '').trim();
    if (!s) continue;
    const t = bySlug.get(s);
    if (!t) continue;
    if (used.has(s)) continue;
    used.add(s);
    out.push(t);
  }
  for (const t of list) {
    const slug = String(t?.slug || '').trim();
    if (!slug) continue;
    if (used.has(slug)) continue;
    out.push(t);
  }
  return out;
}

/**
 * CMS(관리자)에서 내려온 태그 노출 설정을 적용한다.
 *
 * 동작:
 * - hiddenSlugs: 목록에서 제거
 * - prioritySlugs: 앞쪽으로 당김
 * - prioritySlugs가 비어있으면 fallback(기본 남성향 우선순위) 사용
 *
 * @param {Array<{slug?: string, name?: string}>} tags
 * @param {{prioritySlugs?: string[], hiddenSlugs?: string[]}} displayConfig
 * @param {string[]} fallbackPrioritySlugs
 * @returns {Array<any>}
 */
export function applyTagDisplayConfig(
  tags = [],
  displayConfig = {},
  fallbackPrioritySlugs = CHARACTER_TAG_PRIORITY_SLUGS
) {
  const list = Array.isArray(tags) ? tags : [];
  /**
   * ✅ 정책(UX/운영 안정):
   * - CMS에서 "숨김만" 조작하는 경우가 많다.
   * - 이때 prioritySlugs가 비어있으면, 유저 경험상 "기본 우선순위(판타지…)"가 유지되는 게 자연스럽다.
   * - 따라서 prioritySlugs가 비어있을 때는 항상 fallback(기본 우선순위)로 폴백한다.
   *   (가나다 순만 원하면, 추후 CMS에 '우선노출 끄기' 토글을 별도로 추가하는 게 안전)
   */
  const hasPriority = Array.isArray(displayConfig?.prioritySlugs) && displayConfig.prioritySlugs.length > 0;
  const prioritySlugs = hasPriority
    ? displayConfig.prioritySlugs
    : (Array.isArray(fallbackPrioritySlugs) ? fallbackPrioritySlugs : []);
  const hidden = Array.isArray(displayConfig?.hiddenSlugs) ? displayConfig.hiddenSlugs : [];
  const hiddenSet = new Set(hidden.map((s) => String(s || '').trim()).filter(Boolean));
  const visible = list.filter((t) => {
    const slug = String(t?.slug || '').trim();
    if (!slug) return false;
    if (slug.startsWith('cover:')) return false;
    return !hiddenSet.has(slug);
  });
  return sortTagsByPriority(visible, prioritySlugs);
}


