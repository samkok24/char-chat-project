"""
캐릭터 관련 Pydantic 스키마 - CAVEDUCK 스타일 고급 캐릭터 생성
"""

from pydantic import BaseModel, Field, ConfigDict, computed_field, HttpUrl, field_validator
from typing import Optional, List, Dict, Any
from datetime import datetime
from decimal import Decimal
import uuid
from uuid import UUID
import re
from html.parser import HTMLParser
from html import escape as _html_escape
from urllib.parse import urlparse


# 🔥 1단계: 기본 정보 스키마

def _sanitize_text(value: Optional[str], max_length: Optional[int] = None) -> Optional[str]:
    if value is None:
        return None
    text = re.sub(r'<[^>]*>', '', str(value)).strip()
    if max_length is not None and len(text) > max_length:
        raise ValueError(f'최대 {max_length}자까지 입력할 수 있습니다.')
    return text or None


# ✅ 크리에이터 코멘트 HTML 지원(자바스크립트 차단)
# - 외부 라이브러리(bleach 등) 없이 표준 라이브러리로 "허용 태그만" 보존한다.
# - script/iframe 등 위험 태그는 내용까지 제거하고, 이벤트 핸들러(onclick 등)·javascript: URL은 차단한다.
_CREATOR_COMMENT_ALLOWED_TAGS = {
    "b", "strong", "i", "em", "u", "s",
    "br", "p", "ul", "ol", "li",
    "blockquote", "code", "pre",
    "a",
}
_CREATOR_COMMENT_VOID_TAGS = {"br"}
_CREATOR_COMMENT_SKIP_TAGS = {"script", "style", "iframe", "object", "embed"}


class _CreatorCommentHTMLSanitizer(HTMLParser):
    """
    크리에이터 코멘트(user_display_description)를 안전한 HTML로 정제한다.

    동작/의도:
    - 허용 태그만 유지하고, 나머지는 태그만 제거(텍스트는 유지)한다.
    - <script>/<style>/<iframe> 등은 내용까지 제거한다.
    - <a href="javascript:...">, on* 이벤트 속성은 제거한다.
    - 출력은 "정제된 HTML 문자열"이며, 프론트에서 dangerouslySetInnerHTML로 렌더링 가능하다.
    """

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self._out: List[str] = []
        self._skip_stack: List[str] = []

    @staticmethod
    def _sanitize_href(raw: Optional[str]) -> Optional[str]:
        if not raw:
            return None
        href = str(raw).strip()
        if not href:
            return None
        # protocol-relative(//)는 의도치 않은 외부 이동이 될 수 있어 차단
        if href.startswith("//"):
            return None
        try:
            parsed = urlparse(href)
            scheme = (parsed.scheme or "").lower()
            if scheme in ("http", "https", "mailto"):
                return href
            if scheme == "":
                # 상대 경로/앵커 허용
                return href
            # javascript:, data: 등 차단
            return None
        except Exception:
            return None

    def handle_starttag(self, tag, attrs):
        t = (tag or "").lower()
        if t in _CREATOR_COMMENT_SKIP_TAGS:
            self._skip_stack.append(t)
            return
        if self._skip_stack:
            return
        if t not in _CREATOR_COMMENT_ALLOWED_TAGS:
            return

        safe_attrs = []
        if t == "a":
            attr_map = {str(k).lower(): v for (k, v) in (attrs or []) if k}
            href = self._sanitize_href(attr_map.get("href"))
            if href:
                safe_attrs.append(("href", href))
            title = attr_map.get("title")
            if title:
                safe_attrs.append(("title", str(title)))
            target = str(attr_map.get("target") or "").strip().lower()
            if target in ("_blank", "_self"):
                safe_attrs.append(("target", target))
                if target == "_blank":
                    safe_attrs.append(("rel", "noopener noreferrer"))

        attr_str = "".join([f' {k}="{_html_escape(str(v), quote=True)}"' for (k, v) in safe_attrs])
        if t in _CREATOR_COMMENT_VOID_TAGS:
            self._out.append(f"<{t}{attr_str} />")
        else:
            self._out.append(f"<{t}{attr_str}>")

    def handle_endtag(self, tag):
        t = (tag or "").lower()
        if t in _CREATOR_COMMENT_SKIP_TAGS:
            # 가장 가까운 skip 태그 하나를 종료 처리
            if self._skip_stack:
                while self._skip_stack:
                    popped = self._skip_stack.pop()
                    if popped == t:
                        break
            return
        if self._skip_stack:
            return
        if t in _CREATOR_COMMENT_ALLOWED_TAGS and t not in _CREATOR_COMMENT_VOID_TAGS:
            self._out.append(f"</{t}>")

    def handle_startendtag(self, tag, attrs):
        t = (tag or "").lower()
        if t in _CREATOR_COMMENT_VOID_TAGS:
            self.handle_starttag(tag, attrs)
            return
        self.handle_starttag(tag, attrs)
        self.handle_endtag(tag)

    def handle_data(self, data):
        if self._skip_stack:
            return
        if data is None:
            return
        # 텍스트는 항상 escape해서 HTML 주입을 차단
        self._out.append(_html_escape(str(data), quote=False))

    def handle_comment(self, data):
        # 주석은 제거(불필요/오해 소지)
        return


