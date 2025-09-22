from fastapi import APIRouter, Depends, HTTPException, status, Query, UploadFile, File
from typing import List, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update, delete

from app.core.database import get_db
from app.core.security import get_current_active_user
from app.models.user import User
from app.models.media_asset import MediaAsset
from app.schemas.media_asset import MediaAssetResponse, MediaAssetListResponse
from app.core.paths import get_upload_dir
from app.services.storage import get_storage
import os, shutil, uuid, base64, requests
from app.models.character import Character
from app.models.story import Story


router = APIRouter()


@router.get("/assets", response_model=MediaAssetListResponse)
async def list_assets(
    entity_type: Optional[str] = Query(None),
    entity_id: Optional[str] = Query(None),
    presign: bool = Query(False, description="Return presigned URLs instead of public URLs"),
    expires_in: int = Query(300, ge=60, le=3600),
    db: AsyncSession = Depends(get_db),
):
    q = select(MediaAsset)
    if entity_type:
        q = q.where(MediaAsset.entity_type == entity_type)
    if entity_id:
        q = q.where(MediaAsset.entity_id == entity_id)
    q = q.order_by(MediaAsset.is_primary.desc(), MediaAsset.order_index.asc(), MediaAsset.created_at.desc())
    rows = (await db.execute(q)).scalars().all()
    items = [MediaAssetResponse.model_validate(r) for r in rows]
    if presign:
        try:
            from app.services.storage import get_storage
            storage = get_storage()
            for it in items:
                # key 추출: public_base가 있으면 public_base 뒤 경로, 없으면 endpoint/bucket 뒤 경로
                url = it.url or ""
                key = None
                # public_base_url 사용 시
                public_base = (os.getenv('S3_PUBLIC_BASE_URL') or os.getenv('R2_PUBLIC_BASE_URL') or '').rstrip('/')
                if public_base and url.startswith(public_base + "/"):
                    key = url[len(public_base)+1:]
                # endpoint/bucket 경로일 경우
                if key is None:
                    endpoint = (os.getenv('S3_ENDPOINT_URL') or os.getenv('R2_ENDPOINT_URL') or '').rstrip('/')
                    bucket = os.getenv('S3_BUCKET') or os.getenv('R2_BUCKET') or ''
                    prefix = f"{endpoint}/{bucket}/"
                    if endpoint and bucket and url.startswith(prefix):
                        key = url[len(prefix):]
                if key:
                    ps = storage.generate_presigned_url(key, expires_in=expires_in)
                    if ps:
                        it.url = ps
        except Exception:
            pass
    return MediaAssetListResponse(items=items)


async def _assert_owner(db: AsyncSession, user: User, entity_type: str, entity_id: str):
    if entity_type == "character" or entity_type == "origchat":
        row = (await db.execute(select(Character).where(Character.id == entity_id))).scalars().first()
        if not row:
            raise HTTPException(status_code=404, detail="character not found")
        if str(row.creator_id) != str(user.id):
            raise HTTPException(status_code=403, detail="forbidden")
    elif entity_type == "story":
        row = (await db.execute(select(Story).where(Story.id == entity_id))).scalars().first()
        if not row:
            raise HTTPException(status_code=404, detail="story not found")
        if str(row.creator_id) != str(user.id):
            raise HTTPException(status_code=403, detail="forbidden")
    else:
        raise HTTPException(status_code=400, detail="invalid entity_type")


async def _sync_primary_to_entity(db: AsyncSession, entity_type: str, entity_id: str):
    # 대표 자산 URL 조회
    q = select(MediaAsset).where(MediaAsset.entity_type == entity_type, MediaAsset.entity_id == entity_id).order_by(MediaAsset.is_primary.desc(), MediaAsset.order_index.asc(), MediaAsset.created_at.desc())
    asset = (await db.execute(q)).scalars().first()
    if not asset:
        return
    # 캐시 버스트를 위해 버전 파라미터 추가
    new_url = asset.url
    try:
        import time as _time
        if new_url and "?" not in new_url:
            new_url = f"{new_url}?v={int(_time.time())}"
        elif new_url and "?" in new_url and "v=" not in new_url:
            new_url = f"{new_url}&v={int(_time.time())}"
    except Exception:
        pass
    if entity_type == "character" or entity_type == "origchat":
        await db.execute(update(Character).where(Character.id == entity_id).values(avatar_url=new_url))
    elif entity_type == "story":
        await db.execute(update(Story).where(Story.id == entity_id).values(cover_url=new_url))
    await db.commit()


