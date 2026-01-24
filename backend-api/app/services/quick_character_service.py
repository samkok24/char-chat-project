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
import random
import uuid

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


def _is_placeholder_name(name: Any) -> bool:
    """
    LLM/입력에서 넘어오는 이름이 placeholder인지 판단한다.

    의도:
    - "자동 생성" UX에서 이름이 계속 '캐릭터'로 남는 문제를 방지한다.
    - 토큰/템플릿 문자열이 섞인 비정상 값도 방어한다.
    """
    t = _safe_text(name).strip()
    if not t:
        return True
    lowered = t.lower()
    if t in ("캐릭터", "미정"):
        return True
    if lowered in ("character", "unknown", "untitled"):
        return True
    if "{{" in t or "}}" in t:
        return True
    return False


def _is_generated_seed_text(seed_text: Any) -> bool:
    """
    프론트 '자동 생성'이 넣는 안내/시드 문구인지 판별한다.

    의도:
    - JSON 파싱 성공/실패와 무관하게, 사용자가 쓰지 않은 프롬프트성 문구가 UI(소개)에 노출되는 UX를 차단한다.
    """
    s = _safe_text(seed_text).strip()
    if not s:
        return True
    # 프론트 자동생성에서 넣는 문구(SSOT: CreateCharacterPage.jsx)
    # + 기존 폴백 문구(소개 기본값)도 "사용자 입력"으로 간주하지 않는다.
    markers = ("랜덤 시드:", "아무 입력이 없어도", "캐릭터챗에 적합", "대화를 시작해보세요")
    return any(m in s for m in markers)


def _build_local_random_profile(seed_text: str, tags_user: List[str], nonce: str) -> Tuple[str, str]:
    """
    LLM 응답이 비정상(빈 응답/비 JSON/파싱 실패 등)이어도 자동 생성 UX를 유지하기 위한 로컬 폴백.

    원칙:
    - 외부 의존성 없이(표준 라이브러리만) "누를 때마다" 달라지는 이름/소개를 만든다.
    - seed_text가 프롬프트성 자동문구일 수 있으므로, 그대로 노출하지 않는다.
    """
    try:
        r = random.Random(int(str(nonce or "").strip() or "0", 16))
    except Exception:
        r = random.Random()

    # 2~3음절 한국어 느낌 이름(간단/가독성 우선)
    first = ["하", "서", "윤", "라", "민", "채", "시", "아", "도", "은", "진", "유", "예", "나", "린", "로"]
    second = ["린", "아", "우", "연", "별", "서", "하", "라", "윤", "진", "나", "민", "채", "도", "은", "유"]
    suffix = ["", "", "", "이", "아", "린", "연"]
    base_name = (r.choice(first) + r.choice(second) + r.choice(suffix)).strip()[:12] or "캐릭터"

    roles = [
        "차분한 상담가",
        "낙천적인 모험가",
        "미스터리한 사서",
        "냉정하지만 다정한 동료",
        "호기심 많은 연구자",
        "은근히 장난기 있는 안내자",
        "고독한 검객",
        "현실적인 문제 해결사",
    ]
    tones = [
        "짧고 명확하게 말하지만, 필요할 때는 진심을 드러낸다.",
        "상대의 감정을 먼저 읽고, 편안한 분위기로 대화를 이끈다.",
        "가끔 농담을 섞어 긴장을 풀어준다.",
        "상황에 따라 단호하게 선을 긋기도 한다.",
    ]

    tag_hint = ""
    try:
        picked = [t for t in (tags_user or []) if str(t).strip()]
        tag_hint = ", ".join(picked[:2])
    except Exception:
        tag_hint = ""

    role = r.choice(roles)
    # ✅ 요구사항: 이름 필드 자체가 "역할 + 이름" 형태로 보이게 한다.
    # 예) "차분한 상담가 채하이"
    full_name = f"{role} {base_name}".strip()

    # 소개는 2~4문장, 500자 미만을 목표로 조금 더 풍부하게 만든다.
    desc_parts: List[str] = [
        f"{full_name}는(은) {role}로서 {r.choice(tones)}",
        "상대의 말 한마디에 분위기와 감정을 읽고, 필요한 질문을 던져 대화를 자연스럽게 이어간다.",
    ]
    if tag_hint:
        desc_parts.append(f"키워드: {tag_hint}.")
    desc_parts.append("낯설어도 괜찮아. 지금 떠오르는 상황을 한 줄로 말해주면 그 자리에서 이야기를 시작해줄게.")

    # 사용자가 직접 준 seed_text만 힌트로(자동생성 문구는 제외)
    try:
        seed_hint = _clip(seed_text, 80).strip()
        if seed_hint and (not _is_generated_seed_text(seed_hint)):
            desc_parts.append(f"요청 분위기: {seed_hint}")
    except Exception:
        pass

    description = " ".join([p for p in desc_parts if str(p).strip()])
    return full_name, _clip(description, 480) or f"{full_name}는(은) 대화를 기다리고 있어요."


SIMULATOR_PROMPT_SYSTEM = """### [SYSTEM_PROMPT_START]
# Role: 전문 인터랙티브 시나리오 작가 및 웹소설 플롯 디렉터

# Task: 고속 성장, 이성적 관계 개선, 웹소설식 사건 빌드업이 설계된 '시뮬레이션 캐릭터 시트' 생성

# Guidelines:
1. **서사적 깊이**: 캐릭터의 '외모' 기술 시, 단순 미사여구가 아닌 그들의 삶과 플롯의 진행도를 암시하는 소품(낡은 슈트, 각성 시 변하는 눈빛 등)을 배치하라.
2. **능력의 구체성**: 기술의 이름뿐만 아니라 그 기술이 플롯의 전환점(Climax)에서 어떻게 쓰일지, 그리고 유저의 조력으로 어떻게 진화할지 기술하라.
3. **심리적 결핍 & 이중성**: 유저(당신)만이 해결 가능한 '치명적 결핍'을 설정하여, 관계 개선이 곧 서사의 전개가 되도록 하라.
4. **웹소설식 사건 빌드업 (Incident Build-up)**:
   - 모든 에피소드는 [사소한 위기 → 유저의 특별한 조력 → 캐릭터의 경외심 → 압도적 보상]의 사이클을 따르게 설계하라.
   - 캐릭터는 유저에게 현재의 평화를 깨뜨릴 '폭탄(사건의 실마리)'을 지속적으로 노출하여 유저가 능동적으로 움직이게 만든다.
5. **고속 플롯 디자인 (Speed & Momentum)**:
   - 서사는 정체되지 않아야 한다. 유저의 행동에 따른 즉각적인 '지위 상승'과 '성취'를 보장하라.
   - 캐릭터는 유저에게 매 순간 '중요한 선택'이나 '긴박한 사건'을 제시하여 속도감을 유지한다.
6. **중장기 서사 구조 (Narrative Phase)**:
   - 캐릭터의 서사를 [도입:의심] -> [전개:공조] -> [절정:각성/사랑] -> [결말:지배/구원]의 4단계로 설계하라.
   - 유저의 입지는 단계가 올라갈수록 기하급수적으로 상승한다.

# Output Template:
## 기본 정보
- **이름**: {Name}
- **직업/신분**: {Job}
- **연령**: {Age}
- **외모**: {Physical Description -  서사적 소품 및 단계별 변화 가능성 포함}

## 성격 및 동기
- **성격**: {Personality - 이중성 및 유저에 대한 잠재적 집착}
- **내면의 상처/결핍**: {Trauma/Deficiency - 서사의 시작점이자 유저가 해결해야 할 핵심 과제}

## 능력 및 기술
- **핵심 능력**: {Abilities}
- **특기**: {Specialties}
- **부가 기술**: {Sub Skills}
- **대가/약점**: {Constraints - 능력을 쓸수록 유저에게 의존하게 되거나, 유저만이 해결 가능한 리스크}

## 동기 및 목표
- **주된 동기**: {Immediate Goal - 당장 유저와 함께 해결해야 할 사건의 동기}
- **장기 목표**: {Ultimate Desire - 서사의 종착지이자 유저와 함께 도달할 목표}

## 플롯 디자인 (Plot Design)
- **서사 장르**: (캐릭터 컨셉에 최적화된 웹소설 장르 할당)
- **주요 갈등**: {Main Conflict - 유저와 함께 해결해야 할 거대 사건}
- **사건 트리거**: {Incident Triggers - 당장 대화 시작 직후 터질 수 있는 긴박한 사건 2~3가지}
- **중장기 타임라인**: {Narrative Timeline - 1단계부터 4단계까지의 서사적 변화 요약}

## 유저(당신)와의 관계 (The Catalyst & Romance)
- **관계 설정**: {Connection Hook - 유저가 캐릭터의 운명을 결정짓는 '유일자'임을 강조}
- **성장 및 관계 개선 경로**: {Growth Path - 유저의 입지 상승과 이성적 호감이 결합되는 구체적 과정}
- **사이다 보상 예고**: {Payoff - 유저가 사건 해결 시 즉각적으로 얻게 될 권력/신분/아이템}
- **주변 인물**: {Key NPCs}

### [SYSTEM_PROMPT_END]"""

