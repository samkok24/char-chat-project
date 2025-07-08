/**
 * 채팅 페이지
 */

import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { charactersAPI, chatAPI } from '../lib/api';
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

const ChatPage = () => {
  const { characterId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  
  const [character, setCharacter] = useState(null);
  const [chatRoom, setChatRoom] = useState(null);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  
  const messagesEndRef = useRef(null);

  useEffect(() => {
    initializeChat();
  }, [characterId]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const initializeChat = async () => {
    setLoading(true);
    setError('');
    try {
      // 캐릭터 정보 로드
      const characterResponse = await charactersAPI.getCharacter(characterId);
      setCharacter(characterResponse.data);

      // 채팅방 생성 또는 기존 채팅방 가져오기
      const roomResponse = await chatAPI.createChatRoom({
        character_id: characterId
      });
      const currentRoom = roomResponse.data;
      setChatRoom(currentRoom);

      // 채팅 기록 로드
      if (currentRoom.id) {
        const messagesResponse = await chatAPI.getMessages(currentRoom.id);
        setMessages(messagesResponse.data);
      }
    } catch (error) {
      console.error('채팅 초기화 실패:', error);
      setError('채팅방을 불러올 수 없습니다. 페이지를 새로고침 해주세요.');
    } finally {
      setLoading(false);
    }
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const sendMessage = async (e) => {
    e.preventDefault();
    if (!newMessage.trim() || sending || !chatRoom) return;

    const messageContent = newMessage.trim();
    const tempUserMessageId = `temp-user-${Date.now()}`;
    
    // Optimistic UI Update
    setMessages(prev => [...prev, {
      id: tempUserMessageId,
      role: 'user',
      content: messageContent,
      created_at: new Date().toISOString()
    }]);
    setNewMessage('');
    setSending(true);
    setError('');

    try {
      const response = await chatAPI.sendMessage({
        character_id: characterId,
        content: messageContent
      });
      
      // Replace temp message and add AI response
      setMessages(prev => [
        ...prev.filter(m => m.id !== tempUserMessageId),
        response.data.user_message,
        response.data.ai_message
      ]);

    } catch (error) {
      console.error('메시지 전송 실패:', error);
      setError('메시지 전송에 실패했습니다. 다시 시도해주세요.');
      // Revert optimistic update on error
      setMessages(prev => prev.filter(m => m.id !== tempUserMessageId));
    } finally {
      setSending(false);
    }
  };

  const MessageBubble = ({ message }) => {
    const isUser = message.role === 'user';
    
    return (
      <div className={`flex items-start space-x-3 ${isUser ? 'flex-row-reverse space-x-reverse' : ''}`}>
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
        
        <div className={`max-w-xs lg:max-w-md px-4 py-2 rounded-lg ${
          isUser 
            ? 'bg-blue-600 text-white' 
            : 'bg-gray-100 text-gray-900'
        }`}>
          <p className="text-sm whitespace-pre-wrap">{message.content}</p>
          <p className={`text-xs mt-1 ${
            isUser ? 'text-blue-100' : 'text-gray-500'
          }`}>
            {new Date(message.created_at).toLocaleTimeString()}
          </p>
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-50 via-blue-50 to-indigo-50 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4" />
          <p className="text-gray-600">채팅방을 불러오는 중...</p>
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
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-blue-50 to-indigo-50 flex flex-col">
      {/* 헤더 */}
      <header className="bg-white/80 backdrop-blur-sm shadow-sm border-b">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center space-x-4">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate('/')}
                className="p-2"
              >
                <ArrowLeft className="w-5 h-5" />
              </Button>
              
              <div className="flex items-center space-x-3">
                <Avatar className="w-10 h-10">
                  <AvatarImage src={character?.avatar_url} alt={character?.name} />
                  <AvatarFallback className="bg-gradient-to-r from-purple-500 to-blue-500 text-white">
                    {character?.name?.charAt(0) || <Bot className="w-5 h-5" />}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <h1 className="text-lg font-semibold text-gray-900">
                    {character?.name}
                  </h1>
                  <p className="text-sm text-gray-500">
                    {character?.description ? 
                      (character.description.length > 50 ? 
                        character.description.substring(0, 50) + '...' : 
                        character.description) 
                      : 'AI 캐릭터'}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* 채팅 영역 */}
      <div className="flex-1 max-w-4xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-6">
        <Card className="h-full flex flex-col shadow-lg">
          {/* 메시지 목록 */}
          <CardContent className="flex-1 p-6 overflow-y-auto">
            {error && (
              <Alert variant="destructive" className="mb-4">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            
            <div className="space-y-4">
              {messages.length === 0 ? (
                <div className="text-center py-8">
                  <MessageCircle className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                  <p className="text-gray-500">
                    {character?.name}와의 대화를 시작해보세요!
                  </p>
                </div>
              ) : (
                messages.map((message) => (
                  <MessageBubble key={message.id} message={message} />
                ))
              )}
              
              {sending && (
                <div className="flex items-start space-x-3">
                  <Avatar className="w-8 h-8">
                    <AvatarFallback className="bg-gradient-to-r from-purple-500 to-blue-500 text-white">
                      {character?.name?.charAt(0) || <Bot className="w-4 h-4" />}
                    </AvatarFallback>
                  </Avatar>
                  <div className="bg-gray-100 px-4 py-2 rounded-lg">
                    <div className="flex items-center space-x-2">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span className="text-sm text-gray-600">입력 중...</span>
                    </div>
                  </div>
                </div>
              )}
              
              <div ref={messagesEndRef} />
            </div>
          </CardContent>

          {/* 메시지 입력 */}
          <div className="border-t p-4">
            <form onSubmit={sendMessage} className="flex space-x-2">
              <Input
                type="text"
                placeholder={`${character?.name}에게 메시지를 보내세요...`}
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                disabled={sending}
                className="flex-1"
                maxLength={1000}
              />
              <Button
                type="submit"
                disabled={!newMessage.trim() || sending}
                className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700"
              >
                <Send className="w-4 h-4" />
              </Button>
            </form>
          </div>
        </Card>
      </div>
    </div>
  );
};

export default ChatPage;

