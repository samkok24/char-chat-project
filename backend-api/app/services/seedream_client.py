"""
Seedream v4 API 클라이언트
fal.run 플랫폼의 ByteDance Seedream 모델 래퍼
"""
import os
import json
import asyncio
import logging
from typing import List, Optional, Dict, Any
from dataclasses import dataclass
import aiohttp
import backoff
try:
    import fal_client  # Official Python client
except Exception:  # optional import; fallback to REST if missing
    fal_client = None  # type: ignore

logger = logging.getLogger(__name__)

@dataclass
class SeedreamResult:
    """Seedream 생성 결과"""
    image_url: str
    prompt: str
    seed: Optional[int] = None
    latency: Optional[float] = None
    request_id: Optional[str] = None
    
@dataclass
class SeedreamConfig:
    """Seedream 생성 설정"""
    prompt: str
    negative_prompt: Optional[str] = None
    image_size: str = "1024x1024"  # 1:1 기본
    num_images: int = 1
    num_inference_steps: int = 25
    guidance_scale: float = 7.5
    seed: Optional[int] = None
    
class SeedreamClient:
    """Seedream v4 API 클라이언트 (fal_client 우선, REST 폴백)"""
    
    # Official model id for fal_client
    MODEL_ID = "fal-ai/bytedance/seedream/v4/text-to-image"
    # REST endpoint fallback
    BASE_URL = "https://fal.run/fal-ai/bytedance/seedream/v4/text-to-image"
    
    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key or os.getenv("FAL_KEY")
        if not self.api_key:
            raise ValueError("FAL_KEY environment variable or api_key parameter required")
            
        self.headers = {
            "Authorization": f"Key {self.api_key}",
            "Content-Type": "application/json"
        }
        
    # 네트워크 계열만 재시도. API 4xx(특히 403)은 즉시 중단
    @backoff.on_exception(
        backoff.expo,
        (aiohttp.ClientError, asyncio.TimeoutError),
        max_tries=3,
        max_time=30
    )
    async def generate_single(self, config: SeedreamConfig) -> SeedreamResult:
        """단일 이미지 생성 (fal_client 우선 사용)"""
        size_obj = self._size_object(config.image_size)
        merged_prompt = self._merge_prompt(config.prompt, config.negative_prompt)

        # 1) fal_client 우선 경로 (권장)
        if fal_client is not None:
            args = {
                "prompt": merged_prompt,
                "image_size": size_obj,
                "num_images": 1,
                "seed": int(config.seed) if config.seed is not None else None,
                "enable_safety_checker": True,
            }
            args = {k: v for k, v in args.items() if v is not None}

            def _call_subscribe():
                return fal_client.subscribe(
                    self.MODEL_ID,
                    arguments=args,
                    with_logs=False,
                )

            try:
                result = await asyncio.to_thread(_call_subscribe)
                data = result.get("data") if isinstance(result, dict) else None
                body = data if isinstance(data, dict) else (result if isinstance(result, dict) else {})
                images = (body or {}).get("images", [])
                if not images:
                    # fal_client에서 결과 없음 → None 반환하여 호출측에서 스킵
                    return None  # type: ignore
                image_url = images[0].get("url")
                return SeedreamResult(
                    image_url=image_url,
                    prompt=merged_prompt,
                    seed=(body or {}).get("seed"),
                    latency=None,
                    request_id=(result.get("request_id") if isinstance(result, dict) else None) or (result.get("requestId") if isinstance(result, dict) else None)
                )
            except Exception as e:
                # 크레딧 소진 등 사용자 잠금은 즉시 스킵
                msg = str(e)
                if "User is locked" in msg or "403" in msg:
                    logger.warning(f"fal_client quota/forbidden: {e}")
                    return None  # type: ignore
                logger.debug(f"fal_client subscribe failed, fallback to REST: {e}")
                # 폴백으로 REST 호출 시도

        # 2) REST 폴백 경로
        payload = {
            "input": {
                "prompt": merged_prompt,
                "image_size": size_obj,
                "num_images": 1,
                "seed": int(config.seed) if config.seed is not None else None,
                "enable_safety_checker": True,
            }
        }
        payload["input"] = {k: v for k, v in payload["input"].items() if v is not None}

        async with aiohttp.ClientSession() as session:
            try:
                async with session.post(
                    self.BASE_URL,
                    headers=self.headers,
                    json=payload,
                    timeout=aiohttp.ClientTimeout(total=120)
                ) as resp:
                    if resp.status == 403:
                        # 크레딧 소진 등 즉시 스킵
                        txt = await resp.text()
                        logger.warning(f"Seedream REST 403: {txt}")
                        return None  # type: ignore
                    if resp.status >= 400:
                        error_text = await resp.text()
                        # INFO 최소화: 상세는 DEBUG
                        logger.debug(f"Seedream API error {resp.status}: {error_text}")
                        if resp.status == 429:
                            raise SeedreamQuotaError("API quota exceeded")
                        if resp.status == 400:
                            raise SeedreamValidationError(f"Invalid parameters: {error_text}")
                        # 422(policy) 한정 1회 정제 재시도
                        if resp.status == 422:
                            cleaned = self._soft_sanitize_prompt(merged_prompt)
                            if cleaned and cleaned != merged_prompt:
                                return await self._retry_once_with_clean_prompt(session, cleaned, size_obj, config)
                        raise SeedreamAPIError(f"API error {resp.status}: {error_text}")

                    data = await resp.json()
                    body = data.get("data") if isinstance(data, dict) and "data" in data else data
                    images = (body or {}).get("images", []) if isinstance(body, dict) else []
                    if not images:
                        return None  # type: ignore
                    image_data = images[0]
                    return SeedreamResult(
                        image_url=image_data.get("url"),
                        prompt=merged_prompt,
                        seed=(body or {}).get("seed"),
                        latency=(data.get("timings", {}) if isinstance(data, dict) else {}).get("inference"),
                        request_id=data.get("requestId") or data.get("request_id")
                    )
            except asyncio.TimeoutError:
                logger.debug("Seedream request timeout")
                raise SeedreamTimeoutError("Request timeout after 120s")
            except aiohttp.ClientError as e:
                logger.debug(f"Seedream connection error: {e}")
                raise SeedreamConnectionError(f"Connection failed: {e}")
                
    async def generate_batch(
        self, 
        configs: List[SeedreamConfig],
        max_concurrent: int = 2
    ) -> List[SeedreamResult]:
        """배치 이미지 생성 (동시 실행 제한)"""
        semaphore = asyncio.Semaphore(max_concurrent)
        # 공통 시드: 첫 config에 seed가 있으면 공유, 없으면 고정 seed 생성
        common_seed: Optional[int] = None
        for cfg in configs:
            if cfg.seed is not None:
                common_seed = int(cfg.seed)
                break
        if common_seed is None:
            try:
                import random
                common_seed = random.randint(1, 2_000_000_000)
            except Exception:
                common_seed = 123456789
        # 모든 config에 동일 시드 부여(개별 지정이 있으면 존중)
        for cfg in configs:
            if cfg.seed is None:
                cfg.seed = common_seed
        
        async def generate_with_limit(config: SeedreamConfig) -> Optional[SeedreamResult]:
            async with semaphore:
                try:
                    return await self.generate_single(config)
                except Exception as e:
                    logger.error(f"Failed to generate image: {e}")
                    return None
                    
        tasks = [generate_with_limit(config) for config in configs]
        results = await asyncio.gather(*tasks)
        
        # None 제거 (실패한 생성)
        return [r for r in results if r is not None]
        
    def get_size_for_ratio(self, ratio: str) -> tuple[int, int]:
        """비율에 맞는 이미지 크기 반환(width, height)"""
        size_map: dict[str, tuple[int, int]] = {
            "1:1": (1024, 1024),
            "3:4": (768, 1024),
            "4:3": (1024, 768),
            "16:9": (1280, 720),
            "9:16": (720, 1280),
            "2:3": (682, 1024),
        }
        return size_map.get(ratio, (1024, 1024))

    def _size_object(self, image_size: str | dict | None) -> dict:
        """문자열/튜플을 공식 스키마의 width/height object로 변환"""
        if isinstance(image_size, dict):
            # 이미 width/height 형태인 경우 그대로 사용
            w = int(image_size.get("width") or 1024)
            h = int(image_size.get("height") or 1024)
            return {"width": w, "height": h}
        if isinstance(image_size, str) and "x" in image_size:
            try:
                w_str, h_str = image_size.lower().split("x", 1)
                return {"width": int(w_str), "height": int(h_str)}
            except Exception:
                pass
        # 그 외: 기본 1:1
        return {"width": 1024, "height": 1024}

    def _merge_prompt(self, positive: str, negative: Optional[str]) -> str:
        """문서 스키마에는 negative_prompt가 없으므로 프롬프트에 안전하게 병합"""
        pos = (positive or "").strip()
        neg = (negative or "").strip()
        if not neg:
            return pos
        # 간단한 억제 구문으로 결합
        return f"{pos}, without: {neg}"
    
    def _soft_sanitize_prompt(self, merged_prompt: str) -> Optional[str]:
        """422(policy) 대비 약한 정제: 금칙 가능성 높은 토큰 제거/축소.
        과도한 변경은 피하고, 인물/텍스트/타이포 관련 금칙만 정리.
        """
        try:
            p = merged_prompt
            # 지나치게 강한 금지 토큰 축소
            for bad in ["movie poster", "poster", "title", "typography", "subtitles", "caption", "text", "hangul text", "korean text"]:
                p = p.replace(bad, "")
            # 쉼표 중복 정리
            while ", ," in p:
                p = p.replace(", ,", ",")
            return p.strip(", ") or merged_prompt
        except Exception:
            return merged_prompt
    
    async def _retry_once_with_clean_prompt(self, session: aiohttp.ClientSession, cleaned_prompt: str, size_obj: dict, config: SeedreamConfig) -> Optional[SeedreamResult]:
        payload = {"input": {"prompt": cleaned_prompt, "image_size": size_obj, "num_images": 1, "seed": int(config.seed) if config.seed is not None else None, "enable_safety_checker": True}}
        payload["input"] = {k: v for k, v in payload["input"].items() if v is not None}
        async with session.post(self.BASE_URL, headers=self.headers, json=payload, timeout=aiohttp.ClientTimeout(total=120)) as resp2:
            if resp2.status >= 400:
                logger.debug(f"Seedream retry failed {resp2.status}: {await resp2.text()}")
                return None
            data = await resp2.json()
            body = data.get("data") if isinstance(data, dict) and "data" in data else data
            images = (body or {}).get("images", []) if isinstance(body, dict) else []
            if not images:
                return None
            image_data = images[0]
            return SeedreamResult(
                image_url=image_data.get("url"),
                prompt=cleaned_prompt,
                seed=(body or {}).get("seed"),
                latency=(data.get("timings", {}) if isinstance(data, dict) else {}).get("inference"),
                request_id=data.get("requestId") or data.get("request_id")
            )
        
    async def generate_story_scenes(
        self,
        prompts: List[str],
        base_negative: str = "저해상도, 왜곡된 손, 흐릿한 얼굴, 텍스트, 워터마크",
        ratio: str = "1:1"
    ) -> List[SeedreamResult]:
        """스토리 장면 이미지 생성"""
        width, height = self.get_size_for_ratio(ratio)
        image_size_obj = {"width": width, "height": height}
        
        configs = [
            SeedreamConfig(
                prompt=prompt,
                negative_prompt=base_negative,
                image_size=image_size_obj,
                guidance_scale=8.0,  # 스토리 이미지는 좀 더 높은 가이던스
                num_inference_steps=30  # 품질 향상
            )
            for prompt in prompts
        ]
        
        return await self.generate_batch(configs, max_concurrent=2)
        
# 커스텀 예외 클래스들
class SeedreamError(Exception):
    """Seedream 기본 예외"""
    pass
    
class SeedreamAPIError(SeedreamError):
    """API 응답 에러"""
    pass
    
class SeedreamQuotaError(SeedreamError):
    """할당량 초과"""
    pass
    
class SeedreamValidationError(SeedreamError):
    """파라미터 검증 실패"""
    pass
    
class SeedreamTimeoutError(SeedreamError):
    """타임아웃"""
    pass
    
class SeedreamConnectionError(SeedreamError):
    """연결 실패"""
    pass
