import React, { useState, useRef, useEffect } from 'react';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Sparkles, ChevronDown, Copy as CopyIcon, RotateCcw } from 'lucide-react';

/**
 * DualResponseBubble - auto 모드에서 snap/genre 두 응답을 동시에 표시
 * @param {Object} message - dual_response 타입 메시지
 * @param {Function} onSelect - 선택 콜백 (mode: 'snap' | 'genre')
 * @param {boolean} canSelect - 선택 버튼 노출 여부(최신 결과만 선택하도록 제한할 때 사용)
 */
function DualResponseBubble({ message, onSelect, canSelect = true }) {
  const { responses } = message;
  
  const [snapExpanded, setSnapExpanded] = useState(false);
  const [genreExpanded, setGenreExpanded] = useState(false);
  const [snapNeedsExpand, setSnapNeedsExpand] = useState(false);
  const [genreNeedsExpand, setGenreNeedsExpand] = useState(false);
  
  const snapRef = useRef(null);
  const genreRef = useRef(null);
  
  if (!responses || !responses.snap || !responses.genre) {
    return null;
  }

  const snapData = responses.snap;
  const genreData = responses.genre;
  
  // 둘 다 타이핑 완료되었는지 확인
  const bothComplete = !snapData.streaming && !genreData.streaming;
  
  // 타이핑 완료 후 overflow 체크
  useEffect(() => {
    if (bothComplete) {
      if (snapRef.current) {
        const needsExpand = snapRef.current.scrollHeight > snapRef.current.clientHeight;
        setSnapNeedsExpand(needsExpand);
      }
      if (genreRef.current) {
        const needsExpand = genreRef.current.scrollHeight > genreRef.current.clientHeight;
        setGenreNeedsExpand(needsExpand);
      }
    }
  }, [bothComplete, snapData.content, genreData.content]);

    const ResponseBox = ({ mode, data, expanded, setExpanded, needsExpand, contentRef }) => {
    const isSnap = mode === 'snap';
    const label = isSnap ? 'Assistant A' : 'Assistant B';
    const badgeText = isSnap ? '일상' : '장르';
    const badgeClass = isSnap 
      ? 'bg-blue-500/20 text-blue-200 border-blue-400/30' 
      : 'bg-fuchsia-500/20 text-fuchsia-200 border-fuchsia-400/30';
    const buttonClass = isSnap
      ? 'from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700'
      : 'from-purple-600 to-fuchsia-700 hover:from-purple-700 hover:to-fuchsia-800';
    
    const handleCopy = () => {
      try {
        navigator.clipboard.writeText(data.fullContent || data.content || '');
        window.dispatchEvent(new CustomEvent('toast', { detail: { type: 'success', message: '복사됨' } }));
      } catch (e) {
        console.error('Copy failed:', e);
      }
    };
    
    const handleRerun = () => {
      // TODO: 다시 생성 로직 (필요 시 onSelect 호출하거나 별도 콜백 추가)
      console.log(`Rerun ${mode}`);
    };
    
    return (
      // ✅ 한쪽 박스가 길어져도 다른쪽 박스가 같이 늘어나지 않도록(내용 높이만큼만) self-start
      <div className="flex flex-col self-start">
        {/* 헤더 */}
        <div className="flex items-center gap-2 mb-3">
          <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 bg-gradient-to-br from-purple-600 to-fuchsia-700 text-white/90">
            <Sparkles className="w-5 h-5" />
          </div>
          <span className="font-medium text-gray-200">{label}</span>
          <Badge variant="secondary" className={badgeClass}>
            {badgeText}
          </Badge>
        </div>
        
        {/* 텍스트 박스 */}
        {/* ✅ 박스 높이는 "자기 콘텐츠" 기준. (장르 선택/펼치기 시 일상 박스가 같이 늘어나는 문제 방지) */}
        <div className="relative w-full bg-gray-900/30 border-2 border-gray-700/80 rounded-2xl px-4 py-3 shadow-lg">
          <div 
            ref={contentRef}
            className={`prose prose-sm whitespace-pre-wrap text-gray-100 transition-all duration-300 ${
              expanded ? '' : 'max-h-[400px] overflow-hidden'
            }`}
          >
            {data.content || ''}
            {data.streaming && (
              <span className="inline-block w-2 h-4 bg-purple-400 animate-pulse ml-1" />
            )}
          </div>
          
          {/* 페이드 그라데이션 (펼치기 전, overflow 있을 때만) */}
          {!expanded && needsExpand && bothComplete && (
            <div className="absolute bottom-0 left-0 right-0 h-24 bg-gradient-to-t from-gray-900/90 via-gray-900/60 to-transparent pointer-events-none rounded-b-2xl" />
          )}
          
          {/* 펼치기 버튼 (타이핑 완료 + overflow 있을 때만) */}
          {!expanded && needsExpand && bothComplete && (
            <div className="absolute bottom-2 left-0 right-0 flex justify-center">
              <button
                onClick={() => setExpanded(true)}
                className="flex items-center gap-1 px-3 py-1.5 bg-gray-800/80 hover:bg-gray-700/90 text-gray-300 text-sm rounded-full backdrop-blur-sm border border-gray-700/50 transition-all"
              >
                <span>펼치기</span>
                <ChevronDown className="w-4 h-4" />
              </button>
            </div>
          )}
          
          {/* 툴박스 (복사, 다시생성) - 타이핑 완료 시 표시 */}
          {bothComplete && (
            <div className="absolute right-0 -bottom-px translate-y-full flex items-center gap-1 z-20">
              <div className="flex items-center gap-1 px-2 py-1 bg-gray-900/85 border border-gray-700 shadow-lg rounded">
                <button
                  type="button"
                  className="p-1 hover:bg-gray-800 text-gray-300 hover:text-white rounded transition-colors"
                  title="복사"
                  onClick={handleCopy}
                >
                  <CopyIcon className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  className="p-1 hover:bg-gray-800 text-gray-300 hover:text-white rounded transition-colors"
                  title="다시 생성"
                  onClick={handleRerun}
                >
                  <RotateCcw className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>
        
      </div>
    );
  };

  return (
    <div className="w-full my-4">
      {/* 2열 그리드 레이아웃 */}
      {/* ✅ UX: 한쪽 박스만 길어져도 다른쪽 "선택 버튼"이 멀리 밀리지 않게,
          각 컬럼 안에 (박스 + 버튼)을 함께 묶는다. */}
      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col self-start">
          <ResponseBox 
            mode="snap" 
            data={snapData} 
            expanded={snapExpanded} 
            setExpanded={setSnapExpanded}
            needsExpand={snapNeedsExpand}
            contentRef={snapRef}
          />
          {/* ✅ 선택 버튼: 일상(좌) 박스 바로 아래에 붙도록 */}
          {bothComplete && canSelect && typeof onSelect === 'function' ? (
            <div className="mt-4 flex justify-center">
              <Button
                type="button"
                onClick={() => onSelect('snap')}
                className="w-full sm:w-auto px-6 py-2 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white font-medium rounded-full shadow-lg shadow-purple-500/25 hover:shadow-xl hover:shadow-purple-500/40 transition-all duration-200"
              >
                일상으로 선택
              </Button>
            </div>
          ) : null}
        </div>

        <div className="flex flex-col self-start">
          <ResponseBox 
            mode="genre" 
            data={genreData} 
            expanded={genreExpanded} 
            setExpanded={setGenreExpanded}
            needsExpand={genreNeedsExpand}
            contentRef={genreRef}
          />
          {/* ✅ 선택 버튼: 장르(우) 박스 바로 아래에 붙도록 */}
          {bothComplete && canSelect && typeof onSelect === 'function' ? (
            <div className="mt-4 flex justify-center">
              <Button
                type="button"
                onClick={() => onSelect('genre')}
                className="w-full sm:w-auto px-6 py-2 bg-gradient-to-r from-purple-600 to-fuchsia-700 hover:from-purple-700 hover:to-fuchsia-800 text-white font-medium rounded-full shadow-lg shadow-purple-500/25 hover:shadow-xl hover:shadow-purple-500/40 transition-all duration-200"
              >
                장르로 선택
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default DualResponseBubble;

