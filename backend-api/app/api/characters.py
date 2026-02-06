"""
캐릭터 관련 API 라우터 - CAVEDUCK 스타일 고급 캐릭터 생성
"""

from fastapi import APIRouter, Depends, HTTPException, status, Query, BackgroundTasks, Request
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Any, List, Optional
import uuid
from datetime import datetime, timezone
from app.core.config import settings
import json
import logging
import time

logger = logging.getLogger(__name__)

from app.services.start_sets_utils import extract_max_turns_from_start_sets

def _extract_max_turns_from_start_sets(start_sets: Any) -> Optional[int]:
    """
    start_sets에서 sim_options.max_turns를 방어적으로 추출한다.

    의도/원리:
    - 캐릭터 목록 응답은 start_sets 전체를 포함하지 않는다(페이로드/성능).
    - 하지만 프론트 격자 카드(좌상단 배지)는 "턴수" 표기가 필요하므로,
      start_sets(SSOT)에서 max_turns만 파생해 내려준다.
    - legacy 데이터/마이그레이션 누락/오염(str JSON 등)에도 500 없이 안전하게 폴백해야 한다.
    """
    # ✅ SSOT: 공용 유틸(랭킹/목록/메타 등 여러 응답에서 동일 규칙 적용)
    return extract_max_turns_from_start_sets(start_sets)

from app.core.database import get_db
from app.core.security import get_current_user, get_current_active_user
from app.core.security import get_current_user_optional  # 진짜 optional 의존성 사용
from app.models.user import User
from app.models.character import Character  # Character 모델 import 추가
from app.schemas.character import (
    # 🔥 CAVEDUCK 스타일 고급 스키마
    CharacterCreateRequest,
    CharacterUpdateRequest,
    CharacterDetailResponse,
    CharacterExampleDialogueResponse,
    WorldSettingCreate,
    WorldSettingResponse,
    CustomModuleCreate,
    CustomModuleResponse,
    
    # 레거시 호환성 스키마
    CharacterCreate, 
    CharacterUpdate, 
    CharacterResponse, 
    CharacterListResponse,
    CharacterWithCreator,
    CharacterSettingResponse,
    CharacterSettingCreate,  # 추가
    CharacterSettingUpdate   # 추가
)
from app.schemas.quick_character import (
    QuickCharacterGenerateRequest,
    QuickProfileThemeSuggestionsResponse,
    QuickVisionHintsRequest,
    QuickVisionHintsResponse,
    QuickCreate30sRequest,
    QuickPromptGenerateRequest,
    QuickPromptGenerateResponse,
    QuickStatGenerateRequest,
    QuickStatGenerateResponse,
    QuickFirstStartGenerateRequest,
    QuickFirstStartGenerateResponse,
    QuickDetailGenerateRequest,
    QuickDetailGenerateResponse,
    QuickSecretGenerateRequest,
    QuickSecretGenerateResponse,
    QuickTurnEventsGenerateRequest,
    QuickTurnEventsGenerateResponse,
    QuickEndingDraftGenerateRequest,
    QuickEndingDraftGenerateResponse,
    QuickEndingEpilogueGenerateRequest,
    QuickEndingEpilogueGenerateResponse,
)
from app.schemas.comment import (
    CommentCreate,
    CommentUpdate, 
    CommentResponse,
    CommentWithUser
)
from app.services.character_service import (
    create_character,
    get_character_by_id,
    get_characters_by_creator,
    get_public_characters,
    update_character,
    delete_character,
    create_character_setting,
    get_character_setting,
    update_character_setting,
    like_character,
    unlike_character,
    is_character_liked_by_user,
    sync_character_chat_count,
    # 🔥 CAVEDUCK 스타일 고급 서비스
    create_advanced_character,
    update_advanced_character,
    get_advanced_character_by_id,
    get_character_example_dialogues,
    update_character_public_status, # 서비스 함수 임포트 추가
    increment_character_chat_count,
)
from app.services.quick_character_service import (
    generate_quick_character_draft,
    generate_quick_simulator_prompt,
    generate_quick_roleplay_prompt,
    build_quick_vision_hints,
    generate_quick_first_start,
    generate_quick_detail,
    generate_quick_secret_info,
    generate_quick_stat_draft,
    generate_quick_turn_events,
    generate_quick_ending_draft,
    generate_quick_ending_epilogue,
)
from app.schemas.tag import CharacterTagsUpdate, TagResponse
from app.models.tag import Tag, CharacterTag
from app.models.story_extracted_character import StoryExtractedCharacter
from sqlalchemy import update as sql_update
from sqlalchemy import select, delete, insert
from app.services.comment_service import (
    create_character_comment,
    get_character_comments,
    get_comment_by_id,
    update_character_comment,
    delete_character_comment
)

router = APIRouter()

# 🔥 CAVEDUCK 스타일 고급 캐릭터 생성 API

@router.get("/quick-profile-theme-suggestions", response_model=QuickProfileThemeSuggestionsResponse)
async def quick_profile_theme_suggestions(
    current_user: User = Depends(get_current_active_user),
):
    """
    프로필 단계(작품명/한줄소개)용 '소재 태그칩' 후보를 반환한다.

    의도/원리(SSOT):
    - 소재 후보 리스트는 백엔드가 SSOT로 관리한다.
    - 프론트는 이 리스트를 칩 UI로 보여주고, 유저가 선택한 값만 seed_text에 주입해 자동생성에 반영한다.
    - 인증 사용자에게만 제공(온보딩 모달/위저드 공용이지만, 우리 앱 흐름 상 로그인 이후 사용).
    """
    return QuickProfileThemeSuggestionsResponse()


@router.post("/quick-vision-hints", response_model=QuickVisionHintsResponse)
async def quick_vision_hints(
    payload: QuickVisionHintsRequest,
    current_user: User = Depends(get_current_active_user),
    request: Request = None,
):
    """
    온보딩/위저드 공용: 이미지 비전 힌트(앵커/무드) + 소재칩 매칭 후보를 반환한다.

    의도/원리:
    - 프론트는 이 응답으로 "이미지와 어울리는 소재칩"을 미리 강조(애니메이트)할 수 있다.
    - 생성/저장과 무관하며 실패해도 200 + 빈 리스트로 폴백한다(UX만 영향).
    """
    try:
        raw_url = getattr(payload, "image_url", None)
        abs_url = raw_url
        try:
            if raw_url and isinstance(raw_url, str) and raw_url.startswith("/") and request is not None:
                base = str(getattr(request, "base_url", "") or "").rstrip("/")
                abs_url = f"{base}{raw_url}"
        except Exception:
            abs_url = raw_url

        data = await build_quick_vision_hints(str(abs_url or "").strip())
        return QuickVisionHintsResponse(**(data or {}))
    except Exception as e:
        try:
            logger.exception(f"[characters.quick-vision-hints] failed: {e}")
        except Exception:
            pass
        # 방어: 힌트 실패는 UX만 영향 → 빈 값으로 폴백
        return QuickVisionHintsResponse()

@router.post("/quick-generate", response_model=CharacterCreateRequest)
async def quick_generate_character_draft(
    payload: QuickCharacterGenerateRequest,
    current_user: User = Depends(get_current_active_user),
    request: Request = None,
):
    """
    온보딩(30초만에 캐릭터 만나기)용: 이미지+느낌+태그로 고급 캐릭터 생성 초안을 생성합니다.

    주의:
    - 이 엔드포인트는 DB에 저장하지 않습니다(SSOT: 실제 저장은 /characters/advanced).
    - 실패 시 조용히 무시하지 않고 500 + 상세 메시지로 반환합니다(로그 포함).
    """
    t0 = time.perf_counter()
    try:
        # ✅ 방어: 업로드 API는 `/static/...` 상대경로를 반환한다.
        # Vision(서버 내부 requests.get)은 절대 URL이 필요하므로, 분석용으로만 절대 URL로 변환한다.
        raw_url = getattr(payload, "image_url", None)
        abs_url = raw_url
        try:
            if raw_url and isinstance(raw_url, str) and raw_url.startswith("/") and request is not None:
                base = str(getattr(request, "base_url", "") or "").rstrip("/")
                abs_url = f"{base}{raw_url}"
        except Exception:
            abs_url = raw_url

        if abs_url != raw_url:
            try:
                payload = QuickCharacterGenerateRequest(**{**payload.model_dump(), "image_url": abs_url})
            except Exception:
                # 변환 실패 시 원본 유지
                pass

        # ✅ QuickMeet 프로필 자동생성: 유저 모델설정(SSOT)을 그대로 따른다.
        # - 프론트가 기본값(gemini)을 보내더라도, 모델설정에서 Claude/GPT 등을 선택했다면 그 값을 우선한다.
        try:
            preferred_model = str(getattr(current_user, "preferred_model", "") or "").strip().lower()
        except Exception:
            preferred_model = ""
        try:
            preferred_sub_model = str(getattr(current_user, "preferred_sub_model", "") or "").strip()
        except Exception:
            preferred_sub_model = ""
        if preferred_model in ("gemini", "claude", "gpt"):
            try:
                # ✅ 요청사항: "제미니는 제미니인데, 서브모델만 Pro로"
                # - 실험 전 기본이 flash였다면, QuickMeet 프로필 자동생성에서는
                #   저장된 preferred_sub_model이 flash로 남아 계속 flash가 호출될 수 있다.
                # - provider(gemini/claude/gpt) 정책은 건드리지 않고,
                #   gemini일 때만 sub_model을 gemini-3-pro-preview로 치환한다.
                if preferred_model == "gemini":
                    preferred_sub_model = "gemini-3-pro-preview"
                payload = QuickCharacterGenerateRequest(
                    **{
                        **payload.model_dump(),
                        "ai_model": preferred_model,
                        "ai_sub_model": preferred_sub_model or None,
                    }
                )
            except Exception:
                # 방어: 모델 주입 실패 시 원본 유지
                pass

        draft = await generate_quick_character_draft(payload)

        # 응답은 저장/표시를 위해 원본 상대경로를 유지하는 것이 안전하다.
        try:
            if raw_url and abs_url != raw_url and getattr(draft, "media_settings", None):
                if getattr(draft.media_settings, "avatar_url", None) == abs_url:
                    draft.media_settings.avatar_url = raw_url
                imgs = getattr(draft.media_settings, "image_descriptions", None)
                if isinstance(imgs, list):
                    for img in imgs:
                        try:
                            if isinstance(img, dict):
                                if img.get("url") == abs_url:
                                    img["url"] = raw_url
                            else:
                                if getattr(img, "url", None) == abs_url:
                                    img.url = raw_url
                        except Exception:
                            continue
        except Exception:
            pass

        try:
            ms = int((time.perf_counter() - t0) * 1000)
            logger.info(
                f"[perf] characters.quick-generate ok ms={ms} "
                f"has_image={bool(getattr(payload, 'image_url', None))} "
                f"ai_model={getattr(payload, 'ai_model', None)}"
            )
        except Exception:
            pass
        return draft
    except Exception as e:
        try:
            ms = int((time.perf_counter() - t0) * 1000)
            logger.exception(f"[perf] characters.quick-generate fail ms={ms} err={type(e).__name__}:{str(e)[:160]}")
        except Exception:
            pass
        try:
            logger.exception(f"[characters.quick-generate] failed: {e}")
        except Exception:
            pass
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"quick_generate_failed: {str(e)}"
        )


