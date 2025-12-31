"""
Story Dive API 라우터
"""

from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update
from typing import List, Optional
import uuid
from datetime import datetime
import json
import logging

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.user import User
from app.models.novel import Novel
from app.models.storydive_session import StoryDiveSession
from app.models.story import Story
from app.models.story_chapter import StoryChapter
from app.models.story_summary import StoryEpisodeSummary
from app.services import novel_service, storydive_ai_service
from app.services import ai_service
from app.core.database import redis_client

router = APIRouter()
logger = logging.getLogger(__name__)

# StoryDive: story 기반 합본 Novel 메타를 저장하는 키(기존 story_cards와 충돌 방지용 프리픽스)
STORYDIVE_META_KEY = "_storydive_meta"


# ============= Response Schemas =============

from pydantic import BaseModel


class NovelResponse(BaseModel):
    id: str
    title: str
    author: Optional[str]
    full_text: str
    story_cards: List[dict] | dict  # 배열 또는 단일 객체 모두 허용
    created_at: datetime
    
    class Config:
        from_attributes = True


class NovelListItem(BaseModel):
    id: str
    title: str
    author: Optional[str]
    created_at: datetime
    
    class Config:
        from_attributes = True


class SessionCreateRequest(BaseModel):
    novel_id: str
    entry_point: int


class SessionResponse(BaseModel):
    id: str
    novel_id: str
    entry_point: int
    turns: List[dict]
    created_at: datetime
    updated_at: datetime
    
    class Config:
        from_attributes = True


class TurnRequest(BaseModel):
    mode: str  # "do" | "say" | "story" | "see"
    input: str
    action: str = "turn"  # "turn" | "continue" | "retry"


class TurnResponse(BaseModel):
    ai_response: str
    turn_index: int


class RecentSessionItem(BaseModel):
    """홈 '최근 스토리다이브' 구좌용 아이템

    의도/동작:
    - 스토리다이브를 사용해본 유저에게는 '추천' 대신 '최근 콘텐츠'를 우선 노출해 재방문/리텐션을 올린다.
    - DB 마이그레이션 없이 storydive_sessions + (베스트 에포트) Redis meta를 이용해 story 기반 정보를 보강한다.
    """
    session_id: str
    novel_id: str
    title: str
    cover_url: Optional[str] = None
    excerpt: Optional[str] = None
    updated_at: datetime
    # story 기반 브릿지인 경우만 존재
    story_id: Optional[str] = None
    from_no: Optional[int] = None
    to_no: Optional[int] = None


class StoryNovelCreateRequest(BaseModel):
    """스토리(연재 회차) 기반으로 StoryDive용 Novel(전문 텍스트 스냅샷)을 준비하는 요청

    의도/동작:
    - 뷰어(Story/Chapters)에서 '스토리 다이브 시작'을 눌렀을 때, 최근 N화(기본 10화)를 합본 텍스트로 만든다.
    - 기존 StoryDive 세션/턴 API는 Novel(id/full_text)을 기준으로 동작하므로, 브릿지용 Novel을 생성(또는 재사용)한다.
    - DB 스키마 변경 없이(=배포 리스크 최소화) 기존 storydive 흐름을 그대로 재사용하기 위함.
    """
    story_id: str
    to_no: int
    max_episodes: int = 10


class StoryNovelCreateResponse(BaseModel):
    novel_id: str
    story_id: str
    from_no: int
    to_no: int
    max_episodes: int


# ============= API Endpoints =============

async def _get_storydive_novel_meta(novel_id: uuid.UUID) -> Optional[dict]:
    """Redis에 저장된 storydive novel 메타를 조회한다(베스트 에포트).

    메타는 story 기반 합본 Novel에서만 존재한다.
    - 키: storydive:novel_meta:{novel_id}
    - 값: {"story_id": "...", "from_no": int, "to_no": int, "max_episodes": int}
    """
    key = f"storydive:novel_meta:{str(novel_id)}"
    try:
        raw = await redis_client.get(key)
        if not raw:
            return None
        data = json.loads(raw)
        return data if isinstance(data, dict) else None
    except Exception:
        return None


