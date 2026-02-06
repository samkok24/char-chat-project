/**
 * Socket.IO 컨트롤러
 */

const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const config = require('../config/config');
const logger = require('../utils/logger');
const redisService = require('../services/redisService');
const aiService = require('../services/aiService');
const authMiddleware = require('../middleware/authMiddleware');

class SocketController {
  constructor() {
    /**
     * ✅ 멀티 디바이스(모바일/PC) 방어
     *
     * 기존 문제:
     * - userId -> socketId 단일 매핑 + disconnect 시 userId 기준으로 activeRooms를 통째로 정리
     * - 유저가 여러 기기에서 동시에 접속한 상태에서 한쪽이 끊기면,
     *   다른 기기에서도 activeRooms가 날아가 `send_message/continue`가 forbidden_room으로 막힐 수 있었다.
     *
     * 해결(최소 수정/방어적):
     * - connectedUsers: userId -> Set(socketId)
     * - activeRooms: roomId -> { userId, characterId, sockets:Set(socketId), ... }
     * - disconnect/leave는 "해당 socket"만 제거하고, sockets가 0일 때만 room 엔트리를 제거한다.
     */
    this.connectedUsers = new Map(); // userId -> Set(socketId)
    this.activeRooms = new Map(); // roomId -> { roomId, userId, characterId, sockets:Set(socketId), joinedAt }
  }

  /**
   * room 데이터를 Redis/백엔드에서 안전하게 가져온다.
   * - activeRooms가 비어있는(서버 재시작/레이스) 상황에서도 전송이 막히지 않도록 폴백한다.
   */
  async _getRoomData(socket, roomId) {
    try {
      // 1) Redis 캐시
      const cached = await redisService.getChatRoom(roomId);
      if (cached && typeof cached === 'object') return cached;
    } catch (_) {}
    // 2) 백엔드 API
    const response = await axios.get(`${config.BACKEND_API_URL}/chat/rooms/${roomId}`, {
      headers: { 'Authorization': `Bearer ${socket.token}` }
    });
    const room = response?.data;
    try { if (room) await redisService.setChatRoom(roomId, room); } catch (_) {}
    return room;
  }

  /**
   * 소켓이 해당 room에 참여/권한이 있는지 보장하고, activeRooms 엔트리를 구성한다.
   * - 멀티 디바이스/재연결/레이스 상황에서도 안정적으로 동작하도록 방어한다.
   */
  async _ensureActiveRoomEntry(socket, roomId) {
    const userId = socket.userId;
    const existing = this.activeRooms.get(roomId);

    // 1) 이미 엔트리가 있고 같은 유저면: 소켓만 등록/조인 보강
    if (existing && existing.userId === userId) {
      try {
        if (!existing.sockets) existing.sockets = new Set();
        existing.sockets.add(socket.id);
      } catch (_) {}
      try {
        if (!socket.rooms?.has(roomId)) socket.join(roomId);
      } catch (_) {}
      this.activeRooms.set(roomId, existing);
      return existing;
    }

    // 2) 없으면 Redis/백엔드에서 room 조회 후 권한 검증
    const room = await this._getRoomData(socket, roomId);
    if (!room) {
      const err = new Error('room_not_found');
      err._code = 'room_not_found';
      throw err;
    }
    if (room.user_id !== userId) {
      const err = new Error('forbidden_room');
      err._code = 'forbidden_room';
      throw err;
    }

    // 3) 조인 + 엔트리 생성
    try {
      if (!socket.rooms?.has(roomId)) socket.join(roomId);
    } catch (_) {}
    const entry = {
      roomId,
      userId,
      characterId: room.character_id,
      sockets: new Set([socket.id]),
      joinedAt: new Date().toISOString(),
    };
    this.activeRooms.set(roomId, entry);
    return entry;
  }

  /**
   * 소켓 연결 처리
   */
  handleConnection(socket, io) {
    const userId = socket.userId;
    const userInfo = socket.userInfo;

    // 연결된 사용자 추가
    try {
      const set = this.connectedUsers.get(userId) || new Set();
      set.add(socket.id);
      this.connectedUsers.set(userId, set);
    } catch (_) {
      this.connectedUsers.set(userId, new Set([socket.id]));
    }

    // 사용자를 개인 룸에 추가 (개인 알림용)
    socket.join(`user_${userId}`);

    // 이벤트 핸들러 등록
    this.registerEventHandlers(socket, io);

    // 연결 확인 메시지 전송
    socket.emit('connected', {
      message: '채팅 서버에 연결되었습니다.',
      userId: userId,
      username: userInfo.username,
      timestamp: new Date().toISOString()
    });

    logger.info(`사용자 ${userInfo.username}(${userId})가 연결되었습니다.`);
  }

