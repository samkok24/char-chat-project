"""
스토리 분석 기반 캐릭터 생성을 위한 API 라우터
"""
import logging # ◀◀◀ 로깅 모듈 추가
from fastapi import APIRouter, Depends, HTTPException, status
from app.schemas.story_importer import StoryImportRequest, StoryAnalysisResponse
from app.services.story_importer_service import analyze_story_from_text
from app.core.security import get_current_active_user
from app.models.user import User

router = APIRouter()

@router.post("/analyze", response_model=StoryAnalysisResponse)
async def analyze_story_endpoint(
    request: StoryImportRequest,
    current_user: User = Depends(get_current_active_user)
):
    """
    입력된 소설 텍스트를 분석하여 세계관, 캐릭터, 플롯을 추출합니다.
    """
    if len(request.content) > 50000: # 5만자 제한 (추후 변경 가능)
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="입력 가능한 최대 글자 수를 초과했습니다."
        )

    # 방어적: ai_model 허용값 보정 (프론트/유저가 임의 문자열을 보내는 경우 대비)
    ai_model = (request.ai_model or "gemini").strip().lower()
    if ai_model not in ("gemini", "claude", "gpt"):
        try:
            logging.warning(f"[story_importer] invalid ai_model='{request.ai_model}', fallback to gemini")
        except Exception:
            pass
        ai_model = "gemini"

    try:
        analysis_result = await analyze_story_from_text(
            content=request.content, 
            ai_model=ai_model  # type: ignore[arg-type]
        )
        return analysis_result
    except Exception as e:
        # ▼▼▼▼▼ 어떤 에러든 상세 내용을 강제로 로그에 출력 ▼▼▼▼▼
        logging.exception("analyze_story_endpoint에서 예측하지 못한 에러 발생")
        # ▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲

        # 기존 에러 응답은 그대로 유지
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, 
            detail=f"스토리 분석 중 오류 발생: {str(e)}"
        )