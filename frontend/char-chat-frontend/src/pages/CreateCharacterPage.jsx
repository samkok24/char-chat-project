/**
 * 캐릭터 생성 페이지
 */

import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { charactersAPI } from '../lib/api';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Switch } from '../components/ui/switch';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Alert, AlertDescription } from '../components/ui/alert';
import { 
  ArrowLeft,
  Save,
  Loader2,
  MessageCircle,
  AlertCircle
} from 'lucide-react';

const CreateCharacterPage = () => {
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    personality: '',
    background_story: '',
    avatar_url: '',
    is_public: true
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();

  // 로그인하지 않았으면 로그인 페이지로
  React.useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login');
    }
  }, [isAuthenticated, navigate]);

  const handleChange = (e) => {
    const { name, value, type } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? e.target.checked : value
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const response = await charactersAPI.createCharacter(formData);
      // 생성 성공 시 캐릭터 채팅 페이지로 이동
      navigate(`/chat/${response.data.id}`);
    } catch (err) {
      console.error('캐릭터 생성 실패:', err);
      setError(err.response?.data?.detail || '캐릭터 생성에 실패했습니다.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-blue-50 to-indigo-50">
      {/* 헤더 */}
      <header className="bg-white/80 backdrop-blur-sm shadow-sm border-b sticky top-0 z-50">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
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
      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Card className="shadow-lg">
          <CardHeader>
            <CardTitle className="text-2xl">새 캐릭터 만들기</CardTitle>
            <CardDescription>
              AI 캐릭터의 성격과 특징을 설정하여 나만의 독특한 캐릭터를 만들어보세요.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-6">
              {error && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              {/* 기본 정보 */}
              <div className="space-y-4">
                <div>
                  <Label htmlFor="name">캐릭터 이름*</Label>
                  <Input
                    id="name"
                    name="name"
                    value={formData.name}
                    onChange={handleChange}
                    placeholder="예: 미라"
                    required
                    maxLength={100}
                  />
                  <p className="text-sm text-gray-500 mt-1">
                    캐릭터의 이름을 입력하세요 (최대 100자)
                  </p>
                </div>

                <div>
                  <Label htmlFor="description">캐릭터 설명*</Label>
                  <Textarea
                    id="description"
                    name="description"
                    value={formData.description}
                    onChange={handleChange}
                    placeholder="예: 친절하고 따뜻한 AI 친구입니다. 언제나 당신의 이야기를 들어드려요."
                    rows={3}
                    required
                    maxLength={1000}
                  />
                  <p className="text-sm text-gray-500 mt-1">
                    다른 사용자들이 볼 캐릭터 소개입니다 (최대 1000자)
                  </p>
                </div>

                <div>
                  <Label htmlFor="personality">성격 및 특징*</Label>
                  <Textarea
                    id="personality"
                    name="personality"
                    value={formData.personality}
                    onChange={handleChange}
                    placeholder="예: 긍정적이고 공감능력이 뛰어나며, 유머감각도 있습니다. 사람들의 고민을 잘 들어주고 위로해줍니다."
                    rows={4}
                    required
                    maxLength={2000}
                  />
                  <p className="text-sm text-gray-500 mt-1">
                    AI가 참고할 캐릭터의 성격과 특징을 상세히 설명하세요 (최대 2000자)
                  </p>
                </div>

                <div>
                  <Label htmlFor="background_story">배경 스토리 (선택)</Label>
                  <Textarea
                    id="background_story"
                    name="background_story"
                    value={formData.background_story}
                    onChange={handleChange}
                    placeholder="예: 디지털 세계에서 태어난 AI이지만, 인간의 감정을 이해하고 싶어 많은 대화를 통해 학습했습니다."
                    rows={4}
                    maxLength={5000}
                  />
                  <p className="text-sm text-gray-500 mt-1">
                    캐릭터의 배경 이야기를 추가할 수 있습니다 (최대 5000자)
                  </p>
                </div>

                <div>
                  <Label htmlFor="avatar_url">프로필 이미지 URL (선택)</Label>
                  <Input
                    id="avatar_url"
                    name="avatar_url"
                    type="url"
                    value={formData.avatar_url}
                    onChange={handleChange}
                    placeholder="https://example.com/avatar.jpg"
                    maxLength={500}
                  />
                  <p className="text-sm text-gray-500 mt-1">
                    캐릭터의 프로필 이미지 URL을 입력하세요
                  </p>
                </div>

                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <Switch
                      id="is_public"
                      name="is_public"
                      checked={formData.is_public}
                      onCheckedChange={(checked) => 
                        setFormData(prev => ({ ...prev, is_public: checked }))
                      }
                    />
                    <Label htmlFor="is_public" className="cursor-pointer">
                      공개 캐릭터로 설정
                    </Label>
                  </div>
                  <p className="text-sm text-gray-500">
                    {formData.is_public 
                      ? '다른 사용자들이 이 캐릭터를 사용할 수 있습니다.' 
                      : '나만 사용할 수 있는 비공개 캐릭터입니다.'}
                  </p>
                </div>
              </div>

              {/* 제출 버튼 */}
              <div className="flex justify-end space-x-4 pt-6">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => navigate(-1)}
                  disabled={loading}
                >
                  취소
                </Button>
                <Button
                  type="submit"
                  disabled={loading}
                  className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700"
                >
                  {loading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      생성 중...
                    </>
                  ) : (
                    <>
                      <Save className="mr-2 h-4 w-4" />
                      캐릭터 생성
                    </>
                  )}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        {/* 도움말 */}
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="text-lg">💡 캐릭터 만들기 팁</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-gray-600">
            <p>• <strong>이름</strong>: 캐릭터의 개성을 나타내는 독특한 이름을 지어주세요.</p>
            <p>• <strong>성격</strong>: AI가 대화할 때 참고할 수 있도록 구체적으로 작성해주세요.</p>
            <p>• <strong>배경 스토리</strong>: 캐릭터의 깊이를 더해주는 흥미로운 이야기를 추가해보세요.</p>
            <p>• <strong>공개 설정</strong>: 공개로 설정하면 다른 사용자들도 당신의 캐릭터와 대화할 수 있습니다.</p>
          </CardContent>
        </Card>
      </main>
    </div>
  );
};

export default CreateCharacterPage; 