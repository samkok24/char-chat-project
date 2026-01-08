import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva } from "class-variance-authority";

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-xs hover:bg-primary/90",
        destructive:
          "bg-destructive text-white shadow-xs hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60",
        outline:
          // 흰 배경에서는 기본 텍스트를 검정으로, 다크에서는 대비 유지
          "border bg-white text-black shadow-xs hover:bg-gray-100 dark:bg-input/30 dark:border-input dark:text-white dark:hover:bg-input/50",
        secondary:
          // secondary가 밝은 배경일 경우 글자 검정, 다크에서는 대비 유지
          "bg-secondary text-black shadow-xs hover:bg-secondary/80 dark:text-secondary-foreground",
        ghost:
          "hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        sm: "h-8 rounded-md gap-1.5 px-3 has-[>svg]:px-2.5",
        lg: "h-10 rounded-md px-6 has-[>svg]:px-4",
        icon: "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

/**
 * Button
 *
 * 의도/동작:
 * - Radix(tooltip/dropdown/popover 등)의 Trigger가 `asChild`로 이 컴포넌트를 감쌀 때,
 *   내부에서 ref(Anchor)를 반드시 필요로 한다.
 * - forwardRef가 없으면 PopperAnchor가 앵커를 잡지 못해 렌더링 루프/크래시가 날 수 있다.
 */
const Button = React.forwardRef(({
  className,
  variant,
  size,
  asChild = false,
  ...props
}, ref) => {
  const Comp = asChild ? Slot : "button"

  return (
    <Comp
      ref={ref}
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props} />
  );
});
Button.displayName = "Button";

export { Button, buttonVariants }
