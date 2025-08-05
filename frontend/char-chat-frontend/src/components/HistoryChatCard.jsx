import React from 'react';
import { formatDistanceToNow } from 'date-fns';
import { ko } from 'date-fns/locale';
import { Skeleton } from './ui/skeleton';
import { MessageCircle, MoreVertical, Heart } from 'lucide-react';

export const HistoryChatCard = ({ character, onClick }) => {
  const defaultAvatar = "https://via.placeholder.com/90x114/6B7280/FFFFFF?text=캐릭터";
  
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
    <div className="relative">
      {/* 우상단 옵션 버튼 */}
      <div className="absolute top-0.5 right-0.5 lg:top-1 lg:right-1" style={{ zIndex: 15 }}>
        <button 
          className="min-w-[36px] min-h-[36px] lg:min-w-0 lg:min-h-0 p-1.5 lg:p-2 rounded-xl hover:bg-[#2a2f35] transition-colors group flex items-center justify-center"
          onClick={(e) => {
            e.stopPropagation();
            // 옵션 메뉴 처리
          }}
        >
          <MoreVertical className="w-5 h-5 text-gray-400 group-hover:text-gray-200" />
        </button>
      </div>

      {/* 메인 카드 */}
      <a 
        className="block"
        href="#"
        onClick={(e) => {
          e.preventDefault();
          onClick();
        }}
      >
        <div className="group flex text-white bg-[#1f2327] rounded-2xl transition-colors duration-200 hover:bg-[#252a2f] border border-[#2a2f35] hover:border-[#3a4047] h-[10.5rem] lg:h-[11.5rem] overflow-hidden">
          {/* 좌측 이미지 영역 (30%) */}
          <div className="w-[30%] relative bg-[#0d0f11] flex-shrink-0 rounded-l-2xl overflow-hidden">
            <div className="absolute inset-0">
              <img
                src={character.avatar_url || defaultAvatar}
                alt={character.name}
                className="w-full h-full object-cover cursor-zoom-in"
                title="클릭하여 캐릭터 정보 보기"
                onError={(e) => {
                  e.target.src = defaultAvatar;
                }}
              />
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
          <div className="flex flex-col w-[70%] p-3 lg:p-3.5 pt-2.5 lg:pt-3 rounded-r-2xl">
            <div className="pb-0">
              <div className="flex justify-between items-start">
                <div className="flex-1 mr-2">
                  <div className="h-4 flex items-start gap-1">
                    <h2 className="text-[17px] lg:text-[18px] font-semibold leading-tight cursor-pointer hover:text-gray-300 transition-colors text-white" title="클릭하여 대화방 이름 변경">
                      {character.name}
                    </h2>
                  </div>
                  <div className="h-5 lg:h-6 flex items-center gap-2 mt-1.5 lg:mt-2 overflow-hidden">
                    <p className="text-[11px] lg:text-xs text-gray-400 font-medium flex-shrink-0">
                      {character.name} × {character.creator_username || 'unknown'}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* 구분선 */}
            <div className="border-t border-[#2a2f35]/40 my-1.5 lg:my-2"></div>

            {/* 최근 메시지 */}
            <div className="flex-1 overflow-hidden">
              <p className="text-[13px] lg:text-sm line-clamp-3 text-gray-300 leading-[1.5]">
                <span className="text-gray-400 mr-1"></span>
                {character.last_message_snippet || '대화를 시작해보세요'}
              </p>
            </div>

            {/* 시간 표시 */}
            <div className="mt-2">
              <span className="text-[11px] lg:text-xs text-gray-500">
                {formatTime(character.last_chat_time)}
              </span>
            </div>
          </div>
        </div>
      </a>
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