/**
 * 이미지 코드 유틸(SSOT)
 *
 * 요구사항:
 * - 채팅 텍스트에서 `[[img:...]]` 또는 `{{img:...}}` 형태로 "상황 이미지"를 인라인 삽입한다.
 * - 오프닝/순서 변경/다중 기기에서도 동일 이미지를 가리키려면 "인덱스"가 아닌 "고유 id"가 필요하다.
 *
 * 원칙/방어:
 * - 서버 스키마를 건드리지 않기 위해, 고유 id는 이미지 URL에서 결정론적으로 생성한다.
 * - query/hash는 제거해 서명 URL/캐시 파라미터 변화로 id가 바뀌지 않게 한다.
 */

/**
 * URL을 안정적으로 정규화한다.
 * - query/hash 제거
 * - 가능한 경우 pathname만 사용(환경/도메인 차이로 인한 id 변경 방지)
 */
export function canonicalizeImageUrl(rawUrl) {
  try {
    const s0 = String(rawUrl || '').trim();
    if (!s0) return '';
    const s1 = s0.split('#')[0].split('?')[0];
    try {
      // 상대경로도 URL로 파싱되도록 더미 origin 사용
      const u = new URL(s1, 'http://local.invalid');
      const p = String(u.pathname || '').trim();
      return p || s1;
    } catch (_) {
      return s1;
    }
  } catch (_) {
    return '';
  }
}

/**
 * FNV-1a 32-bit 해시(외부 라이브러리 없이)
 * - 충돌 가능성은 이론상 존재하나, 캐릭터당 이미지 수가 매우 적어(<= 수십) 현실적으로 충분
 */
function fnv1a32(input) {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    // h *= 16777619 (32bit)
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}

/**
 * 이미지 URL → 코드용 고유 id 생성
 * - 결과는 `abc123xy` 같은 짧은 문자열(기본 8자)
 */
export function imageCodeIdFromUrl(rawUrl, { length = 8 } = {}) {
  try {
    const canon = canonicalizeImageUrl(rawUrl);
    if (!canon) return '';
    const h = fnv1a32(canon);
    const base36 = h.toString(36);
    const n = Math.max(6, Math.min(12, Number(length) || 8));
    return base36.padStart(n, '0').slice(-n);
  } catch (_) {
    return '';
  }
}