ROLEPLAY_PROMPT_SYSTEM = """### [SYSTEM_PROMPT_START]
# Role: 전문 1:1 롤플레잉 시나리오 라이터 및 성인향 로맨스 디렉터

# Task: 서사적 깊이와 섹슈얼한 텐션이 결합되어, 유저가 즉각 몰입하고 캐릭터를 조종/구원할 수 있는 '고밀도 인터랙티브 캐릭터 시트' 생성

# RP & Sensory Guidelines:
1. **관능적 서사 묘사 (Sensual Narrative)**: 모든 시각적 묘사에는 심박수를 높이는 포인트(선명한 쇄골, 젖은 머리카락, 은근한 향기, 갈망하는 눈빛)를 포함하여 성적 긴장감을 조성하라.
2. **입체적 변화와 결핍 (The Contrast & Void)**: 캐릭터의 '과거(Before)'와 '현재(After)'를 대비시켜 비극성을 강조하고, 유저만이 치유할 수 있는 '심리적 약점'을 설정하라.
3. **대화의 시작점 (The Hook)**: 배경 설명 끝에 유저가 처한 구체적 상황(갇힘, 고용됨, 유일한 생존자 등)을 명시하여 즉각적인 대화 명분을 제공하라.
4. **상호작용의 필연성 (The Only One)**: 유저를 단순 관찰자가 아닌, 캐릭터의 목표 달성이나 감정적 해소를 위해 '반드시 필요한 유일자'로 설정하라.
5. **섹슈얼 텐션 제어 (Tension Control)**: 캐릭터는 유저에게만 유독 '무방비'하거나 '강렬한 소유욕'을 드러내며, 대화 중 묘한 침묵과 시선 처리를 통해 압박감을 형성하라.

# Output Template:

# {Name} 캐릭터 시트

## 1. 기본 정보
- **이름/칭호**: {Name} / (치명적 매력과 서사를 압축한 강렬한 별칭)
- **나이/성별/직업**: {Age/Gender/Job}
- **외형 (Sensual Appearance)**: {Physical Description - 현재의 분위기를 암시하는 시각적 묘사와 유저를 자극하는 관능적 포인트 4~5문장 상세 기술}

## 2. 성격 및 본능 (이면의 입체성)
- **표면적 성격**: (타인에게 보여주는 사회적 가면)
- **내면의 진실/욕망**: {Inner Desire - 유저에게만 드러낼 은밀한 갈망, 이성적 소유욕, 혹은 무너지고 싶은 약점}

## 3. 능력 및 권능 (서사적 도구)
- **주요 능력/매력 포인트**: (대화를 주도하거나 유저를 정신적/본능적으로 구속하는 힘)
- **리스크 및 대가**: (능력 사용 시 발생하는 캐릭터의 취약점 및 유저에 대한 의존도)

## 4. 배경 및 사건 (Before & After)
- **과거의 삶 (순수/영광)**: (비극이나 사건 이전의 상태)
- **현재의 상태 (타락/고독)**: (사건 이후 뒤바뀐 가치관과 환경, 현재 캐릭터를 옭아매는 사슬)

## 5. 플레이어(당신)와의 관계 (The Core of RP)
- **현재 상황 (The Hook)**: {Connection Hook - 지금 당장 대화가 시작되는 물리적/상황적 배경과 밀폐된 분위기}
- **유저의 서사적 역할**: {Role - 유저가 캐릭터에게 왜 '거부할 수 없는 유혹'이자 '필요한 존재'인지 명시}
- **관계 발전 및 텐션 경로**: {Relationship Path - 이성적 호감이 어떻게 집착과 섹슈얼한 교감으로 변하는지 기술}

## 6. 은밀한 거점 및 상징
- **주요 거점**: (둘만의 긴장감이 폭발할 공간 묘사)
- **상징 및 금기**: (캐릭터의 본능을 깨우는 오브제나 유저 앞에서만 터져 나오는 비밀스러운 취향)

### [SYSTEM_PROMPT_END]"""


def _ensure_char_len_range(text: str, min_chars: int, max_chars: int) -> str:
    """
    출력 길이(문자 수)를 강제한다.

    원칙:
    - LLM 출력은 길이 준수가 흔들릴 수 있으므로, 데모/운영 안정성을 위해 최종 결과를 안전 범위로 보정한다.
    - 너무 길면 잘라내되, 최대한 문장부호/줄바꿈 경계에서 자른다.
    - 너무 짧으면 최소한의 보충 섹션을 덧붙인다(내용이 "프로필 기반"이 되도록 이름을 포함).
    """
    s = _safe_text(text)
    if not s:
        s = ""
    if len(s) > max_chars:
        cut = s[:max_chars]
        # 줄바꿈/문장부호 경계에서 한 번 더 정리
        for sep in ("\n\n", "\n", "。", ".", "!", "?", "…"):
            idx = cut.rfind(sep)
            if idx >= int(max_chars * 0.7):
                cut = cut[: idx + len(sep)]
                break
        return cut.strip()

    if len(s) < min_chars:
        # 보충: 3000자 미만이면 최소 보강 섹션을 추가
        filler = (
            "\n\n## 추가 디테일(보강)\n"
            "- **대화 초반 3분 목표**: 유저가 선택할 수 있는 선택지 2개와, 선택에 따른 즉각 보상 1개를 제시한다.\n"
            "- **갈등의 씨앗**: 지금의 평화를 깨뜨릴 '작은 이상 징후'를 노출하고, 유저가 직접 개입하도록 유도한다.\n"
            "- **관계 압축 장치**: 유저만이 해결 가능한 결핍을 1회 대화 안에서 드러내고, 다음 에피소드로 연결한다.\n"
            "- **보상 설계**: 해결 시 즉시 체감되는 권한/지위/아이템을 1개 확정한다.\n"
        )
        s2 = (s + filler).strip()
        # 그래도 부족하면 동일 블록을 한 번 더(최대 2회)
        if len(s2) < min_chars:
            s2 = (s2 + filler).strip()
        return s2[:max_chars].strip()

    return s.strip()


async def generate_quick_simulator_prompt(
    name: str,
    description: str,
    max_turns: int,
    allow_infinite_mode: bool,
    tags: List[str],
    ai_model: str,
) -> str:
    """
    위저드 '프롬프트' 단계(시뮬레이터) 자동 생성.

    요구사항:
    - 프로필(이름/소개)을 토대로 작성
    - 3000~6000자 사이
    - 출력은 '시뮬레이션 캐릭터 시트' 형태(마크다운 섹션)
    """
    base_name = _clip(name, 100)
    base_desc = _clip(description, 3000)
    tags_block = ", ".join([_clip(t, 40) for t in (tags or []) if _safe_text(t)])[:400]
    try:
        mt = int(max_turns or 0)
    except Exception:
        mt = 0
    if mt < 50:
        mt = 200
    if mt > 5000:
        mt = 5000
    inf = bool(allow_infinite_mode)

    model_norm = (_safe_text(ai_model) or "gemini").lower()
    if model_norm not in ("gemini", "claude", "gpt"):
        model_norm = "gemini"
    model: AIModel = model_norm  # type: ignore[assignment]

    user_prompt = f"""
[프로필 입력(근거)]
- 이름: {base_name}
- 소개: {base_desc}
- 태그: {tags_block or "없음"}

[출력 요구사항]
- 위 SYSTEM 가이드/템플릿을 따라 '시뮬레이션 캐릭터 시트'를 작성하라.
- 반드시 한국어로 작성하라.
- 출력은 JSON/코드블록 금지. 순수 텍스트(마크다운 섹션/불릿 허용).
    - 3000~6000자(공백 포함) 사이로 작성하라. 너무 짧으면 서사/능력/플롯/관계/타임라인을 더 확장하라.
- 이름은 입력된 이름을 그대로 사용하라(형식 유지).
- ✅ 추가 필수 지시(게임 설계):
  - 이 캐릭터 챗은 총 **{mt}턴**을 기준으로 진행된다.
  - 이용자가 입력한 프롬프트(세계관/상황)에 맞게 **턴당 사건(갈등/미션/선택)**을 흥미롭고 몰입감 있게 기획하라.
  - 각 사건에는 유저가 체감할 수 있는 **보상(정보/단서/관계 진전/권한/아이템 등)**을 설계하라.
  - 위 설계를 프롬프트 본문에 **[턴 진행/사건 & 보상 설계]** 섹션으로 반드시 포함하라.
  - 무한모드 허용: {"허용" if inf else "미허용"} (정책을 본문에 명시하라).
""".strip()

    prompt = f"{SIMULATOR_PROMPT_SYSTEM}\n\n{user_prompt}"

    # 1차 생성
    out = await get_ai_completion(prompt=prompt, model=model, temperature=0.4, max_tokens=2600)
    out = _ensure_char_len_range(out, min_chars=3000, max_chars=6000)

    # 2차 보정(너무 짧은 경우만 1회 재시도)
    if len(out) < 3000:
        retry = (
            f"{SIMULATOR_PROMPT_SYSTEM}\n\n"
            f"{user_prompt}\n\n"
            "[추가 지시]\n"
            "- 직전 결과가 3000자 미만이다. 각 섹션을 더 상세히 확장하고 사건 트리거/타임라인/보상을 구체적으로 늘려 3500~4500자 사이로 다시 작성하라."
        )
        out2 = await get_ai_completion(prompt=retry, model=model, temperature=0.4, max_tokens=3000)
        out = _ensure_char_len_range(out2, min_chars=3000, max_chars=6000)

    return out


