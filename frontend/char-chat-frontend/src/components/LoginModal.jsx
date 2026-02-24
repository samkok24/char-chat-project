import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { authAPI, metricsAPI } from '../lib/api';
import { getOrCreateClientId, getOrCreateSessionId } from '../lib/clientIdentity';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { Card, CardContent, CardDescription } from './ui/card';
import { Alert, AlertDescription } from './ui/alert';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Loader2, Mail, Lock, User, Wand2, Eye, EyeOff, CheckCircle2, ArrowLeft } from 'lucide-react';

// ─── SSOT: 공통 스타일 상수 ───
const STYLES = {
  label: 'text-gray-900 dark:text-gray-200 font-semibold',
  input: 'pl-10 text-gray-900 dark:text-gray-100',
  inputFlex: 'pl-10 text-gray-900 dark:text-gray-100 flex-1', // 버튼과 함께 쓸 때
  inputWithToggle: 'pl-10 pr-10 text-gray-900 dark:text-gray-100',
  inputIcon: 'absolute left-3 top-3 h-4 w-4 text-gray-500 dark:text-gray-400',
  toggleBtn: 'absolute right-3 top-3 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200',
  primaryBtn: 'w-full bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white font-medium',
  secondaryBtn: 'w-full border border-gray-300 dark:border-gray-600 bg-transparent hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-200 font-medium',
  inlineBtn: 'h-10 px-3 text-sm shrink-0 bg-purple-600 hover:bg-purple-700 text-white font-medium disabled:opacity-50', // 인라인 액션 버튼
  backLink: 'text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 inline-flex items-center gap-1',
};

// ─── SSOT: 상태 메시지 컴포넌트 ───
const StatusMessage = ({ type, message }) => {
  if (!message) return null;
  const colorClass = type === 'success' ? 'text-green-500' : type === 'error' ? 'text-red-500' : 'text-gray-400';
  return <div className={`text-sm font-semibold ${colorClass}`}>{message}</div>;
};

