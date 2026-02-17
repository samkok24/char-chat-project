"""
온보딩 '30초만에 캐릭터 만나기'용 스키마

의도:
- 유저가 입력한 "캐릭터 이름/느낌(한 줄 설정)/태그/이미지"를 기반으로
  캐릭터 생성 폼(고급)의 주요 필드를 AI가 자동 완성할 수 있도록 초안(draft)을 생성한다.
- 생성(DB 저장)은 별도 `/characters/advanced` API에서 수행한다(SSOT).
"""

from pydantic import BaseModel, Field
from typing import Any, Dict, List, Optional, Literal

from app.schemas.profile_themes import (
    ROLEPLAY_PROFILE_THEME_CHIPS,
    SIMULATOR_PROFILE_THEME_CHIPS,
)


class QuickCharacterGenerateRequest(BaseModel):
    """빠른 캐릭터 생성 초안 요청"""

    name: str = Field(..., min_length=1, max_length=100, description="캐릭터 이름")
    seed_text: str = Field(..., min_length=1, max_length=2000, description="원하는 캐릭터 느낌/설정(자유 텍스트)")
    image_url: Optional[str] = Field(None, max_length=500, description="업로드된 대표 이미지 URL(선택)")
    tags: List[str] = Field(default_factory=list, description="유저가 선택한 태그(이름/키워드)")
    # ✅ 중요(SSOT): 프론트에서 유저가 고른 모드(롤플/시뮬/커스텀)를 명시 전달한다.
    # - 기존 클라이언트/레거시 호출은 이 필드가 없을 수 있으므로 Optional로 두고,
    #   서버는 값이 없을 때만 seed_text/tags 키워드 기반 추정 로직으로 폴백한다(하위호환).
    character_type: Optional[Literal["roleplay", "simulator", "custom"]] = Field(
        None,
        description="캐릭터 타입(롤플레잉/시뮬레이터/커스텀). 없으면 seed_text/tags로 추정(하위호환)",
    )
    ai_model: Optional[str] = Field("gemini", description="사용할 AI 모델 (gemini, claude, gpt)")
    ai_sub_model: Optional[str] = Field(None, description="사용할 AI 서브 모델(예: gemini-3-flash-preview, claude-haiku-4-5-20251001)")


class QuickProfileThemeSuggestionsResponse(BaseModel):
    """프로필 단계 '소재 태그칩' 후보 응답(위저드/온보딩 공용)"""

    roleplay: List[str] = Field(default_factory=lambda: list(ROLEPLAY_PROFILE_THEME_CHIPS), description="롤플레잉용 소재 태그칩 후보")
    simulator: List[str] = Field(default_factory=lambda: list(SIMULATOR_PROFILE_THEME_CHIPS), description="시뮬레이션용 소재 태그칩 후보")


class QuickVisionHintsRequest(BaseModel):
    """
    이미지 기반 비전 힌트 요청(온보딩/위저드 공용).

    의도/원리:
    - 프론트는 이미지 선택 직후, 작품명/한줄소개 자동생성을 돌리기 전에
      "이미지에서 뽑힌 앵커/무드"에 맞는 소재칩을 UI에서 미리 강조할 수 있다.
    - 생성(DB 저장)과 무관하며, 실패해도 UX만 폴백된다(방어적).
    """

    image_url: str = Field(..., min_length=1, max_length=500, description="업로드된 대표 이미지 URL")


class QuickVisionHintsResponse(BaseModel):
    """이미지 기반 비전 힌트 응답(프론트 칩 하이라이트 용도)."""

    hints_ko: List[str] = Field(default_factory=list, description="이미지에서 뽑힌 한국어 앵커 힌트(최대 20개)")
    vibe_ko: List[str] = Field(default_factory=list, description="캐릭터챗 톤/전개용 해석 힌트(장르/감정선/전개 동력, 최대 20개)")
    roleplay_hook_suggestions: List[str] = Field(default_factory=list, description="RP용 훅/갈등 제안(문장형, 최대 6개)")
    simulator_hook_suggestions: List[str] = Field(default_factory=list, description="시뮬용 목표/리스크 제안(문장형, 최대 6개)")
    roleplay_theme_matches: List[str] = Field(default_factory=list, description="롤플레잉 소재칩(SSOT) 중 이미지와 매칭된 후보")
    simulator_theme_matches: List[str] = Field(default_factory=list, description="시뮬레이션 소재칩(SSOT) 중 이미지와 매칭된 후보")


