"""
결제 관련 API 엔드포인트
"""

from typing import Any, List
from datetime import datetime
import uuid
import json
import hashlib
import hmac
import logging
import base64
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import PlainTextResponse, RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc, func
from app.core.database import get_db, get_redis
from app.core.security import get_current_user
from redis.asyncio import Redis
from app.models import User, PaymentProduct, Payment
from app.schemas.payment import (
    PaymentProductResponse,
    PaymentProductCreate,
    PaymentCheckoutRequest,
    PaymentCheckoutResponse,
    PaymentWebhookRequest,
    PaymentResponse,
    PaymentHistoryResponse,
)
from app.services.point_service import PointService
from app.core.config import settings

logger = logging.getLogger(__name__)

router = APIRouter()

NICEPAY_SANDBOX_API = "https://sandbox-api.nicepay.co.kr"
NICEPAY_PROD_API = "https://api.nicepay.co.kr"
DEFAULT_PAYMENT_PRODUCTS = [
    {"name": "라이트", "description": "기본 충전 상품", "price": 2000, "point_amount": 200, "bonus_point": 0, "sort_order": 1},
    {"name": "베이직", "description": "보너스 포함 충전 상품", "price": 5000, "point_amount": 500, "bonus_point": 25, "sort_order": 2},
    {"name": "프리미엄", "description": "보너스 포함 충전 상품", "price": 10000, "point_amount": 1000, "bonus_point": 100, "sort_order": 3},
    {"name": "프로", "description": "추천 충전 상품", "price": 30000, "point_amount": 3000, "bonus_point": 400, "sort_order": 4},
    {"name": "마스터", "description": "최대 보너스 충전 상품", "price": 50000, "point_amount": 5000, "bonus_point": 800, "sort_order": 5},
]
NICEPAY_METHOD_ALIASES = {
    "card": "card",
    "easy": "cardAndEasyPay",
    "cardandeasypay": "cardAndEasyPay",
    "kakaopay": "kakaopay",
    "naverpaycard": "naverpayCard",
    "payco": "payco",
    "ssgpay": "ssgpay",
    "samsungpaycard": "samsungpayCard",
    "bank": "bank",
    "vbank": "vbank",
}


def _is_production_env() -> bool:
    try:
        return str(getattr(settings, "ENVIRONMENT", "") or "").strip().lower() == "production"
    except Exception:
        return False


def _normalize_signature(raw: str) -> str:
    s = str(raw or "").strip()
    if not s:
        return ""
    # Allow "sha256=<hex>" / "h1=<hex>" and plain "<hex>"
    if "=" in s:
        k, v = s.split("=", 1)
        if k.strip().lower() in {"sha256", "h1"}:
            return v.strip()
    return s


def _sha256_hex(data: str) -> str:
    return hashlib.sha256((data or "").encode("utf-8")).hexdigest()


def _int_or_zero(raw: Any) -> int:
    try:
        return int(str(raw).strip())
    except Exception:
        return 0


def _frontend_base_url() -> str:
    base = str(
        getattr(settings, "FRONTEND_BASE_URL", "")
        or getattr(settings, "FRONTEND_URL", "")
        or "http://localhost:5173"
    ).strip()
    return base.rstrip("/")


def _normalize_frontend_return_url(raw: str | None) -> str:
    base = _frontend_base_url()
    default_url = f"{base}/ruby/charge"
    if not raw:
        return default_url

    candidate = str(raw).strip()
    if not candidate:
        return default_url

    # 상대 경로 허용
    if candidate.startswith("/"):
        return f"{base}{candidate}"

    # 절대 URL 처리:
    # - production: 프론트 동일 origin만 허용(오픈 리다이렉트 방지)
    # - development: 로컬 테스트를 위해 전달된 절대 URL 허용
    try:
        bp = urlparse(base)
        cp = urlparse(candidate)
        if cp.scheme in {"http", "https"} and cp.netloc:
            if _is_production_env():
                if (cp.scheme, cp.netloc) == (bp.scheme, bp.netloc):
                    return candidate.split("#", 1)[0]
            else:
                return candidate.split("#", 1)[0]
    except Exception:
        pass

    return default_url


