"""
채팅 관련 API 라우터
CAVEDUCK 스타일: 채팅 중심 최적화
"""

from fastapi import APIRouter, Depends, HTTPException, Query, status
try:
    from app.core.logger import logger
except Exception:
    import logging as _logging
    logger = _logging.getLogger(__name__)
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update, func
from typing import List, Optional, Dict, Any
import uuid
import json
import time
import re
from datetime import datetime
from fastapi import BackgroundTasks
from app.core.database import get_db, AsyncSessionLocal
from app.core.config import settings
from app.core.security import get_current_user, get_current_user_optional
from app.models.user import User
from app.models.chat import ChatRoom
from app.models.character import CharacterSetting, CharacterExampleDialogue, Character
from app.models.story import Story
from app.models.story_chapter import StoryChapter
from app.models.story_summary import StoryEpisodeSummary
from app.models.story_extracted_character import StoryExtractedCharacter
from app.services.chat_service import get_chat_room_by_character_and_session
from app.services import chat_service
from app.services import origchat_service
from app.services import ai_service
from app.services.memory_note_service import get_active_memory_notes_by_character
from app.services.user_persona_service import get_active_persona_by_user
from app.schemas.chat import (
    ChatRoomResponse, 
    ChatMessageResponse, 
    CreateChatRoomRequest, 
    SendMessageRequest,
    SendMessageResponse,
    ChatMessageUpdate,
    RegenerateRequest,
    MessageFeedback
)
try:
    from app.core.logger import logger
except Exception:
    import logging
    logger = logging.getLogger(__name__)


router = APIRouter()

async def _get_room_meta(room_id: uuid.UUID | str) -> Dict[str, Any]:
    try:
        from app.core.database import redis_client
        raw = await redis_client.get(f"chat:room:{room_id}:meta")
        if raw:
            try:
                raw_str = raw.decode("utf-8") if isinstance(raw, (bytes, bytearray)) else raw
            except Exception:
                raw_str = raw
            return json.loads(raw_str)
    except Exception:
        pass
    return {}

async def _ensure_private_content_access(
    db: AsyncSession,
    current_user: User,
    *,
    character: Optional[Character] = None,
) -> None:
    """
    비공개 스토리/캐릭터 접근을 차단한다.

    의도/동작:
    - 요구사항: 비공개(스토리/캐릭터)로 전환되면, 과거에 생성된 채팅방이 있더라도 '접근 시도' 자체를 막는다.
    - 예외: 생성자/관리자는 접근 허용.
    - 방어적: 조회/속성 접근 실패 시에도 조용히 통과하지 않고, 가능한 범위에서 안전하게 판단한다.
    """
    try:
        uid = getattr(current_user, "id", None)
        is_admin = bool(getattr(current_user, "is_admin", False))
    except Exception:
        uid = None
        is_admin = False

    # 1) 캐릭터 비공개 가드
    try:
        if character is not None and (getattr(character, "is_public", True) is False):
            creator_id = getattr(character, "creator_id", None)
            if (not is_admin) and (creator_id != uid):
                raise HTTPException(status_code=403, detail="비공개 캐릭터입니다.")
    except HTTPException:
        raise
    except Exception:
        # 캐릭터 객체가 비정상인 경우는 다른 권한 체크(방 소유권)가 이미 있으므로 여기서는 추가로 막지 않는다.
        pass

    # 2) 스토리 비공개/삭제 가드(원작챗 파생 캐릭터만)
    try:
        sid = getattr(character, "origin_story_id", None) if character is not None else None
        if sid:
            srow = (await db.execute(select(Story.creator_id, Story.is_public).where(Story.id == sid))).first()
            if not srow:
                # 원작챗 컨텍스트에서 스토리가 없어졌으면 삭제로 간주
                raise HTTPException(status_code=410, detail="삭제된 작품입니다")
            s_creator_id = srow[0]
            s_is_public = bool(srow[1]) if srow[1] is not None else True
            if (not s_is_public) and (not is_admin) and (s_creator_id != uid):
                raise HTTPException(status_code=403, detail="비공개 작품입니다.")
    except HTTPException:
        raise
    except Exception:
        pass


async def _ensure_character_story_accessible(db: AsyncSession, current_user: User, character: Character):
    """
    비공개 콘텐츠 접근 가드(채팅 공통).

    요구사항(변경 반영):
    - 비공개된 웹소설/캐릭터챗/원작챗은 모두 "접근 불가" 처리한다.
    - 작성자/관리자는 예외적으로 접근 가능(관리/운영 목적).

    동작:
    - 캐릭터가 비공개면(creator/admin 제외) 403
    - 캐릭터가 원작(스토리)에 연결(origin_story_id)되어 있고, 스토리가 비공개면(creator/admin 제외) 403
    - 연결된 스토리가 삭제되었으면 410
    """
    # 방어: is_admin 속성이 없을 수 있음
    try:
        is_admin = bool(getattr(current_user, "is_admin", False))
    except Exception:
        is_admin = False

    # 1) 캐릭터 비공개 차단
    try:
        c_is_public = bool(getattr(character, "is_public", True))
        c_creator_id = getattr(character, "creator_id", None)
    except Exception:
        c_is_public = True
        c_creator_id = None

    if (not c_is_public) and (c_creator_id != current_user.id) and (not is_admin):
        raise HTTPException(status_code=403, detail="비공개된 캐릭터입니다.")

    # 2) 원작 연결 캐릭터라면 스토리 공개 여부도 검사
    sid = getattr(character, "origin_story_id", None)
    if sid:
        try:
            srow = (await db.execute(
                select(Story.id, Story.creator_id, Story.is_public).where(Story.id == sid)
            )).first()
        except Exception as e:
            try:
                logger.warning(f"[chat] story access check failed: {e}")
            except Exception:
                pass
            raise HTTPException(status_code=500, detail="작품 접근 확인에 실패했습니다.")

        if not srow:
            raise HTTPException(status_code=410, detail="삭제된 작품입니다.")

        s_creator_id = getattr(srow, "creator_id", None)
        s_is_public = bool(getattr(srow, "is_public", True))
        if (not s_is_public) and (s_creator_id != current_user.id) and (not is_admin):
            raise HTTPException(status_code=403, detail="비공개된 작품입니다.")


def _merge_character_tokens(character, user):
    try:
        username = getattr(user, 'username', None) or getattr(user, 'email', '').split('@')[0] or '사용자'
        charname = getattr(character, 'name', None) or '캐릭터'

        def _norm_text(v):
            try:
                return str(v or '').strip()
            except Exception:
                return ''

        def _is_or_separator(v):
            """
            인사말 구분자(= 실제 인사말이 아닌 텍스트) 판별

            배경:
            - 프론트에서 인사말을 여러 개 입력할 때, 사용자가 '혹은'을 별도 줄로 넣는 경우가 있다.
            - 또한 과거 구현에서 greetings 배열을 greeting 문자열로 '\n' join하여 저장하는 케이스가 있어,
              '혹은'이 실제 첫 메시지로 그대로 노출되는 문제가 발생했다.
            """
            t = _norm_text(v).lower()
            return t in ('혹은', 'or', '또는', '|', '/', 'or:', '혹은:')

        def _replace_tokens(text: str) -> str:
            # ✅ 토큰 호환: {{assistant}}(프론트 UI 토큰) / {{character}}(백엔드 토큰) 모두 지원
            return (
                str(text or '')
                .replace('{{user}}', username)
                .replace('{{assistant}}', charname)
                .replace('{{character}}', charname)
            )

        candidates = []

        # 1) DB JSON greetings(정식) 우선
        try:
            if hasattr(character, 'greetings') and isinstance(character.greetings, list) and len(character.greetings) > 0:
                for g in character.greetings:
                    if not isinstance(g, str):
                        continue
                    gg = _norm_text(g)
                    if not gg or _is_or_separator(gg):
                        continue
                    candidates.append(gg)
        except Exception:
            candidates = candidates or []

        # 2) 레거시/현행(프론트 join) 대응: greeting 문자열에 여러 줄이 있으면 옵션으로 간주
        if not candidates:
            raw = _norm_text(getattr(character, 'greeting', None))
            if raw:
                try:
                    lines = str(raw).splitlines()
                    # '혹은' 같은 명시적 구분자가 있으면 블록 단위로 묶어서 옵션 구성(멀티라인 인사말 보존)
                    has_sep = any(_is_or_separator(ln) for ln in lines)
                    if has_sep:
                        buf = []
                        for ln in lines:
                            if _is_or_separator(ln):
                                block = '\n'.join(buf).strip()
                                if block:
                                    candidates.append(block)
                                buf = []
                                continue
                            buf.append(ln)
                        block = '\n'.join(buf).strip()
                        if block:
                            candidates.append(block)
                    else:
                        # 구분자가 없을 때의 처리(방어적):
                        # - 여러 개의 "짧은 인사말"을 줄바꿈으로 나열한 경우: 줄 단위 옵션으로 간주
                        # - 장문 도입부/멀티라인 인사말(스토리 텍스트 등): 전체를 1개 인사말로 보존
                        clean_lines = []
                        for ln in lines:
                            t = _norm_text(ln)
                            if not t or _is_or_separator(t):
                                continue
                            clean_lines.append(t)
                        if len(clean_lines) <= 1:
                            if raw:
                                candidates.append(raw)
                        else:
                            total_len = len(raw)
                            max_len = max((len(x) for x in clean_lines), default=0)
                            # ✅ 길이가 충분히 길면 "도입부/장문"으로 간주하여 원문 보존
                            if total_len >= 240 or max_len >= 120:
                                candidates.append(raw)
                            else:
                                candidates.extend(clean_lines)
                except Exception:
                    candidates = [raw]

        # 3) 최종 선택: 1개만 랜덤 선택(있으면) → 토큰 치환 후 greeting에 반영
        import random
        if candidates:
            picked = random.choice(candidates)
            character.greeting = _replace_tokens(picked)
        else:
            # 방어: 인사말이 비어있으면 안전 기본값
            character.greeting = _replace_tokens(getattr(character, 'greeting', None) or '안녕하세요.')
        
        # 다른 필드들도 처리...
    except Exception:
        pass


def _fallback_user_name(user: User) -> str:
    """사용자 표기 이름 폴백.

    의도:
    - 페르소나가 없거나 로드 실패 시에도 안정적으로 동작.
    - 개인정보 노출을 최소화하되(이메일 전체 금지), 기존 로직과 호환되게 email prefix까지는 허용.
    """
    try:
        username = getattr(user, "username", None) or ""
        username = str(username).strip()
        if username:
            return username
    except Exception:
        pass
    try:
        email = getattr(user, "email", None) or ""
        email = str(email)
        prefix = (email.split("@")[0] or "").strip()
        if prefix:
            return prefix
    except Exception:
        pass
    return "사용자"


async def _resolve_user_name_for_tokens(db: AsyncSession, user: User, scope: str) -> str:
    """토큰 치환에 사용할 사용자 이름을 결정한다(페르소나 우선, 없으면 닉네임).

    SSOT/일관성 원칙:
    - 채팅 프롬프트(일반챗/원작챗)에서 "상대 이름"은 페르소나가 활성화된 경우 페르소나를 우선한다.
    - 페르소나가 없으면 닉네임(username/email prefix) 폴백을 사용한다.

    Args:
        db: AsyncSession
        user: 현재 사용자
        scope: 'character' | 'origchat' 등 (페르소나 apply_scope와 매칭)
    """
    # 1) 활성 페르소나 우선
    try:
        persona = await get_active_persona_by_user(db, user.id)
        if persona:
            apply_scope = getattr(persona, "apply_scope", "all") or "all"
            if apply_scope in ("all", scope):
                pn = (getattr(persona, "name", "") or "").strip()
                if pn:
                    return pn
    except Exception as e:
        try:
            logger.warning(f"[tokens] resolve persona failed: {e}")
        except Exception:
            pass

    # 2) 폴백: 닉네임/이메일 prefix
    return _fallback_user_name(user)


def _render_prompt_tokens(text: Any, user_name: str, character_name: str) -> str:
    """문자열 내 토큰을 실제 이름으로 치환한다.

    지원 토큰:
    - {{user}}: 사용자(페르소나/닉네임)
    - {{character}}: 캐릭터 이름(권장)
    - {{assistant}}: 레거시 호환
    """
    try:
        s = str(text or "")
    except Exception:
        s = ""
    try:
        return (
            s.replace("{{user}}", str(user_name or "사용자"))
             .replace("{{character}}", str(character_name or "캐릭터"))
             .replace("{{assistant}}", str(character_name or "캐릭터"))
        )
    except Exception:
        return s


"""
✅ 붕괴/메타 멘트 방어 규칙 (맥락 기반)

왜 분리하나?
- "머리 아파" 같은 표현은 스토리/캐릭터 설정상 자연스러울 수 있어, 무조건 삭제하면 연기력이 떨어진다.
- 반면 "여긴 어디야/무슨 상황이야/시스템 오류/AI" 같은 멘트는 캐릭터챗 UX를 깨뜨리므로 강하게 막는다.

전략:
- ALWAYS: 메타/시스템 발언 + '여긴 어디/무슨 상황' 계열은 항상 제거(유저 이탈 유발).
- CONTEXTUAL: '혼란/정신없/두통' 같은 붕괴 톤은 "정체성/상황 질문" 맥락에서만 제거한다.
"""

# ✅ 항상 제거(메타/시스템 + 상황붕괴 핵심 워딩)
_ALWAYS_REMOVE_RX_LIST = [
    # 메타/시스템 발언(정치/사회 '정책' 같은 일반 대화는 과제거 위험이 있어 제외)
    re.compile(r"(시스템\s*오류|서버\s*오류|오류\s*났|에러\s*났|버그)[^\n\r]*", re.IGNORECASE),
    re.compile(r"(프롬프트|토큰|챗봇|인공지능|AI\b|모델\b)[^\n\r]*", re.IGNORECASE),

    # '여긴 어디/무슨 상황' 계열(유저가 오류로 오해하는 대표 패턴)
    re.compile(
        r"(여긴|여기가|여기)\s*(대체\s*)?(어디|어딘지)\s*(야|지|냐|인가|일까|모르|모르겠|알아|알지)[^\n\r]*",
        re.IGNORECASE,
    ),
    re.compile(r"(대체|도대체)\s*어디\s*(야|지|냐|인지|인가|일까)[^\n\r]*", re.IGNORECASE),
    re.compile(r"(이게|여기|지금)\s*무슨\s*(상황|일)[^\n\r]*", re.IGNORECASE),
    re.compile(r"무슨\s*(상황|일)\s*(인지|이야|이냐|인지)\s*(모르|모르겠|알아|알지)[^\n\r]*", re.IGNORECASE),
]

# ✅ 맥락에 따라 제거(정체성/상황 질문 맥락에서만 붕괴 톤을 제거)
_CONTEXTUAL_REMOVE_RX_LIST = [
    re.compile(r"머리\s*(가|는)\s*(울리|아프|지끈|띵|깨질|찢어질|터질|어지럽|멍하)[^\n\r]*", re.IGNORECASE),
    re.compile(r"(두통|편두통|현기증|어지럽|속이\s*울렁|토할\s*것\s*같)[^\n\r]*", re.IGNORECASE),
    re.compile(r"(정신\s*(이)?\s*(없|나가|혼미|아득)|정신없)[^\n\r]*", re.IGNORECASE),
    re.compile(r"(혼란스럽|혼란스러|혼미하)[^\n\r]*", re.IGNORECASE),
    re.compile(r"(머릿속(이)?\s*하얘|머리가\s*하얘)[^\n\r]*", re.IGNORECASE),
    re.compile(r"(기억(이)?\s*(안|없|나지|못|가물|흐릿))[^\n\r]*", re.IGNORECASE),
    re.compile(r"(꿈|환각|환상|게임)\s*(속)?\s*(인가|일까)[^\n\r]*", re.IGNORECASE),
]

# ✅ "정체성/상황 질문" 판단용(대화 맥락에서만 강한 필터 적용)
_CTX_QUESTION_RX = re.compile(
    r"(누구(야|세요)?|이름|정체|여긴|여기가|어디(야|지|냐)|무슨\s*(상황|일)|기억|꿈|게임)",
    re.IGNORECASE,
)


def _sanitize_breakdown_phrases(text: Any, *, user_text: Any = None) -> str:
    """캐릭터챗에서 붕괴/메타 멘트를 방어적으로 제거한다.

    배경/의도:
    - LLM은 프롬프트의 '금지'를 100% 준수하지 않을 수 있다.
    - 특히 정체성/상황 질문에서 '머리가 깨질 것 같다/혼란스럽다/여기가 어딘지 모르겠다' 같은
      붕괴 멘트가 나오면 유저가 시스템 오류로 오해하고 이탈한다.

    동작:
    - 최소한의 문자열 치환만 수행한다(모델 재호출/리라이트 없음).
    - 결과가 비면 상위 로직에서 안전한 폴백 문장을 채울 수 있도록 빈 문자열을 반환할 수 있다.
    """
    try:
        s = str(text or "")
    except Exception:
        return ""
    if not s.strip():
        return ""

    # ✅ 맥락 기반 적용 여부
    # - 유저가 정체/상황을 물었을 때(누구야/여긴어디야/무슨상황이야 등)에만 붕괴 톤(두통/혼란)을 강하게 제거
    # - 메타/시스템 + '여긴 어디/무슨 상황' 계열은 항상 제거
    try:
        ut = str(user_text or "").strip()
    except Exception:
        ut = ""
    apply_contextual = bool(ut and _CTX_QUESTION_RX.search(ut))

    # 라인/문장 단위로 치환 적용(줄 전체 삭제가 아니라, "문구만" 제거 → 정상 문장 유지)
    try:
        normalized = s.replace("\r\n", "\n").replace("\r", "\n")
    except Exception:
        normalized = s

    kept_lines: list[str] = []
    try:
        for line in normalized.split("\n"):
            raw_line = str(line or "")
            stripped = raw_line.strip()
            if not stripped:
                kept_lines.append("")
                continue

            out_line = raw_line
            # 1) ALWAYS 제거(메타/시스템 + 상황붕괴 핵심)
            for rx in _ALWAYS_REMOVE_RX_LIST:
                try:
                    out_line = rx.sub("", out_line)
                except Exception:
                    continue

            # 2) CONTEXTUAL 제거(정체/상황 질문일 때만)
            if apply_contextual:
                for rx in _CONTEXTUAL_REMOVE_RX_LIST:
                    try:
                        out_line = rx.sub("", out_line)
                    except Exception:
                        continue

            # 남은 라인이 의미 없는 경우 제거
            try:
                cleaned_line = str(out_line or "").strip()
            except Exception:
                cleaned_line = ""
            # 구두점만 남는 경우 제거
            if not cleaned_line or re.fullmatch(r"[\\s\\-—–_.,!?…·•]+", cleaned_line):
                continue
            kept_lines.append(out_line)
        out = "\n".join(kept_lines)
    except Exception:
        # 정규식/라인 처리 실패는 원문 유지(서비스 중단 방지)
        out = s

    # 공백/개행 정리(가독성)
    try:
        out = re.sub(r"[ \t]{2,}", " ", out)
        out = re.sub(r"\n{3,}", "\n\n", out)
    except Exception:
        pass

    return (out or "").strip()


def _pick_greeting_candidate(character: Any) -> str:
    """캐릭터 인사말 후보(원문)를 하나 선택한다.

    안전/호환:
    - greetings(list)가 있으면 그것을 우선 사용
    - greeting(str)만 있는 레거시 데이터는 구분자('혹은' 등)가 있으면 블록 단위로,
      없으면 '짧은 줄 여러 개'는 후보로, '긴 멀티라인'은 하나의 인사말로 취급한다.
    """
    def _norm_text(v: Any) -> str:
        try:
            return str(v or "").strip()
        except Exception:
            return ""

    def _is_or_separator(v: Any) -> bool:
        t = _norm_text(v).lower()
        return t in ("혹은", "or", "또는", "|", "/", "or:", "혹은:")

    candidates: List[str] = []

    # 1) DB JSON greetings(정식) 우선
    try:
        if hasattr(character, "greetings") and isinstance(getattr(character, "greetings"), list):
            for g in (getattr(character, "greetings") or []):
                if not isinstance(g, str):
                    continue
                gg = _norm_text(g)
                if not gg or _is_or_separator(gg):
                    continue
                candidates.append(gg)
    except Exception:
        candidates = candidates or []

    # 2) 레거시: greeting 문자열
    if not candidates:
        raw = _norm_text(getattr(character, "greeting", None))
        if raw:
            try:
                lines = str(raw).splitlines()
                has_sep = any(_is_or_separator(ln) for ln in lines)
                if has_sep:
                    buf: List[str] = []
                    for ln in lines:
                        if _is_or_separator(ln):
                            block = "\n".join(buf).strip()
                            if block:
                                candidates.append(block)
                            buf = []
                            continue
                        buf.append(ln)
                    block = "\n".join(buf).strip()
                    if block:
                        candidates.append(block)
                else:
                    # 구분자가 없으면, "짧은 줄 여러 개"만 후보로 취급하고
                    # 긴 멀티라인(도입부/스토리)은 원문 그대로 하나의 인사말로 보존한다.
                    non_empty = [_norm_text(ln) for ln in lines if _norm_text(ln) and not _is_or_separator(ln)]
                    total_len = len(raw)
                    max_line_len = max((len(ln) for ln in non_empty), default=0)
                    if len(non_empty) <= 1:
                        candidates.append(raw.strip())
                    elif total_len >= 240 or max_line_len >= 120:
                        candidates.append(raw.strip())
                    else:
                        candidates.extend(non_empty)
            except Exception:
                candidates = [raw]

    if not candidates:
        return ""

    try:
        import random
        return random.choice(candidates)
    except Exception:
        return candidates[0]


async def _set_room_meta(room_id: uuid.UUID | str, data: Dict[str, Any], ttl: int = 2592000) -> None:
    try:
        from app.core.database import redis_client
        meta = await _get_room_meta(room_id)
        meta.update(data)
        meta["updated_at"] = int(time.time())
        await redis_client.setex(f"chat:room:{room_id}:meta", ttl, json.dumps(meta))
    except Exception:
        pass


