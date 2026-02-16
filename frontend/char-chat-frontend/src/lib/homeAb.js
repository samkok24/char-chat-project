import { getOrCreateClientId } from './clientIdentity.js';

export const HOME_AB_TEST_KEY = 'ab_home';
export const HOME_AB_VERSION = 'v1';
const HOME_AB_VARIANTS = ['A', 'B'];
const HOME_AB_OVERRIDE_PARAM = 'ab_home';

const normalizeVariant = (v) => {
  const s = String(v || '').trim().toUpperCase();
  if (s === 'A' || s === 'B') return s;
  return '';
};

const parseHomeAbOverride = (search) => {
  try {
    const usp = new URLSearchParams(String(search || ''));
    return normalizeVariant(usp.get(HOME_AB_OVERRIDE_PARAM));
  } catch {
    return '';
  }
};

const hash32 = (input) => {
  try {
    const s = String(input || '');
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  } catch {
    return 0;
  }
};

const pickBySeed = (seed, variants = HOME_AB_VARIANTS) => {
  const list = Array.isArray(variants) && variants.length > 0 ? variants : ['A'];
  const idx = Number(hash32(seed) % list.length) || 0;
  return String(list[idx] || list[0] || 'A');
};

/**
 * Home AB variant resolver (SSOT)
 *
 * 우선순위:
 * 1) URL override (?ab_home=A|B)
 * 2) 로그인 유저: user_id 기반 결정적 할당
 * 3) 비로그인 유저: client_id 기반 결정적 할당
 */
export const resolveHomeAbVariant = ({ userId, search } = {}) => {
  const override = parseHomeAbOverride(search);
  const identityType = userId ? 'user' : 'client';
  const identityValue = userId ? `u:${userId}` : `c:${getOrCreateClientId()}`;
  const seed = `${HOME_AB_TEST_KEY}|${HOME_AB_VERSION}|${identityValue}`;

  return {
    testKey: HOME_AB_TEST_KEY,
    version: HOME_AB_VERSION,
    identityType,
    variant: override || pickBySeed(seed, HOME_AB_VARIANTS),
    source: override ? 'override' : 'hash',
  };
};

export const buildHomeAbPageMeta = ({ userId, search } = {}) => {
  const resolved = resolveHomeAbVariant({ userId, search });
  // backend 집계는 ab_* key만 카운팅한다.
  return { ab_home: resolved.variant };
};
