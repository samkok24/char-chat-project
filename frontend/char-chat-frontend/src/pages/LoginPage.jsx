/**
 * 통합 인증 페이지 (로그인 + 회원가입)
 * CAVEDUCK 스타일: 간단하고 직관적인 인증
 */

import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Alert, AlertDescription } from '../components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Loader2, Mail, Lock, User, MessageCircle, Check, Wand2, Eye, EyeOff } from 'lucide-react';

const LoginPage = () => {
  const { login, register, user } = useAuth();
  const [activeTab, setActiveTab] = useState('login');
  const [loginData, setLoginData] = useState({
    email: '',
    password: '',
  });
  const [registerData, setRegisterData] = useState({
    email: '',
    username: '',
    password: '',
    confirmPassword: '',
    gender: 'male',
  });
  const [usernameCheck, setUsernameCheck] = useState({ checked: false, available: null, message: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [showRegisterPassword, setShowRegisterPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const navigate = useNavigate();
  const location = useLocation();

  // 쿼리 파라미터로 탭 제어 (?tab=login|register)
  useEffect(() => {
    const params = new URLSearchParams(location.search || '');
    const tab = params.get('tab');
    if (tab === 'register' || tab === 'login') {
      setActiveTab(tab);
    }
  }, [location.search]);

  const handleLoginChange = (e) => {
    setLoginData({
      ...loginData,
      [e.target.name]: e.target.value,
    });
  };

  const handleRegisterChange = (e) => {
    setRegisterData({
      ...registerData,
      [e.target.name]: e.target.value,
    });
    if (e.target.name === 'username') {
      setUsernameCheck({ checked: false, available: null, message: '' });
    }
  };

  const handleLoginSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    const result = await login(loginData.email, loginData.password);

    if (result.success) {
      navigate('/');
    } else {
      setError(result.error);
    }

    setLoading(false);
  };

  const handleRegisterSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      // 비밀번호 확인
      if (registerData.password !== registerData.confirmPassword) {
        setError('비밀번호가 일치하지 않습니다.');
        return;
      }

      // 비밀번호 길이 확인
      if (registerData.password.length < 8) {
        setError('비밀번호는 8자 이상이어야 합니다.');
        return;
      }

      // 닉네임 중복 체크 권장
      if (!usernameCheck.checked) {
        try {
          const { data } = await import('../lib/api').then(m => m.authAPI.checkUsername(registerData.username));
          if (!data.available) {
            setError('이미 사용 중인 사용자명입니다.');
            return;
          }
        } catch (_) {
          // API 실패 시에도 계속 진행 가능 (서버에서 최종 검증)
        }
      }

      const result = await register(registerData.email, registerData.username, registerData.password, registerData.gender);

      if (result.success) {
        navigate('/verify', { state: { email: registerData.email } });
      } else {
        setError(result.error);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleCheckUsername = async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await import('../lib/api').then(m => m.authAPI.checkUsername(registerData.username));
      setUsernameCheck({ checked: true, available: data.available, message: data.available ? '사용 가능한 이름입니다.' : '이미 사용 중입니다.' });
    } catch (err) {
      setUsernameCheck({ checked: true, available: null, message: '확인에 실패했습니다.' });
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateUsername = async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await import('../lib/api').then(m => m.authAPI.generateUsername());
      setRegisterData(prev => ({ ...prev, username: data.username }));
      setUsernameCheck({ checked: false, available: null, message: '' });
    } catch (err) {
      setError('자동 생성에 실패했습니다.');
    } finally {
      setLoading(false);
    }
  };

  const handleTabChange = (value) => {
    setActiveTab(value);
    setError(''); // 탭 변경 시 에러 메시지 초기화
  };

  // 탭 변경 시 에러 초기화 (추가 보장)
  useEffect(() => {
    setError('');
  }, [activeTab]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 to-blue-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* 로고 및 제목 */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-r from-purple-600 to-blue-600 rounded-full mb-4">
            <MessageCircle className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            AI 캐릭터 챗
          </h1>
          <p className="text-gray-600">
            나만의 AI 캐릭터와 대화해보세요
          </p>
        </div>

        <Card className="shadow-lg">
          <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
            <CardHeader className="pb-4">
              <TabsList className="grid w-full grid-cols-2 bg-gray-200 dark:bg-gray-700">
                <TabsTrigger 
                  value="login"
                  className="text-gray-700 dark:text-gray-300 data-[state=active]:bg-white dark:data-[state=active]:bg-gray-800 data-[state=active]:text-gray-900 dark:data-[state=active]:text-white font-semibold"
                >
                  로그인
                </TabsTrigger>
                <TabsTrigger 
                  value="register"
                  className="text-gray-700 dark:text-gray-300 data-[state=active]:bg-white dark:data-[state=active]:bg-gray-800 data-[state=active]:text-gray-900 dark:data-[state=active]:text-white font-semibold"
                >
                  회원가입
                </TabsTrigger>
              </TabsList>
            </CardHeader>

            <CardContent>
              {error && (
                <Alert variant="destructive" className="mb-4">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <TabsContent value="login" className="space-y-4 mt-0">
                <div className="text-center mb-4">
                  <CardDescription className="text-gray-600 dark:text-gray-300">
                    계정에 로그인하여 AI 캐릭터들과 대화를 시작하세요
                  </CardDescription>
                </div>
                
                <form onSubmit={handleLoginSubmit} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="login-email" className="text-gray-900 dark:text-gray-200 font-semibold">이메일</Label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-3 h-4 w-4 text-gray-500 dark:text-gray-400" />
                      <Input
                        id="login-email"
                        name="email"
                        type="email"
                        placeholder="이메일을 입력하세요"
                        value={loginData.email}
                        onChange={handleLoginChange}
                        className="pl-10 text-gray-900 dark:text-gray-100"
                        required
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="login-password" className="text-gray-900 dark:text-gray-200 font-semibold">비밀번호</Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-3 h-4 w-4 text-gray-500 dark:text-gray-400" />
                      <Input
                        id="login-password"
                        name="password"
                        type={showLoginPassword ? "text" : "password"}
                        placeholder="비밀번호를 입력하세요"
                        value={loginData.password}
                        onChange={handleLoginChange}
                        className="pl-10 pr-10 text-gray-900 dark:text-gray-100"
                        required
                      />
                      <button
                        type="button"
                        onClick={() => setShowLoginPassword(!showLoginPassword)}
                        className="absolute right-3 top-3 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                      >
                        {showLoginPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>

                  <Button
                    type="submit"
                    className="w-full bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white font-medium"
                    disabled={loading}
                  >
                    {loading ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        로그인 중...
                      </>
                    ) : (
                      '로그인'
                    )}
                  </Button>
                  
                  <div className="text-center">
                    <Button 
                      type="button"
                      variant="link" 
                      onClick={() => navigate('/forgot-password')}
                      className="text-sm text-purple-600 hover:text-purple-700"
                    >
                      비밀번호를 잊으셨나요?
                    </Button>
                  </div>
                </form>
              </TabsContent>

              <TabsContent value="register" className="space-y-4 mt-0">
                <div className="text-center mb-4">
                  <CardDescription className="text-gray-600 dark:text-gray-300">
                    새 계정을 만들어 AI 캐릭터들과 대화를 시작하세요
                  </CardDescription>
                </div>

                <form onSubmit={handleRegisterSubmit} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="register-email" className="text-gray-900 dark:text-gray-200 font-semibold">이메일</Label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-3 h-4 w-4 text-gray-500 dark:text-gray-400" />
                      <Input
                        id="register-email"
                        name="email"
                        type="email"
                        placeholder="이메일을 입력하세요"
                        value={registerData.email}
                        onChange={handleRegisterChange}
                        className="pl-10 text-gray-900 dark:text-gray-100"
                        required
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="register-username" className="text-gray-900 dark:text-gray-200 font-semibold">사용자명</Label>
                    <div className="relative">
                      <User className="absolute left-3 top-3 h-4 w-4 text-gray-500 dark:text-gray-400" />
                      <Input
                        id="register-username"
                        name="username"
                        type="text"
                        placeholder="사용자명을 입력하세요"
                        value={registerData.username}
                        onChange={handleRegisterChange}
                        className="pl-10 text-gray-900 dark:text-gray-100"
                        required
                        minLength={2}
                        maxLength={100}
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <Button type="button" variant="secondary" className="h-9 bg-blue-600 hover:bg-blue-700 text-white font-medium" onClick={handleGenerateUsername} disabled={loading}>
                        <Wand2 className="h-4 w-4 mr-1" /> 자동생성
                      </Button>
                      {usernameCheck.checked && usernameCheck.message && (
                        <span className={`text-sm font-semibold ${usernameCheck.available ? 'text-green-500' : 'text-red-500'}`}>{usernameCheck.message}</span>
                      )}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="register-password" className="text-gray-900 dark:text-gray-200 font-semibold">비밀번호</Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-3 h-4 w-4 text-gray-500 dark:text-gray-400" />
                      <Input
                        id="register-password"
                        name="password"
                        type={showRegisterPassword ? "text" : "password"}
                        placeholder="영문/숫자 조합 8자 이상"
                        value={registerData.password}
                        onChange={handleRegisterChange}
                        className="pl-10 pr-10 text-gray-900 dark:text-gray-100"
                        required
                        minLength={8}
                        pattern="(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d]{8,}"
                      />
                      <button
                        type="button"
                        onClick={() => setShowRegisterPassword(!showRegisterPassword)}
                        className="absolute right-3 top-3 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                      >
                        {showRegisterPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                    <p className="text-xs text-gray-600 dark:text-gray-400 font-medium">영문과 숫자를 포함해 8자 이상 입력하세요.</p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="register-confirmPassword" className="text-gray-900 dark:text-gray-200 font-semibold">비밀번호 확인</Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-3 h-4 w-4 text-gray-500 dark:text-gray-400" />
                      <Input
                        id="register-confirmPassword"
                        name="confirmPassword"
                        type={showConfirmPassword ? "text" : "password"}
                        placeholder="비밀번호를 다시 입력하세요"
                        value={registerData.confirmPassword}
                        onChange={handleRegisterChange}
                        className="pl-10 pr-10 text-gray-900 dark:text-gray-100"
                        required
                      />
                      <button
                        type="button"
                        onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                        className="absolute right-3 top-3 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                      >
                        {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-gray-900 dark:text-gray-200 font-semibold">성별</Label>
                    <div className="flex items-center gap-4">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="radio" name="gender" value="male" checked={registerData.gender === 'male'} onChange={handleRegisterChange} required />
                        <span className="text-gray-900 dark:text-gray-100">남성</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="radio" name="gender" value="female" checked={registerData.gender === 'female'} onChange={handleRegisterChange} required />
                        <span className="text-gray-900 dark:text-gray-100">여성</span>
                      </label>
                    </div>
                  </div>

                  <Button
                    type="submit"
                    className="w-full bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white font-medium"
                    disabled={loading}
                  >
                    {loading ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        가입 중...
                      </>
                    ) : (
                      '회원가입'
                    )}
                  </Button>
                </form>
              </TabsContent>
            </CardContent>
          </Tabs>
        </Card>
      </div>
    </div>
  );
};

export default LoginPage;