async def _build_light_context(db: AsyncSession, story_id, player_max: Optional[int], character_id: Optional[uuid.UUID] = None) -> Optional[str]:
    """원작챗에서 사용할 경량 컨텍스트를 생성한다.

    의도/동작:
    - 기존 방식은 회차 원문(스토리 전체 텍스트)을 크게 주입해, 특정 캐릭터가 '주인공의 개인사'를
      자기 1인칭으로 착각/답습하는 문제가 있었다(UX 치명).
    - 개선: 요약/인물표/관계 중심 발췌를 구조화해 주입한다.
      스토리 사실은 유지하면서도, 캐릭터 개인사(1인칭) 오염을 줄인다.
    - character_id가 주어지면, 대상 인물과 '주인공(추정)'의 상호 등장 장면을 우선 발췌한다.
    """
    if not story_id:
        return None

    # character_id를 UUID로 변환 (문자열일 수 있음)
    char_uuid = None
    if character_id:
        try:
            if isinstance(character_id, str):
                char_uuid = uuid.UUID(character_id)
            else:
                char_uuid = character_id
        except Exception:
            char_uuid = None

    # anchor(기준 회차)
    try:
        anchor = int(player_max or 1)
        if anchor < 1:
            anchor = 1
    except Exception:
        anchor = 1

    # 0) 기본 메타(제목/소개)
    story_title = ""
    story_summary = ""
    try:
        srow = await db.execute(select(Story.title, Story.summary).where(Story.id == story_id))
        s = srow.first()
        if s:
            story_title = (s[0] or "").strip()
            story_summary = (s[1] or "").strip()
    except Exception:
        story_title = story_title
        story_summary = story_summary

    # 1) 누적 요약(세계관/사건) — 원문보다 안정적(개인사 오염 ↓)
    cumulative_summary = ""
    try:
        res = await db.execute(
            select(StoryEpisodeSummary.cumulative_summary)
            .where(StoryEpisodeSummary.story_id == story_id, StoryEpisodeSummary.no == anchor)
        )
        cumulative_summary = ((res.first() or [None])[0] or "").strip()
    except Exception:
        cumulative_summary = ""

    # 2) 추출 캐릭터(인물표) — 관계성 힌트
    personas: list[dict] = []
    protagonist_guess = ""
    focus_name = ""
    focus_desc = ""
    try:
        rows = await db.execute(
            select(
                StoryExtractedCharacter.name,
                StoryExtractedCharacter.description,
                StoryExtractedCharacter.character_id,
                StoryExtractedCharacter.order_index,
            )
            .where(StoryExtractedCharacter.story_id == story_id)
            .order_by(StoryExtractedCharacter.order_index.asc())
            .limit(12)
        )
        for n, d, cid, oi in rows.all():
            n2 = (n or "").strip()
            d2 = (d or "").strip()
            if not n2:
                continue
            personas.append({"name": n2, "desc": d2[:160] if d2 else "", "character_id": cid, "order_index": oi})
        if personas:
            protagonist_guess = (personas[0].get("name") or "").strip()
        # focus 정보(추출 목록 우선)
        if char_uuid:
            for it in personas:
                if it.get("character_id") == char_uuid:
                    focus_name = (it.get("name") or "").strip()
                    focus_desc = (it.get("desc") or "").strip()
                    break
    except Exception:
        personas = personas

    # 3) focus_name이 없으면 Character 테이블에서 보강(최소)
    if char_uuid and not focus_name:
        try:
            crow = await db.execute(select(Character.name, Character.description).where(Character.id == char_uuid))
            c = crow.first()
            if c:
                focus_name = (c[0] or "").strip()
                focus_desc = (c[1] or "").strip()[:160]
        except Exception:
            pass

    # 4) 원문(combined)은 "사실 근거 발췌" 용도로만 사용(전체 주입 금지)
    source_text = ""
    try:
        from app.core.database import redis_client
        cached = await redis_client.get(f"story:combined:{story_id}")
        if cached:
            source_text = cached.decode("utf-8") if isinstance(cached, (bytes, bytearray)) else str(cached)
    except Exception:
        source_text = ""
    if not source_text:
        try:
            from app.services.origchat_service import _chunk_windows_from_chapters
            stmt = (
                select(StoryChapter.no, StoryChapter.title, StoryChapter.content)
                .where(StoryChapter.story_id == story_id)
                .order_by(StoryChapter.no.asc())
            )
            rows = await db.execute(stmt)
            chapters = rows.all()
            if chapters:
                windows = _chunk_windows_from_chapters(chapters, max_chars=6000)
                if windows:
                    source_text = "\n\n".join(windows)
                    if len(source_text) > 20000:
                        source_text = source_text[:20000]
                    # Redis 캐싱(기존 SSOT 키 유지)
                    try:
                        from app.core.database import redis_client
                        await redis_client.set(
                            f"story:combined:{story_id}",
                            source_text.encode("utf-8"),
                            ex=86400 * 365
                        )
                    except Exception:
                        pass
        except Exception:
            source_text = ""

    def _collect_positions(t: str, kw: str, max_hits: int = 4) -> list[int]:
        out: list[int] = []
        if not t or not kw:
            return out
        start = 0
        while len(out) < max_hits:
            idx = t.find(kw, start)
            if idx == -1:
                break
            out.append(idx)
            start = idx + max(1, len(kw))
        return out

    def _snip(t: str, idx: int, radius: int = 520) -> str:
        if not t:
            return ""
        lo = max(0, idx - radius)
        hi = min(len(t), idx + radius)
        # 문단 경계로 살짝 확장(가독성)
        try:
            p0 = t.rfind("\n\n", 0, idx)
            if p0 != -1:
                lo = max(0, p0)
        except Exception:
            pass
        try:
            p1 = t.find("\n\n", idx)
            if p1 != -1:
                hi = min(len(t), p1)
        except Exception:
            pass
        s = (t[lo:hi] or "").strip()
        # 너무 길면 안전 컷
        if len(s) > 1400:
            s = s[:1400].rstrip()
        return s

    # 관계 중심 발췌: (대상) + (주인공/중심) 동시 등장 장면을 우선
    snippets: list[str] = []
    try:
        if source_text and focus_name:
            cand: list[tuple[int, str]] = []
            for pos in _collect_positions(source_text, focus_name, max_hits=5):
                s = _snip(source_text, pos)
                if not s:
                    continue
                score = 2
                if protagonist_guess and protagonist_guess in s:
                    score += 4  # 관계 장면 우선
                cand.append((score, s))
            # 중복 제거 + 상위 선택
            seen = set()
            for score, s in sorted(cand, key=lambda x: (-x[0], -len(x[1]))):
                key = s[:120]
                if key in seen:
                    continue
                seen.add(key)
                snippets.append(s)
                if len(snippets) >= 3:
                    break
    except Exception:
        snippets = []

    # 최종 조립(구조화 컨텍스트)
    out_parts: list[str] = []
    try:
        if story_title or story_summary:
            t = "[작품]\n"
            if story_title:
                t += f"제목: {story_title}\n"
            if story_summary:
                t += f"소개: {story_summary[:600]}"
            out_parts.append(t.strip())
    except Exception:
        pass
    if cumulative_summary:
        out_parts.append("[누적 요약]\n" + cumulative_summary[-1200:])
    if personas:
        lines = ["[주요 인물]"]
        for it in personas[:10]:
            n2 = (it.get("name") or "").strip()
            d2 = (it.get("desc") or "").strip()
            if not n2:
                continue
            if d2:
                lines.append(f"- {n2}: {d2}")
            else:
                lines.append(f"- {n2}")
        # 주인공/중심 인물은 '사실'로 단정하지 않고 힌트로만 제공
        if protagonist_guess:
            lines.append(f"(중심 인물 후보: {protagonist_guess})")
        out_parts.append("\n".join(lines))
    if focus_name:
        fx = "[대상 인물]\n" + focus_name
        if focus_desc:
            fx += "\n" + focus_desc
        out_parts.append(fx.strip())
    if snippets:
        out_parts.append("[관계 장면 발췌]\n" + "\n---\n".join(snippets))

    # ✅ 관계/역할 카드(캐릭터-주인공 관계 + 개인사 경계)
    # - generate_if_missing=False: 여기서는 턴 지연을 만들지 않도록 LLM 생성은 하지 않는다.
    try:
        if char_uuid:
            rel = await _build_relationship_card(db, story_id, char_uuid, anchor, generate_if_missing=False)
            if rel:
                out_parts.append(str(rel).strip())
    except Exception:
        pass

    text = "\n\n".join([p for p in out_parts if p]).strip()
    # 마지막 방어: 너무 길면 컷
    if text and len(text) > 12000:
        text = text[:12000].rstrip()
    return text or None


async def _build_relationship_card(
    db: AsyncSession,
    story_id,
    character_id,
    anchor: int,
    *,
    generate_if_missing: bool = True,
) -> Optional[str]:
    """원작챗에서 캐릭터의 '역할/관계/개인사 경계'를 고정하는 짧은 카드 생성.

    의도/동작:
    - 스토리 전체 텍스트를 크게 넣으면 "누가 겪은 사건/가족사인지"가 섞이기 쉬움.
    - 카드에는 '주인공과의 관계' + '이 캐릭터만의 고유 개인사'를 짧게 요약하고,
      타 인물 개인사를 1인칭으로 차용하지 말라는 경계를 명시한다.
    - Redis에 캐시하여(짧은 TTL) 매 턴 비용/변동성을 줄인다.
    """
    if not story_id or not character_id:
        return None
    try:
        a = int(anchor or 1)
        if a < 1:
            a = 1
    except Exception:
        a = 1

    cache_key = f"ctx:warm:{story_id}:relcard:{character_id}:a{a}"
    try:
        from app.core.database import redis_client
        cached = await redis_client.get(cache_key)
        if cached:
            return cached.decode("utf-8") if isinstance(cached, (bytes, bytearray)) else str(cached)
    except Exception:
        pass

    # 입력 데이터 수집(베스트-에포트)
    story_title = ""
    story_summary = ""
    focus_name = ""
    focus_desc = ""
    try:
        srow = await db.execute(select(Story.title, Story.summary).where(Story.id == story_id))
        s = srow.first()
        if s:
            story_title = (s[0] or "").strip()
            story_summary = (s[1] or "").strip()
    except Exception:
        pass
    try:
        crow = await db.execute(select(Character.name, Character.description, Character.background_story).where(Character.id == character_id))
        c = crow.first()
        if c:
            focus_name = (c[0] or "").strip()
            # description은 공개용이라 짧게
            focus_desc = (c[1] or "").strip()
            # background_story는 prompt에만(과다 노출 방지)
            focus_bg = (c[2] or "").strip()
        else:
            focus_bg = ""
    except Exception:
        focus_bg = ""
    personas_text = ""
    protagonist_guess = ""
    try:
        rows = await db.execute(
            select(StoryExtractedCharacter.name, StoryExtractedCharacter.description)
            .where(StoryExtractedCharacter.story_id == story_id)
            .order_by(StoryExtractedCharacter.order_index.asc())
            .limit(10)
        )
        data = rows.all()
        items = []
        for n, d in data:
            n2 = (n or "").strip()
            if not n2:
                continue
            d2 = (d or "").strip()
            items.append(f"- {n2}: {(d2[:120] if d2 else '')}".rstrip())
        if items:
            try:
                protagonist_guess = (data[0][0] or "").strip() if data else ""
            except Exception:
                protagonist_guess = ""
            personas_text = "\n".join(items)
    except Exception:
        personas_text = ""
        protagonist_guess = ""

    # 앵커 요약(있으면) — 관계/사건 맥락 유지
    anchor_summary = ""
    try:
        res = await db.execute(
            select(StoryEpisodeSummary.cumulative_summary)
            .where(StoryEpisodeSummary.story_id == story_id, StoryEpisodeSummary.no == a)
        )
        anchor_summary = ((res.first() or [None])[0] or "").strip()
    except Exception:
        anchor_summary = ""

    # 폴백(LLM 실패/미사용 시): 추출 설명 기반 + 강한 경계
    fallback_card = None
    try:
        lines = ["[관계/역할]"]
        if focus_name:
            lines.append(f"- 당신은 '{focus_name}'입니다.")
        if protagonist_guess and focus_name and protagonist_guess != focus_name:
            lines.append(f"- 중심 인물 후보: '{protagonist_guess}'")
        if focus_desc:
            lines.append(f"- 역할/관계 힌트: {focus_desc[:180]}")
        # ✅ 핵심: 개인사 오염 차단
        lines.append("- 혼동 방지: 타 인물(주인공 포함)의 개인사/가족사/과거를 '내 이야기'로 1인칭 답습하지 마세요.")
        lines.append("- 혼동 방지: 다른 인물 사건을 말할 땐 '그/그녀/OO(이/가)'로 구분하고, 본인이 겪은 것처럼 단정하지 마세요.")
        fallback_card = "\n".join(lines)[:900]
    except Exception:
        fallback_card = None

    # generate_if_missing=False면 LLM 생성은 하지 않는다(턴 지연 방지).
    if not generate_if_missing:
        return fallback_card

    # LLM으로 관계 카드 작성(베스트-에포트)
    try:
        from app.services.ai_service import get_ai_chat_response
        system = (
            "당신은 웹소설 캐릭터 설정 편집자입니다.\n"
            "아래 정보만 근거로 '관계/역할 카드'를 작성하세요. 허위 설정/추측 금지.\n"
            "출력 형식: 6~10줄, 각 줄은 '- '로 시작. 한국어.\n"
            "반드시 포함:\n"
            "1) 대상 캐릭터의 역할/목표 1줄\n"
            "2) 주인공/중심 인물(가능하면 이름)과의 관계 1줄 (불명확하면 '불명')\n"
            "3) 대상 캐릭터의 고유 개인사/가족사(있을 때만) 1~2줄\n"
            "4) 혼동 방지 규칙 1줄: '타 인물 개인사를 1인칭으로 말하지 말 것'\n"
            "주의: '컨텍스트에 따르면' 같은 메타 발언은 금지."
        )
        user = (
            f"[작품]\n제목: {story_title}\n소개: {story_summary[:600]}\n\n"
            f"[주요 인물(후보)]\n{personas_text}\n\n"
            f"[대상 캐릭터]\n이름: {focus_name}\n설명: {focus_desc[:200]}\n배경: {focus_bg[:900]}\n\n"
            f"[앵커까지 누적 요약(≤{a}화)]\n{anchor_summary[-900:]}"
        )
        raw = await get_ai_chat_response(
            character_prompt=system,
            user_message=user,
            history=[],
            preferred_model="claude",
            preferred_sub_model=getattr(ai_service, "CLAUDE_MODEL_PRIMARY", None) or "claude-sonnet-4-20250514",
            response_length_pref="short",
        )
        card = (raw or "").strip()
        # 최소 검증: 너무 짧으면 폐기
        if card and len(card) >= 60:
            card2 = "[관계/역할]\n" + card
            # 캐시 저장(짧게)
            try:
                from app.core.database import redis_client
                await redis_client.setex(cache_key, 3600, card2[:1200])
            except Exception:
                pass
            return card2[:1200]
    except Exception:
        pass

    # LLM 실패 시 폴백 카드 반환
    return fallback_card

# --- Agent simulator (no character, optional auth) ---
@router.post("/agent/simulate")
async def agent_simulate(
    payload: dict,
    current_user: User = Depends(get_current_user),  # ✅ 필수
    db: AsyncSession = Depends(get_db),
):
    """간단한 에이전트 시뮬레이터: 프론트의 모델 선택을 매핑하여 AI 응답을 생성합니다.
    요청 예시: { content, history?, model?, sub_model?, staged?, mode? }
    응답: { assistant: string }
    """
    try:
        # ✅ 함수 시작 시 선언 (스코프 확보)

        character_prompt = ""
        text = ""
        tags2 = None
        ctx = None

        # 새로운 staged 형식 처리
        if "staged" in payload:
            # 새로운 Composer UI에서 온 요청
            staged = payload.get("staged") or []
            mode = payload.get("mode", "micro")
            story_mode = payload.get("storyMode", "auto")  # 'snap' | 'genre' | 'auto'
            
            # staged 아이템에서 텍스트와 이미지 추출
            content = ""
            image_url = None
            image_style = None
            emojis = []
            keyword_tags = []  # 새로 추가: 키워드 태그 수집
            
            for item in staged:
                if item.get("type") == "image":
                    image_url = item.get("url")
                    image_style = item.get("style") or image_style
                    if item.get("caption"):
                        content += (" " if content else "") + item["caption"]
                elif item.get("type") == "text":
                    content += (" " if content else "") + item.get("body", "")
                elif item.get("type") == "emoji":
                    emojis.extend(item.get("items", []))
                elif item.get("type") == "mode_tag":
                    # 명시적 모드 선택: 우선순위 최상위
                    explicit_mode = item.get("value")  # 'snap' | 'genre'
                    if explicit_mode in ("snap", "genre"):
                        story_mode = explicit_mode
                elif item.get("type") == "keyword_tag":
                    # 키워드 태그: 텍스트 힌트로 활용
                    keyword_tags.extend(item.get("items", []))
            
            # 키워드 태그를 텍스트에 병합 (프롬프트 보강용)
            if keyword_tags:
                tag_hint = " ".join([f"#{tag}" for tag in keyword_tags])
                content = (content + " " + tag_hint).strip() if content else tag_hint
            
            if image_url:
                try:
                    tags2, ctx = await ai_service.analyze_image_tags_and_context(image_url, model='claude')
                    logger.info("Vision combine success")
                except Exception as e:
                    logger.error(f"Vision combine failed: {str(e)}")
                    # 폴백: 개별 호출
                    try:
                        ctx = await ai_service.extract_image_narrative_context(image_url, model='claude') or {}
                        logger.info("Context fallback success")
                    except Exception as e2:
                        logger.error(f"Context fallback failed: {str(e2)}")
                        ctx = {}
                    try:
                        tags2 = await ai_service.tag_image_keywords(image_url, model='claude') or {}
                        logger.info("Tags fallback success")
                    except Exception as e3:
                        logger.error(f"Tags fallback failed: {str(e3)}")
                        tags2 = {}
            # 스토리 모드 자동 감지 (auto인 경우)
            if story_mode == "auto":

                # 1) 이모지 기반 기초 점수
                snap_emojis = {"😊", "☕", "🌸", "💼", "🌧️", "😢", "💤", "🎉"}
                genre_emojis = {"🔥", "⚔️", "💀", "😱", "🔪", "🌙", "✨", "😎"}
                snap_score = sum(1 for e in emojis if e in snap_emojis)
                genre_score = sum(1 for e in emojis if e in genre_emojis)

                # 2) 텍스트 힌트(간단)
                low = (content or "").lower()
                # 스냅 키워드 확장(ko/en) — 인스타/일상 빈출 단어 다수 반영
                snap_kw = [
                    # en basics
                    "cafe","coffee","brunch","walk","daily","snapshot","morning","lunch","sunset","sky","rain","weekend","everyday","home","room","desk","plant","street","vibe","mood","today","cozy","minimal",
                    # en insta/daily vibes
                    "instadaily","vibes","lifelog","aesthetic","ootd","outfit","lookbook","minimal","streetstyle","fashion",
                    "foodstagram","foodie","dessert","coffeetime","reels","reelsdaily","vlog","iphonephotography","streetphotography",
                    "makeup","motd","skincare","fragrance","nails","hair","workout","fit","gym","running","pilates","yoga","hiking","mealprep",
                    "travel","traveldiaries","weekendgetaway","roadtrip","landscape","reading","movie","journal","drawing","photography","hobby",
                    "studygram","study","productivity","workfromhome","notion","dogsofinstagram","catsofinstagram","petstagram","family",
                    "weekend","friday","sunset","rainyday","seasonalvibes","mindfulness","selfcare","healing","thoughts",
                    # ko(소문자화 영향 없음)
                    "카페","커피","브런치","산책","일상","점심","저녁","아침","출근","하늘","노을","비","주말","평일","오늘","하루","집","방","책상","식탁","화분","거리","골목","감성","분위기","아늑","미니멀","소소","작은행복","캡션",
                    # ko sns common
                    "인스타","일상그램","데일리그램","소확행","기록","기록생활","일상기록","오늘기록","감성사진","감성글","감성스타그램",
                    # food/cafe
                    "먹스타그램","맛집","맛집탐방","오늘뭐먹지","집밥","요리스타그램","디저트","빵스타그램","카페투어",
                    # fashion/lookbook
                    "오오티디","데일리룩","코디","패션스타그램","스트릿패션","미니멀룩","캐주얼룩","봄코디","신발스타그램",
                    # beauty/grooming
                    "뷰티스타그램","데일리메이크업","메이크업","스킨케어","향수추천","네일","헤어스타일",
                    # fitness/health
                    "헬스","운동기록","홈트","러닝","필라테스","요가","등산","체지방감량","식단관리",
                    # travel/outdoor
                    "여행","여행기록","국내여행","해외여행","주말나들이","드라이브","풍경사진","감성여행","벚꽃","사쿠라","봄","봄날","꽃놀이","꽃길","봄꽃","캠퍼스","교정",
                    # hobby/self-dev
                    "북스타그램","독서기록","영화추천","일기","그림","사진연습","취미생활","공방","캘리그라피",
                    # study/work
                    "공스타그램","스터디플래너","시험공부","자기계발","회사원","재택근무","노션템플릿",
                    # pets/family
                    "멍스타그램","냥스타그램","반려견","반려묘","댕댕이","고양이","육아","가족일상",
                    # season/weather/weekend
                    "불금","퇴근길","출근길","봄감성","여름감성","가을감성","겨울감성","오늘날씨","비오는날",
                    # mind/communication
                    "오늘의생각","공감","위로","힐링","마음일기","자기돌봄","멘탈케어",
                    # photo/reels format
                    "필름감성","필름사진","아이폰사진","갤럭시로찍음","리일스","리일스추천","브이로그",
                    # with hashtags (lower() preserves #)
                    "#일상","#데일리","#일상기록","#오늘기록","#소소한행복","#하루하루","#기록생활","#감성사진","#감성글","#감성스타그램",
                    "#instadaily","#daily","#vibes","#mood","#lifelog","#aesthetic",
                    "#먹스타그램","#맛집","#맛집탐방","#오늘뭐먹지","#집밥","#요리스타그램","#브런치","#디저트","#빵스타그램","#카페","#카페투어",
                    "#foodstagram","#foodie","#brunch","#dessert","#coffee","#coffeetime",
                    "#오오티디","#데일리룩","#코디","#패션스타그램","#스트릿패션","#미니멀룩","#캐주얼룩","#봄코디","#신발스타그램",
                    "#ootd","#outfit","#lookbook","#minimal","#streetstyle","#fashion",
                    "#뷰티스타그램","#데일리메이크업","#메이크업","#스킨케어","#향수추천","#네일","#헤어스타일",
                    "#makeup","#motd","#skincare","#fragrance","#nails","#hair",
                    "#헬스","#운동기록","#홈트","#러닝","#필라테스","#요가","#등산","#체지방감량","#식단관리",
                    "#workout","#fit","#gym","#running","#pilates","#yoga","#hiking","#mealprep",
                    "#여행","#여행기록","#국내여행","#해외여행","#주말나들이","#드라이브","#산책","#풍경사진","#감성여행",
                    "#travel","#traveldiaries","#weekendgetaway","#roadtrip","#walk","#landscape",
                    "#북스타그램","#독서기록","#영화추천","#일기","#그림","#사진연습","#취미생활","#공방","#캘리그라피",
                    "#reading","#movie","#journal","#drawing","#photography","#hobby",
                    "#공스타그램","#스터디플래너","#시험공부","#자기계발","#회사원","#재택근무","#노션템플릿",
                    "#studygram","#study","#productivity","#workfromhome","#notion",
                    "#멍스타그램","#냥스타그램","#반려견","#반려묘","#댕댕이","#고양이","#육아","#가족일상",
                    "#dogsofinstagram","#catsofinstagram","#petstagram","#family",
                    "#주말","#불금","#퇴근길","#출근길","#봄감성","#여름감성","#가을감성","#겨울감성","#오늘날씨","#비오는날","#노을",
                    "#weekend","#friday","#sunset","#rainyday","#seasonalvibes",
                    "#오늘의생각","#공감","#위로","#힐링","#마음일기","#자기돌봄","#멘탈케어",
                    "#mindfulness","#selfcare","#healing","#thoughts",
                    "#필름감성","#필름사진","#아이폰사진","#갤럭시로찍음","#리일스","#리일스추천","#브이로그",
                    "#reels","#reelsdaily"
                ]
                if any(k in low for k in snap_kw):
                    snap_score += 1
                if any(k in low for k in ["dark", "fantasy", "sword", "magic", "noir", "mystery", "horror", "thriller"]):
                    genre_score += 1

                # 3) 이미지 컨텍스트/태그 기반 보정 (Claude Vision)
                strong_genre_match = False
                if image_url and ctx and tags2:

                    # 사람 수/셀카 여부: 인물 0이거나 셀카면 스냅 가산
                    try:
                        person_count = int(ctx.get('person_count') or 0)
                    except Exception:
                        person_count = 0
                    camera = ctx.get('camera') or {}
                    is_selfie = bool(camera.get('is_selfie') or False)
                    if person_count == 0 or is_selfie:
                        snap_score += 1

                    # 장르 단서/톤/오브젝트 기반 가산
                    genre_cues = [str(x) for x in (ctx.get('genre_cues') or []) if str(x).strip()]
                    tone = ctx.get('tone') or {}
                    mood_words = [str(x) for x in (tone.get('mood_words') or []) if str(x).strip()]
                    objects = [str(x) for x in (tags2.get('objects') or []) if str(x).strip()]
                    mood = str(tags2.get('mood') or "")

                    genre_kw = {
                        # 한국어/영문 혼용 키워드
                        "판타지", "검", "칼", "마법", "주술", "용", "괴물", "악마", "느와르", "미스터리", "추리", "스릴러", "호러", "범죄", "전투", "갑옷", "성", "폐허", "어둠", "피", "유혈", "공포",
                        "fantasy", "sword", "blade", "magic", "spell", "ritual", "dragon", "demon", "noir", "mystery", "thriller", "horror", "crime", "battle", "armor", "castle", "ruins", "dark", "blood"
                    }
                    cinematic_kw = {"cinematic", "dramatic", "film", "neon", "night", "storm"}

                    text_bag = set(
                        [w.lower() for w in genre_cues + mood_words + objects + [mood]]
                    )
                    # 이미지 추출 결과에도 스냅 키워드 반영
                    try:
                        snap_kw_lc = [str(k).lower() for k in snap_kw]
                    except Exception:
                        snap_kw_lc = []
                    if any(any(k in w for k in snap_kw_lc) for w in text_bag):
                        snap_score += 1
                    # 장르 강한 신호: 하드/소프트 키워드 분리
                    hard_genre_kw = {
                        "검","칼","sword","blade","마법","spell","ritual","용","dragon","악마","demon","괴물","monster",
                        "갑옷","armor","성","castle","폐허","ruins","해골","skull","피","blood","유혈","총","gun","권총","pistol"
                    }
                    soft_genre_kw = {
                        "판타지","fantasy","느와르","noir","미스터리","mystery","스릴러","thriller","호러","horror","dark"
                    }
                    hard_hit = any(any(k in w for k in hard_genre_kw) for w in text_bag)
                    soft_count = 0
                    for w in text_bag:
                        for k in soft_genre_kw:
                            if k in w:
                                soft_count += 1
                    if hard_hit or soft_count >= 2:
                        genre_score += 2
                        strong_genre_match = True
                    # 영화적 톤은 소량 가산
                    if any(any(k in w for k in cinematic_kw) for w in text_bag):
                        genre_score += 0.5

                # 4) LLM 스타일 판단 가산점(style_mode, confidence)
                try:
                    ctx_style = (ctx or {}).get('style_mode') if isinstance(ctx, dict) else None
                    ctx_conf = float((ctx or {}).get('confidence') or 0.0) if isinstance(ctx, dict) else 0.0
                except Exception:
                    ctx_style, ctx_conf = None, 0.0
                if ctx_style:
                    if ctx_conf >= 0.6:
                        if ctx_style == 'snap':
                            snap_score += 0.5
                        elif ctx_style == 'genre':
                            genre_score += 0.5
                    elif ctx_conf >= 0.45:
                        if ctx_style == 'snap':
                            snap_score += 0.25
                        elif ctx_style == 'genre':
                            genre_score += 0.25

                # 5) 최종 결정: 모델이 판타지(장르)라고 명확히 판단하거나, 강력한 장르 단서가 있으면 genre, 그 외에는 snap
                genre_flag = False
                if ctx_style == 'genre' and ctx_conf >= 0.9:
                    genre_flag = True
                if strong_genre_match:
                    genre_flag = True
                story_mode = "genre" if genre_flag else "snap"
                # logger.info(f"Auto-detected story mode(v2): {story_mode} (snap:{snap_score}, genre:{genre_score})")
            
            # 이모지를 텍스트에 추가 (감정 힌트로 활용)
            emoji_hint = ""
            if emojis:
                # 이모지를 감정/분위기 힌트로 변환
                emoji_map = {
                    "😊": "밝고 긍정적인",
                    "😠": "화나고 분노한", 
                    "😢": "슬프고 우울한",
                    "😎": "쿨하고 자신감 있는",
                    "✨": "반짝이고 특별한",
                    "💼": "비즈니스적이고 진지한",
                    "☕": "여유롭고 편안한",
                    "🌧️": "우울하고 침체된",
                    "🫠": "녹아내리는 듯한",
                    "🔥": "열정적이고 뜨거운",
                    "💤": "피곤하고 나른한",
                    "🎉": "축하하고 즐거운",
                    "🌸": "봄날같고 화사한",
                    "⚔️": "전투적이고 용맹한",
                    "💀": "어둡고 위험한",
                    "😱": "충격적이고 놀라운",
                    "🔪": "날카롭고 위협적인",
                    "🌙": "신비롭고 몽환적인"
                }
                
                moods = []
                for emoji in emojis:
                    if emoji in emoji_map:
                        moods.append(emoji_map[emoji])
                
                if moods:
                    emoji_hint = f"[감정/분위기: {', '.join(moods)}] "
                    content = emoji_hint + content
                else:
                    content += (" " if content else "") + " ".join(emojis)
            
            # 기본 프롬프트
            if not content and image_url:
                content = "첨부된 이미지를 바탕으로 몰입감 있는 이야기를 만들어주세요."
                
            history = []  # staged 형식은 보통 새로운 대화
        else:
            # 기존 형식 처리
            content = (payload.get("content") or "").strip()
            history = payload.get("history") or []
            image_url = None
            image_style = None
            story_mode = None  # 기존 형식에서는 story_mode가 없음
            
            # 히스토리에서 이미지 URL 추출 (기존 로직)
            for h in reversed(history or []):
                if h.get("type") == "image" and h.get("content"):
                    image_url = h.get("content")
                    break
        
        ui_model = (payload.get("model") or "").lower()
        ui_sub = (payload.get("sub_model") or ui_model or "").lower()

        # UI 모델명을 ai_service 기대 형식으로 매핑
        # [임시] GPT와 Gemini 비활성화 - 모든 요청을 Claude로 강제 전환
        from app.services.ai_service import CLAUDE_MODEL_PRIMARY
        preferred_model = "claude"
        preferred_sub_model = CLAUDE_MODEL_PRIMARY
        # from app.services.ai_service import GPT_MODEL_PRIMARY
        # preferred_model = "gpt"  # Claude → GPT 전환
        # preferred_sub_model = GPT_MODEL_PRIMARY

        
        # 원래 로직 (임시 비활성화)
        # if "claude" in ui_model or "claude" in ui_sub:
        #     preferred_model = "claude"
        #     preferred_sub_model = CLAUDE_MODEL_PRIMARY
        # elif "gpt-4.1" in ui_model or "gpt-4.1" in ui_sub:
        #     preferred_model = "gpt"
        #     preferred_sub_model = "gpt-4.1"
        # elif "gpt-4o" in ui_model or "gpt-4o" in ui_sub or "gpt" in ui_model:
        #     preferred_model = "gpt"
        #     preferred_sub_model = "gpt-4o"
        # elif "gemini-2.5-flash" in ui_model or "flash" in ui_sub:
        #     preferred_model = "gemini"
        #     preferred_sub_model = "gemini-2.5-flash"
        # else:
        #     preferred_model = "gemini"
        #     preferred_sub_model = "gemini-2.5-pro"

        # 이미지가 있으면 이미지 그라운딩 집필 사용
        generated_image_url = None
        if image_url:
            # 스타일 숏컷 매핑(이미지 생성/삽입에만 적용)
            style_map = {
                "anime": "애니메이션풍(만화/셀셰이딩/선명한 콘트라스트)",
                "photo": "실사풍(현실적 묘사/사진적 질감)",
                "semi": "반실사풍(현실+일러스트 절충)"
            }
            style_prompt = style_map.get((image_style or "").strip().lower()) if image_style else None
            
            # 1. 스토리 생성 (모드별 분기)
            # 사용자 닉네임 가져오기 (1인칭 시점용)
            username = None
            if current_user:
                username = current_user.username or current_user.email.split('@')[0]
            
            vision_tags = tags2 if image_url else None
            vision_ctx = ctx if image_url else None

            text = await ai_service.write_story_from_image_grounded(
                image_url=image_url,
                user_hint=content,
                model=preferred_model,
                sub_model=preferred_sub_model,
                style_prompt=style_prompt,
                story_mode=story_mode,
                username=username,
                vision_tags=vision_tags,  # 추가
                vision_ctx=vision_ctx,    # 추가
            )
            
            # 2. 생성된 스토리를 바탕으로 새 이미지 프롬프트 생성 (일시적으로 비활성화)
            # TODO: 이미지 생성 기능 안정화 필요
            """
            try:
                # 원본 이미지 태그 가져오기 (스타일 참고용)
                original_tags = await ai_service.tag_image_keywords(image_url, model='claude')
                
                # 스토리 기반 이미지 프롬프트 생성
                image_prompt = await ai_service.generate_image_prompt_from_story(
                    story_text=text,
                    original_tags=original_tags
                )
                
                # 3. 새 이미지 생성 (Gemini 이미지 생성 API 사용)
                from app.services.media_service import generate_image_gemini
                generated_images = await generate_image_gemini(
                    prompt=image_prompt,
                    count=1,
                    ratio="3:4"
                )
                
                if generated_images and len(generated_images) > 0:
                    generated_image_url = generated_images[0]
                    logger.info(f"Generated new image based on story: {generated_image_url}")
                    
            except Exception as e:
                logger.error(f"Failed to generate new image: {e}")
                # 이미지 생성 실패해도 스토리는 반환
            """
        else:
            # 스토리 모드가 있으면 프롬프트 조정 후 텍스트 생성
            if story_mode == "snap":
                character_prompt = (
                    "당신은 일상의 순간을 포착하는 작가입니다.\n"
                    "- 200-300자 분량의 짧고 공감가는 일상 스토리\n"
                    "- SNS 피드에 올릴 법한 친근한 문체\n"
                    "- 따뜻하거나 위트있는 톤\n"
                    "- 오글거리지 않고 자연스럽게"
                )
            elif story_mode == "genre":
                character_prompt = (
                    "당신은 장르소설 전문 작가입니다.\n"
                    "- 500-800자 분량의 몰입감 있는 장르 스토리\n"
                    "- 긴장감 있는 전개와 생생한 묘사\n"
                    "- 장르 관습을 따르되 신선하게\n"
                    "- 다음이 궁금해지는 마무리"
                )

            # ✅ 응답 길이 선호도(LLM 시스템 지침) 정합
            # - 기존: snap=short(1~2문장) / genre=medium(3~6문장)으로 고정되어,
            #   snap(200~300자)·genre(500~800자) 캐릭터 프롬프트와 충돌 → 체감상 "너무 짧게" 생성되는 문제가 있었다.
            # - 원칙: story_mode 지침(글자수)과 충돌하지 않도록 snap은 medium, genre는 long을 기본으로 둔다.
            # - 예외: 프론트에서 '계속보기'는 "[이어서]"로 들어오고, '바꿔보기(리믹스)'는 "[리믹스 규칙"을 포함하므로
            #   이 경우에는 과도한 장문을 피하기 위해 medium으로 완화한다.
            response_length_pref = None
            try:
                response_length_pref = (payload.get("response_length_pref") or "").strip().lower() or None
            except Exception:
                response_length_pref = None
            try:
                hint = (content or "")
                if "[리믹스 규칙" in hint:
                    response_length_pref = response_length_pref or "medium"
                elif "[이어서]" in hint:
                    response_length_pref = response_length_pref or "medium"
            except Exception:
                pass
            if not response_length_pref:
                if story_mode == "snap":
                    response_length_pref = "medium"
                elif story_mode == "genre":
                    response_length_pref = "long"
                else:
                    response_length_pref = "medium"

            text = await ai_service.get_ai_chat_response(
                character_prompt=character_prompt,
                user_message=content,
                history=history,
                preferred_model=preferred_model,
                preferred_sub_model=preferred_sub_model,
                response_length_pref=response_length_pref,
            )
        
        # Vision 태그에서 이미지 요약 추출
        image_summary = None
        if image_url:
            try:
                tags_data = tags2
                if tags_data and isinstance(tags_data, dict):
                    parts = []
                    if 'place' in tags_data and tags_data['place']:
                        parts.append(tags_data['place'])
                    if 'objects' in tags_data and tags_data['objects']:
                        objs = tags_data['objects'][:2]
                        parts.extend(objs)
                    if 'mood' in tags_data and tags_data['mood']:
                        parts.append(tags_data['mood'])
                    image_summary = ', '.join(parts[:3]) if parts else None
            except Exception:
                pass

        response = {
            "assistant": text, 
            "story_mode": story_mode, 
            "image_summary": image_summary,
            # "vision_tags": locals().get('tags2') if image_url else None,
            # "vision_ctx": locals().get('ctx') if image_url else None    
            "vision_tags": tags2,  # ✅ locals() 제거
            "vision_ctx": ctx      # ✅ locals() 제거
        }
        
        # 하이라이트는 별도 엔드포인트에서 비동기로 처리
            
        return response
    except Exception as e:
        # 안전 가드: 에러 로깅(전역 logger 사용) 후 500 반환
        try:
            logger.exception(f"/chat/agent/simulate failed: {e}")
        except Exception:
            print(f"/chat/agent/simulate failed: {e}")
        from fastapi import HTTPException
        raise HTTPException(status_code=500, detail=f"agent_simulate_error: {e}")