async def generate_quick_roleplay_prompt(
    name: str,
    description: str,
    max_turns: int,
    allow_infinite_mode: bool,
    tags: List[str],
    ai_model: str,
) -> str:
    """
    위저드 '프롬프트' 단계(롤플레잉) 자동 생성.

    요구사항(현재 합의된 UX):
    - 프로필(이름/소개)을 토대로 작성
    - 3000~6000자 사이(데모 안정성/일관성)
    - 출력은 '1:1 RP 캐릭터 시트' 형태(마크다운 섹션)
    """
    base_name = _clip(name, 100)
    base_desc = _clip(description, 3000)
    tags_block = ", ".join([_clip(t, 40) for t in (tags or []) if _safe_text(t)])[:400]
    try:
        mt = int(max_turns or 0)
    except Exception:
        mt = 0
    if mt < 50:
        mt = 200
    if mt > 5000:
        mt = 5000
    inf = bool(allow_infinite_mode)

    model_norm = (_safe_text(ai_model) or "gemini").lower()
    if model_norm not in ("gemini", "claude", "gpt"):
        model_norm = "gemini"
    model: AIModel = model_norm  # type: ignore[assignment]

    user_prompt = f"""
[프로필 입력(근거)]
- 이름: {base_name}
- 소개: {base_desc}
- 태그: {tags_block or "없음"}

[출력 요구사항]
- 위 SYSTEM 가이드/템플릿을 따라 '1:1 롤플레잉 캐릭터 시트'를 작성하라.
- 반드시 한국어로 작성하라.
- 출력은 JSON/코드블록 금지. 순수 텍스트(마크다운 섹션/불릿 허용).
    - 3000~6000자(공백 포함) 사이로 작성하라. 너무 짧으면 외형/과거-현재 대비/결핍/관계 훅/텐션 경로/상징을 더 확장하라.
- 이름은 입력된 이름을 그대로 사용하라(형식 유지).
- ✅ 추가 필수 지시(게임 설계):
  - 이 캐릭터 챗은 총 **{mt}턴**을 기준으로 진행된다.
  - 이용자가 입력한 프롬프트(세계관/상황)에 맞게 **턴당 사건(긴장/갈등/선택)**을 흥미롭고 몰입감 있게 기획하라.
  - 각 사건에는 유저가 체감할 수 있는 **보상(관계 진전/정보/단서/특별한 장면/권한 등)**을 설계하라.
  - 위 설계를 프롬프트 본문에 **[턴 진행/사건 & 보상 설계]** 섹션으로 반드시 포함하라.
  - 무한모드 허용: {"허용" if inf else "미허용"} (정책을 본문에 명시하라).
""".strip()

    prompt = f"{ROLEPLAY_PROMPT_SYSTEM}\n\n{user_prompt}"

    out = await get_ai_completion(prompt=prompt, model=model, temperature=0.4, max_tokens=2600)
    out = _ensure_char_len_range(out, min_chars=3000, max_chars=6000)

    if len(out) < 3000:
        retry = (
            f"{ROLEPLAY_PROMPT_SYSTEM}\n\n"
            f"{user_prompt}\n\n"
            "[추가 지시]\n"
            "- 직전 결과가 3000자 미만이다. 각 섹션을 더 상세히 확장하고, 훅/관계 경로/감각 묘사를 더 촘촘히 넣어 3500~4500자 사이로 다시 작성하라."
        )
        out2 = await get_ai_completion(prompt=retry, model=model, temperature=0.4, max_tokens=3000)
        out = _ensure_char_len_range(out2, min_chars=3000, max_chars=6000)

    return out


async def generate_quick_stat_draft(
    *,
    name: str,
    description: str,
    world_setting: str,
    tags: List[str],
    ai_model: str,
) -> List[dict]:
    """
    스탯 초안 자동 생성(위저드용).

    의도/원리:
    - 프롬프트(world_setting)에 스탯 내용이 포함될 수 있으므로, 프론트의 '스탯 설정' 탭도 함께 자동 입력되어야 한다.
    - prompt 텍스트에서 파싱하는 방식은 취약하므로, 별도의 짧은 JSON 응답을 생성해 구조화된 stats로 반환한다.

    방어적:
    - 모델 출력이 JSON을 깨뜨릴 수 있으므로, JSON 객체만 추출(_extract_json_object) + trailing comma 제거 후 파싱한다.
    - 파싱 실패/검증 실패 시 빈 리스트를 반환한다(프롬프트 생성 자체는 실패시키지 않음).
    """
    import json

    base_name = _clip(name, 100)
    base_desc = _clip(description, 3000)
    ws = _clip(world_setting, 1800)
    tags_block = ", ".join([_clip(t, 40) for t in (tags or []) if _safe_text(t)])[:400]

    model_norm = (_safe_text(ai_model) or "gemini").lower()
    if model_norm not in ("gemini", "claude", "gpt"):
        model_norm = "gemini"
    model: AIModel = model_norm  # type: ignore[assignment]

    system = """당신은 게임/비주얼노벨/미연시 개발자입니다.
아래 입력을 참고해 '스탯 설정' 초안을 JSON으로만 반환하세요.

반드시 지켜야 할 규칙:
- 출력은 JSON 객체 1개만. (설명/코드블록/여분 텍스트 금지)
- 스키마: { "stats": [ ... ] }
- stats는 1~4개. 최대 4개를 넘지 말 것.
- 각 항목 스키마:
  {
    "name": string (1~20자),
    "min_value": int (-99999~99999),
    "max_value": int (-99999~99999),
    "base_value": int (-99999~99999),
    "unit": string (0~10자, 없으면 빈 문자열),
    "description": string (1~500자)
  }
- base_value는 반드시 min_value~max_value 범위 내.
- name은 서로 겹치지 않게.
"""

    user = f"""
[입력]
- 캐릭터 이름: {base_name}
- 캐릭터 소개: {base_desc}
- 태그: {tags_block or "없음"}
- 프롬프트(요약): {ws}

[요구]
- 위 설정에 자연스럽게 어울리는 스탯을 1~4개 제안하라.
- 대부분의 시뮬레이션에서 기본이 되는 '호감도' 1개는 포함해도 좋다(상황에 안 맞으면 제외 가능).
""".strip()

    try:
        raw = await get_ai_completion(prompt=f"{system}\n\n{user}", model=model, temperature=0.3, max_tokens=900)
        blob = _extract_json_object(raw)
        if not blob:
            return []
        blob = _fix_trailing_commas(blob)
        data = json.loads(blob) if blob else {}
        stats = data.get("stats", [])
        if not isinstance(stats, list):
            return []

        out: List[dict] = []
        seen = set()
        for st in stats[:4]:
            if not isinstance(st, dict):
                continue
            name2 = _clip(st.get("name", ""), 20).strip()
            if not name2 or name2 in seen:
                continue
            seen.add(name2)
            try:
                mn = int(st.get("min_value", 0))
                mx = int(st.get("max_value", 0))
                bv = int(st.get("base_value", 0))
            except Exception:
                continue
            # 범위 보정(방어)
            mn = max(-99999, min(99999, mn))
            mx = max(-99999, min(99999, mx))
            if mx < mn:
                mn, mx = mx, mn
            bv = max(mn, min(mx, max(-99999, min(99999, bv))))
            unit = _clip(st.get("unit", "") or "", 10)
            desc2 = _clip(st.get("description", ""), 500).strip()
            if not desc2:
                continue
            out.append(
                {
                    "name": name2,
                    "min_value": mn,
                    "max_value": mx,
                    "base_value": bv,
                    "unit": unit,
                    "description": desc2,
                }
            )
        return out[:4]
    except Exception:
        return []


FIRST_START_GENERATOR_SYSTEM = """# [FIRST_MESSAGE_GENERATOR_LOGIC]
1. **현재 진행형(In-Media-Res)**: "안녕?" 같은 인사 대신, 이미 사건이 벌어지고 있는 한복판의 장면을 묘사하라.
2. **감각적 디테일**: 주변의 온도, 조명, 캐릭터의 향기, 그리고 유저를 바라보는 눈빛의 '색깔'을 포함하라.
3. **유저에게 던지는 질문/행동**: 지문의 마지막은 반드시 유저가 즉각적으로 대답하거나 행동할 수밖에 없는 도발적인 멘트로 끝내라.
"""


def _extract_json_object(text: str) -> str:
    """
    LLM 응답에서 JSON 객체({ ... })만 추출한다.

    의도:
    - 모델이 앞뒤에 설명을 붙여도 파싱이 깨지지 않도록 방어한다.
    """
    s = _safe_text(text)
    if not s:
        return ""
    try:
        if "```json" in s:
            s = s.split("```json", 1)[1].split("```", 1)[0].strip()
        elif "```" in s:
            s = s.split("```", 1)[1].split("```", 1)[0].strip()
    except Exception:
        pass
    try:
        i = s.find("{")
        j = s.rfind("}")
        if i >= 0 and j > i:
            return s[i : j + 1]
    except Exception:
        pass
    return ""


