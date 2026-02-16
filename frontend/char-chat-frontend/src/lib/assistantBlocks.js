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

// ✅ 대사는 큰따옴표("...")만 대사로 취급한다(요구사항).
// - UI에서 말풍선은 "대사"에만 사용하고, 나머지는 지문박스로 렌더한다.
// - 모델이 “ ” 같은 스마트 큰따옴표를 써도 되도록 하려면 여기 배열에 추가하면 된다.
// - 작은따옴표(‘ ’)는 '지문'으로 취급해야 하므로 여기에 넣지 않는다.
// NOTE:
// - 《》/「」/『』 같은 '괄호형 큰따옴표'는 작품명/용어 표기에 쓰여 지문에서 자주 등장하므로,
//   대사 판정에 포함하면 오탐이 늘어난다(요구사항).
const QUOTE_START = ['"', '“', '”', '＂'];
const QUOTE_END = QUOTE_START;

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

  // ✅ 요구사항: 대사는 큰따옴표로만 구분한다.
  // - 따옴표가 없으면(물음표/감탄사/어미로 추정하지 않음) 모두 지문으로 렌더한다.
  // - 지문이 "말풍선화"되며 문체가 바뀌는 체감의 1차 원인이 '오탐 대사 판정'이므로,
  //   여기서는 의도적으로 보수적으로 판정한다.
  if (QUOTE_START.some((q) => s.startsWith(q))) return true;

  // ✅ 흔한 패턴: "이름: \"대사\"" / "이름 - \"대사\""
  // - 라벨이 붙더라도 실제 대사 구간이 큰따옴표로 시작하면 대사로 본다.
  // - 단, 이름 길이를 제한해(1~12자) 서술 문장의 오탐을 줄인다.
  const m = s.match(/^(.{1,12}?)(\s*[:：\-–]\s*)(["“”＂])/);
  if (m) return true;

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

  /**
   * ✅ 방어: "사용자: ... / 캐릭터: ..." 라벨 노출 제거
   *
   * 배경:
   * - 일부 모델/프롬프트에서 역할 라벨(사용자:/캐릭터:)을 본문에 섞어 출력하는 경우가 있다.
   * - UI가 이를 그대로 보여주면 몰입이 깨지고, 지문/대사 분리 로직도 왜곡된다.
   *
   * 정책:
   * - 표시 단계에서 라벨만 제거하고, 나머지 텍스트는 그대로 유지한다.
   * - 라벨 제거는 "표시"에만 영향을 주며 DB/SSOT는 변경하지 않는다.
   */
  const stripSpeakerPrefix = (s) => {
    try {
      // 한글/영문 대표 케이스만 최소 허용(과도한 추론 금지)
      return String(s || '').replace(/^(사용자|유저|플레이어|user|USER)\s*[:：]\s*/i, '').replace(/^(캐릭터|상대|npc|NPC|character|CHARACTER)\s*[:：]\s*/i, '').trim();
    } catch (_) {
      return String(s || '').trim();
    }
  };
  // ✅ "이름: \"대사\""처럼 라벨이 섞여도 UI 몰입이 깨지므로,
  // - 라벨 다음이 큰따옴표일 때만 라벨을 제거한다(과잉 제거 방지).
  const stripNameLabelBeforeQuote = (s) => {
    try {
      const src = String(s || '').trim();
      const m = src.match(/^(.{1,12}?)(\s*[:：\-–]\s*)(["“”＂])(.*)$/);
      if (!m) return src;
      return (`"${m[4] || ''}`).trim();
    } catch (_) {
      return String(s || '').trim();
    }
  };
  const normalized = stripNameLabelBeforeQuote(stripSpeakerPrefix(trimmed));
  if (!normalized) return { kind: 'narration', text: '' };

  // ✅ 명시적 지문: "* " 프리픽스는 서술로 취급 (기존 정책과 정합)
  if (/^\*\s/.test(normalized)) {
    return { kind: 'narration', text: normalized.replace(/^\*\s*/, '') };
  }

  if (isLikelyDialogueLine(normalized)) {
    // ✅ UI 표시: 바깥 큰따옴표는 "구분자"이므로 제거(말풍선에 따옴표가 그대로 보이는 UX 방지)
    // - 단, 내부 따옴표는 건드리지 않는다.
    let t = String(normalized || '').trim();
    if (QUOTE_START.some((q) => t.startsWith(q))) t = t.slice(1);
    if (QUOTE_END.some((q) => t.endsWith(q))) t = t.slice(0, -1);
    t = t.trim();
    return { kind: 'dialogue', text: t };
  }

  return { kind: 'narration', text: normalized };
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

    // ✅ 요구사항: 지문은 "개행(줄)" 단위로 지문박스가 낱개로 렌더되게 한다.
    // - 모델이 지문을 여러 줄로 출력하면, 각 줄이 각각의 지문박스로 보이는 것이 UX가 더 명확하다.
    // - 따라서 narration도 dialogue처럼 "한 줄 = 한 블록"으로 처리한다.
    if (bufferKind === 'narration' && kind === 'narration') {
      flush();
      bufferKind = 'narration';
      buffer = [t];
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

