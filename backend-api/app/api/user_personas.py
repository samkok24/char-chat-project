"""
유저 페르소나 API 엔드포인트
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
import uuid
from typing import List

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.user import User
from app.schemas.user_persona import (
    UserPersonaCreate, 
    UserPersonaUpdate, 
    UserPersonaResponse, 
    UserPersonasListResponse,
    SetActivePersonaRequest
)
from app.services import user_persona_service

router = APIRouter()


@router.post("/", response_model=UserPersonaResponse, status_code=status.HTTP_201_CREATED)
async def create_user_persona_api(
    persona_data: UserPersonaCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """새로운 유저 페르소나 생성"""
    return await user_persona_service.create_user_persona(db, persona_data, current_user.id)


@router.get("/", response_model=UserPersonasListResponse)
async def get_user_personas_api(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """사용자의 모든 페르소나 목록 조회"""
    personas = await user_persona_service.get_personas_by_user(db, current_user.id)
    active_persona = await user_persona_service.get_active_persona_by_user(db, current_user.id)
    
    return {
        "personas": personas,
        "total_count": len(personas),
        "active_persona": active_persona
    }


@router.get("/{persona_id}", response_model=UserPersonaResponse)
async def get_user_persona_api(
    persona_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """단일 유저 페르소나 조회"""
    persona = await user_persona_service.get_user_persona_by_id(db, persona_id)
    if not persona or persona.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="페르소나를 찾을 수 없거나 접근 권한이 없습니다.")
    return persona


@router.put("/{persona_id}", response_model=UserPersonaResponse)
async def update_user_persona_api(
    persona_id: uuid.UUID,
    persona_data: UserPersonaUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """유저 페르소나 업데이트"""
    updated_persona = await user_persona_service.update_user_persona(db, persona_id, persona_data, current_user.id)
    if not updated_persona:
        raise HTTPException(status_code=404, detail="페르소나를 찾을 수 없거나 접근 권한이 없습니다.")
    return updated_persona


@router.delete("/{persona_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user_persona_api(
    persona_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """유저 페르소나 삭제"""
    success = await user_persona_service.delete_user_persona(db, persona_id, current_user.id)
    if not success:
        raise HTTPException(status_code=404, detail="페르소나를 찾을 수 없거나 접근 권한이 없습니다.")


@router.post("/set-active", response_model=UserPersonaResponse)
async def set_active_persona_api(
    request: SetActivePersonaRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """활성 페르소나 설정"""
    active_persona = await user_persona_service.set_active_persona(db, request.persona_id, current_user.id)
    if not active_persona:
        raise HTTPException(status_code=404, detail="페르소나를 찾을 수 없거나 접근 권한이 없습니다.")
    return active_persona


@router.get("/active/current", response_model=UserPersonaResponse)
async def get_current_active_persona_api(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """현재 활성 페르소나 조회"""
    active_persona = await user_persona_service.get_active_persona_by_user(db, current_user.id)
    if not active_persona:
        raise HTTPException(status_code=404, detail="활성 페르소나가 없습니다.")
    return active_persona