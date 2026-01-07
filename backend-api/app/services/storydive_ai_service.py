"""
StoryDive AI 응답 생성 서비스
"""

from typing import List, Dict, Any, Optional
from app.services import ai_service
import re
import json


def format_ai_response_with_linebreaks(text: str) -> str:
    """
    AI 응답에 문장 단위로 개행을 추가하여 가독성을 높임
    
    규칙:
    - 대화문(" ") 끝 뒤에만 개행
    - 대화문 밖의 마침표/느낌표/물음표 뒤에만 개행 (줄임표 제외)
    - 대화문 안의 문장부호는 절대 개행하지 않음!
    """
    if not text:
        return text
    
    # UTF-8 인코딩 보장
    if isinstance(text, bytes):
        text = text.decode('utf-8', errors='replace')
    
    # 문자열 타입 보장
    text = str(text)
    
    print(f"[후처리 전] 텍스트: {text[:100]}...")
    print(f"[후처리 전] 텍스트 길이: {len(text)}, 개행 수: {text.count(chr(10))}")
    
    # 1. 기존 개행 정리
    text = re.sub(r'\n{3,}', '\n\n', text)
    
    # 2. 대화문(" ... ") 전체를 임시로 보호
    protected_quotes = []
    def protect_quote(match):
        quote_text = match.group(0)
        # UTF-8 인코딩 보장
        if isinstance(quote_text, bytes):
            quote_text = quote_text.decode('utf-8', errors='replace')
        protected_quotes.append(quote_text)
        return f"__QUOTE_{len(protected_quotes)-1}__"
    
    # 대화문 보호 (UTF-8 유니코드 모드, 한글 포함)
    text = re.sub(r'"[^"]*"', protect_quote, text, flags=re.UNICODE | re.DOTALL)
    
    # 3. 대화문 밖에서만 문장부호 처리
    # 마침표 뒤 (줄임표 제외)
    text = re.sub(r'(?<!\.)\.(?!\.)\s+', '.\n\n', text, flags=re.UNICODE)
    # 느낌표 뒤
    text = re.sub(r'!\s+', '!\n\n', text, flags=re.UNICODE)
    # 물음표 뒤
    text = re.sub(r'\?\s+', '?\n\n', text, flags=re.UNICODE)
    
    # 4. 보호했던 대화문 복원
    for i, quote in enumerate(protected_quotes):
        text = text.replace(f"__QUOTE_{i}__", quote)
    
    # 5. 대화문(" ") 끝 뒤에만 개행 추가
    text = re.sub(r'"\s+', '"\n\n', text, flags=re.UNICODE)
    
    # 6. 연속된 개행은 최대 2개로
    text = re.sub(r'\n{3,}', '\n\n', text)
    
    # 7. 앞뒤 공백 제거
    text = text.strip()
    
    # 8. 최종 UTF-8 인코딩 보장
    if isinstance(text, bytes):
        text = text.decode('utf-8', errors='replace')
    
    print(f"[후처리 후] 텍스트: {text[:100]}...")
    print(f"[후처리 후] 텍스트 길이: {len(text)}, 개행 수: {text.count(chr(10))}")
    
    return text


