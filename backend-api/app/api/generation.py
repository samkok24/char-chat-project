from fastapi import APIRouter, Depends, HTTPException, Request, BackgroundTasks
from sse_starlette.sse import EventSourceResponse
import asyncio
import json
from uuid import uuid4

from app.core.redis_client import redis_client, get_redis_client
from app.services.generation_service import generation_service
from app.schemas.story import StoryGenerationRequest # This will be changed
from app.models.user import User
from app.core.security import get_current_user_or_guest

router = APIRouter()

# --- API Endpoints ---

@router.post("/preview")
async def generate_preview(request: Request):
    body = await request.json()
    prompt = body.get("prompt")
    if not prompt:
        raise HTTPException(status_code=400, detail="Prompt is required.")

    user_id = body.get("user_id", "guest")
    
    stream_id = f"{user_id}:{uuid4()}"
    task_id = f"task:{uuid4()}"

    client = await get_redis_client()
    await client.hset(f"generation:stream:{stream_id}", mapping={
        "task_id": task_id,
        "status": "pending_preview",
        "user_id": str(user_id)
    })
    await client.expire(f"generation:stream:{stream_id}", 3600)
    
    await client.hset(f"generation:task:{task_id}", mapping={ "status": "pending", "stream_id": stream_id })
    await client.expire(f"generation:task:{task_id}", 3600)

    # Schedule background async task
    asyncio.create_task(generation_service.generate_preview_stream(prompt, task_id, stream_id))

    return {"stream_id": stream_id}

@router.post("/canvas")
async def generate_canvas(request: Request):
    body = await request.json()
    canvas_task_id = body.get("canvas_task_id")
    if not canvas_task_id:
        raise HTTPException(status_code=400, detail="canvas_task_id is required.")

    client = await get_redis_client()
    task_data = await client.hgetall(f"generation:task:{canvas_task_id}")
    if not task_data or task_data.get("status") != "preview_complete":
        raise HTTPException(status_code=404, detail="Valid canvas task not found or not ready.")

    user_id = body.get("user_id", "guest")
    
    stream_id = f"{user_id}:{uuid4()}"

    await client.hset(f"generation:stream:{stream_id}", mapping={
        "task_id": canvas_task_id,
        "status": "pending_canvas",
        "user_id": str(user_id)
    })
    await client.expire(f"generation:stream:{stream_id}", 3600)

    asyncio.create_task(generation_service.generate_canvas_stream(canvas_task_id, stream_id))

    return {"stream_id": stream_id}


@router.get("/stream/{stream_id}")
async def stream_generation(request: Request, stream_id: str):
    
    async def event_generator():
        client = await get_redis_client()
        pubsub = client.pubsub()
        await pubsub.subscribe(f"stream:{stream_id}")
        try:
            while True:
                message = await pubsub.get_message(ignore_subscribe_messages=True, timeout=30)
                if message is not None:
                    event_data = json.loads(message['data'])
                    if event_data.get("event") == "close":
                        break
                    yield event_data
                await asyncio.sleep(1)
        except asyncio.CancelledError:
            pass
        finally:
            try:
                await pubsub.unsubscribe(f"stream:{stream_id}")
            except Exception:
                pass

    client = await get_redis_client()
    stream_info = await client.hgetall(f"generation:stream:{stream_id}")
    if not stream_info:
        async def close_stream():
            yield {"event": "error", "data": json.dumps({"message":"Stream not found"})}
            yield {"event": "close"}
        return EventSourceResponse(close_stream())
    
    return EventSourceResponse(event_generator())


@router.post("/stop")
async def stop_generation(request: Request):
    body = await request.json()
    stream_id = body.get("stream_id")
    if not stream_id:
        raise HTTPException(status_code=400, detail="stream_id is required.")

    client = await get_redis_client()
    stream_info = await client.hgetall(f"generation:stream:{stream_id}")
    if stream_info and "task_id" in stream_info:
        task_id = stream_info["task_id"]
        await client.hset(f"generation:task:{task_id}", "status", "stopped")
        close_event = {"event": "close", "data": "Stream stopped by user"}
        await client.publish(f"stream:{stream_id}", json.dumps(close_event))
    await client.delete(f"generation:stream:{stream_id}")

    return {"status": "stopped"}
