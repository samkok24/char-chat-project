# Paddle 결제 연동 개발기획

**작성일**: 2026-02-22
**상태**: 기획 (구현 전)
**참조**: `PRICING_AND_PAYMENT_PLAN.md`

---

## 1. 개요

### 1-1. 목표
Paddle Billing API를 연동하여 루비 충전 결제를 처리한다.

### 1-2. Paddle 선택 이유
- **MoR(Merchant of Record)**: Paddle이 판매자 역할 → 세금/부가세 자동 처리
- **한국 결제수단**: 신용/체크카드(22개+), 네이버페이, 카카오페이, 삼성페이, 페이코
- **글로벌**: PayPal, Apple Pay, Google Pay, Visa, Mastercard
- **Overlay Checkout**: 프론트엔드에 JS 2줄로 결제 UI 삽입

### 1-3. Paddle 수수료
- 거래당 **5% + $0.50** (일회성 결제)
- 정기결제: 5% + $0.50
- 환불 시 수수료 미반환

### 1-4. 결제 흐름 요약

```
[유저] 충전 상품 선택
  ↓
[프론트] Paddle.Checkout.open({ priceId, customData: { user_id } })
  ↓
[Paddle] Overlay 결제 UI 표시 (카드/네이버/카카오 등)
  ↓
[유저] 결제 완료
  ↓
[Paddle] → POST /payment/paddle-webhook  (transaction.completed)
  ↓
[백엔드] 서명 검증 → 루비 지급 → DB 기록
  ↓
[프론트] Checkout 성공 콜백 → 잔액 새로고침
```

---

## 2. Paddle 사전 설정 (대시보드)

### 2-1. 계정 생성
1. https://www.paddle.com 에서 Seller 계정 생성
2. **Sandbox 환경** 먼저 사용 (테스트)
3. 본인 인증 + 사업자 등록 (한국 사업자 가능)

### 2-2. Products & Prices 등록

Paddle 대시보드에서 5개 상품 생성:

| 상품명 | Paddle Product | Paddle Price | 가격 (KRW) | 루비 |
|--------|---------------|-------------|-----------|------|
| 라이트 | `prod_lite` | `pri_lite` | 2,000 | 200 |
| 베이직 | `prod_basic` | `pri_basic` | 5,000 | 525 |
| 프리미엄 | `prod_premium` | `pri_premium` | 10,000 | 1,100 |
| 프로 | `prod_pro` | `pri_pro` | 30,000 | 3,400 |
| 마스터 | `prod_master` | `pri_master` | 50,000 | 5,800 |

> 모두 **one-time(일회성)** price로 생성. 구독은 Phase 5에서 별도.

### 2-3. Webhook 설정
- **URL**: `https://api.chapter8.app/payment/paddle-webhook`
- **Events**: `transaction.completed`, `transaction.payment_failed`
- **Webhook Secret Key**: 대시보드에서 복사 → 환경변수에 저장

### 2-4. 키 수집

| 키 | 위치 | 용도 |
|----|------|------|
| **Client-side Token** | Paddle 대시보드 → Developer Tools → Authentication | Paddle.js 초기화 |
| **API Key** | 같은 위치 | 서버 사이드 API 호출 |
| **Webhook Secret** | Notifications → Webhooks | 웹훅 서명 검증 |

---

## 3. 백엔드 변경사항

### 3-1. 환경변수 추가

**파일**: `backend-api/.env`

```env
# Paddle
PADDLE_API_KEY=pdl_live_xxxxx          # 서버 사이드 API 키
PADDLE_WEBHOOK_SECRET=pdl_ntfset_xxxxx  # 웹훅 서명 검증용
PADDLE_CLIENT_TOKEN=live_xxxxx          # 프론트로 전달할 클라이언트 토큰
PADDLE_ENVIRONMENT=sandbox              # sandbox | production
```

**파일**: `backend-api/app/core/config.py`

```python
# Settings 클래스에 추가
PADDLE_API_KEY: str = ""
PADDLE_WEBHOOK_SECRET: str = ""
PADDLE_CLIENT_TOKEN: str = ""
PADDLE_ENVIRONMENT: str = "sandbox"  # sandbox | production
```

### 3-2. Paddle 상품 매핑 (config)

**파일**: `backend-api/app/core/paddle_config.py` (신규)

