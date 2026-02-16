/**
 * Socket.IO 컨텍스트
 */

import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { io } from 'socket.io-client';
import { SOCKET_URL } from '../lib/api';
import { useAuth } from './AuthContext';

// Session-scoped message cache (helps restore UI after tab discard / reconnect).
const CHAT_CACHE_PREFIX = 'cc:chat:msgcache:v1:';
const CHAT_CACHE_MAX = 200;

function getRoomIdFromMessage(m) {
  try {
    return String(m?.roomId || m?.room_id || m?.chat_room_id || '').trim();
  } catch (_) {
    return '';
  }
}

function getMessageKey(m) {
  try {
    const id = String(m?.id || m?._id || m?.message_id || '').trim();
    if (id) return `id:${id}`;
    const rid = getRoomIdFromMessage(m);
    const sender = String(m?.senderType || m?.sender_type || '').trim();
    const ts = String(m?.timestamp || m?.created_at || '').trim();
    const content = String(m?.content || '').trim().slice(0, 48);
    return `f:${rid}:${sender}:${ts}:${content}`;
  } catch (_) {
    return '';
  }
}

function guessRoomIdFromMessages(arr) {
  try {
    if (!Array.isArray(arr)) return '';
    for (const m of arr) {
      const rid = getRoomIdFromMessage(m);
      if (rid) return rid;
    }
  } catch (_) {}
  return '';
}

// Avoid persisting optimistic/local placeholders into the room cache.
function isLocalEphemeralMessage(m) {
  try {
    const id = String(m?.id || '').trim().toLowerCase();
    if (id.startsWith('temp-') || id.startsWith('optimistic-') || id.startsWith('local-')) return true;
    if (m?.pending === true) return true;
    if (m?.isStreaming === true) return true;
    return false;
  } catch (_) {
    return true;
  }
}

function filterCacheMessages(roomId, messages) {
  const rid = String(roomId || '').trim();
  const arr = Array.isArray(messages) ? messages : [];
  if (!rid || arr.length === 0) return [];
  const out = [];
  for (const m of arr) {
    const mrid = getRoomIdFromMessage(m);
    if (!mrid || mrid !== rid) continue;
    if (isLocalEphemeralMessage(m)) continue;
    out.push(m);
  }
  return out;
}

function mergeMessagesKeepOrder(baseArr, incomingArr) {
  const base = Array.isArray(baseArr) ? baseArr : [];
  const incoming = Array.isArray(incomingArr) ? incomingArr : [];
  if (base.length === 0) return incoming;
  if (incoming.length === 0) return base;

  const out = base.slice();
  const indexByKey = new Map();
  for (let i = 0; i < out.length; i += 1) {
    const k = getMessageKey(out[i]);
    if (k) indexByKey.set(k, i);
  }

  for (const msg of incoming) {
    const k = getMessageKey(msg);
    if (!k) {
      out.push(msg);
      continue;
    }
    const idx = indexByKey.get(k);
    if (typeof idx === 'number') {
      const prev = out[idx];
      const prevContent = String(prev?.content || '');
      const nextContent = String(msg?.content || '');
      const prevStreaming = Boolean(prev?.isStreaming);
      const nextStreaming = Boolean(msg?.isStreaming);
      if ((prevStreaming && !nextStreaming) || nextContent.length > prevContent.length) {
        out[idx] = { ...prev, ...msg, content: nextContent || prevContent };
      }
    } else {
      indexByKey.set(k, out.length);
      out.push(msg);
    }
  }

  return out;
}

function prependUnique(olderArr, existingArr) {
  const older = Array.isArray(olderArr) ? olderArr : [];
  const existing = Array.isArray(existingArr) ? existingArr : [];
  if (older.length === 0) return existing;
  if (existing.length === 0) return older;

  const existingKeys = new Set();
  for (const m of existing) {
    const k = getMessageKey(m);
    if (k) existingKeys.add(k);
  }

  const filtered = [];
  for (const m of older) {
    const k = getMessageKey(m);
    if (!k || !existingKeys.has(k)) filtered.push(m);
  }

  return [...filtered, ...existing];
}

