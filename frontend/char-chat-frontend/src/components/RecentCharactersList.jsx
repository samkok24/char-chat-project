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
import { CharacterCard, CharacterCardSkeleton } from './CharacterCard';

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
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[...Array(limit)].map((_, i) => (
          <CharacterCardSkeleton key={i} />
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
    return <p className="text-center text-gray-500">최근 대화한 캐릭터가 없습니다.</p>;
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {characters.map((char) => (
        <CharacterCard
          key={char.id}
          character={char}
          onCardClick={() => handleCharacterClick(char.id, char.chat_room_id)}
          onButtonClick={() => handleCharacterClick(char.id, char.chat_room_id)}
          footerContent={
            <div className="space-y-2 pt-2 border-t mt-2">
              <div className="text-xs text-gray-500 space-y-2">
                <p className="truncate">
                  {char.last_message_snippet || '마지막 메시지 없음'}
                </p>
                <div className="flex items-center">
                  <Clock className="w-3 h-3 mr-1.5 flex-shrink-0" />
                  <span>
                    {char.last_chat_time ? formatDistanceToNow(new Date(char.last_chat_time), { addSuffix: true, locale: ko }) : '알 수 없음'}
                  </span>
                </div>
              </div>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full text-red-600 hover:text-red-700 hover:bg-red-50"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Trash2 className="w-4 h-4 mr-1" />
                    대화 삭제
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent onClick={(e) => e.stopPropagation()}>
                  <AlertDialogHeader>
                    <AlertDialogTitle>채팅방을 삭제하시겠습니까?</AlertDialogTitle>
                    <AlertDialogDescription>
                      이 작업은 되돌릴 수 없습니다. {char.name}와의 모든 대화 내용이 삭제됩니다.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel onClick={(e) => e.stopPropagation()}>취소</AlertDialogCancel>
                    <AlertDialogAction 
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteChatRoom(char.chat_room_id);
                      }}
                      className="bg-red-600 hover:bg-red-700"
                    >
                      삭제
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          }
        />
      ))}
    </div>
  );
}; 