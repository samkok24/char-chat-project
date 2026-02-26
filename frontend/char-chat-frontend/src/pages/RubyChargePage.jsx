/**
 * 루비 페이지 (크랙 스타일, 다크 테마)
 * - 2탭: 루비 충전 / 무료 루비
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { pointAPI, paymentAPI } from '../lib/api';
import { showToastOnce } from '../lib/toastOnce';
import AppLayout from '../components/layout/AppLayout';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import {
  Gem,
  Clock,
  CalendarCheck,
  Timer,
  ArrowLeft,
} from 'lucide-react';

/* ── 충전 상품 정의 (SSOT: PRICING_AND_PAYMENT_PLAN.md) ── */
const RUBY_PRODUCTS_FALLBACK = [
  { id: 'lite',    name: '라이트',   ruby: 200,   bonus: 0,   price: 2000,  recommended: false },
  { id: 'basic',   name: '베이직',   ruby: 500,   bonus: 25,  price: 5000,  recommended: false },
  { id: 'premium', name: '프리미엄', ruby: 1000,  bonus: 100, price: 10000, recommended: false },
  { id: 'pro',     name: '프로',     ruby: 3000,  bonus: 400, price: 30000, recommended: true },
  { id: 'master',  name: '마스터',   ruby: 5000,  bonus: 800, price: 50000, recommended: false },
];
const PAYMENT_PRIMARY_METHOD_OPTIONS = [
  { key: 'card', label: '신용카드' },
  { key: 'bank', label: '계좌이체' },
];
const PAYMENT_EASY_METHOD_OPTIONS = [
  { key: 'kakaopay', label: '카카오페이' },
  { key: 'naverpayCard', label: '네이버페이' },
  { key: 'samsungpayCard', label: '삼성페이' },
];

const NICEPAY_JS_SDK_URL = 'https://pay.nicepay.co.kr/v1/js/';
const PAYMENT_PROCESSING_TIMEOUT_MS = 180000;
const PENDING_RUBY_REFRESH_KEY = 'pending_ruby_refresh_after_payment';

