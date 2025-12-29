/**
 * Socket.IO 컨텍스트
 */

import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
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
  const [historyLoading, setHistoryLoading] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const { user, isAuthenticated } = useAuth();
  const currentRoomRef = useRef(null);
  const userRef = useRef(user);

  useEffect(() => { currentRoomRef.current = currentRoom; }, [currentRoom]);
  useEffect(() => { userRef.current = user; }, [user]);

  // 스킵(continue) 지시문 메시지를 UI에서 숨기기 위한 필터
  const isSkipDirective = useCallback((m) => {
    try {
      const type = (m && (m.messageType || m.type)) ? String(m.messageType || m.type).toLowerCase() : '';
      const isUser = (m && (m.senderType === 'user' || m.sender_type === 'user'));
      const content = String(m?.content || '').trim();
      if (!isUser) return false;
      if (type === 'continue') return true;
      // 알려진 지시문 문구 및 변형 패턴 필터링
      if (content === '유저 응답 없이 방금 대답을 이어서 작성해줘') return true;
      if (/유저\s*응답\s*없이/.test(content) && /이어/.test(content) && /작성/.test(content)) return true;
      if (/맥락/.test(content) && /이어서/.test(content)) return true;
      return false;
    } catch { return false; }
  }, []);

  // Socket 연결 설정
  useEffect(() => {
    if (isAuthenticated && user) {
      const token = localStorage.getItem('access_token');
      if (token) {
        const newSocket = io(SOCKET_URL, {
          auth: { token },
          transports: ['websocket', 'polling'],
          reconnection: true,
          reconnectionAttempts: 8,
          reconnectionDelay: 500,
          reconnectionDelayMax: 5000,
        });

        newSocket.on('connect', () => {
          console.log('Socket 연결됨:', newSocket.id);
          setConnected(true);
          // 재연결 시 현재 방 자동 재-join 및 히스토리 복구
          const room = currentRoomRef.current;
          if (room && room.id) {
            try {
              setHasMoreMessages(true);
              setCurrentPage(1);
              setHistoryLoading(true);
              newSocket.emit('join_room', { roomId: room.id });
              newSocket.emit('get_message_history', { roomId: room.id, page: 1, limit: 50 });
            } catch (_) {}
          }
        });

        newSocket.on('disconnect', (reason) => {
          if (reason !== 'io client disconnect') {
            console.log('Socket 연결 해제:', reason);
          }
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
          // 소켓 재연결 중에도 UI가 공백이 되지 않도록 즉시 비우지 않음
          setHasMoreMessages(true); // 상태 초기화
          setCurrentPage(1); // 상태 초기화
        });

        newSocket.on('new_message', (message) => {
          console.log('새 메시지:', message);
          if (isSkipDirective(message)) return; // 스킵 지시문은 화면에 표시하지 않음
          setMessages(prev => [...prev, message]);
        });

        newSocket.on('message_history', (data) => {
          console.log('메시지 기록:', data);
          const filtered = Array.isArray(data.messages) ? data.messages.filter(m => !isSkipDirective(m)) : [];
          if (data.page === 1) {
            setMessages(filtered);
          } else {
            setMessages(prev => [...filtered, ...prev]);
          }
          setHasMoreMessages(data.hasMore);
          setCurrentPage(data.page);
          setHistoryLoading(false);
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

        // AI 메시지 스트리밍 처리
        newSocket.on('ai_message_chunk', (data) => {
          setMessages(prev => {
            const existingMessageIndex = prev.findIndex(m => m.id === data.id);
            if (existingMessageIndex !== -1) {
              // 기존 메시지에 청크 추가
              const updatedMessages = [...prev];
              updatedMessages[existingMessageIndex] = {
                ...updatedMessages[existingMessageIndex],
                content: updatedMessages[existingMessageIndex].content + data.chunk,
                isStreaming: true,
              };
              return updatedMessages;
            } else {
              // 새 메시지로 추가
              return [...prev, {
                id: data.id,
                roomId: data.roomId,
                senderType: 'assistant',
                senderId: data.senderId,
                senderName: data.senderName,
                content: data.chunk,
                timestamp: data.timestamp,
                isStreaming: true,
              }];
            }
          });
        });

        newSocket.on('ai_message_end', (data) => {
          setMessages(prev => prev.map(m => 
            m.id === data.id 
              ? { ...m, content: data.content, isStreaming: false, meta: data.meta || m.meta }
              : m
          ));
        });

        newSocket.on('ai_error', (data) => {
          console.error('AI 오류:', data);
          setAiTyping(false);
        });

        setSocket(newSocket);

        // 토큰 갱신 시 소켓 인증 토큰 업데이트 및 재연결
        const handleTokenRefreshed = (e) => {
          const at = e?.detail?.access_token || localStorage.getItem('access_token');
          if (newSocket && at) {
            try {
              newSocket.auth = { token: at };
              // 소켓이 연결되어 있으면 재연결 시도
              if (newSocket.connected) {
                newSocket.disconnect();
              }
              newSocket.connect();
            } catch (_) {}
          }
        };
        const handleLoggedOut = () => {
          try {
            newSocket.close();
          } catch (_) {}
          setSocket(null);
          setConnected(false);
          setCurrentRoom(null);
          setMessages([]);
        };

        window.addEventListener('auth:tokenRefreshed', handleTokenRefreshed);
        window.addEventListener('auth:loggedOut', handleLoggedOut);

        return () => {
          window.removeEventListener('auth:tokenRefreshed', handleTokenRefreshed);
          window.removeEventListener('auth:loggedOut', handleLoggedOut);
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
  const joinRoom = useCallback((roomId) => {
    if (socket && connected) {
      // 기존 메시지를 즉시 비우지 않고 히스토리만 새로 요청
      setHasMoreMessages(true);
      setCurrentPage(1);
      setHistoryLoading(true);
      socket.emit('join_room', { roomId });
    }
  }, [socket, connected]);

  // 채팅방 나가기
  const leaveRoom = useCallback((roomId) => {
    if (socket && connected) {
      socket.emit('leave_room', { roomId });
    }
  }, [socket, connected]);

  // 메시지 전송
  const sendMessage = useCallback((roomId, content, messageType = 'text', options = {}) => {
    return new Promise((resolve, reject) => {
      if (!socket || !connected) {
        reject(new Error('not_connected'));
        return;
      }
    const needsJoin = !currentRoom || currentRoom?.id !== roomId;
      const payload = { roomId, content, messageType };
      // 설정 패치가 있으면 함께 전송 (백엔드 지원 시)
      if (options.settingsPatch) {
        payload.settings_patch = options.settingsPatch;
      }

    const doSend = () => {
      const ACK_TIMEOUT_MS = 65000;
      const ackTimeout = setTimeout(() => {
        // ACK 없으면 실패 처리(성공 처리 금지)
        reject(new Error('ack_timeout'));
      }, ACK_TIMEOUT_MS);

      const ack = (resp) => {
        clearTimeout(ackTimeout);
        if (!resp || resp.ok !== false) {
          resolve(resp || { ok: true });
        } else {
          reject(new Error(resp.error || 'send_failed'));
        }
      };

      if (messageType === 'continue') {
        // ✅ continue도 설정 패치(예: temperature/응답 길이)를 전달할 수 있게 확장
        const contPayload = { roomId };
        if (options.settingsPatch) contPayload.settings_patch = options.settingsPatch;
        socket.emit('continue', contPayload, ack);
      } else {
        socket.emit('send_message', payload, ack);
      }
    };

    if (needsJoin) {
      try {
        socket.emit('join_room', { roomId });
        const once = (data) => {
          try { if (data?.roomId === roomId) doSend(); } finally { socket.off('room_joined', once); }
        };
        socket.on('room_joined', once);
        // 안전장치: 1.5초 후 리스너 정리
        setTimeout(() => { try { socket.off('room_joined', once); } catch {} }, 1500);
        } catch(_) { reject(new Error('join_failed')); }
      return;
    }
    doSend();
    });
  }, [socket, connected, currentRoom]);

  // 타이핑 상태 전송
  const startTyping = useCallback((roomId) => {
    if (socket && connected) {
      socket.emit('typing_start', { roomId });
    }
  }, [socket, connected]);

  const stopTyping = useCallback((roomId) => {
    if (socket && connected) {
      socket.emit('typing_stop', { roomId });
    }
  }, [socket, connected]);

  // 메시지 기록 요청
  const getMessageHistory = useCallback((roomId, page = 1, limit = 50) => {
    if (socket && connected && !historyLoading) {
      setHistoryLoading(true);
      socket.emit('get_message_history', { roomId, page, limit });
    }
  }, [socket, connected, historyLoading]);

  const value = {
    socket,
    connected,
    currentRoom,
    messages,
    typingUsers,
    aiTyping,
    historyLoading,
    hasMoreMessages,
    currentPage,
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

