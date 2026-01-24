/**
 * 캐릭터 생성(신규) 임시저장 초안 로컬스토리지 유틸
 *
 * 의도/원리:
 * - "캐릭터 생성" 진입 전, 임시저장 초안이 있으면 사용자에게
 *   "새로 만들기/불러오기" 선택을 제공하기 위한 SSOT.
 *
 * 방어적:
 * - localStorage 접근/파싱은 환경에 따라 실패할 수 있으니 try/catch로 감싼다.
 */

export const CREATE_CHARACTER_DRAFT_KEY_NEW = 'cc_draft_new';
export const CREATE_CHARACTER_DRAFT_KEY_NEW_MANUAL = 'cc_draft_new_manual';

export function hasCreateCharacterDraft() {
  try {
    const raw = window?.localStorage?.getItem(CREATE_CHARACTER_DRAFT_KEY_NEW);
    if (!raw) return false;
    const trimmed = String(raw).trim();
    // '{}' 같은 값은 "초안 없음"으로 취급하면 UX가 예측 가능하다.
    if (trimmed.length <= 2) return false;
    return true;
  } catch (_) {
    return false;
  }
}

export function clearCreateCharacterDraft() {
  try {
    window?.localStorage?.removeItem(CREATE_CHARACTER_DRAFT_KEY_NEW);
    window?.localStorage?.removeItem(CREATE_CHARACTER_DRAFT_KEY_NEW_MANUAL);
  } catch (_) {}
}

