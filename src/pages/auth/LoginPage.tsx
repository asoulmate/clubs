import { useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { signInWithEmail } from '../../services/authService'
import { toErrorMessage } from '../../utils/errors'
import { AuthCard, authButtonClass, authInputClass } from './AuthCard'

export function LoginPage() {
  const [searchParams] = useSearchParams()
  const clubSlug = (searchParams.get('club') ?? '').trim().toLowerCase()
  const signupTo = clubSlug ? `/c/${clubSlug}/signup` : '/signup'

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
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
        <Link to={signupTo} className="font-semibold text-green-700 underline">
          회원가입
        </Link>
      </div>
    </AuthCard>
  )
}
