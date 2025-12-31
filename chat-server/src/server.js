/**
 * AI 캐릭터 챗 플랫폼 - 실시간 채팅 서버
 */

const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
require('dotenv').config();

const config = require('./config/config');
const socketHandler = require('./controllers/socketController');
const authMiddleware = require('./middleware/authMiddleware');
const redisClient = require('./services/redisService');
const logger = require('./utils/logger');
const axios = require('axios');
// Express 앱 생성
const app = express();
const server = createServer(app);

// Socket.IO 서버 생성
const io = new Server(server, {
  cors: {
    origin: "*", // 개발용 - 프로덕션에서는 특정 도메인만 허용
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ['websocket', 'polling'],
  pingTimeout: 60000,
  pingInterval: 25000
});

// 미들웨어 설정
app.use(helmet());
app.use(compression());
app.use(cors({
  origin: "*", // 개발용
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// 로깅 설정
if (config.NODE_ENV === 'development') {
  app.use(morgan('dev'));
} else {
  app.use(morgan('combined'));
}

// 기본 라우트
app.get('/', (req, res) => {
  res.json({
    message: 'AI 캐릭터 챗 플랫폼 - 실시간 채팅 서버',
    version: '1.0.0',
    status: 'running',
    timestamp: new Date().toISOString()
  });
});

// 헬스 체크
app.get('/health', async (req, res) => {
  try {
    // Redis 연결 확인
    await redisClient.ping();
    
    res.json({
      status: 'healthy',
      redis: 'connected',
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Health check failed:', error);
    res.status(500).json({
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Socket.IO 연결 처리
io.use(authMiddleware.authenticateSocket);

io.on('connection', (socket) => {
  logger.info(`사용자 연결: ${socket.userId} (${socket.id})`);
  
  // 소켓 이벤트 핸들러 등록
  socketHandler.handleConnection(socket, io);
  
  // 연결 해제 처리
  socket.on('disconnect', (reason) => {
    logger.info(`사용자 연결 해제: ${socket.userId} (${socket.id}) - ${reason}`);
    socketHandler.handleDisconnection(socket, io);
  });
});

// 에러 핸들링
app.use((err, req, res, next) => {
  logger.error('Express error:', err);
  res.status(500).json({
    error: '서버 내부 오류가 발생했습니다.',
    message: config.NODE_ENV === 'development' ? err.message : undefined
  });
});

// 404 핸들링
app.use((req, res) => {
  res.status(404).json({
    error: '요청한 리소스를 찾을 수 없습니다.'
  });
});

// 서버 시작
const PORT = config.PORT || 3001;

server.listen(PORT, '0.0.0.0', () => {
  logger.info(`🚀 채팅 서버가 포트 ${PORT}에서 실행 중입니다.`);
  logger.info(`환경: ${config.NODE_ENV}`);
  logger.info(`Redis URL: ${config.REDIS_URL}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM 신호를 받았습니다. 서버를 종료합니다...');
  server.close(() => {
    logger.info('서버가 종료되었습니다.');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  logger.info('SIGINT 신호를 받았습니다. 서버를 종료합니다...');
  server.close(() => {
    logger.info('서버가 종료되었습니다.');
    process.exit(0);
  });
});

/**
 * 치명 예외/리젝션 로깅을 사람이 읽을 수 있게 정리한다.
 * - Error 객체는 JSON.stringify 시 {}로 떨어지는 경우가 많아서(message/stack) 형태로 보강한다.
 */
const formatFatal = (err) => {
  try {
    if (!err) return { message: String(err) };
    if (err instanceof Error) {
      return { name: err.name, message: err.message, stack: err.stack };
    }
    if (typeof err === 'object') {
      // 가능한 정보는 최대한 노출(순환 구조면 try/catch로 보호)
      return err;
    }
    return { message: String(err) };
  } catch (_) {
    return { message: 'unknown fatal error' };
  }
};

/**
 * Docker 환경(restart policy)에서 재시작이 걸려있으므로,
 * 프로세스는 종료하되 로그를 남기고 서버를 닫는 "베스트-에포트"를 수행한다.
 */
const gracefulFatalExit = (code = 1) => {
  try {
    // 새 연결 수락 중지(기존 연결은 강제 종료될 수 있음)
    server.close(() => {
      try { logger.info('서버가 종료되었습니다.'); } catch (_) {}
      process.exit(code);
    });
    // WebSocket 등으로 close 콜백이 지연될 수 있으니 강제 종료 타이머를 둔다.
    const t = setTimeout(() => {
      process.exit(code);
    }, 1500);
    // 프로세스가 다른 작업 없이도 종료되도록 unref
    try { t.unref(); } catch (_) {}
  } catch (_) {
    process.exit(code);
  }
};

// 처리되지 않은 예외 처리
process.on('uncaughtException', (error) => {
  try { logger.error('Uncaught Exception:', formatFatal(error)); } catch (_) {}
  gracefulFatalExit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  try { logger.error('Unhandled Rejection:', formatFatal(reason)); } catch (_) {}
  gracefulFatalExit(1);
});

module.exports = { app, server, io };

