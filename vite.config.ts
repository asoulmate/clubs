import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// GitHub Pages 프로젝트 저장소 하위 경로 배포 대응:
// GitHub Actions에서 VITE_BASE_PATH=/저장소명/ 으로 주입한다.
// 로컬 개발 시에는 '/' 를 사용한다.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: process.env.VITE_BASE_PATH ?? '/',
})
