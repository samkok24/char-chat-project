"""
AI 모델과의 상호작용을 담당하는 서비스
- 현재는 Gemini, Claude, OpenAI 모델을 지원 (향후 확장 가능)
- 각 모델의 응답을 일관된 형식으로 반환하는 것을 목표로 함
"""
import google.generativeai as genai
import anthropic  # Claude API 라이브러리
from typing import Literal, Optional, AsyncGenerator
from app.core.config import settings
from .vision_service import stage1_keywords_from_image_url, stage1_keywords_from_image_url as _stage1, _http_get_bytes
import mimetypes
import logging
import imghdr
from io import BytesIO
from PIL import Image
import base64
import asyncio
import time

logger = logging.getLogger(__name__)

# ✅ Vision 결과 캐시(성능/안정):
# - 같은 image_url로 짧은 시간에 여러 번(예: 프로필 2단계 자동생성) 호출되면,
#   매번 이미지 다운로드 + Claude Vision 호출로 10~30초가 추가된다.
# - TTL 캐시로 "2번째 호출부터" 즉시 반환해 UX를 개선한다.
_VISION_TAGS_CACHE: dict[str, tuple[float, dict, dict]] = {}
_VISION_TAGS_CACHE_TTL_SEC = 600  # 10분
_VISION_TAGS_CACHE_MAX = 256

# Claude 모델명 상수 (전역 참조용)
# NOTE:
# - Claude는 4.0+만 사용 (3.x 지원 종료 대응)
# - Anthropic API의 model 값은 "별칭(예: claude-sonnet-4)"이 아니라 "스냅샷 모델명(날짜 포함)"이 안정적이다.
#   (별칭은 계정/권한/버전에 따라 404(not_found)로 실패하는 사례가 있어 스냅샷을 SSOT로 사용한다.)
CLAUDE_MODEL_PRIMARY = 'claude-sonnet-4-5-20250929'
CLAUDE_MODEL_LEGACY = 'claude-sonnet-4-20250514'  # 후방 호환/폴백(구버전 저장값 대응)

GPT_MODEL_PRIMARY = 'gpt-5'

# 안전 문자열 변환 유틸
def _as_text(val) -> str:
    try:
        if val is None:
            return ""
        if isinstance(val, (list, tuple, set)):
            return ", ".join([str(v) for v in val if str(v).strip()])
        return str(val)
    except Exception:
        return ""


def _format_history_block(history: object, *, max_items: int = 20, max_chars: int = 4000) -> str:
    """
    모델 입력 프롬프트에 포함할 "최근 대화" 블록을 생성한다.

    배경/의도:
    - 일부 호출(특히 원작챗)에서 history를 구성해 넘기지만, 과거 구현에서는 이를 프롬프트에 반영하지 않아
      모델이 직전 대화 내용을 망각하고 설정/고유명사를 즉흥적으로 재작성하는 문제가 있었다.
    - history 구조가 호출처마다 조금씩 다를 수 있으므로(dict/list/object) 방어적으로 파싱한다.

    형식(가독성 우선, KISS):
    - "사용자/캐릭터/시스템" 라벨을 붙여 텍스트 형태로 직렬화한다.
    - 과도한 토큰 사용을 막기 위해 max_items/max_chars로 제한한다.
    """
    try:
        if not history or not isinstance(history, list):
            return ""

        # 최신 N개만 고려 (호출자가 이미 잘라서 주더라도 이중 방어)
        items = history[-max_items:] if len(history) > max_items else history

        def _extract_role_and_text(item: object) -> tuple[str, str]:
            # dict 형태: {"role": "...", "parts": [text] } / {"role": "...", "content": "..."}
            if isinstance(item, dict):
                role = str(item.get("role") or "").strip().lower()
                parts = item.get("parts")
                if isinstance(parts, list) and parts:
                    txt = _as_text(parts[0]).strip()
                else:
                    txt = _as_text(item.get("content")).strip()
                return role, txt

            # 객체 형태: .role / .content
            role = ""
            txt = ""
            try:
                role = str(getattr(item, "role", "") or "").strip().lower()
            except Exception:
                role = ""
            try:
                txt = _as_text(getattr(item, "content", "")).strip()
            except Exception:
                txt = ""
            # 마지막 폴백: 문자열
            if not txt and isinstance(item, str):
                txt = item.strip()
            return role, txt

        lines: list[str] = []
        for it in items:
            role, txt = _extract_role_and_text(it)
            if not txt:
                continue
            # 지나치게 긴 개별 메시지는 잘라서 포함(토큰 폭주 방지)
            if len(txt) > 3000:
                txt = txt[:3000]

            if role in ("user", "human"):
                label = "사용자"
            elif role in ("system",):
                label = "시스템"
            else:
                # model/assistant/character 등은 모두 '캐릭터'로 통일(원작챗/일반챗 공통)
                label = "캐릭터"

            lines.append(f"{label}: {txt}")

        if not lines:
            return ""

        # max_chars 방어: 뒤(최신)부터 채워서 잘라낸다.
        picked: list[str] = []
        total = 0
        for ln in reversed(lines):
            add = len(ln) + (1 if picked else 0)
            if total + add > max_chars:
                break
            picked.append(ln)
            total += add
        picked.reverse()

        if not picked:
            return ""
        return "\n\n[최근 대화]\n" + "\n".join(picked) + "\n"
    except Exception:
        return ""

 # --- Gemini AI 설정 ---
genai.configure(api_key=settings.GEMINI_API_KEY)
claude_client = anthropic.AsyncAnthropic(api_key=settings.CLAUDE_API_KEY)
# --- OCR 제거: 기존 PaddleOCR 경량 사용 구간을 완전 비활성화 ---
def _extract_numeric_phrases_ocr_bytes(img_bytes: bytes) -> list[str]:
    # PaddleOCR 제거로 더 이상 실행하지 않음
    return []

def _parse_user_intent(user_hint: str) -> dict:
    """자연어 입력에서 간단한 의도/톤/시점/속도 등을 휴리스틱으로 추출(추가 호출 없이).
    반환: { intent, stance, tone, pace, continue, remix, constraints, transform_tags }
    """
    hint = (user_hint or "").strip().lower()
    # 기본값
    intent = None
    stance = None
    tone = None
    pace = None
    want_continue = False
    want_remix = False
    constraints: list[str] = []
    tags: list[str] = []

    # 한국어 키워드(소문자 변환 전제 → 한글엔 영향 없음)
    def _has(*keys: str) -> bool:
        return any(k in user_hint for k in keys)

    # intent
    if _has("연애", "사랑", "데이트", "썸"):
        intent = "romance"
        tone = tone or "설렘/서정"
    if _has("복수", "응징", "통수"):
        intent = intent or "revenge"
    if _has("스릴러", "공포", "호러", "미스터리", "추리", "느와르"):
        intent = intent or "thriller"

    # stance
    if _has("1인칭", "일인칭", "나로"):
        stance = "first"
    if _has("3인칭", "삼인칭", "그녀", "그로"):
        stance = stance or "third"

    # tone
    if _has("잔잔", "따뜻", "힐링"):
        tone = tone or "잔잔/따뜻"
    if _has("후킹", "몰입", "자극"):
        tone = tone or "후킹/강렬"

    # pace
    if _has("빠르게", "속도감", "템포 빠"):
        pace = "fast"
    if _has("천천히", "느리게"):
        pace = pace or "slow"

    # control flags
    if _has("이어줘", "이어 써", "계속 써"):
        want_continue = True
    if _has("바꿔줘", "다르게", "느낌으로 바꿔"):
        want_remix = True

    # transform tags(UI 태그와 접점)
    if _has("로맨스"):
        tags.append("로맨스")
    if _has("잔잔"):
        tags.append("잔잔하게")
    if _has("위트", "밈"):
        tags.append("밈스럽게")
    if stance == "first":
        tags.append("1인칭시점")
    if stance == "third":
        tags.append("3인칭시점")

    # constraints
    if _has("회사", "직장", "상사"):
        constraints.append("실명/회사명/직함 금지")

    return {
        "intent": intent,
        "stance": stance,
        "tone": tone,
        "pace": pace,
        "continue": want_continue,
        "remix": want_remix,
        "constraints": constraints,
        "transform_tags": tags,
    }

# (프리워밍 롤백) 업로드 프리워밍 유틸 제거


# OpenAI 설정
from openai import AsyncOpenAI
import openai
client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)


# -------------------------------
# Vision-grounded helpers (Gemini)
# -------------------------------
# Gemini 안전 설정(차단 완화)
DEFAULT_SAFETY_OPEN = [
    {"category": "HARM_CATEGORY_DANGEROUS_CONTENT", "threshold": "BLOCK_NONE"},
    {"category": "HARM_CATEGORY_HARASSMENT", "threshold": "BLOCK_NONE"},
    {"category": "HARM_CATEGORY_HATE_SPEECH", "threshold": "BLOCK_NONE"},
    {"category": "HARM_CATEGORY_SEXUAL_CONTENT", "threshold": "BLOCK_NONE"},
    {"category": "HARM_CATEGORY_VIOLENCE", "threshold": "BLOCK_NONE"},
]

