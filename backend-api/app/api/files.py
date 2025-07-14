"""
파일 업로드 API
"""
import os
import shutil
from fastapi import APIRouter, UploadFile, File, HTTPException, Depends
from typing import List
import uuid

from app.core.security import get_current_active_user
from app.models.user import User

router = APIRouter()

# 파일을 저장할 기본 디렉토리 (서버 내부 경로)
UPLOAD_DIRECTORY = "/app/data/uploads"

@router.post("/upload", response_model=List[str])
async def upload_files(
    files: List[UploadFile] = File(...),
    current_user: User = Depends(get_current_active_user)
):
    """
    여러 이미지 파일을 업로드하고, 저장된 파일의 URL 목록을 반환합니다.
    """
    # 업로드 디렉토리 생성 (없으면)
    os.makedirs(UPLOAD_DIRECTORY, exist_ok=True)
    
    saved_file_urls = []
    
    for file in files:
        if not file.content_type.startswith("image/"):
            raise HTTPException(status_code=400, detail="이미지 파일만 업로드할 수 있습니다.")
            
        # 파일 이름 중복을 피하기 위해 UUID 사용
        file_extension = os.path.splitext(file.filename)[1]
        saved_filename = f"{uuid.uuid4()}{file_extension}"
        file_path = os.path.join(UPLOAD_DIRECTORY, saved_filename)
        
        try:
            with open(file_path, "wb") as buffer:
                shutil.copyfileobj(file.file, buffer)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"파일 저장 중 오류 발생: {e}")
        finally:
            file.file.close()
            
        # 클라이언트가 접근할 수 있는 URL 경로
        # 실제 운영에서는 Nginx 등을 통해 /static/ 경로를 /app/data/uploads와 매핑해야 합니다.
        file_url = f"/static/{saved_filename}"
        saved_file_urls.append(file_url)
        
    return saved_file_urls
