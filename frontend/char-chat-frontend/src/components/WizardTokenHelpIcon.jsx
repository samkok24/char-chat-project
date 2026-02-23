import React from 'react';
import { Popover, PopoverTrigger, PopoverContent } from './ui/popover';

/**
 * ✅ 위저드: 토큰 안내 i 아이콘 (클릭 팝오버)
 *
 * 요구사항/의도:
 * - `{{char}}` / `{{user}}` 토큰이 지원되는 단계에만, 우상단 i 아이콘 1개를 노출한다.
 * - 클릭하면 안내 문구가 뜨고(hover가 아니라 click), 같은 UI를 여러 곳에서 재사용한다(DRY).
 * - 특정 필드에 종속되지 않게 "단계 영역"의 우상단에 배치하는 것을 전제로 한다.
 */
export default function WizardTokenHelpIcon({ className = '', inline = false }) {
  const msg = '내용에 {{char}}를 쓰면 캐릭터의 이름으로, {{user}}를 쓰면 유저의 이름으로 대체됩니다.';

  return (
    <div
      className={[
        inline ? 'inline-flex' : 'absolute top-3 right-3 z-20',
        className,
      ].join(' ')}
    >
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={[
              'inline-flex items-center justify-center',
              'h-7 w-7 rounded-full',
              'bg-white/10 text-gray-200 hover:bg-white/15 hover:text-white',
              'border border-white/10',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500/30',
            ].join(' ')}
            aria-label="토큰 안내"
            title="토큰 안내"
          >
            <span className="text-[12px] font-extrabold leading-none">i</span>
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          sideOffset={8}
          className="w-[320px] max-w-[85vw] p-3 bg-[#141414] text-gray-100 border border-white/10"
        >
          <div className="text-sm leading-relaxed">
            {msg}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

