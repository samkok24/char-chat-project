"""
스토리 관련 API 라우터
"""

from fastapi import APIRouter, Depends, HTTPException, Query, BackgroundTasks, status, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List, Optional
import uuid
import json
import asyncio

from app.core.database import get_db
from app.core.security import get_current_user, get_current_user_optional
from app.models.user import User
from app.models.story import Story
from app.models.story_extracted_character import StoryExtractedCharacter
from app.schemas.story import (
    StoryCreate, StoryUpdate, StoryResponse, StoryListResponse, StoryListItem,
    StoryGenerationRequest, StoryGenerationResponse, StoryWithDetails, StoryStreamRequest
)
from app.schemas.comment import (
    CommentCreate, CommentUpdate, StoryCommentResponse, StoryCommentWithUser
)
from app.services import story_service
from app.services.story_service import story_generation_service
from app.services.comment_service import (
    create_story_comment, get_story_comments, get_story_comment_by_id,
    update_story_comment, delete_story_comment
)
from app.services.job_service import JobService, get_job_service
from app.services.origchat_service import (
    ensure_extracted_characters_for_story,
    extract_characters_from_story,
)
from app.services.origchat_service import _enrich_character_fields
from app.models.story_chapter import StoryChapter
from app.models.character import Character
from sqlalchemy import select, delete

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


