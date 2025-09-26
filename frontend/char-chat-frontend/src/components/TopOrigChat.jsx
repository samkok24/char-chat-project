import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { rankingAPI } from '../lib/api';
import { CharacterCard } from './CharacterCard';
import ErrorBoundary from './ErrorBoundary';

const TopOrigChat = () => {
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

  return (
    <section className="mt-8">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-bold text-white">원작챗 TOP10 <span className="ml-2 text-xs text-gray-400 align-middle">(조회수 기준)</span></h2>
      </div>
      <ErrorBoundary>
        <ul className="grid grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-3">
          {isLoading && Array.from({ length: 12 }).map((_, idx) => (
            <li key={idx} className="bg-gray-800 rounded-xl h-[180px] border border-orange-500/60" />
          ))}
          {!isLoading && !empty && data.map((char) => (
            <li key={char.id}>
              <CharacterCard character={char} showOriginBadge />
            </li>
          ))}
          {!isLoading && empty && (
            <li className="col-span-4 md:col-span-6 lg:col-span-8 text-center text-gray-400 py-8">
              <div className="space-y-1">
                <div>원작 기반 콘텐츠가 아직 없습니다.</div>
              </div>
            </li>
          )}
        </ul>
      </ErrorBoundary>
    </section>
  );
};

export default TopOrigChat;



