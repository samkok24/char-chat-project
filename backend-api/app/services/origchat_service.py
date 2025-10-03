"""
원작챗 오케스트레이션(스텁)
- Director/Actor/Guard 실제 구현 전, 최소 동작을 위한 컨텍스트/턴 생성기
"""
from typing import Optional, Dict, Any, List, Tuple
from app.core.config import settings
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, update
import uuid

from app.models.story import Story
from app.models.story_chapter import StoryChapter
from app.models.story_summary import StoryEpisodeSummary
from app.models.story_extracted_character import StoryExtractedCharacter
from app.models.character import Character
import math
from typing import Iterable


async def build_context_pack(db: AsyncSession, story_id, anchor: int, character_id: Optional[str] = None) -> Dict[str, Any]:
    # Redis 캐시 우선
    try:
        from app.core.database import redis_client
        # summary_version에 따라 캐시 키 버전을 올려 무효화 유도
        ver_res = await db.execute(select(Story.summary_version).where(Story.id == story_id))
        ver_row = ver_res.first()
        ver = (ver_row[0] if ver_row else 1) or 1
        cache_key = f"ctx:pack:{story_id}:{anchor}:v{ver}"
        if settings.ORIGCHAT_V2:
            cached = await redis_client.get(cache_key)
            if cached:
                import json
                return json.loads(cached)
    except Exception:
        pass
    # 총 회차 수 계산
    total_chapters = await db.scalar(
        select(func.max(StoryChapter.no)).where(StoryChapter.story_id == story_id)
    ) or anchor

    # 요약 테이블에서 누적 요약/발췌 우선 조회
    anchor_excerpt = None
    cumulative_summary = None
    s = await db.execute(
        select(StoryEpisodeSummary.short_brief, StoryEpisodeSummary.anchor_excerpt, StoryEpisodeSummary.cumulative_summary)
        .where(StoryEpisodeSummary.story_id == story_id, StoryEpisodeSummary.no == anchor)
    )
    srow = s.first()
    if srow:
        anchor_excerpt = srow[1] or None
        cumulative_summary = srow[2] or None
    if anchor_excerpt is None:
        res = await db.execute(
            select(StoryChapter.content).where(
                StoryChapter.story_id == story_id, StoryChapter.no == anchor
            )
        )
        row = res.first()
        if row and row[0]:
            anchor_excerpt = (row[0] or "")[:600]

    actor_context = {
        "anchor": anchor,
        "cumulative_summary": cumulative_summary,
        "anchor_excerpt": anchor_excerpt,
        "trust": None,
        "affinity": None,
        "tension": None,
    }

    director_context = {
        "total_chapters": int(total_chapters),
        "allowed_foreshadows": [],
        "forbidden_reveals_gt_anchor": [],
    }

    guard = {"no_spoiler_after": anchor}

    pack = {
        "actor_context": actor_context,
        "director_context": director_context,
        "guard": guard,
        "initial_choices": propose_choices_from_anchor(anchor_excerpt, cumulative_summary),
    }
    try:
        if settings.ORIGCHAT_V2:
            from app.core.database import redis_client
            import json
            await redis_client.setex(cache_key, 600, json.dumps(pack, ensure_ascii=False))
    except Exception:
        pass
    return pack




# --- 캐릭터 자동 보강(성격/말투/인사/세계관/배경) ---
async def _enrich_character_fields(
    db: AsyncSession,
    character: Character,
    combined_context: str,
    *,
    model: str = "claude",
    sub_model: str = "claude-3-5-sonnet-20241022",
) -> None:
    """회차 텍스트 컨텍스트를 바탕으로 캐릭터 필드를 LLM으로 보강한다.
    실패해도 조용히 무시한다(서비스 지속성 우선).
    """
    try:
        from app.services.ai_service import get_ai_chat_response
        import json

        prompt = (
            "당신은 스토리에서 특정 등장인물의 캐릭터 시트를 작성하는 전문가입니다.\n"
            "아래 작품 발췌(다수 회차를 연결한 텍스트)에서 인물의 말투/성격/세계관 맥락을 추론해 필드를 채우세요.\n"
            "JSON만 출력하세요. 스키마는 다음과 같습니다.\n"
            "{\"personality\": string, \"speech_style\": string, \"greeting\": string, \"world_setting\": string, \"background_story\": string}\n"
            "제약:\n- 모든 텍스트는 한국어로 작성\n- greeting은 1~2문장, 말투 반영\n- background_story는 스포일러/향후 전개 금지, 현 시점 특징 요약\n- 허위 설정 금지, 텍스트에 근거\n"
            f"대상 캐릭터명: {character.name}\n"
            "[작품 발췌]\n"
            f"{combined_context[:12000]}"
        )

        text = await get_ai_chat_response(
            character_prompt=prompt,
            user_message="캐릭터 시트를 JSON으로만 출력하세요.",
            history=[],
            preferred_model=model,
            preferred_sub_model=sub_model,
            response_length_pref="short",
        )

        text = (text or "").strip()
        start = text.find('{'); end = text.rfind('}')
        data = None
        if start != -1 and end != -1 and end > start:
            try:
                data = json.loads(text[start:end+1])
            except Exception:
                data = None
        if not data or not isinstance(data, dict):
            return

        def _clip(v: Optional[str], n: int) -> Optional[str]:
            if not v:
                return None
            s = str(v).strip()
            return s[:n] if s else None

        # 필드 보강(존재할 때만 갱신)
        personality = _clip(data.get("personality"), 1200)
        speech_style = _clip(data.get("speech_style"), 800)
        greeting = _clip(data.get("greeting"), 500)
        world_setting = _clip(data.get("world_setting"), 2000)
        background_story = _clip(data.get("background_story"), 3000)

        updated = False
        if personality and personality != (character.personality or ""):
            character.personality = personality; updated = True
        if speech_style and speech_style != (character.speech_style or ""):
            character.speech_style = speech_style; updated = True
        if greeting and greeting != (character.greeting or ""):
            character.greeting = greeting; updated = True
        if world_setting and world_setting != (character.world_setting or ""):
            character.world_setting = world_setting; updated = True
        if background_story and background_story != (character.background_story or ""):
            character.background_story = background_story; updated = True

        if updated:
            try:
                await db.commit()
            except Exception:
                await db.rollback()
    except Exception:
        # 보강 실패는 무시(로그는 상위에서 처리하거나 추후 추가)
        return


def simple_delta_from_text(user_text: str) -> Dict[str, int]:
    pos_terms = ["고마워", "좋아", "믿어", "신뢰", "응원", "도와", "기뻐"]
    neg_terms = ["싫어", "거짓", "의심", "배신", "화가", "짜증", "불신"]
    trust_delta = affinity_delta = tension_delta = 0
    for t in pos_terms:
        if t in user_text:
            trust_delta += 2
            affinity_delta += 2
            tension_delta -= 1
    for t in neg_terms:
        if t in user_text:
            trust_delta -= 2
            affinity_delta -= 1
            tension_delta += 2
    return {"trust": trust_delta, "affinity": affinity_delta, "tension": tension_delta}


