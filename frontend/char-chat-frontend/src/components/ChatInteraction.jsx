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

const ChatInteraction = ({ onStartChat, characterId, isAuthenticated }) => {
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
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
  });

  const recentMatch = Array.isArray(recent) ? recent.find(c => String(c.id) === String(characterId)) : null;
  const hasHistory = !!recentMatch;

  const handleContinue = () => {
    if (!isAuthenticated) { navigate('/login'); return; }
    const roomId = recentMatch?.chat_room_id;
    if (roomId) {
      navigate(`/ws/chat/${characterId}?room=${roomId}`);
    } else {
      navigate(`/ws/chat/${characterId}`);
    }
  };

  const handleNew = () => {
    if (!isAuthenticated) { navigate('/login'); return; }
    // 새 채팅방은 ChatPage에서 생성하도록 위임
    navigate(`/ws/chat/${characterId}?new=1`);
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
          등장인물과 원작챗 시작
        </Button>
      )}
    </div>
  );
};

export default ChatInteraction; 