"""
캐릭터 관련 서비스
"""

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update, delete, func, and_, or_
from sqlalchemy.orm import selectinload, joinedload
from typing import List, Optional
import uuid

from app.models.character import Character, CharacterSetting
from app.models.user import User
from app.models.like import CharacterLike
from app.schemas.character import CharacterCreate, CharacterUpdate, CharacterSettingCreate, CharacterSettingUpdate


async def create_character(
    db: AsyncSession,
    creator_id: uuid.UUID,
    character_data: CharacterCreate
) -> Character:
    """캐릭터 생성"""
    character = Character(
        creator_id=creator_id,
        **character_data.model_dump()
    )
    db.add(character)
    
    # 기본 설정 생성
    default_setting = CharacterSetting(
        character=character,
        system_prompt=f"당신은 {character.name}입니다. {character.personality or '친근하고 도움이 되는 성격입니다.'}"
    )
    db.add(default_setting)

    # flush를 통해 ID를 먼저 할당받습니다.
    await db.flush()
    character_id = character.id

    await db.commit()
    
    # 커밋 후에는 인스턴스가 만료되므로, 관계가 로드된 새 인스턴스를 다시 가져옵니다.
    created_character = await get_character_by_id(db=db, character_id=character_id)
    return created_character


async def get_character_by_id(db: AsyncSession, character_id: uuid.UUID) -> Optional[Character]:
    """ID로 캐릭터 조회"""
    result = await db.execute(
        select(Character)
        .options(
            selectinload(Character.settings),
            joinedload(Character.creator)
        )
        .where(Character.id == character_id)
    )
    return result.scalar_one_or_none()


async def get_characters_by_creator(
    db: AsyncSession,
    creator_id: uuid.UUID,
    skip: int = 0,
    limit: int = 20,
    search: Optional[str] = None,
    include_private: bool = False
) -> List[Character]:
    """생성자별 캐릭터 목록 조회"""
    query = select(Character).where(Character.creator_id == creator_id)
    
    if not include_private:
        query = query.where(Character.is_public == True)
    
    if search:
        query = query.where(
            or_(
                Character.name.ilike(f"%{search}%"),
                Character.description.ilike(f"%{search}%")
            )
        )
    
    query = query.order_by(Character.created_at.desc()).offset(skip).limit(limit)
    
    result = await db.execute(query)
    return result.scalars().all()


async def get_public_characters(
    db: AsyncSession,
    skip: int = 0,
    limit: int = 20,
    search: Optional[str] = None
) -> List[Character]:
    """공개 캐릭터 목록 조회"""
    query = select(Character).where(
        and_(Character.is_public == True, Character.is_active == True)
    )
    
    if search:
        query = query.where(
            or_(
                Character.name.ilike(f"%{search}%"),
                Character.description.ilike(f"%{search}%")
            )
        )
    
    query = query.order_by(Character.like_count.desc(), Character.created_at.desc()).offset(skip).limit(limit)
    
    result = await db.execute(query)
    return result.scalars().all()


async def update_character(
    db: AsyncSession,
    character_id: uuid.UUID,
    character_data: CharacterUpdate
) -> Optional[Character]:
    """캐릭터 정보 수정"""
    update_data = character_data.model_dump(exclude_unset=True)
    
    if update_data:
        await db.execute(
            update(Character)
            .where(Character.id == character_id)
            .values(**update_data)
        )
        await db.commit()
    
    return await get_character_by_id(db, character_id)


async def delete_character(db: AsyncSession, character_id: uuid.UUID) -> bool:
    """캐릭터 삭제"""
    result = await db.execute(
        delete(Character).where(Character.id == character_id)
    )
    await db.commit()
    return result.rowcount > 0


async def create_character_setting(
    db: AsyncSession,
    character_id: uuid.UUID,
    setting_data: CharacterSettingCreate
) -> CharacterSetting:
    """캐릭터 설정 생성"""
    # 기존 설정이 있으면 삭제
    await db.execute(
        delete(CharacterSetting).where(CharacterSetting.character_id == character_id)
    )
    
    setting = CharacterSetting(
        character_id=character_id,
        **setting_data.model_dump()
    )
    db.add(setting)
    await db.commit()
    await db.refresh(setting)
    return setting


async def get_character_setting(db: AsyncSession, character_id: uuid.UUID) -> Optional[CharacterSetting]:
    """캐릭터 설정 조회"""
    result = await db.execute(
        select(CharacterSetting).where(CharacterSetting.character_id == character_id)
    )
    return result.scalar_one_or_none()


async def update_character_setting(
    db: AsyncSession,
    character_id: uuid.UUID,
    setting_data: CharacterSettingUpdate
) -> Optional[CharacterSetting]:
    """캐릭터 설정 수정"""
    update_data = setting_data.model_dump(exclude_unset=True)
    
    if update_data:
        await db.execute(
            update(CharacterSetting)
            .where(CharacterSetting.character_id == character_id)
            .values(**update_data)
        )
        await db.commit()
    
    return await get_character_setting(db, character_id)


async def like_character(db: AsyncSession, character_id: uuid.UUID, user_id: uuid.UUID) -> bool:
    """캐릭터 좋아요"""
    # 좋아요 추가
    like = CharacterLike(character_id=character_id, user_id=user_id)
    db.add(like)
    
    # 캐릭터 좋아요 수 증가
    await db.execute(
        update(Character)
        .where(Character.id == character_id)
        .values(like_count=Character.like_count + 1)
    )
    
    await db.commit()
    return True


async def unlike_character(db: AsyncSession, character_id: uuid.UUID, user_id: uuid.UUID) -> bool:
    """캐릭터 좋아요 취소"""
    # 좋아요 삭제
    result = await db.execute(
        delete(CharacterLike).where(
            and_(
                CharacterLike.character_id == character_id,
                CharacterLike.user_id == user_id
            )
        )
    )
    
    if result.rowcount > 0:
        # 캐릭터 좋아요 수 감소
        await db.execute(
            update(Character)
            .where(Character.id == character_id)
            .values(like_count=Character.like_count - 1)
        )
        await db.commit()
        return True
    
    return False


async def is_character_liked_by_user(db: AsyncSession, character_id: uuid.UUID, user_id: uuid.UUID) -> bool:
    """사용자가 캐릭터에 좋아요를 눌렀는지 확인"""
    result = await db.execute(
        select(CharacterLike).where(
            and_(
                CharacterLike.character_id == character_id,
                CharacterLike.user_id == user_id
            )
        )
    )
    return result.scalar_one_or_none() is not None


async def increment_character_chat_count(db: AsyncSession, character_id: uuid.UUID) -> bool:
    """캐릭터 채팅 수 증가"""
    await db.execute(
        update(Character)
        .where(Character.id == character_id)
        .values(chat_count=Character.chat_count + 1)
    )
    await db.commit()
    return True

