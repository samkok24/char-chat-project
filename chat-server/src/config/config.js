/**
 * 채팅 서버 설정
 */

module.exports = {
  // 서버 설정
  PORT: process.env.PORT || 3001,
  NODE_ENV: process.env.NODE_ENV || 'development',
  
  // Redis 설정
  REDIS_URL: process.env.REDIS_URL || 'redis://localhost:6379',
  
  // 백엔드 API 설정
  BACKEND_API_URL: process.env.BACKEND_API_URL || 'http://localhost:8000',
  
  // AI API 키
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  CLAUDE_API_KEY: process.env.CLAUDE_API_KEY,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  
  // JWT 설정
  JWT_SECRET_KEY: process.env.JWT_SECRET_KEY || 'your-super-secret-jwt-key-change-this-in-production',
  
  // 채팅 설정
  MAX_MESSAGE_LENGTH: 5000,
  MAX_ROOM_MEMBERS: 2, // 사용자 + 캐릭터
  MESSAGE_RATE_LIMIT: 10, // 분당 메시지 수 제한
  
  // AI 응답 설정
  AI_RESPONSE_TIMEOUT: 30000, // 30초
  DEFAULT_AI_MODEL: 'gemini-pro',
  DEFAULT_TEMPERATURE: 0.7,
  DEFAULT_MAX_TOKENS: 1000,
  
  // 로깅 설정
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',
  
  // 보안 설정
  CORS_ORIGINS: process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',') : ['*'],
  
  // 성능 설정
  SOCKET_PING_TIMEOUT: 60000,
  SOCKET_PING_INTERVAL: 25000,
  
  // Redis 키 접두사
  REDIS_KEYS: {
    USER_SESSION: 'user_session:',
    CHAT_ROOM: 'chat_room:',
    MESSAGE_CACHE: 'message_cache:',
    RATE_LIMIT: 'rate_limit:',
    AI_CONTEXT: 'ai_context:'
  }
};

