/**
 * Parse assistant text into narration/dialogue blocks for chat rendering.
 *
 * Rules:
 * - Dialogue: segment starts with a double-quote variant.
 * - Narration: explicit narration markers ("* " or [ ... ]).
 * - Unmarked plain text: if the response also contains quoted dialogue,
 *   unmarked text is reclassified as narration. Otherwise stays as dialogue.
 * - Mixed line such as `"A" [N] "B"` is split into 3 blocks.
 */

const QUOTE_START_CHARS = ['"', '\u201c', '\u201d', '\uff02'];
const QUOTE_END_BY_START = {
  '"': '"',
  '\u201c': '\u201d',
  '\u201d': '\u201d',
  '\uff02': '\uff02',
};
const FULLWIDTH_OPEN_BRACKET = '\uff3b';
const FULLWIDTH_CLOSE_BRACKET = '\uff3d';

const SPEAKER_PREFIX_RE = /^(?:\s*)(?:user|character|npc|assistant)\s*[:\-]\s*/i;

function isQuoteStart(ch) {
  return QUOTE_START_CHARS.includes(String(ch || ''));
}

function stripSpeakerPrefix(text) {
  try {
    return String(text || '').replace(SPEAKER_PREFIX_RE, '').trim();
  } catch (_) {
    return String(text || '').trim();
  }
}

function stripNameLabelBeforeQuote(text) {
  const src = String(text || '').trim();
  if (!src) return '';

  const idx = [...src].findIndex((ch) => isQuoteStart(ch));
  if (idx <= 0) return src;

  const before = src.slice(0, idx);
  if (/^[^"'\n\r]{1,24}\s*[:\-]\s*$/.test(before)) {
    return src.slice(idx).trim();
  }
  return src;
}

function stripOuterDialogueQuotes(text) {
  const src = String(text || '').trim();
  if (!src || !isQuoteStart(src[0])) return src;

  const qStart = src[0];
  const qEnd = QUOTE_END_BY_START[qStart] || qStart;
  let body = src.slice(1).trim();

  if (body.endsWith(qEnd)) {
    body = body.slice(0, -1).trim();
  }
  return body;
}

function splitMixedSegments(text) {
  const src = String(text || '').trim();
  if (!src) return [];

  const out = [];
  let buf = '';
  let i = 0;

  const flushBuf = () => {
    const t = String(buf || '').trim();
    if (t) out.push(t);
    buf = '';
  };

  while (i < src.length) {
    const ch = src[i];

    if (isQuoteStart(ch)) {
      flushBuf();
      const qEnd = QUOTE_END_BY_START[ch] || ch;
      let j = i + 1;
      while (j < src.length) {
        if (src[j] === qEnd) {
          j += 1;
          break;
        }
        j += 1;
      }
      out.push(src.slice(i, Math.min(j, src.length)).trim());
      i = Math.min(j, src.length);
      continue;
    }

    if (ch === '[' || ch === FULLWIDTH_OPEN_BRACKET) {
      flushBuf();
      const close = (ch === FULLWIDTH_OPEN_BRACKET) ? FULLWIDTH_CLOSE_BRACKET : ']';
      let j = i + 1;
      while (j < src.length && src[j] !== close) j += 1;
      if (j < src.length) j += 1;
      out.push(src.slice(i, Math.min(j, src.length)).trim());
      i = Math.min(j, src.length);
      continue;
    }

    buf += ch;
    i += 1;
  }

  flushBuf();
  return out.length ? out : [src];
}

function classifySegment(segment) {
  const s = String(segment || '').trim();
  if (!s) return null;

  if (/^\*\s+/.test(s)) {
    return { kind: 'narration', text: s.replace(/^\*\s+/, '').trim() };
  }

  if (
    (s.startsWith('[') && s.endsWith(']')) ||
    (s.startsWith(FULLWIDTH_OPEN_BRACKET) && s.endsWith(FULLWIDTH_CLOSE_BRACKET))
  ) {
    return { kind: 'narration', text: s.slice(1, -1).trim() };
  }

  if (isQuoteStart(s[0])) {
    const body = stripOuterDialogueQuotes(s);
    return { kind: 'dialogue', text: body || s, _quoted: true };
  }

  return { kind: 'dialogue', text: s, _quoted: false };
}

/**
 * @param {string} text
 * @returns {{ kind: 'narration'|'dialogue', text: string }[]}
 */
export function parseAssistantBlocks(text) {
  const source = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (!source.trim()) return [];

  const out = [];
  const lines = source.split('\n');

  for (const raw of lines) {
    const line = stripNameLabelBeforeQuote(stripSpeakerPrefix(raw));
    if (!String(line || '').trim()) continue;

    const segments = splitMixedSegments(line);
    for (const seg of segments) {
      const block = classifySegment(seg);
      if (!block || !block.text) continue;

      // Avoid creating punctuation-only narration boxes between split blocks.
      if (block.kind === 'narration' && /^[\s.,!?~]+$/.test(block.text) && out.length > 0) {
        const last = out[out.length - 1];
        out[out.length - 1] = { ...last, text: `${String(last?.text || '')}${block.text.trim()}` };
        continue;
      }
      out.push(block);
    }
  }

  if (!out.length && source.trim()) {
    return [{ kind: 'narration', text: source.trim() }];
  }

  // ✅ 따옴표 대사가 있으면, 따옴표 없는 일반 텍스트를 narration으로 재분류
  // - "대사"와 섞인 마커 없는 텍스트는 지문(서술)일 가능성이 높다.
  // - 따옴표 대사가 없는 순수 텍스트 응답은 기존대로 단일 말풍선 유지.
  const hasQuotedDialogue = out.some((b) => b._quoted === true);
  if (hasQuotedDialogue) {
    for (const b of out) {
      if (b._quoted === false && b.kind === 'dialogue') {
        b.kind = 'narration';
      }
    }
  }

  // _quoted 메타 필드 정리
  for (const b of out) {
    delete b._quoted;
  }

  return out;
}