const LoginModal = ({ isOpen, onClose, initialTab = 'login' }) => {
  const { login, register } = useAuth();
  const trackedModalEventRef = useRef('');
  
  // view: 'login' | 'register' | 'success'
  const [view, setView] = useState(initialTab === 'register' ? 'register' : 'login');
  
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
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [showRegisterPassword, setShowRegisterPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [sendingVerification, setSendingVerification] = useState(false);
  const [verificationInfo, setVerificationInfo] = useState({ type: 'info', message: '' });
  const [resendCooldown, setResendCooldown] = useState(0);
  const [emailVerified, setEmailVerified] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetStatus, setResetStatus] = useState({ type: 'info', message: '' });
  const [resetLoading, setResetLoading] = useState(false);

  // 모달 열릴 때 초기화
  useEffect(() => {
    const sendModalEvent = (eventName) => {
      if (!eventName) return;
      let path = '/';
      let clientId;
      let sessionId;
      try { path = String(window.location?.pathname || '/'); } catch (_) {}
      try { clientId = getOrCreateClientId(); } catch (_) {}
      try { sessionId = getOrCreateSessionId(); } catch (_) {}
      try {
        metricsAPI.trackPageEvent({
          event: eventName,
          path,
          client_id: clientId || undefined,
          session_id: sessionId || undefined,
        }).catch(() => {});
      } catch (_) {}
    };

    if (!isOpen) {
      trackedModalEventRef.current = '';
      return;
    }

    // 첫 오픈은 initialTab 기준으로 집계(이전 state 잔상 방지)
    if (!trackedModalEventRef.current) {
      const initialEvent = initialTab === 'register' ? 'modal_register_open' : 'modal_login_open';
      sendModalEvent(initialEvent);
      trackedModalEventRef.current = initialEvent;
      return;
    }

    const currentEvent = view === 'register' ? 'modal_register_open' : view === 'login' ? 'modal_login_open' : '';
    if (currentEvent && trackedModalEventRef.current !== currentEvent) {
      sendModalEvent(currentEvent);
      trackedModalEventRef.current = currentEvent;
    }
  }, [isOpen, initialTab, view]);

  useEffect(() => {
    if (isOpen) {
      setView(initialTab === 'register' ? 'register' : 'login');
      setError('');
    }
  }, [isOpen, initialTab]);

  /**
   * 회원가입 도중 이메일 인증 상태 동기화
   *
   * 의도/동작:
   * - 인증 링크를 다른 탭에서 눌러도(verify 페이지), storage 이벤트로 현재 탭에서 즉시 감지한다.
   * - 인증은 "auth:emailVerified:<email>" localStorage 키로 전달된다.
   */
  useEffect(() => {
    const email = String(registerData.email || '').trim().toLowerCase();
    if (!email) { setEmailVerified(false); return; }
    const key = `auth:emailVerified:${email}`;
    const read = () => {
      try { setEmailVerified(!!localStorage.getItem(key)); } catch (_) { setEmailVerified(false); }
    };
    read();
    const onStorage = (e) => {
      if (!e) return;
      if (e.key === key) read();
    };
    try { window.addEventListener('storage', onStorage); } catch (_) {}
    return () => { try { window.removeEventListener('storage', onStorage); } catch (_) {} };
  }, [registerData.email]);

  // 뷰 변경 시 에러 메시지 초기화
  useEffect(() => {
    setError('');
    if (view === 'login') {
      setResetStatus({ type: 'info', message: '' });
      setResetLoading(false);
    }
    if (view === 'forgot') {
      setResetEmail(loginData.email || '');
      setResetStatus({ type: 'info', message: '' });
    }
  }, [view]);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setInterval(() => {
      setResendCooldown(prev => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [resendCooldown]);

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
      // 이메일이 바뀌면 인증 상태 리셋(방어적 UX)
      setEmailVerified(false);
    }
  };

  const handleLoginSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const result = await login(loginData.email, loginData.password);
      if (result.success) {
        onClose?.();
      } else {
        setError(result.error);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleRegisterSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      if (!emailVerified) { setError('이메일 인증을 먼저 완료해주세요. (인증발송 → 메일함 인증)'); return; }
      if (registerData.password !== registerData.confirmPassword) { setError('비밀번호가 일치하지 않습니다.'); return; }
      if (registerData.password.length < 8) { setError('비밀번호는 8자 이상이어야 합니다.'); return; }
      // 자동검사 결과가 준비되지 않았거나 사용 불가하면 중단
      if (!emailCheck.checked) { setError('이메일 중복 확인 중입니다. 잠시 후 다시 시도하세요.'); return; }
      if (emailCheck.available === false) { setError('이미 등록된 이메일입니다.'); return; }
      if (!usernameCheck.checked) { setError('사용자명 중복 확인 중입니다. 잠시 후 다시 시도하세요.'); return; }
      if (usernameCheck.available === false) { setError('이미 사용 중인 사용자명입니다.'); return; }
      
      const result = await register(registerData.email, registerData.username, registerData.password, registerData.gender);
      if (result.success) {
        // 회원가입 성공 → 완료 화면으로 전환
        setView('success');
      } else {
        setError(result.error);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateUsername = async () => {
    setLoading(true); setError('');
    try {
      const { data } = await authAPI.generateUsername();
      setRegisterData(prev => ({ ...prev, username: data.username }));
      setUsernameCheck({ checked: false, available: null, message: '' });
    } catch (_) { setError('자동 생성에 실패했습니다.'); }
    finally { setLoading(false); }
  };

  const handleSendVerificationEmail = async () => {
    const email = registerData.email?.trim();
    if (!email) {
      setVerificationInfo({ type: 'error', message: '이메일을 먼저 입력해주세요.' });
      return;
    }
    setSendingVerification(true);
    setVerificationInfo({ type: 'info', message: '' });
    try {
      await authAPI.sendVerificationEmail(email);
      setVerificationInfo({ type: 'success', message: '인증 메일을 발송했습니다. 메일함을 확인해주세요.' });
      setResendCooldown(60);
    } catch (err) {
      const detail = err?.response?.data?.detail;
      let message = detail || '인증 메일 발송에 실패했습니다. 잠시 후 다시 시도해주세요.';
      if (detail && detail.includes('이미 인증된')) {
        message = '이미 인증이 완료된 계정입니다. 로그인으로 이동하세요.';
      }
      setVerificationInfo({ type: 'error', message });
    } finally {
      setSendingVerification(false);
    }
  };

  const handleForgotSubmit = async (e) => {
    e.preventDefault();
    if (!resetEmail?.trim()) {
      setResetStatus({ type: 'error', message: '이메일을 입력해주세요.' });
      return;
    }
    setResetLoading(true);
    setResetStatus({ type: 'info', message: '' });
    try {
      await authAPI.forgotPassword(resetEmail.trim());
      setResetStatus({ type: 'success', message: '비밀번호 재설정 메일을 발송했습니다. 메일함을 확인해주세요.' });
    } catch (err) {
      const detail = err?.response?.data?.detail;
      setResetStatus({ type: 'error', message: detail || '메일 발송에 실패했습니다. 잠시 후 다시 시도해주세요.' });
    } finally {
      setResetLoading(false);
    }
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
        const { data } = await authAPI.checkEmail(v);
        setEmailCheck({ checked: true, available: data.available, message: data.available ? '사용 가능한 이메일입니다.' : '이미 등록된 이메일입니다.' });
      } catch (err) {
        /**
         * 이메일 중복확인 실패 시 원인 노출(방어적 UX)
         * - 운영에서 "왜 실패했는지"가 안 보이면 디버깅이 불가능해진다.
         * - SW/캐시로 인한 청크 로드 실패(ChunkLoadError)도 자주 발생할 수 있어 안내 문구를 분기한다.
         */
        try { console.error('[auth] checkEmail failed:', err); } catch (_) {}
        const detail = err?.response?.data?.detail;
        const status = err?.response?.status;
        const msgRaw = String(detail || err?.message || '').trim();
        const isChunkLoad =
          msgRaw.includes('ChunkLoadError') ||
          msgRaw.includes('Loading chunk') ||
          msgRaw.includes('dynamically imported module') ||
          msgRaw.includes('Failed to fetch dynamically imported module');
        const msg = isChunkLoad
          ? '앱이 업데이트되어 새로고침이 필요합니다. (Ctrl+F5) 후 다시 시도해주세요.'
          : (detail
              ? `확인에 실패했습니다: ${String(detail)}`
              : status
                ? `확인에 실패했습니다. (HTTP ${status})`
                : '확인에 실패했습니다.');
        setEmailCheck({ checked: true, available: null, message: msg });
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
        const { data } = await authAPI.checkUsername(v);
        setUsernameCheck({ checked: true, available: data.available, message: data.available ? '사용 가능한 이름입니다.' : '이미 사용 중입니다.' });
      } catch (err) {
        // 실패 원인 노출(방어적 UX)
        try { console.error('[auth] checkUsername failed:', err); } catch (_) {}
        const detail = err?.response?.data?.detail;
        const status = err?.response?.status;
        const msg = detail
          ? `확인에 실패했습니다: ${String(detail)}`
          : status
            ? `확인에 실패했습니다. (HTTP ${status})`
            : '확인에 실패했습니다.';
        setUsernameCheck({ checked: true, available: null, message: msg });
      } finally {
        setUsernameChecking(false);
      }
    }, 500);
    return () => clearTimeout(t);
  }, [registerData.username]);

  // 로그인하러 가기 핸들러 (success → login)
  const handleGoToLogin = () => {
    setView('login');
    // 회원가입 폼 데이터 초기화
    setRegisterData({ email: '', username: '', password: '', confirmPassword: '', gender: 'male' });
    setEmailCheck({ checked: false, available: null, message: '' });
    setUsernameCheck({ checked: false, available: null, message: '' });
    setVerificationInfo({ type: 'info', message: '' });
    setResendCooldown(0);
  };

  return (
    <Dialog open={isOpen} onOpenChange={(v) => { if (!v) onClose?.(); }}>
      {/* ✅ 모바일 최적화: 화면 높이 내에서 스크롤 가능하도록 제한(회원가입 폼이 긴 케이스 대응) */}
      <DialogContent className="sm:max-w-[440px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold text-center">
            {view === 'login' && '로그인'}
            {view === 'register' && '회원가입'}
            {view === 'success' && '가입 완료'}
            {view === 'forgot' && '비밀번호 재설정'}
          </DialogTitle>
        </DialogHeader>
        
        <div className="mt-2">
                {error && (
                  <Alert variant="destructive" className="mb-4">
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}

          {/* 로그인 뷰 */}
          {view === 'login' && (
            <Card className="shadow-none border-0">
              <CardContent className="pt-4">
                  <div className="text-center mb-4">
                    <CardDescription className="text-gray-600 dark:text-gray-300">
                      웹소설 원작을 마음대로 읽고 등장캐와 대화하세요
                    </CardDescription>
                  </div>
                  <form onSubmit={handleLoginSubmit} className="space-y-4">
                    <div className="space-y-2">
                    <Label htmlFor="login-email" className={STYLES.label}>이메일</Label>
                      <div className="relative">
                      <Mail className={STYLES.inputIcon} />
                      <Input id="login-email" name="email" type="email" placeholder="이메일을 입력하세요" value={loginData.email} onChange={handleLoginChange} className={STYLES.input} required />
                    </div>
                      </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="login-password" className={STYLES.label}>비밀번호</Label>
                      <button
                        type="button"
                        className="text-xs text-purple-500 hover:text-purple-400"
                        onClick={() => {
                          setView('forgot');
                          setResetEmail(loginData.email || '');
                          setResetStatus({ type: 'info', message: '' });
                        }}
                      >
                        비밀번호 재설정
                      </button>
                    </div>
                      <div className="relative">
                      <Lock className={STYLES.inputIcon} />
                        <Input 
                          id="login-password" 
                          name="password" 
                          type={showLoginPassword ? "text" : "password"} 
                          placeholder="비밀번호를 입력하세요" 
                          value={loginData.password} 
                          onChange={handleLoginChange} 
                        className={STYLES.inputWithToggle} 
                          required 
                        />
                      <button type="button" onClick={() => setShowLoginPassword(!showLoginPassword)} className={STYLES.toggleBtn}>
                          {showLoginPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                    </div>
                  <Button type="submit" className={STYLES.primaryBtn} disabled={loading}>
                      {loading ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" />로그인 중...</>) : '로그인'}
                    </Button>
                  </form>
                
                {/* 회원가입 링크 */}
                <div className="mt-6 text-center border-t border-gray-200 dark:border-gray-700 pt-4">
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    계정이 없으신가요?{' '}
                    <button 
                      type="button" 
                      onClick={() => setView('register')} 
                      className="text-purple-600 hover:text-purple-700 font-semibold hover:underline"
                    >
                      회원가입
                    </button>
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

          {/* 회원가입 뷰 */}
          {view === 'register' && (
            <Card className="shadow-none border-0">
              <CardContent className="pt-4">
                  <div className="text-center mb-4">
                    <CardDescription className="text-gray-600 dark:text-gray-300">
                      새 계정을 만들어 웹소설 원작과 등장캐를 즐기세요
                    </CardDescription>
                  </div>
                  <form onSubmit={handleRegisterSubmit} className="space-y-4">
                  {/* 이메일 + 인증 버튼 (같은 줄) */}
                    <div className="space-y-2">
                    <Label htmlFor="register-email" className={STYLES.label}>이메일</Label>
                    <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                      <div className="relative flex-1">
                        <Mail className={STYLES.inputIcon} />
                        <Input id="register-email" name="email" type="email" placeholder="이메일을 입력하세요" value={registerData.email} onChange={handleRegisterChange} className={STYLES.input} required />
                      </div>
                      <Button
                        type="button"
                        onClick={handleSendVerificationEmail}
                        // ✅ 방어적 UX: 이메일 중복확인이 실패(available=null)해도 인증발송은 시도할 수 있게 한다.
                        // - 서버에서 최종 검증(중복/인증)을 수행한다.
                        // - 단, 이미 등록된 이메일(available===false)인 경우만 막는다.
                        disabled={sendingVerification || resendCooldown > 0 || !registerData.email || emailCheck.available === false}
                        className={`${STYLES.inlineBtn} w-full sm:w-auto`}
                      >
                        {sendingVerification ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : resendCooldown > 0 ? (
                          `${resendCooldown}s`
                        ) : (
                          '인증발송'
                        )}
                      </Button>
                    </div>
                    {/* 상태 메시지: 이메일 중복 확인 + 인증 메일 발송 결과 */}
                    <StatusMessage type={emailCheck.available ? 'success' : 'error'} message={emailCheck.checked ? emailCheck.message : ''} />
                    <StatusMessage type={verificationInfo.type} message={verificationInfo.message} />
                    {emailVerified && (
                      <StatusMessage type="success" message="이메일 인증이 완료되었습니다. 이제 회원가입을 진행할 수 있어요." />
                    )}
                  </div>

                  {/* 사용자명 + 자동생성 (같은 줄) */}
                    <div className="space-y-2">
                    <Label htmlFor="register-username" className={STYLES.label}>사용자명</Label>
                    <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                      <div className="relative flex-1">
                        <User className={STYLES.inputIcon} />
                        <Input id="register-username" name="username" type="text" placeholder="사용자명을 입력하세요" value={registerData.username} onChange={handleRegisterChange} className={STYLES.input} required minLength={2} maxLength={100} disabled={!emailVerified} />
                      </div>
                      <Button type="button" onClick={handleGenerateUsername} disabled={loading || !emailVerified} className={`${STYLES.inlineBtn} w-full sm:w-auto`}>
                        <Wand2 className="h-4 w-4 mr-1" /> 자동
                        </Button>
                    </div>
                    <StatusMessage type={usernameCheck.available ? 'success' : 'error'} message={usernameCheck.checked ? usernameCheck.message : ''} />
                    </div>
                    <div className="space-y-2">
                    <Label htmlFor="register-password" className={STYLES.label}>비밀번호</Label>
                      <div className="relative">
                      <Lock className={STYLES.inputIcon} />
                        <Input 
                          id="register-password" 
                          name="password" 
                          type={showRegisterPassword ? "text" : "password"} 
                          placeholder="영문/숫자 조합 8자 이상" 
                          value={registerData.password} 
                          onChange={handleRegisterChange} 
                        className={STYLES.inputWithToggle} 
                          required 
                          minLength={8} 
                          disabled={!emailVerified}
                        />
                      <button type="button" onClick={() => setShowRegisterPassword(!showRegisterPassword)} className={STYLES.toggleBtn} disabled={!emailVerified}>
                          {showRegisterPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                      <p className="text-xs text-gray-600 dark:text-gray-400 font-medium">영문과 숫자를 포함해 8자 이상 입력하세요.</p>
                    </div>
                    <div className="space-y-2">
                    <Label htmlFor="register-confirmPassword" className={STYLES.label}>비밀번호 확인</Label>
                      <div className="relative">
                      <Lock className={STYLES.inputIcon} />
                        <Input 
                          id="register-confirmPassword" 
                          name="confirmPassword" 
                          type={showConfirmPassword ? "text" : "password"} 
                          placeholder="비밀번호를 다시 입력하세요" 
                          value={registerData.confirmPassword} 
                          onChange={handleRegisterChange} 
                        className={STYLES.inputWithToggle} 
                          required 
                          disabled={!emailVerified}
                        />
                      <button type="button" onClick={() => setShowConfirmPassword(!showConfirmPassword)} className={STYLES.toggleBtn} disabled={!emailVerified}>
                          {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                    </div>
                    <div className="space-y-2">
                    <Label className={STYLES.label}>성별</Label>
                      <div className="flex items-center gap-4">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input type="radio" name="gender" value="male" checked={registerData.gender === 'male'} onChange={handleRegisterChange} required disabled={!emailVerified} />
                          <span className="text-gray-900 dark:text-gray-100">남성</span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input type="radio" name="gender" value="female" checked={registerData.gender === 'female'} onChange={handleRegisterChange} required disabled={!emailVerified} />
                          <span className="text-gray-900 dark:text-gray-100">여성</span>
                        </label>
                      </div>
                    </div>
                  <Button type="submit" className={STYLES.primaryBtn} disabled={loading || !emailVerified}>
                      {loading ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" />가입 중...</>) : '회원가입'}
                    </Button>
                  </form>

                {/* 로그인으로 돌아가기 */}
                <div className="mt-4 text-center">
                  <button type="button" onClick={() => setView('login')} className={STYLES.backLink}>
                    <ArrowLeft className="h-3 w-3" /> 로그인으로 돌아가기
                  </button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* 비밀번호 재설정 뷰 */}
          {view === 'forgot' && (
            <Card className="shadow-none border-0">
              <CardContent className="pt-4 space-y-4">
                <div className="text-center mb-2">
                  <CardDescription className="text-gray-600 dark:text-gray-300">
                    가입하신 이메일 주소로 비밀번호 재설정 링크를 보내드립니다.
                  </CardDescription>
                </div>
                <form onSubmit={handleForgotSubmit} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="forgot-email" className={STYLES.label}>이메일</Label>
                    <div className="relative">
                      <Mail className={STYLES.inputIcon} />
                      <Input
                        id="forgot-email"
                        name="forgot-email"
                        type="email"
                        placeholder="가입한 이메일을 입력하세요"
                        value={resetEmail}
                        onChange={(e) => setResetEmail(e.target.value)}
                        className={STYLES.input}
                        required
                      />
                    </div>
                  </div>
                  <StatusMessage type={resetStatus.type} message={resetStatus.message} />
                  <Button type="submit" className={STYLES.primaryBtn} disabled={resetLoading}>
                    {resetLoading ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" />메일 발송 중...</>) : '재설정 링크 보내기'}
                  </Button>
                </form>
                <div className="text-center">
                  <button type="button" onClick={() => setView('login')} className={STYLES.backLink}>
                    <ArrowLeft className="h-3 w-3" /> 로그인으로 돌아가기
                  </button>
                </div>
              </CardContent>
          </Card>
          )}

          {/* 가입 완료 뷰 */}
          {view === 'success' && (
            <div className="text-center py-6 space-y-6">
              <div className="flex justify-center">
                <div className="w-16 h-16 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center">
                  <CheckCircle2 className="w-10 h-10 text-green-600 dark:text-green-400" />
                </div>
              </div>
              <div className="space-y-2">
                <h3 className="text-lg font-bold text-gray-900 dark:text-white">회원가입이 완료되었습니다!</h3>
                <p className="text-sm text-gray-600 dark:text-gray-300">
                  이메일 인증이 완료된 상태로 가입되었습니다.<br />
                  이제 로그인해서 서비스를 이용할 수 있어요.
                </p>
              </div>
              {registerData.email && (
                <div className="space-y-3">
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    현재 이메일: <span className="font-semibold text-gray-800 dark:text-gray-200">{registerData.email}</span>
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    이메일 인증이 이미 완료되어 추가 인증 메일 발송이 필요하지 않습니다.
                  </p>
                </div>
              )}
              <Button onClick={handleGoToLogin} className={STYLES.primaryBtn}>
                로그인하러 가기
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default LoginModal;
