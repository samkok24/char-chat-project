/**
 * StorySerialCard.jsx
 * 원작연재 탭용 가로형 스토리 카드 컴포넌트
 * - 좌측: 표지 이미지 (세로형)
 * - 우측: 작품 정보 (제목, 닉네임, 소개글, 통계, 태그, 등장인물, 업로드 시간)
 * - UI 컨벤션: 다크모드 기반, 보라색 액센트
 */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, BookOpen, Heart } from 'lucide-react';
import { resolveImageUrl } from '../lib/images';
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar';

/**
 * 시간을 "X분전", "X시간전", "X일전" 형식으로 변환
 * @param {string} iso - ISO 날짜 문자열
 * @returns {string} 포맷된 시간 문자열
 */
const formatTimeAgo = (iso) => {
  try {
    const d = new Date(iso);
    const diff = Math.floor((Date.now() - d.getTime()) / 1000);
    if (diff < 60) return '방금';
    const m = Math.floor(diff / 60);
    if (m < 60) return `${m}분전`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}시간전`;
    const day = Math.floor(h / 24);
    if (day < 30) return `${day}일전`;
    return d.toLocaleDateString();
  } catch (_) {
    return '';
  }
};

/**
 * 원작연재 스토리 가로형 카드
 * @param {object} story - 스토리 데이터
 * @param {function} onClick - 클릭 핸들러 (옵션)
 */
const StorySerialCard = ({ story, onClick }) => {
  const navigate = useNavigate();
  
  // 표지 이미지 URL 처리
  const coverUrl = story?.cover_url 
    ? resolveImageUrl(story.cover_url)
    : null;
  
  // 닉네임
  const username = story?.creator_username || '익명';
  
  // 소개글 (excerpt 또는 content 앞부분)
  const excerpt = story?.excerpt || story?.content?.slice(0, 200) || '';
  
  // 태그 목록 (배열)
  const tags = Array.isArray(story?.tags) ? story.tags : [];
  
  // 통계
  const viewCount = Number(story?.view_count || 0);
  const episodeCount = Number(story?.episode_count || 0);
  const likeCount = Number(story?.like_count || 0);
  
  // 추출된 캐릭터 목록 (등장인물)
  const extractedCharacters = Array.isArray(story?.extracted_characters) ? story.extracted_characters : [];
  const hasCharacters = extractedCharacters.length > 0;
  const visibleCharacters = extractedCharacters.slice(0, 3); // 최대 3명까지 표시
  const extraCount = extractedCharacters.length - 3; // 추가 캐릭터 수
  
  // 업로드 시간
  const timeBase =
    story?.latest_chapter_created_at ||
    story?.updated_at ||
    story?.created_at;
  const timeAgo = formatTimeAgo(timeBase);

  const handleClick = () => {
    if (onClick) {
      onClick(story);
    } else {
      navigate(`/stories/${story.id}`);
    }
  };
  const latestChapterAt = story?.latest_chapter_created_at
    ? new Date(story.latest_chapter_created_at)
    : null;
  const showNewBadge = latestChapterAt
    ? (Date.now() - latestChapterAt.getTime()) < 24 * 60 * 60 * 1000
    : false;

  /**
   * 원작연재(원작소설) 모바일 최적화
   *
   * 목표:
   * - 요소(표지/통계/태그/등장인물 아바타)가 많은 리스트에서도 모바일에서 레이아웃이 깨지지 않게 한다.
   * - 제목이 길어질 때는 말줄임(ellipsis) 처리.
   * - 원형 아바타(등장인물)는 모바일에서도 생략하지 않는다(요구사항).
   *
   * 전략:
   * - 모바일에서 표지/패딩/폰트를 축소해 가로 여유를 확보한다.
   * - 시간은 모바일에서 "닉네임 줄"에 합쳐 카드 높이를 줄이고, 폭 경쟁을 피한다(요소 누락 없이 위치만 변경).
   */
  return (
    <div 
      className="flex gap-3 sm:gap-4 py-3.5 sm:py-5 px-3 sm:px-4 border-b border-gray-700/50 bg-gray-800/50 hover:bg-gray-700/50 active:bg-gray-700/60 active:scale-[0.99] transition-all duration-200 cursor-pointer group"
      onClick={handleClick}
    >
      {/* 좌측: 표지 이미지 */}
      <div className="flex-shrink-0 relative">
        <div className="w-[80px] h-[112px] sm:w-[100px] sm:h-[140px] rounded-lg overflow-hidden bg-gray-900 shadow-lg border border-gray-700/50 group-hover:border-purple-500/50 transition-colors">
          {coverUrl ? (
            <img
              src={coverUrl}
              alt={story?.title || '표지'}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
              loading="lazy"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-gray-500 text-xs">
              NO COVER
            </div>
          )}
        </div>

        {/* ✅ 최근 회차 업로드 후 24시간 동안만 표시 */}
        {showNewBadge && (
          <div className="absolute -top-1.5 -left-1.5">
            <div className="bg-gradient-to-r from-orange-500 to-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded shadow-md">
              UP
            </div>
          </div>
        )}
      </div>

      {/* 우측: 정보 영역 */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* 제목 */}
        <h3 className="font-bold text-white text-[13px] sm:text-base leading-snug mb-1 group-hover:text-purple-300 transition-colors flex items-center gap-2 min-w-0">
          <span className="min-w-0 flex-1 truncate">
            {story?.title || '제목 없음'}
          </span>
          {/* ✅ 신규 회차 업로드 후 24시간 동안만 표시 */}
          {showNewBadge && (
            <span className="inline-flex items-center justify-center h-5 px-2 rounded bg-gradient-to-r from-orange-500 to-red-500 text-white text-[10px] font-extrabold shadow-md flex-shrink-0">
              N
            </span>
          )}
        </h3>

        {/* 닉네임 + (모바일) 업로드 시간 */}
        <div className="flex items-center justify-between gap-2 mb-1.5 sm:mb-2 min-w-0">
          {/* 닉네임 (클릭 시 크리에이터 페이지로 이동) */}
          <p
            className="text-[11px] sm:text-sm text-gray-400 hover:text-purple-300 hover:underline transition-colors cursor-pointer w-fit max-w-full truncate"
            onClick={(e) => {
              e.stopPropagation();
              if (story?.creator_id) {
                navigate(`/users/${story.creator_id}/creator`);
              }
            }}
            title={username}
          >
            {username}
          </p>

          {/* ✅ 모바일: 시간은 닉네임 줄 우측으로 합쳐 높이/폭 최적화 */}
          {timeAgo && (
            <span
              className="sm:hidden flex-shrink-0 text-[10px] text-gray-500 border border-gray-700/60 bg-gray-900/40 px-2 py-0.5 rounded-full"
              title={timeAgo}
            >
              {timeAgo}
            </span>
          )}
        </div>
        
        {/* 소개글 */}
        <p className="text-[11px] sm:text-sm text-gray-300 line-clamp-1 sm:line-clamp-2 mb-2.5 sm:mb-3 leading-relaxed">
          {excerpt}
        </p>
        
        {/* 통계 */}
        <div className="flex flex-wrap items-center gap-x-2.5 sm:gap-x-3 gap-y-1 text-[11px] sm:text-sm text-gray-400 mb-2.5 sm:mb-3">
          <span className="inline-flex items-center gap-1 whitespace-nowrap">
            <Eye className="w-3 h-3 sm:w-4 sm:h-4" />
            {viewCount.toLocaleString()}명
          </span>
          <span className="inline-flex items-center gap-1 whitespace-nowrap">
            <BookOpen className="w-3 h-3 sm:w-4 sm:h-4" />
            {episodeCount}회차
          </span>
          <span className="inline-flex items-center gap-1 whitespace-nowrap">
            <Heart className="w-3 h-3 sm:w-4 sm:h-4" />
            {likeCount.toLocaleString()}회
          </span>
        </div>
        
        {/* 태그 리스트 */}
        {tags.length > 0 && (
          <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 mb-2.5 sm:mb-3 scrollbar-hide">
            {tags.slice(0, 8).map((tag, idx) => (
              <span
                key={idx}
                className="inline-block px-1.5 sm:px-2 py-0.5 text-[10px] sm:text-[11px] rounded-full bg-purple-500/15 text-purple-200 border border-purple-500/25 hover:bg-purple-500/20 transition-colors flex-shrink-0 whitespace-nowrap"
                onClick={(e) => {
                  e.stopPropagation();
                  // 태그 클릭 시 검색 등 추가 기능 구현 가능
                }}
              >
                #{typeof tag === 'string' ? tag : tag?.name || tag?.slug || ''}
              </span>
            ))}
          </div>
        )}

        {/* 등장인물 (추출된 캐릭터) - 이미지 참고 레이아웃 */}
        {hasCharacters && (
          <div className="flex flex-wrap items-center gap-2 mt-1">
            {/* 캐릭터 아바타 (최대 3개, 파란 원형) */}
            <div className="flex items-center -space-x-1 flex-shrink-0">
              {visibleCharacters.map((char, idx) => {
                const avatarUrl = char?.avatar_url ? resolveImageUrl(char.avatar_url) : null;
                const fallbackText = char?.initial || char?.name?.charAt(0) || '?';
                return (
                  <Avatar
                    key={char.id || idx}
                    className="w-6 h-6 sm:w-7 sm:h-7"

                  >
                    {avatarUrl ? (
                      <AvatarImage
                        src={avatarUrl}
                        alt={char?.name || '캐릭터'}
                        className="object-cover"
                        loading="lazy"
                      />
                    ) : null}
                    <AvatarFallback className="bg-gradient-to-br from-blue-500 to-purple-600 text-white text-[10px] font-bold">
                      {fallbackText}
                    </AvatarFallback>
                  </Avatar>
                );
              })}
              {/* +n 표시 (3명 초과 시) */}
              {extraCount > 0 && (
                <div className="w-6 h-6 sm:w-7 sm:h-7 rounded-full bg-blue-500 flex items-center justify-center text-[10px] text-white font-bold">
                  +{extraCount}
                </div>
              )}
            </div>
            {/* 등장인물 안내 텍스트 */}
            <span className="text-[11px] sm:text-sm text-gray-500 min-w-0">
              총 <span className="text-blue-500 font-medium">{extractedCharacters.length}명</span>
              <span className="hidden sm:inline">의 등장인물과 원작챗 가능</span>
            </span>
          </div>
        )}
      </div>

      {/* 우하단: 업로드 시간 */}
      <div className="flex-shrink-0 self-end">
        {timeAgo && (
          <div className="hidden sm:inline-flex px-3 py-1.5 text-sm text-gray-600 border border-gray-300 rounded bg-white hover:bg-gray-50 transition-colors">
            {timeAgo}
          </div>
        )}
      </div>
    </div>
  );
};

export default StorySerialCard;
