import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
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
  const pinnedKey = useMemo(() => (
    currentUser?.id ? `pinned_chars:${currentUser.id}` : 'pinned_chars:guest'
  ), [currentUser?.id]);
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
  }, [pinnedKey]);

  useEffect(() => {
    // ✅ 계정 전환(로그아웃→다른 계정 로그인) 시에도 이전 계정 데이터가 남지 않도록
    // 페이지/무한스크롤 상태를 초기화하고 1페이지부터 다시 로드한다.
    try { setPage(1); } catch (_) {}
    try { setHasMore(true); } catch (_) {}
    fetchChatHistory(1);
  }, [fetchChatHistory]);

  // ✅ 채팅방 생성/삭제/메시지 전송 등으로 목록이 바뀌면 1페이지부터 새로고침
  useEffect(() => {
    const onRoomsChanged = () => {
      try {
        setPage(1);
        setHasMore(true);
        fetchChatHistory(1);
      } catch (_) {}
    };
    try { window.addEventListener('chat:roomsChanged', onRoomsChanged); } catch (_) {}
    return () => {
      try { window.removeEventListener('chat:roomsChanged', onRoomsChanged); } catch (_) {}
    };
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

  const handleCharacterClick = (character) => {
    /**
     * 대화 내역에서 채팅 진입(원클릭)
     *
     * 요구사항:
     * - 원작챗 캐릭터는 "항상" origchat plain 모드로 진입해야 한다.
     * - 일반 캐릭터는 기존대로 room 기반 이어하기를 우선한다.
     *
     * 방어:
     * - origin_story_id가 없으면(예: 레거시/비정상 데이터) 기존 동작으로 폴백한다.
     */
    const cid = String(character?.id || '').trim();
    if (!cid) return;

    // ✅ 비공개 캐릭터 접근 차단(요구사항)
    // - 히스토리/대화내역/최근대화에 남아있더라도, 크리에이터가 비공개로 바꾸면 접근을 막아야 한다.
    try {
      const isPublic = (character?.is_public !== false);
      const creatorId = String(character?.creator_id || '').trim();
      const isAdmin = !!currentUser?.is_admin;
      const isCreator = !!creatorId && String(currentUser?.id || '') === creatorId;
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
      if (roomId) usp.set('room', roomId);
      navigate(`/ws/chat/${cid}?${usp.toString()}`);
      return;
    }

    const qs = roomId ? `?room=${roomId}` : '';
    navigate(`/ws/chat/${cid}${qs}`);
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
              onClick={() => navigate('/dashboard')}
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
              onClick={() => navigate('/dashboard')}
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
                  // ✅ 룸 단위로 히스토리를 보여주므로, key도 room 단위로 유니크해야 한다.
                  // - 같은 캐릭터(id)는 여러 채팅방(chat_room_id)을 가질 수 있다.
                  // - key가 character.id면 React가 카드 DOM/클로저를 재사용해 "술방 눌렀는데 밥방 열림" 같은 오동작이 난다.
                  key={String(character.chat_room_id || `${character.id}-${index}`)}
                  ref={index === characters.length - 1 ? lastCharacterRef : null}
                >
                  <HistoryChatCard 
                    character={character}
                    displayTitle={(() => {
                      const isOrig = !!(character?.origin_story_id || character?.is_origchat || character?.source === 'origchat');
                      if (!isOrig) return character.name;
                      const mode = character?.last_chat_mode || 'plain';
                      const map = { parallel: '평행세계', canon: '원작대로' };
                      const label = map[mode];
                      // ✅ UI 표기 정책: plain(기본)에는 '(일대일)' 같은 접미사를 붙이지 않는다.
                      return label ? `${character.name} (${label})` : character.name;
                    })()}
                    onClick={() => handleCharacterClick(character)}
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