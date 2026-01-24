import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Switch (checkbox 기반, Radix 미사용)
 *
 * 이유(운영 안정):
 * - 특정 환경에서 @radix-ui/react-switch가 ref 세팅 단계에서 무한 업데이트 루프를 유발하여
 *   "Maximum update depth exceeded"로 화면이 하얗게 죽는 이슈가 발생했다.
 * - 현재 프로젝트는 Vite 기반이므로, Next.js 전용 지시어/래퍼 조합 이슈가 재발하기 쉬워
 *   컴포넌트 자체를 단순화해서 안정성을 확보한다.
 *
 * 호환:
 * - 기존 사용처의 API(checked, onCheckedChange, disabled, id)를 그대로 지원한다.
 */
const Switch = React.forwardRef(
  (
    {
      className,
      id,
      checked,
      defaultChecked,
      disabled,
      onCheckedChange,
      ...rest
    },
    ref
  ) => {
    const isControlled = typeof checked === "boolean"
    const [uncontrolled, setUncontrolled] = React.useState(!!defaultChecked)
    const isOn = isControlled ? !!checked : uncontrolled

    const emit = (next) => {
      try {
        if (!isControlled) setUncontrolled(!!next)
        if (typeof onCheckedChange === "function") onCheckedChange(!!next)
      } catch (e) {
        try { console.error("[Switch] onCheckedChange failed:", e) } catch (_) {}
      }
    }

    return (
      <label
        data-slot="switch"
        className={cn("inline-flex items-center", disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer", className)}
      >
        <input
          ref={ref}
          id={id}
          type="checkbox"
          className="peer sr-only"
          checked={isOn}
          disabled={!!disabled}
          onChange={(e) => emit(!!e?.target?.checked)}
          {...rest}
        />
        <span
          aria-hidden="true"
          className={cn(
            "inline-flex h-[1.15rem] w-8 items-center rounded-full border border-transparent shadow-xs transition-colors",
            // ✅ 요구사항: ON 상태는 보라색으로(화이트 톤에서 안 보이는 문제 방지)
            "bg-input peer-checked:bg-purple-600 dark:bg-input/80",
            "peer-focus-visible:ring-[3px] peer-focus-visible:ring-ring/50",
          )}
        >
          <span
            aria-hidden="true"
            className={cn(
              // ✅ thumb는 흰색 고정(다크 배경에서 대비 확보)
              "pointer-events-none block size-4 rounded-full bg-white ring-0 transition-transform",
              "translate-x-0 peer-checked:translate-x-[calc(100%-2px)]",
              "dark:bg-white peer-checked:dark:bg-white",
            )}
          />
        </span>
      </label>
    )
  }
)

Switch.displayName = "Switch"

export { Switch }
