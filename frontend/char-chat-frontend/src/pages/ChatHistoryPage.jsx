import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { usersAPI, chatAPI } from '../lib/api';
import { formatDistanceToNow } from 'date-fns';
import { ko } from 'date-fns/locale';
import { Card, CardContent } from '../components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '../components/ui/avatar';
import { Button } from '../components/ui/button';
import { Skeleton } from '../components/ui/skeleton';
import { Alert, AlertDescription } from '../components/ui/alert';
import { History, Clock, MessageCircle, Trash2, AlertCircle, Loader2 } from 'lucide-react';
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
} from '../components/ui/alert-dialog';
import AppLayout from '../components/layout/AppLayout';

const ChatHistoryPage = () => {
  const [characters, setCharacters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const navigate = useNavigate();
  const observerRef = useRef();
  const lastCharacterRef = useRef();

  const fetchChatHistory = useCallback(async (pageNum) => {
    try {
      if (pageNum === 1) {
        setLoading(true);
      } else {
        setLoadingMore(true);
      }

      const response = await usersAPI.getRecentCharacters({ 
        page: pageNum, 
        limit: 20 
      });
      
      const newCharacters = response.data;
      
      if (pageNum === 1) {
        setCharacters(newCharacters);
      } else {
        setCharacters(prev => [...prev, ...newCharacters]);
      }
      
      setHasMore(newCharacters.length === 20);
      setError(null);
    } catch (err) {
      setError('대화 내역을 불러오는데 실패했습니다.');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    fetchChatHistory(1);
  }, [fetchChatHistory]);

  // 무한 스크롤 설정
  useEffect(() => {
    if (loadingMore || !hasMore) return;

    const observer = new IntersectionObserver(
      entries => {
        if (entries[0].isIntersecting && hasMore) {
          setPage(prev => prev + 1);
        }
      },
      { threshold: 0.1 }
    );

    if (lastCharacterRef.current) {
      observer.observe(lastCharacterRef.current);
    }

    observerRef.current = observer;

    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
    };
  }, [loadingMore, hasMore]);

  useEffect(() => {
    if (page > 1) {
      fetchChatHistory(page);
    }
  }, [page, fetchChatHistory]);

  const handleCharacterClick = (characterId, chatRoomId) => {
    navigate(`/chat/${chatRoomId || characterId}`);
  };

  const handleDeleteChatRoom = async (chatRoomId, characterName) => {
    try {
      await chatAPI.deleteChatRoom(chatRoomId);
      setCharacters(prev => prev.filter(char => char.chat_room_id !== chatRoomId));
    } catch (error) {
      console.error('채팅방 삭제 실패:', error);
      setError('채팅방 삭제에 실패했습니다.');
    }
  };

  const CharacterHistoryCard = ({ character, isLast }) => (
    <Card 
      ref={isLast ? lastCharacterRef : null}
      className="hover:shadow-lg transition-shadow cursor-pointer"
      onClick={() => handleCharacterClick(character.id, character.chat_room_id)}
    >
      <CardContent className="p-6">
        <div className="flex items-start space-x-4">
          <Avatar className="w-12 h-12">
            <AvatarImage src={character.avatar_url} alt={character.name} />
            <AvatarFallback className="bg-gradient-to-r from-purple-500 to-blue-500 text-white">
              {character.name?.charAt(0)}
            </AvatarFallback>
          </Avatar>
          
          <div className="flex-1">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-semibold text-lg">{character.name}</h3>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => e.stopPropagation()}
                    className="text-red-600 hover:text-red-700 hover:bg-red-50"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent onClick={(e) => e.stopPropagation()}>
                  <AlertDialogHeader>
                    <AlertDialogTitle>채팅방을 삭제하시겠습니까?</AlertDialogTitle>
                    <AlertDialogDescription>
                      이 작업은 되돌릴 수 없습니다. {character.name}와의 모든 대화 내용이 삭제됩니다.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel onClick={(e) => e.stopPropagation()}>취소</AlertDialogCancel>
                    <AlertDialogAction 
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteChatRoom(character.chat_room_id, character.name);
                      }}
                      className="bg-red-600 hover:bg-red-700"
                    >
                      삭제
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
            
            <p className="text-sm text-gray-500 mb-3">{character.description}</p>
            
            <div className="space-y-2">
              {character.last_message_snippet && (
                <div className="flex items-start space-x-2">
                  <MessageCircle className="w-4 h-4 text-gray-400 mt-0.5 flex-shrink-0" />
                  <p className="text-sm text-gray-600 line-clamp-2">
                    {character.last_message_snippet}
                  </p>
                </div>
              )}
              
              <div className="flex items-center space-x-2 text-xs text-gray-500">
                <Clock className="w-3 h-3" />
                <span>
                  {character.last_chat_time 
                    ? formatDistanceToNow(new Date(character.last_chat_time), { 
                        addSuffix: true, 
                        locale: ko 
                      })
                    : '대화 기록 없음'
                  }
                </span>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );

  if (loading && page === 1) {
    return (
      <AppLayout>
        <div className="min-h-full bg-gradient-to-br from-purple-50 via-blue-50 to-indigo-50 p-4 md:p-8">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center space-x-2 mb-8">
            <History className="w-8 h-8 text-purple-600" />
            <h1 className="text-3xl font-bold text-gray-900">대화 내역</h1>
          </div>
          
          <div className="space-y-4">
            {[...Array(3)].map((_, i) => (
              <Card key={i}>
                <CardContent className="p-6">
                  <div className="flex items-start space-x-4">
                    <Skeleton className="w-12 h-12 rounded-full" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-6 w-32" />
                      <Skeleton className="h-4 w-full" />
                      <Skeleton className="h-4 w-3/4" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="min-h-full bg-gradient-to-br from-purple-50 via-blue-50 to-indigo-50 p-4 md:p-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center space-x-2 mb-8">
          <History className="w-8 h-8 text-purple-600" />
          <h1 className="text-3xl font-bold text-gray-900">대화 내역</h1>
        </div>
        
        {error && (
          <Alert variant="destructive" className="mb-6">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        
        {characters.length === 0 && !loading ? (
          <Card>
            <CardContent className="p-12 text-center">
              <MessageCircle className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <p className="text-lg text-gray-500">아직 대화한 캐릭터가 없습니다.</p>
              <p className="text-sm text-gray-400 mt-2">홈 화면에서 캐릭터를 선택해 대화를 시작해보세요.</p>
              <Button 
                onClick={() => navigate('/')}
                className="mt-6"
              >
                캐릭터 둘러보기
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {characters.map((character, index) => (
              <CharacterHistoryCard 
                key={character.id} 
                character={character}
                isLast={index === characters.length - 1}
              />
            ))}
            
            {loadingMore && (
              <div className="flex justify-center py-4">
                <Loader2 className="w-6 h-6 animate-spin text-purple-600" />
              </div>
            )}
            
            {!hasMore && characters.length > 0 && (
              <p className="text-center text-gray-500 py-4">
                모든 대화 내역을 불러왔습니다.
              </p>
            )}
          </div>
        )}
      </div>
      </div>
    </AppLayout>
  );
};

export default ChatHistoryPage;