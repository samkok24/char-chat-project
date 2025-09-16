import asyncio
import json
import uuid
from typing import AsyncGenerator, Dict, Any

from app.core.redis_client import get_redis_client
from app.services.ai_service import get_ai_completion_stream, AIModel

class GenerationService:
    def __init__(self):
        self.writer_prompt = """
당신은 **웹소설 전문 작가**입니다. 사용자의 요청에 따라 흥미진진한 웹소설을 작성해주세요.

【필수 요구사항】
1. **분량**: 사용자가 요청한 분량에 맞춰서 작성하세요. 특별한 지정이 없다면, 3000자 내외로 작성하세요.
2. **주인공**: 사용자가 지정한 주인공 설정을 따르되, 특별한 지정이 없다면 입체적이고 매력적인 인물로 만들어주세요.
3. **구성**:
   - 도입부: 강렬한 훅으로 시작
   - 전개부: 긴장감 있는 전개와 갈등 심화
   - 절정부: 감정적 클라이맥스
   - 결말부: 여운을 남기는 마무리
4. **문체**: 몰입감 높은 3인칭 시점, 생생한 묘사와 대화
5. **필수 요소**: 최소 1개의 반전과 2개의 긴장 고조 지점
"""

    async def _call_ai_stream(self, prompt: str, model: AIModel = "gemini", sub_model: str = None) -> AsyncGenerator[str, None]:
        """AI 모델을 스트리밍 방식으로 호출합니다."""
        full_prompt = f"{self.writer_prompt}\n\n---\n\n{prompt}"
        
        async for chunk in get_ai_completion_stream(
            prompt=full_prompt,
            model=model,
            sub_model=sub_model,
            temperature=0.8,
            max_tokens=4000
        ):
            yield chunk

    async def generate_preview_stream(self, prompt: str, task_id: str, stream_id: str) -> None:
        """Phase 1: 프리뷰 스트림 생성 (최대 500자)"""
        
        client = await get_redis_client()
        content_buffer = ""
        char_count = 0
        
        try:
            async for chunk in self._call_ai_stream(prompt):
                content_buffer += chunk
                char_count += len(chunk)

                event = { "event": "message", "data": json.dumps({"type": "content", "text": chunk}) }
                await client.publish(f"stream:{stream_id}", json.dumps(event))

                if char_count >= 500:
                    status = await client.hget(f"generation:task:{task_id}", "status")
                    if status == "stopped":
                        raise asyncio.CancelledError()
                    break
            
            await client.hset(f"generation:task:{task_id}", mapping={
                "status": "preview_complete",
                "prompt": prompt,
                "preview_content": content_buffer,
                "full_content": content_buffer
            })
            await client.expire(f"generation:task:{task_id}", 3600)

            done_event = { "event": "done", "data": json.dumps({"type": "preview_complete", "canvas_task_id": task_id}) }
            await client.publish(f"stream:{stream_id}", json.dumps(done_event))

        except (Exception, asyncio.CancelledError) as e:
            await client.hset(f"generation:task:{task_id}", "status", "failed")
            error_event = { "event": "error", "data": json.dumps({"message": str(e)}) }
            await client.publish(f"stream:{stream_id}", json.dumps(error_event))
        finally:
            close_event = {"event": "close"}
            await client.publish(f"stream:{stream_id}", json.dumps(close_event))


    async def generate_canvas_stream(self, task_id: str, stream_id: str) -> None:
        """Phase 2: 캔버스(본문) 스트림 생성"""
        
        client = await get_redis_client()
        task_data = await client.hgetall(f"generation:task:{task_id}")
        if not task_data:
            error_event = { "event": "error", "data": json.dumps({"message": "Task not found."}) }
            await client.publish(f"stream:{stream_id}", json.dumps(error_event))
            close_event = {"event": "close"}
            await client.publish(f"stream:{stream_id}", json.dumps(close_event))
            return

        prompt = task_data.get("prompt", "")
        continue_prompt = f"{prompt}\n\n---\n\n위 내용에 이어서 다음 이야기를 계속 작성해주세요. 이전 내용은 다시 반복하지 마세요."
        
        full_content = task_data.get("preview_content", "")
        
        try:
            await client.hset(f"generation:task:{task_id}", "status", "canvas_streaming")
            
            async for chunk in self._call_ai_stream(continue_prompt):
                status = await client.hget(f"generation:task:{task_id}", "status")
                if status == "stopped":
                    raise asyncio.CancelledError()

                full_content += chunk
                
                event = { "event": "message", "data": json.dumps({"type": "content", "text": chunk}) }
                await client.publish(f"stream:{stream_id}", json.dumps(event))

            await client.hset(f"generation:task:{task_id}", mapping={
                "status": "canvas_complete",
                "full_content": full_content
            })

            done_event = { "event": "done", "data": json.dumps({"type": "canvas_complete", "message": "Generation finished."}) }
            await client.publish(f"stream:{stream_id}", json.dumps(done_event))

        except (Exception, asyncio.CancelledError) as e:
            await client.hset(f"generation:task:{task_id}", "status", "failed")
            error_event = { "event": "error", "data": json.dumps({"message": str(e)}) }
            await client.publish(f"stream:{stream_id}", json.dumps(error_event))
        finally:
            close_event = {"event": "close"}
            await client.publish(f"stream:{stream_id}", json.dumps(close_event))

# Singleton instance
generation_service = GenerationService()
