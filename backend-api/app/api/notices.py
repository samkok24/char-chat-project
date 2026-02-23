"""
공지사항 API

- 공개: 목록/상세/최신 메타 조회
- 관리자: 생성/수정/삭제
"""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, desc
from typing import List, Optional
import uuid
import logging

from app.core.database import get_db
from app.core.security import get_current_user, get_current_user_optional
from app.models.user import User
from app.models.notice import Notice
from app.schemas.notice import NoticeCreate, NoticeUpdate, NoticeResponse, NoticeLatestResponse

logger = logging.getLogger(__name__)

router = APIRouter()


def _ensure_admin(user: User) -> None:
    """관리자 권한 방어 체크"""
    if not getattr(user, "is_admin", False):
        raise HTTPException(status_code=403, detail="관리자만 사용할 수 있습니다.")


@router.get("/", response_model=List[NoticeResponse])
async def list_notices(
    include_all: bool = Query(False, description="관리자만: 비공개/미게시 포함"),
    db: AsyncSession = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user_optional),
):
    """공지 목록 조회"""
    try:
        stmt = select(Notice)
        is_admin = bool(getattr(current_user, "is_admin", False)) if current_user else False
        if not (is_admin and include_all):
            stmt = stmt.where(Notice.is_published == True)  # noqa: E712
        # 상단 고정 먼저, 최신순
        stmt = stmt.order_by(desc(Notice.is_pinned), desc(Notice.created_at))
        res = await db.execute(stmt)
        return list(res.scalars().all())
    except Exception as e:
        try:
            logger.exception(f"[notices] list failed: {e}")
        except Exception:
            print(f"[notices] list failed: {e}")
        raise HTTPException(status_code=500, detail="공지 목록 조회에 실패했습니다.")


@router.get("/latest", response_model=NoticeLatestResponse)
async def latest_notice_meta(
    db: AsyncSession = Depends(get_db),
):
    """최신 공지 시각(빨간 점 표시용)"""
    try:
        stmt = select(func.max(Notice.created_at)).where(Notice.is_published == True)  # noqa: E712
        res = await db.execute(stmt)
        latest_at = res.scalar_one_or_none()
        return NoticeLatestResponse(latest_at=latest_at)
    except Exception as e:
        try:
            logger.exception(f"[notices] latest failed: {e}")
        except Exception:
            print(f"[notices] latest failed: {e}")
        # 방어: 실패해도 UI는 점을 숨기면 되므로 200 + null 반환
        return NoticeLatestResponse(latest_at=None)


@router.get("/{notice_id}", response_model=NoticeResponse)
async def get_notice(
    notice_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user_optional),
):
    """공지 상세 조회"""
    stmt = select(Notice).where(Notice.id == notice_id)
    res = await db.execute(stmt)
    notice = res.scalar_one_or_none()
    if not notice:
        raise HTTPException(status_code=404, detail="공지사항을 찾을 수 없습니다.")

    # 비게시 공지는 관리자만
    if notice.is_published is False:
        is_admin = bool(getattr(current_user, "is_admin", False)) if current_user else False
        if not is_admin:
            raise HTTPException(status_code=404, detail="공지사항을 찾을 수 없습니다.")

    return notice


@router.post("/", response_model=NoticeResponse, status_code=status.HTTP_201_CREATED)
async def create_notice(
    payload: NoticeCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """공지 생성(관리자)"""
    _ensure_admin(current_user)
    try:
        notice = Notice(
            title=payload.title,
            content=payload.content,
            is_pinned=bool(payload.is_pinned),
            is_published=payload.is_published is not False,
        )
        db.add(notice)
        await db.commit()
        await db.refresh(notice)
        return notice
    except Exception as e:
        await db.rollback()
        try:
            logger.exception(f"[notices] create failed: {e}")
        except Exception:
            print(f"[notices] create failed: {e}")
        raise HTTPException(status_code=500, detail="공지 생성에 실패했습니다.")


@router.put("/{notice_id}", response_model=NoticeResponse)
async def update_notice(
    notice_id: uuid.UUID,
    payload: NoticeUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """공지 수정(관리자)"""
    _ensure_admin(current_user)
    stmt = select(Notice).where(Notice.id == notice_id)
    res = await db.execute(stmt)
    notice = res.scalar_one_or_none()
    if not notice:
        raise HTTPException(status_code=404, detail="공지사항을 찾을 수 없습니다.")

    try:
        if payload.title is not None:
            notice.title = payload.title
        if payload.content is not None:
            notice.content = payload.content
        if payload.is_pinned is not None:
            notice.is_pinned = bool(payload.is_pinned)
        if payload.is_published is not None:
            notice.is_published = bool(payload.is_published)

        await db.commit()
        await db.refresh(notice)
        return notice
    except Exception as e:
        await db.rollback()
        try:
            logger.exception(f"[notices] update failed: {e}")
        except Exception:
            print(f"[notices] update failed: {e}")
        raise HTTPException(status_code=500, detail="공지 수정에 실패했습니다.")


@router.delete("/{notice_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_notice(
    notice_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """공지 삭제(관리자)"""
    _ensure_admin(current_user)
    stmt = select(Notice).where(Notice.id == notice_id)
    res = await db.execute(stmt)
    notice = res.scalar_one_or_none()
    if not notice:
        raise HTTPException(status_code=404, detail="공지사항을 찾을 수 없습니다.")

    try:
        await db.delete(notice)
        await db.commit()
        return None
    except Exception as e:
        await db.rollback()
        try:
            logger.exception(f"[notices] delete failed: {e}")
        except Exception:
            print(f"[notices] delete failed: {e}")
        raise HTTPException(status_code=500, detail="공지 삭제에 실패했습니다.")