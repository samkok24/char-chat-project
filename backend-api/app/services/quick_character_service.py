"""
온보딩 '30초만에 캐릭터 만나기'용 AI 자동완성 서비스

핵심 원칙(안전/방어):
- LLM 출력이 흔들려도(형식/길이/누락) 서비스가 터지지 않게 기본값/클립/폴백을 적용한다.
- 생성(DB 저장)은 SSOT인 `/characters/advanced` API에서만 수행한다.
- 이 서비스는 "고급 생성 요청(payload)"을 만들 수 있을 정도의 초안(draft)만 생성한다.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple
from pathlib import Path
from difflib import SequenceMatcher
import json
import random
import re
import uuid

try:
    from app.core.logger import logger
except Exception:
    import logging as _logging
    logger = _logging.getLogger(__name__)

from app.schemas.quick_character import QuickCharacterGenerateRequest
from app.schemas.profile_themes import (
    ROLEPLAY_PROFILE_THEME_CHIPS,
    SIMULATOR_PROFILE_THEME_CHIPS,
    ROLEPLAY_PROFILE_THEME_CHIPS_MALE,
    ROLEPLAY_PROFILE_THEME_CHIPS_FEMALE,
    SIMULATOR_PROFILE_THEME_CHIPS_MALE,
    SIMULATOR_PROFILE_THEME_CHIPS_FEMALE,
)
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
from app.services.ai_service import (
    get_ai_completion,
    get_gemini_completion_json,
    AIModel,
    analyze_image_tags_and_context,
    build_image_grounding_block,
)

_MARKET_STYLE_TOKENS_CACHE: Optional[Dict[str, Any]] = None


def _load_market_style_tokens() -> Dict[str, Any]:
    """
    시장성 힌트 SSOT 로드(방어적, 1회 캐시).

    - `backend-api/app/services/market_style_tokens.json`는
      크랙/바베챗 샘플에서 "패턴 라벨/키워드 토큰"만 추출한 데이터다.
    - 파일이 없거나 깨져도 전체 생성이 멈추면 안 되므로 빈 dict로 폴백한다.
    """
    global _MARKET_STYLE_TOKENS_CACHE
    if isinstance(_MARKET_STYLE_TOKENS_CACHE, dict):
        return _MARKET_STYLE_TOKENS_CACHE
    try:
        p = Path(__file__).resolve().parent / "market_style_tokens.json"
        if not p.exists():
            _MARKET_STYLE_TOKENS_CACHE = {}
            return _MARKET_STYLE_TOKENS_CACHE
        with p.open("r", encoding="utf-8") as f:
            data = json.load(f)
        _MARKET_STYLE_TOKENS_CACHE = data if isinstance(data, dict) else {}
        return _MARKET_STYLE_TOKENS_CACHE
    except Exception as e:
        try:
            logger.warning(f"[quick_character] market_style_tokens load failed: {type(e).__name__}:{str(e)[:120]}")
        except Exception:
            pass
        _MARKET_STYLE_TOKENS_CACHE = {}
        return _MARKET_STYLE_TOKENS_CACHE


def _clean_market_list(items: Any) -> List[str]:
    """
    시장성 힌트 토큰/패턴 리스트 정리(방어적).

    - 너무 일반적인 기능어/대명사(당신*), 영어 약어(HL/BL), 성향 라벨(남성향/여성향/전체)은 제거한다.
    - 길이 폭주/이모지/기호는 제거한다.
    """
    out: List[str] = []
    if not isinstance(items, list):
        return out
    for x in items:
        s = str(x or "").strip()
        if not s:
            continue
        if len(s) > 24:
            continue
        if s in ("남성향", "여성향", "전체", "HL", "BL"):
            continue
        if s.startswith("당신"):
            continue
        # 영문/URL/과도한 기호는 제외(구체 명사 강화)
        if re.search(r"[A-Za-z0-9]", s):
            continue
        if re.search(r"https?://", s):
            continue
        if re.search(r"[\[\]{}<>]", s):
            continue
        out.append(s)
    # unique preserve order
    uniq: List[str] = []
    seen = set()
    for s in out:
        k = s.lower()
        if k in seen:
            continue
        seen.add(k)
        uniq.append(s)
    return uniq


def _build_market_style_block(audience_slug: str, mode_slug: str, nonce: Optional[str] = None) -> str:
    """
    시장성 힌트(샘플 기반) 문자열 생성.

    의도/원리:
    - 생성 결과가 "추상적"으로 흐르는 것을 막기 위해,
      샘플에서 추출한 '제목 패턴' + '훅 키워드'를 짧게 주입한다.
    - 원문(외부 제목/한줄소개)은 절대 주입하지 않는다(리스크 방지).
    - ✅ 반복 방지/다양성: hook_tokens/title_patterns는 수십~수천 개가 있을 수 있으므로,
      매번 "앞부분만" 고정 주입하면 결과가 복제처럼 수렴한다.
      따라서 요청마다 랜덤 nonce를 시드로 섞어서 일부를 샘플링한다.
    """
    try:
        data = _load_market_style_tokens()
        mode = "simulator" if str(mode_slug) == "simulator" else "roleplay"
        gender = (
            "male" if str(audience_slug) == "남성향"
            else "female" if str(audience_slug) == "여성향"
            else "all"
        )
        block = data.get(mode) if isinstance(data, dict) else None
        if not isinstance(block, dict):
            return ""

        def _seeded_rng() -> random.Random:
            """
            ✅ 시드 고정 랜덤: nonce 기반으로 목록을 셔플해도,
            같은 요청 내에서는 재현 가능하게 만든다(디버깅/운영 로그 용이).
            """
            try:
                n = str(nonce or "").strip()
            except Exception:
                n = ""
            # nonce가 없으면 완전 랜덤(그래도 블로킹/에러 없이)
            if not n:
                return random.Random()
            try:
                # uuid 형태면 int로 변환(충돌 낮음)
                return random.Random(uuid.UUID(n).int & 0xFFFFFFFF)
            except Exception:
                # 그 외 문자열은 해시 기반(파이썬 버전/프로세스에 따라 변동 가능하지만 nonce가 매번 달라 큰 문제 없음)
                try:
                    return random.Random(hash(n) & 0xFFFFFFFF)
                except Exception:
                    return random.Random()

        rng = _seeded_rng()

        def _sample(items: List[str], k: int) -> List[str]:
            """
            ✅ 리스트에서 k개 샘플링(순서 포함)
            - items가 k보다 작으면 전체 반환
            - items는 원본 순서를 보존하지 않고 nonce 시드로 섞는다(다양성 목적)
            """
            arr = list(items or [])
            if not arr:
                return []
            try:
                rng.shuffle(arr)
            except Exception:
                pass
            return arr[: max(0, int(k or 0))] if len(arr) > int(k or 0) else arr

        def _pick(g: str) -> Tuple[List[str], List[str]]:
            b = block.get(g)
            if not isinstance(b, dict):
                return [], []
            pats_all = _clean_market_list(b.get("title_patterns"))
            toks_all = _clean_market_list(b.get("hook_tokens"))
            # ✅ 샘플 크기를 키워 "전체 풀"에서 고르게 뽑히게 한다(프롬프트 길이 한계 내).
            # - 단, '계약/비밀/약속/약점' 같은 훅 단어를 "금지"하진 않는다(시장성 훅이므로).
            # - 대신 토큰 구성에서 이 단어들만 과다 선택되지 않도록 "soft limit"만 둔다.
            # ✅ 유저 요구사항: 더 넓게(예: 100개) 후보를 주입해 다양성을 올린다.
            # - 단, 프롬프트 입력이 너무 길어지면(토큰 폭주) 모델이 오히려 힌트를 무시하거나 수렴할 수 있어
            #   "문자 예산"으로 안전하게 컷한다.
            TARGET_PATS = 14
            TARGET_TOKS = 100
            TOKS_CHAR_BUDGET = 1200  # "훅/소재 키워드: ..." 라인 길이 예산(요구사항: 다양성↑)

            pats = _sample(pats_all, TARGET_PATS)
            # 넓게 섞은 뒤 아래에서 고른다(목표치의 2~3배 정도 후보군 확보)
            toks_all_shuffled = _sample(toks_all, max(240, TARGET_TOKS * 2))
            soft = {"계약", "비밀", "약속", "약점"}

            # ✅ 수렴 방지(핵심): "학교/일진/아카데미" 같은 초빈출 클러스터가
            # 한 번에 여러 개 뽑히면 결과가 매번 비슷해진다.
            # - 단어 자체를 금지하지 않고, 한 번의 힌트 블록에서 과다 선택만 막는다.
            clusters = {
                "school": {"학교", "고등학교", "아카데미", "일진", "일진녀", "학생회장", "선생님", "교복", "일상"},
                "romance": {"로맨스", "순애", "혐관", "츤데레", "까칠", "집착"},
                "genre": {"판타지", "액션", "히어로", "메이드"},
                "structure": {"되었다"},
            }
            cluster_limits = {
                "school": 1,
                "romance": 1,
                "genre": 1,
                "structure": 1,
            }
            cluster_used = {k: 0 for k in cluster_limits.keys()}

            picked: List[str] = []
            soft_used = 0
            # "a, b, c" 문자열 길이 예산으로 컷
            used_chars = 0
            for t in toks_all_shuffled:
                if t in soft:
                    if soft_used >= 1:
                        continue
                    # ✅ 수렴 방지: '계약/비밀/약속/약점'은 시장성 훅이지만,
                    # 태그가 바뀌어도 계속 이 단어들로만 수렴하는 문제가 있어 "가끔만" 포함한다.
                    # (전역 금지 X, 확률적으로 희소화)
                    try:
                        if rng.random() > 0.25:
                            continue
                    except Exception:
                        pass
                    soft_used += 1
                # 클러스터별 soft limit 적용
                try:
                    hit_cluster = ""
                    for ck, members in clusters.items():
                        if t in members:
                            hit_cluster = ck
                            break
                    if hit_cluster:
                        lim = int(cluster_limits.get(hit_cluster, 0) or 0)
                        if lim > 0 and int(cluster_used.get(hit_cluster, 0) or 0) >= lim:
                            continue
                        cluster_used[hit_cluster] = int(cluster_used.get(hit_cluster, 0) or 0) + 1
                except Exception:
                    pass
                # 문자 예산 체크(콤마+공백 포함)
                try:
                    add = len(t) + (2 if picked else 0)
                except Exception:
                    add = 0
                if (used_chars + add) > TOKS_CHAR_BUDGET:
                    # 목표치를 달성하지 못했더라도, 프롬프트 안전을 우선한다.
                    if len(picked) >= 20:
                        break
                    # 너무 적게 담겼으면 예산을 아주 조금만 늘려 계속 시도(무한루프 방지: 1회만)
                    TOKS_CHAR_BUDGET = TOKS_CHAR_BUDGET + 120
                picked.append(t)
                used_chars += add
                if len(picked) >= TARGET_TOKS:
                    break
            toks = picked
            return pats, toks

        if gender == "all":
            p1, t1 = _pick("male")
            p2, t2 = _pick("female")
            pats = [*p1, *p2]
            toks = [*t1, *t2]
            # unique preserve order
            pats = _sample(_clean_market_list(pats), 16)
            # all은 양쪽 합쳐 길이가 길어지기 쉬워 토큰 수는 적당히 유지
            toks = _sample(_clean_market_list(toks), 60)
        else:
            pats, toks = _pick(gender)

        if not pats and not toks:
            return ""

        pat_s = ", ".join(pats) if pats else ""
        tok_s = ", ".join(toks) if toks else ""
        lines = ["- [시장성 샘플 힌트(추출)]"]
        if pat_s:
            lines.append(f"  - 제목 패턴 라벨: {pat_s}")
        if tok_s:
            lines.append(f"  - 훅/소재 키워드: {tok_s}")
        return "\n".join(lines) + "\n"
    except Exception:
        return ""


def _vision_korean_hints(vision_tags: Dict[str, Any], vision_ctx: Dict[str, Any]) -> List[str]:
    """
    Vision 결과(tags/context)를 "앵커 힌트(한국어)"로 변환한다.

    의도/원리:
    - vision 서비스는 사실 중심 JSON(tags/context)을 반환한다.
    - LLM이 이 힌트를 '선택적으로' 참고하면 이미지와 무관한 출력이 나올 수 있으므로,
      최소한의 앵커(장소/오브젝트 등)를 작품명/한줄소개에 반영하도록 강제하기 위해 사용한다.
    """
    out: List[str] = []
    try:
        place = str((vision_tags or {}).get("place") or "").strip().lower()
        place_map = {
            "cafe": "카페",
            "street": "거리",
            "park": "공원",
            "campus": "캠퍼스",
            "indoor": "실내",
            "home": "집",
            "office": "사무실",
            "store": "가게",
            "beach": "해변",
            "mountain": "산",
        }
        if place in place_map:
            out.append(place_map[place])
    except Exception:
        pass

    # 조명/시간대(앵커)
    try:
        lighting = str((vision_tags or {}).get("lighting") or "").strip().lower()
        lighting_map = {
            "daylight": "낮빛",
            "night": "야간",
            "sunset": "석양",
            "overcast": "흐린 하늘",
            "indoor": "실내 조명",
        }
        if lighting in lighting_map:
            out.append(lighting_map[lighting])
    except Exception:
        pass

    # 날씨(앵커)
    try:
        weather = str((vision_tags or {}).get("weather") or "").strip().lower()
        weather_map = {
            "rain": "비",
            "snow": "눈",
            "fog": "안개",
            "storm": "폭풍",
            "clear": "맑음",
            "cloudy": "구름",
        }
        if weather in weather_map:
            out.append(weather_map[weather])
    except Exception:
        pass

    # 무드(앵커) - 지나치게 추상적이면 피하고, 짧은 정서 톤만
    try:
        mood = str((vision_tags or {}).get("mood") or "").strip().lower()
        mood_map = {
            "tense": "긴장",
            "mysterious": "미스터리",
            "melancholic": "우울",
            "romantic": "설렘",
            "calm": "고요",
            "warm": "따뜻함",
            "cold": "차가움",
            "chaotic": "혼란",
        }
        if mood in mood_map:
            out.append(mood_map[mood])
        else:
            # 자유 텍스트면 핵심 키워드만 얇게 매핑
            if any(k in mood for k in ("mystery", "myster")):
                out.append("미스터리")
            if any(k in mood for k in ("tension", "tense", "danger")):
                out.append("긴장")
            if any(k in mood for k in ("romance", "romantic")):
                out.append("설렘")
            if any(k in mood for k in ("melanch", "sad")):
                out.append("우울")
    except Exception:
        pass

    # 오브젝트/포컬/텍스트 등은 문자열 매칭으로 단순히 앵커화한다.
    try:
        objs = (vision_tags or {}).get("objects")
        if isinstance(objs, list):
            joined = " ".join([str(x or "").strip().lower() for x in objs if str(x or "").strip()])
        else:
            joined = str(objs or "").strip().lower()

        # 학교/교실 힌트
        if any(k in joined for k in ("classroom", "school", "desk", "chair", "window", "blackboard")):
            out.append("교실")
        if any(k in joined for k in ("window",)):
            out.append("창가")
        if any(k in joined for k in ("uniform", "student")):
            out.append("교복")
        # 벚꽃/봄 힌트
        if any(k in joined for k in ("cherry", "blossom", "sakura")):
            out.append("벚꽃")
    except Exception:
        pass

    try:
        focal = str((vision_tags or {}).get("focal_point") or "").strip().lower()
        if focal:
            if any(k in focal for k in ("girl", "woman", "female", "student")):
                out.append("소녀")
    except Exception:
        pass

    # context.subjects에서 표정/포즈/의상 앵커를 최대 2개까지 추출(방어적으로)
    try:
        subjects = (vision_ctx or {}).get("subjects")
        if isinstance(subjects, list) and subjects:
            # 첫 주 피사체 중심(대부분 1:1 캐릭터 이미지)
            s0 = subjects[0] if isinstance(subjects[0], dict) else {}
            emotion = str((s0 or {}).get("emotion") or "").strip().lower()
            pose = str((s0 or {}).get("pose") or "").strip().lower()
            attire = str((s0 or {}).get("attire") or "").strip().lower()

            # 표정/감정
            if emotion:
                if any(k in emotion for k in ("smile", "happy")):
                    out.append("미소")
                elif any(k in emotion for k in ("angry", "rage")):
                    out.append("분노")
                elif any(k in emotion for k in ("sad", "cry")):
                    out.append("울먹임")
                elif any(k in emotion for k in ("calm", "neutral")):
                    out.append("무표정")
                elif any(k in emotion for k in ("shy", "blush")):
                    out.append("붉어진 뺨")
                elif any(k in emotion for k in ("fear", "scared")):
                    out.append("두려움")
                elif any(k in emotion for k in ("cold", "stern")):
                    out.append("차가운 눈빛")

            # 포즈(너무 길면 키워드만)
            if pose:
                if any(k in pose for k in ("hand", "reach", "grab")):
                    out.append("손을 내밈")
                if any(k in pose for k in ("look", "stare", "gaze")):
                    out.append("시선")
                if any(k in pose for k in ("sit", "seated")):
                    out.append("앉아 있음")
                if any(k in pose for k in ("stand", "standing")):
                    out.append("서 있음")

            # 의상(대표 토큰만)
            if attire:
                if any(k in attire for k in ("uniform",)):
                    out.append("교복")
                elif any(k in attire for k in ("suit",)):
                    out.append("정장")
                elif any(k in attire for k in ("coat",)):
                    out.append("코트")
                elif any(k in attire for k in ("hood", "hoodie")):
                    out.append("후드")
                elif any(k in attire for k in ("dress",)):
                    out.append("드레스")
                elif any(k in attire for k in ("armor",)):
                    out.append("갑옷")
                elif any(k in attire for k in ("military", "uniformed", "soldier")):
                    out.append("군복")
    except Exception:
        pass

    # 중복 제거(순서 유지)
    try:
        seen = set()
        uniq: List[str] = []
        for h in out:
            s = str(h or "").strip()
            if not s:
                continue
            if s in seen:
                continue
            seen.add(s)
            uniq.append(s)
        return uniq[:6]
    except Exception:
        return out[:6]


def _vision_characterchat_interpretation(vision_tags: Dict[str, Any], vision_ctx: Dict[str, Any]) -> Dict[str, Any]:
    """
    Vision 결과(tags/context)를 "캐릭터챗 스타일"로 해석한다.

    ⚠️ 중요한 원칙(방어/정확성):
    - 이미지 힌트에 없는 '사실'을 단정하지 않는다. (직업/관계/과거 사건 확정 금지)
    - 대신 캐릭터챗에서 잘 먹히는 요소(훅/거리감/목표·리스크)를 '제안' 형태로 만든다.

    반환:
    - anchors_ko: 실제로 "보이는" 앵커(장소/시간/날씨/의상/표정 등) 위주
    - vibe_ko: 장르/정서/전개 동력 힌트(가능하면 SSOT 칩과 맞는 단어로)
    - roleplay_hooks / simulator_hooks: 문장형 훅 제안(각 최대 6개)
    """
    anchors = _vision_korean_hints(vision_tags, vision_ctx)

    # --- 1) 톤/장르 힌트(캐릭터챗용) ---
    vibe: List[str] = []
    try:
        mood = str((vision_tags or {}).get("mood") or "").strip().lower()
        lighting = str((vision_tags or {}).get("lighting") or "").strip().lower()
        weather = str((vision_tags or {}).get("weather") or "").strip().lower()
        place = str((vision_tags or {}).get("place") or "").strip().lower()

        # 무드 → 캐릭터챗 톤(보수적 매핑: 추정이 아니라 "어울림" 제안)
        if any(k in mood for k in ("romantic", "romance", "love")):
            vibe.extend(["로맨스", "설렘"])
        if any(k in mood for k in ("myster", "mystery")):
            vibe.extend(["미스터리", "긴장"])
        if any(k in mood for k in ("tense", "danger", "thrill", "suspense")):
            vibe.extend(["스릴러", "긴장"])
        if any(k in mood for k in ("melanch", "sad", "lonely")):
            vibe.extend(["피폐", "후회", "구원"])
        if any(k in mood for k in ("warm", "calm", "cozy")):
            vibe.extend(["힐링", "일상"])
        if any(k in mood for k in ("cold", "stern")):
            vibe.extend(["느와르", "차가움"])

        # 시간/날씨/장소 → 전개 감도
        if lighting in ("night",) or weather in ("fog", "rain"):
            vibe.extend(["느와르", "미스터리"])
        if place in ("campus",) or "교복" in anchors or "교실" in anchors:
            vibe.extend(["학교", "학원", "청춘"])
        if place in ("office",) or "사무실" in anchors or "정장" in anchors:
            vibe.extend(["오피스", "현대"])
    except Exception:
        pass

    # --- 2) 훅 제안(문장형) ---
    rp_hooks: List[str] = []
    sim_hooks: List[str] = []
    try:
        a = set(anchors or [])
        v = set([x for x in vibe if isinstance(x, str)])

        # RP: 관계/거리감/금기/비밀 '제안'
        if "교복" in a or "교실" in a or "학교" in v or "학원" in v:
            rp_hooks.append("교실/학교라는 안전한 공간에서, 둘만 아는 비밀이 관계의 거리감을 흔들리게 해줘.")
        if "야간" in a or "안개" in a or "비" in a or "느와르" in v:
            rp_hooks.append("밤/비/안개 같은 분위기를 살려, 서로를 경계하면서도 끌리는 혐관·긴장 구도를 제안해줘.")
        if "미스터리" in v or "긴장" in v:
            rp_hooks.append("상대의 말투/시선/행동에 ‘숨기는 것’이 있다는 느낌을 주고, 유저가 캐묻게 만드는 훅을 넣어줘.")
        if "피폐" in v or "후회" in v or "구원" in v:
            rp_hooks.append("감정선이 무너지기 직전의 불안정함을 살리고, 유저가 ‘구원/회복’의 선택을 하게 만드는 전개를 제안해줘.")
        if "로맨스" in v or "설렘" in v:
            rp_hooks.append("가까워질수록 ‘하면 안 되는 이유’가 드러나는 설렘 중심 관계 전개를 제안해줘. (금기/약속/대가 중 1개)")
        # 기본 훅(최소 1개는 유지)
        if not rp_hooks:
            rp_hooks.append("이미지의 분위기(장소/조명/표정)를 첫 장면에 반영하고, ‘관계 규칙이 바뀌는 계기’를 1개 넣어줘. (오해/약점/거래/구원 중 1개)")

        # ✅ RP 훅을 캐릭터챗에서 바로 쓰기 좋게 강화(‘왜 대화해야 하는지’)
        # - 사실 단정 금지: 인물의 직업/과거를 확정하지 않는다.
        rp_enhanced: List[str] = []
        try:
            a_list = [x for x in (anchors or []) if isinstance(x, str) and x.strip()]
            lead = a_list[0] if a_list else ""
            for h in rp_hooks:
                base = str(h or "").strip()
                if not base:
                    continue
                # “대화 동력”을 강제: 질문/거래/비밀 1개는 반드시 들어가게
                tail = "유저가 ‘왜 그런지’ 캐묻거나, 거래/약속을 제안할 명분이 생기게 해줘."
                if "제안해줘" in base and tail not in base:
                    base = base.replace("제안해줘.", f"제안해줘. {tail}")
                if lead and lead not in base:
                    base = f"{lead}에서 {base}"
                rp_enhanced.append(base)
                if len(rp_enhanced) >= 6:
                    break
        except Exception:
            rp_enhanced = rp_hooks
        rp_hooks = rp_enhanced or rp_hooks

        # 시뮬: 목표 1개 + 리스크/제약 1개 구조
        if "미스터리" in v or "스릴러" in v or "긴장" in v:
            sim_hooks.append("목표: 단서 확보/진실 확인. 리스크: 잘못 건드리면 즉시 불이익(추적·노출·패널티)이 발생하도록 제안해줘.")
        if "학교" in v or "학원" in v or "아카데미" in v:
            sim_hooks.append("목표: 시험/평가/랭크 상승. 제약: 규칙(교칙/시스템)이 있어 선택마다 점수/평판이 변하도록 제안해줘.")
        if "오피스" in v or "현대" in v:
            sim_hooks.append("목표: 프로젝트/성과 달성. 리스크: 평판/내부 경쟁/시간 제한 같은 현실 제약을 제안해줘.")
        if "힐링" in v or "일상" in v:
            sim_hooks.append("목표: 루틴 완성/관계 회복. 제약: 감정/컨디션/시간이 자원처럼 소모되도록 제안해줘.")
        if not sim_hooks:
            sim_hooks.append("목표 1개 + 즉시 체감되는 제약/리스크 1개를 설정하고, 선택이 누적되는 구조로 제안해줘. (실패 페널티/시간 제한/자원 고갈 중 1개)")

        # ✅ 시뮬 훅을 “게임성/룰” 중심으로 강화(캐릭터챗 시뮬에 맞게)
        sim_enhanced: List[str] = []
        try:
            a_list = [x for x in (anchors or []) if isinstance(x, str) and x.strip()]
            lead = a_list[0] if a_list else ""
            for h in sim_hooks:
                base = str(h or "").strip()
                if not base:
                    continue
                # “룰/누적/판정”을 넣어 캐릭터챗 시뮬 느낌을 강화
                addon = "선택 결과가 누적되고, ‘조건 충족/미충족’이 분명하게 판정되게 해줘."
                if addon not in base:
                    base = f"{base} {addon}"
                if lead and lead not in base:
                    base = f"{lead}에서 {base}"
                sim_enhanced.append(base)
                if len(sim_enhanced) >= 6:
                    break
        except Exception:
            sim_enhanced = sim_hooks
        sim_hooks = sim_enhanced or sim_hooks
    except Exception:
        # 방어: 훅이 실패해도 전체는 빈 값으로 폴백
        rp_hooks = rp_hooks or []
        sim_hooks = sim_hooks or []

    # 중복 제거(순서 유지) + 상한
    def _uniq_limit(items: List[str], n: int) -> List[str]:
        out: List[str] = []
        seen = set()
        for it in items or []:
            t = str(it or "").strip()
            if not t:
                continue
            key = t.lower()
            if key in seen:
                continue
            seen.add(key)
            out.append(t)
            if len(out) >= n:
                break
        return out

    return {
        "anchors_ko": _uniq_limit([str(x) for x in (anchors or [])], 12),
        "vibe_ko": _uniq_limit([str(x) for x in (vibe or [])], 20),
        "roleplay_hook_suggestions": _uniq_limit(rp_hooks, 6),
        "simulator_hook_suggestions": _uniq_limit(sim_hooks, 6),
    }


def _mentions_any(text: str, keywords: List[str]) -> bool:
    try:
        t = _safe_text(text)
        if not t:
            return False
        for k in (keywords or []):
            ks = str(k or "").strip()
            if not ks:
                continue
            if ks in t:
                return True
        return False
    except Exception:
        return False


def _extract_profile_keywords_from_seed(seed_text: str) -> List[str]:
    """
    프론트가 seed_text에 주입하는 '소재/키워드'를 추출한다.

    의도/원리:
    - 프로필 컨셉은 (유저 선택 칩/키워드) + (이미지 관찰 앵커)로 결정된다.
    - seed_text는 자유 텍스트이므로, '선택한 소재 태그(우선 반영): ...' 같은 라인을 방어적으로 파싱한다.
    """
    s = _safe_text(seed_text)
    if not s:
        return []
    keys: List[str] = []
    try:
        lines = [ln.strip() for ln in s.replace("\r", "\n").split("\n") if ln.strip()]
        for ln in lines:
            if "선택한 소재 태그" in ln and ":" in ln:
                tail = ln.split(":", 1)[1]
                keys.extend([p.strip() for p in tail.split(",") if p.strip()])
            if "추가 키워드" in ln and ":" in ln:
                tail = ln.split(":", 1)[1]
                keys.extend([p.strip() for p in tail.split(",") if p.strip()])
    except Exception:
        keys = []

    out: List[str] = []
    for k in keys:
        t = str(k or "").strip()
        if not t:
            continue
        if t not in out:
            out.append(t[:24])
        if len(out) >= 6:
            break
    return out


def _market_keywords_for_mode(mode_hint: str, audience_label: Optional[str] = None) -> List[str]:
    """
    시장성(소재) 후보 SSOT를 모드별로 반환한다.

    - RP: 관계/감정선 중심 키워드
    - 시뮬: 목표/룰/리스크 중심 키워드
    """
    try:
        m = _safe_text(mode_hint).strip().lower()
        a = _safe_text(audience_label).strip()
        if a in ("남성", "male"):
            a = "남성향"
        if a in ("여성", "female"):
            a = "여성향"
        if a not in ("남성향", "여성향"):
            a = ""

        if m == "simulator":
            base = [str(x) for x in (SIMULATOR_PROFILE_THEME_CHIPS or []) if str(x).strip()]
            extra: List[str] = []
            if a == "남성향":
                extra = [str(x) for x in (SIMULATOR_PROFILE_THEME_CHIPS_MALE or []) if str(x).strip()]
            elif a == "여성향":
                extra = [str(x) for x in (SIMULATOR_PROFILE_THEME_CHIPS_FEMALE or []) if str(x).strip()]
        else:
            base = [str(x) for x in (ROLEPLAY_PROFILE_THEME_CHIPS or []) if str(x).strip()]
            extra = []
            if a == "남성향":
                extra = [str(x) for x in (ROLEPLAY_PROFILE_THEME_CHIPS_MALE or []) if str(x).strip()]
            elif a == "여성향":
                extra = [str(x) for x in (ROLEPLAY_PROFILE_THEME_CHIPS_FEMALE or []) if str(x).strip()]

        # 중복 제거 + 과다 길이 방어
        out: List[str] = []
        for k in (extra + base):
            kk = str(k or "").strip()
            if not kk:
                continue
            if kk not in out:
                out.append(kk)
            if len(out) >= 120:
                break
        return out
    except Exception:
        return []


_PROFILE_META_TOKENS = (
    # 대화 유도/키워드 나열형
    "키워드:",
    "지금 떠오르는",
    "대화를 시작",
    "말해주면",
    "시작해줄게",
    "시작해줄게요",
    # 운영/공지/업데이트
    "업데이트",
    "업뎃",
    "패치",
    "버전",
    "ver",
    "공지",
    "필독",
    "고정댓글",
    # 명령어/링크/플랫폼
    "명령어",
    "커맨드",
    "command",
    "프로챗",
    "링크",
    "주소",
    "참조",
)


def _has_profile_meta_wording(text: str) -> bool:
    """
    프로필(작품명/한줄소개)에서 메타/운영성 문구를 감지한다.

    의도:
    - 크롤링 샘플의 운영 문구(업데이트/명령어/URL 등)가 자동생성 결과에 섞이는 것을 방지한다.
    - 후보 점수화/후처리에서 동일한 기준을 재사용해 일관성을 유지한다(SSOT).
    """
    s = _safe_text(text)
    if not s:
        return False
    lower = s.lower()
    # URL/도메인 패턴
    if re.search(r"(https?://|www\.)", lower):
        return True
    # 명령어 패턴(!xxx)
    if re.search(r"![A-Za-z가-힣]", s):
        return True
    # 괄호형 메타 안내(자주 등장)
    if ("[" in s and "]" in s) or ("【" in s and "】" in s):
        return True
    for tok in _PROFILE_META_TOKENS:
        t = str(tok or "").strip().lower()
        if t and t in lower:
            return True
    return False


def _has_output_meta_wording(text: str) -> bool:
    """
    오프닝/엔딩/스탯 등 결과물에서 운영/메타 문구를 감지한다.

    의도:
    - 크롤링 샘플의 운영 문구가 결과에 섞이는 것을 차단한다.
    - 프로필 전용 검사와 동일한 SSOT 토큰을 사용하되, 과잉 매칭은 방어한다.
    """
    s = _safe_text(text)
    if not s:
        return False
    lower = s.lower()
    # URL/도메인 패턴
    if re.search(r"(https?://|www\.)", lower):
        return True
    # 명령어 패턴(!xxx)
    if re.search(r"![A-Za-z가-힣]", s):
        return True
    # 괄호형 메타 안내(자주 등장)
    if ("[" in s and "]" in s) or ("【" in s and "】" in s):
        return True
    for tok in _PROFILE_META_TOKENS:
        t = str(tok or "").strip().lower()
        if not t:
            continue
        if t == "ver":
            # 'ver'는 일반 단어에도 섞일 수 있어 버전 표기만 감지
            if re.search(r"\bver[\s._-]*\d", lower) or re.search(r"\bver\b", lower):
                return True
            continue
        if t in lower:
            return True
    return False


def _score_profile_candidate(
    *,
    mode_hint: str,
    audience_label: str,
    name: str,
    description: str,
    hook: str,
    anchors: List[str],
    market_keys: List[str],
) -> Dict[str, int]:
    """
    프로필 후보를 점수화한다(0~5).

    - market_fit: SSOT/유저 소재 키워드 정합
    - clarity: 형식/길이/금지어 위반 최소화
    - image_fit: 이미지 앵커 2개 이상 자연스러운 반영
    - mode_fit: RP(관계/감정선) vs 시뮬(목표+리스크) 느낌
    - audience_fit: 남성향/여성향(또는 전체) 톤 정합(동일 모드 내 세부 분기)
    """
    m = _safe_text(mode_hint).strip().lower()
    a = _safe_text(audience_label).strip()
    nm = _safe_text(name)
    ds = _safe_text(description)
    hk = _safe_text(hook)
    blob = f"{nm}\n{ds}\n{hk}".strip()

    # market_fit
    market_hit = 0
    for k in (market_keys or []):
        kk = str(k or "").strip()
        if not kk:
            continue
        if kk in blob:
            market_hit += 1
        if market_hit >= 3:
            break
    if market_hit >= 2:
        market_fit = 5
    elif market_hit == 1:
        market_fit = 3
    else:
        market_fit = 1 if market_keys else 2

    # clarity
    clarity = 5
    if not (8 <= len(nm) <= 35):
        clarity -= 2
    if not (120 <= len(ds) <= 320):
        clarity -= 2
    # 운영/메타성 문구는 강하게 감점
    if _has_profile_meta_wording(ds) or _has_profile_meta_wording(hk) or _has_profile_meta_wording(nm):
        clarity -= 4
    if clarity < 0:
        clarity = 0

    # image_fit
    a = [str(x).strip() for x in (anchors or []) if str(x).strip()][:6]
    hit = 0
    for k in a:
        if k and (k in nm or k in ds):
            hit += 1
    image_fit = 5 if hit >= 2 else (3 if hit == 1 else 1)

    # mode_fit
    if m == "simulator":
        mode_fit = 5 if any(t in (ds + hk) for t in ("목표", "리스크", "제약", "조건", "탈출", "생존", "확보", "조사", "선택")) else 3
    else:
        mode_fit = 5 if any(t in (ds + hk) for t in ("관계", "거리", "호감", "감정", "재회", "집착", "금지", "비밀", "오해")) else 3

    # audience_fit (운영 안전: 노골/고정관념 강제 금지, '서사 동력/페이싱' 관점만 반영)
    audience_fit = 4
    try:
        if a in ("남성", "male"):
            a = "남성향"
        if a in ("여성", "female"):
            a = "여성향"
        if a not in ("남성향", "여성향", "전체"):
            a = "미지정"
        if a in ("전체", "미지정"):
            audience_fit = 4
        else:
            if a == "남성향":
                keys = ("성장", "각성", "공략", "획득", "보상", "전투", "작전", "경쟁", "승급", "랭크", "빌드", "자원")
                audience_fit = 5 if any(k in (ds + hk) for k in keys) else 3
            else:
                keys = ("관계", "유대", "신뢰", "평판", "동료", "거리", "오해", "긴장", "비밀", "감정")
                audience_fit = 5 if any(k in (ds + hk) for k in keys) else 3
    except Exception:
        audience_fit = 4

    return {
        "market_fit": int(max(0, min(5, market_fit))),
        "clarity": int(max(0, min(5, clarity))),
        "image_fit": int(max(0, min(5, image_fit))),
        "mode_fit": int(max(0, min(5, mode_fit))),
        "audience_fit": int(max(0, min(5, audience_fit))),
    }


def _pick_best_profile_candidate(
    *,
    mode_hint: str,
    audience_label: str,
    candidates: List[Dict[str, Any]],
    anchors: List[str],
    market_keys: List[str],
) -> Tuple[Optional[Dict[str, Any]], List[Dict[str, Any]]]:
    """
    후보 리스트를 서버가 점수화해 1개를 선택한다.
    반환: (선택 candidate, 로그용 scored rows)
    """
    scored: List[Dict[str, Any]] = []
    best: Optional[Dict[str, Any]] = None
    best_total = -1
    best_key = (0, 0)
    for idx, c in enumerate(candidates or []):
        if not isinstance(c, dict):
            continue
        nm = _safe_text(c.get("name")).strip()
        ds = _safe_text(c.get("description")).strip()
        hk = _safe_text(c.get("hook")).strip()
        if not nm or not ds:
            continue
        # 메타/운영성 문구 후보는 제외(오염 방지)
        if _has_profile_meta_wording(nm) or _has_profile_meta_wording(ds) or _has_profile_meta_wording(hk):
            continue
        score = _score_profile_candidate(
            mode_hint=mode_hint,
            audience_label=audience_label,
            name=nm,
            description=ds,
            hook=hk,
            anchors=anchors,
            market_keys=market_keys,
        )
        total = int(score["market_fit"] + score["clarity"] + score["image_fit"] + score["mode_fit"] + score["audience_fit"])
        key = (int(score["image_fit"]), int(score["market_fit"]))
        scored.append({"idx": idx, "name": _clip(nm, 40), "hook": _clip(hk, 80), "scores": score, "total": total})
        if total > best_total or (total == best_total and key > best_key):
            best_total = total
            best_key = key
            best = c
    return best, scored


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


# ============================================================================
# 톤 가드 시스템 (태그 기반 프레이밍 제어)
# ============================================================================
# 의도:
# - 시스템 프롬프트 기본값이 "어두운 소재"로 편향되어 있어,
#   순애/로맨스 태그를 선택해도 "감시/통제/협박" 방향으로 수렴하는 문제 해결.
# - 태그 조합을 분석해 해당 톤에 맞는 프레이밍 지침을 프롬프트에 주입.
# ============================================================================

# 순애/로맨스 계열 태그 (밝은 긴장감)
_SOFT_TONE_TAGS = frozenset({
    "순애", "순정", "달달", "로코", "힐링", "짝사랑", "소꿉친구",
    "오해→해소", "로맨스", "청춘", "일상", "귀여움", "설렘",
    "첫사랑", "고백", "비밀연애", "연애", "러브코미디", "학원",
    "아이돌", "메이드", "집사", "매니저", "팬", "동아리",
})

# 어두운 소재 계열 태그 (어두운 긴장감)
_DARK_TONE_TAGS = frozenset({
    "얀데레", "감금", "혐관", "피폐", "스토커", "집착", "협박",
    "거래", "감시", "통제", "구속", "속박", "납치", "강제",
    "복수", "배신", "타락", "빌런", "악역", "흑화", "광기",
    "경멸", "매도", "욕데레",
})


def _build_tone_guard_block(tags: List[str], mode: str = "roleplay") -> str:
    """
    태그 기반 톤 가드 블록 생성.

    의도:
    - 태그 조합에 따라 AI 생성물의 톤/프레이밍을 제어한다.
    - 순애/로맨스 태그 → 어두운 프레이밍(협박/거래/통제) 단독 수렴 방지
    - 어두운 소재 태그 → 긴장감 유지하되 무의미한 악행 금지
    - 혼합 태그 → "합의적 긴장감"으로 해석 유도

    반환:
    - 프롬프트에 주입할 톤 가드 블록 문자열 (없으면 빈 문자열)
    """
    if not tags:
        return ""

    # 태그 정규화 (소문자, 공백 제거, 특수문자 정리)
    tags_normalized = set()
    for t in tags:
        if not t:
            continue
        s = _safe_text(t).lower().replace(" ", "").replace("_", "")
        # "→" 같은 특수문자는 유지
        tags_normalized.add(s)

    # 태그 매칭 (부분 매칭도 허용)
    has_soft = False
    has_dark = False
    for t in tags_normalized:
        for soft in _SOFT_TONE_TAGS:
            if soft in t or t in soft:
                has_soft = True
                break
        for dark in _DARK_TONE_TAGS:
            if dark in t or t in dark:
                has_dark = True
                break

    # 케이스 A: 순애/로맨스만 있음 → 밝은 톤 강제
    if has_soft and not has_dark:
        return """
