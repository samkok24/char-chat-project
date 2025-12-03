import React, { useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { usersAPI, charactersAPI, storiesAPI } from '../lib/api';
import AppLayout from '../components/layout/AppLayout';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '../components/ui/avatar';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/tabs';
import { CharacterCard as SharedCharacterCard, CharacterCardSkeleton as SharedCharacterCardSkeleton } from '../components/CharacterCard';
import StoryExploreCard from '../components/StoryExploreCard';
import { resolveImageUrl } from '../lib/images';
import { Loader2, ArrowLeft, AlertCircle } from 'lucide-react';

const CreatorInfoPage = () => {
  const { userId } = useParams();
  const navigate = useNavigate();

  const { data: profile, isLoading: profileLoading, error: profileError } = useQuery({
    queryKey: ['creator-profile', userId],
    queryFn: async () => {
      const res = await usersAPI.getUserProfile(userId);
      return res.data;
    },
    enabled: !!userId,
  });

  const [sort, setSort] = useState('latest');
  const sortParam = useMemo(() => (sort === 'popular' ? 'likes' : 'recent'), [sort]);

  const { data: characters = [], isLoading: charsLoading, error: charsError } = useQuery({
    queryKey: ['creator-characters', userId, sortParam],
    queryFn: async () => {
      const res = await charactersAPI.getCharacters({
        creator_id: userId,
        sort: sortParam,
        limit: 60,
      });
      const list = res.data || [];
      // 공개 캐릭터만 노출
      return Array.isArray(list) ? list.filter(c => c?.is_public !== false) : [];
    },
    enabled: !!userId,
    staleTime: 5 * 60 * 1000,
  });

  // 스토리: 전체 목록에서 정렬해 받아와 클라이언트에서 creator_id로 필터
  const { data: stories = [], isLoading: storiesLoading, error: storiesError } = useQuery({
    queryKey: ['creator-stories', userId, sortParam],
    queryFn: async () => {
      const res = await storiesAPI.getStories({
        sort: sortParam,
        limit: 60,
        creator_id: userId,
      });
      const list = Array.isArray(res.data?.stories) ? res.data.stories : (Array.isArray(res.data) ? res.data : []);
      return list.filter(s => s?.is_public !== false);
    },
    enabled: !!userId,
    staleTime: 5 * 60 * 1000,
  });

  const getErrorMessage = (error, fallback = '데이터를 불러오지 못했습니다.') =>
    error?.response?.data?.detail || error?.message || fallback;

  return (
    <AppLayout>
      <div className="min-h-screen bg-gray-900 text-gray-200">
        <div className="max-w-7xl mx-auto px-4 py-8 sm:py-10">
          <header className="mb-6">
            <Button variant="ghost" onClick={() => navigate(-1)}>
              <ArrowLeft className="w-5 h-5 mr-2" />
              뒤로 가기
            </Button>
          </header>

          <Card className="bg-gray-800 border-gray-700 mb-8">
            <CardContent className="p-6 flex items-center gap-4">
              {profileLoading ? (
                <div className="flex items-center gap-4">
                  <div className="w-20 h-20 rounded-full bg-gray-700" />
                  <div>
                    <div className="w-40 h-5 bg-gray-700 mb-2" />
                    <div className="w-64 h-4 bg-gray-700" />
                  </div>
                </div>
              ) : profileError ? (
                <div className="flex items-center gap-3 text-red-400">
                  <AlertCircle className="w-5 h-5" />
                  <p>{getErrorMessage(profileError, '크리에이터 정보를 불러올 수 없습니다.')}</p>
                </div>
              ) : (
                <>
                  <Avatar className="w-20 h-20 text-2xl">
                    <AvatarImage src={resolveImageUrl(profile?.avatar_url)} alt={profile?.username} />
                    <AvatarFallback className="bg-purple-600 text-white">
                      {profile?.username?.[0]?.toUpperCase() || 'U'}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1">
                    <h1 className="text-2xl font-bold">{profile?.username || 'Creator'}</h1>
                    <p className="text-gray-400 mt-1">
                      {profile?.greeting || profile?.bio || '자기소개가 없습니다.'}
                    </p>
                  </div>
                  {profile && (
                    <div className="flex gap-6 text-sm">
                      <div className="text-center">
                        <div className="text-gray-400">캐릭터 수</div>
                        <div className="text-white font-semibold">{profile.character_count?.toLocaleString?.() || 0}</div>
                      </div>
                      <div className="text-center">
                        <div className="text-gray-400">총 대화</div>
                        <div className="text-white font-semibold">{profile.total_chat_count?.toLocaleString?.() || 0}</div>
                      </div>
                      <div className="text-center">
                        <div className="text-gray-400">총 좋아요</div>
                        <div className="text-white font-semibold">{profile.total_like_count?.toLocaleString?.() || 0}</div>
                      </div>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          {/* 공지/댓글 탭 유지 */}
          <Card className="bg-gray-800 border-gray-700 mb-8">
            <CardContent className="p-6">
              <Tabs defaultValue="notice">
                <TabsList className="bg-gray-900 border border-gray-700">
                  <TabsTrigger value="notice">공지사항</TabsTrigger>
                  <TabsTrigger value="comments">댓글</TabsTrigger>
                </TabsList>

                <TabsContent value="notice" className="mt-4">
                  <div className="text-gray-400">등록된 공지사항이 없습니다.</div>
                </TabsContent>

                <TabsContent value="comments" className="mt-4">
                  <div className="text-gray-400">작성한 댓글 목록은 준비 중입니다.</div>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>

          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xl font-semibold">크리에이터 작품</h2>
            <div className="flex items-center gap-2">
              <Button
                variant={sort === 'latest' ? 'default' : 'outline'}
                onClick={() => setSort('latest')}
              >
                최신순
              </Button>
              <Button
                variant={sort === 'popular' ? 'default' : 'outline'}
                onClick={() => setSort('popular')}
              >
                인기순
              </Button>
            </div>
          </div>

          {/* 혼합 그리드: 캐릭터 + 웹소설 함께 */}
          <div className="mt-2">
            {(charsError || storiesError) && (
              <div className="flex items-center gap-2 text-red-400 text-sm mb-4">
                <AlertCircle className="w-4 h-4" />
                <span>{getErrorMessage(charsError || storiesError, '작품 정보를 불러올 수 없습니다.')}</span>
              </div>
            )}
            {(charsLoading || storiesLoading) ? (
              <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3 mt-4">
                {Array.from({ length: 12 }).map((_, i) => (
                  <SharedCharacterCardSkeleton key={i} />
                ))}
              </div>
            ) : (
              (() => {
                const charItems = (Array.isArray(characters) ? characters : []).map((c) => ({
                  type: 'character',
                  id: c.id,
                  data: c,
                }));
                const storyItems = (Array.isArray(stories) ? stories : []).map((s) => ({
                  type: 'story',
                  id: s.id,
                  data: s,
                }));
                const mixed = [...charItems, ...storyItems];
                if (mixed.length === 0) {
                  return (
                    <div className="text-center py-16 text-gray-400">
                      등록된 작품이 없습니다.
                    </div>
                  );
                }
                return (
                  <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3 mt-4">
                    {mixed.map((item) => (
                      item.type === 'story' ? (
                        <StoryExploreCard key={`s-${item.id}`} story={item.data} />
                      ) : (
                        <SharedCharacterCard key={`c-${item.id}`} character={item.data} />
                      )
                    ))}
                  </div>
                );
              })()
            )}
          </div>
        </div>
      </div>
    </AppLayout>
  );
};

export default CreatorInfoPage;




