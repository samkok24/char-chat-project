"use client";
import * as React from "react"
import { ArrowLeft, ArrowRight } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

const CarouselContext = React.createContext(null)

function useCarousel() {
  const context = React.useContext(CarouselContext)

  if (!context) {
    throw new Error("useCarousel must be used within a <Carousel />")
  }

  return context
}

function Carousel({
  orientation = "horizontal",
  opts,
  setApi,
  plugins,
  className,
  children,
  ...props
}) {
  /**
   * ✅ 안전 캐러셀(Embla 제거)
   *
   * 배경:
   * - 일부 환경에서 Embla(ref=useState setter) + Radix Slot(composeRefs) 조합이
   *   ref null↔node 토글을 유발하며 "Maximum update depth exceeded" 크래시가 발생할 수 있다.
   *
   * 목표:
   * - 기존 shadcn Carousel API(컴포넌트/props/export) 형태는 유지
   * - 외부 의존(Embla) 없이 인덱스 기반으로 슬라이드
   *
   * 방어적:
   * - 사용처가 없더라도, 혹시 남아있어도 앱이 절대 죽지 않도록 설계한다.
   */
  const resolvedOrientation =
    orientation || (opts?.axis === "y" ? "vertical" : "horizontal");

  const [activeIndex, setActiveIndex] = React.useState(0)
  const [snapCount, setSnapCount] = React.useState(0)
  const [canScrollPrev, setCanScrollPrev] = React.useState(false)
  const [canScrollNext, setCanScrollNext] = React.useState(false)

  const activeIndexRef = React.useRef(0)
  const snapCountRef = React.useRef(0)
  const listenersRef = React.useRef({
    select: new Set(),
    reInit: new Set(),
  })

  React.useEffect(() => {
    activeIndexRef.current = activeIndex
    snapCountRef.current = snapCount
    setCanScrollPrev(activeIndex > 0)
    setCanScrollNext(snapCount > 0 && activeIndex < snapCount - 1)

    try {
      listenersRef.current.select.forEach((fn) => {
        try { fn(apiRef.current) } catch (_) {}
      })
    } catch (_) {}
  }, [activeIndex, snapCount])

  // snapCount가 변하면 activeIndex를 안전하게 보정 + reInit 이벤트를 흉내낸다.
  React.useEffect(() => {
    if (snapCount <= 0) {
      setActiveIndex(0)
    } else {
      setActiveIndex((prev) => Math.max(0, Math.min(snapCount - 1, Number(prev) || 0)))
    }
    try {
      listenersRef.current.reInit.forEach((fn) => {
        try { fn(apiRef.current) } catch (_) {}
      })
    } catch (_) {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapCount])

  const scrollPrev = React.useCallback(() => {
    setActiveIndex((prev) => Math.max(0, (Number(prev) || 0) - 1))
  }, [])

  const scrollNext = React.useCallback(() => {
    setActiveIndex((prev) => {
      const next = (Number(prev) || 0) + 1
      const max = Math.max(0, (snapCountRef.current || 0) - 1)
      return Math.min(max, next)
    })
  }, [])

  const handleKeyDown = React.useCallback((event) => {
    if (event.key === "ArrowLeft") {
      event.preventDefault()
      scrollPrev()
    } else if (event.key === "ArrowRight") {
      event.preventDefault()
      scrollNext()
    }
  }, [scrollPrev, scrollNext])

  const apiRef = React.useRef(null)
  if (!apiRef.current) {
    apiRef.current = {
      // Embla 호환 형태(최소) — 사용처가 있어도 크래시 없이 동작하도록.
      scrollPrev: () => scrollPrev(),
      scrollNext: () => scrollNext(),
      scrollTo: (idx) => {
        setActiveIndex(() => {
          const n = Number(idx) || 0
          const max = Math.max(0, (snapCountRef.current || 0) - 1)
          return Math.max(0, Math.min(max, n))
        })
      },
      selectedScrollSnap: () => Number(activeIndexRef.current) || 0,
      scrollSnapList: () => Array.from({ length: Math.max(0, snapCountRef.current || 0) }).map((_, i) => i),
      canScrollPrev: () => (Number(activeIndexRef.current) || 0) > 0,
      canScrollNext: () => {
        const i = Number(activeIndexRef.current) || 0
        const c = Number(snapCountRef.current) || 0
        return c > 0 && i < c - 1
      },
      on: (evt, fn) => {
        try {
          if (!evt || typeof fn !== "function") return
          const key = String(evt)
          const bucket = listenersRef.current[key]
          if (bucket && bucket.add) bucket.add(fn)
        } catch (_) {}
      },
      off: (evt, fn) => {
        try {
          if (!evt || typeof fn !== "function") return
          const key = String(evt)
          const bucket = listenersRef.current[key]
          if (bucket && bucket.delete) bucket.delete(fn)
        } catch (_) {}
      },
    }
  }

  // setApi는 한 번만 주는 것이 정상(Embla처럼). api 객체는 ref에 고정한다.
  React.useEffect(() => {
    if (!setApi) return
    try { setApi(apiRef.current) } catch (_) {}
  }, [setApi])

  return (
    <CarouselContext.Provider
      value={{
        api: apiRef.current,
        opts,
        orientation: resolvedOrientation,
        scrollPrev,
        scrollNext,
        canScrollPrev,
        canScrollNext,
        activeIndex,
        setActiveIndex,
        snapCount,
        setSnapCount,
      }}>
      <div
        onKeyDownCapture={handleKeyDown}
        className={cn("relative", className)}
        role="region"
        aria-roledescription="carousel"
        data-slot="carousel"
        {...props}>
        {children}
      </div>
    </CarouselContext.Provider>
  );
}

function CarouselContent({
  className,
  children,
  ...props
}) {
  const { orientation, activeIndex, setSnapCount } = useCarousel()
  const count = React.Children.count(children)

  React.useEffect(() => {
    try { setSnapCount(count) } catch (_) {}
  }, [count, setSnapCount])

  const axis = orientation === "horizontal" ? "X" : "Y"
  const transform = orientation === "horizontal"
    ? `translate3d(-${Math.max(0, Number(activeIndex) || 0) * 100}%, 0, 0)`
    : `translate3d(0, -${Math.max(0, Number(activeIndex) || 0) * 100}%, 0)`

  return (
    <div
      className="overflow-hidden"
      data-slot="carousel-content">
      <div
        className={cn(
          "flex transition-transform duration-300 ease-out will-change-transform",
          orientation === "horizontal" ? "-ml-4" : "-mt-4 flex-col",
          className
        )}
        style={{ transform }}
        {...props}
      >
        {children}
      </div>
    </div>
  );
}

function CarouselItem({
  className,
  ...props
}) {
  const { orientation } = useCarousel()

  return (
    <div
      role="group"
      aria-roledescription="slide"
      data-slot="carousel-item"
      className={cn(
        "min-w-0 shrink-0 grow-0 basis-full",
        orientation === "horizontal" ? "pl-4" : "pt-4",
        className
      )}
      {...props} />
  );
}

function CarouselPrevious({
  className,
  variant = "outline",
  size = "icon",
  ...props
}) {
  const { orientation, scrollPrev, canScrollPrev } = useCarousel()

  return (
    <Button
      data-slot="carousel-previous"
      variant={variant}
      size={size}
      className={cn("absolute size-8 rounded-full", orientation === "horizontal"
        ? "top-1/2 -left-12 -translate-y-1/2"
        : "-top-12 left-1/2 -translate-x-1/2 rotate-90", className)}
      disabled={!canScrollPrev}
      onClick={scrollPrev}
      {...props}>
      <ArrowLeft />
      <span className="sr-only">Previous slide</span>
    </Button>
  );
}

function CarouselNext({
  className,
  variant = "outline",
  size = "icon",
  ...props
}) {
  const { orientation, scrollNext, canScrollNext } = useCarousel()

  return (
    <Button
      data-slot="carousel-next"
      variant={variant}
      size={size}
      className={cn("absolute size-8 rounded-full", orientation === "horizontal"
        ? "top-1/2 -right-12 -translate-y-1/2"
        : "-bottom-12 left-1/2 -translate-x-1/2 rotate-90", className)}
      disabled={!canScrollNext}
      onClick={scrollNext}
      {...props}>
      <ArrowRight />
      <span className="sr-only">Next slide</span>
    </Button>
  );
}

export { Carousel, CarouselContent, CarouselItem, CarouselPrevious, CarouselNext };
