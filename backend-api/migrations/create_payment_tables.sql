-- 결제 상품 테이블
CREATE TABLE IF NOT EXISTS payment_products (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    name VARCHAR(100) NOT NULL,
    description TEXT,
    price INTEGER NOT NULL,  -- 원화 기준
    point_amount INTEGER NOT NULL,  -- 지급 포인트
    bonus_point INTEGER DEFAULT 0,  -- 보너스 포인트
    is_active BOOLEAN DEFAULT true,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 결제 내역 테이블
CREATE TABLE IF NOT EXISTS payments (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    user_id TEXT NOT NULL REFERENCES users(id),
    product_id TEXT REFERENCES payment_products(id),
    amount INTEGER NOT NULL,
    point_amount INTEGER NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',  -- pending, success, failed, cancelled
    payment_method VARCHAR(50),  -- card, kakao_pay, naver_pay, toss
    payment_key VARCHAR(200) UNIQUE,  -- PG사 고유 키
    order_id VARCHAR(200) UNIQUE NOT NULL,
    transaction_data TEXT,  -- JSON 형태로 저장
    failed_reason TEXT,
    paid_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 포인트 거래 내역 테이블
CREATE TABLE IF NOT EXISTS point_transactions (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    user_id TEXT NOT NULL REFERENCES users(id),
    type VARCHAR(20) NOT NULL,  -- charge, use, refund, bonus
    amount INTEGER NOT NULL,  -- 양수: 충전, 음수: 사용
    balance_after INTEGER NOT NULL,  -- 거래 후 잔액
    description VARCHAR(200),
    reference_type VARCHAR(50),  -- payment, chat, story, etc
    reference_id TEXT,  -- 관련 레코드 ID
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 사용자 포인트 잔액 테이블
CREATE TABLE IF NOT EXISTS user_points (
    user_id TEXT PRIMARY KEY REFERENCES users(id),
    balance INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
    total_charged INTEGER DEFAULT 0,
    total_used INTEGER DEFAULT 0,
    last_charged_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_payments_user ON payments(user_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
CREATE INDEX IF NOT EXISTS idx_payments_created ON payments(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_point_tx_user ON point_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_point_tx_created ON point_transactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_point_tx_type ON point_transactions(type);

-- 샘플 결제 상품 데이터 삽입
INSERT INTO payment_products (name, description, price, point_amount, bonus_point, sort_order) VALUES
('스타터 팩', '첫 구매자를 위한 특별 혜택!', 1000, 100, 0, 1),
('베이직 팩', '가장 인기있는 상품', 4500, 500, 50, 2),
('프리미엄 팩', '10% 추가 보너스!', 8500, 1000, 150, 3),
('얼티밋 팩', '20% 추가 보너스!', 24000, 3000, 600, 4); 