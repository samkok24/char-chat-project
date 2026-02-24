/**
 * 루비 페이지 (크랙 스타일, 다크 테마)
 * - 3탭: 구독플랜 / 루비 충전 / 무료 루비
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { pointAPI, subscriptionAPI } from '../lib/api';
import AppLayout from '../components/layout/AppLayout';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import {
  Gem,
  Clock,
  CalendarCheck,
  Timer,
  ArrowLeft,
  Zap,
  BookOpen,
  Sparkles,
  Check,
  Crown,
} from 'lucide-react';

/* ── 충전 상품 정의 (SSOT: PRICING_AND_PAYMENT_PLAN.md) ── */
const RUBY_PRODUCTS = [
  { id: 'lite',    name: '라이트',   ruby: 200,   bonus: 0,   price: 2000,  recommended: false },
  { id: 'basic',   name: '베이직',   ruby: 500,   bonus: 25,  price: 5000,  recommended: false },
  { id: 'premium', name: '프리미엄', ruby: 1000,  bonus: 100, price: 10000, recommended: false },
  { id: 'pro',     name: '프로',     ruby: 3000,  bonus: 400, price: 30000, recommended: true },
  { id: 'master',  name: '마스터',   ruby: 5000,  bonus: 800, price: 50000, recommended: false },
];

/* ── 구독 플랜 메타 ── */
const PLAN_META = {
  free:    { icon: Gem,   gradient: 'from-gray-600 to-gray-700',    border: 'border-gray-700',    accent: 'text-gray-400' },
  basic:   { icon: Zap,   gradient: 'from-blue-600 to-purple-600',  border: 'border-blue-500/50', accent: 'text-blue-400' },
  premium: { icon: Crown, gradient: 'from-amber-500 to-orange-600', border: 'border-amber-500/50', accent: 'text-amber-400' },
};

/* 타이머 리필 간격 텍스트 (base=2시간, multiplier로 나눔) */
const refillIntervalText = (multiplier) => {
  const mins = 120 / (multiplier || 1);
  if (mins >= 60) return `매 ${mins / 60}시간마다`;
  return `매 ${mins}분마다`;
};

const BENEFIT_ROWS = [
  { label: '월 기본 루비',      key: 'monthly_ruby',            fmt: (v) => v > 0 ? `${v.toLocaleString()}개` : '-' },
  { label: '매일 로그인 보상',  key: '_daily_login',            fmt: () => '10개' },
  { label: '루비 자동 충전',    key: 'refill_speed_multiplier', fmt: (v) => `${refillIntervalText(v)} 1개` },
  { label: '웹소설 유료회차',   key: 'free_chapters',           fmt: (v) => v ? '무료' : '유료' },
  { label: '고급모델 할인',     key: 'model_discount_pct',      fmt: (v) => v > 0 ? `${v}%` : '-' },
];