async def tag_image_keywords(image_url: str, model: str = 'claude') -> dict:
    """
    강화된 이미지 태깅: Claude Vision 우선 사용으로 더 정확한 분석
    """
    try:
        import requests
        import base64
        import json
        
        # 이미지 다운로드 및 base64 인코딩 + MIME 탐지
        response = requests.get(image_url, timeout=10)
        img_bytes = response.content

        # --- pHash 캐시 조회(경량 average hash) ---
        try:
            from app.core.database import redis_client as _redis
            def _avg_hash(bytes_data: bytes, hash_size: int = 8) -> str:
                img = Image.open(BytesIO(bytes_data)).convert('L').resize((hash_size, hash_size), Image.BILINEAR)
                pixels = list(img.getdata())
                avg = sum(pixels) / len(pixels)
                bits = ''.join('1' if p > avg else '0' for p in pixels)
                return hex(int(bits, 2))[2:].rjust((hash_size*hash_size)//4, '0')
            ahash = _avg_hash(img_bytes)
            cache_key = f"vision:ahash:{ahash}:tags"
            # URL 기반 키(쿼리 제거)
            cache_key_url = None
            try:
                p = urlparse(image_url)
                url_no_q = urlunparse((p.scheme, p.netloc, p.path, '', '', ''))
                cache_key_url = f"vision:url:{url_no_q}:tags"
                cached_url = await _redis.get(cache_key_url)
                if cached_url:
                    try:
                        txt = cached_url.decode('utf-8') if isinstance(cached_url, (bytes, bytearray)) else str(cached_url)
                        data = json.loads(txt)
                        if isinstance(data, dict):
                            logging.info("Vision tags cache hit")
                            return data
                    except Exception:
                        pass
            except Exception:
                pass
            cached = await _redis.get(cache_key)
            if cached:
                try:
                    txt = cached.decode('utf-8') if isinstance(cached, (bytes, bytearray)) else str(cached)
                    data = json.loads(txt)
                    if isinstance(data, dict):
                        logging.info("Vision tags cache hit")
                        return data
                except Exception:
                    pass
        except Exception:
            ahash = None
            cache_key_url = None
        image_data = base64.b64encode(img_bytes).decode('utf-8')
        # 우선순위: 응답 헤더 → 바이트 시그니처 → 기본값
        ct = (response.headers.get('Content-Type') or '').lower()
        if ct.startswith('image/'):
            image_mime = ct.split(';')[0].strip()
        else:
            kind = imghdr.what(None, h=img_bytes)
            mime_map = {
                'jpeg': 'image/jpeg', 'jpg': 'image/jpeg', 'png': 'image/png',
                'gif': 'image/gif', 'webp': 'image/webp', 'bmp': 'image/bmp'
            }
            image_mime = mime_map.get(kind, 'image/jpeg')
        
        prompt = (
            "이미지를 매우 자세히 분석해서 스토리텔링에 필요한 모든 정보를 추출하세요.\n"
            "JSON 형식으로만 응답:\n"
            "{\n"
            "  \"place\": \"구체적인 장소 (예: 붐비는 카페 테라스, 황량한 사막 도로)\",\n"
            "  \"objects\": [\"눈에 띄는 모든 사물들\"],\n"
            "  \"lighting\": \"조명 상태와 시간대\",\n"
            "  \"weather\": \"날씨나 계절감\",\n"
            "  \"mood\": \"전체적인 분위기\",\n"
            "  \"colors\": [\"주요 색상들\"],\n"
            "  \"textures\": [\"질감, 재질\"],\n"
            "  \"sounds_implied\": [\"암시되는 소리들\"],\n"
            "  \"smells_implied\": [\"암시되는 냄새들\"],\n"
            "  \"temperature\": \"체감 온도\",\n"
            "  \"movement\": \"움직임이나 동적 요소\",\n"
            "  \"focal_point\": \"시선이 집중되는 곳\",\n"
            "  \"story_hooks\": [\"스토리 전개 가능한 요소들\"],\n"
            "  \"in_image_text\": [\"이미지 안에 보이는 모든 텍스트를 원문 그대로(오탈자 포함)\"],\n"
            "  \"numeric_phrases\": [\"숫자+단위가 함께 있는 문구(예: '500키로', '500원')\"]\n"
            "}"
        )
        
        # Claude Vision 시도
        if model == 'claude':
            try:
                txt = await get_claude_completion(
                    prompt,
                    max_tokens=1800,
                    model=CLAUDE_MODEL_PRIMARY,
                    image_base64=image_data,
                    image_mime=image_mime
                )
                
                # JSON 추출
                if '```json' in txt:
                    txt = txt.split('```json')[1].split('```')[0].strip()
                elif '```' in txt:
                    txt = txt.split('```')[1].split('```')[0].strip()
                    
                data = json.loads(txt)
                if isinstance(data, dict):
                    logging.info("Claude Vision tagging successful")
                    # 캐시 저장
                    try:
                        if cache_key_url:
                            await _redis.setex(cache_key_url, 86400, json.dumps(data, ensure_ascii=False))
                        if ahash:
                            await _redis.setex(cache_key, 86400, json.dumps(data, ensure_ascii=False))
                    except Exception:
                        pass
                    return data
            except Exception as e:
                logging.error(f"Claude Vision tagging failed: {e}")
        
        # Gemini 폴백
        try:
            import google.generativeai as genai
            import os
            from PIL import Image
            from io import BytesIO
            
            genai.configure(api_key=os.getenv('GEMINI_API_KEY'))
            
            img = Image.open(BytesIO(response.content))
            mm_model = genai.GenerativeModel('gemini-2.5-pro')
            
            response = mm_model.generate_content([prompt, img])
            txt = response.text
            
            if '```json' in txt:
                txt = txt.split('```json')[1].split('```')[0].strip()
            elif '```' in txt:
                txt = txt.split('```')[1].split('```')[0].strip()
                
            data = json.loads(txt)
            if isinstance(data, dict):
                logging.info("Gemini Vision tagging successful")
                try:
                    if cache_key_url:
                        await _redis.setex(cache_key_url, 86400, json.dumps(data, ensure_ascii=False))
                    if ahash:
                        await _redis.setex(cache_key, 86400, json.dumps(data, ensure_ascii=False))
                except Exception:
                    pass
                return data
                
        except Exception as e:
            logging.error(f"Gemini Vision tagging failed: {e}")
            
    except Exception as e:
        logging.error(f"Enhanced image tagging failed: {e}")
        
    # 폴백: 기본 태깅
    return {"place": "", "objects": [], "lighting": "", "weather": "", "mood": ""}

async def extract_image_narrative_context(image_url: str, model: str = 'claude') -> dict:
    """
    인물/관계/분위기/연출 정보를 구조화해 추출.
    subjects: [{role?, age_range?, gender?, attire?, emotion?, pose?}]
    relations: [{a_idx, b_idx, relation, evidence}]
    camera: {angle, distance, lens_hint}
    palette: [keywords]
    genre_cues: [keywords]
    narrative_axes: {desire, conflict, stakes}  # 암시적이면 짧게 제안
    tone: {mood_words, pace}
    """
    try:
        import requests
        import base64
        import json
        
        # 이미지 다운로드 및 base64 인코딩 + MIME 탐지
        response = requests.get(image_url, timeout=10)
        img_bytes = response.content

        # --- pHash 캐시 조회(컨텍스트) ---
        try:
            from app.core.database import redis_client as _redis
            def _avg_hash(bytes_data: bytes, hash_size: int = 8) -> str:
                img = Image.open(BytesIO(bytes_data)).convert('L').resize((hash_size, hash_size), Image.BILINEAR)
                pixels = list(img.getdata())
                avg = sum(pixels) / len(pixels)
                bits = ''.join('1' if p > avg else '0' for p in pixels)
                return hex(int(bits, 2))[2:].rjust((hash_size*hash_size)//4, '0')
            ahash = _avg_hash(img_bytes)
            cache_key = f"vision:ahash:{ahash}:ctx"
            cached = await _redis.get(cache_key)
            if cached:
                try:
                    txt = cached.decode('utf-8') if isinstance(cached, (bytes, bytearray)) else str(cached)
                    data = json.loads(txt)
                    if isinstance(data, dict):
                        logging.info("Vision ctx cache hit")
                        return data
                except Exception:
                    pass
        except Exception:
            ahash = None
        image_data = base64.b64encode(img_bytes).decode('utf-8')
        ct = (response.headers.get('Content-Type') or '').lower()
        if ct.startswith('image/'):
            image_mime = ct.split(';')[0].strip()
        else:
            kind = imghdr.what(None, h=img_bytes)
            mime_map = {
                'jpeg': 'image/jpeg', 'jpg': 'image/jpeg', 'png': 'image/png',
                'gif': 'image/gif', 'webp': 'image/webp', 'bmp': 'image/bmp'
            }
            image_mime = mime_map.get(kind, 'image/jpeg')
        
        schema_prompt = (
            "이미지를 분석해 아래 스키마의 JSON으로만 응답하세요.\n"
            "- 상상/추측 금지, 보이는 단서 위주. 암시는 narrative_axes에서 'hint'로 간단히.\n"
            "- is_selfie: 셀카인지 판단 (거울 셀카, 팔 뻗어 찍기, 셀카봉 등 모두 포함)\n"
            "- person_count: 보이는 인물 수 (0=인물없음)\n"
            "- style_mode: 장면의 스타일을 'snap' 또는 'genre' 중 하나로 제안.\n"
            "- confidence: 0~1 실수로 판단 신뢰도. 0.5는 중립.\n"
            "- cues: 판단에 사용한 근거 키워드 배열(예: selfie, weapon, magic, everyday, cafe 등).\n"
            "스키마: {\n"
            "  subjects:[{role?:string, age_range?:string, gender?:string, attire?:string, emotion?:string, pose?:string}],\n"
            "  relations:[{a_idx:int, b_idx:int, relation:string, evidence:string}],\n"
            "  camera:{angle?:string, distance?:string, lens_hint?:string, is_selfie?:boolean},\n"
            "  palette:[string], genre_cues:[string],\n"
            "  narrative_axes:{desire?:string, conflict?:string, stakes?:string},\n"
            "  tone:{mood_words?:[string], pace?:string},\n"
            "  person_count:int,\n"
            "  style_mode?:string,\n"
            "  confidence?:number,\n"
            "  cues?:[string]\n"
            "}"
        )
        
        # Claude Vision 시도
        if model == 'claude':
            try:
                txt = await get_claude_completion(
                    schema_prompt,
                    max_tokens=1800,
                    model=CLAUDE_MODEL_PRIMARY,
                    image_base64=image_data,
                    image_mime=image_mime
                )
                
                # JSON 추출
                if '```json' in txt:
                    txt = txt.split('```json')[1].split('```')[0].strip()
                elif '```' in txt:
                    txt = txt.split('```')[1].split('```')[0].strip()
                    
                data = json.loads(txt)
                if isinstance(data, dict):
                    logging.info("Claude Vision narrative context successful")
                    try:
                        if ahash:
                            await _redis.setex(cache_key, 86400, json.dumps(data, ensure_ascii=False))
                    except Exception:
                        pass
                    return data
            except Exception as e:
                logging.error(f"Claude Vision narrative context failed: {e}")
        
        # Gemini 폴백
        try:
            txt = await get_gemini_completion(schema_prompt + f"\nimage_url: {image_url}", max_tokens=600, model='gemini-2.5-pro')
            data = json.loads(txt)
            if isinstance(data, dict):
                try:
                    if ahash:
                        await _redis.setex(cache_key, 86400, json.dumps(data, ensure_ascii=False))
                except Exception:
                    pass
                return data
        except Exception:
            pass
        return {}
    except Exception:
        return {}

async def analyze_image_tags_and_context(image_url: str, model: str = 'claude') -> tuple[dict, dict]:
    """단일 Vision 호출로 태그(tags)와 컨텍스트(context)를 동시에 추출합니다.
    실패 시 호출자가 폴백을 사용하도록 예외를 던집니다.
    """
    try:
        # 캐시 히트
        try:
            key = str(image_url or "").strip()
            if key:
                hit = _VISION_TAGS_CACHE.get(key)
                if hit:
                    ts, tags, ctx = hit
                    if (time.time() - float(ts)) <= _VISION_TAGS_CACHE_TTL_SEC:
                        return tags or {}, ctx or {}
        except Exception:
            pass

        logging.info("Vision combine: start (unified tags+context)")
        import requests, base64, json
        # 이미지 다운로드 및 MIME 추정
        resp = requests.get(image_url, timeout=10)
        # ✅ 방어: 4xx/5xx면 즉시 실패 처리(HTML/에러 바디를 이미지로 오인 방지)
        resp.raise_for_status()
        img_bytes = resp.content
        ct = (resp.headers.get('Content-Type') or '').lower()
        if ct.startswith('image/'):
            image_mime = ct.split(';')[0].strip()
        else:
            kind = imghdr.what(None, h=img_bytes)
            image_mime = {
                'jpeg': 'image/jpeg', 'jpg': 'image/jpeg', 'png': 'image/png',
                'gif': 'image/gif', 'webp': 'image/webp', 'bmp': 'image/bmp'
            }.get(kind, 'image/jpeg')
            # ✅ 방어: content-type도 이미지가 아니고, imghdr도 못 맞추면 이미지가 아닌 응답으로 간주
            if kind is None:
                raise ValueError(f"image_url is not an image (status={resp.status_code}, ct={ct}, url={image_url})")
        image_b64 = base64.b64encode(img_bytes).decode('utf-8')
        # 통합 스키마 프롬프트(건조/사실 전용)
        prompt = (
            "이미지를 사실적으로만 기술하라. 추측/비유/감탄 금지. 장르/무드 형용사 금지(fantasy/noir/surreal/mysterious/cinematic 등). 모르면 'unknown'.\n"
            "JSON 으로만 출력하라.\n"
            "{\n"
            "  \"tags\": {\n"
            "    \"place\": one_of['cafe','street','park','campus','indoor','home','office','store','beach','mountain','unknown'],\n"
            "    \"objects\": [noun-only strings],\n"
            "    \"lighting\": one_of['daylight','indoor','night','overcast','sunset','unknown'],\n"
            "    \"weather\": one_of['clear','cloudy','rain','snow','unknown'],\n"
            "    \"colors\": [basic color words],\n"
            "    \"textures\": [noun-only],\n"
            "    \"sounds_implied\": [noun-only],\n"
            "    \"smells_implied\": [noun-only],\n"
            "    \"temperature\": one_of['warm','cool','neutral','unknown'],\n"
            "    \"movement\": one_of['still','slight','visible','unknown'],\n"
            "    \"focal_point\": string,\n"
            "    \"story_hooks\": [noun phrases],\n"
            "    \"in_image_text\": [exact text], \"numeric_phrases\": [string]\n"
            "  },\n"
            "  \"context\": {\n"
            "    \"person_count\": number,\n"
            "    \"camera\": {angle:one_of['eye','overhead','low','unknown'], distance:one_of['wide','medium','close','unknown'], is_selfie:boolean},\n"
            "    \"style_mode\": one_of['snap','genre'], \"confidence\": number\n"
            "  }\n"
            "}"
        )
        # ✅ Claude 우선 호출 → 실패 시 Gemini로 폴백
        #
        # 배경:
        # - 운영/로컬 환경에 따라 Claude 키/권한 문제가 있으면 Vision이 항상 실패하며,
        #   이 경우 캐릭터 자동생성이 이미지와 무관한 "폴백"으로 떨어진다.
        # - 이미지는 서비스 핵심이므로, Gemini Vision으로 2차 폴백을 제공해 가용성을 확보한다.
        data = None
        provider = "unknown"
        try:
            txt = await get_claude_completion(
                prompt,
                temperature=0.1,
                max_tokens=1000,
                model=CLAUDE_MODEL_PRIMARY,
                image_base64=image_b64,
                image_mime=image_mime
            )
            if '```json' in txt:
                txt = txt.split('```json')[1].split('```')[0].strip()
            elif '```' in txt:
                txt = txt.split('```')[1].split('```')[0].strip()
            parsed = json.loads(txt)
            if isinstance(parsed, dict):
                data = parsed
                provider = "claude"
        except Exception as e:
            try:
                logging.warning(f"Vision combine: Claude failed -> fallback to Gemini ({e})")
            except Exception:
                pass

        if data is None:
            try:
                from PIL import Image
                from io import BytesIO
                import google.generativeai as genai

                img = Image.open(BytesIO(img_bytes))
                # 모델 힌트가 들어와도 안전하게 기본값 사용
                gm = genai.GenerativeModel('gemini-2.5-pro')
                generation_config = genai.types.GenerationConfig(
                    temperature=0.1,
                    max_output_tokens=900,
                )
                resp2 = await gm.generate_content_async([prompt, img], generation_config=generation_config)
                txt2 = ""
                try:
                    txt2 = resp2.text or ""
                except Exception:
                    txt2 = ""
                if '```json' in txt2:
                    txt2 = txt2.split('```json')[1].split('```')[0].strip()
                elif '```' in txt2:
                    txt2 = txt2.split('```')[1].split('```')[0].strip()
                parsed2 = json.loads(txt2) if txt2 else {}
                if isinstance(parsed2, dict):
                    data = parsed2
                    provider = "gemini"
            except Exception as e:
                try:
                    logging.error(f"Vision combine: Gemini fallback failed: {e}")
                except Exception:
                    pass
                data = None

        if not isinstance(data, dict):
            raise ValueError("combined response is not dict")

        try:
            logging.info(f"Vision combine: success (provider={provider})")
        except Exception:
            pass

        tags_out = (data.get('tags') or {}) if isinstance(data.get('tags') or {}, dict) else {}
        ctx_out = (data.get('context') or {}) if isinstance(data.get('context') or {}, dict) else {}
        # 캐시 저장(간단 LRU: 초과 시 임의 1개 제거)
        try:
            key = str(image_url or "").strip()
            if key:
                if len(_VISION_TAGS_CACHE) >= _VISION_TAGS_CACHE_MAX:
                    try:
                        _VISION_TAGS_CACHE.pop(next(iter(_VISION_TAGS_CACHE)))
                    except Exception:
                        _VISION_TAGS_CACHE.clear()
                _VISION_TAGS_CACHE[key] = (time.time(), tags_out, ctx_out)
        except Exception:
            pass
        return tags_out, ctx_out
    except Exception:
        # 호출자 폴백
        raise

def build_image_grounding_block(tags: dict, pov: str | None = None, style_prompt: str | None = None, ctx: dict | None = None, username: str | None = None, story_mode: str | None = None, user_hint: str = "") -> str:
    # 시점 자동 결정 로직
    if ctx and not pov:
        # SNAP 모드: 모든 사진은 유저 본인의 경험/순간 → 무조건 1인칭
        if story_mode == "snap":
            # 연애/로맨스 키워드 점수화 시스템 (정제 + 가중치 차등화)
            keyword_scores = {
                # 확실한 로맨스 의도 - 2점
                "연애": 2, "데이트": 2, "좋아해": 2, "사랑": 2, "고백": 2,
                "첫키스": 2, "키스": 2, "포옹": 2, "안아": 2, "스킨십": 2,
                "로맨틱": 2, "로맨스": 2,
                
                # 강한 로맨스/성적 표현 - 2점
                "야한": 2, "섹시": 2, "관능": 2, "유혹": 2, "밀당": 2, "썸": 2, "달달": 2,
                "침대": 2, "숨소리": 2, "체온": 2, "속삭": 2,
                
                # 서브컬쳐 로맨스 - 1점
                "와이프": 1, "허니": 1, "츤데레": 1, "얀데레": 1, "데레": 1,
                
                # 여성향 - 1점
                "남주": 1, "집착": 1, "소유욕": 1,
                
                # 남성향 - 1점
                "히로인": 1, "여주": 1, "공략": 1,
                
                # 약한 로맨스 암시 - 0.5점 (단독으로는 불충분)
                "설레": 0.5, "손잡": 0.5, "모에": 0.5,
                "은밀": 0.5,
            }
            
            # 복합 표현 (문맥 포함)
            compound_expressions = {
                # 동사형 복합 표현 - 2점
                "연애하고": 2, "연애하는": 2, "데이트하고": 2, "데이트하는": 2,
                "사랑하고": 2, "사랑하는": 2, "좋아하고": 2, "좋아하는": 2,
                
                # 관계 키워드 (확실한 로맨스) - 2점
                "여자친구": 2, "여친": 2, "남자친구": 2, "남친": 2,
                "애인": 2, "연인": 2,
                
                # 구어체 지칭 - 1.5점
                "얘랑": 1.5, "쟤랑": 1.5, "저 사람이랑": 1.5,
                "이 사람이랑": 1.5, "이 사람과": 1.5, "이 여자랑": 1.5, "이 남자랑": 1.5,
                "그녀와": 1.5, "그와": 1.5, "그녀랑": 1.5, "그랑": 1.5,
                
                # 동반 표현 - 2점 (이미지 문맥에서는 강한 로맨스 신호)
                "같이": 2, "함께": 2,
            }
            
            # 자기 체험 키워드 (이게 있으면 로맨스 점수 무시)
            self_keywords = [
                "내가 이렇게", "나도 이런", "이런 느낌", "이런 순간",
                "나였으면", "나라면", "내 입장", "나한테도", "내 모습"
            ]
            
            # 점수 계산
            hint_lower = user_hint.lower()
            romance_score = 0.0
            
            # 복합 표현 먼저 체크 (우선순위 높음)
            for expr, score in compound_expressions.items():
                if expr in hint_lower:
                    romance_score += score
            
            # 단일 키워드 체크
            for keyword, score in keyword_scores.items():
                if keyword in hint_lower:
                    romance_score += score
            
            has_self = any(kw in user_hint for kw in self_keywords)
            
            # 1.5점 이상이고, 자기 체험 키워드가 없으면 로맨스 모드
            if romance_score >= 1.5 and not has_self:
                pov = "1인칭 '나'(유저). 이미지 속 인물은 '그녀/그'로 지칭하고, 유저와의 로맨틱한 상호작용을 중심으로 서술."
            else:
                # 기본: 이미지 속 인물 = 나
                pov = "1인칭 '나'"
        else:
            # GENRE 모드: 로맨스 장르는 항상 1인칭
            person_count = ctx.get('person_count', 0)
            camera = ctx.get('camera', {})
            is_selfie = camera.get('is_selfie', False)
            
            is_romance = False
            if user_hint:
                hint_lower = user_hint.lower()
                romance_score = 0.0
                
                # 복합 표현 체크
                compound_expressions = {
                    "연애하고": 2, "연애하는": 2, "데이트하고": 2, "데이트하는": 2,
                    "사랑하고": 2, "사랑하는": 2, "좋아하고": 2, "좋아하는": 2,
                    "여자친구": 2, "여친": 2, "남자친구": 2, "남친": 2,
                    "애인": 2, "연인": 2,
                    "얘랑": 1.5, "쟤랑": 1.5, "저 사람이랑": 1.5,
                    "이 사람이랑": 1.5, "이 사람과": 1.5, "이 여자랑": 1.5, "이 남자랑": 1.5,
                    "그녀와": 1.5, "그와": 1.5, "그녀랑": 1.5, "그랑": 1.5,
                    "같이": 2, "함께": 2,
                }
                
                for expr, score in compound_expressions.items():
                    if expr in hint_lower:
                        romance_score += score
                
                # 단일 키워드 체크
                keyword_scores = {
                    "연애": 2, "데이트": 2, "좋아해": 2, "사랑": 2, "고백": 2,
                    "첫키스": 2, "키스": 2, "포옹": 2, "안아": 2, "스킨십": 2,
                    "로맨틱": 2, "로맨스": 2,
                    "야한": 2, "섹시": 2, "관능": 2, "유혹": 2, "밀당": 2, "썸": 2, "달달": 2,
                    "침대": 2, "숨소리": 2, "체온": 2, "속삭": 2,
                    "와이프": 1, "허니": 1, "츤데레": 1, "얀데레": 1, "데레": 1,
                    "남주": 1, "집착": 1, "소유욕": 1,
                    "히로인": 1, "여주": 1, "공략": 1,
                    "설레": 0.5, "손잡": 0.5, "모에": 0.5, "은밀": 0.5,
                }
                
                for keyword, score in keyword_scores.items():
                    if keyword in hint_lower:
                        romance_score += score
                
                # 자기 체험 키워드 체크
                self_keywords = [
                    "내가 이렇게", "나도 이런", "이런 느낌", "이런 순간",
                    "나였으면", "나라면", "내 입장", "나한테도", "내 모습"
                ]
                has_self = any(kw in user_hint for kw in self_keywords)
                
                # 1.5점 이상이고, 자기 체험 키워드가 없으면 로맨스
                is_romance = romance_score >= 1.5 and not has_self
            
            # ✅ 우선순위에 따라 시점 결정
            if is_romance:  # ✅ 로맨스가 최우선!
                pov = "1인칭 '나'(유저). 이미지 속 인물은 '그녀/그'로 지칭하고, 유저와의 로맨틱한 상호작용을 중심으로 서술."
            elif person_count == 0:
                pov = "1인칭 '나'"
            elif is_selfie:
                pov = "1인칭 '나'"
            else:
                pov = "3인칭 관찰자"
    
    place = _as_text(tags.get("place")).strip()
    objects = ", ".join([str(x) for x in (tags.get("objects") or []) if str(x).strip()])
    lighting = _as_text(tags.get("lighting")).strip()
    weather = _as_text(tags.get("weather")).strip()
    mood = _as_text(tags.get("mood")).strip()
    
    # 강화된 태그 정보
    colors = ", ".join([str(x) for x in (tags.get("colors") or []) if str(x).strip()])
    textures = ", ".join([str(x) for x in (tags.get("textures") or []) if str(x).strip()])
    sounds = ", ".join([str(x) for x in (tags.get("sounds_implied") or []) if str(x).strip()])
    smells = ", ".join([str(x) for x in (tags.get("smells_implied") or []) if str(x).strip()])
    temperature = _as_text(tags.get("temperature")).strip()
    movement = _as_text(tags.get("movement")).strip()
    focal_point = _as_text(tags.get("focal_point")).strip()
    story_hooks = tags.get("story_hooks") or []
    
    # 이미지 내 텍스트(최우선 사실)
    in_texts = [str(x) for x in (tags.get("in_image_text") or []) if str(x).strip()]
    numeric_phrases = [str(x) for x in (tags.get("numeric_phrases") or []) if str(x).strip()]
    
    # 🆕 "unknown" 필터링 헬퍼
    def _valid(val: str) -> bool:
        return val and val.lower() != "unknown"

    lines = [
        "[고정 조건 - 이미지 그라운딩]",
        ("[최우선 사실 - 이미지 내 텍스트] " + "; ".join(in_texts)) if in_texts else None,
        ("[수치/단위 문구] " + "; ".join(numeric_phrases)) if numeric_phrases else None,
        f"장소: {place}" if _valid(place) else None,
        f"오브젝트: {objects}" if objects else None,
        f"조명/시간대: {lighting}" if _valid(lighting) else None,
        f"날씨: {weather}" if _valid(weather) else None,
        f"무드: {mood}" if _valid(mood) else None,
        f"주요 색상: {colors}" if colors else None,
        f"질감/재질: {textures}" if textures else None,
        f"암시되는 소리: {sounds}" if sounds else None,
        f"암시되는 냄새: {smells}" if smells else None,
        f"체감 온도: {temperature}" if _valid(temperature) else None,
        f"움직임/동적 요소: {movement}" if _valid(movement) else None,
        f"시선 집중점: {focal_point}" if focal_point else None,
        "",
        "규칙: 이미지에 포함된 텍스트(위 최우선 사실)를 1순위로 반영하라. 숫자/단위를 절대 왜곡하지 말라.",
        "규칙: 위 모든 요소들을 자연스럽게 녹여내어 생생한 장면을 만들어라.",
        "규칙: 오감을 활용해 독자가 그 공간에 있는 듯한 몰입감을 제공하라.",
        "규칙: 이미지에 존재하지 않는 요소를 추가하지 말라.",
        "규칙: 메타발언 금지. show-don't-tell. 인물의 행동과 대사로 표현하라.",
    ]
    
    # 스토리 훅 추가
    if story_hooks:
        lines.append("")
        lines.append("스토리 전개 가능 요소:")
        for hook in story_hooks[:3]:  # 최대 3개만
            lines.append(f"- {hook}")
    # 추가 맥락(인물/관계/연출)
    if isinstance(ctx, dict) and ctx:
        subs = ctx.get("subjects") or []
        if subs:
            sub_strs = []
            for i, s in enumerate(subs):
                desc = ", ".join([
                    str(s.get("role")) if s.get("role") else "",
                    str(s.get("age_range")) if s.get("age_range") else "",
                    str(s.get("gender")) if s.get("gender") else "",
                    str(s.get("attire")) if s.get("attire") else "",
                    str(s.get("emotion")) if s.get("emotion") else "",
                    str(s.get("pose")) if s.get("pose") else "",
                ])
                sub_strs.append(f"#{i}: {desc}")
            lines.append("인물 단서: " + "; ".join([x for x in sub_strs if x.strip()]))
        rels = ctx.get("relations") or []
        if rels:
            rel_strs = []
            for r in rels:
                rel_strs.append(f"{r.get('a_idx')}↔{r.get('b_idx')}: {r.get('relation')} ({r.get('evidence')})")
            lines.append("관계 단서: " + "; ".join(rel_strs))
        cam = ctx.get("camera") or {}
        cam_line = ", ".join([x for x in [cam.get("angle"), cam.get("distance"), cam.get("lens_hint")] if x])
        if cam_line:
            lines.append("연출: " + cam_line)
        pal = ctx.get("palette") or []
        if pal:
            lines.append("색조: " + ", ".join([str(x) for x in pal]))
        genres = ctx.get("genre_cues") or []
        if genres:
            lines.append("장르 단서: " + ", ".join([str(x) for x in genres]))
        axes = ctx.get("narrative_axes") or {}
        axes_line = ", ".join([f"욕구:{axes.get('desire')}" if axes.get('desire') else "", f"갈등:{axes.get('conflict')}" if axes.get('conflict') else "", f"위험:{axes.get('stakes')}" if axes.get('stakes') else ""]).strip(', ')
        if axes_line:
            lines.append("서사 축(힌트): " + axes_line)
    if pov:
        # 1인칭 시점일 때 username 사용
        if "1인칭" in pov and username:
            lines.append(f"시점: 1인칭 '나' (화자의 이름: {username})")
            lines.append(f"규칙: 1인칭 화자 '나'의 이름이 {username}임을 자연스럽게 드러내라.")
        else:
            lines.append(f"시점: {pov} (자연스러운 내적/근접 시점)")
    if style_prompt:
        lines.append(f"문체: {style_prompt}")
    return "\n".join([ln for ln in lines if ln])

async def generate_image_prompt_from_story(story_text: str, original_tags: dict = None) -> str:
    """스토리 텍스트를 바탕으로 이미지 생성 프롬프트를 만듭니다."""
    try:
        prompt = f"""다음 스토리의 핵심 장면을 표현할 이미지 생성 프롬프트를 영어로 작성하세요.

스토리:
{story_text[:800]}

요구사항:
- 영어로 작성
- 구체적인 시각 묘사
- 50단어 이내
- 프롬프트만 출력 (설명 없음)"""

        if original_tags:
            if original_tags.get('palette'):
                prompt += f"\n색감 참고: {original_tags['palette']}"
            if original_tags.get('mood'):
                prompt += f"\n분위기: {original_tags['mood']}"

        response = await get_claude_completion(prompt, temperature=0.2)
        return response.strip()[:200]  # 최대 200자
    except Exception as e:
        logger.error(f"Failed to generate image prompt: {e}")
        return "A scene from a Korean webnovel, cinematic lighting, emotional atmosphere"

async def write_story_from_image_grounded(image_url: str, user_hint: str = "", pov: str | None = None, style_prompt: str | None = None,
                                          story_mode: str | None = None, username: str | None = None,
                                          model: Literal["gemini","claude","gpt"] = "gemini", sub_model: str | None = "gemini-2.5-pro",
                                          vision_tags: dict | None = None, vision_ctx: dict | None = None) -> str:
    """이미지 태깅→고정조건 프롬프트→집필(자가검증은 1패스 내장)"""
    import time
    t0 = time.time()
    
    # Stage-1 lightweight grounding (fallback-friendly)
    kw2, caption = stage1_keywords_from_image_url(image_url)
    t1 = time.time()
    logging.info(f"[PERF] Stage-1 grounding: {(t1-t0)*1000:.0f}ms")
    
    # Stage-2: Vision 결과 (전달받았으면 재사용, 없으면 호출)
    if vision_tags and vision_ctx:
        tags, ctx = vision_tags, vision_ctx
        t2 = time.time()
        logging.info(f"[PERF] Vision reused from auto detection: 0ms")
    else:
        try:
            tags, ctx = await analyze_image_tags_and_context(image_url, model='claude')
            t2 = time.time()
            logging.info(f"[PERF] Vision combined: {(t2-t1)*1000:.0f}ms")
        except Exception as e:
            logging.warning(f"[PERF] Vision combined failed, fallback: {e}")
            tags = await tag_image_keywords(image_url, model='claude')
            ctx = await extract_image_narrative_context(image_url, model='claude')
            t2 = time.time()
            logging.info(f"[PERF] Vision fallback (2 calls): {(t2-t1)*1000:.0f}ms")
    # 스냅 모드에서는 개인정보 보호를 위해 이름 주입 금지
    block = build_image_grounding_block(
        tags,
        pov=pov,
        style_prompt=style_prompt,
        ctx=ctx,
        username=None if story_mode == "snap" else username,
        story_mode=story_mode,
        user_hint=user_hint  # 로맨스 키워드 점수화를 위해 전달
    )
    if kw2:
        block += "\n스냅 키워드(경량 태깅): " + ", ".join(kw2)
    if caption:
        block += f"\n경량 캡션: {caption}"

    # 필수/금지 키워드 구성(강화 모드)
    required_tokens: list[str] = []
    for t in [tags.get('place'), tags.get('mood'), tags.get('lighting'), tags.get('weather')]:
        if t:
            required_tokens.append(str(t))
    # objects 최대 4개
    for o in (tags.get('objects') or [])[:4]:
        if o:
            required_tokens.append(str(o))
    # palette/genre에서 0~2개 추가
    for extra in (ctx.get('palette') or [])[:1]:
        required_tokens.append(str(extra))
    for extra in (ctx.get('genre_cues') or [])[:1]:
        required_tokens.append(str(extra))
    # 이미지 내 텍스트/수치 문구를 우선 포함 + OCR 보강
    numeric_phrases = list(tags.get('numeric_phrases') or [])[:2]
    in_texts_tag = list(tags.get('in_image_text') or [])[:2]
    # OCR로 숫자/단위만 보강(없는 경우에만)
    try:
        if not numeric_phrases:
            more = _extract_numeric_phrases_ocr_bytes(_http_get_bytes(image_url))
            numeric_phrases = more[:2] if more else []
    except Exception:
        pass
    for t in numeric_phrases:
        required_tokens.append(str(t))
    for t in in_texts_tag:
        required_tokens.append(str(t))
    # 최대 10개로 제한
    required_tokens = [x for x in required_tokens if x][:10]

    # 금지 키워드(일반 + 장소 충돌)
    ban_general = {"현관", "복도", "교실", "운동장", "해변", "바닷가", "사막", "정오의 햇살", "한낮의 태양"}
    ban_by_place = {
        "office": {"교실", "주방", "침실", "운동장", "해변", "들판"},
        "classroom": {"사무실", "주방", "해변"},
        "home": {"사무실", "교실", "해변"},
    }
    place_lc = (tags.get('place') or '').lower()
    place_key = None
    for k in ban_by_place.keys():
        if k in place_lc:
            place_key = k
            break
    ban_tokens = set(ban_general)
    if place_key:
        ban_tokens |= ban_by_place.get(place_key, set())

    # 고정 블록에 필수/금지 명시 추가
    if required_tokens:
        block += "\n필수 키워드(이미지 텍스트 우선): " + ", ".join(required_tokens)
    if ban_tokens:
        block += "\n금지 키워드: " + ", ".join(sorted(ban_tokens))
    # 시점에 따른 지시사항 조정
    pov_instruction = ""
    if story_mode == "snap":
        # 일상: 실명/닉네임 회피. 1인칭이면 '나', 3인칭이면 '그/그녀'만 사용
        if "1인칭" in block:
            pov_instruction = "\n시점: 1인칭 '나'. 사람 이름(고유명) 사용 금지. 대명사는 '나'만 사용."
        else:
            pov_instruction = "\n시점: 3인칭. 인물 지칭은 '그' 또는 '그녀'만 사용. 사람 이름(고유명) 사용 금지."
    else:
        if "1인칭" in block:
            pov_instruction = "\n시점: 1인칭 '나'로 서술. 내면 묘사와 감각을 생생하게."
            # username이 block에 포함되어 있으면 추가 지시
            if username and username in block:
                pov_instruction += f"\n화자 '나'의 이름은 {username}. 대화나 상황에서 자연스럽게 이름이 드러나게 하라."
        elif "3인칭" in block:
            pov_instruction = "\n시점: 3인칭 관찰자로 서술. 인물들의 행동과 표정을 객관적으로 묘사."
    
    # 스토리 모드별 시스템 지시사항
    if story_mode == "snap":
        sys_instruction = (
            "당신은 일상을 재치있게 기록하는 20~30대다. 평범한 순간에서 웃긴 포인트를 찾아.\n"
            "규칙: 200-300자, SNS 글, 일상 말투, 쉬운 단어만.\n"
            "중요: 너무 오글거리지 않게. 적당히 웃기게. 솔직하게. 위트있게.\n"
            "일반인들이 '어 나도 그랬는데 ㅋㅋ' 싶게. 있는 그대로 + 재치 살짝."
            + pov_instruction
        )
        # 인스타 공유 효능감 강화 지시
        sys_instruction += (
            "\n특기: 인스타 캡션처럼. 간단하게. 평범한 일상이지만 웃긴 포인트 살려."
            "\n스타일: 문장 짧게(10~18자). 쉼표 많이. 마침표로 끊어."
            "\n문단: 1~2문장. 줄 자주 바꿔."
            "\n어휘: 쉬운 말만. 한국인 특유의 위트/유머(의성어, 의태어, 과장 비유, 자기비하). 너무 웃기려고 하지는 마. #, 이모지, ㅋㅋ, ㅎㅎ 같은 채팅 표현 금지."
            "\n톤: 친구한테 '야 이거 봐봐 ㅋㅋ' 하듯. 재치있게. 한국식 센스."
            "\n개인정보: 이름 쓰지 마. '걔', '그 사람', '나' 정도만."
            "\n역할: 당신은 일상을 관찰력 있게 보는 20대 SNS 유저다. 어려운 말 쓰지 마."
            " 첫 문장은 '어 이거 뭐야 ㅋㅋ' 싶게. 상황의 웃긴 점이나 아이러니를 포착."
            " 감정은 과하지 않게. '웃기다', '황당하다', '귀엽다' 같은 솔직한 반응."
            "\n금지: 제목, #, *, ㅋㅋ, ㅎㅎ, 이모지, 설명 금지. 첫 문장부터 바로 장면 시작. 억지 개그 금지."
        )
    elif story_mode == "genre":
        sys_instruction = (
            "당신은 한국의 20년차 수많은 히트작을 쓴 웹소설 작가다. 이미지를 장르적 상상력으로 재해석한다.\n"
            "규칙: 600-900자 분량, 도입부부터 써야한다. 확실히 궁금해지는 몰입감 있는 전개, 긴장감 있는 묘사, 장르 관습 준수.\n"
            "중요: 첫 문장부터 독자를 사로잡고, 다음이 궁금해지는 여운을 남겨라.\n"
            "독자가 그 세계에 빠져들 수 있는 생생한 장면을 만들어라."
            "언어: 한국 웹소설 용어를 사용하라. 영어 표현(unknown, level, status 등)은 절대 금지. 한국식 번역(금지구역, 봉인구역, 등급, 상태창 등)만 사용."
            + pov_instruction
        )
        # 하이라이트 후킹 강화 지시
        sys_instruction += (
            "\n특기: 첫 문장은 웃긴 상황이나 의외의 장면. 두 번째 문장은 반응이나 생각."
            "\n스타일: 친구한테 카톡하듯. 문장 짧게(10~15자). 쉬운 말만. 재치있게."
            "\n대사: 많이 넣어. 대사에 위트 담아. 대사마다 줄바꿈."
            "\n문단: 1~2문장씩 끊어. 한 문장도 OK. 비유 쓰지 마. 있는 그대로 + 관찰의 재미."
            "\n개행: 2문장마다 무조건 엔터. 읽기 편하게."
            "\n유머: 한국인 특유의 센스. 자기비하, 과장된 비유(예: '냉장고 코스프레', '로딩 걸린 사람'), 의성어/의태어, '~인 척', '~당하는 기분' 같은 표현. 영어권 유머 스타일 금지."
            "\n금지: 제목, #, *, ㅋㅋ, ㅎㅎ, 이모지, 설명 금지. 바로 장면 시작."
        )
    else:
        sys_instruction = (
            "당신은 20년차 장르/웹소설 작가다. 이미지와 정확히 맞닿은 장면을 쓴다.\n"
            "규칙: 메타발언 금지, show-don't-tell, 자연스러운 대사 포함, 시점/문체 일관.\n"
            "중요: 이미지에서 추출된 모든 감각적 정보(색상, 질감, 소리, 냄새, 온도)를 활용해 생생한 장면을 만들어라.\n"
            "독자가 그 공간에 직접 있는 듯한 몰입감을 제공하라."
            + pov_instruction
        )
    
    # 사용자 의도(자연어) 해석을 경량 반영
    try:
        intent_info = _parse_user_intent(user_hint)
    except Exception:
        intent_info = {}

    # 스타일 힌트 추가
    if style_prompt:
        sys_instruction += f"\n스타일: {style_prompt}"
    
    # 사용자 힌트가 비어있을 때 기본 프롬프트
    if not user_hint.strip():
        user_hint = (
            "이미지에 담긴 순간을 생생하게 포착하여 이야기를 시작하세요. "
            "인물의 감정, 행동, 대사를 통해 상황을 자연스럽게 전개하세요."
        )
    
    # 사용자 힌트에서 감정/분위기 태그 추출
    emotion_instruction = ""
    if "[감정/분위기:" in user_hint:
        # 감정 힌트가 있으면 추가 지시사항 생성
        emotion_instruction = "\n- 지정된 감정과 분위기를 스토리 전반에 녹여내라"
    
    # 스토리 모드별 글자 수 설정(+의도 보정)
    if story_mode == "snap":
        length_guide = "200~300자"
        # 이어쓰기 의도 시 길이 고정 가이드
        if intent_info.get("continue"):
            length_guide = "200~300자"
        if intent_info.get("transform_tags") and "글더길게" in intent_info.get("transform_tags", []):
            length_guide = "260~360자"
        if intent_info.get("transform_tags") and "글더짧게" in intent_info.get("transform_tags", []):
            length_guide = "150~220자"
        extra_instructions = (
            "\n[추가 지시]\n"
            "- 누구나 겪는 평범한 순간에서 웃긴 포인트 찾기. 상황의 아이러니나 귀여운 디테일.\n"
            "- 일반인 입장에서 '나도 저래 ㅋㅋ' 싶게. 공감 + 재미.\n"
            "- 한국인 유머 센스: 의성어/의태어 활용(웅웅, 쏙쏙), 과장 비유(~코스프레, ~당하는 나), 자기비하. 영어권 표현(갱스터, 바이브 등) 금지.\n"
            "- 줄 자주 바꿔. 한눈에 읽히게.\n"
            "- 솔직하게 + 위트.\n"
            "- 끝은 한 번 더 웃기거나, 담백하게. 억지로 여운 만들지 마."
        )
    elif story_mode == "genre":
        length_guide = "650~750자"
        if intent_info.get("continue"):
            length_guide = "280~320자"
        if intent_info.get("transform_tags") and "글더길게" in intent_info.get("transform_tags", []):
            length_guide = "720~850자"
        if intent_info.get("transform_tags") and "글더짧게" in intent_info.get("transform_tags", []):
            length_guide = "400~500자"
        extra_instructions = (
            "\n[추가 지시]\n"
            "- 첫 문장부터 훅을 걸되, 사건은 예열~중반까지만 진행\n"
            "- 기승전결을 한 번에 끝내지 말 것(도파민 리듬 유지)\n"
            "- 700자 내에서는 인물/공간/첫 갈등을 심고, 클라이맥스는 금지\n"
            "- 이어쓰기(300자)마다 작은 훅/반전/미끼를 하나씩 추가"
        )
    else:
        length_guide = "400~600자"
        extra_instructions = (
            "\n[추가 지시]\n"
            "- 첫 문장부터 독자의 시선을 사로잡아라\n"
            "- 오감을 모두 활용하여 공간감을 살려라\n"
            "- 인물이 있다면 그들의 미묘한 감정과 관계를 드러내라\n"
            "- 다음 장면이 궁금해지도록 여운을 남겨라"
        )
    
    # 시점/톤/속도/제약 보강(의도)
    intent_lines = []
    if intent_info.get("stance") == "first":
        intent_lines.append("시점: 1인칭 '나'로 서술")
    if intent_info.get("stance") == "third":
        intent_lines.append("시점: 3인칭 관찰자로 서술. 인물 지칭은 '그/그녀'만 사용")
    if intent_info.get("tone"):
        intent_lines.append(f"톤: {intent_info.get('tone')}")
    if intent_info.get("pace") == "fast":
        intent_lines.append("템포: 빠르게, 군더더기 제거")
    if intent_info.get("constraints"):
        for c in intent_info.get("constraints", []):
            intent_lines.append(f"제약: {c}")
    if intent_info.get("transform_tags"):
        intent_lines.append("태그: " + ", ".join(intent_info.get("transform_tags", [])[:6]))
    if intent_info.get("continue"):
        intent_lines.append("정책: 이어쓰기 — 직전 톤/시점/리듬 유지, 새 사건 1개")
    if intent_info.get("remix"):
        intent_lines.append("정책: 리믹스 — transform_tags를 강하게 적용, 사실/숫자/이미지 텍스트는 유지")

    intent_block = ("\n[의도 반영]\n" + "\n".join(intent_lines)) if intent_lines else ""

    grounding_text = (
        f"[지시]\n아래 고정 조건을 반드시 반영하여 첫 장면({length_guide})을 한국어로 작성하라.\n\n"
        f"{block}{intent_block}\n\n"
        f"[사용자 힌트]\n{user_hint.strip()}\n"
        + extra_instructions
        + emotion_instruction
    )
    # 생성 및 검증(최대 2회 보정)
    def violates_ban(s: str) -> bool:
        low = (s or '').lower()
        for b in ban_tokens:
            if str(b).lower() in low:
                return True
        return False

    async def _claude_mm(url: str) -> str:
        try:
            # 이미지를 직접 다운로드하여 base64로 인코딩
            img_bytes = _http_get_bytes(url)
            # MIME 타입 추정: URL 확장자 → 실패 시 바이너리 시그니처로 보강
            mime, _ = mimetypes.guess_type(url)
            if not mime:
                try:
                    kind = imghdr.what(None, h=img_bytes)
                    mime_map = {
                        'jpeg': 'image/jpeg',
                        'jpg': 'image/jpeg',
                        'png': 'image/png',
                        'gif': 'image/gif',
                        'webp': 'image/webp',
                        'bmp': 'image/bmp'
                    }
                    mime = mime_map.get(kind, 'image/jpeg')
                except Exception:
                    mime = 'image/jpeg'
            img_b64 = base64.b64encode(img_bytes).decode('utf-8')
            
            # 명확한 스토리 생성 지시
            full_prompt = (
                "당신은 20년차 장르/웹소설 작가입니다.\n"
                "아래 이미지를 보고, 지시사항에 따라 몰입감 있는 이야기를 작성하세요.\n"
                "중요: 평가나 분석이 아닌, 실제 소설의 한 장면을 써야 합니다.\n\n"
                f"{grounding_text}"
            )
            
            # 디버그: sys_instruction 및 모델 확인
            logging.info(f"[DEBUG] story_mode={story_mode}, model={model}/{sub_model or 'default'}, sys_instruction_len={len(sys_instruction)}, sys_start={sys_instruction[:80]}")
            
            message = await claude_client.messages.create(
                model=CLAUDE_MODEL_PRIMARY,
                max_tokens=1800,
                temperature=0.7,
                system=sys_instruction,
                messages=[{
                    "role":"user",
                    "content":[
                        {"type":"image","source":{"type":"base64","media_type":mime,"data":img_b64}},
                        {"type":"text","text":full_prompt}
                    ]
                }]
            )
            
            result = ""
            if hasattr(message, 'content') and message.content:
                result = getattr(message.content[0], 'text', '') or ""
                logging.info(f"Claude MM ok: bytes={len(img_bytes)} mime={mime} result_len={len(result)}")
                
                # 결과가 평가/분석인지 체크
                if any(word in result[:100] for word in ["수정된 버전", "효과적으로 표현", "보완을 제안", "분석", "평가"]):
                    logging.warning("Claude returned analysis instead of story, retrying...")
                    retry_prompt = (
                        "이미지를 보고 즉시 이야기를 시작하세요.\n"
                        "첫 문장부터 소설이어야 합니다. 분석이나 평가는 절대 금지.\n"
                        "예시: '카페 창가에 기댄 그녀는...'\n\n"
                        f"{grounding_text}"
                    )
                    retry_msg = await claude_client.messages.create(
                        model=CLAUDE_MODEL_PRIMARY,
                        max_tokens=1800,
                        temperature=0.7,
                        system=sys_instruction,
                        messages=[{
                            "role":"user",
                            "content":[
                                {"type":"image","source":{"type":"base64","media_type":mime,"data":img_b64}},
                                {"type":"text","text":retry_prompt}
                            ]
                        }]
                    )
                    if hasattr(retry_msg, 'content') and retry_msg.content:
                        result = getattr(retry_msg.content[0], 'text', '') or ""
            
            return result
        except Exception as e:
            logging.warning(f"Claude MM fail: {e}")
        return ""

    # Claude Vision으로 스토리 생성
    text = await _claude_mm(image_url)
    
    if not text:
        # 최종 폴백(텍스트-only) - Claude 사용
        text = await get_ai_completion("[텍스트 폴백]\n" + grounding_text, model="claude", sub_model=CLAUDE_MODEL_PRIMARY, max_tokens=1800)        

    # 자가 검증 스킵 (Claude Vision은 이미 충분히 정확함)
    # 필요시 간단한 체크만
    if not text or len(text) < 100:
        # 텍스트가 너무 짧거나 없으면 재시도
        text = await get_ai_completion(
            f"{sys_instruction}\n\n{grounding_text}", 
            model="claude", 
            sub_model=CLAUDE_MODEL_PRIMARY, 
            max_tokens=1800
        )

    # 이미지 내 텍스트/수치 문구 커버리지 검증 및 1회 보정
    try:
        must_phrases: list[str] = []
        for p in numeric_phrases[:2]:
            if isinstance(p, str) and p.strip():
                must_phrases.append(p.strip())
        for p in in_texts_tag[:2]:
            if isinstance(p, str) and p.strip():
                must_phrases.append(p.strip())
        missing = [p for p in must_phrases if p and (p not in text)]
        if missing:
            fix_prompt = (
                "아래 초안에서 이미지 속 텍스트를 그대로 반영하여 고쳐 쓰세요.\n"
                "- 다음 문구(숫자/단위 포함)는 철자 그대로 포함: " + ", ".join(missing) + "\n"
                "- 의미를 바꾸지 말 것, 금지: 수정/해석/가격으로 오인.\n"
                "- 출력은 한국어 소설 문단만. 지시를 설명하지 말 것.\n\n"
                "[초안]\n" + text
            )
            text = await get_ai_completion(
                fix_prompt,
                model="claude",
                sub_model=CLAUDE_MODEL_PRIMARY,
                max_tokens=1800
            )
    except Exception:
        pass
    return text
async def get_gemini_completion(
    prompt: str,
    temperature: float = 0.7,
    max_tokens: int = 1024,
    model: str= 'gemini-2.5-pro'
) -> str:
    """
    주어진 프롬프트로 Google Gemini 모델을 호출하여 응답을 반환합니다.

    Args:
        prompt: AI 모델에게 전달할 프롬프트 문자열.
        temperature: 응답의 창의성 수준 (0.0 ~ 1.0).
        max_tokens: 최대 토큰 수.

    Returns:
        AI 모델이 생성한 텍스트 응답.
    """
    try:
        """
        ✅ Gemini 2.5 Pro 특이 케이스 방어 (중요)

        현상:
        - gemini-2.5-pro에서 max_output_tokens(=max_tokens)가 일정 값 이하(대략 1600 미만)일 경우,
          응답 candidate는 존재하지만(content.parts가 비어) response.text가 비어있는 형태로 돌아오는 케이스가 관측됨.
          이때 finish_reason은 MAX_TOKENS로 찍히며, 결과적으로 "Gemini가 안 된다"처럼 보이고 폴백(OpenAI/Claude)로 넘어간다.

        대응:
        - gemini-2.5-pro에 한해 max_output_tokens가 너무 낮으면 최소값으로 클램핑하여 빈 응답을 방지한다.
        - 출력 길이 제어는 프롬프트(응답 길이 지침)에서 우선하며, 토큰 상한은 안전한 범위로만 사용한다.
        """
        try:
            model_norm = (model or "").strip()
        except Exception:
            model_norm = "gemini-2.5-pro"
        # 경험적으로 1600 이상부터 텍스트 파트가 안정적으로 반환됨(환경/프롬프트에 따라 여유를 둔다).
        if "gemini-2.5-pro" in model_norm:
            try:
                mt = int(max_tokens or 0)
            except Exception:
                mt = 0
            if mt and mt < 1600:
                max_tokens = 1600

        # ✅ 실제 호출(시도) 로그: Gemini는 SDK가 내부적으로 HTTP를 수행하므로, 여기서는 모델/파라미터만 남긴다.
        # - 프롬프트/대사 내용은 절대 로그에 남기지 않는다.
        try:
            if getattr(settings, "DEBUG", False) or getattr(settings, "ENVIRONMENT", "") != "production":
                logger.info(f"[ai] http_call provider=gemini sdk=google-genai model={model_norm} max_tokens={max_tokens} temp={temperature}")
        except Exception:
            pass

        gemini_model = genai.GenerativeModel(model)

        generation_config = genai.types.GenerationConfig(
            temperature=temperature,
            max_output_tokens=max_tokens
            # response_mime_type="application/json" # Gemini 1.5 Pro의 JSON 모드
        )

        response = await gemini_model.generate_content_async(
            prompt,
            generation_config=generation_config,
        )

        # 안전한 텍스트 추출: 차단되었거나 text가 비어있을 수 있음
        try:
            if hasattr(response, 'text') and response.text:
                return response.text
        except Exception:
            # .text 접근시 예외가 발생할 수 있으니 아래로 폴백
            pass

        # 후보에서 텍스트 파츠를 수집
        try:
            candidates = getattr(response, 'candidates', []) or []
            for cand in candidates:
                content = getattr(cand, 'content', None)
                if not content:
                    continue
                parts = getattr(content, 'parts', []) or []
                text_parts = [getattr(p, 'text', '') for p in parts if getattr(p, 'text', '')]
                joined = "".join(text_parts).strip()
                if joined:
                    return joined
        except Exception:
            # 파싱 실패 시 아래 폴백
            pass

        # 안전 정책/기타 사유로 텍스트가 비어있을 때: 재시도 또는 폴백
        try:
            # ✅ 운영 디버깅용 최소 로그:
            # - Gemini가 candidates는 있으나 content.parts가 비어 "빈 응답"이 되었을 때,
            #   왜 GPT/Claude로 폴백되는지 현장에서 바로 원인을 추적할 수 있도록 핵심 지표만 남긴다.
            try:
                import logging
                logger = logging.getLogger(__name__)
                c0 = (getattr(response, "candidates", []) or [None])[0]
                fr = getattr(c0, "finish_reason", None)
                um = getattr(response, "usage_metadata", None)
                usage = None
                try:
                    if isinstance(um, dict):
                        usage = {
                            "prompt": um.get("prompt_token_count"),
                            "cand": um.get("candidates_token_count"),
                            "total": um.get("total_token_count"),
                        }
                    elif um is not None:
                        usage = {
                            "prompt": getattr(um, "prompt_token_count", None),
                            "cand": getattr(um, "candidates_token_count", None),
                            "total": getattr(um, "total_token_count", None),
                        }
                except Exception:
                    usage = None
                try:
                    prompt_len = len(prompt) if isinstance(prompt, str) else None
                except Exception:
                    prompt_len = None
                logger.warning(
                    f"[gemini] empty_text -> retry/fallback (model={model_norm}, max_output_tokens={max_tokens}, finish_reason={fr}, usage={usage}, prompt_len={prompt_len})"
                )
            except Exception:
                pass

            # ✅ MAX_TOKENS + 빈 응답(parts_len=0) 케이스 방어:
            # - 특히 gemini-2.5-pro에서 종종 관측됨.
            # - soft_prompt로 문구만 바꿔 재시도해도 토큰 상한이 동일하면 같은 현상이 반복될 수 있어,
            #   "토큰 상한을 올려" 1회 재시도 후에만 폴백으로 넘어간다.
            try:
                fr_str = ""
                try:
                    fr_str = str(fr or "")
                except Exception:
                    fr_str = ""
                is_max_tokens = False
                try:
                    if fr == 2:
                        is_max_tokens = True
                except Exception:
                    pass
                if (not is_max_tokens) and ("MAX_TOKENS" in fr_str):
                    is_max_tokens = True

                if is_max_tokens:
                    try:
                        mt = int(max_tokens or 0)
                    except Exception:
                        mt = 0
                    # 1회만 상향 재시도: 너무 작게 잡힌 상한으로 인해 "텍스트 파트가 0"인 케이스를 구제한다.
                    # 비용/지연을 감안해 상한은 4096~8192 범위로 제한한다.
                    if mt and mt < 4096:
                        retry_max_tokens = 4096
                    elif mt and mt < 8192:
                        retry_max_tokens = mt
                    else:
                        retry_max_tokens = None

                    if retry_max_tokens and retry_max_tokens != mt:
                        try:
                            logger.warning(
                                f"[gemini] retry_with_higher_max_output_tokens (model={model_norm}, from={mt}, to={retry_max_tokens})"
                            )
                        except Exception:
                            pass
                        try:
                            generation_config_retry = genai.types.GenerationConfig(
                                temperature=temperature,
                                max_output_tokens=retry_max_tokens,
                            )
                            response_retry = await gemini_model.generate_content_async(
                                prompt,
                                generation_config=generation_config_retry,
                            )
                            try:
                                if hasattr(response_retry, "text") and response_retry.text:
                                    return response_retry.text
                            except Exception:
                                pass
                            # 후보에서 텍스트 파츠를 수집
                            try:
                                candidates2 = getattr(response_retry, "candidates", []) or []
                                for cand2 in candidates2:
                                    content2 = getattr(cand2, "content", None)
                                    if not content2:
                                        continue
                                    parts2 = getattr(content2, "parts", []) or []
                                    text_parts2 = [getattr(p, "text", "") for p in parts2 if getattr(p, "text", "")]
                                    joined2 = "".join(text_parts2).strip()
                                    if joined2:
                                        return joined2
                            except Exception:
                                pass
                        except Exception:
                            # 재시도 실패는 아래 soft_prompt/폴백 로직으로 계속 진행
                            pass
            except Exception:
                pass

            # 빠른 재시도: 온건한 톤으로 완곡 재요청
            soft_prompt = (
                "아래 지시를 더 온건한 어휘로 부드럽게 수행해 주세요. 안전 정책을 침해하지 않는 범위에서 창작하세요.\n\n" + prompt
            )
            response2 = await gemini_model.generate_content_async(
                soft_prompt,
                generation_config=generation_config,
            )
            if hasattr(response2, 'text') and response2.text:
                return response2.text
        except Exception:
            pass
        # 최종 폴백: 다른 모델 시도(가능한 키가 있을 때)
        try:
            if settings.OPENAI_API_KEY:
                return await get_openai_completion(prompt, model='gpt-4o', max_tokens=1024)
        except Exception:
            pass
        try:
            if settings.CLAUDE_API_KEY:
                # Claude 폴백은 Claude 4 이상만 사용(3.x 지원 종료 대응)
                return await get_claude_completion(prompt, model=CLAUDE_MODEL_PRIMARY, max_tokens=1024)
        except Exception:
            pass
        return "안전 정책에 의해 이 요청의 응답이 제한되었습니다. 표현을 조금 바꿔 다시 시도해 주세요."
    except Exception as e:
        # 실제 운영 환경에서는 더 상세한 로깅 및 예외 처리가 필요
        import logging
        logger = logging.getLogger(__name__)
        logger.error(f"Gemini API 호출 중 오류 발생: {e}")
        logger.error(f"프롬프트 길이: {len(prompt)} 문자")
        print(f"Gemini API 호출 중 오류 발생: {e}")
        print(f"프롬프트 길이: {len(prompt)} 문자")
        # 프론트엔드에 전달할 수 있는 일반적인 오류 메시지를 반환하거나,
        # 별도의 예외를 발생시켜 API 레벨에서 처리하도록 할 수 있습니다.
        raise ValueError(f"AI 모델 호출에 실패했습니다: {str(e)}")


async def get_gemini_completion_json(
    prompt: str,
    *,
    temperature: float = 0.7,
    max_tokens: int = 1024,
    model: str = "gemini-3-pro-preview",
) -> str:
    """
    Gemini 텍스트 호출에서 "JSON 응답"을 강제하는 전용 헬퍼.

    의도/원리(중요):
    - `response_mime_type`는 "이미지/비전"과 무관하며, 출력 포맷(예: JSON) 강제 용도다.
    - `get_gemini_completion()`은 공용(전역) 함수라 동작 변경이 위험하므로,
      캐릭터 생성(QuickMeet/위저드 자동생성)처럼 "구조화 JSON 응답"이 필요한 경로에서만 이 함수를 사용한다.
    - SDK/환경에 따라 response_mime_type 미지원(TypeError)이 있을 수 있으므로,
      그 경우에는 일반 GenerationConfig로 호출한다(호출 자체는 유지). 파싱/정제는 호출부에서 계속 방어한다.
    """
    try:
        gemini_model = genai.GenerativeModel(model)

        # ✅ JSON 모드: 지원되는 환경에서만 활성화
        try:
            generation_config = genai.types.GenerationConfig(
                temperature=temperature,
                max_output_tokens=max_tokens,
                response_mime_type="application/json",
            )
        except TypeError:
            generation_config = genai.types.GenerationConfig(
                temperature=temperature,
                max_output_tokens=max_tokens,
            )

        response = await gemini_model.generate_content_async(
            prompt,
            generation_config=generation_config,
        )

        # 안전한 텍스트 추출 (get_gemini_completion과 동일한 방어 로직)
        try:
            if hasattr(response, "text") and response.text:
                return response.text
        except Exception:
            pass

        try:
            candidates = getattr(response, "candidates", []) or []
            for cand in candidates:
                content = getattr(cand, "content", None)
                if not content:
                    continue
                parts = getattr(content, "parts", []) or []
                text_parts = [getattr(p, "text", "") for p in parts if getattr(p, "text", "")]
                joined = "".join(text_parts).strip()
                if joined:
                    return joined
        except Exception:
            pass

        return ""
    except Exception as e:
        try:
            logger.error(f"Gemini(JSON) API 호출 중 오류 발생: {e}")
        except Exception:
            pass
        raise ValueError(f"AI 모델 호출에 실패했습니다: {str(e)}")


async def get_gemini_completion_stream(prompt: str, temperature: float = 0.7, max_tokens: int = 1024, model: str = 'gemini-1.5-pro'):
    """Gemini 모델의 스트리밍 응답을 비동기 제너레이터로 반환합니다."""
    try:
        gemini_model = genai.GenerativeModel(model)
        generation_config = genai.types.GenerationConfig(
            temperature=temperature,
            max_output_tokens=max_tokens
        )
        response_stream = await gemini_model.generate_content_async(
            prompt,
            generation_config=generation_config,
            stream=True
        )
        async for chunk in response_stream:
            if chunk.text:
                yield chunk.text
    except Exception as e:
        print(f"Gemini Stream API 호출 중 오류 발생: {e}")
        yield f"오류: Gemini 모델 호출에 실패했습니다 - {str(e)}"

async def get_claude_completion(
    prompt: str,
    temperature: float = 0.7,
    max_tokens: int = 1800,
    model: str = CLAUDE_MODEL_PRIMARY,
    image_base64: str | None = None,
    image_mime: str | None = None,
    system_prompt: str | None = None,
) -> str:
    """
    주어진 프롬프트로 Anthropic Claude 모델을 호출하여 응답을 반환합니다.
    이미지가 있을 경우 Vision 기능을 사용합니다.
    """
    try:
        # ✅ system prompt(우선순위 높음) 분리 지원
        # - 기존 구현은 모든 지시/설정을 user prompt 한 덩어리로 보내 drift(규칙 이탈)가 발생할 수 있었다.
        # - 최소 수정으로 system=... 을 사용하면 캐릭터/규칙 고정력이 강해진다.
        try:
            sys_text = (system_prompt or "").strip()
        except Exception:
            sys_text = ""

        # 메시지 콘텐츠 구성
        if image_base64:
            content = [
                {
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": (image_mime or "image/jpeg"),
                        "data": image_base64
                    }
                },
                {
                    "type": "text",
                    "text": prompt
                }
            ]
        else:
            content = prompt

        kwargs = {
            "model": model,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "messages": [{"role": "user", "content": content}],
        }
        if sys_text:
            kwargs["system"] = sys_text

        # ✅ 실제 호출(시도) 로그: Anthropic SDK가 내부적으로 https://api.anthropic.com/v1/messages 를 호출한다.
        # - 프롬프트/대사 내용은 절대 로그에 남기지 않는다.
        try:
            if getattr(settings, "DEBUG", False) or getattr(settings, "ENVIRONMENT", "") != "production":
                logger.info(f"[ai] http_call provider=claude sdk=anthropic.messages.create model={model} max_tokens={max_tokens} temp={temperature}")
        except Exception:
            pass

        message = await claude_client.messages.create(**kwargs)

        # 1) SDK가 Message 객체를 돌려주는 일반적인 경우
        if hasattr(message, "content"):
            text = message.content[0].text
            # UTF-8 인코딩 보장
            if isinstance(text, bytes):
                text = text.decode('utf-8', errors='replace')
            return text

        # 2) 어떤 이유로 문자열만 돌려준 경우
        if isinstance(message, str):
            # UTF-8 인코딩 보장
            if isinstance(message, bytes):
                return message.decode('utf-8', errors='replace')
            return message

        # 3) dict 형태(HTTP 응답 JSON)로 돌려준 경우
        if isinstance(message, dict):
            # {'content': [{'text': '...'}], ...} 형태를 기대
            content = message.get("content")
            if isinstance(content, list) and content and isinstance(content[0], dict):
                text = content[0].get("text", "")
                # UTF-8 인코딩 보장
                if isinstance(text, bytes):
                    text = text.decode('utf-8', errors='replace')
                return text
            result = str(message)
            if isinstance(result, bytes):
                result = result.decode('utf-8', errors='replace')
            return result

        # 그 밖의 예상치 못한 타입은 문자열로 강제 변환
        result = str(message)
        if isinstance(result, bytes):
            result = result.decode('utf-8', errors='replace')
        return result

    except Exception as e:
        print(f"Claude API 호출 중 오류 발생: {e}")
        raise ValueError(f"Claude API 호출에 실패했습니다: {e}")

async def get_claude_completion_stream(
    prompt: str,
    temperature: float = 0.7,
    max_tokens: int = 1024,
    model: str = CLAUDE_MODEL_PRIMARY,
    system_prompt: str | None = None,
):
    """Claude 모델의 스트리밍 응답을 비동기 제너레이터로 반환합니다."""
    try:
        try:
            sys_text = (system_prompt or "").strip()
        except Exception:
            sys_text = ""

        kwargs = {
            "model": model,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "messages": [{"role": "user", "content": prompt}],
        }
        if sys_text:
            kwargs["system"] = sys_text

        async with claude_client.messages.stream(**kwargs) as stream:
            async for text in stream.text_stream:
                yield text
    except Exception as e:
        print(f"Claude Stream API 호출 중 오류 발생: {e}")
        yield f"오류: Claude 모델 호출에 실패했습니다 - {str(e)}"

async def get_openai_completion(
    prompt: str,
    temperature: float = 0.7,
    max_tokens: int = 1024,
    model: str = "gpt-4o",
    system_prompt: str | None = None,
) -> str:
    """
    주어진 프롬프트로 OpenAI 모델을 호출하여 응답을 반환합니다.
    """
    try:
        from openai import AsyncOpenAI
        client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)
        # ✅ 실제 호출(시도) 로그: OpenAI는 모델에 따라 responses/chat.completions로 분기된다.
        # - 프롬프트/대사 내용은 절대 로그에 남기지 않는다.
        try:
            if getattr(settings, "DEBUG", False) or getattr(settings, "ENVIRONMENT", "") != "production":
                logger.info(f"[ai] http_call provider=openai enter model={model} max_tokens={max_tokens} temp={temperature}")
        except Exception:
            pass

        def _supports_responses_api(_client: object) -> bool:
            """현재 설치된 OpenAI Python SDK가 Responses API를 지원하는지 확인한다.

            배경/의도:
            - 일부 환경(구버전 SDK)에서는 AsyncOpenAI에 .responses가 없어 AttributeError가 발생한다.
            - 패키지 업그레이드 없이도 GPT-5.x를 쓸 수 있도록, 미지원 시 REST(/v1/responses)로 폴백한다.
            """
            try:
                r = getattr(_client, "responses", None)
                return bool(r and hasattr(r, "create"))
            except Exception:
                return False

        def _reasoning_effort_for_model(model_name: str) -> str | None:
            """GPT-5.1/5.2는 reasoning effort를 'medium'으로 강제한다."""
            try:
                m = (model_name or "").strip().lower()
            except Exception:
                m = ""
            if m.startswith("gpt-5.1") or m.startswith("gpt-5.2"):
                return "medium"
            return None

        def _style_instruction_for_temperature(temp_value: float) -> str | None:
            """GPT-5.x(Responses API)에서 temperature 파라미터가 막힌 경우를 대비해 스타일 지침으로 온도를 반영한다.

            의도/동작:
            - 프론트 슬라이더는 0.0~1.0 범위(0.1 step)이며, 다른 모델(Gemini/Claude/GPT-4 계열)은
              temperature 파라미터로 직접 반영된다.
            - GPT-5.x(Responses API)는 일부 환경에서 temperature 파라미터가 미지원(400)이라,
              user 설정 온도를 developer 지침으로 변환해 "대화 스타일"을 간접 제어한다.

            매핑:
            - 0.0에 가까울수록: 설정/요청에 충실, 보수적/일관적
            - 1.0에 가까울수록: 표현이 창의적/다양
            """
            try:
                t = float(temp_value)
            except Exception:
                return None
            # 0~1 클램핑 + 0.1 step 정합(프론트/백엔드 컨벤션)
            try:
                if t < 0:
                    t = 0.0
                if t > 1:
                    t = 1.0
                t = round(t * 10) / 10.0
            except Exception:
                return None

            # 구간별 가이드(너무 장황하지 않게)
            if t <= 0.2:
                band = "매우 설정에 충실(보수적)"
                guidance = "설정/대화 맥락에서 벗어나는 상상/추측을 최대한 줄이고, 간결하고 일관되게 답하세요."
            elif t <= 0.5:
                band = "설정 우선(안정적)"
                guidance = "설정/대화 맥락을 우선하되, 표현은 자연스럽게 다듬어 답하세요."
            elif t <= 0.8:
                band = "균형(적당히 창의적)"
                guidance = "표현을 조금 더 풍부하게 하되, 설정/캐릭터 성격/대화 맥락을 절대 깨지 마세요."
            else:
                band = "매우 창의적(다양한 표현)"
                guidance = "표현/비유/묘사를 더 창의적으로 하되, 설정을 바꾸거나 새 사실을 단정해 만들지 마세요."

            return (
                "대화 스타일(온도) 지침:\n"
                f"- 온도: {t:.1f} (0.0=설정/요청에 매우 충실, 1.0=창의적/다양)\n"
                f"- 현재 스타일: {band}\n"
                f"- 지침: {guidance}\n"
                "- 공통 규칙: 설정/대화 맥락/캐릭터 성격을 임의로 변경하거나 새 설정을 단정해 추가하지 마세요."
            )

        def _build_responses_input(
            user_prompt: str,
            *,
            style_instruction: str | None = None,
            system_prompt: str | None = None,
        ) -> list[dict]:
            """Responses API의 input 포맷으로 변환한다.

            NOTE(중요):
            - 기존 구현은 prompt 전체를 user 1개로 보내 drift(규칙 이탈)가 생길 수 있었다.
            - GPT-5(Responses API)에서는 system/developer가 user보다 우선하므로,
              character/system 프롬프트를 developer로 분리해 고정력을 높인다(최소 수정).
            """
            try:
                p = "" if user_prompt is None else str(user_prompt)
            except Exception:
                p = ""
            items: list[dict] = []
            try:
                s = (style_instruction or "").strip()
            except Exception:
                s = ""
            if s:
                # GPT-5 계열은 developer 지침으로 스타일을 간접 제어(temperature 미지원 대응)
                items.append({"role": "developer", "content": s})
            try:
                sp = (system_prompt or "").strip()
            except Exception:
                sp = ""
            if sp:
                # ✅ 캐릭터/규칙 고정(우선순위↑): developer로 넣어 user 프롬프트보다 강하게 적용
                items.append({"role": "developer", "content": sp})
            items.append({"role": "user", "content": p})
            return items

        def _extract_responses_text(resp: object) -> str:
            """Responses API 응답(SDK 객체 또는 dict)에서 텍스트를 방어적으로 추출한다."""
            # 1) SDK convenience: output_text
            try:
                out_txt = resp.get("output_text") if isinstance(resp, dict) else getattr(resp, "output_text", None)
                if isinstance(out_txt, str) and out_txt.strip():
                    return out_txt
            except Exception:
                pass

            # 2) output 배열의 message/output_text 수집
            try:
                outputs = resp.get("output") if isinstance(resp, dict) else getattr(resp, "output", None)
                texts: list[str] = []
                if isinstance(outputs, list):
                    for item in outputs:
                        it_type = getattr(item, "type", None) if not isinstance(item, dict) else item.get("type")
                        if it_type != "message":
                            continue
                        content = getattr(item, "content", None) if not isinstance(item, dict) else item.get("content")
                        if not isinstance(content, list):
                            continue
                        for part in content:
                            p_type = getattr(part, "type", None) if not isinstance(part, dict) else part.get("type")
                            if p_type == "output_text":
                                txt = getattr(part, "text", None) if not isinstance(part, dict) else part.get("text")
                                if isinstance(txt, str) and txt:
                                    texts.append(txt)
                            elif p_type == "refusal":
                                refusal = getattr(part, "refusal", None) if not isinstance(part, dict) else part.get("refusal")
                                if isinstance(refusal, str) and refusal:
                                    texts.append(refusal)
                joined = "".join(texts).strip()
                return joined
            except Exception:
                return ""

        async def _responses_rest_create(
            *,
            model_name: str,
            user_prompt: str,
            temp: float,
            max_out_tokens: int,
            reasoning_effort: str | None,
            system_prompt: str | None = None,
        ) -> str:
            """SDK에 responses가 없을 때 OpenAI Responses REST API를 직접 호출해 텍스트를 반환한다."""
            import os
            import json
            import aiohttp

            api_key = settings.OPENAI_API_KEY or os.getenv("OPENAI_API_KEY")
            if not api_key:
                raise ValueError("OPENAI_API_KEY가 설정되어 있지 않습니다.")

            base = (os.getenv("OPENAI_BASE_URL") or "https://api.openai.com/v1").rstrip("/")
            url = f"{base}/responses"

            payload: dict = {
                "model": model_name,
                "input": _build_responses_input(
                    user_prompt,
                    style_instruction=_style_instruction_for_temperature(temp),
                    system_prompt=system_prompt,
                ),
                "max_output_tokens": int(max_out_tokens),
            }
            if reasoning_effort:
                payload["reasoning"] = {"effort": reasoning_effort}

            headers = {
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            }

            timeout = aiohttp.ClientTimeout(total=120)
            async with aiohttp.ClientSession(timeout=timeout) as session:
                async with session.post(url, headers=headers, json=payload) as resp:
                    raw = await resp.read()
                    txt = raw.decode("utf-8", errors="replace") if isinstance(raw, (bytes, bytearray)) else str(raw)
                    try:
                        data = json.loads(txt) if isinstance(txt, str) else {}
                    except Exception:
                        data = {"_raw": txt}

                    if resp.status >= 400:
                        try:
                            logger.error(f"OpenAI Responses REST error {resp.status}: {txt[:800]}")
                        except Exception:
                            pass
                        raise ValueError(f"OpenAI Responses API error {resp.status}")

                    extracted = _extract_responses_text(data)
                    if extracted:
                        return extracted

                    # 방어적 폴백:
                    # - 일부 케이스(특히 reasoning 모델에서 max_output_tokens가 너무 작을 때)는
                    #   output이 reasoning만 채워지고 message/output_text가 아예 없을 수 있다.
                    # - 이때 JSON 원문을 사용자에게 그대로 노출하면 UX가 크게 깨지므로,
                    #   1회에 한해 출력 토큰을 늘려 재시도(비용/시간 고려해 제한) 후,
                    #   그래도 실패하면 사용자 친화 메시지를 반환한다.
                    try:
                        reason = ((data or {}).get("incomplete_details") or {}).get("reason")
                        outputs = (data or {}).get("output") or []
                        has_message = False
                        if isinstance(outputs, list):
                            for it in outputs:
                                it_type = it.get("type") if isinstance(it, dict) else getattr(it, "type", None)
                                if it_type == "message":
                                    has_message = True
                                    break
                        if (not has_message) and reason == "max_output_tokens" and int(max_out_tokens) < 1024:
                            # 1회 재시도: 1024로 상향(무한 재시도 방지)
                            return await _responses_rest_create(
                                model_name=model_name,
                                user_prompt=user_prompt,
                                temp=temp,
                                max_out_tokens=1024,
                                reasoning_effort=reasoning_effort,
                            )
                    except Exception:
                        pass

                    try:
                        logger.error(
                            f"OpenAI Responses REST: output_text extraction failed (model={model_name}, reason={(data or {}).get('incomplete_details')})"
                        )
                    except Exception:
                        pass
                    return "OpenAI 응답을 생성했지만 텍스트를 추출하지 못했습니다. 잠시 후 다시 시도해 주세요."

        def _use_responses_api(model_name: str) -> bool:
            """GPT-5/o-series 등 최신 모델은 Responses API가 권장이라 분기한다.

            배경:
            - 기존 Chat Completions도 동작할 수 있지만, GPT-5 계열은 Responses에서 기능/성능(Reasoning 등) 정합이 더 좋다.
            - 기존 GPT-4 계열은 현재 코드의 chat.completions 경로를 그대로 유지해 리스크를 줄인다.
            """
            try:
                m = (model_name or "").strip().lower()
            except Exception:
                m = ""
            return m.startswith("gpt-5") or m.startswith("o")

        # GPT-5 계열: Responses API 사용 (권장)
        if _use_responses_api(model):
            effort = _reasoning_effort_for_model(model)
            if _supports_responses_api(client):
                try:
                    if getattr(settings, "DEBUG", False) or getattr(settings, "ENVIRONMENT", "") != "production":
                        logger.info(f"[ai] http_call provider=openai api=responses sdk model={model}")
                except Exception:
                    pass
                try:
                    sp = (system_prompt or "").strip()
                except Exception:
                    sp = ""
                kwargs = {
                    "model": model,
                    "input": _build_responses_input(
                        prompt,
                        style_instruction=_style_instruction_for_temperature(temperature),
                        system_prompt=sp or None,
                    ),
                    "max_output_tokens": max_tokens,
                }
                if effort:
                    kwargs["reasoning"] = {"effort": effort}
                resp = await client.responses.create(**kwargs)
                extracted = _extract_responses_text(resp)
                if extracted:
                    return extracted
                return "OpenAI 응답을 생성했지만 텍스트를 추출하지 못했습니다. 잠시 후 다시 시도해 주세요."

            # ✅ SDK 미지원 폴백: REST(/v1/responses)
            try:
                if getattr(settings, "DEBUG", False) or getattr(settings, "ENVIRONMENT", "") != "production":
                    logger.info(f"[ai] http_call provider=openai api=responses rest model={model}")
            except Exception:
                pass
            try:
                sp = (system_prompt or "").strip()
            except Exception:
                sp = ""
            extracted = await _responses_rest_create(
                model_name=model,
                user_prompt=prompt,
                temp=temperature,
                max_out_tokens=max_tokens,
                reasoning_effort=effort,
                system_prompt=sp or None,
            )
            if extracted:
                return extracted
            return "OpenAI 응답을 생성했지만 텍스트를 추출하지 못했습니다. 잠시 후 다시 시도해 주세요."

        # GPT-4 계열(기존): Chat Completions 유지
        try:
            if getattr(settings, "DEBUG", False) or getattr(settings, "ENVIRONMENT", "") != "production":
                logger.info(f"[ai] http_call provider=openai api=chat.completions sdk model={model}")
        except Exception:
            pass
        try:
            sp = (system_prompt or "").strip()
        except Exception:
            sp = ""
        messages = [{"role": "user", "content": prompt}]
        if sp:
            # ✅ GPT-4 계열: system role 분리로 규칙/캐릭터 고정력 강화
            messages = [{"role": "system", "content": sp}, {"role": "user", "content": prompt}]

        response = await client.chat.completions.create(
            model=model,
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens
        )
        return response.choices[0].message.content
    except Exception as e:
        try:
            logger.error(f"OpenAI API 호출 중 오류 발생: {e} (model={model}, prompt_len={len(prompt) if isinstance(prompt, str) else 'n/a'})")
        except Exception:
            pass
        print(f"OpenAI API 호출 중 오류 발생: {e}")
        raise ValueError(f"OpenAI API 호출에 실패했습니다: {e}")

