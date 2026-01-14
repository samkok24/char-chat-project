import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { rankingAPI } from '../lib/api';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import ErrorBoundary from './ErrorBoundary';
import { useIsMobile } from '../hooks/use-mobile';
import StoryExploreCard from './StoryExploreCard';

const StoryItem = ({ story }) => {
  return (
    <li>
      <StoryExploreCard story={story} variant="home" showLikeBadge={false} />
    </li>
  );
};

const StorySkeleton = () => (
  <li className="animate-pulse">
    <div className="bg-gray-800/50 rounded-lg overflow-hidden border border-gray-700/50">
      <div className="aspect-[3/4] bg-gray-700" />
    </div>
  </li>
);

const TopStories = ({ title } = {}) => {
  const isMobile = useIsMobile();
  const pageSize = isMobile ? 4 : 14;
  const [page, setPage] = React.useState(0);
  const { data = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['top-stories-daily'],
    queryFn: async () => {
      const res = await rankingAPI.getDaily({ kind: 'story' });
      const items = Array.isArray(res.data?.items) ? res.data.items : [];
      // 웹소설만 필터링 (is_webtoon !== true 또는 false인 것만)
      return items.filter(story => !story.is_webtoon);
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
  const slotTitle = String(title || '').trim() || '지금 인기 있는 원작 웹소설';

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
          <p className="text-xs text-gray-400">원작연재에서 더 많은 작품을 확인해보세요.</p>
        </div>
        {!isMobile && (
          <Link to="/dashboard?tab=origserial&sub=novel" className="text-sm text-gray-400 hover:text-white">
            더보기
          </Link>
        )}
      </div>
      <ErrorBoundary>
        <div className="relative">
          <ul className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3 sm:gap-4">
            {isLoading && Array.from({ length: skeletonCount }).map((_, idx) => (
              <StorySkeleton key={idx} />
            ))}
            {!isLoading && !isError && !empty && displayData.map((story) => (
              <StoryItem key={story.id} story={story} />
            ))}
            {!isLoading && !isError && empty && (
              <li className="col-span-full text-center text-gray-400 py-8">
                <div className="space-y-1">
                  <div>노출할 웹소설이 없습니다.</div>
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
                className="absolute -left-3 top-1/2 -translate-y-1/2 z-30 w-10 h-10 rounded-full bg-gray-800/90 hover:bg-gray-700 text-white border border-gray-700 shadow-lg backdrop-blur flex items-center justify-center"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <button
                type="button"
                aria-label="다음"
                onClick={gotoNext}
                className="absolute -right-3 top-1/2 -translate-y-1/2 z-30 w-10 h-10 rounded-full bg-gray-800/90 hover:bg-gray-700 text-white border border-gray-700 shadow-lg backdrop-blur flex items-center justify-center"
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

export default TopStories;


