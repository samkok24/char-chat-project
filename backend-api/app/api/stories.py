"""
스토리 관련 API 라우터
"""

from fastapi import APIRouter, Depends, HTTPException, Query, BackgroundTasks, status, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List, Optional
import uuid
import json
import asyncio

from app.core.database import get_db
from app.core.security import get_current_user, get_current_user_optional
from app.models.user import User
from app.models.story import Story
from app.models.story_extracted_character import StoryExtractedCharacter
from app.schemas.story import (
    StoryCreate, StoryUpdate, StoryResponse, StoryListResponse, StoryListItem,
    StoryGenerationRequest, StoryGenerationResponse, StoryWithDetails, StoryStreamRequest
)
from app.schemas.comment import (
    CommentCreate, CommentUpdate, StoryCommentResponse, StoryCommentWithUser
)
from app.services import story_service
from app.services.story_service import story_generation_service
from app.services.comment_service import (
    create_story_comment, get_story_comments, get_story_comment_by_id,
    update_story_comment, delete_story_comment
)
from app.services.job_service import JobService, get_job_service
from app.services.origchat_service import (
    ensure_extracted_characters_for_story,
    extract_characters_from_story,
    build_context_pack,
)
from app.schemas.origchat import StartOptionsV2, ContextStatus, ChapterScenes
from app.core.config import settings
from sqlalchemy import select, delete, func, update
from app.services.origchat_service import _enrich_character_fields
from app.models.story_chapter import StoryChapter
from app.models.character import Character
from sqlalchemy import select, delete
from app.core.database import redis_client
from pydantic import BaseModel, Field
from app.models.chat import ChatRoom, ChatMessage
from app.models.chat_read_status import ChatRoomReadStatus
from app.models.like import CharacterLike
from app.models.comment import CharacterComment
from app.models.bookmark import CharacterBookmark
from app.models.tag import CharacterTag
from app.models.memory_note import MemoryNote
from app.models.character import CharacterSetting, CharacterExampleDialogue

router = APIRouter()

async def _cleanup_origchat_entities_for_story(db: AsyncSession, story_id: uuid.UUID) -> dict:
    """
    원작챗(스토리 파생) 등장인물 정리 유틸.

    요구사항/의도:
    - "전체삭제/중지" 시 잔여물이 남지 않아야 한다.
      - StoryExtractedCharacter(그리드 레코드)만 지우면, 실제 원작챗 캐릭터(Character)가 남아
        홈/탐색의 원작챗 캐릭터 격자에 계속 노출되는 문제가 발생할 수 있다.
      - 또한 Character를 하드 delete 하면, ChatRoom/ChatMessage 등 FK가 남아 서비스가 깨질 수 있어
        연관 데이터를 안전한 순서로 함께 삭제한다(방어적).

    동작:
    - story_id로 파생된 캐릭터(Character.origin_story_id == story_id)를 찾는다.
    - 해당 캐릭터들이 가진 채팅방/메시지/읽음상태/좋아요/댓글/북마크/태그연결/설정/예시대화/메모를 삭제한다.
    - StoryExtractedCharacter를 삭제한다.
    - Story.is_origchat 플래그를 False로 되돌린다(추출 완료 상태 해제).
    - Redis 진행 상태(extract:status:{story_id})를 삭제한다.

    반환:
    - 삭제 개수 요약(dict)
    """
    summary = {
        "story_id": str(story_id),
        "deleted_extracted_rows": 0,
        "deleted_characters": 0,
        "deleted_rooms": 0,
        "deleted_messages": 0,
    }
    # 1) 파생 캐릭터 IDs 수집
    char_ids: list[uuid.UUID] = []
    try:
        rows = await db.execute(select(Character.id).where(Character.origin_story_id == story_id))
        char_ids = [r[0] for r in (rows.all() or []) if r and r[0]]
    except Exception:
        char_ids = []

    # 2) 해당 캐릭터의 채팅방 IDs 수집
    room_ids: list[uuid.UUID] = []
    if char_ids:
        try:
            rows = await db.execute(select(ChatRoom.id).where(ChatRoom.character_id.in_(char_ids)))
            room_ids = [r[0] for r in (rows.all() or []) if r and r[0]]
        except Exception:
            room_ids = []

    # 3) 삭제 (FK 안전 순서)
    try:
        # (a) 읽음상태 → 메시지 → 채팅방
        if room_ids:
            try:
                await db.execute(delete(ChatRoomReadStatus).where(ChatRoomReadStatus.room_id.in_(room_ids)))
            except Exception:
                pass
            try:
                res_msg = await db.execute(delete(ChatMessage).where(ChatMessage.chat_room_id.in_(room_ids)))
                rc = getattr(res_msg, "rowcount", None)
                if isinstance(rc, int):
                    summary["deleted_messages"] = int(rc)
            except Exception:
                pass
            try:
                res_room = await db.execute(delete(ChatRoom).where(ChatRoom.id.in_(room_ids)))
                rc = getattr(res_room, "rowcount", None)
                if isinstance(rc, int):
                    summary["deleted_rooms"] = int(rc)
            except Exception:
                pass

        # (c) 스토리-추출 레코드(그리드)
        # - StoryExtractedCharacter.character_id 는 FK이므로, Character 삭제 전에 먼저 제거한다(잔여물 방지)
        try:
            res_ex = await db.execute(delete(StoryExtractedCharacter).where(StoryExtractedCharacter.story_id == story_id))
            rc = getattr(res_ex, "rowcount", None)
            if isinstance(rc, int):
                summary["deleted_extracted_rows"] = int(rc)
        except Exception:
            pass

        # (b) 캐릭터 종속 데이터
        if char_ids:
            # 메모/좋아요/댓글/북마크/태그연결/설정/예시대화
            for model, col in [
                (MemoryNote, MemoryNote.character_id),
                (CharacterLike, CharacterLike.character_id),
                (CharacterComment, CharacterComment.character_id),
                (CharacterBookmark, CharacterBookmark.character_id),
                (CharacterTag, CharacterTag.character_id),
                (CharacterSetting, CharacterSetting.character_id),
                (CharacterExampleDialogue, CharacterExampleDialogue.character_id),
            ]:
                try:
                    await db.execute(delete(model).where(col.in_(char_ids)))
                except Exception:
                    pass

            # 마지막: 캐릭터 본체
            try:
                res_ch = await db.execute(delete(Character).where(Character.id.in_(char_ids)))
                rc = getattr(res_ch, "rowcount", None)
                if isinstance(rc, int):
                    summary["deleted_characters"] = int(rc)
            except Exception:
                pass

        # (d) 스토리 플래그 복구
        try:
            await db.execute(update(Story).where(Story.id == story_id).values(is_origchat=False))
        except Exception:
            pass

        await db.commit()
    except Exception:
        try:
            await db.rollback()
        except Exception:
            pass

    # 4) Redis 상태 제거(베스트 에포트)
    try:
        await redis_client.delete(f"extract:status:{story_id}")
    except Exception:
        pass

    # ✅ 채팅 서버 Redis 캐시(룸/메시지/컨텍스트)도 정리(베스트 에포트)
    # - chat-server는 Redis를 사용해 room/meta/cache를 보관한다.
    # - DB에서 room을 삭제해도 Redis가 남아있으면, 짧은 시간 동안 "유령 방"처럼 보일 수 있다.
    try:
        if room_ids:
            keys = []
            for rid in room_ids:
                try:
                    rs = str(rid)
                    keys.append(f"chat_room:{rs}")
                    keys.append(f"message_cache:{rs}")
                    keys.append(f"ai_context:{rs}")
                except Exception:
                    pass
            if keys:
                await redis_client.delete(*keys)
    except Exception:
        pass

    return summary


class StoryDiveSlotItem(BaseModel):
    """메인 '스토리다이브' 구좌용 추천 작품 아이템

    선정 기준(서버에서 계산):
    - 10화 이상
    - cover_url 있음
    - 웹툰 제외
    - 원작챗 시작 수(낮은 순) + 평균조회수(총조회수/회차수) 반영
    """
    id: uuid.UUID
    title: str
    cover_url: Optional[str] = None
    excerpt: Optional[str] = None
    episode_count: int = 0
    total_views: int = 0
    avg_views: float = 0.0
    origchat_starts: int = 0


