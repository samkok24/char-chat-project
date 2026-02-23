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
    verify_verification_token,
    generate_password_reset_token,
    verify_password_reset_token
)
from app.core.config import settings
from app.schemas.auth import Token, RefreshTokenRequest, PasswordResetRequest, EmailVerificationRequest, EmailOnly, PasswordUpdateRequest, PasswordResetConfirm
import asyncio
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

# =========================
# Email verification (pre-signup) support
# =========================
# 회원가입 "도중" 이메일을 먼저 인증하는 플로우를 지원한다.
# - verify-email 링크를 클릭했는데 아직 유저가 DB에 없으면, Redis에 "이메일 인증 완료" 상태를 저장해둔다.
# - 이후 회원가입(register) 요청이 오면, 해당 이메일이 Redis에서 인증 완료로 확인될 때만 is_verified=True로 생성한다.
EMAIL_PREVERIFY_KEY_PREFIX = "auth:preverified_email:"
EMAIL_PREVERIFY_TTL_SECONDS = 60 * 60 * 24  # 24h


def _normalize_email(raw: str) -> str:
    """이메일 키/비교를 위한 정규화(lower/trim)."""
    return (raw or "").strip().lower()
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
    db: AsyncSession = Depends(get_db),
    redis: Redis = Depends(get_redis),
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
    
    # ✅ 사전 이메일 인증(회원가입 도중 인증) 여부 확인
    preverified = False
    email_norm = _normalize_email(user_data.email)
    try:
        if email_norm:
            pre_key = f"{EMAIL_PREVERIFY_KEY_PREFIX}{email_norm}"
            preverified = bool(await redis.get(pre_key))
    except Exception:
        preverified = False

    # 사용자 생성
    user = await create_user(
        db=db,
        email=user_data.email,
        username=user_data.username,
        password_hash=hashed_password,
        gender=user_data.gender
    )

    if settings.EMAIL_VERIFICATION_REQUIRED:
        if preverified:
            # 사전 인증 완료 → 즉시 인증 처리 + Redis 키 정리(재사용 방지)
            try:
                await update_user_verification_status(db, user.id, True)
                try:
                    if email_norm:
                        await redis.delete(f"{EMAIL_PREVERIFY_KEY_PREFIX}{email_norm}")
                except Exception:
                    pass
            except Exception:
                # 방어: 인증 업데이트 실패해도 회원가입 자체는 유지
                pass
        else:
            # 기존 플로우(후 인증): 인증 메일 발송
            try:
                token = generate_verification_token(user_data.email)
                await send_verification_email_async(user_data.email, token)
            except Exception as e:
                # 메일 발송 실패해도 회원가입은 성공 처리
                import logging
                logging.warning(f"이메일 발송 실패: {e}")
    else:
        # 개발 환경 등에서는 즉시 인증 처리
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
    
    # 이메일 미인증 유저 체크
    if settings.EMAIL_VERIFICATION_REQUIRED and not user.is_verified:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="이메일 인증이 필요합니다. 메일함을 확인해주세요."
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
    db: AsyncSession = Depends(get_db),
    redis: Redis = Depends(get_redis),
):
    """이메일 인증"""
    # 토큰 검증
    email = verify_verification_token(verification_data.token)
    if email is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="유효하지 않은 인증 토큰입니다."
        )
    
    email_norm = _normalize_email(email)

    # ✅ 회원가입 "도중" 인증을 위해 Redis에도 인증 상태를 저장(베스트 에포트)
    # - 유저가 아직 DB에 없더라도, 이후 회원가입 시 is_verified=True로 만들 수 있다.
    try:
        if email_norm:
            await redis.setex(f"{EMAIL_PREVERIFY_KEY_PREFIX}{email_norm}", EMAIL_PREVERIFY_TTL_SECONDS, "1")
    except Exception:
        pass

    # 사용자 있으면 인증 상태 업데이트(후 인증 플로우 호환)
    user = await get_user_by_email(db, email)
    if user:
        if user.is_verified:
            # ✅ idempotent: 이미 인증된 경우도 성공으로 처리(UX)
            return {"message": "이미 인증된 계정입니다.", "email": email_norm, "verified": True}
        await update_user_verification_status(db, user.id, True)
        return {"message": "이메일 인증이 완료되었습니다.", "email": email_norm, "verified": True}

    # 유저가 아직 없으면: 사전 인증 완료 상태만 저장해두고 안내
    return {"message": "이메일 인증이 완료되었습니다. 회원가입을 계속 진행해주세요.", "email": email_norm, "verified": True, "pending_signup": True}


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