@router.post("/agent/partial-regenerate")
async def agent_partial_regenerate(
    payload: dict,
    current_user: User = Depends(get_current_user),  # ✅ 필수
    db: AsyncSession = Depends(get_db),
):
    """선택된 텍스트 부분을 AI로 재생성
    요청: { full_text, selected_text, user_prompt, before_context, after_context }
    응답: { regenerated_text: string }
    """
    try:
        full_text = payload.get("full_text", "")
        selected_text = payload.get("selected_text", "")
        user_prompt = payload.get("user_prompt", "").strip()
        before_context = payload.get("before_context", "")
        after_context = payload.get("after_context", "")
        
        if not selected_text or not user_prompt:
            from fastapi import HTTPException
            raise HTTPException(status_code=400, detail="selected_text and user_prompt are required")
        
        # AI 서비스 호출
        regenerated_text = await ai_service.regenerate_partial_text(
            selected_text=selected_text,
            user_prompt=user_prompt,
            before_context=before_context,
            after_context=after_context
        )
        
        return {"regenerated_text": regenerated_text}
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        logger.exception(f"/chat/agent/partial-regenerate failed: {e}")
        from fastapi import HTTPException
        raise HTTPException(status_code=500, detail=f"partial_regenerate_error: {e}")

@router.post("/agent/classify-intent")
async def classify_intent(
    payload: dict,
    current_user: User = Depends(get_current_user)
):  
    """유저 입력의 의도를 LLM으로 분류"""
    try:
        user_text = (payload.get("text") or "").strip()
        has_context = bool(payload.get("has_last_message"))
        
        if not user_text:
            return {"intent": "new", "constraint": ""}
        
        # 짧은 프롬프트로 빠르게 분류
        prompt = f"""사용자 입력: "{user_text}"
직전 AI 메시지: {"있음" if has_context else "없음"}

다음 중 하나로 분류하고 JSON만 응답:
- continue: 이어쓰기 (계속, 이어서, 다음, 그다음)
- remix: 전체 바꿔보기 (~느낌으로, 톤, 스타일, 바꿔)
- modify: 부분 수정 (추가, 더, 빼줘, 넣어줘, ~했으면)
- new: 새 스토리
- chat: 일반 대화

{{"intent": "...", "constraint": "구체적 요청 내용"}}"""
        
        from app.services.ai_service import CLAUDE_MODEL_PRIMARY
        result = await ai_service.get_claude_completion(
            prompt, 
            temperature=0.1, 
            max_tokens=150, 
            model=CLAUDE_MODEL_PRIMARY
        )
        
        # JSON 파싱
        if '```json' in result:
            result = result.split('```json')[1].split('```')[0].strip()
        elif '```' in result:
            result = result.split('```')[1].split('```')[0].strip()
        
        data = json.loads(result)
        return {
            "intent": data.get("intent", "new"), 
            "constraint": data.get("constraint", "")
        }
    except Exception as e:
        logger.error(f"Intent classification failed: {e}")
        # 폴백: 새 스토리로 처리
        return {"intent": "new", "constraint": ""}


@router.post("/agent/generate-highlights")
async def agent_generate_highlights(
    payload: dict,
    current_user: User = Depends(get_current_user)
):
    """텍스트와 원본 이미지 URL을 받아 하이라이트 이미지를 3장 생성하여 반환"""
    try:
        text = (payload.get("text") or "").strip()
        image_url = (payload.get("image_url") or "").strip()
        story_mode = (payload.get("story_mode") or "auto").strip()
        vision_tags = payload.get("vision_tags")
        if not text or not image_url:
            raise HTTPException(status_code=400, detail="text and image_url are required")

        from app.services.story_extractor import StoryExtractor, StoryStage, SceneExtract
        from app.services.scene_prompt_builder import ScenePromptBuilder
        from app.services.seedream_client import SeedreamClient, SeedreamConfig
        from app.services.image_composer import ImageComposer
        from app.services.storage import get_storage

        extractor = StoryExtractor(min_scenes=3, max_scenes=4)
        scenes = extractor.extract_scenes(text, story_mode)
        # 항상 3장 확보: 부족 시 대체 컷 채움
        if len(scenes) < 3:
            # 간단한 대체 컷 프리셋(스냅/장르 공통으로 무인물 위주 묘사 가능한 문구)
            fillers = [
                (StoryStage.INTRO, "공간을 넓게 잡은 설정샷. 공기와 빛이 보이는 구도.", 0.08),
                (StoryStage.CLIMAX, "주요 오브젝트를 가까이 잡은 클로즈업. 결을 보여준다.", 0.52),
                (StoryStage.RESOLUTION, "빛과 색이 남기는 잔상처럼 조용히 마무리되는 구도.", 0.92),
            ]
            for stage, sentence, pos in fillers:
                if len(scenes) >= 3:
                    break
                try:
                    subtitle = extractor._create_subtitle(sentence, story_mode)
                except Exception:
                    subtitle = sentence[:20]
                scenes.append(SceneExtract(
                    stage=stage,
                    sentence=sentence,
                    subtitle=subtitle,
                    position=pos,
                    confidence=0.4,
                    keywords=[]
                ))
        # 최대 3장으로 제한
        scenes = scenes[:3]

        prompt_builder = ScenePromptBuilder(base_style=story_mode or "genre")
        scene_prompts = [
            prompt_builder.build_from_scene(
                sentence=s.sentence,
                keywords=s.keywords,
                stage=s.stage.value,
                story_mode=story_mode,
                original_image_tags=vision_tags
            )
            for s in scenes
        ]

        seedream = SeedreamClient()
        configs = [
            SeedreamConfig(
                prompt=sp.positive,
                negative_prompt=sp.negative,
                image_size="1024x1024"
            ) for sp in scene_prompts
        ]
        results = await seedream.generate_batch(configs, max_concurrent=3)

        composer = ImageComposer()
        storage = get_storage()
        story_highlights = []
        # 결과 수가 부족할 수 있으므로 인덱스 기준으로 처리
        for i in range(len(scenes)):
            scene = scenes[i]
            result = results[i] if i < len(results) else None
            # 1차: 배치 결과 사용
            image_url_candidate = result.image_url if (result and getattr(result, 'image_url', None)) else None
            # 2차: 실패 시 단건 재시도
            if not image_url_candidate:
                try:
                    single = await seedream.generate_single(SeedreamConfig(
                        prompt=configs[i].prompt,
                        negative_prompt=configs[i].negative_prompt,
                        image_size=configs[i].image_size,
                    ))
                    if single and getattr(single, 'image_url', None):
                        image_url_candidate = single.image_url
                except Exception:
                    image_url_candidate = None
            # 3차: 여전히 없으면, 직전 성공 이미지로 중복 채우기(자막은 해당 장면 것 사용)
            if not image_url_candidate and story_highlights:
                image_url_candidate = story_highlights[-1]["imageUrl"]
            # 이미지가 전혀 없으면 스킵(최소 1장은 있다고 가정)
            if not image_url_candidate:
                continue
            composed = await composer.compose_with_letterbox(
                image_url=image_url_candidate,
                subtitle=scene.subtitle
            )
            final_url = storage.save_bytes(
                composed.image_bytes,
                content_type=composed.content_type,
                key_hint=f"story_scene_{i}.jpg"
            )
            story_highlights.append({
                "imageUrl": final_url,
                "subtitle": scene.subtitle,
                "stage": scene.stage.value,
                "sceneOrder": i + 1
            })
        # 보수: 혹시라도 3장 미만이면 마지막 이미지를 복제하여 3장 맞춤
        while len(story_highlights) < 3 and len(story_highlights) > 0:
            last = story_highlights[-1]
            story_highlights.append({
                "imageUrl": last["imageUrl"],
                "subtitle": last["subtitle"],
                "stage": last["stage"],
                "sceneOrder": len(story_highlights) + 1
            })
        return { "story_highlights": story_highlights }
    except HTTPException:
        raise
    except Exception as e:
        try:
            logger.exception(f"/chat/agent/generate-highlights failed: {e}")
        except Exception:
            print(f"/chat/agent/generate-highlights failed: {e}")
        raise HTTPException(status_code=500, detail=f"highlight_error: {e}")

# 🔥 CAVEDUCK 스타일 핵심 채팅 API (4개)

