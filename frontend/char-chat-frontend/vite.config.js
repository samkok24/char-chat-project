import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  // ✨ 여기에 server 설정을 추가하세요
  server: {
    host: true, // Docker 컨테이너 외부에서 접속 가능하도록 설정
    port: 5173,
    allowedHosts: ['.ngrok-free.app'],
  }
})