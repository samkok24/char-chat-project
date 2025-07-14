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

  const CharacterCard = ({ character }) => (
    <Card 
      className="hover:shadow-lg transition-all duration-200 cursor-pointer group hover:scale-105"
      onClick={() => viewCharacterDetail(character.id)}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start space-x-3">
          <Avatar className="w-12 h-12">
            <LazyLoadImage
              alt={character.name}
              src={character.avatar_url}
              effect="blur"
              className="w-full h-full object-cover rounded-full"
              wrapperClassName="w-full h-full"
            />
            <AvatarFallback className="bg-gradient-to-r from-purple-500 to-blue-500 text-white">
              {character.name.charAt(0)}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <CardTitle className="text-lg truncate">{character.name}</CardTitle>
            <CardDescription className="text-sm">
              by {character.creator_username || 'Unknown'}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <p className="text-sm text-gray-600 mb-4 line-clamp-3">
          {character.description || '설명이 없습니다.'}
        </p>
        
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-4 text-sm text-gray-500">
            <div className="flex items-center space-x-1">
              <MessageCircle className="w-4 h-4" />
              <span>{(character.chat_count || 0).toLocaleString()}</span>
            </div>
            <div className="flex items-center space-x-1">
              <Heart className="w-4 h-4" />
              <span>{character.like_count || 0}</span>
            </div>
          </div>
          <Badge variant="secondary" className="bg-green-100 text-green-800">
            공개
          </Badge>
        </div>

        <Button
          onClick={(e) => {
            e.stopPropagation(); // 카드 전체의 클릭 이벤트 전파 방지
            startChat(character.id); // "대화하기" 버튼은 startChat 함수 호출
          }}
          className="w-full bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 transition-all duration-200"
          size="sm"
        >
          <MessageCircle className="w-4 h-4 mr-2" />
          대화하기
        </Button>
      </CardContent>
    </Card>
  );

  const CharacterCardSkeleton = () => (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start space-x-3">
          <Skeleton className="w-12 h-12 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="space-y-2 mb-4">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>
        <Skeleton className="h-9 w-full" />
      </CardContent>
    </Card>
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-blue-50 to-indigo-50">
      {/* 헤더 */}
      <header className="bg-white/80 backdrop-blur-sm shadow-sm border-b sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center space-x-4">
              <Link to="/" className="flex items-center space-x-2">
                <div className="w-8 h-8 bg-gradient-to-r from-purple-600 to-blue-600 rounded-lg flex items-center justify-center">
                  <MessageCircle className="w-5 h-5 text-white" />
                </div>
                <h1 className="text-xl font-bold text-gray-900">AI 캐릭터 챗</h1>
              </Link>
            </div>

            <div className="flex items-center space-x-4">
              {isAuthenticated ? (
                <>
                  <Button variant="outline" onClick={createCharacter}>
                    <Plus className="w-4 h-4 mr-2" />
                    캐릭터 생성
                  </Button>
                  <Link to="/my-characters">
                    <Button variant="outline">
                      내 캐릭터
                    </Button>
                  </Link>
                  <Button variant="outline">
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
                    <Button variant="outline">
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
        {/* 환영 섹션 */}
        <div className="text-center mb-12">
          <div className="mb-6">
            <div className="w-20 h-20 bg-gradient-to-r from-purple-600 to-blue-600 rounded-full flex items-center justify-center mx-auto mb-4">
              <Sparkles className="w-10 h-10 text-white" />
            </div>
          </div>
          
          <h2 className="text-4xl font-bold text-gray-900 mb-4">
            AI 캐릭터와 대화하고 스토리를 만들어보세요
          </h2>
          <p className="text-xl text-gray-600 mb-8 max-w-3xl mx-auto">
            다양한 개성을 가진 AI 캐릭터들과 대화하거나, 나만의 캐릭터를 만들어 특별한 스토리를 생성해보세요. 
            무한한 상상력의 세계가 여러분을 기다립니다.
          </p>
          
          {/* 검색 */}
          <form onSubmit={handleSearch} className="max-w-md mx-auto mb-8">
            <div className="relative">
              <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
              <Input
                type="text"
                placeholder="캐릭터 검색..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 pr-4 py-2 bg-white/80 backdrop-blur-sm"
              />
            </div>
          </form>

          {!isAuthenticated && (
            <div className="bg-white/80 backdrop-blur-sm rounded-lg p-6 mb-8 max-w-2xl mx-auto">
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                더 많은 기능을 이용하려면 가입하세요!
              </h3>
              <p className="text-gray-600 mb-4">
                회원가입하면 나만의 캐릭터를 만들고, 대화 기록을 저장하며, 스토리를 생성할 수 있습니다.
              </p>
              <div className="flex justify-center space-x-4">
                <Link to="/login">
                  <Button className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700">
                    무료 회원가입
                  </Button>
                </Link>
                <Link to="/login">
                  <Button variant="outline">
                    로그인
                  </Button>
                </Link>
              </div>
            </div>
          )}
        </div>

        {/* 캐릭터 섹션 */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="text-2xl font-bold text-gray-900 mb-2">인기 캐릭터</h3>
              <p className="text-gray-600">다른 사용자들이 만든 흥미로운 AI 캐릭터들을 만나보세요</p>
            </div>
            <div className="flex items-center space-x-2 text-sm text-gray-500">
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
            <div className="text-center py-16">
              <MessageCircle className="w-16 h-16 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">
                캐릭터가 없습니다
              </h3>
              <p className="text-gray-600 mb-4">
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
        </div>

        {/* 기능 소개 섹션 */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mt-16">
          <div className="text-center">
            <div className="w-16 h-16 bg-gradient-to-r from-purple-500 to-pink-500 rounded-full flex items-center justify-center mx-auto mb-4">
              <MessageCircle className="w-8 h-8 text-white" />
            </div>
            <h3 className="text-xl font-semibold text-gray-900 mb-2">AI 채팅</h3>
            <p className="text-gray-600">
              다양한 개성을 가진 AI 캐릭터들과 자연스러운 대화를 나누세요
            </p>
          </div>
          
          <div className="text-center">
            <div className="w-16 h-16 bg-gradient-to-r from-blue-500 to-cyan-500 rounded-full flex items-center justify-center mx-auto mb-4">
              <BookOpen className="w-8 h-8 text-white" />
            </div>
            <h3 className="text-xl font-semibold text-gray-900 mb-2">스토리 생성</h3>
            <p className="text-gray-600">
              AI와 함께 창의적인 스토리를 만들고 나만의 세계를 구축하세요
            </p>
          </div>
          
          <div className="text-center">
            <div className="w-16 h-16 bg-gradient-to-r from-green-500 to-teal-500 rounded-full flex items-center justify-center mx-auto mb-4">
              <Users className="w-8 h-8 text-white" />
            </div>
            <h3 className="text-xl font-semibold text-gray-900 mb-2">캐릭터 생성</h3>
            <p className="text-gray-600">
              나만의 독특한 AI 캐릭터를 만들고 다른 사용자들과 공유하세요
            </p>
          </div>
        </div>
      </main>
    </div>
  );
};

export default HomePage;

