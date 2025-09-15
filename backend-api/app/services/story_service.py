"""
스토리 생성 서비스
"""

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update, delete, func, and_, or_
from sqlalchemy.orm import selectinload, joinedload
from typing import List, Optional, Dict, Any
import uuid
import asyncio
import json
from datetime import datetime
from typing import AsyncGenerator

from app.models.story import Story
from app.models.user import User
from app.models.character import Character
from app.models.like import StoryLike
from app.schemas.story import StoryCreate, StoryUpdate, StoryGenerationRequest
from app.services.ai_service import get_ai_completion, AIModel, get_ai_completion_stream


class StoryGenerationService:
    """스토리 생성 서비스 - 웹소설생성봇 로직 기반"""
    
    def __init__(self):        
        # 역할별 시스템 프롬프트 (웹소설생성봇에서 가져옴)
        self.role_prompts = {
            "concept_refiner": """당신은 **컨셉 정리자**입니다.

사용자가 제공한 키워드들을 정돈하여 웹소설 제작에 바로 활용할 수 있도록 불릿 포인트로 요약하세요.

【필수 규칙】
1. **사용자의 원본 키워드를 반드시 그대로 유지하세요**
   - 사용자가 지정한 장르, 배경, 설정을 절대 변경하지 마세요
   - 사용자가 원하는 특수 능력이나 시스템을 그대로 반영하세요
   - 사용자의 의도를 왜곡하지 마세요

2. **추가로 적용할 공통 설정**
   • 주인공은 반드시 남자
   • 주인공의 지능은 평균 이상 ~ 뛰어남
   • 성숙하고 이성적인 성격 (유치하지 않음)
   • 전략적 사고와 상황 판단력 보유

사용자의 키워드 + 위 공통 설정을 조합하여 정리해주세요.""",

            "world_builder": """당신은 **세계관 설계자**입니다.

정리된 컨셉을 바탕으로 핵심 정보 400자 이내로 요약하세요.

【필수 규칙】
• 사용자가 지정한 세계관 설정을 절대 변경하지 마세요
• 사용자가 원하는 특수 시스템(상태창, 스킬, 마법 등)을 그대로 반영하세요
• 사용자의 의도를 왜곡하지 마세요""",

            "character_designer": """당신은 **캐릭터 설계자**입니다.

세계관과 컨셉을 바탕으로 주요 등장인물들을 구체적으로 설계하세요.

【필수 요구사항】
1. **주인공 설계** (⚠️ 반드시 남자 주인공):
   - 성격과 특징 (3-5개 핵심 특성)
   - **지능: 평균 이상 ~ 뛰어남** (절대 멍청하거나 유치하지 않음)
   - 성숙하고 이성적인 판단력
   - 배경 스토리와 동기
   - 고유한 말투와 행동 패턴 (지적이고 세련된 화법)

2. **주요 조연 2-3명**:
   - 주인공과의 관계
   - 개별 캐릭터의 목적과 동기
   - 특징적인 외모나 습관

생동감 있고 독자가 공감할 수 있는 입체적인 캐릭터를 만들어주세요.""",

            "story_writer": """당신은 **웹소설 전문 작가**입니다.

【필수 요구사항】
1. **분량**: 반드시 한국어 2,000자~3,000자 사이로 작성하세요. (공백 포함)
2. **주인공**: 반드시 남자 주인공으로 작성하세요.
   - 지능: 평균 이상 ~ 뛰어남 (유치하거나 멍청하지 않음)
   - 성숙하고 논리적인 사고
   - 상황 판단력이 뛰어남
3. **구성**:
   - 도입부(300-500자): 강렬한 훅으로 시작
   - 전개부(1,200-1,800자): 긴장감 있는 전개와 갈등 심화
   - 절정부(400-600자): 감정적 클라이맥스
   - 결말부(100-200자): 여운을 남기는 마무리
4. **문체**: 몰입감 높은 3인칭 시점, 생생한 묘사와 대화
5. **필수 요소**: 최소 1개의 반전과 2개의 긴장 고조 지점

⚠️ 최종 경고: 2,000자 이상, 3,000자 이하로 작성하세요!"""
        }
        
        # 온도 설정
        self.temperatures = {
            "concept_refiner": 0.7,
            "world_builder": 0.7,
            "character_designer": 0.6,
            "story_writer": 0.8,
        }

    async def generate_story(
        self, 
        keywords: List[str], 
        character_id: Optional[uuid.UUID] = None,
        genre: Optional[str] = None,
        length: str = "medium",
        tone: str = "neutral",
        ai_model: AIModel = "gemini",
        ai_sub_model: Optional[str] = None
    ) -> Dict[str, Any]:
        """스토리 생성 메인 함수"""
        
        try:
            # 1. 컨셉 정리
            concept_input = f"키워드: {', '.join(keywords)}"
            if genre:
                concept_input += f"\n장르: {genre}"
            if tone != "neutral":
                concept_input += f"\n톤: {tone}"
                
            concept = await self._call_ai("concept_refiner", concept_input, model=ai_model, sub_model=ai_sub_model)
            
            # 2. 세계관 설계
            world = await self._call_ai("world_builder", concept, model=ai_model, sub_model=ai_sub_model)
            
            # 3. 캐릭터 설계 (기존 캐릭터가 있으면 활용)
            character_info = ""
            if character_id:
                # 기존 캐릭터 정보 활용 (실제 구현에서는 DB에서 가져와야 함)
                character_info = f"\n\n기존 캐릭터 정보를 활용하여 설계하세요."
            
            character_prompt = f"{concept}\n\n{world}{character_info}"
            characters = await self._call_ai("character_designer", character_prompt, model=ai_model, sub_model=ai_sub_model)
            
            # 4. 스토리 작성
            story_prompt = f"""
컨셉: {concept}

세계관: {world}

캐릭터: {characters}

위 설정을 바탕으로 {length} 길이의 스토리를 작성해주세요.
키워드: {', '.join(keywords)}
"""
            
            story_content = await self._call_ai("story_writer", story_prompt, model=ai_model, sub_model=ai_sub_model)
            
            # 5. 제목 생성
            title = await self._generate_title(keywords, story_content, model=ai_model, sub_model=ai_sub_model)
            
            # 6. 예상 읽기 시간 계산 (한국어 기준 분당 300자)
            reading_time = max(1, len(story_content) // 300)
            
            return {
                "title": title,
                "content": story_content,
                "keywords": keywords,
                "genre": genre,
                "estimated_reading_time": reading_time,
                "metadata": {
                    "concept": concept,
                    "world": world,
                    "characters": characters,
                    "length": length,
                    "tone": tone
                }
            }
            
        except Exception as e:
            raise Exception(f"스토리 생성 중 오류 발생: {str(e)}")

    async def _call_ai(self, role: str, content: str, model: AIModel, sub_model: Optional[str] = None) -> str:
        system_prompt = self.role_prompts.get(role, "")
        temperature = self.temperatures.get(role, 0.7)
        max_tokens = 3000 if role == "story_writer" else 1500 # 토큰 수 조정
        
        # 시스템 프롬프트와 사용자 프롬프트를 결합
        full_prompt = f"{system_prompt}\n\n---\n\n{content}"
        
        # get_ai_completion 함수 호출
        response = await get_ai_completion(
            prompt=full_prompt,
            model=model,
            sub_model=sub_model,
            temperature=temperature,
            max_tokens=max_tokens
        )
        
        return response

    async def _call_ai_stream(self, role: str, content: str, model: AIModel, sub_model: Optional[str] = None) -> AsyncGenerator[str, None]:
        """AI 모델을 스트리밍 방식으로 호출합니다."""
        system_prompt = self.role_prompts.get(role, "")
        temperature = self.temperatures.get(role, 0.7)
        max_tokens = 4000 if role == "story_writer" else 1500
        
        full_prompt = f"{system_prompt}\n\n---\n\n{content}"
        
        async for chunk in get_ai_completion_stream(
            prompt=full_prompt,
            model=model,
            sub_model=sub_model,
            temperature=temperature,
            max_tokens=max_tokens
        ):
            yield chunk

    async def generate_story_stream(
        self,
        keywords: List[str],
        genre: Optional[str] = None,
        length: str = "medium",
        tone: str = "neutral",
        ai_model: AIModel = "gemini",
        ai_sub_model: Optional[str] = None
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """스토리 생성 전체 과정을 스트리밍합니다."""
        try:
            # 1. 컨셉 정리 (스트리밍)
            yield {"event": "stage_start", "data": {"name": "concept_refining", "label": "컨셉 정리 중..."}}
            concept_input = f"키워드: {', '.join(keywords)}"
            if genre: concept_input += f"\n장르: {genre}"
            if tone != "neutral": concept_input += f"\n톤: {tone}"
            
            concept = ""
            async for chunk in self._call_ai_stream("concept_refiner", concept_input, model=ai_model, sub_model=ai_sub_model):
                concept += chunk
                yield {"event": "stage_progress", "data": {"name": "concept_refining", "delta": chunk}}
            yield {"event": "stage_end", "data": {"name": "concept_refining", "result": concept}}

            # 2. 세계관 설계 (스트리밍)
            yield {"event": "stage_start", "data": {"name": "world_building", "label": "세계관 설계 중..."}}
            world = ""
            async for chunk in self._call_ai_stream("world_builder", concept, model=ai_model, sub_model=ai_sub_model):
                world += chunk
                yield {"event": "stage_progress", "data": {"name": "world_building", "delta": chunk}}
            yield {"event": "stage_end", "data": {"name": "world_building", "result": world}}

            # 3. 캐릭터 설계 (스트리밍)
            yield {"event": "stage_start", "data": {"name": "character_designing", "label": "캐릭터 설계 중..."}}
            character_prompt = f"{concept}\n\n{world}"
            characters = ""
            async for chunk in self._call_ai_stream("character_designer", character_prompt, model=ai_model, sub_model=ai_sub_model):
                characters += chunk
                yield {"event": "stage_progress", "data": {"name": "character_designing", "delta": chunk}}
            yield {"event": "stage_end", "data": {"name": "character_designing", "result": characters}}

            # 4. 스토리 본문 작성 (스트리밍)
            yield {"event": "stage_start", "data": {"name": "story_writing", "label": "스토리 생성 중..."}}
            story_prompt = f"컨셉: {concept}\n\n세계관: {world}\n\n캐릭터: {characters}\n\n위 설정을 바탕으로 {length} 길이의 스토리를 작성해주세요."
            story_content = ""
            async for chunk in self._call_ai_stream("story_writer", story_prompt, model=ai_model, sub_model=ai_sub_model):
                story_content += chunk
                yield {"event": "story_delta", "data": {"delta": chunk}}
            
            # 5. 제목 생성 (단일 호출)
            yield {"event": "stage_start", "data": {"name": "title_generation", "label": "제목 생성 중..."}}
            title = await self._generate_title(keywords, story_content, model=ai_model, sub_model=ai_sub_model)
            yield {"event": "stage_end", "data": {"name": "title_generation", "result": title}}
            
            yield {"event": "final", "data": {
                "title": title,
                "content": story_content,
                "keywords": keywords,
                "genre": genre,
                "estimated_reading_time": max(1, len(story_content) // 300),
                "metadata": { "concept": concept, "world": world, "characters": characters }
            }}

        except Exception as e:
            yield {"event": "error", "data": {"message": f"스트리밍 생성 중 오류: {str(e)}"}}

    async def _generate_title(self, keywords: List[str], content: str, model: AIModel, sub_model: Optional[str] = None) -> str:
        """스토리 제목 생성"""
        title_prompt = f"""
키워드: {', '.join(keywords)}

스토리 내용 (앞부분):
{content[:500]}...

위 키워드와 스토리 내용을 바탕으로 매력적인 제목을 생성해주세요.
- 10자 이내로 간결하게
- 호기심을 자극하는 제목
- 키워드의 핵심을 반영
"""
        
        title = await self._call_ai("concept_refiner", title_prompt,model=model, sub_model=sub_model)
        return title.strip().replace('"', '').replace("'", "")[:20]


# 기존 스토리 서비스 함수들
async def create_story(
    db: AsyncSession,
    creator_id: uuid.UUID,
    story_data: StoryCreate
) -> Story:
    """스토리 생성"""
    story = Story(
        creator_id=creator_id,
        **story_data.model_dump()
    )
    db.add(story)
    await db.commit()
    await db.refresh(story)
    return story


async def get_story_by_id(db: AsyncSession, story_id: uuid.UUID) -> Optional[Story]:
    """ID로 스토리 조회"""
    result = await db.execute(
        select(Story)
        .options(
            joinedload(Story.creator),
            joinedload(Story.character)
        )
        .where(Story.id == story_id)
    )
    return result.scalar_one_or_none()


async def get_stories_by_creator(
    db: AsyncSession,
    creator_id: uuid.UUID,
    skip: int = 0,
    limit: int = 20,
    search: Optional[str] = None
) -> List[Story]:
    """생성자별 스토리 목록 조회"""
    query = select(Story).where(Story.creator_id == creator_id)
    
    if search:
        query = query.where(
            or_(
                Story.title.ilike(f"%{search}%"),
                Story.content.ilike(f"%{search}%")
            )
        )
    
    query = query.order_by(Story.created_at.desc()).offset(skip).limit(limit)
    
    result = await db.execute(query)
    return result.scalars().all()


async def get_public_stories(
    db: AsyncSession,
    skip: int = 0,
    limit: int = 20,
    search: Optional[str] = None,
    genre: Optional[str] = None
) -> List[Story]:
    """공개 스토리 목록 조회"""
    query = select(Story).where(Story.is_public == True)
    
    if search:
        query = query.where(
            or_(
                Story.title.ilike(f"%{search}%"),
                Story.content.ilike(f"%{search}%")
            )
        )
    
    if genre:
        query = query.where(Story.genre == genre)
    
    query = query.order_by(Story.like_count.desc(), Story.created_at.desc()).offset(skip).limit(limit)
    
    result = await db.execute(query)
    return result.scalars().all()


async def update_story(
    db: AsyncSession,
    story_id: uuid.UUID,
    story_data: StoryUpdate
) -> Optional[Story]:
    """스토리 정보 수정"""
    update_data = story_data.model_dump(exclude_unset=True)
    
    if update_data:
        await db.execute(
            update(Story)
            .where(Story.id == story_id)
            .values(**update_data)
        )
        await db.commit()
    
    return await get_story_by_id(db, story_id)


async def delete_story(db: AsyncSession, story_id: uuid.UUID) -> bool:
    """스토리 삭제"""
    result = await db.execute(
        delete(Story).where(Story.id == story_id)
    )
    await db.commit()
    return result.rowcount > 0


async def like_story(db: AsyncSession, story_id: uuid.UUID, user_id: uuid.UUID) -> bool:
    """스토리 좋아요"""
    # 좋아요 추가
    like = StoryLike(story_id=story_id, user_id=user_id)
    db.add(like)
    
    # 스토리 좋아요 수 증가
    await db.execute(
        update(Story)
        .where(Story.id == story_id)
        .values(like_count=Story.like_count + 1)
    )
    
    await db.commit()
    return True


async def unlike_story(db: AsyncSession, story_id: uuid.UUID, user_id: uuid.UUID) -> bool:
    """스토리 좋아요 취소"""
    # 좋아요 삭제
    result = await db.execute(
        delete(StoryLike).where(
            and_(
                StoryLike.story_id == story_id,
                StoryLike.user_id == user_id
            )
        )
    )
    
    if result.rowcount > 0:
        # 스토리 좋아요 수 감소
        await db.execute(
            update(Story)
            .where(Story.id == story_id)
            .values(like_count=Story.like_count - 1)
        )
        await db.commit()
        return True
    
    return False


async def is_story_liked_by_user(db: AsyncSession, story_id: uuid.UUID, user_id: uuid.UUID) -> bool:
    """사용자가 스토리에 좋아요를 눌렀는지 확인"""
    result = await db.execute(
        select(StoryLike).where(
            and_(
                StoryLike.story_id == story_id,
                StoryLike.user_id == user_id
            )
        )
    )
    return result.scalar_one_or_none() is not None


async def increment_story_view_count(db: AsyncSession, story_id: uuid.UUID) -> bool:
    """스토리 조회수 증가"""
    await db.execute(
        update(Story)
        .where(Story.id == story_id)
        .values(view_count=Story.view_count + 1)
    )
    await db.commit()
    return True


# 스토리 생성 서비스 인스턴스
story_generation_service = StoryGenerationService()

