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
import base64

logger = logging.getLogger(__name__)

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

# OpenAI 설정
import openai
openai.api_key = settings.OPENAI_API_KEY


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
        
        # 이미지 다운로드 및 base64 인코딩
        response = requests.get(image_url, timeout=10)
        image_data = base64.b64encode(response.content).decode('utf-8')
        
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
                    max_tokens=1000,
                    model='claude-3-5-sonnet-20241022',
                    image_base64=image_data
                )
                
                # JSON 추출
                if '```json' in txt:
                    txt = txt.split('```json')[1].split('```')[0].strip()
                elif '```' in txt:
                    txt = txt.split('```')[1].split('```')[0].strip()
                    
                data = json.loads(txt)
                if isinstance(data, dict):
                    logging.info("Claude Vision tagging successful")
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
        
        # 이미지 다운로드 및 base64 인코딩
        response = requests.get(image_url, timeout=10)
        image_data = base64.b64encode(response.content).decode('utf-8')
        
        schema_prompt = (
            "이미지를 분석해 아래 스키마의 JSON으로만 응답하세요.\n"
            "- 상상/추측 금지, 보이는 단서 위주. 암시는 narrative_axes에서 'hint'로 간단히.\n"
            "- is_selfie: 셀카인지 판단 (거울 셀카, 팔 뻗어 찍기, 셀카봉 등 모두 포함)\n"
            "- person_count: 보이는 인물 수 (0=인물없음)\n"
            "스키마: {\n"
            "  subjects:[{role?:string, age_range?:string, gender?:string, attire?:string, emotion?:string, pose?:string}],\n"
            "  relations:[{a_idx:int, b_idx:int, relation:string, evidence:string}],\n"
            "  camera:{angle?:string, distance?:string, lens_hint?:string, is_selfie?:boolean},\n"
            "  palette:[string], genre_cues:[string],\n"
            "  narrative_axes:{desire?:string, conflict?:string, stakes?:string},\n"
            "  tone:{mood_words?:[string], pace?:string},\n"
            "  person_count:int\n"
            "}"
        )
        
        # Claude Vision 시도
        if model == 'claude':
            try:
                txt = await get_claude_completion(
                    schema_prompt,
                    max_tokens=800,
                    model='claude-3-5-sonnet-20241022',
                    image_base64=image_data
                )
                
                # JSON 추출
                if '```json' in txt:
                    txt = txt.split('```json')[1].split('```')[0].strip()
                elif '```' in txt:
                    txt = txt.split('```')[1].split('```')[0].strip()
                    
                data = json.loads(txt)
                if isinstance(data, dict):
                    logging.info("Claude Vision narrative context successful")
                    return data
            except Exception as e:
                logging.error(f"Claude Vision narrative context failed: {e}")
        
        # Gemini 폴백
        try:
            txt = await get_gemini_completion(schema_prompt + f"\nimage_url: {image_url}", max_tokens=600, model='gemini-2.5-pro')
            data = json.loads(txt)
            if isinstance(data, dict):
                return data
        except Exception:
            pass
        return {}
    except Exception:
        return {}