class QuickCreate30sRequest(BaseModel):
    """
    메인탭 '30초 안에 캐릭터 생성' 단일 생성 요청.

    의도/원리:
    - 프론트는 최소 입력(이미지/성향/스타일/타입/분량/이름/한줄소개/옵션)만 전달한다.
    - 백엔드는 world_setting + 오프닝 + 엔딩2개(+선택: 스탯/설정메모)를 한 번에 구성해 저장한다.
    - 설정메모는 런타임 SSOT(`start_sets.setting_book.items`)에 넣는다.
    """

    # idempotency (동일 request_id 재요청 시 중복 생성 방지)
    request_id: Optional[str] = Field(None, max_length=64, description="중복 생성 방지용 요청 ID(선택)")

    # 필수 입력(요구사항)
    image_url: str = Field(..., min_length=1, max_length=500, description="업로드된 대표 이미지 URL")
    audience_slug: str = Field(..., min_length=1, max_length=24, description="성향 태그 slug(예: 남성향/여성향/전체)")
    style_slug: str = Field(..., min_length=1, max_length=24, description="이미지 스타일 태그 slug(예: 애니풍/실사풍/반실사/아트웤)")
    character_type: Literal["roleplay", "simulator"] = Field("roleplay", description="캐릭터 타입(롤플레잉/시뮬레이터)")
    # ✅ 시뮬 내 미연시 요소(선택):
    # - 30초 모달의 토글 값. simulator에서만 의미가 있다.
    # - OFF면 미연시 작법 지시를 넣지 않는 것이 품질에 유리하므로(요구사항), 기본값은 False/None으로 둔다.
    sim_dating_elements: Optional[bool] = Field(
        None,
        description="시뮬 내 미연시(루트/호감도/공략) 요소 포함 여부(선택)",
    )
    # 분량: 프론트 프리셋을 숫자로 확정해 전달(서버는 50턴 이상만 보장)
    max_turns: int = Field(200, ge=50, le=5000, description="총 진행 턴수(50~5000)")
    name: str = Field(..., min_length=1, max_length=100, description="캐릭터 이름(수동 또는 프론트 자동생성 결과)")
    one_line_intro: str = Field(..., min_length=1, max_length=500, description="한줄 소개(수동 또는 프론트 자동생성 결과)")

    # 선택 입력(요구사항)
    tags: List[str] = Field(default_factory=list, description="추가 태그 slug 목록(선택)")
    # 설정메모(최대 3개, 각 200자 권장) → start_sets.setting_book.items 로 저장
    setting_memos: List[str] = Field(default_factory=list, description="설정메모(최대 3개, 각 200자 권장)")
    # 작품 컨셉(선택): 위저드와 동일한 보조 입력. 30초 생성에서는 품질 보강 + start_sets에 저장.
    profile_concept: Optional[str] = Field(
        None,
        min_length=1,
        max_length=1500,
        description="작품 컨셉(선택, 1~1500자). 프롬프트/오프닝 생성 보조 입력 및 start_sets.profile_concept 저장.",
    )


class QuickConceptGenerateRequest(BaseModel):
    """작품 컨셉 AI 자동 생성 요청 (위저드 전용)"""

    name: str = Field(..., min_length=1, max_length=100, description="캐릭터 이름(프로필 입력값)")
    description: str = Field(..., min_length=1, max_length=500, description="한줄소개(프로필 입력값)")
    mode: Literal["simulator", "roleplay"] = Field("roleplay", description="모드 (simulator, roleplay)")
    tags: List[str] = Field(default_factory=list, description="선택된 태그(성향/스타일 등)")
    audience: str = Field("전체", max_length=24, description="성향(남성향/여성향/전체)")
    max_turns: int = Field(200, ge=10, le=5000, description="최대 턴수(10~5000)")
    sim_variant: Optional[str] = Field(None, max_length=16, description="시뮬 유형(dating/scenario)")
    sim_dating_elements: Optional[bool] = Field(None, description="시뮬 내 미연시 요소 포함 여부")