const RubyChargePage = () => {
  const { user } = useAuth();
  const navigate = useNavigate();

  /* ── State ── */
  const [activeTab, setActiveTab] = useState('subscribe');
  const [selectedProduct, setSelectedProduct] = useState('pro');
  const [isProcessing, setIsProcessing] = useState(false);
  const [balance, setBalance] = useState(0);
  const [balanceLoading, setBalanceLoading] = useState(true);
  const [timerCurrent, setTimerCurrent] = useState(0);
  const [timerMax, setTimerMax] = useState(15);
  const [timerNextSeconds, setTimerNextSeconds] = useState(0);

  // 구독 정보
  const [myPlan, setMyPlan] = useState(null);
  const [plans, setPlans] = useState([]);
  const [plansLoading, setPlansLoading] = useState(true);
  const [subscribing, setSubscribing] = useState(false);
  const [refillMultiplier, setRefillMultiplier] = useState(1);

  // 무료 루비
  const [checkedIn, setCheckedIn] = useState(false);
  const [checkingIn, setCheckingIn] = useState(false);

  /* ── 초기 데이터 로드 ── */
  useEffect(() => {
    let mounted = true;

    // 플랜 목록은 비로그인도 조회 가능
    (async () => {
      try {
        const plansRes = await subscriptionAPI.getPlans();
        if (mounted) setPlans(plansRes.data || []);
      } catch { /* noop */ }
      if (mounted) setPlansLoading(false);
    })();

    if (!user) { setBalanceLoading(false); return; }
    (async () => {
      try {
        const res = await pointAPI.getBalance();
        if (mounted) setBalance(res.data?.balance ?? 0);
      } catch {
        // fallback
      } finally {
        if (mounted) setBalanceLoading(false);
      }
      try {
        const timerRes = await pointAPI.getTimerStatus();
        if (mounted) {
          setTimerCurrent(Number(timerRes?.data?.current ?? 0));
          setTimerMax(Number(timerRes?.data?.max ?? 15));
          setTimerNextSeconds(Number(timerRes?.data?.next_refill_seconds ?? 0));
          setRefillMultiplier(Number(timerRes?.data?.refill_multiplier ?? 1));
        }
      } catch {
        // fallback
      }
      try {
        const ciRes = await pointAPI.getCheckInStatus();
        if (mounted && ciRes.data?.checked_in) setCheckedIn(true);
      } catch {
        // fallback
      }
      try {
        const subRes = await subscriptionAPI.getMySubscription();
        if (mounted && subRes.data) setMyPlan(subRes.data);
      } catch {
        // fallback
      }
    })();
    return () => { mounted = false; };
  }, [user]);

  // 1초 카운트다운(표시용)
  useEffect(() => {
    if (timerCurrent >= timerMax || timerNextSeconds <= 0) return;
    const t = setInterval(() => {
      setTimerNextSeconds((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(t);
  }, [timerCurrent, timerMax, timerNextSeconds]);

  // 1분마다 서버 동기화(누적 반영)
  useEffect(() => {
    let mounted = true;
    const sync = async () => {
      try {
        const timerRes = await pointAPI.getTimerStatus();
        if (!mounted) return;
        setTimerCurrent(Number(timerRes?.data?.current ?? 0));
        setTimerMax(Number(timerRes?.data?.max ?? 15));
        setTimerNextSeconds(Number(timerRes?.data?.next_refill_seconds ?? 0));
      } catch {
        // noop
      }
    };
    const id = setInterval(sync, 60 * 1000);
    return () => {
      mounted = false;
      clearInterval(id);
    };
  }, []);

  /* ── 결제 (Paddle 연동 전 placeholder) ── */
  const handlePurchase = useCallback(() => {
    const product = RUBY_PRODUCTS.find(p => p.id === selectedProduct);
    if (!product) return;
    setIsProcessing(true);
    // TODO: Paddle.Checkout.open()
    setTimeout(() => {
      alert(`[준비 중] ${product.name} (💎${(product.ruby + product.bonus).toLocaleString()}) - ${product.price.toLocaleString()}원\n\nPaddle 결제 연동 후 활성화됩니다.`);
      setIsProcessing(false);
    }, 500);
  }, [selectedProduct]);

  /* ── 출석 체크 ── */
  const handleCheckIn = useCallback(async () => {
    setCheckingIn(true);
    try {
      const res = await pointAPI.checkIn();
      setCheckedIn(true);
      const reward = res.data?.reward ?? 10;
      setBalance((prev) => prev + reward);
      window.dispatchEvent(new CustomEvent('ruby:balanceChanged'));
      window.dispatchEvent(new CustomEvent('toast', { detail: { type: 'success', message: `출석체크 완료! +${reward} 루비` } }));
    } catch (e) {
      const status = e?.response?.status;
      if (status === 409) {
        setCheckedIn(true);
      } else {
        window.dispatchEvent(new CustomEvent('toast', { detail: { type: 'error', message: '출석체크에 실패했습니다.' } }));
      }
    } finally {
      setCheckingIn(false);
    }
  }, []);

  /* ── 구독 ── */
  const handleSubscribe = useCallback(async (planId) => {
    if (!user) { navigate('/login'); return; }
    if (planId === myPlan?.plan_id) return;

    setSubscribing(true);
    try {
      const res = await subscriptionAPI.subscribe(planId);
      if (res.data?.success) {
        setMyPlan(res.data.plan ? { plan_id: res.data.plan.id, plan_name: res.data.plan.name } : null);
        const ruby = res.data.ruby_granted || 0;
        if (ruby > 0) setBalance((prev) => prev + ruby);
        window.dispatchEvent(new CustomEvent('ruby:balanceChanged'));
        window.dispatchEvent(new CustomEvent('toast', {
          detail: { type: 'success', message: ruby > 0 ? `구독 완료! +${ruby} 루비 지급` : '구독이 변경되었습니다.' },
        }));
      }
    } catch {
      window.dispatchEvent(new CustomEvent('toast', {
        detail: { type: 'error', message: '구독 처리에 실패했습니다.' },
      }));
    } finally {
      setSubscribing(false);
    }
  }, [user, myPlan, navigate]);

  const selected = RUBY_PRODUCTS.find(p => p.id === selectedProduct);
  const timerNextMinutes = Math.floor(timerNextSeconds / 60);
  const myPlanId = myPlan?.plan_id || 'free';

  return (
    <AppLayout>
      <div className="max-w-2xl mx-auto px-4 py-8 text-gray-100">
        {/* ── 뒤로가기 + 타이틀 ── */}
        <div className="flex items-center gap-3 mb-6">
          <button onClick={() => navigate(-1)} className="text-gray-400 hover:text-white transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-xl font-bold">루비</h1>
        </div>

        {/* ── 잔액 카드 (로그인 시에만) ── */}
        {user && (
          <div className="bg-gray-800 rounded-xl border border-gray-700 p-5 mb-4">
            <p className="text-sm text-gray-400 mb-1">나의 루비</p>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Gem className="w-6 h-6 text-pink-400" />
                <span className="text-3xl font-bold">
                  {balanceLoading ? '...' : balance.toLocaleString()}
                </span>
                <span className="text-lg text-gray-500">개</span>
                <span className="bg-purple-500/20 text-purple-400 text-xs font-semibold px-2 py-0.5 rounded ml-1">
                  {myPlan?.plan_name || '무료'}
                </span>
              </div>
              <button
                onClick={() => navigate('/ruby/history')}
                className="text-sm text-gray-400 hover:text-gray-200 border border-gray-600 rounded-lg px-3 py-1.5 transition-colors"
              >
                전체 내역
              </button>
            </div>
          </div>
        )}

        {/* ── 타이머 리필 요약 (로그인 시에만) ── */}
        {user && (
          <div className="bg-gray-800 rounded-xl border border-gray-700 p-4 mb-6 flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm text-gray-300">
              <Timer className="w-4 h-4 text-purple-400" />
              <span>타이머 리필</span>
              <span className="font-semibold text-purple-400">{timerCurrent}/{timerMax}</span>
              {refillMultiplier > 1 && (
                <span className="bg-yellow-500/20 text-yellow-400 text-[10px] font-bold px-1.5 py-0.5 rounded">
                  x{refillMultiplier}
                </span>
              )}
            </div>
            <span className="text-xs text-gray-500">
              다음 +1💎: {Math.floor(timerNextMinutes / 60)}시간 {timerNextMinutes % 60}분 후
            </span>
          </div>
        )}

        {/* ── 비로그인 안내 ── */}
        {!user && (
          <div className="bg-purple-500/10 border border-purple-500/30 rounded-xl p-4 mb-6 text-center">
            <p className="text-sm text-purple-300 mb-2">로그인하면 무료 루비와 출석 보상을 받을 수 있어요!</p>
            <button
              onClick={() => navigate('/login')}
              className="text-sm font-semibold text-purple-400 hover:text-purple-300 underline transition-colors"
            >
              로그인하기
            </button>
          </div>
        )}

        {/* ── 탭 ── */}
        <div className="flex border-b border-gray-700 mb-6">
          {[
            { key: 'subscribe', label: '구독플랜' },
            { key: 'charge', label: '루비 충전' },
            ...(user ? [{ key: 'free', label: '무료 루비' }] : []),
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex-1 py-3 text-center text-sm font-medium transition-colors relative ${
                activeTab === tab.key
                  ? 'text-white'
                  : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              {tab.label}
              {activeTab === tab.key && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-purple-500" />
              )}
            </button>
          ))}
        </div>

        {/* ════════════════════════════════════════ */}
        {/* ── 구독플랜 탭 ── */}
        {/* ════════════════════════════════════════ */}
        {activeTab === 'subscribe' && (
          <div>
            {plansLoading ? (
              <div className="text-center py-20 text-gray-500">로딩 중...</div>
            ) : (
              <>
                {/* 플랜 카드 */}
                <div className="space-y-4 mb-8">
                  {plans.map((plan) => {
                    const meta = PLAN_META[plan.id] || PLAN_META.free;
                    const Icon = meta.icon;
                    const isCurrent = myPlanId === plan.id;

                    return (
                      <div
                        key={plan.id}
                        className={`relative rounded-xl border-2 p-5 transition-all ${
                          isCurrent ? `${meta.border} bg-gray-800/80` : 'border-gray-700 bg-gray-800'
                        }`}
                      >
                        {isCurrent && (
                          <div className="absolute -top-2.5 right-4">
                            <span className="bg-purple-500 text-white text-[10px] font-bold px-2 py-0.5 rounded">
                              현재 플랜
                            </span>
                          </div>
                        )}

                        <div className="flex items-center justify-between mb-4">
                          <div className="flex items-center gap-3">
                            <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${meta.gradient} flex items-center justify-center`}>
                              <Icon className="w-5 h-5 text-white" />
                            </div>
                            <div>
                              <h3 className="text-lg font-bold">{plan.name}</h3>
                              <p className={`text-sm ${meta.accent}`}>
                                {plan.price > 0 ? `${plan.price.toLocaleString()}원/월` : '무료'}
                              </p>
                            </div>
                          </div>
                        </div>

                        <div className="space-y-2 mb-4">
                          <div className="flex items-center gap-2 text-sm text-gray-300">
                            <Gem className="w-4 h-4 text-pink-400 flex-shrink-0" />
                            <span>매월 루비 <strong className="text-white">{plan.monthly_ruby > 0 ? `${plan.monthly_ruby.toLocaleString()}개` : '-'}</strong> 지급</span>
                          </div>
                          <div className="flex items-center gap-2 text-sm text-gray-300">
                            <CalendarCheck className="w-4 h-4 text-purple-400 flex-shrink-0" />
                            <span>매일 로그인 시 루비 <strong className="text-white">10개</strong></span>
                          </div>
                          <div className="flex items-center gap-2 text-sm text-gray-300">
                            <Zap className="w-4 h-4 text-yellow-400 flex-shrink-0" />
                            <span><strong className="text-white">{refillIntervalText(plan.refill_speed_multiplier)}</strong> 루비 1개 충전</span>
                          </div>
                          <div className="flex items-center gap-2 text-sm text-gray-300">
                            <BookOpen className="w-4 h-4 text-green-400 flex-shrink-0" />
                            <span>웹소설 유료회차 <strong className="text-white">{plan.free_chapters ? '무료' : '유료'}</strong></span>
                          </div>
                          <div className="flex items-center gap-2 text-sm text-gray-300">
                            <Sparkles className="w-4 h-4 text-purple-400 flex-shrink-0" />
                            <span>고급 AI 모델 <strong className="text-white">{plan.model_discount_pct > 0 ? `${plan.model_discount_pct}%` : '-'}</strong> 할인</span>
                          </div>
                        </div>

                        {plan.id !== 'free' && (
                          <Button
                            onClick={() => handleSubscribe(plan.id)}
                            disabled={isCurrent || subscribing}
                            className={`w-full h-11 text-sm font-semibold rounded-xl border-0 ${
                              isCurrent
                                ? 'bg-gray-700 text-gray-400 cursor-default'
                                : 'bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white'
                            }`}
                          >
                            {isCurrent ? (
                              <span className="flex items-center gap-1.5"><Check className="w-4 h-4" /> 구독 중</span>
                            ) : subscribing ? '처리 중...' : '구독하기'}
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* 혜택 비교표 */}
                <div className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
                  <div className="p-4 border-b border-gray-700">
                    <h3 className="text-base font-semibold">혜택 비교</h3>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-700">
                          <th className="text-left px-4 py-3 text-gray-400 font-medium"></th>
                          {plans.map((p) => (
                            <th key={p.id} className="text-center px-3 py-3 text-gray-300 font-semibold">
                              {p.name}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {BENEFIT_ROWS.map((row) => (
                          <tr key={row.key} className="border-b border-gray-700/50 last:border-0">
                            <td className="px-4 py-3 text-gray-400 whitespace-nowrap">{row.label}</td>
                            {plans.map((p) => (
                              <td key={p.id} className="text-center px-3 py-3 text-gray-200 font-medium">
                                {row.fmt(p[row.key])}
                              </td>
                            ))}
                          </tr>
                        ))}
                        <tr>
                          <td className="px-4 py-3 text-gray-400">가격</td>
                          {plans.map((p) => (
                            <td key={p.id} className="text-center px-3 py-3 text-gray-200 font-semibold">
                              {p.price > 0 ? `${p.price.toLocaleString()}원` : '무료'}
                            </td>
                          ))}
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* 구독 안내 */}
                <div className="mt-6 text-xs text-gray-500 space-y-1">
                  <p className="font-semibold text-gray-400 mb-2">구독 안내</p>
                  <p>• 구독은 결제일로부터 30일간 유지됩니다.</p>
                  <p>• 월 루비는 구독 시작 시 즉시 지급됩니다.</p>
                  <p>• 플랜 변경 시 즉시 적용되며, 기존 플랜은 자동 해지됩니다.</p>
                  <p>• 구독 해지 후에도 만료일까지 혜택이 유지됩니다.</p>
                </div>
              </>
            )}
          </div>
        )}

        {/* ════════════════════════════════════════ */}
        {/* ── 루비 충전 탭 ── */}
        {/* ════════════════════════════════════════ */}
        {activeTab === 'charge' && (
          <div>
            <h3 className="text-base font-semibold mb-4">상품구성</h3>

            {/* 상품 그리드 (2열) */}
            <div className="grid grid-cols-2 gap-3 mb-6">
              {RUBY_PRODUCTS.map((product, idx) => {
                const total = product.ruby + product.bonus;
                const isSelected = selectedProduct === product.id;
                const isLast = idx === RUBY_PRODUCTS.length - 1;
                const isOddLast = isLast && RUBY_PRODUCTS.length % 2 !== 0;

                return (
                  <button
                    key={product.id}
                    onClick={() => setSelectedProduct(product.id)}
                    className={`relative rounded-xl border-2 p-4 text-left transition-all ${
                      isSelected
                        ? 'border-purple-500 bg-purple-500/10'
                        : 'border-gray-700 bg-gray-800 hover:border-gray-600'
                    } ${isOddLast ? 'col-span-2' : ''}`}
                  >
                    {/* 추천 뱃지 */}
                    {product.recommended && (
                      <div className="absolute -top-2.5 left-3">
                        <span className="bg-red-500 text-white text-[10px] font-bold px-2 py-0.5 rounded">
                          추천
                        </span>
                      </div>
                    )}

                    {/* 라디오 + 가격 */}
                    <div className="flex items-start justify-between mb-3">
                      <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                        isSelected ? 'border-purple-500' : 'border-gray-600'
                      }`}>
                        {isSelected && <div className="w-2.5 h-2.5 rounded-full bg-purple-500" />}
                      </div>
                      <span className="text-lg font-bold text-purple-400">
                        {product.price.toLocaleString()}
                        <span className="text-sm font-normal text-gray-500">원</span>
                      </span>
                    </div>

                    {/* 루비 수량 */}
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-pink-500 to-purple-600 flex items-center justify-center">
                        <Gem className="w-4 h-4 text-white" />
                      </div>
                      <div>
                        <span className="text-base font-bold">
                          {total.toLocaleString()}개
                        </span>
                        {product.bonus > 0 && (
                          <span className="ml-1.5 text-xs text-green-400 font-semibold">
                            +{product.bonus.toLocaleString()}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* 단가 할인율 */}
                    {product.bonus > 0 && (
                      <p className="text-[11px] text-gray-500 mt-1.5">
                        루비당 {(product.price / total).toFixed(1)}원
                        <span className="ml-1 text-green-400">
                          ({Math.round((1 - product.price / total / 10) * 100)}% 할인)
                        </span>
                      </p>
                    )}
                  </button>
                );
              })}
            </div>

            {/* 결제 버튼 */}
            <Button
              onClick={user ? handlePurchase : () => navigate('/login')}
              disabled={user ? (isProcessing || !selectedProduct) : false}
              className="w-full h-12 text-base font-semibold bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white rounded-xl border-0"
            >
              {!user ? '로그인 후 결제하기' : isProcessing ? '처리 중...' : (
                selected ? `${selected.price.toLocaleString()}원 결제하기` : '상품을 선택해주세요'
              )}
            </Button>

            {/* 환불 정책 */}
            <div className="mt-6 text-xs text-gray-500 space-y-1">
              <p className="font-semibold text-gray-400 mb-2">환불 정책 및 루비 이용 안내</p>
              <p>• 모든 결제 상품은 결제일로부터 7일 이내 환불을 요청할 수 있습니다.</p>
              <p>• 구매한 루비를 사용한 이력이 있다면 환불이 불가능합니다.</p>
              <p>• 주관적인 답변 생성의 불만족으로 인한 환불은 불가능합니다.</p>
              <p>• 루비는 획득 시점으로부터 1년 이내에 사용할 수 있습니다.</p>
              <p>• 환불 요청 및 문의는 고객센터로 문의주세요.</p>
            </div>
          </div>
        )}

        {/* ════════════════════════════════════════ */}
        {/* ── 무료 루비 탭 ── */}
        {/* ════════════════════════════════════════ */}
        {activeTab === 'free' && (
          <div className="space-y-4">
            {/* 출석 보상 */}
            <div className="bg-gray-800 rounded-xl border border-gray-700 p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="text-base font-semibold">매일 접속하면</p>
                  <p className="text-lg font-bold text-purple-400">루비 10개!</p>
                </div>
                <div className="w-12 h-12 bg-gradient-to-br from-purple-500/20 to-pink-500/20 rounded-xl flex items-center justify-center">
                  <CalendarCheck className="w-6 h-6 text-purple-400" />
                </div>
              </div>

              {checkedIn ? (
                <div className="w-full h-11 bg-gray-700 rounded-xl flex items-center justify-center text-sm text-gray-300 font-medium">
                  오늘 출석 완료! (+10)
                </div>
              ) : (
                <Button
                  onClick={handleCheckIn}
                  disabled={checkingIn}
                  className="w-full h-11 bg-white hover:bg-gray-100 text-gray-900 rounded-xl text-sm font-semibold border-0"
                >
                  {checkingIn ? '확인 중...' : '출석하기'}
                </Button>
              )}
              <p className="text-[11px] text-gray-500 mt-2 text-center">
                매일 06:00 ~ 23:59에 출석할 수 있어요.
              </p>
            </div>

            {/* 타이머 리필 */}
            <div className="bg-gray-800 rounded-xl border border-gray-700 p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="text-base font-semibold">타이머 리필</p>
                  <p className="text-sm text-gray-400">2시간마다 1루비 자동 충전</p>
                </div>
                <div className="w-12 h-12 bg-gradient-to-br from-blue-500/20 to-indigo-500/20 rounded-xl flex items-center justify-center">
                  <Clock className="w-6 h-6 text-blue-400" />
                </div>
              </div>

              {/* 프로그레스 바 */}
              <div className="mb-2">
                <div className="flex justify-between text-xs text-gray-400 mb-1">
                  <span>현재 {timerCurrent}개</span>
                  <span>최대 {timerMax}개</span>
                </div>
                <div className="w-full h-3 bg-gray-700 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-purple-500 to-blue-500 rounded-full transition-all"
                    style={{ width: `${timerMax > 0 ? (timerCurrent / timerMax) * 100 : 0}%` }}
                  />
                </div>
              </div>

              <p className="text-xs text-gray-500 text-center">
                다음 충전까지 {Math.floor(timerNextMinutes / 60)}시간 {timerNextMinutes % 60}분
              </p>
            </div>

            {/* 광고 시청 (준비중) */}
            <div className="bg-gray-800 rounded-xl border border-gray-700 p-5 opacity-50">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-base font-semibold">광고 시청</p>
                  <p className="text-sm text-gray-400">영상 시청하고 3루비 받기</p>
                </div>
                <Badge variant="secondary" className="text-xs bg-gray-700 text-gray-400">준비중</Badge>
              </div>
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
};

export default RubyChargePage;