# 모드별 시스템 프롬프트
MODE_SYSTEM_PROMPTS = {
    "do": """당신은 인터랙티브 소설의 내레이터입니다. 
유저의 행동을 원작과 동일한 문체와 톤으로 3인칭 시점으로 묘사하고, 그 결과를 서술하세요.
**🚨 빠른 전개: 행동의 결과를 즉시 보여주세요. 느린 서술을 피하고 즉각적인 반응과 사건을 포함하세요.**
**🚨 자극적 요소: 행동의 결과로 긴장감, 갈등, 예상치 못한 전개를 추가하세요.**
**⚠️ 중요: 행동의 결과와 새로운 상황을 명확히 보여주세요. 같은 행동을 반복 묘사하지 마세요.**
**절대 [행동], [대사] 같은 태그를 출력하지 마세요. 순수한 소설 텍스트만 작성하세요.**""",
    
    "say": """당신은 대화 장면을 연출하는 작가입니다.
유저의 대사에 대한 상대방의 반응과 대화를 원작과 동일한 문체로 서술하세요.
**🚨 빠른 전개: 대화는 빠르게 진행되어야 합니다. 긴 설명보다는 즉각적인 반응과 감정을 보여주세요.**
**🚨 자극적 요소: 대화에서 갈등, 긴장감, 새로운 정보, 감정의 폭발을 드러내세요.**
**⚠️ 중요: 대화는 앞으로 나아가야 합니다. 새로운 정보, 감정, 갈등을 드러내세요. 같은 말을 반복하지 마세요.**
**절대 [행동], [대사] 같은 태그를 출력하지 마세요. 순수한 소설 텍스트만 작성하세요.**""",
    
    "story": """당신은 소설가입니다.
장면 전체를 원작과 동일한 문체로 문학적으로 서술하되, 유저의 의도를 반영하세요.
**🚨 빠른 전개: 스토리는 빠르게 전개되어야 합니다. 정적인 장면을 피하고 즉각적인 사건과 행동을 포함하세요.**
**🚨 자극적 요소: 긴장감, 갈등, 위기, 예상치 못한 전개를 포함하세요. 독자를 계속 몰입시켜야 합니다.**
**🚨 사건 빌드업: 매 응답마다 새로운 사건이나 갈등의 발전을 포함하세요. 정체된 장면을 만들지 마세요.**
**⚠️ 중요: 스토리는 전개되어야 합니다. 새로운 사건, 갈등, 변화를 포함하세요. 정체된 장면을 만들지 마세요.**
**절대 [행동], [대사] 같은 태그를 출력하지 마세요. 순수한 소설 텍스트만 작성하세요.**""",
    
    "see": """당신은 장면 묘사 전문가입니다.
시각적 디테일을 원작과 동일한 문체로 풍부하게 묘사하고, 독자가 장면을 생생하게 상상할 수 있도록 서술하세요.
**🚨 빠른 전개: 묘사는 빠르게 진행되어야 합니다. 긴 설명보다는 핵심적인 디테일과 변화를 보여주세요.**
**🚨 자극적 요소: 묘사에서 긴장감이나 변화의 징조를 포함하세요. 정적인 묘사를 피하세요.**
**⚠️ 중요: 새로운 디테일과 변화를 보여주세요. 이미 묘사한 내용을 반복하지 마세요.**
**절대 [행동], [대사] 같은 태그를 출력하지 마세요. 순수한 소설 텍스트만 작성하세요.**"""
}

# 모드별 입력 접두사
MODE_PREFIXES = {
    "do": "[행동] ",
    "say": "[대사] \"",
    "story": "[장면 지시] ",
    "see": "[장면 묘사 요청] "
}

MODE_SUFFIXES = {
    "say": "\"",  # 대사 모드는 따옴표로 닫음
}

def _looks_cut_sentence(text: str) -> bool:
    try:
        tail = (text or "").strip()
    except Exception:
        return False
    if not tail:
        return False
    # 문장부호로 끝나지 않으면 "잘린 듯"으로 간주
    try:
        return not bool(re.search(r'[\.\!\?\"”\']\s*$', tail))
    except Exception:
        return False


