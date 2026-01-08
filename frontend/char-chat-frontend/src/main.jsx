import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { Toaster } from './components/ui/sonner'
import { TooltipProvider } from './components/ui/tooltip'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {/*
      ✅ Radix Tooltip 전역 Provider

      의도/동작:
      - Tooltip 컴포넌트는 Provider 컨텍스트가 필요하다.
      - 채팅 페이지 등에서 Tooltip을 광범위하게 사용하므로, 앱 루트에서 1회만 감싸 SSOT로 유지한다.
      - delayDuration=0으로 즉시 노출(기존 UX 유지)
    */}
    <TooltipProvider delayDuration={0}>
      <App />
    </TooltipProvider>
    <Toaster richColors position="top-center" />
  </StrictMode>,
)

/**
 * Service Worker 정책(안정성 우선)
 *
 * 현재 운영에서 SW가 외부 리소스/확장(chrome-extension) 요청까지 캐시하려다 예외가 나면서
 * "Failed to convert value to Response" 같은 런타임 에러로 일부 네트워크 흐름이 불안정해질 수 있다.
 * 안정적인 회원가입/로그인 UX를 위해 당분간 SW는 등록하지 않고, 방문 시 기존 SW/캐시를 정리한다.
 */
if ('serviceWorker' in navigator) {
  try {
    navigator.serviceWorker.getRegistrations().then((regs) => {
      regs.forEach((r) => r.unregister().catch(()=>{}));
    }).catch(()=>{});
  } catch (_) {}

  try {
    if ('caches' in window) {
      caches.keys().then((keys) => keys.forEach((k) => caches.delete(k))).catch(()=>{});
    }
  } catch (_) {}
}