@router.get("/storydive/slots", response_model=List[StoryDiveSlotItem])
async def get_storydive_slots(
    limit: int = Query(10, ge=1, le=30),
    min_episodes: int = Query(10, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
):
    """메인 '스토리다이브' 구좌에 노출할 작품 목록을 반환한다.

    방어적 설계:
    - Redis 장애/카운트 누락 시에도 기본값(0)으로 안전하게 동작
    - 평균조회수는 (스토리 상세 진입수 + 모든 회차 조회수 합) / 회차수 로 계산
    """
    # 1) 후보군: 공개 + 웹툰 제외 + 표지 있음 + 회차 수 조건
    #    - 너무 많이 가져오면 Redis mget/정렬이 무거워질 수 있어 상한을 둔다.
    candidate_limit = max(int(limit) * 30, 200)
    cover_non_empty = func.length(func.trim(Story.cover_url)) > 0

    rows = await db.execute(
        select(
            Story,
            func.count(StoryChapter.id).label("episode_count"),
            func.coalesce(func.sum(StoryChapter.view_count), 0).label("chapter_views"),
        )
        .outerjoin(StoryChapter, StoryChapter.story_id == Story.id)
        .where(Story.is_public == True)
        .where(func.coalesce(Story.is_webtoon, False) == False)
        .where(Story.cover_url.isnot(None))
        .where(cover_non_empty)
        .group_by(Story.id)
        .having(func.count(StoryChapter.id) >= int(min_episodes))
        .order_by(Story.view_count.desc(), Story.like_count.desc(), Story.created_at.desc())
        .limit(candidate_limit)
    )
    candidates = rows.all() or []

    # 2) Redis에서 원작챗 시작 수 일괄 조회
    story_ids = [str(s.id) for (s, _, _) in candidates if getattr(s, "id", None)]
    keys = [f"origchat:story:{sid}:starts" for sid in story_ids]
    starts_map: dict[str, int] = {}
    try:
        vals = await redis_client.mget(keys) if keys else []
        for sid, v in zip(story_ids, vals or []):
            try:
                starts_map[sid] = int(v or 0)
            except Exception:
                starts_map[sid] = 0
    except Exception:
        starts_map = {sid: 0 for sid in story_ids}

    # 3) 평균조회수(총조회수/회차수) 계산 + 정렬
    def _make_item(s: Story, *, episode_count: int, chapter_views: int, origchat_starts: int) -> Optional[StoryDiveSlotItem]:
        """StoryDiveSlotItem 생성(방어적)."""
        if not s or not getattr(s, "id", None):
            return None
        try:
            epc = int(episode_count or 0)
        except Exception:
            epc = 0
        if epc <= 0:
            return None
        try:
            base_views = int(getattr(s, "view_count", 0) or 0)
        except Exception:
            base_views = 0
        try:
            chv = int(chapter_views or 0)
        except Exception:
            chv = 0
        total_views = base_views + chv
        avg_views = float(total_views) / float(epc or 1)
        try:
            text = (getattr(s, "content", "") or "").strip()
        except Exception:
            text = ""
        excerpt = " ".join(text.split())[:140] if text else None
        try:
            starts = int(origchat_starts or 0)
        except Exception:
            starts = 0
        return StoryDiveSlotItem(
            id=s.id,
            title=s.title,
            cover_url=getattr(s, "cover_url", None),
            excerpt=excerpt,
            episode_count=epc,
            total_views=int(total_views),
            avg_views=float(avg_views),
            origchat_starts=starts,
        )

    items: list[StoryDiveSlotItem] = []
    for s, ep_cnt, ch_views in candidates:
        try:
            episode_count = int(ep_cnt or 0)
        except Exception:
            episode_count = 0
        if episode_count < int(min_episodes):
            continue
        sid_str = str(getattr(s, "id"))
        origchat_starts = int(starts_map.get(sid_str, 0) or 0)
        it = _make_item(s, episode_count=episode_count, chapter_views=int(ch_views or 0), origchat_starts=origchat_starts)
        if it:
            items.append(it)

    # 원작챗 시작 수 낮은 순 + 평균조회수 높은 순(품질)로 정렬
    items.sort(
        key=lambda it: (
            int(it.origchat_starts or 0),
            -float(it.avg_views or 0.0),
            -int(it.total_views or 0),
        )
    )
    # 최종 반환: 기준을 충족하는 만큼만 반환한다.
    # - 5개 미만이면 그만큼만 반환
    # - 0개면 빈 배열(프론트에서 구좌 비노출)
    return items[: int(limit)]

@router.get("/{story_id}/context-pack")
async def get_context_pack(
    story_id: uuid.UUID,
    anchor: int = Query(1, ge=1),
    characterId: Optional[str] = Query(None),
    mode: Optional[str] = Query(None),
    rangeFrom: Optional[int] = Query(None),
    rangeTo: Optional[int] = Query(None),
    sceneId: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user_optional),
):
    """경량 컨텍스트 팩: actor/director/guard 필드 반환.
    - 기존 프론트 호환을 위해 쿼리 파라미터는 유연하게 수용하되 anchor/characterId만 사용.
    """
    # 스토리 존재 및 공개 여부 확인
    story = await story_service.get_story_by_id(db, story_id)
    if not story:
        raise HTTPException(status_code=404, detail="스토리를 찾을 수 없습니다")
    
    # 비공개 스토리는 작성자/관리자만 접근 가능
    if not story.is_public and (
        (not current_user)
        or (story.creator_id != current_user.id and not getattr(current_user, "is_admin", False))
    ):
        raise HTTPException(status_code=403, detail="접근 권한이 없습니다")
    
    try:
        pack = await build_context_pack(db, story_id, int(anchor or 1), characterId)
        # 백그라운드로 컨텍스트/요약/스타일/인트로 준비
        try:
            import asyncio
            from app.core.database import AsyncSessionLocal, redis_client
            from app.services.origchat_service import (
                warm_context_basics,
                detect_style_profile,
                ensure_episode_summaries,
                generate_backward_weighted_recap,
                get_scene_anchor_text,
            )

            async def _prepare_all(sid: uuid.UUID, anch: int, cid: Optional[str], scene: Optional[str], r_from: Optional[int], r_to: Optional[int]):
                async with AsyncSessionLocal() as _db:
                    try:
                        await warm_context_basics(_db, sid, int(anch or 1))
                    except Exception:
                        pass
                    try:
                        await detect_style_profile(_db, sid, upto_anchor=int(anch or 1))
                    except Exception:
                        pass
                    try:
                        if r_from and r_to:
                            await ensure_episode_summaries(_db, sid, start_no=int(r_from), end_no=int(r_to))
                        else:
                            await ensure_episode_summaries(_db, sid, upto_anchor=int(anch or 1), max_episodes=12)
                    except Exception:
                        pass
                    # 인사말 프리패브 생성
                    try:
                        intro_lines: list[str] = []
                        # 작품 요약 50자
                        try:
                            srow = await _db.execute(select(Story.title, Story.summary, Story.content).where(Story.id == sid))
                            sdata = srow.first()
                            if sdata:
                                story_summary = (sdata[1] or "").strip() or (sdata[2] or "").strip()
                                if story_summary:
                                    intro_lines.append((" ".join(story_summary.split()))[:50])
                        except Exception:
                            pass
                        # 장면 인용 100자
                        try:
                            excerpt = await get_scene_anchor_text(_db, sid, chapter_no=int(anch or 1), scene_id=scene, max_len=100)
                            if excerpt:
                                intro_lines.append(f"“{excerpt.strip()}”")
                        except Exception:
                            pass
                        text = "\n\n".join([ln for ln in intro_lines if ln])
                        key = f"ctx:warm:{sid}:prepared_intro:{cid or 'none'}:{int(anch or 1)}:{scene or 'none'}"
                        try:
                            if text:
                                await redis_client.setex(key, 900, text)
                            else:
                                # 준비되었음을 알리되 빈 값으로 표시
                                await redis_client.setex(key, 300, "")
                        except Exception:
                            pass
                    except Exception:
                        pass

            asyncio.create_task(_prepare_all(story_id, int(anchor or 1), characterId, sceneId, rangeFrom, rangeTo))
        except Exception:
            pass
        return pack
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"context-pack 실패: {e}")
@router.get("/{story_id}/start-options", response_model=StartOptionsV2)
async def get_start_options_v2(
    story_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user_optional),
):
    """시작 옵션(경량): 개요/모드/단순 장면 인덱스/추천 시작점.
    - 정확한 scene 분할이 없으면 문단 길이 기반 근사로 반환.
    - 전체 회차를 대상으로 하되, 너무 큰 작품은 안전 상한을 둘 수 있음(프론트에서 페이징 고려).
    """
    # 스토리 존재 및 공개 여부 확인
    story = await story_service.get_story_by_id(db, story_id)
    if not story:
        raise HTTPException(status_code=404, detail="스토리를 찾을 수 없습니다")
    
    # 비공개 스토리는 작성자/관리자만 접근 가능
    if not story.is_public and (
        (not current_user)
        or (story.creator_id != current_user.id and not getattr(current_user, "is_admin", False))
    ):
        raise HTTPException(status_code=403, detail="접근 권한이 없습니다")
    
    # 간단 개요(스토리 content 앞 240자)
    s = await story_service.get_story_by_id(db, story_id)
    overview = (getattr(s, "content", "") or "").strip().replace("\n", " ")[:240] if s else None

    # 근사 씬 인덱스(각 화 2~3개 placeholder)
    items: list[ChapterScenes] = []
    try:
        # 총 회차 수를 파악하여 과도한 상한을 회피(기본: 전체, 상한 200)
        last_no = await db.scalar(select(func.max(StoryChapter.no)).where(StoryChapter.story_id == story_id)) or 1
        limit_n = min(int(last_no), 200)
        rows = await db.execute(
            select(StoryChapter.no, StoryChapter.title, StoryChapter.content)
            .where(StoryChapter.story_id == story_id)
            .order_by(StoryChapter.no.asc())
            .limit(limit_n)
        )
        for no, title, content in rows.all():
            txt = (content or "").strip()
            seg_len = max(1, len(txt) // 3)
            scenes = []
            for i in range(3):
                start = i * seg_len
                if start >= len(txt):
                    break
                scenes.append({
                    "id": f"auto-{no}-{i}",
                    "title": (title or "")[:40],
                    "hint": txt[start:start+80]
                })
            items.append({"no": int(no), "scenes": scenes})
    except Exception:
        items = []

    # 추천 시작점(최근 화 위주)
    top_candidates = []
    try:
        last = await db.scalar(select(func.max(StoryChapter.no)).where(StoryChapter.story_id == story_id)) or 1
        for k in range(3):
            n = max(1, last - k)
            top_candidates.append({"chapter": int(n), "scene_id": f"auto-{n}-0", "label": f"{n}화 추천 시작"})
    except Exception:
        pass

    # 평행 모드용 what-if seeds(초기 후보)
    try:
        from app.services.origchat_service import generate_what_if_seeds
        seeds = await generate_what_if_seeds(db, story_id, anchor=top_candidates[0]['chapter'] if top_candidates else 1)
    except Exception:
        seeds = []

    return StartOptionsV2(
        overview=overview,
        chapter_scene_index=items,
        top_candidates=top_candidates,
        modes=["canon", "parallel"],
        seeds=[{"chapter": top_candidates[0]['chapter'] if top_candidates else 1, "scene_id": None, "label": it["label"]} for it in (seeds or [])] or None,
    )


@router.get("/{story_id}/context-status", response_model=ContextStatus)
async def get_context_status_v2(
    story_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    # 컨텍스트 캐시 상태 조회(간이)
    try:
        from app.core.database import redis_client
        keys = [
            f"ctx:warm:{story_id}:world_bible",
            f"ctx:warm:{story_id}:personas",
            f"ctx:warm:{story_id}:timeline_digest",
        ]
        present = []
        for k in keys:
            try:
                v = await redis_client.get(k)
                if v:
                    present.append(k.rsplit(":", 1)[-1])
            except Exception:
                pass
        return ContextStatus(warmed=bool(present), updated=present)
    except Exception:
        return ContextStatus(warmed=False, updated=[])


# ---- 추가: 역진가중 리캡 / 장면 발췌 미리보기 ----
@router.get("/{story_id}/recap")
async def get_backward_weighted_recap_endpoint(
    story_id: uuid.UUID,
    anchor: int = Query(1, ge=1),
    db: AsyncSession = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user_optional),
):
    # 스토리 존재 및 공개 여부 확인
    story = await story_service.get_story_by_id(db, story_id)
    if not story:
        raise HTTPException(status_code=404, detail="스토리를 찾을 수 없습니다")
    
    # 비공개 스토리는 작성자/관리자만 접근 가능
    if not story.is_public and (
        (not current_user)
        or (story.creator_id != current_user.id and not getattr(current_user, "is_admin", False))
    ):
        raise HTTPException(status_code=403, detail="접근 권한이 없습니다")
    
    try:
        from app.services.origchat_service import generate_backward_weighted_recap
        text = await generate_backward_weighted_recap(db, story_id, anchor=int(anchor or 1))
        return {"recap": text or ""}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"recap 실패: {e}")


