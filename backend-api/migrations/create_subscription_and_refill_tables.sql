-- 구독 플랜 + 무료 리필 + 회차 구매 테이블 마이그레이션
-- 대상: PostgreSQL 운영 서버
-- 실행: psql -f create_subscription_and_refill_tables.sql

-- ============================================================
-- 1. 무료 리필 버킷 상태 (타이머: 2시간마다 루비 1개)
-- ============================================================
CREATE TABLE IF NOT EXISTS user_refill_states (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    timer_bucket INTEGER NOT NULL DEFAULT 0
        CONSTRAINT check_timer_bucket_non_negative CHECK (timer_bucket >= 0)
        CONSTRAINT check_timer_bucket_max_15 CHECK (timer_bucket <= 15),
    timer_last_refill_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================================
-- 2. 회차 구매 기록 (유료 회차 영구 소유)
-- ============================================================
CREATE TABLE IF NOT EXISTS chapter_purchases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    story_id UUID NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
    chapter_no INTEGER NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT uq_user_story_chapter UNIQUE (user_id, story_id, chapter_no)
);

CREATE INDEX IF NOT EXISTS idx_chapter_purchases_user ON chapter_purchases(user_id);
CREATE INDEX IF NOT EXISTS idx_chapter_purchases_story ON chapter_purchases(story_id);

-- ============================================================
-- 3. 구독 플랜 정의 (free / basic / premium)
-- ============================================================
CREATE TABLE IF NOT EXISTS subscription_plans (
    id VARCHAR(20) PRIMARY KEY,
    name VARCHAR(50) NOT NULL,
    price INTEGER NOT NULL DEFAULT 0,
    monthly_ruby INTEGER DEFAULT 0,
    refill_speed_multiplier INTEGER DEFAULT 1,
    free_chapters BOOLEAN DEFAULT FALSE,
    model_discount_pct INTEGER DEFAULT 0,
    sort_order INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================================
-- 4. 사용자 구독 상태
-- ============================================================
CREATE TABLE IF NOT EXISTS user_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    plan_id VARCHAR(20) NOT NULL REFERENCES subscription_plans(id),
    status VARCHAR(20) DEFAULT 'active',
    started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT uq_user_subscriptions_user_id UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS idx_user_subscriptions_plan ON user_subscriptions(plan_id);

-- ============================================================
-- 5. 구독 플랜 시드 데이터 (conflict 시 skip)
-- ============================================================
INSERT INTO subscription_plans (id, name, price, monthly_ruby, refill_speed_multiplier, free_chapters, model_discount_pct, sort_order)
VALUES
    ('free',    '무료',      0,     0,   1, FALSE, 0,  0),
    ('basic',   '베이직',    9900,  150, 2, TRUE,  10, 1),
    ('premium', '프리미엄',  29900, 500, 4, TRUE,  30, 2)
ON CONFLICT (id) DO NOTHING;
