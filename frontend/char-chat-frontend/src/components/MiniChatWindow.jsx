import React, { useState, useEffect, useRef } from 'react';
import { X, Send, Loader2, RotateCcw } from 'lucide-react';
import { origChatAPI, storiesAPI, charactersAPI, chaptersAPI, chatAPI, userPersonasAPI } from '../lib/api';
import { resolveImageUrl } from '../lib/images';

const MiniChatWindow = ({ open, onClose, storyId, currentChapterNo }) => {
  const [characters, setCharacters] = useState([]);
  const [selectedCharId, setSelectedCharId] = useState(null);
  const [chatSessions, setChatSessions] = useState({}); // charId -> { roomId, messages }
  const [initializingSessions, setInitializingSessions] = useState(new Set()); // 초기화 중인 세션 추적
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [totalChapters, setTotalChapters] = useState(1);
  const messagesEndRef = useRef(null);

  // 캐릭터 목록 및 회차 정보 로드
  useEffect(() => {
    if (!open || !storyId) {
      console.log('[MiniChat] Not opening:', { open, storyId });
      return;
    }
    
    console.log('[MiniChat] Loading data for story:', storyId);
    
    const loadData = async () => {
      setLoading(true);
      try {
        // 회차 목록 로드
        const chaptersRes = await chaptersAPI.getByStory(storyId, 'asc');
        const chapters = Array.isArray(chaptersRes.data) ? chaptersRes.data : [];
        setTotalChapters(chapters.length || 1);
        console.log('[MiniChat] Total chapters:', chapters.length);
        
        // 캐릭터 목록 로드
        const res = await storiesAPI.getExtractedCharacters(storyId);
        console.log('[MiniChat] Extracted characters response:', res);
        const list = Array.isArray(res.data?.items) ? res.data.items : [];
        const validChars = list.filter(c => c.character_id);
        console.log('[MiniChat] Valid characters:', validChars);
        
        // 공개 캐릭터만 로드
        const publicChars = [];
        for (const c of validChars) {
          try {
            const charRes = await charactersAPI.getCharacter(c.character_id);
            if (charRes.data?.is_public) {
              publicChars.push(charRes.data);
            }
          } catch (err) {
            console.error('[MiniChat] Failed to load character:', c.character_id, err);
            continue;
          }
        }
        
        console.log('[MiniChat] Public characters:', publicChars);
        setCharacters(publicChars);
        
        // 첫 번째 캐릭터 자동 선택
        if (publicChars.length > 0) {
          setSelectedCharId(publicChars[0].id);
          console.log('[MiniChat] Auto-selected character:', publicChars[0].id);
        } else {
          console.log('[MiniChat] No public characters found');
        }
      } catch (e) {
        console.error('[MiniChat] 데이터 로드 실패:', e);
      } finally {
        setLoading(false);
      }
    };
    
    loadData();
  }, [open, storyId]);

  // 캐릭터 선택 시 원작챗 일대일 모드 세션 초기화
  useEffect(() => {
    if (!selectedCharId || chatSessions[selectedCharId] || !storyId) {
      console.log('[MiniChat] Skipping init:', { selectedCharId, hasSession: !!chatSessions[selectedCharId], storyId });
      return;
    }
    
    // 이미 초기화 중이면 스킵
    if (initializingSessions.has(selectedCharId)) {
      console.log('[MiniChat] Already initializing:', selectedCharId);
      return;
    }
    
    console.log('[MiniChat] Initializing origchat plain mode session for character:', selectedCharId);
    
    // 초기화 시작 표시
    setInitializingSessions(prev => new Set(prev).add(selectedCharId));
    
    const initSession = async () => {
      // 디버깅: 현재 활성 페르소나 확인
      try {
        const personaResponse = await userPersonasAPI.getUserPersonas();
        console.log('[MiniChat] 페르소나 상태:', personaResponse.data);
        if (personaResponse.data?.active_persona) {
          console.log('[MiniChat] 활성 페르소나:', {
            name: personaResponse.data.active_persona.name,
            description: personaResponse.data.active_persona.description,
            is_active: personaResponse.data.active_persona.is_active
          });
        } else {
          console.warn('[MiniChat] 활성 페르소나 없음! pov: persona가 작동하지 않을 수 있음');
        }
      } catch (err) {
        console.error('[MiniChat] 페르소나 확인 실패:', err);
      }
      
      try {
        // 원작챗 일대일 모드(plain) 시작
        const res = await origChatAPI.start({
          story_id: storyId,
          character_id: selectedCharId,
          mode: 'plain',  // 일대일 모드
          // ✅ 요구사항: 뷰어(플로팅)에서의 진입은 '새로 대화'로 취급 → 새 방 강제
          force_new: true,
          start: null,
          range_from: null,
          range_to: null,
          focus_character_id: selectedCharId,
          narrator_mode: false,
          pov: 'persona'  // 일대일 모드에서는 사용자 페르소나 사용
        });
        
        console.log('[MiniChat] Origchat plain mode started:', res.data);
        const newRoomId = res.data?.id || res.data?.room_id;
        
        if (!newRoomId) {
          throw new Error('roomId를 받지 못했습니다');
        }
        
        // ✅ message_count로 기존 room인지 확인
        const messageCount = res.data?.message_count || 0;
        const isExistingRoom = messageCount > 0;
        
        let initialMessages = [];
        try {
          if (isExistingRoom) {
            // 기존 room이면 즉시 모든 메시지 불러오기
            console.log('[MiniChat] 기존 room 감지, 메시지 불러오기:', messageCount);
            const messagesRes = await chatAPI.getMessages(newRoomId, { limit: 100 });
            const messages = Array.isArray(messagesRes.data) ? messagesRes.data : [];
            initialMessages = messages.map(msg => ({
              id: msg.id,
              role: msg.sender_type === 'user' ? 'user' : 'assistant',
              content: msg.content,
              timestamp: msg.created_at || new Date().toISOString()
            }));
          } else {
            // 새 room이면 인사말이 생성될 때까지 대기 (백그라운드에서 생성되므로 폴링)
            console.log('[MiniChat] 새 room, 인사말 대기 중...');
            for (let i = 0; i < 20; i++) {
              await new Promise(resolve => setTimeout(resolve, 500));
              const messagesRes = await chatAPI.getMessages(newRoomId, { limit: 10 });
              const messages = Array.isArray(messagesRes.data) ? messagesRes.data : [];
              if (messages.length > 0) {
                initialMessages = messages.map(msg => ({
                  id: msg.id,
                  role: msg.sender_type === 'user' ? 'user' : 'assistant',
                  content: msg.content,
                  timestamp: msg.created_at || new Date().toISOString()
                }));
                break;
              }
            }
          }
        } catch (e) {
          console.warn('[MiniChat] Failed to load initial messages:', e);
        }
        
        console.log('[MiniChat] Origchat plain session initialized:', { roomId: newRoomId, messagesCount: initialMessages.length });
        
        setChatSessions(prev => ({
          ...prev,
          [selectedCharId]: {
            roomId: newRoomId,
            messages: initialMessages
          }
        }));
      } catch (e) {
        console.error('[MiniChat] 원작챗 일대일 모드 세션 시작 실패:', e);
        alert(`채팅 세션 초기화에 실패했습니다: ${e.response?.data?.detail || e.message || '알 수 없는 오류'}`);
      } finally {
        // 초기화 완료 표시
        setInitializingSessions(prev => {
          const next = new Set(prev);
          next.delete(selectedCharId);
          return next;
        });
      }
    };
    
    initSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCharId, characters, chatSessions, storyId]);

  // 대화 초기화 함수
  const handleResetChat = async () => {
    if (!selectedCharId || !storyId) return;
    
    try {
      console.log('[MiniChat] Resetting origchat plain mode for character:', selectedCharId);
      
      // 새 원작챗 일대일 모드 시작
      const res = await origChatAPI.start({
        story_id: storyId,
        character_id: selectedCharId,
        mode: 'plain',  // 일대일 모드
        // ✅ reset은 항상 새로 대화
        force_new: true,
        start: null,
        range_from: null,
        range_to: null,
        focus_character_id: selectedCharId,
        narrator_mode: false,
        pov: 'persona'  // 일대일 모드에서는 사용자 페르소나 사용
      });
      
      const newRoomId = res.data?.id || res.data?.room_id;
      
      // 원작챗 start 후 생성된 인사말 메시지 가져오기 (백그라운드에서 생성되므로 폴링)
      let initialMessages = [];
      try {
        // 인사말이 생성될 때까지 최대 10초 대기
        for (let i = 0; i < 20; i++) {
          await new Promise(resolve => setTimeout(resolve, 500));
          const messagesRes = await chatAPI.getMessages(newRoomId, { limit: 10 });
          const messages = Array.isArray(messagesRes.data) ? messagesRes.data : [];
          if (messages.length > 0) {
            initialMessages = messages.map(msg => ({
              id: msg.id,
              role: msg.sender_type === 'user' ? 'user' : 'assistant',
              content: msg.content,
              timestamp: msg.created_at || new Date().toISOString()
            }));
            break;
          }
        }
      } catch (e) {
        console.warn('[MiniChat] Failed to load initial messages on reset:', e);
      }
      
      console.log('[MiniChat] Origchat plain mode reset complete:', { roomId: newRoomId });
      
      setChatSessions(prev => ({
        ...prev,
        [selectedCharId]: {
          roomId: newRoomId,
          messages: initialMessages
        }
      }));
      
      setInput('');
    } catch (e) {
      console.error('[MiniChat] 원작챗 일대일 모드 초기화 실패:', e);
      alert('대화 초기화에 실패했습니다.');
    }
  };

  // 메시지 전송 (원작챗 turn)
  const handleSend = async () => {
    console.log('[MiniChat] handleSend called:', { input: input.trim(), sending, selectedCharId, session: chatSessions[selectedCharId] });
    
    if (!input.trim() || sending || !selectedCharId) {
      console.log('[MiniChat] Early return:', { hasInput: !!input.trim(), sending, selectedCharId });
      return;
    }
    
    // 세션이 초기화 중이면 대기
    if (initializingSessions.has(selectedCharId)) {
      console.log('[MiniChat] Session is initializing, please wait...');
      alert('채팅 세션이 초기화 중입니다. 잠시만 기다려주세요.');
      return;
    }
    
    const session = chatSessions[selectedCharId];
    if (!session?.roomId) {
      console.error('[MiniChat] No session or roomId:', { session, selectedCharId, chatSessions });
      alert('채팅 세션이 초기화되지 않았습니다. 잠시 후 다시 시도해주세요.');
      return;
    }
    
    console.log('[MiniChat] Sending message:', { roomId: session.roomId, userText: input.trim() });
    
    const userMsg = {
      id: Date.now(),
      role: 'user',
      content: input.trim(),
      timestamp: new Date().toISOString()
    };
    
    setChatSessions(prev => ({
      ...prev,
      [selectedCharId]: {
        ...prev[selectedCharId],
        messages: [...(prev[selectedCharId]?.messages || []), userMsg]
      }
    }));
    
    const currentInput = input;
    setInput('');
    setSending(true);
    
    try {
      // 원작챗 turn API 사용
      // 미니채팅방에서는 응답 길이를 짧게 제한
      const res = await origChatAPI.turn({
        room_id: session.roomId,
        user_text: currentInput.trim() || "계속",
        settings_patch: {
          response_length_pref: 'short'  // 짧은 응답으로 제한
        }
      });
      
      console.log('[MiniChat] Turn response:', res.data);
      
      // SendMessageResponse 형식: { user_message, ai_message: { content, ... }, meta }
      const aiContent = res.data?.ai_message?.content || res.data?.content || res.data?.message || '...';
      
      const aiMsg = {
        id: Date.now() + 1,
        role: 'assistant',
        content: aiContent,
        timestamp: new Date().toISOString()
      };
      
      setChatSessions(prev => ({
        ...prev,
        [selectedCharId]: {
          ...prev[selectedCharId],
          messages: [...(prev[selectedCharId]?.messages || []), aiMsg]
        }
      }));
    } catch (e) {
      console.error('[MiniChat] 메시지 전송 실패:', e);
      console.error('[MiniChat] Error details:', e.response?.data);
      const errorMsg = {
        id: Date.now() + 1,
        role: 'assistant',
        content: `죄송합니다. 메시지를 전송하는 중 오류가 발생했습니다: ${e.response?.data?.detail || e.message || '알 수 없는 오류'}`,
        timestamp: new Date().toISOString()
      };
      setChatSessions(prev => ({
        ...prev,
        [selectedCharId]: {
          ...prev[selectedCharId],
          messages: [...(prev[selectedCharId]?.messages || []), errorMsg]
        }
      }));
    } finally {
      setSending(false);
    }
  };

  // 메시지 자동 스크롤
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatSessions, selectedCharId]);

  // 창 닫을 때 초기화
  const handleClose = () => {
    setCharacters([]);
    setSelectedCharId(null);
    setChatSessions({});
    setInput('');
    onClose();
  };

  const selectedChar = characters.find(c => c.id === selectedCharId);
  const currentMessages = chatSessions[selectedCharId]?.messages || [];

  if (!open) return null;

  return (
    <div 
      className={`fixed right-0 top-0 h-full w-96 bg-gray-900 shadow-2xl flex flex-col border-l border-gray-700 transform transition-transform duration-300 ${
        open ? 'translate-x-0' : 'translate-x-full'
      }`}
      style={{ maxWidth: '100vw', zIndex: 9999 }}
    >
      {/* 헤더 - 닫기 버튼 */}
      <div className="bg-gray-900 p-3 flex items-center justify-end border-b border-gray-800">
        <button
          onClick={handleClose}
          className="text-gray-400 hover:text-white p-1 rounded transition-colors"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* 캐릭터 프로필 목록 (인스타 스토리 스타일) */}
      <div className="bg-gray-900 p-4 border-b border-gray-800 overflow-x-auto">
        {loading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="w-5 h-5 text-purple-500 animate-spin" />
          </div>
        ) : (
          <div className="flex gap-4">
            {characters.map(char => (
              <button
                key={char.id}
                onClick={() => setSelectedCharId(char.id)}
                className="flex flex-col items-center gap-2 flex-shrink-0"
              >
                <div className={`relative ${selectedCharId === char.id ? 'ring-2 ring-purple-500 ring-offset-2 ring-offset-gray-900' : ''} rounded-full`}>
                  {char.avatar_url ? (
                    <img 
                      src={resolveImageUrl(char.avatar_url) || char.avatar_url} 
                      alt={char.name}
                      className="w-16 h-16 rounded-full object-cover"
                    />
                  ) : (
                    <div className="w-16 h-16 rounded-full bg-purple-600 flex items-center justify-center text-white font-bold text-xl">
                      {char.name?.[0] || 'C'}
                    </div>
                  )}
                </div>
                <div className={`text-xs truncate max-w-[70px] ${selectedCharId === char.id ? 'text-purple-400 font-medium' : 'text-gray-400'}`}>
                  {char.name}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 선택된 캐릭터 정보 */}
      {selectedChar && (
        <div className="bg-gray-800 p-3 border-b border-gray-700">
          <div className="flex items-center gap-3">
            {selectedChar.avatar_url ? (
              <img 
                src={resolveImageUrl(selectedChar.avatar_url) || selectedChar.avatar_url} 
                alt={selectedChar.name}
                className="w-10 h-10 rounded-full object-cover"
              />
            ) : (
              <div className="w-10 h-10 rounded-full bg-purple-600 flex items-center justify-center text-white font-bold">
                {selectedChar.name?.[0] || 'C'}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <div className="text-white font-semibold truncate">{selectedChar.name}</div>
              <div className="text-xs text-gray-400 truncate">{selectedChar.description || ''}</div>
            </div>
            <button
              onClick={handleResetChat}
              className="text-gray-400 hover:text-white p-2 rounded transition-colors"
              title="대화 초기화"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* 메시지 영역 */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-gray-900">
        {characters.length === 0 && !loading ? (
          <div className="flex items-center justify-center h-full text-gray-500 text-sm">
            선택 가능한 캐릭터가 없습니다
          </div>
        ) : !selectedCharId ? (
          <div className="flex items-center justify-center h-full text-gray-500 text-sm">
            캐릭터를 선택하세요
          </div>
        ) : initializingSessions.has(selectedCharId) ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-400 text-sm gap-3">
            <Loader2 className="w-6 h-6 text-purple-500 animate-spin" />
            <div>채팅 세션을 초기화하는 중...</div>
            <div className="text-xs text-gray-500">잠시만 기다려주세요</div>
          </div>
        ) : !chatSessions[selectedCharId]?.roomId ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-400 text-sm gap-3">
            <Loader2 className="w-6 h-6 text-purple-500 animate-spin" />
            <div>채팅 세션을 준비하는 중...</div>
          </div>
        ) : currentMessages.length === 0 ? (
          <div className="flex items-center justify-center h-full text-gray-500 text-sm">
            {selectedChar ? `${selectedChar.name}와 대화를 시작하세요` : '캐릭터를 선택하세요'}
          </div>
        ) : (
          currentMessages.map(msg => (
            <div
              key={msg.id}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[75%] px-3 py-2 rounded-lg text-sm ${
                  msg.role === 'user'
                    ? 'bg-purple-600 text-white rounded-br-sm'
                    : 'bg-gray-800 text-gray-100 rounded-bl-sm'
                }`}
                style={{
                  wordBreak: 'break-word',
                  overflowWrap: 'break-word',
                  whiteSpace: 'pre-wrap'
                }}
              >
                {msg.content}
              </div>
            </div>
          ))
        )}
        {sending && (
          <div className="flex justify-start">
            <div className="bg-gray-800 text-gray-100 px-3 py-2 rounded-lg rounded-bl-sm">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* 입력 영역 */}
      <div className="p-4 bg-gray-900 border-t border-gray-800">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder={selectedChar ? `${selectedChar.name}에게 메시지 보내기...` : '메시지를 입력하세요...'}
            className="flex-1 bg-gray-800 text-white border border-gray-700 rounded-full px-3 py-1.5 text-xs focus:outline-none focus:border-purple-500"
            disabled={sending || !selectedCharId || initializingSessions.has(selectedCharId)}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || sending || !selectedCharId || initializingSessions.has(selectedCharId)}
            className="bg-purple-600 hover:bg-purple-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-white p-1.5 rounded-full transition-colors"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default MiniChatWindow;