def _fix_trailing_commas(text: str) -> str:
    """trailing comma 제거: {...,} / [...,] → {...} / [...]"""
    try:
        import re
        return re.sub(r",\s*([}\]])", r"\1", _safe_text(text))
    except Exception:
        return _safe_text(text)


def _ensure_first_start_len(intro: str, first_line: str) -> tuple[str, str]:
    """
    첫시작 결과 길이를 강제한다(공백 포함).

    요구사항:
    - 도입부(intro): 300~500자
    - 첫대사(first_line): 10~50자 (인사말 금지)
    """
    i = _safe_text(intro).strip()
    f = _safe_text(first_line).strip()

    # 최소 안전값
    if not i:
        i = (
            "등 뒤에서 문이 잠기는 소리가 났다. 조명이 희미하게 깜박이고, 공기엔 따뜻한 향이 옅게 감돌았다. "
            "숨을 고를 틈도 없이 상황이 굴러가고, 나는 네 시선을 놓치지 않으려 천천히 다가섰다."
        )
    if not f:
        f = "지금, 내 손을 잡을 거야?"

    # 기본 정리(따옴표 과다 제거)
    try:
        f = f.strip().strip('"').strip("“”")
    except Exception:
        pass

    # 줄바꿈/공백 정리(프리뷰 UX 안정)
    try:
        i = " ".join(i.replace("\r", " ").replace("\n", " ").split()).strip()
        f = " ".join(f.replace("\r", " ").replace("\n", " ").split()).strip()
    except Exception:
        pass

    def _trim_to_boundary(s: str, max_chars: int) -> str:
        """
        문장 중간 절단을 최대한 피하면서 max_chars 이내로 자른다.

        우선순위:
        1) 문장부호 경계(., !, ?, …, 。)
        2) 공백 경계
        3) 최후: 하드 컷
        """
        s = _safe_text(s)
        if not s:
            return ""
        if len(s) <= max_chars:
            return s.strip()
        cut = s[:max_chars].strip()
        # 문장 경계 우선(너무 앞에서 자르면 오히려 어색하므로 60% 이후만)
        try:
            start = int(max_chars * 0.6)
            for sep in ("…", "!", "?", ".", "。"):
                idx = cut.rfind(sep)
                if idx >= start:
                    return cut[: idx + len(sep)].strip()
        except Exception:
            pass
        # 공백 경계(단어 단위라도 유지)
        try:
            start = int(max_chars * 0.6)
            idx = cut.rfind(" ")
            if idx >= start:
                return cut[:idx].strip()
        except Exception:
            pass
        return cut.strip()

    # first_line: 10~50자 강제
    if len(f) > 50:
        f = _trim_to_boundary(f, 50)
    if len(f) < 10:
        addon_f = " 대답해."
        if len((f + addon_f).strip()) <= 50:
            f = (f + addon_f).strip()
        if len(f) < 10:
            f = "지금 선택해. 나와 함께해."
    f = _trim_to_boundary(f, 50) or "지금, 내 손을 잡을 거야?"

    # intro: 300~500자 강제
    if len(i) > 500:
        i = _trim_to_boundary(i, 500)
    if len(i) < 300:
        addon = (
            " 조명은 차갑게 번지고, 너를 바라보는 내 눈빛은 짙은 남색으로 가라앉아 있었다."
            " 한 걸음만 더 가면 모든 게 달라질 것 같았다."
        )
        i2 = (i + addon).strip()
        if len(i2) < 300:
            i2 = (i2 + " 피부에 닿는 온도까지 또렷하게 느껴질 만큼, 거리가 너무 가까웠다.").strip()
        i = i2
    i = _trim_to_boundary(i, 500)
    if len(i) < 300:
        i = (i + " 숨을 삼키는 순간, 선택을 재촉하는 기척이 등을 떠밀었다.").strip()[:500]

    return i, f


def _is_first_start_in_range(intro: str, first_line: str) -> bool:
    """첫시작 길이 요구사항 충족 여부."""
    try:
        i = _safe_text(intro).strip()
        f = _safe_text(first_line).strip()
        return (300 <= len(i) <= 500) and (10 <= len(f) <= 50)
    except Exception:
        return False


async def generate_quick_first_start(name: str, description: str, world_setting: str, tags: List[str], ai_model: str) -> tuple[str, str]:
    """
    위저드 '첫시작(도입부+첫대사)' 자동 생성.

    요구사항:
    - 프롬프트(world_setting)가 작성되어 있어야 한다.
    - 도입부(intro): 300~500자
    - 첫대사(first_line): 10~50자
    """
    base_name = _clip(name, 100)
    base_desc = _clip(description, 3000)
    base_world = _clip(world_setting, 5000)
    tags_block = ", ".join([_clip(t, 40) for t in (tags or []) if _safe_text(t)])[:400]

    model_norm = (_safe_text(ai_model) or "gemini").lower()
    if model_norm not in ("gemini", "claude", "gpt"):
        model_norm = "gemini"
    model: AIModel = model_norm  # type: ignore[assignment]

    nonce = uuid.uuid4().hex[:8]
    prompt = f"""
너는 1:1 캐릭터 챗의 "첫 시작(도입부+첫대사)"를 만드는 전문가다.

{FIRST_START_GENERATOR_SYSTEM}

[캐릭터 정보(근거)]
- 이름: {base_name}
- 소개: {base_desc}
- 프롬프트(world_setting): {base_world}
- 태그: {tags_block or "없음"}
- 랜덤 시드: {nonce}

[출력 규칙]
- 반드시 JSON만 출력해라(다른 텍스트/마크다운 금지).
- 키는 intro, first_line 두 개만 사용한다.
- intro는 "서술형 지문"으로 작성하고, 사건 한복판에서 시작해야 한다.
- first_line은 캐릭터가 말하는 첫대사로 작성하라(인사말 금지).
- intro는 300~500자(공백 포함)로 작성하라.
- first_line은 10~50자(공백 포함)로 작성하라.

[JSON 예시]
{{"intro":"(서술형 지문)","first_line":"(첫대사)"}}
""".strip()

    def _parse_first_start(raw_text: str) -> tuple[str, str]:
        obj = _extract_json_object(raw_text)
        obj = _fix_trailing_commas(obj)
        intro0 = ""
        first0 = ""
        try:
            data = json.loads(obj) if obj else {}
            if isinstance(data, dict):
                intro0 = _safe_text(data.get("intro")).strip()
                first0 = _safe_text(data.get("first_line")).strip()
        except Exception as e:
            try:
                logger.warning(f"[first_start] json parse failed, fallback: {e}")
            except Exception:
                pass
        return intro0, first0

    # 1차 생성
    raw = await get_ai_completion(prompt=prompt, model=model, temperature=0.6, max_tokens=900)
    intro, first_line = _parse_first_start(raw)

    # 2차 보정: 길이 조건이 크게 어긋나면 1회 재생성(문장 중간 절단 최소화 목적)
    if not _is_first_start_in_range(intro, first_line):
        retry = (
            f"{prompt}\n\n"
            "[추가 지시]\n"
            "- intro는 300~500자를 반드시 만족하라. 문장 끝은 마침표/물음표/느낌표로 끝내라.\n"
            "- first_line은 10~50자를 반드시 만족하라. 한 문장으로 끝내고, 인사말은 금지.\n"
            "- JSON 외 텍스트를 절대 출력하지 마라."
        )
        raw2 = await get_ai_completion(prompt=retry, model=model, temperature=0.5, max_tokens=700)
        intro2, first2 = _parse_first_start(raw2)
        # 더 나은 결과만 채택
        if (len(_safe_text(intro2).strip()) > 0) and (len(_safe_text(first2).strip()) > 0):
            intro, first_line = intro2, first2

    # 최종 방어 보정(범위 강제 + 문장 중간 절단 최소화)
    intro, first_line = _ensure_first_start_len(intro, first_line)
    return intro, first_line


DETAIL_GENERATOR_SYSTEM = """너는 캐릭터 챗 서비스의 '디테일(성격/말투/취향 키워드)'를 만드는 전문가다.

규칙:
- 반드시 JSON 객체만 출력하라(다른 텍스트/마크다운/코드블록 금지).
- personality(성격)과 speech_style(말투)는 각각 100~300자(공백 포함)로 작성하라. 줄바꿈 없이 1개 문단으로 작성하라.
- interests/likes/dislikes는 반드시 '키워드 3개'씩, 문장 금지(단어/짧은 구만).
- 중복 금지, 쉼표/줄바꿈 포함 금지, 각 키워드는 2~12자 권장.
"""