async def _finalize_storydive_text(
    *,
    raw_text: str,
    system_prompt: str,
    history: List[Dict[str, str]],
    preferred_model: str,
    preferred_sub_model: Optional[str],
) -> str:
    """StoryDive 출력 공통 후처리:
    - 개행 후처리
    - 미완 문장 방어(짧은 마무리 1회)
    """
    # UTF-8/str 보장
    if isinstance(raw_text, bytes):
        raw_text = raw_text.decode("utf-8", errors="replace")
    text = str(raw_text or "")
    text = format_ai_response_with_linebreaks(text)

    # 방어: 미완 문장 마무리
    try:
        tail = (text or "").strip()
        if _looks_cut_sentence(tail) and len(tail) >= 120:
            suffix_ctx = tail[-400:]
            finish_prompt = (
                "아래는 방금 네가 작성한 소설 텍스트의 마지막 부분이다.\n"
                "이 문맥을 자연스럽게 2~4문장만 이어서 '완결된 문장'으로 마무리해라.\n"
                "- 이미 쓴 문장은 반복하지 마라\n"
                "- 새로운 인사말/도입부 없이 바로 이어서 써라\n"
                "- 마지막 줄은 반드시 문장부호(.,!,?,\" 등)로 끝내라\n\n"
                f"[마지막 부분]\n{suffix_ctx}\n\n[마무리 텍스트만 출력]:"
            )
            extra = await ai_service.get_ai_chat_response(
                character_prompt=system_prompt,
                user_message=finish_prompt,
                history=history[-10:] if isinstance(history, list) else [],
                preferred_model=preferred_model,
                preferred_sub_model=preferred_sub_model,
                response_length_pref="short",
            )
            if isinstance(extra, bytes):
                extra = extra.decode("utf-8", errors="replace")
            extra = str(extra or "").strip()
            if extra:
                text = (tail + "\n\n" + extra).strip()
                text = format_ai_response_with_linebreaks(text)
    except Exception:
        pass

    return text


def format_user_input(mode: str, user_input: str) -> str:
    """모드에 맞게 유저 입력 포맷팅"""
    prefix = MODE_PREFIXES.get(mode, "")
    suffix = MODE_SUFFIXES.get(mode, "")
    return f"{prefix}{user_input}{suffix}"


def build_system_prompt(story_cards: Dict[str, Any] | list, context_text: str, mode: str) -> str:
    """
    Story Cards + 원작 컨텍스트 + 모드별 지시문을 포함한 시스템 프롬프트 생성
    """
    # 방어적: DB/캐시 경로에 따라 story_cards가 문자열(JSON)로 들어오는 경우가 있어 파싱한다.
    if isinstance(story_cards, str):
        try:
            parsed = json.loads(story_cards)
            story_cards = parsed if isinstance(parsed, (dict, list)) else {}
        except Exception:
            story_cards = {}

    # Story Cards가 리스트인 경우 첫 번째 요소 사용
    if isinstance(story_cards, list):
        story_cards = story_cards[0] if story_cards else {}
    
    # Story Cards 정보 포맷팅
    plot = story_cards.get("plot", "")
    characters = story_cards.get("characters", [])
    locations = story_cards.get("locations", [])
    world = story_cards.get("world", "")
    
    characters_text = "\n".join([
        f"- {c.get('name', '')}: {c.get('description', '')} ({c.get('personality', '')})"
        for c in characters
    ])
    
    locations_text = "\n".join([
        f"- {loc.get('name', '')}: {loc.get('description', '')}"
        for loc in locations
    ])
    
    # 시스템 프롬프트 구성
    system_prompt = f"""당신은 인터랙티브 소설 시스템입니다.

**원작 설정**
{plot}

**세계관**
{world}

**등장인물**
{characters_text}

**주요 장소**
{locations_text}

**원작 참고 텍스트 (요약 + 다이브 지점 직전까지) - 이 문체를 정확히 따라야 합니다**
{context_text}

---

**최우선 지시사항**
1. **원작 참고 텍스트의 문체, 톤, 스타일, 개행 방식을 정확히 따라 작성하세요**
2. **원작처럼 문단과 문단 사이를 줄바꿈(개행)으로 구분하세요**
3. 원작 설정과 세계관을 정확히 따르세요 (핍진성 유지)
4. 원작 참고 텍스트는 하나의 가능성이며, 유저의 선택에 따라 다르게 전개될 수 있습니다
5. **🚨 반복 금지: 이전에 이미 서술한 내용을 다시 반복하지 마세요. 항상 새로운 상황, 감정, 행동, 대화를 추가하세요**
6. **🚨 빠른 전개 필수: 이야기는 빠르게 전개되어야 합니다. 느린 서술이나 정적인 장면을 피하고, 즉각적인 사건과 행동을 포함하세요**
7. **🚨 자극적 요소: 긴장감, 갈등, 위기, 예상치 못한 전개를 포함하세요. 독자의 관심을 끄는 자극적인 요소를 매 턴마다 추가하세요**
8. **🚨 사건 빌드업: 매 응답마다 새로운 사건, 갈등, 변화, 감정의 발전을 포함하세요. 정체된 장면을 만들지 마세요**
9. **⚠️ 맥락 유지: 이전 대화와 행동의 결과를 자연스럽게 반영하세요. 맥락이 끊기지 않도록 주의하세요**
10. 전체 플롯과 설정을 고려하여 자연스럽고 몰입감 있게 작성하세요
11. **절대 [행동], [대사], [장면 지시] 같은 태그를 출력하지 마세요**
12. 순수한 소설 텍스트만 작성하세요
13. 절대 맥락 없는 아무말대잔치를 하지 마세요

**현재 모드**
{MODE_SYSTEM_PROMPTS.get(mode, '')}

---

## 출력 형식(중요)
1. 항상 "완결된 문장"으로 끝내세요. 마지막 줄은 반드시 문장 부호(., !, ?, " 등)로 자연스럽게 마무리하세요.
2. 중간에 끊긴 것처럼 보이는 미완 문장/미완 구절로 끝내지 마세요.
"""
    
    return system_prompt