class QuickConceptGenerateResponse(BaseModel):
    """작품 컨셉 AI 자동 생성 응답"""

    concept: str = Field(..., min_length=1, max_length=1500, description="생성된 작품 컨셉 텍스트(산문형)")


class QuickPromptGenerateRequest(BaseModel):
    """프롬프트(=world_setting) 자동 생성 요청 (위저드 전용)"""

    name: str = Field(..., min_length=1, max_length=100, description="캐릭터 이름(프로필 입력값)")
    description: str = Field(..., min_length=1, max_length=3000, description="캐릭터 소개(프로필 입력값)")
    mode: Literal["simulator", "roleplay"] = Field("simulator", description="프롬프트 생성 모드 (simulator, roleplay)")
    # ✅ 시뮬 유형(선택): 프론트 위저드의 "시뮬 유형" 토글(미연시/시나리오)
    # - roleplay 모드에서는 무시된다(하위호환/운영 안전).
    sim_variant: Optional[str] = Field(
        None,
        max_length=16,
        description="시뮬 유형 힌트(선택): dating(미연시) | scenario(시나리오)",
    )
    # ✅ 시뮬 내 미연시 요소(선택):
    # - ON이면 '공략 인물/루트/호감도 이벤트'를 프롬프트에 강하게 포함한다.
    sim_dating_elements: Optional[bool] = Field(
        None,
        description="시뮬 내 미연시(루트/호감도/공략) 요소 포함 여부(선택)",
    )
    # ✅ 진행 턴수(필수 입력 UX) - 백엔드는 누락 시에도 안전하게 기본값을 사용한다(하위호환/운영 안정).
    max_turns: int = Field(200, ge=50, le=5000, description="진행 턴수(50~5000). 프롬프트에 반영됨.")
    # ✅ 무한모드 별도 허용(옵션) - 프롬프트에 정책으로 주입할 수 있는 힌트
    allow_infinite_mode: bool = Field(False, description="엔딩 이후 자유 대화(무한모드) 허용 여부")
    tags: List[str] = Field(default_factory=list, description="선택된 태그(성향/스타일 등)")
    ai_model: Optional[str] = Field("gemini", description="사용할 AI 모델 (gemini, claude, gpt)")


class QuickPromptGenerateResponse(BaseModel):
    """프롬프트(=world_setting) 자동 생성 응답"""

    prompt: str = Field(..., min_length=1, max_length=6000, description="생성된 프롬프트 텍스트(3000~6000자)")
    # ✅ 스탯 자동 입력(요구사항): 프론트의 '스탯 설정' 탭을 함께 채울 수 있도록 구조화된 초안 제공
    # - prompt 텍스트 파싱은 취약하므로, 응답에 stats를 별도로 내려준다(SSOT/운영 안정).
    stats: List[dict] = Field(default_factory=list, description="스탯 초안 리스트(오프닝 연동). 프론트에서 editable.")


class QuickStatGenerateRequest(BaseModel):
    """스탯 초안 자동 생성 요청 (위저드/다음단계 자동완성 전용)"""

    name: str = Field(..., min_length=1, max_length=100, description="캐릭터 이름(프로필 입력값)")
    description: str = Field(..., min_length=1, max_length=3000, description="캐릭터 소개(프로필 입력값 + 선택 참고 포함 가능)")
    world_setting: str = Field(..., min_length=1, max_length=6000, description="프롬프트(world_setting) 입력값")
    mode: Literal["simulator", "roleplay"] = Field("simulator", description="스탯 생성 모드 (simulator, roleplay)")
    tags: List[str] = Field(default_factory=list, description="선택된 태그(성향/스타일 등)")
    ai_model: Optional[str] = Field("gemini", description="사용할 AI 모델 (gemini, claude, gpt)")


class QuickStatGenerateResponse(BaseModel):
    """스탯 초안 자동 생성 응답"""

    stats: List[dict] = Field(default_factory=list, description="스탯 초안 리스트(오프닝 연동). 프론트에서 editable.")