@router.post("/quick-create-30s", response_model=CharacterDetailResponse, status_code=status.HTTP_201_CREATED)
async def quick_create_character_30s(
    payload: QuickCreate30sRequest,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """
    메인탭 '30초 안에 캐릭터 생성' 단일 엔드포인트.

    핵심 요구사항(운영 안정):
    - 공개 고정(is_public=true)
    - 오프닝 1개 + 엔딩 2개는 "무조건" 생성(실패 시 전체 실패)
    - 설정메모 3개는 start_sets.setting_book.items(런타임 SSOT)에 저장
    - request_id가 있으면 중복 생성 방지(간단 idempotency)
    """
    from app.core.database import redis_client

    # =========================
    # 0) idempotency(선택)
    # =========================
    request_id = str(getattr(payload, "request_id", "") or "").strip()
    idem_key = ""
    lock_key = ""
    if request_id:
        idem_key = f"quick-create-30s:{current_user.id}:{request_id}"
        lock_key = f"{idem_key}:lock"
        try:
            existing_id = await redis_client.get(idem_key)
        except Exception as e:
            # 방어: Redis 장애 시에도 생성은 진행하되, 원인 추적을 위해 로그는 남긴다.
            try:
                logger.warning(f"[characters.quick-create-30s] redis get failed (idem_key): {e}")
            except Exception:
                pass
            existing_id = None

        if existing_id:
            try:
                character = await get_advanced_character_by_id(db, uuid.UUID(str(existing_id)))
                if character:
                    return await convert_character_to_detail_response(character, db)
            except Exception as e:
                # 캐시가 깨졌으면 아래 로직으로 재생성 진행
                try:
                    logger.warning(f"[characters.quick-create-30s] cached character fetch failed: {e}")
                except Exception:
                    pass

        # 동시성 방지 락(프론트 inFlightRef와 중복 방어)
        try:
            got_lock = await redis_client.set(lock_key, "1", nx=True, ex=600)
        except Exception as e:
            # 방어: Redis 락 실패 시에도 서버는 진행하되, 중복 생성 리스크를 로그로 남긴다.
            try:
                logger.warning(f"[characters.quick-create-30s] redis lock set failed: {e}")
            except Exception:
                pass
            got_lock = True
        if not got_lock:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="quick_create_in_flight")

    try:
        # =========================
        # 1) 입력 정규화(방어)
        # =========================
        image_url = str(getattr(payload, "image_url", "") or "").strip()
        if not image_url:
            raise HTTPException(status_code=400, detail="image_url_required")

        audience_slug = str(getattr(payload, "audience_slug", "") or "").strip()
        style_slug = str(getattr(payload, "style_slug", "") or "").strip()
        if not audience_slug:
            raise HTTPException(status_code=400, detail="audience_slug_required")
        if not style_slug:
            raise HTTPException(status_code=400, detail="style_slug_required")

        character_type = str(getattr(payload, "character_type", "roleplay") or "roleplay").strip().lower()
        if character_type not in ("roleplay", "simulator"):
            character_type = "roleplay"

        # ✅ 30초 모달 기본 턴수: 100~150 범위 (속도 최적화)
        max_turns = int(getattr(payload, "max_turns", 125) or 125)
        if max_turns < 50:
            max_turns = 50

        name = str(getattr(payload, "name", "") or "").strip()[:100]
        one_line = str(getattr(payload, "one_line_intro", "") or "").strip()[:500]
        if not name:
            raise HTTPException(status_code=400, detail="name_required")
        if not one_line:
            raise HTTPException(status_code=400, detail="one_line_intro_required")

        # 태그(slug): 성향/스타일은 필수로 포함
        extra_tags = getattr(payload, "tags", None) or []
        extra_tags = [str(x).strip() for x in extra_tags if str(x).strip()]
        tag_slugs = []
        for x in [audience_slug, style_slug, *extra_tags]:
            if x and x not in tag_slugs:
                tag_slugs.append(x)
        tag_slugs = tag_slugs[:20]

        # 설정메모(최대 3개, 각 200자 권장)
        raw_memos = getattr(payload, "setting_memos", None) or []
        raw_memos = [str(x or "").strip() for x in raw_memos if str(x or "").strip()]
        raw_memos = raw_memos[:3]
        memo_items = []
        for idx, txt in enumerate(raw_memos, start=1):
            # ✅ 방어: 30초 생성에서는 트리거/타겟을 단순화하여 실패율을 낮춘다.
            memo_items.append({
                "id": f"memo_qc_{uuid.uuid4().hex[:8]}_{idx}",
                "detail": txt[:200],
                "triggers": [],
                "targets": ["all"],
            })
        setting_book = {
            "selectedId": (memo_items[0]["id"] if memo_items else ""),
            "items": memo_items,
        }

        # ✅ 30초 생성: Claude Haiku 4.5 (JSON 준수율 + 프롬프트 충실도 우선)
        # - Gemini Flash는 JSON 파싱 실패로 스탯/오프닝 누락이 빈번했음
        # - 속도는 약간 느려지지만, 결과 안정성이 더 중요
        ai_model = "claude"

        # =========================
        # 2) 필수 자동 생성(프롬프트/오프닝/엔딩2개)
        # =========================
        sim_dating_elements = bool(getattr(payload, "sim_dating_elements", False))
        def _normalize_stats_for_start_set(raw_stats: Any) -> List[dict]:
            """
            start_sets.stat_settings.stats 저장용 스탯을 방어적으로 정규화한다.

            배경:
            - 위저드는 프론트에서 stat id를 생성(genStatId)해 저장한다.
            - 30초 생성은 서버가 stats를 즉시 저장하므로, 여기서 id를 반드시 부여해야 한다.
              (SSOT: 런타임/메타/델타 파서는 id 기반)
            """
            try:
                arr = raw_stats if isinstance(raw_stats, list) else []
            except Exception:
                arr = []
            out: List[dict] = []
            seen_ids = set()
            for i, st in enumerate(arr[:4]):
                if not isinstance(st, dict):
                    continue
                name2 = str(st.get("name") or "").strip()
                if not name2:
                    continue

                # ✅ id: 없으면 서버에서 생성(필수)
                sid = str(st.get("id") or "").strip()
                if not sid:
                    sid = f"stat_{uuid.uuid4().hex[:10]}"
                if sid in seen_ids:
                    sid = f"{sid}_{i+1}"
                seen_ids.add(sid)

                # 숫자 필드 방어(없으면 합리적 기본값)
                def _p_int(x, default_v):
                    try:
                        if x is None:
                            return int(default_v)
                        s = str(x).strip()
                        if s == "":
                            return int(default_v)
                        return int(float(s))
                    except Exception:
                        return int(default_v)

                mn = _p_int(st.get("min_value"), 0)
                mx = _p_int(st.get("max_value"), 100)
                if mx < mn:
                    mn, mx = mx, mn
                bv = _p_int(st.get("base_value"), int((mn + mx) / 2))
                bv = max(mn, min(mx, bv))

                unit = str(st.get("unit") or "").strip()[:10]
                desc2 = str(st.get("description") or "").strip()[:500]
                if not desc2:
                    desc2 = f"{name2}는(은) 대화/행동의 결과로 조금씩 오르거나 내려갑니다."

                out.append(
                    {
                        "id": sid,
                        "name": name2[:20],
                        "min_value": mn,
                        "max_value": mx,
                        "base_value": bv,
                        "unit": unit,
                        "description": desc2,
                    }
                )
            return out
        if character_type == "simulator":
            world_setting = await generate_quick_simulator_prompt(
                name=name,
                description=one_line,
                max_turns=max_turns,
                allow_infinite_mode=False,
                tags=tag_slugs,
                ai_model=ai_model,
                sim_variant=None,
                sim_dating_elements=sim_dating_elements,
            )
            stats = await generate_quick_stat_draft(
                name=name,
                description=one_line,
                world_setting=world_setting,
                mode=character_type,
                tags=tag_slugs,
                ai_model=ai_model,
            )
            stats = _normalize_stats_for_start_set(stats or [])
            # ✅ 방어: 스탯 생성이 실패(빈 배열)하면 시뮬레이터 기본 스탯 폴백
            # - UI에서 !스탯 호출 시 "불러오지 못했습니다" 에러를 방지
            if not stats:
                try:
                    logger.warning(f"[quick_create_30s] stat_draft empty, injecting default stats for simulator")
                except Exception:
                    pass
                stats = [
                    {"id": "tension", "label": "긴장감", "base_value": 30, "min_value": 0, "max_value": 100},
                    {"id": "trust", "label": "신뢰도", "base_value": 50, "min_value": 0, "max_value": 100},
                    {"id": "progress", "label": "진행도", "base_value": 0, "min_value": 0, "max_value": 100},
                ]
        else:
            world_setting = await generate_quick_roleplay_prompt(
                name=name,
                description=one_line,
                max_turns=max_turns,
                allow_infinite_mode=False,
                tags=tag_slugs,
                ai_model=ai_model,
            )
            # ✅ 요구사항: RP도 최소 1개(호감도) 스탯은 포함한다.
            # - 런타임 stat_state 주입/델타 반영을 위해 id 포함 포맷이 필요(SSOT: quick_character_service.generate_quick_stat_draft).
            try:
                stats = await generate_quick_stat_draft(
                    name=name,
                    description=one_line,
                    world_setting=world_setting,
                    mode=character_type,
                    tags=tag_slugs,
                    ai_model=ai_model,
                )
                stats = _normalize_stats_for_start_set(stats or [])
            except Exception as e:
                try:
                    logger.exception(f"[characters.quick-create-30s] roleplay stat generation failed (non-fatal): {e}")
                except Exception:
                    pass
                stats = []
            # ✅ 최소 1개 보장(운영 안정): 모델 실패/빈 결과면 기본 호감도 1개
            if not stats:
                stats = _normalize_stats_for_start_set(
                    [
                        {
                            "name": "호감도",
                            "min_value": 0,
                            "max_value": 100,
                            "base_value": 40,
                            "unit": "",
                            "description": "상대의 말과 행동에 따라 조금씩 오르거나 내려갑니다. 신뢰를 쌓는 선택은 (+), 무례/기만/회피는 (-)로 반영됩니다.",
                        }
                    ]
                )

        # =========================
        # 2.5) 디테일 자동 생성(성격/말투/관심사/좋·싫)
        # =========================
        # ✅ 위저드(quick-generate-detail)와 동일한 결과를 30초 생성에도 저장한다.
        # - interests/likes/dislikes는 Character 스키마에 별도 필드가 없으므로,
        #   위저드와 동일하게 personality 텍스트에 섹션 형태로 병합해 저장한다(SSOT: 프롬프트 반영 목적).
        # - 실패하더라도 30초 생성 전체를 실패시키지 않는다(운영/데모 안정).
        detail_personality = ""
        detail_speech = ""
        detail_interests: List[str] = []
        detail_likes: List[str] = []
        detail_dislikes: List[str] = []
        try:
            out = await generate_quick_detail(
                name=name,
                description=one_line,
                world_setting=str(world_setting or ""),
                mode=character_type,
                section_modes=None,
                tags=tag_slugs,
                ai_model=ai_model,
            ) or {}
            detail_personality = str(out.get("personality") or "").strip()
            detail_speech = str(out.get("speech_style") or "").strip()
            detail_interests = [str(x or "").strip() for x in (out.get("interests") or []) if str(x or "").strip()][:3]
            detail_likes = [str(x or "").strip() for x in (out.get("likes") or []) if str(x or "").strip()][:3]
            detail_dislikes = [str(x or "").strip() for x in (out.get("dislikes") or []) if str(x or "").strip()][:3]
        except Exception as e:
            try:
                logger.exception(f"[characters.quick-create-30s] detail generation failed (non-fatal): {e}")
            except Exception:
                pass

        def _merge_detail_prefs_into_personality(base: str, interests: List[str], likes: List[str], dislikes: List[str]) -> str:
            """
            ✅ 위저드와 동일한 규칙으로 personality에 디테일 키워드를 섹션 형태로 병합한다.

            - [관심사] / [좋아하는 것] / [싫어하는 것] 섹션을 사용한다.
            - 기존 텍스트에 동일 섹션이 있으면 제거 후 최신 값으로 다시 붙인다(중복 방지).
            """
            try:
                s = str(base or "").strip()
                # 기존 섹션 제거(중복 방지)
                s = re.sub(r"\n?\[관심사\][\s\S]*?(?=\n\[좋아하는 것\]|\n\[싫어하는 것\]|\n*$)", "", s, flags=re.M)
                s = re.sub(r"\n?\[좋아하는 것\][\s\S]*?(?=\n\[관심사\]|\n\[싫어하는 것\]|\n*$)", "", s, flags=re.M)
                s = re.sub(r"\n?\[싫어하는 것\][\s\S]*?(?=\n\[관심사\]|\n\[좋아하는 것\]|\n*$)", "", s, flags=re.M)
                s = s.strip()

                blocks = []
                if interests:
                    blocks.append("[관심사]\n" + "\n".join(interests))
                if likes:
                    blocks.append("[좋아하는 것]\n" + "\n".join(likes))
                if dislikes:
                    blocks.append("[싫어하는 것]\n" + "\n".join(dislikes))

                merged = s
                if blocks:
                    merged = (merged + "\n\n" + "\n\n".join(blocks)).strip() if merged else "\n\n".join(blocks).strip()
                return merged
            except Exception:
                return str(base or "").strip()

        merged_personality = _merge_detail_prefs_into_personality(
            detail_personality,
            detail_interests,
            detail_likes,
            detail_dislikes,
        )
        # 30초 생성은 입력 UI가 없으므로 과도한 길이로 인해 상세 페이지가 깨지지 않게 방어적으로 제한
        # - DB 허용은 2000이지만, 위저드 UI 기준(300)을 맞춰 간결하게 유지한다.
        if merged_personality and len(merged_personality) > 300:
            merged_personality = merged_personality[:300].rstrip()
        if detail_speech and len(detail_speech) > 300:
            detail_speech = detail_speech[:300].rstrip()

        intro, first_line = await generate_quick_first_start(
            name=name,
            description=one_line,
            world_setting=world_setting,
            mode=character_type,
            sim_variant=None,
            sim_dating_elements=sim_dating_elements,
            tags=tag_slugs,
            ai_model=ai_model,
        )

        # =========================
        # 2.6) 턴수별 사건(turn_events) 생성 (Best-effort)
        # =========================
        # ✅ 위저드와 논리 통일:
        # - 위저드는 오프닝 생성 직후 `quick-generate-turn-events`로 turn_events를 채운다.
        # - 30초 생성도 동일한 "진행 가이드(사건)"를 넣어 루프/정체를 완화한다.
        # - 실패해도 전체 생성은 진행(운영/데모 안정).
        turn_events: List[dict] = []
        try:
            evs = await generate_quick_turn_events(
                name=name,
                description=one_line,
                world_setting=str(world_setting or ""),
                opening_intro=str(intro or ""),
                opening_first_line=str(first_line or ""),
                mode=character_type,
                max_turns=max_turns,
                sim_variant=None,
                sim_dating_elements=sim_dating_elements,
                tags=tag_slugs,
                ai_model=ai_model,
            )
            if isinstance(evs, list) and evs:
                # 방어: 과도한 폭주 방지(서비스는 이미 상한을 두지만 1회 더 제한)
                turn_events = evs[:20]
        except Exception as e:
            try:
                logger.exception(f"[characters.quick-create-30s] turn_events generation failed (non-fatal): {e}")
            except Exception:
                pass

        # 엔딩 1개 생성(30초 모달 속도 최적화), 최대 3번 시도
        endings = []
        attempts = 0
        while len(endings) < 1 and attempts < 3:
            attempts += 1
            try:
                d = await generate_quick_ending_draft(
                    name=name,
                    description=one_line,
                    world_setting=world_setting,
                    opening_intro=intro or "",
                    opening_first_line=first_line or "",
                    mode=character_type,
                    max_turns=max_turns,
                    min_turns=30,
                    sim_variant=None,
                    sim_dating_elements=sim_dating_elements,
                    tags=tag_slugs,
                    ai_model=ai_model,
                ) or {}
                title = str(d.get("title") or "").strip()[:20]
                base_condition = str(d.get("base_condition") or "").strip()[:500]
                hint = str(d.get("hint") or "").strip()[:20]
                suggested_turn = int(d.get("suggested_turn") or 0)
                if not title or not base_condition:
                    continue

                ep = await generate_quick_ending_epilogue(
                    name=name,
                    description=one_line,
                    world_setting=world_setting,
                    opening_intro=intro or "",
                    opening_first_line=first_line or "",
                    ending_title=title,
                    base_condition=base_condition,
                    hint=hint,
                    extra_conditions=[],
                    mode=character_type,
                    sim_variant=None,
                    sim_dating_elements=sim_dating_elements,
                    tags=tag_slugs,
                    ai_model=ai_model,
                )
                ep = str(ep or "").strip()
                if not ep:
                    continue

                endings.append({
                    "id": f"end_qc_{uuid.uuid4().hex[:10]}",
                    "turn": max(0, suggested_turn),
                    "title": title,
                    "base_condition": base_condition,
                    "epilogue": ep[:1000],
                    "hint": hint,
                    "extra_conditions": [],
                })
            except Exception as e:
                # 방어: 엔딩 생성은 재시도할 수 있으므로, 시도 단위 실패는 로깅 후 continue
                try:
                    logger.exception(f"[characters.quick-create-30s] ending generation attempt failed (attempt={attempts}): {e}")
                except Exception:
                    pass
                continue

        if len(endings) < 1:
            raise HTTPException(status_code=500, detail="quick_create_failed: ending_generation_failed")

        # =========================
        # 3) start_sets(SSOT) 구성
        # =========================
        opening_id = "set_1"
        start_set_item = {
            "id": opening_id,
            "title": "오프닝 1",
            "intro": str(intro or "")[:2000],
            "firstLine": str(first_line or "")[:500],
            "turn_events": turn_events if isinstance(turn_events, list) else [],
            "ending_settings": {
                "min_turns": 30,
                "endings": endings,
            },
        }
        if character_type == "simulator":
            start_set_item["stat_settings"] = {"stats": stats}
        elif stats:
            # ✅ RP도 스탯이 있으면 저장(표시 UI는 별도이지만, 런타임 주입/일관성에 유용)
            start_set_item["stat_settings"] = {"stats": stats}

        start_sets = {
            "selectedId": opening_id,
            "items": [start_set_item],
            "setting_book": setting_book,
            # UI 상단 프로필 옵션과의 호환(프론트는 여기서 max_turns를 읽음)
            "sim_options": {"max_turns": max_turns, "allow_infinite_mode": False, "sim_dating_elements": bool(sim_dating_elements)},
        }

        # =========================
        # 4) 고급 생성(저장) + 태그 연결
        # =========================
        character_data = CharacterCreateRequest(
            basic_info={
                "name": name,
                "description": one_line,
                "personality": merged_personality or "",
                "speech_style": detail_speech or "",
                "greeting": str(first_line or "")[:500],
                "world_setting": str(world_setting or "")[:6000],
                "user_display_description": None,
                "use_custom_description": False,
                "introduction_scenes": [{"title": "오프닝 1", "content": str(intro or "")[:2000], "secret": ""}],
                "start_sets": start_sets,
                "character_type": character_type,
                "base_language": "ko",
            },
            media_settings={
                "avatar_url": image_url,
                "image_descriptions": [{"url": image_url, "description": "", "keywords": []}],
                "voice_settings": None,
            },
            publish_settings={"is_public": True, "custom_module_id": None, "use_translation": True},
        )

        character = await create_advanced_character(db=db, creator_id=current_user.id, character_data=character_data)
        if not character:
            raise HTTPException(status_code=500, detail="quick_create_failed: character_create_failed")

        # 태그 연결(슬러그 기반, 없으면 자동 생성)
        if tag_slugs:
            try:
                await set_character_tags(
                    character_id=character.id,
                    payload=CharacterTagsUpdate(tags=tag_slugs),
                    current_user=current_user,
                    db=db,
                )
            except Exception as e:
                # 태그는 필수 메타(성향/스타일)이므로 실패 시 전체 실패로 취급(데모 안정)
                try:
                    logger.exception(f"[characters.quick-create-30s] set tags failed: {e}")
                except Exception:
                    pass
                raise HTTPException(status_code=500, detail="quick_create_failed: tag_attach_failed")

        # idempotency 저장(선택)
        if idem_key:
            try:
                await redis_client.set(idem_key, str(character.id), ex=3600)
            except Exception as e:
                try:
                    logger.warning(f"[characters.quick-create-30s] redis set failed (idem_key): {e}")
                except Exception:
                    pass

        return await convert_character_to_detail_response(character, db)
    finally:
        # 락 해제(선택)
        if lock_key:
            try:
                await redis_client.delete(lock_key)
            except Exception as e:
                try:
                    logger.warning(f"[characters.quick-create-30s] redis delete failed (lock_key): {e}")
                except Exception:
                    pass


