import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { usersAPI, chatAPI } from '../lib/api';
import { formatDistanceToNow } from 'date-fns';
import { ko } from 'date-fns/locale';
import { Card, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Alert, AlertDescription } from '../components/ui/alert';
import { History, AlertCircle, Loader2, ArrowLeft } from 'lucide-react';
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
import { useAuth } from '../contexts/AuthContext';

const ChatHistoryPage = () => {
  const [characters, setCharacters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const navigate = useNavigate();
  const { user: currentUser } = useAuth();
  const observerRef = useRef();
  const lastCharacterRef = useRef();

  // --- 핀 저장소 (로컬, 사용자별) ---
  const pinnedKey = currentUser?.id ? `pinned_chars:${currentUser.id}` : 'pinned_chars:guest';
  const loadPinnedSet = () => {
    try {
      const arr = JSON.parse(localStorage.getItem(pinnedKey) || '[]');
      return new Set(Array.isArray(arr) ? arr : []);
    } catch (_) {
      return new Set();
    }
  };
  const savePinnedSet = (setObj) => {
    try { localStorage.setItem(pinnedKey, JSON.stringify(Array.from(setObj))); } catch (_) {}
  };
  const applyPinFlagAndSort = (list) => {
    const pinned = loadPinnedSet();
    const withFlag = list.map(c => ({ ...c, is_pinned: pinned.has(c.id) }));
    // 핀 우선, 그 다음 최근 대화 시간 기준(있으면)
    return withFlag.sort((a,b) => {
      if (a.is_pinned !== b.is_pinned) return a.is_pinned ? -1 : 1;
      const at = a.last_chat_time ? new Date(a.last_chat_time).getTime() : 0;
      const bt = b.last_chat_time ? new Date(b.last_chat_time).getTime() : 0;
      return bt - at;
    });
  };

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
        setCharacters(applyPinFlagAndSort(newCharacters));
      } else {
        setCharacters(prev => applyPinFlagAndSort([...prev, ...newCharacters]));
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

  const confirmDelete = (character) => {
    setDeleteTarget(character);
  };

  const handleDeleteConfirmed = async () => {
    if (!deleteTarget) return;
    const chatRoomId = deleteTarget.chat_room_id;
    try {
      await chatAPI.deleteChatRoom(chatRoomId);
      setCharacters(prev => prev.filter(char => char.chat_room_id !== chatRoomId));
      setDeleteTarget(null);
      // 사이드바 새로고침 이벤트 브로드캐스트
      try { window.dispatchEvent(new Event('chat:roomsChanged')); } catch (_) {}
    } catch (error) {
      console.error('채팅방 삭제 실패:', error);
      setError('채팅방 삭제에 실패했습니다.');
    }
  };

  const handlePinToggle = (c) => {
    const pinned = loadPinnedSet();
    if (c.is_pinned) pinned.delete(c.id); else pinned.add(c.id);
    savePinnedSet(pinned);
    setCharacters(prev => applyPinFlagAndSort(prev.map(x => x.id === c.id ? { ...x, is_pinned: !c.is_pinned } : x)));
  };

  if (loading && page === 1) {
    return (
      <AppLayout>
        <div className="min-h-full bg-gray-900 p-4 md:p-8">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                onClick={() => navigate('/')}
                className="p-2 rounded-full text-gray-300 hover:text-white hover:bg-gray-800"
              >
                <ArrowLeft className="w-5 h-5" />
              </Button>
              <h2 className="text-xl font-normal text-white">대화 내역</h2>
            </div>
          </div>
          
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 lg:gap-6 mt-7">
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
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              onClick={() => navigate('/')}
              className="p-2 rounded-full text-gray-300 hover:text-white hover:bg-gray-800"
            >
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <h2 className="text-xl font-normal text-white">대화 내역</h2>
          </div>
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
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 lg:gap-6 mt-7">
              {characters.map((character, index) => (
                <div
                  key={character.id}
                  ref={index === characters.length - 1 ? lastCharacterRef : null}
                >
                  <HistoryChatCard 
                    character={character}
                    onClick={() => handleCharacterClick(character.id, character.chat_room_id)}
                    onPin={handlePinToggle}
                    onDelete={confirmDelete}
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

        {/* 삭제 확인 모달 */}
        <AlertDialog open={!!deleteTarget} onOpenChange={(v) => !v && setDeleteTarget(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>채팅방 삭제</AlertDialogTitle>
              <AlertDialogDescription>
                {deleteTarget ? `${deleteTarget.name} 대화 내역을 삭제하시겠습니까?` : ''}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>취소</AlertDialogCancel>
              <AlertDialogAction onClick={handleDeleteConfirmed} className="bg-red-600 hover:bg-red-700">
                삭제
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
      </div>
    </AppLayout>
  );
};

export default ChatHistoryPage;