def _sanitize_creator_comment_html(value: Optional[str], max_length: Optional[int] = None) -> Optional[str]:
    """
    크리에이터 코멘트(user_display_description) 전용 sanitize.

    주의:
    - 일반 텍스트 필드와 달리 HTML 태그를 일부 허용하므로, XSS 방지를 위해 반드시 정제 후 저장한다.
    - max_length는 "정제된 HTML 문자열 길이" 기준으로 검사한다.
    """
    if value is None:
        return None
    raw = str(value)
    if not raw.strip():
        return None
    try:
        parser = _CreatorCommentHTMLSanitizer()
        parser.feed(raw)
        parser.close()
        cleaned = "".join(parser._out).strip()
    except Exception:
        # 방어: 파서가 깨지면 기존 텍스트 sanitize로 폴백(HTML은 보존 못하지만 저장 실패는 방지)
        cleaned = _sanitize_text(raw, max_length) or ""
    if max_length is not None and len(cleaned) > max_length:
        raise ValueError(f'최대 {max_length}자까지 입력할 수 있습니다.')
    return cleaned or None


class IntroductionScene(BaseModel):
    """도입부 시나리오"""
    title: str = Field(..., max_length=100)
    content: str = Field(..., max_length=2000)
    secret: Optional[str] = Field(None, max_length=1000)  # 비밀 정보

    @field_validator('title', 'content', 'secret', mode='before')
    @classmethod
    def validate_scene_text(cls, v, info):
        max_len = {'title': 100, 'content': 2000, 'secret': 1000}.get(info.field_name, None)
        return _sanitize_text(v, max_len)


