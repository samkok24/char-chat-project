"""
스토리 핵심 문장 추출 엔진
기승전결 구조로 2~4개의 핵심 문장/장면을 추출
"""
import re
import logging
from typing import List, Dict, Optional, Tuple
from dataclasses import dataclass
from enum import Enum

logger = logging.getLogger(__name__)

class StoryStage(Enum):
    """스토리 전개 단계"""
    INTRO = "기"  # 도입부
    DEVELOPMENT = "승"  # 전개
    CLIMAX = "전"  # 절정
    RESOLUTION = "결"  # 결말

@dataclass
class SceneExtract:
    """추출된 장면 정보"""
    stage: StoryStage
    sentence: str  # 원본 문장
    subtitle: str  # 자막용 축약 (20자 내외)
    position: float  # 텍스트 내 상대 위치 (0.0 ~ 1.0)
    confidence: float  # 추출 신뢰도 (0.0 ~ 1.0)
    keywords: List[str]  # 장면 키워드
    
class StoryExtractor:
    """스토리 핵심 문장 추출기"""
    
    # 문장 구분 패턴
    SENTENCE_PATTERN = re.compile(r'[.!?。！？]+[\s\n]*')
    
    # 중요 문장 신호 키워드
    IMPORTANT_SIGNALS = {
        'intro': ['처음', '시작', '어느', '옛날', '있었다', '살았다'],
        'development': ['그러나', '하지만', '그런데', '그러자', '그때'],
        'climax': ['갑자기', '순간', '마침내', '드디어', '결국'],
        'resolution': ['그래서', '그리하여', '끝내', '이렇게', '그렇게']
    }
    
    # 대사 패턴: 일반 따옴표와 한글 인용부호 모두 지원
    DIALOGUE_PATTERN = re.compile(r"""["']([^"']+)["']|“([^”]+)”|‘([^’]+)’""")

    
    def __init__(self, min_scenes: int = 2, max_scenes: int = 4):
        self.min_scenes = min_scenes
        self.max_scenes = max_scenes
        
    def extract_scenes(self, text: str, story_mode: Optional[str] = None) -> List[SceneExtract]:
        """스토리에서 핵심 장면 추출"""
        try:
            # 문장 분리
            sentences = self._split_sentences(text)
            if len(sentences) < self.min_scenes:
                # 문장이 너무 적으면 문단 단위로 분할
                sentences = self._split_by_paragraphs(text)
                
            # 각 문장 스코어링
            scored_sentences = self._score_sentences(sentences, text)
            
            # 기승전결 단계 할당
            staged_sentences = self._assign_stages(scored_sentences)
            
            # 상위 N개 선택 (단계 균형 고려)
            selected = self._select_top_scenes(staged_sentences, story_mode)
            
            # 자막용 텍스트 생성
            for scene in selected:
                scene.subtitle = self._create_subtitle(scene.sentence, story_mode)
                
            return selected
            
        except Exception as e:
            logger.error(f"Scene extraction failed: {e}")
            # 폴백: 균등 분할
            return self._fallback_extraction(text, story_mode)
            
    def _split_sentences(self, text: str) -> List[str]:
        """문장 단위로 분리"""
        sentences = self.SENTENCE_PATTERN.split(text)
        # 빈 문장 제거 및 정리
        return [s.strip() for s in sentences if s.strip() and len(s.strip()) > 10]
        
    def _split_by_paragraphs(self, text: str) -> List[str]:
        """문단 단위로 분리 (문장이 적을 때)"""
        paragraphs = text.split('\n\n')
        if len(paragraphs) < self.min_scenes:
            # 개행 단위로 재분할
            paragraphs = text.split('\n')
        return [p.strip() for p in paragraphs if p.strip() and len(p.strip()) > 20]
        
    def _score_sentences(self, sentences: List[str], full_text: str) -> List[Tuple[str, float, float]]:
        """각 문장의 중요도 점수 계산"""
        scored = []
        text_len = len(full_text)
        
        for sentence in sentences:
            # 위치 계산
            position = full_text.find(sentence) / text_len if text_len > 0 else 0.5
            
            # 기본 점수
            score = 0.0
            
            # 1. 길이 점수 (너무 짧거나 길지 않은 문장 선호)
            length = len(sentence)
            if 30 <= length <= 150:
                score += 0.3
            elif 20 <= length <= 200:
                score += 0.2
                
            # 2. 대사 포함 여부
            if self.DIALOGUE_PATTERN.search(sentence):
                score += 0.4
                
            # 3. 감정/행동 동사 포함
            emotion_verbs = ['울었다', '웃었다', '놀랐다', '외쳤다', '달려갔다', '멈췄다']
            for verb in emotion_verbs:
                if verb in sentence:
                    score += 0.2
                    break
                    
            # 4. 전환 신호어 포함
            for signals in self.IMPORTANT_SIGNALS.values():
                for signal in signals:
                    if signal in sentence:
                        score += 0.3
                        break
                        
            # 5. 위치 보너스 (시작과 끝 부분 가중치)
            if position < 0.15:  # 도입부
                score += 0.2
            elif position > 0.85:  # 결말부
                score += 0.2
            elif 0.45 <= position <= 0.65:  # 중반 클라이맥스
                score += 0.15
                
            scored.append((sentence, score, position))
            
        return sorted(scored, key=lambda x: x[1], reverse=True)
        
    def _assign_stages(self, scored_sentences: List[Tuple[str, float, float]]) -> List[SceneExtract]:
        """기승전결 단계 할당"""
        scenes = []
        
        for sentence, score, position in scored_sentences:
            # 위치 기반 단계 추정
            if position < 0.3:
                stage = StoryStage.INTRO
            elif position < 0.5:
                stage = StoryStage.DEVELOPMENT
            elif position < 0.8:
                stage = StoryStage.CLIMAX
            else:
                stage = StoryStage.RESOLUTION
                
            # 키워드 기반 단계 보정
            sentence_lower = sentence.lower()
            for key, signals in self.IMPORTANT_SIGNALS.items():
                for signal in signals:
                    if signal in sentence_lower:
                        if key == 'intro':
                            stage = StoryStage.INTRO
                        elif key == 'development':
                            stage = StoryStage.DEVELOPMENT
                        elif key == 'climax':
                            stage = StoryStage.CLIMAX
                        elif key == 'resolution':
                            stage = StoryStage.RESOLUTION
                        break
                        
            # 키워드 추출
            keywords = self._extract_keywords(sentence)
            
            scenes.append(SceneExtract(
                stage=stage,
                sentence=sentence,
                subtitle="",  # 나중에 채움
                position=position,
                confidence=min(score, 1.0),
                keywords=keywords
            ))
            
        return scenes
        
    def _select_top_scenes(
        self, 
        scenes: List[SceneExtract], 
        story_mode: Optional[str] = None
    ) -> List[SceneExtract]:
        """상위 N개 장면 선택 (단계 균형 고려)"""
        # 항상 3장 고정 (부족 시 호출 측에서 대체컷 보충)
        target_count = min(3, len(scenes))
            
        # 단계별로 그룹화
        by_stage = {stage: [] for stage in StoryStage}
        for scene in scenes:
            by_stage[scene.stage].append(scene)
            
        selected = []
        
        # 각 단계에서 최소 1개씩 선택 시도
        for stage in StoryStage:
            if by_stage[stage] and len(selected) < target_count:
                # 해당 단계에서 신뢰도 최상위 선택
                best = max(by_stage[stage], key=lambda x: x.confidence)
                selected.append(best)
                by_stage[stage].remove(best)
                
        # 남은 슬롯은 전체에서 신뢰도 순으로 채움
        remaining = []
        for stage_scenes in by_stage.values():
            remaining.extend(stage_scenes)
        remaining.sort(key=lambda x: x.confidence, reverse=True)
        
        while len(selected) < target_count and remaining:
            selected.append(remaining.pop(0))
            
        # 위치 순으로 정렬
        selected.sort(key=lambda x: x.position)
        
        return selected
        
    def _extract_keywords(self, sentence: str) -> List[str]:
        """문장에서 키워드 추출"""
        # 간단한 명사 추출 (형태소 분석기 없이)
        keywords = []
        
        # 주요 명사 패턴
        noun_patterns = [
            r'[가-힣]+(?:님|씨|이|가|을|를|의|에|에서)',
            r'[가-힣]+(?:하다|되다|이다|있다|없다)',
        ]
        
        for pattern in noun_patterns:
            matches = re.findall(pattern, sentence)
            for match in matches[:3]:  # 최대 3개
                # 조사 제거
                clean = re.sub(r'(님|씨|이|가|을|를|의|에|에서|하다|되다|이다|있다|없다)$', '', match)
                if clean and len(clean) >= 2:
                    keywords.append(clean)
                    
        return list(set(keywords))[:5]  # 중복 제거, 최대 5개
        
    def _create_subtitle(self, sentence: str, story_mode: Optional[str] = None, max_length: int = 40) -> str:
        """자막용 텍스트 생성 (축약)"""
        # 모드별 최대 글자수(이미지당 카피를 짧게 유지)
        if story_mode == "snap":
            max_length = 18  # 1~2행 내에서 크게 보이도록 짧게
        elif story_mode == "genre":
            max_length = 24  # 장르 후킹용 약간 여유
        else:
            max_length = 22

        def _shorten_copy(s: str, max_len: int) -> str:
            import re as _re
            t = (s or "").strip()
            # 따옴표/괄호 제거
            t = _re.sub(r"[\"'“”‘’]", "", t)
            t = _re.sub(r"[\(\)\[\]\{\}]", "", t)
            # 군더더기 어미/부사 축소(가벼운 휴리스틱)
            t = _re.sub(r"(하겠|했|하였|이었다|이었|였|였습니다)$", "", t)
            t = _re.sub(r"(같았|같아|같다|같은 느낌|같은 순간)$", "", t)
            t = _re.sub(r"(있었다|있다|되어버렸다|되어 간다)$", "", t)
            # 선행/후행 구두점 제거
            t = _re.sub(r"^[\s~·•\-–—]+", "", t)
            t = _re.sub(r"[\s~….!?]+$", "", t)
            if len(t) <= max_len:
                return t
            # 구분자 기준으로 짧은 구절 우선 추출
            parts = _re.split(r"[,·ㆍ/\\|]| 그리고 | 하지만 | 그런데 | 그래서 | 그러면 |\s{2,}", t)
            parts = [p.strip() for p in parts if p and p.strip()]
            for p in parts:
                if len(p) <= max_len:
                    return p
            # 마지막 수단: 자르기(줄임표 없이)
            return t[:max_len]

        import re as _re
        s = sentence.strip()
        
        # 1) 대사 우선 (가장 임팩트 높음)
        dialogue_match = self.DIALOGUE_PATTERN.search(sentence)
        if dialogue_match:
            dialogue = (dialogue_match.group(1) or dialogue_match.group(2) or dialogue_match.group(3) or "").strip()
            if dialogue and len(dialogue) <= max_length:
                return self._polish_subtitle(dialogue)
            elif dialogue:
                # 대사가 길면 핵심 구절만
                parts = _re.split(r'[,…]', dialogue)
                best = max(parts, key=lambda p: len(p.strip())) if parts else dialogue
                return self._polish_subtitle(best[:max_length])
        
        # 2) 의문문 (후킹 강함)
        question_parts = _re.findall(r'[^.!?]*\?', s)
        for q in question_parts:
            q = q.strip()
            if q and len(q) <= max_length:
                return self._polish_subtitle(q)
        
        # 3) 반전/클라이맥스 신호어 포함 구문 (장르 우선)
        if story_mode == "genre":
            for sig in ["갑자기", "순간", "그때", "하지만", "마침내", "드디어", "결국"]:
                idx = s.find(sig)
                if idx != -1:
                    tail = s[idx:]
                    # 문장 경계까지
                    tail_sent = _re.split(r'[.!?]', tail)[0].strip()
                    if tail_sent and len(tail_sent) <= max_length:
                        return self._polish_subtitle(tail_sent)
                    elif tail_sent:
                        # 길면 앞부분만
                        return self._polish_subtitle(tail_sent[:max_length])
        
        # 4) 짧은 완결 구문 찾기 (완결 어미로 끝나는 짧은 문장)
        sentences = _re.split(r'[.!?]', s)
        for sent in sentences:
            sent = sent.strip()
            if 8 <= len(sent) <= max_length and _re.search(r'(다|요|지|네|어|까)$', sent):
                return self._polish_subtitle(sent)
        
        # 5) SNAP: 첫 구절 (쉼표 기준)
        if story_mode == "snap":
            parts = _re.split(r'[,…—]', s)
            head = (parts[0] if parts else s).strip()
            if len(head) <= max_length:
                return self._polish_subtitle(head)
        
        # 6) 폴백: 마지막 구절 또는 앞부분
        if story_mode == "genre":
            parts = _re.split(r'[,…—]', s)
            tail = (parts[-1] if parts else s).strip()
            if len(tail) <= max_length:
                return self._polish_subtitle(tail)
        
        # 최종: 어절 단위로 자연스럽게
        words = s[:max_length+5].split()
        cut = " ".join(words[:-1]) if len(words) > 1 else s[:max_length]
        return self._polish_subtitle(cut)
    
    def _polish_subtitle(self, text: str) -> str:
        """자막 후처리: 불완전 어미 제거, 조사 회피, 완결형 보장"""
        import re as _re
        t = text.strip()
        # 조사로 끝나면 바로 앞 어절까지만
        if _re.search(r'[을를은는이가의에게와과도만]$', t):
            words = t.split()
            t = " ".join(words[:-1]) if len(words) > 1 else t
        # 불완전 어미 → 완결형
        t = _re.sub(r'했는$', '했다', t)
        t = _re.sub(r'가는$', '간다', t)
        t = _re.sub(r'하는$', '한다', t)
        t = _re.sub(r'되는$', '된다', t)
        t = _re.sub(r'인$', '이다', t)
        # 말줄임표 제거
        t = t.rstrip('.…')
        return t.strip()
        
    def _fallback_extraction(self, text: str, story_mode: Optional[str] = None) -> List[SceneExtract]:
        """폴백: 균등 분할"""
        length = len(text)
        num_scenes = min(self.max_scenes, max(self.min_scenes, length // 200))
        
        scenes = []
        chunk_size = length // num_scenes
        
        stages = [StoryStage.INTRO, StoryStage.DEVELOPMENT, 
                 StoryStage.CLIMAX, StoryStage.RESOLUTION]
        
        for i in range(num_scenes):
            start = i * chunk_size
            end = start + chunk_size if i < num_scenes - 1 else length
            chunk = text[start:end].strip()
            
            # 첫 문장 추출
            sentences = self.SENTENCE_PATTERN.split(chunk)
            sentence = sentences[0] if sentences else chunk[:100]
            
            scenes.append(SceneExtract(
                stage=stages[min(i, len(stages)-1)],
                sentence=sentence,
                subtitle=self._create_subtitle(sentence, story_mode),
                position=start / length,
                confidence=0.5,
                keywords=[]
            ))
            
        return scenes
