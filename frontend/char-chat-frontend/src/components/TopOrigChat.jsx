import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { rankingAPI, charactersAPI } from '../lib/api';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import ErrorBoundary from './ErrorBoundary';
import { useIsMobile } from '../hooks/use-mobile';
import { CharacterCard, CharacterCardSkeleton } from './CharacterCard';

const OrigChatItem = ({ character }) => {
  return (
    <li>
      <CharacterCard character={character} showOriginBadge variant="home" />
    </li>
  );
};

const OrigChatSkeleton = () => (
  <li>
    <CharacterCardSkeleton variant="home" />
  </li>
);

const TopOrigChat = ({ title } = {}) => {
  const isMobile = useIsMobile();
  // ✅ 경쟁사 체감 크기(카드가 너무 작아 보이지 않게):
  // - 데스크탑 7열은 카드가 작아져 보이므로 5열 기준(5x2=10개)로 조정한다.
  const pageSize = isMobile ? 4 : 10;
  const [page, setPage] = React.useState(0);
  const { data = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['top-origchat-daily', isMobile ? 'm' : 'd'],
    queryFn: async () => {
      /**
       * ✅ PC에서는 "항상 2줄(=14개)"을 채우기 위해, 부족하면 추가로 더 가져온다.
       *
       * 원칙:
       * - 격자(2/4/7열) 디자인은 유지한다(카드 크기 불변).
       * - 랭킹 데이터가 부족하면 origchat 캐릭터 목록에서 chats 기준으로 보강한다.
       */
      const target = isMobile ? 4 : 10;

      const res = await rankingAPI.getDaily({ kind: 'origchat' });
      const baseItems = Array.isArray(res.data?.items) ? res.data.items : [];
      if (isMobile || baseItems.length >= target) return baseItems;

      try {
        const extraRes = await charactersAPI.getCharacters({
          sort: 'chats',
          limit: 60,
          only: 'origchat',
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
          <ul className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-5 gap-3 sm:gap-4">
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

export default TopOrigChat;


