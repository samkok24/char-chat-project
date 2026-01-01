import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { rankingAPI } from '../lib/api';
import { Link, useNavigate } from 'react-router-dom';
import { getThumbnailUrl, resolveImageUrl } from '../lib/images';
import { DEFAULT_SQUARE_URI } from '../lib/placeholder';
import { MessageCircle, Heart, ChevronLeft, ChevronRight } from 'lucide-react';
import { formatCount } from '../lib/format';
import ErrorBoundary from './ErrorBoundary';
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar';
import { Badge } from './ui/badge';
import { useAuth } from '../contexts/AuthContext';
import { useIsMobile } from '../hooks/use-mobile';

const OrigChatItem = ({ character }) => {
  const navigate = useNavigate();
  const { profileVersion } = useAuth();
  const charId = character?.id || character?.character_id || character?.characterId || character?.target_id;
  const raw = character?.thumbnail_url || character?.avatar_url;
  const withV = raw ? `${raw}${raw.includes('?') ? '&' : '?'}v=${Date.now()}` : raw;
  const imgSrc = getThumbnailUrl(withV, 400) || DEFAULT_SQUARE_URI;
  const username = character?.creator_username;
  const originStoryId = character?.origin_story_id;
  const originStoryTitle = character?.origin_story_title;

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
              <Badge className="bg-orange-400 text-black hover:bg-orange-400">원작챗</Badge>
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
            {/* 원작 웹소설(파란 배지): 원작챗 캐릭터의 원작 제목 표시 */}
            {originStoryId && originStoryTitle && (
              <div className="w-full">
                <span
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    navigate(`/stories/${originStoryId}`);
                  }}
                  className="inline-flex max-w-full"
                  role="link"
                  aria-label="원작 웹소설로 이동"
                >
                  <Badge
                    title={originStoryTitle}
                    className="bg-blue-600 text-white hover:bg-blue-500 inline-flex max-w-full truncate text-[10px] px-1.5 py-0.5 rounded-md justify-start text-left leading-[1.05] tracking-tight"
                  >
                    {originStoryTitle}
                  </Badge>
                </span>
              </div>
            )}
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
              {character?.description || '설명이 없습니다.'}
            </p>
            
            {/* 작성자 */}
            {username && character?.creator_id && (
              <div
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); navigate(`/users/${character.creator_id}/creator`); }}
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

const OrigChatSkeleton = () => (
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

const TopOrigChat = ({ title } = {}) => {
  const isMobile = useIsMobile();
  const pageSize = isMobile ? 4 : 14;
  const [page, setPage] = React.useState(0);
  const { data = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['top-origchat-daily'],
    queryFn: async () => {
      const res = await rankingAPI.getDaily({ kind: 'origchat' });
      const items = Array.isArray(res.data?.items) ? res.data.items : [];
      return items;
    },
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchOnMount: 'always',
  });

  React.useEffect(() => {
    const h = () => { try { refetch(); } catch {} };
    window.addEventListener('media:updated', h);
    return () => window.removeEventListener('media:updated', h);
  }, [refetch]);

  const empty = !isLoading && (!data || data.length === 0);

  React.useEffect(() => {
    // 화면 크기/레이아웃 전환 시 첫 페이지로 리셋(UX 안정)
    setPage(0);
  }, [isMobile]);

  const items = Array.isArray(data) ? data : [];
  const cappedItems = items.slice(0, 14); // 기존 정책 유지: 최대 14개(7x2) 안에서 페이징
  const pageCount = Math.max(1, Math.ceil(cappedItems.length / pageSize));
  const hasCarousel = cappedItems.length > pageSize;
  const displayData = cappedItems.slice(page * pageSize, page * pageSize + pageSize);
  const skeletonCount = pageSize;
  const slotTitle = String(title || '').trim() || '지금 대화가 활발한 원작 캐릭터';

  React.useEffect(() => {
    if (pageCount <= 0) return;
    if (page >= pageCount) setPage(0);
  }, [page, pageCount]);

  const gotoPrev = () => setPage((prev) => (prev - 1 + pageCount) % pageCount);
  const gotoNext = () => setPage((prev) => (prev + 1) % pageCount);
  const showMobileOverlayArrows = Boolean(isMobile && hasCarousel);

  return (
    <section className="mt-6 sm:mt-8">
      <div className="flex items-center justify-between mb-4">
        <div className="space-y-1">
          <h2 className="text-lg sm:text-xl font-bold text-white">{slotTitle}</h2>
          <p className="text-xs text-gray-400">원작 세계관 속 캐릭터와 대화를 시작해보세요.</p>
        </div>
        {!isMobile && (
          <Link
            to="/dashboard?tab=origserial&sub=origchat"
            className="text-sm text-gray-400 hover:text-white"
          >
            더보기
          </Link>
        )}
      </div>
      <ErrorBoundary>
        <div className="relative">
          <ul className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 sm:gap-4">
            {isLoading && Array.from({ length: skeletonCount }).map((_, idx) => (
              <OrigChatSkeleton key={idx} />
            ))}
            {!isLoading && !empty && displayData.map((char) => (
              <OrigChatItem key={char.id} character={char} />
            ))}
            {!isLoading && empty && (
              <li className="col-span-full text-center text-gray-400 py-8">
                <div className="space-y-1">
                  <div>원작 기반 콘텐츠가 아직 없습니다.</div>
                </div>
              </li>
            )}
          </ul>

          {/* 모바일: 4개씩 <> 페이지 이동 */}
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
      </ErrorBoundary>
    </section>
  );
};

export default TopOrigChat;



