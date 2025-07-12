-- SQLite 마이그레이션: 누락된 컬럼 추가
-- 기존 데이터베이스에 새로운 필드들을 추가합니다

-- characters 테이블에 누락된 컬럼 추가
ALTER TABLE characters ADD COLUMN speech_style TEXT;
ALTER TABLE characters ADD COLUMN world_setting TEXT;
ALTER TABLE characters ADD COLUMN user_display_description TEXT;
ALTER TABLE characters ADD COLUMN use_custom_description BOOLEAN DEFAULT 0;
ALTER TABLE characters ADD COLUMN introduction_scenes TEXT;
ALTER TABLE characters ADD COLUMN character_type VARCHAR(50) DEFAULT 'roleplay';
ALTER TABLE characters ADD COLUMN base_language VARCHAR(10) DEFAULT 'ko';
ALTER TABLE characters ADD COLUMN image_descriptions TEXT;
ALTER TABLE characters ADD COLUMN voice_settings TEXT;
ALTER TABLE characters ADD COLUMN has_affinity_system BOOLEAN DEFAULT 0;
ALTER TABLE characters ADD COLUMN affinity_rules TEXT;
ALTER TABLE characters ADD COLUMN affinity_stages TEXT;
ALTER TABLE characters ADD COLUMN custom_module_id CHAR(36);
ALTER TABLE characters ADD COLUMN use_translation BOOLEAN DEFAULT 1; 