async def get_openai_completion_stream(
    prompt: str,
    temperature: float = 0.7,
    max_tokens: int = 1024,
    model: str = "gpt-4o",
    system_prompt: str | None = None,
):
    """OpenAI 모델의 스트리밍 응답을 비동기 제너레이터로 반환합니다."""
    try:
        from openai import AsyncOpenAI
        client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)

        def _supports_responses_api(_client: object) -> bool:
            """현재 설치된 OpenAI Python SDK가 Responses API 스트리밍을 지원하는지 확인한다."""
            try:
                r = getattr(_client, "responses", None)
                return bool(r and hasattr(r, "create"))
            except Exception:
                return False

        def _reasoning_effort_for_model(model_name: str) -> str | None:
            """GPT-5.1/5.2는 reasoning effort를 'medium'으로 강제한다."""
            try:
                m = (model_name or "").strip().lower()
            except Exception:
                m = ""
            if m.startswith("gpt-5.1") or m.startswith("gpt-5.2"):
                return "medium"
            return None

        def _style_instruction_for_temperature(temp_value: float) -> str | None:
            """GPT-5.x(Responses API)에서 temperature 파라미터 미지원 시, 스타일 지침으로 온도를 반영한다."""
            try:
                t = float(temp_value)
            except Exception:
                return None
            try:
                if t < 0:
                    t = 0.0
                if t > 1:
                    t = 1.0
                t = round(t * 10) / 10.0
            except Exception:
                return None

            if t <= 0.2:
                band = "매우 설정에 충실(보수적)"
                guidance = "설정/대화 맥락에서 벗어나는 상상/추측을 최대한 줄이고, 간결하고 일관되게 답하세요."
            elif t <= 0.5:
                band = "설정 우선(안정적)"
                guidance = "설정/대화 맥락을 우선하되, 표현은 자연스럽게 다듬어 답하세요."
            elif t <= 0.8:
                band = "균형(적당히 창의적)"
                guidance = "표현을 조금 더 풍부하게 하되, 설정/캐릭터 성격/대화 맥락을 절대 깨지 마세요."
            else:
                band = "매우 창의적(다양한 표현)"
                guidance = "표현/비유/묘사를 더 창의적으로 하되, 설정을 바꾸거나 새 사실을 단정해 만들지 마세요."

            return (
                "대화 스타일(온도) 지침:\n"
                f"- 온도: {t:.1f} (0.0=설정/요청에 매우 충실, 1.0=창의적/다양)\n"
                f"- 현재 스타일: {band}\n"
                f"- 지침: {guidance}\n"
                "- 공통 규칙: 설정/대화 맥락/캐릭터 성격을 임의로 변경하거나 새 설정을 단정해 추가하지 마세요."
            )

        def _build_responses_input(
            user_prompt: str,
            *,
            style_instruction: str | None = None,
            system_prompt: str | None = None,
        ) -> list[dict]:
            """Responses API의 input 포맷으로 변환한다.

            NOTE:
            - stream 경로에서도 character/system 프롬프트를 developer로 분리해 drift를 줄인다.
            """
            try:
                p = "" if user_prompt is None else str(user_prompt)
            except Exception:
                p = ""
            items: list[dict] = []
            try:
                s = (style_instruction or "").strip()
            except Exception:
                s = ""
            if s:
                items.append({"role": "developer", "content": s})
            try:
                sp = (system_prompt or "").strip()
            except Exception:
                sp = ""
            if sp:
                items.append({"role": "developer", "content": sp})
            items.append({"role": "user", "content": p})
            return items

        async def _responses_rest_stream(
            *,
            model_name: str,
            user_prompt: str,
            temp: float,
            max_out_tokens: int,
            reasoning_effort: str | None,
            system_prompt: str | None = None,
        ):
            """SDK에 responses가 없을 때 OpenAI Responses REST 스트리밍을 SSE로 파싱해 delta를 yield한다."""
            import os
            import json
            import aiohttp

            api_key = settings.OPENAI_API_KEY or os.getenv("OPENAI_API_KEY")
            if not api_key:
                yield "오류: OpenAI 모델 호출에 실패했습니다 - OPENAI_API_KEY가 설정되어 있지 않습니다."
                return

            base = (os.getenv("OPENAI_BASE_URL") or "https://api.openai.com/v1").rstrip("/")
            url = f"{base}/responses"

            payload: dict = {
                "model": model_name,
                "input": _build_responses_input(
                    user_prompt,
                    style_instruction=_style_instruction_for_temperature(temp),
                    system_prompt=system_prompt,
                ),
                "max_output_tokens": int(max_out_tokens),
                "stream": True,
            }
            if reasoning_effort:
                payload["reasoning"] = {"effort": reasoning_effort}

            headers = {
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            }

            timeout = aiohttp.ClientTimeout(total=300)
            async with aiohttp.ClientSession(timeout=timeout) as session:
                async with session.post(url, headers=headers, json=payload) as resp:
                    if resp.status >= 400:
                        try:
                            txt = await resp.text()
                        except Exception:
                            txt = ""
                        try:
                            logger.error(f"OpenAI Responses REST stream error {resp.status}: {txt[:800]}")
                        except Exception:
                            pass
                        yield f"오류: OpenAI 모델 호출에 실패했습니다 - HTTP {resp.status}"
                        return

                    buf = b""
                    async for chunk in resp.content.iter_chunked(1024):
                        if not chunk:
                            continue
                        buf += chunk
                        while b"\n" in buf:
                            line, buf = buf.split(b"\n", 1)
                            line = line.strip()
                            if not line:
                                continue
                            if not line.startswith(b"data:"):
                                continue
                            data_part = line[len(b"data:"):].strip()
                            if data_part == b"[DONE]":
                                return
                            try:
                                evt = json.loads(data_part.decode("utf-8", errors="replace"))
                            except Exception:
                                continue
                            et = evt.get("type")
                            if et in ("response.output_text.delta", "response.refusal.delta"):
                                delta = evt.get("delta")
                                if isinstance(delta, str) and delta:
                                    yield delta
                            elif et == "response.error":
                                err = evt.get("error")
                                yield f"오류: OpenAI 모델 호출에 실패했습니다 - {err}"
                                return

        def _use_responses_api(model_name: str) -> bool:
            """GPT-5/o-series 등 최신 모델은 Responses API 스트리밍 이벤트를 사용한다."""
            try:
                m = (model_name or "").strip().lower()
            except Exception:
                m = ""
            return m.startswith("gpt-5") or m.startswith("o")

        # GPT-5 계열: Responses API 스트리밍
        if _use_responses_api(model):
            effort = _reasoning_effort_for_model(model)
            if _supports_responses_api(client):
                try:
                    sp = (system_prompt or "").strip()
                except Exception:
                    sp = ""
                kwargs = {
                    "model": model,
                    "input": _build_responses_input(
                        prompt,
                        style_instruction=_style_instruction_for_temperature(temperature),
                        system_prompt=sp or None,
                    ),
                    "max_output_tokens": max_tokens,
                    "stream": True,
                }
                if effort:
                    kwargs["reasoning"] = {"effort": effort}
                stream = await client.responses.create(**kwargs)
                async for event in stream:
                    try:
                        et = getattr(event, "type", None) if not isinstance(event, dict) else event.get("type")
                        if et in ("response.output_text.delta", "response.refusal.delta"):
                            delta = getattr(event, "delta", None) if not isinstance(event, dict) else event.get("delta")
                            if isinstance(delta, str) and delta:
                                yield delta
                        elif et == "response.error":
                            err = getattr(event, "error", None) if not isinstance(event, dict) else event.get("error")
                            if err:
                                yield f"오류: OpenAI 모델 호출에 실패했습니다 - {err}"
                                return
                    except Exception:
                        # 이벤트 파싱 실패는 조용히 무시(스트림 유지)
                        continue
                return

            # ✅ SDK 미지원 폴백: REST(/v1/responses) SSE 스트리밍
            try:
                sp = (system_prompt or "").strip()
            except Exception:
                sp = ""
            async for delta in _responses_rest_stream(
                model_name=model,
                user_prompt=prompt,
                temp=temperature,
                max_out_tokens=max_tokens,
                reasoning_effort=effort,
                system_prompt=sp or None,
            ):
                yield delta
            return

        # GPT-4 계열(기존): Chat Completions 스트리밍 유지
        try:
            sp = (system_prompt or "").strip()
        except Exception:
            sp = ""
        messages = [{"role": "user", "content": prompt}]
        if sp:
            messages = [{"role": "system", "content": sp}, {"role": "user", "content": prompt}]
        stream = await client.chat.completions.create(
            model=model,
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens,
            stream=True
        )
        async for chunk in stream:
            if chunk.choices[0].delta.content:
                yield chunk.choices[0].delta.content
    except Exception as e:
        try:
            logger.error(f"OpenAI Stream API 호출 중 오류 발생: {e} (model={model}, prompt_len={len(prompt) if isinstance(prompt, str) else 'n/a'})")
        except Exception:
            pass
        print(f"OpenAI Stream API 호출 중 오류 발생: {e}")
        yield f"오류: OpenAI 모델 호출에 실패했습니다 - {str(e)}"

