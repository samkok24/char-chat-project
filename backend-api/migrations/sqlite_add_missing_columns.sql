-- SQLite 마이그레이션: 누락된 컬럼 추가
-- 기존 데이터베이스에 새로운 필드들을 추가합니다

-- characters 테이블에 누락된 컬럼 추가
ALTER TABLE characters ADD COLUMN speech_style TEXT;
ALTER TABLE characters ADD COLUMN world_setting TEXT;
ALTER TABLE characters ADD COLUMN user_display_description TEXT;
ALTER TABLE characters ADD COLUMN use_custom_description BOOLEAN DEFAULT 0;
ALTER TABLE characters ADD COLUMN introduction_scenes TEXT;
ALTER TABLE characters ADD COLUMN start_sets TEXT;
ALTER TABLE characters ADD COLUMN character_type VARCHAR(50) DEFAULT 'roleplay';
ALTER TABLE characters ADD COLUMN base_language VARCHAR(10) DEFAULT 'ko';
ALTER TABLE characters ADD COLUMN image_descriptions TEXT;
ALTER TABLE characters ADD COLUMN voice_settings TEXT;
ALTER TABLE characters ADD COLUMN has_affinity_system BOOLEAN DEFAULT 0;
ALTER TABLE characters ADD COLUMN affinity_rules TEXT;
ALTER TABLE characters ADD COLUMN affinity_stages TEXT;
ALTER TABLE characters ADD COLUMN custom_module_id CHAR(36);
ALTER TABLE characters ADD COLUMN use_translation BOOLEAN DEFAULT 1; 

-- 태그 시스템 테이블 (존재 시 무시)
CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  emoji TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS character_tags (
  character_id TEXT NOT NULL,
  tag_id TEXT NOT NULL,
  PRIMARY KEY (character_id, tag_id),
  FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

-- users 테이블에 누락된 컬럼 추가
ALTER TABLE users ADD COLUMN gender TEXT DEFAULT 'male';
ALTER TABLE users ADD COLUMN avatar_url TEXT;
ALTER TABLE users ADD COLUMN bio TEXT;
-- 응답 길이 선호도(짧게/중간/많이)
ALTER TABLE users ADD COLUMN response_length_pref TEXT DEFAULT 'medium';

-- chat_rooms 요약 컬럼 추가 (존재 시 무시)
ALTER TABLE chat_rooms ADD COLUMN summary TEXT;

-- 메시지 테이블: 추천/비추천 컬럼 추가 (존재 시 무시)
ALTER TABLE chat_messages ADD COLUMN upvotes INTEGER DEFAULT 0;
ALTER TABLE chat_messages ADD COLUMN downvotes INTEGER DEFAULT 0;

-- 메시지 수정 이력 테이블
CREATE TABLE IF NOT EXISTS chat_message_edits (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  old_content TEXT NOT NULL,
  new_content TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (message_id) REFERENCES chat_messages(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- stories 테이블: is_origchat 컬럼 추가 (존재 시 무시)
ALTER TABLE stories ADD COLUMN is_origchat BOOLEAN DEFAULT 0;
-- characters 테이블: origin_story_id 컬럼 추가 (존재 시 무시)
ALTER TABLE characters ADD COLUMN origin_story_id CHAR(36);

-- story_chapters 테이블: view_count 컬럼 추가 (존재 시 무시)
ALTER TABLE story_chapters ADD COLUMN view_count INTEGER DEFAULT 0;