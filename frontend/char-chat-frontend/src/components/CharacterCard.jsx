import React from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { LazyLoadImage } from 'react-lazy-load-image-component';
import 'react-lazy-load-image-component/src/effects/blur.css';
import { Skeleton } from './ui/skeleton';
import { getThumbnailUrl } from '../lib/images';
import { resolveImageUrl } from '../lib/images';
import { DEFAULT_SQUARE_URI } from '../lib/placeholder';
import { MessageCircle, Heart } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar';
import { Badge } from './ui/badge';
import { formatCount } from '../lib/format';
import { storiesAPI } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';

export const CharacterCard = ({ character, onCardClick, onButtonClick, footerContent, showOriginBadge = false }) => {
  const navigate = useNavigate();
  const { profileVersion } = useAuth();
  const charId = character?.id || character?.character_id || character?.characterId || character?.target_id;
  const isWebNovel = character?.source_type === 'IMPORTED';
  const isFromOrigChat = !!(character?.origin_story_id || character?.is_origchat || character?.source === 'origchat');
  const borderClass = isFromOrigChat ? 'border-orange-500/60' : (isWebNovel ? 'border-blue-500/40' : 'border-purple-500/40');
  const hoverBorderClass = isFromOrigChat ? 'hover:border-orange-500' : (isWebNovel ? 'hover:border-blue-500' : 'hover:border-purple-500');
  const [originTitle, setOriginTitle] = React.useState(character?.origin_story_title || '');

  const handleCardClick = () => {
    if (onCardClick) {
      onCardClick(charId);
    } else {
      if (charId) navigate(`/characters/${charId}`);
    }
  };

  const handleButtonClick = (e) => {
    e.stopPropagation();
    if (onButtonClick) {
      onButtonClick(charId, character.chat_room_id);
    } else {
      if (!charId) return;
      // ✅ 원작챗 캐릭터는 일반챗이 아니라 origchat plain 모드로 진입해야 한다.
      const sid = String(character?.origin_story_id || '').trim();
      if (isFromOrigChat && sid) {
        navigate(`/ws/chat/${charId}?source=origchat&storyId=${sid}&mode=plain`);
        return;
      }
      navigate(`/ws/chat/${charId}`);
    }
  };

  React.useEffect(() => {
    let active = true;
    const fetchTitleIfNeeded = async () => {
      if (!showOriginBadge) return;
      const sid = character?.origin_story_id;
      if (!sid) return;
      if (character?.origin_story_title) return; // already provided
      try {
        const res = await storiesAPI.getStory(sid);
        if (!active) return;
        const t = res.data?.title;
        if (t) setOriginTitle(t);
      } catch (_) {}
    };
    fetchTitleIfNeeded();
    return () => { active = false; };
  }, [showOriginBadge, character?.origin_story_id, character?.origin_story_title]);

  return (
    <div 
      className={`bg-gray-800 rounded-xl overflow-hidden hover:bg-gray-700 transition-all duration-200 cursor-pointer group border ${borderClass} ${hoverBorderClass}`}
      onClick={handleCardClick}
    >
      {/* 캐릭터 이미지 */}
      <div className="aspect-square relative overflow-hidden bg-gray-900">
        <LazyLoadImage
          alt={character.name}
          src={(() => {
            const base = character?.avatar_url || character?.thumbnail_url || '';
            const joined = base ? `${base}${base.includes('?') ? '&' : '?'}v=${Date.now()}` : '';
            const url = resolveImageUrl(joined) || DEFAULT_SQUARE_URI;
            return url;
          })()}
          effect="blur"
          className="w-full h-full object-cover object-top group-hover:scale-105 transition-transform duration-300"
          wrapperClassName="w-full h-full"
        />
        <div className="absolute top-1 left-1">
          {isFromOrigChat ? (
            <Badge className="bg-orange-400 text-black hover:bg-orange-400">원작챗</Badge>
          ) : character?.source_type === 'IMPORTED' ? (
            <Badge className="bg-blue-600 text-white hover:bg-blue-600">웹소설</Badge>
          ) : (
            <Badge className="bg-purple-600 text-white hover:bg-purple-600">캐릭터</Badge>
          )}
        </div>
        {/* 채팅수/좋아요 바: 이미지 우하단 오버레이 */}
        <div className="absolute bottom-1 right-1 py-0.5 px-1.5 rounded bg-black/60 text-xs text-gray-100 flex items-center gap-2">
          <span className="inline-flex items-center gap-0.5"><MessageCircle className="w-3 h-3" />{formatCount(character.chat_count || 0)}</span>
          <span className="inline-flex items-center gap-0.5"><Heart className="w-3 h-3" />{formatCount(character.like_count || 0)}</span>
        </div>
      </div>
      
      {/* 캐릭터 정보 */}
      <div className={`${showOriginBadge && isFromOrigChat ? 'px-4 pt-0 pb-6' : 'p-4 pb-6'} relative h-[120px] overflow-hidden`}>
        {showOriginBadge && isFromOrigChat && !(character?.origin_story_title || originTitle) && (
          <div className="mb-0.5 h-[18px] w-20 rounded-md bg-gray-700 animate-pulse" />
        )}
        {showOriginBadge && isFromOrigChat && (character?.origin_story_title || originTitle) && (
          <span
            onClick={(e)=>{ e.stopPropagation(); const sid = character?.origin_story_id; if (sid) navigate(`/stories/${sid}`); }}
            className="block mb-0.5 w-full"
            role="link"
            aria-label="원작 웹소설로 이동"
          >
            <Badge title={character?.origin_story_title || originTitle} className="bg-blue-600 text-white hover:bg-blue-500 inline-flex max-w-full truncate text-[10px] px-1.5 py-0.5 rounded-md justify-start text-left leading-[1.05] tracking-tight">
              {character?.origin_story_title || originTitle}
            </Badge>
          </span>
        )}
        <h3 className="font-medium text-white truncate text-[13px] leading-tight">{character.name}</h3>
        {/* 설명 */}
        <p className="text-[12px] text-gray-400 mt-0.5 line-clamp-2 pr-1">
          {character.description || '설명이 없습니다.'}
        </p>
        
        {/* 상태 정보 제거: 이미지 영역으로 이동 */}

        {character.creator_username && character.creator_id && (
          <Link
            to={`/users/${character.creator_id}/creator`}
            onClick={(e) => e.stopPropagation()}
            className="absolute left-2 bottom-2 inline-flex items-center gap-2 text-xs text-gray-100 bg-black/60 px-1.5 py-0.5 rounded hover:text-white cursor-pointer truncate"
          >
            <Avatar className="w-5 h-5">
              <AvatarImage
                src={resolveImageUrl(
                  character.creator_avatar_url
                    ? `${character.creator_avatar_url}${
                        character.creator_avatar_url.includes('?') ? '&' : '?'
                      }v=${profileVersion}`
                    : ''
                )}
                alt={character.creator_username}
              />
              <AvatarFallback className="text-[10px]">
                {character.creator_username?.charAt(0)?.toUpperCase() || 'U'}
              </AvatarFallback>
            </Avatar>
            <span className="truncate max-w-[120px]">{character.creator_username}</span>
          </Link>
        )}
      </div>
    </div>
  );
};

export const CharacterCardSkeleton = () => (
  <div className="bg-gray-800 rounded-xl overflow-hidden border border-gray-700">
    {/* 이미지 스켈레톤 */}
    <Skeleton className="aspect-square bg-gray-700" />
    
    {/* 정보 스켈레톤 */}
    <div className="p-4 space-y-3">
      <Skeleton className="h-5 w-3/4 bg-gray-700" />
      <Skeleton className="h-4 w-1/2 bg-gray-700" />
      <div className="space-y-1">
        <Skeleton className="h-3 w-full bg-gray-700" />
        <Skeleton className="h-3 w-4/5 bg-gray-700" />
      </div>
      <div className="flex gap-3">
        <Skeleton className="h-3 w-12 bg-gray-700" />
        <Skeleton className="h-3 w-12 bg-gray-700" />
      </div>
    </div>
  </div>
); 