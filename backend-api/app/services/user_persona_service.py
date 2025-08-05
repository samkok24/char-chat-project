"""
유저 페르소나 서비스 - 사용자 페르소나 관리 비즈니스 로직
"""

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update, delete
from app.models.user_persona import UserPersona
from app.schemas.user_persona import UserPersonaCreate, UserPersonaUpdate
import uuid
from typing import List, Optional


async def get_user_persona_by_id(db: AsyncSession, persona_id: uuid.UUID) -> Optional[UserPersona]:
    """ID로 유저 페르소나 조회"""
    result = await db.execute(select(UserPersona).where(UserPersona.id == persona_id))
    return result.scalar_one_or_none()


async def get_personas_by_user(db: AsyncSession, user_id: uuid.UUID) -> List[UserPersona]:
    """사용자의 모든 페르소나 조회"""
    result = await db.execute(
        select(UserPersona)
        .where(UserPersona.user_id == user_id)
        .order_by(UserPersona.is_default.desc(), UserPersona.created_at.asc())
    )
    return result.scalars().all()


async def get_active_persona_by_user(db: AsyncSession, user_id: uuid.UUID) -> Optional[UserPersona]:
    """사용자의 현재 활성 페르소나 조회"""
    result = await db.execute(
        select(UserPersona)
        .where(UserPersona.user_id == user_id, UserPersona.is_active == True)
    )
    return result.scalar_one_or_none()


async def get_default_persona_by_user(db: AsyncSession, user_id: uuid.UUID) -> Optional[UserPersona]:
    """사용자의 기본 페르소나 조회"""
    result = await db.execute(
        select(UserPersona)
        .where(UserPersona.user_id == user_id, UserPersona.is_default == True)
    )
    return result.scalar_one_or_none()


async def create_user_persona(db: AsyncSession, persona_data: UserPersonaCreate, user_id: uuid.UUID) -> UserPersona:
    """새 유저 페르소나 생성"""
    # 기본 페르소나로 설정하는 경우, 기존 기본 페르소나 해제
    if persona_data.is_default:
        await db.execute(
            update(UserPersona)
            .where(UserPersona.user_id == user_id, UserPersona.is_default == True)
            .values(is_default=False)
        )
    
    # 첫 번째 페르소나인 경우 자동으로 기본 및 활성으로 설정
    existing_personas = await get_personas_by_user(db, user_id)
    is_first_persona = len(existing_personas) == 0
    
    new_persona = UserPersona(
        **persona_data.model_dump(exclude={'is_default'}),
        user_id=user_id,
        is_active=is_first_persona,  # 첫 번째 페르소나는 자동으로 활성화
        is_default=is_first_persona or persona_data.is_default  # 첫 번째 페르소나는 자동으로 기본값
    )
    
    db.add(new_persona)
    await db.commit()
    await db.refresh(new_persona)
    return new_persona


async def update_user_persona(db: AsyncSession, persona_id: uuid.UUID, persona_data: UserPersonaUpdate, user_id: uuid.UUID) -> Optional[UserPersona]:
    """유저 페르소나 수정"""
    # 페르소나 소유권 확인
    persona = await get_user_persona_by_id(db, persona_id)
    if not persona or persona.user_id != user_id:
        return None
    
    # 기본 페르소나로 설정하는 경우, 기존 기본 페르소나 해제
    if persona_data.is_default:
        await db.execute(
            update(UserPersona)
            .where(UserPersona.user_id == user_id, UserPersona.is_default == True, UserPersona.id != persona_id)
            .values(is_default=False)
        )
    
    result = await db.execute(
        update(UserPersona)
        .where(UserPersona.id == persona_id)
        .values(**persona_data.model_dump(exclude_unset=True))
        .returning(UserPersona)
    )
    updated_persona = result.scalar_one_or_none()
    await db.commit()
    return updated_persona


async def delete_user_persona(db: AsyncSession, persona_id: uuid.UUID, user_id: uuid.UUID) -> bool:
    """유저 페르소나 삭제"""
    # 페르소나 소유권 확인
    persona = await get_user_persona_by_id(db, persona_id)
    if not persona or persona.user_id != user_id:
        return False
    
    # 활성 페르소나인 경우 다른 페르소나를 활성화
    if persona.is_active:
        other_personas = await get_personas_by_user(db, user_id)
        other_personas = [p for p in other_personas if p.id != persona_id]
        if other_personas:
            # 기본 페르소나가 있으면 그것을, 없으면 첫 번째를 활성화
            next_active = next((p for p in other_personas if p.is_default), other_personas[0])
            await db.execute(
                update(UserPersona)
                .where(UserPersona.id == next_active.id)
                .values(is_active=True)
            )
    
    result = await db.execute(
        delete(UserPersona).where(UserPersona.id == persona_id)
    )
    await db.commit()
    return result.rowcount > 0


async def set_active_persona(db: AsyncSession, persona_id: uuid.UUID, user_id: uuid.UUID) -> Optional[UserPersona]:
    """활성 페르소나 설정"""
    # 페르소나 소유권 확인
    persona = await get_user_persona_by_id(db, persona_id)
    if not persona or persona.user_id != user_id:
        return None
    
    # 기존 활성 페르소나 비활성화
    await db.execute(
        update(UserPersona)
        .where(UserPersona.user_id == user_id, UserPersona.is_active == True)
        .values(is_active=False)
    )
    
    # 새 페르소나 활성화
    await db.execute(
        update(UserPersona)
        .where(UserPersona.id == persona_id)
        .values(is_active=True)
    )
    
    await db.commit()
    await db.refresh(persona)
    return persona