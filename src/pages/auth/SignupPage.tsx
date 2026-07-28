import { useState, type FormEvent } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { AWARD_LEVEL_OPTIONS } from '../../constants/labels'
import { signUpWithEmail } from '../../services/authService'
import type { AwardLevel } from '../../types/domain'
import { toErrorMessage } from '../../utils/errors'
import { AuthCard, authButtonClass, authInputClass } from './AuthCard'

export function SignupPage() {
  const { clubSlug: paramSlug } = useParams<{ clubSlug?: string }>()
  const [searchParams] = useSearchParams()
  const clubSlug = (paramSlug ?? searchParams.get('club') ?? '').trim().toLowerCase()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [awardLevel, setAwardLevel] = useState<AwardLevel>('none')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [needsConfirm, setNeedsConfirm] = useState(false)

  const loginTo = clubSlug ? `/login?club=${encodeURIComponent(clubSlug)}` : '/login'

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!clubSlug) {
      setError('클럽 정보가 없습니다. 가입 링크(#/c/{슬러그}/signup 또는 ?club=슬러그)로 들어와 주세요.')
      return
    }
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
      const { needsEmailConfirm } = await signUpWithEmail(
        email,
        password,
        name.trim(),
        awardLevel,
        clubSlug,
      )
      if (needsEmailConfirm) setNeedsConfirm(true)
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
          to={loginTo}
          className="mt-5 flex h-12 items-center justify-center rounded-xl bg-green-700 font-bold text-white"
        >
          로그인 화면으로
        </Link>
      </AuthCard>
    )
  }

  return (
    <AuthCard title="회원가입">
      {clubSlug ? (
        <p className="mb-3 rounded-xl bg-green-50 px-3 py-2 text-center text-sm text-green-800">
          클럽 <strong>#{clubSlug}</strong> 에 가입합니다.
        </p>
      ) : (
        <p className="mb-3 rounded-xl bg-amber-50 px-3 py-2 text-center text-sm text-amber-800">
          클럽 슬러그가 필요합니다. 예: #/c/morning-star/signup
        </p>
      )}

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
          <span className="text-xs text-gray-400">
            이전에 게스트로 등록된 이름이면 경기 기록이 이 계정으로 자동 연동됩니다.
          </span>
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

        <button type="submit" disabled={loading || !clubSlug} className={authButtonClass}>
          {loading ? '가입 중...' : '회원가입'}
        </button>
      </form>

      <div className="mt-4 text-center text-sm">
        <span className="text-gray-500">이미 계정이 있으신가요? </span>
        <Link to={loginTo} className="font-semibold text-green-700 underline">
          로그인
        </Link>
      </div>
    </AuthCard>
  )
}
