"""
인증 관련 API 라우터
"""

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession
from datetime import timedelta

from app.core.database import get_db
from app.core.security import (
    verify_password, 
    get_password_hash, 
    create_access_token, 
    create_refresh_token,
    verify_token,
    get_current_user,
    generate_verification_token,
    verify_verification_token
)
from app.core.config import settings
from app.schemas.auth import Token, RefreshTokenRequest, PasswordResetRequest, EmailVerificationRequest
from app.schemas.user import UserCreate, UserLogin, UserResponse
from app.services.user_service import (
    get_user_by_email, 
    create_user, 
    update_user_verification_status
)

router = APIRouter()
security = HTTPBearer()


@router.post("/register", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def register(
    user_data: UserCreate,
    db: AsyncSession = Depends(get_db)
):
    """사용자 회원가입"""
    # 이메일 중복 확인
    existing_user = await get_user_by_email(db, user_data.email)
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="이미 등록된 이메일입니다."
        )
    
    # 패스워드 해싱
    hashed_password = get_password_hash(user_data.password)
    
    # 사용자 생성
    user = await create_user(
        db=db,
        email=user_data.email,
        username=user_data.username,
        password_hash=hashed_password
    )
    
    return user


@router.post("/login", response_model=Token)
async def login(
    user_data: UserLogin,
    db: AsyncSession = Depends(get_db)
):
    """사용자 로그인"""
    # 사용자 확인
    user = await get_user_by_email(db, user_data.email)
    if not user or not verify_password(user_data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="이메일 또는 패스워드가 올바르지 않습니다.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="비활성화된 계정입니다."
        )
    
    # 토큰 생성
    access_token_expires = timedelta(minutes=settings.JWT_ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": str(user.id)}, expires_delta=access_token_expires
    )
    refresh_token = create_refresh_token(data={"sub": str(user.id)})
    
    return {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "token_type": "bearer"
    }


@router.post("/refresh", response_model=Token)
async def refresh_token(
    token_data: RefreshTokenRequest,
    db: AsyncSession = Depends(get_db)
):
    """토큰 갱신"""
    # 리프레시 토큰 검증
    payload = verify_token(token_data.refresh_token, "refresh")
    if payload is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="유효하지 않은 리프레시 토큰입니다.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    user_id = payload.get("sub")
    if user_id is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="유효하지 않은 토큰입니다.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    # 새 토큰 생성
    access_token_expires = timedelta(minutes=settings.JWT_ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": user_id}, expires_delta=access_token_expires
    )
    refresh_token = create_refresh_token(data={"sub": user_id})
    
    return {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "token_type": "bearer"
    }


@router.get("/me", response_model=UserResponse)
async def get_current_user_info(
    current_user = Depends(get_current_user)
):
    """현재 사용자 정보 조회"""
    return current_user


@router.post("/verify-email")
async def verify_email(
    verification_data: EmailVerificationRequest,
    db: AsyncSession = Depends(get_db)
):
    """이메일 인증"""
    # 토큰 검증
    email = verify_verification_token(verification_data.token)
    if email is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="유효하지 않은 인증 토큰입니다."
        )
    
    # 사용자 찾기 및 인증 상태 업데이트
    user = await get_user_by_email(db, email)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="사용자를 찾을 수 없습니다."
        )
    
    if user.is_verified:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="이미 인증된 계정입니다."
        )
    
    await update_user_verification_status(db, user.id, True)
    
    return {"message": "이메일 인증이 완료되었습니다."}


@router.post("/send-verification-email")
async def send_verification_email(
    current_user = Depends(get_current_user)
):
    """인증 이메일 발송"""
    if current_user.is_verified:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="이미 인증된 계정입니다."
        )
    
    # 인증 토큰 생성
    verification_token = generate_verification_token(current_user.email)
    
    # TODO: 실제 이메일 발송 로직 구현
    # 현재는 토큰만 반환 (개발용)
    return {
        "message": "인증 이메일이 발송되었습니다.",
        "verification_token": verification_token  # 개발용 - 실제로는 이메일로만 전송
    }


@router.post("/logout")
async def logout(
    current_user = Depends(get_current_user)
):
    """로그아웃"""
    # TODO: 토큰 블랙리스트 구현 (Redis 사용)
    return {"message": "로그아웃되었습니다."}

