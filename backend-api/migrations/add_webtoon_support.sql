-- 웹툰 지원 마이그레이션
-- story_chapters 테이블에 image_url 컬럼 추가

-- 웹툰 이미지 URL 컬럼 추가 (선택사항)
-- NULL이면 텍스트만 표시 (웹소설)
-- 값이 있으면 이미지만 사용자에게 표시, 텍스트는 AI 프롬프팅용 (웹툰)
ALTER TABLE story_chapters ADD COLUMN image_url VARCHAR(500);

