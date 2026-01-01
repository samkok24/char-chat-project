"""
사용자 관련 서비스
"""

import logging
from sqlalchemy import select, update, delete, func, and_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update, and_, or_, func, Integer
from typing import Optional, Union, Dict, List
import uuid
from sqlalchemy import func
from sqlalchemy.orm import selectinload, aliased
from sqlalchemy import case
from datetime import datetime, timedelta, timezone

from app.core.database import engine as _engine

from app.models.character import Character
from app.models.story import Story
from app.models.story_chapter import StoryChapter
from app.models.like import CharacterLike
from app.models.bookmark import CharacterBookmark
from app.schemas.user import UserProfileResponse

from app.models.user import User
from app.models.chat import ChatRoom, ChatMessage
from app.schemas import StatsOverview, TimeSeriesResponse, TimeSeriesPoint, TopCharacterItem
from app.schemas.user import AdminUserListResponse, AdminUserListItem

logger = logging.getLogger(__name__)

def _dialect_name() -> str:
    """
    현재 실행 중인 DB dialect 이름을 반환한다.

    의도/동작:
    - 통계 쿼리는 SQLite/Postgres 모두 지원해야 한다.
    - SQLite에선 date_trunc/interval 같은 Postgres 전용 함수가 없어 500이 나기 쉬우므로,
      dialect를 감지해 분기한다.
    """
    try:
        return str(getattr(getattr(_engine, "dialect", None), "name", "") or "")
    except Exception:
        return ""

def _to_utc_naive(dt):
    """timezone-aware datetime을 UTC naive로 정규화한다(키 포맷 일치 목적)."""
    try:
        if getattr(dt, "tzinfo", None) is not None:
            return dt.astimezone(timezone.utc).replace(tzinfo=None)
    except Exception:
        pass
    return dt

def _format_hour_key(v) -> str:
    """시간 버킷 키를 'YYYY-MM-DD HH:00' 형태로 통일한다."""
    if v is None:
        return ""
    if isinstance(v, str):
        return v
    dt = _to_utc_naive(v)
    try:
        dt = dt.replace(minute=0, second=0, microsecond=0)
    except Exception:
        pass
    try:
        return dt.strftime("%Y-%m-%d %H:00")
    except Exception:
        return str(v)

def _format_day_key(v) -> str:
    """일 버킷 키를 'YYYY-MM-DD' 형태로 통일한다."""
    if v is None:
        return ""
    if isinstance(v, str):
        # SQLite strftime('%Y-%m-%d', ...) 결과를 그대로 사용
        return v[:10]
    dt = _to_utc_naive(v)
    try:
        return dt.date().isoformat()
    except Exception:
        return str(v)

def _normalize_email(raw: str) -> str:
    """이메일을 일관되게 비교/저장하기 위해 lower/trim 정규화한다."""
    return (raw or "").strip().lower()


async def get_user_by_id(db: AsyncSession, user_id: Union[str, uuid.UUID]) -> Optional[User]:
    """ID로 사용자 조회"""
    result = await db.execute(select(User).where(User.id == user_id))
    return result.scalar_one_or_none()


async def get_user_by_email(db: AsyncSession, email: str) -> Optional[User]:
    """이메일로 사용자 조회 (방어적: 대소문자 무시).

    의도/동작:
    - Postgres의 일반 text/varchar unique는 대소문자를 구분하므로,
      email을 그대로 저장/조회하면 같은 이메일이 대소문자만 다르게 중복될 수 있다.
    - 서비스 안정성을 위해 항상 lower(email) 기준으로 조회한다.
    """
    email_norm = _normalize_email(email)
    if not email_norm:
        return None
    # 최대 2개까지만 읽어서 중복 데이터가 생긴 경우에도 서버가 죽지 않게 방어한다.
    result = await db.execute(
        select(User).where(func.lower(User.email) == email_norm).limit(2)
    )
    users = result.scalars().all() or []
    if len(users) > 1:
        # 중복 데이터는 원칙적으로 없어야 하지만(유니크 제약/정규화), 발생해도 서비스가 멈추지 않게 한다.
        try:
            logger.warning("Duplicate users detected for email=%s (count=%d). Using first.", email_norm, len(users))
        except Exception:
            pass
    return users[0] if users else None


