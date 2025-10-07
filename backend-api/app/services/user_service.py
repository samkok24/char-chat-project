"""
사용자 관련 서비스
"""

from sqlalchemy import select, update, delete, func, and_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update, and_, or_, func, Integer
from typing import Optional, Union, Dict, List
import uuid
from sqlalchemy import func
from sqlalchemy.orm import selectinload, aliased

from app.models.character import Character
from app.models.story import Story
from app.models.like import CharacterLike
from app.models.bookmark import CharacterBookmark
from app.schemas.user import UserProfileResponse

from app.models.user import User
from app.models.chat import ChatRoom, ChatMessage
from app.schemas import StatsOverview, TimeSeriesResponse, TimeSeriesPoint, TopCharacterItem


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
    password_hash: str,
    gender: str,
) -> User:
    """사용자 생성"""
    user = User(
        email=email,
        username=username,
        hashed_password=password_hash,
        gender=gender
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
    password_hash: Optional[str] = None,
    avatar_url: Optional[str] = None,
    bio: Optional[str] = None
) -> Optional[User]:
    """사용자 프로필 업데이트"""
    update_data = {}
    if username is not None:
        update_data["username"] = username
    if password_hash is not None:
        update_data["hashed_password"] = password_hash
    if avatar_url is not None:
        update_data["avatar_url"] = avatar_url
    if bio is not None:
        update_data["bio"] = bio
    
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

async def get_user_profile(db: AsyncSession, user_id: str) -> UserProfileResponse | None:
    """
    사용자의 기본 정보와 통계 정보를 함께 조회하여 프로필 페이지용으로 반환합니다.
    """
    try:
        user_uuid = uuid.UUID(user_id)
    except ValueError:
        return None # 유효하지 않은 UUID 형식
    
    # 1. 사용자의 기본 정보를 조회합니다.
    user_result = await db.execute(select(User).where(User.id == user_uuid))
    user = user_result.scalar_one_or_none()
    
    if not user:
        return None
        
    # 2. 사용자가 생성한 캐릭터들의 통계 정보를 집계합니다.
    stats_result = await db.execute(
        select(
            func.count(Character.id).label("character_count"),
            func.sum(Character.chat_count).label("total_chat_count"),
            func.sum(Character.like_count).label("total_like_count")
        )
        .where(Character.creator_id == user_uuid)
    )
    stats = stats_result.one()

    # 3. 조회된 기본 정보와 통계 정보를 UserProfileResponse 스키마에 맞춰 조합합니다.
    return UserProfileResponse(
        id=user.id,
        email=user.email,
        username=user.username,
        gender=user.gender,
        avatar_url=getattr(user, 'avatar_url', None),
        bio=getattr(user, 'bio', None),
        is_active=user.is_active,
        is_verified=user.is_verified,
        created_at=user.created_at,
        updated_at=user.updated_at,
        character_count=stats.character_count or 0,
        total_chat_count=stats.total_chat_count or 0,
        total_like_count=stats.total_like_count or 0
    )


async def get_recent_characters_for_user(db: AsyncSession, user_id: uuid.UUID, limit: int = 10, skip: int = 0) -> list[Character]:
    """
    사용자가 최근에 대화한 캐릭터 목록을 반환합니다.
    creator 정보를 함께 로드하고, last_message_snippet을 포함합니다.
    """
    if limit > 50:  # 최대 limit 제한으로 보안 강화
        limit = 50
    
    # Subquery: last message timestamp per chat room (PostgreSQL-compatible)
    # Include a sample of content via aggregate MIN over filtered rows to satisfy GROUP BY
    last_message_subquery = (
        select(
            ChatMessage.chat_room_id,
            func.max(ChatMessage.created_at).label('last_chat_time'),
            func.min(func.substring(ChatMessage.content, 1, 100)).label('last_message_snippet')
        )
        .group_by(ChatMessage.chat_room_id)
        .subquery()
    )
    

    result = await db.execute(
        select(
            Character,
            ChatRoom.id.label('chat_room_id'),
            last_message_subquery.c.last_chat_time,
            last_message_subquery.c.last_message_snippet,
            Story.title.label('origin_story_title')
        )
        .join(ChatRoom, Character.id == ChatRoom.character_id)
        .outerjoin(last_message_subquery, ChatRoom.id == last_message_subquery.c.chat_room_id)
        .outerjoin(Story, Character.origin_story_id == Story.id)
        .where(ChatRoom.user_id == user_id)
        .options(selectinload(Character.creator))
        .order_by(
            last_message_subquery.c.last_chat_time.desc().nullslast(),
            ChatRoom.updated_at.desc()
        )
        .limit(limit)
        .offset(skip)
    )
    rows = result.all()
    characters = []
    for char, chat_room_id, last_chat_time, last_message_snippet, origin_story_title in rows:
        # 연관된 정보를 Character 모델 객체의 임시 속성으로 추가
        char.chat_room_id = chat_room_id
        char.last_chat_time = last_chat_time
        char.last_message_snippet = last_message_snippet
        # 원작 웹소설 제목 보강(있을 때)
        try:
            if getattr(char, 'origin_story_id', None) and origin_story_title:
                char.origin_story_title = origin_story_title
        except Exception:
            pass
        characters.append(char)
    return characters    
    # 동일 캐릭터가 여러 방으로 중복될 수 있으므로 character_id 기준 dedupe (가장 최신만 유지)
    # seen = set()
    # deduped: list[Character] = []
    # for c in characters:
    #     cid = getattr(c, 'id', None)
    #     if cid in seen:
    #         continue
    #     seen.add(cid)
    #     deduped.append(c)
    # return deduped


