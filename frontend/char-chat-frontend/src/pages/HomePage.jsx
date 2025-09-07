/**
 * 홈페이지
 * CAVEDUCK 스타일: API 캐싱으로 성능 최적화
 */

import React, { useState, useEffect, useRef } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useAuth } from '../contexts/AuthContext';
import { charactersAPI, usersAPI, tagsAPI } from '../lib/api';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '../components/ui/avatar';
import { LazyLoadImage } from 'react-lazy-load-image-component';
import 'react-lazy-load-image-component/src/effects/blur.css';
import { Skeleton } from '../components/ui/skeleton';
import { resolveImageUrl } from '../lib/images';
import { 
  Search, 
  MessageCircle, 
  Heart, 
  Users, 
  Sparkles,
  BookOpen,
  Loader2,
  LogIn,
  UserPlus,
  LogOut,
  User,
  Gem,
  Settings,
  ChevronDown
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";
import { RecentCharactersList } from '../components/RecentCharactersList';
import { RecentChatCard } from '../components/RecentChatCard';
import { CharacterCard, CharacterCardSkeleton } from '../components/CharacterCard';
import AppLayout from '../components/layout/AppLayout';
import TrendingCharacters from '../components/TrendingCharacters';
import WebNovelSection from '../components/WebNovelSection';

const HomePage = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const { user, isAuthenticated, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // 🚀 무한스크롤: useInfiniteQuery + skip/limit 페이지네이션
  const LIMIT = 24;
  const [selectedTags, setSelectedTags] = useState([]); // slug 배열
  const [showAllTags, setShowAllTags] = useState(false);
  const { data: allTags = [] } = useQuery({
    queryKey: ['tags-used-or-all'],
    queryFn: async () => {
      try {
        const used = (await tagsAPI.getUsedTags()).data || [];
        if (Array.isArray(used) && used.length > 0) return used;
      } catch (_) {}
      try {
        const all = (await tagsAPI.getTags()).data || [];
        return Array.isArray(all) ? all : [];
      } catch (e) {
        console.error('태그 목록 로드 실패:', e);
        return [];
      }
    },
    staleTime: 5 * 60 * 1000,
  });
  const {
    data: characterPages,
    isLoading: loading,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    refetch
  } = useInfiniteQuery({
    queryKey: ['characters', 'infinite', searchQuery, selectedTags.join(',')],
    queryFn: async ({ pageParam = 0 }) => {
      try {
        const response = await charactersAPI.getCharacters({
          search: searchQuery || undefined,
          skip: pageParam,
          limit: LIMIT,
          tags: selectedTags.length ? selectedTags.join(',') : undefined,
        });
        const items = response.data || [];
        return { items, nextSkip: items.length === LIMIT ? pageParam + LIMIT : null };
      } catch (error) {
        console.error('캐릭터 목록 로드 실패:', error);
        return { items: [], nextSkip: null };
      }
    },
    getNextPageParam: (lastPage) => lastPage.nextSkip,
    staleTime: 30 * 1000,
    cacheTime: 10 * 60 * 1000,
    refetchOnWindowFocus: true,
  });

  const characters = (characterPages?.pages || []).flatMap(p => p.items);
  const sentinelRef = useRef(null);

  // 페이지 진입/검색 변경 시 첫 페이지 새로고침
  useEffect(() => {
    refetch();
  }, [location, searchQuery, selectedTags, refetch]);

  // IntersectionObserver로 리스트 끝에서 다음 페이지 로드
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    if (!hasNextPage || loading) return;

    const observer = new IntersectionObserver((entries) => {
      const entry = entries[0];
      if (entry.isIntersecting && hasNextPage && !isFetchingNextPage) {
        fetchNextPage();
      }
    }, { rootMargin: '200px 0px', threshold: 0 });

    observer.observe(el);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, loading, searchQuery]);

  const handleSearch = (e) => {
    e.preventDefault();
    // React Query가 자동으로 새로운 쿼리 키로 요청
    // searchQuery 상태가 변경되면 자동으로 refetch됨
  };

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  const startChat = (characterId) => {
    if (!isAuthenticated) {
      navigate('/login');
      return;
    }
    // "대화하기" 버튼은 실제 채팅 페이지로 바로 이동
    navigate(`/ws/chat/${characterId}`);
  };

  // 관심 캐릭터(좋아요한 캐릭터) 불러오기
  const { data: favoriteChars = [], isLoading: favLoading } = useQuery({
    queryKey: ['liked-characters', isAuthenticated],
    enabled: !!isAuthenticated,
    queryFn: async () => {
      const res = await usersAPI.getLikedCharacters({ limit: 12 });
      return res.data || [];
    },
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
  });

  const createCharacter = () => {
    navigate('/characters/create');
  };

  const viewCharacterDetail = (characterId) => {
    navigate(`/characters/${characterId}`);
  };

  const visibleTagLimit = 18;
  const visibleTags = showAllTags ? allTags : allTags.slice(0, visibleTagLimit);

  // 태그 추가 기능 제거 요청에 따라 관련 로직/버튼 제거됨

  return (
    <AppLayout>
      <div className="min-h-full bg-gray-900 text-gray-200">
        {/* 상단 프로필 드롭다운 제거 */}

        {/* 메인 컨텐츠 */}
        <main className="px-8 py-6">
          {/* Welcome 섹션 */}
          <div className="mb-8">
            <h1 className="text-2xl font-normal text-gray-300">
              {isAuthenticated ? 'Welcome back,' : 'Welcome,'}
            </h1>
            <div className="flex items-center gap-2 mt-1">
              <div className="w-2 h-2 bg-green-500 rounded-full"></div>
              <h2 className="text-2xl font-normal text-white">{user?.username || 'Guest'}</h2>
            </div>
          </div>


          {/* 검색 */}
          <div className="mb-12 max-w-2xl">
            <form onSubmit={handleSearch}>
              <div className="relative">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-500" />
                <Input
                  type="text"
                  placeholder="어떤 캐릭터를 찾아볼까요?"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-12 pr-4 py-3 bg-gray-800 border-gray-700 text-white placeholder-gray-400 rounded-full focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                />
              </div>
            </form>
          </div>

          {/* Trending 섹션 */}
          <TrendingCharacters />

          {/* 웹소설 원작 섹션 */}
          <WebNovelSection />

          {/* 최근 대화 섹션 */}
          {isAuthenticated && (
            <>
              {/* 관심 캐릭터(좋아요) 섹션 */}
              {favoriteChars.length > 0 && (
                <section className="mt-10">
                  <div className="flex items-center justify-between mb-3">
                    <h2 className="text-lg font-bold text-white">관심 캐릭터</h2>
                    <Link to="/favorites" className="text-sm text-gray-400 hover:text-white">더보기</Link>
                  </div>
                  <div className="flex overflow-x-auto gap-3 pb-2 scrollbar-hide">
                    {favoriteChars.map((char) => (
                      <div key={char.id} className="flex-shrink-0">
                        <RecentChatCard
                          character={char}
                          onClick={() => navigate(`/characters/${char.id}`)}
                        />
                      </div>
                    ))}
                  </div>
                </section>
              )}

              <section className="mt-10 mb-10">
                <div className="flex items-center justify-between mb-5">
                  <h2 className="text-xl font-normal text-white">최근 대화</h2>
                  <Link to="/history" className="text-sm text-gray-400 hover:text-white">더보기</Link>
                </div>
                <RecentCharactersList limit={8} />
              </section>
            </>
          )}

          {/* Scenes 섹션 (나중에 구현) */}
          {/* <section className="mb-10">
            <h2 className="text-xl font-normal text-white mb-5">Scenes</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
              Scene cards will go here
            </div>
          </section> */}

          {/* 탐색 섹션 */}
          <section className="mb-10">
            <h2 className="text-xl font-normal text-white mb-3">탐색</h2>

            {/* 태그 필터 바 (제목 바로 아래) */}
            <div className="mb-5">
              <div className="flex flex-wrap gap-2">
                {visibleTags.map((t) => {
                  const active = selectedTags.includes(t.slug);
                  return (
                    <button
                      key={t.id}
                      onClick={() => setSelectedTags(prev => active ? prev.filter(s => s !== t.slug) : [...prev, t.slug])}
                      className={`px-3 py-1 rounded-full border ${active ? 'bg-yellow-500 text-black border-yellow-400' : 'bg-gray-800 text-gray-200 border-gray-700'} inline-flex items-center gap-2`}
                    >
                      <span>{t.emoji || '🏷️'}</span>
                      <span>{t.name}</span>
                    </button>
                  );
                })}
                {allTags.length > visibleTagLimit && (
                  <button
                    onClick={() => setShowAllTags(v => !v)}
                    className="px-3 py-1 rounded-full bg-gray-800 text-gray-200 border border-gray-700 inline-flex items-center gap-2"
                  >
                    <ChevronDown className={`h-4 w-4 ${showAllTags ? 'rotate-180' : ''}`} />
                    {showAllTags ? '접기' : '더보기'}
                  </button>
                )}
                <button
                  onClick={() => setSelectedTags([])}
                  className="px-3 py-1 rounded-full bg-gray-700 text-white border border-gray-600"
                >초기화</button>
              </div>
            </div>

            {loading ? (
              <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
                {Array.from({ length: 12 }).map((_, i) => (
                  <CharacterCardSkeleton key={i} />
                ))}
              </div>
            ) : characters.length > 0 ? (
              <>
                <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
                  {characters.map((character) => (
                    <CharacterCard key={character.id} character={character} />
                  ))}
                </div>
                {/* 무한스크롤 센티넬 */}
                <div ref={sentinelRef} className="h-10"></div>
                {isFetchingNextPage && (
                  <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3 mt-3">
                    {Array.from({ length: 6 }).map((_, i) => (
                      <CharacterCardSkeleton key={`sk-${i}`} />
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div className="text-center py-16">
                <p className="text-gray-400">
                  아직 공개된 캐릭터가 없습니다.
                </p>
              </div>
            )}
          </section>
      </main>
      </div>
    </AppLayout>
  );
};

export default HomePage;

