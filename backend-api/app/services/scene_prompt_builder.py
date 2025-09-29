"""
장면별 이미지 생성 프롬프트 빌더
스토리 문장과 컨텍스트를 바탕으로 Seedream용 프롬프트 생성
"""
import re
import logging
from typing import List, Dict, Optional
from dataclasses import dataclass

logger = logging.getLogger(__name__)

@dataclass
class ScenePrompt:
    """장면 프롬프트"""
    positive: str  # 메인 프롬프트
    negative: str  # 네거티브 프롬프트
    style_tags: List[str]  # 스타일 태그
    
class ScenePromptBuilder:
    """장면별 프롬프트 생성기"""
    
    # 기본 네거티브 프롬프트
    DEFAULT_NEGATIVE = (
        "저해상도, 흐릿한 얼굴, 텍스트, 워터마크, 로고, 서명, 글자, 문자,"
        " lowres, blurry, text, watermark, logo, signature,"
        " deformed hands, extra fingers, extra limbs, bad anatomy,"
        " person, people, human, face, portrait, selfie, profile, character, figure, body, silhouette, crowd,"
        " poster, movie poster, title, subtitles, caption, typography, korean text, hangul text"
    )
    
    # 스타일 프리셋
    STYLE_PRESETS = {
        "snap": {
            "tags": ["일상적인", "따뜻한", "부드러운 조명", "자연스러운", "필름 감성", "빈티지"],
            "suffix": ", 일상 스냅샷, 필름 카메라 감성, soft contrast, muted colors, natural white balance, film grain, 35mm, Kodak Portra 400 look, Fuji Superia palette, subtle light leak, slight vignette, soft focus, subtle composition"
        },
        "genre": {
            "tags": ["드라마틱한", "영화적인", "강렬한", "몰입감 있는"],
            "suffix": ", 시네마틱, 영화 포스터, 극적인 조명, dramatic contrast, dynamic composition, deep shadows"
        },
        "fantasy": {
            "tags": ["판타지", "마법적인", "신비로운", "환상적인"],
            "suffix": ", 판타지 아트, 마법의 분위기, 신비한 조명"
        },
        "noir": {
            "tags": ["느와르", "어두운", "그림자", "대비"],
            "suffix": ", 필름 느와르, 하이 콘트라스트, 검은 그림자"
        }
    }
    
    # 감정 → 시각 매핑
    EMOTION_VISUALS = {
        "기쁨": "밝은 표정, 따뜻한 색감",
        "슬픔": "우울한 분위기, 차가운 색조",
        "분노": "강렬한 표정, 붉은 톤",
        "공포": "어두운 그림자, 긴장감",
        "놀람": "넓은 눈, 다이나믹한 구도",
        "사랑": "부드러운 빛, 로맨틱한 분위기"
    }
    
    def __init__(self, base_style: str = "genre", allow_people: bool = False):
        self.base_style = base_style
        self.allow_people = allow_people
        
    def build_from_scene(
        self,
        sentence: str,
        keywords: List[str],
        stage: str,
        story_mode: Optional[str] = None,
        original_image_tags: Optional[Dict] = None
    ) -> ScenePrompt:
        """
        장면 문장으로부터 프롬프트 생성
        
        Args:
            sentence: 장면 문장
            keywords: 추출된 키워드
            stage: 스토리 단계 (기/승/전/결)
            story_mode: 스토리 모드 (snap/genre)
            original_image_tags: 원본 이미지 태그 (있을 경우)
            
        Returns:
            ScenePrompt: 생성된 프롬프트
        """
        try:
            # 1. 기본 요소 추출
            elements = self._extract_visual_elements(sentence, keywords)
            
            # 2. 스타일 결정
            style = story_mode or self.base_style
            style_preset = self.STYLE_PRESETS.get(style, self.STYLE_PRESETS["genre"])
            
            # 3. 단계별 분위기 조정
            stage_mood = self._get_stage_mood(stage)
            
            # 4. 프롬프트 조립
            positive_parts = []
            
            # 주요 피사체: 사람 금지
            if elements.get("subject") and self.allow_people:
                positive_parts.append(elements["subject"])
                
            # 행동/상황 (스냅에서는 인물 행동 암시를 피하기 위해 제외)
            if elements.get("action") and style != "snap":
                positive_parts.append(elements["action"])
                
            # 배경/장소
            if elements.get("location"):
                positive_parts.append(elements["location"])
                
            # 감정/분위기
            if elements.get("emotion"):
                emotion_visual = self.EMOTION_VISUALS.get(
                    elements["emotion"], 
                    elements["emotion"]
                )
                positive_parts.append(emotion_visual)
                
            # 단계 분위기
            if stage_mood:
                positive_parts.append(stage_mood)

            # 스냅 전용: 인물 배제 유도(정물/풍경/사물 중심)
            if style == "snap":
                positive_parts.append("still life, everyday objects, landscape only")

            # 스테이지별 카메라/구도/시간대 토큰
            camera_tokens = self._get_stage_camera_tokens(stage, sentence, keywords)
            if camera_tokens:
                positive_parts.extend(camera_tokens)
                
            # 원본 이미지 스타일 참조
            if original_image_tags:
                lighting = original_image_tags.get("lighting")
                if lighting:
                    positive_parts.append(f"{lighting} 조명")
                    
            # 스타일 접미사
            positive_parts.append(style_preset["suffix"])

            # 공통 시네마틱 디테일 (장르 후킹 강화)
            if (story_mode or self.base_style) == "genre":
                positive_parts.append("cinematic lighting, volumetric light, 35mm, high detail, film grain, high contrast")
            else:
                positive_parts.append("cinematic lighting, 35mm, natural color, fine detail")
            
            # 최종 프롬프트
            positive_prompt = ", ".join(positive_parts)
            
            # 한국적 요소 강화
            positive_prompt = self._enhance_korean_elements(positive_prompt)
            
            # 네거티브 프롬프트
            negative_prompt = self._build_negative_prompt(sentence, story_mode=style)
            
            return ScenePrompt(
                positive=positive_prompt,
                negative=negative_prompt,
                style_tags=style_preset["tags"]
            )
            
        except Exception as e:
            logger.error(f"Prompt building failed: {e}")
            # 폴백 프롬프트
            return self._fallback_prompt(sentence, story_mode)
            
    def _extract_visual_elements(
        self, 
        sentence: str, 
        keywords: List[str]
    ) -> Dict[str, str]:
        """문장에서 시각적 요소 추출"""
        elements = {}
        
        # 인물 추출(비활성화): 인물은 생성하지 않음
        # subject는 오브젝트/배경 위주로만 설정
                
        # 행동 추출
        action_verbs = {
            "달리": "달리는",
            "걸": "걷는",
            "앉": "앉아있는",
            "서": "서있는",
            "웃": "웃고있는",
            "울": "우는",
            "보": "바라보는"
        }
        for verb_stem, visual in action_verbs.items():
            if verb_stem in sentence:
                elements["action"] = visual
                break
                
        # 장소 추출
        location_keywords = {
            "거리": "도시 거리",
            "카페": "카페 내부",
            "집": "아늑한 집",
            "학교": "학교 교실",
            "공원": "공원",
            "바다": "해변",
            "산": "산 풍경"
        }
        for keyword, visual in location_keywords.items():
            if keyword in sentence:
                elements["location"] = visual
                break
                
        # 감정 추출
        emotion_keywords = {
            "기뻐": "기쁨",
            "슬퍼": "슬픔",
            "화가": "분노",
            "무서": "공포",
            "놀라": "놀람",
            "사랑": "사랑"
        }
        for keyword, emotion in emotion_keywords.items():
            if keyword in sentence:
                elements["emotion"] = emotion
                break
                
        # 키워드에서 추가 정보
        for keyword in keywords[:3]:
            if keyword not in str(elements.values()):
                if "location" not in elements:
                    elements["location"] = keyword
                elif "action" not in elements:
                    elements["action"] = keyword
                    
        return elements

    def _get_stage_camera_tokens(self, stage: str, sentence: str, keywords: List[str]) -> List[str]:
        """기/승/전/결 단계별 카메라/구도/시간대 토큰"""
        s = str(stage)
        sent = sentence.lower()
        kw_join = " ".join(keywords).lower()

        tokens: List[str] = []

        def has_night():
            return any(k in sent or k in kw_join for k in ["밤", "night", "야간", "어두", "dark"])

        def has_rain():
            return any(k in sent or k in kw_join for k in ["비", "rain", "우산", "빗" ])

        def time_of_day_default():
            if any(k in sent for k in ["아침", "morning"]):
                return "morning"
            if any(k in sent for k in ["저녁", "황혼", "해질녘", "석양", "golden hour", "sunset"]):
                return "golden hour"
            if has_night():
                return "night"
            return "daylight"

        tod = time_of_day_default()

        snap_mode = (self.base_style or "").lower() == "snap"

        if s in ("기", "intro"):
            if snap_mode:
                tokens.extend(["wide establishing shot", "overhead shot", "35mm", "natural light", "still life arrangement", tod if tod else "morning"])
            else:
                tokens.extend(["wide establishing shot", "rule of thirds", "35mm", "natural light", tod if tod else "morning"])
        elif s in ("승", "development"):
            if snap_mode:
                tokens.extend(["wide shot", "table-top", "leading lines", "soft focus", tod])
            else:
                tokens.extend(["mid shot", "dynamic angle", "leading lines", "motion blur", tod])
        elif s in ("전", "climax"):
            if snap_mode:
                tokens.extend(["macro shot of object texture", "high contrast", "natural vignette", "shallow depth of field"])  # 오브젝트 중심
            else:
                tokens.extend(["close-up", "high contrast", "cinematic lighting", "spotlight effect", "shallow depth of field"])
            if has_night():
                tokens.append("night")
            if has_rain():
                tokens.append("rain")
        elif s in ("결", "resolution"):
            if snap_mode:
                tokens.extend(["medium-wide", "soft bokeh", "symmetry", "empty background", "golden hour" if tod == "golden hour" else tod])
            else:
                tokens.extend(["medium-wide", "soft bokeh", "symmetry", "golden hour" if tod == "golden hour" else tod])

        # 중복 제거
        out: List[str] = []
        for t in tokens:
            if t and t not in out:
                out.append(t)
        return out
        
    def _get_stage_mood(self, stage: str) -> str:
        """스토리 단계별 분위기"""
        moods = {
            "기": "평화로운 시작, 일상적인 분위기",
            "승": "긴장감 상승, 변화의 조짐",
            "전": "클라이맥스, 극적인 순간",
            "결": "여운이 남는 마무리, 감동적인"
        }
        return moods.get(stage, "")
        
    def _enhance_korean_elements(self, prompt: str) -> str:
        """한국적 요소 강화"""
        # 한국 특화 키워드 추가
        korean_enhancers = {
            "거리": "서울 거리, 네온사인",
            "카페": "한국 카페, 아늑한 인테리어",
            "인물": "한국인 인물",
            "집": "한국 아파트 또는 한옥"
        }
        
        enhanced = prompt
        for keyword, replacement in korean_enhancers.items():
            if keyword in enhanced:
                enhanced = enhanced.replace(keyword, replacement)
                
        return enhanced
        
    def _build_negative_prompt(self, sentence: str, story_mode: Optional[str] = None) -> str:
        """네거티브 프롬프트 생성"""
        negative_parts = [self.DEFAULT_NEGATIVE]
        
        # 인물 전면 금지(요청 반영)
        negative_parts.append("no person, no people, no human, no face, no portrait, no character, no figure, no body, no silhouette, no crowd")
        
        # SNAP 모드에서는 인물 제거 강도 추가
        try:
            mode = (story_mode or self.base_style or "").strip().lower()
        except Exception:
            mode = ""
        if mode == "snap":
            negative_parts.append("no hands, no arms, no legs, no skin, no selfie, no profile, no model, no subject, no close-up of a person")
            # 대상은 사물/풍경 중심으로 유도
            negative_parts.append("object-only, background-only, still life, empty scene")
            # 상업/스튜디오/HDR 톤 억제
            negative_parts.append("hdr, hyper-realistic, overly saturated, glossy, commercial, advertising, studio lighting, product shot, neon colors, overly sharp")
            # 가시적 인물 완전 금지(모델에 따라 더 잘 듣는 표현)
            negative_parts.append("no visible people, no visible human")
            
        # 과도한 밝기/암부 클리핑 방지(문맥 따라 보정)
        if "밝" not in sentence:
            negative_parts.append("overexposed")
        if "어둡" not in sentence and "밤" not in sentence:
            negative_parts.append("underexposed")
            
        return ", ".join(negative_parts)
        
    def _fallback_prompt(
        self, 
        sentence: str, 
        story_mode: Optional[str] = None
    ) -> ScenePrompt:
        """폴백 프롬프트"""
        style = story_mode or "genre"
        style_preset = self.STYLE_PRESETS.get(style, self.STYLE_PRESETS["genre"])
        
        # 단순 프롬프트
        simple_prompt = f"한국 웹소설 장면, {sentence[:30]}... {style_preset['suffix']}"
        
        return ScenePrompt(
            positive=simple_prompt,
            negative=self.DEFAULT_NEGATIVE,
            style_tags=style_preset["tags"]
        )
        
    def build_batch_prompts(
        self,
        scenes: List[Dict],
        story_mode: Optional[str] = None,
        original_tags: Optional[Dict] = None
    ) -> List[ScenePrompt]:
        """여러 장면의 프롬프트 일괄 생성"""
        prompts = []
        
        for scene in scenes:
            prompt = self.build_from_scene(
                sentence=scene.get("sentence", ""),
                keywords=scene.get("keywords", []),
                stage=scene.get("stage", ""),
                story_mode=story_mode,
                original_image_tags=original_tags
            )
            prompts.append(prompt)
            
        return prompts
