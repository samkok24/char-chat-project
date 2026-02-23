# 11. 프론트 라우트 맵

기준 파일: `frontend/char-chat-frontend/src/App.jsx`

## 라우트 목록

| Path | 보호 여부 | 페이지/동작 | 메모 |
|---|---|---|---|
| `/` | 공개 | `/dashboard`로 redirect | 초기 진입점 |
| `/dashboard` | 공개 | `HomePage` | 메인 홈 |
| `/login` | 공개(로그인 시 우회) | `LoginPage` | 로그인 상태면 `/dashboard` |
| `/verify` | 공개 | `VerifyPage` | 인증 |
| `/forgot-password` | 공개 | `ForgotPasswordPage` | 비번 재설정 요청 |
| `/reset-password` | 공개 | `ResetPasswordPage` | 비번 재설정 |
| `/maintenance` | 공개 | `MaintenancePage` | 점검 |
| `/contact` | 공개 | `ContactPage` | 문의 |
| `/faq` | 공개 | `FAQPage` | FAQ |
| `/notices` | 공개 | `NoticePage` | 공지 목록 |
| `/notices/:noticeId` | 공개 | `NoticePage` | 공지 상세 |
| `/cms` | 보호 | `CMSPage` | 관리자 기능 포함 |
| `/agent` | 공개 | `AgentPage` | 스토리 에이전트 메인 |
| `/agent/drawer` | 공개 | `AgentDrawerPage` | 저장 콘텐츠 서랍 |
| `/agent/feed` | 공개 | `AgentFeedPage` | 피드 |
| `/characters/:characterId` | 공개 | `CharacterDetailPage` | 캐릭터 상세 |
| `/chat/:characterId` | 공개 | `ChatRedirectPage` | 채팅 진입 redirect |
| `/ws/chat/:characterId` | 공개 | `ChatPage` | 실제 채팅 화면 |
| `/storydive/novels/:novelId` | 보호 | `StoryDiveNovelPage` | 스토리다이브 |
| `/profile` | 보호 | `ProfilePage` | 내 프로필 |
| `/ruby/charge` | 보호 | `RubyChargePage` | 결제/충전 |
| `/characters/create` | 보호 | `CreateCharacterPage` | 캐릭터 생성 |
| `/characters/:characterId/edit` | 보호 | `CreateCharacterPage` | 캐릭터 수정 |
| `/history` | 보호 | `ChatHistoryPage` | 채팅 기록 |
| `/my-characters` | 보호 | `MyCharactersPage` | 내 캐릭터 |
| `/favorites` | 보호 | `FavoritesPage` | 즐겨찾기 |
| `/favorites/stories` | 보호 | `FavoriteStoriesPage` | 즐겨찾기 스토리 |
| `/works/create` | 보호 | `WorkCreatePage` | 작품 생성 |
| `/stories/:storyId` | 공개 | `StoryDetailPage` | 작품 상세 |
| `/stories/:storyId/chapters/:chapterNumber` | 공개 | `ChapterReaderPage` | 회차 보기 |
| `/stories/:storyId/edit` | 보호 | `StoryEditPage` | 작품 수정 |
| `/metrics/summary` | 보호 | `MetricsSummaryPage` | 운영 요약 지표 |
| `/users/:userId` | 공개 | `ProfilePage` | 타 사용자 프로필 |
| `/users/:userId/creator` | 공개 | `CreatorInfoPage` | 창작자 정보 |
| `/story-importer` | 보호 | `StoryImporterPage` | 스토리 임포터 |
| `/works/:workId` | 공개 | `/stories/:workId`로 redirect | 과거 경로 호환 |
| `/works/:workId/chapters/:chapterNumber` | 공개 | `/stories/...`로 redirect | 과거 경로 호환 |
| `*` | 공개 | `/dashboard`로 redirect | fallback |

## 라우팅/접근 제어 특징

- 인증이 필요한 경로는 `ProtectedRoute` 공통 게이트 사용
- 로그인 화면은 `PublicRoute`로 역보호
- 대부분 페이지가 lazy import되어 초기 번들 부담이 낮음