```python
"""Paddle price_id → 루비 지급 매핑 (SSOT)"""

PADDLE_PRICE_MAP = {
    # price_id: (상품명, 루비 지급량, 가격 KRW)
    "pri_lite":    ("라이트",   200,   2_000),
    "pri_basic":   ("베이직",   525,   5_000),
    "pri_premium": ("프리미엄", 1_100, 10_000),
    "pri_pro":     ("프로",     3_400, 30_000),
    "pri_master":  ("마스터",   5_800, 50_000),
}

def get_ruby_amount(price_id: str) -> int | None:
    """price_id로 지급할 루비 수량 조회. 없으면 None."""
    entry = PADDLE_PRICE_MAP.get(price_id)
    return entry[1] if entry else None
```

> 실제 `pri_xxx` 값은 Paddle 대시보드에서 생성 후 교체.

### 3-3. Webhook 엔드포인트 수정

**파일**: `backend-api/app/api/payment.py`

기존 스캐폴딩된 `/payment/webhook`을 Paddle 전용으로 교체.

#### 핵심 로직

```python
@router.post("/paddle-webhook")
async def paddle_webhook(request: Request):
    """
    Paddle 웹훅 수신 처리
    1. 서명 검증 (Paddle-Signature 헤더)
    2. 이벤트 타입 분기
    3. transaction.completed → 루비 지급
    4. 멱등성 보장 (transaction_id 중복 체크)
    """
```

#### 서명 검증

Paddle 웹훅은 `Paddle-Signature` 헤더로 HMAC-SHA256 서명을 보냄:

```
Paddle-Signature: ts=1234567890;h1=서명값
```

검증 로직:
```python
import hashlib, hmac

def verify_paddle_signature(raw_body: bytes, signature_header: str, secret: str) -> bool:
    parts = dict(p.split("=", 1) for p in signature_header.split(";"))
    ts = parts.get("ts", "")
    h1 = parts.get("h1", "")

    signed_payload = f"{ts}:{raw_body.decode('utf-8')}"
    expected = hmac.new(secret.encode(), signed_payload.encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(h1, expected)
```

#### 멱등성 처리

```python
# Redis로 transaction_id 중복 체크
idempotency_key = f"paddle:txn:{transaction_id}"
already = await redis_client.set(idempotency_key, "1", nx=True, ex=86400)
if not already:
    return {"ok": True}  # 이미 처리됨, 200 반환 (Paddle 재시도 방지)
```

#### transaction.completed 처리

```python
# 웹훅 payload에서 추출
transaction_id = data["data"]["id"]              # "txn_xxxxx"
status = data["data"]["status"]                    # "completed"
custom_data = data["data"]["custom_data"]          # {"user_id": "uuid"}
items = data["data"]["items"]                      # [{price: {id: "pri_lite"}, quantity: 1}]
totals = data["data"]["details"]["totals"]         # {"total": "2000", "currency_code": "KRW"}

# 1. user_id 추출
user_id = custom_data["user_id"]

# 2. price_id → 루비 수량 조회
price_id = items[0]["price"]["id"]
ruby_amount = get_ruby_amount(price_id)

# 3. 루비 지급 (기존 point_service 활용)
await point_service.charge_points(
    user_id=user_id,
    amount=ruby_amount,
    description=f"루비 충전 ({product_name})",
    reference_type="paddle_payment",
    reference_id=transaction_id,
)

# 4. DB에 결제 기록 저장
payment = Payment(
    user_id=uuid.UUID(user_id),
    amount=int(totals["total"]),
    point_amount=ruby_amount,
    status="success",
    payment_method="paddle",
    payment_key=transaction_id,
    order_id=transaction_id,
    transaction_data=json.dumps(data["data"]),
    paid_at=datetime.utcnow(),
)
```

### 3-4. 클라이언트 토큰 API

프론트엔드에서 Paddle.js 초기화에 필요한 토큰을 받는 엔드포인트:

```python
@router.get("/paddle-config")
async def get_paddle_config():
    """Paddle 클라이언트 설정 반환 (공개 정보만)"""
    return {
        "client_token": settings.PADDLE_CLIENT_TOKEN,
        "environment": settings.PADDLE_ENVIRONMENT,
    }
```

### 3-5. 상품 목록 API 수정

기존 `GET /payment/products`를 Paddle price_id 기반으로 수정:

```python
@router.get("/products")
async def get_payment_products():
    """충전 상품 목록 (Paddle price_id 포함)"""
    products = []
    for price_id, (name, rubies, price_krw) in PADDLE_PRICE_MAP.items():
        bonus = rubies - (price_krw // 10)  # 보너스 계산
        products.append({
            "price_id": price_id,
            "name": name,
            "price": price_krw,
            "rubies": rubies,
            "bonus": bonus if bonus > 0 else 0,
            "ruby_per_won": round(price_krw / rubies, 1),
        })
    return {"products": products}
```

