/**
 * ✅ Image generation prompt builder (SSOT)
 *
 * 의도/원리:
 * - `ImageGenerateInsertModal`(이미지 생성/삽입 모달)에서 검증된 스타일/비율 힌트 로직을
 *   QuickMeet 인라인 생성에서도 그대로 재사용한다(DRY).
 * - 모델/프로바이더별로 ratio 파라미터 적용이 불완전할 수 있어, prompt에도 최소 힌트를 넣는다.
 *
 * styleKey:
 * - 'anime' | 'semi' | 'photo' | 'artwork'
 *
 * ratioKey:
 * - '1:1' | '3:4' | '4:3' | '16:9' | '9:16'
 */

export function buildImageGenerationPrompt(basePrompt, styleKey, ratioKey) {
  try {
    const p = String(basePrompt || '').trim();
    if (!p) return '';

    // 스타일별 프롬프트 보강(ImageGenerateInsertModal 기준 + artwork 확장)
    let styleHint = '';
    const sk = String(styleKey || '').trim();
    if (sk === 'anime') styleHint = ', anime style, cel shaded, vibrant colors';
    else if (sk === 'photo') styleHint = ', photorealistic, high quality photography';
    else if (sk === 'semi') styleHint = ', semi-realistic, digital art, detailed';
    else if (sk === 'artwork') styleHint = ', concept art, graphic design, stylized composition';

    // 비율/구도 힌트(ImageGenerateInsertModal 기준)
    const r = String(ratioKey || '').trim();
    let ratioHint = '';
    if (r) {
      let composition = '';
      if (r === '3:4' || r === '9:16') composition = 'vertical composition';
      else if (r === '4:3' || r === '16:9') composition = 'horizontal composition';
      else if (r === '1:1') composition = 'square composition';
      ratioHint = composition ? `, ${r} aspect ratio, ${composition}` : `, ${r} aspect ratio`;
    }

    return p + styleHint + ratioHint;
  } catch (_) {
    return String(basePrompt || '').trim();
  }
}

export function styleKeyFromQuickMeetStyleSlug(styleSlug) {
  /**
   * ✅ QuickMeet(한국어 slug) → 이미지 생성 styleKey 매핑
   * - QuickMeet은 4종(애니풍/실사풍/반실사/아트웤)을 사용한다.
   */
  try {
    const s = String(styleSlug || '').trim();
    if (s === '애니풍') return 'anime';
    if (s === '실사풍') return 'photo';
    if (s === '반실사') return 'semi';
    if (s === '아트웤') return 'artwork';
    return '';
  } catch (_) {
    return '';
  }
}

