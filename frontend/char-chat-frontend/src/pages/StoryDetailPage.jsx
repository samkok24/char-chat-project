import React, { useEffect, useMemo, useState, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import AppLayout from '../components/layout/AppLayout';
import { Button } from '../components/ui/button';
import { storiesAPI, chaptersAPI, origChatAPI } from '../lib/api';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '../components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Heart, ArrowLeft, AlertCircle, MoreVertical, Copy, Trash2, Edit, MessageCircle, Eye } from 'lucide-react';
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

const StoryDetailPage = () => {
  const { storyId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const locationState = useLocation().state || {};
  const { user, isAuthenticated } = useAuth();
  const extractedRef = useRef(null);

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

  // 갤러리 이미지 구성: cover_url + keywords의 cover: 항목들
  useEffect(() => {
    try {
      const kws = Array.isArray(story.keywords) ? story.keywords : [];
      const kwUrls = kws
        .filter((k) => typeof k === 'string' && k.startsWith('cover:'))
        .map((k) => k.replace(/^cover:/, ''))
        .filter(Boolean);
      const unique = Array.from(new Set([story.cover_url, ...kwUrls].filter(Boolean)));
      setGalleryImages(unique);
      const first = unique[0] || '';
      setActiveImage(first);
      if (first) {
        try {
          const probe = new Image();
          probe.onload = () => {
            const w = probe.naturalWidth || 1;
            const h = probe.naturalHeight || 1;
            setBaseRatio(h / w);
          };
          probe.src = resolveImageUrl(first) || first;
        } catch (_) {
          setBaseRatio(1);
        }
      } else {
        setBaseRatio(1);
      }
    } catch (_) {
      setGalleryImages([]);
      setActiveImage('');
      setBaseRatio(1);
    }
  }, [story.cover_url, story.keywords]);

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
      await origChatAPI.getContextPack(storyId, { anchor: anchorNo, characterId: effectiveCharacterId, rangeFrom: f, rangeTo: t });
      const startRes = await origChatAPI.start({ story_id: storyId, character_id: effectiveCharacterId, chapter_anchor: anchorNo, timeline_mode: 'fixed', range_from: f, range_to: t });
      const roomId = startRes.data?.id || startRes.data?.room_id;
      if (roomId) {
        navigate(`/ws/chat/${effectiveCharacterId}?source=origchat&storyId=${storyId}&anchor=${anchorNo}&rangeFrom=${f}&rangeTo=${t}`);
      } else {
        navigate(`/ws/chat/${effectiveCharacterId}`);
      }
    } catch (e) {
      console.error('원작챗 시작 실패', e);
      navigate(`/ws/chat/${characterId || story.character_id}`);
    }
  };

  const handleDeleteStory = async () => {
    if (!(user && story?.creator_id === user.id)) return;
    if (!window.confirm('작품을 삭제하시겠습니까?')) return;
    try { await storiesAPI.deleteStory(storyId); navigate('/'); } catch (_) {}
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
  const fetchExtracted = async () => {
    try {
      setCharactersLoading(true);
      const r = await storiesAPI.getExtractedCharacters(storyId);
      const items = Array.isArray(r.data?.items) ? r.data.items : [];
      setExtractedItems(items);
    } catch (_) {
      setExtractedItems([]);
    } finally {
      setCharactersLoading(false);
    }
  };
  useEffect(() => {
    fetchExtracted();
    const timer = setTimeout(() => {
      // 초회 응답이 비었어도 백엔드가 비동기로 보장 생성 중일 수 있으니 한 번 더 폴링
      if (!extractedItems || extractedItems.length === 0) {
        fetchExtracted();
      }
    }, 1200);
    return () => clearTimeout(timer);
  }, [storyId]);
  const episodesSorted = Array.isArray(chaptersResp) ? chaptersResp : [];
  const firstChapterNo = episodesSorted.length > 0 ? (episodesSorted[0]?.no || 1) : 1;
  const showContinue = Number(progressChapterNo) > 0;
  const targetReadNo = showContinue ? Number(progressChapterNo) : Number(firstChapterNo);

  return (
    <AppLayout>
      <div className="bg-gray-900 text-white min-h-screen p-4 sm:p-6 lg:p-8">
        <div className="max-w-7xl mx-auto">
          <header className="mb-6">
            <Button variant="ghost" onClick={() => {
              const fromMyGrid = Boolean(locationState.fromMyGrid);
              if (fromMyGrid) {
                navigate('/my-characters#stories');
              } else {
                navigate(-1);
              }
            }} className="mb-2">
              <ArrowLeft className="w-5 h-5 mr-2" /> 뒤로 가기
            </Button>
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
                <Button onClick={() => navigate('/')} variant="outline" className="mt-4 bg-white text-black hover:bg-white">홈으로 돌아가기</Button>
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
                  />
                ) : (
                  <div className="absolute inset-0 bg-gray-800 rounded-lg flex items-center justify-center text-gray-500">NO COVER</div>
                )}
                <div className="absolute top-2 left-2">
                  <Badge className="bg-blue-600 text-white hover:bg-blue-600">웹소설</Badge>
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
                        <AvatarImage src={story.creator_avatar_url || ''} />
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
                  <Button variant={isLiked ? 'secondary' : 'outline'} onClick={handleLike} className={isLiked ? 'bg-pink-600 hover:bg-pink-700 text-white' : ''}>
                    <Heart className={`w-4 h-4 mr-2 ${isLiked ? '' : 'text-pink-500'}`} />
                    {likeCount.toLocaleString()}
                  </Button>
                  <Button variant="outline" onClick={handleShare} className="bg-white text-black hover:bg-white">
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
                    onClick={async () => {
                      try {
                        if (!isAuthenticated) { navigate('/login'); return; }
                        if (!story.character_id) {
                          try { extractedRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (_) {}
                          alert('작품에 연결된 캐릭터가 없습니다. 아래 "주요 캐릭터"에서 캐릭터를 선택해 원작챗을 시작하세요.');
                          return;
                        }
                        // 원작챗 컨텍스트팩 프리페치(앵커: 이어보기 또는 첫화)
                        await origChatAPI.getContextPack(storyId, { anchor: targetReadNo });
                        // 방 생성(원작챗)
                        const startRes = await origChatAPI.start({ story_id: storyId, character_id: story.character_id, chapter_anchor: targetReadNo, timeline_mode: 'fixed' });
                        const roomId = startRes.data?.id || startRes.data?.room_id;
                        if (roomId) {
                          navigate(`/ws/chat/${story.character_id}?source=origchat&storyId=${storyId}&anchor=${targetReadNo}`);
                        } else {
                          navigate(`/ws/chat/${story.character_id}`);
                        }
                      } catch (e) {
                        console.error('원작챗 시작 실패', e);
                        navigate(`/ws/chat/${story.character_id}`);
                      }
                    }}
                  >
                    원작챗 시작
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
                    <Button
                      variant="outline"
                      className="h-8 px-3 bg-white text-black border-gray-300 hover:bg-white"
                      onClick={async()=>{
                        try {
                          setCharactersLoading(true);
                          await storiesAPI.rebuildExtractedCharacters(storyId);
                          await fetchExtracted();
                        } catch (e) {
                          console.error('재생성 실패', e);
                        } finally {
                          setCharactersLoading(false);
                        }
                      }}
                    >다시 생성하기</Button>
                  )}
                </div>
                {isOwner && (
                  <div className="flex items-center justify-end">
                    <Button
                      variant="destructive"
                      className="h-8 px-3"
                      onClick={async()=>{
                        if (!window.confirm('정말 전체 삭제하시겠습니까?')) return;
                        try {
                          setCharactersLoading(true);
                          await storiesAPI.deleteExtractedCharacters(storyId);
                          await fetchExtracted();
                        } catch (e) {
                          console.error('전체 삭제 실패', e);
                        } finally {
                          setCharactersLoading(false);
                        }
                      }}
                    >전체 삭제</Button>
                  </div>
                )}
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
                  <div className="flex items-center justify-between bg-gray-800/40 border border-gray-700 rounded-md p-3">
                    <span className="text-sm text-gray-400">아직 등장인물이 준비되지 않았습니다.</span>
                    <Button variant="outline" className="h-8 px-3" onClick={fetchExtracted}>다시 불러오기</Button>
                  </div>
                )}
                {!charactersLoading && extractedItems.length > 0 && (
                  <ExtractedCharactersGrid
                    storyId={storyId}
                    itemsOverride={extractedItems}
                    maxNo={episodesSorted.length || 1}
                    onStart={(payload)=>handleStartOrigChatWithRange(payload)}
                  />
                )}
              </section>

              {/* 회차 섹션 (UI 우선) */}
              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold">회차</h2>
                  <div className="flex items-center gap-2">
                    {episodesSorted.length > 0 && (
                      <Button variant="outline" className="h-8 px-3 bg-white text-black border-gray-300 hover:bg-white" onClick={() => setSortDesc((v)=>!v)}>{sortDesc ? '최신순' : '오름차순'}</Button>
                    )}
                    {locationState.fromMyGrid && (
                      <Button variant="outline" className="h-8 px-3 bg-white text-black border-gray-300 hover:bg-white" onClick={() => navigate(`/story-importer?storyId=${storyId}`)}>회차등록</Button>
                    )}
                  </div>
                </div>
                {episodesSorted.length > 0 ? (
                  <ul className="divide-y divide-gray-800 rounded-md border border-gray-700 overflow-hidden">
                    {episodesSorted.map((ch, idx) => (
                      <li
                        key={`${ch.id || ch.no || idx}-${ch.title}`}
                        className={`flex items-center justify-between bg-gray-800/30 px-3 py-2 cursor-pointer hover:bg-gray-700/40 ${Number(ch.no) === Number(progressChapterNo) ? 'ring-1 ring-purple-500/40 bg-gray-800/50' : ''}`}
                        onClick={() => navigate(`/stories/${storyId}/chapters/${ch.no || (idx + 1)}`)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/stories/${storyId}/chapters/${ch.no || (idx + 1)}`); }}
                      >
                        <div className="text-sm text-gray-200 truncate">
                          <span className="truncate max-w-[60vw] lg:max-w-[40vw]">{ch.title || '제목 없음'}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="inline-flex items-center gap-1 text-xs text-gray-500"><Eye className="w-3 h-3" />{Number(ch.view_count || 0).toLocaleString()}</span>
                          <span className="text-xs text-gray-500 hidden sm:inline">{ch.created_at ? new Date(ch.created_at).toLocaleDateString() : ''}</span>
                        </div>
                      </li>
                    ))}
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
    </AppLayout>
  );
};

const ExtractedCharactersGrid = ({ storyId, itemsOverride = null, onStart, maxNo = 1 }) => {
  const [items, setItems] = useState(itemsOverride || []);
  const [openId, setOpenId] = useState(null);
  const [profileOpenId, setProfileOpenId] = useState(null);
  const [fromNo, setFromNo] = useState('1');
  const [toNo, setToNo] = useState('1');
  const [rangeMode, setRangeMode] = useState('multi'); // 'multi' | 'single'
  const [didInit, setDidInit] = useState(false);
  const maxOptions = Math.max(1, Number(maxNo)||1);
  const lastReadNo = Number(getReadingProgress(storyId) || 0);

  useEffect(() => {
    if (Array.isArray(itemsOverride)) setItems(itemsOverride);
  }, [itemsOverride]);

  // 기본값 세팅: from=1, to=마지막으로 본 회차(없으면 현재 연재된 회차)
  useEffect(() => {
    if (didInit) return;
    const defaultFrom = '1';
    const defaultTo = String(Math.min(maxOptions, lastReadNo > 0 ? lastReadNo : maxOptions));
    setFromNo(defaultFrom);
    setToNo(defaultTo);
    setDidInit(true);
  }, [didInit, maxOptions, lastReadNo]);

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
      {items.map((c, idx) => (
        <Dialog key={`${c.name}-${idx}`} open={openId===idx} onOpenChange={(v)=> setOpenId(v?idx:null)}>
          <DialogTrigger asChild>
            <button className="bg-gray-800/40 border border-gray-700 rounded-md p-3 text-left hover:bg-gray-700/40">
              <div className="flex items-center gap-3">
                {c.avatar_url ? (
                  <img src={c.avatar_url} alt={c.name} className="w-10 h-10 rounded-full object-cover" />
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
            </button>
          </DialogTrigger>
          <DialogContent className="bg-gray-900 text-white border border-gray-700">
            <DialogHeader>
              <DialogTitle className="text-white">원작챗 시작 - {c.name}</DialogTitle>
              <div className="sr-only" id={`dlg-desc-${idx}`}>회차 범위 선택 모달</div>
            </DialogHeader>
            <div className="space-y-3" aria-describedby={`dlg-desc-${idx}`} role="document">
              {/* 프로필 보기 버튼 */}
              {c.character_id && (
                <div className="flex justify-end">
                  <Button
                    variant="outline"
                    className="h-8 px-3 bg-white text-black border-gray-300 hover:bg-white"
                    onClick={()=> setProfileOpenId(idx)}
                  >프로필 보기</Button>
                </div>
              )}
              <div className="text-sm text-gray-300">회차 범위를 선택하세요 (예: 1~6, 4~35)</div>
              <div className="text-xs text-gray-400">
                마지막까지 본 회차는 {lastReadNo > 0 ? `${lastReadNo}화` : '없습니다'}.
              </div>
              {/* 범위 모드 토글 */}
              <div className="flex items-center gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => setRangeMode('multi')}
                  className={`px-3 py-1 rounded-full border ${rangeMode==='multi' ? 'bg-blue-600 text-white border-blue-500' : 'bg-gray-800 text-gray-300 border-gray-700'}`}
                >여러 회차(기본)</button>
                <button
                  type="button"
                  onClick={() => setRangeMode('single')}
                  className={`px-3 py-1 rounded-full border ${rangeMode==='single' ? 'bg-blue-600 text-white border-blue-500' : 'bg-gray-800 text-gray-300 border-gray-700'}`}
                >단일 회차</button>
              </div>

              <div className="flex items-center gap-2">
                <Select value={fromNo} onValueChange={(v)=>{ setFromNo(v); if (rangeMode==='single') setToNo(v); }}>
                  <SelectTrigger className="w-28 bg-gray-800 border-gray-700"><SelectValue placeholder="From" /></SelectTrigger>
                  <SelectContent className="bg-gray-800 text-white border-gray-700 max-h-64 overflow-auto">
                    {Array.from({length:maxOptions}).map((_,i)=> (
                      <SelectItem key={`f-${i+1}`} value={`${i+1}`}>{i+1}화</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span className="text-gray-400">~</span>
                <Select value={toNo} onValueChange={setToNo} disabled={rangeMode==='single'}>
                  <SelectTrigger className={`w-28 border ${rangeMode==='single' ? 'bg-gray-800/50 border-gray-700 opacity-70 cursor-not-allowed' : 'bg-gray-800 border-gray-700'}`}><SelectValue placeholder="To" /></SelectTrigger>
                  <SelectContent className="bg-gray-800 text-white border-gray-700 max-h-64 overflow-auto">
                    {Array.from({length:maxOptions}).map((_,i)=> (
                      <SelectItem key={`t-${i+1}`} value={`${i+1}`}>{i+1}화</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {/* 경고 문구: 마지막 읽은 회차를 초과 선택 시 */}
              {(() => {
                const f = Number(fromNo)||1; const t = Number(toNo)||f;
                const beyond = (f > (lastReadNo||0)) || (t > (lastReadNo||0));
                return beyond ? (
                  <div className="text-xs text-yellow-400">마지막까지 본 회차({lastReadNo>0?`${lastReadNo}화`:'없음'}) 이후를 선택했습니다. 스포일러는 가드에 의해 제한됩니다.</div>
                ) : null;
              })()}
              <div className="flex justify-end">
                <Button
                  className="bg-red-600 hover:bg-red-700 text-white"
                  onClick={()=>{
                    const f = Math.max(1, Number(fromNo)||1);
                    const tCandidate = rangeMode==='single' ? f : (Number(toNo)||f);
                    const t = Math.max(f, tCandidate);
                    const cappedF = Math.min(f, maxOptions);
                    const cappedT = Math.min(t, maxOptions);
                    onStart?.({ characterName: c.name, characterId: c.character_id || null, range_from: cappedF, range_to: cappedT });
                    setOpenId(null);
                  }}
                >확인</Button>
              </div>
            </div>
          </DialogContent>
          {/* 캐릭터 프로필 미니 모달 */}
          {profileOpenId===idx && c.character_id && (
            <Dialog open={true} onOpenChange={(v)=> { if(!v) setProfileOpenId(null); }}>
              <DialogContent className="bg-gray-900 text-white border border-gray-700 max-w-lg">
                <DialogHeader>
                  <DialogTitle className="text-white">프로필 - {c.name}</DialogTitle>
                </DialogHeader>
                <div className="space-y-3">
                  <CharacterProfileInline characterId={c.character_id} />
                  <div className="flex justify-end">
                    <Button onClick={()=> setProfileOpenId(null)} className="bg-gray-700 hover:bg-gray-600">닫기</Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          )}
        </Dialog>
      ))}
    </div>
  );
};

export default StoryDetailPage;


