"""
원작챗 오케스트레이션(스텁)
- Director/Actor/Guard 실제 구현 전, 최소 동작을 위한 컨텍스트/턴 생성기
"""
from typing import Optional, Dict, Any, List, Tuple
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from app.models.story import Story
from app.models.story_chapter import StoryChapter
from app.models.story_summary import StoryEpisodeSummary
from app.models.story_extracted_character import StoryExtractedCharacter
from app.models.character import Character


async def build_context_pack(db: AsyncSession, story_id, anchor: int, character_id: Optional[str] = None) -> Dict[str, Any]:
    # Redis 캐시 우선
    try:
        from app.core.database import redis_client
        # summary_version에 따라 캐시 키 버전을 올려 무효화 유도
        ver_res = await db.execute(select(Story.summary_version).where(Story.id == story_id))
        ver_row = ver_res.first()
        ver = (ver_row[0] if ver_row else 1) or 1
        cache_key = f"ctx:pack:{story_id}:{anchor}:v{ver}"
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
        # 초기 관계 미터는 None(클라이언트 기본값 사용)
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
    }
    try:
        from app.core.database import redis_client
        import json
        await redis_client.setex(cache_key, 600, json.dumps(pack, ensure_ascii=False))
    except Exception:
        pass
    return pack


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


# ---- 추출 캐릭터 보장(간이 스텁) ----
async def ensure_extracted_characters_for_story(db: AsyncSession, story_id) -> None:
    """스토리에 추출 캐릭터가 없고 회차가 존재하면 기본 3인을 생성한다(간이)."""
    try:
        # 이미 존재하면 스킵
        rows = await db.execute(select(StoryExtractedCharacter.id).where(StoryExtractedCharacter.story_id == story_id).limit(1))
        if rows.first():
            return
        # 회차 존재 여부 확인
        has_ch = await db.scalar(select(StoryChapter.id).where(StoryChapter.story_id == story_id).limit(1))
        if not has_ch:
            return
        # 1차: LLM 기반 자동 추출 시도
        created = await extract_characters_from_story(db, story_id)
        if created and created > 0:
            return
        basics = [
            {"name": "나", "description": "1인칭 화자(이름 미공개)"},
            {"name": "조연1", "description": "보조적 역할(임시)"},
            {"name": "조연2", "description": "보조적 역할(임시)"},
        ]
        for idx, b in enumerate(basics):
            rec = StoryExtractedCharacter(
                story_id=story_id,
                name=b["name"],
                description=b["description"],
                initial=(b.get("initial") or b["name"][:1])[:1],
                order_index=idx,
            )
            db.add(rec)
        await db.commit()
    except Exception:
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

    try:
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
            raw = await get_ai_chat_response(
                character_prompt=director_prompt,
                user_message=win,
                history=[],
                preferred_model="claude",
                preferred_sub_model="claude-sonnet-4-0",
                response_length_pref="short",
            )
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

        if not agg:
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

        for idx, it in enumerate(top):
            # 캐릭터 엔티티 생성(원작 연동 타입)
            ch = Character(
                creator_id=owner_id,
                name=it['name'],
                description=it.get('desc'),
                character_type='roleplay',
                source_type='IMPORTED',
                is_public=True,
                has_affinity_system=True,
                affinity_rules='기본 호감도 규칙: 상호 배려와 신뢰 상승, 공격적 발화 시 하락',
                affinity_stages=[{"stage":"낯섦","min":0},{"stage":"친근","min":40},{"stage":"신뢰","min":70}],
            )
            db.add(ch)
            await db.flush()
            # LLM으로 세부 필드 채우기
            await _enrich_character_fields(db, ch, combined)
            rec = StoryExtractedCharacter(
                story_id=story_id,
                name=it['name'],
                description=it.get('desc'),
                initial=(it.get('initial') or it['name'][:1])[:1],
                order_index=idx,
                character_id=ch.id,
            )
            try:
                db.add(rec)
                await db.commit()
            except Exception:
                # 유니크 제약 등으로 실패 시 롤백 후 다음 항목 진행
                await db.rollback()
        return len(top)
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