# --- 통합 AI 응답 함수 ---
AIModel = Literal["gemini", "claude", "gpt"]

async def get_ai_completion(
    prompt: str,
    model: AIModel = "gemini",
    sub_model: Optional[str] = None,
    temperature: float = 0.7,
    max_tokens: int = 2048
) -> str:
    """
    지정된 AI 모델을 호출하여 응답을 반환하는 통합 함수입니다.
    """
    if model == "gemini":
        # ✅ Gemini 기본 sub_model: gemini-3-flash-preview (속도 최우선)
        model_name = sub_model or 'gemini-3-flash-preview'
        return await get_gemini_completion(prompt, temperature, max_tokens, model=model_name)
    elif model == "claude":
        # ✅ Claude 기본 sub_model: Haiku 4.5 (속도 우선, 채팅은 별도 함수 사용)
        model_name = sub_model or 'claude-haiku-4-5-20251001'
        return await get_claude_completion(prompt, temperature, max_tokens, model=model_name)
    elif model == "gpt":
        model_name = sub_model or 'gpt-4o'
        return await get_openai_completion(prompt, temperature, max_tokens, model=model_name)
    else:
        raise ValueError(f"지원하지 않는 모델입니다: {model}")

# --- 통합 AI 응답 스트림 함수 ---
async def get_ai_completion_stream(
    prompt: str,
    model: AIModel = "gemini",
    sub_model: Optional[str] = None,
    temperature: float = 0.7,
    max_tokens: int = 2048
) -> AsyncGenerator[str, None]:
    """지정된 AI 모델의 스트리밍 응답을 반환하는 통합 함수입니다."""
    if model == "gemini":
        # ✅ Gemini 기본 sub_model: gemini-3-flash-preview (속도 최우선)
        model_name = sub_model or 'gemini-3-flash-preview'
        async for chunk in get_gemini_completion_stream(prompt, temperature, max_tokens, model=model_name):
            yield chunk
    elif model == "claude":
        # ✅ Claude 기본 sub_model: Haiku 4.5 (속도 우선)
        model_name = sub_model or 'claude-haiku-4-5-20251001'
        async for chunk in get_claude_completion_stream(prompt, temperature, max_tokens, model=model_name):
            yield chunk
    elif model == "gpt":
        model_name = sub_model or 'gpt-4o'
        async for chunk in get_openai_completion_stream(prompt, temperature, max_tokens, model=model_name):
            yield chunk
    else:
        raise ValueError(f"지원하지 않는 모델입니다: {model}")