async def get_liked_characters_for_user(
    db: AsyncSession,
    user_id: uuid.UUID,
    limit: int = 20,
    skip: int = 0
) -> List[Character]:
    """
    사용자가 좋아요(=관심)에 추가한 캐릭터 목록을 반환합니다.
    기존 북마크(CharacterBookmark)도 함께 포함하여 후방 호환합니다.
    정렬: 좋아요/북마크 추가일 최신순.
    """
    result = await db.execute(
        select(Character)
        .outerjoin(
            CharacterLike,
            and_(CharacterLike.character_id == Character.id, CharacterLike.user_id == user_id)
        )
        .outerjoin(
            CharacterBookmark,
            and_(CharacterBookmark.character_id == Character.id, CharacterBookmark.user_id == user_id)
        )
        .where(
            or_(CharacterLike.id.is_not(None), CharacterBookmark.id.is_not(None))
        )
        .options(selectinload(Character.creator))
        .order_by(func.coalesce(CharacterLike.created_at, CharacterBookmark.created_at).desc().nullslast())
        .limit(limit)
        .offset(skip)
    )
    return result.scalars().unique().all()

async def update_user_model_settings(
    db: AsyncSession, 
    user_id: uuid.UUID, 
    preferred_model: str, 
    preferred_sub_model: str
) -> bool:
    """사용자의 AI 모델 설정 업데이트"""
    result = await db.execute(
        update(User)
        .where(User.id == user_id)
        .values(
            preferred_model=preferred_model,
            preferred_sub_model=preferred_sub_model
        )
    )
    await db.commit()
    return result.rowcount > 0


async def update_user_response_length_pref(
    db: AsyncSession,
    user_id: uuid.UUID,
    response_length_pref: str
) -> bool:
    if response_length_pref not in {"short", "medium", "long"}:
        return False
    result = await db.execute(
        update(User)
        .where(User.id == user_id)
        .values(response_length_pref=response_length_pref)
    )
    await db.commit()
    return result.rowcount > 0


# ----- 통계 서비스 (경량) -----
async def get_stats_overview(db: AsyncSession, user_id: uuid.UUID) -> StatsOverview:
    # 캐릭터 수/공개 수/누적 대화/좋아요
    char_counts = await db.execute(
        select(
            func.count(Character.id),
            func.sum(func.case((Character.is_public == True, 1), else_=0)),
            func.coalesce(func.sum(Character.chat_count), 0),
            func.coalesce(func.sum(Character.like_count), 0),
        ).where(Character.creator_id == user_id)
    )
    total, public, chats_total, likes_total = char_counts.first()

    # 최근 30일 유니크 유저: 메시지 발신자가 user이고, 해당 캐릭터 생성자가 user_id
    # ChatRoom.character_id -> Character.creator_id == user_id
    sub = (
        select(ChatMessage.sender_type, ChatMessage.created_at, ChatRoom.character_id, ChatRoom.user_id)
        .join(ChatRoom, ChatMessage.chat_room_id == ChatRoom.id)
        .subquery()
    )
    uniq_q = await db.execute(
        select(func.count(func.distinct(ChatRoom.user_id)))
        .join(ChatMessage, ChatMessage.chat_room_id == ChatRoom.id)
        .join(Character, Character.id == ChatRoom.character_id)
        .where(
            Character.creator_id == user_id,
            ChatMessage.sender_type == 'user',
            ChatMessage.created_at >= func.now() - func.cast(30, Integer) * func.interval('1 day')
        )
    )
    # 일부 DB에서 위 표현이 제한될 수 있어, 실패 시 0 유지
    try:
        unique_users_30d = uniq_q.scalar() or 0
    except Exception:
        unique_users_30d = 0

    return StatsOverview(
        character_total=int(total or 0),
        character_public=int(public or 0),
        chats_total=int(chats_total or 0),
        unique_users_30d=int(unique_users_30d or 0),
        likes_total=int(likes_total or 0),
    )


