/**
 * 캐릭터 상세 페이지
 */

import React, { useState, useEffect } from 'react';
import { useParams, useNavigate,useLocation} from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useLoginModal } from '../contexts/LoginModalContext';
import { charactersAPI,API_BASE_URL, api, mediaAPI } from '../lib/api';
import { resolveImageUrl } from '../lib/images';
import { DEFAULT_SQUARE_URI } from '../lib/placeholder';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '../components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '../components/ui/avatar';
import { Badge } from '../components/ui/badge';
import { 
  ArrowLeft,
  MessageCircle,
  Heart,
  Edit,
  Trash2,
  Settings,
  Loader2,
  AlertCircle,
  MoreVertical,
  Star,
  Image as ImageIcon,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';
import CharacterInfoHeader from '../components/CharacterInfoHeader'; // 컴포넌트 임포트
import ChatInteraction from '../components/ChatInteraction'; // 컴포넌트 임포트
import CharacterDetails from '../components/CharacterDetails'; // 컴포넌트 임포트
import AnalyzedCharacterCard from '../components/AnalyzedCharacterCard';
import StoryExploreCard from '../components/StoryExploreCard';
import ImageGenerateInsertModal from '../components/ImageGenerateInsertModal';
import { getReadingProgress } from '../lib/reading';
import AppLayout from '../components/layout/AppLayout';
import { ORIGCHAT_PUBLIC_ENABLED, WEBNOVEL_PUBLIC_ENABLED } from '../lib/featureFlags';

const dispatchToast = (type, message) => {
  try {
    window.dispatchEvent(new CustomEvent('toast', { detail: { type, message } }));
  } catch (_) {}
};

const CharacterDetailPage = () => {
  const { characterId } = useParams();
  const { user, isAuthenticated, loading: authLoading } = useAuth();
  const { openLoginModal } = useLoginModal();
  const navigate = useNavigate();
  // 2. useLocation hook을 호출하여 location 객체를 가져옵니다.
  const location = useLocation();
  const queryClient = useQueryClient();
  const preloadedCharacter = React.useMemo(() => {
    try {
      const raw = location?.state?.preloadedCharacter;
      if (!raw || typeof raw !== 'object') return null;
      const pid = String(raw?.id || '').trim();
      if (!pid || pid !== String(characterId || '').trim()) return null;
      return raw;
    } catch (_) {
      return null;
    }
  }, [location?.state, characterId]);

  const [character, setCharacter] = useState(preloadedCharacter);
  const [loading, setLoading] = useState(!preloadedCharacter);
  const [error, setError] = useState('');
  
  // Caveduck UI를 위한 임시 상태
  const [activeImage, setActiveImage] = useState(() => String(preloadedCharacter?.avatar_url || '').trim());
  const [galleryImages, setGalleryImages] = useState(() => {
    const seed = String(preloadedCharacter?.avatar_url || '').trim();
    return seed ? [seed] : [];
  });
  const [isLiked, setIsLiked] = useState(false);
  // 첫 번째 이미지의 가로세로 비율을 기억하여 메인 프리뷰의 사이즈를 고정
  const [baseRatio, setBaseRatio] = useState(1); // height/width
  const [likeCount, setLikeCount] = useState(() => Number(preloadedCharacter?.like_count ?? 0) || 0);
  const [imgModalOpen, setImgModalOpen] = useState(false);
  // ✅ 오프닝 선택(상세페이지): 유저가 시작 오프닝을 고르면 첫상황/첫대사가 즉시 바뀌고,
  // 시작 버튼을 누르면 해당 오프닝으로 채팅이 시작된다.
  const [selectedOpeningId, setSelectedOpeningId] = useState('');

  const selectedOpeningName = React.useMemo(() => {
    try {
      const items = Array.isArray(character?.start_sets?.items) ? character.start_sets.items : [];
      const sid = String(selectedOpeningId || '').trim();
      if (!sid || items.length === 0) return '';
      const found = items.find((x) => String(x?.id || '').trim() === sid);
      return String(found?.title || '').trim();
    } catch (_) { return ''; }
  }, [character?.start_sets?.items, selectedOpeningId]);

  // Media assets for this character
  const { data: mediaAssets = [], refetch: refetchMedia } = useQuery({
    queryKey: ['media-assets', 'character', characterId],
    queryFn: async () => {
      const res = await mediaAPI.listAssets({ entityType: 'character', entityId: characterId, presign: false, expiresIn: 300 });
      return Array.isArray(res.data?.items) ? res.data.items : (Array.isArray(res.data) ? res.data : []);
    },
    enabled: !!characterId,
    staleTime: 0,
    refetchOnMount: 'always',
  });

  const [comments, setComments] = useState([]);
  const [commentText, setCommentText] = useState('');
  const [submittingComment, setSubmittingComment] = useState(false);
  const [tags, setTags] = useState([]);

  // 3. 뒤로가기: 항상 대시보드 메인으로 이동
  const handleGoBack = () => {
    navigate('/dashboard');
  };

  useEffect(() => {
    let mounted = true;
    const loadCharacterData = async () => {
      const hasWarmCharacter = Boolean(preloadedCharacter);
      if (!hasWarmCharacter) setLoading(true);
      setError('');
      setComments([]);
      setTags([]);
      setIsLiked(false);
      try {
        const response = await charactersAPI.getCharacter(characterId);
        if (!mounted) return;
        const characterData = response.data;
        setCharacter(characterData);
        setLikeCount(characterData.like_count || 0);

        // [핵심 수정] 이미지 갤러리 설정
        const mainImageUrl = characterData.avatar_url;
        // characterData.image_descriptions가 있고, 배열인지 확인
        /**
         * ✅ 상황이미지 공개/비공개(요구사항)
         *
         * - 기본값은 공개.
         * - 비공개 이미지는 "다른 유저"에게 상세페이지 미니갤러리에 보이지 않아야 한다.
         * - 크리에이터(소유자)/관리자는 모두 볼 수 있다.
         */
        const canSeePrivate = (() => {
          try {
            const uid = user?.id;
            if (uid && characterData?.creator_id && uid === characterData.creator_id) return true;
            if (user?.is_admin) return true;
            return false;
          } catch (_) {
            return false;
          }
        })();
        const galleryImageUrls = Array.isArray(characterData.image_descriptions)
          ? characterData.image_descriptions
              .filter((img) => canSeePrivate || img?.is_public !== false)
              .map((img) => img.url)
          : [];

        // 대표 아바타 이미지를 갤러리의 첫 번째 이미지로 포함
        const allImages = [mainImageUrl, ...galleryImageUrls].filter(Boolean);
        
        // 중복 제거 (아바타와 갤러리 이미지가 같을 수 있으므로)
        const uniqueImages = [...new Set(allImages)];
        const firstBatch = uniqueImages.length > 0 ? uniqueImages : [DEFAULT_SQUARE_URI];
        setGalleryImages(firstBatch);
        const first = firstBatch[0] || DEFAULT_SQUARE_URI;
        setActiveImage(first); // 기본 이미지
        // 상세 메인 프리뷰는 항상 3:4(세로형)로 고정
        setBaseRatio(4/3);
        setLoading(false);
        
        // 좋아요 상태 확인
        void (async () => {
          if (!isAuthenticated) return;
          try {
            const likeStatusResponse = await charactersAPI.getLikeStatus(characterId);
            if (!mounted) return;
            setIsLiked(!!likeStatusResponse?.data?.is_liked);
          } catch (_) {}
        })();

        // 댓글 로드
        void (async () => {
          try {
            const commentsResponse = await charactersAPI.getComments(characterId);
            if (!mounted) return;
            setComments(Array.isArray(commentsResponse?.data) ? commentsResponse.data : []);
          } catch (_) {}
        })();

        // 태그 로드
        void (async () => {
          try {
            const tagRes = await api.get(`/characters/${characterId}/tags`);
            if (!mounted) return;
            setTags(Array.isArray(tagRes?.data) ? tagRes.data : []);
          } catch (_) {}
        })();


      } catch (err) {
        if (!mounted) return;
        console.error('캐릭터 정보 로드 실패:', err);
        const status = err?.response?.status;
        if (status === 404) {
          setError('요청하신 캐릭터를 찾을 수 없습니다.');
        } else if (status === 403) {
          setError('해당 캐릭터를 조회할 권한이 없습니다.');
        } else if (!err?.response) {
          setError('네트워크 오류가 발생했습니다. 연결을 확인해주세요.');
        } else {
          setError('캐릭터 정보를 불러오는 중 오류가 발생했습니다.');
        }
        setLoading(false);
      }
    };
    loadCharacterData();
    return () => { mounted = false; };
  }, [characterId, isAuthenticated, user?.id, user?.is_admin, preloadedCharacter]);

  // ✅ 백필 pending 상태면 3초 간격으로 자동 refetch
  useEffect(() => {
    if (character?.start_sets?._backfill_status !== 'pending') return;
    const interval = setInterval(async () => {
      try {
        const res = await charactersAPI.getCharacter(characterId);
        if (res?.data) setCharacter(res.data);
        if (res?.data?.start_sets?._backfill_status !== 'pending') clearInterval(interval);
      } catch (_) {}
    }, 3000);
    return () => clearInterval(interval);
  }, [characterId, character?.start_sets?._backfill_status]);

  React.useEffect(() => {
    if ((mediaAssets || []).length > 0) {
      const urls = mediaAssets.map(a => a.url);
      setGalleryImages(urls);
      if (urls[0]) setActiveImage(urls[0]);
      // 상세는 세로형 컨테이너 고정(기본 3:4)
      setBaseRatio(4/3);
    }
  }, [mediaAssets]);

  const handleCommentSubmit = async (e) => {
    e.preventDefault();
    // 📍 현재 로그인한 user 객체가 있는지 확인하는 가드 추가
    if (!isAuthenticated || !commentText.trim() || !user) return;

    setSubmittingComment(true);
    try {
      const response = await charactersAPI.createComment(characterId, { content: commentText.trim() });
      
      // [핵심 수정] 새로 생성된 댓글 정보에 현재 사용자 정보를 합쳐줍니다.
      const newComment = {
        ...response.data, // 백엔드로부터 받은 댓글 정보 (id, content, user_id 등)
        username: user.username, // 현재 로그인한 사용자의 닉네임
        user_avatar_url: user.avatar_url || null // 현재 로그인한 사용자의 아바타
      };

      // 📍 완전한 정보를 가진 newComment 객체를 상태에 추가합니다.
      setComments([newComment, ...comments]);
      setCommentText('');
    } catch (err) {
      console.error('댓글 작성 실패:', err);
    } finally {
      setSubmittingComment(false);
    }
  };

  const handleDeleteComment = async (commentId) => {
    if (!window.confirm('정말로 이 댓글을 삭제하시겠습니까?')) return;
    try {
      await charactersAPI.deleteComment(commentId);
      setComments(comments.filter(c => c.id !== commentId));
    } catch (err) {
      console.error('댓글 삭제 실패:', err);
      dispatchToast('error', '댓글 삭제에 실패했습니다.');
    }
  };

  const startChat = () => {
    /**
     * ✅ 게스트 UX(요구사항)
     *
     * - 게스트도 채팅방 화면 진입은 허용한다.
     * - 전송/요술봉 등 "행동"에서만 로그인 모달을 띄운다(이 로직은 ChatPage에서 처리).
     */
    try {
      const opening = String(selectedOpeningId || '').trim();
      const usp = new URLSearchParams();
      // ✅ 오프닝 선택이 있는 경우, "새로 시작"으로 강제해서 선택값이 기존 방에 섞이지 않게 한다.
      usp.set('new', '1');
      if (opening) usp.set('opening', opening);
      navigate(`/ws/chat/${characterId}?${usp.toString()}`);
    } catch (_) {
      navigate(`/ws/chat/${characterId}`);
    }
  };

  // 🔥 useMutation을 사용한 좋아요 처리
  const likeMutation = useMutation({
    mutationFn: (liked) => 
      liked 
        ? charactersAPI.unlikeCharacter(characterId) 
        : charactersAPI.likeCharacter(characterId),
    onSuccess: () => {
      // 좋아요 상태 즉시 업데이트
      setIsLiked((prev) => !prev);
      setLikeCount((prev) => isLiked ? Math.max(0, prev - 1) : prev + 1);
      
      // 🚀 메인 페이지의 캐릭터 목록 캐시를 무효화하여 자동 업데이트 유도
      queryClient.invalidateQueries({ queryKey: ['characters'] });
      // 관심(좋아요) 목록 캐시 무효화: 홈 섹션 및 즐겨찾기 페이지 모두
      queryClient.invalidateQueries({ queryKey: ['liked-characters'] });
      queryClient.invalidateQueries({ queryKey: ['liked-characters-page'] });
    },
    onError: (err) => {
      console.error('좋아요 처리 실패:', err);
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

  const isOwner = !authLoading && user && character?.creator_id === user.id;
  const isAdmin = !authLoading && user && !!user?.is_admin;
  const rawOriginStoryId = character?.origin_story_id || null;
  const originStoryId = ORIGCHAT_PUBLIC_ENABLED ? rawOriginStoryId : null;

  const togglePublicMutation = useMutation({
    mutationFn: () => charactersAPI.toggleCharacterPublic(characterId),
    onSuccess: (data) => {
      // 서버로부터 받은 최신 정보로 캐릭터 상태 업데이트
      setCharacter(prev => ({ ...prev, is_public: data.data.is_public }));
      // 🚀 캐시를 무효화하여 다른 페이지에도 변경사항이 반영되도록 함
      queryClient.invalidateQueries({ queryKey: ['characters'] });
    },
    onError: (err) => {
      console.error('공개 상태 변경 실패:', err);
      dispatchToast('error', err?.response?.data?.detail || '공개 상태를 변경하지 못했습니다.');
    },
  });

  const handleTogglePublic = () => {
    togglePublicMutation.mutate();
  };

  // 웹소설 원작 표시/연동 판단
  const searchParams = new URLSearchParams(location.search || '');
  const isWebNovel = WEBNOVEL_PUBLIC_ENABLED && (
    (character?.source_type === 'IMPORTED') ||
    (location.state?.source === 'webnovel') ||
    (searchParams.get('source') === 'webnovel')
  );
  const workId = WEBNOVEL_PUBLIC_ENABLED ? (location.state?.workId || searchParams.get('workId') || null) : null;
  const displayCharacter = React.useMemo(() => {
    if (!character) return character;
    if (ORIGCHAT_PUBLIC_ENABLED && WEBNOVEL_PUBLIC_ENABLED) return character;
    return {
      ...character,
      origin_story_id: ORIGCHAT_PUBLIC_ENABLED ? character.origin_story_id : null,
      is_origchat: ORIGCHAT_PUBLIC_ENABLED ? character.is_origchat : false,
      source: (!ORIGCHAT_PUBLIC_ENABLED && character.source === 'origchat') ? undefined : character.source,
      source_type: (!WEBNOVEL_PUBLIC_ENABLED && character.source_type === 'IMPORTED') ? 'ORIGINAL' : character.source_type,
    };
  }, [character, ORIGCHAT_PUBLIC_ENABLED, WEBNOVEL_PUBLIC_ENABLED]);

  // 상세 이미지 좌상단 "턴수 배지" 텍스트(일반 캐릭터챗만 기본값으로 ∞ 표시)
  // - SSOT: start_sets.sim_options.max_turns (목록 응답은 start_sets 미포함이므로 max_turns 파생 필드도 함께 사용)
  // - 원작챗/웹소설(IMPORT 포함)은 턴수 개념이 보장되지 않으므로 값이 있을 때만 표시
  const turnBadgeText = (() => {
    try {
      let ss = character?.start_sets ?? character?.basic_info?.start_sets ?? null;
      for (let i = 0; i < 3; i += 1) {
        if (typeof ss !== 'string') break;
        try { ss = JSON.parse(ss); } catch (_) { ss = null; break; }
      }
      if (ss && typeof ss === 'object' && ss.start_sets && typeof ss.start_sets === 'object') {
        ss = ss.start_sets;
      }
      const raw =
        character?.max_turns
        ?? ss?.sim_options?.max_turns
        ?? ss?.sim_options?.maxTurns
        ?? ss?.simOptions?.max_turns
        ?? ss?.simOptions?.maxTurns;
      const n = Number(raw);
      const turns = Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
      if (turns != null) return `${turns}턴`;
      if (!originStoryId && !isWebNovel) return '∞';
      return null;
    } catch (_) {
      return (!originStoryId && !isWebNovel) ? '∞' : null;
    }
  })();
  
  // console.log('🔍 Character Debug:', {
  //   characterId,
  //   source_type: character?.source_type,
  //   isWebNovel,
  //   workId,
  //   locationState: location.state,
  //   searchParams: Object.fromEntries(searchParams.entries())
  // });

  const progress = getReadingProgress(workId);
  const continueChapter = progress > 0 ? progress : 1;

  React.useEffect(() => {
    // ✅ 상세페이지 오프닝 선택 초기값/정합성 유지(방어적)
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

  const deleteCharacter = async () => {
    if (!window.confirm('정말로 이 캐릭터를 삭제하시겠습니까?')) return;
    try {
      await charactersAPI.deleteCharacter(characterId);
      try {
        queryClient.invalidateQueries({ queryKey: ['top-origchat-daily'] });
        queryClient.invalidateQueries({ queryKey: ['webnovel-characters'] });
        queryClient.invalidateQueries({ queryKey: ['characters'] });
        queryClient.invalidateQueries({ queryKey: ['liked-characters'] });
        queryClient.invalidateQueries({ queryKey: ['explore-stories'] });
      } catch (_) {}
      dispatchToast('success', '캐릭터를 삭제했습니다.');
      navigate('/dashboard');
    } catch (err) {
      console.error('캐릭터 삭제 실패:', err);
      const status = err?.response?.status;
      if (status === 403) {
        dispatchToast('error', '삭제 권한이 없습니다.');
      } else {
        dispatchToast('error', '캐릭터 삭제에 실패했습니다.');
      }
    }
  };

  if (loading || authLoading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center min-h-screen bg-gray-900 text-white">
          <Loader2 className="w-8 h-8 animate-spin" />
        </div>
      </AppLayout>
    );
  }

  if (error || !character) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center min-h-screen bg-gray-900 text-white">
          <div className="text-center">
            <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
            <h3 className="text-lg font-medium mb-2">오류</h3>
            <p className="text-gray-400 mb-4 whitespace-pre-line">{error || '캐릭터 정보를 찾을 수 없습니다.'}</p>
            <Button onClick={() => navigate('/dashboard')} variant="outline">
              홈으로 돌아가기
            </Button>
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
    <div className="bg-gray-900 text-white min-h-screen p-4 sm:p-6 lg:p-8">
      <div className="max-w-7xl mx-auto">
        {/* 뒤로가기 버튼 등 헤더 영역 */}
        <header className="mb-5 sm:mb-6">
          <Button variant="ghost" onClick={handleGoBack} className="mb-3 sm:mb-4">
            <ArrowLeft className="w-5 h-5 mr-2" />
            뒤로 가기
          </Button>
        </header>

        {/* 메인 컨텐츠 그리드 */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 sm:gap-8">
          {/* Left: 이미지 갤러리 */}
          <div className="lg:col-span-1">
            {/* 메인 프리뷰: 첫 이미지 비율에 맞춰 컨테이너 고정 */}
            <div className="relative w-full mb-3" style={{ paddingTop: `${Math.max(0.1, baseRatio) * 100}%` }}>
              {/* ✅ 썸네일(미니 갤러리) 비노출 → <> 버튼 + 모바일 스와이프(슬라이드) */}
              <div
                className="absolute inset-0 rounded-lg overflow-hidden bg-gray-900"
                onTouchStart={(e) => {
                  try { window.__cc_touch_start_x = e?.touches?.[0]?.clientX ?? null; } catch (_) {}
                }}
                onTouchEnd={(e) => {
                  try {
                    const startX = Number(window.__cc_touch_start_x);
                    window.__cc_touch_start_x = null;
                    const endX = e?.changedTouches?.[0]?.clientX;
                    if (!Number.isFinite(startX) || typeof endX !== 'number') return;
                    const dx = endX - startX;
                    const TH = 40;
                    const imgs = Array.isArray(galleryImages) && galleryImages.length > 0 ? galleryImages : [activeImage || DEFAULT_SQUARE_URI];
                    const cur = Math.max(0, imgs.indexOf(activeImage));
                    if (dx > TH && cur > 0) setActiveImage(imgs[cur - 1]);
                    if (dx < -TH && cur < imgs.length - 1) setActiveImage(imgs[cur + 1]);
                  } catch (_) {}
                }}
              >
                {(() => {
                  const imgs = Array.isArray(galleryImages) && galleryImages.length > 0 ? galleryImages : [activeImage || DEFAULT_SQUARE_URI];
                  const cur = Math.max(0, imgs.indexOf(activeImage));
                  const src = resolveImageUrl(imgs[cur]) || imgs[cur] || DEFAULT_SQUARE_URI;
                  const canPrev = cur > 0;
                  const canNext = cur < imgs.length - 1;
                  return (
                    <>
                      <img
                        src={src}
                        alt={character.name}
                        className="absolute inset-0 w-full h-full object-cover"
                        loading="lazy"
                        decoding="async"
                        onError={(e) => {
                          try { e.currentTarget.src = DEFAULT_SQUARE_URI; } catch (_) {}
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => { if (canPrev) setActiveImage(imgs[cur - 1]); }}
                        disabled={!canPrev}
                        aria-label="이전 이미지"
                        className="absolute left-3 top-1/2 -translate-y-1/2 z-10 h-9 w-9 rounded-full bg-black/30 text-white hover:bg-black/40 disabled:opacity-30 disabled:pointer-events-none flex items-center justify-center"
                      >
                        <ChevronLeft className="w-5 h-5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => { if (canNext) setActiveImage(imgs[cur + 1]); }}
                        disabled={!canNext}
                        aria-label="다음 이미지"
                        className="absolute right-3 top-1/2 -translate-y-1/2 z-10 h-9 w-9 rounded-full bg-black/30 text-white hover:bg-black/40 disabled:opacity-30 disabled:pointer-events-none flex items-center justify-center"
                      >
                        <ChevronRight className="w-5 h-5" />
                      </button>
                    </>
                  );
                })()}
              </div>
              <div className="absolute top-2 left-2">
                {(turnBadgeText || originStoryId || isWebNovel || displayCharacter?.source_type === 'IMPORTED') ? (
                  <div className="flex flex-col items-start gap-1">
                    {turnBadgeText ? (
                      <Badge className="bg-purple-600/90 text-white hover:bg-purple-600 px-1.5 py-0.5 text-[11px]">
                        {turnBadgeText}
                      </Badge>
                    ) : null}
                    {(originStoryId || isWebNovel || displayCharacter?.source_type === 'IMPORTED') ? (
                      originStoryId ? (
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
              {isOwner && (
                <button
                  type="button"
                  onClick={() => setImgModalOpen(true)}
                  aria-label="대표이미지 생성/삽입"
                  title="대표이미지 생성/삽입"
                  // ✅ 모바일 안전:
                  // - 터치 타겟(최소 40px) 보장
                  // - focus-visible 링/active 피드백 추가(접근성/터치 안정)
                  // - backdrop-blur로 이미지 위에서도 가독성 유지
                  className="absolute top-2 right-2 z-20 h-10 w-10 rounded-full bg-black/50 backdrop-blur-sm text-white hover:bg-black/65 border border-white/10 hover:border-white/20 flex items-center justify-center shadow-sm transition-colors touch-manipulation active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500/70 focus-visible:ring-offset-2 focus-visible:ring-offset-black/40"
                >
                  <ImageIcon className="w-5 h-5" />
                </button>
              )}
            </div>
          </div>

          {/* Right: 캐릭터 정보 */}
          <div className="lg:col-span-2 space-y-6 sm:space-y-8">
              <CharacterInfoHeader
              character={displayCharacter}
              likeCount={likeCount}
              isLiked={isLiked}
              handleLike={handleLike}
              isOwner={isOwner}
              canTogglePublic={!!(isOwner || isAdmin)}
              onEdit={() => {
                if (character?.start_sets?._backfill_status === 'pending') {
                  dispatchToast('info', '캐릭터 생성이 마무리되는 중이에요. 잠시 후 다시 시도해주세요.');
                  return;
                }
                navigate(`/characters/${characterId}/edit`);
              }}
              onDelete={deleteCharacter}
              onSettings={() => navigate(`/characters/${characterId}/settings`)}
              onTogglePublic={handleTogglePublic} // 핸들러 함수 전달
              isWebNovel={isWebNovel}
              workId={workId}
              tags={tags}
            />

            {/* ✅ 원작챗: 원작 웹소설 카드를 상단으로 끌어올림 */}
            {originStoryId ? (
              <section id="origin-story" className="mt-3">
                <ul className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 sm:gap-4">
                  <li className="md:col-span-2 lg:col-span-2">
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
                      onClick={() => navigate(`/stories/${originStoryId}`)}
                    />
                  </li>
                </ul>
              </section>
            ) : null}

            {/* 원작 웹소설 카드는 CharacterDetails 내 '세계관' 아래에서만 노출 */}

            {/* 웹소설 원작 버튼 - workId가 있을 때만 */}
            {isWebNovel && workId && (
              <div className="flex items-center gap-2">
                <Button className="bg-purple-600 hover:bg-purple-700" onClick={() => navigate(`/works/${workId}/chapters/1`)}>
                  첫화보기
                </Button>
                <Button variant="outline" className="border-gray-700 text-gray-200" onClick={() => navigate(`/works/${workId}/chapters/${continueChapter}`)}>
                  이어보기{progress > 0 ? ` (${continueChapter}화)` : ''}
                </Button>
                <Button
                  variant="secondary"
                  className="bg-pink-600 hover:bg-pink-700"
                  // ✅ "시작" 버튼은 새 원작챗 세션을 의도하므로 new=1로 강제(항상 새 대화)
                  onClick={() => navigate(`/ws/chat/${characterId}?source=origchat&storyId=${workId}&anchor=${continueChapter}&mode=plain&new=1`)}
                >
                  등장인물과 원작챗 시작
                </Button>
              </div>
            )}



            {isWebNovel && (
              <div className="mt-4">
                <h3 className="text-lg font-semibold mb-2">소설 캐릭터 요약</h3>
                <AnalyzedCharacterCard
                  initialCharacter={{
                    name: character.name,
                    description: character.description || '',
                    social_tendency: 50,
                  }}
                  readOnly
                />
              </div>
            )}

            <ChatInteraction
              onStartChat={startChat}
              characterId={characterId}
              isAuthenticated={isAuthenticated}
              isWebNovel={isWebNovel}
              originStoryId={originStoryId}
              openingId={selectedOpeningId}
              openingName={selectedOpeningName}
            />
            <CharacterDetails
              character={displayCharacter}
              comments={comments}
              commentText={commentText}
              setCommentText={setCommentText}
              handleCommentSubmit={handleCommentSubmit}
              handleDeleteComment={handleDeleteComment}
              submittingComment={submittingComment}
              user={user}
              tags={tags}
              // ✅ 상세페이지: 태그는 모달과 동일하게 '공개일 | 수정일' 아래(헤더)에서 렌더링
              hideTags
              // ✅ 원작 카드 위치를 상단으로 옮겼으므로 중복 방지
              originStoryCard={null}
              openingId={selectedOpeningId}
              onOpeningChange={(v) => {
                try { setSelectedOpeningId(String(v || '').trim()); } catch (_) {}
              }}
            />
            {/* 최근 생성물 스트립 제거 */}
            <ImageGenerateInsertModal
              open={imgModalOpen}
              onClose={(e)=>{ 
                setImgModalOpen(false); 
                if (e && e.attached) {
                  try {
                    refetchMedia();
                    queryClient.invalidateQueries({ queryKey: ['characters'] });
                    queryClient.invalidateQueries({ queryKey: ['trending-characters-daily'] });
                    queryClient.invalidateQueries({ queryKey: ['top-origchat-daily'] });
                    // 글로벌 미디어 갱신 이벤트 디스패치(채팅방 등에서 갤러리 갱신)
                    try { window.dispatchEvent(new CustomEvent('media:updated', { detail: { entityType: 'character', entityId: characterId } })); } catch(_) {}
                    // 삽입 후 바로 보기 포커스
                    const focusUrl = e?.focusUrl;
                    if (focusUrl) {
                      setActiveImage(focusUrl);
                      setGalleryImages(prev => Array.from(new Set([focusUrl, ...prev])));
                    }
                  } catch (_) {}
                }
              }}
              entityType={'character'}
              entityId={characterId}
            />
          </div>
        </div>
      </div>
    </div>
    </AppLayout>
  );
};

export default CharacterDetailPage; 
