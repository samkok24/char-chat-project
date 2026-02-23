import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { usersAPI } from '../lib/api';
import AppLayout from '../components/layout/AppLayout';
import { CharacterCard, CharacterCardSkeleton } from '../components/CharacterCard';

const FavoritesPage = () => {
  const { data = [], isLoading } = useQuery({
    queryKey: ['liked-characters-page'],
    queryFn: async () => {
      const res = await usersAPI.getLikedCharacters({ limit: 48 });
      return res.data || [];
    },
    staleTime: 30000,
  });

  return (
    <AppLayout>
      <div className="min-h-full bg-gray-900 text-gray-200 px-8 py-6">
        <h1 className="text-2xl font-bold mb-6">관심 캐릭터</h1>
        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <CharacterCardSkeleton key={i} />
            ))}
          </div>
        ) : data.length === 0 ? (
          <p className="text-gray-400">좋아요한 캐릭터가 없습니다.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {data.map((c) => (
              <CharacterCard key={c.id} character={c} />
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  );
};

export default FavoritesPage;