class CharacterBasicInfo(BaseModel):
    """캐릭터 기본 정보 (1단계)"""
    # 기본 정보
    name: str = Field(..., min_length=1, max_length=100)
    description: Optional[str] = Field(None, max_length=3000)
    personality: Optional[str] = Field(None, max_length=2000)
    speech_style: Optional[str] = Field(None, max_length=2000)
    greeting: Optional[str] = Field(None, max_length=500)

    # 세계관 설정
    # ✅ 프롬프트 상향(운영 합의): 6000자까지 허용
    world_setting: Optional[str] = Field(None, max_length=6000)
    # ✅ 요구사항: 크리에이터 코멘트는 1000자 제한(선택)
    user_display_description: Optional[str] = Field(None, max_length=1000)
    use_custom_description: bool = False

    # 도입부 시스템
    introduction_scenes: List[IntroductionScene] = Field(default_factory=list)

    # ✅ 시작 세트(도입부+첫대사) - 일반 캐릭터챗 전용 확장(SSOT)
    # - 기존 greeting/introduction_scenes를 재편하지 않고, 신규 UI에서만 사용하는 JSON 저장소.
    # - 저장 시에는 start_sets가 SSOT이고, 선택된 1개 세트를 greeting/introduction_scenes에 미러링한다(호환성).
    start_sets: Optional[Dict[str, Any]] = None

    # 레거시 호환 및 기타 필드
    background_story: Optional[str] = Field(None, max_length=5000, description="world_setting으로 대체됨")
    avatar_url: Optional[HttpUrl] = None
    is_public: bool = True
    
    # 캐릭터 타입 및 언어
    # ✅ 요구사항: 프롬프트 단계에서 "커스텀(수동)" 모드를 허용한다.
    # - 저장/응답 스키마에서 검증이 막히면 프론트에서 선택해도 400이 나므로 허용값에 추가한다.
    # - 채팅 로직은 simulator만 특수 처리하고 그 외는 roleplay 기본 흐름으로 동작하므로 안전하다.
    character_type: str = Field(default="roleplay", pattern="^(roleplay|simulator|custom)$")
    base_language: str = Field(default="ko", max_length=10)
    
    tags: Optional[List[str]] = Field(default_factory=list)
    example_dialogues: Optional[Dict[str, str]] = Field(default_factory=dict)

    @field_validator('introduction_scenes')
    @classmethod
    def limit_intro_scenes(cls, v):
        if v is not None and len(v) > 10:
            raise ValueError('도입부는 최대 10개까지 등록할 수 있습니다.')
        return v
    @field_validator(
        'name',
        'description',
        'personality',
        'speech_style',
        'greeting',
        'world_setting',
        'user_display_description',
        mode='before'
    )
    @classmethod
    def sanitize_basic_fields(cls, v, info):
        max_len_map = {
            'name': 100,
            'description': 3000,
            'personality': 2000,
            'speech_style': 2000,
            'greeting': 500,
            # ✅ 프롬프트 상향(운영 합의): 6000자까지 허용
            'world_setting': 6000,
            # ✅ 요구사항: 크리에이터 코멘트는 1000자 제한(선택)
            'user_display_description': 1000,
        }
        if info.field_name == 'user_display_description':
            return _sanitize_creator_comment_html(v, max_len_map.get(info.field_name))
        return _sanitize_text(v, max_len_map.get(info.field_name))


# 🎨 2단계: 미디어 설정 스키마

class ImageDescription(BaseModel):
    """이미지 설명 및 키워드 트리거"""
    description: str = Field(default='', max_length=500)
    url: Optional[str] = Field(None, max_length=500)
    keywords: List[str] = Field(default_factory=list, max_length=20)  # 키워드 트리거 (최대 20개)

    @field_validator('description', mode='before')
    @classmethod
    def sanitize_desc(cls, v):
        """
        이미지 설명(description) 정제(방어적).

        문제/원인:
        - `_sanitize_text()`는 빈 문자열/공백을 `None`으로 반환한다.
        - 그런데 `description` 필드는 `str`(non-optional)이라, 클라이언트가 `description: ""`을 보내면
          validator가 `None`을 반환 → Pydantic이 "Input should be a valid string" 422를 발생시킨다.

        해결:
        - 빈 값은 항상 빈 문자열("")로 정규화하여, 수정(Edit)에서도 422로 막히지 않도록 한다.
        """
        return _sanitize_text(v, 500) or ''
    
    @field_validator('keywords', mode='before')
    @classmethod
    def sanitize_keywords(cls, v):
        if not v:
            return []
        if isinstance(v, str):
            # 쉼표로 구분된 문자열 처리
            v = [k.strip() for k in v.split(',') if k.strip()]
        # 각 키워드 정리 및 중복 제거
        cleaned = []
        seen = set()
        for kw in v[:20]:  # 최대 20개
            kw_clean = str(kw).strip()[:50]  # 각 키워드 최대 50자
            if kw_clean and kw_clean.lower() not in seen:
                cleaned.append(kw_clean)
                seen.add(kw_clean.lower())
        return cleaned


class VoiceSettings(BaseModel):
    """음성 설정"""
    voice_id: Optional[str] = None
    voice_style: Optional[str] = None
    enabled: bool = False


