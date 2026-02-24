# PG 심사 대응 변경사항 (2026-02-24)

## 1. 구독 플랜 시스템

### 백엔드
- **모델**: `SubscriptionPlan`, `UserSubscription` 추가 (`backend-api/app/models/subscription.py`)
- **API**: `GET /subscription/plans`, `GET /subscription/me`, `POST /subscription/subscribe` (`backend-api/app/api/subscription.py`)
- **시드 데이터**: 3개 플랜 (무료/베이직 ₩9,900/프리미엄 ₩29,900) 자동 생성
- **회차 구매 바이패스**: 구독자(`free_chapters=True`) 유료회차 루비 차감 없이 열람 (`story_chapters.py`)
- **타이머 리필 배율**: 구독 등급별 리필 속도 (기본 2h / x2 1h / x4 30분) (`point_service.py`)
- **모델 할인**: 구독 등급별 AI 모델 비용 할인 적용 (`point_service.py`)

### 프론트엔드
- **RubyChargePage 3탭 통합**: 구독플랜 / 루비충전 / 무료루비
  - 플랜 카드 + 혜택 비교표 + 구독 버튼
  - 잔액 카드에 현재 플랜 뱃지 표시
  - 플랜 혜택: 월 루비, 매일 로그인 보상, 리필 간격, 웹소설 무료, 모델 할인
- **SubscribePage**: 별도 페이지 → `/ruby/charge` 리다이렉트
- **회차 구매 바이패스**: `ChapterReaderPage`, `StoryDetailPage`에서 구독자 유료회차 자동 통과

## 2. 홈 탭 순서 변경
- **변경 전**: 추천 → 캐릭터 → 웹소설
- **변경 후**: 추천 → 웹소설 → 캐릭터 → 스토리에이전트
- 스토리에이전트 탭 클릭 시 `/agent`로 이동

## 3. 온보딩 비노출
- 추천탭 온보딩 섹션 (검색 + 30초 생성) PG 심사 시 비노출 처리

## 4. UI 문구 변경
- **"원작 쓰기"** → **"웹소설 원작 쓰기"** (홈페이지 + 사이드바)
- **루비 충전 버튼**: 아이콘 → 보라색 pill 버튼 + "충전" 텍스트 (홈 헤더)
- **온보딩 서브타이틀**: "90초면 나만의 캐릭터와 엔딩을 볼 수 있어요"

## 5. 사이드바 변경
- **"루비"** → 현재 구독 플랜명 (무료/베이직/프리미엄) 표시
- **"충전하기 →"** → **"업그레이드"** (화살표 제거)
- **타이머**: `15/15 (+1개/2시간)` 형식으로 리필 간격 표시
- **선호작, 스토리에이전트**: 비로그인 시에도 표시 (클릭 시 로그인 요구)

## 수정 파일 목록
| 파일 | 변경 |
|---|---|
| `backend-api/app/models/subscription.py` | 신규 |
| `backend-api/app/models/chapter_purchase.py` | 신규 |
| `backend-api/app/models/__init__.py` | import 추가 |
| `backend-api/app/api/subscription.py` | 신규 |
| `backend-api/app/api/story_chapters.py` | 구독자 바이패스 |
| `backend-api/app/main.py` | 테이블 생성 + 시드 + 라우터 |
| `backend-api/app/services/point_service.py` | 리필 배율 + 모델 할인 |
| `frontend/.../App.jsx` | 라우트 변경 |
| `frontend/.../lib/api.js` | subscriptionAPI 추가 |
| `frontend/.../pages/RubyChargePage.jsx` | 3탭 통합 |
| `frontend/.../pages/SubscribePage.jsx` | 신규 (orphan, 리다이렉트됨) |
| `frontend/.../pages/HomePage.jsx` | 탭 순서 + 온보딩 + 문구 |
| `frontend/.../pages/ChapterReaderPage.jsx` | 구독자 바이패스 |
| `frontend/.../pages/StoryDetailPage.jsx` | 구독자 바이패스 |
| `frontend/.../components/layout/Sidebar.jsx` | 플랜명 + 문구 변경 |