class QuickFirstStartGenerateRequest(BaseModel):
    """첫시작(도입부+첫대사) 자동 생성 요청 (위저드 전용)"""

    name: str = Field(..., min_length=1, max_length=100, description="캐릭터 이름(프로필 입력값)")
    description: str = Field(..., min_length=1, max_length=3000, description="캐릭터 소개(프로필 입력값)")
    world_setting: str = Field(..., min_length=1, max_length=6000, description="프롬프트(world_setting) 입력값")
    # ✅ RP/시뮬 분기(요구사항): 오프닝/엔딩/스탯 자동생성 품질을 모드에 맞게 분리
    mode: Optional[Literal["roleplay", "simulator"]] = Field(
        None,
        description="첫시작 생성 모드 힌트(선택). simulator면 선택/목표/리스크 중심, roleplay면 관계/감정선 중심으로 생성."
    )
    # ✅ 시뮬 자동생성 옵션(위저드 SSOT: start_sets.sim_options)
    # - sim_variant: 'dating'(미연시) | 'scenario'(시나리오)
    # - sim_dating_elements: 시뮬 내 미연시 요소(루트/호감도/공략) 포함 여부
    sim_variant: Optional[Literal["dating", "scenario"]] = Field(
        None,
        description="시뮬 유형(선택). simulator 모드에서만 사용 권장."
    )
    sim_dating_elements: Optional[bool] = Field(
        None,
        description="시뮬 내 미연시 요소 포함 여부(선택). simulator 모드에서만 사용 권장."
    )
    tags: List[str] = Field(default_factory=list, description="선택된 태그(성향/스타일 등)")
    ai_model: Optional[str] = Field("gemini", description="사용할 AI 모델 (gemini, claude, gpt)")
    # ✅ 오프닝 변주(선택):
    # - 오프닝2(또는 N번째) 생성 시, 오프닝1과 비슷하게 나오는 문제를 방지하기 위한 힌트.
    # - 값이 없으면 기존처럼 단일 오프닝 생성으로 동작한다(하위호환).
    avoid_intro: Optional[str] = Field(
        None,
        max_length=2000,
        description="이전 오프닝 도입부(중복 방지 힌트, 선택)",
    )
    avoid_first_line: Optional[str] = Field(
        None,
        max_length=500,
        description="이전 오프닝 첫대사(중복 방지 힌트, 선택)",
    )


class QuickFirstStartGenerateResponse(BaseModel):
    """첫시작(도입부+첫대사) 자동 생성 응답"""

    intro: str = Field(..., min_length=1, max_length=2000, description="도입부(서술형 지문)")
    first_line: str = Field(..., min_length=1, max_length=500, description="첫대사(캐릭터 발화)")


class QuickDetailGenerateRequest(BaseModel):
    """디테일(성격/말투/태그칩) 자동 생성 요청 (위저드 전용)"""

    name: str = Field(..., min_length=1, max_length=100, description="캐릭터 이름(프로필 입력값)")
    description: str = Field(..., min_length=1, max_length=3000, description="캐릭터 소개(프로필 입력값)")
    world_setting: str = Field(..., min_length=1, max_length=6000, description="프롬프트(world_setting) 입력값")
    # ✅ 타입/토글 기반 모드(요구사항)
    # - 프론트는 character_type 및 섹션별 토글 상태를 전달한다.
    # - 백엔드는 이를 힌트로 사용해 "의미/라벨/가이드"에 맞는 결과물을 생성한다.
    mode: Optional[Literal["roleplay", "simulator"]] = Field(
        None,
        description="디테일 생성 모드 힌트(선택). 없으면 기본값(롤플레잉)으로 처리."
    )
    section_modes: Optional[Dict[str, Any]] = Field(
        None,
        description="섹션별 모드 override(선택). 예: {personality:'simulator', interests:'roleplay'}"
    )
    tags: List[str] = Field(default_factory=list, description="선택된 태그(성향/스타일 등)")
    ai_model: Optional[str] = Field("gemini", description="사용할 AI 모델 (gemini, claude, gpt)")


class QuickDetailGenerateResponse(BaseModel):
    """디테일(성격/말투/태그칩) 자동 생성 응답"""

    personality: str = Field(..., min_length=1, max_length=2000, description="성격 및 특징")
    speech_style: str = Field(..., min_length=1, max_length=2000, description="말투")
    interests: List[str] = Field(..., min_items=3, max_items=3, description="관심사(키워드 3개)")
    likes: List[str] = Field(..., min_items=3, max_items=3, description="좋아하는 것(키워드 3개)")
    dislikes: List[str] = Field(..., min_items=3, max_items=3, description="싫어하는 것(키워드 3개)")


