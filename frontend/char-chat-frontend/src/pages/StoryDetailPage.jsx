import React, { useEffect, useMemo, useState, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import AppLayout from '../components/layout/AppLayout';
import { Button } from '../components/ui/button';
import { storiesAPI, chaptersAPI, origChatAPI, mediaAPI, charactersAPI } from '../lib/api';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '../components/ui/dialog';
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogCancel, AlertDialogAction } from '../components/ui/alert-dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Heart, ArrowLeft, AlertCircle, MoreVertical, Copy, Trash2, Edit, MessageCircle, Eye, Image as ImageIcon } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '../components/ui/avatar';
import { Badge } from '../components/ui/badge';
import { Alert, AlertDescription } from '../components/ui/alert';
import { useAuth } from '../contexts/AuthContext';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from '../components/ui/dropdown-menu';
import { Switch } from '../components/ui/switch';
import { Label } from '../components/ui/label';
import { getReadingProgress } from '../lib/reading';
import { resolveImageUrl } from '../lib/images';
import { Skeleton } from '../components/ui/skeleton';
import CharacterProfileInline from '../components/inline/CharacterProfileInline';
import OrigChatStartModal from '../components/OrigChatStartModal';
import ChapterManageModal from '../components/ChapterManageModal';
import ChapterEditModal from '../components/ChapterEditModal';
import ImageGenerateInsertModal from '../components/ImageGenerateInsertModal';

