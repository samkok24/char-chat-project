import React, { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { rankingAPI } from '../lib/api';
import { resolveImageUrl, getThumbnailUrl } from '../lib/images';
import { replacePromptTokens } from '../lib/prompt';
import { DEFAULT_SQUARE_URI } from '../lib/placeholder';
import { MessageCircle, Heart, ChevronLeft, ChevronRight } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar';
import { Badge } from './ui/badge';
import { formatCount } from '../lib/format';
import { useAuth } from '../contexts/AuthContext';
import { useIsMobile } from '../hooks/use-mobile';

const TrendingItem = ({ character }) => {
  const navigate = useNavigate();
  const { profileVersion } = useAuth();
  const charId = character?.id || character?.character_id || character?.characterId || character?.target_id;
  const raw = character?.thumbnail_url || character?.avatar_url;
  const withV = raw ? `${raw}${raw.includes('?') ? '&' : '?'}v=${Date.now()}` : raw;
  const imgSrc = getThumbnailUrl(withV, 400) || DEFAULT_SQUARE_URI;
  const username = character?.creator_username;
  const isWebNovel = character?.source_type === 'IMPORTED';
  const isOrigChat = !!(character?.origin_story_id || character?.is_origchat || character?.source === 'origchat');
  const renderedDescription = (() => {
    /**
     * 카드(격자) 미리보기 텍스트에서는 템플릿 토큰을 그대로 노출하면 UX가 깨진다.
     * - {{user}} → "당신"
     * - {{character}}/{{assistant}} → 캐릭터명
     */
    const nm = character?.name || '캐릭터';
    const rawDesc = character?.description || '';
    const rendered = replacePromptTokens(rawDesc, { assistantName: nm, userName: '당신' }).trim();
    return rendered || '설명이 없습니다.';
  })();

  return (
    <li>
      <Link 
        to={charId ? `/characters/${charId}` : '#'} 
        className="block group cursor-pointer" 
        onClick={(e)=>{ if(!charId){ e.preventDefault(); e.stopPropagation(); } }}
      >
        <div className="bg-gray-800/50 rounded-lg overflow-hidden border border-gray-700/50 group-hover:border-gray-600 transition-colors">
          {/* 이미지 영역 */}
          <div className="relative aspect-[3/4] overflow-hidden bg-gray-900">
            <div className="absolute top-2 left-2 z-10">
              {isOrigChat ? (
                <Badge className="bg-orange-400 text-black hover:bg-orange-400">원작챗</Badge>
              ) : isWebNovel ? (
                <Badge className="bg-blue-600 text-white hover:bg-blue-600">웹소설</Badge>
              ) : (
                <Badge className="bg-purple-600 text-white hover:bg-purple-600">캐릭터</Badge>
              )}
            </div>
            <img
              src={imgSrc}
              alt={character?.name}
              className="w-full h-full object-cover object-top group-hover:scale-105 transition-transform duration-300"
              onError={(e) => { e.currentTarget.src = DEFAULT_SQUARE_URI; }}
              draggable="false"
              loading="lazy"
            />
          </div>
          
          {/* 텍스트 영역 */}
          <div className="p-3 space-y-2">
            {/* 제목 */}
            <h4 className="text-white font-bold text-sm leading-tight line-clamp-1">{character?.name}</h4>
            
            {/* 통계 */}
            <div className="flex items-center gap-3 text-xs text-gray-400">
              <span className="inline-flex items-center gap-1">
                <MessageCircle className="w-3 h-3" />
                {formatCount(character?.chat_count ?? 0)}
              </span>
              <span className="inline-flex items-center gap-1">
                <Heart className="w-3 h-3" />
                {formatCount(character?.like_count ?? 0)}
              </span>
            </div>
            
            {/* 설명 */}
            <p className="text-xs text-gray-400 line-clamp-2 leading-relaxed min-h-[2.5rem]">
              {renderedDescription}
            </p>
            
            {/* 작성자 */}
            {username && character?.creator_id && (
              <div
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  navigate(`/users/${character.creator_id}/creator`);
                }}
                className="inline-flex items-center gap-2 text-xs text-gray-100 bg-black/60 px-1.5 py-0.5 rounded hover:text-white cursor-pointer truncate"
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
                    alt={username}
                  />
                  <AvatarFallback className="text-[10px]">
                    {username?.charAt(0)?.toUpperCase() || 'U'}
                  </AvatarFallback>
                </Avatar>
                <span className="truncate max-w-[110px]">{username}</span>
              </div>
            )}
          </div>
        </div>
      </Link>
    </li>
  );
};

