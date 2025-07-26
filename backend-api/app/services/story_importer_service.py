"""
스토리 분석과 관련된 비즈니스 로직
"""
from app.schemas.story_importer import StoryAnalysisResponse
from app.services.ai_service import get_ai_completion, AIModel
import json

async def analyze_story_from_text(content: str, ai_model: AIModel) -> StoryAnalysisResponse:
    """
    AI LLM을 사용하여 스토리를 분석합니다.
    """
    
    system_prompt = """
    당신은 천재적인 소설 분석가이자 스토리 작가입니다. 당신의 임무는 주어진 텍스트에서 핵심적인 요소들을 추출하여, 지정된 JSON 형식으로 완벽하게 출력하는 것입니다. 다른 어떤 설명도 없이, 오직 JSON 객체만 반환해야 합니다.
    """
    
    user_prompt = f"""
    다음 소설 텍스트를 분석하여 아래의 규칙에 따라 JSON을 생성해 주세요.

    [규칙]
    1.  **worldview**: 이야기의 배경이 되는 세계관, 시대, 주요 설정, 분위기를 3~4 문장으로 요약합니다.
    2.  **characters**: 소설에 등장하는 주요 인물 2~4명을 추출합니다.
        - **name**: 캐릭터의 이름입니다.
        - **description**: 캐릭터의 외형, 성격, 역할을 1~2 문장으로 요약합니다.
        - **social_tendency**: 캐릭터가 다른 인물과 상호작용하는 방식을 분석하여, '내향적/비사교적'이면 0, '외향적/사교적'이면 100에 가까운 정수 점수로 평가합니다.
    3.  **plot**: 이야기의 핵심적인 기-승-전-결 구조를 한 문장으로 요약합니다.

    [소설 텍스트]
    {content}

    [JSON 출력]
    """

    # 프롬프트를 하나로 조합 (Gemini는 단일 텍스트 프롬프트도 잘 처리합니다)
    full_prompt = f"{system_prompt}\n\n{user_prompt}"

    try:
        # 범용 AI 서비스 호출
        ai_response_str = await get_ai_completion(
            prompt=full_prompt,
            model=ai_model, # 사용할 모델을 명시
            temperature=0.3, # 창의성보다는 정확성에 초점
            max_tokens=4096
        )
        
        # Gemini가 반환한 텍스트에서 JSON 부분만 정리
        # 모델이 응답 앞뒤에 ```json ... ``` 같은 마크다운을 붙이는 경우가 있기 때문입니다.
        if "```json" in ai_response_str:
            clean_json_str = ai_response_str.split("```json\n")[1].split("```")[0]
        else:
            clean_json_str = ai_response_str

        # Pydantic 모델로 파싱하여 데이터 유효성 검증
        analysis_result = StoryAnalysisResponse.parse_raw(clean_json_str)
        return analysis_result
        
    except json.JSONDecodeError:
        print(f"AI 응답 파싱 실패: 유효하지 않은 JSON 형식 - {clean_json_str}")
        raise ValueError("AI로부터 유효한 분석 결과를 받지 못했습니다.")
    except Exception as e:
        print(f"스토리 분석 중 오류 발생: {e}")
        raise