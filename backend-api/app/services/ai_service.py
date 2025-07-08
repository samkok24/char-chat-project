"""
AI 서비스 - Gemini, Claude API 통합
"""

import asyncio
import json
import logging
from typing import Dict, List, Optional, Any
from datetime import datetime
import aiohttp
import google.generativeai as genai
import anthropic
from anthropic import AsyncAnthropic

from app.core.config import settings

logger = logging.getLogger(__name__)


class AIService:
    """AI 서비스 - 다중 AI 모델 지원"""
    
    def __init__(self):
        # Gemini 설정
        if settings.GEMINI_API_KEY:
            genai.configure(api_key=settings.GEMINI_API_KEY)
            self.gemini_model = genai.GenerativeModel('gemini-1.5-flash')
        else:
            self.gemini_model = None
            logger.warning("Gemini API 키가 설정되지 않았습니다.")
        
        # Claude 설정
        if settings.CLAUDE_API_KEY:
            self.claude_client = AsyncAnthropic(api_key=settings.CLAUDE_API_KEY)
        else:
            self.claude_client = None
            logger.warning("Claude API 키가 설정되지 않았습니다.")
        
        # 기본 모델 설정
        self.default_chat_model = "gemini"  # 채팅용 기본 모델
        self.default_story_model = "claude"  # 스토리 생성용 기본 모델

    async def generate_character_response(
        self,
        character_name: str,
        character_description: str,
        character_personality: str,
        conversation_history: List[Dict[str, str]],
        user_message: str,
        model: str = None
    ) -> str:
        """캐릭터 응답 생성"""
        
        if not model:
            model = self.default_chat_model
        
        # 캐릭터 시스템 프롬프트 생성
        system_prompt = self._create_character_system_prompt(
            character_name, character_description, character_personality
        )
        
        # 대화 히스토리를 포함한 프롬프트 생성
        conversation_prompt = self._create_conversation_prompt(
            conversation_history, user_message
        )
        
        try:
            if model == "gemini" and self.gemini_model:
                return await self._generate_with_gemini(
                    system_prompt + "\n\n" + conversation_prompt
                )
            elif model == "claude" and self.claude_client:
                return await self._generate_with_claude(
                    conversation_prompt, system_prompt
                )
            else:
                # 폴백: 사용 가능한 모델로 시도
                if self.gemini_model:
                    return await self._generate_with_gemini(
                        system_prompt + "\n\n" + conversation_prompt
                    )
                elif self.claude_client:
                    return await self._generate_with_claude(
                        conversation_prompt, system_prompt
                    )
                else:
                    raise Exception("사용 가능한 AI 모델이 없습니다.")
                    
        except Exception as e:
            logger.error(f"캐릭터 응답 생성 실패: {str(e)}")
            return f"{character_name}: 죄송해요, 지금은 응답하기 어려워요. 잠시 후 다시 시도해주세요."

    async def generate_text(
        self,
        prompt: str,
        system_prompt: str = "",
        temperature: float = 0.7,
        max_tokens: int = 1000,
        model: str = None
    ) -> str:
        """일반 텍스트 생성"""
        
        if not model:
            model = self.default_story_model
        
        try:
            if model == "gemini" and self.gemini_model:
                full_prompt = f"{system_prompt}\n\n{prompt}" if system_prompt else prompt
                return await self._generate_with_gemini(full_prompt, temperature, max_tokens)
            elif model == "claude" and self.claude_client:
                return await self._generate_with_claude(prompt, system_prompt, temperature, max_tokens)
            else:
                # 폴백
                if self.claude_client:
                    return await self._generate_with_claude(prompt, system_prompt, temperature, max_tokens)
                elif self.gemini_model:
                    full_prompt = f"{system_prompt}\n\n{prompt}" if system_prompt else prompt
                    return await self._generate_with_gemini(full_prompt, temperature, max_tokens)
                else:
                    raise Exception("사용 가능한 AI 모델이 없습니다.")
                    
        except Exception as e:
            logger.error(f"텍스트 생성 실패: {str(e)}")
            raise Exception(f"AI 텍스트 생성 중 오류가 발생했습니다: {str(e)}")

    async def generate_image_prompt(
        self,
        character_description: str,
        style: str = "anime",
        additional_details: str = ""
    ) -> str:
        """이미지 생성용 프롬프트 생성"""
        
        prompt = f"""
캐릭터 설명: {character_description}
스타일: {style}
추가 세부사항: {additional_details}

위 정보를 바탕으로 이미지 생성 AI(Imagen, DALL-E 등)에 사용할 수 있는 
영어 프롬프트를 생성해주세요. 다음 형식으로 작성하세요:

- 캐릭터의 외모 특징을 구체적으로 묘사
- 스타일과 분위기 지정
- 고품질 이미지를 위한 키워드 포함
- 100단어 이내로 간결하게

예시: "A beautiful anime girl with long silver hair and blue eyes, wearing a magical dress, fantasy style, high quality, detailed, masterpiece"
"""
        
        try:
            response = await self.generate_text(
                prompt=prompt,
                system_prompt="당신은 이미지 생성 프롬프트 전문가입니다. 영어로 간결하고 효과적인 프롬프트를 생성하세요.",
                temperature=0.7,
                max_tokens=200
            )
            return response.strip()
        except Exception as e:
            logger.error(f"이미지 프롬프트 생성 실패: {str(e)}")
            return f"A {style} style character, {character_description}, high quality, detailed"

    def _create_character_system_prompt(
        self, 
        name: str, 
        description: str, 
        personality: str
    ) -> str:
        """캐릭터 시스템 프롬프트 생성"""
        return f"""당신은 '{name}'라는 AI 캐릭터입니다.

캐릭터 설정:
- 이름: {name}
- 설명: {description}
- 성격: {personality}

대화 규칙:
1. 항상 {name}의 성격과 설정에 맞게 응답하세요
2. 자연스럽고 일관된 캐릭터를 유지하세요
3. 사용자와 친근하게 대화하되, 캐릭터의 개성을 잃지 마세요
4. 응답은 한국어로 하되, 캐릭터에 맞는 말투를 사용하세요
5. 너무 길지 않게 2-3문장으로 응답하세요
6. 부적절한 내용에는 캐릭터답게 거절하세요

지금부터 {name}가 되어 대화해주세요."""

    def _create_conversation_prompt(
        self, 
        history: List[Dict[str, str]], 
        user_message: str
    ) -> str:
        """대화 프롬프트 생성"""
        prompt = "대화 기록:\n"
        
        # 최근 10개 메시지만 포함 (토큰 제한 고려)
        recent_history = history[-10:] if len(history) > 10 else history
        
        for msg in recent_history:
            role = "사용자" if msg.get("role") == "user" else "캐릭터"
            content = msg.get("content", "")
            prompt += f"{role}: {content}\n"
        
        prompt += f"사용자: {user_message}\n캐릭터:"
        return prompt

    async def _generate_with_gemini(
        self, 
        prompt: str, 
        temperature: float = 0.7, 
        max_tokens: int = 1000
    ) -> str:
        """Gemini로 텍스트 생성"""
        try:
            # Gemini 생성 설정
            generation_config = genai.types.GenerationConfig(
                temperature=temperature,
                max_output_tokens=max_tokens,
                top_p=0.8,
                top_k=40
            )
            
            # 비동기 생성
            response = await asyncio.to_thread(
                self.gemini_model.generate_content,
                prompt,
                generation_config=generation_config
            )
            
            if response.text:
                return response.text.strip()
            else:
                raise Exception("Gemini에서 응답을 생성하지 못했습니다.")
                
        except Exception as e:
            logger.error(f"Gemini 생성 실패: {str(e)}")
            raise Exception(f"Gemini API 오류: {str(e)}")

    async def _generate_with_claude(
        self, 
        prompt: str, 
        system_prompt: str = "", 
        temperature: float = 0.7, 
        max_tokens: int = 1000
    ) -> str:
        """Claude로 텍스트 생성"""
        try:
            messages = [{"role": "user", "content": prompt}]
            
            kwargs = {
                "model": "claude-3-5-sonnet-20241022",
                "max_tokens": max_tokens,
                "temperature": temperature,
                "messages": messages
            }
            
            if system_prompt:
                kwargs["system"] = system_prompt
            
            response = await self.claude_client.messages.create(**kwargs)
            
            if response.content and len(response.content) > 0:
                return response.content[0].text.strip()
            else:
                raise Exception("Claude에서 응답을 생성하지 못했습니다.")
                
        except Exception as e:
            logger.error(f"Claude 생성 실패: {str(e)}")
            raise Exception(f"Claude API 오류: {str(e)}")

    async def get_available_models(self) -> Dict[str, bool]:
        """사용 가능한 모델 확인"""
        return {
            "gemini": self.gemini_model is not None,
            "claude": self.claude_client is not None
        }

    async def health_check(self) -> Dict[str, Any]:
        """AI 서비스 상태 확인"""
        status = {
            "gemini": {"available": False, "status": "not_configured"},
            "claude": {"available": False, "status": "not_configured"}
        }
        
        # Gemini 상태 확인
        if self.gemini_model:
            try:
                test_response = await asyncio.to_thread(
                    self.gemini_model.generate_content,
                    "안녕하세요",
                    generation_config=genai.types.GenerationConfig(max_output_tokens=10)
                )
                if test_response.text:
                    status["gemini"] = {"available": True, "status": "healthy"}
                else:
                    status["gemini"] = {"available": False, "status": "error"}
            except Exception as e:
                status["gemini"] = {"available": False, "status": f"error: {str(e)}"}
        
        # Claude 상태 확인
        if self.claude_client:
            try:
                test_response = await self.claude_client.messages.create(
                    model="claude-3-5-sonnet-20241022",
                    max_tokens=10,
                    messages=[{"role": "user", "content": "안녕하세요"}]
                )
                if test_response.content:
                    status["claude"] = {"available": True, "status": "healthy"}
                else:
                    status["claude"] = {"available": False, "status": "error"}
            except Exception as e:
                status["claude"] = {"available": False, "status": f"error: {str(e)}"}
        
        return status


# AI 서비스 인스턴스
ai_service = AIService()

