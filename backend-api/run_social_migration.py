#!/usr/bin/env python3
"""
스토리 댓글 기능 마이그레이션 실행 스크립트
"""

import asyncio
import asyncpg
import sys
from pathlib import Path
from app.core.config import settings

async def run_migration():
    """마이그레이션 스크립트 실행"""
    
    # 데이터베이스 URL에서 연결 정보 추출
    db_url = settings.DATABASE_URL
    if db_url.startswith("sqlite"):
        print("❌ 이 마이그레이션은 PostgreSQL 전용입니다.")
        print("SQLite 사용 시 수동으로 테이블을 생성해주세요.")
        return False
    
    try:
        # PostgreSQL 연결 정보 파싱
        if db_url.startswith("postgresql://"):
            db_url = db_url.replace("postgresql://", "")
        elif db_url.startswith("postgresql+asyncpg://"):
            db_url = db_url.replace("postgresql+asyncpg://", "")
        
        print("🔄 데이터베이스 연결 중...")
        
        # asyncpg를 사용한 직접 연결
        conn = await asyncpg.connect(f"postgresql://{db_url}")
        
        # 마이그레이션 파일 읽기
        migration_file = Path(__file__).parent / "migrations" / "add_story_comments.sql"
        
        if not migration_file.exists():
            print(f"❌ 마이그레이션 파일을 찾을 수 없습니다: {migration_file}")
            return False
        
        print("📜 마이그레이션 파일 읽기 중...")
        sql_content = migration_file.read_text(encoding='utf-8')
        
        print("⚡ 마이그레이션 실행 중...")
        
        # SQL 실행
        await conn.execute(sql_content)
        
        await conn.close()
        
        print("✅ 스토리 댓글 마이그레이션이 성공적으로 완료되었습니다!")
        print("")
        print("📊 추가된 기능:")
        print("   - story_comments 테이블 생성")
        print("   - stories.comment_count 컬럼 추가")
        print("   - 자동 댓글 수 업데이트 트리거 생성")
        print("")
        print("🎯 이제 다음 API들을 사용할 수 있습니다:")
        print("   - POST /stories/{story_id}/comments")
        print("   - GET /stories/{story_id}/comments")
        print("   - PUT /stories/comments/{comment_id}")
        print("   - DELETE /stories/comments/{comment_id}")
        
        return True
        
    except Exception as e:
        print(f"❌ 마이그레이션 실행 중 오류 발생: {str(e)}")
        return False

async def check_migration_status():
    """마이그레이션 상태 확인"""
    db_url = settings.DATABASE_URL
    if db_url.startswith("sqlite"):
        print("SQLite 환경에서는 상태 확인이 제한적입니다.")
        return
    
    try:
        # PostgreSQL 연결 정보 파싱
        if db_url.startswith("postgresql://"):
            db_url = db_url.replace("postgresql://", "")
        elif db_url.startswith("postgresql+asyncpg://"):
            db_url = db_url.replace("postgresql+asyncpg://", "")
        
        conn = await asyncpg.connect(f"postgresql://{db_url}")
        
        # story_comments 테이블 존재 여부 확인
        table_exists = await conn.fetchval("""
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_name = 'story_comments'
            )
        """)
        
        # stories 테이블에 comment_count 컬럼 존재 여부 확인
        column_exists = await conn.fetchval("""
            SELECT EXISTS (
                SELECT FROM information_schema.columns 
                WHERE table_name = 'stories' AND column_name = 'comment_count'
            )
        """)
        
        await conn.close()
        
        print("📊 마이그레이션 상태:")
        print(f"   - story_comments 테이블: {'✅ 존재' if table_exists else '❌ 없음'}")
        print(f"   - stories.comment_count 컬럼: {'✅ 존재' if column_exists else '❌ 없음'}")
        
        if table_exists and column_exists:
            print("✅ 모든 마이그레이션이 적용되었습니다.")
        else:
            print("⚠️  일부 마이그레이션이 누락되었습니다.")
            
    except Exception as e:
        print(f"❌ 상태 확인 중 오류 발생: {str(e)}")

if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "status":
        asyncio.run(check_migration_status())
    else:
        success = asyncio.run(run_migration())
        if not success:
            sys.exit(1) 