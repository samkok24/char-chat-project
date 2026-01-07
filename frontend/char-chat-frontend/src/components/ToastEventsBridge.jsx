import React from 'react';
import { toast } from 'sonner';

/**
 * ✅ ToastEventsBridge
 *
 * 의도/동작:
 * - 코드베이스 곳곳에서 `window.dispatchEvent(new CustomEvent('toast', ...))` 형태로 토스트를 호출하고 있다.
 * - 이 컴포넌트는 전역 'toast' 이벤트를 구독해 Sonner(`toast`)로 실제 UI 토스트를 띄운다.
 *
 * 방어적 처리:
 * - payload 형태가 {type,message} 또는 {variant,title} 등으로 섞여 있어도 안전하게 메시지를 추출한다.
 * - 알 수 없는 type/variant는 기본 toast로 처리한다.
 */
const ToastEventsBridge = () => {
  React.useEffect(() => {
    const handler = (e) => {
      const detail = e?.detail;
      const raw = (detail && typeof detail === 'object') ? detail : {};

      const message = String(raw.message ?? raw.title ?? raw.description ?? '').trim();
      if (!message) return;

      const t = String(raw.type ?? raw.variant ?? '').toLowerCase();

      try {
        // Sonner는 toast.success/error/warning/info를 제공한다(환경에 따라 없을 수 있어 방어).
        const safe = (fn) => (typeof fn === 'function' ? fn : null);

        if (t === 'success') {
          const fn = safe(toast.success);
          return fn ? fn(message) : toast(message);
        }
        if (t === 'error' || t === 'destructive') {
          const fn = safe(toast.error);
          return fn ? fn(message) : toast(message);
        }
        if (t === 'warning') {
          const fn = safe(toast.warning);
          return fn ? fn(message) : toast(message);
        }
        if (t === 'info') {
          const fn = safe(toast.info);
          return fn ? fn(message) : toast(message);
        }

        // default
        return toast(message);
      } catch (_) {
        // no-op
      }
    };

    window.addEventListener('toast', handler);
    return () => window.removeEventListener('toast', handler);
  }, []);

  return null;
};

export default ToastEventsBridge;