  /**
   * 소켓 연결 해제 처리
   */
  handleDisconnection(socket, io) {
    const userId = socket.userId;
    
    if (userId) {
      // ✅ 멀티 디바이스: 해당 socket만 제거
      try {
        const set = this.connectedUsers.get(userId);
        if (set && set.delete) {
          set.delete(socket.id);
          if (set.size === 0) {
            this.connectedUsers.delete(userId);
            // 마지막 소켓이 끊긴 경우에만 Redis 세션 삭제(베스트 에포트)
            try { redisService.deleteUserSession(userId); } catch (_) {}
          } else {
            this.connectedUsers.set(userId, set);
          }
        }
      } catch (_) {}

      // 활성 룸에서 해당 socket만 제거
      try {
        for (const [roomId, room] of this.activeRooms.entries()) {
          if (!room) continue;
          const sockets = room.sockets;
          if (sockets && sockets.delete) {
            if (sockets.has(socket.id)) sockets.delete(socket.id);
            if (sockets.size === 0) {
              this.activeRooms.delete(roomId);
            } else {
              this.activeRooms.set(roomId, room);
            }
          } else {
            // 구버전 엔트리(방어): userId가 같으면 삭제하지 않고 유지(다른 소켓을 보호)
            if (room.userId === userId) {
              this.activeRooms.set(roomId, room);
            }
          }
          try { socket.leave(roomId); } catch (_) {}
        }
      } catch (_) {}

      logger.info(`사용자 ${userId}가 연결 해제되었습니다.`);
    }
  }

  /**
   * 이벤트 핸들러 등록
   */
  registerEventHandlers(socket, io) {
    // 채팅방 입장
    socket.on('join_room', (data) => this.handleJoinRoom(socket, io, data));

    // 채팅방 나가기
    socket.on('leave_room', (data) => this.handleLeaveRoom(socket, io, data));

    // 메시지 전송
    socket.on('send_message', (data, ack) => this.handleSendMessage(socket, io, data, ack));
    // 계속 진행하기
    socket.on('continue', (data, ack) => this.handleContinue(socket, io, data, ack));

    // 타이핑 상태
    socket.on('typing_start', (data) => this.handleTypingStart(socket, io, data));
    socket.on('typing_stop', (data) => this.handleTypingStop(socket, io, data));

    // 메시지 기록 요청
    socket.on('get_message_history', (data) => this.handleGetMessageHistory(socket, io, data));

    // 에러 처리
    socket.on('error', (error) => {
      logger.error(`소켓 오류 (${socket.userId}):`, error);
    });
  }

  /**
   * 채팅방 입장 처리
   */
  async handleJoinRoom(socket, io, data) {
    try {
      const { roomId } = data;
      const userId = socket.userId;

      if (!roomId) {
        socket.emit('error', { message: '채팅방 ID가 필요합니다.' });
        return;
      }

      // 백엔드/Redis에서 채팅방 정보 확인
      const room = await this._getRoomData(socket, roomId);

      // 권한 확인 (채팅방 소유자만 입장 가능)
      if (room.user_id !== userId) {
        socket.emit('error', { message: '이 채팅방에 접근할 권한이 없습니다.' });
        return;
      }

      // 소켓을 룸에 추가
      socket.join(roomId);

      // 활성 룸에 추가
      try {
        const existing = this.activeRooms.get(roomId);
        if (existing && existing.userId === userId) {
          if (!existing.sockets) existing.sockets = new Set();
          existing.sockets.add(socket.id);
          this.activeRooms.set(roomId, existing);
        } else {
          this.activeRooms.set(roomId, {
            roomId,
            userId,
            characterId: room.character_id,
            sockets: new Set([socket.id]),
            joinedAt: new Date().toISOString()
          });
        }
      } catch (_) {
        this.activeRooms.set(roomId, {
          roomId,
          userId,
          characterId: room.character_id,
          sockets: new Set([socket.id]),
          joinedAt: new Date().toISOString()
        });
      }

      // Redis에 룸 정보 캐시
      await redisService.setChatRoom(roomId, room);

      // 입장 확인 메시지
      socket.emit('room_joined', {
        roomId,
        room,
        message: '채팅방에 입장했습니다.',
        timestamp: new Date().toISOString()
      });

      logger.info(`사용자 ${userId}가 채팅방 ${roomId}에 입장했습니다.`);

    } catch (error) {
      logger.error('채팅방 입장 오류:', error);
      socket.emit('error', { 
        message: '채팅방 입장 중 오류가 발생했습니다.',
        details: error.response?.data?.detail || error.message
      });
    }
  }

