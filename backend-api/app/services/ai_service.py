"""
AI 모델과의 상호작용을 담당하는 서비스
- 현재는 Gemini, Claude, OpenAI 모델을 지원 (향후 확장 가능)
- 각 모델의 응답을 일관된 형식으로 반환하는 것을 목표로 함
"""
import google.generativeai as genai
import anthropic  # Claude API 라이브러리
from typing import Literal, Optional, AsyncGenerator
from app.core.config import settings

# --- Gemini AI 설정 ---
genai.configure(api_key=settings.GEMINI_API_KEY)
claude_client = anthropic.AsyncAnthropic(api_key=settings.CLAUDE_API_KEY)

# OpenAI 설정
import openai
openai.api_key = settings.OPENAI_API_KEY

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
            generation_config=generation_config
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

        # 안전 정책에 의해 차단되었을 가능성 → 우회/폴백 메시지 또는 다른 모델로 폴백
        # 여기서는 사용자 경험을 위해 간단한 안내 메시지로 대응
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
    max_tokens: int = 1024,
    model: str = "claude-3-5-sonnet-20241022"
) -> str:
    """
    주어진 프롬프트로 Anthropic Claude 모델을 호출하여 응답을 반환합니다.
    Claude SDK가 상황에 따라 Message 객체 대신 str·dict를
    돌려주는 경우가 있어, 타입별로 안전하게 처리한다.
    """
    try:
        message = await claude_client.messages.create(
            model=model,
            max_tokens=max_tokens,
            temperature=temperature,
            messages=[{"role": "user", "content": prompt}],
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
        model_name = sub_model or 'claude-3-5-sonnet-20241022'
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
        model_name = sub_model or 'claude-3-5-sonnet-20240620'
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
    base_max_tokens = 1024
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
        claude_default = 'claude-3-5-sonnet-20241022'
        claude_mapping = {
            # UI 표기 → 실제 모델 ID
            'claude-4-sonnet': claude_default,            # 존재하지 않는 가상 표기 → 최신 3.5 Sonnet으로 폴백
            'claude-3.7-sonnet': claude_default,          # 최신 3.7가 도입되기 전 호환 표기 → 폴백
            'claude-3.5-sonnet-v2': claude_default,       # 가상 v2 표기 → 폴백
            # 이미 실제 ID가 넘어오는 경우도 허용
            'claude-3-5-sonnet-20241022': 'claude-3-5-sonnet-20241022',
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

