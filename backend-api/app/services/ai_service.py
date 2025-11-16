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

logger = logging.getLogger(__name__)

# Claude 모델명 상수 (전역 참조용)
# CLAUDE_MODEL_PRIMARY = 'claude-sonnet-4-5-20250929'
CLAUDE_MODEL_PRIMARY = 'claude-sonnet-4-20250514'
# CLAUDE_MODEL_PRIMARY = 'claude-3-7-sonnet-20250219'
CLAUDE_MODEL_LEGACY = 'claude-sonnet-4-20250514'  # 폴백/호환용

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
        logging.info("Vision combine: start (unified tags+context)")
        import requests, base64, json
        # 이미지 다운로드 및 MIME 추정
        resp = requests.get(image_url, timeout=10)
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
        # Claude 우선 호출(건조 모드: 낮은 온도/탑P, 토큰 축소)
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
        data = json.loads(txt)
        if not isinstance(data, dict):
            raise ValueError("combined response is not dict")
        logging.info("Vision combine: success (provider=Claude)")
        return data.get('tags') or {}, data.get('context') or {}
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
async def get_gemini_completion(prompt: str, temperature: float = 0.7, max_tokens: int = 1024, model: str= 'gemini-2.5-pro') -> str:
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
        gemini_model = genai.GenerativeModel(model)
        
        # GenerationConfig를 사용하여 JSON 모드 등을 활성화할 수 있음 (향후 확장)
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

        # 안전 정책/기타 사유로 텍스트가 비어있을 때: 부드러운 재시도 또는 폴백
        try:
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
                return await get_claude_completion(prompt, model='claude-3-5-sonnet-20241022', max_tokens=1024)
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
    image_mime: str | None = None
) -> str:
    """
    주어진 프롬프트로 Anthropic Claude 모델을 호출하여 응답을 반환합니다.
    이미지가 있을 경우 Vision 기능을 사용합니다.
    """
    try:
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
            
        message = await claude_client.messages.create(
            model=model,
            max_tokens=max_tokens,
            temperature=temperature,
            messages=[{"role": "user", "content": content}],
        )

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

async def get_claude_completion_stream(prompt: str, temperature: float = 0.7, max_tokens: int = 1024, model: str = "claude-3-5-sonnet-20240620"):
    """Claude 모델의 스트리밍 응답을 비동기 제너레이터로 반환합니다."""
    try:
        async with claude_client.messages.stream(
            model=model,
            max_tokens=max_tokens,
            temperature=temperature,
            messages=[{"role": "user", "content": prompt}],
        ) as stream:
            async for text in stream.text_stream:
                yield text
    except Exception as e:
        print(f"Claude Stream API 호출 중 오류 발생: {e}")
        yield f"오류: Claude 모델 호출에 실패했습니다 - {str(e)}"

async def get_openai_completion(
    prompt: str,
    temperature: float = 0.7,
    max_tokens: int = 1024,
    model: str = "gpt-4o"
) -> str:
    """
    주어진 프롬프트로 OpenAI 모델을 호출하여 응답을 반환합니다.
    """
    try:
        from openai import AsyncOpenAI
        client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)
        
        response = await client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": prompt}],
            temperature=temperature,
            max_tokens=max_tokens
        )
        return response.choices[0].message.content
    except Exception as e:
        print(f"OpenAI API 호출 중 오류 발생: {e}")
        raise ValueError(f"OpenAI API 호출에 실패했습니다: {e}")

async def get_openai_completion_stream(prompt: str, temperature: float = 0.7, max_tokens: int = 1024, model: str = "gpt-4o"):
    """OpenAI 모델의 스트리밍 응답을 비동기 제너레이터로 반환합니다."""
    try:
        from openai import AsyncOpenAI
        client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)
        
        stream = await client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": prompt}],
            temperature=temperature,
            max_tokens=max_tokens,
            stream=True
        )
        async for chunk in stream:
            if chunk.choices[0].delta.content:
                yield chunk.choices[0].delta.content
    except Exception as e:
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
        model_name = sub_model or 'gemini-2.5-pro'
        return await get_gemini_completion(prompt, temperature, max_tokens, model=model_name)
    elif model == "claude":
        model_name = sub_model or CLAUDE_MODEL_PRIMARY
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
        model_name = sub_model or 'gemini-1.5-pro'
        async for chunk in get_gemini_completion_stream(prompt, temperature, max_tokens, model=model_name):
            yield chunk
    elif model == "claude":
        model_name = sub_model or CLAUDE_MODEL_PRIMARY
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
    preferred_model: str = 'gemini',
    preferred_sub_model: str = 'gemini-2.5-pro',
    response_length_pref: str = 'medium'
) -> str:
    """사용자가 선택한 모델로 AI 응답 생성"""
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

    # 프롬프트와 사용자 메시지 결합(+의도 블록)
    full_prompt = f"{character_prompt}{intent_block}\n\n사용자 메시지: {user_message}\n\n위 설정에 맞게 자연스럽게 응답하세요 (대화만 출력, 라벨 없이):"

    # 응답 길이 선호도 → 최대 토큰 비율 조정 (중간 기준 1.0)
    base_max_tokens = 1800
    if response_length_pref == 'short':
        max_tokens = int(base_max_tokens * 0.5)
    elif response_length_pref == 'long':
        max_tokens = int(base_max_tokens * 1.5)
    else:
        max_tokens = base_max_tokens
    
    # 모델별 처리
    if preferred_model == 'gemini':
        if preferred_sub_model == 'gemini-2.5-flash':
            model_name = 'gemini-2.5-flash'
        else:  # gemini-2.5-pro
            model_name = 'gemini-2.5-pro'
        return await get_gemini_completion(full_prompt, model=model_name, max_tokens=max_tokens)
        
    elif preferred_model == 'claude':
        # 프론트의 가상 서브모델명을 실제 Anthropic 모델 ID로 매핑
        # 유효하지 않은 값이 들어오면 최신 안정 버전으로 폴백
        claude_default = CLAUDE_MODEL_PRIMARY
        claude_mapping = {
            # UI 표기 → 실제 모델 ID (모두 최신 Sonnet 4로 통일)
            'claude-4-sonnet': claude_default,
            'claude-3.7-sonnet': claude_default,
            'claude-3.5-sonnet-v2': claude_default,
            'claude-3-5-sonnet-20241022': claude_default,
            'claude-sonnet-4-20250514': CLAUDE_MODEL_PRIMARY,
        }

        model_name = claude_mapping.get(preferred_sub_model, claude_default)
        return await get_claude_completion(full_prompt, model=model_name, max_tokens=max_tokens)
        
    elif preferred_model == 'gpt':
        if preferred_sub_model == 'gpt-4.1':
            model_name = 'gpt-4.1'
        elif preferred_sub_model == 'gpt-4.1-mini':
            model_name = 'gpt-4.1-mini'
        else:  # gpt-4o
            model_name = 'gpt-4o'
        return await get_openai_completion(full_prompt, model=model_name, max_tokens=max_tokens)
        
    else:  # argo (기본값)
        # ARGO 모델은 향후 커스텀 API 구현 예정, 현재는 Gemini로 대체
        return await get_gemini_completion(full_prompt, model='gemini-2.5-pro', max_tokens=max_tokens)


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
