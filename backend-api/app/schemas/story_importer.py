"""
스토리 임포터 기능에서 사용할 Pydantic 스키마
"""
from pydantic import BaseModel, Field
from typing import List, Optional

class StoryImportRequest(BaseModel):
    """스토리 분석 요청 시 Body에 담길 데이터"""
    title: Optional[str] = None
    content: str = Field(..., min_length=100, max_length=500000, description="분석할 스토리 본문")
    ai_model: Optional[str] = Field("gemini", description="사용할 AI 모델 (gemini, claude 등)")

class AnalyzedExampleDialogue(BaseModel):
    """AI가 생성한 예시 대화(간단)"""
    user_message: str = Field(..., description="사용자 메시지(짧게)")
    character_response: str = Field(..., description="캐릭터 응답(짧게)")

class AnalyzedIntroductionScene(BaseModel):
    """AI가 생성한 도입부(간단)"""
    title: Optional[str] = Field(None, description="도입부 제목(선택)")
    content: str = Field(..., description="도입부 본문(짧게)")
    secret: Optional[str] = Field(None, description="비밀 정보(선택)")

class AnalyzedCharacter(BaseModel):
    """AI가 분석한 캐릭터 정보"""
    name: str = Field(..., description="캐릭터 이름")
    description: str = Field(..., description="캐릭터 요약 정보")
    social_tendency: int = Field(..., ge=0, le=100, description="대인관계 성향 (0~100)")
    # ✅ 확장: 캐릭터 생성 폼(고급) 필드 채우기용(모두 Optional → 하위호환)
    personality: Optional[str] = Field(None, description="성격/특징(2~6문장)")
    speech_style: Optional[str] = Field(None, description="말투/화법(2~4문장)")
    greetings: Optional[List[str]] = Field(None, description="인사말 후보(2~3개)")
    user_display_description: Optional[str] = Field(None, description="사용자에게 보이는 설명(선택)")
    introduction_scenes: Optional[List[AnalyzedIntroductionScene]] = Field(None, description="도입부 시나리오(선택)")
    example_dialogues: Optional[List[AnalyzedExampleDialogue]] = Field(None, description="예시 대화(선택)")
    tags: Optional[List[str]] = Field(None, description="태그 후보(선택)")

class StoryAnalysisResponse(BaseModel):
    """스토리 분석 API의 응답 데이터"""
    worldview: str = Field(..., description="추출된 세계관 설정")
    characters: List[AnalyzedCharacter] = Field(..., description="추출된 주요 캐릭터 목록")
    plot: str = Field(..., description="추출된 핵심 플롯 요약") 