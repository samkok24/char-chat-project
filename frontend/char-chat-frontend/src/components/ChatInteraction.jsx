import React from 'react';
import { Button } from './ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { usersAPI, chatAPI } from '../lib/api';
import { useLoginModal } from '../contexts/LoginModalContext';

const ChatInteraction = ({ onStartChat, characterId, isAuthenticated, isWebNovel = false, originStoryId = null }) => {
  const navigate = useNavigate();
  const { openLoginModal } = useLoginModal();
  const isOrigChatCharacter = !!originStoryId;
  const safeOriginStoryId = (() => {
    try { return String(originStoryId || '').trim(); } catch (_) { return ''; }
  })();

  const { data: recent = [] } = useQuery({
    queryKey: ['recent-characters-for-continue'],
    enabled: !!isAuthenticated,
    queryFn: async () => {
      try {
        const res = await usersAPI.getRecentCharacters({ limit: 50 });
        return res.data || [];
      } catch (_) { return []; }
    },
    staleTime: 0,
    refetchOnMount: 'always'
  });
  // 해당 캐릭터의 채팅방들을 시간순으로 다시 정렬해서 가장 최근 것 선택
  const characterRooms = Array.isArray(recent) ? recent.filter(c => String(c.id) === String(characterId)) : [];
  const recentMatch = characterRooms.length > 0
  ? characterRooms.sort((a, b) => {
      const at = new Date(a.last_chat_time || a.last_message_time || a.updated_at || a.created_at || 0).getTime();
      const bt = new Date(b.last_chat_time || b.last_message_time || b.updated_at || b.created_at || 0).getTime();
      return bt - at;
    })[0]
  : null;
    // const recentMatch = Array.isArray(recent) ? recent.find(c => String(c.id) === String(characterId)) : null;
  const hasHistory = !!recentMatch;

  const handleContinue = async () => {
    if (!isAuthenticated) { openLoginModal(); return; }
    // ✅ 원작챗 캐릭터는 일반 채팅방(room) 재사용 로직이 아니라, origchat plain 모드로 진입해야 한다.
    // - ChatPage가 localStorage의 마지막 원작챗 room을 재사용하거나, 없으면 새로 생성한다(SSOT).
    if (isOrigChatCharacter && safeOriginStoryId) {
      navigate(`/ws/chat/${characterId}?source=origchat&storyId=${safeOriginStoryId}&mode=plain`);
      return;
    }
    try {
      const sessionsRes = await chatAPI.getChatSessions();
      const sessions = Array.isArray(sessionsRes.data) ? sessionsRes.data : [];
      const characterSessions = sessions.filter(s => String(s.character_id) === String(characterId));
      const latest = characterSessions.sort((a, b) => {
        const at = new Date(a.last_message_time || a.last_chat_time || a.updated_at || a.created_at || 0).getTime();
        const bt = new Date(b.last_message_time || b.last_chat_time || b.updated_at || b.created_at || 0).getTime();
        return bt - at;
      })[0];
      if (latest?.id) {
        navigate(`/ws/chat/${characterId}?room=${latest.id}`);
      } else {
        navigate(`/ws/chat/${characterId}`);
      }
    } catch (e) {
      console.error('continue failed, fallback', e);
      navigate(`/ws/chat/${characterId}`);
    }
  };

  const handleNew = async () => {
    if (!isAuthenticated) { openLoginModal(); return; }
    // ✅ 원작챗 캐릭터는 "새로 대화"도 origchat plain 모드로 진입해야 한다.
    // - new=1을 붙이면 ChatPage가 기존 원작챗 방을 재사용하지 않고 새 방을 생성한다.
    if (isOrigChatCharacter && safeOriginStoryId) {
      navigate(`/ws/chat/${characterId}?source=origchat&storyId=${safeOriginStoryId}&mode=plain&new=1`);
      return;
    }
    try {
      // 무조건 새 방 생성 API 사용
      const roomResponse = await chatAPI.startNewChat(characterId);
      const newRoomId = roomResponse.data.id;
      navigate(`/ws/chat/${characterId}?room=${newRoomId}`);
    } catch (err) {
      console.error('Failed to create new chat:', err);
      navigate(`/ws/chat/${characterId}?new=1`);
    }
  };

  return (
    <div className="space-y-4">
      {hasHistory ? (
        <div className="grid grid-cols-2 gap-2">
          <Button onClick={handleContinue} className="w-full bg-gray-700 hover:bg-gray-600 text-white font-semibold py-5">
            계속 대화
          </Button>
          <Button onClick={handleNew} className="w-full bg-red-600 hover:bg-red-700 text-white font-semibold py-5">
            새로 대화
          </Button>
        </div>
      ) : (
        <Button
          onClick={isOrigChatCharacter ? handleContinue : onStartChat}
          className="w-full bg-red-600 hover:bg-red-700 text-white font-bold text-lg py-6"
        >
          {isOrigChatCharacter ? '원작챗 시작' : (isWebNovel ? '등장인물과 원작챗 시작' : '대화 시작')}
        </Button>
      )}
    </div>
  );
};

export default ChatInteraction; 