const loadNicePaySdk = (() => {
  let pending = null;
  return () => {
    if (window.AUTHNICE?.requestPay) return Promise.resolve();
    if (pending) return pending;

    pending = new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[src="${NICEPAY_JS_SDK_URL}"]`);
      if (existing) {
        existing.addEventListener('load', () => resolve(), { once: true });
        existing.addEventListener('error', () => reject(new Error('NICEPAY SDK 로드 실패')), { once: true });
        return;
      }

      const script = document.createElement('script');
      script.src = NICEPAY_JS_SDK_URL;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('NICEPAY SDK 로드 실패'));
      document.head.appendChild(script);
    }).finally(() => {
      pending = null;
    });

    return pending;
  };
})();

const RubyChargePage = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  /* ── State ── */
  const [activeTab, setActiveTab] = useState('charge');
  const [products, setProducts] = useState([]);
  const [productsLoading, setProductsLoading] = useState(true);
  const [productsAvailable, setProductsAvailable] = useState(true);
  const [selectedProduct, setSelectedProduct] = useState('');
  const [payMethod, setPayMethod] = useState('card');
  const [isProcessing, setIsProcessing] = useState(false);
  const [balance, setBalance] = useState(0);
  const [balanceLoading, setBalanceLoading] = useState(true);
  const [timerCurrent, setTimerCurrent] = useState(0);
  const [timerMax, setTimerMax] = useState(15);
  const [timerNextSeconds, setTimerNextSeconds] = useState(0);

  const [refillMultiplier, setRefillMultiplier] = useState(1);

  // 무료 루비
  const [checkedIn, setCheckedIn] = useState(false);
  const [checkingIn, setCheckingIn] = useState(false);
  const processingWatchdogRef = useRef(null);

  const clearProcessingWatchdog = useCallback(() => {
    if (processingWatchdogRef.current) {
      clearTimeout(processingWatchdogRef.current);
      processingWatchdogRef.current = null;
    }
  }, []);

  const releaseProcessing = useCallback(() => {
    clearProcessingWatchdog();
    setIsProcessing(false);
  }, [clearProcessingWatchdog]);

  useEffect(() => () => clearProcessingWatchdog(), [clearProcessingWatchdog]);

  const refreshRubyBalance = useCallback(async () => {
    const res = await pointAPI.getBalance();
    setBalance(res.data?.balance ?? 0);
    window.dispatchEvent(new CustomEvent('ruby:balanceChanged'));
  }, []);

  useEffect(() => {
    let mounted = true;

    (async () => {
      setProductsLoading(true);
      setProductsAvailable(true);
      try {
        const res = await paymentAPI.getProducts();
        const list = Array.isArray(res?.data) ? res.data : [];
        const mapped = list.map((p) => {
          const ruby = Number(p?.point_amount ?? 0);
          const bonus = Number(p?.bonus_point ?? 0);
          const name = String(p?.name ?? '');
          return {
            id: String(p.id),
            name: name || '루비 상품',
            ruby,
            bonus,
            price: Number(p?.price ?? 0),
            recommended: name.includes('프로'),
          };
        });

        if (!mounted) return;
        const fromServer = mapped.length > 0;
        const finalList = fromServer ? mapped : RUBY_PRODUCTS_FALLBACK;
        setProducts(finalList);
        setProductsAvailable(fromServer);
        setSelectedProduct((prev) => {
          if (prev && finalList.some((x) => x.id === prev)) return prev;
          const rec = finalList.find((x) => x.recommended);
          return rec?.id || finalList[0]?.id || '';
        });
      } catch {
        if (!mounted) return;
        setProducts(RUBY_PRODUCTS_FALLBACK);
        setProductsAvailable(false);
        setSelectedProduct((prev) => prev || 'pro');
      } finally {
        if (mounted) setProductsLoading(false);
      }
    })();

    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const result = params.get('payment_result');
    if (!result) return;

    const message = params.get('payment_message');
    const orderId = params.get('payment_order_id') || 'unknown';
    const isSuccess = result === 'success';
    const isPending = result === 'pending';

    (async () => {
      releaseProcessing();
      if (isSuccess) {
        let refreshed = false;
        try {
          sessionStorage.setItem(PENDING_RUBY_REFRESH_KEY, '1');
        } catch (_) {
          // noop
        }
        try {
          await refreshRubyBalance();
          refreshed = true;
        } catch (_) {
          // noop
        }
        if (refreshed) {
          try { sessionStorage.removeItem(PENDING_RUBY_REFRESH_KEY); } catch (_) {}
        }
      }
      showToastOnce({
        key: `payment-result:${result}:${orderId}`,
        type: isSuccess ? 'success' : (isPending ? 'info' : 'error'),
        message: isSuccess
          ? '결제가 완료되었습니다. 루비가 충전되었어요.'
          : (isPending
            ? (message || '결제 대기 상태입니다. 입금 확인 후 자동 충전됩니다.')
            : (message || '결제가 완료되지 않았습니다. 다시 시도해 주세요.')),
        ttlMs: 15000,
      });
      navigate(location.pathname, { replace: true });
    })();
  }, [location.pathname, location.search, navigate, refreshRubyBalance, releaseProcessing]);

  useEffect(() => {
    if (!user) return;
    let pending = null;
    try {
      pending = sessionStorage.getItem(PENDING_RUBY_REFRESH_KEY);
    } catch (_) {
      pending = null;
    }
    if (pending !== '1') return;

    (async () => {
      try {
        await refreshRubyBalance();
        try { sessionStorage.removeItem(PENDING_RUBY_REFRESH_KEY); } catch (_) {}
      } catch (_) {
        // 다음 진입/리렌더에서 재시도
      }
    })();
  }, [refreshRubyBalance, user]);

  /* ── 초기 데이터 로드 ── */
  useEffect(() => {
    let mounted = true;

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

  /* ── 결제 (NICEPAY Server 승인) ── */
  const handlePurchase = useCallback(async () => {
    const product = products.find((p) => p.id === selectedProduct);
    if (!product || !user) return;
    if (!productsAvailable) {
      window.dispatchEvent(new CustomEvent('toast', {
        detail: {
          type: 'error',
          message: '결제 상품 정보를 불러오지 못했습니다. 새로고침 후 다시 시도해 주세요.',
        },
      }));
      return;
    }
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(product.id);
    if (!isUuid) {
      window.dispatchEvent(new CustomEvent('toast', {
        detail: {
          type: 'error',
          message: '결제 상품 정보를 불러오지 못했습니다. 새로고침 후 다시 시도해 주세요.',
        },
      }));
      return;
    }

    setIsProcessing(true);
    clearProcessingWatchdog();
    processingWatchdogRef.current = setTimeout(() => {
      const isVisible = typeof document !== 'undefined' ? document.visibilityState === 'visible' : true;
      const isFocused = typeof document !== 'undefined' && typeof document.hasFocus === 'function'
        ? document.hasFocus()
        : true;
      if (isVisible && isFocused) {
        showToastOnce({
          key: 'payment-watchdog-timeout',
          type: 'info',
          message: '결제 확인이 지연되고 있습니다. 완료 후 자동 반영됩니다.',
          ttlMs: 10000,
        });
      }
    }, PAYMENT_PROCESSING_TIMEOUT_MS);
    try {
      const checkoutRes = await paymentAPI.checkout({
        product_id: product.id,
        return_url: `${window.location.origin}/ruby/charge`,
        method: payMethod,
      });
      const payload = checkoutRes?.data?.request_payload;

      if (!payload || typeof payload !== 'object') {
        throw new Error('결제 요청 파라미터가 비어 있습니다.');
      }

      await loadNicePaySdk();
      if (!window.AUTHNICE?.requestPay) {
        throw new Error('결제 SDK를 초기화하지 못했습니다.');
      }

      const isMobileViewport = typeof window !== 'undefined'
        ? window.matchMedia('(max-width: 767px)').matches
        : false;
      const requestPayload = {
        ...payload,
        disableScroll: isMobileViewport ? true : payload.disableScroll,
      };

      window.AUTHNICE.requestPay({
        ...requestPayload,
        fnError: (result) => {
          const msg = result?.msg || result?.errorMsg || '결제창 호출 중 오류가 발생했습니다.';
          window.dispatchEvent(new CustomEvent('toast', { detail: { type: 'error', message: msg } }));
          releaseProcessing();
        },
      });
    } catch (e) {
      const detail = e?.response?.data?.detail;
      window.dispatchEvent(new CustomEvent('toast', {
        detail: {
          type: 'error',
          message: typeof detail === 'string' && detail ? detail : '결제를 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.',
        },
      }));
      releaseProcessing();
    }
  }, [clearProcessingWatchdog, payMethod, products, productsAvailable, releaseProcessing, selectedProduct, user]);

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

  const selected = products.find(p => p.id === selectedProduct);
  const timerNextMinutes = Math.floor(timerNextSeconds / 60);

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

        {/* ── 심사/정책 안내 (고정 노출) ── */}
        <div className="bg-blue-500/10 border border-blue-500/30 rounded-xl p-4 mb-6">
          <p className="text-sm font-semibold text-blue-300 mb-2">서비스/결제 안내</p>
          <div className="text-xs text-gray-300 space-y-1 leading-relaxed">
            <p>• 본 서비스는 웹소설 디지털 콘텐츠 판매 서비스입니다.</p>
            <p>• 결제는 루비 충전 후 웹소설 회차/작품 구매에만 사용됩니다.</p>
            <p>• 캐릭터 채팅은 무료 부가 기능이며, 유료 채팅/대화권/메시지권은 없습니다.</p>
            <p>• 루비의 환전·현금화·양도·선물·회원 간 거래는 지원하지 않습니다.</p>
            <p>• 결제 판매주체(merchant of record)는 당사입니다.</p>
          </div>
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
        {/* ── 루비 충전 탭 ── */}
        {/* ════════════════════════════════════════ */}
        {activeTab === 'charge' && (
          <div>
            <h3 className="text-base font-semibold mb-4">상품구성</h3>

            {/* 상품 그리드 (2열) */}
            <div className="grid grid-cols-2 gap-3 mb-6">
              {products.map((product, idx) => {
                const total = product.ruby + product.bonus;
                const isSelected = selectedProduct === product.id;
                const isLast = idx === products.length - 1;
                const isOddLast = isLast && products.length % 2 !== 0;

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

            {/* 결제수단 선택 */}
            <div className="mb-6">
              <p className="text-sm text-gray-300 mb-2">결제수단</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {PAYMENT_PRIMARY_METHOD_OPTIONS.map((m) => {
                  const active = payMethod === m.key;
                  return (
                    <button
                      key={m.key}
                      type="button"
                      onClick={() => setPayMethod(m.key)}
                      className={`rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors ${
                        active
                          ? 'border-purple-500 bg-purple-500/10 text-purple-200'
                          : 'border-gray-700 bg-gray-800 text-gray-300 hover:border-gray-500'
                      }`}
                    >
                      {m.label}
                    </button>
                  );
                })}
                {PAYMENT_EASY_METHOD_OPTIONS.map((m) => {
                  const active = payMethod === m.key;
                  return (
                    <button
                      key={m.key}
                      type="button"
                      onClick={() => setPayMethod(m.key)}
                      className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                        active
                          ? 'border-purple-500 bg-purple-500/10 text-purple-200'
                          : 'border-gray-700 bg-gray-800 text-gray-300 hover:border-gray-500'
                      }`}
                    >
                      {m.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 결제 버튼 */}
            <Button
              onClick={user ? handlePurchase : () => navigate('/login')}
              disabled={user ? (isProcessing || productsLoading || !productsAvailable || !selectedProduct) : false}
              className="w-full h-12 text-base font-semibold bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white rounded-xl border-0"
            >
              {!user ? '로그인 후 결제하기' : productsLoading ? '상품 불러오는 중...' : !productsAvailable ? '결제 준비 중...' : isProcessing ? '처리 중...' : (
                selected ? `${selected.price.toLocaleString()}원 결제하기` : '상품을 선택해주세요'
              )}
            </Button>

            <p className="mt-3 text-[11px] text-gray-500 text-center">
              결제 진행 시{' '}
              <Link to="/legal/terms" className="text-gray-300 hover:text-white underline underline-offset-2">이용약관</Link>
              {' '}및{' '}
              <Link to="/legal/privacy" className="text-gray-300 hover:text-white underline underline-offset-2">개인정보처리방침</Link>
              ,{' '}
              <Link to="/legal/refund" className="text-gray-300 hover:text-white underline underline-offset-2">환불정책</Link>
              에 동의한 것으로 봅니다.
            </p>

            {/* 환불 정책 */}
            <div className="mt-6 text-xs text-gray-500 space-y-1">
              <p className="font-semibold text-gray-400 mb-2">환불 정책 및 루비 이용 안내</p>
              <p>• 결제일(승인일) 포함 7일 이내, 해당 결제로 충전된 유상 루비 미사용 건은 환불 요청이 가능합니다.</p>
              <p>• 일부 사용 시 환불액 = 결제금액 × (미사용 유상 루비 ÷ 해당 결제 유상 루비) 기준으로 산정됩니다.</p>
              <p>• 이벤트/보너스 등 무상 지급 루비는 환불 대상에서 제외됩니다.</p>
              <p>• 주관적인 답변 생성의 불만족으로 인한 환불은 불가능합니다.</p>
              <p>• 환불 접수 후 영업일 기준 7일 이내 처리 결과를 안내합니다.</p>
              <p>• 루비는 획득 시점으로부터 1년 이내에 사용할 수 있습니다.</p>
              <p>• 환불 요청 및 문의: cha8.team@gmail.com</p>
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
