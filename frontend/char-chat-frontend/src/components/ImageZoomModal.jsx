import React from 'react';
import { X } from 'lucide-react';

/**
 * 이미지 확대 모달(모바일 최적화, X 버튼만)
 *
 * 의도/동작:
 * - 전체 화면 오버레이에 이미지 1장만 크게 보여준다.
 * - 닫기 수단은 "X 버튼" + 배경 클릭 + ESC 이다.
 *
 * 모바일 최적화:
 * - safe-area inset을 고려해 상단/하단 패딩을 잡는다.
 * - 세로 화면에서 이미지가 잘리지 않도록 object-contain + 최대 높이 제한을 둔다.
 */
const ImageZoomModal = ({ open, src, alt = '', onClose }) => {
  React.useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        try { onClose?.(); } catch (_) {}
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      try { window.removeEventListener('keydown', onKeyDown); } catch (_) {}
    };
  }, [open, onClose]);

  if (!open) return null;

  const safeSrc = String(src || '').trim();
  if (!safeSrc) return null;

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/85"
      style={{
        paddingTop: 'calc(env(safe-area-inset-top, 0px) + 12px)',
        paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 12px)',
        paddingLeft: 'calc(env(safe-area-inset-left, 0px) + 12px)',
        paddingRight: 'calc(env(safe-area-inset-right, 0px) + 12px)',
      }}
      onClick={(e) => {
        // 배경 클릭만 닫기(이미지 클릭은 닫지 않음)
        if (e.target !== e.currentTarget) return;
        try { onClose?.(); } catch (_) {}
      }}
      role="dialog"
      aria-modal="true"
    >
      <button
        type="button"
        aria-label="닫기"
        className="absolute right-3 top-3 w-11 h-11 rounded-full bg-black/55 border border-white/15 flex items-center justify-center text-white hover:bg-black/70 active:bg-black/80"
        onClick={() => { try { onClose?.(); } catch (_) {} }}
      >
        <X className="w-6 h-6" />
      </button>

      <div className="w-full h-full flex items-center justify-center">
        <div className="max-w-[96vw] max-h-[90vh] overflow-auto">
          <img
            src={safeSrc}
            alt={alt}
            className="block max-w-[96vw] max-h-[90vh] object-contain rounded-xl"
            draggable={false}
          />
        </div>
      </div>
    </div>
  );
};

export default ImageZoomModal;

