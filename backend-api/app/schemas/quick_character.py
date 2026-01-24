"""
온보딩 '30초만에 캐릭터 만나기'용 스키마

의도:
- 유저가 입력한 "캐릭터 이름/느낌(한 줄 설정)/태그/이미지"를 기반으로
  캐릭터 생성 폼(고급)의 주요 필드를 AI가 자동 완성할 수 있도록 초안(draft)을 생성한다.
- 생성(DB 저장)은 별도 `/characters/advanced` API에서 수행한다(SSOT).
"""

from pydantic import BaseModel, Field
from typing import List, Optional, Literal


class QuickCharacterGenerateRequest(BaseModel):
    """빠른 캐릭터 생성 초안 요청"""

    name: str = Field(..., min_length=1, max_length=100, description="캐릭터 이름")
    seed_text: str = Field(..., min_length=1, max_length=2000, description="원하는 캐릭터 느낌/설정(자유 텍스트)")
    image_url: Optional[str] = Field(None, max_length=500, description="업로드된 대표 이미지 URL(선택)")
    tags: List[str] = Field(default_factory=list, description="유저가 선택한 태그(이름/키워드)")
    ai_model: Optional[str] = Field("gemini", description="사용할 AI 모델 (gemini, claude, gpt)")


class QuickPromptGenerateRequest(BaseModel):
    """프롬프트(=world_setting) 자동 생성 요청 (위저드 전용)"""

    name: str = Field(..., min_length=1, max_length=100, description="캐릭터 이름(프로필 입력값)")
    description: str = Field(..., min_length=1, max_length=3000, description="캐릭터 소개(프로필 입력값)")
    mode: Literal["simulator", "roleplay"] = Field("simulator", description="프롬프트 생성 모드 (simulator, roleplay)")
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


class QuickFirstStartGenerateRequest(BaseModel):
    """첫시작(도입부+첫대사) 자동 생성 요청 (위저드 전용)"""

    name: str = Field(..., min_length=1, max_length=100, description="캐릭터 이름(프로필 입력값)")
    description: str = Field(..., min_length=1, max_length=3000, description="캐릭터 소개(프로필 입력값)")
    world_setting: str = Field(..., min_length=1, max_length=6000, description="프롬프트(world_setting) 입력값")
    tags: List[str] = Field(default_factory=list, description="선택된 태그(성향/스타일 등)")
    ai_model: Optional[str] = Field("gemini", description="사용할 AI 모델 (gemini, claude, gpt)")


class QuickFirstStartGenerateResponse(BaseModel):
    """첫시작(도입부+첫대사) 자동 생성 응답"""

    intro: str = Field(..., min_length=1, max_length=2000, description="도입부(서술형 지문)")
    first_line: str = Field(..., min_length=1, max_length=500, description="첫대사(캐릭터 발화)")


class QuickDetailGenerateRequest(BaseModel):
    """디테일(성격/말투/태그칩) 자동 생성 요청 (위저드 전용)"""

    name: str = Field(..., min_length=1, max_length=100, description="캐릭터 이름(프로필 입력값)")
    description: str = Field(..., min_length=1, max_length=3000, description="캐릭터 소개(프로필 입력값)")
    world_setting: str = Field(..., min_length=1, max_length=6000, description="프롬프트(world_setting) 입력값")
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

