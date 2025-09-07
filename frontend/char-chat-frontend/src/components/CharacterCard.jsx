import React from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { LazyLoadImage } from 'react-lazy-load-image-component';
import 'react-lazy-load-image-component/src/effects/blur.css';
import { Skeleton } from './ui/skeleton';
import { resolveImageUrl } from '../lib/images';
import { DEFAULT_SQUARE_URI } from '../lib/placeholder';
import { MessageCircle, Heart } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar';
import { formatCount } from '../lib/format';

export const CharacterCard = ({ character, onCardClick, onButtonClick, footerContent }) => {
  const navigate = useNavigate();

  const handleCardClick = () => {
    if (onCardClick) {
      onCardClick(character.id);
    } else {
      navigate(`/characters/${character.id}`);
    }
  };

  const handleButtonClick = (e) => {
    e.stopPropagation();
    if (onButtonClick) {
      onButtonClick(character.id, character.chat_room_id);
    } else {
      navigate(`/ws/chat/${character.id}`);
    }
  };

  return (
    <div 
      className="bg-gray-800 rounded-xl overflow-hidden hover:bg-gray-700 transition-all duration-200 cursor-pointer group border border-gray-700 hover:border-purple-500"
      onClick={handleCardClick}
    >
      {/* 캐릭터 이미지 */}
      <div className="aspect-square relative overflow-hidden bg-gray-900">
        <LazyLoadImage
          alt={character.name}
          src={resolveImageUrl(character.thumbnail_url || character.avatar_url) || DEFAULT_SQUARE_URI}
          effect="blur"
          className="w-full h-full object-cover object-top group-hover:scale-105 transition-transform duration-300"
          wrapperClassName="w-full h-full"
        />
        {/* 채팅수/좋아요 바: 이미지 우하단 오버레이 */}
        <div className="absolute bottom-1 right-1 py-0.5 px-1.5 rounded bg-black/60 text-xs text-gray-100 flex items-center gap-2">
          <span className="inline-flex items-center gap-0.5"><MessageCircle className="w-3 h-3" />{formatCount(character.chat_count || 0)}</span>
          <span className="inline-flex items-center gap-0.5"><Heart className="w-3 h-3" />{formatCount(character.like_count || 0)}</span>
        </div>
      </div>
      
      {/* 캐릭터 정보 */}
      <div className="p-4 relative pb-6 h-[120px] overflow-hidden">
        <h3 className="font-medium text-white truncate">{character.name}</h3>
        {/* 설명 */}
        <p className="text-sm text-gray-500 mt-1 line-clamp-2 pr-1">
          {character.description || '설명이 없습니다.'}
        </p>
        
        {/* 상태 정보 제거: 이미지 영역으로 이동 */}

        {character.creator_username && character.creator_id && (
          <Link
            to={`/users/${character.creator_id}/creator`}
            onClick={(e) => e.stopPropagation()}
            className="absolute left-1 bottom-1 py-0.5 px-1.5 rounded bg-black/60 text-xs text-gray-100 inline-flex items-center gap-2 hover:text-white truncate"
          >
            <Avatar className="w-4 h-4">
              <AvatarImage src={''} alt={character.creator_username} />
              <AvatarFallback className="text-[10px]">
                {character.creator_username?.charAt(0)?.toUpperCase() || 'U'}
              </AvatarFallback>
            </Avatar>
            <span className="truncate max-w-[120px]">{character.creator_username}</span>
          </Link>
        )}
      </div>
    </div>
  );
};

export const CharacterCardSkeleton = () => (
  <div className="bg-gray-800 rounded-xl overflow-hidden border border-gray-700">
    {/* 이미지 스켈레톤 */}
    <Skeleton className="aspect-square bg-gray-700" />
    
    {/* 정보 스켈레톤 */}
    <div className="p-4 space-y-3">
      <Skeleton className="h-5 w-3/4 bg-gray-700" />
      <Skeleton className="h-4 w-1/2 bg-gray-700" />
      <div className="space-y-1">
        <Skeleton className="h-3 w-full bg-gray-700" />
        <Skeleton className="h-3 w-4/5 bg-gray-700" />
      </div>
      <div className="flex gap-3">
        <Skeleton className="h-3 w-12 bg-gray-700" />
        <Skeleton className="h-3 w-12 bg-gray-700" />
      </div>
    </div>
  </div>
); 