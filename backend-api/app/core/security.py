"""
보안 관련 유틸리티
"""

from datetime import datetime, timedelta
from typing import Optional, Union
from jose import JWTError, jwt
from passlib.context import CryptContext
from fastapi import HTTPException, status, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.models.user import User


# 패스워드 해싱 컨텍스트
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# JWT 토큰 스키마
security = HTTPBearer()


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """패스워드 검증"""
    return pwd_context.verify(plain_password, hashed_password)


def get_password_hash(password: str) -> str:
    """패스워드 해싱"""
    return pwd_context.hash(password)


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    """액세스 토큰 생성"""
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=settings.JWT_ACCESS_TOKEN_EXPIRE_MINUTES)
    
    to_encode.update({"exp": expire, "type": "access"})
    encoded_jwt = jwt.encode(to_encode, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)
    return encoded_jwt


def create_refresh_token(data: dict) -> str:
    """리프레시 토큰 생성"""
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(days=settings.JWT_REFRESH_TOKEN_EXPIRE_DAYS)
    to_encode.update({"exp": expire, "type": "refresh"})
    encoded_jwt = jwt.encode(to_encode, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)
    return encoded_jwt


def verify_token(token: str, token_type: str = "access") -> Optional[dict]:
    """토큰 검증"""
    try:
        payload = jwt.decode(token, settings.JWT_SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
        if payload.get("type") != token_type:
            return None
        return payload
    except JWTError:
        return None


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: AsyncSession = Depends(get_db)
) -> User:
    """현재 사용자 가져오기"""
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="인증 정보가 유효하지 않습니다.",
        headers={"WWW-Authenticate": "Bearer"},
    )
    
    try:
        token = credentials.credentials
        payload = verify_token(token, "access")
        if payload is None:
            raise credentials_exception
        
        user_id: str = payload.get("sub")
        if user_id is None:
            raise credentials_exception
            
    except JWTError:
        raise credentials_exception
    
    # 데이터베이스에서 사용자 조회
    from app.services.user_service import get_user_by_id
    user = await get_user_by_id(db, user_id)
    if user is None:
        raise credentials_exception
    
    return user


async def get_current_active_user(current_user: User = Depends(get_current_user)) -> User:
    """활성 사용자 가져오기"""
    if not current_user.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="비활성화된 사용자입니다."
        )
    return current_user


def generate_verification_token(email: str) -> str:
    """이메일 인증 토큰 생성"""
    data = {"email": email, "type": "email_verification"}
    expire = datetime.utcnow() + timedelta(hours=24)  # 24시간 유효
    data.update({"exp": expire})
    return jwt.encode(data, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def verify_verification_token(token: str) -> Optional[str]:
    """이메일 인증 토큰 검증"""
    try:
        payload = jwt.decode(token, settings.JWT_SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
        if payload.get("type") != "email_verification":
            return None
        return payload.get("email")
    except JWTError:
        return None


def generate_password_reset_token(email: str) -> str:
    """패스워드 재설정 토큰 생성"""
    data = {"email": email, "type": "password_reset"}
    expire = datetime.utcnow() + timedelta(hours=1)  # 1시간 유효
    data.update({"exp": expire})
    return jwt.encode(data, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def verify_password_reset_token(token: str) -> Optional[str]:
    """패스워드 재설정 토큰 검증"""
    try:
        payload = jwt.decode(token, settings.JWT_SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
        if payload.get("type") != "password_reset":
            return None
        return payload.get("email")
    except JWTError:
        return None


async def get_current_user_optional(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
    db: AsyncSession = Depends(get_db)
) -> Optional[User]:
    """
    현재 사용자를 가져오지만, 필수는 아닙니다.
    토큰이 없거나 유효하지 않으면 None을 반환합니다.
    """
    if credentials is None:
        return None

    try:
        token = credentials.credentials
        payload = verify_token(token, "access")
        if payload is None:
            return None
        
        user_id: str = payload.get("sub")
        if user_id is None:
            return None
            
    except JWTError:
        return None
    
    # 순환 참조 방지를 위해 함수 내에서 임포트
    from app.services.user_service import get_user_by_id
    user = await get_user_by_id(db, user_id)
    
    return user

