import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { rankingAPI } from '../lib/api';
import StoryExploreCard from './StoryExploreCard';
import ErrorBoundary from './ErrorBoundary';

const TopStories = () => {
  const { data = [], isLoading, isError } = useQuery({
    queryKey: ['top-stories-daily'],
    queryFn: async () => {
      const res = await rankingAPI.getDaily({ kind: 'story' });
      const items = Array.isArray(res.data?.items) ? res.data.items : [];
      return items;
    },
    staleTime: 60 * 1000,
    refetchOnWindowFocus: true,
  });
  const empty = !isLoading && (!data || data.length === 0);

  return (
    <section className="mt-8">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-bold text-white">웹소설 TOP10 <span className="ml-2 text-xs text-gray-400 align-middle">(조회수 기준)</span></h2>
      </div>
      <ErrorBoundary>
        <ul className="grid grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-3">
          {isLoading && Array.from({ length: 12 }).map((_, idx) => (
            <li key={idx} className="bg-gray-800 rounded-xl h-[180px] border border-blue-500/40" />
          ))}
          {!isLoading && !isError && !empty && data.map((story) => (
            <li key={story.id}>
              <StoryExploreCard story={story} compact />
            </li>
          ))}
          {!isLoading && !isError && empty && (
            <li className="col-span-4 md:col-span-6 lg:col-span-8 text-center text-gray-400 py-8">
              <div className="space-y-1">
                <div>노출할 웹소설이 없습니다.</div>
              </div>
            </li>
          )}
        </ul>
      </ErrorBoundary>
    </section>
  );
};

export default TopStories;


