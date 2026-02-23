import os
import google.generativeai as genai
import openai
import anthropic
from dotenv import load_dotenv

# 환경 변수 로드
load_dotenv()

class AIService:
    def __init__(self):
        # Gemini 설정
        self.gemini_api_key = os.getenv('GEMINI_API_KEY')
        if self.gemini_api_key:
            genai.configure(api_key=self.gemini_api_key)
            self.gemini_model = genai.GenerativeModel('gemini-pro')
        
        # OpenAI 설정
        self.openai_api_key = os.getenv('OPENAI_API_KEY')
        if self.openai_api_key:
            self.openai_client = openai.OpenAI(api_key=self.openai_api_key)
        
        # Claude 설정
        self.claude_api_key = os.getenv('CLAUDE_API_KEY')
        if self.claude_api_key:
            self.claude_client = anthropic.Anthropic(api_key=self.claude_api_key)
    
    def generate_character_response(self, character_name, character_description, user_message, chat_history=None, provider='gemini'):
        """캐릭터 응답 생성"""
        try:
            # 캐릭터 프롬프트 구성
            system_prompt = f"""당신은 '{character_name}'라는 AI 캐릭터입니다.
캐릭터 설명: {character_description}

이 캐릭터의 성격과 특징에 맞게 자연스럽고 일관성 있는 대화를 해주세요.
사용자와 친근하게 대화하되, 캐릭터의 개성을 잘 드러내주세요.
응답은 한국어로 해주세요."""

            # 채팅 기록 포함
            conversation = ""
            if chat_history:
                for msg in chat_history[-5:]:  # 최근 5개 메시지만 포함
                    role = "사용자" if msg.get('sender_type') == 'user' else character_name
                    conversation += f"{role}: {msg.get('content', '')}\n"
            
            conversation += f"사용자: {user_message}\n{character_name}:"
            
            full_prompt = f"{system_prompt}\n\n대화 내용:\n{conversation}"
            
            if provider == 'gemini' and self.gemini_api_key:
                return self._generate_with_gemini(full_prompt)
            elif provider == 'openai' and self.openai_api_key:
                return self._generate_with_openai(system_prompt, conversation)
            elif provider == 'claude' and self.claude_api_key:
                return self._generate_with_claude(system_prompt, conversation)
            else:
                # 기본 응답
                return f"안녕하세요! 저는 {character_name}입니다. '{user_message}'에 대한 응답을 준비 중입니다. (AI 서비스 연결 중...)"
                
        except Exception as e:
            print(f"AI 응답 생성 오류: {e}")
            return f"죄송합니다. 현재 응답을 생성할 수 없습니다. 잠시 후 다시 시도해주세요."
    
    def _generate_with_gemini(self, prompt):
        """Gemini로 응답 생성"""
        try:
            response = self.gemini_model.generate_content(prompt)
            return response.text
        except Exception as e:
            print(f"Gemini 오류: {e}")
            raise e
    
    def _generate_with_openai(self, system_prompt, conversation):
        """OpenAI로 응답 생성"""
        try:
            response = self.openai_client.chat.completions.create(
                model="gpt-3.5-turbo",
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": conversation}
                ],
                max_tokens=500,
                temperature=0.7
            )
            return response.choices[0].message.content
        except Exception as e:
            print(f"OpenAI 오류: {e}")
            raise e
    
    def _generate_with_claude(self, system_prompt, conversation):
        """Claude로 응답 생성"""
        try:
            response = self.claude_client.messages.create(
                model="claude-3-haiku-20240307",
                max_tokens=500,
                system=system_prompt,
                messages=[
                    {"role": "user", "content": conversation}
                ]
            )
            return response.content[0].text
        except Exception as e:
            print(f"Claude 오류: {e}")
            raise e
    
    def generate_story(self, keywords, genre="판타지", length="medium", provider='gemini'):
        """스토리 생성"""
        try:
            prompt = f"""다음 키워드들을 사용하여 {genre} 장르의 창의적인 스토리를 작성해주세요.

키워드: {', '.join(keywords) if isinstance(keywords, list) else keywords}
장르: {genre}
길이: {length}

스토리는 흥미진진하고 독창적이어야 하며, 주어진 키워드들이 자연스럽게 포함되어야 합니다.
한국어로 작성해주세요."""

            if provider == 'gemini' and self.gemini_api_key:
                return self._generate_with_gemini(prompt)
            elif provider == 'openai' and self.openai_api_key:
                return self._generate_with_openai("당신은 창의적인 스토리 작가입니다.", prompt)
            elif provider == 'claude' and self.claude_api_key:
                return self._generate_with_claude("당신은 창의적인 스토리 작가입니다.", prompt)
            else:
                return f"키워드 '{keywords}'를 바탕으로 한 {genre} 스토리를 생성 중입니다... (AI 서비스 연결 중)"
                
        except Exception as e:
            print(f"스토리 생성 오류: {e}")
            return "죄송합니다. 현재 스토리를 생성할 수 없습니다. 잠시 후 다시 시도해주세요."

# 전역 AI 서비스 인스턴스
ai_service = AIService()

