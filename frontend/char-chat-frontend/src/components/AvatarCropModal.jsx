import React, { useEffect, useRef, useState } from 'react';

// 간단한 1:1 크롭 모달 (상단 기준 오프셋 + 줌)
// props: isOpen, src (objectURL), onCancel(), onConfirm(file), outputSize (px, default 512)
const AvatarCropModal = ({ isOpen, src, onCancel, onConfirm, outputSize = 512 }) => {
  const canvasRef = useRef(null);
  const imgRef = useRef(null);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [zoom, setZoom] = useState(1.2); // 약간 확대 기본
  const [offset, setOffset] = useState(0); // 0~1 (상단에서부터)

  const targetSize = Math.max(64, Math.min(4096, Number(outputSize) || 512)); // 아바타 출력 해상도 (안전 범위)

  useEffect(() => {
    if (!isOpen) return;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      imgRef.current = img;
      setImageLoaded(true);
      draw();
    };
    img.onerror = () => setImageLoaded(false);
    img.src = src || '';
    // cleanup
    return () => {
      imgRef.current = null;
      setImageLoaded(false);
    };
  }, [isOpen, src]);

  useEffect(() => {
    draw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom, offset, imageLoaded]);

  const draw = () => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img || !imageLoaded) return;

    const ctx = canvas.getContext('2d');
    canvas.width = targetSize;
    canvas.height = targetSize;
    ctx.clearRect(0, 0, targetSize, targetSize);

    // 크롭 영역 계산 (소스 좌표계)
    const cropSize = targetSize / zoom;
    const maxSy = Math.max(0, img.height - cropSize);
    const sy = Math.min(maxSy, Math.max(0, offset * maxSy)); // 상단 기준 오프셋
    const sx = Math.max(0, (img.width - cropSize) / 2); // 중앙 정렬 가로

    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, sx, sy, cropSize, cropSize, 0, 0, targetSize, targetSize);
  };

  const handleConfirm = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.toBlob((blob) => {
      if (!blob) return;
      const file = new File([blob], 'avatar.jpg', { type: 'image/jpeg' });
      onConfirm?.(file);
    }, 'image/jpeg', 0.92);
  };

  if (!isOpen) return null;

  return (
    // ✅ QuickMeetCharacterModal(포탈 Dialog) 위에서도 보이도록 z-index를 더 높게 잡는다.
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60">
      <div className="bg-gray-900 border border-gray-700 rounded-xl p-4 w-[560px] max-w-[95vw] text-gray-200">
        <h2 className="text-lg font-semibold mb-3">프로필 이미지 크롭</h2>
        <div className="flex flex-col items-center gap-3">
          <canvas ref={canvasRef} className="rounded-lg border border-gray-700 bg-black" style={{ width: 320, height: 320 }} />
          {!imageLoaded && (
            <div className="text-sm text-gray-400">이미지를 불러오는 중...</div>
          )}
          <div className="w-full space-y-3 mt-2">
            <div>
              <label className="text-sm text-gray-300">확대</label>
              <input
                type="range"
                min={1}
                max={3}
                step={0.01}
                value={zoom}
                onChange={(e) => setZoom(parseFloat(e.target.value))}
                className="w-full"
              />
            </div>
            <div>
              <label className="text-sm text-gray-300">세로 위치</label>
              <input
                type="range"
                min={0}
                max={1}
                step={0.001}
                value={offset}
                onChange={(e) => setOffset(parseFloat(e.target.value))}
                className="w-full"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 w-full mt-2">
            <button onClick={onCancel} className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded-lg">취소</button>
            <button onClick={handleConfirm} className="px-3 py-1.5 bg-purple-600 hover:bg-purple-700 rounded-lg">적용</button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AvatarCropModal;


