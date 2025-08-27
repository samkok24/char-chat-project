/**
 * 내 캐릭터 목록 페이지
 */

import React, { useState, useEffect } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../contexts/AuthContext';
import { charactersAPI, usersAPI } from '../lib/api';
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
import AppLayout from '../components/layout/AppLayout';
import { CharacterCard as SharedCharacterCard, CharacterCardSkeleton as SharedCharacterCardSkeleton } from '../components/CharacterCard';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/tabs';

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

  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    loadMyCharacters();
  }, []);

  const loadMyCharacters = async () => {
    setLoading(true);
    try {
      const response = await charactersAPI.getMyCharacters();
      setCharacters(response.data);
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
    } catch (err) {
      console.error('캐릭터 삭제 실패:', err);
      alert('캐릭터 삭제에 실패했습니다.');
    }
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
              <span>{(character.chat_count || 0).toLocaleString()} 대화</span>
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
              onClick={() => navigate(-1)}
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

        <Tabs defaultValue={location.hash === '#favorites' ? 'favorites' : 'mine'} className="mt-2">
          <TabsList className="bg-gray-800 border border-gray-700">
            <TabsTrigger value="mine">내가 만든 캐릭터</TabsTrigger>
            <TabsTrigger value="favorites">내가 좋아하는 캐릭터</TabsTrigger>
          </TabsList>
          {/* 내가 만든 캐릭터 탭 */}
          <TabsContent value="mine">
            {error && (<div className="text-red-400 mb-4">{error}</div>)}
            {characters.length > 0 ? (
              <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3 mt-4">
                {characters.map((character) => (
                  <SharedCharacterCard key={character.id} character={character} />
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

          {/* 내가 좋아하는 캐릭터 탭 */}
          <TabsContent value="favorites">
            <FavoritesTab />
          </TabsContent>
        </Tabs>
      </main>
    </div>
    </AppLayout>
  );
};

export default MyCharactersPage; 