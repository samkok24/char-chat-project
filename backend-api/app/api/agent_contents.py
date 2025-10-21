"""
에이전트 콘텐츠 관련 API
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete, desc, func, update
from typing import List
from datetime import datetime
import uuid

from app.core.database import get_db, AsyncSessionLocal
from app.core.security import get_current_user
from app.models.user import User
from app.models.agent_content import AgentContent
from app.schemas.agent_content import (
    AgentContentCreate,
    AgentContentResponse,
    AgentContentListResponse,
    AgentContentPublish
)

router = APIRouter()


@router.post("/", response_model=AgentContentResponse)
async def create_agent_content(
    content: AgentContentCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """에이전트 콘텐츠 저장"""
    agent_content = AgentContent(
        user_id=current_user.id,
        session_id=content.session_id,
        message_id=content.message_id,
        story_mode=content.story_mode,
        user_text=content.user_text,
        user_image_url=content.user_image_url,
        generated_text=content.generated_text,
        generated_image_urls=content.generated_image_urls or []
    )
    
    db.add(agent_content)
    await db.commit()
    await db.refresh(agent_content)
    
    return agent_content


@router.get("/", response_model=AgentContentListResponse)
async def get_agent_contents(
    story_mode: str = Query(None, description="snap | genre"),
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """에이전트 콘텐츠 목록 조회"""
    skip = (page - 1) * limit
    
    # 필터 조건 구성
    conditions = [AgentContent.user_id == current_user.id]
    if story_mode:
        conditions.append(AgentContent.story_mode == story_mode)
    
    # 총 개수 조회
    count_result = await db.execute(
        select(func.count(AgentContent.id))
        .where(*conditions)
    )
    total = count_result.scalar() or 0
    
    # 목록 조회
    result = await db.execute(
        select(AgentContent)
        .where(*conditions)
        .order_by(desc(AgentContent.created_at))
        .offset(skip)
        .limit(limit)
    )
    items = result.scalars().all()
    
    return AgentContentListResponse(
        items=items,
        total=total,
        page=page,
        limit=limit
    )


@router.delete("/{content_id}")
async def delete_agent_content(
    content_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """에이전트 콘텐츠 삭제"""
    result = await db.execute(
        select(AgentContent).where(
            AgentContent.id == content_id,
            AgentContent.user_id == current_user.id
        )
    )
    content = result.scalar_one_or_none()
    
    if not content:
        raise HTTPException(status_code=404, detail="콘텐츠를 찾을 수 없습니다.")
    
    await db.execute(
        delete(AgentContent).where(AgentContent.id == content_id)
    )
    await db.commit()
    
    return {"message": "삭제되었습니다."}


@router.patch("/{content_id}/publish", response_model=AgentContentResponse)
async def publish_agent_content(
    content_id: uuid.UUID,
    payload: AgentContentPublish,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """에이전트 콘텐츠 발행"""
    print(f"🔥🔥🔥 [PUBLISH API] 호출됨! content_id={content_id}, user_id={current_user.id}")
    
    result = await db.execute(
        select(AgentContent).where(
            AgentContent.id == content_id,
            AgentContent.user_id == current_user.id
        )
    )
    content = result.scalar_one_or_none()
    
    if not content:
        print(f"❌ [PUBLISH API] 콘텐츠 없음: {content_id}")
        raise HTTPException(status_code=404, detail="콘텐츠를 찾을 수 없습니다.")
    
    print(f"✅ [PUBLISH API] 콘텐츠 찾음, 발행 처리 시작")
    
    # 발행 처리
    content.is_published = True
    content.published_at = datetime.utcnow()
    
    await db.commit()
    await db.refresh(content)
    
    print(f"✅ [PUBLISH API] DB 커밋 완료, unread_count 즉시 설정 시작")

    # try:
    #     from app.models.chat import ChatRoom
    #     from app.models.chat_read_status import ChatRoomReadStatus
    #     from sqlalchemy.sql import func
    #     from collections import OrderedDict
        
    #     # 🔥 모든 채팅방 가져오기
    #     rooms_result = await db.execute(
    #         select(ChatRoom)
    #         .where(ChatRoom.user_id == current_user.id)
    #         .order_by(ChatRoom.updated_at.desc())
    #         .limit(50)
    #     )
    #     all_rooms = rooms_result.scalars().all()
        
    #     # 캐릭터 중복 제거 (최근 방만, 최대 5개)
    #     rooms_by_char = OrderedDict()
    #     for room in all_rooms:
    #         if room.character_id not in rooms_by_char:
    #             rooms_by_char[room.character_id] = room
    #             if len(rooms_by_char) >= 5:
    #                 break
        
    #     target_rooms = list(rooms_by_char.values())
    #     print(f"🔍 [PUBLISH API] Target rooms: {len(target_rooms)}개")
        
    #     # 🔥 모든 타겟 방에 즉시 unread_count = 1 설정
    #     for room in target_rooms:
    #         status_result = await db.execute(
    #             select(ChatRoomReadStatus)
    #             .where(
    #                 ChatRoomReadStatus.room_id == room.id,
    #                 ChatRoomReadStatus.user_id == current_user.id
    #             )
    #         )
    #         status = status_result.scalar_one_or_none()
            
    #         if status:
    #             status.unread_count = 1
    #         else:
    #             new_status = ChatRoomReadStatus(
    #                 room_id=room.id,
    #                 user_id=current_user.id,
    #                 unread_count=1,
    #                 last_read_at=func.now()
    #             )
    #             db.add(new_status)
            
    #         print(f"  🔍 Set unread=1 for {room.character_id}")
        
    #     await db.commit()
    #     print(f"✅✅✅ [PUBLISH API] {len(target_rooms)}개 방에 unread 설정 완료!")
        
    # except Exception as e:
    #     print(f"❌ [PUBLISH API] unread 설정 에러: {e}")
    #     import traceback
    #     traceback.print_exc()
    
    print(f"✅ [PUBLISH API] 백그라운드 태스크 스케줄링 시작")
    
    # 🆕 Option E: asyncio.create_task로 async 함수 직접 실행
    import asyncio
    
    # 클로저 캡처용 변수
    user_id_for_task = current_user.id  # UUID 그대로 사용
    content_id_for_task = str(content_id)
    
    async def run_reaction_async():
        """비동기로 실행될 반응 생성 함수"""
        try:
            print(f"🚀🚀🚀 [AgentContents] Starting async reaction for content {content_id_for_task}")
            
            # 새로운 async 세션 생성
            from app.core.database import AsyncSessionLocal
            from app.models.chat import ChatRoom
            from sqlalchemy.orm import selectinload
            from sqlalchemy import select
            from datetime import datetime, timedelta

            async with AsyncSessionLocal() as session:
                # 캐릭터 정보를 미리 로드하여 전달 (최근 대화 기록, 시간 제한 없음)
                stmt = (
                    select(ChatRoom)
                    .options(selectinload(ChatRoom.character))
                    .where(ChatRoom.user_id == user_id_for_task)
                    .order_by(ChatRoom.updated_at.desc())
                    .limit(20)
                )
                result = await session.execute(stmt)
                rooms_with_characters = result.scalars().all()
                
                print(f"✅ [AgentContents] Found {len(rooms_with_characters)} chat rooms for user")

                from app.services.feed_reaction_service import trigger_character_reactions_with_rooms
                await trigger_character_reactions_with_rooms(session, user_id_for_task, content_id_for_task, rooms_with_characters)
            
            print(f"✅✅✅ [AgentContents] Async reaction completed for content {content_id_for_task}")
        except Exception as e:
            print(f"❌❌❌ [AgentContents] Async reaction failed: {e}")
            import traceback
            traceback.print_exc()
    
    # 현재 이벤트 루프에 태스크 추가
    asyncio.create_task(run_reaction_async())
    
    print(f"✅ [PUBLISH API] 백그라운드 태스크 스케줄링 완료, 응답 반환")
    
    return content


@router.patch("/{content_id}/unpublish", response_model=AgentContentResponse)
async def unpublish_agent_content(
    content_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """에이전트 콘텐츠 발행 취소"""
    result = await db.execute(
        select(AgentContent).where(
            AgentContent.id == content_id,
            AgentContent.user_id == current_user.id
        )
    )
    content = result.scalar_one_or_none()
    
    if not content:
        raise HTTPException(status_code=404, detail="콘텐츠를 찾을 수 없습니다.")
    
    # 발행 취소
    content.is_published = False
    
    await db.commit()
    await db.refresh(content)
    
    return content


@router.get("/feed", response_model=AgentContentListResponse)
async def get_agent_feed(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """발행된 에이전트 콘텐츠 피드 조회"""
    skip = (page - 1) * limit
    
    # 발행된 콘텐츠만 필터
    conditions = [
        AgentContent.user_id == current_user.id,
        AgentContent.is_published == True
    ]
    
    # 총 개수 조회
    count_result = await db.execute(
        select(func.count(AgentContent.id))
        .where(*conditions)
    )
    total = count_result.scalar() or 0
    
    # 목록 조회 (발행 시간 기준 최신순)
    result = await db.execute(
        select(AgentContent)
        .where(*conditions)
        .order_by(desc(AgentContent.published_at))
        .offset(skip)
        .limit(limit)
    )
    items = result.scalars().all()
    
    return AgentContentListResponse(
        items=items,
        total=total,
        page=page,
        limit=limit
    )

