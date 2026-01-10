import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge } from './ui/badge';
import { Eye, Heart } from 'lucide-react';
import { resolveImageUrl } from '../lib/images';
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar';
import { useAuth } from '../contexts/AuthContext';

const StoryExploreCard = ({ story, compact = false, onClick, variant = 'explore', showLikeBadge = true }) => {
  const navigate = useNavigate();
  const cover = story?.cover_url ? `${story.cover_url}${story.cover_url.includes('?') ? '&' : '?'}v=${Date.now()}` : '';
  const username = story?.creator_username;
  const { profileVersion } = useAuth();
  const creatorAvatar = story?.creator_avatar_url || '';

  const handleClick = () => {
    if (onClick) {
      try { onClick(story); } catch {}
      return;
    }
    if (story?.id) navigate(`/stories/${story.id}`);
  };

  // ✅ 홈(격자) 카드 스타일: 시스템 구좌(TopStories)와 동일 톤
  if (variant === 'home') {
    const title = String(story?.title || '').trim() || '제목 없음';
    const excerpt = String(story?.excerpt || story?.content || '').trim();
    const coverSrc = cover ? (resolveImageUrl(cover) || cover) : '';
    const likeCount = Number(story?.like_count || 0) || 0;
    // ✅ 탐색 격자에서는 태그칩을 강조하고 싶어, 필요 시 좋아요 뱃지를 끌 수 있게 한다.
    const showLike = Boolean(showLikeBadge) && likeCount > 0;
    // ✅ 태그(격자 카드): 스샷처럼 카드 안에 작은 #칩으로 1줄 노출
    const rawTags = Array.isArray(story?.tags) ? story.tags : [];
    const tags = rawTags
      .map((t) => {
        if (!t) return '';
        if (typeof t === 'string') return t;
        return t?.name || t?.slug || '';
      })
      .map((s) => String(s || '').trim())
      .filter(Boolean)
      .slice(0, 6);
    const showTags = tags.length > 0;
    const creatorId = String(story?.creator_id || '').trim();
    const showCreator = Boolean(username && creatorId);

    return (
      <div
        className="bg-gray-800/50 rounded-lg overflow-hidden border border-gray-700/50 hover:border-gray-600 transition-colors cursor-pointer group"
        onClick={handleClick}
      >
        {/* 이미지 영역 + 오버레이 */}
        <div className="relative aspect-[3/4] overflow-hidden bg-gray-900">
          <div className="absolute top-2 left-2 z-10">
            <Badge className="bg-blue-600 text-white hover:bg-blue-600">
              {story?.is_webtoon ? '웹툰' : '웹소설'}
            </Badge>
          </div>
          {coverSrc ? (
            <img
              src={coverSrc}
              alt={title}
              className="w-full h-full object-cover object-top group-hover:scale-105 transition-transform duration-300"
              loading="lazy"
            />
          ) : (
            <div className="absolute inset-0 bg-gray-900 flex items-center justify-center text-gray-500 text-xs">NO COVER</div>
          )}

          {/* ✅ z-index 보강: 일부 환경에서 이미지 레이어가 오버레이를 덮는 문제 방지 */}
          <div className="absolute inset-x-0 bottom-0 z-20 p-3 pt-10 bg-gradient-to-t from-black/90 via-black/40 to-transparent">
            <div className="flex items-start justify-between gap-2">
              <h4 className={`text-white font-bold leading-tight line-clamp-1 ${compact ? 'text-[13px]' : 'text-sm'}`}>
                {title}
              </h4>
              {showLike ? (
                <span className="inline-flex items-center gap-1 rounded bg-black/60 px-1.5 py-0.5 text-[11px] text-gray-100 shrink-0">
                  <Heart className="w-3 h-3 text-red-400" />
                  {likeCount.toLocaleString()}
                </span>
              ) : null}
            </div>

            {excerpt ? (
              <p className={`mt-1 text-gray-200/80 line-clamp-2 leading-snug ${compact ? 'text-[11px]' : 'text-[12px]'}`}>
                {excerpt}
              </p>
            ) : null}

            {showTags ? (
              <div className="mt-2 flex items-center gap-1 overflow-x-auto pb-0.5 scrollbar-hide">
                {tags.map((t) => (
                  <span
                    key={t}
                    className="inline-flex items-center rounded-full border border-gray-700/70 bg-black/55 px-1.5 py-0.5 text-[10px] text-gray-100/90 whitespace-nowrap flex-shrink-0 max-w-[140px] truncate"
                    title={t}
                  >
                    {t}
                  </span>
                ))}
              </div>
            ) : null}

            {showCreator ? (
              <div
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  navigate(`/users/${creatorId}/creator`);
                }}
                className="mt-2 inline-flex max-w-full items-center gap-1 rounded bg-black/40 px-1.5 py-0.5 text-[11px] text-gray-100/90 hover:text-white truncate"
                aria-label="크리에이터 프로필 보기"
              >
                <span className="truncate">@{username}</span>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`bg-gray-800 rounded-xl overflow-hidden hover:bg-gray-700 transition-all duration-200 cursor-pointer group border border-blue-500/40 ${compact ? 'text-[13px]' : ''}`}
      onClick={handleClick}
    >
      {/* 이미지: 캐릭터 카드와 동일하게 정사각형 + object-top 크롭 */}
      <div className="aspect-square relative overflow-hidden bg-gray-900">
        {cover ? (
          <img
            src={resolveImageUrl(cover) || cover}
            alt={story.title}
            className="w-full h-full object-cover object-top group-hover:scale-105 transition-transform duration-300"
            loading="lazy"
          />
        ) : (
          <div className="absolute inset-0 bg-gray-900 flex items-center justify-center text-gray-500">NO COVER</div>
        )}
        <div className="absolute top-1 left-1">
          <Badge className="bg-blue-600 text-white hover:bg-blue-600">
            {story.is_webtoon ? '웹툰' : '웹소설'}
          </Badge>
        </div>
        {/* 우하단 메트릭: 조회수 + 좋아요수 (이미지 영역) */}
        <div className={`absolute bottom-1 right-1 py-0.5 px-1.5 rounded bg-black/60 ${compact ? 'text-[10px]' : 'text-xs'} text-gray-100 flex items-center gap-2`}>
          <span className="inline-flex items-center gap-1"><Eye className="w-3.5 h-3.5" />{Number(story.view_count || 0).toLocaleString()}</span>
          <span className="inline-flex items-center gap-1"><Heart className="w-3.5 h-3.5" />{Number(story.like_count || 0).toLocaleString()}</span>
        </div>
      </div>
      {/* 텍스트 영역: 캐릭터 카드와 동일 높이 (장르 제거, 소개글 당김) */}
      <div className={`${compact ? 'p-2 h-[88px] pb-7' : 'p-4 h-[120px] pb-8'} relative overflow-hidden`}>
        <h3 className={`font-medium text-white truncate ${compact ? 'text-[13px]' : ''}`}>{story.title}</h3>
        { (story.excerpt || story.content) && (
          <p className={`${compact ? 'text-[11px]' : 'text-sm'} text-gray-400 mt-1 line-clamp-2 pr-1`}>
            {String(story.excerpt || story.content)}
          </p>
        )}
        {username && (
          <span className={`absolute left-1 bottom-1 py-0.5 px-1.5 rounded bg-black/60 ${compact ? 'text-[10px]' : 'text-xs'} text-gray-100 inline-flex items-center gap-2`}>
            <Avatar className={`${compact ? 'w-4 h-4' : 'w-5 h-5'}`}>
              <AvatarImage
                src={resolveImageUrl(creatorAvatar ? `${creatorAvatar}${creatorAvatar.includes('?') ? '&' : '?'}v=${profileVersion}` : '')}
                alt={username}
              />
              <AvatarFallback className={`${compact ? 'text-[9px]' : 'text-[10px]'} bg-gray-700`}>
                {username?.charAt(0)?.toUpperCase() || 'U'}
              </AvatarFallback>
            </Avatar>
            <span className="truncate max-w-[120px]">{username}</span>
          </span>
        )}
      </div>
    </div>
  );
};

export default StoryExploreCard;