async def create_user(
    db: AsyncSession, 
    email: str, 
    username: str, 
    password_hash: str,
    gender: str,
) -> User:
    """사용자 생성"""
    user = User(
        # 이메일은 lower/trim 정규화하여 저장 (중복/로그인 혼선을 방지)
        email=_normalize_email(email),
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


async def admin_list_users(
    db: AsyncSession,
    skip: int = 0,
    limit: int = 100,
) -> AdminUserListResponse:
    """
    관리자용 회원 목록(+누적 지표) 반환

    지표 정의(현재 구현):
    - created_character_count: 해당 유저가 생성한 캐릭터 수
    - used_chat_count: 해당 유저가 보낸 채팅 메시지 수(모든 캐릭터챗/원작챗 포함, sender_type='user')
    - used_view_count: 해당 유저가 생성한 스토리(웹소설/웹툰 포함)의 누적 조회수 합(Story.view_count 합)
    - last_login_at: 로그인 기록 컬럼이 없어서, 현재는 "최근 채팅 활동 시간"으로 대체 (user 메시지 기준)
    """
    # 방어
    if skip < 0:
        skip = 0
    if limit <= 0:
        limit = 100
    limit = min(int(limit), 200)

    try:
        total_res = await db.execute(select(func.count(User.id)))
        total = int(total_res.scalar() or 0)

        # 캐릭터 생성 수
        char_sq = (
            select(
                Character.creator_id.label("user_id"),
                func.count(Character.id).label("created_character_count"),
            )
            .group_by(Character.creator_id)
            .subquery()
        )

        # 유저가 보낸 메시지 수 + 최근 메시지 시각
        chat_sq = (
            select(
                ChatRoom.user_id.label("user_id"),
                func.count(ChatMessage.id).label("used_chat_count"),
                func.max(ChatMessage.created_at).label("last_login_at"),
            )
            .select_from(ChatRoom)
            .join(ChatMessage, ChatMessage.chat_room_id == ChatRoom.id)
            .where(ChatMessage.sender_type == "user")
            .group_by(ChatRoom.user_id)
            .subquery()
        )

        # 스토리 조회수 합(작성자 기준)
        # - 기준: Story.view_count(스토리 상세 진입) + 모든 회차(StoryChapter.view_count) 합
        chapter_views_sq = (
            select(
                StoryChapter.story_id.label("story_id"),
                func.coalesce(func.sum(func.coalesce(StoryChapter.view_count, 0)), 0).label("chapter_views"),
            )
            .group_by(StoryChapter.story_id)
            .subquery()
        )
        story_sq = (
            select(
                Story.creator_id.label("user_id"),
                func.coalesce(
                    func.sum(
                        func.coalesce(Story.view_count, 0) + func.coalesce(chapter_views_sq.c.chapter_views, 0)
                    ),
                    0,
                ).label("used_view_count"),
            )
            .select_from(Story)
            .outerjoin(chapter_views_sq, chapter_views_sq.c.story_id == Story.id)
            .group_by(Story.creator_id)
            .subquery()
        )

        stmt = (
            select(
                User,
                func.coalesce(char_sq.c.created_character_count, 0).label("created_character_count"),
                func.coalesce(chat_sq.c.used_chat_count, 0).label("used_chat_count"),
                chat_sq.c.last_login_at.label("last_login_at"),
                func.coalesce(story_sq.c.used_view_count, 0).label("used_view_count"),
            )
            .outerjoin(char_sq, char_sq.c.user_id == User.id)
            .outerjoin(chat_sq, chat_sq.c.user_id == User.id)
            .outerjoin(story_sq, story_sq.c.user_id == User.id)
            .order_by(User.created_at.desc(), User.id.desc())
            .offset(int(skip))
            .limit(int(limit))
        )

        res = await db.execute(stmt)
        rows = res.all() or []

        items: list[AdminUserListItem] = []
        for (u, created_character_count, used_chat_count, last_login_at, used_view_count) in rows:
            items.append(
                AdminUserListItem(
                    id=u.id,
                    email=u.email,
                    username=u.username,
                    is_admin=bool(getattr(u, "is_admin", False)),
                    created_at=u.created_at,
                    last_login_at=last_login_at,
                    created_character_count=int(created_character_count or 0),
                    used_chat_count=int(used_chat_count or 0),
                    used_view_count=int(used_view_count or 0),
                )
            )

        return AdminUserListResponse(total=total, skip=int(skip), limit=int(limit), items=items)
    except Exception as e:
        try:
            logger.exception(f"[admin_list_users] failed: {e}")
        except Exception:
            pass
        raise


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
    """
    통계 개요(집계)를 반환한다.

    의도/동작:
    - 운영에서 SQLite를 쓰거나, Postgres/asyncpg 환경이 바뀌어도 500이 나지 않도록
      DB-중립적인 방식(Python datetime 기준)으로 기간 필터를 수행한다.
    - 프론트 `ProfilePage`는 이 값을 KPI로 사용하므로, 실패 시에도 0으로 안전하게 반환한다.
    """
    # 캐릭터 수/공개 수/누적 대화/좋아요
    char_counts = await db.execute(
        select(
            func.count(Character.id),
            func.coalesce(func.sum(case((Character.is_public.is_(True), 1), else_=0)), 0),
            func.coalesce(func.sum(Character.chat_count), 0),
            func.coalesce(func.sum(Character.like_count), 0),
        ).where(Character.creator_id == user_id)
    )
    row = char_counts.first()
    total, public, chats_total, likes_total = row if row else (0, 0, 0, 0)

    # 최근 30일 유니크 유저: 메시지 발신자가 user이고, 해당 캐릭터 생성자가 user_id
    # ChatRoom.character_id -> Character.creator_id == user_id
    try:
        since = datetime.utcnow() - timedelta(days=30)
        uniq_q = await db.execute(
            select(func.count(func.distinct(ChatRoom.user_id)))
            .select_from(ChatRoom)
            .join(ChatMessage, ChatMessage.chat_room_id == ChatRoom.id)
            .join(Character, Character.id == ChatRoom.character_id)
            .where(
                Character.creator_id == user_id,
                ChatMessage.sender_type == 'user',
                ChatMessage.created_at >= since,
            )
        )
        unique_users_30d = uniq_q.scalar() or 0
    except Exception as e:
        try:
            logger.warning("[stats] overview.unique_users_30d query failed (fallback=0): %s", e)
        except Exception:
            pass
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
    """
    기간별 메시지 수 시계열을 반환한다.

    의도/동작:
    - Postgres는 date_trunc를 사용해 DB에서 그룹핑
    - SQLite는 strftime로 그룹핑(별도 분기)
    - 어떤 DB든 프론트에서 바로 그릴 수 있도록 "빈 구간은 0"으로 채운 series를 반환한다.
    """
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

    # 방어적: 비정상 값 방지
    if not isinstance(count, int) or count <= 0:
        count = 24 if use_hour else 7

    since = datetime.utcnow() - (timedelta(hours=count) if use_hour else timedelta(days=count))
    dialect = _dialect_name()
    if dialect == "sqlite":
        bucket = func.strftime("%Y-%m-%d %H:00" if use_hour else "%Y-%m-%d", ChatMessage.created_at).label("t")
    else:
        bucket = func.date_trunc("hour" if use_hour else "day", ChatMessage.created_at).label("t")

    result = await db.execute(
        select(bucket, func.count(ChatMessage.id))
        .select_from(ChatMessage)
        .join(ChatRoom, ChatMessage.chat_room_id == ChatRoom.id)
        .join(Character, Character.id == ChatRoom.character_id)
        .where(
            Character.creator_id == user_id,
            ChatMessage.created_at >= since,
        )
        .group_by(bucket)
        .order_by(bucket)
    )
    rows = result.all() or []

    series_map = {}
    if use_hour:
        for t, cnt in rows:
            k = _format_hour_key(t)
            if k:
                series_map[k] = int(cnt or 0)
        now = datetime.utcnow().replace(minute=0, second=0, microsecond=0)
        points = []
        for i in range(count-1, -1, -1):
            ts = (now - timedelta(hours=i)).strftime("%Y-%m-%d %H:00")
            points.append(TimeSeriesPoint(date=ts, value=series_map.get(ts, 0)))
    else:
        for t, cnt in rows:
            k = _format_day_key(t)
            if k:
                series_map[k] = int(cnt or 0)
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
    """
    기간 내 메시지 수 기준 상위 캐릭터 목록을 반환한다.

    의도/동작:
    - interval() 같은 DB 전용 함수를 쓰지 않고, Python datetime으로 기간 필터를 수행한다.
    - SQLite/Postgres 모두에서 안정적으로 동작하도록 한다.
    """
    days = 7
    if range_str.endswith('d'):
        try:
            days = int(range_str[:-1])
        except Exception:
            days = 7
    if not isinstance(days, int) or days <= 0:
        days = 7

    # 캐릭터별 최근 N일 메시지 수
    since = datetime.utcnow() - timedelta(days=days)
    res = await db.execute(
        select(Character.id, Character.name, Character.avatar_url, func.count(ChatMessage.id).label('cnt'))
        .join(ChatRoom, ChatRoom.character_id == Character.id)
        .join(ChatMessage, ChatMessage.chat_room_id == ChatRoom.id)
        .where(
            Character.creator_id == user_id,
            ChatMessage.created_at >= since
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