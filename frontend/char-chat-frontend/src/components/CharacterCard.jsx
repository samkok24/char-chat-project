import React from 'react';
import { useNavigate } from 'react-router-dom';
import { LazyLoadImage } from 'react-lazy-load-image-component';
import 'react-lazy-load-image-component/src/effects/blur.css';
import { Skeleton } from './ui/skeleton';
import { MessageCircle, Heart } from 'lucide-react';

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
          src={character.avatar_url || '/placeholder-avatar.png'}
          effect="blur"
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          wrapperClassName="w-full h-full"
        />
        {!character.avatar_url && (
          <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-purple-600 to-blue-600">
            <span className="text-4xl font-bold text-white">
              {character.name.charAt(0).toUpperCase()}
            </span>
          </div>
        )}
      </div>
      
      {/* 캐릭터 정보 */}
      <div className="p-4">
        <h3 className="font-medium text-white truncate">{character.name}</h3>
        <p className="text-sm text-gray-400 truncate">by {character.creator_username || 'Unknown'}</p>
        
        {/* 설명 */}
        <p className="text-sm text-gray-500 mt-1 line-clamp-2">
          {character.description || '설명이 없습니다.'}
        </p>
        
        {/* 상태 정보 */}
        <div className="flex items-center gap-3 mt-3 text-xs text-gray-500">
          <span className="flex items-center">
            <MessageCircle className="w-3 h-3 mr-1" />
            {(character.chat_count || 0).toLocaleString()}
          </span>
          <span className="flex items-center">
            <Heart className="w-3 h-3 mr-1" />
            {character.like_count || 0}
          </span>
        </div>
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