  /**
   * 채팅방 나가기 처리
   */
  async handleLeaveRoom(socket, io, data) {
    try {
      const { roomId } = data;
      const userId = socket.userId;

      if (!roomId) {
        socket.emit('error', { message: '채팅방 ID가 필요합니다.' });
        return;
      }

      // 소켓에서 룸 제거
      socket.leave(roomId);

      // 활성 룸에서 제거
      try {
        const existing = this.activeRooms.get(roomId);
        if (existing && existing.userId === userId) {
          const sockets = existing.sockets;
          if (sockets && sockets.delete) {
            sockets.delete(socket.id);
            if (sockets.size === 0) this.activeRooms.delete(roomId);
            else this.activeRooms.set(roomId, existing);
          } else {
            // 구버전 엔트리는 안전하게 유지(다른 소켓 보호)
            this.activeRooms.set(roomId, existing);
          }
        }
      } catch (_) {}

      // 나가기 확인 메시지
      socket.emit('room_left', {
        roomId,
        message: '채팅방에서 나갔습니다.',
        timestamp: new Date().toISOString()
      });

      logger.info(`사용자 ${userId}가 채팅방 ${roomId}에서 나갔습니다.`);

    } catch (error) {
      logger.error('채팅방 나가기 오류:', error);
      socket.emit('error', { message: '채팅방 나가기 중 오류가 발생했습니다.' });
    }
  }

