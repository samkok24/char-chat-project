-- 유저 페르소나 테이블 생성
CREATE TABLE IF NOT EXISTS user_personas (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name VARCHAR(100) NOT NULL,
    description TEXT NOT NULL,
    is_active BOOLEAN DEFAULT FALSE,
    is_default BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_user_personas_user_id ON user_personas(user_id);

-- 기본 페르소나와 활성 페르소나를 위한 부분 인덱스
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_personas_active_user 
ON user_personas(user_id) WHERE is_active = TRUE;

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_personas_default_user 
ON user_personas(user_id) WHERE is_default = TRUE;