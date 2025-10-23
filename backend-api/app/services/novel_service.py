"""
Novel 관련 서비스
"""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.novel import Novel
from typing import List, Optional
import uuid
import re


async def get_novel_by_id(db: AsyncSession, novel_id: uuid.UUID) -> Optional[Novel]:
    """Novel ID로 조회"""
    result = await db.execute(
        select(Novel).where(Novel.id == novel_id, Novel.is_active == True)
    )
    return result.scalar_one_or_none()


async def get_novels(
    db: AsyncSession,
    skip: int = 0,
    limit: int = 20
) -> List[Novel]:
    """Novel 목록 조회 (페이지네이션)"""
    result = await db.execute(
        select(Novel)
        .where(Novel.is_active == True)
        .order_by(Novel.created_at.desc())
        .offset(skip)
        .limit(limit)
    )
    return result.scalars().all()


def parse_novel_paragraphs(full_text: str) -> List[dict]:
    """
    원문을 문단 단위로 파싱
    
    Returns:
        [{"index": 0, "text": "문단 내용"}, ...]
    """
    if not full_text:
        return []
    
    # 줄바꿈 기준으로 문단 분리
    lines = full_text.split('\n')
    
    paragraphs = []
    for idx, line in enumerate(lines):
        stripped = line.strip()
        if stripped:  # 빈 줄 제외
            paragraphs.append({
                "index": idx,
                "text": stripped
            })
    
    return paragraphs


def get_context_text(full_text: str, entry_point: int, context_range: int = 5) -> str:
    """
    다이브 지점 이후의 원작 텍스트를 컨텍스트로 추출
    
    Args:
        full_text: 전체 원문
        entry_point: 다이브 시작 문단 인덱스
        context_range: 추출할 문단 개수 (기본 5개)
    
    Returns:
        다이브 지점 이후 원문 일부
    """
    paragraphs = parse_novel_paragraphs(full_text)
    
    # entry_point 이후의 문단들 추출
    context_paragraphs = []
    for p in paragraphs:
        if p["index"] >= entry_point:
            context_paragraphs.append(p["text"])
            if len(context_paragraphs) >= context_range:
                break
    
    return "\n\n".join(context_paragraphs)

