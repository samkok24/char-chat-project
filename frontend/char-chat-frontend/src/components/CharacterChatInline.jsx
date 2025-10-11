import React, { useState, useEffect, useRef } from 'react';
import { chatAPI } from '../lib/api';
import { X, Send, Loader2, Bot } from 'lucide-react';
import { Button } from './ui/button';
import { Avatar, AvatarImage, AvatarFallback } from './ui/avatar';

const CharacterChatInline = ({ 
  characterId, 
  characterName,
  characterAvatar,
  roomId, 
  initialContext,
  onClose 
}) => {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const containerRef = useRef(null);
  const pollingIntervalRef = useRef(null);

  // 메시지 로드 (HTTP 폴링)
  const loadMessages = async () => {
    try {
      const response = await chatAPI.getMessages(roomId);
      const newMessages = response.data || [];
      
      setMessages(prev => {
        // 중복 방지: ID 기반 필터링
        const existingIds = new Set(prev.map(m => m.id));
        const toAdd = newMessages.filter(m => !existingIds.has(m.id));
        
        if (toAdd.length > 0) {
          return newMessages; // 전체 메시지로 교체
        }
        return prev;
      });
      
      setLoading(false);
    } catch (err) {
      console.error('Failed to load messages:', err);
      setLoading(false);
    }
  };

  React.useEffect(() => {
    // roomId 바뀌면 이전 메시지 제거
    setMessages([]);
    setLoading(true);
  }, [roomId]);


  // 초기 로드 + 폴링 시작
  useEffect(() => {
    if (!roomId) return;
  
    // 기존 interval 정리 후 시작
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
  
    loadMessages();
    pollingIntervalRef.current = setInterval(loadMessages, 2000);
  
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
    };
  }, [roomId]);

  // 메시지 전송
  const handleSend = async () => {
    if (!input.trim() || sending) return;

    const messageContent = input.trim();
    setInput('');
    setSending(true);

    try {
      await chatAPI.sendMessage({
        character_id: characterId, 
        content: messageContent,
        room_id: roomId
      });

      // 전송 후 즉시 폴링 (빠른 피드백)
      setTimeout(loadMessages, 500);
    } catch (err) {
      console.error('Failed to send message:', err);
    } finally {
      setSending(false);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div 
      ref={containerRef}
      className="mt-6 border-2 border-purple-500/60 rounded-lg bg-gray-900/50 shadow-[0_0_16px_rgba(168,85,247,0.4)] flex flex-col"
      style={{ width: '900px', minHeight: '400px', height: '400px' }}
    >
      {/* 헤더 */}
      <div className="flex items-center justify-between px-4 py-2 bg-gray-800 border-b border-gray-700">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-gray-200">
            {characterName}와 대화 중...
          </span>
        </div>
        <button
          onClick={onClose}
          className="p-1 hover:bg-gray-700 rounded-full transition-colors text-gray-400 hover:text-white"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* 메시지 영역 */}
      <div className="px-4 py-4 flex-1 overflow-y-auto scrollbar-dark">
        {loading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="w-5 h-5 animate-spin text-purple-500" />
          </div>
        ) : (
          <>
            {messages.map((msg) => {
              const isUser = msg.sender_type === 'user';
              
              return (
                <div key={msg.id} className={`mt-2 mb-1 ${isUser ? 'flex flex-col items-end' : 'flex flex-col'}`}>
                  {/* 프로필 + 이름 */}
                  <div className={`flex items-center gap-1.5 ${isUser ? 'justify-end' : ''} mb-1`}>
                    {!isUser && (
                      <>
                        <Avatar className="w-6 h-6 rounded-full">
                          <AvatarImage src={characterAvatar} alt={characterName} className="object-cover" />
                          <AvatarFallback className="bg-gradient-to-r from-purple-500 to-blue-500 text-white text-xs">
                            {characterName?.charAt(0) || <Bot className="w-3 h-3" />}
                          </AvatarFallback>
                        </Avatar>
                        <span className="text-xs text-gray-400">{characterName}</span>
                      </>
                    )}
                  </div>
                  
                  {/* 말풍선 */}
                  <div
                    className={`max-w-full sm:max-w-[80%] px-2.5 py-1.5 rounded-xl shadow-sm ${
                      isUser ? 'rounded-tr-none bg-white text-black' : 'rounded-tl-none bg-white/10'
                    }`}
                  >
                    <p className="whitespace-pre-wrap text-xs leading-relaxed">
                      {msg.content}
                    </p>
                  </div>
                </div>
              );
            })}
          </>
        )}
      </div>

      {/* 입력창 */}
      <div className="px-4 pb-3">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="메시지 입력..."
            disabled={sending}
            className="flex-1 px-3 py-1.5 bg-gray-900 border border-gray-700 rounded-lg focus:border-purple-500 outline-none text-xs text-gray-200 placeholder-gray-500"
          />
          <Button
            onClick={handleSend}
            disabled={!input.trim() || sending}
            className="px-3 py-1.5 bg-purple-600 hover:bg-purple-700 disabled:opacity-50"
          >
            {sending ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Send className="w-3.5 h-3.5" />
            )}
          </Button>
        </div>
      </div>

      {/* 액션 버튼 */}
      <div className="flex justify-center pb-3">
        <button
          onClick={onClose}
          className="text-xs text-gray-400 hover:text-gray-300 transition-colors"
        >
          ← 추천 목록으로
        </button>
      </div>
    </div>
  );
};

export default CharacterChatInline;

