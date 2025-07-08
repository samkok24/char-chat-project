/**
 * 내 캐릭터 목록 페이지
 */

import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { charactersAPI } from '../lib/api';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '../components/ui/avatar';
import { Alert, AlertDescription } from '../components/ui/alert';
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

const MyCharactersPage = () => {
  const [characters, setCharacters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const { user } = useAuth();
  const navigate = useNavigate();

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
    <Card className="hover:shadow-lg transition-all duration-200">
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="flex items-start space-x-3">
            <Avatar className="w-12 h-12">
              <AvatarImage src={character.avatar_url} alt={character.name} />
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
      <CardContent>
        <p className="text-sm text-gray-600 mb-4 line-clamp-2">
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

        <div className="flex items-center justify-between">
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
            onClick={() => navigate(`/chat/${character.id}`)}
            className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700"
          >
            <MessageCircle className="w-4 h-4 mr-1" />
            대화
          </Button>
        </div>
      </CardContent>
    </Card>
  );

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-50 via-blue-50 to-indigo-50 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4" />
          <p className="text-gray-600">캐릭터 목록을 불러오는 중...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-blue-50 to-indigo-50">
      {/* 헤더 */}
      <header className="bg-white/80 backdrop-blur-sm shadow-sm border-b sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center space-x-4">
              <Link to="/" className="flex items-center space-x-2">
                <div className="w-8 h-8 bg-gradient-to-r from-purple-600 to-blue-600 rounded-lg flex items-center justify-center">
                  <MessageCircle className="w-5 h-5 text-white" />
                </div>
                <h1 className="text-xl font-bold text-gray-900">AI 캐릭터 챗</h1>
              </Link>
            </div>
            <Button
              variant="outline"
              onClick={() => navigate(-1)}
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              뒤로 가기
            </Button>
          </div>
        </div>
      </header>

      {/* 메인 컨텐츠 */}
      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-3xl font-bold text-gray-900 mb-2">내 캐릭터</h2>
              <p className="text-gray-600">내가 만든 AI 캐릭터들을 관리하세요</p>
            </div>
            <Button
              onClick={() => navigate('/characters/create')}
              className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700"
            >
              <Plus className="w-4 h-4 mr-2" />
              새 캐릭터 만들기
            </Button>
          </div>

          {error && (
            <Alert variant="destructive" className="mb-6">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {characters.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {characters.map((character) => (
                <CharacterCard key={character.id} character={character} />
              ))}
            </div>
          ) : (
            <Card className="text-center py-12">
              <CardContent>
                <MessageCircle className="w-16 h-16 text-gray-400 mx-auto mb-4" />
                <h3 className="text-xl font-semibold text-gray-900 mb-2">
                  아직 만든 캐릭터가 없습니다
                </h3>
                <p className="text-gray-600 mb-6">
                  나만의 AI 캐릭터를 만들어 특별한 대화를 시작해보세요!
                </p>
                <Button
                  onClick={() => navigate('/characters/create')}
                  className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  첫 캐릭터 만들기
                </Button>
              </CardContent>
            </Card>
          )}
        </div>

        {/* 통계 카드 */}
        {characters.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-12">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">총 캐릭터 수</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold text-purple-600">{characters.length}</p>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">총 대화 수</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold text-blue-600">
                  {characters.reduce((sum, char) => sum + (char.chat_count || 0), 0).toLocaleString()}
                </p>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">총 좋아요</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold text-pink-600">
                  {characters.reduce((sum, char) => sum + (char.like_count || 0), 0)}
                </p>
              </CardContent>
            </Card>
          </div>
        )}
      </main>
    </div>
  );
};

export default MyCharactersPage; 