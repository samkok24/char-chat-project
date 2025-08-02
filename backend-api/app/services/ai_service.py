"""
AI 모델과의 상호작용을 담당하는 서비스
- 현재는 Gemini, Claude, OpenAI 모델을 지원 (향후 확장 가능)
- 각 모델의 응답을 일관된 형식으로 반환하는 것을 목표로 함
"""
import google.generativeai as genai
import anthropic  # Claude API 라이브러리
from typing import Literal
from app.core.config import settings

# --- Gemini AI 설정 ---
genai.configure(api_key=settings.GEMINI_API_KEY)
claude_client = anthropic.AsyncAnthropic(api_key=settings.CLAUDE_API_KEY)

async def get_gemini_completion(prompt: str, temperature: float = 0.7, max_tokens: int = 2048) -> str:
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
        model = genai.GenerativeModel('gemini-2.5-pro')
        
        # GenerationConfig를 사용하여 JSON 모드 등을 활성화할 수 있음 (향후 확장)
        generation_config = genai.types.GenerationConfig(
            temperature=temperature,
            max_output_tokens=max_tokens
            # response_mime_type="application/json" # Gemini 1.5 Pro의 JSON 모드
        )
        
        response = await model.generate_content_async(
            prompt,
            generation_config=generation_config
        )
        return response.text
    except Exception as e:
        # 실제 운영 환경에서는 더 상세한 로깅 및 예외 처리가 필요
        print(f"Gemini API 호출 중 오류 발생: {e}")
        # 프론트엔드에 전달할 수 있는 일반적인 오류 메시지를 반환하거나,
        # 별도의 예외를 발생시켜 API 레벨에서 처리하도록 할 수 있습니다.
        raise ValueError("AI 모델 호출에 실패했습니다.")

async def get_claude_completion(
    prompt: str,
    temperature: float = 0.7,
    max_tokens: int = 2048
) -> str:
    """
    주어진 프롬프트로 Anthropic Claude 모델을 호출하여 응답을 반환합니다.
    Claude SDK가 상황에 따라 Message 객체 대신 str·dict를
    돌려주는 경우가 있어, 타입별로 안전하게 처리한다.
    """
    try:
        message = await claude_client.messages.create(
            model="claude-3-5-sonnet-20240620",
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

# --- 통합 AI 응답 함수 ---
AIModel = Literal["gemini", "claude"]

async def get_ai_completion(
    prompt: str,
    model: AIModel = "gemini",
    temperature: float = 0.7,
    max_tokens: int = 2048
) -> str:
    """
    지정된 AI 모델을 호출하여 응답을 반환하는 통합 함수입니다.
    """
    if model == "gemini":
        return await get_gemini_completion(prompt, temperature, max_tokens)
    elif model == "claude":
        return await get_claude_completion(prompt, temperature, max_tokens)
    else:
        raise ValueError(f"지원하지 않는 모델입니다: {model}")


# --- 기존 채팅 관련 함수 ---
async def get_ai_chat_response(character_prompt: str, user_message: str, history: list) -> str:
    # 이 부분은 향후 get_gemini_completion 등을 사용하도록 리팩토링될 수 있습니다.
    model = genai.GenerativeModel('gemini-2.5-pro')
    chat = model.start_chat(history=history)
    response = await chat.send_message_async(user_message)
    return response.text

