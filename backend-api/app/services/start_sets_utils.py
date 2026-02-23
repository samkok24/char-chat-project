"""
start_sets(JSON) 관련 유틸리티.

의도/원리(SSOT):
- start_sets는 일반 캐릭터챗 위저드의 "런타임 SSOT" 저장소(JSON)다.
- 프론트의 격자 카드(턴수 배지)와 채팅 진행도 UI는 `max_turns`(총 진행 턴수)를 필요로 한다.
- 하지만 목록/랭킹 응답은 start_sets 전체를 포함하지 않으므로, 서버가 start_sets에서 파생 값을 안전하게 추출해 내려준다.
"""

from __future__ import annotations

from typing import Any, Optional
import json


def _loads_maybe_json(raw: Any, *, max_depth: int = 3) -> Any:
    """
    문자열 JSON이 여러 번 중첩된 레거시 데이터를 방어적으로 해제한다.
    - 예: '"{\"sim_options\": {\"max_turns\": 200}}"' 같은 이중 인코딩 케이스
    """
    cur = raw
    for _ in range(max_depth):
        if not isinstance(cur, str):
            break
        s = cur.strip()
        if not s:
            return None
        try:
            cur = json.loads(s)
        except Exception:
            return None
    return cur


def coerce_start_sets_dict(start_sets: Any) -> Optional[dict]:
    """
    다양한 레거시 형태에서 start_sets dict를 최대한 복구한다.

    지원:
    - dict
    - JSON 문자열(단일/중첩 인코딩)
    - 래퍼 구조: {"basic_info":{"start_sets":...}} / {"start_sets": {...}}
    """
    try:
        ss = _loads_maybe_json(start_sets)
        if not isinstance(ss, dict):
            return None

        # 래퍼 구조 방어: {"basic_info":{"start_sets": ...}}
        basic_info = _loads_maybe_json(ss.get("basic_info"))
        if isinstance(basic_info, dict):
            nested = _loads_maybe_json(basic_info.get("start_sets"))
            if isinstance(nested, dict):
                ss = nested

        # 래퍼 구조 방어: {"start_sets": {...}}
        nested_root = _loads_maybe_json(ss.get("start_sets"))
        if isinstance(nested_root, dict):
            # sim_options/max_turns 힌트가 있으면 내부를 SSOT로 채택
            if (
                ("sim_options" in nested_root)
                or ("simOptions" in nested_root)
                or ("max_turns" in nested_root)
                or ("maxTurns" in nested_root)
            ):
                ss = nested_root

        return ss
    except Exception:
        return None


def extract_max_turns_from_start_sets(start_sets: Any) -> Optional[int]:
    """
    start_sets에서 sim_options.max_turns를 방어적으로 추출한다.

    지원 형태(레거시/혼합 키 방어):
    - start_sets: dict | JSON 문자열
    - sim_options 키: `sim_options` | `simOptions`
    - max_turns 키: `max_turns` | `maxTurns`

    반환:
    - 정상 숫자면 int (상한 5000으로 클램프)
    - 추출/파싱 실패 또는 값이 비정상(<=0)이면 None
    """
    try:
        if not start_sets:
            return None

        ss = coerce_start_sets_dict(start_sets)
        if not isinstance(ss, dict):
            return None

        sim = _loads_maybe_json(ss.get("sim_options"))
        if sim is None:
            sim = _loads_maybe_json(ss.get("simOptions"))

        raw = None
        if isinstance(sim, dict):
            raw = sim.get("max_turns", None)
            if raw is None:
                raw = sim.get("maxTurns", None)
        # 레거시/오염 방어: 루트에 max_turns가 있는 케이스도 허용
        if raw is None:
            raw = ss.get("max_turns", None)
        if raw is None:
            raw = ss.get("maxTurns", None)
        if raw is None:
            return None

        # bool은 int로 캐스팅되면(1/0) 오해 소지가 있어 제외
        if isinstance(raw, bool):
            return None

        try:
            s = str(raw).strip()
            if not s:
                return None
            n = int(float(s))
        except Exception:
            return None

        if n <= 0:
            return None

        # (방어) 정상 범위로 클램프
        if n > 5000:
            n = 5000

        return n
    except Exception:
        return None

