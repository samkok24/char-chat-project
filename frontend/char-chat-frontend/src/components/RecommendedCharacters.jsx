import React, { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { charactersAPI } from '../lib/api';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useIsMobile } from '../hooks/use-mobile';
import { CharacterCard, CharacterCardSkeleton } from './CharacterCard';

/**
 * 홈 "추천 캐릭터" 구좌
 *
 * 의도/동작:
 * - "인기 캐릭터 TOP"과 동일한 구좌/격자 UI를 유지하면서, 데이터만 추천 리스트로 바꾼다.
 * - 현재 추천 기준은 "좋아요 상위(공개/활성) + 일반 캐릭터챗(원작챗 제외) + ORIGINAL"로 단순히 구성한다.
 * - API 실패/빈 데이터에도 홈 화면이 깨지지 않도록 방어적으로 처리한다.
 */
const RecommendedItem = ({ character }) => {
  return (
    <li>
      <CharacterCard character={character} showOriginBadge variant="home" />
    </li>
  );
};

const RecommendedSkeleton = () => (
  <li>
    <CharacterCardSkeleton variant="home" />
  </li>
);

const RecommendedCharacters = ({ title } = {}) => {
  const isMobile = useIsMobile();
  const RECOMMENDED_LIMIT = 60;
  // 추천 구좌는 "캐릭터챗(일반) : 원작챗"을 적당히 섞어서 노출한다.
  // - 패턴: 캐릭터챗 2개 → 원작챗 1개 (2:1)
  const MIX_PATTERN = ['regular', 'regular', 'origchat'];

  const { data = [], isLoading, isError } = useQuery({
    queryKey: ['recommended-characters-home', 'likes', 'mixed', 'regular+origchat', isMobile ? 'm' : 'd'],
    queryFn: async () => {
      /**
       * 추천 캐릭터 데이터 구성(방어적으로 동작)
       *
       * 의도/동작:
       * - 캐릭터챗(일반)과 원작챗을 각각 조회한 뒤, MIX_PATTERN(2:1)로 교차 섞는다.
       * - 한쪽 데이터가 부족하면, 남은 쪽을 이어붙여서 RECOMMENDED_LIMIT까지만 채운다.
       */
      const safeArr = (v) => (Array.isArray(v) ? v : []);
      const mixByPattern = (regularItems, origChatItems, limit) => {
        const regular = safeArr(regularItems);
        const origchat = safeArr(origChatItems);
        const out = [];
        let i = 0;
        let j = 0;
        const pick = (kind) => {
          if (out.length >= limit) return;
          if (kind === 'regular') {
            if (i < regular.length) out.push(regular[i++]);
            else if (j < origchat.length) out.push(origchat[j++]);
          } else {
            if (j < origchat.length) out.push(origchat[j++]);
            else if (i < regular.length) out.push(regular[i++]);
          }
        };
        while ((i < regular.length || j < origchat.length) && out.length < limit) {
          for (const kind of MIX_PATTERN) {
            if (out.length >= limit) break;
            pick(kind);
          }
        }
        return out;
      };

      try {
        // 2:1 비율로 섞기 위해 각각 별도로 조회 (API 2회, UI는 안정적으로 유지)
        const regularLimit = Math.ceil((RECOMMENDED_LIMIT * 2) / 3);
        const origChatLimit = Math.ceil(RECOMMENDED_LIMIT / 3);

        const [regularRes, origChatRes] = await Promise.all([
          charactersAPI.getCharacters({
            sort: 'likes',
            limit: regularLimit,
            only: 'regular',
            source_type: 'ORIGINAL',
          }),
          charactersAPI.getCharacters({
            sort: 'likes',
            limit: origChatLimit,
            only: 'origchat',
          }),
        ]);

        const regularItems = safeArr(regularRes?.data);
        const origChatItems = safeArr(origChatRes?.data);
        return mixByPattern(regularItems, origChatItems, RECOMMENDED_LIMIT);
      } catch (err) {
        console.error('Failed to load recommended characters:', err);
        return [];
      }
    },
    staleTime: 5 * 60 * 1000,
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
  const slotTitle = String(title || '').trim() || '챕터8이 추천하는 캐릭터';

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

  const gotoPrev = () => setPage((prev) => (prev - 1 + pageCount) % pageCount);
  const gotoNext = () => setPage((prev) => (prev + 1) % pageCount);
  const skeletonCount = pageSize;
  const showHeaderArrows = Boolean(!isMobile && hasCarousel);
  const showMobileOverlayArrows = Boolean(isMobile && hasCarousel);

  useEffect(() => {
    // 데이터 길이가 줄어 페이지가 범위를 벗어나면 0으로 보정
    if (pageCount <= 0) return;
    if (page >= pageCount) setPage(0);
  }, [page, pageCount]);

  return (
    <section className="mt-6 sm:mt-8">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg sm:text-xl font-bold text-white">{slotTitle}</h2>
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
      <div className="relative">
        <ul className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 sm:gap-4">
          {isLoading && Array.from({ length: skeletonCount }).map((_, idx) => (
            <RecommendedSkeleton key={idx} />
          ))}
          {!isLoading && !isError && visibleItems.map((c) => (
            <RecommendedItem key={c.id} character={c} />
          ))}
          {empty && (
            <li className="col-span-full text-center text-gray-400 py-8">
              추천 캐릭터가 아직 없습니다.
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

export default RecommendedCharacters;


