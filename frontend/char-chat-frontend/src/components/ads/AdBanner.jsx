import React, { useEffect, useRef } from 'react';

/**
 * 구글 애드센스 배너 광고 컴포넌트
 * 
 * 사용법:
 * <AdBanner slot="1234567890" format="auto" />
 * <AdBanner slot="1234567890" format="horizontal" /> // 가로형
 * <AdBanner slot="1234567890" format="rectangle" />  // 사각형
 * 
 * @param {string} slot - 애드센스 광고 슬롯 ID (애드센스에서 발급)
 * @param {string} format - 광고 형식: 'auto' | 'horizontal' | 'rectangle' | 'vertical'
 * @param {string} className - 추가 CSS 클래스
 */

// ─── SSOT: 애드센스 설정 (발급받은 후 여기만 수정) ───
export const ADSENSE_CONFIG = {
  // 애드센스 클라이언트 ID (ca-pub-XXXXXXXXXXXXXXXX 형식)
  clientId: import.meta.env.VITE_ADSENSE_CLIENT_ID || 'ca-pub-XXXXXXXXXXXXXXXX',
  
  // 광고 슬롯 ID들 (애드센스에서 광고 단위 생성 후 발급)
  slots: {
    topBanner: import.meta.env.VITE_ADSENSE_SLOT_TOP || '',        // 상단 배너
    inFeed: import.meta.env.VITE_ADSENSE_SLOT_INFEED || '',        // 피드 내 광고
    sidebar: import.meta.env.VITE_ADSENSE_SLOT_SIDEBAR || '',      // 사이드바
    chapterEnd: import.meta.env.VITE_ADSENSE_SLOT_CHAPTER || '',   // 회차 끝
    rectangle: import.meta.env.VITE_ADSENSE_SLOT_RECTANGLE || '',  // 사각형 광고
  },
  
  // 개발 모드에서 광고 표시 여부 (false면 플레이스홀더만 표시)
  showInDev: false,
};

// 광고 포맷별 스타일
const FORMAT_STYLES = {
  auto: { display: 'block' },
  horizontal: { display: 'block', width: '100%', height: '90px' },
  rectangle: { display: 'inline-block', width: '300px', height: '250px' },
  vertical: { display: 'inline-block', width: '160px', height: '600px' },
  responsive: { display: 'block', width: '100%', minHeight: '100px' },
};

const AdBanner = ({ 
  slot, 
  format = 'auto', 
  className = '',
  testMode = false // 테스트 모드 (개발용 플레이스홀더)
}) => {
  const adRef = useRef(null);
  const isProduction = import.meta.env.PROD;
  const shouldShowAd = isProduction || ADSENSE_CONFIG.showInDev;

  useEffect(() => {
    // 광고 슬롯이 없거나 개발모드에서 비활성화된 경우 스킵
    if (!slot || !shouldShowAd) return;

    // 이미 광고가 로드되었으면 스킵
    if (adRef.current?.dataset.adStatus === 'filled') return;

    try {
      // 애드센스 스크립트가 로드되었는지 확인
      if (window.adsbygoogle) {
        (window.adsbygoogle = window.adsbygoogle || []).push({});
      }
    } catch (err) {
      console.error('AdSense error:', err);
    }
  }, [slot, shouldShowAd]);

  // 개발 모드 플레이스홀더
  if (!shouldShowAd || testMode) {
    return (
      <div 
        className={`bg-gray-800/50 border border-dashed border-gray-600 rounded-lg flex items-center justify-center text-gray-500 text-sm ${className}`}
        style={FORMAT_STYLES[format] || FORMAT_STYLES.auto}
      >
        <div className="text-center p-4">
          <p className="font-medium">광고 영역</p>
          <p className="text-xs mt-1">({format})</p>
        </div>
      </div>
    );
  }

  // 슬롯이 없으면 렌더링 안 함
  if (!slot) return null;

  return (
    <div className={`ad-container ${className}`}>
      <ins
        ref={adRef}
        className="adsbygoogle"
        style={FORMAT_STYLES[format] || FORMAT_STYLES.auto}
        data-ad-client={ADSENSE_CONFIG.clientId}
        data-ad-slot={slot}
        data-ad-format={format === 'auto' ? 'auto' : undefined}
        data-full-width-responsive={format === 'auto' || format === 'responsive' ? 'true' : undefined}
      />
    </div>
  );
};

export default AdBanner;

// ─── 편의 컴포넌트들 ───

// 상단 배너 광고
export const TopBannerAd = ({ className }) => (
  <AdBanner 
    slot={ADSENSE_CONFIG.slots.topBanner} 
    format="horizontal" 
    className={`my-4 ${className || ''}`} 
  />
);

// 피드 내 광고 (목록 사이에 삽입)
export const InFeedAd = ({ className }) => (
  <AdBanner 
    slot={ADSENSE_CONFIG.slots.inFeed} 
    format="responsive" 
    className={`my-6 ${className || ''}`} 
  />
);

// 사이드바 광고
export const SidebarAd = ({ className }) => (
  <AdBanner 
    slot={ADSENSE_CONFIG.slots.sidebar} 
    format="rectangle" 
    className={className} 
  />
);

// 회차 끝 광고
export const ChapterEndAd = ({ className }) => (
  <AdBanner 
    slot={ADSENSE_CONFIG.slots.chapterEnd} 
    format="horizontal" 
    className={`my-8 ${className || ''}`} 
  />
);

// 사각형 광고
export const RectangleAd = ({ className }) => (
  <AdBanner 
    slot={ADSENSE_CONFIG.slots.rectangle} 
    format="rectangle" 
    className={className} 
  />
);