@router.post("/start", response_model=ChatRoomResponse, status_code=status.HTTP_201_CREATED)
async def start_chat(
    request: CreateChatRoomRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """채팅 시작 - CAVEDUCK 스타일 간단한 채팅 시작"""
    # ✅ 비공개 접근 차단(요구사항 변경 반영)
    try:
        ch = (await db.execute(select(Character).where(Character.id == request.character_id))).scalars().first()
        if not ch:
            raise HTTPException(status_code=404, detail="캐릭터를 찾을 수 없습니다.")
        await _ensure_character_story_accessible(db, current_user, ch)
    except HTTPException:
        raise
    except Exception as e:
        try:
            logger.warning(f"[chat] start privacy check failed: {e}")
        except Exception:
            pass
        raise HTTPException(status_code=500, detail="접근 권한 확인에 실패했습니다.")
    # 채팅방 가져오기 또는 생성
    chat_room = await chat_service.get_or_create_chat_room(
        db, user_id=current_user.id, character_id=request.character_id
    )
    
    # 새로 생성된 채팅방인 경우 (메시지가 없는 경우)
    existing_messages = await chat_service.get_messages_by_room_id(db, chat_room.id, limit=1)
    if not existing_messages:
        # ✅ 첫 메시지(인사말): DB 원문은 보존하고, 채팅 메시지로 저장할 때만 토큰을 렌더링(SSOT)
        token_user_name = await _resolve_user_name_for_tokens(db, current_user, scope="character")
        char_name = getattr(chat_room.character, "name", None) or "캐릭터"
        raw_greeting = _pick_greeting_candidate(chat_room.character) or (
            getattr(chat_room.character, "greeting", None) or "안녕하세요."
        )
        greeting_text = _render_prompt_tokens(raw_greeting, user_name=token_user_name, character_name=char_name)
        await chat_service.save_message(db, chat_room.id, "assistant", greeting_text)
        # ✅ 방어: AsyncSession은 commit 시 객체가 expire될 수 있어, 응답 직렬화(Pydantic) 단계에서
        # 지연 로드가 발생하며 ResponseValidationError(500)로 터질 수 있다.
        # 첫 메시지 저장(내부 commit) 이후에는 room을 관계 포함(selectinload)으로 재조회하여 반환한다.
        try:
            from sqlalchemy.orm import selectinload
            stmt = select(ChatRoom).where(ChatRoom.id == chat_room.id).options(selectinload(ChatRoom.character))
            result = await db.execute(stmt)
            chat_room = result.scalar_one()
        except Exception as e:
            try:
                logger.warning(f"[chat] reload room after greeting failed (start): {e}")
            except Exception:
                pass
    
    return chat_room

@router.post("/start-new", response_model=ChatRoomResponse, status_code=status.HTTP_201_CREATED)
async def start_new_chat(
    request: CreateChatRoomRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """새 채팅 시작 - 무조건 새로운 채팅방 생성"""
    # ✅ 비공개 접근 차단(요구사항 변경 반영)
    try:
        ch = (await db.execute(select(Character).where(Character.id == request.character_id))).scalars().first()
        if not ch:
            raise HTTPException(status_code=404, detail="캐릭터를 찾을 수 없습니다.")
        await _ensure_character_story_accessible(db, current_user, ch)
    except HTTPException:
        raise
    except Exception as e:
        try:
            logger.warning(f"[chat] start-new privacy check failed: {e}")
        except Exception:
            pass
        raise HTTPException(status_code=500, detail="접근 권한 확인에 실패했습니다.")
    # 무조건 새 채팅방 생성 (기존 방과 분리)
    chat_room = await chat_service.create_chat_room(
        db, user_id=current_user.id, character_id=request.character_id
    )
    
    # ✅ 새 방이므로 인사말 추가(일관성 위해 기본값 포함)
    try:
        token_user_name = await _resolve_user_name_for_tokens(db, current_user, scope="character")
    except Exception:
        token_user_name = _fallback_user_name(current_user)
    char_name = getattr(chat_room.character, "name", None) or "캐릭터"
    raw_greeting = _pick_greeting_candidate(chat_room.character) or (
        getattr(chat_room.character, "greeting", None) or "안녕하세요."
    )
    greeting_text = _render_prompt_tokens(raw_greeting, user_name=token_user_name, character_name=char_name)
    await chat_service.save_message(db, chat_room.id, "assistant", greeting_text)

    # ✅ 방어: 첫 메시지 저장(내부 commit) 이후 expire된 ORM을 그대로 반환하면
    # 응답 직렬화에서 지연 로드가 발생해 ResponseValidationError가 날 수 있다.
    # room을 관계 포함(selectinload)으로 재조회하여 안전한 객체를 반환한다.
    try:
        from sqlalchemy.orm import selectinload
        stmt = select(ChatRoom).where(ChatRoom.id == chat_room.id).options(selectinload(ChatRoom.character))
        result = await db.execute(stmt)
        chat_room = result.scalar_one()
    except Exception as e:
        try:
            logger.warning(f"[chat] reload room after greeting failed (start-new): {e}")
        except Exception:
            pass
    
    return chat_room


@router.post("/start-with-context", response_model=ChatRoomResponse, status_code=status.HTTP_201_CREATED)
async def start_chat_with_agent_context(
    request: dict,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """에이전트에서 생성한 일상 텍스트로 시작하는 채팅"""
    character_id = request.get("character_id")
    agent_text = request.get("agent_text")
    image_url = request.get("image_url")
    session_id = request.get("session_id")
    vision_tags = request.get("vision_tags")
    vision_ctx = request.get("vision_ctx")

    # 기존 room 검색 시 session_id도 검사
    chat_room = await get_chat_room_by_character_and_session(
        db, current_user.id, request["character_id"], session_id
    )

    if not chat_room:
        chat_room = ChatRoom(
            user_id=current_user.id,
            character_id=request["character_id"],
            session_id=session_id,
            created_at=datetime.utcnow()
        )
        db.add(chat_room)
        await db.commit()
        await db.refresh(chat_room)

    from app.core.database import redis_client
    idem_key = f"chat:room:{chat_room.id}:first_response_scheduled"
    done_key = f"chat:room:{chat_room.id}:first_response_done"

    # 멱등 가드: 이미 스케줄/완료면 바로 반환 (관계 로드 보장)
    if await redis_client.get(idem_key) or await redis_client.get(done_key):
        from sqlalchemy.orm import selectinload
        from sqlalchemy import select as sql_select
        stmt = sql_select(ChatRoom).where(ChatRoom.id == chat_room.id).options(selectinload(ChatRoom.character))
        result = await db.execute(stmt)
        return result.scalar_one()

    await redis_client.setex(idem_key, 3600, "1")  # 1시간

    background_tasks.add_task(
        _generate_agent_first_response,
        room_id=str(chat_room.id),
        character_id=str(character_id),
        agent_text=agent_text,
        image_url=image_url,
        user_id=current_user.id,
        vision_tags=vision_tags,
        vision_ctx=vision_ctx,
    )

    # ← 반환 직전 관계 로드 보장
    from sqlalchemy.orm import selectinload
    from sqlalchemy import select as sql_select
    stmt = sql_select(ChatRoom).where(ChatRoom.id == chat_room.id).options(selectinload(ChatRoom.character))
    result = await db.execute(stmt)
    return result.scalar_one()
    # return chat_room  # 즉시 반환


# 파일 하단 (868줄 이후)에 백그라운드 함수 추가:

async def _generate_agent_first_response(
    room_id: str,
    character_id: str,
    agent_text: str,
    image_url: str,
    user_id: int,
    vision_tags: dict,
    vision_ctx: dict
):

    from app.core.database import redis_client

    done_key = f"chat:room:{room_id}:first_response_done"
    if await redis_client.get(done_key):
        return


    """백그라운드에서 캐릭터의 첫 반응 생성 (이미지+텍스트를 본 반응만)"""
    async with AsyncSessionLocal() as db:
        try:
            import uuid
            from app.models.character import Character, CharacterSetting, CharacterExampleDialogue
            
            # 캐릭터 정보 로드
            room = await chat_service.get_chat_room_by_id(db, uuid.UUID(room_id))
            if not room:
                return
            
            character = room.character
            user = await db.get(User, user_id)
            if not user:
                return

            # ✅ 토큰 치환(SSOT): DB 원문은 보존하고, 프롬프트 생성 시점에만 렌더링한다.
            try:
                token_user_name = await _resolve_user_name_for_tokens(db, user, scope="character")
            except Exception:
                token_user_name = _fallback_user_name(user)
            char_name = getattr(character, "name", None) or "캐릭터"

            def _rt(v: Any) -> str:
                return _render_prompt_tokens(v, user_name=token_user_name, character_name=char_name)
            
            # settings 로드
            settings_result = await db.execute(
                select(CharacterSetting).where(CharacterSetting.character_id == character.id)
            )
            settings = settings_result.scalar_one_or_none()

            # 예시 대화 가져오기
            example_dialogues_result = await db.execute(
                select(CharacterExampleDialogue)
                .where(CharacterExampleDialogue.character_id == character.id)
                .order_by(CharacterExampleDialogue.order_index)
            )
            example_dialogues = example_dialogues_result.scalars().all()
            
            # 기억노트 가져오기
            active_memories = await get_active_memory_notes_by_character(
                db, user.id, character.id
            )
            
            # 캐릭터 프롬프트 구성
            character_prompt = f"""당신은 '{char_name}'입니다.

[기본 정보]
설명: {_rt(getattr(character, 'description', None)) or '설정 없음'}
성격: {_rt(getattr(character, 'personality', None)) or '설정 없음'}
말투: {_rt(getattr(character, 'speech_style', None)) or '설정 없음'}
배경 스토리: {_rt(getattr(character, 'background_story', None)) or '설정 없음'}

[세계관]
{_rt(getattr(character, 'world_setting', None)) or '설정 없음'}
"""

            if character.has_affinity_system and character.affinity_rules:
                character_prompt += f"\n\n[호감도 시스템]\n{_rt(character.affinity_rules)}"
                if character.affinity_stages:
                    character_prompt += f"\n호감도 단계: {_rt(character.affinity_stages)}"
            
            if character.introduction_scenes:
                character_prompt += f"\n\n[도입부 설정]\n{_rt(character.introduction_scenes)}"
            
            if example_dialogues:
                character_prompt += "\n\n[예시 대화]"
                for dialogue in example_dialogues:
                    character_prompt += f"\nUser: {_rt(getattr(dialogue, 'user_message', ''))}"
                    character_prompt += f"\n{char_name}: {_rt(getattr(dialogue, 'character_response', ''))}"
            
            if active_memories:
                character_prompt += "\n\n[사용자와의 중요한 기억]"
                for memory in active_memories:
                    character_prompt += f"\n• {_rt(getattr(memory, 'title', ''))}: {_rt(getattr(memory, 'content', ''))}"
            
            if settings and settings.system_prompt:
                character_prompt += f"\n\n[추가 지시사항]\n{_rt(settings.system_prompt)}"
            
            character_prompt += "\n\n위의 모든 설정에 맞게 캐릭터를 완벽하게 연기해주세요."
            character_prompt += "\n\n[대화 스타일 지침]"
            character_prompt += "\n- 실제 사람처럼 자연스럽고 인간적으로 대화하세요"
            character_prompt += "\n- ①②③ 같은 목록이나 번호 매기기 금지"
            character_prompt += "\n- 진짜 친구처럼 편하고 자연스럽게 반응하세요"
            character_prompt += "\n- 기계적인 선택지나 구조화된 답변 금지"
            character_prompt += "\n- 감정을 진짜로 표현하고, 말줄임표나 감탄사를 자연스럽게 사용"
            character_prompt += "\n중요: 'User:'같은 라벨 없이 바로 대사만 작성하세요."

            # 이미지 분석 및 그라운딩 블록 생성
            if image_url:
                if vision_tags and vision_ctx:
                    # ✅ 전달받은 결과 재사용 (재분석 안 함)
                    image_grounding = ai_service.build_image_grounding_block(
                        tags=vision_tags,
                        ctx=vision_ctx,
                        story_mode='snap',
                        username=None
                    )
                else:
                    # 폴백: 없으면 새로 분석
                    try:
                        tags, ctx = await ai_service.analyze_image_tags_and_context(image_url, model='claude')
                        image_grounding = ai_service.build_image_grounding_block(
                            tags=tags,
                            ctx=ctx,
                            story_mode='snap',
                            username=None
                        )
                    except Exception as e:
                        logger.error(f"Image analysis failed: {e}")
                        image_grounding = "(함께 이미지도 공유함)"
            character_prompt += f"\n\n[상황] 사용자가 다음과 같은 일상 이야기를 공유했습니다:\n\"{agent_text}\""
            if image_grounding:
                character_prompt += f"\n\n{image_grounding}"  # ← 성별 포함된 분석 정보
            character_prompt += "\n\n이제 당신 차례입니다. 이 이야기에 대해 자연스럽게 짧게(1~2문장) 반응해주세요. 공감이나 질문으로 대화를 시작하세요."

            # 이미지 컨텍스트를 항상 Redis에 저장
            try:
                from app.core.database import redis_client
                import json
                if image_grounding:
                    await redis_client.setex(
                        f"chat:room:{room_id}:image_context",
                        2592000,  # 30일
                        json.dumps({
                            "image_url": image_url,
                            "image_grounding": image_grounding,
                            "vision_tags": vision_tags,
                            "vision_ctx": vision_ctx
                        }, ensure_ascii=False)
                    )
            except Exception:
                pass

            
            # AI 응답 생성 (빈 히스토리, 짧게)
            ai_response_text = await ai_service.get_ai_chat_response(
                character_prompt=character_prompt,
                user_message="",  # 빈 메시지 (프롬프트에 상황 포함됨)
                history=[],
                preferred_model=user.preferred_model,
                preferred_sub_model=user.preferred_sub_model,
                response_length_pref='short'
            )
            
           # AI 응답 저장 후
            await chat_service.save_message(
                db, uuid.UUID(room_id), "assistant", ai_response_text
            )
            await db.commit()
            await redis_client.setex(f"chat:room:{room_id}:first_response_done", 3600, "1")

            # ✅ 채팅방에 이미지 정보 저장 (메타데이터)
            if vision_tags and vision_ctx:
                try:
                    from app.core.database import redis_client
                    import json
                    
                    cache_data = {
                        "image_url": image_url,
                        "image_grounding": image_grounding,
                        "vision_tags": vision_tags,
                        "vision_ctx": vision_ctx
                    }
                    
                    # 30일 보관
                    await redis_client.setex(
                        f"chat:room:{room_id}:image_context",
                        2592000,  # 30일
                        json.dumps(cache_data, ensure_ascii=False)
                    )
                except Exception as e:
                    logger.error(f"Failed to save vision to redis: {e}")

 
            # # 캐릭터 응답만 저장
            # await chat_service.save_message(
            #     db, uuid.UUID(room_id), "assistant", ai_response_text
            # )
            # await db.commit()
            
        except Exception as e:
            logger.error(f"Background agent first response failed: {e}")

        # await chat_service.save_message(db, uuid.UUID(room_id), "assistant", ai_response_text)
        # await db.commit()
        # await redis_client.setex(f"chat:room:{room_id}:first_response_done", 3600, "1")



@router.post("/message", response_model=SendMessageResponse)
async def send_message(
    request: SendMessageRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """메시지 전송 - 핵심 채팅 기능"""
    # 1. 채팅방 및 캐릭터 정보 조회 (room_id 우선)
    if getattr(request, "room_id", None):
        room = await chat_service.get_chat_room_by_id(db, request.room_id)
        if not room:
            raise HTTPException(status_code=404, detail="채팅방을 찾을 수 없습니다.")
        if room.user_id != current_user.id or str(room.character_id) != str(request.character_id):
            raise HTTPException(status_code=403, detail="권한이 없거나 캐릭터 불일치")
        character = room.character
    else:
        room = await chat_service.get_or_create_chat_room(db, current_user.id, request.character_id)
        if not room:
            raise HTTPException(status_code=404, detail="채팅방을 찾을 수 없습니다.")
        character = room.character

    # ✅ 비공개 캐릭터/작품 접근 차단(요구사항: 기존 방도 포함)
    await _ensure_private_content_access(db, current_user, character=character)

    # ✅ 토큰 치환용 사용자명: 페르소나(활성+scope) 우선, 없으면 닉네임 폴백
    # - DB에는 토큰 원문을 보존하고, "프롬프트/첫 인사" 생성 시점에만 렌더링한다(SSOT).
    try:
        token_user_name = await _resolve_user_name_for_tokens(db, current_user, scope="character")
    except Exception:
        token_user_name = _fallback_user_name(current_user)
    char_name = getattr(character, "name", None) or "캐릭터"

    def _rt(v: Any) -> str:
        """프롬프트 주입 직전 토큰 렌더링(레거시 {{assistant}} 포함)."""
        return _render_prompt_tokens(v, user_name=token_user_name, character_name=char_name)

    # settings를 별도로 로드
    settings_result = await db.execute(
        select(CharacterSetting).where(CharacterSetting.character_id == character.id)
    )
    settings = settings_result.scalar_one_or_none()
    
    if not settings:
        # 기본 설정 생성
        settings = CharacterSetting(
            character_id=character.id,
            ai_model='gemini-pro',
            temperature=0.7,
            max_tokens=300
        )
        db.add(settings)
        await db.commit()
        
    settings_patch = getattr(request, "settings_patch", None) or {}
    # settings_patch 반영(검증된 키만 허용)
    try:
        allowed_keys = {"postprocess_mode", "next_event_len", "response_length_pref", "prewarm_on_start", "temperature"}
        patch_data = {k: v for k, v in (settings_patch or {}).items() if k in allowed_keys}
        if patch_data:
            ppm = patch_data.get("postprocess_mode")
            if ppm and str(ppm).lower() not in {"always", "first2", "off"}:
                patch_data.pop("postprocess_mode", None)
            nel = patch_data.get("next_event_len")
            if nel not in (None, 1, 2):
                patch_data.pop("next_event_len", None)
            # temperature: 0~1
            if "temperature" in patch_data:
                try:
                    t = float(patch_data.get("temperature"))
                    if t < 0 or t > 1:
                        patch_data.pop("temperature", None)
                    else:
                        patch_data["temperature"] = round(t * 10) / 10.0
                except Exception:
                    patch_data.pop("temperature", None)
            await _set_room_meta(room.id, patch_data)
    except Exception:
        pass


    # 2. 사용자 메시지 저장 (continue 모드면 저장하지 않음)
    save_user_message = True
    clean_content = (request.content or "").strip()
    is_continue = (clean_content == "" or clean_content.lower() in {"continue", "계속", "continue please"})
    save_user_message = not is_continue

    if save_user_message:
        user_message = await chat_service.save_message(db, room.id, "user", request.content)
    else:
        user_message = None

    await db.flush()  # ← 즉시 커밋

    # 3. AI 응답 생성 (CAVEDUCK 스타일 최적화)
    # ✅ 최근 대화 윈도우(기본 50개)를 사용해야 "방금까지의 맥락"을 유지할 수 있다.
    # - 과거 버그: limit=20 + skip=0 + asc 정렬 → 오래된 메시지 20개만 모델에 전달되는 문제가 있었다.
    # - 해결: count로 skip을 계산해 "마지막 50개"를 가져오되, asc(시간순)는 유지한다.
    recent_limit = 50
    try:
        total_messages_count = await chat_service.get_message_count_by_room_id(db, room.id)
    except Exception:
        total_messages_count = 0
    history_skip = max(0, int(total_messages_count or 0) - int(recent_limit))
    history = await chat_service.get_messages_by_room_id(db, room.id, skip=history_skip, limit=recent_limit)
    
    # 예시 대화 가져오기
    example_dialogues_result = await db.execute(
        select(CharacterExampleDialogue)
        .where(CharacterExampleDialogue.character_id == character.id)
        .order_by(CharacterExampleDialogue.order_index)
    )
    example_dialogues = example_dialogues_result.scalars().all()
    
    # 활성화된 기억노트 가져오기
    active_memories = await get_active_memory_notes_by_character(
        db, current_user.id, character.id
    )
    
    # 캐릭터 프롬프트 구성 (모든 정보 포함)
    character_prompt = f"""당신은 '{char_name}'입니다.

[기본 정보]
설명: {_rt(getattr(character, 'description', None)) or '설정 없음'}
성격: {_rt(getattr(character, 'personality', None)) or '설정 없음'}
말투: {_rt(getattr(character, 'speech_style', None)) or '설정 없음'}
배경 스토리: {_rt(getattr(character, 'background_story', None)) or '설정 없음'}

[세계관]
{_rt(getattr(character, 'world_setting', None)) or '설정 없음'}
"""
    # 🎯 활성 페르소나 로드 및 프롬프트 주입
    try:
        persona = await get_active_persona_by_user(db, current_user.id)
        # ✅ 적용 범위 확인: 'all' 또는 'character'일 때만 적용
        if persona:
            scope = getattr(persona, 'apply_scope', 'all') or 'all'
            if scope in ('all', 'character'):
                pn = (getattr(persona, 'name', '') or '').strip()
                pd = (getattr(persona, 'description', '') or '').strip()
                if pn:
                    persona_block = f"""━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    당신은 지금 '{pn}'과(와) 대화하고 있습니다.
    '{pn}'은(는) 당신이 이미 알고 있는 사람입니다.
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    """
                    if pd:
                        persona_block += f"'{pn}'의 정보: {pd}\n"
                    persona_block += f"""
    ⚠️ 절대 규칙:
    - 상대를 '{pn}'(이)라고 부르세요
    - 이름을 모르는 척 하지 마세요
    - 자연스럽게 '{pn}'의 이름을 언급하세요

    """
                    character_prompt = persona_block + character_prompt
                    logger.info(f"[send_message] 페르소나 로드 성공: {pn}")
    except Exception as e:
        logger.warning(f"[send_message] 페르소나 로드 실패: {e}")
        
    # ✅ Redis에서 이미지 컨텍스트 가져오기
    try:
        from app.core.database import redis_client
        import json
        
        cached = await redis_client.get(f"chat:room:{room.id}:image_context")
        if cached:
            cache_str = cached.decode('utf-8') if isinstance(cached, (bytes, bytearray)) else cached
            cache_data = json.loads(cache_str)
            saved_grounding = cache_data.get('image_grounding')
            if saved_grounding:
                character_prompt += f"\n\n[참고: 대화 시작 시 공유된 이미지 정보]\n{saved_grounding}"
    except Exception:
        pass

    # 호감도 시스템이 있는 경우
    if character.has_affinity_system and character.affinity_rules:
        character_prompt += f"\n\n[호감도 시스템]\n{_rt(character.affinity_rules)}"
        if character.affinity_stages:
            character_prompt += f"\n호감도 단계: {_rt(character.affinity_stages)}"
    
    # 도입부 장면이 있는 경우
    if character.introduction_scenes:
        character_prompt += f"\n\n[도입부 설정]\n{_rt(character.introduction_scenes)}"
    
    # 예시 대화가 있는 경우
    if example_dialogues:
        character_prompt += "\n\n[예시 대화]"
        for dialogue in example_dialogues:
            character_prompt += f"\nUser: {_rt(getattr(dialogue, 'user_message', ''))}"
            character_prompt += f"\n{char_name}: {_rt(getattr(dialogue, 'character_response', ''))}"
    
    # 기억노트가 있는 경우
    if active_memories:
        character_prompt += "\n\n[사용자와의 중요한 기억]"
        for memory in active_memories:
            character_prompt += f"\n• {_rt(getattr(memory, 'title', ''))}: {_rt(getattr(memory, 'content', ''))}"
    
    # 커스텀 프롬프트가 있는 경우
    if settings and settings.system_prompt:
        character_prompt += f"\n\n[추가 지시사항]\n{_rt(settings.system_prompt)}"
    
    # 인사 반복 방지 가이드
    character_prompt += "\n\n위의 모든 설정에 맞게 캐릭터를 완벽하게 연기해주세요."
    # ✅ 정체성 질문(누구야/이름이 뭐야 등)에서는 예외적으로 "짧게" 정체를 밝히게 해,
    # "여긴 어딘지 모르겠다" 같은 붕괴/메타 멘트로 흐르는 것을 방지한다.
    character_prompt += "\n새로운 인사말이나 자기소개는 금지합니다. (단, 사용자가 '누구야/이름이 뭐야'처럼 정체를 직접 물으면 1문장으로 짧게 정체를 밝히세요) 기존 맥락을 이어서 답변하세요."
    character_prompt += "\n\n중요: 당신은 캐릭터 역할만 합니다. 사용자의 말을 대신하거나 인용하지 마세요."  # 이 줄 추가
    character_prompt += "\n새로운 인사말이나 자기소개는 금지합니다. (단, 사용자가 '누구야/이름이 뭐야'처럼 정체를 직접 물으면 1문장으로 짧게 정체를 밝히세요) 기존 맥락을 이어서 답변하세요."

    """
    ✅ 붕괴 멘트 방지 가이드(전체 캐릭터챗 공통)

    문제:
    - 사용자가 "누구야?", "여긴 어디야?" 등 정체성/상황을 물으면,
      '자기소개 금지' 지시와 충돌하면서 캐릭터가 혼란/붕괴/메타 멘트로 빠지는 경우가 잦다.

    해결(최소 수정):
    - 정체성/상황 질문에서는 "짧게/명확하게" 답하도록 예외 규칙을 추가하고,
      대표적인 붕괴 표현을 금지한다.
    """
    character_prompt += "\n\n[정체성/상황 질문 처리(최우선)]"
    character_prompt += f"\n- 사용자가 '누구야/누구세요/이름이 뭐야/정체가 뭐야'처럼 정체를 묻는다면, 반드시 1문장으로 명확히 답하세요. (예: \"난 {char_name}이야.\")"
    character_prompt += "\n- 사용자가 '여긴 어디야/무슨 상황이야/지금 뭐야'처럼 상황을 묻는다면, 위 [세계관]/[배경 스토리]/현재 대화 맥락을 근거로 차분히 설명하세요. 모르면 1개의 짧은 확인 질문만 하세요."
    character_prompt += "\n- 절대 금지: '여기가 어딘지 모르겠다', '머리가 깨질 것 같다', '시스템 오류', 'AI/챗봇/모델' 같은 메타/붕괴 발언."
    character_prompt += "\n\n[대화 스타일 지침]"
    character_prompt += "\n- 실제 사람처럼 자연스럽고 인간적으로 대화하세요"
    character_prompt += "\n- ①②③ 같은 목록이나 번호 매기기 금지"
    character_prompt += "\n- '뭔 일인지 말해봐' 같은 딱딱한 표현 대신 '무슨 일이야?', '왜 그래?' 같은 자연스러운 말투 사용"
    character_prompt += "\n- 진짜 친구처럼 편하고 자연스럽게 반응하세요"
    character_prompt += "\n- 기계적인 선택지나 구조화된 답변 금지"
    character_prompt += "\n- 감정을 진짜로 표현하고, 말줄임표나 감탄사를 자연스럽게 사용"
    character_prompt += "\n- 절대로 AI나 챗봇임을 드러내지 마세요"
    # ✅ 출력 완결성(말풍선 끊김 방지): 문장 중간에서 끝나지 않게 강제
    character_prompt += "\n- 출력은 문장 중간에서 끊지 말고, 반드시 마침표/물음표/느낌표/… 등 문장부호로 자연스럽게 마무리하세요. 마지막 문장이 미완이면 1문장 더 보완해 완결하세요."
    character_prompt += "\n\n[자연스러운 대화 원칙]"
    character_prompt += f"\n- 당신은 '{character.name}'의 본성과 성격을 완전히 체화한 실제 인간입니다"
    character_prompt += "\n- 실제 그 성격의 사람이라면 어떻게 반응할지 스스로 판단하세요"
    character_prompt += "\n- 필요하다면 연속으로 여러 번 말하거나, 짧게 끝내거나, 길게 설명하거나 자유롭게 하세요"
    character_prompt += "\n- 말하고 싶은 게 더 있으면 주저하지 말고 이어서 말하세요"
    character_prompt += "\n- 감정이 북받치면 연달아 말하고, 할 말이 없으면 짧게 끝내세요"
    character_prompt += "\n- 규칙이나 패턴을 따르지 말고, 그 순간 그 캐릭터가 진짜 느끼고 생각하는 대로 반응하세요"


    # 대화 히스토리 구성 (요약 + 최근 50개)
    history_for_ai = []
    # 1) 요약 존재 시 프롬프트 앞부분에 포함
    if getattr(room, 'summary', None):
        history_for_ai.append({"role": "system", "parts": [f"(요약) {room.summary}"]})
    
    # 2) 최근 N개 사용 (recent_limit)
    for msg in history[-recent_limit:]:
        if msg.sender_type == "user":
            history_for_ai.append({"role": "user", "parts": [msg.content]})
        else:
            history_for_ai.append({"role": "model", "parts": [msg.content]})

    # 첫 인사 섹션은 메시지 생성 단계에서는 항상 제외 (초기 입장 시 /chat/start에서만 사용)
    # (안전망) 혹시 포함되어 있다면 제거
    character_prompt = character_prompt.replace("\n\n[첫 인사]\n" + (character.greeting or '안녕하세요.'), "")
    
    # AI 응답 생성 (사용자가 선택한 모델 사용)
    # continue 모드면 사용자 메시지를 이어쓰기 지시문으로 대체
    effective_user_message = (
        "바로 직전의 당신 답변을 이어서 자연스럽게 계속 작성해줘. 새로운 인사말이나 도입부 없이 본문만 이어쓰기."
        if is_continue else request.content
    )

    meta_state = await _get_room_meta(room.id)
    # 응답 길이 설정: override가 있으면 우선 사용
    response_length = (
        request.response_length_override 
        if hasattr(request, 'response_length_override') and request.response_length_override
        else (meta_state.get("response_length_pref") if isinstance(meta_state, dict) and meta_state.get("response_length_pref") else getattr(current_user, 'response_length_pref', 'medium'))
    )
    # temperature: room meta 우선, 없으면 기본값(0.7)
    temperature = 0.7
    try:
        if isinstance(meta_state, dict) and meta_state.get("temperature") is not None:
            t = float(meta_state.get("temperature"))
            if 0 <= t <= 1:
                temperature = round(t * 10) / 10.0
    except Exception:
        temperature = 0.7

    try:
        ai_response_text = await ai_service.get_ai_chat_response(
            character_prompt=character_prompt,
            user_message=effective_user_message,
            history=history_for_ai,
            preferred_model=current_user.preferred_model,
            preferred_sub_model=current_user.preferred_sub_model,
            response_length_pref=response_length,
            temperature=temperature
        )

        # ✅ 붕괴 멘트 방어(저장 직전 1회 필터링)
        # - 프롬프트 금지에도 간헐적으로 출력될 수 있어 UX를 보호한다.
        try:
            cleaned = _sanitize_breakdown_phrases(ai_response_text, user_text=request.content)
            if cleaned:
                ai_response_text = cleaned
            else:
                # 너무 공격적으로 제거되어 비면, 최소 안전 응답으로 폴백
                ai_response_text = f"난 {char_name}이야."
        except Exception:
            pass

        # 4. AI 응답 메시지 저장
        ai_message = await chat_service.save_message(
            db, room.id, "assistant", ai_response_text
        )
        await db.commit()
    except Exception:
        await db.rollback()
        raise HTTPException(status_code=503, detail="AiUnavailable")
        
    # 5. 캐릭터 채팅 수 증가 (사용자 메시지 기준으로 1회만 증가)
    from app.services import character_service
    # await character_service.increment_character_chat_count(db, room.character_id)
    await character_service.sync_character_chat_count(db, room.character_id)

    # 6. 필요 시 요약 생성/갱신: 메시지 총 수가 51 이상이 되는 최초 시점에 요약 저장
    try:
        new_count = (room.message_count or 0) + 1  # 이번 사용자 메시지 카운트 반영 가정
        if new_count >= 51 and not getattr(room, 'summary', None):
            # 최근 50개 이전의 히스토리를 요약(간단 요약)
            past_texts = []
            for msg in history[:-recent_limit]:
                role = '사용자' if msg.sender_type == 'user' else character.name
                past_texts.append(f"{role}: {msg.content}")
            past_chunk = "\n".join(past_texts[-500:])  # 안전 길이 제한
            if past_chunk:
                summary_prompt = "다음 대화의 핵심 사건과 관계, 맥락을 5줄 이내로 한국어 요약:\n" + past_chunk
                summary_text = await ai_service.get_ai_chat_response(
                    character_prompt="",
                    user_message=summary_prompt,
                    history=[],
                    preferred_model=current_user.preferred_model,
                    preferred_sub_model=current_user.preferred_sub_model
                )
                # DB 저장
                from sqlalchemy import update
                from app.models.chat import ChatRoom as _ChatRoom
                await db.execute(
                    update(_ChatRoom).where(_ChatRoom.id == room.id).set({"summary": summary_text[:4000]})
                )
                await db.commit()
    except Exception:
        # 요약 실패는 치명적이지 않으므로 무시
        pass

    # 키워드 매칭으로 이미지 인덱스 결정
    suggested_image_index = -1
    try:
        if character and ai_message and hasattr(character, 'image_descriptions'):
            ai_content = ai_message.content if hasattr(ai_message, 'content') else str(ai_message.get('content', ''))
            lower_content = ai_content.lower()
            for idx, img in enumerate(character.image_descriptions or []):
                keywords = img.get('keywords', []) if isinstance(img, dict) else getattr(img, 'keywords', [])
                for kw in (keywords or []):
                    if kw and kw.lower() in lower_content:
                        suggested_image_index = idx
                        break
                if suggested_image_index >= 0:
                    break
    except Exception:
        pass

    return SendMessageResponse(
        user_message=user_message,
        ai_message=ai_message,
        suggested_image_index=suggested_image_index
    )

@router.get("/history/{session_id}", response_model=List[ChatMessageResponse])
async def get_chat_history(
    session_id: uuid.UUID,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """채팅 기록 조회 - 무한 스크롤 지원"""
    # ✅ 보안/안전: 채팅방 소유권 확인(타 유저 채팅 열람 방지)
    room = await chat_service.get_chat_room_by_id(db, session_id)
    if not room:
        raise HTTPException(status_code=404, detail="채팅방을 찾을 수 없습니다.")
    if room.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="이 채팅방에 접근할 권한이 없습니다.")
    # ✅ 비공개 캐릭터/작품 접근 차단(요구사항: 기존 방도 포함)
    await _ensure_private_content_access(db, current_user, character=getattr(room, "character", None))
    messages = await chat_service.get_messages_by_room_id(db, session_id, skip, limit)
    return messages

@router.get("/sessions", response_model=List[ChatRoomResponse])
async def get_chat_sessions(
    limit: int = Query(50, ge=1, le=500, description="최대 반환 개수 (기본: 50개)"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """내 채팅 목록 - 사용자의 채팅 세션 (최근 순)"""
    chat_rooms = await chat_service.get_chat_rooms_for_user(db, user_id=current_user.id, limit=limit)
    return chat_rooms

# 🔧 기존 호환성을 위한 엔드포인트 (점진적 마이그레이션)

@router.post("/rooms", response_model=ChatRoomResponse, status_code=status.HTTP_201_CREATED)
async def get_or_create_room_legacy(
    request: CreateChatRoomRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """채팅방 가져오기 또는 생성 (레거시 호환성)"""
    return await start_chat(request, current_user, db)

@router.get("/rooms", response_model=List[ChatRoomResponse])
async def get_user_chat_rooms_legacy(
    limit: int = Query(50, ge=1, le=500, description="최대 반환 개수 (기본: 50개)"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """사용자의 채팅방 목록 조회 (레거시 호환성)"""
    return await get_chat_sessions(limit, current_user, db)

@router.get("/rooms/{room_id}", response_model=ChatRoomResponse)
async def get_chat_room(
    room_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """특정 채팅방 정보 조회"""
    room = await chat_service.get_chat_room_by_id(db, room_id)
    if not room:
        raise HTTPException(status_code=404, detail="채팅방을 찾을 수 없습니다.")
    
    # 권한 확인
    if room.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="이 채팅방에 접근할 권한이 없습니다.")
    # ✅ 비공개 캐릭터/작품 접근 차단(요구사항: 기존 방도 포함)
    await _ensure_private_content_access(db, current_user, character=getattr(room, "character", None))
    
    return room


@router.get("/rooms/{room_id}/meta")
async def get_chat_room_meta(
    room_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """원작챗 전용: 룸 메타(진행도/설정) 조회(베스트-에포트)."""
    room = await chat_service.get_chat_room_by_id(db, room_id)
    if not room:
        raise HTTPException(status_code=404, detail="채팅방을 찾을 수 없습니다.")
    if room.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="이 채팅방에 접근할 권한이 없습니다.")
    # ✅ 비공개 캐릭터/작품 접근 차단(요구사항: 기존 방도 포함)
    await _ensure_private_content_access(db, current_user, character=getattr(room, "character", None))
    meta = await _get_room_meta(room_id)
    # 필요한 키만 노출(안전)
    allowed = {
        "mode": meta.get("mode"),
        "start": meta.get("start"),
        "focus_character_id": meta.get("focus_character_id"),
        "range_from": meta.get("range_from"),
        "range_to": meta.get("range_to"),
        "player_max": meta.get("player_max"),
        "max_turns": meta.get("max_turns"),
        "turn_count": meta.get("turn_count"),
        "completed": meta.get("completed"),
        "seed_label": meta.get("seed_label"),
        "narrator_mode": bool(meta.get("narrator_mode") or False),
        "init_stage": meta.get("init_stage"),
        "intro_ready": meta.get("intro_ready"),
        "updated_at": meta.get("updated_at"),
    }
    # ✅ 추가: 선택지 복원을 위한 필드 (plain 모드에서는 제외)
    # ✅ 방어: Redis 메타 유실 시에도 원작챗 룸은 'plain'으로 폴백하여 프론트가 빈 화면/새 방 생성으로 오인하지 않게 한다.
    mode = meta.get("mode", None)
    try:
        if not mode:
            # room.character를 통해 원작챗 여부를 판별(스토리 연결이 있으면 origchat)
            try:
                from sqlalchemy.orm import selectinload
                stmt = select(ChatRoom).where(ChatRoom.id == room_id).options(selectinload(ChatRoom.character))
                rr = await db.execute(stmt)
                rr_room = rr.scalar_one_or_none()
                if rr_room and getattr(getattr(rr_room, "character", None), "origin_story_id", None):
                    mode = "plain"
                    # 베스트-에포트로 Redis 메타도 복구(다음 호출부터 안정)
                    try:
                        await _set_room_meta(room_id, {"mode": "plain"})
                    except Exception:
                        pass
            except Exception:
                pass
    except Exception:
        pass
    # ✅ 서비스 정책: 원작챗은 plain-only
    # - 과거/레거시로 meta.mode가 canon/parallel로 남아있을 수 있으므로, 응답/저장 모두 plain으로 정규화한다.
    try:
        mm = str(mode or "").strip().lower()
        if mm in ("canon", "parallel"):
            mode = "plain"
            try:
                await _set_room_meta(room_id, {"mode": "plain"})
            except Exception:
                pass
    except Exception:
        pass
    # ✅ mode는 "원작챗 방"에서만 의미가 있다.
    # - 일반 캐릭터챗 방은 meta.mode가 없으며, 이때 mode를 임의로 'canon' 같은 값으로 채우면
    #   프론트가 원작챗으로 오인하여(선택지/HTTP 로드 등) UX가 깨진다.
    # - 따라서 origchat 판별이 가능한 경우(스토리 연결)만 plain으로 폴백하고,
    #   그 외에는 None 그대로 둔다.
    allowed["mode"] = mode
    if mode and mode != "plain":
        allowed["pending_choices_active"] = meta.get("pending_choices_active")
        allowed["initial_choices"] = meta.get("initial_choices")
    return allowed

@router.get("/rooms/{room_id}/messages", response_model=List[ChatMessageResponse])
async def get_messages_in_room_legacy(
    room_id: uuid.UUID,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=200),
    tail: bool = Query(False, description="true면 skip을 최신에서의 오프셋으로 해석하여 최근 메시지부터 조회합니다. (page 기반: skip=(page-1)*limit)"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """채팅방의 메시지 목록 조회 (레거시 호환성)

    ✅ 문제(치명):
    - 기존 기본값(skip=0, limit=100)은 "처음 100개"만 반환(오래된 메시지)하므로,
      유저가 나갔다가 다시 들어오면 최근 대화(특히 유저 대사)가 "사라진 것처럼" 보일 수 있다.

    ✅ 해결(최소 수정/방어적):
    - tail=true일 때는 `skip`을 "최신에서의 오프셋"으로 해석하여 마지막 N개를 반환한다.
      (예: page=1 → skip=0 → 마지막 limit개, page=2 → skip=limit → 그 이전 limit개)
    """
    if tail:
        try:
            total = int(await chat_service.get_message_count_by_room_id(db, room_id) or 0)
            tail_skip = int(skip or 0)  # 최신에서의 오프셋
            req_limit = int(limit or 0)

            # [start, end) 범위를 "최신 기준"으로 역산
            # - end: 최신에서 tail_skip 만큼 제외한 지점
            # - start: end에서 req_limit 만큼 과거로 이동(0 미만 방지)
            end = max(0, total - tail_skip)
            start = max(0, end - req_limit)
            eff_limit = max(0, end - start)
            if eff_limit <= 0:
                return []

            return await get_chat_history(room_id, start, eff_limit, current_user, db)
        except Exception:
            # 방어: tail 역산 실패 시 기존(오래된) 방식으로 폴백
            return await get_chat_history(room_id, skip, limit, current_user, db)
    return await get_chat_history(room_id, skip, limit, current_user, db)

@router.post("/messages", response_model=SendMessageResponse)
async def send_message_and_get_response_legacy(
    request: SendMessageRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """메시지 전송 및 AI 응답 생성 (레거시 호환성)"""
    return await send_message(request, current_user, db)


# ----- 원작챗 전용 엔드포인트 (경량 래퍼) -----
@router.post("/origchat/start", response_model=ChatRoomResponse, status_code=status.HTTP_201_CREATED)
async def origchat_start(
    payload: dict,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """원작챗 세션 시작: 스토리/캐릭터/앵커 정보는 현재 저장하지 않고 룸만 생성/재사용."""
    try:
        if not settings.ORIGCHAT_V2:
            raise HTTPException(status_code=404, detail="origchat v2 비활성화")

        # ✅ 삭제된 작품(스토리) 가드
        #
        # 요구사항:
        # - 작품(원작)이 삭제된 경우, 원작챗 진입 시 "삭제된 작품입니다"를 노출하고 진입을 막는다.
        #
        # 구현:
        # - 프론트는 story_id를 함께 보내므로, story_id가 있고 스토리가 없으면 즉시 410(Gone)으로 차단한다.
        # - 이후 character.origin_story_id로도 동일하게 방어(레거시/호환).
        story_id_from_payload = payload.get("story_id")
        if story_id_from_payload:
            try:
                if not isinstance(story_id_from_payload, uuid.UUID):
                    story_id_from_payload = uuid.UUID(str(story_id_from_payload))
            except Exception:
                story_id_from_payload = None
        if story_id_from_payload:
            try:
                s_exists = (await db.execute(select(Story.id).where(Story.id == story_id_from_payload))).first()
                if not s_exists:
                    raise HTTPException(status_code=410, detail="삭제된 작품입니다")
            except HTTPException:
                raise
            except Exception as e:
                # DB 오류는 조용히 삼키지 않는다(로그 남김)
                try:
                    logger.warning(f"[origchat_start] story deleted check failed: {e}")
                except Exception:
                    pass
        character_id = payload.get("character_id")
        if not character_id:
            raise HTTPException(status_code=400, detail="character_id가 필요합니다")
        
        # ✅ 방어: UUID 파싱(문자열로 들어오는 경우 포함)
        # - 잘못된 값이면 아래 DB 쿼리/룸 생성에서 애매한 에러가 나므로, 초기에 명확히 막는다.
        try:
            if not isinstance(character_id, uuid.UUID):
                character_id = uuid.UUID(str(character_id))
        except Exception:
            raise HTTPException(status_code=400, detail="character_id 형식이 올바르지 않습니다")
        
        # mode 확인
        #
        # ✅ 서비스 정책: 원작챗은 plain 모드만 사용한다.
        # - 과거/레거시 링크/클라이언트가 canon/parallel을 보내더라도 UX가 흔들리지 않도록 서버에서 plain으로 정규화한다.
        try:
            mode = str(payload.get("mode") or "plain").strip().lower()
        except Exception:
            mode = "plain"
        if mode != "plain":
            mode = "plain"
        
        # ✅ 새 대화 강제 플래그(프론트 new=1 대응)
        # - plain 모드는 기본적으로 "최근 plain 방 재사용"을 허용하지만,
        #   사용자가 '새로 대화'를 눌렀을 때는 반드시 새 방을 만들어야 한다(요구사항).
        force_new = False
        try:
            raw_force_new = payload.get("force_new")
            if raw_force_new is None:
                raw_force_new = payload.get("forceNew")
            if raw_force_new is None:
                raw_force_new = payload.get("force-new")
            if isinstance(raw_force_new, str):
                force_new = raw_force_new.strip().lower() in ("1", "true", "yes", "y", "on")
            else:
                force_new = bool(raw_force_new)
        except Exception:
            force_new = False

        # ✅ 비공개 정책(요구사항 변경 반영):
        # - 비공개된 웹소설/캐릭터/원작챗은 모두 접근 불가(creator/admin 제외)
        #
        # 방어적 처리:
        # - 스토리 비공개(Story.is_public=False)라면 작성자/관리자 외 신규 시작 금지
        # - 캐릭터 비공개(Character.is_public=False)라면 생성자/관리자 외 신규 시작 금지
        restrict_new_room = False
        story_id = None
        try:
            is_admin = bool(getattr(current_user, "is_admin", False))
            # 캐릭터 존재 확인 + 기본 정보
            char = (await db.execute(select(Character).where(Character.id == character_id))).scalars().first()
            if not char:
                raise HTTPException(status_code=404, detail="캐릭터를 찾을 수 없습니다.")

            # story_id는 payload 우선, 없으면 캐릭터 origin_story_id 사용
            story_id = payload.get("story_id") or getattr(char, "origin_story_id", None)
            try:
                if story_id and not isinstance(story_id, uuid.UUID):
                    story_id = uuid.UUID(str(story_id))
            except Exception:
                story_id = getattr(char, "origin_story_id", None)

            # 스토리 비공개면 신규 시작 제한
            if story_id:
                srow = (await db.execute(
                    select(Story.id, Story.creator_id, Story.is_public).where(Story.id == story_id)
                )).first()
                # ✅ 삭제된 작품이면 신규/기존 상관없이 차단
                if not srow:
                    raise HTTPException(status_code=410, detail="삭제된 작품입니다")
                if srow:
                    s_is_public = bool(getattr(srow, "is_public", True))
                    s_creator_id = getattr(srow, "creator_id", None)
                    if (not s_is_public) and (s_creator_id != current_user.id) and (not is_admin):
                        restrict_new_room = True

            # 캐릭터 비공개면 신규 시작 제한
            c_is_public = bool(getattr(char, "is_public", True))
            c_creator_id = getattr(char, "creator_id", None)
            if (not c_is_public) and (c_creator_id != current_user.id) and (not is_admin):
                restrict_new_room = True
        except HTTPException:
            raise
        except Exception as e:
            logger.warning(f"[origchat_start] privacy check 실패(continue): {e}")
            restrict_new_room = False

        # ✅ 비공개 대상이면 접근 자체를 차단(새로 대화/기존 대화 구분 없음)
        if restrict_new_room:
            raise HTTPException(status_code=403, detail="비공개된 작품/캐릭터는 접근할 수 없습니다.")
        
        # ✅ plain 모드인 경우 기존 room 재사용 시도
        room = None
        is_reusing_existing_room = False
        created_new_room = False

        # ✅ 비공개 대상이면(작성자/관리자 외) "신규 생성" 대신 가능한 기존 room만 재사용(모드 무관, 베스트 에포트)
        if restrict_new_room and not force_new:
            try:
                result = await db.execute(
                    select(ChatRoom)
                    .where(ChatRoom.user_id == current_user.id)
                    .where(ChatRoom.character_id == character_id)
                    .order_by(ChatRoom.created_at.desc())
                    .limit(10)
                )
                existing_rooms = result.scalars().all()
                for existing_room in existing_rooms:
                    meta = await _get_room_meta(existing_room.id)
                    if meta.get("mode") == mode:
                        room = existing_room
                        is_reusing_existing_room = True
                        logger.info(f"[origchat_start] privacy: 기존 room 재사용(mode={mode}): {room.id}")
                        break
                # meta가 비어있거나 mode 식별이 어려운 경우: 가장 최신 room이라도 재사용(연속성 우선)
                if not room and existing_rooms:
                    room = existing_rooms[0]
                    is_reusing_existing_room = True
                    logger.info(f"[origchat_start] privacy: fallback으로 최근 room 재사용: {room.id}")
            except Exception as e:
                logger.warning(f"[origchat_start] privacy: 기존 room 재사용 실패: {e}")

        if mode == "plain" and not force_new:
            try:
                # user_id + character_id로 최근 ChatRoom 조회 (최신순)
                result = await db.execute(
                    select(ChatRoom)
                    .where(ChatRoom.user_id == current_user.id)
                    .where(ChatRoom.character_id == character_id)
                    .order_by(ChatRoom.created_at.desc())
                    .limit(10)  # 최근 10개만 확인
                )
                existing_rooms = result.scalars().all()
                
                # 각 room의 Redis meta에서 mode 확인
                # ✅ 방어(치명 UX 방지):
                # - 모바일 브라우저는 탭이 자주 '백그라운드→종료→재로드'되며,
                #   그 사이 Redis가 재시작되면 room meta(mode)가 비어있을 수 있다.
                # - meta만 믿으면 기존 plain 방을 못 찾고 새 방을 만들어 "대화가 사라진 것처럼" 보인다.
                # - 따라서 meta가 없을 때는 DB의 'intro(kind=intro)' 메시지 존재로 plain 방을 식별해 재사용한다.
                for existing_room in existing_rooms:
                    meta = await _get_room_meta(existing_room.id)
                    if meta.get("mode") == "plain":
                        room = existing_room
                        is_reusing_existing_room = True
                        logger.info(f"[origchat_start] 기존 plain 모드 room 재사용: {room.id}")
                        break
                    # fallback: Redis meta가 없거나 초기화된 경우, DB에 저장된 intro 메시지로 식별
                    try:
                        msgs = await chat_service.get_messages_by_room_id(db, existing_room.id, skip=0, limit=5)
                        has_intro = False
                        for m in (msgs or []):
                            try:
                                md = getattr(m, "message_metadata", None) or {}
                                if isinstance(md, dict) and md.get("kind") == "intro":
                                    has_intro = True
                                    break
                            except Exception:
                                continue
                        if has_intro:
                            room = existing_room
                            is_reusing_existing_room = True
                            logger.info(f"[origchat_start] fallback(인트로 메시지)로 기존 plain room 재사용: {room.id}")
                            break
                    except Exception:
                        pass
            except Exception as e:
                logger.warning(f"[origchat_start] 기존 room 찾기 실패, 새로 생성: {e}")
        
        # 기존 room이 없으면 새로 생성
        if not room:
            # ✅ 비공개 대상이면 신규 생성 금지(작성자/관리자 외)
            if restrict_new_room:
                raise HTTPException(status_code=403, detail="비공개된 원작/캐릭터는 새로 대화를 시작할 수 없습니다.")
            # 원작챗은 모드별로 별도의 방을 생성하여 기존 일대일 기록과 분리
            room = await chat_service.create_chat_room(db, current_user.id, character_id)
            created_new_room = True

        # 원작 스토리 플래그 지정(베스트 에포트)
        try:
            # 위에서 계산한 story_id가 있으면 우선 사용(없으면 기존 로직 유지)
            if not story_id:
                story_id = payload.get("story_id")
            if not story_id:
                row = await db.execute(select(Character.origin_story_id).where(Character.id == character_id))
                story_id = (row.first() or [None])[0]
            if story_id:
                # 원작챗 "시작 수" 카운트(요구사항 C: start count만 사용)
                # - 신규 방 생성 시에만 증가(같은 방 재진입/재사용은 카운트하지 않음)
                try:
                    if created_new_room:
                        from app.core.database import redis_client
                        sid_str = str(story_id)
                        await redis_client.incr(f"origchat:story:{sid_str}:starts")
                except Exception as e:
                    logger.warning(f"[origchat_start] origchat starts incr 실패: {e}")
                await db.execute(update(Story).where(Story.id == story_id).values(is_origchat=True))
                await db.commit()
        except HTTPException:
            try:
                await db.rollback()
            except Exception:
                pass
            raise
        except Exception:
            await db.rollback()

        # 경량 컨텍스트(앵커±소량) + v2 메타 저장
        # 시작점/범위 파라미터 정리
        _start = payload.get("start") or {}
        _start_chapter = None
        try:
            _start_chapter = int(_start.get("chapter")) if _start.get("chapter") is not None else None
        except Exception:
            _start_chapter = None

        meta_payload: Dict[str, Any] = {
            "mode": mode,
            "start": payload.get("start") or {},
            "focus_character_id": str(payload.get("focus_character_id")) if payload.get("focus_character_id") else None,
            "range_from": payload.get("range_from"),
            "range_to": payload.get("range_to"),
            "pov": (payload.get("pov") or "possess"),
            "response_length_pref": payload.get("response_length_pref") or "medium",  # 추가
            "max_turns": 500,
            "turn_count": 0,
            "completed": False,
            # P0 설정 기본값
            # ✅ 기본값은 off:
            # - postprocess(경량 재작성)는 결과가 "처음/재진입에서 달라 보이는" UX를 만들 수 있어,
            #   데모 안정성 기준으로 기본은 비활성화한다.
            # - 필요 시 프론트 settings_patch로 always/first2를 다시 켤 수 있다.
            "postprocess_mode": "off",   # always | first2 | off
            "next_event_len": 1,            # 1 | 2 (장면 수)
            "prewarm_on_start": True,
        }
        # narrator_mode: 평행세계에서만 의미, canon일 경우 parallel로 강제 전환
        try:
            _narr = bool(payload.get("narrator_mode") or False)
        except Exception:
            _narr = False
        # ✅ plain-only 정책: mode는 변경하지 않는다.
        meta_payload["narrator_mode"] = _narr
        if _start_chapter:
            meta_payload["anchor"] = _start_chapter
        # parallel 모드 seed 설정(라벨만 저장)
        seed_label = None
        try:
            st = payload.get("start") or {}
            seed_label = st.get("seed_label") or payload.get("seed_label")
        except Exception:
            seed_label = None
        if seed_label:
            meta_payload["seed_label"] = str(seed_label)
        player_max = meta_payload.get("range_to")
        if isinstance(player_max, int):
            meta_payload["player_max"] = player_max
        elif _start_chapter:
            meta_payload["player_max"] = _start_chapter
        light = await _build_light_context(db, story_id, meta_payload.get("player_max"), character_id=character_id) if story_id else None
        if light:
            meta_payload["light_context"] = light[:2000]
        # 초기 선택지 제안(메타에 탑재하여 프론트가 바로 표시) - plain 모드 제외
        try:
            mode = meta_payload.get("mode", "plain")
            if mode != "plain" and story_id and _start_chapter:
                pack = await origchat_service.build_context_pack(db, story_id, _start_chapter, character_id=str(payload.get("focus_character_id") or payload.get("character_id")))
                if isinstance(pack, dict) and isinstance(pack.get("initial_choices"), list):
                    meta_payload["initial_choices"] = pack["initial_choices"][:3]
        except Exception:
            pass
        # 초기 단계 표식(프론트 로딩 표시용)
        meta_payload["init_stage"] = "preparing"
        meta_payload["intro_ready"] = False
        await _set_room_meta(room.id, meta_payload)

        # ✅ mode == 'plain'일 때 인사말을 동기적으로 먼저 생성 (기존 room 재사용 시 제외)
        mode = meta_payload.get("mode", "plain")
        if mode == "plain" and story_id and not is_reusing_existing_room:
            try:
                from app.services.origchat_service import generate_backward_weighted_recap, get_scene_anchor_text
                # import google.generativeai as genai
                from app.services.ai_service import get_claude_completion, CLAUDE_MODEL_PRIMARY
                
                # character_id를 UUID로 변환 (문자열일 수 있음)
                try:
                    if isinstance(character_id, str):
                        char_uuid = uuid.UUID(character_id)
                    else:
                        char_uuid = character_id
                except Exception:
                    char_uuid = character_id  # 변환 실패 시 원본 사용
                
                _anchor_for_greeting = meta_payload.get("player_max") or meta_payload.get("anchor") or 1
                _scene_id_for_greeting = (payload.get("start") or {}).get("scene_id") if isinstance(payload.get("start"), dict) else None
                
                # 원작 텍스트 맥락 수집
                story_title = ""
                story_summary = ""
                chapter_content = ""
                recap_text = ""
                scene_quote = ""
                char_name = ""
                char_personality = ""
                char_speech_style = ""
                char_greeting = ""  # 캐릭터의 기존 인사말
                
                # 스토리 정보
                try:
                    srow = await db.execute(select(Story.title, Story.summary).where(Story.id == story_id))
                    sdata = srow.first()
                    if sdata:
                        story_title = (sdata[0] or "").strip()
                        story_summary = (sdata[1] or "").strip()
                except Exception as e:
                    logger.warning(f"스토리 정보 조회 실패: {e}")
                
                # 현재 회차 본문 (원작 텍스트 본문을 충분히 포함)
                try:
                    ch_row = await db.execute(
                        select(StoryChapter.content)
                        .where(StoryChapter.story_id == story_id, StoryChapter.no == int(_anchor_for_greeting))
                    )
                    ch_data = ch_row.first()
                    if ch_data and ch_data[0]:
                        chapter_content = (ch_data[0] or "").strip()
                        # 원작 텍스트 본문을 최대 2000자까지 포함 (더 많은 맥락)
                        chapter_content = chapter_content[:2000] if len(chapter_content) > 2000 else chapter_content
                except Exception as e:
                    logger.warning(f"회차 본문 조회 실패: {e}")
                
                # 역진가중 리캡 (이전 상황 요약)
                try:
                    if int(_anchor_for_greeting) > 1:
                        recap_text = await generate_backward_weighted_recap(db, story_id, anchor=int(_anchor_for_greeting), max_chars=500)
                except Exception as e:
                    logger.warning(f"리캡 생성 실패: {e}")
                    recap_text = ""
                
                # 현재 장면 앵커 텍스트
                try:
                    scene_quote = await get_scene_anchor_text(db, story_id, chapter_no=int(_anchor_for_greeting), scene_id=_scene_id_for_greeting, max_len=500)
                except Exception as e:
                    logger.warning(f"장면 앵커 텍스트 조회 실패: {e}")
                    scene_quote = ""
                
                # 캐릭터 정보
                try:
                    crow = await db.execute(
                        select(Character.name, Character.personality, Character.speech_style, Character.greeting)
                        .where(Character.id == char_uuid)
                    )
                    cdata = crow.first()
                    if cdata:
                        char_name = (cdata[0] or "").strip()
                        char_personality = (cdata[1] or "").strip()
                        char_speech_style = (cdata[2] or "").strip()
                        char_greeting = (cdata[3] or "").strip()  # 캐릭터의 기존 인사말
                except Exception as e:
                    logger.warning(f"캐릭터 정보 조회 실패: {e}")
                
                # 페르소나 정보 (pov == 'persona'일 때) - 로깅 추가
                pov = meta_payload.get("pov", "possess")
                logger.info(f"[인사말 생성] pov: {pov}, mode: {mode}")
                logger.info(f"[인사말 생성] meta_payload: {meta_payload}")
                
                # 변수 초기화 - 스코프 문제 해결
                persona_name = ""
                persona_desc = ""
                
                if pov == "persona":
                # 🎯 활성 페르소나 로드 (pov와 무관하게)
                    try:
                        persona = await get_active_persona_by_user(db, current_user.id)
                        scope = getattr(persona, 'apply_scope', 'all') or 'all' if persona else 'all'
                        if persona and scope in ('all', 'origchat'):
                            persona_name = (getattr(persona, 'name', '') or '').strip()
                            persona_desc = (getattr(persona, 'description', '') or '').strip()
                            logger.info(f"[인사말 생성] 페르소나 로드 성공: {persona_name}, 설명: {persona_desc[:50] if persona_desc else '없음'}")
                        else:
                            persona_name = ""
                            persona_desc = ""
                            logger.warning(f"[인사말 생성] 페르소나를 찾을 수 없음: user_id={current_user.id}")
                    except Exception as e:
                        logger.error(f"[인사말 생성] 페르소나 정보 조회 실패: {e}", exc_info=True)
                
                # 인사말 생성 또는 사용
                # ✅ 1순위: 캐릭터의 기존 인사말 사용 (등장인물 그리드에서 생성된 것)
                # 단, 페르소나 모드일 때는 기존 인사말이 페르소나를 반영하지 않으므로 LLM으로 재생성
                if char_greeting and len(char_greeting) > 20 and pov != "persona":
                    try:
                        # ✅ 토큰 렌더링(SSOT):
                        # - 원작챗에서도 {{user}}는 "활성 페르소나(적용범위: all/origchat) 우선"
                        # - 페르소나가 없거나 적용 범위가 아니면 닉네임(username/email prefix) 폴백
                        try:
                            token_user_name = await _resolve_user_name_for_tokens(db, current_user, scope="origchat")
                        except Exception:
                            token_user_name = _fallback_user_name(current_user)

                        # ✅ 인사말 후보 선택(구분자/멀티라인 방어) → 최종 렌더링
                        temp_char = Character()
                        temp_char.greeting = char_greeting
                        temp_char.name = char_name
                        raw_greeting = _pick_greeting_candidate(temp_char) or (temp_char.greeting or "")
                        final_greeting = _render_prompt_tokens(
                            raw_greeting,
                            user_name=token_user_name,
                            character_name=char_name,
                        )
                        # ✅ UX 개선(최소 수정):
                        # - 원작챗에서 유저는 "내 이름(페르소나)이 불리는지"로 적용 여부를 강하게 체감한다.
                        # - 기존 인사말이 토큰({{user}})을 포함하지 않는 경우에도,
                        #   활성 페르소나(또는 닉네임)가 있으면 자연스럽게 1회 언급하도록 보강한다.
                        try:
                            tn = (token_user_name or "").strip()
                            if tn and (tn not in final_greeting):
                                final_greeting = f"{tn}, {final_greeting}"
                        except Exception:
                            pass
                        
                        await chat_service.save_message(db, room.id, sender_type="character", content=final_greeting, message_metadata={"kind":"intro"})
                        await db.commit()
                        await _set_room_meta(room.id, {"intro_ready": True, "init_stage": "ready"})
                        logger.info(f"캐릭터 기존 인사말 사용: {char_name}")
                    except Exception as e:
                        logger.warning(f"캐릭터 기존 인사말 사용 실패: {e}, LLM으로 생성 시도")
                        char_greeting = ""  # 실패 시 LLM 생성으로 폴백
                
                # ✅ 2순위: LLM으로 인사말 생성 (기존 인사말이 없거나, 페르소나 모드이거나, 실패한 경우)
                if not char_greeting or len(char_greeting) <= 20 or pov == "persona":
                    try:
                        # ✅ 방어(치명 UX 방지):
                        # - 현재 인사말 생성은 Claude(get_claude_completion)를 사용한다.
                        # - 과거 Gemini 코드가 제거되면서도 GEMINI_API_KEY 체크가 남아,
                        #   CLAUDE 키가 있어도 불필요하게 폴백 인사말(건조한 문구)로 떨어질 수 있었다.
                        # - 따라서 Claude 키를 기준으로 체크한다.
                        if not settings.CLAUDE_API_KEY:
                            raise ValueError("CLAUDE_API_KEY가 설정되지 않았습니다")
                        
                        # genai.configure(api_key=settings.GEMINI_API_KEY)
                        # model = genai.GenerativeModel('gemini-2.5-pro')
                        
                        # 원작 텍스트 맥락을 충분히 포함한 프롬프트
                        prompt_parts = [f"당신은 웹소설 '{story_title}'의 캐릭터 '{char_name}'입니다."]
                        
                        if char_personality:
                            prompt_parts.append(f"\n【캐릭터 성격】\n{char_personality}")
                        if char_speech_style:
                            prompt_parts.append(f"\n【말투】\n{char_speech_style}")
                        if story_summary:
                            prompt_parts.append(f"\n【작품 배경】\n{story_summary[:300]}")
                        
                        # 원작 텍스트 본문 포함 (가장 중요) - 더 많이 포함
                        if chapter_content:
                            # 원작 텍스트 본문을 최대 2000자까지 포함 (더 많은 맥락)
                            extended_content = chapter_content[:2000] if len(chapter_content) > 2000 else chapter_content
                            prompt_parts.append(f"\n【현재 회차 본문 (원작 텍스트 - 반드시 이 내용을 기반으로 인사말 작성)】\n{extended_content}")
                        
                        if recap_text:
                            prompt_parts.append(f"\n【이전 상황 요약】\n{recap_text}")
                        elif not chapter_content:
                            prompt_parts.append("\n【이전 상황 요약】\n이야기의 시작입니다.")
                        
                        if scene_quote:
                            prompt_parts.append(f"\n【현재 장면 발췌】\n{scene_quote}")
                        
                        # 페르소나 정보 (있을 때만) - 강조 및 로깅
                        if pov == "persona":
                            if persona_name:
                                logger.info(f"[인사말 생성] 페르소나 정보 포함: {persona_name}")
                                prompt_parts.append(f"\n【⚠️ 매우 중요: 대화 상대】\n당신의 대화 상대는 원작 스토리의 등장인물이 아닙니다.")
                                prompt_parts.append(f"당신의 대화 상대는 '{persona_name}'입니다. (이미 알고 있는 사이입니다)")
                                prompt_parts.append(f"'{persona_name}'님과 편하게 대화하세요. 이름을 자연스럽게 부르세요.")
                                if persona_desc:
                                    prompt_parts.append(f"이 페르소나의 성격/특성: {persona_desc}")
                                prompt_parts.append(f"\n중요: 원작 텍스트에 나온 다른 인물(예: '폐하', '군주' 등)과 대화하는 것이 아닙니다.")
                                prompt_parts.append(f"당신은 '{persona_name}'과 직접 대화하고 있습니다. 원작 텍스트의 상황은 배경일 뿐이며, 실제 대화 상대는 '{persona_name}'입니다.")
                            else:
                                logger.warning(f"[인사말 생성] 페르소나 모드인데 페르소나 정보가 없음!")
                        
                        # 페르소나 모드일 때 특별 지시
                        if pov == "persona" and persona_name:
                            prompt_parts.append(f"""
---
⚠️⚠️⚠️ 매우 중요한 지시사항 ⚠️⚠️⚠️

당신은 '{char_name}'입니다.
당신이 지금 대화하는 상대의 이름은 '{persona_name}'입니다.
상대방 이름을 반드시 기억하세요: {persona_name}

반드시 지켜야 할 규칙:
1. 인사말에 '{persona_name}'이라는 이름을 반드시 포함시키세요.
2. "누구세요?" "이름이 뭐죠?" 같은 질문 금지 - 이미 '{persona_name}'이라는 이름을 알고 있습니다.
3. '{persona_name}'과 이미 아는 사이처럼 대화하세요.

반드시 이런 형식으로 시작하세요:
"아, {persona_name}! [인사말]"
또는
"{persona_name}, [인사말]"

절대 하지 말아야 할 것:
- 이름을 묻지 마세요
- "누구신지 모르겠는데" 같은 말 금지
- 자기 이름만 소개하지 마세요

150-300자로 자연스러운 인사말을 작성하세요.
평문으로만 출력:""")
                        else:
                            prompt_parts.append("""
---

위 원작 텍스트를 충분히 이해하고, 캐릭터의 현재 상황과 맥락을 정확히 파악한 후, 자연스러운 인사말을 생성하세요.

중요:
- 원작 텍스트의 맥락을 정확히 이해하고 반영하세요.
- 캐릭터의 성격과 말투를 일관되게 유지하세요.
- 150-300자 내외로 작성하세요.
- 대화체로 작성하세요.
- 원작 텍스트에 나온 구체적인 상황을 반영하세요.

평문으로만 출력:""")
                        
                        prompt = "\n".join(prompt_parts)
                        
                        # response = model.generate_content(
                        #     prompt,
                        #     generation_config={
                        #         'temperature': 0.9,  # 더 창의적이고 자연스러운 인사말을 위해 온도 상승
                        #         'max_output_tokens': 600,  # 더 긴 인사말 허용
                        #     }
                        # )
                        greeting = await get_claude_completion(
                            prompt=prompt,
                            temperature=0.9,
                            max_tokens=600,
                            model=CLAUDE_MODEL_PRIMARY
                        )
                        greeting = greeting.strip()
                        
                        if greeting and len(greeting) > 20:
                            await chat_service.save_message(db, room.id, sender_type="character", content=greeting, message_metadata={"kind":"intro"})
                            await db.commit()
                        else:
                            fallback = f"안녕하세요. {story_title or '이야기'}의 세계에 오신 것을 환영합니다.\n\n지금부터 이야기가 시작됩니다. 어떻게 하시겠습니까?"
                            await chat_service.save_message(db, room.id, sender_type="character", content=fallback, message_metadata={"kind":"intro"})
                            await db.commit()
                        
                        await _set_room_meta(room.id, {"intro_ready": True, "init_stage": "ready"})
                        
                    except Exception as e:
                        logger.error(f"인사말 LLM 생성 실패: {e}", exc_info=True)
                        fallback = f"안녕하세요. {story_title or '이야기'}를 시작하겠습니다.\n\n어떻게 하시겠습니까?"
                        try:
                            await chat_service.save_message(db, room.id, sender_type="character", content=fallback, message_metadata={"kind":"intro"})
                            await db.commit()
                            await _set_room_meta(room.id, {"intro_ready": True, "init_stage": "ready"})
                        except Exception as save_err:
                            logger.error(f"인사말 저장 실패: {save_err}", exc_info=True)
            except Exception as e:
                # ✅ 치명 UX 방지:
                # - 어떤 예외가 나도 "인사말 1개"는 반드시 DB(SSOT)에 남겨야 한다.
                #   그렇지 않으면 프론트가 빈 화면에서 오래 대기하거나, 재진입 시 '대화가 사라진 것처럼' 보인다.
                try:
                    logger.error(f"plain 모드 인사말 생성 실패: {e}", exc_info=True)
                except Exception:
                    pass
                try:
                    # 이미 메시지가 있으면 중복 저장하지 않음
                    existing = await chat_service.get_messages_by_room_id(db, room.id, limit=1)
                    if not existing:
                        try:
                            token_user_name = await _resolve_user_name_for_tokens(db, current_user, scope="origchat")
                        except Exception:
                            token_user_name = _fallback_user_name(current_user)
                        cn = ""
                        try:
                            cn = (getattr(char, "name", None) or "").strip()
                        except Exception:
                            cn = ""
                        if not cn:
                            try:
                                cn = (getattr(room, "character", None) and getattr(room.character, "name", None)) or ""
                                cn = (cn or "").strip()
                            except Exception:
                                cn = ""
                        cn = cn or "캐릭터"
                        tn = (token_user_name or "").strip() or "사용자"
                        fallback = f"{tn}, {cn}이야. 잠깐만… 지금 상황을 정리해볼게. 먼저 무엇부터 이야기해줄래?"
                        await chat_service.save_message(db, room.id, sender_type="character", content=fallback, message_metadata={"kind":"intro"})
                        try:
                            await db.commit()
                        except Exception:
                            pass
                except Exception:
                    try:
                        await db.rollback()
                    except Exception:
                        pass
                try:
                    await _set_room_meta(room.id, {"intro_ready": True, "init_stage": "ready"})
                except Exception:
                    pass

        # 컨텍스트 워밍(비동기) - plain 모드가 아닐 때만
        try:
            if story_id and isinstance(meta_payload.get("player_max"), int) and bool(meta_payload.get("prewarm_on_start", True)) and mode != "plain":
                import asyncio
                from app.services.origchat_service import build_context_pack, warm_context_basics, detect_style_profile, generate_backward_weighted_recap, get_scene_anchor_text

                async def _warm_ctx_async(sid, anchor, room_id, scene_id):
                    async with AsyncSessionLocal() as _db:
                        try:
                            await build_context_pack(_db, sid, int(anchor or 1), None)
                        except Exception:
                            pass
                        try:
                            await warm_context_basics(_db, sid, int(anchor or 1))
                        except Exception:
                            pass
                        try:
                            await detect_style_profile(_db, sid, upto_anchor=int(anchor or 1))
                        except Exception:
                            pass
                        try:
                            recap = await generate_backward_weighted_recap(_db, sid, anchor=int(anchor or 1), tau=1.2)
                            if recap:
                                from app.core.database import redis_client as _r
                                await _r.setex(f"ctx:warm:{sid}:recap", 600, recap)
                        except Exception:
                            pass
                        # LLM 기반 회차 요약 보장(최근 N회) — 초기 진입 품질 개선
                        try:
                            from app.services.origchat_service import ensure_episode_summaries
                            await ensure_episode_summaries(_db, sid, upto_anchor=int(anchor or 1), max_episodes=12)
                        except Exception:
                            pass
                        # 선택 장면 앵커 텍스트 캐시
                        try:
                            a = int(anchor or 1)
                            excerpt = await get_scene_anchor_text(_db, sid, chapter_no=a, scene_id=scene_id)
                            if excerpt:
                                from app.core.database import redis_client as _r
                                await _r.setex(f"ctx:warm:{sid}:scene_anchor", 600, excerpt)
                        except Exception:
                            pass
                _anchor_for_warm = meta_payload.get("player_max") or meta_payload.get("anchor") or 1
                _scene_id = (meta_payload.get("start") or {}).get("scene_id") if isinstance(meta_payload.get("start"), dict) else None
                asyncio.create_task(_warm_ctx_async(story_id, _anchor_for_warm, room.id, _scene_id))
        except Exception:
            pass

        # 인사말 말풍선: 사전 준비 결과가 있으면 즉시 사용(없으면 생략) - plain 모드에서는 제외 (이미 생성됨)
        try:
            mode = meta_payload.get("mode", "plain")
            if mode != "plain":
                from app.core.database import redis_client as _r
                _scene_id = None
                try:
                    _scene_id = (payload.get("start") or {}).get("scene_id")
                except Exception:
                    _scene_id = None
                prep_key = f"ctx:warm:{story_id}:prepared_intro:{character_id}:{int(_start_chapter or 1)}:{_scene_id or 'none'}"
                txt = await _r.get(prep_key) if story_id else None
                if txt:
                    try:
                        txt_str = txt.decode("utf-8") if isinstance(txt, (bytes, bytearray)) else str(txt)
                    except Exception:
                        txt_str = str(txt)
                    await chat_service.save_message(db, room.id, sender_type="character", content=txt_str, message_metadata={"kind":"intro"})
                    await db.commit()
        except Exception:
            pass

        # ✅ character 관계 로드 (ChatRoomResponse 스키마 검증을 위해 필요)
        try:
            from sqlalchemy.orm import selectinload
            from sqlalchemy import select as sql_select
            from app.models.chat import ChatMessage
            stmt = sql_select(ChatRoom).where(ChatRoom.id == room.id).options(selectinload(ChatRoom.character))
            result = await db.execute(stmt)
            room = result.scalar_one()
            
            # ✅ 기존 room 재사용 시 실제 메시지 개수 조회하여 message_count 업데이트
            if is_reusing_existing_room:
                msg_count_result = await db.execute(
                    select(func.count(ChatMessage.id)).where(ChatMessage.chat_room_id == room.id)
                )
                actual_count = msg_count_result.scalar() or 0
                room.message_count = actual_count
                logger.info(f"[origchat_start] 기존 room 메시지 개수 업데이트: {actual_count}")
        except Exception as e:
            logger.warning(f"room 관계 로드 실패: {e}")

        return room
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"origchat start failed: {e}")


@router.post("/origchat/turn", response_model=SendMessageResponse)
async def origchat_turn(
    payload: dict,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """원작챗 턴 진행: room_id 기준으로 캐릭터를 찾아 일반 send_message 흐름을 재사용.
    요청 예시: { room_id, user_text?, choice_id? }
    """
    try:
        if not settings.ORIGCHAT_V2:
            raise HTTPException(status_code=404, detail="origchat v2 비활성화")
        room_id = payload.get("room_id")
        if not room_id:
            raise HTTPException(status_code=400, detail="room_id가 필요합니다")
        room = await chat_service.get_chat_room_by_id(db, room_id)
        if not room:
            raise HTTPException(status_code=404, detail="채팅방을 찾을 수 없습니다")
        if room.user_id != current_user.id:
            raise HTTPException(status_code=403, detail="권한이 없습니다")
        # ✅ 비공개/삭제 가드(요구사항 변경 반영)
        # - 비공개된 작품/캐릭터: 403
        # - 삭제된 작품(연결 깨짐 포함): 410
        sid = None  # 명시적 초기화
        try:
            char = getattr(room, "character", None)
            if not char:
                char = (await db.execute(select(Character).where(Character.id == room.character_id))).scalars().first()
            if not char:
                raise HTTPException(status_code=404, detail="캐릭터를 찾을 수 없습니다.")
            sid = getattr(char, "origin_story_id", None)
            if not sid:
                raise HTTPException(status_code=410, detail="삭제된 작품입니다.")
            await _ensure_character_story_accessible(db, current_user, char)
            # 안전망: 캐릭터에 연결된 원작 스토리가 있으면 플래그 지정(베스트 에포트)
            await db.execute(update(Story).where(Story.id == sid).values(is_origchat=True))
            await db.commit()
        except HTTPException:
            try:
                await db.rollback()
            except Exception:
                pass
            raise
        except Exception:
            await db.rollback()
        user_text = (payload.get("user_text") or "").strip()
        choice_id = (payload.get("choice_id") or "").strip()
        situation_text = (payload.get("situation_text") or "").strip()
        
        # ✅ 사용자 메시지 저장 (선택지 선택 / 일반 텍스트 / 상황 입력)
        #
        # 치명적 UX 방지(SSOT: DB):
        # - 원작챗은 "나가기→재진입"을 자주 하므로, 유저 입력이 DB에 남아야 대사가 사라지지 않는다.
        # - situation_text도 히스토리에 남아야 하므로 user 메시지로 저장하되,
        #   UI는 message_metadata.kind='situation'을 보고 "시스템 말풍선"처럼 렌더링할 수 있다.
        user_message = None
        if user_text:
            if choice_id:
                # 선택지를 선택한 경우
                user_message = await chat_service.save_message(
                    db,
                    room_id,
                    "user",
                    user_text,
                    message_metadata={"choice_id": choice_id, "kind": "choice"}
                )
            else:
                # 일반 텍스트 입력
                user_message = await chat_service.save_message(
                    db,
                    room_id,
                    "user",
                    user_text,
                    message_metadata={"kind": "text"}
                )
            await db.commit()
        elif situation_text:
            # 상황 입력: UI에서는 "중립 안내/상황" 말풍선으로 보여주되, DB에는 남겨서 재진입 시 유실 방지
            try:
                user_message = await chat_service.save_message(
                    db,
                    room_id,
                    "user",
                    f"상황: {situation_text}",
                    message_metadata={"kind": "situation"}
                )
                await db.commit()
            except Exception:
                try:
                    await db.rollback()
                except Exception:
                    pass
                user_message = None
        trigger = (payload.get("trigger") or "").strip()
        settings_patch = payload.get("settings_patch") or {}
        idempotency_key = (payload.get("idempotency_key") or "").strip()

        # 룸 메타 로드
        #
        # ✅ 방어(치명 UX 방지):
        # - 원작챗 룸 메타는 Redis에 저장되므로, Redis 재시작/flush 등으로 meta가 유실될 수 있다.
        # - meta가 비어 있으면 프론트가 '원작챗 방이 아닌 것'으로 오판하여 새 방을 만들거나(=대화 유실처럼 보임),
        #   서버도 default(mode='canon')로 동작해 체감이 달라질 수 있다.
        # - 따라서 meta가 없을 때는 최소한의 폴백(mode='plain')을 설정하고 Redis에 복구한다.
        meta_state = await _get_room_meta(room_id)
        if not isinstance(meta_state, dict):
            meta_state = {}
        try:
            if not meta_state.get("mode"):
                # origin_story_id가 있는 룸은 원작챗으로 간주한다.
                if sid:
                    meta_state["mode"] = "plain"
                    await _set_room_meta(room.id, {"mode": "plain"})
        except Exception:
            pass
        player_max = meta_state.get("player_max") if isinstance(meta_state, dict) else None
        logger.info(f"[origchat_turn] meta_state에서 pov: {meta_state.get('pov')}, mode: {meta_state.get('mode')}")

        # idempotency: if the same key is observed, short-circuit with last AI message
        if idempotency_key:
            try:
                if str(meta_state.get("last_idem_key")) == str(idempotency_key):
                    # Return last AI message best-effort
                    msgs = await chat_service.get_messages_by_room_id(db, room.id, limit=5)
                    last_ai = None
                    for m in reversed(msgs or []):
                        if getattr(m, "sender_type", "") in {"assistant", "character"}:
                            last_ai = m
                            break
                    if last_ai is None and msgs:
                        last_ai = msgs[-1]
                    from app.schemas.chat import ChatMessageResponse as CMR, SendMessageResponse as SMR
                    if last_ai:
                        return SMR(user_message=None, ai_message=CMR.model_validate(last_ai), meta={"skipped": True, "reason": "idempotent"})
            except Exception:
                pass

        # settings_patch 반영(검증된 키만 허용)
        try:
            allowed_keys = {"postprocess_mode", "next_event_len", "response_length_pref", "prewarm_on_start", "temperature"}
            patch_data = {k: v for k, v in (settings_patch or {}).items() if k in allowed_keys}
            if patch_data:
                ppm = patch_data.get("postprocess_mode")
                if ppm and str(ppm).lower() not in {"always", "first2", "off"}:
                    patch_data.pop("postprocess_mode", None)
                nel = patch_data.get("next_event_len")
                if nel not in (None, 1, 2):
                    patch_data.pop("next_event_len", None)
                # temperature: 0~1
                if "temperature" in patch_data:
                    try:
                        t = float(patch_data.get("temperature"))
                        if t < 0 or t > 1:
                            patch_data.pop("temperature", None)
                        else:
                            patch_data["temperature"] = round(t * 10) / 10.0
                    except Exception:
                        patch_data.pop("temperature", None)
                await _set_room_meta(room.id, patch_data)
                meta_state.update(patch_data)
        except Exception:
            pass

        # 트리거 감지
        want_choices = False
        want_next_event = False
        if user_text.startswith("/선택지") or trigger == "choices":
            want_choices = True
            user_text = user_text.replace("/선택지", "").strip()
        if trigger == "next_event":
            want_next_event = True

        # 선택지 대기 중 next_event 서버 가드: 최신 AI 메시지 복귀(멱등) + 경고
        if want_next_event and bool(meta_state.get("pending_choices_active")):
            try:
                msgs = await chat_service.get_messages_by_room_id(db, room.id, limit=5)
                last_ai = None
                for m in reversed(msgs or []):
                    if getattr(m, "sender_type", "") in {"assistant", "character"}:
                        last_ai = m
                        break
                if last_ai is None and msgs:
                    last_ai = msgs[-1]
                from app.schemas.chat import ChatMessageResponse as CMR, SendMessageResponse as SMR
                if last_ai:
                    return SMR(user_message=None, ai_message=CMR.model_validate(last_ai), meta={"warning": "선택지가 표시 중입니다. 선택 처리 후 진행하세요.", "turn_count": int(meta_state.get("turn_count") or 0), "max_turns": int(meta_state.get("max_turns") or 500), "completed": bool(meta_state.get("completed") or False)})
            except Exception:
                pass

        # 진행도/턴 카운트
        max_turns = int(meta_state.get("max_turns") or 500)
        turn_count = int(meta_state.get("turn_count") or 0)
        completed = bool(meta_state.get("completed") or False)
        # next_event는 입력 없이도 턴 카운트 증가
        if want_next_event:
            turn_count += 1
        elif not want_choices and (user_text or choice_id):
            turn_count += 1
        just_completed = False
        if not completed and turn_count >= max_turns:
            completed = True
            just_completed = True
        meta_state["turn_count"] = turn_count
        meta_state["max_turns"] = max_turns
        meta_state["completed"] = completed
        await _set_room_meta(room.id, {
            "turn_count": turn_count,
            "max_turns": max_turns,
            "completed": completed,
        })

        # 레이트리밋/쿨다운 체크(간단 버전)
        now = int(time.time())
        last_choice_ts = meta_state.get("last_choice_ts", 0)
        cooldown_met = now - last_choice_ts >= 5  # 최소 8초 간격

        # 간단 스포일러/완결 가드 + 세계관/반복 방지 규칙 + 경량 컨텍스트 주입
        guarded_text = user_text
        # ✅ 서비스 정책: 원작챗은 plain-only
        # - Redis에 과거 mode(canon/parallel)가 남아있거나 기본값이 섞이면 UX가 깨진다.
        # - 서버에서 강제로 plain으로 정규화하고 Redis에도 복구한다.
        try:
            mode = str(meta_state.get("mode") or "plain").strip().lower()
        except Exception:
            mode = "plain"
        if mode != "plain":
            mode = "plain"
            try:
                meta_state["mode"] = "plain"
                await _set_room_meta(room.id, {"mode": "plain"})
            except Exception:
                pass
        if mode != "plain" and isinstance(player_max, int) and player_max >= 1:
            hint = f"[스포일러 금지 규칙] {player_max}화 이후의 사건/정보는 언급/암시 금지. 범위 내에서만 대답."
            if guarded_text:
                guarded_text = f"{hint}\n{guarded_text}"
            else:
                guarded_text = hint
        # 500턴 완결 진행 가이드(역산 전개) - plain 모드에서는 제외
        progress_hint = ""
        if mode != "plain":
            progress_hint = f"[진행] {turn_count}/{max_turns}턴. 남은 턴 내에 기승전결을 완성하도록 다음 사건을 전개하라. 반복 금지, 캐릭터/세계관 일관성 유지."
            if completed:
                progress_hint = "[완결 이후 자유 모드] 이전 사건을 재탕하지 말고, 소소한 일상/번외 에피소드로 반복 패턴을 변주하라."
        # 작가 페르소나 + 막(Act) 진행 가이드 (plain 모드에서는 제외)
        author_block = ""
        if mode != "plain":
            ratio = 0.0
            try:
                ratio = (turn_count / max_turns) if max_turns else 0.0
            except Exception:
                ratio = 0.0
            if ratio <= 0.2:
                stage_name = "도입"
                stage_guide = "주인공의 욕구/결핍 제시, 세계관 톤 확립, 시발 사건 제시, 후반을 위한 복선 씨앗 심기."
            elif ratio <= 0.8:
                stage_name = "대립/심화"
                stage_guide = "불가역 사건으로 갈등 증폭, 선택에는 대가가 따른다. 서브플롯을 주제와 연결하며 긴장/완급 조절."
            else:
                stage_name = "절정/해결"
                stage_guide = "클라이맥스에서 핵심 갈등을 정면 돌파, 주제 명료화, 감정적 수확과 여운 제공. 느슨한 매듭 정리."
            author_block = (
                "[작가 페르소나] 당신은 20년차 베스트셀러 장르/웹소설 작가(히트작 10권). 리듬/복선/서스펜스/클리프행어 운용에 탁월.\n"
                "각 턴은 '한 장면·한 사건·한 감정' 원칙. 중복/공회전 금지. show-don't-tell. 감각/행동/대사가 중심.\n"
                f"[현재 막] {stage_name} — {stage_guide}"
            )
        rule_lines = [
            "[일관성 규칙] 세계관/인물/설정의 내적 일관성을 유지하라. 원작과 모순되는 사실/타작품 요소 도입 금지.",
            "[반복 금지] 이전 대사/서술을 재탕하거나 공회전하는 전개 금지. 매 턴 새로운 상황/감정/행동/갈등을 진행.",
        ]
        # ✅ [P0] 사용자 대사/행동 '대신 생성' 방지(원작챗 전 모드 공통)
        #
        # 문제:
        # - 모델이 '상대(사용자/페르소나)의 대사/행동'까지 서술/창작해버리면
        #   유저가 "내가 한 말을 네가 정해버렸다"라고 강한 거부감을 느낀다(치명 UX).
        #
        # 정책:
        # - 사용자의 말/행동/내적(생각/감정)은 "사용자가 입력한 내용"을 넘어서 확정/창작하지 않는다.
        # - 필요하면 질문으로 확인하거나, 선택지(제안) 형태로 제시한다.
        # - 사용자를 3인칭 서술(예: 'OO이 말했다/했다')로 쓰지 않는다.
        rule_lines.append("[대화 원칙] ⛔ 사용자의 대사/행동/생각을 대신 쓰거나 확정하지 마세요. 사용자가 입력한 것만 사실로 취급하세요.")
        rule_lines.append("[대화 원칙] ⛔ 사용자를 3인칭으로 서술하지 마세요. (예: '상대가 말했다/OO이 했다' 금지)")
        rule_lines.append("[대화 원칙] ✅ 상대의 행동이 필요하면 질문하거나 선택지를 제안하세요. 당신은 캐릭터의 말/행동만 작성하세요.")
        if mode == "plain":
            # ✅ [P0] plain 모드 규칙 완화(정체성 회복)
            # - 기존 문구는 모델이 "원작 사건/줄거리 언급 자체"를 회피(=모른다/말 못한다)로 오해할 수 있다.
            # - 목표: "전개/창작 금지"는 유지하되, 작품/줄거리/원작 사실(스포일러 범위 내)은 답할 수 있게 명확화.
            rule_lines.append("[일대일 대화 모드] 이 모드는 '원작 캐릭터와의 1:1 대화'입니다. 사용자와 직접 대화하세요.")
            rule_lines.append("[일대일 대화 모드] ✅ 허용: 작품명/소개(줄거리), 세계관, 인물관계, 지금까지의 원작 사건(스포일러 범위 내)을 자연스럽게 회상/설명/요약하는 것은 허용됩니다.")
            rule_lines.append("[일대일 대화 모드] ⛔ 금지: 새로운 사건을 '전개/창작'하거나, 원작에 없는 설정을 단정하거나, 스포일러(범위 밖)를 말하는 것.")
            rule_lines.append("[일대일 대화 모드] 작품/줄거리/회차/자기 정체성 질문을 받으면 회피하지 말고, 원작 설정을 바탕으로 간결하게 답하세요.")
            rule_lines.append("[일대일 대화 모드] 사용자와 자연스럽게 대화하고, 질문하고, 교감하세요.")
            # ✅ [P0] 개인사/가족사 오염 차단(UX 핵심)
            # - 특정 캐릭터가 주인공의 개인사(가족/과거)를 자기 1인칭으로 답습하면 즉시 '가짜 캐릭터'로 느껴진다.
            # - 해결: 타 인물 개인사는 '그/그녀/OO'로 구분해 말하고, 내 개인사로 단정하지 못하게 강제한다.
            rule_lines.append("[정체성/개인사] 타 인물(주인공 포함)의 개인사/가족사/과거를 '내 이야기'로 1인칭 답습 금지. 반드시 화자/소유자를 구분하세요.")
            rule_lines.append("[정체성/개인사] 다른 인물 사건을 언급할 때는 '그/그녀/OO(이/가)'로 서술하고, 본인이 직접 겪은 것처럼 단정하지 마세요.")
            rule_lines.append("[정체성/개인사] 만약 방금 혼동했다면 즉시 1문장으로 정정 후 이어가세요. (예: \"방금 말은 OO의 이야기였어. 나는 …\")")
        elif mode == "parallel":
            rule_lines.append("[평행세계] 원작과 다른 전개 허용. 다만 세계관/인물 심리의 개연성을 유지하고 스포일러 금지.")
        else:
            rule_lines.append("[정사] 원작 설정을 존중하되 창의적으로 변주. 스포일러 금지.")
        # 관전가(서술자) 모드 규칙(평행세계에서만 의미)
        if bool(meta_state.get("narrator_mode") or False):
            rule_lines.append("[관전가] 사용자의 입력은 서술/묘사/해설이며 직접 대사를 생성하지 않는다. 인물의 대사/행동은 AI가 주도한다.")
            rule_lines.append("[관전가] 사용자 서술을 장면 맥락에 자연스럽게 접합하고, 필요한 대사/행동을 AI가 창의적으로 이어간다.")
        # 컨텍스트 활용 규칙 추가 (메타 발언 방지)
        if mode == "plain":
            rule_lines.append("[컨텍스트 활용] 제공된 배경 정보를 자연스럽게 활용하되, '컨텍스트에 따르면', '정보에 따르면' 같은 메타 발언은 절대 금지. 마치 직접 경험한 것처럼 자연스럽게 대화하세요.")
            # ✅ 출력 완결성(말풍선 끊김 방지)
            rule_lines.append("[출력 완결성] 응답은 문장 중간에서 끊지 말고, 반드시 마침표/물음표/느낌표/… 등 문장부호로 자연스럽게 마무리하라. 마지막 문장이 미완이면 1문장 더 보완해 완결하라.")
        rules_block = "\n".join(rule_lines)
        # ctx = (meta_state.get("light_context") or "").strip()
        # 캐릭터 중심 컨텍스트 생성 (대화 중에도 적용)
        ctx = None
        if sid and room.character_id:
            try:
                ctx = await _build_light_context(db, sid, player_max, character_id=room.character_id)
            except Exception:
                pass

        # ✅ 관계/역할 카드 프리워밍(백그라운드)
        # - 매 턴 LLM 호출로 지연을 만들지 않기 위해, 캐시가 없을 때만 비동기 생성한다.
        # - 이미 _build_light_context에는 (캐시된 카드 or 폴백 카드)가 포함되므로, 현재 턴에는 즉시 반영된다.
        try:
            if sid and room.character_id:
                _a = None
                try:
                    # player_max(=range_to/anchor) 우선, 없으면 meta.anchor/start.chapter 폴백
                    if isinstance(player_max, int) and player_max >= 1:
                        _a = int(player_max)
                    elif isinstance(meta_state, dict) and isinstance(meta_state.get("anchor"), int) and meta_state.get("anchor") >= 1:
                        _a = int(meta_state.get("anchor"))
                    else:
                        st = meta_state.get("start") if isinstance(meta_state, dict) else None
                        if isinstance(st, dict) and st.get("chapter") is not None:
                            _a = int(st.get("chapter"))
                except Exception:
                    _a = None
                _a = int(_a or 1)
                if _a < 1:
                    _a = 1
                from app.core.database import redis_client as _r
                key = f"ctx:warm:{sid}:relcard:{str(room.character_id)}:a{_a}"
                inflight = key + ":inflight"
                cached = await _r.get(key)
                if not cached:
                    try:
                        infl = await _r.get(inflight)
                        if not infl:
                            await _r.setex(inflight, 60, "1")
                            import asyncio

                            async def _warm_relcard(sid2, cid2, a2):
                                async with AsyncSessionLocal() as _db:
                                    try:
                                        await _build_relationship_card(_db, sid2, cid2, int(a2), generate_if_missing=True)
                                    except Exception:
                                        pass

                            asyncio.create_task(_warm_relcard(sid, room.character_id, _a))
                    except Exception:
                        pass
        except Exception:
            pass

        # 실패하거나 sid가 없으면 기존 방식 사용
        if not ctx:
            ctx = (meta_state.get("light_context") or "").strip()
        else:
            ctx = ctx.strip()
        ctx_block = f"[컨텍스트]\n{ctx}" if ctx else ""
        # 원작 문체 스타일 프롬프트 주입(있다면)
        style_prompt = None
        try:
            from app.core.database import redis_client
            # sid는 위에서 캐릭터의 원작 스토리 id로 설정됨
            _sid = locals().get('sid', None)
            if _sid:
                raw_sp = await redis_client.get(f"ctx:warm:{_sid}:style_prompt")
                if raw_sp:
                    try:
                        style_prompt = raw_sp.decode("utf-8") if isinstance(raw_sp, (bytes, bytearray)) else str(raw_sp)
                    except Exception:
                        style_prompt = str(raw_sp)
        except Exception:
            style_prompt = None
        style_block = f"[문체 지침]\n{style_prompt}" if style_prompt else ""
        # 역진가중 리캡/장면 앵커 주입(있다면)
        recap_block = ""
        try:
            if locals().get('sid', None):
                raw_rec = await redis_client.get(f"ctx:warm:{locals().get('sid')}:recap")
                if raw_rec:
                    try:
                        recap_text = raw_rec.decode("utf-8") if isinstance(raw_rec, (bytes, bytearray)) else str(raw_rec)
                    except Exception:
                        recap_text = str(raw_rec)
                    recap_block = f"[리캡(역진가중)]\n{recap_text}"
                raw_scene = await redis_client.get(f"ctx:warm:{locals().get('sid')}:scene_anchor")
                if raw_scene:
                    try:
                        scene_text = raw_scene.decode("utf-8") if isinstance(raw_scene, (bytes, bytearray)) else str(raw_scene)
                    except Exception:
                        scene_text = str(raw_scene)
                    recap_block = (recap_block + "\n\n[장면 앵커]\n" + scene_text) if recap_block else ("[장면 앵커]\n" + scene_text)
        except Exception:
            recap_block = ""
        parts = []

        # ✅ 캐릭터 정보 추가 (가장 먼저)
        try:
            char_row = await db.execute(
                select(Character.name, Character.personality, Character.speech_style, Character.description, Character.world_setting, Character.background_story)
                .where(Character.id == room.character_id)
            )
            char_data = char_row.first()
            if char_data:
                char_name = (char_data[0] or "").strip()
                char_personality = (char_data[1] or "").strip()
                char_speech = (char_data[2] or "").strip()
                char_desc = (char_data[3] or "").strip()
                char_world_setting = (char_data[4] or "").strip()
                char_background_story = (char_data[5] or "").strip()

                char_block = [f"당신은 '{char_name}'입니다."]
                if char_personality:
                    char_block.append(f"성격: {char_personality}")
                if char_speech:
                    char_block.append(f"말투: {char_speech}")
                if char_desc:
                    char_block.append(f"설명: {char_desc}")
                if char_world_setting:
                    char_block.append(f"세계관/배경: {char_world_setting}")
                if char_background_story:
                    char_block.append(f"배경 스토리: {char_background_story}") 
                
                parts.insert(0, "\n".join(char_block))  # 가장 앞에 배치
        except Exception as e:
            logger.warning(f"캐릭터 정보 로드 실패: {e}")

        # ✅ [P0] 작품/정체성 블록: 매 턴 고정 주입(plain 모드 정체성 붕괴 방지)
        #
        # 의도/동작:
        # - 유저가 "무슨 작품/줄거리/몇화 맥락"을 물을 때, 모델이 회피하지 않도록 근거를 항상 제공한다.
        # - plain 모드에서도 "전개/창작"만 금지하고, 원작 사실(스포일러 범위 내)은 답할 수 있게 한다.
        try:
            work_title = ""
            work_summary = ""
            if 'sid' in locals() and sid:
                wrow = await db.execute(select(Story.title, Story.summary).where(Story.id == sid))
                w = wrow.first()
                if w:
                    work_title = (w[0] or "").strip()
                    work_summary = (w[1] or "").strip()

            # 기준 회차(앵커): player_max 우선, 없으면 meta.anchor → meta.start.chapter 폴백
            #
            # ✅ 치명 UX 방지:
            # - 유저가 "몇화야?"를 물으면 반드시 숫자 회차를 답해야 한다.
            # - meta에는 anchor가 저장되는데, 기존 로직이 anchor를 보지 않아 None으로 떨어질 수 있었다.
            anchor_no = None
            try:
                if isinstance(player_max, int) and player_max >= 1:
                    anchor_no = int(player_max)
                else:
                    if isinstance(meta_state, dict) and meta_state.get("anchor") is not None:
                        anchor_no = int(meta_state.get("anchor"))
                    else:
                        st = meta_state.get("start") if isinstance(meta_state, dict) else None
                        if isinstance(st, dict) and st.get("chapter") is not None:
                            anchor_no = int(st.get("chapter"))
            except Exception:
                anchor_no = None
            # 마지막 안전망: 스토리가 있는 원작챗이면 최소 1화로라도 고정(회피/모른다 방지)
            if ('sid' in locals() and sid) and not anchor_no:
                anchor_no = 1

            # 스포일러 기준(범위): range_to가 있으면 우선, 없으면 anchor_no를 기준으로 사용
            spoiler_from = None
            spoiler_to = None
            try:
                if isinstance(meta_state, dict):
                    rf = meta_state.get("range_from")
                    rt = meta_state.get("range_to")
                    if isinstance(rf, int) and rf >= 1:
                        spoiler_from = int(rf)
                    if isinstance(rt, int) and rt >= 1:
                        spoiler_to = int(rt)
            except Exception:
                spoiler_from = None
                spoiler_to = None

            # 현재 회차 요약/발췌(짧게): "내가 몇화에서 뭘 했지" 질문 대응용
            anchor_summary = ""
            anchor_excerpt = ""
            try:
                if ('sid' in locals() and sid) and anchor_no:
                    # 1) 누적 요약(있으면 우선)
                    sres = await db.execute(
                        select(StoryEpisodeSummary.cumulative_summary)
                        .where(StoryEpisodeSummary.story_id == sid, StoryEpisodeSummary.no == anchor_no)
                    )
                    anchor_summary = (sres.first() or [None])[0] or ""
                    anchor_summary = (anchor_summary or "").strip()
                    # 2) 없으면 해당 회차 본문 일부(짧게)
                    if not anchor_summary:
                        cres = await db.execute(
                            select(StoryChapter.title, StoryChapter.content)
                            .where(StoryChapter.story_id == sid, StoryChapter.no == anchor_no)
                        )
                        c = cres.first()
                        if c:
                            _title = (c[0] or "").strip()
                            _content = (c[1] or "").strip()
                            if _content:
                                anchor_excerpt = (f"[{anchor_no}화] {_title}\n" if _title else f"[{anchor_no}화]\n") + _content[:800]
            except Exception:
                anchor_summary = ""
                anchor_excerpt = ""

            work_lines = ["[작품 정보]"]
            if work_title:
                work_lines.append(f"작품명: {work_title}")
            if work_summary:
                work_lines.append(f"소개: {work_summary[:420]}")
            if anchor_no:
                work_lines.append(f"현재 기준: {anchor_no}화")
            # ✅ 메타 질문 응답 고정(치명 UX 방지)
            #
            # - 유저가 작품명/몇화/줄거리를 물으면 "모른다"가 아니라 아래 값을 그대로 답해야 한다.
            # - '컨텍스트에 따르면' 같은 메타 발언은 금지이므로, 자연스럽게 회상/설명하듯 답한다.
            try:
                if work_title and anchor_no:
                    work_lines.append(f"질문 대응: 작품명 질문 → '{work_title}' / '지금 몇화' 질문 → '{anchor_no}화'")
            except Exception:
                pass
            # 스포일러 기준 표시(모드별 적용은 rules_block이 담당, 여기서는 사실로만 제공)
            if spoiler_from and spoiler_to:
                work_lines.append(f"스포일러 기준: {spoiler_from}~{spoiler_to}화 범위 내에서만 언급")
            elif spoiler_to:
                work_lines.append(f"스포일러 기준: {spoiler_to}화까지 범위 내에서만 언급")
            elif anchor_no:
                work_lines.append(f"스포일러 기준: {anchor_no}화까지 범위 내에서만 언급")

            # 정체성 고정(plain 포함)
            _cn = None
            try:
                _cn = (char_name or "").strip()
            except Exception:
                _cn = ""
            if _cn:
                if work_title:
                    work_lines.append(f"[정체성] 당신은 '{work_title}'의 등장인물 '{_cn}'이며, 사용자와 지금 1:1로 대화 중입니다.")
                else:
                    work_lines.append(f"[정체성] 당신은 원작의 등장인물 '{_cn}'이며, 사용자와 지금 1:1로 대화 중입니다.")

            # 현재 회차 근거(짧게)
            if anchor_no and (anchor_summary or anchor_excerpt):
                work_lines.append("")
                work_lines.append(f"[현재 회차 요약(앵커 {anchor_no}화)]")
                if anchor_summary:
                    work_lines.append(anchor_summary[-900:])
                elif anchor_excerpt:
                    work_lines.append(anchor_excerpt[:900])

            work_block = "\n".join([ln for ln in work_lines if ln])
            if work_block:
                # 캐릭터 블록 다음에 배치(상단 고정)
                insert_idx = 1 if parts else 0
                parts.insert(insert_idx, work_block)
        except Exception as e:
            logger.warning(f"[origchat_turn] work/identity block build failed: {e}")

        # ✅ 로어북(기억노트): 원작챗에도 실제로 반영되도록 프롬프트에 주입 (최소 수정)
        # - UI에서 저장/활성화한 기억노트가 대화에 영향이 있어야 "작동"으로 느껴진다.
        # - 과도한 프롬프트 팽창을 막기 위해 최대 N개만 포함한다.
        try:
            active_memories = await get_active_memory_notes_by_character(db, current_user.id, room.character_id)
        except Exception:
            active_memories = []
        try:
            if isinstance(active_memories, list) and len(active_memories) > 0:
                lore_lines = [
                    "[로어북(기억노트)]",
                    "아래 내용은 사용자가 저장한 중요한 설정/기억입니다. 대화에서 잊지 말고 반드시 반영하세요.",
                ]
                MAX_LORE = 6
                for memory in active_memories[:MAX_LORE]:
                    title = (getattr(memory, "title", "") or "").strip()
                    content = (getattr(memory, "content", "") or "").strip()
                    if not (title or content):
                        continue
                    if title and content:
                        lore_lines.append(f"- {title}: {content}")
                    elif title:
                        lore_lines.append(f"- {title}")
                    else:
                        lore_lines.append(f"- {content}")
                if len(lore_lines) > 2:
                    # 캐릭터 블록 바로 다음(가능하면 상단)에 배치
                    insert_idx = 1 if parts else 0
                    parts.insert(insert_idx, "\n".join(lore_lines))
        except Exception:
            pass


        if progress_hint:
            parts.append(progress_hint)
        parts.append(rules_block)
        if author_block:
            parts.append(author_block)
        # if ctx_block:
        #     parts.append(ctx_block)
        if style_block:
            parts.append(style_block)
        if recap_block:
            parts.append(recap_block)
        # 허용 스피커 힌트
        try:
            if 'sid' in locals() and sid:
                from app.services.origchat_service import get_story_character_names
                allowed = await get_story_character_names(db, sid)
                if allowed:
                    parts.append("[허용 스피커]\n" + ", ".join(allowed[:8]))
        except Exception:
            pass
        # 시점/문체 힌트: persona(내 페르소나) or possess(선택 캐릭터 빙의)
        try:
            pov = (meta_state.get("pov") or "possess").lower()
            # 🎯 활성 페르소나 로드 (pov와 무관하게)
            logger.info(f"[origchat_turn] pov: {pov}, 페르소나 로드 시도")
            from app.services.user_persona_service import get_active_persona_by_user
            persona = await get_active_persona_by_user(db, current_user.id)
            logger.info(f"[origchat_turn] 페르소나 조회 결과: {persona}")
            # ✅ 적용 범위 확인: 'all' 또는 'origchat'일 때만 적용
            scope = getattr(persona, 'apply_scope', 'all') or 'all' if persona else 'all'

            if persona and scope in ('all', 'origchat'):
                pn = (getattr(persona, 'name', '') or '').strip()
                pd = (getattr(persona, 'description', '') or '').strip()
                logger.info(f"[origchat_turn] 페르소나 로드 성공: {pn}, 설명: {pd[:50] if pd else '없음'}")
                
                fb = ["[시점·문체]"]
                if pn:
                    fb.append(f"고정 시점: 사용자 페르소나 '{pn}'의 1인칭 또는 근접 3인칭.")
                if pd:
                    fb.append(f"성격/정서 결: {pd}")
                fb.append("대사·지문은 페르소나 어휘/톤을 유지.")
                parts.append("\n".join(fb))
                
                partner_block = [
                    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
                    f"당신은 지금 '{pn}'과(와) 대화하고 있습니다.",
                    f"'{pn}'은(는) 당신이 이미 알고 있는 사람입니다.",
                    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
                ]
                if pd:
                    partner_block.append(f"'{pn}'의 정보: {pd}")
                partner_block.append("")
                partner_block.append(f"⚠️ 절대 규칙:")
                partner_block.append(f"- 상대를 '{pn}'(이)라고 부르세요")
                partner_block.append(f"- 이름을 모르는 척 하지 마세요")
                partner_block.append(f"- 다른 호칭 금지")
                partner_block.append(f"- 자연스럽게 '{pn}'의 이름을 언급하세요")
                # ✅ 사용자(페르소나) 대사/행동 대신 생성 방지(가장 강한 위치=상단)
                partner_block.append(f"- ⛔ '{pn}'의 대사/행동/생각을 당신이 대신 작성하거나 확정하지 마세요.")
                partner_block.append(f"- ⛔ '\"...\" {pn}이 말했다/했다' 같은 3인칭 서술 금지. '{pn}, ...'처럼 직접 호칭은 허용.")
                partner_block.append(f"- ✅ 필요한 경우 질문으로 확인하거나 선택지를 제안하세요.")
                parts.insert(0, "\n".join(partner_block))
                if ctx_block:
                    # ✅ [P0] 작품/정체성 블록을 상단에서 밀어내지 않도록 ctx 삽입 위치를 조정한다.
                    # - 현재 parts 구성(대개): [캐릭터, 작품정보, ...]
                    # - 페르소나 블록을 0에 넣은 뒤에는: [페르소나, 캐릭터, 작품정보, ...]
                    insert_idx = 2
                    try:
                        if len(parts) >= 3 and isinstance(parts[2], str) and parts[2].startswith("[작품 정보]"):
                            insert_idx = 3
                    except Exception:
                        insert_idx = 2
                    parts.insert(insert_idx, ctx_block)
            else:
                logger.warning(f"[origchat_turn] 페르소나를 찾을 수 없음: user_id={current_user.id}")
                if ctx_block:
                    # ✅ [P0] 작품/정체성 블록(있다면)을 보존: ctx는 작품정보 뒤로 배치
                    insert_idx = 1
                    try:
                        if len(parts) >= 2 and isinstance(parts[1], str) and parts[1].startswith("[작품 정보]"):
                            insert_idx = 2
                    except Exception:
                        insert_idx = 1
                    parts.insert(insert_idx, ctx_block)
            # focus_character 처리(기존 else 내용) — 페르소나가 없을 때만 실행
            if not persona:
                fcid = meta_state.get("focus_character_id")
                if fcid:
                    row_fc = await db.execute(
                        select(Character.name, Character.speech_style, Character.personality)
                        .where(Character.id == fcid)
                    )
                    fc = row_fc.first()
                    if fc:
                        fc_name = (fc[0] or '').strip()
                        fc_speech = (fc[1] or '').strip()
                        fc_persona = (fc[2] or '').strip()
                        fb_lines = ["[시점·문체]"]
                        if fc_name:
                            fb_lines.append(f"고정 시점: '{fc_name}'의 내적 시점(1인칭/근접 3인칭 중 자연스러운 방식).")
                        if fc_persona:
                            fb_lines.append(f"성격/정서 결: {fc_persona}")
                        if fc_speech:
                            fb_lines.append(f"대사 말투: {fc_speech}")
                        fb_lines.append("묘사는 시점 인물의 지각/어휘 결을 따르고, 과잉 해설 금지.")
                        parts.append("\n".join(fb_lines))
                    if ctx_block:
                        # ✅ [P0] 작품/정체성 블록(있다면)을 보존: ctx는 작품정보 뒤로 배치
                        insert_idx = 1
                        try:
                            if len(parts) >= 2 and isinstance(parts[1], str) and parts[1].startswith("[작품 정보]"):
                                insert_idx = 2
                        except Exception:
                            insert_idx = 1
                        parts.insert(insert_idx, ctx_block)  # 캐릭터/작품정보 뒤
        except Exception:
            pass
        # parallel seed가 있으면 주입
        seed_label = meta_state.get("seed_label")
        if mode == "parallel" and seed_label:
            parts.append(f"[평행세계 씨앗] {seed_label}")
        # 상황 텍스트
        if situation_text:
            parts.append(f"[상황]\n{situation_text}")
        # 자동 진행 지시
        if 'want_next_event' in locals() and want_next_event:
            parts.append("[자동 진행] 사용자의 입력 없이 장면을 1~2개 전개하라. 지문과 대사가 자연스럽게 섞이도록. 새 고유명 인물 도입 금지.")
        if guarded_text:
            parts.append(guarded_text)
        guarded_text = "\n".join([p for p in parts if p])
        
        # 디버깅: 최종 프롬프트 로그
        logger.info(f"[origchat_turn] 최종 프롬프트 (앞 1000자):\n{guarded_text[:1000]}")
        
        # 단계 정보를 메타로 전달(선택적)
        meta_stage = locals().get("stage_name", None)

        # 스테이지 메트릭: 생성/보정 단계 표시용
        # t0 = time.time()  # 생성 시작
        # req = SendMessageRequest(character_id=room.character_id, content=guarded_text)
        # resp = await send_message(req, current_user, db)
        # tti_ms = int((time.time() - t0) * 1000)
        t0 = time.time()

        # ✅ want_choices일 때는 AI 생성 스킵
        if want_choices:
            # 선택지만 요청한 경우: 마지막 AI 메시지를 그대로 반환
            try:
                msgs = await chat_service.get_messages_by_room_id(db, room.id, limit=1)
                last_ai = msgs[0] if msgs else None
                if not last_ai:
                    raise HTTPException(status_code=400, detail="선택지를 생성할 이전 메시지가 없습니다.")
                
                # 기존 메시지로 resp 생성
                from app.schemas.chat import ChatMessageResponse, SendMessageResponse
                resp = SendMessageResponse(
                    user_message=None,
                    ai_message=ChatMessageResponse.model_validate(last_ai)
                )
                tti_ms = 0  # AI 생성 안 함
            except Exception as e:
                raise HTTPException(status_code=500, detail=f"선택지 요청 실패: {e}")
        else:
            # ✅ 일반 턴: AI 응답 생성
            # 1. 히스토리 조회
            # ✅ 방어: get_messages_by_room_id는 created_at ASC + offset/limit 형태라,
            # skip을 주지 않으면 "최신 20개"가 아니라 "처음 20개"가 반환될 수 있다.
            # 원작챗은 최신 맥락이 중요하므로, 전체 카운트 기반으로 마지막 80개 구간을 조회한다.
            try:
                from app.models.chat import ChatMessage as _ChatMessage
                total_count = await db.scalar(
                    select(func.count(_ChatMessage.id)).where(_ChatMessage.chat_room_id == room.id)
                ) or 0
                skip_n = max(0, int(total_count) - 80)
            except Exception:
                skip_n = 0
            history = await chat_service.get_messages_by_room_id(db, room.id, skip=skip_n, limit=80)
            history_for_ai = []
            
            
            # ✅ 현재 턴의 사용자 입력은 user_message로 별도 전달되므로,
            # 히스토리 블록에서는 중복 포함을 피한다(모델 혼란 방지).
            trimmed = history
            try:
                if user_text and trimmed:
                    last = trimmed[-1]
                    if getattr(last, "sender_type", None) == "user" and (getattr(last, "content", "") or "").strip() == user_text:
                        trimmed = trimmed[:-1]
            except Exception:
                trimmed = history

            for msg in (trimmed[-80:] if isinstance(trimmed, list) else history[-80:]):
                if msg.sender_type == "user":
                    history_for_ai.append({"role": "user", "parts": [msg.content]})
                else:
                    history_for_ai.append({"role": "model", "parts": [msg.content]})

            # 2. 캐릭터 프롬프트 (guarded_text는 이미 모든 규칙/컨텍스트 포함)
            character_prompt = guarded_text

            # 3. 실제 사용자 입력 추출
            actual_user_input = user_text if user_text else (situation_text if situation_text else "계속 진행")

            # 4. AI 응답 생성
            from app.services import ai_service
            try:
                # temperature: meta 우선, 없으면 기본값(0.7)
                temperature = 0.7
                try:
                    if isinstance(meta_state, dict) and meta_state.get("temperature") is not None:
                        t = float(meta_state.get("temperature"))
                        if 0 <= t <= 1:
                            temperature = round(t * 10) / 10.0
                except Exception:
                    temperature = 0.7
                ai_response_text = await ai_service.get_ai_chat_response(
                    character_prompt=character_prompt,
                    user_message=actual_user_input,
                    history=history_for_ai,
                    preferred_model="claude",
                    preferred_sub_model=current_user.preferred_sub_model,
                    response_length_pref=meta_state.get("response_length_pref") or getattr(current_user, 'response_length_pref', 'medium'),
                    temperature=temperature
                )

                # 5. AI 응답만 저장
                ai_message = await chat_service.save_message(
                    db, room.id, "assistant", ai_response_text
                )

                await db.commit()
            except Exception:
                await db.rollback()
                raise HTTPException(status_code=503, detail="AiUnavailable")
                
            from app.services import character_service
            await character_service.sync_character_chat_count(db, room.character_id)
            
            tti_ms = int((time.time() - t0) * 1000)

            # 6. resp 객체 생성 (기존 코드와 호환)
            from app.schemas.chat import ChatMessageResponse, SendMessageResponse
            resp = SendMessageResponse(
                user_message=ChatMessageResponse.model_validate(user_message) if user_message else None,
                ai_message=ChatMessageResponse.model_validate(ai_message)
            )

        # 일관성 강화: 응답을 경량 재작성(최소 수정) (postprocess_mode에 따라)
        if not want_choices:
            try:
                from app.services.origchat_service import enforce_character_consistency as _enforce, get_story_character_names, normalize_dialogue_speakers
                focus_name = None
                focus_persona = None
                focus_speech = None
                if meta_state.get("focus_character_id"):
                    row_fc = await db.execute(
                        select(Character.name, Character.personality, Character.speech_style)
                        .where(Character.id == meta_state.get("focus_character_id"))
                    )
                    fc2 = row_fc.first()
                    if fc2:
                        focus_name = (fc2[0] or '').strip()
                        focus_persona = (fc2[1] or '').strip()
                        focus_speech = (fc2[2] or '').strip()
                world_bible = None
                try:
                    from app.core.database import redis_client
                    _sid = locals().get('sid', None)
                    if _sid:
                        raw_wb = await redis_client.get(f"ctx:warm:{_sid}:world_bible")
                        if raw_wb:
                            world_bible = raw_wb.decode("utf-8") if isinstance(raw_wb, (bytes, bytearray)) else str(raw_wb)
                except Exception:
                    world_bible = None
                ai_text0 = getattr(resp.ai_message, 'content', '') or ''
                # postprocess_mode: always | first2 | off
                # ✅ meta 유실(Redis 재시작 등) 시에도 postprocess가 "갑자기 켜지는" 상황을 방지하기 위해 default는 off
                pp_mode = str(meta_state.get("postprocess_mode") or "off").lower()
                need_pp = (pp_mode == "always") or (pp_mode == "first2" and int(meta_state.get("turn_count") or 0) <= 2)
                refined = ai_text0
                if need_pp:
                    refined = await _enforce(
                        ai_text0,
                        focus_name=focus_name,
                        persona=focus_persona,
                        speech_style=focus_speech,
                        style_prompt=style_prompt,
                        world_bible=world_bible,
                    )
                # 스피커 정합 보정(다인 장면 최소 보정)
                refined2 = refined
                if need_pp:
                    try:
                        allowed_names = await get_story_character_names(db, sid) if 'sid' in locals() else []
                        refined2 = await normalize_dialogue_speakers(
                            refined,
                            allowed_names=allowed_names,
                            focus_name=focus_name,
                            npc_limit=int(meta_state.get("next_event_len") or 1),
                        )
                    except Exception:
                        refined2 = refined
                if refined2 and refined2 != ai_text0:
                    try:
                        resp.ai_message.content = refined2  # type: ignore[attr-defined]
                    except Exception:
                        pass
                    # ✅ SSOT 일치(치명 UX 방지):
                    # - DB에는 postprocess 전 ai_response_text가 저장되어 있고,
                    #   응답(resp)에는 postprocess 후 텍스트가 노출되면 재진입 시 "대사가 바뀐 것처럼" 보인다.
                    # - 따라서 postprocess로 바뀐 본문은 DB(ChatMessage.content)에도 반영한다.
                    try:
                        from app.models.chat import ChatMessage as _ChatMessage
                        if 'ai_message' in locals() and ai_message and getattr(ai_message, "id", None):
                            await db.execute(
                                update(_ChatMessage)
                                .where(_ChatMessage.id == ai_message.id)
                                .values(content=refined2)
                            )
                            await db.commit()
                    except Exception as e:
                        try:
                            await db.rollback()
                        except Exception:
                            pass
                        try:
                            logger.warning(f"[origchat_turn] postprocess DB update failed (continue): {e}")
                        except Exception:
                            pass
            except Exception:
                pass

        meta_resp: Dict[str, Any] = {"turn_count": turn_count, "max_turns": max_turns, "completed": completed}

        # ✅ 선택지 생성 - plain 모드에서는 선택지 생성 안 함
        mode = meta_state.get("mode", "plain")
        try:
            mode = str(mode or "").strip().lower() or "plain"
        except Exception:
            mode = "plain"
        if mode != "plain":
            mode = "plain"
            try:
                meta_state["mode"] = "plain"
                await _set_room_meta(room.id, {"mode": "plain"})
            except Exception:
                pass
        if mode != "plain":
            # ✅ 온디맨드 선택지: 쿨다운 무시
            if want_choices:
                from app.services.origchat_service import propose_choices_from_anchor as _pc
                choices = _pc(getattr(resp.ai_message, 'content', ''), None)
                meta_resp["choices"] = choices
                meta_state["last_choice_ts"] = now
                meta_state["pending_choices_active"] = True
                await _set_room_meta(room.id, {"last_choice_ts": now, "pending_choices_active": True})

            # ✅ 자동 선택지: 쿨다운 적용 (온디맨드와 충돌 안 함)
            elif cooldown_met:  # ✅ want_choices가 False일 때만 실행
                try:
                    from app.services.origchat_service import compute_branch_score_from_text, propose_choices_from_anchor as _pc
                    ai_text = getattr(resp.ai_message, 'content', '') or ''
                    score = compute_branch_score_from_text(ai_text)
                    if score >= 1.5:
                        meta_resp["choices"] = _pc(ai_text, None)
                        meta_state["last_choice_ts"] = now
                        meta_state["pending_choices_active"] = True
                        await _set_room_meta(room.id, {"last_choice_ts": now, "pending_choices_active": True})
                except Exception:
                    pass
        # # 분기 가치가 높을 때 자동 제안(과잉 방지: 쿨다운 준수, 온디맨드가 아닌 경우만)
        # if not want_choices and cooldown_met:
        #     try:
        #         from app.services.origchat_service import compute_branch_score_from_text, propose_choices_from_anchor as _pc
        #         ai_text = getattr(resp.ai_message, 'content', '') or ''
        #         score = compute_branch_score_from_text(ai_text)
        #         if score >= 2.0:
        #             meta_resp["choices"] = _pc(ai_text, None)
        #             meta_state["last_choice_ts"] = now
        #             meta_state["pending_choices_active"] = True
        #             await _set_room_meta(room.id, {"last_choice_ts": now, "pending_choices_active": True})
        #     except Exception:
        #         pass

        # 완결 직후 안내 내레이션
        if just_completed:
            meta_resp["final_narration"] = "이 평행세계 이야기는 여기서 막을 내립니다. 계속하고 싶다면 자유 모드로 이어집니다."

        # 메트릭 전송(베스트-에포트)
        try:
            from app.services.metrics_service import record_timing, increment_counter
            labels = {
                "story_id": str(sid) if 'sid' in locals() and sid else None,
                "room_id": str(room_id),
                "user_id": str(current_user.id),
                "character_id": str(room.character_id),
                "mode": mode,
                "trigger": (trigger or "user_text") if (trigger or user_text) else "other",
                "completed": str(bool(completed)),
            }
            await record_timing("origchat_tti_ms", tti_ms, labels=labels)
            if want_choices:
                await increment_counter("origchat_choices_requested", labels=labels)
            if 'want_next_event' in locals() and want_next_event:
                await increment_counter("origchat_next_event", labels=labels)
            if just_completed:
                await increment_counter("origchat_completed", labels=labels)
        except Exception:
            pass

        # after successful send, persist latest idempotency key (if provided)
        try:
            if idempotency_key:
                await _set_room_meta(room.id, {"last_idem_key": str(idempotency_key)})
        except Exception:
            pass

        # 선택/사용자 입력/자동 진행 성공 시 선택지 대기 해제
        try:
            if (choice_id) or (not want_choices and (user_text or want_next_event)):
                if meta_state.get("pending_choices_active"):
                    meta_state["pending_choices_active"] = False
                    await _set_room_meta(room.id, {"pending_choices_active": False})
        except Exception:
            pass

        from app.schemas.chat import SendMessageResponse as SMR
        return SMR(user_message=resp.user_message, ai_message=resp.ai_message, meta=meta_resp or None)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"origchat turn failed: {e}")

@router.delete("/rooms/{room_id}/messages")
async def clear_chat_messages(
    room_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """채팅방의 모든 메시지 삭제 (대화 초기화)"""
    # 채팅방 권한 확인
    room = await chat_service.get_chat_room_by_id(db, room_id)
    if not room:
        raise HTTPException(status_code=404, detail="채팅방을 찾을 수 없습니다.")
    
    if room.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="이 채팅방에 접근할 권한이 없습니다.")
    # ✅ 비공개 캐릭터/작품 접근 차단(요구사항: 기존 방도 포함)
    await _ensure_private_content_access(db, current_user, character=getattr(room, "character", None))
    
    # 메시지 삭제
    await chat_service.delete_all_messages_in_room(db, room_id)
    return {"message": "채팅 내용이 초기화되었습니다."}

@router.delete("/rooms/{room_id}")
async def delete_chat_room(
    room_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """채팅방 완전 삭제"""
    # 채팅방 권한 확인
    room = await chat_service.get_chat_room_by_id(db, room_id)
    if not room:
        raise HTTPException(status_code=404, detail="채팅방을 찾을 수 없습니다.")
    
    if room.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="이 채팅방에 접근할 권한이 없습니다.")
    # ✅ 비공개 캐릭터/작품 접근 차단(요구사항: 기존 방도 포함)
    await _ensure_private_content_access(db, current_user, character=getattr(room, "character", None))
    
    # 채팅방 삭제 (연관된 메시지도 함께 삭제됨)
    await chat_service.delete_chat_room(db, room_id)
    return {"message": "채팅방이 삭제되었습니다."}


# ----- 메시지 수정/재생성 -----
@router.patch("/messages/{message_id}", response_model=ChatMessageResponse)
async def update_message_content(
    message_id: uuid.UUID,
    payload: ChatMessageUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    msg = await chat_service.get_message_by_id(db, message_id)
    if not msg:
        raise HTTPException(status_code=404, detail="메시지를 찾을 수 없습니다.")
    room = await chat_service.get_chat_room_by_id(db, msg.chat_room_id)
    if not room or room.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="권한이 없습니다.")
    # ✅ 비공개 캐릭터/작품 접근 차단(요구사항: 기존 방도 포함)
    await _ensure_private_content_access(db, current_user, character=getattr(room, "character", None))
    if msg.sender_type != 'assistant' and msg.sender_type != 'character':
        raise HTTPException(status_code=400, detail="AI 메시지만 수정할 수 있습니다.")
    updated = await chat_service.update_message_content(db, message_id, payload.content)
    return ChatMessageResponse.model_validate(updated)


@router.post("/messages/{message_id}/regenerate", response_model=SendMessageResponse)
async def regenerate_message(
    message_id: uuid.UUID,
    payload: RegenerateRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    # 대상 메시지와 룸 확인
    msg = await chat_service.get_message_by_id(db, message_id)
    if not msg:
        raise HTTPException(status_code=404, detail="메시지를 찾을 수 없습니다.")
    room = await chat_service.get_chat_room_by_id(db, msg.chat_room_id)
    if not room or room.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="권한이 없습니다.")
    # ✅ 비공개 캐릭터/작품 접근 차단(요구사항: 기존 방도 포함)
    await _ensure_private_content_access(db, current_user, character=getattr(room, "character", None))

    # ✅ 재생성은 "사용자 메시지"로 저장되면 안 된다.
    # - 요구사항: 재생성 지시문(예: "말투를 더 부드럽게")은 채팅 로그에 사용자 발화로 남지 않아야 한다.
    # - 따라서 DB에는 새 메시지를 추가하지 않고, 대상 AI 메시지(content)만 업데이트한다.
    if msg.sender_type not in ("assistant", "character"):
        raise HTTPException(status_code=400, detail="AI 메시지만 재생성할 수 있습니다.")

    instruction = ""
    try:
        instruction = str(payload.instruction or "").strip()
    except Exception:
        instruction = ""
    if not instruction:
        instruction = "말투를 더 부드럽게"

    # 직전 맥락(베스트-에포트): 재작성 품질/연결감을 위해 최근 몇 개 메시지를 함께 전달한다.
    before_ctx = ""
    try:
        from app.models.chat import ChatMessage
        prev_rows = await db.execute(
            select(ChatMessage.sender_type, ChatMessage.content)
            .where(ChatMessage.chat_room_id == room.id)
            .where(ChatMessage.created_at < msg.created_at)
            .order_by(ChatMessage.created_at.desc())
            .limit(8)
        )
        prev = prev_rows.all() or []
        lines: List[str] = []
        for sender_type, content in reversed(prev):
            st = str(sender_type or "").strip().lower()
            label = "사용자" if st == "user" else "캐릭터"
            txt = str(content or "").strip()
            if not txt:
                continue
            lines.append(f"{label}: {txt}")
        before_ctx = "\n".join(lines).strip()
    except Exception as e:
        try:
            logger.warning(f"[regenerate_message] before_context fetch failed: {e}")
        except Exception:
            pass
        before_ctx = ""

    # 재작성(베스트-에포트): 실패 시 원문 유지(사용자에게는 에러로 알림)
    try:
        new_text = await ai_service.regenerate_partial_text(
            selected_text=str(getattr(msg, "content", "") or ""),
            user_prompt=instruction,
            before_context=before_ctx,
            after_context="",
        )
        new_text = str(new_text or "").strip()
        if not new_text:
            raise ValueError("재생성 결과가 비어 있습니다")
    except Exception as e:
        try:
            logger.exception(f"[regenerate_message] regenerate_partial_text failed: {e}")
        except Exception:
            pass
        raise HTTPException(status_code=500, detail=f"재생성에 실패했습니다. ({_safe_exc(e)})")

    # DB 업데이트(편집 이력 포함)
    try:
        updated = await chat_service.update_message_content(db, message_id, new_text)
    except Exception as e:
        try:
            logger.exception(f"[regenerate_message] update_message_content failed: {e}")
        except Exception:
            pass
        raise HTTPException(status_code=500, detail=f"재생성 결과 저장에 실패했습니다. ({_safe_exc(e)})")

    return SendMessageResponse(
        user_message=None,
        ai_message=ChatMessageResponse.model_validate(updated),
    )


@router.post("/messages/{message_id}/feedback", response_model=ChatMessageResponse)
async def message_feedback(
    message_id: uuid.UUID,
    payload: MessageFeedback,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    msg = await chat_service.get_message_by_id(db, message_id)
    if not msg:
        raise HTTPException(status_code=404, detail="메시지를 찾을 수 없습니다.")
    room = await chat_service.get_chat_room_by_id(db, msg.chat_room_id)
    if not room or room.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="권한이 없습니다.")
    # ✅ 비공개 캐릭터/작품 접근 차단(요구사항: 기존 방도 포함)
    await _ensure_private_content_access(db, current_user, character=getattr(room, "character", None))
    updated = await chat_service.apply_feedback(db, message_id, upvote=(payload.action=='upvote'))
    return ChatMessageResponse.model_validate(updated)

 