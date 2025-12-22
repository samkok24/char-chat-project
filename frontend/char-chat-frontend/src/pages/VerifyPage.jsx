import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { authAPI } from '../lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Alert, AlertDescription } from '../components/ui/alert';
import { useAuth } from '../contexts/AuthContext';

const VerifyPage = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [status, setStatus] = useState('idle'); // idle|verifying|success|error
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');
  const [pendingSignup, setPendingSignup] = useState(false); // 회원 생성 전 인증(회원가입 계속 진행)
  const { isAuthenticated } = useAuth();

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const token = params.get('token');
    const passedEmail = location.state?.email;
    if (passedEmail) setEmail(passedEmail);

    if (token) {
      setStatus('verifying');
      authAPI
        .verifyEmail(token)
        .then((res) => {
          const verifiedEmail = res?.data?.email;
          const pending = !!res?.data?.pending_signup;
          setPendingSignup(pending);
          if (verifiedEmail) setEmail(verifiedEmail);
          // ✅ 회원가입 도중 이메일 인증 완료를 다른 탭/화면에 공유 (storage event)
          try {
            if (verifiedEmail) localStorage.setItem(`auth:emailVerified:${String(verifiedEmail).toLowerCase()}`, String(Date.now()));
          } catch (_) {}
          setStatus('success');
          setMessage(
            String(res?.data?.message || '').trim() ||
              (pending
                ? '이메일 인증이 완료되었습니다. 회원가입을 계속 진행해주세요.'
                : '이메일 인증이 완료되었습니다. 이제 로그인할 수 있어요.')
          );
        })
        .catch((err) => {
          setStatus('error');
          setMessage(err?.response?.data?.detail || '인증에 실패했습니다. 토큰이 만료되었을 수 있어요.');
        });
    }
  }, [location]);

  const handleResend = async () => {
    if (!email) {
      setMessage('이메일 주소를 확인할 수 없습니다.');
      return;
    }
    try {
      setStatus('verifying');
      setMessage('');
      await authAPI.sendVerificationEmail(email);
      setStatus('idle');
      setMessage('인증 메일을 다시 보냈습니다. 메일함을 확인해주세요.');
    } catch (err) {
      setStatus('error');
      setMessage(err?.response?.data?.detail || '재발송에 실패했습니다. 잠시 후 다시 시도해주세요.');
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <Card className="shadow-lg">
          <CardHeader>
            <CardTitle>이메일 인증</CardTitle>
            <CardDescription>계정 보호를 위해 이메일 인증이 필요합니다.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {message && (
              <Alert variant={status === 'error' ? 'destructive' : 'default'}>
                <AlertDescription>{message}</AlertDescription>
              </Alert>
            )}

            {!location.search.includes('token=') && (
              <>
                <p className="text-sm text-gray-600">{email ? `${email} 주소로 ` : ''}인증 메일을 보냈습니다. 메일함에서 링크를 눌러 인증을 완료한 뒤 회원가입을 계속 진행해주세요.</p>
                <p className="text-xs text-gray-500 mt-2">메일이 보이지 않는다면 스팸함을 확인해주세요.</p>
                <div className="flex items-center gap-2">
                  <Button
                    onClick={() => {
                      const q = new URLSearchParams();
                      q.set('tab', 'register');
                      if (email) q.set('email', email);
                      navigate(`/login?${q.toString()}`, { replace: true });
                    }}
                  >
                    회원가입 계속하기
                  </Button>
                  <Button variant="secondary" onClick={handleResend} disabled={status === 'verifying'}>
                    {status === 'verifying' ? '발송 중...' : '재발송'}
                  </Button>
                </div>
              </>
            )}

            {status === 'success' && (
              <div className="flex items-center gap-2">
                {pendingSignup ? (
                  <Button
                    onClick={() => {
                      const q = new URLSearchParams();
                      q.set('tab', 'register');
                      if (email) q.set('email', email);
                      q.set('verified', '1');
                      navigate(`/login?${q.toString()}`, { replace: true });
                    }}
                  >
                    회원가입 계속하기
                  </Button>
                ) : (
                  !isAuthenticated && (
                    <Button variant="secondary" onClick={() => navigate('/login?tab=login', { replace: true })}>로그인</Button>
                  )
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default VerifyPage;