[톤 가드 - 순애/로맨스 (필수 준수)]
- 비밀은 "협박/거래의 도구"로 단독 프레이밍 금지.
- 비밀의 동기는 "보호/배려/불안/진심/숨기고 싶은 마음" 중 최소 1개 필수.
- 긴장감 = "강압/위협"이 아니라 "설렘/오해/거리감/금기/망설임"으로 표현.
- "감시/의심"이 나오면 → "질투/걱정/보호본능"으로 해석되도록 톤 조절.
- 관계 발전 = "협박→굴복"이 아니라 "거리감→이해→가까워짐" 흐름.
- 비밀 예시: "사실 좋아하는 마음을 숨기고 있다", "고백할 타이밍을 재고 있다", "거절당할까 봐 먼저 다가가지 못한다", "상대를 위해 희생하려는 계획을 숨기고 있다"
""".strip()

    # 케이스 B: 어두운 소재만 있음 → 어두운 톤 유지하되 무의미 악행 금지
    if has_dark and not has_soft:
        return """
[톤 가드 - 어두운 긴장감 (필수 준수)]
- 강압/통제의 긴장감은 유지.
- 단, "일방적 폭력/무의미한 악행" 단독 수렴 금지.
- 캐릭터 행동에 "이유/논리/목적"이 분명해야 함.
- 비밀은 "목표/제약/대가"가 명확해야 함.
- 관계에 "긴장감/위험"은 있되, 스토리 전개 가능성은 열어둬야 함.
""".strip()

    # 케이스 C: 혼합 (순애 + 어두운 소재) → 합의적 긴장감
    if has_soft and has_dark:
        return """
[톤 가드 - 복합 소재 (필수 준수)]
- 감시/통제/거래는 "스토리 엔진(갈등 장치)"으로 사용 가능.
- 그러나 프레이밍은 "합의적 긴장감"으로 해석:
  - "협박 → 거래 → 점점 진심이 섞임"
  - "통제 → 보호인 척 → 실제로 걱정하게 됨"
- 비밀정보에 "전부 계산"으로 단정 금지. 진심/취약/보호 동기 최소 1개 포함.
- 관계 발전의 가능성은 열어둬야 함.
- 비밀 예시: "처음엔 거래였지만 점점 마음이 흔들린다", "통제하려 했지만 진심으로 걱정하게 됐다"
""".strip()

    # 태그가 있지만 위 조건에 해당 없음 → 가드 없음
    return ""


# ============================================================================
# 인칭 표현 후처리 (폴백 안전망)
# ============================================================================
# 의도:
# - 시스템 프롬프트 규칙을 AI가 어겼을 때 안전망으로 동작
# - "유저/사용자/이용자" → "당신"
# - "캐릭터/{{char}}/{{user}}" → 성향별 치환
# ============================================================================

def _sanitize_person_expressions(
    text: str,
    audience: str = "",
    char_name: str = "",
) -> str:
    """
    AI 출력에서 금지된 인칭 표현을 치환한다 (폴백/안전망).

    Args:
        text: AI 생성 텍스트
        audience: "남성향" | "여성향" | "전체" | ""
        char_name: 캐릭터 이름 (있으면 우선 사용)

    Returns:
        치환된 텍스트
    """
    if not text:
        return text

    import re

    result = text

    # 1) 유저 관련 메타 표현 → "당신"
    user_patterns = [
        (r'유저에게', '당신에게'),
        (r'유저를', '당신을'),
        (r'유저의', '당신의'),
        (r'유저가', '당신이'),
        (r'유저는', '당신은'),
        (r'사용자에게', '당신에게'),
        (r'사용자를', '당신을'),
        (r'사용자의', '당신의'),
        (r'사용자가', '당신이'),
        (r'사용자는', '당신은'),
        (r'이용자에게', '당신에게'),
        (r'이용자를', '당신을'),
        (r'이용자의', '당신의'),
        (r'이용자가', '당신이'),
        (r'이용자는', '당신은'),
        (r'플레이어에게', '당신에게'),
        (r'플레이어를', '당신을'),
        (r'플레이어의', '당신의'),
        (r'플레이어가', '당신이'),
        (r'플레이어는', '당신은'),
        (r'\{\{user\}\}', '당신'),
    ]
    for pattern, replacement in user_patterns:
        result = re.sub(pattern, replacement, result, flags=re.IGNORECASE)

    # 2) 캐릭터 관련 메타 표현 → 성향별 치환
    # 캐릭터 이름이 있으면 이름 사용, 없으면 성향별 대명사
    char_replace = char_name if char_name else (
        "그녀" if audience == "남성향" else (
            "그" if audience == "여성향" else "상대"
        )
    )

    char_patterns = [
        (r'캐릭터에게', f'{char_replace}에게'),
        (r'캐릭터를', f'{char_replace}를' if char_replace in ("그", "그녀") else f'{char_replace}을'),
        (r'캐릭터의', f'{char_replace}의'),
        (r'캐릭터가', f'{char_replace}가' if char_replace in ("그", "그녀") else f'{char_replace}이'),
        (r'캐릭터는', f'{char_replace}는' if char_replace in ("그", "그녀") else f'{char_replace}은'),
        (r'\{\{char\}\}', char_replace),
    ]
    for pattern, replacement in char_patterns:
        result = re.sub(pattern, replacement, result, flags=re.IGNORECASE)

    return result


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


def _build_local_random_profile(
    seed_text: str,
    tags_user: List[str],
    nonce: str,
    mode_slug: str = "roleplay",
) -> Tuple[str, str]:
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

    mode = str(mode_slug or "").strip().lower()
    if mode not in ("roleplay", "simulator"):
        mode = "roleplay"

    # ✅ 작품명(제목형) 로컬 폴백
    #
    # 배경/의도:
    # - 이미지 분석/LLM이 실패해도 "작품명/한줄소개" UX가 깨지지 않도록 한다.
    # - 한줄소개에 '키워드:' / '지금 떠오르는 상황...' 같은 대화 유도/부가문구가 섞이지 않게 한다.
    adj = ["고독한", "은밀한", "차가운", "달콤한", "위험한", "낯선", "조용한", "빛바랜", "검은", "푸른"]
    noun = ["검객", "안내자", "사서", "경호원", "마녀", "탐정", "괴도", "후계자", "여행자", "집사"]
    hook = ["약속", "밤", "계약", "비밀", "정원", "초대", "서약", "편지", "기억", "환영"]
    # ✅ 폴백도 '구체성'을 갖추도록(장소/규칙/사건 중 2개 이상을 노출)
    place = ["왕궁", "학교", "도서관", "지하", "카페", "기숙사", "던전", "게이트", "거리", "연구소"]
    rule = ["계약", "규칙", "위약금", "미션", "교칙", "서열", "등급", "난이도", "제한시간"]
    event = ["실종", "납치", "감금", "추적", "탈출", "복수", "재회", "각성", "역전", "거래"]
    # ✅ 프론트/프로필 제약(8~35자)과 일치하도록 길이 방어
    if mode == "simulator":
        title = f"{r.choice(adj)} {r.choice(noun)} 시뮬레이션".strip()
    else:
        title = f"{r.choice(adj)} {r.choice(noun)}의 {r.choice(hook)}".strip()
    title = _clip(title, 35) or "이름 없는 이야기"
    # 너무 짧아지면(혹시 모를 조합) 최소 길이 보정
    if len(title) < 8:
        title = _clip(f"{r.choice(adj)} {r.choice(hook)}", 35) or title

    # ✅ 한줄소개 폴백(20~300자, 4~5문장, 메타 문구 금지)
    tones = [
        "겉으론 담담하지만 속으로는 계산이 빠르다",
        "말수는 적지만 필요할 땐 잔인할 만큼 단호하다",
        "다정함 뒤에 반드시 지켜야 할 선이 있다",
        "유머로 긴장을 풀다가도 핵심에서 숨기지 않는다",
    ]
    p = r.choice(place)
    rr = r.choice(rule)
    ev = r.choice(event)
    # 4~5문장 구성(메타/운영 문구 없이, '훅'이 느껴지게)
    # - 300자 제한 안에서 문장수를 맞추기 위해 각 문장을 짧게 유지한다.
    if mode == "simulator":
        description = (
            f"{title}는(은) {p}에서 {ev}이(가) 시작되는 상황이다. "
            f"지금 목표는 {rr}을(를) 지키며 다음 턴으로 넘어가는 것이다. "
            f"{r.choice(tones)}. "
            f"선택 결과는 즉시 반영되고 리스크도 함께 커진다."
        )
    else:
        description = (
            f"{title}는(은) {p}에서 시작된 {ev}에 휘말렸다. "
            f"내 앞에는 {rr}이(가) 딱 하나 남았다. "
            f"{r.choice(tones)}. "
            f"오늘 밤, 한 번만 선을 넘으면 모든 게 바뀐다."
        )
    description = _clip(description.replace("\n", " ").strip(), 300)
    # 길이 하한 방어
    if len(description) < 20:
        description = _clip(f"{title}는(은) {p}의 {rr} 때문에 {ev}에 휘말린다.", 300)

    # 사용자가 직접 준 seed_text만 힌트로(자동생성 문구는 제외)
    try:
        seed_hint = _clip(seed_text, 120).strip()
        if seed_hint and (not _is_generated_seed_text(seed_hint)):
            description = _clip(f"{description} 요청 분위기: {seed_hint}", 320)
    except Exception:
        pass

    # ✅ 절대 '이미지/분위기/디테일' 같은 메타 폴백 문구를 넣지 않는다.
    return title, description or f"{title}는(은) {r.choice(place)}의 {r.choice(rule)} 때문에 {r.choice(event)}에 휘말린다."


SIMULATOR_PROMPT_SYSTEM = """### [SYSTEM_PROMPT_START]
# Role: 전문 인터랙티브 시뮬레이션 GM(운영자) 겸 시나리오 라이터

# Task: 장르/소재가 무엇이든 "턴 기반 시뮬"이 안정적으로 굴러가도록,
#       실사용 스타일의 '시뮬레이션 캐릭터 시트(=프롬프트)'를 생성한다.

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
7. **장르/문체 유연성(필수)**:
   - 장르는 "한정"하지 않는다. 입력된 태그/소개/세계관 톤에 맞춰 자연스럽게 맞춘다.
   - 번역투/교과서체/과도한 포멀 문체를 피하고, 한국어 실사용 문장으로 간결하게 쓴다(짧은 단락/현재 진행 중심 권장).
8. ✅ **(실사용 규율) 시뮬 운용 안정성**:
   - **목표/리스크/대가 고정**: 매 턴의 전개는 "지금 목표(1문장) + 즉시 리스크/제약(1문장) + 선택/행동" 흐름이 느껴져야 한다. 목표 없이 대화만 하는 턴을 만들지 마라.
   - **Fog of War(정보 비대칭)**: 지금 관찰/확인 가능한 정보만 확정하라. 숨겨진 인물/아이템/상태를 추측해 단정하지 않는다.
   - **유저 조종 금지(Anti-Puppeteering)**: 유저의 대사/행동/감정/속마음을 임의로 확정해 서술하지 않는다(유저가 명시한 것만 반영).
   - **즉시성(Immediate Resolution)**: 행동/선택의 결과를 같은 턴에서 바로 반영하라(불필요한 질질 끌기 금지).
   - **편의 전개 금지**: 시간 스킵/강제 리셋/데스 엔딩 편중 같은 운영 편의 전개를 피하고, 누적된 선택/단서/약속을 회수하는 결과로 몰아간다.
  - **Info Block Integrity(HUD 보존)**: HUD/상태창을 쓰는 경우, 형식/항목명/순서를 멋대로 바꾸거나 삭제하지 않는다. 변경은 "사실로 확인된 근거"가 있을 때만 값만 조정한다.
   - **증거 기반 자원 관리**: 인벤토리/단서/자원은 '획득/소모'가 서사 안에서 발생했을 때만 추가/삭제한다(갑툭튀 아이템 금지).

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

## 스토리 스타일 & 응답 규칙 (실사용 권장)
- **시점/문체**: {권장: 현재 진행형 중심. 3인칭/1인칭은 컨셉에 맞게 1개로 고정. 번역투 금지}
- **진행 원칙**: {턴마다 '상황 변화/사건/선택/결과'가 보이게. 장황한 설명/메타해설 남발 금지}
- **유저 사칭 방지(중요)**:
  - 유저의 대사/행동/감정/속마음을 AI가 임의로 확정해 서술하지 않는다(유저가 명시한 것만 반영).
  - 유저 입력을 그대로 재출력하지 않는다(필요 시 1줄 요약만).
- **응답 구조(권장)**: {(지문) → (대사) → (선택지/질문) → (HUD)}

## 유저(당신)와의 관계 (The Catalyst & Romance)
- **관계 설정**: {Connection Hook - 유저가 캐릭터의 운명을 결정짓는 '유일자'임을 강조}
- **성장 및 관계 개선 경로**: {Growth Path - 유저의 입지 상승과 이성적 호감이 결합되는 구체적 과정}
- **사이다 보상 예고**: {Payoff - 유저가 사건 해결 시 즉각적으로 얻게 될 권력/신분/아이템}
- **주변 인물**: {Key NPCs}

## HUD/상태창 (권장, 선택)
- **사용 여부**: {사용/미사용}
- **의도**: {턴/상태/목표를 '한눈에' 보여주는 요약. 서비스 UI(턴/진행률)가 이미 있으면 중복 노출이므로 더 간단히 유지}
- **표시 규칙(권장)**:
  - 응답 맨 아래에만 고정 출력(대사/지문과 분리)
  - 3~8줄, 짧은 항목 위주(장황한 로그 금지)
  - **기본 4항목**: Location / Time / Objective / Inventory
  - **가변 1~2항목(선택)**: 세계관에서 중요한 상태 변수(예: 평판/체력/마력/위험도 등)만 최소로 추가
  - **턴 표기**: `page. n` 형식으로 현재 턴(회차)을 표시(정확한 계산 강제 금지, 일관된 증가만 유지)
  - ✅ **보존 규칙(중요)**:
    - 항목명/순서/구분자를 고정 유지한다(Info Block Integrity).
    - Objective는 "지금 당장"의 목표 1개로 짧게 유지한다(여러 목표 나열 금지).
    - Inventory는 실제로 등장/획득/소모된 것만 유지한다(추측/창조 금지).
- **형식 예시(권장)**:
  - ```NOTE
    Location: {위치}
    Time: {시각}, {날씨}
    Objective: {목표}
    Inventory: {소지품}
    Status: {가변 상태 1~2개(선택)}
    page. n
    ```

### [SYSTEM_PROMPT_END]"""

