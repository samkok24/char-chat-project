/**
 * 인증 미들웨어
 */

const jwt = require('jsonwebtoken');
const axios = require('axios');
const config = require('../config/config');
const logger = require('../utils/logger');
const redisService = require('../services/redisService');

class AuthMiddleware {
  /**
   * Socket.IO 연결 시 인증
   */
  async authenticateSocket(socket, next) {
    try {
      const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.replace('Bearer ', '');
      
      if (!token) {
        logger.warn('토큰이 제공되지 않음:', socket.id);
        return next(new Error('인증 토큰이 필요합니다.'));
      }

      // JWT 토큰 검증
      const decoded = jwt.verify(token, config.JWT_SECRET_KEY);
      const userId = decoded.sub;

      if (!userId) {
        logger.warn('유효하지 않은 토큰:', socket.id);
        return next(new Error('유효하지 않은 토큰입니다.'));
      }

      // 백엔드 API에서 사용자 정보 확인
      try {
        const response = await axios.get(`${config.BACKEND_API_URL}/auth/me`, {
          headers: {
            'Authorization': `Bearer ${token}`
          },
          timeout: 5000
        });

        const user = response.data;
        
        if (!user.is_active) {
          logger.warn('비활성화된 사용자:', userId);
          return next(new Error('비활성화된 계정입니다.'));
        }

        // 소켓에 사용자 정보 저장
        socket.userId = userId;
        socket.userInfo = user;
        socket.token = token;

        // Redis에 사용자 세션 저장
        await redisService.setUserSession(userId, {
          socketId: socket.id,
          userInfo: user,
          connectedAt: new Date().toISOString()
        });

        logger.info(`사용자 인증 성공: ${user.username} (${userId})`);
        next();

      } catch (apiError) {
        // ✅ 운영 방어: 원인 파악을 위해 status/url/detail을 로그에 남긴다(토큰은 절대 로그 금지)
        try {
          const status = apiError?.response?.status;
          const data = apiError?.response?.data;
          const url = apiError?.config?.url;
          const detail = (data && (data.detail || data.error)) ? String(data.detail || data.error) : '';
          logger.error('백엔드 API 사용자 확인 실패:', {
            status,
            url,
            detail: detail ? detail.slice(0, 300) : undefined,
          });
        } catch (_) {
          logger.error('백엔드 API 사용자 확인 실패:', apiError.message);
        }
        // 사용자에게는 최소한의 안내만 노출
        return next(new Error('사용자 정보를 확인할 수 없습니다.'));
      }

    } catch (error) {
      if (error.name === 'JsonWebTokenError') {
        logger.warn('JWT 토큰 오류:', error.message);
        return next(new Error('유효하지 않은 토큰입니다.'));
      } else if (error.name === 'TokenExpiredError') {
        logger.warn('만료된 토큰:', socket.id);
        return next(new Error('만료된 토큰입니다.'));
      } else {
        logger.error('인증 오류:', error);
        return next(new Error('인증 처리 중 오류가 발생했습니다.'));
      }
    }
  }

  /**
   * HTTP 요청 인증 (Express 미들웨어)
   */
  async authenticateHTTP(req, res, next) {
    try {
      const authHeader = req.headers.authorization;
      const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring(7) : null;

      if (!token) {
        return res.status(401).json({ error: '인증 토큰이 필요합니다.' });
      }

      const decoded = jwt.verify(token, config.JWT_SECRET_KEY);
      const userId = decoded.sub;

      if (!userId) {
        return res.status(401).json({ error: '유효하지 않은 토큰입니다.' });
      }

      // 백엔드 API에서 사용자 정보 확인
      try {
        const response = await axios.get(`${config.BACKEND_API_URL}/auth/me`, {
          headers: {
            'Authorization': `Bearer ${token}`
          },
          timeout: 5000
        });

        req.user = response.data;
        req.userId = userId;
        req.token = token;

        next();

      } catch (apiError) {
        logger.error('백엔드 API 사용자 확인 실패:', apiError.message);
        return res.status(401).json({ error: '사용자 정보를 확인할 수 없습니다.' });
      }

    } catch (error) {
      if (error.name === 'JsonWebTokenError') {
        return res.status(401).json({ error: '유효하지 않은 토큰입니다.' });
      } else if (error.name === 'TokenExpiredError') {
        return res.status(401).json({ error: '만료된 토큰입니다.' });
      } else {
        logger.error('HTTP 인증 오류:', error);
        return res.status(500).json({ error: '인증 처리 중 오류가 발생했습니다.' });
      }
    }
  }

  /**
   * 속도 제한 확인
   */
  async checkRateLimit(socket, next) {
    try {
      const userId = socket.userId;
      const isAllowed = await redisService.checkRateLimit(userId);

      if (!isAllowed) {
        logger.warn(`속도 제한 초과: ${userId}`);
        return next(new Error('메시지 전송 속도 제한을 초과했습니다.'));
      }

      next();
    } catch (error) {
      logger.error('속도 제한 확인 오류:', error);
      next(); // 오류 시 허용
    }
  }
}

module.exports = new AuthMiddleware();