  /**
   * 메시지 전송 처리
   */
  async handleSendMessage(socket, io, data, ack) {
    const safeAck = (payload) => { try { if (typeof ack === 'function') ack(payload); } catch (_) {} };

    try {
      const { roomId, content, messageType = 'text', settings_patch, client_message_kind } = data || {};
      const userId = socket.userId;
      const userInfo = socket.userInfo;

      // 입력/권한 검증에서 "return" 하기 전에 반드시 ACK 실패로 종료
      if (!roomId || !content) {
        safeAck({ ok: false, error: 'missing_fields' });
        socket.emit('error', { message: '채팅방 ID와 메시지 내용이 필요합니다.' });
        return;
      }

      if (content.length > config.MAX_MESSAGE_LENGTH) {
        safeAck({ ok: false, error: 'too_long', max: config.MAX_MESSAGE_LENGTH });
        socket.emit('error', { message: `메시지는 ${config.MAX_MESSAGE_LENGTH}자를 초과할 수 없습니다.` });
        return;
      }

      // 속도 제한 확인
      const isAllowed = await redisService.checkRateLimit(userId);
      if (!isAllowed) {
        safeAck({ ok: false, error: 'rate_limited' });
        socket.emit('error', { message: '메시지 전송 속도 제한을 초과했습니다.' });
        return;
      }

      // ✅ 채팅방 정보/권한 확인(멀티 디바이스/재연결 방어)
      let room = null;
      try {
        room = await this._ensureActiveRoomEntry(socket, roomId);
      } catch (e) {
        const code = e?._code || e?.message;
        safeAck({ ok: false, error: code || 'forbidden_room' });
        const msg = (code === 'room_not_found')
          ? '채팅방을 찾을 수 없습니다.'
          : '유효하지 않은 채팅방이거나 접근 권한이 없습니다.';
        socket.emit('error', { message: msg });
        return;
      }

      // 사용자 메시지 생성
      const userMessage = {
        id: uuidv4(),
        roomId,
        senderType: 'user',
        senderId: userId,
        content,
        messageType,
        timestamp: new Date().toISOString(),
        senderName: userInfo.username
      };

      // 메시지 저장은 아래 AI 응답 생성 요청(/chat/messages)에서 함께 처리되므로
      // 별도의 선행 저장 호출을 제거합니다.

      // AI 응답 생성 시작 (AI 타이핑 시작)
      io.to(roomId).emit('ai_typing_start', { roomId });

      try {
        const timeoutMs = 60000;
        /**
         * ✅ 성능/지연 측정 로그(스모크 테스트용)
         *
         * 의도:
         * - "채팅이 느리다"는 체감 문제를 (1) socket 수신 → (2) backend 호출 → (3) 응답 수신 구간으로 쪼개서 본다.
         * - 특히 일반 캐릭터챗은 chat-server가 backend `/chat/messages` 응답을 기다리는 시간이 대부분이므로,
         *   이 구간(ms)을 정확히 남기면 원인(모델/DB/네트워크/타임아웃)을 빠르게 압축할 수 있다.
         *
         * 주의:
         * - 개발/운영 모두에서 도움이 되지만, 로그 과다를 피하려면 운영에선 필요 시 샘플링/레벨 조절 가능.
         */
        const t0 = Date.now();
        const contentLen = typeof content === 'string' ? content.length : 0;
        const settingsKeys = settings_patch && typeof settings_patch === 'object' ? Object.keys(settings_patch) : [];
        logger.info(`[chat] send_message -> backend start room=${roomId} user=${userId} char=${room?.characterId} len=${contentLen} type=${messageType} settingsKeys=${settingsKeys.join(',')}`);
        // 백엔드 API에서 AI 응답 생성 (이미 메시지 저장까지 처리함)
        const aiResponse = await axios.post(
          `${config.BACKEND_API_URL}/chat/messages`,
          {
            room_id: roomId,               // ✅ “현재 방” 정합성
            character_id: room.characterId,
            content,
            // ✅ 클라이언트 UI 목적(서버는 허용 값만 반영)
            client_message_kind: client_message_kind || undefined,
            // ✅ 프론트에서 넘어온 설정(temperature/응답길이 등)을 백엔드로 전달
            settings_patch: settings_patch || undefined,
          },
          {
            headers: { Authorization: `Bearer ${socket.token}` },
            timeout: timeoutMs,            // ✅ 옵션2 필수: 서버 타임아웃 기준
          }
        );
        const dt = Date.now() - t0;
        const status = aiResponse?.status;
        const aiLen = typeof aiResponse?.data?.ai_message?.content === 'string' ? aiResponse.data.ai_message.content.length : 0;
        logger.info(`[chat] send_message <- backend done room=${roomId} user=${userId} status=${status} dtMs=${dt} aiLen=${aiLen}`);

        safeAck({ ok: true });

        // ✅ 멀티 디바이스(PC/모바일) 동기화:
        // - 기존 구현은 AI 메시지만 브로드캐스트해서, 다른 기기에서는 "유저가 방금 보낸 메시지"가 보이지 않는 문제가 있었다.
        // - 백엔드 응답에 user_message가 포함될 때, 같은 room에 접속한 다른 소켓들에게도 유저 메시지를 먼저 전파한다.
        // - sender 본인은 프론트에서 낙관적 메시지를 이미 표시하므로(중복 방지) sender 제외(socket.to 사용).
        try {
          const savedUser = aiResponse?.data?.user_message;
          if (savedUser && savedUser.id && typeof savedUser.content === 'string') {
            const userMessageData = {
              id: savedUser.id,
              roomId,
              senderType: 'user',
              senderId: userId,
              senderName: userInfo.username,
              content: savedUser.content,
              messageType,
              timestamp: savedUser.created_at || new Date().toISOString(),
              message_metadata: savedUser.message_metadata || undefined,
            };
            socket.to(roomId).emit('new_message', userMessageData);
          }
        } catch (_) {}

        // AI 응답 생성 완료 (AI 타이핑 중지)
        io.to(roomId).emit('ai_typing_stop', { roomId });

        if (aiResponse.data && aiResponse.data.ai_message) {
          const aiMessage = aiResponse.data.ai_message;
          
          // AI 메시지를 룸의 모든 사용자에게 브로드캐스트
          const aiMessageData = {
            id: aiMessage.id,
            roomId,
            senderType: 'character', // assistant 대신 character 사용
            senderId: room.characterId,
            senderName: room.characterName || 'AI',
            content: aiMessage.content,
            timestamp: aiMessage.created_at || new Date().toISOString()
          };
          
          io.to(roomId).emit('new_message', aiMessageData);
        }

        // ✅ 엔딩 메시지(별도) 브로드캐스트: 즉시 UI에 표시되도록 한다.
        try {
          const ending = aiResponse?.data?.ending_message;
          if (ending && ending.id && typeof ending.content === 'string') {
            const endingData = {
              id: ending.id,
              roomId,
              senderType: 'character',
              senderId: room.characterId,
              senderName: room.characterName || 'AI',
              content: ending.content,
              timestamp: ending.created_at || new Date().toISOString(),
              message_metadata: ending.message_metadata || undefined,
            };
            io.to(roomId).emit('new_message', endingData);
          }
        } catch (_) {}
      } catch (apiError) {
        const status = apiError?.response?.status;
        safeAck({ ok: false, error: 'backend_failed', status });

        try {
          const detail = apiError?.response?.data?.detail;
          logger.error(`[chat] send_message backend_failed room=${roomId} user=${userId} status=${status} detail=${typeof detail === 'string' ? detail : ''} msg=${apiError.message}`);
        } catch (_) {
          logger.error('AI 응답 생성 오류:', apiError.response?.data || apiError.message);
        }
        io.to(roomId).emit('ai_typing_stop', { roomId });

        socket.emit('error', {
          message: 'AI 응답 생성 중 오류가 발생했습니다.',
          details: apiError?.response?.data?.detail || apiError.message
        });
      }

    } catch (error) {
      logger.error('메시지 전송 처리 오류:', error);
      safeAck({ ok: false, error: 'server_error' });
      io.to(data.roomId).emit('ai_typing_stop', { roomId: data.roomId });
      socket.emit('error', { message: '메시지 전송 중 오류가 발생했습니다.' });
    }
  }

