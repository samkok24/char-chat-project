from fastapi import Depends
from app.core.database import get_db
from app.core.redis_client import get_redis_client

# 이 파일은 의존성 함수들을 모아두는 곳으로 사용될 수 있습니다.
# 현재는 redis_client만 있지만, 향후 공통 의존성이 생기면 여기에 추가합니다.

__all__ = ["get_db", "get_redis_client"]