class CharacterMediaSettings(BaseModel):
    """캐릭터 미디어 설정 (2단계)"""
    avatar_url: Optional[str] = Field(None, max_length=500)
    image_descriptions: List[ImageDescription] = Field(default_factory=list)
    voice_settings: Optional[VoiceSettings] = None


# 💬 3단계: 예시 대화 스키마

class ExampleDialogue(BaseModel):
    """예시 대화"""
    user_message: str = Field(..., max_length=500)
    character_response: str = Field(..., max_length=1000)
    order_index: int = 0

    @field_validator('user_message', 'character_response', mode='before')
    @classmethod
    def sanitize_dialogue(cls, v, info):
        max_len = 500 if info.field_name == 'user_message' else 1000
        return _sanitize_text(v, max_len)


class CharacterExampleDialogues(BaseModel):
    """캐릭터 예시 대화 설정 (3단계)"""
    dialogues: List[ExampleDialogue] = Field(default_factory=list)

    @field_validator('dialogues')
    @classmethod
    def limit_dialogues(cls, v):
        if v is not None and len(v) > 20:
            raise ValueError('예시 대화는 최대 20개까지 등록할 수 있습니다.')
        return v


# ❤️ 4단계: 호감도 시스템 스키마

class AffinityStage(BaseModel):
    """호감도 단계"""
    min_value: int = Field(..., ge=0)
    max_value: Optional[int] = Field(None, ge=0)
    description: str = Field(..., max_length=500)


class CharacterAffinitySystem(BaseModel):
    """캐릭터 호감도 시스템 (4단계)"""
    has_affinity_system: bool = False
    affinity_rules: Optional[str] = Field(None, max_length=2000)  # 증감 규칙
    affinity_stages: List[AffinityStage] = Field(default_factory=list)


# 🚀 5단계: 공개 설정 스키마

class CharacterPublishSettings(BaseModel):
    """캐릭터 공개 설정 (5단계)"""
    is_public: bool = True
    custom_module_id: Optional[uuid.UUID] = None
    use_translation: bool = True


# 🔧 통합 캐릭터 생성/수정 스키마

class CharacterCreateRequest(BaseModel):
    """CAVEDUCK 스타일 캐릭터 생성 요청"""
    # 1단계: 기본 정보
    basic_info: CharacterBasicInfo
    
    # 2단계: 미디어 설정
    media_settings: Optional[CharacterMediaSettings] = None
    
    # 3단계: 예시 대화
    example_dialogues: Optional[CharacterExampleDialogues] = None
    
    # 4단계: 호감도 시스템
    affinity_system: Optional[CharacterAffinitySystem] = None
    
    # 5단계: 공개 설정
    publish_settings: CharacterPublishSettings = Field(default_factory=CharacterPublishSettings)


class CharacterUpdateRequest(BaseModel):
    """CAVEDUCK 스타일 캐릭터 수정 요청"""
    # 모든 필드를 Optional로 설정
    basic_info: Optional[CharacterBasicInfo] = None
    media_settings: Optional[CharacterMediaSettings] = None
    example_dialogues: Optional[CharacterExampleDialogues] = None
    affinity_system: Optional[CharacterAffinitySystem] = None
    publish_settings: Optional[CharacterPublishSettings] = None


# 📊 응답 스키마

class CharacterExampleDialogueResponse(BaseModel):
    """예시 대화 응답"""
    model_config = ConfigDict(from_attributes=True)
    
    id: uuid.UUID
    user_message: str
    character_response: str
    order_index: int
    created_at: datetime


class CharacterSettingResponse(BaseModel):
    """캐릭터 AI 설정 응답"""
    model_config = ConfigDict(from_attributes=True)
    
    id: uuid.UUID
    character_id: uuid.UUID
    ai_model: str
    temperature: Decimal
    max_tokens: int
    system_prompt: Optional[str]
    custom_prompt_template: Optional[str]
    use_memory: bool
    memory_length: int
    response_style: str
    created_at: datetime
    updated_at: datetime


