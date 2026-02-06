/**
 * ✅ 프로필 입력 제약(SSOT)
 *
 * 의도/원리:
 * - "작품명/한줄소개" 길이 제한은 여러 화면(온보딩 모달/일반 생성 위저드)에서 공유된다.
 * - SSOT로 관리해 숫자 하드코딩/불일치를 방지한다.
 *
 * 주의:
 * - "절대 끊기면 안돼" 요구사항: 초과 시 slice/substring으로 자르지 말고, 재생성/에러로 처리한다.
 */

// ✅ 작품명: 8~35자(요구사항: 제목에서 "무슨 계약인지"까지 훅을 담기 위해 상한 확장)
export const PROFILE_NAME_MIN_LEN = 8;
export const PROFILE_NAME_MAX_LEN = 35;

// ✅ 한줄소개: 최소 길이는 "짧게 써도 된다" 요구사항 반영
// - 기존 150자는 자동생성 품질을 강제하기 위한 값이었지만,
//   운영에서 짧은 소개를 허용해야 하는 UX 요구가 있어 20자로 완화한다.
export const PROFILE_ONE_LINE_MIN_LEN = 20;
export const PROFILE_ONE_LINE_MAX_LEN = 300;

// ✅ 시뮬 한줄소개: 박스(입력) 상한만 완화
// - 요구사항: "400자를 생성하라"가 아니라, 입력/검증 상한이 300이라 답답하니 400으로 늘린다.
// - RP/커스텀은 기존 300 유지(UX 일관/품질 가드레일).
export const PROFILE_ONE_LINE_MAX_LEN_SIMULATOR = 400;

export function getProfileOneLineMaxLenByCharacterType(characterType) {
  /**
   * ✅ 한줄소개 최대 길이(SSOT) — 모드별 상한 분기
   *
   * - simulator: 400
   * - roleplay/custom/그 외: 300
   */
  try {
    const t = String(characterType || '').trim();
    return t === 'simulator' ? PROFILE_ONE_LINE_MAX_LEN_SIMULATOR : PROFILE_ONE_LINE_MAX_LEN;
  } catch (_) {
    return PROFILE_ONE_LINE_MAX_LEN;
  }
}

// (중복 선언 제거): PROFILE_ONE_LINE_MAX_LEN_SIMULATOR는 위에서 SSOT로 선언됨

// ✅ 작품 컨셉(선택, 고급): 한줄소개(최대 300) + 컨셉(최대 2700) = 총 3000자(요구사항)
export const PROFILE_CONCEPT_MAX_LEN = 2700;
export const PROFILE_PROFILE_TEXT_TOTAL_MAX_LEN = 3000;

