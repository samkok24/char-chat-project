"""
SQLite 데이터베이스 마이그레이션 실행 스크립트
"""

import sqlite3
import os
import sys

def run_migration():
    """마이그레이션 실행"""
    # 데이터베이스 경로
    db_path = "/app/data/test.db"
    
    # 마이그레이션 파일 경로
    migration_file = "/app/migrations/sqlite_add_missing_columns.sql"
    
    if not os.path.exists(db_path):
        print(f"❌ 데이터베이스 파일을 찾을 수 없습니다: {db_path}")
        return False
    
    if not os.path.exists(migration_file):
        print(f"❌ 마이그레이션 파일을 찾을 수 없습니다: {migration_file}")
        return False
    
    try:
        # 데이터베이스 연결
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        
        # 마이그레이션 파일 읽기
        with open(migration_file, 'r', encoding='utf-8') as f:
            migration_sql = f.read()
        
        # 각 SQL 문을 개별적으로 실행
        statements = [s.strip() for s in migration_sql.split(';') if s.strip()]
        
        for statement in statements:
            if statement and not statement.startswith('--'):
                try:
                    print(f"실행 중: {statement[:50]}...")
                    cursor.execute(statement)
                except sqlite3.OperationalError as e:
                    if "duplicate column name" in str(e):
                        print(f"⚠️  컬럼이 이미 존재합니다: {e}")
                    else:
                        raise e
        
        # 변경사항 커밋
        conn.commit()
        print("✅ 마이그레이션이 성공적으로 완료되었습니다!")
        
        # 현재 스키마 확인
        cursor.execute("PRAGMA table_info(characters)")
        columns = cursor.fetchall()
        print("\n📊 characters 테이블 컬럼:")
        for col in columns:
            print(f"  - {col[1]} ({col[2]})")
        
        conn.close()
        return True
        
    except Exception as e:
        print(f"❌ 마이그레이션 중 오류 발생: {e}")
        return False

if __name__ == "__main__":
    success = run_migration()
    sys.exit(0 if success else 1) 