> DB `payment_products` 테이블 대신 `paddle_config.py`의 딕셔너리가 SSOT.
> DB 테이블은 결제 이력(`payments`)에만 사용.

### 3-6. 기존 코드 정리

| 기존 | 처리 |
|------|------|
| `POST /payment/checkout` | 제거 (Paddle.js가 대체) |
| `POST /payment/webhook` | `POST /payment/paddle-webhook`으로 교체 |
| `POST /payment/products` (상품 생성) | 제거 (Paddle 대시보드에서 관리) |
| `GET /payment/products` | 수정 (PADDLE_PRICE_MAP 기반) |
| `GET /payment/history` | 유지 |
| `GET /payment/payment/{id}` | 유지 |
| `point_service.charge_points()` | 유지 (그대로 사용) |
| `point_service.use_points_atomic()` | 유지 (채팅 차감에 사용) |

---

## 4. 프론트엔드 변경사항

### 4-1. Paddle.js 설치

```bash
npm install @paddle/paddle-js
```

### 4-2. Paddle 초기화 (App.jsx 또는 전용 훅)

**파일**: `frontend/char-chat-frontend/src/hooks/usePaddle.js` (신규)

```javascript
import { initializePaddle } from '@paddle/paddle-js';
import { useEffect, useState } from 'react';

export function usePaddle() {
  const [paddle, setPaddle] = useState(null);

  useEffect(() => {
    async function init() {
      // 백엔드에서 config 가져오기
      const res = await fetch('/api/payment/paddle-config');
      const { client_token, environment } = await res.json();

      const instance = await initializePaddle({
        token: client_token,
        environment: environment,  // 'sandbox' | 'production'
      });
      setPaddle(instance);
    }
    init();
  }, []);

  return paddle;
}
```

### 4-3. RubyChargePage.jsx 리뉴얼

기존 하드코딩 4상품 → Paddle 연동 5상품 + 2탭 구조.

#### 핵심 변경점

```jsx
// 충전 버튼 클릭 시
const handlePurchase = (product) => {
  if (!paddle) return;

  paddle.Checkout.open({
    items: [{ priceId: product.price_id, quantity: 1 }],
    customData: {
      user_id: user.id,        // 웹훅에서 유저 식별용
    },
    customer: {
      email: user.email,        // 이메일 자동 입력
    },
    settings: {
      displayMode: 'overlay',   // 오버레이 모달
      theme: 'dark',            // 다크 모드
      locale: 'ko',             // 한국어
      successUrl: `${window.location.origin}/ruby/charge?success=true`,
    },
  });
};
```

#### Checkout 성공 콜백

```jsx
// Paddle 이벤트 리스너 (초기화 시 등록)
const instance = await initializePaddle({
  token: client_token,
  environment: environment,
  eventCallback: (event) => {
    if (event.name === 'checkout.completed') {
      // 결제 완료 → 잔액 새로고침
      refreshBalance();
      showToast('루비가 충전되었습니다!');
    }
    if (event.name === 'checkout.closed') {
      // 결제 취소/닫기
    }
  },
});
```

#### 페이지 구조

```
┌──────────────────────────────────┐
│  💎 내 루비: {balance}            │
│  ⏱ 다음 리필: {timer} ({n}/15)   │
├──────────────────────────────────┤
│  [루비 충전]  [무료 루비]          │  ← 탭
├──────────────────────────────────┤
│                                  │
│  [루비 충전 탭]                    │
│  - 5개 상품 카드 (API로 로딩)      │
│  - 클릭 → Paddle Overlay 열림     │
│                                  │
│  [무료 루비 탭]                    │
│  - 출석 보상 (💎10, 받기 버튼)     │
│  - 타이머 (2시간/1💎, 프로그레스)  │
│  - 광고 시청 (준비중)              │
│                                  │
├──────────────────────────────────┤
│  최근 충전 내역                    │
│  - paymentAPI.getPaymentHistory  │
└──────────────────────────────────┘
```

### 4-4. 헤더 루비 잔액 표시

**파일**: `frontend/char-chat-frontend/src/components/Header.jsx` (수정)

```jsx
// 헤더 우측에 루비 잔액 표시
<button onClick={() => navigate('/ruby/charge')} className="flex items-center gap-1">
  <Gem className="w-4 h-4 text-pink-500" />
  <span>{rubyBalance}</span>
</button>
```

- `pointAPI.getBalance()` → 전역 상태 or Context로 관리
- 채팅 차감/충전 시 실시간 갱신

### 4-5. 잔액 부족 시 충전 유도