@router.get("/{story_id}/scene-excerpt")
async def get_scene_excerpt_endpoint(
    story_id: uuid.UUID,
    chapter: int = Query(1, ge=1),
    sceneId: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user_optional),
):
    # 스토리 존재 및 공개 여부 확인
    story = await story_service.get_story_by_id(db, story_id)
    if not story:
        raise HTTPException(status_code=404, detail="스토리를 찾을 수 없습니다")
    
    # 비공개 스토리는 작성자/관리자만 접근 가능
    if not story.is_public and (
        (not current_user)
        or (story.creator_id != current_user.id and not getattr(current_user, "is_admin", False))
    ):
        raise HTTPException(status_code=403, detail="접근 권한이 없습니다")
    
    try:
        from app.services.origchat_service import get_scene_anchor_text
        text = await get_scene_anchor_text(db, story_id, chapter_no=int(chapter or 1), scene_id=sceneId)
        return {"excerpt": text or ""}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"scene-excerpt 실패: {e}")


def _story_to_response(story: Story) -> StoryResponse:
    """Build StoryResponse safely without triggering lazy relation validation."""
    try:
        tag_slugs = [
            t.slug for t in getattr(story, "tags", [])
            if getattr(t, "slug", None) and not str(getattr(t, "slug", "")).startswith("cover:")
        ]
    except Exception:
        tag_slugs = []
    payload = {
        "id": story.id,
        "creator_id": story.creator_id,
        "character_id": getattr(story, "character_id", None),
        "title": story.title,
        "content": story.content,
        "keywords": None,
        "genre": getattr(story, "genre", None),
        "is_public": bool(getattr(story, "is_public", True)),
        "is_webtoon": bool(getattr(story, "is_webtoon", False)),
        "cover_url": getattr(story, "cover_url", None),
        "is_origchat": bool(getattr(story, "is_origchat", False)),
        "like_count": int(getattr(story, "like_count", 0) or 0),
        "view_count": int(getattr(story, "view_count", 0) or 0),
        "comment_count": int(getattr(story, "comment_count", 0) or 0),
        "created_at": story.created_at,
        "updated_at": story.updated_at,
        "tags": tag_slugs,
    }
    return StoryResponse(**payload)


@router.post("/generate", response_model=StoryGenerationResponse)
async def generate_story(
    request: StoryGenerationRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """AI 스토리 생성"""
    try:
        # 스토리 생성
        result = await story_generation_service.generate_story(
            keywords=request.keywords,
            character_id=request.character_id,
            genre=request.genre,
            length=request.length,
            tone=request.tone
        )
        
        # 자동 저장 옵션이 활성화된 경우 DB에 저장
        story_id = None
        if request.auto_save:
            story_data = StoryCreate(
                title=result["title"],
                content=result["content"],
                genre=result.get("genre"),
                keywords=result["keywords"],
                is_public=False,  # 기본적으로 비공개
                metadata=result.get("metadata", {})
            )
            
            story = await story_service.create_story(db, current_user.id, story_data)
            story_id = story.id
        
        return StoryGenerationResponse(
            story_id=story_id,
            title=result["title"],
            content=result["content"],
            keywords=result["keywords"],
            genre=result.get("genre"),
            estimated_reading_time=result["estimated_reading_time"],
            metadata=result.get("metadata", {})
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"스토리 생성 실패: {str(e)}")


@router.post("/generate/stream")
async def generate_story_stream(
    request: Request,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user_optional),
    job_service: JobService = Depends(get_job_service)
):
    """SSE stream using the new real-time AI generation pipeline."""
    body = await request.json()
    job_id = str(uuid.uuid4())

    async def run_generation_in_background():
        try:
            initial_data = {
                "status": "queued",
                "stage": "start",
                "content_so_far": "",
                "preview_sent": False,
                "title": "생성 중...",
                "final_result": None,
                "error_message": None,
                "cancelled": False,
            }
            await job_service.create_job(job_id, initial_data)
        
            # 실제 생성 로직
            await job_service.update_job(job_id, {"status": "running"})
            
            keywords = body.get("keywords") or []
            model_str = (body.get("model") or "").lower()
            
            if "claude" in model_str: ai_model = "claude"
            elif "gpt" in model_str: ai_model = "gpt"
            else: ai_model = "gemini"

            full_content = ""
            
            # keywords가 비어도 최소 프롬프트 기반으로 생성되도록 처리
            async for event_data in story_generation_service.generate_story_stream(
                keywords=keywords,
                genre=body.get("genre"),
                length=body.get("length", "medium"),
                tone=body.get("tone", "neutral"),
                ai_model=ai_model,
                ai_sub_model=model_str
            ):
                # Check cancellation
                state = await job_service.get_job(job_id)
                if state and state.get("cancelled"):
                    await job_service.update_job(job_id, {"status": "cancelled"})
                    break
                event_name = event_data.get("event")
                data_payload = event_data.get("data", {})
                
                if event_name == "story_delta":
                    full_content += data_payload.get("delta", "")
                    updates = {"content_so_far": full_content}
                    # preview_sent 플래그는 job_service 내부에서 관리되므로 직접 참조 대신 get_job 사용
                    current_job_state = await job_service.get_job(job_id)
                    # 프리뷰는 '최대 500자'이므로, 너무 늦게 나오지 않도록 임계값을 낮춰 조기 전송
                    if current_job_state and not current_job_state.get("preview_sent") and len(full_content) >= 200:
                        updates["preview_sent"] = True
                    await job_service.update_job(job_id, updates)

                elif event_name == "stage_start":
                    await job_service.update_job(job_id, {"stage": data_payload.get("label", "진행 중...")})

                elif event_name == "stage_end" and data_payload.get("name") == "title_generation":
                    await job_service.update_job(job_id, {"title": data_payload.get("result", "무제")})

                elif event_name == "final":
                    await job_service.update_job(job_id, {"status": "done", "final_result": data_payload})
                
                elif event_name == "error":
                    raise Exception(data_payload.get("message", "Unknown generation error"))

        except Exception as e:
            # 백그라운드 작업에서 발생하는 모든 예외를 잡아서 Redis에 기록
            error_message = f"배경 생성 작업 실패: {str(e)}"
            try:
                await job_service.update_job(job_id, {"status": "error", "error_message": error_message})
            except:
                # Redis 업데이트조차 실패하는 경우 (연결 문제 등)
                # 이 경우는 어쩔 수 없이 클라이언트가 타임아웃 처리해야 함
                pass

    # 중요: StreamingResponse에서 BackgroundTasks는 응답 종료 후 실행되므로
    # 여기서는 즉시 비동기 작업을 시작해야 함
    asyncio.create_task(run_generation_in_background())

    async def event_generator():
        yield f'event: meta\n'
        yield f'data: {{"job_id": "{job_id}", "queue_position": 0}}\n\n'
        
        last_content_len = 0
        last_stage = None
        last_title = None
        preview_emitted = False

        try:
            while True:
                job_state = await job_service.get_job(job_id)
                if not job_state:
                    # Job이 생성되기 전이거나 알 수 없는 이유로 사라짐
                    await asyncio.sleep(0.5)
                    continue
                
                if job_state.get("status") in ["done", "error", "cancelled"]:
                    if job_state.get("status") == "error" and job_state.get("error_message"):
                         yield f'event: error\n'
                         yield f'data: {{"message": {json.dumps(job_state.get("error_message"))} }}\n\n'
                    elif job_state.get("status") == "cancelled":
                        yield f'event: error\n'
                        yield f'data: {{"message": "cancelled"}}\n\n'
                    elif job_state.get("final_result"):
                        yield f'event: final\n'
                        yield f'data: {json.dumps(job_state.get("final_result"))}\n\n'
                    break

                # Stage 변경 감지
                current_stage = job_state.get("stage")
                if current_stage is not None and current_stage != last_stage:
                    last_stage = current_stage
                    yield f'event: stage_start\n'
                    yield f'data: {json.dumps({"label": last_stage})}\n\n'

                # 제목 변경 감지
                current_title = job_state.get("title")
                if current_title is not None and current_title != last_title:
                    last_title = current_title
                    yield f'event: stage_end\n'
                    yield f'data: {json.dumps({"name": "title_generation", "result": last_title})}\n\n'
                
                # 프리뷰 1회 전송
                content = job_state.get("content_so_far", "")
                if (not preview_emitted) and job_state.get("preview_sent"):
                    # 500자보다 짧게 생성되더라도 preview_sent가 True이면 일단 보냄
                    preview_content = content[:500]
                    yield f'event: preview\n'
                    yield f'data: {{"text": {json.dumps(preview_content)}}}\n\n'
                    preview_emitted = True
                    last_content_len = len(preview_content)

                # 컨텐츠 델타 전송 (프리뷰 전/후 상관없이 즉시 스트리밍)
                if len(content) > last_content_len:
                    delta = content[last_content_len:]
                    yield f'event: episode\n'
                    yield f'data: {json.dumps({"delta": delta})}\n\n'
                    last_content_len = len(content)
                
                await asyncio.sleep(0.2) # 폴링 간격 단축
        except asyncio.CancelledError:
            # Client disconnected
            pass
        except Exception as e:
            # 폴링 루프 자체의 예외
            try:
                error_payload = json.dumps({"message": f"Stream polling failed on the server: {str(e)}"})
                yield f'event: error\n'
                yield f'data: {error_payload}\n\n'
            except:
                pass

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream; charset=utf-8",
        headers={"X-Accel-Buffering": "no", "Cache-Control": "no-cache"},
    )

