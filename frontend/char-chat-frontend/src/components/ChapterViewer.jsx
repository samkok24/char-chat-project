import React from 'react';
import { resolveImageUrl } from '../lib/images';

/**
 * 회차 뷰어 컴포넌트
 * - 웹툰(이미지): 이미지만 표시 (네이버 웹툰 스타일)
 * - 웹소설(텍스트): 텍스트 표시
 */
const ChapterViewer = ({ chapter, webtoonOnly = false }) => {
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
  const hasText = String(chapter?.content || '').trim().length > 0;

  React.useEffect(() => {
    if (chapter) {
      console.log('ChapterViewer - Chapter data:', {
        id: chapter.id,
        no: chapter.no,
        image_url: chapter.image_url,
        imageUrls: imageUrls,
        hasImage: hasImage,
        hasText: hasText,
        contentLength: chapter.content?.length
      });
    }
  }, [chapter, imageUrls, hasImage]);

  return (
    <div className="chapter-viewer">
      {/* ✅ 웹소설 UX(요구사항): 텍스트가 있으면 항상 먼저 보여주고, 이미지가 있으면 아래에 이어서 표시한다.
          ✅ 웹툰 전용(webtoonOnly=true)인 경우에는 텍스트가 있어도 이미지 우선으로만 보여준다(기존 정책 유지). */}
      {webtoonOnly || (!hasText && hasImage) ? (
        // 웹툰 모드: 여러 이미지를 세로로 표시 (웹툰 플랫폼 스타일)
        // 텍스트는 숨김(웹툰 작품/이미지 회차에서 본문은 AI용으로만 사용)
        <div className="webtoon-mode w-full min-h-screen bg-white flex flex-col items-center justify-start">
          <div className="w-full max-w-[940px] mx-auto flex flex-col items-center px-0 sm:px-6 md:px-10 lg:px-20 py-4 sm:py-[50px]">
            {imageUrls.map((raw, index) => {
              const src = resolveImageUrl(raw) || raw;
              return (
                <img
                  key={index}
                  src={src}
                  alt={`${chapter.no}화 - ${chapter.title || '웹툰'} (${index + 1}/${imageUrls.length})`}
                  className="w-full h-auto"
                  style={{ display: 'block', maxWidth: '100%', marginBottom: 0 }}
                  onError={(e) => {
                    console.error('Image load error:', src);
                    e.target.style.display = 'none';
                  }}
                />
              );
            })}
          </div>
        </div>
      ) : (
        // 웹소설 모드: 텍스트 먼저 + (있으면) 이미지 하단
        <div className="novel-mode max-w-4xl mx-auto px-4 py-6 sm:py-12">
          <div className="prose prose-invert max-w-none mt-0">
            <div className="text-white text-base sm:text-lg leading-7 sm:leading-relaxed whitespace-pre-wrap break-words">
              {chapter.content}
            </div>
          </div>
          {hasImage && (
            <div className="mt-8 space-y-4">
              {imageUrls.map((raw, index) => {
                const src = resolveImageUrl(raw) || raw;
                if (!src) return null;
                return (
                  <img
                    key={`img-${index}`}
                    src={src}
                    alt={`${chapter.no || ''}화 이미지 ${index + 1}`}
                    className="w-full h-auto rounded-md border border-gray-700 bg-gray-800/40"
                    onError={(e) => {
                      console.error('Image load error:', src);
                      e.target.style.display = 'none';
                    }}
                  />
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ChapterViewer;

