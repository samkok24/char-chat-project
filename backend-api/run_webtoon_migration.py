"""
웹툰 지원 마이그레이션 실행 스크립트
"""

import sqlite3
import os
import sys

def run_migration():
    """웹툰 지원 마이그레이션 실행"""
    # 데이터베이스 경로 (로컬 개발 환경)
    db_path = "data/caveduck.db"
    
    # 마이그레이션 파일 경로
    migration_file = "migrations/add_webtoon_support.sql"
    
    if not os.path.exists(db_path):
        print(f"❌ 데이터베이스 파일을 찾을 수 없습니다: {db_path}")
        print("   Docker 환경인 경우 컨테이너 내에서 실행하세요.")
        return False
    
    if not os.path.exists(migration_file):
        print(f"❌ 마이그레이션 파일을 찾을 수 없습니다: {migration_file}")
        return False
    
    try:
        # 데이터베이스 연결
        print(f"📊 데이터베이스 연결: {db_path}")
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        
        # 마이그레이션 파일 읽기
        with open(migration_file, 'r', encoding='utf-8') as f:
            migration_sql = f.read()
        
        print("\n🔄 마이그레이션 실행 중...")
        
        # 각 SQL 문을 개별적으로 실행
        statements = [s.strip() for s in migration_sql.split(';') if s.strip()]
        
        for statement in statements:
            if statement and not statement.startswith('--'):
                try:
                    print(f"   실행: {statement[:80]}...")
                    cursor.execute(statement)
                except sqlite3.OperationalError as e:
                    if "duplicate column name" in str(e).lower():
                        print(f"   ⚠️  컬럼이 이미 존재합니다 (무시)")
                    else:
                        raise e
        
        # 변경사항 커밋
        conn.commit()
        print("\n✅ 마이그레이션이 성공적으로 완료되었습니다!")
        
        # 현재 스키마 확인
        print("\n📋 story_chapters 테이블 스키마:")
        cursor.execute("PRAGMA table_info(story_chapters)")
        columns = cursor.fetchall()
        for col in columns:
            col_name = col[1]
            col_type = col[2]
            col_null = "NULL" if col[3] == 0 else "NOT NULL"
            print(f"   - {col_name:<20} {col_type:<15} {col_null}")
        
        # image_url 컬럼 확인
        cursor.execute("SELECT COUNT(*) FROM pragma_table_info('story_chapters') WHERE name='image_url'")
        has_image_url = cursor.fetchone()[0] > 0
        
        if has_image_url:
            print("\n🎉 image_url 컬럼이 성공적으로 추가되었습니다!")
        else:
            print("\n⚠️  image_url 컬럼을 찾을 수 없습니다.")
        
        conn.close()
        return True
        
    except Exception as e:
        print(f"\n❌ 마이그레이션 중 오류 발생: {e}")
        import traceback
        traceback.print_exc()
        return False

if __name__ == "__main__":
    print("=" * 60)
    print("🚀 웹툰 지원 마이그레이션")
    print("=" * 60)
    success = run_migration()
    print("=" * 60)
    sys.exit(0 if success else 1)

