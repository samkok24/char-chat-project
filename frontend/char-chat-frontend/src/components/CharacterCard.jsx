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

  const handleCardClick = () => {
    if (onCardClick) {
      onCardClick(charId);
    } else {
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
          .slice(0, 6);
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
    const showTags = Array.isArray(homeCharTags) && homeCharTags.length > 0;

    return (
      <div
        className="bg-gray-800/50 rounded-lg overflow-hidden border border-gray-700/50 group-hover:border-gray-600 transition-colors cursor-pointer group"
        onClick={handleCardClick}
      >
        {/* 이미지 영역 + 오버레이(요구사항) */}
        <div className="relative aspect-[3/4] overflow-hidden bg-gray-900">
          {/*
           * ✅ 오버레이 안정성:
           * - 일부 환경에서 LazyLoadImage(blur effect) 레이어/래퍼가 오버레이(텍스트)를 덮는 케이스가 있었다.
           * - 홈 격자(variant="home")에서는 단순 <img loading="lazy">로 렌더링해 오버레이가 항상 보이도록 한다.
           */}
          <img
            alt={character?.name}
            src={getThumbnailUrl(avatarSrc, 400) || avatarSrc || DEFAULT_SQUARE_URI}
            className="w-full h-full object-cover object-top group-hover:scale-105 transition-transform duration-300"
            loading="lazy"
            decoding="async"
            draggable="false"
            onError={(e) => {
              try { e.currentTarget.src = DEFAULT_SQUARE_URI; } catch (_) {}
            }}
          />
          <div className="absolute top-2 left-2 z-10">
            {isFromOrigChat ? (
              <Badge className="bg-orange-400 text-black hover:bg-orange-400 px-1.5 py-0.5 text-[11px]">원작챗</Badge>
            ) : isWebNovel ? (
              <Badge className="bg-blue-600 text-white hover:bg-blue-600 px-1.5 py-0.5 text-[11px]">웹소설</Badge>
            ) : (
              <Badge className="bg-purple-600 text-white hover:bg-purple-600 px-1.5 py-0.5 text-[11px]">캐릭터</Badge>
            )}
          </div>

          {/* 하단 오버레이(제목/설명/원작/좋아요) */}
          {/* ✅ z-index 보강 + position 정합성:
           * - `absolute`와 `relative`를 동시에 주면 Tailwind 유틸 우선순위로 `relative`가 이겨
           *   오버레이가 아래로 밀리고(부모 overflow-hidden에 잘림) 텍스트가 안 보일 수 있다.
           * - 오버레이는 반드시 absolute로 유지한다.
           */}
          <div className="absolute inset-x-0 bottom-0 z-20 p-3 pt-10 pb-9 bg-gradient-to-t from-black/90 via-black/40 to-transparent">
            <div className="flex items-start justify-between gap-2">
              <h4 className="text-white font-bold text-sm leading-tight line-clamp-1">
                {character?.name}
              </h4>
              {showLikeCount ? (
                <span className="inline-flex items-center gap-1 rounded bg-black/60 px-1.5 py-0.5 text-[11px] text-gray-100 shrink-0">
                  <Heart className="w-3 h-3 text-red-400" />
                  {formatCount(likeCount)}
                </span>
              ) : null}
            </div>

            <p className="mt-1 text-[11px] text-gray-200/80 line-clamp-2 leading-snug">
              {renderedDescription}
            </p>

            {/* ✅ 태그 칩: 소개글(2줄) 아래, 크리에이터 닉네임 위에 작게 노출 */}
            {showTags ? (
              <div className="mt-2 flex items-center gap-1 overflow-x-auto pb-0.5 scrollbar-hide">
                {homeCharTags.map((t) => (
                  <span
                    key={t}
                    className="inline-flex items-center rounded-full border border-gray-700/70 bg-black/55 px-1.5 py-0.5 text-[10px] text-gray-100/90 whitespace-nowrap flex-shrink-0 max-w-[140px] truncate"
                    title={t}
                  >
                    {t}
                  </span>
                ))}
              </div>
            ) : null}

            {isFromOrigChat ? (
              originStoryId ? (
                <Link
                  to={`/stories/${originStoryId}`}
                  onClick={(e) => e.stopPropagation()}
                  className="mt-2 inline-flex max-w-full"
                  aria-label="원작 웹소설 보기"
                >
                  <Badge
                    title={originBadgeText}
                    className="bg-blue-600 text-white hover:bg-blue-500 inline-flex max-w-full truncate text-[10px] px-1.5 py-0.5 rounded-md justify-start text-left leading-[1.05] tracking-tight"
                  >
                    {originBadgeText}
                  </Badge>
                </Link>
              ) : (
                <div className="mt-2 inline-flex max-w-full">
                  <Badge
                    title={originBadgeText}
                    className="bg-blue-600 text-white hover:bg-blue-500 inline-flex max-w-full truncate text-[10px] px-1.5 py-0.5 rounded-md justify-start text-left leading-[1.05] tracking-tight"
                  >
                    {originBadgeText}
                  </Badge>
                </div>
              )
            ) : showCreator ? (
              <Link
                to={`/users/${creatorId}/creator`}
                onClick={(e) => e.stopPropagation()}
                className="absolute left-3 bottom-2 inline-flex max-w-[calc(100%-1.5rem)] items-center gap-1 rounded bg-black/40 px-1.5 py-0.5 text-[11px] text-gray-100/90 hover:text-white truncate"
                aria-label="크리에이터 프로필 보기"
              >
                <span className="truncate">@{creatorUsername}</span>
              </Link>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div 
      className={`bg-gray-800 rounded-xl overflow-hidden hover:bg-gray-700 transition-all duration-200 cursor-pointer group border ${borderClass} ${hoverBorderClass}`}
      onClick={handleCardClick}
    >
      {/* 캐릭터 이미지 */}
      <div className="aspect-square relative overflow-hidden bg-gray-900">
        <LazyLoadImage
          alt={character.name}
          src={avatarSrc}
          effect="blur"
          className="w-full h-full object-cover object-top group-hover:scale-105 transition-transform duration-300"
          wrapperClassName="w-full h-full"
        />
        <div className="absolute top-1 left-1">
          {isFromOrigChat ? (
            <Badge className="bg-orange-400 text-black hover:bg-orange-400 px-1.5 py-0.5 text-[11px]">원작챗</Badge>
          ) : character?.source_type === 'IMPORTED' ? (
            <Badge className="bg-blue-600 text-white hover:bg-blue-600 px-1.5 py-0.5 text-[11px]">웹소설</Badge>
          ) : (
            <Badge className="bg-purple-600 text-white hover:bg-purple-600 px-1.5 py-0.5 text-[11px]">캐릭터</Badge>
          )}
        </div>
        {/* 채팅수/좋아요 바: 이미지 우하단 오버레이 */}
        {showLikeCount ? (
          <div className="absolute bottom-1 right-1 py-0.5 px-1.5 rounded bg-black/60 text-xs text-gray-100 flex items-center gap-2">
            <span className="inline-flex items-center gap-0.5">
              <Heart className="w-3 h-3" />
              {formatCount(likeCount)}
            </span>
          </div>
        ) : null}
      </div>
      
      {/* 캐릭터 정보 */}
      <div className={`${showOriginBadge && isFromOrigChat ? 'px-4 pt-0 pb-6' : 'p-4 pb-6'} relative h-[120px] overflow-hidden`}>
        {showOriginBadge && isFromOrigChat && !(character?.origin_story_title || originTitle) && (
          <div className="mb-0.5 h-[18px] w-20 rounded-md bg-gray-700 animate-pulse" />
        )}
        {showOriginBadge && isFromOrigChat && (character?.origin_story_title || originTitle) && (
          <span
            onClick={(e)=>{ e.stopPropagation(); const sid = character?.origin_story_id; if (sid) navigate(`/stories/${sid}`); }}
            className="block mb-0.5 w-full"
            role="link"
            aria-label="원작 웹소설로 이동"
          >
            <Badge title={character?.origin_story_title || originTitle} className="bg-blue-600 text-white hover:bg-blue-500 inline-flex max-w-full truncate text-[10px] px-1.5 py-0.5 rounded-md justify-start text-left leading-[1.05] tracking-tight">
              {character?.origin_story_title || originTitle}
            </Badge>
          </span>
        )}
        <h3 className="font-medium text-white truncate text-[13px] leading-tight">{character.name}</h3>
        {/* 설명 */}
        <p className="text-[12px] text-gray-400 mt-0.5 line-clamp-2 pr-1">
          {renderedDescription}
        </p>
        
        {/* 상태 정보 제거: 이미지 영역으로 이동 */}

        {character.creator_username && character.creator_id && (
          <Link
            to={`/users/${character.creator_id}/creator`}
            onClick={(e) => e.stopPropagation()}
            className="absolute left-2 bottom-2 inline-flex items-center gap-2 text-xs text-gray-100 bg-black/60 px-1.5 py-0.5 rounded hover:text-white cursor-pointer truncate"
          >
            <Avatar className="w-5 h-5">
              <AvatarImage
                src={resolveImageUrl(
                  character.creator_avatar_url
                    ? `${character.creator_avatar_url}${
                        character.creator_avatar_url.includes('?') ? '&' : '?'
                      }v=${profileVersion}`
                    : ''
                )}
                alt={character.creator_username}
              />
              <AvatarFallback className="text-[10px]">
                {character.creator_username?.charAt(0)?.toUpperCase() || 'U'}
              </AvatarFallback>
            </Avatar>
            <span className="truncate max-w-[120px]">{character.creator_username}</span>
          </Link>
        )}
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