# Feature Flags

현재 공개 서비스는 캐릭터챗에 집중한다. 원작챗/웹소설 코드는 삭제하지 않고 프론트 공개 표면만 플래그로 닫아 둔다.

## 현재 상태

파일: `frontend/char-chat-frontend/src/lib/featureFlags.js`

```js
export const ORIGCHAT_PUBLIC_ENABLED = false;
export const WEBNOVEL_PUBLIC_ENABLED = false;
export const WEBNOVEL_WORK_CREATE_ENABLED = false;
```

- `ORIGCHAT_PUBLIC_ENABLED=false`: 원작챗 구좌, 원작챗 탭, 원작챗 시작/추출 UI, 원작챗 히스토리 노출을 닫는다.
- `WEBNOVEL_PUBLIC_ENABLED=false`: 홈 웹소설 탭, 웹소설 구좌/카드, 웹소설 상세/뷰어/편집/스토리다이브 라우트를 닫는다.
- `WEBNOVEL_WORK_CREATE_ENABLED=false`: 웹소설 원작 쓰기/임포트 진입점을 닫는다.

## 닫힌 공개 표면

- 홈 상단 웹소설 탭, 원작챗 서브탭, 웹소설/원작챗 CMS 구좌
- `/stories/*`, `/storydive/novels/*`, `/works/create`, `/story-importer`
- `/favorites/stories`
- 사이드바 웹소설 원작 쓰기 버튼, 최근 본 웹소설 히스토리
- 크리에이터 페이지의 웹소설 카드
- 캐릭터 상세/모달의 원작챗 배지, 원작 웹소설 카드, 원작챗 시작 동선
- 캐릭터 선호작/추천/탐색 목록의 원작챗/웹소설 기반 캐릭터

## 다시 열 때

1. `frontend/char-chat-frontend/src/lib/featureFlags.js`에서 필요한 플래그를 `true`로 바꾼다.
2. 원작챗을 다시 열 경우 백엔드 환경변수 `ORIGCHAT_V2=true`도 같이 확인한다.
3. `npm run -s build`를 실행한다.
4. 로컬 브라우저에서 아래 표면을 확인한다.
   - 홈 상단 탭: `추천`, `웹소설`, `캐릭터`
   - 홈 CMS 구좌: 인기 웹소설, 원작챗 구좌, 커스텀 웹소설/원작챗 pick
   - `/stories/:storyId`: 상세/회차/원작챗 시작 버튼
   - `/stories/:storyId/chapters/:chapterNumber`: 뷰어
   - `/works/create`, `/story-importer`: 생성/임포트
   - `/my-characters#stories`, `/my-characters#origchat`: 내 작품/내 원작챗
   - `/favorites/stories`: 웹소설 선호작
   - `/users/:userId/creator`: 크리에이터 웹소설 카드
   - `/characters/:characterId`: 원작챗 캐릭터 배지/원작 카드/원작챗 시작 동선
   - 사이드바 히스토리: 최근 본 웹소설
5. 운영 배포 전 CMS에서 숨겨둔 웹소설/원작챗 구좌가 의도대로 켜지는지 확인한다.

## 주의

- 이 플래그들은 프론트 공개 표면 제어용이다. DB 데이터 삭제나 백엔드 원작챗 코드 제거가 아니다.
- 결제/심사/운영 정책상 웹소설만 열고 원작챗은 닫는 조합도 가능하다.
- 직접 API 차단까지 필요하면 백엔드 라우트/서비스 플래그를 별도 작업으로 추가해야 한다.
