"""
온보딩 '30초만에 캐릭터 만나기'용 AI 자동완성 서비스

핵심 원칙(안전/방어):
- LLM 출력이 흔들려도(형식/길이/누락) 서비스가 터지지 않게 기본값/클립/폴백을 적용한다.
- 생성(DB 저장)은 SSOT인 `/characters/advanced` API에서만 수행한다.
- 이 서비스는 "고급 생성 요청(payload)"을 만들 수 있을 정도의 초안(draft)만 생성한다.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple
import json

try:
    from app.core.logger import logger
except Exception:
    import logging as _logging
    logger = _logging.getLogger(__name__)

from app.schemas.quick_character import QuickCharacterGenerateRequest
from app.schemas.character import (
    CharacterCreateRequest,
    CharacterBasicInfo,
    CharacterExampleDialogues,
    ExampleDialogue,
    CharacterMediaSettings,
    ImageDescription,
    CharacterPublishSettings,
    IntroductionScene,
)
from app.services.ai_service import get_ai_completion, AIModel, analyze_image_tags_and_context


def _safe_text(v: Any) -> str:
    try:
        return str(v or "").strip()
    except Exception:
        return ""


def _clip(v: Any, max_len: int) -> str:
    s = _safe_text(v)
    if not s:
        return ""
    return s[:max_len]


def _clean_list_str(v: Any, max_items: int, max_len_each: int) -> List[str]:
    if not v:
        return []
    if isinstance(v, str):
        # 문자열이면 줄바꿈/콤마 기준으로 분리
        parts = [p.strip() for p in v.replace("\r", "\n").split("\n") if p.strip()]
        if len(parts) <= 1:
            parts = [p.strip() for p in v.split(",") if p.strip()]
        v = parts
    if not isinstance(v, list):
        return []
    out: List[str] = []
    for item in v:
        t = _clip(item, max_len_each).strip()
        if t:
            out.append(t)
        if len(out) >= max_items:
            break
    return out


def _clean_dialogues(v: Any) -> List[Dict[str, str]]:
    if not v:
        return []
    if isinstance(v, dict) and isinstance(v.get("dialogues"), list):
        v = v.get("dialogues")
    if not isinstance(v, list):
        return []
    out: List[Dict[str, str]] = []
    for item in v:
        um = _clip(item.get("user_message") if isinstance(item, dict) else getattr(item, "user_message", None), 500).strip()
        cr = _clip(item.get("character_response") if isinstance(item, dict) else getattr(item, "character_response", None), 1000).strip()
        if um and cr:
            out.append({"user_message": um, "character_response": cr})
        if len(out) >= 2:
            break
    return out


def _clean_intro_scene(v: Any) -> Dict[str, str]:
    # 단일 객체 또는 리스트[0] 모두 허용
    if isinstance(v, list) and v:
        v = v[0]
    if not isinstance(v, dict):
        return {}
    title = _clip(v.get("title") or "도입부 1", 100).strip() or "도입부 1"
    content = _clip(v.get("content"), 2000).strip()
    secret = _clip(v.get("secret"), 1000).strip()
    if not content:
        return {}
    return {"title": title, "content": content, "secret": secret}


async def _build_vision_hints(image_url: str) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    """
    이미지에서 태그/컨텍스트를 추출한다.
    - 실패해도 전체 기능이 막히지 않게 ({} , {})로 폴백한다.
    """
    if not image_url:
        return {}, {}
    try:
        tags, ctx = await analyze_image_tags_and_context(image_url, model="claude")
        return tags or {}, ctx or {}
    except Exception as e:
        try:
            logger.warning(f"[quick_character] vision analyze failed, fallback to text-only: {e}")
        except Exception:
            pass
        return {}, {}


async def generate_quick_character_draft(req: QuickCharacterGenerateRequest) -> CharacterCreateRequest:
    """
    이미지+텍스트+태그를 기반으로 고급 캐릭터 생성 초안(payload)을 생성한다.

    반환값은 `POST /characters/advanced`에 그대로 전달 가능한 구조를 최대한 맞춘다.
    """
    name = _clip(req.name, 100) or "캐릭터"
    seed_text = _clip(req.seed_text, 2000)
    tags_user = _clean_list_str(req.tags, max_items=10, max_len_each=24)
    image_url = _clip(req.image_url, 500)

    # 모델 보정(방어)
    ai_model = (_safe_text(req.ai_model) or "gemini").lower()
    if ai_model not in ("gemini", "claude", "gpt"):
        ai_model = "gemini"
    model: AIModel = ai_model  # type: ignore[assignment]

    vision_tags, vision_ctx = await _build_vision_hints(image_url)

    vision_block = ""
    try:
        if vision_tags or vision_ctx:
            vision_block = json.dumps({"tags": vision_tags, "context": vision_ctx}, ensure_ascii=False)[:2500]
    except Exception:
        vision_block = ""

    tags_block = ", ".join(tags_user) if tags_user else ""

    system = (
        "너는 캐릭터 챗 서비스의 캐릭터 설정을 작성하는 전문가다.\n"
        "반드시 JSON 객체만 출력하고, 다른 텍스트/마크다운/코드블록을 출력하지 마라.\n"
        "허용 토큰은 {{user}}, {{assistant}} 만 사용 가능하다.\n"
    )

    user = f"""
[입력]
- 캐릭터 이름: {name}
- 유저가 원하는 느낌/설정: {seed_text}
- 유저가 선택한 태그: {tags_block or "없음"}
- 이미지 힌트(JSON, 있을 때만 참고): {vision_block or "없음"}

