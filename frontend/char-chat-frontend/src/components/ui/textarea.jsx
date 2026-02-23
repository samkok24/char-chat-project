import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Textarea
 *
 * 의도/동작:
 * - 채팅 입력창처럼 외부에서 높이 자동조절/포커스 제어를 위해 ref가 필요하다.
 * - forwardRef가 없으면 ref가 끊기고, 일부 Radix/Popper 조합에서 앵커 추적이 불안정해질 수 있다.
 * - `field-sizing-content`는 실험적 동작이어서(브라우저별/레이아웃 변화에 따라) 예기치 않은 루프를 유발할 수 있어 제거한다.
 */
const Textarea = React.forwardRef(({
  className,
  ...props
}, ref) => {
  return (
    <textarea
      ref={ref}
      data-slot="textarea"
      className={cn(
        "border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:bg-input/30 flex min-h-16 w-full rounded-md border bg-transparent px-3 py-2 text-base shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        className
      )}
      {...props} />
  );
});
Textarea.displayName = "Textarea";

export { Textarea }
