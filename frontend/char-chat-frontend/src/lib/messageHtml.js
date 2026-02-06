/**
 * 채팅 말풍선용 "안전 HTML" 처리 유틸
 *
 * 의도/동작:
 * - 말풍선에 `<ul>/<ol>/<li>` 같은 HTML을 허용하되, 스크립트 실행(태그/이벤트/URL 스킴)을 차단한다.
 * - 외부 라이브러리 없이 DOMParser 기반의 최소 allowlist sanitize만 수행한다.
 *
 * 보안 원칙(방어적):
 * - allowlist(허용 태그/속성) 기반으로만 남긴다.
 * - `on*` 이벤트 속성은 전부 제거한다.
 * - `javascript:`/`data:` 등 위험 URL 스킴은 제거한다.
 */

const DEFAULT_ALLOWED_TAGS = new Set([
  'br',
  'p',
  'div',
  'span',
  'strong',
  'em',
  'b',
  'i',
  'u',
  's',
  'code',
  'pre',
  'blockquote',
  'ul',
  'ol',
  'li',
  'a',
  'img',
  // ✅ 표(table) 지원(요구사항): 최소 태그만 허용하고 스타일/이벤트는 차단한다.
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'th',
  'td',
]);

const DROP_TAGS = new Set([
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'link',
  'meta',
  'base',
  'form',
  'input',
  'button',
  'textarea',
  'select',
  'option',
  'svg',
  'math',
]);

const ALLOWED_ATTRS_BY_TAG = {
  a: new Set(['href', 'target', 'rel']),
  img: new Set(['src', 'alt', 'title', 'width', 'height', 'loading', 'decoding', 'referrerpolicy']),
  // ✅ 표(table) 안전 속성: 레이아웃에 필요한 최소치만 허용
  th: new Set(['colspan', 'rowspan']),
  td: new Set(['colspan', 'rowspan']),
};

const isSafeHref = (raw) => {
  try {
    const v = String(raw ?? '').trim();
    if (!v) return false;
    const lower = v.toLowerCase().replace(/\s+/g, '');
    if (lower.startsWith('javascript:')) return false;
    if (lower.startsWith('data:')) return false;
    if (lower.startsWith('vbscript:')) return false;
    if (lower.startsWith('#')) return true;
    if (lower.startsWith('/')) return true;
    if (lower.startsWith('./') || lower.startsWith('../')) return true;
    if (lower.startsWith('http://') || lower.startsWith('https://')) return true;
    if (lower.startsWith('mailto:') || lower.startsWith('tel:')) return true;
    return false;
  } catch (_) {
    return false;
  }
};

const isSafeImgSrc = (raw) => {
  /**
   * ✅ img src 방어
   *
   * 원칙:
   * - http/https(+상대경로)만 허용한다.
   * - data:/javascript:/vbscript:/file: 등은 차단한다.
   * - SVG는 브라우저/환경에 따라 우회 여지가 있어 보수적으로 차단한다.
   */
  try {
    const v = String(raw ?? '').trim();
    if (!v) return false;
    const lower = v.toLowerCase().replace(/\s+/g, '');
    if (lower.startsWith('javascript:')) return false;
    if (lower.startsWith('data:')) return false;
    if (lower.startsWith('vbscript:')) return false;
    if (lower.startsWith('file:')) return false;
    if (lower.startsWith('blob:')) return false;

    // svg 확장자/데이터는 차단(보수적)
    const noHash = lower.split('#')[0] || '';
    const noQuery = (noHash.split('?')[0] || '').trim();
    if (noQuery.endsWith('.svg')) return false;

    if (lower.startsWith('/')) return true;
    if (lower.startsWith('./') || lower.startsWith('../')) return true;
    if (lower.startsWith('http://') || lower.startsWith('https://')) return true;
    return false;
  } catch (_) {
    return false;
  }
};

