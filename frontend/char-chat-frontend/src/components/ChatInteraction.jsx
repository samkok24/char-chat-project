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

const ChatInteraction = ({ onStartChat, characterId, isAuthenticated, isWebNovel = false }) => {
  const navigate = useNavigate();

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
    if (!isAuthenticated) { navigate('/login'); return; }
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
    if (!isAuthenticated) { navigate('/login'); return; }
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
      <Select defaultValue="default">
        <SelectTrigger className="w-full bg-gray-800 border-gray-700">
          <SelectValue placeholder="시작할 대화의 상황을 선택하세요" />
        </SelectTrigger>
        <SelectContent className="bg-gray-800 text-white border-gray-700">
          <SelectItem value="default">이세계에 강제 소환하게 된 당신</SelectItem>
          <SelectItem value="option2">다른 상황 선택지 1</SelectItem>
          <SelectItem value="option3">다른 상황 선택지 2</SelectItem>
        </SelectContent>
      </Select>

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
          onClick={onStartChat}
          className="w-full bg-red-600 hover:bg-red-700 text-white font-bold text-lg py-6"
        >
          {isWebNovel ? '등장인물과 원작챗 시작' : '대화 시작'}
        </Button>
      )}
    </div>
  );
};

export default ChatInteraction; 