  /**
   * 계속 진행하기 처리 (messageType='continue')
   */
  async handleContinue(socket, io, data, ack) {
    const safeAck = (payload) => { try { if (typeof ack === 'function') ack(payload); } catch (_) {} };

    try {
      const { roomId, settings_patch } = data || {};
      const userId = socket.userId;

      if (!roomId) {
        safeAck({ ok: false, error: 'missing_roomId' });
        socket.emit('error', { message: '채팅방 ID가 필요합니다.' });
        return;
      }

      // ✅ 채팅방 정보/권한 확인(멀티 디바이스/재연결 방어)
      let room = null;
      try {
        room = await this._ensureActiveRoomEntry(socket, roomId);
      } catch (e) {
        const code = e?._code || e?.message;
        safeAck({ ok: false, error: code || 'forbidden_room' });
        const msg = (code === 'room_not_found')
          ? '채팅방을 찾을 수 없습니다.'
          : '유효하지 않은 채팅방이거나 접근 권한이 없습니다.';
        socket.emit('error', { message: msg });
        return;
      }

      io.to(roomId).emit('ai_typing_start', { roomId });
      const timeoutMs = 60000;

      // 백엔드 REST API의 send_message(레거시)로 “계속” 지시를 보냄
      try {
        // 빈 문자열을 보내면 백엔드에서 is_continue 로직으로 처리되어
        // 사용자 메시지를 저장하지 않고 방금 응답을 이어서 작성함
        const resp = await axios.post(`${config.BACKEND_API_URL}/chat/messages`, {
          room_id: roomId, 
          character_id: room.characterId,
          content: '',
          settings_patch: settings_patch || undefined,
        }, 
          { headers: { Authorization: `Bearer ${socket.token}` }, timeout: timeoutMs },
        );

        safeAck({ ok: true });

        io.to(roomId).emit('ai_typing_stop', { roomId });
        const aiMessage = resp.data?.ai_message;
        if (aiMessage) {
          io.to(roomId).emit('new_message', {
            id: aiMessage.id,
            roomId,
            senderType: 'character',
            senderId: room.characterId,
            senderName: room.characterName || 'AI',
            content: aiMessage.content,
            timestamp: aiMessage.created_at || new Date().toISOString()
          });
        }
      } catch (e) {
        safeAck({ ok: false, error: 'continue_failed' });
        try { io.to(data?.roomId).emit('ai_typing_stop', { roomId: data?.roomId }); } catch (_) {}
        socket.emit('error', { message: '계속 진행 처리 중 오류가 발생했습니다.' });
      }
    } catch (error) {
      io.to(data?.roomId).emit('ai_typing_stop', { roomId: data?.roomId });
      socket.emit('error', { message: '계속 진행 처리 중 오류가 발생했습니다.' });
    }
  }