@router.post("/generate/stream")
async def generate_story_stream(
    request: Request,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user_optional),
    job_service: JobService = Depends(get_job_service)
):
    """SSE stream using the new real-time AI generation pipeline."""
    body = await request.json()
    job_id = str(uuid.uuid4())

    async def run_generation_in_background():
        try:
            initial_data = {
                "status": "queued",
                "stage": "start",
                "content_so_far": "",
                "preview_sent": False,
                "title": "생성 중...",
                "final_result": None,
                "error_message": None,
                "cancelled": False,
            }
            await job_service.create_job(job_id, initial_data)
        
            # 실제 생성 로직
            await job_service.update_job(job_id, {"status": "running"})
            
            keywords = body.get("keywords") or []
            model_str = (body.get("model") or "").lower()
            
            if "claude" in model_str: ai_model = "claude"
            elif "gpt" in model_str: ai_model = "gpt"
            else: ai_model = "gemini"

            full_content = ""
            
            # keywords가 비어도 최소 프롬프트 기반으로 생성되도록 처리
            async for event_data in story_generation_service.generate_story_stream(
                keywords=keywords,
                genre=body.get("genre"),
                length=body.get("length", "medium"),
                tone=body.get("tone", "neutral"),
                ai_model=ai_model,
                ai_sub_model=model_str
            ):
                # Check cancellation
                state = await job_service.get_job(job_id)
                if state and state.get("cancelled"):
                    await job_service.update_job(job_id, {"status": "cancelled"})
                    break
                event_name = event_data.get("event")
                data_payload = event_data.get("data", {})
                
                if event_name == "story_delta":
                    full_content += data_payload.get("delta", "")
                    updates = {"content_so_far": full_content}
                    # preview_sent 플래그는 job_service 내부에서 관리되므로 직접 참조 대신 get_job 사용
                    current_job_state = await job_service.get_job(job_id)
                    # 프리뷰는 '최대 500자'이므로, 너무 늦게 나오지 않도록 임계값을 낮춰 조기 전송
                    if current_job_state and not current_job_state.get("preview_sent") and len(full_content) >= 200:
                        updates["preview_sent"] = True
                    await job_service.update_job(job_id, updates)

                elif event_name == "stage_start":
                    await job_service.update_job(job_id, {"stage": data_payload.get("label", "진행 중...")})

                elif event_name == "stage_end" and data_payload.get("name") == "title_generation":
                    await job_service.update_job(job_id, {"title": data_payload.get("result", "무제")})

                elif event_name == "final":
                    await job_service.update_job(job_id, {"status": "done", "final_result": data_payload})
                
                elif event_name == "error":
                    raise Exception(data_payload.get("message", "Unknown generation error"))

        except Exception as e:
            # 백그라운드 작업에서 발생하는 모든 예외를 잡아서 Redis에 기록
            error_message = f"배경 생성 작업 실패: {str(e)}"
            try:
                await job_service.update_job(job_id, {"status": "error", "error_message": error_message})
            except:
                # Redis 업데이트조차 실패하는 경우 (연결 문제 등)
                # 이 경우는 어쩔 수 없이 클라이언트가 타임아웃 처리해야 함
                pass

    # 중요: StreamingResponse에서 BackgroundTasks는 응답 종료 후 실행되므로
    # 여기서는 즉시 비동기 작업을 시작해야 함
    asyncio.create_task(run_generation_in_background())

    async def event_generator():
        yield f'event: meta\n'
        yield f'data: {{"job_id": "{job_id}", "queue_position": 0}}\n\n'
        
        last_content_len = 0
        last_stage = None
        last_title = None
        preview_emitted = False

        try:
            while True:
                job_state = await job_service.get_job(job_id)
                if not job_state:
                    # Job이 생성되기 전이거나 알 수 없는 이유로 사라짐
                    await asyncio.sleep(0.5)
                    continue
                
                if job_state.get("status") in ["done", "error", "cancelled"]:
                    if job_state.get("status") == "error" and job_state.get("error_message"):
                         yield f'event: error\n'
                         yield f'data: {{"message": {json.dumps(job_state.get("error_message"))} }}\n\n'
                    elif job_state.get("status") == "cancelled":
                        yield f'event: error\n'
                        yield f'data: {{"message": "cancelled"}}\n\n'
                    elif job_state.get("final_result"):
                        yield f'event: final\n'
                        yield f'data: {json.dumps(job_state.get("final_result"))}\n\n'
                    break

                # Stage 변경 감지
                current_stage = job_state.get("stage")
                if current_stage is not None and current_stage != last_stage:
                    last_stage = current_stage
                    yield f'event: stage_start\n'
                    yield f'data: {json.dumps({"label": last_stage})}\n\n'

                # 제목 변경 감지
                current_title = job_state.get("title")
                if current_title is not None and current_title != last_title:
                    last_title = current_title
                    yield f'event: stage_end\n'
                    yield f'data: {json.dumps({"name": "title_generation", "result": last_title})}\n\n'
                
                # 프리뷰 1회 전송
                content = job_state.get("content_so_far", "")
                if (not preview_emitted) and job_state.get("preview_sent"):
                    # 500자보다 짧게 생성되더라도 preview_sent가 True이면 일단 보냄
                    preview_content = content[:500]
                    yield f'event: preview\n'
                    yield f'data: {{"text": {json.dumps(preview_content)}}}\n\n'
                    preview_emitted = True
                    last_content_len = len(preview_content)

                # 컨텐츠 델타 전송 (프리뷰 전/후 상관없이 즉시 스트리밍)
                if len(content) > last_content_len:
                    delta = content[last_content_len:]
                    yield f'event: episode\n'
                    yield f'data: {json.dumps({"delta": delta})}\n\n'
                    last_content_len = len(content)
                
                await asyncio.sleep(0.2) # 폴링 간격 단축
        except asyncio.CancelledError:
            # Client disconnected
            pass
        except Exception as e:
            # 폴링 루프 자체의 예외
            try:
                error_payload = json.dumps({"message": f"Stream polling failed on the server: {str(e)}"})
                yield f'event: error\n'
                yield f'data: {error_payload}\n\n'
            except:
                pass

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream; charset=utf-8",
        headers={"X-Accel-Buffering": "no", "Cache-Control": "no-cache"},
    )

@router.get("/generate/stream/{job_id}/status")
async def get_job_status(job_id: str, job_service: JobService = Depends(get_job_service)):
    job = await job_service.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job

