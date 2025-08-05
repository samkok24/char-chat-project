/**
 * 홈페이지
 * CAVEDUCK 스타일: API 캐싱으로 성능 최적화
 */

import React, { useState, useEffect } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../contexts/AuthContext';
import { charactersAPI } from '../lib/api';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '../components/ui/avatar';
import { LazyLoadImage } from 'react-lazy-load-image-component';
import 'react-lazy-load-image-component/src/effects/blur.css';
import { Skeleton } from '../components/ui/skeleton';
import { 
  Search, 
  Plus, 
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
  Settings
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
import { CharacterCard, CharacterCardSkeleton } from '../components/CharacterCard';
import AppLayout from '../components/layout/AppLayout';

const HomePage = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const { user, isAuthenticated, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // 🚀 React Query를 사용한 캐릭터 목록 캐싱
  const { 
    data: characters = [], 
    isLoading: loading, 
    error,
    refetch 
  } = useQuery({
    queryKey: ['characters', searchQuery],
    queryFn: async () => {
      try {
        const response = await charactersAPI.getCharacters({
          search: searchQuery || undefined,
          limit: 20
        });
        return response.data;
      } catch (error) {
        console.error('캐릭터 목록 로드 실패:', error);
        return []; // 실패 시 빈 배열 반환
      }
    },
    staleTime: 30 * 1000, // 30초간 캐시 유지
    cacheTime: 10 * 60 * 1000, // 10분간 메모리에 보관
    refetchOnWindowFocus: true, // 창 포커스 시 자동 갱신
  });

  // 페이지 진입 시마다 데이터 새로고침
  useEffect(() => {
    refetch();
  }, [location, refetch]);

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

  const createCharacter = () => {
    navigate('/characters/create');
  };

  const viewCharacterDetail = (characterId) => {
    navigate(`/characters/${characterId}`);
  };

  return (
    <AppLayout>
      <div className="min-h-full bg-gray-900 text-gray-200">
        {/* 프로필 드롭다운을 우상단에 배치 */}
        <div className="absolute top-4 right-4 z-50">
          {isAuthenticated ? (
            <>
              {/* 프로필 드롭다운 메뉴 */}
              <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" className="relative h-10 w-10 rounded-full">
                        <Avatar className="h-10 w-10">
                          <AvatarImage src={user?.avatar_url} alt={user?.username} />
                          <AvatarFallback className="bg-gradient-to-r from-purple-600 to-blue-600 text-white">
                            {user?.username?.charAt(0)?.toUpperCase() || 'U'}
                          </AvatarFallback>
                        </Avatar>
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent className="w-56" align="end">
                      <DropdownMenuLabel className="font-normal">
                        <div className="flex flex-col space-y-1">
                          <p className="text-sm font-medium leading-none">{user?.username}</p>
                          <p className="text-xs leading-none text-muted-foreground">
                            {user?.email}
                          </p>
                        </div>
                      </DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => navigate('/profile')}>
                        <User className="mr-2 h-4 w-4" />
                        <span>마이페이지</span>
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => navigate('/ruby/charge')}>
                        <Gem className="mr-2 h-4 w-4 text-pink-500" />
                        <span>루비 충전</span>
                        <Badge className="ml-auto bg-pink-100 text-pink-800" variant="secondary">
                          0
                        </Badge>
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => navigate('/settings')}>
                        <Settings className="mr-2 h-4 w-4" />
                        <span>설정</span>
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={handleLogout} className="text-red-600">
                        <LogOut className="mr-2 h-4 w-4" />
                        <span>로그아웃</span>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  </>
                ) : (
                  <>
                    <Link to="/login">
                      <Button className="bg-purple-600 text-white px-6 py-2 rounded-lg font-medium border-0 transition-none hover:bg-purple-600 hover:text-white active:bg-purple-600 focus:bg-purple-600">
                        로그인
                      </Button>
                    </Link>
                  </>
                )}
            </div>

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

          {/* 최근 대화 섹션 */}
          {isAuthenticated && (
            <section className="mb-10">
              <h2 className="text-xl font-normal text-white mb-5">최근 대화</h2>
              <RecentCharactersList limit={8} />
            </section>
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
            <h2 className="text-xl font-normal text-white mb-5">탐색</h2>

            {loading ? (
              <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
                {Array.from({ length: 12 }).map((_, i) => (
                  <CharacterCardSkeleton key={i} />
                ))}
              </div>
            ) : characters.length > 0 ? (
              <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
                {characters.map((character) => (
                  <CharacterCard key={character.id} character={character} />
                ))}
              </div>
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

