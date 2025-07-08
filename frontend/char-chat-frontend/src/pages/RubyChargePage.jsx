/**
 * 루비 충전 페이지
 */

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import Header from '../components/Header';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Alert, AlertDescription } from '../components/ui/alert';
import { 
  Gem,
  CreditCard,
  Gift,
  Zap,
  CheckCircle,
  AlertCircle
} from 'lucide-react';

const RubyChargePage = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [selectedPackage, setSelectedPackage] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const rubyPackages = [
    {
      id: 1,
      name: '스타터 팩',
      ruby: 100,
      price: 1000,
      bonus: 0,
      popular: false,
      icon: <Gem className="w-6 h-6" />
    },
    {
      id: 2,
      name: '베이직 팩',
      ruby: 500,
      price: 4500,
      bonus: 50,
      popular: false,
      icon: <Gem className="w-6 h-6" />
    },
    {
      id: 3,
      name: '프리미엄 팩',
      ruby: 1000,
      price: 8500,
      bonus: 150,
      popular: true,
      icon: <Zap className="w-6 h-6" />
    },
    {
      id: 4,
      name: '얼티밋 팩',
      ruby: 3000,
      price: 24000,
      bonus: 600,
      popular: false,
      icon: <Gift className="w-6 h-6" />
    }
  ];

  const handlePurchase = async (packageItem) => {
    setSelectedPackage(packageItem);
    setIsProcessing(true);
    
    // TODO: 실제 결제 처리 로직
    setTimeout(() => {
      alert(`${packageItem.name} 구매 처리 (테스트)`);
      setIsProcessing(false);
      setSelectedPackage(null);
    }, 2000);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-blue-50 to-indigo-50">
      <Header />

      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* 현재 보유 루비 */}
        <Card className="mb-8">
          <CardHeader>
            <CardTitle>내 루비</CardTitle>
            <CardDescription>현재 보유하고 있는 루비입니다.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className="p-3 bg-pink-100 rounded-full">
                  <Gem className="w-8 h-8 text-pink-500" />
                </div>
                <div>
                  <p className="text-3xl font-bold">{user?.ruby_balance || 0}</p>
                  <p className="text-sm text-gray-500">루비</p>
                </div>
              </div>
              <Alert className="max-w-md">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  루비는 프리미엄 캐릭터 이용, 추가 대화, 특별 기능 등에 사용됩니다.
                </AlertDescription>
              </Alert>
            </div>
          </CardContent>
        </Card>

        {/* 충전 패키지 */}
        <div className="mb-8">
          <h2 className="text-2xl font-bold text-gray-900 mb-6">루비 충전하기</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {rubyPackages.map((pkg) => (
              <Card 
                key={pkg.id}
                className={`relative hover:shadow-lg transition-all duration-200 ${
                  selectedPackage?.id === pkg.id ? 'ring-2 ring-purple-600' : ''
                } ${pkg.popular ? 'transform scale-105' : ''}`}
              >
                {pkg.popular && (
                  <div className="absolute -top-3 left-1/2 transform -translate-x-1/2">
                    <Badge className="bg-gradient-to-r from-purple-600 to-blue-600 text-white">
                      인기
                    </Badge>
                  </div>
                )}
                <CardHeader className="text-center">
                  <div className="flex justify-center mb-4">
                    <div className="p-3 bg-pink-100 rounded-full">
                      {pkg.icon}
                    </div>
                  </div>
                  <CardTitle className="text-lg">{pkg.name}</CardTitle>
                </CardHeader>
                <CardContent className="text-center">
                  <div className="mb-4">
                    <p className="text-3xl font-bold text-purple-600">
                      {pkg.ruby + pkg.bonus}
                    </p>
                    <p className="text-sm text-gray-500">
                      루비 {pkg.ruby} + 보너스 {pkg.bonus}
                    </p>
                  </div>
                  <div className="mb-6">
                    <p className="text-2xl font-bold">₩{pkg.price.toLocaleString()}</p>
                  </div>
                  <Button
                    onClick={() => handlePurchase(pkg)}
                    disabled={isProcessing}
                    className={`w-full ${
                      pkg.popular 
                        ? 'bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700' 
                        : ''
                    }`}
                  >
                    {isProcessing && selectedPackage?.id === pkg.id ? (
                      '처리 중...'
                    ) : (
                      '구매하기'
                    )}
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>

        {/* 결제 수단 */}
        <Card>
          <CardHeader>
            <CardTitle>결제 수단</CardTitle>
            <CardDescription>안전하고 빠른 결제를 지원합니다.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="flex items-center justify-center p-4 border rounded-lg">
                <CreditCard className="w-6 h-6 mr-2" />
                <span>신용카드</span>
              </div>
              <div className="flex items-center justify-center p-4 border rounded-lg">
                <span>카카오페이</span>
              </div>
              <div className="flex items-center justify-center p-4 border rounded-lg">
                <span>네이버페이</span>
              </div>
              <div className="flex items-center justify-center p-4 border rounded-lg">
                <span>토스페이</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 안내사항 */}
        <div className="mt-8 space-y-4">
          <Alert>
            <CheckCircle className="h-4 w-4" />
            <AlertDescription>
              <strong>구매 전 확인사항</strong>
              <ul className="mt-2 space-y-1 text-sm">
                <li>• 루비는 구매 후 환불이 불가능합니다.</li>
                <li>• 보너스 루비는 이벤트에 따라 변경될 수 있습니다.</li>
                <li>• 결제 관련 문의는 고객센터로 연락주세요.</li>
              </ul>
            </AlertDescription>
          </Alert>
        </div>
      </main>
    </div>
  );
};

export default RubyChargePage; 