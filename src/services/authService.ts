import { supabase } from '../lib/supabase'
import type { AwardLevel } from '../types/domain'

// ============================================================
// 인증 데이터 접근 계층 (Supabase Auth)
// ============================================================

/**
 * GitHub Pages(HashRouter) 환경에서 이메일 링크 리다이렉트 주소 생성
 * 예: https://사용자명.github.io/저장소명/#/update-password
 */
function redirectUrl(hashPath: string): string {
  const base = `${window.location.origin}${import.meta.env.BASE_URL}`
  return `${base}#${hashPath}`
}

/** 이메일 로그인 */
export async function signInWithEmail(email: string, password: string): Promise<void> {
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw error
}

/** 회원가입 (이름과 입상 구분은 메타데이터로 전달 → DB 트리거가 profiles 생성) */
export async function signUpWithEmail(
  email: string,
  password: string,
  name: string,
  awardLevel: AwardLevel,
): Promise<{ needsEmailConfirm: boolean }> {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { name, award_level: awardLevel },
      emailRedirectTo: redirectUrl('/login'),
    },
  })
  if (error) throw error

  // 이메일 인증이 켜져 있으면 session이 없다
  return { needsEmailConfirm: data.session === null }
}

/** 비밀번호 재설정 메일 발송 */
export async function sendPasswordResetEmail(email: string): Promise<void> {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: redirectUrl('/update-password'),
  })
  if (error) throw error
}

/** 새 비밀번호 설정 (재설정 메일 링크로 진입한 세션에서 호출) */
export async function updatePassword(newPassword: string): Promise<void> {
  const { error } = await supabase.auth.updateUser({ password: newPassword })
  if (error) throw error
}

/** 로그아웃 */
export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut()
  if (error) throw error
}
