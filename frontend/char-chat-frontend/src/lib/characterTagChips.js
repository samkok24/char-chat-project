/**
 * 모달/격자 공통 태그칩 계산(SSOT)
 *
 * 요구사항:
 * - 격자 카드의 태그칩은 "격자 모달"에서 보이는 태그칩과 동일한 집합/순서를 사용한다.
 * - audience(남성향/여성향/전체) + mode(롤플/시뮬/커스텀) + 나머지 태그를 일관되게 노출한다.
 */
export function buildCharacterTagChipLabels({ character, tags }) {
  try {
    const rawTags = Array.isArray(tags) ? tags : [];
    const labels = rawTags
      .map((t) => String(t?.name || t?.slug || t || '').trim())
      .filter(Boolean);

    const audience = labels.find((x) => x === '남성향' || x === '여성향' || x === '전체') || '';
    const audienceLabel = (audience === '전체') ? '' : audience;

    const modeRaw = String(
      character?.character_type
      ?? character?.basic_info?.character_type
      ?? character?.prompt_type
      ?? character?.start_sets?.basic_info?.character_type
      ?? ''
    ).trim();
    const modeLower = modeRaw.toLowerCase();
    const modeLabel = (() => {
      if (!modeLower && !modeRaw) return '';
      if (modeLower === 'roleplay' || modeRaw.includes('롤플')) return '롤플';
      if (modeLower === 'simulator' || modeRaw.includes('시뮬')) return '시뮬';
      if (modeLower === 'custom' || modeRaw.includes('커스텀')) return '커스텀';
      return '';
    })();

    const out = [];
    for (const x of [audienceLabel, modeLabel]) {
      const v = String(x || '').trim();
      if (!v) continue;
      if (!out.includes(v)) out.push(v);
    }

    for (const x of labels) {
      const v = String(x || '').trim();
      if (!v) continue;
      if (v === '전체') continue;
      if (!out.includes(v)) out.push(v);
      if (out.length >= 12) break;
    }
    return out.slice(0, 12);
  } catch {
    return [];
  }
}
