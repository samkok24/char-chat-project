"""
애플리케이션 설정
"""

from pydantic_settings import BaseSettings
from typing import Optional, List
import os


class Settings(BaseSettings):
    # 환경 설정 (추가됨)
    ENVIRONMENT: str = "development"
    DEBUG: bool = True  # DEBUG 필드 추가
    
    GEMINI_API_KEY: Optional[str] = None
    CLAUDE_API_KEY: Optional[str] = None
    OPENAI_API_KEY: Optional[str] = None
    IMAGEN_API_KEY: Optional[str] = None
    
    DATABASE_URL: str = "sqlite:///./data/test.db"  # 기본값 추가
    REDIS_URL: str = "redis://localhost:6379"  # 이 줄 추가!
    
    JWT_SECRET_KEY: str = "your-super-secret-jwt-key-change-this-in-production"  # 기본값 추가
    JWT_ALGORITHM: str = "HS256"
    JWT_ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    JWT_REFRESH_TOKEN_EXPIRE_DAYS: int = 7
    
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
        
        if not settings.GEMINI_API_KEY and not settings.CLAUDE_API_KEY:
            raise ValueError("AI API 키가 설정되지 않았습니다.")
    
    return True


# 설정 검증 실행
validate_settings()