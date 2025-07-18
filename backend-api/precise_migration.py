import sqlite3
import os

# --- 생성해야 할 테이블 목록 ---
# (테이블 이름, [컬럼 정의 리스트])
TABLES_TO_CREATE = {
    "character_example_dialogues": [
        "id CHAR(36) PRIMARY KEY",
        "character_id CHAR(36) NOT NULL",
        "user_message TEXT NOT NULL",
        "character_response TEXT NOT NULL",
        "order_index INTEGER DEFAULT 0",
        "created_at DATETIME DEFAULT (CURRENT_TIMESTAMP)",
        "FOREIGN KEY(character_id) REFERENCES characters(id)"
    ],
    "world_settings": [
        "id CHAR(36) PRIMARY KEY",
        "creator_id CHAR(36) NOT NULL",
        "name VARCHAR(100) NOT NULL",
        "description TEXT NOT NULL",
        "rules TEXT",
        "is_public BOOLEAN DEFAULT 0",
        "usage_count INTEGER DEFAULT 0",
        "created_at DATETIME DEFAULT (CURRENT_TIMESTAMP)",
        "updated_at DATETIME DEFAULT (CURRENT_TIMESTAMP)",
        "FOREIGN KEY(creator_id) REFERENCES users(id)"
    ],
    "custom_modules": [
        "id CHAR(36) PRIMARY KEY",
        "creator_id CHAR(36) NOT NULL",
        "name VARCHAR(100) NOT NULL",
        "description TEXT",
        "custom_prompt TEXT",
        "lorebook TEXT",
        "is_public BOOLEAN DEFAULT 0",
        "usage_count INTEGER DEFAULT 0",
        "created_at DATETIME DEFAULT (CURRENT_TIMESTAMP)",
        "updated_at DATETIME DEFAULT (CURRENT_TIMESTAMP)",
        "FOREIGN KEY(creator_id) REFERENCES users(id)"
    ]
}

# --- 추가해야 할 컬럼 목록 ---
# (테이블 이름, 컬럼 이름, 컬럼 타입 및 제약조건)
COLUMNS_TO_ADD = {
    "users": [
        ("bio", "VARCHAR(500)"),
        ("avatar_url", "VARCHAR(500)")
    ],
    "characters": [
        ("speech_style", "TEXT"),
        ("greeting", "TEXT"),
        ("world_setting", "TEXT"),
        ("user_display_description", "TEXT"),
        ("use_custom_description", "BOOLEAN DEFAULT 0"),
        ("introduction_scenes", "TEXT"), # TEXT for JSON
        ("character_type", "VARCHAR(50) DEFAULT 'roleplay'"),
        ("base_language", "VARCHAR(10) DEFAULT 'ko'"),
        ("image_descriptions", "TEXT"), # TEXT for JSON
        ("voice_settings", "TEXT"), # TEXT for JSON
        ("has_affinity_system", "BOOLEAN DEFAULT 0"),
        ("affinity_rules", "TEXT"),
        ("affinity_stages", "TEXT"), # TEXT for JSON
        ("custom_module_id", "CHAR(36)"),
        ("use_translation", "BOOLEAN DEFAULT 1"),
        ("comment_count", "INTEGER DEFAULT 0")
    ],
    "character_settings": [
        ("custom_prompt_template", "TEXT"),
        ("use_memory", "BOOLEAN DEFAULT 1"),
        ("memory_length", "INTEGER DEFAULT 20"),
        ("response_style", "VARCHAR(50) DEFAULT 'natural'"),
    ]
}

def run_precise_migration():
    """
    기존 DB는 유지한 채, 누락된 컬럼만 안전하게 추가합니다.
    """
    db_path = "/app/data/test.db"
    
    if not os.path.exists(db_path):
        print(f"❌ 데이터베이스 파일을 찾을 수 없습니다: {db_path}")
        return

    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        print(f"✅ 데이터베이스 연결 성공: {db_path}")

        # 1. 테이블 생성
        for table_name, columns in TABLES_TO_CREATE.items():
            columns_sql = ", ".join(columns)
            create_sql = f"CREATE TABLE IF NOT EXISTS {table_name} ({columns_sql})"
            try:
                print(f"🔄 '{table_name}' 테이블 생성 또는 확인 중...")
                cursor.execute(create_sql)
                print(f"  -> ✅ 성공: '{table_name}' 테이블이 준비되었습니다.")
            except sqlite3.OperationalError as e:
                print(f"  -> ❌ 실패: {table_name} 테이블 생성 중 오류 발생 - {e}")

        # 2. 컬럼 추가
        for table, columns in COLUMNS_TO_ADD.items():
            for column_name, column_def in columns:
                try:
                    print(f"🔄 '{table}' 테이블에 '{column_name}' 컬럼 추가 시도...")
                    cursor.execute(f"ALTER TABLE {table} ADD COLUMN {column_name} {column_def}")
                    print(f"  -> ✅ 성공: '{column_name}' 컬럼이 추가되었습니다.")
                except sqlite3.OperationalError as e:
                    if "duplicate column name" in str(e):
                        print(f"  -> ⚠️  이미 존재: '{column_name}' 컬럼은 이미 존재합니다. 건너뜁니다.")
                    else:
                        print(f"  -> ❌ 실패: {e}")
                        # 다른 오류는 전파하여 중단
                        raise e
        
        conn.commit()
        print("\n🎉 모든 마이그레이션 작업이 성공적으로 완료되었습니다!")

        # 최종 스키마 확인
        cursor.execute("PRAGMA table_info(characters)")
        print("\n📊 최종 'characters' 테이블 스키마:")
        for col in cursor.fetchall():
            print(f"  - {col[1]} ({col[2]})")

    except Exception as e:
        print(f"\n❌ 마이그레이션 중 심각한 오류 발생: {e}")
    finally:
        if 'conn' in locals() and conn:
            conn.close()
            print("\n🔌 데이터베이스 연결을 닫았습니다.")

def get_all_table_schemas():
    """DB에 있는 모든 테이블의 스키마를 출력합니다."""
    db_path = "/app/data/test.db"
    
    if not os.path.exists(db_path):
        print(f"❌ 데이터베이스 파일을 찾을 수 없습니다: {db_path}")
        return

    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        print(f"✅ 데이터베이스 연결 성공: {db_path}")

        # 모든 테이블 이름 가져오기
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
        tables = [row[0] for row in cursor.fetchall()]
        print(f"📋 데이터베이스에 있는 테이블: {tables}")

        for table_name in tables:
            print(f"\n📊 '{table_name}' 테이블의 스키마:")
            cursor.execute(f"PRAGMA table_info({table_name})")
            for col in cursor.fetchall():
                print(f"  - {col[1]} ({col[2]})")

    except Exception as e:
        print(f"\n❌ 테이블 스키마 조회 중 오류 발생: {e}")
    finally:
        if 'conn' in locals() and conn:
            conn.close()
            print("\n🔌 데이터베이스 연결을 닫았습니다.")

if __name__ == "__main__":
    run_precise_migration()
    # get_all_table_schemas() 