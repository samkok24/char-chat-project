import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { usersAPI } from '../lib/api';
import { Skeleton } from './ui/skeleton';
import { Alert, AlertDescription } from './ui/alert';
import { formatDistanceToNow } from 'date-fns';
import { ko } from 'date-fns/locale';
import { Clock } from 'lucide-react';
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
            <div className="text-xs text-gray-500 space-y-2 pt-2 border-t mt-2">
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
          }
        />
      ))}
    </div>
  );
}; 