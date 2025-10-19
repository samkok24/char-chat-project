"""
agent_contents 테이블에 피드 발행 컬럼 추가
"""
import sqlite3
import os

def add_feed_columns():
    db_path = "/app/data/test.db"
    
    if not os.path.exists(db_path):
        print(f"❌ DB 파일이 없습니다: {db_path}")
        return
    
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    try:
        # 현재 스키마 확인
        cursor.execute("PRAGMA table_info(agent_contents)")
        columns = [row[1] for row in cursor.fetchall()]
        print(f"✅ 현재 컬럼: {columns}")
        
        # is_published 컬럼 추가
        if 'is_published' not in columns:
            print("📝 is_published 컬럼 추가 중...")
            cursor.execute("""
                ALTER TABLE agent_contents 
                ADD COLUMN is_published INTEGER DEFAULT 0 NOT NULL
            """)
            print("✅ is_published 컬럼 추가 완료")
        else:
            print("ℹ️ is_published 컬럼 이미 존재")
        
        # published_at 컬럼 추가
        if 'published_at' not in columns:
            print("📝 published_at 컬럼 추가 중...")
            cursor.execute("""
                ALTER TABLE agent_contents 
                ADD COLUMN published_at TIMESTAMP NULL
            """)
            print("✅ published_at 컬럼 추가 완료")
        else:
            print("ℹ️ published_at 컬럼 이미 존재")
        
        # 인덱스 추가
        try:
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_agent_contents_is_published 
                ON agent_contents(is_published)
            """)
            print("✅ 인덱스 추가 완료")
        except Exception as e:
            print(f"⚠️ 인덱스 추가 실패 (무시): {e}")
        
        conn.commit()
        
        # 최종 스키마 확인
        cursor.execute("PRAGMA table_info(agent_contents)")
        columns = [row[1] for row in cursor.fetchall()]
        print(f"\n✅ 최종 컬럼: {columns}")
        
        print("\n🎉 마이그레이션 완료!")
        
    except Exception as e:
        print(f"❌ 에러 발생: {e}")
        conn.rollback()
    finally:
        conn.close()

if __name__ == "__main__":
    add_feed_columns()

