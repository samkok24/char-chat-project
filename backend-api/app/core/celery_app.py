"""
Celery 백그라운드 작업 설정
"""

from celery import Celery
from app.core.config import settings

celery_app = Celery(
    "char_chat",
    broker=settings.REDIS_URL,
    backend=settings.REDIS_URL
)

celery_app.conf.update(
    task_serializer='json',
    accept_content=['json'],
    result_serializer='json',
    timezone='Asia/Seoul',
    enable_utc=True,
    task_track_started=True,
    task_ignore_result=False,
    result_expires=3600,
    # 태스크 자동 발견
    imports=('app.tasks.feed_tasks',)
)


