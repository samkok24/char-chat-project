"""
FAQ 카테고리(큰 항목) API

- 공개: 카테고리 목록 조회
- 관리자: 카테고리명(타이틀) 수정

의도:
- FAQ 항목(문답) CRUD와 분리하여, '큰 항목명'을 관리자에서 바꿀 수 있도록 한다.
- FAQItem.category는 문자열 id로 유지하여 기존 데이터/화면/정렬 로직을 깨지 않는다.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, asc, func
from typing import List
import logging

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.user import User
from app.models.faq_category import FAQCategory
from app.schemas.faq_category import FAQCategoryUpdate, FAQCategoryResponse

logger = logging.getLogger(__name__)

router = APIRouter()


DEFAULT_FAQ_CATEGORIES = [
    # (id, title)
    ("account", "계정 관련"),
    ("character", "캐릭터 관련"),
    ("chat", "채팅 관련"),
    ("story", "작품 관련"),
    ("payment", "결제 및 포인트"),
    ("technical", "기술 지원"),
]


def _ensure_admin(user: User) -> None:
    """관리자 권한 방어 체크"""
    if not getattr(user, "is_admin", False):
        raise HTTPException(status_code=403, detail="관리자만 사용할 수 있습니다.")


@router.get("/", response_model=List[FAQCategoryResponse])
async def list_faq_categories(
    db: AsyncSession = Depends(get_db),
):
    """FAQ 카테고리 목록 조회"""
    try:
        stmt = select(FAQCategory).order_by(
            asc(FAQCategory.order_index),
            asc(FAQCategory.id),
        )
        res = await db.execute(stmt)
        return list(res.scalars().all())
    except Exception as e:
        try:
            logger.exception(f"[faq_categories] list failed: {e}")
        except Exception:
            print(f"[faq_categories] list failed: {e}")
        raise HTTPException(status_code=500, detail="FAQ 카테고리 조회에 실패했습니다.")


@router.put("/{category_id}", response_model=FAQCategoryResponse)
async def upsert_faq_category(
    category_id: str,
    payload: FAQCategoryUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """FAQ 카테고리 수정(관리자) - 없으면 생성(방어적)"""
    _ensure_admin(current_user)

    cat_id = str(category_id or "").strip()
    if not cat_id or len(cat_id) > 50:
        raise HTTPException(status_code=400, detail="카테고리 ID가 올바르지 않습니다.")

    stmt = select(FAQCategory).where(FAQCategory.id == cat_id)
    res = await db.execute(stmt)
    cat = res.scalar_one_or_none()

    try:
        if not cat:
            # 방어적 업서트: 시드가 아직 안 된 환경에서도 관리자 수정으로 즉시 생성되게 한다.
            cat = FAQCategory(id=cat_id, title=payload.title, order_index=int(payload.order_index or 0))
            db.add(cat)
        else:
            cat.title = payload.title
            if payload.order_index is not None:
                cat.order_index = int(payload.order_index)

        await db.commit()
        await db.refresh(cat)
        return cat
    except Exception as e:
        await db.rollback()
        try:
            logger.exception(f"[faq_categories] upsert failed: {e}")
        except Exception:
            print(f"[faq_categories] upsert failed: {e}")
        raise HTTPException(status_code=500, detail="FAQ 카테고리 수정에 실패했습니다.")


async def seed_default_faq_categories_if_empty(db: AsyncSession) -> int:
    """
    FAQ 카테고리 기본 데이터 시드(멱등)
    - 테이블이 비어 있을 때만 기본 카테고리를 1회 삽입한다.
    - 프론트가 카테고리명을 서버에서 로드하므로, 초기 빈 화면/표시 깨짐을 방지한다.
    """
    try:
        res = await db.execute(select(func.count()).select_from(FAQCategory))
        cnt = int(res.scalar_one() or 0)
        if cnt > 0:
            return 0

        for i, (cid, title) in enumerate(DEFAULT_FAQ_CATEGORIES):
            db.add(FAQCategory(id=cid, title=title, order_index=i))

        await db.commit()
        return len(DEFAULT_FAQ_CATEGORIES)
    except Exception as e:
        await db.rollback()
        try:
            logger.warning(f"[faq_categories] seed failed(continue): {e}")
        except Exception:
            print(f"[faq_categories] seed failed(continue): {e}")
        return 0


