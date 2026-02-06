import React from 'react';
import { sanitizeChatMessageHtml } from '../lib/messageHtml';
import ImageZoomModal from './ImageZoomModal';

/**
 * 채팅/프리뷰 영역에서 "안전 HTML"을 렌더하는 컴포넌트
 *
 * 의도/동작:
 * - `sanitizeChatMessageHtml()`로 정제된 HTML만 `dangerouslySetInnerHTML`로 출력한다.
 * - 렌더된 HTML 안의 `<img>`를 누르면 확대 모달(X 버튼만)로 보여준다.
 *
 * 방어:
 * - sanitize 결과가 비어있으면 렌더하지 않는다.
 * - 이미지 클릭 감지는 이벤트 위임으로 처리한다(HTML 내부에 React onClick을 못 심기 때문).
 */
const RichMessageHtml = ({ html, className = '' }) => {
  const [zoomOpen, setZoomOpen] = React.useState(false);
  const [zoomSrc, setZoomSrc] = React.useState('');

  const safeHtml = React.useMemo(() => {
    return sanitizeChatMessageHtml(html);
  }, [html]);

  if (!safeHtml) return null;

  return (
    <>
      <div
        className={className || 'message-rich'}
        dangerouslySetInnerHTML={{ __html: safeHtml }}
        onClick={(e) => {
          try {
            const el = e?.target;
            if (!el || typeof el !== 'object') return;
            const img = (el instanceof Element) ? el.closest('img') : null;
            if (!img) return;
            const src = String(img.getAttribute('src') || '').trim();
            if (!src) return;
            setZoomSrc(src);
            setZoomOpen(true);
          } catch (_) {}
        }}
      />

      <ImageZoomModal
        open={zoomOpen}
        src={zoomSrc}
        alt=""
        onClose={() => { setZoomOpen(false); setZoomSrc(''); }}
      />
    </>
  );
};

export default RichMessageHtml;

