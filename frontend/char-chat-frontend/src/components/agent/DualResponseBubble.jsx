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
      // ✅ 카드/버튼 정렬 안정화:
      // - self-start로 두면 내용/폭에 따라 컬럼 내에서 박스 폭이 미세하게 달라져 버튼이 치우쳐 보일 수 있다.
      // - w-full + max-w로 박스 크기를 통일하고, 부모에서 중앙 정렬한다.
      <div className="flex flex-col w-full max-w-[420px]">
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
        {/* ✅ 박스 크기 정책
            - 기본(접힘): 정사각형 고정(레이아웃 흔들림 방지)
            - 펼치기: 정사각형 제한 해제 + 내용만큼 아래로 확장(스크롤 대신 전체 노출) */}
        <div className={`relative w-full bg-gray-900/30 border-2 border-gray-700/80 rounded-2xl px-4 py-3 shadow-lg ${
          expanded ? '' : 'aspect-square'
        }`}>
          <div 
            ref={contentRef}
            className={`prose prose-sm whitespace-pre-wrap text-gray-100 transition-all duration-300 ${
              // ✅ 접힘/펼침 동작
              // - 접힘: 박스(정사각형) 내부에서 잘라서 표시
              // - 펼침: 박스 높이를 제한하지 않고 아래로 확장(전체 텍스트 노출)
              expanded ? 'h-auto overflow-visible' : 'h-full overflow-hidden'
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
        <div className="flex flex-col items-center">
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
                className="px-6 py-2 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white font-medium rounded-full shadow-lg shadow-purple-500/25 hover:shadow-xl hover:shadow-purple-500/40 transition-all duration-200"
              >
                일상으로 선택
              </Button>
            </div>
          ) : null}
        </div>

        <div className="flex flex-col items-center">
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
                className="px-6 py-2 bg-gradient-to-r from-purple-600 to-fuchsia-700 hover:from-purple-700 hover:to-fuchsia-800 text-white font-medium rounded-full shadow-lg shadow-purple-500/25 hover:shadow-xl hover:shadow-purple-500/40 transition-all duration-200"
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

