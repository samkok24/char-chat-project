import React from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { LazyLoadImage } from 'react-lazy-load-image-component';
import 'react-lazy-load-image-component/src/effects/blur.css';
import { Skeleton } from './ui/skeleton';
import { getThumbnailUrl } from '../lib/images';
import { resolveImageUrl } from '../lib/images';
import { DEFAULT_SQUARE_URI } from '../lib/placeholder';
import { Heart } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar';
import { Badge } from './ui/badge';
import { formatCount } from '../lib/format';
import { storiesAPI, charactersAPI } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { replacePromptTokens } from '../lib/prompt';

// ✅ 홈 격자에서 태그 API를 매 카드마다 반복 호출하지 않도록 간단 캐시(메모리) 사용
const _HOME_CHAR_TAGS_CACHE = new Map();

/**
 * 캐릭터 카드(재사용 컴포넌트)
 *
 * 의도/동작:
 * - 여러 화면(탐색/홈 탭 등)에서 재사용되는 카드 컴포넌트다.
 * - 기본값은 "탐색 카드" 스타일을 유지한다(기존 동작/디자인 보호).
 * - `variant="home"`를 주면, 홈 메인 구좌 카드와 동일한 래퍼 스타일로 렌더링한다.
 *   (요구사항: 캐릭터탭/원작챗탭 그리드를 홈 메인 카드 스타일로 맞추기)
 */
