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
  Plus,
  Loader2,
  LogIn,
  UserPlus,
  LogOut,
  User,
  Gem,
  Settings,
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
import StorySerialCard from '../components/StorySerialCard';
import AppLayout from '../components/layout/AppLayout';
import ErrorBoundary from '../components/ErrorBoundary';
import TrendingCharacters from '../components/TrendingCharacters';
import RecommendedCharacters from '../components/RecommendedCharacters';
import TopStories from '../components/TopStories';
import TopOrigChat from '../components/TopOrigChat';
import WebNovelSection from '../components/WebNovelSection';

const CHARACTER_PAGE_SIZE = 40;

const HomePage = () => {
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState('');
  const { user, isAuthenticated, logout } = useAuth();
  const requireAuth = useRequireAuth();
  const navigate = useNavigate();
  const location = useLocation();
  // URL 쿼리로부터 초기 탭 결정
  const params = new URLSearchParams(location.search);
  const tabParam = params.get('tab');
  const subParam = params.get('sub'); // origserial 서브탭: novel|origchat
  const initialFilter =
    tabParam === 'origserial' ? 'ORIGSERIAL' :
    tabParam === 'character' ? 'ORIGINAL' :
    null;
  const [sourceFilter, setSourceFilter] = useState(initialFilter);
  const [origSerialTab, setOrigSerialTab] = useState(subParam === 'origchat' ? 'origchat' : 'novel'); // 'novel' | 'origchat'
  const isCharacterTab = sourceFilter === 'ORIGINAL';
  const isOrigSerialTab = sourceFilter === 'ORIGSERIAL';
  const requestSourceType = isCharacterTab
    ? 'ORIGINAL'
    : sourceFilter === 'IMPORTED'
      ? 'IMPORTED'
      : undefined;
  const updateTab = (tabValue, tabQuery) => {
    setSourceFilter(tabValue);
    const p = new URLSearchParams(location.search);
    if (tabQuery) p.set('tab', tabQuery);
    else p.delete('tab');
    // origserial이 아닌 탭으로 이동하면 sub 파라미터는 제거(URL 정리)
    if (tabQuery !== 'origserial') p.delete('sub');
    navigate({ pathname: location.pathname, search: p.toString() }, { replace: true });
  };

  // ✅ URL 쿼리로 탭 상태 동기화(더보기 링크 등으로 이동 시 UI가 안 바뀌는 문제 방지)
  useEffect(() => {
    const next =
      tabParam === 'origserial' ? 'ORIGSERIAL' :
      tabParam === 'character' ? 'ORIGINAL' :
      null;
    setSourceFilter(next);
  }, [tabParam]);

  useEffect(() => {
    if (tabParam !== 'origserial') return;
    if (subParam === 'novel' || subParam === 'origchat') {
      setOrigSerialTab(subParam);
    }
  }, [tabParam, subParam]);
  // 스토리 다이브 추천 작품(원작) - 10화 이상 + 표지 있음 + 원작챗 시작 수 낮은 순 + 평균조회수 반영(서버 계산)
  const { data: storyDiveStories = [], isLoading: storyDiveStoriesLoading } = useQuery({
    queryKey: ['storydive-stories-featured'],
    queryFn: async () => {
      try {
        const res = await storiesAPI.getStoryDiveSlots(10, 10);
        return Array.isArray(res.data) ? res.data : [];
      } catch (err) {
        console.error('Failed to load storydive stories:', err);
        return [];
      }
    },
    staleTime: 5 * 60 * 1000,
  });

  // 최근 스토리다이브 (스토리다이브 사용 경험 유저에게는 추천보다 최근이 우선)
  const { data: recentStoryDive = [], isLoading: recentStoryDiveLoading } = useQuery({
    // ✅ 유저별로 캐시 분리(React Query persist 사용 중이라, queryKey에 user.id가 없으면 타계정/과거 캐시가 섞여 보일 수 있음)
    queryKey: ['storydive-recent-sessions', user?.id || 'guest'],
    queryFn: async () => {
      try {
        const { storydiveAPI } = await import('../lib/api');
        const res = await storydiveAPI.getRecentSessions(10);
        return Array.isArray(res.data) ? res.data : [];
      } catch (err) {
        console.error('Failed to load recent storydive sessions:', err);
        return [];
      }
    },
    enabled: isAuthenticated && !!user?.id,
    staleTime: 5 * 60 * 1000,
  });

  /**
   * 홈(메인 탭) 전용: '일상' 태그 캐릭터 추천 섹션 데이터
   * - 기존 "특화 캐릭터 바로가기" 하드코딩을 제거하고, DB 태그 기반으로 노출한다.
   * - 방어적으로 실패/빈 배열을 처리해서 홈 화면이 깨지지 않도록 한다.
   */
  const DAILY_TAG_SLUG = '일상';
  const DAILY_CHARACTER_LIMIT = 6;
  const { data: dailyTagCharacters = [], isLoading: dailyTagCharactersLoading } = useQuery({
    queryKey: ['characters', 'home', 'daily-tag', DAILY_TAG_SLUG],
    queryFn: async () => {
      try {
        const res = await charactersAPI.getCharacters({
          tags: DAILY_TAG_SLUG,
          sort: 'views',
          limit: DAILY_CHARACTER_LIMIT,
          // "일반 캐릭터챗" 우선 노출 (원작/웹소설/원작연재 제외)
          source_type: 'ORIGINAL',
        });
        return Array.isArray(res.data) ? res.data : [];
      } catch (err) {
        console.error("Failed to load '일상' tag characters:", err);
        return [];
      }
    },
    enabled: !isCharacterTab && !isOrigSerialTab,
    staleTime: 5 * 60 * 1000,
  });

  // 🚀 무한스크롤: useInfiniteQuery + skip/limit 페이지네이션
  const LIMIT = 24;
  const [selectedTags, setSelectedTags] = useState([]); // slug 배열
  const [showAllTags, setShowAllTags] = useState(false);
  const visibleTagLimit = 18;
  const { data: allTags = [] } = useQuery({
    queryKey: ['tags-used-or-all'],
    queryFn: async () => {
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
  const arrangedTags = React.useMemo(() => {
    const top = (topUsedTags || []).slice(0, 5);
    const topSlugs = new Set(top.map(t => t.slug));
    const base = (allTags || []).filter(t => !topSlugs.has(t.slug));
    const combined = [...base, ...[...top].reverse()];
    const isBad = (t) => {
      const s = String(t?.slug || '');
      const n = String(t?.name || '');
      return s.startsWith('cover:') || n.startsWith('cover:');
    };
    return combined.filter(t => !isBad(t));
  }, [allTags, topUsedTags]);

  // ✅ 캐릭터 탭용 태그 정렬(가나다 순, 영문/기타는 뒤로)
  const sortedTagsForCharacterTab = React.useMemo(() => {
    const base = Array.isArray(allTags) ? allTags : [];
    const getLabel = (t) => String(t?.name || t?.slug || '').trim();
    const isHangulStart = (label) => {
      const s = String(label || '').trim();
      if (!s) return false;
      const ch = s.codePointAt(0);
      // Hangul Syllables / Jamo / Compatibility Jamo
      return (
        (ch >= 0xAC00 && ch <= 0xD7A3) ||
        (ch >= 0x1100 && ch <= 0x11FF) ||
        (ch >= 0x3130 && ch <= 0x318F)
      );
    };

    const collatorKo = new Intl.Collator('ko-KR', { numeric: true, sensitivity: 'base' });
    const collatorEtc = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

    return [...base].sort((a, b) => {
      const la = getLabel(a);
      const lb = getLabel(b);
      const ha = isHangulStart(la);
      const hb = isHangulStart(lb);
      if (ha !== hb) return ha ? -1 : 1; // ✅ 한글 먼저
      if (ha) return collatorKo.compare(la, lb);
      return collatorEtc.compare(la, lb);
    });
  }, [allTags]);

  const visibleCharacterTabTags = React.useMemo(() => {
    return showAllTags
      ? sortedTagsForCharacterTab
      : sortedTagsForCharacterTab.slice(0, visibleTagLimit);
  }, [sortedTagsForCharacterTab, showAllTags, visibleTagLimit]);

  const derivedTagSlug = React.useMemo(() => {
    const raw = searchQuery?.trim();
    if (!raw) return null;
    const normalized = raw.startsWith('#') ? raw.slice(1) : raw;
    const lower = normalized.toLowerCase();
    const match = arrangedTags.find(
      (t) =>
        String(t?.slug || '').toLowerCase() === lower ||
        String(t?.name || '').toLowerCase() === lower
    );
    return match?.slug || null;
  }, [searchQuery, arrangedTags]);

  const effectiveTags = React.useMemo(() => {
    const base = Array.isArray(selectedTags) ? [...selectedTags] : [];
    if (derivedTagSlug && !base.includes(derivedTagSlug)) {
      base.push(derivedTagSlug);
    }
    return base;
  }, [selectedTags, derivedTagSlug]);

  const effectiveTagsKey = React.useMemo(
    () => (effectiveTags.length ? [...effectiveTags].sort().join(',') : ''),
    [effectiveTags]
  );

  const visibleTags = showAllTags ? arrangedTags : arrangedTags.slice(0, visibleTagLimit);

  const {
    data: characterPages,
    isLoading: loading,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    refetch
  } = useInfiniteQuery({
    queryKey: ['characters', 'infinite', searchQuery, effectiveTagsKey, sourceFilter],
    queryFn: async ({ pageParam = 0 }) => {
      try {
        const response = await charactersAPI.getCharacters({
          search: searchQuery || undefined,
          skip: pageParam,
          limit: LIMIT,
          tags: effectiveTags.length ? effectiveTags.join(',') : undefined,
          source_type: requestSourceType,
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
  const [characterPage, setCharacterPage] = useState(1);
  const generalCharacters = React.useMemo(
    () =>
      characters.filter((ch) => {
        const isOrigChat = !!(ch?.origin_story_id || ch?.is_origchat || ch?.source === 'origchat');
        const isWebNovel = ch?.source_type === 'IMPORTED';
        return !isOrigChat && !isWebNovel;
      }),
    [characters]
  );

  const origSerialCharacters = React.useMemo(
    () =>
      characters.filter((ch) => !!(ch?.origin_story_id || ch?.is_origchat || ch?.source === 'origchat')),
    [characters]
  );

  // 원작연재 탭용 스토리 무한스크롤
  const STORY_LIMIT = 20;
  const {
    data: serialStoryPages,
    isLoading: serialStoriesLoading,
    isFetchingNextPage: isFetchingNextSerialPage,
    hasNextPage: hasNextSerialPage,
    fetchNextPage: fetchNextSerialPage,
    refetch: refetchSerialStories
  } = useInfiniteQuery({
    queryKey: ['serial-stories', 'infinite', searchQuery],
    queryFn: async ({ pageParam = 0 }) => {
      try {
        const params = {
          skip: pageParam,
          limit: STORY_LIMIT,
          sort: 'recent', // 최근 업데이트순
        };
        const trimmed = searchQuery?.trim();
        if (trimmed) params.search = trimmed;
        console.log('[원작연재] API 요청 params:', params);
        const res = await storiesAPI.getStories(params);
        console.log('[원작연재] API 응답:', res.data);
        const list = Array.isArray(res.data?.stories) ? res.data.stories : [];
        // 웹툰 제외, 공개된 것만 (프론트 필터링)
        const filtered = list.filter(s => !s?.is_webtoon && s?.is_public !== false);
        return { 
          items: filtered, 
          nextSkip: list.length === STORY_LIMIT ? pageParam + STORY_LIMIT : null 
        };
      } catch (error) {
        console.error('원작연재 스토리 목록 로드 실패:', error);
        return { items: [], nextSkip: null };
      }
    },
    getNextPageParam: (lastPage) => lastPage.nextSkip,
    staleTime: 30 * 1000,
    cacheTime: 10 * 60 * 1000,
    enabled: isOrigSerialTab, // 원작연재 탭일 때만 쿼리 실행
  });

  // const serialStories = (serialStoryPages?.pages || []).flatMap(p => p.items);
  // const novelStories = React.useMemo(
  //   () => serialStories.filter((s) => !s?.is_origchat),
  //   [serialStories]
  // );
  // const origchatStories = React.useMemo(
  //   () => serialStories.filter((s) => !!s?.is_origchat),
  //   [serialStories]
  // );
  const serialStories = (serialStoryPages?.pages || []).flatMap(p => p.items);
  // // 백엔드에서 only 파라미터로 필터링하므로 프론트 필터링 불필요
  // const novelStories = origSerialTab === 'novel' ? serialStories : [];
  // const origchatStories = origSerialTab === 'origchat' ? serialStories : [];
    // 원작소설 탭: 모든 Story (웹툰 제외)
  // 원작챗 탭: Character API에서 가져온 origSerialCharacters 사용 (Story API 불필요)
  const novelStories = serialStories.filter(s => !s?.is_webtoon);
  const serialSentinelRef = useRef(null);

  // 원작연재 탭 무한스크롤 IntersectionObserver
  useEffect(() => {
    if (!isOrigSerialTab || !serialSentinelRef.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasNextSerialPage && !isFetchingNextSerialPage) {
          fetchNextSerialPage();
        }
      },
      { threshold: 0.1 }
    );
    observer.observe(serialSentinelRef.current);
    return () => observer.disconnect();
  }, [isOrigSerialTab, hasNextSerialPage, isFetchingNextSerialPage, fetchNextSerialPage]);

  // 웹소설(스토리) 탐색: 공개 스토리 일부 노출
  const { data: exploreStories = [], isLoading: storiesLoading } = useQuery({
    queryKey: ['explore-stories', searchQuery, effectiveTagsKey],
    queryFn: async () => {
      try {
        const params = { limit: 12 };
        const trimmed = searchQuery?.trim();
        if (trimmed) params.search = trimmed;
        if (effectiveTags.length) params.tags = effectiveTags.join(',');
        const res = await storiesAPI.getStories(params);
        const list = Array.isArray(res.data?.stories) ? res.data.stories : [];
        return list.filter(s => s?.is_public !== false);
      } catch (_) { return []; }
    },
    staleTime: 0,
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

  // 캐릭터 탭 페이지 초기화
  useEffect(() => {
    if (!isCharacterTab) {
      setCharacterPage(1);
      return;
    }
    setCharacterPage(1);
  }, [isCharacterTab, searchQuery, effectiveTagsKey]);

  const totalCharacterPages = React.useMemo(() => {
    if (!isCharacterTab) return 1;
    return Math.max(1, Math.ceil(generalCharacters.length / CHARACTER_PAGE_SIZE));
  }, [isCharacterTab, generalCharacters.length]);

  // 페이지 범위 보정
  useEffect(() => {
    if (!isCharacterTab) return;
    if (characterPage > totalCharacterPages) {
      setCharacterPage(totalCharacterPages || 1);
    }
  }, [isCharacterTab, characterPage, totalCharacterPages]);

  // 캐릭터 탭에서 필요한 만큼 데이터 확보
  useEffect(() => {
    if (!isCharacterTab) return;
    const requiredItems = characterPage * CHARACTER_PAGE_SIZE;
    if (generalCharacters.length >= requiredItems) return;
    if (!hasNextPage || isFetchingNextPage) return;
    fetchNextPage();
  }, [
    isCharacterTab,
    characterPage,
    generalCharacters.length,
    characters.length,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage
  ]);

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

  // 메인탭 진입 시 인기 캐릭터 캐시 무효화
  useEffect(() => {
    queryClient.invalidateQueries({ queryKey: ['trending-characters-daily'] });
  }, [queryClient]);

  // 태그 추가 기능 제거 요청에 따라 관련 로직/버튼 제거됨

  const gridColumnClasses = (isCharacterTab || isOrigSerialTab)
    ? 'grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6 gap-3'
    : 'grid grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3';

  const displayGridItems = React.useMemo(() => {
    if (isCharacterTab) {
      const start = (characterPage - 1) * CHARACTER_PAGE_SIZE;
      const slice = generalCharacters.slice(start, start + CHARACTER_PAGE_SIZE);
      return slice.map((c) => ({ kind: 'character', data: c }));
    }
    if (isOrigSerialTab) {
      return origSerialCharacters.map((c) => ({ kind: 'character', data: c }));
    }
    return mixedItems.length
      ? mixedItems
      : characters.map((c) => ({ kind: 'character', data: c }));
  }, [isCharacterTab, isOrigSerialTab, generalCharacters, origSerialCharacters, mixedItems, characters, characterPage]);

  const hasGridItems = displayGridItems.length > 0;
  const shouldShowPagination = isCharacterTab && generalCharacters.length > 0;

  const paginationPages = React.useMemo(() => {
    if (!shouldShowPagination) return [];
    const maxVisible = 7;
    let start = Math.max(1, characterPage - Math.floor(maxVisible / 2));
    let end = Math.min(totalCharacterPages, start + maxVisible - 1);
    if (end - start + 1 < maxVisible) {
      start = Math.max(1, end - maxVisible + 1);
    }
    const pages = [];
    for (let i = start; i <= end; i += 1) {
      pages.push(i);
    }
    return pages;
  }, [shouldShowPagination, characterPage, totalCharacterPages]);

  const goToPage = React.useCallback((pageNumber) => {
    if (!isCharacterTab) return;
    const target = Math.min(Math.max(1, pageNumber), totalCharacterPages);
    setCharacterPage(target);
  }, [isCharacterTab, totalCharacterPages]);

  const handlePrevPage = React.useCallback(() => {
    goToPage(characterPage - 1);
  }, [goToPage, characterPage]);

  const handleNextPage = React.useCallback(() => {
    goToPage(characterPage + 1);
  }, [goToPage, characterPage]);

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
                onClick={() => updateTab(null, null)}
                className={`px-3 py-1 rounded-full border ${sourceFilter === null ? 'bg-yellow-500 text-black border-yellow-400' : 'bg-gray-800 text-gray-200 border-gray-700'}`}
              >전체</button>
              <button
                onClick={() => updateTab('ORIGINAL', 'character')}
                className={`px-3 py-1 rounded-full border ${sourceFilter === 'ORIGINAL' ? 'bg-yellow-500 text-black border-yellow-400' : 'bg-gray-800 text-gray-200 border-gray-700'}`}
              >캐릭터</button>
              <button
                onClick={() => updateTab('ORIGSERIAL', 'origserial')}
                className={`px-3 py-1 rounded-full border ${isOrigSerialTab ? 'bg-yellow-500 text-black border-yellow-400' : 'bg-gray-800 text-gray-200 border-gray-700'}`}
              >원작연재</button>
              
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
  {/* ✅ 탐색 영역 태그 UI는 비노출(요구사항). 태그 힌트 문구도 숨긴다. */}

          {/* 원작연재 탭: 스토리 리스트 또는 캐릭터 격자 */}
          {isOrigSerialTab && (
            <section className="mb-10">
              <div className="flex items-center justify-center mb-4">
                <div className="flex items-center gap-2">
                <button
                    onClick={() => setOrigSerialTab('novel')}
                    className={`px-3 py-1 rounded-full border text-sm ${
                      origSerialTab === 'novel'
                        ? 'bg-white text-black border-white'
                        : 'bg-gray-800 text-gray-200 border-gray-700'
                    }`}
                  >
                    원작소설
                  </button>
                  <button
                    onClick={() => setOrigSerialTab('origchat')}
                    className={`px-3 py-1 rounded-full border text-sm ${
                      origSerialTab === 'origchat'
                        ? 'bg-white text-black border-white'
                        : 'bg-gray-800 text-gray-200 border-gray-700'
                    }`}
                  >
                    원작챗
                  </button>
                </div>
              </div>
              
              {/* 원작소설 탭: 스토리 리스트 */}
              {origSerialTab === 'novel' && (
                <>
                  {serialStoriesLoading ? (
                    <div className="bg-gray-800/50 rounded-xl overflow-hidden border border-gray-700/50">
                      {Array.from({ length: 5 }).map((_, i) => (
                        <div key={i} className="flex gap-4 py-5 px-4 border-b border-gray-700/50 animate-pulse">
                          <div className="w-[100px] h-[140px] bg-gray-700 rounded-lg" />
                          <div className="flex-1 space-y-3">
                            <div className="h-5 w-16 bg-gray-700 rounded" />
                            <div className="h-5 w-48 bg-gray-700 rounded" />
                            <div className="h-4 w-24 bg-gray-700 rounded" />
                            <div className="h-4 w-full bg-gray-700 rounded" />
                            <div className="h-4 w-3/4 bg-gray-700 rounded" />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : novelStories.length > 0 ? (
                    <div className="bg-gray-800/50 rounded-xl overflow-hidden border border-purple-500/30 shadow-lg">
                      {novelStories.map((story) => (
                        <StorySerialCard key={story.id} story={story} />
                      ))}
                      <div ref={serialSentinelRef} className="h-10" />
                      {isFetchingNextSerialPage && (
                        <div className="flex justify-center py-4 bg-gray-800/30">
                          <Loader2 className="w-6 h-6 animate-spin text-purple-500" />
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="bg-gray-800/50 rounded-xl p-8 text-center text-gray-400 border border-gray-700/50">
                      등록된 원작소설이 없습니다.
                    </div>
                  )}
                </>
              )}

              {/* 원작챗 탭: 캐릭터 격자 */}
              {origSerialTab === 'origchat' && (
                <>
                  {loading ? (
                    <div className={gridColumnClasses}>
                      {Array.from({ length: 12 }).map((_, i) => (
                        <CharacterCardSkeleton key={i} />
                      ))}
                    </div>
                  ) : origSerialCharacters.length > 0 ? (
                    <>
                      <div className={gridColumnClasses}>
                        {origSerialCharacters.map((c) => (
                          <CharacterCard key={c.id} character={c} showOriginBadge />
                        ))}
                      </div>
                      <div ref={sentinelRef} className="h-10" />
                      {isFetchingNextPage && (
                        <div className={`${gridColumnClasses} mt-3`}>
                          {Array.from({ length: 6 }).map((_, i) => (
                            <CharacterCardSkeleton key={`sk-${i}`} />
                          ))}
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="bg-gray-800/50 rounded-xl p-8 text-center text-gray-400 border border-gray-700/50">
                      등록된 원작챗 캐릭터가 없습니다.
                    </div>
                  )}
                </>
              )}
            </section>
          )}

          {!isCharacterTab && !isOrigSerialTab && (
            <>
          {/* 1) 지금 대화가 활발한 원작 캐릭터 */}
          <ErrorBoundary>
            <TopOrigChat />
          </ErrorBoundary>

          {/* 2) 지금 대화가 활발한 캐릭터 */}
          <ErrorBoundary>
            <TrendingCharacters />
          </ErrorBoundary>

          {/* 3) 지금 인기 있는 원작 웹소설 */}
          <ErrorBoundary>
            <TopStories />
          </ErrorBoundary>

          {/* 4) 챕터8이 추천하는 캐릭터 */}
          <ErrorBoundary>
            <RecommendedCharacters />
          </ErrorBoundary>

          {/* 5) 주인공으로 다시 몰입하는 원작소설 - 스토리다이브 */}
          {(() => {
            // ✅ 구좌 구성:
            // - 스토리다이브 사용 이력이 있으면: 최근 스토리다이브(최근 콘텐츠)
            // - 사용 이력이 없으면: 추천(기준 기반)
            //
            // ✅ 노출 규칙:
            // - 0개면 구좌 비노출
            // - 5개 미만이면 있는 만큼만 노출
            const hasCover = (url) => {
              const s = String(url || '').trim();
              return !!s && s.toLowerCase() !== 'null' && s.toLowerCase() !== 'undefined';
            };

            // 로그인 상태에서는 "실제로 다이브한 것만" 노출:
            // - cover_url 없는 항목(=표지 준비중 placeholder로 보이는 카드)은 아예 제외한다.
            const recentBaseRaw = Array.isArray(recentStoryDive) ? recentStoryDive : [];
            const recentBase = recentBaseRaw.filter((it) => hasCover(it?.cover_url));

            // 비로그인 상태(또는 최근이 없을 때 추천을 쓰는 흐름)도 cover 없는 카드는 제외해 품질을 유지한다.
            const featuredRaw = Array.isArray(storyDiveStories) ? storyDiveStories : [];
            const featuredBase = featuredRaw.filter((it) => hasCover(it?.cover_url));

            // ✅ 요구사항: 로그인 상태는 "최근(실제 다이브)"만. 추천으로 채우지 않는다.
            const useRecent = !!isAuthenticated;
            const base = useRecent ? recentBase : featuredBase;
            const loading =
              // 로그인 유저는 "최근 여부 판단"이 끝날 때까지 먼저 기다린다(깜빡임 방지)
              (isAuthenticated && recentStoryDiveLoading)
                ? true
                : (useRecent ? false : storyDiveStoriesLoading);

            // 0개면 구좌 비노출 (로딩 중이면 스켈레톤만 노출)
            if (!loading && base.length === 0) return null;

            const placeholderCover = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="200" height="267"%3E%3Crect fill="%23374151" width="200" height="267"/%3E%3Ctext x="50%25" y="50%25" fill="%239ca3af" text-anchor="middle" dominant-baseline="middle" font-size="12"%3E표지 준비중%3C/text%3E%3C/svg%3E';

            return (
              <section className="mt-8">
                <h2 className="text-xl font-bold text-white mb-4">
                  주인공으로 다시 몰입하는 원작소설 - 스토리다이브
                </h2>
                <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-hide">
                  {loading ? (
                    Array.from({ length: 5 }).map((_, idx) => (
                      <div key={`sd-sk-${idx}`} className="flex-shrink-0 w-[200px]">
                        <div className="relative aspect-[3/4] rounded-lg overflow-hidden mb-2 bg-gray-900 border border-gray-700/50">
                          <Skeleton className="w-full h-full bg-gray-800" />
                        </div>
                        <Skeleton className="h-5 w-40 bg-gray-800" />
                      </div>
                    ))
                  ) : (
                    base.slice(0, 10).map((s, idx) => {
                      const key = s?.session_id || s?.id || `slot-${idx}`;
                      const coverSrc = getThumbnailUrl(s?.cover_url, 600) || placeholderCover;
                      const intro = String(s?.excerpt || '').trim();
                      const overlayText = intro || '이 작품에서 직접 주인공이 되어보세요.';
                      return (
                        <div
                          key={key}
                          className="flex-shrink-0 w-[200px] cursor-pointer group"
                          onClick={() => {
                            if (useRecent) {
                              if (!requireAuth('스토리 다이브')) return;
                              if (!s?.novel_id || !s?.session_id) return;
                              navigate(`/storydive/novels/${s.novel_id}?sessionId=${encodeURIComponent(String(s.session_id))}`);
                              return;
                            }
                            if (!s?.id) return;
                            // 추천 구좌는 1화 뷰어로 바로 진입
                            navigate(`/stories/${s.id}/chapters/1`);
                          }}
                        >
                          <div className="relative aspect-[3/4] rounded-lg overflow-hidden mb-2 bg-gray-900 border border-gray-700/50 group-hover:border-gray-600 transition-colors">
                            <img
                              src={coverSrc}
                              alt={s?.title || '작품 표지'}
                              className="w-full h-full object-cover"
                              onError={(e) => {
                                e.target.src = placeholderCover;
                              }}
                            />
                            <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent" />
                            <div className="absolute bottom-0 left-0 right-0 p-3">
                              <p
                                className="text-white text-sm leading-snug"
                                style={{
                                  textShadow: '0 2px 10px rgba(0,0,0,0.85)',
                                  display: '-webkit-box',
                                  WebkitLineClamp: 3,
                                  WebkitBoxOrient: 'vertical',
                                  overflow: 'hidden',
                                }}
                                title={overlayText}
                              >
                                {overlayText}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <Badge
                              className="bg-blue-600/80 hover:bg-blue-600 text-white text-[10px] px-2 py-0.5 max-w-full truncate"
                              title={s?.title || ''}
                            >
                              {s?.title || '작품명'}
                            </Badge>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </section>
            );
          })()}

          {/* 6) 일상을 캐릭터와 같이 공유해보세요 (데이터가 있을 때만 노출) */}
          {(dailyTagCharactersLoading || dailyTagCharacters.length > 0) && (
            <section className="mt-8">
              <h2 className="text-xl font-bold text-white mb-4">일상을 캐릭터와 같이 공유해보세요</h2>

              {dailyTagCharactersLoading ? (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                  {Array.from({ length: DAILY_CHARACTER_LIMIT }).map((_, idx) => (
                    <div
                      key={`daily-sk-${idx}`}
                      className="bg-gray-800/40 rounded-lg p-3 border border-gray-700/50 animate-pulse"
                    >
                      <div className="flex items-center gap-3 mb-2">
                        <div className="w-10 h-10 rounded-full bg-gray-700 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="h-3 w-20 bg-gray-700 rounded mb-2" />
                          <div className="h-3 w-32 bg-gray-700 rounded" />
                        </div>
                      </div>
                      <div className="h-4 w-full bg-gray-700 rounded" />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                  {dailyTagCharacters.slice(0, DAILY_CHARACTER_LIMIT).map((char, idx) => {
                    const id = char?.id;
                    const key = id || `daily-${idx}`;
                    const name = String(char?.name || '').trim() || '이름 없음';
                    const title = String(char?.description || '').trim();
                    const baseImg = char?.avatar_url || char?.thumbnail_url || '';
                    const imgSrc =
                      getThumbnailUrl(baseImg, 240) ||
                      resolveImageUrl(baseImg) ||
                      '';
                    const clickable = !!id;

                    return (
                      <div
                        key={key}
                        className={[
                          'bg-gray-800/40 rounded-lg p-3 transition-all border border-gray-700/50 hover:border-gray-600',
                          clickable ? 'cursor-pointer hover:bg-gray-800/60' : 'cursor-default opacity-80'
                        ].join(' ')}
                        role={clickable ? 'button' : undefined}
                        tabIndex={clickable ? 0 : undefined}
                        onClick={() => {
                          if (!id) return;
                          navigate(`/ws/chat/${id}`);
                        }}
                        onKeyDown={(e) => {
                          if (!clickable) return;
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            navigate(`/ws/chat/${id}`);
                          }
                        }}
                        aria-label={clickable ? `${name} 캐릭터와 대화하기` : undefined}
                      >
                        <div className="flex items-center gap-3 mb-2">
                          <div className="w-10 h-10 rounded-full bg-gray-700 flex items-center justify-center flex-shrink-0 overflow-hidden">
                            {imgSrc ? (
                              <img
                                src={imgSrc}
                                alt={name}
                                className="w-full h-full object-cover object-top"
                                onError={(e) => {
                                  e.target.style.display = 'none';
                                  const next = e.target.nextSibling;
                                  if (next) next.style.display = 'flex';
                                }}
                              />
                            ) : null}
                            <span className={`text-lg ${imgSrc ? 'hidden' : ''}`}>{name.charAt(0)}</span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-xs text-gray-400 truncate">{name}</div>
                          </div>
                          <Badge className="bg-yellow-500/90 text-black hover:bg-yellow-500 text-[10px] px-2 py-0.5">
                            일상
                          </Badge>
                        </div>
                        <div className="text-sm text-gray-200 leading-snug line-clamp-2">
                          {title || '지금 대화를 시작해보세요.'}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          )}

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

          {/* 탐색 섹션 (원작연재 탭에서는 숨김) */}
          {!isOrigSerialTab && (
          <section className="mt-8 mb-10">
            {isCharacterTab ? (
              <div className="mb-5">
                <div className="flex flex-wrap gap-2">
                  {/* ✅ 기본값: 전체 */}
                  <button
                    type="button"
                    onClick={() => setSelectedTags([])}
                    className={`px-3 py-1 rounded-full border text-sm ${
                      selectedTags.length === 0
                        ? 'bg-yellow-500 text-black border-yellow-400'
                        : 'bg-gray-800 text-gray-200 border-gray-700 hover:bg-gray-750'
                    }`}
                  >
                    전체
                  </button>
                  {visibleCharacterTabTags.map((t) => {
                    const slug = String(t?.slug || '').trim();
                    const name = String(t?.name || t?.slug || '').trim();
                    if (!slug || !name) return null;
                    const active = selectedTags.includes(slug);
                    return (
                      <button
                        type="button"
                        key={t.id || slug}
                        onClick={() => setSelectedTags((prev) => (prev.length === 1 && prev[0] === slug ? [] : [slug]))}
                        className={`px-3 py-1 rounded-full border text-sm ${
                          active
                            ? 'bg-yellow-500 text-black border-yellow-400'
                            : 'bg-gray-800 text-gray-200 border-gray-700 hover:bg-gray-750'
                        }`}
                        title={name}
                      >
                        {name}
                      </button>
                    );
                  })}

                  {sortedTagsForCharacterTab.length > visibleTagLimit && (
                    <button
                      type="button"
                      onClick={() => setShowAllTags((v) => !v)}
                      className="px-3 py-1 rounded-full bg-gray-800 text-gray-200 border border-gray-700 text-sm"
                    >
                      {showAllTags ? '접기' : '더보기'}
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <h2 className="text-xl font-normal text-white mb-3">탐색</h2>
            )}

            {loading ? (
              <div className={gridColumnClasses}>
                {Array.from({ length: 12 }).map((_, i) => (
                  <CharacterCardSkeleton key={i} />
                ))}
              </div>
            ) : hasGridItems ? (
              <>
                <ErrorBoundary>
                  <div className={gridColumnClasses}>
                    {displayGridItems.map((item) => (
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
                  <div className={`${gridColumnClasses} mt-3`}>
                    {Array.from({ length: 6 }).map((_, i) => (
                      <CharacterCardSkeleton key={`sk-${i}`} />
                    ))}
                  </div>
                )}
                {shouldShowPagination && (
                  <div className="mt-10 border-t border-gray-800 pt-6 pb-8">
                    <div className="flex flex-wrap items-center justify-center gap-2">
                      <button
                        type="button"
                        onClick={handlePrevPage}
                        disabled={characterPage === 1}
                        className={`h-9 px-4 rounded-full border text-sm transition-colors ${
                          characterPage === 1
                            ? 'border-gray-700 text-gray-600 cursor-not-allowed'
                            : 'border-gray-700 text-gray-200 hover:bg-gray-800'
                        }`}
                      >
                        이전
                      </button>
                      {paginationPages.map((page) => (
                        <button
                          key={page}
                          type="button"
                          onClick={() => goToPage(page)}
                          className={`h-9 px-3 rounded-full border text-sm transition-colors ${
                            characterPage === page
                              ? 'border-purple-500 bg-purple-600 text-white'
                              : 'border-gray-700 text-gray-200 hover:bg-gray-800'
                          }`}
                        >
                          {page}
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={handleNextPage}
                        disabled={characterPage === totalCharacterPages}
                        className={`h-9 px-4 rounded-full border text-sm transition-colors ${
                          characterPage === totalCharacterPages
                            ? 'border-gray-700 text-gray-600 cursor-not-allowed'
                            : 'border-gray-700 text-gray-200 hover:bg-gray-800'
                        }`}
                      >
                        다음
                      </button>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="text-center py-16">
                <p className="text-gray-400">
                  선택한 태그에는 아직 캐릭터가 없어요.
                </p>
                <div className="mt-6 flex items-center justify-center">
                  <Link
                    to="/characters/create"
                    onClick={(e) => {
                      if (!requireAuth('캐릭터 생성')) {
                        e.preventDefault();
                      }
                    }}
                    className="flex items-center justify-center px-4 py-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-colors font-medium text-sm shadow-lg"
                  >
                    <Plus className="w-5 h-5 mr-2" />
                    캐릭터 생성
                  </Link>
                </div>
              </div>
            )}
          </section>
          )}

      </main>
      </div>
      {/* 로그인 유도 모달 */}
    </AppLayout>
  );
};

export default HomePage;

