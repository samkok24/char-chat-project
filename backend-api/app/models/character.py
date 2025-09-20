"""
캐릭터 모델 - CAVEDUCK 스타일 고급 캐릭터 생성 시스템
"""

from sqlalchemy import Column, String, Text, Boolean, Integer, DateTime, ForeignKey, Numeric, func, JSON
from sqlalchemy.orm import relationship
import uuid

from app.core.database import Base, UUID


class Character(Base):
    """캐릭터 모델 - CAVEDUCK 스타일 확장"""
    __tablename__ = "characters"

    id = Column(UUID(), primary_key=True, default=uuid.uuid4, index=True)
    creator_id = Column(UUID(), ForeignKey("users.id"), nullable=False, index=True)
    
    # 🔥 기본 정보 (1단계)
    name = Column(String(100), nullable=False)
    description = Column(Text)  # 캐릭터 설명 (공개용)
    personality = Column(Text)  # 성격
    speech_style = Column(Text)  # 말투
    greeting = Column(Text)  # 인사말
    background_story = Column(Text)  # 배경 스토리
    
    # 🌍 세계관 설정
    world_setting = Column(Text)  # 세계관 설명
    user_display_description = Column(Text)  # 사용자에게 보여줄 별도 설명
    use_custom_description = Column(Boolean, default=False)  # 별도 설명 사용 여부
    
    # 📖 도입부 시스템
    introduction_scenes = Column(JSON)
    
    # 🎯 캐릭터 타입 및 언어
    character_type = Column(String(50), default="roleplay")
    base_language = Column(String(10), default="ko")
    
    # 🎨 미디어 설정
    avatar_url = Column(String(500))
    image_descriptions = Column(JSON)
    voice_settings = Column(JSON)
    
    # ❤️ 호감도 시스템
    has_affinity_system = Column(Boolean, default=False)
    affinity_rules = Column(Text)
    affinity_stages = Column(JSON)


    # 🚀 공개 설정
    is_public = Column(Boolean, default=True, index=True)
    is_active = Column(Boolean, default=True)
    
    # ✨ 생성 출처
    source_type = Column(String(20), nullable=False, default='ORIGINAL') # 'ORIGINAL' 또는 'IMPORTED'
    # 원작 연결 스토리 ID(원작챗 파생 캐릭터 식별)
    origin_story_id = Column(UUID(), ForeignKey("stories.id"), nullable=True, index=True)
    
    # 📊 통계
    chat_count = Column(Integer, default=0)
    like_count = Column(Integer, default=0)
    comment_count = Column(Integer, default=0) # 이 줄을 추가해 주세요.
    
    # 🔧 고급 설정
    custom_module_id = Column(UUID(), nullable=True)
    use_translation = Column(Boolean, default=True)
    
    # 📅 타임스탬프
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # 관계 설정
    creator = relationship("User", back_populates="characters")
    settings = relationship("CharacterSetting", back_populates="character", uselist=False, cascade="all, delete-orphan")
    example_dialogues = relationship("CharacterExampleDialogue", back_populates="character", cascade="all, delete-orphan")
    chat_rooms = relationship("ChatRoom", back_populates="character", cascade="all, delete-orphan")
    # 스토리와의 관계: Story.character_id 를 통한 역참조만 사용하여 모호성 제거
    from sqlalchemy.orm import foreign
    stories = relationship(
        "Story",
        back_populates="character",
        primaryjoin="Character.id==foreign(Story.character_id)",
        foreign_keys="Story.character_id",
    )
    # 캐릭터가 어떤 원작 스토리에서 파생되었는지(단방향)
    origin_story = relationship(
        "Story",
        primaryjoin="foreign(Character.origin_story_id)==Story.id",
        foreign_keys=[origin_story_id],
        viewonly=True,
    )
    likes = relationship("CharacterLike", back_populates="character", cascade="all, delete-orphan")
    comments = relationship("CharacterComment", back_populates="character", cascade="all, delete-orphan")
    tags = relationship("Tag", secondary="character_tags", back_populates="characters")

    def __repr__(self):
        try:
            return f"<Character(id={self.id}, name={self.name})>"
        except:
            return f"<Character(detached)>"


class CharacterExampleDialogue(Base):
    """캐릭터 예시 대화 모델"""
    __tablename__ = "character_example_dialogues"

    id = Column(UUID(), primary_key=True, default=uuid.uuid4, index=True)
    character_id = Column(UUID(), ForeignKey("characters.id"), nullable=False, index=True)
    user_message = Column(Text, nullable=False)
    character_response = Column(Text, nullable=False)
    order_index = Column(Integer, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    character = relationship("Character", back_populates="example_dialogues")


class CharacterSetting(Base):
    """캐릭터 AI 설정 모델"""
    __tablename__ = "character_settings"

    id = Column(UUID(), primary_key=True, default=uuid.uuid4, index=True)
    character_id = Column(UUID(), ForeignKey("characters.id"), nullable=False, unique=True)
    ai_model = Column(String(50), default="gemini-pro")
    temperature = Column(Numeric(3, 2), default=0.7)
    max_tokens = Column(Integer, default=1000)
    system_prompt = Column(Text)
    custom_prompt_template = Column(Text)
    use_memory = Column(Boolean, default=True)
    memory_length = Column(Integer, default=20)
    response_style = Column(String(50), default="natural")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    character = relationship("Character", back_populates="settings")


class WorldSetting(Base):
    """세계관 설정 모델 (재사용 가능)"""
    __tablename__ = "world_settings"
    id = Column(UUID(), primary_key=True, default=uuid.uuid4, index=True)
    creator_id = Column(UUID(), ForeignKey("users.id"), nullable=False, index=True)
    name = Column(String(100), nullable=False)
    description = Column(Text, nullable=False)
    rules = Column(Text)
    is_public = Column(Boolean, default=False)
    usage_count = Column(Integer, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    creator = relationship("User")


class CustomModule(Base):
    """커스텀 모듈 모델 (고급 사용자용)"""
    __tablename__ = "custom_modules"
    id = Column(UUID(), primary_key=True, default=uuid.uuid4, index=True)
    creator_id = Column(UUID(), ForeignKey("users.id"), nullable=False, index=True)
    name = Column(String(100), nullable=False)
    description = Column(Text)
    custom_prompt = Column(Text)
    lorebook = Column(JSON)
    is_public = Column(Boolean, default=False)
    usage_count = Column(Integer, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    creator = relationship("User")

