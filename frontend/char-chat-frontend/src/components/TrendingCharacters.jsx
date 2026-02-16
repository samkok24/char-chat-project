import React, { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { rankingAPI, charactersAPI } from '../lib/api';
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
    queryKey: ['trending-characters-daily', isMobile ? 'm' : 'd'],
    queryFn: async () => {
      /**
       * ✅ PC에서는 "항상 2줄(=14개)"을 채우기 위해, 부족하면 추가로 더 가져온다.
       *
       * 원칙:
       * - 격자(2/4/7열) 디자인은 유지한다(카드 크기 불변).
       * - 데이터가 부족할 때만 'chats' 정렬의 일반 캐릭터로 보강한다.
       */
      const target = isMobile ? 4 : 14;

      const baseRes = await rankingAPI.getDaily({ kind: 'character' });
      const baseItems = Array.isArray(baseRes.data?.items) ? baseRes.data.items : [];

      if (isMobile || baseItems.length >= target) return baseItems;

      try {
        const extraRes = await charactersAPI.getCharacters({
          sort: 'chats',
          limit: 60,
          only: 'regular',
          source_type: 'ORIGINAL',
        });
        const extraItems = Array.isArray(extraRes?.data) ? extraRes.data : [];
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
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });

  // ✅ 경쟁사 체감 크기(카드가 너무 작아 보이지 않게):
  // - 데스크탑 7열(14개/페이지)은 카드가 지나치게 작아져 보인다.
  // - lg에서는 5열(=10개/페이지, 5x2)로 맞추고, 더 넓은 화면에서만 6열로 확장한다.
  const pageSize = isMobile ? 4 : 10;
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
        </div>
      </div>
      <div className="relative">
        <ul className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-5 gap-3 sm:gap-4">
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
    </section>
  );
};

export default TrendingCharacters;


