import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../lib/api';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Alert, AlertDescription } from '../components/ui/alert';
import { Loader2, ArrowLeft, CheckCircle, Mail } from 'lucide-react';
import AppLayout from '../components/layout/AppLayout';

const ContactPage = () => {
  const navigate = useNavigate();
  const { user, isAuthenticated } = useAuth();
  const [formData, setFormData] = useState({
    name: user?.username || '',
    email: user?.email || '',
    subject: '',
    message: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const handleChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    });
    setError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    // 유효성 검사
    if (!formData.name.trim()) {
      setError('이름을 입력해주세요.');
      setLoading(false);
      return;
    }
    if (!formData.email.trim() || !formData.email.includes('@')) {
      setError('올바른 이메일 주소를 입력해주세요.');
      setLoading(false);
      return;
    }
    if (!formData.subject.trim()) {
      setError('제목을 입력해주세요.');
      setLoading(false);
      return;
    }
    if (!formData.message.trim() || formData.message.trim().length < 10) {
      setError('문의 내용을 10자 이상 입력해주세요.');
      setLoading(false);
      return;
    }

    try {
      await api.post('/contact', {
        ...formData,
        user_id: user?.id || null,
      });
      setSuccess(true);
      setTimeout(() => {
        navigate('/dashboard');
      }, 3000);
    } catch (err) {
      setError(err?.response?.data?.detail || '문의 접수에 실패했습니다. 잠시 후 다시 시도해주세요.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AppLayout>
      <div className="min-h-screen bg-gray-900 text-white p-4 sm:p-6 lg:p-8">
        <div className="max-w-2xl mx-auto">
          <Button
            variant="ghost"
            onClick={() => navigate(-1)}
            className="mb-6"
          >
            <ArrowLeft className="w-5 h-5 mr-2" />
            뒤로 가기
          </Button>

          <Card className="bg-gray-800 border-gray-700">
            <CardHeader>
              <CardTitle className="text-white text-2xl">1:1 문의</CardTitle>
              <CardDescription className="text-gray-400">
                문의사항을 남겨주시면 빠른 시일 내에 답변드리겠습니다.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {success ? (
                <div className="text-center space-y-4 py-8">
                  <CheckCircle className="w-16 h-16 text-green-500 mx-auto" />
                  <div>
                    <h3 className="text-xl font-semibold text-white mb-2">
                      문의가 접수되었습니다!
                    </h3>
                    <p className="text-gray-400">
                      빠른 시일 내에 답변드리겠습니다.
                    </p>
                    <p className="text-sm text-gray-500 mt-2">
                      3초 후 메인 페이지로 이동합니다...
                    </p>
                  </div>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-6">
                  {error && (
                    <Alert variant="destructive">
                      <AlertDescription>{error}</AlertDescription>
                    </Alert>
                  )}

                  <div className="space-y-2">
                    <Label htmlFor="name" className="text-gray-200">
                      이름 <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      id="name"
                      name="name"
                      type="text"
                      value={formData.name}
                      onChange={handleChange}
                      className="bg-gray-700 border-gray-600 text-white"
                      placeholder="이름을 입력하세요"
                      required
                      disabled={isAuthenticated} // 로그인한 경우 자동 입력
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="email" className="text-gray-200">
                      이메일 <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      id="email"
                      name="email"
                      type="email"
                      value={formData.email}
                      onChange={handleChange}
                      className="bg-gray-700 border-gray-600 text-white"
                      placeholder="이메일을 입력하세요"
                      required
                      disabled={isAuthenticated} // 로그인한 경우 자동 입력
                    />
                    <p className="text-xs text-gray-500">
                      답변은 이메일로 발송됩니다.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="subject" className="text-gray-200">
                      제목 <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      id="subject"
                      name="subject"
                      type="text"
                      value={formData.subject}
                      onChange={handleChange}
                      className="bg-gray-700 border-gray-600 text-white"
                      placeholder="문의 제목을 입력하세요"
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="message" className="text-gray-200">
                      문의 내용 <span className="text-red-500">*</span>
                    </Label>
                    <Textarea
                      id="message"
                      name="message"
                      value={formData.message}
                      onChange={handleChange}
                      className="bg-gray-700 border-gray-600 text-white min-h-[200px]"
                      placeholder="문의 내용을 상세히 입력해주세요 (최소 10자)"
                      required
                    />
                    <p className="text-xs text-gray-500">
                      {formData.message.length} / 최소 10자
                    </p>
                  </div>

                  <Button
                    type="submit"
                    className="w-full bg-purple-600 hover:bg-purple-700 text-white"
                    disabled={loading}
                  >
                    {loading ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        접수 중...
                      </>
                    ) : (
                      <>
                        <Mail className="mr-2 h-4 w-4" />
                        문의 접수하기
                      </>
                    )}
                  </Button>
                </form>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </AppLayout>
  );
};

export default ContactPage;

