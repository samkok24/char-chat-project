/**
 * 마이페이지
 */

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import Header from '../components/Header';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '../components/ui/avatar';
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
  X
} from 'lucide-react';

const ProfilePage = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [isEditing, setIsEditing] = useState(false);
  const [editedUser, setEditedUser] = useState({
    username: user?.username || '',
    email: user?.email || '',
    bio: user?.bio || ''
  });

  const handleEdit = () => {
    setIsEditing(true);
  };

  const handleCancel = () => {
    setIsEditing(false);
    setEditedUser({
      username: user?.username || '',
      email: user?.email || '',
      bio: user?.bio || ''
    });
  };

  const handleSave = async () => {
    // TODO: API 호출로 프로필 업데이트
    console.log('프로필 업데이트:', editedUser);
    setIsEditing(false);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-blue-50 to-indigo-50">
      <Header />

      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* 프로필 헤더 */}
        <Card className="mb-8">
          <CardHeader>
            <div className="flex items-start justify-between">
              <div className="flex items-center space-x-4">
                <Avatar className="w-20 h-20">
                  <AvatarImage src={user?.avatar_url} alt={user?.username} />
                  <AvatarFallback className="bg-gradient-to-r from-purple-600 to-blue-600 text-white text-2xl">
                    {user?.username?.charAt(0)?.toUpperCase() || 'U'}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <CardTitle className="text-2xl">
                    {isEditing ? (
                      <Input
                        value={editedUser.username}
                        onChange={(e) => setEditedUser({...editedUser, username: e.target.value})}
                        className="w-48"
                      />
                    ) : (
                      user?.username
                    )}
                  </CardTitle>
                  <CardDescription className="flex items-center space-x-2 mt-1">
                    <Mail className="w-4 h-4" />
                    <span>{user?.email}</span>
                  </CardDescription>
                  <div className="flex items-center space-x-2 mt-2 text-sm text-gray-500">
                    <Calendar className="w-4 h-4" />
                    <span>가입일: {new Date(user?.created_at || Date.now()).toLocaleDateString()}</span>
                  </div>
                </div>
              </div>
              <div>
                {isEditing ? (
                  <div className="flex space-x-2">
                    <Button size="sm" onClick={handleSave}>
                      <Save className="w-4 h-4 mr-2" />
                      저장
                    </Button>
                    <Button size="sm" variant="outline" onClick={handleCancel}>
                      <X className="w-4 h-4 mr-2" />
                      취소
                    </Button>
                  </div>
                ) : (
                  <Button size="sm" variant="outline" onClick={handleEdit}>
                    <Edit className="w-4 h-4 mr-2" />
                    프로필 수정
                  </Button>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {isEditing ? (
              <div>
                <Label htmlFor="bio">자기소개</Label>
                <textarea
                  id="bio"
                  value={editedUser.bio}
                  onChange={(e) => setEditedUser({...editedUser, bio: e.target.value})}
                  className="w-full mt-1 p-2 border rounded-md"
                  rows={3}
                  placeholder="자기소개를 입력하세요..."
                />
              </div>
            ) : (
              <p className="text-gray-600">
                {user?.bio || '자기소개가 없습니다.'}
              </p>
            )}
          </CardContent>
        </Card>

        {/* 활동 통계 */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">보유 루비</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <Gem className="w-5 h-5 text-pink-500" />
                  <span className="text-2xl font-bold">{user?.ruby_balance || 0}</span>
                </div>
                <Button size="sm" variant="outline" onClick={() => navigate('/ruby/charge')}>
                  충전
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">만든 캐릭터</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center space-x-2">
                <User className="w-5 h-5 text-blue-500" />
                <span className="text-2xl font-bold">0</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">총 대화 수</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center space-x-2">
                <MessageCircle className="w-5 h-5 text-green-500" />
                <span className="text-2xl font-bold">0</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">받은 좋아요</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center space-x-2">
                <Heart className="w-5 h-5 text-red-500" />
                <span className="text-2xl font-bold">0</span>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* 탭 컨텐츠 */}
        <Tabs defaultValue="characters" className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="characters">내 캐릭터</TabsTrigger>
            <TabsTrigger value="liked">좋아요한 캐릭터</TabsTrigger>
            <TabsTrigger value="history">대화 기록</TabsTrigger>
          </TabsList>
          
          <TabsContent value="characters" className="mt-6">
            <Card>
              <CardHeader>
                <CardTitle>내가 만든 캐릭터</CardTitle>
                <CardDescription>당신이 생성한 AI 캐릭터 목록입니다.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-center py-8 text-gray-500">
                  아직 만든 캐릭터가 없습니다.
                </div>
                <div className="text-center">
                  <Button 
                    onClick={() => navigate('/characters/create')}
                    className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700"
                  >
                    첫 캐릭터 만들기
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
          
          <TabsContent value="liked" className="mt-6">
            <Card>
              <CardHeader>
                <CardTitle>좋아요한 캐릭터</CardTitle>
                <CardDescription>좋아요를 누른 캐릭터 목록입니다.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-center py-8 text-gray-500">
                  아직 좋아요한 캐릭터가 없습니다.
                </div>
              </CardContent>
            </Card>
          </TabsContent>
          
          <TabsContent value="history" className="mt-6">
            <Card>
              <CardHeader>
                <CardTitle>대화 기록</CardTitle>
                <CardDescription>AI 캐릭터와의 대화 내역입니다.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-center py-8 text-gray-500">
                  아직 대화 기록이 없습니다.
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
};

export default ProfilePage; 