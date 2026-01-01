import * as React from "react"

const MOBILE_BREAKPOINT = 768

export function useIsMobile() {
  // ✅ 첫 렌더부터 화면 폭을 반영해 '모바일 4개 구좌' 같은 레이아웃이 깜빡이지 않도록 한다.
  const [isMobile, setIsMobile] = React.useState(() => {
    try { return window.innerWidth < MOBILE_BREAKPOINT } catch { return false }
  })

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    }
    mql.addEventListener("change", onChange)
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    return () => mql.removeEventListener("change", onChange);
  }, [])

  return !!isMobile
}
