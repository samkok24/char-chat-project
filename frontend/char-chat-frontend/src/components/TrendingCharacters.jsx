import React, { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { rankingAPI } from '../lib/api';
import { resolveImageUrl, getThumbnailUrl } from '../lib/images';
import { DEFAULT_SQUARE_URI } from '../lib/placeholder';
import { MessageCircle, Heart, ChevronLeft, ChevronRight } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar';
import { Badge } from './ui/badge';
import { formatCount } from '../lib/format';
import { useAuth } from '../contexts/AuthContext';

const TrendingItem = ({ character }) => {
  const navigate = useNavigate();
  const { profileVersion } = useAuth();
  const charId = character?.id || character?.character_id || character?.characterId || character?.target_id;
  const raw = character?.thumbnail_url || character?.avatar_url;
  const withV = raw ? `${raw}${raw.includes('?') ? '&' : '?'}v=${Date.now()}` : raw;
  const imgSrc = getThumbnailUrl(withV, 276) || DEFAULT_SQUARE_URI;
  const username = character?.creator_username;
  const isWebNovel = character?.source_type === 'IMPORTED';
  const isOrigChat = !!(character?.origin_story_id || character?.is_origchat);

  return (
    <li>
      <Link to={charId ? `/characters/${charId}` : '#'} className="flex gap-3 items-start" onClick={(e)=>{ if(!charId){ e.preventDefault(); e.stopPropagation(); } }}>
        <div className={`relative rounded-xl overflow-hidden flex-shrink-0 border ${isOrigChat ? 'border-orange-500/60' : (isWebNovel ? 'border-blue-500/40' : 'border-purple-500/40')}`} style={{ width: 89, height: 138 }}>
          <img
            src={imgSrc}
            alt={character?.name}
            className="w-full h-full object-cover object-top"
            onError={(e) => { e.currentTarget.src = DEFAULT_SQUARE_URI; }}
            draggable="false"
            loading="lazy"
          />
          <div className="absolute top-1 left-1">
            {isOrigChat ? (
              <Badge className="bg-orange-400 text-black hover:bg-orange-400">원작챗</Badge>
            ) : (isWebNovel ? (
              <Badge className="bg-blue-600 text-white hover:bg-blue-600">웹소설</Badge>
            ) : (
              <Badge className="bg-purple-600 text-white hover:bg-purple-600">캐릭터</Badge>
            ))}
          </div>
          <div className="absolute bottom-1 right-1 py-0.5 px-1.5 rounded bg-black/60 text-xs text-gray-100 flex items-center gap-2">
            <span className="inline-flex items-center gap-1"><MessageCircle className="w-3 h-3" />{formatCount(character?.chat_count ?? 0)}</span>
            <span className="inline-flex items-center gap-1"><Heart className="w-3 h-3" />{formatCount(character?.like_count ?? 0)}</span>
          </div>
        </div>
        <div className="flex-initial min-w-0 w-[200px] relative pb-8 min-h-[138px]">
          <div className="flex items-center gap-2">
            <h4 className="text-white text-[15px] font-semibold truncate max-w-full">{character?.name}</h4>
          </div>
          <div className="mt-2 text-sm text-gray-400 line-clamp-2 max-w-full max-h-10 overflow-hidden pr-1">
            {character?.description || '설명이 없습니다.'}
          </div>
          {username && character?.creator_id && (
            <span
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); navigate(`/users/${character.creator_id}/creator`); }}
              className="absolute left-0 bottom-0 inline-flex items-center gap-2 text-sm text-gray-300 hover:text-white cursor-pointer"
            >
              <Avatar className="w-5 h-5">
                <AvatarImage src={resolveImageUrl(character.creator_avatar_url ? `${character.creator_avatar_url}${character.creator_avatar_url.includes('?') ? '&' : '?'}v=${profileVersion}` : '')} alt={username} />
                <AvatarFallback className="text-[10px]">{username?.charAt(0)?.toUpperCase() || 'U'}</AvatarFallback>
              </Avatar>
              <span className="truncate max-w-[140px]">{username}</span>
            </span>
          )}
        </div>
      </Link>
    </li>
  );
};

const TrendingSkeleton = () => (
  <li className="flex gap-3 items-start animate-pulse">
    <div className="bg-gray-700 rounded-xl" style={{ width: 89, height: 138 }} />
    <div className="flex-1 min-w-0 space-y-2">
      <div className="h-4 bg-gray-700 rounded w-2/3" />
      <div className="h-3 bg-gray-700 rounded w-full" />
      <div className="h-3 bg-gray-700 rounded w-5/6" />
      <div className="h-4 bg-gray-700 rounded w-24" />
    </div>
  </li>
);

const TrendingCharacters = () => {
  const { data = [], isLoading, isError } = useQuery({
    queryKey: ['trending-characters-daily'],
    queryFn: async () => {
      const res = await rankingAPI.getDaily({ kind: 'character' });
      return Array.isArray(res.data?.items) ? res.data.items : [];
    },
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchOnMount: 'always',
  });

  const pageSize = 8;
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
    return () => {};
  }, []);

  const gotoPrev = () => setPage((prev) => (prev - 1 + pageCount) % pageCount);
  const gotoNext = () => setPage((prev) => (prev + 1) % pageCount);

  return (
    <section className="mt-8">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-bold text-white">인기 캐릭터 TOP</h2>
        {hasCarousel && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label="이전"
              className="w-8 h-8 rounded-full bg-gray-800 hover:bg-gray-700 text-gray-200 inline-flex items-center justify-center"
              onClick={gotoPrev}
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              type="button"
              aria-label="다음"
              className="w-8 h-8 rounded-full bg-gray-800 hover:bg-gray-700 text-gray-200 inline-flex items-center justify-center"
              onClick={gotoNext}
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
      <ul className="grid grid-cols-4 gap-6">
        {isLoading && Array.from({ length: 8 }).map((_, idx) => (
          <TrendingSkeleton key={idx} />
        ))}
        {!isLoading && !isError && visibleItems.map((c) => (
          <TrendingItem key={c.id} character={c} />
        ))}
      </ul>
    </section>
  );
};

export default TrendingCharacters;


