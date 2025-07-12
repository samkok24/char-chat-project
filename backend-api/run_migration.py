"""
결제 테이블 마이그레이션 실행 스크립트
"""
import sqlite3
import os
from pathlib import Path

# DB 경로 설정
db_path = Path("data/test.db")
migration_path = Path("migrations/create_payment_tables.sql")

# DB 연결
conn = sqlite3.connect(db_path)
cursor = conn.cursor()

try:
    # SQL 파일 읽기
    with open(migration_path, 'r', encoding='utf-8') as f:
        sql_script = f.read()
    
    # 마이그레이션 실행
    print("🔄 결제 테이블 마이그레이션 시작...")
    cursor.executescript(sql_script)
    conn.commit()
    
    # 생성된 테이블 확인
    cursor.execute("""
        SELECT name FROM sqlite_master 
        WHERE type='table' AND name LIKE 'payment%' OR name LIKE 'point%' OR name = 'user_points'
        ORDER BY name;
    """)
    
    tables = cursor.fetchall()
    print("\n✅ 생성된 테이블:")
    for table in tables:
        print(f"  - {table[0]}")
    
    # 샘플 데이터 확인
    cursor.execute("SELECT COUNT(*) FROM payment_products")
    product_count = cursor.fetchone()[0]
    print(f"\n📦 결제 상품: {product_count}개")
    
    cursor.execute("SELECT name, price, point_amount, bonus_point FROM payment_products ORDER BY sort_order")
    products = cursor.fetchall()
    for product in products:
        print(f"  - {product[0]}: {product[1]:,}원 → {product[2]:,}P (+{product[3]}P)")
    
    print("\n✅ 마이그레이션 완료!")
    
except Exception as e:
    print(f"❌ 마이그레이션 실패: {e}")
    conn.rollback()
finally:
    conn.close() 