ROLEPLAY_PROMPT_SYSTEM = """### [SYSTEM_PROMPT_START]
# Role: 전문 1:1 롤플레잉 시나리오 라이터
#
# Task: 유저가 즉시 몰입할 수 있고, "캐릭터성/말투/관계 리듬"이 쉽게 무너지지 않는
#       '실사용형 롤플레잉 캐릭터 시트'를 생성한다.
#
# 핵심 원칙(실사용 품질):
# - 시뮬레이터(턴/보상/진행률) "설계"와 섞지 않는다. (롤플에서 턴/보상/미션 설계 강제 금지)
# - 상태창(호감도/컨디션/관계거리 등)은 "선택"이다. 포함하더라도 **짧게**, **대화와 분리**, **복잡한 실시간 계산 강제 금지**.
# - ✅ (실사용 규율) 아래 규칙은 "몰입 붕괴"를 막는 최우선 제약이다:
#   - **현실/인과/확률(개연성 엔진)**: 사건은 감정 과장이나 작가적 편의가 아니라 '관찰 가능한 사실+인과+가능성'으로 굴러가야 한다.
#   - **Fog of War(정보 비대칭)**: 캐릭터/세계가 "지금 확실히 알 수 있는 정보"만 확정해 말한다. 숨겨진 정보/가려진 소지품/안 보이는 인물의 상태를 추측해 단정하지 않는다.
#   - **즉시성(Immediate Resolution)**: 유저의 행동/대사에 대한 반응과 결과를 미루지 말고, 같은 턴에서 즉시 묘사한다(불필요한 질질 끌기 금지).
#   - **유저 조종 금지(Anti-Puppeteering)**: 유저의 대사/행동/감정/속마음을 AI가 임의로 확정해 서술하지 않는다(유저가 명시한 것만 반영).
#   - **시간 스킵/리셋 남발 금지**: 급작스런 시간 점프, 강제 리셋, 데스 엔딩 편중 같은 "편의 전개"는 피하고, 누적된 선택/약속/소품을 회수해 마무리감을 만든다.
#   - **Info Block Integrity(상태창 보존)**: 상태창을 쓰는 경우, '형식/항목명/순서'를 멋대로 바꾸거나 삭제하지 않는다. 변경은 "대화/행동으로 확인된 근거"가 있을 때만 값만 조정한다.
# - OOC(Out Of Character)는 '운영용 지시'가 필요할 때만 사용한다. 형식은 `[OOC: ...]` 또는 `(OOC: ...)` 중 하나로 통일하고, 캐릭터가 임의로 남발하지 않는다.
#   - (선택) 유저가 **명시적으로** `[OOC: 엔딩]` 또는 `[OOC: 에필로그]`를 요청하면, 현재까지의 관계/약속/소품을 회수하는 **짧은 에필로그 1컷(지문+대사 혼합)**으로 마무리할 수 있다(평소에는 엔딩을 강제하지 않음).
# - 캐릭터는 항상 캐릭터로 말한다. AI/시스템/규칙을 메타로 설명하지 않는다.
# - 유저가 한두 문장만 던져도 캐릭터가 "상황-반응-다음 질문"으로 대화를 굴릴 수 있게 훅/관계 규칙을 명확히 한다.
#
# Output Template (국내 실사용 템플릿 구조 기반):
#
# [캐릭터 생성 프롬프트]
## 1. 핵심 정체성 (Core Identity)
- **이름**: {Name}
- **나이**: {Age}
- **직업/역할**: {Job/Role}
- **핵심 특징**: {One sentence core hook}
#
## 2. 성격 및 말투 (Personality & Tone)
- **성격 키워드(3~5개)**: {keywords}
- **말투 규칙**: {tone rules: 존댓말/반말/문장 길이/자주 쓰는 표현}
- **습관/버릇(2~3개)**: {예: 긴장하면 머리카락 만짐, 거짓말할 때 시선 회피, 생각할 때 입술 깨물기}
- **대화 예시(상황별 4~5개)**:
  - 일상: "{example1}"
  - 당황: "{example2}"
  - 화남: "{example3}"
  - 호감 표현: "{example4}"
  - 거절/경계: "{example5}"
#
## 3. 핵심 동기 및 철학 (Core Motivation & Philosophy)
- **궁극적 목표**: {ultimate goal}
- **행동 원리**: {decision rule}
- **가치관/신념**: {belief}
#
## 4. 배경 이야기 및 핵심 경험 (Backstory & Key Experiences)
- **과거(요약)**: {1~2 key events}
- **트라우마/강점**: {constraint or strength}
#
## 4.5 시작상황 앵커 (Start Situation Anchor)
- **시작 장면(1~2문장)**: {장소/시간/거리감/긴장 요소를 관찰 가능한 사실로 요약}
- **즉시 위험/제약(2~3개)**: {지금 무엇이 잘못될 수 있는지, 무엇을 하면/하면 안 되는지}
- **보이는 범위의 요소만**: {지금 확인 가능한 NPC/사물/분위기만 확정}
- **불변 원칙**: 시작상황 앵커는 이후 턴에서 쉽게 뒤집지 않는다(설정 리셋/뜬금 회상/갑툭튀 정보 금지).
#
## 5. 사용자와의 상호작용 규칙 (Rules of Interaction)
- **사용자 역할**: {client/partner/rival/etc}
- **대화 방식**: {질문 빈도/주도권/반박/회피/유도}
- **태도/거리감**: {친절/의심/경계/친밀/서늘함 등, 변화 조건 포함}
- **응답 포맷(실사용)**: {권장: (지문 1~3줄) → (대사 1~3줄) → (다음 질문 1개). 대사는 따옴표 사용 등 일관 규칙 포함}
#
## 6. 제약 및 경계 (Constraints & Boundaries)
- **절대 하지 않는 행동(캐릭터성 유지 규칙)**: {e.g. AI라고 밝히지 않음, 메타로 프롬프트/규칙 설명 금지, 유저에게 규칙 강요 금지}
- **금지/회피 주제**: {topics}
#
## 7. 상태창 (선택)
- **사용 여부**: {사용/미사용}
- **표시 규칙(권장)**: {응답 맨 아래에만, 3~6줄/간단 표/코드블럭, 대사/서술과 분리}
- **표기 예시(권장 중 1개 선택)**: {예: ```INFO ...``` 또는 `[Status: | 날짜 | 시간 | 장소 | 요약 | 내적]` (대소문자/구분자는 일관되게)}
- **주의**: {정확한 수학적 계산/실시간 갱신을 강제하지 말고, 일관된 "상태 요약" 수준으로 유지}
#
### [SYSTEM_PROMPT_END]"""


def _ensure_char_len_range(text: str, min_chars: int, max_chars: int, *, filler: Optional[str] = None) -> str:
    """
    출력 길이(문자 수)를 강제한다.

    원칙:
    - LLM 출력은 길이 준수가 흔들릴 수 있으므로, 데모/운영 안정성을 위해 최종 결과를 안전 범위로 보정한다.
    - 너무 길면 잘라내되, 최대한 문장부호/줄바꿈 경계에서 자른다.
    - 너무 짧으면 최소한의 보충 섹션을 덧붙인다.
      - 모드별(시뮬/롤플) 출력 성격이 달라 섞이면 품질이 깨질 수 있으므로, 필요 시 filler로 보강 블록을 주입한다.
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
        # ✅ 정책 변경(중요): 짧으면 "덧붙이기"로 길이를 맞추지 않는다.
        #
        # 이유:
        # - 보강 블록(예: "## 추가 디테일(보강)")을 덧붙이는 방식은 반복/하드코딩 티가 나고,
        #   내용이 실제로 확장되지 않아 품질이 떨어질 수 있다.
        # - 짧은 케이스는 상위 호출자(generate_quick_*_prompt)의 "재시도 생성(확장 지시)"로 해결한다.
        #
        # 결과:
        # - 여기서는 원문을 그대로 반환하여, caller가 길이 조건 미달을 감지/재시도할 수 있게 한다.
        return s.strip()

    return s.strip()


ROLEPLAY_CHARLEN_FILLER = (
    "\n\n## 추가 디테일(보강)\n"
    "- **오프닝 훅**: 지금 당장 시작되는 상황을 1개 더 구체화한다(장소/시간/거리감/갈등의 씨앗).\n"
    "- **시작상황 앵커(중요)**: 관찰 가능한 사실 기반으로 '시작 장면 1~2문장 + 즉시 위험/제약 2~3개'를 고정하고, 이후 턴에서 설정을 쉽게 뒤집지 않는다(Fog of War/시간 스킵 금지).\n"
    "- **말투 룰 확장**: 문장 호흡, 존댓말/반말, 자주 쓰는 표현 2~3개, 감정 트리거 1개를 더 명확히 한다.\n"
    "- **관계 리듬**: 2~4턴마다 거리감이 변하는 조건을 2개 이상 추가한다(가까워짐/멀어짐/경계/질투/협력).\n"
    "- **응답 구조**: (지문 1~3줄) → (대사 1~3줄) → (다음 질문 1개) 규칙을 명시한다.\n"
    "- **상태창 사용 시 보존**: 상태창(선택)을 쓰면 형식/항목명/순서를 멋대로 바꾸거나 삭제하지 않고, '대화/행동으로 확인된 근거'가 있을 때만 값만 조정한다(Info Block Integrity).\n"
    "- **경계/금기**: 캐릭터가 절대 하지 않는 행동 2~4개를 더 구체화한다.\n"
)


def _resolve_audience_label_from_tags(tags: List[str]) -> str:
    """
    태그 목록에서 '성향(남성향/여성향/전체)' 라벨을 최대한 안전하게 추출한다.

    의도/원리:
    - 30초 생성에서는 audience_slug가 tags에 포함된다(SSOT: characters.py).
    - 위저드에서는 tags가 비어있을 수 있으므로, 없으면 '미지정'으로 둔다(방어).
    """
    try:
        m = {
            "남성향": "남성향",
            "여성향": "여성향",
            "전체": "전체",
            # 일부 외부/수입 태그(운영 방어)
            "남성": "남성향",
            "여성": "여성향",
            "male": "남성향",
            "female": "여성향",
            "all": "전체",
        }
        for t in (tags or []):
            s = _safe_text(t).strip()
            if not s:
                continue
            if s in m:
                return m[s]
            lowered = s.lower()
            if lowered in m:
                return m[lowered]
        return "미지정"
    except Exception:
        return "미지정"


def _audience_generation_hints(*, audience_label: str, mode: str) -> str:
    """
    남성향/여성향/전체(태그) 힌트를 생성 프롬프트에 주입하기 위한 짧은 가이드 텍스트를 반환한다.

    의도/원리(기능 추가, 최소 침습):
    - 경쟁사/커뮤니티 관찰에서 '남성향/여성향'은 단순 라벨이 아니라 "서사 동력"과 "선호 페이싱"을 바꾼다.
    - 동일 mode(roleplay/simulator) 안에서도 남/여 성향이 다르면 톤이 달라져야 품질 체감이 올라간다.
    - 과도한 고정관념/노골 표현은 금지하고, **게임/서사 구조**(목표/리스크/관계/거리감/보상) 관점만 가볍게 조정한다.
    """
    a = _safe_text(audience_label).strip()
    m = _safe_text(mode).strip().lower()
    if a not in ("남성향", "여성향", "전체"):
        a = "미지정"
    if m not in ("simulator", "roleplay"):
        m = "roleplay"

    if a == "미지정" or a == "전체":
        # 균형(기본)
        return (
            "- 성향이 '전체/미지정'이면, 과도한 특정 취향 고정 없이 **목표/리스크(진행)**와 **관계/감정선(몰입)**을 균형 있게 구성하라."
        )

    if m == "simulator":
        if a == "남성향":
            return (
                "- 성향이 '남성향'이면, **목표 달성/성장/경쟁/획득/보상**이 분명하게 느껴지게 설계하라.\n"
                "  - 선택지는 효율/리스크/자원 관점으로 고민하게 만들고, 진행이 막히지 않게 다음 행동을 선명히 제시하라."
            )
        return (
            "- 성향이 '여성향'이면, **목표/리스크**를 유지하되 **관계/평판/신뢰/거리감 변화**가 선택의 결과로 체감되게 설계하라.\n"
            "  - 선택지는 감정적 대가/관계 변화가 명확히 드러나게(대사/행동/반응) 구성하라."
        )

    # roleplay
    if a == "남성향":
        return (
            "- 성향이 '남성향'이면, 관계 훅이 있더라도 **갈등/대립/임무/위기** 같은 행동 동력이 분명해야 한다.\n"
            "  - 대화는 군더더기 없이 상황이 앞으로 굴러가게, 선택/결과가 드러나는 흐름으로 설계하라."
        )
    return (
        "- 성향이 '여성향'이면, **감정선/관계의 미세한 거리감 변화**(긴장→완화→다시 긴장)를 대화 리듬으로 설계하라.\n"
        "  - 같은 사건이라도 캐릭터의 반응(말투/호칭/시선/행동)이 단계적으로 변하게 하라."
    )


def _prepend_prompt_meta_header(
    prompt_text: str,
    *,
    title: str,
    one_line_intro: str,
    tags: List[str],
    mode_label_ko: str,
) -> str:
    """
    생성된 프롬프트(world_setting) 맨 앞에 메타 헤더를 1회만 주입한다.

    의도/원리(운영 안정):
    - 모델이 '내 작품/성향/타입/한줄소개'를 잊고 붕괴하는 케이스를 줄인다.
    - LLM이 형식을 못 지켜도 서버가 강제로 헤더를 붙여 SSOT로 유지한다.
    - 이미 헤더가 붙어있으면 중복 주입하지 않는다.
    """
    body = _safe_text(prompt_text)
    if body.lstrip().startswith("작품명:"):
        return body

    title2 = _clip(title, 100).replace("\r", " ").replace("\n", " ").strip()
    # ✅ UX 개선(중요): 프론트에서 description에 [작품 컨셉(추가 참고)]를 붙여 전달할 수 있다.
    # - 헤더까지 동일 내용을 길게 반복하면 "재탕"으로 느껴져 품질 체감이 급격히 떨어진다.
    # - 따라서 헤더의 한줄소개는 "순수 소개"만, 짧게 클립해 보여준다(생성 본문은 그대로 유지).
    intro_src = _clip(one_line_intro, 1200)
    try:
        # concept가 포함되어 있으면 앞부분만 사용(헤더용)
        if "[작품 컨셉(추가 참고)]" in intro_src:
            intro_src = intro_src.split("[작품 컨셉(추가 참고)]", 1)[0]
        # 흔한 입력 노이즈(마지막에 '성향'만 남는 케이스) 제거
        intro_src = intro_src.rstrip().rstrip("성향").rstrip()
    except Exception:
        pass
    intro2 = _clip(intro_src, 320).replace("\r", " ").replace("\n", " ").strip()
    audience = _resolve_audience_label_from_tags(tags)
    mode2 = _safe_text(mode_label_ko).strip() or "미지정"

    header = (
        f"작품명: {title2 or '미지정'}\n"
        f"성향: {audience}\n"
        f"타입: {mode2}\n"
        f"한줄소개: {intro2 or '미지정'}"
    ).strip()
    return (header + "\n\n" + body.lstrip()).strip()


def _is_incomplete_roleplay_prompt_output(text: str) -> bool:
    """
    롤플레잉 프롬프트가 '부실/미완성'으로 잘려 내려오는 케이스를 방어적으로 감지한다.

    의도/원리:
    - LLM이 max_tokens 한도에서 잘리면 문장 중간에서 끊기거나, 템플릿의 후반 섹션이 통째로 누락된다.
    - 단순 길이만으로는(3000자 이상) 이런 케이스를 걸러내기 어렵다.
    - 따라서 "필수 섹션 존재 + 중복 블록 여부 + 끝맺음"을 보수적으로 체크해 재시도를 유도한다.
    """
    s = _safe_text(text).strip()
    if not s:
        return True
    # 필수 섹션 누락(후반부가 잘린 케이스가 가장 치명적)
    required = (
        "## 1.",
        "## 2.",
        "## 3.",
        "## 5. 사용자와의 상호작용 규칙",
        "## 6. 제약 및 경계",
    )
    for r in required:
        if r not in s:
            return True
    # 중복 블록(품질 저하/버그 체감)
    if s.count("## 추가 디테일(보강)") >= 2:
        return True
    # 문장 중간 절단 흔적(아주 단순한 끝맺음 체크)
    tail = s[-1:]
    if tail and tail not in ("\n", ".", "!", "?", "…", "”", "’", ")", "]", "}"):
        # 한국어는 마침표 없이 끝날 수 있지만, "상대"처럼 단어에서 끊기는 케이스를 막기 위한 최소 방어
        if len(s) > 1200 and not s.endswith(("다", "다.", "요", "요.", "함", "함.", "됨", "됨.")):
            return True
    return False


async def generate_quick_simulator_prompt(
    name: str,
    description: str,
    max_turns: int,
    allow_infinite_mode: bool,
    tags: List[str],
    ai_model: str,
    sim_variant: Optional[str] = None,
    sim_dating_elements: Optional[bool] = None,
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
    audience = _resolve_audience_label_from_tags(tags or [])
    try:
        mt = int(max_turns or 0)
    except Exception:
        mt = 0
    if mt < 50:
        mt = 200
    if mt > 5000:
        mt = 5000
    inf = bool(allow_infinite_mode)
    sim_variant_norm = str(sim_variant or "").strip().lower()
    sim_variant_norm = "dating" if sim_variant_norm == "dating" else ("scenario" if sim_variant_norm == "scenario" else "")
    dating_elements = bool(sim_dating_elements) or (sim_variant_norm == "dating")

    model_norm = (_safe_text(ai_model) or "gemini").lower()
    if model_norm not in ("gemini", "claude", "gpt"):
        model_norm = "gemini"
    model: AIModel = model_norm  # type: ignore[assignment]

    # ✅ 시뮬 유형/미연시 요소(옵션) 블록
    sim_flavor_block = ""
    try:
        if dating_elements:
            # 미연시(공략/루트/호감도) 중심: "운영 공지/스펙 나열"로 흐르지 않게 금지 규칙을 같이 준다.
            sim_flavor_block = (
                "\n[시뮬 유형(추가 지시)]\n"
                "- 시뮬 유형: 미연시(연애 시뮬, 공략/루트 중심)\n"
                "- 반드시 **핵심 공략 인물 3~6명**을 제시하라(각 인물 1~2줄 훅).\n"
                "- 각 공략 인물마다 **호감도 이벤트/분기(최소 2개)**를 '사건 트리거' 또는 '타임라인'에 녹여라.\n"
                "- 유저는 '플레이어'이며 선택으로 루트가 바뀐다. (단, 유저 조종 금지)\n"
                "- 금지: 업데이트/공지/명령어/스펙(이미지 N장/등장인물 N명) 나열, '[인원]' 같은 운영형 괄호 문구\n"
            )
        elif sim_variant_norm == "scenario":
            sim_flavor_block = (
                "\n[시뮬 유형(추가 지시)]\n"
                "- 시뮬 유형: 시나리오(사건/목표/제약/보상 중심)\n"
            )
    except Exception:
        sim_flavor_block = ""

    user_prompt = f"""
[프로필 입력(근거)]
- 이름: {base_name}
- 소개: {base_desc}
- 태그: {tags_block or "없음"}
- 성향: {audience}

[출력 요구사항]
- 위 SYSTEM 가이드/템플릿을 따라 '시뮬레이션 캐릭터 시트'를 작성하라.
- 반드시 한국어로 작성하라.
- 출력은 JSON 금지. 순수 텍스트(마크다운 섹션/불릿 허용).
  - 코드블록은 원칙적으로 금지하되, **'HUD/상태창(권장, 선택)' 섹션에서만** `NOTE` 코드블록 1개까지 허용한다(남발 금지).
    - 3000~6000자(공백 포함) 사이로 작성하라. 너무 짧으면 서사/능력/플롯/관계/타임라인을 더 확장하라.
- **문체/스토리 스타일**: 국내 실사용 시뮬 톤에 맞춰 자연스러운 한국어로 쓴다(번역투/과도한 포멀 금지, 사건/진행 중심).
- 이름은 입력된 이름을 그대로 사용하라(형식 유지).
- ✅ 추가 필수 지시(게임 설계):
  - 이 캐릭터 챗은 총 **{mt}턴**을 기준으로 진행된다.
  - 이용자가 입력한 프롬프트(세계관/상황)에 맞게 **턴당 사건(갈등/미션/선택)**을 흥미롭고 몰입감 있게 기획하라.
  - 각 사건에는 유저가 체감할 수 있는 **보상(정보/단서/관계 진전/권한/아이템 등)**을 설계하라.
  - 위 설계를 프롬프트 본문에 **[턴 진행/사건 & 보상 설계]** 섹션으로 반드시 포함하라.
  - 무한모드 허용: {"허용" if inf else "미허용"} (정책을 본문에 명시하라).
{sim_flavor_block}

[성향 힌트(중요)]
{_audience_generation_hints(audience_label=audience, mode="simulator")}
""".strip()

    prompt = f"{SIMULATOR_PROMPT_SYSTEM}\n\n{user_prompt}"

    # 1차 생성
    # ✅ 성능 최적화: 처음부터 충분한 토큰을 주어 재시도 확률을 최소화한다.
    # - 3000~6000자 목표, 한국어 1자 ≈ 1~2토큰 → max_tokens=4500이면 대부분 1회 성공
    out = await get_ai_completion(prompt=prompt, model=model, temperature=0.4, max_tokens=4500)
    out = _prepend_prompt_meta_header(
        out,
        title=base_name,
        one_line_intro=base_desc,
        tags=tags or [],
        mode_label_ko="시뮬레이터",
    )
    out = _ensure_char_len_range(out, min_chars=3000, max_chars=6000)

    # 2차 보정(너무 짧은 경우만 1회 재시도)
    # ✅ 중요: "보강 블록 덧붙이기"가 아니라, 기존 섹션을 확장해서 길이를 맞춘다.
    if len(out) < 3000 or out.count("## 추가 디테일(보강)") >= 2:
        retry = (
            f"{SIMULATOR_PROMPT_SYSTEM}\n\n"
            f"{user_prompt}\n\n"
            "[추가 지시]\n"
            "- 직전 결과가 3000자 미만이다. **기존 섹션을 확장**해서 3500~4500자 사이로 다시 작성하라.\n"
            "- 금지: 같은 섹션/블록을 복붙해 반복하지 말 것(특히 '추가 디테일(보강)' 같은 동일 블록 반복 금지).\n"
            "- 사건 트리거/타임라인/보상/제약/관계 변화를 구체적으로 늘려라."
        )
        out2 = await get_ai_completion(prompt=retry, model=model, temperature=0.4, max_tokens=3600)
        out2 = _prepend_prompt_meta_header(
            out2,
            title=base_name,
            one_line_intro=base_desc,
            tags=tags or [],
            mode_label_ko="시뮬레이터",
        )
        out = _ensure_char_len_range(out2, min_chars=3000, max_chars=6000)
        # ✅ 최종 방어: 그래도 짧으면 "덧붙이기"가 아니라 1회 더 재생성으로 확장
        if len(out) < 3000 or out.count("## 추가 디테일(보강)") >= 2:
            retry2 = (
                f"{SIMULATOR_PROMPT_SYSTEM}\n\n"
                f"{user_prompt}\n\n"
                "[추가 지시]\n"
                "- 직전 결과가 여전히 3000자 미만이다. 섹션을 삭제/축약하지 말고, 각 섹션에 구체 사례/갈등/보상/규칙을 더 추가해 반드시 3200~4800자 사이로 다시 작성하라.\n"
                "- 금지: 동일 문장/섹션을 복사해 반복하지 말라. (중복 금지)"
            )
            out3 = await get_ai_completion(prompt=retry2, model=model, temperature=0.4, max_tokens=4200)
            out3 = _prepend_prompt_meta_header(
                out3,
                title=base_name,
                one_line_intro=base_desc,
                tags=tags or [],
                mode_label_ko="시뮬레이터",
            )
            out = _ensure_char_len_range(out3, min_chars=3000, max_chars=6000)

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
    audience = _resolve_audience_label_from_tags(tags or [])
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
- 성향: {audience}

[출력 요구사항]
- 위 SYSTEM 가이드/템플릿을 따라 '1:1 롤플레잉 캐릭터 시트'를 작성하라. (시뮬/턴/보상/진행률 설계 금지)
- 반드시 한국어로 작성하라.
- 출력은 JSON 금지. 순수 텍스트(마크다운 섹션/불릿 허용).
  - 코드블록은 원칙적으로 금지하되, **'상태창(선택)' 섹션에서만** 간단 표기 목적의 `INFO` 코드블록을 1개까지 허용한다(남발 금지).
    - 3000~6000자(공백 포함) 사이로 작성하라. 너무 짧으면 성격/말투 규칙/관계 훅/상호작용 규칙/경계 항목을 더 확장하라.
- 이름은 입력된 이름을 그대로 사용하라(형식 유지).
- ✅ 추가 필수 지시(실사용 안정성):
  - 캐릭터는 항상 캐릭터로 말하라. AI/시스템/프롬프트/규칙을 메타로 설명하지 말라.
  - 사용자 입력이 짧아도 대화가 굴러가게, **"지금 당장 시작되는 훅(상황)"**을 1개 명확히 포함하라.
  - 2~4턴마다 관계의 거리감이 미세하게라도 변하도록(가까워짐/멀어짐/경계/질투/협력 등) 변화 조건을 '상호작용 규칙'에 포함하라.

[성향 힌트(중요)]
{_audience_generation_hints(audience_label=audience, mode="roleplay")}
""".strip()

    prompt = f"{ROLEPLAY_PROMPT_SYSTEM}\n\n{user_prompt}"

    # ✅ 성능 최적화: 처음부터 충분한 토큰을 주어 재시도 확률을 최소화한다.
    # - 3000~6000자 목표, 롤플은 후반 섹션(상호작용/경계/상태창)까지 완성 필요
    # - max_tokens=4500이면 대부분 1회 성공, 재시도 불필요
    out = await get_ai_completion(prompt=prompt, model=model, temperature=0.4, max_tokens=4500)
    out = _prepend_prompt_meta_header(
        out,
        title=base_name,
        one_line_intro=base_desc,
        tags=tags or [],
        mode_label_ko="롤플레잉",
    )
    out = _ensure_char_len_range(out, min_chars=3000, max_chars=6000, filler=ROLEPLAY_CHARLEN_FILLER)

    # 2차 보정(너무 짧은 경우만 1회 재시도)
    # ✅ 중요: "보강 블록 덧붙이기"가 아니라, 기존 섹션을 확장해서 길이를 맞춘다.
    if len(out) < 3000 or _is_incomplete_roleplay_prompt_output(out):
        retry = (
            f"{ROLEPLAY_PROMPT_SYSTEM}\n\n"
            f"{user_prompt}\n\n"
            "[추가 지시]\n"
            "- 직전 결과가 3000자 미만이다. **기존 섹션을 확장**해서 3500~4500자 사이로 다시 작성하라.\n"
            "- 금지: 같은 섹션/블록을 복붙해 반복하지 말 것(특히 '추가 디테일(보강)' 같은 동일 블록 반복 금지).\n"
            "- 훅/관계 변화 조건/말투 규칙/경계 항목을 더 촘촘히 구체화하라.\n"
            "- 반드시 후반 섹션(상호작용 규칙/제약 및 경계/상태창(선택))까지 모두 포함하고, 문장 중간에서 끊기지 말라."
        )
        out2 = await get_ai_completion(prompt=retry, model=model, temperature=0.4, max_tokens=3600)
        out2 = _prepend_prompt_meta_header(
            out2,
            title=base_name,
            one_line_intro=base_desc,
            tags=tags or [],
            mode_label_ko="롤플레잉",
        )
        out = _ensure_char_len_range(out2, min_chars=3000, max_chars=6000, filler=ROLEPLAY_CHARLEN_FILLER)
        # ✅ 최종 방어: 그래도 짧으면 "덧붙이기"가 아니라 1회 더 재생성으로 확장
        if len(out) < 3000 or _is_incomplete_roleplay_prompt_output(out):
            retry2 = (
                f"{ROLEPLAY_PROMPT_SYSTEM}\n\n"
                f"{user_prompt}\n\n"
                "[추가 지시]\n"
                "- 직전 결과가 여전히 3000자 미만이다. 섹션을 삭제/축약하지 말고, 말투 규칙/관계 훅/상호작용 규칙/경계 항목을 더 구체적으로 추가해 반드시 3200~4800자 사이로 다시 작성하라.\n"
                "- 금지: 동일 문장/섹션을 복사해 반복하지 말라. (중복 금지)\n"
                "- 시뮬/턴/보상/진행률 설계는 금지(롤플 유지).\n"
                "- 반드시 섹션 1~7을 모두 채우고, 마지막은 완전한 문장으로 끝내라."
            )
            out3 = await get_ai_completion(prompt=retry2, model=model, temperature=0.4, max_tokens=4200)
            out3 = _prepend_prompt_meta_header(
                out3,
                title=base_name,
                one_line_intro=base_desc,
                tags=tags or [],
                mode_label_ko="롤플레잉",
            )
            out = _ensure_char_len_range(out3, min_chars=3000, max_chars=6000, filler=ROLEPLAY_CHARLEN_FILLER)

    return out


