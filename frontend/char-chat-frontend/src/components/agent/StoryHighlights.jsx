import React from 'react';
import { Download, X, Share2, Loader2, Link, Instagram, Twitter, ChevronDown, ChevronUp } from 'lucide-react';

export default function StoryHighlights({ highlights = [], loading = false, username = '게스트' }) {
  const [currentIndex, setCurrentIndex] = React.useState(0);
  const [showModal, setShowModal] = React.useState(false);
  const [modalIndex, setModalIndex] = React.useState(0);
  const [showShareModal, setShowShareModal] = React.useState(false);
  const [shareImageUrl, setShareImageUrl] = React.useState('');
  const [isExpanded, setIsExpanded] = React.useState(false); // 접기/펼치기 상태
  const DURATION_MS = 10000; // 10초
  const [progress, setProgress] = React.useState(0); // 0..1
  const [modalProgress, setModalProgress] = React.useState(0); // 0..1
  const timerRef = React.useRef(null);
  const modalTimerRef = React.useRef(null);
  
  const [loadingElapsed, setLoadingElapsed] = React.useState(0);
  
  // 로딩 중 경과 시간 카운터
  React.useEffect(() => {
    if (!loading) return;
    
    setLoadingElapsed(0);
    const timer = setInterval(() => {
      setLoadingElapsed(prev => prev + 1);
    }, 1000);
    
    return () => clearInterval(timer);
  }, [loading]);
  
  if (loading) {
    return (
      <div className="w-full my-4">
        {/* 제목 + 펼치기 버튼 (로딩 중) */}
        <div 
          className="mb-2 flex items-center gap-2 cursor-pointer group"
          onClick={() => setIsExpanded(!isExpanded)}
        >
          <span className="inline-block w-1.5 h-1.5 bg-purple-400 rounded-full shadow-[0_0_8px_rgba(168,85,247,0.8)]"></span>
          <span className="text-base font-semibold text-gray-100 tracking-tight flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin text-purple-400" />
            텍스트 기반 하이라이트를 생성중입니다...{loadingElapsed}s
          </span>
          <button className="text-gray-400 group-hover:text-purple-400 transition-colors ml-1">
            {isExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
          </button>
        </div>
        
        {/* 스켈레톤 (펼쳤을 때만) */}
        {isExpanded && (
          <div className="grid grid-cols-3 gap-3">
            {[1,2,3].map(i => (
              <div key={i} className="aspect-[3/4] rounded-xl bg-gray-800 animate-pulse" />
            ))}
          </div>
        )}
      </div>
    );
  }
  
  if (!highlights || highlights.length === 0) return null;
  
  const handlePrevious = () => {
    setCurrentIndex((prev) => (prev > 0 ? prev - 1 : highlights.length - 1));
  };
  
  const handleNext = () => {
    setCurrentIndex((prev) => (prev < highlights.length - 1 ? prev + 1 : 0));
  };

  const openModalAt = (idx) => {
    setModalIndex(idx);
    setShowModal(true);
  };

  const modalPrev = () => {
    setModalIndex((p) => (p > 0 ? p - 1 : highlights.length - 1));
  };
  const modalNext = () => {
    setModalIndex((p) => (p < highlights.length - 1 ? p + 1 : 0));
  };

  const downloadImage = async (url, filename = 'highlight.jpg') => {
    try {
      const res = await fetch(url, { mode: 'cors' });
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      URL.revokeObjectURL(a.href);
      a.remove();
    } catch {
      try { window.open(url, '_blank', 'noopener'); } catch {}
    }
  };

  const shareImage = async (url) => {
    setShareImageUrl(url);
    setShowShareModal(true);
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareImageUrl);
      window.dispatchEvent(new CustomEvent('toast', { detail: { type: 'success', message: '링크 복사됨' } }));
      setShowShareModal(false);
    } catch {}
  };

  const shareToInstagram = () => {
    window.open(`https://www.instagram.com/`, '_blank', 'noopener');
    setShowShareModal(false);
  };

  const shareToTikTok = () => {
    window.open(`https://www.tiktok.com/`, '_blank', 'noopener');
    setShowShareModal(false);
  };

  const shareToTwitter = () => {
    const text = encodeURIComponent('AI가 만든 하이라이트 🎬');
    window.open(`https://twitter.com/intent/tweet?text=${text}&url=${encodeURIComponent(shareImageUrl)}`, '_blank', 'noopener');
    setShowShareModal(false);
  };

  const shareToThreads = () => {
    window.open(`https://www.threads.net/`, '_blank', 'noopener');
    setShowShareModal(false);
  };

  // 메인 뷰 진행 게이지 및 자동 넘어가기
  React.useEffect(() => {
    // 모달 열려 있으면 메인 타이머 일시정지
    if (showModal || !highlights.length) return;
    setProgress(0);
    const start = Date.now();
    if (timerRef.current) try { clearInterval(timerRef.current); } catch {}
    timerRef.current = setInterval(() => {
      const p = Math.min(1, (Date.now() - start) / DURATION_MS);
      setProgress(p);
      if (p >= 1) {
        try { clearInterval(timerRef.current); } catch {}
        timerRef.current = null;
        setCurrentIndex((prev) => (prev < highlights.length - 1 ? prev + 1 : 0));
      }
    }, 100);
    return () => { if (timerRef.current) { try { clearInterval(timerRef.current); } catch {} timerRef.current = null; } };
  }, [currentIndex, highlights.length, showModal]);

  // 모달 뷰 진행 게이지 및 자동 넘어가기
  React.useEffect(() => {
    if (!showModal || !highlights.length) return;
    setModalProgress(0);
    const start = Date.now();
    if (modalTimerRef.current) try { clearInterval(modalTimerRef.current); } catch {}
    modalTimerRef.current = setInterval(() => {
      const p = Math.min(1, (Date.now() - start) / DURATION_MS);
      setModalProgress(p);
      if (p >= 1) {
        try { clearInterval(modalTimerRef.current); } catch {}
        modalTimerRef.current = null;
        setModalIndex((pidx) => (pidx < highlights.length - 1 ? pidx + 1 : 0));
      }
    }, 100);
    return () => { if (modalTimerRef.current) { try { clearInterval(modalTimerRef.current); } catch {} modalTimerRef.current = null; } };
  }, [showModal, modalIndex, highlights.length]);

  const fillFor = (i) => (i < currentIndex ? 100 : i === currentIndex ? Math.round(progress * 100) : 0);
  const modalFillFor = (i) => (i < modalIndex ? 100 : i === modalIndex ? Math.round(modalProgress * 100) : 0);

  // 클릭 영역: 좌측 1/3 이전, 우측 2/3 다음
  const handleMainClick = (e) => {
    try {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      if (x < rect.width / 3) handlePrevious(); else handleNext();
    } catch { handleNext(); }
  };
  const handleModalClick = (e) => {
    try {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      if (x < rect.width / 3) modalPrev(); else modalNext();
    } catch { modalNext(); }
  };
  
  // 모바일 스와이프 처리
  const [touchStart, setTouchStart] = React.useState(0);
  const [touchEnd, setTouchEnd] = React.useState(0);
  
  const handleTouchStart = (e) => {
    setTouchStart(e.targetTouches[0].clientX);
  };
  
  const handleTouchMove = (e) => {
    setTouchEnd(e.targetTouches[0].clientX);
  };
  
  const handleTouchEnd = () => {
    if (!touchStart || !touchEnd) return;
    
    const distance = touchStart - touchEnd;
    const isLeftSwipe = distance > 50;
    const isRightSwipe = distance < -50;
    
    if (isLeftSwipe) {
      handleNext();
    }
    if (isRightSwipe) {
      handlePrevious();
    }
  };
  
  return (
    <div className="w-full my-4">
      {/* 제목 + 펼치기 버튼 */}
      <div 
        className="mb-2 flex items-center gap-2 cursor-pointer group"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <span className="inline-block w-1.5 h-1.5 bg-purple-400 rounded-full shadow-[0_0_8px_rgba(168,85,247,0.8)]"></span>
        <span className="text-base font-semibold text-gray-100 tracking-tight flex items-center gap-2">
          {loading && <Loader2 className="w-4 h-4 animate-spin text-purple-400" />}
          {loading ? (
            <>텍스트 기반 하이라이트를 생성중입니다...{loadingElapsed}s</>
          ) : (
            <>다른 사람들에게 <span className="text-purple-300">{username}</span>님만의 스토리를 공유할 수 있어요.</>
          )}
        </span>
        <button className={`transition-colors ml-1 ${loading ? 'text-gray-500 cursor-default' : 'text-gray-400 group-hover:text-purple-400'}`}>
          {isExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
        </button>
      </div>
      
      {/* 이미지 캐러셀 (펼쳤을 때만 표시) */}
      {isExpanded && (
      <div className="relative">
        {loading ? (
          // 로딩 중 스켈레톤
          <div className="grid grid-cols-3 gap-3">
            {[1,2,3].map(i => (
              <div key={i} className="aspect-[3/4] rounded-xl bg-gray-800 animate-pulse" />
            ))}
          </div>
        ) : (
          <>
        {/* 데스크톱: 스토리 뷰어 */}
        <div className="hidden md:flex justify-start relative">
          <div 
            className="relative aspect-[3/4] w-[300px] rounded-xl overflow-hidden bg-gray-900 cursor-pointer shadow-xl ring-1 ring-black/40 transition-transform duration-300"
            onClick={handleMainClick}
          >
            {/* 진행 게이지 */}
            <div className="absolute top-2 left-2 right-2 flex gap-1 z-10">
              {highlights.map((_, i) => (
                <div key={i} className="h-1.5 flex-1 rounded-full bg-white/25 overflow-hidden">
                  <div className="h-full bg-white" style={{ width: `${fillFor(i)}%` }}></div>
                </div>
              ))}
            </div>
            <img
              src={highlights[currentIndex].imageUrl}
              alt={highlights[currentIndex].subtitle || ''}
              className="w-full h-full object-cover"
            />
            {/* 텍스트는 서버 합성(레터박스)로 이미지 내부에 렌더됨. 프론트 오버레이 생략 */}
            {/* 확대 / 다운로드 / 공유 */}
            <div className="absolute top-3 right-3 flex items-center gap-2">
              <button
                type="button"
                title="확대"
                onMouseDown={(e) => e.stopPropagation()}
                onTouchStart={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); openModalAt(currentIndex); }}
                className="w-10 h-10 rounded-full bg-black/60 text-white/90 flex items-center justify-center hover:bg-black/80 transition-colors"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M15 3h6v6" />
                  <path d="M10 14L21 3" />
                  <path d="M9 21H3v-6" />
                  <path d="M3 21l8-8" />
                </svg>
              </button>
              <button
                type="button"
                title="다운로드"
                onMouseDown={(e) => e.stopPropagation()}
                onTouchStart={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); downloadImage(highlights[currentIndex].imageUrl, `highlight_${currentIndex+1}.jpg`); }}
                className="w-10 h-10 rounded-full bg-black/60 text-white/90 flex items-center justify-center hover:bg-black/80 transition-colors"
              >
                <Download size={18} />
              </button>
              <button
                type="button"
                title="공유"
                onMouseDown={(e) => e.stopPropagation()}
                onTouchStart={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); shareImage(highlights[currentIndex].imageUrl); }}
                className="w-10 h-10 rounded-full bg-black/60 text-white/90 flex items-center justify-center hover:bg-black/80 transition-colors"
              >
                <Share2 size={18} />
              </button>
            </div>
          </div>
        </div>
        
        {/* 모바일: 캐러셀 뷰 */}
        <div 
          className="md:hidden relative"
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          <div className="relative aspect-[3/4] rounded-xl overflow-hidden bg-gray-900 cursor-pointer" onClick={handleMainClick}>
            {/* 진행 게이지 */}
            <div className="absolute top-2 left-2 right-2 flex gap-1 z-10">
              {highlights.map((_, i) => (
                <div key={i} className="h-1.5 flex-1 rounded-full bg-white/25 overflow-hidden">
                  <div className="h-full bg-white" style={{ width: `${fillFor(i)}%` }}></div>
                </div>
              ))}
            </div>
            <img
              src={highlights[currentIndex].imageUrl}
              alt={`장면 ${currentIndex + 1}: ${highlights[currentIndex].subtitle}`}
              className="w-full h-full object-cover"
            />
            
            {/* 스테이지 라벨 제거 */}
            
            {/* 텍스트는 서버 합성(레터박스)로 이미지 내부에 렌더됨. 프론트 오버레이 생략 */}

            {/* 확대 버튼 */}
            <div className="absolute top-3 right-3 flex items-center gap-2">
              <button
                type="button"
                title="확대"
                onMouseDown={(e) => e.stopPropagation()}
                onTouchStart={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); openModalAt(currentIndex); }}
                className="w-10 h-10 rounded-full bg-black/60 text-white/90 flex items-center justify-center hover:bg-black/80 transition-colors"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M15 3h6v6" />
                  <path d="M10 14L21 3" />
                  <path d="M9 21H3v-6" />
                  <path d="M3 21l8-8" />
                </svg>
              </button>
              <button
                type="button"
                title="다운로드"
                onMouseDown={(e) => e.stopPropagation()}
                onTouchStart={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); downloadImage(highlights[currentIndex].imageUrl, `highlight_${currentIndex+1}.jpg`); }}
                className="w-10 h-10 rounded-full bg-black/60 text-white/90 flex items-center justify-center hover:bg-black/80 transition-colors"
              >
                <Download size={18} />
              </button>
              <button
                type="button"
                title="공유"
                onMouseDown={(e) => e.stopPropagation()}
                onTouchStart={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); shareImage(highlights[currentIndex].imageUrl); }}
                className="w-10 h-10 rounded-full bg-black/60 text-white/90 flex items-center justify-center hover:bg-black/80 transition-colors"
              >
                <Share2 size={18} />
              </button>
            </div>
          </div>
        </div>
        
        {/* 인디케이터 도트 (모바일) */}
        {highlights.length > 1 && (
          <div className="md:hidden flex justify-center gap-1.5 mt-3">
            {highlights.map((_, idx) => (
              <button
                key={idx}
                onClick={() => setCurrentIndex(idx)}
                className={`w-2 h-2 rounded-full transition-all duration-200 ${
                  currentIndex === idx 
                    ? 'w-6 bg-purple-500' 
                    : 'bg-gray-600 hover:bg-gray-500'
                }`}
                aria-label={`장면 ${idx + 1}`}
              />
            ))}
          </div>
        )}
        </>
        )}
      </div>
      )}
      
      {/* 모달 뷰어 */}
      {showModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center" onClick={() => setShowModal(false)}>
          <div className="relative w-[70vw] max-w-[560px]" onClick={(e) => e.stopPropagation()}>
            {/* 헤더: 게이지 + 닫기/다운로드 */}
            <div className="absolute top-3 left-3 right-3 flex items-center gap-2 z-10">
              <div className="flex-1 flex gap-1">
                {highlights.map((_, i) => (
                  <div key={i} className="h-1.5 flex-1 rounded-full bg-white/25 overflow-hidden">
                    <div className="h-full bg-white" style={{ width: `${modalFillFor(i)}%` }}></div>
                  </div>
                ))}
              </div>
              <button
                title="다운로드"
                onClick={() => downloadImage(highlights[modalIndex].imageUrl, `highlight_${modalIndex+1}.jpg`)}
                className="w-10 h-10 rounded-full bg-white/15 text-white flex items-center justify-center hover:bg-white/25"
              >
                <Download size={18} />
              </button>
              <button
                title="공유"
                onClick={() => shareImage(highlights[modalIndex].imageUrl)}
                className="w-10 h-10 rounded-full bg-white/15 text-white flex items-center justify-center hover:bg-white/25"
              >
                <Share2 size={18} />
              </button>
              <button
                title="닫기"
                onClick={() => setShowModal(false)}
                className="w-10 h-10 rounded-full bg-white/15 text-white flex items-center justify-center hover:bg-white/25"
              >
                <X size={18} />
              </button>
            </div>
            <div className="relative aspect-[3/4] rounded-xl overflow-hidden cursor-pointer shadow-2xl ring-1 ring-black/40" onClick={handleModalClick}>
              <img
                src={highlights[modalIndex].imageUrl}
                alt={highlights[modalIndex].subtitle || ''}
                className="w-full h-full object-cover"
              />
              {/* 텍스트는 서버 합성(레터박스)로 이미지 내부에 렌더됨. 프론트 오버레이 생략 */}
            </div>
          </div>
        </div>
      )}


      {/* 공유 모달 */}
      {showShareModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={() => setShowShareModal(false)}>
          <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 w-full max-w-md mx-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-semibold text-white">공유하기</h3>
              <button onClick={() => setShowShareModal(false)} className="text-gray-400 hover:text-white">
                <X size={20} />
              </button>
            </div>
            <div className="space-y-3">
              <button
                onClick={copyLink}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-gray-800 hover:bg-gray-750 border border-gray-700 text-white transition-colors"
              >
                <Link size={20} className="text-purple-400" />
                <span>링크 복사</span>
              </button>
              <button
                onClick={shareToInstagram}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white transition-all"
              >
                <Instagram size={20} />
                <span>Instagram에 공유</span>
              </button>
              <button
                onClick={shareToTikTok}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-gray-800 hover:bg-gray-750 border border-gray-700 text-white transition-colors"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor"><path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-5.2 1.74 2.89 2.89 0 012.31-4.64 2.93 2.93 0 01.88.13V9.4a6.84 6.84 0 00-1-.05A6.33 6.33 0 005 20.1a6.34 6.34 0 0010.86-4.43v-7a8.16 8.16 0 004.77 1.52v-3.4a4.85 4.85 0 01-1-.1z"/></svg>
                <span>TikTok에 공유</span>
              </button>
              <button
                onClick={shareToTwitter}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-gray-800 hover:bg-gray-750 border border-gray-700 text-white transition-colors"
              >
                <Twitter size={20} className="text-blue-400" />
                <span>Twitter에 공유</span>
              </button>
              <button
                onClick={shareToThreads}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-gray-800 hover:bg-gray-750 border border-gray-700 text-white transition-colors"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-13h2v6h-2zm0 8h2v2h-2z"/></svg>
                <span>Threads에 공유</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