@router.delete("/generate/stream/{job_id}")
async def cancel_job(job_id: str, job_service: JobService = Depends(get_job_service)):
    state = await job_service.cancel_job(job_id)
    if not state:
        raise HTTPException(status_code=404, detail="Job not found")
    return {"message": "cancelled"}


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

    # 목록용 항목으로 변환하면서 excerpt 채움
    items: list[StoryListItem] = []
    for s in stories:
        try:
            text = (s.content or "").strip()
        except Exception:
            text = ""
        # 간단 발췌: 줄바꿈/공백 정리 후 앞부분 140자
        excerpt = " ".join(text.split())[:140] if text else None
        items.append(StoryListItem(
            id=s.id,
            title=s.title,
            genre=s.genre,
            is_public=bool(s.is_public),
            is_origchat=bool(getattr(s, "is_origchat", False)),
            like_count=int(s.like_count or 0),
            view_count=int(s.view_count or 0),
            comment_count=int(s.comment_count or 0),
            created_at=s.created_at,
            creator_username=(s.creator.username if getattr(s, "creator", None) else None),
            character_name=(s.character.name if getattr(s, "character", None) else None),
            cover_url=getattr(s, "cover_url", None),
            excerpt=excerpt,
        ))

    return StoryListResponse(
        stories=items,
        total=len(items),
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

    items: list[StoryListItem] = []
    for s in stories:
        try:
            text = (s.content or "").strip()
        except Exception:
            text = ""
        excerpt = " ".join(text.split())[:140] if text else None
        items.append(StoryListItem(
            id=s.id,
            title=s.title,
            genre=s.genre,
            is_public=bool(s.is_public),
            is_origchat=bool(getattr(s, "is_origchat", False)),
            like_count=int(s.like_count or 0),
            view_count=int(s.view_count or 0),
            comment_count=int(s.comment_count or 0),
            created_at=s.created_at,
            creator_username=(s.creator.username if getattr(s, "creator", None) else None),
            character_name=(s.character.name if getattr(s, "character", None) else None),
            cover_url=getattr(s, "cover_url", None),
            excerpt=excerpt,
        ))

    return StoryListResponse(
        stories=items,
        total=len(items),
        skip=skip,
        limit=limit
    )


@router.get("/{story_id}", response_model=StoryWithDetails)
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
    
    # StoryResponse 형식으로 먼저 변환
    story_dict = StoryResponse.model_validate(story).model_dump()
    # 총 조회수(작품 상세 + 회차 합계) 계산
    try:
        from app.services.story_service import get_story_total_views
        story_dict["view_count"] = await get_story_total_views(db, story_id)
    except Exception:
        pass
    
    # 추가 정보 포함
    story_dict["creator_username"] = story.creator.username if story.creator else None
    story_dict["character_name"] = story.character.name if story.character else None
    
    # 좋아요 상태 추가 (로그인한 사용자인 경우만)
    if current_user:
        story_dict["is_liked"] = await story_service.is_story_liked_by_user(db, story_id, current_user.id)
    else:
        story_dict["is_liked"] = False
    
    return StoryWithDetails(**story_dict)


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


# ──────────────────────────────────────────────────────────────────────────────
# 등장인물 추출: 조회 / 재생성 / 전체 삭제
# 프론트 기대 경로: GET /stories/{story_id}/extracted-characters
#                 POST /stories/{story_id}/extracted-characters/rebuild
#                 DELETE /stories/{story_id}/extracted-characters
# ──────────────────────────────────────────────────────────────────────────────

@router.get("/{story_id}/extracted-characters")
async def get_extracted_characters_endpoint(
    story_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user_optional),
):
    story = await story_service.get_story_by_id(db, story_id)
    if not story:
        raise HTTPException(status_code=404, detail="스토리를 찾을 수 없습니다")

    # 최초 요청 시 비어있다면 간이 보장 로직 수행(회차가 있으면 최소 3인 구성)
    rows = await db.execute(
        select(StoryExtractedCharacter)
        .where(StoryExtractedCharacter.story_id == story_id)
        .order_by(StoryExtractedCharacter.order_index.asc(), StoryExtractedCharacter.created_at.asc())
    )
    items = rows.scalars().all()
    if not items:
        # 최초 생성은 크리에이터가 상세 페이지를 볼 때 1회만 수행
        # 조건: 소유자 + 아직 원작챗으로 표시되지 않은 스토리(is_origchat=False)
        if current_user and story.creator_id == current_user.id and not getattr(story, "is_origchat", False):
            try:
                await ensure_extracted_characters_for_story(db, story_id)
            except Exception:
                pass
            rows = await db.execute(
                select(StoryExtractedCharacter)
                .where(StoryExtractedCharacter.story_id == story_id)
                .order_by(StoryExtractedCharacter.order_index.asc(), StoryExtractedCharacter.created_at.asc())
            )
            items = rows.scalars().all()

    # 연결된 캐릭터들의 대표 이미지(avatar_url)를 한 번에 조회해 보강
    char_map = {}
    try:
        char_ids = [r.character_id for r in items if getattr(r, "character_id", None)]
        if char_ids:
            rows = (await db.execute(select(Character).where(Character.id.in_(char_ids)))).scalars().all()
            char_map = {str(r.id): r for r in rows}
    except Exception:
        char_map = {}

    def _with_cache_bust(url: Optional[str]) -> Optional[str]:
        try:
            if not url:
                return url
            # 간단 캐시 버스트 파라미터 추가
            return f"{url}{'&' if '?' in url else '?'}v={int(__import__('time').time())}"
        except Exception:
            return url

    def to_dict(rec: StoryExtractedCharacter):
        # 레코드 자체에 avatar_url이 없으면 연결된 캐릭터의 avatar_url로 보강
        avatar = rec.avatar_url
        if not avatar and getattr(rec, "character_id", None):
            ch = char_map.get(str(rec.character_id))
            if ch and getattr(ch, "avatar_url", None):
                avatar = ch.avatar_url
        avatar = _with_cache_bust(avatar)
        return {
            "id": str(rec.id),
            "name": rec.name,
            "description": rec.description,
            "initial": rec.initial,
            "avatar_url": avatar,
            "character_id": str(rec.character_id) if getattr(rec, "character_id", None) else None,
            "order_index": rec.order_index,
        }

    return {"items": [to_dict(r) for r in items]}


