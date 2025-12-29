"""
FAQ API

- 공개: FAQ 목록 조회
- 관리자: FAQ 생성/수정/삭제
"""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc, func
from typing import List, Optional
import uuid
import logging

from app.core.database import get_db
from app.core.security import get_current_user, get_current_user_optional
from app.models.user import User
from app.models.faq import FAQItem
from app.schemas.faq import FAQItemCreate, FAQItemUpdate, FAQItemResponse

logger = logging.getLogger(__name__)

router = APIRouter()


def _ensure_admin(user: User) -> None:
    """관리자 권한 방어 체크"""
    if not getattr(user, "is_admin", False):
        raise HTTPException(status_code=403, detail="관리자만 사용할 수 있습니다.")


@router.get("/", response_model=List[FAQItemResponse])
async def list_faq_items(
    include_all: bool = Query(False, description="관리자만: 비공개 포함"),
    db: AsyncSession = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user_optional),
):
    """FAQ 목록 조회"""
    try:
        stmt = select(FAQItem)
        is_admin = bool(getattr(current_user, "is_admin", False)) if current_user else False
        if not (is_admin and include_all):
            stmt = stmt.where(FAQItem.is_published == True)  # noqa: E712

        stmt = stmt.order_by(
            FAQItem.category.asc(),
            FAQItem.order_index.asc(),
            desc(FAQItem.created_at),
        )
        res = await db.execute(stmt)
        return list(res.scalars().all())
    except Exception as e:
        try:
            logger.exception(f"[faqs] list failed: {e}")
        except Exception:
            print(f"[faqs] list failed: {e}")
        raise HTTPException(status_code=500, detail="FAQ 목록 조회에 실패했습니다.")