class CharacterDetailResponse(BaseModel):
    """캐릭터 상세 정보 응답"""
    model_config = ConfigDict(from_attributes=True)
    
    # 기본 정보
    id: uuid.UUID
    creator_id: uuid.UUID
    name: str
    description: Optional[str]
    personality: Optional[str]
    speech_style: Optional[str]
    greeting: Optional[str]
    
    # 세계관
    world_setting: Optional[str]
    user_display_description: Optional[str]
    use_custom_description: bool
    
    # 도입부 (JSON 형태로 저장된 데이터)
    introduction_scenes: Optional[List[Dict[str, Any]]]

    # 시작 세트(도입부+첫대사) - SSOT (일반 캐릭터챗 UI용)
    start_sets: Optional[Dict[str, Any]] = None
    
    # 캐릭터 타입
    character_type: str
    base_language: str
    
    # 미디어
    avatar_url: Optional[str]
    image_descriptions: Optional[List[Dict[str, Any]]]
    voice_settings: Optional[Dict[str, Any]]
    
    # 호감도 시스템
    has_affinity_system: bool
    affinity_rules: Optional[str]
    affinity_stages: Optional[List[Dict[str, Any]]]
    
    # 공개 설정
    is_public: bool
    is_active: bool
    custom_module_id: Optional[uuid.UUID]
    use_translation: bool
    
    # 통계
    chat_count: int
    like_count: int
    origin_story_id: Optional[uuid.UUID] = None
    # 원작 웹소설 카드용 보강 필드
    origin_story_title: Optional[str] = None
    origin_story_cover: Optional[str] = None
    origin_story_creator: Optional[str] = None
    origin_story_views: Optional[int] = None
    origin_story_likes: Optional[int] = None
    origin_story_excerpt: Optional[str] = None
    
    # 타임스탬프
    created_at: datetime
    updated_at: datetime
    
    # 관련 데이터
    example_dialogues: List[CharacterExampleDialogueResponse] = Field(default_factory=list)
    settings: Optional[CharacterSettingResponse] = None
    creator_username: Optional[str] = None
    creator_avatar_url: Optional[str] = None
    is_liked: Optional[bool] = False

class CharacterListResponse(BaseModel):
    """캐릭터 목록 응답 (간소화)"""
    model_config = ConfigDict(from_attributes=True)
    
    id: uuid.UUID
    creator_id: uuid.UUID
    name: str
    description: Optional[str]
    greeting: Optional[str]
    avatar_url: Optional[str]
    source_type: Optional[str] = "ORIGINAL"
    # ✅ 목록/격자 UX 보강:
    # - character_type: 롤플/시뮬/커스텀 배지 표시에 사용
    # - max_turns: 격자 좌상단 '턴수 배지' 표시에 사용(start_sets SSOT에서 파생)
    character_type: Optional[str] = None
    max_turns: Optional[int] = None
    # 썸네일(목록/카드용): avatar가 없으면 첫 갤러리 이미지를 사용
    thumbnail_url: Optional[str] = None
    # 계산을 위해 목록 응답에도 이미지 설명 배열을 전달(옵션)
    image_descriptions: Optional[List[Dict[str, Any]]] = None
    chat_count: int
    like_count: int
    origin_story_id: Optional[uuid.UUID] = None
    is_origchat: bool = False
    is_public: bool
    created_at: datetime
    creator_username: Optional[str] = None
    creator_avatar_url: Optional[str] = None

    def model_post_init(self, __context: Any) -> None:  # type: ignore[override]
        # avatar_url 우선, 없으면 image_descriptions[0].url 사용
        if not getattr(self, 'thumbnail_url', None):
            avatar = getattr(self, 'avatar_url', None)
            if avatar:
                self.thumbnail_url = avatar
            else:
                images = getattr(self, 'image_descriptions', None) or []
                if isinstance(images, list) and images:
                    first = images[0]
                    url = first.get('url') if isinstance(first, dict) else None
                    if url:
                        self.thumbnail_url = url


class RecentCharacterResponse(CharacterListResponse):
    """최근 대화한 캐릭터 응답 (UX 강화용 확장)"""
    chat_room_id: uuid.UUID  # 해당 채팅방 ID (클릭 시 이동용)
    last_chat_time: Optional[datetime]  # 마지막 대화 시간
    last_message_snippet: Optional[str] = Field(None, max_length=100)  # 마지막 메시지 짧은 요약
    # 원작 웹소설 배지용 메타(있을 때만)
    origin_story_title: Optional[str] = None


