/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Supabase 프로젝트 URL */
  readonly VITE_SUPABASE_URL: string
  /** Supabase publishable(anon) key — 브라우저 공개를 전제로 RLS로 보호 */
  readonly VITE_SUPABASE_PUBLISHABLE_KEY: string
  /** GitHub Pages 하위 경로 (예: /morning-star/) */
  readonly VITE_BASE_PATH?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
