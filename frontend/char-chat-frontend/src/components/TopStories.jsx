import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { rankingAPI, storiesAPI } from '../lib/api';
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
  // ✅ 경쟁사 체감 크기(카드가 너무 작아 보이지 않게):
  // - 데스크탑 7열은 카드가 작아져 보이므로 5열 기준(5x2=10개)로 조정한다.
  const pageSize = isMobile ? 4 : 10;
  const [page, setPage] = React.useState(0);
  const { data = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['top-stories-daily', isMobile ? 'm' : 'd'],
    queryFn: async () => {
      /**
       * ✅ PC에서는 "항상 2줄(=14개)"을 채우기 위해, 부족하면 추가로 더 가져온다.
       *
       * 원칙:
       * - 격자(2/4/7열) 디자인은 유지한다(카드 크기 불변).
       * - 랭킹 데이터가 부족하면 stories 목록에서 views 기준으로 보강한다.
       */
      const target = isMobile ? 4 : 14;

      const res = await rankingAPI.getDaily({ kind: 'story' });
      const raw = Array.isArray(res.data?.items) ? res.data.items : [];
      const baseItems = raw.filter((story) => !story?.is_webtoon);
      if (isMobile || baseItems.length >= target) return baseItems;

      try {
        const extraRes = await storiesAPI.getStories({ sort: 'views', limit: 60 });
        const extraRaw = Array.isArray(extraRes?.data) ? extraRes.data : [];
        const extraItems = extraRaw.filter((s) => !s?.is_webtoon);
        const seen = new Set(baseItems.map((x) => String(x?.id || '')));
        const merged = [...baseItems];
        for (const it of extraItems) {
          const id = String(it?.id || '').trim();
          if (!id || seen.has(id)) continue;
          seen.add(id);
          merged.push(it);
          if (merged.length >= target) break;
        }
        return merged;
      } catch (_) {
        return baseItems;
      }
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
  const cappedItems = items.slice(0, isMobile ? 12 : 10); // 최대 2줄(모바일: 3페이지, 데스크탑: 2줄)
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
          <ul className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-5 gap-3 sm:gap-4">
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