function readRoomMessageCache(roomId) {
  try {
    const rid = String(roomId || '').trim();
    if (!rid) return [];
    const raw = sessionStorage.getItem(`${CHAT_CACHE_PREFIX}${rid}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    const arr = Array.isArray(parsed?.messages) ? parsed.messages : (Array.isArray(parsed) ? parsed : []);
    return Array.isArray(arr) ? arr : [];
  } catch (_) {
    return [];
  }
}

function writeRoomMessageCache(roomId, messages) {
  try {
    const rid = String(roomId || '').trim();
    if (!rid) return;
    const arr = filterCacheMessages(rid, messages);
    if (arr.length === 0) return;
    sessionStorage.setItem(
      `${CHAT_CACHE_PREFIX}${rid}`,
      JSON.stringify({ ts: Date.now(), messages: arr.slice(-CHAT_CACHE_MAX) })
    );
  } catch (_) {}
}

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
  const [socketError, setSocketError] = useState('');
  const { user, isAuthenticated } = useAuth();
  const currentRoomRef = useRef(null);
  const messagesRef = useRef([]);
  /**
   * ✅ 표시 대상(의도한) 룸 ID ref — 방 전환 레이스 방지
   *
   * 문제(재현: 두 브라우저/탭에서 같은 캐릭터로 A룸↔B룸을 빠르게 왕복):
   * - 소켓은 `new_message/message_history`를 roomId 기반으로 이벤트로 보내지만,
   *   클라이언트가 roomId를 확인하지 않고 `messages`에 append/overwrite 하면
   *   A룸 메시지가 B룸 화면에 섞여 보일 수 있다(신뢰도/데모 치명).
   *
   * 해결(최소 수정/롤백 용이):
   * - joinRoom/getMessageHistory/sendMessage 호출 "순간"에 이 ref를 갱신한다(= 사용자가 보고자 하는 룸).
   * - 소켓 수신 이벤트에서 roomId가 이 ref와 다르면 UI 상태(messages)를 건드리지 않는다.
   *
   * 방어:
   * - 이벤트 payload에 roomId가 없으면(레거시/예외) 기존 동작을 유지한다(필터 통과).
   */
  const desiredRoomIdRef = useRef(null);
  const userRef = useRef(user);
  const historyTimeoutRef = useRef(null);

  useEffect(() => { currentRoomRef.current = currentRoom; }, [currentRoom]);
  useEffect(() => { messagesRef.current = Array.isArray(messages) ? messages : []; }, [messages]);
  useEffect(() => { userRef.current = user; }, [user]);

  const setDesiredRoomId = useCallback((roomId) => {
    try {
      const rid = String(roomId || '').trim();
      if (!rid) return;
      desiredRoomIdRef.current = rid;
    } catch (_) {}
  }, []);

  const isDesiredRoom = useCallback((roomId) => {
    try {
      const rid = String(roomId || '').trim();
      const wanted = String(desiredRoomIdRef.current || currentRoomRef.current?.id || '').trim();
      // 필터 기준이 없으면 통과(초기/레거시)
      if (!wanted) return true;
      // 이벤트에 roomId가 없으면 기존 동작 유지(통과)
      if (!rid) return true;
      return rid === wanted;
    } catch (_) {
      return true;
    }
  }, []);

  /**
   * ✅ 히스토리 로딩 타임아웃 관리
   *
   * 문제:
   * - 소켓 서버가 error를 emit하거나(권한/404/백엔드 오류), connect_error로 연결 자체가 실패하면
   *   message_history 이벤트가 오지 않아 historyLoading이 영구 true가 될 수 있다.
   *
   * 해결(최소 수정/방어적):
   * - 일정 시간 내 message_history가 오지 않으면 로딩을 해제하고 원인을 UI에 노출한다.
   */
  const clearHistoryTimeout = useCallback(() => {
    try {
      if (historyTimeoutRef.current) clearTimeout(historyTimeoutRef.current);
    } catch (_) {}
    historyTimeoutRef.current = null;
  }, []);
  /**
   * 히스토리 타임아웃을 건다.
   *
   * 방어 의도:
   * - 입장이 이미 성공했거나(현재 룸 일치), 화면에 메시지가 이미 보이는 상태에서는
   *   "입장 지연" 오류를 띄우지 않는다.
   * - 즉, 실제 실패 케이스에서만 사용자 에러를 노출한다.
   */
  const armHistoryTimeout = useCallback((message = '메시지 기록을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.') => {
    clearHistoryTimeout();
    try {
      historyTimeoutRef.current = setTimeout(() => {
        let shouldSuppressError = false;
        try {
          const wantedRoomId = String(desiredRoomIdRef.current || '').trim();
          const currentRoomId = String(currentRoomRef.current?.id || '').trim();
          const arr = Array.isArray(messagesRef.current) ? messagesRef.current : [];

          const hasMessagesForWantedRoom = arr.some((m) => {
            const rid = String(m?.roomId || m?.room_id || m?.chat_room_id || '').trim();
            if (!wantedRoomId) return true;
            // optimistic/local 메시지는 roomId가 비어있을 수 있으므로 현재 표시 메시지로 인정
            if (!rid) return true;
            return rid === wantedRoomId;
          });
          const isAlreadyInWantedRoom = Boolean(wantedRoomId && currentRoomId && wantedRoomId === currentRoomId);
          shouldSuppressError = Boolean(hasMessagesForWantedRoom || isAlreadyInWantedRoom);
        } catch (_) {}
        setHistoryLoading(false);
        if (!shouldSuppressError) {
          setSocketError(message);
        }
      }, 8000);
    } catch (_) {}
  }, [clearHistoryTimeout]);

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
            setSocketError('');
            // 재연결 시 현재 방 자동 재-join 및 히스토리 복구
            const room = currentRoomRef.current;
            if (room && room.id) {
              try {
                // ✅ 표시 대상 룸을 먼저 지정(레이스 방지)
                setDesiredRoomId(room.id);
                setHasMoreMessages(true);
                setCurrentPage(1);

                // Best-effort: restore last known UI state immediately (e.g., after tab discard).
                try {
                  const cached = readRoomMessageCache(room.id);
                  if (Array.isArray(cached) && cached.length > 0) {
                    setMessages((prev) => {
                      const prevArr = Array.isArray(prev) ? prev : [];
                      const prevRid = guessRoomIdFromMessages(prevArr);
                      if (prevArr.length === 0) return cached;
                      if (prevRid && String(prevRid) !== String(room.id)) return cached;
                      return prevArr;
                    });
                  }
                } catch (_) {}

                setHistoryLoading(true);
                newSocket.emit('join_room', { roomId: room.id });
                newSocket.emit('get_message_history', { roomId: room.id, page: 1, limit: 50 });
                armHistoryTimeout('메시지 기록 복구가 지연되고 있습니다. 잠시 후 다시 시도해주세요.');
              } catch (_) {}
            }
          });

        newSocket.on('disconnect', (reason) => {
          if (reason !== 'io client disconnect') {
            console.log('Socket 연결 해제:', reason);
          }
          setConnected(false);
          // ✅ 로딩이 영구 유지되지 않도록 해제(재연결 시 다시 로드됨)
          setHistoryLoading(false);
          clearHistoryTimeout();
        });

        newSocket.on('connected', (data) => {
          console.log('서버 연결 확인:', data);
        });

        newSocket.on('error', (error) => {
          console.error('Socket 오류:', error);
          // ✅ 서버가 emit한 error는 message_history가 오지 않을 수 있으므로 로딩 해제 + 원인 노출
          setHistoryLoading(false);
          clearHistoryTimeout();
          setAiTyping(false);
          try {
            const msg = (error && (error.message || error.details)) ? String(error.message || error.details) : '';
            if (msg) setSocketError(msg);
          } catch (_) {}
        });

        // ✅ 인증/미들웨어 거부 등 연결 단계 오류는 connect_error로 온다.
        newSocket.on('connect_error', (err) => {
          console.error('Socket connect_error:', err);
          setConnected(false);
          setHistoryLoading(false);
          clearHistoryTimeout();
          setAiTyping(false);
          try {
            const msg = err?.message ? String(err.message) : '채팅 서버 연결에 실패했습니다.';
            setSocketError(msg);
          } catch (_) {
            setSocketError('채팅 서버 연결에 실패했습니다.');
          }
        });

        // 채팅 이벤트 리스너
        newSocket.on('room_joined', (data) => {
          console.log('채팅방 입장:', data);
          // ✅ 방어: 이전 join 응답이 늦게 도착해도 현재 표시 룸이 아니면 무시
          try {
            const rid = String(data?.roomId || data?.room?.id || '').trim();
            if (!isDesiredRoom(rid)) return;
            if (rid) setDesiredRoomId(rid);
          } catch (_) {}
          // room_joined가 오면 "입장 지연" 타임아웃은 종료한다.
          clearHistoryTimeout();
          setHistoryLoading(false);
          setSocketError('');
          setCurrentRoom(data.room);
        });

        newSocket.on('room_left', (data) => {
          console.log('채팅방 나감:', data);
          // ✅ 방어: 이전 leave 응답이 늦게 도착해도 현재 표시 룸이 아니면 무시
          try {
            const rid = String(data?.roomId || '').trim();
            if (!isDesiredRoom(rid)) return;
          } catch (_) {}
          setCurrentRoom(null);
          // 소켓 재연결 중에도 UI가 공백이 되지 않도록 즉시 비우지 않음
          setHasMoreMessages(true); // 상태 초기화
          setCurrentPage(1); // 상태 초기화
        });

        newSocket.on('new_message', (message) => {
          console.log('새 메시지:', message);
          if (isSkipDirective(message)) return; // 스킵 지시문은 화면에 표시하지 않음
          // ✅ 방어: 현재 표시 룸이 아니면 메시지를 UI에 섞지 않는다.
          try {
            const rid = String(message?.roomId || message?.room_id || message?.chat_room_id || '').trim();
            if (!isDesiredRoom(rid)) return;
          } catch (_) {}
          // 메시지 실수신 시 stale 입장 오류 문구를 제거한다.
          setSocketError('');
          setMessages((prev) => {
            const prevArr = Array.isArray(prev) ? prev : [];
            const next = [...prevArr, message];
            try {
              const rid = getRoomIdFromMessage(message);
              if (rid) writeRoomMessageCache(rid, next);
            } catch (_) {}
            return next;
          });
        });

        newSocket.on('message_history', (data) => {
          console.log('메시지 기록:', data);
          // ✅ 방어: 방 전환 중 이전 방의 히스토리가 도착해도 덮어쓰지 않는다.
          try {
            const rid = String(data?.roomId || '').trim();
            if (!isDesiredRoom(rid)) return;
          } catch (_) {}
          const roomId = String(data?.roomId || '').trim();
          const filtered = Array.isArray(data.messages) ? data.messages.filter(m => !isSkipDirective(m)) : [];
          if (data.page === 1) {
            setMessages((prev) => {
              const prevArr = Array.isArray(prev) ? prev : [];
              const inc = Array.isArray(filtered) ? filtered : [];

              // SSOT: page=1 history is the canonical DB order. Replace local UI state when present.
              // Keep current UI only when the server returns an empty history (e.g. new=1 optimistic preview).
              if (inc.length === 0) {
                // If this is a different room (and we can tell), don't keep stale messages.
                try {
                  const prevRid = guessRoomIdFromMessages(prevArr);
                  if (prevRid && roomId && prevRid !== roomId) return [];
                } catch (_) {}
                return prevArr;
              }
              if (roomId && inc.length) writeRoomMessageCache(roomId, inc);
              return inc;
            });
          } else {
            setMessages((prev) => {
              const prevArr = Array.isArray(prev) ? prev : [];
              const inc = Array.isArray(filtered) ? filtered : [];

              // Room switch: never merge messages across rooms.
              try {
                const prevRid = guessRoomIdFromMessages(prevArr);
                if (prevRid && roomId && prevRid !== roomId) {
                  const next = inc;
                  if (roomId && next.length) writeRoomMessageCache(roomId, next);
                  return next;
                }
              } catch (_) {}

              const next = prependUnique(inc, prevArr);
              if (roomId && next.length) writeRoomMessageCache(roomId, next);
              return next;
            });
          }
          // 히스토리 수신 완료: stale 입장 오류 제거
          setSocketError('');
          setHasMoreMessages(data.hasMore);
          setCurrentPage(data.page);
          setHistoryLoading(false);
          clearHistoryTimeout();
        });

        newSocket.on('user_typing_start', (data) => {
          // ✅ 방어: 다른 방의 타이핑 표시가 섞이지 않게 한다.
          try { if (!isDesiredRoom(String(data?.roomId || '').trim())) return; } catch (_) {}
          setTypingUsers(prev => {
            if (!prev.find(u => u.userId === data.userId)) {
              return [...prev, data];
            }
            return prev;
          });
        });

        newSocket.on('user_typing_stop', (data) => {
          try { if (!isDesiredRoom(String(data?.roomId || '').trim())) return; } catch (_) {}
          setTypingUsers(prev => prev.filter(u => u.userId !== data.userId));
        });

        newSocket.on('ai_typing_start', (data) => {
          console.log('AI 타이핑 시작:', data);
          try { if (!isDesiredRoom(String(data?.roomId || '').trim())) return; } catch (_) {}
          setAiTyping(true);
        });

        newSocket.on('ai_typing_stop', (data) => {
          console.log('AI 타이핑 종료:', data);
          try { if (!isDesiredRoom(String(data?.roomId || '').trim())) return; } catch (_) {}
          setAiTyping(false);
        });

        // AI 메시지 스트리밍 처리
        newSocket.on('ai_message_chunk', (data) => {
          // ✅ 방어: 스트리밍 청크도 다른 방에 섞이지 않게 한다.
          try { if (!isDesiredRoom(String(data?.roomId || '').trim())) return; } catch (_) {}
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
          try {
            const rid = String(data?.roomId || '').trim();
            // roomId가 없다면(레거시) 메시지 id 기반 업데이트는 충돌 가능성이 낮으므로 통과
            if (rid && !isDesiredRoom(rid)) return;
          } catch (_) {}
          setMessages((prev) => {
            const prevArr = Array.isArray(prev) ? prev : [];
            const next = prevArr.map((m) =>
              m.id === data.id
                ? { ...m, content: data.content, isStreaming: false, meta: data.meta || m.meta }
                : m
            );
            try {
              const rid = String(data?.roomId || guessRoomIdFromMessages(next) || '').trim();
              if (rid) writeRoomMessageCache(rid, next);
            } catch (_) {}
            return next;
          });
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
          try { desiredRoomIdRef.current = null; } catch (_) {}
        };

        window.addEventListener('auth:tokenRefreshed', handleTokenRefreshed);
        window.addEventListener('auth:loggedOut', handleLoggedOut);

        return () => {
          window.removeEventListener('auth:tokenRefreshed', handleTokenRefreshed);
          window.removeEventListener('auth:loggedOut', handleLoggedOut);
          clearHistoryTimeout();
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
        setHistoryLoading(false);
        setSocketError('');
        clearHistoryTimeout();
      }
    }
  }, [isAuthenticated, user]);

  // 채팅방 입장
  const joinRoom = useCallback((roomId) => {
    if (socket && connected) {
      // ✅ 방 전환 레이스 방지: "내가 지금 보려는 룸"을 먼저 지정
      setDesiredRoomId(roomId);
      setSocketError('');
      // 기존 메시지를 즉시 비우지 않고, 입장+히스토리 동기화를 한 번에 처리한다.
      setHasMoreMessages(true);
      setCurrentPage(1);

      // Best-effort: restore cached messages so the UI doesn't appear "wiped" on resume.
      try {
        const cached = readRoomMessageCache(roomId);
        if (Array.isArray(cached) && cached.length > 0) {
          setMessages((prev) => {
            const prevArr = Array.isArray(prev) ? prev : [];
            const prevRid = guessRoomIdFromMessages(prevArr);
            if (prevArr.length === 0) return cached;
            if (prevRid && String(prevRid) !== String(roomId)) return cached;
            return prevArr;
          });
        }
      } catch (_) {}

      setHistoryLoading(true);
      socket.emit('join_room', { roomId });
      socket.emit('get_message_history', { roomId, page: 1, limit: 50 });
      armHistoryTimeout('메시지 기록을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.');
    }
  }, [socket, connected, setDesiredRoomId, armHistoryTimeout]);

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
      // ✅ 방어: 전송 대상 룸을 표시 룸으로 지정(빠른 전환 중 수신 섞임 방지)
      setDesiredRoomId(roomId);
    const needsJoin = !currentRoom || currentRoom?.id !== roomId;
      const payload = { roomId, content, messageType };
      // 설정 패치가 있으면 함께 전송 (백엔드 지원 시)
      if (options.settingsPatch) {
        payload.settings_patch = options.settingsPatch;
      }
      // ✅ UI kind(예: next_action) 전달: 서버는 허용된 값만 반영한다.
      if (options.clientMessageKind) {
        payload.client_message_kind = options.clientMessageKind;
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
        // ✅ join_room 응답(room_joined)이 오지 않으면 Promise가 영구 pending 되는 문제 방지
        // - 네트워크 지연/서버 이슈에서도 UI가 "멈춘 것처럼" 보이지 않게 한다.
        let finished = false;
        let joinTimeout = null;
        const once = (data) => {
          if (finished) return;
          // roomId가 일치할 때만 전송 진행
          if (data?.roomId !== roomId) return;
          finished = true;
          try { if (joinTimeout) clearTimeout(joinTimeout); } catch (_) {}
          try { socket.off('room_joined', once); } catch (_) {}
          doSend();
        };
        socket.on('room_joined', once);
        // join 응답이 일정 시간 내로 오지 않으면 실패 처리
        joinTimeout = setTimeout(() => {
          if (finished) return;
          finished = true;
          try { socket.off('room_joined', once); } catch (_) {}
          reject(new Error('join_timeout'));
        }, 3000);
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
      // ✅ 방어: 히스토리 요청 시점에 표시 룸을 지정(레이스 방지)
      setDesiredRoomId(roomId);
      setSocketError('');
      setHistoryLoading(true);
      socket.emit('get_message_history', { roomId, page, limit });
      armHistoryTimeout('메시지 기록을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.');
    }
  }, [socket, connected, historyLoading, setDesiredRoomId, armHistoryTimeout]);

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
    socketError,
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
