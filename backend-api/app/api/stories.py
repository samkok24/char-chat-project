"""
스토리 관련 API 라우터
"""

from fastapi import APIRouter, Depends, HTTPException, Query, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List, Optional
import uuid

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.user import User
from app.models.story import Story
from app.schemas.story import (
    StoryCreate, StoryUpdate, StoryResponse, StoryListResponse,
    StoryGenerationRequest, StoryGenerationResponse
)
from app.services import story_service
from app.services.story_service import story_generation_service

router = APIRouter()


@router.post("/generate", response_model=StoryGenerationResponse)
async def generate_story(
    request: StoryGenerationRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """AI 스토리 생성"""
    try:
        # 스토리 생성
        result = await story_generation_service.generate_story(
            keywords=request.keywords,
            character_id=request.character_id,
            genre=request.genre,
            length=request.length,
            tone=request.tone
        )
        
        # 자동 저장 옵션이 활성화된 경우 DB에 저장
        story_id = None
        if request.auto_save:
            story_data = StoryCreate(
                title=result["title"],
                content=result["content"],
                genre=result.get("genre"),
                keywords=result["keywords"],
                is_public=False,  # 기본적으로 비공개
                metadata=result.get("metadata", {})
            )
            
            story = await story_service.create_story(db, current_user.id, story_data)
            story_id = story.id
        
        return StoryGenerationResponse(
            story_id=story_id,
            title=result["title"],
            content=result["content"],
            keywords=result["keywords"],
            genre=result.get("genre"),
            estimated_reading_time=result["estimated_reading_time"],
            metadata=result.get("metadata", {})
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"스토리 생성 실패: {str(e)}")


@router.post("/", response_model=StoryResponse)
async def create_story(
    story_data: StoryCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """스토리 생성"""
    story = await story_service.create_story(db, current_user.id, story_data)
    return StoryResponse.model_validate(story)


@router.get("/", response_model=StoryListResponse)
async def get_stories(
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    search: Optional[str] = Query(None),
    genre: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db)
):
    """공개 스토리 목록 조회"""
    stories = await story_service.get_public_stories(
        db, skip=skip, limit=limit, search=search, genre=genre
    )
    
    story_responses = [StoryResponse.model_validate(story) for story in stories]
    
    return StoryListResponse(
        stories=story_responses,
        total=len(story_responses),
        skip=skip,
        limit=limit
    )


@router.get("/my", response_model=StoryListResponse)
async def get_my_stories(
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    search: Optional[str] = Query(None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """내 스토리 목록 조회"""
    stories = await story_service.get_stories_by_creator(
        db, current_user.id, skip=skip, limit=limit, search=search
    )
    
    story_responses = [StoryResponse.model_validate(story) for story in stories]
    
    return StoryListResponse(
        stories=story_responses,
        total=len(story_responses),
        skip=skip,
        limit=limit
    )


@router.get("/{story_id}", response_model=StoryResponse)
async def get_story(
    story_id: uuid.UUID,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user)
):
    """스토리 상세 조회"""
    story = await story_service.get_story_by_id(db, story_id)
    
    if not story:
        raise HTTPException(status_code=404, detail="스토리를 찾을 수 없습니다")
    
    # 비공개 스토리는 작성자만 조회 가능
    if not story.is_public and (not current_user or story.creator_id != current_user.id):
        raise HTTPException(status_code=403, detail="접근 권한이 없습니다")
    
    # 조회수 증가 (백그라운드 작업)
    background_tasks.add_task(story_service.increment_story_view_count, db, story_id)
    
    return StoryResponse.model_validate(story)


@router.put("/{story_id}", response_model=StoryResponse)
async def update_story(
    story_id: uuid.UUID,
    story_data: StoryUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """스토리 정보 수정"""
    story = await story_service.get_story_by_id(db, story_id)
    
    if not story:
        raise HTTPException(status_code=404, detail="스토리를 찾을 수 없습니다")
    
    if story.creator_id != current_user.id:
        raise HTTPException(status_code=403, detail="수정 권한이 없습니다")
    
    updated_story = await story_service.update_story(db, story_id, story_data)
    return StoryResponse.model_validate(updated_story)


@router.delete("/{story_id}")
async def delete_story(
    story_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """스토리 삭제"""
    story = await story_service.get_story_by_id(db, story_id)
    
    if not story:
        raise HTTPException(status_code=404, detail="스토리를 찾을 수 없습니다")
    
    if story.creator_id != current_user.id:
        raise HTTPException(status_code=403, detail="삭제 권한이 없습니다")
    
    success = await story_service.delete_story(db, story_id)
    
    if not success:
        raise HTTPException(status_code=500, detail="스토리 삭제에 실패했습니다")
    
    return {"message": "스토리가 삭제되었습니다"}


@router.post("/{story_id}/like")
async def like_story(
    story_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """스토리 좋아요"""
    story = await story_service.get_story_by_id(db, story_id)
    
    if not story:
        raise HTTPException(status_code=404, detail="스토리를 찾을 수 없습니다")
    
    if not story.is_public:
        raise HTTPException(status_code=403, detail="비공개 스토리에는 좋아요를 할 수 없습니다")
    
    # 이미 좋아요를 눌렀는지 확인
    is_liked = await story_service.is_story_liked_by_user(db, story_id, current_user.id)
    
    if is_liked:
        raise HTTPException(status_code=400, detail="이미 좋아요를 누른 스토리입니다")
    
    success = await story_service.like_story(db, story_id, current_user.id)
    
    if not success:
        raise HTTPException(status_code=500, detail="좋아요 처리에 실패했습니다")
    
    return {"message": "좋아요가 추가되었습니다"}


@router.delete("/{story_id}/like")
async def unlike_story(
    story_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """스토리 좋아요 취소"""
    story = await story_service.get_story_by_id(db, story_id)
    
    if not story:
        raise HTTPException(status_code=404, detail="스토리를 찾을 수 없습니다")
    
    success = await story_service.unlike_story(db, story_id, current_user.id)
    
    if not success:
        raise HTTPException(status_code=400, detail="좋아요를 누르지 않은 스토리입니다")
    
    return {"message": "좋아요가 취소되었습니다"}


@router.get("/{story_id}/like-status")
async def get_story_like_status(
    story_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """스토리 좋아요 상태 확인"""
    story = await story_service.get_story_by_id(db, story_id)
    
    if not story:
        raise HTTPException(status_code=404, detail="스토리를 찾을 수 없습니다")
    
    is_liked = await story_service.is_story_liked_by_user(db, story_id, current_user.id)
    
    return {
        "is_liked": is_liked,
        "like_count": story.like_count
    }