@router.post("/quick-generate-prompt", response_model=QuickPromptGenerateResponse)
async def quick_generate_prompt(
    payload: QuickPromptGenerateRequest,
    current_user: User = Depends(get_current_active_user),
):
    """
    위저드(일반 캐릭터) '프롬프트' 단계 자동 생성.

    현재:
    - simulator 모드만 지원(요구사항)
    - DB 저장은 하지 않는다(SSOT: 실제 저장은 /characters/advanced)
    """
    try:
        # ✅ 운영 고정(요구사항): 위저드 quick-*는 Gemini 3 Pro로 고정
        forced_ai_model = "gemini"
        mode = getattr(payload, "mode", None) or "simulator"
        max_turns = getattr(payload, "max_turns", None) or 200
        allow_infinite_mode = bool(getattr(payload, "allow_infinite_mode", False))
        if mode == "simulator":
            prompt_text = await generate_quick_simulator_prompt(
                name=payload.name,
                description=payload.description,
                max_turns=max_turns,
                allow_infinite_mode=allow_infinite_mode,
                tags=getattr(payload, "tags", []) or [],
                ai_model=forced_ai_model,
                sim_variant=getattr(payload, "sim_variant", None),
                sim_dating_elements=getattr(payload, "sim_dating_elements", None),
            )
            stats = await generate_quick_stat_draft(
                name=payload.name,
                description=payload.description,
                world_setting=prompt_text,
                mode=mode,
                tags=getattr(payload, "tags", []) or [],
                ai_model=forced_ai_model,
            )
        elif mode == "roleplay":
            prompt_text = await generate_quick_roleplay_prompt(
                name=payload.name,
                description=payload.description,
                max_turns=max_turns,
                allow_infinite_mode=allow_infinite_mode,
                tags=getattr(payload, "tags", []) or [],
                ai_model=forced_ai_model,
            )
            # ✅ RP: 상태창은 선택 항목이므로 기본은 비움(운영 안전)
            stats = await generate_quick_stat_draft(
                name=payload.name,
                description=payload.description,
                world_setting=prompt_text,
                mode=mode,
                tags=getattr(payload, "tags", []) or [],
                ai_model=forced_ai_model,
            )
        else:
            raise HTTPException(status_code=400, detail="mode_not_supported")

        return QuickPromptGenerateResponse(prompt=prompt_text, stats=stats or [])
    except HTTPException:
        raise
    except Exception as e:
        try:
            logger.exception(f"[characters.quick-generate-prompt] failed: {e}")
        except Exception:
            pass
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"quick_generate_prompt_failed: {str(e)}"
        )


