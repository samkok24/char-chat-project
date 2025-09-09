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
        .then(() => {
          setStatus('success');
          setMessage('이메일 인증이 완료되었습니다. 이제 로그인할 수 있어요.');
        })
        .catch((err) => {
          setStatus('error');
          setMessage(err?.response?.data?.detail || '인증에 실패했습니다. 토큰이 만료되었을 수 있어요.');
        });
    }
  }, [location]);

  const handleResend = async () => {
    try {
      setStatus('verifying');
      await authAPI.sendVerificationEmail();
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
                <p className="text-sm text-gray-600">{email ? `${email} 주소로 ` : ''}인증 메일을 보냈습니다. 메일함에서 링크를 눌러 인증을 완료해주세요.</p>
                <div className="flex items-center gap-2">
                  <Button onClick={() => navigate('/login')}>로그인으로</Button>
                  {isAuthenticated && (
                    <Button variant="secondary" onClick={handleResend} disabled={status === 'verifying'}>
                      재발송
                    </Button>
                  )}
                </div>
              </>
            )}

            {status === 'success' && (
              <div className="flex items-center gap-2">
                <Button onClick={() => navigate('/login')}>로그인하러 가기</Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default VerifyPage;


