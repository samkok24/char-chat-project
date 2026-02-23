"""
롤플/시뮬 자동생성 결과물을 A/B 비교한다.

의도:
- 현재 작업본(working tree)과, 마지막 커밋(HEAD)의 SYSTEM_PROMPT를 각각 사용해
  동일 입력으로 LLM 결과물을 생성하고 나란히 비교한다.

주의:
- 이 스크립트는 외부 LLM 호출이 필요하므로 네트워크/키 설정이 없으면 실패할 수 있다.
"""

from __future__ import annotations

import asyncio
import os
import re
import subprocess
import sys
from dataclasses import dataclass


@dataclass(frozen=True)
class SampleInput:
    name: str
    description: str
    tags: list[str]
    max_turns: int
    allow_infinite_mode: bool
    ai_model: str


def _read_file_text(path: str) -> str:
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


def _git_show(path_in_repo: str) -> str:
    # HEAD 기준 파일 내용을 가져온다(읽기 전용).
    out = subprocess.check_output(["git", "show", f"HEAD:{path_in_repo}"], stderr=subprocess.STDOUT)
    return out.decode("utf-8", errors="replace")


def _extract_triple_quoted_constant(py_text: str, const_name: str) -> str:
    # const_name = """ ... """
    pattern = re.compile(rf"{re.escape(const_name)}\s*=\s*\"\"\"([\s\S]*?)\"\"\"", re.MULTILINE)
    m = pattern.search(py_text)
    if not m:
        raise RuntimeError(f"Failed to extract {const_name}")
    return m.group(1)


def _build_user_prompt_sim(inp: SampleInput, *, style_note: str) -> str:
    tags_block = ", ".join([t.strip() for t in inp.tags if str(t).strip()])[:400]
    mt = int(inp.max_turns or 0)
    if mt < 50:
        mt = 200
    if mt > 5000:
        mt = 5000
    inf = "허용" if bool(inp.allow_infinite_mode) else "미허용"
    return f"""
[프로필 입력(근거)]
- 이름: {inp.name}
- 소개: {inp.description}
- 태그: {tags_block or "없음"}

[출력 요구사항]
- 위 SYSTEM 가이드/템플릿을 따라 '시뮬레이션 캐릭터 시트'를 작성하라.
- 반드시 한국어로 작성하라.
- 출력은 JSON 금지. 순수 텍스트(마크다운 섹션/불릿 허용).
  - 코드블록은 원칙적으로 금지하되, 'HUD/상태창' 섹션에서만 NOTE 코드블록 1개까지 허용한다(남발 금지).
  - 3000~6000자(공백 포함) 사이로 작성하라.
- {style_note}
- 이름은 입력된 이름을 그대로 사용하라(형식 유지).
- ✅ 추가 필수 지시(게임 설계):
  - 이 캐릭터 챗은 총 **{mt}턴**을 기준으로 진행된다.
  - 이용자가 입력한 프롬프트(세계관/상황)에 맞게 턴당 사건(갈등/미션/선택)을 몰입감 있게 기획하라.
  - 각 사건에는 체감 가능한 보상(정보/단서/관계 진전/권한/아이템 등)을 설계하라.
  - 위 설계를 프롬프트 본문에 [턴 진행/사건 & 보상 설계] 섹션으로 포함하라.
  - 무한모드 허용: {inf} (정책을 본문에 명시하라).
""".strip()


def _build_user_prompt_rp(inp: SampleInput) -> str:
    tags_block = ", ".join([t.strip() for t in inp.tags if str(t).strip()])[:400]
    return f"""
[프로필 입력(근거)]
- 이름: {inp.name}
- 소개: {inp.description}
- 태그: {tags_block or "없음"}

[출력 요구사항]
- 위 SYSTEM 가이드/템플릿을 따라 '1:1 롤플레잉 캐릭터 시트'를 작성하라. (시뮬/턴/보상/진행률 설계 금지)
- 반드시 한국어로 작성하라.
- 출력은 JSON 금지. 순수 텍스트(마크다운 섹션/불릿 허용).
  - 코드블록은 원칙적으로 금지하되, '상태창(선택)' 섹션에서만 INFO 코드블록 1개까지 허용한다(남발 금지).
  - 3000~6000자(공백 포함) 사이로 작성하라.
- 이름은 입력된 이름을 그대로 사용하라(형식 유지).
""".strip()


async def _run_one(label: str, prompt: str, *, model: str) -> str:
    try:
        # 내부 서비스의 get_ai_completion을 그대로 사용한다.
        from app.services.ai_service import get_ai_completion  # type: ignore

        out = await get_ai_completion(prompt=prompt, model=model, temperature=0.4, max_tokens=1600)
        return out
    except Exception as e:
        # 환경에 의존성이 없을 수 있으므로, 프롬프트만이라도 비교할 수 있게 에러를 반환한다.
        return f"[ERROR] {label}: {type(e).__name__}: {e}"


