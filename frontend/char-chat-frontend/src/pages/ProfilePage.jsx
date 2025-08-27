/**
 * 마이페이지
 */

import React, { useState, useEffect } from 'react';
import {useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { usersAPI } from '../lib/api'; 
import Header from '../components/Header';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '../components/ui/avatar';
import { resolveImageUrl } from '../lib/images';
import { Badge } from '../components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { 
  User,
  Mail,
  Calendar,
  MessageCircle,
  Heart,
  Gem,
  Edit,
  Save,
  X,
  Users,
  Loader2,
  AlertCircle,
  ArrowLeft
} from 'lucide-react';
import { RecentCharactersList } from '../components/RecentCharactersList'; // RecentCharactersList 추가
import { Separator } from '../components/ui/separator';

// import { PageLoader } from '../App';

// PageLoader가 없다면 이 부분을 추가하거나, App.jsx에서 import 해야 합니다.
const PageLoader = () => (
  <div className="min-h-screen flex items-center justify-center">
    <Loader2 className="w-8 h-8 animate-spin text-purple-600" />
  </div>
);

const ProfilePage = () => {
  // --- 기존의 정적인 데이터는 모두 삭제하고, 아래 로직으로 교체합니다. ---
  
  // [추가] URL 파라미터와 현재 로그인 유저 정보를 가져옵니다.
  const { userId: paramUserId } = useParams();
  const { user: currentUser, isAuthenticated } = useAuth();
  const navigate = useNavigate();

  // [추가] 표시할 프로필의 최종 userId를 결정합니다.
  const userIdToLoad = paramUserId || currentUser?.id;

  // [추가] API 데이터를 담을 상태들을 선언합니다.
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // [추가] API를 호출하여 데이터를 가져오는 useEffect 로직입니다.
  useEffect(() => {
    if (!userIdToLoad) {
      if (!isAuthenticated) navigate('/login');
      setLoading(false);
      return;
    }
    const loadProfile = async () => {
      setLoading(true);
      try {
        const response = await usersAPI.getUserProfile(userIdToLoad);
        setProfile(response.data);
      } catch (err) {
        setError('프로필 정보를 불러올 수 없습니다.');
      } finally {
        setLoading(false);
      }
    };
    loadProfile();
  }, [userIdToLoad, isAuthenticated, navigate]);

  // [추가] 통계 카드를 위한 재사용 컴포넌트입니다.
  const StatCard = ({ title, value, icon: Icon }) => (
    <Card className="text-center p-4">
      <CardHeader className="p-0 mb-2">
        <CardTitle className="text-sm font-medium text-gray-500 dark:text-gray-400">{title}</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="text-3xl font-bold flex items-center justify-center">
          <Icon className="w-6 h-6 mr-2 text-purple-500" />
          {value.toLocaleString()}
        </div>
      </CardContent>
    </Card>
  );

  // [추가] 로딩 및 에러 상태에 대한 UI 처리입니다.
  if (loading) {
    return <PageLoader />;
  }

  if (error || !profile) {
    return (
      <div className="flex flex-col items-center justify-center h-screen">
        <AlertCircle className="w-12 h-12 text-red-500 mb-4" />
        <h3 className="text-lg font-medium">오류</h3>
        <p className="text-gray-600 mb-4">{error || '프로필을 찾을 수 없습니다.'}</p>
        <Button onClick={() => navigate('/')} variant="outline">홈으로 돌아가기</Button>
      </div>
    );
  }

  // [추가] 내 프로필인지 다른 사람 프로필인지 확인하는 변수입니다.
  const isOwnProfile = currentUser?.id === profile.id;
  const joinDate = new Date(profile.created_at).toLocaleDateString('ko-KR');

  // --- 기존의 return 문 전체를 아래 내용으로 교체합니다. ---
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 text-gray-800 dark:text-gray-200">
      <div className="max-w-4xl mx-auto p-4 sm:p-6 lg:p-8">
        {/* [수정] 뒤로가기 버튼 추가 */}
        <header className="mb-6">
          <Button variant="ghost" onClick={() => navigate(-1)}>
            <ArrowLeft className="w-5 h-5 mr-2" />
            뒤로 가기
          </Button>
        </header>

        {/* [수정] 프로필 카드: 더미 데이터 대신 'profile' 상태의 실제 데이터를 사용 */}
        <Card className="mb-8 overflow-hidden">
          <CardContent className="p-6 flex flex-col sm:flex-row items-center space-y-4 sm:space-y-0 sm:space-x-6">
            <Avatar className="w-24 h-24 text-4xl">
              <AvatarImage src={resolveImageUrl(profile.avatar_url)} alt={profile.username} />
              <AvatarFallback>{profile.username.charAt(0).toUpperCase()}</AvatarFallback>
            </Avatar>
            <div className="flex-grow text-center sm:text-left">
              <div className="flex items-center justify-center sm:justify-start space-x-4 mb-1">
                <h1 className="text-2xl font-bold">{profile.username}</h1>
                {isOwnProfile && ( // [수정] 내 프로필일 때만 '프로필 수정' 버튼 표시
                  <Button onClick={() => navigate('/profile/edit')} variant="outline" size="sm">
                    프로필 수정
                  </Button>
                )}
              </div>
              <p className="text-sm text-gray-500">{profile.email}</p>
              <p className="text-sm text-gray-500 mt-1">가입일: {joinDate}</p>
              <p className="mt-3 text-base">{profile.bio || '자기소개가 없습니다.'}</p>
            </div>
          </CardContent>
        </Card>

        {/* [수정] 통계 카드: 더미 데이터 대신 'profile' 상태의 실제 데이터를 사용 */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <StatCard title="보유 루비" value={0} icon={Gem} /> {/* TODO: 포인트 API 연동 */}
          <StatCard title="만든 캐릭터" value={profile.character_count} icon={Users} />
          <StatCard title="총 대화 수" value={profile.total_chat_count} icon={MessageCircle} />
          <StatCard title="받은 좋아요" value={profile.total_like_count} icon={Heart} />
        </div>

        {/* [수정] 탭 메뉴: 캐릭터 수를 동적으로 표시 */}
        <Tabs defaultValue="characters" className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="characters">캐릭터 ({profile.character_count})</TabsTrigger>
            <TabsTrigger value="liked">좋아요한 캐릭터</TabsTrigger>
            <TabsTrigger value="history">대화 기록</TabsTrigger>
          </TabsList>
          <TabsContent value="characters" className="mt-6">
            <p>내가 만든 캐릭터 목록이 여기에 표시됩니다.</p>
            {/* TODO: /users/{id}/characters API 연동 */}
          </TabsContent>
          <TabsContent value="liked" className="mt-6">
            <p>준비 중인 기능입니다.</p>
          </TabsContent>
          <TabsContent value="history" className="mt-6">
            <div className="bg-gray-800 rounded-lg p-4">
              <h3 className="text-white font-semibold mb-4">최근 대화</h3>
              <RecentCharactersList limit={4} />
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

export default ProfilePage; 