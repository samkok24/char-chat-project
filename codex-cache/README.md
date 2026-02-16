# Codex Cache 문서 인덱스

이 폴더는 `char_chat_project_v2`를 빠르게 재로딩하기 위한 캐시 문서 모음입니다.

- 작성일: 2026-02-12
- 작성 기준: 현재 워크스페이스 코드 스냅샷
- 우선순위: 프론트엔드 중심, 이후 백엔드/배포까지 확장

## 읽기 순서

1. `codex-cache/00_project_map.md`
2. `codex-cache/10_frontend_architecture.md`
3. `codex-cache/11_frontend_routes_pages.md`
4. `codex-cache/12_frontend_api_contract.md`
5. `codex-cache/13_frontend_feature_map.md`
6. `codex-cache/14_frontend_page_api_matrix.md`
7. `codex-cache/20_backend_api_architecture.md`
8. `codex-cache/21_socket_server_architecture.md`
9. `codex-cache/22_legacy_backend_flask.md`
10. `codex-cache/23_backend_route_inventory.md`
11. `codex-cache/30_runtime_deploy_topology.md`
12. `codex-cache/90_codex_ingest_guide.md`

## 범위

- 프론트: `frontend/char-chat-frontend`
- 메인 백엔드: `backend-api`
- 실시간 서버: `chat-server`
- 레거시 서버: `backend-flask`
- 배포/런타임: `docker`, `render.yaml`, 루트 compose 파일

## 현재 코드베이스 특징

- 대형 파일 집중:
  - `frontend/char-chat-frontend/src/pages/CreateCharacterPage.jsx` (15k+ lines)
  - `frontend/char-chat-frontend/src/pages/ChatPage.jsx` (7.5k+ lines)
  - `frontend/char-chat-frontend/src/pages/AgentPage.jsx` (4.9k+ lines)
  - `backend-api/app/api/chat.py` (8k+ lines)
  - `backend-api/app/services/quick_character_service.py` (5.7k+ lines)
- 핵심 철학: 실제 운영 요구를 빠르게 반영하며, 로컬 캐시/방어 로직이 코드 전반에 강하게 들어가 있음

## 주의

- 리포지토리는 현재 변경사항이 많은 상태이며(`git status` 기준 다수 modified/untracked), 이 문서들은 해당 상태를 그대로 요약합니다.
- 문서의 SSOT는 코드이며, 기능 수정 시 이 캐시도 함께 갱신 필요합니다.

## Fact-Check Memo
- `팩트체크_오탐_및_의도된모델강제_2026-02-16.md`
  - 2026-02-16 review correction memo (false positives + intentional Claude forcing paths).
