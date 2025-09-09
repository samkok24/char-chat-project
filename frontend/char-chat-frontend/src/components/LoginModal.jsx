import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import { Card, CardContent, CardDescription, CardHeader } from './ui/card';
import { Alert, AlertDescription } from './ui/alert';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Loader2, Mail, Lock, User, MessageCircle, Check, Wand2 } from 'lucide-react';

const LoginModal = ({ isOpen, onClose, initialTab = 'login' }) => {
  const { login, register } = useAuth();
  const [activeTab, setActiveTab] = useState(initialTab);
  const [loginData, setLoginData] = useState({ email: '', password: '' });
  const [registerData, setRegisterData] = useState({
    email: '',
    username: '',
    password: '',
    confirmPassword: '',
    gender: 'male',
  });
  const [usernameCheck, setUsernameCheck] = useState({ checked: false, available: null, message: '' });
  const [emailCheck, setEmailCheck] = useState({ checked: false, available: null, message: '' });
  const [loading, setLoading] = useState(false);
  const [emailChecking, setEmailChecking] = useState(false);
  const [usernameChecking, setUsernameChecking] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isOpen) {
      setActiveTab(initialTab || 'login');
      setError('');
    }
  }, [isOpen, initialTab]);

  const handleLoginChange = (e) => {
    setLoginData({ ...loginData, [e.target.name]: e.target.value });
  };

  const handleRegisterChange = (e) => {
    setRegisterData({ ...registerData, [e.target.name]: e.target.value });
    if (e.target.name === 'username') {
      setUsernameCheck({ checked: false, available: null, message: '' });
    }
    if (e.target.name === 'email') {
      setEmailCheck({ checked: false, available: null, message: '' });
    }
  };

  const handleLoginSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const result = await login(loginData.email, loginData.password);
      if (result.success) onClose?.(); else setError(result.error);
    } finally {
      setLoading(false);
    }
  };

  const handleRegisterSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      if (registerData.password !== registerData.confirmPassword) { setError('비밀번호가 일치하지 않습니다.'); return; }
      if (registerData.password.length < 8) { setError('비밀번호는 8자 이상이어야 합니다.'); return; }
      // 자동검사 결과가 준비되지 않았거나 사용 불가하면 중단
      if (!emailCheck.checked) { setError('이메일 중복 확인 중입니다. 잠시 후 다시 시도하세요.'); return; }
      if (emailCheck.available === false) { setError('이미 등록된 이메일입니다.'); return; }
      if (!usernameCheck.checked) { setError('사용자명 중복 확인 중입니다. 잠시 후 다시 시도하세요.'); return; }
      if (usernameCheck.available === false) { setError('이미 사용 중인 사용자명입니다.'); return; }
      const result = await register(registerData.email, registerData.username, registerData.password, registerData.gender);
      if (result.success) onClose?.(); else setError(result.error);
    } finally {
      setLoading(false);
    }
  };

  const handleCheckUsername = async () => {
    setLoading(true); setError('');
    try {
      const { data } = await import('../lib/api').then(m => m.authAPI.checkUsername(registerData.username));
      setUsernameCheck({ checked: true, available: data.available, message: data.available ? '사용 가능한 이름입니다.' : '이미 사용 중입니다.' });
    } catch (_) {
      setUsernameCheck({ checked: true, available: null, message: '확인에 실패했습니다.' });
    } finally { setLoading(false); }
  };

  const handleGenerateUsername = async () => {
    setLoading(true); setError('');
    try {
      const { data } = await import('../lib/api').then(m => m.authAPI.generateUsername());
      setRegisterData(prev => ({ ...prev, username: data.username }));
      setUsernameCheck({ checked: false, available: null, message: '' });
    } catch (_) { setError('자동 생성에 실패했습니다.'); }
    finally { setLoading(false); }
  };

  const handleCheckEmail = async () => {
    setLoading(true); setError('');
    try {
      const { data } = await import('../lib/api').then(m => m.authAPI.checkEmail(registerData.email));
      setEmailCheck({ checked: true, available: data.available, message: data.available ? '사용 가능한 이메일입니다.' : '이미 등록된 이메일입니다.' });
    } catch (_) {
      setEmailCheck({ checked: true, available: null, message: '확인에 실패했습니다.' });
    } finally { setLoading(false); }
  };

  // 자동 중복확인: 이메일 (디바운스 500ms)
  useEffect(() => {
    const v = registerData.email?.trim();
    if (!v) { setEmailCheck({ checked: false, available: null, message: '' }); return; }
    // 간단 이메일 패턴
    const emailPattern = /.+@.+\..+/;
    if (!emailPattern.test(v)) {
      setEmailCheck({ checked: true, available: null, message: '올바른 이메일 형식이 아닙니다.' });
      return;
    }
    setEmailChecking(true);
    const t = setTimeout(async () => {
      try {
        const { data } = await import('../lib/api').then(m => m.authAPI.checkEmail(v));
        setEmailCheck({ checked: true, available: data.available, message: data.available ? '사용 가능한 이메일입니다.' : '이미 등록된 이메일입니다.' });
      } catch (_) {
        setEmailCheck({ checked: true, available: null, message: '확인에 실패했습니다.' });
      } finally {
        setEmailChecking(false);
      }
    }, 500);
    return () => clearTimeout(t);
  }, [registerData.email]);

  // 자동 중복확인: 사용자명 (디바운스 500ms)
  useEffect(() => {
    const v = registerData.username?.trim();
    if (!v) { setUsernameCheck({ checked: false, available: null, message: '' }); return; }
    if (v.length < 2) {
      setUsernameCheck({ checked: true, available: null, message: '2자 이상 입력하세요.' });
      return;
    }
    setUsernameChecking(true);
    const t = setTimeout(async () => {
      try {
        const { data } = await import('../lib/api').then(m => m.authAPI.checkUsername(v));
        setUsernameCheck({ checked: true, available: data.available, message: data.available ? '사용 가능한 이름입니다.' : '이미 사용 중입니다.' });
      } catch (_) {
        setUsernameCheck({ checked: true, available: null, message: '확인에 실패했습니다.' });
      } finally {
        setUsernameChecking(false);
      }
    }, 500);
    return () => clearTimeout(t);
  }, [registerData.username]);

  return (
    <Dialog open={isOpen} onOpenChange={(v) => { if (!v) onClose?.(); }}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>로그인 / 회원가입</DialogTitle>
        </DialogHeader>
        <div className="mt-2">
          <Card className="shadow-none border-0">
            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
              <CardHeader className="pb-4">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="login">로그인</TabsTrigger>
                  <TabsTrigger value="register">회원가입</TabsTrigger>
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
                    <CardDescription>
                      계정에 로그인하여 AI 캐릭터들과 대화를 시작하세요
                    </CardDescription>
                  </div>
                  <form onSubmit={handleLoginSubmit} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="login-email">이메일</Label>
                      <div className="relative">
                        <Mail className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                        <Input id="login-email" name="email" type="email" placeholder="이메일을 입력하세요" value={loginData.email} onChange={handleLoginChange} className="pl-10" required />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="login-password">비밀번호</Label>
                      <div className="relative">
                        <Lock className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                        <Input id="login-password" name="password" type="password" placeholder="비밀번호를 입력하세요" value={loginData.password} onChange={handleLoginChange} className="pl-10" required />
                      </div>
                    </div>
                    <Button type="submit" className="w-full bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700" disabled={loading}>
                      {loading ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" />로그인 중...</>) : '로그인'}
                    </Button>
                  </form>
                </TabsContent>

                <TabsContent value="register" className="space-y-4 mt-0">
                  <div className="text-center mb-4">
                    <CardDescription>
                      새 계정을 만들어 AI 캐릭터들과 대화를 시작하세요
                    </CardDescription>
                  </div>
                  <form onSubmit={handleRegisterSubmit} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="register-email">이메일</Label>
                      <div className="relative">
                        <Mail className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                        <Input id="register-email" name="email" type="email" placeholder="이메일을 입력하세요" value={registerData.email} onChange={handleRegisterChange} className="pl-10" required />
                      </div>
                      <div className="flex items-center gap-2 mt-2">
                        <Button type="button" variant="secondary" className="h-9" onClick={handleCheckEmail} disabled={loading || !registerData.email}>
                          이메일 중복확인
                        </Button>
                        <Button type="button" variant="secondary" className="h-9" onClick={async()=>{ try { await import('../lib/api').then(m=>m.authAPI.sendVerificationEmail({ email: registerData.email })); alert('인증 메일을 보냈습니다. 메일함을 확인하세요.'); } catch(_) { alert('인증 메일 발송에 실패했습니다.'); } }} disabled={!registerData.email}>
                          인증메일 보내기
                        </Button>
                        {emailCheck.checked && (
                          <span className={`text-sm ${emailCheck.available ? 'text-green-600' : 'text-red-600'}`}>{emailCheck.message}</span>
                        )}
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="register-username">사용자명</Label>
                      <div className="relative">
                        <User className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                        <Input id="register-username" name="username" type="text" placeholder="사용자명을 입력하세요" value={registerData.username} onChange={handleRegisterChange} className="pl-10" required minLength={2} maxLength={100} />
                        <div className="flex items-center gap-2 mt-2">
                          <Button type="button" variant="secondary" className="h-9" onClick={handleCheckUsername} disabled={loading || !registerData.username}>
                            <Check className="h-4 w-4 mr-1" /> 중복확인
                          </Button>
                          <Button type="button" variant="secondary" className="h-9" onClick={handleGenerateUsername} disabled={loading}>
                            <Wand2 className="h-4 w-4 mr-1" /> 자동생성
                          </Button>
                          {usernameCheck.checked && (
                            <span className={`text-sm ${usernameCheck.available ? 'text-green-600' : 'text-red-600'}`}>{usernameCheck.message}</span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="register-password">비밀번호</Label>
                      <div className="relative">
                        <Lock className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                        <Input id="register-password" name="password" type="password" placeholder="영문/숫자 조합 8자 이상" value={registerData.password} onChange={handleRegisterChange} className="pl-10" required minLength={8} pattern="(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d]{8,}" />
                      </div>
                      <p className="text-xs text-gray-500">영문과 숫자를 포함해 8자 이상 입력하세요.</p>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="register-confirmPassword">비밀번호 확인</Label>
                      <div className="relative">
                        <Lock className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                        <Input id="register-confirmPassword" name="confirmPassword" type="password" placeholder="비밀번호를 다시 입력하세요" value={registerData.confirmPassword} onChange={handleRegisterChange} className="pl-10" required />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>성별</Label>
                      <div className="flex items-center gap-4">
                        <label className="flex items-center gap-2">
                          <input type="radio" name="gender" value="male" checked={registerData.gender === 'male'} onChange={handleRegisterChange} required />
                          <span>남성</span>
                        </label>
                        <label className="flex items-center gap-2">
                          <input type="radio" name="gender" value="female" checked={registerData.gender === 'female'} onChange={handleRegisterChange} required />
                          <span>여성</span>
                        </label>
                      </div>
                    </div>
                    <Button type="submit" className="w-full bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700" disabled={loading}>
                      {loading ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" />가입 중...</>) : '회원가입'}
                    </Button>
                  </form>
                </TabsContent>
              </CardContent>
            </Tabs>
          </Card>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default LoginModal;


