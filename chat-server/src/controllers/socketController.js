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
    this.connectedUsers = new Map(); // userId -> socketId 매핑
    this.activeRooms = new Map(); // roomId -> room 정보 매핑
  }

  /**
   * 소켓 연결 처리
   */
  handleConnection(socket, io) {
    const userId = socket.userId;
    const userInfo = socket.userInfo;

    // 연결된 사용자 추가
    this.connectedUsers.set(userId, socket.id);

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
      // 연결된 사용자에서 제거
      this.connectedUsers.delete(userId);

      // Redis에서 세션 삭제
      redisService.deleteUserSession(userId);

      // 활성 룸에서 사용자 제거
      for (const [roomId, room] of this.activeRooms.entries()) {
        if (room.userId === userId) {
          this.activeRooms.delete(roomId);
          socket.leave(roomId);
        }
      }

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
    socket.on('send_message', (data) => this.handleSendMessage(socket, io, data));

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

      // 백엔드 API에서 채팅방 정보 확인
      const response = await axios.get(`${config.BACKEND_API_URL}/chat/rooms/${roomId}`, {
        headers: {
          'Authorization': `Bearer ${socket.token}`
        }
      });

      const room = response.data;

      // 권한 확인 (채팅방 소유자만 입장 가능)
      if (room.user_id !== userId) {
        socket.emit('error', { message: '이 채팅방에 접근할 권한이 없습니다.' });
        return;
      }

      // 소켓을 룸에 추가
      socket.join(roomId);

      // 활성 룸에 추가
      this.activeRooms.set(roomId, {
        roomId,
        userId,
        characterId: room.character_id,
        joinedAt: new Date().toISOString()
      });

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
      this.activeRooms.delete(roomId);

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
  async handleSendMessage(socket, io, data) {
    try {
      const { roomId, content, messageType = 'text' } = data;
      const userId = socket.userId;
      const userInfo = socket.userInfo;

      // 입력 검증
      if (!roomId || !content) {
        socket.emit('error', { message: '채팅방 ID와 메시지 내용이 필요합니다.' });
        return;
      }

      if (content.length > config.MAX_MESSAGE_LENGTH) {
        socket.emit('error', { message: `메시지는 ${config.MAX_MESSAGE_LENGTH}자를 초과할 수 없습니다.` });
        return;
      }

      // 속도 제한 확인
      const isAllowed = await redisService.checkRateLimit(userId);
      if (!isAllowed) {
        socket.emit('error', { message: '메시지 전송 속도 제한을 초과했습니다.' });
        return;
      }

      // 채팅방 정보 확인
      const room = this.activeRooms.get(roomId);
      if (!room || room.userId !== userId) {
        socket.emit('error', { message: '유효하지 않은 채팅방이거나 접근 권한이 없습니다.' });
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
        // 백엔드 API에서 AI 응답 생성 (이미 메시지 저장까지 처리함)
        const aiResponse = await axios.post(`${config.BACKEND_API_URL}/chat/messages`, {
          character_id: room.characterId,
          content
        }, {
          headers: {
            'Authorization': `Bearer ${socket.token}`
          }
        });

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
      } catch (apiError) {
        logger.error('AI 응답 생성 오류:', apiError.response?.data || apiError.message);
        io.to(roomId).emit('ai_typing_stop', { roomId });
        socket.emit('error', { message: 'AI 응답 생성 중 오류가 발생했습니다.' });
      }

    } catch (error) {
      logger.error('메시지 전송 처리 오류:', error);
      io.to(data.roomId).emit('ai_typing_stop', { roomId: data.roomId });
      socket.emit('error', { message: '메시지 전송 중 오류가 발생했습니다.' });
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

      const skip = (page - 1) * limit;

      // 백엔드 API에서 메시지 기록 조회
      const response = await axios.get(`${config.BACKEND_API_URL}/chat/rooms/${roomId}/messages`, {
        headers: { 'Authorization': `Bearer ${socket.token}` },
        params: { skip, limit }
      });

      const messages = response.data;

      // 백엔드 형식을 프론트엔드 형식으로 변환
      const formattedMessages = messages.map(msg => ({
        id: msg.id,
        roomId: roomId,
        senderType: msg.sender_type, // 그대로 사용 (user 또는 character)
        content: msg.content,
        timestamp: msg.created_at || msg.timestamp
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