def _append_query_params(url: str, params: dict[str, Any]) -> str:
    parsed = urlparse(url)
    q = dict(parse_qsl(parsed.query, keep_blank_values=True))
    for k, v in params.items():
        if v is None:
            continue
        q[str(k)] = str(v)
    new_query = urlencode(q)
    return urlunparse((parsed.scheme, parsed.netloc, parsed.path, parsed.params, new_query, parsed.fragment))


def _result_redirect_url_by_status(return_url: str, result: str, order_id: str, message: str | None = None) -> str:
    return _append_query_params(
        return_url,
        {
            "payment_result": result,
            "payment_order_id": order_id,
            "payment_message": message or "",
        },
    )


def _result_redirect_url(return_url: str, ok: bool, order_id: str, message: str | None = None) -> str:
    return _result_redirect_url_by_status(return_url, "success" if ok else "failed", order_id, message)


def _extract_payment_meta(payment: Payment) -> dict[str, Any]:
    raw = payment.transaction_data
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
        if isinstance(parsed, dict):
            return parsed
    except Exception:
        pass
    return {}


def _set_payment_meta(payment: Payment, meta: dict[str, Any]) -> None:
    payment.transaction_data = json.dumps(meta or {}, ensure_ascii=False)


def _nicepay_client_key() -> str:
    return str(getattr(settings, "NICEPAY_CLIENT_KEY", "") or "").strip()


def _nicepay_secret_key() -> str:
    return str(getattr(settings, "NICEPAY_SECRET_KEY", "") or "").strip()


def _ensure_nicepay_config_or_raise() -> tuple[str, str]:
    client_key = _nicepay_client_key()
    secret_key = _nicepay_secret_key()
    if client_key and secret_key:
        return client_key, secret_key

    if _is_production_env():
        raise HTTPException(status_code=500, detail="NICEPAY 설정이 누락되었습니다")
    raise HTTPException(status_code=503, detail="NICEPAY 설정이 아직 준비되지 않았습니다")


def _nicepay_api_base_url() -> str:
    explicit = str(getattr(settings, "NICEPAY_API_BASE_URL", "") or "").strip()
    if explicit:
        return explicit.rstrip("/")
    use_sandbox = bool(getattr(settings, "NICEPAY_USE_SANDBOX", True))
    return NICEPAY_SANDBOX_API if use_sandbox else NICEPAY_PROD_API


def _nicepay_basic_auth(client_key: str, secret_key: str) -> str:
    creds = f"{client_key}:{secret_key}".encode("utf-8")
    return "Basic " + base64.b64encode(creds).decode("utf-8")


def _build_return_url(http_request: Request) -> str:
    # 운영 Nginx는 /api/*만 백엔드로 프록시한다.
    # 결제 리턴 URL은 항상 /api/payment/nicepay/return 로 고정해 405(프론트로 라우팅) 위험을 제거한다.
    forwarded_proto = str(http_request.headers.get("x-forwarded-proto") or "").split(",", 1)[0].strip().lower()
    if _is_production_env():
        # 운영(HTTPS 종단이 프록시/LB 앞단)에서는 경고 방지를 위해 리턴 URL을 강제로 HTTPS로 고정한다.
        scheme = "https"
    else:
        scheme = forwarded_proto or http_request.url.scheme or "http"
    host = (
        http_request.headers.get("x-forwarded-host")
        or http_request.headers.get("host")
        or http_request.url.netloc
    )
    return f"{scheme}://{host}/api/payment/nicepay/return"


