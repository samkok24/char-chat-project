import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { usersAPI } from '../lib/api';
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
  const [characters, setCharacters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    const fetchRecentCharacters = async () => {
      try {
        setLoading(true);
        const response = await usersAPI.getRecentCharacters({ limit });
        setCharacters(response.data);
      } catch (err) {
        setError('최근 대화한 캐릭터를 불러오는데 실패했습니다.');
      } finally {
        setLoading(false);
      }
    };
    fetchRecentCharacters();
  }, [limit]);

  const handleCharacterClick = (characterId, chatRoomId) => {
    navigate(`/chat/${chatRoomId || characterId}`);
  };
  
  const handleDeleteChatRoom = async (chatRoomId) => {
    try {
      await chatAPI.deleteChatRoom(chatRoomId);
      // 목록에서 제거
      setCharacters(prev => prev.filter(char => char.chat_room_id !== chatRoomId));
    } catch (error) {
      console.error('채팅방 삭제 실패:', error);
      setError('채팅방 삭제에 실패했습니다.');
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

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  if (characters.length === 0) {
    return <p className="text-gray-500">최근 대화한 캐릭터가 없습니다.</p>;
  }

  return (
    <div className="flex overflow-x-auto gap-3 pb-2 scrollbar-hide">
      {characters.map((char) => (
        <div key={char.id} className="flex-shrink-0">
          <RecentChatCard
            character={char}
            onClick={() => handleCharacterClick(char.id, char.chat_room_id)}
          />
        </div>
      ))}
    </div>
  );
}; 