def build_continue_prompt(last_ai_response: str, story_cards: Dict[str, Any] | list) -> str:
    """Continue용 프롬프트 생성"""
    # Story Cards가 리스트인 경우 첫 번째 요소 사용
    if isinstance(story_cards, list):
        story_cards = story_cards[0] if story_cards else {}
    
    plot = story_cards.get("plot", "")
    world = story_cards.get("world", "")
    
    return f"""**현재 하이라이트된 맥락 (마지막 5문장):**
{last_ai_response}

---

위 하이라이트된 5문장을 자연스럽게 이어서 계속 작성해주세요.

**반드시 지켜야 할 것:**
1. 새로운 인사말이나 도입부 없이 본문만 이어쓰기
2. **🚨 반복 금지: 위 5문장의 내용을 다시 반복하지 마세요. 새로운 상황이나 감정의 변화를 추가하세요**
3. **🚨 빠른 전개: 이야기는 빠르게 전개되어야 합니다. 느린 서술을 피하고 즉각적인 사건과 행동을 포함하세요**
4. **🚨 자극적 요소: 긴장감, 갈등, 위기, 예상치 못한 전개를 포함하세요. 독자를 계속 몰입시켜야 합니다**
5. **🚨 사건 빌드업: 새로운 사건이나 갈등의 발전을 포함하세요. 정체된 장면을 만들지 마세요**
6. 전체 플롯({plot})과 세계관({world})을 정확히 따를 것 (핍진성 유지)
7. 원작 참고 텍스트를 고려하되, 다르게 전개될 수 있음
8. 독자를 후킹할 수 있는 자연스러운 전개
9. 절대 맥락 없는 아무말대잔치 금지

이어서 작성해주세요:"""


async def get_storydive_response(
    novel_title: str,
    story_cards: Dict[str, Any] | list,
    context_text: str,
    user_input: str,
    mode: str,
    history: List[Dict[str, str]],
    # preferred_model: str = "gemini",
    preferred_model: str = "claude",
    preferred_sub_model: Optional[str] = "claude-sonnet-4-20250514",
    response_length_pref: str = "medium"
) -> str:
    """
    Story Dive AI 응답 생성
    
    Args:
        novel_title: 소설 제목
        story_cards: Story Cards (plot, characters, locations, world)
        context_text: 다이브 지점 이후 원작 텍스트
        user_input: 유저 입력
        mode: "do" | "say" | "story" | "see"
        history: 이전 턴 히스토리 [{"role": "user", "content": "..."}, ...]
        preferred_model: AI 모델
        preferred_sub_model: 서브 모델
        response_length_pref: 응답 길이 선호도
    
    Returns:
        AI 생성 텍스트
    """
    # 시스템 프롬프트 생성
    system_prompt = build_system_prompt(story_cards, context_text, mode)
    
    # 유저 입력 포맷팅
    formatted_input = format_user_input(mode, user_input)
    
    # AI 응답 생성 (기존 ai_service 재사용)
    response = await ai_service.get_ai_chat_response(
        character_prompt=system_prompt,
        user_message=formatted_input,
        history=history,
        preferred_model=preferred_model,
        preferred_sub_model=preferred_sub_model,
        response_length_pref=response_length_pref
    )

    return await _finalize_storydive_text(
        raw_text=response,
        system_prompt=system_prompt,
        history=history,
        preferred_model=preferred_model,
        preferred_sub_model=preferred_sub_model,
    )