[출력 규칙]
- 아래 JSON 스키마를 정확히 따를 것.
- 각 필드는 가능한 한 구체적으로 채울 것(비어있지 않게).
- 과도한 설정은 피하고, 사용자 입력과 이미지 힌트에 최대한 근거할 것.

[JSON 스키마]
{{
  "description": "한 줄 소개(1~2문장, 300자 이내)",
  "personality": "성격/특징/목표/금기(2~6문장, 1200자 이내)",
  "speech_style": "말투/호칭/어투 규칙(2~4문장, 600자 이내)",
  "user_display_description": "사용자에게 보이는 소개(선택, 300자 이내)",
  "world_setting": "세계관/배경(선택, 900자 이내)",
  "greetings": ["인사말 후보 1", "인사말 후보 2", "인사말 후보 3"],
  "introduction_scene": {{"title": "도입부 1", "content": "도입부 내용(1200자 이내)", "secret": "비밀 정보(선택, 500자 이내)"}},
  "example_dialogues": [
    {{"user_message": "유저 예시(150자 이내)", "character_response": "캐릭터 응답 예시(350자 이내)"}},
    {{"user_message": "유저 예시(150자 이내)", "character_response": "캐릭터 응답 예시(350자 이내)"}}
  ]
}}
""".strip()

    prompt = f"{system}\n\n{user}"

    raw = await get_ai_completion(prompt=prompt, model=model, temperature=0.6, max_tokens=1400)
    cleaned = raw
    try:
        if "```json" in cleaned:
            cleaned = cleaned.split("```json", 1)[1].split("```", 1)[0].strip()
        elif "```" in cleaned:
            cleaned = cleaned.split("```", 1)[1].split("```", 1)[0].strip()
    except Exception:
        pass

    data: Dict[str, Any] = {}
    try:
        data = json.loads(cleaned) if cleaned else {}
        if not isinstance(data, dict):
            data = {}
    except Exception as e:
        # JSON 파싱 실패 시 최소 폴백
        try:
            logger.warning(f"[quick_character] json parse failed, fallback minimal: {e}")
        except Exception:
            pass
        data = {}

    description = _clip(data.get("description"), 3000)
    personality = _clip(data.get("personality"), 2000)
    speech_style = _clip(data.get("speech_style"), 2000)
    user_display = _clip(data.get("user_display_description"), 3000)
    world_setting = _clip(data.get("world_setting"), 5000)
    greetings = _clean_list_str(data.get("greetings"), max_items=3, max_len_each=500)
    intro = _clean_intro_scene(data.get("introduction_scene"))
    exds = _clean_dialogues(data.get("example_dialogues"))

    # 안전 기본값
    if not description:
        description = _clip(seed_text, 300) or f"{name}와(과) 대화를 시작해보세요."
    if not personality:
        personality = f"{name}는(은) {(_clip(seed_text, 200) or '자신만의 매력을 가진')} 캐릭터입니다."
    if not speech_style:
        speech_style = "자연스럽고 일관된 말투로 대화합니다."
    if not greetings:
        greetings = [f"안녕, {{user}}. 나는 {name}이야. 오늘 어떤 이야기 해볼까?"]
    if not intro:
        intro = {
            "title": "도입부 1",
            "content": f"{name}와(과) 대화가 시작됩니다. 지금 상황과 관계를 한 줄로 정해보세요.",
            "secret": "",
        }
    if not exds:
        exds = [{
            "user_message": "안녕! 오늘은 어떤 이야기로 시작할까?",
            "character_response": greetings[0][:350],
        }]

    greeting_join = "\n".join([g.strip() for g in greetings if g.strip()])[:500]

    # media: 대표 이미지가 있으면 avatar + gallery 1장으로 반영
    media_settings: Optional[CharacterMediaSettings] = None
    if image_url:
        try:
            media_settings = CharacterMediaSettings(
                avatar_url=image_url,
                image_descriptions=[ImageDescription(url=image_url, description="", keywords=[])],
                voice_settings=None,
            )
        except Exception:
            media_settings = None

    # example dialogues
    dialogues = [
        ExampleDialogue(user_message=d["user_message"], character_response=d["character_response"], order_index=i)
        for i, d in enumerate(exds[:2])
    ]
    example_dialogues = CharacterExampleDialogues(dialogues=dialogues)

    # introduction scenes
    intro_scene = IntroductionScene(
        title=_clip(intro.get("title") or "도입부 1", 100) or "도입부 1",
        content=_clip(intro.get("content"), 2000) or f"{name}와(과) 대화가 시작됩니다.",
        secret=_clip(intro.get("secret"), 1000) or None,
    )

    basic_info = CharacterBasicInfo(
        name=name,
        description=description,
        personality=personality,
        speech_style=speech_style,
        greeting=greeting_join,
        world_setting=world_setting or None,
        user_display_description=user_display or None,
        use_custom_description=bool(user_display),
        introduction_scenes=[intro_scene],
        character_type="roleplay",
        base_language="ko",
    )

    # publish_settings: 빠른 생성은 기본 공개(요구사항)
    publish_settings = CharacterPublishSettings(is_public=True, custom_module_id=None, use_translation=True)

    return CharacterCreateRequest(
        basic_info=basic_info,
        media_settings=media_settings,
        example_dialogues=example_dialogues,
        publish_settings=publish_settings,
    )



