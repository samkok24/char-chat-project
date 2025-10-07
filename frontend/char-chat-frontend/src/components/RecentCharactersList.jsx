import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { usersAPI } from '../lib/api';
import { useQuery } from '@tanstack/react-query';
import { Skeleton } from './ui/skeleton';
import { Alert, AlertDescription } from './ui/alert';
import { formatDistanceToNow } from 'date-fns';
import { ko } from 'date-fns/locale';
import { Clock, Trash2 } from 'lucide-react';
import { chatAPI } from '../lib/api';
import { Button } from './ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from './ui/alert-dialog';
import { RecentChatCard, RecentChatCardSkeleton } from './RecentChatCard';

export const RecentCharactersList = ({ limit = 4 }) => {
  const navigate = useNavigate();

  const { data: characters = [], isLoading: loading, isError, refetch } = useQuery({
    queryKey: ['recent-characters', limit],
    queryFn: async () => {
      const response = await usersAPI.getRecentCharacters({ limit });
      return response.data || [];
    },
    staleTime: 0,
    refetchOnMount: 'always'
  });

  // 토큰 갱신/가시성 회복 시 재요청
  useEffect(() => {
    const onTokenRefreshed = () => refetch();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') refetch();
    };
    window.addEventListener('auth:tokenRefreshed', onTokenRefreshed);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('auth:tokenRefreshed', onTokenRefreshed);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [refetch]);

  const handleCharacterClick = (characterId, chatRoomId) => {
    navigate(`/chat/${chatRoomId || characterId}`);
  };
  
  const handleDeleteChatRoom = async (chatRoomId) => {
    try {
      await chatAPI.deleteChatRoom(chatRoomId);
      refetch();
    } catch (error) {
      console.error('채팅방 삭제 실패:', error);
    }
  };

  if (loading) {
    return (
      <div className="flex overflow-x-auto gap-3 pb-2 scrollbar-hide">
        {[...Array(limit)].map((_, i) => (
          <div key={i} className="flex-shrink-0">
            <RecentChatCardSkeleton />
          </div>
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <Alert variant="destructive">
        <AlertDescription>
          최근 대화한 캐릭터를 불러오는데 실패했습니다.
          <Button variant="outline" size="sm" className="ml-2" onClick={() => refetch()}>
            다시 시도
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  if (characters.length === 0) {
    return <p className="text-gray-500">최근 대화한 캐릭터가 없습니다.</p>;
  }

  return (
    <div className="flex overflow-x-auto gap-3 pb-2 scrollbar-hide">
      {characters.map((char, idx) => {
        // 원작챗이면 모드 접미사 표시. 모드 정보가 없으면 과거 생성분 기본값으로 (일대일)
        const isOrig = !!(char?.origin_story_id || char?.is_origchat || char?.source === 'origchat');
        const mode = char?.last_chat_mode || (isOrig ? 'plain' : null);
        const modeLabel = (mode === 'parallel') ? ' (평행세계)'
          : (mode === 'canon') ? ' (원작대로)'
          : (mode === 'plain') ? ' (일대일)'
          : '';
        const title = isOrig ? `${char.name}${modeLabel}` : char.name;
        return (
          <div key={`${char.id}-${char.chat_room_id}-${idx}`} className="flex-shrink-0">
          <RecentChatCard
            character={char}
            displayTitle={title}
            onClick={() => handleCharacterClick(char.id, char.chat_room_id)}
          />
        </div>
      ); })}
    </div>
  );
}; 