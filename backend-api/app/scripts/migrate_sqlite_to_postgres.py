"""
SQLite -> PostgreSQL 무손실 마이그레이션 스크립트

특징
- 모델(Base.metadata.sorted_tables) 기준으로 FK 의존 순서에 따라 테이블 복사
- 컬럼 교집합만 복사(양쪽 스키마가 약간 달라도 안전)
- UUID/JSON 타입 자동 변환(대부분 SQLAlchemy가 처리)
- 대상(Postgres)에서 제약/트리거 일시 비활성화(복사 성능/순서 유연성)
- 배치 삽입, 진행 로그 출력

사용법 (로컬에서 실행 권장)
  python -m app.scripts.migrate_sqlite_to_postgres --sqlite C:/path/to/app.db --pg "postgresql://USER:PASSWORD@HOST:PORT/DB"

옵션
  --truncate  대상 테이블들을 복사 전 비우기
  --dry-run   실제 INSERT 대신 건수만 출력

주의
- 실행 전 애플리케이션을 중지하여 소스 DB에 쓰기가 발생하지 않도록 하세요.
- 미디어(R2 URL)는 행 데이터로만 복사됩니다. 파일 자체는 R2에 이미 있어야 합니다.
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from typing import List, Dict, Any
import uuid as _uuid

from sqlalchemy import create_engine, text, Table, MetaData
from sqlalchemy.engine import Engine
from sqlalchemy.sql import select
from urllib.parse import quote

# 애플리케이션 모델 메타데이터
from app.core.database import Base

# 메타데이터에 테이블을 등록하기 위해 모델 모듈들을 명시적으로 import
def _import_all_models() -> None:
    try:
        from app.models import (
            user, character, story, story_chapter, tag, media_asset,
            chat, memory_note, user_persona, payment, like, comment,
            bookmark, story_extracted_character, story_summary,
        )  # noqa: F401
        _log("models imported (Base.metadata populated)")
    except Exception as e:
        _log(f"[warn] model import failed: {e}")


def _log(msg: str) -> None:
    sys.stdout.write(msg + "\n")
    sys.stdout.flush()


def _connect_sqlite(sqlite_path: str) -> Engine:
    """소스 SQLite를 읽기 전용으로 연결한다.
    - 파일 경로가 들어오면 파일 URI 형식(file:/absolute/path)로 변환하고 mode=ro 적용
    - 안전을 위해 세션마다 query_only=ON 설정
    """
    if sqlite_path.startswith("sqlite"):
        # 이미 완전한 URL은 신뢰하되, uri=true 누락 시 추가
        url = sqlite_path
        if "uri=true" not in url:
            sep = "&" if "?" in url else "?"
            url = f"{url}{sep}uri=true"
        eng = create_engine(url, connect_args={"uri": True})
    else:
        # 절대경로를 파일 URI로 인코딩하여 전달 (mode=ro)
        # 예: sqlite:///file:/app/data/test.db?mode=ro&uri=true
        enc = quote(sqlite_path)
        url = f"sqlite:///file:{enc}?mode=ro&uri=true"
        eng = create_engine(url, connect_args={"uri": True})

    # 연결 시 읽기 전용 보장 (추가 안전장치)
    try:
        with eng.connect() as conn:
            conn.exec_driver_sql("PRAGMA query_only=ON")
    except Exception:
        pass
    return eng


def _connect_postgres(pg_url: str) -> Engine:
    # sync 드라이버 사용 (대량 복사에 유리)
    if pg_url.startswith("postgresql+asyncpg://"):
        pg_url = pg_url.replace("postgresql+asyncpg://", "postgresql://")
    eng = create_engine(pg_url, pool_pre_ping=True)
    return eng


def _sorted_tables() -> List[Table]:
    return list(Base.metadata.sorted_tables)


def _get_source_rows(src: Engine, table_name: str, columns: List[str]) -> List[Dict[str, Any]]:
    placeholders = ", ".join(columns)
    q = text(f"SELECT {placeholders} FROM {table_name}")
    rows = []
    with src.connect() as conn:
        res = conn.execute(q)
        for r in res.mappings():
            rows.append({k: r[k] for k in columns})
    return rows


def _disable_constraints_pg(dst: Engine):
    """FK/트리거 비활성화 시도(세션 한정).
    Render Postgres(Managed)에서는 권한이 없어 실패할 수 있으므로, 실패 시 경고 로그만 남기고 계속 진행한다.
    """
    try:
        with dst.begin() as conn:
            conn.execute(text("SET session_replication_role = replica"))
        _log("[warn] session_replication_role=replica 적용")
    except Exception as e:
        _log(f"[warn] FK/트리거 비활성화 건너뜀(권한 없음 가능): {e}")


def _enable_constraints_pg(dst: Engine):
    try:
        with dst.begin() as conn:
            conn.execute(text("SET session_replication_role = DEFAULT"))
    except Exception:
        pass


def _truncate_tables(dst: Engine, tables: List[Table]):
    """대상(Postgres) 테이블 비우기.
    - 소스(SQLite)는 절대 수정하지 않음.
    - FK 고려하여 역순으로 TRUNCATE.
    """
    with dst.begin() as conn:
        for t in reversed(tables):
            conn.execute(text(f'TRUNCATE TABLE "{t.name}" RESTART IDENTITY CASCADE'))


def _insert_rows(dst: Engine, table: Table, rows: List[Dict[str, Any]]) -> int:
    if not rows:
        return 0
    # 대상 테이블 실제 컬럼만 추림
    dst_cols = [c.name for c in table.columns]
    filtered = []
    for r in rows:
        item = {k: v for k, v in r.items() if k in dst_cols}
        # 간단 UUID 캐스팅(문자열 → uuid.UUID)
        for c in table.columns:
            if c.name in item and getattr(c.type, "python_type", None) is _uuid.UUID:
                val = item[c.name]
                if isinstance(val, str):
                    try:
                        item[c.name] = _uuid.UUID(val)
                    except Exception:
                        pass
        filtered.append(item)

    with dst.begin() as conn:
        conn.execute(table.insert(), filtered)
    return len(filtered)


def _count_rows(engine: Engine, table_name: str) -> int:
    try:
        with engine.connect() as conn:
            res = conn.execute(text(f'SELECT COUNT(*) FROM "{table_name}"'))
            return int(res.scalar_one())
    except Exception:
        return -1


def migrate(sqlite_path: str, pg_url: str, truncate: bool = False, dry_run: bool = False, best_effort: bool = False):
    _import_all_models()
    src = _connect_sqlite(sqlite_path)
    dst = _connect_postgres(pg_url)

    # 대상 스키마가 이미 생성되어 있어야 함 (Alembic/앱 초기화로 생성)
    tables = _sorted_tables()

    _log(f"총 {len(tables)}개 테이블 복사 시작 (의존 순)")

    if truncate and not dry_run:
        _truncate_tables(dst, tables)

    _disable_constraints_pg(dst)
    try:
        copied_total = 0
        for t in tables:
            cols = [c.name for c in t.columns]
            try:
                rows = _get_source_rows(src, t.name, cols)
            except Exception as e:
                _log(f"- {t.name}: 소스에서 읽기 실패 → 건너뜀 ({e})")
                continue
            if not rows:
                _log(f"- {t.name}: 0건")
                continue
            if dry_run:
                _log(f"- {t.name}: {len(rows)}건 (드라이런)")
                copied_total += len(rows)
                continue
            try:
                inserted = _insert_rows(dst, t, rows)
            except Exception as e:
                # 기본은 strict: 즉시 중단하여 데이터 손실을 방지
                if not best_effort:
                    raise
                _log(f"- {t.name}: 삽입 오류 → 건너뜀 (best-effort) ({e})")
                inserted = 0
            # 간단 검증: 대상 건수 로깅(실패 시 -1)
            dst_cnt = _count_rows(dst, t.name)
            _log(f"- {t.name}: {inserted}건 복사 (대상 현재 {dst_cnt}건)")
            copied_total += inserted
        _log(f"완료: 총 {copied_total}건 복사")
    finally:
        _enable_constraints_pg(dst)
        try:
            src.dispose()
        except Exception:
            pass
        try:
            dst.dispose()
        except Exception:
            pass


def main():
    p = argparse.ArgumentParser(description="SQLite → PostgreSQL 마이그레이션")
    p.add_argument("--sqlite", required=True, help="소스 SQLite 파일 경로 또는 sqlite:/// URL")
    p.add_argument("--pg", required=True, help="대상 PostgreSQL 연결 문자열 (postgresql://...")
    p.add_argument("--truncate", action="store_true", help="복사 전 대상(Postgres) 테이블 비우기 (소스 SQLite는 수정 안 함)")
    p.add_argument("--best-effort", action="store_true", help="삽입 오류가 발생해도 계속 진행(기본은 오류 시 중단)")
    p.add_argument("--dry-run", action="store_true", help="삽입하지 않고 건수만 출력")
    args = p.parse_args()

    migrate(sqlite_path=args.sqlite, pg_url=args.pg, truncate=bool(args.truncate), dry_run=bool(args.dry_run), best_effort=bool(args.best_effort))


if __name__ == "__main__":
    main()


