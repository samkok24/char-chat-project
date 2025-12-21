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
import ssl
from urllib.parse import urlsplit, urlunsplit, parse_qsl, urlencode

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
    _raw_url = settings.DATABASE_URL.replace("postgresql://", "postgresql+asyncpg://")
    # Supabase 등에서 흔히 쓰는 sslmode 파라미터는 asyncpg에서 직접 지원하지 않음.
    # (URL query로 sslmode가 전달되면 asyncpg.connect(...)가 "unexpected keyword argument"로 실패)
    # → sslmode/ssl을 URL에서 제거하고 connect_args로 SSLContext를 전달한다.
    _parts = urlsplit(_raw_url)
    _query_items = parse_qsl(_parts.query, keep_blank_values=True)
    _sslmode = next((v for (k, v) in _query_items if k.lower() == "sslmode"), None)
    _ssl_param = next((v for (k, v) in _query_items if k.lower() == "ssl"), None)
    _query_filtered = [(k, v) for (k, v) in _query_items if k.lower() not in ("sslmode", "ssl")]
    _engine_url = urlunsplit((_parts.scheme, _parts.netloc, _parts.path, urlencode(_query_filtered), _parts.fragment))

    _ssl_required = False
    _ssl_verify = False
    if _ssl_param is not None:
        v = str(_ssl_param).strip().lower()
        if v in ("1", "true", "yes", "on", "require"):
            _ssl_required = True
            _ssl_verify = False
        elif v in ("0", "false", "no", "off", "disable"):
            _ssl_required = False
    if _sslmode is not None:
        v = str(_sslmode).strip().lower()
        # libpq sslmode semantics:
        # - require/prefer: encrypt but DO NOT verify server cert by default
        # - verify-ca/verify-full: verify
        if v in ("require", "prefer"):
            _ssl_required = True
            _ssl_verify = False
        elif v in ("verify-ca", "verify-full"):
            _ssl_required = True
            _ssl_verify = True
        elif v in ("disable", "allow"):
            _ssl_required = False

    _connect_args = {}
    if _ssl_required:
        # asyncpg 'ssl' expects bool or SSLContext.
        # For Supabase, sslmode=require is common but their cert chain may not be in OS trust store.
        # Using a non-verifying context matches libpq's "require" semantics (encrypt only).
        ctx = ssl.create_default_context()
        if not _ssl_verify:
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE
        _connect_args["ssl"] = ctx

    engine = create_async_engine(
        _engine_url,
        echo=settings.DEBUG,
        future=True,
        pool_pre_ping=True,
        pool_recycle=300,
        connect_args=_connect_args if _connect_args else None,
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

