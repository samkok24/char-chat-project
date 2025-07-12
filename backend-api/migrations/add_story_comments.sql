-- 스토리 댓글 기능 추가 마이그레이션
-- 실행 날짜: 2024-01-15

-- story_comments 테이블 생성
CREATE TABLE IF NOT EXISTS story_comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    story_id UUID NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_story_comments_story_id ON story_comments(story_id);
CREATE INDEX IF NOT EXISTS idx_story_comments_user_id ON story_comments(user_id);
CREATE INDEX IF NOT EXISTS idx_story_comments_created_at ON story_comments(created_at DESC);

-- stories 테이블에 comment_count 컬럼 추가
ALTER TABLE stories 
ADD COLUMN IF NOT EXISTS comment_count INTEGER DEFAULT 0;

-- 기존 스토리들의 comment_count 초기화 (현재 댓글 수로 설정)
UPDATE stories 
SET comment_count = (
    SELECT COUNT(*) 
    FROM story_comments 
    WHERE story_comments.story_id = stories.id
);

-- 트리거 함수 생성 (댓글 추가/삭제 시 자동으로 comment_count 업데이트)
CREATE OR REPLACE FUNCTION update_story_comment_count()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE stories SET comment_count = comment_count + 1 WHERE id = NEW.story_id;
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        UPDATE stories SET comment_count = comment_count - 1 WHERE id = OLD.story_id;
        RETURN OLD;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- 트리거 생성
DROP TRIGGER IF EXISTS story_comment_count_trigger ON story_comments;
CREATE TRIGGER story_comment_count_trigger
    AFTER INSERT OR DELETE ON story_comments
    FOR EACH ROW
    EXECUTE FUNCTION update_story_comment_count();

-- 완료 메시지
DO $$
BEGIN
    RAISE NOTICE '스토리 댓글 기능 마이그레이션이 완료되었습니다.';
    RAISE NOTICE '- story_comments 테이블 생성';
    RAISE NOTICE '- stories.comment_count 컬럼 추가';
    RAISE NOTICE '- 자동 댓글 수 업데이트 트리거 생성';
END $$; 