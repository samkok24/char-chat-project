"""
이메일 발송 서비스
"""

from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
import smtplib
import ssl
import asyncio
import logging

from app.core.config import settings


logger = logging.getLogger(__name__)


def _build_verification_email(to_email: str, verify_url: str) -> tuple[str, str, str]:
    """인증 메일 제목/텍스트/HTML 생성"""
    subject = "[AI 캐릭터 챗] 이메일 인증을 완료해주세요"
    text = (
        "안녕하세요, AI 캐릭터 챗입니다.\n\n"
        "아래 링크를 클릭하여 이메일 인증을 완료해주세요:\n"
        f"{verify_url}\n\n"
        "본 메일은 24시간 동안만 유효합니다.\n"
        "만약 본 메일을 요청하지 않으셨다면 무시하셔도 됩니다."
    )
    html = f"""
    <div style="font-family: Pretendard, system-ui, -apple-system, Segoe UI, Roboto, Noto Sans, sans-serif; color:#111;">
      <h2>이메일 인증을 완료해주세요</h2>
      <p>안녕하세요, AI 캐릭터 챗입니다.</p>
      <p>아래 버튼을 눌러 이메일 인증을 완료해주세요. 링크는 24시간 동안 유효합니다.</p>
      <p>
        <a href="{verify_url}" style="display:inline-block;padding:12px 16px;background:#7c3aed;color:#fff;text-decoration:none;border-radius:8px;">이메일 인증하기</a>
      </p>
      <p>만약 버튼이 동작하지 않으면 다음 링크를 복사해 브라우저 주소창에 붙여넣으세요.</p>
      <p><a href="{verify_url}">{verify_url}</a></p>
      <hr style="margin:20px 0;border:none;border-top:1px solid #e5e7eb;" />
      <p style="font-size:12px;color:#6b7280;">본 메일은 발신 전용입니다.</p>
    </div>
    """
    return subject, text, html


def _send_email_sync(to_email: str, subject: str, text: str, html: str) -> None:
    """동기 SMTP 전송 (스레드 풀에서 실행)"""
    if not settings.SMTP_HOST:
        # 개발 환경: 실제 발송 없이 로그로 대체
        logger.info("[DEV] 이메일 미발송 (SMTP 미설정) → 제목: %s, 수신자: %s", subject, to_email)
        return

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = f"{settings.EMAIL_FROM_NAME} <{settings.EMAIL_FROM_ADDRESS}>"
    msg["To"] = to_email

    part1 = MIMEText(text, "plain", "utf-8")
    part2 = MIMEText(html, "html", "utf-8")
    msg.attach(part1)
    msg.attach(part2)

    context = ssl.create_default_context()
    if settings.SMTP_USE_SSL:
        with smtplib.SMTP_SSL(settings.SMTP_HOST, settings.SMTP_PORT, context=context) as server:
            if settings.SMTP_USERNAME and settings.SMTP_PASSWORD:
                server.login(settings.SMTP_USERNAME, settings.SMTP_PASSWORD)
            server.sendmail(settings.EMAIL_FROM_ADDRESS, [to_email], msg.as_string())
    else:
        with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT) as server:
            if settings.SMTP_USE_TLS:
                server.starttls(context=context)
            if settings.SMTP_USERNAME and settings.SMTP_PASSWORD:
                server.login(settings.SMTP_USERNAME, settings.SMTP_PASSWORD)
            server.sendmail(settings.EMAIL_FROM_ADDRESS, [to_email], msg.as_string())


async def send_verification_email(to_email: str, token: str) -> None:
    """이메일 인증 메일 발송 (비동기)"""
    verify_url = f"{settings.FRONTEND_BASE_URL}/verify?token={token}"
    subject, text, html = _build_verification_email(to_email, verify_url)
    loop = asyncio.get_running_loop()
    await loop.run_in_executor(None, _send_email_sync, to_email, subject, text, html)


