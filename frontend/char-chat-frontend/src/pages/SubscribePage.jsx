/**
 * 구독 플랜 페이지 (PG 심사용)
 * - 3개 플랜 카드 (무료/베이직/프리미엄)
 * - 혜택 비교표
 * - 구독 버튼 → subscriptionAPI.subscribe()
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { subscriptionAPI } from '../lib/api';
import AppLayout from '../components/layout/AppLayout';
import { Button } from '../components/ui/button';
import {
  Gem,
  Zap,
  BookOpen,
  Sparkles,
  ArrowLeft,
  Check,
  Crown,
} from 'lucide-react';

const SubscribePage = () => {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [plans, setPlans] = useState([]);
  const [myPlanId, setMyPlanId] = useState('free');
  const [loading, setLoading] = useState(true);
  const [subscribing, setSubscribing] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const plansRes = await subscriptionAPI.getPlans();
        if (mounted) setPlans(plansRes.data || []);
      } catch { /* noop */ }

      if (user) {
        try {
          const myRes = await subscriptionAPI.getMySubscription();
          if (mounted) setMyPlanId(myRes.data?.plan_id || 'free');
        } catch { /* noop */ }
      }

      if (mounted) setLoading(false);
    })();
    return () => { mounted = false; };
  }, [user]);

  const handleSubscribe = useCallback(async (planId) => {
    if (!user) { navigate('/login'); return; }
    if (planId === myPlanId) return;

    setSubscribing(true);
    try {
      const res = await subscriptionAPI.subscribe(planId);
      if (res.data?.success) {
        setMyPlanId(planId);
        const ruby = res.data.ruby_granted || 0;
        window.dispatchEvent(new CustomEvent('ruby:balanceChanged'));
        window.dispatchEvent(new CustomEvent('toast', {
          detail: { type: 'success', message: ruby > 0 ? `구독 완료! +${ruby} 루비 지급` : '구독이 변경되었습니다.' },
        }));
      }
    } catch (e) {
      window.dispatchEvent(new CustomEvent('toast', {
        detail: { type: 'error', message: '구독 처리에 실패했습니다.' },
      }));
    } finally {
      setSubscribing(false);
    }
  }, [user, myPlanId, navigate]);

  /* 플랜별 아이콘/테마 */
  const planMeta = {
    free:    { icon: Gem,     gradient: 'from-gray-600 to-gray-700',    border: 'border-gray-700',    accent: 'text-gray-400' },
    basic:   { icon: Zap,     gradient: 'from-blue-600 to-purple-600',  border: 'border-blue-500/50', accent: 'text-blue-400' },
    premium: { icon: Crown,   gradient: 'from-amber-500 to-orange-600', border: 'border-amber-500/50', accent: 'text-amber-400' },
  };

  /* 혜택 행 */
  const benefitRows = [
    { label: '월 기본 루비',     key: 'monthly_ruby',             fmt: (v) => v > 0 ? `${v.toLocaleString()}개` : '-' },
    { label: '타이머 충전 속도', key: 'refill_speed_multiplier',  fmt: (v) => v > 1 ? `x${v}` : '기본' },
    { label: '웹소설 유료회차',  key: 'free_chapters',            fmt: (v) => v ? '무료' : '유료' },
    { label: '고급모델 할인',    key: 'model_discount_pct',       fmt: (v) => v > 0 ? `${v}%` : '-' },
  ];

  return (
    <AppLayout>
      <div className="max-w-2xl mx-auto px-4 py-8 text-gray-100">
        {/* 뒤로가기 + 타이틀 */}
        <div className="flex items-center gap-3 mb-6">
          <button onClick={() => navigate(-1)} className="text-gray-400 hover:text-white transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-xl font-bold">구독 플랜</h1>
        </div>

        {loading ? (
          <div className="text-center py-20 text-gray-500">로딩 중...</div>
        ) : (
          <>
            {/* ── 플랜 카드 ── */}
            <div className="space-y-4 mb-8">
              {plans.map((plan) => {
                const meta = planMeta[plan.id] || planMeta.free;
                const Icon = meta.icon;
                const isCurrent = myPlanId === plan.id;

                return (
                  <div
                    key={plan.id}
                    className={`relative rounded-xl border-2 p-5 transition-all ${
                      isCurrent ? `${meta.border} bg-gray-800/80` : 'border-gray-700 bg-gray-800'
                    }`}
                  >
                    {/* 현재 구독 뱃지 */}
                    {isCurrent && (
                      <div className="absolute -top-2.5 right-4">
                        <span className="bg-purple-500 text-white text-[10px] font-bold px-2 py-0.5 rounded">
                          현재 플랜
                        </span>
                      </div>
                    )}

                    {/* 헤더 */}
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

                    {/* 혜택 요약 */}
                    <div className="space-y-2 mb-4">
                      {plan.monthly_ruby > 0 && (
                        <div className="flex items-center gap-2 text-sm text-gray-300">
                          <Gem className="w-4 h-4 text-pink-400 flex-shrink-0" />
                          <span>매월 루비 <strong className="text-white">{plan.monthly_ruby.toLocaleString()}개</strong> 지급</span>
                        </div>
                      )}
                      {plan.refill_speed_multiplier > 1 && (
                        <div className="flex items-center gap-2 text-sm text-gray-300">
                          <Zap className="w-4 h-4 text-yellow-400 flex-shrink-0" />
                          <span>타이머 충전 <strong className="text-white">x{plan.refill_speed_multiplier}</strong> 빠르게</span>
                        </div>
                      )}
                      {plan.free_chapters && (
                        <div className="flex items-center gap-2 text-sm text-gray-300">
                          <BookOpen className="w-4 h-4 text-green-400 flex-shrink-0" />
                          <span>웹소설 유료회차 <strong className="text-white">무료</strong></span>
                        </div>
                      )}
                      {plan.model_discount_pct > 0 && (
                        <div className="flex items-center gap-2 text-sm text-gray-300">
                          <Sparkles className="w-4 h-4 text-purple-400 flex-shrink-0" />
                          <span>고급 AI 모델 <strong className="text-white">{plan.model_discount_pct}%</strong> 할인</span>
                        </div>
                      )}
                    </div>

                    {/* 구독 버튼 */}
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

            {/* ── 혜택 비교표 ── */}
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
                    {benefitRows.map((row) => (
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

            {/* 안내 문구 */}
            <div className="mt-6 text-xs text-gray-500 space-y-1">
              <p className="font-semibold text-gray-400 mb-2">구독 안내</p>
              <p>• 구독 혜택은 구독 적용 시점부터 즉시 반영됩니다.</p>
              <p>• 플랜 변경 시 새 플랜 혜택이 즉시 적용됩니다.</p>
              <p>• 해지/환불 처리 기준은 환불정책 및 결제대행사 정책을 따릅니다.</p>
              <p>• 구독/환불 문의: cha8.team@gmail.com</p>
              <p className="pt-1">
                진행 시{' '}
                <Link to="/legal/terms" className="text-gray-300 hover:text-white underline underline-offset-2">이용약관</Link>
                {' '}및{' '}
                <Link to="/legal/privacy" className="text-gray-300 hover:text-white underline underline-offset-2">개인정보처리방침</Link>
                ,{' '}
                <Link to="/legal/refund" className="text-gray-300 hover:text-white underline underline-offset-2">환불정책</Link>
                에 동의한 것으로 봅니다.
              </p>
            </div>
          </>
        )}
      </div>
    </AppLayout>
  );
};

export default SubscribePage;