@router.post("/forgot-password")
async def forgot_password(
    payload: PasswordResetRequest,
    db: AsyncSession = Depends(get_db)
):
    """비밀번호 재설정 메일 발송"""
    # 사용자 확인
    user = await get_user_by_email(db, payload.email)
    if not user:
        # 보안상 이메일이 없어도 성공 응답 (계정 존재 여부 노출 방지)
        return {"message": "비밀번호 재설정 메일을 발송했습니다. 메일함을 확인해주세요."}

    # ✅ 인증된 계정에만 비밀번호 재설정 메일 발송 (요구사항)
    if settings.EMAIL_VERIFICATION_REQUIRED and not getattr(user, "is_verified", False):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="이메일 인증이 필요합니다. 먼저 이메일 인증을 완료한 뒤 비밀번호 재설정을 진행해주세요.",
        )
    
    # 토큰 생성 및 메일 발송
    try:
        # 저장된 이메일(정규화된 값)을 기준으로 토큰/수신자를 통일(대소문자 혼선 방지)
        target_email = getattr(user, "email", None) or payload.email
        token = generate_password_reset_token(target_email)
        reset_url = f"{settings.FRONTEND_BASE_URL}/reset-password?token={token}"
        
        # 비밀번호 재설정 메일 내용
        subject = "[Chapter8] 비밀번호 재설정"
        text = f"비밀번호를 재설정하려면 다음 링크를 클릭하세요:\n{reset_url}\n\n이 링크는 1시간 동안만 유효합니다."
        html = f"""
        <div style="font-family: Pretendard, system-ui, -apple-system, Segoe UI, Roboto, Noto Sans, sans-serif; color:#111;">
          <h2>비밀번호 재설정</h2>
          <p>안녕하세요, AI 캐릭터 챗입니다.</p>
          <p>비밀번호 재설정 요청을 받았습니다. 아래 버튼을 눌러 새 비밀번호를 설정해주세요.</p>
          <p>
            <a href="{reset_url}" style="display:inline-block;padding:12px 16px;background:#7c3aed;color:#fff;text-decoration:none;border-radius:8px;">비밀번호 재설정하기</a>
          </p>
          <p>만약 버튼이 동작하지 않으면 다음 링크를 복사해 브라우저 주소창에 붙여넣으세요.</p>
          <p><a href="{reset_url}">{reset_url}</a></p>
          <p style="color:#dc2626;font-weight:600;">이 링크는 1시간 동안만 유효합니다.</p>
          <p>본인이 요청하지 않았다면 이 메일을 무시하셔도 됩니다.</p>
          <hr style="margin:20px 0;border:none;border-top:1px solid #e5e7eb;" />
          <p style="font-size:12px;color:#6b7280;">본 메일은 발신 전용입니다.</p>
        </div>
        """
        
        from app.services.mail_service import _send_email_sync
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(None, _send_email_sync, target_email, subject, text, html)
    except Exception as e:
        import logging
        logging.warning(f"비밀번호 재설정 메일 발송 실패: {e}")
    
    return {"message": "비밀번호 재설정 메일을 발송했습니다. 메일함을 확인해주세요."}


@router.post("/reset-password")
async def reset_password(
    payload: dict,
    db: AsyncSession = Depends(get_db)
):
    """비밀번호 재설정 (토큰 검증)"""
    from app.schemas.auth import PasswordResetConfirm
    token = payload.get("token")
    new_password = payload.get("new_password")
    
    if not token or not new_password:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="토큰과 새 비밀번호가 필요합니다.")

    # ✅ 서버 단에서도 최소한의 비밀번호 정책을 강제(방어적)
    try:
        pw = str(new_password)
    except Exception:
        pw = ""
    if len(pw) < 8:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="비밀번호는 8자 이상이어야 합니다.")
    import re
    if not re.search(r"[A-Za-z]", pw) or not re.search(r"\d", pw):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="비밀번호는 영문과 숫자를 포함해야 합니다.")
    
    # 토큰 검증
    email = verify_password_reset_token(token)
    if not email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="유효하지 않거나 만료된 토큰입니다. 가장 최근에 받은 재설정 메일의 링크를 사용해주세요."
        )
    
    # 사용자 조회
    user = await get_user_by_email(db, email)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="사용자를 찾을 수 없습니다."
        )

    # 인증된 계정만 비밀번호 변경 허용(요구사항 보강)
    if settings.EMAIL_VERIFICATION_REQUIRED and not getattr(user, "is_verified", False):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="이메일 인증이 필요합니다. 먼저 이메일 인증을 완료한 뒤 비밀번호 재설정을 진행해주세요.",
        )
    
    # 비밀번호 업데이트
    user.hashed_password = get_password_hash(new_password)
    await db.commit()
    
    return {"message": "비밀번호가 재설정되었습니다. 새 비밀번호로 로그인해주세요."}


@router.post("/logout")
async def logout(
    current_user = Depends(get_current_user)
):
    """로그아웃"""
    # TODO: 토큰 블랙리스트 구현 (Redis 사용)
    return {"message": "로그아웃되었습니다."}
