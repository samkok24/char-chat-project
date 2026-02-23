# 90. Codex 캐시 인제스트 가이드

이 문서는 새 세션에서 문맥을 빠르게 주입할 때의 순서/분할 기준입니다.

## 1) 최소 주입 세트 (빠른 작업용)

1. `codex-cache/00_project_map.md`
2. `codex-cache/10_frontend_architecture.md`
3. `codex-cache/11_frontend_routes_pages.md`
4. `codex-cache/12_frontend_api_contract.md`

권장 용도:

- 프론트 버그 수정
- 라우팅/인증/소켓 동작 이슈 대응

## 2) 전체 주입 세트 (구조 변경용)

1. 최소 주입 세트
2. `codex-cache/13_frontend_feature_map.md`
3. `codex-cache/20_backend_api_architecture.md`
4. `codex-cache/21_socket_server_architecture.md`
5. `codex-cache/23_backend_route_inventory.md`
6. `codex-cache/30_runtime_deploy_topology.md`

권장 용도:

- 프론트/백 동시 변경
- API 계약 변경
- 배포/환경 이슈 점검

## 3) 주입 방식 팁

- 큰 파일(`CreateCharacterPage`, `ChatPage`, `AgentPage`, `chat.py`) 직접 전체 주입은 피하고,
  캐시 md를 먼저 주입한 뒤 해당 파일의 필요한 구간만 추가로 읽는 방식이 효율적
- 라우트/엔드포인트 확인은 캐시 문서로 1차 필터링 후 코드 원문 검증 권장

## 4) 업데이트 규칙

- 아래 파일 변경 시 해당 캐시를 같이 갱신:
  - `src/App.jsx`, `src/lib/api.js`, `src/contexts/*`
  - `backend-api/app/main.py`, `backend-api/app/api/*`
  - `chat-server/src/controllers/socketController.js`
  - `docker/*.yml`, `render.yaml`

## 5) Fact-Check Reference
- `팩트체크_오탐_및_의도된모델강제_2026-02-16.md`
  - Use this memo when triaging findings from docs-only reviews.
  - It separates false positives from intentional model-routing policy.
