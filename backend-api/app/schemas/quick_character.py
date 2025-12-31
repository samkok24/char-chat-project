"""
온보딩 '30초만에 캐릭터 만나기'용 스키마

의도:
- 유저가 입력한 "캐릭터 이름/느낌(한 줄 설정)/태그/이미지"를 기반으로
  캐릭터 생성 폼(고급)의 주요 필드를 AI가 자동 완성할 수 있도록 초안(draft)을 생성한다.
- 생성(DB 저장)은 별도 `/characters/advanced` API에서 수행한다(SSOT).
"""

from pydantic import BaseModel, Field
from typing import List, Optional


class QuickCharacterGenerateRequest(BaseModel):
    """빠른 캐릭터 생성 초안 요청"""

    name: str = Field(..., min_length=1, max_length=100, description="캐릭터 이름")
    seed_text: str = Field(..., min_length=1, max_length=2000, description="원하는 캐릭터 느낌/설정(자유 텍스트)")
    image_url: Optional[str] = Field(None, max_length=500, description="업로드된 대표 이미지 URL(선택)")
    tags: List[str] = Field(default_factory=list, description="유저가 선택한 태그(이름/키워드)")
    ai_model: Optional[str] = Field("gemini", description="사용할 AI 모델 (gemini, claude, gpt)")