async def main() -> None:
    repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    os.chdir(repo_root)
    # backend-api/app 패키지를 import 가능하게 만든다.
    backend_api_root = os.path.join(repo_root, "backend-api")
    if backend_api_root not in sys.path:
        sys.path.insert(0, backend_api_root)
    # Windows 콘솔(cp949)에서도 깨지지 않게 UTF-8로 출력 시도
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]
    except Exception:
        pass

    cur_path = os.path.join(repo_root, "backend-api", "app", "services", "quick_character_service.py")
    cur = _read_file_text(cur_path)
    old = _git_show("backend-api/app/services/quick_character_service.py")

    cur_sim = _extract_triple_quoted_constant(cur, "SIMULATOR_PROMPT_SYSTEM")
    cur_rp = _extract_triple_quoted_constant(cur, "ROLEPLAY_PROMPT_SYSTEM")
    old_sim = _extract_triple_quoted_constant(old, "SIMULATOR_PROMPT_SYSTEM")
    old_rp = _extract_triple_quoted_constant(old, "ROLEPLAY_PROMPT_SYSTEM")

    # 안전한(데모 친화) 샘플 입력: 과도한 성인 지향을 유도하지 않게 중립/일상 톤
    sample_sim = SampleInput(
        name="캠퍼스의 비밀 조교",
        description="늦은 밤 연구동에서 조교와 단둘이 마주친다. 사라진 연구 노트, 누군가의 익명 쪽지, 잠긴 실험실. 매 턴 선택으로 단서를 모으고 관계와 위험도가 바뀐다.",
        tags=["캠퍼스", "미스터리", "일상", "추리"],
        max_turns=200,
        allow_infinite_mode=False,
        ai_model="gemini",
    )
    sample_rp = SampleInput(
        name="서늘한 도서관 사서",
        description="도서관 폐관 직전, 사서가 금서 보관함 열쇠를 쥐고 있다. 당신은 사서의 신뢰를 얻어야 한다. 대화는 서늘하지만 점점 가까워진다.",
        tags=["현대", "미스터리", "일상"],
        max_turns=200,
        allow_infinite_mode=False,
        ai_model="gemini",
    )

    style_before = "문체는 과도한 형식미보다 몰입감 있게 작성하라."
    style_after = "문체/스토리 스타일: 국내 실유저(커뮤니티) 시뮬 톤에 맞춰 자연스러운 한국어로 쓴다(번역투/과도한 포멀 금지, 사건/진행 중심)."

    # SIM
    prompt_sim_before = f"{old_sim}\n\n{_build_user_prompt_sim(sample_sim, style_note=style_before)}"
    prompt_sim_after = f"{cur_sim}\n\n{_build_user_prompt_sim(sample_sim, style_note=style_after)}"

    # RP
    prompt_rp_before = f"{old_rp}\n\n{_build_user_prompt_rp(sample_rp)}"
    prompt_rp_after = f"{cur_rp}\n\n{_build_user_prompt_rp(sample_rp)}"

    tasks = [
        _run_one("SIM BEFORE", prompt_sim_before, model=sample_sim.ai_model),
        _run_one("SIM AFTER", prompt_sim_after, model=sample_sim.ai_model),
        _run_one("RP BEFORE", prompt_rp_before, model=sample_rp.ai_model),
        _run_one("RP AFTER", prompt_rp_after, model=sample_rp.ai_model),
    ]
    sim_before, sim_after, rp_before, rp_after = await asyncio.gather(*tasks)

    def _hr(title: str) -> str:
        return "\n" + ("=" * 18) + f" {title} " + ("=" * 18) + "\n"

    # 의존성(google.generativeai 등)이 없는 환경에서는 결과가 [ERROR]로 떨어질 수 있다.
    # 그런 경우, 프롬프트 자체라도 출력해서 A/B 비교가 가능하게 한다.
    def _is_error(s: str) -> bool:
        return str(s or "").lstrip().startswith("[ERROR]")

    if _is_error(sim_before) or _is_error(sim_after) or _is_error(rp_before) or _is_error(rp_after):
        print(_hr("NOTICE"))
        print("LLM 호출 의존성이 없어 결과 생성이 실패했습니다. 대신 A/B 프롬프트 원문을 출력합니다.")

        print(_hr("SIM PROMPT BEFORE") + prompt_sim_before)
        print(_hr("SIM PROMPT AFTER") + prompt_sim_after)
        print(_hr("RP PROMPT BEFORE") + prompt_rp_before)
        print(_hr("RP PROMPT AFTER") + prompt_rp_after)
        return

    print(_hr("SIM BEFORE") + sim_before)
    print(_hr("SIM AFTER") + sim_after)
    print(_hr("RP BEFORE") + rp_before)
    print(_hr("RP AFTER") + rp_after)


if __name__ == "__main__":
    asyncio.run(main())

