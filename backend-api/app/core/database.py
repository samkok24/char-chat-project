"""
데이터베이스 설정 및 연결
"""

from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy import MetaData, types
from sqlalchemy.dialects.postgresql import UUID as PostgresUUID
import redis.asyncio as redis
from typing import AsyncGenerator
import uuid

from app.core.config import settings


# SQLite와 PostgreSQL 모두 지원하는 UUID 타입
class UUID(types.TypeDecorator):
    """Platform-independent UUID type.
    
    Uses PostgreSQL's UUID type when available, otherwise uses
    CHAR(36), storing as stringified hex values.
    """
    impl = types.CHAR(36)
    cache_ok = True

    def load_dialect_impl(self, dialect):
        if dialect.name == 'postgresql':
            return dialect.type_descriptor(PostgresUUID(as_uuid=True))
        else:
            return dialect.type_descriptor(types.CHAR(36))

    def process_bind_param(self, value, dialect):
        if value is None:
            return value
        elif dialect.name == 'postgresql':
            return value
        else:
            if isinstance(value, uuid.UUID):
                return str(value)
            else:
                return value

    def process_result_value(self, value, dialect):
        if value is None:
            return value
        elif dialect.name == 'postgresql':
            return value
        else:
            if isinstance(value, uuid.UUID):
                return value
            else:
                return uuid.UUID(value)


# SQLite와 PostgreSQL 모두 지원하는 JSON 타입
class JSON(types.TypeDecorator):
    """Platform-independent JSON type."""
    impl = types.JSON
    cache_ok = True

    def load_dialect_impl(self, dialect):
        if dialect.name == 'postgresql':
            from sqlalchemy.dialects.postgresql import JSONB
            return dialect.type_descriptor(JSONB())
        else:
            return dialect.type_descriptor(types.JSON())

# SQLAlchemy 비동기 엔진 생성
if settings.DATABASE_URL.startswith("sqlite"):
    # SQLite의 경우 URL 변환 없이 사용
    engine = create_async_engine(
        settings.DATABASE_URL,
        echo=settings.DEBUG,
        future=True,
    )
else:
    # PostgreSQL의 경우 asyncpg 드라이버 사용
    engine = create_async_engine(  # ← 이 부분을 else 블록 안으로 들여쓰기
        settings.DATABASE_URL.replace("postgresql://", "postgresql+asyncpg://"),
        echo=settings.DEBUG,
        future=True,
        pool_pre_ping=True,
        pool_recycle=300,
    )

# 세션 팩토리 생성
AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
    autocommit=False,
)

# Redis 연결
redis_client = redis.from_url(settings.REDIS_URL, decode_responses=True)


# Base 클래스 정의
class Base(DeclarativeBase):
    """SQLAlchemy Base 클래스"""
    metadata = MetaData(
        naming_convention={
            "ix": "ix_%(column_0_label)s",
            "uq": "uq_%(table_name)s_%(column_0_name)s",
            "ck": "ck_%(table_name)s_%(constraint_name)s",
            "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
            "pk": "pk_%(table_name)s"
        }
    )


# 데이터베이스 세션 의존성
async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """데이터베이스 세션 의존성"""
    async with AsyncSessionLocal() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


# Redis 클라이언트 의존성
async def get_redis() -> redis.Redis:
    """Redis 클라이언트 의존성"""
    return redis_client


# 데이터베이스 연결 테스트
async def test_db_connection():
    """데이터베이스 연결 테스트"""
    try:
        async with engine.begin() as conn:
            if settings.DATABASE_URL.startswith("sqlite"):
                await conn.exec_driver_sql("SELECT 1")
            else:
                await conn.exec_driver_sql("SELECT 1")
        return True
    except Exception as e:
        print(f"데이터베이스 연결 실패: {e}")
        return False


# Redis 연결 테스트
async def test_redis_connection():
    """Redis 연결 테스트"""
    try:
        await redis_client.ping()
        return True
    except Exception as e:
        print(f"Redis 연결 실패: {e}")
        return False

