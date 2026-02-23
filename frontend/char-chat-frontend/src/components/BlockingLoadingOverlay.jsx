import React from 'react';
import { Loader2 } from 'lucide-react';

/**
 * BlockingLoadingOverlay
 *
 * 의도/동작:
 * - 오래 걸리는 요청(예: 회차 등록/수정, 이미지 업로드 등) 중에 사용자 입력을 차단하고
 *   "지금 처리 중"이라는 확실한 피드백을 제공한다.
 * - 백엔드/네트워크 지연으로 수십 초 이상 걸려도 UX가 "멈춘 것처럼" 보이지 않게 한다.
 *
 * 주의:
 * - 서버 SSOT를 바꾸지 않는다. UI 차단/안내만 담당한다.
 */
const BlockingLoadingOverlay = ({
  open,
  fullScreen = false,
  title = '처리 중...',
  description = '잠시만 기다려주세요.',
}) => {
  if (!open) return null;
  const rootClass = fullScreen ? 'fixed inset-0' : 'absolute inset-0';
  return (
    <div className={`${rootClass} z-50 flex items-center justify-center bg-black/60 backdrop-blur-[1px]`}>
      <div className="w-[92%] max-w-md rounded-lg border border-gray-700 bg-gray-900 px-4 py-5 shadow-xl">
        <div className="flex items-start gap-3">
          <Loader2 className="w-5 h-5 text-purple-300 animate-spin mt-0.5" />
          <div className="min-w-0">
            <div className="text-white font-semibold">{title}</div>
            <div className="text-sm text-gray-300 mt-1 whitespace-pre-wrap">{description}</div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default BlockingLoadingOverlay;