def _extract_storydive_meta_from_story_cards(story_cards) -> Optional[dict]:
    """Novel.story_cards에 저장된 StoryDive 메타를 꺼낸다(베스트 에포트).

    의도/동작:
    - 운영에서 Redis가 재시작되면 storydive:novel_meta가 날아갈 수 있으므로,
      DB의 story_cards(JSON)에 메타를 같이 저장해 '최근 스토리다이브' 표지/제목 보강이 깨지지 않게 한다.
    - story_cards가 문자열(JSON)로 들어오는 경우도 방어적으로 처리한다.
    """
    if not story_cards:
        return None
    raw = story_cards
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except Exception:
            return None
    if not isinstance(raw, dict):
        return None
    meta = raw.get(STORYDIVE_META_KEY) or raw.get("storydive_meta") or raw.get("storydiveMeta")
    return meta if isinstance(meta, dict) else None


@router.get("/sessions/recent", response_model=List[RecentSessionItem])
async def get_recent_storydive_sessions(
    limit: int = Query(10, ge=1, le=30),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """최근 스토리다이브 세션 목록(유저별).

    안정성 포인트:
    - 세션/노벨/스토리 중 일부가 누락돼도 가능한 만큼만 반환(빈 배열도 허용)
    - Redis meta가 없어도 기본 타이틀/발췌로 최소 표시 가능
    """
    try:
        lim = int(limit or 10)
    except Exception:
        lim = 10
    lim = max(1, min(30, lim))

    # 최근 세션 조회
    srows = await db.execute(
        select(StoryDiveSession)
        .where(StoryDiveSession.user_id == current_user.id)
        .order_by(StoryDiveSession.updated_at.desc())
        .limit(lim)
    )
    sessions = srows.scalars().all() or []
    if not sessions:
        return []

    # 관련 Novel 로드(베스트 에포트: 타이틀/발췌용)
    novel_ids = [s.novel_id for s in sessions if getattr(s, "novel_id", None)]
    novel_map: dict[str, Novel] = {}
    if novel_ids:
        try:
            nrows = await db.execute(select(Novel).where(Novel.id.in_(novel_ids)))
            novels = nrows.scalars().all() or []
            novel_map = {str(n.id): n for n in novels if getattr(n, "id", None)}
        except Exception:
            novel_map = {}

    # Redis meta로 story_id 보강
    meta_map: dict[str, dict] = {}
    story_ids: list[uuid.UUID] = []
    for s in sessions:
        try:
            nid = getattr(s, "novel_id", None)
            if not nid:
                continue
            meta = await _get_storydive_novel_meta(nid)
            # Redis 메타가 없으면 DB(story_cards)에서 보강(운영 안정성)
            if not meta:
                try:
                    novel = novel_map.get(str(nid))
                    meta = _extract_storydive_meta_from_story_cards(getattr(novel, "story_cards", None)) if novel else None
                except Exception:
                    meta = None
            if meta:
                meta_map[str(nid)] = meta
                sid = meta.get("story_id")
                if sid:
                    try:
                        story_ids.append(uuid.UUID(str(sid)))
                    except Exception:
                        pass
        except Exception:
            continue

    # Story 로드(표지/소개글)
    story_map: dict[str, Story] = {}
    if story_ids:
        try:
            st_rows = await db.execute(select(Story).where(Story.id.in_(story_ids)))
            stories = st_rows.scalars().all() or []
            story_map = {str(st.id): st for st in stories if getattr(st, "id", None)}
        except Exception:
            story_map = {}

    out: list[RecentSessionItem] = []
    for s in sessions:
        try:
            nid_str = str(getattr(s, "novel_id"))
        except Exception:
            continue

        meta = meta_map.get(nid_str) or {}
        story_id_str = str(meta.get("story_id")) if meta.get("story_id") else None
        story = story_map.get(story_id_str) if story_id_str else None
        novel = novel_map.get(nid_str)

        title = ""
        cover_url = None
        excerpt = None
        if story:
            title = (getattr(story, "title", "") or "").strip()
            cover_url = getattr(story, "cover_url", None)
            try:
                text = (getattr(story, "content", "") or "").strip()
                excerpt = " ".join(text.split())[:140] if text else None
            except Exception:
                excerpt = None
        elif novel:
            title = (getattr(novel, "title", "") or "").strip()
            # novel 기반은 표지가 없을 수 있음 → 프론트가 placeholder 처리
            cover_url = None
            try:
                ft = (getattr(novel, "full_text", "") or "").strip()
                excerpt = " ".join(ft.split())[:140] if ft else None
            except Exception:
                excerpt = None
        else:
            title = "스토리 다이브"
            cover_url = None
            excerpt = None

        try:
            updated_at = getattr(s, "updated_at") or getattr(s, "created_at") or datetime.utcnow()
        except Exception:
            updated_at = datetime.utcnow()

        out.append(RecentSessionItem(
            session_id=str(s.id),
            novel_id=nid_str,
            title=title or "스토리 다이브",
            cover_url=cover_url,
            excerpt=excerpt,
            updated_at=updated_at,
            story_id=story_id_str,
            from_no=int(meta.get("from_no")) if meta.get("from_no") is not None else None,
            to_no=int(meta.get("to_no")) if meta.get("to_no") is not None else None,
        ))

    return out


def _fallback_episode_lines(text: str, *, lines_per_episode: int = 5, max_line_len: int = 80) -> list[str]:
    """LLM 요약 실패 시 사용할 방어적 5줄 요약 생성(휴리스틱).

    - 너무 길면 잘라서 5줄로 맞춘다.
    - 의미 품질은 LLM보다 떨어지지만, 최소한 '맥락 덩어리'를 항상 제공해 UX를 깨지지 않게 한다.
    """
    t = (text or "").strip()
    if not t:
        return ["- (요약 없음)"] + ["- ..."] * max(0, lines_per_episode - 1)
    # 문장 후보 분리(한국어/영어 혼용 대비, 과도한 정규식 대신 단순 분리)
    chunks: list[str] = []
    for sep in ["\n", ".", "!", "?", "。", "！", "？"]:
        if sep in t:
            parts = [p.strip() for p in t.split(sep) if p.strip()]
            if len(parts) >= 2:
                chunks = parts
                break
    if not chunks:
        chunks = [t]
    lines: list[str] = []
    for c in chunks:
        if len(lines) >= lines_per_episode:
            break
        s = c.replace("\t", " ").strip()
        if not s:
            continue
        if len(s) > max_line_len:
            s = s[:max_line_len].rstrip()
        lines.append(f"- {s}")
    while len(lines) < lines_per_episode:
        lines.append("- ...")
    return lines[:lines_per_episode]


async def _get_story_recap_text(
    db: AsyncSession,
    *,
    story_id: uuid.UUID,
    end_no: int,
    recap_episodes: int = 10,
    lines_per_episode: int = 5,
) -> str:
    """이전 맥락(미래 회차 제외)을 회차당 5줄 요약으로 만든 텍스트를 반환한다.

    의도/동작:
    - 합본 창(from_no..to_no) 이전 회차(=end_no) 구간을 '회차당 5줄' 요약으로 제공해 LLM이 장기 맥락을 잡도록 한다.
    - 요약은 Redis에 캐시하여 1회만 생성되게 한다(데모 안정성/지연 최소화).
    - LLM 실패/Redis 장애 시에도 항상 fallback 텍스트를 반환한다.
    """
    end_no = int(end_no or 0)
    if end_no < 1:
        return ""
    recap_episodes = int(recap_episodes or 10)
    lines_per_episode = int(lines_per_episode or 5)
    if recap_episodes < 1 or lines_per_episode < 1:
        return ""

    start_no = max(1, end_no - recap_episodes + 1)
    cache_key = f"storydive:recap:{story_id}:{start_no}:{end_no}:v1:l{lines_per_episode}"

    try:
        cached = await redis_client.get(cache_key)
        if cached:
            return cached
    except Exception:
        cached = None

    # 회차별 소스(요약/발췌 우선, 없으면 본문 앞부분)
    rows = await db.execute(
        select(StoryChapter.no, StoryEpisodeSummary.short_brief, StoryEpisodeSummary.anchor_excerpt, StoryChapter.content)
        .outerjoin(
            StoryEpisodeSummary,
            (StoryEpisodeSummary.story_id == StoryChapter.story_id) & (StoryEpisodeSummary.no == StoryChapter.no),
        )
        .where(
            StoryChapter.story_id == story_id,
            StoryChapter.no >= start_no,
            StoryChapter.no <= end_no,
        )
        .order_by(StoryChapter.no.asc())
    )
    items = rows.all()
    if not items:
        return ""

    # LLM 입력은 과도하게 길어지지 않도록 회차당 제한
    src_lines: list[str] = []
    for no, short_brief, anchor_excerpt, content in items:
        base = (short_brief or "").strip() or (anchor_excerpt or "").strip() or (content or "").strip()
        if not base:
            continue
        base = base.replace("\r\n", "\n").strip()
        base = base[:900]
        src_lines.append(f"[{int(no)}화]\n{base}\n")

    if not src_lines:
        return ""

    system = (
        "당신은 한국어 소설 편집자입니다.\n"
        "아래는 각 회차의 요약/발췌입니다. 각 회차를 '정확히 5줄'로 요약하세요.\n"
        "출력 형식 규칙:\n"
        "1) 회차마다 첫 줄은 반드시 [N화] 형태로 출력\n"
        "2) 그 다음 줄부터는 반드시 '- '로 시작하는 요약 5줄만 출력\n"
        "3) 회차당 총 6줄([N화] + 5줄)만 출력\n"
        "4) 미래 회차/이후 사건/스포일러 언급 금지(제공된 회차 범위 내에서만)\n"
        "5) 고유명/관계/갈등의 핵심은 유지, 평가/해설 금지, 간결하게\n"
    )
    user = "\n".join(src_lines)

    recap_text = ""
    try:
        raw = await ai_service.get_ai_chat_response(
            character_prompt=system,
            user_message=user,
            history=[],
            preferred_model="claude",
            preferred_sub_model="claude-sonnet-4-20250514",
            response_length_pref="short",
        )
        recap_text = (raw or "").strip()
        # 하드 방어: 너무 길면 잘라서 프롬프트 폭주 방지
        if recap_text and len(recap_text) > 6000:
            recap_text = recap_text[:6000].rstrip()
    except Exception as e:
        logger.warning("storydive recap llm failed: %s", e)
        recap_text = ""

    if not recap_text:
        # fallback: 회차당 5줄을 휴리스틱으로 생성
        out: list[str] = []
        for no, short_brief, anchor_excerpt, content in items:
            base = (short_brief or "").strip() or (anchor_excerpt or "").strip() or (content or "").strip()
            if not base:
                continue
            out.append(f"[{int(no)}화]")
            out.extend(_fallback_episode_lines(base, lines_per_episode=lines_per_episode))
            out.append("")  # 회차 간 공백
        recap_text = "\n".join(out).strip()

    try:
        # 30일 캐시(베스트 에포트)
        await redis_client.setex(cache_key, 60 * 60 * 24 * 30, recap_text)
    except Exception:
        pass

    return recap_text


@router.post("/novels/from-story", response_model=StoryNovelCreateResponse)
async def create_storydive_novel_from_story(
    request: StoryNovelCreateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """스토리/회차 기반 StoryDive용 Novel 준비(브릿지).

    - 스토리 공개/권한 체크 후, 지정 회차(to_no) 기준 최근 max_episodes 회차를 합본.
    - 구분선(간단한 텍스트)만 삽입하고 회차 넘버링은 추가하지 않는다.
    - 같은 (story_id, from_no, to_no, max_episodes) 조합은 항상 동일한 novel_id(uuid5)를 사용해 중복 생성을 방지한다.
    """
    try:
        story_uuid = uuid.UUID(str(request.story_id))
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid story ID")

    to_no = int(request.to_no or 0)
    max_episodes = int(request.max_episodes or 10)

    if to_no < 1:
        raise HTTPException(status_code=400, detail="to_no must be >= 1")
    if max_episodes < 1:
        raise HTTPException(status_code=400, detail="max_episodes must be >= 1")
    # 과도한 요청 방어 (데모 안정성)
    if max_episodes > 50:
        raise HTTPException(status_code=400, detail="max_episodes is too large")

    story = await db.get(Story, story_uuid)
    if not story:
        raise HTTPException(status_code=404, detail="Story not found")

    # 비공개 스토리 접근 제한(작성자/관리자만)
    if not getattr(story, "is_public", True) and getattr(story, "creator_id", None) != current_user.id and not getattr(current_user, "is_admin", False):
        raise HTTPException(status_code=403, detail="Not authorized")

    # 웹툰 작품은 다이브 비활성 (요구사항)
    if bool(getattr(story, "is_webtoon", False)):
        raise HTTPException(status_code=422, detail="웹툰 작품은 스토리 다이브를 지원하지 않습니다")

    # to_no 회차 존재 확인
    exists_row = await db.execute(
        select(StoryChapter.id, StoryChapter.image_url).where(
            StoryChapter.story_id == story_uuid,
            StoryChapter.no == to_no,
        )
    )
    exists = exists_row.first()
    if not exists:
        raise HTTPException(status_code=404, detail="Chapter not found")
    # 이미지 회차(웹툰)는 다이브 비활성 (프론트는 image_url로도 웹툰 여부를 판단함)
    if exists[1]:
        raise HTTPException(status_code=422, detail="웹툰 작품은 스토리 다이브를 지원하지 않습니다")

    from_no = max(1, to_no - max_episodes + 1)

    rows = await db.execute(
        select(StoryChapter.no, StoryChapter.content)
        .where(
            StoryChapter.story_id == story_uuid,
            StoryChapter.no >= from_no,
            StoryChapter.no <= to_no,
        )
        .order_by(StoryChapter.no.asc())
    )
    chapters = rows.all()
    if not chapters:
        raise HTTPException(status_code=404, detail="No chapters found")

    # 합본 텍스트 생성(회차 넘버링은 추가하지 않고, 경계는 구분선만 삽입)
    delimiter = "\n\n—\n\n"
    parts: list[str] = []
    for _no, content in chapters:
        text = (content or "").strip()
        if not text:
            continue
        parts.append(text)

    if not parts:
        raise HTTPException(status_code=404, detail="No readable chapter content")

    full_text = delimiter.join(parts)

    # 동일 조합은 항상 같은 UUID 사용(중복 생성 방지)
    novel_uuid = uuid.uuid5(uuid.NAMESPACE_DNS, f"storydive:story:{story_uuid}:{from_no}:{to_no}:{max_episodes}")

    # story 기반 합본 novel 메타(운영 안정성: Redis + DB 모두 저장)
    meta = {
        "story_id": str(story_uuid),
        "from_no": int(from_no),
        "to_no": int(to_no),
        "max_episodes": int(max_episodes),
    }

    novel = await db.get(Novel, novel_uuid)
    if novel:
        novel.title = getattr(story, "title", "Story")
        novel.author = None
        novel.full_text = full_text
        # DB에 메타도 함께 저장(=Redis 유실 대비)
        novel.story_cards = {STORYDIVE_META_KEY: meta}
        novel.is_active = True
    else:
        novel = Novel(
            id=novel_uuid,
            title=getattr(story, "title", "Story"),
            author=None,
            full_text=full_text,
            # DB에 메타도 함께 저장(=Redis 유실 대비)
            story_cards={STORYDIVE_META_KEY: meta},
            is_active=True,
        )
        db.add(novel)

    try:
        await db.commit()
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to prepare storydive novel: {str(e)}")

    # story 기반 합본 novel 메타를 Redis에 저장(턴 생성 시 요약/컨텍스트 구성에 사용)
    try:
        meta_key = f"storydive:novel_meta:{str(novel_uuid)}"
        await redis_client.setex(meta_key, 60 * 60 * 24 * 30, json.dumps(meta, ensure_ascii=False))
    except Exception:
        pass

    return StoryNovelCreateResponse(
        novel_id=str(novel_uuid),
        story_id=str(story_uuid),
        from_no=int(from_no),
        to_no=int(to_no),
        max_episodes=int(max_episodes),
    )


@router.get("/novels", response_model=List[NovelListItem])
async def get_novels_list(
    skip: int = 0,
    limit: int = 20,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """소설 목록 조회"""
    novels = await novel_service.get_novels(db, skip=skip, limit=limit)
    return [
        NovelListItem(
            id=str(n.id),
            title=n.title,
            author=n.author,
            created_at=n.created_at
        )
        for n in novels
    ]


@router.get("/novels/{novel_id}", response_model=NovelResponse)
async def get_novel_detail(
    novel_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """소설 상세 조회 (전문 + Story Cards)"""
    try:
        novel_uuid = uuid.UUID(novel_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid novel ID")
    
    novel = await novel_service.get_novel_by_id(db, novel_uuid)
    if not novel:
        raise HTTPException(status_code=404, detail="Novel not found")
    
    # story_cards가 문자열로 저장된 경우 JSON 파싱
    import json
    story_cards = novel.story_cards
    if isinstance(story_cards, str):
        try:
            story_cards = json.loads(story_cards)
        except json.JSONDecodeError:
            story_cards = {}
    
    return NovelResponse(
        id=str(novel.id),
        title=novel.title,
        author=novel.author,
        full_text=novel.full_text,
        story_cards=story_cards or {},
        created_at=novel.created_at
    )


@router.post("/sessions", response_model=SessionResponse)
async def create_session(
    request: SessionCreateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """세션 생성 (다이브 시작)"""
    try:
        novel_uuid = uuid.UUID(request.novel_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid novel ID")
    
    # Novel 존재 확인
    novel = await novel_service.get_novel_by_id(db, novel_uuid)
    if not novel:
        raise HTTPException(status_code=404, detail="Novel not found")
    
    # 세션 생성
    session = StoryDiveSession(
        user_id=current_user.id,
        novel_id=novel_uuid,
        entry_point=request.entry_point,
        turns=[]
    )
    
    db.add(session)
    await db.commit()
    await db.refresh(session)
    
    return SessionResponse(
        id=str(session.id),
        novel_id=str(session.novel_id),
        entry_point=session.entry_point,
        turns=session.turns or [],
        created_at=session.created_at,
        updated_at=session.updated_at
    )


@router.get("/sessions/{session_id}", response_model=SessionResponse)
async def get_session(
    session_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """세션 조회"""
    try:
        session_uuid = uuid.UUID(session_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid session ID")
    
    result = await db.execute(
        select(StoryDiveSession).where(StoryDiveSession.id == session_uuid)
    )
    session = result.scalar_one_or_none()
    
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    
    if session.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    return SessionResponse(
        id=str(session.id),
        novel_id=str(session.novel_id),
        entry_point=session.entry_point,
        turns=session.turns or [],
        created_at=session.created_at,
        updated_at=session.updated_at
    )


@router.post("/sessions/{session_id}/turn", response_model=TurnResponse)
async def process_turn(
    session_id: str,
    request: TurnRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """턴 진행 (Do/Say/Story/See + Continue/Retry)"""
    try:
        session_uuid = uuid.UUID(session_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid session ID")
    
    # 세션 조회
    result = await db.execute(
        select(StoryDiveSession).where(StoryDiveSession.id == session_uuid)
    )
    session = result.scalar_one_or_none()
    
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    
    if session.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    # Novel 조회
    novel = await novel_service.get_novel_by_id(db, session.novel_id)
    if not novel:
        raise HTTPException(status_code=404, detail="Novel not found")
    
    # 컨텍스트 텍스트 구성
    #
    # 결정된 정책(미래 회차 제외):
    # - 50줄 요약(이전 맥락): 합본 창(from_no..to_no) 이전 회차만 포함
    # - 원문(prefix): 다이브 지점(entry_point) '직전까지'의 원문 텍스트
    # - 축차적 전개: turns/history로 이미 전달됨
    prefix_text = novel_service.get_prefix_text(novel.full_text, session.entry_point, max_chars=20000)
    recap_text = ""
    try:
        meta = await _get_storydive_novel_meta(session.novel_id)
        if meta and meta.get("story_id") and meta.get("from_no"):
            try:
                sid = uuid.UUID(str(meta.get("story_id")))
                from_no = int(meta.get("from_no") or 0)
                recap_end = from_no - 1
                # 합본 이전 회차만 요약(미래 회차 제외)
                recap_text = await _get_story_recap_text(
                    db,
                    story_id=sid,
                    end_no=recap_end,
                    recap_episodes=10,
                    lines_per_episode=5,
                )
            except Exception:
                recap_text = ""
    except Exception:
        recap_text = ""

    # 최종 컨텍스트 문자열
    parts: list[str] = []
    if recap_text:
        parts.append("[이전 맥락 요약 (회차당 5줄, 미래 회차 제외)]\n" + recap_text.strip())
    if prefix_text:
        parts.append("[원문(다이브 직전까지)]\n" + prefix_text.strip())
    context_text = "\n\n".join([p for p in parts if p]).strip()
    
    # 턴 히스토리 구성 (deleted가 아닌 것만)
    turns = session.turns or []
    active_turns = [t for t in turns if not t.get("deleted", False)]
    
    # AI 히스토리 포맷
    history = []
    for turn in active_turns:
        if turn.get("user"):
            history.append({"role": "user", "content": turn["user"]})
        if turn.get("ai"):
            history.append({"role": "assistant", "content": turn["ai"]})
    
    # Action 처리
    if request.action == "retry":
        # 마지막 AI 응답을 deleted로 마킹하고, 하이라이트된 부분(마지막 5문장)을 기준으로 다시 생성
        if not active_turns:
            raise HTTPException(status_code=400, detail="No turn to retry")
        
        last_turn_idx = None
        last_mode = None
        last_ai_text = None
        
        for i in range(len(turns) - 1, -1, -1):
            if not turns[i].get("deleted", False):
                last_turn_idx = i
                last_mode = turns[i].get("mode", "do")
                last_ai_text = turns[i].get("ai", "")
                break
        
        if last_turn_idx is not None:
            turns[last_turn_idx]["deleted"] = True
            # 히스토리에서도 마지막 턴 완전히 제거
            if history and history[-1]["role"] == "assistant":
                history.pop()
            if history and history[-1]["role"] == "user":
                history.pop()
        
        # 마지막 AI 응답에서 마지막 5문장 추출
        if last_ai_text:
            sentences = last_ai_text.split('.')
            sentences = [s.strip() + '.' for s in sentences if s.strip()]
            last_five = sentences[-5:] if len(sentences) >= 5 else sentences
            highlighted_context = ' '.join(last_five)
        else:
            # AI 텍스트가 없으면 원문(prefix) 마지막 부분을 사용(요약/헤더로 인해 앞부분이 의미 없을 수 있음)
            highlighted_context = (prefix_text or context_text)[-600:]
        
        # Retry 응답 생성
        ai_response = await storydive_ai_service.get_retry_response(
            highlighted_context=highlighted_context,
            story_cards=novel.story_cards or {},
            context_text=context_text,
            history=history,
            mode=last_mode or "do",
            preferred_model='claude',
            preferred_sub_model='claude-sonnet-4-20250514',
            response_length_pref=getattr(current_user, 'response_length_pref', 'medium')
        )
        
        # 새 턴 추가
        new_turn = {
            "mode": last_mode or "do",
            "user": "",
            "ai": ai_response,
            "deleted": False,
            "created_at": datetime.utcnow().isoformat()
        }
        turns.append(new_turn)
        
        # DB 업데이트
        await db.execute(
            update(StoryDiveSession)
            .where(StoryDiveSession.id == session_uuid)
            .values(turns=turns, updated_at=datetime.utcnow())
        )
        await db.commit()
        
        return TurnResponse(
            ai_response=ai_response,
            turn_index=len(turns) - 1
        )
    
    elif request.action == "continue":
        # Continue 모드: 하이라이트된 마지막 5문장을 이어쓰기
        highlighted_context = ""
        
        if active_turns:
            # 마지막 AI 응답에서 마지막 5문장 추출
            last_ai_text = ""
            for turn in reversed(active_turns):
                if turn.get("ai"):
                    last_ai_text = turn["ai"]
                    break
            
            if last_ai_text:
                sentences = last_ai_text.split('.')
                sentences = [s.strip() + '.' for s in sentences if s.strip()]
                last_five = sentences[-5:] if len(sentences) >= 5 else sentences
                highlighted_context = ' '.join(last_five)
            else:
                # AI 텍스트가 없으면 원작에서 추출
                paragraphs = novel.full_text.split('\n')
                paragraphs = [p.strip() for p in paragraphs if p.strip()]
                start_idx = max(0, session.entry_point - 5)
                end_idx = session.entry_point + 1
                highlighted_context = ' '.join(paragraphs[start_idx:end_idx])
        else:
            # 턴이 없으면 원작 컨텍스트에서 마지막 5문장 (다이브 지점 기준)
            paragraphs = novel.full_text.split('\n')
            paragraphs = [p.strip() for p in paragraphs if p.strip()]
            start_idx = max(0, session.entry_point - 5)
            end_idx = session.entry_point + 1
            highlighted_context = ' '.join(paragraphs[start_idx:end_idx])
        
        ai_response = await storydive_ai_service.get_continue_response(
            last_ai_response=highlighted_context,
            story_cards=novel.story_cards or {},
            context_text=context_text,
            history=history,
            preferred_model='claude',
            preferred_sub_model='claude-sonnet-4-20250514',
            response_length_pref=getattr(current_user, 'response_length_pref', 'medium')
        )
        
        # 새 턴 추가
        new_turn = {
            "mode": "continue",
            "user": "",
            "ai": ai_response,
            "deleted": False,
            "created_at": datetime.utcnow().isoformat()
        }
        turns.append(new_turn)
        
        # DB 업데이트
        await db.execute(
            update(StoryDiveSession)
            .where(StoryDiveSession.id == session_uuid)
            .values(turns=turns, updated_at=datetime.utcnow())
        )
        await db.commit()
        
        return TurnResponse(
            ai_response=ai_response,
            turn_index=len(turns) - 1
        )
    
    # 일반 턴 (turn) 처리 - input 필요
    if request.action == "turn" and not request.input:
        raise HTTPException(status_code=400, detail="Input is required for turn action")
    
    # AI 응답 생성
    ai_response = await storydive_ai_service.get_storydive_response(
        novel_title=novel.title,
        story_cards=novel.story_cards or {},
        context_text=context_text,
        user_input=request.input,
        mode=request.mode,
        history=history,
        preferred_model='claude',
        preferred_sub_model='claude-sonnet-4-20250514',
        response_length_pref=getattr(current_user, 'response_length_pref', 'medium')
    )
    
    # 새 턴 추가
    new_turn = {
        "mode": request.mode,
        "user": request.input,
        "ai": ai_response,
        "deleted": False,
        "created_at": datetime.utcnow().isoformat()
    }
    turns.append(new_turn)
    
    # DB 업데이트
    await db.execute(
        update(StoryDiveSession)
        .where(StoryDiveSession.id == session_uuid)
        .values(turns=turns, updated_at=datetime.utcnow())
    )
    await db.commit()
    
    return TurnResponse(
        ai_response=ai_response,
        turn_index=len(turns) - 1
    )


@router.delete("/sessions/{session_id}/erase")
async def erase_last_turn(
    session_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """마지막 AI 응답 삭제 (Erase)"""
    try:
        session_uuid = uuid.UUID(session_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid session ID")
    
    # 세션 조회
    result = await db.execute(
        select(StoryDiveSession).where(StoryDiveSession.id == session_uuid)
    )
    session = result.scalar_one_or_none()
    
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    
    if session.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    turns = session.turns or []
    
    # 마지막 active 턴 찾기
    last_turn_idx = None
    for i in range(len(turns) - 1, -1, -1):
        if not turns[i].get("deleted", False):
            last_turn_idx = i
            break
    
    if last_turn_idx is None:
        raise HTTPException(status_code=400, detail="No turn to erase")
    
    # deleted 플래그 추가
    turns[last_turn_idx]["deleted"] = True
    
    # DB 업데이트
    await db.execute(
        update(StoryDiveSession)
        .where(StoryDiveSession.id == session_uuid)
        .values(turns=turns, updated_at=datetime.utcnow())
    )
    await db.commit()
    
    return {"message": "Turn erased successfully", "turn_index": last_turn_idx}

