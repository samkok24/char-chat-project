#!/bin/bash
# Celery Worker 시작 스크립트

echo "Starting Celery Worker for char_chat..."
celery -A app.core.celery_app worker --loglevel=info --concurrency=2


