import React from 'react';
import { formatCount } from '../lib/format';
import { formatDistanceToNow } from 'date-fns';
import { ko } from 'date-fns/locale';
import { Skeleton } from './ui/skeleton';
import { resolveImageUrl } from '../lib/images';
import { DEFAULT_AVATAR_URI } from '../lib/placeholder';
import { MessageCircle, MoreVertical, Heart, Pin, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar';
import { Badge } from './ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';

export const HistoryChatCard = ({ character, onClick, onPin, onDelete }) => {
  const defaultAvatar = DEFAULT_AVATAR_URI;
  
  const formatTime = (dateString) => {
    if (!dateString) return '';
    try {
      return formatDistanceToNow(new Date(dateString), { 
        addSuffix: true, 
        locale: ko 
      });
    } catch (error) {
      return '';
    }
  };

  const formatChatCount = (count) => formatCount(count);
  const isWebNovel = character?.source_type === 'IMPORTED';
  const isOrigChat = !!(character?.origin_story_id || character?.is_origchat);

  return (
    <div className="relative">
      {/* 우상단 옵션 버튼 */}
      <div className="absolute top-0.5 right-0.5 lg:top-1 lg:right-1" style={{ zIndex: 15 }}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="min-w-[36px] min-h-[36px] lg:min-w-0 lg:min-h-0 p-1.5 lg:p-2 rounded-xl hover:bg-[#2a2f35] transition-colors group flex items-center justify-center"
              onClick={(e) => e.stopPropagation()}
            >
              <MoreVertical className="w-5 h-5 text-gray-400 group-hover:text-gray-200" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="bg-gray-800 text-white border border-gray-700">
            <DropdownMenuItem
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onPin?.(character);
              }}
            >
              <Pin className="w-4 h-4 mr-2" /> 핀 고정
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-red-500 focus:text-red-400"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onDelete?.(character);
              }}
            >
              <Trash2 className="w-4 h-4 mr-2" /> 삭제
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* 메인 카드 */}
      <div 
        className="block cursor-pointer"
        onClick={(e) => {
          e.preventDefault?.();
          onClick();
        }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
      >
        <div className={`group flex text-white bg-[#1f2327] rounded-2xl transition-colors duration-200 hover:bg-[#252a2f] border ${isOrigChat ? 'border-orange-500/60' : (isWebNovel ? 'border-blue-500/40' : 'border-purple-500/40')} h-[10.5rem] lg:h-[11.5rem] overflow-hidden`}>
          {/* 좌측 이미지 영역 (30%) */}
          <div className="w-[30%] relative bg-[#0d0f11] flex-shrink-0 rounded-l-2xl overflow-hidden">
            <div className="absolute inset-0">
              <img
                src={resolveImageUrl(character.thumbnail_url || character.avatar_url) || defaultAvatar}
                alt={character.name}
                className="w-full h-full object-cover cursor-zoom-in"
                title="클릭하여 캐릭터 정보 보기"
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
              {/* 채팅 수 & 좋아요 수 표시 */}
              <div className="absolute bottom-2.5 right-1 py-0.5 px-1.5 rounded bg-black bg-opacity-60 cursor-zoom-in" title="클릭하여 캐릭터 정보 보기">
                <div className="flex items-center gap-x-2 text-gray-300">
                  <div className="flex items-center gap-x-0.5">
                    <MessageCircle className="w-2.5 h-2.5" />
                    <span className="text-[10px] font-normal leading-none mb-[1px]">{formatChatCount(character.chat_count || 0)}</span>
                  </div>
                  <div className="flex items-center gap-x-0.5">
                    <Heart className="w-2.5 h-2.5" />
                    <span className="text-[10px] font-normal leading-none mb-[1px]">{formatChatCount(character.like_count || 0)}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* 우측 컨텐츠 영역 (70%) */}
          <div className="flex flex-col w-[70%] p-3 lg:p-3.5 pt-2.5 lg:pt-3 rounded-r-2xl relative pb-6">
            <div className="pb-0">
              <div className="flex justify-between items-start">
                <div className="flex-1 mr-2">
                  <div className="h-4 flex items-start gap-1">
                    <h2 className="text-[17px] lg:text-[18px] font-semibold leading-tight cursor-pointer hover:text-gray-300 transition-colors text-white">
                      {character.name}
                    </h2>
                  </div>
                </div>
              </div>
            </div>

            {/* 구분선 */}
            <div className="border-t border-[#2a2f35]/40 my-1.5 lg:my-2"></div>

            {/* 최근 메시지 */}
            <div className="flex-1 overflow-hidden pr-1">
              <p className="text-[13px] lg:text-sm line-clamp-3 text-gray-300 leading-[1.5]">
                <span className="text-gray-400 mr-1"></span>
                {character.last_message_snippet || '대화를 시작해보세요'}
              </p>
            </div>

            {/* 하단 고정: 크리에이터 + 시간 */}
            <div className="absolute left-3 right-3 bottom-2 flex items-center justify-between">
              {character.creator_username && character.creator_id && (
                <Link
                  to={`/users/${character.creator_id}/creator`}
                  onClick={(e) => e.stopPropagation()}
                  className="inline-flex items-center gap-1.5 text-[11px] lg:text-xs text-gray-300 hover:text-white"
                >
                  <Avatar className="w-4 h-4">
                    <AvatarImage src={''} alt={character.creator_username} />
                    <AvatarFallback className="text-[10px]">{character.creator_username?.charAt(0)?.toUpperCase() || 'U'}</AvatarFallback>
                  </Avatar>
                  <span className="truncate max-w-[120px]">{character.creator_username}</span>
                </Link>
              )}
              <span className="text-[11px] lg:text-xs text-gray-500">
                {formatTime(character.last_chat_time)}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export const HistoryChatCardSkeleton = () => {
  return (
    <div className="relative">
      <div className="group flex bg-[#1f2327] rounded-2xl border border-[#2a2f35] h-[10.5rem] lg:h-[11.5rem] overflow-hidden">
        <div className="w-[30%] relative bg-[#0d0f11] flex-shrink-0 rounded-l-2xl">
          <Skeleton className="w-full h-full bg-gray-700" />
        </div>
        <div className="flex flex-col w-[70%] p-3 lg:p-3.5 pt-2.5 lg:pt-3">
          <div className="pb-0">
            <Skeleton className="h-5 w-32 bg-gray-700 mb-2" />
            <Skeleton className="h-4 w-24 bg-gray-700" />
          </div>
          <div className="border-t border-[#2a2f35]/40 my-1.5 lg:my-2"></div>
          <div className="flex-1">
            <Skeleton className="h-4 w-full bg-gray-700 mb-1" />
            <Skeleton className="h-4 w-3/4 bg-gray-700" />
          </div>
          <Skeleton className="h-3 w-16 bg-gray-700 mt-2" />
        </div>
      </div>
    </div>
  );
};