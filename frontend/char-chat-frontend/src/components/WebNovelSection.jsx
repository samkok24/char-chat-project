import React, { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { charactersAPI } from '../lib/api';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { HistoryChatCard, HistoryChatCardSkeleton } from './HistoryChatCard';

const WebNovelSection = () => {
  const navigate = useNavigate();
  const { data = [], isLoading, isError } = useQuery({
    queryKey: ['webnovel-characters'],
    queryFn: async () => {
      const res = await charactersAPI.getCharacters({ sort: 'views', source_type: 'IMPORTED', limit: 36 });
      return res.data || [];
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
          <HistoryChatCard
            key={c.id}
            character={c}
            onClick={() => navigate(`/ws/chat/${c.id}`)}
          />
        ))}
      </div>
    </section>
  );
};

export default WebNovelSection;



