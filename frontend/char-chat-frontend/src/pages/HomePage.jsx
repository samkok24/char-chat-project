/**
 * 홈페이지
 * CAVEDUCK 스타일: API 캐싱으로 성능 최적화
 */

import React, { useState, useEffect, useRef } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../contexts/AuthContext';
import useRequireAuth from '../hooks/useRequireAuth';
import { charactersAPI, usersAPI, tagsAPI, storiesAPI } from '../lib/api';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '../components/ui/avatar';
// 15번째 줄 수정: 이미지 썸네일 사이즈 파라미터 추가
import { resolveImageUrl, getThumbnailUrl } from '../lib/images';
import { LazyLoadImage } from 'react-lazy-load-image-component';
import 'react-lazy-load-image-component/src/effects/blur.css';
import { Skeleton } from '../components/ui/skeleton';
// import { resolveImageUrl } from '../lib/images';
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
import StoryExploreCard from '../components/StoryExploreCard';
import AppLayout from '../components/layout/AppLayout';
import ErrorBoundary from '../components/ErrorBoundary';
import TrendingCharacters from '../components/TrendingCharacters';
import TopWebtoons from '../components/TopWebtoons';
import TopStories from '../components/TopStories';
import TopOrigChat from '../components/TopOrigChat';
import WebNovelSection from '../components/WebNovelSection';

