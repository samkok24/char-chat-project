## OrigChat UI 설계안 (데스크탑, 다크 테마, 아이콘 중심)

### 범위/원칙
- **대상**: 원작챗 전용 UI. 일반 캐릭터 챗과 완전히 분리(세션/라우팅/상태/버튼).
- **플랫폼**: 데스크탑 우선. 모바일 고려하지 않음.
- **테마/토큰**:
  - 버튼 배경: 흰색(#FFFFFF), 텍스트/아이콘: 검은색(#000000)
  - 비활성화: 회색(텍스트/아이콘만 회색, 배경은 흐린 흰색)
  - 호버 효과 없음(커서 pointer만)
  - 로딩 스피너: 흰색
- **안전**: UI 씹힘/동시 클릭/작동 불능 방지(중복 클릭 방지, 비활성 상태 관리, 낙관적 UI 시 롤백 포함)

## 정보 구조(IA)
- Story 상세: “원작챗 시작” 버튼 → `OrigChatStartModal`
- Chat 화면: `/chat/:characterId?source=origchat&storyId=&mode=canon|parallel&anchor=&rangeFrom=&rangeTo=`
- 추가 설정: `ModelSelectionModal` 내부 탭으로 “추가 설정” 배치
- (개발용) 메트릭 요약 페이지: `/metrics/summary`

## P0 핵심 컴포넌트/기능

### 1) OrigChatStartModal (원작챗 시작)
- **요소**
  - **모드 선택**: canon | parallel | 일반 1:1(일반 모드 진입 시 원작챗 로직 미적용)
  - **시작점**: chapter 슬라이더(1~max) + scene 라디오(근사 0/1/2)
  - **범위**: range_from / range_to(선택)
  - **포커스 캐릭터**: 추출 캐릭터 드롭다운(선택)
  - **parallel 씨앗**: 3개 칩(seeds, `start.seed_label`로 전달)
- **데이터 연동**
  - GET `/stories/{id}/start-options` → overview, modes, chapter_scene_index, top_candidates, seeds?
  - POST `/chat/origchat/start` { story_id, character_id, mode, start:{ chapter, scene_id?, seed_label? }, focus_character_id?, range_from?, range_to? }
- **검증/에러**: 필수값 미입력 경고, API 실패 토스트(1회), 중복 전송 방지(disabled)

### 2) Chat 헤더 배지(아이콘 + 텍스트)
- **진행도 배지**: `meta.turn_count` / `meta.max_turns` (예: 23/500). 값 없으면 `—/500`.
- **캐시 배지**: warmed | warming
  - GET `/stories/{storyId}/context-status` → warmed: boolean
  - warming이면 2초 간격 폴링 최대 5회(10초). 실패 토스트는 1회만.
  - 표시 최소화(아이콘 + 텍스트), 캐러셀 영역 폭 유지 우선.

### 3) 하단 컨트롤 (아이콘 중심)
- **메시지 입력**: 기존 유지(Enter 전송, Shift+Enter 줄바꿈)
- **상황 입력(원버튼)**:
  - 별도 버튼 1개(아이콘). 클릭 시 즉시 상황(사건) 서술을 **사용자 말풍선 형태**로 낙관적 표시 → `situation_text`로 턴 전송(엔터 전송 아님)
  - 실패 시 토스트(1회) + 말풍선 회색 처리/회수
- **자동 진행(>> 버튼)**:
  - trigger=`next_event` 호출. 선택지가 **보이는 동안 비활성화(회색)**
  - 자동 진행 길이(1장면/2장면)는 추가설정 모달에서 설정(기본 1장면)
  - 클릭 시 중복 방지(disabled) → 응답 도착 후 해제

### 4) 본문 영역
- **선택지**: `meta.choices`가 오면 버튼 리스트로 표시. 클릭 시 `choice_id` 전송. 클릭 후 **자동 스크롤**.
- **완결 처리**: `meta.completed=true` 시 토스트 1회 + 내레이터 말풍선(중복 가드) 표시.
- **지문+대사 혼용**: 기존 말풍선 컴포넌트 스타일 유지(지문은 일반 말풍선, 대사는 따옴표 강조).

## P1 추가설정(모달)
`ModelSelectionModal` 내부 탭으로 “추가 설정”을 통합. 모달은 기존처럼 정상 작동.

- **보정 단계(품질/속도)**: always | first2 | off (기본: first2)
- **자동 진행 길이**: 1장면 | 2장면 (기본 1장면)
- **응답 길이 프리셋**: short | medium | long (기본 medium)
- **프리워밍 강제**: ON | OFF (기본 ON)
- **저장/전달**
  - localStorage: `cc:chat:settings:v1`
  - 시작 시 프론트 1회 동기화: 첫 턴 `origchat_turn(settings_patch)`로 서버 룸 메타에 저장(보정/자동진행/길이/프리워밍)
  - 세션 중 변경은 `settings_patch`로 전달(서버 메타 키: postprocess_mode, next_event_len, response_length_pref, prewarm_on_start)

### 멱등성/온디맨드 트리거(로직)
- **멱등성**: 모든 턴 요청에 `idempotency_key`(UUID 등) 부여, 새로고침/중복 전송 방지
- **온디맨드 선택지**: `trigger: 'choices'` 호출(쿨다운 8초), 응답 `meta.choices` 표시
- **자동 진행(>>)**: `trigger: 'next_event'` 호출, 선택지 표시 중이면 서버/클라 모두 차단(경고 문구)

## P2 메트릭 요약(개발용 페이지)
- **필터**: day, story_id, room_id, mode
- **지표**: TTI 평균(ms), choices 요청 수, next_event 수, completed 수
- **API**: GET `/metrics/summary`

## 스트리밍 정책(설명/계획)
- **현 상태**: 원작챗은 HTTP 단발(사유: 후처리 2단계(일관성/스피커 보정) 직렬 수행). 일반 캐릭터챗은 소켓 스트리밍.
- **가능한 개선**: 단계적 스트리밍(프리뷰) 도입
  - 1) 메인 응답 스트림 프리뷰 표시
  - 2) 후처리 완료본으로 최종 덮어쓰기(깜빡임 최소화)
  - UI는 프리뷰/최종 구분 점선 테두리 등으로 미세 신호(후순위)