const StoryDetailPage = () => {
  const { storyId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const locationState = useLocation().state || {};
  const { user, isAuthenticated, profileVersion } = useAuth();
  const extractedRef = useRef(null);
  const [chapterModalOpen, setChapterModalOpen] = useState(false);
  const [imgModalOpen, setImgModalOpen] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [confirmRebuildOpen, setConfirmRebuildOpen] = useState(false);
  const [origModalOpen, setOrigModalOpen] = useState(false);
  const [preselectedCharacterId, setPreselectedCharacterId] = useState(null);
  const [editingChapter, setEditingChapter] = useState(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['story', storyId],
    queryFn: async () => {
      const res = await storiesAPI.getStory(storyId);
      return res.data;
    },
    staleTime: Infinity,
    gcTime: 24 * 60 * 60 * 1000,
  });

  const story = data || {};

  const coverUrl = useMemo(() => {
    if (story.cover_url) return story.cover_url;
    const kws = Array.isArray(story.keywords) ? story.keywords : [];
    const found = kws.find((k) => typeof k === 'string' && k.startsWith('cover:'));
    return found ? found.replace(/^cover:/, '') : '';
  }, [story]);

  const [likeCount, setLikeCount] = useState(story.like_count || 0);
  const [pageToast, setPageToast] = useState({ show: false, type: 'success', message: '' });
  const [isLiked, setIsLiked] = useState(false);
  const [error, setError] = useState('');
  const [comments, setComments] = useState([]);
  const [commentText, setCommentText] = useState('');
  const [submittingComment, setSubmittingComment] = useState(false);
  // 미니 갤러리 상태 (캐릭터 상세와 동일 패턴)
  const [activeImage, setActiveImage] = useState('');
  const [galleryImages, setGalleryImages] = useState([]);
  const [baseRatio, setBaseRatio] = useState(1);

  useEffect(() => {
    setLikeCount(story.like_count || 0);
  }, [story.like_count]);

  useEffect(() => {
    const loadSocial = async () => {
      try {
        if (isAuthenticated) {
          const ls = await storiesAPI.getLikeStatus(storyId);
          setIsLiked(!!ls.data?.is_liked);
        }
        const cr = await storiesAPI.getComments(storyId);
        setComments(Array.isArray(cr.data) ? cr.data : []);
      } catch (_) {}
    };
    loadSocial();
  }, [storyId, isAuthenticated]);

  // 미디어 자산: 스토리용 리스트 조회
  const { data: mediaAssets = [], refetch: refetchMedia } = useQuery({
    queryKey: ['media-assets', 'story', storyId],
    queryFn: async () => {
      const res = await mediaAPI.listAssets({ entityType: 'story', entityId: storyId, presign: false, expiresIn: 300 });
      return Array.isArray(res.data?.items) ? res.data.items : (Array.isArray(res.data) ? res.data : []);
    },
    enabled: !!storyId,
    staleTime: 0,
    refetchOnMount: 'always',
  });

  // 전역 media:updated 발생 시 스토리/캐릭터 연관 뷰 새로고침
  useEffect(() => {
    const h = (e) => {
      const d = e?.detail || {};
      // 이 스토리 관련 업데이트면 미디어/상세/그리드 즉시 갱신
      if (d?.entityType === 'story' && String(d?.entityId) === String(storyId)) {
        try { refetchMedia(); } catch {}
        try { queryClient.invalidateQueries({ queryKey: ['story', storyId] }); } catch {}
        try { fetchExtracted(); } catch {}
      }
      // 이 스토리의 등장인물(캐릭터) 업데이트도 반영
      if (d?.entityType === 'character') {
        try { fetchExtracted(); } catch {}
      }
    };
    window.addEventListener('media:updated', h);
    return () => window.removeEventListener('media:updated', h);
  }, [storyId, queryClient]);

  // 갤러리 이미지 구성: mediaAssets 우선, 없으면 cover_url + keywords의 cover: 항목들
  useEffect(() => {
    try {
      const assetUrls = (mediaAssets || []).map(a => a.url);
      if (assetUrls.length > 0) {
        const uniqueA = Array.from(new Set(assetUrls));
        setGalleryImages(uniqueA);
        const firstA = uniqueA[0] || '';
        setActiveImage(firstA);
        // 기본 3:4 비율로 고정
        setBaseRatio(4/3);
        return;
      }

      // cover: 메타 키워드는 더 이상 사용하지 않음. 기존 데이터가 있더라도 무시
      const fallback = Array.from(new Set([story.cover_url].filter(Boolean)));
      setGalleryImages(fallback);
      const first = fallback[0] || '';
      setActiveImage(first);
      setBaseRatio(4/3);
    } catch (_) {
      setGalleryImages([]);
      setActiveImage('');
      setBaseRatio(1);
    }
  }, [story.cover_url, story.keywords, mediaAssets]);

  const likeMutation = useMutation({
    mutationFn: (liked) => (liked ? storiesAPI.unlikeStory(storyId) : storiesAPI.likeStory(storyId)),
    onSuccess: (_res, wasLiked) => {
      const delta = wasLiked ? -1 : 1;
      setIsLiked(!wasLiked);
      setLikeCount((prev) => Math.max(0, (prev || 0) + delta));
      // 상세 캐시 즉시 반영
      queryClient.setQueryData(['story', storyId], (prev) => {
        if (!prev) return prev;
        const nextLike = Math.max(0, (prev.like_count || 0) + delta);
        return { ...prev, like_count: nextLike };
      });
      // 관련 목록/상세 무효화
      queryClient.invalidateQueries({ queryKey: ['story', storyId] });
      queryClient.invalidateQueries({ queryKey: ['stories'] });
      queryClient.invalidateQueries({ queryKey: ['top-stories-views'] });
      queryClient.invalidateQueries({ queryKey: ['explore-stories'] });
    }
  });

  const handleLike = () => {
    if (!isAuthenticated) { navigate('/login'); return; }
    likeMutation.mutate(isLiked);
  };

  const handleShare = async () => {
    try { await navigator.clipboard.writeText(window.location.href); } catch (_) {}
  };

  const handleStartOrigChatWithRange = async ({ range_from, range_to, characterId = null }) => {
    try {
      if (!isAuthenticated) { navigate('/login'); return; }
      // 회차 범위 유효성 검사
      const totalChapters = Array.isArray(episodesSorted) ? episodesSorted.length : 0;
      const f = Number(range_from);
      const t = Number(range_to);
      if (!Number.isInteger(f) || !Number.isInteger(t) || f < 1 || t < 1 || f > t || t > totalChapters) {
        alert('유효하지 않은 회차 범위입니다. 시작 회차는 1 이상, 종료 회차는 총 회차 이하이며, 시작 ≤ 종료여야 합니다.');
        return;
      }
      const anchorNo = f || targetReadNo;
      const effectiveCharacterId = characterId || story.character_id;
      // 로딩 표시 (버튼 비활성은 생략)
      try {
        await origChatAPI.getContextPack(storyId, { anchor: anchorNo, characterId: effectiveCharacterId, rangeFrom: f, rangeTo: t });
      } catch (_) { /* 컨텍스트 팩은 선택적이므로 실패해도 계속 진행 */ }
      const startRes = await origChatAPI.start({ story_id: storyId, character_id: effectiveCharacterId, chapter_anchor: anchorNo, timeline_mode: 'fixed', range_from: f, range_to: t });
      const roomId = startRes.data?.id || startRes.data?.room_id;
      if (roomId) {
        navigate(`/ws/chat/${effectiveCharacterId}?source=origchat&storyId=${storyId}&anchor=${anchorNo}&rangeFrom=${f}&rangeTo=${t}`);
      } else {
        navigate(`/ws/chat/${effectiveCharacterId}`);
      }
    } catch (e) {
      console.error('원작챗 시작 실패', e);
      const status = e?.response?.status;
      const detail = e?.response?.data?.detail || e?.message || '알 수 없는 오류';
      setPageToast({ show: true, type: 'error', message: `원작챗 시작 실패${status ? ` (${status})` : ''}: ${detail}` });
    }
  };

  const handleDeleteStory = async () => {
    if (!(user && story?.creator_id === user.id)) return;
    if (!window.confirm('작품을 삭제하시겠습니까?')) return;
    try { await storiesAPI.deleteStory(storyId); navigate('/dashboard'); } catch (_) {}
  };

  const handleSubmitComment = async (e) => {
    e.preventDefault();
    if (!isAuthenticated || !commentText.trim()) return;
    setSubmittingComment(true);
    setError('');
    try {
      const res = await storiesAPI.createComment(storyId, { content: commentText.trim() });
      const newComment = {
        ...res.data,
        username: user?.username,
        user_avatar_url: user?.avatar_url || null,
      };
      setComments([newComment, ...comments]);
      setCommentText('');
    } catch (e) {
      setError('댓글 등록에 실패했습니다.');
    } finally {
      setSubmittingComment(false);
    }
  };

  const handleDeleteComment = async (commentId) => {
    if (!window.confirm('이 댓글을 삭제하시겠습니까?')) return;
    try {
      await storiesAPI.deleteComment(commentId);
      setComments((prev) => prev.filter((c) => c.id !== commentId));
    } catch (_) {}
  };

  const handleTogglePublic = async () => {
    try {
      const next = !story.is_public;
      await storiesAPI.updateStory(storyId, { is_public: next });
      queryClient.setQueryData(['story', storyId], (prev) => ({ ...(prev || {}), is_public: next }));
    } catch (_) {}
  };

  // 주의: 훅 순서 보장을 위해 조기 return을 제거하고, 상태별 UI는 아래에서 조건부 렌더링

  // 키워드=태그: 장르가 존재하면 항상 첫 태그로 정렬되도록 보정
  const keywords = (() => {
    const arr = (Array.isArray(story.keywords) ? story.keywords : []).filter((k) => !String(k).startsWith('cover:'));
    const g = (story.genre || '').trim();
    if (!g) return arr;
    const rest = arr.filter(k => k !== g);
    return [g, ...rest];
  })();
  const isOwner = user && story?.creator_id === user.id;
  // 이어보기 진행 상황 (스토리 기준 localStorage 키 사용)
  const progressChapterNo = getReadingProgress(storyId);
  const [sortDesc, setSortDesc] = useState(false);
  const { data: chaptersResp } = useQuery({
    // summary_version이 변할 때만 키가 바뀌어 무효화
    queryKey: ['chapters-by-story', storyId, story?.summary_version || 0, sortDesc],
    queryFn: async () => {
      const res = await chaptersAPI.getByStory(storyId, sortDesc ? 'desc' : 'asc');
      return Array.isArray(res.data) ? res.data : [];
    },
    enabled: !!storyId,
    staleTime: Infinity,
    gcTime: 24 * 60 * 60 * 1000,
  });
  // 등장인물 목록은 상세 렌더 후 별도 지연 로드
  const [charactersLoading, setCharactersLoading] = useState(true);
  const [extractedItems, setExtractedItems] = useState([]);
  const [extractionStatus, setExtractionStatus] = useState(null); // 추출 진행 상태
  const fetchExtracted = async () => {
    try {
      setCharactersLoading(true);
      const r = await storiesAPI.getExtractedCharacters(storyId);
      const items = Array.isArray(r.data?.items) ? r.data.items : [];
      const status = r.data?.extraction_status || null;
      
      setExtractedItems(items);
      setExtractionStatus(status);
      
      // 진행 중이고 아이템이 없으면 3초 후 재시도
      if (status === 'in_progress' && items.length === 0) {
        setTimeout(() => {
          fetchExtracted();
        }, 3000);
      }
    } catch (_) {
      setExtractedItems([]);
      setExtractionStatus(null);
    } finally {
      setCharactersLoading(false);
    }
  };
  // 재생성 중 백엔드 처리 지연을 대비한 폴링
  const pollExtractedUntil = async (timeoutMs = 90000, intervalMs = 1500) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const r = await storiesAPI.getExtractedCharacters(storyId);
        const items = Array.isArray(r.data?.items) ? r.data.items : [];
        if (items.length > 0) {
          setExtractedItems(items);
          return true;
        }
      } catch (_) {}
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    return false;
  };
  useEffect(() => {
    fetchExtracted();
  }, [storyId]);
  const episodesSorted = Array.isArray(chaptersResp) ? chaptersResp : [];
  const firstChapterNo = episodesSorted.length > 0 ? (episodesSorted[0]?.no || 1) : 1;
  const showContinue = Number(progressChapterNo) > 0;
  const targetReadNo = showContinue ? Number(progressChapterNo) : Number(firstChapterNo);

  const handleDeleteAll = async () => {
    try {
      setCharactersLoading(true);
      await storiesAPI.deleteExtractedCharacters(storyId);
      await fetchExtracted();
      setPageToast({ show: true, type: 'success', message: '전체 삭제 완료' });
    } catch (e) {
      console.error('전체 삭제 실패', e);
      setPageToast({ show: true, type: 'error', message: '전체 삭제 실패' });
    } finally {
      setCharactersLoading(false);
      setConfirmDeleteOpen(false);
    }
  };

  const handleRebuildAll = async () => {
    try {
      setCharactersLoading(true);
      const useAsync = (import.meta.env?.VITE_EXTRACT_ASYNC ?? '0') === '1';
      if (useAsync) {
        // 비동기 잡 시작 → 폴링으로 완료 대기
        const resp = await storiesAPI.rebuildExtractedCharactersAsync(storyId);
        const jobId = resp?.data?.job_id;
        if (!jobId) throw new Error('작업 ID를 받지 못했습니다.');
        const start = Date.now();
        const timeoutMs = 600000; // 10m
        while (Date.now() - start < timeoutMs) {
          const st = await storiesAPI.getExtractJobStatus(jobId);
          const s = st?.data || {};
          if (s.status === 'done') {
            await fetchExtracted();
            setPageToast({ show: true, type: 'success', message: '전체 재생성 완료' });
            break;
          }
          if (s.status === 'error') {
            throw new Error(s.error_message || '추출 작업 실패');
          }
          if (s.status === 'cancelled') {
            setPageToast({ show: true, type: 'error', message: '작업이 취소되었습니다' });
            break;
          }
          await new Promise(r => setTimeout(r, 1500));
        }
      } else {
        await storiesAPI.rebuildExtractedCharacters(storyId);
        await fetchExtracted();
        setPageToast({ show: true, type: 'success', message: '전체 재생성 완료' });
      }
    } catch (e) {
      console.error('재생성 실패', e);
      try {
        const ok = await pollExtractedUntil();
        if (ok) setPageToast({ show: true, type: 'success', message: '전체 재생성 완료' });
        else setPageToast({ show: true, type: 'error', message: '전체 재생성 실패' });
      } catch (_) {
        setPageToast({ show: true, type: 'error', message: '전체 재생성 실패' });
      }
    } finally {
      setCharactersLoading(false);
      setConfirmRebuildOpen(false);
    }
  };

  return (
    <AppLayout>
      <div className="bg-gray-900 text-white min-h-screen p-4 sm:p-6 lg:p-8">
        <div className="max-w-7xl mx-auto">
          <header className="mb-6">
            <Button variant="ghost" onClick={() => { navigate('/dashboard'); }} className="mb-2">
              <ArrowLeft className="w-5 h-5 mr-2" /> 뒤로 가기
            </Button>
            {isOwner && (
              <div className="mb-2">
                <Button className="bg-purple-600 hover:bg-purple-700" onClick={()=> setImgModalOpen(true)}>대표이미지 생성/삽입</Button>
              </div>
            )}
          </header>
          {/* 로딩/에러 상태 표시 */}
          {isLoading && (
            <div className="flex items-center justify-center py-16 text-gray-300">불러오는 중...</div>
          )}
          {(isError || !data) && !isLoading && (
            <div className="flex items-center justify-center py-16 text-gray-300">
              <div className="text-center">
                <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
                <p className="text-gray-400">존재하지 않는 작품입니다.</p>
                <Button onClick={() => navigate('/dashboard')} variant="outline" className="mt-4 bg-white text-black hover:bg-gray-100">홈으로 돌아가기</Button>
              </div>
            </div>
          )}

          {/* 본문: 로딩/에러 아닌 경우에만 */}
          {!isLoading && !isError && data && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Left: 이미지 갤러리 (캐릭터 상세와 동일 톤) */}
            <div className="lg:col-span-1">
              {/* 메인 프리뷰: 첫 이미지 비율에 맞춰 컨테이너 고정 */}
              <div className="relative w-full mb-3" style={{ paddingTop: `${Math.max(0.1, baseRatio) * 100}%` }}>
                {activeImage ? (
                  <img
                    src={resolveImageUrl(activeImage) || activeImage}
                    alt={story.title}
                    className="absolute inset-0 w-full h-full object-cover rounded-lg"
                    aria-live="polite"
                    aria-label={`${galleryImages.indexOf(activeImage) + 1} / ${galleryImages.length}`}
                  />
                ) : (
                  <div className="absolute inset-0 bg-gray-800 rounded-lg flex items-center justify-center text-gray-500">NO COVER</div>
                )}
                <span className="sr-only" aria-live="polite">{`${galleryImages.indexOf(activeImage) + 1} / ${galleryImages.length}`}</span>
                <div className="absolute top-2 left-2">
                  <Badge className="bg-blue-600 text-white hover:bg-blue-600">
                    {story.is_webtoon ? '웹툰' : '웹소설'}
                  </Badge>
                </div>
              </div>
              {/* 미니 갤러리: 가로 스크롤 썸네일 */}
              {galleryImages.length > 0 && (
              <div id="detail-thumbnail-gallery" className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
                  {galleryImages.map((imgUrl, index) => {
                    const isActive = activeImage === imgUrl;
                    return (
                      <button
                        key={`${imgUrl}-${index}`}
                        onClick={() => setActiveImage(imgUrl)}
                        className={`relative flex-shrink-0 ${isActive ? 'ring-2 ring-blue-500 ring-offset-1 ring-offset-gray-900' : 'opacity-80 hover:opacity-100'}`}
                        aria-label={`썸네일 ${index + 1}`}
                      >
                        <img
                          src={resolveImageUrl(imgUrl) || imgUrl}
                          alt={`${story.title} thumbnail ${index + 1}`}
                          className={`w-16 h-16 object-cover rounded-md ${isActive ? 'brightness-100' : 'brightness-90'}`}
                        />
                      </button>
                    );
                  })}
                </div>
              )}
              {/* 최근 생성물 스트립 제거 */}
            </div>

            {/* Right: Info & Actions */}
            <div className="lg:col-span-2 space-y-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  {/* 작품명 */}
                  <h1 className="text-4xl font-bold">{story.title}</h1>
                  {/* 닉네임(작성자) */}
                  <div className="flex items-center gap-2 mt-2">
                    <button type="button" onClick={() => navigate(`/users/${story.creator_id}`)} className="flex items-center gap-2 hover:opacity-90">
                      <Avatar className="w-6 h-6">
                        <AvatarImage src={story.creator_avatar_url ? `${story.creator_avatar_url}${story.creator_avatar_url.includes('?') ? '&' : '?'}v=${profileVersion}` : ''} />
                        <AvatarFallback>{(story.creator_username || 'U').charAt(0).toUpperCase()}</AvatarFallback>
                      </Avatar>
                      <span className="text-sm text-gray-300">{story.creator_username || '작성자'}</span>
                    </button>
                    {story.creator_id && (
                      <button onClick={() => navigate(`/users/${story.creator_id}/creator`)} className="text-xs text-gray-400 hover:text-white underline ml-2">작성자 작품 더보기</button>
                    )}
                  </div>
                  {/* 인디케이터(총회차/조회수/좋아요)를 장르 위치로 이동 */}
                  <div className="flex items-center gap-2 mt-2">
                    <Badge variant="secondary" className="bg-gray-800 border border-gray-700 text-gray-300">총회차 {Number(episodesSorted.length || 0).toLocaleString()}</Badge>
                    <Badge variant="secondary" className="bg-gray-800 border border-gray-700 text-gray-300">조회수 {Number(story.view_count || 0).toLocaleString()}</Badge>
                    <Badge variant="secondary" className="bg-gray-800 border border-gray-700 text-gray-300">좋아요 {likeCount.toLocaleString()}</Badge>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" onClick={handleLike}>
                    <Heart className="w-4 h-4 mr-2 text-pink-500" fill={isLiked ? 'currentColor' : 'none'} />
                    {likeCount.toLocaleString()}
                  </Button>
                  <Button variant="outline" onClick={handleShare} className="bg-white text-black hover:bg-gray-100">
                    <Copy className="w-4 h-4 mr-2" /> 공유
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="rounded-full">
                        <MoreVertical className="w-5 h-5" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="bg-gray-800 text-white border-gray-700">
                      {(user && story?.creator_id === user.id && locationState.fromMyGrid) ? (
                        <>
                          <DropdownMenuItem onClick={() => navigate(`/stories/${storyId}/edit`)}>
                            <Edit className="w-4 h-4 mr-2" /> 수정
                          </DropdownMenuItem>
                          <DropdownMenuSeparator className="bg-gray-700" />
                          <div className="relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none">
                            <Label htmlFor="story-public-toggle" className="flex-1">{story.is_public ? '공개' : '비공개'}</Label>
                            <Switch id="story-public-toggle" checked={!!story.is_public} onCheckedChange={handleTogglePublic} />
                          </div>
                          <DropdownMenuSeparator className="bg-gray-700" />
                          <DropdownMenuItem onClick={handleDeleteStory} className="text-red-500">
                            <Trash2 className="w-4 h-4 mr-2" /> 삭제
                          </DropdownMenuItem>
                          <DropdownMenuSeparator className="bg-gray-700" />
                        </>
                      ) : null}
                      <DropdownMenuItem onClick={handleShare}>
                        <Copy className="w-4 h-4 mr-2" /> 공유 링크 복사
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>

              {/* 태그 */}
              {keywords.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-3">
                  {keywords.map((k) => (
                    <Badge key={k} variant="secondary" className="bg-gray-800 border border-gray-700 text-gray-300">{k}</Badge>
                  ))}
                </div>
              )}

              {/* 구분선 */}
              <div className="border-t border-gray-800 mt-4" />

              {/* 액션: 첫화보기/이어보기 + 대화하기 (캐릭터 상세 버튼 톤과 맞춤) */}
              <section className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    onClick={() => navigate(`/stories/${storyId}/chapters/${targetReadNo}`)}
                    className={`bg-gray-700 hover:bg-gray-600 w-full text-white font-semibold py-5`}
                  >
                    {showContinue ? `이어보기 (${progressChapterNo}화)` : `첫화보기 (${firstChapterNo}화)`}
                  </Button>
                  <Button
                    className="w-full bg-red-600 hover:bg-red-700 text-white font-semibold py-5"
                    onClick={() => {
                      if (!isAuthenticated) { navigate('/login'); return; }
                      // 항상 모달 먼저 오픈(후속 동작은 모달 내부에서 처리)
                      setOrigModalOpen(true);
                    }}
                  >
                    등장인물과 원작챗 시작
                  </Button>
                </div>
              </section>

              <section className="space-y-3">
                <h2 className="text-lg font-semibold">소개글</h2>
                <div className="bg-gray-800/40 rounded-md p-4 border border-gray-700">
                  <p className="whitespace-pre-wrap leading-7 text-gray-200">{story.content}</p>
                </div>
              </section>

              {/* 추출 캐릭터 격자 + 원작챗 모달 */}
              <section className="space-y-3" ref={extractedRef}>
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold">이 작품의 등장인물</h2>
                  {isOwner && (
                    <div className="flex items-center gap-2">
                      <Button
                        variant="destructive"
                        className="h-8 px-3"
                        onClick={()=> setConfirmDeleteOpen(true)}
                      >전체 삭제</Button>
                      <Button
                        variant="outline"
                        className="h-8 px-3 bg-white text-black border-gray-300 hover:bg-gray-100"
                        onClick={()=> setConfirmRebuildOpen(true)}
                      >전체 재생성</Button>
                    </div>
                  )}
                </div>
                {charactersLoading && (
                  <div className="space-y-3">
                    <div className="h-1.5 w-full bg-gray-700 rounded overflow-hidden">
                      <div className="h-full w-1/3 bg-blue-500/70 animate-pulse" />
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                      {Array.from({ length: 8 }).map((_, i) => (
                        <div key={`sk-${i}`} className="bg-gray-800/40 border border-gray-700 rounded-md p-3">
                          <div className="flex items-center gap-3">
                            <Skeleton className="w-10 h-10 rounded-full" />
                            <div className="flex-1 space-y-2">
                              <Skeleton className="h-3 w-24" />
                              <Skeleton className="h-3 w-32" />
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {!charactersLoading && extractedItems.length === 0 && (
                  episodesSorted.length === 0 ? (
                    <div className="flex items-center justify-between bg-gray-800/40 border border-gray-700 rounded-md p-3">
                      <span className="text-sm text-gray-400">회차 등록을 먼저 해주세요.</span>
                      {isOwner && (
                        <Button variant="outline" className="h-8 px-3 bg-white text-black border-gray-300 hover:bg-gray-100" onClick={() => setChapterModalOpen(true)}>회차등록</Button>
                      )}
                    </div>
                  ) : extractionStatus === 'in_progress' ? (
                    <div className="flex items-center justify-between bg-gray-800/40 border border-gray-700 rounded-md p-3">
                      <div>
                        <div className="text-sm text-gray-300 flex items-center gap-2">
                          <svg className="animate-spin h-4 w-4 text-blue-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                          </svg>
                          등장인물을 생성하고 있습니다...
                        </div>
                        <div className="text-xs text-gray-500 mt-1">최대 2분이 소요될 수 있습니다. 잠시만 기다려주세요.</div>
                      </div>
                      {isOwner && (
                        <Button variant="outline" className="h-8 px-3 bg-white text-black border-gray-300 hover:bg-gray-100" onClick={fetchExtracted}>새로고침</Button>
                      )}
                    </div>
                  ) : extractionStatus === 'failed' ? (
                    <div className="flex items-center justify-between bg-red-900/20 border border-red-700 rounded-md p-3">
                      <div>
                        <div className="text-sm text-red-300">등장인물 추출에 실패했습니다</div>
                        <div className="text-xs text-gray-400 mt-1">AI가 등장인물을 인식하지 못했습니다. 회차를 더 추가하거나 재생성해주세요.</div>
                      </div>
                      {isOwner && (
                        <Button
                          variant="outline"
                          className="h-8 px-3 bg-red-600 text-white border-red-500 hover:bg-red-700"
                          onClick={async()=>{
                            try {
                              setCharactersLoading(true);
                              await storiesAPI.rebuildExtractedCharacters(storyId);
                              await fetchExtracted();
                              setPageToast({ show: true, type: 'success', message: '재생성 완료' });
                            } catch (e) {
                              setPageToast({ show: true, type: 'error', message: '재생성 실패' });
                            } finally {
                              setCharactersLoading(false);
                            }
                          }}
                        >재생성</Button>
                      )}
                    </div>
                  ) : (
                    <div className="flex items-center justify-between bg-gray-800/40 border border-gray-700 rounded-md p-3">
                      <span className="text-sm text-gray-400">원작챗을 다시 생성해주세요.</span>
                      {isOwner && (
                        <Button
                          variant="outline"
                          className="h-8 px-3 bg-white text-black border-gray-300 hover:bg-gray-100"
                          onClick={async()=>{
                            try {
                              setCharactersLoading(true);
                              await storiesAPI.rebuildExtractedCharacters(storyId);
                              await fetchExtracted();
                              setPageToast({ show: true, type: 'success', message: '전체 재생성 완료' });
                            } catch (e) {
                              console.error('재생성 실패', e);
                              try {
                                const ok = await pollExtractedUntil();
                                if (ok) setPageToast({ show: true, type: 'success', message: '전체 재생성 완료' });
                                else setPageToast({ show: true, type: 'error', message: '전체 재생성 실패' });
                              } catch(_) {
                                setPageToast({ show: true, type: 'error', message: '전체 재생성 실패' });
                              }
                            } finally {
                              setCharactersLoading(false);
                            }
                          }}
                        >전체 재생성</Button>
                      )}
                    </div>
                  )
                )}
                {!charactersLoading && extractedItems.length > 0 && (
                  <ExtractedCharactersGrid
                    storyId={storyId}
                    itemsOverride={extractedItems}
                    maxNo={episodesSorted.length || 1}
                    isOwner={!!isOwner}
                    onStart={(payload)=>handleStartOrigChatWithRange(payload)}
                    onCharacterClick={(characterId) => {
                      setPreselectedCharacterId(characterId);
                      setOrigModalOpen(true);
                    }}
                  />
                )}
              </section>

              {/* 회차 섹션 (UI 우선) */}
              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold">회차</h2>
                  <div className="flex items-center gap-2">
                    {episodesSorted.length > 0 && (
                      <Button variant="outline" className="h-8 px-3 bg-white text-black border-gray-300 hover:bg-gray-100" onClick={() => setSortDesc((v)=>!v)}>{sortDesc ? '최신순' : '오름차순'}</Button>
                    )}
                    {isOwner && (
                      <Button variant="outline" className="h-8 px-3 bg-white text-black border-gray-300 hover:bg-gray-100" onClick={() => setChapterModalOpen(true)}>회차등록</Button>
                    )}
                  </div>
                </div>
                {episodesSorted.length > 0 ? (
                  <ul className="divide-y divide-gray-800 rounded-md border border-gray-700 overflow-hidden">
                    {episodesSorted.map((ch, idx) => {
                      const hasImage = !!ch.image_url; // 웹툰 이미지 유무 확인
                      
                      return (
                      <li
                        key={ch.id ? `id:${ch.id}` : `no:${ch.no ?? 'NA'}|title:${(ch.title || '').slice(0,50)}|i:${idx}`}
                        className={`flex items-center justify-between bg-gray-800/30 px-3 py-2 cursor-pointer hover:bg-gray-700/40 ${Number(ch.no) === Number(progressChapterNo) ? 'ring-1 ring-purple-500/40 bg-gray-800/50' : ''}`}
                        onClick={() => navigate(`/stories/${storyId}/chapters/${ch.no || (idx + 1)}`)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/stories/${storyId}/chapters/${ch.no || (idx + 1)}`); }}
                      >
                        {/* 웹툰 썸네일 (있으면만 표시) */}
                        {hasImage && (
                          <div className="flex items-center gap-3 flex-1 min-w-0">
                            <div className="flex-shrink-0 w-12 h-16 overflow-hidden rounded">
                              <img 
                                src={ch.image_url} 
                                alt={ch.title || '웹툰'}
                                className="w-full h-full object-cover object-top"
                              />
                            </div>
                            <div className="text-sm text-gray-200 truncate max-w-[60vw] lg:max-w-[40vw]">
                              {ch.title || '제목 없음'}
                            </div>
                          </div>
                        )}
                        {!hasImage && (
                          <div className="text-sm text-gray-200 truncate max-w-[60vw] lg:max-w-[40vw]">
                            {ch.title || '제목 없음'}
                          </div>
                        )}
                        <div className="flex items-center gap-3 flex-shrink-0">
                          {isOwner && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-gray-400 hover:text-white hover:bg-gray-700"
                              onClick={(e) => {
                                e.stopPropagation();
                                setEditingChapter(ch);
                              }}
                              title="회차 수정"
                            >
                              <Edit className="w-4 h-4" />
                            </Button>
                          )}
                          <span className="inline-flex items-center gap-1 text-xs text-gray-500">
                            <Eye className="w-3 h-3" />
                            {Number(ch.view_count || 0).toLocaleString()}
                          </span>
                          <span className="text-xs text-gray-500 hidden sm:inline">
                            {ch.created_at ? new Date(ch.created_at).toLocaleDateString() : ''}
                          </span>
                        </div>
                      </li>
                      );
                    })}
                  </ul>
                ) : (
                  <div className="bg-gray-800/30 border border-gray-700 rounded-md p-4 text-sm text-gray-400">연재된 회차가 없습니다</div>
                )}
              </section>

              <section>
                <h2 className="text-lg font-semibold mb-3">댓글</h2>
                {error && (
                  <Alert variant="destructive" className="mb-3">
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}
                {isAuthenticated && (
                  <form onSubmit={handleSubmitComment} className="mb-4">
                    <div className="flex items-start gap-2">
                      <Avatar className="w-8 h-8">
                        <AvatarImage src={user?.avatar_url || ''} />
                        <AvatarFallback>{user?.username?.charAt(0)?.toUpperCase() || 'U'}</AvatarFallback>
                      </Avatar>
                      <textarea
                        value={commentText}
                        onChange={(e) => setCommentText(e.target.value)}
                        rows={3}
                        placeholder="댓글을 입력하세요"
                        className="flex-1 rounded-md bg-gray-800 border border-gray-700 text-sm p-2 outline-none focus:ring-2 focus:ring-purple-600"
                      />
                      <Button type="submit" disabled={submittingComment || !commentText.trim()}>
                        등록
                      </Button>
                    </div>
                  </form>
                )}
                <ul className="space-y-4">
                  {comments.map((c) => (
                    <li key={c.id} className="bg-gray-800/40 border border-gray-700 rounded-md p-3">
                      <div className="flex items-center gap-2 mb-1">
                        <Avatar className="w-6 h-6">
                          <AvatarImage src={c.user_avatar_url || ''} />
                          <AvatarFallback>{(c.username || 'U').charAt(0).toUpperCase()}</AvatarFallback>
                        </Avatar>
                        <span className="text-sm text-gray-300">{c.username || 'User'}</span>
                        <span className="text-xs text-gray-500 ml-auto">{new Date(c.created_at || Date.now()).toLocaleString()}</span>
                      </div>
                      <p className="text-sm whitespace-pre-wrap text-gray-200">{c.content}</p>
                      {(isOwner || c.user_id === user?.id) && (
                        <div className="flex justify-end mt-2">
                          <Button variant="ghost" size="sm" onClick={() => handleDeleteComment(c.id)} className="text-red-400">삭제</Button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            </div>
          </div>
          )}
        </div>
      </div>
      <ChapterManageModal
        open={chapterModalOpen}
        onClose={() => setChapterModalOpen(false)}
        storyId={storyId}
        onAfterSave={() => {
          try { queryClient.invalidateQueries({ queryKey: ['chapters-by-story', storyId] }); } catch {}
        }}
      />
      <ChapterEditModal
        open={!!editingChapter}
        onClose={() => setEditingChapter(null)}
        chapter={editingChapter}
        onAfterSave={() => {
          try {
            queryClient.invalidateQueries({ queryKey: ['chapters-by-story', storyId] });
            queryClient.invalidateQueries({ queryKey: ['story', storyId] });
          } catch {}
        }}
      />
      <ImageGenerateInsertModal
        open={imgModalOpen}
        onClose={(e)=>{
          setImgModalOpen(false);
          if (e && e.attached) {
            try {
              refetchMedia();
              queryClient.invalidateQueries({ queryKey: ['explore-stories'] });
              queryClient.invalidateQueries({ queryKey: ['top-stories-views'] });
              try { window.dispatchEvent(new CustomEvent('media:updated', { detail: { entityType: 'story', entityId: storyId } })); } catch(_) {}
              // 삽입 후 바로 보기
              const focusUrl = e?.focusUrl;
              if (focusUrl) {
                setActiveImage(focusUrl);
                setGalleryImages(prev => Array.from(new Set([focusUrl, ...prev])));
              }
            } catch (_) {}
          }
        }}
        entityType={'story'}
        entityId={storyId}
      />
      <OrigChatStartModal
        open={origModalOpen}
        onClose={() => {
          setOrigModalOpen(false);
          setPreselectedCharacterId(null);
        }}
        storyId={storyId}
        totalChapters={episodesSorted.length || 1}
        lastReadNo={Number(progressChapterNo) || 0}
        defaultSelectedCharacterId={preselectedCharacterId}
      />
      {pageToast.show && (
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 px-4 py-2 rounded-md text-sm shadow-lg ${pageToast.type==='success' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'}`}>
          {pageToast.message}
          <button className="ml-3 text-white/80 hover:text-white" onClick={()=> setPageToast({ show: false, type: 'success', message: '' })}>닫기</button>
        </div>
      )}
      {/* 전체 삭제 확인 모달 */}
      <AlertDialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>전체 삭제</AlertDialogTitle>
            <AlertDialogDescription>
              추출된 모든 등장인물을 삭제합니다. 이 작업은 되돌릴 수 없습니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex items-center justify-end gap-2">
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteAll} className="bg-red-600 hover:bg-red-700">삭제</AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
      {/* 전체 재생성 확인 모달 */}
      <AlertDialog open={confirmRebuildOpen} onOpenChange={setConfirmRebuildOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>전체 재생성</AlertDialogTitle>
            <AlertDialogDescription>
              모든 회차 텍스트를 바탕으로 등장인물을 다시 추출합니다. 시간이 걸릴 수 있습니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex items-center justify-end gap-2">
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction onClick={handleRebuildAll}>재생성</AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
};

const ExtractedCharactersGrid = ({ storyId, itemsOverride = null, onStart, maxNo = 1, isOwner = false, onCharacterClick = null }) => {
  const [items, setItems] = useState(itemsOverride || []);
  const [busyId, setBusyId] = useState(null);
  const [toast, setToast] = useState({ show: false, type: 'success', message: '' });
  const [imgModalFor, setImgModalFor] = useState(null); // { entityType, entityId }
  const maxOptions = Math.max(1, Number(maxNo)||1);
  const lastReadNo = Number(getReadingProgress(storyId) || 0);

  useEffect(() => {
    if (Array.isArray(itemsOverride)) setItems(itemsOverride);
  }, [itemsOverride]);

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {items.map((c, idx) => (
          <div 
            key={`${c.name}-${idx}`}
            className="relative bg-gray-800/40 border border-gray-700 rounded-md p-3 text-left hover:bg-gray-700/40 cursor-pointer transition-colors"
            onClick={() => {
              // 원작챗 모달 열기 + 해당 캐릭터 선택
              if (c.character_id && onCharacterClick) {
                onCharacterClick(c.character_id);
              }
            }}
          >
            <div className="flex items-center gap-3">
              {c.avatar_url ? (
                <img
                  src={(() => {
                    try {
                      const resolved = resolveImageUrl(c.avatar_url) || c.avatar_url;
                      if (!resolved) return '';
                      return `${resolved}${resolved.includes('?') ? '&' : '?'}v=${Date.now()}`;
                    } catch (_) { return c.avatar_url; }
                  })()}
                  alt={c.name}
                  className="w-10 h-10 rounded-full object-cover"
                />
              ) : (
                <div className="w-10 h-10 rounded-full bg-blue-600 text-white flex items-center justify-center text-sm font-bold">
                  {c.initial || (c.name||'')[0] || 'C'}
                </div>
              )}
              <div>
                <div className="text-white font-medium">{c.name}</div>
                <div className="text-xs text-gray-400 line-clamp-2">{c.description || ''}</div>
              </div>
            </div>
            {/* 개별 재생성 버튼 */}
            {isOwner && (
              <div className="absolute top-2 right-2 z-10 flex items-center gap-1">
                <button
                  type="button"
                  title="이 캐릭터만 다시 생성"
                  className={`w-7 h-7 rounded bg-black/70 text-white hover:bg-black/90 flex items-center justify-center ${busyId===c.id ? 'opacity-50 cursor-not-allowed' : ''}`}
                  onClick={async (e)=>{
                    e.stopPropagation();
                    if (busyId) return;
                    if (!c.id) return;
                    try {
                      setBusyId(c.id);
                      await storiesAPI.rebuildSingleExtractedCharacter(storyId, c.id);
                      // 성공 시 리스트 재조회(부분 상태 갱신보다 안전)
                      try {
                        const r = await storiesAPI.getExtractedCharacters(storyId);
                        const items = Array.isArray(r.data?.items) ? r.data.items : [];
                        setItems(items);
                        setToast({ show: true, type: 'success', message: `${c.name} 재생성 완료` });
                      } catch(_) {}
                    } catch (err) {
                      console.error('개별 재생성 실패', err);
                      setToast({ show: true, type: 'error', message: `${c.name} 재생성 실패` });
                    } finally {
                      setBusyId(null);
                    }
                  }}
                >
                  {busyId===c.id ? (
                    <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path></svg>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="w-3.5 h-3.5"><path fill="currentColor" d="M12 6V2l-5 5 5 5V8c3.31 0 6 2.69 6 6 0 1.01-.25 1.96-.69 2.8l1.46 1.46A7.932 7.932 0 0020 14c0-4.42-3.58-8-8-8zm-6.31.2A7.932 7.932 0 004 14c0 4.42 3.58 8 8 8v4l5-5-5-5v4c-3.31 0-6-2.69-6-6 0-1.01.25-1.96.69-2.8L5.23 6.2z"/></svg>
                  )}
                </button>
                <button
                  type="button"
                  title="이미지 생성/삽입"
                  className="w-7 h-7 rounded bg-black/70 text-white hover:bg-black/90 flex items-center justify-center"
                  onClick={(e)=>{ e.stopPropagation(); if (!c.character_id) return; setImgModalFor({ entityType: 'character', entityId: c.character_id }); }}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="w-3.5 h-3.5"><path fill="currentColor" d="M21 19V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14l4-4h12a2 2 0 0 0 2-2ZM8.5 11A2.5 2.5 0 1 1 11 8.5 2.5 2.5 0 0 1 8.5 11Z"/></svg>
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
      {toast.show && (
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 px-4 py-2 rounded-md text-sm shadow-lg ${toast.type==='success' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'}`}>
          {toast.message}
          <button className="ml-3 text-white/80 hover:text-white" onClick={()=> setToast({ show: false, type: 'success', message: '' })}>닫기</button>
        </div>
      )}
      {/* 이미지 생성/삽입 모달: 개별 원작챗 캐릭터용 */}
      <ImageGenerateInsertModal
        open={!!imgModalFor}
        onClose={(e)=>{
          const targetCharId = imgModalFor?.entityId;
          setImgModalFor(null);
          if (e && e.attached) {
            (async ()=>{
              try {
                // 1) 추출 목록 갱신
                const r = await storiesAPI.getExtractedCharacters(storyId);
                const items = Array.isArray(r.data?.items) ? r.data.items : [];
                // focusUrl을 즉시 UI에 반영
                const fu = e?.focusUrl || '';
                setItems(prev => {
                  if (!fu || !targetCharId) return items;
                  try {
                    return (Array.isArray(items) ? items : []).map(it => it?.character_id === targetCharId ? { ...it, avatar_url: fu } : it);
                  } catch(_) { return items; }
                });

                // 2) 프리뷰 캐시 갱신
                if (targetCharId) {
                  try {
                    const cr = await charactersAPI.getCharacter(targetCharId);
                    const ch = cr?.data || {};
                    const patched = fu ? { ...ch, avatar_url: fu } : ch;
                    setPreviewMap(m => ({ ...m, [targetCharId]: patched }));
                  } catch(_) {
                    if (fu) setPreviewMap(m => ({ ...m, [targetCharId]: { ...(m?.[targetCharId]||{}), avatar_url: fu } }));
                  }
                }
              } catch(_) {}
            })();
          }
        }}
        entityType={imgModalFor?.entityType || 'character'}
        entityId={imgModalFor?.entityId || ''}
      />
    </>
  );
};

export default StoryDetailPage;