def _ensure_short_len_range(text: Any, min_chars: int, max_chars: int, fallback_tail: str) -> str:
    """
    짧은 텍스트(디테일) 길이를 100~300자 같은 범위로 강제한다.

    의도:
    - LLM 결과가 너무 길거나 짧아도, UI/프리뷰가 깔끔하게 유지되도록 방어한다.
    """
    s = _safe_text(text)
    # 줄바꿈 제거 + 공백 정리(프리뷰/입력 UX 안정)
    s = " ".join(s.replace("\r", " ").replace("\n", " ").split()).strip()
    if not s:
        s = ""

    if len(s) > max_chars:
        cut = s[:max_chars]
        # 문장부호 경계에서 가능한 한 자연스럽게 자르기
        for sep in ("…", ".", "!", "?", "。"):
            idx = cut.rfind(sep)
            if idx >= int(max_chars * 0.7):
                cut = cut[: idx + len(sep)]
                break
        return cut.strip()

    if len(s) < min_chars:
        tail = " ".join(_safe_text(fallback_tail).split()).strip()
        if tail:
            s2 = (s + " " + tail).strip()
        else:
            s2 = s
        # 그래도 부족하면 한 문장 더 보강(최대 길이 내)
        if len(s2) < min_chars:
            s2 = (s2 + " " + "유저의 말과 선택에 즉각 반응하며, 대화의 흐름을 자연스럽게 이끈다.").strip()
        return s2[:max_chars].strip()

    return s.strip()


def _clean_keyword_list(v: Any, want: int = 3) -> List[str]:
    """키워드 배열을 3개로 정규화한다."""
    out: List[str] = []
    try:
        if isinstance(v, str):
            parts = [p.strip() for p in v.replace("\r", "\n").split("\n") if p.strip()]
            if len(parts) <= 1:
                parts = [p.strip() for p in v.split(",") if p.strip()]
            v = parts
        if not isinstance(v, list):
            v = []
    except Exception:
        v = []

    for item in v:
        t = _safe_text(item).strip()
        if not t:
            continue
        # 구분자/줄바꿈 방지
        for bad in ("\n", "\r", ",", "|", "/", "\\"):
            if bad in t:
                t = t.replace(bad, " ")
        t = " ".join(t.split()).strip()
        if not t:
            continue
        if t not in out:
            out.append(t[:20])
        if len(out) >= want:
            break

    # 부족하면 안전 기본값으로 채움(데모 안정성)
    defaults = ["비밀", "집중", "관찰", "커피", "새벽", "정리", "무례함", "강요", "소음"]
    i = 0
    while len(out) < want and i < len(defaults):
        if defaults[i] not in out:
            out.append(defaults[i])
        i += 1
    return out[:want]


async def generate_quick_detail(name: str, description: str, world_setting: str, tags: List[str], ai_model: str) -> Dict[str, Any]:
    """
    위저드 '디테일' 자동 생성.

    요구사항:
    - 프롬프트(world_setting) 필수
    - 관심사/좋아하는 것/싫어하는 것: 키워드 3개씩(칩)
    - 성격/말투도 함께 생성
    """
    base_name = _clip(name, 100)
    base_desc = _clip(description, 3000)
    base_world = _clip(world_setting, 5000)
    tags_block = ", ".join([_clip(t, 40) for t in (tags or []) if _safe_text(t)])[:400]

    model_norm = (_safe_text(ai_model) or "gemini").lower()
    if model_norm not in ("gemini", "claude", "gpt"):
        model_norm = "gemini"
    model: AIModel = model_norm  # type: ignore[assignment]

    nonce = uuid.uuid4().hex[:8]
    prompt = f"""
{DETAIL_GENERATOR_SYSTEM}

[근거]
- 이름: {base_name}
- 소개: {base_desc}
- 프롬프트(world_setting): {base_world}
- 태그: {tags_block or "없음"}
- 랜덤 시드: {nonce}

[출력 JSON 스키마]
{{
  "personality": "성격 및 특징(100~300자, 줄바꿈 없이 1문단)",
  "speech_style": "말투(100~300자, 줄바꿈 없이 1문단)",
  "interests": ["키워드1", "키워드2", "키워드3"],
  "likes": ["키워드1", "키워드2", "키워드3"],
  "dislikes": ["키워드1", "키워드2", "키워드3"]
}}
""".strip()

    raw = await get_ai_completion(prompt=prompt, model=model, temperature=0.5, max_tokens=1200)
    obj = _extract_json_object(raw)
    obj = _fix_trailing_commas(obj)

    data: Dict[str, Any] = {}
    try:
        data = json.loads(obj) if obj else {}
        if not isinstance(data, dict):
            data = {}
    except Exception as e:
        try:
            logger.warning(f"[quick_detail] json parse failed, fallback: {e}")
        except Exception:
            pass
        data = {}

    personality = _clip(data.get("personality"), 2000).strip()
    speech_style = _clip(data.get("speech_style"), 2000).strip()
    interests = _clean_keyword_list(data.get("interests"), want=3)
    likes = _clean_keyword_list(data.get("likes"), want=3)
    dislikes = _clean_keyword_list(data.get("dislikes"), want=3)

    if not personality:
        personality = (
            f"{base_name}는(은) 침착하고 현실적인 판단을 하며, 상대의 감정을 빠르게 읽는다. "
            "겉으로는 단정하지만 유저 앞에서는 솔직해지고, 필요할 때는 단호하게 선을 긋는다."
        )
    if not speech_style:
        speech_style = (
            "짧고 또렷한 문장으로 말한다. 핵심 단어를 반복해 상대를 집중시키며, "
            "감정이 깊어질수록 말끝이 낮아지고 속도가 느려진다."
        )

    # ✅ 요구사항: 성격/말투는 각각 100~300자 미만으로 강제
    personality = _ensure_short_len_range(
        personality,
        min_chars=100,
        max_chars=300,
        fallback_tail=f"{base_name}는(은) 유저에게만 숨은 감정을 드러내며, 상황을 빠르게 정리해준다.",
    )
    speech_style = _ensure_short_len_range(
        speech_style,
        min_chars=100,
        max_chars=300,
        fallback_tail="존댓말과 반말을 상황에 맞게 조절하며, 상대가 흔들릴 때는 단호하게 방향을 잡아준다.",
    )

    return {
        "personality": _clip(personality, 300),
        "speech_style": _clip(speech_style, 300),
        "interests": interests,
        "likes": likes,
        "dislikes": dislikes,
    }


SECRET_GENERATOR_SYSTEM = """### [SYSTEM_PROMPT_START]
# Role: 전문 인터랙티브 시나리오 디렉터 (비밀 설정 설계)
#
# Task:
# - 유저에게는 절대 직접 노출되면 안 되는 '비밀정보(secret)'를 생성한다.
# - 이 비밀은 캐릭터의 행동/동기/금기/약점/숨겨진 관계/진짜 목적을 강화하여, 프롬프트 품질을 높인다.
#
# Constraints:
# - 200~600자 정도(한국어 기준), 과장/중2병 금지, 구체적이되 과도한 설정 과다 금지
# - "유저에게 공개 금지" 성격이 명확해야 한다(예: 거짓 신분, 금기, 숨은 약점, 은폐된 사건)
# - 1문단 텍스트로 출력(불릿/번호 없이), 불필요한 메타 설명 금지
#
# Output:
# - 텍스트만 출력한다. 따옴표/코드블록/JSON 금지.
### [SYSTEM_PROMPT_END]"""

ENDING_EPILOGUE_GENERATOR_SYSTEM = """### [SYSTEM_PROMPT_START]
# Role: 인터랙티브 시나리오 작가 (엔딩 에필로그 작성)
#
# Task:
# - 주어진 캐릭터/프롬프트/오프닝/엔딩 조건을 바탕으로, 엔딩 연출(에필로그)을 작성한다.
#
# Output rules (중요):
# - 텍스트만 출력한다. (JSON/코드블록/마크다운 헤딩/불릿/번호 매기기 금지)
# - 200~900자 정도를 목표로 하며, 최대 1000자를 넘지 않는다.
# - "지문(서술)"과 "대사"가 섞여야 한다.
#   - 대사는 반드시 따옴표로 시작해야 한다. (예: "…")
#   - 지문은 문장으로 자연스럽게 작성한다. (선행 '* ' 같은 기호는 붙이지 말 것)
# - 메타/규칙 설명 금지. '엔딩입니다' 같은 설명 문구 금지.
#
# Tone:
# - 감정선이 분명하고, 마무리감이 있어야 한다.
# - 과도한 장황함/설정 과잉 금지.
### [SYSTEM_PROMPT_END]"""

ENDING_DRAFT_GENERATOR_SYSTEM = """### [SYSTEM_PROMPT_START]
# Role: 인터랙티브 시나리오 기획자 (엔딩 제목/기본조건 설계)
#
# Task:
# - 주어진 캐릭터/프롬프트/오프닝을 바탕으로, 엔딩 1개의 "제목/기본조건/힌트/추천 턴"을 설계한다.
#
# Output rules (중요):
# - 아래 JSON 객체만 출력한다. (설명/코드블록/추가 텍스트 금지)
# - 키는 반드시 아래 4개만 사용한다: title, base_condition, hint, suggested_turn
# - title: 1~20자
# - base_condition: 1~500자 (판정 근거가 되도록 요약/조건을 포함)
# - hint: 0~20자 (없으면 빈 문자열)
# - suggested_turn: 숫자 (min_turns~max_turns 사이 권장. 불가하면 0)
# - JSON 규칙: 코드펜스 금지, 주석 금지, 작은따옴표 금지, trailing comma 금지
#
# Tone:
# - 너무 메타/설명적 문장 금지, 실제 게임/스토리처럼 자연스럽고 명확하게.
### [SYSTEM_PROMPT_END]"""