@router.patch("/assets/{asset_id}", response_model=MediaAssetResponse)
async def update_asset(
    asset_id: str,
    is_primary: Optional[bool] = Query(None),
    order_index: Optional[int] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    row = (await db.execute(select(MediaAsset).where(MediaAsset.id == asset_id))).scalars().first()
    if not row:
        raise HTTPException(status_code=404, detail="asset not found")
    # 간단 권한: 본인 소유 또는 연결 엔티티 소유 여부는 후속 보강
    if row.entity_type and row.entity_id:
        await _assert_owner(db, current_user, row.entity_type, row.entity_id)
    elif row.user_id and row.user_id != str(current_user.id):
        raise HTTPException(status_code=403, detail="forbidden")
    values = {}
    if is_primary is not None:
        values[MediaAsset.is_primary] = is_primary
    if order_index is not None:
        values[MediaAsset.order_index] = order_index
    if values:
        await db.execute(update(MediaAsset).where(MediaAsset.id == asset_id).values(**{c.key: v for c, v in values.items()}))
        await db.commit()
        row = (await db.execute(select(MediaAsset).where(MediaAsset.id == asset_id))).scalars().first()
        # 대표 변경 시 엔티티 대표 URL 동기화
        if row.entity_type and row.entity_id and (is_primary is not None or order_index is not None):
            await _sync_primary_to_entity(db, row.entity_type, row.entity_id)
    return MediaAssetResponse.model_validate(row)


@router.delete("/assets/{asset_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_asset(
    asset_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    row = (await db.execute(select(MediaAsset).where(MediaAsset.id == asset_id))).scalars().first()
    if not row:
        return
    if row.entity_type and row.entity_id:
        await _assert_owner(db, current_user, row.entity_type, row.entity_id)
    elif row.user_id and row.user_id != str(current_user.id):
        raise HTTPException(status_code=403, detail="forbidden")
    await db.execute(delete(MediaAsset).where(MediaAsset.id == asset_id))
    await db.commit()
    return


# --- Generation stub endpoints ---

def _size_from_ratio(ratio: Optional[str]) -> str:
    m = (ratio or '').strip()
    return {
        '1:1': '1024x1024',
        '3:4': '768x1024',
        '4:3': '1024x768',
        '16:9': '1280x720',
        '9:16': '720x1280',
    }.get(m, '1024x1024')


@router.post("/generate", response_model=MediaAssetListResponse)
async def generate_images_endpoint(
    entity_type: Optional[str] = Query(None),
    entity_id: Optional[str] = Query(None),
    count: int = Query(1, ge=1, le=8),
    prompt: str = Query(""),
    negative_prompt: Optional[str] = Query(None),
    provider: Optional[str] = Query(None),
    model: Optional[str] = Query(None),
    ratio: Optional[str] = Query('1:1'),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    # 권한 확인: 부착 예정이라면 오너 검증
    if entity_type and entity_id:
        await _assert_owner(db, current_user, entity_type, entity_id)

    if not provider:
        raise HTTPException(status_code=400, detail="provider required")

    storage = get_storage()
    created: List[MediaAsset] = []

    if provider == 'openai':
        api_key = os.getenv('OPENAI_API_KEY')
        if not api_key:
            raise HTTPException(status_code=503, detail="OPENAI_API_KEY not set")
        endpoint = 'https://api.openai.com/v1/images/generations'
        size = _size_from_ratio(ratio)
        headers = { 'Authorization': f'Bearer {api_key}', 'Content-Type': 'application/json' }
        try:
            # DALL·E 3 / gpt-image-1는 n=1 제한이 있을 수 있어 1장씩 반복 호출
            total = max(1, int(count or 1))
            for _ in range(total):
                resp = requests.post(endpoint, headers=headers, json={
                    'model': model or 'gpt-image-1',
                    'prompt': prompt,
                    'n': 1,
                    'size': size,
                    'response_format': 'b64_json'
                }, timeout=120)
                if resp.status_code >= 400:
                    # OpenAI 에러 메시지를 그대로 노출해 디버깅 용이
                    raise HTTPException(status_code=503, detail=f"openai error {resp.status_code}: {resp.text}")
                data = resp.json()
                items = data.get('data', [])
                for it in items:
                    b64 = it.get('b64_json')
                    url = it.get('url')
                    if b64:
                        raw = base64.b64decode(b64)
                        asset_url = storage.save_bytes(raw, content_type="image/png", key_hint="gen.png")
                    elif url:
                        asset_url = url
                    else:
                        continue
                    asset = MediaAsset(
                        id=str(uuid.uuid4()),
                        user_id=str(current_user.id),
                        entity_type=entity_type,
                        entity_id=entity_id,
                        url=asset_url,
                        provider='openai',
                        model=(model or 'gpt-image-1'),
                        status='ready',
                    )
                    db.add(asset)
                    created.append(asset)
            await db.commit()
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=503, detail=f"openai generation failed: {e}")
    elif provider == 'gemini':
        # Google GenAI SDK (new)
        try:
            from google import genai as google_genai  # type: ignore
        except Exception:
            raise HTTPException(status_code=503, detail="google-genai SDK not installed")

        api_key = os.getenv('GOOGLE_API_KEY') or os.getenv('GEMINI_API_KEY')
        if not api_key:
            raise HTTPException(status_code=503, detail="GOOGLE_API_KEY or GEMINI_API_KEY not set")

        client = google_genai.Client(api_key=api_key)
        use_model = model or "gemini-2.5-flash-image-preview"
        try:
            # count장 반복 생성 (각 요청 1개로 가정)
            total = max(1, int(count or 1))
            for _ in range(total):
                resp = client.models.generate_content(
                    model=use_model,
                    contents=[prompt],
                )
                for cand in (resp.candidates or []):
                    parts = getattr(cand, 'content', None)
                    parts = getattr(parts, 'parts', []) if parts else []
                    for part in parts:
                        inline = getattr(part, 'inline_data', None)
                        if inline is None:
                            continue
                        blob = getattr(inline, 'data', None)
                        if blob is None:
                            continue
                        mime_type = getattr(inline, 'mime_type', None) or 'image/png'
                        # google-genai 의 inline_data.data 는 보통 raw bytes
                        if isinstance(blob, (bytes, bytearray)):
                            raw = bytes(blob)
                        else:
                            # 혹시 문자열(base64)로 올 경우 대비
                            try:
                                raw = base64.b64decode(blob)
                            except Exception:
                                # 알 수 없는 형식은 건너뜀
                                continue
                        # 확장자 힌트
                        ext = '.png'
                        if isinstance(mime_type, str):
                            if 'jpeg' in mime_type or 'jpg' in mime_type:
                                ext = '.jpg'
                            elif 'webp' in mime_type:
                                ext = '.webp'
                            elif 'png' in mime_type:
                                ext = '.png'
                        # 캐시 갱신을 위해 쿼리 파라미터로 짧은 버전 스탬프 추가
                        asset_url = storage.save_bytes(raw, content_type=mime_type, key_hint=f"gen{ext}")
                        try:
                            if asset_url and "?" not in asset_url:
                                asset_url = f"{asset_url}?v={int(__import__('time').time())}"
                        except Exception:
                            pass
                        asset = MediaAsset(
                            id=str(uuid.uuid4()),
                            user_id=str(current_user.id),
                            entity_type=entity_type,
                            entity_id=entity_id,
                            url=asset_url,
                            provider='gemini',
                            model=use_model,
                            status='ready',
                        )
                        db.add(asset)
                        created.append(asset)
            await db.commit()
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=503, detail=f"gemini generation failed: {e}")
    else:
        raise HTTPException(status_code=400, detail="unsupported provider")

    # 대표 동기화(부착된 경우)
    if entity_type and entity_id:
        await _sync_primary_to_entity(db, entity_type, entity_id)
        # 최신 목록 반환
        q = select(MediaAsset).where(MediaAsset.entity_type == entity_type, MediaAsset.entity_id == entity_id).order_by(MediaAsset.is_primary.desc(), MediaAsset.order_index.asc(), MediaAsset.created_at.desc())
        rows = (await db.execute(q)).scalars().all()
        return MediaAssetListResponse(items=[MediaAssetResponse.model_validate(r) for r in rows])

    return MediaAssetListResponse(items=[MediaAssetResponse.model_validate(a) for a in created])

@router.get("/jobs/{job_id}")
async def generation_job_status(job_id: str):
    return {"id": job_id, "status": "pending"}


@router.post("/jobs/{job_id}/cancel")
async def cancel_generation_job(job_id: str):
    # 현재 동기 생성이므로 실제 취소는 클라이언트 AbortController로 처리.
    # 추후 비동기 잡 큐 도입 시 상태 저장 로직 연계.
    return {"id": job_id, "status": "cancelled"}


@router.post("/events")
async def track_media_event(
    event: str = Query(..., description="generate_start|generate_success|generate_cancel|attach_commit|delete|reorder"),
    entity_type: Optional[str] = Query(None),
    entity_id: Optional[str] = Query(None),
    count: Optional[int] = Query(None),
):
    try:
        import logging
        logging.getLogger("uvicorn.access").info(
            f"media_event event={event} entity_type={entity_type} entity_id={entity_id} count={count}"
        )
    except Exception:
        pass
    return {"ok": True}


@router.post("/assets/attach", response_model=MediaAssetListResponse)
async def attach_assets(
    entity_type: str = Query(...),
    entity_id: str = Query(...),
    asset_ids: List[str] = Query(...),
    as_primary: bool = Query(False),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    await _assert_owner(db, current_user, entity_type, entity_id)
    # 순서대로 부착. 첫 항목이 as_primary면 대표로 설정
    attached: List[MediaAsset] = []
    for idx, aid in enumerate(asset_ids):
        row = (await db.execute(select(MediaAsset).where(MediaAsset.id == aid))).scalars().first()
        if not row:
            continue
        # 소유자 설정(없으면)
        if not row.user_id:
            row.user_id = str(current_user.id)
        row.entity_type = entity_type
        row.entity_id = entity_id
        # 대표 지정은 첫 번째만
        if as_primary and idx == 0:
            row.is_primary = True
            row.order_index = 0
            # 기존 대표 해제는 별도 endpoint에서 처리 예정(간단화를 위해 생략)
        else:
            # 뒤에 배치
            row.order_index = row.order_index or 9999
        attached.append(row)
    await db.commit()
    await _sync_primary_to_entity(db, entity_type, entity_id)
    # 반환: 해당 엔티티 자산 목록
    q = select(MediaAsset).where(MediaAsset.entity_type == entity_type, MediaAsset.entity_id == entity_id).order_by(MediaAsset.is_primary.desc(), MediaAsset.order_index.asc(), MediaAsset.created_at.desc())
    rows = (await db.execute(q)).scalars().all()
    return MediaAssetListResponse(items=[MediaAssetResponse.model_validate(r) for r in rows])


@router.patch("/assets/order", response_model=MediaAssetListResponse)
async def reorder_assets(
    entity_type: str = Query(...),
    entity_id: str = Query(...),
    ordered_ids: List[str] = Query(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    await _assert_owner(db, current_user, entity_type, entity_id)
    # 순서 저장
    for idx, aid in enumerate(ordered_ids):
        await db.execute(update(MediaAsset).where(MediaAsset.id == aid, MediaAsset.entity_type == entity_type, MediaAsset.entity_id == entity_id).values(order_index=idx))
    await db.commit()
    await _sync_primary_to_entity(db, entity_type, entity_id)
    q = select(MediaAsset).where(MediaAsset.entity_type == entity_type, MediaAsset.entity_id == entity_id).order_by(MediaAsset.is_primary.desc(), MediaAsset.order_index.asc(), MediaAsset.created_at.desc())
    rows = (await db.execute(q)).scalars().all()
    return MediaAssetListResponse(items=[MediaAssetResponse.model_validate(r) for r in rows])


@router.delete("/assets", status_code=status.HTTP_204_NO_CONTENT)
async def bulk_delete_assets(
    asset_ids: List[str] = Query(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    # 권한 체크: 엔티티 부착된 경우 오너만
    rows = (await db.execute(select(MediaAsset).where(MediaAsset.id.in_(asset_ids)))).scalars().all()
    for r in rows:
        if r.entity_type and r.entity_id:
            await _assert_owner(db, current_user, r.entity_type, r.entity_id)
        elif r.user_id and r.user_id != str(current_user.id):
            raise HTTPException(status_code=403, detail="forbidden")
    await db.execute(delete(MediaAsset).where(MediaAsset.id.in_(asset_ids)))
    await db.commit()
    return


@router.patch("/assets/detach", response_model=MediaAssetListResponse)
async def detach_assets(
    asset_ids: List[str] = Query(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    # 권한: 부착된 엔티티가 있다면 오너만, 없으면 자신의 자산만
    rows = (await db.execute(select(MediaAsset).where(MediaAsset.id.in_(asset_ids)))).scalars().all()
    for r in rows:
        if r.entity_type and r.entity_id:
            await _assert_owner(db, current_user, r.entity_type, r.entity_id)
        elif r.user_id and r.user_id != str(current_user.id):
            raise HTTPException(status_code=403, detail="forbidden")
    for r in rows:
        r.entity_type = None
        r.entity_id = None
        r.is_primary = False
        r.order_index = 0
    await db.commit()
    return MediaAssetListResponse(items=[MediaAssetResponse.model_validate(r) for r in rows])


@router.post("/upload", response_model=MediaAssetListResponse)
async def upload_images(
    files: List[UploadFile] = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    storage = get_storage()
    created: List[MediaAsset] = []
    for f in files:
        if not f.content_type or not f.content_type.startswith("image/"):
            raise HTTPException(status_code=400, detail="이미지 파일만 업로드할 수 있습니다.")
        ext = os.path.splitext(f.filename or "")[1] or ".png"
        # 메모리에 올려 저장(파일 크기가 큰 경우 스트리밍 업로드로 개선 가능)
        buf = f.file.read()
        url = storage.save_bytes(buf, content_type=f.content_type or "image/png", key_hint=f"upload{ext}")
        asset = MediaAsset(
            id=str(uuid.uuid4()),
            user_id=str(current_user.id),
            url=url,
            status="ready",
        )
        db.add(asset)
        created.append(asset)
    await db.commit()
    return MediaAssetListResponse(items=[MediaAssetResponse.model_validate(a) for a in created])




