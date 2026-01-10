import React, { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { rankingAPI } from '../lib/api';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useIsMobile } from '../hooks/use-mobile';
import { CharacterCard, CharacterCardSkeleton } from './CharacterCard';

const TrendingItem = ({ character }) => {
  return (
    <li>
      <CharacterCard character={character} showOriginBadge variant="home" />
    </li>
  );
};

const TrendingSkeleton = () => (
  <li>
    <CharacterCardSkeleton variant="home" />
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