const escapeHtml = (v) => {
  try {
    return String(v ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  } catch (_) {
    return '';
  }
};

export const hasHtmlListLike = (text) => {
  try {
    return /<(ul|ol|li)(\s|>)/i.test(String(text ?? ''));
  } catch (_) {
    return false;
  }
};

/**
 * 채팅 UI에서 "지원하는 HTML 태그"가 포함되어 있는지 감지한다.
 *
 * 의도/방어:
 * - 단순한 비교식("1 < 2") 같은 텍스트를 HTML로 오탐하면 내용이 깨질 수 있으니,
 *   우리가 sanitize allowlist로 "지원하는 태그"가 실제로 등장할 때만 HTML 렌더를 켠다.
 */
export const hasChatHtmlLike = (text) => {
  try {
    const s = String(text ?? '');
    if (!s.includes('<')) return false;
    // ✅ allowlist에 포함된 태그만 감지(보수적)
    return /<\s*\/?\s*(ul|ol|li|a|img|br|p|div|span|strong|em|b|i|u|s|code|pre|blockquote|table|thead|tbody|tfoot|tr|th|td)\b/i.test(s);
  } catch (_) {
    return false;
  }
};

export const sanitizeChatMessageHtml = (html) => {
  try {
    const src = String(html ?? '');
    if (!src.trim()) return '';

    // DOMParser가 없는 환경(극단적 예외)에서는 완전 escape로 안전 우선
    if (typeof DOMParser === 'undefined') {
      return escapeHtml(src).replace(/\n/g, '<br />');
    }

    const doc = new DOMParser().parseFromString(src, 'text/html');
    const root = doc.body;
    if (!root) return '';

    const walk = (node) => {
      // childNodes는 live라서 역순 순회
      for (let i = node.childNodes.length - 1; i >= 0; i -= 1) {
        const child = node.childNodes[i];

        // 텍스트는 그대로
        if (child.nodeType === Node.TEXT_NODE) continue;

        // 주석 제거
        if (child.nodeType === Node.COMMENT_NODE) {
          try { node.removeChild(child); } catch (_) {}
          continue;
        }

        // 엘리먼트만 처리
        if (child.nodeType !== Node.ELEMENT_NODE) {
          try { node.removeChild(child); } catch (_) {}
          continue;
        }

        const el = /** @type {HTMLElement} */ (child);
        const tag = String(el.tagName || '').toLowerCase();

        // 위험 태그는 통째로 제거
        if (DROP_TAGS.has(tag)) {
          try { node.removeChild(el); } catch (_) {}
          continue;
        }

        // 허용되지 않은 태그는 "내용만" 남기고 unwrap
        if (!DEFAULT_ALLOWED_TAGS.has(tag)) {
          try {
            const text = doc.createTextNode(el.textContent || '');
            node.replaceChild(text, el);
          } catch (_) {
            try { node.removeChild(el); } catch (_) {}
          }
          continue;
        }

        // 속성 정리(allowlist)
        try {
          const allowed = ALLOWED_ATTRS_BY_TAG[tag] || new Set();
          const attrs = Array.from(el.attributes || []);
          for (const a of attrs) {
            const name = String(a?.name || '').toLowerCase();
            const value = String(a?.value ?? '');

            // 이벤트/스타일/임의 속성 차단
            if (name.startsWith('on') || name === 'style') {
              try { el.removeAttribute(a.name); } catch (_) {}
              continue;
            }

            if (!allowed.has(name)) {
              try { el.removeAttribute(a.name); } catch (_) {}
              continue;
            }

            // href 방어
            if (tag === 'a' && name === 'href') {
              if (!isSafeHref(value)) {
                try { el.removeAttribute('href'); } catch (_) {}
              }
            }

            // src 방어
            if (tag === 'img' && name === 'src') {
              if (!isSafeImgSrc(value)) {
                try { el.removeAttribute('src'); } catch (_) {}
              }
            }
          }

          // a 태그는 안전한 링크 속성 강제
          if (tag === 'a') {
            if (el.getAttribute('href')) {
              el.setAttribute('target', '_blank');
              el.setAttribute('rel', 'noopener noreferrer nofollow');
            } else {
              try { el.removeAttribute('target'); } catch (_) {}
              try { el.removeAttribute('rel'); } catch (_) {}
            }
          }

          // img 태그는 안전한 표시 속성만 세팅(보수적)
          if (tag === 'img') {
            // src가 제거된 경우는 텍스트로 대체(디버깅/운영 대응)
            if (!el.getAttribute('src')) {
              try {
                const text = doc.createTextNode(el.getAttribute('alt') || '[이미지]');
                node.replaceChild(text, el);
              } catch (_) {
                try { node.removeChild(el); } catch (_) {}
              }
              continue;
            }
            if (!el.getAttribute('alt')) el.setAttribute('alt', '');
            el.setAttribute('loading', 'lazy');
            el.setAttribute('decoding', 'async');
            el.setAttribute('referrerpolicy', 'no-referrer');
          }
        } catch (_) {}

        // 자식 재귀
        walk(el);
      }
    };

    walk(root);
    return String(root.innerHTML || '');
  } catch (e) {
    console.error('[messageHtml] sanitizeChatMessageHtml failed:', e);
    return '';
  }
};

