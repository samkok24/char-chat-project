/**
 * ✅ 로그인 후 복귀(POST_LOGIN_REDIRECT) SSOT
 *
 * 요구사항:
 * - 게스트는 채팅방 화면까지 진입 가능
 * - "전송" 시점에 로그인 모달을 띄움
 * - 로그인 성공 시 메인(/dashboard)으로 갔다가,
 *   직전에 있던 채팅 URL(방키/쿼리 포함)로 자동 복귀
 *
 * 구현 원칙:
 * - localStorage: "로그인 이후에도 살아야 하는" 복귀 URL 저장 (탭/새로고침 내구성)
 * - sessionStorage: "해당 탭에서만" 복원하면 되는 draft 같은 UI 상태 저장
 */

export const POST_LOGIN_REDIRECT_KEY = 'cc:postLoginRedirect:v1';
export const POST_LOGIN_DRAFT_KEY_PREFIX = 'cc:postLoginDraft:v1:'; // + encodeURIComponent(url)

export function setPostLoginRedirect(payload) {
  try {
    const url = String(payload?.url || '').trim();
    if (!url) return;
    const draft = String(payload?.draft || '');
    const data = {
      url,
      draft,
      ts: Date.now(),
    };
    localStorage.setItem(POST_LOGIN_REDIRECT_KEY, JSON.stringify(data));
  } catch (e) {
    try { console.error('[postLoginRedirect] set failed:', e); } catch (_) {}
  }
}

export function readPostLoginRedirect() {
  try {
    const raw = localStorage.getItem(POST_LOGIN_REDIRECT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const url = String(parsed?.url || '').trim();
    if (!url) return null;
    return {
      url,
      draft: typeof parsed?.draft === 'string' ? parsed.draft : '',
      ts: Number(parsed?.ts || 0) || 0,
    };
  } catch (e) {
    try { console.error('[postLoginRedirect] read failed:', e); } catch (_) {}
    return null;
  }
}

export function clearPostLoginRedirect() {
  try {
    localStorage.removeItem(POST_LOGIN_REDIRECT_KEY);
  } catch (e) {
    try { console.error('[postLoginRedirect] clear failed:', e); } catch (_) {}
  }
}

export function stashPostLoginDraft(url, draft) {
  try {
    const key = `${POST_LOGIN_DRAFT_KEY_PREFIX}${encodeURIComponent(String(url || '').trim())}`;
    sessionStorage.setItem(key, String(draft ?? ''));
  } catch (e) {
    try { console.error('[postLoginRedirect] stash draft failed:', e); } catch (_) {}
  }
}

export function consumePostLoginDraft(url) {
  try {
    const key = `${POST_LOGIN_DRAFT_KEY_PREFIX}${encodeURIComponent(String(url || '').trim())}`;
    const v = sessionStorage.getItem(key);
    if (v === null) return '';
    sessionStorage.removeItem(key);
    return String(v);
  } catch (e) {
    try { console.error('[postLoginRedirect] consume draft failed:', e); } catch (_) {}
    return '';
  }
}