export const CharacterCard = ({
  character,
  onCardClick,
  onButtonClick,
  footerContent,
  showOriginBadge = false,
  variant = 'explore', // 'explore' | 'home'
}) => {
  const navigate = useNavigate();
  const { profileVersion } = useAuth();
  const charId = character?.id || character?.character_id || character?.characterId || character?.target_id;
  const isWebNovel = character?.source_type === 'IMPORTED';
  const isFromOrigChat = !!(character?.origin_story_id || character?.is_origchat || character?.source === 'origchat');
  const borderClass = isFromOrigChat ? 'border-orange-500/60' : (isWebNovel ? 'border-blue-500/40' : 'border-purple-500/40');
  const hoverBorderClass = isFromOrigChat ? 'hover:border-orange-500' : (isWebNovel ? 'hover:border-blue-500' : 'hover:border-purple-500');
  const [originTitle, setOriginTitle] = React.useState(character?.origin_story_title || '');
  const [homeCharTags, setHomeCharTags] = React.useState([]);
  // ✅ 초기 런칭 UX:
  // - "대화수"는 초기엔 0이 많아 '사람 없음'으로 읽히기 쉬워 카드에서 아예 숨긴다.
  // - 좋아요도 0이면 굳이 표시하지 않는다(>0일 때만 노출).
  const likeCount = Number(character?.like_count ?? character?.likeCount ?? 0) || 0;
  const showLikeCount = likeCount > 0;
  // ✅ NEW 배지(요구사항): 생성일 기준 48시간 동안 N 표시
  const isNew = (() => {
    try {
      const raw = character?.created_at || character?.createdAt;
      if (!raw) return false;
      const t = new Date(raw).getTime();
      if (!Number.isFinite(t) || t <= 0) return false;
      const diff = Date.now() - t;
      return diff >= 0 && diff <= 48 * 60 * 60 * 1000;
    } catch (_) {
      return false;
    }
  })();

  const handleCardClick = () => {
    if (onCardClick) {
      onCardClick(charId);
    } else {
      /**
       * ✅ PC 홈(대시보드) 전용: 일반 캐릭터챗 클릭 시 "모바일 상세 모달" 오픈
       *
       * 배경/의도:
       * - 홈에는 Trending/Recommended/CMS 구좌 등 여러 컴포넌트가 `CharacterCard(variant="home")`를 직접 렌더링한다.
       * - 모든 호출부에 onCardClick을 일일이 전달하면 수정 범위가 커지므로,
       *   홈(/dashboard)에서만 동작하는 이벤트 훅으로 최소 수정/안정적으로 모달 프리뷰 UX를 제공한다.
       *
       * 동작 조건:
       * - variant === 'home'
       * - 현재 경로가 /dashboard (홈)
       * - PC 화면(모바일은 기존 랜딩 유지)
       * - 일반 캐릭터챗만(원작챗/웹소설 제외)
       */
      try {
        const isHomeVariant = variant === 'home';
        const path = typeof window !== 'undefined' ? String(window.location?.pathname || '') : '';
        const isDashboard = path === '/dashboard';
        const isMobileViewport = typeof window !== 'undefined' ? (window.matchMedia && window.matchMedia('(max-width: 1023px)').matches) : false;
        // ✅ PC 홈 모달 프리뷰 대상:
        // - 일반 캐릭터챗 + 원작챗(요청: 원작챗도 모달 프리뷰)
        // - 단, "원작이 아닌 IMPORTED(웹소설/연재 기반)"는 기존대로 상세 페이지 랜딩 유지
        const isEligibleForHomePcModal = isFromOrigChat || (!isFromOrigChat && !isWebNovel);
        if (isHomeVariant && isDashboard && !isMobileViewport && isEligibleForHomePcModal && charId) {
          window.dispatchEvent(new CustomEvent('home:pc-mobile-detail', { detail: { characterId: String(charId) } }));
          return;
        }
      } catch (_) {}

      if (charId) navigate(`/characters/${charId}`);
    }
  };

  const handleButtonClick = (e) => {
    e.stopPropagation();
    if (onButtonClick) {
      onButtonClick(charId, character.chat_room_id);
    } else {
      if (!charId) return;
      // ✅ 원작챗 캐릭터는 일반챗이 아니라 origchat plain 모드로 진입해야 한다.
      const sid = String(character?.origin_story_id || '').trim();
      if (isFromOrigChat && sid) {
        navigate(`/ws/chat/${charId}?source=origchat&storyId=${sid}&mode=plain`);
        return;
      }
      navigate(`/ws/chat/${charId}`);
    }
  };

  React.useEffect(() => {
    let active = true;
    const fetchTitleIfNeeded = async () => {
      if (!showOriginBadge) return;
      const sid = character?.origin_story_id;
      if (!sid) return;
      if (character?.origin_story_title) return; // already provided
      try {
        const res = await storiesAPI.getStory(sid);
        if (!active) return;
        const t = res.data?.title;
        if (t) setOriginTitle(t);
      } catch (_) {}
    };
    fetchTitleIfNeeded();
    return () => { active = false; };
  }, [showOriginBadge, character?.origin_story_id, character?.origin_story_title]);

  React.useEffect(() => {
    /**
     * 홈 격자 태그 로딩(방어적)
     *
     * 의도:
     * - 캐릭터 목록 응답에는 tags가 포함되지 않아(백엔드 스키마), 별도 엔드포인트로 필요할 때만 보강한다.
     * - 화면에 많이 노출되는 카드에서 네트워크 폭발을 막기 위해, 메모리 캐시로 1회만 로딩한다.
     */
    if (variant !== 'home') return;
    const id = String(charId || '').trim();
    if (!id) return;

    try {
      if (_HOME_CHAR_TAGS_CACHE.has(id)) {
        setHomeCharTags(_HOME_CHAR_TAGS_CACHE.get(id) || []);
        return;
      }
    } catch (_) {}

    let cancelled = false;
    const load = async () => {
      try {
        const res = await charactersAPI.getCharacterTags(id);
        const rows = Array.isArray(res?.data) ? res.data : [];
        const tags = rows
          .map((t) => String(t?.name || t?.slug || '').trim())
          .filter(Boolean)
          ;
        try { _HOME_CHAR_TAGS_CACHE.set(id, tags); } catch (_) {}
        if (!cancelled) setHomeCharTags(tags);
      } catch (e) {
        // 태그는 부가 정보이므로 실패해도 카드/홈 UX는 깨지지 않게 한다.
        try { _HOME_CHAR_TAGS_CACHE.set(id, []); } catch (_) {}
        if (!cancelled) setHomeCharTags([]);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [variant, charId]);

  const avatarSrc = (() => {
    /**
     * ✅ 성능/UX(치명 포인트):
     * - 기존 `?v=${Date.now()}`는 렌더마다 URL이 바뀌어 브라우저 캐시가 무력화된다.
     * - 메인 격자/추천/트렌딩 등에서 카드가 많이 렌더되므로 "이미지 로딩이 느림" 체감의 1순위 원인.
     *
     * 해결:
     * - 캐시 버스터는 "안정적인 버전 키"(updated_at/created_at)로만 붙인다.
     * - 버전 키가 없으면 URL을 그대로 사용해 캐시를 살린다.
     */
    const base = String(character?.avatar_url || character?.thumbnail_url || '').trim();
    if (!base) return DEFAULT_SQUARE_URI;
    // data: URL은 버전 파라미터를 붙이면 더 무거워질 수 있어 그대로 사용
    if (/^data:/i.test(base)) return resolveImageUrl(base) || base;

    const versionKey = String(
      character?.updated_at ||
        character?.updatedAt ||
        character?.created_at ||
        character?.createdAt ||
        ''
    ).trim();

    if (!versionKey) return resolveImageUrl(base) || base || DEFAULT_SQUARE_URI;

    let ver = versionKey;
    try {
      const t = new Date(versionKey).getTime();
      if (Number.isFinite(t) && t > 0) ver = String(t);
    } catch (_) {}

    const joined = `${base}${base.includes('?') ? '&' : '?'}v=${encodeURIComponent(ver)}`;
    return resolveImageUrl(joined) || joined || DEFAULT_SQUARE_URI;
  })();

  const renderedDescription = (() => {
    const nm = character?.name || '캐릭터';
    const raw = character?.description || '';
    const rendered = replacePromptTokens(raw, { assistantName: nm, userName: '당신' }).trim();
    return rendered || '설명이 없습니다.';
  })();

  /**
   * 격자 좌상단 "턴수 배지" 텍스트 계산
   *
   * 의도/원리:
   * - SSOT: `start_sets.sim_options.max_turns` 값을 사용한다.
   *   - 목록(list) 응답은 start_sets를 포함하지 않으므로, 백엔드에서 파생 필드 `max_turns`를 같이 내려준다.
   * - 오래된 캐릭터(턴수 저장이 없던 시절)는 분량 안내를 위해 '∞'로 표시한다(일반 캐릭터챗만).
   * - 원작챗/웹소설은 턴수 개념이 보장되지 않으므로, 값이 있을 때만 표시한다.
   */
  const turnBadgeText = (() => {
    try {
      const raw =
        character?.max_turns
        ?? character?.start_sets?.sim_options?.max_turns
        ?? character?.start_sets?.sim_options?.maxTurns;
      const n = Number(raw);
      const turns = Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
      if (turns != null) return `${turns}턴`;
      // 일반 캐릭터챗만 기본값으로 ∞ 표시(구서버/구데이터 방어)
      if (!isFromOrigChat && !isWebNovel) return '∞';
      return null;
    } catch (_) {
      return (!isFromOrigChat && !isWebNovel) ? '∞' : null;
    }
  })();

  /**
   * ✅ 격자 카드 "태그 노출" 정책(요구사항)
   *
   * - 격자에서는 `남성향/여성향` → `롤플/시뮬/커스텀` 순으로 우선 노출한다.
   * - 그 뒤에 나머지 태그도 이어서 "쭉" 노출한다(가독성 위해 최대 개수는 제한).
   * - `전체`는 선택 정보가 아니므로(=전체 선택) 배지/태그를 숨긴다.
   */
  const getGridBadgeLabels = ({ rawTags }) => {
    try {
      const tags = Array.isArray(rawTags) ? rawTags : [];
      const tagLabels = tags
        .map((t) => String(t?.name || t?.slug || t || '').trim())
        .filter(Boolean);

      const modeRaw = String(
        character?.basic_info?.character_type
        ?? character?.character_type
        ?? character?.prompt_type
        ?? character?.start_sets?.basic_info?.character_type
        ?? ''
      ).trim();
      const modeLower = modeRaw.toLowerCase();
      const modeLabel = (() => {
        if (!modeLower && !modeRaw) return '';
        if (modeLower === 'roleplay' || modeRaw.includes('롤플')) return '롤플';
        if (modeLower === 'simulator' || modeRaw.includes('시뮬')) return '시뮬';
        if (modeLower === 'custom' || modeRaw.includes('커스텀')) return '커스텀';
        return '';
      })();

      const audience = tagLabels.find((x) => x === '남성향' || x === '여성향' || x === '전체') || '';
      const audienceLabel = (audience === '전체') ? '' : audience;

      // ✅ 요청사항: 남성향/여성향 → 롤플/시뮬/커스텀 → 나머지 태그 순서로 이어서 노출
      const out = [];
      for (const x of [audienceLabel, modeLabel]) {
        const v = String(x || '').trim();
        if (!v) continue;
        if (!out.includes(v)) out.push(v);
      }
      for (const x of tagLabels) {
        const v = String(x || '').trim();
        if (!v) continue;
        if (v === '전체') continue;
        if (!out.includes(v)) out.push(v);
      }
      return out;
    } catch (_) {
      return [];
    }
  };

  /**
   * 태그 칩 렌더러
   *
   * 의도/원리:
   * - 경쟁사 격자와 동일하게 "tag chip" 형태로 보여준다.
   * - 리스트 응답/홈 태그 API 응답 등 다양한 소스가 섞이므로, label만 방어적으로 추출한다.
   */
  const renderTagChips = (labels) => {
    const list = Array.isArray(labels) ? labels : [];
    return list
      .map((t) => String(t || '').trim())
      .filter(Boolean)
      .slice(0, 12)
      .map((t) => (
        <div
          key={t}
          role="button"
          id="tag"
          // ✅ 우리 스타일(타원형) + 보라색 텍스트 + 작은 글씨 + '#' 제거
          className="inline-flex items-center whitespace-nowrap rounded-full border border-purple-500/25 bg-gray-900/40 px-2 py-0.5 text-[11px] font-medium leading-none text-purple-300"
        >
          {t}
        </div>
      ));
  };

  // ✅ 홈 메인 구좌 카드 스타일(요구사항): "이미지 위 오버레이" 톤으로 통일
  if (variant === 'home') {
    // ✅ 원작챗(=웹소설 원작 기반) 격자 UX:
    // - 원작챗 카드는 "크리에이터 닉네임"보다 "어떤 웹소설의 원작인지"가 더 중요한 정보다.
    // - 그래서 원작챗 격자에서는 크리에이터 닉네임 대신 "웹소설 원작 배지(원작 제목)"를 노출한다.
    const originStoryId = String(character?.origin_story_id || '').trim();
    const originBadgeText = String(character?.origin_story_title || originTitle || '').trim() || '웹소설 원작';

    const creatorUsername = String(character?.creator_username || '').trim();
    const creatorId = String(character?.creator_id || '').trim();
    const showCreator = Boolean(creatorUsername && creatorId);
    const badgeLabels = getGridBadgeLabels({ rawTags: homeCharTags });
    const showBadges = Array.isArray(badgeLabels) && badgeLabels.length > 0;

    return (
      <div role="button" className="flex w-full flex-col" onClick={handleCardClick}>
        <div className="group relative aspect-square w-full rounded-xl bg-gray-900">
          <img
            alt={character?.name}
            src={getThumbnailUrl(avatarSrc, 400) || avatarSrc || DEFAULT_SQUARE_URI}
            className="absolute inset-0 aspect-square size-full rounded-xl object-cover cc-grid-face-crop transition-opacity duration-300 ease-in-out group-hover:opacity-70"
            loading="lazy"
            decoding="async"
            draggable="false"
            onError={(e) => {
              try { e.currentTarget.src = DEFAULT_SQUARE_URI; } catch (_) {}
            }}
          />

          {/* 좌상단 배지: 턴수 + (원작챗/웹소설) */}
          {(turnBadgeText || isFromOrigChat || isWebNovel) ? (
            <div className="absolute top-2 left-2 z-10 flex flex-col items-start gap-1">
              {turnBadgeText ? (
                <Badge className="bg-purple-600/90 text-white hover:bg-purple-600 px-1.5 py-0.5 text-[11px]">
                  {turnBadgeText}
                </Badge>
              ) : null}
              {(isFromOrigChat || isWebNovel) ? (
                isFromOrigChat ? (
                  <Badge className="bg-orange-400 text-black hover:bg-orange-400 px-1.5 py-0.5 text-[11px]">원작챗</Badge>
                ) : (
                  <Badge className="bg-blue-600 text-white hover:bg-blue-600 px-1.5 py-0.5 text-[11px]">웹소설</Badge>
                )
              ) : null}
            </div>
          ) : null}

          {/* NEW */}
          {isNew ? (
            <div className="absolute top-2 right-2 z-10 pointer-events-none select-none">
              <div className="flex size-6 shrink-0 items-center justify-center rounded-sm bg-gradient-to-r from-orange-500 to-red-500 text-M/14 text-white font-extrabold shadow-md">
                N
              </div>
            </div>
          ) : null}

          <div className="absolute inset-0 rounded-xl bg-black opacity-0 transition-opacity duration-300 ease-in-out group-hover:opacity-30" />
        </div>

        {/* ✅ 이미지-이름 간격: mt-5 → mt-2.5 (절반) */}
        <div className="mt-2.5 flex w-full shrink-0 justify-between">
          {/* ✅ 이름은 1줄 고정 + 이클립스(긴 이름으로 레이아웃 밀림 방지)
           * - flex 아이템에서 truncate가 안정적으로 동작하려면 min-w-0가 필요하다.
           */}
          <div className="min-w-0 max-w-[80%] flex-1 truncate text-base font-bold text-content-primary">
            {character?.name}
          </div>
          {showLikeCount ? (
            <div className="my-auto flex items-center justify-center gap-0.5 whitespace-nowrap text-xs font-semibold">
              <Heart className="size-4 min-h-4 min-w-4 cursor-pointer text-content-primary" />
              <span className="text-content-primary">{formatCount(likeCount)}</span>
            </div>
          ) : null}
        </div>

        {/* ✅ 한줄소개: 행간을 넓혀 가독성 개선 */}
        <div className="mt-1 line-clamp-2 w-full shrink-0 text-M/14 text-content-tertiary leading-relaxed">
          {renderedDescription}
        </div>

        {/* ✅ 격자 배지(롤플/시뮬/커스텀 → 남성향/여성향) */}
        {showBadges ? (
          <div className="mt-0.5 flex w-full shrink-0 flex-wrap items-center gap-1 self-start">
            {renderTagChips(badgeLabels)}
          </div>
        ) : null}

        {/* ✅ 태그-크리에이터 닉네임 간격 확보 */}
        <div role="button" id="creator" className="mt-2.5 flex flex-row items-center gap-1">
          {isFromOrigChat && originStoryId ? (
            <Link
              to={`/stories/${originStoryId}`}
              onClick={(e) => e.stopPropagation()}
              className="w-fit max-w-32 truncate text-M/12 text-[#808080] hover:text-content-primary"
              aria-label="원작 웹소설 보기"
              title={originBadgeText}
            >
              @{originBadgeText}
            </Link>
          ) : showCreator ? (
            <Link
              to={`/users/${creatorId}/creator`}
              onClick={(e) => e.stopPropagation()}
              className="w-fit max-w-32 truncate text-M/12 text-[#808080] hover:text-content-primary"
              aria-label="크리에이터 프로필 보기"
            >
              @{creatorUsername}
            </Link>
          ) : null}
        </div>
      </div>
    );
  }

  const creatorUsername = String(character?.creator_username || '').trim();
  const creatorId = String(character?.creator_id || '').trim();
  const showCreator = Boolean(creatorUsername && creatorId);

  return (
    <div role="button" className="flex w-full flex-col" onClick={handleCardClick}>
      <div className="group relative aspect-square w-full rounded-xl bg-gray-900">
        <LazyLoadImage
          alt={character.name}
          src={avatarSrc}
          effect="blur"
          className="absolute inset-0 aspect-square size-full rounded-xl object-cover cc-grid-face-crop transition-opacity duration-300 ease-in-out group-hover:opacity-70"
          wrapperClassName="absolute inset-0 w-full h-full"
        />

        {/* 좌상단 배지: 턴수 + (원작챗/웹소설) */}
        {(turnBadgeText || isFromOrigChat || character?.source_type === 'IMPORTED') ? (
          <div className="absolute top-2 left-2 z-10 flex flex-col items-start gap-1">
            {turnBadgeText ? (
              <Badge className="bg-purple-600/90 text-white hover:bg-purple-600 px-1.5 py-0.5 text-[11px]">
                {turnBadgeText}
              </Badge>
            ) : null}
            {(isFromOrigChat || character?.source_type === 'IMPORTED') ? (
              isFromOrigChat ? (
                <Badge className="bg-orange-400 text-black hover:bg-orange-400 px-1.5 py-0.5 text-[11px]">원작챗</Badge>
              ) : (
                <Badge className="bg-blue-600 text-white hover:bg-blue-600 px-1.5 py-0.5 text-[11px]">웹소설</Badge>
              )
            ) : null}
          </div>
        ) : null}

        {isNew ? (
          <div className="absolute top-2 right-2 z-10 pointer-events-none select-none">
            <div className="flex size-6 shrink-0 items-center justify-center rounded-sm bg-gradient-to-r from-orange-500 to-red-500 text-M/14 text-white font-extrabold shadow-md">
              N
            </div>
          </div>
        ) : null}

        <div className="absolute inset-0 rounded-xl bg-black opacity-0 transition-opacity duration-300 ease-in-out group-hover:opacity-30" />
      </div>

      {/* ✅ 이미지-이름 간격: mt-5 → mt-2.5 (절반) */}
      <div className="mt-2.5 flex w-full shrink-0 justify-between">
        {/* ✅ 이름은 1줄 고정 + 이클립스(긴 이름으로 레이아웃 밀림 방지)
         * - flex 아이템에서 truncate가 안정적으로 동작하려면 min-w-0가 필요하다.
         */}
        <div className="min-w-0 max-w-[80%] flex-1 truncate text-base font-bold text-content-primary">
          {character?.name}
        </div>
        {showLikeCount ? (
          <div className="my-auto flex items-center justify-center gap-0.5 whitespace-nowrap text-xs font-semibold">
            <Heart className="size-4 min-h-4 min-w-4 cursor-pointer text-content-primary" />
            <span className="text-content-primary">{formatCount(likeCount)}</span>
          </div>
        ) : null}
      </div>

      {/* ✅ 한줄소개: 행간을 넓혀 가독성 개선 */}
      <div className="mt-1 line-clamp-2 w-full shrink-0 text-M/14 text-content-tertiary leading-relaxed">
        {renderedDescription}
      </div>

      {/* ✅ 격자 배지(롤플/시뮬/커스텀 → 남성향/여성향) */}
      {(() => {
        const badgeLabels = getGridBadgeLabels({ rawTags: character?.tags });
        if (!Array.isArray(badgeLabels) || badgeLabels.length <= 0) return null;
        return (
        <div className="mt-0.5 flex w-full shrink-0 flex-wrap items-center gap-1 self-start">
          {renderTagChips(badgeLabels)}
        </div>
        );
      })()}

      {/* ✅ 태그-크리에이터 닉네임 간격 확보 */}
      <div role="button" id="creator" className="mt-2.5 flex flex-row items-center gap-1">
        {showCreator ? (
          <Link
            to={`/users/${creatorId}/creator`}
            onClick={(e) => e.stopPropagation()}
            className="w-fit max-w-32 truncate text-M/12 text-[#808080] hover:text-content-primary"
          >
            @{creatorUsername}
          </Link>
        ) : null}
      </div>
    </div>
  );
};

/**
 * 캐릭터 카드 스켈레톤
 *
 * 의도:
 * - `CharacterCard`와 동일하게 `variant="home"`를 지원해, 탭 별 UI 일관성을 유지한다.
 */
export const CharacterCardSkeleton = ({ variant = 'explore' } = {}) => {
  const isHome = variant === 'home';
  if (isHome) {
    return (
      <div className="bg-gray-800/50 rounded-lg overflow-hidden border border-gray-700/50">
        <div className="relative aspect-[3/4] bg-gray-700">
          <div className="absolute inset-x-0 bottom-0 p-3 space-y-2">
            <Skeleton className="h-4 w-3/4 bg-gray-600/70" />
            <Skeleton className="h-3 w-full bg-gray-600/60" />
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="bg-gray-800 rounded-xl overflow-hidden border border-gray-700">
      <Skeleton className="aspect-square bg-gray-700" />
      <div className="p-4 space-y-3">
        <Skeleton className="h-5 w-3/4 bg-gray-700" />
        <Skeleton className="h-3 w-1/2 bg-gray-700" />
        <div className="space-y-1">
          <Skeleton className="h-3 w-full bg-gray-700" />
          <Skeleton className="h-3 w-4/5 bg-gray-700" />
        </div>
        <div className="flex gap-3">
          <Skeleton className="h-3 w-12 bg-gray-700" />
          <Skeleton className="h-3 w-12 bg-gray-700" />
        </div>
      </div>
    </div>
  );
};  