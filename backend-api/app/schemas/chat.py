"""
채팅 관련 Pydantic 스키마
"""

from pydantic import BaseModel, Field, ConfigDict
from typing import Optional, Dict, Any, Literal, List
from datetime import datetime
import uuid

from app.schemas.character import CharacterCreateRequest


class ChatMessageBase(BaseModel):
    """채팅 메시지 기본 스키마"""
    content: str


class ChatRoomBase(BaseModel):
    """채팅방 기본 스키마"""
    character_id: uuid.UUID


class ChatRoomCreate(ChatRoomBase):
    """채팅방 생성 스키마"""
    pass


class ChatMessageCreate(ChatMessageBase):
    """채팅 메시지 생성 스키마"""
    chat_room_id: uuid.UUID
    sender_type: str


class CreateChatRoomRequest(ChatRoomBase):
    """채팅방 생성 요청 스키마"""
    # ✅ 일반 캐릭터챗: 시작 오프닝(start_sets item id) 선택
    # - DB 스키마 변경 없이, "첫 메시지(intro)"에 metadata로 보관하는 용도다.
    # - 예: "set_123abc" (UUID 아님)
    opening_id: Optional[str] = Field(None, max_length=80, description="시작 오프닝(start_sets item id). 선택 시 해당 오프닝으로 시작.")


class SendMessageRequest(BaseModel):
    """메시지 전송 요청 스키마"""
    character_id: uuid.UUID
    content: str
    room_id: Optional[uuid.UUID] = None  # 추가
    response_length_override: Optional[str] = None  # 'short' | 'medium' | 'long'
    # ✅ 프론트에서 전달하는 공통 설정 패치(예: temperature/응답길이 등)
    settings_patch: Dict[str, Any] | None = None


class ChatMessageResponse(ChatMessageBase):
    """채팅 메시지 응답 스키마"""
    id: uuid.UUID
    chat_room_id: uuid.UUID
    sender_type: str
    message_metadata: Dict[str, Any] | None = None
    created_at: datetime
    upvotes: int | None = 0
    downvotes: int | None = 0

    class Config:
        from_attributes = True


class CharacterForChatResponse(BaseModel):
    """채팅에 사용되는 캐릭터 응답 스키마"""
    id: uuid.UUID
    name: str
    avatar_url: Optional[str] = None
    origin_story_id: Optional[uuid.UUID] = None
    creator_id: Optional[uuid.UUID] = None
    creator_username: Optional[str] = None
    creator_avatar_url: Optional[str] = None

    class Config:
        from_attributes = True


class ChatRoomResponse(BaseModel):
    """채팅방 응답 스키마"""
    id: uuid.UUID
    user_id: uuid.UUID
    character_id: uuid.UUID
    title: Optional[str] = None
    message_count: int = 0
    summary: Optional[str]
    character: CharacterForChatResponse
    created_at: datetime
    updated_at: datetime
    session_id: Optional[str] = None
    class Config:
        from_attributes = True


class SendMessageResponse(BaseModel):
    """메시지 전송 응답 스키마"""
    # continue 모드 등 일부 상황에서 사용자 메시지가 저장되지 않을 수 있어 Optional 허용
    user_message: ChatMessageResponse | None = None
    ai_message: ChatMessageResponse
    # ✅ 엔딩 메시지(선택): 엔딩 트리거 시 별도 메시지로 반환
    # - 의도: UI에서 엔딩을 카드/분리된 말풍선으로 표현할 수 있게 한다.
    ending_message: ChatMessageResponse | None = None
    # 선택지/경고/메타데이터 전달용 (프론트는 선택적으로 사용)
    meta: Dict[str, Any] | None = None
    suggested_image_index: int = -1


# =========================
# ✅ 일반 캐릭터챗: 요술봉(선택지 3개) 생성
# =========================

class MagicChoice(BaseModel):
    """
    요술봉 선택지 1개.

    의도:
    - 프론트에서 버튼 key로 쓸 수 있는 안정적인 id를 제공한다.
    - label은 유저가 그대로 전송해도 자연스러운 1~2문장 입력을 목표로 한다.
    """
    id: str
    label: str
    # ✅ 경쟁사 UX: "대사 1줄 + 지문 1줄" 분리 렌더링용(선택지 버튼에서 컬러 분리)
    # - label은 하위호환/전송용 SSOT(필수)
    # - dialogue/narration은 UI 표현을 위한 힌트(옵션)
    dialogue: str | None = None
    narration: str | None = None


class MagicChoicesResponse(BaseModel):
    """요술봉 선택지 생성 응답"""
    choices: List[MagicChoice] = Field(default_factory=list)


class ChatMessageUpdate(BaseModel):
    content: str


class RegenerateRequest(BaseModel):
    instruction: str | None = None


class MessageFeedback(BaseModel):
    action: Literal['upvote','downvote']


# =========================
# ✅ 캐릭터 생성 미리보기 채팅
# =========================

class ChatPreviewTurn(BaseModel):
    """채팅 미리보기 히스토리 턴"""
    role: Literal["user", "assistant"]
    content: str = Field(..., max_length=4000)


class ChatPreviewRequest(BaseModel):
    """캐릭터 생성(초안) 기반 채팅 미리보기 요청"""
    character_data: CharacterCreateRequest
    user_message: str = Field(..., max_length=4000)
    history: List[ChatPreviewTurn] = Field(default_factory=list)
    response_length_pref: Optional[Literal["short", "medium", "long"]] = "short"


class ChatPreviewResponse(BaseModel):
    """채팅 미리보기 응답"""
    assistant_message: str
    meta: Dict[str, Any] | None = None


class ChatPreviewMagicChoicesRequest(BaseModel):
    """
    ✅ 캐릭터 생성 미리보기: 요술봉(선택지 3개) 생성 요청

    의도/원리:
    - 실제 채팅방(room)을 만들지 않고도, 위저드 프리뷰에서 '선택지 3개' UX를 확인할 수 있어야 한다.
    - 입력된 초안(character_data) + 현재 프리뷰 히스토리(history)를 기반으로 "다음 유저 입력" 선택지를 생성한다.
    """

    character_data: CharacterCreateRequest
    history: List[ChatPreviewTurn] = Field(default_factory=list)
    n: int = Field(3, ge=1, le=5, description="생성할 선택지 개수(1~5)")
    seed_hint: str | None = Field(None, max_length=200)
    seed_message_id: str | None = Field(None, max_length=80)
