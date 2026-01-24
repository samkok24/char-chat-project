import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import {
  clearPostLoginRedirect,
  readPostLoginRedirect,
  stashPostLoginDraft,
} from '../lib/postLoginRedirect';

/**
 * ✅ 로그인 성공 후 복귀 브릿지
 *
 * 동작:
 * - 로그인 상태로 전환되면(localStorage 토큰 저장 + AuthContext isAuthenticated=true),
 *   저장해둔 URL이 있으면:
 *   1) /dashboard로 이동(경쟁사 UX)
 *   2) 직전 채팅 URL로 자동 복귀
 *
 * 방어적:
 * - 중복 실행 방지(한 번 처리하면 localStorage를 비운다)
 */
export default function PostLoginRedirectBridge() {
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const handledRef = React.useRef(false);

  React.useEffect(() => {
    if (!isAuthenticated) {
      handledRef.current = false;
      return;
    }
    if (handledRef.current) return;

    const pending = readPostLoginRedirect();
    if (!pending?.url) return;

    handledRef.current = true;

    // draft는 탭 단위로만 복원하면 되므로 sessionStorage로 옮겨둔다.
    try {
      if (pending.draft) stashPostLoginDraft(pending.url, pending.draft);
    } catch (_) {}
    clearPostLoginRedirect();

    try {
      // ✅ 경쟁사 UX: 메인으로 한번 갔다가 복귀
      const targetUrl = pending.url;
      const alreadyOnTarget = `${location.pathname}${location.search || ''}` === targetUrl;
      if (alreadyOnTarget) return;

      navigate('/dashboard', { replace: true });
      // Router가 /dashboard를 렌더링할 틈을 준 뒤 복귀
      window.setTimeout(() => {
        try {
          navigate(targetUrl, { replace: true });
        } catch (e) {
          try { console.error('[PostLoginRedirectBridge] navigate back failed:', e); } catch (_) {}
        }
      }, 80);
    } catch (e) {
      try { console.error('[PostLoginRedirectBridge] redirect failed:', e); } catch (_) {}
    }
  }, [isAuthenticated, navigate, location.pathname, location.search]);

  return null;
}

