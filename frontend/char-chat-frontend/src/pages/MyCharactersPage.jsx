/**
 * 내 캐릭터 목록 페이지
 */

import React, { useState, useEffect } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
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
  AlertCircle
} from 'lucide-react';
import { formatCount } from '../lib/format';
import AppLayout from '../components/layout/AppLayout';
import { CharacterCard as SharedCharacterCard, CharacterCardSkeleton as SharedCharacterCardSkeleton } from '../components/CharacterCard';
import StoryExploreCard from '../components/StoryExploreCard';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/tabs';
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogAction } from '../components/ui/alert-dialog';

// 좋아요한 캐릭터 탭 컴포넌트
const FavoritesTab = () => {
  const { data: liked = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['liked-characters-page'],
    queryFn: async () => {
      const response = await usersAPI.getLikedCharacters({ limit: 100 });
      return response.data || [];
    },
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
  });

  if (isLoading) {
    return (
      <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3 mt-4">
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
  if (!liked.length) {
    return <div className="text-gray-400 mt-4">좋아요한 캐릭터가 없습니다.</div>;
  }
  return (
    <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3 mt-4">
      {liked.map((c) => (
        <SharedCharacterCard key={c.id} character={c} />
      ))}
    </div>
  );
};

// 메인 UI와 통일을 위해 공용 레이아웃/카드 컴포넌트 사용 (중복 방지)

const MyCharactersPage = () => {
  const [characters, setCharacters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // 선택삭제(내 캐릭터 탭)
  const [selectModeChars, setSelectModeChars] = useState(false);
  const [selectedCharIds, setSelectedCharIds] = useState(new Set());
  const [isBulkDeletingChars, setIsBulkDeletingChars] = useState(false);
  const [doneModal, setDoneModal] = useState({ open: false, message: '' });

  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const location = useLocation();

  useEffect(() => {
    loadMyCharacters();
  }, []);

  const loadMyCharacters = async () => {
    setLoading(true);
    try {
      // 서버 사이드 필터: regular만
      const response = await charactersAPI.getMyCharacters({ only: 'regular', limit: 100 });
      const list = Array.isArray(response.data) ? response.data : [];
      setCharacters(list);
    } catch (err) {
      console.error('내 캐릭터 목록 로드 실패:', err);
      setError('캐릭터 목록을 불러올 수 없습니다.');
    } finally {
      setLoading(false);
    }
  };

  const deleteCharacter = async (characterId) => {
    if (!window.confirm('정말로 이 캐릭터를 삭제하시겠습니까?')) {
      return;
    }

    try {
      await charactersAPI.deleteCharacter(characterId);
      setCharacters(characters.filter(c => c.id !== characterId));
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
    const removeSet = new Set(ids);
    setCharacters(prev => prev.filter(c => !removeSet.has(c.id)));
    setSelectedCharIds(new Set());
    setSelectModeChars(false);
    setIsBulkDeletingChars(false);
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
            {character.description || '설명이 없습니다.'}
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

  if (loading) {
    return (
      <AppLayout>
        <div className="min-h-full bg-gray-900 text-gray-200">
          <main className="px-8 py-6">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <Button variant="ghost" disabled className="p-2 rounded-full text-gray-500 hover:bg-gray-800">
                  <ArrowLeft className="w-5 h-5" />
                </Button>
                <h2 className="text-xl font-normal text-white">내 캐릭터</h2>
              </div>
              <Skeleton className="h-10 w-40" />
            </div>
            <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
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
      <main className="px-8 py-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              onClick={() => navigate('/')}
              className="p-2 rounded-full text-gray-300 hover:text-white hover:bg-gray-800"
            >
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <h2 className="text-xl font-normal text-white">내 캐릭터</h2>
          </div>
          <Button
            onClick={() => navigate('/characters/create')}
            className="bg-purple-600 text-white px-4 py-2 rounded-lg font-medium border-0 transition-none hover:bg-purple-600"
          >
            <Plus className="w-4 h-4 mr-2" />
            새 캐릭터 만들기
          </Button>
        </div>

        <Tabs defaultValue={location.hash === '#favorites' ? 'favorites' : (location.hash === '#stories' ? 'stories' : (location.hash === '#origchat' ? 'origchat' : 'mine'))} className="mt-2">
          <TabsList className="bg-gray-800 border border-gray-700">
            <TabsTrigger value="mine" className="text-gray-200 data-[state=active]:bg-yellow-500 data-[state=active]:text-black">내가 만든 캐릭터</TabsTrigger>
            <TabsTrigger value="stories" className="text-gray-200 data-[state=active]:bg-yellow-500 data-[state=active]:text-black">내가 쓴 작품</TabsTrigger>
            <TabsTrigger value="favorites" className="text-gray-200 data-[state=active]:bg-yellow-500 data-[state=active]:text-black">내가 좋아하는 캐릭터</TabsTrigger>
            <TabsTrigger value="origchat" className="text-gray-200 data-[state=active]:bg-yellow-500 data-[state=active]:text-black">내가 만든 원작챗</TabsTrigger>
          </TabsList>
          {/* 내가 만든 캐릭터 탭 */}
          <TabsContent value="mine">
            {error && (<div className="text-red-400 mb-4">{error}</div>)}
            <div className="flex items-center justify-between mt-2">
              <div className="text-sm text-gray-400">총 {characters.length.toLocaleString()}개</div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" disabled={isBulkDeletingChars} onClick={()=> setSelectModeChars(v=>!v)}>{selectModeChars ? '선택 해제' : '선택'}</Button>
                <Button size="sm" className="bg-red-600 hover:bg-red-700 disabled:opacity-50" disabled={!selectModeChars || selectedCharIds.size===0 || isBulkDeletingChars} onClick={bulkDeleteChars}>
                  선택삭제 ({selectedCharIds.size})
                </Button>
              </div>
            </div>
            {characters.length > 0 ? (
              <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3 mt-4">
                {characters.map((character) => (
                  <div key={character.id} className="relative group" onClick={() => { if (!selectModeChars) navigate(`/characters/${character.id}`, { state: { fromMyGrid: true } }); }}>
                    {selectModeChars && (
                      <label className="absolute top-2 right-2 z-20 inline-flex items-center gap-1 bg-black/60 backdrop-blur-sm text-white text-xs px-2 py-1 rounded-md ring-1 ring-white/20 shadow-sm cursor-pointer">
                        <input className="w-4 h-4" disabled={isBulkDeletingChars} type="checkbox" checked={selectedCharIds.has(character.id)} onChange={()=>toggleSelectChar(character.id)} /> 선택
                      </label>
                    )}
                    <SharedCharacterCard character={character} />
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
                  onClick={() => navigate('/characters/create')}
                  className="bg-purple-600 text-white px-4 py-2 rounded-lg font-medium border-0 transition-none hover:bg-purple-600"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  첫 캐릭터 만들기
                </Button>
              </div>
            )}
          </TabsContent>

          {/* 내가 쓴 작품 탭 */}
          <TabsContent value="stories">
            <MyStoriesTab />
          </TabsContent>

          {/* 내가 좋아하는 캐릭터 탭 */}
          <TabsContent value="favorites">
            <FavoritesTab />
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
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['my-stories'],
    queryFn: async () => {
      const res = await storiesAPI.getMyStories({ limit: 100 });
      const items = Array.isArray(res.data?.stories) ? res.data.stories : [];
      return items;
    }
  });

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
      <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3 mt-4">
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} className="bg-gray-800 rounded-xl h-[280px] border border-gray-700" />
        ))}
      </div>
    );
  }
  if (isError) {
    return <div className="text-red-400 mt-4">내가 쓴 작품을 불러오지 못했습니다.</div>;
  }
  if (!data || data.length === 0) {
    return <div className="text-gray-400 mt-4">아직 작성한 작품이 없습니다.</div>;
  }

  return (
    <>
      <div className="flex items-center justify-end mb-2">
        <Button variant="outline" size="sm" onClick={()=> setSelectMode(v=>!v)}>{selectMode ? '선택 해제' : '선택'}</Button>
        <Button size="sm" className="ml-2 bg-red-600 hover:bg-red-700 disabled:opacity-50" disabled={!selectMode || selectedIds.size===0 || isBulkDeleting}
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
      <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3 mt-4">
        {data.map(story => (
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
    </>
  );
};

const MyOrigChatTab = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const { data = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['my-origchat-chars'],
    queryFn: async () => {
      const res = await charactersAPI.getMyCharacters();
      const list = Array.isArray(res.data) ? res.data : [];
      return list.filter(c => !!c.origin_story_id);
    },
    staleTime: 0,
    refetchOnMount: 'always',
  });

  if (isLoading) {
    return (
      <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3 mt-4">
        {Array.from({ length: 12 }).map((_, i) => (
          <SharedCharacterCardSkeleton key={i} />
        ))}
      </div>
    );
  }
  if (isError) {
    return <div className="text-red-400 mt-4">내가 만든 원작챗을 불러오지 못했습니다.</div>;
  }
  if (!data.length) {
    return <div className="text-gray-400 mt-4">아직 생성한 원작챗이 없습니다.</div>;
  }
  return (
    <>
      <div className="flex items-center justify-end mb-2">
        <Button variant="outline" size="sm" onClick={()=> setSelectMode(v=>!v)}>{selectMode ? '선택 해제' : '선택'}</Button>
        <Button size="sm" className="ml-2 bg-red-600 hover:bg-red-700 disabled:opacity-50" disabled={!selectMode || selectedIds.size===0}
          onClick={async()=>{
            if (!window.confirm(`${selectedIds.size}개의 원작챗 캐릭터를 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.`)) return;
            for (const id of Array.from(selectedIds)) { try { await charactersAPI.deleteCharacter(id); } catch(_) {} }
            await refetch();
            setSelectedIds(new Set());
            setSelectMode(false);
            // 홈/탐색 섹션 즉시 갱신
            queryClient.invalidateQueries({ queryKey: ['top-origchat-daily'] });
            queryClient.invalidateQueries({ queryKey: ['webnovel-characters'] });
            queryClient.invalidateQueries({ queryKey: ['characters'] });
            queryClient.invalidateQueries({ queryKey: ['liked-characters'] });
            queryClient.invalidateQueries({ queryKey: ['explore-stories'] });
            setDoneModal({ open: true, message: '삭제 완료' });
          }}>선택삭제 ({selectedIds.size})</Button>
      </div>
      <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3 mt-4">
        {data.map((c) => (
          <div key={c.id} className="relative group" onClick={() => { if(!selectMode) navigate(`/characters/${c.id}`, { state: { fromMyGrid: true } }); }}>
            {selectMode && (
              <label className="absolute top-2 right-2 z-20 inline-flex items-center gap-1 bg-black/60 backdrop-blur-sm text-white text-xs px-2 py-1 rounded-md ring-1 ring-white/20 shadow-sm cursor-pointer">
                <input className="w-4 h-4" type="checkbox" checked={selectedIds.has(c.id)} onChange={()=> setSelectedIds(prev=>{ const next=new Set(prev); if(next.has(c.id)) next.delete(c.id); else next.add(c.id); return next; })} /> 선택
              </label>
            )}
            <SharedCharacterCard character={{ ...c, source_type: 'IMPORTED' }} />
          </div>
        ))}
      </div>
    </>
  );
};

export default MyCharactersPage; 