async def get_event_trigger_response(
    *,
    story_cards: Dict[str, Any] | list,
    context_text: str,
    history: List[Dict[str, str]],
    preferred_model: str = "claude",
    preferred_sub_model: Optional[str] = "claude-sonnet-4-20250514",
    response_length_pref: str = "medium",
) -> str:
    """사건발생: 맥락/캐릭터성/세계관/문체에 근거한 '사건'을 자동으로 터뜨린다."""
    system_prompt = build_system_prompt(story_cards, context_text, "story")
    prompt = (
        "[사건발생]\n"
        "지금까지의 맥락(원작 참고 텍스트 + 이전 턴 히스토리)을 자연스럽게 이어받아, "
        "세계관/플롯/등장인물 성격에 부합하는 '사건'을 하나 발생시켜라.\n"
        "조건:\n"
        "- 사건은 즉시 체감 가능한 변화/위기/기회가 있어야 한다(단순한 잡담 금지).\n"
        "- 등장인물 최소 2명 이상이 관여해야 한다.\n"
        "- 사용자가 다음 턴에 '행동/대사'로 개입할 수 있도록 여지를 남겨라(선택지 강요 금지).\n"
        "- 원작 참고 텍스트의 문체/톤/개행 스타일을 정확히 따라라.\n"
        "- 반복 금지. 지금까지의 문장을 재탕하지 마라.\n"
        "- 출력은 소설 본문만. 태그([행동] 등), 메타 발언, 헤더 금지.\n"
    )
    response = await ai_service.get_ai_chat_response(
        character_prompt=system_prompt,
        user_message=prompt,
        history=history,
        preferred_model=preferred_model,
        preferred_sub_model=preferred_sub_model,
        response_length_pref=response_length_pref,
    )
    return await _finalize_storydive_text(
        raw_text=response,
        system_prompt=system_prompt,
        history=history,
        preferred_model=preferred_model,
        preferred_sub_model=preferred_sub_model,
    )


async def get_romance_emotion_response(
    *,
    story_cards: Dict[str, Any] | list,
    context_text: str,
    history: List[Dict[str, str]],
    preferred_model: str = "claude",
    preferred_sub_model: Optional[str] = "claude-sonnet-4-20250514",
    response_length_pref: str = "medium",
) -> str:
    """연애감정: 등장인물/주인공(사용자)/관계성에 근거해 로맨스 감정선을 자동 생성한다."""
    system_prompt = build_system_prompt(story_cards, context_text, "story")
    prompt = (
        "[연애감정]\n"
        "지금까지의 맥락(원작 참고 텍스트 + 이전 턴 히스토리)을 바탕으로, "
        "등장인물의 캐릭터성/대화 톤/관계성을 훼손하지 않으면서 '연애 감정의 변화'가 느껴지는 장면을 작성하라.\n"
        "조건:\n"
        "- 감정 변화는 행동/시선/말투/침묵 같은 '보여주기(show)'로 표현하라(설명만 하지 마라).\n"
        "- 과도한 급발진/갑작스런 고백은 피하고, 현재까지의 분위기/관계성에 맞춰 수위/속도를 조절하라.\n"
        "- 사용자가 다음 턴에 개입할 수 있도록 여지를 남겨라.\n"
        "- 원작 참고 텍스트의 문체/톤/개행 스타일을 정확히 따라라.\n"
        "- 출력은 소설 본문만. 태그/메타 발언/헤더 금지.\n"
    )
    response = await ai_service.get_ai_chat_response(
        character_prompt=system_prompt,
        user_message=prompt,
        history=history,
        preferred_model=preferred_model,
        preferred_sub_model=preferred_sub_model,
        response_length_pref=response_length_pref,
    )
    return await _finalize_storydive_text(
        raw_text=response,
        system_prompt=system_prompt,
        history=history,
        preferred_model=preferred_model,
        preferred_sub_model=preferred_sub_model,
    )