**채팅 중 유료 모델 사용 시 잔액 부족하면**:
```jsx
// ChatPage.jsx에서 에러 처리
if (error.code === 'INSUFFICIENT_BALANCE') {
  showToast(
    `루비가 부족합니다 (현재: ${balance}💎, 필요: ${cost}💎)`,
    { action: { label: '충전하기', onClick: () => navigate('/ruby/charge') } }
  );
}
```

### 4-6. api.js 수정

```javascript
export const paymentAPI = {
  // 수정
  getProducts: () => api.get('/payment/products'),
  getPaddleConfig: () => api.get('/payment/paddle-config'),
  getPaymentHistory: (params = {}) => api.get('/payment/history', { params }),
  getPayment: (paymentId) => api.get(`/payment/payment/${paymentId}`),
  // 제거: checkout, webhook, createProduct (Paddle이 대체)
};
```

---

## 5. 데이터 흐름 상세

### 5-1. 결제 성공 흐름

```
1. [프론트] 유저가 "프리미엄 💎1,100" 클릭
2. [프론트] paddle.Checkout.open({ priceId: "pri_premium", customData: { user_id } })
3. [Paddle] 오버레이 결제 UI 표시
4. [유저]   카드번호 입력 또는 카카오페이 선택 → 결제
5. [Paddle] 결제 처리 완료
6. [Paddle] → POST /payment/paddle-webhook (transaction.completed)
7. [백엔드] 서명 검증 ✓
8. [백엔드] Redis 멱등성 체크 (txn_id 중복?) → 신규
9. [백엔드] PADDLE_PRICE_MAP에서 pri_premium → 1,100 루비 조회
10. [백엔드] point_service.charge_points(user_id, 1100, ...)
11. [백엔드] payments 테이블에 기록 저장
12. [백엔드] → 200 OK to Paddle
13. [프론트] eventCallback('checkout.completed') → 잔액 새로고침
14. [프론트] 토스트: "💎1,100 루비가 충전되었습니다!"
```

### 5-2. 결제 실패/취소 흐름

```
1. [유저]   결제 도중 취소 또는 카드 거절
2. [Paddle] → POST /payment/paddle-webhook (transaction.payment_failed)
3. [백엔드] 로그만 기록, 루비 미지급
4. [프론트] eventCallback('checkout.closed') → "결제가 취소되었습니다"
```

### 5-3. 웹훅 재시도 (Paddle 자동)

Paddle은 웹훅 실패 시 자동 재시도 (최대 수일간):
- 백엔드 200 응답 못 받으면 → 지수 백오프로 재시도
- **멱등성 키(txn_id)로 중복 지급 방지** 필수

---

## 6. DB 스키마 변경

### 6-1. 기존 테이블 활용 (변경 최소화)

| 테이블 | 변경 |
|--------|------|
| `payments` | `payment_method`에 "paddle" 저장, `payment_key`에 txn_id 저장 — 스키마 변경 없음 |
| `user_points` | 변경 없음 |
| `point_transactions` | 변경 없음 |
| `payment_products` | **사용 안 함** (PADDLE_PRICE_MAP이 SSOT) |

### 6-2. payments 테이블 컬럼 활용

```
payment_key   → Paddle transaction_id ("txn_xxxxx")
order_id      → 동일값 사용 (Paddle은 order_id 개념 없음, txn_id로 통일)
payment_method → "paddle"
transaction_data → 웹훅 전체 payload JSON
status → "success" | "failed"
```

> 신규 테이블/컬럼 추가 불필요. 기존 스키마로 충분.

---

## 7. 보안 체크리스트

| 항목 | 구현 방법 |
|------|----------|
| **웹훅 서명 검증** | `Paddle-Signature` 헤더 HMAC-SHA256 검증 |
| **멱등성** | Redis `paddle:txn:{id}` SET NX (24시간 TTL) |
| **금액 검증** | 웹훅의 `totals.total`과 PADDLE_PRICE_MAP의 가격 일치 확인 |
| **user_id 검증** | custom_data의 user_id가 실제 존재하는 유저인지 DB 확인 |
| **HTTPS** | 프로덕션 웹훅 URL은 반드시 HTTPS |
| **환경 분리** | sandbox/production 토큰 분리, 환경변수로 관리 |
| **로깅** | 웹훅 수신/처리/실패 전부 로그 (개인정보 제외) |

---

## 8. 테스트 계획

### 8-1. Sandbox 테스트

Paddle Sandbox 환경에서 테스트 카드로 결제:

