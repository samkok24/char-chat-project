import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { Toaster } from './components/ui/sonner'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
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