class QuickSecretGenerateRequest(BaseModel):
    """비밀정보(secret) 자동 생성 요청 (위저드 전용)"""

    name: str = Field(..., min_length=1, max_length=100, description="캐릭터 이름(프로필 입력값)")
    description: str = Field(..., min_length=1, max_length=3000, description="캐릭터 소개(프로필 입력값)")
    world_setting: str = Field(..., min_length=1, max_length=6000, description="프롬프트(world_setting) 입력값")
    tags: List[str] = Field(default_factory=list, description="선택된 태그(성향/스타일 등)")
    ai_model: Optional[str] = Field("gemini", description="사용할 AI 모델 (gemini, claude, gpt)")


class QuickSecretGenerateResponse(BaseModel):
    """비밀정보(secret) 자동 생성 응답"""

    secret: str = Field(..., min_length=1, max_length=1000, description="유저에게 노출되면 안 되는 비밀 설정")


class QuickTurnEventsGenerateRequest(BaseModel):
    """턴수별 사건(오프닝 내) 자동 생성 요청 (위저드 전용)"""

    name: str = Field(..., min_length=1, max_length=100, description="캐릭터 이름(프로필 입력값)")
    description: str = Field(..., min_length=1, max_length=3000, description="캐릭터 소개(프로필 입력값)")
    world_setting: str = Field(..., min_length=1, max_length=6000, description="프롬프트(world_setting) 입력값")
    opening_intro: str = Field(..., min_length=1, max_length=2000, description="오프닝 도입부(첫 상황)")
    opening_first_line: str = Field(..., min_length=1, max_length=500, description="오프닝 첫 대사")
    mode: Optional[Literal["roleplay", "simulator"]] = Field(
        None,
        description="턴 사건 생성 모드 힌트(선택). 없으면 simulator 성격으로 생성될 수 있음."
    )
    # ✅ 시뮬 자동생성 옵션(위저드 SSOT: start_sets.sim_options)
    sim_variant: Optional[Literal["dating", "scenario"]] = Field(
        None,
        description="시뮬 유형(선택). simulator 모드에서만 사용 권장."
    )
    sim_dating_elements: Optional[bool] = Field(
        None,
        description="시뮬 내 미연시 요소 포함 여부(선택). simulator 모드에서만 사용 권장."
    )
    # ✅ 진행 턴수(필수) - 프론트에서 50턴 이상을 강제하지만, 백엔드에서도 방어적으로 제한한다.
    max_turns: int = Field(200, ge=50, le=5000, description="총 진행 턴수(50~5000). 사건 턴 배치/개수 상한에 사용.")
    tags: List[str] = Field(default_factory=list, description="선택된 태그(성향/스타일 등)")
    ai_model: Optional[str] = Field("gemini", description="사용할 AI 모델 (gemini, claude, gpt)")


class QuickTurnEventsGenerateResponse(BaseModel):
    """턴수별 사건(오프닝 내) 자동 생성 응답"""

    # 프론트 SSOT: start_sets.items[].turn_events
    # [{ id, title, about_turn, summary, required_narration, required_dialogue }]
    turn_events: List[dict] = Field(default_factory=list, description="턴 사건 리스트(오프닝 연동). 프론트에서 editable.")


