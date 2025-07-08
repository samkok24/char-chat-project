"""
인증 관련 Pydantic 스키마
"""

from pydantic import BaseModel
from typing import Optional
import uuid


class Token(BaseModel):
    """토큰 응답 스키마"""
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class TokenData(BaseModel):
    """토큰 데이터 스키마"""
    user_id: Optional[uuid.UUID] = None


class RefreshTokenRequest(BaseModel):
    """리프레시 토큰 요청 스키마"""
    refresh_token: str


class PasswordResetRequest(BaseModel):
    """패스워드 재설정 요청 스키마"""
    email: str


class PasswordResetConfirm(BaseModel):
    """패스워드 재설정 확인 스키마"""
    token: str
    new_password: str


class EmailVerificationRequest(BaseModel):
    """이메일 인증 요청 스키마"""
    token: str

