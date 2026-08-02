/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Supabase 프로젝트 URL */
  readonly VITE_SUPABASE_URL: string
  /** Supabase publishable(anon) key — 브라우저 공개를 전제로 RLS로 보호 */
  readonly VITE_SUPABASE_PUBLISHABLE_KEY: string
  /** GitHub Pages 하위 경로 (예: /morning-star/) */
  readonly VITE_BASE_PATH?: string
  readonly VITE_FEATURE_SCOPED_ADMIN_RPC?: string
  readonly VITE_FEATURE_IDENTITY_CLAIMS?: string
  readonly VITE_FEATURE_GUEST_CLAIM_CANDIDATES?: string
  readonly VITE_FEATURE_SHADOW_RATING_CALCULATION?: string
  readonly VITE_FEATURE_SHADOW_RATING_ADMIN?: string
  readonly VITE_FEATURE_SHADOW_RATING_PUBLIC?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