# 🔧 고급 설정 스키마

class WorldSettingCreate(BaseModel):
    """세계관 생성"""
    name: str = Field(..., max_length=100)
    description: str = Field(..., max_length=3000)
    rules: Optional[str] = Field(None, max_length=2000)
    is_public: bool = False


class WorldSettingResponse(BaseModel):
    """세계관 응답"""
    model_config = ConfigDict(from_attributes=True)
    
    id: uuid.UUID
    name: str
    description: str
    rules: Optional[str]
    is_public: bool
    usage_count: int
    created_at: datetime


class CustomModuleCreate(BaseModel):
    """커스텀 모듈 생성"""
    name: str = Field(..., max_length=100)
    description: Optional[str] = Field(None, max_length=1000)
    custom_prompt: Optional[str] = Field(None, max_length=5000)
    lorebook: Optional[Dict[str, Any]] = None
    is_public: bool = False


class CustomModuleResponse(BaseModel):
    """커스텀 모듈 응답"""
    model_config = ConfigDict(from_attributes=True)
    
    id: uuid.UUID
    name: str
    description: Optional[str]
    is_public: bool
    usage_count: int
    created_at: datetime


# 레거시 호환성을 위한 기존 스키마들 (단순화된 버전)

class CharacterBase(BaseModel):
    """캐릭터 기본 스키마 (레거시 호환성)"""
    name: str = Field(..., min_length=1, max_length=100)
    description: Optional[str] = Field(None, max_length=1000)
    personality: Optional[str] = Field(None, max_length=2000)
    speech_style: Optional[str] = Field(None, max_length=2000)
    greeting: Optional[str] = Field(None, max_length=500)
    background_story: Optional[str] = Field(None, max_length=5000)
    avatar_url: Optional[str] = Field(None, max_length=500)
    is_public: bool = True


class CharacterCreate(CharacterBase):
    """캐릭터 생성 스키마 (레거시)"""
    pass


class CharacterUpdate(BaseModel):
    """캐릭터 업데이트 스키마 (레거시)"""
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    description: Optional[str] = Field(None, max_length=1000)
    personality: Optional[str] = Field(None, max_length=2000)
    speech_style: Optional[str] = Field(None, max_length=2000)
    greeting: Optional[str] = Field(None, max_length=500)
    background_story: Optional[str] = Field(None, max_length=5000)
    avatar_url: Optional[str] = Field(None, max_length=500)
    is_public: Optional[bool] = None


class CharacterResponse(CharacterBase):
    """캐릭터 응답 스키마 (레거시)"""
    model_config = ConfigDict(from_attributes=True)
    
    id: uuid.UUID
    creator_id: uuid.UUID
    is_active: bool
    chat_count: int
    like_count: int
    created_at: datetime
    updated_at: datetime


class CharacterWithCreator(CharacterResponse):
    """캐릭터 정보 + 생성자 정보 (레거시)"""
    creator_id: uuid.UUID
    creator_username: Optional[str] = None
    is_liked: Optional[bool] = False


class CharacterSetting(BaseModel):
    ai_model: str = Field("gpt-4-turbo", max_length=100)
    system_prompt: Optional[str] = Field(None)
    temperature: float = Field(0.7, ge=0.0, le=2.0)
    max_tokens: int = Field(1024, ge=1)
    use_memory: bool = True
    memory_length: int = Field(10, ge=1)

class CharacterSettingCreate(CharacterSetting):
    pass

class CharacterSettingUpdate(BaseModel):
    ai_model: Optional[str] = Field(None, max_length=100)
    system_prompt: Optional[str] = Field(None)
    temperature: Optional[float] = Field(None, ge=0.0, le=2.0)
    max_tokens: Optional[int] = Field(None, ge=1)
    use_memory: Optional[bool] = None
    memory_length: Optional[int] = Field(None, ge=1)

