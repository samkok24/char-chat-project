"""
samkok24@gmail.com을 관리자로 설정하는 스크립트
"""
import sys
import os
sys.path.insert(0, os.path.dirname(__file__))

import asyncio
from sqlalchemy import select, update, text
from app.core.database import AsyncSessionLocal

async def set_admin():
    async with AsyncSessionLocal() as db:
        try:
            # Raw SQL로 직접 실행 (relationship 오류 회피)
            
            # 1) 유저 조회
            result = await db.execute(
                text("SELECT id, email, username FROM users WHERE email = :email"),
                {"email": "samkok24@gmail.com"}
            )
            row = result.first()
            
            if not row:
                print("❌ samkok24@gmail.com 계정을 찾을 수 없습니다.")
                print("   먼저 해당 이메일로 회원가입을 진행하세요.")
                return
            
            user_id, email, username = row
            
            # 2) is_admin 컬럼 추가 (없으면)
            try:
                await db.execute(text("ALTER TABLE users ADD COLUMN is_admin BOOLEAN DEFAULT 0"))
                await db.commit()
                print("✅ is_admin 컬럼을 추가했습니다.")
            except Exception as e:
                if "duplicate column name" in str(e).lower():
                    print("⚠️  is_admin 컬럼은 이미 존재합니다.")
                else:
                    print(f"⚠️  컬럼 추가 실패 (이미 있을 수 있음): {e}")
                await db.rollback()
            
            # 3) 관리자로 설정
            await db.execute(
                text("UPDATE users SET is_admin = 1 WHERE id = :user_id"),
                {"user_id": str(user_id)}
            )
            await db.commit()
            
            print(f"✅ {email} ({username})을(를) 관리자로 설정했습니다!")
            print(f"   User ID: {user_id}")
            
            # 4) 확인
            check = await db.execute(
                text("SELECT email, username, is_admin FROM users WHERE id = :user_id"),
                {"user_id": str(user_id)}
            )
            confirm = check.first()
            print(f"   확인: email={confirm[0]}, username={confirm[1]}, is_admin={confirm[2]}")
            
        except Exception as e:
            print(f"❌ 오류 발생: {e}")
            import traceback
            traceback.print_exc()
            await db.rollback()

if __name__ == "__main__":
    asyncio.run(set_admin())

