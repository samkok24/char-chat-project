import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Input
 *
 * 의도/동작:
 * - Radix(asChild) / 포커스 제어 / 외부에서 DOM 접근(ref)이 필요한 경우가 많아 forwardRef로 제공한다.
 * - ref가 막히면 Popper(tooltip/popover) 앵커/트리거가 불안정해져 업데이트 루프가 날 수 있다.
 */
const Input = React.forwardRef(({
  className,
  type,
  ...props
}, ref) => {
  return (
    <input
      ref={ref}
      type={type}
      data-slot="input"
      className={cn(
        // 다크 배경에서 입력 텍스트는 흰색, 라이트(흰 배경)에서는 검정
        "file:text-white placeholder:text-gray-400 selection:bg-primary selection:text-primary-foreground border-input flex h-9 w-full min-w-0 rounded-md border px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        "bg-white text-black",
        "dark:bg-input/30 dark:text-white",
        "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
        "aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
        className
      )}
      {...props} />
  );
});
Input.displayName = "Input";

export { Input }
