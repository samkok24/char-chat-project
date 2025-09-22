#!/usr/bin/env python3
"""
E2E: 대표 변경 즉시 반영 확인 스크립트

환경변수 또는 인자로 설정:
  API_BASE (기본: http://localhost:8000)
  ACCESS_TOKEN (필수: 오너 계정 토큰)
  ENTITY_TYPE (character|story)
  ENTITY_ID (UUID)

동작:
  1) /media/assets 조회
  2) order를 뒤집어 PATCH /media/assets/order 적용
  3) 엔티티 상세(/characters/:id 또는 /stories/:id)에서 avatar_url/cover_url이 첫 자산 URL과 동일한지 확인
"""
import os
import sys
import json
import time
import requests


def main():
    api_base = os.getenv("API_BASE", "http://localhost:8000").rstrip("/")
    token = os.getenv("ACCESS_TOKEN")
    entity_type = os.getenv("ENTITY_TYPE")
    entity_id = os.getenv("ENTITY_ID")

    if len(sys.argv) >= 2:
        entity_type = entity_type or sys.argv[1]
    if len(sys.argv) >= 3:
        entity_id = entity_id or sys.argv[2]

    if not token:
        print("ACCESS_TOKEN env required", file=sys.stderr)
        sys.exit(2)
    if entity_type not in ("character", "story"):
        print("ENTITY_TYPE must be 'character' or 'story'", file=sys.stderr)
        sys.exit(2)
    if not entity_id:
        print("ENTITY_ID required", file=sys.stderr)
        sys.exit(2)

    headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}

    # 1) assets 조회
    r = requests.get(f"{api_base}/media/assets", params={"entity_type": entity_type, "entity_id": entity_id}, headers=headers, timeout=30)
    r.raise_for_status()
    items = r.json().get("items") if r.headers.get("content-type", "").startswith("application/json") else r.json()
    if not isinstance(items, list) or len(items) < 1:
        print("no assets to test", file=sys.stderr)
        sys.exit(1)

    ordered_ids = [a.get("id") for a in items if a.get("id")]
    urls = [a.get("url") for a in items if a.get("url")]
    if not ordered_ids or not urls:
        print("invalid assets payload", file=sys.stderr)
        sys.exit(1)

    # 뒤집기
    new_order = list(reversed(ordered_ids))
    r = requests.patch(f"{api_base}/media/assets/order", params={"entity_type": entity_type, "entity_id": entity_id, "ordered_ids": new_order}, headers=headers, timeout=30)
    r.raise_for_status()

    # 약간의 지연 후 상세 확인
    time.sleep(0.3)
    if entity_type == "character":
        d = requests.get(f"{api_base}/characters/{entity_id}", headers=headers, timeout=30).json()
        primary = d.get("avatar_url")
    else:
        d = requests.get(f"{api_base}/stories/{entity_id}", headers=headers, timeout=30).json()
        primary = d.get("cover_url")

    # 기대: 첫 자산이 대표가 됨
    # /media/order 구현이 대표 동기화 호출하므로 new_order[0] 자산의 url이 대표
    r = requests.get(f"{api_base}/media/assets", params={"entity_type": entity_type, "entity_id": entity_id}, headers=headers, timeout=30)
    r.raise_for_status()
    items2 = r.json().get("items")
    first_url = items2[0].get("url") if items2 else None

    ok = bool(primary) and primary == first_url
    print(json.dumps({"ok": ok, "primary": primary, "expected": first_url}, ensure_ascii=False))
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()


