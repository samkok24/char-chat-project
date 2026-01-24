-- CAVEDUCK 스타일 고급 캐릭터 생성 시스템 마이그레이션
-- 실행 일시: 2024년

-- 1. 기존 characters 테이블에 새 필드 추가
ALTER TABLE characters 
ADD COLUMN world_setting TEXT,
ADD COLUMN user_display_description TEXT,
ADD COLUMN use_custom_description BOOLEAN DEFAULT FALSE,
ADD COLUMN introduction_scenes JSONB,
ADD COLUMN start_sets JSONB,
ADD COLUMN character_type VARCHAR(50) DEFAULT 'roleplay',
ADD COLUMN base_language VARCHAR(10) DEFAULT 'ko',
ADD COLUMN image_descriptions JSONB,
ADD COLUMN voice_settings JSONB,
ADD COLUMN has_affinity_system BOOLEAN DEFAULT FALSE,
ADD COLUMN affinity_rules TEXT,
ADD COLUMN affinity_stages JSONB,
ADD COLUMN custom_module_id UUID,
ADD COLUMN use_translation BOOLEAN DEFAULT TRUE;

-- 2. character_settings 테이블에 고급 설정 필드 추가
ALTER TABLE character_settings
ADD COLUMN custom_prompt_template TEXT,
ADD COLUMN use_memory BOOLEAN DEFAULT TRUE,
ADD COLUMN memory_length INTEGER DEFAULT 20,
ADD COLUMN response_style VARCHAR(50) DEFAULT 'natural';

-- 3. 캐릭터 예시 대화 테이블 생성
CREATE TABLE character_example_dialogues (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    user_message TEXT NOT NULL,
    character_response TEXT NOT NULL,
    order_index INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 인덱스 생성
CREATE INDEX idx_character_example_dialogues_character_id ON character_example_dialogues(character_id);
CREATE INDEX idx_character_example_dialogues_order ON character_example_dialogues(character_id, order_index);

-- 4. 세계관 설정 테이블 생성
CREATE TABLE world_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    creator_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    description TEXT NOT NULL,
    rules TEXT,
    is_public BOOLEAN DEFAULT FALSE,
    usage_count INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 인덱스 생성
CREATE INDEX idx_world_settings_creator_id ON world_settings(creator_id);
CREATE INDEX idx_world_settings_public ON world_settings(is_public) WHERE is_public = TRUE;

-- 5. 커스텀 모듈 테이블 생성 (고급 사용자용)
CREATE TABLE custom_modules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    creator_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    custom_prompt TEXT,
    lorebook JSONB,
    is_public BOOLEAN DEFAULT FALSE,
    usage_count INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 인덱스 생성
CREATE INDEX idx_custom_modules_creator_id ON custom_modules(creator_id);
CREATE INDEX idx_custom_modules_public ON custom_modules(is_public) WHERE is_public = TRUE;

-- 6. 캐릭터 통계 확장을 위한 뷰 생성
CREATE OR REPLACE VIEW character_stats AS
SELECT 
    c.id,
    c.name,
    c.creator_id,
    c.chat_count,
    c.like_count,
    c.created_at,
    COUNT(DISTINCT cr.id) as active_chat_rooms,
    COUNT(DISTINCT cm.id) as total_comments,
    COALESCE(AVG(EXTRACT(EPOCH FROM (cm.created_at - c.created_at))), 0) as avg_engagement_time
FROM characters c
LEFT JOIN chat_rooms cr ON c.id = cr.character_id
LEFT JOIN character_comments cm ON c.id = cm.character_id
GROUP BY c.id, c.name, c.creator_id, c.chat_count, c.like_count, c.created_at;

-- 7. 업데이트 트리거 함수 생성 (updated_at 자동 갱신)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- 8. 트리거 적용
CREATE TRIGGER update_world_settings_updated_at 
    BEFORE UPDATE ON world_settings 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_custom_modules_updated_at 
    BEFORE UPDATE ON custom_modules 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 9. 기존 데이터 마이그레이션 (기본값 설정)
UPDATE characters 
SET 
    character_type = 'roleplay',
    base_language = 'ko',
    use_custom_description = FALSE,
    has_affinity_system = FALSE,
    use_translation = TRUE
WHERE character_type IS NULL;

-- 10. 제약 조건 추가
ALTER TABLE characters 
ADD CONSTRAINT chk_character_type CHECK (character_type IN ('roleplay', 'simulator'));

ALTER TABLE characters 
ADD CONSTRAINT chk_base_language CHECK (base_language IN ('ko', 'en', 'ja', 'zh'));

-- 11. 외래 키 제약 조건 추가
ALTER TABLE characters 
ADD CONSTRAINT fk_characters_custom_module 
FOREIGN KEY (custom_module_id) REFERENCES custom_modules(id) ON DELETE SET NULL;

-- 12. 코멘트 추가 (문서화)
COMMENT ON TABLE character_example_dialogues IS 'CAVEDUCK 스타일 캐릭터 예시 대화 - AI 응답 품질 향상용';
COMMENT ON TABLE world_settings IS '재사용 가능한 세계관 설정 - 여러 캐릭터가 공유 가능';
COMMENT ON TABLE custom_modules IS '고급 사용자용 커스텀 프롬프트 및 로어북 모듈';

COMMENT ON COLUMN characters.introduction_scenes IS '도입부 시나리오 JSON 배열 - [{"title": "제목", "content": "내용", "secret": "비밀정보"}]';
COMMENT ON COLUMN characters.start_sets IS '시작 세트(도입부+첫대사) SSOT JSON - {"selectedId":"...","items":[{"id":"...","title":"...","intro":"...","firstLine":"..."}]}';
COMMENT ON COLUMN characters.affinity_stages IS '호감도 단계 JSON 배열 - [{"min": 0, "max": 100, "description": "반응"}]';
COMMENT ON COLUMN characters.image_descriptions IS '이미지 설명 JSON 배열 - [{"description": "설명", "url": "URL"}]';
COMMENT ON COLUMN characters.voice_settings IS '음성 설정 JSON - {"voice_id": "id", "style": "style", "enabled": true}';

-- 마이그레이션 완료 로그
INSERT INTO migration_log (version, description, executed_at) 
VALUES ('2024_caveduck_advanced_characters', 'CAVEDUCK 스타일 고급 캐릭터 생성 시스템 추가', NOW()); 