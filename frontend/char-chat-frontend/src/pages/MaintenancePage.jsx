import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/button';

/**
 * 점검 페이지
 * - 불필요한 "AI 느낌" 아이콘을 제거하고, 브랜드 로고 + 텍스트 중심으로 구성
 * - 운영에서는 Nginx/Cloudflare에서 트리거로 전체 트래픽을 이 페이지로 유도할 수 있다.
 */
const MaintenancePage = () => {
  const navigate = useNavigate();
  const [info, setInfo] = useState({ until: '', message: '' });

  useEffect(() => {
    const prev = document.title;
    document.title = '점검 중 | Chapter8';
    return () => {
      document.title = prev;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch('/maintenance-info.json', { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        setInfo({
          until: String(data?.until || '').trim(),
          message: String(data?.message || '').trim(),
        });
      } catch (_) {
        // ignore
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="w-full max-w-lg text-center">
        <div className="flex items-center justify-center mb-6">
          <img
            src="/brand-logo.png"
            alt="Chapter8"
            className="h-20 w-auto max-w-[280px] object-contain object-center"
            onError={(e) => {
              // 방어: 로고 로드 실패 시 텍스트만 보여준다.
              e.currentTarget.style.display = 'none';
            }}
          />
        </div>

        <h1 className="text-2xl font-bold text-gray-900">현재 점검 중입니다</h1>
        <p className="mt-3 text-gray-600 leading-relaxed">
          {info.message || '더 안정적인 서비스를 위해 시스템 점검을 진행하고 있어요.'}
          <br />
          잠시 후 다시 이용해주세요.
        </p>

        {info.until && (
          <p className="mt-3 text-sm text-gray-700 font-semibold">
            예상 완료: <span className="font-bold">{info.until}</span>
          </p>
        )}

        <div className="mt-6 flex items-center justify-center gap-2">
          <Button
            onClick={() => {
              try {
                window.location.reload();
              } catch (_) {}
            }}
            className="bg-purple-600 hover:bg-purple-700 text-white"
          >
            새로고침
          </Button>
          <Button variant="outline" onClick={() => navigate('/dashboard')}>
            메인으로
          </Button>
        </div>

        <p className="mt-6 text-xs text-gray-500">cha8.team@gmail.net</p>
      </div>
    </div>
  );
};

export default MaintenancePage;