@router.post("/quick-generate-stat", response_model=QuickStatGenerateResponse)
async def quick_generate_stat(
    payload: QuickStatGenerateRequest,
    current_user: User = Depends(get_current_active_user),
):
    """
    위저드/다음단계 자동완성 공용: 스탯 초안만 생성한다.

    의도/원리:
    - 유저가 프롬프트를 수동으로 작성하면 스탯 블록이 없을 수 있다.
    - 이 경우에도 프로필/태그/프롬프트를 종합해 스탯 탭을 채워야 UX가 끊기지 않는다.

    주의:
    - DB 저장은 하지 않는다(SSOT: 실제 저장은 /characters/advanced).
    """
    try:
        forced_ai_model = "gemini"
        mode = getattr(payload, "mode", None) or "simulator"
        if mode not in ("simulator", "roleplay"):
            raise HTTPException(status_code=400, detail="mode_not_supported")

        stats = await generate_quick_stat_draft(
            name=payload.name,
            description=payload.description,
            world_setting=payload.world_setting,
            mode=mode,
            tags=getattr(payload, "tags", []) or [],
            ai_model=forced_ai_model,
        )
        return QuickStatGenerateResponse(stats=stats or [])
    except HTTPException:
        raise
    except Exception as e:
        try:
            logger.exception(f"[characters.quick-generate-stat] failed: {e}")
        except Exception:
            pass
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"quick_generate_stat_failed: {str(e)}"
        )


@router.post("/quick-generate-first-start", response_model=QuickFirstStartGenerateResponse)
async def quick_generate_first_start(
    payload: QuickFirstStartGenerateRequest,
    current_user: User = Depends(get_current_active_user),
):
    """
    위저드(일반 캐릭터) '첫시작(도입부+첫대사)' 자동 생성.

    조건:
    - 프롬프트(world_setting)가 작성되어 있어야 한다.
    - 300~1000자(도입부+첫대사 합산)로 생성한다.
    """
    try:
        # ✅ 운영 고정(요구사항): 위저드 quick-*는 Gemini 3 Pro로 고정
        forced_ai_model = "gemini"
        intro, first_line = await generate_quick_first_start(
            name=payload.name,
            description=payload.description,
            world_setting=payload.world_setting,
            mode=getattr(payload, "mode", None),
            sim_variant=getattr(payload, "sim_variant", None),
            sim_dating_elements=getattr(payload, "sim_dating_elements", None),
            tags=getattr(payload, "tags", []) or [],
            ai_model=forced_ai_model,
            avoid_intro=getattr(payload, "avoid_intro", None),
            avoid_first_line=getattr(payload, "avoid_first_line", None),
        )
        return QuickFirstStartGenerateResponse(intro=intro, first_line=first_line)
    except Exception as e:
        try:
            logger.exception(f"[characters.quick-generate-first-start] failed: {e}")
        except Exception:
            pass
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"quick_generate_first_start_failed: {str(e)}"
        )


@router.post("/quick-generate-detail", response_model=QuickDetailGenerateResponse)
async def quick_generate_detail(
    payload: QuickDetailGenerateRequest,
    current_user: User = Depends(get_current_active_user),
):
    """
    위저드(일반 캐릭터) '디테일' 자동 생성.

    조건:
    - 프롬프트(world_setting)가 작성되어 있어야 한다(요구사항).
    - 관심사/좋아하는 것/싫어하는 것: 키워드 3개씩.
    """
    try:
        # ✅ 운영 고정(요구사항): 위저드 quick-*는 Gemini 3 Pro로 고정
        forced_ai_model = "gemini"
        out = await generate_quick_detail(
            name=payload.name,
            description=payload.description,
            world_setting=payload.world_setting,
            mode=getattr(payload, "mode", None),
            section_modes=getattr(payload, "section_modes", None),
            tags=getattr(payload, "tags", []) or [],
            ai_model=forced_ai_model,
        )
        return QuickDetailGenerateResponse(**out)
    except Exception as e:
        try:
            logger.exception(f"[characters.quick-generate-detail] failed: {e}")
        except Exception:
            pass
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"quick_generate_detail_failed: {str(e)}"
        )


@router.post("/quick-generate-secret", response_model=QuickSecretGenerateResponse)
async def quick_generate_secret(
    payload: QuickSecretGenerateRequest,
    current_user: User = Depends(get_current_active_user),
):
    """
    위저드(일반 캐릭터) '비밀정보(secret)' 자동 생성.

    조건:
    - 프롬프트(world_setting)가 작성되어 있어야 한다(요구사항).
    - 유저에게 노출되면 안 되는 비밀 설정을 200~600자 수준으로 생성한다.
    """
    try:
        # ✅ 운영 고정(요구사항): 위저드 quick-*는 Gemini 3 Pro로 고정
        forced_ai_model = "gemini"
        secret_text = await generate_quick_secret_info(
            name=payload.name,
            description=payload.description,
            world_setting=payload.world_setting,
            tags=getattr(payload, "tags", []) or [],
            ai_model=forced_ai_model,
        )
        if not secret_text:
            raise HTTPException(status_code=500, detail="quick_generate_secret_failed: empty_secret")
        return QuickSecretGenerateResponse(secret=secret_text)
    except HTTPException:
        raise
    except Exception as e:
        try:
            logger.exception(f"[characters.quick-generate-secret] failed: {e}")
        except Exception:
            pass
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"quick_generate_secret_failed: {str(e)}"
        )


