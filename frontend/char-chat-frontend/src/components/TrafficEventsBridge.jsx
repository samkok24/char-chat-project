import React from 'react';
import { useLocation } from 'react-router-dom';
import { API_BASE_URL } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';

const CLIENT_ID_KEY = 'cc:client_id:v1';
const SESSION_KEY = 'cc:session:v1';
const SESSION_TTL_MS = 30 * 60 * 1000; // 30m

const safeUuid = () => {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch (_) {}
  try {
    return `u_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  } catch (_) {
    return `u_${Date.now()}`;
  }
};

const getOrCreateClientId = () => {
  try {
    const cur = String(localStorage.getItem(CLIENT_ID_KEY) || '').trim();
    if (cur) return cur;
    const next = safeUuid();
    localStorage.setItem(CLIENT_ID_KEY, next);
    return next;
  } catch (_) {
    return safeUuid();
  }
};

const getOrCreateSessionId = () => {
  const now = Date.now();
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    const obj = raw ? JSON.parse(raw) : null;
    const id = String(obj?.id || '').trim();
    const ts = Number(obj?.ts || 0);
    if (id && ts && (now - ts) <= SESSION_TTL_MS) {
      // bump last seen
      try { localStorage.setItem(SESSION_KEY, JSON.stringify({ id, ts: now })); } catch (_) {}
      return id;
    }
  } catch (_) {}
  const next = safeUuid();
  try { localStorage.setItem(SESSION_KEY, JSON.stringify({ id: next, ts: now })); } catch (_) {}
  return next;
};

const buildUrl = () => {
  try {
    const base = String(API_BASE_URL || '').replace(/\/$/, '');
    if (!base) return '';
    return `${base}/metrics/traffic/page-event`;
  } catch (_) {
    return '';
  }
};

const sendEvent = (payload, { beacon = false } = {}) => {
  const url = buildUrl();
  if (!url) return;

  // 페이지별 메타(AB 테스트 등)를 자동 주입
  let merged = payload || {};
  try {
    const pageMeta = window.__CC_PAGE_META;
    if (pageMeta && typeof pageMeta === 'object' && Object.keys(pageMeta).length > 0) {
      merged = { ...merged, meta: JSON.stringify(pageMeta) };
    }
  } catch (_) {}

  let body = '';
  try { body = JSON.stringify(merged); } catch (_) { body = '{}'; }

  // Exit 이벤트는 가능하면 sendBeacon(브라우저 종료/탭 닫힘 안정성)
  if (beacon) {
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
        const blob = new Blob([body], { type: 'application/json' });
        navigator.sendBeacon(url, blob);
        return;
      }
    } catch (_) {}
  }

  try {
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch (_) {}
};

/**
 * TrafficEventsBridge
 *
 * - SPA 라우트 변경 시 page_view 기록
 * - 탭 닫힘/새로고침/외부 이동(pagehide) 시 page_exit 기록
 *
 * 목적: CMS에서 "어느 페이지에서 이탈하는지" 집계.
 */
const TrafficEventsBridge = () => {
  const location = useLocation();
  const { user } = useAuth();

  const clientIdRef = React.useRef('');
  const sessionIdRef = React.useRef('');
  const lastPathRef = React.useRef('');
  const enterTsRef = React.useRef(Date.now());
  const exitSentRef = React.useRef(false);

  React.useEffect(() => {
    try { clientIdRef.current = getOrCreateClientId(); } catch (_) {}
    try { sessionIdRef.current = getOrCreateSessionId(); } catch (_) {}
  }, []);

  // page view: pathname 기준(쿼리는 cardinality 폭주 방지 위해 제외)
  React.useEffect(() => {
    // 운영자 트래픽은 집계에서 제외(백엔드에서도 무시하지만 중복 방어)
    if (user?.is_admin) return;

    const path = String(location?.pathname || '').trim() || '/';
    const now = Date.now();
    const prevPath = String(lastPathRef.current || '').trim();
    const prevEnterTs = Number(enterTsRef.current || now);

    // session bump
    try { sessionIdRef.current = getOrCreateSessionId(); } catch (_) {}

    // SPA 라우트 전환(내부 이동)도 페이지 이탈로 기록
    if (prevPath && prevPath !== path) {
      const durationMs = Math.max(0, now - prevEnterTs);
      sendEvent({
        event: 'page_leave',
        path: prevPath,
        duration_ms: durationMs,
        session_id: sessionIdRef.current || undefined,
        client_id: clientIdRef.current || undefined,
        user_id: user?.id || undefined,
      });
    }

    lastPathRef.current = path;
    enterTsRef.current = now;
    exitSentRef.current = false;

    sendEvent({
      event: 'page_view',
      path,
      session_id: sessionIdRef.current || undefined,
      client_id: clientIdRef.current || undefined,
      user_id: user?.id || undefined,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location?.pathname]);

  React.useEffect(() => {
    if (user?.is_admin) return;

    const onExit = () => {
      if (exitSentRef.current) return;
      exitSentRef.current = true;

      const path = String(lastPathRef.current || '').trim() || String(window.location?.pathname || '/');
      const durationMs = Math.max(0, Date.now() - Number(enterTsRef.current || Date.now()));

      sendEvent(
        {
          event: 'page_exit',
          path,
          duration_ms: durationMs,
          session_id: sessionIdRef.current || undefined,
          client_id: clientIdRef.current || undefined,
          user_id: user?.id || undefined,
        },
        { beacon: true }
      );
    };

    // SPA 라우트 전환은 pagehide가 발생하지 않으므로 "사이트 이탈"만 잡는다.
    try { window.addEventListener('pagehide', onExit); } catch (_) {}
    try { window.addEventListener('beforeunload', onExit); } catch (_) {}

    return () => {
      try { window.removeEventListener('pagehide', onExit); } catch (_) {}
      try { window.removeEventListener('beforeunload', onExit); } catch (_) {}
    };
  }, [user?.is_admin]);

  return null;
};

export default TrafficEventsBridge;
