"""
데이터베이스 확인 스크립트
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
conn = sqlite3.connect('backend-api/data/test.db')
cursor = conn.cursor()

try:
    # users 테이블의 모든 데이터 조회
    cursor.execute("SELECT id, email, username, created_at FROM users")
    users = cursor.fetchall()
    
    print("=== 사용자 목록 ===")
    if users:
        for user in users:
            print(f"ID: {user[0]}")
            print(f"Email: {user[1]}")
            print(f"Username: {user[2]}")
            print(f"Created: {user[3]}")
            print("-" * 30)
    else:
        print("사용자가 없습니다.")
    
    # 전체 사용자 수
    cursor.execute("SELECT COUNT(*) FROM users")
    count = cursor.fetchone()[0]
    print(f"\n총 사용자 수: {count}")
    
except sqlite3.Error as e:
    print(f"데이터베이스 오류: {e}")
finally:
    conn.close() 