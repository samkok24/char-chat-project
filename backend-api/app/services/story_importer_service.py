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
당신은 천재적인 소설 분석가이자 캐릭터 설계자입니다.
당신의 임무는 주어진 텍스트에서 '세계관/플롯/주요 캐릭터'를 추출하고,
바로 캐릭터 생성 폼에 넣어도 될 정도로 상세한 설정(말투/인사말/예시대화/도입부)을 추가하여
지정된 JSON 형식으로만 반환하는 것입니다.

중요: 설명/마크다운/코드블록 없이 JSON 객체만 반환하세요.
    """.strip()
    
    user_prompt = f"""
    다음 소설 텍스트를 분석하여 아래의 규칙에 따라 JSON을 생성해 주세요.

    [규칙]
    0.  출력은 JSON 객체 1개만. 다른 텍스트 금지.
    1.  모든 문자열은 한국어.
    2.  길이 제한(대략):
        - worldview: 900자 이내
        - plot: 250자 이내
        - characters[].description: 300자 이내
        - characters[].personality: 1200자 이내
        - characters[].speech_style: 600자 이내
        - characters[].greetings[]: 각 200자 이내, 2~3개
        - characters[].example_dialogues[]: 2개, user_message 150자 이내 / character_response 350자 이내
        - characters[].introduction_scenes[]: 1개, content 1200자 이내, secret 500자 이내
    3.  토큰:
        - 필요하면 {{user}}, {{assistant}} 만 사용할 것 (다른 {{...}} 토큰 금지)
    4.  필드 스펙(반드시 아래 키를 사용):
        - worldview: 세계관 요약(3~5문장)
        - plot: 플롯 요약(1~2문장)
        - characters: 2~4명
          - name: 캐릭터 이름
          - description: 한 줄 소개(역할/매력 포함)
          - social_tendency: 0~100 정수
          - personality: 성격/특징/금기/목표(2~6문장)
          - speech_style: 말투(어조/호칭/자주 쓰는 표현)(2~4문장)
          - greetings: 채팅 시작 인사말 후보 2~3개(자연어)
          - user_display_description: 사용자에게 보여줄 짧은 설명(선택)
          - introduction_scenes: 도입부 리스트(객체 키: title/content/secret) 1개(선택)
          - example_dialogues: 예시대화 리스트(객체 키: user_message/character_response) 2개(선택)
          - tags: 태그 3~8개(선택, 단어/짧은 구)

    [소설 텍스트]
    {content}

    [JSON 출력 예시(형식만 참고, 내용은 텍스트에 맞게)]
    {{
      "worldview": "...",
      "plot": "...",
      "characters": [
        {{
          "name": "...",
          "description": "...",
          "social_tendency": 50,
          "personality": "...",
          "speech_style": "...",
          "greetings": ["...", "..."],
          "user_display_description": "...",
          "introduction_scenes": [{{"title":"도입부 1","content":"...","secret":"..."}}],
          "example_dialogues": [{{"user_message":"...","character_response":"..."}}, {{"user_message":"...","character_response":"..."}}],
          "tags": ["...","..."]
        }}
      ]
    }}
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

        # 방어적 보정: LLM 출력 흔들림(타입/길이)을 최소한으로 정리한다.
        def _clip_text(v, max_len: int):
            try:
                s = str(v or "").strip()
            except Exception:
                s = ""
            if not s:
                return None
            return s[:max_len]

        try:
            analysis_result.worldview = _clip_text(getattr(analysis_result, "worldview", ""), 900) or ""
            analysis_result.plot = _clip_text(getattr(analysis_result, "plot", ""), 250) or ""
        except Exception:
            pass

        try:
            chars = getattr(analysis_result, "characters", []) or []
            for c in chars:
                # 문자열 클립
                try:
                    c.name = _clip_text(getattr(c, "name", ""), 100) or (getattr(c, "name", "") or "캐릭터")[:100]
                except Exception:
                    pass
                try:
                    c.description = _clip_text(getattr(c, "description", ""), 300) or (getattr(c, "description", "") or "")[:300]
                except Exception:
                    pass
                try:
                    c.personality = _clip_text(getattr(c, "personality", None), 1200)
                except Exception:
                    pass
                try:
                    c.speech_style = _clip_text(getattr(c, "speech_style", None), 600)
                except Exception:
                    pass
                try:
                    c.user_display_description = _clip_text(getattr(c, "user_display_description", None), 400)
                except Exception:
                    pass

                # greetings: list[str]로 정리 + 최대 3개
                try:
                    gs = getattr(c, "greetings", None)
                    if isinstance(gs, str):
                        gs = [s.strip() for s in gs.splitlines() if s.strip()]
                    if isinstance(gs, list):
                        cleaned = []
                        for item in gs:
                            t = _clip_text(item, 200)
                            if t:
                                cleaned.append(t)
                        c.greetings = cleaned[:3] if cleaned else None
                    else:
                        c.greetings = None
                except Exception:
                    c.greetings = None

                # example_dialogues: 구조 보정 + 최대 2개
                try:
                    ds = getattr(c, "example_dialogues", None)
                    if isinstance(ds, list):
                        cleaned_ds = []
                        for d in ds:
                            if not isinstance(d, dict) and not hasattr(d, "__dict__"):
                                continue
                            um = _clip_text(getattr(d, "user_message", None) if not isinstance(d, dict) else d.get("user_message"), 150)
                            cr = _clip_text(getattr(d, "character_response", None) if not isinstance(d, dict) else d.get("character_response"), 350)
                            if um and cr:
                                cleaned_ds.append({"user_message": um, "character_response": cr})
                        c.example_dialogues = cleaned_ds[:2] if cleaned_ds else None
                    else:
                        c.example_dialogues = None
                except Exception:
                    c.example_dialogues = None

                # introduction_scenes: 구조 보정 + 최대 1개
                try:
                    scs = getattr(c, "introduction_scenes", None)
                    if isinstance(scs, list) and len(scs) > 0:
                        s0 = scs[0]
                        title = _clip_text(getattr(s0, "title", None) if not isinstance(s0, dict) else s0.get("title"), 60)
                        content2 = _clip_text(getattr(s0, "content", None) if not isinstance(s0, dict) else s0.get("content"), 1200)
                        secret = _clip_text(getattr(s0, "secret", None) if not isinstance(s0, dict) else s0.get("secret"), 500)
                        if content2:
                            c.introduction_scenes = [{"title": title or "도입부 1", "content": content2, "secret": secret or ""}]
                        else:
                            c.introduction_scenes = None
                    else:
                        c.introduction_scenes = None
                except Exception:
                    c.introduction_scenes = None

                # tags: list[str] 보정(최대 8개)
                try:
                    tags = getattr(c, "tags", None)
                    if isinstance(tags, str):
                        tags = [s.strip() for s in tags.split(",") if s.strip()]
                    if isinstance(tags, list):
                        cleaned_tags = []
                        for t in tags:
                            tt = _clip_text(t, 24)
                            if tt:
                                cleaned_tags.append(tt)
                        c.tags = cleaned_tags[:8] if cleaned_tags else None
                    else:
                        c.tags = None
                except Exception:
                    c.tags = None
        except Exception:
            pass

        return analysis_result
        
    except json.JSONDecodeError:
        print(f"AI 응답 파싱 실패: 유효하지 않은 JSON 형식 - {clean_json_str}")
        raise ValueError("AI로부터 유효한 분석 결과를 받지 못했습니다.")
    except Exception as e:
        print(f"스토리 분석 중 오류 발생: {e}")
        raise