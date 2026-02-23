# Session Handoff (2026-02-23)

이 문서는 새 Codex 세션에서 바로 이어받기 위한 압축 기록이다.

## 1) 현재 상태
- Branch: `main`
- HEAD: `7786983`
- 작업트리가 매우 dirty 상태다. 기존 변경을 되돌리지 말고 필요한 파일만 최소 수정해야 한다.
- 운영 설정은 건드리지 않는 것이 사용자 명시 요구다. 로컬(dev)만 수정.

## 2) 사용자 핵심 요구(반드시 유지)
- 목표 1순위는 일반 캐릭터챗 체감속도 개선(SSE 스트리밍 체감).
- 스트리밍 구조 개선 시 답변 품질/프롬프트 의미를 바꾸지 말 것.
- 일반챗/원작챗 경계를 절대 섞지 말 것.
- 변경 전 근거(Why/Scope/Impact/Fallback) 제시 규칙 추가됨.
  - 파일: `AGENTS.md`
- 욕설/강한 피드백 맥락: 신뢰 회복이 중요. 작은 범위로 증거 기반 수정.

## 3) 이번 세션에서 확인된 큰 결정
- babechat 분석 결론:
  - 통신은 SSE(`text/event-stream`) + Vercel AI SDK 스타일 이벤트.
  - 우리도 Vercel 필수는 아님. SSE 직접 구현으로 동등 UX 가능.
- 결제 방향:
  - free 모델은 Gemini Flash.
  - 유료 모델은 루비 차감.
  - 타이머 리필(2시간당 1, cap 15)은 배치보다 lazy evaluation 방식 채택.
- 운영은 AWS Docker 그대로 유지, 로컬 포트만 분리.

## 4) 코드 반영 상태(사실 기반)

### 4.1 채팅 SSE
- SSE 엔드포인트 존재:
  - `backend-api/app/api/chat.py` (`/chat/messages/stream`)
- 프론트 SSE 호출 존재:
  - `frontend/char-chat-frontend/src/lib/api.js` `sendMessageStream`
- next_action SSE 경로 반영됨:
  - `frontend/char-chat-frontend/src/pages/ChatPage.jsx` (`client_message_kind: 'next_action'`)
- continue SSE 경로도 반영됨:
  - `frontend/char-chat-frontend/src/pages/ChatPage.jsx` (continue sendMessageStream 호출)
  - 백엔드는 빈 content/`continue`를 continue 모드로 처리:
    - `backend-api/app/api/chat.py` (`is_continue = ...`)
- 스트리밍 초반 sanitize 버퍼링 방어 로직 존재:
  - `backend-api/app/api/chat.py` (stream 버퍼링 후 `_sanitize_breakdown_phrases`)
- 요약 갱신은 SSE 지연 완화를 위해 백그라운드 경로 존재:
  - `backend-api/app/api/chat.py` (`_update_room_summary_incremental_background`)

### 4.2 일반챗 말풍선/지문 분리
- assistant block 렌더 조건에서 `isOrigChat` 강제 제한은 현재 제거된 상태로 보임.
  - `frontend/char-chat-frontend/src/pages/ChatPage.jsx` `shouldRenderAssistantAsBlocks`
- 현재 증상 재발 시 확인 포인트:
  - 모델 출력이 따옴표/지문 규칙을 지키지 않는 경우 블록 분리 품질이 떨어질 수 있음.
  - `frontend/char-chat-frontend/src/lib/assistantBlocks.js`

### 4.3 결제/루비/타이머
- 문서 작성 완료:
  - `PRICING_AND_PAYMENT_PLAN.md`
  - `PADDLE_INTEGRATION_PLAN.md`
  - `PAYMENT_GATE_NOTES_2026-02-20.md`
- 타이머 리필 API 반영:
  - 모델: `backend-api/app/models/payment.py` `UserRefillState`
  - 서비스: `backend-api/app/services/point_service.py`
  - 엔드포인트: `backend-api/app/api/point.py` `/point/timer-status`
  - 스키마: `backend-api/app/schemas/payment.py` `TimerStatusResponse`
  - 앱 기동 시 테이블 보장: `backend-api/app/main.py`
- 프론트 반영:
  - `frontend/char-chat-frontend/src/lib/api.js` `pointAPI.getTimerStatus`
  - `frontend/char-chat-frontend/src/components/layout/Sidebar.jsx` 루비/타이머 표시
  - `frontend/char-chat-frontend/src/pages/RubyChargePage.jsx` 루비/타이머 표시
- 동시 요청 시 초기 생성 충돌 방어 추가:
  - `backend-api/app/services/point_service.py` `IntegrityError` 재조회 처리

### 4.4 Paddle 웹훅 준비 상태
- 기존 `/payment/webhook`에 서명검증/멱등성 보강 코드가 일부 반영되어 있음.
  - `backend-api/app/api/payment.py`
