import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { sendPasswordResetEmail } from '../../services/authService'
import { toErrorMessage } from '../../utils/errors'
import { AuthCard, authButtonClass, authInputClass } from './AuthCard'

export function ResetPasswordPage() {
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await sendPasswordResetEmail(email)
      setSent(true)
    } catch (err) {
      setError(toErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  if (sent) {
    return (
      <AuthCard title="비밀번호 재설정">
        <p className="text-center text-base leading-relaxed text-gray-700">
          <strong>{email}</strong> 주소로 재설정 메일을 보냈습니다.
          <br />
          메일의 링크를 눌러 새 비밀번호를 설정해주세요.
        </p>
        <Link
          to="/login"
          className="mt-5 flex h-12 items-center justify-center rounded-xl bg-green-700 font-bold text-white"
        >
          로그인 화면으로
        </Link>
      </AuthCard>
    )
  }

  return (
    <AuthCard title="비밀번호 재설정">
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-gray-600">가입한 이메일</span>
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={authInputClass}
            placeholder="example@email.com"
          />
        </label>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button type="submit" disabled={loading} className={authButtonClass}>
          {loading ? '발송 중...' : '재설정 메일 보내기'}
        </button>
      </form>

      <div className="mt-4 text-center text-sm">
        <Link to="/login" className="text-gray-500 underline">
          로그인 화면으로 돌아가기
        </Link>
      </div>
    </AuthCard>
  )
}
