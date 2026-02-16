import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { api, charactersAPI, mediaAPI, chatAPI } from '../lib/api';
import { resolveImageUrl, getThumbnailUrl } from '../lib/images';
import { DEFAULT_SQUARE_URI } from '../lib/placeholder';
import { useAuth } from '../contexts/AuthContext';
import { useLoginModal } from '../contexts/LoginModalContext';
import CharacterInfoHeader from './CharacterInfoHeader';
import CharacterDetails from './CharacterDetails';
import ErrorBoundary from './ErrorBoundary';
import StoryExploreCard from './StoryExploreCard';

const dispatchToast = (type, message) => {
  try {
    window.dispatchEvent(new CustomEvent('toast', { detail: { type, message } }));
  } catch (_) {}
};

export default function CharacterMobileDetailModal({
  open,
  onOpenChange,
  characterId,
  initialData = null,
}) {
  const navigate = useNavigate();
  const { user, isAuthenticated } = useAuth();
  const { openLoginModal } = useLoginModal();
  const queryClient = useQueryClient();

  const cid = String(characterId || '').trim();

  const { data: character, isLoading, isError } = useQuery({
    queryKey: ['pc-mobile-detail', 'character', cid],
    queryFn: async () => {
      const res = await charactersAPI.getCharacter(cid);
      return res.data || null;
    },
    enabled: open && !!cid,
    staleTime: 30_000,
    placeholderData: initialData || undefined,
  });

  const isOrigChatCharacter = !!character?.origin_story_id;
  const originStoryId = String(character?.origin_story_id || '').trim();
  const isWebNovelCharacter = character?.source_type === 'IMPORTED';
  /**
   * 모달 이미지 상단 "턴수 배지" 텍스트 계산
   *
   * 의도/원리:
   * - SSOT: start_sets.sim_options.max_turns(또는 legacy/camelCase 변형)를 사용한다.
   * - 값이 없으면 일반 캐릭터챗만 '∞'로 표시(레거시 데이터 방어).
   * - 원작챗/웹소설은 턴수 개념이 보장되지 않으므로, 값이 있을 때만 표시한다.
   */
  const turnBadgeText = (() => {
    try {
      const ss = character?.start_sets;
      const sim = (ss && typeof ss === 'object')
        ? (ss?.sim_options || ss?.simOptions || null)
        : null;
      const raw =
        character?.max_turns
        ?? sim?.max_turns
        ?? sim?.maxTurns
        ?? ss?.sim_options?.max_turns
        ?? ss?.sim_options?.maxTurns
        ?? ss?.simOptions?.max_turns
        ?? ss?.simOptions?.maxTurns;
      const n = Number(raw);
      const turns = Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
      if (turns != null) return `${turns}턴`;
      if (!isOrigChatCharacter && !isWebNovelCharacter) return '∞';
      return null;
    } catch (_) {
      return (!isOrigChatCharacter && !isWebNovelCharacter) ? '∞' : null;
    }
  })();
  // ✅ 오프닝 선택(모바일 상세 모달)
  const [selectedOpeningId, setSelectedOpeningId] = React.useState('');

  const { data: recentRooms = [] } = useQuery({
    queryKey: ['pc-mobile-detail', 'recent-rooms', cid, user?.id || 'anon'],
    queryFn: async () => {
      /**
       * ✅ 모달 CTA 분기(계속 대화/새로 대화)
       *
       * 요구사항:
       * - 해당 캐릭터의 "대화 이력(룸)"이 있으면 CTA를 2개로 분기한다.
       *
       * 정책/방어:
       * - 백엔드에 character_id 필터가 없으므로, 최근 룸 목록을 받아서 프론트에서 필터링한다.
       * - 너무 큰 limit은 피하되(성능), 모달 진입 UX를 위해 충분히 넉넉한 범위로 가져온다.
       */
      try {
        const res = await chatAPI.getChatRooms({ limit: 200 });
        return Array.isArray(res?.data) ? res.data : [];
      } catch (e) {
        console.error('[pc-mobile-detail] recent rooms load failed:', e);
        return [];
      }
    },
    enabled: open && !!cid && !!isAuthenticated,
    staleTime: 30_000,
  });

  const lastRoomIdForThisCharacter = React.useMemo(() => {
    try {
      const rooms = Array.isArray(recentRooms) ? recentRooms : [];
      const matched = rooms.filter((r) => String(r?.character?.id || r?.character_id || '').trim() === cid);
      if (!matched.length) return '';
      // 최신 룸 1개 선택(last_message_time > updated_at > created_at)
      matched.sort((a, b) => {
        const ta = Date.parse(a?.last_message_time || a?.updated_at || a?.created_at || '') || 0;
        const tb = Date.parse(b?.last_message_time || b?.updated_at || b?.created_at || '') || 0;
        return tb - ta;
      });
      return String(matched[0]?.id || '').trim();
    } catch (_) {
      return '';
    }
  }, [recentRooms, cid]);

  const { data: tags = [] } = useQuery({
    queryKey: ['pc-mobile-detail', 'character-tags', cid],
    queryFn: async () => {
      const res = await charactersAPI.getCharacterTags(cid);
      return Array.isArray(res?.data) ? res.data : [];
    },
    enabled: open && !!cid,
    staleTime: 60_000,
  });

  // ✅ 모바일 상세페이지의 "이미지 갤러리" 흐름을 그대로 따른다.
  const [galleryImages, setGalleryImages] = React.useState([]);
  const [activeImageIndex, setActiveImageIndex] = React.useState(0);
  const touchStartXRef = React.useRef(null);

  const { data: mediaAssets = [] } = useQuery({
    queryKey: ['pc-mobile-detail', 'media-assets', cid],
    queryFn: async () => {
      try {
        const res = await mediaAPI.listAssets({ entityType: 'character', entityId: cid, presign: false, expiresIn: 300 });
        return Array.isArray(res.data?.items) ? res.data.items : (Array.isArray(res.data) ? res.data : []);
      } catch (e) {
        console.error('[pc-mobile-detail] media assets load failed:', e);
        return [];
      }
    },
    enabled: open && !!cid,
    staleTime: 60_000,
  });

  React.useEffect(() => {
    if (!open || !cid) return;
    try {
      const mainImageUrl = String(character?.avatar_url || '').trim();
      const galleryFromDesc = Array.isArray(character?.image_descriptions)
        ? character.image_descriptions.map((img) => String(img?.url || '').trim()).filter(Boolean)
        : [];
      const allImages = [mainImageUrl, ...galleryFromDesc].filter(Boolean);
      const uniqueImages = Array.from(new Set(allImages));
      const fromAssets = Array.isArray(mediaAssets) ? mediaAssets.map((a) => String(a?.url || '').trim()).filter(Boolean) : [];
      const finalImages = fromAssets.length > 0 ? fromAssets : uniqueImages;
      const normalized = finalImages.length > 0 ? finalImages : [mainImageUrl || DEFAULT_SQUARE_URI];
      setGalleryImages(normalized);
      setActiveImageIndex(0);
    } catch (e) {
      console.error('[pc-mobile-detail] build gallery failed:', e);
      setGalleryImages([DEFAULT_SQUARE_URI]);
      setActiveImageIndex(0);
    }
  }, [open, cid, character, mediaAssets]);

  const displayImages = React.useMemo(() => {
    /**
     * ✅ 갤러리 이미지 목록(방어적)
     *
     * 요구사항:
     * - 썸네일(미니 갤러리)은 비노출
     * - 대신 <> 버튼으로 이전/다음
     * - 모바일은 스와이프(슬라이드) 지원
     */
    const list = Array.isArray(galleryImages) ? galleryImages.filter(Boolean) : [];
    return list.length > 0 ? list : [DEFAULT_SQUARE_URI];
  }, [galleryImages]);

  const safeActiveIndex = (() => {
    const n = displayImages.length;
    if (n <= 0) return 0;
    const i = Number(activeImageIndex) || 0;
    return Math.max(0, Math.min(n - 1, i));
  })();

  const canGoPrev = safeActiveIndex > 0;
  const canGoNext = safeActiveIndex < displayImages.length - 1;

  const goPrev = React.useCallback(() => {
    setActiveImageIndex((prev) => Math.max(0, (Number(prev) || 0) - 1));
  }, []);
  const goNext = React.useCallback(() => {
    setActiveImageIndex((prev) => Math.min(displayImages.length - 1, (Number(prev) || 0) + 1));
  }, [displayImages.length]);

  const handleTouchStart = React.useCallback((e) => {
    try {
      const x = e?.touches?.[0]?.clientX;
      if (typeof x === 'number') touchStartXRef.current = x;
    } catch (_) {
      touchStartXRef.current = null;
    }
  }, []);

  const handleTouchEnd = React.useCallback((e) => {
    try {
      const startX = touchStartXRef.current;
      touchStartXRef.current = null;
      const endX = e?.changedTouches?.[0]?.clientX;
      if (typeof startX !== 'number' || typeof endX !== 'number') return;
      const dx = endX - startX;
      const TH = 40; // ✅ 스와이프 임계값(방어적)
      if (dx > TH && canGoPrev) goPrev();
      if (dx < -TH && canGoNext) goNext();
    } catch (_) {
      touchStartXRef.current = null;
    }
  }, [canGoPrev, canGoNext, goPrev, goNext]);

  const [likeCount, setLikeCount] = React.useState(0);
  React.useEffect(() => {
    try {
      setLikeCount(Number(character?.like_count ?? 0) || 0);
    } catch (_) {
      setLikeCount(0);
    }
  }, [cid, character?.like_count]);

  const [isLiked, setIsLiked] = React.useState(false);
  React.useEffect(() => {
    // 캐릭터가 바뀌면 로컬 상태 초기화
    setIsLiked(false);
  }, [cid]);

  const { data: likeStatus } = useQuery({
    queryKey: ['pc-mobile-detail', 'like-status', cid],
    queryFn: async () => {
      const res = await charactersAPI.getLikeStatus(cid);
      return !!res?.data?.is_liked;
    },
    enabled: open && !!cid && !!isAuthenticated,
    staleTime: 10_000,
  });
  React.useEffect(() => {
    /**
     * ✅ TanStack Query(v5) 호환: query 옵션(onSuccess 등) 의존 제거
     *
     * - 쿼리 결과(데이터) 변화에 반응하여 로컬 상태를 동기화한다.
     * - 모달이 닫혀있을 때는 enabled=false이므로 likeStatus는 undefined로 유지된다.
     */
    if (!open) return;
    if (typeof likeStatus !== 'boolean') return;
    try {
      setIsLiked(likeStatus);
    } catch (_) {}
  }, [open, likeStatus]);

  const startChat = () => {
    if (!cid) return;
    const opening = String(selectedOpeningId || '').trim();
    // ✅ 원작챗은 origchat plain 모드로 진입(기존 ChatInteraction 정책과 동일)
    if (originStoryId) {
      navigate(`/ws/chat/${cid}?source=origchat&storyId=${encodeURIComponent(originStoryId)}&mode=plain`);
    } else {
      try {
        const usp = new URLSearchParams();
        usp.set('new', '1');
        if (opening) usp.set('opening', opening);
        navigate(`/ws/chat/${cid}?${usp.toString()}`);
      } catch (_) {
        navigate(`/ws/chat/${cid}`);
      }
    }
    try {
      onOpenChange(false);
    } catch (_) {}
  };

  const continueChat = () => {
    /**
     * ✅ 계속 대화(대화 이력 있을 때)
     *
     * - room 파라미터로 특정 룸을 그대로 이어한다.
     * - 원작챗은 source/storyId/mode를 같이 붙인다(ChatPage가 room 검증/정규화).
     */
    const rid = String(lastRoomIdForThisCharacter || '').trim();
    if (!rid) {
      startChat();
      return;
    }
    if (originStoryId) {
      const usp = new URLSearchParams();
      usp.set('room', rid);
      usp.set('source', 'origchat');
      usp.set('storyId', originStoryId);
      usp.set('mode', 'plain');
      navigate(`/ws/chat/${cid}?${usp.toString()}`);
    } else {
      const usp = new URLSearchParams();
      usp.set('room', rid);
      navigate(`/ws/chat/${cid}?${usp.toString()}`);
    }
    try { onOpenChange(false); } catch (_) {}
  };

  const startNewChat = () => {
    /**
     * ✅ 새로 대화(대화 이력 있을 때)
     *
     * - 기존 startChat과 동일하지만, 버튼 라벨/분기를 위해 별도 함수로 둔다.
     */
    startChat();
  };

  React.useEffect(() => {
    // ✅ 오프닝 선택 초기값/정합성 유지(방어적)
    try {
      const ss = character?.start_sets;
      const items = Array.isArray(ss?.items) ? ss.items : [];
      const validIds = items.map((x) => String(x?.id || '').trim()).filter(Boolean);
      if (validIds.length === 0) {
        if (selectedOpeningId) setSelectedOpeningId('');
        return;
      }
      const preferred = String(selectedOpeningId || '').trim();
      if (preferred && validIds.includes(preferred)) return;
      const sid = String(ss?.selectedId || ss?.selected_id || '').trim();
      const next = (sid && validIds.includes(sid)) ? sid : validIds[0];
      setSelectedOpeningId(next);
    } catch (_) {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [character?.id, character?.start_sets]);

  const goFullPage = () => {
    if (!cid) return;
    navigate(`/characters/${cid}`);
    try {
      onOpenChange(false);
    } catch (_) {}
  };

  const likeMutation = useMutation({
    mutationFn: async (liked) => {
      if (liked) return await charactersAPI.unlikeCharacter(cid);
      return await charactersAPI.likeCharacter(cid);
    },
    onSuccess: () => {
      try {
        setIsLiked((prev) => !prev);
        setLikeCount((prev) => (isLiked ? Math.max(0, prev - 1) : prev + 1));
      } catch (_) {}
      try {
        queryClient.invalidateQueries({ queryKey: ['characters'] });
      } catch (_) {}
    },
    onError: (err) => {
      console.error('[pc-mobile-detail] like failed:', err);
      dispatchToast('error', '좋아요 처리에 실패했습니다.');
    },
  });

  const handleLike = () => {
    if (!isAuthenticated) {
      openLoginModal();
      return;
    }
    likeMutation.mutate(isLiked);
  };

  // 댓글(모바일 상세페이지와 동일하게) 로드/작성/삭제
  const [commentText, setCommentText] = React.useState('');
  const [submittingComment, setSubmittingComment] = React.useState(false);
  const { data: comments = [], refetch: refetchComments } = useQuery({
    queryKey: ['pc-mobile-detail', 'comments', cid],
    queryFn: async () => {
      try {
        const res = await charactersAPI.getComments(cid);
        return Array.isArray(res?.data) ? res.data : [];
      } catch (e) {
        console.error('[pc-mobile-detail] comments load failed:', e);
        return [];
      }
    },
    enabled: open && !!cid,
    staleTime: 30_000,
  });

  const handleCommentSubmit = async (e) => {
    e?.preventDefault?.();
    if (!isAuthenticated || !user) {
      openLoginModal();
      return;
    }
    const text = String(commentText || '').trim();
    if (!text) return;

    setSubmittingComment(true);
    try {
      await charactersAPI.createComment(cid, { content: text });
      setCommentText('');
      await refetchComments();
    } catch (err) {
      console.error('[pc-mobile-detail] comment submit failed:', err);
      dispatchToast('error', '댓글 작성에 실패했습니다.');
    } finally {
      setSubmittingComment(false);
    }
  };

  const handleDeleteComment = async (commentId) => {
    if (!commentId) return;
    if (!window.confirm('정말로 이 댓글을 삭제하시겠습니까?')) return;
    try {
      await charactersAPI.deleteComment(commentId);
      await refetchComments();
    } catch (err) {
      console.error('[pc-mobile-detail] comment delete failed:', err);
      dispatchToast('error', '댓글 삭제에 실패했습니다.');
    }
  };

  React.useEffect(() => {
    /**
     * ✅ PC 상세 "모바일 프리뷰 모달" 안정화(Defensive)
     *
     * 배경:
     * - 일부 환경에서 Radix Dialog + composeRefs(setRef) 경로가 ref null↔node를 반복 호출하며
     *   "Maximum update depth exceeded" 크래시가 발생했다.
     * - 본 모달은 데모/배포 안정성이 최우선이므로, Radix Dialog 대신 단순 오버레이+다이얼로그를 사용한다.
     *
     * 동작:
     * - open 동안 body 스크롤 잠금
     * - ESC 키로 닫기
     */
    if (!open) return;
    const onKeyDown = (e) => {
      try {
        if (e?.key === 'Escape') onOpenChange(false);
      } catch (_) {}
    };
    let prevOverflow = '';
    try {
      prevOverflow = document?.body?.style?.overflow || '';
      if (document?.body?.style) document.body.style.overflow = 'hidden';
    } catch (_) {}
    try { document.addEventListener('keydown', onKeyDown); } catch (_) {}
    return () => {
      try { document.removeEventListener('keydown', onKeyDown); } catch (_) {}
      try { if (document?.body?.style) document.body.style.overflow = prevOverflow; } catch (_) {}
    };
  }, [open, onOpenChange]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[51]">
      {/* 오버레이 */}
      <div
        className="absolute inset-0 bg-black/50"
        aria-hidden="true"
        onMouseDown={() => {
          try { onOpenChange(false); } catch (_) {}
        }}
      />

      {/* 다이얼로그 */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="pc-mobile-detail-title"
        aria-describedby="pc-mobile-detail-desc"
        className={[
          /**
           * ✅ 경쟁사(참고 소스) 사이즈/구조 맞춤
           *
           * - 루트는: max-w-lg + gap-4 + py-5
           * - 스크롤 영역만: h-[80dvh]
           */
          'fixed left-1/2 top-1/2 grid w-full max-w-[420px] sm:max-w-[420px] -translate-x-1/2 -translate-y-1/2',
          'gap-4 rounded-md bg-gray-950 py-5 shadow-lg px-0',
        ].join(' ')}
        onMouseDown={(e) => {
          // ✅ 컨텐츠 클릭은 닫힘 방지
          try { e?.stopPropagation?.(); } catch (_) {}
        }}
      >
        {/* 접근성: 제목/설명(화면에는 숨김) */}
        <h2 id="pc-mobile-detail-title" className="sr-only">프로필 상세</h2>
        <p id="pc-mobile-detail-desc" className="sr-only">캐릭터 프로필 상세 정보를 확인합니다.</p>

        <ErrorBoundary
          fallback={
            <div className="mt-3">
              <Button
                type="button"
                variant="secondary"
                className="bg-gray-800 hover:bg-gray-700"
                onClick={() => onOpenChange(false)}
              >
                모달 닫기
              </Button>
            </div>
          }
        >
          {/* 헤더 */}
          <div className="relative flex flex-row justify-center px-5">
            <button
              type="button"
              onClick={goFullPage}
              className="absolute left-3 top-0 px-2 py-1 text-xs text-gray-300 hover:text-white"
            >
              자세히보기
            </button>
            <div className="text-sm font-semibold text-white">프로필 상세</div>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="absolute right-3 top-0 text-gray-300 hover:text-white"
              aria-label="닫기"
              title="닫기"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* 본문(스크롤) */}
          {/* ✅ 푸터 고정바(대화하기) 영역만큼 아래 패딩 확보 */}
          <div className="overflow-hidden relative h-[80dvh] p-0 pb-24">
            <div className="h-full overflow-y-auto scrollbar-hide">
              <div className="w-full pl-5 pr-2">
                {isLoading ? (
                  <div className="py-6 text-sm text-gray-300">
                    불러오는 중…
                  </div>
                ) : isError || !character ? (
                  <div className="py-6 text-sm text-gray-300">
                    프로필을 불러오지 못했습니다.
                    <div className="mt-3">
                      <Button
                        type="button"
                        variant="secondary"
                        className="bg-gray-800 hover:bg-gray-700"
                        onClick={() => {
                          dispatchToast('error', '잠시 후 다시 시도해주세요.');
                        }}
                      >
                        확인
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-6">
                    {/* ✅ (모바일 상세페이지) 이미지 갤러리 */}
                    <div className="space-y-3">
                      {/* ✅ 썸네일(미니 갤러리) 비노출 → <> 버튼 + 모바일 스와이프(슬라이드) */}
                      <div
                        className="relative w-full mb-1 h-[320px] sm:h-[360px] rounded-lg overflow-hidden bg-gray-900"
                        onTouchStart={handleTouchStart}
                        onTouchEnd={handleTouchEnd}
                      >
                        <img
                          src={resolveImageUrl(displayImages[safeActiveIndex]) || displayImages[safeActiveIndex] || DEFAULT_SQUARE_URI}
                          alt={String(character?.name || '캐릭터')}
                          className="absolute inset-0 w-full h-full object-contain"
                          loading="lazy"
                          decoding="async"
                          onError={(e) => {
                            try {
                              e.currentTarget.src = DEFAULT_SQUARE_URI;
                            } catch (_) {}
                          }}
                        />

                        {/* 좌/우 버튼(PC/모바일 공통) */}
                        <button
                          type="button"
                          onClick={goPrev}
                          disabled={!canGoPrev}
                          aria-label="이전 이미지"
                          className={`absolute left-3 top-1/2 -translate-y-1/2 z-10 h-9 w-9 rounded-full bg-black/30 text-white hover:bg-black/40 disabled:opacity-30 disabled:pointer-events-none flex items-center justify-center`}
                        >
                          <ChevronLeft className="w-5 h-5" />
                        </button>
                        <button
                          type="button"
                          onClick={goNext}
                          disabled={!canGoNext}
                          aria-label="다음 이미지"
                          className={`absolute right-3 top-1/2 -translate-y-1/2 z-10 h-9 w-9 rounded-full bg-black/30 text-white hover:bg-black/40 disabled:opacity-30 disabled:pointer-events-none flex items-center justify-center`}
                        >
                          <ChevronRight className="w-5 h-5" />
                        </button>

                        {/* 좌상단 배지: 턴수 + (원작챗/웹소설) */}
                        {(turnBadgeText || isOrigChatCharacter || isWebNovelCharacter) ? (
                          <div className="absolute top-2 left-2 z-10 flex flex-col items-start gap-1">
                            {turnBadgeText ? (
                              <Badge className="bg-purple-600/90 text-white hover:bg-purple-600 px-1.5 py-0.5 text-[11px]">
                                {turnBadgeText}
                              </Badge>
                            ) : null}
                            {(isOrigChatCharacter || isWebNovelCharacter) ? (
                              isOrigChatCharacter ? (
                                <Badge className="bg-orange-400 text-black hover:bg-orange-400 px-1.5 py-0.5 text-[11px]">
                                  원작챗
                                </Badge>
                              ) : (
                                <Badge className="bg-blue-600 text-white hover:bg-blue-600 px-1.5 py-0.5 text-[11px]">
                                  웹소설
                                </Badge>
                              )
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    </div>

                    {/* ✅ (모바일 상세페이지) 정보 헤더 */}
                    <CharacterInfoHeader
                      character={character}
                      likeCount={likeCount}
                      isLiked={isLiked}
                      handleLike={handleLike}
                      isOwner={false}
                      canTogglePublic={false}
                      onEdit={() => {}}
                      onDelete={() => {}}
                      onTogglePublic={() => {}}
                      isWebNovel={false}
                      workId={null}
                      tags={tags}
                      compact
                    />

                    {/* ✅ (모바일 상세페이지) 채팅 진입 버튼은 "푸터 고정바"로 이동 */}

                    {/* ✅ 원작챗: 원작 웹소설 카드를 상단으로 끌어올림 */}
                    {originStoryId ? (
                      <section id="origin-story" className="mt-3">
                        <div className="mb-2 text-sm font-semibold text-gray-300">
                          이 캐릭터가 등장한 웹소설
                        </div>
                        <ul className="flex justify-center">
                          <li className="w-1/2">
                            <StoryExploreCard
                              story={{
                                id: originStoryId,
                                title: character?.origin_story_title,
                                cover_url: character?.origin_story_cover,
                                creator_username: character?.origin_story_creator,
                                view_count: character?.origin_story_views,
                                like_count: character?.origin_story_likes,
                                excerpt: character?.origin_story_excerpt,
                              }}
                              variant="home"
                              showLikeBadge={false}
                              onClick={() => {
                                try { navigate(`/stories/${originStoryId}`); } catch (_) {}
                              }}
                            />
                          </li>
                        </ul>
                      </section>
                    ) : null}

                    {/* ✅ (모바일 상세페이지) 상세 섹션 */}
                    <CharacterDetails
                      character={character}
                      comments={Array.isArray(comments) ? comments : []}
                      commentText={commentText}
                      setCommentText={setCommentText}
                      handleCommentSubmit={handleCommentSubmit}
                      handleDeleteComment={handleDeleteComment}
                      submittingComment={submittingComment}
                      user={user}
                      tags={tags}
                      // ✅ 원작챗 모달 UX: 크리에이터 코멘트 비노출
                      hideCreatorComment={isOrigChatCharacter}
                      // ✅ 모달: 태그는 '공개일 | 수정일' 아래로 이동(헤더에서 렌더링)
                      hideTags
                      // ✅ 원작 카드 노출 위치를 상단으로 옮겼으므로 중복 방지
                      originStoryCard={null}
                      openingId={selectedOpeningId}
                      onOpeningChange={(v) => {
                        try { setSelectedOpeningId(String(v || '').trim()); } catch (_) {}
                      }}
                    />
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ✅ 푸터 고정바: 경쟁사 UX(모달 하단 고정 CTA) */}
          <div className="absolute left-0 right-0 bottom-0 px-5 pb-5 pt-3 bg-gradient-to-t from-gray-950 via-gray-950/95 to-transparent border-t border-gray-800/60">
            {lastRoomIdForThisCharacter ? (
              <div className="grid grid-cols-2 gap-3">
                <Button
                  type="button"
                  onClick={continueChat}
                  className="w-full bg-gray-700 hover:bg-gray-600 text-white font-bold text-lg py-6"
                >
                  계속 대화
                </Button>
                <Button
                  type="button"
                  onClick={startNewChat}
                  className="w-full bg-red-600 hover:bg-red-700 text-white font-bold text-lg py-6"
                >
                  <div className="flex flex-col items-center leading-tight">
                    {!isOrigChatCharacter ? (
                      <div className="text-xs font-semibold text-white/90">선택한 오프닝으로</div>
                    ) : null}
                    <div className="text-lg font-extrabold">새로 대화</div>
                  </div>
                </Button>
              </div>
            ) : (
              <Button
                type="button"
                onClick={startChat}
                className="w-full bg-red-600 hover:bg-red-700 text-white font-bold text-lg py-6"
              >
                <div className="flex flex-col items-center leading-tight">
                  {!isOrigChatCharacter ? (
                    <div className="text-xs font-semibold text-white/90">선택한 오프닝으로</div>
                  ) : null}
                  <div className="text-lg font-extrabold">새로 대화</div>
                </div>
              </Button>
            )}
          </div>
        </ErrorBoundary>
      </div>
    </div>
  );
}

