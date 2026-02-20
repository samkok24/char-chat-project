/**
 * 홈페이지
 * CAVEDUCK 스타일: API 캐싱으로 성능 최적화
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../contexts/AuthContext';
import useRequireAuth from '../hooks/useRequireAuth';
import { charactersAPI, usersAPI, tagsAPI, storiesAPI, storydiveAPI, noticesAPI, cmsAPI } from '../lib/api';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '../components/ui/avatar';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog';
// 15번째 줄 수정: 이미지 썸네일 사이즈 파라미터 추가
import { resolveImageUrl, getThumbnailUrl } from '../lib/images';
import { replacePromptTokens } from '../lib/prompt';
import { applyTagDisplayConfig } from '../lib/tagOrder';
import {
  CHARACTER_TAG_DISPLAY_STORAGE_KEY,
  CHARACTER_TAG_DISPLAY_CHANGED_EVENT,
  getCharacterTagDisplay,
  setCharacterTagDisplay as persistCharacterTagDisplay,
  isDefaultCharacterTagDisplayConfig,
} from '../lib/cmsTagDisplay';
import { LazyLoadImage } from 'react-lazy-load-image-component';
import 'react-lazy-load-image-component/src/effects/blur.css';
import { Skeleton } from '../components/ui/skeleton';
// import { resolveImageUrl } from '../lib/images';
import { 
  Search, 
  Heart, 
  Users, 
  Sparkles,
  Loader2,
  LogIn,
  UserPlus,
  LogOut,
  User,
  Gem,
  Bell,
  Settings,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";
import { RecentCharactersList } from '../components/RecentCharactersList';
import { RecentChatCard } from '../components/RecentChatCard';
import { CharacterCard, CharacterCardSkeleton } from '../components/CharacterCard';
import StoryExploreCard from '../components/StoryExploreCard';
import StorySerialCard from '../components/StorySerialCard';
import AppLayout from '../components/layout/AppLayout';
import HomeBannerCarousel from '../components/HomeBannerCarousel';
import ErrorBoundary from '../components/ErrorBoundary';
import TrendingCharacters from '../components/TrendingCharacters';
import RecommendedCharacters from '../components/RecommendedCharacters';
import TopStories from '../components/TopStories';
import TopOrigChat from '../components/TopOrigChat';
import WebNovelSection from '../components/WebNovelSection';
import CharacterMobileDetailModal from '../components/CharacterMobileDetailModal';
import { useIsMobile } from '../hooks/use-mobile';
import {
  HOME_SLOTS_STORAGE_KEY,
  HOME_SLOTS_CHANGED_EVENT,
  getHomeSlots,
  setHomeSlots as persistHomeSlots,
  isHomeSlotActive,
  isDefaultHomeSlotsConfig,
} from '../lib/cmsSlots';
import {
  HOME_POPUPS_STORAGE_KEY,
  HOME_POPUPS_CHANGED_EVENT,
  getHomePopupsConfig,
  setHomePopupsConfig as persistHomePopupsConfig,
  isDefaultHomePopupsConfig,
  getActiveHomePopups,
  isPopupDismissed,
  dismissPopup,
} from '../lib/cmsPopups';
import { resolveHomeAbVariant } from '../lib/homeAb';

const CHARACTER_PAGE_SIZE = 40;
const QuickMeetCharacterModal = React.lazy(() => import('../components/QuickMeetCharacterModal'));

// ✅ 캐릭터 탭 고정 태그칩(요구사항): "모두" 옆에 롤플/시뮬/커스텀을 항상 노출
// - 실제 필터는 서버에서 character_type으로 해석(태그 매핑이 없는 기존 데이터도 동작하도록)
const CHARACTER_TAB_FIXED_MODE_TAGS = [
  { slug: '롤플', label: '롤플' },
  { slug: '시뮬', label: '시뮬' },
  { slug: '커스텀', label: '커스텀' },
];
const CHARACTER_TAB_FIXED_MODE_SLUG_SET = new Set(CHARACTER_TAB_FIXED_MODE_TAGS.map((t) => t.slug));

// ===== CMS 커스텀 구좌(홈) 유틸 =====
// 요구사항: "랜덤 정렬"은 새로고침(페이지 로드)할 때마다 순서가 바뀌되,
// 같은 세션(리렌더) 중에는 순서가 흔들리지 않도록 "세션 시드" + "슬롯 ID" 기반으로 섞는다.
const CMS_CUSTOM_SLOT_SESSION_SEED = Date.now();

const _cmsHash32 = (str) => {
  try {
    const s = String(str || '');
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  } catch (_) {
    return 0;
  }
};

const _cmsShuffleWithSeed = (arr, seed) => {
  const list = Array.isArray(arr) ? [...arr] : [];
  let s = (Number(seed) >>> 0) || 0;
  const nextRand = () => {
    // LCG (fast + deterministic)
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(nextRand() * (i + 1));
    const tmp = list[i];
    list[i] = list[j];
    list[j] = tmp;
  }
  return list;
};

const HomePage = () => {
  const isMobile = useIsMobile();
  const MOBILE_SLOT_STEP = 4;
  // 모바일 "4개 격자 + <> 페이지"용: 구좌별 페이지 상태
  const [slotPageById, setSlotPageById] = React.useState({});
  const shiftSlotPage = React.useCallback((slotId, delta, pageCount) => {
    try {
      const sid = String(slotId || '').trim();
      if (!sid) return;
      const pc = Math.max(1, Number(pageCount || 1) || 1);
      setSlotPageById((prev) => {
        const cur = Number(prev?.[sid] || 0) || 0;
        const next = ((cur + Number(delta || 0)) % pc + pc) % pc;
        return { ...(prev || {}), [sid]: next };
      });
    } catch (_) {}
  }, []);
  const queryClient = useQueryClient();
  // ✅ 검색바 비노출(요구사항): 현재 검색 기능이 정상 동작하지 않아 전 탭에서 숨긴다.
  // - 추후 검색 기능 복구 시 이 플래그만 true로 되돌리면 UI가 다시 노출된다.
  const SEARCH_UI_ENABLED = false;
  const [searchQuery, setSearchQuery] = useState('');
  const { user, isAuthenticated, logout } = useAuth();
  const isAdmin = !!user?.is_admin;
  const requireAuth = useRequireAuth();
  const navigate = useNavigate();
  const location = useLocation();
  // 메인 페이지 A/B 변형(SSOT):
  // - 로그인: user_id 기준 고정
  // - 비로그인: client_id 기준 고정
  // - QA: ?ab_home=A|B 오버라이드 지원
  const homeAb = useMemo(
    () => resolveHomeAbVariant({ userId: user?.id, search: location?.search }),
    [user?.id, location?.search]
  );
  const homeVariant = homeAb.variant;
  const homeMainRootRef = useRef(null);
  const homeRenderPerfRef = useRef({
    startAt: 0,
    bannerAt: null,
    bannerReason: '',
    done: false,
    settleTimer: null,
  });
  window.__CC_PAGE_META = { ab_home: homeAb.variant };
  useEffect(() => () => { window.__CC_PAGE_META = null; }, []);

  useEffect(() => {
    const now = () => ((typeof performance !== 'undefined' && typeof performance.now === 'function')
      ? performance.now()
      : Date.now());
    const perfState = homeRenderPerfRef.current;
    perfState.startAt = now();
    perfState.bannerAt = null;
    perfState.bannerReason = '';
    perfState.done = false;
    perfState.settleTimer = null;
    try { performance.mark('home:render:start'); } catch (_) {}

    const root = homeMainRootRef.current;
    if (!root) return undefined;

    const hasPendingMainLoading = () => {
      try {
        const pending = root.querySelectorAll('.animate-pulse, .animate-spin, [aria-busy="true"], [data-loading="true"]');
        for (const el of pending) {
          if (!el.closest('[data-home-history-section="true"]')) return true;
        }
        return false;
      } catch (_) {
        return false;
      }
    };

    const finalize = (trigger = 'unknown') => {
      if (perfState.done) return;
      if (!(Number(perfState.bannerAt) > 0)) return;
      perfState.done = true;
      if (perfState.settleTimer) {
        try { window.clearTimeout(perfState.settleTimer); } catch (_) {}
        perfState.settleTimer = null;
      }

      const endAt = now();
      const payload = {
        startedAt: perfState.startAt,
        bannerAt: perfState.bannerAt,
        finishedAt: endAt,
        totalMs: Math.max(0, Math.round(endAt - perfState.startAt)),
        bannerToMainMs: Math.max(0, Math.round(endAt - perfState.bannerAt)),
        bannerReason: perfState.bannerReason || 'unknown',
        trigger,
      };

      try { performance.mark('home:render:done'); } catch (_) {}
      try { performance.measure('home:render:total', 'home:render:start', 'home:render:done'); } catch (_) {}
      try { window.__CC_HOME_RENDER_PERF = payload; } catch (_) {}
      try { window.dispatchEvent(new CustomEvent('home:render-complete', { detail: payload })); } catch (_) {}
      try {
        console.info(
          '[Perf][Home] banner->main(ms):',
          payload.bannerToMainMs,
          '| total(ms):',
          payload.totalMs,
          '| bannerReason:',
          payload.bannerReason,
          '| trigger:',
          payload.trigger
        );
      } catch (_) {}
    };

    const scheduleFinalizeCheck = (trigger = 'mutation') => {
      if (perfState.done) return;
      if (!(Number(perfState.bannerAt) > 0)) return;
      if (hasPendingMainLoading()) {
        if (perfState.settleTimer) {
          try { window.clearTimeout(perfState.settleTimer); } catch (_) {}
          perfState.settleTimer = null;
        }
        return;
      }
      if (perfState.settleTimer) {
        try { window.clearTimeout(perfState.settleTimer); } catch (_) {}
      }
      perfState.settleTimer = window.setTimeout(() => {
        if (hasPendingMainLoading()) return;
        finalize(trigger);
      }, 250);
    };

    const onBannerReady = (e) => {
      try {
        if (Number(perfState.bannerAt) > 0) return;
        const at = Number(e?.detail?.at);
        perfState.bannerAt = Number.isFinite(at) && at > 0 ? at : now();
        perfState.bannerReason = String(e?.detail?.reason || '').trim() || 'unknown';
      } catch (_) {
        perfState.bannerAt = now();
        perfState.bannerReason = 'unknown';
      }
      scheduleFinalizeCheck('banner-event');
    };

    let rafId = 0;
    let pollId = 0;
    let observer = null;
    try { window.addEventListener('home:banner-ready', onBannerReady); } catch (_) {}
    try {
      const pre = window.__CC_HOME_BANNER_READY;
      const preAt = Number(pre?.at);
      if (pre && Number.isFinite(preAt) && preAt >= (perfState.startAt - 100)) {
        onBannerReady({ detail: pre });
      }
    } catch (_) {}
    try {
      observer = new MutationObserver(() => scheduleFinalizeCheck('mutation'));
      observer.observe(root, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['class', 'aria-busy', 'data-loading'],
      });
    } catch (_) {}
    try {
      rafId = window.requestAnimationFrame(() => scheduleFinalizeCheck('raf'));
    } catch (_) {}
    try {
      pollId = window.setInterval(() => scheduleFinalizeCheck('poll'), 500);
    } catch (_) {}

    return () => {
      try { window.removeEventListener('home:banner-ready', onBannerReady); } catch (_) {}
      try { if (observer) observer.disconnect(); } catch (_) {}
      try { if (rafId) window.cancelAnimationFrame(rafId); } catch (_) {}
      try { if (pollId) window.clearInterval(pollId); } catch (_) {}
      try {
        if (perfState.settleTimer) {
          window.clearTimeout(perfState.settleTimer);
          perfState.settleTimer = null;
        }
      } catch (_) {}
    };
  }, []);

  // ✅ PC 홈: 일반 캐릭터챗 카드 클릭 시 "모바일 상세 모달"로 프리뷰(요구사항)
  const [pcMobileDetailOpen, setPcMobileDetailOpen] = useState(false);
  const [pcMobileDetailCharacterId, setPcMobileDetailCharacterId] = useState('');
  const [pcMobileDetailInitialData, setPcMobileDetailInitialData] = useState(null);
  const isEligibleHomePcModal = React.useCallback((c) => {
    try {
      if (!c) return false;
      const isFromOrigChat = !!(c?.origin_story_id || c?.is_origchat || c?.source === 'origchat');
      const st = String(c?.source_type || '').trim().toUpperCase();
      // ✅ 원작챗은 모달 프리뷰 허용(요청)
      if (isFromOrigChat) return true;
      // ✅ 원작이 아닌 IMPORTED(웹소설/연재 기반)는 기존대로 상세 페이지 랜딩 유지
      if (st === 'IMPORTED') return false;
      return true; // 일반 캐릭터챗
    } catch (_) {
      return false;
    }
  }, []);
  const openPcMobileDetail = React.useCallback((c) => {
    try {
      const id = String(c?.id || c?.character_id || c?.characterId || '').trim();
      if (!id) return;
      // 모바일/태블릿에서는 기존대로 페이지 랜딩(UX/호환 유지)
      // - CharacterCard 내부 이벤트 가드는 (max-width: 1023px) 기준을 사용하므로 여기서도 동일 기준으로 통일한다.
      const isNarrowViewport = (() => {
        try { return !!window.matchMedia?.('(max-width: 1023px)')?.matches; } catch (_) { return false; }
      })();
      if (isMobile || isNarrowViewport) {
        navigate(`/characters/${id}`);
        return;
      }
      // PC에서만, 허용 대상만 모달 프리뷰
      if (!isEligibleHomePcModal(c)) {
        navigate(`/characters/${id}`);
        return;
      }
      setPcMobileDetailInitialData(c || null);
      setPcMobileDetailCharacterId(id);
      setPcMobileDetailOpen(true);
    } catch (_) {}
  }, [isMobile, isEligibleHomePcModal, navigate]);

  // ✅ 홈(PC) 어디서든(트렌딩/추천/CMS 포함) "home:pc-mobile-detail" 이벤트로 모달을 열 수 있게 한다.
  useEffect(() => {
    const handler = (e) => {
      try {
        const isNarrowViewport = (() => {
          try { return !!window.matchMedia?.('(max-width: 1023px)')?.matches; } catch (_) { return false; }
        })();
        if (isMobile || isNarrowViewport) return;
        const id = String(e?.detail?.characterId || '').trim();
        if (!id) return;
        setPcMobileDetailCharacterId(id);
        setPcMobileDetailOpen(true);
      } catch (_) {}
    };
    try {
      window.addEventListener('home:pc-mobile-detail', handler);
      return () => window.removeEventListener('home:pc-mobile-detail', handler);
    } catch (_) {
      return undefined;
    }
  }, [isMobile]);

  // ===== Google tag (gtag.js) - 메인(홈) 페이지만 우선 적용 =====
  // 배경/의도:
  // - GTM(태그매니저)과는 다른 방식의 "직접 GA4 태그"다.
  // - 운영 안정성을 위해, 우선 HomePage에서만 동적으로 로드한다(전역 index.html에는 추가하지 않음).
  // - SPA 특성상 "각 페이지에 스니펫을 박는" 방식은 맞지 않으며,
  //   전체 페이지 추적은 추후 라우트 변경 시 page_view를 쏘는 형태로 확장하면 된다.
  useEffect(() => {
    const GA_MEASUREMENT_ID = 'G-567FETFR8W';
    try {
      if (typeof window === 'undefined' || typeof document === 'undefined') return;

      // ✅ gtag bootstrap (GTM이 이미 dataLayer를 쓰고 있어도 충돌 없이 공존)
      window.dataLayer = window.dataLayer || [];
      window.gtag = window.gtag || function gtag(){ window.dataLayer.push(arguments); };

      // ✅ gtag.js 스크립트는 중복 삽입하지 않는다(리렌더/HMR/뒤로가기 방어)
      const marker = `script[data-ga-gtag="${GA_MEASUREMENT_ID}"]`;
      const exists = document.querySelector(marker);
      if (!exists) {
        const s = document.createElement('script');
        s.async = true;
        s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GA_MEASUREMENT_ID)}`;
        s.setAttribute('data-ga-gtag', GA_MEASUREMENT_ID);
        s.onerror = () => {
          try { console.warn('[HomePage] gtag.js load failed:', GA_MEASUREMENT_ID); } catch (_) {}
        };
        document.head.appendChild(s);
      }

      // ✅ 메인(홈) 진입 시점만 기록(요구사항: 우선 메인만)
      window.gtag('js', new Date());
      window.gtag('config', GA_MEASUREMENT_ID, {
        page_path: `${window.location.pathname}${window.location.search || ''}`,
      });

      // 개발 환경에서만 "중복 집계" 가능성 경고(운영 콘솔 노이즈 방지)
      if (import.meta.env.DEV) {
        const hasGtm = !!(window.google_tag_manager || document.querySelector('script[src*="gtm.js?id="]'));
        if (hasGtm) {
          // GTM 컨테이너에 GA4 태그를 또 추가하면 중복 집계될 수 있다.
          console.warn('[HomePage] GTM is present. If GA4 is also configured inside GTM, analytics may be double-counted.');
        }
      }
    } catch (e) {
      try { console.warn('[HomePage] gtag bootstrap failed:', e?.message || e); } catch (_) {}
    }
  }, []);

  // ===== CMS 구좌 설정(순서/숨김/노출시간) =====
  // - HomePage는 구좌(섹션)를 렌더링하기 전에 로컬스토리지(CMS) 설정을 먼저 읽는다.
  // - 같은 탭 저장(HOME_SLOTS_CHANGED_EVENT) + 다른 탭 저장(storage event)을 구독하여 즉시 반영한다.
  const [homeSlots, setHomeSlots] = useState(() => {
    try { return getHomeSlots(); } catch (_) { return []; }
  });
  const refreshHomeSlots = React.useCallback(() => {
    try { setHomeSlots(getHomeSlots()); } catch (e) {
      try { console.error('[HomePage] getHomeSlots failed:', e); } catch (_) {}
      setHomeSlots([]);
    }
  }, []);
  useEffect(() => {
    const onCustom = () => refreshHomeSlots();
    const onStorage = (e) => {
      try {
        if (!e) return;
        if (e.key === HOME_SLOTS_STORAGE_KEY) refreshHomeSlots();
      } catch (_) {}
    };
    try { window.addEventListener(HOME_SLOTS_CHANGED_EVENT, onCustom); } catch (_) {}
    try { window.addEventListener('storage', onStorage); } catch (_) {}
    return () => {
      try { window.removeEventListener(HOME_SLOTS_CHANGED_EVENT, onCustom); } catch (_) {}
      try { window.removeEventListener('storage', onStorage); } catch (_) {}
    };
  }, [refreshHomeSlots]);

  // ===== CMS 태그 노출/순서 설정(캐릭터 탭/태그 선택 모달 공통) =====
  const [characterTagDisplay, setCharacterTagDisplayState] = useState(() => {
    try { return getCharacterTagDisplay(); } catch (_) { return {}; }
  });
  const hiddenCharacterTagSlugsSet = React.useMemo(() => {
    try {
      const arr = Array.isArray(characterTagDisplay?.hiddenSlugs) ? characterTagDisplay.hiddenSlugs : [];
      return new Set(arr.map((s) => String(s || '').trim()).filter(Boolean));
    } catch (_) {
      return new Set();
    }
  }, [characterTagDisplay]);
  const refreshCharacterTagDisplay = React.useCallback(() => {
    try { setCharacterTagDisplayState(getCharacterTagDisplay()); } catch (e) {
      try { console.error('[HomePage] getCharacterTagDisplay failed:', e); } catch (_) {}
      setCharacterTagDisplayState({});
    }
  }, []);
  useEffect(() => {
    const onCustom = () => refreshCharacterTagDisplay();
    const onStorage = (e) => {
      try {
        if (!e) return;
        if (e.key === CHARACTER_TAG_DISPLAY_STORAGE_KEY) refreshCharacterTagDisplay();
      } catch (_) {}
    };
    try { window.addEventListener(CHARACTER_TAG_DISPLAY_CHANGED_EVENT, onCustom); } catch (_) {}
    try { window.addEventListener('storage', onStorage); } catch (_) {}
    return () => {
      try { window.removeEventListener(CHARACTER_TAG_DISPLAY_CHANGED_EVENT, onCustom); } catch (_) {}
      try { window.removeEventListener('storage', onStorage); } catch (_) {}
    };
  }, [refreshCharacterTagDisplay]);

  // ✅ 운영 SSOT: 서버(DB)의 태그 노출/순서 설정을 우선 사용한다.
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const res = await cmsAPI.getCharacterTagDisplay();
        if (!active) return;
        const cfg = (res && res.data && typeof res.data === 'object') ? res.data : null;
        if (!cfg) return;

        // ✅ 안전 전환: 배포 직후 서버 SSOT가 "기본값(미설정)"일 수 있다.
        // - 관리자에게는 로컬 편집/기본값이 덮여 사라지지 않게 보호한다.
        let skipApply = false;
        try {
          const hasLocal = !!localStorage.getItem(CHARACTER_TAG_DISPLAY_STORAGE_KEY);
          const looksDefault = isDefaultCharacterTagDisplayConfig(cfg);
          if (isAdmin && hasLocal && looksDefault) skipApply = true;
        } catch (_) {}

        if (!skipApply) {
          try { persistCharacterTagDisplay(cfg); } catch (_) {}
        }
        refreshCharacterTagDisplay();
      } catch (e) {
        try { console.warn('[HomePage] cmsAPI.getCharacterTagDisplay failed:', e); } catch (_) {}
      }
    };
    load();
    return () => { active = false; };
  }, [isAdmin, refreshCharacterTagDisplay]);

  /**
   * ✅ 운영 SSOT: 서버(DB)의 구좌 설정을 우선 사용한다.
   *
   * 동작:
   * - 홈 진입 시 서버에서 구좌 설정을 가져와 로컬스토리지에 캐시한다.
   * - 이후 렌더링 규칙은 기존 로컬 유틸(getHomeSlots/isHomeSlotActive)을 그대로 사용(최소 수정).
   *
   * 방어적:
   * - 서버 호출 실패 시 기존 로컬값으로 표시(홈이 죽지 않게).
   */
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const res = await cmsAPI.getHomeSlots();
        if (!active) return;
        const arr = Array.isArray(res?.data) ? res.data : null;
        if (arr) {
          // ✅ 안전 전환: 배포 직후 서버 SSOT가 비어 기본 구좌만 내려오는 경우,
          // 로컬에 편집값이 있으면 덮어써서 사라지지 않도록 로컬을 우선 유지한다.
          let skipApply = false;
          try {
            const hasLocal = !!localStorage.getItem(HOME_SLOTS_STORAGE_KEY);
            const looksDefault = isDefaultHomeSlotsConfig(arr);
            // ✅ 운영 SSOT 우선(중요): 일반 유저는 무조건 서버값 적용
            if (isAdmin && hasLocal && looksDefault) skipApply = true;
          } catch (_) {}
          if (!skipApply) {
            try { persistHomeSlots(arr); } catch (_) {}
          }
          refreshHomeSlots();
        }
      } catch (e) {
        try { console.warn('[HomePage] getHomeSlots(server) failed(keep local):', e); } catch (_) {}
      }
    };
    load();
    return () => { active = false; };
  }, [refreshHomeSlots, isAdmin]);

  // ===== CMS 홈 팝업 설정(운영 SSOT + 유저 로컬 "N일간 안보기") =====
  const [homePopupsConfig, setHomePopupsConfigState] = useState(() => {
    try { return getHomePopupsConfig(); } catch (_) { return { maxDisplayCount: 1, items: [] }; }
  });
  const refreshHomePopupsConfig = React.useCallback(() => {
    try { setHomePopupsConfigState(getHomePopupsConfig()); } catch (e) {
      try { console.error('[HomePage] getHomePopupsConfig failed:', e); } catch (_) {}
      setHomePopupsConfigState({ maxDisplayCount: 1, items: [] });
    }
  }, []);

  useEffect(() => {
    const onCustom = () => refreshHomePopupsConfig();
    const onStorage = (e) => {
      try {
        if (!e) return;
        if (e.key === HOME_POPUPS_STORAGE_KEY) refreshHomePopupsConfig();
      } catch (_) {}
    };
    try { window.addEventListener(HOME_POPUPS_CHANGED_EVENT, onCustom); } catch (_) {}
    try { window.addEventListener('storage', onStorage); } catch (_) {}
    return () => {
      try { window.removeEventListener(HOME_POPUPS_CHANGED_EVENT, onCustom); } catch (_) {}
      try { window.removeEventListener('storage', onStorage); } catch (_) {}
    };
  }, [refreshHomePopupsConfig]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const res = await cmsAPI.getHomePopups();
        if (!active) return;
        const cfg = (res && res.data && typeof res.data === 'object') ? res.data : null;
        if (!cfg) return;

        // ✅ 안전 전환: 배포 직후 서버 SSOT가 기본값(빈 목록)일 수 있다.
        // - 관리자에게는 로컬 편집값이 덮여 사라지지 않게 보호한다.
        let skipApply = false;
        try {
          const hasLocal = !!localStorage.getItem(HOME_POPUPS_STORAGE_KEY);
          const looksDefault = isDefaultHomePopupsConfig(cfg);
          if (isAdmin && hasLocal && looksDefault) skipApply = true;
        } catch (_) {}

        if (!skipApply) {
          try { persistHomePopupsConfig(cfg); } catch (_) {}
        }
        refreshHomePopupsConfig();
      } catch (e) {
        try { console.warn('[HomePage] cmsAPI.getHomePopups failed:', e); } catch (_) {}
      }
    };
    load();
    return () => { active = false; };
  }, [isAdmin, refreshHomePopupsConfig]);

  const [homePopupQueue, setHomePopupQueue] = React.useState([]);
  const [homePopupIdx, setHomePopupIdx] = React.useState(0);
  const [homePopupOpen, setHomePopupOpen] = React.useState(false);
  const homePopupsShownRef = React.useRef(false);

  React.useEffect(() => {
    const deviceKey = isMobile ? 'mobile' : 'pc';
    const cfg = (homePopupsConfig && typeof homePopupsConfig === 'object') ? homePopupsConfig : { maxDisplayCount: 1, items: [] };
    const maxCnt = Math.max(0, Math.min(10, Math.floor(Number(cfg.maxDisplayCount ?? 1) || 0)));

    if (maxCnt <= 0) return;
    if (homePopupsShownRef.current) return;

    const activePopups = getActiveHomePopups(Date.now(), deviceKey);
    const candidates = (Array.isArray(activePopups) ? activePopups : []).filter((p) => !isPopupDismissed(p?.id));
    const queue = candidates.slice(0, maxCnt);
    if (queue.length === 0) return;

    homePopupsShownRef.current = true;
    setHomePopupQueue(queue);
    setHomePopupIdx(0);
    setHomePopupOpen(true);
  }, [homePopupsConfig, isMobile]);

  const currentHomePopup = (Array.isArray(homePopupQueue) && homePopupQueue.length > 0)
    ? (homePopupQueue[homePopupIdx] || null)
    : null;

  const closeHomePopupAndNext = React.useCallback((dismissMode = 'session') => {
    const p = currentHomePopup;
    if (p?.id) {
      const days = (dismissMode === 'days') ? Number(p.dismissDays ?? 1) : 0;
      try { dismissPopup(p.id, days); } catch (_) {}
    }

    setHomePopupIdx((prev) => {
      const next = Number(prev || 0) + 1;
      const total = Array.isArray(homePopupQueue) ? homePopupQueue.length : 0;
      if (next >= total) {
        setHomePopupOpen(false);
        return prev;
      }
      return next;
    });
  }, [currentHomePopup, homePopupQueue]);

  // ===== CMS 커스텀 구좌: 대화수/좋아요수 보정(운영/UX 안정) =====
  // 배경:
  // - CMS 구좌의 contentPicks.item은 "선택 시점 스냅샷"을 저장한다.
  // - 이 스냅샷에 chat_count가 없거나(구버전 데이터), 혹은 오래되어 0으로 보일 수 있어 홈 UX가 깨진다.
  // - 홈 렌더 직전에, 화면에 실제로 보이는 캐릭터들의 최신 count만 가볍게 보정한다.
  const [cmsLiveCountsByCharId, setCmsLiveCountsByCharId] = React.useState({});
  const cmsVisibleCustomCharIds = React.useMemo(() => {
    try {
      // ⚠️ 주의: 이 블록은 파일 상단(초기 훅 구간)에서 실행되므로,
      // 아래쪽에서 선언되는 `activeHomeSlots`를 직접 참조하면 TDZ(Temporal Dead Zone)로 런타임 에러가 날 수 있다.
      // 따라서 여기서는 `homeSlots + isHomeSlotActive`로 동일한 계산을 로컬에서 수행한다.
      const now = Date.now();
      const allSlots = Array.isArray(homeSlots) ? homeSlots : [];
      const slots = allSlots.filter((s) => {
        try { return isHomeSlotActive(s, now); } catch (_) { return false; }
      });
      const seen = new Set();
      const out = [];

      for (const slot of slots) {
        const sid = String(slot?.id || '').trim();
        const slotType = String(slot?.slotType || '').trim().toLowerCase();
        const rawPicks = Array.isArray(slot?.contentPicks) ? slot.contentPicks : [];
        if (!(slotType === 'custom' || rawPicks.length > 0)) continue;

        const items = rawPicks
          .map((p) => {
            const t = String(p?.type || '').trim().toLowerCase();
            const it = p?.item;
            if (!it) return null;
            if (t === 'character') return { type: 'character', item: it };
            if (t === 'story') return { type: 'story', item: it };
            return null;
          })
          .filter(Boolean);

        if (items.length === 0) continue;

        // 홈 커스텀 구좌 렌더 정책과 동일(최대 24개, 모바일은 4개 페이징)
        const MAX_ITEMS = 24;
        const capped = items.slice(0, MAX_ITEMS);
        const pageSize = isMobile ? MOBILE_SLOT_STEP : capped.length;
        const pageCount = Math.max(1, Math.ceil(capped.length / Math.max(1, pageSize)));
        const page = Number(slotPageById?.[sid] || 0) || 0;
        const visible = isMobile
          ? capped.slice(page * pageSize, page * pageSize + pageSize)
          : capped;

        for (const x of (visible || [])) {
          if (x?.type !== 'character') continue;
          const id = String(x?.item?.id || '').trim();
          if (!id) continue;
          if (seen.has(id)) continue;
          seen.add(id);
          out.push(id);
        }
      }

      return out;
    } catch (_) {
      return [];
    }
  }, [homeSlots, isMobile, slotPageById]);

  React.useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const ids = Array.isArray(cmsVisibleCustomCharIds) ? cmsVisibleCustomCharIds : [];
      if (ids.length === 0) return;

      // 이미 보강(hydrate)한 id는 스킵
      // - 배포/핫픽스 직후, 이전 세션에서 {chat_count, like_count}만 저장된 값이 남아있을 수 있어
      //   `__meta_hydrated` 플래그로 "created_at/updated_at까지 포함한 보강이 끝났는지"를 구분한다.
      const missing = ids.filter((id) => !cmsLiveCountsByCharId?.[id]?.__meta_hydrated);
      if (missing.length === 0) return;

      // 너무 많은 병렬 호출은 피한다(홈 진입 시 급격한 트래픽 스파이크 방지)
      const MAX_FETCH = 8;
      const queue = missing.slice(0, MAX_FETCH);

      const results = {};
      let cursor = 0;
      const concurrency = 2;

      const worker = async () => {
        while (!cancelled) {
          const i = cursor;
          cursor += 1;
          if (i >= queue.length) break;
          const id = queue[i];
          try {
            const res = await charactersAPI.getCharacter(id);
            const c = res?.data || {};
            const chatCount = Number(c?.chat_count ?? c?.chatCount ?? 0) || 0;
            const likeCount = Number(c?.like_count ?? c?.likeCount ?? 0) || 0;
            // ✅ NEW 배지(48h)도 커스텀 구좌에서 항상 뜨게: created_at/updated_at까지 같이 보강한다.
            const createdAt = c?.created_at ?? c?.createdAt ?? null;
            const updatedAt = c?.updated_at ?? c?.updatedAt ?? null;
            const tags = Array.isArray(c?.tags) ? c.tags.map((t) => String(t?.name || t?.slug || t || '').trim()).filter(Boolean) : [];
            const characterType = c?.character_type || null;
            results[id] = {
              chat_count: chatCount,
              like_count: likeCount,
              ...(createdAt ? { created_at: createdAt } : {}),
              ...(updatedAt ? { updated_at: updatedAt } : {}),
              ...(tags.length > 0 ? { tags } : {}),
              ...(characterType ? { character_type: characterType } : {}),
              __meta_hydrated: true,
            };
          } catch (e) {
            // 홈이 죽지 않도록 실패는 무시(보수적). 운영 디버깅용으로만 경고 로그를 남긴다.
            try { console.warn('[HomePage] cms custom slot count hydrate failed:', { id, error: e?.message || e }); } catch (_) {}
          }
        }
      };

      try {
        await Promise.all(Array.from({ length: concurrency }).map(() => worker()));
      } catch (_) {
        // ignore
      }
      if (cancelled) return;

      const keys = Object.keys(results || {});
      if (keys.length === 0) return;
      setCmsLiveCountsByCharId((prev) => ({ ...(prev || {}), ...results }));
    };

    load();
    return () => { cancelled = true; };
  }, [cmsVisibleCustomCharIds, cmsLiveCountsByCharId]);

  // ===== 온보딩(메인 탭): 검색(성별+키워드) + 30초 생성 =====
  // 요구사항:
  // - 검색 기본값은 "전체"
  // - 필터:
  //   1) 성별: 전체/남성/여성/그외
  // - 태그 드롭다운은 제거하고, 태그도 키워드로 검색되도록 한다(서버 검색에 태그 포함)
  // - 결과 선택 시 해당 캐릭터와 대화 시작(항상 새 대화)
  const [onboardingGender, setOnboardingGender] = useState('all'); // all|male|female|other
  const [onboardingQueryRaw, setOnboardingQueryRaw] = useState('');
  const [onboardingQuery, setOnboardingQuery] = useState('');
  const [onboardingGenderDebounced, setOnboardingGenderDebounced] = useState('all');
  const [quickMeetOpen, setQuickMeetOpen] = useState(false);
  const [quickMeetInitialName, setQuickMeetInitialName] = useState('');
  const [quickMeetInitialSeedText, setQuickMeetInitialSeedText] = useState('');

  useEffect(() => {
    // 디바운스: 과도한 API 호출 방지(배포 안정)
    const t = setTimeout(() => {
      try { setOnboardingQuery(onboardingQueryRaw); } catch (_) {}
    }, 250);
    return () => clearTimeout(t);
  }, [onboardingQueryRaw]);

  useEffect(() => {
    // ✅ 성별도 디바운스해서, 연속 선택 시 API가 과도하게 호출되지 않도록 방어한다.
    const t = setTimeout(() => {
      try { setOnboardingGenderDebounced(onboardingGender); } catch (_) {}
    }, 250);
    return () => clearTimeout(t);
  }, [onboardingGender]);

  const openQuickMeet = (prefill = '') => {
    if (!requireAuth('캐릭터 생성')) return;
    const raw = String(prefill || '').trim();
    // ✅ UX: 검색어가 "이름"인지 "느낌"인지 애매하므로, 간단한 휴리스틱으로 안전하게 매핑한다.
    // - 공백이 있거나 길면(>8) 보통 '느낌'일 확률이 높다.
    // - 짧고 공백이 없으면 이름일 확률이 높다.
    const looksLikeName = !!raw && raw.length <= 8 && !/\s/.test(raw);
    setQuickMeetInitialName(looksLikeName ? raw : '');
    setQuickMeetInitialSeedText(looksLikeName ? '' : raw);
    setQuickMeetOpen(true);
  };

  const startChatFromOnboarding = (characterOrId) => {
    if (!requireAuth('캐릭터 채팅')) return;
    const c = (characterOrId && typeof characterOrId === 'object') ? characterOrId : null;
    const id = String((c?.id ?? characterOrId) || '').trim();
    if (!id) return;
    // ✅ 온보딩/검색은 항상 새 대화로 시작 (예측 가능 UX)
    const originStoryId = String(c?.origin_story_id || '').trim();
    const isOrig = !!originStoryId || !!(c?.is_origchat || c?.source === 'origchat');
    if (isOrig && originStoryId) {
      // ✅ 원작챗 캐릭터는 일반챗이 아니라 origchat plain 모드로 진입해야 한다.
      navigate(`/ws/chat/${id}?source=origchat&storyId=${originStoryId}&mode=plain&new=1`);
      return;
    }
    // ✅ opening 파라미터를 전달해야 intro(지문)가 채팅방에 저장됨
    const openingId = c?.start_sets?.selectedId || 'set_1';
    navigate(`/ws/chat/${id}?new=1&opening=${encodeURIComponent(openingId)}`);
  };

  const onboardingSearchTerm = React.useMemo(() => {
    try { return String(onboardingQuery || '').trim(); } catch (_) { return ''; }
  }, [onboardingQuery]);
  // ✅ 요구사항: 성별 선택만으로는 조회하지 않는다. 키워드(2글자 이상) 입력 시에만 검색한다.
  const onboardingSearchEnabled = onboardingSearchTerm.length >= 2;

  const { data: onboardingSearchResults = [], isLoading: onboardingSearchLoading } = useQuery({
    queryKey: [
      'onboarding',
      'search',
      onboardingGenderDebounced,
      onboardingSearchTerm,
    ],
    /**
     * ✅ 방어적: 탭 상태(isCharacterTab/isOrigSerialTab)는 아래에서 선언된다.
     * - 여기서 선참조하면 런타임 ReferenceError로 홈 전체가 렌더링 실패(=빈 화면)할 수 있다.
     * - 온보딩 검색은 "메인 탭"에서만 동작하면 되므로, URL 쿼리(tab)로 안전하게 판별한다.
     */
    enabled: onboardingSearchEnabled && (() => {
      try {
        const p = new URLSearchParams(location.search);
        const tab = p.get('tab');
        return tab !== 'character' && tab !== 'origserial';
      } catch (_) {
        return true; // 파싱 실패 시에도 홈이 죽지 않도록 기본 허용
      }
    })(),
    queryFn: async () => {
      try {
        const params2 = {
          skip: 0,
          limit: 10,
          // 키워드 검색(태그도 검색됨: 서버에서 tag slug/name을 함께 탐색)
          search: onboardingSearchTerm,
          // 온보딩은 "좋은 결과" 우선 노출(기본 인기순)
          sort: 'likes',
          // ✅ 성별 필터(서버에서 태그 기반으로 해석)
          gender: onboardingGenderDebounced !== 'all' ? onboardingGenderDebounced : undefined,
        };
        const res = await charactersAPI.getCharacters(params2);
        return Array.isArray(res.data) ? res.data : [];
      } catch (e) {
        console.error('[HomePage] onboarding search failed:', e);
        return [];
      }
    },
    staleTime: 0,
    refetchOnWindowFocus: false,
  });
  // URL 쿼리로부터 초기 탭 결정
  const params = new URLSearchParams(location.search);
  const tabParam = params.get('tab');
  const subParam = params.get('sub'); // origserial 서브탭: novel|origchat
  const initialFilter =
    tabParam === 'origserial' ? 'ORIGSERIAL' :
    tabParam === 'character' ? 'ORIGINAL' :
    null;
  const [sourceFilter, setSourceFilter] = useState(initialFilter);
  const [origSerialTab, setOrigSerialTab] = useState(subParam === 'origchat' ? 'origchat' : 'novel'); // 'novel' | 'origchat'
  const isCharacterTab = sourceFilter === 'ORIGINAL';
  const isOrigSerialTab = sourceFilter === 'ORIGSERIAL';
  const requestSourceType = isCharacterTab
    ? 'ORIGINAL'
    : sourceFilter === 'IMPORTED'
      ? 'IMPORTED'
      : undefined;
  const updateTab = (tabValue, tabQuery) => {
    setSourceFilter(tabValue);
    const p = new URLSearchParams(location.search);
    if (tabQuery) p.set('tab', tabQuery);
    else p.delete('tab');
    // origserial이 아닌 탭으로 이동하면 sub 파라미터는 제거(URL 정리)
    if (tabQuery !== 'origserial') p.delete('sub');
    navigate({ pathname: location.pathname, search: p.toString() }, { replace: true });
  };

  // ✅ URL 쿼리로 탭 상태 동기화(더보기 링크 등으로 이동 시 UI가 안 바뀌는 문제 방지)
  useEffect(() => {
    const next =
      tabParam === 'origserial' ? 'ORIGSERIAL' :
      tabParam === 'character' ? 'ORIGINAL' :
      null;
    setSourceFilter(next);
  }, [tabParam]);

  useEffect(() => {
    if (tabParam !== 'origserial') return;
    if (subParam === 'novel' || subParam === 'origchat') {
      setOrigSerialTab(subParam);
    }
  }, [tabParam, subParam]);

  /**
   * 검색 UI를 숨긴 상태에서 searchQuery 값이 남아있으면
   * 캐릭터/스토리 목록이 의도치 않게 필터링될 수 있다.
   * - 방어적으로 항상 초기화해서 "검색이 안되는데 목록이 줄어든" 혼란을 방지한다.
   */
  useEffect(() => {
    if (SEARCH_UI_ENABLED) return;
    const v = (searchQuery || '').trim();
    if (v) setSearchQuery('');
  }, [SEARCH_UI_ENABLED, searchQuery]);
  // 스토리 다이브 추천 작품(원작) - 10화 이상 + 표지 있음 + 원작챗 시작 수 낮은 순 + 평균조회수 반영(서버 계산)
  const { data: storyDiveStories = [], isLoading: storyDiveStoriesLoading } = useQuery({
    queryKey: ['storydive-stories-featured'],
    queryFn: async () => {
      try {
        const res = await storiesAPI.getStoryDiveSlots(10, 10);
        return Array.isArray(res.data) ? res.data : [];
      } catch (err) {
        console.error('Failed to load storydive stories:', err);
        return [];
      }
    },
    staleTime: 5 * 60 * 1000,
  });

  // 최근 스토리다이브 (스토리다이브 사용 경험 유저에게는 추천보다 최근이 우선)
  const { data: recentStoryDive = [], isLoading: recentStoryDiveLoading } = useQuery({
    // ✅ 유저별로 캐시 분리(React Query persist 사용 중이라, queryKey에 user.id가 없으면 타계정/과거 캐시가 섞여 보일 수 있음)
    queryKey: ['storydive-recent-sessions', user?.id || 'guest'],
    queryFn: async () => {
      try {
        const res = await storydiveAPI.getRecentSessions(10);
        return Array.isArray(res.data) ? res.data : [];
      } catch (err) {
        console.error('Failed to load recent storydive sessions:', err);
        return [];
      }
    },
    enabled: isAuthenticated && !!user?.id,
    staleTime: 5 * 60 * 1000,
  });

  /**
   * 홈(메인 탭) 전용: '일상' 태그 캐릭터 추천 섹션 데이터
   * - 기존 "특화 캐릭터 바로가기" 하드코딩을 제거하고, DB 태그 기반으로 노출한다.
   * - 방어적으로 실패/빈 배열을 처리해서 홈 화면이 깨지지 않도록 한다.
   */
  const DAILY_TAG_SLUG = '일상';
  const DAILY_CHARACTER_LIMIT = 6;
  const { data: dailyTagCharacters = [], isLoading: dailyTagCharactersLoading } = useQuery({
    queryKey: ['characters', 'home', 'daily-tag', DAILY_TAG_SLUG],
    queryFn: async () => {
      try {
        const res = await charactersAPI.getCharacters({
          tags: DAILY_TAG_SLUG,
          sort: 'views',
          limit: DAILY_CHARACTER_LIMIT,
          // "일반 캐릭터챗" 우선 노출 (원작/웹소설/원작연재 제외)
          source_type: 'ORIGINAL',
        });
        return Array.isArray(res.data) ? res.data : [];
      } catch (err) {
        console.error("Failed to load '일상' tag characters:", err);
        return [];
      }
    },
    enabled: !isCharacterTab && !isOrigSerialTab,
    staleTime: 5 * 60 * 1000,
  });

  // ✅ 홈(메인탭) 탐색영역: 무한스크롤 제거 → "더보기" 버튼으로 단계 로딩
  // - 격자(데스크탑 lg: 6열) 기준으로 12개 = 2줄 단위라 UX가 깔끔하다.
  // - 초기에는 12개만 노출해서 첫 로딩을 가볍게 한다.
  // - 유저가 버튼을 누를 때마다:
  //   - 모바일: 4개씩 추가(경쟁사처럼 '한 구좌당 4개' 흐름 유지)
  //   - 데스크탑: 12개씩 추가(2줄 단위)
  const EXPLORE_PAGE_SIZE = 12;
  const LIMIT = EXPLORE_PAGE_SIZE;
  const [exploreVisibleCount, setExploreVisibleCount] = useState(isMobile ? MOBILE_SLOT_STEP : EXPLORE_PAGE_SIZE);
  const [selectedTags, setSelectedTags] = useState([]); // slug 배열
  const [showAllTags, setShowAllTags] = useState(false);
  const visibleTagLimit = 18;
  const { data: allTags = [] } = useQuery({
    queryKey: ['tags-used-or-all'],
    queryFn: async () => {
      try {
        const all = (await tagsAPI.getTags()).data || [];
        const filteredAll = Array.isArray(all) ? all.filter(t => typeof t.slug === 'string' && !t.slug.startsWith('cover:')) : [];
        return filteredAll;
      } catch (e) {
        console.error('태그 목록 로드 실패:', e);
        return [];
      }
    },
    staleTime: 5 * 60 * 1000,
  });

  // 사용량 Top5 별도 조회 (정렬에 활용)
  const { data: topUsedTags = [] } = useQuery({
    queryKey: ['tags-top5'],
    queryFn: async () => {
      try {
        const res = await tagsAPI.getUsedTags();
        const arr = res.data || [];
        return Array.isArray(arr) ? arr.filter(t => typeof t.slug === 'string' && !t.slug.startsWith('cover:')) : [];
      } catch (_) {
        return [];
      }
    },
    staleTime: 5 * 60 * 1000,
  });
  const arrangedTags = React.useMemo(() => {
    const top = (topUsedTags || []).slice(0, 5);
    const topSlugs = new Set(top.map(t => t.slug));
    const base = (allTags || []).filter(t => !topSlugs.has(t.slug));
    const combined = [...base, ...[...top].reverse()];
    const isBad = (t) => {
      const s = String(t?.slug || '');
      const n = String(t?.name || '');
      return s.startsWith('cover:') || n.startsWith('cover:');
    };
    return combined.filter(t => !isBad(t));
  }, [allTags, topUsedTags]);

  // ✅ 캐릭터 탭용 태그 정렬(가나다 순, 영문/기타는 뒤로)
  const sortedTagsForCharacterTab = React.useMemo(() => {
    const base = Array.isArray(allTags) ? allTags : [];
    const getLabel = (t) => String(t?.name || t?.slug || '').trim();
    const isHangulStart = (label) => {
      const s = String(label || '').trim();
      if (!s) return false;
      const ch = s.codePointAt(0);
      // Hangul Syllables / Jamo / Compatibility Jamo
      return (
        (ch >= 0xAC00 && ch <= 0xD7A3) ||
        (ch >= 0x1100 && ch <= 0x11FF) ||
        (ch >= 0x3130 && ch <= 0x318F)
      );
    };

    const collatorKo = new Intl.Collator('ko-KR', { numeric: true, sensitivity: 'base' });
    const collatorEtc = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

    const baseSorted = [...base].sort((a, b) => {
      const la = getLabel(a);
      const lb = getLabel(b);
      const ha = isHangulStart(la);
      const hb = isHangulStart(lb);
      if (ha !== hb) return ha ? -1 : 1; // ✅ 한글 먼저
      if (ha) return collatorKo.compare(la, lb);
      return collatorEtc.compare(la, lb);
    });
    // ✅ 우선순위 태그를 상단에 배치(남성향 위주), 나머지는 기존 정렬 유지
    return applyTagDisplayConfig(baseSorted, characterTagDisplay);
  }, [allTags, characterTagDisplay]);

  const visibleCharacterTabTags = React.useMemo(() => {
    return showAllTags
      ? sortedTagsForCharacterTab
      : sortedTagsForCharacterTab.slice(0, visibleTagLimit);
  }, [sortedTagsForCharacterTab, showAllTags, visibleTagLimit]);

  const derivedTagSlug = React.useMemo(() => {
    const raw = searchQuery?.trim();
    if (!raw) return null;
    const normalized = raw.startsWith('#') ? raw.slice(1) : raw;
    const lower = normalized.toLowerCase();
    const match = arrangedTags.find(
      (t) =>
        String(t?.slug || '').toLowerCase() === lower ||
        String(t?.name || '').toLowerCase() === lower
    );
    return match?.slug || null;
  }, [searchQuery, arrangedTags]);

  const effectiveTags = React.useMemo(() => {
    const base = Array.isArray(selectedTags) ? [...selectedTags] : [];
    if (derivedTagSlug && !base.includes(derivedTagSlug)) {
      base.push(derivedTagSlug);
    }
    return base;
  }, [selectedTags, derivedTagSlug]);

  const effectiveTagsKey = React.useMemo(
    () => (effectiveTags.length ? [...effectiveTags].sort().join(',') : ''),
    [effectiveTags]
  );

  const visibleTags = showAllTags ? arrangedTags : arrangedTags.slice(0, visibleTagLimit);

  const {
    data: characterPages,
    isLoading: loading,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage
  } = useInfiniteQuery({
    queryKey: ['characters', 'infinite', searchQuery, effectiveTagsKey, sourceFilter],
    queryFn: async ({ pageParam = 0 }) => {
      try {
        const response = await charactersAPI.getCharacters({
          search: searchQuery || undefined,
          skip: pageParam,
          limit: LIMIT,
          tags: effectiveTags.length ? effectiveTags.join(',') : undefined,
          source_type: requestSourceType,
        });
        const items = response.data || [];
        return { items, nextSkip: items.length === LIMIT ? pageParam + LIMIT : null };
      } catch (error) {
        console.error('캐릭터 목록 로드 실패:', error);
        return { items: [], nextSkip: null };
      }
    },
    getNextPageParam: (lastPage) => lastPage.nextSkip,
    staleTime: 30 * 1000,
    cacheTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const characters = (characterPages?.pages || []).flatMap(p => p.items);
  const [characterPage, setCharacterPage] = useState(1);
  /**
   * ✅ 무한스크롤(캐릭터탭/원작챗탭) 센티넬/락
   *
   * 의도:
   * - 캐릭터탭: 페이지네이션 대신 스크롤 하단 진입 시 `characterPage`를 1씩 올려 누적 노출한다.
   * - 원작연재 > 원작챗탭: "더보기" 버튼 대신 스크롤 하단 진입 시 다음 페이지를 자동 로드한다.
   *
   * 방어:
   * - 홈 메인 탐색영역은 기존대로 "더보기 버튼" 유지(푸터 접근성/과도한 자동 로딩 이슈).
   * - IO 미지원 환경에서는 클릭 fallback을 남긴다(데모 안정성).
   */
  const characterTabSentinelRef = useRef(null);
  const origChatTabSentinelRef = useRef(null);
  const characterTabAutoFetchLockRef = useRef(false);
  const characterTabAutoScrollLockRef = useRef(false);
  const origChatAutoScrollLockRef = useRef(false);
  const supportsIntersectionObserver = React.useMemo(() => {
    try {
      return typeof window !== 'undefined' && 'IntersectionObserver' in window;
    } catch (_) {
      return false;
    }
  }, []);
  const generalCharacters = React.useMemo(
    () =>
      characters.filter((ch) => {
        const isOrigChat = !!(ch?.origin_story_id || ch?.is_origchat || ch?.source === 'origchat');
        const isWebNovel = ch?.source_type === 'IMPORTED';
        return !isOrigChat && !isWebNovel;
      }),
    [characters]
  );

  const origSerialCharacters = React.useMemo(
    () =>
      characters.filter((ch) => !!(ch?.origin_story_id || ch?.is_origchat || ch?.source === 'origchat')),
    [characters]
  );

  /**
   * ✅ 원작연재 > 원작챗 탭 전용 목록(중요)
   *
   * 배경/원인:
   * - 기존 구현은 `/characters?skip=0&limit=12` "섞인 목록"에서 origchat만 필터링했다.
   * - 운영 데이터가 많아지면 첫 페이지에 origchat이 0개일 수 있고,
   *   이때 UI가 "없음" 분기로 들어가면서 무한스크롤 센티넬/더보기가 렌더링되지 않아
   *   실제로 origchat이 존재해도 영원히 0개처럼 보이는 데드락이 발생했다.
   *
   * 해결:
   * - 원작챗 탭에서는 백엔드 지원 파라미터 `only=origchat`로 "전용 목록"을 직접 가져온다.
   * - 다른 탭(메인/캐릭터/웹소설)에는 영향 주지 않는다(최소 수정).
   */
  const ORIGCHAT_TAB_PAGE_LIMIT = 20;
  const {
    data: origChatCharacterPages,
    isLoading: origChatCharactersLoading,
    isFetchingNextPage: isFetchingNextOrigChatCharacters,
    hasNextPage: hasNextOrigChatCharacters,
    fetchNextPage: fetchNextOrigChatCharacters,
  } = useInfiniteQuery({
    queryKey: ['characters', 'origchat', 'infinite', searchQuery],
    enabled: isOrigSerialTab && origSerialTab === 'origchat',
    queryFn: async ({ pageParam = 0 }) => {
      try {
        const params2 = {
          skip: pageParam,
          limit: ORIGCHAT_TAB_PAGE_LIMIT,
          sort: 'likes',
          only: 'origchat',
        };
        const trimmed = searchQuery?.trim();
        if (trimmed) params2.search = trimmed;
        const res = await charactersAPI.getCharacters(params2);
        const items = res?.data || [];
        return {
          items,
          nextSkip: (Array.isArray(items) && items.length === ORIGCHAT_TAB_PAGE_LIMIT)
            ? pageParam + ORIGCHAT_TAB_PAGE_LIMIT
            : null,
        };
      } catch (e) {
        console.error('[HomePage] origchat characters load failed:', e);
        return { items: [], nextSkip: null };
      }
    },
    getNextPageParam: (lastPage) => lastPage?.nextSkip,
    staleTime: 30 * 1000,
    cacheTime: 10 * 60 * 1000,
  });
  const origChatCharacters = React.useMemo(() => {
    return (origChatCharacterPages?.pages || []).flatMap((p) => p?.items || []);
  }, [origChatCharacterPages]);

  // 원작연재 탭용 스토리 무한스크롤
  const STORY_LIMIT = 20;
  const {
    data: serialStoryPages,
    isLoading: serialStoriesLoading,
    isFetchingNextPage: isFetchingNextSerialPage,
    hasNextPage: hasNextSerialPage,
    fetchNextPage: fetchNextSerialPage,
    refetch: refetchSerialStories
  } = useInfiniteQuery({
    queryKey: ['serial-stories', 'infinite', searchQuery],
    queryFn: async ({ pageParam = 0 }) => {
      try {
        const params = {
          skip: pageParam,
          limit: STORY_LIMIT,
          sort: 'recent', // 최근 업데이트순
        };
        const trimmed = searchQuery?.trim();
        if (trimmed) params.search = trimmed;
        console.log('[원작연재] API 요청 params:', params);
        const res = await storiesAPI.getStories(params);
        console.log('[원작연재] API 응답:', res.data);
        const list = Array.isArray(res.data?.stories) ? res.data.stories : [];
        // 웹툰 제외, 공개된 것만 (프론트 필터링)
        const filtered = list.filter(s => !s?.is_webtoon && s?.is_public !== false);
        return { 
          items: filtered, 
          nextSkip: list.length === STORY_LIMIT ? pageParam + STORY_LIMIT : null 
        };
      } catch (error) {
        console.error('원작연재 스토리 목록 로드 실패:', error);
        return { items: [], nextSkip: null };
      }
    },
    getNextPageParam: (lastPage) => lastPage.nextSkip,
    staleTime: 30 * 1000,
    cacheTime: 10 * 60 * 1000,
    enabled: isOrigSerialTab, // 원작연재 탭일 때만 쿼리 실행
  });

  // const serialStories = (serialStoryPages?.pages || []).flatMap(p => p.items);
  // const novelStories = React.useMemo(
  //   () => serialStories.filter((s) => !s?.is_origchat),
  //   [serialStories]
  // );
  // const origchatStories = React.useMemo(
  //   () => serialStories.filter((s) => !!s?.is_origchat),
  //   [serialStories]
  // );
  const serialStories = (serialStoryPages?.pages || []).flatMap(p => p.items);
  // // 백엔드에서 only 파라미터로 필터링하므로 프론트 필터링 불필요
  // const novelStories = origSerialTab === 'novel' ? serialStories : [];
  // const origchatStories = origSerialTab === 'origchat' ? serialStories : [];
    // 원작소설 탭: 모든 Story (웹툰 제외)
  // 원작챗 탭: Character API에서 가져온 origSerialCharacters 사용 (Story API 불필요)
  const novelStories = serialStories.filter(s => !s?.is_webtoon);

  /**
   * 원작연재(원작소설) 더보기
   * - 기존 IntersectionObserver 무한스크롤을 제거하고, 버튼 클릭 시에만 20개(STORY_LIMIT) 단위로 로드한다.
   * - 실패 시 콘솔에 로그를 남겨 디버깅 가능하게 한다(요구사항).
   */
  const handleLoadMoreSerialStories = React.useCallback(async () => {
    if (!hasNextSerialPage || isFetchingNextSerialPage) return;
    try {
      await fetchNextSerialPage();
    } catch (e) {
      console.error('[원작연재] 더보기 실패:', e);
    }
  }, [hasNextSerialPage, isFetchingNextSerialPage, fetchNextSerialPage]);

  // 웹소설(스토리) 탐색: 공개 스토리 일부 노출
  const { data: exploreStories = [], isLoading: storiesLoading } = useQuery({
    queryKey: ['explore-stories', searchQuery, effectiveTagsKey],
    queryFn: async () => {
      try {
        const params = { limit: 12 };
        const trimmed = searchQuery?.trim();
        if (trimmed) params.search = trimmed;
        if (effectiveTags.length) params.tags = effectiveTags.join(',');
        const res = await storiesAPI.getStories(params);
        const list = Array.isArray(res.data?.stories) ? res.data.stories : [];
        return list.filter(s => s?.is_public !== false);
      } catch (_) { return []; }
    },
    staleTime: 0,
    refetchOnMount: 'always'
  });
  /**
   * 캐릭터 목록 더보기(원작챗/메인탐색에서 공용)
   * - 무한스크롤 제거 후, 유저가 버튼을 눌렀을 때만 다음 페이지를 로드한다.
   */
  const handleLoadMoreCharacters = React.useCallback(async () => {
    if (!hasNextPage || isFetchingNextPage) return;
    try {
      await fetchNextPage();
    } catch (e) {
      console.error('[홈] 캐릭터 더보기 실패:', e);
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  // 캐릭터 + 스토리를 한 그리드에 섞어서 노출
  const mixedItems = React.useMemo(() => {
    const result = [];
    const interval = 5; // 캐릭터 5개마다 스토리 1개 삽입
  const storyQueue = [...(exploreStories || [])];

    characters.forEach((ch, idx) => {
      // 썸네일 적용: 89px 표시 크기의 2배 = 178px (Retina 대응)
      const thumbnailCh = {
        ...ch,
        avatar_url: getThumbnailUrl(ch.avatar_url, 178)
      };
      result.push({ kind: 'character', data: thumbnailCh });
      
      if ((idx + 1) % interval === 0 && storyQueue.length > 0) {
        const story = storyQueue.shift();
        const thumbnailStory = {
          ...story,
          cover_url: getThumbnailUrl(story.cover_url, 178)
        };
        result.push({ kind: 'story', data: thumbnailStory });
      }
    });
  

    // 캐릭터가 적을 때는 남은 스토리 일부를 뒤에 보충
    if (result.length < 12 && storyQueue.length > 0) {
      const need = 12 - result.length;
      for (let i = 0; i < need && storyQueue.length > 0; i++) {
        result.push({ kind: 'story', data: storyQueue.shift() });
      }
    }
    return result;
  }, [characters, exploreStories, sourceFilter]);

  // 페이지 진입/검색 변경 시 첫 페이지 새로고침
  // 캐릭터 탭 페이지 초기화
  useEffect(() => {
    if (!isCharacterTab) {
      setCharacterPage(1);
      return;
    }
    setCharacterPage(1);
  }, [isCharacterTab, searchQuery, effectiveTagsKey]);

  const totalCharacterPages = React.useMemo(() => {
    if (!isCharacterTab) return 1;
    return Math.max(1, Math.ceil(generalCharacters.length / CHARACTER_PAGE_SIZE));
  }, [isCharacterTab, generalCharacters.length]);

  // 페이지 범위 보정
  useEffect(() => {
    if (!isCharacterTab) return;
    // ✅ 무한스크롤: 아직 추가 로드 가능하면(또는 로딩 중이면) 강제로 페이지를 줄이지 않는다.
    if (hasNextPage || isFetchingNextPage) return;
    if (characterPage > totalCharacterPages) {
      setCharacterPage(totalCharacterPages || 1);
    }
  }, [isCharacterTab, characterPage, totalCharacterPages, hasNextPage, isFetchingNextPage]);

  // 캐릭터 탭에서 필요한 만큼 데이터 확보
  useEffect(() => {
    if (!isCharacterTab) return;
    const requiredItems = characterPage * CHARACTER_PAGE_SIZE;
    if (generalCharacters.length >= requiredItems) return;
    if (!hasNextPage || isFetchingNextPage) return;
    if (characterTabAutoFetchLockRef.current) return;
    characterTabAutoFetchLockRef.current = true;
    fetchNextPage()
      .catch((e) => {
        try { console.error('[홈] 캐릭터 탭 자동 로드 실패:', e); } catch (_) {}
      })
      .finally(() => {
        characterTabAutoFetchLockRef.current = false;
      });
  }, [
    isCharacterTab,
    characterPage,
    generalCharacters.length,
    characters.length,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage
  ]);

  /**
   * ✅ 캐릭터 탭 무한스크롤(페이지네이션 제거)
   *
   * 원리:
   * - 하단 센티넬이 뷰포트에 들어오면 `characterPage`를 +1 해서 "다음 묶음(40개)"을 누적 노출한다.
   * - 데이터가 부족하면 위의 "필요한 만큼 데이터 확보" effect가 `fetchNextPage()`로 채운다.
   */
  useEffect(() => {
    if (!isCharacterTab) return;
    if (!supportsIntersectionObserver) return;
    const el = characterTabSentinelRef.current;
    if (!el) return;

    const margin = isMobile ? 900 : 700;
    let cancelled = false;
    const observer = new IntersectionObserver(
      (entries) => {
        if (cancelled) return;
        const first = entries?.[0];
        if (!first?.isIntersecting) return;
        if (isFetchingNextPage) return;

        const nextEnd = (characterPage + 1) * CHARACTER_PAGE_SIZE;
        const hasMoreLoaded = generalCharacters.length >= nextEnd;
        const canFetchMore = !!hasNextPage;
        if (!hasMoreLoaded && !canFetchMore) return;

        // 연속 트리거 방지(빠른 스크롤/레이아웃 변화)
        if (characterTabAutoScrollLockRef.current) return;
        characterTabAutoScrollLockRef.current = true;
        setCharacterPage((prev) => prev + 1);
        try {
          window.setTimeout(() => {
            characterTabAutoScrollLockRef.current = false;
          }, 250);
        } catch (_) {
          characterTabAutoScrollLockRef.current = false;
        }
      },
      { root: null, rootMargin: `${margin}px 0px`, threshold: 0.01 }
    );
    observer.observe(el);
    return () => {
      cancelled = true;
      try { observer.disconnect(); } catch (_) {}
    };
  }, [
    isCharacterTab,
    supportsIntersectionObserver,
    isMobile,
    isFetchingNextPage,
    hasNextPage,
    characterPage,
    generalCharacters.length
  ]);

  /**
   * ✅ 원작연재 > 원작챗 탭 무한스크롤("더보기" 버튼 대체)
   *
   * 원리:
   * - 하단 센티넬이 보이면 다음 페이지(fetchNextPage)를 자동 호출한다.
   * - 원작챗 탭은 `only=origchat` 전용 목록을 쓰므로, 센티넬은 그 전용 쿼리에 연결한다.
   */
  const handleLoadMoreOrigChatCharacters = React.useCallback(async () => {
    if (!hasNextOrigChatCharacters || isFetchingNextOrigChatCharacters) return;
    try {
      await fetchNextOrigChatCharacters();
    } catch (e) {
      console.error('[HomePage] origchat tab load more failed:', e);
    }
  }, [hasNextOrigChatCharacters, isFetchingNextOrigChatCharacters, fetchNextOrigChatCharacters]);

  useEffect(() => {
    if (!isOrigSerialTab || origSerialTab !== 'origchat') return;
    if (!supportsIntersectionObserver) return;
    const el = origChatTabSentinelRef.current;
    if (!el) return;

    const margin = isMobile ? 900 : 700;
    let cancelled = false;
    const observer = new IntersectionObserver(
      (entries) => {
        if (cancelled) return;
        const first = entries?.[0];
        if (!first?.isIntersecting) return;
        if (!hasNextOrigChatCharacters || isFetchingNextOrigChatCharacters) return;
        if (origChatAutoScrollLockRef.current) return;
        origChatAutoScrollLockRef.current = true;
        Promise.resolve(handleLoadMoreOrigChatCharacters())
          .catch((e) => {
            try { console.error('[홈] 원작챗 탭 자동 로드 실패:', e); } catch (_) {}
          })
          .finally(() => {
            origChatAutoScrollLockRef.current = false;
          });
      },
      { root: null, rootMargin: `${margin}px 0px`, threshold: 0.01 }
    );
    observer.observe(el);
    return () => {
      cancelled = true;
      try { observer.disconnect(); } catch (_) {}
    };
  }, [
    isOrigSerialTab,
    origSerialTab,
    supportsIntersectionObserver,
    isMobile,
    hasNextOrigChatCharacters,
    isFetchingNextOrigChatCharacters,
    handleLoadMoreOrigChatCharacters
  ]);

  const handleSearch = (e) => {
    e.preventDefault();
    // React Query가 자동으로 새로운 쿼리 키로 요청
    // searchQuery 상태가 변경되면 자동으로 refetch됨
  };

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  /**
   * 메인 우상단 공지(종) 빨간 점 표시 로직
   *
   * 원리:
   * - 서버에서 "최신 공지 시각"을 가져온다.
   * - 로컬(lastSeenAt)보다 최신이면 빨간 점을 띄운다.
   * - 사용자가 공지사항 페이지(/notices)에 들어가면 lastSeenAt이 갱신되어 점이 사라진다.
   *
   * 방어적 설계:
   * - API 실패 시 점을 숨겨 UI를 안정적으로 유지한다.
   */
  const { data: noticeLatestMeta } = useQuery({
    queryKey: ['notices', 'latest'],
    queryFn: async () => {
      try {
        const res = await noticesAPI.latest();
        return res?.data || null;
      } catch (e) {
        try { console.error('[notices] latest failed:', e); } catch (_) {}
        return null;
      }
    },
    staleTime: 15 * 1000,
    refetchOnWindowFocus: true,
  });

  const showNoticeDot = React.useMemo(() => {
    try {
      const latestAt = noticeLatestMeta?.latest_at;
      if (!latestAt) return false;
      const latestMs = new Date(latestAt).getTime();
      if (!Number.isFinite(latestMs) || latestMs <= 0) return false;
      const lastSeenRaw = localStorage.getItem('notices:lastSeenAt');
      const lastSeenMs = lastSeenRaw ? new Date(lastSeenRaw).getTime() : 0;
      if (!Number.isFinite(lastSeenMs) || lastSeenMs <= 0) return true; // 한 번도 안 봄
      return latestMs > lastSeenMs;
    } catch (_) {
      return false;
    }
  }, [noticeLatestMeta]);

  const startChat = (characterId) => {
    if (!requireAuth('캐릭터 채팅')) return;
    navigate(`/ws/chat/${characterId}`);
  };

  // 관심 캐릭터(좋아요한 캐릭터) 불러오기
  const { data: favoriteChars = [], isLoading: favLoading } = useQuery({
    queryKey: ['liked-characters', isAuthenticated],
    enabled: !!isAuthenticated,
    queryFn: async () => {
      const res = await usersAPI.getLikedCharacters({ limit: 12 });
      return res.data || [];
    },
    staleTime: 0,
    refetchOnMount: 'always'
  });

  const createCharacter = () => {
    if (!requireAuth('캐릭터 생성')) return;
    // ✅ 경쟁사 UX: 임시저장된 캐릭터 생성 초안이 있으면 "불러오기" 모달을 먼저 띄운다.
    try {
      if (hasCreateCharacterDraft()) {
        setDraftPromptOpen(true);
        return;
      }
    } catch (_) {}
    navigate('/characters/create');
  };

  /**
   * ✅ 캐릭터 생성(신규) 임시저장 존재 여부(SSOT: localStorage)
   *
   * 의도/원리:
   * - 홈에서 "캐릭터 생성"을 눌렀을 때, 임시저장 데이터가 있으면 바로 이동하지 않고
   *   사용자가 "새로 만들기/불러오기"를 선택할 수 있게 한다(경쟁사 UX).
   */
  const DRAFT_KEY_NEW = 'cc_draft_new';
  const DRAFT_KEY_NEW_MANUAL = 'cc_draft_new_manual';
  const hasCreateCharacterDraft = useCallback(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY_NEW);
      if (!raw) return false;
      // ✅ 방어: 일부 브라우저에서 localStorage 접근은 되지만 parse가 실패할 수 있다.
      // - 홈에서는 "존재"만 확인하면 충분하고, 실제 복원은 CreateCharacterPage에서 담당한다.
      const trimmed = String(raw).trim();
      if (trimmed.length <= 2) return false;
      // manual 플래그가 없어도(레거시/운영 데이터) 초안이 존재하면 모달을 띄우는 편이 UX가 낫다.
      return true;
    } catch (_) {
      return false;
    }
  }, []);

  // ✅ 홈 모달: 임시저장 불러오기(캐릭터 생성)
  const [draftPromptOpen, setDraftPromptOpen] = useState(false);
  const handleCreateCharacterClick = useCallback((e) => {
    try { e?.preventDefault?.(); } catch (_) {}
    if (!requireAuth('캐릭터 생성')) return;
    try {
      if (hasCreateCharacterDraft()) {
        setDraftPromptOpen(true);
        return;
      }
    } catch (_) {}
    navigate('/characters/create');
  }, [requireAuth, navigate, hasCreateCharacterDraft]);

  const handleDraftStartFresh = useCallback(() => {
    // 새로 만들기: 임시저장 삭제 후 생성 페이지로 이동
    try {
      localStorage.removeItem(DRAFT_KEY_NEW);
      localStorage.removeItem(DRAFT_KEY_NEW_MANUAL);
    } catch (_) {}
    try { setDraftPromptOpen(false); } catch (_) {}
    try { navigate('/characters/create'); } catch (_) {}
  }, [navigate]);

  const handleDraftLoad = useCallback(() => {
    // 불러오기: 임시저장 유지한 채 생성 페이지로 이동(페이지에서 자동 복원 로직이 담당)
    try { setDraftPromptOpen(false); } catch (_) {}
    try { navigate('/characters/create'); } catch (_) {}
  }, [navigate]);

  const viewCharacterDetail = (characterId) => {
    navigate(`/characters/${characterId}`);
  };

  // 메인탭 진입 시 인기 캐릭터 캐시 무효화
  useEffect(() => {
    queryClient.invalidateQueries({ queryKey: ['trending-characters-daily'] });
  }, [queryClient]);

  // 태그 추가 기능 제거 요청에 따라 관련 로직/버튼 제거됨

  // ✅ 경쟁사 격자 체감(카드가 너무 작아 보이지 않게):
  // - 대형 화면에서 6열로 늘어나면 카드가 경쟁사 대비 더 작아져 보인다.
  // - 그래서 데스크탑에서는 최대 5열로 캡한다(6열 금지).
  const gridColumnClasses = (isCharacterTab || isOrigSerialTab)
    ? 'grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-5 gap-3'
    : 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-5 gap-3';

  const displayGridItems = React.useMemo(() => {
    if (isCharacterTab) {
      // ✅ 캐릭터탭: 무한스크롤(누적) - 1페이지/2페이지...가 아니라 40개씩 점진적으로 "쌓아서" 보여준다.
      const end = characterPage * CHARACTER_PAGE_SIZE;
      const slice = generalCharacters.slice(0, end);
      return slice.map((c) => ({ kind: 'character', data: c }));
    }
    if (isOrigSerialTab) {
      return origSerialCharacters.map((c) => ({ kind: 'character', data: c }));
    }
    return mixedItems.length
      ? mixedItems
      : characters.map((c) => ({ kind: 'character', data: c }));
  }, [isCharacterTab, isOrigSerialTab, generalCharacters, origSerialCharacters, mixedItems, characters, characterPage]);

  /**
   * 메인탭 탐색 그리드 노출 개수 제어
   * - "메인탭 탐색영역"에서는 초기 20개만 보이고, 더보기 버튼을 누를 때마다 20개씩 추가 노출한다.
   * - 캐릭터 탭(페이지네이션)은 기존 동작 유지(40개/페이지).
   */
  useEffect(() => {
    if (isCharacterTab || isOrigSerialTab) return;
    setExploreVisibleCount(isMobile ? MOBILE_SLOT_STEP : EXPLORE_PAGE_SIZE);
  }, [isCharacterTab, isOrigSerialTab, searchQuery, effectiveTagsKey, sourceFilter, isMobile, MOBILE_SLOT_STEP]);

  const visibleGridItems = React.useMemo(() => {
    if (isCharacterTab) return displayGridItems;
    if (isOrigSerialTab) return displayGridItems; // 방어(탐색 섹션은 숨김)
    const safeCount = Number.isFinite(exploreVisibleCount) ? Math.max(0, exploreVisibleCount) : EXPLORE_PAGE_SIZE;
    return displayGridItems.slice(0, safeCount);
  }, [isCharacterTab, isOrigSerialTab, displayGridItems, exploreVisibleCount]);

  const hasGridItems = visibleGridItems.length > 0;
  // ✅ 캐릭터탭은 페이지네이션을 제거하고 무한스크롤로 전환
  const shouldShowPagination = false;

  const headerIconButtonBaseClass =
    'relative inline-flex items-center justify-center rounded-full border border-gray-700 bg-gray-800 text-gray-200 hover:bg-gray-700 transition-colors';

  /**
   * 모바일 상단 헤더(햄버거 바) 우측 액션(공지/관리자페이지)
   *
   * 의도:
   * - 모바일에서 홈 상단 탭(메인/스토리 에이전트)이 "3등분(grid-cols-3)" 레이아웃 때문에 폭이 줄어
   *   텍스트가 줄바꿈되며 세로로 깨지는 문제가 있었다.
   * - 공지(벨)/관리자(톱니) 아이콘을 AppLayout 모바일 헤더 우측으로 이동해 탭 영역 폭을 확보한다.
   */
  const mobileHeaderRight = (
    <>
      {user?.is_admin && (
        <button
          type="button"
          onClick={() => {
            try { window.open('/cms', '_blank', 'noopener,noreferrer'); } catch (_) { navigate('/cms'); }
          }}
          className={`${headerIconButtonBaseClass} h-10 w-10`}
          aria-label="관리자 페이지"
          title="관리자 페이지"
        >
          <Settings className="w-5 h-5" />
        </button>
      )}
      <button
        type="button"
        onClick={() => navigate('/notices')}
        className={`${headerIconButtonBaseClass} h-10 w-10`}
        aria-label="공지사항"
        title="공지사항"
      >
        <Bell className="w-5 h-5" />
        {showNoticeDot && (
          <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-red-500" aria-hidden="true" />
        )}
      </button>
    </>
  );

  /**
   * 메인탭 탐색 더보기 버튼
   * - visibleCount를 20개 증가시키고, 아직 로드된 아이템이 부족하면 다음 페이지를 추가 fetch 한다.
   */
  const handleExploreLoadMore = React.useCallback(async () => {
    const step = isMobile ? MOBILE_SLOT_STEP : EXPLORE_PAGE_SIZE;
    const nextCount = (Number.isFinite(exploreVisibleCount) ? exploreVisibleCount : step) + step;
    setExploreVisibleCount(nextCount);
    // 이미 로드된 데이터로 충분하면 네트워크 요청은 생략(성능/UX)
    if (displayGridItems.length >= nextCount) return;
    if (!hasNextPage || isFetchingNextPage) return;
    try {
      await fetchNextPage();
    } catch (e) {
      console.error('[홈] 탐색 더보기 실패:', e);
    }
  }, [exploreVisibleCount, displayGridItems.length, hasNextPage, isFetchingNextPage, fetchNextPage, isMobile, MOBILE_SLOT_STEP]);

  const paginationPages = React.useMemo(() => {
    if (!shouldShowPagination) return [];
    const maxVisible = 7;
    let start = Math.max(1, characterPage - Math.floor(maxVisible / 2));
    let end = Math.min(totalCharacterPages, start + maxVisible - 1);
    if (end - start + 1 < maxVisible) {
      start = Math.max(1, end - maxVisible + 1);
    }
    const pages = [];
    for (let i = start; i <= end; i += 1) {
      pages.push(i);
    }
    return pages;
  }, [shouldShowPagination, characterPage, totalCharacterPages]);

  const goToPage = React.useCallback((pageNumber) => {
    if (!isCharacterTab) return;
    const target = Math.min(Math.max(1, pageNumber), totalCharacterPages);
    setCharacterPage(target);
  }, [isCharacterTab, totalCharacterPages]);

  const handlePrevPage = React.useCallback(() => {
    goToPage(characterPage - 1);
  }, [goToPage, characterPage]);

  const handleNextPage = React.useCallback(() => {
    goToPage(characterPage + 1);
  }, [goToPage, characterPage]);

  // ===== CMS 구좌 렌더링(메인 탭 전용) =====
  const activeHomeSlots = React.useMemo(() => {
    const now = Date.now();
    const arr = Array.isArray(homeSlots) ? homeSlots : [];
    return arr.filter((s) => {
      try {
        return isHomeSlotActive(s, now);
      } catch (_) {
        return false;
      }
    });
  }, [homeSlots]);

  // 스토리다이브/최근대화/탐색은 CMS 구좌 조작 대상에서 제외(요구사항)
  // - 스토리다이브 구좌는 기존 위치(고정)에서 그대로 렌더링한다.
  // - CMS 구좌들은 (기본) "일상" 슬롯을 기준으로 스토리다이브 위/아래로 분리해 렌더링한다.
  const splitSlots = React.useMemo(() => {
    const list = Array.isArray(activeHomeSlots) ? activeHomeSlots : [];
    const anchorId = 'slot_daily_tag_characters';
    const idx = list.findIndex((s) => String(s?.id || '') === anchorId);
    if (idx < 0) return { pre: list, post: [] };
    return { pre: list.slice(0, idx), post: list.slice(idx) };
  }, [activeHomeSlots]);

  const renderHomeSlot = (slot) => {
    const id = String(slot?.id || '').trim();
    const title = String(slot?.title || '').trim();
    if (!id) return null;

    if (id === 'slot_top_origchat') {
  return (
        <ErrorBoundary>
          <TopOrigChat title={title} />
        </ErrorBoundary>
      );
    }

    if (id === 'slot_trending_characters') {
      return (
        <ErrorBoundary>
          <TrendingCharacters title={title} />
        </ErrorBoundary>
      );
    }

    if (id === 'slot_top_stories') {
      return (
        <ErrorBoundary>
          <TopStories title={title} />
        </ErrorBoundary>
      );
    }

    if (id === 'slot_recommended_characters') {
      return (
        <ErrorBoundary>
          <RecommendedCharacters title={title} />
        </ErrorBoundary>
      );
    }

    if (id === 'slot_daily_tag_characters') {
      // 데이터가 없으면 원래도 비노출이므로, CMS가 켜져 있어도 그대로 유지(방어적)
      if (!dailyTagCharactersLoading && !(dailyTagCharacters || []).length) return null;
      const header = title || '일상을 캐릭터와 같이 공유해보세요';
      const baseItems = (Array.isArray(dailyTagCharacters) ? dailyTagCharacters : []).slice(0, DAILY_CHARACTER_LIMIT);
      const skeletonCount = isMobile ? 4 : DAILY_CHARACTER_LIMIT;
      return (
        <section className="mt-8">
          <h2 className="text-xl font-bold text-white mb-4">{header}</h2>

          {/* ✅ 모바일: 최근대화처럼 1줄 스와이프 / 데스크탑: 기존 6개 격자 */}
          {isMobile ? (
            <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide">
              {dailyTagCharactersLoading ? (
                Array.from({ length: skeletonCount }).map((_, idx) => (
                  <div key={`daily-sk-${idx}`} className="flex-shrink-0 w-[220px]">
                    <div className="bg-gray-800/40 rounded-lg p-3 border border-gray-700/50 animate-pulse">
                      <div className="flex items-center gap-3 mb-2">
                        <div className="w-10 h-10 rounded-full bg-gray-700 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="h-3 w-20 bg-gray-700 rounded mb-2" />
                          <div className="h-3 w-32 bg-gray-700 rounded" />
                        </div>
                      </div>
                      <div className="h-4 w-full bg-gray-700 rounded" />
                    </div>
                  </div>
                ))
              ) : (
                baseItems.map((char, idx) => {
                  const id = char?.id;
                  const key = id || `daily-${idx}`;
                  const name = String(char?.name || '').trim() || '이름 없음';
                  const rawDesc = String(char?.description || '').trim();
                  const title = replacePromptTokens(rawDesc, { assistantName: name || '캐릭터', userName: '당신' }).trim();
                  const baseImg = char?.avatar_url || char?.thumbnail_url || '';
                  const imgSrc =
                    getThumbnailUrl(baseImg, 240) ||
                    resolveImageUrl(baseImg) ||
                    '';
                  const clickable = !!id;

                  return (
                    <div key={key} className="flex-shrink-0 w-[220px]">
                      <div
                        className={[
                          'bg-gray-800/40 rounded-lg p-3 transition-all border border-gray-700/50 hover:border-gray-600',
                          clickable ? 'cursor-pointer hover:bg-gray-800/60' : 'cursor-default opacity-80'
                        ].join(' ')}
                        role={clickable ? 'button' : undefined}
                        tabIndex={clickable ? 0 : undefined}
                        onClick={() => {
                          if (!id) return;
                          navigate(`/ws/chat/${id}`);
                        }}
                        onKeyDown={(e) => {
                          if (!clickable) return;
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            navigate(`/ws/chat/${id}`);
                          }
                        }}
                        aria-label={clickable ? `${name} 캐릭터와 대화하기` : undefined}
                      >
                        <div className="flex items-center gap-3 mb-2">
                          <div className="w-10 h-10 rounded-full bg-gray-700 flex items-center justify-center flex-shrink-0 overflow-hidden">
                            {imgSrc ? (
                              <img
                                src={imgSrc}
                                alt={name}
                                className="w-full h-full object-cover object-top"
                                onError={(e) => {
                                  e.target.style.display = 'none';
                                  const next = e.target.nextSibling;
                                  if (next) next.style.display = 'flex';
                                }}
                              />
                            ) : null}
                            <span className={`text-lg ${imgSrc ? 'hidden' : ''}`}>{name.charAt(0)}</span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-xs text-gray-400 truncate">{name}</div>
                          </div>
                          <Badge className="bg-yellow-500/90 text-black hover:bg-yellow-500 text-[10px] px-2 py-0.5">
                            일상
                          </Badge>
                        </div>
                        <div className="text-sm text-gray-200 leading-snug line-clamp-2">
                          {title || '지금 대화를 시작해보세요.'}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 xl:grid-cols-5 gap-3">
              {dailyTagCharactersLoading ? (
                Array.from({ length: skeletonCount }).map((_, idx) => (
                  <div
                    key={`daily-sk-${idx}`}
                    className="bg-gray-800/40 rounded-lg p-3 border border-gray-700/50 animate-pulse"
                  >
                    <div className="flex items-center gap-3 mb-2">
                      <div className="w-10 h-10 rounded-full bg-gray-700 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="h-3 w-20 bg-gray-700 rounded mb-2" />
                        <div className="h-3 w-32 bg-gray-700 rounded" />
                      </div>
                    </div>
                    <div className="h-4 w-full bg-gray-700 rounded" />
                  </div>
                ))
              ) : (
                baseItems.map((char, idx) => {
                  const id = char?.id;
                  const key = id || `daily-${idx}`;
                  const name = String(char?.name || '').trim() || '이름 없음';
                  const rawDesc = String(char?.description || '').trim();
                  const title = replacePromptTokens(rawDesc, { assistantName: name || '캐릭터', userName: '당신' }).trim();
                  const baseImg = char?.avatar_url || char?.thumbnail_url || '';
                  const imgSrc =
                    getThumbnailUrl(baseImg, 240) ||
                    resolveImageUrl(baseImg) ||
                    '';
                  const clickable = !!id;

                  return (
                    <div
                      key={key}
                      className={[
                        'bg-gray-800/40 rounded-lg p-3 transition-all border border-gray-700/50 hover:border-gray-600',
                        clickable ? 'cursor-pointer hover:bg-gray-800/60' : 'cursor-default opacity-80'
                      ].join(' ')}
                      role={clickable ? 'button' : undefined}
                      tabIndex={clickable ? 0 : undefined}
                      onClick={() => {
                        if (!id) return;
                        navigate(`/ws/chat/${id}`);
                      }}
                      onKeyDown={(e) => {
                        if (!clickable) return;
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          navigate(`/ws/chat/${id}`);
                        }
                      }}
                      aria-label={clickable ? `${name} 캐릭터와 대화하기` : undefined}
                    >
                      <div className="flex items-center gap-3 mb-2">
                        <div className="w-10 h-10 rounded-full bg-gray-700 flex items-center justify-center flex-shrink-0 overflow-hidden">
                          {imgSrc ? (
                            <img
                              src={imgSrc}
                              alt={name}
                              className="w-full h-full object-cover object-top"
                              onError={(e) => {
                                e.target.style.display = 'none';
                                const next = e.target.nextSibling;
                                if (next) next.style.display = 'flex';
                              }}
                            />
                          ) : null}
                          <span className={`text-lg ${imgSrc ? 'hidden' : ''}`}>{name.charAt(0)}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-xs text-gray-400 truncate">{name}</div>
                        </div>
                        <Badge className="bg-yellow-500/90 text-black hover:bg-yellow-500 text-[10px] px-2 py-0.5">
                          일상
                        </Badge>
                      </div>
                      <div className="text-sm text-gray-200 leading-snug line-clamp-2">
                        {title || '지금 대화를 시작해보세요.'}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </section>
      );
    }

    // CMS 커스텀 구좌: 운영자가 선택한 캐릭터/웹소설(스토리)을 홈에 노출
    // - 시스템 구좌와 달리, slot.id가 고정되어 있지 않다.
    // - contentPicks + contentSortMode 기반으로 렌더링한다.
    const slotType = String(slot?.slotType || '').trim().toLowerCase();
    const rawPicks = Array.isArray(slot?.contentPicks) ? slot.contentPicks : [];
    if (slotType === 'custom' || rawPicks.length > 0) {
      const items = rawPicks
        .map((p) => {
          const t = String(p?.type || '').trim().toLowerCase();
          const it = p?.item;
          if (!it) return null;
          if (t === 'character') return { type: 'character', item: it };
          if (t === 'story') return { type: 'story', item: it };
          return null;
        })
        .filter(Boolean);

      // 비어있으면 홈에는 노출하지 않는다(요구사항/UX)
      if (items.length === 0) return null;

      const sortMode = String(slot?.contentSortMode || 'metric') === 'random' ? 'random' : 'metric';
      const score = (x) => {
        if (!x) return 0;
        if (x.type === 'story') return Number(x?.item?.view_count || 0) || 0; // 조회수
        return Number(x?.item?.chat_count || 0) || 0; // 대화수
      };

      let ordered = items;
      if (sortMode === 'random') {
        const seed = _cmsHash32(`${CMS_CUSTOM_SLOT_SESSION_SEED}:${id}`);
        ordered = _cmsShuffleWithSeed(items, seed);
      } else {
        ordered = [...items].sort((a, b) => score(b) - score(a));
      }

      const header = title || '추천 콘텐츠';
      const MAX_ITEMS = 24;
      const slotId = id;
      const capped = ordered.slice(0, MAX_ITEMS);
      const pageSize = isMobile ? MOBILE_SLOT_STEP : capped.length;
      const pageCount = Math.max(1, Math.ceil(capped.length / Math.max(1, pageSize)));
      const page = Number(slotPageById?.[slotId] || 0) || 0;
      const visible = isMobile
        ? capped.slice(page * pageSize, page * pageSize + pageSize)
        : capped;
      const showMobileOverlayArrows = Boolean(isMobile && capped.length > pageSize);

      return (
        <ErrorBoundary>
          <section className="mt-8">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-white">{header}</h2>
              {/* ✅ 내부 CMS 설정값(랜덤/정렬모드)은 사용자에게 노출하지 않는다.
               * 대신 "더보기"로 캐릭터 탭으로 랜딩해 탐색 동선을 제공한다.
               */}
              <Link
                to="/dashboard?tab=character"
                className="text-xs sm:text-sm text-gray-400 hover:text-white transition-colors"
                aria-label="캐릭터 탭 더보기"
              >
                더보기
              </Link>
            </div>
            <div className="relative">
              {/* ✅ 다른 홈 구좌(트렌딩/추천/원작챗/웹소설)와 동일한 그리드 규칙(사이즈 일치) */}
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-5 gap-3 sm:gap-4">
                {visible.map((x, idx) => {
                  const rid = String(x?.item?.id || '').trim();
                  const key = rid ? `${x.type}:${rid}` : `${x.type}:${idx}`;
                  if (x.type === 'story') {
                    // ✅ CMS 커스텀 구좌는 "탐색 카드"가 아니라 홈 구좌(격자) 스타일로 노출해야 한다.
                      return <StoryExploreCard key={key} story={x.item} compact variant="home" showLikeBadge={false} />;
                  }
                  // ✅ CMS 커스텀 구좌: 저장된 스냅샷(item)의 chat_count가 0/누락일 수 있어 최신 값으로 보정한다.
                  const live = rid ? cmsLiveCountsByCharId?.[rid] : null;
                  const merged = live ? { ...(x.item || {}), ...live } : x.item;
                  // ✅ CMS 커스텀 구좌는 "탐색 카드"가 아니라 홈 구좌(격자) 스타일로 노출해야 한다.
                  return (
                    <CharacterCard
                      key={key}
                      character={merged}
                      showOriginBadge
                      variant="home"
                      onCardClick={() => openPcMobileDetail(merged)}
                    />
                  );
                })}
              </div>

              {/* 모바일: 4개씩 <> 페이지 이동 */}
              {showMobileOverlayArrows && (
                <>
                  <button
                    type="button"
                    aria-label="이전"
                    onClick={() => shiftSlotPage(slotId, -1, pageCount)}
                    className="absolute -left-3 top-1/2 -translate-y-1/2 z-30 w-10 h-10 rounded-full bg-gray-800/90 hover:bg-gray-700 text-white border border-gray-700 shadow-lg backdrop-blur flex items-center justify-center"
                  >
                    <ChevronLeft className="w-5 h-5" />
                  </button>
                  <button
                    type="button"
                    aria-label="다음"
                    onClick={() => shiftSlotPage(slotId, 1, pageCount)}
                    className="absolute -right-3 top-1/2 -translate-y-1/2 z-30 w-10 h-10 rounded-full bg-gray-800/90 hover:bg-gray-700 text-white border border-gray-700 shadow-lg backdrop-blur flex items-center justify-center"
                  >
                    <ChevronRight className="w-5 h-5" />
                  </button>
                </>
              )}
            </div>
          </section>
        </ErrorBoundary>
      );
    }

    // 알 수 없는 구좌는 홈에 반영하지 않는다(추후 구좌 타입 확장 시 연결)
    return null;
  };

  return (
    <AppLayout mobileHeaderRight={mobileHeaderRight}>
      <div className="min-h-full bg-gray-900 text-gray-200">
        {/* ✅ PC 홈: 일반 캐릭터챗 카드 클릭 시 모바일 상세 모달 */}
        {pcMobileDetailOpen ? (
          <CharacterMobileDetailModal
            open={pcMobileDetailOpen}
            onOpenChange={(v) => {
              setPcMobileDetailOpen(Boolean(v));
              if (!v) {
                setPcMobileDetailCharacterId('');
                setPcMobileDetailInitialData(null);
              }
            }}
            characterId={pcMobileDetailCharacterId}
            initialData={pcMobileDetailInitialData}
          />
        ) : null}
        {/* ===== 홈 팝업(CMS) ===== */}
        <Dialog
          open={!!homePopupOpen && !!currentHomePopup}
          onOpenChange={(v) => {
            // 사용자가 바깥 클릭/ESC로 닫아도 "이번 세션만" 숨김 처리(재노출 방지)
            if (!v) closeHomePopupAndNext('session');
          }}
        >
          <DialogContent className="bg-gray-950 border border-gray-800 text-gray-100 max-w-[520px]">
            <DialogHeader>
              <DialogTitle className="text-white">
                {String(currentHomePopup?.title || '').trim() || '안내'}
              </DialogTitle>
            </DialogHeader>

            {(() => {
              const p = currentHomePopup || {};
              const img = (isMobile ? (p.mobileImageUrl || p.imageUrl) : (p.imageUrl || p.mobileImageUrl)) || '';
              const url = String(img || '').trim();
              const href = String(p.linkUrl || '').trim();
              const clickable = !!href;
              if (!url) return null;
              return (
                <button
                  type="button"
                  className={`w-full rounded-lg overflow-hidden border border-gray-800 ${clickable ? 'hover:border-gray-700' : ''}`}
                  onClick={() => {
                    if (!clickable) return;
                    const openInNewTab = !!p.openInNewTab || /^https?:\/\//i.test(href);
                    try {
                      if (openInNewTab) window.open(href, '_blank', 'noopener,noreferrer');
                      else navigate(href);
                    } catch (_) {}
                    closeHomePopupAndNext('session');
                  }}
                  disabled={!clickable}
                >
                  <img
                    src={resolveImageUrl(url) || url}
                    alt={String(p.title || 'popup')}
                    className="w-full h-auto object-cover"
                    loading="eager"
                  />
                </button>
              );
            })()}

            {String(currentHomePopup?.message || '').trim() ? (
              <div className="text-sm text-gray-200 whitespace-pre-wrap">
                {String(currentHomePopup?.message || '')}
              </div>
            ) : null}

            <DialogFooter className="flex flex-col sm:flex-row gap-2 sm:justify-end">
              {String(currentHomePopup?.linkUrl || '').trim() ? (
                <Button
                  type="button"
                  className="bg-purple-600 hover:bg-purple-700 text-white"
                  onClick={() => {
                    const href = String(currentHomePopup?.linkUrl || '').trim();
                    if (!href) return;
                    const openInNewTab = !!currentHomePopup?.openInNewTab || /^https?:\/\//i.test(href);
                    try {
                      if (openInNewTab) window.open(href, '_blank', 'noopener,noreferrer');
                      else navigate(href);
                    } catch (_) {}
                    closeHomePopupAndNext('session');
                  }}
                >
                  자세히 보기
                </Button>
              ) : null}
              <Button
                type="button"
                variant="outline"
                className="bg-gray-900 border-gray-800 text-gray-200 hover:bg-gray-800"
                onClick={() => closeHomePopupAndNext('days')}
              >
                {Number(currentHomePopup?.dismissDays ?? 1) > 0
                  ? `${Math.max(1, Number(currentHomePopup?.dismissDays ?? 1))}일간 보지 않기`
                  : '이번 세션 보지 않기'}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="bg-gray-900 border-gray-800 text-gray-200 hover:bg-gray-800"
                onClick={() => closeHomePopupAndNext('session')}
              >
                닫기
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* 메인 컨텐츠 */}
        {/* ✅ 경쟁사 레이아웃 체감: 데스크탑 본문 좌우 여백을 줄여 카드 폭을 키운다 */}
        {/* ✅ 경쟁사처럼 본문 최대폭을 두고(센터 정렬) 좌/우 여백을 만든다 */}
        <main
          ref={homeMainRootRef}
          data-home-main-root="true"
          className="mx-auto w-full max-w-[1220px] px-4 sm:px-5 lg:px-6 py-4 sm:py-6"
        >
          {/* ✅ 요구사항: 홈 상단 '메인/스토리 에이전트' 탭 제거 → 콘텐츠를 위로 당겨 렌더링 */}
          {/* 데스크탑: 공지/관리자 아이콘은 우측에 유지 */}
          <div className="hidden md:flex items-center justify-end gap-2 mb-3">
            {user?.is_admin && (
              <button
                type="button"
                onClick={() => {
                  try { window.open('/cms', '_blank', 'noopener,noreferrer'); } catch (_) { navigate('/cms'); }
                }}
                className={`${headerIconButtonBaseClass} h-9 w-9`}
                aria-label="관리자 페이지"
                title="관리자 페이지"
              >
                <Settings className="w-4 h-4" />
              </button>
            )}
            <button
              type="button"
              onClick={() => navigate('/notices')}
              className={`${headerIconButtonBaseClass} h-9 w-9`}
              aria-label="공지사항"
              title="공지사항"
            >
              <Bell className="w-4 h-4" />
              {showNoticeDot && (
                <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-red-500" aria-hidden="true" />
              )}
            </button>
          </div>

          {/* ✅ 캐러셀 배너(상단 탭 ↔ 필터 탭 사이) */}
          <HomeBannerCarousel className="mb-5 sm:mb-6" />

          {/* ===== 온보딩(메인 탭): 검색 + 30초 생성 ===== */}
          {!isCharacterTab && !isOrigSerialTab && (
            <section className="mb-6">
              <div className="rounded-2xl border border-gray-800/80 bg-gradient-to-b from-gray-900/70 to-gray-900/30 p-5 sm:p-6 shadow-lg shadow-black/20">
                <div className="text-xl sm:text-2xl font-semibold text-white">
                  {homeVariant === 'B'
                    ? '오프닝에 따라 이야기의 결말이 달라집니다.'
                    : '정해진 턴 안에 이야기의 결말에 도달해보세요.'}
                </div>
                <div className="text-sm text-gray-300 mt-1 leading-relaxed">
                  {homeVariant === 'B'
                    ? '선택한 오프닝에 따라 달라지는 결말을 경험해보세요.'
                    : '공략에 성공하면, 최고의 결말이 기다리고 있습니다.'}
                </div>

                <div className="mt-4 grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
                  {/* ✅ 검색 컨트롤(좌): 검색 결과 박스는 '성별 + 검색어' 전체 폭으로 펼친다 */}
                  <div className="lg:col-span-8">
                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                      {/* 성별 */}
                      <div className="sm:col-span-3">
                        <Select value={onboardingGender} onValueChange={setOnboardingGender}>
                          <SelectTrigger className="w-full h-10 sm:h-11 rounded-xl bg-gray-800/60 border-gray-700/80 text-white hover:bg-gray-800/80 focus-visible:ring-purple-500/30 text-[13px] sm:text-sm">
                            <SelectValue placeholder="전체" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">전체</SelectItem>
                            <SelectItem value="male">남성</SelectItem>
                            <SelectItem value="female">여성</SelectItem>
                            <SelectItem value="other">그외</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      {/* 검색어 */}
                      <div className="sm:col-span-9">
                        <Input
                          value={onboardingQueryRaw}
                          onChange={(e) => setOnboardingQueryRaw(e.target.value)}
                          placeholder="이름/키워드로 검색(예: 아이돌, 북부대공)"
                          className="h-10 sm:h-11 rounded-xl bg-gray-800/60 border-gray-700/80 text-white placeholder:text-gray-400 w-full focus-visible:ring-purple-500/30 focus-visible:border-purple-500/40 text-[13px] sm:text-sm"
                        />
                      </div>
                    </div>

                    {/* ✅ 검색 결과: 검색 인풋 바로 아래에서 위→아래로 나열 (좌측 필터 폭 전체) */}
                    {onboardingSearchEnabled && (
                      <div className="mt-2">
                        {onboardingSearchLoading ? (
                          <div className="rounded-xl border border-gray-800 bg-gray-950/20 p-3 space-y-2">
                            {Array.from({ length: 3 }).map((_, i) => (
                              <div key={`sk-onb-${i}`} className="h-12 rounded-lg bg-gray-800/40 border border-gray-800 animate-pulse" />
                            ))}
                          </div>
                        ) : (Array.isArray(onboardingSearchResults) && onboardingSearchResults.length > 0) ? (
                          <div className="rounded-xl border border-gray-800 bg-gray-950/20 overflow-hidden">
                            {/* ✅ 4줄 정도까지만 보여주고, 그 이상은 내부 스크롤 */}
                            <div className="max-h-56 overflow-y-auto">
                              {onboardingSearchResults.slice(0, 8).map((c) => {
                                const id = String(c?.id || '').trim();
                                const nm = String(c?.name || '').trim();
                                    const rawDesc = String(c?.description || '').trim();
                                    const desc = replacePromptTokens(rawDesc, { assistantName: nm || '캐릭터', userName: '당신' }).trim();
                                const thumb = getThumbnailUrl(c?.thumbnail_url || c?.avatar_url || '');
                                return (
                                  <button
                                    key={`onb-${id}`}
                                    type="button"
                                    className="w-full text-left px-3 py-2.5 flex items-center gap-3 border-b border-gray-800/80 last:border-b-0 hover:bg-gray-800/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500/30"
                                    onClick={() => startChatFromOnboarding(c)}
                                  >
                                    <div className="w-10 h-10 rounded-full bg-gray-800/60 border border-gray-700/80 overflow-hidden flex items-center justify-center flex-shrink-0">
                                      {thumb ? (
                                        <img
                                          src={thumb}
                                          alt={nm}
                                          className="w-full h-full object-cover object-top"
                                          loading="lazy"
                                          onError={(e) => { try { e.currentTarget.style.display = 'none'; } catch (_) {} }}
                                        />
                                      ) : null}
                                      <span className={`text-sm text-gray-200 ${thumb ? 'hidden' : ''}`}>{(nm || 'C').charAt(0)}</span>
                                    </div>
                                    <div className="min-w-0 flex-1">
                                      <div className="text-sm font-semibold text-white truncate">{nm || '캐릭터'}</div>
                                      <div className="text-xs text-gray-400 truncate">{desc || '설명이 없습니다.'}</div>
                                    </div>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        ) : (
                          <div className="rounded-xl border border-gray-800 bg-gray-950/20 p-4">
                            <div className="text-sm text-gray-200">검색 결과가 없습니다.</div>
                            <div className="text-xs text-gray-400 mt-1">
                              바로 만들고 시작할 수 있어요.
                            </div>
                            <div className="mt-3 flex justify-end">
                              <Button
                                type="button"
                                className="h-11 rounded-xl bg-purple-600 hover:bg-purple-700 text-white"
                                onClick={() => openQuickMeet(onboardingSearchTerm || onboardingQueryRaw)}
                              >
                                30초 안에 원하는 캐릭터 만나기
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* ✅ 30초 생성 CTA(우): 모바일에서도 결과보다 위에 오도록 '컨트롤 다음'에 배치 */}
                  <div className="lg:col-span-4 self-start">
                    <Button
                      type="button"
                      className="w-full h-20 sm:h-24 rounded-xl bg-purple-600 hover:bg-purple-700 text-white shadow-sm shadow-purple-900/30 flex flex-col items-center justify-center gap-1"
                      onClick={() => openQuickMeet(onboardingSearchTerm || onboardingQueryRaw)}
                    >
                      <span className="text-lg sm:text-2xl font-bold leading-none">간단 캐릭터 생성</span>
                      <span className="text-[11px] sm:text-sm text-purple-100/90 leading-tight">
                        초심자도 쉽고 빠르게 만들어서 채팅할 수 있어요
                      </span>
                    </Button>
                  </div>

                </div>
              </div>
            </section>
          )}

          {quickMeetOpen && (
            <React.Suspense fallback={null}>
              <QuickMeetCharacterModal
                open={quickMeetOpen}
                onClose={() => setQuickMeetOpen(false)}
                initialName={quickMeetInitialName}
                initialSeedText={quickMeetInitialSeedText}
              />
            </React.Suspense>
          )}

          {/* 상단 필터 바 + 검색 */}
          <div className="mb-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap items-center gap-4 border-b border-gray-800/80">
                {/* ✅ 탭 스타일(요구사항): 아이콘 없이 텍스트만 + 선택 탭 언더라인 강조 */}
                <button
                  type="button"
                  onClick={() => updateTab(null, null)}
                  className={[
                    'relative -mb-px px-1 py-2 text-base sm:text-lg font-semibold transition-colors',
                    'border-b-2',
                    sourceFilter === null
                      ? 'text-white border-purple-500'
                      : 'text-gray-400 border-transparent hover:text-gray-200'
                  ].join(' ')}
                  aria-current={sourceFilter === null ? 'page' : undefined}
                >
                  추천
                </button>
                <button
                  type="button"
                  onClick={() => updateTab('ORIGINAL', 'character')}
                  className={[
                    'relative -mb-px px-1 py-2 text-base sm:text-lg font-semibold transition-colors',
                    'border-b-2',
                    sourceFilter === 'ORIGINAL'
                      ? 'text-white border-purple-500'
                      : 'text-gray-400 border-transparent hover:text-gray-200'
                  ].join(' ')}
                  aria-current={sourceFilter === 'ORIGINAL' ? 'page' : undefined}
                >
                  캐릭터
                </button>
                <button
                  type="button"
                  onClick={() => updateTab('ORIGSERIAL', 'origserial')}
                  className={[
                    'relative -mb-px px-1 py-2 text-base sm:text-lg font-semibold transition-colors',
                    isOrigSerialTab
                      ? 'text-white'
                      : 'text-gray-400 hover:text-gray-200'
                  ].join(' ')}
                  aria-current={isOrigSerialTab ? 'page' : undefined}
                >
                  <span className="inline-flex items-center">
                    <span className={[
                      'relative -mb-px border-b-2',
                      isOrigSerialTab
                        ? 'border-purple-500'
                        : 'border-transparent'
                    ].join(' ')}>웹소설</span>
                    <span
                      className={[
                        // ✅ 모바일 최적화:
                        // - 긴 문구는 작은 화면에서 탭 줄바꿈을 유발해 "웹소설 탭이 내려앉는" UX를 만든다.
                        // - 그래서 sm 미만에서는 짧은 배지로 대체한다.
                        'ml-2 relative hidden sm:inline-flex items-center',
                        'whitespace-nowrap',
                        'px-2.5 py-1 rounded-full',
                        'text-[11px] font-semibold leading-none',
                        'border',
                        'cc-float-2',
                        // ✅ 다크 배경 가독성: 따뜻한 톤(프로모션) + 과한 채도 방지
                        isOrigSerialTab
                          ? 'bg-amber-400/15 border-amber-300/40 text-amber-100'
                          : 'bg-amber-400/10 border-amber-300/25 text-amber-200',
                      ].join(' ')}
                    >
                      {/* 말풍선 꼬리(좌측) */}
                      <span
                        aria-hidden="true"
                        className={[
                          'pointer-events-none absolute -left-[6px] top-1/2 -translate-y-1/2',
                          'w-0 h-0',
                          'border-y-[6px] border-y-transparent border-r-[6px]',
                          isOrigSerialTab ? 'border-r-amber-400/15' : 'border-r-amber-400/10',
                        ].join(' ')}
                      />
                      지금 웹소설 작품 등록만 해도 5000원 지급
                    </span>
                    {/* ✅ 모바일(좁은 화면)용 축약 배지: 탭 줄바꿈 방지 */}
                    <span
                      className={[
                        'ml-2 relative inline-flex sm:hidden items-center',
                        'whitespace-nowrap',
                        'px-2 py-1 rounded-full',
                        'text-[11px] font-semibold leading-none',
                        'border',
                        'cc-float-2',
                        isOrigSerialTab
                          ? 'bg-amber-400/15 border-amber-300/40 text-amber-100'
                          : 'bg-amber-400/10 border-amber-300/25 text-amber-200',
                      ].join(' ')}
                    >
                      작품 등록시 5000원
                    </span>
                  </span>
                </button>

                {/* ✅ 검색 UI 비노출(요구사항): 전 탭에서 숨김 */}
                {SEARCH_UI_ENABLED && (
                  <form onSubmit={handleSearch} className="w-full sm:w-auto sm:flex-1 sm:max-w-md">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
                  <Input
                    type="text"
                    placeholder="캐릭터 검색"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full h-8 sm:h-9 pl-9 sm:pl-10 pr-3 sm:pr-4 py-1.5 sm:py-2 bg-gray-800 border-gray-700 text-white placeholder-gray-400 rounded-full focus:ring-2 focus:ring-purple-500 focus:border-purple-500 text-[13px] sm:text-sm"
                  />
                </div>
              </form>
                )}
            </div>

              {/* ✅ 사이드패널 버튼은 그대로 유지 + 탭 우상단에 CTA를 한 번 더 노출(복제) */}
              <div className="flex items-center justify-end gap-2">
                {isCharacterTab && (
                  <Link
                    to="/characters/create"
                    onClick={(e) => {
                      handleCreateCharacterClick(e);
                    }}
                    className="flex w-full sm:w-auto items-center justify-center px-4 py-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-colors font-medium text-sm shadow-lg"
                  >
                    캐릭터 생성
                  </Link>
                )}
              </div>
            </div>
          </div>
  {/* ✅ 탐색 영역 태그 UI는 비노출(요구사항). 태그 힌트 문구도 숨긴다. */}

          {/* 원작연재 탭: 스토리 리스트 또는 캐릭터 격자 */}
          {isOrigSerialTab && (
          <section className="mb-10">
              <div className="flex items-center justify-center mb-4">
                <div className="flex items-center gap-2">
                <button
                    onClick={() => setOrigSerialTab('novel')}
                    className={`px-3 py-1 rounded-full border text-sm ${
                      origSerialTab === 'novel'
                        ? 'bg-white text-black border-white'
                        : 'bg-gray-800 text-gray-200 border-gray-700'
                    }`}
                  >
                    웹소설
                  </button>
                  <button
                    onClick={() => setOrigSerialTab('origchat')}
                    className={`px-3 py-1 rounded-full border text-sm ${
                      origSerialTab === 'origchat'
                        ? 'bg-white text-black border-white'
                        : 'bg-gray-800 text-gray-200 border-gray-700'
                    }`}
                  >
                    원작챗
                  </button>
                </div>
              </div>

              {/* ✅ 원작연재 탭: "원작 쓰기"는 서브탭(원작소설/원작챗) 바로 아래 + 리스트 바로 위에 풀폭으로 노출 */}
              <div className="mb-4">
                <Link
                  to="/works/create"
                  onClick={(e) => {
                    if (!requireAuth('원작 쓰기')) {
                      e.preventDefault();
                    }
                  }}
                  className="flex w-full items-center justify-center px-4 py-2.5 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors font-medium text-sm"
                >
                  원작 쓰기
                </Link>
                    </div>
              
              {/* 원작소설 탭: 스토리 리스트 */}
              {origSerialTab === 'novel' && (
                <>
                  {serialStoriesLoading ? (
                    <div className="bg-gray-800/50 rounded-xl overflow-hidden border border-gray-700/50">
                      {Array.from({ length: 5 }).map((_, i) => (
                        <div key={i} className="flex gap-4 py-5 px-4 border-b border-gray-700/50 animate-pulse">
                          <div className="w-[100px] h-[140px] bg-gray-700 rounded-lg" />
                          <div className="flex-1 space-y-3">
                            <div className="h-5 w-16 bg-gray-700 rounded" />
                            <div className="h-5 w-48 bg-gray-700 rounded" />
                            <div className="h-4 w-24 bg-gray-700 rounded" />
                            <div className="h-4 w-full bg-gray-700 rounded" />
                            <div className="h-4 w-3/4 bg-gray-700 rounded" />
                    </div>
                  </div>
                      ))}
                  </div>
                  ) : novelStories.length > 0 ? (
                    <div className="bg-gray-800/50 rounded-xl overflow-hidden border border-purple-500/30 shadow-lg">
                      {novelStories.map((story) => (
                        <StorySerialCard key={story.id} story={story} />
                      ))}
                      {hasNextSerialPage && (
                        <div className="flex justify-center py-5 bg-gray-800/30">
                          <button
                            type="button"
                            onClick={handleLoadMoreSerialStories}
                            disabled={!hasNextSerialPage || isFetchingNextSerialPage}
                            className="inline-flex items-center gap-2 rounded-full border border-gray-700/70 bg-gray-900/40 px-6 py-2.5 text-sm text-gray-200 shadow-lg transition-colors hover:bg-gray-900/60 hover:border-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
                            aria-label="원작소설 더보기"
                          >
                            <span className="font-medium">더보기</span>
                            {isFetchingNextSerialPage && (
                              <Loader2 className="w-4 h-4 animate-spin text-gray-300" />
                            )}
                          </button>
                </div>
                      )}
                    </div>
                  ) : (
                    <div className="bg-gray-800/50 rounded-xl p-8 text-center text-gray-400 border border-gray-700/50">
                      등록된 원작소설이 없습니다.
                    </div>
                  )}
                </>
              )}

              {/* 원작챗 탭: 캐릭터 격자 */}
              {origSerialTab === 'origchat' && (
                <>
                  {origChatCharactersLoading ? (
                    <div className={gridColumnClasses}>
                      {Array.from({ length: 12 }).map((_, i) => (
                        <CharacterCardSkeleton key={i} variant="home" />
              ))}
            </div>
                  ) : origChatCharacters.length > 0 ? (
                    <>
                      <div className={gridColumnClasses}>
                        {origChatCharacters.map((c) => (
                          <CharacterCard
                            key={c.id}
                            character={c}
                            showOriginBadge
                            variant="home"
                            onCardClick={() => openPcMobileDetail(c)}
                          />
                        ))}
                      </div>
                      {/* ✅ 원작챗 탭: 무한스크롤(센티넬) / IO 미지원 fallback: 더보기 버튼 */}
                      {supportsIntersectionObserver ? (
                        hasNextOrigChatCharacters ? (
                          <div ref={origChatTabSentinelRef} className="mt-6 h-10" aria-hidden="true" />
                        ) : null
                      ) : hasNextOrigChatCharacters ? (
                        <div className="mt-8 flex justify-center">
                          <button
                            type="button"
                            onClick={handleLoadMoreOrigChatCharacters}
                            disabled={!hasNextOrigChatCharacters || isFetchingNextOrigChatCharacters}
                            className="inline-flex items-center gap-2 rounded-full border border-gray-700/70 bg-gray-800/60 px-6 py-2.5 text-sm text-gray-200 shadow-lg transition-colors hover:bg-gray-800 hover:border-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
                            aria-label="원작챗 더보기"
                          >
                            <span className="font-medium">더보기</span>
                            {isFetchingNextOrigChatCharacters && (
                              <Loader2 className="w-4 h-4 animate-spin text-gray-300" />
                            )}
                          </button>
                        </div>
                      ) : null}
                      {isFetchingNextOrigChatCharacters && (
                        <div className={`${gridColumnClasses} mt-3`}>
                          {Array.from({ length: 6 }).map((_, i) => (
                            <CharacterCardSkeleton key={`sk-${i}`} variant="home" />
                          ))}
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="bg-gray-800/50 rounded-xl p-8 text-center text-gray-400 border border-gray-700/50">
                      등록된 원작챗 캐릭터가 없습니다.
                    </div>
                  )}
                </>
              )}
          </section>
          )}

          {!isCharacterTab && !isOrigSerialTab && (
            <>
          {/* CMS 구좌(탐색/최근대화/스토리다이브 제외) */}
          {(splitSlots.pre || []).map((slot) => (
            <React.Fragment key={String(slot?.id || '') || String(slot?.title || '')}>
              {renderHomeSlot(slot)}
            </React.Fragment>
          ))}

          {/* 5) 주인공으로 다시 몰입하는 원작소설 - 스토리다이브 */}
          {(() => {
            // ✅ 구좌 구성:
            // - 스토리다이브 사용 이력이 있으면: 최근 스토리다이브(최근 콘텐츠)
            // - 사용 이력이 없으면: 추천(기준 기반)
            //
            // ✅ 노출 규칙:
            // - 0개면 구좌 비노출
            // - 5개 미만이면 있는 만큼만 노출
            const hasCover = (url) => {
              const s = String(url || '').trim();
              return !!s && s.toLowerCase() !== 'null' && s.toLowerCase() !== 'undefined';
            };

            // 로그인 상태에서는 "실제로 다이브한 것만" 노출:
            // - cover_url 없는 항목(=표지 준비중 placeholder로 보이는 카드)은 아예 제외한다.
            const recentBaseRaw = Array.isArray(recentStoryDive) ? recentStoryDive : [];
            const recentBase = recentBaseRaw.filter((it) => hasCover(it?.cover_url));

            // 비로그인 상태(또는 최근이 없을 때 추천을 쓰는 흐름)도 cover 없는 카드는 제외해 품질을 유지한다.
            const featuredRaw = Array.isArray(storyDiveStories) ? storyDiveStories : [];
            const featuredBase = featuredRaw.filter((it) => hasCover(it?.cover_url));

            // ✅ UX 보강(신규 유저 방어):
            // - 로그인 유저라도 "최근 스토리다이브"가 0개면, 추천(기준 기반)으로 폴백한다.
            // - 단, 최근 로딩 중에는 깜빡임 방지를 위해 먼저 기다린다.
            const useRecent = !!isAuthenticated && recentBase.length > 0;
            const base = useRecent ? recentBase : featuredBase;
            const loading = (() => {
              // 로그인 유저는 "최근 여부 판단"이 끝날 때까지 먼저 기다린다(깜빡임 방지)
              if (isAuthenticated && recentStoryDiveLoading) return true;
              // 최근이 없으면 추천 로딩 상태를 따른다.
              if (isAuthenticated && recentBase.length === 0) return storyDiveStoriesLoading;
              // 비로그인 또는 최근이 있는 경우
              return useRecent ? false : storyDiveStoriesLoading;
            })();

            // 0개면 구좌 비노출 (로딩 중이면 스켈레톤만 노출)
            if (!loading && base.length === 0) return null;

            const placeholderCover = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="200" height="267"%3E%3Crect fill="%23374151" width="200" height="267"/%3E%3Ctext x="50%25" y="50%25" fill="%239ca3af" text-anchor="middle" dominant-baseline="middle" font-size="12"%3E표지 준비중%3C/text%3E%3C/svg%3E';

            return (
              <section className="mt-8">
                <h2 className="text-lg sm:text-xl font-bold text-white mb-4">
                  내가 주인공인 원작소설 - 스토리다이브
            </h2>
            <div className="flex gap-3 sm:gap-4 overflow-x-auto pb-2 scrollbar-hide">
                  {loading ? (
                    Array.from({ length: 5 }).map((_, idx) => (
                      <div key={`sd-sk-${idx}`} className="flex-shrink-0 w-[160px] sm:w-[200px]">
                        <div className="relative aspect-[3/4] rounded-lg overflow-hidden mb-1.5 sm:mb-2 bg-gray-900 border border-gray-700/50">
                          <Skeleton className="w-full h-full bg-gray-800" />
                        </div>
                        <Skeleton className="h-4 sm:h-5 w-32 sm:w-40 bg-gray-800" />
                      </div>
                    ))
                  ) : (
                    base.slice(0, 10).map((s, idx) => {
                      const key = s?.session_id || s?.id || `slot-${idx}`;
                      const coverSrc = getThumbnailUrl(s?.cover_url, 600) || placeholderCover;
                      const intro = String(s?.excerpt || '').trim();
                      const overlayText = intro || '이 작품에서 직접 주인공이 되어보세요.';
                return (
                  <div
                          key={key}
                    className="flex-shrink-0 w-[160px] sm:w-[200px] cursor-pointer group"
                    onClick={() => {
                            if (useRecent) {
                              if (!requireAuth('스토리 다이브')) return;
                              if (!s?.novel_id || !s?.session_id) return;
                              navigate(`/storydive/novels/${s.novel_id}?sessionId=${encodeURIComponent(String(s.session_id))}`);
                        return;
                      }
                            if (!s?.id) return;
                            // 추천 구좌는 1화 뷰어로 바로 진입
                            navigate(`/stories/${s.id}/chapters/1`);
                          }}
                        >
                  <div className="relative aspect-[3/4] rounded-lg overflow-hidden mb-1.5 sm:mb-2 bg-gray-900 border border-gray-700/50 group-hover:border-gray-600 transition-colors">
                    <img 
                              src={coverSrc}
                              alt={s?.title || '작품 표지'}
                      className="w-full h-full object-cover"
                      onError={(e) => {
                                e.target.src = placeholderCover;
                      }}
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent" />
                    <div className="absolute bottom-0 left-0 right-0 p-2 sm:p-3">
                              <p
                                className="text-white text-xs sm:text-sm leading-snug"
                                style={{
                                  textShadow: '0 2px 10px rgba(0,0,0,0.85)',
                                  display: '-webkit-box',
                                  WebkitLineClamp: isMobile ? 2 : 3,
                                  WebkitBoxOrient: 'vertical',
                                  overflow: 'hidden',
                                }}
                                title={overlayText}
                              >
                                {overlayText}
                              </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                            <Badge
                              className="bg-blue-600/80 hover:bg-blue-600 text-white text-[10px] px-1.5 sm:px-2 py-0.5 max-w-full truncate"
                              title={s?.title || ''}
                            >
                              {s?.title || '작품명'}
                    </Badge>
                  </div>
                  </div>
                );
                    })
                  )}
            </div>
          </section>
            );
          })()}

          {(splitSlots.post || []).map((slot) => (
            <React.Fragment key={String(slot?.id || '') || String(slot?.title || '')}>
              {renderHomeSlot(slot)}
            </React.Fragment>
          ))}

          {/* 최근 대화 섹션 - 관심 캐릭터 영역 임시 비노출 */}
          {isAuthenticated && (
            <>
              {/* 관심 캐릭터 섹션 숨김 */}
              {/* <section className="mt-10 hidden" aria-hidden="true"></section> */}

              <section className="mt-10 mb-10" data-home-history-section="true">
                <div className="flex items-center justify-between mb-5">
                  <h2 className="text-xl font-normal text-white">최근 대화</h2>
                  <Link to="/history" className="text-sm text-gray-400 hover:text-white">더보기</Link>
                </div>
                <RecentCharactersList limit={5} />
              </section>
                </>
              )}
            </>
          )}

          {/* 하단 중복 섹션 제거 */}

          {/* Scenes 섹션 (나중에 구현) */}
          {/* <section className="mb-10">
            <h2 className="text-xl font-normal text-white mb-5">Scenes</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
              Scene cards will go here
            </div>
          </section> */}

          {/* 탐색 섹션 (원작연재 탭에서는 숨김) */}
          {!isOrigSerialTab && (
          <section className="mt-8 mb-10">
            {isCharacterTab ? (
            <div className="mb-5">
                {/* ✅ 모바일 최적화: 태그는 한 줄 가로 스크롤(줄바꿈 방지) */}
                <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-hide sm:flex-wrap sm:overflow-visible sm:pb-0">
                  {/* ✅ 기본값: 모두 */}
                  <button
                    type="button"
                    onClick={() => setSelectedTags([])}
                    className={`px-3 py-1 rounded-full border text-xs sm:text-sm flex-shrink-0 whitespace-nowrap ${
                      selectedTags.length === 0
                        ? 'bg-yellow-500 text-black border-yellow-400'
                        : 'bg-gray-800 text-gray-200 border-gray-700 hover:bg-gray-750'
                    }`}
                  >
                    모두
                  </button>
                  {/* ✅ 고정 모드 태그칩: 모두 옆에 노출 */}
                  {CHARACTER_TAB_FIXED_MODE_TAGS.map((it) => {
                    const slug = String(it?.slug || '').trim();
                    const label = String(it?.label || '').trim();
                    if (!slug || !label) return null;
                    // ✅ CMS(운영) 숨김 설정을 존중한다.
                    if (hiddenCharacterTagSlugsSet.has(slug)) return null;
                    const active = selectedTags.includes(slug);
                    return (
                      <button
                        type="button"
                        key={`fixed-mode-tag:${slug}`}
                        onClick={() => setSelectedTags((prev) => (prev.length === 1 && prev[0] === slug ? [] : [slug]))}
                        className={`px-3 py-1 rounded-full border text-xs sm:text-sm flex-shrink-0 whitespace-nowrap ${
                          active
                            ? 'bg-yellow-500 text-black border-yellow-400'
                            : 'bg-gray-800 text-gray-200 border-gray-700 hover:bg-gray-750'
                        }`}
                        title={label}
                      >
                        {label}
                      </button>
                    );
                  })}
                  {visibleCharacterTabTags.map((t) => {
                    const slug = String(t?.slug || '').trim();
                    const name = String(t?.name || t?.slug || '').trim();
                    if (!slug || !name) return null;
                    // ✅ 고정 모드 태그칩은 위에서 별도로 렌더링한다(중복 방지).
                    if (CHARACTER_TAB_FIXED_MODE_SLUG_SET.has(slug)) return null;
                    const active = selectedTags.includes(slug);
                  return (
                    <button
                        type="button"
                        key={t.id || slug}
                        onClick={() => setSelectedTags((prev) => (prev.length === 1 && prev[0] === slug ? [] : [slug]))}
                        className={`px-3 py-1 rounded-full border text-xs sm:text-sm flex-shrink-0 whitespace-nowrap ${
                          active
                            ? 'bg-yellow-500 text-black border-yellow-400'
                            : 'bg-gray-800 text-gray-200 border-gray-700 hover:bg-gray-750'
                        }`}
                        title={name}
                      >
                        {name}
                    </button>
                  );
                })}

                  {sortedTagsForCharacterTab.length > visibleTagLimit && (
                  <button
                      type="button"
                      onClick={() => setShowAllTags((v) => !v)}
                      className={`px-3 py-1 rounded-full border text-xs sm:text-sm flex-shrink-0 whitespace-nowrap font-semibold shadow-sm transition-colors ${
                        showAllTags
                          ? 'bg-purple-700 text-white border-purple-500 hover:bg-purple-800'
                          : 'bg-purple-600 text-white border-purple-500 hover:bg-purple-700'
                      }`}
                      aria-expanded={showAllTags}
                      aria-label={showAllTags ? '태그 접기' : '태그 더보기'}
                  >
                    {showAllTags ? '접기' : '더보기'}
                  </button>
                )}
              </div>
            </div>
            ) : (
              <h2 className="text-xl font-normal text-white mb-3">탐색</h2>
            )}

            {loading ? (
              <div className={gridColumnClasses}>
                {Array.from({ length: 12 }).map((_, i) => (
                  <CharacterCardSkeleton key={i} variant="home" />
                ))}
              </div>
            ) : hasGridItems ? (
              <>
                <ErrorBoundary>
                  <div className={gridColumnClasses}>
                    {visibleGridItems.map((item, idx) => {
                      const kind = String(item?.kind || '').toLowerCase();
                      const isStory = kind === 'story';
                      const id = item?.data?.id;
                      const key = `${isStory ? 'story' : 'char'}-${id || idx}`;

                      // ✅ 메인(혼합) 탐색 그리드에서만 라벨/이동 안내를 강화한다(캐릭터 탭 UI는 과밀 방지)
                      const showLabels = !isCharacterTab && !isOrigSerialTab;
                      if (!showLabels) {
                        return isStory ? (
                          <StoryExploreCard key={key} story={item.data} variant="home" showLikeBadge={false} />
                        ) : (
                          <CharacterCard
                            key={key}
                            character={item.data}
                            showOriginBadge
                            variant="home"
                            onCardClick={() => openPcMobileDetail(item.data)}
                          />
                        );
                      }

                      return (
                        <div key={key} className="relative">
                          {/* NOTE: 캐릭터 카드는 내부에서 이미 원작/기본 배지를 표시하므로, '캐릭터챗' 배지는 중복/겹침 이슈로 제거 */}
                          {isStory ? (
                            <StoryExploreCard story={item.data} variant="home" showLikeBadge={false} />
                          ) : (
                            <CharacterCard
                              character={item.data}
                              showOriginBadge
                              variant="home"
                              onCardClick={() => openPcMobileDetail(item.data)}
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </ErrorBoundary>

                {/* ✅ 캐릭터 탭: 무한스크롤 센티넬(하단 진입 시 다음 묶음 누적 노출) */}
                {isCharacterTab &&
                  (hasNextPage || generalCharacters.length > characterPage * CHARACTER_PAGE_SIZE) && (
                    <div ref={characterTabSentinelRef} className="h-10" aria-hidden="true" />
                  )}

                {/* ✅ IO 미지원(극소수) fallback: 버튼으로 누적 로드 */}
                {isCharacterTab &&
                  !supportsIntersectionObserver &&
                  (hasNextPage || generalCharacters.length > characterPage * CHARACTER_PAGE_SIZE) && (
                    <div className="mt-8 flex justify-center">
                      <button
                        type="button"
                        onClick={() => setCharacterPage((p) => p + 1)}
                        disabled={isFetchingNextPage}
                        className="inline-flex items-center gap-2 rounded-full border border-gray-700/70 bg-gray-800/60 px-6 py-2.5 text-sm text-gray-200 shadow-lg transition-colors hover:bg-gray-800 hover:border-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
                        aria-label="캐릭터 더보기"
                      >
                        <span className="font-medium">더보기</span>
                        {isFetchingNextPage && (
                          <Loader2 className="w-4 h-4 animate-spin text-gray-300" />
                        )}
                      </button>
                    </div>
                  )}
                {/* ✅ 더보기 버튼 (메인탭 탐색영역 전용): 20개씩 단계 노출 */}
                {!isCharacterTab && !isOrigSerialTab && hasGridItems && (
                  (displayGridItems.length > exploreVisibleCount || hasNextPage) ? (
                    <div className="mt-8 flex justify-center">
                      <button
                        type="button"
                        onClick={handleExploreLoadMore}
                        disabled={isFetchingNextPage}
                        className="inline-flex items-center gap-2 rounded-full border border-gray-700/70 bg-gray-800/60 px-6 py-2.5 text-sm text-gray-200 shadow-lg transition-colors hover:bg-gray-800 hover:border-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
                        aria-label="탐색 더보기"
                      >
                        <span className="font-medium">더보기</span>
                {isFetchingNextPage && (
                          <Loader2 className="w-4 h-4 animate-spin text-gray-300" />
                        )}
                      </button>
                    </div>
                  ) : null
                )}
                {isFetchingNextPage && (
                  <div className={`${gridColumnClasses} mt-3`}>
                    {Array.from({ length: 6 }).map((_, i) => (
                      <CharacterCardSkeleton key={`sk-${i}`} variant={isCharacterTab ? 'home' : 'explore'} />
                    ))}
                  </div>
                )}
                {shouldShowPagination && (
                  <div className="mt-10 border-t border-gray-800 pt-6 pb-8">
                    <div className="flex flex-wrap items-center justify-center gap-2">
                      <button
                        type="button"
                        onClick={handlePrevPage}
                        disabled={characterPage === 1}
                        className={`h-9 px-4 rounded-full border text-sm transition-colors ${
                          characterPage === 1
                            ? 'border-gray-700 text-gray-600 cursor-not-allowed'
                            : 'border-gray-700 text-gray-200 hover:bg-gray-800'
                        }`}
                      >
                        이전
                      </button>
                      {paginationPages.map((page) => (
                        <button
                          key={page}
                          type="button"
                          onClick={() => goToPage(page)}
                          className={`h-9 px-3 rounded-full border text-sm transition-colors ${
                            characterPage === page
                              ? 'border-purple-500 bg-purple-600 text-white'
                              : 'border-gray-700 text-gray-200 hover:bg-gray-800'
                          }`}
                        >
                          {page}
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={handleNextPage}
                        disabled={characterPage === totalCharacterPages}
                        className={`h-9 px-4 rounded-full border text-sm transition-colors ${
                          characterPage === totalCharacterPages
                            ? 'border-gray-700 text-gray-600 cursor-not-allowed'
                            : 'border-gray-700 text-gray-200 hover:bg-gray-800'
                        }`}
                      >
                        다음
                      </button>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="text-center py-16">
                <p className="text-gray-400">
                  선택한 태그에는 아직 캐릭터가 없어요.
                </p>
                <div className="mt-6 flex items-center justify-center">
                  <Link
                    to="/characters/create"
                    onClick={(e) => {
                      handleCreateCharacterClick(e);
                    }}
                    className="flex items-center justify-center px-4 py-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-colors font-medium text-sm shadow-lg"
                  >
                    캐릭터 생성
                  </Link>
                </div>
              </div>
            )}
          </section>
          )}

      {/* ✅ 경쟁사 UX: 임시저장 불러오기 모달 (홈에서 표시) */}
      <Dialog open={draftPromptOpen} onOpenChange={setDraftPromptOpen}>
        <DialogContent className="bg-[#111111] border border-purple-500/70 text-white max-w-[340px] rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-center text-white text-base font-semibold">
              임시저장된 설정이 있는데
              <br />
              불러올까요?
            </DialogTitle>
          </DialogHeader>
          <div className="mt-2 space-y-3">
            <button
              type="button"
              onClick={handleDraftStartFresh}
              className="w-full h-11 rounded-md bg-gray-800 text-white font-semibold hover:bg-gray-700 transition-colors border border-gray-700/80"
            >
              새로 만들기
            </button>
            <button
              type="button"
              onClick={handleDraftLoad}
              className="w-full h-11 rounded-md bg-purple-600 text-white font-semibold hover:bg-purple-700 transition-colors"
            >
              불러오기
            </button>
            <button
              type="button"
              onClick={() => setDraftPromptOpen(false)}
              className="w-full h-11 rounded-md bg-gray-900/60 text-white font-semibold hover:bg-gray-900/80 transition-colors border border-gray-800/80"
            >
              취소
            </button>
          </div>
        </DialogContent>
      </Dialog>

      </main>
      </div>
      {/* 로그인 유도 모달 */}
    </AppLayout>
  );
};

export default HomePage;
