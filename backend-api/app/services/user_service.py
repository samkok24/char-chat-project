"""
사용자 관련 서비스
"""

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update
from typing import Optional, Union
import uuid

from app.models.user import User


async def get_user_by_id(db: AsyncSession, user_id: Union[str, uuid.UUID]) -> Optional[User]:
    """ID로 사용자 조회"""
    result = await db.execute(select(User).where(User.id == user_id))
    return result.scalar_one_or_none()


async def get_user_by_email(db: AsyncSession, email: str) -> Optional[User]:
    """이메일로 사용자 조회"""
    result = await db.execute(select(User).where(User.email == email))
    return result.scalar_one_or_none()


async def create_user(
    db: AsyncSession, 
    email: str, 
    username: str, 
    password_hash: str
) -> User:
    """사용자 생성"""
    user = User(
        email=email,
        username=username,
        hashed_password=password_hash
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


async def update_user_verification_status(
    db: AsyncSession, 
    user_id: Union[str, uuid.UUID], 
    is_verified: bool
) -> Optional[User]:
    """사용자 인증 상태 업데이트"""
    await db.execute(
        update(User)
        .where(User.id == user_id)
        .values(is_verified=is_verified)
    )
    await db.commit()
    return await get_user_by_id(db, user_id)


async def update_user_profile(
    db: AsyncSession,
    user_id: Union[str, uuid.UUID],
    username: Optional[str] = None,
    password_hash: Optional[str] = None
) -> Optional[User]:
    """사용자 프로필 업데이트"""
    update_data = {}
    if username is not None:
        update_data["username"] = username
    if password_hash is not None:
        update_data["hashed_password"] = password_hash
    
    if update_data:
        await db.execute(
            update(User)
            .where(User.id == user_id)
            .values(**update_data)
        )
        await db.commit()
    
    return await get_user_by_id(db, user_id)


async def deactivate_user(db: AsyncSession, user_id: Union[str, uuid.UUID]) -> Optional[User]:
    """사용자 비활성화"""
    await db.execute(
        update(User)
        .where(User.id == user_id)
        .values(is_active=False)
    )
    await db.commit()
    return await get_user_by_id(db, user_id)

