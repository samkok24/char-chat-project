import React from 'react';
import { useNavigate } from 'react-router-dom';
import { cn } from '../lib/utils';
import { useAuth } from '../contexts/AuthContext';
import { cmsAPI } from '../lib/api';
import { resolveImageUrl } from '../lib/images';
import {
  HOME_BANNERS_STORAGE_KEY,
  HOME_BANNERS_CHANGED_EVENT,
  getActiveHomeBanners,
  isDefaultHomeBannersConfig,
  setHomeBanners,
} from '../lib/cmsBanners';
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from './ui/carousel';

/**
 * 홈(메인 탭) 캐러셀 배너
 *
 * 목표:
 * - "메인/스토리에이전트" 상단 탭과 "전체/캐릭터/원작연재" 탭 사이에 홍보/가이드용 배너 영역을 제공한다.
 *
 * 구현 포인트(방어적):
 * - Embla API를 받아 자동 슬라이드를 구현하되, hover 시에는 자동 슬라이드를 일시 정지한다.
 * - prefers-reduced-motion 환경에서는 자동 슬라이드를 비활성화해 UX를 해치지 않는다.
 * - 배너 데이터는 CMS(로컬스토리지) 설정을 읽어온다.
 */

const AUTO_SLIDE_MS = 6500;

/**
 * 홈 배너 이미지 캐시 버스터
 *
 * 문제/의도:
 * - 같은 URL로 이미지를 교체(덮어쓰기)하면 브라우저 캐시로 예전 이미지가 보일 수 있다.
 * - CMS에서 저장되는 updatedAt/createdAt을 기준으로 v 파라미터를 붙여 최신 이미지를 강제로 로드한다.
 *
 * 방어적:
 * - data: URL(로컬 업로드 base64)은 그대로 반환한다.
 * - hash(#)가 있는 URL도 보존한다.
 */
const withCacheBust = (url, versionKey) => {
  try {
    const raw = String(url || '').trim();
    if (!raw) return '';
    if (/^data:/i.test(raw)) return raw;

    const verRaw = String(versionKey || '').trim();
    if (!verRaw) return raw;

    let ver = verRaw;
    try {
      const t = new Date(verRaw).getTime();
      if (Number.isFinite(t) && t > 0) ver = String(t);
    } catch (_) {}

    const hashIdx = raw.indexOf('#');
    const base = hashIdx >= 0 ? raw.slice(0, hashIdx) : raw;
    const hash = hashIdx >= 0 ? raw.slice(hashIdx) : '';
    const joined = `${base}${base.includes('?') ? '&' : '?'}v=${encodeURIComponent(ver)}`;
    return `${joined}${hash}`;
  } catch (e) {
    try { console.warn('[HomeBannerCarousel] withCacheBust failed:', e); } catch (_) {}
    return String(url || '');
  }
};