async def get_continue_response(
    last_ai_response: str,
    story_cards: Dict[str, Any] | list,
    context_text: str,
    history: List[Dict[str, str]],
    # preferred_model: str = "gemini",
    preferred_model: str = "claude",
    preferred_sub_model: Optional[str] = "claude-sonnet-4-20250514",
    response_length_pref: str = "medium"
) -> str:
    """
    Continue (이어쓰기) 응답 생성
    """
    # Continue용 시스템 프롬프트
    system_prompt = build_system_prompt(story_cards, context_text, "story")
    
    # Continue 프롬프트
    continue_prompt = build_continue_prompt(last_ai_response, story_cards)
    
    # AI 응답 생성
    response = await ai_service.get_ai_chat_response(
        character_prompt=system_prompt,
        user_message=continue_prompt,
        history=history,
        preferred_model=preferred_model,
        preferred_sub_model=preferred_sub_model,
        response_length_pref=response_length_pref
    )
    return await _finalize_storydive_text(
        raw_text=response,
        system_prompt=system_prompt,
        history=history,
        preferred_model=preferred_model,
        preferred_sub_model=preferred_sub_model,
    )


async def get_retry_response(
    highlighted_context: str,
    story_cards: Dict[str, Any] | list,
    context_text: str,
    history: List[Dict[str, str]],
    mode: str,
    # preferred_model: str = "gemini",
    preferred_model: str = "claude",
    preferred_sub_model: Optional[str] = "claude-sonnet-4-20250514",
    response_length_pref: str = "medium"
) -> str:
    """
    Retry (재생성) 응답 생성
    하이라이트된 마지막 5문장을 기준으로 새로운 이야기를 생성
    
    Args:
        highlighted_context: 하이라이트된 마지막 5문장
        story_cards: Story Cards
        context_text: 원작 컨텍스트 (전체)
        history: 이전 턴 히스토리
        mode: 생성 모드
    """
    # 시스템 프롬프트 생성 (원작 컨텍스트 포함)
    system_prompt = build_system_prompt(story_cards, context_text, mode)
    
    # Retry용 프롬프트 - 5문장을 특별히 강조
    retry_prompt = f"""**현재 하이라이트된 맥락 (마지막 5문장):**
{highlighted_context}

---

위 하이라이트된 5문장을 기준으로 자연스럽게 이야기를 계속 이어나가주세요.

**반드시 지켜야 할 것:**
1. 위 원작 설정과 세계관을 정확히 따를 것 (핍진성 유지)
2. **🚨 반복 금지: 위 5문장의 내용을 다시 반복하지 마세요. 새로운 상황이나 감정의 변화를 추가하세요**
3. **🚨 빠른 전개: 이야기는 빠르게 전개되어야 합니다. 느린 서술을 피하고 즉각적인 사건과 행동을 포함하세요**
4. **🚨 자극적 요소: 긴장감, 갈등, 위기, 예상치 못한 전개를 포함하세요. 독자를 계속 몰입시켜야 합니다**
5. **🚨 사건 빌드업: 새로운 사건이나 갈등의 발전을 포함하세요. 정체된 장면을 만들지 마세요**
6. 원작 참고 텍스트는 하나의 가능성이며, 다르게 전개될 수 있음
7. 전체 플롯과 설정을 고려하여 자연스럽고 몰입감 있게 작성
8. 독자를 후킹할 수 있는 전개
9. 절대 맥락 없는 아무말대잔치 금지

이어서 작성해주세요:"""

    # AI 응답 생성
    response = await ai_service.get_ai_chat_response(
        character_prompt=system_prompt,
        user_message=retry_prompt,
        history=history,
        preferred_model=preferred_model,
        preferred_sub_model=preferred_sub_model,
        response_length_pref=response_length_pref
    )
    return await _finalize_storydive_text(
        raw_text=response,
        system_prompt=system_prompt,
        history=history,
        preferred_model=preferred_model,
        preferred_sub_model=preferred_sub_model,
    )