| 테스트 케이스 | 검증 항목 |
|-------------|----------|
| 정상 결제 | Overlay 열림 → 결제 → 웹훅 수신 → 루비 지급 → 잔액 갱신 |
| 결제 취소 | Overlay 닫기 → 루비 미지급 확인 |
| 카드 거절 | 실패 웹훅 수신 → 로그 기록 → 루비 미지급 |
| 웹훅 중복 | 같은 txn_id 2번 수신 → 루비 1번만 지급 |
| 서명 위조 | 잘못된 서명 → 403 반환, 루비 미지급 |
| 금액 불일치 | 웹훅 금액 ≠ PRICE_MAP → 거부 |

### 8-2. Sandbox 테스트 카드

```
성공: 4242 4242 4242 4242
실패: 4000 0000 0000 0002
3DS:  4000 0025 0000 3155
```

---

## 9. 수정 파일 목록

| # | 파일 | 변경 |
|---|------|------|
| 1 | `backend-api/.env` | Paddle 환경변수 4개 추가 |
| 2 | `backend-api/app/core/config.py` | Settings에 Paddle 필드 추가 |
| 3 | `backend-api/app/core/paddle_config.py` | **신규** — 상품 매핑 딕셔너리 |
| 4 | `backend-api/app/api/payment.py` | 웹훅 교체 + 상품 API 수정 + config API 추가 |
| 5 | `backend-api/app/schemas/payment.py` | 불필요한 스키마 정리 |
| 6 | `frontend/package.json` | `@paddle/paddle-js` 추가 |
| 7 | `frontend/.../hooks/usePaddle.js` | **신규** — Paddle 초기화 훅 |
| 8 | `frontend/.../pages/RubyChargePage.jsx` | 전면 리뉴얼 (5상품 + 2탭 + Paddle Checkout) |
| 9 | `frontend/.../lib/api.js` | paymentAPI 정리 |
| 10 | `frontend/.../components/Header.jsx` | 루비 잔액 표시 |

---

## 10. 구현 순서 (5단계)

### Step 1: Paddle 대시보드 설정 (수동)
- [ ] Paddle 계정 생성 (Sandbox)
- [ ] 5개 상품/가격 생성
- [ ] Webhook URL 등록
- [ ] API Key, Client Token, Webhook Secret 수집

### Step 2: 백엔드 — Config + Webhook (1일)
- [ ] 환경변수 + config.py 추가
- [ ] `paddle_config.py` 생성 (상품 매핑)
- [ ] `payment.py` 웹훅 엔드포인트 교체 (서명검증 + 멱등성 + 루비지급)
- [ ] `GET /payment/paddle-config` 추가
- [ ] `GET /payment/products` 수정

### Step 3: 프론트엔드 — Paddle.js + 충전 페이지 (1일)
- [ ] `@paddle/paddle-js` 설치
- [ ] `usePaddle.js` 훅 생성
- [ ] `RubyChargePage.jsx` 리뉴얼 (5상품 카드 + Paddle Overlay)
- [ ] 성공/실패 콜백 처리

### Step 4: 잔액 UI + 충전 유도 (0.5일)
- [ ] 헤더에 루비 잔액 표시
- [ ] 채팅 중 잔액 부족 시 충전 유도 토스트
- [ ] 충전 완료 후 잔액 실시간 갱신

### Step 5: Sandbox 테스트 + Production 전환 (0.5일)
- [ ] Sandbox 결제 테스트 (6개 시나리오)
- [ ] Production 키로 교체
- [ ] Production 웹훅 URL 등록
- [ ] 실제 결제 테스트 (소액)

---

## 11. FAQ

**Q: `payment_products` DB 테이블은 안 쓰나?**
A: Paddle 대시보드가 상품 마스터. 코드의 `PADDLE_PRICE_MAP`이 price_id→루비 매핑 SSOT. DB 테이블은 레거시로 유지하되 신규 로직에서는 사용 안 함.

**Q: 웹훅이 프론트 콜백보다 늦게 오면?**
A: Paddle.js의 `checkout.completed` 이벤트는 결제 성공 직후 발생. 웹훅은 수 초 뒤에 올 수 있음. 프론트에서는 "충전 처리 중..." 상태를 보여주고, 잔액 API를 폴링(3초 간격, 최대 30초)하여 갱신.

**Q: 환불은?**
A: Paddle 대시보드에서 수동 환불 → `transaction.refunded` 웹훅 수신 → `point_service.use_points_atomic()`으로 루비 회수. Phase 2에서 구현.

**Q: 정기결제/구독은?**
A: Phase 5에서 Paddle Subscription API로 별도 구현 예정.