@router.post("/quick-generate-turn-events", response_model=QuickTurnEventsGenerateResponse)
async def quick_generate_turn_events(
    payload: QuickTurnEventsGenerateRequest,
    current_user: User = Depends(get_current_active_user),
):
    """
    위저드(일반 캐릭터) '턴수별 사건' 자동 생성.

    요구사항:
    - 진행 턴수(max_turns)에 따라 생성 개수 상한을 강제한다(50/100/200/300/커스텀).
    - 초반부 사건 빈도를 높게 생성한다.
    - DB 저장은 하지 않는다(SSOT: 실제 저장은 /characters/advanced).
    """
    try:
        # ✅ 운영 고정(요구사항): 위저드 quick-*는 Gemini 3 Pro로 고정
        forced_ai_model = "gemini"
        events = await generate_quick_turn_events(
            name=payload.name,
            description=payload.description,
            world_setting=payload.world_setting,
            opening_intro=payload.opening_intro,
            opening_first_line=payload.opening_first_line,
            mode=getattr(payload, "mode", None),
            max_turns=getattr(payload, "max_turns", None) or 200,
            sim_variant=getattr(payload, "sim_variant", None),
            sim_dating_elements=getattr(payload, "sim_dating_elements", None),
            tags=getattr(payload, "tags", []) or [],
            ai_model=forced_ai_model,
        )
        return QuickTurnEventsGenerateResponse(turn_events=events or [])
    except Exception as e:
        try:
            logger.exception(f"[characters.quick-generate-turn-events] failed: {e}")
        except Exception:
            pass
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"quick_generate_turn_events_failed: {str(e)}"
        )


@router.post("/quick-generate-ending-draft", response_model=QuickEndingDraftGenerateResponse)
async def quick_generate_ending_draft(
    payload: QuickEndingDraftGenerateRequest,
    current_user: User = Depends(get_current_active_user),
):
    """
    위저드(일반 캐릭터) '엔딩 제목/기본조건' 자동 생성.

    원칙:
    - DB 저장은 하지 않는다(SSOT: 실제 저장은 /characters/advanced).
    - 프론트 입력 필드(start_sets.items[].ending_settings.endings[])에 채울 "초안 데이터"만 생성한다.
    """
    try:
        # ✅ 운영 고정(요구사항): 위저드 quick-*는 Gemini 3 Pro로 고정
        forced_ai_model = "gemini"
        d = await generate_quick_ending_draft(
            name=payload.name,
            description=payload.description,
            world_setting=payload.world_setting,
            opening_intro=getattr(payload, "opening_intro", "") or "",
            opening_first_line=getattr(payload, "opening_first_line", "") or "",
            mode=getattr(payload, "mode", None),
            max_turns=getattr(payload, "max_turns", None) or 200,
            min_turns=getattr(payload, "min_turns", None) or 30,
            sim_variant=getattr(payload, "sim_variant", None),
            sim_dating_elements=getattr(payload, "sim_dating_elements", None),
            tags=getattr(payload, "tags", []) or [],
            ai_model=forced_ai_model,
        )
        title = str((d or {}).get("title") or "").strip()
        base_condition = str((d or {}).get("base_condition") or "").strip()
        hint = str((d or {}).get("hint") or "").strip()
        suggested_turn = int((d or {}).get("suggested_turn") or 0)
        if not title or not base_condition:
            raise HTTPException(status_code=500, detail="quick_generate_ending_draft_failed: empty_fields")
        return QuickEndingDraftGenerateResponse(
            title=title[:20],
            base_condition=base_condition[:500],
            hint=hint[:20],
            suggested_turn=max(0, suggested_turn),
        )
    except HTTPException:
        raise
    except Exception as e:
        try:
            logger.exception(f"[characters.quick-generate-ending-draft] failed: {e}")
        except Exception:
            pass
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"quick_generate_ending_draft_failed: {str(e)}"
        )


@router.post("/quick-generate-ending-epilogue", response_model=QuickEndingEpilogueGenerateResponse)
async def quick_generate_ending_epilogue(
    payload: QuickEndingEpilogueGenerateRequest,
    current_user: User = Depends(get_current_active_user),
):
    """
    위저드(일반 캐릭터) '엔딩 내용(에필로그)' 자동 생성.

    원칙:
    - DB 저장은 하지 않는다(SSOT: 실제 저장은 /characters/advanced).
    - 프론트 입력 필드(start_sets.ending_settings.endings[].epilogue)에 채울 초안 텍스트만 생성한다.
    """
    try:
        # ✅ 운영 고정(요구사항): 위저드 quick-*는 Gemini 3 Pro로 고정
        forced_ai_model = "gemini"
        ep = await generate_quick_ending_epilogue(
            name=payload.name,
            description=payload.description,
            world_setting=payload.world_setting,
            opening_intro=getattr(payload, "opening_intro", "") or "",
            opening_first_line=getattr(payload, "opening_first_line", "") or "",
            ending_title=payload.ending_title,
            base_condition=payload.base_condition,
            hint=getattr(payload, "hint", "") or "",
            extra_conditions=getattr(payload, "extra_conditions", None) or [],
            mode=getattr(payload, "mode", None),
            sim_variant=getattr(payload, "sim_variant", None),
            sim_dating_elements=getattr(payload, "sim_dating_elements", None),
            tags=getattr(payload, "tags", []) or [],
            ai_model=forced_ai_model,
        )
        ep = (ep or "").strip()
        if not ep:
            raise HTTPException(status_code=500, detail="quick_generate_ending_epilogue_failed: empty_epilogue")
        return QuickEndingEpilogueGenerateResponse(epilogue=ep[:1000])
    except HTTPException:
        raise
    except Exception as e:
        try:
            logger.exception(f"[characters.quick-generate-ending-epilogue] failed: {e}")
        except Exception:
            pass
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"quick_generate_ending_epilogue_failed: {str(e)}"
        )

@router.post("/advanced", response_model=CharacterDetailResponse, status_code=status.HTTP_201_CREATED)
async def create_advanced_character_endpoint(
    character_data: CharacterCreateRequest,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    """CAVEDUCK 스타일 고급 캐릭터 생성 (5단계)"""
    try:
        # 🔥 실제 고급 캐릭터 생성 서비스 호출
        character = await create_advanced_character(
            db=db,
            creator_id=current_user.id,
            character_data=character_data
        )
        
        # 완전한 상세 정보 반환
        return await convert_character_to_detail_response(character, db)
        
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"캐릭터 생성 중 오류가 발생했습니다: {str(e)}"
        )


@router.put("/advanced/{character_id}", response_model=CharacterDetailResponse)
async def update_advanced_character_endpoint(
    character_id: uuid.UUID,
    character_data: CharacterUpdateRequest,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    """CAVEDUCK 스타일 고급 캐릭터 수정"""
    character = await get_character_by_id(db, character_id)
    if not character:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="캐릭터를 찾을 수 없습니다."
        )
    
    # 생성자만 수정 가능
    if character.creator_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="이 캐릭터를 수정할 권한이 없습니다."
        )
    
    try:
        # 🔥 실제 고급 캐릭터 수정 서비스 호출
        updated_character = await update_advanced_character(
            db=db,
            character_id=character_id,
            character_data=character_data
        )
        
        if not updated_character:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="캐릭터를 찾을 수 없습니다."
            )
        
        return await convert_character_to_detail_response(updated_character, db)
        
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"캐릭터 수정 중 오류가 발생했습니다: {str(e)}"
        )


@router.get("/advanced/{character_id}", response_model=CharacterDetailResponse)
async def get_advanced_character_detail(
    character_id: uuid.UUID,
    current_user: Optional[User] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """CAVEDUCK 스타일 고급 캐릭터 상세 조회"""
    character = await get_advanced_character_by_id(db, character_id)
    if not character:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="캐릭터를 찾을 수 없습니다."
        )
    
    # 비공개 캐릭터는 생성자/관리자만 조회 가능
    if not character.is_public and (
        (not current_user)
        or (character.creator_id != current_user.id and not getattr(current_user, "is_admin", False))
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="이 캐릭터에 접근할 권한이 없습니다."
        )
    
    return await convert_character_to_detail_response(character, db)