def compute_branch_score_from_text(text: str) -> float:
    """간단 분기 점수: 물음표/생략부호/어휘 다양성 기반 휴리스틱."""
    if not text:
        return 0.0
    t = str(text)
    qm = t.count('?')
    dots = 1 if ('…' in t or '...' in t) else 0
    grams = extract_top_ngrams(t, (1, 2))
    diversity = min(4, max(0, len(grams)//5))
    return float(qm + dots + diversity)


async def warm_context_basics(db: AsyncSession, story_id, anchor: int) -> List[str]:
    """비스포일러 컨텍스트 기본 세트 캐시: world_bible/personas/timeline_digest.
    간이 버전으로 Redis에 저장한다.
    """
    updated: List[str] = []
    try:
        from app.core.database import redis_client
        # world_bible: 누적 요약 일부
        wb = None
        try:
            row = await db.execute(
                select(StoryEpisodeSummary.cumulative_summary)
                .where(StoryEpisodeSummary.story_id == story_id, StoryEpisodeSummary.no == int(anchor or 1))
            )
            wb = ((row.first() or [None])[0] or '')[:1200]
        except Exception:
            wb = None
        if wb:
            await redis_client.setex(f"ctx:warm:{story_id}:world_bible", 3600, wb)
            updated.append('world_bible')

        # personas: 추출 캐릭터 요약
        personas: List[Dict[str, str]] = []
        try:
            rows = await db.execute(
                select(StoryExtractedCharacter.name, StoryExtractedCharacter.description)
                .where(StoryExtractedCharacter.story_id == story_id)
                .order_by(StoryExtractedCharacter.order_index)
                .limit(6)
            )
            for n, d in rows.all():
                n2 = (n or '').strip()
                d2 = (d or '').strip()[:80]
                if n2:
                    personas.append({"name": n2, "desc": d2})
        except Exception:
            personas = []
        if personas:
            import json as _json
            await redis_client.setex(
                f"ctx:warm:{story_id}:personas", 3600, _json.dumps(personas, ensure_ascii=False)
            )
            updated.append('personas')

        # timeline_digest: 간단 범위 메타
        td = {"from": 1, "to": int(anchor or 1)}
        import json as _json
        await redis_client.setex(
            f"ctx:warm:{story_id}:timeline_digest", 3600, _json.dumps(td)
        )
        updated.append('timeline_digest')

        return updated
    except Exception:
        return updated


async def detect_style_profile(
    db: AsyncSession,
    story_id,
    *,
    upto_anchor: int,
    max_chars: int = 8000,
) -> Dict[str, Any]:
    """LLM으로 원작 문체 프로파일을 감지하고 간결한 스타일 프롬프트를 생성한다.
    반환: { profile: {...}, style_prompt: str } (실패 시 빈 dict)
    """
    try:
        # 텍스트 수집
        rows = await db.execute(
            select(StoryChapter.no, StoryChapter.content)
            .where(StoryChapter.story_id == story_id, StoryChapter.no <= int(upto_anchor or 1))
            .order_by(StoryChapter.no.asc())
            .limit(30)
        )
        texts: List[str] = []
        total = 0
        for no, content in rows.all():
            seg = (content or '').strip()
            if not seg:
                continue
            remain = max_chars - total
            if remain <= 0:
                break
            piece = seg[:remain]
            texts.append(piece)
            total += len(piece)
        if not texts:
            return {}
        corpus = ("\n\n".join(texts))[:max_chars]

        from app.services.ai_service import get_ai_chat_response
        import json as _json
        system = (
            "당신은 문체 분석 전문가입니다. 주어진 한국어 소설 발췌의 문체를 분석해 JSON으로만 출력하세요.\n"
            "스키마: {\"narration_pov\": string, \"pacing\": string, \"formality\": string, \"dialogue_ratio\": string, \"sentence_length\": string, \"tone\": string, \"devices\": [string], \"genre_signals\": [string], \"diction\": [string], \"style_prompt\": string, \"negative_rules\": [string]}\n"
            "제약: style_prompt는 8~12줄의 구체적 지침으로, 표현 방식/리듬/대사 비율/어휘 결을 요약. 표절 금지/직접 인용 회피 포함."
        )
        user = "[분석 대상 발췌]\n" + corpus
        raw = await get_ai_chat_response(
            character_prompt=system,
            user_message=user,
            history=[],
            preferred_model="claude",
            preferred_sub_model="claude-3-5-sonnet-20241022",
            response_length_pref="short",
        )
        txt = (raw or '').strip()
        s = txt.find('{'); e = txt.rfind('}')
        data = None
        if s != -1 and e != -1 and e > s:
            try:
                data = _json.loads(txt[s:e+1])
            except Exception:
                data = None
        if not isinstance(data, dict):
            return {}
        profile = {k: v for k, v in data.items() if k != 'style_prompt'}
        style_prompt = (data.get('style_prompt') or '').strip()
        # 캐시 저장
        try:
            from app.core.database import redis_client
            await redis_client.setex(
                f"ctx:warm:{story_id}:style_profile", 3600, _json.dumps(profile, ensure_ascii=False)
            )
            if style_prompt:
                await redis_client.setex(
                    f"ctx:warm:{story_id}:style_prompt", 3600, style_prompt[:1200]
                )
        except Exception:
            pass
        return {"profile": profile, "style_prompt": style_prompt}
    except Exception:
        return {}


async def recommend_next_chapter(db: AsyncSession, story_id, anchor: int) -> Optional[int]:
    max_no = await db.scalar(select(func.max(StoryChapter.no)).where(StoryChapter.story_id == story_id))
    if not max_no:
        return None
    return anchor + 1 if anchor + 1 <= max_no else anchor


# ---- 증분 요약/업서트 ----
async def upsert_episode_summary_for_chapter(
    db: AsyncSession,
    story_id,
    no: int,
    content: str,
    *,
    max_brief_len: int = 400,
    max_excerpt_len: int = 600,
    max_cum_len: int = 2000,
) -> None:
    """해당 회차의 short_brief/anchor_excerpt/cumulative_summary를 증분 갱신한다.
    - 누적 요약은 (no-1)의 cumulative_summary + 이번 short_brief를 길이 제한으로 압축한다.
    """
    if content is None:
        content = ""
    short_brief = (content[:max_brief_len]).strip()
    anchor_excerpt = (content[:max_excerpt_len]).strip()

    # 이전 누적 요약 가져오기
    prev_cum = None
    if no > 1:
        prev = await db.execute(
            select(StoryEpisodeSummary.cumulative_summary)
            .where(StoryEpisodeSummary.story_id == story_id, StoryEpisodeSummary.no == no - 1)
        )
        prow = prev.first()
        prev_cum = (prow[0] if prow else None) or ""

    if prev_cum:
        merged = (prev_cum + "\n" + short_brief).strip()
    else:
        merged = short_brief

    # 단순 길이 제한 압축(단어 경계 고려 없이 우측 자름)
    if merged and len(merged) > max_cum_len:
        merged = merged[:max_cum_len]

    # 업서트
    existing = await db.execute(
        select(StoryEpisodeSummary).where(StoryEpisodeSummary.story_id == story_id, StoryEpisodeSummary.no == no)
    )
    row = existing.scalar_one_or_none()
    if row:
        row.short_brief = short_brief
        row.anchor_excerpt = anchor_excerpt
        row.cumulative_summary = merged
    else:
        row = StoryEpisodeSummary(
            story_id=story_id,
            no=no,
            short_brief=short_brief,
            anchor_excerpt=anchor_excerpt,
            cumulative_summary=merged,
        )
        db.add(row)
    await db.commit()


async def _llm_summarize(text: str, *, max_chars: int = 300) -> str:
    """LLM로 장면 요약(스포일러 금지, 고유명 유지). 실패 시 앞부분 절취."""
    try:
        from app.services.ai_service import get_ai_chat_response
        system = (
            "당신은 한국어 소설 편집자입니다. 아래 본문을 스포일러 없이 해당 회차 범위 내에서만 2~4문장으로 요약하세요.\n"
            f"총 {max_chars}자 이내, 고유명/관계/사건의 핵심만 유지, 평가나 해설 금지."
        )
        user = (text or "").strip()
        raw = await get_ai_chat_response(
            character_prompt=system,
            user_message=user[:6000],
            history=[],
            preferred_model="claude",
            preferred_sub_model="claude-3-5-sonnet-20241022",
            response_length_pref="short",
        )
        s = (raw or "").strip()
        if not s:
            return (user[:max_chars]).strip()
        # 하드 컷
        return s[:max_chars]
    except Exception:
        return (text or "")[:max_chars]


async def ensure_episode_summaries(
    db: AsyncSession,
    story_id,
    *,
    upto_anchor: int | None = None,
    max_episodes: int = 12,
    start_no: int | None = None,
    end_no: int | None = None,
) -> int:
    """회차 구간에 대해 LLM 요약을 보장한다. 이미 있으면 건너뜀.
    반환: 새로 생성/갱신한 회차 수
    """
    try:
        if start_no is None or end_no is None:
            upto = int(upto_anchor or 1)
            # 기본: 최근 max_episodes 윈도우
            s = max(1, upto - max_episodes + 1)
            e = upto
        else:
            s = max(1, int(start_no))
            e = max(int(s), int(end_no))
        # 미리 기존 요약 맵
        rows = await db.execute(
            select(StoryEpisodeSummary.no).where(StoryEpisodeSummary.story_id == story_id, StoryEpisodeSummary.no >= s, StoryEpisodeSummary.no <= e)
        )
        existing = {int(n) for (n,) in rows.all()}
        updated = 0
        # 이전 누적 요약 참조용 캐시
        prev_cum_map: dict[int, str] = {}
        if s > 1:
            row_prev = await db.execute(
                select(StoryEpisodeSummary.no, StoryEpisodeSummary.cumulative_summary)
                .where(StoryEpisodeSummary.story_id == story_id, StoryEpisodeSummary.no >= s - 1, StoryEpisodeSummary.no <= e - 1)
                .order_by(StoryEpisodeSummary.no.asc())
            )
            for no, cum in row_prev.all():
                prev_cum_map[int(no)] = (cum or "")

        for no in range(s, e + 1):
            # 본문 로드
            r = await db.execute(select(StoryChapter.title, StoryChapter.content).where(StoryChapter.story_id == story_id, StoryChapter.no == no))
            row = r.first()
            content = ((row[1] if row else None) or "").strip()
            if not content:
                continue
            brief = await _llm_summarize(content, max_chars=300)
            anchor_excerpt = content[:600]
            # 누적 요약 계산
            prev_cum = prev_cum_map.get(no - 1, "")
            merged = (prev_cum + ("\n" if prev_cum else "") + brief).strip()
            if merged and len(merged) > 2000:
                merged = merged[:2000]
            # upsert
            exist = await db.execute(select(StoryEpisodeSummary).where(StoryEpisodeSummary.story_id == story_id, StoryEpisodeSummary.no == no))
            rec = exist.scalar_one_or_none()
            if rec:
                # 이미 있고 내용이 동일하면 스킵
                if (rec.short_brief or "").strip() == brief.strip() and (rec.anchor_excerpt or "").strip() == anchor_excerpt.strip():
                    prev_cum_map[no] = rec.cumulative_summary or merged
                    continue
                rec.short_brief = brief
                rec.anchor_excerpt = anchor_excerpt
                rec.cumulative_summary = merged
            else:
                rec = StoryEpisodeSummary(
                    story_id=story_id,
                    no=no,
                    short_brief=brief,
                    anchor_excerpt=anchor_excerpt,
                    cumulative_summary=merged,
                )
                db.add(rec)
            try:
                await db.commit()
                updated += 1
            except Exception:
                await db.rollback()
            prev_cum_map[no] = merged
        return updated
    except Exception:
        return 0


# ---- Director 보조: 앵커 텍스트 기반 선택지 후보 생성 ----
def extract_top_ngrams(text: str, n_values: Tuple[int, ...] = (1, 2)) -> List[str]:
    if not text:
        return []
    import re
    # 간단 토큰화: 한글/숫자/영문 연속을 단어로 취급
    tokens = re.findall(r"[\w가-힣]+", text)
    tokens = [t for t in tokens if len(t) >= 1]
    ngrams: List[str] = []
    for n in n_values:
        for i in range(len(tokens) - n + 1):
            ngrams.append(" ".join(tokens[i:i+n]))
    # 빈도 상위 반환
    from collections import Counter
    cnt = Counter(ngrams)
    # 너무 일반적인 단어 제거(간단 스톱워드)
    stop = {"그리고", "그러나", "하지만", "그래서", "나는", "그는", "그녀는", "합니다", "했다"}
    items = [(k, v) for k, v in cnt.most_common(100) if k not in stop]
    return [k for k, _ in items[:20]]


def propose_choices_from_anchor(anchor_excerpt: Optional[str], cumulative_summary: Optional[str]) -> List[Dict[str, str]]:
    base_text = (anchor_excerpt or "").strip()
    if not base_text and cumulative_summary:
        base_text = cumulative_summary[:600]
    if not base_text:
        # 폴백 기본 3개
        return [
            {"id": "probe_detail", "label": "자세한 단서를 더 살핀다"},
            {"id": "ask_direct", "label": "상대에게 직접 물어본다"},
            {"id": "change_topic", "label": "대화를 다른 주제로 돌린다"},
        ]
    grams = extract_top_ngrams(base_text, (1, 2))
    # 동사형 템플릿 간단 매핑(장르 불문 기본)
    templates = [
        "{kw}에 대해 더 파고든다",
        "{kw}을(를) 확인한다",
        "{kw}로 화제를 전환한다",
        "{kw}을(를) 의심한다",
        "{kw}에게 도움을 청한다",
    ]
    # 상위 키워드 3개에 대해 자연스러운 선택지 생성
    top = grams[:3] if len(grams) >= 3 else (grams + ["상황"] * (3 - len(grams)))
    out: List[Dict[str, str]] = []
    used: set = set()
    idx = 0
    for kw in top:
        # 템플릿 순환 적용
        for _ in range(5):
            t = templates[idx % len(templates)]
            idx += 1
            label = t.format(kw=kw)
            if label in used:
                continue
            used.add(label)
            out.append({"id": f"kw_{kw}_{idx}", "label": label[:20]})
            break
    # 보정: 정확히 3개 보장
    while len(out) < 3:
        out.append({"id": f"fill_{len(out)}", "label": "상황을 더 관찰한다"})
    return out[:3]


async def generate_what_if_seeds(
    db: AsyncSession,
    story_id,
    *,
    anchor: int,
    num_seeds: int = 3,
) -> List[Dict[str, str]]:
    """평행세계용 what-if 씨앗을 LLM으로 생성. 실패 시 앵커 텍스트 기반 휴리스틱으로 대체.
    반환: [{id,label}] 형식
    """
    # 앵커 텍스트 확보
    anchor_excerpt = None
    cumulative_summary = None
    try:
        s = await db.execute(
            select(StoryEpisodeSummary.short_brief, StoryEpisodeSummary.anchor_excerpt, StoryEpisodeSummary.cumulative_summary)
            .where(StoryEpisodeSummary.story_id == story_id, StoryEpisodeSummary.no == int(anchor or 1))
        )
        row = s.first()
        if row:
            anchor_excerpt = row[1] or None
            cumulative_summary = row[2] or None
    except Exception:
        pass
    if not anchor_excerpt:
        try:
            r = await db.execute(
                select(StoryChapter.content)
                .where(StoryChapter.story_id == story_id, StoryChapter.no == int(anchor or 1))
            )
            rr = r.first()
            if rr and rr[0]:
                anchor_excerpt = (rr[0] or '')[:600]
        except Exception:
            anchor_excerpt = None

    # LLM 요청
    try:
        from app.services.ai_service import get_ai_chat_response
        import json as _json
        system = (
            "당신은 한국어 장르/웹소설 플롯 디자이너입니다.\n"
            "주어진 세계관/앵커 상황을 바탕으로 스포일러 없이 평행세계용 what-if 씨앗 3개를 생성하세요.\n"
            "규칙: 각 항목은 20자 내외 한국어 한 문장, 간결·행동 유발형, 고유명 최소화, 세계관/인물 일관성 유지, 후속 전개 여지 제공.\n"
            "JSON만 출력. 스키마: {\"seeds\":[{\"label\":string}]}"
        )
        context = (anchor_excerpt or cumulative_summary or '')
        user = (
            f"[앵커 상황]\n{context}\n\n"
            f"[금지]\n스포일러, 타작품 차용, 세계관 붕괴, 무의미한 선택\n"
        )
        raw = await get_ai_chat_response(
            character_prompt=system,
            user_message=user,
            history=[],
            preferred_model="claude",
            preferred_sub_model="claude-3-5-sonnet-20241022",
            response_length_pref="short",
        )
        txt = (raw or '').strip()
        s = txt.find('{'); e = txt.rfind('}')
        data = None
        if s != -1 and e != -1 and e > s:
            try:
                data = _json.loads(txt[s:e+1])
            except Exception:
                data = None
        items: List[Dict[str,str]] = []
        if isinstance(data, dict) and isinstance(data.get('seeds'), list):
            for i, it in enumerate(data['seeds'][:num_seeds]):
                lab = str((it or {}).get('label') or '').strip()
                if lab:
                    items.append({"id": f"seed_{i+1}", "label": lab[:40]})
        if items:
            return items
    except Exception:
        pass

    # 휴리스틱 폴백: 기존 키워드 기반에서 변주형 템플릿으로 생성
    grams = extract_top_ngrams((anchor_excerpt or cumulative_summary or '')[:600], (1, 2))
    base = grams[:3] if len(grams) >= 3 else (grams + ["상황"] * (3 - len(grams)))
    tmpl = [
        "{kw}을(를) 다른 선택으로 비틀어 본다",
        "{kw} 대신 뜻밖의 인물이 개입한다",
        "{kw}의 숨은 조건이 드러난다",
    ]
    out: List[Dict[str,str]] = []
    for i, kw in enumerate(base[:num_seeds]):
        t = tmpl[i % len(tmpl)]
        out.append({"id": f"seed_{i+1}", "label": t.format(kw=kw)[:40]})
    while len(out) < num_seeds:
        out.append({"id": f"seed_{len(out)+1}", "label": "뜻밖의 변수로 국면 전환"})
    return out[:num_seeds]


async def generate_backward_weighted_recap(
    db: AsyncSession,
    story_id,
    *,
    anchor: int,
    tau: float = 1.2,
    max_episodes: int = 20,
    max_chars: int = 1200,
) -> str:
    """역진가중 리캡: 앵커까지의 최근 회차 short_brief를 최근일수록 더 큰 가중으로 압축.
    - 단순 구현: 최근 max_episodes 회차의 short_brief를 최신→과거 순으로 붙이고, 총 길이 제한.
    - tau는 추후 세밀한 비율 조정에 활용(현 버전은 순서 중심).
    """
    try:
        rows = await db.execute(
            select(StoryEpisodeSummary.no, StoryEpisodeSummary.short_brief)
            .where(StoryEpisodeSummary.story_id == story_id, StoryEpisodeSummary.no < int(anchor or 1))
            .order_by(StoryEpisodeSummary.no.desc())
            .limit(max_episodes)
        )
        episodes = rows.all()
        # 가중치 계산: 최신일수록 큰 비중
        weights: List[float] = []
        for idx, _ in enumerate(episodes):
            w = 1.0 / ((idx + 1) ** max(0.1, float(tau)))
            weights.append(w)
        W = sum(weights) or 1.0
        quotas: List[int] = [max(40, int((w / W) * max_chars)) for w in weights]
        lines: List[str] = []
        used = 0
        for (no, brief), q in zip(episodes, quotas):
            seg = (brief or '').strip()
            if not seg:
                continue
            text = seg[: max(1, q - 10)]
            line = f"{int(no)}화: {text}"
            if used + len(line) + 1 > max_chars:
                break
            lines.append(line)
            used += len(line) + 1
        if not lines:
            # brief가 없으면 챕터 본문으로 폴백
            row2 = await db.execute(
                select(StoryChapter.no, StoryChapter.content)
                .where(StoryChapter.story_id == story_id, StoryChapter.no < int(anchor or 1))
                .order_by(StoryChapter.no.desc())
                .limit(5)
            )
            chunks = []
            t = 0
            for no, content in row2.all():
                seg = (content or '').strip()[:200]
                if not seg:
                    continue
                sline = f"{int(no)}화: {seg}"
                if t + len(sline) + 1 > max_chars:
                    break
                chunks.append(sline)
                t += len(sline) + 1
            return "\n".join(chunks)
        return "\n".join(lines)
    except Exception:
        return ""


async def get_scene_anchor_text(
    db: AsyncSession,
    story_id,
    *,
    chapter_no: int,
    scene_id: str | None,
    max_len: int = 600,
) -> str:
    """start.scene_id 형태(auto-{no}-{i})를 해석해 해당 챕터의 근사 장면 텍스트를 반환한다."""
    try:
        row = await db.execute(
            select(StoryChapter.content)
            .where(StoryChapter.story_id == story_id, StoryChapter.no == int(chapter_no or 1))
        )
        content = (row.first() or [None])[0] or ""
        content = str(content)
        if not content:
            return ""
        if not scene_id or not scene_id.startswith("auto-"):
            return content[:max_len]
        try:
            parts = scene_id.split("-")
            # auto-{no}-{i}
            idx = int(parts[-1])
        except Exception:
            idx = 0
        seg_len = max(1, math.ceil(len(content) / 3))
        start = max(0, idx * seg_len)
        excerpt = content[start : start + seg_len]
        return excerpt[:max_len]
    except Exception:
        return ""


async def enforce_character_consistency(
    ai_text: str,
    *,
    focus_name: str | None = None,
    persona: str | None = None,
    speech_style: str | None = None,
    style_prompt: str | None = None,
    world_bible: str | None = None,
) -> str:
    """AI 응답을 인물/세계관/문체 일관성에 맞게 미세 재작성한다. 실패 시 원문 반환."""
    try:
        from app.services.ai_service import get_ai_chat_response
        guards = [
            "인물 일관성 유지(Out-of-Character 금지)",
            "세계관/설정 모순 금지",
            "말투·어휘 결 유지",
            "내용 왜곡 없이 표현만 조정",
        ]
        sys_lines = [
            "당신은 한국어 소설 대사/지문 편집자입니다.",
            "주어진 응답을 인물/세계관/문체 일관성에 맞게 가볍게 재작성하세요.",
            "출력은 순수 본문만(메타/주석 금지).",
            "규칙: " + "; ".join(guards),
        ]
        if style_prompt:
            sys_lines.append("[문체 지침]\n" + style_prompt)
        if world_bible:
            sys_lines.append("[세계관]\n" + world_bible[:800])
        if focus_name or persona or speech_style:
            fb = []
            if focus_name:
                fb.append(f"시점 인물: {focus_name}")
            if persona:
                fb.append(f"성격/정서 결: {persona}")
            if speech_style:
                fb.append(f"대사 말투: {speech_style}")
            sys_lines.append("[시점 인물]\n" + " | ".join(fb))
        system = "\n".join(sys_lines)
        user = ai_text or ""
        refined = await get_ai_chat_response(
            character_prompt=system,
            user_message=user,
            history=[],
            preferred_model="claude",
            preferred_sub_model="claude-3-5-sonnet-20241022",
            response_length_pref="medium",
        )
        refined = (refined or "").strip()
        # 너무 짧거나 비어있으면 원문 유지
        if not refined or len(refined) < 5:
            return ai_text
        return refined
    except Exception:
        return ai_text


# ---- 스피커/대화 일관성 보조 ----
async def get_story_character_names(
    db: AsyncSession,
    story_id,
    *,
    limit: int = 8,
) -> List[str]:
    try:
        rows = await db.execute(
            select(StoryExtractedCharacter.name)
            .where(StoryExtractedCharacter.story_id == story_id)
            .order_by(StoryExtractedCharacter.order_index.asc())
            .limit(limit)
        )
        names = [(r[0] or '').strip() for r in rows.all()]
        return [n for n in names if n]
    except Exception:
        return []


async def normalize_dialogue_speakers(
    ai_text: str,
    *,
    allowed_names: List[str],
    focus_name: str | None = None,
    npc_limit: int = 2,
) -> str:
    try:
        if not ai_text or len(ai_text) < 5:
            return ai_text
        from app.services.ai_service import get_ai_chat_response
        allow_line = ", ".join(allowed_names[:8]) if allowed_names else "(없음)"
        sys = (
            "당신은 한국어 소설 대화 편집자입니다. 다음 본문에서 스피커 일관성이 어긋나는 부분만 미세 조정하세요.\n"
            "규칙:\n"
            "- 새로운 고유명(사람 이름) 도입 금지. 허용된 이름 외에는 일반화(그/그녀/상대 등)\n"
            "- 스피커 라벨을 추가하지 말 것. 따옴표 대사/지문만 자연스럽게 유지\n"
            "- focus 인물이 있다면 화법/지각을 우선 반영\n"
            "- 의미 왜곡 없이 표현만 조정\n"
        )
        if focus_name:
            sys += f"\n[focus]\n{focus_name}"
        sys += f"\n[허용 이름]\n{allow_line}"
        sys += f"\n[npc 제한]\n{int(npc_limit)}"
        refined = await get_ai_chat_response(
            character_prompt=sys,
            user_message=ai_text,
            history=[],
            preferred_model="claude",
            preferred_sub_model="claude-3-5-sonnet-20241022",
            response_length_pref="medium",
        )
        refined = (refined or '').strip()
        if not refined or len(refined) < 5:
            return ai_text
        return refined
    except Exception:
        return ai_text
# ---- 추출 캐릭터 보장(간이 스텁) ----
async def ensure_extracted_characters_for_story(db: AsyncSession, story_id) -> None:
    """스토리에 추출 캐릭터가 없고 회차가 존재하면 기본 3인을 생성한다(간이)."""
    try:
        # Redis 상태 저장: 진행 중
        try:
            from app.core.database import redis_client
            await redis_client.setex(f"extract:status:{story_id}", 180, "in_progress")
        except Exception:
            pass
        
        # 이미 존재하면 스킵
        rows = await db.execute(select(StoryExtractedCharacter.id).where(StoryExtractedCharacter.story_id == story_id).limit(1))
        if rows.first():
            try:
                from app.core.database import redis_client
                await redis_client.delete(f"extract:status:{story_id}")
            except Exception:
                pass
            return
        # 회차 존재 여부 확인
        has_ch = await db.scalar(select(StoryChapter.id).where(StoryChapter.story_id == story_id).limit(1))
        if not has_ch:
            try:
                from app.core.database import redis_client
                await redis_client.delete(f"extract:status:{story_id}")
            except Exception:
                pass
            return
        # 1차: LLM 기반 자동 추출 시도
        created = await extract_characters_from_story(db, story_id)
        if created and created > 0:
            # Redis 상태: 완료
            try:
                from app.core.database import redis_client
                await redis_client.setex(f"extract:status:{story_id}", 60, "completed")
            except Exception:
                pass
            # 추출 성공 시 스토리를 원작챗으로 플래그
            try:
                await db.execute(update(Story).where(Story.id == story_id).values(is_origchat=True))
                await db.commit()
            except Exception:
                await db.rollback()
            return
        
        # LLM 추출 실패 시: 기본 캐릭터 생성하지 않고 에러 상태로 표시
        try:
            from app.core.database import redis_client
            await redis_client.setex(f"extract:status:{story_id}", 300, "failed")
        except Exception:
            pass
        return
    except Exception:
        # Redis 상태: 실패
        try:
            from app.core.database import redis_client
            await redis_client.setex(f"extract:status:{story_id}", 60, "error")
        except Exception:
            pass
        # 실패는 치명적 아님
        pass


def _chunk_windows_from_chapters(chapters: List[Tuple[int, Optional[str], Optional[str]]], max_chars: int = 6000) -> List[str]:
    windows: List[str] = []
    buf: List[str] = []
    total = 0
    for no, title, content in chapters:
        seg = (content or "").strip()
        if not seg:
            continue
        head = f"[{no}화] {(title or '').strip()}\n"
        add_len = len(head) + len(seg) + 2
        if total + add_len > max_chars and buf:
            windows.append("\n\n".join(buf))
            buf = []
            total = 0
        buf.append(head + seg)
        total += add_len
    if buf:
        windows.append("\n\n".join(buf))
    return windows


def _norm_name(name: str) -> str:
    return (name or "").strip().lower()


async def extract_characters_from_story(db: AsyncSession, story_id, max_chapters: int | None = None) -> int:
    """LLM을 사용하여 스토리에서 주요 등장인물 3~5명을 추출해 영속화한다.
    - max_chapters가 None이면 모든 회차를 대상으로 한다.
    반환값: 생성된 캐릭터 수(0이면 실패/없음)
    """
    # 이미 존재하면 스킵
    existing = await db.execute(select(StoryExtractedCharacter.id).where(StoryExtractedCharacter.story_id == story_id).limit(1))
    if existing.first():
        return 0
    # 회차 텍스트 수집
    stmt = (
        select(StoryChapter.no, StoryChapter.title, StoryChapter.content)
        .where(StoryChapter.story_id == story_id)
        .order_by(StoryChapter.no.asc())
    )
    if isinstance(max_chapters, int) and max_chapters > 0:
        stmt = stmt.limit(max_chapters)
    rows = await db.execute(stmt)
    chapters = rows.all()
    if not chapters:
        return 0
    # 윈도우 슬라이싱으로 요약 추출(창 별로 후보 추출 후 집계)
    windows = _chunk_windows_from_chapters(chapters, max_chars=6000)
    if not windows:
        return 0

    from app.services.ai_service import get_ai_chat_response
    import json
    director_prompt = (
        "당신은 소설에서 등장인물을 추출하는 전문 분석가입니다. 다음 발췌들을 바탕으로 주요 등장인물 3~5명을 한국어로 추출하세요.\n"
        "반드시 작품 원문에서 사용하는 고유 이름(예: 김철수, 아린, 레이튼 등)을 사용하고, '주인공', '동료 A', '라이벌' 같은 일반명은 금지합니다.\n"
        "만약 1인칭 시점으로 이름이 드러나지 않는 주인공이라면 name은 '나'로 표기하고, description에는 화자의 특성/관계/직업 등 구체적 단서를 요약하세요.\n"
        "규칙:\n- JSON만 출력.\n- 스키마: {\"characters\": [{\"name\": string, \"description\": string}]}\n"
        "- description은 80자 이내로, 작품 맥락(역할/관계/직업/능력/갈등 축)을 구체적으로. 일반적인 문구 금지."
    )
    agg: Dict[str, Dict[str, Any]] = {}
    order_counter = 0
    for win in windows:
        try:
            raw = await get_ai_chat_response(
                character_prompt=director_prompt,
                user_message=win,
                history=[],
                preferred_model="claude",
                preferred_sub_model="claude-3-5-sonnet-20241022",
                response_length_pref="short",
            )
        except Exception:
            continue
        text = (raw or "").strip()
        start = text.find('{')
        end = text.rfind('}')
        data = None
        if start != -1 and end != -1 and end > start:
            try:
                data = json.loads(text[start:end+1])
            except Exception:
                data = None
        if not data or not isinstance(data.get('characters'), list):
            continue
        for ch in data['characters'][:5]:
            try:
                name = str(ch.get('name') or '').strip()
                if not name:
                    continue
                key = _norm_name(name)
                desc = str(ch.get('description') or '').strip()
                # 금지된 일반명 필터링
                if key in {"주인공","동료","동료 a","라이벌","적","안타고니스트","조연"}:
                    continue
                if key not in agg:
                    agg[key] = {"name": name, "initial": name[:1], "desc": desc[:100], "count": 1, "order": order_counter}
                    order_counter += 1
                else:
                    agg[key]["count"] += 1
                    # 더 길거나 정보가 많은 설명으로 업데이트
                    if desc and (len(desc) > len(agg[key]["desc"]) ):
                        agg[key]["desc"] = desc[:100]
            except Exception:
                continue

    # ---- 내러티브 1인칭('나') 별칭 병합(보수적) ----
    def _norm_name_for_cmp(name: str) -> str:
        return (name or "").lower().replace(" ", "").strip()

    if "나" in {v["name"] for v in agg.values()} or ("나" in agg):
        # 후보 목록에서 '나'를 제외한 고유명들
        candidate_names = [v["name"] for k, v in agg.items() if _norm_name_for_cmp(v["name"]) != _norm_name_for_cmp("나")]
        # LLM에 전체 컨텍스트를 주고 별칭 판단을 요청(증거기반 JSON)
        try:
            combined_for_alias = "\n\n".join(windows)
            if len(combined_for_alias) > 12000:
                combined_for_alias = combined_for_alias[:12000]
            alias_prompt = (
                "다음 작품 발췌에서 1인칭 화자 '나'가 아래 후보 이름들 중 한 명과 동일인인지 판별하세요.\n"
                "JSON만 출력하고, 스키마는 {\"alias_of\": string|null, \"confidence\": number, \"evidences\":[string]} 입니다.\n"
                "규칙: 근거가 충분하지 않으면 alias_of는 null, confidence는 0~1.0. 한국어로만 작성.\n"
                f"[후보] {json.dumps(candidate_names, ensure_ascii=False)}\n"
                "[발췌]\n" + combined_for_alias
            )
            alias_raw = await get_ai_chat_response(
                character_prompt=alias_prompt,
                user_message="JSON만 출력",
                history=[],
                preferred_model="claude",
                preferred_sub_model="claude-3-5-sonnet-20241022",
                response_length_pref="short",
            )
            alias_txt = (alias_raw or "").strip()
            s = alias_txt.find('{'); e = alias_txt.rfind('}')
            alias_data = None
            if s != -1 and e != -1 and e > s:
                try:
                    alias_data = json.loads(alias_txt[s:e+1])
                except Exception:
                    alias_data = None
            if alias_data and isinstance(alias_data, dict):
                alias_name = (alias_data.get("alias_of") or "").strip()
                conf = float(alias_data.get("confidence") or 0)
                if alias_name and conf >= 0.7:
                    # '나' 키를 찾아 병합
                    key_i = None
                    for k, v in list(agg.items()):
                        if _norm_name_for_cmp(v["name"]) == _norm_name_for_cmp("나"):
                            key_i = k
                            break
                    target_key = None
                    for k, v in agg.items():
                        if _norm_name_for_cmp(v["name"]) == _norm_name_for_cmp(alias_name):
                            target_key = k
                            break
                    if key_i is not None and target_key is not None and key_i != target_key:
                        # count 합산, 설명은 더 긴 쪽 유지
                        agg[target_key]["count"] += agg[key_i]["count"]
                        if len(agg.get(key_i, {}).get("desc", "")) > len(agg[target_key].get("desc", "")):
                            agg[target_key]["desc"] = agg.get(key_i, {}).get("desc", "")[:100]
                        try:
                            del agg[key_i]
                        except Exception:
                            pass
        except Exception:
            # 별칭 판단 실패 시 아무 것도 하지 않음(보수적)
            pass

    if not agg:
        # LLM이 실패하면 0을 반환하여 상위에서 폴백/에러 처리
        return 0
    top = sorted(agg.values(), key=lambda x: (-x["count"], x["order"]))[:5]
    # 최종 검증: 이름이 너무 일반적인 경우 제거(예: '나'는 허용)
    def is_generic(n: str) -> bool:
        k = _norm_name(n)
        if k == '나':
            return False
        bad = {"주인공","동료","동료 a","라이벌","적","안타고니스트","조연","친구","남자","여자"}
        return k in bad
    top = [it for it in top if not is_generic(it['name'])]
    if not top:
        return 0
    # 스토리 소유자 ID로 캐릭터 소유자 설정
    srow = await db.execute(select(Story.creator_id).where(Story.id == story_id))
    s_creator = (srow.first() or [None])[0]
    owner_id = s_creator or uuid.uuid4()

    # 윈도우 전체를 합쳐 컨텍스트(너무 길면 앞부분 위주)
    combined = "\n\n".join(windows)
    if len(combined) > 20000:
        combined = combined[:20000]

    created_count = 0
    for idx, it in enumerate(top):
        try:
            # 캐릭터 엔티티 생성(원작 연동 타입)
            ch = Character(
                creator_id=owner_id,
                name=it['name'],
                description=it.get('desc'),
                character_type='roleplay',
                source_type='IMPORTED',
                origin_story_id=story_id,
                is_public=True,
                has_affinity_system=True,
                affinity_rules='기본 호감도 규칙: 상호 배려와 신뢰 상승, 공격적 발화 시 하락',
                affinity_stages=[{"stage":"낯섦","min":0},{"stage":"친근","min":40},{"stage":"신뢰","min":70}],
            )
            db.add(ch)
            await db.flush()
            # LLM 보강은 베스트-에포트
            try:
                await _enrich_character_fields(db, ch, combined)
            except Exception:
                pass
            rec = StoryExtractedCharacter(
                story_id=story_id,
                name=it['name'],
                description=it.get('desc'),
                initial=(it.get('initial') or it['name'][:1])[:1],
                order_index=idx,
                character_id=ch.id,
            )
            db.add(rec)
            await db.commit()
            created_count += 1
        except Exception:
            try:
                await db.rollback()
            except Exception:
                pass
            continue
    # 추출 캐릭터 생성이 있었다면 스토리를 원작챗으로 플래그
    if created_count > 0:
        try:
            await db.execute(update(Story).where(Story.id == story_id).values(is_origchat=True))
            await db.commit()
        except Exception:
            try:
                await db.rollback()
            except Exception:
                pass
    return created_count


async def refresh_extracted_characters_for_story(
    db: AsyncSession,
    story_id,
    max_chapters: int | None = None,
) -> int:
    """기존 추출 캐릭터가 있을 때, 최신 회차 기준으로 description 등을 보강 갱신한다.
    - 이름 매칭(대소문자/공백 무시) 기반으로 동일 인물을 찾아 업데이트
    - 신규 캐릭터 생성/삭제는 하지 않음(안전 갱신)
    반환값: 갱신된 레코드 수
    """
    try:
        # 기존 추출 캐릭터 목록
        rows = await db.execute(
            select(StoryExtractedCharacter).where(StoryExtractedCharacter.story_id == story_id)
        )
        existing = rows.scalars().all()
        if not existing:
            return 0

        # 회차 텍스트 수집
        stmt = (
            select(StoryChapter.no, StoryChapter.title, StoryChapter.content)
            .where(StoryChapter.story_id == story_id)
            .order_by(StoryChapter.no.asc())
        )
        if isinstance(max_chapters, int) and max_chapters > 0:
            stmt = stmt.limit(max_chapters)
        rows = await db.execute(stmt)
        chapters = rows.all()
        if not chapters:
            return 0

        windows = _chunk_windows_from_chapters(chapters, max_chars=6000)
        if not windows:
            return 0

        # AI로 최신 설명 재수집(간단 집계)
        from app.services.ai_service import get_ai_chat_response
        import json
        director_prompt = (
            "등장인물의 최신 요약을 갱신합니다. JSON만 출력하세요. 스키마: {\"characters\": [{\"name\": string, \"description\": string}]}"
        )
        agg: Dict[str, Dict[str, Any]] = {}
        for win in windows:
            raw = await get_ai_chat_response(
                character_prompt=director_prompt,
                user_message=win,
                history=[],
                preferred_model="claude",
                preferred_sub_model="claude-3-5-sonnet-20241022",
                response_length_pref="short",
            )
            text = (raw or "").strip()
            start = text.find('{'); end = text.rfind('}')
            data = None
            if start != -1 and end != -1 and end > start:
                try:
                    data = json.loads(text[start:end+1])
                except Exception:
                    data = None
            if not data or not isinstance(data.get('characters'), list):
                continue
            for ch in data['characters'][:8]:
                try:
                    name = str(ch.get('name') or '').strip()
                    if not name:
                        continue
                    key = _norm_name(name)
                    desc = str(ch.get('description') or '').strip()
                    if key not in agg:
                        agg[key] = {"name": name, "desc": desc}
                    else:
                        # 더 긴 설명로 보강
                        if desc and (len(desc) > len(agg[key]["desc"])):
                            agg[key]["desc"] = desc
                except Exception:
                    continue

        if not agg:
            return 0

        # 기존 레코드 갱신
        updated = 0
        for rec in existing:
            k = _norm_name(rec.name)
            cand = agg.get(k)
            if not cand:
                continue
            new_desc = (cand.get("desc") or "").strip()
            if new_desc and new_desc != (rec.description or ""):
                rec.description = new_desc[:160]
                updated += 1
        if updated:
            try:
                await db.commit()
            except Exception:
                await db.rollback()
                updated = 0
        return updated
    except Exception:
        return 0


async def generate_origchat_intro(
    db: AsyncSession,
    *,
    story_id,
    character_id,
    anchor: int,
    range_from: Optional[int] = None,
    range_to: Optional[int] = None,
    max_scene_chars: int = 1400,
) -> Optional[str]:
    """선택 범위의 마지막 회차(또는 앵커)를 중심으로 풍부한 지문+대사가 섞인 인트로 텍스트를 생성한다.
    - 스포일러 가드: range_to 이후 사건은 금지
    - 스타일: 장면 묘사 5~10문장 + 캐릭터 대사 1~3줄을 자연스럽게 녹여서 출력
    """
    try:
        # 대상 회차 결정
        target_no = int(range_to or anchor or 1)
        # 해당 회차 본문 일부 확보
        row = await db.execute(
            select(StoryChapter.title, StoryChapter.content)
            .where(StoryChapter.story_id == story_id, StoryChapter.no == target_no)
        )
        r = row.first()
        scene_title = (r[0] if r else '') or ''
        scene_text = ((r[1] if r else '') or '')[:max_scene_chars]

        # 누적 요약(범위 종료 기준) 확보
        s = await db.execute(
            select(StoryEpisodeSummary.cumulative_summary)
            .where(StoryEpisodeSummary.story_id == story_id, StoryEpisodeSummary.no == target_no)
        )
        cum = (s.first() or [None])[0] or ''

        # 캐릭터 이름
        cname = None
        if character_id:
            crow = await db.execute(select(Character.name).where(Character.id == character_id))
            cname = (crow.first() or [None])[0]
        cname = cname or '그/그녀'

        from app.services.ai_service import get_ai_chat_response
        system = (
            "당신은 한국어로 장면을 생생하게 서술하는 소설가 겸 배우입니다. 주어진 요약과 장면 발췌를 바탕으로, "
            "대화 시작용 인트로를 작성하세요.\n"
            "규칙:\n"
            "- 범위 종료 회차 이후의 사건을 언급하거나 암시하지 않습니다.\n"
            "- 5~10문장 정도의 지문(배경/감각/행동/감정)을 먼저 충분히 서술합니다.\n"
            "- 서술 중간이나 끝에 캐릭터의 짧은 대사 1~3줄을 자연스럽게 녹입니다(이름 표기 없이 따옴표로만).\n"
            "- 과도한 설명 대신 현장감/공기/움직임 위주로.\n"
            "- 출력은 순수 본문만. JSON/헤더/메타 금지."
        )
        user = (
            f"[캐릭터]\n{cname}\n\n"
            f"[범위]\n{int(range_from or 1)}~{int(range_to or anchor or 1)}화\n\n"
            f"[회차 제목]\n{scene_title}\n\n"
            f"[누적 요약]\n{cum}\n\n"
            f"[장면 발췌]\n{scene_text}"
        )
        raw = await get_ai_chat_response(
            character_prompt=system,
            user_message=user,
            history=[],
            preferred_model="claude",
            preferred_sub_model="claude-sonnet-4-0",
            response_length_pref="long",
        )
        text = (raw or '').strip()
        # 간단 정리: 너무 짧거나 메타텍스트 포함 시 컷
        if not text or len(text) < 50:
            return None
        return text[:4000]
    except Exception:
        return None


async def generate_character_chat_intro(character: Character, *, max_scene_chars: int = 1400) -> Optional[str]:
    """캐릭터 단독 챗 첫 인트로(풍부한 지문+대사)를 생성한다."""
    try:
        from app.services.ai_service import get_ai_chat_response
        name = character.name or "그/그녀"
        desc = (character.description or "").strip()
        personality = (character.personality or "").strip()
        speech = (character.speech_style or "").strip()
        bg = (character.background_story or "").strip()
        world = (character.world_setting or "").strip()
        intros = []
        try:
            if isinstance(character.introduction_scenes, list):
                intros = [str(x) for x in character.introduction_scenes[:2]]
        except Exception:
            intros = []

        system = (
            "당신은 한국어로 장면을 생생하게 서술하는 소설가 겸 배우입니다. 다음 캐릭터 프로필을 바탕으로, "
            "대화 시작용 인트로를 작성하세요.\n"
            "규칙:\n- 5~10문장의 지문(배경/감각/행동/감정)을 먼저 충분히 서술\n"
            "- 지문 중간이나 끝에 캐릭터의 짧은 대사 1~3줄을 자연스럽게 녹임(이름 표기 없이 따옴표만)\n"
            "- 캐릭터의 성격/말투를 반영하고, 세계관을 과도하게 노출하지 않음\n"
            "- 출력은 순수 본문만. JSON/메타 금지"
        )
        user = (
            f"[캐릭터]\n{name}\n\n[설명]\n{desc}\n\n[성격]\n{personality}\n\n[말투]\n{speech}\n\n"
            f"[배경]\n{bg[:1000]}\n\n[세계관]\n{world[:1000]}\n\n[도입부 힌트]\n" + " | ".join(intros)
        )
        raw = await get_ai_chat_response(
            character_prompt=system,
            user_message=user,
            history=[],
            preferred_model="claude",
            preferred_sub_model="claude-sonnet-4-0",
            response_length_pref="long",
        )
        text = (raw or '').strip()
        if not text or len(text) < 50:
            return None
        return text[:4000]
    except Exception:
        return None

