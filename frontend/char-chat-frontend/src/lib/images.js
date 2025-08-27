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



