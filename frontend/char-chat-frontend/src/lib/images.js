import { API_BASE_URL } from './api';

/**
 * 정적 파일(/static)용 베이스 URL을 반환한다.
 *
 * 의도/동작(환경별):
 * - 운영: API_BASE_URL이 보통 `{origin}/api` 이므로, `/api`를 제거한 `{origin}`을 사용한다.
 * - 개발: API_BASE_URL이 보통 `http://localhost:8000` 이므로 그대로 사용한다.
 *
 * 이렇게 하면:
 * - prod: `/static/*` → `https://chapter8.net/static/*` (Nginx가 backend로 프록시)
 * - dev:  `/static/*` → `http://localhost:8000/static/*` (백엔드가 StaticFiles로 서빙)
 */
const getStaticBaseUrl = () => {
  try {
    const base = String(API_BASE_URL || '').replace(/\/$/, '');
    // API가 /api로 끝나면 정적은 같은 origin의 /static으로 내려야 한다.
    if (/\/api$/i.test(base)) return base.replace(/\/api$/i, '');
    // 그 외에는 API_BASE_URL 자체를 정적 베이스로 사용 (dev: localhost:8000)
    return base;
  } catch (_) {
    return '';
  }
};

export const resolveImageUrl = (url) => {
  if (!url) return '';
  try {
    // localhost:8000 또는 127.0.0.1:8000을 상대 경로로 변환 (DB 마이그레이션 이슈 대응)
    if (url.includes('localhost:8000') || url.includes('127.0.0.1:8000')) {
      // /static/... 부분만 추출
      const staticIdx = url.indexOf('/static/');
      if (staticIdx !== -1) {
        const relativePath = url.substring(staticIdx);
        const base = getStaticBaseUrl();
        return base ? `${base}${relativePath}` : relativePath;
      }
      // http://localhost:8000/... 형태면 경로 부분만 추출
      try {
        const urlObj = new URL(url);
        const relativePath = urlObj.pathname + (urlObj.search || '');
        const base = API_BASE_URL.replace(/\/$/, '');
        return `${base}${relativePath}`;
      } catch {
        // URL 파싱 실패 시 원본 반환
      }
    }
    
    // 외부 URL(https://...)은 그대로 반환
    if (/^https?:\/\//i.test(url)) return url;
    
    // 상대 경로(/static/...)는 API_BASE_URL과 결합
    if (url.startsWith('/')) {
      // ✅ /static 은 API(/api) 경로가 아니라 origin 경로로 내려야 한다.
      if (url.startsWith('/static/')) {
        const base = getStaticBaseUrl();
        return base ? `${base}${url}` : url;
      }
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
// 목표: 상반신(가로 1200, 세로 1800, g=top) 기준으로 동일한 크롭과 밀도별 소스 제공 (고해상도 대응)
export const buildPortraitSrcSet = (rawUrl) => {
  const url = resolveImageUrl(rawUrl);
  if (!url) return { src: '', srcSet: '', sizes: '', width: 1200, height: 1800 };

  // Cloudflare 이미지 서비스 쿼리 규칙을 사용 중인 경우를 우선 지원
  // 기본 변환 파라미터: fit=crop, g=top, h=1800, w=1200 (고해상도 대응)
  // quality=90으로 품질 향상
  const baseParams = 'anim=false,f=auto,fit=crop,g=top,h=1800,w=1200,quality=90';

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
    `${make(3)} 3x`,  // 고해상도 디스플레이 대응
  ].join(', ');

  // 콘텐츠 영역이 최대 720px로 제한되어 있어 모바일/데스크톱 공통으로 100vw, lg:480px 정도에 대응
  const sizes = '(max-width: 1024px) 100vw, 480px';

  return { src, srcSet, sizes, width: 1200, height: 1800 };
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
  // 단, 백엔드 상대경로('/files/...')는 프론트 도메인으로 나가면 깨지므로 절대경로로 변환
  if (!url) return '';
  return resolveImageUrl(url);
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
