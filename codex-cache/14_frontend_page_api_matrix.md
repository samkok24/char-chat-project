# 14. 프론트 페이지-API 매트릭스

기준: `src/pages`, `src/components`에서 `*API.*` 호출 흔적 스캔

## 1) 핵심 페이지

### `HomePage.jsx`

- `charactersAPI.getCharacters`
- `storiesAPI.getStories`
- `usersAPI.getRecentCharacters`
- `usersAPI.getLikedCharacters`
- `storydiveAPI.getRecentSessions`
- `noticesAPI.latest`
- `cmsAPI.getHomeBanners/getHomeSlots/getHomePopups/getCharacterTagDisplay`

### `ChatPage.jsx`

- `chatAPI`:
  - room/meta/messages/start/start-new/start-with-context
  - mark read
  - magic-choices/next-action
  - update/regenerate/feedback
  - clear room messages
- `origChatAPI`:
  - start/turn/context-pack
- `charactersAPI.getCharacter`
- `storiesAPI.getContextStatus`
- `mediaAPI.listAssets`
- `usersAPI.getModelSettings`
- `userPersonasAPI.getCurrentActivePersona`

### `CreateCharacterPage.jsx`

- `charactersAPI`:
  - create/update/get advanced character
  - quick generate 계열 다수
- `tagsAPI.getTags`
- `filesAPI.uploadImages`
- `mediaAPI.upload/listAssets/attach/...`

### `AgentPage.jsx`

- `chatAPI.agentSimulate`
- `chatAPI.agentGenerateHighlights`
- `chatAPI.agentPartialRegenerate`
- `chatAPI.classifyIntent`
- `chatAPI.saveAgentContent/getAgentContents/getAgentFeed/publish/unpublish/delete`
- `storiesAPI.generateStoryStream/getGenerateJobStatus/cancelGenerateJob/updateStory/getEpisodes`
- `charactersAPI.getCharacters/createAdvancedCharacter`
- `rankingAPI.getDaily`
- `metricsAPI.getContentCounts`
- `tagsAPI.getTags`
- `cmsAPI.getCharacterTagDisplay`

### `StoryDetailPage.jsx`

- `storiesAPI.getStory/updateStory/deleteStory`
- `storiesAPI.like/unlike/getLikeStatus`
- `storiesAPI.createComment/deleteComment/getComments`
- `storiesAPI.getExtractedCharacters/rebuild*/cancelExtractJob/getExtractJobStatus/deleteExtractedCharacters`
- `storiesAPI.createAnnouncement/deleteAnnouncement/pinAnnouncement`
- `chaptersAPI.getByStory`
- `origChatAPI.start/getContextPack`
- `mediaAPI.listAssets`
- `charactersAPI.toggleCharacterPublic`

### `CMSPage.jsx`

- `cmsAPI.get/put` 계열 전체
- `tagsAPI.getTags/create/delete`
- `usersAPI.adminListUsers/adminCreateTestUser`
- `metricsAPI.getTraffic/getOnlineNow`
- `filesAPI.uploadImages`
- `charactersAPI.getCharacters`
- `storiesAPI.getStories`

## 2) 핵심 공용 컴포넌트

### `QuickMeetCharacterModal.jsx`

- `charactersAPI.quickGenerateCharacterDraft`
- `charactersAPI.quickVisionHints`
- `charactersAPI.quickCreateCharacter30s`
- `tagsAPI.getTags`
- `filesAPI.uploadImages`
- `mediaAPI.upload/generate`

### `ModelSelectionModal.jsx`

- `usersAPI.getModelSettings/updateModelSettings`
- `memoryNotesAPI` CRUD
- `userPersonasAPI` CRUD + setActive

### `OrigChatStartModal.jsx`

- `storiesAPI.getStartOptions/getExtractedCharacters/getBackwardRecap/getSceneExcerpt/getContextStatus`
- `charactersAPI.getCharacter`
- `origChatAPI.getContextPack/start`

### `Sidebar.jsx`

- `chatAPI.getChatRooms/getRoomMeta`
- `storiesAPI.getStory`
- `charactersAPI.getCharacter`

## 3) 해석 포인트

- 화면 단위 API 호출이 매우 넓고, 대형 페이지는 하나의 페이지에서 여러 도메인 API를 동시에 사용함
- 프론트 리팩터링 시 “도메인 단위 hook/service 분리”가 가장 큰 유지보수 개선 포인트
