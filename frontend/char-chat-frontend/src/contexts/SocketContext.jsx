/**
 * Socket.IO 컨텍스트
 */

import React, { createContext, useContext, useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { SOCKET_URL } from '../lib/api';
import { useAuth } from './AuthContext';

const SocketContext = createContext();

export const useSocket = () => {
  const context = useContext(SocketContext);
  if (!context) {
    throw new Error('useSocket must be used within a SocketProvider');
  }
  return context;
};

export const SocketProvider = ({ children }) => {
  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);
  const [currentRoom, setCurrentRoom] = useState(null);
  const [messages, setMessages] = useState([]);
  const [typingUsers, setTypingUsers] = useState([]);
  const [aiTyping, setAiTyping] = useState(false);
  const { user, isAuthenticated } = useAuth();

  // Socket 연결 설정
  useEffect(() => {
    if (isAuthenticated && user) {
      const token = localStorage.getItem('access_token');
      if (token) {
        const newSocket = io(SOCKET_URL, {
          auth: {
            token: token,
          },
          transports: ['websocket', 'polling'],
        });

        newSocket.on('connect', () => {
          console.log('Socket 연결됨:', newSocket.id);
          setConnected(true);
        });

        newSocket.on('disconnect', (reason) => {
          console.log('Socket 연결 해제:', reason);
          setConnected(false);
        });

        newSocket.on('connected', (data) => {
          console.log('서버 연결 확인:', data);
        });

        newSocket.on('error', (error) => {
          console.error('Socket 오류:', error);
        });

        // 채팅 이벤트 리스너
        newSocket.on('room_joined', (data) => {
          console.log('채팅방 입장:', data);
          setCurrentRoom(data.room);
        });

        newSocket.on('room_left', (data) => {
          console.log('채팅방 나감:', data);
          setCurrentRoom(null);
          setMessages([]);
        });

        newSocket.on('new_message', (message) => {
          console.log('새 메시지:', message);
          setMessages(prev => [...prev, message]);
        });

        newSocket.on('message_history', (data) => {
          console.log('메시지 기록:', data);
          if (data.page === 1) {
            setMessages(data.messages);
          } else {
            setMessages(prev => [...data.messages, ...prev]);
          }
        });

        newSocket.on('user_typing_start', (data) => {
          setTypingUsers(prev => {
            if (!prev.find(u => u.userId === data.userId)) {
              return [...prev, data];
            }
            return prev;
          });
        });

        newSocket.on('user_typing_stop', (data) => {
          setTypingUsers(prev => prev.filter(u => u.userId !== data.userId));
        });

        newSocket.on('ai_typing_start', (data) => {
          console.log('AI 타이핑 시작:', data);
          setAiTyping(true);
        });

        newSocket.on('ai_typing_stop', (data) => {
          console.log('AI 타이핑 종료:', data);
          setAiTyping(false);
        });

        newSocket.on('ai_error', (data) => {
          console.error('AI 오류:', data);
          setAiTyping(false);
        });

        setSocket(newSocket);

        return () => {
          newSocket.close();
        };
      }
    } else {
      // 인증되지 않은 경우 소켓 연결 해제
      if (socket) {
        socket.close();
        setSocket(null);
        setConnected(false);
        setCurrentRoom(null);
        setMessages([]);
      }
    }
  }, [isAuthenticated, user]);

  // 채팅방 입장
  const joinRoom = (roomId) => {
    if (socket && connected) {
      socket.emit('join_room', { roomId });
    }
  };

  // 채팅방 나가기
  const leaveRoom = (roomId) => {
    if (socket && connected) {
      socket.emit('leave_room', { roomId });
    }
  };

  // 메시지 전송
  const sendMessage = (roomId, content, messageType = 'text') => {
    if (socket && connected) {
      socket.emit('send_message', {
        roomId,
        content,
        messageType,
      });
    }
  };

  // 타이핑 상태 전송
  const startTyping = (roomId) => {
    if (socket && connected) {
      socket.emit('typing_start', { roomId });
    }
  };

  const stopTyping = (roomId) => {
    if (socket && connected) {
      socket.emit('typing_stop', { roomId });
    }
  };

  // 메시지 기록 요청
  const getMessageHistory = (roomId, page = 1, limit = 20) => {
    if (socket && connected) {
      socket.emit('get_message_history', { roomId, page, limit });
    }
  };

  const value = {
    socket,
    connected,
    currentRoom,
    messages,
    typingUsers,
    aiTyping,
    joinRoom,
    leaveRoom,
    sendMessage,
    startTyping,
    stopTyping,
    getMessageHistory,
    setMessages,
  };

  return (
    <SocketContext.Provider value={value}>
      {children}
    </SocketContext.Provider>
  );
};

