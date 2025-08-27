import React from 'react';
import { resolveImageUrl } from '../lib/images';
import { DEFAULT_AVATAR_URI } from '../lib/placeholder';
import { formatDistanceToNow } from 'date-fns';
import { ko } from 'date-fns/locale';
import { Skeleton } from './ui/skeleton';
import { Heart, MessageCircle } from 'lucide-react';

export const RecentChatCard = ({ character, onClick }) => {
  const defaultAvatar = DEFAULT_AVATAR_URI;
  
  const safeUrl = (url) => resolveImageUrl(url) || defaultAvatar;
  
  const formatChatCount = (count) => {
    if (!count) return '0';
    if (count >= 1000000) {
      return `${(count / 1000000).toFixed(1)}M`;
    }
    if (count >= 1000) {
      return `${(count / 1000).toFixed(1)}k`;
    }
    return count.toString();
  };

  return (
    <a 
      className="flex w-fit group"
      onClick={(e) => {
        e.preventDefault();
        onClick();
      }}
      href="#"
    >
      <div>
        <div className="group/card h-[146px] bg-[#1f2327] hover:cursor-pointer hover:bg-[#252a2f] rounded-2xl relative transition-colors duration-200 border border-[#2a2f35] hover:border-[#3a4047]" style={{ width: '312px' }}>
          <div className="w-full h-full p-4 flex flex-col gap-2">
            <div className="flex flex-row h-full space-x-3 w-full">
              {/* 캐릭터 이미지 */}
              <span 
                className="relative flex h-auto w-full overflow-hidden shrink-0 grow-0" 
                style={{ width: '90px', height: '114px', borderRadius: '14px' }}
              >
                <img
                  alt={character.name}
                  draggable="false"
                  loading="lazy"
                  width="90"
                  height="114"
                  className="object-cover object-center bg-[#2a2f35] shrink-0 grow-0 h-full w-full"
                  src={safeUrl(character.thumbnail_url || character.avatar_url)}
                  onError={(e) => {
                    e.target.src = defaultAvatar;
                  }}
                />
                {/* 인디케이터: 이미지 우하단에 항상 표시 */}
                <div className="absolute bottom-1 right-1 py-0.5 px-1.5 rounded bg-black/60">
                  <div className="flex items-center gap-x-2 text-gray-200">
                    <div className="flex items-center gap-x-0.5">
                      <MessageCircle className="w-3 h-3" />
                      <span className="text-[10px] leading-none">{formatChatCount(character.chat_count ?? 0)}</span>
                    </div>
                    <div className="flex items-center gap-x-0.5">
                      <Heart className="w-3 h-3" />
                      <span className="text-[10px] leading-none">{formatChatCount(character.like_count ?? 0)}</span>
                    </div>
                  </div>
                </div>
              </span>

              {/* 정보 영역 */}
              {/* 스크롤 숨기고 내용은 줄바꿈+말줄임 처리 */}
              <div className="overflow-hidden h-full flex flex-col justify-between w-full">
                <div>
                  <p className="mb-[2px] text-base font-medium leading-tight line-clamp-1 text-ellipsis break-anywhere overflow-hidden whitespace-normal text-white">
                    {character.name}
                  </p>
                  <div className="text-gray-400 font-normal text-sm truncate mb-[5px]">
                    {character.creator_username || 'unknown'}
                  </div>
                  <p className="text-gray-300 font-normal line-clamp-3 text-sm text-ellipsis overflow-hidden whitespace-normal break-anywhere">
                    {character.description || '캐릭터 설명이 없습니다.'}
                  </p>
                </div>

                {/* 하단 정보 영역은 간결화 (인디케이터는 이미지 내부 표시) */}
                <div className="w-full" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </a>
  );
};

export const RecentChatCardSkeleton = () => {
  return (
    <div style={{ width: '312px' }}>
      <div className="h-[146px] bg-[#1f2327] rounded-2xl border border-[#2a2f35]">
        <div className="w-full h-full p-4 flex flex-col gap-2">
          <div className="flex flex-row h-full space-x-3 w-full">
            <Skeleton 
              className="shrink-0 grow-0 bg-gray-700" 
              style={{ width: '90px', height: '114px', borderRadius: '14px' }} 
            />
            <div className="overflow-hidden h-full flex flex-col justify-between w-full">
              <div>
                <Skeleton className="h-5 w-32 bg-gray-700 mb-[2px]" />
                <Skeleton className="h-4 w-20 bg-gray-700 mb-[5px]" />
                <Skeleton className="h-4 w-full bg-gray-700 mb-1" />
                <Skeleton className="h-4 w-3/4 bg-gray-700" />
              </div>
              <div className="flex flex-row gap-3">
                <Skeleton className="h-4 w-12 bg-gray-700" />
                <Skeleton className="h-4 w-12 bg-gray-700" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};