async def convert_character_to_detail_response(character: Character, db: AsyncSession) -> CharacterDetailResponse:
    """캐릭터 모델을 상세 응답으로 변환"""
    # 예시 대화 조회
    example_dialogues = await get_character_example_dialogues(db, character.id)

    if settings.ENVIRONMENT == "production":
        # JSON/기본값 보정 (마이그레이션 데이터 대비)
        def _parse_json(v):
            if isinstance(v, str):
                try:
                    return json.loads(v)
                except Exception:
                    return None
            return v

        imgs = _parse_json(getattr(character, 'image_descriptions', None)) or []
        if isinstance(imgs, list):
            imgs = [img for img in imgs if not (isinstance(img, dict) and str(img.get('url','')).startswith('cover:'))]
        intro = _parse_json(getattr(character, 'introduction_scenes', None)) or []
        voice = _parse_json(getattr(character, 'voice_settings', None)) or None
        start_sets = _parse_json(getattr(character, 'start_sets', None)) or None

        return CharacterDetailResponse(
            id=character.id,
            creator_id=character.creator_id,
            name=character.name,
            description=getattr(character, 'description', None),
            personality=getattr(character, 'personality', None),
            speech_style=getattr(character, 'speech_style', None),
            greeting=getattr(character, 'greeting', None),
            origin_story_id=getattr(character, 'origin_story_id', None),
            world_setting=getattr(character, 'world_setting', None),
            user_display_description=getattr(character, 'user_display_description', None),
            use_custom_description=bool(getattr(character, 'use_custom_description', False)),
            introduction_scenes=intro,
            start_sets=start_sets,
            character_type=getattr(character, 'character_type', 'roleplay'),
            base_language=getattr(character, 'base_language', 'ko'),
            avatar_url=getattr(character, 'avatar_url', None),
            image_descriptions=imgs if isinstance(imgs, list) else None,
            voice_settings=voice,
            example_dialogues=[
                CharacterExampleDialogueResponse(
                    id=d.id,
                    user_message=d.user_message,
                    character_response=d.character_response,
                    order_index=d.order_index,
                    created_at=(getattr(d, 'created_at', None) or datetime.now(timezone.utc))
                ) for d in example_dialogues
            ],
            has_affinity_system=bool(getattr(character, 'has_affinity_system', False)),
            affinity_rules=getattr(character, 'affinity_rules', None),
            affinity_stages=_parse_json(getattr(character, 'affinity_stages', None)) or [],
            is_public=bool(getattr(character, 'is_public', True)),
            is_active=bool(getattr(character, 'is_active', True)),
            custom_module_id=getattr(character, 'custom_module_id', None),
            use_translation=bool(getattr(character, 'use_translation', True)),
            chat_count=int(getattr(character, 'chat_count', 0) or 0),
            like_count=int(getattr(character, 'like_count', 0) or 0),
            created_at=(getattr(character, 'created_at', None) or datetime.now(timezone.utc)),
            updated_at=(getattr(character, 'updated_at', None) or datetime.now(timezone.utc)),
            creator_username=character.creator.username if character.creator else None,
            creator_avatar_url=character.creator.avatar_url if character.creator else None,
        )

    # 개발환경: 기존 로직 유지
    return CharacterDetailResponse(
        id=character.id,
        creator_id=character.creator_id,
        name=character.name,
        description=character.description,
        personality=character.personality,
        speech_style=character.speech_style,
        greeting=character.greeting,
        origin_story_id=getattr(character, 'origin_story_id', None),
        world_setting=getattr(character, 'world_setting', None),
        user_display_description=getattr(character, 'user_display_description', None),
        use_custom_description=getattr(character, 'use_custom_description', False),
        introduction_scenes=getattr(character, 'introduction_scenes', []),
        start_sets=getattr(character, 'start_sets', None),
        character_type=getattr(character, 'character_type', 'roleplay'),
        base_language=getattr(character, 'base_language', 'ko'),
        avatar_url=character.avatar_url,
        image_descriptions=getattr(character, 'image_descriptions', []),
        voice_settings=getattr(character, 'voice_settings', None),
        example_dialogues=[
            CharacterExampleDialogueResponse(
                id=dialogue.id,
                user_message=dialogue.user_message,
                character_response=dialogue.character_response,
                order_index=dialogue.order_index,
                created_at=(getattr(dialogue, 'created_at', None) or datetime.now(timezone.utc))
            ) for dialogue in example_dialogues
        ],
        has_affinity_system=getattr(character, 'has_affinity_system', False),
        affinity_rules=getattr(character, 'affinity_rules', None),
        affinity_stages=getattr(character, 'affinity_stages', []),
        is_public=character.is_public,
        is_active=character.is_active,
        custom_module_id=getattr(character, 'custom_module_id', None),
        use_translation=getattr(character, 'use_translation', True),
        chat_count=character.chat_count,
        like_count=character.like_count,
        created_at=character.created_at,
        updated_at=character.updated_at,
        creator_username=character.creator.username if character.creator else None,
        creator_avatar_url=character.creator.avatar_url if character.creator else None
    )


# 🏷️ 캐릭터-태그 관리 API
@router.get("/{character_id}/tags", response_model=List[TagResponse])
async def get_character_tags(
    character_id: uuid.UUID,
    db: AsyncSession = Depends(get_db)
):
    character = await get_character_by_id(db, character_id)
    if not character:
        raise HTTPException(status_code=404, detail="캐릭터를 찾을 수 없습니다.")
    # 관계 프리로드 후 단순 반환 (정렬은 이름순)
    await db.refresh(character)
    result = await db.execute(
        select(Tag).join(CharacterTag, CharacterTag.tag_id == Tag.id)
        .where(CharacterTag.character_id == character_id)
        .order_by(Tag.name)
    )
    return result.scalars().all()


