/**
 * 채팅 페이지
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useSocket } from '../contexts/SocketContext';
import { charactersAPI, chatAPI } from '../lib/api'; // chatAPI 임포트
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '../components/ui/avatar';
import { Alert, AlertDescription } from '../components/ui/alert';
import { 
  ArrowLeft, 
  Send, 
  Loader2,
  MessageCircle,
  User,
  Bot,
  AlertCircle
} from 'lucide-react';
import { Textarea } from '../components/ui/textarea'; // Textarea 추가

const ChatPage = () => {
  const { characterId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { 
    socket,
    connected, 
    messages, 
    aiTyping,
    joinRoom, 
    leaveRoom, 
    sendMessage: sendSocketMessage, 
    getMessageHistory,
    setMessages,
    historyLoading,
    hasMoreMessages,
    currentPage,
  } = useSocket();
  
  const [character, setCharacter] = useState(null);
  const [chatRoomId, setChatRoomId] = useState(null);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const prevHistoryLoadingRef = useRef();
  const chatContainerRef = useRef(null); // For scroll handling
  const prevScrollHeightRef = useRef(0); // For scroll position restoration

  useEffect(() => {
    const initializeChat = async () => {
      setLoading(true);
      setError('');
      try {
        // 1. 캐릭터 정보 로드
        const charResponse = await charactersAPI.getCharacter(characterId);
        setCharacter(charResponse.data);

        // 2. 🔥 채팅방 정보 가져오기 또는 생성 (CAVEDUCK 스타일)
        const roomResponse = await chatAPI.startChat(characterId);
        const roomId = roomResponse.data.id;
        
        setChatRoomId(roomId);

      } catch (err) {
        console.error('채팅 초기화 실패:', err);
        setError('채팅방을 불러올 수 없습니다. 페이지를 새로고침 해주세요.');
      } finally {
        setLoading(false);
      }
    };
    initializeChat();

    // 컴포넌트 언마운트 시 채팅방 나가기
    return () => {
      if (chatRoomId) {
        leaveRoom(chatRoomId);
      }
      setMessages([]); // 메시지 목록 초기화
    };
  }, [characterId, leaveRoom, setMessages]); // chatRoomId 제거

  useEffect(() => {
    // 소켓 연결 및 채팅방 정보 로드 완료 후 채팅방 입장
    if (connected && chatRoomId) {
        joinRoom(chatRoomId);
        getMessageHistory(chatRoomId, 1);
    }
  }, [connected, chatRoomId, joinRoom, getMessageHistory]);

  // Add this new useEffect block
  useEffect(() => {
    // historyLoading 상태가 true -> false로 변경될 때 인사말 주입 로직 실행
    if (prevHistoryLoadingRef.current && !historyLoading) {
      if (messages.length === 0 && character?.greeting) {
        const greetingMessage = {
          id: `greeting-${character.id}`,
          roomId: chatRoomId,
          senderType: 'assistant',
          senderId: character.id,
          content: character.greeting,
          created_at: new Date().toISOString(),
          isStreaming: false,
        };
        setMessages([greetingMessage]);
      }
    }
    // 현재 historyLoading 상태를 ref에 저장
    prevHistoryLoadingRef.current = historyLoading;
  }, [historyLoading, messages, character, chatRoomId, setMessages]);


  useEffect(() => {
    // 신규 메시지 수신 시 맨 아래로 스크롤
    if (messages.length > 0) {
      const lastMessage = messages[messages.length - 1];
      // 내가 보낸 메시지거나, 스트리밍이 아닌 AI 메시지일 때만 자동 스크롤
      if (lastMessage.senderType === 'user' || !lastMessage.isStreaming) {
         scrollToBottom();
      }
    }
  }, [messages]);
  
  useEffect(() => {
    // 과거 메시지 로드 후 스크롤 위치 복원
    if (chatContainerRef.current && prevScrollHeightRef.current) {
        chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight - prevScrollHeightRef.current;
        prevScrollHeightRef.current = 0; // Reset after use
    }
  }, [messages]);


  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    // Textarea 높이 자동 조절
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
      inputRef.current.style.height = `${inputRef.current.scrollHeight}px`;
    }
  }, [newMessage]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView(); // behavior: 'smooth' 제거하여 즉시 스크롤
  };
  
  const handleScroll = useCallback(() => {
    if (chatContainerRef.current) {
      const { scrollTop } = chatContainerRef.current;
      if (scrollTop === 0 && hasMoreMessages && !historyLoading) {
        prevScrollHeightRef.current = chatContainerRef.current.scrollHeight;
        getMessageHistory(chatRoomId, currentPage + 1);
      }
    }
  }, [hasMoreMessages, historyLoading, getMessageHistory, chatRoomId, currentPage]);


  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!newMessage.trim() || !chatRoomId || !connected) return;

    const messageContent = newMessage.trim();
    
    // Optimistic UI Update for user message
    const tempUserMessage = {
      id: `temp-user-${Date.now()}`,
      roomId: chatRoomId,
      senderType: 'user',
      senderId: user.id,
      content: messageContent,
      created_at: new Date().toISOString()
    };
    setMessages(prev => [...prev, tempUserMessage]);
    
    // Send message via socket
    sendSocketMessage(chatRoomId, messageContent);
    setNewMessage('');
    // 메시지 전송 후 textarea 높이 초기화
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage(e);
    }
  };
  
  const MessageBubble = ({ message, isLast }) => {
    const isUser = message.senderType === 'user';
    const bubbleRef = isLast ? messagesEndRef : null;

    return (
      <div ref={bubbleRef} className={`flex items-start space-x-3 ${isUser ? 'flex-row-reverse space-x-reverse' : ''}`}>
        <Avatar className="w-8 h-8 flex-shrink-0">
          {isUser ? (
            <AvatarFallback className="bg-blue-600 text-white">
              {user?.username?.charAt(0) || <User className="w-4 h-4" />}
            </AvatarFallback>
          ) : (
            <>
              <AvatarImage src={character?.avatar_url} alt={character?.name} />
              <AvatarFallback className="bg-gradient-to-r from-purple-500 to-blue-500 text-white">
                {character?.name?.charAt(0) || <Bot className="w-4 h-4" />}
              </AvatarFallback>
            </>
          )}
        </Avatar>
        
        <div
          className={`max-w-xs lg:max-w-md px-4 py-2 rounded-lg shadow-md ${
            isUser ? 'bg-blue-600 text-white' : 'bg-white text-gray-900'
          }`}
        >
          <p className="text-sm whitespace-pre-wrap">
            {message.content}
            {message.isStreaming && <span className="streaming-cursor"></span>}
          </p>
          <p
            className={`text-xs mt-1 text-right ${
              isUser ? 'text-blue-100' : 'text-gray-400'
            }`}
          >
            {new Date(message.created_at || message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </p>
        </div>
      </div>
    );
  };

  if (loading && !character) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-50 via-blue-50 to-indigo-50 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4" />
          <p className="text-gray-600">캐릭터 정보를 불러오는 중...</p>
        </div>
      </div>
    );
  }

  if (error && !character) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-50 via-blue-50 to-indigo-50 flex items-center justify-center">
        <div className="text-center">
          <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">오류가 발생했습니다</h3>
          <p className="text-gray-600 mb-4">{error}</p>
          <Button onClick={() => navigate('/')} variant="outline">
            홈으로 돌아가기
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-gray-50 flex flex-col">
      {/* 헤더 */}
      <header className="bg-white shadow-sm border-b z-10">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center space-x-2">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => navigate('/')}
                className="rounded-full"
              >
                <ArrowLeft className="w-5 h-5" />
              </Button>
              <div className="flex items-center space-x-3">
                <Avatar className="w-10 h-10 border-2 border-white shadow-sm">
                  <AvatarImage src={character?.avatar_url} alt={character?.name} />
                  <AvatarFallback className="bg-gradient-to-r from-purple-500 to-blue-500 text-white">
                    {character?.name?.charAt(0) || <Bot className="w-5 h-5" />}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <h1 className="text-md font-bold text-gray-900 leading-tight">
                    {character?.name}
                  </h1>
                  <p className="text-xs text-gray-500">
                    {aiTyping ? '입력 중...' : '온라인'}
                  </p>
                </div>
              </div>
            </div>
            {/* 여기에 메뉴 버튼 등을 추가할 수 있습니다. */}
          </div>
        </div>
      </header>

      {/* 채팅 영역 */}
      <main ref={chatContainerRef} onScroll={handleScroll} className="flex-1 overflow-y-auto p-4 md:p-6">
        <div className="max-w-4xl mx-auto space-y-6">
          {historyLoading && (
            <div className="flex justify-center py-4">
              <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
            </div>
          )}
          {error && (
            <Alert variant="destructive" className="mb-4">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {messages.length === 0 && !aiTyping ? (
            <div className="text-center py-8">
              <MessageCircle className="w-12 h-12 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-500">
                {character?.name}에게 첫 메시지를 보내보세요.
              </p>
              <p className="text-sm text-gray-400 mt-1">
                {character?.description}
              </p>
            </div>
          ) : (
            messages.map((message, index) => (
              <MessageBubble 
                key={message.id || `msg-${index}`} 
                message={message}
                isLast={index === messages.length - 1} 
              />
            ))
          )}
          <div ref={messagesEndRef} />
        </div>
      </main>

      {/* 입력 폼 */}
      <footer className="bg-white border-t p-2 md:p-4">
        <div className="max-w-4xl mx-auto">
          <form onSubmit={handleSendMessage} className="flex items-end space-x-2">
            <Textarea
              ref={inputRef}
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="메시지를 입력하세요..."
              className="flex-1 resize-none border-gray-300 rounded-lg shadow-sm focus:ring-blue-500 focus:border-blue-500 text-sm py-2 px-3"
              rows={1}
            />
            <Button
              type="submit"
              disabled={!newMessage.trim() || !connected}
              className="rounded-full w-10 h-10 p-0 flex-shrink-0"
              size="icon"
            >
              <Send className="w-5 h-5" />
            </Button>
          </form>
        </div>
      </footer>
    </div>
  );
};

export default ChatPage;

