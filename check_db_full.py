"""
데이터베이스 전체 확인 스크립트
"""
import sqlite3
import os
from datetime import datetime

# 데이터베이스 경로
db_path = "backend-api/data/test.db"

if not os.path.exists(db_path):
    print(f"❌ 데이터베이스 파일이 없습니다: {db_path}")
    exit(1)

# SQLite 데이터베이스 연결
conn = sqlite3.connect(db_path)
cursor = conn.cursor()

try:
    # users 테이블의 모든 데이터 조회
    print("=== 사용자 목록 ===")
    cursor.execute("SELECT id, email, username, created_at FROM users")
    users = cursor.fetchall()
    
    if users:
        for user in users:
            print(f"ID: {user[0]}")
            print(f"Email: {user[1]}")
            print(f"Username: {user[2]}")
            print(f"Created: {user[3]}")
            print("-" * 30)
    else:
        print("사용자가 없습니다.")
    
    # characters 테이블의 모든 데이터 조회
    print("\n=== 캐릭터 목록 ===")
    cursor.execute("""
        SELECT c.id, c.name, c.description, u.username, c.created_at 
        FROM characters c 
        JOIN users u ON c.creator_id = u.id
    """)
    characters = cursor.fetchall()
    
    if characters:
        for char in characters:
            print(f"ID: {char[0]}")
            print(f"Name: {char[1]}")
            print(f"Description: {char[2][:50]}...")
            print(f"Creator: {char[3]}")
            print(f"Created: {char[4]}")
            print("-" * 30)
    else:
        print("캐릭터가 없습니다.")
    
    # 전체 통계
    cursor.execute("SELECT COUNT(*) FROM users")
    user_count = cursor.fetchone()[0]
    cursor.execute("SELECT COUNT(*) FROM characters")
    char_count = cursor.fetchone()[0]
    
    print(f"\n=== 통계 ===")
    print(f"총 사용자 수: {user_count}")
    print(f"총 캐릭터 수: {char_count}")
    
except sqlite3.Error as e:
    print(f"데이터베이스 오류: {e}")
finally:
    conn.close() 