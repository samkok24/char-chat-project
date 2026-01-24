/**
 * assistantBlocks
 *
 * ✅ 의도/원리:
 * - "캐릭터 답변"에서 대사(dialogue)와 서술/지문(narration)을 분리해,
 *   UI에서 각각 다른 형태(대사=말풍선, 서술=가운데 박스)로 렌더할 수 있게 한다.
 *
 * ✅ 방어적 설계:
 * - 백엔드가 `message_metadata.kind` 같은 SSOT를 내려주지 않는 상황에서도,
 *   최소한의 휴리스틱(따옴표/별표/구조)을 기반으로 안정적으로 분리한다.
 * - 오탐을 줄이기 위해 "대사"는 비교적 보수적으로 판정한다.
 */

const QUOTE_START = ['"', '“', '”', '「', '『', '〈', '《'];

// ✅ 대사/서술 휴리스틱 보강(따옴표/별표가 없는 출력 대응)
// - "짧은 문장 + 대화체 어미/물음표/감탄"은 대사로 취급
// - "시선/입술/숨/손/눈동자..." 같은 묘사 단어가 포함되면 서술 쪽으로 기운다
const NARRATION_HINTS = [
  '시선', '눈동자', '입술', '숨', '손', '손끝', '가슴', '심장', '목소리', '거리', '간격', '몸',
  '천천히', '조용히', '살짝', '가만히', '불쑥', '조심스레', '차분히',
  '바라본', '바라보', '내려', '올리', '기울', '다가', '피하', '조정', '느꼈', '느낀', '울려',
];
const DIALOGUE_ENDINGS = [
  '야', '지', '냐', '니', '까', '요', '죠', '네', '군', '어', '아', '해', '해요', '했어', '했지',
  '할래', '할까', '해볼까', '좋아', '그래', '알겠어', '괜찮아', '싫어', '싶어', '원해',
];

/**
 * @param {string} line
 * @returns {boolean}
 */
function isLikelyDialogueLine(line) {
  const s = String(line || '').trim();
  if (!s) return false;

  // ✅ 명시적: 따옴표로 시작하면 대사로 본다(가장 안정)
  if (QUOTE_START.some((q) => s.startsWith(q))) return true;

  // ✅ 흔한 패턴: "이름: “대사”" / "이름 - “대사”"
  // - 이름 길이가 길면(서술 문장) 오탐 확률이 커서 1~12자 내로 제한
  // - 구분자(:/：/-/–) 뒤에 따옴표가 나오는 케이스만 대사로 본다.
  const m = s.match(/^(.{1,12}?)(\s*[:：\-–]\s*)([“"「『])/);
  if (m) return true;

  // ✅ 휴리스틱(따옴표 없음): 물음표/느낌표/말줄임표가 있으면 대사 가능성이 높다
  if (/[?!]/.test(s) || /…|\.\.\./.test(s)) return true;

  // ✅ 짧은 문장 + 대화체 어미(보수적)
  // - 너무 짧은 묘사("시선을 올린다.") 같은 오탐을 줄이기 위해 묘사 힌트가 있으면 대사 판정을 약화
  const len = s.length;
  if (len <= 40) {
    const hasNarrHint = NARRATION_HINTS.some((k) => s.includes(k));
    const ending = s.replace(/[.\s]+$/g, '').trim();
    const hasEnding = DIALOGUE_ENDINGS.some((e) => ending.endsWith(e));
    if (hasEnding && !hasNarrHint) return true;
  }

  return false;
}

/**
 * @param {string} line
 * @returns {{ kind: 'narration'|'dialogue', text: string }}
 */
function classifyLine(line) {
  const raw = String(line || '');
  const trimmed = raw.trim();
  if (!trimmed) return { kind: 'narration', text: '' };

  // ✅ 명시적 지문: "* " 프리픽스는 서술로 취급 (기존 정책과 정합)
  if (/^\*\s/.test(trimmed)) {
    return { kind: 'narration', text: trimmed.replace(/^\*\s*/, '') };
  }

  if (isLikelyDialogueLine(trimmed)) {
    return { kind: 'dialogue', text: trimmed };
  }

  return { kind: 'narration', text: trimmed };
}

/**
 * parseAssistantBlocks
 *
 * @param {string} text
 * @returns {{ kind: 'narration'|'dialogue', text: string }[]}
 */
export function parseAssistantBlocks(text) {
  const s = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = s.split('\n');

  const blocks = [];
  let bufferKind = null;
  let buffer = [];

  const flush = () => {
    const joined = buffer.join('\n').trim();
    if (joined) blocks.push({ kind: bufferKind || 'narration', text: joined });
    bufferKind = null;
    buffer = [];
  };

  for (const ln of lines) {
    const { kind, text: t } = classifyLine(ln);

    // 빈 줄은 블록 분리자
    if (!String(t || '').trim()) {
      flush();
      continue;
    }

    if (!bufferKind) {
      bufferKind = kind;
      buffer = [t];
      continue;
    }

    // ✅ dialogue는 한 줄씩 독립 말풍선이 자연스럽다(스크린샷 UX)
    if (bufferKind === 'dialogue') {
      flush();
      bufferKind = kind;
      buffer = [t];
      continue;
    }

    // ✅ narration은 연속 문단을 합쳐 중앙 박스로 보여준다
    if (bufferKind === 'narration' && kind === 'narration') {
      buffer.push(t);
      continue;
    }

    // narration → dialogue 전환
    flush();
    bufferKind = kind;
    buffer = [t];
  }

  flush();

  // ✅ 전체가 대사로만 오인되는 것을 줄이기 위한 보정:
  // - 대사 블록이 하나도 없고, 텍스트가 존재하면 narration 1개로 통일(가운데 박스 1개)
  if (blocks.length === 0 && s.trim()) {
    return [{ kind: 'narration', text: s.trim() }];
  }

  return blocks;
}

