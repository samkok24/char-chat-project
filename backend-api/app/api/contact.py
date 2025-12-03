"""
1:1 문의 API
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel, EmailStr
from typing import Optional
import asyncio
import logging

from app.core.database import get_db
from app.core.config import settings
from app.core.security import get_current_user_optional
from app.models.user import User
from app.services.mail_service import _send_email_sync

router = APIRouter()
logger = logging.getLogger(__name__)


class ContactRequest(BaseModel):
    """1:1 문의 요청 스키마"""
    name: str
    email: EmailStr
    subject: str
    message: str
    user_id: Optional[str] = None  # 로그인한 유저의 경우


@router.post("/contact")
async def submit_contact(
    contact_data: ContactRequest,
    db: AsyncSession = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user_optional),
):
    """1:1 문의 제출"""
    try:
        # 관리자 이메일 주소 (환경 변수에서 가져오거나 기본값 사용)
        admin_email = settings.ADMIN_EMAIL or settings.EMAIL_FROM_ADDRESS
        
        # 유저 정보 포함
        user_info = ""
        if current_user:
            user_info = f"""
            <p><strong>유저 정보:</strong></p>
            <ul>
                <li>유저 ID: {current_user.id}</li>
                <li>이메일: {current_user.email}</li>
                <li>사용자명: {current_user.username}</li>
            </ul>
            """
        elif contact_data.user_id:
            user_info = f"<p><strong>유저 ID:</strong> {contact_data.user_id}</p>"
        else:
            user_info = "<p><strong>비회원 문의</strong></p>"
        
        # 이메일 내용 구성
        subject = f"[1:1 문의] {contact_data.subject}"
        text = f"""
1:1 문의가 접수되었습니다.

{user_info}

문의자 정보:
- 이름: {contact_data.name}
- 이메일: {contact_data.email}
- 제목: {contact_data.subject}

문의 내용:
{contact_data.message}
        """
        
        html = f"""
        <div style="font-family: Pretendard, system-ui, -apple-system, Segoe UI, Roboto, Noto Sans, sans-serif; color:#111;">
            <h2>1:1 문의가 접수되었습니다</h2>
            {user_info}
            <hr style="margin:20px 0;border:none;border-top:1px solid #e5e7eb;" />
            <h3>문의자 정보</h3>
            <ul>
                <li><strong>이름:</strong> {contact_data.name}</li>
                <li><strong>이메일:</strong> {contact_data.email}</li>
                <li><strong>제목:</strong> {contact_data.subject}</li>
            </ul>
            <hr style="margin:20px 0;border:none;border-top:1px solid #e5e7eb;" />
            <h3>문의 내용</h3>
            <div style="background:#f9fafb;padding:16px;border-radius:8px;white-space:pre-wrap;">{contact_data.message}</div>
        </div>
        """
        
        # 관리자에게 이메일 발송
        if settings.SMTP_HOST:
            loop = asyncio.get_running_loop()
            await loop.run_in_executor(
                None, 
                _send_email_sync, 
                admin_email, 
                subject, 
                text, 
                html
            )
            logger.info(f"1:1 문의 이메일 발송 완료: {contact_data.email} → {admin_email}")
        else:
            logger.warning(f"[DEV] 1:1 문의 (SMTP 미설정): {contact_data.email} - {contact_data.subject}")
        
        return {"message": "문의가 접수되었습니다. 빠른 시일 내에 답변드리겠습니다."}
        
    except Exception as e:
        logger.error(f"1:1 문의 처리 실패: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="문의 접수 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요."
        )