# --- 기존 채팅 관련 함수 ---
async def get_ai_chat_response(
    character_prompt: str, 
    user_message: str, 
    history: list, 
    # ✅ 기본값(요구사항): Claude Haiku 4.5
    # - 유저 저장 설정이 없거나, 호출부가 preferred_model/sub_model을 넘기지 않는 경우의 안전 기본값.
    preferred_model: str = 'claude',
    preferred_sub_model: str = 'claude-haiku-4-5-20251001',
    # ✅ 기본값(요구사항): short(짧게)
    response_length_pref: str = 'short',
    temperature: float = 0.7
) -> str:
    """사용자가 선택한 모델로 AI 응답 생성"""
    # temperature 방어적 정규화: 0~1
    try:
        t = float(temperature)
        if t < 0:
            t = 0.0
        if t > 1:
            t = 1.0
        # 0.1 단위 반올림(프론트와 정합)
        t = round(t * 10) / 10.0
    except Exception:
        t = 0.7
    # 사용자 자연어 의도 경량 파싱(추가 API 호출 없음)
    try:
        intent_info = _parse_user_intent(user_message)
    except Exception:
        intent_info = {}

    # 의도 블록 구성
    intent_lines = []
    if intent_info.get("intent"):
        intent_lines.append(f"의도: {intent_info.get('intent')}")
    if intent_info.get("stance") == "first":
        intent_lines.append("시점: 1인칭 '나'")
    if intent_info.get("stance") == "third":
        intent_lines.append("시점: 3인칭(인물 지칭은 '그/그녀')")
    if intent_info.get("tone"):
        intent_lines.append(f"톤: {intent_info.get('tone')}")
    if intent_info.get("pace"):
        intent_lines.append(f"템포: {intent_info.get('pace')}")
    for c in intent_info.get("constraints", []):
        intent_lines.append(f"제약: {c}")
    if intent_info.get("transform_tags"):
        intent_lines.append("태그: " + ", ".join(intent_info.get("transform_tags", [])[:6]))
    intent_block = ("\n[의도 반영]\n" + "\n".join(intent_lines)) if intent_lines else ""

    # ✅ 최근 대화 히스토리 반영(방어적)
    # - 원작챗/일반챗 등에서 history를 넘겨도 무시되면 '망각/설정 붕괴'가 발생한다.
    # ✅ history 최대 개수는 100까지 허용하되, max_chars(12000)로 토큰 폭주를 1차 방어한다.
    # - 원작챗은 최신 맥락이 중요해 히스토리 fetch limit를 80으로 올려둔 상태라, max_items도 80으로 정합을 맞춘다.
    history_block = _format_history_block(history, max_items=100, max_chars=12000)

    # ✅ 응답 길이 선호도 프롬프트 지침(체감 강화)
    # - 기존에는 max_tokens(상한)만 조정되어 "길게" 체감이 약할 수 있다.
    # - 그래서 모델에게도 길이 기대치를 명시적으로 가이드한다(출력은 자연스러운 대화만).
    length_block = ""
    try:
        rlp = (response_length_pref or "").strip().lower()
    except Exception:
        rlp = ""
    if rlp == "short":
        length_block = (
            "\n[응답 길이]\n"
            "- 짧게: 1~2문장(또는 1단락)으로 핵심만.\n"
            "- 불필요한 설명/설정 추가/장황한 묘사 금지.\n"
            "- 출력은 자연스러운 대화만(불릿/라벨/번호/헤더 금지).\n"
        )
    elif rlp == "long":
        length_block = (
            "\n[응답 길이]\n"
            "- 길게: 6~12문장 정도로 충분히 풍부하게.\n"
            "- 감정/행동/상황을 더 묘사하되, 설정/사실을 임의로 추가하거나 단정하지 않는다.\n"
            "- 출력은 자연스러운 대화만(불릿/라벨/번호/헤더 금지).\n"
        )
    else:
        # medium(기본)
        length_block = (
            "\n[응답 길이]\n"
            "- 보통: 3~6문장 정도로 자연스럽게.\n"
            "- 출력은 자연스러운 대화만(불릿/라벨/번호/헤더 금지).\n"
        )

    # ✅ 프롬프트 구성(중요)
    # - Gemini는 단일 prompt 문자열로 호출하므로 기존처럼 합친 full_prompt를 유지한다.
    # - Claude/GPT는 system(developer)/user 역할 분리로 "캐릭터/규칙" 우선순위를 높인다.
    user_prompt = f"{history_block}{intent_block}{length_block}\n\n사용자 메시지: {user_message}\n\n위 설정에 맞게 자연스럽게 응답하세요 (대화만 출력, 라벨 없이):"
    full_prompt = f"{character_prompt}{user_prompt}"

    # 응답 길이 선호도 → 최대 토큰 비율 조정 (중간 기준 1.0)
    #
    # ✅ Gemini(Pro 계열)만 예외 처리:
    # - gemini-2.5-pro 계열은 max_output_tokens(=max_tokens)가 너무 낮으면 내부 추론/사고로 토큰을 소진한 뒤
    #   최종 텍스트 파트(content.parts)가 비어(parts_len=0) "빈 응답"이 발생할 수 있다.
    # - 그래서 "짧게" 모드에서도 Gemini는 너무 작은 상한을 주지 않고, 안정적인 상한(기본값 1800)을 유지한다.
    #
    # 참고: 실제 출력 길이(1~2문장/3~6문장/6~12문장)는 위 length_block 지침으로 제어하며,
    #       여기 max_tokens는 '상한(ceiling)'이므로 값을 키워도 무조건 길어지지는 않는다.
    base_max_tokens = 1800
    try:
        is_gemini = (preferred_model == 'gemini')
    except Exception:
        is_gemini = False

    if rlp == 'short':
        max_tokens = base_max_tokens if is_gemini else int(base_max_tokens * 0.5)
    elif rlp == 'long':
        max_tokens = int(base_max_tokens * 1.5)
    else:
        max_tokens = base_max_tokens
    
    # 모델별 처리
    if preferred_model == 'gemini':
        # NOTE:
        # - 프론트(ModelSelectionModal)에서는 "gemini-3-flash-preview", "gemini-3-pro-preview" 같은 UI용 id를 저장한다.
        #   (레거시 값: gemini-3-flash / gemini-3-pro도 방어적으로 허용)
        # - 실제 Gemini 호출은 genai.GenerativeModel(<실제 모델명>)에 들어갈 문자열이 필요하므로 여기서 매핑한다.
        # - 기존 기본값(gemini-2.5-pro)은 그대로 유지한다. (요청: 2.5-pro는 가만히)
        try:
            sub = (preferred_sub_model or "").strip()
        except Exception:
            sub = ""

        # Gemini 3 Preview 매핑 (대표님 제공 예시 기반)
        if sub in ("gemini-3-pro", "gemini-3-pro-preview"):
            model_name = "gemini-3-pro-preview"
        elif sub in ("gemini-3-flash", "gemini-3-flash-preview"):
            model_name = "gemini-3-flash-preview"
        elif sub == "gemini-2.5-flash":
            model_name = "gemini-2.5-flash"
        else:
            # gemini-2.5-pro(기본) 포함: 알 수 없는 값은 기존 안정 기본값으로 폴백
            model_name = "gemini-2.5-pro"
        # ✅ 모델 선택 로깅(프롬프트/대사 내용 제외)
        try:
            if getattr(settings, "DEBUG", False) or getattr(settings, "ENVIRONMENT", "") != "production":
                logger.info(f"[ai] model_selected provider=gemini sub_model={model_name} (raw={preferred_sub_model}) max_tokens={max_tokens} temp={t}")
        except Exception:
            pass
        # ✅ 실제 호출(시도) 로그: Gemini도 "실제로 어떤 모델 문자열로 호출했는지"를 다른 provider와 동일 포맷으로 남긴다.
        # - SDK 내부 HTTP 디테일까지는 숨겨질 수 있으므로, 최소한 resolved model_name을 SSOT로 보장한다.
        try:
            if getattr(settings, "DEBUG", False) or getattr(settings, "ENVIRONMENT", "") != "production":
                logger.info(f"[ai] http_call provider=gemini sdk=google-generativeai call=generate_content_async model={model_name} max_tokens={max_tokens} temp={t}")
        except Exception:
            pass
        return await get_gemini_completion(full_prompt, temperature=t, model=model_name, max_tokens=max_tokens)
        
    elif preferred_model == 'claude':
        # 프론트의 가상 서브모델명을 실제 Anthropic 모델 ID로 매핑
        # 유효하지 않은 값이 들어오면 최신 안정 버전으로 폴백
        claude_default = CLAUDE_MODEL_PRIMARY
        claude_mapping = {
            # ✅ 권장(SSOT): Anthropic에 전달되는 스냅샷 모델명(날짜 포함)
            'claude-sonnet-4-20250514': 'claude-sonnet-4-20250514',
            'claude-sonnet-4-5-20250929': 'claude-sonnet-4-5-20250929',
            'claude-opus-4-1-20250805': 'claude-opus-4-1-20250805',
            'claude-opus-4-5-20251101': 'claude-opus-4-5-20251101',
            # ✅ 속도 최적화(요구사항): Haiku 4.5
            'claude-haiku-4-5-20251001': 'claude-haiku-4-5-20251001',

            # ✅ UI/저장값 호환(별칭/레거시) → 스냅샷으로 변환
            'claude-sonnet-4': 'claude-sonnet-4-20250514',
            'claude-sonnet-4-0': 'claude-sonnet-4-20250514',
            'claude-4-sonnet': 'claude-sonnet-4-20250514',
            'claude-sonnet-4.0': 'claude-sonnet-4-20250514',

            'claude-opus-4-1': 'claude-opus-4-1-20250805',
            'claude-opus-4-5': 'claude-opus-4-5-20251101',

            'claude-sonnet-4-5': 'claude-sonnet-4-5-20250929',
            'claude-sonnet-4.5': 'claude-sonnet-4-5-20250929',
            'claude-sonnet-4.5-think': 'claude-sonnet-4-5-20250929',
            'claude-opus-4.5': 'claude-opus-4-5-20251101',
        }

        try:
            sub = (preferred_sub_model or "").strip()
        except Exception:
            sub = ""
        model_name = claude_mapping.get(sub, claude_default)
        # ✅ 모델 선택 로깅(프롬프트/대사 내용 제외)
        try:
            if getattr(settings, "DEBUG", False) or getattr(settings, "ENVIRONMENT", "") != "production":
                logger.info(f"[ai] model_selected provider=claude sub_model={model_name} (raw={preferred_sub_model}) max_tokens={max_tokens} temp={t}")
        except Exception:
            pass
        return await get_claude_completion(
            user_prompt,
            temperature=t,
            model=model_name,
            max_tokens=max_tokens,
            system_prompt=character_prompt,
        )
        
    elif preferred_model == 'gpt':
        # NOTE:
        # - 프론트(ModelSelectionModal)에서 gpt-5.1/gpt-5.2 등 최신 모델명을 선택할 수 있다.
        # - GPT-5 계열은 get_openai_completion 내부에서 Responses API로 분기된다.
        try:
            sub = (preferred_sub_model or "").strip()
        except Exception:
            sub = ""

        if sub.startswith("gpt-5"):
            model_name = sub
        elif sub in ("gpt-4.1", "gpt-4.1-mini", "gpt-4o"):
            model_name = sub
        else:
            # 알 수 없는 값은 기존 안정 기본값으로 폴백
            model_name = 'gpt-4o'
        # ✅ 모델 선택 로깅(프롬프트/대사 내용 제외)
        try:
            if getattr(settings, "DEBUG", False) or getattr(settings, "ENVIRONMENT", "") != "production":
                logger.info(f"[ai] model_selected provider=gpt sub_model={model_name} (raw={preferred_sub_model}) max_tokens={max_tokens} temp={t}")
        except Exception:
            pass
        return await get_openai_completion(
            user_prompt,
            temperature=t,
            model=model_name,
            max_tokens=max_tokens,
            system_prompt=character_prompt,
        )
        
    else:  # argo (기본값)
        # ARGO 모델은 향후 커스텀 API 구현 예정, 현재는 Gemini로 대체
        return await get_gemini_completion(full_prompt, temperature=t, model='gemini-2.5-pro', max_tokens=max_tokens)


