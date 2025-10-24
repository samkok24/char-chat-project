"""
Story Dive API 라우터
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update
from typing import List, Optional
import uuid
from datetime import datetime

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.user import User
from app.models.novel import Novel
from app.models.storydive_session import StoryDiveSession
from app.services import novel_service, storydive_ai_service

router = APIRouter()


# ============= Response Schemas =============

from pydantic import BaseModel


class NovelResponse(BaseModel):
    id: str
    title: str
    author: Optional[str]
    full_text: str
    story_cards: List[dict] | dict  # 배열 또는 단일 객체 모두 허용
    created_at: datetime
    
    class Config:
        from_attributes = True


class NovelListItem(BaseModel):
    id: str
    title: str
    author: Optional[str]
    created_at: datetime
    
    class Config:
        from_attributes = True


class SessionCreateRequest(BaseModel):
    novel_id: str
    entry_point: int


class SessionResponse(BaseModel):
    id: str
    novel_id: str
    entry_point: int
    turns: List[dict]
    created_at: datetime
    updated_at: datetime
    
    class Config:
        from_attributes = True


class TurnRequest(BaseModel):
    mode: str  # "do" | "say" | "story" | "see"
    input: str
    action: str = "turn"  # "turn" | "continue" | "retry"


class TurnResponse(BaseModel):
    ai_response: str
    turn_index: int


# ============= API Endpoints =============

@router.get("/novels", response_model=List[NovelListItem])
async def get_novels_list(
    skip: int = 0,
    limit: int = 20,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """소설 목록 조회"""
    novels = await novel_service.get_novels(db, skip=skip, limit=limit)
    return [
        NovelListItem(
            id=str(n.id),
            title=n.title,
            author=n.author,
            created_at=n.created_at
        )
        for n in novels
    ]


@router.get("/novels/{novel_id}", response_model=NovelResponse)
async def get_novel_detail(
    novel_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """소설 상세 조회 (전문 + Story Cards)"""
    try:
        novel_uuid = uuid.UUID(novel_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid novel ID")
    
    novel = await novel_service.get_novel_by_id(db, novel_uuid)
    if not novel:
        raise HTTPException(status_code=404, detail="Novel not found")
    
    # story_cards가 문자열로 저장된 경우 JSON 파싱
    import json
    story_cards = novel.story_cards
    if isinstance(story_cards, str):
        try:
            story_cards = json.loads(story_cards)
        except json.JSONDecodeError:
            story_cards = {}
    
    return NovelResponse(
        id=str(novel.id),
        title=novel.title,
        author=novel.author,
        full_text=novel.full_text,
        story_cards=story_cards or {},
        created_at=novel.created_at
    )


@router.post("/sessions", response_model=SessionResponse)
async def create_session(
    request: SessionCreateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """세션 생성 (다이브 시작)"""
    try:
        novel_uuid = uuid.UUID(request.novel_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid novel ID")
    
    # Novel 존재 확인
    novel = await novel_service.get_novel_by_id(db, novel_uuid)
    if not novel:
        raise HTTPException(status_code=404, detail="Novel not found")
    
    # 세션 생성
    session = StoryDiveSession(
        user_id=current_user.id,
        novel_id=novel_uuid,
        entry_point=request.entry_point,
        turns=[]
    )
    
    db.add(session)
    await db.commit()
    await db.refresh(session)
    
    return SessionResponse(
        id=str(session.id),
        novel_id=str(session.novel_id),
        entry_point=session.entry_point,
        turns=session.turns or [],
        created_at=session.created_at,
        updated_at=session.updated_at
    )


@router.get("/sessions/{session_id}", response_model=SessionResponse)
async def get_session(
    session_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """세션 조회"""
    try:
        session_uuid = uuid.UUID(session_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid session ID")
    
    result = await db.execute(
        select(StoryDiveSession).where(StoryDiveSession.id == session_uuid)
    )
    session = result.scalar_one_or_none()
    
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    
    if session.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    return SessionResponse(
        id=str(session.id),
        novel_id=str(session.novel_id),
        entry_point=session.entry_point,
        turns=session.turns or [],
        created_at=session.created_at,
        updated_at=session.updated_at
    )


@router.post("/sessions/{session_id}/turn", response_model=TurnResponse)
async def process_turn(
    session_id: str,
    request: TurnRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """턴 진행 (Do/Say/Story/See + Continue/Retry)"""
    try:
        session_uuid = uuid.UUID(session_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid session ID")
    
    # 세션 조회
    result = await db.execute(
        select(StoryDiveSession).where(StoryDiveSession.id == session_uuid)
    )
    session = result.scalar_one_or_none()
    
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    
    if session.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    # Novel 조회
    novel = await novel_service.get_novel_by_id(db, session.novel_id)
    if not novel:
        raise HTTPException(status_code=404, detail="Novel not found")
    
    # 컨텍스트 텍스트 추출
    context_text = novel_service.get_context_text(novel.full_text, session.entry_point)
    
    # 턴 히스토리 구성 (deleted가 아닌 것만)
    turns = session.turns or []
    active_turns = [t for t in turns if not t.get("deleted", False)]
    
    # AI 히스토리 포맷
    history = []
    for turn in active_turns:
        if turn.get("user"):
            history.append({"role": "user", "content": turn["user"]})
        if turn.get("ai"):
            history.append({"role": "assistant", "content": turn["ai"]})
    
    # Action 처리
    if request.action == "retry":
        # 마지막 AI 응답을 deleted로 마킹하고, 하이라이트된 부분(마지막 5문장)을 기준으로 다시 생성
        if not active_turns:
            raise HTTPException(status_code=400, detail="No turn to retry")
        
        last_turn_idx = None
        last_mode = None
        last_ai_text = None
        
        for i in range(len(turns) - 1, -1, -1):
            if not turns[i].get("deleted", False):
                last_turn_idx = i
                last_mode = turns[i].get("mode", "do")
                last_ai_text = turns[i].get("ai", "")
                break
        
        if last_turn_idx is not None:
            turns[last_turn_idx]["deleted"] = True
            # 히스토리에서도 마지막 턴 완전히 제거
            if history and history[-1]["role"] == "assistant":
                history.pop()
            if history and history[-1]["role"] == "user":
                history.pop()
        
        # 마지막 AI 응답에서 마지막 5문장 추출
        if last_ai_text:
            sentences = last_ai_text.split('.')
            sentences = [s.strip() + '.' for s in sentences if s.strip()]
            last_five = sentences[-5:] if len(sentences) >= 5 else sentences
            highlighted_context = ' '.join(last_five)
        else:
            # AI 텍스트가 없으면 원작 컨텍스트 사용
            highlighted_context = context_text[:500]  # 간단히 앞부분만
        
        # Retry 응답 생성
        ai_response = await storydive_ai_service.get_retry_response(
            highlighted_context=highlighted_context,
            story_cards=novel.story_cards or {},
            context_text=context_text,
            history=history,
            mode=last_mode or "do",
            preferred_model=getattr(current_user, 'preferred_model', 'gemini-pro'),
            preferred_sub_model=getattr(current_user, 'preferred_sub_model', None),
            response_length_pref=getattr(current_user, 'response_length_pref', 'medium')
        )
        
        # 새 턴 추가
        new_turn = {
            "mode": last_mode or "do",
            "user": "",
            "ai": ai_response,
            "deleted": False,
            "created_at": datetime.utcnow().isoformat()
        }
        turns.append(new_turn)
        
        # DB 업데이트
        await db.execute(
            update(StoryDiveSession)
            .where(StoryDiveSession.id == session_uuid)
            .values(turns=turns, updated_at=datetime.utcnow())
        )
        await db.commit()
        
        return TurnResponse(
            ai_response=ai_response,
            turn_index=len(turns) - 1
        )
    
    elif request.action == "continue":
        # Continue 모드: 하이라이트된 마지막 5문장을 이어쓰기
        highlighted_context = ""
        
        if active_turns:
            # 마지막 AI 응답에서 마지막 5문장 추출
            last_ai_text = ""
            for turn in reversed(active_turns):
                if turn.get("ai"):
                    last_ai_text = turn["ai"]
                    break
            
            if last_ai_text:
                sentences = last_ai_text.split('.')
                sentences = [s.strip() + '.' for s in sentences if s.strip()]
                last_five = sentences[-5:] if len(sentences) >= 5 else sentences
                highlighted_context = ' '.join(last_five)
            else:
                # AI 텍스트가 없으면 원작에서 추출
                paragraphs = novel.full_text.split('\n')
                paragraphs = [p.strip() for p in paragraphs if p.strip()]
                start_idx = max(0, session.entry_point - 5)
                end_idx = session.entry_point + 1
                highlighted_context = ' '.join(paragraphs[start_idx:end_idx])
        else:
            # 턴이 없으면 원작 컨텍스트에서 마지막 5문장 (다이브 지점 기준)
            paragraphs = novel.full_text.split('\n')
            paragraphs = [p.strip() for p in paragraphs if p.strip()]
            start_idx = max(0, session.entry_point - 5)
            end_idx = session.entry_point + 1
            highlighted_context = ' '.join(paragraphs[start_idx:end_idx])
        
        ai_response = await storydive_ai_service.get_continue_response(
            last_ai_response=highlighted_context,
            story_cards=novel.story_cards or {},
            context_text=context_text,
            history=history,
            preferred_model=getattr(current_user, 'preferred_model', 'gemini-pro'),
            preferred_sub_model=getattr(current_user, 'preferred_sub_model', None),
            response_length_pref=getattr(current_user, 'response_length_pref', 'medium')
        )
        
        # 새 턴 추가
        new_turn = {
            "mode": "continue",
            "user": "",
            "ai": ai_response,
            "deleted": False,
            "created_at": datetime.utcnow().isoformat()
        }
        turns.append(new_turn)
        
        # DB 업데이트
        await db.execute(
            update(StoryDiveSession)
            .where(StoryDiveSession.id == session_uuid)
            .values(turns=turns, updated_at=datetime.utcnow())
        )
        await db.commit()
        
        return TurnResponse(
            ai_response=ai_response,
            turn_index=len(turns) - 1
        )
    
    # 일반 턴 (turn) 처리 - input 필요
    if request.action == "turn" and not request.input:
        raise HTTPException(status_code=400, detail="Input is required for turn action")
    
    # AI 응답 생성
    ai_response = await storydive_ai_service.get_storydive_response(
        novel_title=novel.title,
        story_cards=novel.story_cards or {},
        context_text=context_text,
        user_input=request.input,
        mode=request.mode,
        history=history,
        preferred_model=getattr(current_user, 'preferred_model', 'gemini-pro'),
        preferred_sub_model=getattr(current_user, 'preferred_sub_model', None),
        response_length_pref=getattr(current_user, 'response_length_pref', 'medium')
    )
    
    # 새 턴 추가
    new_turn = {
        "mode": request.mode,
        "user": request.input,
        "ai": ai_response,
        "deleted": False,
        "created_at": datetime.utcnow().isoformat()
    }
    turns.append(new_turn)
    
    # DB 업데이트
    await db.execute(
        update(StoryDiveSession)
        .where(StoryDiveSession.id == session_uuid)
        .values(turns=turns, updated_at=datetime.utcnow())
    )
    await db.commit()
    
    return TurnResponse(
        ai_response=ai_response,
        turn_index=len(turns) - 1
    )


@router.delete("/sessions/{session_id}/erase")
async def erase_last_turn(
    session_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """마지막 AI 응답 삭제 (Erase)"""
    try:
        session_uuid = uuid.UUID(session_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid session ID")
    
    # 세션 조회
    result = await db.execute(
        select(StoryDiveSession).where(StoryDiveSession.id == session_uuid)
    )
    session = result.scalar_one_or_none()
    
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    
    if session.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    turns = session.turns or []
    
    # 마지막 active 턴 찾기
    last_turn_idx = None
    for i in range(len(turns) - 1, -1, -1):
        if not turns[i].get("deleted", False):
            last_turn_idx = i
            break
    
    if last_turn_idx is None:
        raise HTTPException(status_code=400, detail="No turn to erase")
    
    # deleted 플래그 추가
    turns[last_turn_idx]["deleted"] = True
    
    # DB 업데이트
    await db.execute(
        update(StoryDiveSession)
        .where(StoryDiveSession.id == session_uuid)
        .values(turns=turns, updated_at=datetime.utcnow())
    )
    await db.commit()
    
    return {"message": "Turn erased successfully", "turn_index": last_turn_idx}

