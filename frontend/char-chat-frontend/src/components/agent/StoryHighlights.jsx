import React from 'react';
import { Download, X, Share2, Loader2 } from 'lucide-react';

export default function StoryHighlights({ highlights = [], loading = false }) {
  const [currentIndex, setCurrentIndex] = React.useState(0);
  const [showModal, setShowModal] = React.useState(false);
  const [modalIndex, setModalIndex] = React.useState(0);
  const DURATION_MS = 10000; // 10초
  const [progress, setProgress] = React.useState(0); // 0..1
  const [modalProgress, setModalProgress] = React.useState(0); // 0..1
  const timerRef = React.useRef(null);
  const modalTimerRef = React.useRef(null);
  
  if (loading) {
    return (
      <div className="w-full my-4">
        <div className="mb-2 flex items-center gap-2">
          <span className="inline-block w-1.5 h-1.5 bg-purple-400 rounded-full shadow-[0_0_8px_rgba(168,85,247,0.8)]"></span>
          <span className="text-base font-semibold text-gray-100 tracking-tight">하이라이트</span>
        </div>
        <div className="mb-3 flex items-center gap-2 text-sm text-purple-200">
          <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-purple-500/10 ring-2 ring-purple-500/40 shadow-[0_0_12px_rgba(168,85,247,0.6)]">
            <Loader2 className="w-4.5 h-4.5 animate-spin text-purple-300 drop-shadow-[0_0_10px_rgba(168,85,247,0.9)]" />
          </span>
          <span className="tracking-tight">하이라이트 생성 중…</span>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {[1,2,3].map(i => (
            <div key={i} className="aspect-[3/4] rounded-xl bg-gray-800 animate-pulse" />
          ))}
        </div>
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
    try {
      if (navigator.share) {
        await navigator.share({ url });
        return;
      }
    } catch {}
    try {
      await navigator.clipboard.writeText(url);
      window.dispatchEvent(new CustomEvent('toast', { detail: { type: 'success', message: '링크 복사됨' } }));
    } catch {}
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
      {/* 제목 */}
      <div className="mb-2 flex items-center gap-2">
        <span className="inline-block w-1.5 h-1.5 bg-purple-400 rounded-full shadow-[0_0_8px_rgba(168,85,247,0.8)]"></span>
        <span className="text-base font-semibold text-gray-100 tracking-tight">하이라이트</span>
      </div>
      
      {/* 이미지 캐러셀 */}
      <div className="relative">
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
      </div>
      
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

      {/* 로딩 스켈레톤 */}
      {highlights.length === 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="aspect-[3/4] rounded-lg bg-gray-800 animate-pulse" />
          ))}
        </div>
      )}
    </div>
  );
}