class QuickEndingEpilogueGenerateRequest(BaseModel):
    """엔딩 에필로그(엔딩 내용) 자동 생성 요청 (위저드 전용)"""

    name: str = Field(..., min_length=1, max_length=100, description="캐릭터 이름(프로필 입력값)")
    description: str = Field(..., min_length=1, max_length=3000, description="캐릭터 소개(프로필 입력값)")
    world_setting: str = Field(..., min_length=1, max_length=6000, description="프롬프트(world_setting) 입력값")
    mode: Optional[Literal["roleplay", "simulator"]] = Field(
        None,
        description="에필로그 생성 모드 힌트(선택). simulator면 결과/후폭풍/상태 변화, roleplay면 감정선/관계 마무리 중심."
    )
    # ✅ 시뮬 자동생성 옵션(위저드 SSOT: start_sets.sim_options)
    sim_variant: Optional[Literal["dating", "scenario"]] = Field(
        None,
        description="시뮬 유형(선택). simulator 모드에서만 사용 권장."
    )
    sim_dating_elements: Optional[bool] = Field(
        None,
        description="시뮬 내 미연시 요소 포함 여부(선택). simulator 모드에서만 사용 권장."
    )
    # ✅ 엔딩은 오프닝(시작 설정)마다 달라질 수 있으므로, 현재 오프닝 맥락을 함께 전달한다.
    opening_intro: str = Field("", max_length=2000, description="오프닝 도입부(첫 상황) (선택)")
    opening_first_line: str = Field("", max_length=500, description="오프닝 첫 대사 (선택)")
    ending_title: str = Field(..., min_length=1, max_length=20, description="엔딩 이름(제목)")
    base_condition: str = Field(..., min_length=1, max_length=500, description="엔딩 기본 조건(요약/판정 근거)")
    hint: str = Field("", max_length=20, description="엔딩 힌트(선택)")
    # extra_conditions는 다양한 형태(type=text/stat)를 가질 수 있어 dict로 수용(SSOT는 프론트 start_sets)
    extra_conditions: List[dict] = Field(default_factory=list, description="엔딩 세부 조건 리스트(선택)")
    tags: List[str] = Field(default_factory=list, description="선택된 태그(성향/스타일 등)")
    ai_model: Optional[str] = Field("gemini", description="사용할 AI 모델 (gemini, claude, gpt)")


class QuickEndingEpilogueGenerateResponse(BaseModel):
    """엔딩 에필로그(엔딩 내용) 자동 생성 응답"""

    epilogue: str = Field(..., min_length=1, max_length=1000, description="엔딩 연출 텍스트(지문/대사 혼합 가능)")


class QuickEndingDraftGenerateRequest(BaseModel):
    """엔딩 제목/기본조건(초안) 자동 생성 요청 (위저드 전용)"""

    name: str = Field(..., min_length=1, max_length=100, description="캐릭터 이름(프로필 입력값)")
    description: str = Field(..., min_length=1, max_length=3000, description="캐릭터 소개(프로필 입력값)")
    world_setting: str = Field(..., min_length=1, max_length=6000, description="프롬프트(world_setting) 입력값")
    opening_intro: str = Field("", max_length=2000, description="오프닝 도입부(첫 상황) (선택)")
    opening_first_line: str = Field("", max_length=500, description="오프닝 첫 대사 (선택)")
    mode: Optional[Literal["roleplay", "simulator"]] = Field(
        None,
        description="엔딩 초안 생성 모드 힌트(선택). simulator면 조건/턴 기반, roleplay면 관계/감정선 기반(턴 제안은 0 가능)."
    )
    # ✅ 시뮬 자동생성 옵션(위저드 SSOT: start_sets.sim_options)
    sim_variant: Optional[Literal["dating", "scenario"]] = Field(
        None,
        description="시뮬 유형(선택). simulator 모드에서만 사용 권장."
    )
    sim_dating_elements: Optional[bool] = Field(
        None,
        description="시뮬 내 미연시 요소 포함 여부(선택). simulator 모드에서만 사용 권장."
    )
    max_turns: int = Field(200, ge=50, le=5000, description="총 진행 턴수(50~5000). 엔딩 턴 제안에 사용.")
    min_turns: int = Field(30, ge=10, le=5000, description="엔딩 최소 턴수(10~5000). 엔딩 턴 제안 하한.")
    tags: List[str] = Field(default_factory=list, description="선택된 태그(성향/스타일 등)")
    ai_model: Optional[str] = Field("gemini", description="사용할 AI 모델 (gemini, claude, gpt)")


class QuickEndingDraftGenerateResponse(BaseModel):
    """엔딩 제목/기본조건(초안) 자동 생성 응답"""

    title: str = Field(..., min_length=1, max_length=20, description="엔딩 제목")
    base_condition: str = Field(..., min_length=1, max_length=500, description="엔딩 기본 조건(요약/판정 근거)")
    hint: str = Field("", max_length=20, description="엔딩 힌트(선택)")
    suggested_turn: int = Field(0, ge=0, le=5000, description="엔딩 발생 턴 제안(0이면 미제안)")

