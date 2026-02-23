# 일반 캐릭터챗 구조개선 기획 v0.1

작성일: 2026-02-20  
범위: 일반 캐릭터챗(OrigChat 제외)  
목표: 결제 붙이기 전에 체감 지연을 구조적으로 낮추는 것

## 1. 목표와 성공 기준

- 핵심 목표
  - 첫 응답 체감(TTFT)을 지금 구조 대비 대폭 단축
  - "응답이 늦어서 이탈" 구간을 줄여 결제 전환 가능한 UX 확보

- KPI(릴리즈 게이트)
  - `p95 TTFT` <= 1.5s
  - `p95 응답 완료 시간` <= 8.0s
  - `전송 실패율(ack_timeout + backend_failed)` <= 1.0%
  - `응답 대기 중 이탈률` 30% 이상 개선

- 비목표
  - 문체/품질 튜닝 자체를 이번 구조개선의 1차 목표로 잡지 않음
  - OrigChat 파이프라인은 이번 단계에서 건드리지 않음

## 2. 현재 병목 요약(코드 기준)

- 완성 응답 대기 후 단건 전송 구조
  - `chat-server/src/controllers/socketController.js`의 `handleSendMessage`는 백엔드 `/chat/messages` 응답을 끝까지 기다린 뒤 `new_message`를 보냄
  - 결과: 첫 토큰이 와도 사용자에게 중간 표시 불가

- 백엔드 단일 동기 경로
  - `backend-api/app/api/chat.py`의 `send_message`가 룸/설정/히스토리/프롬프트 구성/모델 호출/후처리를 한 경로에서 처리
  - 결과: 모델 호출 전후 지연이 모두 TTFT에 합산

- 프론트는 청크 수신 준비는 되어 있으나 실사용 안 됨
  - `frontend/char-chat-frontend/src/contexts/SocketContext.jsx`에 `ai_message_chunk`, `ai_message_end` 핸들러는 존재
  - 하지만 서버가 chunk 이벤트를 거의 발생시키지 않아 실효가 낮음

## 3. 목표 아키텍처(저위험)

- 원칙
  - 기존 `/chat/messages`(완성형) 유지
  - 신규 스트리밍 경로를 플래그로 점진 도입
  - 장애 시 즉시 완성형으로 폴백

- 제안 경로
  1. Backend: `/chat/messages/stream` (SSE)
  2. Chat-server: SSE를 소비해 Socket.IO `ai_message_chunk`/`ai_message_end`로 브리지
  3. Frontend: 기존 chunk 렌더러 재사용

- 이벤트 계약(초안)
  - `ai_message_start`: `{requestId, roomId, messageId}`
  - `ai_message_chunk`: `{requestId, roomId, messageId, seq, chunk}`
  - `ai_message_end`: `{requestId, roomId, messageId, content, usage, latency}`
  - `ai_message_error`: `{requestId, roomId, code, message}`

## 4. 단계별 실행 계획

### P0. 계측 고정(선행, 1~2일)

- 목적
  - 개선 효과를 수치로 증명 가능하게 만들기

- 작업
  - Frontend 계측
    - send 클릭 시각
    - `ai_message_start` 수신 시각
    - 첫 chunk 수신 시각
    - `ai_message_end` 수신 시각
  - Chat-server 계측
    - socket 수신 -> backend 요청 시작
    - backend first-byte
    - backend 완료
  - Backend 계측
    - 룸/설정 로드 완료
    - 프롬프트 구성 완료
    - 모델 first token
    - 모델 완료

- 산출물
  - 로그 필드 표준화: `requestId`, `roomId`, `userId`, `characterId`, `path`
  - 주간 대시보드(p50/p95)

### P1. 백엔드 스트리밍 경로 추가(2~4일)

- 작업
  - `ai_service`에 provider 공통 streaming wrapper 추가
  - `chat.py`에 `/chat/messages/stream` 추가
  - user message는 선저장, assistant message는 end 시점 저장
  - 스트림 중단/타임아웃 시 에러 이벤트 반환 + 상태 정리

- 안전장치
  - feature flag: `CHAT_STREAMING_ENABLED`
  - per-request fallback: stream 실패 시 기존 `/chat/messages` 재시도 가능

### P2. chat-server 브리지 전환(1~2일)

- 작업
  - 기존 blocking `axios.post('/chat/messages')` 경로 유지
  - flag ON일 때만 stream endpoint 사용
  - SSE chunk -> socket chunk 이벤트 매핑
  - ack 정책 분리
    - accepted ack: 스트림 연결 성공 시
    - done ack: end 이벤트 수신 시

### P3. 프론트 chunk 렌더 최적화(1~2일)

- 작업
  - `SocketContext` chunk 병합을 배치 처리(`requestAnimationFrame` 단위)
  - 작은 chunk 다건으로 인한 렌더 과부하 방지
  - reconnect 시 `messageId/requestId` 기준 복구/중복제거 강화

### P4. 후처리 분리(2~3일)

- 작업
  - 첫 토큰에 불필요한 후처리(통계성/보조성)를 비동기 후행으로 이동
  - 모델 품질에 직접 영향 없는 로직은 `end` 이후 처리

- 기대효과
  - TTFT 추가 단축
  - tail latency 감소

## 5. 리스크와 대응

- 리스크: chunk 유실/순서 꼬임
  - 대응: `seq`, `requestId`, `messageId` 기반 정렬/중복제거

- 리스크: 스트림 중간 끊김
  - 대응: timeout 후 자동 폴백(완성형), 사용자에게 "복구 중" 최소 노출

- 리스크: 렌더 과부하
  - 대응: chunk 배치 병합 + flush 주기 제한(예: 33~50ms)

- 리스크: 운영 복잡도 증가
  - 대응: flag 기반 점진 롤아웃 + 즉시 롤백 경로 유지

## 6. 롤아웃 계획

- 1단계: 내부/관리자 계정 10%
- 2단계: 일반 사용자 25%
- 3단계: 50%
- 4단계: 100%

각 단계 승격 조건:
- `p95 TTFT` 악화 없음
- 오류율 임계 초과 없음
- CS/로그에서 치명 이슈 없음

롤백 조건:
- 오류율 급증
- 메시지 유실/중복 재현
- ack_timeout 급증

## 7. 실행 티켓(초안)

1. `BE-CHAT-01` 계측 필드 표준화(requestId, stage latency)
2. `BE-CHAT-02` ai_service provider 공통 stream wrapper
3. `BE-CHAT-03` `/chat/messages/stream` endpoint 추가
4. `BE-CHAT-04` stream 실패 시 완성형 폴백 경로
5. `SOCKET-01` chat-server SSE 소비 + chunk emit 브리지
6. `SOCKET-02` ack 이원화(accepted/done)
7. `FE-CHAT-01` chunk 배치 렌더링 최적화
8. `FE-CHAT-02` reconnect 복구 및 dedupe 강화
9. `OPS-CHAT-01` 대시보드/알람(오류율, TTFT, 완료시간)
10. `OPS-CHAT-02` 점진 롤아웃 플래그/운영 가이드

## 8. 바로 시작할 최소 착수안

- 오늘 바로 착수
  - `P0 계측` + `SOCKET 현재 blocking 지점` 로그 표준화
- 내일 착수
  - `P1 stream endpoint 골격` + `P2 브리지 PoC`

이 순서로 가면 "체감 개선 증명"을 가장 빨리 만들 수 있고, 결제 연동 전 리스크를 가장 낮게 관리할 수 있다.