## 라우팅/세션/중복 방지 가이드
- `room` 파라미터 > (source=origchat → `origChatAPI.start`) > 일반 `startChat`
- 원작챗 방은 일반 챗 방과 절대 공유/덮어쓰기 금지(세션/상태/버튼/컨트롤 분리)
- 시작 확정 후 URL `replaceState`로 앵커/모드 고정. room 우선 사용.

## 동시성/안전 가이드
- **중복 클릭 방지**: 모든 호출 버튼은 요청 중 disabled. 실패해도 중복 토스트 금지(1회 규칙).
- **스크롤**: 선택지 처리/자동 진행 후 하단으로 강제 스크롤.
- **스피너**: 원작챗은 `origTurnLoading` 기준(소켓 상태와 분리). 스피너는 반드시 흰색.

## 캐러셀/레이아웃 가이드
- 캐러셀 폭을 **먼저 확보**하고 컨트롤/배지는 잔여 공간에 배치. 줄바꿈 시 컨트롤을 캐러셀 하단으로 유도.

## 접근성/문구 규칙
- 배지/아이콘은 aria-label 제공(예: "진행도 23/500", "캐시 warmed").
- 호버/포커스 스타일 제거(요구 사항 준수), 커서는 pointer만.

## QA 체크리스트(데스크탑)
- 선택지 표시 중 ‘>>’ 비활성화 확인, 선택 후 자동 스크롤
- 상황 입력 버튼 클릭 시 사용자 말풍선 형태로 즉시 반영(낙관적), 실패 롤백
- 토스트 단 1회만
- 진행도/캐시 배지 노출 및 레이아웃 파손 없음(캐러셀 우선)
- 일반 챗 화면과 컨트롤/세션 섞이지 않음(버튼/라우팅 분리)