const HomePage = () => {
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState('');
  const { user, isAuthenticated, logout } = useAuth();
  const requireAuth = useRequireAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [sourceFilter, setSourceFilter] = useState(null); // null | 'IMPORTED' | 'ORIGINAL'

  // 스토리 다이브용 소설 목록 조회
  const { data: novels = [] } = useQuery({
    queryKey: ['storydive-novels'],
    queryFn: async () => {
      try {
        const { storydiveAPI } = await import('../lib/api');
        const response = await storydiveAPI.getNovels();
        return response.data || [];
      } catch (err) {
        console.error('Failed to load novels:', err);
        return [];
      }
    },
    enabled: isAuthenticated,
    staleTime: 5 * 60 * 1000,
  });

  // 🚀 무한스크롤: useInfiniteQuery + skip/limit 페이지네이션
  const LIMIT = 24;
  const [selectedTags, setSelectedTags] = useState([]); // slug 배열
  const [showAllTags, setShowAllTags] = useState(false);
  const { data: allTags = [] } = useQuery({
    queryKey: ['tags-used-or-all'],
    queryFn: async () => {
      try {
        const used = (await tagsAPI.getUsedTags()).data || [];
        const filtered = Array.isArray(used) ? used.filter(t => typeof t.slug === 'string' && !t.slug.startsWith('cover:')) : [];
        if (filtered.length > 0) return filtered;
      } catch (_) {}
      try {
        const all = (await tagsAPI.getTags()).data || [];
        const filteredAll = Array.isArray(all) ? all.filter(t => typeof t.slug === 'string' && !t.slug.startsWith('cover:')) : [];
        return filteredAll;
      } catch (e) {
        console.error('태그 목록 로드 실패:', e);
        return [];
      }
    },
    staleTime: 5 * 60 * 1000,
  });

  // 사용량 Top5 별도 조회 (정렬에 활용)
  const { data: topUsedTags = [] } = useQuery({
    queryKey: ['tags-top5'],
    queryFn: async () => {
      try {
        const res = await tagsAPI.getUsedTags();
        const arr = res.data || [];
        return Array.isArray(arr) ? arr.filter(t => typeof t.slug === 'string' && !t.slug.startsWith('cover:')) : [];
      } catch (_) {
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
    queryKey: ['characters', 'infinite', searchQuery, selectedTags.join(','), sourceFilter],
    queryFn: async ({ pageParam = 0 }) => {
      try {
        const response = await charactersAPI.getCharacters({
          search: searchQuery || undefined,
          skip: pageParam,
          limit: LIMIT,
          tags: selectedTags.length ? selectedTags.join(',') : undefined,
          source_type: sourceFilter || undefined,
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

  // 웹소설(스토리) 탐색: 공개 스토리 일부 노출
  const { data: exploreStories = [], isLoading: storiesLoading } = useQuery({
    queryKey: ['explore-stories'],
    queryFn: async () => {
      try {
        const res = await storiesAPI.getStories({ limit: 12 });
        const list = Array.isArray(res.data?.stories) ? res.data.stories : [];
        // 공개 스토리만 노출
        return list.filter(s => s?.is_public !== false);
      } catch (_) { return []; }
    },
    staleTime: 0, // 0 → 5분
    refetchOnMount: 'always'
  });
  const sentinelRef = useRef(null);

  // 캐릭터 + 스토리를 한 그리드에 섞어서 노출
  const mixedItems = React.useMemo(() => {
    const result = [];
    const interval = 5; // 캐릭터 5개마다 스토리 1개 삽입
  const storyQueue = [...(exploreStories || [])];

    characters.forEach((ch, idx) => {
      // 썸네일 적용: 89px 표시 크기의 2배 = 178px (Retina 대응)
      const thumbnailCh = {
        ...ch,
        avatar_url: getThumbnailUrl(ch.avatar_url, 178)
      };
      result.push({ kind: 'character', data: thumbnailCh });
      
      if ((idx + 1) % interval === 0 && storyQueue.length > 0) {
        const story = storyQueue.shift();
        const thumbnailStory = {
          ...story,
          cover_url: getThumbnailUrl(story.cover_url, 178)
        };
        result.push({ kind: 'story', data: thumbnailStory });
      }
    });
  

    // 캐릭터가 적을 때는 남은 스토리 일부를 뒤에 보충
    if (result.length < 12 && storyQueue.length > 0) {
      const need = 12 - result.length;
      for (let i = 0; i < need && storyQueue.length > 0; i++) {
        result.push({ kind: 'story', data: storyQueue.shift() });
      }
    }
    return result;
  }, [characters, exploreStories, sourceFilter]);

  // 페이지 진입/검색 변경 시 첫 페이지 새로고침
  useEffect(() => {
    refetch();
  }, [location, searchQuery, selectedTags, sourceFilter, refetch]);

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
    if (!requireAuth('캐릭터 채팅')) return;
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
    refetchOnMount: 'always'
  });

  const createCharacter = () => {
    if (!requireAuth('캐릭터 생성')) return;
    navigate('/characters/create');
  };

  const viewCharacterDetail = (characterId) => {
    navigate(`/characters/${characterId}`);
  };

  const visibleTagLimit = 18;
  // 홈 탐색 태그 정렬: 전체 태그 + 마지막 5개에 사용량 Top5(뒤에서 5번째가 최다)
  const arrangedTags = React.useMemo(() => {
    const top = (topUsedTags || []).slice(0, 5);
    const topSlugs = new Set(top.map(t => t.slug));
    const base = (allTags || []).filter(t => !topSlugs.has(t.slug));
    const combined = [...base, ...[...top].reverse()];
    // 최종 방어: cover: 접두 태그는 절대 노출하지 않음
    const isBad = (t) => {
      const s = String(t?.slug || '');
      const n = String(t?.name || '');
      return s.startsWith('cover:') || n.startsWith('cover:');
    };
    return combined.filter(t => !isBad(t));
  }, [allTags, topUsedTags]);
  const visibleTags = showAllTags ? arrangedTags : arrangedTags.slice(0, visibleTagLimit);

  // 메인탭 진입 시 인기 캐릭터 캐시 무효화
  useEffect(() => {
    queryClient.invalidateQueries({ queryKey: ['trending-characters-daily'] });
  }, [queryClient]);

  // 태그 추가 기능 제거 요청에 따라 관련 로직/버튼 제거됨

  return (
    <AppLayout>
      <div className="min-h-full bg-gray-900 text-gray-200">
        {/* 메인 컨텐츠 */}
        <main className="px-8 py-6">
          {/* 상단 탭 (Agent와 동일 스타일) */}
          <div className="mb-6 grid grid-cols-3 items-center">
            <div />
            <div className="flex items-center gap-2 justify-center">
              <span className="px-3 py-1 rounded-full bg-gradient-to-r from-purple-600 to-fuchsia-600 text-white shadow-md border border-transparent">메인</span>
              <Link to="/agent" className="px-3 py-1 rounded-full border border-purple-500/60 text-purple-300 bg-transparent hover:bg-purple-700/20 transition-colors">스토리 에이전트</Link>
            </div>
            <div className="justify-self-end" />
          </div>
          {/* 상단 필터 바 + 검색 */}
          <div className="mb-6">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setSourceFilter(null)}
                className={`px-3 py-1 rounded-full border ${sourceFilter === null ? 'bg-yellow-500 text-black border-yellow-400' : 'bg-gray-800 text-gray-200 border-gray-700'}`}
              >전체</button>
              <button
                onClick={() => setSourceFilter('ORIGINAL')}
                className={`px-3 py-1 rounded-full border ${sourceFilter === 'ORIGINAL' ? 'bg-yellow-500 text-black border-yellow-400' : 'bg-gray-800 text-gray-200 border-gray-700'}`}
              >일상</button>
              <button
                onClick={() => setShowAllTags(v => !v)}
                className={`px-3 py-1 rounded-full border bg-gray-800 text-gray-200 border-gray-700 inline-flex items-center gap-2`}
              >
                <span>장르</span>
                <ChevronDown className={`h-4 w-4 ${showAllTags ? 'rotate-180' : ''}`} />
              </button>
              
              {/* 검색 박스 */}
              <form onSubmit={handleSearch} className="flex-1 max-w-md">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
                  <Input
                    type="text"
                    placeholder="캐릭터 검색"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 bg-gray-800 border-gray-700 text-white placeholder-gray-400 rounded-full focus:ring-2 focus:ring-purple-500 focus:border-purple-500 text-sm"
                  />
                </div>
              </form>
            </div>
          </div>

          {/* 특화 캐릭터 바로가기 */}
          <section className="mb-10">
            <h2 className="text-lg font-medium text-gray-100 mb-4">특화 캐릭터들과 일상을 같이 나눠보세요</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              {[
                { name: '마동석', title: '슬기로운 사회생활 배우기', image: '/image/마동석2.jpg', tag: '직장' },
                { name: '아이유', title: '연애 고민 상담소', image: '/image/아이유.png', tag: '일상' },
                { name: '김영철', title: '유쾌한 영어 회화', image: '/image/김영철.jpg', tag: '일상' },
                { name: '침착맨', title: '깨진 멘탈 다 잡기', image: '/image/침착맨.jpg', tag: '일상' },
                { name: '펭수', title: '정신이 번쩍 드는 독설 듣기', image: '/image/펭수.jpg', tag: '일상' },
                { name: '빠니보틀', title: '여행계획하기', image: '/image/빠니보틀.png', tag: '일상' }
              ].map((item, idx) => (
                <div
                  key={idx}
                  className="bg-gray-800/40 rounded-lg p-3 cursor-pointer hover:bg-gray-800/60 transition-all border border-gray-700/50 hover:border-gray-600"
                  onClick={() => {
                    // TODO: 캐릭터 채팅방으로 이동
                    console.log(`Navigate to ${item.name} chat`);
                  }}
                >
                  <div className="flex items-center gap-3 mb-2">
                    <div className="w-10 h-10 rounded-full bg-gray-700 flex items-center justify-center flex-shrink-0 overflow-hidden">
                      <img 
                        src={item.image} 
                        alt={item.name}
                        className="w-full h-full object-cover object-top"
                        onError={(e) => {
                          e.target.style.display = 'none';
                          e.target.nextSibling.style.display = 'flex';
                        }}
                      />
                      <span className="text-lg hidden">{item.name.charAt(0)}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-gray-400 truncate">{item.name}</div>
                    </div>
                  </div>
                  <div className="text-sm text-gray-200 leading-snug">
                    {item.title}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* 스토리 시뮬레이터 */}
          <section className="mb-10">
            <h2 className="text-lg font-medium text-gray-100 mb-4">
              {user?.username || '신비한천사60'}님. 이런 상상, 해본 적 있으세요? 직접 주인공이 되어보세요.
            </h2>
            <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-hide">
              {[
                { 
                  title: '로또1등이라 엄청 즐겁게 회사생활하기', 
                  badge: '로또1등도 출근합니다',
                  image: '로또1등도.jpg',
                  novelTitle: '로또1등이라 엄청 즐겁게 회사생활하기'
                },
                { 
                  title: '전셋집에서 쫓겨나서 부동산 재벌되기', 
                  badge: '회귀해서 부동산 재벌',
                  image: '부동산.jpg',
                  novelTitle: '전셋집에서 시작하는 나의 히어로 아카데미아'
                },
                { 
                  title: '1998년부터 시작해서 K-컬쳐의 제왕되기', 
                  badge: 'K-문화의 제왕',
                  image: 'K문화.jpg',
                  novelTitle: null
                },
                { 
                  title: '망한 아이돌멤버에서 빌보드 프로듀서까지', 
                  badge: '두번 사는 프로듀서',
                  image: '프로듀서.jpg',
                  novelTitle: null
                },
                { 
                  title: '회사사람들과 다 같이 생존게임 참여하기', 
                  badge: '구조조정에서 살아남는법',
                  image: '구조조정.jpg',
                  novelTitle: null
                }
              ].map((item, idx) => {
                // novelTitle이 있으면 실제 소설과 매칭
                const matchedNovel = item.novelTitle 
                  ? novels.find(n => n.title === item.novelTitle)
                  : null;

                return (
                  <div
                    key={idx}
                    className="flex-shrink-0 w-[200px] cursor-pointer group"
                    onClick={() => {
                      if (!requireAuth('스토리 에이전트')) {
                        return;
                      }
                      if (matchedNovel) {
                        // 바로 원문 페이지로 이동
                        navigate(`/storydive/novels/${matchedNovel.id}`);
                      } else {
                        // 매칭되는 소설이 없으면 준비중 알림
                        window.dispatchEvent(new CustomEvent('toast', {
                          detail: {
                            type: 'info',
                            message: '준비 중인 콘텐츠입니다'
                          }
                        }));
                      }
                    }}
                  >
                
                  <div className="relative aspect-[3/4] rounded-lg overflow-hidden mb-2 bg-gray-900 border border-gray-700/50 group-hover:border-gray-600 transition-colors">
                    <img 
                      src={`/image/${item.image}`}
                      alt={item.title}
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        e.target.src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="200" height="267"%3E%3Crect fill="%23374151" width="200" height="267"/%3E%3Ctext x="50%25" y="50%25" fill="%239ca3af" text-anchor="middle" dominant-baseline="middle" font-size="12"%3E이미지 준비중%3C/text%3E%3C/svg%3E';
                      }}
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent" />
                    <div className="absolute bottom-0 left-0 right-0 p-3">
                      <h3 className="text-white font-semibold text-base leading-tight" style={{
                        textShadow: '0 2px 8px rgba(0,0,0,0.8), 0 0 2px rgba(0,0,0,1)',
                        WebkitTextStroke: '0.5px black'
                      }}>
                        {item.title}
                      </h3>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-gray-500">by</span>
                    <Badge className="bg-blue-600/80 hover:bg-blue-600 text-white text-[10px] px-2 py-0.5">
                      {item.badge}
                    </Badge>
                  </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* 인기 캐릭터 TOP (4x2) */}
          <ErrorBoundary>
            <TrendingCharacters />
          </ErrorBoundary>

          {/* 웹툰 TOP10 */}
          <ErrorBoundary>
            <TopWebtoons />
          </ErrorBoundary>

          {/* 웹소설 TOP10 (블루) */}
          <ErrorBoundary>
            <TopStories />
          </ErrorBoundary>

          {/* 웹소설 원작 섹션 (상시 노출) */}
          <ErrorBoundary>
            <TopOrigChat />
          </ErrorBoundary>

          {/* 최근 대화 섹션 - 관심 캐릭터 영역 임시 비노출 */}
          {isAuthenticated && (
            <>
              {/* 관심 캐릭터 섹션 숨김 */}
              {/* <section className="mt-10 hidden" aria-hidden="true"></section> */}

              <section className="mt-10 mb-10">
                <div className="flex items-center justify-between mb-5">
                  <h2 className="text-xl font-normal text-white">최근 대화</h2>
                  <Link to="/history" className="text-sm text-gray-400 hover:text-white">더보기</Link>
                </div>
                <RecentCharactersList limit={5} />
              </section>
            </>
          )}

          {/* 하단 중복 섹션 제거 */}

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
                <ErrorBoundary>
                  <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
                    {(mixedItems.length ? mixedItems : characters.map(c => ({ kind: 'character', data: c })) ).map((item) => (
                      item.kind === 'story' ? (
                        <StoryExploreCard key={`story-${item.data.id}`} story={item.data} />
                      ) : (
                        <CharacterCard key={`char-${item.data.id}`} character={item.data} showOriginBadge />
                      )
                    ))}
                  </div>
                </ErrorBoundary>
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
      {/* 로그인 유도 모달 */}
    </AppLayout>
  );
};

export default HomePage;

