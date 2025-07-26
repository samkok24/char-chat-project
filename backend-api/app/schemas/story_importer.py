"""
스토리 임포터 기능에서 사용할 Pydantic 스키마
"""
from pydantic import BaseModel, Field
from typing import List, Optional

class StoryImportRequest(BaseModel):
    """스토리 분석 요청 시 Body에 담길 데이터"""
    title: Optional[str] = None
    content: str = Field(..., min_length=100, description="분석할 스토리 본문")
    ai_model: Optional[str] = Field("gemini", description="사용할 AI 모델 (gemini, claude 등)")

class AnalyzedCharacter(BaseModel):
    """AI가 분석한 캐릭터 정보"""
    name: str = Field(..., description="캐릭터 이름")
    description: str = Field(..., description="캐릭터 요약 정보")
    social_tendency: int = Field(..., ge=0, le=100, description="대인관계 성향 (0~100)")

class StoryAnalysisResponse(BaseModel):
    """스토리 분석 API의 응답 데이터"""
    worldview: str = Field(..., description="추출된 세계관 설정")
    characters: List[AnalyzedCharacter] = Field(..., description="추출된 주요 캐릭터 목록")
    plot: str = Field(..., description="추출된 핵심 플롯 요약") 