## 상태/저장/복원(UI 관점 상세)
- 로컬 키 정리:
  - `cc:lastRoom:{userId}:{characterId}:{storyId}:origchat` → 최근 원작챗 roomId
  - `cc:chat:settings:v1` → 추가 설정(보정/자동진행 길이/응답 길이/프리워밍)
  - `cc:orig:completed:{roomId}` → 완결 토스트 중복 가드
  - 세션 핀(썸네일): `cc:chat:pin:v1:{characterId}`(sessionStorage)
- 진입 우선순위:
  1) URL `room` 유효 시 그대로 사용(무효면 폐기)
  2) `source=origchat`이면 `start`/로컬 최근 room 재사용
  3) 일반 챗은 별도 플로우(절대 혼용 금지)
- URL 반영: 확정된 `room`을 `replaceState`로 쿼리에 고정(새로고침/뒤로가기 보호)

## 추가 설정 UI 바인딩(모달 탭)
- 항목과 데이터 매핑:
  - 보정 단계: 라디오 `always|first2|off` → chatSettings.postprocess_mode
  - 자동 진행 길이: 라디오 `1|2` → chatSettings.next_event_len
  - 응답 길이: 라디오 `short|medium|long` → chatSettings.response_length_pref
  - 프리워밍: 토글 `ON|OFF` → chatSettings.prewarm_on_start
- 동기화 규칙:
  - onChange 시 즉시 로컬 저장 + 다음 턴에 `settings_patch` 1회 전송(멱등)
  - 값 검증: postprocess_mode(`always|first2|off`), next_event_len(1|2), response_length(`short|medium|long`)
  - 모달 닫힘/취소 여부와 무관하게 onChange 시점에 저장(UX 단순화)

## 온디맨드 트리거 UI(자리/가드)
- 선택지 요청 버튼(아이콘 1개):
  - 위치: 입력 바 옆 작은 아이콘(후속)
  - 클릭 → `trigger:'choices'` 호출, 8초 쿨다운(서버/클라 동시 가드)
  - disabled: 로딩 중, 쿨다운 중
- 자동 진행 `>>` 버튼:
  - 위치: 전송 버튼 좌측 작은 아이콘
  - 클릭 → `trigger:'next_event'`
  - disabled: 선택지 표시 중, 로딩 중
  - tooltip: "선택지 처리 후 진행"

## 상황 입력 버튼(UI 동작)
- 버튼 클릭 시: 즉시 사용자 말풍선(지문) 낙관적 표시 → `situation_text`로 전송(엔터 전송 아님)
- 실패 시: 해당 말풍선 회색 처리 또는 제거 + 1회 토스트
- 길이 제한: 140자 권장, 초과 시 안내
- 키보드: 단축키는 보류(후순위)

## 아이콘/토큰 구체안(다크 테마)
- 배지: pill(배경 흰색, 텍스트 검정) — 진행도/캐시 동일 스타일
- 버튼: 배경 흰색, 아이콘 검정, 비활성 회색(hover 없음)
- 스피너: 흰색 고정
- 아이콘 예시(lucide): Settings, FastForward(>>), ListTree(선택지), Asterisk(상황), Info(배지 아이콘은 생략 가능)

## 에러/스켈레톤/토스트
- 스켈레톤: 헤더/본문/입력 최소 스켈레톤 1줄(과도한 깜빡임 금지)
- 네트워크 에러: 단 1회 토스트 + 버튼 재활성화
- 중복 토스트 방지: 키 기반(완결, 컨텍스트 폴링 실패 등)

## 충돌 방지 체크리스트(보강)
- 원작챗과 일반 챗 UI/세션/버튼 완전 분리 확인
- 선택지 있는 상태에서 `>>` 비활성 확인
- ModelSelectionModal 정상 작동(추가 설정 탭 공존)
- 새로고침/뒤로가기/로그인 전환에서 원작챗 세션 심리스 복원 확인


