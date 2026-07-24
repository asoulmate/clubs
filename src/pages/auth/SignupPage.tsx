import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { AWARD_LEVEL_OPTIONS } from '../../constants/labels'
import { signUpWithEmail } from '../../services/authService'
import type { AwardLevel } from '../../types/domain'
import { toErrorMessage } from '../../utils/errors'
import { AuthCard, authButtonClass, authInputClass } from './AuthCard'

export function SignupPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [awardLevel, setAwardLevel] = useState<AwardLevel>('none')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [needsConfirm, setNeedsConfirm] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)

    if (name.trim().length < 1) {
      setError('이름을 입력해주세요.')
      return
    }
    if (password.length < 6) {
      setError('비밀번호는 6자 이상 입력해주세요.')
      return
    }

    setLoading(true)
    try {
      const { needsEmailConfirm } = await signUpWithEmail(email, password, name.trim(), awardLevel)
      if (needsEmailConfirm) setNeedsConfirm(true)
      // 이메일 인증이 꺼져 있으면 바로 세션이 생성되어 메인으로 이동한다
    } catch (err) {
      setError(toErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  if (needsConfirm) {
    return (
      <AuthCard title="이메일 인증">
        <p className="text-center text-base leading-relaxed text-gray-700">
          <strong>{email}</strong> 주소로 인증 메일을 보냈습니다.
          <br />
          메일의 링크를 눌러 가입을 완료한 뒤 로그인해주세요.
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
    <AuthCard title="회원가입">
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
          <span className="text-sm font-medium text-gray-600">비밀번호 (6자 이상)</span>
          <input
            type="password"
            required
            minLength={6}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={authInputClass}
            placeholder="비밀번호"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-gray-600">이름</span>
          <input
            type="text"
            required
            maxLength={30}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={authInputClass}
            placeholder="실명 입력 (예: 홍길동)"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-gray-600">입상 구분</span>
          <select
            value={awardLevel}
            onChange={(e) => setAwardLevel(e.target.value as AwardLevel)}
            className={authInputClass}
          >
            {AWARD_LEVEL_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button type="submit" disabled={loading} className={authButtonClass}>
          {loading ? '가입 중...' : '회원가입'}
        </button>
      </form>

      <div className="mt-4 text-center text-sm">
        <span className="text-gray-500">이미 계정이 있으신가요? </span>
        <Link to="/login" className="font-semibold text-green-700 underline">
          로그인
        </Link>
      </div>
    </AuthCard>
  )
}