@router.get("/generate/stream/{job_id}/status")
async def get_job_status(job_id: str, job_service: JobService = Depends(get_job_service)):
    job = await job_service.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job

@router.delete("/generate/stream/{job_id}")
async def cancel_job(job_id: str, job_service: JobService = Depends(get_job_service)):
    state = await job_service.cancel_job(job_id)
    if not state:
        raise HTTPException(status_code=404, detail="Job not found")
    return {"message": "cancelled"}


@router.post("/", response_model=StoryResponse)
async def create_story(
    story_data: StoryCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """스토리 생성"""
    story = await story_service.create_story(db, current_user.id, story_data)
    loaded = await story_service.get_story_by_id(db, story.id)
    return _story_to_response(loaded)


@router.get("/", response_model=StoryListResponse)
async def get_stories(
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    search: Optional[str] = Query(None),
    genre: Optional[str] = Query(None),
    sort: Optional[str] = Query(None, description="정렬: views|likes|recent"),
    only: Optional[str] = Query(None, description="origchat|webnovel 필터"),
    creator_id: Optional[uuid.UUID] = Query(None),
    tags: Optional[str] = Query(None, description="쉼표로 구분된 태그 슬러그 목록"),
    db: AsyncSession = Depends(get_db)
):
    """공개 스토리 목록 조회"""
    tag_list: list[str] = []
    if tags:
        if isinstance(tags, str):
            tag_list = [slug.strip() for slug in tags.split(",") if slug.strip()]
    stories = await story_service.get_public_stories(
        db,
        skip=skip,
        limit=limit,
        search=search,
        genre=genre,
        sort=sort,
        only=only,
        creator_id=creator_id,
        tags=tag_list or None,
    )
    # 목록용 항목으로 변환하면서 excerpt 채움
    items: list[StoryListItem] = []
    
    # 모든 스토리 ID 수집
    story_ids = [s.id for s in stories]
    
    # episode_count 일괄 조회 (DB COUNT 쿼리로 효율화)
    episode_counts = {}
    if story_ids:
        try:
            from app.models.story_chapter import StoryChapter
            rows = await db.execute(
                select(StoryChapter.story_id, func.count(StoryChapter.id))
                .where(StoryChapter.story_id.in_(story_ids))
                .group_by(StoryChapter.story_id)
            )
            episode_counts = {str(row[0]): row[1] for row in rows.all()}
        except Exception:
            episode_counts = {}
    
    # 모든 스토리의 extracted_characters에서 character_id 수집
    all_char_ids = []
    for s in stories:
        for ec in (getattr(s, "extracted_characters", []) or []):
            char_id = getattr(ec, "character_id", None)
            if char_id:
                all_char_ids.append(char_id)
    
    # Character 모델 일괄 조회
    char_map = {}
    if all_char_ids:
        try:
            char_rows = await db.execute(
                select(Character).where(Character.id.in_(all_char_ids))
            )
            char_map = {str(c.id): c for c in char_rows.scalars().all()}
        except Exception:
            char_map = {}
    
    # for s in stories:
    #     for ec in (getattr(s, "extracted_characters", []) or []):
    #         char_id = getattr(ec, "character_id", None)
    #         if char_id:
    #             all_char_ids.append(char_id)
    
    # # Character 모델 일괄 조회
    # char_map = {}
    # if all_char_ids:
    #     try:
    #         char_rows = await db.execute(
    #             select(Character).where(Character.id.in_(all_char_ids))
    #         )
    #         char_map = {str(c.id): c for c in char_rows.scalars().all()}
    #     except Exception:
    #         char_map = {}
    
    for s in stories:
        try:
            text = (s.content or "").strip()
        except Exception:
            text = ""
        # 간단 발췌: 줄바꿈/공백 정리 후 앞부분 140자
        excerpt = " ".join(text.split())[:140] if text else None
    # 태그 슬러그 추출(cover: 메타 제외)
        tag_slugs = []
        try:
            for t in (getattr(s, "tags", []) or []):
                slug = getattr(t, "slug", None)
                if slug and not str(slug).startswith("cover:"):
                    tag_slugs.append(slug)
        except Exception:
            pass
            # 최신 회차 업로드 시각
        latest_chapter_created_at = None
        try:
            if getattr(s, "chapters", None):
                latest_chapter_created_at = max(
                    (c.created_at for c in s.chapters if getattr(c, "created_at", None)),
                    default=None
                )
        except Exception:
            latest_chapter_created_at = None
        items.append(StoryListItem(
            id=s.id,
            title=s.title,
            genre=s.genre,
            is_public=bool(s.is_public),
            is_origchat=bool(getattr(s, "is_origchat", False)),
            is_webtoon=bool(getattr(s, "is_webtoon", False)),
            like_count=int(s.like_count or 0),
            view_count=int(s.view_count or 0),
            comment_count=int(s.comment_count or 0),
            created_at=s.created_at,
            creator_username=(s.creator.username if getattr(s, "creator", None) else None),
            creator_avatar_url=(s.creator.avatar_url if getattr(s, "creator", None) else None),
            character_name=(s.character.name if getattr(s, "character", None) else None),
            cover_url=getattr(s, "cover_url", None),
            excerpt=excerpt,
            tags=tag_slugs,
            latest_chapter_created_at=latest_chapter_created_at,
            episode_count=episode_counts.get(str(s.id), 0),
            extracted_characters=[
                {
                    "id": str(ec.id),
                    "name": ec.name,
                    "initial": ec.initial,
                    "avatar_url": (
                        char_map[str(ec.character_id)].avatar_url
                        if (not ec.avatar_url)
                        and getattr(ec, "character_id", None)
                        and str(ec.character_id) in char_map
                        else ec.avatar_url
                    )
                }
                # ✅ 안전: 연결된 원작챗 캐릭터가 비공개면 공개 목록에서는 숨김
                for ec in (getattr(s, "extracted_characters", []) or [])
                if not (
                    getattr(ec, "character_id", None)
                    and str(ec.character_id) in char_map
                    and getattr(char_map.get(str(ec.character_id)), "is_public", True) == False
                )
            ]
        ))

    return StoryListResponse(
        stories=items,
        total=len(items),
        skip=skip,
        limit=limit
    )


@router.get("/my", response_model=StoryListResponse)
async def get_my_stories(
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    search: Optional[str] = Query(None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """내 스토리 목록 조회"""
    stories = await story_service.get_stories_by_creator(
        db, current_user.id, skip=skip, limit=limit, search=search
    )

    items: list[StoryListItem] = []
    # extracted_characters에 연결된 Character 아바타 미리 로드
    char_ids = []
    for s in stories:
        for ec in (getattr(s, "extracted_characters", []) or []):
            cid = getattr(ec, "character_id", None)
            if cid:
                char_ids.append(cid)

    char_map = {}
    if char_ids:
        rows = await db.execute(select(Character).where(Character.id.in_(char_ids)))
        char_map = {str(c.id): c for c in rows.scalars().all()}

    for s in stories:
        try:
            text = (s.content or "").strip()
        except Exception:
            text = ""
        excerpt = " ".join(text.split())[:140] if text else None
        # 태그 슬러그 추출
        tag_slugs = []
        try:
            for t in (getattr(s, "tags", []) or []):
                slug = getattr(t, "slug", None)
                if slug and not str(slug).startswith("cover:"):
                    tag_slugs.append(slug)
        except Exception:
            pass

        # extracted_characters 생성 시 avatar_url 보강
        extracted_chars = []
        for ec in (getattr(s, "extracted_characters", []) or []):
            avatar_url = ec.avatar_url
            # avatar_url이 없고 character_id가 있으면 연결된 Character의 avatar_url 사용
            if not avatar_url and getattr(ec, "character_id", None):
                char = char_map.get(str(ec.character_id))
                if char and getattr(char, "avatar_url", None):
                    avatar_url = char.avatar_url
            extracted_chars.append({
                "id": str(ec.id),
                "name": ec.name,
                "initial": ec.initial,
                "avatar_url": avatar_url
            })

        items.append(StoryListItem(
            id=s.id,
            title=s.title,
            genre=s.genre,
            is_public=bool(s.is_public),
            is_origchat=bool(getattr(s, "is_origchat", False)),
            is_webtoon=bool(getattr(s, "is_webtoon", False)),
            like_count=int(s.like_count or 0),
            view_count=int(s.view_count or 0),
            comment_count=int(s.comment_count or 0),
            created_at=s.created_at,
            creator_username=(s.creator.username if getattr(s, "creator", None) else None),
            creator_avatar_url=(s.creator.avatar_url if getattr(s, "creator", None) else None),
            character_name=(s.character.name if getattr(s, "character", None) else None),
            cover_url=getattr(s, "cover_url", None),
            excerpt=excerpt,
            tags=tag_slugs,
        ))

    return StoryListResponse(
        stories=items,
        total=len(items),
        skip=skip,
        limit=limit
    )


@router.get("/{story_id}", response_model=StoryWithDetails)
async def get_story(
    story_id: uuid.UUID,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user_optional)
):
    """스토리 상세 조회"""
    story = await story_service.get_story_by_id(db, story_id)
    
    if not story:
        raise HTTPException(status_code=404, detail="스토리를 찾을 수 없습니다")
    
    # 비공개 스토리는 작성자/관리자만 조회 가능
    if not story.is_public and (
        (not current_user)
        or (story.creator_id != current_user.id and not getattr(current_user, "is_admin", False))
    ):
        raise HTTPException(status_code=403, detail="접근 권한이 없습니다")
    
    # 조회수 증가 (백그라운드 작업)
    background_tasks.add_task(story_service.increment_story_view_count, db, story_id)
    
    # StoryResponse 형식으로 먼저 변환
    # 기본 필드 직렬화는 수동 구성 함수 사용
    base_resp = _story_to_response(story)
    story_dict = base_resp.model_dump()
    # 총 조회수(작품 상세 + 회차 합계) 계산
    try:
        from app.services.story_service import get_story_total_views
        story_dict["view_count"] = await get_story_total_views(db, story_id)
    except Exception:
        pass
    
    # 추가 정보 포함
    story_dict["creator_username"] = story.creator.username if story.creator else None
    story_dict["creator_avatar_url"] = story.creator.avatar_url if story.creator else None
    story_dict["character_name"] = story.character.name if story.character else None
    
    # 좋아요 상태 추가 (로그인한 사용자인 경우만)
    if current_user:
        story_dict["is_liked"] = await story_service.is_story_liked_by_user(db, story_id, current_user.id)
    else:
        story_dict["is_liked"] = False
    
    # 태그 슬러그 주입
    # 태그는 수동으로 슬러그 배열로 변환 (Pydantic from_attributes가 관계를 Tag 객체로 채우는 이슈 방지)
    story_dict["tags"] = []
    try:
        for t in getattr(story, "tags", []) or []:
            slug = getattr(t, "slug", None)
            if slug and not str(slug).startswith("cover:"):
                story_dict["tags"].append(slug)
    except Exception:
        pass
    return StoryWithDetails(**story_dict)


@router.put("/{story_id}", response_model=StoryResponse)
async def update_story(
    story_id: uuid.UUID,
    story_data: StoryUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """스토리 정보 수정"""
    try:
        story = await story_service.get_story_by_id(db, story_id)
        
        if not story:
            raise HTTPException(status_code=404, detail="스토리를 찾을 수 없습니다")
        
        is_owner = story.creator_id == current_user.id
        is_admin = bool(getattr(current_user, "is_admin", False))

        if not is_owner and not is_admin:
            raise HTTPException(status_code=403, detail="수정 권한이 없습니다")

        # ✅ 최소 권한: 관리자는 타인의 작품에 대해 공개/비공개만 변경 가능
        if is_admin and not is_owner:
            patch = story_data.model_dump(exclude_unset=True)
            allowed_keys = {"is_public"}
            extra_keys = set(patch.keys()) - allowed_keys
            if extra_keys:
                raise HTTPException(status_code=403, detail="관리자는 공개/비공개만 변경할 수 있습니다")
        
        updated_story = await story_service.update_story(db, story_id, story_data)
        
        if not updated_story:
            raise HTTPException(status_code=500, detail="스토리 업데이트에 실패했습니다")
        
        # Tag 객체를 문자열 리스트로 변환
        try:
            # StoryResponse의 from_attributes가 tags를 Tag 객체로 변환하려고 하므로
            # 먼저 기본 필드만 직렬화하고 tags는 별도로 처리
            # tags를 제외한 기본 필드만 먼저 직렬화
            base_dict = {
                'id': updated_story.id,
                'creator_id': updated_story.creator_id,
                'character_id': updated_story.character_id,
                'title': updated_story.title,
                'content': updated_story.content,
                'summary': updated_story.summary,
                'cover_url': updated_story.cover_url,
                'genre': updated_story.genre,
                'is_public': updated_story.is_public,
                'is_webtoon': updated_story.is_webtoon,
                'is_origchat': updated_story.is_origchat,
                'like_count': updated_story.like_count,
                'view_count': updated_story.view_count,
                'comment_count': updated_story.comment_count,
                'created_at': updated_story.created_at,
                'updated_at': updated_story.updated_at,
                'keywords': None,  # keywords는 Story 모델에 없으므로 None
                'tags': [tag.slug for tag in (updated_story.tags or [])],  # 문자열 리스트로 변환
            }
            return StoryResponse(**base_dict)
        except Exception as e:
            import traceback
            traceback.print_exc()
            raise HTTPException(status_code=500, detail=f"응답 변환 실패: {str(e)}")
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"스토리 업데이트 중 오류 발생: {str(e)}")


@router.delete("/{story_id}")
async def delete_story(
    story_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """스토리 삭제"""
    story = await story_service.get_story_by_id(db, story_id)
    
    if not story:
        raise HTTPException(status_code=404, detail="스토리를 찾을 수 없습니다")
    
    if story.creator_id != current_user.id:
        raise HTTPException(status_code=403, detail="삭제 권한이 없습니다")
    
    success = await story_service.delete_story(db, story_id)
    
    if not success:
        raise HTTPException(status_code=500, detail="스토리 삭제에 실패했습니다")
    
    return {"message": "스토리가 삭제되었습니다"}


@router.post("/{story_id}/like")
async def like_story(
    story_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """스토리 좋아요"""
    story = await story_service.get_story_by_id(db, story_id)
    
    if not story:
        raise HTTPException(status_code=404, detail="스토리를 찾을 수 없습니다")
    
    if not story.is_public:
        raise HTTPException(status_code=403, detail="비공개 스토리에는 좋아요를 할 수 없습니다")
    
    # 이미 좋아요를 눌렀는지 확인
    is_liked = await story_service.is_story_liked_by_user(db, story_id, current_user.id)
    
    if is_liked:
        raise HTTPException(status_code=400, detail="이미 좋아요를 누른 스토리입니다")
    
    success = await story_service.like_story(db, story_id, current_user.id)
    
    if not success:
        raise HTTPException(status_code=500, detail="좋아요 처리에 실패했습니다")
    
    return {"message": "좋아요가 추가되었습니다"}


@router.delete("/{story_id}/like")
async def unlike_story(
    story_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """스토리 좋아요 취소"""
    story = await story_service.get_story_by_id(db, story_id)
    
    if not story:
        raise HTTPException(status_code=404, detail="스토리를 찾을 수 없습니다")
    
    success = await story_service.unlike_story(db, story_id, current_user.id)
    
    if not success:
        raise HTTPException(status_code=400, detail="좋아요를 누르지 않은 스토리입니다")
    
    return {"message": "좋아요가 취소되었습니다"}


@router.get("/{story_id}/like-status")
async def get_story_like_status(
    story_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """스토리 좋아요 상태 확인"""
    story = await story_service.get_story_by_id(db, story_id)
    
    if not story:
        raise HTTPException(status_code=404, detail="스토리를 찾을 수 없습니다")
    
    is_liked = await story_service.is_story_liked_by_user(db, story_id, current_user.id)
    
    return {
        "is_liked": is_liked,
        "like_count": story.like_count
    }


# ──────────────────────────────────────────────────────────────────────────────
# 등장인물 추출: 조회 / 재생성 / 전체 삭제
# 프론트 기대 경로: GET /stories/{story_id}/extracted-characters
#                 POST /stories/{story_id}/extracted-characters/rebuild
#                 DELETE /stories/{story_id}/extracted-characters
# ──────────────────────────────────────────────────────────────────────────────

async def _cleanup_origchat_entities_for_story(db: AsyncSession, story_id: uuid.UUID) -> dict:
    """
    스토리와 연관된 모든 원작챗 엔티티(등장인물 그리드 + 파생 캐릭터 + 채팅방/메시지 등)를 정리한다.

    의도/동작:
    - "전체삭제", "추출 재생성", "중지(취소)" 시 잔여물이 남지 않도록 완전 정리한다.
    - StoryExtractedCharacter만 지우면, 파생 Character가 남아 홈/탐색 원작챗 격자에 계속 노출될 수 있다.
      또한 Character를 직접 DELETE하면 FK 때문에 실패할 수 있으므로, 참조 테이블을 먼저 삭제한다.

    방어적:
    - 여러 번 호출되어도 안전(idempotent)하도록 설계한다.
    - Redis 캐시 삭제는 best-effort로 수행한다(실패해도 DB 정리는 우선).
    """
    summary = {
        "extracted_rows": 0,
        "characters": 0,
        "chat_rooms": 0,
        "chat_messages": 0,
        "chat_message_edits": 0,
        "character_settings": 0,
        "character_example_dialogues": 0,
        "character_likes": 0,
        "character_comments": 0,
        "character_bookmarks": 0,
        "memory_notes": 0,
        "character_tags": 0,
        "redis_keys": 0,
    }
    try:
        # 1) 그리드 레코드 조회(파생 캐릭터 ID 확보)
        rows = await db.execute(
            select(StoryExtractedCharacter.id, StoryExtractedCharacter.character_id)
            .where(StoryExtractedCharacter.story_id == story_id)
        )
        extracted_rows = rows.all() or []
        character_ids = [r[1] for r in extracted_rows if r and r[1]]

        # 2) 그리드 레코드 삭제
        if extracted_rows:
            res = await db.execute(delete(StoryExtractedCharacter).where(StoryExtractedCharacter.story_id == story_id))
            # rowcount는 드라이버에 따라 None일 수 있음
            summary["extracted_rows"] = int(getattr(res, "rowcount", 0) or 0) or len(extracted_rows)

        # 3) 파생 캐릭터 관련 엔티티 삭제(참조 테이블 → 본체 순)
        if character_ids:
            from app.models.chat import ChatRoom, ChatMessage, ChatMessageEdit
            from app.models.character import CharacterSetting, CharacterExampleDialogue
            from app.models.like import CharacterLike
            from app.models.comment import CharacterComment
            from app.models.bookmark import CharacterBookmark
            from app.models.memory_note import MemoryNote
            from app.models.tag import CharacterTag

            # 3-1) 채팅방/메시지/메시지 수정이력 삭제
            room_rows = await db.execute(select(ChatRoom.id).where(ChatRoom.character_id.in_(character_ids)))
            room_ids = [r[0] for r in (room_rows.all() or []) if r and r[0]]
            if room_ids:
                msg_rows = await db.execute(select(ChatMessage.id).where(ChatMessage.chat_room_id.in_(room_ids)))
                msg_ids = [r[0] for r in (msg_rows.all() or []) if r and r[0]]
                if msg_ids:
                    res = await db.execute(delete(ChatMessageEdit).where(ChatMessageEdit.message_id.in_(msg_ids)))
                    summary["chat_message_edits"] = int(getattr(res, "rowcount", 0) or 0)
                res = await db.execute(delete(ChatMessage).where(ChatMessage.chat_room_id.in_(room_ids)))
                summary["chat_messages"] = int(getattr(res, "rowcount", 0) or 0)
                res = await db.execute(delete(ChatRoom).where(ChatRoom.id.in_(room_ids)))
                summary["chat_rooms"] = int(getattr(res, "rowcount", 0) or 0)

            # 3-2) 캐릭터 부가 테이블
            res = await db.execute(delete(MemoryNote).where(MemoryNote.character_id.in_(character_ids)))
            summary["memory_notes"] = int(getattr(res, "rowcount", 0) or 0)

            res = await db.execute(delete(CharacterBookmark).where(CharacterBookmark.character_id.in_(character_ids)))
            summary["character_bookmarks"] = int(getattr(res, "rowcount", 0) or 0)

            res = await db.execute(delete(CharacterLike).where(CharacterLike.character_id.in_(character_ids)))
            summary["character_likes"] = int(getattr(res, "rowcount", 0) or 0)

            res = await db.execute(delete(CharacterComment).where(CharacterComment.character_id.in_(character_ids)))
            summary["character_comments"] = int(getattr(res, "rowcount", 0) or 0)

            res = await db.execute(delete(CharacterSetting).where(CharacterSetting.character_id.in_(character_ids)))
            summary["character_settings"] = int(getattr(res, "rowcount", 0) or 0)

            res = await db.execute(delete(CharacterExampleDialogue).where(CharacterExampleDialogue.character_id.in_(character_ids)))
            summary["character_example_dialogues"] = int(getattr(res, "rowcount", 0) or 0)

            res = await db.execute(delete(CharacterTag).where(CharacterTag.character_id.in_(character_ids)))
            summary["character_tags"] = int(getattr(res, "rowcount", 0) or 0)

            # 3-3) 스토리의 대표 캐릭터로 연결된 경우가 있으면 끊는다(희귀 케이스 방어)
            try:
                from sqlalchemy import update as _update
                await db.execute(_update(Story).where(Story.character_id.in_(character_ids)).values(character_id=None))
            except Exception:
                pass

            # 3-4) 파생 Character 삭제(원작 연결(origin_story_id)로 한정)
            res = await db.execute(
                delete(Character).where(Character.id.in_(character_ids), Character.origin_story_id == story_id)
            )
            summary["characters"] = int(getattr(res, "rowcount", 0) or 0)

        # 4) 스토리 플래그 초기화
        try:
            from sqlalchemy import update as _update
            await db.execute(_update(Story).where(Story.id == story_id).values(is_origchat=False))
        except Exception:
            pass

        await db.commit()

        # 5) Redis 캐시 정리(best-effort)
        try:
            # 진행 상태 키
            try:
                await redis_client.delete(f"extract:status:{story_id}")
                summary["redis_keys"] += 1
            except Exception:
                pass
            # 스토리 텍스트 캐시(추출 컨텍스트)
            try:
                await redis_client.delete(f"story:combined:{story_id}")
                summary["redis_keys"] += 1
            except Exception:
                pass
            # 캐릭터 상세 캐시(있다면)
            for cid in character_ids:
                try:
                    await redis_client.delete(f"character:{cid}")
                    summary["redis_keys"] += 1
                except Exception:
                    pass
        except Exception:
            pass

        return summary
    except Exception as e:
        try:
            await db.rollback()
        except Exception:
            pass
        # 에러를 삼키지 않는다(상위에서 토스트/응답 처리)
        raise e

@router.get("/{story_id}/extracted-characters")
async def get_extracted_characters_endpoint(
    story_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user_optional),
):
    story = await story_service.get_story_by_id(db, story_id)
    if not story:
        raise HTTPException(status_code=404, detail="스토리를 찾을 수 없습니다")
    
    # 비공개 스토리는 작성자/관리자만 등장인물 조회 가능
    if not story.is_public and (
        (not current_user)
        or (story.creator_id != current_user.id and not getattr(current_user, "is_admin", False))
    ):
        raise HTTPException(status_code=403, detail="접근 권한이 없습니다")

    # ✅ 자동추출 비활성화(요구사항)
    #
    # 요구사항:
    # - 상세페이지 진입만으로 자동 생성/자동 재생성이 되면,
    #   "전체삭제"가 먹히지 않는 것처럼 보이고 UX가 혼란스러워진다.
    # - 따라서 등장인물 추출은 "버튼(원작챗 일괄 생성)"을 눌렀을 때만 수행한다.
    #
    # 구현:
    # - 기존에는 items가 비어 있고(회차가 있으면) 크리에이터 상세 진입 시 ensure_extracted_characters_for_story를 호출했다.
    # - 이제는 조회는 조회만 하며, 생성/재생성은 rebuild(동기/비동기) 엔드포인트로만 수행한다.
    rows = await db.execute(
        select(StoryExtractedCharacter)
        .where(StoryExtractedCharacter.story_id == story_id)
        .order_by(StoryExtractedCharacter.order_index.asc(), StoryExtractedCharacter.created_at.asc())
    )
    items = rows.scalars().all()

    # ✅ 방어(레거시/삭제 케이스):
    # - 원작챗 캐릭터가 삭제되며 연결(character_id)이 끊긴 레코드는 그리드에 노출하지 않는다.
    # - 단, "비어있음" 체크 이후에 필터링해야 자동 생성(ensure) 트리거가 불필요하게 동작하지 않는다.
    try:
        items = [r for r in (items or []) if getattr(r, "character_id", None)]
    except Exception:
        pass

    # 연결된 캐릭터들의 대표 이미지(avatar_url)를 한 번에 조회해 보강
    char_map = {}
    try:
        char_ids = [r.character_id for r in items if getattr(r, "character_id", None)]
        if char_ids:
            rows = (await db.execute(select(Character).where(Character.id.in_(char_ids)))).scalars().all()
            char_map = {str(r.id): r for r in rows}
    except Exception:
        char_map = {}

    # ✅ 안전: 연결된 원작챗 캐릭터가 비공개면(원작챗만 비공개 케이스) 일반 유저에게는 숨김
    # - 스토리 자체가 비공개면 위에서 이미 403 처리됨
    # - 작성자/관리자는 전체를 볼 수 있어야 관리가 가능
    try:
        is_owner_or_admin = bool(
            current_user
            and (story.creator_id == current_user.id or getattr(current_user, "is_admin", False))
        )
    except Exception:
        is_owner_or_admin = False

    if not is_owner_or_admin:
        try:
            filtered_items = []
            for r in (items or []):
                cid = getattr(r, "character_id", None)
                if not cid:
                    filtered_items.append(r)
                    continue
                ch = char_map.get(str(cid))
                # 캐릭터가 비공개면 숨김(연결이 끊긴/조회 실패한 경우도 안전하게 숨김)
                if not ch or (getattr(ch, "is_public", True) == False):
                    continue
                filtered_items.append(r)
            items = filtered_items
        except Exception:
            pass

    def _with_cache_bust(url: Optional[str], ver: Optional[str] = None) -> Optional[str]:
        """
        이미지 URL 캐시 버스터(안정 버전키)

        의도/동작:
        - 기존 구현은 `time()` 기반으로 매 요청마다 `?v=`가 바뀌어 브라우저 캐시가 무력화되어
          스토리/원작챗 상세에서 아바타 이미지가 매번 재다운로드되는 문제가 있었다.
        - 이 함수는 "변경 시점" 기반(업데이트 타임스탬프)의 안정적인 버전키만 붙여 캐시 효율을 살린다.

        방어적 처리:
        - `data:` URL에는 쿼리를 붙이지 않는다.
        - 이미 `v=`가 포함된 경우 중복 추가하지 않는다.
        """
        try:
            if not url:
                return url
            s = str(url)
            if s.startswith("data:"):
                return s
            # 이미 버전 파라미터가 있으면 그대로 사용(중복 방지)
            if "v=" in s:
                return s
            if not ver:
                return s
            return f"{s}{'&' if '?' in s else '?'}v={ver}"
        except Exception:
            return url

    def to_dict(rec: StoryExtractedCharacter):
        # 레코드 자체에 avatar_url이 없으면 연결된 캐릭터의 avatar_url로 보강
        avatar = rec.avatar_url
        ver_dt = getattr(rec, "updated_at", None) or getattr(rec, "created_at", None)
        is_public = True
        if not avatar and getattr(rec, "character_id", None):
            ch = char_map.get(str(rec.character_id))
            try:
                if ch and getattr(ch, "is_public", None) is not None:
                    is_public = bool(getattr(ch, "is_public", True))
            except Exception:
                is_public = True
            if ch and getattr(ch, "avatar_url", None):
                avatar = ch.avatar_url
                # 연결된 Character의 업데이트 시점을 버전키로 사용(캐릭터 아바타 변경 반영)
                ver_dt = getattr(ch, "updated_at", None) or getattr(ch, "created_at", None) or ver_dt

        ver = None
        try:
            if ver_dt:
                ver = str(int(ver_dt.timestamp()))
        except Exception:
            ver = None

        avatar = _with_cache_bust(avatar, ver)
        # ✅ 배포 안정: 기본 대표 이미지 폴백
        # - 과거에 생성된 추출 캐릭터(avatar_url 비어있음)도 운영에서 "빈 동그라미"로 보이지 않게 한다.
        # - 환경변수(ORIGCHAT_DEFAULT_AVATAR_URL)가 비어있으면 기존 동작과 동일(아무것도 하지 않음).
        try:
            if not avatar:
                default_avatar = (settings.ORIGCHAT_DEFAULT_AVATAR_URL or "").strip()
                if default_avatar:
                    avatar = _with_cache_bust(default_avatar, ver)
        except Exception:
            pass
        return {
            "id": str(rec.id),
            "name": rec.name,
            "description": rec.description,
            "initial": rec.initial,
            "avatar_url": avatar,
            "character_id": str(rec.character_id) if getattr(rec, "character_id", None) else None,
            "order_index": rec.order_index,
            # ✅ 등장인물 카드 공개/비공개 표시용
            "is_public": bool(is_public),
        }

    # Redis 진행 상태 확인
    extraction_status = None
    try:
        from app.core.database import redis_client
        status_key = f"extract:status:{story_id}"
        status_raw = await redis_client.get(status_key)
        if status_raw:
            extraction_status = status_raw.decode() if isinstance(status_raw, bytes) else str(status_raw)
    except Exception:
        pass
    
    response_data = {"items": [to_dict(r) for r in items]}
    if extraction_status:
        response_data["extraction_status"] = extraction_status
    
    return response_data


@router.post("/{story_id}/extracted-characters/rebuild")
async def rebuild_extracted_characters_endpoint(
    story_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user_optional),
):
    story = await story_service.get_story_by_id(db, story_id)
    if not story:
        raise HTTPException(status_code=404, detail="스토리를 찾을 수 없습니다")
    # 작성자만 재생성 허용
    if not current_user or story.creator_id != current_user.id:
        raise HTTPException(status_code=403, detail="재생성 권한이 없습니다")

    # ✅ 잔여물 없는 "완전 초기화" 후 추출(요구사항)
    # - StoryExtractedCharacter만 지우면, 파생 Character가 남아 홈/탐색에 계속 노출될 수 있다.
    # - 따라서 파생 캐릭터/채팅방/메시지까지 함께 정리한다.
    await _cleanup_origchat_entities_for_story(db, story_id)

    # LLM 기반 추출 시도 → 실패 시 간이 보장 로직
    created = 0
    try:
        created = await extract_characters_from_story(db, story_id)
    except Exception:
        created = 0
    if not created:
        # 다시생성하기는 반드시 LLM 결과를 요구. 실패 시 503 반환
        raise HTTPException(status_code=503, detail="LLM 추출에 실패했습니다. API 키/모델 설정을 확인해 주세요.")

    # 최종 목록 반환
    rows = await db.execute(
        select(StoryExtractedCharacter)
        .where(StoryExtractedCharacter.story_id == story_id)
        .order_by(StoryExtractedCharacter.order_index.asc(), StoryExtractedCharacter.created_at.asc())
    )
    items = rows.scalars().all()
    return {"items": [
        {
            "id": str(r.id),
            "name": r.name,
            "description": r.description,
            "initial": r.initial,
            "avatar_url": r.avatar_url,
            "character_id": str(r.character_id) if getattr(r, "character_id", None) else None,
            "order_index": r.order_index,
        } for r in items
    ], "created": len(items)}


@router.delete("/{story_id}/extracted-characters")
async def delete_extracted_characters_endpoint(
    story_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    story = await story_service.get_story_by_id(db, story_id)
    if not story:
        raise HTTPException(status_code=404, detail="스토리를 찾을 수 없습니다")
    if story.creator_id != current_user.id:
        raise HTTPException(status_code=403, detail="삭제 권한이 없습니다")
    # ✅ 잔여물 없는 "전체삭제"(요구사항)
    summary = await _cleanup_origchat_entities_for_story(db, story_id)
    return {"deleted": True, "summary": summary}


@router.post("/{story_id}/extracted-characters/{extracted_id}/rebuild")
async def rebuild_single_extracted_character_endpoint(
    story_id: uuid.UUID,
    extracted_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """해당 스토리의 특정 추출 캐릭터(그리드 카드 1개)만 재생성한다.
    - 작성자만 가능
    - character_id가 있으면 해당 캐릭터를 LLM 보강(_enrich)만 수행
    - character_id가 없으면 새 캐릭터를 생성 후 링크
    - 그리드 레코드는 유지(이름/설명은 기존 유지; 상세페이지 내용만 보강)
    """
    # 스토리/권한 확인
    story = await story_service.get_story_by_id(db, story_id)
    if not story:
        raise HTTPException(status_code=404, detail="스토리를 찾을 수 없습니다")
    if story.creator_id != current_user.id:
        raise HTTPException(status_code=403, detail="재생성 권한이 없습니다")

    # 추출 캐릭터 레코드 확인
    rec = await db.get(StoryExtractedCharacter, extracted_id)
    if not rec or str(rec.story_id) != str(story_id):
        raise HTTPException(status_code=404, detail="추출 캐릭터를 찾을 수 없습니다")

    # 컨텍스트 구축: 모든 회차 텍스트를 이어 붙여 상한선까지 사용
    rows = await db.execute(
        select(StoryChapter.content)
        .where(StoryChapter.story_id == story_id)
        .order_by(StoryChapter.no.asc())
    )
    contents = [r[0] or "" for r in rows.all()]
    combined = "\n\n".join([t for t in contents if t])
    # 길이 제한(LLM 프롬프트 과대 방지)
    if combined and len(combined) > 12000:
        combined = combined[:12000]

    # 캐릭터 생성/보강
    char: Optional[Character] = None
    if rec.character_id:
        char = await db.get(Character, rec.character_id)
    if not char:
        # 새 캐릭터 생성
        char = Character(
            creator_id=current_user.id,
            name=rec.name,
            description=rec.description or None,
            character_type="roleplay",
            base_language="ko",
            has_affinity_system=True,
            affinity_rules="기본 호감도 규칙: 상호 배려와 신뢰 상승, 공격적 발화 시 하락",
            affinity_stages='[{"stage": "낯섦", "min": 0}, {"stage": "친근", "min": 40}, {"stage": "신뢰", "min": 70}]',
            is_public=True,
            is_active=True,
            source_type='IMPORTED',
            origin_story_id=story_id,
            use_translation=True,
        )
        db.add(char)
        await db.flush()
        rec.character_id = char.id
        try:
            await db.commit()
        except Exception:
            await db.rollback()

    # LLM 보강(실패는 조용히 무시)
    try:
        await _enrich_character_fields(db, char, combined)
    except Exception:
        pass

    # 최신 레코드 반환(그리드 표시 스키마)
    out = {
        "id": str(rec.id),
        "name": rec.name,
        "description": rec.description,
        "initial": rec.initial,
        "avatar_url": rec.avatar_url,
        "character_id": str(rec.character_id) if getattr(rec, "character_id", None) else None,
        "order_index": rec.order_index,
    }
    return {"item": out}


# ──────────────────────────────────────────────────────────────────────────────
# 등장인물 추출: 비동기 잡 전환 (선택)
# 기존 동기식 엔드포인트는 유지하고, 아래 비동기 버전을 추가 제공
# ──────────────────────────────────────────────────────────────────────────────

@router.post("/{story_id}/extracted-characters/rebuild-async")
async def rebuild_extracted_characters_async_endpoint(
    story_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user_optional),
    job_service: JobService = Depends(get_job_service),
):
    story = await story_service.get_story_by_id(db, story_id)
    if not story:
        raise HTTPException(status_code=404, detail="스토리를 찾을 수 없습니다")
    if not current_user or story.creator_id != current_user.id:
        raise HTTPException(status_code=403, detail="재생성 권한이 없습니다")

    job_id = str(uuid.uuid4())

    # ✅ 레이스 방지: 프론트는 job_id를 받은 즉시 /jobs/{id}를 폴링한다.
    # job 생성이 백그라운드 task 안에만 있으면 아주 짧은 타이밍에 404가 나서
    # 프론트가 job_id를 지워버리고(추적 실패) UI가 꼬일 수 있다.
    await job_service.create_job(job_id, {
        "kind": "extract_characters",
        "story_id": str(story_id),
        "status": "queued",
        "stage": "starting",
        "created": 0,
        "error_message": None,
        "cancelled": False,
        # 진행률(윈도우 기준): extract_characters_from_story에서 업데이트
        "total_windows": 0,
        "processed_windows": 0,
    })

    async def run_job():
        # ✅ request-scope DB 세션은 백그라운드에서 쓰면 위험(요청 종료 시 close).
        # 별도 세션을 열어 cleanup/추출을 수행한다.
        from app.core.database import AsyncSessionLocal
        async with AsyncSessionLocal() as _db:
            try:
                # ✅ 취소 선반영(버튼 눌렀다가 바로 중지)
                state0 = await job_service.get_job(job_id)
                if state0 and state0.get("cancelled"):
                    await job_service.update_job(job_id, {"status": "cancelled", "stage": "cancelled"})
                    try:
                        await redis_client.setex(f"extract:status:{story_id}", 60, "cancelled")
                    except Exception:
                        pass
                    return

                await job_service.update_job(job_id, {"status": "running", "stage": "clearing"})

                # ✅ 잔여물 없는 완전 초기화(그리드 + 파생 Character/채팅방/Redis 상태 등)
                try:
                    await _cleanup_origchat_entities_for_story(_db, story_id)
                except Exception:
                    try:
                        await _db.rollback()
                    except Exception:
                        pass

                # UI 즉시 반영: Redis 상태를 in_progress로 설정(충분히 길게 유지)
                # - cleanup 함수에서 extract:status 키를 삭제할 수 있으므로, cleanup 이후에 세팅한다.
                try:
                    await redis_client.setex(f"extract:status:{story_id}", 1800, "in_progress")
                except Exception:
                    pass

                # 취소 확인(초기화 중 눌렀을 수도 있음)
                state = await job_service.get_job(job_id)
                if state and state.get("cancelled"):
                    await job_service.update_job(job_id, {"status": "cancelled", "stage": "cancelled"})
                    try:
                        await _cleanup_origchat_entities_for_story(_db, story_id)
                    except Exception:
                        pass
                    try:
                        await redis_client.setex(f"extract:status:{story_id}", 60, "cancelled")
                    except Exception:
                        pass
                    return

                await job_service.update_job(job_id, {"stage": "extracting"})

                # 추출 실행(+진행률/취소 체크는 extract_characters_from_story에서 처리)
                created = 0
                try:
                    created = await extract_characters_from_story(
                        _db, story_id, job_service=job_service, job_id=job_id
                    )
                    # 취소 반환(-1): 잔여물 없이 종료
                    if isinstance(created, int) and created < 0:
                        await job_service.update_job(job_id, {"status": "cancelled", "stage": "cancelled"})
                        try:
                            await _cleanup_origchat_entities_for_story(_db, story_id)
                        except Exception:
                            pass
                        try:
                            await redis_client.setex(f"extract:status:{story_id}", 60, "cancelled")
                        except Exception:
                            pass
                        return

                    # ✅ created=0이면 '완료'가 아니라 실패
                    # - 크레딧 부족/키 오류 등으로 LLM 호출이 실패하면 created=0이 될 수 있는데,
                    #   이 상태에서 done으로 처리하면 프론트가 "완료" 토스트를 띄워 UX가 망가진다.
                    if not created:
                        raise RuntimeError("등장인물 추출 결과가 없습니다. (API 키/크레딧을 확인해주세요)")
                except Exception as e:
                    await job_service.update_job(job_id, {"status": "error", "error_message": str(e)})
                    # 실패 시 잔여물 정리(방어)
                    try:
                        await _cleanup_origchat_entities_for_story(_db, story_id)
                    except Exception:
                        pass
                    try:
                        await redis_client.setex(f"extract:status:{story_id}", 300, "failed")
                    except Exception:
                        pass
                    return

                await job_service.update_job(job_id, {"status": "done", "created": int(created or 0), "stage": "done"})
                try:
                    await redis_client.setex(f"extract:status:{story_id}", 120, "completed")
                except Exception:
                    pass

            except Exception as e:
                try:
                    await job_service.update_job(job_id, {"status": "error", "error_message": str(e)})
                except Exception:
                    pass
                # 예외 시에도 UI가 무한 로딩이 되지 않도록 상태 기록(베스트 에포트)
                try:
                    await redis_client.setex(f"extract:status:{story_id}", 60, "error")
                except Exception:
                    pass

    asyncio.create_task(run_job())

    return {"job_id": job_id, "status": "queued"}


@router.get("/extracted-characters/jobs/{job_id}")
async def get_extracted_characters_job_status(job_id: str, job_service: JobService = Depends(get_job_service)):
    job = await job_service.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


@router.post("/extracted-characters/jobs/{job_id}/cancel")
async def cancel_extracted_characters_job(
    job_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user_optional),
    job_service: JobService = Depends(get_job_service),
):
    """
    ✅ 추출 Job 중지(취소)

    요구사항:
    - "중지"를 누르면 즉시 취소되고 잔여물이 남지 않아야 한다.
    구현:
    - JobService에 cancelled 플래그를 즉시 기록한다.
    - Job 메타에서 story_id를 얻어, Redis 상태(extract:status)를 'cancelled'로 즉시 갱신한다.
    - 부분 생성 잔여물이 있을 수 있으므로, 가능하면 즉시 cleanup(파생 Character/채팅방/그리드 레코드)을 수행한다.
      (worker도 다음 체크 포인트에서 동일 cleanup을 수행하므로, 이 로직은 idempotent를 전제로 한다.)
    """
    state = await job_service.cancel_job(job_id)
    if not state:
        raise HTTPException(status_code=404, detail="Job not found")

    # story_id 추출(가능한 경우)
    story_id_raw = state.get("story_id")
    sid: Optional[uuid.UUID] = None
    try:
        if story_id_raw:
            sid = story_id_raw if isinstance(story_id_raw, uuid.UUID) else uuid.UUID(str(story_id_raw))
    except Exception:
        sid = None

    # 권한 확인(가능한 경우)
    if sid:
        try:
            story = await story_service.get_story_by_id(db, sid)
        except Exception:
            story = None
        if story:
            if not current_user:
                raise HTTPException(status_code=403, detail="로그인이 필요합니다")
            is_owner_or_admin = bool(
                story.creator_id == current_user.id or getattr(current_user, "is_admin", False)
            )
            if not is_owner_or_admin:
                raise HTTPException(status_code=403, detail="중지 권한이 없습니다")

    # UI 즉시 반영: Redis 상태를 cancelled로 설정
    if sid:
        try:
            await redis_client.setex(f"extract:status:{sid}", 60, "cancelled")
        except Exception:
            pass

    # 잔여물 즉시 정리(베스트 에포트)
    summary = None
    if sid:
        try:
            summary = await _cleanup_origchat_entities_for_story(db, sid)
        except Exception:
            summary = None

    # cleanup 과정에서 extract:status 키가 삭제될 수 있으므로, UI 반영을 위해 한 번 더 세팅(방어)
    if sid:
        try:
            await redis_client.setex(f"extract:status:{sid}", 60, "cancelled")
        except Exception:
            pass

    return {"message": "cancelled", "summary": summary}


@router.post("/{story_id}/comments", response_model=StoryCommentResponse, status_code=status.HTTP_201_CREATED)
async def create_story_comment_endpoint(
    story_id: uuid.UUID,
    comment_data: CommentCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """스토리에 댓글 작성"""
    story = await story_service.get_story_by_id(db, story_id)
    if not story:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="스토리를 찾을 수 없습니다."
        )
    
    # 비공개 스토리는 작성자만 댓글 작성 가능
    if not story.is_public and story.creator_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="비공개 스토리에는 댓글을 작성할 수 없습니다."
        )
    
    comment = await create_story_comment(db, story_id, current_user.id, comment_data)
    return comment


@router.get("/{story_id}/comments", response_model=List[StoryCommentWithUser])
async def get_story_comments_endpoint(
    story_id: uuid.UUID,
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user_optional)
):
    """스토리 댓글 목록 조회"""
    story = await story_service.get_story_by_id(db, story_id)
    if not story:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="스토리를 찾을 수 없습니다."
        )
    
    # 비공개 스토리는 작성자/관리자만 댓글 조회 가능
    if not story.is_public and (
        (not current_user)
        or (story.creator_id != current_user.id and not getattr(current_user, "is_admin", False))
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="접근 권한이 없습니다."
        )
    
    comments = await get_story_comments(db, story_id, skip, limit)
    
    # StoryCommentWithUser 형식으로 변환
    comments_with_user = []
    for comment in comments:
        comment_dict = StoryCommentResponse.from_orm(comment).model_dump()
        comment_dict["username"] = comment.user.username
        comment_dict["user_avatar_url"] = getattr(comment.user, "avatar_url", None)
        comments_with_user.append(StoryCommentWithUser(**comment_dict))
    
    return comments_with_user


@router.put("/comments/{comment_id}", response_model=StoryCommentResponse)
async def update_story_comment_endpoint(
    comment_id: uuid.UUID,
    comment_data: CommentUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """스토리 댓글 수정"""
    comment = await get_story_comment_by_id(db, comment_id)
    if not comment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="댓글을 찾을 수 없습니다."
        )
    
    # 작성자만 수정 가능
    if comment.user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="이 댓글을 수정할 권한이 없습니다."
        )
    
    updated_comment = await update_story_comment(db, comment_id, comment_data)
    return updated_comment


