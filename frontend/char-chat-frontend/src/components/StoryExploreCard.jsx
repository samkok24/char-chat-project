import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge } from './ui/badge';

const StoryExploreCard = ({ story, compact = false, onClick }) => {
  const navigate = useNavigate();
  const cover = story?.cover_url || '';
  const username = story?.creator_username;

  return (
    <div
      className={`bg-gray-800 rounded-xl overflow-hidden hover:bg-gray-700 transition-all duration-200 cursor-pointer group border ${story?.is_origchat ? 'border-orange-500/60' : 'border-blue-500/40'} ${compact ? 'text-[13px]' : ''}`}
      onClick={() => { if (onClick) { try { onClick(story); } catch {} } else { navigate(`/stories/${story.id}`); } }}
    >
      {/* 이미지: 캐릭터 카드와 동일하게 정사각형 + object-top 크롭 */}
      <div className="aspect-square relative overflow-hidden bg-gray-900">
        {cover ? (
          <img
            src={cover}
            alt={story.title}
            className="w-full h-full object-cover object-top group-hover:scale-105 transition-transform duration-300"
            loading="lazy"
          />
        ) : (
          <div className="absolute inset-0 bg-gray-900 flex items-center justify-center text-gray-500">NO COVER</div>
        )}
        <div className="absolute top-1 left-1">
          {story?.is_origchat ? (
            <Badge className="bg-orange-400 text-black hover:bg-orange-400">원작챗</Badge>
          ) : (
            <Badge className="bg-blue-600 text-white hover:bg-blue-600">웹소설</Badge>
          )}
        </div>
      </div>
      {/* 텍스트 영역: 캐릭터 카드와 동일 높이 (장르 제거, 소개글 당김) */}
      <div className={`${compact ? 'p-2 h-[88px] pb-7' : 'p-4 h-[120px] pb-8'} relative overflow-hidden`}>
        <h3 className={`font-medium text-white truncate ${compact ? 'text-[13px]' : ''}`}>{story.title}</h3>
        {story.content && (
          <p className={`${compact ? 'text-[11px]' : 'text-sm'} text-gray-400 mt-1 line-clamp-2 pr-1`}>{String(story.content)}</p>
        )}
        {username && (
          <span className={`absolute left-1 bottom-1 py-0.5 px-1.5 rounded bg-black/60 ${compact ? 'text-[10px]' : 'text-xs'} text-gray-100 inline-flex items-center gap-2`}>
            <span className="truncate max-w-[120px]">{username}</span>
          </span>
        )}
      </div>
    </div>
  );
};

export default StoryExploreCard;


