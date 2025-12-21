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
    # NOTE:
    # - 프론트는 full_text를 '\n' 기준으로 쪼갠 뒤, 빈 줄을 제거(filter)하고 0..N-1로 재인덱싱한다.
    # - 기존 구현처럼 "원본 라인 번호"를 index로 쓰면, 빈 줄이 섞여 있을 때 entry_point(프론트 기준)와 어긋나
    #   잘못된 컨텍스트가 선택될 수 있다.
    # - 따라서 백엔드도 "빈 줄 제거 후 연속 인덱스"를 SSOT로 사용한다.
    for line in lines:
        stripped = line.strip()
        if stripped:  # 빈 줄 제외
            paragraphs.append({
                "index": len(paragraphs),
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


def get_prefix_text(
    full_text: str,
    entry_point: int,
    *,
    max_chars: int = 20000,
    boundary_marker: str = "—",
) -> str:
    """
    다이브 지점 '직전까지(prefix)'의 원문 텍스트를 컨텍스트로 추출한다.

    의도/동작:
    - 유저가 특정 지점에서 다이브를 시작하면, LLM이 다음 문장을 자연스럽게 이어쓰려면
      '그 지점까지의 상태/대화/장면'이 필요하다.
    - 따라서 entry_point(프론트 기준 문단 인덱스)까지의 문단을 포함하여 prefix를 구성한다.
    - 너무 길면 max_chars로 하드 컷(기본: 마지막 max_chars만 유지)하여 토큰 폭주를 방지한다.
    """
    if not full_text:
        return ""
    try:
        ep = int(entry_point or 0)
    except Exception:
        ep = 0
    paragraphs = parse_novel_paragraphs(full_text)
    if not paragraphs:
        return ""
    # entry_point 범위 보정
    last_idx = int(paragraphs[-1]["index"])
    if ep < 0:
        ep = 0
    if ep > last_idx:
        ep = last_idx

    # prefix(0..ep) 문단 리스트 구성
    prefix_paras: list[str] = []
    for p in paragraphs:
        if int(p.get("index", 0)) <= ep:
            t = (p.get("text") or "").strip()
            if t:
                prefix_paras.append(t)

    if not prefix_paras:
        return ""

    # 길이 방어 값 정규화
    try:
        mc = int(max_chars or 0)
    except Exception:
        mc = 0
    if mc <= 0:
        # 제한이 없거나 잘못 들어오면(방어) 전체 prefix 반환
        return "\n\n".join(prefix_paras).strip()

    # 1) 회차 경계 보존 절단
    #
    # 합본 텍스트는 회차 사이에 boundary_marker(기본: "—")가 단독 라인으로 들어간다.
    # prefix가 너무 길어질 때:
    # - 가능한 한 "회차 단위"로 앞쪽 회차를 통째로 드롭한다(경계 보존).
    # - 마지막(다이브 중인) 회차는 문단 단위로만 절단한다(최후의 수단).
    episodes: list[list[str]] = [[]]
    for t in prefix_paras:
        if t == boundary_marker:
            # 연속 구분선/빈 에피소드 방어
            if episodes and not episodes[-1]:
                continue
            episodes.append([])
            continue
        episodes[-1].append(t)
    # 뒤쪽 빈 에피소드 제거
    episodes = [epx for epx in episodes if epx]
    if not episodes:
        return ""

    def _join_eps(eps: list[list[str]]) -> str:
        chunks: list[str] = []
        for i, epx in enumerate(eps):
            if i > 0:
                chunks.append(boundary_marker)
            chunks.extend(epx)
        return "\n\n".join([c for c in chunks if c]).strip()

    out = _join_eps(episodes)
    if len(out) <= mc:
        return out

    # 앞쪽 회차부터 통째로 드롭(경계 보존)
    while len(out) > mc and len(episodes) > 1:
        episodes.pop(0)
        out = _join_eps(episodes)
        if not out:
            break
    if not out:
        return ""
    if len(out) <= mc:
        return out

    # 2) 마지막 회차(현재 에피소드)만 남았는데도 길면, 문단 단위로 tail을 유지
    only = episodes[-1] if episodes else []
    if not only:
        return out[-mc:].lstrip()

    selected_rev: list[str] = []
    total_len = 0
    sep_len = 2  # "\n\n"
    for t in reversed(only):
        t = (t or "").strip()
        if not t:
            continue
        add = len(t) + (sep_len if selected_rev else 0)
        if total_len + add > mc:
            if not selected_rev:
                # 단일 문단이 너무 길면 문단 내부에서 tail 절단(최후의 수단)
                return t[-mc:].lstrip()
            break
        selected_rev.append(t)
        total_len += add

    selected = list(reversed(selected_rev))
    out2 = "\n\n".join(selected).strip()
    if len(out2) > mc:
        out2 = out2[-mc:].lstrip()
    return out2