def build_image_grounding_block(tags: dict, pov: str | None = None, style_prompt: str | None = None, ctx: dict | None = None, username: str | None = None) -> str:
    # 시점 자동 결정 로직
    if ctx and not pov:
        person_count = ctx.get('person_count', 0)
        camera = ctx.get('camera', {})
        is_selfie = camera.get('is_selfie', False)
        
        if person_count == 0:
            # 인물이 없으면 1인칭
            pov = "1인칭 '나'"
        elif is_selfie:
            # 셀카면 1인칭
            pov = "1인칭 '나'"
        else:
            # 그 외는 3인칭
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

    lines = [
        "[고정 조건 - 이미지 그라운딩]",
        ("[최우선 사실 - 이미지 내 텍스트] " + "; ".join(in_texts)) if in_texts else None,
        ("[수치/단위 문구] " + "; ".join(numeric_phrases)) if numeric_phrases else None,
        f"장소: {place}" if place else None,
        f"오브젝트: {objects}" if objects else None,
        f"조명/시간대: {lighting}" if lighting else None,
        f"날씨: {weather}" if weather else None,
        f"무드: {mood}" if mood else None,
        f"주요 색상: {colors}" if colors else None,
        f"질감/재질: {textures}" if textures else None,
        f"암시되는 소리: {sounds}" if sounds else None,
        f"암시되는 냄새: {smells}" if smells else None,
        f"체감 온도: {temperature}" if temperature else None,
        f"움직임/동적 요소: {movement}" if movement else None,
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

        response = await get_claude_completion(prompt, temperature=0.7)
        return response.strip()[:200]  # 최대 200자
    except Exception as e:
        logger.error(f"Failed to generate image prompt: {e}")
        return "A scene from a Korean webnovel, cinematic lighting, emotional atmosphere"

async def write_story_from_image_grounded(image_url: str, user_hint: str = "", pov: str | None = None, style_prompt: str | None = None,
                                          story_mode: str | None = None, username: str | None = None,
                                          model: Literal["gemini","claude","gpt"] = "gemini", sub_model: str | None = "gemini-2.5-pro") -> str:
    """이미지 태깅→고정조건 프롬프트→집필(자가검증은 1패스 내장)"""
    # Stage-1 lightweight grounding (fallback-friendly)
    kw2, caption = stage1_keywords_from_image_url(image_url)
    # Stage-2 advanced tags (Claude Vision 우선)
    tags = await tag_image_keywords(image_url, model='claude')
    ctx = await extract_image_narrative_context(image_url, model='claude')
    # 스냅 모드에서는 개인정보 보호를 위해 이름 주입 금지
    block = build_image_grounding_block(
        tags,
        pov=pov,
        style_prompt=style_prompt,
        ctx=ctx,
        username=None if story_mode == "snap" else username
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
    # 이미지 내 텍스트/수치 문구를 우선 포함
    for t in (tags.get('numeric_phrases') or [])[:2]:
        required_tokens.append(str(t))
    for t in (tags.get('in_image_text') or [])[:2]:
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
            "당신은 일상의 순간을 포착하는 에세이스트다. 이미지의 평범한 순간을 특별하게 만든다.\n"
            "규칙: 200-300자 분량, SNS 피드 스타일, 공감가는 일상 언어, 따뜻하거나 위트있게.\n"
            "중요: 오글거리지 않게, 과장하지 않게, 진솔하고 담백하게.\n"
            "독자가 '나도 그런 적 있어'라고 공감할 수 있는 순간을 포착하라."
            + pov_instruction
        )
        # 인스타 공유 효능감 강화 지시
        sys_instruction += (
            "\n특기: 인스타 캡션처럼 자연스럽고 간결하게. 과장 금지, 일상 감성 유지."
            "\n스타일: 짧은 호흡(문장 평균 10~18자), 쉼표 최소, 마침표 자주."
            "\n문단: 1~2문장 단락, 줄바꿈으로 리듬 살리기."
            "\n어휘: 담백하고 위트 있게. 해시태그/이모지 사용 금지."
            "\n톤: 20~30대 여성 취향의 소소한 위안/힐링 느낌."
            "\n개인정보: 사람 이름(고유명) 사용 금지. 인물 지칭은 '그' 또는 '그녀'만 사용."
        )
    elif story_mode == "genre":
        sys_instruction = (
            "당신은 20년차 장르/웹소설 작가다. 이미지를 장르적 상상력으로 재해석한다.\n"
            "규칙: 600-900자 분량, 몰입감 있는 전개, 긴장감 있는 묘사, 장르 관습 준수.\n"
            "중요: 첫 문장부터 독자를 사로잡고, 다음이 궁금해지는 여운을 남겨라.\n"
            "독자가 그 세계에 빠져들 수 있는 생생한 장면을 만들어라."
            + pov_instruction
        )
        # 하이라이트 후킹 강화 지시
        sys_instruction += (
            "\n특기: 첫 2문장에 강력한 후킹. 시각적 장면성이 뚜렷하게 드러나게 써라."
            "\n스타일: 웹소설 톤. 짧은 호흡(문장 평균 12~20자), 쉼표 최소, 빠른 템포."
            "\n대사: 전체의 40~60% 비중. 줄바꿈을 자주 사용해 박자감 유지."
            "\n문단: 1~3문장 단락. 장황한 비유/설명체 금지. show-don't-tell."
        )
    else:
        sys_instruction = (
            "당신은 20년차 장르/웹소설 작가다. 이미지와 정확히 맞닿은 장면을 쓴다.\n"
            "규칙: 메타발언 금지, show-don't-tell, 자연스러운 대사 포함, 시점/문체 일관.\n"
            "중요: 이미지에서 추출된 모든 감각적 정보(색상, 질감, 소리, 냄새, 온도)를 활용해 생생한 장면을 만들어라.\n"
            "독자가 그 공간에 직접 있는 듯한 몰입감을 제공하라."
            + pov_instruction
        )
    
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
    
    # 스토리 모드별 글자 수 설정
    if story_mode == "snap":
        length_guide = "200~300자"
        extra_instructions = (
            "\n[추가 지시]\n"
            "- 일상의 작은 순간을 특별하게 포착하라\n"
            "- 독자가 공감할 수 있는 감정을 담아라\n"
            "- 과장하지 말고 진솔하게 써라\n"
            "- 짧지만 여운이 남는 마무리"
        )
    elif story_mode == "genre":
        length_guide = "1000~1200자"
        extra_instructions = (
            "\n[추가 지시]\n"
            "- 첫 문장부터 독자의 시선을 사로잡아라\n"
            "- 오감을 모두 활용하여 공간감을 살려라\n"
            "- 인물이 있다면 그들의 미묘한 감정과 관계를 드러내라\n"
            "- 다음 장면이 궁금해지도록 여운을 남겨라"
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
    
    grounding_text = (
        f"[지시]\n아래 고정 조건을 반드시 반영하여 첫 장면({length_guide})을 한국어로 작성하라.\n\n"
        f"{block}\n\n"
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

    async def _gemini_mm(url: str) -> str:
        try:
            img = _http_get_bytes(url)
            mime, _ = mimetypes.guess_type(url)
            mime = mime or "image/jpeg"
            mm = genai.GenerativeModel(sub_model or 'gemini-2.5-pro', system_instruction=sys_instruction)
            cfg = genai.types.GenerationConfig(temperature=0.7, max_output_tokens=1200)
            resp = await mm.generate_content_async([
                {"mime_type": mime, "data": img},
                grounding_text
            ], generation_config=cfg, safety_settings=DEFAULT_SAFETY_OPEN)
            if hasattr(resp, 'text') and resp.text:
                logging.info(f"Gemini MM ok: bytes={len(img)} mime={mime} model={sub_model or 'gemini-2.5-pro'}")
                return resp.text
            # soft retry: finish_reason=2 또는 text 없음
            try:
                cand0 = (getattr(resp, 'candidates', []) or [None])[0]
                finish = getattr(cand0, 'finish_reason', None)
            except Exception:
                finish = None
            soft_sys = sys_instruction + "\n(안전한 표현을 사용하여 부드럽고 절제된 어휘로 작성)"
            mm2 = genai.GenerativeModel(sub_model or 'gemini-2.5-pro', system_instruction=soft_sys)
            cfg2 = genai.types.GenerationConfig(temperature=0.3, max_output_tokens=1200)
            resp2 = await mm2.generate_content_async([
                {"mime_type": mime, "data": img},
                grounding_text
            ], generation_config=cfg2, safety_settings=DEFAULT_SAFETY_OPEN)
            if hasattr(resp2, 'text') and resp2.text:
                logging.info("Gemini MM retry ok")
                return resp2.text
        except Exception as e:
            logging.warning(f"Gemini MM fail: {e}")
        return ""

    async def _claude_mm(url: str) -> str:
        try:
            # 이미지를 직접 다운로드하여 base64로 인코딩
            img_bytes = _http_get_bytes(url)
            # MIME 타입 추정: URL 확장자 → 실패 시 바이너리 시그니처로 보강
            mime, _ = mimetypes.guess_type(url)
            if not mime:
                try:
                    import imghdr
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
            
            message = await claude_client.messages.create(
                model='claude-sonnet-4-20250514',
                max_tokens=1800,
                temperature=0.8,
                system=sys_instruction,  # 시스템 프롬프트 별도 전달
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
                    # 재시도 with stronger prompt
                    retry_prompt = (
                        "이미지를 보고 즉시 이야기를 시작하세요.\n"
                        "첫 문장부터 소설이어야 합니다. 분석이나 평가는 절대 금지.\n"
                        "예시: '카페 창가에 기댄 그녀는...'\n\n"
                        f"{grounding_text}"
                    )
                    retry_msg = await claude_client.messages.create(
                        model='claude-sonnet-4-20250514',
                        max_tokens=1800,
                        temperature=0.8,
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

    # [임시] GPT와 Gemini 비활성화 - Claude Vision만 사용
    text = await _claude_mm(image_url)
    # if not text:
    #     text = await _gemini_mm(image_url)
    if not text:
        # 최종 폴백(텍스트-only) - Claude 사용
        text = await get_ai_completion("[텍스트 폴백]\n" + grounding_text, model="claude", sub_model="claude-sonnet-4-20250514", max_tokens=1800)
    # 자가 검증 스킵 (Claude Vision은 이미 충분히 정확함)
    # 필요시 간단한 체크만
    if not text or len(text) < 100:
        # 텍스트가 너무 짧거나 없으면 재시도
        text = await get_ai_completion(
            f"{sys_instruction}\n\n{grounding_text}", 
            model="claude", 
            sub_model="claude-sonnet-4-20250514", 
            max_tokens=1800
        )

    # 이미지 내 텍스트/수치 문구 커버리지 검증 및 1회 보정
    try:
        must_phrases: list[str] = []
        for p in (tags.get('numeric_phrases') or [])[:2]:
            if isinstance(p, str) and p.strip():
                must_phrases.append(p.strip())
        for p in (tags.get('in_image_text') or [])[:2]:
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
                sub_model="claude-sonnet-4-20250514",
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
    model: str = "claude-sonnet-4-20250514",
    image_base64: str | None = None
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
                        "media_type": "image/jpeg",
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
            return message.content[0].text

        # 2) 어떤 이유로 문자열만 돌려준 경우
        if isinstance(message, str):
            return message

        # 3) dict 형태(HTTP 응답 JSON)로 돌려준 경우
        if isinstance(message, dict):
            # {'content': [{'text': '...'}], ...} 형태를 기대
            content = message.get("content")
            if isinstance(content, list) and content and isinstance(content[0], dict):
                return content[0].get("text", "")
            return str(message)

        # 그 밖의 예상치 못한 타입은 문자열로 강제 변환
        return str(message)

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
        model_name = sub_model or 'claude-sonnet-4-20250514'
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
        model_name = sub_model or 'claude-sonnet-4-20250514'
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
    
    # 프롬프트와 사용자 메시지 결합
    full_prompt = f"{character_prompt}\n\nUser: {user_message}\nAssistant:"

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
        claude_default = 'claude-sonnet-4-20250514'
        claude_mapping = {
            # UI 표기 → 실제 모델 ID (모두 최신 Sonnet 4로 통일)
            'claude-4-sonnet': claude_default,
            'claude-3.7-sonnet': claude_default,
            'claude-3.5-sonnet-v2': claude_default,
            'claude-3-5-sonnet-20241022': claude_default,
            'claude-sonnet-4-20250514': 'claude-sonnet-4-20250514',
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

