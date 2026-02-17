/**
 * 내 캐릭터 목록 페이지
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../contexts/AuthContext';
import { charactersAPI, usersAPI, storiesAPI } from '../lib/api';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '../components/ui/avatar';
import { Alert, AlertDescription } from '../components/ui/alert';
import { LazyLoadImage } from 'react-lazy-load-image-component';
import 'react-lazy-load-image-component/src/effects/blur.css';
import { Skeleton } from '../components/ui/skeleton';
import { resolveImageUrl } from '../lib/images';
import { 
  ArrowLeft,
  Plus,
  Edit,
  Trash2,
  MessageCircle,
  Heart,
  Lock,
  Globe,
  Loader2,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  BookOpen,
} from 'lucide-react';
import { formatCount } from '../lib/format';
import { replacePromptTokens } from '../lib/prompt';
import { clearCreateCharacterDraft, hasCreateCharacterDraft } from '../lib/createCharacterDraft';
import AppLayout from '../components/layout/AppLayout';
import { CharacterCard as SharedCharacterCard, CharacterCardSkeleton as SharedCharacterCardSkeleton } from '../components/CharacterCard';
import StoryExploreCard from '../components/StoryExploreCard';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/tabs';
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogAction, AlertDialogCancel, AlertDialogFooter } from '../components/ui/alert-dialog';

const PAGE_SIZE = 24;

const PaginationControls = ({
  page,
  onPrev,
  onNext,
  onSelectPage,
  disablePrev,
  disableNext,
  maxPageHint,
}) => {
  const resolvedMax = Math.max(maxPageHint || page, page);
  const displayMax = Math.max(resolvedMax, 4);
  const startPage = Math.max(1, Math.min(page - 1, displayMax - 3));
  const endPage = Math.min(displayMax, startPage + 3);
  const pages = [];
  for (let p = startPage; p <= endPage; p += 1) {
    pages.push(p);
  }

  return (
    <div className="flex justify-center items-center mt-8 mb-4">
      <div className="flex items-center gap-1.5">
        <Button
          variant="ghost"
          size="sm"
          onClick={onPrev}
          disabled={disablePrev}
          className={`w-8 h-8 p-0 rounded-md transition-all ${
            disablePrev
              ? 'text-gray-600 opacity-40 cursor-not-allowed'
              : 'text-gray-300 hover:text-white hover:bg-gray-800'
          }`}
        >
          <ChevronLeft className="w-4 h-4" />
        </Button>
        {pages.map((p) => (
          <Button
            key={p}
            variant="ghost"
            size="sm"
            onClick={() => {
              if (p > resolvedMax || p === page) return;
              onSelectPage?.(p);
            }}
            disabled={p === page || p > resolvedMax}
            className={`min-w-[32px] h-8 px-3 rounded-md text-sm transition-all ${
              p === page
                ? 'bg-gradient-to-r from-purple-600 to-blue-600 text-white font-semibold shadow-[0_4px_20px_rgba(104,63,204,0.4)] hover:from-purple-600 hover:to-blue-600'
                : p > resolvedMax
                  ? 'text-gray-600 opacity-40 cursor-not-allowed font-medium'
                  : 'text-gray-300 font-medium hover:text-white hover:bg-gray-800'
            }`}
          >
            {p}
          </Button>
        ))}
        <Button
          variant="ghost"
          size="sm"
          onClick={onNext}
          disabled={disableNext}
          className={`w-8 h-8 p-0 rounded-md transition-all ${
            disableNext
              ? 'text-gray-600 opacity-40 cursor-not-allowed'
              : 'text-gray-300 hover:text-white hover:bg-gray-800'
          }`}
        >
          <ChevronRight className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
};

// 좋아요한 캐릭터 탭 컴포넌트
const FavoritesTab = () => {
  const [page, setPage] = useState(1);
  const [maxPageHint, setMaxPageHint] = useState(1);
  const { data: liked = [], isLoading, isError, isFetching } = useQuery({
    queryKey: ['liked-characters-page', page],
    queryFn: async () => {
      const response = await usersAPI.getLikedCharacters({ limit: PAGE_SIZE, page });
      return response.data || [];
    },
    keepPreviousData: true,
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });

  const items = Array.isArray(liked) ? liked : [];
  const hasNext = items.length === PAGE_SIZE;

  useEffect(() => {
    if (!isLoading && !isFetching) {
      setMaxPageHint((prev) => Math.max(prev, hasNext ? page + 1 : page));
    }
  }, [hasNext, isLoading, isFetching, page]);

  useEffect(() => {
    if (!isFetching && !isLoading && page > 1 && items.length === 0) {
      setPage((prev) => Math.max(1, prev - 1));
    }
  }, [items, isFetching, isLoading, page]);

  const handlePrev = () => setPage((prev) => Math.max(1, prev - 1));
  const handleNext = () => {
    if (hasNext) setPage((prev) => prev + 1);
  };

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3 mt-4">
        {Array.from({ length: 12 }).map((_, i) => (
          <SharedCharacterCardSkeleton key={i} />
        ))}
      </div>
    );
  }
  if (isError) {
    return (
      <div className="text-red-400 mb-4">관심 캐릭터를 불러오지 못했습니다.</div>
    );
  }
  if (!items.length) {
    return <div className="text-gray-400 mt-4">좋아요한 캐릭터가 없습니다.</div>;
  }
  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3 mt-4">
        {items.map((c) => (
          <SharedCharacterCard key={c.id} character={c} showNewBadge={false} />
        ))}
      </div>
      <PaginationControls
        page={page}
        onPrev={handlePrev}
        onNext={handleNext}
        onSelectPage={(p) => setPage(p)}
        disablePrev={page === 1 || isFetching}
        disableNext={!hasNext || isFetching}
        maxPageHint={maxPageHint}
      />
    </>
  );
};

// 메인 UI와 통일을 위해 공용 레이아웃/카드 컴포넌트 사용 (중복 방지)

const MyCharactersPage = () => {
  const [characters, setCharacters] = useState([]);
  const [loading, setLoading] = useState(false);
  const [minePage, setMinePage] = useState(1);
  const [mineHasNext, setMineHasNext] = useState(false);
  const [mineMaxPageHint, setMineMaxPageHint] = useState(1);
  const [error, setError] = useState('');
  // 선택삭제(내 캐릭터 탭)
  const [selectModeChars, setSelectModeChars] = useState(false);
  const [selectedCharIds, setSelectedCharIds] = useState(new Set());
  const [isBulkDeletingChars, setIsBulkDeletingChars] = useState(false);
  const [doneModal, setDoneModal] = useState({ open: false, message: '' });
  const [draftPromptOpen, setDraftPromptOpen] = useState(false);

  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const handleCreateCharacterClick = useCallback((e) => {
    try { e?.preventDefault?.(); } catch (_) {}
    try {
      if (hasCreateCharacterDraft()) {
        setDraftPromptOpen(true);
        return;
      }
    } catch (_) {}
    navigate('/characters/create');
  }, [navigate]);

  const handleDraftStartFresh = useCallback(() => {
    try { clearCreateCharacterDraft(); } catch (_) {}
    try { setDraftPromptOpen(false); } catch (_) {}
    try { navigate('/characters/create'); } catch (_) {}
  }, [navigate]);

  const handleDraftLoad = useCallback(() => {
    try { setDraftPromptOpen(false); } catch (_) {}
    try { navigate('/characters/create'); } catch (_) {}
  }, [navigate]);

  const resolveTabFromHash = useCallback((hash) => {
    switch (hash) {
      case '#favorites':
        return 'favorites';
      case '#mine':
        return 'mine';
      case '#stories':
        return 'stories';
      case '#origchat':
        return 'origchat';
      default:
        return 'favorites';
    }
  }, []);
  const [activeTab, setActiveTab] = useState(() =>
    resolveTabFromHash(
      typeof window !== 'undefined' ? window.location.hash : '',
    ),
  );

  const loadMyCharacters = useCallback(async (targetPage = 1) => {
    setLoading(true);
    try {
      const skip = (targetPage - 1) * PAGE_SIZE;
      const response = await charactersAPI.getMyCharacters({ only: 'regular', limit: PAGE_SIZE, skip });
      const list = Array.isArray(response.data) ? response.data : [];
      setCharacters(list);
      const hasNext = list.length === PAGE_SIZE;
      setMineHasNext(hasNext);
      setMineMaxPageHint((prev) => Math.max(prev, hasNext ? targetPage + 1 : targetPage));
      setError('');
    } catch (err) {
      console.error('내 캐릭터 목록 로드 실패:', err);
      setError('캐릭터 목록을 불러올 수 없습니다.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // ✅ 성능 최적화: "내가 만든 캐릭터" 탭 진입시에만 내 캐릭터 목록을 로드한다.
    if (activeTab !== 'mine') return;
    loadMyCharacters(minePage);
  }, [activeTab, loadMyCharacters, minePage]);

  useEffect(() => {
    if (activeTab !== 'mine') return;
    if (!loading && minePage > 1 && characters.length === 0) {
      setMinePage((prev) => Math.max(1, prev - 1));
    }
  }, [activeTab, characters, loading, minePage]);

  useEffect(() => {
    setSelectedCharIds(new Set());
    setSelectModeChars(false);
  }, [minePage]);

  const deleteCharacter = async (characterId) => {
    if (!window.confirm('정말로 이 캐릭터를 삭제하시겠습니까?')) {
      return;
    }

    try {
      await charactersAPI.deleteCharacter(characterId);
      await loadMyCharacters(minePage);
      // 홈/탐색 섹션 즉시 갱신
      try {
        const qc = queryClient;
        qc.invalidateQueries({ queryKey: ['top-origchat-daily'] });
        qc.invalidateQueries({ queryKey: ['webnovel-characters'] });
        qc.invalidateQueries({ queryKey: ['characters'] });
        qc.invalidateQueries({ queryKey: ['liked-characters'] });
        qc.invalidateQueries({ queryKey: ['explore-stories'] });
      } catch (_) {}
    } catch (err) {
      console.error('캐릭터 삭제 실패:', err);
      alert('캐릭터 삭제에 실패했습니다.');
    }
  };

  const toggleSelectChar = (id) => {
    setSelectedCharIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const bulkDeleteChars = async () => {
    if (selectedCharIds.size === 0) return;
    if (!window.confirm(`${selectedCharIds.size}개의 캐릭터를 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.`)) return;
    setIsBulkDeletingChars(true);
    const ids = Array.from(selectedCharIds);
    let success = 0, failed = 0;
    for (const id of ids) {
      try { await charactersAPI.deleteCharacter(id); success += 1; }
      catch (_) { failed += 1; }
    }
    setSelectedCharIds(new Set());
    setSelectModeChars(false);
    setIsBulkDeletingChars(false);
    await loadMyCharacters(minePage);
    setDoneModal({ open: true, message: failed ? `${success}개 삭제, ${failed}개 실패` : `${success}개 삭제 완료` });
  };

  const CharacterCard = ({ character }) => (
    <Card className="hover:shadow-lg transition-all duration-200 flex flex-col">
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="flex items-start space-x-3">
            <Avatar className="w-12 h-12">
              <LazyLoadImage
                alt={character.name}
                src={resolveImageUrl(character.avatar_url)}
                effect="blur"
                className="w-full h-full object-cover rounded-full"
                wrapperClassName="w-full h-full"
              />
              <AvatarFallback className="bg-gradient-to-r from-purple-500 to-blue-500 text-white">
                {character.name.charAt(0)}
              </AvatarFallback>
            </Avatar>
            <div>
              <CardTitle className="text-lg">{character.name}</CardTitle>
              <div className="flex items-center space-x-2 mt-1">
                {character.is_public ? (
                  <Badge variant="outline" className="text-green-600 border-green-600">
                    <Globe className="w-3 h-3 mr-1" />
                    공개
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-gray-600 border-gray-600">
                    <Lock className="w-3 h-3 mr-1" />
                    비공개
                  </Badge>
                )}
              </div>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col justify-between">
        <div>
          <p className="text-sm text-gray-600 mb-4 line-clamp-2 min-h-[40px]">
            {(() => {
              const nm = character?.name || '캐릭터';
              const raw = character?.description || '';
              const rendered = replacePromptTokens(raw, { assistantName: nm, userName: '당신' }).trim();
              return rendered || '설명이 없습니다.';
            })()}
          </p>
          
          <div className="flex items-center space-x-4 text-sm text-gray-500 mb-4">
            <div className="flex items-center space-x-1">
              <MessageCircle className="w-4 h-4" />
              <span>{formatCount(character.chat_count || 0)} 대화</span>
            </div>
            <div className="flex items-center space-x-1">
              <Heart className="w-4 h-4" />
              <span>{character.like_count || 0} 좋아요</span>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between pt-4 border-t">
          <div className="flex items-center space-x-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate(`/characters/${character.id}`)}
            >
              보기
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate(`/characters/${character.id}/edit`)}
            >
              <Edit className="w-4 h-4 mr-1" />
              수정
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => deleteCharacter(character.id)}
              className="text-red-600 hover:text-red-700"
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
          <Button
            size="sm"
            onClick={() => navigate(`/characters/${character.id}`)} // 상세 페이지로 이동하도록 수정
            className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700"
          >
            <MessageCircle className="w-4 h-4 mr-1" />
            대화
          </Button>
        </div>
      </CardContent>
    </Card>
  );

  const CharacterCardSkeleton = () => (
    <Card>
      <CardHeader>
        <div className="flex items-start space-x-3">
          <Skeleton className="w-12 h-12 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-2 mb-4">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
        </div>
        <div className="flex items-center justify-between pt-4 border-t">
          <div className="flex items-center space-x-2">
            <Skeleton className="h-8 w-16" />
            <Skeleton className="h-8 w-16" />
            <Skeleton className="h-8 w-8" />
          </div>
          <Skeleton className="h-8 w-24" />
        </div>
      </CardContent>
    </Card>
  );

  const isStoryContext = activeTab === 'stories' || activeTab === 'origchat';

  const renderPrimaryAction = () => {
    if (isStoryContext) {
      return (
        <Link
          to="/works/create"
          className="flex w-full sm:w-auto items-center justify-center px-4 py-2.5 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors font-medium text-sm"
        >
          <BookOpen className="w-5 h-5 mr-2" />
          원작 쓰기
        </Link>
      );
    }
    return (
      <Link
        to="/characters/create"
        onClick={handleCreateCharacterClick}
        className="flex w-full sm:w-auto items-center justify-center px-4 py-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-colors font-medium text-sm shadow-lg"
      >
        <Plus className="w-5 h-5 mr-2" />
        캐릭터 생성
      </Link>
    );
  };

  const handleTabChange = (value) => {
    setActiveTab(value);
    try {
      if (typeof window !== 'undefined') {
        const basePath = `${window.location.pathname}${window.location.search || ''}`;
        window.history.replaceState(
          null,
          '',
          value === 'favorites' ? basePath : `${basePath}#${value}`,
        );
      }
    } catch (_) {
      // no-op
    }
  };

  if (loading) {
    return (
      <AppLayout>
        <div className="min-h-full bg-gray-900 text-gray-200">
          <main className="px-4 sm:px-8 py-4 sm:py-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
              <div className="flex items-center gap-3">
                <Button
                  variant="ghost"
                  onClick={() => navigate('/dashboard')}
                  className="p-2 rounded-full text-gray-300 hover:text-white hover:bg-gray-800"
                >
                  <ArrowLeft className="w-5 h-5" />
                </Button>
                <h2 className="text-xl font-normal text-white">내 캐릭터</h2>
              </div>
              <Skeleton className="h-10 w-40" />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
              {Array.from({ length: 12 }).map((_, i) => (
                <SharedCharacterCardSkeleton key={i} />
              ))}
            </div>
          </main>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="min-h-full bg-gray-900 text-gray-200">
      {/* 메인 컨텐츠 */}
      <main className="px-4 sm:px-8 py-4 sm:py-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              onClick={() => navigate('/dashboard')}
              className="p-2 rounded-full text-gray-300 hover:text-white hover:bg-gray-800"
            >
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <h2 className="text-xl font-normal text-white">내 캐릭터</h2>
          </div>
          {renderPrimaryAction()}
        </div>

        <Tabs value={activeTab} onValueChange={handleTabChange} className="mt-2">
          <TabsList className="bg-gray-800 border border-gray-700 w-full sm:w-fit">
            <TabsTrigger value="favorites" className="text-xs sm:text-sm text-gray-200 data-[state=active]:bg-yellow-500 data-[state=active]:text-black">
              <span className="sm:hidden">좋아요</span>
              <span className="hidden sm:inline">내가 좋아하는 캐릭터</span>
            </TabsTrigger>
            <TabsTrigger value="mine" className="text-xs sm:text-sm text-gray-200 data-[state=active]:bg-yellow-500 data-[state=active]:text-black">
              <span className="sm:hidden">내 캐릭터</span>
              <span className="hidden sm:inline">내가 만든 캐릭터</span>
            </TabsTrigger>
            <TabsTrigger value="stories" className="text-xs sm:text-sm text-gray-200 data-[state=active]:bg-yellow-500 data-[state=active]:text-black">
              <span className="sm:hidden">내 작품</span>
              <span className="hidden sm:inline">내가 쓴 작품</span>
            </TabsTrigger>
            <TabsTrigger value="origchat" className="text-xs sm:text-sm text-gray-200 data-[state=active]:bg-yellow-500 data-[state=active]:text-black">
              <span className="sm:hidden">원작챗</span>
              <span className="hidden sm:inline">내가 만든 원작챗</span>
            </TabsTrigger>
          </TabsList>
          {/* 내가 좋아하는 캐릭터 탭 */}
          <TabsContent value="favorites">
            <FavoritesTab />
          </TabsContent>
          {/* 내가 만든 캐릭터 탭 */}
          <TabsContent value="mine">
            {error && (<div className="text-red-400 mb-4">{error}</div>)}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mt-2">
              <div className="text-sm text-gray-400">총 {characters.length.toLocaleString()}개</div>
              <div className="flex items-center gap-2 w-full sm:w-auto">
                <Button className="flex-1 sm:flex-none" variant="outline" size="sm" disabled={isBulkDeletingChars} onClick={()=> setSelectModeChars(v=>!v)}>{selectModeChars ? '선택 해제' : '선택'}</Button>
                <Button size="sm" className="flex-1 sm:flex-none bg-red-600 hover:bg-red-700 disabled:opacity-50" disabled={!selectModeChars || selectedCharIds.size===0 || isBulkDeletingChars} onClick={bulkDeleteChars}>
                  선택삭제 ({selectedCharIds.size})
                </Button>
              </div>
            </div>
            {characters.length > 0 ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3 mt-4">
                {characters.map((character) => (
                  <div key={character.id} className="relative group" onClick={() => { if (!selectModeChars) navigate(`/characters/${character.id}`, { state: { fromMyGrid: true } }); }}>
                    {selectModeChars && (
                      <label className="absolute top-2 right-2 z-20 inline-flex items-center gap-1 bg-black/60 backdrop-blur-sm text-white text-xs px-2 py-1 rounded-md ring-1 ring-white/20 shadow-sm cursor-pointer">
                        <input className="w-4 h-4" disabled={isBulkDeletingChars} type="checkbox" checked={selectedCharIds.has(character.id)} onChange={()=>toggleSelectChar(character.id)} /> 선택
                      </label>
                    )}
                    <SharedCharacterCard character={character} showNewBadge={false} />
                    <div className="absolute top-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        title="수정"
                        className="w-7 h-7 rounded bg-black/70 text-white hover:bg-black/90 flex items-center justify-center"
                        disabled={isBulkDeletingChars}
                        onClick={(e)=>{ e.stopPropagation(); if (!selectModeChars && !isBulkDeletingChars) navigate(`/characters/${character.id}/edit`); }}
                      >
                        <Edit className="w-3.5 h-3.5" />
                      </button>
                      <button
                        title="삭제"
                        className="w-7 h-7 rounded bg-black/70 text-white hover:bg-black/90 flex items-center justify-center"
                        disabled={isBulkDeletingChars}
                        onClick={(e)=>{ e.stopPropagation(); if (!selectModeChars && !isBulkDeletingChars) deleteCharacter(character.id); }}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-16">
                <MessageCircle className="w-16 h-16 text-gray-500 mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-white mb-2">아직 만든 캐릭터가 없습니다</h3>
                <p className="text-gray-400 mb-6">나만의 AI 캐릭터를 만들어 특별한 대화를 시작해보세요!</p>
                <Button
                  onClick={handleCreateCharacterClick}
                  className="bg-purple-600 text-white px-4 py-2 rounded-lg font-medium border-0 transition-none hover:bg-purple-600"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  첫 캐릭터 만들기
                </Button>
              </div>
            )}
            {characters.length > 0 && (
              <PaginationControls
                page={minePage}
                onPrev={() => setMinePage((prev) => Math.max(1, prev - 1))}
                onNext={() => { if (mineHasNext) setMinePage((prev) => prev + 1); }}
                onSelectPage={(p) => setMinePage(p)}
                disablePrev={minePage === 1 || loading}
                disableNext={!mineHasNext || loading}
                maxPageHint={mineMaxPageHint}
              />
            )}
          </TabsContent>

          {/* 내가 쓴 작품 탭 */}
          <TabsContent value="stories">
            <MyStoriesTab />
          </TabsContent>

          {/* 내가 만든 원작챗 탭 */}
          <TabsContent value="origchat">
            <MyOrigChatTab />
          </TabsContent>
        </Tabs>
        <AlertDialog open={doneModal.open} onOpenChange={(v)=> setDoneModal(prev => ({ ...prev, open: v }))}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>삭제되었습니다</AlertDialogTitle>
              <AlertDialogDescription>{doneModal.message || '선택 항목이 삭제되었습니다.'}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogAction onClick={()=> setDoneModal({ open: false, message: '' })}>확인</AlertDialogAction>
          </AlertDialogContent>
        </AlertDialog>
        <AlertDialog open={draftPromptOpen} onOpenChange={setDraftPromptOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>임시저장된 초안을 찾았어요</AlertDialogTitle>
              <AlertDialogDescription>
                이어서 불러오시겠어요? 새로 만들기를 선택하면 기존 임시저장은 삭제됩니다.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={handleDraftLoad}>불러오기</AlertDialogCancel>
              <AlertDialogAction onClick={handleDraftStartFresh}>새로 만들기</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </main>
    </div>
    </AppLayout>
  );
};

// 내가 쓴 작품 탭 컴포넌트
const MyStoriesTab = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const [doneModal, setDoneModal] = useState({ open: false, message: '' });
  const [page, setPage] = useState(1);
  const skip = (page - 1) * PAGE_SIZE;
  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ['my-stories', page],
    queryFn: async () => {
      const res = await storiesAPI.getMyStories({ limit: PAGE_SIZE, skip });
      const items = Array.isArray(res.data?.stories) ? res.data.stories : [];
      const apiTotal = typeof res.data?.total === 'number' ? res.data.total : undefined;
      const fallbackTotal = skip + items.length + (items.length === PAGE_SIZE ? PAGE_SIZE : 0);
      return { items, total: apiTotal ?? fallbackTotal };
    },
    keepPreviousData: true,
  });
  const stories = data?.items || [];
  const total = data?.total || 0;
  const totalPages = Math.max(1, Math.ceil(Math.max(total, page * PAGE_SIZE) / PAGE_SIZE));
  const hasNext = page < totalPages;

  useEffect(() => {
    if (!isFetching && !isLoading && page > 1 && stories.length === 0) {
      setPage((prev) => Math.max(1, prev - 1));
    }
  }, [stories, isFetching, isLoading, page]);

  useEffect(() => {
    setSelectedIds(new Set());
    setSelectMode(false);
  }, [page]);

  const handleDelete = async (id) => {
    if (!window.confirm('작품을 삭제하시겠습니까?')) return;
    try {
      await storiesAPI.deleteStory(id);
      // 내 리스트 즉시 갱신
      refetch();
      // 홈 화면 섹션들 강제 갱신
      queryClient.invalidateQueries({ queryKey: ['top-stories-views'] });
      queryClient.invalidateQueries({ queryKey: ['explore-stories'] });
    } catch (_) {}
  };

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3 mt-4">
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} className="bg-gray-800 rounded-xl h-[280px] border border-gray-700" />
        ))}
      </div>
    );
  }
  if (isError) {
    return <div className="text-red-400 mt-4">내가 쓴 작품을 불러오지 못했습니다.</div>;
  }
  if (!stories.length) {
    return <div className="text-gray-400 mt-4">아직 작성한 작품이 없습니다.</div>;
  }

  return (
    <>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-end gap-2 mb-2">
        <Button className="w-full sm:w-auto" variant="outline" size="sm" onClick={()=> setSelectMode(v=>!v)}>{selectMode ? '선택 해제' : '선택'}</Button>
        <Button size="sm" className="w-full sm:w-auto bg-red-600 hover:bg-red-700 disabled:opacity-50" disabled={!selectMode || selectedIds.size===0 || isBulkDeleting}
          onClick={async()=>{
            if (!window.confirm(`${selectedIds.size}개의 작품을 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.`)) return;
            setIsBulkDeleting(true);
            let success=0, failed=0;
            for (const id of Array.from(selectedIds)) { try { await storiesAPI.deleteStory(id); success+=1; } catch(_) { failed+=1; } }
            await refetch();
            setSelectedIds(new Set());
            setSelectMode(false);
            setIsBulkDeleting(false);
            queryClient.invalidateQueries({ queryKey: ['explore-stories'] });
            queryClient.invalidateQueries({ queryKey: ['top-stories-views'] });
            setDoneModal({ open: true, message: failed ? `${success}개 삭제, ${failed}개 실패` : `${success}개 삭제 완료` });
          }}>
          선택삭제 ({selectedIds.size})
        </Button>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3 mt-4">
        {stories.map(story => (
          <div key={story.id} className="relative group" onClick={()=>{ if(!selectMode) navigate(`/stories/${story.id}`, { state: { fromMyGrid: true } }); }}>
            {selectMode && (
              <label className="absolute top-2 right-2 z-20 inline-flex items-center gap-1 bg-black/60 backdrop-blur-sm text-white text-xs px-2 py-1 rounded-md ring-1 ring-white/20 shadow-sm cursor-pointer">
                <input className="w-4 h-4" disabled={isBulkDeleting} type="checkbox" checked={selectedIds.has(story.id)} onChange={()=> setSelectedIds(prev=>{ const next=new Set(prev); if(next.has(story.id)) next.delete(story.id); else next.add(story.id); return next; })} /> 선택
              </label>
            )}
            <StoryExploreCard story={story} />
            <div className="absolute top-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                title="수정"
                className="w-7 h-7 rounded bg-black/70 text-white hover:bg-black/90 flex items-center justify-center"
                disabled={isBulkDeleting}
                onClick={(e)=>{ e.stopPropagation(); if(!selectMode && !isBulkDeleting) navigate(`/stories/${story.id}/edit`); }}
              >
                <Edit className="w-3.5 h-3.5" />
              </button>
              <button
                title="삭제"
                className="w-7 h-7 rounded bg-black/70 text-white hover:bg-black/90 flex items-center justify-center"
                disabled={isBulkDeleting}
                onClick={(e)=>{ e.stopPropagation(); if(!selectMode && !isBulkDeleting) handleDelete(story.id); }}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>
      <PaginationControls
        page={page}
        onPrev={() => setPage((prev) => Math.max(1, prev - 1))}
        onNext={() => { if (hasNext) setPage((prev) => prev + 1); }}
        onSelectPage={(p) => setPage(p)}
        disablePrev={page === 1 || isFetching}
        disableNext={!hasNext || isFetching}
        maxPageHint={totalPages}
      />
    </>
  );
};

const MyOrigChatTab = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [page, setPage] = useState(1);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const [maxPageHint, setMaxPageHint] = useState(1);
  const skip = (page - 1) * PAGE_SIZE;
  const { data = [], isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ['my-origchat-chars', page],
    queryFn: async () => {
      const res = await charactersAPI.getMyCharacters({ only: 'origchat', limit: PAGE_SIZE, skip });
      const list = Array.isArray(res.data) ? res.data : [];
      return list;
    },
    keepPreviousData: true,
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });
  const items = Array.isArray(data) ? data : [];
  const hasNext = items.length === PAGE_SIZE;

  useEffect(() => {
    if (!isLoading && !isFetching) {
      setMaxPageHint((prev) => Math.max(prev, hasNext ? page + 1 : page));
    }
  }, [hasNext, isLoading, isFetching, page]);

  useEffect(() => {
    if (!isFetching && !isLoading && page > 1 && items.length === 0) {
      setPage((prev) => Math.max(1, prev - 1));
    }
  }, [items, page, isFetching, isLoading]);

  useEffect(() => {
    setSelectedIds(new Set());
    setSelectMode(false);
  }, [page]);

  const notify = (message, variant = 'success') => {
    try {
      window.dispatchEvent(new CustomEvent('toast', { detail: { title: message, variant } }));
    } catch (_) {}
  };

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3 mt-4">
        {Array.from({ length: 12 }).map((_, i) => (
          <SharedCharacterCardSkeleton key={i} />
        ))}
      </div>
    );
  }
  if (isError) {
    return <div className="text-red-400 mt-4">내가 만든 원작챗을 불러오지 못했습니다.</div>;
  }
  if (!items.length) {
    return <div className="text-gray-400 mt-4">아직 생성한 원작챗이 없습니다.</div>;
  }
  return (
    <>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-end gap-2 mb-2">
        <Button className="w-full sm:w-auto" variant="outline" size="sm" onClick={()=> setSelectMode(v=>!v)}>{selectMode ? '선택 해제' : '선택'}</Button>
        <Button
          size="sm"
          className="w-full sm:w-auto bg-red-600 hover:bg-red-700 disabled:opacity-50"
          disabled={!selectMode || selectedIds.size===0 || isBulkDeleting}
          onClick={async()=>{
            if (!window.confirm(`${selectedIds.size}개의 원작챗 캐릭터를 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.`)) return;
            setIsBulkDeleting(true);
            let success = 0;
            let failed = 0;
            for (const id of Array.from(selectedIds)) {
              try { await charactersAPI.deleteCharacter(id); success += 1; }
              catch(_) { failed += 1; }
            }
            await refetch();
            setSelectedIds(new Set());
            setSelectMode(false);
            setIsBulkDeleting(false);
            // 홈/탐색 섹션 즉시 갱신
            queryClient.invalidateQueries({ queryKey: ['top-origchat-daily'] });
            queryClient.invalidateQueries({ queryKey: ['webnovel-characters'] });
            queryClient.invalidateQueries({ queryKey: ['characters'] });
            queryClient.invalidateQueries({ queryKey: ['liked-characters'] });
            queryClient.invalidateQueries({ queryKey: ['explore-stories'] });
            notify(failed ? `${success}개 삭제, ${failed}개 실패` : `${success}개 삭제 완료`);
          }}>선택삭제 ({selectedIds.size})</Button>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3 mt-4">
        {items.map((c) => (
          <div key={c.id} className="relative group" onClick={() => { if(!selectMode) navigate(`/characters/${c.id}`, { state: { fromMyGrid: true } }); }}>
            {selectMode && (
              <label className="absolute top-2 right-2 z-20 inline-flex items-center gap-1 bg-black/60 backdrop-blur-sm text-white text-xs px-2 py-1 rounded-md ring-1 ring-white/20 shadow-sm cursor-pointer">
                <input className="w-4 h-4" disabled={isBulkDeleting} type="checkbox" checked={selectedIds.has(c.id)} onChange={()=> setSelectedIds(prev=>{ const next=new Set(prev); if(next.has(c.id)) next.delete(c.id); else next.add(c.id); return next; })} /> 선택
              </label>
            )}
            <SharedCharacterCard character={{ ...c, source_type: 'IMPORTED' }} showNewBadge={false} />
          </div>
        ))}
      </div>
      <PaginationControls
        page={page}
        onPrev={() => setPage((prev) => Math.max(1, prev - 1))}
        onNext={() => { if (hasNext) setPage((prev) => prev + 1); }}
        onSelectPage={(p) => setPage(p)}
        disablePrev={page === 1 || isFetching}
        disableNext={!hasNext || isFetching}
        maxPageHint={maxPageHint}
      />
    </>
  );
};

export default MyCharactersPage; 