@router.post("/{story_id}/extracted-characters/rebuild")
async def rebuild_extracted_characters_endpoint(
    story_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user_optional),
):
    story = await story_service.get_story_by_id(db, story_id)
    if not story:
        raise HTTPException(status_code=404, detail="스토리를 찾을 수 없습니다")
    # 작성자만 재생성 허용
    if not current_user or story.creator_id != current_user.id:
        raise HTTPException(status_code=403, detail="재생성 권한이 없습니다")

    # 기존 레코드 삭제
    await db.execute(delete(StoryExtractedCharacter).where(StoryExtractedCharacter.story_id == story_id))
    await db.commit()

    # LLM 기반 추출 시도 → 실패 시 간이 보장 로직
    created = 0
    try:
        created = await extract_characters_from_story(db, story_id)
    except Exception:
        created = 0
    if not created:
        # 다시생성하기는 반드시 LLM 결과를 요구. 실패 시 503 반환
        raise HTTPException(status_code=503, detail="LLM 추출에 실패했습니다. API 키/모델 설정을 확인해 주세요.")

    # 최종 목록 반환
    rows = await db.execute(
        select(StoryExtractedCharacter)
        .where(StoryExtractedCharacter.story_id == story_id)
        .order_by(StoryExtractedCharacter.order_index.asc(), StoryExtractedCharacter.created_at.asc())
    )
    items = rows.scalars().all()
    return {"items": [
        {
            "id": str(r.id),
            "name": r.name,
            "description": r.description,
            "initial": r.initial,
            "avatar_url": r.avatar_url,
            "character_id": str(r.character_id) if getattr(r, "character_id", None) else None,
            "order_index": r.order_index,
        } for r in items
    ], "created": len(items)}