async def get_stats_timeseries(
    db: AsyncSession,
    user_id: uuid.UUID,
    metric: str = 'chats',
    range_str: str = '7d',
) -> TimeSeriesResponse:
    # 24h(시간별) 또는 Nd(일별)
    use_hour = False
    count = 7
    if range_str.endswith('h'):
        use_hour = True
        try:
            count = int(range_str[:-1])
        except Exception:
            count = 24
    elif range_str.endswith('d'):
        try:
            count = int(range_str[:-1])
        except Exception:
            count = 7

    trunc_unit = 'hour' if use_hour else 'day'
    interval_unit = '1 hour' if use_hour else '1 day'

    result = await db.execute(
        select(
            func.date_trunc(trunc_unit, ChatMessage.created_at).label('t'),
            func.count(ChatMessage.id)
        )
        .join(ChatRoom, ChatMessage.chat_room_id == ChatRoom.id)
        .join(Character, Character.id == ChatRoom.character_id)
        .where(
            Character.creator_id == user_id,
            ChatMessage.created_at >= func.now() - func.cast(count, Integer) * func.interval(interval_unit)
        )
        .group_by(func.date_trunc(trunc_unit, ChatMessage.created_at))
        .order_by(func.date_trunc(trunc_unit, ChatMessage.created_at))
    )
    rows = result.all()

    from datetime import datetime, timedelta
    series_map = {}
    if use_hour:
        series_map = {r[0].replace(minute=0, second=0, microsecond=0).isoformat(): int(r[1]) for r in rows}
        now = datetime.utcnow().replace(minute=0, second=0, microsecond=0)
        points = []
        for i in range(count-1, -1, -1):
            ts = (now - timedelta(hours=i)).isoformat()
            points.append(TimeSeriesPoint(date=ts, value=series_map.get(ts, 0)))
    else:
        series_map = {r[0].date().isoformat(): int(r[1]) for r in rows}
        today = datetime.utcnow().date()
        points = []
        for i in range(count-1, -1, -1):
            d = (today - timedelta(days=i)).isoformat()
            points.append(TimeSeriesPoint(date=d, value=series_map.get(d, 0)))

    return TimeSeriesResponse(metric=metric, range=range_str, series=points)


async def get_stats_top_characters(
    db: AsyncSession,
    user_id: uuid.UUID,
    metric: str = 'chats',
    range_str: str = '7d',
    limit: int = 5,
) -> list[TopCharacterItem]:
    days = 7
    if range_str.endswith('d'):
        try:
            days = int(range_str[:-1])
        except Exception:
            days = 7

    # 캐릭터별 최근 N일 메시지 수
    res = await db.execute(
        select(Character.id, Character.name, Character.avatar_url, func.count(ChatMessage.id).label('cnt'))
        .join(ChatRoom, ChatRoom.character_id == Character.id)
        .join(ChatMessage, ChatMessage.chat_room_id == ChatRoom.id)
        .where(
            Character.creator_id == user_id,
            ChatMessage.created_at >= func.now() - func.cast(days, Integer) * func.interval('1 day')
        )
        .group_by(Character.id, Character.name, Character.avatar_url)
        .order_by(func.count(ChatMessage.id).desc())
        .limit(limit)
    )
    rows = res.all()
    items = []
    for cid, name, avatar, cnt in rows:
        items.append(TopCharacterItem(id=str(cid), name=name, avatar_url=avatar, value_7d=int(cnt)))
    return items