const TrendingSkeleton = () => (
  <li className="animate-pulse">
    <div className="bg-gray-800/50 rounded-lg overflow-hidden border border-gray-700/50">
      <div className="aspect-[3/4] bg-gray-700" />
      <div className="p-3 space-y-2">
        <div className="h-4 bg-gray-700 rounded w-3/4" />
        <div className="flex gap-3">
          <div className="h-3 bg-gray-700 rounded w-12" />
          <div className="h-3 bg-gray-700 rounded w-12" />
        </div>
        <div className="h-3 bg-gray-700 rounded w-full" />
        <div className="h-3 bg-gray-700 rounded w-5/6" />
        <div className="h-3 bg-gray-700 rounded w-20" />
      </div>
    </div>
  </li>
);

const TrendingCharacters = ({ title } = {}) => {
  const isMobile = useIsMobile();

  const { data = [], isLoading, isError } = useQuery({
    queryKey: ['trending-characters-daily'],
    queryFn: async () => {
      const res = await rankingAPI.getDaily({ kind: 'character' });
      return Array.isArray(res.data?.items) ? res.data.items : [];
    },
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchOnMount: 'always',
  });

  // 데스크탑 기준(7열 x 2행)으로 14개를 기본 페이지로 사용한다.
  // 모바일에서는 반응형 그리드(2~4열)로 더 크게 보이도록 한다.
  const pageSize = isMobile ? 4 : 14;
  const [page, setPage] = useState(0);
  const items = data || [];
  const empty = !isLoading && (!items || items.length === 0);
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const hasCarousel = items.length > pageSize;
  const slotTitle = String(title || '').trim() || '지금 대화가 활발한 캐릭터';

  useEffect(() => {
    // 화면 크기/레이아웃 전환 시 첫 페이지로 리셋(UX 안정)
    setPage(0);
  }, [isMobile]);

  const visibleItems = useMemo(() => {
    const start = page * pageSize;
    return items.slice(start, start + pageSize);
  }, [items, page, pageSize]);

  useEffect(() => {
    return () => {};
  }, []);

  useEffect(() => {
    // 데이터 길이가 줄어 페이지가 범위를 벗어나면 0으로 보정
    if (pageCount <= 0) return;
    if (page >= pageCount) setPage(0);
  }, [page, pageCount]);

  const gotoPrev = () => setPage((prev) => (prev - 1 + pageCount) % pageCount);
  const gotoNext = () => setPage((prev) => (prev + 1) % pageCount);
  const skeletonCount = pageSize;
  const showHeaderArrows = Boolean(!isMobile && hasCarousel);
  const showMobileOverlayArrows = Boolean(isMobile && hasCarousel);

  return (
    <section className="mt-6 sm:mt-8">
      <div className="flex items-center justify-between mb-4">
        <div className="space-y-1">
          <h2 className="text-lg sm:text-xl font-bold text-white">{slotTitle}</h2>
          <p className="text-xs text-gray-400">지금 가장 많은 대화가 오가는 캐릭터를 만나보세요.</p>
        </div>
        <div className="flex items-center gap-3">
          {!isMobile && (
            <Link to="/dashboard?tab=character" className="text-sm text-gray-400 hover:text-white">
              더보기
            </Link>
          )}
          {showHeaderArrows && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-label="이전"
                className="w-8 h-8 rounded-full bg-gray-800 hover:bg-gray-700 text-gray-200 inline-flex items-center justify-center transition-colors"
                onClick={gotoPrev}
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                aria-label="다음"
                className="w-10 h-10 rounded-lg bg-gray-800 hover:bg-gray-700 text-white inline-flex items-center justify-center transition-colors"
                onClick={gotoNext}
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>
          )}
        </div>
      </div>
      <div className="relative">
        <ul className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 sm:gap-4">
          {isLoading && Array.from({ length: skeletonCount }).map((_, idx) => (
            <TrendingSkeleton key={idx} />
          ))}
          {!isLoading && !isError && visibleItems.map((c) => (
            <TrendingItem key={c.id} character={c} />
          ))}
          {empty && (
            <li className="col-span-full text-center text-gray-400 py-8">
              인기 캐릭터가 아직 없습니다.
            </li>
          )}
        </ul>

        {/* 모바일: 4개씩 <> 페이지 이동 (경쟁사 스타일) */}
        {showMobileOverlayArrows && (
          <>
            <button
              type="button"
              aria-label="이전"
              onClick={gotoPrev}
              className="absolute -left-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-gray-800/90 hover:bg-gray-700 text-white border border-gray-700 shadow-lg backdrop-blur flex items-center justify-center"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <button
              type="button"
              aria-label="다음"
              onClick={gotoNext}
              className="absolute -right-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-gray-800/90 hover:bg-gray-700 text-white border border-gray-700 shadow-lg backdrop-blur flex items-center justify-center"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </>
        )}
      </div>
    </section>
  );
};

export default TrendingCharacters;


