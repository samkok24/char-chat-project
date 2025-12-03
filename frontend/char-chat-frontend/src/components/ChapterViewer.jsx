import React from 'react';

/**
 * 회차 뷰어 컴포넌트
 * - 웹툰(이미지): 이미지만 표시 (네이버 웹툰 스타일)
 * - 웹소설(텍스트): 텍스트 표시
 */
const ChapterViewer = ({ chapter }) => {
  if (!chapter) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-gray-400">회차를 불러오는 중...</p>
      </div>
    );
  }

  // image_url이 배열인지 확인하고 처리
  const imageUrls = React.useMemo(() => {
    if (!chapter?.image_url) return [];
    if (Array.isArray(chapter.image_url)) {
      return chapter.image_url.filter(url => url && url.trim());
    }
    // 하위 호환: 단일 문자열인 경우
    return [chapter.image_url].filter(url => url && url.trim());
  }, [chapter?.image_url]);

  const hasImage = imageUrls.length > 0;

  React.useEffect(() => {
    if (chapter) {
      console.log('ChapterViewer - Chapter data:', {
        id: chapter.id,
        no: chapter.no,
        image_url: chapter.image_url,
        imageUrls: imageUrls,
        hasImage: hasImage,
        contentLength: chapter.content?.length
      });
    }
  }, [chapter, imageUrls, hasImage]);

  return (
    <div className="chapter-viewer">
      {hasImage ? (
        // 웹툰 모드: 여러 이미지를 세로로 표시 (웹툰 플랫폼 스타일)
        // 텍스트는 완전히 숨김 (AI용으로만 사용)
        <div className="webtoon-mode w-full min-h-screen bg-white flex flex-col items-center justify-start">
          <div 
            className="flex flex-col items-center"
            style={{
              maxWidth: '940px',
              margin: '0 auto',
              padding: '50px 80px 50px 80px',
              width: '100%'
            }}
          >
            {imageUrls.map((imageUrl, index) => (
              <img
                key={index}
                src={imageUrl}
                alt={`${chapter.no}화 - ${chapter.title || '웹툰'} (${index + 1}/${imageUrls.length})`}
                className="w-full h-auto"
                style={{ 
                  display: 'block', 
                  maxWidth: '100%',
                  marginBottom: index < imageUrls.length - 1 ? '0' : '0' // 컷 간 간격 없음
                }}
                onError={(e) => {
                  console.error('Image load error:', imageUrl);
                  e.target.style.display = 'none';
                }}
                onLoad={() => {
                  console.log('Image loaded successfully:', imageUrl);
                }}
              />
            ))}
          </div>
        </div>
      ) : (
        // 웹소설 모드: 텍스트 표시 (본문만)
        <div className="novel-mode max-w-4xl mx-auto px-4 py-12">
          {/* 텍스트 콘텐츠 */}
          <div className="prose prose-invert max-w-none mt-0">
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