@router.put("/{character_id}/tags", response_model=List[TagResponse])
async def set_character_tags(
    character_id: uuid.UUID,
    payload: CharacterTagsUpdate,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    character = await get_character_by_id(db, character_id)
    if not character:
        raise HTTPException(status_code=404, detail="캐릭터를 찾을 수 없습니다.")
    if character.creator_id != current_user.id:
        raise HTTPException(status_code=403, detail="권한이 없습니다.")

    # 기존 연결 삭제
    await db.execute(delete(CharacterTag).where(CharacterTag.character_id == character_id))

    # slugs → Tag 조회
    if payload.tags:
        # 1) 기존 태그 조회
        tag_rows = (await db.execute(select(Tag).where(Tag.slug.in_(payload.tags)))).scalars().all()
        existing_slugs = {t.slug for t in tag_rows}
        # 2) 누락된 슬러그는 자동 생성해 전역 태그 테이블에 등록
        missing_slugs = [s for s in payload.tags if s not in existing_slugs]
        for slug in missing_slugs:
            try:
                new_tag = Tag(name=slug, slug=slug)
                db.add(new_tag)
                await db.flush()
                tag_rows.append(new_tag)
            except Exception:
                # 유니크 충돌 등은 무시하고 넘어감 (동시 생성 방지)
                pass
        # 3) 연결 재생성
        for t in tag_rows:
            await db.execute(insert(CharacterTag).values(character_id=character_id, tag_id=t.id))
    await db.commit()

    result = await db.execute(select(Tag).join(Tag.characters).where(Tag.characters.any(id=character_id)))
    return result.scalars().all()


# 🌍 세계관 관리 API

@router.post("/world-settings", response_model=WorldSettingResponse, status_code=status.HTTP_201_CREATED)
async def create_world_setting(
    world_data: WorldSettingCreate,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    """세계관 설정 생성"""
    # TODO: 세계관 생성 서비스 구현
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail="세계관 생성 기능은 곧 구현됩니다."
    )


@router.get("/world-settings", response_model=List[WorldSettingResponse])
async def get_world_settings(
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    """내 세계관 설정 목록 조회"""
    # TODO: 세계관 목록 조회 서비스 구현
    return []


# 🔧 커스텀 모듈 API

@router.post("/custom-modules", response_model=CustomModuleResponse, status_code=status.HTTP_201_CREATED)
async def create_custom_module(
    module_data: CustomModuleCreate,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    """커스텀 모듈 생성 (고급 사용자용)"""
    # TODO: 커스텀 모듈 생성 서비스 구현
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail="커스텀 모듈 기능은 곧 구현됩니다."
    )


@router.get("/custom-modules", response_model=List[CustomModuleResponse])
async def get_custom_modules(
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    """내 커스텀 모듈 목록 조회"""
    # TODO: 커스텀 모듈 목록 조회 서비스 구현
    return []


# 📊 캐릭터 통계 API

@router.get("/{character_id}/stats")
async def get_character_stats(
    character_id: uuid.UUID,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    """캐릭터 통계 조회 (생성자만)"""
    character = await get_character_by_id(db, character_id)
    if not character:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="캐릭터를 찾을 수 없습니다."
        )
    
    # 생성자만 통계 조회 가능
    if character.creator_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="이 캐릭터의 통계를 조회할 권한이 없습니다."
        )
    
    # TODO: 상세 통계 구현
    return {
        "character_id": character_id,
        "total_chats": character.chat_count,
        "total_likes": character.like_count,
        "created_at": character.created_at,
        "last_chat_at": None,  # TODO: 마지막 채팅 시간
        "daily_stats": [],  # TODO: 일별 통계
        "popular_phrases": []  # TODO: 인기 문구
    }


# 🔄 레거시 호환성 API (기존 API 유지)

@router.post("/", response_model=CharacterResponse, status_code=status.HTTP_201_CREATED)
async def create_new_character(
    character_data: CharacterCreate,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    """새 캐릭터 생성 (레거시)"""
    character = await create_character(
        db=db,
        creator_id=current_user.id,
        character_data=character_data
    )
    return character


@router.get("/", response_model=List[CharacterListResponse])
async def get_characters(
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    search: Optional[str] = Query(None, max_length=100),
    creator_id: Optional[uuid.UUID] = Query(None),
    sort: Optional[str] = Query(None, description="정렬: views|likes|recent"),
    source_type: Optional[str] = Query(None, description="생성 출처: ORIGINAL|IMPORTED"),
    tags: Optional[str] = Query(None, description="필터 태그 목록(콤마 구분 slug)"),
    gender: Optional[str] = Query(None, description="성별 필터: all|male|female|other (태그 기반)"),
    only: Optional[str] = Query(None, description="origchat|regular"),
    db: AsyncSession = Depends(get_db)
):
    """캐릭터 목록 조회"""
    if creator_id:
        # 특정 사용자의 캐릭터 조회
        characters = await get_characters_by_creator(
            db=db,
            creator_id=creator_id,
            skip=skip,
            limit=limit,
            search=search
        )
    else:
        # 공개 캐릭터 조회
        # only 파라미터가 없으면 전체(원작챗 포함) 조회
        characters = await get_public_characters(
            db=db,
            skip=skip,
            limit=limit,
            search=search,
            sort=sort,
            source_type=source_type,
            tags=[s for s in (tags.split(',') if tags else []) if s],
            gender=gender,
            only=only,
        )

    # ✅ 방어적 2차 필터(중요: 비공개 누출 방지)
    # - 원작챗 캐릭터(origin_story_id가 있는 캐릭터)는 "원작 스토리"가 공개일 때만 공개 목록에 노출해야 한다.
    # - get_public_characters에서 1차로 Story.is_public 필터를 걸었더라도,
    #   운영/마이그레이션/조인/캐시 등으로 누락될 수 있어 응답 직전 한 번 더 차단한다(보수적).
    try:
        origin_story_ids = []
        for ch in (characters or []):
            oid = getattr(ch, "origin_story_id", None)
            if oid:
                origin_story_ids.append(oid)

        if origin_story_ids:
            from app.models.story import Story

            rows = await db.execute(
                select(Story.id, Story.is_public).where(Story.id.in_(origin_story_ids))
            )
            story_public_by_id = {str(r[0]): (r[1] is True) for r in (rows.all() or [])}

            filtered = []
            removed = 0
            for ch in (characters or []):
                oid = getattr(ch, "origin_story_id", None)
                if not oid:
                    filtered.append(ch)
                    continue
                if story_public_by_id.get(str(oid)) is True:
                    filtered.append(ch)
                else:
                    removed += 1

            if removed:
                try:
                    logger.warning(
                        f"[characters] defensive_filter removed {removed} origchat characters (private/missing origin story) from public listing"
                    )
                except Exception:
                    pass

            characters = filtered
    except Exception as e:
        # 확인 실패 시에도 노출을 막는 것이 안전하다(보수적).
        try:
            logger.exception(f"[characters] defensive_filter failed: {e}")
        except Exception:
            pass
        try:
            characters = [ch for ch in (characters or []) if not getattr(ch, "origin_story_id", None)]
        except Exception:
            pass

    # 일관된 응답: creator_username 포함하여 매핑
    if settings.ENVIRONMENT == "production":
        items: List[CharacterListResponse] = []
        for char in characters:
            try:
                imgs = getattr(char, 'image_descriptions', None)
                # normalize image_descriptions to list[dict]
                if isinstance(imgs, str):
                    try:
                        imgs = json.loads(imgs)
                    except Exception:
                        imgs = None
                if imgs and isinstance(imgs, list):
                    # filter out cover: URLs
                    imgs = [img for img in imgs if not (isinstance(img, dict) and str(img.get('url','')).startswith('cover:'))]
                item = CharacterListResponse(
                    id=char.id,
                    creator_id=char.creator_id,
                    name=char.name,
                    description=getattr(char, 'description', None),
                    greeting=getattr(char, 'greeting', None),
                    avatar_url=getattr(char, 'avatar_url', None),
                    source_type=getattr(char, 'source_type', 'ORIGINAL'),
                    character_type=getattr(char, "character_type", None),
                    max_turns=_extract_max_turns_from_start_sets(getattr(char, "start_sets", None)),
                    image_descriptions=imgs if isinstance(imgs, list) else None,
                    origin_story_id=getattr(char, 'origin_story_id', None),
                    is_origchat=bool(getattr(char, 'origin_story_id', None)),
                    chat_count=int(getattr(char, 'chat_count', 0) or 0),
                    like_count=int(getattr(char, 'like_count', 0) or 0),
                    is_public=bool(getattr(char, 'is_public', True)),
                    created_at=(getattr(char, 'created_at', None) or datetime.now(timezone.utc)),
                    creator_username=char.creator.username if getattr(char, 'creator', None) else None,
                    creator_avatar_url=char.creator.avatar_url if getattr(char, 'creator', None) else None,
                )
                items.append(item)
            except Exception as e:
                try:
                    logger.warning(f"characters list serialization skipped id={getattr(char,'id',None)}: {e}")
                except Exception:
                    pass
                continue
        return items
    else:
        return [
            CharacterListResponse(
                id=char.id,
                creator_id=char.creator_id,
                name=char.name,
                description=char.description,
                greeting=char.greeting,
                avatar_url=char.avatar_url,
                source_type=getattr(char, 'source_type', 'ORIGINAL'),
                character_type=getattr(char, "character_type", None),
                max_turns=_extract_max_turns_from_start_sets(getattr(char, "start_sets", None)),
                image_descriptions=[
                    img for img in (getattr(char, 'image_descriptions', []) or [])
                    if not (isinstance(img, dict) and str(img.get('url','')).startswith('cover:'))
                ],
                origin_story_id=getattr(char, 'origin_story_id', None),
                is_origchat=bool(getattr(char, 'origin_story_id', None)),
                chat_count=char.chat_count,
                like_count=char.like_count,
                is_public=char.is_public,
                created_at=char.created_at,
                creator_username=char.creator.username if getattr(char, 'creator', None) else None,
                creator_avatar_url=char.creator.avatar_url if getattr(char, 'creator', None) else None,
            ) for char in characters
        ]


@router.get("/my", response_model=List[CharacterListResponse])
async def get_my_characters(
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    only: Optional[str] = Query(None, description="origchat|regular"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """내 캐릭터 목록 조회
    - 공개/비공개 모두 포함
    - 응답 스키마로 일관 매핑(creator_username 포함)
    """
    characters = await get_characters_by_creator(
        db=db,
        creator_id=current_user.id,
        skip=skip,
        limit=limit,
        include_private=True,
        only=only,
    )

    # ✅ 운영 방어: legacy 데이터에서 image_descriptions가 str(JSON)로 저장된 경우가 있어
    # 응답 스키마(List[dict]) 검증에서 500이 날 수 있다.
    # - /me/characters/* 와 동일 규칙으로 안전하게 정규화한다.
    items: List[CharacterListResponse] = []
    for char in (characters or []):
        try:
            imgs = getattr(char, 'image_descriptions', None)
            if isinstance(imgs, str):
                try:
                    imgs = json.loads(imgs)
                except Exception:
                    imgs = None
            if imgs and isinstance(imgs, list):
                imgs = [
                    img
                    for img in imgs
                    if not (isinstance(img, dict) and str(img.get('url', '')).startswith('cover:'))
                ]

            items.append(
                CharacterListResponse(
                    id=char.id,
                    creator_id=char.creator_id,
                    name=char.name,
                    description=getattr(char, 'description', None),
                    greeting=getattr(char, 'greeting', None),
                    avatar_url=getattr(char, 'avatar_url', None),
                    source_type=getattr(char, 'source_type', 'ORIGINAL'),
                    character_type=getattr(char, "character_type", None),
                    max_turns=_extract_max_turns_from_start_sets(getattr(char, "start_sets", None)),
                    image_descriptions=imgs if isinstance(imgs, list) else None,
                    origin_story_id=getattr(char, 'origin_story_id', None),
                    is_origchat=bool(getattr(char, 'origin_story_id', None)),
                    chat_count=int(getattr(char, 'chat_count', 0) or 0),
                    like_count=int(getattr(char, 'like_count', 0) or 0),
                    is_public=bool(getattr(char, 'is_public', True)),
                    created_at=(getattr(char, 'created_at', None) or datetime.now(timezone.utc)),
                    creator_username=char.creator.username if getattr(char, 'creator', None) else None,
                    creator_avatar_url=char.creator.avatar_url if getattr(char, 'creator', None) else None,
                )
            )
        except Exception as e:
            try:
                logger.warning(f"[characters] /my serialize skipped id={getattr(char,'id',None)}: {e}")
            except Exception:
                pass
            continue

    return items


# @router.get("/{character_id}", response_model=CharacterWithCreator)
# async def get_character(
#     character_id: uuid.UUID,
#     current_user: Optional[User] = Depends(get_current_user),
#     db: AsyncSession = Depends(get_db)
# ):
#     """캐릭터 상세 조회 (레거시)"""
#     character = await get_character_by_id(db, character_id)
#     if not character:
#         raise HTTPException(
#             status_code=status.HTTP_404_NOT_FOUND,
#             detail="캐릭터를 찾을 수 없습니다."
#         )
    
#     # 비공개 캐릭터는 생성자만 조회 가능
#     if not character.is_public and (not current_user or character.creator_id != current_user.id):
#         raise HTTPException(
#             status_code=status.HTTP_403_FORBIDDEN,
#             detail="이 캐릭터에 접근할 권한이 없습니다."
#         )
    
#     # 🔧 새로운 모델 구조와 호환되도록 수동으로 응답 구성
#     character_dict = {
#         "id": character.id,
#         "creator_id": character.creator_id, # 이 줄 추가
#         "name": character.name,
#         "description": character.description,
#         "personality": character.personality,
#         "speech_style": character.speech_style,
#         "greeting": character.greeting,
#         "background_story": getattr(character, 'world_setting', None),  # 세계관을 배경 스토리로 매핑
#         "avatar_url": character.avatar_url,
#         "is_public": character.is_public,
#         "is_active": character.is_active,
#         "chat_count": character.chat_count,
#         "like_count": character.like_count,
#         "created_at": character.created_at,
#         "updated_at": character.updated_at,
#         "creator_username": character.creator.username if character.creator else None
#     }
    
#     # 좋아요 상태 추가 (로그인한 사용자인 경우만)
#     if current_user:
#         character_dict["is_liked"] = await is_character_liked_by_user(db, character_id, current_user.id)
#     else:
#         character_dict["is_liked"] = False
    
#     return CharacterWithCreator(**character_dict)
@router.get("/{character_id}", response_model=CharacterDetailResponse) # 1. 응답 모델을 고급 버전으로 변경
async def get_character(
    character_id: uuid.UUID,
    background_tasks: BackgroundTasks,
    current_user: Optional[User] = Depends(get_current_user_optional),
    db: AsyncSession = Depends(get_db),
):
    """캐릭터 상세 조회 (고급 응답 모델 사용)"""
    # 2. 데이터를 가져오는 서비스도 고급 버전으로 변경
    character = await get_advanced_character_by_id(db, character_id) 
    if not character:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="캐릭터를 찾을 수 없습니다."
        )
    
    # 비공개 캐릭터는 생성자/관리자만 조회 가능
    if not character.is_public and (
        (not current_user)
        or (character.creator_id != current_user.id and not getattr(current_user, "is_admin", False))
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="이 캐릭터에 접근할 권한이 없습니다."
        )
    
    # 3. 🔥 고급 응답 모델로 변환하는 헬퍼 함수를 재사용
    response_data = await convert_character_to_detail_response(character, db)

    # 추가: 실시간 메시지 수로 동기화
    from app.services.character_service import get_real_message_count
    # real_count = await get_real_message_count(db, character_id)
    # response_data.chat_count = real_count
    real_count = await sync_character_chat_count(db, character_id)
    response_data.chat_count = await get_real_message_count(db, character_id)


    # 원작 스토리 카드용 보강 필드
    try:
        if response_data.origin_story_id:
            from sqlalchemy import select
            from app.models.story import Story
            from sqlalchemy.orm import joinedload
            s = (await db.execute(
                select(Story).where(Story.id == response_data.origin_story_id).options(joinedload(Story.creator))
            )).scalars().first()
            if s:
                response_data_dict = response_data.model_dump()
                response_data_dict["origin_story_title"] = s.title
                response_data_dict["origin_story_cover"] = getattr(s, "cover_url", None)
                response_data_dict["origin_story_creator"] = getattr(s.creator, "username", None) if getattr(s, "creator", None) else None
                response_data_dict["origin_story_views"] = int(s.view_count or 0)
                response_data_dict["origin_story_likes"] = int(s.like_count or 0)
                try:
                    text = (s.content or "").strip()
                    excerpt = " ".join(text.split())[:140] if text else None
                except Exception:
                    excerpt = None
                response_data_dict["origin_story_excerpt"] = excerpt
                response_data = CharacterDetailResponse(**response_data_dict)
    except Exception:
        pass
    
    # is_liked 상태 추가 (로그인한 사용자인 경우만)
    if current_user:
        response_data.is_liked = await is_character_liked_by_user(db, character_id, current_user.id)
    else:
        response_data.is_liked = False
    
    return response_data

@router.put("/{character_id}", response_model=CharacterResponse)
async def update_character_info(
    character_id: uuid.UUID,
    character_data: CharacterUpdate,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    """캐릭터 정보 수정"""
    character = await get_character_by_id(db, character_id)
    if not character:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="캐릭터를 찾을 수 없습니다."
        )
    
    # 생성자만 수정 가능
    if character.creator_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="이 캐릭터를 수정할 권한이 없습니다."
        )
    
    updated_character = await update_character(db, character_id, character_data)
    return updated_character


@router.patch("/{character_id}/toggle-public", response_model=CharacterResponse)
async def toggle_character_public_status(
    character_id: uuid.UUID,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    """캐릭터의 공개/비공개 상태를 토글합니다."""
    character = await get_character_by_id(db, character_id)
    if not character:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="캐릭터를 찾을 수 없습니다."
        )
    
    # 생성자/관리자만 상태 변경 가능
    if character.creator_id != current_user.id and not getattr(current_user, "is_admin", False):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="이 캐릭터의 공개 상태를 변경할 권한이 없습니다."
        )
        
    updated_character = await update_character_public_status(db, character_id, not character.is_public)
    
    return updated_character


@router.delete("/{character_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_character_info(
    character_id: uuid.UUID,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    """캐릭터 삭제"""
    character = await get_character_by_id(db, character_id)
    if not character:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="캐릭터를 찾을 수 없습니다."
        )
    
    # 생성자만 삭제 가능
    if character.creator_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="이 캐릭터를 삭제할 권한이 없습니다."
        )
    
    # ✅ 원작챗(등장인물 그리드) 동기화
    #
    # 요구사항:
    # - 크리에이터가 원작챗 캐릭터를 삭제하면, 스토리 상세의 "등장인물 그리드"에서도 다시 뜨면 안 된다.
    #
    # 구현:
    # - 해당 캐릭터를 참조하는 StoryExtractedCharacter 레코드를 삭제한다.
    # - (기존: character_id만 NULL 처리) → 고아 레코드가 남아 그리드에 "빈 캐릭터 카드"가 보이는 문제가 있었다.
    try:
        await db.execute(
            delete(StoryExtractedCharacter).where(StoryExtractedCharacter.character_id == character_id)
        )
        await db.commit()
    except Exception:
        try:
            await db.rollback()
        except Exception:
            pass
    await delete_character(db, character_id)


@router.post("/{character_id}/settings", response_model=CharacterSettingResponse, status_code=status.HTTP_201_CREATED)
async def create_character_settings(
    character_id: uuid.UUID,
    setting_data: CharacterSettingCreate,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    """캐릭터 설정 생성"""
    character = await get_character_by_id(db, character_id)
    if not character:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="캐릭터를 찾을 수 없습니다."
        )
    
    # 생성자만 설정 가능
    if character.creator_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="이 캐릭터의 설정을 변경할 권한이 없습니다."
        )
    
    setting = await create_character_setting(db, character_id, setting_data)
    return setting


