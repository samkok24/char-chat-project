"""
에이전트 콘텐츠 관련 API
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete, desc, func
from typing import List
import uuid

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.user import User
from app.models.agent_content import AgentContent
from app.schemas.agent_content import (
    AgentContentCreate,
    AgentContentResponse,
    AgentContentListResponse
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

