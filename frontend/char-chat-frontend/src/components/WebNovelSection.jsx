import React, { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { charactersAPI } from '../lib/api';
import { Badge } from './ui/badge';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import LoginRequiredModal from './LoginRequiredModal';
import { HistoryChatCard, HistoryChatCardSkeleton } from './HistoryChatCard';

const WebNovelSection = () => {
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const [showLoginRequired, setShowLoginRequired] = React.useState(false);
  const { data = [], isLoading, isError } = useQuery({
    queryKey: ['webnovel-characters'],
    queryFn: async () => {
      try {
        const res = await charactersAPI.getCharacters({ sort: 'views', source_type: 'IMPORTED', limit: 36 });
        return res.data || [];
      } catch (err) {
        // 호환성 폴백: 필터가 실패하면 전체 인기 캐릭터로 대체
        try {
          const res = await charactersAPI.getCharacters({ sort: 'views', limit: 36 });
          return res.data || [];
        } catch (_) {
          return [];
        }
      }
    },
    staleTime: 5 * 60 * 1000,
  });

  const pageSize = 9;
  const [page, setPage] = useState(0);
  const items = data || [];
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const hasCarousel = items.length > pageSize;

  const visibleItems = useMemo(() => {
    if (!hasCarousel) return items;
    const start = page * pageSize;
    return items.slice(start, start + pageSize);
  }, [items, page, hasCarousel]);

  useEffect(() => {
    if (!hasCarousel) return;
    const id = setInterval(() => {
      setPage((prev) => (prev + 1) % pageCount);
    }, 5000);
    return () => clearInterval(id);
  }, [hasCarousel, pageCount]);

  const gotoPrev = () => setPage((prev) => (prev - 1 + pageCount) % pageCount);
  const gotoNext = () => setPage((prev) => (prev + 1) % pageCount);

  return (
    <section className="mt-10">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-bold text-white">웹소설 원작</h2>
        {hasCarousel && (
          <div className="flex items-center gap-2">
            <button type="button" aria-label="이전" className="w-8 h-8 rounded-full bg-gray-800 hover:bg-gray-700 text-gray-200 inline-flex items-center justify-center" onClick={gotoPrev}>
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button type="button" aria-label="다음" className="w-8 h-8 rounded-full bg-gray-800 hover:bg-gray-700 text-gray-200 inline-flex items-center justify-center" onClick={gotoNext}>
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 lg:gap-6 mt-7">
        {isLoading && Array.from({ length: 9 }).map((_, idx) => (
          <HistoryChatCardSkeleton key={idx} />
        ))}
        {!isLoading && !isError && visibleItems.map((c) => (
          <div key={c.id} className="relative border border-blue-500/40 rounded-2xl overflow-hidden">
            <HistoryChatCard
              character={c}
              onClick={() => {
                if (!isAuthenticated) {
                  setShowLoginRequired(true);
                  return;
                }
                navigate(`/ws/chat/${c.id}`);
              }}
            />
            <div className="absolute top-1 left-1 z-10">
              <Badge className="bg-blue-600 text-white hover:bg-blue-600">웹소설</Badge>
            </div>
          </div>
        ))}
      </div>
      <LoginRequiredModal
        isOpen={showLoginRequired}
        onClose={() => setShowLoginRequired(false)}
        onLogin={() => { setShowLoginRequired(false); navigate('/login?tab=login'); }}
        onRegister={() => { setShowLoginRequired(false); navigate('/login?tab=register'); }}
      />
    </section>
  );
};

export default WebNovelSection;



