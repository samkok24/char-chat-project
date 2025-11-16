import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { rankingAPI } from '../lib/api';
import { Link, useNavigate } from 'react-router-dom';
import { getThumbnailUrl } from '../lib/images';
import { DEFAULT_SQUARE_URI } from '../lib/placeholder';
import { MessageCircle, Heart } from 'lucide-react';
import { formatCount } from '../lib/format';
import ErrorBoundary from './ErrorBoundary';

const OrigChatItem = ({ character }) => {
  const navigate = useNavigate();
  const charId = character?.id || character?.character_id || character?.characterId || character?.target_id;
  const raw = character?.thumbnail_url || character?.avatar_url;
  const withV = raw ? `${raw}${raw.includes('?') ? '&' : '?'}v=${Date.now()}` : raw;
  const imgSrc = getThumbnailUrl(withV, 400) || DEFAULT_SQUARE_URI;
  const username = character?.creator_username;

  return (
    <li>
      <Link 
        to={charId ? `/characters/${charId}` : '#'} 
        className="block group cursor-pointer" 
        onClick={(e)=>{ if(!charId){ e.preventDefault(); e.stopPropagation(); } }}
      >
        <div className="bg-gray-800/50 rounded-lg overflow-hidden border border-gray-700/50 group-hover:border-gray-600 transition-colors">
          {/* 이미지 영역 */}
          <div className="relative aspect-[3/4] overflow-hidden bg-gray-900">
            <img
              src={imgSrc}
              alt={character?.name}
              className="w-full h-full object-cover object-top group-hover:scale-105 transition-transform duration-300"
              onError={(e) => { e.currentTarget.src = DEFAULT_SQUARE_URI; }}
              draggable="false"
              loading="lazy"
            />
          </div>
          
          {/* 텍스트 영역 */}
          <div className="p-3 space-y-2">
            {/* 제목 */}
            <h4 className="text-white font-bold text-sm leading-tight line-clamp-1">{character?.name}</h4>
            
            {/* 통계 */}
            <div className="flex items-center gap-3 text-xs text-gray-400">
              <span className="inline-flex items-center gap-1">
                <MessageCircle className="w-3 h-3" />
                {formatCount(character?.chat_count ?? 0)}
              </span>
              <span className="inline-flex items-center gap-1">
                <Heart className="w-3 h-3" />
                {formatCount(character?.like_count ?? 0)}
              </span>
            </div>
            
            {/* 설명 */}
            <p className="text-xs text-gray-400 line-clamp-2 leading-relaxed min-h-[2.5rem]">
              {character?.description || '설명이 없습니다.'}
            </p>
            
            {/* 작성자 */}
            {username && character?.creator_id && (
              <div
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); navigate(`/users/${character.creator_id}/creator`); }}
                className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-300 cursor-pointer pt-1"
              >
                <span>@</span>
                <span className="truncate">{username}</span>
              </div>
            )}
          </div>
        </div>
      </Link>
    </li>
  );
};

const OrigChatSkeleton = () => (
  <li className="animate-pulse">
    <div className="bg-gray-800/50 rounded-lg overflow-hidden border border-gray-700/50">
      <div className="aspect-[3/4] bg-gray-700" />
      <div className="p-3 space-y-2">
        <div className="h-4 bg-gray-700 rounded w-3/4" />
        <div className="flex gap-3">
          <div className="h-3 bg-gray-700 rounded w-12" />
          <div className="h-3 bg-gray-700 rounded w-12" />
        </div>
        <div className="h-3 bg-gray-700 rounded w-full" />
        <div className="h-3 bg-gray-700 rounded w-5/6" />
        <div className="h-3 bg-gray-700 rounded w-20" />
      </div>
    </div>
  </li>
);

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
  const displayData = data.slice(0, 14); // 최대 14개만 표시 (7x2)

  return (
    <section className="mt-8">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold text-white">원작챗 TOP10</h2>
      </div>
      <ErrorBoundary>
        <ul className="grid grid-cols-7 gap-4">
          {isLoading && Array.from({ length: 14 }).map((_, idx) => (
            <OrigChatSkeleton key={idx} />
          ))}
          {!isLoading && !empty && displayData.map((char) => (
            <OrigChatItem key={char.id} character={char} />
          ))}
          {!isLoading && empty && (
            <li className="col-span-7 text-center text-gray-400 py-8">
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