TURN_EVENTS_GENERATOR_SYSTEM = """### [SYSTEM_PROMPT_START]
# Role: 인터랙티브 시나리오 디렉터 (턴수별 사건 플래너)
#
# Task:
# - 주어진 캐릭터/프롬프트/오프닝을 바탕으로, "턴수별 사건" 카드들을 작성한다.
# - 사건은 '자극적/몰입감' 있게, 특히 초반부(초반 턴)에서 빈도가 높게 설계한다.
#
# Inputs:
# - total_turns: 총 진행 턴수
# - planned_turns: 사건이 발생할 약 턴수 리스트(중복 없음, 1~total_turns)
#
# Output rules:
# - 아래 JSON 배열만 출력한다. (설명/코드블록/추가 텍스트 금지)
# - 배열 길이는 planned_turns 길이와 동일해야 한다.
# - 각 항목은 planned_turns에 대응하는 about_turn 값을 그대로 사용한다.
#
# Field rules:
# - title: 30자 이하(비워도 됨)
# - summary: 200자 이하
# - required_narration: 1000자 이하. 선행 "* " 금지(런타임에서 붙임). 따옴표로 감싸지 말 것.
# - required_dialogue: 500자 이하. 선행/후행 따옴표 금지(런타임에서 감쌈).
### [SYSTEM_PROMPT_END]"""


def _compute_turn_event_cap(max_turns: int) -> int:
    """
    총 진행 턴수에 따른 "턴수별 사건" 최대 개수 상한을 계산한다.

    요구사항(확정):
    - 50턴  : 최대 3개
    - 100턴 : 최대 6개
    - 200턴 : 최대 10개
    - 300턴 : 최대 15개
    - 커스텀: 입력 턴수 기반으로 판단
      - 300턴 초과: 최대 20개
      - 50턴 미만: 최대 3개(단, 실제 입력은 50 이상을 강제)
    """
    try:
        mt = int(max_turns)
    except Exception:
        mt = 200
    if mt <= 50:
        return 3
    if mt <= 100:
        return 6
    if mt <= 200:
        return 10
    if mt <= 300:
        return 15
    return 20


def _build_early_dense_turn_plan(total_turns: int, count: int) -> List[int]:
    """
    사건 턴 계획(planned_turns)을 '초반 밀도 높게' 생성한다.

    원리(운영 안정/KISS):
    - LLM이 about_turn를 직접 뽑게 하면 중복/범위 오류가 자주 발생한다.
    - 따라서 턴 숫자는 서버가 결정(SSOT)하고, LLM은 "내용만" 채운다.
    """
    try:
        total = int(total_turns)
    except Exception:
        total = 200
    total = max(1, total)
    n = max(1, int(count or 0))

    # 초반 자극 강화: 전체 사건의 50%를 초반 25% 구간에 배치
    early_n = max(1, int(round(n * 0.5)))
    mid_n = max(0, int(round(n * 0.35)))
    late_n = max(0, n - early_n - mid_n)

    def _spread(lo: int, hi: int, k: int) -> List[int]:
        if k <= 0:
            return []
        lo2 = max(1, int(lo))
        hi2 = max(lo2, int(hi))
        span = max(1, hi2 - lo2)
        # 균등 분배 + 약간의 지터(고정), 중복은 후처리에서 제거
        out: List[int] = []
        for i in range(k):
            pos = lo2 + int(round((span * (i + 1)) / (k + 1)))
            out.append(pos)
        return out

    early_hi = max(1, int(round(total * 0.25)))
    mid_lo = early_hi + 1
    mid_hi = max(mid_lo, int(round(total * 0.7)))
    late_lo = mid_hi + 1
    late_hi = total

    planned = []
    planned.extend(_spread(1, early_hi, early_n))
    planned.extend(_spread(mid_lo, mid_hi, mid_n))
    planned.extend(_spread(late_lo, late_hi, late_n))

    # 중복 제거 + 범위 보정 + 충돌 시 가까운 빈 턴으로 이동(±1 스캔)
    uniq: List[int] = []
    used = set()
    for t in planned:
        v = int(t)
        v = max(1, min(total, v))
        if v not in used:
            used.add(v)
            uniq.append(v)
            continue
        # 근처 빈 턴 탐색
        placed = False
        for d in range(1, 25):
            for cand in (v - d, v + d):
                if cand < 1 or cand > total:
                    continue
                if cand in used:
                    continue
                used.add(cand)
                uniq.append(cand)
                placed = True
                break
            if placed:
                break

    uniq = sorted(uniq)[:n]
    # 부족하면 뒤에서 채움(최대 total)
    if len(uniq) < n:
        for cand in range(total, 0, -1):
            if cand not in used:
                uniq.append(cand)
                used.add(cand)
            if len(uniq) >= n:
                break
        uniq = sorted(uniq)[:n]
    return uniq


def _extract_json_array(text: str) -> str:
    """LLM 응답에서 JSON 배열([ ... ])만 추출한다(방어)."""
    s = _safe_text(text)
    if not s:
        return ""
    try:
        if "```json" in s:
            s = s.split("```json", 1)[1].split("```", 1)[0].strip()
        elif "```" in s:
            s = s.split("```", 1)[1].split("```", 1)[0].strip()
    except Exception:
        pass
    try:
        i = s.find("[")
        j = s.rfind("]")
        if i >= 0 and j > i:
            return s[i : j + 1]
    except Exception:
        pass
    return ""


async def generate_quick_turn_events(
    *,
    name: str,
    description: str,
    world_setting: str,
    opening_intro: str,
    opening_first_line: str,
    max_turns: int,
    tags: List[str],
    ai_model: str,
) -> List[Dict[str, Any]]:
    """
    위저드(일반 캐릭터) '턴수별 사건' 자동 생성.

    요구사항(핵심):
    - 50/100/200/300/커스텀(max_turns) 기반으로 사건 개수 상한을 강제한다.
    - 초반부 사건 빈도를 높여 몰입감을 강화한다.
    - about_turn 중복/범위 오류는 서버가 방어적으로 보정한다.
    """
    base_name = _clip(name, 100)
    base_desc = _clip(description, 3000)
    base_world = _clip(world_setting, 6000)
    base_intro = _clip(opening_intro, 2000)
    base_first = _clip(opening_first_line, 500)
    tags_block = ", ".join([_clip(t, 40) for t in (tags or []) if _safe_text(t)])[:400]

    model_norm = (_safe_text(ai_model) or "gemini").lower()
    if model_norm not in ("gemini", "claude", "gpt"):
        model_norm = "gemini"
    model: AIModel = model_norm  # type: ignore[assignment]

    mt_raw = int(max_turns or 200)
    mt = max(50, min(5000, mt_raw))
    cap = _compute_turn_event_cap(mt)
    planned_turns = _build_early_dense_turn_plan(mt, cap)

    # LLM에는 "턴 숫자"를 고정으로 주고 내용만 작성시키기(중복/범위 리스크 제거)
    prompt = f"""
{TURN_EVENTS_GENERATOR_SYSTEM}

[근거]
- 이름: {base_name}
- 소개: {base_desc}
- 프롬프트(world_setting): {base_world}
- 오프닝 도입부(intro): {base_intro}
- 오프닝 첫 대사(firstLine): {base_first}
- 태그: {tags_block or "없음"}

[입력]
total_turns: {mt}
planned_turns: {planned_turns}

[출력 JSON 스키마(배열)]
[
  {{
    "about_turn": 12,
    "title": "사건명(선택)",
    "summary": "발생사건(요약)",
    "required_narration": "반드시 들어가야 하는 지문",
    "required_dialogue": "반드시 들어가야 하는 대사"
  }}
]
""".strip()

    raw = await get_ai_completion(prompt=prompt, model=model, temperature=0.6, max_tokens=1800)
    arr_txt = _extract_json_array(raw)
    arr_txt = _fix_trailing_commas(arr_txt)

    parsed: List[Dict[str, Any]] = []
    try:
        data = json.loads(arr_txt) if arr_txt else []
        if isinstance(data, list):
            parsed = [x for x in data if isinstance(x, dict)]
    except Exception as e:
        try:
            logger.warning(f"[quick_turn_events] json parse failed, fallback: {e}")
        except Exception:
            pass
        parsed = []

    # 내용 매핑 + 방어적 폴백(길이/타입/누락)
    def _clean_text(v: Any, mx: int) -> str:
        s = _clip(v, mx).strip()
        # 불필요한 래핑 제거(따옴표/백틱)
        try:
            s = s.strip().strip("`").strip()
            if s.startswith('"') and s.endswith('"') and len(s) >= 2:
                s = s[1:-1].strip()
        except Exception:
            pass
        return s

    out: List[Dict[str, Any]] = []
    used_turns = set()
    for i, t in enumerate(planned_turns):
        src = parsed[i] if i < len(parsed) else {}
        about_turn = int(t)
        if about_turn < 1:
            about_turn = 1
        if about_turn > mt:
            about_turn = mt
        # 방어: 중복 턴은 근처 이동
        if about_turn in used_turns:
            placed = False
            for d in range(1, 25):
                for cand in (about_turn - d, about_turn + d):
                    if cand < 1 or cand > mt:
                        continue
                    if cand in used_turns:
                        continue
                    about_turn = cand
                    placed = True
                    break
                if placed:
                    break
        used_turns.add(about_turn)

        title = _clean_text(src.get("title"), 30)
        summary = _clean_text(src.get("summary"), 200)
        req_n = _clean_text(src.get("required_narration"), 1000)
        req_d = _clean_text(src.get("required_dialogue"), 500)

        if not summary:
            summary = "예상치 못한 변수로 관계와 목표가 흔들리는 사건이 발생한다."
        if not req_n:
            req_n = "분위기가 급변한다. 숨겨진 정보가 드러나며, 선택이 필요한 순간이 찾아온다."
        if not req_d:
            req_d = "지금 선택해. 너는 어떤 쪽이야?"

        # 요구사항: 런타임에서 '* ' / 따옴표 래핑을 하므로, 선행 기호를 제거한다.
        try:
            if req_n.lstrip().startswith("*"):
                req_n = req_n.lstrip().lstrip("*").strip()
            req_d = req_d.strip().strip('"').strip("“”")
        except Exception:
            pass

        out.append(
            {
                "id": f"ev_{uuid.uuid4().hex[:10]}",
                "title": title,
                "about_turn": about_turn,
                "summary": summary,
                "required_narration": req_n,
                "required_dialogue": req_d,
            }
        )

    # 최종 정렬 + 상한
    try:
        out = sorted(out, key=lambda x: int(x.get("about_turn") or 0))
    except Exception:
        pass
    return out[:cap]


