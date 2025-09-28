"""
이미지 레터박스 합성 및 자막 렌더링
1:1 이미지를 3:4 비율로 변환하고 하단에 자막 추가
"""
import io
import os
import logging
from typing import Optional, Tuple
from PIL import Image, ImageDraw, ImageFont
import aiohttp
from dataclasses import dataclass

logger = logging.getLogger(__name__)

@dataclass
class ComposedImage:
    """합성된 이미지 결과"""
    image_bytes: bytes
    content_type: str = "image/jpeg"
    width: int = 768
    height: int = 1024
    
class ImageComposer:
    """이미지 레터박스 합성 및 자막 처리"""
    
    # 캔버스 크기 (3:4 비율)
    CANVAS_WIDTH = 768
    CANVAS_HEIGHT = 1024
    
    # 레터박스 높이 (상하 각각)
    LETTERBOX_HEIGHT = 128
    
    # 자막 설정
    SUBTITLE_FONT_SIZE = 24
    SUBTITLE_COLOR = (255, 255, 255)  # 흰색
    SUBTITLE_SHADOW_COLOR = (0, 0, 0)  # 검정 그림자
    SUBTITLE_PADDING = 20
    
    def __init__(self, font_path: Optional[str] = None):
        """
        Args:
            font_path: 사용할 폰트 파일 경로 (None이면 기본 폰트)
        """
        # 우선순위: 전달된 경로 > 환경변수(KOREAN_FONT_PATH)
        env_font = (os.getenv("KOREAN_FONT_PATH") or "").strip()
        self.font_path = font_path or (env_font if env_font else None)
        self._font = None
        
    def _get_font(self, size: int = None) -> ImageFont.FreeTypeFont:
        """폰트 객체 반환"""
        size = size or self.SUBTITLE_FONT_SIZE
        
        if self.font_path and os.path.exists(self.font_path):
            # TTC 컬렉션의 경우 한글 서브페이스(KR) 인덱스를 탐색하여 선택
            try:
                path_lower = self.font_path.lower()
                if path_lower.endswith('.ttc'):
                    for idx in range(0, 8):
                        try:
                            f = ImageFont.truetype(self.font_path, size, index=idx)
                            name = " ".join([str(x) for x in getattr(f, 'getname', lambda: ("", ))()])
                            if 'KR' in name or 'CJK KR' in name or 'Korean' in name:
                                return f
                        except Exception:
                            continue
                    # 인덱스 탐색 실패 시 기본 인덱스 시도
                    return ImageFont.truetype(self.font_path, size)
                else:
                    return ImageFont.truetype(self.font_path, size)
            except Exception as e:
                logger.warning(f"Failed to load custom font: {e}")
                
        # 기본 폰트 시도
        font_candidates = [
            "/usr/share/fonts/truetype/nanum/NanumGothic.ttf",         # Nanum (한글 전용 TTF)
            "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",  # Noto CJK (TTC)
            "/System/Library/Fonts/AppleSDGothicNeo.ttc",              # macOS
            "C:/Windows/Fonts/malgun.ttf",                              # Windows
            "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",  # Fallback (영문)
        ]
        
        for font_path in font_candidates:
            if os.path.exists(font_path):
                try:
                    return ImageFont.truetype(font_path, size)
                except Exception:
                    continue
                    
        # 모든 시도 실패 시 기본 폰트
        return ImageFont.load_default()
        
    async def compose_with_letterbox(
        self,
        image_url: str,
        subtitle: str,
        subtitle_position: str = "bottom"
    ) -> ComposedImage:
        """
        1:1 이미지에 레터박스를 추가하고 자막을 렌더링
        
        Args:
            image_url: 원본 이미지 URL
            subtitle: 하단에 표시할 자막 텍스트
            subtitle_position: 자막 위치 ("bottom" or "top")
            
        Returns:
            ComposedImage: 합성된 이미지 데이터
        """
        try:
            # 1. 원본 이미지 다운로드
            image_bytes = await self._download_image(image_url)
            original = Image.open(io.BytesIO(image_bytes))
            
            # 2. RGB로 변환 (투명도 제거)
            if original.mode != 'RGB':
                original = original.convert('RGB')
                
            # 3. 1:1로 크롭 (중앙 기준)
            square_size = min(original.width, original.height)
            left = (original.width - square_size) // 2
            top = (original.height - square_size) // 2
            right = left + square_size
            bottom = top + square_size
            cropped = original.crop((left, top, right, bottom))
            
            # 4. 목표 크기로 리사이즈
            target_size = self.CANVAS_WIDTH  # 768px (3:4 비율의 너비)
            resized = cropped.resize((target_size, target_size), Image.Resampling.LANCZOS)
            
            # 5. 3:4 캔버스 생성 (검정 배경)
            canvas = Image.new('RGB', (self.CANVAS_WIDTH, self.CANVAS_HEIGHT), (0, 0, 0))
            
            # 6. 이미지를 중앙에 배치
            y_offset = (self.CANVAS_HEIGHT - target_size) // 2
            canvas.paste(resized, (0, y_offset))
            
            # 7. 자막 렌더링
            if subtitle:
                self._render_subtitle(canvas, subtitle, subtitle_position)
                
            # 8. 바이트로 변환
            output = io.BytesIO()
            canvas.save(output, format='JPEG', quality=95, optimize=True)
            output.seek(0)
            
            return ComposedImage(
                image_bytes=output.read(),
                content_type="image/jpeg",
                width=self.CANVAS_WIDTH,
                height=self.CANVAS_HEIGHT
            )
            
        except Exception as e:
            logger.error(f"Image composition failed: {e}")
            raise
            
    def _render_subtitle(
        self, 
        canvas: Image.Image, 
        text: str, 
        position: str = "bottom"
    ):
        """캔버스에 자막 렌더링"""
        draw = ImageDraw.Draw(canvas)
        font = self._get_font()
        
        # 텍스트 크기 계산
        bbox = draw.textbbox((0, 0), text, font=font)
        text_width = bbox[2] - bbox[0]
        text_height = bbox[3] - bbox[1]
        
        # 위치 계산
        x = (self.CANVAS_WIDTH - text_width) // 2
        
        if position == "bottom":
            # 하단 레터박스 중앙
            y = self.CANVAS_HEIGHT - self.LETTERBOX_HEIGHT // 2 - text_height // 2
        else:
            # 상단 레터박스 중앙
            y = self.LETTERBOX_HEIGHT // 2 - text_height // 2
            
        # 그림자 효과 (약간 오프셋)
        shadow_offset = 2
        draw.text(
            (x + shadow_offset, y + shadow_offset),
            text,
            font=font,
            fill=self.SUBTITLE_SHADOW_COLOR
        )
        
        # 본 텍스트
        draw.text(
            (x, y),
            text,
            font=font,
            fill=self.SUBTITLE_COLOR
        )
        
    async def _download_image(self, url: str) -> bytes:
        """이미지 다운로드"""
        async with aiohttp.ClientSession() as session:
            async with session.get(url, timeout=aiohttp.ClientTimeout(total=30)) as resp:
                if resp.status >= 400:
                    raise ValueError(f"Failed to download image: HTTP {resp.status}")
                return await resp.read()
                
    def create_story_card(
        self,
        image_bytes: bytes,
        subtitle: str,
        stage_label: Optional[str] = None
    ) -> ComposedImage:
        """
        스토리 카드 생성 (이미 다운로드된 이미지 사용)
        
        Args:
            image_bytes: 원본 이미지 바이트
            subtitle: 자막 텍스트
            stage_label: 단계 라벨 (기/승/전/결)
            
        Returns:
            ComposedImage: 합성된 카드 이미지
        """
        try:
            original = Image.open(io.BytesIO(image_bytes))
            
            # RGB 변환
            if original.mode != 'RGB':
                original = original.convert('RGB')
                
            # 1:1 크롭
            square_size = min(original.width, original.height)
            left = (original.width - square_size) // 2
            top = (original.height - square_size) // 2
            cropped = original.crop((left, top, left + square_size, top + square_size))
            
            # 리사이즈
            resized = cropped.resize(
                (self.CANVAS_WIDTH, self.CANVAS_WIDTH), 
                Image.Resampling.LANCZOS
            )
            
            # 3:4 캔버스
            canvas = Image.new('RGB', (self.CANVAS_WIDTH, self.CANVAS_HEIGHT), (0, 0, 0))
            y_offset = (self.CANVAS_HEIGHT - self.CANVAS_WIDTH) // 2
            canvas.paste(resized, (0, y_offset))
            
            # 자막 렌더링
            if subtitle:
                self._render_subtitle(canvas, subtitle, "bottom")
                
            # 단계 라벨 (옵션)
            if stage_label:
                self._render_stage_label(canvas, stage_label)
                
            # 출력
            output = io.BytesIO()
            canvas.save(output, format='JPEG', quality=95)
            output.seek(0)
            
            return ComposedImage(
                image_bytes=output.read(),
                content_type="image/jpeg",
                width=self.CANVAS_WIDTH,
                height=self.CANVAS_HEIGHT
            )
            
        except Exception as e:
            logger.error(f"Story card creation failed: {e}")
            raise
            
    def _render_stage_label(self, canvas: Image.Image, label: str):
        """단계 라벨 렌더링 (좌상단)"""
        draw = ImageDraw.Draw(canvas)
        font = self._get_font(size=18)
        
        # 배경 박스
        padding = 8
        bbox = draw.textbbox((0, 0), label, font=font)
        box_width = bbox[2] - bbox[0] + padding * 2
        box_height = bbox[3] - bbox[1] + padding * 2
        
        # 반투명 검정 배경
        overlay = Image.new('RGBA', canvas.size, (0, 0, 0, 0))
        overlay_draw = ImageDraw.Draw(overlay)
        overlay_draw.rectangle(
            [(10, 10), (10 + box_width, 10 + box_height)],
            fill=(0, 0, 0, 180)
        )
        
        # 캔버스에 오버레이 합성
        canvas.paste(overlay, (0, 0), overlay)
        
        # 라벨 텍스트
        draw.text(
            (10 + padding, 10 + padding),
            label,
            font=font,
            fill=(255, 255, 255)
        )