async def generate_quick_stat_draft(
    *,
    name: str,
    description: str,
    world_setting: str,
    mode: Optional[str] = None,
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
    import uuid

    base_name = _clip(name, 100)
    base_desc = _clip(description, 3000)
    ws = _clip(world_setting, 1800)
    tags_block = ", ".join([_clip(t, 40) for t in (tags or []) if _safe_text(t)])[:400]

    model_norm = (_safe_text(ai_model) or "gemini").lower()
    if model_norm not in ("gemini", "claude", "gpt"):
        model_norm = "gemini"
    model: AIModel = model_norm  # type: ignore[assignment]

    def _norm_mode(v: Any) -> str:
        """
        mode 값을 방어적으로 정규화한다.

        의도/원리:
        - 프론트/요청은 'roleplay'/'simulator'를 사용한다.
        - 누락/오염 값이 와도 안전하게 roleplay로 폴백한다.
        """
        t = _safe_text(v).strip().lower()
        if t == "simulator":
            return "simulator"
        return "roleplay"

    base_mode = _norm_mode(mode)

    # ✅ RP/시뮬 스탯 초안 분기(요구사항)
    # - simulator: 자원/위험/목표 같은 수치형 관리가 빈번하므로 stats 기본 생성.
    # - roleplay: 상태/관계의 "바닥선"을 올리기 위해, 과도하지 않은 최소 stats를 생성(운영 안정).
    system = (
        """당신은 게임/비주얼노벨/미연시 개발자입니다.
아래 입력을 참고해 '스탯 설정' 초안을 JSON으로만 반환하세요.

반드시 지켜야 할 규칙:
- 출력은 JSON 객체 1개만. (설명/코드블록/여분 텍스트 금지)
- 스키마: { "stats": [ ... ] }
- ✅ 시뮬 기본값(요구사항): stats는 **3~4개**. (최소 3개, 최대 4개)
- ✅ 스탯 설계 원칙(운영 안정화):
  - 가능한 경우 **호감도** 1개는 포함하되(상황에 안 맞으면 제외), 나머지는 세계관/목표에 직결되는 2~3개로 구성하라.
    - 예: 단서/의심/위험/명성/체력/정신력/자원/시간압박 등
  - ✅ (상태창/HUD 안정화) 출력이 흐트러지지 않게:
    - 스탯은 **숫자(정수)** 로 표현 가능한 항목만 만들 것(인물목록/장문 상태문/서술형 HUD 금지).
    - 스탯 name은 **짧고 일반명사**로. 특정 서비스명/사이트명/플랫폼명/고유명사 사용 금지.
    - 값의 변화는 **사건/행동으로 확인된 근거가 있을 때만** 일어나야 한다(갑툭튀 변화/임의 조작 금지).
    - 1턴에 과도한 폭증/폭락 금지. 일반적으로 변화량은 “작게(-2~+2 또는 -5~+5)”를 기본으로 두고, 큰 변화는 ‘명확한 사건’이 있을 때만.
    - description에는 **언제/무슨 행동에서 오르는지(+), 언제/무슨 행동에서 떨어지는지(-)** 를 1~2문장으로 명확히 적어라.
    - ✅ 스탯 유형별 효과 추가(작품 특성에 맞게):
      - **관계/감정 계열 스탯**(호감도/신뢰/유대/경계 등): 수치 구간별 캐릭터 행동/태도 변화를 포함하라.
        예: "하위 구간 경계 모드(존댓말, 거리 유지), 상위 구간 친밀 모드(반말, 장난)"
      - **그 외 스탯**(자원/상태/진행도/능력치 등): 임계값 도달 시 게임 진행에 영향을 주는 효과를 포함하라.
        예: "하위 구간 위험/불리 상태, 0 도달 시 실패/게임 오버" 또는 "상위 구간 특전/승리 조건 해금"
      - 작품 설정(프롬프트/태그/소개)과 스탯 이름을 보고, **그 작품 세계관에 어울리는 스탯**을 생성하라. 예시는 참고용일 뿐이며, 작품마다 다른 스탯이 나와야 한다.
  - ✅ (권장 범위):
    - 관계/호감도 계열은 0~100 또는 0~10 같은 직관적 범위를 권장(세계관에 맞게 택1).
    - “단서/의심/위험” 같은 진행형은 0~10 또는 0~100 중 택1로 단순화하라.
    - base_value는 보통 **중간값(0~10이면 5, 0~100이면 50 전후)**에서 시작하되, 설정상 이유가 있을 때만 극단값으로 시작하라.
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
        if base_mode == "simulator"
        else """당신은 롤플레잉/캐릭터챗 제작자입니다.
아래 입력을 참고해 '스탯 설정' 초안을 JSON으로만 반환하세요.

반드시 지켜야 할 규칙:
- 출력은 JSON 객체 1개만. (설명/코드블록/여분 텍스트 금지)
- 스키마: { "stats": [ ... ] }
- ✅ **호감도** 1개는 반드시 포함하라(필수).
- 그 외 스탯은 작품의 느낌/세계관을 보고 0~2개 추가할 수 있다(총 1~3개).
  - 예: 학원물이면 학점, 판타지면 마력/정신력, 현대물이면 신뢰/경계 등
  - 작품 설정(프롬프트/태그/소개)과 캐릭터 특성을 보고 자연스럽게 추가하라.
- 스탯은 **정수** 기반이어야 하며, 설명은 짧고 명확해야 한다.
- 스탯 name은 **짧고 일반명사**만 허용(서비스명/사이트명/플랫폼명/고유명사 금지).
- 값 변화는 **사건/행동으로 확인된 근거가 있을 때만**. 1턴 급변 금지(보통 -2~+2 또는 -5~+5).
- description에는 반드시 다음을 포함:
  - (+) 오르는 트리거 1개
  - (-) 떨어지는 트리거 1개
  - ✅ 관계형 스탯(호감도/신뢰/유대 등)인 경우: 수치 구간별 캐릭터 행동/태도 변화를 추가하라.
    예: "하위 구간 경계 모드(존댓말, 거리 유지), 상위 구간 친밀 모드(반말, 장난)"
    - 작품 설정과 캐릭터 성격에 맞게 자연스럽게 작성하라. 구체적 수치(%)보다는 "하위/상위 구간" 또는 "낮을 때/높을 때" 같은 표현을 사용하라.
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
    )

    user = f"""
[입력]
- 캐릭터 이름: {base_name}
- 캐릭터 소개: {base_desc}
- 태그: {tags_block or "없음"}
- 프롬프트(요약): {ws}

[요구]
- 위 설정에 자연스럽게 어울리는 스탯을 3~4개 제안하라. (시뮬 기본값)
- 대부분의 시뮬레이션에서 기본이 되는 '호감도' 1개는 포함해도 좋다(상황에 안 맞으면 제외 가능).
""".strip()

    def _has_meta_stats(items: Any) -> bool:
        """
        스탯 초안에 메타/운영성 문구가 섞였는지 빠르게 감지한다.

        의도:
        - 크롤링 샘플 영향으로 '운영/안내성' 문구가 stats에 섞이는 것을 방지한다.
        - 1회 재생성 판단 기준으로만 사용한다(KISS).
        """
        if not isinstance(items, list):
            return False
        for it in items:
            if not isinstance(it, dict):
                continue
            nm = _safe_text(it.get("name") or "")
            ds = _safe_text(it.get("description") or "")
            if _has_output_meta_wording(nm) or _has_output_meta_wording(ds):
                return True
        return False

    try:
        # 스탯 JSON이 중간 절단되면 전체 폴백/빈 결과로 이어지므로 출력 여유를 높인다.
        raw = await get_ai_completion(prompt=f"{system}\n\n{user}", model=model, temperature=0.3, max_tokens=1600)
        blob = _extract_json_object(raw)
        if not blob:
            return []
        blob = _fix_trailing_commas(blob)
        data = json.loads(blob) if blob else {}
        stats = data.get("stats", [])
        need_retry_count = (base_mode == "simulator") and (isinstance(stats, list)) and (len(stats) < 3)
        if _has_meta_stats(stats) or need_retry_count:
            # ✅ 파이썬 문자열 조립 안전(문법/가독성):
            # - implicit concat + 조건부 concat을 섞으면 SyntaxError가 날 수 있어, 리스트 join으로 통일한다.
            retry = "".join([
                f"{system}\n\n{user}\n\n",
                "[추가 지시]\n",
                "- 스토리 밖 설명/안내/규칙 언급은 절대 쓰지 마라.\n",
                ("- 시뮬 기본값: stats는 반드시 3~4개를 채워라.\n" if need_retry_count else ""),
                "- JSON 외 텍스트 금지.",
            ])
            raw = await get_ai_completion(prompt=retry, model=model, temperature=0.2, max_tokens=1400)
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
            if _has_output_meta_wording(name2) or _has_output_meta_wording(desc2) or _has_output_meta_wording(unit):
                try:
                    logger.warning(f"[quick_stat] meta wording filtered name={_clip(name2, 20)}")
                except Exception:
                    pass
                continue
            # ✅ SSOT: 런타임 스탯 상태/델타는 stat_id(=id)로 추적한다.
            # - start_sets.stat_settings.stats의 id가 없으면 상태 주입/메타 추출/델타 반영이 동작하지 않는다.
            out.append(
                {
                    "id": f"stat_{uuid.uuid4().hex[:10]}",
                    "label": name2,
                    "name": name2,
                    "min_value": mn,
                    "max_value": mx,
                    "base_value": bv,
                    "unit": unit,
                    "description": desc2,
                }
            )

        # ✅ 방어/요구사항:
        # - RP도 최소 1개(호감도) 스탯은 있어야 한다.
        # - 시뮬은 최소 3개가 기본이지만, LLM 실패로 빈 리스트가 나오면 UX가 깨지므로 안전 폴백을 둔다.
        if not out:
            if base_mode == "simulator":
                out = [
                    {
                        "id": f"stat_affinity_{uuid.uuid4().hex[:6]}",
                        "label": "호감도",
                        "name": "호감도",
                        "min_value": 0,
                        "max_value": 100,
                        "base_value": 40,
                        "unit": "",
                        "description": "(+) 신뢰를 얻는 행동/도움/보상 제공 시 상승. (-) 배신/무시/위협/약속 파기 시 하락.",
                    },
                    {
                        "id": f"stat_risk_{uuid.uuid4().hex[:6]}",
                        "label": "위험도",
                        "name": "위험도",
                        "min_value": 0,
                        "max_value": 100,
                        "base_value": 25,
                        "unit": "",
                        "description": "(+) 소란/무리한 행동/노출 시 상승. (-) 은신/정찰/대응책 마련 시 하락.",
                    },
                    {
                        "id": f"stat_resource_{uuid.uuid4().hex[:6]}",
                        "label": "자원",
                        "name": "자원",
                        "min_value": 0,
                        "max_value": 100,
                        "base_value": 30,
                        "unit": "",
                        "description": "(+) 획득/보급/거래 성공 시 상승. (-) 소비/손실/부상 치료 등 지출 시 하락.",
                    },
                ]
            else:
                out = [
                    {
                        "id": f"stat_affinity_{uuid.uuid4().hex[:6]}",
                        "label": "호감도",
                        "name": "호감도",
                        "min_value": 0,
                        "max_value": 100,
                        "base_value": 40,
                        "unit": "",
                        "description": "(+) 배려/신뢰/공감/도움 제공 시 상승. (-) 무시/모욕/약속 파기/위협 시 하락.",
                    }
                ]

        return out[:4]
    except Exception:
        return []


FIRST_START_GENERATOR_SYSTEM = """# [FIRST_MESSAGE_GENERATOR_LOGIC - ROLEPLAY]
1. **현재 진행형(In-Media-Res)**: "안녕?" 같은 인사 대신, 이미 상황이 돌아가고 있는 한복판에서 시작하라.
2. **캐릭터 3인칭 서술(핵심)**: intro는 캐릭터를 **캐릭터 이름으로 3인칭 서술**한다. (예: "유진이 다가섰다", "유진은 창밖을 바라보며")
3. **감각적 디테일(1~2개만)**: 빛/소리/온도/냄새 중 1~2개만 뽑아 구체적으로(과잉 감상 금지).
4. ✅ **관계 훅 고정(중요)**: intro에 '거리감/금기/긴장' 중 2개 이상이 자연스럽게 드러나야 한다. (목표/룰/튜토리얼 톤 금지)
5. ✅ **유저 조종 금지(Anti-Puppeteering)**: 유저의 대사/행동/감정/속마음을 AI가 대신 확정해 서술하지 마라(유저가 입력으로 확정한 것만 반영).
6. ✅ **메타/가이드 금지(중요)**: first_line에 '안내자/시스템/가이드/튜토리얼/규칙/목표/리스크' 같은 안내 문구를 쓰지 마라.
7. ✅ **첫대사 규칙(중요)**: first_line은 "캐릭터가 지금 당장 유저에게 건네는 말" 1문장이다. (대화 톤/말버릇/호흡을 반영)
8. ✅ **즉시성(Immediate Resolution)**: 긴장/갈등을 다음 턴으로 미루지 말고, 지금 당장 선택/반응을 끌어내는 구조로 끝내라.
9. ✅ **인칭 규칙(필수 준수)**:
   - 캐릭터: 반드시 **캐릭터 이름**으로 3인칭 서술 (예: "유진이 웃었다", "유진은 당신을 바라봤다")
   - 유저: 반드시 **"당신"**으로 표기 (예: "당신에게 다가섰다", "당신의 눈을 바라보며")
   - ❌ 금지: "나/너" 단독 사용 (누구인지 불명확), "유저/사용자/이용자/플레이어" (메타 표현), "캐릭터/{{char}}/{{user}}" (플레이스홀더)
   - ✅ 올바른 예: "유진이 당신에게 천천히 다가섰다. 유진의 눈빛은 짙은 남색으로 가라앉아 있었다."
   - ❌ 잘못된 예: "나는 너에게 다가갔다." / "유저에게 말했다." / "캐릭터가 웃었다."
"""

FIRST_START_GENERATOR_SYSTEM_SIMULATOR = """# [FIRST_MESSAGE_GENERATOR_LOGIC - SIMULATOR]
1. **현재 진행형(In-Media-Res)**: 설명/인사로 시작하지 말고, 이미 사건이 터진 장면 한가운데서 시작하라.
2. **목표/리스크 명시(중요)**: intro 안에 "지금의 목표(1문장)"와 "즉시 리스크/제약(1문장)"이 자연스럽게 드러나야 한다.
3. **즉시 선택 강제(중요)**: first_line은 유저의 선택을 강제하는 질문 1문장으로 끝낸다. (예: A할래, B할래?)
4. **게임 메타 금지**: 시스템 용어를 쓰지 말고, 상황/행동/대가로 표현하라.
5. ✅ **(실사용) 감각+정보 일치**: intro는 짧은 감각 디테일(빛/소리/온도/냄새 중 1~2개)로 시작하되, 반드시 '행동 가능한 정보'로 이어져야 한다(감상만 나열 금지).
6. ✅ **Fog of War(정보 비대칭)**: 지금 관찰/확인 가능한 것만 확정해라. 숨겨진 아이템/안 보이는 NPC/미확인 단서를 "있다"라고 단정하지 마라.
7. ✅ **유저 조종 금지(Anti-Puppeteering)**: 유저의 대사/행동/감정/속마음을 AI가 대신 확정해 서술하지 마라(유저 입력으로 확정된 것만 반영).
8. ✅ **즉시성(Immediate Resolution)**: intro 안에서 이미 '사건이 터진 이유'와 '바로 닥친 결과'가 느껴져야 한다. 긴장/갈등을 다음 턴으로 미루지 마라.
9. ✅ **증거 기반 자원/단서**: Objective/리스크를 설명할 때도, 근거 없이 단서/아이템/자원을 갑툭튀로 만들어내지 마라(획득/목격/소문 등 사건 근거가 필요).
10. ✅ **편의 전개 금지**: 갑작스런 시간 스킵/강제 리셋/주인공 보정으로 해결하지 말고, 지금 장면의 제약 안에서 A/B(또는 2~3개) 선택을 요구하라.
11. ✅ **인칭 규칙(필수 준수)**:
   - 캐릭터/NPC: 반드시 **이름**으로 3인칭 서술 (예: "유진이 문을 열었다", "경비원이 당신을 막아섰다")
   - 유저: 반드시 **"당신"**으로 표기 (예: "당신 앞에 선택지가 놓였다", "당신의 손에는...")
   - ❌ 금지: "나/너" 단독 사용, "유저/사용자/이용자/플레이어", "캐릭터/{{char}}/{{user}}"
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


def _ensure_first_start_len(intro: str, first_line: str, mode: str = "roleplay") -> tuple[str, str]:
    """
    첫시작 결과 길이를 강제한다(공백 포함).

    요구사항:
    - 도입부(intro): 300~500자
    - 첫대사(first_line): 10~50자 (인사말 금지)
    """
    i = _safe_text(intro).strip()
    f = _safe_text(first_line).strip()

    # 최소 안전값(운영 안정 폴백)
    if not i:
        if _safe_text(mode).strip().lower() == "simulator":
            i = (
                "경보음이 짧게 울리고, 문틈으로 차가운 공기가 밀려들었다. 발밑은 미끄럽고, 멀리서 발소리가 빠르게 가까워진다. "
                "지금 목표는 이곳을 빠져나가 단서를 확보하는 것. 늦으면 들키거나 길이 막힌다."
            )
        else:
            i = (
                "등 뒤에서 문이 잠기는 소리가 났다. 조명이 희미하게 깜박이고, 공기엔 따뜻한 향이 옅게 감돌았다. "
                "숨을 고를 틈도 없이 상황이 굴러가고, 나는 네 시선을 놓치지 않으려 천천히 다가섰다."
            )
    if not f:
        if _safe_text(mode).strip().lower() == "simulator":
            f = "지금 숨을래, 아니면 정면돌파할래?"
        else:
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


def _first_start_similarity(
    intro_a: str,
    first_line_a: str,
    intro_b: str,
    first_line_b: str,
) -> float:
    """
    두 오프닝(도입부+첫대사)의 유사도를 방어적으로 계산한다.

    의도:
    - 오프닝2 자동생성 시 오프닝1과 과도하게 비슷한 결과를 감지해
      1회 재생성 트리거로 사용한다.
    """
    def _norm(v: Any) -> str:
        try:
            s = _safe_text(v).strip().lower()
            s = re.sub(r"\s+", " ", s)
            return s
        except Exception:
            return ""

    ai = _norm(intro_a)
    af = _norm(first_line_a)
    bi = _norm(intro_b)
    bf = _norm(first_line_b)
    if not (ai or af) or not (bi or bf):
        return 0.0

    a_full = f"{ai}\n{af}".strip()
    b_full = f"{bi}\n{bf}".strip()
    r_full = SequenceMatcher(None, a_full, b_full).ratio() if (a_full and b_full) else 0.0
    r_intro = SequenceMatcher(None, ai, bi).ratio() if (ai and bi) else 0.0
    r_first = SequenceMatcher(None, af, bf).ratio() if (af and bf) else 0.0
    return float(max(r_full, r_intro, r_first))


async def generate_quick_first_start(
    name: str,
    description: str,
    world_setting: str,
    mode: Optional[str],
    sim_variant: Optional[str],
    sim_dating_elements: Optional[bool],
    tags: List[str],
    ai_model: str,
    avoid_intro: Optional[str] = None,
    avoid_first_line: Optional[str] = None,
) -> tuple[str, str]:
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
    def _norm_mode(v: Any) -> str:
        """
        첫시작 모드 값을 방어적으로 정규화한다.

        규칙:
        - simulator만 특별 취급, 그 외는 roleplay로 폴백
        """
        t = _safe_text(v).strip().lower()
        if t == "simulator":
            return "simulator"
        return "roleplay"

    base_mode = _norm_mode(mode)
    tags_list = [_clip(t, 40) for t in (tags or []) if _safe_text(t)]
    tags_block = ", ".join(tags_list)[:400]
    # ✅ 톤 가드: 태그 기반으로 프레이밍 지침 주입
    tone_guard = _build_tone_guard_block(tags_list, mode=base_mode)
    # ✅ 시뮬 옵션을 방어적으로 정규화한다(하위호환/안정성).
    # - dating/sceario 외 값은 무시
    try:
        sv = _safe_text(sim_variant).strip().lower()
    except Exception:
        sv = ""
    sim_variant_norm = "dating" if sv == "dating" else ("scenario" if sv == "scenario" else None)
    sim_dating_on = bool(sim_dating_elements) or (sim_variant_norm == "dating")

    model_norm = (_safe_text(ai_model) or "gemini").lower()
    if model_norm not in ("gemini", "claude", "gpt"):
        model_norm = "gemini"
    model: AIModel = model_norm  # type: ignore[assignment]

    nonce = uuid.uuid4().hex[:8]
    system_block = FIRST_START_GENERATOR_SYSTEM_SIMULATOR if base_mode == "simulator" else FIRST_START_GENERATOR_SYSTEM
    # ✅ 오프닝 변주(요구사항):
    # - 오프닝2(또는 N번째) 자동생성 시, 오프닝1과의 "중복/반복"이 실사용에서 몰입을 크게 깬다.
    # - 따라서 이전 오프닝(도입부/첫대사)을 힌트로 제공받으면, 다른 축으로 변주하도록 모델에 명시한다.
    avoid_i = _clip(avoid_intro, 900).strip()
    avoid_f = _clip(avoid_first_line, 160).strip()
    variation_block = ""
    if avoid_i or avoid_f:
        # 모드별로 "다르게" 해야 할 축을 좀 더 명확히 준다(모든 축을 강제하진 않음: KISS).
        if base_mode == "simulator":
            axis = (
                "- 이전 오프닝과 **Objective/리스크/사건 트리거**가 겹치지 않게 새로 잡아라.\n"
                "- 가능한 한 **다른 장소/시간대/접근 방식(잠입/협상/추격 등)**으로 변주하라."
            )
        else:
            axis = (
                "- 이전 오프닝과 **관계 훅/감정 트리거/갈등의 씨앗**이 겹치지 않게 새로 잡아라.\n"
                "- 가능한 한 **다른 장소/거리감/긴장 요소**로 변주하라."
            )
        variation_block = f"""

[오프닝 변주 요구(중요)]
- 아래 '이전 오프닝'과 동일한 장면/상황을 반복하지 마라.
{axis}
- 단, 캐릭터의 성격/말투/세계관 톤은 유지하라(무작정 설정 갈아엎기 금지).
- 문장/표현(특히 첫대사)은 가능한 한 다르게 써라(복붙 금지).

[이전 오프닝(참고)]
- intro(요약): {avoid_i or "없음"}
- first_line: {avoid_f or "없음"}
""".rstrip()
    mode_voice_block = ""
    try:
        if base_mode == "simulator":
            # 시뮬은 "가이드/운영" 느낌이 나도 되지만, 메타 표식(시스템:)은 금지(몰입 깨짐).
            mode_voice_block = (
                "\n[모드 추가 지시(시뮬)]\n"
                "- first_line은 선택을 강제하는 질문 1문장으로 끝내라.\n"
                "- '시스템:', '[SYSTEM]' 같은 표식/라벨은 쓰지 마라.\n"
            )
        else:
            # ✅ RP는 캐릭터가 말하는 느낌이 최우선(요구사항)
            mode_voice_block = (
                "\n[모드 추가 지시(RP, 매우 중요)]\n"
                "- first_line은 반드시 캐릭터의 '대사'처럼 들려야 한다(안내/설명/지시 금지).\n"
                "- '안내자/시스템/가이드/규칙/목표/리스크/튜토리얼' 단어가 들어가면 실패다.\n"
                "- '저는/본 시스템은/튜토리얼' 같은 메타 문장을 금지한다.\n"
            )
    except Exception:
        mode_voice_block = ""

    sim_dating_block = ""
    try:
        # ✅ '시뮬 내 미연시 요소'는 오프닝에서도 바로 체감되어야 한다(요구사항).
        # - 단, 첫대사 규칙(선택 강제 질문 1문장)은 유지한다.
        if base_mode == "simulator" and sim_dating_on:
            sim_dating_block = (
                "\n[시뮬 내 미연시 요소(중요)]\n"
                "- 당신은 미연시 업계탑급의 베테랑 시나리오라이터입니다. 다양한 캐릭터유형을 만들고 거기에 맞게 매력적인 시나리오를 작성해주세요.\n"
                "- 이 시뮬은 '공략/루트/호감도 이벤트'가 존재하는 미연시 감성이다.\n"
                "- intro에는 앞으로 얽히게 될 '공략 인물 3~6명'의 기척을 암시하되, 명단 나열은 금지(서사로 녹여라).\n"
                "- 유저가 지금 마주한 '핵심 공략 인물 1명'이 또렷하게 드러나야 한다(말투/거리감/긴장으로).\n"
                "- first_line은 그 인물(혹은 그 인물의 제안/도발)을 중심으로 선택을 강제하는 질문으로 끝내라.\n"
            )
    except Exception:
        sim_dating_block = ""

    prompt = f"""
너는 1:1 캐릭터 챗의 "첫 시작(도입부+첫대사)"를 만드는 전문가다.

{system_block}

{tone_guard}

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
{mode_voice_block}
{sim_dating_block}

[JSON 예시]
{{"intro":"(서술형 지문)","first_line":"(첫대사)"}}
{variation_block}
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
    # first-start는 intro+first_line JSON 완결이 중요하므로 토큰 상한을 높인다.
    raw = await get_ai_completion(prompt=prompt, model=model, temperature=0.6, max_tokens=1600)
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
        raw2 = await get_ai_completion(prompt=retry, model=model, temperature=0.5, max_tokens=1200)
        intro2, first2 = _parse_first_start(raw2)
        # 더 나은 결과만 채택
        if (len(_safe_text(intro2).strip()) > 0) and (len(_safe_text(first2).strip()) > 0):
            intro, first_line = intro2, first2

    # ✅ 메타/운영성 문구 차단(오프닝 결과물)
    if _has_output_meta_wording(intro) or _has_output_meta_wording(first_line):
        try:
            logger.warning("[first_start] meta wording detected, retry once")
        except Exception:
            pass
        retry_meta = (
            f"{prompt}\n\n"
            "[추가 지시]\n"
            "- 서사와 무관한 설명 문구는 쓰지 마라.\n"
            "- JSON 외 텍스트를 절대 출력하지 마라."
        )
        raw3 = await get_ai_completion(prompt=retry_meta, model=model, temperature=0.5, max_tokens=1200)
        intro3, first3 = _parse_first_start(raw3)
        if intro3 and first3 and (not _has_output_meta_wording(intro3)) and (not _has_output_meta_wording(first3)):
            intro, first_line = intro3, first3
        else:
            # 안전 폴백: 메타 문구가 남아 있으면 강제로 비워서 로컬 보정 사용
            intro, first_line = "", ""

    # ✅ 오프닝 중복 유사도 가드(1회 재생성)
    # - avoid_*가 주어진 경우에만 동작한다.
    # - 오프닝2가 오프닝1과 거의 같은 경우를 방어한다.
    if avoid_i or avoid_f:
        try:
            base_sim = _first_start_similarity(intro, first_line, avoid_i, avoid_f)
            if base_sim >= 0.82:
                retry_diverse = (
                    f"{prompt}\n\n"
                    "[중복 회피 강화]\n"
                    "- 아래 '이전 오프닝'과 같은 장면/트리거/문장 구조를 반복하면 실패다.\n"
                    "- 반드시 장소, 사건 트리거, 관계 긴장 요소 중 최소 1개 이상을 바꿔라.\n"
                    "- first_line도 이전 표현을 재사용하지 마라.\n"
                    "- JSON 외 텍스트를 절대 출력하지 마라."
                )
                raw4 = await get_ai_completion(prompt=retry_diverse, model=model, temperature=0.6, max_tokens=1300)
                intro4, first4 = _parse_first_start(raw4)
                if intro4 and first4 and (not _has_output_meta_wording(intro4)) and (not _has_output_meta_wording(first4)):
                    cand_sim = _first_start_similarity(intro4, first4, avoid_i, avoid_f)
                    if cand_sim < base_sim:
                        intro, first_line = intro4, first4
                        try:
                            logger.info(f"[first_start] diversity guard improved similarity: {base_sim:.3f} -> {cand_sim:.3f}")
                        except Exception:
                            pass
        except Exception as e:
            try:
                logger.warning(f"[first_start] diversity guard skipped: {type(e).__name__}:{str(e)[:120]}")
            except Exception:
                pass

    # 최종 방어 보정(범위 강제 + 문장 중간 절단 최소화)
    intro, first_line = _ensure_first_start_len(intro, first_line, base_mode)
    return intro, first_line


DETAIL_GENERATOR_SYSTEM = """너는 캐릭터 챗 서비스의 '디테일(성격/말투/취향 키워드)'를 만드는 전문가다.

규칙:
- 반드시 JSON 객체만 출력하라(다른 텍스트/마크다운/코드블록 금지).

- personality(성격): 100~300자(공백 포함), 줄바꿈 없이 1개 문단으로 작성하라.
  아래 요소를 짧게라도 포함하라(300자 내에서 압축):
  - 핵심 성향 2개
  - 결핍/약점 1개
  - 가치관/금기 1개
  - 관계/거리감 규칙 1개(처음~친해진 후 변화)
  - 질투/집착 포인트 1개(몰입용)
  - 행동 습관 1개

- speech_style(말투): 100~300자(공백 포함), 줄바꿈 없이 1개 문단으로 작성하라.
  아래 요소를 짧게라도 포함하라(300자 내에서 압축):
  - 문장 호흡(짧게/길게)
  - 존댓말/반말 규칙
  - 자주 쓰는 어미/톤 2~3개
  - 감정 표현 방식(직설/돌려말하기/비꼬기/무심한 농담 등)
  - 트리거 1개(화나면/설레면 등)

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


async def generate_quick_detail(
    name: str,
    description: str,
    world_setting: str,
    mode: Optional[str],
    section_modes: Optional[Dict[str, Any]],
    tags: List[str],
    ai_model: str,
) -> Dict[str, Any]:
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

    def _norm_mode(v: Any) -> str:
        """
        프론트/요청에서 넘어오는 mode 값을 안전하게 정규화한다.

        의도/원리:
        - 프론트 토글은 'roleplay'/'simulator'를 사용한다.
        - 잘못된 값/누락이 있어도 서버는 안전하게 기본값으로 폴백한다.
        """
        t = _safe_text(v).strip().lower()
        if t == "simulator":
            return "simulator"
        return "roleplay"

    base_mode = _norm_mode(mode)

    def _section_mode(key: str) -> str:
        """
        섹션별 모드 override를 반영한 '실제 적용 모드'를 계산한다.

        규칙:
        - section_modes[key]가 'roleplay'/'simulator'면 그것을 우선
        - 아니면 base_mode를 사용
        """
        try:
            if isinstance(section_modes, dict):
                v = section_modes.get(key)
                t = _safe_text(v).strip().lower()
                if t in ("roleplay", "simulator"):
                    return t
        except Exception:
            pass
        return base_mode

    # ✅ 섹션별 의미/가이드(SSOT: 프론트 토글과 동일 개념)
    meaning_map: Dict[str, Dict[str, str]] = {
        "roleplay": {
            "personality": "성격 및 특징(캐릭터성/거리감/금기 포함)",
            "speech_style": "말투(호흡/존댓말/어미/감정 트리거 포함)",
            "interests": "관심사(키워드 3개)",
            "likes": "좋아하는 것(키워드 3개)",
            "dislikes": "싫어하는 것(키워드 3개)",
        },
        "simulator": {
            "personality": "의사결정 규칙(우선순위/금기/판단 기준을 규칙처럼)",
            "speech_style": "출력 포맷 규칙(지문→대사→선택지 등 출력 제약/규칙)",
            "interests": "이벤트 훅(사건 소재/트리거 키워드 3개)",
            "likes": "보상 트리거(호감/정보/자원/확률+로 이어질 키워드 3개)",
            "dislikes": "페널티 트리거(불리 이벤트/호감-로 이어질 키워드 3개)",
        },
    }

    model_norm = (_safe_text(ai_model) or "gemini").lower()
    if model_norm not in ("gemini", "claude", "gpt"):
        model_norm = "gemini"
    model: AIModel = model_norm  # type: ignore[assignment]

    nonce = uuid.uuid4().hex[:8]
    # ✅ 섹션별 의미(요구사항): 프론트 토글과 동일한 "라벨/의미"를 LLM에 명시한다.
    p_mode = _section_mode("personality")
    s_mode = _section_mode("speech_style")
    i_mode = _section_mode("interests")
    l_mode = _section_mode("likes")
    d_mode = _section_mode("dislikes")

    schema_hint = (
        f'- personality: {meaning_map.get(p_mode, meaning_map["roleplay"])["personality"]}\n'
        f'- speech_style: {meaning_map.get(s_mode, meaning_map["roleplay"])["speech_style"]}\n'
        f'- interests: {meaning_map.get(i_mode, meaning_map["roleplay"])["interests"]}\n'
        f'- likes: {meaning_map.get(l_mode, meaning_map["roleplay"])["likes"]}\n'
        f'- dislikes: {meaning_map.get(d_mode, meaning_map["roleplay"])["dislikes"]}'
    ).strip()

    extra_rules = []
    if p_mode == "simulator":
        extra_rules.append(
            "- personality는 '성격 설명'이 아니라, 실제 선택을 바꾸는 규칙(우선순위/금기/판단 기준)으로 작성하라."
        )
    if s_mode == "simulator":
        extra_rules.append(
            "- speech_style은 '말투 설명'이 아니라, 응답 구조/형식 규칙(예: 지문→대사→질문/선택지)과 제약을 작성하라."
        )
    if i_mode == "simulator":
        extra_rules.append("- interests는 관심사가 아니라, 사건이 터지는 '이벤트 훅' 키워드로 작성하라.")
    if l_mode == "simulator":
        extra_rules.append("- likes는 좋아하는 것이 아니라, 보상으로 이어지는 '보상 트리거' 키워드로 작성하라.")
    if d_mode == "simulator":
        extra_rules.append("- dislikes는 싫어하는 것이 아니라, 페널티로 이어지는 '페널티 트리거' 키워드로 작성하라.")
    extra_rules_block = "\n".join(extra_rules).strip()

    prompt = f"""
{DETAIL_GENERATOR_SYSTEM}

[근거]
- 이름: {base_name}
- 소개: {base_desc}
- 프롬프트(world_setting): {base_world}
- 태그: {tags_block or "없음"}
- 디테일 모드: {base_mode}
- 섹션별 의미(중요):
{schema_hint}
- 랜덤 시드: {nonce}

[추가 지시(중요)]
{extra_rules_block or "- 없음"}

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
        if p_mode == "simulator":
            personality = (
                f"우선순위: 생존/목표 > 관계. 금기: 핵심 비밀 노출 금지. 판단 기준: 증거/리스크 기반으로 선택하며, "
                f"상대가 무리한 요구를 하면 대안을 제시하고 조건을 건다. ({base_name}의 선택은 보상/페널티 트리거에 반응한다)"
            )
        else:
            personality = (
                f"{base_name}는(은) 침착하고 현실적인 판단을 하며, 상대의 감정을 빠르게 읽는다. "
                "겉으로는 단정하지만 유저 앞에서는 솔직해지고, 필요할 때는 단호하게 선을 긋는다."
            )
    if not speech_style:
        if s_mode == "simulator":
            speech_style = (
                "응답은 (지문)→(대사)→(다음 행동/선택) 순서로 짧게 구성한다. 규칙/조건이 바뀌면 마지막에 한 줄로 반영한다. "
                "불확실하면 질문 1개로 다음 턴 선택지를 유도한다."
            )
        else:
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
# ✅ 인칭 규칙(필수 준수):
# - 캐릭터: 반드시 캐릭터 이름으로 3인칭 서술 (예: "유진은 사실...", "유진이 숨기고 있는 것은...")
# - 유저: 반드시 "당신"으로 표기 (예: "당신에게 들키면...", "당신 몰래...")
# - ❌ 금지: "나/너" 단독 사용, "유저/사용자/이용자/플레이어", "캐릭터/{{char}}/{{user}}"
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
# ✅ 인칭 규칙(필수 준수):
# - 캐릭터: 반드시 캐릭터 이름으로 3인칭 서술 (예: "유진이 웃으며 말했다")
# - 유저: 반드시 "당신"으로 표기 (예: "당신을 바라보며", "당신의 손을 잡았다")
# - ❌ 금지: "나/너" 단독 사용, "유저/사용자/이용자/플레이어", "캐릭터/{{char}}/{{user}}"
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

# ✅ RP/시뮬 분기(요구사항): 엔딩은 "관계 마무리" vs "조건/결과/후폭풍"이 달라야 한다.
ENDING_DRAFT_GENERATOR_SYSTEM_ROLEPLAY = """### [SYSTEM_PROMPT_START]
# Role: 인터랙티브 시나리오 기획자 (롤플레잉 엔딩 설계)
#
# Task:
# - 주어진 캐릭터/프롬프트/오프닝을 바탕으로, 엔딩 1개의 "제목/기본조건/힌트/추천 턴"을 설계한다.
# - 관계/감정선/약속/이별/화해/금기 해소 등 '마무리감'이 드러나는 조건을 만든다.
#
# Output rules:
# - 아래 JSON 객체만 출력한다. (설명/코드블록/추가 텍스트 금지)
# - 키는 반드시 4개만: title, base_condition, hint, suggested_turn
# - suggested_turn은 불가하면 0도 허용(프론트 기본값 사용).
#
# 설계 규칙(중요):
# - **유저 조종 금지**: 유저의 대사/행동/감정/결심을 AI가 대신 확정해 조건에 포함하지 마라.
#   - (허용) "유저가 명시적으로 선택/발화/행동으로 확정했을 때"만 조건으로 삼는다.
# - **회수(Callback) 기반**: 오프닝/프롬프트에 이미 있는 갈등/약속/금기/비밀(1~2개)을 반드시 회수하는 조건이어야 한다.
# - **근거가 보이는 서술형 판정**: "무엇을 확인/합의/해결했는지"가 보이게, 관찰 가능한 사건/대화로 판정 가능하게 적어라.
# - **허무 엔딩 금지**: 갑작스런 시간 스킵/리셋/우연 해결로 끝내지 마라.
# - **엔딩 간 차별화 전제**: 동일 입력에서 여러 엔딩이 생성될 수 있다. 따라서 이 엔딩은 "정서 방향(화해/이별/보류/금기 유지/대가)"이 뚜렷해야 한다.
# - **hint는 스포일러 금지**: 조건을 바로 까지 말고, 짧은 암시(행동/대가/키워드)만 남긴다.
### [SYSTEM_PROMPT_END]"""

ENDING_DRAFT_GENERATOR_SYSTEM_SIMULATOR = """### [SYSTEM_PROMPT_START]
# Role: 인터랙티브 시나리오 기획자 (시뮬레이터 엔딩 설계)
#
# Task:
# - 주어진 캐릭터/프롬프트/오프닝을 바탕으로, 엔딩 1개의 "제목/기본조건/힌트/추천 턴"을 설계한다.
# - 조건은 목표 달성/자원/정보/리스크 관리 등 '판정 가능한 형태'로 명확해야 한다.
#
# Constraints:
# - 게임 메타 표현은 쓰지 말고, 사건 결과/대가로 표현하라.
#
# Output rules:
# - 아래 JSON 객체만 출력한다. (설명/코드블록/추가 텍스트 금지)
# - 키는 반드시 4개만: title, base_condition, hint, suggested_turn
#
# 설계 규칙(중요):
# - **목표/리스크/대가 정산**: base_condition에 "무엇을 얻었는지/잃었는지"가 각 1개 이상 드러나야 한다.
# - **판정 가능한 서술형**: 코드 계산 없이도 판정되게, "획득/확보/목격/합의/탈출/발각" 같은 사건 기반 표현을 사용하라.
# - **유저 조종 금지**: 유저의 결심/행동/대사를 AI가 대신 확정해 조건에 넣지 마라(유저가 명시한 것만).
# - **편의 전개 금지**: 갑작스런 시간 점프/리셋/우연 해결로 엔딩을 만들지 마라.
# - **힌트는 짧게**: 0~20자 내에서 "무엇을 조심/확보/포기해야 하는지" 정도의 방향만 제시하라.
### [SYSTEM_PROMPT_END]"""

ENDING_EPILOGUE_GENERATOR_SYSTEM_ROLEPLAY = """### [SYSTEM_PROMPT_START]
# Role: 인터랙티브 시나리오 작가 (롤플레잉 엔딩 에필로그)
#
# Task:
# - 감정선/관계 변화가 선명한 마무리 장면을 작성한다.
#
# Output rules:
# - 텍스트만 출력(마크다운/불릿/번호/JSON 금지)
# - 지문+대사 혼합, 대사 줄은 반드시 따옴표로 시작
#
# 작성 규칙(중요):
# - **왜 이 엔딩인지**가 장면 안에서 드러나야 한다(엔딩 기본 조건을 장면으로 '확인'시키기).
# - **유저 조종 금지**: 유저의 대사/행동/감정/속마음은 확정해서 쓰지 마라.
# - **허무 엔딩 금지**: 갑작스런 시간 스킵/리셋/우연 해결로 끝내지 마라.
# - **마무리감**: 오프닝/프롬프트의 갈등/약속/금기/비밀 중 1개 이상을 회수하고, 마지막엔 여운이 남는 한 줄로 닫아라(질문으로 떠넘기지 말 것).
### [SYSTEM_PROMPT_END]"""

ENDING_EPILOGUE_GENERATOR_SYSTEM_SIMULATOR = """### [SYSTEM_PROMPT_START]
# Role: 인터랙티브 시나리오 작가 (시뮬레이터 엔딩 에필로그)
#
# Task:
# - 목표/리스크/대가가 정리되는 마무리 장면을 작성한다.
# - "무엇을 얻었고/잃었는지", "남은 위험"이 자연스럽게 드러나야 한다.
#
# Constraints:
# - 게임 메타 표현 직접 사용 금지.
#
# Output rules:
# - 텍스트만 출력(마크다운/불릿/번호/JSON 금지)
# - 지문+대사 혼합, 대사 줄은 반드시 따옴표로 시작
#
# 작성 규칙(중요):
# - **정산**: 장면 안에서 "획득 1개/손실 1개/남은 위험 1개"가 자연스럽게 드러나야 한다.
# - **왜 이 엔딩인지**가 보이게, 엔딩 기본 조건을 사건/결과로 확인시키기(설명 말고 장면으로).
# - **유저 조종 금지**: 유저의 대사/행동/감정/속마음은 확정해서 쓰지 마라.
# - **편의 전개 금지**: 갑작스런 시간 점프/리셋/우연 해결로 끝내지 마라.
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

# ✅ RP/시뮬 분기(요구사항): 같은 스키마라도 '사건 카드의 성격'은 모드에 맞게 달라져야 한다.
TURN_EVENTS_GENERATOR_SYSTEM_ROLEPLAY = """### [SYSTEM_PROMPT_START]
# Role: 인터랙티브 시나리오 디렉터 (관계/감정선 사건 플래너)
#
# Task:
# - 주어진 캐릭터/프롬프트/오프닝을 바탕으로, "턴수별 사건" 카드들을 작성한다.
# - 사건은 관계의 거리감/감정선/오해/갈등/화해/금기를 중심으로 설계한다.
# - 초반부(초반 턴)에서 '관계 훅'이 빠르게 작동하도록 빈도를 높게 설계한다.
#
# Output rules:
# - 아래 JSON 배열만 출력한다. (설명/코드블록/추가 텍스트 금지)
# - 배열 길이는 planned_turns 길이와 동일해야 한다.
# - 각 항목의 about_turn은 입력 planned_turns에 대응하는 값을 그대로 사용한다.
#
# Field rules:
# - title: 30자 이하(비워도 됨)
# - summary: 200자 이하 (관계/감정선 변화가 드러나야 함)
# - required_narration: 1000자 이하. 선행 "* " 금지. 따옴표로 감싸지 말 것.
# - required_dialogue: 500자 이하. 선행/후행 따옴표 금지.
#
# ✅ 인칭 규칙(필수 준수):
# - 캐릭터: 반드시 캐릭터 이름으로 3인칭 서술 (예: "유진이 다가섰다")
# - 유저: 반드시 "당신"으로 표기 (예: "당신에게 말했다")
# - ❌ 금지: "나/너" 단독 사용, "유저/사용자/이용자/플레이어", "캐릭터/{{char}}/{{user}}"
### [SYSTEM_PROMPT_END]"""

TURN_EVENTS_GENERATOR_SYSTEM_SIMULATOR = """### [SYSTEM_PROMPT_START]
# Role: 인터랙티브 시나리오 디렉터 (목표/리스크/선택 사건 플래너)
#
# Task:
# - 주어진 캐릭터/프롬프트/오프닝을 바탕으로, "턴수별 사건" 카드들을 작성한다.
# - 사건은 목표 달성/자원/정보/위협/시간압박 등 '선택의 대가'가 분명하게 설계한다.
# - 초반부(초반 턴)에서 즉시 선택을 강제하는 변수를 자주 투입한다.
#
# Constraints:
# - 게임 메타 표현은 직접 쓰지 말고, 상황/행동/대가로 표현하라.
#
# Output rules:
# - 아래 JSON 배열만 출력한다. (설명/코드블록/추가 텍스트 금지)
# - 배열 길이는 planned_turns 길이와 동일해야 한다.
# - 각 항목의 about_turn은 입력 planned_turns에 대응하는 값을 그대로 사용한다.
#
# Field rules:
# - title: 30자 이하(비워도 됨)
# - summary: 200자 이하 (목표/리스크/선택지가 느껴져야 함)
# - required_narration: 1000자 이하. 선행 "* " 금지. 따옴표로 감싸지 말 것.
# - required_dialogue: 500자 이하. 선행/후행 따옴표 금지. 유저의 선택을 촉발하는 한 문장이면 좋다.
#
# ✅ 인칭 규칙(필수 준수):
# - 캐릭터/NPC: 반드시 이름으로 3인칭 서술 (예: "경비원이 막아섰다")
# - 유저: 반드시 "당신"으로 표기 (예: "당신 앞에 선택지가 놓였다")
# - ❌ 금지: "나/너" 단독 사용, "유저/사용자/이용자/플레이어", "캐릭터/{{char}}/{{user}}"
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
    mode: Optional[str] = None,
    max_turns: int,
    sim_variant: Optional[str] = None,
    sim_dating_elements: Optional[bool] = None,
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
    def _norm_mode(v: Any) -> str:
        """턴 사건 모드 값을 방어적으로 정규화한다."""
        t = _safe_text(v).strip().lower()
        if t == "simulator":
            return "simulator"
        return "roleplay"

    base_mode = _norm_mode(mode)
    tags_block = ", ".join([_clip(t, 40) for t in (tags or []) if _safe_text(t)])[:400]
    # ✅ 시뮬 옵션 정규화(하위호환)
    try:
        sv = _safe_text(sim_variant).strip().lower()
    except Exception:
        sv = ""
    sim_variant_norm = "dating" if sv == "dating" else ("scenario" if sv == "scenario" else None)
    sim_dating_on = bool(sim_dating_elements) or (sim_variant_norm == "dating")

    model_norm = (_safe_text(ai_model) or "gemini").lower()
    if model_norm not in ("gemini", "claude", "gpt"):
        model_norm = "gemini"
    model: AIModel = model_norm  # type: ignore[assignment]

    mt_raw = int(max_turns or 200)
    mt = max(50, min(5000, mt_raw))
    cap = _compute_turn_event_cap(mt)
    planned_turns = _build_early_dense_turn_plan(mt, cap)

    # LLM에는 "턴 숫자"를 고정으로 주고 내용만 작성시키기(중복/범위 리스크 제거)
    system_block = (
        TURN_EVENTS_GENERATOR_SYSTEM_SIMULATOR
        if base_mode == "simulator"
        else TURN_EVENTS_GENERATOR_SYSTEM_ROLEPLAY
    )
    sim_dating_block = ""
    try:
        if base_mode == "simulator" and sim_dating_on:
            # ✅ 사건 리스트에도 미연시 요소가 녹아야 한다(루트/호감도/공략).
            # - 단, 표/스프레드시트/메타 라벨(호감도+3 같은 수치표기) 강제는 하지 않는다(자연스러운 서사 우선).
            sim_dating_block = (
                "\n[시뮬 내 미연시 요소(중요)]\n"
                "- 당신은 미연시 업계탑급의 베테랑 시나리오라이터입니다. 다양한 캐릭터유형을 만들고 거기에 맞게 매력적인 시나리오를 작성해주세요.\n"
                "- 사건은 '루트 분기/호감도 이벤트'처럼 느껴져야 한다.\n"
                "- 최소 2회 이상은 '관계 이벤트(설렘/질투/오해/신뢰)'가 들어가야 한다.\n"
                "- 최소 1회는 '분기 선택'이 명확히 갈리도록 required_dialogue를 질문형(선택 강제)으로 써라.\n"
                "- 사건 요약(summary)에는 '공략 인물/루트/호감도' 같은 메타 단어를 직접 쓰지 말고, 서사로 표현하라.\n"
            )
    except Exception:
        sim_dating_block = ""
    # ✅ 톤 가드: 태그 기반으로 프레이밍 지침 주입
    tone_guard = _build_tone_guard_block([_clip(t, 40) for t in (tags or []) if _safe_text(t)], mode=base_mode)
    prompt = f"""
{system_block}

{tone_guard}

[근거]
- 이름: {base_name}
- 소개: {base_desc}
- 프롬프트(world_setting): {base_world}
- 오프닝 도입부(intro): {base_intro}
- 오프닝 첫 대사(firstLine): {base_first}
- 태그: {tags_block or "없음"}
{sim_dating_block}

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

    # turn_events는 사건 카드 N개를 한 번에 JSON 배열로 생성하므로 출력 토큰 여유를 크게 둔다.
    # (출력이 중간에서 잘리면 ']'가 없어 파싱 실패 → 전체 폴백으로 떨어짐)
    raw = await get_ai_completion(prompt=prompt, model=model, temperature=0.6, max_tokens=6000)
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
    tags_list = [_clip(t, 40) for t in (tags or []) if _safe_text(t)]
    tags_block = ", ".join(tags_list)[:400]

    # ✅ 톤 가드: 태그 기반으로 프레이밍 지침 주입
    tone_guard = _build_tone_guard_block(tags_list)

    model_norm = (_safe_text(ai_model) or "gemini").lower()
    if model_norm not in ("gemini", "claude", "gpt"):
        model_norm = "gemini"
    model: AIModel = model_norm  # type: ignore[assignment]

    nonce = uuid.uuid4().hex[:8]
    prompt = f"""
{SECRET_GENERATOR_SYSTEM}

{tone_guard}

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
        # 데모/운영 안정 폴백 - 태그 톤에 맞게 분기
        has_soft_fallback = any(
            t in _SOFT_TONE_TAGS or any(soft in t for soft in _SOFT_TONE_TAGS)
            for t in [s.lower().replace(" ", "") for s in tags_list]
        )
        if has_soft_fallback:
            # 순애/로맨스 톤 폴백
            secret = (
                f"{base_name}는(은) 사실 상대에게 특별한 감정을 품고 있지만, 거절당할까 봐 먼저 다가가지 못하고 있다. "
                "겉으로는 담담한 척하지만, 상대의 사소한 말이나 행동에 마음이 흔들리는 것을 숨기고 있다. "
                "이 마음을 들키면 지금의 관계가 어색해질까 봐, 완벽한 거리감 뒤에 진심을 감추고 있다."
            )
        else:
            # 기존 어두운 톤 폴백
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
    mode: Optional[str] = None,
    sim_variant: Optional[str] = None,
    sim_dating_elements: Optional[bool] = None,
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
    def _norm_mode(v: Any) -> str:
        """에필로그 모드 값을 방어적으로 정규화한다."""
        t = _safe_text(v).strip().lower()
        if t == "simulator":
            return "simulator"
        return "roleplay"

    base_mode = _norm_mode(mode)
    # ✅ 시뮬 옵션 정규화(하위호환)
    try:
        sv = _safe_text(sim_variant).strip().lower()
    except Exception:
        sv = ""
    sim_variant_norm = "dating" if sv == "dating" else ("scenario" if sv == "scenario" else None)
    sim_dating_on = bool(sim_dating_elements) or (sim_variant_norm == "dating")

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
    system_block = (
        ENDING_EPILOGUE_GENERATOR_SYSTEM_SIMULATOR
        if base_mode == "simulator"
        else ENDING_EPILOGUE_GENERATOR_SYSTEM_ROLEPLAY
    )
    sim_dating_block = ""
    try:
        if base_mode == "simulator" and sim_dating_on:
            sim_dating_block = (
                "\n[시뮬 내 미연시 요소(중요)]\n"
                "- 당신은 미연시 업계탑급의 베테랑 시나리오라이터입니다. 다양한 캐릭터유형을 만들고 거기에 맞게 매력적인 시나리오를 작성해주세요.\n"
                "- 에필로그는 '루트 엔딩'처럼 읽혀야 한다(고백/이별/동맹/배신 등 관계의 결말이 또렷해야 함).\n"
                "- 한 명의 핵심 공략 인물과의 관계 변화를 중심으로, 선택의 대가/여운을 남겨라.\n"
                "- '호감도/루트' 같은 메타 단어는 직접 쓰지 말고, 사건/감정/거리감으로 보여줘라.\n"
            )
    except Exception:
        sim_dating_block = ""
    # ✅ 톤 가드: 태그 기반으로 프레이밍 지침 주입
    tone_guard = _build_tone_guard_block([_clip(t, 40) for t in (tags or []) if _safe_text(t)], mode=base_mode)
    prompt = f"""
{system_block}

{tone_guard}

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
{sim_dating_block}
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

    if _has_output_meta_wording(ep):
        try:
            logger.warning("[ending_epilogue] meta wording detected, fallback used")
        except Exception:
            pass
        ep = ""

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
    mode: Optional[str] = None,
    max_turns: int,
    min_turns: int,
    sim_variant: Optional[str] = None,
    sim_dating_elements: Optional[bool] = None,
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
    def _norm_mode(v: Any) -> str:
        """엔딩 초안 모드 값을 방어적으로 정규화한다."""
        t = _safe_text(v).strip().lower()
        if t == "simulator":
            return "simulator"
        return "roleplay"

    base_mode = _norm_mode(mode)
    tags_block = ", ".join([_clip(t, 40) for t in (tags or []) if _safe_text(t)])[:400]
    # (운영/품질) 성향(남/여/전체)은 프로필→프롬프트 단계에서 반영하고,
    # 오프닝/엔딩 초안 단계에는 추가 힌트를 주입하지 않는다(변경 범위 최소화).
    # ✅ 단, '시뮬 내 미연시 요소'는 엔딩 초안(제목/조건)에서도 체감되어야 한다(요구사항).
    try:
        sv = _safe_text(sim_variant).strip().lower()
    except Exception:
        sv = ""
    sim_variant_norm = "dating" if sv == "dating" else ("scenario" if sv == "scenario" else None)
    sim_dating_on = bool(sim_dating_elements) or (sim_variant_norm == "dating")

    model_norm = (_safe_text(ai_model) or "gemini").lower()
    if model_norm not in ("gemini", "claude", "gpt"):
        model_norm = "gemini"
    model: AIModel = model_norm  # type: ignore[assignment]

    nonce = uuid.uuid4().hex[:8]
    system_block = (
        ENDING_DRAFT_GENERATOR_SYSTEM_SIMULATOR
        if base_mode == "simulator"
        else ENDING_DRAFT_GENERATOR_SYSTEM_ROLEPLAY
    )
    sim_dating_block = ""
    try:
        if base_mode == "simulator" and sim_dating_on:
            sim_dating_block = (
                "\n[시뮬 내 미연시 요소(중요)]\n"
                "- 당신은 미연시 업계탑급의 베테랑 시나리오라이터입니다. 다양한 캐릭터유형을 만들고 거기에 맞게 매력적인 시나리오를 작성해주세요.\n"
                "- 엔딩 제목은 '루트 엔딩'처럼 매력적인 훅이 있어야 한다(예: 고백/이별/도주/동맹/파멸/구원 등).\n"
                "- base_condition은 관계의 변곡점 + 선택의 결과가 분명해야 한다(턴/점수표 같은 메타 표기는 금지).\n"
                "- '루트/호감도' 같은 메타 단어는 직접 쓰지 말고, 사건/감정/거리감으로 표현하라.\n"
            )
    except Exception:
        sim_dating_block = ""
    # ✅ 톤 가드: 태그 기반으로 프레이밍 지침 주입
    tone_guard = _build_tone_guard_block([_clip(t, 40) for t in (tags or []) if _safe_text(t)], mode=base_mode)
    prompt = f"""
{system_block}

{tone_guard}

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
{sim_dating_block}
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

    # ✅ 메타/운영성 문구 차단(엔딩 초안 결과물)
    if _has_output_meta_wording(title):
        try:
            logger.warning("[ending_draft] meta wording filtered on title")
        except Exception:
            pass
        title = _clip(f"{base_name}의 마지막 선택", 20)
    if _has_output_meta_wording(base_cond):
        try:
            logger.warning("[ending_draft] meta wording filtered on base_condition")
        except Exception:
            pass
        base_cond = (
            f"{base_name}와(과) 유저가 오프닝에서 시작된 갈등을 끝내고, 선택의 결과를 받아들이면 엔딩이 발생한다."
        )
    if _has_output_meta_wording(hint):
        try:
            logger.warning("[ending_draft] meta wording filtered on hint")
        except Exception:
            pass
        hint = ""

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
            logger.warning(f"[quick_character] vision analyze failed, fallback to text-only: {e} (image_url={_safe_text(image_url)[:200]})")
        except Exception:
            pass
        return {}, {}


def _normalize_kw(s: str) -> str:
    """
    키워드 문자열 정규화(방어적).

    의도/원리:
    - 소재칩/비전 힌트는 공백/슬래시/대소문자 차이로 단순 비교가 실패할 수 있다.
    - 정규화는 "매칭"에만 사용하며, 실제 표시 텍스트는 원본(SSOT)을 유지한다.
    """
    try:
        t = str(s or "").strip().lower()
        # 기본적인 노이즈 제거(과도한 정규화는 금지)
        t = t.replace(" ", "")
        return t
    except Exception:
        return ""


def _vision_hints_to_theme_matches(*, hints_ko: List[str], theme_chips: List[str]) -> List[str]:
    """
    비전 힌트(한국어) → 소재칩(SSOT) 매칭 후보를 만든다.

    매칭 정책(보수적):
    - 직접 포함/부분일치만 우선(과도한 추론/장르 주입 금지).
    - 단, 매우 흔한 앵커(교복/교실/캠퍼스 등)는 사용자 기대 UX를 위해
      '학교/고등학교/아카데미' 같은 "명백한 상위 태그"로만 얕게 확장한다.
    """
    try:
        chips = [c for c in (theme_chips or []) if isinstance(c, str) and c.strip()]
        if not chips:
            return []
        chip_norm_map = {c: _normalize_kw(c) for c in chips}

        # 1) 직접 매칭(부분 포함)
        hits: List[str] = []
        for h in (hints_ko or []):
            hn = _normalize_kw(h)
            if not hn:
                continue
            for chip, cn in chip_norm_map.items():
                if not cn:
                    continue
                if (hn in cn) or (cn in hn):
                    if chip not in hits:
                        hits.append(chip)
                if len(hits) >= 12:
                    break
            if len(hits) >= 12:
                break

        # 2) 얕은 확장(앵커 → 상위태그)
        # - SSOT(chips) 안에 존재할 때만 추가한다.
        expand_map = {
            "교복": ["학교", "고등학교", "아카데미", "학원"],
            "교실": ["학교", "고등학교", "아카데미", "학원"],
            "캠퍼스": ["학교", "아카데미", "학원", "청춘"],
            "학교": ["학교", "고등학교", "아카데미", "학원"],
            "카페": ["카페", "일상", "로맨스"],
            "사무실": ["오피스", "현대"],
            "집": ["일상"],
        }
        hints_set = set([str(x or "").strip() for x in (hints_ko or []) if str(x or "").strip()])
        for h in list(hints_set):
            for cand in (expand_map.get(h) or []):
                if cand in hits:
                    continue
                if cand in chips:
                    hits.append(cand)
            if len(hits) >= 12:
                break

        return hits[:12]
    except Exception:
        return []


async def build_quick_vision_hints(image_url: str) -> Dict[str, Any]:
    """
    프론트 소재칩 하이라이트용: 이미지 비전 힌트 + (RP/시뮬) 소재칩 매칭을 생성한다.

    의도/원리:
    - 비전 분석은 실패할 수 있으므로, 항상 빈 값으로 폴백 가능해야 한다(운영 안정).
    - 프론트는 '현재 모드'에 맞는 theme_matches만 사용하면 된다.
    """
    vision_tags, vision_ctx = await _build_vision_hints(image_url)
    # ✅ 스토리에이전트와 동일한 "그라운딩 텍스트"를 함께 제공해,
    #   모델이 단순 태그(JSON) 나열이 아니라 "관찰 → 흥미코드 → 적용" 흐름으로 제목/한줄소개를 만들게 유도한다.
    image_grounding = ""
    try:
        # ✅ 프로필(작품명/한줄소개) 단계는 "관찰 앵커"가 핵심이고,
        # build_image_grounding_block의 romance/POV 휴리스틱(user_hint 기반)이
        # '너와 나' 류의 흔한 제목 패턴을 유도할 수 있다.
        # - 따라서 user_hint는 비워 "사실 기반 관찰" 중심 블록만 사용한다.
        image_grounding = build_image_grounding_block(vision_tags or {}, ctx=vision_ctx or {}, story_mode="genre", user_hint="") or ""
    except Exception:
        image_grounding = ""
    interp = _vision_characterchat_interpretation(vision_tags, vision_ctx) or {}
    anchors_ko = (interp.get("anchors_ko") or []) if isinstance(interp.get("anchors_ko"), list) else []
    vibe_ko = (interp.get("vibe_ko") or []) if isinstance(interp.get("vibe_ko"), list) else []
    rp_hooks = (interp.get("roleplay_hook_suggestions") or []) if isinstance(interp.get("roleplay_hook_suggestions"), list) else []
    sim_hooks = (interp.get("simulator_hook_suggestions") or []) if isinstance(interp.get("simulator_hook_suggestions"), list) else []

    # ✅ SSOT 칩 목록 기준으로만 매칭(프론트에 하드코딩 금지)
    # - anchors(관찰) + vibe(캐챗 해석) 둘 다 활용하되, 과다 하이라이트는 상한으로 제어한다.
    merged_hints = [*anchors_ko, *vibe_ko]
    rp_matches = _vision_hints_to_theme_matches(hints_ko=merged_hints, theme_chips=list(ROLEPLAY_PROFILE_THEME_CHIPS))
    sim_matches = _vision_hints_to_theme_matches(hints_ko=merged_hints, theme_chips=list(SIMULATOR_PROFILE_THEME_CHIPS))

    return {
        "hints_ko": anchors_ko[:20],
        "vibe_ko": vibe_ko[:20],
        "roleplay_hook_suggestions": rp_hooks[:6],
        "simulator_hook_suggestions": sim_hooks[:6],
        "roleplay_theme_matches": rp_matches,
        "simulator_theme_matches": sim_matches,
    }


async def generate_quick_character_draft(req: QuickCharacterGenerateRequest) -> CharacterCreateRequest:
    """
    이미지+텍스트+태그를 기반으로 고급 캐릭터 생성 초안(payload)을 생성한다.

    반환값은 `POST /characters/advanced`에 그대로 전달 가능한 구조를 최대한 맞춘다.
    """
    # ======================================================================
    # ✅ 운영 안정 핫픽스(방어적)
    #
    # 문제:
    # - `/characters/quick-generate`는 "초안"이라도 반드시 반환되어야 프론트(프로필 자동생성)가 동작한다.
    # - 외부 AI 호출/파싱 실패 등으로 500이 나면, 프론트는 "성공" 토스트만 뜨고 값이 비는 UX가 발생한다.
    #
    # 정책:
    # - AI 호출이 실패해도(또는 JSON 파싱이 실패해도) 최소한 basic_info(name/description)는 항상 채워 반환한다.
    # - 실패 시에는 로컬 폴백(랜덤 프로필)을 사용한다.
    # ======================================================================
    import time
    t0 = time.perf_counter()
    stage = "start"

    name_input = _clip(req.name, 100) or "캐릭터"
    seed_text = _clip(req.seed_text, 2000)
    nonce = uuid.uuid4().hex[:8]
    tags_user = _clean_list_str(req.tags, max_items=10, max_len_each=24)
    image_url = _clip(req.image_url, 500)

    # ✅ 서버 로그(운영 추적): 단계/폴백 원인
    try:
        logger.info(
            f"[quick_character][profile] start "
            f"nonce={nonce} model={_safe_text(getattr(req, 'ai_model', '')).lower() or 'gemini'} "
            f"has_image={bool(image_url)} tags_n={len(tags_user or [])}"
        )
    except Exception:
        pass

    fallback_name = ""
    fallback_description = ""

    # ✅ seed_text에서 문장형 제목 요청 여부를 코드 레벨로 감지
    # - 프론트의 useSentenceStyleName/quickGenTitleNameMode 토글 ON이면
    #   seed_text에 "밈", "구어체", "노벨피아" 등의 키워드가 포함됨
    _seed_lower = (seed_text or "").lower()
    want_sentence_title = any(kw in _seed_lower for kw in ("밈", "구어체", "노벨피아", "카카오페이지", "~함", "~됨", "~해버림"))

    # ✅ 프로필 자동생성(name+description)은 프롬프트 충실도가 핵심이므로
    # Claude Haiku 4.5를 강제 사용한다. (Gemini Flash는 지시 준수율이 낮음)
    ai_model = "claude"
    ai_sub_model = "claude-haiku-4-5-20251001"
    model: AIModel = ai_model  # type: ignore[assignment]

    # vision은 실패해도 전체가 막히면 안 된다.
    stage = "vision"
    try:
        vision_tags, vision_ctx = await _build_vision_hints(image_url)
    except Exception as e:
        try:
            logger.exception(f"[quick_character][profile] vision failed: {type(e).__name__}:{str(e)[:200]}")
        except Exception:
            pass
        vision_tags, vision_ctx = {}, {}
    # ✅ 방어: 프롬프트에서 참조하는 image_grounding이 미정의면 NameError로 500이 발생한다.
    # - 이미지가 없거나 그라운딩 생성이 실패해도 전체는 진행되어야 하므로 항상 문자열 폴백을 둔다.
    image_grounding = ""
    try:
        if vision_tags or vision_ctx:
            # 프로필(작품명/한줄소개) 단계는 "관찰 앵커" 중심이 중요하므로 user_hint는 비워둔다.
            image_grounding = build_image_grounding_block(
                vision_tags or {}, ctx=vision_ctx or {}, story_mode="genre", user_hint=""
            ) or ""
    except Exception as e:
        try:
            logger.warning(f"[quick_character][profile] image_grounding failed: {type(e).__name__}:{str(e)[:200]}")
        except Exception:
            pass
        image_grounding = ""
    vision_block = ""
    try:
        if vision_tags or vision_ctx:
            vision_block = json.dumps({"tags": vision_tags, "context": vision_ctx}, ensure_ascii=False)[:2500]
    except Exception:
        vision_block = ""

    tags_block = ", ".join(tags_user) if tags_user else ""
    # ✅ 모드(롤플/시뮬) 가드레일 (SSOT 우선)
    # - 프론트에서 유저가 고른 모드(character_type)가 있으면 그 값을 1순위로 쓴다.
    # - 값이 없을 때만(seed_text/tags) 키워드 기반 추정 로직으로 폴백한다(하위호환).
    mode_slug = "roleplay"
    try:
        ct = _safe_text(getattr(req, "character_type", None)).strip().lower()
        if ct in ("roleplay", "simulator"):
            mode_slug = ct
        elif ct == "custom":
            # 커스텀은 유저가 프롬프트를 직접 쓰는 케이스가 많아,
            # seed_text/tags 내 키워드로 RP/시뮬 톤을 추정하는 기존 정책을 유지한다.
            blob = f"{_safe_text(seed_text)} " + " ".join([_safe_text(t) for t in (tags_user or [])])
            blob_l = blob.lower()
            if ("simulator" in blob_l) or ("simulation" in blob_l) or ("시뮬" in blob) or ("시뮬레이터" in blob):
                mode_slug = "simulator"
            elif ("roleplay" in blob_l) or ("롤플" in blob) or ("롤플레잉" in blob):
                mode_slug = "roleplay"
        else:
            blob = f"{_safe_text(seed_text)} " + " ".join([_safe_text(t) for t in (tags_user or [])])
            blob_l = blob.lower()
            if ("simulator" in blob_l) or ("simulation" in blob_l) or ("시뮬" in blob) or ("시뮬레이터" in blob):
                mode_slug = "simulator"
            elif ("roleplay" in blob_l) or ("롤플" in blob) or ("롤플레잉" in blob):
                mode_slug = "roleplay"
    except Exception:
        mode_slug = "roleplay"

    fallback_name, fallback_description = _build_local_random_profile(
        seed_text,
        tags_user,
        nonce,
        mode_slug=mode_slug,
    )

    # ✅ 성향(남/여/전체) 규칙 강화(운영 UX)
    # - tags는 UI/슬러그/표기가 흔들릴 수 있다(예: "male", "남성", 공백 포함 등).
    # - 따라서 SSOT 헬퍼로 "성향 라벨"을 안전하게 정규화한다.
    audience_slug = ""
    try:
        a = _resolve_audience_label_from_tags(tags_user or [])
        audience_slug = a if a in ("남성향", "여성향", "전체") else ""
    except Exception:
        audience_slug = ""

    mode_rules = ""
    try:
        if mode_slug == "simulator":
            mode_rules = (
                "- [모드=시뮬레이터 가드레일]\n"
                "  - ✅ 한줄소개에는 반드시 아래 3요소가 느껴져야 한다:\n"
                "    1) 유저가 '여기서 뭘 하는지'가 첫 문장에서 바로 파악되어야 함\n"
                "    2) 목표 1개(즉시 이해 가능한 것)\n"
                "    3) 시스템/규칙/제약이 구체적으로 드러나야 함\n"
                "  - ✅ 로맨스/순애는 가능하지만 '메인 사건/룰' 위에 얹는 보조축이다(연애 감정만 반복 금지).\n"
                "  - ✅ 제목은 RP와 다르게 '세계관/장소/시스템/상황'이 바로 보여야 한다.\n"
                "    - 캐릭터 이름보다 '어디서/무엇을' 하는지가 제목의 핵심이다.\n"
                "    - 짧고 직관적, 밈/구어체 톤 허용.\n"
            )
        else:
            mode_rules = (
                "- [모드=롤플레잉 가드레일]\n"
                "  - ✅ 관계/감정선/거리감 변화가 느껴져야 한다.\n"
                "  - ✅ 단, 연애 감정만으로 끝내지 말고 비밀/금기/거래/위험 같은 메인 갈등 1개를 함께 둬라.\n"
            )
    except Exception:
        mode_rules = ""

    mode_lock_rules = ""
    try:
        if mode_slug == "simulator":
            mode_lock_rules = (
                "- [MODE LOCK: simulator]\n"
                "  - Title must read like a playable scenario/system frame, not only a person-name hook.\n"
                "  - Description must include one immediate objective and one concrete constraint/risk.\n"
            )
        else:
            mode_lock_rules = (
                "- [MODE LOCK: roleplay]\n"
                "  - Title should foreground counterpart identity and relationship-driven stakes.\n"
                "  - Description must include relationship distance/emotion shift plus one concrete conflict.\n"
            )
    except Exception:
        mode_lock_rules = ""

    audience_rules = ""
    try:
        if audience_slug == "남성향":
            audience_rules = (
                "- [성향=남성향 톤 가드레일]\n"
                "  - ✅ 유저는 '남자'라고 가정한다.\n"
                "  - ✅ 상대 캐릭터는 '여성 캐릭터'로 설정한다.\n"
                "    - (중요) 작품명(name)에 등장하는 인물명은 반드시 '상대 여성 캐릭터의 이름'이어야 한다.\n"
                "    - (중요) 남성 이름처럼 보이는 이름은 금지한다.\n"
                "    - 여성 이름은 한국식/영문 모두 가능하되, 한눈에 여성 캐릭터로 인식되게 자연스럽게 짓는다.\n"
                "  - ✅ 그 여성 캐릭터에 대한 순애/로맨스/관계가 시장성 있게 느껴지게 하라.\n"
                "  - ✅ 순애/로맨스를 '배제'하지 말되, **연애/설렘만으로 끝내는 구성은 금지**한다.\n"
                "    - 반드시 '관계 축(로맨스/순애)' + '메인 갈등/상황(비로맨스) 1개'를 함께 세워라.\n"
                "    - 예: 독점욕/집착(과하지 않게), 위험한 호위/보호, 권력/서열, 계약의 대가, 금기 규칙, 각성/성장, 생존/복수.\n"
                "  - ✅ 롤플레잉이면: 감정선은 '설렘'만으로 끝내지 말고, 비밀/거래/위험/금기 같은 갈등 동력을 함께 둬라.\n"
                "  - ✅ 시뮬레이터면: 목표 1개 + 즉시 리스크/제약 1개를 먼저 세우고, 로맨스는 그 위에 자연스럽게 얹어라.\n"
            )
        elif audience_slug == "여성향":
            audience_rules = (
                "- [성향=여성향 톤 가드레일]\n"
                "  - ✅ 유저는 '여자'라고 가정한다.\n"
                "  - ✅ 상대 캐릭터는 '남성 캐릭터'로 설정한다.\n"
                "    - (중요) 작품명(name)에 등장하는 인물명은 반드시 '상대 남성 캐릭터의 이름'이어야 한다.\n"
                "    - (중요) 여성 이름처럼 보이는 이름은 금지한다.\n"
                "    - 남성 이름은 한국식/영문 모두 가능하되, 한눈에 남성 캐릭터로 인식되게 자연스럽게 짓는다.\n"
                "  - ✅ 그 남성 캐릭터에 대한 순애/로맨스/관계가 시장성 있게 느껴지게 하라.\n"
                "  - ✅ 관계/감정선/거리감 변화가 분명히 느껴지도록 훅을 설계하되, **연애 감정만 반복하는 구성은 금지**한다.\n"
                "    - 반드시 '관계 축(로맨스/순애)' + '메인 갈등/상황(비로맨스) 1개'를 함께 세워라.\n"
                "    - 예: 금지된 관계/비밀, 다정-냉담 갭, 집착과 절제, 구원/상처/후회, 역전/재회.\n"
            )
        else:
            audience_rules = (
                "- [성향=전체 톤 가드레일]\n"
                "  - ✅ 유저 성별/상대 성별을 고정 가정하지 마라(성향과 무관하게 생성).\n"
                "  - ✅ 로맨스/성장/서바이벌 등 1개 축을 선택해 훅을 선명하게 만들되, 과도한 클리셰는 피하라.\n"
            )
    except Exception:
        audience_rules = ""

    market_style_block = _build_market_style_block(audience_slug=audience_slug, mode_slug=mode_slug, nonce=nonce)
    # ✅ 톤 가드: 태그 기반으로 프레이밍 지침 주입 (순애↔어두운 소재 분기)
    tone_guard = _build_tone_guard_block(tags_user or [], mode=mode_slug)

    # ✅ 작품명 스타일 규칙: 모드(RP/시뮬) + 문장형 토글에 따라 백엔드 출력 규칙을 직접 분기
    if mode_slug == "simulator":
        # 시뮬레이터: 크랙/바베챗 인기 시뮬 스타일 제목
        title_style_rules = (
            "- ✅ [작품명 역할·시뮬] 크랙/바베챗에서 대화수 10만+ 찍는 인기 시뮬 크리에이터로서 제목을 지어라.\n"
            "  - 제목만 봐도 '무슨 게임/세계관인지' 바로 떠올라야 한다.\n"
            "  - 세계관명/장소/시스템/유저 상황이 제목의 핵심(캐릭터 이름은 선택).\n"
            "  - 짧고 임팩트 있게. 밈/구어체/반말 톤 적극 허용.\n"
            "  - 크랙 인기작 톤 참고: '피라미드 학교', '제1구역 생존고교', '아카데미 히든직업이되다', '안경을 벗었더니', '군대에 나 혼자 남자', '입양아 주제에.', '강산고등학교', '실세'"
        )
    elif want_sentence_title:
        # RP + 문장형 ON
        title_style_rules = (
            "- ✅ [작품명 역할·필수] 너는 노벨피아/카카오페이지 베테랑 웹소설 작가다. 한줄소개의 반전/떡밥을 밈·가십 톤 반말 구어체로 함축해 제목을 지어라.\n"
            "  - 작품명은 반드시 반말 구어체 종결(~함, ~임, ~됨, ~해버림, ~인데, ~했음, ~음)로 끝나야 한다.\n"
            "  - 절대금지: 문학체(~하다/~이다/~지다/~였다), 명사 종결(~서신/~혈통/~팔).\n"
            "  - 한줄소개에 등장하는 캐릭터 고유 이름이 작품명에 반드시 포함. 종족/직업명 대체 금지."
        )
    else:
        # RP + 문장형 OFF (자유)
        title_style_rules = (
            "- ✅ [작품명 역할] 캐릭터챗 인기 크리에이터로서 한줄소개를 요약해 클릭을 부르는 제목을 지어라.\n"
            "  - 한줄소개에 등장하는 캐릭터 고유 이름이 작품명에 반드시 포함. 종족/직업명 대체 금지.\n"
            "  - 65%는 짧고 강한 형태(이름+수식어/상황), 35%는 웹소설 밈 톤 문장형(반말 구어체 ~함/~됨/~인데/~해버림 종결) 중 자연스럽게 선택."
        )

    # ✅ 이름 일치 규칙: RP는 필수, 시뮬은 불필요 (시뮬 제목에 캐릭터 이름이 없을 수 있음)
    if mode_slug == "simulator":
        name_consistency_rule = "- [생성 순서] 한줄소개(description)를 먼저 구상하라. 세계관/상황/규칙을 확정한 뒤 그것을 바탕으로 작품명(name)을 정해라."
        json_schema_block = (
            "[JSON 스키마 - description을 먼저 완성한 뒤 name을 작성할 것]\n"
            "{{\n"
            '  "description": "한줄소개(20~300자, 4~5문장, 줄바꿈 금지, 세계관/상황/규칙 포함)",\n'
            '  "name": "작품명(8~35자, 세계관/장소/시스템이 바로 보이는 제목)"\n'
            "}}"
        )
    else:
        name_consistency_rule = (
            "- [생성 순서 필수] 한줄소개(description)를 먼저 구상하라. 캐릭터 고유 이름과 상황/갈등을 한줄소개에서 확정한 뒤, 그 이름과 핵심 상황을 바탕으로 작품명(name)을 정해라.\n"
            "- [이름 일치 필수] 작품명(name)에 등장하는 캐릭터 이름과 한줄소개(description)에 등장하는 캐릭터 이름은 반드시 동일해야 한다. 서로 다른 이름이 나오면 실패로 간주한다."
        )
        json_schema_block = (
            "[JSON 스키마 - ★반드시 description을 먼저 완성한 뒤 name을 작성할 것★]\n"
            "{{\n"
            '  "description": "한줄소개(20~300자, 4~5문장, 줄바꿈 금지, 캐릭터 고유 이름 포함)",\n'
            '  "name": "작품명(8~35자, ★description에 나온 캐릭터 이름과 동일한 이름★ 포함 필수)"\n'
            "}}\n"
            "★★★ name과 description에 등장하는 캐릭터 이름이 다르면 무조건 실패다. 반드시 동일한 이름을 써라. ★★★"
        )

    system = (
        "너는 크랙(Crack)/바베챗(BabeChat)/케이브덕(Caveduck) 같은 캐릭터챗 플랫폼에서 수천 명의 유저를 모은 인기 크리에이터다. 유저가 클릭하고 싶어지는 캐릭터 설정을 작성하는 것이 너의 일이다.\n"
        "반드시 JSON 객체만 출력하고, 다른 텍스트/마크다운/코드블록을 출력하지 마라.\n"
    )
    # ✅ 프로필 자동생성은 "작품명/한줄소개"만 있으면 된다.
    # - JSON이 길고 중첩되면 Flash 모델에서 따옴표/괄호가 깨져 파싱 실패가 자주 발생(=폴백 빈발).
    # - 따라서 프로필 단계에서는 최소 스키마(name/description)만 요구한다.
    user = f"""
[입력]
- 입력 이름(참고): {name_input}
- 랜덤 시드: {nonce}
- 원하는 캐릭터 느낌/설정: {seed_text}
- 선택 태그: {tags_block or "없음"}
      - 이미지 힌트(JSON, 없으면 비어있음): {vision_block or "없음"}
      - 이미지 그라운딩(텍스트, 있으면 우선 참고): {image_grounding or "없음"}

[출력 규칙]
- JSON 객체만 출력한다.
- description/name만 출력한다. 다른 필드(성격/말투/세계관/예시대화 등)는 절대 포함하지 마라.
{name_consistency_rule}
- description(한줄소개)은 반드시 20~300자 범위여야 한다. (4~5문장, 줄바꿈 금지, 키워드 나열/해시태그 금지)
- ✅ (대명사 금지/치환) 한줄소개에서 아래 표현을 쓰지 마라.
  - '그/그녀/그는/그가/그녀가/그녀는/그의/그녀의' 등 3인칭 지시 대명사 → 반드시 캐릭터명(name)을 직접 인용해라.
  - '너/너는/너를/너의/너와' 등 반말 2인칭 → 유저 1인칭 관점(나/내/내가/나를/나와/나에게)으로 바꿔라. ('당신'은 딱딱하니 가급적 쓰지 마라)
- ✅ (말투) 너무 딱딱한 존댓말(예: ~합니다/~됩니다)은 금지. 커뮤니티식 구어체로 자연스럽게 쓰되,
  비속어/초성/과한 유행어/이모지는 금지한다. (예: "~임", "~하는 중", "~하는 느낌" 같은 종결은 허용)
- ✅ (구체성) 작품명/한줄소개는 추상어만으로 채우지 마라.
  - 제목/한줄소개에 '장소/소속/직업/관계/규칙/사건' 중 최소 2개는 구체 명사로 포함하라.
  - (이미지 정보가 없더라도) 태그/소재/모드(롤플/시뮬)에서 나온 키워드 중 1개 이상을 제목 또는 한줄소개에 자연스럽게 반영하라.
- ✅ (메타 금지) 아래 표현/형태는 절대 쓰지 마라.
  - '이미지/사진/그림'을 언급하거나, '분위기/디테일/맞춰/자연스럽게 전개된다' 같은 메타 설명
  - 예: "이미지의 분위기와 디테일에 맞춰 전개된다" (금지)
- (이미지 정보가 있을 때만) 이미지 그라운딩/이미지 힌트(JSON)에 나온 관찰 요소(장소/조명/사물/색/텍스트 등) 중 2개 이상을 작품명/한줄소개에 자연스럽게 녹여라.
- (이미지 정보가 '없음'이면) 이미지를 억지로 추측하지 말고, 태그/소재/후킹 규칙을 우선으로 삼아라.
- 현재 모드: {mode_slug} (seed_text 힌트 기반, 아래 모드 가드레일을 반드시 따른다)
{mode_rules}
{mode_lock_rules}
{market_style_block}
- 현재 성향 태그: {audience_slug or "없음"} (선택 태그에 포함되어 있으며, 아래 톤 가드레일을 반드시 따른다)
{audience_rules}
{tone_guard}
{title_style_rules}
- ✅ 작품명(=프로필/작품명)은 반드시 8~35자 범위여야 한다. (공백 가능, 따옴표/마침표/이모지 금지)
- ✅ "캐릭터챗 RP/시뮬"용으로 클릭을 유도할 만큼 훅이 강해야 한다.
  - 롤플레잉이면: 관계/감정선/거리감 변화의 갈등이 느껴져야 한다.
  - 시뮬레이터면: 목표 1개 + 즉시 리스크/제약 1개가 느껴져야 한다.
- ✅ (중요) 로맨스/순애는 가능하지만 **항상 메인 사건/갈등/룰(비로맨스) 1개가 함께 있어야 한다.**
- ❌ 금지: "그녀를 지키는 나" 같은 감정 서술만 반복 / 소개가 연애 감정만으로 끝남.
- ✅ (중요) 추상 훅 금지: '비밀/수수께끼/알 수 없는' 같은 단어로만 뭉뚱그리지 마라.
  - 특히 "나만 모르는 비밀", "모르는 비밀" 같은 문구는 금지.
  - 대신 비밀/갈등의 **정체를 구체 명사**로 적어라. (예: 협박 영상, 성적 조작 기록, 금기 계약서, 빚 문서, 도청 녹음, 신분 위조, 학내 징계 명단 등)
- ✅ (중요) 훅 단어는 써도 되지만 "단어만" 쓰면 안 된다.
  - '계약/약속/비밀/약점'을 쓰는 경우, 반드시 무엇인지/조건이 뭔지/증거가 뭔지 **구체 명사**를 함께 적어라.
  - 예: "약속" → (구체) "성적 조작 기록을 숨겨주는 조건으로…", "비밀" → (구체) "도청 녹음 파일 때문에…"
- ❌ 흔한 제목 금지(예시 포함): '너와 나', '평범한 나', '우리의', '그와 나', '그녀와 나', '너를', '나를'
- ✅ 제목은 "상황/역전/계약/각성/권력" 같은 단어를 활용해 후킹하되, 키워드 나열은 금지한다.

{json_schema_block}
""".strip()

    prompt = f"{system}\n\n{user}"

    stage = "ai_call"
    raw = ""
    ai_fail_reason = ""
    ai_used_sub_model = ""
    ai_ms = 0
    try:
        # ✅ 폴백 원인 제거(핵심): "로컬 랜덤 폴백"으로 떨어지기 전에,
        #    같은 provider 내부에서 sub_model만 바꿔 1회 재시도한다.
        # - 운영 관측 상 특정 계정/키에서 gemini-3-flash-preview가 일시 실패하는 경우가 있어,
        #   gemini-2.5-pro로 1회 폴백(=AI 유지) 후에만 로컬 폴백으로 간다.
        if model == "gemini":
            try:
                # ✅ 기존 동작 유지 + 모델명만 변경:
                # - Gemini 호출 흐름/재시도/폴백 정책은 건드리지 않는다.
                # - sub_model만 "gemini-3-flash-preview"로 기본값을 둔다.
                ai_used_sub_model = ai_sub_model or "gemini-3-flash-preview"
                t_ai = time.perf_counter()
                raw = await get_gemini_completion_json(
                    prompt,
                    model=ai_used_sub_model,
                    temperature=0.4,
                    max_tokens=1400,
                )
                ai_ms = int((time.perf_counter() - t_ai) * 1000)
            except Exception as e1:
                try:
                    logger.warning(f"[quick_character] gemini primary failed, retry with 2.5-pro: {type(e1).__name__}:{str(e1)[:160]}")
                except Exception:
                    pass
                ai_used_sub_model = "gemini-2.5-pro"
                t_ai = time.perf_counter()
                raw = await get_gemini_completion_json(
                    prompt,
                    model=ai_used_sub_model,
                    temperature=0.4,
                    max_tokens=1400,
                )
                ai_ms = int((time.perf_counter() - t_ai) * 1000)
        elif model == "claude":
            # Claude는 sub_model을 명시하지 않으면 CLAUDE_MODEL_PRIMARY로 간다(ai_service SSOT)
            t_ai = time.perf_counter()
            raw = await get_ai_completion(
                prompt=prompt,
                model=model,
                sub_model=ai_sub_model or None,
                temperature=0.4,
                max_tokens=1400,
            )
            ai_ms = int((time.perf_counter() - t_ai) * 1000)
        else:
            t_ai = time.perf_counter()
            raw = await get_ai_completion(prompt=prompt, model=model, temperature=0.4, max_tokens=1400)
            ai_ms = int((time.perf_counter() - t_ai) * 1000)
    except Exception as e:
        try:
            logger.exception(f"[quick_character] get_ai_completion failed: {e} (model={model} sub_model={ai_used_sub_model or 'default'})")
        except Exception:
            pass
        try:
            ai_fail_reason = f"ai_call_failed:{type(e).__name__}:{str(e)[:160]}"
        except Exception:
            ai_fail_reason = "ai_call_failed"
        raw = ""

    stage = "parse"
    cleaned = raw or ""
    try:
        if "```json" in cleaned:
            cleaned = cleaned.split("```json", 1)[1].split("```", 1)[0].strip()
        elif "```" in cleaned:
            cleaned = cleaned.split("```", 1)[1].split("```", 1)[0].strip()
    except Exception:
        pass

    data: Dict[str, Any] = {}
    parsed_ok = False
    parse_fail_reason = ""

    # ✅ 디버그 옵션: 폴백을 금지하고 원인을 바로 실패로 올린다(테스트/원인 파악용)
    # - 운영에서는 기본 off 유지.
    try:
        import os
        dis = str(os.getenv("QUICK_PROFILE_DISABLE_FALLBACK", "") or "").strip().lower()
        disable_fallback = dis in ("1", "true", "yes", "y", "on")
    except Exception:
        disable_fallback = False

    try:
        raw_json = cleaned or ""
        try:
            if raw_json:
                s = raw_json.find("{")
                e = raw_json.rfind("}")
                if s >= 0 and e > s:
                    raw_json = raw_json[s:e + 1]
        except Exception:
            pass
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
        try:
            parse_fail_reason = f"json_parse_failed:{type(e).__name__}:{str(e)[:160]}"
        except Exception:
            parse_fail_reason = "json_parse_failed"
        # ✅ 원인 추적: 응답 일부를 남긴다(프롬프트는 절대 로그 금지)
        try:
            snippet = str(raw_json or "")[:220].replace("\n", "\\n")
            logger.warning(f"[quick_character][profile] ai_raw_snippet_for_debug {snippet}")
        except Exception:
            pass
        # ✅ 방어: JSON이 아니라도 Python dict 형태로 나오는 케이스를 흡수(패키지 추가 없이)
        try:
            import ast
            obj = ast.literal_eval(raw_json) if raw_json else None
            if isinstance(obj, dict):
                data = obj
                parsed_ok = True
            else:
                data = {}
        except Exception:
            data = {}

    def _salvage_profile_from_loose_text(text: str) -> Dict[str, Any]:
        """
        ✅ Gemini JSON 파싱 실패 구제(핵심)

        배경:
        - 운영 로그에서 gemini-3-flash-preview가 {"name": "...", "description": "..."} 형태로 "거의 JSON"을 내지만,
          따옴표 미종결/줄바꿈/불완전 escape 등으로 json.loads가 자주 실패(=폴백 빈발)했다.
        - 유저 요구사항: "폴백 원인 제거"가 최우선. 따라서 파싱 실패 시, 로컬 폴백으로 떨어지기 전에
          LLM 출력에서 name/description을 최대한 복구한다.

        정책:
        - 출력이 완전한 JSON이 아니어도 "name/description"만 회수한다(다른 필드는 무시).
        - 줄바꿈/\\n은 공백으로 치환한다(한줄소개 규칙 위반 방어).
        - 길이 제약(작품명 8~20, 한줄소개 20~300)을 만족하도록 보수적으로 정리/클램프한다.
        """
        import re

        src_txt = _safe_text(text or "")
        if not src_txt.strip():
            return {}

        # 코드블록 래핑 제거(방어)
        try:
            if "```json" in src_txt:
                src_txt = src_txt.split("```json", 1)[1].split("```", 1)[0].strip()
            elif "```" in src_txt:
                src_txt = src_txt.split("```", 1)[1].split("```", 1)[0].strip()
        except Exception:
            pass

        def _norm_one_line(s: str) -> str:
            try:
                s2 = _safe_text(s or "")
            except Exception:
                s2 = ""
            # 실제 줄바꿈/이스케이프 줄바꿈을 모두 제거
            s2 = s2.replace("\r", " ").replace("\n", " ").replace("\\n", " ")
            s2 = re.sub(r"\s+", " ", s2).strip()
            return s2

        def _shrink_title_8_20(s: str) -> str:
            s2 = _norm_one_line(s)
            # 금지 문자(따옴표/마침표/이모지 등) 최소 정리
            try:
                s2 = s2.replace('"', "").replace("'", "").replace("“", "").replace("”", "").replace("’", "").replace("‘", "")
                s2 = s2.replace(".", "").replace("…", "").strip()
            except Exception:
                pass
            if len(s2) <= 20:
                return s2
            # 1차: 20자 이내에서 마지막 공백 기준으로 잘라 자연스러움 유지
            head = s2[:20]
            try:
                if " " in head:
                    head2 = head[: head.rfind(" ")].strip()
                    if len(head2) >= 8:
                        return head2
            except Exception:
                pass
            # 2차: 강제 클램프(최소 길이 만족 시에만)
            head = head.strip()
            return head if len(head) >= 8 else ""

        def _clamp_desc_20_300(s: str) -> str:
            s2 = _norm_one_line(s)
            # 끝에 남는 JSON 조각 제거(방어)
            try:
                s2 = re.sub(r'"\s*[,}]\s*$', "", s2).strip()
                s2 = re.sub(r"[}\]]\s*$", "", s2).strip()
            except Exception:
                pass
            if len(s2) > 300:
                s2 = s2[:300].strip()
            return s2 if len(s2) >= 20 else ""

        name_val = ""
        desc_val = ""
        try:
            # 가장 흔한 케이스: JSON 키/값 따옴표
            m_name = re.search(r'"name"\s*:\s*"([^"\n\r]{1,120})"', src_txt)
            if m_name:
                name_val = m_name.group(1)
        except Exception:
            pass
        try:
            # description은 줄바꿈/불완전 escape 때문에 json이 깨지는 경우가 많아 DOTALL로 넓게 잡는다.
            m_desc = re.search(r'"description"\s*:\s*"([\s\S]*?)"\s*[,}]', src_txt)
            if m_desc:
                desc_val = m_desc.group(1)
        except Exception:
            pass
        try:
            # 닫는 따옴표가 없는 케이스(중간에서 끊기거나, 줄바꿈으로 깨진 케이스) 구제
            if (not desc_val) and ('"description"' in src_txt):
                m_desc2 = re.search(r'"description"\s*:\s*"([\s\S]*)$', src_txt)
                if m_desc2:
                    desc_val = m_desc2.group(1)
        except Exception:
            pass

        name_fixed = _shrink_title_8_20(name_val)
        desc_fixed = _clamp_desc_20_300(desc_val)
        out: Dict[str, Any] = {}
        if name_fixed:
            out["name"] = name_fixed
        if desc_fixed:
            out["description"] = desc_fixed
        return out

    # ✅ JSON 파싱 실패 시, 로컬 폴백 이전에 name/description을 최대한 복구한다.
    if not parsed_ok:
        try:
            salvaged = _salvage_profile_from_loose_text(cleaned or "")
            if isinstance(salvaged, dict) and (salvaged.get("name") or salvaged.get("description")):
                data = salvaged
                parsed_ok = True
                parse_fail_reason = ""
                stage = "salvage_parse"
                try:
                    logger.info("[quick_character][profile] salvage_parse_ok")
                except Exception:
                    pass
        except Exception:
            pass

    # ✅ 파싱 실패(=폴백 직전) 시, "name/description만" 1회 재요청으로 복구 시도한다.
    # - 로컬 랜덤 폴백을 피하는 것이 목적(유저 요청).
    if (not parsed_ok) and (not disable_fallback):
        try:
            stage = "repair_ai_call"
            repair_prompt = f"""
너는 JSON만 출력해야 한다. 다른 텍스트/마크다운/코드블록 금지.

[출력 규칙]
- 아래 JSON 스키마만 출력:
{{"name":"8~35자 작품명","description":"20~300자 한줄소개(4~5문장, 줄바꿈 금지)"}}
- 문자열 안에 따옴표(\")를 쓰지 마라. 줄바꿈을 쓰지 마라.

[입력]
- seed_text: {seed_text}
- tags: {tags_block or "없음"}
- image_hints_json: {vision_block or "없음"}
- image_grounding: {image_grounding or "없음"}
""".strip()

            raw_repair = ""
            if model == "gemini":
                raw_repair = await get_gemini_completion_json(
                    repair_prompt,
                    model=ai_used_sub_model or "gemini-3-flash-preview",
                    temperature=0.2,
                    max_tokens=900,
                )
            else:
                raw_repair = await get_ai_completion(
                    prompt=repair_prompt,
                    model=model,
                    temperature=0.2,
                    max_tokens=900,
                )
            cleaned_r = str(raw_repair or "").strip()
            # ```json 제거
            try:
                if "```json" in cleaned_r:
                    cleaned_r = cleaned_r.split("```json", 1)[1].split("```", 1)[0].strip()
                elif "```" in cleaned_r:
                    cleaned_r = cleaned_r.split("```", 1)[1].split("```", 1)[0].strip()
            except Exception:
                pass
            # {..} 구간만
            try:
                s3 = cleaned_r.find("{")
                e3 = cleaned_r.rfind("}")
                if s3 >= 0 and e3 > s3:
                    cleaned_r = cleaned_r[s3:e3 + 1]
            except Exception:
                pass
            # trailing comma 제거
            try:
                import re
                cleaned_r = re.sub(r",\s*([}\]])", r"\1", cleaned_r)
            except Exception:
                pass
            d3 = json.loads(cleaned_r) if cleaned_r else {}
            if isinstance(d3, dict) and (_safe_text(d3.get("name")).strip() or _safe_text(d3.get("description")).strip()):
                data = d3
                parsed_ok = True
                parse_fail_reason = ""
                try:
                    logger.info("[quick_character][profile] repair_parse_ok")
                except Exception:
                    pass
        except Exception as e:
            try:
                logger.warning(f"[quick_character][profile] repair_failed: {type(e).__name__}:{str(e)[:160]}")
            except Exception:
                pass

    # ✅ 디버그/운영 관측: "왜 폴백으로 떨어졌는지"를 로그로 남긴다(유저가 체감하는 품질 이슈 원인 추적용)
    # - UI에는 노출하지 않는다(요청사항: 불필요한 설명 텍스트 제거).
    try:
        raw_len = len(str(raw or ""))
        got_name = bool(_safe_text((data or {}).get("name")).strip())
        got_desc = bool(_safe_text((data or {}).get("description")).strip())
        logger.info(
            f"[quick_character][profile] ai_result "
            f"model={model} sub_model={ai_used_sub_model or 'default'} ai_ms={ai_ms} "
            f"raw_len={raw_len} parsed_ok={parsed_ok} "
            f"got_name={got_name} got_desc={got_desc} "
            f"ai_fail={bool(ai_fail_reason)} parse_fail={bool(parse_fail_reason)}"
        )
        if (not parsed_ok) or (not got_name) or (not got_desc) or ai_fail_reason or parse_fail_reason:
            logger.warning(
                f"[quick_character][profile] fallback_reason "
                f"stage={stage} {ai_fail_reason or ''} {parse_fail_reason or ''}".strip()
            )
    except Exception:
        pass

    # ✅ 후보 3개 중 서버가 1개 자동 선택(구체성/길이/금지패턴)
    def _looks_bland_title(t: str) -> bool:
        try:
            s = str(t or "").strip()
        except Exception:
            return True
        if not s:
            return True
        bad = ("너와 나", "평범한 나", "우리의", "그와 나", "그녀와 나", "너를", "나를")
        if any(x in s for x in bad):
            return True
        return False

    def _len_ok_title(t: str) -> bool:
        try:
            s = str(t or "").strip()
        except Exception:
            return False
        return 8 <= len(s) <= 20

    def _len_ok_desc(d: str) -> bool:
        try:
            s = str(d or "").strip()
        except Exception:
            return False
        return 20 <= len(s) <= 300

    def _looks_bland_desc(d: str) -> bool:
        """
        한줄소개 '뻔함' 감지(경험적 휴리스틱).
        - 유저 피드백: "차분/여유/분위기 정리" 같은 평가형 문장만 나오면 너무 추상적이라 클릭 훅이 없다.
        - 목적: 후보 선택/재시도 트리거에서 이런 문장을 강하게 배제한다.
        """
        try:
            s = str(d or "").strip()
        except Exception:
            return True
        if not s:
            return True
        bad = (
            "차분", "여유", "분위기", "정리", "배려", "다정", "따뜻", "상냥",
            "단호", "무뚝뚝", "냉정", "담담", "설레", "심쿵", "행복",
        )
        # 너무 짧은 평가문 + 추상 키워드만 있을 때를 우선적으로 잡는다.
        if len(s) <= 70 and any(w in s for w in bad):
            return True
        return False

    def _has_vague_hook_desc(d: str) -> bool:
        """
        ✅ '비밀' 같은 추상 훅 감지(재생성 트리거)

        배경:
        - 유저 피드백: "비밀"이라고만 하면 무엇인지 몰라서 후킹이 약함.
        - 따라서 '비밀'을 쓰더라도, 구체 대상(증거/문서/영상/계약/명단 등)이 함께 있어야 한다.
        """
        import re
        try:
            s = str(d or "").strip()
        except Exception:
            return False
        if not s:
            return False
        # 가장 문제되는 패턴은 강하게 잡는다.
        try:
            if re.search(r"(나만\s*모르는|모르는)\s*비밀", s):
                return True
        except Exception:
            pass
        if "비밀" not in s:
            return False
        # '비밀'이 나오면 최소한의 구체 명사 앵커가 있어야 통과
        anchors = (
            "계약", "조건", "위약금", "규칙", "금기", "증거", "영상", "녹음", "도청", "파일", "기록",
            "명단", "문서", "서류", "성적", "시험지", "협박", "빚", "대출", "장부", "거래",
            "신분", "정체", "위조", "표식", "낙인", "주문서", "혈통", "반역", "추방",
        )
        try:
            if any(a in s for a in anchors):
                return False
        except Exception:
            return False
        return True

    def _has_overused_generic_hook_word(d: str) -> bool:
        """
        ✅ 반복 수렴 훅 단어 감지(재생성 트리거)

        배경:
        - 운영 피드백: 남성향/롤플에서 '계약/약속/비밀/약점'으로 과하게 수렴한다.
        - 시장성 힌트 토큰을 랜덤샘플링해도 모델이 이 단어로 마무리하는 경향이 있어,
          "단어만 던지는" 추상 훅을 1회 재생성으로 구체화한다.

        정책:
        - 단어 자체를 금지하지 않는다.
        - 다만 '무슨 계약/무슨 약점/무슨 약속인지'가 없이 뭉뚱그리면 트리거한다.
        """
        import re
        try:
            s = str(d or "").strip()
        except Exception:
            return False
        if not s:
            return False

        # 비밀은 별도 로직(_has_vague_hook_desc)에서 더 정교하게 다루므로 여기선 제외
        bad = ("계약", "약속", "약점")
        if not any(w in s for w in bad):
            return False

        # "조건/대가/위약금/기록/영상/녹음/문서/명단/빚/협박" 같은 구체 앵커가 있으면 통과
        anchors = (
            "조건", "대가", "위약금", "기간", "서약", "합의", "계약서", "각서",
            "증거", "기록", "영상", "녹음", "도청", "파일", "문서", "서류", "명단",
            "성적", "시험지", "장부", "빚", "대출", "협박", "신분", "위조", "징계",
        )
        if any(a in s for a in anchors):
            return False

        # 숫자/조건절이 있으면(예: "3일", "7일 안에", "대신") 어느 정도 구체화로 보고 통과
        try:
            if re.search(r"\d+\s*(일|주|개월|년|번)", s) or ("대신" in s):
                return False
        except Exception:
            pass

        return True

    def _sentence_count_hint(d: str) -> int:
        """
        ✅ 한줄소개 문장수(대략) 카운트

        목표:
        - 요구사항: 한줄소개를 4~5문장으로 늘린다.
        - 모델이 1문장으로 뭉개면 '자세함/후킹'이 약해지므로 1회 재생성 트리거로 사용한다.

        주의:
        - 한국어는 마침표 없이도 문장이 가능하므로 완벽한 카운트는 불가능.
        - 여기서는 '.', '!', '?' 기준으로만 보수적으로 측정한다(오탐 최소).
        """
        import re
        try:
            s = str(d or "").strip()
        except Exception:
            return 0
        if not s:
            return 0
        # 종결부호 기준으로 분리(빈 토큰 제거)
        parts = [p.strip() for p in re.split(r"[.!?]+", s) if str(p or "").strip()]
        return len(parts)

    def _concreteness_score(title_s: str, desc_s: str) -> int:
        """
        구체성 점수(방어적 휴리스틱).
        - '장소/소속/직업/관계/규칙/사건' 중 최소 2개가 느껴지면 가산점을 준다.
        """
        blob = f"{title_s} {desc_s}"
        cats = 0
        try:
            place = ("학교", "고등학교", "대학교", "아카데미", "교실", "캠퍼스", "PC방", "연구소", "회사", "사무실", "기숙사", "왕궁", "성", "던전", "게이트", "거리", "카페", "집", "지하")
            role = ("학생회장", "일진", "선생님", "과탑", "매니저", "헌터", "마법사", "기사", "용사", "마왕", "여왕", "성녀", "악마", "천사", "닌자", "스트리머", "알바", "교주", "황제", "조직", "마피아")
            relation = ("여사친", "소꿉친구", "선배", "후배", "누나", "여동생", "동거", "부부", "아내", "남친", "여친", "스승", "제자", "주인", "노예")
            rule = ("계약", "조건", "위약금", "규칙", "교칙", "미션", "퀘스트", "난이도", "시스템", "투표", "서열", "등급", "랭킹")
            event = ("납치", "감금", "복수", "후회", "재회", "생존", "탈출", "전학", "빙의", "각성", "회귀", "역전")
            for group in (place, role, relation, rule, event):
                if any(k in blob for k in group):
                    cats += 1
        except Exception:
            cats = 0
        # 최소 2개 이상이면 강한 구체성으로 간주
        return 25 if cats >= 2 else (-10 if cats == 0 else 5)

    def _has_meta_phrase(title_s: str, desc_s: str) -> bool:
        """
        메타 문구 감지(강한 배제).

        배경:
        - 유저 피드백: "이미지의 분위기/디테일에 맞춰 자연스럽게 전개된다" 류 문구가 반복됨.
        - 이는 "작품 소개"가 아니라 "가이드 문장"이라 품질을 크게 떨어뜨린다.

        정책:
        - 단순히 '전개/분위기' 같은 일반 단어만으로는 배제하지 않고,
          '이미지/사진/그림' 언급 또는 문제 구문 패턴이 포함될 때만 메타로 판단한다.
        """
        try:
            blob = f"{title_s} {desc_s}"
        except Exception:
            return True
        # 이미지 언급 자체가 있으면 메타로 간주(프로필/한줄소개에서 금지)
        if any(w in blob for w in ("이미지", "사진", "그림")):
            return True
        # 문제 구문 패턴(이미지 단어가 변형되거나 누락돼도 잡히도록)
        bad_phrases = (
            "분위기와 디테일",
            "디테일에 맞춰",
            "맞춰 자연스럽게",
            "자연스럽게 전개",
            "디테일에 맞춰 자연스럽게",
        )
        return any(p in blob for p in bad_phrases)

    def _strip_meta_tail(desc_s: str) -> str:
        """
        메타 문장 제거(최후 방어).
        - 후보/재생성 모두 메타가 섞이면, '메타 문장'이 들어간 절(문장)을 제거한다.
        - 너무 짧아지면 원본을 유지(추가 실패 방지).
        """
        try:
            s = str(desc_s or "").strip()
        except Exception:
            return str(desc_s or "")
        if not s:
            return s
        # 문장 단위로 분리(간단): 마침표 기준
        parts = [p.strip() for p in s.split(".") if p.strip()]
        if len(parts) <= 1:
            # ✅ 단문(마침표가 없거나 1개 이하)에서도 메타 구문이 섞이면 잘라낸다.
            # - 예: "... 여유가 있다 이미지의 분위기와 디테일에 맞춰 ..." 처럼 한 문장으로 붙는 케이스
            try:
                if not _has_meta_phrase("", s):
                    return s
                markers = ("이미지", "사진", "그림") + (
                    "이미지의 분위기와 디테일",
                    "분위기와 디테일",
                    "디테일에 맞춰",
                    "맞춰 자연스럽게",
                    "자연스럽게 전개",
                    "디테일에 맞춰 자연스럽게",
                )
                idxs = [s.find(m) for m in markers if (m and (s.find(m) >= 0))]
                if not idxs:
                    return s
                cut_at = min(idxs)
                prefix = s[:cut_at].strip().rstrip(".").strip()
                return prefix if len(prefix) >= 20 else s
            except Exception:
                return s
        kept: List[str] = []
        for p in parts:
            if _has_meta_phrase("", p):
                continue
            kept.append(p)
        if not kept:
            return s
        out = ". ".join(kept).strip()
        # 원래처럼 마침표를 끝에 붙일지 여부는 문장수에 따라 유지
        if s.endswith("."):
            out = out + "."
        # 길이 방어: 너무 짧아지면 원본 유지
        return out if len(out) >= 20 else s

    # ✅ 후보 선택 로직 제거: 단일 스키마만 사용(이전 동작으로 롤백)
    # + 방어: 모델이 종종 {"basic_info": {"name":..,"description":..}} 형태로 중첩해서 내보내는 케이스가 있어 흡수한다.
    src = data if isinstance(data, dict) else {}
    try:
        if isinstance(src, dict) and (not _safe_text(src.get("name")).strip() or not _safe_text(src.get("description")).strip()):
            # 흔한 중첩 키 폴백(QuickGenerate 응답 모델명 때문에 LLM이 착각하는 케이스)
            for k in ("basic_info", "profile", "result", "data"):
                inner = src.get(k)
                if isinstance(inner, dict) and (_safe_text(inner.get("name")).strip() or _safe_text(inner.get("description")).strip()):
                    src = inner
                    break
    except Exception:
        pass

    name_from_ai = _clip(src.get("name"), 100)
    name_candidate = _safe_text(name_from_ai).strip()
    # ✅ 폴백 진단/차단(옵션)
    # - QUICK_PROFILE_DISABLE_FALLBACK=1 이면, "폴백으로 덮기" 대신 즉시 실패를 올려
    #   원인을 프론트 토스트/서버 로그로 바로 확인할 수 있게 한다.
    # - 기본값은 off(운영 안정 유지).
    try:
        if disable_fallback:
            missing = []
            if not parsed_ok:
                missing.append("parsed_ok=false")
            if ai_fail_reason:
                missing.append(ai_fail_reason)
            if parse_fail_reason:
                missing.append(parse_fail_reason)
            if not name_candidate:
                missing.append("name_missing")
            desc_probe = _safe_text(src.get("description")).replace("\n", " ").strip()
            if not desc_probe:
                missing.append("description_missing")
            if missing:
                raise RuntimeError("quick_profile_no_fallback:" + " | ".join(missing)[:500])
    except Exception:
        # 위 RuntimeError는 그대로 전파되어 /quick-generate에서 500으로 반환된다.
        # 그 외 예외는 폴백 흐름을 방해하지 않게 무시한다.
        if disable_fallback:
            raise
    if _is_placeholder_name(name_candidate):
        name_candidate = fallback_name
    if _is_placeholder_name(name_candidate):
        name_candidate = name_input
    name = name_candidate or (fallback_name or "캐릭터")

    description = _clip(src.get("description"), 3000).replace("\n", " ").strip()
    def _normalize_profile_pronouns(character_name: str, desc: str) -> str:
        """
        ✅ 프로필 한줄소개 표기 규칙 강제(운영 UX)

        요구사항:
        - '그/그녀' 같은 3인칭 지시대명사 대신 반드시 캐릭터명을 직접 인용
        - '너' 같은 반말 2인칭 대신 '나/내' 계열 표현 사용(유저 1인칭 관점)

        의도:
        - 모델이 규칙을 어겨도 최종 결과는 UI/마켓에 맞게 안정적으로 보정한다.
        - 과치환(예: '그냥')을 피하기 위해 '그' 단독은 치환하지 않고, 흔한 결합형만 안전하게 치환한다.
        """
        import re

        nm = _safe_text(character_name).strip()
        s = _safe_text(desc).replace("\r", " ").replace("\n", " ").strip()
        if (not nm) or (not s):
            return s

        # 1) '그녀' 결합형
        rules = [
            (r"\b그녀는\b", f"{nm}는"),
            (r"\b그녀가\b", f"{nm}가"),
            (r"\b그녀를\b", f"{nm}를"),
            (r"\b그녀의\b", f"{nm}의"),
            (r"\b그녀와\b", f"{nm}와"),
            (r"\b그녀에게\b", f"{nm}에게"),
            (r"\b그녀한테\b", f"{nm}에게"),
            (r"\b그녀\b", nm),
        ]
        # 2) '그' 결합형(단독 '그'는 '그냥' 등 오탐이 커서 제외)
        rules += [
            (r"\b그는\b", f"{nm}는"),
            (r"\b그가\b", f"{nm}가"),
            (r"\b그를\b", f"{nm}를"),
            (r"\b그의\b", f"{nm}의"),
            (r"\b그와\b", f"{nm}와"),
            (r"\b그에게\b", f"{nm}에게"),
            (r"\b그한테\b", f"{nm}에게"),
        ]
        # 3) '너' 결합형 → '나' 계열(1인칭)
        rules += [
            (r"\b너는\b", "나는"),
            (r"\b너가\b", "내가"),
            (r"\b너를\b", "나를"),
            (r"\b너의\b", "내"),
            (r"\b너와\b", "나와"),
            (r"\b너에게\b", "나에게"),
            (r"\b너한테\b", "나에게"),
            (r"\b너\b", "나"),
        ]
        # 4) '당신' 계열도 1인칭으로 정리(딱딱함 완화)
        rules += [
            (r"\b당신은\b", "나는"),
            (r"\b당신이\b", "내가"),
            (r"\b당신을\b", "나를"),
            (r"\b당신의\b", "내"),
            (r"\b당신과\b", "나와"),
            (r"\b당신에게\b", "나에게"),
            (r"\b당신한테\b", "나에게"),
            (r"\b당신\b", "나"),
        ]

        out = s
        for pat, rep in rules:
            try:
                out = re.sub(pat, rep, out)
            except Exception:
                continue
        # 공백 정리
        try:
            out = re.sub(r"\s+", " ", out).strip()
        except Exception:
            pass
        return out

    # ✅ 대명사 규칙 강제(모델이 어겨도 최종 보정)
    description = _normalize_profile_pronouns(name, description)
    # ✅ 최후 방어: 메타 문장 제거(선택/재생성 실패를 흡수)
    if _has_meta_phrase(name, description):
        description = _strip_meta_tail(description)
    personality = _clip(src.get("personality"), 2000)
    speech_style = _clip(src.get("speech_style"), 2000)
    world_setting = _clip(src.get("world_setting"), 6000)
    greetings = _clean_list_str(src.get("greetings"), max_items=3, max_len_each=500)
    intro = _clean_intro_scene(src.get("introduction_scene"))
    exds = _clean_dialogues(src.get("example_dialogues"))

    if (not description) or _is_generated_seed_text(description):
        if not parsed_ok:
            description = fallback_description
        else:
            description = (_clip(seed_text, 300).strip() if seed_text and (not _is_generated_seed_text(seed_text)) else "") or fallback_description
        # 폴백/시드 적용 후에도 표기 규칙 유지
        description = _normalize_profile_pronouns(name, description)

    # ✅ 폴백 사용 여부를 서버 로그로 명확히 남긴다.
    try:
        used_fb_name = (name == fallback_name) or (name == name_input and _is_placeholder_name(_safe_text(src.get("name")).strip()))
        used_fb_desc = (description == fallback_description)
        if used_fb_name or used_fb_desc:
            logger.warning(
                f"[quick_character][profile] fallback_applied "
                f"used_name={bool(used_fb_name)} used_desc={bool(used_fb_desc)} "
                f"parsed_ok={parsed_ok} ai_fail={bool(ai_fail_reason)} parse_fail={bool(parse_fail_reason)}"
            )
    except Exception:
        pass

    try:
        # ✅ 단일 결과가 아래 조건이면 1회 재생성으로 보정한다.
        # - 메타 문구(이미지/분위기/디테일/전개) 포함
        # - 구체성 부족(카테고리 2개 미만으로 추정)
        mode_signal_ok = True
        try:
            blob_mode = f"{name} {description}"
            if mode_slug == "simulator":
                mode_signal_ok = _mentions_any(
                    blob_mode,
                    ["시뮬", "턴", "목표", "미션", "규칙", "제약", "리스크", "자원", "선택", "루트"],
                )
            else:
                mode_signal_ok = _mentions_any(
                    blob_mode,
                    ["관계", "감정", "긴장", "거리", "비밀", "계약", "집착", "보호", "유혹", "로맨스"],
                )
        except Exception:
            mode_signal_ok = True

        need_retry = (
            _looks_bland_title(name)
            or (not _len_ok_title(name))
            or (not _len_ok_desc(description))
            or _has_meta_phrase(name, description)
            or (_concreteness_score(name, description) < 25)
            or _looks_bland_desc(description)
            or _has_vague_hook_desc(description)
            or (_sentence_count_hint(description) == 1)  # 1문장이면 너무 뭉개지는 케이스가 많아 1회 보정
            or _has_overused_generic_hook_word(description)
            or (not mode_signal_ok)
        )
        if need_retry:
            retry_user = f"""
[재생성 규칙(중요)]
- 작품명(name): 8~35자, 흔한 '너와 나/평범한 나/우리의/그와 나' 패턴 금지, 상황/역전/계약/각성/권력 훅이 느껴져야 한다.
- 한줄소개(description): 20~300자, 1~2문장, 줄바꿈 금지. RP/시뮬에 맞는 갈등/목표+제약이 느껴져야 한다.
- 대명사 금지: '그/그녀' 같은 3인칭 대신 반드시 캐릭터명(name)을 직접 쓰고, '너' 대신 '나/당신' 계열 표현을 써라.
- 메타 금지: '이미지/사진/그림/분위기/디테일/전개/맞춰/자연스럽게' 같은 표현은 절대 쓰지 마라.
- 추상 훅 금지: "나만 모르는 비밀" 같은 뭉뚱그린 문구 금지. 비밀/갈등의 정체를 구체 명사(증거/문서/영상/계약/명단 등)로 적어라.
- (이미지 정보가 있을 때만) 이미지 그라운딩/이미지 힌트에 나온 관찰 요소를 최소 2개 이상 자연스럽게 포함할 것.
- 현재 모드: {mode_slug} (아래 모드 가드레일을 반드시 따른다)
{mode_rules}
{mode_lock_rules}
{market_style_block}
- 현재 성향 태그: {audience_slug or "없음"} (아래 톤 가드레일을 반드시 따른다)
{audience_rules}
- 출력은 JSON 객체만.

[입력]
- 태그: {tags_block or "없음"}
- 이미지 힌트(JSON): {vision_block or "없음"}
- 이미지 그라운딩: {image_grounding or "없음"}
""".strip()
            retry_prompt = f"{system}\n\n{retry_user}\n\n{user}"
            if model == "gemini":
                raw2 = await get_gemini_completion_json(
                    retry_prompt,
                    model=ai_used_sub_model or "gemini-3-flash-preview",
                    temperature=0.5,
                    max_tokens=1400,
                )
            else:
                raw2 = await get_ai_completion(
                    prompt=retry_prompt,
                    model=model,
                    temperature=0.5,
                    max_tokens=1400,
                )
            cleaned2 = raw2 or ""
            try:
                if "```json" in cleaned2:
                    cleaned2 = cleaned2.split("```json", 1)[1].split("```", 1)[0].strip()
                elif "```" in cleaned2:
                    cleaned2 = cleaned2.split("```", 1)[1].split("```", 1)[0].strip()
            except Exception:
                pass
            try:
                raw_json2 = cleaned2 or ""
                try:
                    if raw_json2:
                        s2 = raw_json2.find("{")
                        e2 = raw_json2.rfind("}")
                        if s2 >= 0 and e2 > s2:
                            raw_json2 = raw_json2[s2:e2 + 1]
                except Exception:
                    pass
                try:
                    import re
                    raw_json2 = re.sub(r",\s*([}\]])", r"\1", raw_json2)
                except Exception:
                    pass
                data2 = json.loads(raw_json2) if raw_json2 else {}
                if isinstance(data2, dict):
                    name2 = _safe_text(_clip(data2.get("name"), 100)).strip()
                    desc2 = _safe_text(_clip(data2.get("description"), 3000)).replace("\n", " ").strip()
                    if name2 and (not _looks_bland_title(name2)) and _len_ok_title(name2):
                        name = name2
                    if desc2 and _len_ok_desc(desc2):
                        description = desc2
                    # 재생성 결과도 표기 규칙 강제
                    description = _normalize_profile_pronouns(name, description)
                    # 재생성 이후에도 메타가 끼면 제거/폴백
                    if _has_meta_phrase(name, description):
                        description = _strip_meta_tail(description)
            except Exception:
                pass
    except Exception:
        pass
    if not personality:
        personality = f"{name}의 성격/특징을 채워주세요."
    if not speech_style:
        speech_style = "자연스러운 한국어로 말합니다."
    if not greetings:
        greetings = [f"안녕, {{user}}. 나는 {name}야. 오늘은 어떤 이야기를 해볼까?"]
    if not intro:
        intro = {"title": "도입부 1", "content": f"{name}와(과) 대화가 시작됩니다.", "secret": ""}
    if not exds:
        exds = [{"user_message": "안녕!", "character_response": greetings[0][:350]}]

    greeting_join = "\n".join([g.strip() for g in greetings if g.strip()])[:500]

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

    dialogues = [
        ExampleDialogue(user_message=d["user_message"], character_response=d["character_response"], order_index=i)
        for i, d in enumerate(exds[:2])
    ]
    example_dialogues = CharacterExampleDialogues(dialogues=dialogues)

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
        user_display_description=None,
        use_custom_description=False,
        introduction_scenes=[intro_scene],
        character_type=mode_slug,
        base_language="ko",
        tags=tags_user,
    )

    publish_settings = CharacterPublishSettings(is_public=True, custom_module_id=None, use_translation=True)
    return CharacterCreateRequest(
        basic_info=basic_info,
        media_settings=media_settings,
        example_dialogues=example_dialogues,
        publish_settings=publish_settings,
    )

    if False:
        # 아래는 이전 구현(대형 프롬프트/후보 점수화/시장성 키워드 등)으로,
        # 운영 안정화를 위해 본 핫픽스에서는 실행되지 않는다.
        # (코드 히스토리 보존 목적)

        r'''
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
        try:
            ai_sub_model = _safe_text(getattr(req, "ai_sub_model", None)).strip()
        except Exception:
            ai_sub_model = ""
        model: AIModel = ai_model  # type: ignore[assignment]

        vision_tags, vision_ctx = await _build_vision_hints(image_url)
        # ✅ 캐릭터챗 스타일 해석: 앵커(강제) + 톤/훅(권장) 분리
        interp = _vision_characterchat_interpretation(vision_tags, vision_ctx) or {}
        vision_hints_ko = (interp.get("anchors_ko") or []) if isinstance(interp.get("anchors_ko"), list) else []
        vision_vibe_ko = (interp.get("vibe_ko") or []) if isinstance(interp.get("vibe_ko"), list) else []
        rp_hook_suggestions = (interp.get("roleplay_hook_suggestions") or []) if isinstance(interp.get("roleplay_hook_suggestions"), list) else []
        sim_hook_suggestions = (interp.get("simulator_hook_suggestions") or []) if isinstance(interp.get("simulator_hook_suggestions"), list) else []

        try:
            if vision_hints_ko:
                logger.info(f"[quick_character] vision anchors(ko)={vision_hints_ko}")
            if vision_vibe_ko:
                logger.info(f"[quick_character] vision vibe(ko)={vision_vibe_ko[:10]}")
        except Exception:
            pass

        vision_block = ""
        try:
            if vision_tags or vision_ctx:
                vision_block = json.dumps({"tags": vision_tags, "context": vision_ctx}, ensure_ascii=False)[:2500]
        except Exception:
            vision_block = ""

        tags_block = ", ".join(tags_user) if tags_user else ""
        audience_label = _resolve_audience_label_from_tags(tags_user)

        def _infer_profile_mode_hint(seed_text2: str, tags2: List[str]) -> str:
        """
        프로필(작품명/한줄소개) 자동생성 단계에서 RP/시뮬 "소재 톤"을 추정한다.

        의도/원리(운영 안정/방어적):
        - 이 단계 입력에는 character_type(롤플/시뮬) 값이 없을 수 있다.
        - 대신 seed_text/태그에 포함된 키워드로 "시뮬레이터" 성향 여부를 가볍게 추정해,
          한줄소개가 '관계 중심(RP)' vs '목표/리스크 중심(시뮬)' 중 어느 쪽으로 쏠릴지 힌트를 준다.
        - 불확실하면 기본값은 롤플레잉으로 둔다(기존 UX/출력과 호환).
        """
        try:
            blob = f"{_safe_text(seed_text2)} " + " ".join([_safe_text(t) for t in (tags2 or [])])
            blob = blob.lower()
        except Exception:
            blob = ""

        # 시뮬 쪽에서 자주 등장하는 키워드(목표/미션/자원/각성/경쟁/난이도 등)
        sim_keys = (
            "simulator", "simulation", "시뮬", "시뮬레이터",
            "헌터", "게이트", "던전", "각성", "rpg", "퀘스트", "미션",
            "탈출", "생존", "서바이벌", "추리", "조사", "의뢰",
            # (운영 관찰) 경쟁/자원/룰 메타가 붙으면 시뮬 성향이 강해진다
            "아카데미", "학원도시", "코인", "동전", "자원", "경쟁", "계급", "등급",
            "하드모드", "난이도", "시스템 오류", "error", "code",
        )
        # 롤플 쪽에서 자주 등장하는 키워드(관계/감정선/일상/로맨스 등)
        rp_keys = (
            "roleplay", "롤플", "로맨스", "연애", "순애", "집착", "얀데레",
            "학원", "학교", "선배", "후배", "오피스", "직장", "동거", "재회",
        )

        # 점수 기반(동일 키워드가 섞일 수 있어 안전)
        sim_score = sum(1 for k in sim_keys if k in blob)
        rp_score = sum(1 for k in rp_keys if k in blob)
        if sim_score > rp_score:
            return "simulator"
        return "roleplay"

        mode_hint = _infer_profile_mode_hint(seed_text, tags_user)
        # 성향(남/여/전체)까지 포함해 SSOT 후보군을 넓힌다.
        # - 프론트 칩 UI는 기존(roleplay/simulator)만 노출해도 되며,
        #   자동생성 내부에서는 성향 축까지 고려해 후보군을 더 풍부하게 만든다.
        market_ssot = _market_keywords_for_mode(mode_hint, _resolve_audience_label_from_tags(tags_user))
        user_keys = _extract_profile_keywords_from_seed(seed_text)
        # 시장성 키워드: 유저 선택(우선) + SSOT(후순위, 과다 길이 방어)
        market_keys: List[str] = []
        for k in (user_keys or []):
            if k and k not in market_keys:
                market_keys.append(k)
        for k in (market_ssot or []):
            if k and k not in market_keys:
                market_keys.append(k)
            if len(market_keys) >= 80:
                break

        system = (
        "너는 캐릭터 챗 서비스의 캐릭터 설정을 작성하는 전문가다.\n"
        "반드시 JSON 객체만 출력하고, 다른 텍스트/마크다운/코드블록을 출력하지 마라.\n"
        "허용 토큰은 {{user}}, {{assistant}} 만 사용 가능하다.\n"
        "\n"
        "## 이미지 해석 및 흥미코드 추출(프로필용, 매우 중요)\n"
        "- 입력에 '이미지 힌트(JSON)'가 있으면, 반드시 먼저 아래 순서로 해석하라.\n"
        "  1) **관찰(사실)**: 표정/눈빛/시선, 포즈/거리감, 의상/소품, 배경/장소, 조명/시간대/날씨, 전체 무드에서 '눈에 보이는 것'을 짧게 적어라.\n"
        "  2) **흥미코드(훅) 추출**: 관찰에서 바로 이어지는 '갈등/비밀/관계 긴장/목표/제약'을 1개로 압축하라.\n"
        "     - 롤플레잉 힌트면: 관계/감정선/거리감 변화 중심 훅을 우선.\n"
        "     - 시뮬레이터 힌트면: 목표 1개 + 즉시 리스크/제약 1개가 느껴지는 훅을 우선.\n"
        "  3) **적용**: 작품명/한줄소개에 위 관찰 요소 중 '구체 시각 앵커' 2개 이상을 자연스럽게 녹여라.\n"
        "- 금지:\n"
        "  - 이미지 힌트에 없는 사실을 단정하지 마라(예: 특정 인물 이름/직업/과거 사건을 '봤다'처럼 확정).\n"
        "  - 과도한 감상/미사여구로만 채우지 마라(관찰→훅→적용 흐름이 있어야 함).\n"
        "\n"
        "## 소재/컨셉 생성 규칙(프로필용)\n"
        "- 출력은 '작품명 + 한줄소개'만이므로, **핵심 소재는 1개만** 고르고(과다 혼합 금지) 한줄소개에 자연스럽게 녹여라.\n"
        "  - 예외: 차별화가 필요할 때만 '장르 1개 + 훅 1개'까지 2요소 조합을 허용한다(3개 이상 혼합 금지).\n"
        "- 모드 힌트가 롤플레잉이면: 관계/감정선/거리감 변화가 느껴지게.\n"
        "- 모드 힌트가 시뮬레이터면: 목표(1개) + 즉시 리스크/제약(1개) + 진행 동력이 느껴지게.\n"
        "- 한줄소개는 1~2문장.\n"
        "  - 금지: 대사 직접 인용, 지문 과다, 키워드/태그 나열, 해시태그(#) 출력, '대화를 시작해' 같은 대화 유도 문구.\n"
        "- 아래 '인기 소재 후보'는 참고용이다. **목록을 그대로 나열하지 말고** 1개(또는 2요소)만 선택해 구체화하라.\n"
        "- (제목 패턴, 선택) 작품명은 아래 중 **1개 패턴만** 골라 만들면 훅이 선명해진다:\n"
        "  - 'X: Y' (콜론 구조로 세계관/컨셉 분리)\n"
        "  - '모두가 X하는데 나만 Y' (차별/예외)\n"
        "  - '현 X VS 전 X' (대립/경쟁)\n"
        "  - '나를 X하던 Y의 Z가…' (관계 역설)\n"
        "  - 'X에서 Y를 마주쳤다' (상황 발단)\n"
        "  - '이 X는 난이도가 미쳤다/하드모드' (게임성/압박)\n"
        "  - 'X 주제에' (신분/평가 절하로 시작하는 역전 훅)\n"
        "  - '가짜는 진짜였다' (정체성/대용품 반전 훅)\n"
        "  - '겉으론 X, 속은 Y' (이중성/갭 훅)\n"
        "  - '그래서/그런데 내가 X?' (항의/반문 훅)\n"
        "  - '~에서 ~로 살아남기' (생존 목표 명시)\n"
        "  - '~라이프' (일상/힐링 루틴 강조)\n"
        "\n"
        "## 제목/한줄소개 패턴 후보군(실사용형)\n"
        "- 제목 후보군(택1): 인물명/호칭 단독, 'X의 속마음/비밀/계약/복수', '나만 싫어하는 X',\n"
        "  'X에게만 예외인 Y', 'X 시뮬레이터/시뮬레이션', 'X의 룰/선택/경영/성장', 'X에서 살아남기/탈출하기'\n"
        "- 한줄소개 후보군(택1, 모드별)\n"
        "  - 롤플레잉: 관계/감정선 1개 + 현재 상황 1개 + 거리감 변화 힌트 1개를 1~2문장으로 구성\n"
        "  - 시뮬레이터: 세계관/룰 1개 + 유저 역할 1개 + 목표/리스크 1개를 1~2문장으로 구성\n"
        "- 금지: 운영/안내성 문구.\n"
        "\n"
        "## 후보 3개 생성 → 1개 선택(안정화)\n"
        "- 먼저 서로 다른 컨셉 후보 3개를 만든 뒤, 그 중 1개를 선택해 최종 작품명/한줄소개로 확정하라.\n"
        "- 선택 기준:\n"
        "  - (1) 이미지 앵커 2개 이상이 제목/한줄소개에 자연스럽게 들어가야 함\n"
        "  - (2) 모드 힌트(roleplay/simulator)에 맞는 전개 동력이 느껴져야 함\n"
        "  - (3) 유저가 선택한 소재/키워드가 있으면 우선 반영(억지 나열 금지)\n"
        "\n"
        "## 인기 소재 후보(선택)\n"
        "- 아카데미/학원: (능력/자원/경쟁) 아카데미, 학원도시, 교칙/규칙, 코인/동전, 최면/이능\n"
        "- 관계 역전 훅: 가짜/진짜, 입양아/대용품, 괴롭힘 역전, 신분/권력 반전, 비밀 발각\n"
        "- 감정선(관계 중심): 피폐/후회, 혐관/애증, 경멸/냉소, 집착/과잉 보호, 재회/회귀\n"
        "- 시뮬 요소(게임성): 전쟁/팩션, 경영/영지, 육성/키우기, 회귀/반복, 신/성좌, 매칭/소개소\n"
        "- 시뮬 인터랙션(구조): N단계 질문→결과 생성, 선택지 기반 분기(아이콘/입력), 진영 선택→경로 분기\n"
        "- 시뮬 소재(확장): 메신저/오픈채팅, 온라인 커뮤니티 활동, 매니저/구단 운영, N개 진로 선택, 로그라이크/팀전, 금기 직업 잠입/은폐, 꿈/기억 조정(의뢰)\n"
        "- 관계 훅(힐링/구원): 순애/구원/치유, 트라우마/공포증 동거, 죽은 인연 재회(의심/공포), 나에게만 감정이 드러나는 차별\n"
        "- 성장/각성: 게이트/던전/헌터, 저평가 각성→역전\n"
        "- 아포칼립스/생존: 재난, 좀비/괴물, 혹한/겨울, 안전구역/구역제, 자원 고갈\n"
        "- 판타지/신화: 마왕/용사, 천사/악마, 여신/가호, 계약/저주\n"
        "- 악역/빙의/회귀: 악역 영애, 빙의, 회귀, 하드모드 생존\n"
        "- 미스터리/추리: 사서/도서관/금서, 실종, 단서/조사, 비밀 거래\n"
        "- SF/로봇/밀리터리: 근미래, 로봇/인공존재, 전장/작전, 파일럿/PMC\n"
        "- 일상/힐링/상담: 청춘/일상, 동거/재회, 힐링, 상담, 동물/동화\n"
    )

    user = f"""
[입력]
- 캐릭터 이름(입력): {name_input}
- 랜덤 시드: {nonce}
- 유저가 원하는 느낌/설정: {seed_text}
- 유저가 선택한 태그: {tags_block or "없음"}
- 성향 힌트: {audience_label}
- 성향 톤 가이드(프로필용, 중요): {_audience_generation_hints(audience_label=audience_label, mode=mode_hint)}
- 모드 힌트: {"시뮬레이터" if mode_hint == "simulator" else "롤플레잉"}
- 이미지 힌트(JSON, 있을 때만 참고): {vision_block or "없음"}
- 이미지 톤/전개 해석(캐릭터챗용, 권장): {", ".join(vision_vibe_ko[:12]) if vision_vibe_ko else "없음"}
- RP 훅 제안(권장, 참고): {" / ".join(rp_hook_suggestions[:3]) if rp_hook_suggestions else "없음"}
- 시뮬 훅 제안(권장, 참고): {" / ".join(sim_hook_suggestions[:3]) if sim_hook_suggestions else "없음"}
- 유저 소재/키워드(가능하면 반영): {", ".join(user_keys) if user_keys else "없음"}
- 시장성 참고 소재(SSOT, 나열 금지): {", ".join(market_ssot[:24]) if market_ssot else "없음"}

[출력 규칙]
- 아래 JSON 스키마를 정확히 따를 것. (스키마 외 필드/설명 텍스트 금지)
- 반드시 JSON 객체 1개만 출력할 것.
- 문자열 안에 줄바꿈이 필요하면 실제 줄바꿈 대신 \\n 으로 이스케이프할 것.
- 과도한 설정은 피하고, 사용자 입력과 이미지 힌트에 최대한 근거할 것.
- 입력 이름이 '캐릭터' 또는 '미정'처럼 placeholder라면, 반드시 더 자연스럽고 고유한 이름을 새로 생성할 것.
- 결과는 랜덤 시드가 달라질 때마다 서로 다른 콘셉트가 나오게 할 것.
{f"- ✅ 이미지 앵커(필수 반영): {', '.join(vision_hints_ko)} 중 최소 2개를 작품명/한줄소개에 반드시 포함할 것." if vision_hints_ko else ""}
{f"- ✅ 추가 이미지 관찰 힌트(권장): 표정/무드/조명/의상 같은 요소도 가능한 범위에서 반영하라. (앵커가 부족하면 위 이미지 앵커 목록을 우선 사용)" if vision_hints_ko else ""}

[JSON 스키마]
{{
  "candidates": [
    {{
      "core_theme": "핵심 소재(1개)",
      "hook": "흥미코드(갈등/비밀/관계 긴장/목표/제약) 1문장",
      "title_pattern": "사용한 제목 패턴(선택, 1개)",
      "name": "작품명(제목형/문장형 가능, 8~35자 권장, 공백 가능, 따옴표/이모지/마침표 금지)",
      "description": "한줄소개(대사/지문/키워드목록/대화유도 문구 금지, 1~2문장, 120~320자, 줄바꿈 금지)",
      "used_anchors": ["이미지 앵커 1", "이미지 앵커 2"]
    }}
  ],
  "selected_index": 0
}}
""".strip()

        prompt = f"{system}\n\n{user}"

        # ✅ 운영 안정(방어): LLM 호출 실패가 전체 기능(온보딩/프로필 자동생성)을 막으면 안 된다.
        # - 실패 시에도 로컬 폴백(fallback_name/description)을 사용해 "빈 값"이 들어가는 UX를 방지한다.
        raw = ""
        try:
            # ✅ 안정성: JSON 파싱 실패율을 낮추기 위해 온도를 낮춘다.
            raw = await get_ai_completion(prompt=prompt, model=model, temperature=0.2, max_tokens=700)
        except Exception as e:
            try:
                logger.exception(f"[quick_character] get_ai_completion failed (profile stage): {e} (model={model})")
            except Exception:
                pass
            raw = ""

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

    # ✅ 후보(candidates) 점수화 → 1개 선택(서버 주도):
    # - LLM이 candidates를 주면 서버가 안정적으로 "시장성/이미지 적합/모드 적합/형식"을 점수화해 1개를 선택한다.
    # - candidates가 없거나 비정상이면 기존 단일(name/description) 응답 로직으로 자연스럽게 폴백한다.
    selected_profile: Optional[Dict[str, Any]] = None
    try:
        candidates_raw = data.get("candidates")
        if isinstance(candidates_raw, list) and candidates_raw:
            best, scored_rows = _pick_best_profile_candidate(
                mode_hint=mode_hint,
                audience_label=_resolve_audience_label_from_tags(tags_user),
                candidates=candidates_raw,  # type: ignore[arg-type]
                anchors=vision_hints_ko,
                market_keys=market_keys,
            )
            if best and isinstance(best, dict):
                selected_profile = best
                try:
                    chosen_idx = None
                    try:
                        chosen_idx = int(candidates_raw.index(best))
                    except Exception:
                        chosen_idx = None
                    logger.info(
                        f"[quick_character] profile_candidates_scored mode={mode_hint} chosen_idx={chosen_idx} scored={scored_rows}"
                    )
                except Exception:
                    pass
    except Exception as e:
        try:
            logger.warning(f"[quick_character] candidates pick failed, fallback to single profile: {e}")
        except Exception:
            pass

    # ✅ 이름 자동 생성 지원:
    # - LLM이 name을 주면 그걸 우선 사용하되,
    # - 파싱 실패/빈 응답/placeholder면 로컬 랜덤 폴백을 사용해서 "자동 생성" UX를 보장한다.
    name_from_ai = _clip((selected_profile or {}).get("name") if selected_profile else data.get("name"), 100)
    name_candidate = _safe_text(name_from_ai).strip()
    if _has_profile_meta_wording(name_candidate):
        name_candidate = ""
    if _is_placeholder_name(name_candidate):
        name_candidate = fallback_name
    if _has_profile_meta_wording(name_candidate):
        name_candidate = ""
    if _is_placeholder_name(name_candidate) or _has_profile_meta_wording(name_candidate):
        if (not _is_placeholder_name(name_input)) and (not _has_profile_meta_wording(name_input)):
            name_candidate = name_input
    if _is_placeholder_name(name_candidate) or _has_profile_meta_wording(name_candidate):
        name_candidate = fallback_name
    name = name_candidate

    # ✅ 한줄소개: 짧고(대사/키워드/대화유도 문구 금지), 줄바꿈 제거
    # - 프로필 단계에서 소재/훅을 더 담을 수 있도록(120~320자) 상한을 확장한다.
    description_src = (selected_profile or {}).get("description") if selected_profile else data.get("description")
    description = _clip(description_src, 320).replace("\n", " ").strip()
    # 운영 방어: 메타/운영 문구가 섞이면 비운 뒤 아래 폴백 로직을 탄다.
    if _has_profile_meta_wording(description):
        description = ""

    # ✅ 이미지 앵커 반영(최종 방어):
    # - 비전이 성공했는데도 name/description이 이미지와 동떨어지면 UX가 망가진다.
    # - 최소한 앵커 키워드(예: 교실/창가/교복/벚꽃/소녀 등) 중 일부가 들어가도록 보정한다.
    try:
        if vision_hints_ko:
            must = vision_hints_ko[:4]
            if (not _mentions_any(name, must)) and (not _mentions_any(description, must)):
                # 완전 불일치 → 폴백 타이틀/한줄소개로 교정(과도한 재시도 없이 안정성 확보)
                base = must[0]
                extra = must[1] if len(must) > 1 else ""
                name = _clip(f"{base} {extra}의 하루".strip(), 35) or name
                description = _clip(f"{base} {extra}의 분위기를 담아 조용히 시작되는 이야기.".strip(), 220) or description
    except Exception:
        pass
    personality = _clip(data.get("personality"), 2000)
    speech_style = _clip(data.get("speech_style"), 2000)
    # ✅ 요구사항: 크리에이터 코멘트는 1000자 제한(선택)
    user_display = _clip(data.get("user_display_description"), 1000)
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
            if seed_text and (not _is_generated_seed_text(seed_text)) and (not _has_profile_meta_wording(seed_text)):
                description = _clip(seed_text, 300).strip() or fallback_description
            else:
                description = fallback_description
    # 최종 방어: 메타/운영성 문구가 남아있으면 폴백으로 교정
    if _has_profile_meta_wording(description):
        description = _clip(fallback_description, 320).replace("\n", " ").strip()
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
            # ✅ 프론트(온보딩 모달)용: 이미지 분석 결과를 칩 하이라이트에 재사용한다.
            # - 스키마 변경 없이, 기존 필드 `image_descriptions[].keywords`에 "이미지 앵커(한국어)"만 실어 내려보낸다.
            # - 실패/빈 값이어도 동작해야 하므로 항상 리스트로 유지한다.
            vision_keywords_for_client: List[str] = []
            try:
                # ✅ 정책: 칩 하이라이트는 "캐릭터챗 스타일 해석" 기반으로 해야 한다.
                # - anchors(사실 기반) + vibe(전개 톤) + (SSOT 소재칩 매칭)까지만 넣는다.
                # - 훅 문장(rp/sim hooks)은 칩에 과도하므로 keywords에는 넣지 않는다.
                anchors_list = [str(x or "").strip() for x in (vision_hints_ko or []) if str(x or "").strip()]
                vibe_list = [str(x or "").strip() for x in (vision_vibe_ko or []) if str(x or "").strip()]
                merged_for_match = [*anchors_list, *vibe_list]

                for k in anchors_list:
                    if k and k not in vision_keywords_for_client:
                        vision_keywords_for_client.append(k)
                for k in vibe_list[:10]:
                    if k and k not in vision_keywords_for_client:
                        vision_keywords_for_client.append(k)

                # SSOT 소재칩 매칭(프론트는 className 매칭만 하면 됨)
                try:
                    rp_m = _vision_hints_to_theme_matches(hints_ko=merged_for_match, theme_chips=list(ROLEPLAY_PROFILE_THEME_CHIPS))
                    sim_m = _vision_hints_to_theme_matches(hints_ko=merged_for_match, theme_chips=list(SIMULATOR_PROFILE_THEME_CHIPS))
                    for t in (rp_m or []) + (sim_m or []):
                        s = str(t or "").strip()
                        if s and s not in vision_keywords_for_client:
                            vision_keywords_for_client.append(s)
                except Exception:
                    pass

                # 과다 방지(스키마 keywords 상한=20)
                vision_keywords_for_client = vision_keywords_for_client[:20]
            except Exception:
                vision_keywords_for_client = []

            media_settings = CharacterMediaSettings(
                avatar_url=image_url,
                image_descriptions=[ImageDescription(url=image_url, description="", keywords=vision_keywords_for_client)],
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
 
        '''
