"""
인증 관련 API 라우터
"""

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession
from datetime import timedelta

from app.core.database import get_db, get_redis
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
from app.schemas.auth import Token, RefreshTokenRequest, PasswordResetRequest, EmailVerificationRequest, EmailOnly, PasswordUpdateRequest
from app.schemas.user import UserCreate, UserLogin, UserResponse
from app.services.user_service import (
    get_user_by_email, 
    create_user, 
    update_user_verification_status
)
from redis.asyncio import Redis
from app.services.mail_service import send_verification_email as send_verification_email_async

router = APIRouter()
security = HTTPBearer()
@router.get("/check-email")
async def check_email(email: str, db: AsyncSession = Depends(get_db)):
    """이메일 중복 여부 확인"""
    existing_user = await get_user_by_email(db, email)
    return {"available": existing_user is None}
@router.get("/check-username")
async def check_username(username: str, db: AsyncSession = Depends(get_db)):
    from app.models.user import User
    from sqlalchemy import select
    result = await db.execute(select(User).where(User.username == username))
    exists = result.scalar_one_or_none() is not None
    return {"available": not exists}

@router.get("/generate-username")
async def generate_username(db: AsyncSession = Depends(get_db)):
    # 간단한 한국어 스타일 자동 생성기 (욕설/중복 필터는 최소화)
    import random
    adjectives = ["푸른","은빛","용감한","행복한","작은","신비한","빛나는","조용한","빠른","새벽"]
    nouns = ["별","여우","기사","마법사","바람","고래","탐정","천사","늑대","용"]
    for _ in range(10):
        name = f"{random.choice(adjectives)}{random.choice(nouns)}{random.randint(1,999)}"
        # 중복 체크
        from app.models.user import User
        from sqlalchemy import select
        res = await db.execute(select(User).where(User.username == name))
        if res.scalar_one_or_none() is None:
            return {"username": name}
    return {"username": f"유저{random.randint(1000,9999)}"}


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
    
    # 사용자명 중복 확인
    from sqlalchemy import select
    from app.models.user import User
    res = await db.execute(select(User).where(User.username == user_data.username))
    if res.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="이미 사용 중인 사용자명입니다."
        )

    # 패스워드 해싱
    hashed_password = get_password_hash(user_data.password)
    
    # 사용자 생성
    user = await create_user(
        db=db,
        email=user_data.email,
        username=user_data.username,
        password_hash=hashed_password,
        gender=user_data.gender
    )
    
    # 자동 인증 처리 (이메일 인증 없이 바로 사용 가능)
    await update_user_verification_status(db, user.id, True)


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
        "token_type": "bearer",
        "user_id": str(user.id)  # ✅ 추가
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
        "token_type": "bearer",
        "user_id": user_id  # ✅ 추가 (이미 문자열)
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
    payload: EmailOnly,
    redis: Redis = Depends(get_redis),
    db: AsyncSession = Depends(get_db)
):
    """인증 이메일 발송 (회원가입용)"""
    # 해당 이메일의 유저가 있는지 확인
    user = await get_user_by_email(db, payload.email)
    if user and user.is_verified:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="이미 인증된 계정입니다."
        )
    
    # 인증 토큰 생성 및 메일 발송
    token = generate_verification_token(payload.email)
    await send_verification_email_async(payload.email, token)
    return {"message": "인증 메일을 전송했습니다."}


@router.post("/update-password")
async def update_password(
    payload: PasswordUpdateRequest,
    current_user = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """현재 비밀번호 확인 후 새 비밀번호로 변경"""
    # 사용자 조회
    user = await get_user_by_email(db, current_user.email)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="사용자를 찾을 수 없습니다.")
    # 현재 비밀번호 검증
    if not verify_password(payload.current_password, user.hashed_password):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="현재 비밀번호가 올바르지 않습니다.")
    # 새 비밀번호 저장
    user.hashed_password = get_password_hash(payload.new_password)
    await db.commit()
    return {"message": "비밀번호가 변경되었습니다."}
    # 재발송 제한: 60초 쿨다운, 하루 5회
    cooldown_key = f"verify:cooldown:{current_user.id}"
    daily_key = f"verify:daily:{current_user.id}"

    # 60초 쿨다운 체크
    if await redis.exists(cooldown_key):
        raise HTTPException(status_code=429, detail="잠시 후 다시 시도해주세요 (60초)")

    # 일일 카운트 체크
    daily = await redis.get(daily_key)
    daily_count = int(daily) if daily and daily.isdigit() else 0
    if daily_count >= 5:
        raise HTTPException(status_code=429, detail="일일 재발송 횟수를 초과했습니다 (5회)")

    # 토큰 생성 및 메일 발송
    token = generate_verification_token(current_user.email)
    await send_verification_email_async(current_user.email, token)

    # 키 업데이트 (cooldown 60초, daily 24시간)
    await redis.setex(cooldown_key, 60, 1)
    # 하루 키 TTL 없으면 24시간 설정
    if not await redis.exists(daily_key):
        await redis.setex(daily_key, 24 * 3600, 1)
    else:
        try:
            # INCR는 자동으로 정수 증가
            await redis.incr(daily_key)
        except Exception:
            await redis.setex(daily_key, 24 * 3600, daily_count + 1)

    return {"message": "인증 이메일이 발송되었습니다."}


@router.post("/logout")
async def logout(
    current_user = Depends(get_current_user)
):
    """로그아웃"""
    # TODO: 토큰 블랙리스트 구현 (Redis 사용)
    return {"message": "로그아웃되었습니다."}