def _nicepay_goods_name(ruby_amount: int, price: int) -> str:
    # 결제창 상품명을 충전탭 표기와 맞춤: "루비 {개수}개, {금액}원"
    # NICEPAY 가이드 byte 제한(40)을 넘지 않도록 UTF-8 기준으로 안전 절단.
    base = f"루비 {int(ruby_amount)}개, {int(price)}원"
    encoded = base.encode("utf-8")
    if len(encoded) <= 40:
        return base

    # 멀티바이트 경계 보호 절단
    cut = encoded[:40]
    while cut:
        try:
            return cut.decode("utf-8").rstrip()
        except UnicodeDecodeError:
            cut = cut[:-1]
    return "루비 충전"


def _normalize_checkout_method(raw_method: str | None) -> str:
    raw = str(raw_method or "card").strip()
    if not raw:
        raw = "card"
    key = raw.replace("-", "").replace("_", "").lower()
    method = NICEPAY_METHOD_ALIASES.get(key)
    if method:
        return method
    raise HTTPException(status_code=400, detail="지원하지 않는 결제수단입니다")


def _trim_utf8_bytes(text: str, max_bytes: int) -> str:
    src = str(text or "").strip()
    if not src:
        return ""
    encoded = src.encode("utf-8")
    if len(encoded) <= max_bytes:
        return src
    cut = encoded[:max_bytes]
    while cut:
        try:
            return cut.decode("utf-8").rstrip()
        except UnicodeDecodeError:
            cut = cut[:-1]
    return ""


def _nicepay_vbank_holder(raw_holder: str | None, fallback_name: str | None) -> str:
    holder = _trim_utf8_bytes(raw_holder or "", 40)
    if holder:
        return holder
    fallback = _trim_utf8_bytes(fallback_name or "입금자", 40)
    return fallback or "입금자"


async def _nicepay_approve(tid: str, amount: int, client_key: str, secret_key: str) -> dict[str, Any]:
    url = f"{_nicepay_api_base_url()}/v1/payments/{tid}"
    headers = {
        "Authorization": _nicepay_basic_auth(client_key, secret_key),
        "Content-Type": "application/json",
    }

    timeout = httpx.Timeout(connect=5.0, read=30.0, write=10.0, pool=10.0)
    async with httpx.AsyncClient(timeout=timeout) as client:
        resp = await client.post(url, headers=headers, json={"amount": amount})
        text = resp.text
        try:
            data = resp.json()
        except Exception:
            data = {"resultCode": str(resp.status_code), "resultMsg": text[:300]}

        if resp.status_code >= 400:
            msg = str(data.get("resultMsg") or text or "결제 승인에 실패했습니다")
            raise HTTPException(status_code=502, detail=f"NICEPAY 승인 실패: {msg}")

        return data


async def _nicepay_netcancel(order_id: str, client_key: str, secret_key: str) -> None:
    if not order_id:
        return
    url = f"{_nicepay_api_base_url()}/v1/payments/netcancel"
    headers = {
        "Authorization": _nicepay_basic_auth(client_key, secret_key),
        "Content-Type": "application/json",
    }
    timeout = httpx.Timeout(connect=5.0, read=10.0, write=10.0, pool=10.0)

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            await client.post(url, headers=headers, json={"orderId": order_id})
    except Exception as e:
        logger.warning("[nicepay] netcancel 실패(order_id=%s): %s", order_id, e)


def _verify_nicepay_auth_signature(auth_token: str, client_id: str, amount: int, signature: str, secret_key: str) -> bool:
    expected = _sha256_hex(f"{auth_token}{client_id}{amount}{secret_key}")
    sig = _normalize_signature(signature)
    return bool(sig) and hmac.compare_digest(sig, expected)


def _verify_nicepay_tx_signature(tid: str, amount: int, edi_date: str, signature: str, secret_key: str) -> bool:
    expected = _sha256_hex(f"{tid}{amount}{edi_date}{secret_key}")
    sig = _normalize_signature(signature)
    return bool(sig) and hmac.compare_digest(sig, expected)