  /**
   * AI 응답 생성 (이제 사용되지 않음)
   */
  async generateAIResponse(socket, io, roomId, userMessage) {
    try {
      const room = this.activeRooms.get(roomId);
      if (!room) return;

      // 타이핑 상태 표시
      io.to(roomId).emit('ai_typing_start', {
        roomId,
        characterId: room.characterId
      });

      // 백엔드 API에서 캐릭터 정보 가져오기
      const characterResponse = await axios.get(`${config.BACKEND_API_URL}/characters/${room.characterId}`, {
        headers: {
          'Authorization': `Bearer ${socket.token}`
        }
      });

      const character = characterResponse.data;

      // AI 서비스를 통해 응답 생성
      const aiResponse = await aiService.generateCharacterResponse(
        character,
        userMessage.content,
        roomId
      );

      // AI 메시지 생성
      const aiMessage = {
        id: uuidv4(),
        roomId,
        senderType: 'character',
        senderId: room.characterId,
        content: aiResponse,
        messageType: 'text',
        timestamp: new Date().toISOString(),
        senderName: character.name,
        senderAvatarUrl: character.avatar_url
      };

      // 백엔드 API에 AI 메시지 저장
      try {
        await axios.post(`${config.BACKEND_API_URL}/chat/messages`, {
          room_id: roomId,
          content: aiResponse,
          message_type: 'text',
          sender_type: 'character',
          sender_id: room.characterId
        }, {
          headers: {
            'Authorization': `Bearer ${socket.token}`
          }
        });
      } catch (apiError) {
        logger.error('AI 메시지 저장 API 오류:', apiError);
      }

      // Redis에 AI 메시지 캐시
      await redisService.cacheMessage(roomId, aiMessage);

      // 타이핑 상태 종료
      io.to(roomId).emit('ai_typing_stop', {
        roomId,
        characterId: room.characterId
      });

      // AI 응답 전송
      io.to(roomId).emit('new_message', aiMessage);

      logger.info(`AI 응답 생성 완료: ${room.characterId} -> ${roomId}`);

    } catch (error) {
      logger.error('AI 응답 생성 오류:', error);
      
      // 타이핑 상태 종료
      io.to(roomId).emit('ai_typing_stop', {
        roomId,
        characterId: room.characterId
      });

      // 오류 메시지 전송
      io.to(roomId).emit('ai_error', {
        roomId,
        message: 'AI 응답 생성 중 오류가 발생했습니다.'
      });
    }
  }

  /**
   * 타이핑 시작 처리
   */
  handleTypingStart(socket, io, data) {
    const { roomId } = data;
    const userId = socket.userId;
    const userInfo = socket.userInfo;

    if (!roomId) return;

    socket.to(roomId).emit('user_typing_start', {
      roomId,
      userId,
      username: userInfo.username
    });
  }

  /**
   * 타이핑 종료 처리
   */
  handleTypingStop(socket, io, data) {
    const { roomId } = data;
    const userId = socket.userId;

    if (!roomId) return;

    socket.to(roomId).emit('user_typing_stop', {
      roomId,
      userId
    });
  }

  /**
   * 메시지 기록 조회 처리 (신규 추가)
   */
  async handleGetMessageHistory(socket, io, data) {
    try {
      const { roomId, page = 1, limit = 20 } = data;
      const userId = socket.userId;

      if (!roomId) {
        return socket.emit('error', { message: '채팅방 ID가 필요합니다.' });
      }

      // ✅ 최신 기준 페이지네이션(SSOT: DB)
      // - 백엔드 /chat/rooms/{roomId}/messages?tail=1 은 skip을 "최신에서의 오프셋"으로 해석한다.
      // - 프론트는 page 기반이므로 (page-1)*limit을 그대로 전달하면 된다.
      const skip = (page - 1) * limit;

      // 백엔드 API에서 메시지 기록 조회
      const response = await axios.get(`${config.BACKEND_API_URL}/chat/rooms/${roomId}/messages`, {
        headers: { 'Authorization': `Bearer ${socket.token}` },
        params: { skip, limit, tail: true }
      });

      const messages = response.data;

      // 백엔드 형식을 프론트엔드 형식으로 변환
      const formattedMessages = messages.map(msg => ({
        id: msg.id,
        roomId: roomId,
        senderType: msg.sender_type, // 그대로 사용 (user 또는 character)
        content: msg.content,
        timestamp: msg.created_at || msg.timestamp,
        message_metadata: msg.message_metadata || undefined,
      }));

      // 클라이언트에 메시지 기록 전송
      socket.emit('message_history', {
        roomId,
        messages: formattedMessages,
        page,
        limit,
        hasMore: messages.length === limit
      });

    } catch (error) {
      logger.error('메시지 기록 조회 오류:', error.response?.data || error.message);
      socket.emit('error', { 
        message: '메시지 기록을 불러오는 중 오류가 발생했습니다.',
        details: error.response?.data?.detail || error.message
      });
    }
  }
}

module.exports = new SocketController();
