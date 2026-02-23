// AgentPage.jsx 끝에 추가할 컴포넌트

// 에피소드 뷰어 컴포넌트 (에이전트 탭 UI 정합성)
function EpisodeViewer({ storyId, storyTitle }) {
  const [episodes, setEpisodes] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [expandedEpisodes, setExpandedEpisodes] = React.useState(new Set());
  const [viewCounted, setViewCounted] = React.useState(new Set());

  React.useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const response = await storiesAPI.getEpisodes(storyId);
        if (!alive) return;
        
        const eps = response.data || [];
        setEpisodes(eps);
        
        // 1화 자동 펼침 & 조회수
        if (eps[0]) {
          setExpandedEpisodes(new Set([eps[0].id]));
          
          // // 1화 조회수 증가
          // try {
          //   await storiesAPI.incrementEpisodeView(eps[0].id);
          //   setViewCounted(new Set([eps[0].id]));
          // } catch (err) {
          //   console.error('Failed to count 1st episode view:', err);
          // }
        }
        
        setLoading(false);
      } catch (err) {
        console.error('Failed to fetch episodes:', err);
        setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [storyId]);

  const handleExpand = async (episodeId) => {
    // 조회수 증가 (1회만)
    if (!viewCounted.has(episodeId)) {
      try {
        await storiesAPI.incrementEpisodeView(episodeId);
        setViewCounted(prev => new Set(prev).add(episodeId));
      } catch (err) {
        console.error('View count failed:', err);
      }
    }
    
    // 펼침
    setExpandedEpisodes(prev => new Set(prev).add(episodeId));
  };

  if (loading) {
    return (
      <div className="w-full max-w-3xl">
        <div className="mb-4">
          <div className="h-6 bg-gray-800 rounded w-1/3 animate-pulse"></div>
        </div>
        <div className="space-y-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="p-6 bg-gray-900/30 border border-gray-800/50 rounded-lg animate-pulse">
              <div className="h-4 bg-gray-800 rounded w-1/4 mb-3"></div>
              <div className="space-y-2">
                <div className="h-3 bg-gray-800 rounded"></div>
                <div className="h-3 bg-gray-800 rounded w-5/6"></div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!episodes.length) {
    return (
      <div className="w-full max-w-3xl p-6 bg-gray-900/30 border border-gray-800/50 rounded-lg text-center text-gray-400">
        에피소드가 없습니다.
      </div>
    );
  }

  return (
    <div className="w-full max-w-3xl">
      {/* 제목 */}
      <div className="mb-4 flex items-center gap-2">
        <div className="w-1 h-5 bg-gradient-to-b from-purple-500 to-fuchsia-600 rounded-full"></div>
        <h2 className="text-lg font-semibold text-white">{storyTitle}</h2>
      </div>
      
      {/* 에피소드 목록 */}
      <div className="space-y-6">
        {episodes.map((ep, idx) => {
          const isExpanded = expandedEpisodes.has(ep.id);
          const preview = ep.content.slice(0, 500);
          const needsExpand = ep.content.length > 500;
          
          return (
            <div key={ep.id} className="relative">
              {/* 회차 헤더 */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-purple-400">
                    {ep.episode_number}화
                  </span>
                  {ep.title && (
                    <span className="text-sm text-gray-300">{ep.title}</span>
                  )}
                </div>
                <span className="text-xs text-gray-500">
                  조회 {ep.view_count || 0}
                </span>
              </div>
              
              {/* 본문 */}
              <div className="px-4 py-4 bg-gray-900/30 border border-gray-800/50 rounded-lg">
                <div className="text-gray-200 whitespace-pre-wrap leading-relaxed text-[15px]">
                  {isExpanded ? ep.content : preview}
                  {!isExpanded && needsExpand && (
                    <span className="text-gray-500">...</span>
                  )}
                </div>
                
                {/* 펼치기 버튼 */}
                {!isExpanded && needsExpand && (
                  <div className="mt-4 pt-4 border-t border-gray-800/50">
                    <button
                      onClick={() => handleExpand(ep.id)}
                      className="w-full py-2 text-purple-400 hover:text-purple-300 text-sm font-medium transition-colors flex items-center justify-center gap-1"
                    >
                      <span>이어서 읽기</span>
                      <ChevronDown className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>
              
              {/* 구분선 (마지막 화 제외) */}
              {idx < episodes.length - 1 && (
                <div className="mt-6 border-t border-gray-800/30" />
              )}
            </div>
          );
        })}
      </div>
      
      {/* 끝 표시 */}
      <div className="mt-8 text-center text-sm text-gray-500">
        — 마지막 화입니다 —
      </div>
    </div>
  );
}

