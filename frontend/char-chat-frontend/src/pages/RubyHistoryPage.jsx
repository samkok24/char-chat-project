/**
 * 루비 내역 페이지 (결제내역 + 사용내역 탭)
 * - URL query param ?tab=payment|usage 로 탭 동기화
 * - 각 탭에 서브탭(필터 칩) 제공
 * - RubyChargePage 스타일(다크 테마, 탭 UI) 일관성 유지
 */

import React, { useState, useCallback, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { paymentAPI, pointAPI } from '../lib/api';
import AppLayout from '../components/layout/AppLayout';
import { Badge } from '../components/ui/badge';
import { ArrowLeft, Loader2 } from 'lucide-react';

/* ── 상수 ── */
const TABS = [
  { key: 'payment', label: '결제내역' },
  { key: 'usage', label: '사용내역' },
];
const PAGE_SIZE = 20;

/* ── 서브탭 정의 ── */
const PAYMENT_SUB_TABS = [
  { key: 'all', label: '전체' },
  { key: 'charge', label: '충전' },
  { key: 'auto', label: '자동충전' },
  { key: 'etc', label: '기타' },
];

const USAGE_SUB_TABS = [
  { key: 'all', label: '전체' },
  { key: 'use', label: '사용' },
  { key: 'charge', label: '획득' },
  { key: 'bonus', label: '프로모션' },
];

/* ── 결제내역 클라이언트 필터 (payment_method 기반) ── */
const STANDARD_METHODS = ['card', 'kakao_pay', 'naver_pay', 'toss'];
const AUTO_METHODS = ['subscription', 'auto'];
const PAYMENT_FILTER_FN = {
  all: () => true,
  charge: (p) => !p.payment_method || STANDARD_METHODS.includes(p.payment_method),
  auto: (p) => !!p.payment_method && AUTO_METHODS.includes(p.payment_method),
  etc: (p) =>
    !!p.payment_method &&
    !STANDARD_METHODS.includes(p.payment_method) &&
    !AUTO_METHODS.includes(p.payment_method),
};

/* ── 사용내역 서브탭 → transaction_type 매핑 ── */
const USAGE_TYPE_MAP = {
  all: undefined,
  use: 'use',
  charge: 'charge',
  bonus: 'bonus',
};

/* ── 날짜 포맷 (KST) ── */
const formatKST = (iso) => {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const parts = new Intl.DateTimeFormat('ko-KR', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(d);
    const y = parts.find((p) => p.type === 'year')?.value;
    const m = parts.find((p) => p.type === 'month')?.value;
    const dd = parts.find((p) => p.type === 'day')?.value;
    return y && m && dd ? `${y}.${m}.${dd}` : '';
  } catch {
    return '';
  }
};

/* ── 결제 상태 배지 ── */
const PAYMENT_STATUS = {
  completed: { label: '성공', cls: 'bg-green-600/20 text-green-300 border-green-500/30' },
  success:   { label: '성공', cls: 'bg-green-600/20 text-green-300 border-green-500/30' },
  failed:    { label: '실패', cls: 'bg-red-600/20 text-red-300 border-red-500/30' },
  cancelled: { label: '취소', cls: 'bg-gray-600/20 text-gray-300 border-gray-500/30' },
  pending:   { label: '대기', cls: 'bg-yellow-600/20 text-yellow-300 border-yellow-500/30' },
};

/* ── 포인트 타입 배지 ── */
const POINT_TYPE = {
  charge: { label: '충전', cls: 'bg-green-600/20 text-green-300 border-green-500/30' },
  use:    { label: '사용', cls: 'bg-red-600/20 text-red-300 border-red-500/30' },
  refund: { label: '환불', cls: 'bg-blue-600/20 text-blue-300 border-blue-500/30' },
  bonus:  { label: '보너스', cls: 'bg-yellow-600/20 text-yellow-300 border-yellow-500/30' },
};

/* ── 서브탭 칩 렌더러 ── */
const SubTabChips = ({ tabs, active, onChange }) => (
  <div className="flex gap-2 mb-5">
    {tabs.map((st) => (
      <button
        key={st.key}
        onClick={() => onChange(st.key)}
        className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
          active === st.key
            ? 'bg-purple-600 text-white'
            : 'bg-gray-800 text-gray-400 border border-gray-700 hover:text-gray-200'
        }`}
      >
        {st.label}
      </button>
    ))}
  </div>
);

const RubyHistoryPage = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const activeTab = TABS.some((t) => t.key === searchParams.get('tab'))
    ? searchParams.get('tab')
    : 'payment';

  const setActiveTab = useCallback(
    (key) => setSearchParams({ tab: key }, { replace: true }),
    [setSearchParams],
  );

  /* ══════════════════════════════════════════ */
  /* ── 결제내역 ── */
  /* ══════════════════════════════════════════ */
  const [paymentSubTab, setPaymentSubTab] = useState('all');
  const [paymentOffset, setPaymentOffset] = useState(0);
  const [paymentItems, setPaymentItems] = useState([]);

  const handlePaymentSubTab = useCallback((key) => {
    setPaymentSubTab(key);
    setPaymentOffset(0);
    setPaymentItems([]);
  }, []);

  const { data: paymentData, isLoading: paymentLoading } = useQuery({
    queryKey: ['paymentHistory', paymentOffset],
    queryFn: async () => {
      const res = await paymentAPI.getPaymentHistory({ limit: PAGE_SIZE, offset: paymentOffset });
      return res.data;
    },
    enabled: activeTab === 'payment',
    keepPreviousData: true,
    onSuccess: (d) => {
      if (!d?.payments) return;
      setPaymentItems((prev) =>
        paymentOffset === 0 ? d.payments : [...prev, ...d.payments],
      );
    },
  });

  const paymentListRaw = paymentData?.payments
    ? paymentOffset === 0
      ? paymentData.payments
      : paymentItems.length > paymentOffset
        ? paymentItems
        : [...paymentItems, ...paymentData.payments]
    : paymentItems;
  const paymentTotal = paymentData?.total_count ?? 0;
  const paymentTotalAmount = paymentData?.total_amount ?? 0;
  const hasMorePayments = paymentListRaw.length < paymentTotal;

  const paymentList = useMemo(
    () => paymentListRaw.filter(PAYMENT_FILTER_FN[paymentSubTab] ?? PAYMENT_FILTER_FN.all),
    [paymentListRaw, paymentSubTab],
  );

  /* ══════════════════════════════════════════ */
  /* ── 사용내역 ── */
  /* ══════════════════════════════════════════ */
  const [usageSubTab, setUsageSubTab] = useState('all');
  const [usageOffset, setUsageOffset] = useState(0);
  const [usageItems, setUsageItems] = useState([]);

  const usageFilter = USAGE_TYPE_MAP[usageSubTab];

  const handleUsageSubTab = useCallback((key) => {
    setUsageSubTab(key);
    setUsageOffset(0);
    setUsageItems([]);
  }, []);

  const { data: usageData, isLoading: usageLoading } = useQuery({
    queryKey: ['pointTransactions', usageFilter, usageOffset],
    queryFn: async () => {
      const params = { limit: PAGE_SIZE, offset: usageOffset };
      if (usageFilter) params.transaction_type = usageFilter;
      const res = await pointAPI.getTransactions(params);
      return res.data;
    },
    enabled: activeTab === 'usage',
    keepPreviousData: true,
    onSuccess: (d) => {
      if (!Array.isArray(d)) return;
      setUsageItems((prev) =>
        usageOffset === 0 ? d : [...prev, ...d],
      );
    },
  });

  const usageDataArr = Array.isArray(usageData) ? usageData : [];
  const usageList = usageOffset === 0
    ? usageDataArr
    : usageItems.length > usageOffset
      ? usageItems
      : [...usageItems, ...usageDataArr];
  const hasMoreUsage = usageDataArr.length === PAGE_SIZE;

  return (
    <AppLayout>
      <div className="max-w-2xl mx-auto px-4 py-8 text-gray-100">
        {/* ── 뒤로가기 + 타이틀 ── */}
        <div className="flex items-center gap-3 mb-6">
          <button
            onClick={() => navigate(-1)}
            className="text-gray-400 hover:text-white transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-xl font-bold">루비 내역</h1>
        </div>

        {/* ── 메인 탭 ── */}
        <div className="flex border-b border-gray-700 mb-6">
          {TABS.map((tab) => (
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
        {/* ── 결제내역 탭 ── */}
        {/* ════════════════════════════════════════ */}
        {activeTab === 'payment' && (
          <div>
            <SubTabChips tabs={PAYMENT_SUB_TABS} active={paymentSubTab} onChange={handlePaymentSubTab} />

            {/* 요약 카드 */}
            {paymentTotal > 0 && (
              <div className="bg-gray-800 rounded-xl border border-gray-700 p-4 mb-5 flex items-center justify-between">
                <span className="text-sm text-gray-400">총 결제금액</span>
                <span className="text-lg font-bold text-purple-400">
                  {paymentTotalAmount.toLocaleString()}
                  <span className="text-sm font-normal text-gray-500 ml-0.5">원</span>
                </span>
              </div>
            )}

            {paymentLoading && paymentList.length === 0 ? (
              <div className="flex items-center justify-center gap-2 text-gray-400 py-12">
                <Loader2 className="w-5 h-5 animate-spin" />
                <span className="text-sm">불러오는 중...</span>
              </div>
            ) : paymentList.length === 0 ? (
              <div className="text-center text-gray-500 text-sm py-16">
                결제 내역이 없습니다.
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  {paymentList.map((p) => {
                    const st = PAYMENT_STATUS[p.status] ?? PAYMENT_STATUS.pending;
                    return (
                      <div
                        key={p.id}
                        className="bg-gray-800 rounded-xl border border-gray-700 p-4 flex items-center justify-between gap-3"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-sm font-medium text-white">
                              {p.amount.toLocaleString()}원
                            </span>
                            <Badge
                              className={`text-[10px] px-1.5 py-0.5 border leading-none ${st.cls}`}
                            >
                              {st.label}
                            </Badge>
                          </div>
                          <div className="text-xs text-gray-500">
                            {formatKST(p.paid_at || p.created_at)}
                          </div>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <span className="text-sm font-semibold text-purple-400">
                            +{p.point_amount.toLocaleString()}
                          </span>
                          <span className="text-xs text-gray-500 ml-0.5">루비</span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {hasMorePayments && (
                  <button
                    onClick={() => setPaymentOffset((o) => o + PAGE_SIZE)}
                    disabled={paymentLoading}
                    className="w-full mt-4 py-3 text-sm text-gray-400 hover:text-white bg-gray-800 rounded-xl border border-gray-700 hover:border-gray-600 transition-colors disabled:opacity-50"
                  >
                    {paymentLoading ? '불러오는 중...' : '더보기'}
                  </button>
                )}
              </>
            )}
          </div>
        )}

        {/* ════════════════════════════════════════ */}
        {/* ── 사용내역 탭 ── */}
        {/* ════════════════════════════════════════ */}
        {activeTab === 'usage' && (
          <div>
            <SubTabChips tabs={USAGE_SUB_TABS} active={usageSubTab} onChange={handleUsageSubTab} />

            {usageLoading && usageList.length === 0 ? (
              <div className="flex items-center justify-center gap-2 text-gray-400 py-12">
                <Loader2 className="w-5 h-5 animate-spin" />
                <span className="text-sm">불러오는 중...</span>
              </div>
            ) : usageList.length === 0 ? (
              <div className="text-center text-gray-500 text-sm py-16">
                사용 내역이 없습니다.
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  {usageList.map((t) => {
                    const tp = POINT_TYPE[t.type] ?? POINT_TYPE.use;
                    const isPositive = t.type === 'charge' || t.type === 'refund' || t.type === 'bonus';
                    return (
                      <div
                        key={t.id}
                        className="bg-gray-800 rounded-xl border border-gray-700 p-4 flex items-center justify-between gap-3"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <Badge
                              className={`text-[10px] px-1.5 py-0.5 border leading-none ${tp.cls}`}
                            >
                              {tp.label}
                            </Badge>
                            <span className="text-sm text-gray-200 truncate">
                              {t.description || '-'}
                            </span>
                          </div>
                          <div className="text-xs text-gray-500">
                            {formatKST(t.created_at)}
                          </div>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <div
                            className={`text-sm font-semibold ${
                              isPositive ? 'text-green-400' : 'text-red-400'
                            }`}
                          >
                            {isPositive ? '+' : ''}{t.amount.toLocaleString()}
                          </div>
                          <div className="text-[11px] text-gray-500">
                            잔액 {t.balance_after.toLocaleString()}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {hasMoreUsage && (
                  <button
                    onClick={() => setUsageOffset((o) => o + PAGE_SIZE)}
                    disabled={usageLoading}
                    className="w-full mt-4 py-3 text-sm text-gray-400 hover:text-white bg-gray-800 rounded-xl border border-gray-700 hover:border-gray-600 transition-colors disabled:opacity-50"
                  >
                    {usageLoading ? '불러오는 중...' : '더보기'}
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </AppLayout>
  );
};

export default RubyHistoryPage;
