import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { storiesAPI } from '../lib/api';
import StoryExploreCard from './StoryExploreCard';
import ErrorBoundary from './ErrorBoundary';

const TopOrigChat = () => {
  const { data = [], isLoading, isError } = useQuery({
    queryKey: ['top-origchat-views'],
    queryFn: async () => {
      const res = await storiesAPI.getStories({ limit: 24, sort: 'views' });
      const all = res.data?.stories || [];
      // 원작챗 노출 대상만 필터
      return all.filter((s) => !!s.is_origchat).slice(0, 12);
    },
    staleTime: 60 * 1000,
  });

  if (isError) return null;
  if (!isLoading && (!data || data.length === 0)) return null;

  return (
    <section className="mt-8">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-bold text-white">원작챗 TOP10</h2>
      </div>
      <ErrorBoundary>
        <ul className="grid grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-3">
          {isLoading && Array.from({ length: 12 }).map((_, idx) => (
            <li key={idx} className="bg-gray-800 rounded-xl h-[180px] border border-orange-500/60" />
          ))}
          {!isLoading && data.map((story) => (
            <li key={story.id}>
              <StoryExploreCard story={story} compact />
            </li>
          ))}
        </ul>
      </ErrorBoundary>
    </section>
  );
};

export default TopOrigChat;



