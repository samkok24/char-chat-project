# 13. 프론트 기능 모듈 맵 (대형 파일 중심)

## 1) `CreateCharacterPage.jsx`

핵심 책임:

- 캐릭터 생성/수정 통합 화면
- start_sets 기반 시작 상황, sim 옵션, setting_book 편집
- 태그 선택/이미지 업로드/크롭/생성
- AI 기반 초안 생성(quick flow와 결합)
- 채팅 미리보기/자동저장/이탈 방지

관찰 포인트:

- 기능 집적도가 매우 높아 단일 수정이 광범위 회귀를 유발할 수 있음
- draft/preview/media/settings 로직이 혼재되어 있어 분리 여지 큼

## 2) `ChatPage.jsx`

핵심 책임:

- 소켓 기반 실시간 채팅 UI
- 원작챗(origchat) 진입/진행
- 메시지 수정/재생성/피드백
- magic choices, next-action 등 보조 인터랙션
- 모델/페르소나/메모리 설정 모달 연동

관찰 포인트:

- URL 쿼리, 로그인 후 draft 복원, 룸 메타 동기화 등 상태 분기가 매우 많음
- `SocketContext`와 결합도가 높음

## 3) `AgentPage.jsx`

핵심 책임:

- 스토리 에이전트 중심 생성 워크플로우
- 세션/메시지/스토리/이미지 로컬 저장
- 시뮬레이션, 하이라이트 생성, 콘텐츠 저장/발행
- 가상 스크롤/다양한 UI 모드

관찰 포인트:

- 로컬스토리지 키 전략이 매우 다양함
- 성능/상태 일관성 이슈가 발생하기 쉬운 구조

## 4) `HomePage.jsx`

핵심 책임:

- 메인 허브: 랭킹/추천/최근 항목/CMS 슬롯/팝업/배너
- 모바일/PC 표시 정책 분기
- 최근 본 콘텐츠/개인화 섹션 렌더링

관찰 포인트:

- CMS 로컬 캐시와 서버 SSOT 동기화 방어 로직이 포함됨

## 5) `CMSPage.jsx`

핵심 책임:

- 홈 배너/구좌/팝업/태그표시 관리
- 태그 생성/삭제/순서 편집
- 관리자 유저 조회, 트래픽/온라인 지표 조회
- 테스트 계정 생성

관찰 포인트:

- 로컬 캐시 관리 유틸(`cmsBanners`, `cmsSlots`, `cmsPopups`, `cmsTagDisplay`)과 강결합

## 6) `StoryDetailPage.jsx`

핵심 책임:

- 작품 상세/좋아요/댓글/공유
- 챕터 목록 + 읽기 진행도
- extracted characters 작업(job) 상태 관리
- 작품 공지(등록/삭제/고정)
- 원작챗 시작 모달 연동

## 7) 대형 공용 컴포넌트

- `QuickMeetCharacterModal.jsx`
  - 30초 캐릭터 생성 모달, 자동초안/태그/이미지 파이프라인
- `ModelSelectionModal.jsx`
  - 모델/응답 길이/UI/페르소나/메모리 설정
- `ImageGenerateInsertModal.jsx`
  - 업로드 + 생성 + 크롭 + attach 워크플로우
- `Sidebar.jsx`
  - 최근 룸/최근 본 스토리 캐시 및 공통 네비게이션 허브

## 8) 유지보수 우선순위 제안

1. `ChatPage` + `SocketContext` (실시간 핵심)
2. `CreateCharacterPage` + `QuickMeetCharacterModal` (생성 핵심)
3. `AgentPage` (대형 상태 관리)
4. `CMSPage`/`HomePage` (운영 노출 영향)