async def regenerate_partial_text(
    selected_text: str,
    user_prompt: str,
    before_context: str = "",
    after_context: str = ""
) -> str:
    """선택된 텍스트 부분을 사용자 지시사항에 따라 재생성
    
    Args:
        selected_text: 선택된 원본 텍스트
        user_prompt: 사용자의 수정 지시사항 (예: "더 감성적으로", "짧게 요약해줘")
        before_context: 선택 영역 이전 텍스트 (맥락)
        after_context: 선택 영역 이후 텍스트 (맥락)
    
    Returns:
        재생성된 텍스트
    """
    try:
        # 프롬프트 구성
        prompt = f"""다음은 소설/스토리의 일부입니다. 사용자가 선택한 부분을 지시사항에 따라 재작성해주세요.

[이전 맥락]
{before_context[-500:] if before_context else "(없음)"}

[선택된 부분 - 이 부분을 재작성해야 합니다]
{selected_text}

[이후 맥락]
{after_context[:500] if after_context else "(없음)"}

[사용자 지시사항]
{user_prompt}

## 재작성 지침:
1. 이전/이후 맥락과 자연스럽게 연결되어야 합니다
2. 사용자 지시사항을 최대한 반영하되, 스토리의 흐름을 해치지 않아야 합니다
3. 원본의 핵심 내용은 유지하되, 표현/스타일/길이 등을 조정합니다
4. 추가 설명 없이 재작성된 텍스트만 출력하세요

재작성된 텍스트:"""

        # Claude API 호출
        result = await get_claude_completion(
            prompt,
            temperature=0.7,
            max_tokens=2000,
            model=CLAUDE_MODEL_PRIMARY
        )
        
        return result.strip()
        
    except Exception as e:
        logger.error(f"Failed to regenerate partial text: {e}")
        raise