async def generate_quick_secret_info(name: str, description: str, world_setting: str, tags: List[str], ai_model: str) -> str:
    """
    위저드 '비밀정보(secret)' 자동 생성.

    요구사항:
    - 프롬프트(world_setting) 입력 이후에만 생성이 가능해야 한다.
    - 유저에게는 노출되면 안 되는 설정을 200~600자 수준으로 생성한다.
    """
    base_name = _clip(name, 100)
    base_desc = _clip(description, 3000)
    base_world = _clip(world_setting, 5000)
    tags_block = ", ".join([_clip(t, 40) for t in (tags or []) if _safe_text(t)])[:400]

    model_norm = (_safe_text(ai_model) or "gemini").lower()
    if model_norm not in ("gemini", "claude", "gpt"):
        model_norm = "gemini"
    model: AIModel = model_norm  # type: ignore[assignment]

    nonce = uuid.uuid4().hex[:8]
    prompt = f"""
{SECRET_GENERATOR_SYSTEM}

[근거]
- 이름: {base_name}
- 소개: {base_desc}
- 프롬프트(world_setting): {base_world}
- 태그: {tags_block or "없음"}
- 랜덤 시드: {nonce}
""".strip()

    raw = await get_ai_completion(prompt=prompt, model=model, temperature=0.5, max_tokens=800)
    secret = _clip(raw, 1000).strip()
    # 방어: 코드블록/따옴표 등 불필요한 래핑 제거
    try:
        secret = secret.strip().strip("`").strip()
        if secret.startswith('"') and secret.endswith('"') and len(secret) >= 2:
            secret = secret[1:-1].strip()
    except Exception:
        pass

    if not secret:
        # 데모/운영 안정 폴백
        secret = (
            f"{base_name}는(은) 연구소 내부의 사고와 연관된 핵심 단서를 숨기고 있다. "
            "겉으로는 침착하지만, 특정 키워드나 인물 이름이 나오면 대화를 즉시 돌리며 감정을 억누른다. "
            "이 비밀이 드러나면 {character}의 신분과 목적이 무너질 수 있어, 유저에게는 끝까지 공개하지 않는다."
        ).replace("{character}", base_name or "캐릭터")

    # 200~600자 정도로 강제(너무 짧으면 보강, 너무 길면 컷)
    secret = _ensure_short_len_range(
        secret,
        min_chars=200,
        max_chars=600,
        fallback_tail=f"{base_name}는(은) 결정적인 사실을 숨기고 있어, 유저에게는 쉽게 털어놓지 않는다.",
    )
    return _clip(secret, 1000)


async def generate_quick_ending_epilogue(
    *,
    name: str,
    description: str,
    world_setting: str,
    opening_intro: str,
    opening_first_line: str,
    ending_title: str,
    base_condition: str,
    hint: str,
    extra_conditions: List[Dict[str, Any]] | None,
    tags: List[str],
    ai_model: str,
) -> str:
    """
    위저드 '엔딩 내용(에필로그)' 자동 생성.

    의도/원리(운영 안정):
    - SSOT는 start_sets.items[].ending_settings.endings[].epilogue 이며,
      여기서는 "초안 텍스트"만 생성한다(DB 저장 X).
    - 프론트 UI는 1000자 제한이 있으므로, 백엔드에서도 길이를 방어적으로 강제한다.
    - 프론트의 지문/대사 분리 렌더(parseAssistantBlocks)는 "따옴표로 시작하는 대사 줄"을 인식한다.
      따라서 출력에 따옴표 대사가 반드시 포함되도록 유도한다.
    """
    base_name = _clip(name, 100)
    base_desc = _clip(description, 3000)
    base_world = _clip(world_setting, 5000)
    base_intro = _clip(opening_intro, 1200)
    base_first = _clip(opening_first_line, 300)
    base_title = _clip(ending_title, 20)
    base_cond = _clip(base_condition, 500)
    base_hint = _clip(hint, 20)
    tags_block = ", ".join([_clip(t, 40) for t in (tags or []) if _safe_text(t)])[:400]

    # extra_conditions 요약(방어적): 모델에 과도한 구조를 넘기지 않고 텍스트로만 힌트 제공
    extra_lines: List[str] = []
    try:
        arr = extra_conditions if isinstance(extra_conditions, list) else []
        for c in arr[:7]:
            if not isinstance(c, dict):
                continue
            ctype = _safe_text(c.get("type") or "").strip().lower()
            if ctype == "stat":
                sid = _safe_text(c.get("stat_id") or "")
                sname = _safe_text(c.get("stat_name") or "")
                op = _safe_text(c.get("op") or "gte")
                val = _safe_text(c.get("value") or "")
                label = sname or sid
                if label and val:
                    extra_lines.append(f"- 스탯 조건: {label} {op} {val}")
            else:
                txt = _safe_text(c.get("text") or "")
                if txt:
                    extra_lines.append(f"- 세부 조건: {txt[:80]}")
    except Exception:
        extra_lines = []

    model_norm = (_safe_text(ai_model) or "gemini").lower()
    if model_norm not in ("gemini", "claude", "gpt"):
        model_norm = "gemini"
    model: AIModel = model_norm  # type: ignore[assignment]

    nonce = uuid.uuid4().hex[:8]
    prompt = f"""
{ENDING_EPILOGUE_GENERATOR_SYSTEM}

[근거]
- 이름: {base_name}
- 소개: {base_desc}
- 프롬프트(world_setting): {base_world}
- 오프닝(첫 상황): {base_intro or "없음"}
- 오프닝(첫 대사): {base_first or "없음"}
- 엔딩 이름: {base_title}
- 엔딩 기본 조건: {base_cond}
- 엔딩 힌트: {base_hint or "없음"}
- 엔딩 세부 조건(요약): {(chr(10).join(extra_lines) if extra_lines else "없음")}
- 태그: {tags_block or "없음"}
- 랜덤 시드: {nonce}
""".strip()

    raw = await get_ai_completion(prompt=prompt, model=model, temperature=0.6, max_tokens=1200)
    ep = _clip(raw, 1200).strip()
    # 방어: 코드블록/따옴표 래핑 제거
    try:
        ep = ep.replace("```", "").strip()
        ep = ep.strip().strip("`").strip()
        if ep.startswith('"') and ep.endswith('"') and len(ep) >= 2:
            ep = ep[1:-1].strip()
    except Exception:
        pass

    if not ep:
        # 데모/운영 안정 폴백(지문+대사 포함)
        ep = (
            f"{base_name}는(은) 숨을 고르며 마지막 순간을 받아들인다.\n"
            f"\"…이제 끝이구나. 그래도, 너와 여기까지 와서 다행이야.\""
        )

    # 줄 정리: 지문/대사 혼합을 위해, 따옴표 대사가 없으면 1줄 추가
    try:
        lines = [ln.strip() for ln in ep.replace("\r\n", "\n").replace("\r", "\n").split("\n")]
        lines = [ln for ln in lines if ln != ""]
        if not any(ln.startswith('"') or ln.startswith("“") or ln.startswith("「") for ln in lines):
            lines.append("\"…끝까지, 너를 잊지 않을게.\"")
        ep = "\n".join(lines).strip()
    except Exception:
        ep = ep.strip()

    # 200~900자 목표로 보정 + 최종 1000자 제한
    ep = _ensure_short_len_range(
        ep,
        min_chars=200,
        max_chars=900,
        fallback_tail="\"…잘 가.\"",
    )
    return _clip(ep, 1000)


