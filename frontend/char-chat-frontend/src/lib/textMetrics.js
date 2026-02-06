/**
 * ✅ 텍스트 품질/형식 측정 유틸(SSOT)
 *
 * 의도/원리:
 * - 자동생성 결과가 "4~5문장" 같은 형식 요구를 어길 때가 많다.
 * - 프론트에서 결과를 1차 검증하고, 필요하면 "1회 재생성"으로 보정한다.
 * - 한 곳에서만 구현해 위저드/30초 모달이 동일 기준을 공유한다(DRY/SSOT).
 *
 * 주의:
 * - 엄밀한 한국어 문장 분리는 NLP가 필요하지만, 우리는 패키지 추가 없이(요구사항)
 *   데모/운영 안정에 충분한 휴리스틱만 사용한다(KISS).
 */

export function countSentencesRoughKo(text) {
  try {
    const s = String(text ?? '').replace(/\s+/g, ' ').trim();
    if (!s) return 0;
    // 마침표/물음표/느낌표 기준(모델에게 "문장 끝을 마침표로" 지시하므로 대부분 커버됨)
    const parts = s.split(/[.!?]+/).map((x) => x.trim()).filter(Boolean);
    return parts.length;
  } catch (_) {
    return 0;
  }
}

