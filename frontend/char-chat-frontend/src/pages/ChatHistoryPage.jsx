import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { usersAPI, chatAPI } from '../lib/api';
import { formatDistanceToNow } from 'date-fns';
import { ko } from 'date-fns/locale';
import { Card, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Alert, AlertDescription } from '../components/ui/alert';
import { History, AlertCircle, Loader2 } from 'lucide-react';
import { HistoryChatCard, HistoryChatCardSkeleton } from '../components/HistoryChatCard';
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
    navigate(`/ws/chat/${characterId}`);
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



  if (loading && page === 1) {
    return (
      <AppLayout>
        <div className="min-h-full bg-gray-900 p-4 md:p-8">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center space-x-2 mb-8">
            <History className="w-8 h-8 text-white" />
            <h1 className="text-3xl font-bold text-white">대화 내역</h1>
          </div>
          
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3 lg:gap-6 mt-7">
            {[...Array(12)].map((_, i) => (
              <HistoryChatCardSkeleton key={i} />
            ))}
          </div>
        </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="min-h-full bg-gray-900 p-4 md:p-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center space-x-2 mb-8">
          <History className="w-8 h-8 text-white" />
          <h1 className="text-3xl font-bold text-white">대화 내역</h1>
        </div>
        
        {error && (
          <Alert variant="destructive" className="mb-6">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        
        {characters.length === 0 && !loading ? (
          <div className="text-center py-12">
            <History className="w-16 h-16 text-gray-600 mx-auto mb-4" />
            <p className="text-lg text-gray-400">아직 대화한 캐릭터가 없습니다.</p>
            <p className="text-sm text-gray-500 mt-2">홈 화면에서 캐릭터를 선택해 대화를 시작해보세요.</p>
            <Button 
              onClick={() => navigate('/')}
              className="mt-6 bg-purple-600 hover:bg-purple-700"
            >
              캐릭터 둘러보기
            </Button>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3 lg:gap-6 mt-7">
              {characters.map((character, index) => (
                <div
                  key={character.id}
                  ref={index === characters.length - 1 ? lastCharacterRef : null}
                >
                  <HistoryChatCard 
                    character={character}
                    onClick={() => handleCharacterClick(character.id, character.chat_room_id)}
                  />
                </div>
              ))}
            </div>
            
            {loadingMore && (
              <div className="flex justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-purple-600" />
              </div>
            )}
            
            {!hasMore && characters.length > 0 && (
              <p className="text-center text-gray-500 py-8">
                모든 대화 내역을 불러왔습니다.
              </p>
            )}
          </>
        )}
      </div>
      </div>
    </AppLayout>
  );
};

export default ChatHistoryPage;