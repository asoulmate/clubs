import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { signInWithEmail } from '../../services/authService'
import { toErrorMessage } from '../../utils/errors'
import { AuthCard, authButtonClass, authInputClass } from './AuthCard'

export function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      // 로그인 성공 시 onAuthStateChange가 세션을 반영하고 라우터가 메인으로 이동시킨다
      await signInWithEmail(email, password)
    } catch (err) {
      setError(toErrorMessage(err))
      setLoading(false)
    }
  }

  return (
    <AuthCard title="로그인">
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-gray-600">이메일</span>
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

        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-gray-600">비밀번호</span>
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={authInputClass}
            placeholder="비밀번호"
          />
        </label>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button type="submit" disabled={loading} className={authButtonClass}>
          {loading ? '로그인 중...' : '로그인'}
        </button>
      </form>

      <div className="mt-4 flex items-center justify-between text-sm">
        <Link to="/reset-password" className="text-gray-500 underline">
          비밀번호를 잊으셨나요?
        </Link>
        <Link to="/signup" className="font-semibold text-green-700 underline">
          회원가입
        </Link>
      </div>
    </AuthCard>
  )
}
