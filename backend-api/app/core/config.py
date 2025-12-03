"""
애플리케이션 설정
"""

from pydantic_settings import BaseSettings
from typing import Optional, List
import os
from pathlib import Path
from dotenv import load_dotenv


"""env 로딩 우선순위
1) OS 환경변수 (Render 대시보드 Environment 등)
2) 프로젝트 루트의 .env (repo/.env)
3) backend-api 디렉터리의 .env (repo/backend-api/.env)
"""

# .env 사전 로드 (OS 환경변수 우선, override=False)
_here = Path(__file__).resolve()
_repo_root_env = _here.parents[3] / ".env"  # repo/.env
_backend_env = _here.parents[2] / ".env"    # backend-api/.env
for _p in (_repo_root_env, _backend_env):
    try:
        if _p.exists():
            load_dotenv(dotenv_path=str(_p), override=False)
    except Exception:
        pass


class Settings(BaseSettings):
    """애플리케이션 설정"""
    # 환경 설정 (추가됨)
    ENVIRONMENT: str = "development"
    DEBUG: bool = True  # DEBUG 필드 추가
    # 기능 플래그
    ORIGCHAT_V2: bool = False
    
    # API 키 (없어도 부팅 가능하도록 Optional)
    GEMINI_API_KEY: str | None = None
    CLAUDE_API_KEY: str | None = None
    OPENAI_API_KEY: str | None = None
    IMAGEN_API_KEY: Optional[str] = None
    
    DATABASE_URL: str = "sqlite:///./data/test.db"  # 기본값 추가
    REDIS_URL: str = "redis://localhost:6379/0"
    
    # JWT
    JWT_SECRET_KEY: str = "your-super-secret-jwt-key-change-this-in-production"  # 기본값 추가
    JWT_ALGORITHM: str = "HS256"
    JWT_ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    JWT_REFRESH_TOKEN_EXPIRE_DAYS: int = 7
    
    # 이메일/SMTP
    SMTP_HOST: str | None = None
    SMTP_PORT: int = 587
    SMTP_USERNAME: str | None = None
    SMTP_PASSWORD: str | None = None
    SMTP_USE_TLS: bool = True
    SMTP_USE_SSL: bool = False
    EMAIL_FROM_ADDRESS: str = "no-reply@char-chat.local"
    EMAIL_FROM_NAME: str = "AI 캐릭터 챗"
    ADMIN_EMAIL: str | None = None  # 관리자 이메일 (1:1 문의 수신)
    FRONTEND_BASE_URL: str = "http://localhost:5173"
    EMAIL_VERIFICATION_REQUIRED: bool = True
    
    JOB_EXPIRATION_SECONDS: int = 3600 # 1 hour

    class Config:
        env_file = ".env"
        env_file_encoding = 'utf-8'
        extra = 'ignore'

settings = Settings()


# 환경별 설정 검증
def validate_settings():
    """설정 검증"""
    if settings.ENVIRONMENT == "production":
        if settings.JWT_SECRET_KEY == "your-super-secret-jwt-key-change-this-in-production":
            raise ValueError("프로덕션 환경에서는 JWT_SECRET_KEY를 변경해야 합니다.")
        
        # 프로덕션에서는 최소 1개 키 필요
        if not (settings.GEMINI_API_KEY or settings.CLAUDE_API_KEY or settings.OPENAI_API_KEY):
            raise ValueError("AI API 키(GEMINI/CLAUDE/OPENAI) 중 최소 1개는 필요합니다.")
    
    return True


# 설정 검증 실행
validate_settings()