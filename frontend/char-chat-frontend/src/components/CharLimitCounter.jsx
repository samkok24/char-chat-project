import React from 'react';

/**
 * ✅ CharLimitCounter
 *
 * 의도/원리:
 * - 입력/텍스트에어리어 우하단에 `현재 글자수/제한` 표시를 제공한다.
 * - 제한 초과 시 숫자를 빨간색으로 표시하고, 필요하면 외부에서 경고 문구를 함께 노출한다.
 *
 * 주의:
 * - "초과 시 오류 팝업"을 내지 않기 위해, 이 컴포넌트는 **표시(UI)만** 담당한다(SRP).
 * - 실제 제출/다음 단계 이동 차단은 호출부에서 `isOver`를 사용해 처리한다.
 */
export default function CharLimitCounter({ value, max, className = '' }) {
  const text = String(value ?? '');
  const len = text.length;
  const maxNum = Number(max);
  const hasMax = Number.isFinite(maxNum) && maxNum > 0;
  const isOver = hasMax ? len > maxNum : false;

  if (!hasMax) return null;

  return (
    <div
      className={[
        // ✅ 우측 스크롤바/리사이즈 핸들과 겹치지 않도록 기본 right 오프셋을 살짝 더 둔다.
        'pointer-events-none absolute bottom-2 right-6 text-[11px] select-none',
        isOver ? 'text-rose-400 font-semibold' : 'text-gray-500',
        className,
      ].join(' ')}
      aria-hidden="true"
    >
      {len}/{maxNum}
    </div>
  );
}

