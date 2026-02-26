import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { usersAPI } from '../lib/api';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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
import { useAuth } from '../contexts/AuthContext';
import { emitChatRoomsChanged, getRoomsChangedActivity, shouldRefetchForRoomsChanged } from '../lib/chatRoomsChangedEvent';

export const RecentCharactersList = ({ limit = 4 }) => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const { data: characters = [], isLoading: loading, isError, refetch } = useQuery({
    queryKey: ['recent-characters', limit],
    queryFn: async () => {
      const response = await usersAPI.getRecentCharacters({ limit });
      return response.data || [];
    },
    staleTime: 0,
    refetchOnMount: 'always'
  });

  const patchRecentCharactersForActivity = React.useCallback((items, activity) => {
    const list = Array.isArray(items) ? items : [];
    const roomId = String(activity?.roomId || '').trim();
    if (!roomId) return { next: list, changed: false };
    const updatedAt = String(activity?.updatedAt || '').trim() || new Date().toISOString();
    const snippet = String(activity?.snippet || '').trim();
    let changed = false;
    const next = list.map((item) => {
      if (String(item?.chat_room_id || '').trim() !== roomId) return item;
      changed = true;
      return {
        ...(item || {}),
        last_chat_time: updatedAt,
        ...(snippet ? { last_message_snippet: snippet } : {}),
      };
    });
    if (!changed) return { next: list, changed: false };
    next.sort((a, b) => {
      const at = new Date(a?.last_chat_time || a?.created_at || 0).getTime() || 0;
      const bt = new Date(b?.last_chat_time || b?.created_at || 0).getTime() || 0;
      return bt - at;
    });
    return { next, changed: true };
  }, []);

  // 토큰 갱신/가시성 회복 시 재요청
  useEffect(() => {
    let missRefetchTimer = null;
    let missRefetchInFlight = false;
    const scheduleMissRefetch = () => {
      if (missRefetchInFlight) return;
      if (missRefetchTimer) clearTimeout(missRefetchTimer);
      missRefetchTimer = setTimeout(async () => {
        if (missRefetchInFlight) return;
        missRefetchInFlight = true;
        try { await refetch(); } catch (_) {}
        missRefetchInFlight = false;
      }, 500);
    };
    const onTokenRefreshed = () => refetch();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') refetch();
    };
    // ✅ 구조 변경(생성/삭제)만 즉시 재조회하고, 메시지 activity는 폭주 방지를 위해 무시
    const onRoomsChanged = (evt) => {
      const activity = getRoomsChangedActivity(evt);
      if (activity) {
        let changed = false;
        queryClient.setQueryData(['recent-characters', limit], (prev) => {
          const result = patchRecentCharactersForActivity(prev, activity);
          changed = Boolean(result?.changed);
          return result?.next || prev;
        });
        if (!changed) scheduleMissRefetch();
        return;
      }
      if (!shouldRefetchForRoomsChanged(evt)) return;
      refetch();
    };
    window.addEventListener('auth:tokenRefreshed', onTokenRefreshed);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('chat:roomsChanged', onRoomsChanged);
    return () => {
      if (missRefetchTimer) clearTimeout(missRefetchTimer);
      window.removeEventListener('auth:tokenRefreshed', onTokenRefreshed);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('chat:roomsChanged', onRoomsChanged);
    };
  }, [refetch, queryClient, limit, patchRecentCharactersForActivity]);

  const handleCharacterClick = (character) => {
    /**
     * 최근대화 원클릭 진입
     *
     * 요구사항:
     * - 원작챗 캐릭터는 origchat plain 모드로 진입해야 한다.
     * - roomId가 있으면 유지하여 "정확히 그 방" 이어하기가 가능해야 한다(다른 방과 혼선 방지).
     *
     * 구현:
     * - `/chat/:id` 리다이렉트 라우트를 사용하면 roomId/characterId 모두 안전하게 처리할 수 있다.
     * - query(source/storyId/mode)는 ChatRedirectPage가 유지한다.
     */
    const cid = String(character?.id || '').trim();
    if (!cid) return;

    // ✅ 비공개 캐릭터 접근 차단(요구사항)
    // - 최근대화에 남아있더라도, 크리에이터가 비공개로 바꾸면 접근을 막아야 한다.
    try {
      const isPublic = (character?.is_public !== false);
      const creatorId = String(character?.creator_id || '').trim();
      const isAdmin = !!user?.is_admin;
      const isCreator = !!creatorId && String(user?.id || '') === creatorId;
      if (!isPublic && !isAdmin && !isCreator) {
        try {
          window.dispatchEvent(new CustomEvent('toast', { detail: { type: 'error', message: '크리에이터가 비공개한 캐릭터입니다.' } }));
        } catch (_) {}
        return;
      }
    } catch (_) {}
    const roomId = String(character?.chat_room_id || '').trim();
    const storyId = String(character?.origin_story_id || '').trim();
    const isOrig = !!storyId || !!(character?.is_origchat || character?.source === 'origchat');

    if (isOrig && storyId) {
      const usp = new URLSearchParams();
      usp.set('source', 'origchat');
      usp.set('storyId', storyId);
      usp.set('mode', 'plain');
      const qs = usp.toString();
      // roomId가 있으면 room 기반으로 이동(정확 복원), 없으면 character 기반으로 이동(새 세션 생성)
      navigate(`/chat/${roomId || cid}${qs ? `?${qs}` : ''}`);
      return;
    }

    navigate(`/chat/${roomId || cid}`);
  };
  
  const handleDeleteChatRoom = async (chatRoomId) => {
    try {
      await chatAPI.deleteChatRoom(chatRoomId);
      refetch();
      emitChatRoomsChanged({ kind: 'structure', reason: 'deleted', roomId: chatRoomId });
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
        // 원작챗이면 모드 접미사 표시(평행세계/원작대로). plain(기본)에는 표시하지 않는다.
        const isOrig = !!(char?.origin_story_id || char?.is_origchat || char?.source === 'origchat');
        const mode = char?.last_chat_mode || (isOrig ? 'plain' : null);
        const modeLabel = (mode === 'parallel') ? ' (평행세계)'
          : (mode === 'canon') ? ' (원작대로)'
          : '';
        const title = isOrig ? `${char.name}${modeLabel}` : char.name;
        return (
          <div key={`${char.id}-${char.chat_room_id}-${idx}`} className="flex-shrink-0">
          <RecentChatCard
            character={char}
            displayTitle={title}
            onClick={() => handleCharacterClick(char)}
          />
        </div>
      ); })}
    </div>
  );
}; 
