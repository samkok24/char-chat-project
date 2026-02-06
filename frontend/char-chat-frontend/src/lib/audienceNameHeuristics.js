/**
 * 작품명(대부분 캐릭터 이름 포함) 기반으로 "성향(남성향/여성향)"을 추천한다.
 *
 * 배경/의도:
 * - RP 작품명 규칙상 캐릭터 이름이 제목에 포함되는 경우가 많다.
 * - 운영 요구사항: 남성향 RP는 여성(미소녀) 캐릭터, 여성향 RP는 남성 캐릭터가 기본 기대치다.
 * - 이름 성별을 100% 정확히 판별할 수는 없으므로 "자동 강제"가 아니라 추천/가이드용으로만 사용한다.
 *
 * 주의:
 * - 외부 라이브러리 없이, 보수적인 휴리스틱만 사용한다.
 * - 한글 이름이 아닌 경우(영문/특수문자/너무 짧음)는 unknown으로 둔다.
 */

const MALE_ENDINGS = new Set([
  // 남성 이름에서 비교적 자주 끝나는 음절(보수적으로만 사용)
  '준', '훈', '민', '진', '현', '우', '호', '석', '환', '혁',
  '규', '기', '성', '찬', '태', '건', '원', '철', '경', '수',
  '범', '율', '재', '상', '용', '열', '종',
]);

const FEMALE_ENDINGS = new Set([
  // 여성 이름에서 비교적 자주 끝나는 음절(보수적으로만 사용)
  '아', '이', '희', '연', '은', '린', '나', '라',
]);

function _normalizeTitle(v) {
  try {
    return String(v || '').trim();
  } catch (e) {
    return '';
  }
}

function _extractLastHangulSyllable(text) {
  // 한글 음절(가-힣) 마지막 1글자를 잡는다.
  try {
    const s = _normalizeTitle(text);
    for (let i = s.length - 1; i >= 0; i -= 1) {
      const ch = s[i];
      if (/[가-힣]/.test(ch)) return ch;
    }
    return '';
  } catch (e) {
    return '';
  }
}

export function guessNameGenderFromTitle(title) {
  /**
   * 제목 내 "마지막 한글 음절" 기반 성별 추정.
   * - 정확도보다 안전(=오탐 시 강제하지 않기) 우선.
   */
  const last = _extractLastHangulSyllable(title);
  if (!last) return 'unknown';
  if (MALE_ENDINGS.has(last)) return 'male';
  if (FEMALE_ENDINGS.has(last)) return 'female';
  return 'unknown';
}

export function recommendAudienceSlugFromTitle(title) {
  /**
   * 성별 추정 결과에 따라 "성향"을 추천한다.
   * - 여성향: 남성 캐릭터(남자 이름)일 가능성이 높을 때
   * - 남성향: 여성 캐릭터(여자 이름)일 가능성이 높을 때
   */
  const g = guessNameGenderFromTitle(title);
  if (g === 'male') return '여성향';
  if (g === 'female') return '남성향';
  return '';
}