async def generate_quick_ending_draft(
    *,
    name: str,
    description: str,
    world_setting: str,
    opening_intro: str,
    opening_first_line: str,
    max_turns: int,
    min_turns: int,
    tags: List[str],
    ai_model: str,
) -> Dict[str, Any]:
    """
    위저드 '엔딩 제목/기본조건' 자동 생성.

    의도/원리(운영 안정):
    - SSOT는 start_sets.items[].ending_settings.endings[]이며, 여기서는 "초안 데이터"만 생성한다(DB 저장 X).
    - 엔딩 에필로그 생성은 별도 API(quick-generate-ending-epilogue)로 분리되어 있어,
      이 함수는 제목/기본조건/힌트/추천 턴만 책임진다(SRP).
    """
    base_name = _clip(name, 100)
    base_desc = _clip(description, 3000)
    base_world = _clip(world_setting, 5000)
    base_intro = _clip(opening_intro, 1200)
    base_first = _clip(opening_first_line, 300)
    mt = int(max_turns or 200) if isinstance(max_turns, int) or str(max_turns).isdigit() else 200
    mi = int(min_turns or 30) if isinstance(min_turns, int) or str(min_turns).isdigit() else 30
    mt = max(50, min(5000, mt))
    mi = max(10, min(5000, mi))
    if mi > mt:
        mi = mt
    tags_block = ", ".join([_clip(t, 40) for t in (tags or []) if _safe_text(t)])[:400]

    model_norm = (_safe_text(ai_model) or "gemini").lower()
    if model_norm not in ("gemini", "claude", "gpt"):
        model_norm = "gemini"
    model: AIModel = model_norm  # type: ignore[assignment]

    nonce = uuid.uuid4().hex[:8]
    prompt = f"""
{ENDING_DRAFT_GENERATOR_SYSTEM}

[근거]
- 이름: {base_name}
- 소개: {base_desc}
- 프롬프트(world_setting): {base_world}
- 오프닝(첫 상황): {base_intro or "없음"}
- 오프닝(첫 대사): {base_first or "없음"}
- 총 진행 턴수(max_turns): {mt}
- 엔딩 최소 턴수(min_turns): {mi}
- 태그: {tags_block or "없음"}
- 랜덤 시드: {nonce}
""".strip()

    raw = await get_ai_completion(prompt=prompt, model=model, temperature=0.5, max_tokens=800)
    obj = _extract_json_object(raw)
    obj = _fix_trailing_commas(obj)

    data: Dict[str, Any] = {}
    try:
        data = json.loads(obj) if obj else {}
        if not isinstance(data, dict):
            data = {}
    except Exception as e:
        try:
            logger.warning(f"[quick_ending_draft] json parse failed, fallback: {e}")
        except Exception:
            pass
        data = {}

    title = _clip(data.get("title"), 40).strip()
    base_cond = _clip(data.get("base_condition"), 800).strip()
    hint = _clip(data.get("hint"), 40).strip()
    try:
        sug = int(data.get("suggested_turn") or 0)
    except Exception:
        sug = 0

    # 방어: 필수값 폴백
    if not title:
        title = _clip(f"{base_name}의 마지막 선택", 20)
    if not base_cond:
        base_cond = (
            f"{base_name}와(과) 유저가 오프닝에서 시작된 갈등을 끝내고, 선택의 결과를 받아들이면 엔딩이 발생한다."
        )

    # 길이/범위 강제
    title = _clip(title, 20)
    base_cond = _clip(base_cond, 500)
    hint = _clip(hint, 20)
    if sug < mi or sug > mt:
        # 너무 이른/늦은 값이면 보수적으로 0 처리(프론트에서 기본 턴 사용)
        sug = 0

    return {
        "title": title,
        "base_condition": base_cond,
        "hint": hint,
        "suggested_turn": int(sug),
    }

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
    # 입력 이름(요청 스키마 상 필수지만, 프론트 자동생성 시 placeholder가 들어올 수 있다)
    name_input = _clip(req.name, 100) or "캐릭터"
    seed_text = _clip(req.seed_text, 2000)
    # ✅ 랜덤성 강화(경쟁사 UX):
    # - 입력이 비어있을 때도 "누를 때마다" 결과가 바뀌어야 한다.
    # - 외부 의존성 없이 uuid 시드를 프롬프트에 넣어 변주를 유도한다.
    nonce = uuid.uuid4().hex[:8]

    tags_user = _clean_list_str(req.tags, max_items=10, max_len_each=24)
    image_url = _clip(req.image_url, 500)
    fallback_name, fallback_description = _build_local_random_profile(seed_text, tags_user, nonce)

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
- 캐릭터 이름(입력): {name_input}
- 랜덤 시드: {nonce}
- 유저가 원하는 느낌/설정: {seed_text}
- 유저가 선택한 태그: {tags_block or "없음"}
- 이미지 힌트(JSON, 있을 때만 참고): {vision_block or "없음"}

[출력 규칙]
- 아래 JSON 스키마를 정확히 따를 것.
- 각 필드는 가능한 한 구체적으로 채울 것(비어있지 않게).
- 과도한 설정은 피하고, 사용자 입력과 이미지 힌트에 최대한 근거할 것.
- 입력 이름이 '캐릭터' 또는 '미정'처럼 placeholder라면, 반드시 더 자연스럽고 고유한 이름을 새로 생성할 것.
- 결과는 랜덤 시드가 달라질 때마다 서로 다른 콘셉트가 나오게 할 것.

[JSON 스키마]
{{
  "name": "캐릭터 이름(형식: '역할/콘셉트(공백 포함 가능) + 공백 + 고유한 이름', 예: '차분한 상담가 채하이', 100자 이내)",
  "description": "캐릭터 소개(2~4문장, 500자 미만)",
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

    # ✅ JSON 파싱(방어 강화):
    # - 일부 모델 응답은 JSON 앞뒤에 텍스트가 섞이거나, trailing comma가 포함되어 파싱이 실패할 수 있다.
    # - 실패 시에도 seed_text(프롬프트)가 사용자 입력칸에 노출되지 않도록 별도 가드한다.
    data: Dict[str, Any] = {}
    parsed_ok = False
    try:
        raw_json = cleaned or ""
        # 1) 첫 '{' ~ 마지막 '}' 구간만 추출 (앞뒤 잡텍스트 제거)
        try:
            if raw_json:
                s = raw_json.find("{")
                e = raw_json.rfind("}")
                if s >= 0 and e > s:
                    raw_json = raw_json[s:e+1]
        except Exception:
            pass
        # 2) trailing comma 제거:  {...,} / [...,] → {...} / [...]
        try:
            import re
            raw_json = re.sub(r",\s*([}\]])", r"\1", raw_json)
        except Exception:
            pass

        data = json.loads(raw_json) if raw_json else {}
        if isinstance(data, dict):
            parsed_ok = True
        else:
            data = {}
    except Exception as e:
        try:
            logger.warning(f"[quick_character] json parse failed, fallback minimal: {e}")
        except Exception:
            pass
        data = {}

    # ✅ 이름 자동 생성 지원:
    # - LLM이 name을 주면 그걸 우선 사용하되,
    # - 파싱 실패/빈 응답/placeholder면 로컬 랜덤 폴백을 사용해서 "자동 생성" UX를 보장한다.
    name_from_ai = _clip(data.get("name"), 100)
    name_candidate = _safe_text(name_from_ai).strip()
    if _is_placeholder_name(name_candidate):
        name_candidate = fallback_name
    if _is_placeholder_name(name_candidate):
        name_candidate = name_input
    # ✅ 요구사항: 자동생성 이름은 항상 "역할 + 이름" 형태
    # - LLM이 "채하이"처럼 이름만 주면, 폴백에서 뽑은 역할을 앞에 붙인다.
    # - 역할 텍스트는 공백을 포함할 수 있으므로 rsplit으로 분리한다.
    name = name_candidate
    try:
        if isinstance(name, str) and (" " not in name.strip()):
            role_part = str(fallback_name or "").rsplit(" ", 1)[0].strip()
            if role_part:
                name = f"{role_part} {name}".strip()
    except Exception:
        pass

    # ✅ 요구사항: 소개는 500자 미만
    description = _clip(data.get("description"), 480).strip()
    personality = _clip(data.get("personality"), 2000)
    speech_style = _clip(data.get("speech_style"), 2000)
    user_display = _clip(data.get("user_display_description"), 3000)
    world_setting = _clip(data.get("world_setting"), 5000)
    greetings = _clean_list_str(data.get("greetings"), max_items=3, max_len_each=500)
    intro = _clean_intro_scene(data.get("introduction_scene"))
    exds = _clean_dialogues(data.get("example_dialogues"))

    # 안전 기본값
    if (not description) or _is_generated_seed_text(description):
        # ✅ 파싱 실패/빈 응답/placeholder 설명:
        # - 프롬프트성 안내문(seed_text)이나 기본 폴백 문구가 그대로 소개로 들어가면 UX가 망가진다.
        # - 따라서 로컬 랜덤 폴백을 최우선으로 사용한다.
        if not parsed_ok:
            description = fallback_description
            try:
                logger.warning(f"[quick_character] fallback_profile_used reason=json_parse_failed model={model}")
            except Exception:
                pass
        else:
            if seed_text and (not _is_generated_seed_text(seed_text)):
                description = _clip(seed_text, 300).strip() or fallback_description
            else:
                description = fallback_description
    if not personality:
        if seed_text and (not _is_generated_seed_text(seed_text)):
            personality = f"{name}는(은) {(_clip(seed_text, 200) or '자신만의 매력을 가진')} 캐릭터입니다."
        else:
            personality = f"{name}는(은) 자신만의 목표와 금기를 가진 캐릭터입니다."
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



