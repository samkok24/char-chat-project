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
        ss = start_sets
        if not ss:
            return None

        # legacy: JSON 문자열로 저장된 경우 방어
        if isinstance(ss, str):
            try:
                ss = json.loads(ss)
            except Exception:
                return None

        if not isinstance(ss, dict):
            return None

        sim = ss.get("sim_options")
        if sim is None:
            sim = ss.get("simOptions")

        # (방어) sim_options도 문자열 JSON로 저장된 케이스가 있을 수 있다.
        if isinstance(sim, str):
            try:
                sim = json.loads(sim)
            except Exception:
                sim = None

        if not isinstance(sim, dict):
            return None

        raw = sim.get("max_turns", None)
        if raw is None:
            raw = sim.get("maxTurns", None)
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

