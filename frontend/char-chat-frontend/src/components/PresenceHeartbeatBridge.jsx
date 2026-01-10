import React from 'react';
import { API_BASE_URL } from '../lib/api';

/**
 * ✅ PresenceHeartbeatBridge
 *
 * 의도/동작(운영 안정성 우선):
 * - 실시간 "온라인(접속)" 수를 보기 위해, 프론트가 주기적으로 /metrics/online/heartbeat 를 호출한다.
 * - 실패해도 UX/기능이 깨지지 않도록 best-effort로 처리한다.
 *
 * 왜 axios(metricsAPI)를 직접 쓰지 않나?
 * - axios 인터셉터(토큰 리프레시/로그아웃 처리)가 하트비트 실패에 반응하면,
 *   "그냥 보고만 있는 유저"에게도 로그인 모달/리다이렉트가 뜰 수 있다.
 * - 따라서 이 하트비트는 fetch로 조용히 보내고, 에러는 삼킨다(보수적).
 */
const PresenceHeartbeatBridge = () => {
  React.useEffect(() => {
    let stopped = false;
    let timer = null;

    const buildUrl = () => {
      try {
        const base = String(API_BASE_URL || '').replace(/\/$/, '');
        if (!base) return '';
        return `${base}/metrics/online/heartbeat`;
      } catch (_) {
        return '';
      }
    };

    const ping = async () => {
      if (stopped) return;
      try {
        if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      } catch (_) {}

      const url = buildUrl();
      if (!url) return;

      try {
        const token = (() => {
          try { return localStorage.getItem('access_token'); } catch (_) { return null; }
        })();

        const headers = { 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;

        await fetch(url, {
          method: 'POST',
          headers,
          // keepalive는 일부 환경에서만 동작하므로 옵션으로만 두고, 실패해도 무시한다.
          keepalive: true,
        });
      } catch (_) {
        // best-effort: ignore
      }
    };

    // 초기 1회
    ping();

    // 주기 실행(기본 30초)
    try {
      timer = setInterval(() => { try { ping(); } catch (_) {} }, 30 * 1000);
    } catch (_) {}

    // 포커스/재가시화 시 즉시 갱신
    const onFocus = () => { try { ping(); } catch (_) {} };
    const onVis = () => { try { if (document.visibilityState === 'visible') ping(); } catch (_) {} };

    try { window.addEventListener('focus', onFocus); } catch (_) {}
    try { document.addEventListener('visibilitychange', onVis); } catch (_) {}

    return () => {
      stopped = true;
      try { if (timer) clearInterval(timer); } catch (_) {}
      try { window.removeEventListener('focus', onFocus); } catch (_) {}
      try { document.removeEventListener('visibilitychange', onVis); } catch (_) {}
    };
  }, []);

  return null;
};

export default PresenceHeartbeatBridge;


