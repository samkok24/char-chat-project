"""
원작챗 v2 관련 Pydantic 스키마(서버 내부/외부용)
UI/UX 변경 없이도 사용 가능하도록 선택적 필드를 기본으로 둔다.
"""
from pydantic import BaseModel
from typing import List, Optional, Literal


class SceneMeta(BaseModel):
    id: str
    title: Optional[str] = None
    hint: Optional[str] = None


class ChapterScenes(BaseModel):
    no: int
    scenes: List[SceneMeta] = []


class StartCandidate(BaseModel):
    chapter: int
    scene_id: Optional[str] = None
    label: str


class StartOptionsV2(BaseModel):
    overview: Optional[str] = None
    modes: List[Literal["canon", "parallel"]] = ["canon", "parallel"]
    chapter_scene_index: List[ChapterScenes] = []
    top_candidates: List[StartCandidate] = []
    # 선택: 평행 세계 what-if 씨앗 후보
    seeds: Optional[List[StartCandidate]] = None


class ContextStatus(BaseModel):
    warmed: bool = False
    updated: List[str] = []


class StartPoint(BaseModel):
    chapter: int
    scene_id: Optional[str] = None


class OrigChatStartV2Request(BaseModel):
    story_id: str
    character_id: str
    mode: Literal["canon", "parallel"] = "canon"
    start: Optional[StartPoint] = None
    focus_character_id: Optional[str] = None
    range_from: Optional[int] = None
    range_to: Optional[int] = None


class TurnV2Request(BaseModel):
    room_id: str
    user_text: Optional[str] = None
    choice_id: Optional[str] = None
    situation_text: Optional[str] = None
    trigger: Optional[str] = None
    idempotency_key: Optional[str] = None