@router.post("/", response_model=FAQItemResponse, status_code=status.HTTP_201_CREATED)
async def create_faq_item(
    payload: FAQItemCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """FAQ 생성(관리자)"""
    _ensure_admin(current_user)
    try:
        item = FAQItem(
            category=payload.category,
            question=payload.question,
            answer=payload.answer,
            order_index=int(payload.order_index or 0),
            is_published=payload.is_published is not False,
        )
        db.add(item)
        await db.commit()
        await db.refresh(item)
        return item
    except Exception as e:
        await db.rollback()
        try:
            logger.exception(f"[faqs] create failed: {e}")
        except Exception:
            print(f"[faqs] create failed: {e}")
        raise HTTPException(status_code=500, detail="FAQ 생성에 실패했습니다.")


@router.put("/{faq_id}", response_model=FAQItemResponse)
async def update_faq_item(
    faq_id: uuid.UUID,
    payload: FAQItemUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """FAQ 수정(관리자)"""
    _ensure_admin(current_user)
    stmt = select(FAQItem).where(FAQItem.id == faq_id)
    res = await db.execute(stmt)
    item = res.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="FAQ 항목을 찾을 수 없습니다.")

    try:
        if payload.category is not None:
            item.category = payload.category
        if payload.question is not None:
            item.question = payload.question
        if payload.answer is not None:
            item.answer = payload.answer
        if payload.order_index is not None:
            item.order_index = int(payload.order_index)
        if payload.is_published is not None:
            item.is_published = bool(payload.is_published)

        await db.commit()
        await db.refresh(item)
        return item
    except Exception as e:
        await db.rollback()
        try:
            logger.exception(f"[faqs] update failed: {e}")
        except Exception:
            print(f"[faqs] update failed: {e}")
        raise HTTPException(status_code=500, detail="FAQ 수정에 실패했습니다.")


@router.delete("/{faq_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_faq_item(
    faq_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """FAQ 삭제(관리자)"""
    _ensure_admin(current_user)
    stmt = select(FAQItem).where(FAQItem.id == faq_id)
    res = await db.execute(stmt)
    item = res.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="FAQ 항목을 찾을 수 없습니다.")

    try:
        await db.delete(item)
        await db.commit()
        return None
    except Exception as e:
        await db.rollback()
        try:
            logger.exception(f"[faqs] delete failed: {e}")
        except Exception:
            print(f"[faqs] delete failed: {e}")
        raise HTTPException(status_code=500, detail="FAQ 삭제에 실패했습니다.")


async def seed_default_faqs_if_empty(db: AsyncSession) -> int:
    """
    FAQ 기본 데이터 시드(멱등)
    - 테이블이 비어 있을 때만 기본 FAQ를 1회 삽입한다.
    - 운영/개발 모두에서 FAQ 화면이 빈 화면이 되는 것을 방지한다.
    """
    try:
        res = await db.execute(select(func.count()).select_from(FAQItem))
        cnt = int(res.scalar_one() or 0)
        if cnt > 0:
            return 0

        defaults = [
            # 계정 관련
            ("account", "회원가입은 어떻게 하나요?",
             '홈페이지 상단의 "회원가입" 버튼을 클릭하신 후, 이메일과 비밀번호를 입력하시면 됩니다. 이메일 인증을 완료하시면 바로 이용하실 수 있습니다.'),
            ("account", "비밀번호를 잊어버렸어요.",
             '로그인 페이지의 "비밀번호를 잊으셨나요?" 링크를 클릭하신 후, 가입하신 이메일 주소를 입력하시면 비밀번호 재설정 메일을 발송해드립니다.'),
            ("account", "이메일 인증 메일이 오지 않아요.",
             '스팸함을 확인해보시고, 그래도 없다면 인증 페이지에서 "재발송" 버튼을 클릭해주세요. 여전히 받지 못하신다면 1:1 문의를 통해 연락주시기 바랍니다.'),
            ("account", "계정을 삭제할 수 있나요?",
             "현재는 계정 삭제 기능을 제공하지 않습니다. 계정 삭제가 필요하시다면 1:1 문의를 통해 요청해주시기 바랍니다."),
            # 캐릭터 관련
            ("character", "캐릭터를 어떻게 만들 수 있나요?",
             '메인 페이지의 "캐릭터 만들기" 버튼을 클릭하시거나, 상단 메뉴에서 "내 캐릭터" → "캐릭터 만들기"를 선택하시면 됩니다. 캐릭터 이름, 설명, 성격 등을 입력하시면 됩니다.'),
            ("character", "캐릭터 이미지는 어떻게 추가하나요?",
             '캐릭터 상세 페이지에서 "대표이미지 생성/삽입" 버튼을 클릭하시면 AI로 이미지를 생성하거나 직접 업로드할 수 있습니다.'),
            ("character", "원작챗이 무엇인가요?",
             "원작챗은 웹소설이나 웹툰의 등장인물과 대화할 수 있는 기능입니다. 작품 상세 페이지에서 등장인물을 선택하시면 해당 캐릭터와 대화를 시작할 수 있습니다."),
            ("character", "캐릭터를 공개/비공개로 설정할 수 있나요?",
             "네, 캐릭터 상세 페이지에서 설정을 통해 공개 여부를 변경할 수 있습니다. 비공개로 설정하면 본인만 볼 수 있습니다."),
            # 채팅 관련
            ("chat", "채팅은 어떻게 시작하나요?",
             '캐릭터 카드를 클릭하시거나, 캐릭터 상세 페이지에서 "캐릭터챗 하기" 버튼을 클릭하시면 채팅을 시작할 수 있습니다.'),
            ("chat", "채팅 기록은 어디서 볼 수 있나요?",
             '상단 메뉴의 "채팅 기록"에서 이전 대화 내역을 확인할 수 있습니다.'),
            ("chat", "AI 모델을 변경할 수 있나요?",
             '채팅 중 "모델 선택" 버튼을 클릭하시면 다양한 AI 모델 중에서 선택할 수 있습니다. 각 모델마다 응답 스타일이 다릅니다.'),
            ("chat", "채팅이 너무 느려요.",
             "AI 모델에 따라 응답 속도가 다를 수 있습니다. 더 빠른 응답을 원하시면 \"모델 선택\"에서 빠른 모델을 선택해보세요."),
            # 작품 관련
            ("story", "작품을 어떻게 등록하나요?",
             '상단 메뉴의 "작품 만들기"를 클릭하신 후, 작품 정보를 입력하고 회차를 추가하시면 됩니다.'),
            ("story", "등장인물은 어떻게 추출하나요?",
             '작품 상세 페이지에서 "등장인물" 섹션의 "다시 생성하기" 버튼을 클릭하시면 AI가 자동으로 등장인물을 추출합니다.'),
            ("story", "작품을 수정/삭제할 수 있나요?",
             '작품 상세 페이지에서 "수정" 버튼을 클릭하시면 작품 정보와 회차를 수정할 수 있습니다. 삭제는 작품 설정에서 가능합니다.'),
            ("story", "작품을 공개/비공개로 설정할 수 있나요?",
             "네, 작품 상세 페이지에서 공개 여부를 설정할 수 있습니다."),
            # 결제 및 포인트
            ("payment", "포인트는 어떻게 충전하나요?",
             '상단 메뉴의 "포인트 충전"을 클릭하시면 결제 페이지로 이동합니다.'),
            ("payment", "포인트는 어디에 사용되나요?",
             "AI 이미지 생성, 프리미엄 기능 등에 포인트가 사용됩니다."),
            ("payment", "환불이 가능한가요?",
             "포인트 충전 후 미사용 포인트에 한해 환불이 가능합니다. 자세한 내용은 1:1 문의를 통해 문의해주세요."),
            # 기술 지원
            ("technical", "페이지가 제대로 로드되지 않아요.",
             "브라우저 캐시를 삭제하시거나 시크릿 모드로 접속해보세요. 문제가 계속되면 1:1 문의를 통해 문의해주세요."),
            ("technical", "이미지가 업로드되지 않아요.",
             "이미지 파일 형식(jpg, png, webp)과 크기(최대 10MB)를 확인해주세요. 그래도 안 되면 1:1 문의를 통해 문의해주세요."),
            ("technical", "오류 메시지가 나타나요.",
             "오류 메시지의 내용을 확인하시고, 1:1 문의를 통해 오류 내용과 함께 문의해주시면 빠르게 해결해드리겠습니다."),
        ]

        for i, (cat, q, a) in enumerate(defaults):
            db.add(FAQItem(category=cat, question=q, answer=a, order_index=i, is_published=True))
        await db.commit()
        return len(defaults)
    except Exception as e:
        await db.rollback()
        try:
            logger.warning(f"[faqs] seed failed(continue): {e}")
        except Exception:
            print(f"[faqs] seed failed(continue): {e}")
        return 0



