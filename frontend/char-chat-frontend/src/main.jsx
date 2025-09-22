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

// Service Worker 정책
// 개발 중에는 SW가 오래된 청크를 캐싱해 404를 유발할 수 있으므로 완전히 비활성화/정리
if ('serviceWorker' in navigator) {
  if (import.meta.env.MODE !== 'production') {
    // dev: 기존 SW/캐시 정리
    navigator.serviceWorker.getRegistrations().then((regs) => {
      regs.forEach((r) => r.unregister().catch(()=>{}));
    }).catch(()=>{});
    try {
      if ('caches' in window) {
        caches.keys().then((keys) => keys.forEach((k) => caches.delete(k))).catch(()=>{});
      }
    } catch (_) {}
  } else {
    // prod만 등록
    window.addEventListener('load', () => {
      try { navigator.serviceWorker.register('/sw.js'); } catch {}
    });
  }
}
