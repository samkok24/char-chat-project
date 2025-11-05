import React from 'react';

/**
 * 회차 뷰어 컴포넌트
 * - 웹툰(이미지): 이미지만 표시 (네이버 웹툰 스타일)
 * - 웹소설(텍스트): 텍스트 표시
 */
const ChapterViewer = ({ chapter }) => {
  const hasImage = !!(chapter?.image_url);

  React.useEffect(() => {
    if (chapter) {
      console.log('ChapterViewer - Chapter data:', {
        id: chapter.id,
        no: chapter.no,
        image_url: chapter.image_url,
        hasImage: hasImage,
        contentLength: chapter.content?.length
      });
    }
  }, [chapter, hasImage]);

  if (!chapter) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-gray-400">회차를 불러오는 중...</p>
      </div>
    );
  }

  return (
    <div className="chapter-viewer">
      {hasImage ? (
        // 웹툰 모드: 이미지만 표시 (웹툰 플랫폼 스타일)
        // 텍스트는 완전히 숨김 (AI용으로만 사용)
        <div className="webtoon-mode w-full min-h-screen bg-white flex flex-col items-center justify-start">
          <div 
            className="flex justify-center"
            style={{
              maxWidth: '940px',
              margin: '0 auto',
              padding: '50px 80px 50px 80px',
              width: '100%'
            }}
          >
            {chapter.image_url ? (
              <img
                src={chapter.image_url}
                alt={`${chapter.no}화 - ${chapter.title || '웹툰'}`}
                className="w-full h-auto"
                style={{ display: 'block', maxWidth: '100%' }}
                onError={(e) => {
                  console.error('Image load error:', chapter.image_url);
                  e.target.style.display = 'none';
                }}
                onLoad={() => {
                  console.log('Image loaded successfully:', chapter.image_url);
                }}
              />
            ) : (
              <div className="text-gray-800 p-4">이미지 URL이 없습니다.</div>
            )}
          </div>
        </div>
      ) : (
        // 웹소설 모드: 텍스트 표시
        <div className="novel-mode max-w-4xl mx-auto px-4 py-12">
          {/* 웹소설 헤더 표시 */}
          <div className="mb-8">
            <h2 className="text-2xl font-bold text-white mb-2">
              {chapter.no}화{chapter.title && ` - ${chapter.title}`}
            </h2>
            <div className="text-gray-400 text-sm">
              조회수 {chapter.view_count || 0}
            </div>
          </div>

          {/* 텍스트 콘텐츠 */}
          <div className="prose prose-invert max-w-none">
            <div className="text-white text-lg leading-relaxed whitespace-pre-wrap">
              {chapter.content}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ChapterViewer;

