import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { storiesAPI } from '../lib/api';
import StoryExploreCard from './StoryExploreCard';
import ErrorBoundary from './ErrorBoundary';

const TopStories = () => {
  const { data = [], isLoading, isError } = useQuery({
    queryKey: ['top-stories-views'],
    queryFn: async () => {
      const res = await storiesAPI.getStories({ limit: 10, sort: 'views' });
      const all = res.data?.stories || [];
      // 원작챗 제외 + 공개 스토리만
      return all.filter((s) => !s?.is_origchat && (s?.is_public !== false));
    },
    staleTime: 5 * 60 * 1000,
  });

  return (
    <section className="mt-8">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-bold text-white">웹소설 TOP10</h2>
      </div>
      <ErrorBoundary>
        <ul className="grid grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-3">
          {isLoading && Array.from({ length: 12 }).map((_, idx) => (
            <li key={idx} className="bg-gray-800 rounded-xl h-[180px] border border-blue-500/40" />
          ))}
          {!isLoading && !isError && data.slice(0, 12).map((story) => (
            <li key={story.id}>
              <StoryExploreCard story={story} compact />
            </li>
          ))}
        </ul>
      </ErrorBoundary>
    </section>
  );
};

export default TopStories;