async def _apply_payment_success(
    payment: Payment,
    db: AsyncSession,
    redis: Redis,
    approve_data: dict[str, Any],
) -> None:
    payment.status = "success"
    payment.paid_at = datetime.utcnow()
    payment.payment_key = str(approve_data.get("tid") or payment.payment_key or "") or None
    pay_method = str(approve_data.get("payMethod") or "").strip().lower()
    payment.payment_method = pay_method or payment.payment_method
    payment.failed_reason = None

    # point_service 내부 commit으로 payment 상태/트랜잭션까지 함께 반영
    point_service = PointService(redis, db)
    await point_service.charge_points(
        user_id=payment.user_id,
        amount=payment.point_amount,
        description=f"결제 충전 - 주문번호: {payment.order_id}",
        reference_type="payment",
        reference_id=str(payment.id),
    )


async def _mark_payment_failed(
    payment: Payment,
    db: AsyncSession,
    reason: str,
    extra_meta: dict[str, Any] | None = None,
) -> None:
    payment.status = "failed"
    payment.failed_reason = (reason or "결제 실패")[:300]
    meta = _extract_payment_meta(payment)
    if extra_meta:
        meta.update(extra_meta)
    _set_payment_meta(payment, meta)
    await db.commit()


async def _verify_webhook_signature_or_raise(request: Request) -> None:
    """
    Generic webhook signature verification (HMAC-SHA256).
    - Signature header: X-Webhook-Signature (or X-Signature)
    - Body: raw request bytes
    - Format: "sha256=<hex>" or "<hex>"
    """
    secret = str(getattr(settings, "PAYMENT_WEBHOOK_SECRET", "") or "").strip()
    if not secret:
        if _is_production_env():
            raise HTTPException(status_code=500, detail="PAYMENT_WEBHOOK_SECRET is not configured")
        logger.warning("[payment_webhook] PAYMENT_WEBHOOK_SECRET not set; signature check skipped in non-production")
        return

    sig_header = (
        request.headers.get("X-Webhook-Signature")
        or request.headers.get("X-Signature")
        or ""
    )
    signature = _normalize_signature(sig_header)
    if not signature:
        raise HTTPException(status_code=401, detail="Missing webhook signature")

    raw_body = await request.body()
    expected = hmac.new(secret.encode("utf-8"), raw_body, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(signature, expected):
        raise HTTPException(status_code=401, detail="Invalid webhook signature")


async def _ensure_default_products(db: AsyncSession) -> None:
    existing = await db.execute(select(func.count()).select_from(PaymentProduct))
    count = int(existing.scalar() or 0)
    if count > 0:
        return

    for item in DEFAULT_PAYMENT_PRODUCTS:
        db.add(PaymentProduct(**item))
    await db.commit()
    logger.info("[payment] default payment products seeded (%d)", len(DEFAULT_PAYMENT_PRODUCTS))


@router.get("/products", response_model=List[PaymentProductResponse])
async def get_payment_products(
    db: AsyncSession = Depends(get_db),
    is_active: bool = True,
):
    """
    결제 상품 목록 조회
    """
    await _ensure_default_products(db)

    query = select(PaymentProduct).where(PaymentProduct.is_active == is_active)
    query = query.order_by(PaymentProduct.sort_order)

    result = await db.execute(query)
    products = result.scalars().all()

    return products


@router.post("/products", response_model=PaymentProductResponse)
async def create_payment_product(
    product: PaymentProductCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    결제 상품 생성 (관리자 전용)
    """
    if not bool(getattr(current_user, "is_admin", False)):
        raise HTTPException(status_code=403, detail="관리자 권한이 필요합니다")

    db_product = PaymentProduct(**product.dict())
    db.add(db_product)
    await db.commit()
    await db.refresh(db_product)

    return db_product


@router.post("/checkout", response_model=PaymentCheckoutResponse)
async def create_checkout(
    checkout_request: PaymentCheckoutRequest,
    http_request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    NICEPAY Server 승인 모델 결제 요청 생성.
    - 서버에서 pending 주문 생성
    - 프론트는 응답의 request_payload를 AUTHNICE.requestPay(...)로 전달
    """
    client_key, secret_key = _ensure_nicepay_config_or_raise()
    requested_method = _normalize_checkout_method(checkout_request.method)
    await _ensure_default_products(db)

    result = await db.execute(
        select(PaymentProduct).where(
            PaymentProduct.id == checkout_request.product_id,
            PaymentProduct.is_active.is_(True),
        )
    )
    product = result.scalar_one_or_none()
    if not product:
        raise HTTPException(status_code=404, detail="상품을 찾을 수 없습니다")

    order_id = f"CH8_{uuid.uuid4().hex[:24]}"
    return_url = _normalize_frontend_return_url(checkout_request.return_url)
    vbank_holder = None
    if requested_method == "vbank":
        fallback_name = str(getattr(current_user, "username", "") or "").strip()
        vbank_holder = _nicepay_vbank_holder(checkout_request.vbank_holder, fallback_name)

    payment = Payment(
        user_id=str(current_user.id),
        product_id=str(product.id),
        amount=product.price,
        point_amount=product.point_amount + product.bonus_point,
        status="pending",
        order_id=order_id,
        payment_method=requested_method,
        transaction_data=json.dumps(
            {
                "provider": "nicepay",
                "stage": "created",
                "return_url": return_url,
                "requested_method": requested_method,
                "vbank_holder": vbank_holder if requested_method == "vbank" else None,
                "requested_at": datetime.utcnow().isoformat(),
            },
            ensure_ascii=False,
        ),
    )
    db.add(payment)
    await db.commit()

    request_payload = {
        "clientId": client_key,
        "method": requested_method,
        "orderId": order_id,
        "amount": int(product.price),
        "goodsName": _nicepay_goods_name(int(product.point_amount + product.bonus_point), int(product.price)),
        "returnUrl": _build_return_url(http_request),
        "mallReserved": f"pid={payment.id}",
        # 작은 뷰포트에서도 결제창 하단 버튼 접근 가능하도록 스크롤 허용
        "disableScroll": False,
    }
    if requested_method == "vbank":
        request_payload["vbankHolder"] = vbank_holder

    # secret_key 미사용 경고 방지 + 설정 검증 강제 의미
    _ = secret_key

    return PaymentCheckoutResponse(
        provider="nicepay",
        checkout_url=None,
        order_id=order_id,
        amount=product.price,
        request_payload=request_payload,
    )


@router.post("/nicepay/return")
async def nicepay_return(
    http_request: Request,
    db: AsyncSession = Depends(get_db),
    redis: Redis = Depends(get_redis),
):
    """
    NICEPAY 결제창 인증 결과(returnUrl POST) 처리.
    - authResultCode/sig 검증
    - 승인 API 호출
    - 성공 시 루비 적립 후 프론트로 리다이렉트
    """
    client_key, secret_key = _ensure_nicepay_config_or_raise()

    form = await http_request.form()
    auth_result_code = str(form.get("authResultCode") or "")
    auth_result_msg = str(form.get("authResultMsg") or "")
    tid = str(form.get("tid") or "")
    order_id = str(form.get("orderId") or "")
    client_id = str(form.get("clientId") or "")
    auth_token = str(form.get("authToken") or "")
    amount = _int_or_zero(form.get("amount"))
    signature = str(form.get("signature") or "")

    if not order_id:
        raise HTTPException(status_code=400, detail="orderId 누락")

    result = await db.execute(select(Payment).where(Payment.order_id == order_id))
    payment = result.scalar_one_or_none()
    if not payment:
        raise HTTPException(status_code=404, detail="결제 정보를 찾을 수 없습니다")

    meta = _extract_payment_meta(payment)
    return_url = _normalize_frontend_return_url(meta.get("return_url"))

    lock_key = f"payment:nicepay:return:{order_id}"
    lock_claimed = False
    try:
        lock_claimed = bool(await redis.set(lock_key, "1", ex=30, nx=True))
    except Exception:
        lock_claimed = True

    if not lock_claimed:
        if payment.status == "success":
            return RedirectResponse(_result_redirect_url(return_url, True, order_id), status_code=303)
        if payment.status != "pending":
            return RedirectResponse(_result_redirect_url(return_url, False, order_id, payment.failed_reason), status_code=303)

    if payment.status == "success":
        return RedirectResponse(_result_redirect_url(return_url, True, order_id), status_code=303)
    if payment.status != "pending":
        return RedirectResponse(_result_redirect_url(return_url, False, order_id, payment.failed_reason), status_code=303)

    # 1) 인증 결과 기본 검증
    if amount != int(payment.amount):
        await _mark_payment_failed(payment, db, "결제 금액 검증 실패", {"auth": dict(form)})
        return RedirectResponse(_result_redirect_url(return_url, False, order_id, "amount_mismatch"), status_code=303)

    if client_id != client_key:
        await _mark_payment_failed(payment, db, "클라이언트키 불일치", {"auth": dict(form)})
        return RedirectResponse(_result_redirect_url(return_url, False, order_id, "client_mismatch"), status_code=303)

    if auth_result_code != "0000":
        await _mark_payment_failed(payment, db, auth_result_msg or "인증 실패", {"auth": dict(form)})
        return RedirectResponse(_result_redirect_url(return_url, False, order_id, auth_result_msg or "auth_failed"), status_code=303)

    if not _verify_nicepay_auth_signature(auth_token, client_id, amount, signature, secret_key):
        await _mark_payment_failed(payment, db, "인증 서명 검증 실패", {"auth": dict(form)})
        return RedirectResponse(_result_redirect_url(return_url, False, order_id, "invalid_signature"), status_code=303)

    # 2) 승인 API 호출
    try:
        approve_data = await _nicepay_approve(tid=tid, amount=amount, client_key=client_key, secret_key=secret_key)
    except httpx.ReadTimeout:
        await _nicepay_netcancel(order_id, client_key, secret_key)
        await _mark_payment_failed(payment, db, "승인 타임아웃", {"auth": dict(form)})
        return RedirectResponse(_result_redirect_url(return_url, False, order_id, "approve_timeout"), status_code=303)
    except HTTPException as he:
        await _mark_payment_failed(payment, db, str(he.detail), {"auth": dict(form)})
        return RedirectResponse(_result_redirect_url(return_url, False, order_id, "approve_failed"), status_code=303)

    # 3) 승인 응답 검증
    result_code = str(approve_data.get("resultCode") or "")
    result_msg = str(approve_data.get("resultMsg") or "")
    approve_status = str(approve_data.get("status") or "")
    approve_tid = str(approve_data.get("tid") or tid)
    approve_amount = _int_or_zero(approve_data.get("amount"))
    approve_edi = str(approve_data.get("ediDate") or "")
    approve_sig = str(approve_data.get("signature") or "")

    if result_code != "0000" or approve_status not in {"paid", "ready"}:
        await _mark_payment_failed(
            payment,
            db,
            result_msg or "승인 실패",
            {"auth": dict(form), "approve": approve_data},
        )
        return RedirectResponse(_result_redirect_url(return_url, False, order_id, result_msg or "approve_failed"), status_code=303)

    if approve_amount != int(payment.amount):
        await _mark_payment_failed(
            payment,
            db,
            "승인 금액 검증 실패",
            {"auth": dict(form), "approve": approve_data},
        )
        return RedirectResponse(_result_redirect_url(return_url, False, order_id, "approve_amount_mismatch"), status_code=303)

    if approve_sig and approve_edi and not _verify_nicepay_tx_signature(approve_tid, approve_amount, approve_edi, approve_sig, secret_key):
        await _mark_payment_failed(
            payment,
            db,
            "승인 응답 서명 검증 실패",
            {"auth": dict(form), "approve": approve_data},
        )
        return RedirectResponse(_result_redirect_url(return_url, False, order_id, "approve_signature_invalid"), status_code=303)

    # 4) 승인 상태 반영
    meta.update(
        {
            "provider": "nicepay",
            "stage": "approved" if approve_status == "paid" else "ready",
            "auth": dict(form),
            "approve": approve_data,
            "approved_at": datetime.utcnow().isoformat(),
        }
    )
    _set_payment_meta(payment, meta)

    if approve_status == "ready":
        # vbank 발급 완료(입금 대기): pending 유지, 입금 확정(webhook paid)에서만 적립
        payment.payment_key = approve_tid or payment.payment_key
        pay_method = str(approve_data.get("payMethod") or "").strip().lower()
        if pay_method:
            payment.payment_method = pay_method
        payment.failed_reason = None
        await db.commit()
        return RedirectResponse(
            _result_redirect_url_by_status(
                return_url,
                "pending",
                order_id,
                "가상계좌가 발급되었습니다. 입금 확인 후 루비가 자동 충전됩니다.",
            ),
            status_code=303,
        )

    # paid: 성공 반영 및 적립
    try:
        await _apply_payment_success(payment, db, redis, approve_data)
    except Exception:
        try:
            await db.rollback()
        except Exception:
            pass
        raise

    return RedirectResponse(_result_redirect_url(return_url, True, order_id), status_code=303)


@router.post("/nicepay/webhook")
async def nicepay_webhook(
    http_request: Request,
    db: AsyncSession = Depends(get_db),
    redis: Redis = Depends(get_redis),
):
    """
    NICEPAY 결제 통보 웹훅.
    - 비동기 결제수단(vbank 등) 대비
    - 응답은 text/html "OK" 고정
    """
    try:
        payload = await http_request.json()
    except Exception:
        payload = {}

    if not isinstance(payload, dict):
        return PlainTextResponse("OK", media_type="text/html")

    client_key, secret_key = _ensure_nicepay_config_or_raise()
    _ = client_key

    order_id = str(payload.get("orderId") or "")
    tid = str(payload.get("tid") or "")
    status = str(payload.get("status") or "")
    result_code = str(payload.get("resultCode") or "")
    result_msg = str(payload.get("resultMsg") or "")
    amount = _int_or_zero(payload.get("amount"))
    edi_date = str(payload.get("ediDate") or "")
    signature = str(payload.get("signature") or "")

    if not order_id:
        return PlainTextResponse("OK", media_type="text/html")

    # payload 서명 검증(필드가 모두 있을 때)
    if signature and tid and edi_date:
        if not _verify_nicepay_tx_signature(tid, amount, edi_date, signature, secret_key):
            raise HTTPException(status_code=401, detail="Invalid NICEPAY webhook signature")

    idem_key = f"payment:nicepay:webhook:{tid}:{status}:{result_code}"
    try:
        claimed = await redis.set(idem_key, "1", ex=86400, nx=True)
    except Exception:
        claimed = True
    if not claimed:
        return PlainTextResponse("OK", media_type="text/html")

    result = await db.execute(select(Payment).where(Payment.order_id == order_id))
    payment = result.scalar_one_or_none()
    if not payment:
        return PlainTextResponse("OK", media_type="text/html")

    if payment.status != "pending":
        return PlainTextResponse("OK", media_type="text/html")

    meta = _extract_payment_meta(payment)
    meta.update({"webhook": payload, "webhook_received_at": datetime.utcnow().isoformat()})
    _set_payment_meta(payment, meta)

    if amount != int(payment.amount):
        await _mark_payment_failed(payment, db, "웹훅 금액 검증 실패", {"webhook": payload})
        return PlainTextResponse("OK", media_type="text/html")

    if result_code == "0000" and status == "ready":
        # vbank 발급 상태는 pending 유지(입금 완료 시 paid 웹훅에서 적립)
        payment.payment_key = tid or payment.payment_key
        pay_method = str(payload.get("payMethod") or "").strip().lower()
        if pay_method:
            payment.payment_method = pay_method
        payment.failed_reason = None
        meta["stage"] = "ready"
        _set_payment_meta(payment, meta)
        await db.commit()
        return PlainTextResponse("OK", media_type="text/html")

    if result_code == "0000" and status == "paid":
        try:
            await _apply_payment_success(payment, db, redis, payload)
        except Exception:
            try:
                await redis.delete(idem_key)
            except Exception:
                pass
            raise
        return PlainTextResponse("OK", media_type="text/html")

    await _mark_payment_failed(payment, db, result_msg or "웹훅 결제 실패", {"webhook": payload})
    return PlainTextResponse("OK", media_type="text/html")


@router.post("/webhook")
async def payment_webhook(
    webhook_data: PaymentWebhookRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    redis: Redis = Depends(get_redis),
):
    """
    범용 결제 웹훅 처리(기존 호환).
    """
    await _verify_webhook_signature_or_raise(request)

    idem_key = f"payment:webhook:{webhook_data.payment_key}:{webhook_data.status}"
    try:
        claimed = await redis.set(idem_key, "1", ex=86400, nx=True)
    except Exception:
        claimed = True
    if not claimed:
        return {"message": "Already processed"}

    result = await db.execute(select(Payment).where(Payment.order_id == webhook_data.order_id))
    payment = result.scalar_one_or_none()
    if not payment:
        raise HTTPException(status_code=404, detail="결제 정보를 찾을 수 없습니다")

    if payment.status != "pending":
        return {"message": "Already processed"}

    payment.payment_key = webhook_data.payment_key
    payment.transaction_data = json.dumps(webhook_data.transaction_data, ensure_ascii=False)

    try:
        if webhook_data.status == "success":
            payment.status = "success"
            payment.paid_at = datetime.utcnow()

            point_service = PointService(redis, db)
            await point_service.charge_points(
                user_id=payment.user_id,
                amount=payment.point_amount,
                description=f"결제 충전 - 주문번호: {payment.order_id}",
                reference_type="payment",
                reference_id=str(payment.id),
            )
        else:
            payment.status = "failed"
            payment.failed_reason = webhook_data.transaction_data.get("message", "Unknown error")
            await db.commit()

        return {"message": "OK"}
    except Exception:
        try:
            await redis.delete(idem_key)
        except Exception:
            pass
        raise


@router.get("/history", response_model=PaymentHistoryResponse)
async def get_payment_history(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    limit: int = 20,
    offset: int = 0,
):
    """
    결제 내역 조회
    """
    count_query = select(func.count()).select_from(Payment).where(
        Payment.user_id == str(current_user.id)
    )
    total_count = await db.execute(count_query)
    total_count = total_count.scalar()

    query = (
        select(Payment)
        .where(Payment.user_id == str(current_user.id))
        .order_by(desc(Payment.created_at))
        .limit(limit)
        .offset(offset)
    )

    result = await db.execute(query)
    payments = result.scalars().all()

    total_amount = sum(p.amount for p in payments if p.status == "success")

    return PaymentHistoryResponse(
        payments=payments,
        total_count=total_count,
        total_amount=total_amount,
    )


@router.get("/payment/{payment_id}", response_model=PaymentResponse)
async def get_payment_detail(
    payment_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    결제 상세 정보 조회
    """
    result = await db.execute(
        select(Payment).where(
            Payment.id == payment_id,
            Payment.user_id == str(current_user.id),
        )
    )
    payment = result.scalar_one_or_none()

    if not payment:
        raise HTTPException(status_code=404, detail="결제 정보를 찾을 수 없습니다")

    return payment
