/**
 * ✅ installEphemeralScrollbars
 *
 * 의도/원리:
 * - textarea(텍스트 입력 필드)의 스크롤바가 밝은 기본 스타일로 "상시 노출"되면 다크 UI에서 튄다.
 * - 따라서 기본은 `scrollbar-hide`로 숨기고,
 *   유저가 휠/스크롤로 실제로 스크롤할 때만 `scrollbar-dark`를 잠깐 보여준다.
 *
 * 범위:
 * - 기본은 `textarea`에만 적용한다(요구사항: "모든 텍스트 필드").
 * - 필요하면 `[data-ephemeral-scrollbar="1"]`를 추가해서 다른 스크롤 영역에도 확장 가능.
 *
 * 주의:
 * - 스타일 토큰은 `index.css`의 `.scrollbar-dark` / `.scrollbar-hide`를 SSOT로 사용한다.
 * - DOM 변화를 감지해 동적으로 생성되는 textarea에도 동일하게 적용한다(방어).
 */
export function installEphemeralScrollbars(options = {}) {
  const selector = String(options.selector || 'textarea,[data-ephemeral-scrollbar="1"]').trim();
  const activeClass = String(options.activeClass || 'scrollbar-dark').trim();
  const inactiveClass = String(options.inactiveClass || 'scrollbar-hide').trim();
  const timeoutMs = Number.isFinite(Number(options.timeoutMs)) ? Number(options.timeoutMs) : 900;

  /**
   * ✅ 방어: dev(HMR)/중복 초기화로 이벤트 리스너가 여러 번 붙는 것을 방지한다.
   * - StrictMode/HMR 환경에서 main이 재평가되면 install이 여러 번 호출될 수 있다.
   * - 같은 selector 기준으로 1회만 설치한다.
   */
  try {
    const key = `__cc_ephemeral_scrollbars_installed__:${selector}`;
    if (typeof window !== 'undefined') {
      if (window[key]) return () => {};
      window[key] = true;
    }
  } catch (_) {}

  /** @type {WeakMap<HTMLElement, any>} */
  const timers = new WeakMap();

  const ensureInactive = (el) => {
    try {
      if (!(el instanceof HTMLElement)) return;
      if (!el.classList.contains(activeClass) && !el.classList.contains(inactiveClass)) {
        el.classList.add(inactiveClass);
      }
    } catch (e) {
      try { console.warn('[ephemeralScrollbars] ensureInactive failed:', e); } catch (_) {}
    }
  };

  const isScrollable = (el) => {
    try {
      if (!(el instanceof HTMLElement)) return false;
      // 세로/가로 둘 중 하나라도 스크롤 가능하면 대상
      return (el.scrollHeight > el.clientHeight) || (el.scrollWidth > el.clientWidth);
    } catch (_) {
      return false;
    }
  };

  const deactivateLater = (el) => {
    try {
      if (!(el instanceof HTMLElement)) return;
      const prev = timers.get(el);
      if (prev) {
        try { clearTimeout(prev); } catch (_) {}
      }
      const t = setTimeout(() => {
        try {
          el.classList.remove(activeClass);
          el.classList.add(inactiveClass);
        } catch (e) {
          try { console.warn('[ephemeralScrollbars] deactivate failed:', e); } catch (_) {}
        }
      }, Math.max(150, timeoutMs));
      timers.set(el, t);
    } catch (e) {
      try { console.warn('[ephemeralScrollbars] deactivateLater failed:', e); } catch (_) {}
    }
  };

  const activate = (el) => {
    try {
      if (!(el instanceof HTMLElement)) return;
      if (!isScrollable(el)) return;
      el.classList.add(activeClass);
      el.classList.remove(inactiveClass);
      deactivateLater(el);
    } catch (e) {
      try { console.warn('[ephemeralScrollbars] activate failed:', e); } catch (_) {}
    }
  };

  const applyToExisting = () => {
    try {
      document.querySelectorAll(selector).forEach((n) => ensureInactive(n));
    } catch (e) {
      try { console.warn('[ephemeralScrollbars] applyToExisting failed:', e); } catch (_) {}
    }
  };

  applyToExisting();

  const mo = new MutationObserver((mutations) => {
    try {
      for (const m of mutations) {
        for (const node of (m.addedNodes || [])) {
          if (!(node instanceof Element)) continue;
          if (node.matches?.(selector)) ensureInactive(node);
          try {
            node.querySelectorAll?.(selector)?.forEach((n) => ensureInactive(n));
          } catch (_) {}
        }
      }
    } catch (e) {
      try { console.warn('[ephemeralScrollbars] MutationObserver failed:', e); } catch (_) {}
    }
  });

  try {
    if (document.body) {
      mo.observe(document.body, { childList: true, subtree: true });
    }
  } catch (e) {
    try { console.warn('[ephemeralScrollbars] observe failed:', e); } catch (_) {}
  }

  const onWheel = (e) => {
    try {
      const t = e?.target;
      if (!(t instanceof Element)) return;
      const el = t.closest(selector);
      if (el) activate(el);
    } catch (err) {
      try { console.warn('[ephemeralScrollbars] onWheel failed:', err); } catch (_) {}
    }
  };

  // scroll 이벤트는 버블되지 않지만 capture 단계에서는 잡을 수 있다.
  const onScrollCapture = (e) => {
    try {
      const el = e?.target;
      if (!(el instanceof HTMLElement)) return;
      if (el.matches?.(selector)) activate(el);
    } catch (err) {
      try { console.warn('[ephemeralScrollbars] onScrollCapture failed:', err); } catch (_) {}
    }
  };

  try { document.addEventListener('wheel', onWheel, { passive: true, capture: true }); } catch (_) {}
  try { document.addEventListener('scroll', onScrollCapture, { passive: true, capture: true }); } catch (_) {}

  return () => {
    try { mo.disconnect(); } catch (_) {}
    try { document.removeEventListener('wheel', onWheel, true); } catch (_) {}
    try { document.removeEventListener('scroll', onScrollCapture, true); } catch (_) {}
    try {
      const key = `__cc_ephemeral_scrollbars_installed__:${selector}`;
      if (typeof window !== 'undefined') delete window[key];
    } catch (_) {}
  };
}

