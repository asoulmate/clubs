// ============================================================
// 오류 → 사용자용 한글 메시지 변환
// Supabase RPC의 raise exception 메시지는 한글이므로 그대로 노출하고,
// 인증/네트워크 등 영문 오류는 한글로 매핑한다.
// ============================================================

const AUTH_ERROR_MAP: [RegExp, string][] = [
  [/invalid login credentials/i, '이메일 또는 비밀번호가 올바르지 않습니다.'],
  [/email not confirmed/i, '이메일 인증이 완료되지 않았습니다. 받은 편지함을 확인해주세요.'],
  [/user already registered/i, '이미 가입된 이메일입니다.'],
  [/password should be at least/i, '비밀번호는 6자 이상 입력해주세요.'],
  [/unable to validate email/i, '올바른 이메일 주소를 입력해주세요.'],
  [/email rate limit exceeded|over_email_send_rate_limit/i, '이메일 발송 한도를 초과했습니다. 잠시 후 다시 시도해주세요.'],
  [/same password/i, '기존과 다른 새 비밀번호를 입력해주세요.'],
  [/failed to fetch|networkerror|network request failed|load failed/i, '서버 저장에 실패했습니다. 네트워크 상태를 확인한 후 다시 시도해주세요.'],
  [/jwt|token|session/i, '로그인 세션이 만료되었습니다. 다시 로그인해주세요.'],
]

/** 한글이 포함된 메시지인지 확인 (RPC에서 발생시킨 한글 예외는 그대로 사용) */
function hasKorean(text: string): boolean {
  return /[가-힣]/.test(text)
}

/** 알 수 없는 오류 객체를 사용자에게 보여줄 한글 메시지로 변환 */
export function toErrorMessage(error: unknown): string {
  const message =
    typeof error === 'string'
      ? error
      : error instanceof Error
        ? error.message
        : typeof error === 'object' && error !== null && 'message' in error
          ? String((error as { message: unknown }).message)
          : ''

  if (!message) return '알 수 없는 오류가 발생했습니다. 잠시 후 다시 시도해주세요.'
  if (hasKorean(message)) return message

  for (const [pattern, korean] of AUTH_ERROR_MAP) {
    if (pattern.test(message)) return korean
  }

  return '요청 처리에 실패했습니다. 잠시 후 다시 시도해주세요.'
}