- 환경변수 키 추가:
  - `backend-api/app/core/config.py` (`PAYMENT_WEBHOOK_SECRET`, `PADDLE_WEBHOOK_SECRET`)
- 아직 “Paddle 전용 엔드포인트 완전 전환”은 미완.

## 5) 로컬 포트/환경 (현재 dev compose 기준)
- `docker-compose.dev.yml` 기준:
  - backend: `18000 -> 8000`
  - chat-server: `13001 -> 3001`
  - frontend: `5173`
  - frontend env:
    - `VITE_API_URL=http://localhost:18000`
    - `VITE_SOCKET_URL=http://localhost:13001`
- 사용자 이슈 이력:
  - CORS 오류 보고: `http://localhost:5173` -> `http://localhost:18000/chat/messages/stream`
  - 일부는 실제 원인이 500 내부오류였고, 브라우저에서 CORS처럼 보인 케이스가 섞여 있었음.

## 6) 장애/이슈 이력(중요)
- SQLAlchemy 에러 이력:
  - `"Method 'close()' can't be called here ... _connection_for_bind() in progress"`
  - 증상: 스트림 중 500 실패.
  - 재발 시 세션 close/rollback 타이밍 점검 필요.
- Gemini 2.5 Pro 체감:
  - 첫 청크 후 지연, 이후 몰아쓰기 현상 보고.
  - 느린 응답/부분 잘림 체감 보고 다수.
- 응답 품질 이슈:
  - 유저 대변 화법, 상황/심리 문구 누출, 중복 메시지 깜빡임 등 강한 불만 제기됨.
  - “스트리밍만 바꿔야지 답변 행태 바꾸지 말라”가 핵심 요구.

## 7) 성능/모델 관련 현재 설정 단서
- `backend-api/app/services/ai_service.py`:
  - Gemini 기본 sub-model은 flash 계열 우선 로직 존재.
  - history block 상한 `max_chars=6000` 반영 흔적 존재.
  - response length 선호값 기반 토큰 상한 조정 로직 존재(파일 내부).
- `backend-api/requirements.txt`:
  - `httpx==0.28.1`
  - `google-genai>=1.5.0`
  - 이전 충돌(`httpx==0.27.2`)은 정리된 상태.

## 8) CMS/메인 관련 이력
- CMS에서 특정 홈 슬롯 비활성화 시 화면 블랙아웃 이슈 제기됨.
- 완화 시도 이력:
  - 자동 탭 전환 제거
  - ErrorBoundary 적용
  - slot sanitize 예외 방어
- 관련 파일:
  - `frontend/char-chat-frontend/src/pages/CMSPage.jsx`

## 9) WSL 전환 메모
- 성능 목적으로 WSL2 + Linux fs 경로 작업 권장.
- 권장 작업 경로:
  - `~/work/char_chat_project_v2`
- 동기화:
  - `rsync -av --delete /mnt/c/Users/Hongsan/Downloads/char_chat_project_v2/ ~/work/char_chat_project_v2/`
- 주의:
  - Windows 경로와 WSL 경로는 자동 동기화 아님.
  - `cp permission denied`는 소유권 문제 가능성이 높음:
    - `sudo chown -R $USER:$USER ~/work/char_chat_project_v2`

## 10) 다음 세션 우선순위 (실행 순서)
1. 일반챗 품질 회귀 원인 고정.
2. Gemini 2.5 Pro 스트리밍 체감 지연 재현/측정.
3. 중복 메시지 깜빡임(2번 뜨다 1개로 합쳐짐) 재현 후 제거.
4. 결제 게이트는 문서 우선, 채팅 차감 연동은 별도 PR 성격으로 분리.
5. Paddle는 웹훅 전용 경로/서명/멱등성 완성 후 붙이기.

## 11) 새 세션 시작용 체크 명령
```bash
git status --short
rg -n "messages/stream|sendMessageStream|next_action|is_continue|timer-status|UserRefillState" backend-api frontend
```

```bash
# frontend build check
cmd /c pnpm -C frontend\\char-chat-frontend run build
```

```bash
# backend syntax quick check (pycache 권한 이슈 회피)
python -c "import ast, pathlib; [ast.parse(pathlib.Path(f).read_text(encoding='utf-8')) for f in ['backend-api/app/api/chat.py','backend-api/app/services/ai_service.py','backend-api/app/services/point_service.py']]; print('ok')"
```

## 12) 참고 문서
- `CHAT_STRUCTURE_REFACTOR_PLAN_v0.1.md`
- `CHAT_STRUCTURE_REFACTOR_PLAN_v0.2_lite.md`
- `PRICING_AND_PAYMENT_PLAN.md`
- `PADDLE_INTEGRATION_PLAN.md`
- `PAYMENT_GATE_NOTES_2026-02-20.md`
- `MODEL_BENCHMARK_RESULTS.md`

