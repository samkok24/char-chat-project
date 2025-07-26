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
import { RecentCharactersList } from '../components/RecentCharactersList'; // 추가
import { CharacterCard, CharacterCardSkeleton } from '../components/CharacterCard'; // 수정

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
    <div className="min-h-screen bg-gray-900 text-gray-200">
      {/* 헤더 */}
      <header className="bg-gray-800/80 backdrop-blur-sm shadow-sm border-b border-gray-700 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center space-x-4">
              <Link to="/" className="flex items-center space-x-2">
                <div className="w-8 h-8 bg-gradient-to-r from-purple-600 to-blue-600 rounded-lg flex items-center justify-center">
                  <MessageCircle className="w-5 h-5 text-white" />
                </div>
                <h1 className="text-xl font-bold text-white">AI 캐릭터 챗</h1>
              </Link>
            </div>

            <div className="flex items-center space-x-4">
              {isAuthenticated ? (
                <>
                  <Button variant="outline" onClick={createCharacter} className="text-white border-gray-600 hover:bg-gray-700 hover:text-white">
                    <Plus className="w-4 h-4 mr-2" />
                    캐릭터 생성
                  </Button>
                  <Link to="/my-characters">
                    <Button variant="outline" className="text-white border-gray-600 hover:bg-gray-700 hover:text-white">
                      내 캐릭터
                    </Button>
                  </Link>
                  <Button variant="outline" className="text-white border-gray-600 hover:bg-gray-700 hover:text-white">
                    <BookOpen className="w-4 h-4 mr-2" />
                    스토리
                  </Button>
                  
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
                    <Button variant="outline" className="text-white border-gray-600 hover:bg-gray-700 hover:text-white">
                      <LogIn className="w-4 h-4 mr-2" />
                      로그인
                    </Button>
                  </Link>
                  <Link to="/login">
                    <Button className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700">
                      <UserPlus className="w-4 h-4 mr-2" />
                      회원가입
                    </Button>
                  </Link>
                </>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* 메인 컨텐츠 */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        
        {/* 검색 */}
        <section className="mb-12">
          <form onSubmit={handleSearch} className="max-w-xl mx-auto">
            <div className="relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
              <Input
                type="text"
                placeholder="어떤 캐릭터를 찾아볼까요?"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-12 pr-4 py-3 bg-gray-800 border-gray-700 text-lg rounded-full focus:ring-purple-500 focus:border-purple-500"
              />
            </div>
          </form>
        </section>

        {/* 최근 대화한 캐릭터 (로그인 시에만 보임) */}
        {isAuthenticated && (
          <section className="mb-12">
            <h2 className="text-2xl font-bold mb-4 flex items-center">
              <Sparkles className="w-6 h-6 mr-2 text-purple-400" />
              최근 대화
            </h2>
            <RecentCharactersList limit={4} />
          </section>
        )}

        {/* 캐릭터 섹션 */}
        <section className="mb-8">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="text-2xl font-bold text-white mb-1">탐색</h3>
              <p className="text-gray-400">다른 사용자들이 만든 흥미로운 AI 캐릭터들을 만나보세요</p>
            </div>
            <div className="flex items-center space-x-2 text-sm text-gray-400">
              <Users className="w-4 h-4" />
              <span>{characters.length}개의 캐릭터</span>
            </div>
          </div>

          {loading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
              {Array.from({ length: 10 }).map((_, i) => (
                <CharacterCardSkeleton key={i} />
              ))}
            </div>
          ) : characters.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
              {characters.map((character) => (
                <CharacterCard key={character.id} character={character} />
              ))}
            </div>
          ) : (
            <div className="text-center py-16 bg-gray-800 rounded-lg">
              <MessageCircle className="w-16 h-16 text-gray-500 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-white mb-2">
                캐릭터가 없습니다
              </h3>
              <p className="text-gray-400 mb-4">
                아직 공개된 캐릭터가 없습니다. 첫 번째 캐릭터를 만들어보세요!
              </p>
              {isAuthenticated && (
                <Button 
                  onClick={createCharacter}
                  className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  캐릭터 생성하기
                </Button>
              )}
            </div>
          )}
        </section>
      </main>
    </div>
  );
};

export default HomePage;

