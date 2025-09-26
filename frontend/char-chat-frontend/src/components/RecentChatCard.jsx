import React from 'react';
import { Link } from 'react-router-dom';
import { resolveImageUrl } from '../lib/images';
import { DEFAULT_AVATAR_URI } from '../lib/placeholder';
import { formatDistanceToNow } from 'date-fns';
import { ko } from 'date-fns/locale';
import { Skeleton } from './ui/skeleton';
import { Heart, MessageCircle } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar';
import { formatCount } from '../lib/format';
import { Badge } from './ui/badge';

export const RecentChatCard = ({ character, onClick, displayTitle }) => {
  const defaultAvatar = DEFAULT_AVATAR_URI;
  
  const safeUrl = (url) => resolveImageUrl(url) || defaultAvatar;
  
  const formatChatCount = (count) => formatCount(count);
  const isWebNovel = character?.source_type === 'IMPORTED';
  // 최근 대화 목록의 항목은 서버가 character.origin_story_id를 항상 포함하지 않을 수 있어
  // chat source 힌트 또는 쿼리 문자열이 전달되었는지 우선 확인하도록 보강
  const isOrigChat = !!(character?.origin_story_id || character?.is_origchat || character?.source === 'origchat');
  const borderClass = isOrigChat ? 'border-orange-500/60' : (isWebNovel ? 'border-blue-500/40' : 'border-purple-500/40');

  return (
    <div 
      className="flex w-fit group cursor-pointer"
      onClick={(e) => {
        e.preventDefault?.();
        onClick();
      }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
    >
      <div>
        <div className={`group/card h-[146px] bg-[#1f2327] hover:cursor-pointer hover:bg-[#252a2f] rounded-2xl relative transition-colors duration-200 border ${borderClass}`} style={{ width: '312px' }}>
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
                <div className="absolute top-1 left-1">
                  {isOrigChat ? (
                    <Badge className="bg-orange-400 text-black hover:bg-orange-400">원작챗</Badge>
                  ) : (isWebNovel ? (
                    <Badge className="bg-blue-600 text-white hover:bg-blue-600">웹소설</Badge>
                  ) : (
                    <Badge className="bg-purple-600 text-white hover:bg-purple-600">캐릭터</Badge>
                  ))}
                </div>
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
              {/* 상대 위치 컨테이너: 하단에 크리에이터 영역 고정 */}
              <div className="relative overflow-hidden h-full w-full pb-6">
                <div className="pr-1">
                  <p className="mb-[2px] text-base font-medium leading-tight line-clamp-1 text-ellipsis break-anywhere overflow-hidden whitespace-normal text-white">
                    {displayTitle || character.name}
                  </p>
                  <p className="text-gray-300 font-normal line-clamp-3 text-sm text-ellipsis overflow-hidden whitespace-normal break-anywhere">
                    {character.description || '캐릭터 설명이 없습니다.'}
                  </p>
                </div>

                {/* 하단 고정: 크리에이터 아바타 + 닉네임 */}
                {isOrigChat && character.origin_story_title ? (
                  <Link
                    to={character.origin_story_id ? `/stories/${character.origin_story_id}` : '#'}
                    onClick={(e) => e.stopPropagation()}
                    className="absolute left-0 bottom-0 inline-flex items-center gap-2 text-sm text-white truncate"
                    title={character.origin_story_title}
                  >
                    <Badge className="bg-blue-600 text-white hover:bg-blue-500 truncate max-w-[150px] px-1.5 py-0.5 text-[10px] leading-[1.05] rounded-md">{character.origin_story_title}</Badge>
                  </Link>
                ) : (character.creator_username && character.creator_id) ? (
                  <Link
                    to={`/users/${character.creator_id}/creator`}
                    onClick={(e) => e.stopPropagation()}
                    className="absolute left-0 bottom-0 inline-flex items-center gap-2 text-sm text-gray-300 hover:text-white truncate"
                  >
                    <Avatar className="w-5 h-5">
                      <AvatarImage src={''} alt={character.creator_username} />
                      <AvatarFallback className="text-xs">{character.creator_username?.charAt(0)?.toUpperCase() || 'U'}</AvatarFallback>
                    </Avatar>
                    <span className="truncate max-w-[140px]">{character.creator_username}</span>
                  </Link>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
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