@router.get("/{character_id}/settings", response_model=CharacterSettingResponse)
async def get_character_settings(
    character_id: uuid.UUID,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    """캐릭터 설정 조회"""
    character = await get_character_by_id(db, character_id)
    if not character:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="캐릭터를 찾을 수 없습니다."
        )
    
    # 생성자만 설정 조회 가능
    if character.creator_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="이 캐릭터의 설정을 조회할 권한이 없습니다."
        )
    
    setting = await get_character_setting(db, character_id)
    if not setting:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="캐릭터 설정을 찾을 수 없습니다."
        )
    
    return setting


@router.put("/{character_id}/settings", response_model=CharacterSettingResponse)
async def update_character_settings(
    character_id: uuid.UUID,
    setting_data: CharacterSettingUpdate,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    """캐릭터 설정 수정"""
    character = await get_character_by_id(db, character_id)
    if not character:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="캐릭터를 찾을 수 없습니다."
        )
    
    # 생성자만 설정 수정 가능
    if character.creator_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="이 캐릭터의 설정을 수정할 권한이 없습니다."
        )
    
    setting = await update_character_setting(db, character_id, setting_data)
    if not setting:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="캐릭터 설정을 찾을 수 없습니다."
        )
    
    return setting


@router.post("/{character_id}/like", status_code=status.HTTP_200_OK)
async def like_character_endpoint(
    character_id: uuid.UUID,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    """캐릭터 좋아요"""
    character = await get_character_by_id(db, character_id)
    if not character:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="캐릭터를 찾을 수 없습니다."
        )
    
    if not character.is_public:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="비공개 캐릭터에는 좋아요를 할 수 없습니다."
        )
    
    # 이미 좋아요를 눌렀는지 확인
    is_liked = await is_character_liked_by_user(db, character_id, current_user.id)
    if is_liked:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="이미 좋아요를 누른 캐릭터입니다."
        )
    
    await like_character(db, character_id, current_user.id)
    return {"message": "좋아요가 추가되었습니다."}


@router.delete("/{character_id}/like", status_code=status.HTTP_200_OK)
async def unlike_character_endpoint(
    character_id: uuid.UUID,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    """캐릭터 좋아요 취소"""
    character = await get_character_by_id(db, character_id)
    if not character:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="캐릭터를 찾을 수 없습니다."
        )
    
    # 좋아요를 눌렀는지 확인
    is_liked = await is_character_liked_by_user(db, character_id, current_user.id)
    if not is_liked:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="좋아요를 누르지 않은 캐릭터입니다."
        )
    
    await unlike_character(db, character_id, current_user.id)
    return {"message": "좋아요가 취소되었습니다."}


@router.get("/{character_id}/like-status")
async def get_character_like_status(
    character_id: uuid.UUID,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    """캐릭터 좋아요 상태 확인"""
    character = await get_character_by_id(db, character_id)
    if not character:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="캐릭터를 찾을 수 없습니다."
        )
    
    is_liked = await is_character_liked_by_user(db, character_id, current_user.id)
    
    return {
        "character_id": character_id,
        "is_liked": is_liked,
        "like_count": character.like_count
    }


@router.post("/{character_id}/comments", response_model=CommentResponse, status_code=status.HTTP_201_CREATED)
async def create_comment(
    character_id: uuid.UUID,
    comment_data: CommentCreate,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    """캐릭터에 댓글 작성"""
    character = await get_character_by_id(db, character_id)
    if not character:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="캐릭터를 찾을 수 없습니다."
        )
    
    if not character.is_public:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="비공개 캐릭터에는 댓글을 작성할 수 없습니다."
        )
    
    comment = await create_character_comment(db, character_id, current_user.id, comment_data)
    return comment


@router.get("/{character_id}/comments", response_model=List[CommentWithUser])
async def get_comments(
    character_id: uuid.UUID,
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db)
):
    """캐릭터 댓글 목록 조회"""
    character = await get_character_by_id(db, character_id)
    if not character:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="캐릭터를 찾을 수 없습니다."
        )
    
    comments = await get_character_comments(db, character_id, skip, limit)
    
    # CommentWithUser 형식으로 변환
    comments_with_user = []
    for comment in comments:
        comment_dict = CommentResponse.from_orm(comment).model_dump()
        comment_dict["username"] = comment.user.username
        comment_dict["user_avatar_url"] = getattr(comment.user, "avatar_url", None)
        comments_with_user.append(CommentWithUser(**comment_dict))
    
    return comments_with_user


@router.put("/comments/{comment_id}", response_model=CommentResponse)
async def update_comment(
    comment_id: uuid.UUID,
    comment_data: CommentUpdate,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    """댓글 수정"""
    comment = await get_comment_by_id(db, comment_id)
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
    
    updated_comment = await update_character_comment(db, comment_id, comment_data)
    return updated_comment


@router.delete("/comments/{comment_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_comment(
    comment_id: uuid.UUID,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    """댓글 삭제"""
    comment = await get_comment_by_id(db, comment_id)
    if not comment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="댓글을 찾을 수 없습니다."
        )
    
    # 작성자/관리자만 삭제 가능
    if comment.user_id != current_user.id and not getattr(current_user, "is_admin", False):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="이 댓글을 삭제할 권한이 없습니다."
        )
    
    await delete_character_comment(db, comment_id)