const HomeBannerCarousel = ({ className = '' }) => {
  const { user } = useAuth();
  const isAdmin = !!user?.is_admin;
  const navigate = useNavigate();
  const [isMobile, setIsMobile] = React.useState(() => {
    try {
      return !!window.matchMedia?.('(max-width: 639px)')?.matches;
    } catch (_) {
      return false;
    }
  });
  const deviceKey = isMobile ? 'mobile' : 'pc';
  const [api, setApi] = React.useState(null);
  const [selected, setSelected] = React.useState(0);
  const [snapCount, setSnapCount] = React.useState(0);
  const [isHovering, setIsHovering] = React.useState(false);
  const [banners, setBanners] = React.useState(() => getActiveHomeBanners(Date.now(), deviceKey));

  const refresh = React.useCallback(() => {
    try {
      setBanners(getActiveHomeBanners(Date.now(), deviceKey));
    } catch (e) {
      try { console.error('[HomeBannerCarousel] refresh failed:', e); } catch (_) {}
      setBanners([]);
    }
  }, [deviceKey]);

  // ✅ 모바일 판별(배너: sm 기준) - 노출 대상(all/pc/mobile) 필터링에 사용
  React.useEffect(() => {
    let mql = null;
    const onChange = (e) => {
      try {
        const matches = !!(e?.matches ?? mql?.matches);
        setIsMobile(matches);
      } catch (_) {}
    };
    try {
      mql = window.matchMedia?.('(max-width: 639px)') || null;
      if (mql) {
        try { mql.addEventListener('change', onChange); } catch (_) { try { mql.addListener(onChange); } catch (_) {} }
        try { setIsMobile(!!mql.matches); } catch (_) {}
      }
    } catch (_) {}
    return () => {
      try {
        if (mql) {
          try { mql.removeEventListener('change', onChange); } catch (_) { try { mql.removeListener(onChange); } catch (_) {} }
        }
      } catch (_) {}
    };
  }, []);

  // 디바이스가 바뀌면(리사이즈 등) 배너 필터링을 다시 적용한다.
  React.useEffect(() => {
    refresh();
  }, [refresh]);

  /**
   * ✅ 운영 SSOT: 서버(DB)의 배너 설정을 우선 사용한다.
   *
   * 동작:
   * - 진입 시 서버에서 배너 목록을 가져와 로컬스토리지에 캐시한다.
   * - 이후 렌더링/필터링(활성/기간)은 기존 로컬 유틸(getActiveHomeBanners)을 그대로 사용(최소 수정).
   *
   * 방어적:
   * - 서버 호출 실패 시 기존 로컬값으로 표시(홈이 죽지 않게).
   */
  React.useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const res = await cmsAPI.getHomeBanners();
        if (!active) return;
        const arr = Array.isArray(res?.data) ? res.data : null;
        if (arr) {
          // ✅ 운영 SSOT 우선(중요):
          // - 일반 유저/다른 브라우저는 무조건 서버(DB) 값을 적용해야 "전 유저 반영"이 된다.
          // - 단, 배포 직후 서버가 진짜 기본값(공지 1개 + 빈 이미지)일 때만
          //   관리자(isAdmin)의 로컬 편집본이 사라지는 사고를 방지하기 위해 예외적으로 로컬을 유지한다.
          let skipApply = false;
          try {
            const hasLocal = !!localStorage.getItem(HOME_BANNERS_STORAGE_KEY);
            const looksDefault = isDefaultHomeBannersConfig(arr);
            if (isAdmin && hasLocal && looksDefault) skipApply = true;
          } catch (_) {}
          if (!skipApply) {
            try { setHomeBanners(arr); } catch (_) {}
          }
          refresh();
        }
      } catch (e) {
        try { console.warn('[HomeBannerCarousel] getHomeBanners failed(keep local):', e); } catch (_) {}
      }
    };
    load();
    return () => { active = false; };
  }, [refresh]);

  // CMS 변경(같은 탭 이벤트) + storage(다른 탭) 구독
  React.useEffect(() => {
    const onCustom = () => refresh();
    const onStorage = (e) => {
      try {
        if (!e) return;
        if (e.key === HOME_BANNERS_STORAGE_KEY) refresh();
      } catch (_) {}
    };
    try { window.addEventListener(HOME_BANNERS_CHANGED_EVENT, onCustom); } catch (_) {}
    try { window.addEventListener('storage', onStorage); } catch (_) {}
    return () => {
      try { window.removeEventListener(HOME_BANNERS_CHANGED_EVENT, onCustom); } catch (_) {}
      try { window.removeEventListener('storage', onStorage); } catch (_) {}
    };
  }, [refresh]);

  // Embla 선택 상태를 추적해 인디케이터를 갱신한다.
  React.useEffect(() => {
    if (!api) return;

    const sync = () => {
      try {
        setSelected(api.selectedScrollSnap());
        setSnapCount(api.scrollSnapList().length);
      } catch (_) {}
    };

    sync();
    try { api.on('select', sync); } catch (_) {}
    try { api.on('reInit', sync); } catch (_) {}
    return () => {
      try { api.off('select', sync); } catch (_) {}
      try { api.off('reInit', sync); } catch (_) {}
    };
  }, [api]);

  // 자동 슬라이드(hover 시 정지, reduced-motion 존중)
  React.useEffect(() => {
    if (!api) return;
    if (isHovering) return;
    if (snapCount <= 1) return;

    let reduce = false;
    try {
      reduce = !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    } catch (_) {
      reduce = false;
    }
    if (reduce) return;

    const timer = window.setInterval(() => {
      try {
        api.scrollNext();
      } catch (_) {}
    }, AUTO_SLIDE_MS);

    return () => {
      try { window.clearInterval(timer); } catch (_) {}
    };
  }, [api, isHovering, snapCount]);

  const handleDotClick = (idx) => {
    try { api?.scrollTo(idx); } catch (_) {}
  };

  const renderBanners = Array.isArray(banners) ? banners : [];
  if (!renderBanners.length) {
    return (
      <div className={cn('w-full', className)}>
        <div className="w-full rounded-2xl border border-gray-800 bg-gray-800/40 px-6 py-5 text-gray-300">
          <div className="text-sm">배너 준비중입니다.</div>
          {isAdmin && (
            <div className="text-xs text-gray-500 mt-1">관리자 페이지(/cms)에서 배너를 등록할 수 있습니다.</div>
          )}
        </div>
      </div>
    );
  }

  const isExternalUrl = (url) => /^https?:\/\//i.test(String(url || ''));
  const openLink = (url, openInNewTab) => {
    const href = String(url || '').trim();
    if (!href) return;
    if (openInNewTab) {
      try { window.open(href, '_blank', 'noopener,noreferrer'); } catch (_) {}
      return;
    }
    // 내부 라우트는 전체 새로고침 없이 이동되도록 한다.
    try {
      if (!isExternalUrl(href)) {
        navigate(href.startsWith('/') ? href : `/${href}`);
        return;
      }
    } catch (_) {}
    try { window.location.href = href; } catch (_) {}
  };

  return (
    <div
      className={cn('w-full', className)}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
    >
      <Carousel
        className="w-full"
        opts={{ loop: true, align: 'start' }}
        setApi={setApi}
      >
        <CarouselContent className="-ml-2">
          {renderBanners.map((b, idx) => {
            // ✅ UX/성능: 상단 배너는 "첫 화면"에서 가장 먼저 보이므로 0번만 우선 로드한다.
            // - 나머지는 lazy로 유지해 네트워크 과부하를 막는다.
            const isPriority = idx === 0;
            const img = String(b.imageUrl || '').trim();
            const mobileImg = String(b.mobileImageUrl || '').trim();
            const href = String(b.linkUrl || '').trim();
            const versionKey = b.updatedAt || b.createdAt || '';
            // ✅ /static 상대경로는 환경(dev/prod)에 따라 base가 달라질 수 있으므로 resolveImageUrl로 정규화한다.
            const imgSrc = withCacheBust(resolveImageUrl(img) || img, versionKey);
            const mobileSrc = withCacheBust(resolveImageUrl(mobileImg) || mobileImg, versionKey);
            const openInNewTab = !!b.openInNewTab;
            const clickable = !!href;
            const external = clickable && isExternalUrl(href);

            const content = (
              <div
                className={cn(
                  'relative w-full aspect-[2000/360] overflow-hidden rounded-2xl border border-gray-800 shadow-xl',
                  clickable ? 'cursor-pointer hover:border-gray-700' : ''
                )}
              >
                {/* 기본 배경(이미지 깨져도 UI 유지) */}
                <div className="absolute inset-0 bg-gradient-to-r from-[#2a160c] via-[#15121a] to-[#0b1627]" />
                {/* 이미지(PC/모바일 분리 지원) */}
                {(imgSrc || mobileSrc) ? (
                  <picture>
                    {/* 모바일 우선 (sm 미만) */}
                    {mobileSrc ? (
                      <source media="(max-width: 639px)" srcSet={mobileSrc} />
                    ) : null}
                    <img
                      src={imgSrc || mobileSrc}
                      alt={b.title || '배너'}
                      className="absolute inset-0 w-full h-full object-cover"
                      loading={isPriority ? 'eager' : 'lazy'}
                      fetchPriority={isPriority ? 'high' : 'auto'}
                      onLoad={(e) => {
                        // 방어: 이전 로드 실패로 display:none 이 남아있을 수 있으므로 복구
                        try { e.currentTarget.style.display = ''; } catch (_) {}
                      }}
                      onError={(e) => {
                        // 방어: 이미지 로드 실패 시 배경만 남긴다.
                        try { e.currentTarget.style.display = 'none'; } catch (_) {}
                      }}
                    />
                  </picture>
                ) : (
                  <div className="relative w-full h-full flex items-center px-6">
                    <div className="text-white">
                      <div className="text-lg font-bold">배너 이미지가 없습니다</div>
                      <div className="text-sm text-white/80 mt-1">관리자 페이지(/cms)에서 이미지를 등록해주세요.</div>
                    </div>
                  </div>
                )}

                {/* 클릭 영역 오버레이(호버 시) */}
                {clickable && (
                  <div className="pointer-events-none absolute inset-0 bg-black/0 hover:bg-black/5 transition-colors" />
                )}
              </div>
            );

            // 내부 라우트는 anchor로도 동작하지만, SPA 깜빡임을 줄이기 위해 기본은 Link/프로그램 이동을 쓴다.
            return (
              <CarouselItem key={b.id} className="pl-2">
                {clickable ? (
                  external ? (
                    <a
                      href={href}
                      target={openInNewTab ? '_blank' : undefined}
                      rel={openInNewTab ? 'noreferrer noopener' : undefined}
                      className="block"
                    >
                      {content}
                    </a>
                  ) : (
                    <button
                      type="button"
                      className="block w-full text-left"
                      onClick={() => openLink(href, openInNewTab)}
                      aria-label={b.title ? `${b.title} 배너 열기` : '배너 열기'}
                    >
                      {content}
                    </button>
                  )
                ) : (
                  content
                )}
              </CarouselItem>
            );
          })}
        </CarouselContent>

        {/* 좌/우 버튼: 기본(-left-12/-right-12)을 내부 배치로 오버라이드 */}
        <CarouselPrevious
          variant="outline"
          className="left-3 bg-gray-900/60 border-gray-700 text-gray-100 hover:bg-gray-800/80"
        />
        <CarouselNext
          variant="outline"
          className="right-3 bg-gray-900/60 border-gray-700 text-gray-100 hover:bg-gray-800/80"
        />
      </Carousel>

      {/* 인디케이터 */}
      {snapCount > 1 && (
        <div className="mt-3 flex items-center justify-center gap-2">
          {Array.from({ length: snapCount }).map((_, i) => (
            <button
              key={`banner-dot-${i}`}
              type="button"
              onClick={() => handleDotClick(i)}
              className={cn(
                'h-2 rounded-full transition-all',
                selected === i ? 'w-6 bg-white' : 'w-2 bg-white/35 hover:bg-white/60'
              )}
              aria-label={`${i + 1}번 배너로 이동`}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default HomeBannerCarousel;


