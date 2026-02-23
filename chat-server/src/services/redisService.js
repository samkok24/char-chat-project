/**
 * Redis 서비스
 */

const { createClient } = require('redis');
const config = require('../config/config');
const logger = require('../utils/logger');

class RedisService {
  constructor() {
    this.client = null;
    this.isConnected = false;
  }

  async connect() {
    try {
      this.client = createClient({
        url: config.REDIS_URL,
        socket: {
          reconnectStrategy: (retries) => {
            if (retries > 10) {
              logger.error('Redis 재연결 시도 횟수 초과');
              return false;
            }
            return Math.min(retries * 100, 3000);
          }
        }
      });

      this.client.on('error', (err) => {
        logger.error('Redis 클라이언트 오류:', err);
        this.isConnected = false;
      });

      this.client.on('connect', () => {
        logger.info('Redis에 연결되었습니다.');
        this.isConnected = true;
      });

      this.client.on('disconnect', () => {
        logger.warn('Redis 연결이 끊어졌습니다.');
        this.isConnected = false;
      });

      await this.client.connect();
      return this.client;
    } catch (error) {
      logger.error('Redis 연결 실패:', error);
      throw error;
    }
  }

  async disconnect() {
    if (this.client) {
      await this.client.disconnect();
      this.isConnected = false;
      logger.info('Redis 연결이 종료되었습니다.');
    }
  }

  // 기본 Redis 작업
  async set(key, value, expireInSeconds = null) {
    try {
      const stringValue = typeof value === 'object' ? JSON.stringify(value) : value;
      if (expireInSeconds) {
        await this.client.setEx(key, expireInSeconds, stringValue);
      } else {
        await this.client.set(key, stringValue);
      }
      return true;
    } catch (error) {
      logger.error('Redis SET 오류:', error);
      return false;
    }
  }

  async get(key) {
    try {
      const value = await this.client.get(key);
      if (value === null) return null;
      
      // JSON 파싱 시도
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    } catch (error) {
      logger.error('Redis GET 오류:', error);
      return null;
    }
  }

  async del(key) {
    try {
      return await this.client.del(key);
    } catch (error) {
      logger.error('Redis DEL 오류:', error);
      return 0;
    }
  }

  async exists(key) {
    try {
      return await this.client.exists(key);
    } catch (error) {
      logger.error('Redis EXISTS 오류:', error);
      return false;
    }
  }

  async ping() {
    try {
      return await this.client.ping();
    } catch (error) {
      logger.error('Redis PING 오류:', error);
      throw error;
    }
  }

  // 사용자 세션 관리
  async setUserSession(userId, sessionData, expireInSeconds = 3600) {
    const key = `${config.REDIS_KEYS.USER_SESSION}${userId}`;
    return await this.set(key, sessionData, expireInSeconds);
  }

  async getUserSession(userId) {
    const key = `${config.REDIS_KEYS.USER_SESSION}${userId}`;
    return await this.get(key);
  }

  async deleteUserSession(userId) {
    const key = `${config.REDIS_KEYS.USER_SESSION}${userId}`;
    return await this.del(key);
  }

  // 채팅방 관리
  async setChatRoom(roomId, roomData, expireInSeconds = 7200) {
    const key = `${config.REDIS_KEYS.CHAT_ROOM}${roomId}`;
    return await this.set(key, roomData, expireInSeconds);
  }

  async getChatRoom(roomId) {
    const key = `${config.REDIS_KEYS.CHAT_ROOM}${roomId}`;
    return await this.get(key);
  }

  async deleteChatRoom(roomId) {
    const key = `${config.REDIS_KEYS.CHAT_ROOM}${roomId}`;
    return await this.del(key);
  }

  // 메시지 캐시
  async cacheMessage(roomId, message, expireInSeconds = 3600) {
    const key = `${config.REDIS_KEYS.MESSAGE_CACHE}${roomId}`;
    try {
      await this.client.lPush(key, JSON.stringify(message));
      await this.client.lTrim(key, 0, 99); // 최근 100개 메시지만 유지
      await this.client.expire(key, expireInSeconds);
      return true;
    } catch (error) {
      logger.error('메시지 캐시 오류:', error);
      return false;
    }
  }

  async getCachedMessages(roomId, count = 20) {
    const key = `${config.REDIS_KEYS.MESSAGE_CACHE}${roomId}`;
    try {
      const messages = await this.client.lRange(key, 0, count - 1);
      return messages.map(msg => JSON.parse(msg));
    } catch (error) {
      logger.error('캐시된 메시지 조회 오류:', error);
      return [];
    }
  }

  // 속도 제한
  async checkRateLimit(userId, limit = config.MESSAGE_RATE_LIMIT, windowInSeconds = 60) {
    const key = `${config.REDIS_KEYS.RATE_LIMIT}${userId}`;
    try {
      const current = await this.client.incr(key);
      if (current === 1) {
        await this.client.expire(key, windowInSeconds);
      }
      return current <= limit;
    } catch (error) {
      logger.error('속도 제한 확인 오류:', error);
      return true; // 오류 시 허용
    }
  }

  // AI 컨텍스트 관리
  async setAIContext(roomId, context, expireInSeconds = 3600) {
    const key = `${config.REDIS_KEYS.AI_CONTEXT}${roomId}`;
    return await this.set(key, context, expireInSeconds);
  }

  async getAIContext(roomId) {
    const key = `${config.REDIS_KEYS.AI_CONTEXT}${roomId}`;
    return await this.get(key);
  }

  async deleteAIContext(roomId) {
    const key = `${config.REDIS_KEYS.AI_CONTEXT}${roomId}`;
    return await this.del(key);
  }
}

// 싱글톤 인스턴스 생성 및 연결
const redisService = new RedisService();
redisService.connect().catch(error => {
  logger.error('Redis 초기 연결 실패:', error);
});

module.exports = redisService;

