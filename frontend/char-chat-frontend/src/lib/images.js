import { API_BASE_URL } from './api';

export const resolveImageUrl = (url) => {
  if (!url) return '';
  try {
    if (/^https?:\/\//i.test(url)) return url;
    if (url.startsWith('/')) {
      // 보장: 중복 슬래시 제거
      const base = API_BASE_URL.replace(/\/$/, '');
      return `${base}${url}`;
    }
    return url;
  } catch {
    return url;
  }
};

// 캐릭터 상세에서 쓰는 대표 이미지 규칙과 동일하게 1순위 avatar_url, 없으면 첫 이미지, 없으면 썸네일
export const getCharacterPrimaryImage = (character) => {
  if (!character) return '';
  const avatar = character.avatar_url;
  const firstGallery = Array.isArray(character.image_descriptions) && character.image_descriptions.length > 0
    ? (character.image_descriptions[0]?.url || '')
    : '';
  const thumb = character.thumbnail_url;
  return resolveImageUrl(avatar || firstGallery || thumb || '');
};


// Cloudflare 이미지 변환을 사용하는 경우(또는 정적 이미지에도 안전) 포트레이트(srcset/sizes) 생성
// 목표: 상반신(가로 600, 세로 900, g=top) 기준으로 동일한 크롭과 밀도별 소스 제공
export const buildPortraitSrcSet = (rawUrl) => {
  const url = resolveImageUrl(rawUrl);
  if (!url) return { src: '', srcSet: '', sizes: '', width: 600, height: 900 };

  // Cloudflare 이미지 서비스 쿼리 규칙을 사용 중인 경우를 우선 지원
  // 기본 변환 파라미터: fit=crop, g=top, h=900, w=600
  const baseParams = 'anim=false,f=auto,fit=crop,g=top,h=900,w=600';

  const make = (dpr) => {
    // 이미 쿼리가 있다면 이어붙이고, 없다면 ? 추가
    const joiner = url.includes('?') ? '&' : '?';
    const dprParam = dpr === 1 ? '' : `,dpr=${dpr}`;
    return `${url}${joiner}cdn-cgi/image/${baseParams}${dprParam}`;
  };

  const src = make(1);
  const srcSet = [
    `${make(1)} 1x`,
    `${make(1.5)} 1.5x`,
    `${make(2)} 2x`,
  ].join(', ');

  // 콘텐츠 영역이 최대 720px로 제한되어 있어 모바일/데스크톱 공통으로 100vw, lg:480px 정도에 대응
  const sizes = '(max-width: 1024px) 100vw, 480px';

  return { src, srcSet, sizes, width: 600, height: 900 };
};


/**
 * R2 이미지 리사이징 URL 생성
 * Cloudflare Image Resizing을 사용하여 썸네일 생성
 * 
 * @param {string} url - 원본 이미지 URL
 * @param {number} size - 원하는 너비 (픽셀)
 * @param {object} options - 추가 옵션 (fit, quality 등)
 * @returns {string} - 리사이징된 이미지 URL
 */
export const getThumbnailUrl = (url, size = 256, options = {}) => {
  // pub-xxxxx.r2.dev는 cdn-cgi/image를 지원하지 않으므로 원본 반환
  return url;
};

/**
 * 반응형 이미지 srcSet 생성 (1x, 2x, 3x)
 */
export const getResponsiveSrcSet = (url, baseSize = 256) => {
  if (!url) return '';
  
  return [
    `${getThumbnailUrl(url, baseSize)} 1x`,
    `${getThumbnailUrl(url, baseSize * 2)} 2x`,
    `${getThumbnailUrl(url, baseSize * 3)} 3x`,
  ].join(', ');
};
