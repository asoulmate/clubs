import { createClient } from '@supabase/supabase-js'

// Supabase 클라이언트 (publishable/anon key만 사용 — service_role 키는 절대 포함하지 않는다)
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

if (!supabaseUrl || !supabaseKey) {
  throw new Error(
    '환경변수가 설정되지 않았습니다. .env 파일에 VITE_SUPABASE_URL과 VITE_SUPABASE_PUBLISHABLE_KEY를 설정해주세요.',
  )
}

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    // 로그인 상태 유지 (localStorage에 세션 저장, 자동 갱신)
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
})
