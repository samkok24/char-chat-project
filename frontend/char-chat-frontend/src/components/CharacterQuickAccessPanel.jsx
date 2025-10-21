import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Avatar, AvatarImage, AvatarFallback } from './ui/avatar';
import { chatAPI } from '../lib/api';
import { Bot } from 'lucide-react';

const CharacterQuickAccessPanel = () => {
  const [characters, setCharacters] = useState([]);
  const navigate = useNavigate();
  console.log('[Panel] 렌더링됨, characters:', characters.length); 
  useEffect(() => {
    console.log('[Panel] useEffect 실행');
    loadCharacters();
    
    // 5초마다 폴링
    const interval = setInterval(() => {
      console.log('[Panel] 폴링 실행'); // 🔍 폴링 횟수 확인
      loadCharacters();
    }, 60000);
    
    // 🆕 강제 리프레시 이벤트 리스너
    const handleForceRefresh = () => {
      console.log('[Panel] 강제 리프레시');
      loadCharacters();
    };
    
    const handleSetAllUnread = (event) => {
      const { count } = event.detail;
      console.log('[Panel] 상위', count, '개 캐릭터 unread=1');
      
      setCharacters(prev => {
        return prev.map((char, index) => {
          if (index < count) {
            return { ...char, unread: 1 };
          }
          return char;
        });
      });
    };
    
    window.addEventListener('force-refresh-sidebar', handleForceRefresh);
    window.addEventListener('set-all-unread', handleSetAllUnread);
    
    return () => {
      clearInterval(interval);
      window.removeEventListener('force-refresh-sidebar', handleForceRefresh);
      window.removeEventListener('set-all-unread', handleSetAllUnread);
    };
  }, []);

  const loadCharacters = async () => {
    try {
      console.log('[Panel] 🔄 loadCharacters 시작');
      const response = await chatAPI.getRoomsWithUnread({ limit: 50 });
      
      // response.data.data 또는 response.data 확인
      const rooms = response.data?.data || response.data || [];
      console.log('[Panel] 📦 API 응답:', rooms.length, '개 방');
      
      // 🔍 배열이 아니면 빈 배열로
      if (!Array.isArray(rooms)) {
        console.warn('[Panel] ❌ Invalid rooms data:', rooms);
        setCharacters([]);
        return;
      }
      
      // 🔍 상위 5개 방의 unread_count 확인
      console.log('[Panel] 📊 상위 5개 방의 unread_count:', 
        rooms.slice(0, 5).map(r => ({
          char: r.character?.name,
          unread: r.unread_count,
          roomId: r.id?.substring(0, 8)
        }))
      );
      
      // 일반챗/원작챗 구분 (배지로 판단)
      const normalRooms = [];
      const origRooms = [];
      
      rooms.forEach(room => {
        const charId = room?.character?.id;
        if (!charId) return;
        
        const title = room.title || '';
        const isOrigChat = title.includes('🌟') || title.includes('🔀');
        
        if (isOrigChat) {
          origRooms.push(room);
        } else {
          normalRooms.push(room);
        }
      });
      
      console.log('[Panel] 🔍 일반챗:', normalRooms.length, '개, 원작챗:', origRooms.length, '개');
      
      // 일반챗 먼저, 원작챗 나중
      const sortedRooms = [...normalRooms, ...origRooms];
      
      // 캐릭터 중복 제거 (가장 최근 채팅방만)
      const roomsByCharacter = new Map();
      sortedRooms.forEach(room => {
        const charId = room?.character?.id;
        if (!charId) return;
        
        const existing = roomsByCharacter.get(charId);
        const roomTime = new Date(room.updated_at || room.created_at).getTime();
        const existingTime = existing ? new Date(existing.updated_at || existing.created_at).getTime() : 0;
        
        if (!existing || roomTime > existingTime) {
          roomsByCharacter.set(charId, room);
        }
      });
      
      console.log('[Panel] 🔍 중복 제거 후:', roomsByCharacter.size, '개 캐릭터');
      
      // 정렬: 일반챗 우선, 최신순 (순서 완전 고정)
      const newChars = Array.from(roomsByCharacter.values())
        .slice(0, 5)
        .map(room => ({
          id: room.character.id,
          roomId: room.id,
          name: room.character.name,
          avatar: room.character.avatar_url || room.character.thumbnail_url,
          unread: room.unread_count || 0,
          updated_at: room.updated_at || room.created_at
        }));
      
      console.log('[Panel] ✅ 최종 newChars (상위 5개):', 
        newChars.map(c => ({
          name: c.name,
          unread: c.unread,
          roomId: c.roomId.substring(0, 8)
        }))
      );
      
      // 첫 로드 또는 캐릭터가 변경된 경우만 업데이트
      if (characters.length === 0) {
        // 첫 로드: 그대로 설정
        console.log('[Panel] 🆕 첫 로드: characters 설정');
        setCharacters(newChars);
      } else {
        // 이후: unread만 업데이트, 순서 절대 변경 안 함
        const charMap = new Map(newChars.map(c => [c.id, c]));
        const updatedChars = characters.map(char => {
          const updated = charMap.get(char.id);
          return updated ? { ...char, unread: updated.unread } : char;
        });
        
        console.log('[Panel] 🔄 기존 characters 업데이트:', 
          updatedChars.map(c => ({
            name: c.name,
            unread: c.unread
          }))
        );
        
        setCharacters(updatedChars);
      }
      
      console.log('[Panel] ✅ loadCharacters 완료');
    } catch (err) {
      console.error('[Panel] ❌ Failed to load characters:', err);
      setCharacters([]);
    }
  };

  const handleClick = async (characterId, roomId) => {
    try {
      // 🔥 클릭 시 즉시 읽음 처리
      await chatAPI.markRoomAsRead(roomId);
      console.log(`[Panel] ✅ 방 ${roomId.substring(0, 8)} 읽음 처리 완료`);
      
      // 🔥 즉시 UI 업데이트 (낙관적 업데이트)
      setCharacters(prev => prev.map(char => 
        char.roomId === roomId ? { ...char, unread: 0 } : char
      ));
      
      // 새 탭에서 채팅방 열기
      window.open(`/ws/chat/${characterId}?room=${roomId}`, '_blank');
    } catch (err) {
      console.error('[Panel] ❌ 읽음 처리 실패:', err);
      // 실패해도 채팅방은 열기
      window.open(`/ws/chat/${characterId}?room=${roomId}`, '_blank');
    }
  };

  // 디버깅: 항상 컨테이너 표시 (캐릭터 없어도)
  console.log('[Panel] 🎨 렌더링, characters.unread:', characters.map(c => `${c.name}:${c.unread}`));
  
  return (
    <div className="w-20 flex-shrink-0 bg-gray-900 border-l border-gray-700 flex flex-col items-center py-4 space-y-4 sticky top-0 h-screen overflow-y-auto">
      {characters.length === 0 && (
        <div className="text-xs text-gray-500 text-center mt-4">
          최근 채팅 없음
        </div>
      )}
      {characters.map(char => {
        console.log(`[Panel] 🔍 렌더링 중: ${char.name}, unread=${char.unread}, 뱃지표시=${char.unread > 0}`);
        return (
          <div 
            key={char.id} 
            className="relative cursor-pointer group glow-wrapper"  /* 🆕 glow-wrapper 추가 */
            onClick={() => handleClick(char.id, char.roomId)}
            data-char-id={char.id}
          >
            <Avatar 
              className="w-14 h-14 ring-2 ring-gray-700 group-hover:ring-pink-500 transition-all"
            >
              <AvatarImage src={char.avatar} className="object-cover" />
              <AvatarFallback className="bg-gradient-to-r from-purple-500 to-blue-500 text-white">
                {char.name?.[0] || <Bot className="w-6 h-6" />}
              </AvatarFallback>
            </Avatar>
            
            {/* Phase 2: 읽지 않은 메시지 뱃지 */}
            {char.unread > 0 && (
              <div className="absolute -top-1 -right-1 bg-red-500 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center shadow-lg">
                {char.unread > 9 ? '9+' : char.unread}
              </div>
            )}
            
            {/* 이름 툴팁 */}
            <div className="absolute left-full ml-2 px-2 py-1 bg-gray-800 rounded text-xs text-white whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50">
              {char.name}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default CharacterQuickAccessPanel;