@router.delete("/comments/{comment_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_story_comment_endpoint(
    comment_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """스토리 댓글 삭제"""
    comment = await get_story_comment_by_id(db, comment_id)
    if not comment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="댓글을 찾을 수 없습니다."
        )
    
    # 작성자만 삭제 가능
    if comment.user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="이 댓글을 삭제할 권한이 없습니다."
        )
    
    await delete_story_comment(db, comment_id)




@router.get("/{story_id}/episodes")
async def get_story_episodes(
    story_id: str,
    db: AsyncSession = Depends(get_db)
):
    """스토리의 에피소드 목록 조회"""
    from app.models.episode import Episode
    from sqlalchemy import select
    
    try:
        result = await db.execute(
            select(Episode)
            .where(Episode.story_id == story_id)
            .order_by(Episode.episode_number.asc())
        )
        episodes = result.scalars().all()
        
        return [
            {
                "id": str(ep.id),
                "episode_number": ep.episode_number,
                "title": ep.title,
                "content": ep.content,
                "view_count": ep.view_count or 0,
                "created_at": ep.created_at.isoformat() if ep.created_at else None
            }
            for ep in episodes
        ]
    except Exception as e:
        import logging
        logging.error(f"Get episodes error: {e}")
        raise HTTPException(status_code=500, detail=str(e))






@router.post("/episodes/{episode_id}/view")
async def increment_episode_view(
    episode_id: str,
    db: AsyncSession = Depends(get_db)
):
    """에피소드 조회수 증가"""
    from app.models.episode import Episode
    from sqlalchemy import select
    
    try:
        result = await db.execute(
            select(Episode).where(Episode.id == episode_id)
        )
        episode = result.scalar_one_or_none()
        
        if not episode:
            return {"success": False, "message": "Episode not found"}
        
        # 조회수 증가
        episode.view_count = (episode.view_count or 0) + 1
        await db.commit()
        await db.refresh(episode)
        
        return {
            "success": True,
            "view_count": episode.view_count
        }
    except Exception as e:
        await db.rollback()
        import logging
        logging.error(f"Episode view count error: {e}")
        return {"success": False, "message": str(e)}