@router.delete("/{story_id}/extracted-characters")
async def delete_extracted_characters_endpoint(
    story_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    story = await story_service.get_story_by_id(db, story_id)
    if not story:
        raise HTTPException(status_code=404, detail="스토리를 찾을 수 없습니다")
    if story.creator_id != current_user.id:
        raise HTTPException(status_code=403, detail="삭제 권한이 없습니다")
    res = await db.execute(delete(StoryExtractedCharacter).where(StoryExtractedCharacter.story_id == story_id))
    await db.commit()
    # rowcount는 드라이버에 따라 None일 수 있음
    deleted = getattr(res, "rowcount", None)
    return {"deleted": deleted if isinstance(deleted, int) else True}


@router.post("/{story_id}/extracted-characters/{extracted_id}/rebuild")
async def rebuild_single_extracted_character_endpoint(
    story_id: uuid.UUID,
    extracted_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """해당 스토리의 특정 추출 캐릭터(그리드 카드 1개)만 재생성한다.
    - 작성자만 가능
    - character_id가 있으면 해당 캐릭터를 LLM 보강(_enrich)만 수행
    - character_id가 없으면 새 캐릭터를 생성 후 링크
    - 그리드 레코드는 유지(이름/설명은 기존 유지; 상세페이지 내용만 보강)
    """
    # 스토리/권한 확인
    story = await story_service.get_story_by_id(db, story_id)
    if not story:
        raise HTTPException(status_code=404, detail="스토리를 찾을 수 없습니다")
    if story.creator_id != current_user.id:
        raise HTTPException(status_code=403, detail="재생성 권한이 없습니다")

    # 추출 캐릭터 레코드 확인
    rec = await db.get(StoryExtractedCharacter, extracted_id)
    if not rec or str(rec.story_id) != str(story_id):
        raise HTTPException(status_code=404, detail="추출 캐릭터를 찾을 수 없습니다")

    # 컨텍스트 구축: 모든 회차 텍스트를 이어 붙여 상한선까지 사용
    rows = await db.execute(
        select(StoryChapter.content)
        .where(StoryChapter.story_id == story_id)
        .order_by(StoryChapter.no.asc())
    )
    contents = [r[0] or "" for r in rows.all()]
    combined = "\n\n".join([t for t in contents if t])
    # 길이 제한(LLM 프롬프트 과대 방지)
    if combined and len(combined) > 12000:
        combined = combined[:12000]

    # 캐릭터 생성/보강
    char: Optional[Character] = None
    if rec.character_id:
        char = await db.get(Character, rec.character_id)
    if not char:
        # 새 캐릭터 생성
        char = Character(
            creator_id=current_user.id,
            name=rec.name,
            description=rec.description or None,
            character_type="roleplay",
            base_language="ko",
            has_affinity_system=True,
            affinity_rules="기본 호감도 규칙: 상호 배려와 신뢰 상승, 공격적 발화 시 하락",
            affinity_stages='[{"stage": "낯섦", "min": 0}, {"stage": "친근", "min": 40}, {"stage": "신뢰", "min": 70}]',
            is_public=True,
            is_active=True,
            source_type='IMPORTED',
            origin_story_id=story_id,
            use_translation=True,
        )
        db.add(char)
        await db.flush()
        rec.character_id = char.id
        try:
            await db.commit()
        except Exception:
            await db.rollback()

    # LLM 보강(실패는 조용히 무시)
    try:
        await _enrich_character_fields(db, char, combined)
    except Exception:
        pass

    # 최신 레코드 반환(그리드 표시 스키마)
    out = {
        "id": str(rec.id),
        "name": rec.name,
        "description": rec.description,
        "initial": rec.initial,
        "avatar_url": rec.avatar_url,
        "character_id": str(rec.character_id) if getattr(rec, "character_id", None) else None,
        "order_index": rec.order_index,
    }
    return {"item": out}


@router.post("/{story_id}/comments", response_model=StoryCommentResponse, status_code=status.HTTP_201_CREATED)
async def create_story_comment_endpoint(
    story_id: uuid.UUID,
    comment_data: CommentCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """스토리에 댓글 작성"""
    story = await story_service.get_story_by_id(db, story_id)
    if not story:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="스토리를 찾을 수 없습니다."
        )
    
    if not story.is_public:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="비공개 스토리에는 댓글을 작성할 수 없습니다."
        )
    
    comment = await create_story_comment(db, story_id, current_user.id, comment_data)
    return comment


@router.get("/{story_id}/comments", response_model=List[StoryCommentWithUser])
async def get_story_comments_endpoint(
    story_id: uuid.UUID,
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db)
):
    """스토리 댓글 목록 조회"""
    story = await story_service.get_story_by_id(db, story_id)
    if not story:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="스토리를 찾을 수 없습니다."
        )
    
    comments = await get_story_comments(db, story_id, skip, limit)
    
    # StoryCommentWithUser 형식으로 변환
    comments_with_user = []
    for comment in comments:
        comment_dict = StoryCommentResponse.from_orm(comment).model_dump()
        comment_dict["username"] = comment.user.username
        comment_dict["user_avatar_url"] = getattr(comment.user, "avatar_url", None)
        comments_with_user.append(StoryCommentWithUser(**comment_dict))
    
    return comments_with_user


@router.put("/comments/{comment_id}", response_model=StoryCommentResponse)
async def update_story_comment_endpoint(
    comment_id: uuid.UUID,
    comment_data: CommentUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """스토리 댓글 수정"""
    comment = await get_story_comment_by_id(db, comment_id)
    if not comment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="댓글을 찾을 수 없습니다."
        )
    
    # 작성자만 수정 가능
    if comment.user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="이 댓글을 수정할 권한이 없습니다."
        )
    
    updated_comment = await update_story_comment(db, comment_id, comment_data)
    return updated_comment


@router.delete("/comments/{comment_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_story_comment_endpoint(
    comment_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """스토리 댓글 삭제"""
    comment = await get_story_comment_by_id(db, comment_id)
    if not comment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="댓글을 찾을 수 없습니다."
        )
    
    # 작성자만 삭제 가능
    if comment.user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="이 댓글을 삭제할 권한이 없습니다."
        )
    
    await delete_story_comment(db, comment_id)

